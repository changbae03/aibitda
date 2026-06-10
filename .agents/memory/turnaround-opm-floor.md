---
name: 실적추정 흑자전환보호 OPM 하한선
description: 과거 적자 기업이 최근 흑자 전환 시 fwdOpmCenter가 과도하게 음수/과소가 되는 문제 방지 로직
---

## 문제
동양파일(228340) 같은 기업이 과거 1~2년 영업적자 후 Q1 흑자 전환.
annualOpmAnchor가 음수(-8%)여서 Q1 확정 OPM(6.4%, confirmedWeight=30%)과 혼합 시
fwdOpmCenter가 음수가 됨 → Q2-Q4 추정 모두 적자 → 연간 적자 추정 오류.

## 해결 (analysis.ts, fwdOpmCenter 계산 직후)
- `confirmedIsProfit`: confirmedOpmAvg > 2.0 (확정 분기 OPM이 2% 초과 흑자)
- `fwdOpmCenterRaw < confirmedOpmAvg * 0.15`이면 → `max(raw, confirmedOpmAvg * 0.25)` 보정
- 보정 시 `fwdOpmTurnaroundNote` 텍스트 생성하여 앵커 출력에 첨부

**Why:** Q1만 확정(confirmedWeight=30%)이면 과거 적자 추세(70%)가 지배해 흑자전환 기업을 오도.
**How to apply:** 흑자전환 기업 (최근 Q1 OPM > 2%, 과거 연간 OPM < 0) 분석 시 자동 작동.
