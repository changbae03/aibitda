---
name: Signals self-HTTP trap
description: tomorrow-picks가 signals 엔드포인트를 HTTP로 자기 호출할 때 서버 시작 직후 빈 배열 반환 문제
---

## 규칙
`tomorrow-picks.ts`에서 signals 데이터가 필요할 때 `localhost:PORT/api/themes/signals`를 HTTP로 호출하면 안 된다.
대신 `themes.ts`에서 export된 `getSignalsCache()` / `fetchSignalsData()`를 직접 import해서 사용한다.

**Why:**
서버 시작 직후 KRX OHLCV 2651종목 계산이 완료되기 전에 tomorrow-picks 요청(`?refresh=1`)이 들어오면,
signals 엔드포인트가 아직 signalsCache에 데이터를 채우지 못해 빈 배열 `[]`을 반환한다.
결과: `signals.length=0 → signalMap.size=0 → confluencePicks=0, signalPicks=0` → laggard 5개만 출력.

**How to apply:**
- `themes.ts`: `getSignalsCache()`, `fetchSignalsData()` export 유지
- `tomorrow-picks.ts`의 `loadSignals()`:
  1. `getSignalsCache()` 우선 — 인메모리 캐시 직접 읽기 (HTTP 없음)
  2. 캐시 미스 시 `fetchSignalsData()` 직접 호출 — KRX 데이터 직접 fetch
- 다른 라우트에서도 signals 데이터 필요 시 동일 패턴 적용
