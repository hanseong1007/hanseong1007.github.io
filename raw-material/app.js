/* 경덕농수산 원물 정보 — 화면 */
(function () {
  'use strict';
  var K = window.KD, $ = K.$, $$ = K.$$, esc = K.esc, toast = K.toast;

  var NUT = [
    { k: 'sodium', name: '나트륨', u: 'mg' },
    { k: 'carb', name: '탄수화물', u: 'g' },
    { k: 'sugar', name: '당류', u: 'g' },
    { k: 'fat', name: '지방', u: 'g' },
    { k: 'trans', name: '트랜스지방', u: 'g' },
    { k: 'sat', name: '포화지방', u: 'g' },
    { k: 'chol', name: '콜레스테롤', u: 'mg' },
    { k: 'protein', name: '단백질', u: 'g' }
  ];
  var DEF_NOTE = '1일 영양성분 기준치에 대한 비율(%)은 2,000kcal 기준이므로 개인의 필요 열량에 따라 다를 수 있습니다.';

  var store = null, editing = null, viewItem = null, photoThumbs = {}, currentZoom = [], zoomAt = 0;
  var fltCat = 'all', fltExp = 'all', sortBy = 'name';
  var CATS = ['건어물', '수산물', '해조류', '견과류', '농산물', '공산품', '기타'];

  /* ───────── 시작 ───────── */
  function paintSync() {
    var c = $('#sync-chip');
    if (!c || !store) return;
    c.textContent = store.statusText();
    c.className = 'chip sync' + (store.status === 'ok' ? ' ok' : (store.status === 'error' ? ' err' : ''));
  }
  function show(which) {
    ['gate-nosession', 'gate-lock', 'gate-new'].forEach(function (id) { $('#' + id).hidden = (id !== which); });
    $('#app').hidden = !!which;
  }

  function boot() {
    /* 보안(2026-11-27): 서버 토큰이 없거나 이 화면 권한이 없으면 포털 로그인으로 */
    if (window.KDWSEC && !KDWSEC.guard('raw')) return;
    var s = K.session();
    if (!s) { show('gate-nosession'); return; }
    $('#who-chip').hidden = false;
    $('#who-chip').textContent = s.name || s.userId;
    show(null); $('#app').hidden = true;      /* 잠금 확인 동안 잠시 숨김 */
    store = new K.Store('raw');
    window.__kdRaw = store;
    store.hooks = { paint: paintSync, afterPull: function () { render(); } };
    store.unlock().then(function (r) {
      if (r.ok) { openApp(); return; }
      if (r.reason === 'nokek' || r.reason === 'nosession') { show('gate-nosession'); return; }
      /* 열쇠로 못 열었다 → 시트에 자료가 있으면 비밀번호, 없으면 새로 시작 */
      return K.api({ action: 'get', doc: 'raw' }).then(function (j) {
        if (j.iv) show('gate-lock'); else show('gate-new');
      }).catch(function (e) {
        show('gate-lock');
        $('#lock-msg').textContent = '시트에 연결하지 못했습니다 · ' + K.errText(e);
      });
    });
  }
  function openApp() {
    show(null); $('#app').hidden = false;
    store.start();
    render();
  }

  $('#btn-set').onclick = function () { if (store) openSet(); };
  $('#btn-gate-portal').onclick = K.goPortal;
  $('#btn-portal').onclick = K.goPortal;
  $('#sync-chip').onclick = function () {
    if (!store) return;
    store.push().then(function (ok) { if (ok) toast('시트에 저장했습니다'); });
  };
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
      openApp();
      toast('자료를 만들었습니다 · 설정에서 비밀번호를 확인할 수 있습니다');
    }).catch(function (e) { toast('시작하지 못했습니다 · ' + K.errText(e), true); show('gate-new'); });
  };

  /* ───────── 목록 ───────── */
  function items() {
    return store ? store.list().filter(function (it) { return it && it.name; }) : [];
  }
  function expOf(it) {
    if (!it) return '';
    if (it.expMode === 'date') return it.expiryDate || '';
    var months = it.expMonths || (it.expUnit === 'year' ? (it.expNum || 0) * 12 : (it.expUnit === 'day' ? null : it.expNum));
    if (it.expUnit === 'day' && it.madeDate && it.expNum) {
      var d = new Date(it.madeDate); d.setDate(d.getDate() + it.expNum);
      return K.isoDate(d);
    }
    if (it.madeDate && months) return K.addMonths(it.madeDate, months);
    return it.expiryDate || '';
  }
  function expText(it) {
    var d = expOf(it);
    if (!d) return '유통기한 미입력';
    var left = K.daysLeft(d);
    return K.fmtDateShort(d) + (left == null ? '' : (left < 0 ? ' · 지남' : ' · ' + left + '일'));
  }
  function expBadge(it) {
    var d = expOf(it); if (!d) return '<span class="badge gray">기한 없음</span>';
    var left = K.daysLeft(d);
    if (left == null) return '<span class="badge gray">' + esc(K.fmtDateShort(d)) + '</span>';
    if (left < 0) return '<span class="badge red">기한 지남 ' + esc(K.fmtDateShort(d)) + '</span>';
    if (left <= 30) return '<span class="badge warn">' + left + '일 남음</span>';
    return '<span class="badge">' + esc(K.fmtDateShort(d)) + '</span>';
  }

  function render() {
    var q = $('#q').value || '';
    var all = items();
    var hit = all.filter(function (it) {
      return K.matchQuery(it.name, q) || K.matchQuery(it.aliases, q) || K.matchQuery(it.barcode, q) ||
             K.matchQuery(it.maker, q) || K.matchQuery(it.reportNo, q) || K.matchQuery(it.category, q);
    });
    var cats = {};
    hit.forEach(function (it) { var c = it.category || '기타'; cats[c] = (cats[c] || 0) + 1; });
    var shown = hit.filter(function (it) {
      if (fltCat !== 'all' && (it.category || '기타') !== fltCat) return false;
      if (fltExp !== 'all') {
        var d = expOf(it), left = d ? K.daysLeft(d) : null;
        if (fltExp === 'yes' && !d) return false;
        if (fltExp === 'no' && d) return false;
        if (fltExp === 'soon' && (left == null || left > 30)) return false;
      }
      return true;
    });
    shown.sort(function (a, b) {
      if (sortBy === 'exp') {
        var da = expOf(a) || '9999-99-99', db = expOf(b) || '9999-99-99';
        if (da !== db) return da < db ? -1 : 1;
      } else if (sortBy === 'recent') {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
      return String(a.name).localeCompare(String(b.name), 'ko');
    });
    var withExp = all.filter(function (it) { return !!expOf(it); }).length;
    $('#count-line').textContent = all.length
      ? ('원물 ' + all.length + '개 · 소비기한 있음 ' + withExp + '개' +
         (q || fltCat !== 'all' || fltExp !== 'all' ? ' · 지금 보기 ' + shown.length + '개' : ''))
      : '등록된 원물이 없습니다';
    renderFilters(cats, hit.length);
    $('#list-empty').hidden = shown.length > 0;
    $('#list').innerHTML = shown.map(function (it) {
      return '<button class="item" type="button" data-open="' + esc(it.id) + '">' +
        '<span class="thumb" id="th-' + esc(it.id) + '">🧺</span>' +
        '<span class="tx"><b>' + esc(it.name) +
        (it.category ? '<span class="tagm">' + esc(it.category) + '</span>' : '') + '</b>' +
        '<span>' + esc([it.origin, it.weight, it.barcode].filter(Boolean).join(' · ') || '—') + '</span>' +
        (it.expVariants && it.expVariants.length
          ? '<span class="sub2">규격별 ' + esc(it.expVariants.map(function (v) {
            var lb = String(v.label || '');
            if (lb.indexOf(it.name) === 0) lb = lb.slice(it.name.length).trim();
            return lb + ' ' + K.fmtDateShort(v.date);
          }).join(' / ')) + '</span>' : '') +
        '</span>' +
        '<span class="ar">' + expBadge(it) + '</span></button>';
    }).join('');
    shown.slice(0, 40).forEach(function (it) { fillThumb(it); });
  }
  function renderFilters(cats, n) {
    var box = $('#filters');
    if (!box) return;
    var catHtml = '<div class="frow" id="cat-chips">' +
      '<button class="fchip' + (fltCat === 'all' ? ' on' : '') + '" type="button" data-cat="all">전체<span class="n">' + n + '</span></button>' +
      CATS.filter(function (c) { return cats[c]; }).map(function (c) {
        return '<button class="fchip' + (fltCat === c ? ' on' : '') + '" type="button" data-cat="' + esc(c) + '">' +
          esc(c) + '<span class="n">' + cats[c] + '</span></button>';
      }).join('') + '</div>';
    var expHtml = '<div class="frow wrap" id="exp-chips">' +
      [['all', '소비기한 전체'], ['yes', '소비기한 있음'], ['soon', '30일 내'], ['no', '기한 없음']].map(function (p) {
        return '<button class="fchip' + (fltExp === p[0] ? ' on' : '') + '" type="button" data-exp="' + p[0] + '">' + p[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="fsort"><span class="mini">정렬</span>' +
      '<select id="sort-sel" aria-label="정렬">' +
      '<option value="name"' + (sortBy === 'name' ? ' selected' : '') + '>이름순</option>' +
      '<option value="exp"' + (sortBy === 'exp' ? ' selected' : '') + '>소비기한 빠른순</option>' +
      '<option value="recent"' + (sortBy === 'recent' ? ' selected' : '') + '>최근 수정순</option>' +
      '</select></div>';
    box.innerHTML = catHtml + expHtml;
    box.querySelectorAll('[data-cat]').forEach(function (b) {
      b.onclick = function () { fltCat = b.getAttribute('data-cat'); render(); };
    });
    box.querySelectorAll('[data-exp]').forEach(function (b) {
      b.onclick = function () { fltExp = b.getAttribute('data-exp'); render(); };
    });
    $('#sort-sel').onchange = function () { sortBy = this.value; render(); };
  }
  function repPhoto(it) {
    if (!it.photos || !it.photos.length) return null;
    for (var i = 0; i < it.photos.length; i++) if (it.photos[i].rep) return it.photos[i];
    return it.photos[0];
  }
  function fillThumb(it) {
    var p = repPhoto(it); if (!p) return;
    var box = document.getElementById('th-' + it.id);
    if (!box) return;
    var put = function (url) { if (url && box) box.innerHTML = '<img src="' + url + '" alt="">'; };
    if (photoThumbs[p.id]) { put(photoThumbs[p.id]); return; }
    store.getPhoto(p.id).then(function (url) {
      if (!url) return;
      photoThumbs[p.id] = url; put(url);
    });
  }
  $('#q').addEventListener('input', render);
  $('#btn-new-item').onclick = function () { openEdit(null); };
  $('#list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-open]');
    if (b) openView(b.getAttribute('data-open'));
  });

  /* ───────── 보기 ───────── */
  function openView(id) {
    var it = store.get(id); if (!it) return;
    viewItem = it;
    $('#v-name').textContent = it.name || '품목';
    var rows = [
      ['품목명', it.name], ['분류', it.category], ['별칭', it.aliases], ['바코드', it.barcode], ['품목보고번호', it.reportNo],
      ['류별·식품유형', it.type], ['원료·원산지', it.origin], ['원료명 및 함량', it.ingredients],
      ['알레르기', it.allergen], ['보관방법', it.storage], ['반품·교환', it.returnInfo], ['신고안내', it.notice],
      ['제조원', it.maker], ['주소', it.addr], ['TEL', it.tel], ['FAX', it.fax], ['제조가공지', it.place],
      ['중량·내용량', it.weight], ['제조년월일', it.madeDate ? K.fmtDateKo(it.madeDate) : ''],
      ['유통기한', expOf(it) ? (K.fmtDateKo(expOf(it)) + (it.expMode === 'date' ? '' : ' (제조일로부터 ' + expTermText(it) + ')')) : ''],
      ['규격별 소비기한', (it.expVariants || []).map(function (v) { return v.label + ' ' + K.fmtDateShort(v.date); }).join(' / ')],
      ['소비기한 출처', it.expSource],
      ['영양정보', nutSummary(it)], ['메모', it.memo]
    ].filter(function (r) { return r[1]; });
    var photos = (it.photos || []).map(function (p, i) {
      return '<button class="pbox" type="button" data-photo="' + i + '"><img id="vp-' + esc(p.id) + '" alt="원물 사진" src=""></button>';
    }).join('');
    $('#v-body').innerHTML =
      (photos ? '<div class="photos" style="margin:0 0 12px;grid-template-columns:repeat(auto-fill,minmax(132px,1fr))">' + photos + '</div>' : '') +
      '<dl class="dl">' + rows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
      }).join('') + '</dl>' +
      '<div class="row" style="margin-top:14px">' +
      '<button class="btn soft sm" id="v-copy" type="button">표시사항 전체 복사</button>' +
      '<button class="btn gray sm" id="v-print" type="button">라벨 인쇄</button></div>';
    open('#modal-view');
    (it.photos || []).forEach(function (p, i) {
      var img = document.getElementById('vp-' + p.id);
      if (!img) return;
      store.getPhoto(p.id).then(function (url) { if (url) img.src = url; });
    });
    $('#v-body').querySelectorAll('[data-photo]').forEach(function (b) {
      b.onclick = function () { openZoom(it.photos, +b.getAttribute('data-photo')); };
    });
    $('#v-copy').onclick = function () { copyText(labelText(it)); };
    $('#v-print').onclick = function () { printLabel(it); };
  }
  function expTermText(it) {
    if (!it.expNum) return '';
    var u = it.expUnit === 'year' ? '년' : (it.expUnit === 'day' ? '일' : '개월');
    return it.expNum + u;
  }
  function nutSummary(it) {
    var n = it.nut || {};
    var bits = [];
    if (n.kcal) bits.push('열량 ' + n.kcal + 'kcal');
    NUT.forEach(function (r) {
      var v = n[r.k];
      if (v && v.v) bits.push(r.name + ' ' + v.v + r.u + (v.p ? '(' + v.p + '%)' : ''));
    });
    return bits.join(' · ');
  }
  $('#v-close').onclick = function () { close('#modal-view'); };
  $('#v-edit').onclick = function () { close('#modal-view'); openEdit(viewItem); };
  $('#v-label').onclick = function () { openLabel(viewItem); };

  /* ───────── 편집 ───────── */
  function nutInputs() {
    var html = '';
    NUT.forEach(function (r) {
      html += '<div class="nrow"><span class="nm">' + r.name + ' (' + r.u + ')</span>' +
        '<input class="inp" id="n-' + r.k + '-v" inputmode="decimal" placeholder="값">' +
        '<input class="inp" id="n-' + r.k + '-p" inputmode="decimal" placeholder="%">' +
        '</div>';
    });
    $('#nut-rows').innerHTML = html;
  }
  function openEdit(it) {
    editing = it ? JSON.parse(JSON.stringify(it)) : {
      id: '', name: '', aliases: '', barcode: '', reportNo: '', type: '', origin: '', ingredients: '',
      allergen: '', storage: '', returnInfo: '', notice: '', maker: '', addr: '', tel: '', fax: '', place: '',
      weight: '', madeDate: '', expMode: 'term', expNum: '', expUnit: 'year', expiryDate: '',
      category: '건어물', expVariants: [], expSource: '',
      nut: {}, memo: '', photos: []
    };
    $('#e-title').textContent = editing.name ? '원물 수정' : '새 원물';
    var f = function (id, v) { var el = $('#' + id); if (el) el.value = (v == null ? '' : v); };
    f('f-name', editing.name); f('f-aliases', editing.aliases); f('f-barcode', editing.barcode);
    f('f-report', editing.reportNo); f('f-type', editing.type); f('f-origin', editing.origin);
    f('f-ingredients', editing.ingredients); f('f-allergen', editing.allergen);
    f('f-storage', editing.storage); f('f-return', editing.returnInfo); f('f-notice', editing.notice);
    f('f-maker', editing.maker); f('f-addr', editing.addr); f('f-tel', editing.tel); f('f-fax', editing.fax);
    f('f-place', editing.place); f('f-weight', editing.weight); f('f-madedate', editing.madeDate);
    f('f-expnum', editing.expNum); f('f-expunit', editing.expUnit || 'year'); f('f-expdate', editing.expiryDate);
    f('f-memo', editing.memo);
    f('f-cat', editing.category || '건어물');
    f('f-expvar', (editing.expVariants || []).map(function (v) { return v.label + ' ' + v.date; }).join('\n'));
    var n = editing.nut || {};
    f('n-total', n.total || (editing.weight || '')); f('n-basis', n.basis || '100g당'); f('n-kcal', n.kcal);
    f('n-note', n.note || DEF_NOTE);
    NUT.forEach(function (r) {
      f('n-' + r.k + '-v', (n[r.k] || {}).v); f('n-' + r.k + '-p', (n[r.k] || {}).p);
    });
    setExpMode(editing.expMode === 'date' ? 'date' : 'term');
    updateExpCalc();
    renderPhotoGrid();
    open('#modal-edit');
  }
  function setExpMode(mode) {
    editing.expMode = mode;
    $$('#exp-tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-exp') === mode); });
    $('#exp-term').hidden = (mode !== 'term');
    $('#exp-date').hidden = (mode !== 'date');
  }
  $$('#exp-tabs button').forEach(function (b) {
    b.onclick = function () { setExpMode(b.getAttribute('data-exp')); updateExpCalc(); };
  });
  function readExpInputs() {
    if (editing.expMode === 'date') editing.expiryDate = $('#f-expdate').value || '';
    else {
      editing.expNum = $('#f-expnum').value === '' ? '' : Number($('#f-expnum').value);
      editing.expUnit = $('#f-expunit').value;
    }
  }
  function updateExpCalc() {
    editing.madeDate = $('#f-madedate').value || '';
    readExpInputs();
    var d = expOf(editing);
    if (editing.expMode === 'term') {
      $('#exp-calc').textContent = d
        ? ('계산된 유통기한: ' + K.fmtDateKo(d) + ' (제조일 ' + K.fmtDateKo(editing.madeDate) + ' + ' + expTermText(editing) + ')')
        : '제조년월일과 기간을 넣으면 유통기한이 자동으로 계산됩니다.';
      $('#f-expdate').value = d || '';
    } else {
      $('#exp-calc').textContent = editing.expiryDate
        ? ('유통기한: ' + K.fmtDateKo(editing.expiryDate) + (K.daysLeft(editing.expiryDate) != null ? ' · ' + K.daysLeft(editing.expiryDate) + '일 남음' : ''))
        : '달력에서 유통기한을 고르세요.';
    }
  }
  ['#f-madedate', '#f-expnum', '#f-expunit', '#f-expdate'].forEach(function (s) {
    $(s).addEventListener('change', updateExpCalc);
    $(s).addEventListener('input', updateExpCalc);
  });

  function renderPhotoGrid() {
    var g = $('#photo-grid');
    var html = (editing.photos || []).map(function (p, i) {
      return '<div class="pbox"><img id="ep-' + esc(p.id) + '" alt="사진" src="' + (photoThumbs[p.id] || '') + '">' +
        (p.rep ? '<span class="rep">대표</span>' : '') +
        '<button class="del" type="button" data-del-photo="' + i + '">×</button>' +
        '<button type="button" data-rep-photo="' + i + '" style="position:absolute;right:3px;bottom:3px;border:0;border-radius:6px;background:rgba(20,35,29,.6);color:#fff;font-size:10px;padding:2px 5px">대표</button></div>';
    }).join('');
    g.innerHTML = html + '<button class="padd" id="photo-add" type="button"><span class="pl">＋</span>사진</button>';
    $('#photo-add').onclick = function () { $('#photo-file').click(); };
    g.querySelectorAll('[data-del-photo]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var i = +b.getAttribute('data-del-photo');
        editing.photos.splice(i, 1);
        if (editing.photos.length && !editing.photos.some(function (p) { return p.rep; })) editing.photos[0].rep = true;
        renderPhotoGrid();
      };
    });
    g.querySelectorAll('[data-rep-photo]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var i = +b.getAttribute('data-rep-photo');
        editing.photos.forEach(function (p, j) { p.rep = (i === j); });
        renderPhotoGrid();
      };
    });
    (editing.photos || []).forEach(function (p) {
      if (photoThumbs[p.id]) return;
      store.getPhoto(p.id).then(function (url) {
        if (!url) return;
        photoThumbs[p.id] = url;
        var img = document.getElementById('ep-' + p.id);
        if (img) img.src = url;
      });
    });
  }

  $('#photo-file').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    toast(files.length + '장을 담는 중…');
    var n = 0;
    files.reduce(function (p, file) {
      return p.then(function () {
        return K.shrinkImage(file, 1400, 0.72).then(function (o) {
          var id = K.uid('p');
          editing.photos = editing.photos || [];
          editing.photos.push({ id: id, w: o.w, h: o.h, at: Date.now(), rep: editing.photos.length === 0 });
          photoThumbs[id] = o.dataUrl;
          store.cachePhoto(id, o.dataUrl);
          return store.putPhoto(id, o.dataUrl).then(function () { n++; });
        }).catch(function () {});
      });
    }, Promise.resolve()).then(function () {
      renderPhotoGrid();
      toast(n + '장을 담았습니다');
    });
  });

  $('#e-close').onclick = function () { close('#modal-edit'); };
  $('#e-save').onclick = function () {
    var v = function (id) { var el = $('#' + id); return el ? el.value.trim() : ''; };
    var name = v('f-name');
    if (!name) { toast('품목명을 넣어 주세요', true); $('#f-name').focus(); return; }
    editing.name = name;
    editing.aliases = v('f-aliases'); editing.barcode = v('f-barcode'); editing.reportNo = v('f-report');
    editing.type = v('f-type'); editing.origin = v('f-origin'); editing.ingredients = v('f-ingredients');
    editing.allergen = v('f-allergen'); editing.storage = v('f-storage'); editing.returnInfo = v('f-return');
    editing.notice = v('f-notice'); editing.maker = v('f-maker'); editing.addr = v('f-addr');
    editing.tel = v('f-tel'); editing.fax = v('f-fax'); editing.place = v('f-place');
    editing.weight = v('f-weight'); editing.madeDate = v('f-madedate'); editing.memo = v('f-memo');
    if ($('#f-cat')) editing.category = $('#f-cat').value || '기타';
    if ($('#f-expvar')) {
      editing.expVariants = v('f-expvar').split('\n').map(function (ln) {
        var m = /^(.*?)\s+(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(ln.trim());
        if (!m) return null;
        var mm = m[3].length < 2 ? '0' + m[3] : m[3], dd = m[4].length < 2 ? '0' + m[4] : m[4];
        return { label: m[1].trim(), date: m[2] + '-' + mm + '-' + dd };
      }).filter(Boolean);
    }
    if (!editing.expSource && editing.expiryDate) editing.expSource = '직접 입력';
    readExpInputs();
    editing.expiryDate = expOf(editing);
    var nut = { total: v('n-total'), basis: v('n-basis'), kcal: v('n-kcal'), note: v('n-note') };
    NUT.forEach(function (r) {
      nut[r.k] = { v: v('n-' + r.k + '-v'), p: v('n-' + r.k + '-p') };
    });
    editing.nut = nut;
    store.put(editing).then(function (saved) {
      close('#modal-edit');
      toast('저장했습니다 · 시트에 올리는 중');
      render();
      store.push();
      viewItem = saved;
    });
  };
  $('#e-del').onclick = function () {
    if (!editing.id) { close('#modal-edit'); return; }
    if (!confirm('이 원물을 삭제할까요?\n생산일지에 이미 적힌 내용은 그대로 남습니다.')) return;
    store.remove(editing.id);
    close('#modal-edit'); render(); store.push();
    toast('삭제했습니다');
  };

  /* ───────── 라벨 ───────── */
  function nameSpaced(name) {
    var s = String(name || '');
    if (s.replace(/\s/g, '').length > 12) return s;
    return s.split('').join(' ').replace(/\s+/g, '  ');
  }
  function madeDateText(it) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.madeDate || '');
    return m ? (m[1] + '년 ' + (+m[2]) + '월 ' + (+m[3]) + '일') : '';
  }
  function labelHtml(it) {
    var n = it.nut || {};
    var term = it.expMode === 'date'
      ? (it.expiryDate ? '유통기한 ' + (it.expiryDate || '').replace(/-/g, '.') : '')
      : (it.expNum ? '제조일로부터 ' + expTermText(it) : '');
    var nutRows = NUT.filter(function (r) { return (n[r.k] || {}).v; }).map(function (r) {
      return [r.name, n[r.k].v + r.u, (n[r.k].p ? n[r.k].p + '%' : '')];
    });
    var nutHtml = nutRows.length
      ? '<div style="margin-top:6px;font-size:10.5px;font-weight:800">영양정보' +
        (n.total ? ' 총내용량' + esc(n.total) : '') + (n.kcal ? ' ' + esc(n.basis || '100g당') + esc(n.kcal) + 'kcal' : '') +
        ' ' + esc(n.basis || '100g당') + ' 1일 영양성분 기준치에 대한 비율</div>' +
        '<table style="margin-top:3px"><tr><td class="lb-k">나트륨</td><td class="lb-c">' + esc((n.sodium || {}).v || '') + 'mg ' + esc((n.sodium || {}).p || '') + '%</td>' +
        '<td class="lb-k">탄수화물</td><td class="lb-c">' + esc((n.carb || {}).v || '') + 'g ' + esc((n.carb || {}).p || '') + '%</td></tr>' +
        '<tr><td class="lb-k">당류</td><td class="lb-c">' + esc((n.sugar || {}).v || '') + 'g ' + esc((n.sugar || {}).p || '') + '%</td>' +
        '<td class="lb-k">지방</td><td class="lb-c">' + esc((n.fat || {}).v || '') + 'g ' + esc((n.fat || {}).p || '') + '%</td></tr>' +
        '<tr><td class="lb-k">트랜스지방</td><td class="lb-c">' + esc((n.trans || {}).v || '') + 'g</td>' +
        '<td class="lb-k">포화지방</td><td class="lb-c">' + esc((n.sat || {}).v || '') + 'g ' + esc((n.sat || {}).p || '') + '%</td></tr>' +
        '<tr><td class="lb-k">콜레스테롤</td><td class="lb-c">' + esc((n.chol || {}).v || '') + 'mg ' + esc((n.chol || {}).p || '') + '%</td>' +
        '<td class="lb-k">단백질</td><td class="lb-c">' + esc((n.protein || {}).v || '') + 'g ' + esc((n.protein || {}).p || '') + '%</td></tr></table>'
      : '';
    return '<div class="label-box">' +
      (it.reportNo ? '<div class="lb-report">품목보고번호 : ' + esc(it.reportNo) + '</div>' : '') +
      '<table>' +
      '<tr><td class="lb-name" colspan="4">' + esc(nameSpaced(it.name)) + '</td></tr>' +
      (it.ingredients ? '<tr><td class="lb-k">원료명 및 함량</td><td colspan="3">' + esc(it.ingredients) + '</td></tr>' : '') +
      (it.allergen ? '<tr><td colspan="4" class="lb-note">알레르기 유발물질 : ' + esc(it.allergen) + '</td></tr>' : '') +
      (it.storage ? '<tr><td colspan="4" class="lb-note">' + esc(it.storage) + '</td></tr>' : '') +
      (it.returnInfo ? '<tr><td colspan="4" class="lb-note">' + esc(it.returnInfo) + '</td></tr>' : '') +
      (it.maker ? '<tr><td colspan="4" class="lb-maker">' + esc(nameSpaced(it.maker)) + '</td></tr>' : '') +
      '<tr><td colspan="4" class="lb-c">' + esc([it.addr, it.tel ? 'TEL.' + it.tel : '', it.fax ? 'FAX.' + it.fax : ''].filter(Boolean).join(' ')) + '</td></tr>' +
      '<tr><td class="lb-k">류별</td><td class="lb-c">' + esc(it.type || '') + '</td><td class="lb-k">중량</td><td class="lb-c">' + esc(it.weight || '') + '</td></tr>' +
      '<tr><td class="lb-k">원료</td><td class="lb-c">' + esc(it.origin || '') + '</td><td class="lb-k">제조년월일</td><td class="lb-c">' + esc(madeDateText(it)) + '</td></tr>' +
      '<tr><td class="lb-k">제조가공지</td><td class="lb-c">' + esc(it.place || '') + '</td><td class="lb-k">유통기한</td><td class="lb-c">' + esc(term) + '</td></tr>' +
      (it.notice ? '<tr><td colspan="4" class="lb-note">' + esc(it.notice) + '</td></tr>' : '') +
      '</table>' + nutHtml +
      (n.note ? '<div style="margin-top:4px;font-size:9.5px;color:#333">' + esc(n.note) + '</div>' : '') +
      '</div>';
  }
  function labelText(it) {
    var n = it.nut || {}, L = [];
    if (it.reportNo) L.push('품목보고번호 : ' + it.reportNo);
    L.push('제품명 : ' + it.name);
    if (it.ingredients) L.push('원료명 및 함량 : ' + it.ingredients);
    if (it.allergen) L.push('알레르기 유발물질 : ' + it.allergen);
    if (it.storage) L.push('보관방법 : ' + it.storage);
    if (it.returnInfo) L.push('반품·교환 : ' + it.returnInfo);
    if (it.maker) L.push('제조원 : ' + it.maker);
    if (it.addr) L.push('소재지 : ' + it.addr + (it.tel ? ' TEL.' + it.tel : '') + (it.fax ? ' FAX.' + it.fax : ''));
    if (it.type) L.push('류별 : ' + it.type);
    if (it.origin) L.push('원료 : ' + it.origin);
    if (it.weight) L.push('중량 : ' + it.weight);
    if (it.madeDate) L.push('제조년월일 : ' + madeDateText(it));
    if (it.place) L.push('제조가공지 : ' + it.place);
    L.push('유통기한 : ' + (it.expMode === 'date' ? (it.expiryDate || '').replace(/-/g, '.') : (it.expNum ? '제조일로부터 ' + expTermText(it) : '')));
    if (it.notice) L.push(it.notice);
    if (n.total) L.push('총내용량 : ' + n.total);
    if (n.kcal) L.push('열량 : ' + n.kcal + 'kcal (' + (n.basis || '100g당') + ')');
    NUT.forEach(function (r) {
      var v = n[r.k] || {};
      if (v.v) L.push(r.name + ' : ' + v.v + r.u + (v.p ? ' (' + v.p + '%)' : ''));
    });
    if (n.note) L.push(n.note);
    if (it.barcode) L.push('바코드 : ' + it.barcode);
    return L.join('\n');
  }
  function openLabel(it) {
    if (!it) return;
    $('#label-body').innerHTML = '<div style="overflow:auto">' + labelHtml(it) + '</div>';
    $('#lbl-print').onclick = function () { printLabel(it); };
    $('#lbl-copy').onclick = function () { copyText(labelText(it)); };
    open('#modal-label');
  }
  $('#lbl-close').onclick = function () { close('#modal-label'); };
  function printLabel(it) {
    $('#print-area').innerHTML = labelHtml(it);
    setTimeout(function () { window.print(); }, 60);
  }
  function copyText(txt) {
    var done = function () { toast('복사했습니다'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('복사하지 못했습니다', true); }
      document.body.removeChild(ta);
    }
  }

  /* ───────── 사진 크게 보기 ───────── */
  function openZoom(photos, at) {
    currentZoom = photos || []; zoomAt = at || 0;
    if (!currentZoom.length) return;
    $('#zoom').hidden = false;
    showZoom();
  }
  function showZoom() {
    var p = currentZoom[zoomAt];
    if (!p) return;
    $('#zoom-name').textContent = (p.rep ? '대표 · ' : '') + (zoomAt + 1) + ' / ' + currentZoom.length;
    var img = $('#zoom-img');
    img.src = photoThumbs[p.id] || '';
    if (!photoThumbs[p.id]) {
      store.getPhoto(p.id).then(function (url) { photoThumbs[p.id] = url; img.src = url || ''; });
    }
  }
  $('#zoom-close').onclick = function () { $('#zoom').hidden = true; };
  $('#zoom-prev').onclick = function () { zoomAt = (zoomAt + currentZoom.length - 1) % currentZoom.length; showZoom(); };
  $('#zoom-next').onclick = function () { zoomAt = (zoomAt + 1) % currentZoom.length; showZoom(); };

  /* ───────── AI 라벨 읽기 ───────── */
  function aiKey() { return (K.lsGet(K.LS.ai) || {}).key || ''; }
  function setAiKey(k) { K.lsSet(K.LS.ai, { key: k || '' }); }

  $('#btn-ai').onclick = function () {
    var key = aiKey();
    if (!key) { toast('설정에서 Gemini API 키를 먼저 넣어 주세요'); openSet(); return; }
    var p = repPhoto(editing);
    if (!p) { toast('라벨 사진을 먼저 담아 주세요', true); return; }
    var url = photoThumbs[p.id];
    if (!url) { toast('사진을 읽는 중입니다 · 잠시 뒤 다시 눌러 주세요', true); store.getPhoto(p.id).then(function (u) { photoThumbs[p.id] = u; }); return; }
    toast('라벨을 읽는 중…');
    readLabel(url, key).then(function (o) {
      var f = function (id, v) { if (v != null && v !== '') $('#' + id).value = v; };
      f('f-name', o.name); f('f-aliases', o.aliases); f('f-barcode', o.barcode); f('f-report', o.reportNo);
      f('f-type', o.type); f('f-origin', o.origin); f('f-ingredients', o.ingredients); f('f-allergen', o.allergen);
      f('f-storage', o.storage); f('f-return', o.returnInfo); f('f-notice', o.notice);
      f('f-maker', o.maker); f('f-addr', o.addr); f('f-tel', o.tel); f('f-fax', o.fax); f('f-place', o.place);
      f('f-weight', o.weight);
      if (o.madeDate) { $('#f-madedate').value = K.parseShort(o.madeDate) || o.madeDate; }
      var n = o.nut || {};
      f('n-total', n.total); f('n-basis', n.basis); f('n-kcal', n.kcal); f('n-note', n.note);
      NUT.forEach(function (r) { if (n[r.k]) { f('n-' + r.k + '-v', n[r.k].v); f('n-' + r.k + '-p', n[r.k].p); } });
      if (o.expiryTerm) {
        var m = /(\d+)\s*(년|개월|월|일)/.exec(o.expiryTerm);
        if (m) {
          setExpMode('term');
          $('#f-expnum').value = m[1];
          $('#f-expunit').value = (m[2] === '년') ? 'year' : (m[2] === '일' ? 'day' : 'month');
        }
      } else if (o.expiryDate) {
        setExpMode('date'); $('#f-expdate').value = K.parseShort(o.expiryDate) || o.expiryDate;
      }
      updateExpCalc();
      toast('라벨에서 정보를 채웠습니다 · 확인해 주세요');
    }).catch(function (e) { toast('라벨을 읽지 못했습니다 · ' + (e && e.message ? e.message : '오류'), true); });
  };

  function readLabel(dataUrl, key) {
    var base = dataUrl.split(',')[1] || '';
    var mime = (dataUrl.match(/^data:([^;]+);/) || [, 'image/jpeg'])[1];
    var prompt = '이 사진은 식품 포장 라벨(한글표시사항)이다. 사진에서 보이는 정보를 아래 JSON 형식으로만 출력해라. ' +
      '없는 값은 빈 문자열로 두고 설명은 쓰지 마라. 영양정보는 숫자만 넣어라.\n' +
      '{"name":"제품명","aliases":"","barcode":"숫자만","reportNo":"품목보고번호","type":"류별·식품유형","origin":"원료·원산지",' +
      '"ingredients":"원료명 및 함량 전체","allergen":"알레르기 유발물질","storage":"보관방법","returnInfo":"반품·교환 안내",' +
      '"notice":"부정불량식품 신고 안내","maker":"제조원·업소명","addr":"소재지","tel":"전화","fax":"팩스","place":"제조가공지",' +
      '"weight":"중량·내용량","madeDate":"제조년월일 YYYY-MM-DD 또는 원문","expiryTerm":"제조일로부터 1년 처럼","expiryDate":"유통기한 날짜",' +
      '"nut":{"total":"총내용량","basis":"100g당","kcal":"열량","sodium":{"v":"mg값","p":"%"},"carb":{"v":"","p":""},"sugar":{"v":"","p":""},' +
      '"fat":{"v":"","p":""},"trans":{"v":"","p":""},"sat":{"v":"","p":""},"chol":{"v":"mg값","p":""},"protein":{"v":"","p":""},"note":""}}';
    var body = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base } }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    };
    var models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    var k = String(key).replace(/\s+/g, '');
    function tryModel(i, lastErr) {
      if (i >= models.length) return Promise.reject(lastErr || new Error('호출 실패'));
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(k);
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            if (!res.ok) {
              var msg = (j && j.error && j.error.message) ? j.error.message : ('HTTP ' + res.status);
              var err = new Error(msg);
              if (res.status === 404 || res.status === 400 || res.status === 429) return tryModel(i + 1, err);
              throw err;
            }
            return j;
          });
        }, function (netErr) { if (i + 1 < models.length) return tryModel(i + 1, netErr); throw netErr; });
    }
    return tryModel(0, null).then(function (j) {
      var txt = '';
      try { txt = j.candidates[0].content.parts[0].text || ''; } catch (e) { throw new Error('응답 없음'); }
      var obj = null;
      try { obj = JSON.parse(txt); } catch (e) {
        var m = txt.match(/\{[\s\S]*\}/);
        if (m) { try { obj = JSON.parse(m[0]); } catch (e2) {} }
      }
      if (!obj) throw new Error('해석 실패');
      return obj;
    });
  }

  /* ───────── 설정 ───────── */
  function openSet() {
    $('#set-ai').value = aiKey();
    $('#set-pw-out').textContent = '';
    $('#set-info').textContent = '시트: 경덕농수산 원물·생산일지 동기화 (암호화) · 자료 ' +
      (store ? Object.keys((store.doc && store.doc.items) || {}).length : 0) + '건';
    open('#modal-set');
  }
  $('#set-close').onclick = function () { close('#modal-set'); };
  $('#sync-chip').addEventListener('contextmenu', function (e) { e.preventDefault(); if (store) openSet(); });
  $('#set-sync').onclick = function () { store.push().then(function (ok) { toast(ok ? '시트에 저장했습니다' : '저장하지 못했습니다', !ok); }); };
  $('#set-pull').onclick = function () { store.pull(true).then(function () { render(); toast('시트에서 받았습니다'); }); };
  $('#set-pw').onclick = function () {
    $('#set-pw-out').textContent = '자료 비밀번호: ' + (store && store.password ? store.password : '(없음)');
  };
  $('#set-pw-copy').onclick = function () { if (store && store.password) copyText(store.password); };
  $('#set-ai-save').onclick = function () { setAiKey($('#set-ai').value.trim()); toast('AI 키를 저장했습니다'); };
  $('#set-ai-clear').onclick = function () { setAiKey(''); $('#set-ai').value = ''; toast('AI 키를 지웠습니다'); };

  /* ───────── 공통 ───────── */
  function open(sel) { $(sel).hidden = false; document.body.style.overflow = 'hidden'; }
  function close(sel) {
    $(sel).hidden = true;
    if (!$('.mask:not([hidden])')) document.body.style.overflow = '';
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#zoom').hidden) { $('#zoom').hidden = true; return; }
    var openMask = $$('.mask').filter(function (m) { return !m.hidden; });
    if (openMask.length) close('#' + openMask[openMask.length - 1].id);
  });
  $$('.mask').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) close('#' + m.id); });
  });
  /* 긴 화면에서 설정 열기: 사용자 칩 길게 누르기 */
  var pressT = null;
  $('#who-chip').addEventListener('pointerdown', function () {
    pressT = setTimeout(function () { if (store) openSet(); }, 650);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
    $('#who-chip').addEventListener(ev, function () { clearTimeout(pressT); });
  });
  $('#who-chip').addEventListener('click', function () { if (store) openSet(); });

  /* 테스트·초기 자료 넣기용 (화면에는 없음) */
  window.__kdSeedRaw = function (list) {
    if (!store || !store.doc) return Promise.resolve(0);
    return (list || []).reduce(function (p, it) {
      return p.then(function () { return store.put(it); });
    }, Promise.resolve()).then(function () { return store.push(); }).then(function () { render(); return (list || []).length; });
  };

  boot();
})();
