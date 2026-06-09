import { Router } from "express";
import { getStatus, runPipeline, runDailyIncrementalUpdate } from "../lib/lstm-predictor.js";
import { getAllLiveAccuracy, getPredictionHistory, getTodayPredictions } from "../lib/prediction-tracker.js";
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

// ─── 인메모리 캐시 + DB 영구 캐시 ───────────────────────────────────────────

interface BriefCache {
  data: MarketBriefResult;
  cachedAt: number;
}
const BRIEF_TTL = 8 * 3600_000;   // 8시간 (장전·장마감 2회 갱신 주기에 맞춤)
let _briefCache: BriefCache | null = null;
let _briefRefreshing = false;      // 백그라운드 갱신 중복 방지

/** DB에 brief 저장 */
async function saveBriefToDb(cache: BriefCache) {
  try {
    await pool.query(`
      INSERT INTO kv_cache (key, value, cached_at)
      VALUES ('market_brief', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $1, cached_at = $2
    `, [JSON.stringify(cache.data), new Date(cache.cachedAt)]);
  } catch (err: any) {
    console.error("[market-brief] DB 저장 실패:", err?.message);
  }
}

/** 서버 시작 시 DB에서 brief 복원 */
async function loadBriefFromDb(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kv_cache (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        cached_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const r = await pool.query(
      `SELECT value, cached_at FROM kv_cache WHERE key = 'market_brief' LIMIT 1`
    );
    if (r.rows.length) {
      const cachedAt = new Date(r.rows[0].cached_at).getTime();
      if (Date.now() - cachedAt < BRIEF_TTL) {
        _briefCache = { data: r.rows[0].value as MarketBriefResult, cachedAt };
        console.log("[market-brief] DB 캐시 복원 성공 (즉시 서빙 가능)");
      } else {
        // 만료된 캐시도 일단 복원해 두고 (유저가 즉시 볼 수 있도록) 백그라운드 갱신
        _briefCache = { data: r.rows[0].value as MarketBriefResult, cachedAt };
        console.log("[market-brief] DB 캐시 만료 — 복원 후 백그라운드 갱신 시작");
        setTimeout(() => refreshBriefInBackground("서버시작-만료캐시"), 5000);
      }
    } else {
      // 캐시 없음 — 서버 시작 후 바로 생성
      console.log("[market-brief] DB 캐시 없음 — 백그라운드 생성 시작");
      setTimeout(() => refreshBriefInBackground("서버시작-최초생성"), 8000);
    }
  } catch (err: any) {
    console.error("[market-brief] DB 복원 실패:", err?.message);
  }
}

// 모듈 로드 시 DB 캐시 자동 복원
loadBriefFromDb().catch(() => {});

/** 스케줄러에서 호출 — 백그라운드에서 즉시 브리핑 생성 시작 (유저 대기 없음) */
export function refreshBriefInBackground(reason = "", retryCount = 0) {
  if (_briefRefreshing) {
    console.log("[market-brief] 이미 갱신 중 — 스킵");
    return;
  }
  _briefRefreshing = true;
  const maxRetries = 3;
  console.log(`[market-brief] 백그라운드 갱신 시작${reason ? ` (${reason})` : ""}${retryCount > 0 ? ` [재시도 ${retryCount}/${maxRetries}]` : ""}`);
  generateBrief()
    .then(result => {
      _briefCache = { data: result, cachedAt: Date.now() };
      return saveBriefToDb(_briefCache);
    })
    .then(() => console.log("[market-brief] 백그라운드 갱신 완료"))
    .catch(err => {
      console.error("[market-brief] 백그라운드 갱신 실패:", err?.message);
      if (retryCount < maxRetries) {
        const delay = (retryCount + 1) * 5 * 60_000; // 5분, 10분, 15분 후 재시도
        console.log(`[market-brief] ${delay / 60_000}분 후 재시도 예정`);
        setTimeout(() => {
          _briefRefreshing = false;
          refreshBriefInBackground(reason + "-retry", retryCount + 1);
        }, delay);
        return;
      }
    })
    .finally(() => { _briefRefreshing = false; });
}

/** @deprecated 캐시를 null로 만들면 다음 요청이 60~90초 대기함 — refreshBriefInBackground 사용 */
export function invalidateBriefCache() {
  refreshBriefInBackground("스케줄러 캐시 무효화");
}

export interface MarketBriefResult {
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  sessionType: "morning" | "midday" | "closing" | "weekend";
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
  keyTopics: {
    keyword: string;
    category: "정치" | "기업" | "경제" | "글로벌" | "산업";
    description: string;
  }[];
  keyRisk: string;
  recentIssues: string[];
  outlook: string[];
  generatedAt: string;
  kospiCurrent: number | null;
  kosdaqCurrent: number | null;
  snp500Current: number | null;
  kospiChange: number | null;
  kosdaqChange: number | null;
  snp500Change: number | null;
}

// ─── 실시간 시장 뉴스 수집 ───────────────────────────────────────────────────

