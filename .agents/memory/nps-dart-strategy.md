---
name: NPS DART 대량보유 데이터 전략
description: 국민연금 5% 이상 보유 종목을 DART majorstock API로 최신화하는 방법
---

## 전략
1. NPS Excel(fund.nps.or.kr FL25002092)에서 ownershipPct 4.5%+ 종목 추출 (~250개)
2. `getCorpCodeFromCache(stockCode)` 로 DART corp_code 매핑
3. DART `majorstock.json` 배치 조회 (concurrency=15, timeout=10s)
4. `repror.includes("국민연금")` 필터 → 최신 신고일 기준 지분율

## 핵심 수치
- 결과 종목 수: ~248개
- DART 날짜 포맷: "YYYY-MM-DD" (dashes 있음)
- 캐시 TTL: 24시간
- 초기 로드 시간: ~14초 (concurrency=15, 250종목)
- 소스 라벨: "nps-dart"

**Why:** DART majorstock.json은 company별로 조회해야 하므로 전체 KOSPI(800+) 조회는 40초 이상 소요. Excel seed로 대상을 ~250개로 좁혀 현실적인 시간 내 완료.

**How to apply:** `nps-dart-holdings.ts`의 `OWNERSHIP_THRESHOLD`(현재 4.5) 조정으로 범위 변경 가능.
