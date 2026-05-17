/**
 * portfolio.ts — 사용자 포트폴리오 CRUD + 요약 데이터
 *
 * GET    /api/portfolio          — 보유 종목 목록 (현재가 + 최신 분석 포함)
 * POST   /api/portfolio          — 종목 추가
 * PUT    /api/portfolio/:id      — 종목 수정 (수량/평단가/메모)
 * DELETE /api/portfolio/:id      — 종목 삭제
 */

import { Router } from "express";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";
import YahooFinance from "yahoo-finance2";
import { GoogleGenAI } from "@google/genai";

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

const router = Router();

// ── 테이블 마이그레이션 ──────────────────────────────────────────────────────
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_holdings (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      company_name TEXT NOT NULL DEFAULT '',
      avg_price   NUMERIC,
      quantity    NUMERIC,
      currency    TEXT NOT NULL DEFAULT 'KRW',
      note        TEXT,
      added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, ticker)
    )
  `);
}

// ── 현재가 조회 (Yahoo Finance) ─────────────────────────────────────────────
async function fetchPrice(ticker: string): Promise<{ price: number | null; currency: string; change1d: number | null }> {
  try {
    // 한국 종목: 6자리 숫자 → ".KS" suffix
    const yticker = /^\d{5,6}$/.test(ticker) ? `${ticker}.KS` : ticker;
    const q = await (YahooFinance as any).quote(yticker, { fields: ["regularMarketPrice", "currency", "regularMarketChangePercent"] });
    return {
      price: q?.regularMarketPrice ?? null,
      currency: q?.currency ?? (yticker.endsWith(".KS") ? "KRW" : "USD"),
      change1d: q?.regularMarketChangePercent ?? null,
    };
  } catch {
    return { price: null, currency: "KRW", change1d: null };
  }
}

// ── 최신 분석 조회 (현재 유저 본인 분석만) ────────────────────────────────────
async function fetchLatestAnalysis(ticker: string, userId: string) {
  const { rows } = await pool.query(`
    SELECT id, target_price, entry_price, stop_loss, investment_verdict,
           qa_score, created_at, risk_reward_ratio, industry,
           (SELECT content FROM analysis_steps
            WHERE analysis_id = analyses.id AND step_key = 'key_catalysts'
            LIMIT 1) AS catalysts,
           (SELECT content FROM analysis_steps
            WHERE analysis_id = analyses.id AND step_key = 'risk_factors'
            LIMIT 1) AS risks,
           (SELECT content FROM analysis_steps
            WHERE analysis_id = analyses.id AND step_key = 'investment_strategy'
            LIMIT 1) AS strategy
    FROM analyses
    WHERE ticker = $1 AND user_id = $2 AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  `, [ticker, userId]);
  return rows[0] ?? null;
}

// ── 집단지성 분석 조회 (모든 유저, 최신 완성 분석 우선) ───────────────────────
async function fetchBestAnalysis(ticker: string) {
  const { rows } = await pool.query(`
    SELECT id, target_price, investment_verdict, risk_reward_ratio, industry,
           company_name,
           (SELECT content FROM analysis_steps
            WHERE analysis_id = analyses.id AND step_key = 'key_catalysts'
            LIMIT 1) AS catalysts,
           (SELECT content FROM analysis_steps
            WHERE analysis_id = analyses.id AND step_key = 'risk_factors'
            LIMIT 1) AS risks,
           (SELECT content FROM analysis_steps
            WHERE analysis_id = analyses.id AND step_key = 'investment_strategy'
            LIMIT 1) AS strategy
    FROM analyses
    WHERE ticker = $1 AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  `, [ticker]);
  return rows[0] ?? null;
}

// ── system_cache 헬퍼 ──────────────────────────────────────────────────────────
async function getCache<T>(key: string): Promise<{ data: T; savedAt: string } | null> {
  try {
    const r = await pool.query(
      `SELECT data, expires_at FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
      [key]
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0].data as any;
    return { data: row.payload as T, savedAt: row.savedAt };
  } catch { return null; }
}

