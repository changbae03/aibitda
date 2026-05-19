import { Router } from "express";
import { getStatus, runPipeline } from "../lib/lstm-predictor.js";
import { fetchFREDMacro } from "../lib/fred-client.js";
import { fetchECOSMacro } from "../lib/ecos-client.js";
import { GoogleGenAI } from "@google/genai";
import YahooFinance from "yahoo-finance2";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";

const router = Router();

// ─── 관리자 확인 ─────────────────────────────────────────────────────────────

async function isAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT 1 FROM admins WHERE user_id = $1 LIMIT 1`, [userId]);
    return res.rows.length > 0;
  } finally {
    client.release();
  }
}

async function requireAdmin(req: any, res: any): Promise<boolean> {
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "관리자 전용 기능입니다." });
    return false;
  }
  return true;
}

// ─── Gemini 클라이언트 (analysis.ts 와 동일한 패턴) ─────────────────────────

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

// ─── 인메모리 캐시 ──────────────────────────────────────────────────────────

interface BriefCache {
  data: MarketBriefResult;
  cachedAt: number;
}
const BRIEF_TTL = 8 * 3600_000;   // 8시간 (장전·장마감 2회 갱신 주기에 맞춤)
let _briefCache: BriefCache | null = null;

/** 스케줄러에서 호출 — 다음 요청 시 Gemini 브리핑을 새로 생성하도록 캐시 무효화 */
export function invalidateBriefCache() {
  _briefCache = null;
  console.log("[market-brief] 캐시 초기화 — 다음 요청 시 재생성");
}

export interface MarketBriefResult {
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  leadParagraph: string;
  storyLine: string;
  marketEvents: {
    title: string;
    impact: string;
    direction: "positive" | "negative" | "neutral";
  }[];
  macroFactors: {
    factor: string;
    status: string;
    implication: string;
  }[];
  forwardLook: {
    point: string;
    detail: string;
    watchFor: string;
  }[];
  upcomingMacroEvents: {
    date: string;
    title: string;
    description: string;
    impact: "high" | "medium" | "low";
    direction: "positive" | "negative" | "neutral";
  }[];
  keyRisk: string;
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

  const [kospiData, kosdaqData, snpData, vixData] = await Promise.allSettled([
    (yahoo as any).chart("^KS11",  { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^KQ11",  { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^GSPC",  { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^VIX",   { period1: start, period2: end, interval: "1d" }),
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
  const snp500 = extractRecent(snpData);
  const vix    = extractRecent(vixData, 3);
  return { kospi, kosdaq, snp500, vix };
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

  // 일별 변동 지표 (매일 바뀌는 것 위주)
  const snp500Latest = idx?.snp500?.at(-1) ?? null;
  const vixLatest    = idx?.vix?.at(-1)    ?? null;

  const macroLines = [
    // 매일 움직이는 지표
    snp500Latest?.close != null
      ? `S&P500 ${snp500Latest.close.toLocaleString()}pt (${snp500Latest.change != null ? (snp500Latest.change >= 0 ? "+" : "") + snp500Latest.change + "%" : "N/A"} 전일비)`
      : null,
    vixLatest?.close != null
      ? `VIX(공포지수) ${vixLatest.close} (${vixLatest.close >= 25 ? "공포 구간" : vixLatest.close >= 18 ? "경계 구간" : "안정 구간"})`
      : null,
    fred?.wtiOil != null
      ? `WTI 유가 ${fred.wtiOil.toFixed(1)} USD/bbl`
      : null,
    ecos?.usdKrw != null
      ? `원달러환율 ${ecos.usdKrw.toLocaleString()}원`
      : null,
    fred?.t10y != null
      ? `미국 10년 국채금리 ${fred.t10y.toFixed(2)}% (${fred.latestDates.treasury})`
      : null,
    fred?.t2y != null
      ? `미국 2년 국채금리 ${fred.t2y.toFixed(2)}%`
      : null,
    fred?.yieldSpread != null
      ? `장단기 금리차(10Y-2Y) ${fred.yieldSpread >= 0 ? "+" : ""}${fred.yieldSpread.toFixed(2)}%p${fred.yieldSpread < 0 ? " ⚠️역전" : ""}`
      : null,
    // 기준금리는 참고용
    fred != null
      ? fred.fedTargetUpper != null && fred.fedTargetLower != null
        ? `미국 기준금리 목표 ${fred.fedTargetLower}~${fred.fedTargetUpper}% (참고)`
        : fred.fedFundsRate != null
        ? `미국 기준금리 ${fred.fedFundsRate}% (참고)`
        : null
      : null,
    ecos?.baseRate     != null ? `한국 기준금리 ${ecos.baseRate}%` : null,
    ecos?.cpiYoY       != null ? `한국 CPI ${ecos.cpiYoY}% YoY` : null,
  ].filter(Boolean).join(" | ");

  const prompt = `당신은 개인 투자자의 친근한 시장 해설가입니다. 오늘은 ${today}입니다.
