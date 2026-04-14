import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { GoogleGenAI } from "@google/genai";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

const router: IRouter = Router();

// ── ETF 편입 현황 ──────────────────────────────────────────────────────────────
// GET /api/market-data/etf-inclusion/:ticker
router.get("/etf-inclusion/:ticker", async (req, res) => {
  const ticker = (req.params.ticker as string).toUpperCase();
  const { companyName, industry } = req.query as { companyName?: string; industry?: string };
  const koreanCode = ticker.match(/^(\d{6})\.(KS|KQ)$/)?.[1]
    ?? ticker.match(/^(\d{6})$/)?.[1];
  const exchange = ticker.includes(".KQ") ? "KOSDAQ" : "KOSPI";
  const resolvedSymbol = ticker.includes(".") ? ticker
    : koreanCode ? `${koreanCode}.KS` : ticker;

  // 1) Yahoo Finance 글로벌 펀드 편입 (실데이터)
  let globalFunds: Array<{
    name: string; ticker: string | null; pctHeld: number; value: number | null; reportDate: string;
  }> = [];
  try {
    const summary = await yahooFinance.quoteSummary(resolvedSymbol, {
      modules: ["fundOwnership"] as any,
    });
    const list = (summary as any).fundOwnership?.ownershipList ?? [];
    const sorted = list
      .filter((f: any) => f.pctHeld > 0)
      .sort((a: any, b: any) => b.pctHeld - a.pctHeld)
      .slice(0, 8);

    const tickerResults = await Promise.allSettled(
      sorted.map(async (f: any) => {
        const org: string = f.organization ?? "";
        const searchQuery = org.includes("-") ? org.split("-").slice(1).join("-").trim() : org;
        try {
          const sr = await (yahooFinance as any).search(
            searchQuery,
            { newsCount: 0, quotesCount: 2 },
            { validateResult: false }
          );
          const hit = (sr.quotes ?? []).find((q: any) =>
            q.quoteType === "ETF" || q.quoteType === "MUTUALFUND"
          ) ?? sr.quotes?.[0] ?? null;
          return hit?.symbol ?? null;
        } catch {
          return null;
        }
      })
    );

    globalFunds = sorted.map((f: any, i: number) => ({
      name: f.organization ?? "",
      ticker: tickerResults[i].status === "fulfilled" ? tickerResults[i].value : null,
      pctHeld: Math.round(f.pctHeld * 10000) / 100,
      value: f.value ?? null,
      reportDate: f.reportDate ? new Date(f.reportDate).toISOString().slice(0, 7) : "",
    }));
  } catch {
    /* optional */
  }

  // 2) Gemini로 국내 주요 ETF 편입 추정
  let domesticEtfs: Array<{
    code: string; name: string; manager: string; indexBasis: string;
    confidence: "high" | "medium" | "low"; reason: string;
    estimatedWeight: string | null; weightBasis: string | null;
  }> = [];

  try {
    let marketCapLabel = "불명";
    try {
      const q = await yahooFinance.quote(resolvedSymbol);
      const mc = q.marketCap;
      if (mc) {
        const mcTril = mc / 1e12;
        if (mcTril >= 5) marketCapLabel = `대형주 (${mcTril.toFixed(0)}조원)`;
        else if (mcTril >= 0.5) marketCapLabel = `중형주 (${(mc / 1e8).toFixed(0)}억원)`;
        else marketCapLabel = `소형주 (${(mc / 1e8).toFixed(0)}억원)`;
      }
    } catch { /* optional */ }

    const prompt = `당신은 한국 ETF 시장 전문가입니다.
아래 주식에 대해 국내 상장 ETF 편입 현황을 분석해 JSON으로 응답하세요.

종목 정보:
- 티커: ${ticker}${companyName ? ` (${companyName})` : ""}
- 업종: ${industry ?? "불명"}
- 거래소: ${exchange}
- 시가총액 구분: ${marketCapLabel}

다음 JSON 스키마로만 응답하세요:
{"etfs": [{"code": "ETF코드", "name": "ETF명", "manager": "운용사", "indexBasis": "추종지수", "confidence": "high|medium|low", "reason": "편입 근거", "estimatedWeight": "추정비중% 또는 null", "weightBasis": "비중 추정 근거 또는 null"}], "notes": "참고사항 (선택)"}

규칙:
- 실제 존재하는 국내 ETF만 포함 (KODEX, TIGER, KBSTAR, HANARO, ARIRANG 등)
- confidence: high=확실히 편입, medium=편입 가능성 높음, low=편입 가능성 있음
- 3~6개 ETF 선정`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    });

    const raw = result.text ?? "{}";
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }

    if (parsed?.etfs) {
      domesticEtfs = parsed.etfs ?? [];
    }

    res.json({
      ticker,
      exchange,
      globalFunds,
      domesticEtfs,
      notes: parsed?.notes ?? null,
    });
    return;
  } catch (err: any) {
    console.error("ETF inclusion error:", err?.message ?? err);
    res.json({
      ticker,
      exchange,
      globalFunds,
      domesticEtfs,
      notes: null,
    });
  }
});

