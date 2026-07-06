---
name: investor_stocks validation trap
description: callPykrx의 validatePykrxArgs가 investor_stocks의 market 파라미터를 ALLOWED_MARKETS로 잘못 검증해 stocks 항상 0개 반환
---

## 문제

`fetchInvestorByStocks`는 `callPykrx("investor_stocks", date, date, tickers.join(","))` 형태로 호출한다.
`validatePykrxArgs`는 4번째 인자(market)를 `ALLOWED_MARKETS = {"KOSPI","KOSDAQ","ALL","KOSPI200"}`에서 검사하는데,
종목코드 목록 `"005930,000660,..."` 형식은 화이트리스트에 없어서 throw 발생.

`buildFlowData`에서 `Promise.allSettled`로 감싸져 있어 에러가 조용히 suppressed됐고,
`stockR.status === "rejected"` → `stockFlows = []` → 모든 종목 필터 제거 → `stocks: 0개` 응답.

**Why:** `callPykrx`의 market 파라미터가 두 가지 용도로 오버로딩됨 (시장 구분 vs 종목코드 목록).

## 해결

`TICKER_LIST_TYPES = new Set(["investor_stocks"])`를 정의하고,
해당 type일 때는 market 값이 `^[\d,]+$` 형식인지만 확인하도록 분기 처리.

```typescript
if (TICKER_LIST_TYPES.has(type)) {
  if (!TICKER_LIST_RE.test(market)) throw new Error(...);
} else if (!ALLOWED_MARKETS.has(market)) {
  throw new Error(...);
}
```

## 진단 팁

- `[flow] 완료 (YYYYMMDD): 종목 0/24개` 로그가 나오면 이 validation 문제를 의심
- `Promise.allSettled`가 에러를 삼키므로 로그에 별도 에러 메시지 없음
- pykrx 직접 Python 호출로는 정상 반환 확인 가능
