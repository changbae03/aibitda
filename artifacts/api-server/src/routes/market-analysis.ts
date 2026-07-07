import { Router } from "express";
import { getStatus, runPipeline, runDailyIncrementalUpdate } from "../lib/lstm-predictor.js";
import { getAllLiveAccuracy, getPredictionHistory, getTodayPredictions, getAccuracyHistory } from "../lib/prediction-tracker.js";
import { fetchFREDMacro } from "../lib/fred-client.js";
import { fetchECOSMacro } from "../lib/ecos-client.js";
import { GoogleGenAI } from "@google/genai";
import YahooFinance from "yahoo-finance2";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";
import { getTrendingThemeNames } from "./themes.js";

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
const BRIEF_TTL = 4 * 3600_000;   // 4시간 (하루 2회 스케줄 기준)
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
    saveToHistory("kr", cache).catch(() => {});
  } catch (err: any) {
    console.error("[market-brief] DB 저장 실패:", err?.message);
  }
}

// ─── 히스토리 테이블 ──────────────────────────────────────────────────────────

async function ensureHistoryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_brief_history (
      id        SERIAL PRIMARY KEY,
      market    TEXT NOT NULL DEFAULT 'kr',
      session_type TEXT,
      summary   TEXT,
      sentiment TEXT,
      data      JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // 30일 이상 된 레코드 자동 삭제 (무한 누적 방지)
  await pool.query(`DELETE FROM market_brief_history WHERE generated_at < now() - INTERVAL '30 days'`);
}

async function saveToHistory(market: "kr" | "us", cache: BriefCache) {
  try {
    // 3시간 이내에 같은 market 브리핑이 이미 저장돼 있으면 스킵 (중복 방지)
    const recent = await pool.query(
      `SELECT 1 FROM market_brief_history WHERE market = $1 AND generated_at > NOW() - INTERVAL '3 hours' LIMIT 1`,
      [market],
    );
    if ((recent.rowCount ?? 0) > 0) {
      console.log(`[market-brief-history] ${market} 히스토리 저장 스킵 (3시간 쿨다운)`);
      return;
    }
    await pool.query(
      `INSERT INTO market_brief_history (market, session_type, summary, sentiment, data, generated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        market,
        cache.data.sessionType ?? null,
        cache.data.summary ?? null,
        cache.data.sentiment ?? null,
        JSON.stringify(cache.data),
        new Date(cache.cachedAt),
      ],
    );
    console.log(`[market-brief-history] ${market} 브리핑 저장 완료`);
  } catch (err: any) {
    console.error("[market-brief-history] 히스토리 저장 실패:", err?.message);
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
    await ensureHistoryTable().catch(() => {});

    // 히스토리가 비어 있으면 kv_cache 데이터로 즉시 백필 (한 번만)
    const histCount = await pool.query(`SELECT COUNT(*) FROM market_brief_history WHERE market='kr'`).catch(() => ({ rows: [{ count: "1" }] }));
    const isEmpty = parseInt(String(histCount.rows[0]?.count ?? "1"), 10) === 0;

    const r = await pool.query(
      `SELECT value, cached_at FROM kv_cache WHERE key = 'market_brief' LIMIT 1`
    );
    if (r.rows.length) {
      const cachedAt = new Date(r.rows[0].cached_at).getTime();
      const cacheData: BriefCache = { data: r.rows[0].value as MarketBriefResult, cachedAt };
      if (isEmpty) {
        saveToHistory("kr", cacheData).catch(() => {});
      }
      if (Date.now() - cachedAt < BRIEF_TTL) {
        _briefCache = cacheData;
        console.log("[market-brief] DB 캐시 복원 성공 (즉시 서빙 가능)");
      } else {
        // 만료된 캐시도 일단 복원해 두고 (유저가 즉시 볼 수 있도록) 백그라운드 갱신
        _briefCache = cacheData;
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
  sessionType: "pre_open" | "morning" | "midday" | "afternoon" | "pre_close" | "closing" | "evening" | "weekend"
            | "us_premarket" | "us_open" | "us_afterhours" | "us_overnight" | "us_weekend";
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

export async function fetchUsMarketNews(): Promise<string> {
  const queries = [
    "S&P500 stock market Wall Street",
    "Federal Reserve interest rate inflation",
    "Nvidia Apple Microsoft Google Meta Amazon Tesla earnings",
    "US economy GDP employment CPI",
    "oil price energy sector commodities",
    "US China trade tariff geopolitics",
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
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en&gl=US&ceid=US:en`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) return "";
      const xml = await res.text();
      return parseRssItems(xml, 8).join("\n");
    })
  );

  const allLines = settled.filter(r => r.status === "fulfilled").map(r => (r as any).value as string).filter(Boolean);
  const combined = allLines.join("\n");
  console.log(`[us-brief] 뉴스 수집: ${combined.split("\n").filter(l => l.startsWith("•")).length}건`);
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
 * KST 기준 세션 감지 (분 단위 정밀도) — 하루 최대 6회 브리핑
 *
 *  "pre_open"   KST 06:00~08:59  → 장전 준비: 간밤 미국 시장 + 오늘 전략
 *  "morning"    KST 09:00~10:59  → 개장 초반: 개장 수급·방향 점검
 *  "midday"     KST 11:00~12:59  → 점심 브리핑: 오전장 정리·오후 전망
 *  "afternoon"  KST 13:00~14:59  → 오후장 중반: 수급 동향·막판 전략
 *  "pre_close"  KST 15:00~15:29  → 장마감 직전: 막판 30분 대응
 *  "closing"    KST 15:30~17:59  → 당일 결산: 종가 분석·내일 준비
 *  "evening"    KST 18:00~05:59  → 야간: 미국 시장 흐름 + 내일 전략
 *  "weekend"    토/일
 */
function detectSession(): "pre_open" | "morning" | "midday" | "afternoon" | "pre_close" | "closing" | "evening" | "weekend" {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 3600_000);
  const kstDay = kstNow.getUTCDay();
  if (kstDay === 0 || kstDay === 6) return "weekend";

  const kstMin = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
  if (kstMin >=  6 * 60 && kstMin <  9 * 60) return "pre_open";
  if (kstMin >=  9 * 60 && kstMin < 11 * 60) return "morning";
  if (kstMin >= 11 * 60 && kstMin < 13 * 60) return "midday";
  if (kstMin >= 13 * 60 && kstMin < 15 * 60) return "afternoon";
  if (kstMin >= 15 * 60 && kstMin < 15 * 60 + 30) return "pre_close";
  if (kstMin >= 15 * 60 + 30 && kstMin < 18 * 60) return "closing";
  return "evening";
}

