#!/usr/bin/env python3
"""
pykrx 데이터 fetcher — Node.js에서 child_process로 호출
사용: python3 pykrx_fetcher.py <type> <from_date> <to_date> [market]

type:
  investor   - 시장별 투자자 순매수 (외국인/기관)
  short      - 시장별 공매도 비율
  ohlcv      - 종목 OHLCV (market 인자에 종목코드)

날짜 형식: YYYYMMDD
출력: JSON (stdout)
"""
import sys
import os
import json
import warnings

warnings.filterwarnings("ignore")

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: pykrx_fetcher.py <type> <from> <to> [market]"}))
        sys.exit(1)

    data_type  = sys.argv[1]
    from_date  = sys.argv[2]
    to_date    = sys.argv[3]
    market_arg = sys.argv[4] if len(sys.argv) > 4 else "KOSPI"

    # KRX 환경변수 설정 (pykrx 내부에서 자동으로 읽음)
    krx_id = os.environ.get("KRX_ID", "")
    krx_pw = os.environ.get("KRX_PW", "")
    if krx_id:
        os.environ["KRX_ID"] = krx_id
    if krx_pw:
        os.environ["KRX_PW"] = krx_pw

    from pykrx import stock as krx

    try:
        if data_type == "investor":
            # 시장별 투자자 순매수 (외국인/기관/개인)
            df = krx.get_market_trading_value_by_date(from_date, to_date, market_arg)
            if df.empty:
                print(json.dumps([]))
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
            print(json.dumps(result, ensure_ascii=False))

        elif data_type == "short":
            # 시장별 공매도 비율
            df = krx.get_shorting_balance_by_date(from_date, to_date, market_arg)
            if df.empty:
                # 대안: 종목코드로 공매도 시도
                print(json.dumps([]))
                return
            result = []
            for date_idx, row in df.iterrows():
                rec = {"date": str(date_idx)[:10]}
                for col in df.columns:
                    try:
                        rec[col] = float(row[col])
                    except Exception:
                        rec[col] = 0.0
                result.append(rec)
            print(json.dumps(result, ensure_ascii=False))

        elif data_type == "short_market":
            # 시장 공매도 거래 비중
            df = krx.get_shorting_volume_by_date(from_date, to_date, market_arg)
            if df.empty:
                print(json.dumps([]))
                return
            result = []
            for date_idx, row in df.iterrows():
                rec = {"date": str(date_idx)[:10]}
                for col in df.columns:
                    try:
                        rec[col] = float(row[col])
                    except Exception:
                        rec[col] = 0.0
                result.append(rec)
            print(json.dumps(result, ensure_ascii=False))

        elif data_type == "ohlcv":
            # 종목 OHLCV (market_arg = 종목코드)
            df = krx.get_market_ohlcv_by_date(from_date, to_date, market_arg)
            if df.empty:
                print(json.dumps([]))
                return
            result = []
            for date_idx, row in df.iterrows():
                result.append({
                    "date":   str(date_idx)[:10],
                    "open":   int(row.get("시가", 0)),
                    "high":   int(row.get("고가", 0)),
                    "low":    int(row.get("저가", 0)),
                    "close":  int(row.get("종가", 0)),
                    "volume": int(row.get("거래량", 0)),
                })
            print(json.dumps(result, ensure_ascii=False))

        elif data_type == "cap":
            # 종목 시가총액 (market_arg = 종목코드)
            df = krx.get_market_cap_by_date(from_date, to_date, market_arg)
            if df.empty:
                print(json.dumps([]))
                return
            result = []
            for date_idx, row in df.iterrows():
                result.append({
                    "date":   str(date_idx)[:10],
                    "cap":    int(row.get("시가총액", 0)),
                    "shares": int(row.get("상장주식수", 0)),
                })
            print(json.dumps(result, ensure_ascii=False))

        else:
            print(json.dumps({"error": f"Unknown type: {data_type}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e), "type": data_type}), file=sys.stderr)
        print(json.dumps([]))

if __name__ == "__main__":
    main()
