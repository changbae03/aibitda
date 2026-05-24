import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { GoogleGenAI } from "@google/genai";
import { correctKoreanTicker, getKRXCache } from "../lib/krx-cache.js";
import { fetchETFsForStock, isPykrxEnabled } from "../lib/pykrx-client.js";
import { cache } from "../lib/mem-cache.js";
import { getStockExposure } from "../lib/etf-analyzer.js";

const SECTOR_TO_CATEGORY: Record<string, string> = {
  "국내주식": "시장전체",
  "코스닥":   "시장전체",
  "반도체":   "반도체·IT",
  "2차전지":  "2차전지",
  "헬스케어": "바이오·헬스케어",
  "금융":     "금융",
  "IT":       "반도체·IT",
  "해외주식": "시장전체",
  "배당":     "고배당",
  "원자재":   "에너지·화학",
};

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

const TTL_ETF = 6 * 60 * 60 * 1000; // 6시간

const router: IRouter = Router();

// ── ETF 편입 현황 ──────────────────────────────────────────────────────────────
// GET /api/market-data/etf-inclusion/:ticker
router.get("/etf-inclusion/:ticker", async (req, res) => {
  const ticker = (req.params.ticker as string).toUpperCase();
  const { companyName, industry } = req.query as { companyName?: string; industry?: string };
  const koreanCode = ticker.match(/^(\d{6})\.(KS|KQ)$/)?.[1]
    ?? ticker.match(/^(\d{6})$/)?.[1];
  // KRX 캐시로 정확한 거래소 판별 (티커 포맷 오류 방지)
  const krxEntry = koreanCode ? getKRXCache().find(e => e.code === koreanCode) : null;
  const isUsTicker = !koreanCode && !/\.(KS|KQ)$/.test(ticker);
  const exchange: string = krxEntry?.exchange
    ?? (ticker.includes(".KQ") ? "KOSDAQ" : ticker.includes(".KS") ? "KOSPI" : isUsTicker ? "NYSE/NASDAQ" : "KOSPI");
  const resolvedSymbol = krxEntry?.symbol
    ?? (ticker.includes(".") ? ticker : koreanCode ? `${koreanCode}.KS` : ticker);

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

  // 2) pykrx 실데이터로 국내 ETF 편입 조회 (캐시 6시간)
  let domesticEtfs: Array<{
    code: string; name: string; manager: string; category: string;
    weight: number; dataSource: "real";
  }> = [];

  if (koreanCode) {
    const cacheKey = `etf-inclusion:${koreanCode}`;
    const cached = cache.get<typeof domesticEtfs>(cacheKey);
    if (cached) {
      domesticEtfs = cached;
    } else {
      // pykrx 실데이터 시도
      let pykrxEtfs: typeof domesticEtfs = [];
      if (isPykrxEnabled()) {
        try {
          const holdings = await fetchETFsForStock(koreanCode);
          const isKosdaqStock = exchange === "KOSDAQ";
          const filtered = holdings.filter(h => {
            const nameUp = h.etfName.toUpperCase();
            const isKosdaqEtf = nameUp.includes("KOSDAQ") || h.etfName.includes("코스닥");
            if (isKosdaqEtf && !isKosdaqStock) return false;
            return true;
          });
          pykrxEtfs = filtered.map(h => ({
            code:       h.etfCode,
            name:       h.etfName,
            manager:    h.manager,
            category:   h.category,
            weight:     h.weight,
            dataSource: "real" as const,
          }));
          console.log(`[etf-inclusion] pykrx ${koreanCode}: ${pykrxEtfs.length}개`);
        } catch (e: any) {
          console.warn("[etf-inclusion] pykrx 실패:", e?.message);
        }
      }

      // ETF 분석 페이지와 동일한 MAJOR_ETFS 데이터로 보완
      let majorEtfs: typeof domesticEtfs = [];
      try {
        const exposure = await getStockExposure(koreanCode);
        majorEtfs = exposure.map(({ etf, holding }) => ({
          code:       etf.code,
          name:       etf.name,
          manager:    etf.issuer,
          category:   SECTOR_TO_CATEGORY[etf.sector] ?? etf.sector,
          weight:     holding.weight,
          dataSource: "real" as const,
        }));
        console.log(`[etf-inclusion] MAJOR_ETFS ${koreanCode}: ${majorEtfs.length}개`);
      } catch (e: any) {
        console.warn("[etf-inclusion] MAJOR_ETFS 조회 실패:", e?.message);
      }

      // 병합: pykrx 우선, 중복(ETF코드) 제거 후 MAJOR_ETFS로 보완
      const pykrxCodes = new Set(pykrxEtfs.map(e => e.code));
      const supplemental = majorEtfs.filter(e => !pykrxCodes.has(e.code));
      domesticEtfs = [...pykrxEtfs, ...supplemental].sort((a, b) => b.weight - a.weight);

      cache.set(cacheKey, domesticEtfs, TTL_ETF);
      console.log(`[etf-inclusion] ${koreanCode}(${exchange}): 최종 ${domesticEtfs.length}개 (pykrx ${pykrxEtfs.length} + 보완 ${supplemental.length})`);
    }
  }

  // 3) 미국 주식: 주요 미국 ETF에서 해당 종목 편입 비중 조회 (Yahoo Finance topHoldings)
  if (isUsTicker && domesticEtfs.length === 0) {
    const baseSymbol = ticker.split(".")[0];
    const cacheKey = `etf-inclusion-us:${baseSymbol}`;
    const cached = cache.get<typeof domesticEtfs>(cacheKey);
    if (cached) {
      domesticEtfs = cached;
    } else {
      const US_MAJOR_ETFS = [
        // ─ 시장 전체 ─
        { code: "SPY",  name: "SPDR S&P 500 ETF Trust",                   manager: "State Street", category: "시장전체" },
        { code: "VOO",  name: "Vanguard S&P 500 ETF",                      manager: "Vanguard",     category: "시장전체" },
        { code: "IVV",  name: "iShares Core S&P 500 ETF",                  manager: "BlackRock",    category: "시장전체" },
        { code: "VTI",  name: "Vanguard Total Stock Market ETF",           manager: "Vanguard",     category: "시장전체" },
        // ─ 나스닥 ─
        { code: "QQQ",  name: "Invesco QQQ Trust (Nasdaq-100)",            manager: "Invesco",      category: "나스닥100" },
        { code: "QQQM", name: "Invesco Nasdaq-100 ETF",                    manager: "Invesco",      category: "나스닥100" },
        // ─ 기술·반도체 ─
        { code: "VGT",  name: "Vanguard Information Technology ETF",       manager: "Vanguard",     category: "반도체·IT" },
        { code: "XLK",  name: "Technology Select Sector SPDR Fund",        manager: "State Street", category: "반도체·IT" },
        { code: "SOXX", name: "iShares Semiconductor ETF",                 manager: "BlackRock",    category: "반도체·IT" },
        { code: "SMH",  name: "VanEck Semiconductor ETF",                  manager: "VanEck",       category: "반도체·IT" },
        { code: "IGV",  name: "iShares Expanded Tech-Software Sector ETF", manager: "BlackRock",    category: "반도체·IT" },
        // ─ 헬스케어 ─
        { code: "XLV",  name: "Health Care Select Sector SPDR Fund",       manager: "State Street", category: "바이오·헬스케어" },
        { code: "IBB",  name: "iShares Biotechnology ETF",                 manager: "BlackRock",    category: "바이오·헬스케어" },
        // ─ 금융 ─
        { code: "XLF",  name: "Financial Select Sector SPDR Fund",         manager: "State Street", category: "금융" },
        { code: "KRE",  name: "SPDR S&P Regional Banking ETF",             manager: "State Street", category: "금융" },
        // ─ 에너지 ─
        { code: "XLE",  name: "Energy Select Sector SPDR Fund",            manager: "State Street", category: "에너지·화학" },
        // ─ 소비재 ─
        { code: "XLY",  name: "Consumer Discretionary Select Sector SPDR", manager: "State Street", category: "소비재" },
        { code: "XLP",  name: "Consumer Staples Select Sector SPDR",       manager: "State Street", category: "소비재" },
        // ─ 산업재 ─
        { code: "XLI",  name: "Industrial Select Sector SPDR Fund",        manager: "State Street", category: "산업재" },
        // ─ 미디어·통신 ─
        { code: "XLC",  name: "Communication Services Select Sector SPDR", manager: "State Street", category: "미디어·엔터" },
        // ─ 혁신·테마 ─
        { code: "ARKK", name: "ARK Innovation ETF",                        manager: "ARK Invest",   category: "혁신·테마" },
        { code: "ARKQ", name: "ARK Autonomous Technology & Robotics ETF",  manager: "ARK Invest",   category: "혁신·테마" },
      ];

      const results = await Promise.allSettled(
        US_MAJOR_ETFS.map(async (etf) => {
          try {
            const summary = await yahooFinance.quoteSummary(etf.code, {
              modules: ["topHoldings"] as any,
            });
            const holdings: Array<{ symbol?: string; holdingPercent?: number }> =
              (summary as any).topHoldings?.holdings ?? [];
            const match = holdings.find(
              h => h.symbol?.toUpperCase() === baseSymbol.toUpperCase()
            );
            if (!match) return null;
            return {
              code:       etf.code,
              name:       etf.name,
              manager:    etf.manager,
              category:   etf.category,
              weight:     Math.round((match.holdingPercent ?? 0) * 10000) / 100,
              dataSource: "real" as const,
            };
          } catch {
            return null;
          }
        })
      );

      const hits: typeof domesticEtfs = [];
      for (const r of results) {
        if (r.status === "fulfilled" && r.value !== null) hits.push(r.value);
      }
      domesticEtfs = hits.sort((a, b) => b.weight - a.weight);
      cache.set(cacheKey, domesticEtfs, TTL_ETF);
      console.log(`[etf-inclusion] ${baseSymbol}(US): ${domesticEtfs.length}개 ETF 실데이터`);
    }
  }

  res.json({
    ticker,
    exchange,
    globalFunds,
    domesticEtfs,
    notes: null,
  });
});

