/* 경덕농수산 상품단가표 — core: 암호화·저장·계산 엔진 */
(function (global) {
  'use strict';

  /* ══════════ 작은 도구 ══════════ */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nfmt(n) {
    if (n == null || n === '' || isNaN(n)) return '-';
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function wfmt(kg) {
    if (kg == null || kg === '') return '';
    var g = Math.round(kg * 1000);
    if (g >= 1000) return (g / 1000) + 'kg';
    return g + 'g';
  }
  function pct(n) { return (n == null || isNaN(n)) ? '-' : (Math.round(n * 10) / 10) + '%'; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  function b64d(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64e(u8) {
    var s = '', n = u8.length, CH = 0x8000;
    for (var i = 0; i < n; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, n)));
    return btoa(s);
  }
  function enc(str) { return new TextEncoder().encode(str); }
  function dec(buf) { return new TextDecoder().decode(buf); }

  /* ══════════ 엑셀 호환 반올림 ══════════ */
  function rUp(x, d) {
    if (x == null || isNaN(x)) return null;
    var m = Math.pow(10, -d), v = Math.round((x / m) * 1e9) / 1e9;
    return Math.sign(v) * Math.ceil(Math.abs(v) - 1e-9) * m;
  }
  function rNd(x, d) {
    if (x == null || isNaN(x)) return null;
    var m = Math.pow(10, -d), v = Math.round((x / m) * 1e9) / 1e9;
    return Math.sign(v) * Math.floor(Math.abs(v) + 0.5 + 1e-9) * m;
  }
  function rDn(x, d) {
    if (x == null || isNaN(x)) return null;
    var m = Math.pow(10, -d), v = Math.round((x / m) * 1e9) / 1e9;
    return Math.sign(v) * Math.floor(Math.abs(v) + 1e-9) * m;
  }
  var PACK_FEE = { '케이스': 500, '박스': 1000, '팩': 500 };
  function tierRate(wt) {
    if (wt == null) return null;
    if (wt >= 1) return 1.30;
    if (wt >= 0.5) return 1.40;
    if (wt >= 0.3) return 1.45;
    if (wt >= 0.1) return 1.50;
    return 1.60;
  }

  /* ══════════ 계산 엔진 (엑셀 수식과 동일) ══════════ */
  function calc(o, ch) {
    var kind = o.cost_kind || 'pack';
    var cost;
    if (kind === 'fixv') cost = (o.empty_fee == null ? null : o.empty_fee);
    else if (kind === 'fix') cost = null;
    else if (kind === 'mul') cost = (o.kg || 0) * (o.wt || 0);
    else if (kind === 'round2') cost = rNd((o.kg || 0) * (o.wt || 0), -2);
    else {
      var fee = PACK_FEE[o.pack];
      if (fee == null) fee = (o.empty_fee || 0);
      cost = (o.kg || 0) * (o.wt || 0) + fee;
    }
    var dig = (o.qdig == null ? -1 : o.qdig);
    var rate = o.auto ? tierRate(o.wt) : o.rate;
    var q;
    if (o.fixQ != null) q = o.fixQ;
    else if (o.fixR != null) {
      var v = o.fixR * (o.qmul == null ? 1 : o.qmul);
      q = o.qkind === 'down' ? rDn(v, dig) : (o.qkind === 'round' ? rNd(v, dig) : rUp(v, dig));
    } else if (o.qsrc === 'fix' || cost == null) q = null;
    else if (o.qsrc === 'r') q = rUp(cost * (o.qmul || 1), dig);
    else q = rUp(cost * (rate || 1), dig);
    var rkind = o.rkind === undefined ? (o.rval != null ? null : 'up') : o.rkind;
    var rdiv = o.rdiv == null ? 0.77 : o.rdiv;
    var rdig = o.rdig == null ? -1 : o.rdig;
    var r;
    if (!rkind) r = (o.rval == null ? null : o.rval);
    else if (rkind === 'up') r = q == null ? null : rUp(q / rdiv, rdig);
    else if (rkind === 'round') r = q == null ? null : rNd(q / rdiv, rdig);
    else if (rkind === 'rounddown') r = q == null ? null : rDn(q / rdiv, rdig);
    else r = q == null ? null : rUp(q * rdiv, rdig);
    var feeN = o.fee;
    var w = (q != null && feeN) ? q * feeN : null;
    var ssrc = (o.ssrc === 'x' ? 'w' : o.ssrc);
    var sdiv = o.sdiv == null ? 0.83 : o.sdiv;
    var sdig = o.sdig == null ? -1 : o.sdig;
    var s;
    if (!ssrc) s = (o.sval == null ? null : o.sval);
    else if (ssrc === 'q') s = q == null ? null : rNd(q / sdiv, sdig);
    else if (ssrc === 'w') s = w != null ? rNd(w / sdiv, sdig) : (q == null ? null : rNd(q / 0.83, -1));
    else s = null;
    return { cost: cost, q: q, r: r, s: s, w: w, rate: rate };
  }

  /* 하나로마트(구례축협) 모델 */
  function calcHana(o) {
    var e = (o.kg || 0) * (o.wt || 0);
    var g = (o.wt === 1.5) ? 0 : rUp(o.mat === '비닐' ? e * 0.05 : e * 0.05 + 1000, -1);
    var h = e + g;
    var j = rUp(h * (1 + (o.im == null ? 0.3 : o.im)), -2);
    var l = rUp(j / (1 - (o.vm == null ? 0.23 : o.vm)), -2);
    return { cost: h, q: j, r: l, g: g, e: e, m: o.wt ? l / o.wt / 100 : null };
  }

  /* ══════════ 암호화 ══════════ */
  var IDB_NAME = 'kdw-price', IDB_STORE = 'keys';
  function idbOpen() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(IDB_NAME, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(IDB_STORE); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbGet(k) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(IDB_STORE, 'readonly'), rq = tx.objectStore(IDB_STORE).get(k);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function idbPut(k, v) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(v, k);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }
  function idbDel(k) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(k);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }

  function pbkdf2Key(pw, salt, it) {
    if (!(global.crypto && crypto.subtle)) return Promise.reject(new Error('이 브라우저에서는 암호화를 쓸 수 없습니다'));
    return crypto.subtle.importKey('raw', enc(pw), 'PBKDF2', false, ['deriveKey'])
      .then(function (km) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: it, hash: 'SHA-256' },
          km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }
  function aesDecrypt(key, iv, ct) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
  }
  function aesEncrypt(key, iv, data) {
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
  }
  function gunzip(u8) {
    if (typeof DecompressionStream === 'undefined') return Promise.resolve(null);
    var ds = new DecompressionStream('gzip');
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function gzip(u8) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    var cs = new CompressionStream('gzip');
    var stream = new Blob([u8]).stream().pipeThrough(cs);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  /* 헤더 파일 열기 → {key, payload}  (key 를 주면 비밀번호 없이 그 열쇠로 푼다) */
  function openBundle(header, pw, readyKey) {
    var iv = b64d(header.iv), ct = b64d(header.ct);
    var keyStep = readyKey ? Promise.resolve(readyKey)
      : pbkdf2Key(pw, b64d(header.salt), header.it || 310000);
    return keyStep.then(function (key) {
      return aesDecrypt(key, iv, ct).then(function (buf) {
        var u8 = new Uint8Array(buf);
        var step = header.zip === 'gzip' ? gunzip(u8) : Promise.resolve(u8);
        return step.then(function (plain) {
          if (!plain) throw new Error('이 브라우저에서는 자료를 풀 수 없습니다. Chrome·삼성 인터넷 최신 버전으로 열어 주세요.');
          return { key: key, payload: JSON.parse(dec(plain)) };
        });
      });
    });
  }
  /* 같은 열쇠로 저장/불러오기 (localStorage 암호문) */
  function sealJSON(key, obj, zipIt) {
    var raw = enc(JSON.stringify(obj));
    var step = zipIt ? gzip(raw) : Promise.resolve(null);
    return step.then(function (z) {
      var data = z || raw;
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return aesEncrypt(key, iv, data).then(function (ct) {
        return { v: 1, zip: z ? 'gzip' : '', iv: b64e(iv), ct: b64e(new Uint8Array(ct)) };
      });
    });
  }
  function unsealJSON(key, box) {
    var iv = b64d(box.iv), ct = b64d(box.ct);
    return aesDecrypt(key, iv, ct).then(function (buf) {
      var u8 = new Uint8Array(buf);
      var step = box.zip === 'gzip' ? gunzip(u8) : Promise.resolve(u8);
      return step.then(function (plain) {
        if (!plain) throw new Error('압축 해제를 지원하지 않는 브라우저입니다');
        return JSON.parse(dec(plain));
      });
    });
  }

  global.PMCore = {
    $: $, $$: $$, esc: esc, nfmt: nfmt, wfmt: wfmt, pct: pct, clamp: clamp, debounce: debounce,
    b64d: b64d, b64e: b64e, enc: enc, dec: dec,
    rUp: rUp, rNd: rNd, rDn: rDn, tierRate: tierRate, PACK_FEE: PACK_FEE,
    calc: calc, calcHana: calcHana,
    idbGet: idbGet, idbPut: idbPut, idbDel: idbDel,
    openBundle: openBundle, sealJSON: sealJSON, unsealJSON: unsealJSON, pbkdf2Key: pbkdf2Key
  };
})(window);
