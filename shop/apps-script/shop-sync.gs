/**
 * 바다로운 쇼핑몰 — 회원 · 거래처 · 주문 동기화 (Google Apps Script)
 * ------------------------------------------------------------------
 * 이 파일은 쇼핑몰(/shop/)과 구글 시트를 잇는 웹앱 코드입니다.
 *
 * 1) 이 스크립트를 쇼핑몰 운영용 스프레드시트에 연결(확장 프로그램 → Apps Script)하고
 *    아래 ADMIN_KEY 를 길고 무작위한 값으로 바꾼 뒤 저장합니다.
 * 2) 배포 → 새 배포 → 웹 앱
 *      - 다음 사용자로 실행: 나
 *      - 액세스 권한: 모든 사용자(익명 포함)
 * 3) 배포 후 나오는 /exec 주소를 documents/shop/products.json 의
 *    store.syncUrl 에 넣고 쇼핑몰을 다시 배포합니다.
 * 4) 쇼핑몰 관리자 화면(거래처·회원 관리)에서 같은 ADMIN_KEY 를 한 번 입력합니다.
 *    (키는 그 기기의 브라우저에만 저장되며 사이트 코드에는 들어가지 않습니다.)
 *
 * 안전 규칙
 *  - 비밀번호 평문은 받지도 저장하지도 않습니다. 쇼핑몰이 만든 salt + SHA-256(반복) 해시만 저장합니다.
 *  - 전체 회원·주문 목록(shop_get/shop_save)은 ADMIN_KEY 가 있어야만 열립니다.
 *  - 로그인 확인은 아이디로 salt 만 받아 브라우저가 해시를 만들고, 서버는 해시만 비교합니다.
 */

var ADMIN_KEY = 'PUT-A-LONG-RANDOM-KEY-HERE';   // ★ 배포 전에 반드시 바꾸세요 (사이트 코드에는 넣지 않습니다)

var HEAD = {
  members: ['id','name','phone','zip','addr','addr2','email','salt','hash','iter','role','active','deleted','createdAt','updatedAt'],
  dealers: ['id','loginId','name','salt','hash','iter','grade','discount','active','deleted','createdAt','updatedAt'],
  orders:  ['no','at','memberId','customerName','phone','email','itemsJson','total','pay','status','mode','dealer','shippingJson','createdAt']
};

function doGet(e){ return handle_(e); }
function doPost(e){ return handle_(e); }

