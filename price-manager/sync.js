/* 경덕농수산 상품단가표 — 구글 시트 암호화 동기화 + 포털 1회 로그인 열쇠 (sync.js)
   ─────────────────────────────────────────────────────────────
   · 단가표를 바꾸면 이 기기에서 바뀐 부분(수정·추가·삭제·되돌리기 기록)만 AES-256-GCM 으로
     잠가 구글 시트(Apps Script 웹앱)에 올리고, 다른 기기에서는 열 때 최신 것을 받아 합칩니다.
   · 시트에는 암호문(iv·ct)만 갑니다. 평문 품목·원가·바코드는 저장소에도 시트에도 없습니다.
   · 통합포털에서 로그인해 들어오면, 포털이 로그인 비밀번호로 만들어 둔 열쇠(IndexedDB)로
     '단가표 열쇠 감싸개'를 풀어 단가표 비밀번호를 묻지 않고 바로 엽니다.
*/
(function (global) {
  'use strict';
  var C = global.PMCore;

  var SYNC_URL = 'https://script.google.com/macros/s/AKfycbyMMATFZ_lTdFlkCXm-U45g17nQy4x-szMzNnkDxRRthtIf2U9a76NgMHurYTjHWfkY7Q/exec';
  var K_DEV = 'pm.device.v1', K_REV = 'pm.sync.rev.v1', K_WRAP = 'pm.wrap.v1.';
  var KEK_DB = 'kdw-portal-kek', KEK_STORE = 'kek';
  var POLL_MS = 45000, PUSH_DELAY = 1800;

  var S = null, H = {};
  var SNAP = { it: {}, row: {}, add: {}, del: {} };

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var DEV = (function () {
    var d = lsGet(K_DEV);
    if (d && d.id) return d.id;
    var id = 'd' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
    lsSet(K_DEV, { id: id });
    return id;
  })();

  var ST = {
    rev: 0, at: 0, ok: 0, status: 'idle', msg: '', busy: false,
    pendingPush: false, timer: null, wait: null, lastErr: ''
  };

  /* ═════════ 서버 ═════════ */
  function api(payload, timeoutMs) {
    var ms = timeoutMs || 25000;
    if (!SYNC_URL) return Promise.reject(new Error('동기화 주소가 없습니다'));
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(SYNC_URL, {
      method: 'POST', cache: 'no-store', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      clearTimeout(t);
      var j = null;
      try { j = JSON.parse(txt); } catch (e) { throw new Error('동기화 서버 응답을 읽지 못했습니다'); }
      return j;
    }).catch(function (e) {
      clearTimeout(t);
      throw e;
    });
  }

  function apiGet(params, timeoutMs) {
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var ms = timeoutMs || 20000;
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(SYNC_URL + (SYNC_URL.indexOf('?') >= 0 ? '&' : '?') + q, {
      cache: 'no-store', redirect: 'follow', signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      clearTimeout(t);
      try { return JSON.parse(txt); } catch (e) { throw new Error('동기화 서버 응답을 읽지 못했습니다'); }
    }).catch(function (e) { clearTimeout(t); throw e; });
  }

  /* ═════════ 상태 표시 ═════════ */
  function setStatus(k, msg) {
    ST.status = k; ST.msg = msg || '';
    if (H.paint) H.paint();
  }
  function errText(e) {
    var s = String((e && e.message) || e || '');
    if (/abort/i.test(s)) return '시간 초과';
    if (/Failed to fetch|NetworkError|Load failed/i.test(s)) return '인터넷 연결 없음';
    return s || '알 수 없는 오류';
  }

  /* ═════════ 바뀐 키 표시(기기 시계) ═════════ */
  function copy(o) { try { return JSON.parse(JSON.stringify(o || {})); } catch (e) { return {}; } }

  function snapshot() {
    SNAP = {
      it: copy(S.edits.it), row: copy(S.edits.row), del: copy(S.edits.del), add: {}
    };
    (S.edits.add || []).forEach(function (a) { SNAP.add[a.id] = a; });
  }

  function touch(now) {
    if (!S.stamp) S.stamp = { it: {}, row: {}, add: {}, del: {} };
    var st = S.stamp, n = 0, k;
    ['it', 'row', 'del'].forEach(function (sec) {
      var cur = S.edits[sec] || {};
      if (!st[sec]) st[sec] = {};
      Object.keys(cur).forEach(function (key) {
        var a = JSON.stringify(cur[key]), b = JSON.stringify(SNAP[sec][key]);
        if (a !== b) { st[sec][key] = now; n++; }
      });
      Object.keys(SNAP[sec]).forEach(function (key) {
        if (!(key in cur) && SNAP[sec][key] !== undefined) { st[sec][key] = now; n++; }
      });
    });
    if (!st.add) st.add = {};
    var seen = {};
    (S.edits.add || []).forEach(function (a) {
      seen[a.id] = 1;
      if (JSON.stringify(a) !== JSON.stringify(SNAP.add[a.id])) { st.add[a.id] = now; n++; }
    });
    Object.keys(SNAP.add).forEach(function (id) { if (!seen[id]) { st.add[id] = now; n++; } });
    snapshot();
    return n;
  }

  /* ═════════ 합치기 (칸마다 더 최근 것을 남긴다) ═════════ */
  function merge(remote) {
    if (!remote || !remote.edits) return 0;
    if (!S.stamp) S.stamp = { it: {}, row: {}, add: {}, del: {} };
    var re = remote.edits, rs = remote.stamps || {};
    var changed = 0, localNewer = 0;

    /* 다른 기기에서 '처음 단가로 되돌리기'를 한 경우 */
    if (Number(remote.wipe) > Number(S.wipe || 0)) {
      S.edits = { it: {}, row: {}, add: [], del: {}, log: (re.log || []).slice(0, 60) };
      S.stamp = { it: {}, row: {}, add: {}, del: {} };
      S.wipe = Number(remote.wipe);
      return 1;
    }

    ['it', 'row', 'del'].forEach(function (sec) {
      var local = S.edits[sec] || (S.edits[sec] = {});
      var rem = re[sec] || {};
      var rsec = rs[sec] || {};
      var lsec = S.stamp[sec] || (S.stamp[sec] = {});
      Object.keys(rem).forEach(function (k) {
        var rt = Number(rsec[k]) || 0, lt = Number(lsec[k]) || 0;
        if (rt > lt) {
          if (JSON.stringify(local[k]) !== JSON.stringify(rem[k])) changed++;
          local[k] = copy(rem[k]);
          lsec[k] = rt;
        } else if (lt > rt) { localNewer++; }
      });
    });

    /* 추가 품목 */
    if (!S.stamp.add) S.stamp.add = {};
    var lmap = {}, rmap = {};
    (S.edits.add || []).forEach(function (a) { lmap[a.id] = a; });
    (re.add || []).forEach(function (a) { if (a && a.id) rmap[a.id] = a; });
    var out = [], keep = {};
    Object.keys(rmap).forEach(function (id) {
      var rt = Number((rs.add || {})[id]) || 0, lt = Number(S.stamp.add[id]) || 0;
      if (rt >= lt) {
        if (JSON.stringify(lmap[id]) !== JSON.stringify(rmap[id])) changed++;
        out.push(copy(rmap[id]));
        keep[id] = 1;
        if (rt > lt) S.stamp.add[id] = rt;
      }
    });
    Object.keys(lmap).forEach(function (id) { if (!keep[id]) out.push(lmap[id]); });
    S.edits.add = out;

    /* 바꾼 내역 로그 */
    var log = (S.edits.log || []).slice();
    var seenT = {};
    log.forEach(function (l) { seenT[l.t] = 1; });
    (re.log || []).forEach(function (l) {
      if (l && l.t && !seenT[l.t]) { log.push(l); seenT[l.t] = 1; changed++; }
    });
    log.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    S.edits.log = log.slice(0, 60);

    if (remote.custom !== undefined && remote.custom !== !!S.custom) {
      /* 다른 기기에서 엑셀 단가표로 새로 시작한 경우 그 기준을 따른다 */
      if (remote.custom && remote.base && remote.base.items && remote.base.items.length) {
        H.applyBase(remote.base);
        changed++;
      }
    }
    if (localNewer) ST.pendingPush = true;
    /* 받아서 합친 값은 '이 기기에서 바꾼 것'이 아니므로 기준점을 다시 맞춰 둔다 */
    if (changed) snapshot();
    return changed;
  }

  /* ═════════ 올리기 / 받기 ═════════ */
  function ready() { return !!(S && S.key && !S.demo && SYNC_URL); }

  function buildDoc() {
    var doc = {
      v: 1, at: Date.now(), by: DEV,
      edits: { it: S.edits.it || {}, row: S.edits.row || {}, add: S.edits.add || [], del: S.edits.del || {}, log: S.edits.log || [] },
      stamps: S.stamp || { it: {}, row: {}, add: {}, del: {} },
      wipe: Number(S.wipe) || 0,
      custom: !!S.custom,
      n: (S.items || []).length
    };
    if (S.custom) {
      doc.base = { built: (S.payload && S.payload.built) || '', chs: (S.payload && S.payload.chs) || [],
        items: S.base || [], chRows: S.rowsBase || {}, hana: S.hanaBase || [] };
    }
    return doc;
  }

  function onOk(rev, at) {
    ST.rev = Number(rev) || 0;
    ST.at = Number(at) || Date.now();
    ST.ok = Date.now();
    ST.lastErr = '';
    lsSet(K_REV, { rev: ST.rev, at: ST.at });
    setStatus('ok');
  }

  function put() {
    var doc = buildDoc();
    var box;
    return C.sealJSON(S.key, doc, true).then(function (b) {
      box = b;
      return api({ action: 'put', baseRev: ST.rev, by: DEV, n: doc.n, iv: b.iv, ct: b.ct, zip: b.zip });
    }).then(function (j) {
      if (j && j.ok) { onOk(j.rev, j.at); return { ok: true }; }
      if (j && j.error === 'conflict') {
        ST.rev = Number(j.rev) || 0;      /* 서버 기준으로 맞춘 뒤 받아서 합치고 다시 올린다 */
        return { ok: false, conflict: true };
      }
      throw new Error((j && (j.error || j.message)) || '저장하지 못했습니다');
    });
  }

  function push() {
    if (!ready()) return Promise.resolve(false);
    if (ST.busy) { ST.pendingPush = true; return Promise.resolve(false); }
    ST.busy = true;
    ST.pendingPush = false;
    if (ST.status !== 'saving') setStatus('saving');
    var attempt = 0;
    function step() {
      attempt++;
      return put().then(function (r) {
        if (r.conflict && attempt <= 3) {
          return pull(true).then(step);
        }
        return !!r.ok;
      });
    }
    return step().then(function (ok) {
      ST.busy = false;
      if (ok) setStatus('ok');
      else if (attempt > 2) setStatus('error', '충돌이 계속됩니다 · 잠시 뒤 다시 시도해 주세요');
      if (ST.pendingPush) { ST.pendingPush = false; return push(); }
      return ok;
    }).catch(function (e) {
      ST.busy = false;
      ST.lastErr = errText(e);
      setStatus('error', ST.lastErr);
      return false;
    });
  }

  function pull(force) {
    if (!ready()) return Promise.resolve(0);
    return apiGet({ action: 'get', _: Date.now() }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && (j.error || j.message)) || '받지 못했습니다');
      if (!j.iv) { ST.at = 0; ST.rev = Number(j.rev) || 0; return 0; }
      if (!force && Number(j.rev) === ST.rev) { ST.at = Number(j.at) || ST.at; return 0; }
      return C.unsealJSON(S.key, { iv: j.iv, ct: j.ct, zip: j.zip }).then(function (doc) {
        var n = merge(doc);
        onOk(j.rev, j.at);
        if (n > 0 && H.afterMerge) H.afterMerge(n);
        return n;
      });
    }).catch(function (e) {
      var t = errText(e);
      /* 열쇠가 달라 암호를 풀 수 없는 경우와 통신 실패를 구분 */
      ST.lastErr = /OperationError/i.test(String(e && e.name)) ? '다른 비밀번호로 잠긴 자료입니다' : t;
      setStatus('error', ST.lastErr);
      return 0;
    });
  }

  function hasAnyStamp() {
    if (!S.stamp) return false;
    return !!(Object.keys(S.stamp.it || {}).length || Object.keys(S.stamp.row || {}).length ||
      Object.keys(S.stamp.del || {}).length || Object.keys(S.stamp.add || {}).length);
  }
  function hasAnyEdit() {
    var e = S.edits || {};
    return !!(Object.keys(e.it || {}).length || Object.keys(e.row || {}).length ||
      Object.keys(e.del || {}).length || (e.add || []).length);
  }

  function changed() {
    if (!ready()) return;
    if (!S.stamp) S.stamp = { it: {}, row: {}, add: {}, del: {} };
    touch(Date.now());
    ST.pendingPush = true;
    if (ST.wait) clearTimeout(ST.wait);
    ST.wait = setTimeout(function () { ST.wait = null; push(); }, PUSH_DELAY);
  }

  function start() {
    if (!ready()) { setStatus('off'); return; }
    var saved = lsGet(K_REV);
    if (saved && typeof saved.rev === 'number') { ST.rev = saved.rev; ST.at = saved.at || 0; }
    if (!S.stamp) S.stamp = { it: {}, row: {}, add: {}, del: {} };
    /* 이 기능 전에 이 기기에만 있던 수정은 '지금 이 기기에서 바꾼 것'으로 표시해 둔다 */
    if (!hasAnyStamp() && hasAnyEdit()) touch(Date.now());
    snapshot();
    setStatus(ST.rev ? 'sync' : 'first');
    pull(false).then(function (n) {
      /* 받은 것이 없거나, 이 기기에만 있는 수정이 있으면 올린다 */
      if (n === 0) return push();
      return true;
    }).then(function () {
      if (ST.status === 'sync' || ST.status === 'first') setStatus('ok');
    });
    if (ST.timer) clearInterval(ST.timer);
    ST.timer = setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if (ST.pendingPush) { push(); return; }
      pull(false).then(function (n) { if (n === 0 && ST.pendingPush) push(); });
    }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (ST.pendingPush) push(); else pull(false);
    });
  }

  function stop() { if (ST.timer) { clearInterval(ST.timer); ST.timer = null; } }

  /* ═════════ 포털 1회 로그인 열쇠 ═════════ */
  function ssoSession() {
    try {
      var s = JSON.parse(localStorage.getItem('kd.portal.sso.v1') || 'null');
      if (!s || !s.userId) return null;
      if (s.exp && Date.now() > s.exp) return null;
      return s;
    } catch (e) { return null; }
  }
  function normId(id) { return String(id == null ? '' : id).trim().toLowerCase(); }

  function kekDb() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(KEK_DB, 1);
      rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains(KEK_STORE)) rq.result.createObjectStore(KEK_STORE); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function kekGet(id) {
    id = normId(id);
    return kekDb().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(KEK_STORE, 'readonly'), rq = tx.objectStore(KEK_STORE).get('u:' + id);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function toU8(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function wrapLocalGet(id) {
    var b = lsGet(K_WRAP + normId(id));
    return (b && b.iv && b.ct) ? b : null;
  }
  function wrapGet(id) {
    id = normId(id);
    var local = wrapLocalGet(id);
    if (local) return Promise.resolve(local);
    return apiGet({ action: 'key_get', id: id, _: Date.now() }).then(function (j) {
      if (j && j.ok && j.found && j.iv && j.ct) {
        var box = { iv: j.iv, ct: j.ct, at: j.at || 0 };
        lsSet(K_WRAP + id, box);
        return box;
      }
      return null;
    }).catch(function () { return null; });
  }

  /* 포털 로그인으로 받은 열쇠로 '단가표 열쇠 감싸개'를 풀어 단가표 비밀번호를 얻는다 */
  function unwrapFor(id) {
    id = normId(id);
    return kekGet(id).then(function (k) {
      if (!k || !k.key) return null;
      return wrapGet(id).then(function (box) {
        if (!box) return null;
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: toU8(box.iv) }, k.key, toU8(box.ct))
          .then(function (buf) {
            var o = JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
            return (o && o.pw) ? String(o.pw) : null;
          }).catch(function () { return null; });
      });
    }).catch(function () { return null; });
  }

  /* 단가표 비밀번호를 포털 계정 열쇠로 감싸 이 기기 + 시트에 둔다 (다른 기기에서도 비밀번호 없이 열림) */
  function wrapMint(pw, id) {
    id = normId(id);
    if (!pw || !id) return Promise.resolve(false);
    return kekGet(id).then(function (k) {
      if (!k || !k.key) return false;
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var data = new TextEncoder().encode(JSON.stringify({ v: 1, pw: pw, at: Date.now() }));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k.key, data).then(function (ct) {
        var box = { iv: C.b64e(iv), ct: C.b64e(new Uint8Array(ct)), at: Date.now() };
        lsSet(K_WRAP + id, box);
        return api({ action: 'key_put', id: id, iv: box.iv, ct: box.ct })
          .then(function () { return true; })
          .catch(function () { return false; });
      });
    }).catch(function () { return false; });
  }

  function hasKek(id) { return kekGet(id).then(function (k) { return !!(k && k.key); }); }

  global.PMSync = {
    init: function (state, hooks) { S = state; H = hooks || {}; },
    start: start, stop: stop, changed: changed, push: push, pull: pull,
    state: function () { return ST; },
    dev: DEV,
    hasLocalWrap: function (id) { return !!wrapLocalGet(id); },
    statusText: function () {
      var t = ST.status;
      if (t === 'off' || t === 'idle') return '시트 연결 전';
      if (t === 'first') return '☁️ 첫 동기화 중…';
      if (t === 'saving') return '☁️ 저장 중…';
      if (t === 'sync') return '☁️ 다른 기기 변경 확인 중…';
      if (t === 'error') return '⚠️ ' + (ST.lastErr || '동기화 실패');
      return '☁️ 동기화됨';
    },
    ssoSession: ssoSession, unwrap: unwrapFor, wrapMint: wrapMint, hasKek: hasKek,
    wrapKey: function () { return K_WRAP; }
  };
})(window);