async function setCache(key: string, payload: unknown, ttlMs: number, savedAt: string) {
  try {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify({ payload, savedAt }), expiresAt]
    );
  } catch (e: any) {
    console.error("[diagnose-cache] save error:", e?.message);
  }
}

// ── GET /api/portfolio ────────────────────────────────────────────────────────
router.get("/portfolio", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  await ensureTable();

  const { rows } = await pool.query(
    `SELECT id, ticker, company_name, avg_price, quantity, currency, note, added_at
     FROM portfolio_holdings
     WHERE user_id = $1
     ORDER BY added_at DESC`,
    [userId]
  );

  // 현재가 + 최신 분석을 병렬로 조회
  const enriched = await Promise.all(rows.map(async (row) => {
    const [priceData, analysis] = await Promise.all([
      fetchPrice(row.ticker),
      fetchLatestAnalysis(row.ticker, userId),
    ]);

    const currentPrice = priceData.price;
    const avgPrice = row.avg_price ? parseFloat(row.avg_price) : null;
    const targetPrice = analysis?.target_price ? parseFloat(analysis.target_price) : null;

    // 수익률 계산
    const returnPct = (currentPrice && avgPrice)
      ? ((currentPrice - avgPrice) / avgPrice) * 100
      : null;

    // 목표가 대비 상승여력
    const upsidePct = (currentPrice && targetPrice)
      ? ((targetPrice - currentPrice) / currentPrice) * 100
      : null;

    return {
      id: row.id,
      ticker: row.ticker,
      companyName: row.company_name,
      avgPrice,
      quantity: row.quantity ? parseFloat(row.quantity) : null,
      currency: row.currency,
      note: row.note,
      addedAt: row.added_at,
      // 현재가
      currentPrice,
      change1d: priceData.change1d,
      priceCurrency: priceData.currency,
      // 수익률
      returnPct,
      // 최신 분석
      analysis: analysis ? {
        id: analysis.id,
        targetPrice,
        entryPrice: analysis.entry_price ? parseFloat(analysis.entry_price) : null,
        stopLoss: analysis.stop_loss ? parseFloat(analysis.stop_loss) : null,
        verdict: analysis.investment_verdict,
        qaScore: analysis.qa_score,
        createdAt: analysis.created_at,
        riskRewardRatio: analysis.risk_reward_ratio ? parseFloat(analysis.risk_reward_ratio) : null,
        upsidePct,
        catalysts: analysis.catalysts ?? null,
        risks: analysis.risks ?? null,
        strategy: analysis.strategy ?? null,
        industry: analysis.industry ?? null,
      } : null,
    };
  }));

  res.json({ holdings: enriched });
});

// ── POST /api/portfolio — 종목 추가 ─────────────────────────────────────────
router.post("/portfolio", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  await ensureTable();

  const { ticker, companyName, avgPrice, quantity, currency, note } = req.body as {
    ticker?: string; companyName?: string;
    avgPrice?: number; quantity?: number;
    currency?: string; note?: string;
  };

  if (!ticker) { res.status(400).json({ error: "ticker는 필수입니다" }); return; }

  const cleanTicker = String(ticker).trim().toUpperCase();
  const cleanName = String(companyName ?? cleanTicker).trim();
  const cleanCurrency = String(currency ?? "KRW").trim();

  try {
    const { rows } = await pool.query(`
      INSERT INTO portfolio_holdings (user_id, ticker, company_name, avg_price, quantity, currency, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, ticker) DO UPDATE
        SET company_name = EXCLUDED.company_name,
            avg_price    = COALESCE(EXCLUDED.avg_price, portfolio_holdings.avg_price),
            quantity     = COALESCE(EXCLUDED.quantity, portfolio_holdings.quantity),
            currency     = EXCLUDED.currency,
            note         = COALESCE(EXCLUDED.note, portfolio_holdings.note)
      RETURNING id
    `, [userId, cleanTicker, cleanName, avgPrice ?? null, quantity ?? null, cleanCurrency, note ?? null]);

    res.json({ ok: true, id: rows[0].id });
  } catch (e: any) {
    res.status(500).json({ error: "종목 추가 실패", detail: e?.message });
  }
});