/**
 * US 세션 감지 (KST 기준)
 *   KST 17:00~22:30  → us_premarket  (ET 04:00-09:30)
 *   KST 22:30~05:00  → us_open       (ET 09:30-16:00 정규장)
 *   KST 05:00~09:00  → us_afterhours (ET 16:00-20:00)
 *   KST 09:00~17:00  → us_overnight  (ET 20:00-04:00, US 휴장)
 *   토/일             → us_weekend
 */
function detectUsSession(): "us_premarket" | "us_open" | "us_afterhours" | "us_overnight" | "us_weekend" {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 3600_000);
  const kstDay = kstNow.getUTCDay();
  if (kstDay === 0 || kstDay === 6) return "us_weekend";
  const kstMin = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
  if (kstMin >= 17 * 60 && kstMin < 22 * 60 + 30) return "us_premarket";
  if (kstMin >= 22 * 60 + 30 || kstMin < 5 * 60)  return "us_open";
  if (kstMin >= 5 * 60 && kstMin < 9 * 60)         return "us_afterhours";
  return "us_overnight";
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

  // ── 미국 시장 데이터 신선도 판단 ────────────────────────────────────────────
  // Yahoo Finance는 마지막 거래일 데이터를 반환 → 휴장일을 직접 감지해야 함
  const usDataAgeDays = snpL?.date
    ? Math.round((new Date(idx!.todayKST).getTime() - new Date(snpL.date).getTime()) / 86_400_000)
    : 0;
  // 1일: 어제 거래(화~토 KST 장전) | 2일: 금요일(월요일 장전 정상) | ≥3일: 공휴일 포함 휴장
  const usHolidayPeriod = usDataAgeDays >= 3;
  const usWeekendOnly   = usDataAgeDays === 2; // 주말만(월요일 장전)
  const usSessionLabel  = usHolidayPeriod
    ? `직전 거래일(${snpL!.date}) 미국 시장`
    : usWeekendOnly
    ? "지난 금요일 미국 시장"
    : "간밤 미국 시장";
  const usHolidayNote   = usHolidayPeriod
    ? `\n⚠️ 미국 시장 공휴일·주말 휴장 안내: 직전 거래일(${snpL!.date}) 데이터입니다. 오늘 KST ${idx!.todayKST} 기준 ${usDataAgeDays}일 경과. "간밤"이라는 표현은 절대 사용하지 마세요. 대신 "지난 ${snpL!.date} 거래일" 또는 "직전 거래일" 등 정확한 표현을 사용하세요.`
    : "";

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
    ecos?.cpiYoY   != null ? `한국 CPI ${Number(ecos.cpiYoY).toFixed(2)}% YoY`   : null,
  ].filter(Boolean).join(" | ");

  // ── 공통 JSON 스키마 (keyTopics 포함) ─────────────────────────────────────
  const keyTopicsSchema = `  "keyTopics": [
    { "keyword": "핵심 키워드 (10자)", "category": "정치 또는 기업 또는 경제 또는 글로벌 또는 산업", "description": "이 이슈가 지금 시장에 왜 중요한지 구체적으로 (40~60자)" },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." }
  ]`;

  const keyTopicsRule = `- keyTopics: 시장을 움직이는 핵심 키워드 5개 엄선 (많으면 안 됨). 글로벌·국내 기업·정치·섹터 중 가장 임팩트 큰 것만. description은 "왜 지금 주가에 영향 주는지" 40~60자로 간결하게.`;

  // ── 장전 프롬프트 ──────────────────────────────────────────────────────────
  const morningPrompt = `당신은 시장 해설가입니다. 오늘은 ${today}이고, 한국 주식시장 개장 전입니다.
${usSessionLabel}에서 무슨 일이 있었는지, 그리고 오늘 우리 시장에 어떤 영향이 올지를 쉽게 설명해 주세요.
주식을 막 시작한 사람도 이해할 수 있게, 친근한 해요체로 써주세요.
첫 문장은 반드시 시장 상황·수치·이슈로 시작하세요. 아래 표현들은 절대 금지입니다:
"안녕하세요", "여러분", "개인 투자자 여러분", "오늘도", "반갑습니다", "잘 지내고 계신가요", "좋은 아침", "안녕들 하세요", 날짜·요일로 시작하는 인삿말, 날씨·계절 언급, 감성적 서두.
${usHolidayNote}

⚠️ ${usSessionLabel} 방향 — 이 데이터를 반드시 그대로 사용하세요 (임의 변경 절대 금지):
S&P500: ${snpL ? `${snpL.close.toLocaleString()}pt, ${snpL.change != null ? (snpL.change > 0 ? `▲+${snpL.change}% 상승` : snpL.change < 0 ? `▼${snpL.change}% 하락` : "보합") : "N/A"}` : "데이터 없음"}
나스닥: ${nasdaqL ? `${nasdaqL.close.toLocaleString()}pt, ${nasdaqL.change != null ? (nasdaqL.change > 0 ? `▲+${nasdaqL.change}% 상승` : nasdaqL.change < 0 ? `▼${nasdaqL.change}% 하락` : "보합") : "N/A"}` : "데이터 없음"}
→ 미국 지수가 하락했으면 반드시 하락으로, 상승했으면 상승으로 서술하세요.

[${usSessionLabel} 주요 지수 (최신)]
${usIndicesBlock || "데이터 없음"}

[거시경제 지표]
${macroBlock || "데이터 없음"}

[최근 KOSPI 흐름 (참고)]
${kospiHistory}

[최근 KOSDAQ 흐름 (참고)]
${kosdaqHistory}

[실시간 뉴스/이슈 헤드라인]
${newsBlock || "뉴스 데이터 없음 — 당신의 최신 지식으로 주요 이슈를 판단하세요"}

아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{
  "summary": "${usSessionLabel} 한 줄 요약 (20자 내외, 명사형)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "leadParagraph": "${usSessionLabel} 전체 분위기를 2문장으로. 주요 지수 등락 수치 포함. (80~120자)",
  "storyLine": "왜 미국 시장이 그렇게 움직였는지, 어떤 이슈가 있었는지(뉴스 헤드라인 참고), 그래서 오늘 한국 시장에 어떤 영향이 예상되는지 이야기처럼. SOX·달러 움직임, 주요 섹터(반도체·바이오·2차전지·방산) 영향, 기관·외국인 수급 동향도 포함. (350~500자) 반드시 2~3개 단락으로 나눠 작성하고 단락 사이에 \\n\\n을 삽입하세요.",
  "marketEvents": [
    { "title": "${usSessionLabel.replace(/\\(.*?\\)/, '').trim()} 핵심 이슈 (15자)", "impact": "오늘 우리 시장에 왜 중요한지 쉽게 (60~80자)", "direction": "positive 또는 negative 또는 neutral" },
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
    { "point": "오늘 장 핵심 포인트 (15자)", "detail": "오늘 어떻게 될지 근거와 함께 쉽게 (50~70자)", "watchFor": "꼭 체크해야 할 것 한 가지 (25자)" },
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
  "actionPoints": ["투자자가 오늘 취해야 할 구체적 행동 지침1 (30~50자)", "행동 지침2", "행동 지침3"],
  "recentIssues": ["${usSessionLabel} 이슈 요약1", "이슈2", "이슈3", "이슈4"],
  "outlook": ["오늘 전망1", "전망2", "전망3"]
}

작성 원칙:
- ⚠️ 최우선 수칙: 프롬프트 상단 "${usSessionLabel} 방향" 블록의 S&P500·나스닥 등락을 반드시 그대로 사용하세요. 미국 지수가 하락했으면 하락으로 서술해야 합니다. 이를 어기면 심각한 사실 오보입니다.${usHolidayPeriod ? `\n- ⛔ 절대 금지: "간밤" 표현 사용. 직전 거래일(${snpL!.date})이 공휴일·주말 이전 거래일임을 명확히 표현하세요.` : ""}
- 미국 지수 수치(S&P500, 나스닥, 다우, SOX)와 달러인덱스를 구체적으로 인용하세요
- SOX(필라델피아 반도체)는 삼성전자·SK하이닉스와 직결되므로 반드시 포함하세요
- 달러 강약이 원화·수출주에 미치는 영향을 설명하세요
- marketEvents 7개를 반드시 채우세요: 글로벌·기업·정치·반도체·섹터·환율 카테고리를 골고루 커버
- 국내 기업 이슈(삼성전자·SK하이닉스·현대차·LG에너지솔루션 실적·파업·인수합병)와 정치 이슈(관세·규제)를 반드시 포함
- 바이오·2차전지·방산·조선·게임 등 테마 섹터 이슈 최소 1개 포함
- impact 문장은 구체적 수치나 종목명을 넣어 실질적으로 (예: "SOX 2.3% 상승으로 삼성전자·SK하이닉스 동반 강세 예상")
- actionPoints: 오늘 장세를 기준으로 투자자가 취할 수 있는 구체적 행동 지침 3가지 (매수·관망·리스크 헤지 등, 각 30~50자)
- ⛔ upcomingMacroEvents 금지사항: 오늘(${today}) 이전에 이미 완료된 이벤트는 절대 포함 금지. 방한·회담·발표 등이 이미 지난 사건이라면 제외하세요. 반드시 오늘 이후 예정된 이벤트만 기재하세요.
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
  "storyLine": "오늘 하루 어떤 대내외 이슈가 있었고(뉴스 헤드라인 참고), 왜 시장이 그렇게 움직였는지, 내일·이번 주에 어떻게 될 것 같은지 이야기처럼. 국내 기업·정치 이슈와 글로벌 이슈, 주요 섹터(반도체·바이오·2차전지·방산·조선) 동향, 기관·외국인·개인 수급 흐름도 언급. (350~500자) 반드시 2~3개 단락으로 나눠 작성하고 단락 사이에 \\n\\n을 삽입하세요.",
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
    { "point": "내일·이번 주 가장 중요한 것 (15자)", "detail": "근거와 함께 전망 (50~70자)", "watchFor": "꼭 봐야 할 것 (25자)" },
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
  "actionPoints": ["투자자가 내일·이번 주 취해야 할 구체적 행동 지침1 (30~50자)", "행동 지침2", "행동 지침3"],
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
- ⛔ upcomingMacroEvents 금지사항: 오늘(${today}) 이전에 이미 완료된 이벤트는 절대 포함 금지. 방한·회담·발표·방문 등이 이미 끝난 사건이라면 제외하세요. 반드시 오늘 이후 예정된 이벤트만 기재하세요.
- impact 문장은 구체적 수치나 종목명을 넣어 실질적으로 작성
- actionPoints: 오늘 장 결과를 기반으로 내일·이번 주 투자자가 취할 구체적 행동 지침 3가지 (매수·매도·관망·섹터 전환 등, 각 30~50자)
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
  "storyLine": "왜 오전에 이렇게 움직였는지(뉴스 헤드라인 참고), 국내외 어떤 이슈가 있었는지, 주요 섹터(반도체·바이오·2차전지·방산) 흐름, 기관·외국인 수급 동향, 오후에는 어떻게 될 것 같은지, 마감까지 무엇을 지켜봐야 하는지 이야기처럼. (350~500자) 반드시 2~3개 단락으로 나눠 작성하고 단락 사이에 \\n\\n을 삽입하세요.",
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
    { "point": "오후 장 핵심 포인트 (15자)", "detail": "오후 어떻게 될지 근거와 함께 (50~70자)", "watchFor": "지금 당장 봐야 할 것 (25자)" },
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
  "actionPoints": ["지금 이 시점에 투자자가 취해야 할 구체적 행동 지침1 (30~50자)", "행동 지침2", "행동 지침3"],
  "recentIssues": ["오전 이슈 요약1", "이슈2", "이슈3", "이슈4"],
  "outlook": ["오후 전망1", "전망2", "전망3"]
}

작성 원칙:
- 현재 코스피·코스닥 수치를 구체적으로 인용하세요
- marketEvents 6개를 반드시 채우세요: 글로벌·기업·정치·반도체·섹터 카테고리를 골고루 커버
- 삼성전자·SK하이닉스·현대차 등 기업 이슈, 정치 이슈 반드시 포함
- 바이오·2차전지·방산·조선 등 테마 섹터 이슈 최소 1개 포함
- '지금', '오후에', '마감 전' 등 시간감 있는 표현을 사용하세요
- impact 문장은 구체적 수치나 종목명을 넣어 실질적으로 작성
- actionPoints: 오후 장세를 기준으로 투자자가 마감 전까지 취할 구체적 행동 지침 3가지 (각 30~50자)
- ⛔ upcomingMacroEvents 금지사항: 오늘(${today}) 이전에 이미 완료된 이벤트는 절대 포함 금지. 방한·회담·발표 등이 이미 끝난 사건이라면 제외하세요. 반드시 오늘 이후 예정된 이벤트만 기재하세요.
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
  "storyLine": "이번 주 증시 스토리: 어떤 이슈가 시장을 움직였는지, 주요 섹터(반도체·바이오·2차전지·방산·조선) 흐름, 외국인·기관 수급 특이사항, 다음 주 어떻게 될 것 같은지. 국내·해외 이슈 모두 언급. (350~500자) 반드시 2~3개 단락으로 나눠 작성하고 단락 사이에 \\n\\n을 삽입하세요.",
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
    { "point": "다음 주 가장 중요한 것 (15자)", "detail": "근거와 함께 다음 주 전망 (50~70자)", "watchFor": "꼭 봐야 할 것 (25자)" },
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
  "actionPoints": ["다음 주 개장 전 투자자가 취해야 할 구체적 행동 지침1 (30~50자)", "행동 지침2", "행동 지침3"],
  "recentIssues": ["이번 주 이슈 요약1", "이슈2", "이슈3", "이슈4"],
  "outlook": ["다음 주 전망1", "전망2", "전망3"]
}

작성 원칙:
- 이번 주 코스피·코스닥 수치를 구체적으로 인용하세요
- marketEvents 7개를 반드시 채우세요: 이번 주 글로벌·기업·정치·반도체·섹터·환율/수급 카테고리를 골고루 커버
- 삼성전자·SK하이닉스·현대차·LG에너지솔루션 기업 이슈와 정치·글로벌 이슈 반드시 포함
- 바이오·2차전지·방산·조선 등 테마 섹터 이슈 최소 1개 포함
- upcomingMacroEvents는 다음 주 예정 이벤트 (FOMC, CPI, 관세, 기업 실적 등) 중심으로
- ⛔ upcomingMacroEvents 금지사항: 오늘(${today}) 이전에 이미 완료된 이벤트는 절대 포함 금지. 방한·회담·발표·방문 등이 이미 끝난 사건이라면 제외하세요. 반드시 오늘 이후 예정된 이벤트만 기재하세요.
- '이번 주', '지난 주', '다음 주 월요일' 등 주말 맥락에 맞는 표현을 사용하세요
- impact 문장은 구체적 수치나 종목명을 넣어 실질적으로 작성
- actionPoints: 주말 리뷰 기반으로 다음 주 투자자가 취할 구체적 행동 지침 3가지 (각 30~50자)
${keyTopicsRule}
- 절대 금지: 전문 용어 설명 없이 사용 금지
- 문체: 친근한 해요체`;

  const prompt = (session === "morning" || session === "pre_open")
               ? morningPrompt
               : (session === "midday" || session === "afternoon")
               ? middayPrompt
               : session === "weekend"
               ? weekendPrompt
               : closingPrompt;  // pre_close / closing / evening

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      maxOutputTokens: 2500,
      temperature: 0.65,
      topP: 0.92,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const raw = response.text ?? "";
  let parsed: any = null;
  try {
    const cleaned = raw.replace(/```json\n?|```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {}

  const safeArr = (v: any) => Array.isArray(v) ? v : [];

  return {
    summary:              parsed?.summary              ?? "한국 증시 데이터 분석 중",
    sentiment:            parsed?.sentiment            ?? "neutral",
    sessionType:          session,
    leadParagraph:        parsed?.leadParagraph        ?? "",
    storyLine:            parsed?.storyLine            ?? "",
    marketEvents:         safeArr(parsed?.marketEvents).slice(0, 5),
    macroFactors:         safeArr(parsed?.macroFactors).slice(0, 4),
    forwardLook:          safeArr(parsed?.forwardLook).slice(0, 2),
    upcomingMacroEvents:  safeArr(parsed?.upcomingMacroEvents).slice(0, 3),
    keyTopics:            safeArr(parsed?.keyTopics).slice(0, 5),
    keyRisk:              parsed?.keyRisk              ?? "",
    actionPoints:         safeArr(parsed?.actionPoints).slice(0, 2),
    recentIssues:         safeArr(parsed?.recentIssues).slice(0, 4),
    outlook:              safeArr(parsed?.outlook).slice(0, 3),
    generatedAt:          new Date().toISOString(),
    kospiCurrent:         kospiLatest?.close  ?? null,
    kosdaqCurrent:        kosdaqLatest?.close ?? null,
    snp500Current:        pipeline?.snp500?.currentValue ?? null,
    kospiChange:          kospiLatest?.change  ?? null,
    kosdaqChange:         kosdaqLatest?.change ?? null,
    snp500Change:         pipeline?.snp500?.predictedReturn3d ?? null,
  };
}

// ─── 미국 시장 브리핑 캐시 ──────────────────────────────────────────────────────

let _usBriefCache: BriefCache | null = null;
let _usBriefRefreshing = false;

async function saveUsBriefToDb(cache: BriefCache) {
  try {
    await pool.query(`
      INSERT INTO kv_cache (key, value, cached_at)
      VALUES ('market_brief_us', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $1, cached_at = $2
    `, [JSON.stringify(cache.data), new Date(cache.cachedAt)]);
    saveToHistory("us", cache).catch(() => {});
  } catch (err: any) {
    console.error("[us-brief] DB 저장 실패:", err?.message);
  }
}

async function loadUsBriefFromDb(): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT value, cached_at FROM kv_cache WHERE key = 'market_brief_us' LIMIT 1`
    );
    if (r.rows.length) {
      const cachedAt = new Date(r.rows[0].cached_at).getTime();
      _usBriefCache = { data: r.rows[0].value as MarketBriefResult, cachedAt };
      if (Date.now() - cachedAt >= BRIEF_TTL) {
        setTimeout(() => refreshUsBriefInBackground("서버시작-만료캐시"), 12000);
      }
    } else {
      setTimeout(() => refreshUsBriefInBackground("서버시작-최초생성"), 15000);
    }
  } catch (err: any) {
    console.error("[us-brief] DB 복원 실패:", err?.message);
  }
}

loadUsBriefFromDb().catch(() => {});

export function refreshUsBriefInBackground(reason = "") {
  if (_usBriefRefreshing) { console.log("[us-brief] 이미 갱신 중 — 스킵"); return; }
  _usBriefRefreshing = true;
  console.log(`[us-brief] 백그라운드 갱신 시작${reason ? ` (${reason})` : ""}`);
  generateUsBrief()
    .then(result => {
      _usBriefCache = { data: result, cachedAt: Date.now() };
      return saveUsBriefToDb(_usBriefCache);
    })
    .then(() => console.log("[us-brief] 갱신 완료"))
    .catch(err => console.error("[us-brief] 갱신 실패:", err?.message))
    .finally(() => { _usBriefRefreshing = false; });
}

async function generateUsBrief(): Promise<MarketBriefResult> {
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
  const session = detectUsSession();

  const [indexData, fredData, ecosData, pipelineStatus, newsResult] = await Promise.allSettled([
    fetchRecentIndexData(),
    fetchFREDMacro(),
    fetchECOSMacro(),
    Promise.resolve(getStatus()),
    fetchUsMarketNews(),
  ]);

  const idx      = indexData.status === "fulfilled"      ? indexData.value      : null;
  const fred     = fredData.status  === "fulfilled"      ? fredData.value       : null;
  const ecos     = ecosData.status  === "fulfilled"      ? ecosData.value       : null;
  const pipeline = pipelineStatus.status === "fulfilled" ? pipelineStatus.value : null;
  const newsBlock = newsResult.status === "fulfilled"    ? newsResult.value     : "";

  const snpL    = idx?.snp500?.at(-1) ?? null;
  const nasdaqL = idx?.nasdaq?.at(-1) ?? null;
  const dowL    = idx?.dow?.at(-1)    ?? null;
  const vixL    = idx?.vix?.at(-1)    ?? null;
  const soxL    = idx?.sox?.at(-1)    ?? null;
  const dxyL    = idx?.dxy?.at(-1)    ?? null;

  const histLine = (arr: any[] | null | undefined) =>
    arr?.map((d: any) => `${d.date} ${d.close.toLocaleString()}(${d.change != null ? (d.change >= 0 ? "+" : "") + d.change + "%" : "N/A"})`).join(", ") ?? "데이터 없음";

  const snp500History  = histLine(idx?.snp500);
  const nasdaqHistory  = histLine(idx?.nasdaq);

  const snp500Pred = pipeline?.snp500 ? `${pipeline.snp500.predictedReturn3d >= 0 ? "+" : ""}${pipeline.snp500.predictedReturn3d}%` : null;

  const fmtDir = (d: { close: number; change: number | null } | null) =>
    d ? `${d.close.toLocaleString()}pt, ${d.change != null ? (d.change > 0 ? `▲+${d.change}% 상승` : d.change < 0 ? `▼${d.change}% 하락` : "보합") : "N/A"}` : "데이터 없음";

  const usIndicesBlock = [
    snpL    ? `S&P500 ${fmtIdx(snpL)}`               : null,
    nasdaqL ? `나스닥 ${fmtIdx(nasdaqL)}`            : null,
    dowL    ? `다우존스 ${fmtIdx(dowL)}`              : null,
    soxL    ? `필라델피아반도체(SOX) ${fmtIdx(soxL)}` : null,
    vixL    ? `VIX ${vixL.close} (${vixL.close >= 25 ? "공포" : vixL.close >= 18 ? "경계" : "안정"})` : null,
    dxyL    ? `달러인덱스(DXY) ${dxyL.close}`         : null,
  ].filter(Boolean).join("\n");

  const macroBlock = [
    fred?.t10y    != null ? `US 10Y Treasury Yield ${fred.t10y.toFixed(2)}%` : null,
    fred?.t2y     != null ? `US 2Y Treasury Yield ${fred.t2y.toFixed(2)}%` : null,
    fred?.yieldSpread != null ? `Yield Curve (10Y-2Y) ${fred.yieldSpread >= 0 ? "+" : ""}${fred.yieldSpread.toFixed(2)}%p${fred.yieldSpread < 0 ? " ⚠️Inverted" : ""}` : null,
    fred?.wtiOil  != null ? `WTI Crude Oil ${fred.wtiOil.toFixed(1)} USD/bbl` : null,
    fred != null
      ? fred.fedTargetUpper != null && fred.fedTargetLower != null
        ? `Fed Funds Rate ${fred.fedTargetLower}~${fred.fedTargetUpper}%`
        : fred.fedFundsRate != null ? `Fed Funds Rate ${fred.fedFundsRate}%` : null
      : null,
    dxyL != null ? `DXY Dollar Index ${dxyL.close}` : null,
    vixL != null ? `VIX Fear Index ${vixL.close} (${vixL.close >= 25 ? "Fear" : vixL.close >= 18 ? "Caution" : "Stable"})` : null,
  ].filter(Boolean).join(" | ");

  const sessionDesc =
    session === "us_premarket"  ? "미국 증시 개장 전 (프리마켓)" :
    session === "us_open"       ? "미국 증시 정규 거래 시간" :
    session === "us_afterhours" ? "미국 증시 장 마감 후 (애프터마켓)" :
    session === "us_overnight"  ? "미국 증시 휴장 중 (한국 낮 시간)" :
                                  "미국 증시 주말 휴장";

  const prompt = `당신은 월가 최고 수준의 시장 전략가이자 해설가입니다. 오늘은 ${today}이고, 현재 ${sessionDesc}입니다.
한국 투자자들이 "이 정도 분석은 어디서도 못 봤다"고 놀랄 만큼, 깊이 있고 구체적인 미국 증시 분석을 친근한 해요체로 작성하세요.

🚨 절대 금지 (이를 어기면 이 브리핑은 완전히 실패입니다):
- 코스피, 코스닥, 한국 주식시장, 한국 기업(삼성전자, SK하이닉스, 현대차 등)에 대한 내용 일체 금지
- 이 브리핑은 순수 미국 S&P500·나스닥·다우 시장 분석이어야 합니다
- leadParagraph, storyLine, marketEvents 모두 미국 시장 내용만 기재하세요

첫 문장은 반드시 S&P500·나스닥 수치·등락률·핵심 US 이슈로 시작하세요. 아래 표현들도 절대 금지:
"안녕하세요", "여러분", "오늘도", "반갑습니다", 날짜·요일로 시작하는 인삿말, 날씨·계절 언급, 감성적 서두.

⚠️ 미국 지수 데이터 — 반드시 그대로 사용하세요 (임의 변경 절대 금지):
S&P500: ${fmtDir(snpL)}
나스닥:  ${fmtDir(nasdaqL)}
다우존스: ${fmtDir(dowL)}
VIX: ${vixL ? `${vixL.close} (${vixL.close >= 25 ? "공포 구간" : vixL.close >= 18 ? "경계 구간" : "안정 구간"})` : "데이터 없음"}
SOX(필라델피아반도체): ${soxL ? `${soxL.close.toLocaleString()}pt, ${soxL.change != null ? (soxL.change > 0 ? `▲+${soxL.change}%` : `▼${soxL.change}%`) : "N/A"}` : "데이터 없음"}
DXY(달러인덱스): ${dxyL ? `${dxyL.close}` : "데이터 없음"}

[미국 주요 지수 최근 흐름]
S&P500: ${snp500History}
나스닥: ${nasdaqHistory}

[거시경제 지표]
${macroBlock || "데이터 없음"}

[주요 뉴스/이슈]
${newsBlock || "뉴스 데이터 없음 — 당신의 최신 지식으로 판단하세요"}

아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{
  "summary": "미국 증시 한 줄 요약 (20자 내외, 명사형)",
  "sentiment": "bullish 또는 bearish 또는 neutral",
  "leadParagraph": "S&P500·나스닥이 어떻게 움직였는지, 왜 그랬는지 핵심 원인을 2문장으로. 반드시 구체적 수치 포함. (100~140자)",
  "storyLine": "월가 전문가 수준의 심층 시장 분석. 아래 5가지를 모두 포함해 3~4개 단락으로 나눠 작성하세요 (단락 사이 \\n\\n 삽입, 전체 500~700자):\\n1. [Fed·금리] 현재 연준 스탠스·점도표 전망·채권시장 반응(2년물·10년물·장단기 스프레드)이 주식에 미치는 구체적 영향\\n2. [섹터 심층] 기술주(FAANGM+엔비디아)·반도체(SOX)·에너지·금융·헬스케어·소비재 각 섹터 등락 이유와 수급 흐름\\n3. [매크로 연결] CPI·고용지표·GDP·소비자심리 등 최신 경제지표가 증시 방향에 어떻게 연결되는지\\n4. [지정학·정책] 관세·무역·지정학 리스크가 특정 섹터/종목에 미치는 영향 구체적으로\\n반드시 수치와 종목명을 풍부하게 인용하고 '왜 그런지' 인과관계를 설명하세요.",
  "marketEvents": [
    { "title": "핵심 이슈1 (15자)", "impact": "이 이슈가 왜 시장에 영향을 줬는지 구체적 수치·종목명 포함 (70~90자)", "direction": "positive/negative/neutral" },
    { "title": "Fed·통화정책 이슈 (15자)", "impact": "연준 발언·FOMC 결과·금리 경로가 시장에 미친 영향 (70~90자)", "direction": "..." },
    { "title": "빅테크·반도체 이슈 (15자)", "impact": "애플·엔비디아·MS·구글·메타·아마존 등 구체적 종목 동향 (70~90자)", "direction": "..." },
    { "title": "경제지표 이슈 (15자)", "impact": "CPI·고용·GDP·소비자심리 수치와 시장 반응 (70~90자)", "direction": "..." },
    { "title": "에너지·원자재 이슈 (15자)", "impact": "WTI·천연가스·구리 등 원자재 동향과 에너지 섹터 영향 (70~90자)", "direction": "..." },
    { "title": "지정학·관세·무역 이슈 (15자)", "impact": "미-중·중동·유럽 지정학 또는 관세 정책이 시장에 미친 파급 (70~90자)", "direction": "..." },
    { "title": "금융·채권시장 이슈 (15자)", "impact": "국채금리·달러·은행주 동향과 신용시장 흐름 (70~90자)", "direction": "..." },
    { "title": "섹터 로테이션 이슈 (15자)", "impact": "어느 섹터로 자금이 이동했고 왜 그런지 구체적으로 (70~90자)", "direction": "..." }
  ],
  "macroFactors": [
    { "factor": "미국 10년 국채금리", "status": "수치와 전주대비 변화", "implication": "주식 밸류에이션·부동산·소비에 미치는 영향을 구체적으로 (50~70자)" },
    { "factor": "장단기 금리차(10Y-2Y)", "status": "수치와 역전/정상 여부", "implication": "경기침체 신호로서 의미, 은행 수익성과의 관계 (50~70자)" },
    { "factor": "VIX 공포지수", "status": "수치와 구간", "implication": "시장 참여자들의 실제 심리와 옵션 시장이 말하는 것 (50~70자)" },
    { "factor": "달러인덱스(DXY)", "status": "수치와 방향", "implication": "신흥국·원자재·다국적기업 실적에 미치는 연쇄 영향 (50~70자)" },
    { "factor": "WTI 유가", "status": "수치와 방향", "implication": "에너지주·항공·소비재 비용구조, 인플레이션 경로에 미치는 영향 (50~70자)" },
    { "factor": "미국 기준금리", "status": "현재 수치와 다음 FOMC 전망", "implication": "기업 자금조달 비용·소비자 대출 부담·주식 할인율 영향 (50~70자)" }
  ],
  "forwardLook": [
    { "point": "핵심 주목 포인트1 (15자)", "detail": "다음 세션에서 이 지표/이슈가 어떻게 전개될지 근거와 함께 구체적으로 (60~80자)", "watchFor": "반드시 체크해야 할 수치나 레벨 (25자)" },
    { "point": "핵심 주목 포인트2 (15자)", "detail": "...", "watchFor": "..." },
    { "point": "핵심 주목 포인트3 (15자)", "detail": "...", "watchFor": "..." }
  ],
  "upcomingMacroEvents": [
    { "date": "YYYY-MM-DD 형식의 구체적 날짜", "title": "이벤트명 (20자)", "description": "이 이벤트가 왜 중요한지, 어떤 결과가 나오면 시장에 어떤 영향인지 (70~90자)", "impact": "high/medium/low", "direction": "positive/negative/neutral" },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." },
    { "date": "...", "title": "...", "description": "...", "impact": "...", "direction": "..." }
  ],
  "keyTopics": [
    { "keyword": "핵심 키워드 (10자)", "category": "정치 또는 기업 또는 경제 또는 글로벌 또는 산업", "description": "이 이슈가 지금 미국 시장에 왜 중요한지 구체적으로 (50~70자)" },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." },
    { "keyword": "...", "category": "...", "description": "..." }
  ],
  "keyRisk": "다음 세션에서 가장 조심해야 할 것 — 구체적 수치·레벨·종목 언급 (50~70자)",
  "actionPoints": ["지금 미국 시장 흐름 기반 구체적 행동 지침1: 어떤 섹터/종목을 어떻게 (40~60자)", "행동 지침2: 리스크 관리 관점에서 (40~60자)", "행동 지침3: 다음 세션 대비 (40~60자)"],
  "recentIssues": ["핵심 이슈 요약1 — 수치 포함", "이슈2", "이슈3", "이슈4"],
  "outlook": ["다음 세션 전망1 — 구체적 조건과 근거 포함", "전망2", "전망3"]
}

작성 원칙:
- ⚠️ 최우선: 위에 제공된 S&P500·나스닥·VIX·SOX 수치를 반드시 그대로 사용하세요
- S&P500·나스닥·다우·SOX 수치를 모두 구체적으로 인용하세요
- 빅테크 7종목(애플·엔비디아·MS·구글·아마존·메타·테슬라) 동향을 반드시 포함하세요
- 섹터별 등락 원인을 "왜 올랐는지/내렸는지"의 인과관계로 설명하세요
- Fed 스탠스·채권시장·달러가 주식에 연결되는 메커니즘을 구체적으로 설명하세요
- VIX 수준이 투자자 심리와 옵션 시장에서 무엇을 의미하는지 구체적으로 설명하세요
- 경제지표(CPI·고용·소비자심리 등)와 증시 방향의 인과관계를 명확히 서술하세요
- ⛔ upcomingMacroEvents 금지사항: 오늘(${today}) 이전에 이미 완료된 이벤트는 절대 포함 금지. 반드시 오늘 이후 예정된 이벤트만 기재하세요.
- actionPoints: 현재 시장 상황에 맞는 실질적이고 구체적인 투자 행동 지침 3가지
- 문체: 친근한 해요체, 전문성과 깊이를 갖추되 쉽게 읽히게
- 절대 금지: 전문 용어 설명 없이 사용, AI 모델 예측 언급`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      maxOutputTokens: 2500,
      temperature: 0.65,
      topP: 0.92,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const raw = response.text ?? "";
  let parsed: any = null;
  try {
    const cleaned = raw.replace(/```json\n?|```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else console.warn("[us-brief] JSON 블록 없음 — raw 응답:", raw.slice(0, 300));
  } catch (e: any) {
    console.warn("[us-brief] JSON 파싱 실패:", e?.message, "raw:", raw.slice(0, 300));
  }

  // 한국 시장 콘텐츠 오염 감지 — macroFactors를 데이터 기반으로 재구성
  if (parsed) {
    const krMacroKeywords = ["코스피", "코스닥", "한국 CPI", "원달러환율", "한국은행"];
    const macroStr = JSON.stringify(parsed.macroFactors ?? []);
    const hasMacroKr = krMacroKeywords.some(k => macroStr.includes(k));
    if (hasMacroKr) {
      console.warn("[us-brief] ⚠️ macroFactors 오염 감지 — 데이터 기반으로 재구성");
      parsed.macroFactors = [
        fred?.t10y    != null ? { factor: "미국 10년 국채금리", status: `${fred.t10y.toFixed(2)}%`, implication: "장기 국채금리 상승은 주식 할인율을 높여 성장주·기술주에 하방 압력" } : null,
        fred?.yieldSpread != null ? { factor: "장단기 금리차(10Y-2Y)", status: `${fred.yieldSpread >= 0 ? "+" : ""}${fred.yieldSpread.toFixed(2)}%p${fred.yieldSpread < 0 ? " (역전)" : ""}`, implication: "역전 지속 시 경기침체 선행 신호, 은행 수익성에 구조적 압박" } : null,
        vixL != null ? { factor: "VIX 공포지수", status: `${vixL.close} (${vixL.close >= 25 ? "공포" : vixL.close >= 18 ? "경계" : "안정"})`, implication: "옵션 시장이 반영하는 단기 변동성 기대치 — 25 이상 패닉, 18 이하 낙관" } : null,
        dxyL != null ? { factor: "달러인덱스(DXY)", status: `${dxyL.close}`, implication: "달러 강세는 신흥국 자금 이탈·원자재 하락·미국 다국적기업 해외 실적에 부정적" } : null,
        fred?.wtiOil != null ? { factor: "WTI 유가", status: `${fred.wtiOil.toFixed(1)} USD/bbl`, implication: "에너지 비용 상승은 기업 마진 압박·인플레이션 고착화로 Fed 긴축 장기화 우려" } : null,
        fred != null ? {
          factor: "미국 기준금리",
          status: fred.fedTargetUpper != null ? `${fred.fedTargetLower}~${fred.fedTargetUpper}%` : fred.fedFundsRate != null ? `${fred.fedFundsRate}%` : "데이터 없음",
          implication: "기업 자금조달 비용·소비자 모기지·주식 할인율에 복합적 영향"
        } : null,
      ].filter(Boolean);
    }
  }

  const safeArr = (v: any) => Array.isArray(v) ? v : [];

  return {
    summary:             parsed?.summary             ?? "미국 증시 데이터 분석 중",
    sentiment:           parsed?.sentiment           ?? "neutral",
    sessionType:         session,
    leadParagraph:       parsed?.leadParagraph       ?? "",
    storyLine:           parsed?.storyLine           ?? "",
    marketEvents:        safeArr(parsed?.marketEvents).slice(0, 5),
    macroFactors:        safeArr(parsed?.macroFactors).slice(0, 4),
    forwardLook:         safeArr(parsed?.forwardLook).slice(0, 2),
    upcomingMacroEvents: safeArr(parsed?.upcomingMacroEvents).slice(0, 3),
    keyTopics:           safeArr(parsed?.keyTopics).slice(0, 5),
    keyRisk:             parsed?.keyRisk             ?? "",
    actionPoints:        safeArr(parsed?.actionPoints).slice(0, 2),
    recentIssues:        safeArr(parsed?.recentIssues).slice(0, 4),
    outlook:             safeArr(parsed?.outlook).slice(0, 3),
    generatedAt:         new Date().toISOString(),
    kospiCurrent:        null,
    kosdaqCurrent:       null,
    snp500Current:       snpL?.close ?? null,
    kospiChange:         null,
    kosdaqChange:        null,
    snp500Change:        snpL?.change ?? null,
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
// ?market=us → 미국 시장 브리핑, 기본값 한국 시장
router.get("/brief", async (req, res) => {
  const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
  if (req.query.force === "true" && !isLocalhost && !(await requireAdmin(req, res))) return;
  const force  = req.query.force  === "true";
  const market = req.query.market === "us" ? "us" : "kr";

  // ── 미국 시장 브리핑 ────────────────────────────────────────────────────────
  if (market === "us") {
    if (!force && _usBriefCache && Date.now() - _usBriefCache.cachedAt < BRIEF_TTL) {
      res.json({ ...(_usBriefCache.data), sessionType: detectUsSession(), cached: true });
      return;
    }
    if (!force && _usBriefCache) {
      res.json({ ...(_usBriefCache.data), sessionType: detectUsSession(), cached: true, stale: true });
      if (!_usBriefRefreshing) refreshUsBriefInBackground("만료캐시-백그라운드");
      return;
    }
    if (!_usBriefRefreshing) refreshUsBriefInBackground("첫요청-캐시없음");
    // 메모리 캐시 없을 때 DB 직접 조회 폴백 (3초 타임아웃)
    try {
      const timeout = new Promise<null>((_, rej) => setTimeout(() => rej(new Error("db-timeout")), 3000));
      const dbRow = await Promise.race([
        pool.query(`SELECT value, cached_at FROM kv_cache WHERE key = 'market_brief_us' LIMIT 1`),
        timeout,
      ]) as any;
      if (dbRow?.rows?.length) {
        const data = dbRow.rows[0].value as any;
        res.json({ ...data, sessionType: detectUsSession(), cached: true, stale: true, fromDb: true });
        return;
      }
    } catch { /* DB 조회 실패/타임아웃 → 즉시 generating 반환 */ }
    res.json({ generating: true });
    return;
  }

  // ── 한국 시장 브리핑 ─────────────────────────────────────────────────────────
  // ① 인메모리 캐시 유효 → 즉시 반환 (~1ms)
  // sessionType은 캐시 저장 시점이 아닌 현재 시각 기준으로 오버라이드
  if (!force && _briefCache && Date.now() - _briefCache.cachedAt < BRIEF_TTL) {
    res.json({ ...(_briefCache.data), sessionType: detectSession(), cached: true });
    return;
  }

  // ② 캐시 만료 or force → 이미 캐시가 있으면 즉시 반환 후 백그라운드 갱신
  if (!force && _briefCache) {
    res.json({ ...(_briefCache.data), sessionType: detectSession(), cached: true, stale: true });
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

  // ③ 캐시 없음(첫 요청 or force) — DB 직접 조회 폴백 (3초 타임아웃)
  if (!_briefRefreshing) refreshBriefInBackground("첫요청-캐시없음");
  try {
    const timeout = new Promise<null>((_, rej) => setTimeout(() => rej(new Error("db-timeout")), 3000));
    const dbRow = await Promise.race([
      pool.query(`SELECT value, cached_at FROM kv_cache WHERE key = 'market_brief' LIMIT 1`),
      timeout,
    ]) as any;
    if (dbRow?.rows?.length) {
      const data = dbRow.rows[0].value as any;
      res.json({ ...data, sessionType: detectSession(), cached: true, stale: true, fromDb: true });
      return;
    }
  } catch { /* DB 조회 실패/타임아웃 → 즉시 generating 반환 */ }
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

// GET /api/market-analysis/brief-history — 시장 브리핑 히스토리
router.get("/brief-history", async (req, res) => {
  try {
    const market = String(req.query.market ?? "kr").toLowerCase() as "kr" | "us";
    const limit  = Math.min(30, Math.max(1, parseInt(String(req.query.limit ?? "10"), 10)));
    const rows   = await pool.query(
      `SELECT id, market, session_type, summary, sentiment, data, generated_at
       FROM market_brief_history
       WHERE market = $1
       ORDER BY generated_at DESC
       LIMIT $2`,
      [market, limit],
    );
    res.json(rows.rows.map(r => ({
      id:           r.id,
      market:       r.market,
      sessionType:  r.session_type,
      summary:      r.summary,
      sentiment:    r.sentiment,
      data:         r.data,
      generatedAt:  r.generated_at,
    })));
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// GET /api/market-analysis/accuracy-history — KOSDAQ/KOSPI 주별 분리 적중률 히스토리
router.get("/accuracy-history", async (req, res) => {
  try {
    const weeks = Math.min(16, Math.max(4, parseInt(String(req.query.weeks ?? "8"), 10)));
    const data  = await getAccuracyHistory(weeks);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ─── 장중 실시간 이슈 코멘트 ─────────────────────────────────────────────────
interface IntradayCommentResult {
  comments: {
    id: string;
    comment: string;
    urgency: "high" | "medium" | "low";
    watchFor: string;
  }[];
  generatedAt: string;
}

const _intradayCache = new Map<string, { data: IntradayCommentResult; cachedAt: number }>();
const INTRADAY_TTL = 20 * 60_000; // 20분

// POST /api/market-analysis/intraday-comment
// Body: { items: { id: string; text: string; date: string }[] }
router.post("/intraday-comment", async (req, res) => {
  try {
    const items: { id: string; text: string; date: string }[] = req.body?.items ?? [];
    if (!items.length) { res.json({ comments: [], generatedAt: new Date().toISOString() }); return; }

    const cacheKey = items.map(i => i.id).sort().join(",");
    const cached = _intradayCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < INTRADAY_TTL) {
      res.json(cached.data);
      return;
    }

    const newsLines = items
      .slice(0, 8)
      .map((it, i) => `[${i + 1}] (${it.date}) ${it.text.slice(0, 300)}`)
      .join("\n");

    const prompt = `당신은 한국 주식 시장 전문 애널리스트입니다. 지금은 장중입니다.
아래는 방금 들어온 실시간 시장 뉴스 헤드라인입니다. 각 뉴스에 대해 장중 투자자가 즉시 활용할 수 있는 짧고 명확한 코멘트를 작성하세요.

뉴스 목록:
${newsLines}

각 뉴스에 대해 JSON 배열로 답하세요. urgency는 "high"(즉각 대응 필요), "medium"(주의 관찰), "low"(참고용) 중 하나.
형식:
[
  {
    "id": "뉴스 번호(1부터)",
    "comment": "장중 대응 코멘트 (2-3문장, 한국어, 쉬운 표현)",
    "urgency": "high|medium|low",
    "watchFor": "주목할 종목/섹터/지표 (20자 이내)"
  }
]
JSON만 출력하세요.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    });

    const raw = response.text ?? "[]";
    let parsed: any[] = [];
    try { parsed = JSON.parse(raw.replace(/```json\n?|```/g, "").trim()); } catch { parsed = []; }

    const comments = items.slice(0, 8).map((item, i) => {
      const match = parsed.find((p: any) => String(p.id) === String(i + 1)) ?? parsed[i];
      return {
        id: item.id,
        comment: match?.comment ?? "분석 중입니다.",
        urgency: (match?.urgency ?? "low") as "high" | "medium" | "low",
        watchFor: match?.watchFor ?? "",
      };
    });

    const result: IntradayCommentResult = { comments, generatedAt: new Date().toISOString() };
    _intradayCache.set(cacheKey, { data: result, cachedAt: Date.now() });
    res.json(result);
  } catch (e: any) {
    console.error("[intraday-comment] 오류:", e?.message);
    res.status(500).json({ error: e?.message });
  }
});

