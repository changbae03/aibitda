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
  price: number;         // 현재가
  per: number | null;    // PER (배)
  pbr: number | null;    // PBR (배)
  eps: number | null;    // EPS (원)
  bps: number | null;    // BPS (원)
  mcap: number | null;   // 시가총액 (억원)
  w52High: number | null; // 52주 최고가
  w52Low: number | null;  // 52주 최저가
  roe: number | null;    // ROE (%)
  changeRate: number | null; // 전일 대비 등락률(%)
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
      mcap: parseNum(d.hts_avls),     // 억원
      w52High: parseNum(d.w52_hgpr),
      w52Low: parseNum(d.w52_lwpr),
      roe,
      changeRate: parseNum(d.prdy_ctrt),
    };
  } catch (err) {
    console.error(`[kis] fetchKISStockQuote(${stockCode}) 예외:`, err);
    return null;
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
 * 분석 대상 종목의 실시간 컨텍스트 문자열 생성
 */
export async function buildKISStockContext(stockCode: string): Promise<string | null> {
  const quote = await fetchKISStockQuote(stockCode);
  if (!quote || !quote.price) return null;

  const fmt = (v: number | null, suffix = "") =>
    v !== null ? `${v.toLocaleString("ko-KR")}${suffix}` : "N/A";

  return `
=== KIS 실시간 시세 데이터 (${new Date().toLocaleDateString("ko-KR")} 기준) ===
종목코드: ${stockCode}
현재가: ${fmt(quote.price, "원")} (전일 대비 ${quote.changeRate !== null ? (quote.changeRate > 0 ? "+" : "") + quote.changeRate.toFixed(2) + "%" : "N/A"})
52주 최고: ${fmt(quote.w52High, "원")} / 52주 최저: ${fmt(quote.w52Low, "원")}
시가총액: ${fmt(quote.mcap, "억원")}

[KIS 실시간 투자지표]
| 지표 | 값 |
|------|-----|
| PER | ${quote.per !== null ? quote.per.toFixed(1) + "배" : "N/A (적자 또는 미산출)"} |
| PBR | ${quote.pbr !== null ? quote.pbr.toFixed(2) + "배" : "N/A"} |
| EPS | ${fmt(quote.eps, "원")} |
| BPS | ${fmt(quote.bps, "원")} |
| ROE | ${quote.roe !== null ? quote.roe.toFixed(1) + "%" : "N/A"} |

※ KIS Open API 실전투자 실시간 데이터입니다. 밸류에이션 현재가·BPS 기준으로 우선 활용하세요.
`;
}
