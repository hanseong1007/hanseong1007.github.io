/**
 * 경덕농수산 원물정보 · 생산일지 동기화 API (Google Apps Script 웹앱)
 * ------------------------------------------------------------------
 * 붙여 넣을 시트: 「경덕농수산 원물·생산일지 동기화 (암호화)」
 * 배포: 배포 → 새 배포 → 유형 '웹앱' · 다음 사용자로 실행 '나' · 액세스 '모든 사용자'
 *       → 나온 /exec 주소를 raw-material/kdrm.js · production-log/kdrm.js 의 SYNC_URL 에 넣는다.
 *
 * ★ 이 서버는 암호문만 보관합니다.
 *   - 원물·생산일지 자료, 사진, 포털 열쇠 감싸개는 모두 브라우저에서 AES-256-GCM 으로 잠근
 *     { iv, ct } (base64) 만 올라옵니다. 시트에는 품목명·원산지·사진 내용이 평문으로 없습니다.
 *   - 암호문은 45,000자씩 잘라 여러 줄에 나눠 저장합니다 (시트 한 칸 50,000자 제한).
 *
 * action
 *   ping                                  연결 확인
 *   get      {doc}                        그 문서의 지금 암호문 + rev
 *   put      {doc, baseRev, by, n, salt, iv, ct}   새 암호문 저장 (baseRev 가 다르면 conflict)
 *   key_get  {id}                         포털 계정별 '자료 비밀번호 감싸개'
 *   key_put  {id, iv, ct}                 감싸개 저장
 *   blob_get {id}                         사진 한 장
 *   blob_put {id, iv, ct, n}              사진 저장
 *   log                                   최근 기록(암호문 없이 시각·크기만)
 */
var SPREADSHEET_ID = '';        // 비워 두면 이 스크립트가 붙은 스프레드시트를 쓴다
var T_DOC = '동기화', T_BLOB = '사진', T_LOG = '기록';
var CHUNK = 45000, LOCK_MS = 30000, MAX_LOG = 200;

function doGet(e) { return handle_((e && e.parameter) || {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {}; } catch (err) { body = {}; }
  var p = (e && e.parameter) || {};
  for (var k in p) if (!(k in body)) body[k] = p[k];
  return handle_(body);
}

function handle_(body) {
  var action = String(body.action || 'get');
  var out;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_MS);
    var ss = ss_();
    if (action === 'ping') out = { ok: true, at: Date.now() };
    else if (action === 'get') out = getDoc_(ss, body);
    else if (action === 'put') out = putDoc_(ss, body);
    else if (action === 'key_get') out = getKey_(ss, body);
    else if (action === 'key_put') out = putKey_(ss, body);
    else if (action === 'blob_get') out = getBlob_(ss, body);
    else if (action === 'blob_put') out = putBlob_(ss, body);
    else if (action === 'log') out = readLog_(ss);
    else out = { ok: false, error: 'unknown_action', action: action };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
  out.action = action;
  out.serverTime = Date.now();
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ─────────── 시트 준비 ─────────── */
function ss_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  var a = SpreadsheetApp.getActiveSpreadsheet();
  if (a) return a;
  throw new Error('시트를 찾지 못했습니다');
}
function tab_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() < 1 || String(sh.getRange(1, 1).getValue()) !== head[0]) {
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.setFrozenRows(1);
    sh.getRange('A:C').setNumberFormat('@');
  }
  return sh;
}
/* A열 key → B열 값 (문자열) */
function readAll_(sh) {
  var map = {}, lr = sh.getLastRow();
  if (lr < 2) return map;
  var rows = sh.getRange(2, 1, lr - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    var k = String(rows[i][0] == null ? '' : rows[i][0]).trim();
    if (!k) continue;
    map[k] = { row: i + 2, v: String(rows[i][1] == null ? '' : rows[i][1]) };
  }
  return map;
}
function writeKV_(sh, key, value) {
  var lr = sh.getLastRow();
  if (lr >= 2) {
    var col = sh.getRange(2, 1, lr - 1, 1).getValues();
    for (var i = 0; i < col.length; i++) {
      if (String(col[i][0] == null ? '' : col[i][0]).trim() === key) {
        sh.getRange(i + 2, 2, 1, 2).setValues([[value, String(Date.now())]]);
        return;
      }
    }
  }
  sh.appendRow([key, value, String(Date.now())]);
}
function clearPrefix_(sh, prefix, map) {
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(prefix) === 0) {
      sh.getRange(map[keys[i]].row, 1, 1, 3).setValues([['', '', '']]);
    }
  }
}
function writeChunks_(sh, prefix, meta, text, map) {
  clearPrefix_(sh, prefix, map);
  var n = Math.ceil(text.length / CHUNK) || 1;
  meta.chunks = n;
  var rows = [];
  for (var i = 0; i < n; i++) rows.push([prefix + '#' + i, text.slice(i * CHUNK, (i + 1) * CHUNK), String(Date.now())]);
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, 3).setValues(rows);
  writeKV_(sh, prefix + '#meta', JSON.stringify(meta));
}
function readChunks_(prefix, map) {
  var metaRaw = map[prefix + '#meta'];
  if (!metaRaw || !metaRaw.v) return null;
  var meta;
  try { meta = JSON.parse(metaRaw.v); } catch (e) { return null; }
  var n = Number(meta.chunks) || 0, out = '';
  for (var i = 0; i < n; i++) {
    var c = map[prefix + '#' + i];
    if (!c) return null;
    out += c.v;
  }
  meta.text = out;
  return meta;
}

