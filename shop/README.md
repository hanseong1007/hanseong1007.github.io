# 🛒 바다로운 쇼핑몰 (경덕농수산) — 기본형

`(주)경덕농수산`의 온라인 쇼핑몰 **바다로운** 기본 시안입니다.
통합포털(`https://hanseong1007.github.io/`)과는 별개로 **`/shop/` 경로에만** 배포됩니다.

| 구분 | 주소 / 파일 |
|---|---|
| 라이브 | https://hanseong1007.github.io/shop/ |
| 화면 | `documents/shop/index.html` (한 파일, 외부 라이브러리 없음) |
| 상품·가격 | `documents/shop/products.json` **← 가격은 이 파일 하나만 고치면 됩니다** |
| 이미지 | `documents/shop/images/` (실제 제품컷 4장 + 일러스트 SVG 7장) |

---

## 1. 상품·가격 바꾸는 방법

`products.json`을 열어 상품 항목을 고치고 저장한 뒤 배포하면, 새로고침 즉시 화면 전체에 반영됩니다.
(브라우저가 예전 파일을 물고 있지 않도록 `cache: 'no-cache'`로 불러옵니다.)

```json
{
  "id": "bbq-500",
  "name": "바다로운 바베큐 오징어 500g",
  "category": "오징어",
  "weight": "500g (주황 지퍼백)",
  "retailPrice": 19900,
  "salePrice": 15900,
  "wholesalePrice": 11500,
  "wholesaleMinQty": 10,
  "badge": "BEST",
  "inStock": true,
  "image": "images/pack-500g.jpg",
  "summary": "달콤 짭조름, 숯불 향 가득한 국민 안주",
  "origin": "중국산 (원료: 페루산 오징어)",
  "storage": "수령 즉시 냉동(-18℃ 이하) 보관, 개봉 후 냉장 보관"
}
```

| 필드 | 뜻 | 비고 |
|---|---|---|
| `id` | 상품 고유 키 | 영문·숫자, 바꾸면 장바구니에 담긴 기존 항목과 연결이 끊깁니다 |
| `name` | 상품명 | |
| `category` | 분류 | `오징어` / `건어물` / `견과류` / `선물세트` (없는 분류도 자동으로 칩이 생깁니다) |
| `weight` | 규격·용량 | 상세·장바구니에 표시 |
| `retailPrice` | 소비자가(정가) | 취소선으로 표시, 할인율 계산 기준 |
| `salePrice` | 할인가 | 일반 고객이 실제 결제하는 가격 |
| `wholesalePrice` | 거래처 도매가 | 거래처 로그인 시 표시 (VAT 별도) |
| `wholesaleMinQty` | 도매 최소 수량 | 장바구니에서 이 수량 미만이면 주문이 막힙니다 |
| `badge` | `BEST` / `NEW` / `추천` / `null` | 카드·상세 좌상단 배지 |
| `inStock` | `true` / `false` | `false`면 품절 표시 + 담기 버튼 잠김 |
| `image` | 이미지 경로 | `images/` 안의 파일. SVG도 됩니다 |
| `summary` | 한 줄 설명 | 카드에 1줄, 상세에 전체 |
| `origin` | 원산지 | 식품 표시사항 — **반드시 실제 값으로** |
| `storage` | 보관 방법 | |

> 상품을 추가·삭제하려면 배열 항목을 추가·삭제하면 됩니다. 카테고리 개수·상품 수는 자동으로 다시 계산됩니다.

### 엑셀에서 한 번에 바꾸기

`scripts/shop_csv_to_json.py`가 엑셀(CSV)을 `products.json`으로 바꿔 줍니다.

```bash
python3 scripts/shop_csv_to_json.py 상품목록.csv documents/shop/products.json
```

CSV 첫 줄에 아래 열 이름을 쓰면 됩니다(한글 열 이름도 인식합니다).

```
id,name,category,weight,retailPrice,salePrice,wholesalePrice,wholesaleMinQty,badge,inStock,image,summary,origin,storage
```

엑셀에서는 `다른 이름으로 저장 → CSV UTF-8`로 내보낸 뒤 실행하세요.
(기존 `products.json`의 `store` 설정·거래처 계정은 그대로 유지됩니다.)

---

## 2. 가게 정보·계좌·배송비

`products.json` 맨 위 `store` 블록에서 바꿉니다.

| 키 | 현재 값 | 설명 |
|---|---|---|
| `brand` / `company` / `ceo` | 바다로운 / (주)경덕농수산 / 고경덕 | 헤더·푸터 |
| `phone` / `address` / `hours` | 061-743-1790 / 해룡산단1로 82-7 / 평일 09-18 | 문의·푸터·FAQ에 자동 반영 |
| `topNotice` | 전 상품 무료배송 … | 상단 띠 공지 |
| `shippingFee` | `0` | 배송비(원). `0`이면 "무료"로 표시 |
| `bank` | 농협 `000-0000-0000-00` / (주)경덕농수산 / `demo: true` | **무통장 입금 계좌** |
| `notice` | 안내 문구 배열 | 주문서·안내에 사용 |
| `dealers` | 거래처 계정 목록 | 아래 3번 참고 |

> ⚠️ `bank.demo`가 `true`이면 완료 화면에 "시안용 예시 계좌"라는 안내가 함께 나옵니다.
> 실제 계좌를 넣고 `"demo": false`로 바꾸면 그 안내가 사라집니다. **오픈 전 반드시 실제 계좌로 교체하세요.**

