import { normalizeTicker } from "@workspace/shared";
import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { GoogleGenAI } from "@google/genai";
import { correctKoreanTicker, getKRXCache } from "../lib/krx-cache.js";
import { fetchETFsForStock, isPykrxEnabled } from "../lib/pykrx-client.js";
import { cache } from "../lib/mem-cache.js";
import { getStockExposure } from "../lib/etf-analyzer.js";
import { calcEventRisk } from "../lib/event-risk.js";
import { pool } from "@workspace/db";
import { fetchKISStockQuotes } from "../lib/kis-client.js";
import { fetchDartCompetitorSection } from "../lib/dart-business-content.js";

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
      // ── 즉시 응답: MAJOR_ETFS 인메모리 데이터 (fast path, ~1초) ──
      try {
        const exposure = await getStockExposure(koreanCode);
        const majorEtfs = exposure.map(({ etf, holding }) => ({
          code:       etf.code,
          name:       etf.name,
          manager:    etf.issuer,
          category:   SECTOR_TO_CATEGORY[etf.sector] ?? etf.sector,
          weight:     holding.weight,
          dataSource: "real" as const,
        }));
        domesticEtfs = majorEtfs.sort((a, b) => b.weight - a.weight);
        // 30분 단기 캐시 (pykrx 백그라운드 완료 전 중복 호출 방지)
        cache.set(cacheKey, domesticEtfs, 30 * 60 * 1000);
        console.log(`[etf-inclusion] MAJOR_ETFS(fast) ${koreanCode}: ${domesticEtfs.length}개`);
      } catch (e: any) {
        console.warn("[etf-inclusion] MAJOR_ETFS 조회 실패:", e?.message);
      }

      // ── 백그라운드: pykrx 실데이터로 캐시 갱신 (다음 방문부터 풀 데이터) ──
      if (isPykrxEnabled()) {
        const isKosdaqStock = exchange === "KOSDAQ";
        fetchETFsForStock(koreanCode)
          .then(holdings => {
            const filtered = holdings.filter(h => {
              const nameUp = h.etfName.toUpperCase();
              const isKosdaqEtf = nameUp.includes("KOSDAQ") || h.etfName.includes("코스닥");
              if (isKosdaqEtf && !isKosdaqStock) return false;
              return true;
            });
            const pykrxEtfs = filtered.map(h => ({
              code:       h.etfCode,
              name:       h.etfName,
              manager:    h.manager,
              category:   h.category,
              weight:     h.weight,
              dataSource: "real" as const,
            }));
            // 기존 MAJOR_ETFS와 병합 후 6시간 풀 캐시 갱신
            const currentMajor = cache.get<typeof domesticEtfs>(cacheKey) ?? domesticEtfs;
            const pykrxCodes = new Set(pykrxEtfs.map(e => e.code));
            const supplemental = currentMajor.filter(e => !pykrxCodes.has(e.code));
            const merged = [...pykrxEtfs, ...supplemental].sort((a, b) => b.weight - a.weight);
            cache.set(cacheKey, merged, TTL_ETF);
            console.log(`[etf-inclusion] pykrx BG완료 ${koreanCode}: ${pykrxEtfs.length}개 → 캐시 갱신`);
          })
          .catch((e: any) => {
            console.warn("[etf-inclusion] pykrx BG 실패:", e?.message);
          });
      }
    }
  }

  // 3) 미국 주식: 주요 미국 ETF에서 해당 종목 편입 비중 조회 (Yahoo Finance topHoldings)
  if (isUsTicker && domesticEtfs.length === 0) {
    const baseSymbol = normalizeTicker(ticker);
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

  // ── DART 사업보고서 경쟁 현황 (한국 주식만) ──────────────────────────────
  let dartCompetitorContext = "";
  if (isKorean) {
    const stockCode = ticker.replace(/\.(KS|KQ)$/, "");
    const dartSection = await fetchDartCompetitorSection(stockCode).catch(() => null);
    if (dartSection) {
      dartCompetitorContext = `\n\n════ DART 사업보고서 — 경쟁 현황 (최우선 반영) ════\n` +
        `⚠️ 아래 섹션은 ${companyName}의 DART 공시 사업보고서 원문입니다.\n` +
        `이 섹션에서 언급된 경쟁사·업체명을 피어 목록에 반드시 최우선으로 포함하세요.\n` +
        `${dartSection}\n` +
        `════ DART 끝 ════`;
    }
  }

  const prompt = `당신은 글로벌 주식시장 전문 애널리스트입니다.
아래 종목에 대해 연관기업(비교 가능한 피어)을 선정하고 JSON으로만 응답하세요.${analysisContext}${dartCompetitorContext}

분석 대상:
- 종목: ${ticker} (${companyName})
- 업종: ${industry ?? "불명"}

선정 기준 (앞선 리서치 내용을 최대한 반영):
- **DART 사업보고서 경쟁 현황 섹션에 명시된 기업을 1순위로 포함** (위 DART 섹션 참조)
- 위 리서치(특히 목표가 산출 단계의 피어 멀티플)에서 이미 언급된 기업을 2순위로 포함
- 사업 모델이 유사하거나 직접적 경쟁 관계인 기업
- 밸류에이션 비교에서 실제로 사용된 피어를 최대한 반영
- **한국 상장 주식 3~4개** + **글로벌(미국/일본 등) 주요 기업 2~3개** 혼합, 총 5~7개
${!isKorean ? "- 분석 대상이 한국 주식이 아닌 경우 글로벌 피어 중심으로 선정 가능" : ""}
- reason 필드: DART 사업보고서에서 언급된 맥락 및 앞선 리서치 맥락 포함해 2~3문장으로 서술

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

    // ── 한국 피어 시가총액: KRX DB 일괄 조회 (Yahoo Finance보다 정확) ──────
    const koreanPeerCodes = peers
      .map((p: any) => (p.ticker ?? "").replace(/\.(KS|KQ)$/, ""))
      .filter((_: string, i: number) => /^\d{6}\.(KS|KQ)$/.test(peers[i]?.ticker ?? ""));

    // KRX DB mcap 맵 (원 단위)
    const krxMcapMap = new Map<string, number>();
    if (koreanPeerCodes.length > 0) {
      try {
        const krxRes = await pool.query<{ code: string; mcap: string }>(
          `SELECT code, mcap FROM krx_peer_data
           WHERE code = ANY($1)
             AND snapshot_date = (SELECT MAX(snapshot_date) FROM krx_peer_data)
             AND mcap IS NOT NULL`,
          [koreanPeerCodes]
        );
        for (const row of krxRes.rows) {
          krxMcapMap.set(row.code, parseFloat(row.mcap));  // 원 단위
        }
      } catch (e) {
        console.warn("[peer-group] KRX DB mcap 조회 실패:", e);
      }
    }

    // KIS 실시간 시가총액 (억원 단위)
    const kisQuotes = koreanPeerCodes.length > 0
      ? await fetchKISStockQuotes(koreanPeerCodes).catch(() => new Map<string, any>())
      : new Map<string, any>();

    // 각 피어에 대해 Yahoo Finance 재무 데이터 병렬 조회
    const peerFinancials = await Promise.allSettled(
      peers.map(async (peer: any) => {
        const peerTicker: string = peer.ticker ?? "";
        if (!peerTicker) return { ticker: peerTicker, marketCap: null, revenue: null, operatingIncome: null, operatingMargin: null, currency: null };
        try {
          const isKrwPeer = /^\d{6}\.(KS|KQ)$/.test(peerTicker);
          const peerCode = peerTicker.replace(/\.(KS|KQ)$/, "");

          const [q, fin] = await Promise.allSettled([
            yahooFinance.quote(peerTicker, undefined, { validateResult: false } as any),
            yahooFinance.quoteSummary(peerTicker, { modules: ["financialData", "price"] } as any, { validateResult: false } as any),
          ]);
          const quote = q.status === "fulfilled" ? q.value as any : null;
          const finData = fin.status === "fulfilled" ? (fin.value as any)?.financialData : null;
          const priceData = fin.status === "fulfilled" ? (fin.value as any)?.price : null;
          const currency: string = priceData?.currency ?? quote?.currency ?? (isKrwPeer ? "KRW" : "USD");
          const totalRevenue: number | null = finData?.totalRevenue ?? null;
          const opMargins: number | null = finData?.operatingMargins ?? null;
          const opIncome: number | null =
            totalRevenue != null && opMargins != null ? Math.round(totalRevenue * opMargins) : null;

          // 한국 주식 시가총액: KRX DB(원) → KIS 실시간(억원→원) → Yahoo Finance 순
          let marketCap: number | null = null;
          if (isKrwPeer) {
            const krxMcap = krxMcapMap.get(peerCode) ?? null;              // 원 단위
            const kis     = kisQuotes.get(peerCode);
            const kisMcap = kis?.mcap != null && kis.mcap > 0 ? kis.mcap * 1e8 : null;  // 억원→원
            // KIS 실시간 주가×KRX 주식수 역산
            const kisPrice     = kis?.price ?? null;
            const kisShares    = kis?.sharesOutstanding ?? null;
            const calcMcap     = kisPrice && kisShares ? kisPrice * kisShares : null;
            // KRX DB가 가장 신뢰도 높음, 단 KIS 실시간 가격으로 보정 가능
            if (kisMcap != null && kisMcap > 0) {
              marketCap = kisMcap;          // KIS 억원 → 원
            } else if (krxMcap != null && krxMcap > 0) {
              marketCap = krxMcap;          // KRX DB 원 단위
            } else if (calcMcap != null && calcMcap > 0) {
              marketCap = calcMcap;
            } else {
              marketCap = quote?.marketCap ?? null;
            }
            // 이상치 보정: Yahoo가 KRX의 10배 이상 차이나면 KRX 우선
            const yahooCap = quote?.marketCap ?? null;
            if (marketCap == null && yahooCap != null) marketCap = yahooCap;
            if (marketCap != null && krxMcap != null && krxMcap > 0) {
              const ratio = marketCap / krxMcap;
              if (ratio < 0.1 || ratio > 10) {
                console.warn(`[peer-group] ${peerTicker} mcap 이상치 → KRX 우선: ${(marketCap/1e8).toFixed(0)}억 → ${(krxMcap/1e8).toFixed(0)}억원`);
                marketCap = krxMcap;
              }
            }
          } else {
            marketCap = quote?.marketCap ?? null;
          }

          return {
            ticker: peerTicker,
            marketCap,
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

// ── 이벤트 리스크 점수 ─────────────────────────────────────────────────────────
// GET /api/market-data/event-risk/:ticker
router.get("/event-risk/:ticker", async (req, res) => {
  try {
    const ticker = decodeURIComponent(req.params.ticker as string);
    const cacheKey = `event-risk:${ticker}`;
    const hit = cache.get<Awaited<ReturnType<typeof calcEventRisk>>>(cacheKey);
    if (hit) { res.json(hit); return; }
    const result = await calcEventRisk(ticker);
    cache.set(cacheKey, result, 30 * 60_000);
    res.json(result);
  } catch (err: any) {
    console.error("[event-risk] error:", err?.message);
    res.status(500).json({ error: err?.message ?? "Failed to calculate event risk" });
  }
});

export default router;