// ── PUT /api/portfolio/:id — 종목 수정 ───────────────────────────────────────
router.put("/portfolio/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const { avgPrice, quantity, note } = req.body as { avgPrice?: number; quantity?: number; note?: string };

  await pool.query(`
    UPDATE portfolio_holdings
    SET avg_price = COALESCE($1, avg_price),
        quantity  = COALESCE($2, quantity),
        note      = $3
    WHERE id = $4 AND user_id = $5
  `, [avgPrice ?? null, quantity ?? null, note ?? null, id, userId]);

  res.json({ ok: true });
});

// ── GET /api/portfolio/diagnose — 캐시된 진단 조회 ───────────────────────────
router.get("/portfolio/diagnose", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  const cached = await getCache<any>(`portfolio_diagnosis:${userId}`);
  if (cached) {
    res.json({ ...cached.data, savedAt: cached.savedAt, fromCache: true });
  } else {
    res.json({ fromCache: false, sections: null });
  }
});

// ── POST /api/portfolio/diagnose — AI 포트폴리오 진단 (집단지성 + 캐시) ────────
router.post("/portfolio/diagnose", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  await ensureTable();

  // 보유 종목 수집
  const { rows: holdings } = await pool.query(
    `SELECT ticker, company_name, avg_price, quantity, currency FROM portfolio_holdings WHERE user_id = $1`,
    [userId]
  );
  if (holdings.length === 0) {
    res.json({ error: "보유 종목이 없습니다" }); return;
  }

  // 집단지성: 모든 유저의 최신 완성 분석 중 가장 최근 것 사용
  const analyses = await Promise.all(holdings.map((h: any) => fetchBestAnalysis(h.ticker)));

  // 진단용 데이터 요약
  const portfolioLines = holdings.map((h: any, i: number) => {
    const a = analyses[i];
    const verdict  = a?.investment_verdict ?? "미분석";
    const target   = a?.target_price ? `목표가 ${parseFloat(a.target_price).toLocaleString()}` : "목표가없음";
    const industry = a?.industry ?? "업종미상";
    const rr       = a?.risk_reward_ratio ? `리스크/리워드 1:${parseFloat(a.risk_reward_ratio).toFixed(1)}` : "";
    return `- ${h.company_name}(${h.ticker}) | ${industry} | AI판정:${verdict} | ${target} | ${rr}`.trim();
  }).join("\n");

  // 섹터 목록 (중복 제거)
  const sectors = [...new Set(analyses.map((a: any) => a?.industry).filter(Boolean))] as string[];

  const buyCount  = analyses.filter((a: any) => a?.investment_verdict?.toLowerCase().includes("buy")).length;
  const sellCount = analyses.filter((a: any) => a?.investment_verdict?.toLowerCase().includes("sell")).length;
  const holdCount = analyses.filter((a: any) => a?.investment_verdict === "Hold").length;

  const prompt = `당신은 전문 포트폴리오 매니저입니다. 아래 포트폴리오를 종합 분석하고 한국어로 진단해주세요.

[포트폴리오 현황 — ${holdings.length}종목]
${portfolioLines}

[AI 판정 분포] 매수 ${buyCount}종목 / 홀드 ${holdCount}종목 / 매도 ${sellCount}종목
[보유 섹터] ${sectors.join(", ") || "정보없음"}

다음 5가지 항목을 각각 2-3문장으로 작성하세요. 마크다운 볼드(**) 사용 금지. 각 항목은 정확히 아래 헤더로 구분하세요:

[종합진단]
전체 포트폴리오의 건강 상태와 균형 평가. 강점과 약점 요약.

[리스크 집중도]
업종·테마 쏠림, 상관관계 높은 종목 군집, 단일 종목 의존도 등 리스크 요인 분석.

[기회 요인]
현재 포트폴리오에서 가장 주목할 종목과 그 이유. 상승여력이 높거나 AI 판정이 긍정적인 종목 중심.

[실행 권고]
지금 당장 할 수 있는 1-2가지 구체적 행동 제안. 비중 축소/확대 또는 익절/손절 포함 가능.

[섹터 보완]
현재 포트폴리오에 빠진 섹터 또는 분산 효과를 높일 수 있는 보완 투자 방향 1-2가지 제안. 구체적인 섹터명이나 업종을 명시하세요.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 1000 },
    });
    const text = response.text?.trim() ?? "";

    function extractSection(raw: string, key: string): string {
      const match = raw.match(new RegExp(`\\[${key}\\]([\\s\\S]*?)(?=\\[|$)`));
      return match ? match[1].trim() : "";
    }

    const savedAt = new Date().toISOString();
    const result = {
      sections: {
        overall:     extractSection(text, "종합진단"),
        risk:        extractSection(text, "리스크 집중도"),
        opportunity: extractSection(text, "기회 요인"),
        action:      extractSection(text, "실행 권고"),
        recommend:   extractSection(text, "섹터 보완"),
      },
      stats: { total: holdings.length, buyCount, holdCount, sellCount },
      savedAt,
      fromCache: false,
    };

    // 6시간 캐시 저장
    await setCache(`portfolio_diagnosis:${userId}`, result, 6 * 60 * 60 * 1000, savedAt);

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: "AI 진단 실패", detail: e?.message });
  }
});

// ── 브리핑 테이블 보장 ───────────────────────────────────────────────────────
async function ensureBriefTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_stock_briefs (
      id          SERIAL PRIMARY KEY,
      ticker      TEXT NOT NULL,
      brief_date  DATE NOT NULL DEFAULT CURRENT_DATE,
      summary     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (ticker, brief_date)
    )
  `);
  // 기존 테이블에 컬럼이 없을 경우 추가
  await pool.query(`ALTER TABLE portfolio_stock_briefs ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'ai'`);
  await pool.query(`ALTER TABLE portfolio_stock_briefs ADD COLUMN IF NOT EXISTS analysis_id INTEGER`);
}