function handle_(e){
  var params = (e && e.parameter) || {};
  var body = {};
  try{
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents) || {};
  }catch(err){ body = {}; }
  var action = String(body.action || params.action || '');
  var out;
  try{
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);           // 동시에 여러 기기가 저장해도 한 줄로 세운다
    try{
      out = route_(action, body, params);
    } finally {
      lock.releaseLock();
    }
  }catch(err){
    out = { ok:false, error:String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(action, body, params){
  switch(action){
    case 'shop_get':      return shopGet_(body);
    case 'shop_save':     return shopSave_(body);
    case 'shop_lookup':   return shopLookup_(body);
    case 'shop_login':    return shopLogin_(body);
    case 'shop_register': return shopRegister_(body);
    case 'shop_profile':  return shopProfile_(body);
    case 'shop_order':    return shopOrder_(body);
    default:              return { ok:false, error:'unknown_action' };
  }
}

/* ---------------- 시트 읽기/쓰기 ---------------- */
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }

function tab_(name){
  var sh = ss_().getSheetByName(name);
  if (!sh){
    sh = ss_().insertSheet(name);
    sh.appendRow(HEAD[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function keyOf_(name, row){ return String(name === 'orders' ? (row.no || '') : (row.id || '')); }

function readTable_(name){
  var sh = tab_(name);
  var values = sh.getDataRange().getValues();
  var head = values.shift() || HEAD[name];
  var out = [];
  for (var i = 0; i < values.length; i++){
    var row = values[i];
    if (!row || row[0] === '' || row[0] === null) continue;
    var o = {};
    for (var c = 0; c < HEAD[name].length; c++) o[HEAD[name][c]] = row[c];
    if (o.active === '') o.active = true;
    if (o.deleted === '') o.deleted = false;
    o.active = (o.active === false || String(o.active).toLowerCase() === 'false') ? false : true;
    o.deleted = (o.deleted === true || String(o.deleted).toLowerCase() === 'true') ? true : false;
    o.iter = Number(o.iter) || 1;
    o.createdAt = Number(o.createdAt) || 0;
    o.updatedAt = Number(o.updatedAt) || 0;
    if (name === 'dealers') o.discount = Number(o.discount) || 0;
    if (name === 'orders') o.total = Number(o.total) || 0;
    out.push(o);
  }
  return out;
}

function writeTable_(name, rows){
  var sh = tab_(name);
  var last = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, 1, last, HEAD[name].length).clearContent();
  if (rows && rows.length){
    sh.getRange(2, 1, rows.length, HEAD[name].length).setValues(rows.map(function(r){
      return HEAD[name].map(function(k){ return r[k] == null ? '' : r[k]; });
    }));
  }
}

function upsert_(name, incoming){
  if (!incoming || !incoming.length) return readTable_(name).length;
  var cur = readTable_(name);
  var map = {};
  cur.forEach(function(r){ var k = keyOf_(name, r); if (k) map[k] = r; });
  incoming.forEach(function(r){
    var k = keyOf_(name, r);
    if (!k) return;
    var c = map[k];
    if (!c || Number(r.updatedAt || r.createdAt || 0) >= Number(c.updatedAt || c.createdAt || 0)) map[k] = r;
  });
  var rows = Object.keys(map).map(function(k){ return map[k]; });
  writeTable_(name, rows);
  return rows.length;
}

/* ---------------- 관리자 전체 동기화 ---------------- */
function authed_(body){ return String(body.key || '') === String(ADMIN_KEY) && ADMIN_KEY !== 'PUT-A-LONG-RANDOM-KEY-HERE'; }

function shopGet_(body){
  if (!authed_(body)) return { ok:false, error:'unauthorized' };
  return { ok:true, shop:{
    v:1,
    updatedAt: new Date().toISOString(),
    members: readTable_('members'),
    dealers: readTable_('dealers'),
    orders: readTable_('orders')
  }};
}

function shopSave_(body){
  if (!authed_(body)) return { ok:false, error:'unauthorized' };
  var doc = body.shop || null;
  if (!doc && body.shopJson){
    try{ doc = JSON.parse(body.shopJson); }catch(e){ return { ok:false, error:'bad_shop_json' }; }
  }
  if (!doc || typeof doc !== 'object') return { ok:false, error:'no_shop' };
  var counts = {
    members: upsert_('members', doc.members || []),
    dealers: upsert_('dealers', doc.dealers || []),
    orders:  upsert_('orders', doc.orders || [])
  };
  return { ok:true, updatedAt:new Date().toISOString(), counts:counts };
}

/* ---------------- 로그인 ---------------- */
function findById_(id){
  id = String(id || '').trim().toLowerCase();
  if (!id) return null;
  var members = readTable_('members');
  for (var i = 0; i < members.length; i++){
    if (String(members[i].id).trim().toLowerCase() === id) return { kind:'member', row:members[i] };
  }
  var dealers = readTable_('dealers');
  for (var j = 0; j < dealers.length; j++){
    var d = dealers[j];
    if (String(d.loginId || '').trim().toLowerCase() === id ||
        String(d.id || '').replace(/[^0-9a-zA-Z]/g,'') === String(id).replace(/[^0-9a-zA-Z]/g,'')) {
      return { kind:'dealer', row:d };
    }
  }
  return null;
}

function shopLookup_(body){
  var hit = findById_(body.id);
  if (!hit) return { ok:true, found:false };
  return { ok:true, found:true, kind:hit.kind, salt:hit.row.salt, iter:Number(hit.row.iter) || 1,
           active:hit.row.active !== false, deleted:hit.row.deleted === true };
}

function shopLogin_(body){
  var hit = findById_(body.id);
  if (!hit || hit.row.deleted) return { ok:true, login:false };
  if (String(hit.row.hash || '') !== String(body.hash || '')) return { ok:true, login:false };
  if (hit.row.active === false) return { ok:true, login:false, inactive:true };
  var r = hit.row;
  if (hit.kind === 'dealer'){
    return { ok:true, login:true, kind:'dealer', profile:{
      id:r.id, name:r.name, loginId:r.loginId || '', grade:r.grade || 'A',
      discount:Number(r.discount) || 0, active:r.active !== false, createdAt:r.createdAt || 0
    }};
  }
  var orders = readTable_('orders').filter(function(o){
    return (o.memberId && String(o.memberId) === String(r.id)) || (o.phone && String(o.phone) === String(r.phone));
  }).map(function(o){
    var items = [];
    try{ items = JSON.parse(o.itemsJson || '[]'); }catch(e){}
    var shipping = {};
    try{ shipping = JSON.parse(o.shippingJson || '{}'); }catch(e){}
    return { no:o.no, at:o.at, memberId:o.memberId, customer:{ name:o.customerName, phone:o.phone, email:o.email },
             shipping:shipping, items:items, total:Number(o.total)||0, pay:o.pay, status:o.status,
             mode:o.mode, dealer:o.dealer, createdAt:Number(o.createdAt)||0 };
  });
  return { ok:true, login:true, kind:'member', orders:orders, profile:{
    id:r.id, name:r.name, phone:r.phone, zip:r.zip, addr:r.addr, addr2:r.addr2, email:r.email,
    role:r.role || 'member', active:r.active !== false, createdAt:r.createdAt || 0
  }};
}

/* ---------------- 가입 · 정보수정 · 주문 ---------------- */
function shopRegister_(body){
  var m = body.member || null;
  if (!m || !m.id || !m.salt || !m.hash) return { ok:false, error:'bad_member' };
  if (findById_(m.id)) return { ok:true, exists:true };
  var now = Date.now();
  var rec = {
    id:String(m.id).trim().toLowerCase(), name:String(m.name || ''), phone:String(m.phone || ''),
    zip:String(m.zip || ''), addr:String(m.addr || ''), addr2:String(m.addr2 || ''),
    email:String(m.email || m.id), salt:String(m.salt), hash:String(m.hash), iter:Number(m.iter) || 1,
    role:'member', active:true, deleted:false, createdAt:Number(m.createdAt) || now, updatedAt:now
  };
  upsert_('members', [rec]);
  return { ok:true, created:true };
}

function shopProfile_(body){
  var hit = findById_(body.id);
  if (!hit || String(hit.row.hash || '') !== String(body.hash || '')) return { ok:false, error:'unauthorized' };
  var p = body.profile || {};
  var row = hit.row;
  if (p.name != null) row.name = String(p.name);
  if (p.phone != null) row.phone = String(p.phone);
  if (p.zip != null) row.zip = String(p.zip);
  if (p.addr != null) row.addr = String(p.addr);
  if (p.addr2 != null) row.addr2 = String(p.addr2);
  row.updatedAt = Date.now();
  upsert_('members', [row]);
  return { ok:true };
}

function shopOrder_(body){
  var o = body.order || null;
  if (!o || !o.no) return { ok:false, error:'bad_order' };
  var rows = readTable_('orders');
  for (var i = 0; i < rows.length; i++){
    if (String(rows[i].no) === String(o.no)) return { ok:true, duplicate:true };
  }
  var memberId = '';
  if (body.id && body.hash){
    var hit = findById_(body.id);
    if (hit && String(hit.row.hash || '') === String(body.hash || '')) memberId = String(hit.row.id);
  }
  var now = Date.now();
  upsert_('orders', [{
    no:String(o.no), at:String(o.at || new Date().toISOString()), memberId:memberId || String(o.memberId || ''),
    customerName:String((o.customer && o.customer.name) || ''), phone:String((o.customer && o.customer.phone) || ''),
    email:String((o.customer && o.customer.email) || ''),
    itemsJson:JSON.stringify(o.items || []), total:Number(o.total) || 0, pay:String(o.pay || ''),
    status:String(o.status || (o.pay === 'card' ? '결제완료(테스트)' : '입금대기')),
    mode:String(o.mode || 'general'), dealer:String(o.dealer || ''),
    shippingJson:JSON.stringify(o.shipping || {}), createdAt:now
  }]);
  return { ok:true, no:String(o.no) };
}
