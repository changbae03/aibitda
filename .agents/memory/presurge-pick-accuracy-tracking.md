---
name: Presurge pick accuracy tracking
description: How "내일 급등 예비군"(presurge) forecast accuracy is measured — forward snapshot tracking, not retroactive backtest.
---

The old "백테스팅" panel on the presurge widget only reversed historical surge events (found stocks that already surged ≥12%, looked at their pre-surge volume ratio) — it never validated whether the actual daily candidate list precedes real next-day surges.

Real accuracy is now tracked forward: each successful scan snapshots its candidates (`presurge_picks` table), and a scheduled resolver (`resolvePendingPresurgePicks`, every 6h) fills in the next trading day's actual close/return once available, using `fetchStockOHLCV` (KST date must be ISO `YYYY-MM-DD` for `toKRXDate`).

**Why:** Retroactive walk-forward backtesting (re-running the scorer over ~40 historical days) was rejected — it would multiply the presurge scan's already-slow fetch time (2-4min → 8-12min) and risk timing out the synchronous `POST /presurge/refresh` route. Forward accumulation reuses the existing scan cadence with near-zero extra cost.

**How to apply:** Accuracy data starts empty and grows one trading day at a time — do not expect immediate retroactive validation. If asked to tune presurge scoring weights, wait for `getPresurgePickAccuracy()` (`GET /api/market/presurge/accuracy`) to accumulate enough resolved samples (check `resolved`/`pending` counts) before trusting the score-band/dryup/near-high breakdowns.

## Precision tightening (2026-07-10, before any resolved data existed)

User complained a recommended pick didn't actually surge. With `resolved: 0` at the time (no real hit-rate data to diagnose from yet), inspecting raw candidates showed the contamination was structural, not a scoring-weight problem: SPACs (스팩) and preferred shares (우선주) were routinely appearing in the top candidates despite scoring well — these trade near NAV / track their common stock and don't follow normal technical breakout patterns, so they were diluting the list with noise.

**Why:** No amount of reweighting the existing indicators (volume dry-up/expansion, price compression, near-high, MA alignment, BB squeeze) fixes a list that structurally includes instruments the pattern doesn't apply to. Fix contamination before touching weights.

**How to apply:** `presurge_scan` in `pykrx_fetcher.py` now excludes SPACs (name contains "스팩") and preferred shares (ticker doesn't end in "0"), requires minimum liquidity (거래대금 ≥ 5억원/day) to avoid thin-float false patterns, requires a genuine core signal (dry-up or volume expansion, not just secondary indicators) to score at all, raised the min total score from 15→35, and cut the exposed list from 30→15 to surface only higher-conviction picks. When `resolved` accuracy data eventually accumulates, re-validate these thresholds against real hit rates rather than assuming the heuristic tightening is optimal long-term.
