/* ============================================================
   경덕 통합 보안 클라이언트 (KDWSEC)
   포털·발주·업무일지·근태·택배·쿠팡·단가·원물·생산일지가 함께 쓴다.
   2026-11-27 보안 강화
     · 로그인은 서버(Apps Script)가 확인하고 서명 토큰을 발급한다. 토큰 없이는 자료 API 를 못 쓴다.
     · 30분 동안 아무것도 안 하면 자동 로그아웃.
     · 메뉴 권한이 없는 화면 주소를 직접 쳐서 들어오면 포털 로그인으로 돌려보낸다.
     · 처음 비밀번호(예: admin1234)로 들어오면 비밀번호를 바꾸기 전까지 화면을 막는다.
   ============================================================ */
(function (win) {
  'use strict';

  var AUTH_URL = 'https://script.google.com/macros/s/AKfycbx8vtZ9wxfqwEUhuIC5hhV5dncN7IbVmrbjbPS93hfibfXAxMpwx-YtCGiqHeZXfEY81Q/exec';
  var KEY = 'kd.sec.v1';              /* 공유 세션 (같은 주소의 모든 앱이 함께 본다) */
  var KEY_DEV = 'kd.sec.dev.v1';
  var IDLE_MS = 30 * 60 * 1000;       /* 30분 미사용 → 자동 로그아웃 */
  var TICK_MS = 20 * 1000;

  var MENU_LABEL = { order:'발주화면', worklog:'업무일지', attendance:'근태·연차', parcel:'택배주소출력',
                     coupang:'쿠팡택배', price:'상품단가', shop:'쇼핑몰', raw:'원물정보', prod:'생산일지' };

  function ls(k, v) { try { if (v === undefined) return win.localStorage.getItem(k); win.localStorage.setItem(k, v); } catch (e) { return null; } }
  function lrm(k) { try { win.localStorage.removeItem(k); } catch (e) {} }
  function device() {
    var d = ls(KEY_DEV);
    if (!d) {
      d = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      ls(KEY_DEV, d);
    }
    return d;
  }
  function ua() { return (navigator.userAgent || '').slice(0, 90); }

  function read() {
    var raw = ls(KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function write(s) { try { ls(KEY, JSON.stringify(s)); } catch (e) {} }

  function session() {
    var s = read();
    if (!s || !s.token) return null;
    if (!s.exp || Number(s.exp) < Date.now()) return null;
    return s;
  }
  function user() { var s = read(); return s ? s.user || null : null; }
  function token() { var s = session(); return s ? s.token : ''; }
  function isAdmin() { var u = user(); return !!u && String(u.role || '') === 'admin'; }
  function menus() {
    var u = user();
    if (!u) return [];
    if (isAdmin()) return Object.keys(MENU_LABEL);
    if (Array.isArray(u.menus)) return u.menus.slice();
    return ['order'];
  }
  function canUse(menu) {
    if (!menu) return true;
    return menus().indexOf(String(menu)) >= 0;
  }

  /* ---------- 통신 ---------- */
  function post(payload) {
    var body = Object.assign({}, payload);
    var s = session();
    if (s) { body.token = s.token; }
    body.ua = ua();
    body.dev = device();
    return fetch(AUTH_URL, {
      method: 'POST', cache: 'no-store', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('서버 응답을 읽지 못했습니다'); }
      return j || {};
    });
  }

  /* 토큰이 필요한 호출 — 만료·위조면 세션을 지우고 로그인 화면으로 보낸다 */
  function api(payload) {
    if (!session()) return Promise.reject(mkErr('no_session'));
    return post(payload).then(function (j) {
      if (j && j.needLogin) { clear(); redirectLogin(); throw mkErr(j.error || 'need_login'); }
      if (j && j.ok === false) { var e = mkErr(j.error || 'failed'); e.data = j; throw e; }
      return j;
    });
  }
  function mkErr(code) { var e = new Error(code); e.code = code; return e; }

  function get(params) {
    var q = [];
    var s = session();
    if (s) q.push('token=' + encodeURIComponent(s.token));
    q.push('_=' + Date.now());
    for (var k in params) { if (params[k] !== undefined && params[k] !== null) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k])); }
    return fetch(AUTH_URL + '?' + q.join('&'), { cache: 'no-store', redirect: 'follow' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j; try { j = JSON.parse(t); } catch (e) { throw mkErr('bad_json'); }
        if (j && j.needLogin) { clear(); redirectLogin(); throw mkErr('need_login'); }
        return j;
      });
  }

  /* ---------- 로그인 ---------- */
  function login(id, pw, opts) {
    opts = opts || {};
    return post({ action: 'login', id: String(id || ''), pw: String(pw || ''), app: opts.app || '' })
      .then(function (j) {
        if (!j || j.ok !== true) return j || { ok: false, error: 'failed' };
        var s = {
          token: j.token, exp: j.exp, at: Date.now(), dev: device(),
          user: j.user, salt: j.salt || '', hash: j.hash || '', hashes: j.hashes || {}
        };
        write(s);
        clearBounce();
        startIdle();
        return j;
      });
  }

  function update(patch) {
    var s = read();
    if (!s) return;
    for (var k in patch) s[k] = patch[k];
    s.at = Date.now();
    write(s);
  }

  function logout(opts) {
    opts = opts || {};
    var s = session();
    var p = s ? post({ action: 'logout', token: s.token }) : Promise.resolve();
    clear();
    if (!opts.silent && !opts.stay) redirectLogin();
    return p;
  }

  /* 세션(토큰)을 지울 때는 이 기기의 '로그인됨' 흔적을 함께 지운다.
     흔적만 남으면 포털은 로그인된 줄 알고 앱은 토큰이 없어 되돌려보내,
     포털 ↔ 앱 무한 왕복(깜빡임·멈춤)이 생긴다. (2026-11-27 장애 대응) */
  var SESS_KEYS = ['kd.portal.sso.v1', 'kd.portal.session.v1', 'kd.portal.session.tmp.v1',
                   'kd.session.v1', 'kd.session.tmp.v1',
                   'kdw.session.v1', 'kdw.session.tmp.v1',
                   'att.session.v1', 'att.session.tmp.v1',
                   'pl.session.v1', 'cp.session.v1', 'pm.session.v1', 'rm.session.v1', 'prod.session.v1'];
  function clear() {
    lrm(KEY);
    for (var i = 0; i < SESS_KEYS.length; i++) {
      lrm(SESS_KEYS[i]);
      try { win.sessionStorage.removeItem(SESS_KEYS[i]); } catch (e) {}
    }
  }

  /* ---------- 왕복(깜빡임) 감지 ----------
     앱과 포털이 서로 되돌려보내는 일이 반복되면 자동 이동을 멈춘다. */
  var BOUNCE_KEY = 'kd.sec.bounce.v1';
  function bounceRead() {
    try {
      var o = JSON.parse(win.sessionStorage.getItem(BOUNCE_KEY) || 'null');
      if (!o || !Array.isArray(o.t)) return [];
      return o.t;
    } catch (e) { return []; }
  }
  function bounceMark() {
    try {
      var now = Date.now(), list = bounceRead().filter(function (x) { return now - x < 10000; });
      list.push(now);
      win.sessionStorage.setItem(BOUNCE_KEY, JSON.stringify({ t: list }));
    } catch (e) {}
  }
  function bounces(withinMs) {
    var now = Date.now(), ms = withinMs || 10000, n = 0;
    bounceRead().forEach(function (x) { if (now - x < ms) n++; });
    return n;
  }
  function bouncedRecently(withinMs) { return bounces(withinMs || 6000) > 0; }
  function clearBounce() { try { win.sessionStorage.removeItem(BOUNCE_KEY); } catch (e) {} }

  /* ---------- 로그인 화면으로 ---------- */
  function portalBase() {
    /* /order-app/, /portal/price-manager/ 등 어디서 불러도 포털 뿌리 */
    var p = location.pathname || '/';
    var m = p.match(/^\/([^\/]+)\//);
    return '/';
  }
  function loginUrl(need, denied, extra) {
    var q = [];
    if (need) q.push('need=' + encodeURIComponent(need));
    if (denied) q.push('denied=' + encodeURIComponent(denied));
    if (extra && extra.stop) q.push('stop=1');
    if (extra && extra.idle) q.push('idle=1');
    return '/' + (q.length ? '?' + q.join('&') : '');
  }
  function onPortal() {
    return location.pathname.replace(/index\.html$/, '') === '/' || /\/(portal)\/$/.test(location.pathname);
  }
  function redirectLogin(extra) {
    if (onPortal()) {
      /* 포털에서 서버가 '다시 로그인'이라 하면 화면을 새로 그려 로그인 창을 띄운다 */
      if (extra && extra.keep) return;
      location.reload();
      return;
    }
    location.replace(loginUrl((extra && extra.need) || '', (extra && extra.denied) || '', extra));
  }

  /* ---------- 화면 지킴 ---------- */
  /* menu: 'order' 등 / 스크린(선택): 막을 때 보여 줄 요소
     - 토큰이 없거나 권한이 없으면 포털 로그인 화면으로 되돌린다.
     - 되돌아가는 일이 반복되면 stop=1 로 보내 포털이 다시 앱으로 보내지 않게 한다. (무한 왕복 차단) */
  function guard(menu) {
    var s = session();
    if (!s) {
      clear();                      /* 만료·없는 토큰의 흔적을 지운다 */
      var stop = bounces(10000) >= 2;
      bounceMark();
      location.replace(loginUrl(menu || '', '', { stop: stop }));
      return false;
    }
    if (menu && !canUse(menu)) {
      var stop2 = bounces(10000) >= 2;
      bounceMark();
      location.replace(loginUrl('', menu, { stop: stop2 }));
      return false;
    }
    clearBounce();
    startIdle();
    return true;
  }

  /* ---------- 30분 미사용 자동 로그아웃 ---------- */
  var idleTimer = null;
  var lastTouch = 0;
  function touch() {
    var now = Date.now();
    if (now - lastTouch < 5000) return;
    lastTouch = now;
    var s = read();
    if (!s) return;
    s.at = now;
    write(s);
  }
  function startIdle() {
    if (idleTimer) return;
    ['click', 'keydown', 'touchstart', 'mousemove', 'scroll'].forEach(function (ev) {
      win.addEventListener(ev, touch, { passive: true });
    });
    idleTimer = setInterval(function () {
      var s = read();
      if (!s) return;
      var at = Number(s.at) || 0;
      if (Date.now() - at > IDLE_MS) {
        clear();
        showIdleNotice();
      }
    }, TICK_MS);
  }
  function showIdleNotice() {
    try {
      if (win.__kdwIdleShown) return;
      win.__kdwIdleShown = true;
      alert('30분 동안 사용하지 않아 자동으로 로그아웃했습니다.\n보안을 위해 다시 로그인해 주세요.');
    } catch (e) {}
    clear();
    location.replace('/?idle=1&t=' + Date.now());   /* 포털 로그인 화면으로 (자동 로그아웃 안내와 함께) */
  }

  /* ---------- 처음 비밀번호 강제 변경 ---------- */
  function needChange() {
    var u = user();
    return !!(u && u.mustChange === true);
  }
  /* 화면 위에 변경 창을 띄우고, 바꾸기 전에는 앱을 못 쓰게 한다 */
  function forceChange(opts) {
    opts = opts || {};
    if (!needChange()) return false;
    var box = document.createElement('div');
    box.id = 'kdwMustChange';
    box.setAttribute('style', [
      'position:fixed;inset:0;z-index:2147483000;background:rgba(12,18,26,.72)',
      'display:flex;align-items:center;justify-content:center;padding:18px',
      'font-family:Pretendard,-apple-system,BlinkMacSystemFont,system-ui,sans-serif'
    ].join(';'));
    box.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:22px 20px;box-shadow:0 18px 44px rgba(0,0,0,.28)">' +
      '<div style="font-size:17px;font-weight:800;color:#0f2a1d;margin-bottom:6px">비밀번호를 바꿔 주세요</div>' +
      '<div style="font-size:13px;line-height:1.55;color:#4a5a52;margin-bottom:14px">' +
      '지금은 처음 받은 비밀번호입니다. 바꾸기 전에는 다른 화면을 쓸 수 없습니다.</div>' +
      '<input id="kdwCurPw" type="password" autocomplete="current-password" placeholder="지금 비밀번호" ' +
      'style="width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cfd8d2;border-radius:10px;font-size:15px;margin-bottom:8px">' +
      '<input id="kdwNewPw" type="password" autocomplete="new-password" placeholder="새 비밀번호 (8자 이상)" ' +
      'style="width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cfd8d2;border-radius:10px;font-size:15px;margin-bottom:8px">' +
      '<input id="kdwNewPw2" type="password" autocomplete="new-password" placeholder="새 비밀번호 한 번 더" ' +
      'style="width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cfd8d2;border-radius:10px;font-size:15px;margin-bottom:10px">' +
      '<div id="kdwPwMsg" style="font-size:12.5px;color:#c0392b;min-height:18px;margin-bottom:6px"></div>' +
      '<button id="kdwPwOk" style="width:100%;padding:12px;border:0;border-radius:10px;background:#126b45;color:#fff;font-size:15px;font-weight:800;cursor:pointer">비밀번호 바꾸기</button>' +
      '<button id="kdwPwOut" style="width:100%;margin-top:8px;padding:9px;border:0;background:none;color:#7b8a83;font-size:13px;cursor:pointer">로그아웃</button>' +
      '</div>';
    document.body.appendChild(box);
    var msg = box.querySelector('#kdwPwMsg');
    box.querySelector('#kdwPwOut').onclick = function () { logout(); };
    box.querySelector('#kdwPwOk').onclick = function () {
      var cur = box.querySelector('#kdwCurPw').value;
      var a = box.querySelector('#kdwNewPw').value;
      var b = box.querySelector('#kdwNewPw2').value;
      if (!cur || !a) { msg.textContent = '지금 비밀번호와 새 비밀번호를 넣어 주세요'; return; }
      if (a.length < 8) { msg.textContent = '새 비밀번호는 8자 이상으로 넣어 주세요'; return; }
      if (a !== b) { msg.textContent = '새 비밀번호가 서로 다릅니다'; return; }
      msg.style.color = '#4a5a52';
      msg.textContent = '바꾸는 중…';
      post({ action: 'password', oldPw: cur, newPw: a }).then(function (j) {
        if (!j || j.ok !== true) {
          msg.style.color = '#c0392b';
          msg.textContent = (j && j.message) || '바꾸지 못했습니다';
          return;
        }
        var s = read() || {};
        s.token = j.token; s.exp = j.exp; s.user = j.user; s.salt = j.salt; s.hash = j.hash; s.hashes = j.hashes; s.at = Date.now();
        write(s);
        box.remove();
        if (opts.onDone) opts.onDone(j);
        else location.reload();
      }).catch(function () {
        msg.style.color = '#c0392b';
        msg.textContent = '서버에 연결하지 못했습니다 · 잠시 뒤 다시 시도해 주세요';
      });
    };
    return true;
  }

  /* ---------- 로그인 결과 → 사용자에게 보여 줄 말 ---------- */
  function loginMessage(j) {
    if (!j) return '로그인하지 못했습니다';
    if (j.error === 'locked') {
      var m = Math.max(1, Math.ceil((j.remainSec || 900) / 60));
      return '비밀번호를 ' + (j.fails || 5) + '번 틀려 ' + m + '분 동안 잠겼습니다. 잠시 뒤 다시 시도해 주세요.';
    }
    if (j.error === 'bad') {
      if (j.left !== undefined && j.left > 0) return '아이디 또는 비밀번호가 맞지 않습니다 (' + j.left + '번 더 틀리면 15분 잠금)';
      return '아이디 또는 비밀번호가 맞지 않습니다';
    }
    if (j.error === 'inactive' || j.error === 'no_user') return '사용할 수 없는 계정입니다 · 관리자에게 문의하세요';
    if (j.error === 'empty') return '아이디와 비밀번호를 넣어 주세요';
    return (j.message || '로그인하지 못했습니다');
  }

  /* ---------- 포털 계정 관리용 ---------- */
  function usersGet() {
    return api({ action: 'users_get' });
  }
  function usersSave(usersJson, extra) {
    var p = { action: 'users_save', usersJson: usersJson };
    if (extra) { for (var k in extra) p[k] = extra[k]; }
    return api(p);
  }

  win.KDWSEC = {
    AUTH_URL: AUTH_URL,
    session: session, user: user, token: token, isAdmin: isAdmin, menus: menus, canUse: canUse,
    login: login, logout: logout, post: post, api: api, get: get, clear: clear, update: update,
    guard: guard, startIdle: startIdle, touch: touch,
    bouncedRecently: bouncedRecently, bounces: bounces, clearBounce: clearBounce, onPortal: onPortal,
    clearSessionKeys: clear,
    needChange: needChange, forceChange: forceChange, loginMessage: loginMessage,
    usersGet: usersGet, usersSave: usersSave,
    loginUrl: loginUrl, redirectLogin: redirectLogin, MENU_LABEL: MENU_LABEL,
    idleMs: IDLE_MS
  };
})(window);