/** Google News RSS + 네이버 금융 뉴스로 최신 한국 시장 뉴스 헤드라인 수집 */
export async function fetchMarketNews(): Promise<string> {
  const queries = [
    "코스피 코스닥 증시 주식 이슈",
    "삼성전자 SK하이닉스 현대차 LG에너지솔루션 기업",
    "한국 경제 정치 금리 환율 관세",
    "반도체 바이오 2차전지 방산 조선 섹터 주식",
    "미국 나스닥 S&P500 Fed 연준 금리 달러",
    "중국 경제 무역 위안화 미중 관계",
  ];

  function parseRssItems(xml: string, maxItems = 8): string[] {
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
    return items.slice(0, maxItems).flatMap(item => {
      const cdataTitle = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1];
      const plainTitle = item.match(/<title>([\s\S]*?)<\/title>/)?.[1];
      const title = (cdataTitle ?? plainTitle ?? "").trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      const source = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "").trim();
      return title.length > 8 ? [`• ${title}${source ? ` [${source}]` : ""}`] : [];
    });
  }

  const settled = await Promise.allSettled(
    queries.map(async q => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) return "";
      const xml = await res.text();
      return parseRssItems(xml, 8).join("\n");
    })
  );

  // 네이버 금융 뉴스 RSS (추가 소스)
  const naverSettled = await Promise.allSettled([
    fetch("https://finance.naver.com/news/news_list.nhn?mode=LSS3D&section_id=101&section_id2=258&section_id3=401", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(7000),
    }).then(r => r.text()).then(html => {
      const titles = [...html.matchAll(/class="ti"[^>]*>([\s\S]*?)<\/a>/g)]
        .slice(0, 6)
        .map(m => `• ${m[1].replace(/<[^>]+>/g, "").trim()} [네이버금융]`)
        .filter(t => t.length > 10);
      return titles.join("\n");
    }),
  ]);

  const allLines = [
    ...settled.filter(r => r.status === "fulfilled").map(r => (r as any).value as string),
    ...naverSettled.filter(r => r.status === "fulfilled").map(r => (r as any).value as string),
  ].filter(Boolean);

  const combined = allLines.join("\n");
  console.log(`[market-brief] 뉴스 수집: ${combined.split("\n").filter(l => l.startsWith("•")).length}건`);
  return combined || "";
}

// ─── 시장 데이터 수집 헬퍼 ──────────────────────────────────────────────────