// GET /api/market-analysis/trending-keywords
// 현재 시장 브리프의 keyTopics + 트렌딩 테마명을 합쳐 실시간 추천 키워드 반환
router.get("/trending-keywords", (_req, res) => {
  try {
    const keywords: string[] = [];

    // 한국 브리프 keyTopics
    if (_briefCache?.data?.keyTopics) {
      for (const t of _briefCache.data.keyTopics) {
        if (t.keyword && !keywords.includes(t.keyword)) keywords.push(t.keyword);
      }
    }

    // 미국 브리프 keyTopics
    if (_usBriefCache?.data?.keyTopics) {
      for (const t of _usBriefCache.data.keyTopics) {
        if (t.keyword && !keywords.includes(t.keyword)) keywords.push(t.keyword);
      }
    }

    // 트렌딩 테마명 (최대 5개 추가)
    const themeNames = getTrendingThemeNames().slice(0, 5);
    for (const name of themeNames) {
      if (!keywords.includes(name)) keywords.push(name);
    }

    // 최대 12개, 없으면 폴백
    const FALLBACK = ["이란", "미중갈등", "연준 금리", "반도체", "트럼프 관세", "우크라이나", "엔비디아", "삼성전자", "원/달러", "OPEC"];
    const result = keywords.length >= 4 ? keywords.slice(0, 12) : FALLBACK;

    res.json({ keywords: result, fromCache: !!((_briefCache || _usBriefCache)) });
  } catch (e) {
    res.json({ keywords: ["이란", "미중갈등", "연준 금리", "반도체", "트럼프 관세", "우크라이나", "엔비디아", "삼성전자", "원/달러", "OPEC"], fromCache: false });
  }
});

export default router;