주식을 막 시작한 사람도 이해할 수 있게, 쉽고 짧게 설명해 주세요.

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
  "summary": "오늘 시장 분위기를 한 줄로 (20자 내외, 명사형 또는 짧은 문장)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "leadParagraph": "지금 시장이 어떤 상황인지, 왜 그런지를 2문장으로. 어려운 용어 없이 누구나 읽을 수 있게. 예: '이번 주 코스피가 많이 흔들렸어요. 미국 금리 걱정이 커졌기 때문인데, 쉽게 말하면 돈 빌리는 비용이 올라가면 기업들이 힘들어지거든요.' (80~120자)",
  "storyLine": "지난 며칠간 어떤 일이 있었고, 그게 시장에 어떤 영향을 줬는지, 그래서 앞으로 어떻게 될 것 같은지를 이야기처럼 이어서 써주세요. 실제 데이터를 근거로, 마치 친구에게 설명하듯이. 예: '지난주부터 미국 물가 데이터가 예상보다 높게 나오면서 금리 인하 기대가 꺾였어요. 덩달아 달러가 강해지고 외국인 투자자들이 우리 시장에서 돈을 빼가기 시작했는데, 그게 코스피 하락으로 이어진 거예요. AI 예측으로는 이번 주 안에 반등 가능성이 있지만, 미국 연준 발언이 관건이에요.' (150~220자)",
  "marketEvents": [
    {
      "title": "이슈 제목 (15자 이내, 핵심만)",
      "impact": "이 이슈가 왜 주가에 영향을 줬는지 짧고 쉽게. 예: '미국이 금리를 내리면 우리 주식시장에 외국 돈이 들어와요. 그래서 오늘 코스피가 올랐어요.' (40~60자)",
      "direction": "positive 또는 negative 또는 neutral"
    },
    { "title": "이슈2", "impact": "...", "direction": "..." },
    { "title": "이슈3", "impact": "...", "direction": "..." }
  ],
  "macroFactors": [
    {
      "factor": "지표 이름 (예: S&P500, WTI 유가, VIX, 원달러환율, 장단기금리차)",
      "status": "현재 수치와 전일비 또는 단위 포함 (예: 5,308pt +0.8%, 72.3달러, 18.4)",
      "implication": "이 숫자가 내 주식에 왜 중요한지 한 줄로. 전문 용어 없이. 예: '환율이 높으면 수출 기업은 좋지만, 수입 물가가 올라 소비자는 부담돼요.' (40~60자)"
    },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." }
  ],
  "forwardLook": [
    {
      "point": "이번 주 가장 중요한 것 (15자 이내)",
      "detail": "AI 예측 포함해서, 앞으로 어떻게 될 것 같은지 쉽게. 예: 'AI는 코스피가 약 2% 오를 것으로 봐요. 미국 지표가 좋게 나오면 더 힘을 받을 수 있어요.' (50~70자)",
      "watchFor": "꼭 봐야 할 것 한 가지 (25자 이내)"
    },
    { "point": "...", "detail": "...", "watchFor": "..." },
    { "point": "...", "detail": "...", "watchFor": "..." }
  ],
  "upcomingMacroEvents": [
    {
      "date": "'이번 주 수요일', '5월 21일' 등 구체적으로",
      "title": "이벤트명 (20자 이내)",
      "description": "이 이벤트가 뭔지, 왜 중요한지, 어떻게 될 수 있는지. 쉬운 말로. 예: '미국 소비자 물가 발표예요. 물가가 많이 올랐으면 금리 인하가 늦어져 주식에 안 좋을 수 있어요.' (60~80자)",
      "impact": "high 또는 medium 또는 low",
      "direction": "positive 또는 negative 또는 neutral"
    },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." }
  ],
  "keyRisk": "지금 가장 조심해야 할 것 한 줄. 쉽고 구체적으로. 예: '미국 물가 발표에서 예상보다 높은 숫자가 나오면 주식시장이 크게 흔들릴 수 있어요.' (40~60자)",
  "recentIssues": ["짧은 이슈 요약1", "짧은 이슈 요약2", "짧은 이슈 요약3"],
  "outlook": ["짧은 전망1", "짧은 전망2", "짧은 전망3"]
}