// ── 핵심 헬퍼: 종목 브리핑 생성 (분석 DB 우선 → Gemini 폴백) ────────────────
/**
 * 1순위: analyses + analysis_steps DB에서 최신 내용을 추출해 Gemini로 요약
 *        (어떤 유저가 생성했든 최신 분석을 공유 — "집단지성")
 * 2순위: 분석 없을 때만 일반 Gemini 프롬프트 사용
 */
/** analysis_steps content가 JSON일 수 있으므로 파싱 후 읽기 좋은 텍스트로 변환 */
function resolveStepText(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === "object") {
        for (const key of ["summary", "description", "content", "text", "analysis"]) {
          if (typeof obj[key] === "string" && obj[key].length > 20) return obj[key];
        }
        const parts = Object.values(obj)
          .filter((v): v is string => typeof v === "string" && v.length > 20)
          .join("\n");
        if (parts) return parts;
      }
    } catch { /* fall through */ }
  }
  return s;
}

/** 긴 텍스트에서 앞 N문장만 추출 */
function extractSentences(raw: string, n = 2): string {
  if (!raw) return "";
  const text = resolveStepText(raw);
  // 마크다운 헤더/볼드 제거
  const clean = text.replace(/#{1,4}\s+[^\n]+\n?/g, "").replace(/\*\*/g, "").trim();
  // 줄바꿈 기준으로 먼저 단락을 나누고, 이후 문장 부호 기준으로 자름
  const sentences = clean
    .split(/(?<=[.!?。])\s+|[\n]{2,}/)
    .map(s => s.replace(/\n/g, " ").trim())
    .filter(s => s.length > 10);
  return sentences.slice(0, n).join(" ");
}

async function buildBriefSummary(ticker: string): Promise<{
  summary: string;
  source: "analysis" | "ai";
  analysisId?: number;
  analysisDate?: string;
  contributorCount?: number;
}> {
  const today = new Date().toISOString().slice(0, 10);

  // 집단지성: 기간 제한 없이 가장 최신 완성 분석 (어떤 유저든)
  const { rows: aRows } = await pool.query(`
    SELECT a.id, a.company_name, a.industry, a.investment_verdict, a.target_price,
      a.created_at,
      (SELECT content FROM analysis_steps WHERE analysis_id = a.id AND step_key = 'key_catalysts'       LIMIT 1) AS catalysts,
      (SELECT content FROM analysis_steps WHERE analysis_id = a.id AND step_key = 'risk_factors'        LIMIT 1) AS risks,
      (SELECT content FROM analysis_steps WHERE analysis_id = a.id AND step_key = 'investment_strategy' LIMIT 1) AS strategy
    FROM analyses a
    WHERE a.ticker = $1 AND a.status = 'completed'
    ORDER BY a.created_at DESC
    LIMIT 1
  `, [ticker]);

  // 집단지성: 이 종목을 분석한 총 기여자 수 (최근 90일)
  const { rows: contribRows } = await pool.query(`
    SELECT COUNT(DISTINCT user_id) AS contributor_count
    FROM analyses
    WHERE ticker = $1 AND status = 'completed'
      AND created_at >= NOW() - INTERVAL '90 days'
  `, [ticker]);
  const contributorCount = Number(contribRows[0]?.contributor_count ?? 0);

  const analysis = aRows[0];

  // ── 경로 A: 분석 DB 직접 추출 — Gemini 호출 없음 ─────────────────────────
  if (analysis?.catalysts || analysis?.risks || analysis?.strategy) {
    const verdict     = analysis.investment_verdict ?? "미분석";
    const targetPrice = analysis.target_price
      ? ` (목표주가 ${Number(analysis.target_price).toLocaleString()}원)`
      : "";

    // investment_strategy → 오늘의 핵심
    const core = extractSentences(analysis.strategy ?? "", 2)
      || `AI 판정: ${verdict}${targetPrice}`;

    // risk_factors → 리스크
    const risk = extractSentences(analysis.risks ?? "", 2)
      || "현재 등록된 리스크 정보가 없습니다.";

    // key_catalysts → 투자 아이디어
    const catalyst = extractSentences(analysis.catalysts ?? "", 3)
      || "현재 등록된 투자 아이디어 정보가 없습니다.";

    const analysisDate = (analysis.created_at as Date).toISOString().slice(0, 10);
    const summary = `[오늘의핵심]\n${core}\n\n[리스크]\n${risk}\n\n[투자아이디어]\n${catalyst}`;
    console.log(`[portfolio-brief] ${ticker} — 집단지성 분석 DB 추출 (analysis #${analysis.id}, 기여자 ${contributorCount}명, Gemini 미사용)`);
    return { summary, source: "analysis", analysisId: analysis.id, analysisDate, contributorCount };
  }

  // ── 경로 B: 분석 없을 때만 Gemini 호출 ────────────────────────────────────
  const { rows: info } = await pool.query(
    `SELECT company_name, industry, investment_verdict FROM analyses
     WHERE ticker=$1 AND status='completed' ORDER BY created_at DESC LIMIT 1`,
    [ticker]
  );
  const companyName = info[0]?.company_name ?? ticker;
  const industry    = info[0]?.industry ?? "업종미상";
  const verdict     = info[0]?.investment_verdict ?? "미분석";

  const prompt = `당신은 한국 주식 시장 전문 애널리스트입니다. ${today} 기준으로 ${companyName}(${ticker}, ${industry})에 대한 오늘의 투자 브리핑을 작성하세요.
최근 AI 판정: ${verdict}

규칙:
- 각 섹션을 2-3문장으로 작성. 구체적 수치·일정·이벤트를 반드시 포함.
- 마크다운 볼드(**), 번호매기기 금지.
- 정확히 아래 헤더 3개만 사용. 다른 텍스트 없이 바로 내용 작성.

[오늘의핵심]
오늘 이 종목을 보유 또는 매수하는 핵심 이유. 최신 업황·실적·수급 흐름을 반영해 구체적으로 서술.

[리스크]
단기 2~4주 내 주가 하방 압력이 될 수 있는 리스크. 거시·업종·종목 특유 리스크를 구분해 서술.

[투자아이디어]
지금 이 종목에서 실행 가능한 투자 아이디어. 구체적인 매수 근거(밸류에이션 근거, 예상 실적 반등 시점, 예정된 이벤트 일정 등)와 목표 주가 도달 시나리오를 포함.`;

  console.log(`[portfolio-brief] ${ticker} — Gemini 브리핑 생성 (분석 DB 없음)`);
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 900 },
  });
  const summary = response.text?.trim() ?? "";
  return { summary, source: "ai" };
}

