/**
 * KIS (한국투자증권) Open API 클라이언트
 * 실전투자 환경 기반 — 실시간 주식 현재가·PER·PBR·EPS·BPS 조회
 */

const BASE_URL = "https://openapi.koreainvestment.com:9443";

interface KISToken {
  access_token: string;
  expires_at: number; // epoch ms
}

let _tokenCache: KISToken | null = null;

async function getAccessToken(): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expires_at) {
    return _tokenCache.access_token;
  }

  const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KIS token 발급 실패 (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`KIS token 응답 오류: ${JSON.stringify(data)}`);
  }

  // expires_in은 초 단위, 5분 여유 빼기
  const expiresIn = (data.expires_in ?? 86400) - 300;
  _tokenCache = {
    access_token: data.access_token,
    expires_at: Date.now() + expiresIn * 1000,
  };

  return _tokenCache.access_token;
}

export interface KISStockQuote {
  code: string;
  name?: string;
  price: number;               // 현재가
  per: number | null;          // PER (배)
  pbr: number | null;          // PBR (배)
  eps: number | null;          // EPS (원)
  bps: number | null;          // BPS (원)
  dps: number | null;          // DPS 주당배당금 (원)
  mcap: number | null;         // 시가총액 (억원)
  sharesOutstanding: number | null; // 상장주식수 (lstn_stcn)
  faceValue: number | null;    // 주식 액면가 (stck_fcam, 원)
  w52High: number | null;      // 52주 최고가
  w52Low: number | null;       // 52주 최저가
  roe: number | null;          // ROE (%)
  changeRate: number | null;   // 전일 대비 등락률(%)
  volume: number | null;       // 누적 거래량
  volumeTurnover: number | null; // 거래량 회전율(%)
}

/**
 * 국내 주식 현재가 + 투자 지표 조회
 * TR_ID: FHKST01010100 (주식현재가 시세)
 */
export async function fetchKISStockQuote(
  stockCode: string
): Promise<KISStockQuote | null> {
  try {
    const token = await getAccessToken();

    const url = new URL(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
    url.searchParams.set("FID_INPUT_ISCD", stockCode);

    const res = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: "FHKST01010100",
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      console.warn(`[kis] ${stockCode} 조회 실패: ${res.status}`);
      return null;
    }

    const json = await res.json();
    if (json.rt_cd !== "0") {
      console.warn(`[kis] ${stockCode} 오류: ${json.msg1}`);
      return null;
    }

    const d = json.output;
    const parseNum = (v: string | undefined): number | null => {
      if (!v || v.trim() === "" || v === "0") return null;
      const n = parseFloat(v.replace(/,/g, ""));
      return isNaN(n) ? null : n;
    };
    const parseInt_ = (v: string | undefined): number | null => {
      if (!v || v.trim() === "" || v === "0") return null;
      const n = parseInt(v.replace(/,/g, ""), 10);
      return isNaN(n) ? null : n;
    };

    const eps = parseNum(d.eps);
    const bps = parseNum(d.bps);
    // ROE = EPS / BPS × 100 (inquire-price에 roe 필드 없음 — 직접 계산)
    const roe = eps !== null && bps !== null && bps > 0
      ? parseFloat(((eps / bps) * 100).toFixed(2))
      : null;

    return {
      code: stockCode,
      price: parseFloat(d.stck_prpr?.replace(/,/g, "") ?? "0"),
      per: parseNum(d.per),
      pbr: parseNum(d.pbr),
      eps,
      bps,
      dps: parseNum(d.stck_divi),       // 주당배당금(원) — 없으면 null
      mcap: parseNum(d.hts_avls),       // 시가총액 (억원)
      sharesOutstanding: parseInt_(d.lstn_stcn), // 상장주식수 (주)
      faceValue: parseNum(d.stck_fcam), // 주식 액면가 (원)
      w52High: parseNum(d.w52_hgpr),
      w52Low: parseNum(d.w52_lwpr),
      roe,
      changeRate: parseNum(d.prdy_ctrt),
      volume: parseInt_(d.acml_vol),    // 누적 거래량 (주)
      volumeTurnover: parseNum(d.vol_tnrt), // 거래량 회전율 (%)
    };
  } catch (err) {
    console.error(`[kis] fetchKISStockQuote(${stockCode}) 예외:`, err);
    return null;
  }
}

