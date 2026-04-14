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
    name: string; pctHeld: number; value: number | null; reportDate: string;
  }> = [];
  try {
    const summary = await yahooFinance.quoteSummary(resolvedSymbol, {
      modules: ["fundOwnership"] as any,
    });
    const list = (summary as any).fundOwnership?.ownershipList ?? [];
    globalFunds = list
      .filter((f: any) => f.pctHeld > 0)
      .map((f: any) => ({
        name: f.organization ?? "",
        pctHeld: Math.round(f.pctHeld * 10000) / 100,
        value: f.value ?? null,
        reportDate: f.reportDate ? new Date(f.reportDate).toISOString().slice(0, 7) : "",
      }))
      .sort((a: any, b: any) => b.pctHeld - a.pctHeld)
      .slice(0, 8);
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
    // 시총 조회
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
- 시가총액 규모: ${marketCapLabel}

JSON 형식으로만 응답하세요 (마크다운 없이):
{
  "etfs": [
    {
      "code": "069500",
      "name": "KODEX 200",
      "manager": "삼성자산운용",
      "indexBasis": "KOSPI 200",
      "confidence": "high",
      "reason": "편입 근거 한 문장",
      "estimatedWeight": "0.3%~0.5%",
      "weightBasis": "KOSPI200 시총 비중 기준"
    }
  ],
  "notes": "전반적인 ETF 편입 특성 요약 (1~2문장)"
}

규칙:
- confidence: high=거의 확실히 편입, medium=편입 가능성 높음, low=섹터/테마 ETF 가능성
- 실제 존재하는 한국 ETF만 포함 (KODEX/TIGER/ARIRANG/HANARO/KBSTAR/SOL 등)
- 거래소와 시총에 맞는 ETF만 선택 (KOSDAQ 소형주에 KODEX200 제외 등)
- estimatedWeight: 해당 ETF 내 이 종목의 예상 편입 비중 (시총 비중, ETF 구성 방식 고려). 불확실하면 범위로 표시
- weightBasis: 비중 추정 근거 (시총 비중, 동일 비중, 테마 ETF 등)
- 최대 6개`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 16384 },
    });

    const rawFull = result.text ?? "{}";
    const raw = rawFull.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(raw);
    domesticEtfs = parsed.etfs ?? [];
    const notes = parsed.notes ?? null;

    res.json({
      ticker,
      exchange,
      globalFunds,
      domesticEtfs,
      notes,
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

// ── Peer Group 분석 ────────────────────────────────────────────────────────────
// GET /api/market-data/peer-group/:ticker
router.get("/peer-group/:ticker", async (req, res) => {
  const ticker = (req.params.ticker as string).toUpperCase();
  const { companyName, industry } = req.query as { companyName?: string; industry?: string };

  if (!companyName) {
    res.status(400).json({ error: "companyName query param required" });
    return;
  }

  const prompt = `당신은 한국 주식시장 전문 애널리스트입니다.
아래 종목에 대해 Peer Group(유사 동종사)을 선정하고 JSON으로만 응답하세요.

분석 대상:
- 종목: ${ticker} (${companyName})
- 업종: ${industry ?? "불명"}

JSON 형식 (마크다운 없이):
{
  "peers": [
    {
      "ticker": "XXXXXX.KS",
      "name": "회사명(한글)",
      "nameEn": "Company Name",
      "reason": "피어 선정 근거 (2~3문장): 사업 유사성, 경쟁관계, 벨류에이션 비교 시 의미 있는 이유",
      "keyPoints": ["포인트1", "포인트2"]
    }
  ],
  "methodology": "피어 선정 기준 및 방법론 설명 (2~3문장)",
  "comparisonNote": "이 피어 그룹과 비교 시 투자자가 주목해야 할 핵심 관점 (1~2문장)"
}

규칙:
- 한국 상장 주식만 포함 (KS=KOSPI, KQ=KOSDAQ)
- 실제 존재하는 회사만 (6자리 종목코드 정확히)
- 피어 4~6개 선정
- 단순 같은 업종 나열 금지 → 사업모델/경쟁관계/벨류에이션 비교 의미 있는 회사 선정
- reason은 투자 판단에 실질적 도움이 되는 내용으로`;

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 4096 },
    });

    const raw = (result.text ?? "{}").replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(raw);
    const peers: any[] = parsed.peers ?? [];

    // 각 피어에 대해 Yahoo Finance 재무 데이터 병렬 조회
    const peerFinancials = await Promise.allSettled(
      peers.map(async (peer: any) => {
        const peerTicker: string = peer.ticker ?? "";
        if (!peerTicker) return { ticker: peerTicker, marketCap: null, revenue: null, operatingIncome: null };
        try {
          const [q, fin] = await Promise.allSettled([
            yahooFinance.quote(peerTicker, undefined, { validateResult: false } as any),
            yahooFinance.quoteSummary(peerTicker, { modules: ["financialData"] } as any, { validateResult: false } as any),
          ]);
          const quote = q.status === "fulfilled" ? q.value as any : null;
          const finData = fin.status === "fulfilled" ? (fin.value as any)?.financialData : null;
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
          };
        } catch {
          return { ticker: peerTicker, marketCap: null, revenue: null, operatingIncome: null, operatingMargin: null };
        }
      })
    );

    // 피어 데이터와 재무 데이터 병합
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
      };
    });

    res.json({
      ticker,
      companyName,
      industry,
      peers: peersWithFinancials,
      methodology: parsed.methodology ?? "",
      comparisonNote: parsed.comparisonNote ?? "",
    });
  } catch (err: any) {
    console.error("Peer group error:", err);
    res.status(500).json({ error: err?.message ?? "Failed to generate peer group" });
  }
});

export default router;