// ── 연관기업 (Peer Group) 분석 ─────────────────────────────────────────────────
// POST /api/market-data/peer-group/:ticker
router.post("/peer-group/:ticker", async (req, res) => {
  const ticker = (req.params.ticker as string).toUpperCase();
  const { companyName, industry, analysisSteps } = req.body as {
    companyName?: string;
    industry?: string;
    analysisSteps?: Array<{ stepKey: string; content: string }>;
  };

  if (!companyName) {
    res.status(400).json({ error: "companyName required in body" });
    return;
  }

  const isKorean = /^\d{6}\.(KS|KQ)$/.test(ticker);

  // 분석 단계 내용에서 핵심 컨텍스트 추출
  const stepsMap: Record<string, string> = {};
  for (const s of (analysisSteps ?? [])) {
    stepsMap[s.stepKey] = s.content ?? "";
  }

  // 각 단계에서 핵심 내용 요약 (너무 길면 잘라서 전달)
  const truncate = (text: string, maxChars = 1500) =>
    text.length > maxChars ? text.slice(0, maxChars) + "...(이하 생략)" : text;

  const contextParts: string[] = [];

  if (stepsMap["industry_analysis"]) {
    contextParts.push(`[산업 분석 — 경쟁 구도 및 주요 플레이어]\n${truncate(stepsMap["industry_analysis"])}`);
  }
  if (stepsMap["company_analysis"]) {
    contextParts.push(`[실적 전망 — 재무 포지션 및 성장 가정]\n${truncate(stepsMap["company_analysis"])}`);
  }
  if (stepsMap["relative_valuation"]) {
    contextParts.push(`[목표가 산출 — 밸류에이션에 사용한 피어 기업 및 멀티플]\n${truncate(stepsMap["relative_valuation"], 2000)}`);
  }
  if (stepsMap["catalyst_analysis"]) {
    contextParts.push(`[촉매 분석 — 핵심 이슈 및 경쟁 환경 변화]\n${truncate(stepsMap["catalyst_analysis"])}`);
  }
  if (stepsMap["investment_strategy"]) {
    contextParts.push(`[최종 투자 전략 — 핵심 투자 논거 요약]\n${truncate(stepsMap["investment_strategy"], 800)}`);
  }

  const analysisContext = contextParts.length > 0
    ? `\n\n════ 앞선 리서치 분석 내용 (반드시 반영) ════\n${contextParts.join("\n\n")}\n════ 분석 내용 끝 ════`
    : "";

  const prompt = `당신은 글로벌 주식시장 전문 애널리스트입니다.
아래 종목에 대해 연관기업(비교 가능한 피어)을 선정하고 JSON으로만 응답하세요.${analysisContext}

분석 대상:
- 종목: ${ticker} (${companyName})
- 업종: ${industry ?? "불명"}

선정 기준 (앞선 리서치 내용을 최대한 반영):
- 위 리서치(특히 목표가 산출 단계의 피어 멀티플)에서 이미 언급된 기업을 우선 포함
- 사업 모델이 유사하거나 직접적 경쟁 관계인 기업
- 밸류에이션 비교에서 실제로 사용된 피어를 최대한 반영
- **한국 상장 주식 3~4개** + **글로벌(미국/일본 등) 주요 기업 2~3개** 혼합, 총 5~7개
${!isKorean ? "- 분석 대상이 한국 주식이 아닌 경우 글로벌 피어 중심으로 선정 가능" : ""}
- reason 필드: 앞선 리서치에서 이 기업이 언급된 맥락을 포함해 2~3문장으로 서술

다음 JSON 스키마로만 응답하세요:
{
  "peers": [
    {
      "ticker": "005930.KS",
      "name": "삼성전자",
      "nameEn": "Samsung Electronics",
      "exchange": "KOSPI",
      "region": "KR",
      "reason": "앞선 분석에서 언급된 맥락 + 사업 유사성·경쟁관계·밸류에이션 비교 의미 2~3문장",
      "keyPoints": ["포인트1", "포인트2"]
    }
  ],
  "methodology": "이번 리서치 내용을 반영한 피어 선정 기준 및 방법론 (2~3문장)",
  "comparisonNote": "이 피어 그룹이 해당 종목 밸류에이션에서 가지는 핵심 의미 (1~2문장)"
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
    // KRX 캐시로 한국 티커 교정 (.KS/.KQ 오류 방지)
    const peers: any[] = (parsed?.peers ?? []).map((p: any) => {
      const corrected = correctKoreanTicker(p.ticker ?? "");
      if (corrected !== p.ticker) {
        const newExchange = corrected.endsWith(".KS") ? "KOSPI" : "KOSDAQ";
        console.log(`[peer-group] Ticker corrected: ${p.ticker} → ${corrected}`);
        return { ...p, ticker: corrected, exchange: newExchange };
      }
      return p;
    });

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