// ── 외부에서 호출 가능한 브리핑 갱신 함수 (분석 완료 시 훅용) ────────────────
export async function refreshBriefForTicker(ticker: string): Promise<void> {
  await ensureBriefTable();
  const today = new Date().toISOString().slice(0, 10);

  // 오늘 기존 브리핑 삭제 후 재생성
  await pool.query(
    `DELETE FROM portfolio_stock_briefs WHERE ticker=$1 AND brief_date=$2`,
    [ticker, today]
  );

  try {
    const { summary, source, analysisId } = await buildBriefSummary(ticker);
    if (!summary) return;
    await pool.query(
      `INSERT INTO portfolio_stock_briefs (ticker, brief_date, summary, source, analysis_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (ticker, brief_date) DO UPDATE
       SET summary = EXCLUDED.summary, source = EXCLUDED.source, analysis_id = EXCLUDED.analysis_id`,
      [ticker, today, summary, source, analysisId ?? null]
    );
    console.log(`[portfolio-brief] ${ticker} 브리핑 갱신 완료 (source=${source})`);
  } catch (e: any) {
    console.error(`[portfolio-brief] ${ticker} 갱신 실패:`, e?.message);
  }
}

// ── 스케줄러: 매일 포트폴리오 종목 브리핑 일괄 생성 ─────────────────────────
export async function runDailyPortfolioBriefs(): Promise<void> {
  await ensureBriefTable();
  const today = new Date().toISOString().slice(0, 10);

  // 오늘 포트폴리오에 있는 모든 고유 ticker 수집
  const { rows: tickers } = await pool.query(`
    SELECT DISTINCT ph.ticker FROM portfolio_holdings ph
  `);

  let generated = 0;
  for (const row of tickers) {
    // 오늘 이미 있으면 스킵
    const { rows: existing } = await pool.query(
      `SELECT id FROM portfolio_stock_briefs WHERE ticker=$1 AND brief_date=$2`,
      [row.ticker, today]
    );
    if (existing.length > 0) continue;

    try {
      const { summary, source, analysisId } = await buildBriefSummary(row.ticker);
      if (!summary) continue;
      await pool.query(
        `INSERT INTO portfolio_stock_briefs (ticker, brief_date, summary, source, analysis_id)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (ticker, brief_date) DO NOTHING`,
        [row.ticker, today, summary, source, analysisId ?? null]
      );
      generated++;
      await new Promise(r => setTimeout(r, 1500));
    } catch (e: any) {
      console.error(`[portfolio-brief] ${row.ticker} 실패:`, e?.message);
    }
  }
  console.log(`[portfolio-brief] 브리핑 생성 완료: ${generated}개`);
}

