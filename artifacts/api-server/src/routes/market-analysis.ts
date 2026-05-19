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
  sessionType: "morning" | "closing";
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

  const [
    kospiData, kosdaqData,
    snpData, nasdaqData, dowData,
    vixData, soxData, dxyData,
  ] = await Promise.allSettled([
    (yahoo as any).chart("^KS11",    { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^KQ11",    { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^GSPC",    { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^IXIC",    { period1: start, period2: end, interval: "1d" }),  // 나스닥
    (yahoo as any).chart("^DJI",     { period1: start, period2: end, interval: "1d" }),  // 다우존스
    (yahoo as any).chart("^VIX",     { period1: start, period2: end, interval: "1d" }),  // 공포지수
    (yahoo as any).chart("^SOX",     { period1: start, period2: end, interval: "1d" }),  // 필라델피아 반도체
    (yahoo as any).chart("DX-Y.NYB", { period1: start, period2: end, interval: "1d" }),  // 달러 인덱스
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
  const nasdaq = extractRecent(nasdaqData, 3);
  const dow    = extractRecent(dowData, 3);
  const vix    = extractRecent(vixData, 3);
  const sox    = extractRecent(soxData, 3);   // 필라델피아 반도체 (삼성·SK하이닉스 선행지표)
  const dxy    = extractRecent(dxyData, 3);   // 달러 인덱스
  return { kospi, kosdaq, snp500, nasdaq, dow, vix, sox, dxy };
}

// ─── Gemini 브리핑 생성 ──────────────────────────────────────────────────────

/** KST 기준 세션 감지: UTC 21~02 → 장전(06:00~11:00 KST), 나머지 → 장마감 */
function detectSession(): "morning" | "closing" {
  const utcH = new Date().getUTCHours();
  return (utcH >= 21 || utcH <= 2) ? "morning" : "closing";
}

function fmtIdx(d: { close: number; change: number | null } | null | undefined, unit = "pt") {
  if (!d) return "N/A";
  const ch = d.change != null ? ` (${d.change >= 0 ? "+" : ""}${d.change}%)` : "";
  return `${d.close.toLocaleString()}${unit}${ch}`;
}

async function generateBrief(): Promise<MarketBriefResult> {
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
  const session = detectSession();

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

  // 역사적 요약
  const histLine = (arr: any[] | null | undefined) =>
    arr?.map((d: any) => `${d.date} ${d.close.toLocaleString()}(${d.change != null ? (d.change >= 0 ? "+" : "") + d.change + "%" : "N/A"})`).join(", ") ?? "데이터 없음";

  const kospiHistory  = histLine(idx?.kospi);
  const kosdaqHistory = histLine(idx?.kosdaq);

  const kospiPred  = pipeline?.kospi  ? `${pipeline.kospi.predictedReturn3d >= 0 ? "+" : ""}${pipeline.kospi.predictedReturn3d}%` : null;
  const kosdaqPred = pipeline?.kosdaq ? `${pipeline.kosdaq.predictedReturn3d >= 0 ? "+" : ""}${pipeline.kosdaq.predictedReturn3d}%` : null;

  // 미국 지수 최신값
  const snpL   = idx?.snp500?.at(-1) ?? null;
  const nasdaqL = idx?.nasdaq?.at(-1) ?? null;
  const dowL    = idx?.dow?.at(-1)    ?? null;
  const vixL    = idx?.vix?.at(-1)    ?? null;
  const soxL    = idx?.sox?.at(-1)    ?? null;
  const dxyL    = idx?.dxy?.at(-1)    ?? null;

  const usIndicesBlock = [
    snpL   ? `S&P500 ${fmtIdx(snpL)}`                                              : null,
    nasdaqL ? `나스닥 ${fmtIdx(nasdaqL)}`                                          : null,
    dowL    ? `다우존스 ${fmtIdx(dowL)}`                                            : null,
    soxL    ? `필라델피아반도체(SOX) ${fmtIdx(soxL)} ← 삼성·SK하이닉스 선행지표`  : null,
    vixL    ? `VIX 공포지수 ${vixL.close} (${vixL.close >= 25 ? "공포" : vixL.close >= 18 ? "경계" : "안정"})` : null,
    dxyL    ? `달러인덱스(DXY) ${dxyL.close} (달러 강세 시 원화 약세·수출주 유리)` : null,
  ].filter(Boolean).join("\n");

  const macroBlock = [
    fred?.t10y    != null ? `미국 10년 국채금리 ${fred.t10y.toFixed(2)}%`                                         : null,
    fred?.t2y     != null ? `미국 2년 국채금리 ${fred.t2y.toFixed(2)}%`                                           : null,
    fred?.yieldSpread != null ? `장단기 금리차(10Y-2Y) ${fred.yieldSpread >= 0 ? "+" : ""}${fred.yieldSpread.toFixed(2)}%p${fred.yieldSpread < 0 ? " ⚠️역전" : ""}` : null,
    fred?.wtiOil  != null ? `WTI 유가 ${fred.wtiOil.toFixed(1)} USD/bbl`                                         : null,
    ecos?.usdKrw  != null ? `원달러환율 ${ecos.usdKrw.toLocaleString()}원`                                        : null,
    fred != null
      ? fred.fedTargetUpper != null && fred.fedTargetLower != null
        ? `미국 기준금리 목표 ${fred.fedTargetLower}~${fred.fedTargetUpper}% (참고)`
        : fred.fedFundsRate != null ? `미국 기준금리 ${fred.fedFundsRate}% (참고)` : null
      : null,
    ecos?.baseRate != null ? `한국 기준금리 ${ecos.baseRate}%` : null,
    ecos?.cpiYoY   != null ? `한국 CPI ${ecos.cpiYoY}% YoY`   : null,
  ].filter(Boolean).join(" | ");

  // ── 장전 프롬프트 ──────────────────────────────────────────────────────────
  const morningPrompt = `당신은 개인 투자자의 친근한 시장 해설가입니다. 오늘은 ${today}이고, 한국 주식시장 개장 전입니다.
간밤에 미국 시장에서 무슨 일이 있었는지, 그리고 오늘 우리 시장에 어떤 영향이 올지를 쉽게 설명해 주세요.
주식을 막 시작한 사람도 이해할 수 있게, 친근한 해요체로 써주세요.

[간밤 미국 주요 지수 (최신)]
${usIndicesBlock || "데이터 없음"}

[거시경제 지표]
${macroBlock || "데이터 없음"}

[최근 KOSPI 흐름 (참고)]
${kospiHistory}

[최근 KOSDAQ 흐름 (참고)]
${kosdaqHistory}

[AI 모델 3일 예측]
KOSPI: ${kospiPred ?? "N/A"}, KOSDAQ: ${kosdaqPred ?? "N/A"}

아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{
  "summary": "간밤 미국 시장 한 줄 요약 (20자 내외, 명사형)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "leadParagraph": "간밤 미국 시장 전체 분위기를 2문장으로. 주요 지수 등락 수치 포함. 예: '간밤 미국 시장은 기술주 중심으로 강하게 올랐어요. 나스닥이 1.5% 오르고 S&P500도 0.8% 상승하며 투자자들의 기대감이 커졌어요.' (80~120자)",
  "storyLine": "왜 미국 시장이 그렇게 움직였는지, 어떤 이슈가 있었는지, 그래서 오늘 우리 한국 시장에 어떤 영향이 예상되는지를 이야기처럼 써주세요. SOX(반도체 지수)나 달러 움직임 같은 한국 주식과 직접 연결되는 내용을 꼭 포함해주세요. 예: '어제 미국에서 엔비디아가 실적을 잘 내면서 반도체 주식들이 많이 올랐어요. 필라델피아 반도체 지수(SOX)가 2% 넘게 오른 게 삼성전자·SK하이닉스에도 좋은 신호예요. 달러가 살짝 약해져서 우리나라 원화 가치도 올라갈 수 있고, 외국인 투자자들이 우리 시장에 돈을 더 넣을 가능성이 있어요. AI 예측으로는 오늘 코스피가 ${kospiPred ?? "N/A"} 움직임을 보일 것 같아요.' (180~250자)",
  "marketEvents": [
    { "title": "간밤 미국 이슈 제목 (15자 이내)", "impact": "이게 오늘 우리 시장에 왜 중요한지 쉽게 (40~60자)", "direction": "positive 또는 negative 또는 neutral" },
    { "title": "이슈2", "impact": "...", "direction": "..." },
    { "title": "이슈3", "impact": "...", "direction": "..." },
    { "title": "이슈4", "impact": "...", "direction": "..." }
  ],
  "macroFactors": [
    { "factor": "지표명 (나스닥, SOX, 달러인덱스, 국채금리, VIX 등)", "status": "수치와 전일비 포함", "implication": "오늘 한국 주식에 미치는 영향 한 줄 (40~60자)" },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." }
  ],
  "forwardLook": [
    { "point": "오늘 장에서 가장 중요한 것 (15자)", "detail": "AI 예측 포함해서 오늘 어떨지 쉽게 (50~70자)", "watchFor": "꼭 체크해야 할 것 한 가지 (25자)" },
    { "point": "...", "detail": "...", "watchFor": "..." },
    { "point": "...", "detail": "...", "watchFor": "..." }
  ],
  "upcomingMacroEvents": [
    { "date": "구체적 날짜나 '오늘', '이번 주 수요일'", "title": "이벤트명 (20자)", "description": "쉬운 설명 + 주가 영향 (60~80자)", "impact": "high/medium/low", "direction": "positive/negative/neutral" },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." }
  ],
  "keyRisk": "오늘 한국 시장에서 가장 조심해야 할 것 한 줄 (40~60자)",
  "recentIssues": ["간밤 미국 이슈 요약1", "이슈2", "이슈3"],
  "outlook": ["오늘 전망1", "전망2", "전망3"]
}

작성 원칙:
- 미국 지수 수치(S&P500, 나스닥, 다우, SOX)와 달러인덱스를 구체적으로 인용하세요
- SOX(필라델피아 반도체)는 삼성전자·SK하이닉스와 직결되므로 반드시 포함하세요
- 달러 강약이 원화·수출주에 미치는 영향을 설명하세요
- 절대 금지: 전문 용어 설명 없이 사용 금지 ("수급", "밸류에이션" 등)
- 문체: 친근한 해요체`;

  // ── 장마감 프롬프트 ────────────────────────────────────────────────────────
  const closingPrompt = `당신은 개인 투자자의 친근한 시장 해설가입니다. 오늘은 ${today}입니다.
오늘 한국 주식시장이 마감됐어요. 오늘 어떤 일이 있었는지, 왜 그랬는지, 앞으로 어떻게 될지를 쉽게 설명해 주세요.

[오늘 포함 최근 5거래일 KOSPI]
${kospiHistory}

[오늘 포함 최근 5거래일 KOSDAQ]
${kosdaqHistory}

[AI 모델 3일 예측]
KOSPI: ${kospiPred ?? "N/A"}, KOSDAQ: ${kosdaqPred ?? "N/A"}

[미국 주요 지수 (어제 마감)]
${usIndicesBlock || "데이터 없음"}

[거시경제 지표]
${macroBlock || "데이터 없음"}

아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{
  "summary": "오늘 시장 분위기를 한 줄로 (20자 내외, 명사형 또는 짧은 문장)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "leadParagraph": "오늘 코스피·코스닥이 어떻게 움직였는지, 왜 그랬는지 2문장으로. 수치 포함. (80~120자)",
  "storyLine": "오늘 하루 어떤 일이 있었고, 왜 시장이 그렇게 움직였는지, 그래서 내일·이번 주에 어떻게 될 것 같은지 이야기처럼. AI 예측 포함. (150~220자)",
  "marketEvents": [
    { "title": "오늘 시장 이슈 제목 (15자)", "impact": "이 이슈가 왜 주가에 영향을 줬는지 (40~60자)", "direction": "positive/negative/neutral" },
    { "title": "이슈2", "impact": "...", "direction": "..." },
    { "title": "이슈3", "impact": "...", "direction": "..." }
  ],
  "macroFactors": [
    { "factor": "지표명", "status": "수치와 전일비", "implication": "내 주식에 왜 중요한지 (40~60자)" },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." }
  ],
  "forwardLook": [
    { "point": "내일·이번 주 가장 중요한 것 (15자)", "detail": "AI 예측 포함 (50~70자)", "watchFor": "꼭 봐야 할 것 (25자)" },
    { "point": "...", "detail": "...", "watchFor": "..." },
    { "point": "...", "detail": "...", "watchFor": "..." }
  ],
  "upcomingMacroEvents": [
    { "date": "구체적 날짜", "title": "이벤트명 (20자)", "description": "쉬운 설명 (60~80자)", "impact": "high/medium/low", "direction": "positive/negative/neutral" },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." }
  ],
  "keyRisk": "지금 가장 조심해야 할 것 한 줄 (40~60자)",
  "recentIssues": ["이슈 요약1", "이슈2", "이슈3"],
  "outlook": ["전망1", "전망2", "전망3"]
}

작성 원칙:
- 오늘 코스피·코스닥 수치를 구체적으로 인용하세요
- upcomingMacroEvents는 향후 3~5거래일 예정 이벤트 (FOMC, CPI, 관세, 정치 이슈 등)
- 절대 금지: 전문 용어 설명 없이 사용 금지
- 문체: 친근한 해요체`;

  const prompt = session === "morning" ? morningPrompt : closingPrompt;

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
    sessionType:          session,
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
