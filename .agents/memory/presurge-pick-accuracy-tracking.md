---
name: Presurge pick accuracy tracking
description: How "내일 급등 예비군"(presurge) forecast accuracy is measured — forward snapshot tracking, not retroactive backtest.
---

The old "백테스팅" panel on the presurge widget only reversed historical surge events (found stocks that already surged ≥12%, looked at their pre-surge volume ratio) — it never validated whether the actual daily candidate list precedes real next-day surges.

Real accuracy is now tracked forward: each successful scan snapshots its candidates (`presurge_picks` table), and a scheduled resolver (`resolvePendingPresurgePicks`, every 6h) fills in the next trading day's actual close/return once available, using `fetchStockOHLCV` (KST date must be ISO `YYYY-MM-DD` for `toKRXDate`).

**Why:** Retroactive walk-forward backtesting (re-running the scorer over ~40 historical days) was rejected — it would multiply the presurge scan's already-slow fetch time (2-4min → 8-12min) and risk timing out the synchronous `POST /presurge/refresh` route. Forward accumulation reuses the existing scan cadence with near-zero extra cost.

**How to apply:** Accuracy data starts empty and grows one trading day at a time — do not expect immediate retroactive validation. If asked to tune presurge scoring weights, wait for `getPresurgePickAccuracy()` (`GET /api/market/presurge/accuracy`) to accumulate enough resolved samples (check `resolved`/`pending` counts) before trusting the score-band/dryup/near-high breakdowns.