작성 원칙:
- summary·leadParagraph·marketEvents·macroFactors·forwardLook·keyRisk는 제공된 데이터 기반으로 작성
- upcomingMacroEvents는 당신의 지식을 활용해 향후 3~5거래일 예정 이벤트를 포함하세요:
  * 미국·한국 경제지표 발표 (CPI, PPI, FOMC 의사록, GDP, 고용 등)
  * 연준(Fed) 발언·FOMC 일정, 트럼프 관세·무역 정책 이슈
  * 한국 이재명 정부 정책·정치 이슈, 국회 일정
  * 중동(이란·이스라엘), 러우 전쟁 등 지정학 리스크
  * 미중 무역·반도체 수출규제 이슈
  * impact 기준: high=주가 1% 이상 변동 가능, medium=0.3~1%, low=0.3% 미만
- 절대 금지: "인과관계", "메커니즘", "수급", "섹터별" 같은 전문 용어를 설명 없이 쓰지 마세요
- 문체: 친근한 "해요체" 사용. "~해요", "~거예요", "~수 있어요" 처럼 자연스럽게
- 수치는 꼭 포함하되, 의미를 함께 설명하세요 (수치만 나열 금지)`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      maxOutputTokens: 2000,
      temperature: 0.5,
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

  const safeArr = (v: any) => Array.isArray(v) ? v : [];

  return {
    summary:              parsed?.summary              ?? "한국 증시 데이터 분석 중",
    sentiment:            parsed?.sentiment            ?? "neutral",
    leadParagraph:        parsed?.leadParagraph        ?? "",
    storyLine:            parsed?.storyLine            ?? "",
    marketEvents:         safeArr(parsed?.marketEvents).slice(0, 4),
    macroFactors:         safeArr(parsed?.macroFactors).slice(0, 5),
    forwardLook:          safeArr(parsed?.forwardLook).slice(0, 3),
    upcomingMacroEvents:  safeArr(parsed?.upcomingMacroEvents).slice(0, 5),
    keyRisk:              parsed?.keyRisk              ?? "",
    recentIssues:         safeArr(parsed?.recentIssues).slice(0, 4),
    outlook:              safeArr(parsed?.outlook).slice(0, 4),
    generatedAt:          new Date().toISOString(),
    kospiCurrent:         kospiLatest?.close  ?? null,
    kosdaqCurrent:        kosdaqLatest?.close ?? null,
    kospiChange:          kospiLatest?.change  ?? null,
    kosdaqChange:         kosdaqLatest?.change ?? null,
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.get("/status", async (req, res) => {
  res.json(getStatus());
});

router.post("/run", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
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
  // 강제 갱신(force=true)은 관리자만 허용
  if (req.query.force === "true" && !(await requireAdmin(req, res))) return;
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