/**
 * 국내 주식 기간별 일별 시세 조회
 * TR_ID: FHKST03010100 (국내주식 기간별시세(일/주/월/년))
 * → 최근 3개월치 종가·거래대금 수집용
 */
interface KISDailyBar {
  date: string;       // YYYYMMDD
  close: number;      // 종가
  tradingValue: number; // 당일 거래대금(원)
}

async function fetchKISDailyPriceHistory(
  stockCode: string
): Promise<KISDailyBar[]> {
  try {
    const token = await getAccessToken();

    // 오늘 ~ 95일 전 (≈ 65 영업일, 3개월 + 버퍼)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 95);
    const fmt8 = (d: Date) =>
      d.toISOString().slice(0, 10).replace(/-/g, "");

    const url = new URL(
      `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
    );
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
    url.searchParams.set("FID_INPUT_ISCD", stockCode);
    url.searchParams.set("FID_INPUT_DATE_1", fmt8(startDate));
    url.searchParams.set("FID_INPUT_DATE_2", fmt8(endDate));
    url.searchParams.set("FID_PERIOD_DIV_CODE", "D");
    url.searchParams.set("FID_ORG_ADJ_PV", "1"); // 수정주가

    const res = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: "FHKST03010100",
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return [];
    const json = await res.json();
    if (json.rt_cd !== "0") return [];

    const rows: any[] = Array.isArray(json.output2) ? json.output2 : [];

    return rows
      .map((d: any) => ({
        date: String(d.stck_bsop_date ?? ""),
        close: parseFloat((d.stck_clpr ?? "0").replace(/,/g, "")),
        tradingValue: parseFloat((d.acml_tr_pbmn ?? "0").replace(/,/g, "")),
      }))
      .filter((d) => d.close > 0 && d.date.length === 8)
      .sort((a, b) => a.date.localeCompare(b.date)); // 오름차순 (오래된 → 최신)
  } catch {
    return [];
  }
}

/**
 * 여러 종목 동시 조회 (Promise.all, 최대 20개)
 */
export async function fetchKISStockQuotes(
  codes: string[]
): Promise<Map<string, KISStockQuote>> {
  const targets = codes.slice(0, 20);
  const results = await Promise.allSettled(
    targets.map((c) => fetchKISStockQuote(c))
  );

  const map = new Map<string, KISStockQuote>();
  for (let i = 0; i < targets.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value) {
      map.set(targets[i], r.value);
    }
  }
  return map;
}

/**
 * 분석 대상 종목의 실시간 컨텍스트 문자열 생성 + 원시 quote 반환
 * 기간별 시세(3개월)를 병렬 조회해서 수익률·거래대금 추세를 함께 제공
 */
export async function buildKISStockContext(
  stockCode: string
): Promise<{ context: string; quote: KISStockQuote } | null> {
  // 현재가·투자지표 + 기간별 시세를 병렬 조회
  const [quote, history] = await Promise.all([
    fetchKISStockQuote(stockCode),
    fetchKISDailyPriceHistory(stockCode),
  ]);
  if (!quote || !quote.price) return null;

  const fmt = (v: number | null, suffix = "") =>
    v !== null ? `${v.toLocaleString("ko-KR")}${suffix}` : "N/A";

  // 상장주식수: KIS lstn_stcn 직접값 — 가장 정확한 공식 수치
  const sharesLine = quote.sharesOutstanding != null
    ? `⭐ 상장주식수 [KIS 공식, 최우선]: ${quote.sharesOutstanding.toLocaleString("ko-KR")}주 (${(quote.sharesOutstanding / 1e8).toFixed(4)}억주)\n⛔ 밸류에이션 주당가치(EPS/BPS/목표주가) 계산 시 이 수치(${quote.sharesOutstanding.toLocaleString("ko-KR")}주)를 반드시 사용. Yahoo Finance 수치가 다를 경우 KIS 기준값 우선.`
    : null;

  // ── 수익률 계산 (history 기반) ─────────────────────────────────────────────
  // history는 오름차순(오래된→최신). 마지막 원소가 가장 최근 영업일
  const currentPrice = quote.price;
  let returnSection = "";

  if (history.length >= 2) {
    const calcReturn = (daysAgo: number): string | null => {
      const idx = Math.max(0, history.length - 1 - daysAgo);
      const pastBar = history[idx];
      if (!pastBar || pastBar.close <= 0) return null;
      const ret = ((currentPrice - pastBar.close) / pastBar.close * 100).toFixed(1);
      const sign = Number(ret) >= 0 ? "+" : "";
      return `${sign}${ret}% (${pastBar.close.toLocaleString("ko-KR")}원 → ${currentPrice.toLocaleString("ko-KR")}원)`;
    };

    const ret1m = history.length >= 21 ? calcReturn(20) : null;
    const ret3m = history.length >= 61 ? calcReturn(60) : null;

    if (ret1m || ret3m) {
      returnSection = `\n[KIS 최근 수익률]\n`;
      if (ret1m) returnSection += `최근 1개월 수익률: ${ret1m}\n`;
      if (ret3m) returnSection += `최근 3개월 수익률: ${ret3m}\n`;
    }
  }

  // ── 거래대금 추세 계산 ─────────────────────────────────────────────────────
  let tradingValueSection = "";

  if (history.length >= 5) {
    const recent = history.slice(-20); // 최근 최대 20 영업일
    const avg20 = recent.reduce((s, d) => s + d.tradingValue, 0) / recent.length;
    const last5 = history.slice(-5);
    const avg5  = last5.reduce((s, d) => s + d.tradingValue, 0) / last5.length;

    if (avg20 > 0) {
      const pctVsAvg = ((avg5 - avg20) / avg20 * 100).toFixed(0);
      const trend =
        Number(pctVsAvg) >= 50 ? "급증" :
        Number(pctVsAvg) >= 20 ? "증가" :
        Number(pctVsAvg) >= -20 ? "보통" :
        Number(pctVsAvg) >= -50 ? "감소" : "급감";
      const avg20B = (avg20 / 1e8).toFixed(0);
      const avg5B  = (avg5  / 1e8).toFixed(0);
      const sign   = Number(pctVsAvg) >= 0 ? "+" : "";
      tradingValueSection =
        `\n[KIS 거래대금 추세]\n` +
        `최근 5일 평균: ${avg5B}억원 / 20일 평균: ${avg20B}억원 → ` +
        `${sign}${pctVsAvg}% (${trend})\n`;
    }
  }

  const context = `
=== KIS 실시간 시세 데이터 (${new Date().toLocaleDateString("ko-KR")} 기준) ===
종목코드: ${stockCode}
현재가: ${fmt(quote.price, "원")} (전일 대비 ${quote.changeRate !== null ? (quote.changeRate > 0 ? "+" : "") + quote.changeRate.toFixed(2) + "%" : "N/A"})
52주 최고: ${fmt(quote.w52High, "원")} / 52주 최저: ${fmt(quote.w52Low, "원")}
시가총액: ${fmt(quote.mcap, "억원")}
${sharesLine ? sharesLine + "\n" : ""}
[KIS 실시간 투자지표]
| 지표 | 값 |
|------|-----|
| PER | ${quote.per !== null ? quote.per.toFixed(1) + "배" : "N/A (적자 또는 미산출)"} |
| PBR | ${quote.pbr !== null ? quote.pbr.toFixed(2) + "배" : "N/A"} |
| EPS | ${fmt(quote.eps, "원")} |
| BPS | ${fmt(quote.bps, "원")} |
| DPS | ${quote.dps !== null ? fmt(quote.dps, "원") : "N/A (미지급 또는 미산출)"} |
| ROE | ${quote.roe !== null ? quote.roe.toFixed(1) + "%" : "N/A"} |
| 액면가 | ${quote.faceValue !== null ? fmt(quote.faceValue, "원") : "N/A"} |
| 거래량 회전율 | ${quote.volumeTurnover !== null ? quote.volumeTurnover.toFixed(2) + "%" : "N/A"} |
${returnSection}${tradingValueSection}
※ KIS Open API 실전투자 실시간 데이터입니다. 밸류에이션 현재가·BPS·상장주식수 기준으로 최우선 활용하세요.
`;

  return { context, quote };
}
