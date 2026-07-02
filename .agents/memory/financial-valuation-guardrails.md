---
name: Financial stock valuation guardrails
description: How incorrect fair value (적정주가) for financial companies is prevented — detection, clamping, QA
---

# Financial Stock Valuation Guardrails

**Why:** 금융지주/은행/보험/증권은 DCF 대신 P/B-ROE 모델이 맞음. AI가 DCF를 잘못 적용하면 음수 FCFF → 비현실적 목표주가 산출. 서버 사이드에서 반드시 별도 클램핑 필요.

## Detection (`needsFinancialSector` in ai-agents.ts)
- exported function — used in both ai prompt building AND analysis.ts server-side
- 3가지 방법: industry 정규식, 회사명 정규식, FINANCIAL_TICKERS Set 코드 직접 매칭
- 정규식: 은행|보험|증권사?|금융지주|금융그룹|금융투자|투자자문|NIM 등

## Server-side clamping (analysis.ts)
- `investment_strategy` tp-inject 단계와 DB 저장 단계 두 군데 모두 적용
- 금융주: **0.55x ~ 1.8x** (현재가 기준)
- 일반 KR: 0.45x ~ 3.0x
- 미국주: 0.25x ~ 5.0x
- 클램핑 발동 시 `[tp-save] 금융주 감지(...)` 로그 출력

## QA checker (qa-checker.ts)
- 금융주 리포트에 BVPS/NIM/NPL/Justified P/B 테이블 있으면 DCF 없어도 15점 합격
- Pattern: `isFinancialReport` = P/B-ROE|BVPS|Justified P/B|NIM|NPL비율 등

**How to apply:** 새 금융 관련 종목 추가 시 FINANCIAL_TICKERS Set에 코드 추가. 정규식이 대부분 커버하므로 특수 케이스만 코드로 추가.
