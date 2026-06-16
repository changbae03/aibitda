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
                    })
            emit(result)

        else:
            emit({"error": f"Unknown type: {data_type}"})
            sys.exit(1)

    except Exception as e:
        print(f"[pykrx_fetcher] error ({data_type}): {e}", file=sys.stderr)
        emit([])


if __name__ == "__main__":
    main()
