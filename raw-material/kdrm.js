/* 경덕농수산 원물정보 · 생산일지 — 공용 엔진 (암호화 · 구글 시트 동기화 · 포털 1회 로그인)
   ─────────────────────────────────────────────────────────────────────
   · 두 앱(원물정보 /raw-material/, 생산일지 /production-log/)이 같은 파일을 쓴다.
   · 자료는 이 기기에서 AES-256-GCM 으로 잠가 localStorage 에 두고,
     구글 시트(Apps Script 웹앱)에는 암호문만 올린다. 평문 품목·원산지·유통기한은 시트에도 저장소에도 없다.
   · 자료 비밀번호는 포털 로그인 비밀번호에서 만든 열쇠(kdw-portal-kek)로 감싸 두어,
     통합포털에서 한 번 로그인하면 두 앱이 비밀번호를 묻지 않고 열린다.
*/
(function (global) {
  'use strict';

  /* ══════════ 설정 ══════════ */
  var SYNC_URL = 'https://script.google.com/macros/s/AKfycbzJ0kX5DkdEge9EAlFZV4aatCf2TftroKtTwFZFJDs4XNvPaLGc0pZB8xOfP6YoLDSb/exec';   /* 배포 뒤 실제 주소로 바꾼다 */
  var PBKDF2_ITER = 310000;
  var KEK_DB = 'kdw-portal-kek', KEK_STORE = 'kek';
  var PHOTO_DB = 'kdrm-photos', PHOTO_STORE = 'blobs';
  var LS = {
    wrap: 'kdrm.wrap.v1.',
    doc: 'kdrm.doc.v1.',
    rev: 'kdrm.rev.v1.',
    device: 'kdrm.device.v1',
    ai: 'kdrm.aikey.v1'
  };
  var PUSH_DELAY = 1500, POLL_MS = 45000;

  /* ══════════ 작은 도구 ══════════ */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function enc(s) { return new TextEncoder().encode(s); }
  function dec(b) { return new TextDecoder().decode(b); }
  function b64e(u8) {
    var s = '', n = u8.length, CH = 0x8000;
    for (var i = 0; i < n; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, n)));
    return btoa(s);
  }
  function b64d(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function uid(p) {
    return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayIso() { return isoDate(new Date()); }
  function fmtDateKo(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    var w = ['일', '월', '화', '수', '목', '금', '토'][new Date(+m[1], +m[2] - 1, +m[3]).getDay()];
    return m[1] + '년 ' + (+m[2]) + '월 ' + (+m[3]) + '일(' + w + ')';
  }
  function fmtDateShort(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? (m[1].slice(2) + '.' + m[2] + '.' + m[3]) : iso;
  }
  function parseShort(s) {
    var m = /^(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(String(s || '').trim());
    if (!m) return '';
    var y = +m[1]; if (y < 100) y += 2000;
    return y + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
  }
  function addMonths(iso, months) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m || !months) return '';
    var y = +m[1], mo = +m[2] - 1 + months, d = +m[3];
    var last = new Date(y, mo + 1, 0).getDate();
    return isoDate(new Date(y, mo, Math.min(d, last)));
  }
  function daysLeft(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    var t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    var n = new Date(); n.setHours(0, 0, 0, 0);
    return Math.round((t - n.getTime()) / 86400000);
  }

  /* 초성 검색 */
  var CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  function chosung(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xAC00 && c <= 0xD7A3) out += CHO[Math.floor((c - 0xAC00) / 588)];
      else out += str.charAt(i);
    }
    return out;
  }
  function normKey(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  function matchQuery(hay, q) {
    var h = normKey(hay), n = normKey(q);
    if (!n) return true;
    if (h.indexOf(n) >= 0) return true;
    return chosung(String(hay || '')).indexOf(n) >= 0;
  };

  /* ══════════ 암호화 ══════════ */
  function randBytes(n) { var u = new Uint8Array(n); crypto.getRandomValues(u); return u; }
  function deriveKey(pw, saltB64) {
    var salt = typeof saltB64 === 'string' ? b64d(saltB64) : saltB64;
    return crypto.subtle.importKey('raw', enc(String(pw)), 'PBKDF2', false, ['deriveKey']).then(function (km) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
        km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function seal(key, obj) {
    var iv = randBytes(12);
    var data = enc(JSON.stringify(obj));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data).then(function (ct) {
      return { iv: b64e(iv), ct: b64e(new Uint8Array(ct)) };
    });
  }
  function unseal(key, box) {
    if (!box || !box.iv || !box.ct) return Promise.reject(new Error('암호문이 없습니다'));
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(box.iv) }, key, b64d(box.ct))
      .then(function (buf) { return JSON.parse(dec(new Uint8Array(buf))); });
  }
  function sealText(key, text) {
    var iv = randBytes(12);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc(text)).then(function (ct) {
      return { iv: b64e(iv), ct: b64e(new Uint8Array(ct)) };
    });
  }
  function unsealText(key, box) {
    if (!box || !box.iv || !box.ct) return Promise.reject(new Error('암호문이 없습니다'));
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(box.iv) }, key, b64d(box.ct))
      .then(function (buf) { return dec(new Uint8Array(buf)); });
  }

  /* ══════════ 포털 세션 · 열쇠 ══════════ */
  function session() {
    try {
      var s = JSON.parse(localStorage.getItem('kd.portal.sso.v1') || 'null');
      if (!s || !s.userId) return null;
      if (s.exp && Date.now() > s.exp) return null;
      return s;
    } catch (e) { return null; }
  }
  function normId(id) { return String(id == null ? '' : id).trim().toLowerCase(); }

  function idbOpen(name, store) {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(name, 1);
      rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains(store)) rq.result.createObjectStore(store); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbGet(name, store, k) {
    return idbOpen(name, store).then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(store, 'readonly'), rq = tx.objectStore(store).get(k);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function idbPut(name, store, k, v) {
    return idbOpen(name, store).then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(v, k);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }
  function kekGet(id) { return idbGet(KEK_DB, KEK_STORE, 'u:' + normId(id)); }

  /* ══════════ 시트 API ══════════ */
  function api(payload, timeoutMs) {
    var ms = timeoutMs || 25000;
    if (!SYNC_URL || SYNC_URL.indexOf('PLACEHOLDER') >= 0) return Promise.reject(new Error('동기화 주소가 아직 없습니다'));
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(SYNC_URL, {
      method: 'POST', cache: 'no-store', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      clearTimeout(t);
      var j;
      try { j = JSON.parse(txt); } catch (e) { throw new Error('시트 응답을 읽지 못했습니다'); }
      if (!j || j.ok !== true) throw new Error((j && (j.error || j.message)) || '시트가 요청을 처리하지 못했습니다');
      return j;
    }).catch(function (e) { clearTimeout(t); throw e; });
  }

  /* ══════════ 문서 저장소 ══════════ */
  var DEV = (function () {
    var d = lsGet(LS.device);
    if (d && d.id) return d.id;
    var id = 'd' + Math.random().toString(36).slice(2, 8);
    lsSet(LS.device, { id: id });
    return id;
  })();

  function emptyDoc() { return { v: 1, at: 0, by: '', items: {}, stamp: {}, del: {} }; }

  function mergeDoc(local, remote) {
    var out = { v: 1, at: 0, by: '', items: {}, stamp: {}, del: {} };
    if (!local || !remote) return null;
    var ids = {}, k, changed = 0;
    (Object.keys(local.items || {})).forEach(function (i) { ids[i] = 1; });
    (Object.keys(remote.items || {})).forEach(function (i) { ids[i] = 1; });
    Object.keys(ids).forEach(function (id) {
      var ls = Number((local.stamp || {})[id]) || 0;
      var rs = Number((remote.stamp || {})[id]) || 0;
      var ldel = Number((local.del || {})[id]) || 0;
      var rdel = Number((remote.del || {})[id]) || 0;
      /* 삭제 표시도 같은 시각 비교에 넣는다 */
      var best = Math.max(ls, rs), src = null;
      if (ldel && ldel >= best) { src = 'del'; best = ldel; }
      if (rdel && rdel > best) { src = 'del'; best = rdel; }
      if (src === 'del') {
        out.del[id] = best;
        if (Number((local.del || {})[id]) !== best && Number((local.stamp || {})[id]) !== best && !ldel) changed++;
        return;
      }
      if (rs > ls) { out.items[id] = remote.items[id]; out.stamp[id] = rs; if (JSON.stringify(local.items[id]) !== JSON.stringify(remote.items[id])) changed++; }
      else { out.items[id] = local.items[id]; out.stamp[id] = ls; }
    });
    out.at = Math.max(Number(local.at) || 0, Number(remote.at) || 0);
    return { doc: out, changed: changed };
  }

  function Store(name) {
    this.name = name;
    this.key = null;
    this.password = null;
    this.salt = null;
    this.doc = null;
    this.rev = 0;
    this.status = 'idle';      /* idle|first|saving|sync|ok|error|off|locked */
    this.lastErr = '';
    this.busy = false;
    this.pending = false;
    this.timer = null;
    this.wait = null;
    this.hooks = {};
    this.photoCache = {};
  }
  Store.prototype = {
    ready: function () { return !!(this.key && SYNC_URL && SYNC_URL.indexOf('PLACEHOLDER') < 0); },

    /* ── 열기: 포털 열쇠로 감싼 비밀번호를 풀어 자료 열쇠를 만든다 ── */
    unlock: function () {
      var self = this, s = session();
      if (!s) return Promise.resolve({ ok: false, reason: 'nosession' });
      this.userId = normId(s.userId);
      this.userName = s.name || s.userId;
      var localWrap = lsGet(LS.wrap + this.userId);
      return kekGet(this.userId).then(function (k) {
        if (!k || !k.key) return { reason: 'nokek' };
        function tryBox(box) {
          if (!box || !box.iv || !box.ct) return Promise.resolve(null);
          return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(box.iv) }, k.key, b64d(box.ct))
            .then(function (buf) { return JSON.parse(dec(new Uint8Array(buf))); })
            .catch(function () { return null; });
        }
        return tryBox(localWrap).then(function (o) {
          if (o && o.pw) return o;
          return api({ action: 'key_get', id: self.userId }).then(function (j) {
            if (!j.found) return null;
            var box = { iv: j.iv, ct: j.ct };
            return tryBox(box).then(function (o2) {
              if (o2 && o2.pw) { lsSet(LS.wrap + self.userId, box); return o2; }
              return null;
            });
          }).catch(function () { return null; });
        });
      }).then(function (o) {
        if (!o || !o.pw) return { ok: false, reason: 'needauth' };
        self.password = o.pw;
        self.salt = o.salt;
        return deriveKey(o.pw, o.salt).then(function (key) { self.key = key; return { ok: true }; });
      });
    },

    /* ── 처음 시작: 자료 비밀번호를 만들어 열쇠로 감싸 둔다 ── */
    initNew: function (pw) {
      var self = this, s = session();
      if (!s) return Promise.reject(new Error('포털 로그인이 필요합니다'));
      this.userId = normId(s.userId);
      this.userName = s.name || s.userId;
      var pass = pw || randPassword();
      var salt = b64e(randBytes(16));
      return deriveKey(pass, salt).then(function (key) {
        self.key = key; self.password = pass; self.salt = salt;
        self.doc = emptyDoc();
        return self.mintWrap(pass, salt);
      });
    },

    /* 비밀번호를 새로 넣어 기존 자료를 연다 (다른 기기·직원) */
    unlockWith: function (pw) {
      var self = this, s = session();
      if (!s) return Promise.resolve({ ok: false, reason: 'nosession' });
      this.userId = normId(s.userId);
      this.userName = s.name || s.userId;
      return api({ action: 'get', doc: self.name }).then(function (j) {
        var salt = j.salt || '';
        if (!salt) return { ok: false, reason: 'nodata' };
        return deriveKey(pw, salt).then(function (key) {
          return unseal(key, { iv: j.iv, ct: j.ct }).then(function (doc) {
            self.key = key; self.password = pw; self.salt = salt;
            self.doc = doc; self.rev = Number(j.rev) || 0;
            return self.mintWrap(pw, salt).then(function () { return { ok: true }; });
          }).catch(function () { return { ok: false, reason: 'badpw' }; });
        });
      }).catch(function (e) { return { ok: false, reason: 'error', error: String(e && e.message || e) }; });
    },

    mintWrap: function (pw, salt) {
      var self = this;
      return kekGet(this.userId).then(function (k) {
        if (!k || !k.key) return false;
        var iv = randBytes(12);
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k.key, enc(JSON.stringify({ v: 1, pw: pw, salt: salt, at: Date.now() })))
          .then(function (ct) {
            var box = { iv: b64e(iv), ct: b64e(new Uint8Array(ct)) };
            lsSet(LS.wrap + self.userId, box);
            return api({ action: 'key_put', id: self.userId, iv: box.iv, ct: box.ct }).then(function () { return true; }).catch(function () { return false; });
          });
      }).catch(function () { return false; });
    },

    /* ── 이 기기 저장(암호문) ── */
    saveLocal: function () {
      if (!this.key || !this.doc) return Promise.resolve(false);
      var self = this;
      return seal(this.key, { salt: this.salt, doc: this.doc }).then(function (box) {
        lsSet(LS.doc + self.name, { salt: self.salt, iv: box.iv, ct: box.ct, at: Date.now() });
        return true;
      }).catch(function () { return false; });
    },
    loadLocal: function () {
      var self = this;
      var box = lsGet(LS.doc + this.name);
      if (!box || !this.key) return Promise.resolve(null);
      return unseal(this.key, box).then(function (o) {
        self.salt = o.salt || self.salt;
        return o.doc || null;
      }).catch(function () { return null; });
    },

    /* ── 시트 ── */
    pull: function (force) {
      if (!this.ready()) return Promise.resolve(0);
      var self = this;
      return api({ action: 'get', doc: this.name }).then(function (j) {
        if (!j.iv) { self.rev = Number(j.rev) || 0; return 0; }
        if (!force && Number(j.rev) === self.rev && self.doc) return 0;
        return unseal(self.key, { iv: j.iv, ct: j.ct }).then(function (remote) {
          var m = mergeDoc(self.doc || emptyDoc(), remote);
          self.rev = Number(j.rev) || 0;
          if (!m) return 0;
          if (m.changed || !self.doc) { self.doc = m.doc; return self.saveLocal().then(function () { return Math.max(1, m.changed); }); }
          return 0;
        });
      }).catch(function (e) {
        self.lastErr = errText(e);
        if (/OperationError/i.test(String(e && e.name))) self.lastErr = '다른 비밀번호로 잠긴 자료입니다';
        self.status = 'error';
        if (self.hooks.paint) self.hooks.paint();
        return 0;
      });
    },

    push: function () {
      if (!this.ready() || !this.doc) return Promise.resolve(false);
      if (this.busy) { this.pending = true; return Promise.resolve(false); }
      var self = this;
      this.busy = true;
      this.pending = false;
      this.status = 'saving';
      if (this.hooks.paint) this.hooks.paint();
      var attempt = 0;
      function step() {
        attempt++;
        return seal(self.key, self.doc).then(function (box) {
          return api({ action: 'put', doc: self.name, baseRev: self.rev, by: DEV, n: Object.keys(self.doc.items || {}).length, salt: self.salt, iv: box.iv, ct: box.ct });
        }).then(function (j) {
          if (j.ok) { self.rev = Number(j.rev) || self.rev; self.lastErr = ''; self.status = 'ok'; return true; }
          return false;
        }).catch(function (e) {
          if (String(e && e.message).indexOf('conflict') >= 0 && attempt <= 3) {
            return self.pull(true).then(step);
          }
          self.lastErr = errText(e);
          self.status = 'error';
          throw e;
        });
      }
      return step().catch(function () { return false; }).then(function (ok) {
        self.busy = false;
        if (self.hooks.paint) self.hooks.paint();
        if (self.pending) { self.pending = false; return self.push(); }
        return ok;
      });
    },

    start: function () {
      var self = this;
      if (!SYNC_URL || SYNC_URL.indexOf('PLACEHOLDER') >= 0) { this.status = 'off'; this.paint(); return; }
      this.paint();
      this.loadLocal().then(function (local) {
        if (local) self.doc = local;
        return self.pull(true);
      }).then(function () {
        if (!self.doc) { self.doc = emptyDoc(); }
        if (!self.doc.items) self.doc.items = {};
        if (self.hooks.afterPull) self.hooks.afterPull();
        self.status = 'ok'; self.paint();
        if (!self.rev) self.push();
      });
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(function () {
        if (document.visibilityState !== 'visible') return;
        if (self.pending) { self.push(); return; }
        self.pull(false).then(function (n) { if (n && self.hooks.afterPull) self.hooks.afterPull(); });
      }, POLL_MS);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (self.pending) self.push();
        else self.pull(false).then(function (n) { if (n && self.hooks.afterPull) self.hooks.afterPull(); });
      });
    },

    touch: function (id) {
      if (!this.doc) return;
      if (!this.doc.stamp) this.doc.stamp = {};
      this.doc.stamp[id] = Date.now();
      this.doc.at = Date.now();
      this.doc.by = DEV;
      this.saveLocal();
      this.pending = true;
      var self = this;
      if (this.wait) clearTimeout(this.wait);
      this.wait = setTimeout(function () { self.wait = null; self.push(); }, PUSH_DELAY);
    },

    put: function (item) {
      var self = this;
      return new Promise(function (res) {
        if (!item.id) item.id = uid('i');
        item.updatedAt = Date.now();
        if (!self.doc) self.doc = emptyDoc();
        self.doc.items[item.id] = item;
        if (self.doc.del) delete self.doc.del[item.id];
        self.touch(item.id);
        res(item);
      });
    },
    remove: function (id) {
      if (!this.doc) return;
      delete this.doc.items[id];
      if (!this.doc.del) this.doc.del = {};
      this.doc.del[id] = Date.now();
      this.saveLocal();
      this.pending = true;
      var self = this;
      if (this.wait) clearTimeout(this.wait);
      this.wait = setTimeout(function () { self.wait = null; self.push(); }, PUSH_DELAY);
    },
    list: function () {
      if (!this.doc) return [];
      var out = [];
      Object.keys(this.doc.items || {}).forEach(function (k) { out.push(this.doc.items[k]); }, this);
      return out;
    },
    get: function (id) { return (this.doc && this.doc.items) ? this.doc.items[id] : null; },

    paint: function () {
      if (this.hooks.paint) this.hooks.paint(this.status, this.lastErr);
    },
    statusText: function () {
      var t = this.status;
      if (t === 'off') return '시트 연결 전';
      if (t === 'idle') return '☁️ 준비 중';
      if (t === 'saving') return '☁️ 저장 중…';
      if (t === 'sync') return '☁️ 확인 중…';
      if (t === 'error') return '⚠️ ' + (this.lastErr || '동기화 실패');
      if (t === 'locked') return '🔒 잠김';
      return '☁️ 동기화됨';
    },

    /* ── 사진(암호화) ── */
    putPhoto: function (id, text) {
      var self = this;
      if (!this.key) return Promise.resolve(false);
      return sealText(this.key, text).then(function (box) {
        return api({ action: 'blob_put', id: id, iv: box.iv, ct: box.ct, n: text.length });
      }).then(function () { return true; }).catch(function () { return false; });
    },
    getPhoto: function (id) {
      var self = this;
      if (!this.key) return Promise.resolve('');
      if (this.photoCache[id]) return Promise.resolve(this.photoCache[id]);
      return idbGet(PHOTO_DB, PHOTO_STORE, id).then(function (rec) {
        if (rec === 'gone') return '';
        if (rec && rec.iv) {
          return unsealText(self.key, rec).then(function (t) { self.photoCache[id] = t; return t; }).catch(function () { return ''; });
        }
        return api({ action: 'blob_get', id: id }).then(function (j) {
          if (!j.found) return '';
          var box = { iv: j.iv, ct: j.ct };
          return unsealText(self.key, box).then(function (t) {
            self.photoCache[id] = t;
            idbPut(PHOTO_DB, PHOTO_STORE, id, box);
            return t;
          }).catch(function () { return ''; });
        }).catch(function () { return ''; });
      });
    },
    cachePhoto: function (id, text, box) {
      this.photoCache[id] = text;
      if (box) idbPut(PHOTO_DB, PHOTO_STORE, id, box);
    }
  };

  function errText(e) {
    var s = String((e && e.message) || e || '');
    if (/abort/i.test(s)) return '시간 초과';
    if (/Failed to fetch|NetworkError|Load failed/i.test(s)) return '인터넷 연결 없음';
    return s || '알 수 없는 오류';
  }
  function randPassword() {
    var A = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
    var u = randBytes(16);
    for (var i = 0; i < 16; i++) s += A.charAt(u[i] % A.length);
    return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16);
  }

  /* ══════════ 화면 공통 ══════════ */
  var toastTimer = null;
  function toast(txt, isErr) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = txt;
    t.className = 'toast on' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (isErr ? ' err' : ''); }, 2800);
  }
  function portalUrl() {
    var p = (session() && session().portal) || '/';
    try { return new URL(p, location.href).href; } catch (e) { return '/'; }
  }
  function goPortal() { location.href = portalUrl(); }

  /* 사진 줄이기 (긴 변 maxPx, JPEG) */
  function shrinkImage(file, maxPx, quality) {
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, (maxPx || 1400) / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        var out;
        try { out = c.toDataURL('image/jpeg', quality || 0.72); } catch (e) { rej(e); return; }
        res({ dataUrl: out, w: cw, h: ch });
      };
      img.onerror = function (e) { URL.revokeObjectURL(url); rej(e); };
      img.src = url;
    });
  }

  global.KD = {
    SYNC_URL: SYNC_URL,
    $: $, $$: $$, esc: esc, uid: uid, toast: toast,
    isoDate: isoDate, todayIso: todayIso, fmtDateKo: fmtDateKo, fmtDateShort: fmtDateShort, parseShort: parseShort,
    addMonths: addMonths, daysLeft: daysLeft, chosung: chosung, matchQuery: matchQuery, normKey: normKey,
    session: session, kekGet: kekGet, portalUrl: portalUrl, goPortal: goPortal,
    deriveKey: deriveKey, seal: seal, unseal: unseal, sealText: sealText, unsealText: unsealText,
    api: api, Store: Store, dev: DEV, shrinkImage: shrinkImage,
    lsGet: lsGet, lsSet: lsSet, lsDel: lsDel, b64e: b64e, b64d: b64d,
    LS: LS, randPassword: randPassword, errText: errText
  };
})(window);
