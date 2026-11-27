/* 경덕농수산 상품단가표 — 화면·동작 */
(function () {
  'use strict';
  var C = window.PMCore;
  var $ = C.$, $$ = C.$$, esc = C.esc, nfmt = C.nfmt, wfmt = C.wfmt, pct = C.pct;
  var calc = C.calc, calcHana = C.calcHana;
  var SYNC = window.PMSync;

  var DATA_URL = 'data.enc.json';
  var K_META = 'pm.keymeta.v1', K_STATE = 'pm.state.v1', K_BASE = 'pm.base.v1';

  var CHCOLS = {
    kd:   { q: '납품가', r: '농협판매가', s: '광양동부농협' },
    farm: { q: '납품가', r: '농협판매가', s: '섬진강(수수료)' },
    dbs:  { q: '납품가', r: '농협판매가', s: '섬진강(수수료)' },
    nh:   { q: '납품가', r: '판매가', s: null },
    fish: { q: '납품가', r: '농협판매가', s: '광양동부농협' },
    bg:   { q: '납품가', r: '농협판매가', s: '광양동부농협' }
  };
  /* 비교 채널 — 우리 계산가를 어떤 값으로 볼지 */
  var OPTS = [
    { id: 'mart', label: '일반마트', ch: 'dbs' },
    { id: 'nh', label: '농협(일반)', ch: 'kd' },
    { id: 'gy', label: '광양동부농협', ch: 'nh' },
    { id: 'farm', label: '파머스(섬진강)', ch: 'farm' },
    { id: 'dbs', label: '동부슈퍼조합', ch: 'dbs' },
    { id: 'fish', label: '피쉬망고', ch: 'fish' },
    { id: 'bg', label: '벌교노마진', ch: 'bg' },
    { id: 'hana', label: '하나로마트', ch: 'hana' },
    { id: 'cust', label: '직접 입력', ch: null }
  ];

  var S = {
    payload: null, base: [], rowsBase: {}, hanaBase: [],
    items: [], rows: {}, hana: [],
    edits: { it: {}, row: {}, add: [], del: {}, log: [] },
    cmp: { opt: 'mart', basis: 's', rows: [], cust: { rate: 1.35, fee: 10 } },
    cur: { base: null, item: null, ch: 'kd' },
    stamp: { it: {}, row: {}, add: {}, del: {} }, wipe: 0,
    key: null, header: null, demo: false, dirty: false, allLimit: 160
  };

  /* ═════════════ 유틸 ═════════════ */
  function toast(msg, err) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast on' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 2600);
  }
  function ask(title, text, ok, danger) {
    return new Promise(function (res) {
      var m = $('#modal'), b = $('#mbox');
      b.innerHTML = '<h3>' + esc(title) + '</h3><p>' + text + '</p><div class="acts">' +
        '<button class="btn soft" data-a="0">취소</button>' +
        '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-a="1">' + esc(ok || '확인') + '</button></div>';
      m.hidden = false;
      b.querySelector('[data-a="0"]').onclick = function () { m.hidden = true; res(false); };
      b.querySelector('[data-a="1"]').onclick = function () { m.hidden = true; res(true); };
    });
  }
  function promptBox(title, text, opt) {
    opt = opt || {};
    return new Promise(function (res) {
      var m = $('#modal'), b = $('#mbox');
      b.innerHTML = '<h3>' + esc(title) + '</h3><p>' + (text || '') + '</p>' +
        '<input id="pb-in" type="' + (opt.type || 'text') + '" placeholder="' + esc(opt.placeholder || '') + '" value="' + esc(opt.value || '') + '">' +
        '<div class="acts"><button class="btn soft" data-a="0">취소</button><button class="btn primary" data-a="1">' + esc(opt.ok || '확인') + '</button></div>';
      m.hidden = false;
      var inp = $('#pb-in');
      setTimeout(function () { inp.focus(); }, 60);
      function done(v) { m.hidden = true; res(v); }
      b.querySelector('[data-a="0"]').onclick = function () { done(null); };
      b.querySelector('[data-a="1"]').onclick = function () { done(inp.value.trim()); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') done(inp.value.trim()); };
    });
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; }
  /* 금액 입력칸에 천단위 쉼표 */
  function moneyInput(el) {
    if (!el) return;
    el.addEventListener('input', function () {
      var raw = this.value.replace(/[^0-9]/g, '');
      this.value = raw ? Number(raw).toLocaleString('en-US') : '';
    });
  }
  function sso() {
    try {
      var s = JSON.parse(localStorage.getItem('kd.portal.sso.v1') || 'null');
      if (s && s.exp && Date.now() > s.exp) return null;
      return s && s.userId ? s : null;
    } catch (e) { return null; }
  }

  /* ═════════════ 자료 불러오기 · 저장 ═════════════ */
  function fetchHeader() {
    return fetch(DATA_URL + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('자료 파일을 받지 못했습니다 (' + r.status + ')'); return r.json(); });
  }
  function loadPayload(header, key) {
    /* 이미 받아 둔 복사본이 있으면 그걸 쓴다 */
    return C.idbGet('payload').then(function (cache) {
      if (cache && cache.built === header.built && cache.blob) {
        return C.unsealJSON(key, cache.blob).catch(function () { return null; });
      }
      return null;
    }).then(function (cached) {
      if (cached) return cached;
      return C.openBundle(header, null, key).then(function (r) {
        var p = r.payload;
        return C.sealJSON(key, p, true).then(function (blob) {
          C.idbPut('payload', { built: header.built, blob: blob });
          return p;
        });
      });
    });
  }
  function setDoc(payload, isOrigin) {
    S.payload = payload;
    if (isOrigin) S.origin = payload;
    S.base = payload.items || [];
    S.rowsBase = payload.chRows || {};
    S.hanaBase = payload.hana || [];
    rebuild();
  }
  function rebuild() {
    var items = [], map = {};
    S.base.forEach(function (o) {
      var c = Object.assign({}, o);
      var p = S.edits.it[o.id];
      if (p) Object.assign(c, p);
      map[o.id] = c;
      if (!S.edits.del[o.id]) items.push(c);
    });
    (S.edits.add || []).forEach(function (o) {
      if (S.edits.del[o.id]) return;
      var c = Object.assign({}, o);
      var p = S.edits.it[o.id];
      if (p) Object.assign(c, p);
      map[o.id] = c;
      items.push(c);
    });
    S.items = items;
    S.rows = {};
    Object.keys(S.rowsBase).forEach(function (ch) {
      var src = S.rowsBase[ch], dst = {};
      Object.keys(src).forEach(function (id) { dst[id] = Object.assign({}, src[id]); });
      S.rows[ch] = dst;
    });
    Object.keys(S.edits.row).forEach(function (k) {
      var i = k.indexOf('|'), ch = k.slice(0, i), id = k.slice(i + 1);
      if (!S.rows[ch]) S.rows[ch] = {};
      if (!S.rows[ch][id]) S.rows[ch][id] = {};
      Object.assign(S.rows[ch][id], S.edits.row[k]);
    });
    S.hana = S.hanaBase.map(function (h) { return Object.assign({}, h); });
    S.byId = map;
  }
  var saveState = C.debounce(function () {
    if (!S.key || S.demo) return;
    var box = { v: 1, built: (S.header && S.header.built) || '', edits: S.edits, cmp: S.cmp, stamp: S.stamp, wipe: S.wipe };
    C.sealJSON(S.key, box, true).then(function (blob) {
      if (lsSet(K_STATE, blob)) { paintSave('저장됨'); } else { paintSave('저장 공간 부족'); }
    }).catch(function () { paintSave('저장 실패'); });
  }, 500);
  function paintSave(t) {
    var el = $('#set-save');
    if (el) el.textContent = t + ' · ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  function persistLocal() { S.dirty = true; saveState(); if (SYNC) SYNC.changed(); }
  /* 엑셀에서 새로 올린 단가표는 이 기기에 따로 잠가 둔다 */
  function saveBase() {
    if (!S.key || S.demo) return;
    var payload = { v: 1, built: S.payload.built, chs: S.payload.chs, items: S.base, chRows: S.rowsBase, hana: S.hanaBase };
    C.sealJSON(S.key, payload, true).then(function (box) {
      if (!lsSet(K_BASE, box)) toast('이 기기 저장 공간이 부족해 다음에 열면 원래 단가표로 돌아갑니다', true);
    }).catch(function () {});
  }
  function loadBase() {
    var box = lsGet(K_BASE);
    if (!box || !S.key) return Promise.resolve(null);
    return C.unsealJSON(S.key, box).catch(function () { return null; });
  }

  /* ═════════════ 계산 도우미 ═════════════ */
  function rowOf(o, ch) {
    if (!ch || ch === 'kd') return o;
    var r = S.rows[ch] && S.rows[ch][o.id];
    return r ? Object.assign({}, o, r) : o;
  }
  function priceOf(o, ch) { return calc(rowOf(o, ch), ch); }
  function compareCalc(o, optId, basis) {
    if (optId === 'hana') {
      var h = calcHana(o);
      return { cost: h.cost, q: h.q, s: h.r, val: (basis === 'q' ? h.q : h.r) };
    }
    if (optId === 'cust') {
      var c = calc(o, 'kd');
      var rate = S.cmp.cust.rate || 1.3, fee = (S.cmp.cust.fee || 0) / 100;
      var q = C.rUp((c.cost || 0) * rate, -1);
      var s = C.rUp(q / (1 - fee || 1), -1);
      return { cost: c.cost, q: q, s: s, val: (basis === 'q' ? q : s) };
    }
    var opt = OPTS.filter(function (x) { return x.id === optId; })[0];
    var ch = opt.ch;
    var v = calc(rowOf(o, ch), ch);
    var s2 = v.s != null ? v.s : v.r;
    return { cost: v.cost, q: v.q, s: s2, val: (basis === 'q' ? v.q : s2) };
  }
  function statusOf(margin) {
    if (margin == null) return { k: 'warn', t: '계산불가' };
    if (margin < 0) return { k: 'bad', t: '적자' };
    if (margin < 7) return { k: 'bad', t: '위험' };
    if (margin < 15) return { k: 'warn', t: '주의' };
    return { k: 'ok', t: '적정' };
  }

  /* ═════════════ 원물 목록 ═════════════ */
  function groups() {
    var g = {}, arr = [];
    S.items.forEach(function (o) {
      var b = o.base || '';
      if (!g[b]) { g[b] = { base: b, items: [], kgs: {} }; arr.push(g[b]); }
      g[b].items.push(o);
      if (o.kg != null) g[b].kgs[o.kg] = (g[b].kgs[o.kg] || 0) + 1;
    });
    arr.forEach(function (x) {
      var best = null, n = 0;
      Object.keys(x.kgs).forEach(function (k) { if (x.kgs[k] > n) { n = x.kgs[k]; best = +k; } });
      x.rep = best; x.uniq = Object.keys(x.kgs).length; x.n = x.items.length;
      var cats = {}; x.items.forEach(function (o) { if (o.cat) cats[o.cat] = 1; });
      x.cat = Object.keys(cats)[0] || '';
      x.wts = x.items.map(function (o) { return o.wt; }).filter(function (v) { return v != null; })
        .sort(function (a, b) { return a - b; })
        .filter(function (v, i, a) { return i === 0 || v !== a[i - 1]; });
    });
    return arr;
  }
  function renderMat() {
    var q = ($('#mat-q').value || '').trim().toLowerCase();
    var cat = $('#mat-cat').value;
    var all = groups();
    var list = all.filter(function (g) {
      if (cat && g.cat !== cat) return false;
      if (!q) return true;
      if (g.base.toLowerCase().indexOf(q) >= 0) return true;
      return g.items.some(function (o) { return String(o.nm).toLowerCase().indexOf(q) >= 0; });
    }).sort(function (a, b) { return a.base.localeCompare(b.base, 'ko'); });

    var nItems = all.reduce(function (s, g) { return s + g.n; }, 0);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var chg = (S.edits.log || []).filter(function (l) { return l.t >= today.getTime(); }).length;
    $('#mat-stat').innerHTML = '원물 <b>' + nfmt(all.length) + '</b> · 품목 <b>' + nfmt(nItems) + '</b>' +
      (chg ? ' · 오늘 변경 <b>' + chg + '</b>건' : '');

    var cap = 300, html = '';
    list.slice(0, cap).forEach(function (g) {
      var wts = g.wts.slice(0, 5).map(wfmt).join('·') + (g.wts.length > 5 ? ' 외' : '');
      html += '<button class="mcard" data-base="' + esc(g.base) + '">' +
        '<span class="nm">' + esc(g.base) + (g.uniq > 1 ? '<span class="badge">단가 ' + g.uniq + '종</span>' : '') + '</span>' +
        '<span class="sub">' + g.n + '개 품목' + (wts ? ' · ' + esc(wts) : '') + '</span>' +
        '<span class="pr' + (g.uniq > 1 ? ' multi' : '') + '">' + (g.rep == null ? '단가없음' : nfmt(g.rep) + '<small>원/kg</small>') + '</span>' +
        '</button>';
    });
    $('#mat-list').innerHTML = html || '<p class="more">해당하는 원물이 없습니다</p>';
    $('#mat-more').hidden = list.length <= cap;
    if (list.length > cap) $('#mat-more').textContent = list.length + '개 중 ' + cap + '개 표시 · 검색으로 좁혀 주세요';
  }
  function openSheet(base) {
    var g = groups().filter(function (x) { return x.base === base; })[0];
    if (!g) return;
    S.cur.base = base;
    $('#sh-title').textContent = base;
    $('#sh-sub').textContent = g.n + '개 품목 · ' + (g.cat || '구분없음');
    $('#sh-kg').value = g.rep == null ? '' : nfmt(g.rep);
    $('#sh-keep').checked = false;
    $('#sh-chg').innerHTML = '';
    renderSheetItems(g);
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() { $('#sheet').hidden = true; document.body.style.overflow = ''; S.cur.base = null; }
  function renderSheetItems(g) {
    var items = g.items.slice().sort(function (a, b) { return (a.wt || 0) - (b.wt || 0); });
    var html = '';
    items.forEach(function (o) {
      var v = calc(o, 'kd');
      html += '<button class="irow" data-id="' + esc(o.id) + '">' +
        '<span class="l1"><b>' + esc(o.nm) + '</b>' +
        (o.wt != null ? '<span class="tag gray">' + wfmt(o.wt) + '</span>' : '') +
        (o.pack ? '<span class="tag gray">' + esc(o.pack) + '</span>' : '') +
        (o.auto ? '<span class="tag">자동이율</span>' : '') + '</span>' +
        '<span class="l2">매입 ' + nfmt(o.kg) + '원/kg · 이율 ' + (v.rate == null ? '-' : v.rate) +
        ' · 해당원가 ' + nfmt(v.cost) + '</span>' +
        '<span class="l3"><span><i>납품</i><b>' + nfmt(v.q) + '</b></span>' +
        '<span><i>농협</i><b>' + nfmt(v.r) + '</b></span>' +
        '<span><i>광양</i><b>' + nfmt(v.s) + '</b></span></span>' +
        '</button>';
    });
    $('#sh-items').innerHTML = html;
    $('#sh-listhead').innerHTML = '<span>중량별 품목 ' + g.n + '개</span><span>눌러서 수정</span>';
  }
  function previewApply() {
    var base = S.cur.base; if (!base) return;
    var g = groups().filter(function (x) { return x.base === base; })[0];
    var nk = num($('#sh-kg').value);
    var box = $('#sh-chg');
    if (nk == null || g.rep == null) { box.innerHTML = ''; return; }
    if (nk === g.rep) { box.innerHTML = '<span style="color:#77877f">현재 단가와 같습니다.</span>'; return; }
    var d = nk - g.rep, pctv = g.rep ? (d / g.rep * 100) : 0;
    var rows = '', n = 0, up = 0;
    g.items.forEach(function (o) {
      if (o.kg == null || o.kg !== g.rep) return;
      var b = calc(o, 'kd'), a = calc(Object.assign({}, o, { kg: nk }), 'kd');
      if (o.pack) { /* 포장비는 그대로 */ }
      n++;
      var dq = (a.q || 0) - (b.q || 0);
      if (dq > 0) up++;
      rows += '<tr><td>' + esc(o.nm) + '</td><td>' + nfmt(b.q) + ' → <b>' + nfmt(a.q) + '</b></td>' +
        '<td>' + nfmt(b.r) + ' → <b>' + nfmt(a.r) + '</b></td>' +
        '<td class="' + (dq > 0 ? 'up' : (dq < 0 ? 'dn' : '')) + '">' + (dq > 0 ? '+' : '') + nfmt(dq) + '</td></tr>';
    });
    box.innerHTML = '<div>이 원물에 ' + n + '개 품목 · 납품가 ' + (up ? '<span class="up">' + up + '개 인상</span>' : '변동') +
      ' <span style="color:#77877f">(단가 ' + (d > 0 ? '+' : '') + nfmt(d) + '원 · ' + (pctv > 0 ? '+' : '') + pct(pctv) + ')</span></div>' +
      (rows ? '<table><thead><tr><th>품목</th><th>납품가</th><th>농협</th><th>차이</th></tr></thead><tbody>' + rows + '</tbody></table>' : '');
  }
  function applyKg() {
    var base = S.cur.base; if (!base) return;
    var g = groups().filter(function (x) { return x.base === base; })[0];
    var nk = num($('#sh-kg').value);
    if (nk == null || nk <= 0) return toast('매입원가(원/kg)를 넣어 주세요', true);
    if (g.rep == null) return toast('이 원물은 매입원가가 없습니다. 품목에서 직접 넣어 주세요', true);
    if (nk === g.rep) return toast('지금 단가와 같습니다');
    var keep = $('#sh-keep').checked;
    var undo = [], rowUndo = [], n = 0;
    g.items.forEach(function (o) {
      if (o.kg == null) return;
      if (keep && o.kg !== g.rep) return;
      undo.push([o.id, o.kg]);
      S.edits.it[o.id] = Object.assign({}, S.edits.it[o.id] || {}, { kg: nk });
      Object.keys(S.rows).forEach(function (ch) {
        var r = S.rows[ch][o.id];
        if (r && r.kg != null) {
          rowUndo.push([ch, o.id, r.kg]);
          S.edits.row[ch + '|' + o.id] = Object.assign({}, S.edits.row[ch + '|' + o.id] || {}, { kg: nk });
        }
      });
      n++;
    });
    if (!n) return toast('바꿀 품목이 없습니다', true);
    (S.edits.log = S.edits.log || []).unshift({ t: Date.now(), base: base, from: g.rep, to: nk, n: n, undo: undo, rowUndo: rowUndo });
    S.edits.log = S.edits.log.slice(0, 60);
    rebuild(); persistLocal();
    openSheet(base);
    toast(n + '개 품목 가격을 새 단가로 바꿨습니다');
    renderMat(); renderAll(); renderCompare(); renderSet();
  }
  function undoLast() {
    var l = (S.edits.log || [])[0];
    if (!l) return toast('되돌릴 변경이 없습니다', true);
    (l.undo || []).forEach(function (u) { S.edits.it[u[0]] = Object.assign({}, S.edits.it[u[0]] || {}, { kg: u[1] }); });
    (l.rowUndo || []).forEach(function (u) {
      var k = u[0] + '|' + u[1];
      S.edits.row[k] = Object.assign({}, S.edits.row[k] || {}, { kg: u[2] });
    });
    S.edits.log.shift();
    rebuild(); persistLocal();
    renderMat(); renderAll(); renderCompare(); renderSet();
    if (S.cur.base && !$('#sheet').hidden) openSheet(S.cur.base);
    toast('마지막 변경을 되돌렸습니다');
  }

  /* ═════════════ 전체품목 ═════════════ */
  function chItems(ch) {
    if (ch === 'hana') return S.hana.map(function (h, i) { h._i = i; return h; });
    return S.items.filter(function (o) {
      return (o.ch && o.ch.indexOf(ch) >= 0) || (S.rows[ch] && S.rows[ch][o.id]);
    });
  }
  function renderChannelSelect() {
    var sel = $('#all-ch');
    if (sel.options.length) return;
    var chs = (S.payload && S.payload.chs) || [];
    sel.innerHTML = chs.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
    sel.value = S.cur.ch = 'kd';
  }
  function renderAll() {
    renderChannelSelect();
    var ch = $('#all-ch').value || 'kd';
    S.cur.ch = ch;
    var q = ($('#all-q').value || '').trim().toLowerCase();
    var list = chItems(ch);
    if (q) {
      list = list.filter(function (o) {
        if (ch === 'hana') return String(o.nm).toLowerCase().indexOf(q) >= 0;
        return String(o.nm).toLowerCase().indexOf(q) >= 0 ||
          String(o.bc || '').indexOf(q) >= 0 || String(o.cat || '').toLowerCase().indexOf(q) >= 0 ||
          String(o.base || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    $('#all-stat').innerHTML = '총 <b>' + nfmt(list.length) + '</b>개 품목' + (q ? ' (검색)' : '');
    var cols = CHCOLS[ch] || CHCOLS.kd;
    var html = '', cap = S.allLimit;
    if (ch === 'hana') {
      list.slice(0, cap).forEach(function (h) {
        var v = calcHana(h);
        html += '<div class="prow"><span class="nm">' + esc(h.nm) + '</span>' +
          '<span class="sub">' + wfmt(h.wt) + ' · ' + esc(h.mat || '') + '</span>' +
          '<span class="px"><b>' + nfmt(v.r) + '</b><span>업체판매가</span></span>' +
          '<span class="cols"><span><i>매입</i>' + nfmt(h.kg) + '/kg</span><span><i>완제품</i>' + nfmt(v.cost) + '</span>' +
          '<span><i>납품</i>' + nfmt(v.q) + '</span><span><i>자사이윤</i>' + pct((h.im || 0) * 100) + '</span>' +
          '<span><i>업체이윤</i>' + pct((h.vm || 0) * 100) + '</span></span></div>';
      });
    } else {
      list.slice(0, cap).forEach(function (o) {
        var v = calc(rowOf(o, ch), ch);
        html += '<button class="prow" data-id="' + esc(o.id) + '"><span class="nm">' + esc(o.nm) + '</span>' +
          '<span class="sub">' + (o.wt != null ? wfmt(o.wt) : '') + (o.pack ? ' · ' + esc(o.pack) : '') +
          ' · ' + (v.rate == null ? '이율-' : '이율 ' + v.rate) + (o.cat ? ' · ' + esc(o.cat) : '') + '</span>' +
          '<span class="px"><b>' + nfmt(v.q) + '</b><span>' + esc(cols.q) + '</span></span>' +
          '<span class="cols"><span><i>매입</i>' + nfmt(o.kg) + '/kg</span><span><i>해당원가</i>' + nfmt(v.cost) + '</span>' +
          '<span><i>' + esc(cols.r) + '</i>' + nfmt(v.r) + '</span>' +
          (cols.s ? '<span><i>' + esc(cols.s) + '</i>' + nfmt(v.s) + '</span>' : '') +
          '</span></button>';
      });
    }
    $('#all-list').innerHTML = html || '<p class="more">품목이 없습니다</p>';
    $('#all-more').hidden = list.length <= cap;
    if (list.length > cap) $('#all-more').textContent = list.length + '개 중 ' + cap + '개 · 아래로 더 보기';
  }

  /* ═════════════ 품목 편집 ═════════════ */
  function openEdit(id) {
    var o = S.byId[id]; if (!o) return;
    S.cur.item = id;
    $('#ed-title').textContent = o.nm;
    $('#ed-sub').textContent = (o.ch || []).map(function (c) { return ({ kd: '경덕', farm: '파머스', dbs: '동부슈퍼', nh: '광양농협', fish: '피쉬망고', bg: '벌교' })[c] || c; }).join(' · ');
    $('#ed-nm').value = o.nm || '';
    $('#ed-base').value = o.base || '';
    $('#ed-kg').value = o.kg == null ? '' : nfmt(o.kg);
    $('#ed-wt').value = o.wt == null ? '' : o.wt;
    $('#ed-pack').value = o.pack || '';
    $('#ed-rate').value = o.rate == null ? '' : o.rate;
    $('#ed-auto').checked = !!o.auto;
    $('#ed-cat').value = o.cat || '';
    $('#ed-tax').value = o.tax || '';
    $('#ed-spec').value = o.spec || '';
    $('#ed-bc').value = o.bc || '';
    $('#ed-note').value = o.note || '';
    paintEditCalc();
    $('#esheet').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function paintEditCalc() {
    var o = S.byId[S.cur.item] || {};
    var t = Object.assign({}, o, {
      kg: num($('#ed-kg').value), wt: num($('#ed-wt').value), pack: $('#ed-pack').value,
      rate: num($('#ed-rate').value), auto: $('#ed-auto').checked
    });
    var v = calc(t, 'kd');
    $('#ed-calc').innerHTML = '해당원가 <b>' + nfmt(v.cost) + '</b>원 · 납품가 <b>' + nfmt(v.q) + '</b>원 · ' +
      '농협 <b>' + nfmt(v.r) + '</b>원 · 광양 <b>' + nfmt(v.s) + '</b>원';
  }
  function closeEdit() { $('#esheet').hidden = true; document.body.style.overflow = ''; S.cur.item = null; }
  function saveEdit() {
    var id = S.cur.item; if (!id) return;
    var patch = {
      nm: $('#ed-nm').value.trim(), base: $('#ed-base').value.trim() || $('#ed-nm').value.trim().split('_')[0],
      kg: num($('#ed-kg').value), wt: num($('#ed-wt').value), pack: $('#ed-pack').value,
      rate: num($('#ed-rate').value), auto: $('#ed-auto').checked,
      cat: $('#ed-cat').value.trim(), tax: $('#ed-tax').value.trim(),
      spec: $('#ed-spec').value.trim(), bc: $('#ed-bc').value.trim(), note: $('#ed-note').value.trim()
    };
    S.edits.it[id] = Object.assign({}, S.edits.it[id] || {}, patch);
    rebuild(); persistLocal(); closeEdit();
    if (S.cur.base) openSheet(S.cur.base);
    renderMat(); renderAll(); renderCompare(); renderSet();
    toast('저장했습니다');
  }
  function delItem() {
    var id = S.cur.item; if (!id) return;
    var o = S.byId[id];
    ask('품목 삭제', '<b>' + esc(o.nm) + '</b> 을(를) 이 단가표에서 뺄까요?', '삭제', true).then(function (ok) {
      if (!ok) return;
      S.edits.del[id] = 1;
      var i = S.edits.add.findIndex(function (x) { return x.id === id; });
      if (i >= 0) S.edits.add.splice(i, 1);
      rebuild(); persistLocal(); closeEdit();
      if (S.cur.base) openSheet(S.cur.base);
      renderMat(); renderAll(); renderCompare(); renderSet();
      toast('삭제했습니다');
    });
  }
  function addItem() {
    var base = S.cur.base;
    var g = groups().filter(function (x) { return x.base === base; })[0];
    var id = 'n' + Date.now();
    var proto = g && g.items[0] ? g.items[0] : {};
    S.edits.add.push({
      id: id, nm: base + '_새품목', base: base, cat: proto.cat || '', tax: proto.tax || '',
      bc: '', spec: '', unit: 'ea', kg: g ? g.rep : null, wt: null, pack: '',
      rate: proto.rate || 1.4, note: '', ch: ['kd', 'farm', 'dbs', 'fish', 'bg']
    });
    rebuild(); persistLocal();
    openSheet(base);
    setTimeout(function () { openEdit(id); }, 120);
  }

  /* ═════════════ 가격비교 ═════════════ */
  function renderCmpChannels() {
    $('#cmp-ch').innerHTML = OPTS.map(function (o) {
      return '<button data-opt="' + o.id + '" class="' + (S.cmp.opt === o.id ? 'on' : '') + '">' + esc(o.label) + '</button>';
    }).join('');
    $('#cmp-cust').hidden = S.cmp.opt !== 'cust';
    $('#cust-rate').value = S.cmp.cust.rate;
    $('#cust-fee').value = S.cmp.cust.fee;
    $$('#cmp-basis button').forEach(function (b) { b.classList.toggle('on', b.dataset.b === S.cmp.basis); });
  }
  /* 비교 줄 하나의 계산값 — 우리 상품(id) 또는 미매칭 줄(직접 원가) */
  function cmpView(r) {
    var o = r.id ? S.byId[r.id] : null;
    var v = o ? compareCalc(o, S.cmp.opt, S.cmp.basis) : null;
    var cost = (r.cost != null && r.cost > 0) ? r.cost : (v ? v.cost : null);
    var val = v ? v.val : null;
    var price = r.price == null ? null : r.price;
    var diff = (price == null || val == null) ? null : price - val;
    var diffPct = (diff == null || !val) ? null : diff / val * 100;
    var margin = (price == null || !cost) ? null : (price - cost) / price * 100;
    return {
      o: o, v: v, cost: cost, val: val, q: v ? v.q : null, price: price,
      diff: diff, diffPct: diffPct, margin: margin, st: statusOf(margin)
    };
  }
  function cmpRowHTML(r, idx) {
    var e = cmpView(r), o = e.o;
    var IMP = window.PMImport;
    var nm = o ? o.nm : (r.nm || '이름 없는 품목');
    var tags = '';
    if (r.miss) tags += '<span class="tag red">미매칭</span>';
    else if (r.how === 'fuzzy') tags += '<span class="tag gray">이름 비슷</span>';
    else if (r.how === 'barcode') tags += '<span class="tag gray">바코드</span>';
    else if (r.how === 'manual') tags += '<span class="tag gray">직접 연결</span>';
    if (r.derived) tags += '<span class="tag gray">공급가÷수량</span>';
    var sub = [];
    if (o && o.wt != null) sub.push(wfmt(o.wt));
    if (o && o.pack) sub.push(esc(o.pack));
    if (r.qty != null) sub.push('수량 ' + nfmt(r.qty));
    if (r.spec) sub.push('규격 ' + esc(r.spec));
    if (r.bc) sub.push('바코드 ' + esc(r.bc));
    if (!o && r.wt != null) sub.push(wfmt(r.wt));
    var stmt = '';
    if (r.stmt && (!o || (IMP && IMP.nameKey(r.stmt) !== IMP.nameKey(o.nm)))) {
      stmt = '<div class="sub stmt">명세 품명: ' + esc(r.stmt) + '</div>';
    }
    var near = '';
    if (r.miss && r.near && r.near.length) {
      near = '<div class="near">비슷한 상품 ' + r.near.map(function (n2) {
        var hit = S.items.filter(function (x) { return x.nm === n2; })[0];
        return hit ? '<button type="button" data-linkto="' + idx + '|' + esc(hit.id) + '">' + esc(n2) + '</button>' : '';
      }).join('') + '</div>';
    }
    var mact = '';
    if (!o) {
      mact = '<div class="mact">' +
        '<button class="btn soft sm" type="button" data-link="' + idx + '">🔗 우리 상품 연결</button>' +
        '<label class="cst">원가<input type="number" inputmode="numeric" data-cost="' + idx + '" value="' +
        (r.cost == null ? '' : r.cost) + '" placeholder="직접 입력">원</label></div>' + near;
    }
    return '<div class="crow' + (r.miss ? ' miss' : '') + '" data-idx="' + idx + '">' +
      '<div class="top2"><div><div class="nm">' + esc(nm) + ' ' + tags + '</div>' +
      '<div class="sub">' + sub.join(' · ') + '</div>' + stmt + '</div>' +
      '<span class="st ' + e.st.k + '">' + e.st.t + '</span></div>' +
      '<div class="io"><label>출고가</label>' +
      '<input type="number" inputmode="numeric" data-price="' + idx + '" value="' + (r.price == null ? '' : r.price) + '" placeholder="' + (e.val == null ? '' : e.val) + '">' +
      '<span class="sub">원</span><button class="rm" data-rm="' + idx + '">✕</button></div>' +
      mact +
      '<div class="calc">' +
      '<span data-role="val"><i>우리계산</i><b>' + nfmt(e.val) + '</b></span>' +
      '<span data-role="q"><i>납품가</i>' + nfmt(e.q) + '</span>' +
      '<span class="diff ' + (e.diff == null ? '' : (e.diff >= 0 ? 'pos' : 'neg')) + '" data-role="diff"><i>차액</i><b>' +
      (e.diff == null ? '-' : (e.diff > 0 ? '+' : '') + nfmt(e.diff)) + '</b></span>' +
      '<span data-role="diffpct"><i>차이율</i>' + (e.diffPct == null ? '-' : (e.diffPct > 0 ? '+' : '') + pct(e.diffPct)) + '</span>' +
      '<span data-role="margin"><i>마진율</i><b>' + pct(e.margin) + '</b></span>' +
      '</div></div>';
  }
  function cmpRowsHTML() {
    var html = '';
    S.cmp.rows.forEach(function (r, idx) { html += cmpRowHTML(r, idx); });
    return html;
  }
  /* 입력하는 동안 그 줄만 다시 계산 (포커스 유지) */
  function refreshCmpRow(box, idx) {
    var r = S.cmp.rows[idx]; if (!box || !r) return;
    var e = cmpView(r);
    var tag = box.querySelector('.st');
    if (tag) { tag.className = 'st ' + e.st.k; tag.textContent = e.st.t; }
    function set(role, html) { var el = box.querySelector('[data-role="' + role + '"]'); if (el) el.innerHTML = html; }
    set('val', '<i>우리계산</i><b>' + nfmt(e.val) + '</b>');
    set('q', '<i>납품가</i>' + nfmt(e.q));
    var d = box.querySelector('[data-role="diff"]');
    if (d) {
      d.className = 'diff ' + (e.diff == null ? '' : (e.diff >= 0 ? 'pos' : 'neg'));
      d.innerHTML = '<i>차액</i><b>' + (e.diff == null ? '-' : (e.diff > 0 ? '+' : '') + nfmt(e.diff)) + '</b>';
    }
    set('diffpct', '<i>차이율</i>' + (e.diffPct == null ? '-' : (e.diffPct > 0 ? '+' : '') + pct(e.diffPct)));
    set('margin', '<i>마진율</i><b>' + pct(e.margin) + '</b>');
    renderCmpSum();
  }
  function renderCmpSum() {
    var n = 0, sum = 0, bad = 0, miss = 0;
    S.cmp.rows.forEach(function (r) {
      if (!r.id) miss++;
      var e = cmpView(r);
      if (e.price == null || !e.cost) return;
      n++; sum += e.margin; if (e.margin < 7) bad++;
    });
    $('#cmp-sum').innerHTML = '<div>비교 <b>' + S.cmp.rows.length + '</b>건</div>' +
      '<div>입력 <b>' + n + '</b>건</div>' +
      (miss ? '<div class="bad">미매칭 <b>' + miss + '</b>건</div>' : '') +
      '<div>평균 마진 <b>' + (n ? pct(sum / n) : '-') + '</b></div>' +
      '<div class="' + (bad ? 'bad' : '') + '">위험·적자 <b>' + bad + '</b>건</div>';
  }
  function renderCompare() {
    renderCmpChannels();
    $('#cmp-list').innerHTML = cmpRowsHTML() || '<p class="more">검색해서 출고할 상품을 담으면, 우리 계산가와 나란히 비교해 드립니다.</p>';
    renderCmpSum();
    $('#cmp-actions').hidden = !S.cmp.rows.length;
  }
  function addCmp(id) {
    if (S.cmp.rows.some(function (r) { return r.id === id; })) { toast('이미 담았습니다'); return; }
    var o = S.byId[id]; if (!o) return;
    var v = compareCalc(o, S.cmp.opt, S.cmp.basis);
    S.cmp.rows.push({ id: id, price: v.val == null ? null : Math.round(v.val) });
    persistLocal(); renderCompare();
  }
  /* 미매칭 줄에 우리 상품 연결 */
  function linkCmpRow(idx, id) {
    var r = S.cmp.rows[idx], o = S.byId[id];
    if (!r || !o) return;
    var dup = false;
    S.cmp.rows.forEach(function (x, i) { if (i !== idx && x.id === id) dup = true; });
    r.id = id; r.miss = false; r.how = 'manual'; r.cost = null; r.near = null;
    if (!r.stmt && r.nm) r.stmt = r.nm;
    persistLocal(); renderCompare();
    toast((dup ? '이미 담긴 상품이지만 이 줄에 연결했습니다 · ' : '연결했습니다 · ') + o.nm);
  }
  function linkItemPrompt(idx) {
    var r = S.cmp.rows[idx]; if (!r) return;
    var m = $('#modal'), b = $('#mbox');
    b.innerHTML = '<h3>우리 상품 연결</h3><p><b>' + esc(r.nm || '') + '</b> 줄에 우리 단가표의 어느 상품을 쓸까요?</p>' +
      '<input id="lk-q" type="search" autocomplete="off" placeholder="품명으로 찾기">' +
      '<div class="lklist" id="lk-list"></div>' +
      '<div class="acts"><button class="btn soft" data-a="0">취소</button></div>';
    m.hidden = false;
    var box = $('#lk-list');
    var base = (r.nm || '').replace(/[\s_]/g, '').slice(0, 4);
    $('#lk-q').value = base;
    function paint() {
      var q = ($('#lk-q').value || '').trim().toLowerCase().replace(/[\s_]/g, '');
      var hits = S.items.filter(function (o) {
        if (!q) return true;
        return String(o.nm).toLowerCase().replace(/[\s_]/g, '').indexOf(q) >= 0;
      }).slice(0, 60);
      box.innerHTML = hits.map(function (o) {
        var v = compareCalc(o, S.cmp.opt, S.cmp.basis);
        return '<button type="button" class="lkrow" data-pick="' + esc(o.id) + '"><b>' + esc(o.nm) + '</b><span>' +
          (o.wt != null ? wfmt(o.wt) : '') + (o.pack ? ' · ' + esc(o.pack) : '') + ' · 우리 ' + nfmt(v.val) + '원</span></button>';
      }).join('') || '<p class="note">찾는 상품이 없습니다 · 전체품목에서 먼저 넣어 주세요</p>';
    }
    paint();
    $('#lk-q').oninput = C.debounce(paint, 120);
    b.querySelector('[data-a="0"]').onclick = function () { m.hidden = true; };
    box.onclick = function (ev) {
      var p = ev.target.closest('[data-pick]'); if (!p) return;
      m.hidden = true; linkCmpRow(idx, p.dataset.pick);
    };
  }
  function renderSuggest(q) {
    var box = $('#cmp-sug');
    q = (q || '').trim().toLowerCase();
    if (!q) { box.hidden = true; return; }
    var hits = S.items.filter(function (o) {
      return String(o.nm).toLowerCase().indexOf(q) >= 0 || String(o.base || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 8);
    if (!hits.length) { box.hidden = true; return; }
    box.innerHTML = hits.map(function (o) {
      var v = compareCalc(o, S.cmp.opt, S.cmp.basis);
      return '<button data-add="' + esc(o.id) + '"><b>' + esc(o.nm) + '</b><span>' +
        (o.wt != null ? wfmt(o.wt) : '') + (o.pack ? ' · ' + esc(o.pack) : '') + ' · 우리 ' + nfmt(v.val) + '원</span></button>';
    }).join('');
    box.hidden = false;
  }

  /* ═════════════ 설정 ═════════════ */
  function renderSet() {
    var g = groups();
    $('#set-items').textContent = nfmt(S.items.length) + '개';
    $('#set-bases').textContent = nfmt(g.length) + '개';
    $('#set-built').textContent = (S.payload && S.payload.built) || '-';
    $('#set-src').textContent = S.custom ? '올린 엑셀' : '암호화 단가표';
    $('#set-baseoffwrap').hidden = !S.custom;
    var log = S.edits.log || [];
    $('#set-logcnt').textContent = log.length + '건';
    $('#set-log').innerHTML = log.slice(0, 12).map(function (l) {
      var d = new Date(l.t);
      return '<div class="logrow"><b>' + esc(l.base) + '</b> ' + nfmt(l.from) + ' → ' + nfmt(l.to) +
        '원/kg · ' + l.n + '개 <span>' + d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</span></div>';
    }).join('') || '<p class="note">아직 바꾼 내역이 없습니다.</p>';
    $('#set-undo').disabled = !log.length;
    paintSync(); paintPortalWrap();
  }

  /* ═════════════ 엑셀 ═════════════ */
  function loadXLSX() {
    return new Promise(function (res, rej) {
      if (window.XLSX) return res(window.XLSX);
      var s = document.createElement('script');
      s.src = 'xlsx.full.min.js';
      s.onload = function () { res(window.XLSX); };
      s.onerror = function () { rej(new Error('엑셀 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      document.head.appendChild(s);
    });
  }
  function sheetAOA(ch) {
    var head, rows = [];
    var cols = CHCOLS[ch] || CHCOLS.kd;
    if (ch === 'hana') {
      head = ['품명', '구매원가(kg)', '제품용량(kg)', '포장재질', '용량단가', '완제품단가', '자사이윤', '납품/판매가', '업체이윤', '업체판매가', 'g당판매가', '비고'];
      S.hana.forEach(function (h) {
        var v = calcHana(h);
        rows.push([h.nm, h.kg, h.wt, h.mat || '', v.e, v.cost, h.im, v.q, h.vm, v.r, v.m, h.note || '']);
      });
      return [head].concat(rows);
    }
    head = ['품명', '구분', '과/면세', '바코드', '규격', '단위', '매입원가(kg)', '중량', '포장', '해당원가', '이율',
      cols.q, cols.r];
    if (cols.s) head.push(cols.s);
    if (ch === 'farm' || ch === 'dbs') head.push('수수료');
    head.push('비고');
    chItems(ch).forEach(function (o) {
      var v = calc(rowOf(o, ch), ch);
      var r = [o.nm, o.cat || '', o.tax || '', o.bc || '', o.spec || '', o.unit || '', o.kg, o.wt, o.pack || '',
        v.cost, v.rate, v.q, v.r];
      if (cols.s) r.push(v.s);
      if (ch === 'farm' || ch === 'dbs') r.push((rowOf(o, ch).fee == null ? '' : rowOf(o, ch).fee));
      r.push(o.note || '');
      rows.push(r);
    });
    return [head].concat(rows);
  }
  function exportEnriched() {
    loadXLSX().then(function (XLSX) {
      var wb = XLSX.utils.book_new();
      ((S.payload && S.payload.chs) || []).forEach(function (c) {
        var ws = XLSX.utils.aoa_to_sheet(sheetAOA(c.id));
        XLSX.utils.book_append_sheet(wb, ws, c.label.slice(0, 28));
      });
      XLSX.writeFile(wb, '상품단가표_' + new Date().toISOString().slice(0, 10) + '.xlsx');
      toast('엑셀로 내려받았습니다');
    }).catch(function (e) { toast(e.message, true); });
  }
  function exportChannel() {
    var ch = $('#all-ch').value || 'kd';
    loadXLSX().then(function (XLSX) {
      var wb = XLSX.utils.book_new();
      var name = ((S.payload && S.payload.chs) || []).filter(function (c) { return c.id === ch; })[0];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetAOA(ch)), (name ? name.label : '단가').slice(0, 28));
      XLSX.writeFile(wb, '상품단가_' + ch + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
      toast('엑셀로 내려받았습니다');
    }).catch(function (e) { toast(e.message, true); });
  }
  function exportCompare() {
    if (!S.cmp.rows.length) return toast('비교할 상품을 먼저 담아 주세요', true);
    loadXLSX().then(function (XLSX) {
      var head = ['품명', '중량', '포장', '해당원가', '우리 납품가', '우리 계산가', '출고가', '차액', '차이율(%)', '예상 마진율(%)', '상태', '거래처', '연결', '명세 품명'];
      var aoa = [head];
      var optLabel = (OPTS.filter(function (o) { return o.id === S.cmp.opt; })[0] || {}).label || '';
      S.cmp.rows.forEach(function (r) {
        var e = cmpView(r), o = e.o;
        var wt = o ? o.wt : r.wt;
        aoa.push([o ? o.nm : (r.nm || ''),
          wt == null ? '' : Math.round(wt * 1000) / 1000, o ? (o.pack || '') : '',
          e.cost == null ? '' : Math.round(e.cost), e.q == null ? '' : Math.round(e.q), e.val == null ? '' : Math.round(e.val),
          e.price == null ? '' : e.price, e.diff == null ? '' : Math.round(e.diff),
          e.diffPct == null ? '' : Math.round(e.diffPct * 10) / 10,
          e.margin == null ? '' : Math.round(e.margin * 10) / 10, e.st.t, optLabel,
          r.miss ? '미매칭' : (r.how === 'manual' ? '직접 연결' : (r.how === 'barcode' ? '바코드' : (r.how === 'fuzzy' ? '이름 비슷' : '품명'))),
          r.stmt || '']);
      });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '가격비교');
      XLSX.writeFile(wb, '가격비교_' + new Date().toISOString().slice(0, 10) + '.xlsx');
      toast('비교 결과를 내려받았습니다');
    }).catch(function (e) { toast(e.message, true); });
  }
  function pickFile(accept, cb) {
    var inp = $('#filein');
    inp.accept = accept || '.xlsx,.xls,.csv';
    inp.value = '';
    inp._cb = cb;
    inp.click();
  }
  function readSheet(file) {
    return loadXLSX().then(function (XLSX) {
      return file.arrayBuffer().then(function (buf) {
        var wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        var out = [];
        wb.SheetNames.forEach(function (n) {
          /* blankrows:true — 빈 줄을 남겨 두어야 엑셀의 행 번호와 안내가 맞는다 */
          var rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: true, raw: true, defval: null });
          out.push({ name: n, grid: rows });
        });
        return out;
      });
    });
  }
  /* 머리글 이름으로 열 찾기 — 1~60행을 훑어 공백·괄호를 무시하고 찾는다 */
  function findCols(grid) {
    var IMP = window.PMImport;
    var t = IMP && IMP.detectTable(grid);
    if (!t) return null;
    var c = t.cols;
    return {
      nm: c.nm, bc: c.bc, kg: c.kg, wt: c.wt, pack: c.pack, rate: c.rate,
      price: c.price, cat: c.cat, spec: c.spec, qty: c.qty, unit: c.unit, amount: c.amount,
      _row: t.row, _table: t
    };
  }
  function importMaster(file) {
    readSheet(file).then(function (sheets) {
      var best = null;
      sheets.forEach(function (s) {
        var m = findCols(s.grid);
        if (m && m.kg != null) best = { sheet: s, map: m };
      });
      if (!best) { toast('엑셀에서 품명·매입원가 열을 찾지 못했습니다', true); return; }
      var m = best.map, grid = best.sheet.grid, items = [], i = 1;
      grid.slice(m._row + 1).forEach(function (row) {
        var nm = row[m.nm];
        if (!nm) return;
        var wt = m.wt != null ? num(row[m.wt]) : null;
        var kg = num(row[m.kg]);
        items.push({
          id: 'u' + (i++), nm: String(nm).trim(), base: String(nm).trim().split('_')[0],
          cat: m.cat != null ? String(row[m.cat] || '') : '', tax: '',
          bc: m.bc != null ? String(row[m.bc] || '') : '', spec: m.spec != null ? String(row[m.spec] || '') : '',
          unit: 'ea', kg: kg, wt: wt, pack: m.pack != null ? String(row[m.pack] || '') : '',
          rate: m.rate != null ? num(row[m.rate]) : null, note: '',
          ch: ['kd']
        });
      });
      if (!items.length) { toast('읽을 품목이 없습니다', true); return; }
      ask('단가표 바꾸기', '<b>' + items.length + '개 품목</b>을 이 엑셀 자료로 새로 시작할까요?<br>지금까지 바꾼 내역은 사라집니다.', '바꾸기', true).then(function (ok) {
        if (!ok) return;
        setDoc({ v: 1, built: new Date().toISOString().slice(0, 10), chs: [{ id: 'kd', label: '경덕(기본)' }], items: items, chRows: {}, hana: [] });
        S.edits = { it: {}, row: {}, add: [], del: {}, log: [] };
        S.rowsBase = {}; S.hanaBase = [];
        S.custom = true; saveBase();
        persistLocal();
        renderMat(); renderAll(); renderCompare(); renderSet();
        toast(items.length + '개 품목으로 바꿨습니다');
      });
    }).catch(function (e) { toast(e.message || '엑셀을 읽지 못했습니다', true); });
  }
  function importCompare(file) {
    var IMP = window.PMImport;
    if (!IMP) { toast('엑셀 읽기 도구를 불러오지 못했습니다 · 화면을 새로 고쳐 주세요', true); return; }
    readSheet(file).then(function (sheets) {
      var best = null, any = null;
      sheets.forEach(function (s) {
        var t = IMP.detectTable(s.grid);
        if (!t) return;
        if (!any) any = { sheet: s, t: t };
        if (IMP.hasPriceCol(t.cols) && (!best || t.score > best.t.score)) best = { sheet: s, t: t };
      });
      if (!best) {
        var msg = any
          ? '<b>' + esc(any.sheet.name) + '</b> 시트 ' + (any.t.row + 1) + '행을 머리글로 봤지만 <b>단가</b> 열이 없습니다.' +
            '<br><span class="note">단가·출고가·공급가·납품가 열이 있는 거래명세서·단가표인지 확인해 주세요.</span>'
          : '엑셀 1~60행에서 <b>품명</b>·<b>단가</b>가 있는 머리글 줄을 찾지 못했습니다.' +
            '<br><span class="note">거래명세서·단가표의 품명·단가 열이 있는 파일인지, 첫 시트인지 확인해 주세요.</span>';
        cmpNote(msg, true);
        toast(any ? '단가 열을 찾지 못했습니다' : '품명·단가 열을 찾지 못했습니다', true);
        return;
      }
      var res, idx, stat, err = null;
      var before = S.cmp.rows.length;
      try {
        res = IMP.parseStatement(best.sheet.grid, best.t);
        if (!res.rows.length) {
          var why = res.skipped.length
            ? '품목으로 볼 줄 ' + res.skipped.length + '줄이 있었지만 단가가 비어 있었습니다'
            : '단가가 있는 품목 줄이 없습니다';
          cmpNote('<b>' + esc(best.sheet.name) + '</b> 시트 ' + (best.t.row + 1) + '행을 머리글로 보고 읽었지만 담을 품목이 없습니다.' +
            '<br><span class="note">' + why + ' · 단가 열 위치와 숫자 서식을 확인해 주세요.</span>', true);
          toast('담을 품목이 없습니다 · 원인을 위에 표시했습니다', true);
          return;
        }
        idx = IMP.buildIndex(S.items);
        stat = { read: res.rows.length, name: 0, bc: 0, fuzzy: 0, miss: 0, dup: 0, derived: 0, fail: 0 };
        var byId = {};
        S.cmp.rows.forEach(function (r) { if (r.id) byId[r.id] = r; });
        res.rows.forEach(function (row) {
          var m;
          try { m = IMP.matchRow(row, idx); } catch (e) { m = { item: null, how: '', near: [] }; stat.fail++; }
          if (row.derived) stat.derived++;
          if (m.item) {
            if (m.how === 'barcode') stat.bc++;
            else if (m.how === 'fuzzy') stat.fuzzy++;
            else stat.name++;
            var ex = byId[m.item.id];
            if (ex) {
              ex.price = row.price; ex.stmt = row.nm; ex.spec = row.spec; ex.bc = row.bc;
              ex.qty = row.qty; ex.how = m.how; ex.miss = false; ex.derived = !!row.derived;
              stat.dup++;
            } else {
              var nr = {
                id: m.item.id, price: row.price, stmt: row.nm, spec: row.spec, bc: row.bc,
                qty: row.qty, wt: row.wt, how: m.how, derived: !!row.derived
              };
              byId[m.item.id] = nr; S.cmp.rows.push(nr);
            }
          } else {
            stat.miss++;
            S.cmp.rows.push({
              id: null, miss: true, nm: row.nm, key: row.key, spec: row.spec, bc: row.bc,
              price: row.price, qty: row.qty, wt: row.wt, unit: row.unit, derived: !!row.derived,
              near: (m.near || []).slice(0, 3).map(function (o) { return o.nm; })
            });
          }
        });
      } catch (e) {
        err = e;
      }
      persistLocal(); renderCompare();
      if (stat) {
        var parts = ['거래명세 <b>' + stat.read + '</b>건 읽음',
          '우리 상품 <b>' + (stat.name + stat.bc + stat.fuzzy) + '</b>건 연결'];
        if (stat.bc) parts.push('바코드 ' + stat.bc + '건');
        if (stat.fuzzy) parts.push('이름 비슷 ' + stat.fuzzy + '건');
        if (stat.dup) parts.push('이미 담긴 ' + stat.dup + '건은 출고가만 갱신');
        if (stat.miss) parts.push('<b class="red">미매칭 ' + stat.miss + '건</b>');
        if (res.skipped.length) parts.push('건너뜀 ' + res.skipped.length + '줄');
        if (stat.derived) parts.push('공급가액÷수량으로 단가 계산 ' + stat.derived + '건');
        cmpNote(parts.join(' · ') +
          '<br><span class="note">미매칭 줄은 <b>우리 상품 연결</b>을 누르거나 원가를 직접 넣으면 마진이 계산됩니다.</span>', false);
      }
      if (err) {
        cmpNote('엑셀을 읽다가 멈췄습니다 · ' + esc(err && err.message ? err.message : '알 수 없는 오류') +
          '<br><span class="note">' + (S.cmp.rows.length > before ? '읽힌 ' + (S.cmp.rows.length - before) + '건은 위 목록에 그대로 담았습니다.' : '담긴 품목이 없습니다.') + '</span>', true);
        toast('엑셀을 끝까지 읽지 못했습니다 · 원인을 위에 표시했습니다', true);
        return;
      }
      toast((stat ? stat.read : 0) + '건 담았습니다' + (stat && stat.miss ? ' · 미매칭 ' + stat.miss + '건' : ''));
    }).catch(function (e) {
      cmpNote('엑셀 파일을 읽지 못했습니다 · ' + esc(e && e.message ? e.message : '알 수 없는 오류') +
        '<br><span class="note">xlsx·xls·csv 파일인지, 암호가 걸려 있지 않은지 확인해 주세요.</span>', true);
      toast('엑셀을 읽지 못했습니다 · 원인을 위에 표시했습니다', true);
    });
  }
  /* 올린 엑셀 결과 안내 (오류는 빨간 상자) */
  function cmpNote(html, isErr) {
    var el = $('#cmp-note');
    if (!el) return;
    if (!html) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = html;
    el.className = 'impnote' + (isErr ? ' err' : '');
    el.hidden = false;
  }

  /* ═════════════ 암호화 파일 만들기 ═════════════ */
  function makeEncFile() {
    promptBox('암호화 파일 만들기',
      '지금 단가표를 암호로 잠근 <b>data.enc.json</b> 파일을 만들어 내려받습니다.<br>새 비밀번호(8자 이상)를 정해 주세요.',
      { type: 'password', placeholder: '새 단가표 비밀번호', ok: '만들기' }).then(function (pw) {
      if (!pw) return;
      if (pw.length < 8) return toast('비밀번호는 8자 이상으로 정해 주세요', true);
      var payload = Object.assign({}, S.payload, { items: S.base, chRows: S.rowsBase, hana: S.hanaBase, built: new Date().toISOString().slice(0, 10) });
      var raw = C.enc(JSON.stringify(payload));
      var gz = Promise.resolve(null);
      if (typeof CompressionStream !== 'undefined') {
        var cs = new CompressionStream('gzip');
        gz = new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
      }
      gz.then(function (z) {
        var data = z || raw;
        var salt = crypto.getRandomValues(new Uint8Array(16));
        var iv = crypto.getRandomValues(new Uint8Array(12));
        return C.pbkdf2Key(pw, salt, 310000).then(function (key) {
          return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data).then(function (ct) {
            var header = {
              v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', it: 310000,
              salt: C.b64e(salt), iv: C.b64e(iv), zip: z ? 'gzip' : '',
              built: payload.built, n: payload.items.length, ct: C.b64e(new Uint8Array(ct))
            };
            var blob = new Blob([JSON.stringify(header)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'data.enc.json';
            document.body.appendChild(a); a.click(); a.remove();
            S.key = key;
            lsSet(K_META, { salt: header.salt, it: header.it });
            C.idbPut('dk', key);
            saveState();
            toast('data.enc.json 을 내려받았습니다 · GitHub에 올리면 모든 기기에 적용됩니다');
          });
        });
      }).catch(function (e) { toast(e.message || '파일을 만들지 못했습니다', true); });
    });
  }

  /* ═════════════ 잠금 · 시작 ═════════════ */
  function paintWho() {
    var s = sso();
    var nm = s ? (s.name || s.userId) : '';
    if (nm) {
      $('#top-nm').textContent = nm;
      $('#top-av').textContent = nm.slice(0, 1);
      $('#gate-who').hidden = false;
      $('#gate-nm').textContent = nm;
      $('#gate-av').textContent = nm.slice(0, 1);
      $('#top-sub').textContent = '원물 · 품목 · 가격비교 · ' + nm + '님';
    } else {
      $('#top-nm').textContent = '직접 열기';
      $('#top-av').textContent = '₩';
      $('#top-sub').textContent = '원물 · 품목 · 가격비교';
    }
  }
  function showApp() {
    document.body.dataset.view = 'app';
    $('#gate').hidden = true;
    $('#app').hidden = false;
    paintWho();
    renderMat(); renderAll(); renderCompare(); renderSet();
    paintSync();
    if (SYNC) SYNC.start();
    portalWrapNudge();
  }
  /* 포털 로그인은 되어 있는데 이 계정의 열쇠가 아직 연결되지 않은 기기에서 한 번만 안내 */
  function portalWrapNudge() {
    if (!SYNC || S.demo) return;
    var s = SYNC.ssoSession();
    if (!s) return;
    try { if (sessionStorage.getItem('pm.wrapnudge.v1')) return; } catch (e) {}
    if (SYNC.hasLocalWrap(s.userId)) return;
    try { sessionStorage.setItem('pm.wrapnudge.v1', '1'); } catch (e) {}
    setTimeout(function () {
      toast('설정 → 시트 동기화에서 열쇠를 연결하면 다음부터 포털 로그인만으로 열립니다');
    }, 2200);
  }
  function lockNow() {
    if (SYNC) SYNC.stop();
    S.key = null;
    C.idbDel('dk');
    lsDel(K_META);
    C.idbDel('payload');
    $('#app').hidden = true;
    $('#gate').hidden = false;
    document.body.dataset.view = 'gate';
    $('#gate-pw').value = '';
    $('#gate-msg').textContent = '잠갔습니다. 다음에는 비밀번호를 넣어 주세요.';
    $('#gate-msg').className = 'authmsg ok';
  }
  function unlock(pw, keep) {
    return fetchHeader().then(function (header) {
      return C.openBundle(header, pw).then(function (r) {
        S.header = header; S.key = r.key;
        setDoc(r.payload, true);
        if (keep) {
          C.idbPut('dk', r.key);
          lsSet(K_META, { salt: header.salt, it: header.it });
        }
        return C.sealJSON(r.key, r.payload, true).then(function (blob) {
          C.idbPut('payload', { built: header.built, blob: blob });
        }).then(function () { return loadBase(); }).then(function (b) {
          if (b && b.items && b.items.length) { setDoc(b); S.custom = true; }
          return restoreState(S.key);
        });
      });
    });
  }
  function restoreState(key) {
    var box = lsGet(K_STATE);
    if (!box) return Promise.resolve();
    return C.unsealJSON(key, box).then(function (st) {
      if (st && st.edits) {
        S.edits = Object.assign({ it: {}, row: {}, add: [], del: {}, log: [] }, st.edits);
        if (st.cmp && Array.isArray(st.cmp.rows)) S.cmp = Object.assign(S.cmp, st.cmp);
        if (st.stamp) S.stamp = Object.assign({ it: {}, row: {}, add: {}, del: {} }, st.stamp);
        S.wipe = Number(st.wipe) || 0;
        rebuild();
      }
    }).catch(function () { /* 이전 열쇠로 잠근 기록이면 그냥 새로 시작 */ });
  }
  function demoData() {
    var items = [], i = 0;
    var plan = [
      ['가상멸치', 9000, '건어물', [['150g', 0.15, 1.5], ['300g', 0.3, 1.55], ['500g', 0.5, 1.4], ['750g', 0.75, 1.35, '박스'], ['1kg', 1, 1.3]]],
      ['샘플김', 21000, '해조류', [['10매', 0.03, 1.6], ['30매', 0.09, 1.45], ['50매', 0.15, 1.4], ['100매', 0.3, 1.35]]],
      ['테스트땅콩', 12000, '견과류', [['200g', 0.2, 1.5], ['500g', 0.5, 1.4], ['1kg', 1, 1.3]]],
      ['연습오징어', 15000, '건어물', [['300g', 0.3, 1.55], ['700g', 0.7, 1.45], ['1kg', 1, 1.35]]],
      ['예시다시마', 7000, '해조류', [['100g', 0.1, 1.6], ['250g', 0.25, 1.5], ['500g', 0.5, 1.4]]],
      ['샘플북어', 18000, '건어물', [['200g', 0.2, 1.5], ['400g', 0.4, 1.45], ['1kg', 1, 1.3]]],
      ['연습새우', 22000, '수산물', [['100g', 0.1, 1.6], ['300g', 0.3, 1.5]]],
      ['예시미역', 8000, '해조류', [['50g', 0.05, 1.6], ['150g', 0.15, 1.5], ['500g', 0.5, 1.35]]],
      ['샘플버섯', 11000, '농산물', [['200g', 0.2, 1.5], ['500g', 0.5, 1.4]]]
    ];
    plan.forEach(function (g, gi) {
      g[3].forEach(function (v) {
        i++;
        items.push({
          id: 'd' + i, nm: g[0] + '_' + v[0], base: g[0], cat: g[2], tax: gi % 2 ? '과세' : '면세',
          bc: '8800000' + String(100000 + i), spec: '샘플/' + v[0], unit: 'ea',
          kg: g[1], wt: v[1], pack: v[3] || '', rate: v[2], note: '',
          ssrc: 'q', sdiv: 0.83, sdig: -1, ch: ['kd', 'farm', 'dbs', 'nh', 'fish', 'bg']
        });
      });
    });
    return {
      v: 1, built: new Date().toISOString().slice(0, 10), src: '샘플', chs: [
        { id: 'kd', label: '경덕(기본)' }, { id: 'farm', label: '파머스봉화' }, { id: 'dbs', label: '동부슈퍼조합' },
        { id: 'nh', label: '광양동부농협' }, { id: 'fish', label: '피쉬망고' }, { id: 'bg', label: '벌교노마진' }
      ], items: items, chRows: { farm: {}, dbs: {}, nh: {}, fish: {}, bg: {} }, hana: [
        { nm: '샘플오징어장족', kg: 25000, wt: 0.3, mat: '비닐', im: 0.3, vm: 0.23, note: '' },
        { nm: '샘플지리멸치', kg: 17000, wt: 0.15, mat: '비닐', im: 0.15, vm: 0.23, note: '' }
      ]
    };
  }

  /* ═════ろ════ 시트 동기화 · 포털 1회 로그인 ═════ろ════ */
  function dt(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function paintSync() {
    if (!SYNC) return;
    var st = SYNC.state(), txt = SYNC.statusText();
    var chip = $('#sync-chip');
    if ($('#sync-txt')) $('#sync-txt').textContent = txt;
    if (chip) {
      var cls = 'chip syncchip';
      if (st.status === 'ok') cls += ' ok';
      else if (st.status === 'error') cls += ' bad';
      else if (st.status === 'saving' || st.status === 'sync' || st.status === 'first') cls += ' busy';
      chip.className = cls;
      chip.title = (st.status === 'error' ? (st.lastErr || '동기화 실패') : '구글 시트와 동기화') + (st.ok || st.at ? ' · ' + dt(st.ok || st.at) : '');
    }
    var dot = $('#sync-dot');
    if (dot) dot.className = 'sdot ' + (st.status || '');
    var b = $('#set-sync-badge');
    if (b) {
      b.textContent = st.status === 'error' ? '오류' : (st.status === 'ok' ? '연결됨' : (st.status === 'off' ? '꺼짐' : '진행'));
      b.className = 'tag' + (st.status === 'error' ? ' red' : (st.status === 'ok' ? '' : ' gray'));
    }
    if ($('#set-sync-state')) $('#set-sync-state').textContent = txt;
    if ($('#set-sync-at')) $('#set-sync-at').textContent = st.ok ? dt(st.ok) : (st.at ? dt(st.at) : '-');
    if ($('#set-sync-rev')) $('#set-sync-rev').textContent = 'rev ' + (st.rev || 0);
  }
  function paintGateSso() {
    var el = $('#gate-sso');
    if (!el) return;
    var s = SYNC && SYNC.ssoSession();
    if (!s) { el.textContent = '통합 로그인으로 들어오면 단가표 비밀번호 없이 바로 열립니다.'; return; }
    el.textContent = (s.name || s.userId) + '님으로 포털에 로그인되어 있습니다 · 이 비밀번호를 한 번 넣으면 다음부터 포털만으로 열립니다.';
  }
  function paintPortalWrap() {
    var wrap = $('#set-portal-wrapwrap');
    if (!wrap || !SYNC) return;
    var s = SYNC.ssoSession();
    wrap.hidden = !s;
    var btn = $('#set-portal-wrap');
    if (!s || !btn) return;
    SYNC.hasKek(s.userId).then(function (has) {
      if (!has) { btn.textContent = '🔑 포털에서 한 번 더 로그인하면 자동 연결됩니다'; btn.disabled = true; return; }
      btn.disabled = false;
      btn.textContent = '🔗 포털 한 번 로그인으로 열기 연결';
    });
  }
  function afterMerge(n) {
    rebuild();
    saveState();
    renderMat(); renderAll(); renderCompare(); renderSet();
    if (S.cur.base && !$('#sheet').hidden) openSheet(S.cur.base);
    if (n) toast('다른 기기의 변경 ' + n + '건을 불러왔습니다');
  }
  function applyRemoteBase(base) {
    if (!base || !base.items || !base.items.length) return;
    setDoc({ v: 1, built: base.built, chs: base.chs, items: base.items, chRows: base.chRows || {}, hana: base.hana || [] });
    S.custom = true;
    saveBase();
  }
  /* 포털 로그인 상태면 단가표 비밀번호를 묻지 않고 열기 */
  function tryPortalUnlock() {
    if (!SYNC) return Promise.resolve(false);
    var s = SYNC.ssoSession();
    if (!s) return Promise.resolve(false);
    return SYNC.unwrap(s.userId).then(function (pw) {
      if (!pw) return false;
      return unlock(pw, true).then(function () {
        showApp();
        toast('통합 로그인으로 열었습니다');
        return true;
      }).catch(function () { return false; });
    });
  }
  function mintPortalWrap(pw) {
    if (!SYNC || !pw) return Promise.resolve(false);
    var s = SYNC.ssoSession();
    if (!s) return Promise.resolve(false);
    return SYNC.wrapMint(pw, s.userId).then(function (ok) { paintPortalWrap(); return ok; });
  }

  function boot() {
    paintWho();
    $('#gate-portal').href = '../';
    /* 보안(2026-11-27): 서버 토큰이 없거나 이 화면 권한이 없으면 포털 로그인으로 */
    if (window.KDWSEC && !KDWSEC.guard('price')) return;
    var demo = /(\?|&)demo=1/.test(location.search);
    if (demo) {
      S.demo = true;
      setDoc(demoData());
      showApp();
      toast('샘플 화면입니다 (가상 데이터)');
      return;
    }
    var meta = lsGet(K_META);
    C.idbGet('dk').then(function (key) {
      if (!key || !meta) return null;
      return fetchHeader().then(function (header) {
        if (header.salt !== meta.salt) return null;
        S.header = header;
        return loadPayload(header, key).then(function (payload) {
          S.key = key; setDoc(payload, true);
          return loadBase().then(function (b) {
            if (b && b.items && b.items.length) { setDoc(b); S.custom = true; }
            return restoreState(key);
          }).then(showApp);
        });
      }).catch(function () { return null; });
    }).then(function (done) {
      if (done) return;
      return tryPortalUnlock().then(function (ok) {
        if (ok) return;
        document.body.dataset.view = 'gate';
        $('#gate').hidden = false;
        paintGateSso();
      });
    });
  }

  /* ═════════════ 이벤트 ═════════════ */
  function wire() {
    $$('#tabs .tab').forEach(function (b) {
      b.onclick = function () {
        $$('#tabs .tab').forEach(function (x) { x.classList.toggle('on', x === b); });
        var t = b.dataset.tab;
        ['mat', 'all', 'cmp', 'set'].forEach(function (k) { $('#v-' + k).hidden = (k !== t); });
        if (t === 'all') renderAll();
        if (t === 'cmp') renderCompare();
        if (t === 'set') renderSet();
      };
    });
    $('#gate-go').onclick = function () {
      var pw = $('#gate-pw').value;
      if (!pw) return;
      var btn = this; btn.disabled = true;
      $('#gate-msg').className = 'authmsg';
      $('#gate-msg').textContent = '여는 중…';
      unlock(pw, $('#gate-keep').checked).then(function () {
        $('#gate-msg').textContent = '';
        showApp();
        mintPortalWrap(pw).then(function (ok) {
          if (ok) toast('포털 계정에 열쇠를 연결했습니다 · 이 계정의 다른 기기에서는 비밀번호를 묻지 않습니다');
        });
      }).catch(function (e) {
        var msg = (e && e.name === 'OperationError') ? '비밀번호가 맞지 않습니다' : (e.message || '열지 못했습니다');
        $('#gate-msg').textContent = msg;
        $('#gate-pw').select();
      }).then(function () { btn.disabled = false; });
    };
    $('#gate-pw').onkeydown = function (e) { if (e.key === 'Enter') $('#gate-go').click(); };
    $('#gate-xlsx').onclick = function () { pickFile('.xlsx,.xls,.csv', function (f) { importMaster(f); }); };
    $('#filein').onchange = function () {
      var f = this.files && this.files[0];
      var cb = this._cb;
      if (f && cb) setTimeout(function () { cb(f); }, 0);
    };
    $('#top-out').onclick = function () {
      ask('잠글까요?', '이 기기에 저장된 단가표 열쇠를 지웁니다.<br>다시 열려면 단가표 비밀번호가 필요합니다.', '잠그기', true)
        .then(function (ok) { if (ok) lockNow(); });
    };

    /* 원물 */
    $('#mat-q').oninput = C.debounce(function () {
      $('#mat-clr').hidden = !$('#mat-q').value;
      renderMat();
    }, 140);
    $('#mat-clr').onclick = function () { $('#mat-q').value = ''; this.hidden = true; renderMat(); };
    $('#mat-cat').onchange = renderMat;
    $('#mat-list').onclick = function (e) {
      var b = e.target.closest('.mcard'); if (!b) return;
      openSheet(b.dataset.base);
    };
    $('#sh-back').onclick = closeSheet;
    $('#sh-add').onclick = addItem;
    $('#sh-items').onclick = function (e) {
      var b = e.target.closest('.irow'); if (!b) return;
      openEdit(b.dataset.id);
    };
    $('#sh-kg').oninput = previewApply;
    moneyInput($('#sh-kg'));
    moneyInput($('#ed-kg'));
    function setKg(v) { $('#sh-kg').value = nfmt(Math.max(0, v || 0)); previewApply(); }
    $('#sh-quick').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      setKg((num($('#sh-kg').value) || 0) + (+b.dataset.v));
    };
    $('#sh-minus').onclick = function () { setKg((num($('#sh-kg').value) || 0) - 100); };
    $('#sh-plus').onclick = function () { setKg((num($('#sh-kg').value) || 0) + 100); };
    $('#sh-apply').onclick = applyKg;

    /* 전체품목 */
    $('#all-ch').onchange = function () { S.allLimit = 160; renderAll(); };
    $('#all-q').oninput = C.debounce(function () {
      $('#all-clr').hidden = !$('#all-q').value;
      S.allLimit = 160; renderAll();
    }, 140);
    $('#all-clr').onclick = function () { $('#all-q').value = ''; this.hidden = true; renderAll(); };
    $('#all-more').onclick = function () { S.allLimit += 200; renderAll(); };
    $('#all-list').onclick = function (e) {
      var b = e.target.closest('.prow'); if (!b) return;
      if (b.dataset.id) openEdit(b.dataset.id);
    };
    $('#all-export').onclick = exportChannel;
    $('#all-import').onclick = function () { pickFile('.xlsx,.xls,.csv', importMaster); };

    /* 편집 */
    $('#ed-back').onclick = closeEdit;
    $('#ed-save').onclick = saveEdit;
    $('#ed-del').onclick = delItem;
    ['#ed-kg', '#ed-wt', '#ed-rate', '#ed-pack', '#ed-auto'].forEach(function (s) {
      $(s).addEventListener('input', paintEditCalc);
      $(s).addEventListener('change', paintEditCalc);
    });

    /* 비교 */
    $('#cmp-ch').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.cmp.opt = b.dataset.opt; persistLocal(); renderCompare();
    };
    $('#cmp-basis').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.cmp.basis = b.dataset.b; persistLocal(); renderCompare();
    };
    $('#cust-rate').oninput = function () { S.cmp.cust.rate = num(this.value) || 1.3; persistLocal(); renderCompare(); };
    $('#cust-fee').oninput = function () { S.cmp.cust.fee = num(this.value) || 0; persistLocal(); renderCompare(); };
    $('#cmp-q').oninput = C.debounce(function () {
      $('#cmp-clr').hidden = !$('#cmp-q').value;
      renderSuggest($('#cmp-q').value);
    }, 120);
    $('#cmp-clr').onclick = function () { $('#cmp-q').value = ''; this.hidden = true; $('#cmp-sug').hidden = true; };
    $('#cmp-sug').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      addCmp(b.dataset.add);
      $('#cmp-sug').hidden = true;
      $('#cmp-q').value = ''; $('#cmp-clr').hidden = true;
    };
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#cmp-sug') && !e.target.closest('#cmp-q')) $('#cmp-sug').hidden = true;
    });
    $('#cmp-list').oninput = function (e) {
      var inp = e.target.closest('input[data-price]');
      if (inp) {
        var i = +inp.dataset.price;
        if (S.cmp.rows[i]) S.cmp.rows[i].price = num(inp.value);
        persistLocal();
        refreshCmpRow(inp.closest('.crow'), i);
        return;
      }
      var cst = e.target.closest('input[data-cost]');
      if (cst) {
        var j = +cst.dataset.cost;
        if (S.cmp.rows[j]) S.cmp.rows[j].cost = num(cst.value);
        persistLocal();
        refreshCmpRow(cst.closest('.crow'), j);
      }
    };
    $('#cmp-list').onclick = function (e) {
      var b = e.target.closest('button[data-rm]');
      if (b) { S.cmp.rows.splice(+b.dataset.rm, 1); persistLocal(); renderCompare(); return; }
      var lk = e.target.closest('button[data-link]');
      if (lk) { linkItemPrompt(+lk.dataset.link); return; }
      var to = e.target.closest('button[data-linkto]');
      if (to) {
        var p = String(to.dataset.linkto).split('|');
        linkCmpRow(+p[0], p[1]);
      }
    };
    $('#cmp-import').onclick = function () { pickFile('.xlsx,.xls,.csv', importCompare); };
    $('#cmp-clear').onclick = function () {
      if (!S.cmp.rows.length) return;
      ask('비교 목록 비우기', '담아 둔 비교 목록을 모두 지울까요?', '비우기', true).then(function (ok) {
        if (!ok) return;
        S.cmp.rows = []; persistLocal(); cmpNote(''); renderCompare();
      });
    };
    $('#cmp-export').onclick = exportCompare;

    /* 설정 */
    $('#set-sync-now').onclick = function () {
      toast('시트와 동기화합니다…');
      SYNC.pull(false).then(function (n) { if (!n) SYNC.push(); });
    };
    $('#set-sync-pull').onclick = function () {
      SYNC.pull(true).then(function (n) {
        toast(n ? '다른 기기 변경 ' + n + '건을 받았습니다' : '시트에 새 변경이 없습니다');
      });
    };
    $('#sync-chip').onclick = function () {
      var st = SYNC.state();
      if (st.status === 'error') { toast('다시 시도합니다…'); SYNC.push(); return; }
      SYNC.pull(false).then(function (n) { if (!n) SYNC.push(); toast('시트와 맞쳤습니다'); });
    };
    $('#set-portal-wrap').onclick = function () {
      var s = SYNC.ssoSession();
      if (!s) return toast('통합포털에서 로그인한 뒤 다시 시도해 주세요', true);
      promptBox('포털에 열쇠 연결',
        '단가표 비밀번호를 <b>한 번만</b> 넣으면, 이 포털 계정(' + esc(s.name || s.userId) + ')으로는 어느 기기에서든 비밀번호를 묻지 않고 열립니다.<br>열쇠는 포털 로그인 비밀번호로만 풀리는 암호문으로 보관됩니다.',
        { type: 'password', placeholder: '단가표 비밀번호', ok: '연결' }).then(function (pw) {
        if (!pw) return;
        mintPortalWrap(pw).then(function (ok) {
          toast(ok ? '포털 계정에 열쇠를 연결했습니다' : '연결하지 못했습니다 · 포털에서 다시 로그인한 뒤 시도해 주세요', !ok);
        });
      });
    };
    $('#set-export').onclick = exportEnriched;
    $('#set-import').onclick = function () { pickFile('.xlsx,.xls,.csv', importMaster); };
    $('#set-encurl2').onclick = makeEncFile;
    $('#set-baseoff').onclick = function () {
      ask('원래 단가표로', '올린 엑셀 대신 처음 받은 암호화 단가표로 돌아갑니다.<br>이 기기에서 바꾼 단가 수정도 함께 지워집니다.', '되돌리기', true).then(function (ok) {
        if (!ok) return;
        lsDel(K_BASE); S.custom = false;
        setDoc(S.origin || S.payload);
        S.edits = { it: {}, row: {}, add: [], del: {}, log: [] };
        S.stamp = { it: {}, row: {}, add: {}, del: {} };
        S.wipe = Date.now();
        rebuild(); persistLocal();
        renderMat(); renderAll(); renderCompare(); renderSet();
        toast('원래 단가표로 돌아갔습니다');
      });
    };
    $('#set-undo').onclick = undoLast;
    $('#set-lock').onclick = function () {
      ask('잠글까요?', '이 기기에 저장된 단가표 열쇠를 지웁니다.<br>다시 열려면 단가표 비밀번호가 필요합니다.', '잠그기', true)
        .then(function (ok) { if (ok) lockNow(); });
    };
    $('#set-reset').onclick = function () {
      ask('처음 단가로 되돌리기', '이 기기에서 바꾼 <b>모든 단가 수정</b>을 지우고 처음 받은 단가표로 돌아갑니다.', '되돌리기', true).then(function (ok) {
        if (!ok) return;
        S.edits = { it: {}, row: {}, add: [], del: {}, log: [] };
        S.stamp = { it: {}, row: {}, add: {}, del: {} };
        S.wipe = Date.now();
        rebuild(); persistLocal();
        renderMat(); renderAll(); renderCompare(); renderSet();
        toast('처음 단가로 돌아갔습니다');
      });
    };
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#modal').hidden) { $('#modal').hidden = true; return; }
      if (!$('#esheet').hidden) { closeEdit(); return; }
      if (!$('#sheet').hidden) { closeSheet(); }
    });
  }

  if (SYNC) SYNC.init(S, { paint: function () { paintSync(); }, afterMerge: afterMerge, applyBase: applyRemoteBase });

  document.addEventListener('DOMContentLoaded', function () { wire(); boot(); });

  /* 디버깅·검증용 (화면에는 영향 없음) */
  window.PM = {
    state: function () { return S; },
    priceOf: priceOf, calc: calc, calcHana: calcHana, compareCalc: compareCalc,
    groups: groups, statusOf: statusOf
  };
})();
