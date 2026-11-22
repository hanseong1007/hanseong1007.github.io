/* 경덕농수산 통합포털 서비스워커
 *
 * - 포털 화면(index.html)만 다룬다. /order-app/ · /worklog-app/ · /attendance-app/ 등
 *   다른 앱과 구글 시트 동기화(script.google.com) 요청은 손대지 않고 그대로 네트워크로 보낸다.
 * - 평소에는 네트워크 우선: 항상 최신 index.html 을 받아 오고, 성공한 것만 복사해 둔다.
 *   (포털을 새로 올리면 다음 접속에 바로 새 화면이 뜬다)
 * - 인터넷이 끊겼을 때만 저장해 둔 화면 → 없으면 offline.html 안내 화면.
 * - localStorage · IndexedDB · 쿠키는 건드리지 않는다(로그인·암호화 열쇠·시트 동기화 그대로).
 * - 주소는 이 파일 위치 기준 상대 경로라, 루트(/)에 올려도 하위 폴더에서 시험해도 같게 동작한다.
 */
const VERSION = 'kdw-portal-v2';
const CACHE = 'kdw-portal-' + VERSION;
const BASE = new URL('./', self.location.href);          /* 배포: https://hanseong1007.github.io/ */
const PRECACHE = ['index.html', 'offline.html', 'manifest.webmanifest',
                  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
/* 포털 자신의 파일인지 (scope 기준 상대 경로) */
const SHELL = /^$/;
const STATIC = /^(icons\/|manifest\.webmanifest$|offline\.html$)/;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        return Promise.all(PRECACHE.map(function (p) {
          return c.add(new Request(new URL(p, BASE).href, { cache: 'reload' }))
                  .catch(function () { /* 하나 실패해도 설치는 계속 */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE && k.indexOf('kdw-portal-') === 0) return caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;          /* 구글 시트·외부 API 는 그대로 */
  if (req.headers.get('range')) return;                     /* 부분 요청(동영상 등) 제외 */
  if (url.pathname.indexOf(BASE.pathname) !== 0) return;    /* 다른 앱 폴더는 건드리지 않는다 */
  const rel = url.pathname.slice(BASE.pathname.length);

  /* 화면 이동: 네트워크 우선 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.ok && (SHELL.test(rel) || rel === 'index.html')) put(req, res.clone());
          return res;
        })
        .catch(function () {
          return caches.match(BASE.href, { ignoreSearch: true })
            .then(function (hit) { return hit || caches.match(new URL('index.html', BASE).href, { ignoreSearch: true }); })
            .then(function (hit) { return hit || caches.match(new URL('offline.html', BASE).href); })
            .then(function (hit) { return hit || offlineText(); });
        })
    );
    return;
  }

  /* 아이콘·매니페스트: 있으면 바로 보여 주고 뒤에서 새로 받는다 */
  if (STATIC.test(rel) || SHELL.test(rel)) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        const fresh = fetch(req)
          .then(function (res) {
            if (res && res.ok) put(req, res.clone());
            return res;
          })
          .catch(function () { return hit; });
        return hit || fresh;
      })
    );
  }
});

function put(req, res) {
  if (!res || res.status !== 200 || res.type === 'opaque') return;
  caches.open(CACHE).then(function (c) { c.put(req, res).catch(function () {}); });
}

function offlineText() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>오프라인</title>' +
    '<p style="font-family:system-ui,sans-serif;padding:24px;line-height:1.6">' +
    '인터넷 연결을 확인한 뒤 다시 열어 주세요.</p>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
