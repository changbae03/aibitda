#!/usr/bin/env python3
"""
pykrx 데이터 fetcher — Node.js에서 child_process로 호출
사용: python3 pykrx_fetcher.py <type> <from_date> <to_date> [market]

type:
  investor    - 시장별 투자자 순매수 (외국인/기관)
  short_market - 시장별 공매도 거래대금
  ohlcv       - 종목 OHLCV (market 인자에 종목코드)
  cap         - 종목 시가총액 (market 인자에 종목코드)

날짜 형식: YYYYMMDD
출력: JSON (stdout) — 로그/에러는 stderr
"""
import sys
import os
import json
import warnings

warnings.filterwarnings("ignore")


class StdoutToStderr:
    """pykrx 내부 print가 stdout으로 나오지 않도록 stderr로 리다이렉트"""
    def __enter__(self):
        self._orig = sys.stdout
        sys.stdout = sys.stderr
        return self

    def __exit__(self, *_):
        sys.stdout = self._orig


def emit(data):
    """JSON을 실제 stdout으로 출력 (StdoutToStderr 밖에서 호출)"""
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    if len(sys.argv) < 4:
        emit({"error": "Usage: pykrx_fetcher.py <type> <from> <to> [market]"})
        sys.exit(1)

    data_type  = sys.argv[1]
    from_date  = sys.argv[2]
    to_date    = sys.argv[3]
    market_arg = sys.argv[4] if len(sys.argv) > 4 else "KOSPI"

    # pykrx import + KRX 로그인 메시지 → stderr
    with StdoutToStderr():
        from pykrx import stock as krx

    try:
        # ── 투자자 순매수 ────────────────────────────────────────────────────
        if data_type == "investor":
            with StdoutToStderr():
                df = krx.get_market_trading_value_by_date(from_date, to_date, market_arg)

            if df.empty:
                emit([])
                return

            # 컬럼: 기관합계, 기타법인, 개인, 외국인합계, 전체
            result = []
            for date_idx, row in df.iterrows():
                rec = {"date": str(date_idx)[:10]}
                for col in df.columns:
                    try:
                        rec[col] = int(row[col])
                    except Exception:
                        rec[col] = 0
                result.append(rec)
            emit(result)

        # ── 공매도 투자자별 거래대금 ────────────────────────────────────────
        elif data_type == "short_market":
            with StdoutToStderr():
                df = krx.get_shorting_investor_value_by_date(from_date, to_date, market_arg)

            if df.empty:
                emit([])
                return

            # 컬럼: 기관, 개인, 외국인, 기타, 합계
            result = []
            for date_idx, row in df.iterrows():
                result.append({
                    "date":   str(date_idx)[:10],
                    "합계":   float(row.get("합계",  0)),
                    "외국인": float(row.get("외국인", 0)),
                    "기관":   float(row.get("기관",  0)),
                })
            emit(result)

        # ── 종목 OHLCV ───────────────────────────────────────────────────────
        elif data_type == "ohlcv":
            with StdoutToStderr():
                df = krx.get_market_ohlcv_by_date(from_date, to_date, market_arg)

            if df.empty:
                emit([])
                return

            result = []
            for date_idx, row in df.iterrows():
                result.append({
                    "date":   str(date_idx)[:10],
                    "open":   int(row.get("시가",  0)),
                    "high":   int(row.get("고가",  0)),
                    "low":    int(row.get("저가",  0)),
                    "close":  int(row.get("종가",  0)),
                    "volume": int(row.get("거래량", 0)),
                })
            emit(result)

        # ── 종목 시가총액 ────────────────────────────────────────────────────
        elif data_type == "cap":
            with StdoutToStderr():
                df = krx.get_market_cap_by_date(from_date, to_date, market_arg)

            if df.empty:
                emit([])
                return

            result = []
            for date_idx, row in df.iterrows():
                result.append({
                    "date":   str(date_idx)[:10],
                    "cap":    int(row.get("시가총액",  0)),
                    "shares": int(row.get("상장주식수", 0)),
                })
            emit(result)

        # ── 종목이 포함된 ETF 검색 (병렬) ──────────────────────────────────
        elif data_type == "etf_search":
            import concurrent.futures

            # market_arg = 6자리 종목코드 (예: "005930")
            stock_code = market_arg.strip()

            # 핵심 ETF 목록 — 시장 커버리지 높은 ETF 엄선
            MAJOR_ETFS = [
                # ─ 시장 전체 (KOSPI) ─
                ("069500", "KODEX 200",                    "삼성자산운용",    "시장전체"),
                ("102110", "TIGER 200",                    "미래에셋자산운용","시장전체"),
                ("152100", "ARIRANG 200",                  "한화자산운용",    "시장전체"),
                ("337140", "KODEX 코스피대형주",           "삼성자산운용",    "시장전체"),
                # ─ 시장 전체 (KOSDAQ) ─
                ("229200", "KODEX KOSDAQ150",              "삼성자산운용",    "시장전체"),
                ("232080", "TIGER KOSDAQ150",              "미래에셋자산운용","시장전체"),
                ("251340", "KODEX 코스닥150레버리지",      "삼성자산운용",    "시장전체"),
                # ─ 반도체·IT ─
                ("091160", "KODEX 반도체",                 "삼성자산운용",    "반도체·IT"),
                ("091230", "TIGER 반도체",                 "미래에셋자산운용","반도체·IT"),
                ("371130", "TIGER KRX반도체",              "미래에셋자산운용","반도체·IT"),
                # ─ 2차전지 ─
                ("305720", "KODEX 2차전지산업",            "삼성자산운용",    "2차전지"),
                ("305540", "TIGER 2차전지테마",            "미래에셋자산운용","2차전지"),
                # ─ 바이오·헬스케어 (KOSPI) ─
                ("143860", "TIGER 헬스케어",               "미래에셋자산운용","바이오·헬스케어"),
                ("244580", "KODEX 헬스케어",               "삼성자산운용",    "바이오·헬스케어"),
                ("227540", "KODEX 200 헬스케어",           "삼성자산운용",    "바이오·헬스케어"),
                # ─ 바이오·헬스케어 (KOSDAQ 소형주 포함) ─
                ("278540", "KODEX KOSDAQ150 헬스케어",     "삼성자산운용",    "바이오·헬스케어"),
                ("248130", "TIGER KOSDAQ150 헬스케어",     "미래에셋자산운용","바이오·헬스케어"),
                ("195870", "TIGER 바이오혁신",             "미래에셋자산운용","바이오·헬스케어"),
                # ─ 자동차·모빌리티 ─
                ("091180", "KODEX 자동차",                 "삼성자산운용",    "자동차·모빌리티"),
                # ─ 금융 ─
                ("091170", "KODEX 은행",                   "삼성자산운용",    "금융"),
                ("091210", "KODEX 증권",                   "삼성자산운용",    "금융"),
                # ─ 방산·우주 ─
                ("425030", "TIGER K-방산",                 "미래에셋자산운용","방산·우주"),
                ("425040", "KODEX K-방산",                 "삼성자산운용",    "방산·우주"),
                # ─ 에너지·화학 ─
                ("117460", "KODEX 에너지화학",             "삼성자산운용",    "에너지·화학"),
                # ─ 미디어·엔터 ─
                ("102970", "KODEX 미디어&엔터테인먼트",    "삼성자산운용",    "미디어·엔터"),
                # ─ 조선·기계 ─
                ("140710", "KODEX 조선",                   "삼성자산운용",    "조선·기계"),
            ]

            # pykrx는 이미 main()에서 import + KRX 로그인 완료 상태
            # 스레드 안전: StdoutToStderr 사용 금지 (global sys.stdout 경쟁 방지)
            # 개별 ETF PDF 조회는 로그인 후 무음(silent) 호출
            _real_stdout = sys.stdout

            def check_etf(etf_tuple):
                etf_code, etf_name, manager, category = etf_tuple
                try:
                    df = krx.get_etf_portfolio_deposit_file(etf_code)
                    if df.empty or stock_code not in df.index:
                        return None
                    weight = float(df.loc[stock_code, "비중"]) if "비중" in df.columns else 0.0
                    return {
                        "etfCode":  etf_code,
                        "etfName":  etf_name,
                        "manager":  manager,
                        "category": category,
                        "weight":   round(weight, 4),
                    }
                except Exception as ex:
                    print(f"[etf_search] skip {etf_code}: {ex}", file=sys.stderr)
                    return None

            result = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
                futures = [pool.submit(check_etf, etf) for etf in MAJOR_ETFS]
                for future in concurrent.futures.as_completed(futures, timeout=55):
                    try:
                        hit = future.result()
                        if hit is not None:
                            result.append(hit)
                    except Exception:
                        pass
            # 스레드 완료 후 stdout이 혹시 변경됐을 경우 복원
            sys.stdout = _real_stdout

            # 비중 내림차순 정렬
            result.sort(key=lambda x: x["weight"], reverse=True)
            emit(result)

        # ── ETF 구성종목(PDF) 조회 ──────────────────────────────────────────
        elif data_type == "etf_holdings":
            # market_arg = 6자리 ETF 종목코드 (예: "148020")
            etf_code = market_arg.strip()
            with StdoutToStderr():
                df = krx.get_etf_portfolio_deposit_file(etf_code)

            if df is None or df.empty:
                emit([])
                return

            rows_raw = []
            total_weight = 0.0
            total_qty    = 0.0
            for idx, row in df.iterrows():
                stock_code = str(idx)
                stock_name = str(row.get("구성종목명", row.get("종목명", "")))
                if stock_name == "nan" or not stock_name:
                    stock_name = stock_code
                weight = float(row.get("비중", 0))
                qty    = float(row.get("계약수", 0))
                rows_raw.append({"stockCode": stock_code, "stockName": stock_name, "weight": weight, "qty": qty})
                total_weight += weight
                total_qty    += qty

            # 비중이 모두 0이면 계약수 비례로 추정 (미국 ETF 등 해외 구성종목)
            if total_weight < 0.01 and total_qty > 0:
                for r in rows_raw:
                    r["weight"] = round(r["qty"] / total_qty * 100, 4) if r["qty"] > 0 else 0.0

            # 비중 > 0 필터링 후 내림차순 정렬
            result = [r for r in rows_raw if r["weight"] > 0]
            result.sort(key=lambda x: x["weight"], reverse=True)

            # 유효성 검증: 동일 종목코드가 여러 회사에 중복 사용되면 KRX 플레이스홀더 데이터
            # (미국 ETF는 비알파숫자 코드 허용 — 해외 종목 KRX 고유 식별자이므로 정상)
            from collections import Counter
            codes = [r["stockCode"] for r in result]
            code_freq = Counter(codes)
            dup_count = sum(v - 1 for v in code_freq.values() if v > 1)
            if result and dup_count > len(result) * 0.15:
                print(
                    f"[etf_holdings] {etf_code}: 중복 종목코드 감지 "
                    f"(dup={dup_count}/{len(result)}) → 신뢰할 수 없는 데이터 제외",
                    file=sys.stderr,
                )
                emit([])
                return

            for i, r in enumerate(result):
                r["rank"] = i + 1
                del r["qty"]   # 내부 필드 제거
            emit(result[:30])  # 상위 30개

        # ── 종목별 공매도 잔고 (잔량·금액·비중) ────────────────────────────
        elif data_type == "short_balance":
            # market_arg = 6자리 종목코드 (예: "005930")
            ticker = market_arg.strip()
            with StdoutToStderr():
                df = krx.get_shorting_balance(from_date, to_date, ticker)

            if df is None or df.empty:
                emit([])
                return

            result = []
            for date_idx, row in df.iterrows():
                result.append({
                    "date":      str(date_idx)[:10],
                    "shortQty":  int(row.get("공매도잔고", 0)),
                    "shortAmt":  int(row.get("공매도금액", 0)),
                    "shortRatio": float(row.get("비중", 0.0)),
                })
            # 최신 날짜 먼저
            result.reverse()
            emit(result)

        # ── 시장 전체 종목별 OHLCV (단일 시장) ──────────────────────────────────
        elif data_type == "ohlcv_market":
            # from_date = 날짜 (예: '20260616'), market_arg = 'KOSPI' or 'KOSDAQ'
            with StdoutToStderr():
                df = krx.get_market_ohlcv_by_ticker(from_date, market=market_arg)

            if df is None or df.empty:
                emit([])
                return

            # 거래 없는 종목 제외
            if "거래량" in df.columns:
                df = df[df["거래량"] > 0]

            result = []
            for ticker, row in df.iterrows():
                result.append({
                    "ticker": str(ticker),
                    "close":  int(row.get("종가",  0)),
                    "volume": int(row.get("거래량", 0)),
                    "change": round(float(row.get("등락률", 0)), 2),
                })
            emit(result)

        # ── KOSPI+KOSDAQ 통합 OHLCV (단일 프로세스 → KRX 로그인 1회) ─────────────
        elif data_type == "ohlcv_both":
            import math
            # from_date = 날짜 (예: '20260616')
            def safe_int(v, default=0):
                try:
                    f = float(v)
                    return default if math.isnan(f) else int(f)
                except Exception:
                    return default

            def safe_float(v, default=0.0):
                try:
                    f = float(v)
                    return default if math.isnan(f) else round(f, 2)
                except Exception:
                    return default

            result = []
            for mkt in ["KOSPI", "KOSDAQ"]:
                # ⚠️ StdoutToStderr 컨텍스트 없이 호출해야 함.
                # StdoutToStderr 내에서 get_market_ohlcv_by_ticker를 호출하면
                # KRX 응답 데이터가 모두 0으로 반환되는 pykrx 버그가 있음.
                df = krx.get_market_ohlcv_by_ticker(from_date, market=mkt)
                if df is None or df.empty:
                    continue
                has_change_col = "등락률" in df.columns
                for ticker, row in df.iterrows():
                    vol    = safe_int(row.get("거래량", 0))
                    close  = safe_int(row.get("종가", 0))
                    change = safe_float(row.get("등락률", 0.0)) if has_change_col else 0.0
                    if vol == 0:
                        continue   # 거래 없는 종목 제외
                    result.append({
                        "ticker": str(ticker),
                        "market": mkt,
                        "close":  close,
                        "volume": vol,
                        "change": change,
                        "name":   "",
                    })

            # 거래량 상위 200개 + 등락률 상위 50개 종목 이름 보완
            # (ETN·ELW·KONEX·우선주·신규상장 등 KIND 미등재 코드 포함)
            sorted_by_vol    = sorted(result, key=lambda x: x["volume"], reverse=True)
            sorted_by_change = sorted(result, key=lambda x: x["change"],  reverse=True)
            top_tickers = list(dict.fromkeys(
                [item["ticker"] for item in sorted_by_vol[:200]] +
                [item["ticker"] for item in sorted_by_change[:50]]
            ))
            extra_names = {}
            for t in top_tickers:
                try:
                    name = krx.get_market_ticker_name(t)
                    if name and name != t:
                        extra_names[t] = name
                except Exception:
                    pass
            if extra_names:
                for item in result:
                    if item["ticker"] in extra_names:
                        item["name"] = extra_names[item["ticker"]]

            emit(result)

        # ── 종목별 투자자 순매수 ─────────────────────────────────────────────
        elif data_type == "investor_stocks":
            # market_arg = 쉼표로 구분된 종목코드 목록
            tickers = [t.strip() for t in market_arg.split(",") if t.strip()]
            result = []
            for ticker in tickers:
                try:
                    with StdoutToStderr():
                        df = krx.get_market_trading_value_by_investor(from_date, to_date, ticker)
                    if df.empty:
                        continue
                    # DataFrame: index=투자자구분, columns=['매도','매수','순매수']
                    def get_val(idx):
                        try:
                            v = df.loc[idx, "순매수"]
                            return int(v // 100_000_000)
                        except Exception:
                            return 0
                    individual  = get_val("개인")
                    institution = get_val("기관합계")
                    foreign     = get_val("외국인")
                    result.append({
                        "ticker":      ticker,
                        "individual":  individual,
                        "institution": institution,
                        "foreign":     foreign,
                    })
                except Exception as e:
                    print(f"[investor_stocks] {ticker} 실패: {e}", file=sys.stderr)
            emit(result)

        # ── 급등 전조 스캔 (N일치 전 종목 OHLCV → 기술적 지표 → 점수화) ────────
        elif data_type == "presurge_scan":
            import math
            import statistics as _stat
            import concurrent.futures

            def _safe_int(v, default=0):
                try:
                    f = float(v)
                    return default if math.isnan(f) else int(f)
                except Exception:
                    return default

            def _safe_float(v, default=0.0):
                try:
                    f = float(v)
                    return default if math.isnan(f) else round(f, 4)
                except Exception:
                    return default

            # 1. 기준 종목으로 영업일 목록 추출
            with StdoutToStderr():
                ref_df = krx.get_market_ohlcv_by_date(from_date, to_date, "000660")
            if ref_df is None or ref_df.empty:
                emit({"candidates": [], "backtest": None, "error": "no trading dates"})
                return

            trading_dates = [str(d)[:10].replace("-", "") for d in ref_df.index]
            trading_dates = trading_dates[-15:]   # 최대 15 영업일

            # 2. 날짜×시장 조합별 전 종목 OHLCV 병렬 수집
            per_ticker: dict = {}   # ticker → {market, days:{date→{close,volume,change}}}

            def _fetch_one(date: str, mkt: str):
                df = krx.get_market_ohlcv_by_ticker(date, market=mkt)
                rows = []
                if df is not None and not df.empty:
                    has_change = "등락률" in df.columns
                    for ticker, row in df.iterrows():
                        c  = _safe_int(row.get("종가",  0))
                        v  = _safe_int(row.get("거래량", 0))
                        ch = _safe_float(row.get("등락률", 0.0)) if has_change else 0.0
                        if v > 0 and c >= 500:
                            rows.append((str(ticker), mkt, c, v, ch))
                return date, mkt, rows

            _real_stdout = sys.stdout
            sys.stdout   = sys.stderr   # pykrx 내부 출력 억제

            tasks = [(d, mkt) for d in trading_dates for mkt in ["KOSPI", "KOSDAQ"]]
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
                futs = [ex.submit(_fetch_one, d, mkt) for d, mkt in tasks]
                for fut in concurrent.futures.as_completed(futs, timeout=240):
                    try:
                        date_, mkt_, rows_ = fut.result()
                        for ticker, market, close, volume, change in rows_:
                            if ticker not in per_ticker:
                                per_ticker[ticker] = {"market": market, "days": {}}
                            per_ticker[ticker]["days"][date_] = {
                                "close": close, "volume": volume, "change": change
                            }
                    except Exception:
                        pass

            sys.stdout = _real_stdout

            # 3. 지표 계산
            today_date = trading_dates[-1]
            candidates = []
            surge_events = []   # 백테스팅용

            for ticker, info in per_ticker.items():
                days = info["days"]
                if today_date not in days:
                    continue

                ordered = sorted(days.keys())
                series  = [days[d] for d in ordered]
                closes  = [s["close"]  for s in series]
                volumes = [s["volume"] for s in series]

                today_close  = series[-1]["close"]
                today_volume = series[-1]["volume"]
                today_change = series[-1]["change"]

                # 급등 이벤트 수집 (백테스팅)
                for i in range(1, len(series)):
                    if series[i]["change"] >= 12 and i >= 1:
                        t1v = [s["volume"] for s in series[max(0, i-6):i]]
                        if len(t1v) >= 2 and _stat.mean(t1v[:-1]) > 0:
                            ratio = t1v[-1] / _stat.mean(t1v[:-1])
                            dryup = sum(1 for j in range(len(t1v)-1, 0, -1) if t1v[j] < t1v[j-1])
                            surge_events.append({
                                "ticker": ticker,
                                "surge_pct": series[i]["change"],
                                "t1_vol_ratio": ratio,
                                "t1_dryup": dryup,
                            })

                if len(series) < 6:
                    continue
                if today_change >= 20:   # 이미 급등 중 → 제외
                    continue

                # 유동성 필터: 오늘 거래대금 5억원 미만은 제외 (얇은 거래로 인한 우연 패턴 방지)
                today_turnover = today_close * today_volume
                if today_turnover < 500_000_000:
                    continue

                # 우선주 제외 (일반주는 티커 마지막 자리가 '0', 우선주는 그 외 숫자)
                if len(ticker) == 6 and ticker[-1] != "0":
                    continue

                # 거래량 지표
                vol5      = volumes[-6:-1]
                vol_mean5 = _stat.mean(vol5) if vol5 else 1
                vol_ratio = today_volume / vol_mean5 if vol_mean5 > 0 else 1

                # 거래량 수축일수 (연속)
                vol_dryup = 0
                for i in range(len(volumes)-2, max(0, len(volumes)-6), -1):
                    if volumes[i] < volumes[i-1]:
                        vol_dryup += 1
                    else:
                        break

                # 가격 압축률 (최근 5일 변동폭/평균)
                close5 = closes[-6:-1]
                if close5 and _stat.mean(close5) > 0:
                    price_range_pct = (max(close5) - min(close5)) / _stat.mean(close5) * 100
                else:
                    price_range_pct = 99.9

                # 20일 고점 근접도
                high20        = max(closes[-20:]) if len(closes) >= 20 else max(closes)
                near_high_pct = today_close / high20 * 100 if high20 > 0 else 50

                # 이동평균 정배열
                ma5  = _stat.mean(closes[-5:])  if len(closes) >= 5  else today_close
                ma20 = _stat.mean(closes[-20:]) if len(closes) >= 20 else today_close
                ma_aligned = ma5 > ma20 and today_close >= ma5 * 0.98

                # 3일 모멘텀
                mom3 = (closes[-1] / closes[-4] - 1) * 100 if len(closes) >= 4 and closes[-4] > 0 else 0

                # 볼린저 밴드 폭
                if len(closes) >= 6:
                    n      = min(20, len(closes))
                    bb_avg = _stat.mean(closes[-n:])
                    bb_std = _stat.stdev(closes[-n:]) if n > 1 else 0
                    bb_pct = 4 * bb_std / bb_avg * 100 if bb_avg > 0 else 10.0
                else:
                    bb_pct = 10.0

                # === 점수 계산 (0~100) ===
                # 1. 거래량 수축 (핵심): 최대 30점
                dryup_score = {4: 30, 3: 22, 2: 12}.get(min(vol_dryup, 4), 0)

                # 2. 거래량 팽창 (첫 신호): 최대 25점
                vol_score = min(25, max(0, (vol_ratio - 1) * 12.5))

                # 3. 가격 압축 (박스권): 최대 20점
                if price_range_pct < 2.0:   compression_score = 20
                elif price_range_pct < 3.5: compression_score = 15
                elif price_range_pct < 5.0: compression_score = 8
                else:                        compression_score = 0

                # 4. 20일 고점 근접 (박스권 직전): 최대 15점
                if 85 <= near_high_pct < 97:   near_high_score = 15
                elif 97 <= near_high_pct <= 100: near_high_score = 10
                elif 70 <= near_high_pct < 85:   near_high_score = 5
                else:                              near_high_score = 0

                # 5. 이동평균 정배열: 5점
                ma_score = 5 if ma_aligned else 0

                # 6. 볼린저 수축: 최대 5점
                if bb_pct < 3.0:   bb_score = 5
                elif bb_pct < 5.0: bb_score = 3
                else:               bb_score = 0

                total = dryup_score + vol_score + compression_score + near_high_score + ma_score + bb_score

                # 핵심 신호(거래량 수축 또는 거래량 팽창) 없이 다른 보조 지표만으로
                # 점수를 채운 케이스는 우연한 패턴일 가능성이 높아 제외 (정밀도 강화)
                if dryup_score == 0 and vol_score < 5:
                    continue

                # 최소 점수 기준 상향 (15 → 35): 애매한 후보를 걸러내고 확신도 높은
                # 종목만 남긴다
                if total < 35:
                    continue

                candidates.append({
                    "ticker":        ticker,
                    "market":        info["market"],
                    "close":         today_close,
                    "change":        round(today_change, 1),
                    "score":         round(total, 1),
                    "volExpansion":  round(vol_ratio, 1),
                    "volDryupDays":  vol_dryup,
                    "priceRangePct": round(price_range_pct, 1),
                    "nearHighPct":   round(near_high_pct, 1),
                    "maAligned":     ma_aligned,
                    "momentum3d":    round(mom3, 1),
                    "bbWidthPct":    round(bb_pct, 1),
                    "name":          "",
                })

            candidates.sort(key=lambda x: x["score"], reverse=True)
            top60 = candidates[:60]

            # 종목명 조회 + 스팩(SPAC) 제외 (스팩은 NAV 근접 거래 특성상 기술적
            # 패턴이 무의미해 정밀도를 떨어뜨림)
            _real_stdout = sys.stdout
            sys.stdout   = sys.stderr
            filtered = []
            for c in top60:
                try:
                    n = krx.get_market_ticker_name(c["ticker"])
                    c["name"] = n if n and n != c["ticker"] else c["ticker"]
                except Exception:
                    c["name"] = c["ticker"]
                if "스팩" in c["name"]:
                    continue
                filtered.append(c)
            sys.stdout = _real_stdout

            # 백테스팅 요약
            backtest = None
            if surge_events:
                backtest = {
                    "totalEvents":    len(surge_events),
                    "avgSurgePct":    round(_stat.mean(e["surge_pct"]    for e in surge_events), 1),
                    "avgT1VolRatio":  round(_stat.mean(e["t1_vol_ratio"] for e in surge_events), 2),
                    "avgT1DryupDays": round(_stat.mean(e["t1_dryup"]     for e in surge_events), 1),
                    "period":         f"{trading_dates[0]}~{trading_dates[-1]}",
                }

            # 최종 노출 개수도 30 → 15로 축소해 확신도 높은 상위 후보만 보여준다
            emit({"candidates": filtered[:15], "backtest": backtest,
                  "tradingDays": len(trading_dates), "scannedAt": today_date})

        else:
            emit({"error": f"Unknown type: {data_type}"})
            sys.exit(1)

    except Exception as e:
        print(f"[pykrx_fetcher] error ({data_type}): {e}", file=sys.stderr)
        emit([])


if __name__ == "__main__":
    main()
