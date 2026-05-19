import { Router } from "express";
import { getStatus, runPipeline } from "../lib/lstm-predictor.js";
import { fetchFREDMacro } from "../lib/fred-client.js";
import { fetchECOSMacro } from "../lib/ecos-client.js";
import { GoogleGenAI } from "@google/genai";
import YahooFinance from "yahoo-finance2";

const router = Router();

// ─── Gemini 클라이언트 (analysis.ts 와 동일한 패턴) ─────────────────────────

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

// ─── 인메모리 캐시 (4시간) ──────────────────────────────────────────────────

interface BriefCache {
  data: MarketBriefResult;
  cachedAt: number;
}
const BRIEF_TTL = 4 * 3600_000;
let _briefCache: BriefCache | null = null;

export interface MarketBriefResult {
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  recentIssues: string[];
  outlook: string[];
  generatedAt: string;
  kospiCurrent: number | null;
  kosdaqCurrent: number | null;
  kospiChange: number | null;
  kosdaqChange: number | null;
}

// ─── 시장 데이터 수집 헬퍼 ──────────────────────────────────────────────────

async function fetchRecentIndexData() {
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 10);

  const [kospiData, kosdaqData] = await Promise.allSettled([
    (yahoo as any).chart("^KS11", { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^KQ11", { period1: start, period2: end, interval: "1d" }),
  ]);

  function extractRecent(result: PromiseSettledResult<any>, n = 5) {
    if (result.status !== "fulfilled") return null;
    const quotes = (result.value?.quotes ?? [])
      .filter((q: any) => q.close != null)
      .slice(-n)
      .map((q: any) => ({
        date: new Date(q.date).toISOString().slice(0, 10),
        close: +(q.close as number).toFixed(2),
        change: q.open && q.close ? +(((q.close - q.open) / q.open) * 100).toFixed(2) : null,
      }));
    return quotes;
  }

  const kospi  = extractRecent(kospiData);
  const kosdaq = extractRecent(kosdaqData);
  return { kospi, kosdaq };
}

// ─── Gemini 브리핑 생성 ──────────────────────────────────────────────────────

async function generateBrief(): Promise<MarketBriefResult> {
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });

  // 병렬로 데이터 수집
  const [indexData, fredData, ecosData, pipelineStatus] = await Promise.allSettled([
    fetchRecentIndexData(),
    fetchFREDMacro(),
    fetchECOSMacro(),
    Promise.resolve(getStatus()),
  ]);

  const idx      = indexData.status === "fulfilled" ? indexData.value : null;
  const fred     = fredData.status  === "fulfilled" ? fredData.value  : null;
  const ecos     = ecosData.status  === "fulfilled" ? ecosData.value  : null;
  const pipeline = pipelineStatus.status === "fulfilled" ? pipelineStatus.value : null;

  // KOSPI/KOSDAQ 최신값
  const kospiLatest  = idx?.kospi?.at(-1)  ?? null;
  const kosdaqLatest = idx?.kosdaq?.at(-1) ?? null;

  // 3일치 요약 텍스트 구성
  const kospiHistory  = idx?.kospi?.map((d: { date: string; close: number; change: number | null }) => `${d.date} ${d.close.toLocaleString()} (${d.change !== null ? (d.change >= 0 ? "+" : "") + d.change + "%" : "N/A"})`).join(", ") ?? "데이터 없음";
  const kosdaqHistory = idx?.kosdaq?.map((d: { date: string; close: number; change: number | null }) => `${d.date} ${d.close.toLocaleString()} (${d.change !== null ? (d.change >= 0 ? "+" : "") + d.change + "%" : "N/A"})`).join(", ") ?? "데이터 없음";

  const kospiPred  = pipeline?.kospi  ? `${pipeline.kospi.predictedReturn3d >= 0 ? "+" : ""}${pipeline.kospi.predictedReturn3d}%` : null;
  const kosdaqPred = pipeline?.kosdaq ? `${pipeline.kosdaq.predictedReturn3d >= 0 ? "+" : ""}${pipeline.kosdaq.predictedReturn3d}%` : null;

  const macroLines = [
    fred?.fedFundsRate != null ? `미국 기준금리 ${fred.fedFundsRate}%` : null,
    fred?.t10y         != null ? `미국 10년물 ${fred.t10y}%` : null,
    fred?.t2y          != null ? `미국 2년물 ${fred.t2y}%` : null,
    ecos?.baseRate     != null ? `한국 기준금리 ${ecos.baseRate}%` : null,
    ecos?.usdKrw       != null ? `원달러환율 ${ecos.usdKrw.toLocaleString()}원` : null,
    ecos?.cpiYoY       != null ? `한국 CPI ${ecos.cpiYoY}% YoY` : null,
  ].filter(Boolean).join(", ");

  const prompt = `당신은 한국 주식시장 전문 애널리스트입니다. 오늘은 ${today}입니다.

아래 실시간 데이터를 바탕으로 한국 주식시장 브리핑을 작성하세요.

[최근 5거래일 KOSPI]
${kospiHistory}

[최근 5거래일 KOSDAQ]
${kosdaqHistory}

[AI 모델 3일 예측]
KOSPI: ${kospiPred ?? "N/A"}, KOSDAQ: ${kosdaqPred ?? "N/A"}

[거시경제 지표]
${macroLines || "데이터 없음"}

아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{
  "summary": "한 문장 시장 전체 분위기 (30자 이내)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "recentIssues": [
    "최근 3~5거래일 주요 이슈·이벤트 1 (50자 이내)",
    "최근 3~5거래일 주요 이슈·이벤트 2",
    "최근 3~5거래일 주요 이슈·이벤트 3"
  ],
  "outlook": [
    "향후 3거래일 전망 포인트 1 (50자 이내, AI 예측값 포함)",
    "향후 3거래일 전망 포인트 2",
    "향후 3거래일 전망 포인트 3"
  ]
}

주의: 실제 뉴스 없이는 시장 데이터·지표 기반으로만 작성. 억측 금지. recentIssues는 데이터에서 관찰된 사실(가격 움직임·지표 수준)로 작성.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      maxOutputTokens: 800,
      temperature: 0.4,
      topP: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const raw = response.text ?? "";
  let parsed: any = null;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {}

  return {
    summary:       parsed?.summary     ?? "한국 증시 데이터 분석 중",
    sentiment:     parsed?.sentiment   ?? "neutral",
    recentIssues:  Array.isArray(parsed?.recentIssues) ? parsed.recentIssues.slice(0, 4) : [],
    outlook:       Array.isArray(parsed?.outlook)      ? parsed.outlook.slice(0, 4)      : [],
    generatedAt:   new Date().toISOString(),
    kospiCurrent:  kospiLatest?.close  ?? null,
    kosdaqCurrent: kosdaqLatest?.close ?? null,
    kospiChange:   kospiLatest?.change  ?? null,
    kosdaqChange:  kosdaqLatest?.change ?? null,
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.get("/status", (req, res) => {
  res.json(getStatus());
});

router.post("/run", async (req, res) => {
  const force = req.query.force === "true";
  const status = getStatus();
  if (status.running) {
    res.json({ ok: true, message: "이미 학습 중입니다" });
    return;
  }
  runPipeline(force).catch(e => console.error("[market-analysis/run]", e));
  res.json({ ok: true, message: "파이프라인 시작" });
});

// GET /api/market-analysis/brief — Gemini 기반 시장 브리핑 (4시간 캐시)
router.get("/brief", async (req, res) => {
  const force = req.query.force === "true";

  // 캐시 확인
  if (!force && _briefCache && Date.now() - _briefCache.cachedAt < BRIEF_TTL) {
    res.json({ ...(_briefCache.data), cached: true });
    return;
  }

  try {
    console.log("[market-brief] Gemini 브리핑 생성 중...");
    const result = await generateBrief();
    _briefCache = { data: result, cachedAt: Date.now() };
    console.log(`[market-brief] 완료 — sentiment: ${result.sentiment}`);
    res.json({ ...result, cached: false });
  } catch (err: any) {
    console.error("[market-brief] 오류:", err?.message);
    // 캐시가 있으면 만료된 것이라도 반환
    if (_briefCache) {
      res.json({ ...(_briefCache.data), cached: true, stale: true });
    } else {
      res.status(500).json({ error: "브리핑 생성 실패" });
    }
  }
});

export default router;
