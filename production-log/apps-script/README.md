### 경덕농수산 원물·생산일지 동기화 웹앱 (Google Apps Script)

`raw-sync.gs` 는 원물정보·생산일지 앱의 **암호문**만 보관하는 웹앱입니다.

## 이미 배포된 것 (2026-11-26)

| 항목 | 값 |
|---|---|
| 스프레드시트 | 「경덕농수산 원물·생산일지 동기화 (암호화)」 — `1fuHN9o5FQ-Zs1HAOtZlRHpLhl1E8N32poWtVd6Rtgpg` |
| Apps Script 프로젝트 | 「경덕농수산 원물·생산일지 동기화」 |
| 웹앱 `/exec` | `https://script.google.com/macros/s/AKfycbzJ0kX5DkdEge9EAlFZV4aatCf2TftroKtTwFZFJDs4XNvPaLGc0pZB8xOfP6YoLDSb/exec` |
| 실행 | 나(phs76041@gmail.com) · 액세스 **모든 사용자(익명 포함)** |

- 이 주소는 `kdrm.js` 의 `SYNC_URL` 에 들어 있습니다. 바꿀 때는 두 앱의 `kdrm.js`(원물정보·생산일지)를 함께 고칩니다.
- 시트 탭: `동기화`(문서·열쇠), `사진`(사진 암호문), `기록`(최근 200건 시각·크기만)

## 시트 구조

| 탭 | key | value |
|---|---|---|
| 동기화 | `doc:raw#meta` / `doc:raw#0…` | `{rev, at, by, n, salt, iv, chunks}` + 45,000자씩 자른 암호문 |
| 동기화 | `doc:prod#meta` / `doc:prod#0…` | 위와 같음(생산일지) |
| 동기화 | `key:<계정id>` | 포털 열쇠로 감싼 자료 비밀번호 `{at, iv, ct}` |
| 사진 | `photo:<사진id>#meta` / `#0…` | 사진 한 장의 암호문(45,000자씩) |
| 기록 | — | `at`, `action`, `rev`, `by`, `n`, `bytes` |

## action

| action | 보내는 값 | 돌려주는 값 |
|---|---|---|
| `ping` | — | `{ok}` |
| `get` | `doc`(`raw`·`prod`) | `{rev, at, n, salt, iv, ct}` |
| `put` | `doc, baseRev, by, n, salt, iv, ct` | `{rev, at}` · 기준 rev가 다르면 `conflict` |
| `key_get` / `key_put` | `id` / `id, iv, ct` | 감싸개 |
| `blob_get` / `blob_put` | `id` / `id, iv, ct, n` | 사진 암호문 |

## 다시 배포해야 할 때

1. 시트에서 **확장 프로그램 → Apps Script** → `raw-sync.gs` 전체를 붙여 넣고 저장.
2. **배포 → 배포 관리 → 편집(연필) → 버전: 새 버전 → 배포**. (같은 `/exec` 주소 유지)
3. `curl -sL '<exec>?action=ping'` 로 `{"ok":true}` 확인.

> 서버에는 평문이 없습니다. 시트를 열어도 `key` 열과 base64 암호문만 보입니다.
