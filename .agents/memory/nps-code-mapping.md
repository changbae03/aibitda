---
name: NPS 국민연금 코드 매핑
description: NPS Excel의 회사명과 KRX corpList 이름이 달라 lookupCodeByName이 실패하는 케이스 정리
---

## 규칙
NPS 공시 Excel의 종목명은 약식명(예: "현대차")이고, KRX corpList(kind.krx.co.kr)의 HTML에는 정식명(예: "현대자동차")이 저장됨.
DISPLAY_NAME_OVERRIDE가 검색 표시용 이름을 오버라이드하지만 krx-cache.ts의 `name` 필드는 corpList 원본 그대로.

**Why:** `lookupCodeByName("현대차")`는 null을 반환하는데, corpList에는 "현대자동차"로 저장되어 있기 때문.

**How to apply:** `nps-holdings.ts`의 `NPS_NAME_TO_CODE`에 이름→코드 직접 매핑 유지. lookupCodeByName 퍼지 매칭은 잘못된 종목(현대차→현대차증권)을 반환하므로 사용 금지.

## 알려진 매핑 (NPS명 → 코드)
- 현대차 → 005380 (현대자동차)
- 삼성화재 → 000810 (삼성화재해상보험)
- LIG넥스원 → 079550
- LS ELECTRIC → 010120 (LS일렉트릭)
- KT&G → 033780
- KT → 030200
- HD현대미포 → 010620 (HD현대미포조선)
- 한국전력 → 015760
- SK바이오팜 → 326030
- 엔씨소프트 → 036570
- 현대차2우B → 005387
- 금호석유 → 011780