// ── GET /api/portfolio/brief/:ticker — AI 데일리 브리핑 ────────────────────
router.get("/portfolio/brief/:ticker", async (req, res) => {
  const ticker = String(req.params.ticker).trim().toUpperCase();
  const today = new Date().toISOString().slice(0, 10);
  await ensureBriefTable();

  const force = req.query.force === "true";

  // 오늘 브리핑 조회 — 6시간 이내면 캐시 반환, 이후면 자동 갱신
  if (!force) {
    const { rows } = await pool.query(
      `SELECT summary, source, created_at FROM portfolio_stock_briefs WHERE ticker=$1 AND brief_date=$2`,
      [ticker, today]
    );
    if (rows.length > 0) {
      const ageHours = (Date.now() - new Date(rows[0].created_at).getTime()) / 3600000;
      if (ageHours < 6) {
        // 집단지성 메타 — 실시간 기여자 수
        const { rows: cRows } = await pool.query(
          `SELECT COUNT(DISTINCT user_id) AS cnt FROM analyses
           WHERE ticker=$1 AND status='completed' AND created_at >= NOW() - INTERVAL '90 days'`,
          [ticker]
        );
        const { rows: aRows } = await pool.query(
          `SELECT created_at FROM analyses WHERE ticker=$1 AND status='completed'
           ORDER BY created_at DESC LIMIT 1`, [ticker]
        );
        res.json({
          ticker, date: today,
          summary: rows[0].summary, source: rows[0].source, cached: true,
          contributorCount: Number(cRows[0]?.cnt ?? 0),
          analysisDate: aRows[0]?.created_at ? (aRows[0].created_at as Date).toISOString().slice(0, 10) : null,
        });
        return;
      }
      // 6시간 경과 → 삭제 후 재생성
      await pool.query(
        `DELETE FROM portfolio_stock_briefs WHERE ticker=$1 AND brief_date=$2`,
        [ticker, today]
      );
      console.log(`[portfolio-brief] ${ticker} 브리핑 만료 (${ageHours.toFixed(1)}h) — 재생성`);
    }
  } else {
    await pool.query(
      `DELETE FROM portfolio_stock_briefs WHERE ticker=$1 AND brief_date=$2`,
      [ticker, today]
    );
  }

  try {
    const { summary, source, analysisId, analysisDate, contributorCount } = await buildBriefSummary(ticker);
    if (summary) {
      await pool.query(
        `INSERT INTO portfolio_stock_briefs (ticker, brief_date, summary, source, analysis_id)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (ticker, brief_date) DO UPDATE
         SET summary = EXCLUDED.summary, source = EXCLUDED.source, analysis_id = EXCLUDED.analysis_id`,
        [ticker, today, summary, source, analysisId ?? null]
      );
    }
    res.json({ ticker, date: today, summary, source, cached: false, analysisDate: analysisDate ?? null, contributorCount: contributorCount ?? 0 });
  } catch (e: any) {
    res.status(500).json({ error: "브리핑 생성 실패", detail: e?.message });
  }
});