---

## 3. 거래처(도매) 계정

- 헤더의 **거래처 도매** → 사업자등록번호 + 비밀번호로 로그인하면 상품마다 도매가·최소 수량이 표시됩니다.
- 로그인 화면에는 **어떤 비밀번호 힌트도 넣지 않았습니다.**
- 시연용으로 로그인 없이 볼 수 있는 **`데모 거래처로 둘러보기`** 버튼이 따로 있습니다(데모 표시가 배너에 남습니다).
- 로그인 상태는 12시간 동안 브라우저에 유지되고, `거래처 로그아웃` 버튼으로 해제됩니다.

### 계정 추가

1. 아래 명령으로 비밀번호 해시를 만듭니다.

   ```bash
   python3 - <<'PY'
   import hashlib, secrets
   pw = '원하는비밀번호'
   salt = secrets.token_hex(8)
   print('salt:', salt)
   print('hash:', hashlib.sha256((salt + ':' + pw).encode()).hexdigest())
   PY
   ```

2. `products.json`의 `store.dealers` 배열에 추가합니다.

   ```json
   { "id": "000-00-00000", "name": "거래처 상호", "salt": "...", "hash": "..." }
   ```

사업자등록번호는 하이픈이 있어도 없어도 같은 번호로 인식합니다.

---

## 4. 화면 구성

- **히어로 배너** · 브랜드 소개 · 네 가지 약속 · 상품 목록(카테고리 필터 + 상품명 검색) · 브랜드 스토리 · 거래처 도매 안내 · FAQ · 푸터
- **상품 상세** — 큰 이미지, 가격(정가·할인가·할인율), 원산지·보관방법·규격, 수량 조절, 장바구니/바로 주문
- **장바구니** — 수량 조절·삭제, 합계, 도매 최소 수량 경고
- **주문서** — 주문자·배송지 입력(브라우저에 저장되어 다음 주문 때 자동 채움), 배송 메모 빠른 선택, 결제 수단 선택
  - **무통장 계좌이체** → 주문번호 생성 + 입금 계좌 안내
  - **카드·간편결제** → "현재 테스트 모드입니다 — 사업자등록증·통신판매업신고증으로 토스페이먼츠/포트원 API 키 연결 시 실결제로 전환됩니다" 안내 + 모의 승인
- **주문 완료** — 주문번호, 주문 내역, 결제 안내
- **반응형** — PC 1280 · 모바일 390 기준, 모바일에서는 하단 고정 주문 바와 바텀시트 상세

---

## 5. 배포

```bash
cd deploy/portal-repo        # hanseong1007/hanseong1007.github.io 클론
rsync -a --delete /workspace/documents/shop/ shop/
git add shop && git commit -m "쇼핑몰(/shop): 바다로운 기본형 추가"
git push origin main
```

GitHub Pages(브랜치 `main` / 루트)가 자동 빌드합니다. 1~2분 뒤 https://hanseong1007.github.io/shop/ 에 반영됩니다.
**루트 `index.html`(통합포털)은 건드리지 않았습니다.**

배포 후 확인:

```bash
python3 scripts/test_shop.py https://hanseong1007.github.io/shop/
```

---

## 6. 오픈 전에 반드시 확인할 것 (시안 상태)

1. **가격은 전부 예시 값입니다.** 실제 판매가·도매가로 바꿔 주세요.
2. **입금 계좌는 예시(`000-0000-0000-00`)입니다.** 실제 계좌로 바꾸고 `bank.demo`를 `false`로.
3. **원산지·중량·유통기한 등 식품 표시사항**은 「식품 등의 표시·광고에 관한 법률」에 따라 실제 값이어야 합니다.
   지금은 확인되지 않은 상품을 `상품 표시사항 참조`로 두었습니다.
4. **통신판매업 신고** 후 신고번호를 푸터에 넣어 주세요(현재 "신고 준비 중").
5. **카드 결제**는 모의 승인입니다. 실제 결제는 사업자등록증·통신판매업신고증으로 토스페이먼츠/포트원 계약 후 API 키를 연결해야 합니다.
6. **이용약관·개인정보처리방침**은 요약 초안입니다. 법률 검토가 필요합니다.
7. **도매가 가림은 화면 장치입니다.** 정적 사이트라 `products.json`을 직접 열면 도매가가 보입니다.
   도매가를 실제로 숨기려면 주문·회원 서버(백엔드)가 필요합니다.
8. 상품 이미지 중 바베큐 오징어 3컷은 실제 촬영본이고, 나머지 7종은 SVG 일러스트입니다.
   실제 제품 사진이 생기면 `images/`에 넣고 `products.json`의 `image`만 바꾸면 됩니다.

---

## 7. 파일

```
documents/shop/
├── index.html                  화면 (HTML + CSS + JS 한 파일)
├── products.json               상품·가격·가게 정보·거래처 계정
├── fonts/PretendardVariable.woff2
├── images/
│   ├── pack-500g.jpg            실제 제품컷
│   ├── pack-1kg.jpg
│   ├── pack-set.jpg
│   ├── cut-01~04.jpg            요리·브랜드 컷 (히어로·스토리)
│   ├── logo-blue.png / logo-white.png
│   └── svg-*.svg                사진이 없는 7종 상품 일러스트
├── screenshot-shop-pc.png       검증 스크린샷 (1280×800)
└── screenshot-shop-mobile.png   검증 스크린샷 (390×844)
```
