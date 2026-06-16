---
name: KRX OHLCV today data delay
description: KRX may not publish today's OHLCV data until ~2h after market close (15:30 KST); signals endpoint falls back to prev business day.
---

**Rule:** When fetching same-day OHLCV from pykrx for signals, always implement a fallback to the previous business day if today's data returns 0 rows.

**Why:** KRX finalizes and publishes daily OHLCV data after market close (15:30 KST). There is a window (observed: up to ~17:18 KST, so ~1h 45m after close) where pykrx returns a zero-filled or empty DataFrame for today's date. Direct Python shell tests run AFTER this window may show data while server-spawned calls run DURING the window return zeros.

**How to apply:** In `themes.ts` `fetchSignalsData()`, after `fetchBothMarketsOHLCV(todayKST())`:
```ts
if (allKRRaw.length === 0) {
  date = prevBusinessDate(date);
  allKRRaw = await fetchBothMarketsOHLCV(date);
}
```
`prevBusinessDate` skips weekends. Does not account for Korean public holidays.
