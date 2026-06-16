---
name: pykrx ohlcv_by_ticker StdoutToStderr bug
description: get_market_ohlcv_by_ticker returns all-zero data when called inside StdoutToStderr context; must call without it.
---

**Rule:** Never call `krx.get_market_ohlcv_by_ticker()` inside a `with StdoutToStderr():` block.

**Why:** When `sys.stdout` is redirected to `sys.stderr` during the call, pykrx returns a correctly-shaped DataFrame (right row count, column names) but all numeric values are 0.0. The mechanism is unclear (possibly pykrx's internal XLS/response parsing uses sys.stdout). Other pykrx functions like `get_market_trading_value_by_date` and `get_market_trading_volume_by_date` are unaffected.

**How to apply:** In `pykrx_fetcher.py`, the `ohlcv_both` handler calls `get_market_ohlcv_by_ticker` OUTSIDE any `with StdoutToStderr():` block. Any pykrx print() output goes to stdout but callPykrx searches in reverse for the last `[`-starting line, so it still finds the JSON correctly.
