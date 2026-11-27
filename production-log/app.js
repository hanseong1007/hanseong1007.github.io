/* 경덕농수산 생산일지 — 화면 */
(function () {
  'use strict';
  var K = window.KD, $ = K.$, $$ = K.$$, esc = K.esc, toast = K.toast;

  var store = null, rawStore = null, log = null, editMode = false, rawItems = [], me = null;
  var role = 'staff', isAdmin = false, readingOnly = false;

  function myRole() {
    if (!me) return 'staff';
    if (me.role === 'admin' || String(me.userId) === 'admin') return 'all';
    var r = String(me.apprRole || 'staff');
    return (r === 'chief' || r === 'ceo' || r === 'all') ? r : 'staff';
  }
  function canChief() { return role === 'chief' || role === 'all'; }
  function canCeo() { return role === 'ceo' || role === 'all'; }
  function isWriter(l) { return l && me && l.writerId === String(me.userId); }
  function canEdit(l) {
    if (!l) return false;
    if (isWriter(l) && (l.status === 'draft' || l.status === 'reject')) return true;
    return role === 'all' && (l.status === 'draft' || l.status === 'reject');
  }

  /* ───────── 시작 ───────── */
  function paintSync() {
    var c = $('#sync-chip'); if (!c || !store) return;
    c.textContent = store.statusText();
    c.className = 'chip sync' + (store.status === 'ok' ? ' ok' : (store.status === 'error' ? ' err' : ''));
  }
  function show(which) {
    ['gate-nosession', 'gate-lock', 'gate-new'].forEach(function (id) { $('#' + id).hidden = (id !== which); });
    $('#app').hidden = !!which;
  }
  function boot() {
    /* 보안(2026-11-27): 서버 토큰이 없거나 이 화면 권한이 없으면 포털 로그인으로 */
    if (window.KDWSEC && !KDWSEC.guard('prod')) return;
    me = K.session();
    if (!me) { show('gate-nosession'); return; }
    role = myRole();
    $('#who-chip').hidden = false;
    $('#who-chip').textContent = me.name || me.userId;
    $('#app').hidden = true;
    store = new K.Store('prod');
    window.__kdProd = store;
    store.hooks = { paint: paintSync, afterPull: function () { renderList(); renderInbox(); } };
    store.unlock().then(function (r) {
      if (r.ok) { openApp(); return; }
      if (r.reason === 'nokek' || r.reason === 'nosession') { show('gate-nosession'); return; }
      return K.api({ action: 'get', doc: 'prod' }).then(function (j) {
        if (j.iv) show('gate-lock'); else show('gate-new');
      }).catch(function (e) {
        show('gate-lock'); $('#lock-msg').textContent = '시트에 연결하지 못했습니다 · ' + K.errText(e);
      });
    });
  }
  function openApp() {
    show(null); $('#app').hidden = false;
    var t = K.todayIso();
    $('#f-from').value = t.slice(0, 8) + '01';
    $('#f-to').value = t;
    store.start();
    loadRaw();
    renderList(); renderInbox();
  }
  function loadRaw() {
    rawStore = new K.Store('raw');
    rawStore.hooks = {
      paint: function () {},
      afterPull: function () {
        rawItems = rawStore.list();
        if (!$('#modal-pick').hidden) renderPickList();
        if (log && !$('#modal-edit').hidden) renderRows();
      }
    };
    rawStore.unlock().then(function (r) {
      if (!r.ok) { rawItems = []; return; }
      rawItems = rawStore.list();
      rawStore.start();
    }).catch(function () { rawItems = []; });
  }
  $('#btn-set').onclick = function () { if (store) openSet(); };
  $('#btn-gate-portal').onclick = K.goPortal;
  $('#btn-portal').onclick = K.goPortal;
  $('#sync-chip').onclick = function () { store.push().then(function (ok) { if (ok) toast('시트에 저장했습니다'); }); };
  $('#who-chip').onclick = openSet;
  $('#btn-lock').onclick = function () {
    var pw = $('#lock-pw').value.trim();
    if (!pw) { $('#lock-msg').textContent = '비밀번호를 넣어 주세요'; return; }
    $('#lock-msg').textContent = '확인 중…';
    store.unlockWith(pw).then(function (r) {
      if (r.ok) { toast('자료를 열었습니다'); openApp(); return; }
      $('#lock-msg').textContent = (r.reason === 'badpw') ? '비밀번호가 맞지 않습니다' :
        (r.reason === 'nodata' ? '시트에 자료가 없습니다 · 새로 시작해 주세요' : ('열지 못했습니다 · ' + (r.error || '')));
    });
  };
  $('#lock-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#btn-lock').click(); });
  $('#btn-new').onclick = function () {
    show(null);
    store.initNew().then(function () {
      $('#new-pw-note').textContent = '만들어진 자료 비밀번호: ' + store.password;
      openApp(); toast('자료를 만들었습니다');
    }).catch(function (e) { toast('시작하지 못했습니다 · ' + K.errText(e), true); show('gate-new'); });
  };

  /* ───────── 상태 ───────── */
  var ST = {
    draft: { t: '작성중', c: 'gray' }, chief: { t: '부장 결재 대기', c: 'warn' },
    ceo: { t: '대표 결재 대기', c: 'blue' }, done: { t: '승인완료', c: '' },
    reject: { t: '반려', c: 'red' }, cancel: { t: '회수', c: 'gray' }
  };
  function stBadge(s) { var x = ST[s] || ST.draft; return '<span class="badge ' + x.c + '">' + x.t + '</span>'; }
  function logs() { return store ? store.list().filter(function (l) { return l && l.date; }) : []; }

  function renderList() {
    var from = $('#f-from').value, to = $('#f-to').value, fs = $('#f-status').value;
    var all = logs().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || (b.updatedAt || 0) - (a.updatedAt || 0); });
    var mine = all.filter(function (l) { return isWriter(l) || role !== 'staff'; });
    var hit = mine.filter(function (l) {
      if (from && l.date < from) return false;
      if (to && l.date > to) return false;
      if (fs && l.status !== fs) return false;
      return true;
    });
    $('#count-line').textContent = hit.length ? (hit.length + '건') : '0건';
    $('#list-empty').hidden = hit.length > 0;
    $('#log-list').innerHTML = hit.map(function (l) {
      var names = (l.rows || []).map(function (r) { return r.name; }).filter(Boolean);
      return '<button class="log" type="button" data-log="' + esc(l.id) + '" style="display:block;width:100%;text-align:left;border:1px solid var(--line)">' +
        '<span class="top"><b>' + esc(K.fmtDateKo(l.date)) + '</b><span class="tb-sp" style="flex:1"></span>' + stBadge(l.status) + '</span>' +
        '<span class="meta"><span>' + esc(l.writerName || '') + '</span><span>품목 ' + (l.rows || []).length + '개</span>' +
        (totalQty(l) ? '<span>수량 ' + totalQty(l) + '</span>' : '') + '</span>' +
        '<span class="rows">' + esc(names.slice(0, 6).join(', ') || '품목 없음') + (names.length > 6 ? ' 외' : '') + '</span>' +
        '</button>';
    }).join('');
  }
  function totalQty(l) {
    var n = 0, any = false;
    (l.rows || []).forEach(function (r) {
      var v = parseFloat(String(r.qty || '').replace(/[^\d.\-]/g, ''));
      if (!isNaN(v)) { n += v; any = true; }
    });
    return any ? (Math.round(n * 100) / 100) : '';
  }
  $('#log-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-log]');
    if (b) openLog(b.getAttribute('data-log'));
  });
  ['#f-from', '#f-to', '#f-status'].forEach(function (s) { $(s).addEventListener('change', renderList); });

  function pendingForMe() {
    return logs().filter(function (l) {
      if (l.status === 'chief' && canChief()) return true;
      if (l.status === 'ceo' && canCeo()) return true;
      return false;
    });
  }
  function renderInbox() {
    var n = pendingForMe().length;
    var b = $('#inbox-badge');
    if (!b) return;
    b.hidden = n === 0;
    b.textContent = n;
  }
  $('#btn-inbox').onclick = function () {
    var list = pendingForMe();
    if (!list.length) { toast('결재할 문서가 없습니다'); return; }
    openLog(list[0].id, true);
  };

  /* ───────── 작성/보기 ───────── */
  $('#btn-new-log').onclick = function () {
    log = { id: '', date: K.todayIso(), writerId: String(me.userId), writerName: me.name || me.userId,
            rows: [blankRow()], status: 'draft', steps: {}, memo: '', createdAt: Date.now() };
    editMode = true; readingOnly = false;
    renderEditor();
    open('#modal-edit');
  };
  function blankRow() { return { name: '', rmId: '', origin: '', expiry: '', workTime: '오전', weight: '', qty: '', note: '' }; }

  function openLog(id, focusApprove) {
    var l = store.get(id); if (!l) return;
    log = JSON.parse(JSON.stringify(l));
    editMode = canEdit(l);
    readingOnly = !editMode;
    renderEditor();
    open('#modal-edit');
    if (focusApprove && canIApproveNow(l)) setTimeout(openApprove, 120);
  }
  function canIApproveNow(l) {
    return (l.status === 'chief' && canChief()) || (l.status === 'ceo' && canCeo());
  }

  function stepText(l, key) {
    var st = (l.steps || {})[key] || {};
    if (!st.name) return '';
    var nm = st.name + (st.at ? ' · ' + shortAt(st.at) : '');
    if (st.state === 'no') nm += ' 반려';
    return nm;
  }
  function shortAt(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '.' + d.getDate() + ' ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }
  function apprLine(l) {
    var w = (l.steps || {}).writer || {};
    var c = (l.steps || {}).chief || {};
    var e = (l.steps || {}).ceo || {};
    function box(t, name, at, st) {
      var cls = st === 'no' ? 'no' : (st === 'ok' ? 'ok' : (l.status === 'chief' && t === '부장' ? 'wait' : (l.status === 'ceo' && t === '대표이사' ? 'wait' : '')));
      return '<div class="box ' + cls + '"><div class="t">' + t + '</div><div class="s">' +
        (name ? esc(name) + (at ? '<br>' + shortAt(at) : '') : '—') + '</div></div>';
    }
    return box('담당자', w.name || l.writerName, w.at || 0, w.state || (l.status !== 'draft' ? 'ok' : '')) +
      box('부장', c.name, c.at, c.state) + box('대표이사', e.name, e.at, e.state);
  }
  function statusNote(l) {
    if (l.status === 'draft') return editMode ? '작성 중입니다 · 상신하면 부장 결재로 넘어갑니다.' : '작성 중인 일지입니다.';
    if (l.status === 'chief') return (canChief() ? '내가 결재할 차례입니다. 아래 상신 취소는 작성자만 됩니다.' : '부장 결재를 기다리고 있습니다.');
    if (l.status === 'ceo') return (canCeo() ? '내가 결재할 차례입니다.' : '대표이사 결재를 기다리고 있습니다.');
    if (l.status === 'done') return '결재가 끝난 일지입니다.';
    if (l.status === 'reject') return '반려된 일지입니다 · 고쳐서 다시 상신할 수 있습니다.';
    return '';
  }

  function renderEditor() {
    $('#e-title').textContent = log.id ? (editMode ? '생산일지 수정' : '생산일지') : '새 생산일지';
    $('#e-date').value = log.date || K.todayIso();
    $('#e-date').disabled = !editMode;
    $('#e-writer').value = log.writerName || (me && me.name) || '';
    $('#e-memo').value = log.memo || '';
    $('#e-memo').disabled = !editMode;
    $('#appr-line').innerHTML = apprLine(log);
    $('#e-status-note').textContent = statusNote(log);
    $('#btn-add-item').hidden = !editMode;
    $('#btn-add-free').hidden = !editMode;
    renderRows();
    renderFoot();
  }
  function renderRows() {
    var tb = $('#rows-body');
    var rows = log.rows || [];
    tb.innerHTML = rows.map(function (r, i) {
      var cam = r.rmId ? rawStore && rawStore.get(r.rmId) : null;
      var photo = cam && cam.photos && cam.photos.length ? cam.photos[0] : null;
      return '<tr data-row="' + i + '">' +
        '<td class="no">' + (i + 1) + '</td>' +
        '<td class="name"><div class="nm">' +
        '<img class="thumb" id="rt-' + i + '" alt="" src="" ' + (photo ? '' : 'hidden') + '>' +
        '<input data-f="name" data-i="' + i + '" value="' + esc(r.name || '') + '" placeholder="제품명" ' + (editMode ? '' : 'disabled') + '>' +
        (editMode ? '<button type="button" data-pick="' + i + '">찾기</button>' : '') +
        '</div></td>' +
        '<td><input data-f="origin" data-i="' + i + '" value="' + esc(r.origin || '') + '" placeholder="원산지" ' + (editMode ? '' : 'disabled') + '></td>' +
        '<td><input data-f="expiry" data-i="' + i + '" value="' + esc(r.expiry || '') + '" placeholder="27.10.29" ' + (editMode ? '' : 'disabled') + '></td>' +
        '<td><input data-f="workTime" data-i="' + i + '" value="' + esc(r.workTime || '') + '" placeholder="오전" ' + (editMode ? '' : 'disabled') + '></td>' +
        '<td><input data-f="weight" data-i="' + i + '" value="' + esc(r.weight || '') + '" placeholder="1k" ' + (editMode ? '' : 'disabled') + '></td>' +
        '<td><input data-f="qty" data-i="' + i + '" value="' + esc(r.qty || '') + '" placeholder="수량" inputmode="decimal" ' + (editMode ? '' : 'disabled') + '></td>' +
        '<td class="del">' + (editMode ? '<button type="button" data-del="' + i + '">×</button>' : '') + '</td>' +
        '</tr>';
    }).join('') + (editMode ? '' : '');
    /* 품목 사진 미리보기 */
    rows.forEach(function (r, i) {
      var cam = r.rmId && rawStore ? rawStore.get(r.rmId) : null;
      var p = cam && cam.photos && cam.photos[0];
      var img = document.getElementById('rt-' + i);
      if (!p || !img) return;
      if (rawStore.photoCache[p.id]) { img.src = rawStore.photoCache[p.id]; img.hidden = false; }
      else rawStore.getPhoto(p.id).then(function (url) { if (url) { img.src = url; img.hidden = false; } });
    });
  }
  $('#rows-body').addEventListener('input', function (e) {
    var el = e.target.closest('[data-f]'); if (!el) return;
    var i = +el.getAttribute('data-i'), f = el.getAttribute('data-f');
    if (!log.rows[i]) return;
    log.rows[i][f] = el.value;
  });
  $('#rows-body').addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]');
    if (d) {
      var i = +d.getAttribute('data-del');
      log.rows.splice(i, 1);
      if (!log.rows.length) log.rows.push(blankRow());
      renderRows(); return;
    }
    var p = e.target.closest('[data-pick]');
    if (p) { pickTarget = +p.getAttribute('data-pick'); openPicker('search'); }
  });
  $('#btn-add-item').onclick = function () { pickTarget = -1; openPicker('search'); };
  $('#btn-add-free').onclick = function () {
    log.rows.push(blankRow());
    renderRows();
    var inputs = $$('#rows-body input[data-f="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  };

  function renderFoot() {
    var f = $('#e-foot');
    var btns = [];
    if (editMode) {
      btns.push('<button class="btn gray" id="f-del" type="button" style="flex:0 0 74px">삭제</button>');
      btns.push('<button class="btn soft" id="f-save" type="button">임시저장</button>');
      btns.push('<button class="btn" id="f-submit" type="button">상신</button>');
    } else {
      btns.push('<button class="btn gray" id="f-print" type="button" style="flex:0 0 96px">인쇄</button>');
      if (canIApproveNow(log)) btns.push('<button class="btn" id="f-approve" type="button">결재</button>');
      if (log.status === 'chief' && isWriter(log)) btns.push('<button class="btn soft" id="f-cancel" type="button">상신 취소</button>');
      if (log.status === 'reject' && isWriter(log)) btns.push('<button class="btn soft" id="f-rewrite" type="button">다시 쓰기</button>');
    }
    f.innerHTML = btns.join('');
    $('#e-close').onclick = function () { close('#modal-edit'); };
    if ($('#f-save')) $('#f-save').onclick = function () { save(false); };
    if ($('#f-submit')) $('#f-submit').onclick = function () { save(true); };
    if ($('#f-del')) $('#f-del').onclick = delLog;
    if ($('#f-print')) $('#f-print').onclick = function () { printLog(log); };
    if ($('#f-approve')) $('#f-approve').onclick = openApprove;
    if ($('#f-cancel')) $('#f-cancel').onclick = function () {
      if (!confirm('상신을 취소하고 작성중으로 되돌릴까요?')) return;
      log.status = 'draft';
      if (log.steps) delete log.steps.writer;
      store.put(log).then(function () { store.push(); close('#modal-edit'); renderList(); toast('상신을 취소했습니다'); });
    };
    if ($('#f-rewrite')) $('#f-rewrite').onclick = function () {
      editMode = true; readingOnly = false; renderEditor();
    };
  }
  function collectRows() {
    log.date = $('#e-date').value || K.todayIso();
    log.memo = $('#e-memo').value;
    log.rows = (log.rows || []).filter(function (r) { return String(r.name || '').trim() || String(r.qty || '').trim(); });
    if (!log.rows.length) log.rows = [blankRow()];
  }
  function save(submit) {
    collectRows();
    var named = (log.rows || []).filter(function (r) { return String(r.name || '').trim(); });
    if (!named.length) { toast('품목을 한 개 이상 넣어 주세요', true); return; }
    log.date = log.date;
    if (!log.id) { log.createdAt = Date.now(); log.writerId = String(me.userId); log.writerName = me.name || me.userId; }
    if (submit) {
      log.status = 'chief';
      log.steps = log.steps || {};
      log.steps.writer = { name: me.name || me.userId, at: Date.now(), state: 'ok' };
      if (log.steps.chief && log.steps.chief.state === 'no') delete log.steps.chief;
    } else if (!log.status || log.status === 'draft') {
      log.status = 'draft';
    }
    store.put(log).then(function (saved) {
      log = JSON.parse(JSON.stringify(saved));
      editMode = canEdit(log);
      store.push();
      renderList(); renderInbox();
      if (submit) { toast('상신했습니다 · 부장 결재로 넘어갑니다'); close('#modal-edit'); }
      else { toast('저장했습니다 · 시트에 올리는 중'); renderEditor(); }
    });
  }
  function delLog() {
    if (!log.id) { close('#modal-edit'); return; }
    if (!confirm('이 생산일지를 삭제할까요?')) return;
    store.remove(log.id);
    store.push(); close('#modal-edit'); renderList();
    toast('삭제했습니다');
  }

  /* ───────── 결재 ───────── */
  function openApprove() {
    var steps = log.steps || {};
    var next = null, label = '';
    if (log.status === 'chief' && canChief()) { next = 'chief'; label = '부장 결재'; }
    else if (log.status === 'ceo' && canCeo()) { next = 'ceo'; label = '대표이사 결재'; }
    if (!next) return;
    $('#a-body').innerHTML =
      '<p class="mini" style="margin:0 0 6px">' + esc(K.fmtDateKo(log.date)) + ' · ' + esc(log.writerName || '') + ' 작성</p>' +
      '<div class="tblwrap" style="margin-bottom:10px"><table class="rows" style="min-width:0"><tbody>' +
      (log.rows || []).map(function (r, i) {
        return '<tr><td class="no">' + (i + 1) + '</td><td style="text-align:left;padding:5px 6px">' + esc(r.name) +
          '<span class="mini"> ' + esc([r.origin, r.expiry, r.workTime, r.weight, r.qty].filter(Boolean).join(' · ')) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="field"><label class="lbl" for="a-comment">결재 의견 (선택)</label>' +
      '<textarea class="inp" id="a-comment" placeholder="반려할 때 이유를 적어 주세요"></textarea></div>' +
      '<p class="note">' + esc(label) + ' 단계입니다. 승인하면 ' + (next === 'chief' ? '대표이사 결재로 넘어갑니다.' : '결재가 끝납니다.') + '</p>';
    $('#a-foot').innerHTML = '<button class="btn danger" id="a-no" type="button">반려</button>' +
      '<button class="btn" id="a-ok" type="button">승인</button>';
    $('#a-ok').onclick = function () { decide(next, 'ok'); };
    $('#a-no').onclick = function () { decide(next, 'no'); };
    open('#modal-approve');
  }
  $('#a-close').onclick = function () { close('#modal-approve'); };
  function decide(step, state) {
    var cm = ($('#a-comment') && $('#a-comment').value || '').trim();
    log.steps = log.steps || {};
    log.steps[step] = { name: me.name || me.userId, at: Date.now(), state: state, comment: cm };
    if (state === 'no') log.status = 'reject';
    else if (step === 'chief') log.status = 'ceo';
    else log.status = 'done';
    store.put(log).then(function (saved) {
      log = JSON.parse(JSON.stringify(saved));
      store.push();
      close('#modal-approve'); close('#modal-edit');
      renderList(); renderInbox();
      if (state === 'no') toast('반려했습니다');
      else if (step === 'chief') toast('부장 승인 · 대표이사 결재로 넘어갑니다');
      else toast('결재가 끝났습니다');
    });
  }

  /* ───────── 품목 고르기 ───────── */
  var pickTarget = -1, pickTab = 'search', scanTimer = null, scanStream = null;
  function openPicker(tab) {
    renderPickList();
    if (!rawItems.length && rawStore && rawStore.ready && rawStore.ready()) {
      rawStore.pull(true).then(function () { rawItems = rawStore.list(); renderPickList(); }).catch(function () {});
    }
    $('#p-q').value = '';
    $('#p-code').value = '';
    $('#p-photo-list').innerHTML = '';
    setTab(tab || 'search');
    open('#modal-pick');
    if (tab === 'search') setTimeout(function () { $('#p-q').focus(); }, 100);
  }
  function setTab(t) {
    pickTab = t;
    $$('#pick-tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
    $('#tab-search').hidden = (t !== 'search');
    $('#tab-code').hidden = (t !== 'code');
    $('#tab-photo').hidden = (t !== 'photo');
    if (t !== 'code') stopScan();
  }
  $$('#pick-tabs button').forEach(function (b) { b.onclick = function () { setTab(b.getAttribute('data-tab')); }; });
  $('#p-close').onclick = function () { stopScan(); close('#modal-pick'); };

  function renderPickList() {
    var q = $('#p-q') ? ($('#p-q').value || '') : '';
    var hit = (rawItems || []).filter(function (it) { return K.matchQuery(it.name, q) || K.matchQuery(it.aliases, q) || K.matchQuery(it.barcode, q); })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ko'); });
    $('#p-list').innerHTML = hit.length ? hit.slice(0, 120).map(pickRowHtml).join('') :
      '<div class="empty">' + (rawItems.length ? '검색 결과가 없습니다.' : '원물 정보를 불러오는 중입니다…<br>잠시 뒤 다시 열어 주세요. 처음이면 원물 정보 앱에서 품목을 먼저 등록해 주세요.') + '</div>';
  }
  function pickRowHtml(it) {
    var vr = (it.expVariants || []).filter(function (v) { return v.date; }).map(function (v) {
      var lb = String(v.label || '');
      if (lb.indexOf(it.name) === 0) lb = lb.slice(it.name.length).trim();
      return lb + ' ' + K.fmtDateShort(v.date);
    }).join(' / ');
    return '<div class="pickrow"><div><b>' + esc(it.name) +
      (it.category ? '<span class="tagm">' + esc(it.category) + '</span>' : '') + '</b><span>' +
      esc([it.origin, K.fmtDateShort(expiryOf(it)), it.weight, it.barcode].filter(Boolean).join(' · ') || '—') + '</span>' +
      (vr ? '<span>규격별 ' + esc(vr) + '</span>' : '') +
      '</div><button class="go" type="button" data-add="' + esc(it.id) + '">넣기</button></div>';
  }
  function expiryOf(it) {
    if (!it) return '';
    if (it.expiryDate) return it.expiryDate;
    if (it.madeDate && it.expNum) {
      var m = it.expUnit === 'year' ? it.expNum * 12 : (it.expUnit === 'day' ? null : it.expNum);
      if (it.expUnit === 'day') { var d = new Date(it.madeDate); d.setDate(d.getDate() + it.expNum); return K.isoDate(d); }
      return K.addMonths(it.madeDate, m);
    }
    return '';
  }
  $('#p-q').addEventListener('input', renderPickList);
  $('#p-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-add]'); if (!b) return;
    addItem(b.getAttribute('data-add'));
  });
  $('#p-code-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-add]'); if (!b) return;
    addItem(b.getAttribute('data-add'));
  });
  $('#p-photo-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-add]'); if (!b) return;
    addItem(b.getAttribute('data-add'));
  });

  function addItem(rmId) {
    var it = null;
    for (var i = 0; i < rawItems.length; i++) if (rawItems[i].id === rmId) { it = rawItems[i]; break; }
    if (!it && rawStore) it = rawStore.get(rmId);
    if (!it) { toast('품목을 찾지 못했습니다', true); return; }
    var row = {
      name: it.name, rmId: it.id, origin: it.origin || '', expiry: K.fmtDateShort(expiryOf(it)),
      workTime: lastWorkTime(), weight: it.weight || '', qty: '', note: ''
    };
    applyRow(row);
    stopScan(); close('#modal-pick');
    toast(it.name + ' 을(를) 넣었습니다 · ' + [it.origin, K.fmtDateShort(expiryOf(it))].filter(Boolean).join(' / '));
  }
  function lastWorkTime() {
    var rows = (log && log.rows) || [];
    for (var i = rows.length - 1; i >= 0; i--) if (rows[i].workTime) return rows[i].workTime;
    return '오전';
  }
  function applyRow(row) {
    var target = -1;
    if (pickTarget >= 0 && log.rows[pickTarget]) { log.rows[pickTarget] = row; target = pickTarget; }
    else {
      /* 빈 줄이 있으면 그 줄을 채운다 (새 일지는 빈 줄 1개로 시작) */
      for (var i = 0; i < (log.rows || []).length; i++) {
        var r = log.rows[i];
        if (!String(r.name || '').trim() && !String(r.qty || '').trim()) { target = i; break; }
      }
      if (target >= 0) log.rows[target] = row;
      else { log.rows = log.rows || []; log.rows.push(row); target = log.rows.length - 1; }
    }
    renderRows();
    var q = document.querySelector('#rows-body tr[data-row="' + target + '"] [data-f="qty"]');
    if (q) q.focus();
  }

  /* 바코드 */
  $('#p-code-go').onclick = function () {
    var v = ($('#p-code').value || '').replace(/\s+/g, '');
    if (!v) return;
    var hit = (rawItems || []).filter(function (it) { return String(it.barcode || '').replace(/\s+/g, '') === v; });
    if (!hit.length) hit = (rawItems || []).filter(function (it) { return K.matchQuery(it.name, v); });
    if (!hit.length) { $('#p-code-msg').textContent = '바코드 ' + v + ' 에 맞는 품목이 없습니다.'; $('#p-code-list').innerHTML = ''; return; }
    $('#p-code-msg').textContent = hit.length + '건 찾았습니다.';
    $('#p-code-list').innerHTML = hit.map(pickRowHtml).join('');
    if (hit.length === 1) addItem(hit[0].id);
  };
  $('#p-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#p-code-go').click(); });
  $('#p-scan').onclick = startScan;
  $('#p-scan-stop').onclick = stopScan;
  function stopScan() {
    if (scanTimer) { cancelAnimationFrame(scanTimer); scanTimer = null; }
    if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; }
    var v = $('#p-video'); if (v) { v.hidden = true; v.srcObject = null; }
  }
  function startScan() {
    var v = $('#p-video');
    if (!('BarcodeDetector' in window)) {
      $('#p-code-msg').textContent = '이 브라우저는 카메라 바코드 스캔을 지원하지 않습니다 · 바코드 숫자를 직접 넣어 주세요.';
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('#p-code-msg').textContent = '카메라를 쓸 수 없습니다 · 바코드 숫자를 직접 넣어 주세요.';
      return;
    }
    var det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (st) {
      scanStream = st;
      v.hidden = false; v.srcObject = st;
      return v.play();
    }).then(function () {
      $('#p-code-msg').textContent = '바코드를 카메라에 비춰 주세요…';
      var tick = function () {
        if (!scanStream) return;
        det.detect(v).then(function (codes) {
          if (codes && codes.length) {
            var val = codes[0].rawValue || '';
            $('#p-code').value = val;
            stopScan();
            $('#p-code-go').click();
            return;
          }
          scanTimer = requestAnimationFrame(tick);
        }).catch(function () { scanTimer = requestAnimationFrame(tick); });
      };
      scanTimer = requestAnimationFrame(tick);
    }).catch(function (e) {
      $('#p-code-msg').textContent = '카메라를 열지 못했습니다 · 바코드 숫자를 직접 넣어 주세요. (' + (e && e.name || '') + ')';
    });
  }

  /* 사진 판별 */
  $('#p-photo').onclick = function () { $('#p-file').click(); };
  $('#p-file').addEventListener('change', function (e) {
    var file = (e.target.files || [])[0]; e.target.value = '';
    if (!file) return;
    $('#p-photo-msg').textContent = '사진을 읽는 중…';
    K.shrinkImage(file, 1000, 0.7).then(function (o) {
      var key = (K.lsGet(K.LS.ai) || {}).key || '';
      if (!key) {
        $('#p-photo-msg').textContent = 'AI 키가 없어 사진으로 자동 판별하지 못했습니다 · 아래에서 이름으로 골라 주세요.';
        renderPickList();
        $('#p-photo-list').innerHTML = '';
        setTab('search');
        return;
      }
      aiRead(o.dataUrl, key).then(function (o2) {
        var cand = [];
        if (o2.barcode) cand = rawItems.filter(function (it) { return String(it.barcode || '') === String(o2.barcode); });
        if (!cand.length && o2.name) {
          cand = rawItems.filter(function (it) { return K.matchQuery(it.name, o2.name) || K.matchQuery(o2.name, it.name); });
        }
        $('#p-photo-msg').textContent = o2.name ? ('사진에서 읽은 이름: ' + o2.name) : '사진에서 이름을 읽지 못했습니다';
        if (!cand.length) cand = rawItems.slice(0, 6);
        $('#p-photo-list').innerHTML = cand.map(pickRowHtml).join('');
        if (cand.length === 1) addItem(cand[0].id);
      }).catch(function (er) {
        $('#p-photo-msg').textContent = '사진을 읽지 못했습니다 · ' + (er && er.message ? er.message : '오류');
      });
    });
  });
  function aiRead(dataUrl, key) {
    var base = dataUrl.split(',')[1] || '';
    var prompt = '이 사진은 건어물·견과류 제품 또는 포장 라벨이다. 제품 정보를 JSON으로만 답해라. ' +
      '형식: {"name":"제품명","barcode":"숫자만","origin":"원산지"}. 모르는 값은 빈 문자열.';
    var body = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: base } }] }],
      generationConfig: { temperature: 0.1 }
    };
    var models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    var k = String(key).replace(/\s+/g, '');
    function go(i, last) {
      if (i >= models.length) return Promise.reject(last || new Error('호출 실패'));
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(k);
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error((j && j.error && j.error.message) || ('HTTP ' + r.status)); if (r.status === 404 || r.status === 400 || r.status === 429) return go(i + 1, e); throw e; }
          return j;
        }); }, function (e) { return i + 1 < models.length ? go(i + 1, e) : Promise.reject(e); });
    }
    return go(0, null).then(function (j) {
      var txt = '';
      try { txt = j.candidates[0].content.parts[0].text || ''; } catch (e) { throw new Error('응답 없음'); }
      var o = null;
      try { o = JSON.parse(txt); } catch (e) { var m = txt.match(/\{[\s\S]*\}/); if (m) { try { o = JSON.parse(m[0]); } catch (e2) {} } }
      if (!o) throw new Error('해석 실패');
      return o;
    });
  }

  /* ───────── 인쇄 ───────── */
  function printLog(l) {
    var rows = (l.rows || []).filter(function (r) { return String(r.name || '').trim(); });
    var N = Math.max(30, rows.length);
    var s = l.steps || {};
    function cell(st) {
      if (!st || !st.name) return '';
      return esc(st.name) + (st.at ? '<br>' + shortDate(st.at) : '');
    }
    function shortDate(ts) { var d = new Date(ts); return (d.getFullYear() + '').slice(2) + '.' + (d.getMonth() + 1) + '.' + d.getDate(); }
    var html = '<div class="pdoc">' +
      '<div class="head"><div class="title">생 산 일 지</div>' +
      '<table class="appr"><tr><td class="h" rowspan="2" style="width:24px">결<br>재</td>' +
      '<td class="h">담당자</td><td class="h">부장</td><td class="h">대표이사</td></tr>' +
      '<tr><td style="height:32px">' + cell(s.writer) + '</td><td>' + cell(s.chief) + '</td><td>' + cell(s.ceo) + '</td></tr></table></div>' +
      '<div class="date">' + esc(K.fmtDateKo(l.date)) + '</div>' +
      '<table class="main"><colgroup><col style="width:7%"><col style="width:31%"><col style="width:16%"><col style="width:14%">' +
      '<col style="width:10%"><col style="width:11%"><col style="width:11%"></colgroup>' +
      '<tr><th>NO</th><th>제 품 명</th><th>원산지</th><th>유통기한</th><th>작업시간</th><th>중량</th><th>수량</th></tr>';
    for (var i = 0; i < N; i++) {
      var r = rows[i] || {};
      html += '<tr><td>' + (i + 1) + '</td><td style="text-align:left;padding-left:6px">' + esc(r.name || '') + '</td><td>' + esc(r.origin || '') + '</td>' +
        '<td>' + esc(r.expiry || '') + '</td><td>' + esc(r.workTime || '') + '</td><td>' + esc(r.weight || '') + '</td><td>' + esc(r.qty || '') + '</td></tr>';
    }
    html += '</table><div class="foot">경덕농수산</div></div>';
    $('#print-area').innerHTML = html;
    setTimeout(function () { window.print(); }, 80);
  }

  /* ───────── 설정 ───────── */
  function openSet() {
    $('#set-ai').value = (K.lsGet(K.LS.ai) || {}).key || '';
    $('#set-pw-out').textContent = '';
    open('#modal-set');
  }
  $('#set-close').onclick = function () { close('#modal-set'); };
  $('#set-sync').onclick = function () { store.push().then(function (ok) { toast(ok ? '시트에 저장했습니다' : '저장하지 못했습니다', !ok); }); };
  $('#set-pull').onclick = function () { store.pull(true).then(function () { renderList(); toast('시트에서 받았습니다'); }); };
  $('#set-pw').onclick = function () { $('#set-pw-out').textContent = '자료 비밀번호: ' + (store && store.password ? store.password : '(없음)'); };
  $('#set-pw-copy').onclick = function () {
    if (!store || !store.password) return;
    if (navigator.clipboard) navigator.clipboard.writeText(store.password).then(function () { toast('복사했습니다'); });
  };
  $('#set-ai-save').onclick = function () { K.lsSet(K.LS.ai, { key: $('#set-ai').value.trim() }); toast('AI 키를 저장했습니다'); };
  $('#set-ai-clear').onclick = function () { K.lsSet(K.LS.ai, { key: '' }); $('#set-ai').value = ''; toast('AI 키를 지웠습니다'); };

  /* ───────── 공통 ───────── */
  function open(sel) { $(sel).hidden = false; document.body.style.overflow = 'hidden'; }
  function close(sel) {
    if (sel === '#modal-pick') stopScan();
    $(sel).hidden = true;
    if (!$$('.mask').some(function (m) { return !m.hidden; })) document.body.style.overflow = '';
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var openMask = $$('.mask').filter(function (m) { return !m.hidden; });
    if (openMask.length) close('#' + openMask[openMask.length - 1].id);
  });
  $$('.mask').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) close('#' + m.id); });
  });

  /* 테스트용 */
  window.__kdSeedProd = function (list) {
    if (!store || !store.doc) return Promise.resolve(0);
    return (list || []).reduce(function (p, it) { return p.then(function () { return store.put(it); }); }, Promise.resolve())
      .then(function () { return store.push(); }).then(function () { renderList(); return (list || []).length; });
  };
  window.__kdProdList = function () { return logs(); };

  boot();
})();