// ── 연관기업 (Peer Group) 분석 ─────────────────────────────────────────────────
// GET /api/market-data/peer-group/:ticker
router.get("/peer-group/:ticker", async (req, res) => {
  const ticker = (req.params.ticker as string).toUpperCase();
  const { companyName, industry } = req.query as { companyName?: string; industry?: string };

  if (!companyName) {
    res.status(400).json({ error: "companyName query param required" });
    return;
  }

  const isKorean = /^\d{6}\.(KS|KQ)$/.test(ticker);

  const prompt = `당신은 글로벌 주식시장 전문 애널리스트입니다.
아래 종목에 대해 연관기업(비교 가능한 피어)을 선정하고 JSON으로만 응답하세요.

분석 대상:
- 종목: ${ticker} (${companyName})
- 업종: ${industry ?? "불명"}

선정 기준:
- 사업 모델이 유사하거나 직접적 경쟁 관계인 기업
- 밸류에이션 비교 시 의미 있는 기준이 되는 기업
- **한국 상장 주식 3~4개** + **글로벌(미국/일본 등) 주요 기업 2~3개** 를 혼합하여 총 5~7개 선정
${!isKorean ? "- 분석 대상이 한국 주식이 아닌 경우 글로벌 피어 중심으로 선정 가능" : ""}

다음 JSON 스키마로만 응답하세요:
{
  "peers": [
    {
      "ticker": "005930.KS",
      "name": "삼성전자",
      "nameEn": "Samsung Electronics",
      "exchange": "KOSPI",
      "region": "KR",
      "reason": "피어 선정 근거 2~3문장: 사업 유사성·경쟁관계·밸류에이션 비교 의미",
      "keyPoints": ["포인트1", "포인트2"]
    }
  ],
  "methodology": "피어 선정 기준 및 방법론 (2~3문장)",
  "comparisonNote": "이 피어 그룹과 비교 시 투자자가 주목해야 할 핵심 관점 (1~2문장)"
}

티커 형식:
- 한국 KOSPI: 6자리코드.KS (예: 005930.KS)
- 한국 KOSDAQ: 6자리코드.KQ (예: 035420.KQ)
- 미국: 표준 티커 (예: NVDA, ASML, TSM)
- 일본: 숫자.T (예: 6758.T)
- exchange 필드: "KOSPI", "KOSDAQ", "NASDAQ", "NYSE", "TSE" 등 실제 거래소명
- region 필드: "KR", "US", "JP", "EU" 등`;

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });

    const raw = result.text ?? "{}";
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }
    const peers: any[] = parsed?.peers ?? [];

    // 각 피어에 대해 Yahoo Finance 재무 데이터 병렬 조회
    const peerFinancials = await Promise.allSettled(
      peers.map(async (peer: any) => {
        const peerTicker: string = peer.ticker ?? "";
        if (!peerTicker) return { ticker: peerTicker, marketCap: null, revenue: null, operatingIncome: null, operatingMargin: null, currency: null };
        try {
          const [q, fin] = await Promise.allSettled([
            yahooFinance.quote(peerTicker, undefined, { validateResult: false } as any),
            yahooFinance.quoteSummary(peerTicker, { modules: ["financialData", "price"] } as any, { validateResult: false } as any),
          ]);
          const quote = q.status === "fulfilled" ? q.value as any : null;
          const finData = fin.status === "fulfilled" ? (fin.value as any)?.financialData : null;
          const priceData = fin.status === "fulfilled" ? (fin.value as any)?.price : null;
          const currency: string = priceData?.currency ?? quote?.currency ?? "USD";
          const totalRevenue: number | null = finData?.totalRevenue ?? null;
          const opMargins: number | null = finData?.operatingMargins ?? null;
          const opIncome: number | null =
            totalRevenue != null && opMargins != null ? Math.round(totalRevenue * opMargins) : null;
          return {
            ticker: peerTicker,
            marketCap: quote?.marketCap ?? null,
            revenue: totalRevenue,
            operatingIncome: opIncome,
            operatingMargin: opMargins != null ? Math.round(opMargins * 1000) / 10 : null,
            currency,
          };
        } catch {
          return { ticker: peerTicker, marketCap: null, revenue: null, operatingIncome: null, operatingMargin: null, currency: null };
        }
      })
    );

    const peersWithFinancials = peers.map((peer: any) => {
      const fin = peerFinancials.find(
        (f) => f.status === "fulfilled" && f.value.ticker === peer.ticker
      );
      const finVal = fin?.status === "fulfilled" ? fin.value : null;
      return {
        ...peer,
        marketCap: finVal?.marketCap ?? null,
        revenue: finVal?.revenue ?? null,
        operatingIncome: finVal?.operatingIncome ?? null,
        operatingMargin: finVal?.operatingMargin ?? null,
        currency: finVal?.currency ?? null,
      };
    });

    res.json({
      ticker,
      companyName,
      industry,
      peers: peersWithFinancials,
      methodology: parsed?.methodology ?? "",
      comparisonNote: parsed?.comparisonNote ?? "",
    });
  } catch (err: any) {
    console.error("Peer group error:", err);
    res.status(500).json({ error: err?.message ?? "Failed to generate peer group" });
  }
});

export default router;