/* ─────────── 문서 ─────────── */
function getDoc_(ss, body) {
  var doc = norm_(body.doc) || 'raw';
  var sh = tab_(ss, T_DOC, ['key', 'value', 'updatedAt']);
  var map = readAll_(sh);
  var m = readChunks_('doc:' + doc, map);
  if (!m) return { ok: true, doc: doc, rev: 0, at: 0, n: 0, salt: '', iv: '', ct: '' };
  return { ok: true, doc: doc, rev: Number(m.rev) || 0, at: Number(m.at) || 0, n: Number(m.n) || 0,
           salt: String(m.salt || ''), iv: String(m.iv || ''), ct: m.text || '' };
}
function putDoc_(ss, body) {
  var doc = norm_(body.doc) || 'raw';
  var sh = tab_(ss, T_DOC, ['key', 'value', 'updatedAt']);
  var map = readAll_(sh);
  var cur = readChunks_('doc:' + doc, map);
  var curRev = cur ? (Number(cur.rev) || 0) : 0;
  var baseRev = body.baseRev == null ? null : Number(body.baseRev);
  if (baseRev != null && baseRev !== curRev) {
    return { ok: false, error: 'conflict', rev: curRev, at: cur ? Number(cur.at) || 0 : 0 };
  }
  var ct = String(body.ct || ''), iv = String(body.iv || '');
  if (!ct || !iv) return { ok: false, error: 'empty' };
  var next = { rev: curRev + 1, at: Date.now(), by: String(body.by || ''), n: Number(body.n) || 0,
               salt: String(body.salt || ''), iv: iv };
  writeChunks_(sh, 'doc:' + doc, next, ct, map);
  addLog_(ss, { at: next.at, action: 'put:' + doc, rev: next.rev, by: next.by, n: next.n, bytes: ct.length });
  return { ok: true, rev: next.rev, at: next.at };
}

/* ─────────── 열쇠 감싸개 ─────────── */
function norm_(v) { return String(v == null ? '' : v).trim().toLowerCase().slice(0, 64); }
function getKey_(ss, body) {
  var id = norm_(body.id);
  if (!id) return { ok: false, error: 'no_id' };
  var sh = tab_(ss, T_DOC, ['key', 'value', 'updatedAt']);
  var map = readAll_(sh);
  var r = map['key:' + id];
  if (!r || !r.v) return { ok: true, found: false, id: id };
  var o;
  try { o = JSON.parse(r.v); } catch (e) { o = null; }
  if (!o) return { ok: true, found: false, id: id };
  return { ok: true, found: true, id: id, at: Number(o.at) || 0, iv: String(o.iv || ''), ct: String(o.ct || '') };
}
function putKey_(ss, body) {
  var id = norm_(body.id);
  if (!id) return { ok: false, error: 'no_id' };
  var ct = String(body.ct || ''), iv = String(body.iv || '');
  if (!ct || !iv) return { ok: false, error: 'empty' };
  var sh = tab_(ss, T_DOC, ['key', 'value', 'updatedAt']);
  writeKV_(sh, 'key:' + id, JSON.stringify({ at: Date.now(), iv: iv, ct: ct }));
  addLog_(ss, { at: Date.now(), action: 'key_put', rev: '', by: id, n: '', bytes: ct.length });
  return { ok: true, id: id };
}

/* ─────────── 사진 ─────────── */
function getBlob_(ss, body) {
  var id = norm_(body.id);
  if (!id) return { ok: false, error: 'no_id' };
  var sh = tab_(ss, T_BLOB, ['key', 'value', 'updatedAt']);
  var map = readAll_(sh);
  var m = readChunks_('photo:' + id, map);
  if (!m) return { ok: true, found: false, id: id };
  return { ok: true, found: true, id: id, iv: String(m.iv || ''), ct: m.text || '', at: Number(m.at) || 0 };
}
function putBlob_(ss, body) {
  var id = norm_(body.id);
  if (!id) return { ok: false, error: 'no_id' };
  var ct = String(body.ct || ''), iv = String(body.iv || '');
  if (!ct || !iv) return { ok: false, error: 'empty' };
  var sh = tab_(ss, T_BLOB, ['key', 'value', 'updatedAt']);
  var map = readAll_(sh);
  writeChunks_(sh, 'photo:' + id, { at: Date.now(), iv: iv, n: Number(body.n) || ct.length }, ct, map);
  addLog_(ss, { at: Date.now(), action: 'photo_put', rev: '', by: id.slice(0, 12), n: '', bytes: ct.length });
  return { ok: true, id: id };
}

/* ─────────── 기록 ─────────── */
function addLog_(ss, rec) {
  var sh = ss.getSheetByName(T_LOG);
  if (!sh) {
    sh = ss.insertSheet(T_LOG);
    sh.getRange(1, 1, 1, 6).setValues([['at', 'action', 'rev', 'by', 'n', 'bytes']]);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(rec.at), rec.action, String(rec.rev || ''), String(rec.by || ''), String(rec.n || ''), String(rec.bytes || '')]);
  var extra = sh.getLastRow() - 1 - MAX_LOG;
  if (extra > 0) sh.deleteRows(2, extra);
}
function readLog_(ss) {
  var sh = ss.getSheetByName(T_LOG);
  if (!sh) return { ok: true, rows: [] };
  var lr = sh.getLastRow();
  if (lr < 2) return { ok: true, rows: [] };
  var n = Math.min(20, lr - 1);
  var rows = sh.getRange(lr - n + 1, 1, n, 6).getValues();
  return { ok: true, rows: rows.map(function (r) {
    return { at: (r[0] instanceof Date) ? r[0].getTime() : Number(r[0]) || 0, action: String(r[1] || ''),
             rev: String(r[2] || ''), by: String(r[3] || ''), n: String(r[4] || ''), bytes: String(r[5] || '') };
  }) };
}