/** 네이버 증권 API로 KOSPI/KOSDAQ 당일 데이터 취득 (Yahoo Finance보다 하루 빠름) */
async function fetchNaverIndex(indexCode: "KOSPI" | "KOSDAQ", n = 5) {
  // 1차: 네이버 모바일 API
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/index/${indexCode}/price`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const rows: any[] = await res.json();
      if (rows?.length) {
        return rows.slice(0, n).reverse().map((r: any) => ({
          date:   r.localTradedAt as string,
          close:  +String(r.closePrice).replace(/,/g, ""),
          change: r.fluctuationsRatio != null ? +Number(r.fluctuationsRatio).toFixed(2) : null,
        }));
      }
    }
  } catch { /* fall through to Yahoo */ }

  // 2차: Yahoo Finance fallback (^KS11 = KOSPI, ^KQ11 = KOSDAQ)
  try {
    const yahooSymbol = indexCode === "KOSPI" ? "^KS11" : "^KQ11";
    const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 14);
    const data = await (yahoo as any).chart(yahooSymbol, { period1: start, period2: end, interval: "1d" });
    const all = (data?.quotes ?? []).filter((q: any) => q.close != null);
    const window = all.slice(-(n + 1));
    if (window.length < 2) return null;
    return window.slice(1).map((q: any, i: number) => {
      const prevClose = window[i]?.close ?? null;
      const change = prevClose && q.close
        ? +(((q.close - prevClose) / prevClose) * 100).toFixed(2)
        : null;
      return {
        date:   new Date(q.date).toISOString().slice(0, 10),
        close:  +(q.close as number).toFixed(2),
        change,
      };
    });
  } catch { return null; }
}

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
    fetchNaverIndex("KOSPI",  5),   // 네이버 — 당일 KRX 데이터
    fetchNaverIndex("KOSDAQ", 5),   // 네이버 — 당일 KRX 데이터
    (yahoo as any).chart("^GSPC",    { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^IXIC",    { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^DJI",     { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^VIX",     { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("^SOX",     { period1: start, period2: end, interval: "1d" }),
    (yahoo as any).chart("DX-Y.NYB", { period1: start, period2: end, interval: "1d" }),
  ]);

  // 네이버 결과는 이미 파싱된 배열, Yahoo는 quotes 배열
  function extractNaver(result: PromiseSettledResult<any>) {
    if (result.status !== "fulfilled" || !result.value) return null;
    return result.value as { date: string; close: number; change: number | null }[];
  }
  function extractYahoo(result: PromiseSettledResult<any>, n = 5) {
    if (result.status !== "fulfilled") return null;
    // 전날 종가 대비 등락률(= 실제 하루 수익률)을 계산하기 위해 n+1개 가져옴
    const all = (result.value?.quotes ?? []).filter((q: any) => q.close != null);
    const window = all.slice(-(n + 1));
    return window.slice(1).map((q: any, i: number) => {
      const prevClose = window[i]?.close ?? null;
      const change = prevClose && q.close
        ? +(((q.close - prevClose) / prevClose) * 100).toFixed(2)
        : null;
      return {
        date:   new Date(q.date).toISOString().slice(0, 10),
        close:  +(q.close as number).toFixed(2),
        change,
      };
    });
  }

  const kospi  = extractNaver(kospiData);
  const kosdaq = extractNaver(kosdaqData);
  const snp500 = extractYahoo(snpData);
  const nasdaq = extractYahoo(nasdaqData, 3);
  const dow    = extractYahoo(dowData, 3);
  const vix    = extractYahoo(vixData, 3);
  const sox    = extractYahoo(soxData, 3);
  const dxy    = extractYahoo(dxyData, 3);

  // ── [날짜 검증] Naver API가 전일 데이터를 반환하는 경우 감지 ─────────────
  // KRX 결제는 15:30 이후 ~30분 소요 → Naver API가 당일 데이터를 반영하지 않을 수 있음
  const todayKST = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const kospiLatestDate  = kospi?.at(-1)?.date ?? null;
  const kosdaqLatestDate = kosdaq?.at(-1)?.date ?? null;
  const kospiDataStale  = kospiLatestDate  !== null && kospiLatestDate  < todayKST;
  const kosdaqDataStale = kosdaqLatestDate !== null && kosdaqLatestDate < todayKST;
  if (kospiDataStale || kosdaqDataStale) {
    console.warn(`[market-brief] ⚠️ Naver API 전일 데이터 반환 — KOSPI: ${kospiLatestDate}, KOSDAQ: ${kosdaqLatestDate}, 오늘 KST: ${todayKST}`);
  } else if (kospiLatestDate) {
    console.log(`[market-brief] Naver 날짜 검증 OK — KOSPI 최신: ${kospiLatestDate}`);
  }

  return { kospi, kosdaq, snp500, nasdaq, dow, vix, sox, dxy, kospiDataStale, kosdaqDataStale, todayKST };
}

// ─── Gemini 브리핑 생성 ──────────────────────────────────────────────────────

/**
 * KST 기준 세션 감지 (분 단위 정밀도)
 *   UTC 21:00~02:00  (KST 06:00~11:00) → 장전  : 간밤 미국 시장 브리핑
 *   UTC 02:00~06:30  (KST 11:00~15:30) → 장중  : 오전 흐름·오후 전망 브리핑
 *   UTC 06:30~21:00  (KST 15:30~06:00) → 장마감: 당일 한국 장 리뷰·내일 준비
 *
 * 한국 증시 종료: 15:30 KST = 06:30 UTC
 */
function detectSession(): "morning" | "midday" | "closing" | "weekend" {
  const now = new Date();
  // KST 기준 요일 (UTC+9)
  const kstDay = new Date(now.getTime() + 9 * 3600_000).getUTCDay(); // 0=일, 6=토
  if (kstDay === 0 || kstDay === 6) return "weekend";

  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const MORNING_START = 21 * 60;      // 06:00 KST
  const MIDDAY_START  =  2 * 60;      // 11:00 KST
  const CLOSE_START   =  6 * 60 + 30; // 15:30 KST — 장 종료

  if (utcMin >= MORNING_START || utcMin < MIDDAY_START) return "morning";
  if (utcMin < CLOSE_START)  return "midday";
  return "closing";
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

  // 병렬로 데이터 수집 (뉴스 포함)
  const [indexData, fredData, ecosData, pipelineStatus, newsResult] = await Promise.allSettled([
    fetchRecentIndexData(),
    fetchFREDMacro(),
    fetchECOSMacro(),
    Promise.resolve(getStatus()),
    fetchMarketNews(),
  ]);

  const idx      = indexData.status === "fulfilled" ? indexData.value : null;
  const fred     = fredData.status  === "fulfilled" ? fredData.value  : null;
  const ecos     = ecosData.status  === "fulfilled" ? ecosData.value  : null;
  const pipeline = pipelineStatus.status === "fulfilled" ? pipelineStatus.value : null;
  const newsBlock = newsResult.status === "fulfilled" ? newsResult.value : "";

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
  const snp500Pred = pipeline?.snp500 ? `${pipeline.snp500.predictedReturn3d >= 0 ? "+" : ""}${pipeline.snp500.predictedReturn3d}%` : null;

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

  // ── 공통 JSON 스키마 (keyTopics 포함) ─────────────────────────────────────
  const keyTopicsSchema = `  "keyTopics": [
    { "keyword": "핵심 키워드 (10자)", "category": "정치 또는 기업 또는 경제 또는 글로벌 또는 산업", "description": "이 이슈가 지금 시장에 왜 중요한지 구체적으로 (50~70자)" },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." }
  ]`;

  const keyTopicsRule = `- keyTopics: 뉴스 헤드라인과 현재 시황을 바탕으로 시장을 움직이는 핵심 키워드 7개 선정. 반드시 글로벌(미국·중국)·국내 기업(삼성전자·SK하이닉스·현대차)·정치(관세·규제)·섹터(반도체·바이오·2차전지·방산·조선) 중 다양하게 커버. 각 description은 "왜 지금 주가에 영향 주는지" 구체적으로.`;

  // ── 장전 프롬프트 ──────────────────────────────────────────────────────────
  const morningPrompt = `당신은 시장 해설가입니다. 오늘은 ${today}이고, 한국 주식시장 개장 전입니다.
간밤에 미국 시장에서 무슨 일이 있었는지, 그리고 오늘 우리 시장에 어떤 영향이 올지를 쉽게 설명해 주세요.
주식을 막 시작한 사람도 이해할 수 있게, 친근한 해요체로 써주세요.
첫 문장은 반드시 시장 상황·수치·이슈로 시작하세요. 아래 표현들은 절대 금지입니다:
"안녕하세요", "여러분", "개인 투자자 여러분", "오늘도", "반갑습니다", "잘 지내고 계신가요", "좋은 아침", "안녕들 하세요", 날짜·요일로 시작하는 인삿말, 날씨·계절 언급, 감성적 서두.

⚠️ 간밤 미국 시장 방향 — 이 데이터를 반드시 그대로 사용하세요 (임의 변경 절대 금지):
S&P500: ${snpL ? `${snpL.close.toLocaleString()}pt, ${snpL.change != null ? (snpL.change > 0 ? `▲+${snpL.change}% 상승` : snpL.change < 0 ? `▼${snpL.change}% 하락` : "보합") : "N/A"}` : "데이터 없음"}
나스닥: ${nasdaqL ? `${nasdaqL.close.toLocaleString()}pt, ${nasdaqL.change != null ? (nasdaqL.change > 0 ? `▲+${nasdaqL.change}% 상승` : nasdaqL.change < 0 ? `▼${nasdaqL.change}% 하락` : "보합") : "N/A"}` : "데이터 없음"}
→ 미국 지수가 하락했으면 반드시 하락으로, 상승했으면 상승으로 서술하세요.

[간밤 미국 주요 지수 (최신)]
${usIndicesBlock || "데이터 없음"}

[거시경제 지표]
${macroBlock || "데이터 없음"}

[최근 KOSPI 흐름 (참고)]
${kospiHistory}

[최근 KOSDAQ 흐름 (참고)]
${kosdaqHistory}

[AI 모델 3일 예측]
KOSPI: ${kospiPred ?? "N/A"}, KOSDAQ: ${kosdaqPred ?? "N/A"}, S&P500: ${snp500Pred ?? "N/A"}

[실시간 뉴스/이슈 헤드라인]
${newsBlock || "뉴스 데이터 없음 — 당신의 최신 지식으로 주요 이슈를 판단하세요"}

아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{
  "summary": "간밤 미국 시장 한 줄 요약 (20자 내외, 명사형)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "leadParagraph": "간밤 미국 시장 전체 분위기를 2문장으로. 주요 지수 등락 수치 포함. (80~120자)",
  "storyLine": "왜 미국 시장이 그렇게 움직였는지, 어떤 이슈가 있었는지(뉴스 헤드라인 참고), 그래서 오늘 한국 시장에 어떤 영향이 예상되는지 이야기처럼. SOX·달러 움직임, 주요 섹터(반도체·바이오·2차전지·방산) 영향, 기관·외국인 수급 동향도 포함. AI 예측(KOSPI: ${kospiPred ?? "N/A"}) 포함. (350~500자) 반드시 2~3개 단락으로 나눠 작성하고 단락 사이에 \\n\\n을 삽입하세요.",
  "marketEvents": [
    { "title": "간밤 핵심 이슈 (15자)", "impact": "오늘 우리 시장에 왜 중요한지 쉽게 (60~80자)", "direction": "positive 또는 negative 또는 neutral" },
    { "title": "이슈2 (미국·글로벌)", "impact": "...", "direction": "..." },
    { "title": "이슈3 (반도체·SOX)", "impact": "...", "direction": "..." },
    { "title": "이슈4 (국내 대형주 기업)", "impact": "...", "direction": "..." },
    { "title": "이슈5 (정치·관세·규제)", "impact": "...", "direction": "..." },
    { "title": "이슈6 (섹터: 바이오·2차전지·방산·조선 중 하나)", "impact": "...", "direction": "..." },
    { "title": "이슈7 (환율·원자재·금리)", "impact": "...", "direction": "..." }
  ],
  "macroFactors": [
    { "factor": "지표명 (나스닥, SOX, 달러인덱스, 국채금리, VIX 등)", "status": "수치와 전일비 포함", "implication": "오늘 한국 주식에 미치는 영향 (40~60자)" },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." }
  ],
  "forwardLook": [
    { "point": "오늘 장 핵심 포인트 (15자)", "detail": "AI 예측 포함해서 오늘 어떨지 쉽게 (50~70자)", "watchFor": "꼭 체크해야 할 것 한 가지 (25자)" },
    { "point": "...", "detail": "...", "watchFor": "..." },
    { "point": "...", "detail": "...", "watchFor": "..." }
  ],
  "upcomingMacroEvents": [
    { "date": "구체적 날짜나 '오늘', '이번 주 수요일'", "title": "이벤트명 (20자)", "description": "쉬운 설명 + 주가 영향 (60~80자)", "impact": "high/medium/low", "direction": "positive/negative/neutral" },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." }
  ],
${keyTopicsSchema},
  "keyRisk": "오늘 한국 시장에서 가장 조심해야 할 것 한 줄 (40~60자)",
  "recentIssues": ["간밤 미국 이슈 요약1", "이슈2", "이슈3", "이슈4"],
  "outlook": ["오늘 전망1", "전망2", "전망3"]
}

작성 원칙:
- ⚠️ 최우선 수칙: 프롬프트 상단 "간밤 미국 시장 방향" 블록의 S&P500·나스닥 등락을 반드시 그대로 사용하세요. 미국 지수가 하락했으면 하락으로 서술해야 합니다. 이를 어기면 심각한 사실 오보입니다.
- 미국 지수 수치(S&P500, 나스닥, 다우, SOX)와 달러인덱스를 구체적으로 인용하세요
- SOX(필라델피아 반도체)는 삼성전자·SK하이닉스와 직결되므로 반드시 포함하세요
- 달러 강약이 원화·수출주에 미치는 영향을 설명하세요
- marketEvents 7개를 반드시 채우세요: 글로벌·기업·정치·반도체·섹터·환율 카테고리를 골고루 커버
- 국내 기업 이슈(삼성전자·SK하이닉스·현대차·LG에너지솔루션 실적·파업·인수합병)와 정치 이슈(관세·규제)를 반드시 포함
- 바이오·2차전지·방산·조선·게임 등 테마 섹터 이슈 최소 1개 포함
- impact 문장은 구체적 수치나 종목명을 넣어 실질적으로 (예: "SOX 2.3% 상승으로 삼성전자·SK하이닉스 동반 강세 예상")
${keyTopicsRule}
- 절대 금지: 전문 용어 설명 없이 사용 금지 ("수급", "밸류에이션" 등 → 쉬운 말로 풀어서)
- 문체: 친근한 해요체`;

  // ── 장마감 프롬프트 ────────────────────────────────────────────────────────
  // 방향 guardrail 헬퍼
  const dirLabel = (ch: number | null) =>
    ch == null ? "N/A" : ch > 0 ? `▲+${ch}% 상승 마감` : ch < 0 ? `▼${ch}% 하락 마감` : "보합";

  // 데이터 staleness 경고 블록
  const dataStaleWarning = (idx?.kospiDataStale || idx?.kosdaqDataStale)
    ? `\n🚨 데이터 시차 경고: 아래 KOSPI/KOSDAQ 수치는 전일(${idx?.kospi?.at(-1)?.date ?? "??"}) 데이터입니다.
오늘 마감 데이터가 아직 반영되지 않았습니다. 오늘 방향은 확정할 수 없으므로 "오늘 최종 데이터 기준"이 아닌 "전일 기준" 또는 "장 중 흐름 기준"으로 작성하세요.`
    : "";

  // 급락·급등 강조 블록 (|변화율| > 3%)
  const kospiChange  = kospiLatest?.change  ?? 0;
  const kosdaqChange = kosdaqLatest?.change ?? 0;
  const extremeMove  = Math.abs(kospiChange) >= 3 || Math.abs(kosdaqChange) >= 3;
  const extremeBlock = extremeMove
    ? `\n🚨 대폭 변동 경고: 오늘 코스피(${kospiChange >= 0 ? "+" : ""}${kospiChange}%) 또는 코스닥(${kosdaqChange >= 0 ? "+" : ""}${kosdaqChange}%)이 ±3% 이상의 극단적 움직임을 보였습니다.
이는 패닉 셀링 또는 급격한 랠리 수준입니다. sentiment는 반드시 ${kospiChange < -3 || kosdaqChange < -3 ? '"bearish"' : '"bullish"'}여야 하고,
leadParagraph와 storyLine에 이 폭락/급등의 원인과 규모를 반드시 명확히 서술하세요.
뉴스 헤드라인에 긍정적 내용이 있더라도 지수가 -3% 이상 하락했으면 전반적 하락장으로 서술해야 합니다.`
    : "";

  const kospiStr  = kospiLatest  ? `${kospiLatest.close.toLocaleString()}pt, ${dirLabel(kospiLatest.change)}`  : "(마감 데이터 수집 중 — 이 칸은 공백으로 두고 뉴스 기반으로 서술하세요)";
  const kosdaqStr = kosdaqLatest ? `${kosdaqLatest.close.toLocaleString()}pt, ${dirLabel(kosdaqLatest.change)}` : "(마감 데이터 수집 중 — 이 칸은 공백으로 두고 뉴스 기반으로 서술하세요)";

  const closingPrompt = `당신은 시장 해설가입니다. 오늘은 ${today}입니다.
오늘 한국 주식시장이 마감됐어요. 오늘 어떤 일이 있었는지, 왜 그랬는지, 앞으로 어떻게 될지를 쉽게 설명해 주세요.
첫 문장은 반드시 오늘 시장 수치나 핵심 이슈로 시작하세요. 아래 표현들은 절대 금지입니다:
"안녕하세요", "여러분", "개인 투자자 여러분", "오늘도", "반갑습니다", "잘 지내고 계신가요", "좋은 저녁", 날짜·요일로 시작하는 인삿말, 감성적 서두.
⛔ 절대 금지: "데이터 없음"이라는 표현을 브리핑 본문에 절대 쓰지 마세요. 데이터가 없으면 해당 항목은 생략하고 다른 정보로 서술하세요.
${dataStaleWarning}${extremeBlock}

⚠️ 오늘 한국 시장 마감 방향 — 이 데이터를 반드시 그대로 사용하세요 (임의 변경 절대 금지):
코스피: ${kospiStr}
코스닥: ${kosdaqStr}
→ 코스피가 하락이면 반드시 "하락 마감"으로, 상승이면 "상승 마감"으로 서술하세요. 뉴스나 특정 섹터가 좋더라도 지수 전체가 하락이면 하락입니다.
→ 데이터 날짜: 코스피 ${idx?.kospi?.at(-1)?.date ?? "??"}, 코스닥 ${idx?.kosdaq?.at(-1)?.date ?? "??"} (오늘 KST: ${idx?.todayKST ?? today})

[오늘 포함 최근 5거래일 KOSPI]
${kospiHistory}

[오늘 포함 최근 5거래일 KOSDAQ]
${kosdaqHistory}

[AI 모델 3일 예측]
KOSPI: ${kospiPred ?? "N/A"}, KOSDAQ: ${kosdaqPred ?? "N/A"}, S&P500: ${snp500Pred ?? "N/A"}

[미국 주요 지수 (어제 마감)]
${usIndicesBlock || "데이터 없음"}

[거시경제 지표]
${macroBlock || "데이터 없음"}

[실시간 뉴스/이슈 헤드라인]
${newsBlock || "뉴스 데이터 없음 — 당신의 최신 지식으로 주요 이슈를 판단하세요"}

아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{
  "summary": "오늘 시장 분위기를 한 줄로 (20자 내외, 명사형 또는 짧은 문장)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "leadParagraph": "오늘 코스피·코스닥이 어떻게 움직였는지, 왜 그랬는지 2문장으로. 수치 포함. (80~120자)",
  "storyLine": "오늘 하루 어떤 대내외 이슈가 있었고(뉴스 헤드라인 참고), 왜 시장이 그렇게 움직였는지, 내일·이번 주에 어떻게 될 것 같은지 이야기처럼. 국내 기업·정치 이슈와 글로벌 이슈, 주요 섹터(반도체·바이오·2차전지·방산·조선) 동향, 기관·외국인·개인 수급 흐름도 언급. AI 예측 포함. (350~500자) 반드시 2~3개 단락으로 나눠 작성하고 단락 사이에 \\n\\n을 삽입하세요.",
  "marketEvents": [
    { "title": "오늘 핵심 이슈 (15자)", "impact": "이 이슈가 왜 주가에 영향을 줬는지 (60~80자)", "direction": "positive/negative/neutral" },
    { "title": "이슈2 (국내 대형주 기업)", "impact": "...", "direction": "..." },
    { "title": "이슈3 (정치/관세/규제)", "impact": "...", "direction": "..." },
    { "title": "이슈4 (글로벌·미국·중국)", "impact": "...", "direction": "..." },
    { "title": "이슈5 (반도체·SOX)", "impact": "...", "direction": "..." },
    { "title": "이슈6 (섹터: 바이오·2차전지·방산·조선 중 하나)", "impact": "...", "direction": "..." },
    { "title": "이슈7 (환율·원자재·수급)", "impact": "...", "direction": "..." }
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
${keyTopicsSchema},
  "keyRisk": "지금 가장 조심해야 할 것 한 줄 (40~60자)",
  "recentIssues": ["오늘 이슈 요약1", "이슈2", "이슈3", "이슈4"],
  "outlook": ["내일 전망1", "전망2", "전망3"]
}

작성 원칙:
- ⚠️ 최우선 수칙: 프롬프트 최상단 "오늘 한국 시장 마감 방향" 블록의 코스피·코스닥 등락을 반드시 그대로 사용하세요. 코스피가 하락이면 storyLine·leadParagraph에도 하락으로, sentiment도 bearish(또는 neutral)로 써야 합니다. 뉴스 헤드라인이 긍정적이어도 지수 전체가 하락이면 하락입니다. 이를 어기면 심각한 사실 오보입니다.
- 오늘 코스피·코스닥 수치를 구체적으로 인용하세요
- marketEvents 7개를 반드시 채우세요: 글로벌·기업·정치·반도체·섹터·환율/수급 카테고리를 골고루 커버
- 삼성전자·SK하이닉스·현대차·LG에너지솔루션 같은 기업 이슈, 정치 이슈(관세·규제·파업 등) 반드시 포함
- 바이오·2차전지·방산·조선 등 테마 섹터 이슈 최소 1개 포함
- upcomingMacroEvents는 향후 3~5거래일 예정 이벤트 (FOMC, CPI, 관세, 정치 이슈 등)
- impact 문장은 구체적 수치나 종목명을 넣어 실질적으로 작성
${keyTopicsRule}
- 절대 금지: 전문 용어 설명 없이 사용 금지
- 문체: 친근한 해요체`;

  // ── 장중 프롬프트 (오후 1시, KST 11~16) ────────────────────────────────────
  const middayPrompt = `당신은 시장 해설가입니다. 오늘은 ${today}이고, 한국 주식시장이 한창 열려 있는 시간입니다.
지금 장 중반 흐름이 어떤지, 오후에 어떻게 될지, 마감까지 꼭 챙겨봐야 할 것은 무엇인지 쉽게 설명해 주세요.
첫 문장은 반드시 현재 지수 수치나 장 중 이슈로 시작하세요. 아래 표현들은 절대 금지입니다:
"안녕하세요", "여러분", "개인 투자자 여러분", "오늘도", "반갑습니다", 날짜·요일로 시작하는 인삿말, 감성적 서두.

⚠️ 오전 장 현재 방향 — 이 데이터를 반드시 그대로 사용하세요 (임의 변경 절대 금지):
코스피: ${kospiLatest ? `${kospiLatest.close.toLocaleString()}pt, ${kospiLatest.change != null ? (kospiLatest.change > 0 ? `▲+${kospiLatest.change}% 상승 중` : kospiLatest.change < 0 ? `▼${kospiLatest.change}% 하락 중` : "보합") : "N/A"}` : "데이터 없음"}
코스닥: ${kosdaqLatest ? `${kosdaqLatest.close.toLocaleString()}pt, ${kosdaqLatest.change != null ? (kosdaqLatest.change > 0 ? `▲+${kosdaqLatest.change}% 상승 중` : kosdaqLatest.change < 0 ? `▼${kosdaqLatest.change}% 하락 중` : "보합") : "N/A"}` : "데이터 없음"}
→ 위 방향을 반드시 그대로 서술하세요. 이를 어기면 심각한 사실 오보입니다.

[오전 포함 최근 KOSPI 흐름]
${kospiHistory}

[오전 포함 최근 KOSDAQ 흐름]
${kosdaqHistory}

[AI 모델 3일 예측]
KOSPI: ${kospiPred ?? "N/A"}, KOSDAQ: ${kosdaqPred ?? "N/A"}, S&P500: ${snp500Pred ?? "N/A"}

[어제 미국 주요 지수]
${usIndicesBlock || "데이터 없음"}

[거시경제 지표]
${macroBlock || "데이터 없음"}

[실시간 뉴스/이슈 헤드라인]
${newsBlock || "뉴스 데이터 없음 — 당신의 최신 지식으로 주요 이슈를 판단하세요"}

아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{
  "summary": "지금 장 분위기 한 줄로 (20자 내외, 명사형)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "leadParagraph": "오전 코스피·코스닥 흐름을 2문장으로. 수치 포함. (80~120자)",
  "storyLine": "왜 오전에 이렇게 움직였는지(뉴스 헤드라인 참고), 국내외 어떤 이슈가 있었는지, 주요 섹터(반도체·바이오·2차전지·방산) 흐름, 기관·외국인 수급 동향, 오후에는 어떻게 될 것 같은지, 마감까지 무엇을 지켜봐야 하는지 이야기처럼. AI 예측도 포함. (350~500자) 반드시 2~3개 단락으로 나눠 작성하고 단락 사이에 \\n\\n을 삽입하세요.",
  "marketEvents": [
    { "title": "오늘 장 중 이슈 (15자)", "impact": "이 이슈가 왜 지금 주가에 영향 주는지 (60~80자)", "direction": "positive/negative/neutral" },
    { "title": "이슈2 (국내 대형주 기업)", "impact": "...", "direction": "..." },
    { "title": "이슈3 (정치/관세/경제)", "impact": "...", "direction": "..." },
    { "title": "이슈4 (글로벌·미국·중국)", "impact": "...", "direction": "..." },
    { "title": "이슈5 (반도체·SOX)", "impact": "...", "direction": "..." },
    { "title": "이슈6 (섹터: 바이오·2차전지·방산·조선 중 하나)", "impact": "...", "direction": "..." }
  ],
  "macroFactors": [
    { "factor": "지표명", "status": "수치와 전일비", "implication": "오후 장에 왜 중요한지 (40~60자)" },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." }
  ],
  "forwardLook": [
    { "point": "오후 장 핵심 포인트 (15자)", "detail": "AI 예측 포함, 오후 어떻게 될지 (50~70자)", "watchFor": "지금 당장 봐야 할 것 (25자)" },
    { "point": "...", "detail": "...", "watchFor": "..." },
    { "point": "...", "detail": "...", "watchFor": "..." }
  ],
  "upcomingMacroEvents": [
    { "date": "오늘 또는 구체적 날짜", "title": "이벤트명 (20자)", "description": "쉬운 설명 (60~80자)", "impact": "high/medium/low", "direction": "positive/negative/neutral" },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." }
  ],
${keyTopicsSchema},
  "keyRisk": "오후 장에서 가장 조심해야 할 것 한 줄 (40~60자)",
  "recentIssues": ["오전 이슈 요약1", "이슈2", "이슈3", "이슈4"],
  "outlook": ["오후 전망1", "전망2", "전망3"]
}

작성 원칙:
- 현재 코스피·코스닥 수치를 구체적으로 인용하세요
- marketEvents 6개를 반드시 채우세요: 글로벌·기업·정치·반도체·섹터 카테고리를 골고루 커버
- 삼성전자·SK하이닉스·현대차 등 기업 이슈, 정치 이슈 반드시 포함
- 바이오·2차전지·방산·조선 등 테마 섹터 이슈 최소 1개 포함
- '지금', '오후에', '마감 전' 등 시간감 있는 표현을 사용하세요
- AI 3일 예측(KOSPI: ${kospiPred ?? "N/A"}, KOSDAQ: ${kosdaqPred ?? "N/A"})을 storyLine과 forwardLook에 반드시 포함하세요
- impact 문장은 구체적 수치나 종목명을 넣어 실질적으로 작성
${keyTopicsRule}
- 절대 금지: 전문 용어 설명 없이 사용 금지
- 문체: 친근한 해요체`;

  // ── 주말 프롬프트 ─────────────────────────────────────────────────────────
  const weekendPrompt = `당신은 시장 해설가입니다. 오늘은 ${today}으로, 주말이라 한국 주식시장은 휴장 중이에요.
이번 주 증시를 되돌아보고, 다음 주에 어떤 것들을 주목해야 할지 정리해 주세요.
첫 문장은 반드시 이번 주 지수 수치·등락률이나 핵심 이슈로 시작하세요. 아래 표현들은 절대 금지입니다:
"안녕하세요", "여러분", "개인 투자자 여러분", "주말 잘 보내고 계신가요", "오늘도", "반갑습니다", 날짜·요일로 시작하는 인삿말, 날씨·계절 언급, 감성적 서두.

[이번 주 KOSPI 주요 흐름 (금요일 종가 포함)]
${kospiHistory}

[이번 주 KOSDAQ 주요 흐름 (금요일 종가 포함)]
${kosdaqHistory}

[AI 모델 예측 (다음 주 초 기준)]
KOSPI: ${kospiPred ?? "N/A"}, KOSDAQ: ${kosdaqPred ?? "N/A"}, S&P500: ${snp500Pred ?? "N/A"}

[미국 주요 지수 (최근 마감)]
${usIndicesBlock || "데이터 없음"}

[거시경제 지표]
${macroBlock || "데이터 없음"}

[주요 뉴스/이슈]
${newsBlock || "뉴스 데이터 없음 — 당신의 최신 지식으로 주요 이슈를 판단하세요"}

아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{
  "summary": "이번 주 증시 한 줄 요약 (20자 내외, 명사형)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "leadParagraph": "이번 주 코스피·코스닥이 어떻게 움직였는지, 주요 원인은 무엇이었는지 2문장. 수치 포함. (80~120자)",
  "storyLine": "이번 주 증시 스토리: 어떤 이슈가 시장을 움직였는지, 주요 섹터(반도체·바이오·2차전지·방산·조선) 흐름, 외국인·기관 수급 특이사항, 다음 주 어떻게 될 것 같은지. AI 예측 포함. 국내·해외 이슈 모두 언급. (350~500자) 반드시 2~3개 단락으로 나눠 작성하고 단락 사이에 \\n\\n을 삽입하세요.",
  "marketEvents": [
    { "title": "이번 주 핵심 이슈 (15자)", "impact": "이 이슈가 왜 시장에 영향을 줬는지 (60~80자)", "direction": "positive/negative/neutral" },
    { "title": "이슈2 (국내 대형주 기업)", "impact": "...", "direction": "..." },
    { "title": "이슈3 (정치·관세·규제)", "impact": "...", "direction": "..." },
    { "title": "이슈4 (글로벌·미국·중국)", "impact": "...", "direction": "..." },
    { "title": "이슈5 (반도체·SOX)", "impact": "...", "direction": "..." },
    { "title": "이슈6 (섹터: 바이오·2차전지·방산·조선 중 하나)", "impact": "...", "direction": "..." },
    { "title": "이슈7 (환율·원자재·수급)", "impact": "...", "direction": "..." }
  ],
  "macroFactors": [
    { "factor": "지표명", "status": "수치", "implication": "내 주식에 왜 중요한지 (40~60자)" },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." },
    { "factor": "...", "status": "...", "implication": "..." }
  ],
  "forwardLook": [
    { "point": "다음 주 가장 중요한 것 (15자)", "detail": "AI 예측 포함, 근거와 전망 (50~70자)", "watchFor": "꼭 봐야 할 것 (25자)" },
    { "point": "...", "detail": "...", "watchFor": "..." },
    { "point": "...", "detail": "...", "watchFor": "..." }
  ],
  "upcomingMacroEvents": [
    { "date": "구체적 날짜", "title": "다음 주 이벤트명 (20자)", "description": "쉬운 설명 (60~80자)", "impact": "high/medium/low", "direction": "positive/negative/neutral" },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." }
  ],
${keyTopicsSchema},
  "keyRisk": "다음 주 가장 조심해야 할 것 한 줄 (40~60자)",
  "recentIssues": ["이번 주 이슈 요약1", "이슈2", "이슈3", "이슈4"],
  "outlook": ["다음 주 전망1", "전망2", "전망3"]
}

작성 원칙:
- 이번 주 코스피·코스닥 수치를 구체적으로 인용하세요
- marketEvents 7개를 반드시 채우세요: 이번 주 글로벌·기업·정치·반도체·섹터·환율/수급 카테고리를 골고루 커버
- 삼성전자·SK하이닉스·현대차·LG에너지솔루션 기업 이슈와 정치·글로벌 이슈 반드시 포함
- 바이오·2차전지·방산·조선 등 테마 섹터 이슈 최소 1개 포함
- upcomingMacroEvents는 다음 주 예정 이벤트 (FOMC, CPI, 관세, 기업 실적 등) 중심으로
- '이번 주', '지난 주', '다음 주 월요일' 등 주말 맥락에 맞는 표현을 사용하세요
- AI 예측(KOSPI: ${kospiPred ?? "N/A"}, KOSDAQ: ${kosdaqPred ?? "N/A"})을 다음 주 전망에 자연스럽게 포함하세요
- impact 문장은 구체적 수치나 종목명을 넣어 실질적으로 작성
${keyTopicsRule}
- 절대 금지: 전문 용어 설명 없이 사용 금지
- 문체: 친근한 해요체`;

  const prompt = session === "morning"  ? morningPrompt
               : session === "midday"   ? middayPrompt
               : session === "weekend"  ? weekendPrompt
               :                         closingPrompt;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      maxOutputTokens: 5000,
      temperature: 0.65,
      topP: 0.92,
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
    marketEvents:         safeArr(parsed?.marketEvents).slice(0, 8),
    macroFactors:         safeArr(parsed?.macroFactors).slice(0, 6),
    forwardLook:          safeArr(parsed?.forwardLook).slice(0, 3),
    upcomingMacroEvents:  safeArr(parsed?.upcomingMacroEvents).slice(0, 6),
    keyTopics:            safeArr(parsed?.keyTopics).slice(0, 7),
    keyRisk:              parsed?.keyRisk              ?? "",
    recentIssues:         safeArr(parsed?.recentIssues).slice(0, 5),
    outlook:              safeArr(parsed?.outlook).slice(0, 4),
    generatedAt:          new Date().toISOString(),
    kospiCurrent:         kospiLatest?.close  ?? null,
    kosdaqCurrent:        kosdaqLatest?.close ?? null,
    snp500Current:        pipeline?.snp500?.currentValue ?? null,
    kospiChange:          kospiLatest?.change  ?? null,
    kosdaqChange:         kosdaqLatest?.change ?? null,
    snp500Change:         pipeline?.snp500?.predictedReturn3d ?? null,
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.get("/status", async (req, res) => {
  const status = getStatus();

  // DB에 오늘 저장된 첫 번째 예측값으로 덮어씌워 화면 예측 고정
  // (모델 재훈련·서버 재시작으로 pipeline 메모리 값이 바뀌어도 화면에는 오늘 첫 예측이 표시됨)
  try {
    const symbols = ["^KS11", "^KQ11", "^GSPC", "^IXIC"];
    const todayPreds = await getTodayPredictions(symbols);

    const overridePreds = (idx: typeof status.kospi, sym: string) => {
      if (!idx) return idx;
      const p = todayPreds[sym];
      if (!p || (p.d1 === undefined && p.d2 === undefined && p.d3 === undefined)) return idx;
      return {
        ...idx,
        ...(p.d1 !== undefined && { predictedReturn1d: p.d1 }),
        ...(p.d2 !== undefined && { predictedReturn2d: p.d2 }),
        ...(p.d3 !== undefined && { predictedReturn3d: p.d3 }),
      };
    };

    res.json({
      ...status,
      kospi:  overridePreds(status.kospi,  "^KS11"),
      kosdaq: overridePreds(status.kosdaq, "^KQ11"),
      snp500: overridePreds(status.snp500, "^GSPC"),
      nasdaq: overridePreds(status.nasdaq, "^IXIC"),
    });
  } catch (e) {
    console.error("[status] DB 예측 조회 실패 — pipeline 값 fallback:", e);
    res.json(status);
  }
});

router.post("/run", async (req, res) => {
  const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
  if (!isLocalhost && !(await requireAdmin(req, res))) return;
  const force = req.query.force === "true";
  const status = getStatus();
  if (status.running) {
    res.json({ ok: true, message: "이미 학습 중입니다" });
    return;
  }
  runPipeline(force).catch(e => console.error("[market-analysis/run]", e));
  res.json({ ok: true, message: "파이프라인 시작" });
});

// POST /api/market-analysis/update — 증분 업데이트 (최신 장마감 데이터 반영)
router.post("/update", async (req, res) => {
  const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
  if (!isLocalhost && !(await requireAdmin(req, res))) return;
  const status = getStatus();
  if (status.running) {
    res.json({ ok: true, message: "이미 학습 중입니다" });
    return;
  }
  runDailyIncrementalUpdate()
    .then(() => console.log("[market-analysis/update] 증분 완료"))
    .catch(e => console.error("[market-analysis/update]", e));
  res.json({ ok: true, message: "증분 업데이트 시작" });
});

// GET /api/market-analysis/brief — Gemini 기반 시장 브리핑 (DB 영구 캐시)
router.get("/brief", async (req, res) => {
  // 강제 갱신(force=true)은 관리자 또는 localhost 허용
  const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
  if (req.query.force === "true" && !isLocalhost && !(await requireAdmin(req, res))) return;
  const force = req.query.force === "true";

  // ① 인메모리 캐시 유효 → 즉시 반환 (~1ms)
  // sessionType은 캐시 저장 시점이 아닌 현재 시각 기준으로 오버라이드
  // (예: 장마감 캐시가 남아있어도 장전 시간대에 접근하면 "morning"으로 표시)
  if (!force && _briefCache && Date.now() - _briefCache.cachedAt < BRIEF_TTL) {
    res.json({ ...(_briefCache.data), sessionType: detectSession(), cached: true });
    return;
  }

  // ② 캐시 만료 or force → 이미 캐시가 있으면 즉시 반환 후 백그라운드 갱신
  if (!force && _briefCache) {
    // 만료된 캐시라도 즉시 반환 (사용자는 바로 볼 수 있음), sessionType은 현재 시각 기준
    res.json({ ...(_briefCache.data), sessionType: detectSession(), cached: true, stale: true });
    // 이미 갱신 중이 아닐 때만 백그라운드 재생성
    if (!_briefRefreshing) {
      _briefRefreshing = true;
      generateBrief()
        .then(result => {
          _briefCache = { data: result, cachedAt: Date.now() };
          return saveBriefToDb(_briefCache);
        })
        .catch(err => console.error("[market-brief] 백그라운드 갱신 실패:", err?.message))
        .finally(() => { _briefRefreshing = false; });
    }
    return;
  }

  // ③ 캐시 없음(첫 요청 or force) → 블로킹하지 않고 즉시 반환 후 백그라운드 생성
  if (!_briefRefreshing) {
    refreshBriefInBackground("첫요청-캐시없음");
  }
  res.json({ generating: true });
});

// GET /api/market-analysis/live-accuracy — 심볼별 실제 라이브 적중률
router.get("/live-accuracy", async (_req, res) => {
  try {
    const data = await getAllLiveAccuracy();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// GET /api/market-analysis/prediction-history/:symbol — 예측 이력
router.get("/prediction-history/:symbol", async (req, res) => {
  try {
    const symbol = decodeURIComponent(req.params.symbol);
    const limit  = Math.min(50, parseInt(String(req.query.limit ?? "20"), 10));
    const rows   = await getPredictionHistory(symbol, limit);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

export default router;
