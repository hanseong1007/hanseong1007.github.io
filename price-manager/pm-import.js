/* 경덕농수산 상품단가표 — 거래명세(청구)서·단가표 엑셀 읽기
 *  · 머리글(품명·단가 …)을 1~60행에서 자동으로 찾는다 (글자 사이 공백·괄호 무시)
 *  · 합계·이월·부가세 같은 비품목 줄은 건너뛴다
 *  · 품명 앞 기호(▲▼★※)·끝 메모(_인상·_인하·(행사))를 떼고 비교한다
 *  · 규격·바코드 열에 섞인 바코드(8~14자리)로 먼저 맞춰 본다
 */
(function (global) {
  'use strict';

  var FULL = /[\u00a0\u3000]/g;

  function txt(v) { return v == null ? '' : String(v); }
  /* 머리글 비교용: 공백·괄호 안 글자 제거 */
  function flat(s) {
    return txt(s).replace(FULL, ' ').replace(/\s+/g, '')
      .replace(/[（(][^)）]*[)）]/g, '').replace(/[\[\]{}]/g, '');
  }
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/[^0-9.\-]/g, '');
    if (!s || s === '-' || s === '.' || s === '-.') return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function digitsOf(v) {
    var s = txt(v).replace(/[^0-9]/g, '');
    return s.length >= 8 && s.length <= 14 ? s : '';
  }

  /* ══════════ 머리글 알아보기 ══════════ */
  var SUMMARY = ['이월금액', '이월액', '이월', '전월', '전잔', '월금액', '당월', '합계', '소계', '총계',
    '누계', '월계', '공급가액', '부가세', '세액', '청구금액', '입금할인', '할인액', '받을금액',
    '잔액', '잔고', '비고', '차감', '정산', '총합', '출력', '인쇄', '페이지'];

  function classify(cell) {
    var h = flat(cell).toLowerCase();
    if (!h) return null;
    if (/^(일자|거래일|거래일자|납품일|출고일|날짜|일시|월일|거래날짜)$/.test(h)) return 'date';
    if (/^(품명|품목|품목명|상품명|제품명|물품명|품명규격|품명및규격|품목규격|상품|품명\/규격)$/.test(h)) return 'nm';
    if (/^(바코드|바코드번호|상품코드|제품코드|ean|ean13|upc|코드)$/.test(h)) return 'bc';
    if (/^(규격|사이즈|포장규격|외포장|규격사이즈)$/.test(h)) return 'spec';
    if (/^(단위|포장단위|출고단위)$/.test(h)) return 'unit';
    if (/^(수량|출고수량|박스수량|개수|낱개수량)$/.test(h)) return 'qty';
    if (/^(중량|용량|제품용량|내용량|총중량)$/.test(h)) return 'wt';
    if (/^(매입원가|원가|구매원가|매입가|매입단가|공급원가)$/.test(h)) return 'kg';
    if (/^(포장|포장재질|포장형태)$/.test(h)) return 'pack';
    if (/^(이율|배율)$/.test(h)) return 'rate';
    if (/^(구분|카테고리|품목구분|분류|품종)$/.test(h)) return 'cat';
    if (/가액|금액|합계|총액|소계|잔액/.test(h)) return 'amount';
    if (/^(출고가|출고단가|공급가|공급단가|공급가격|판매가|판매단가|판매가격|납품가|납품단가|거래처가|제시가|제출가|가격|단가|이벤트가|행사가|특가|현매가)$/.test(h)) return 'price';
    return null;
  }

  /* 한 줄을 머리글로 볼 때의 열 지도 */
  function rowCols(row) {
    var map = {}, n = 0;
    (row || []).forEach(function (v, idx) {
      var k = classify(v);
      if (!k) return;
      if (map[k] == null) { map[k] = idx; n++; }
    });
    return { cols: map, hits: n };
  }

  /* 단가로 쓸 수 있는 열이 있는가 (단가 열, 매입원가 열, 또는 공급가액÷수량) */
  function hasPriceCol(c) {
    return c.price != null || c.kg != null || (c.amount != null && c.qty != null);
  }

  /* 1~60행에서 머리글 행 찾기 (머리글이 두 줄로 나뉜 표도 한 번 더 본다) */
  function detectTable(grid) {
    grid = grid || [];
    var best = null, max = Math.min(grid.length, 60);
    for (var r = 0; r < max; r++) {
      var rc = rowCols(grid[r]);
      var c = rc.cols;
      if (c.nm == null) continue;
      if (!hasPriceCol(c)) continue;
      var score = rc.hits * 2 + (c.price != null ? 8 : 0) + (c.amount != null && c.qty != null ? 4 : 0) + (c.kg != null ? 2 : 0) + (c.bc != null ? 1 : 0);
      if (!best || score > best.score) best = { row: r, cols: c, score: score, header: true, twoRow: false };
    }
    if (!best) {
      /* 머리글 두 줄: 이름 줄과 가격 줄이 나뉜 경우 */
      for (var r2 = 0; r2 < max - 1; r2++) {
        var a = rowCols(grid[r2]).cols, b = rowCols(grid[r2 + 1]).cols;
        if (a.nm == null) continue;
        var merged = {}, keys = Object.keys(a).concat(Object.keys(b));
        keys.forEach(function (k) { if (merged[k] == null) merged[k] = (a[k] != null ? a[k] : b[k]); });
        if (!hasPriceCol(merged)) continue;
        best = { row: r2, cols: merged, score: keys.length * 2, header: true, twoRow: true };
        break;
      }
    }
    return best;
  }

  /* ══════════ 품명 다듬기 ══════════ */
  var SYMBOL = /^[\s▲▼△▽★☆※◆◇●○◎■□▣◈→←↑↓▶◀◁▷*+·•∙\-–—#>_/|]+/;
  var MEMO = /[_\s\-]*(인상|인하|행사|특가|할인|증정|떨이|정상가|단가인상|단가인하|가격인상|가격인하)[_\s\-]*$/;

  function cleanName(s) {
    var x = txt(s).replace(FULL, ' ').replace(/\s+/g, ' ').trim();
    x = x.replace(SYMBOL, '');
    x = x.replace(/[（(]\s*(인상|인하|행사|특가|할인|증정)\s*[)）]\s*$/g, '');
    for (var i = 0; i < 3; i++) {
      var y = x.replace(MEMO, '');
      if (y === x) break;
      x = y;
    }
    return x.trim();
  }
  function nameKey(s) {
    return cleanName(s).toLowerCase()
      .replace(/[\s_\-·•∙.,]/g, '')
      .replace(/[（()）\[\]{}]/g, '');
  }
  var TAIL = /(\d+(?:\.\d+)?)(kg|g|ml|l|매|장|p|입|개|톳|미|축|팩|호|봉|병|캔|박스|세트)$/;
  function baseKey(key) {
    var k = key || '', i;
    for (i = 0; i < 4; i++) {
      var n = k.replace(TAIL, '');
      if (n === k) break;
      k = n;
    }
    return k;
  }
  /* 이름·규격에서 무게(kg) 뽑기 — '200g' '1.2kg' '2.0kg/1미' */
  function weightOf(s) {
    var m = txt(s).match(/(\d+(?:[.,]\d+)?)\s*(kg|g)(?![a-z])/i);
    if (!m) return null;
    var v = parseFloat(m[1].replace(',', '.'));
    if (isNaN(v) || v <= 0) return null;
    return /kg/i.test(m[2]) ? v : v / 1000;
  }
  /* 규격·바코드 칸에서 8~14자리 숫자 찾기 */
  function barcodeOf(s) {
    var found = txt(s).match(/\d[\d\s\-]{5,}\d/g) || [];
    for (var i = 0; i < found.length; i++) {
      var d = found[i].replace(/[^0-9]/g, '');
      if (d.length >= 8 && d.length <= 14) return d;
    }
    return '';
  }
  function isSummary(nm) {
    var s = flat(nm);
    if (!s) return true;
    if (/^[※*#\-–—]/.test(s)) return true;
    if (s.length > 20) return false;
    for (var i = 0; i < SUMMARY.length; i++) if (s.indexOf(SUMMARY[i]) >= 0) return true;
    return false;
  }

  /* ══════════ 표 읽기 ══════════ */
  function parseStatement(grid, table) {
    grid = grid || [];
    table = table || detectTable(grid);
    var out = { rows: [], skipped: [], header: table, error: null };
    if (!table) { out.error = 'no-header'; return out; }
    var c = table.cols;
    for (var r = table.row + 1; r < grid.length; r++) {
      var row = grid[r] || [];
      var has = row.some(function (v) { return txt(v).trim() !== ''; });
      if (!has) continue;
      var nm = txt(row[c.nm]).replace(/\s+/g, ' ').trim();
      if (!nm) { out.skipped.push({ row: r + 1, reason: '품명 없음', text: '' }); continue; }
      var price = c.price != null ? num(row[c.price]) : null;
      var qty = c.qty != null ? num(row[c.qty]) : null;
      var amount = c.amount != null ? num(row[c.amount]) : null;
      var derived = false;
      if ((price == null || price <= 0) && amount != null && amount > 0 && qty != null && qty > 0) {
        price = Math.round(amount / qty); derived = true;
      }
      if (isSummary(nm)) {
        out.skipped.push({ row: r + 1, reason: '합계·이월 줄', text: nm });
        continue;
      }
      if (price == null || price <= 0) {
        out.skipped.push({ row: r + 1, reason: '단가 없음', text: nm });
        continue;
      }
      var spec = c.spec != null ? txt(row[c.spec]).trim() : '';
      var bcCell = c.bc != null ? txt(row[c.bc]).trim() : '';
      var bc = digitsOf(bcCell) || barcodeOf(bcCell) || barcodeOf(spec) || barcodeOf(nm);
      out.rows.push({
        row: r + 1,
        nm: nm,
        key: nameKey(nm),
        spec: spec,
        bc: bc,
        unit: c.unit != null ? txt(row[c.unit]).trim() : '',
        qty: qty,
        wt: (c.wt != null ? num(row[c.wt]) : null) || weightOf(nm) || weightOf(spec),
        price: price,
        amount: amount,
        derived: derived,
        date: c.date != null ? txt(row[c.date]).trim() : ''
      });
    }
    return out;
  }

  /* ══════════ 우리 단가표와 맞추기 ══════════ */
  function buildIndex(items) {
    var byKey = {}, byBc = {}, byBase = {};
    (items || []).forEach(function (o) {
      var k = nameKey(o.nm);
      if (k) (byKey[k] = byKey[k] || []).push(o);
      var b = digitsOf(o.bc);
      if (b) (byBc[b] = byBc[b] || []).push(o);
      var bk = baseKey(k);
      if (bk) (byBase[bk] = byBase[bk] || []).push(o);
    });
    return { byKey: byKey, byBc: byBc, byBase: byBase, items: items || [] };
  }
  function sameWt(a, b) {
    return a == null || b == null || Math.abs(a - b) < 0.001;
  }
  function pickByWeight(list, wt) {
    if (wt == null) return list[0];
    for (var i = 0; i < list.length; i++) if (sameWt(list[i].wt, wt)) return list[i];
    return list[0];
  }
  function suggest(nm, idx, n) {
    n = n || 4;
    var k = nameKey(nm), bk = baseKey(k), out = [];
    var keys = Object.keys(idx.byKey || {});
    for (var i = 0; i < keys.length && out.length < n; i++) {
      var x = keys[i];
      if (x === k) continue;
      if ((bk && x.indexOf(bk) >= 0) || (k && x.indexOf(k) >= 0) || (bk && bk.indexOf(baseKey(x)) >= 0 && baseKey(x).length > 1)) {
        var l = idx.byKey[x];
        if (l && l[0]) out.push(l[0]);
      }
    }
    return out;
  }
  /* → {item, how:'barcode'|'name'|'fuzzy'|'', near:[…]} */
  function matchRow(row, idx) {
    var k = row.key || nameKey(row.nm);
    /* ① 바코드 먼저 — 단 무게가 다른 후보뿐이면 품명으로 넘어긴다 (바코드 한 줄을 여러 중량이 나눠 쓰는 자료가 있다) */
    var b = row.bc || '';
    var bHit = (b && idx.byBc[b]) ? idx.byBc[b] : null;
    if (bHit) {
      var bw = bHit.filter(function (o) { return sameWt(o.wt, row.wt); });
      if (bw.length) return { item: pickByWeight(bw, row.wt), how: 'barcode', near: bHit.slice(0, 5) };
    }
    /* ② 품명이 같으면 연결 */
    var list = idx.byKey[k];
    if (list && list.length) return { item: pickByWeight(list, row.wt), how: 'name', near: list.slice(0, 5) };
    var bk = baseKey(k);
    if (bk && bk.length > 1 && idx.byBase[bk]) {
      var cl = idx.byBase[bk];
      var cw = cl.filter(function (o) { return o.wt != null && sameWt(o.wt, row.wt); });
      if (cw.length === 1) return { item: cw[0], how: 'fuzzy', near: cl.slice(0, 5) };
      return { item: null, how: '', near: cl.slice(0, 5) };
    }
    if (bHit) return { item: null, how: '', near: bHit.slice(0, 5), conflict: 'barcode-weight' };
    return { item: null, how: '', near: suggest(row.nm, idx) };
  }

  var API = {
    txt: txt, flat: flat, num: num, digitsOf: digitsOf,
    classify: classify, rowCols: rowCols, detectTable: detectTable, hasPriceCol: hasPriceCol,
    cleanName: cleanName, nameKey: nameKey, baseKey: baseKey,
    weightOf: weightOf, barcodeOf: barcodeOf, isSummary: isSummary,
    parseStatement: parseStatement, buildIndex: buildIndex, matchRow: matchRow, suggest: suggest
  };
  global.PMImport = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : this);
