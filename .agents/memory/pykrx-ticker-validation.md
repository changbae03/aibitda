---
name: pykrx validation ticker types
description: callPykrx의 4번째 인자(market)가 타입별로 다른 형식을 가짐 — 타입별 검사 규칙
---

## 규칙

`validatePykrxArgs(type, fromDate, toDate, market)`의 `market` 인자는 type별로 의미가 다르다:

| type | market 자리에 넘기는 값 | 검사 집합 |
|------|------------------------|----------|
| `investor`, `short_market`, … | `"KOSPI"/"KOSDAQ"/"ALL"` | `ALLOWED_MARKETS` |
| `investor_stocks` | `"005930,000660,…"` 종목코드 쉼표 목록 | `TICKER_LIST_RE` `/^[\d,]+$/` |
| `ohlcv` | `"005930"` 단일 6자리 종목코드 | `TICKER_CODE_RE` `/^\d{6}$/` |

**Why:** `fetchStockOHLCV(ticker, from, to)` 내부에서 `callPykrx("ohlcv", from, to, ticker)` 형태로 ticker를 4번째 인자로 넘기는데, 기존 검사가 ALLOWED_MARKETS만 체크해 `[pykrx] 허용되지 않은 market: 125490` 에러 발생.

**How to apply:** 새로운 pykrx type 추가 시 4번째 인자가 market인지 ticker인지 반드시 확인하고 `TICKER_CODE_TYPES` 또는 `TICKER_LIST_TYPES`에 등록.
