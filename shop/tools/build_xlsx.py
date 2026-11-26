#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""products.json → downloads/바다로운_상품관리.xlsx
쇼핑몰 관리자 「⬇ 엑셀 내려받기」와 같은 시트 구성(상품관리 + 입력안내), 같은 열 순서로 만든다.
"""
import json, os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
SHOP = os.path.dirname(HERE)
OUT = os.path.abspath(os.path.join(SHOP, '..', '..', 'downloads', '바다로운_상품관리.xlsx'))

COLS = [
    ('상품ID', 'id', 15),
    ('상품명', 'name', 32),
    ('분류', 'category', 11),
    ('규격/중량', 'weight', 20),
    ('한 줄 설명', 'summary', 32),
    ('소비자가', 'retailPrice', 11),
    ('판매가', 'salePrice', 11),
    ('도매가', 'wholesalePrice', 11),
    ('도매 최소수량', 'wholesaleMinQty', 13),
    ('원산지', 'origin', 26),
    ('재고수량', 'stock', 10),
    ('소비기한', 'expiryDate', 20),
    ('보관방법', 'storage', 40),
    ('품절여부(O/X)', 'soldOut', 13),
    ('배지', 'badge', 9),
    ('이미지경로', 'image', 26),
    ('정렬', 'sortNo', 7),
]

GUIDE = [
    ['바다로운 상품관리 엑셀 — 사용 안내'],
    [''],
    ['1. 「상품관리」 시트의 값을 고치고 저장합니다. (가격은 숫자만, 원 단위)'],
    ['2. 쇼핑몰 관리자 화면 → 내 정보 → 거래처 · 회원 · 상품 관리 → 📦 상품 관리 → ⬆ 엑셀 올리기'],
    ['3. 바뀐 내용을 미리 보여 줍니다. 「적용하고 시트에 저장」을 누르면 모든 기기의 쇼핑몰에 바로 반영됩니다.'],
    [''],
    ['[열 설명]'],
    ['상품ID', '기존 상품 ID는 바꾸지 마세요. 비우면 상품명으로 찾아 고치고, 없으면 새 상품으로 추가됩니다.'],
    ['상품명', '쇼핑몰 카드·상세페이지에 보이는 이름'],
    ['분류', '쥐포·어포 / 땅콩·호두 / 견과·씨앗 / 황태·진미채 / 김·미역·해조류 / 건새우·다시팩 / 건과일·건채소 / 조미료·건강재료 / 오징어 / 건어물 / 견과류 / 선물세트 — 새 분류도 그대로 표시됩니다.'],
    ['규격/중량', '예: 500g (주황 지퍼백)'],
    ['소비자가', '취소줄로 표시되는 정가. 0이면 정가 표시를 생략합니다.'],
    ['판매가', '일반 고객이 실제 결제하는 가격'],
    ['도매가', '거래처 로그인 시 보이는 도매가 (부가세 별도). 0이면 도매가를 표시하지 않습니다.'],
    ['도매 최소수량', '거래처가 한 번에 주문해야 하는 최소 수량'],
    ['원산지', '예: 중국산 (원료: 페루산 오징어) / 상품 표시사항 참조'],
    ['재고수량', '비우면 = 재고 표시·수량 제한 없음 / 숫자 = 그 수량만큼 판매, 0이면 자동 품절'],
    ['소비기한', '예: 2027-06-30 또는 제조일로부터 12개월 / 상품 표시사항 참조'],
    ['보관방법', '예: 수령 즉시 냉동(-18℃ 이하) 보관, 개봉 후 냉장 보관'],
    ['품절여부(O/X)', 'O = 품절(주문불가), X = 판매'],
    ['배지', '없음 / BEST / NEW / 추천'],
    ['이미지경로', '사이트 기준 경로 (예: images/pack-500g.jpg)'],
    ['정렬', '작은 숫자가 앞에 표시됩니다.'],
    [''],
    ['※ 주문이 들어오면 재고수량은 자동으로 줄어들고, 0이 되면 품절로 바뀝니다.'],
    ['※ 원산지·소비기한 등 식품 표시사항은 실제 값으로 적어 주세요. (식품 등의 표시·광고에 관한 법률)'],
]

HEAD_FILL = PatternFill('solid', fgColor='FF0B2B4A')
HEAD_FONT = Font(name='맑은 고딕', size=10.5, bold=True, color='FFFFFFFF')
BODY_FONT = Font(name='맑은 고딕', size=10.5)
THIN = Side(style='thin', color='FFE2D8C6')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def cell_value(p, key):
    if key == 'soldOut':
        return 'O' if p.get('soldOut') else 'X'
    if key == 'stock':
        return '' if p.get('stock') in (None, '') else int(p['stock'])
    if key == 'badge':
        return p.get('badge') or ''
    if key == 'image':
        img = p.get('image') or ''
        return '' if img.startswith('data:') else img
    if key in ('retailPrice', 'salePrice', 'wholesalePrice', 'wholesaleMinQty', 'sortNo'):
        return int(p.get(key) or 0)
    v = p.get(key)
    return '' if v is None else str(v)


def main():
    data = json.load(open(os.path.join(SHOP, 'products.json'), encoding='utf-8'))
    products = data['products']
    wb = Workbook()
    ws = wb.active
    ws.title = '상품관리'
    ws.append([c[0] for c in COLS])
    for i, col in enumerate(COLS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = col[2]
    for c in ws[1]:
        c.fill = HEAD_FILL
        c.font = HEAD_FONT
        c.alignment = Alignment(horizontal='center', vertical='center')
        c.border = BORDER
    for p in products:
        ws.append([cell_value(p, key) for _, key, _ in COLS])
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(COLS)):
        for c in row:
            c.font = BODY_FONT
            c.border = BORDER
            if isinstance(c.value, (int, float)):
                c.number_format = '#,##0'
                c.alignment = Alignment(horizontal='right')
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = 'A1:%s1' % get_column_letter(len(COLS))

    gs = wb.create_sheet('입력안내')
    for r in GUIDE:
        gs.append(r)
    gs.column_dimensions['A'].width = 18
    gs.column_dimensions['B'].width = 96
    gs['A1'].font = Font(name='맑은 고딕', size=12, bold=True, color='FF0B2B4A')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wb.save(OUT)
    print('saved', OUT, 'rows', ws.max_row - 1)


if __name__ == '__main__':
    main()
