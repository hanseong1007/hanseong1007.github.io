#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
쿠팡 '주식회사 경덕농수산'(storeId 335812) 스토어 전체 상품 141건을 바다로운 쇼핑몰 상품 목록으로 변환한다.
- 입력: 아래 RAW (2026-11-26 shop.coupang.com/A00252567 에서 '전체 (141)' 목록을 끝까지 스크롤해 수집)
  형식: 쿠팡상품ID~vendorItemId~썸네일경로~판매가~품절여부(1/0)~상품명
- 처리: 썸네일 내려받아 images/coupang/{ID}.webp 로 저장 → products.json 의 기존 10개 상품 뒤에 합친다.
"""
import json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHOP = os.path.dirname(HERE)
IMG_DIR = os.path.join(SHOP, 'images', 'coupang')

RAW = r"""
9804952609~96274385192~aa83/0da6816d6d4b4511d0474fb62461c7ae4ffc4cb0ab506a9d398b7cd1ef6c.jpeg~3000~0~반태 땅콩, 500g, 1개
9804953331~96274387712~881c/830937561b1aee919c9450cf75f67dd85f7552c60a94a9323d4538c4c25c.jpeg~17600~0~쥐포실채, 1개, 1kg
9804952742~96274385930~3111/580242425ea57dcc2ff62b49e929645806a212eee44142e3311263446348.png~31200~0~참쥐치포, 1개, 1kg
9804952743~96274386028~8945/382fa3bc8f5901d5606ecc97a6a2a23de39f8f069ed27a6b7c64e9d95aa1.jpeg~7000~0~남해안 보리새우, 300g, 1개
9804952658~96274385831~d1aa/72c9062fd8a74858a1e8e6a384164d9636ca49cf8328fd9eabc31adb9947.jpeg~7500~0~[중국산] 건 딱새우, 300g, 1개
9804952691~96274385995~78db/9438526879128814d923377a436f35772dadf2606bc6349a41bd7a71b083.png~1700~0~숏다리 모음, 1개, 20g 매운, 매운
9804952651~96274385545~a66b/204e9972761936d4970913b4f1492b112d42956ac1469713dc9427e10bdf.jpeg~23000~0~황태채 가정용 육수용 무침 해장국 황태 명태, 500g, 1개
9804952873~96274385091~e14a/60af981054a8ce65c630018f3c639dd4bf55d832e8d61915311f67418f52.jpeg~39000~0~브라질너트, 1kg, 1개
9804953288~96274388158~a481/b317db4c9933d92d0e946355ba6ba415c92fc7de2ab2f3ccecca6161cb53.png~9000~0~멸치 견과 혼합, 250g, 1개
9804952655~96274385642~b650/44b37ecdfeede61371f113b02e84f93bdb5854072e62b2f751234b072d72.jpeg~17500~0~호두 반 반태 1/4, 1kg, 1개
9804952447~96274384720~b1d6/205dcbdf35d2e047456ff736af8b19eab6d370ee1d802ba3497fca9b018c.jpeg~95000~0~통계피 15kg 계피스틱 대용량 업소용 식자재용 향신료 시나몬스틱 수정과 뱅쇼 한방재료, 15개
9804953273~96274388099~4ab3/5af38222c625897d22956ef6988508db9aa4f24451367a7663493d476747.jpeg~18000~0~나막스 건어포, 1개, 200g
9804953157~96274387817~757f/af45dd9a9d48633a839fb2a7c47d4b7a56f4a6a186115ee516b9e82ac2f9.jpeg~6400~0~참쥐포채, 1개, 200g
9804952645~96274385727~5188/2f3851723283af1aec79c973d68c89b3e1861ed658bd87f5e2c9ce8761b6.jpeg~7500~0~크렌베리, 1개, 500g
9804952552~96274385045~65c6/4c9482f85ecb2416d02f431f457bb8496e480f1d7470a5d6388743f14d77.jpeg~275000~0~자른미역 15kg 대용량 벌크 업소용 국산 국내산, 15개
9804952942~96274385609~6207/17dde298771b8bc914307e05f37bc487bdf8a5bf5112c026f379b9afdcbe.jpeg~4300~0~해바라기씨, 1kg, 1개
9804952609~96274385194~aa83/0da6816d6d4b4511d0474fb62461c7ae4ffc4cb0ab506a9d398b7cd1ef6c.jpeg~6000~0~반태 땅콩, 1kg, 1개
9804953273~96274388097~4ab3/5af38222c625897d22956ef6988508db9aa4f24451367a7663493d476747.jpeg~40000~0~나막스 건어포, 1개, 500g
9804952633~96274385362~c5d5/041f95e332a9d4d5ab1c1ff3c0349b413659d40d7d297660e58514e9593b.jpeg~10000~0~프리미엄 아몬드, 500g, 1개
9804952677~96274385916~8a27/a463796fc2fb343e8d7cb0a0fd8a8fa14f681a328f8f728957498d2e540e.jpeg~9800~0~완도톳 밥톳 마른톳 비빔톳 건조톳 밥반찬 대용량 업소용 한식, 200g, 1개
9804952558~96274384902~5efd/9f8bfd36f7eca7c4e9fa1cda97117cac0df7974ca477deab04e315eebe89.jpeg~6500~0~볶음땅콩, 1kg, 1개
9804952960~96274385590~9e1d/e79ee56c9db04081c1181bfc46a4c976f4e854c0dfbded56159fe78fae30.jpeg~15000~0~블루베리, 1개, 500g
9804953154~96274387631~d1aa/72c9062fd8a74858a1e8e6a384164d9636ca49cf8328fd9eabc31adb9947.jpeg~7000~0~건꽃새우 가정용 100g 300g 500g 1kg 볶음용 어린이반찬, 150g, 1개
9804952688~96274385451~0b81/ba15a772fdcc6b3dce0c38058a8834fc82274673d7a14e7ca31671ec1a88.jpeg~3000~0~땅콩 분말, 500g, 1개
9804952479~96274384787~8e84/9329c256a94655fd4ad4aca6b59a7b5e3adb92ca5dbcafb2a2401995262b.jpeg~144000~0~건미역 대용량 10kg 가정용 생일 미역국 식자재용 업소용, 200g, 200개
9804952658~96274385830~d1aa/72c9062fd8a74858a1e8e6a384164d9636ca49cf8328fd9eabc31adb9947.jpeg~20000~0~[중국산] 건 딱새우, 1kg, 1개
9804953203~96274387908~8ad0/4a08a7e0c6bf818338cf8ef4634887a14a230b5d5a8941916f0778430cb4.png~14500~0~대왕오다리, 1개, 300g
9804952651~96274385544~a66b/204e9972761936d4970913b4f1492b112d42956ac1469713dc9427e10bdf.jpeg~45500~0~황태채 가정용 육수용 무침 해장국 황태 명태, 1kg, 1개
9804952658~96274385833~d1aa/72c9062fd8a74858a1e8e6a384164d9636ca49cf8328fd9eabc31adb9947.jpeg~11000~0~[중국산] 건 딱새우, 500g, 1개
9804952651~96274385547~a66b/204e9972761936d4970913b4f1492b112d42956ac1469713dc9427e10bdf.jpeg~15000~0~황태채 가정용 육수용 무침 해장국 황태 명태, 300g, 1개
9804952689~96274385908~b993/d5631928914dee8de26e4fb84d00772e67a9b71484bc4896e42ad60d52ff.jpeg~23000~0~구운 양태채, 1kg, 1개
9804952651~96274385546~a66b/204e9972761936d4970913b4f1492b112d42956ac1469713dc9427e10bdf.jpeg~8000~0~황태채 가정용 육수용 무침 해장국 황태 명태, 150g, 1개
9804953083~96274385603~a86e/48e4b980e030ef135741996e3e1d3f35992896a56b1cd1fc641ab2c051c4.jpeg~9000~0~남해안 건미역 고흥미역 산모용 산후조리용 미역국 부드러운 식자재용 대용량 업소용, 500g, 1개
9804953201~96274387895~8058/d56a4ff256002406e9f5ffd6a10730e850ec194f1ab2609c450f50c6eeca.jpeg~39000~0~곱창재래돌김 곱창김 재래김 프리미엄 대용량 식자재용 반찬 햇김, 1g, 1개
9804953295~96274388147~99bc/d25561cfa44004a5fe6a81dd7b895156f8fef4a1df0696af0b1e19586cda.png~20000~0~구운 빵아귀포, 1개, 500g
9804952743~96274386029~8945/382fa3bc8f5901d5606ecc97a6a2a23de39f8f069ed27a6b7c64e9d95aa1.jpeg~11000~0~남해안 보리새우, 500g, 1개
9804952742~96274385928~3111/580242425ea57dcc2ff62b49e929645806a212eee44142e3311263446348.png~20200~0~참쥐치포, 1개, 600g
9804953157~96274387815~757f/af45dd9a9d48633a839fb2a7c47d4b7a56f4a6a186115ee516b9e82ac2f9.jpeg~11900~0~참쥐포채, 1개, 500g
9804952686~96274385570~d901/407ad083bb7a41782eb0398166f649cf2d97ee11c57d33e858657a046874.jpeg~5800~0~완도산 건다시마 육수용 국물용 대용량 업소용 식자재용 진한육수, 300g, 1개
9804953154~96274387630~d1aa/72c9062fd8a74858a1e8e6a384164d9636ca49cf8328fd9eabc31adb9947.jpeg~22100~0~건꽃새우 가정용 100g 300g 500g 1kg 볶음용 어린이반찬, 1개
9804952685~96274385038~1e9b/3d136fee727b5a899301b9cd95a7f0b461ebdaff773f7a6bbaaaead52be6.jpeg~9500~0~캐슈넛, 500g, 1개
9804952480~96274384794~9e02/fe064e42a8b4f23b34191abf01b74e0c73f7b33502d7002948e15ec1a578.jpeg~26000~0~피칸, 1kg, 1개
9804952691~96274385996~78db/9438526879128814d923377a436f35772dadf2606bc6349a41bd7a71b083.png~1800~0~숏다리 모음, 1개, 20g 오리지널, 오리지널
9804952481~96274384935~d90c/68e768f2e81bf38d712a81206cd9a010c7b76a4c36d7aeaec23a27c72e98.jpeg~395000~0~황태채 10kg 북어채 북어국 대용량 벌크 식자재용 식당용 육수용 해장국, 10개
9804953190~96274387840~d71f/50061f21d9bfc3b518766f1c7bc9693577f2d7c01c6e2f07a3d734d99e51.png~3600~0~쥐어채, 1개, 200g
9804952649~96274385857~c302/5a5edb11e5e38a715282eae27300719217dd8132764fb977b08a3ef61f51.jpeg~5500~0~건자두(푸룬), 500개, 500g
9804952609~96274385193~aa83/0da6816d6d4b4511d0474fb62461c7ae4ffc4cb0ab506a9d398b7cd1ef6c.jpeg~1600~0~반태 땅콩, 200g, 1개
9804952682~96274385312~97e1/94f04d8964dd37518ff76bc366f1ef7c255a4bb2c077771ea5558ba40047.jpeg~17500~0~아몬드 슬라이스, 1kg, 1개
9804952685~96274385037~1e9b/3d136fee727b5a899301b9cd95a7f0b461ebdaff773f7a6bbaaaead52be6.jpeg~6000~0~캐슈넛, 200g, 1개
9804952686~96274385569~d901/407ad083bb7a41782eb0398166f649cf2d97ee11c57d33e858657a046874.jpeg~8000~0~완도산 건다시마 육수용 국물용 대용량 업소용 식자재용 진한육수, 500g, 1개
9804953244~96274387546~c336/d0c21882461999cfc27bb5324d634aa51c758a84e9bffad19561f1f6b2da.png~21600~0~황태부채포, 350g, 1개, 중 350g
9804953331~96274387707~881c/830937561b1aee919c9450cf75f67dd85f7552c60a94a9323d4538c4c25c.jpeg~4400~0~쥐포실채, 1개, 200g
9804952689~96274385910~b993/d5631928914dee8de26e4fb84d00772e67a9b71484bc4896e42ad60d52ff.jpeg~6000~0~구운 양태채, 200g, 1개
9804952558~96274384901~5efd/9f8bfd36f7eca7c4e9fa1cda97117cac0df7974ca477deab04e315eebe89.jpeg~2800~0~볶음땅콩, 200g, 1개
9804952743~96274386027~8945/382fa3bc8f5901d5606ecc97a6a2a23de39f8f069ed27a6b7c64e9d95aa1.jpeg~4000~0~남해안 보리새우, 150g, 1개
9804952710~96274385393~af89/afb1044f58704c1e965c33dda0534814c0a9ecf5b6e305ff23d9b6dfd3d5.jpeg~53500~0~볶음피땅콩 10kg 대용량, 10개
9804952742~96274385931~3111/580242425ea57dcc2ff62b49e929645806a212eee44142e3311263446348.png~8500~0~참쥐치포, 1개, 220g
9804952645~96274385729~5188/2f3851723283af1aec79c973d68c89b3e1861ed658bd87f5e2c9ce8761b6.jpeg~12000~0~크렌베리, 1개, 1kg
9804952618~96274385414~633c/8c882b66e3d160aff12cee68076821329028ea84864451b1876e8121e6e5.jpeg~180000~0~아몬드슬라이스 아몬드가공 견과류 멸치볶음 반찬용 대용량 식자재용 식당용 가정용 벌크, 100g, 1개
9804952645~96274385728~5188/2f3851723283af1aec79c973d68c89b3e1861ed658bd87f5e2c9ce8761b6.jpeg~3000~0~크렌베리, 1개, 200g
9804952640~96274385667~9150/daaef085bc6a78714fa1bab9b9b27058549f46960e7ee195460aac78e0c3.jpeg~6000~0~땅콩 분태, 1kg, 1개
9804952682~96274385311~97e1/94f04d8964dd37518ff76bc366f1ef7c255a4bb2c077771ea5558ba40047.jpeg~9500~0~아몬드 슬라이스, 500g, 1개
9804953190~96274387842~d71f/50061f21d9bfc3b518766f1c7bc9693577f2d7c01c6e2f07a3d734d99e51.png~14300~0~쥐어채, 1개, 1kg
9804952685~96274385039~1e9b/3d136fee727b5a899301b9cd95a7f0b461ebdaff773f7a6bbaaaead52be6.jpeg~17500~0~캐슈넛, 1kg, 1개
9804953244~96274387547~c336/d0c21882461999cfc27bb5324d634aa51c758a84e9bffad19561f1f6b2da.png~45000~0~황태부채포, 850g, 1개, 특왕대 850g
9804953262~96274388052~eb2e/47298739b53caed97af3cccb64e3ac1624180fcb61ea99e2b25d1358b520.jpeg~6300~0~손질먹태 찢은먹태 간식용 대용량 안주용 맥주안주 캠핑간식 혼술, 500g, 1개
9804953273~96274388098~4ab3/5af38222c625897d22956ef6988508db9aa4f24451367a7663493d476747.jpeg~78000~0~무료배송 나막스 건어포, 1개, 1kg
9804952530~96274384997~4a49/81b12b582521852ce44133ee5f8f39194705d23459407c2414d718fb5bb7.jpeg~85000~0~호박씨 10kg 대용량 샐러드 볶음 약밥 떡 베이킹 식자재용 업소용 식당용, 10개
9804952608~96274385125~aefa/4482bcffecb92593a1d539fe22a1fa550900ee311ef8f24eb49f481c20a6.jpeg~5000~0~편강, 400g, 1개
9804953190~96274387841~d71f/50061f21d9bfc3b518766f1c7bc9693577f2d7c01c6e2f07a3d734d99e51.png~7700~0~쥐어채, 1개, 500g
9804952749~96274385897~27df/081364aae4e900f41cfc4d9b7d1c16879096383eaae5da8b523a4a3e5150.jpeg~9000~0~견과류 믹스, 500g, 1개
9804953203~96274387907~8ad0/4a08a7e0c6bf818338cf8ef4634887a14a230b5d5a8941916f0778430cb4.png~6000~0~대왕오다리, 1개, 100g
9804952667~96274385671~773b/8a5b058358d6f7730f4e5163ad67b1d024aa15c9f922c8560c4abe186e8e.jpeg~70000~0~건포도 대용량 10kg 베이커리 홈베이킹 샐러드 업소용 식자재용 벌크, 10개
9804952608~96274385124~aefa/4482bcffecb92593a1d539fe22a1fa550900ee311ef8f24eb49f481c20a6.jpeg~10000~0~편강, 1kg, 1개
9804953124~96274387606~5fbb/5707f98ed36d1daf5a54da9148f6024651882479cb6febd4882b811ccc13.jpeg~2500~0~자른미역 산모미역 산후조리용 미역국 대용량 업소용 식자재용 미역국 부드러운 선물용, 80g, 1개
9804952455~96274384764~2c1c/31366c4bd73ce62238ef733284f1c549eed09fad3ab640fb8de327ade263.jpeg~180000~0~쥐치포 쥐포 2L M 사이즈 대용량 두꺼운쥐포 건어물 안주 맥주집 마른안주 벌크, 10개, 10 2L
9804952455~96274384763~2c1c/31366c4bd73ce62238ef733284f1c549eed09fad3ab640fb8de327ade263.jpeg~180000~0~쥐치포 쥐포 2L M 사이즈 대용량 두꺼운쥐포 건어물 안주 맥주집 마른안주 벌크, 10개, 10 M
9804952686~96274385567~d901/407ad083bb7a41782eb0398166f649cf2d97ee11c57d33e858657a046874.jpeg~15000~0~완도산 건다시마 육수용 국물용 대용량 업소용 식자재용 진한육수, 1kg, 1개
9804952688~96274385450~0b81/ba15a772fdcc6b3dce0c38058a8834fc82274673d7a14e7ca31671ec1a88.jpeg~6000~0~땅콩 분말, 1kg, 1개
9804953295~96274388148~99bc/d25561cfa44004a5fe6a81dd7b895156f8fef4a1df0696af0b1e19586cda.png~36500~0~구운 빵아귀포, 1개, 1kg
9804952745~96274385802~b620/749739b21313574c2c866a88469b0bf0a03143e05fadceb7b62c9f09cdc9.jpeg~122000~0~[대용량] 땅콩분말, 1kg, 1개
9804952479~96274384786~8e84/9329c256a94655fd4ad4aca6b59a7b5e3adb92ca5dbcafb2a2401995262b.jpeg~150000~0~건미역 대용량 10kg 가정용 생일 미역국 식자재용 업소용, 10개
9804953244~96274387551~c336/d0c21882461999cfc27bb5324d634aa51c758a84e9bffad19561f1f6b2da.png~34200~0~황태부채포, 350g, 1개, 왕 350g
9804952456~96274384724~f6d4/d597dab546b870c47a7f2def2dcf063b4821619deea33be417be8bdefe96.jpeg~9000~0~건살구, 500개, 500g
9804952479~96274384788~8e84/9329c256a94655fd4ad4aca6b59a7b5e3adb92ca5dbcafb2a2401995262b.jpeg~120000~0~건미역 대용량 10kg 가정용 생일 미역국 식자재용 업소용, 1kg, 8개
9804953157~96274387816~757f/af45dd9a9d48633a839fb2a7c47d4b7a56f4a6a186115ee516b9e82ac2f9.jpeg~20300~0~참쥐포채, 1개, 1kg
9804952689~96274385909~b993/d5631928914dee8de26e4fb84d00772e67a9b71484bc4896e42ad60d52ff.jpeg~12000~0~구운 양태채, 500g, 1개
9804953331~96274387710~881c/830937561b1aee919c9450cf75f67dd85f7552c60a94a9323d4538c4c25c.jpeg~9500~0~쥐포실채, 1개, 500g
9804952696~96274385256~bbeb/dcc7fabce2f9961764e73f6d49ec72d88e3adadb2d2394e8b334cdd51f8a.jpeg~375000~0~구운아귀꼬리포 대용량 술안주 아귀포 꼬리포 바로먹는안주 10kg 벌크, 10개
9804952655~96274385640~b650/44b37ecdfeede61371f113b02e84f93bdb5854072e62b2f751234b072d72.jpeg~11000~0~호두 반 반태 1/4, 500g, 1개
9804952700~96274385721~075b/7705b747c778db97be131a7a53ae2e72d0534d82a60cfff77fc72bd08d95.jpeg~18000~0~호두 반태1/2, 1kg, 1개
9804952640~96274385668~9150/daaef085bc6a78714fa1bab9b9b27058549f46960e7ee195460aac78e0c3.jpeg~3000~0~땅콩 분태, 500g, 1개
9804952672~96274385780~aaed/9ea02b9fb256a9fc343d98eac54591a2246f13930694bfa0edb8caea8993.jpeg~2000~0~삼계탕 재료, 300g, 1개
9804952700~96274385722~075b/7705b747c778db97be131a7a53ae2e72d0534d82a60cfff77fc72bd08d95.jpeg~9000~0~호두 반태1/2, 500g, 1개
9804952928~96274385879~92b1/474e233be95219cda3da9f4ab1410797825f09df8597a1cba11cfbcdda39.jpeg~6000~0~샐러드 견과, 320g, 1개
9804952739~96274385673~d89f/ef2640cbbbd84a9afeee87faae7068f11742d8378c388e4d9fb9a139696a.png~160000~0~삼천포 쥐치포, 1개, 1kg
9804952558~96274384900~5efd/9f8bfd36f7eca7c4e9fa1cda97117cac0df7974ca477deab04e315eebe89.jpeg~4100~0~볶음땅콩, 500g, 1개
9804952942~96274385608~6207/17dde298771b8bc914307e05f37bc487bdf8a5bf5112c026f379b9afdcbe.jpeg~2600~0~해바라기씨, 500g, 1개
9804952873~96274385092~e14a/60af981054a8ce65c630018f3c639dd4bf55d832e8d61915311f67418f52.jpeg~20000~0~브라질너트, 500g, 1개
9804953154~96274387629~d1aa/72c9062fd8a74858a1e8e6a384164d9636ca49cf8328fd9eabc31adb9947.jpeg~10000~0~건꽃새우 가정용 100g 300g 500g 1kg 볶음용 어린이반찬, 1개
9804953295~96274388146~99bc/d25561cfa44004a5fe6a81dd7b895156f8fef4a1df0696af0b1e19586cda.png~8000~0~구운 빵아귀포, 1개, 200g
9804952749~96274385896~27df/081364aae4e900f41cfc4d9b7d1c16879096383eaae5da8b523a4a3e5150.jpeg~4100~0~견과류 믹스, 200g, 1개
9804953124~96274387607~5fbb/5707f98ed36d1daf5a54da9148f6024651882479cb6febd4882b811ccc13.jpeg~10000~0~자른미역 산모미역 산후조리용 미역국 대용량 업소용 식자재용 미역국 부드러운 선물용, 500g, 1개
9804952480~96274384793~9e02/fe064e42a8b4f23b34191abf01b74e0c73f7b33502d7002948e15ec1a578.jpeg~14000~0~피칸, 500g, 1개
9804953170~96274387660~d48b/de8e1d41bdde7d39b6c51dc79a156dcc7714c4ab1aee41cf801225f16c37.jpeg~6000~0~황태속살채 100g 황태채 명태 업소용 대용량 육수용 무침 해장국 자연건조, 1개
9804952739~96274385675~d89f/ef2640cbbbd84a9afeee87faae7068f11742d8378c388e4d9fb9a139696a.png~50000~0~삼천포 쥐치포, 1개, 300g
9804952677~96274385917~8a27/a463796fc2fb343e8d7cb0a0fd8a8fa14f681a328f8f728957498d2e540e.jpeg~19000~0~완도톳 밥톳 마른톳 비빔톳 건조톳 밥반찬 대용량 업소용 한식, 500g, 1개
9804953124~96274387608~5fbb/5707f98ed36d1daf5a54da9148f6024651882479cb6febd4882b811ccc13.jpeg~4200~0~자른미역 산모미역 산후조리용 미역국 대용량 업소용 식자재용 미역국 부드러운 선물용, 150g, 1개
9804952480~96274384795~9e02/fe064e42a8b4f23b34191abf01b74e0c73f7b33502d7002948e15ec1a578.jpeg~5000~0~피칸, 150g, 1개
9804953343~96274388035~8e89/109ee036f6fba6fab62b3271a5ff5d48fdb2d64a823af77aced413ecfb6e.jpeg~12200~0~북어 껍질 육수용 업소용 대용량 명태껍질 황태껍질, 1kg, 1개
9804952658~96274385832~d1aa/72c9062fd8a74858a1e8e6a384164d9636ca49cf8328fd9eabc31adb9947.jpeg~5000~0~[중국산] 건 딱새우, 150g, 1개
9804952649~96274385856~c302/5a5edb11e5e38a715282eae27300719217dd8132764fb977b08a3ef61f51.jpeg~11500~0~건자두(푸룬), 1000개, 1kg
9804953312~96274385110~f77b/d24f90e37809c8fa0c3e5d01921d642a32ec59623384cfe445590251ad10.jpeg~4000~0~비너스 땅콩, 500g, 1개
9804953312~96274385109~f77b/d24f90e37809c8fa0c3e5d01921d642a32ec59623384cfe445590251ad10.jpeg~6800~0~비너스 땅콩, 1kg, 1개
9804953083~96274385601~a86e/48e4b980e030ef135741996e3e1d3f35992896a56b1cd1fc641ab2c051c4.jpeg~16000~0~남해안 건미역 고흥미역 산모용 산후조리용 미역국 부드러운 식자재용 대용량 업소용, 1kg, 1개
9804952633~96274385364~c5d5/041f95e332a9d4d5ab1c1ff3c0349b413659d40d7d297660e58514e9593b.jpeg~18000~0~프리미엄 아몬드, 1kg, 1개
9804953154~96274387628~d1aa/72c9062fd8a74858a1e8e6a384164d9636ca49cf8328fd9eabc31adb9947.jpeg~13400~0~건꽃새우 가정용 100g 300g 500g 1kg 볶음용 어린이반찬, 1개
9804952698~96274385389~6853/9b9f703fe604604458b9f0fe5858fd3720481b3bc1b35a5a94629b15b4f2.jpeg~10500~0~바나나칩, 1kg, 1개
9804953083~96274385602~a86e/48e4b980e030ef135741996e3e1d3f35992896a56b1cd1fc641ab2c051c4.jpeg~5000~0~남해안 건미역 고흥미역 산모용 산후조리용 미역국 부드러운 식자재용 대용량 업소용, 200g, 1개
9804952603~96274385411~086b/76376baf37b7363fe1dbe3fdf05f69164636e02d36b36361594c623eb51c.jpeg~2000~0~삼계탕재료(황기 소포장), 300g, 1개
9804953170~96274387661~d48b/de8e1d41bdde7d39b6c51dc79a156dcc7714c4ab1aee41cf801225f16c37.jpeg~21900~0~황태속살채 100g 황태채 명태 업소용 대용량 육수용 무침 해장국 자연건조, 500g, 1개
9804953191~96274387868~edb5/93313f7806666acfe7615596a4993e779d3ceea41e7be40b51d4f8941ba9.png~3800~0~미쓰오다리, 1개, 1kg
9804953343~96274388036~8e89/109ee036f6fba6fab62b3271a5ff5d48fdb2d64a823af77aced413ecfb6e.jpeg~7400~0~북어 껍질 육수용 업소용 대용량 명태껍질 황태껍질, 500g, 1개
9804952447~96274384717~b1d6/205dcbdf35d2e047456ff736af8b19eab6d370ee1d802ba3497fca9b018c.jpeg~90000~0~통계피 15kg 계피스틱 대용량 업소용 식자재용 향신료 시나몬스틱 수정과 뱅쇼 한방재료, 10kg, 10개
9804952743~96274386026~8945/382fa3bc8f5901d5606ecc97a6a2a23de39f8f069ed27a6b7c64e9d95aa1.jpeg~20000~0~남해안 보리새우, 1kg, 1개
9804952928~96274385878~92b1/474e233be95219cda3da9f4ab1410797825f09df8597a1cba11cfbcdda39.jpeg~8300~0~샐러드 견과, 500g, 1개
9804952686~96274385568~d901/407ad083bb7a41782eb0398166f649cf2d97ee11c57d33e858657a046874.jpeg~3000~0~완도산 건다시마 육수용 국물용 대용량 업소용 식자재용 진한육수, 100g, 1개
9804952669~96274385486~7bbb/1a36a86143213a4299f6c6f0c02549e830aa7c36775645cfda07b7c9e034.jpeg~4000~0~커피 땅콩, 500g, 1개
9804952456~96274384723~f6d4/d597dab546b870c47a7f2def2dcf063b4821619deea33be417be8bdefe96.jpeg~16800~0~건살구, 1000개, 1kg
9804952655~96274385641~b650/44b37ecdfeede61371f113b02e84f93bdb5854072e62b2f751234b072d72.jpeg~7000~0~호두 반 반태 1/4, 150g, 1개
9804952669~96274385484~7bbb/1a36a86143213a4299f6c6f0c02549e830aa7c36775645cfda07b7c9e034.jpeg~6000~0~커피 땅콩, 1kg, 1개
9804952719~96274385280~d9ef/cdab8523e1c9acf6767bd784e24d461a92dae7ac96e63caf23fa670cf7b3.jpeg~225000~0~집게새우 국물새우 다시용 육수용 딱새우 10kg 벌크 대용량, 10개
9804953083~96274385600~a86e/48e4b980e030ef135741996e3e1d3f35992896a56b1cd1fc641ab2c051c4.jpeg~3500~0~남해안 건미역 고흥미역 산모용 산후조리용 미역국 부드러운 식자재용 대용량 업소용, 100g, 1개
9804952960~96274385591~9e1d/e79ee56c9db04081c1181bfc46a4c976f4e854c0dfbded56159fe78fae30.jpeg~28000~0~블루베리, 1개, 1kg
9804952926~96274385869~cf24/0eb1cc3bd689f6fd3ede1b4e835e8353804ea788e277996d76986a572b32.jpeg~2800~1~반건조 무화과, 1개, 200g
9804952610~96274384962~0df8/5860152fbe00335a76b85354bd7e86c7c45a1629e8c86498a578f19411ee.jpeg~420000~1~황태속살채 10kg 대용량 부드러운 술안주 해장국 식당용 업소용 식자재용, 10개
9804952926~96274385868~cf24/0eb1cc3bd689f6fd3ede1b4e835e8353804ea788e277996d76986a572b32.jpeg~9800~1~반건조 무화과, 1개, 1kg
9804952926~96274385867~cf24/0eb1cc3bd689f6fd3ede1b4e835e8353804ea788e277996d76986a572b32.jpeg~5600~1~반건조 무화과, 1개, 500g
9804953126~96274387651~e7e5/8e273e88aa924b16ee3f3517fcdfec6e72686933fdd3a970a7c4ecf67a41.jpeg~3600~1~살옆채 명태어채 조미채 살엽채 반찬용 업소용 식자재용 대용량 밥반찬 술안주, 200g, 1개
9804953126~96274387652~e7e5/8e273e88aa924b16ee3f3517fcdfec6e72686933fdd3a970a7c4ecf67a41.jpeg~7700~1~살옆채 명태어채 조미채 살엽채 반찬용 업소용 식자재용 대용량 밥반찬 술안주, 500g, 1개
9804953126~96274387653~e7e5/8e273e88aa924b16ee3f3517fcdfec6e72686933fdd3a970a7c4ecf67a41.jpeg~14300~1~살옆채 명태어채 조미채 살엽채 반찬용 업소용 식자재용 대용량 밥반찬 술안주, 1kg, 1개
"""

# 분류 규칙 (위에서부터 먼저 맞는 것)
CAT_RULES = [
    ('건새우·다시팩', ['보리새우', '딱새우', '꽃새우', '집게새우']),
    ('김·미역·해조류', ['미역', '다시마', '톳', '김,', '햇김', '돌김', '재래김']),
    ('황태·진미채', ['황태', '북어', '양태', '먹태', '명태', '살옆채', '살엽채', '진미채']),
    ('쥐포·어포', ['쥐포', '쥐치포', '쥐어채', '아귀', '오다리', '숏다리', '나막스', '건어포', '어포']),
    ('땅콩·호두', ['땅콩', '호두', '피땅콩']),
    ('견과·씨앗', ['아몬드', '캐슈넛', '피칸', '브라질너트', '호박씨', '해바라기씨', '견과', '샐러드 견과']),
    ('건과일·건채소', ['크렌베리', '건자두', '푸룬', '건살구', '건포도', '무화과', '바나나칩', '블루베리', '건과']),
    ('조미료·건강재료', ['계피', '편강', '삼계탕', '황기']),
]
CAT_DEFAULT = '기타'

SUMMARY = {
    '땅콩·호두': '고소함 가득한 땅콩·호두',
    '견과·씨앗': '바삭한 식감의 견과·씨앗',
    '건과일·건채소': '쫀득달콤한 건과일',
    '김·미역·해조류': '국물·반찬에 쓰는 해조류',
    '황태·진미채': '담백한 황태·진미채',
    '쥐포·어포': '쫄깃한 쥐포·어포 안주',
    '건새우·다시팩': '국물 맛을 내는 건새우',
    '조미료·건강재료': '요리에 쓰는 조미·건강 재료',
    '기타': '바다로운이 고른 먹거리',
}
STORAGE = {
    '땅콩·호두': '직사광선을 피해 서늘하고 건조한 곳에 보관, 개봉 후 냉장 보관',
    '견과·씨앗': '직사광선을 피해 서늘하고 건조한 곳에 보관, 개봉 후 냉장 보관',
    '건과일·건채소': '서늘하고 건조한 곳에 보관, 개봉 후 냉장 보관',
    '김·미역·해조류': '직사광선을 피해 서늘한 곳에 보관, 개봉 후 밀봉 냉장',
    '황태·진미채': '냉동(-18℃ 이하) 보관, 해동 후 재냉동 금지',
    '쥐포·어포': '냉동(-18℃ 이하) 보관, 해동 후 재냉동 금지',
    '건새우·다시팩': '냉동(-18℃ 이하) 보관, 개봉 후 밀봉 냉장',
    '조미료·건강재료': '직사광선을 피해 서늘한 곳에 보관',
    '기타': '직사광선을 피해 서늘한 곳에 보관',
}


def classify(name):
    for cat, keys in CAT_RULES:
        for k in keys:
            if k in name:
                return cat
    return CAT_DEFAULT


NOISE = ['대용량', '업소용', '식자재용', '식자재', '식당용', '가정용', '벌크', '볶음용',
         '어린이반찬', '바로먹는안주', '맥주안주', '캠핑간식', '혼술', '밥반찬', '술안주',
         '선물용', '한식', '부드러운', '진한육수', '육수용', '국물용', '무침', '해장국',
         '북어국', '조미채', '반찬용', '마른안주', '볶음', '약밥', '베이킹',
         '홈베이킹', '아몬드가공', '업소', '안주', '국산', '국내산', '향신료', '수정과',
         '뱅쇼', '한방재료', '생일', '미역국', '본사직영', '무료배송', '떡',
         '간식용', '안주용', '산모용', '산후조리용', '반찬']
SIZE_RE = r'\d+(?:\.\d+)?\s?(?:kg|g|ml|L)'


def clean_head(head):
    head = re.sub(r'\[?(대용량|무료배송)\]?\s*', '', head).strip()
    sizes = re.findall(SIZE_RE, head)
    if len(sizes) >= 2:                     # 상품명에 옵션 사이즈가 나열된 경우
        head = re.sub(SIZE_RE, '', head)
    tokens = head.split()
    kept = []
    for t in tokens:
        if t in NOISE:
            continue
        if any(t != k and t in k for k in kept):
            continue
        kept.append(t)
    return ' '.join(kept).strip()


def spec_of(name):
    segs = [s.strip() for s in name.split(',')][1:]
    segs = [s for s in segs if s and s != '1개']
    head_sizes = [x for x in re.findall(SIZE_RE, name.split(',')[0]) if x.replace(' ', '') not in ('1g', '1L')]
    out = []
    for s in segs:
        m = re.match(r'^(\d+)\s+([0-9]{0,3}[A-Za-z]+)$', s)     # '10 2L' → '2L × 10개'
        if m:
            s = '%s × %s개' % (m.group(2), m.group(1))
        else:
            m = re.match(r'^(중|왕|특왕대|소|대)\s+(\S+)$', s)  # '중 350g' → '350g (중)'
            if m:
                s = '%s (%s)' % (m.group(2), m.group(1))
        s = re.sub(r'^(매운|오리지널)\s+\1$', r'\1', s)
        if re.fullmatch(r'\d+개', s):                          # 낱개 수량은 버린다
            continue
        if s == '1g' or s == '1L':                             # 단위 중량 오기
            continue
        if s not in out:
            out.append(s)
    pieces = []
    weight = None
    cand = [s for s in out if re.match(SIZE_RE, s) or '×' in s]
    if cand:
        weight = max(cand, key=len)         # '350g (중)' 처럼 옵션 설명이 붙은 규격을 우선
    if not weight and head_sizes:
        weight = head_sizes[0].replace(' ', '')
    if weight:
        pieces.append(weight)
    kept = []
    wkey = weight.replace(' ', '') if weight else ''
    for s in out:
        if wkey and s.replace(' ', '') in wkey:
            continue
        if any(s != k and s in k for k in out):
            continue
        kept.append(s)
    pieces.extend(kept)
    if not pieces:
        m = re.search(SIZE_RE, name)
        if m and m.group(0).replace(' ', '') not in ('1g', '1L'):
            pieces = [m.group(0)]
    return ' · '.join(pieces)


def display_name(name):
    """첫 구절에서 홍보성 키워드를 덜어 낸 상품명"""
    head = clean_head(name.split(',')[0])
    head = re.sub(r'\s{2,}', ' ', head).strip()
    return head or name.split(',')[0].strip()


def origin_of(name, cat):
    if '[중국산]' in name or '중국산' in name:
        return '중국산'
    if '국산' in name or '국내산' in name:
        return '국내산'
    for k in ('남해안', '고흥', '완도', '삼천포'):
        if k in name:
            return '국내산'
    return '상품 표시사항 참조'


def thumb_url(path, size='492x492ex'):
    return 'https://thumbnail6.coupangcdn.com/thumbnails/remote/%s/image/vendor_inventory/%s' % (size, path)


def fetch_one(item):
    pid = item['pid']
    dst = os.path.join(IMG_DIR, pid + '.webp')
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        return pid, 'cached'
    for host in ('thumbnail6', 'thumbnail7', 'thumbnail10', 'thumbnail9'):
        url = 'https://%s.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/%s' % (host, item['thumb'])
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://shop.coupang.com/'})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            tmp = dst + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(data)
            im = Image.open(tmp).convert('RGB')
            im.thumbnail((500, 500))
            im.save(dst, 'WEBP', quality=82, method=4)
            os.remove(tmp)
            return pid, len(data)
        except Exception as e:
            last = str(e)
    raise RuntimeError('image failed %s: %s' % (pid, last))


def main():
    rows = []
    for line in RAW.strip().splitlines():
        parts = line.split('~')
        if len(parts) != 6:
            sys.exit('bad row: ' + line[:80])
        pid, vid, thumb, price, soldout, name = parts
        rows.append({'pid': pid, 'vid': vid, 'thumb': thumb, 'price': int(price),
                     'soldOut': soldout == '1', 'name': name})

    seen = set()
    uniq = []
    for r in rows:
        key = (r['pid'], r['vid'])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    print('rows: raw %d → unique %d' % (len(rows), len(uniq)))

    os.makedirs(IMG_DIR, exist_ok=True)
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(fetch_one, uniq))
    print('images: %d' % len(results))

    products = []
    for i, r in enumerate(uniq):
        cat = classify(r['name'])
        spec = spec_of(r['name'])
        base_name = display_name(r['name'])
        if spec:
            base_name = re.sub(r'\s{2,}', ' ', re.sub(SIZE_RE, '', base_name)).strip() or base_name
        name = (base_name + (' ' + spec if spec and spec not in base_name else '')).strip()
        summary = SUMMARY[cat]
        products.append({
            'id': 'cp-' + r['pid'] + '-' + r['vid'][-4:],
            'name': name,
            'coupangName': r['name'],
            'category': cat,
            'weight': spec or '-',
            'summary': summary,
            'retailPrice': r['price'],
            'salePrice': r['price'],
            'wholesalePrice': 0,
            'wholesaleMinQty': 1,
            'badge': None,
            'inStock': not r['soldOut'],
            'image': 'images/coupang/%s.webp' % r['pid'],
            'origin': origin_of(name, cat),
            'stock': None,
            'expiryDate': '',
            'soldOut': r['soldOut'],
            'sortNo': 10 + i,
            'storage': STORAGE[cat],
            'source': 'coupang',
            'coupangPid': r['pid'],
            'coupangItemId': r['vid'],
            'coupangUrl': 'https://www.coupang.com/vp/products/%s?vendorItemId=%s' % (r['pid'], r['vid'])
        })

    path = os.path.join(SHOP, 'products.json')
    data = json.load(open(path, encoding='utf-8'))
    base = [p for p in data['products'] if not str(p.get('id', '')).startswith('cp-')]
    for p in base:
        p.setdefault('source', 'bada')
    data['products'] = base + products
    data['updatedAt'] = '2026-11-26'
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('products.json: base %d + coupang %d = %d' % (len(base), len(products), len(data['products'])))

    with open(os.path.join(HERE, 'coupang_products.json'), 'w', encoding='utf-8') as f:
        json.dump(products, f, ensure_ascii=False, indent=1)

    cats = {}
    for p in products:
        cats[p['category']] = cats.get(p['category'], 0) + 1
    print(json.dumps(cats, ensure_ascii=False))


if __name__ == '__main__':
    main()
