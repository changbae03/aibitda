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

        else:
            emit({"error": f"Unknown type: {data_type}"})
            sys.exit(1)

    except Exception as e:
        print(f"[pykrx_fetcher] error ({data_type}): {e}", file=sys.stderr)
        emit([])


if __name__ == "__main__":
    main()