// ── GET /api/portfolio/check/:ticker — 포트폴리오 포함 여부 확인 ───────────────
router.get("/portfolio/check/:ticker", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.json({ inPortfolio: false }); return; }

  await ensureTable();
  const ticker = String(req.params.ticker).trim().toUpperCase();
  const { rows } = await pool.query(
    `SELECT id FROM portfolio_holdings WHERE user_id = $1 AND ticker = $2`,
    [userId, ticker]
  );
  res.json({ inPortfolio: rows.length > 0, holdingId: rows[0]?.id ?? null });
});

// ── GET /api/portfolio/changes/:ticker — 분석 이력 변화 감지 (본인 분석만) ──
router.get("/portfolio/changes/:ticker", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.json({ hasChanges: false, analysisCount: 0, changes: [] }); return; }

  const ticker = String(req.params.ticker).trim().toUpperCase();

  // 최근 완료된 분석 3개 조회 (비교용, 본인 분석만)
  const { rows } = await pool.query(`
    SELECT
      a.id, a.investment_verdict, a.target_price, a.created_at,
      (SELECT content FROM analysis_steps
       WHERE analysis_id = a.id AND step_key = 'key_catalysts' LIMIT 1) AS catalysts,
      (SELECT content FROM analysis_steps
       WHERE analysis_id = a.id AND step_key = 'risk_factors' LIMIT 1) AS risks
    FROM analyses a
    WHERE a.ticker = $1 AND a.user_id = $2 AND a.status = 'completed'
    ORDER BY a.created_at DESC
    LIMIT 3
  `, [ticker, userId]);

  if (rows.length < 2) {
    res.json({ hasChanges: false, analysisCount: rows.length, latest: rows[0] ?? null });
    return;
  }

  const latest = rows[0];
  const prev   = rows[1];

  // ── 판정 변화 ────────────────────────────────────────────────────────────
  const verdictChanged = latest.investment_verdict !== prev.investment_verdict;

  // ── 목표가 변화 ──────────────────────────────────────────────────────────
  const latestTP = latest.target_price ? parseFloat(latest.target_price) : null;
  const prevTP   = prev.target_price   ? parseFloat(prev.target_price)   : null;
  const targetPricePct = (latestTP && prevTP && prevTP > 0)
    ? ((latestTP - prevTP) / prevTP) * 100
    : null;
  const targetPriceChanged = targetPricePct != null && Math.abs(targetPricePct) >= 3;

  // ── 촉매/리스크 핵심 문장 추출 (첫 2문장) ────────────────────────────────
  function extractSnippet(text: string | null): string | null {
    if (!text) return null;
    const clean = text
      .replace(/^#{1,4}[^\n]*\n/gm, "")  // 마크다운 제목 제거
      .replace(/\*\*/g, "")
      .trim();
    const sentences = clean.split(/(?<=[.!?。])\s+/).filter(s => s.trim().length > 15);
    return sentences.slice(0, 2).join(" ").slice(0, 200) || null;
  }

  const changes: Array<{
    type: "verdict" | "target_price" | "catalyst" | "risk";
    label: string;
    detail: string;
    direction: "up" | "down" | "neutral";
  }> = [];

  if (verdictChanged) {
    const verdictOrder = ["Strong Sell", "Sell", "Hold", "Buy", "Strong Buy"];
    const prevIdx   = verdictOrder.indexOf(prev.investment_verdict ?? "");
    const latestIdx = verdictOrder.indexOf(latest.investment_verdict ?? "");
    const dir = latestIdx > prevIdx ? "up" : latestIdx < prevIdx ? "down" : "neutral";
    changes.push({
      type: "verdict",
      label: "AI 판정 변경",
      detail: `${prev.investment_verdict ?? "??"} → ${latest.investment_verdict ?? "??"}`,
      direction: dir,
    });
  }

  if (targetPriceChanged && targetPricePct != null) {
    changes.push({
      type: "target_price",
      label: "목표가 변경",
      detail: `${targetPricePct > 0 ? "+" : ""}${targetPricePct.toFixed(1)}% (이전 대비)`,
      direction: targetPricePct > 0 ? "up" : "down",
    });
  }

  // 최신 분석의 핵심 촉매/리스크 스니펫도 함께 반환
  const catalystSnippet = extractSnippet(latest.catalysts);
  const riskSnippet     = extractSnippet(latest.risks);

  if (catalystSnippet) {
    changes.push({
      type: "catalyst",
      label: "핵심 촉매",
      detail: catalystSnippet,
      direction: "up",
    });
  }
  if (riskSnippet) {
    changes.push({
      type: "risk",
      label: "주요 리스크",
      detail: riskSnippet,
      direction: "down",
    });
  }

  res.json({
    hasChanges: verdictChanged || targetPriceChanged,
    analysisCount: rows.length,
    latestDate: latest.created_at,
    prevDate: prev.created_at,
    changes,
  });
});

// ── DELETE /api/portfolio/:id — 종목 삭제 ────────────────────────────────────
router.delete("/portfolio/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  await pool.query(
    `DELETE FROM portfolio_holdings WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  res.json({ ok: true });
});

export default router;
