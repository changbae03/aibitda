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
import { getUserId, checkAndDeductCredit } from "../lib/credits.js";
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
  // 마이그레이션: holding_type 컬럼 추가 (없는 경우)
  await pool.query(`
    ALTER TABLE portfolio_holdings
    ADD COLUMN IF NOT EXISTS holding_type TEXT NOT NULL DEFAULT 'portfolio'
  `);
}

// ── 현재가 조회 (Yahoo Finance) ─────────────────────────────────────────────
async function fetchPrice(ticker: string): Promise<{ price: number | null; currency: string; change1d: number | null }> {
  try {
    if (/^\d{5,6}$/.test(ticker)) {
      // 한국 종목: .KS 먼저 시도, 가격 없으면 .KQ 시도 (코스닥)
      for (const suffix of [".KS", ".KQ"]) {
        try {
          const q = await (YahooFinance as any).quote(`${ticker}${suffix}`, { fields: ["regularMarketPrice", "currency", "regularMarketChangePercent"] });
          if (q?.regularMarketPrice != null) {
            return {
              price: q.regularMarketPrice,
              currency: q.currency ?? "KRW",
              change1d: q.regularMarketChangePercent ?? null,
            };
          }
        } catch { continue; }
      }
      return { price: null, currency: "KRW", change1d: null };
    }
    const q = await (YahooFinance as any).quote(ticker, { fields: ["regularMarketPrice", "currency", "regularMarketChangePercent"] });
    return {
      price: q?.regularMarketPrice ?? null,
      currency: q?.currency ?? "USD",
      change1d: q?.regularMarketChangePercent ?? null,
    };
  } catch {
    return { price: null, currency: /^\d{5,6}$/.test(ticker) ? "KRW" : "USD", change1d: null };
  }
}

// ── 최신 분석 조회 (현재 유저 본인 분석만) ────────────────────────────────────
// ── 단건 조회 (포트폴리오 외 단일 종목 조회용) ───────────────────────────────
async function fetchLatestAnalysis(ticker: string, userId: string) {
  const map = await fetchLatestAnalysesBatch([ticker], userId);
  return map.get(ticker) ?? null;
}
async function fetchBestAnalysis(ticker: string) {
  const map = await fetchBestAnalysesBatch([ticker]);
  return map.get(ticker) ?? null;
}
async function fetchCollectiveAvgTarget(ticker: string): Promise<{ avgTarget: number | null; analystCount: number }> {
  const map = await fetchCollectiveAvgTargetsBatch([ticker]);
  return map.get(ticker) ?? { avgTarget: null, analystCount: 0 };
}

// ── 배치 조회 (포트폴리오 N+1 방지: 전체 종목을 쿼리 3번으로 처리) ──────────

async function _attachSteps(rows: any[]): Promise<any[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const { rows: steps } = await pool.query(
    `SELECT analysis_id, step_key, content
     FROM analysis_steps
     WHERE analysis_id = ANY($1::int[])
       AND step_key IN ('catalyst_analysis','key_catalysts','risk_factors','investment_strategy')`,
    [ids]
  );
  const byId = new Map<number, Record<string, string>>();
  for (const s of steps) {
    if (!byId.has(s.analysis_id)) byId.set(s.analysis_id, {});
    byId.get(s.analysis_id)![s.step_key] = s.content;
  }
  return rows.map((r) => {
    const s = byId.get(r.id) ?? {};
    return {
      ...r,
      catalysts: s["catalyst_analysis"] ?? s["key_catalysts"] ?? null,
      risks: s["risk_factors"] ?? null,
      strategy: s["investment_strategy"] ?? null,
    };
  });
}

async function fetchLatestAnalysesBatch(tickers: string[], userId: string): Promise<Map<string, any>> {
  if (!tickers.length) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ticker)
       id, ticker, target_price, entry_price, stop_loss, investment_verdict,
       qa_score, created_at, risk_reward_ratio, industry
     FROM analyses
     WHERE ticker = ANY($1) AND user_id = $2 AND status = 'completed'
     ORDER BY ticker, created_at DESC`,
    [tickers, userId]
  );
  const enriched = await _attachSteps(rows);
  return new Map(enriched.map((r) => [r.ticker, r]));
}

async function fetchBestAnalysesBatch(tickers: string[]): Promise<Map<string, any>> {
  if (!tickers.length) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ticker)
       id, ticker, target_price, entry_price, stop_loss, investment_verdict,
       risk_reward_ratio, industry, company_name, qa_score, created_at
     FROM analyses
     WHERE ticker = ANY($1) AND status = 'completed'
     ORDER BY ticker, created_at DESC`,
    [tickers]
  );
  const enriched = await _attachSteps(rows);
  return new Map(enriched.map((r) => [r.ticker, r]));
}

async function fetchCollectiveAvgTargetsBatch(tickers: string[]): Promise<Map<string, { avgTarget: number | null; analystCount: number }>> {
  if (!tickers.length) return new Map();
  const { rows } = await pool.query(
    `SELECT ticker,
            ROUND(AVG(target_price::numeric)) AS avg_target,
            COUNT(DISTINCT user_id) AS analyst_count
     FROM analyses
     WHERE ticker = ANY($1)
       AND status = 'completed'
       AND target_price IS NOT NULL
       AND created_at >= NOW() - INTERVAL '30 days'
     GROUP BY ticker`,
    [tickers]
  );
  return new Map(rows.map((r) => [r.ticker, {
    avgTarget: r.avg_target ? parseFloat(r.avg_target) : null,
    analystCount: r.analyst_count ? parseInt(r.analyst_count) : 0,
  }]));
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
    `SELECT ph.id, ph.ticker, ph.company_name, ph.avg_price, ph.quantity, ph.currency, ph.note, ph.added_at,
            ph.holding_type,
            (SELECT a.english_name FROM analyses a WHERE a.ticker = ph.ticker AND a.english_name IS NOT NULL ORDER BY a.created_at DESC LIMIT 1) AS english_name
     FROM portfolio_holdings ph
     WHERE ph.user_id = $1
     ORDER BY ph.added_at DESC`,
    [userId]
  );

  // skipPrices=true 이면 현재가 조회 생략 → 클라이언트 batch-quotes로 채움
  const skipPrices = req.query.skipPrices === "true";

  // DB 분석 데이터는 배치 쿼리로 한 번에 조회 (N+1 방지)
  const tickers = rows.map((r) => r.ticker);
  const [latestMap, bestMap, collectiveMap, priceResults] = await Promise.all([
    fetchLatestAnalysesBatch(tickers, userId),
    fetchBestAnalysesBatch(tickers),
    fetchCollectiveAvgTargetsBatch(tickers),
    skipPrices
      ? Promise.resolve(new Map<string, { price: number | null; currency: string; change1d: number | null }>())
      : Promise.all(rows.map(async (r) => ({ ticker: r.ticker, ...(await fetchPrice(r.ticker)) }))).then(
          (res) => new Map(res.map((x) => [x.ticker, { price: x.price, currency: x.currency, change1d: x.change1d }]))
        ),
  ]);

  const enriched = rows.map((row) => {
    const priceData = priceResults.get(row.ticker) ?? { price: null as number | null, currency: row.currency ?? "KRW", change1d: null as number | null };
    const analysis = latestMap.get(row.ticker) ?? null;
    const bestAnalysis = bestMap.get(row.ticker) ?? null;
    const collective = collectiveMap.get(row.ticker) ?? { avgTarget: null, analystCount: 0 };

    const currentPrice = priceData.price;
    const avgPrice = row.avg_price ? parseFloat(row.avg_price) : null;
    const targetPrice = analysis?.target_price ? parseFloat(analysis.target_price) : null;

    // 수익률 계산
    const returnPct = (currentPrice && avgPrice)
      ? ((currentPrice - avgPrice) / avgPrice) * 100
      : null;

    // 내 분석 목표가 대비 상승여력
    const upsidePct = (currentPrice && targetPrice)
      ? ((targetPrice - currentPrice) / currentPrice) * 100
      : null;

    // 집단지성 평균 목표가 — 분석자 2명 이상일 때만 표시
    const collectiveTargetPrice = (collective.analystCount >= 2 && collective.avgTarget)
      ? collective.avgTarget : null;
    const collectiveUpsidePct = (currentPrice && collectiveTargetPrice)
      ? ((collectiveTargetPrice - currentPrice) / currentPrice) * 100
      : null;

    // 분석이 없을 때 집단지성 최신 분석을 기본 목표가로 사용
    const effectiveTargetPrice = targetPrice ?? (bestAnalysis?.target_price ? parseFloat(bestAnalysis.target_price) : null);
    const effectiveUpsidePct = (currentPrice && effectiveTargetPrice)
      ? ((effectiveTargetPrice - currentPrice) / currentPrice) * 100
      : null;

    const baseAnalysis = analysis ?? bestAnalysis;

    return {
      id: row.id,
      ticker: row.ticker,
      companyName: row.company_name,
      englishName: row.english_name ?? null,
      avgPrice,
      quantity: row.quantity ? parseFloat(row.quantity) : null,
      currency: row.currency,
      note: row.note,
      addedAt: row.added_at,
      holdingType: (row.holding_type ?? "portfolio") as "portfolio" | "watchlist",
      // 현재가
      currentPrice,
      change1d: priceData.change1d,
      priceCurrency: priceData.currency,
      // 수익률
      returnPct,
      // 분석
      analysis: baseAnalysis ? {
        id: baseAnalysis.id,
        targetPrice,
        collectiveTargetPrice,
        entryPrice: baseAnalysis.entry_price ? parseFloat(baseAnalysis.entry_price) : null,
        stopLoss: baseAnalysis.stop_loss ? parseFloat(baseAnalysis.stop_loss) : null,
        verdict: baseAnalysis.investment_verdict,
        qaScore: baseAnalysis.qa_score ?? null,
        createdAt: baseAnalysis.created_at,
        riskRewardRatio: baseAnalysis.risk_reward_ratio ? parseFloat(baseAnalysis.risk_reward_ratio) : null,
        upsidePct: upsidePct ?? effectiveUpsidePct,
        collectiveUpsidePct,
        catalysts: baseAnalysis.catalysts ?? null,
        risks: baseAnalysis.risks ?? null,
        strategy: baseAnalysis.strategy ?? null,
        industry: baseAnalysis.industry ?? null,
      } : null,
    };
  });

  res.json({ holdings: enriched });
});

// ── POST /api/portfolio — 종목 추가 ─────────────────────────────────────────
router.post("/portfolio", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  await ensureTable();

  const { ticker, companyName, avgPrice, quantity, currency, note, holdingType } = req.body as {
    ticker?: string; companyName?: string;
    avgPrice?: number; quantity?: number;
    currency?: string; note?: string;
    holdingType?: "portfolio" | "watchlist";
  };

  if (!ticker) { res.status(400).json({ error: "ticker는 필수입니다" }); return; }

  const cleanTicker = String(ticker).trim().toUpperCase();
  const cleanName = String(companyName ?? cleanTicker).trim();
  const cleanCurrency = String(currency ?? "KRW").trim();
  const cleanType = holdingType === "watchlist" ? "watchlist" : "portfolio";

  try {
    const { rows } = await pool.query(`
      INSERT INTO portfolio_holdings (user_id, ticker, company_name, avg_price, quantity, currency, note, holding_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, ticker) DO UPDATE
        SET company_name = EXCLUDED.company_name,
            avg_price    = COALESCE(EXCLUDED.avg_price, portfolio_holdings.avg_price),
            quantity     = COALESCE(EXCLUDED.quantity, portfolio_holdings.quantity),
            currency     = EXCLUDED.currency,
            note         = COALESCE(EXCLUDED.note, portfolio_holdings.note),
            holding_type = EXCLUDED.holding_type
      RETURNING id
    `, [userId, cleanTicker, cleanName, avgPrice ?? null, quantity ?? null, cleanCurrency, note ?? null, cleanType]);

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

  const { avgPrice, quantity, note, holdingType } = req.body as {
    avgPrice?: number; quantity?: number; note?: string;
    holdingType?: "portfolio" | "watchlist";
  };

  await pool.query(`
    UPDATE portfolio_holdings
    SET avg_price    = COALESCE($1, avg_price),
        quantity     = COALESCE($2, quantity),
        note         = $3,
        holding_type = COALESCE($6, holding_type)
    WHERE id = $4 AND user_id = $5
  `, [avgPrice ?? null, quantity ?? null, note ?? null, id, userId, holdingType ?? null]);

  res.json({ ok: true });
});

// ── portfolio_snapshots 테이블 ───────────────────────────────────────────────
async function ensureSnapshotsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id                 SERIAL PRIMARY KEY,
      user_id            TEXT NOT NULL,
      snapshot_date      DATE NOT NULL,
      total_invested_krw NUMERIC DEFAULT 0,
      total_value_krw    NUMERIC DEFAULT 0,
      total_invested_usd NUMERIC DEFAULT 0,
      total_value_usd    NUMERIC DEFAULT 0,
      total_return_pct   NUMERIC,
      holdings_json      JSONB,
      UNIQUE (user_id, snapshot_date)
    )
  `);
}

// ── GET /api/portfolio/performance — 성과 추적 (스냅샷 자동 저장 + 이력 조회) ──
router.get("/portfolio/performance", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  await ensureTable();
  await ensureSnapshotsTable();

  // 관심종목 제외 — avg_price/quantity가 없으면 수익률 계산 불가
  const { rows: holdings } = await pool.query(
    `SELECT ticker, company_name, avg_price, quantity, currency FROM portfolio_holdings WHERE user_id = $1 AND holding_type = 'portfolio'`,
    [userId]
  );

  if (holdings.length === 0) {
    res.json({ today: null, snapshots: [] }); return;
  }

  // 현재가 병렬 조회
  const priceResults = await Promise.all(
    holdings.map(async (h: any) => ({ ticker: h.ticker, ...(await fetchPrice(h.ticker)) }))
  );
  const priceMap = new Map(priceResults.map((p: any) => [p.ticker, p]));

  let totalInvestedKrw = 0, totalValueKrw = 0;
  let totalInvestedUsd = 0, totalValueUsd = 0;

  const holdingsDetail = holdings.map((h: any) => {
    const p = priceMap.get(h.ticker);
    const avgPrice    = h.avg_price ? parseFloat(h.avg_price) : null;
    const quantity    = h.quantity  ? parseFloat(h.quantity)  : null;
    const currentPrice = p?.price ?? null;
    const currency    = h.currency ?? "KRW";
    const invested    = (avgPrice && quantity) ? avgPrice * quantity : null;
    const value       = (currentPrice && quantity) ? currentPrice * quantity : null;
    const returnPct   = (avgPrice && currentPrice)
      ? ((currentPrice - avgPrice) / avgPrice) * 100 : null;
    const plAmount    = (invested != null && value != null) ? value - invested : null;

    if (invested != null && value != null) {
      if (currency === "KRW") { totalInvestedKrw += invested; totalValueKrw += value; }
      else if (currency === "USD") { totalInvestedUsd += invested; totalValueUsd += value; }
    }

    return {
      ticker: h.ticker, name: h.company_name,
      avgPrice, quantity, currentPrice, currency,
      invested, value, returnPct, plAmount,
      change1d: p?.change1d ?? null,
    };
  });

  const totalReturnPct    = totalInvestedKrw > 0
    ? ((totalValueKrw - totalInvestedKrw) / totalInvestedKrw) * 100 : null;
  const totalReturnPctUsd = totalInvestedUsd > 0
    ? ((totalValueUsd - totalInvestedUsd) / totalInvestedUsd) * 100 : null;

  // 오늘 스냅샷 upsert (하루 1회 갱신)
  const today = new Date().toISOString().slice(0, 10);
  try {
    await pool.query(`
      INSERT INTO portfolio_snapshots
        (user_id, snapshot_date, total_invested_krw, total_value_krw,
         total_invested_usd, total_value_usd, total_return_pct, holdings_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, snapshot_date) DO UPDATE
        SET total_invested_krw = EXCLUDED.total_invested_krw,
            total_value_krw    = EXCLUDED.total_value_krw,
            total_invested_usd = EXCLUDED.total_invested_usd,
            total_value_usd    = EXCLUDED.total_value_usd,
            total_return_pct   = EXCLUDED.total_return_pct,
            holdings_json      = EXCLUDED.holdings_json
    `, [userId, today, totalInvestedKrw, totalValueKrw,
        totalInvestedUsd, totalValueUsd, totalReturnPct,
        JSON.stringify(holdingsDetail)]);
  } catch (e: any) {
    console.warn("[snapshot] save failed:", (e as any)?.message?.slice(0, 80));
  }

  // 최근 90일 스냅샷 조회
  const { rows: snapshots } = await pool.query(
    `SELECT snapshot_date, total_invested_krw, total_value_krw,
            total_invested_usd, total_value_usd, total_return_pct
     FROM portfolio_snapshots
     WHERE user_id = $1 AND snapshot_date >= NOW() - INTERVAL '90 days'
     ORDER BY snapshot_date ASC`,
    [userId]
  );

  res.json({
    today: {
      investedKrw:    totalInvestedKrw,
      valueKrw:       totalValueKrw,
      investedUsd:    totalInvestedUsd,
      valueUsd:       totalValueUsd,
      returnPct:      totalReturnPct,
      returnPctUsd:   totalReturnPctUsd,
      holdingsDetail,
    },
    snapshots: snapshots.map((s: any) => ({
      date: String(s.snapshot_date).slice(0, 10),
      investedKrw: parseFloat(s.total_invested_krw ?? 0),
      valueKrw:    parseFloat(s.total_value_krw    ?? 0),
      investedUsd: parseFloat(s.total_invested_usd ?? 0),
      valueUsd:    parseFloat(s.total_value_usd    ?? 0),
      returnPct:   s.total_return_pct != null ? parseFloat(s.total_return_pct) : null,
    })),
  });
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
  const [analyses, priceResultsDiag] = await Promise.all([
    Promise.all(holdings.map((h: any) => fetchBestAnalysis(h.ticker))),
    Promise.all(holdings.map(async (h: any) => ({ ticker: h.ticker, ...(await fetchPrice(h.ticker)) }))),
  ]);
  const priceMapDiag = new Map(priceResultsDiag.map((p: any) => [p.ticker, p]));

  // 포트폴리오 총 평가금액 계산 (KRW)
  let diagTotalValue = 0, diagTotalInvested = 0;
  const holdingValues: Array<{ ticker: string; value: number }> = [];
  holdings.forEach((h: any) => {
    const p = priceMapDiag.get(h.ticker);
    const avgPrice = h.avg_price ? parseFloat(h.avg_price) : null;
    const qty = h.quantity ? parseFloat(h.quantity) : null;
    const cur = p?.price ?? null;
    if (avgPrice && qty && cur && (h.currency ?? "KRW") === "KRW") {
      const val = cur * qty;
      const inv = avgPrice * qty;
      diagTotalValue += val;
      diagTotalInvested += inv;
      holdingValues.push({ ticker: h.ticker, value: val });
    }
  });

  // 진단용 데이터 요약 (수익률 + 비중 포함)
  const portfolioLines = holdings.map((h: any, i: number) => {
    const a = analyses[i];
    const p = priceMapDiag.get(h.ticker);
    const verdict  = a?.investment_verdict ?? "미분석";
    const target   = a?.target_price ? `목표가 ${parseFloat(a.target_price).toLocaleString()}` : "목표가없음";
    const industry = a?.industry ?? "업종미상";
    const avgPrice = h.avg_price ? parseFloat(h.avg_price) : null;
    const qty      = h.quantity  ? parseFloat(h.quantity)  : null;
    const cur      = p?.price ?? null;
    const returnPctStr = (avgPrice && cur) ? `수익률${((cur - avgPrice) / avgPrice * 100).toFixed(1)}%` : "수익률N/A";
    const hv = holdingValues.find(x => x.ticker === h.ticker);
    const weightStr = (hv && diagTotalValue > 0) ? `비중${(hv.value / diagTotalValue * 100).toFixed(1)}%` : "비중N/A";
    const plStr = (avgPrice && qty && cur) ? `P&L${((cur - avgPrice) * qty).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원` : "";
    return `- ${h.company_name}(${h.ticker}) | ${industry} | AI:${verdict} | ${target} | ${returnPctStr} | ${weightStr}${plStr ? ` | ${plStr}` : ""}`.trim();
  }).join("\n");

  const totalReturnPctDiag = diagTotalInvested > 0
    ? ((diagTotalValue - diagTotalInvested) / diagTotalInvested * 100).toFixed(2) : null;
  const topConcentrated = holdingValues
    .filter(hv => diagTotalValue > 0)
    .map(hv => ({ ticker: hv.ticker, pct: hv.value / diagTotalValue * 100 }))
    .filter(x => x.pct > 30)
    .map(x => `${x.ticker}(${x.pct.toFixed(1)}%)`)
    .join(", ");

  // 섹터 목록 (중복 제거)
  const sectors = [...new Set(analyses.map((a: any) => a?.industry).filter(Boolean))] as string[];

  const buyCount  = analyses.filter((a: any) => a?.investment_verdict?.toLowerCase().includes("buy")).length;
  const sellCount = analyses.filter((a: any) => a?.investment_verdict?.toLowerCase().includes("sell")).length;
  const holdCount = analyses.filter((a: any) => a?.investment_verdict === "Hold").length;

  const prompt = `당신은 기관급 포트폴리오 매니저(PM)입니다. 아래 포트폴리오를 종합 분석하고 한국어로 진단해주세요.

[포트폴리오 현황 — ${holdings.length}종목]
${portfolioLines}

[포트폴리오 통계]
- KRW 총 투자금: ${diagTotalInvested > 0 ? Math.round(diagTotalInvested).toLocaleString("ko-KR") + "원" : "미입력"}
- KRW 현재 평가금: ${diagTotalValue > 0 ? Math.round(diagTotalValue).toLocaleString("ko-KR") + "원" : "미입력"}
- 전체 수익률: ${totalReturnPctDiag != null ? totalReturnPctDiag + "%" : "미입력"}
- 30% 초과 집중 종목: ${topConcentrated || "없음"}
- AI 판정 분포: 매수 ${buyCount}종목 / 홀드 ${holdCount}종목 / 매도 ${sellCount}종목
- 보유 섹터: ${sectors.join(", ") || "정보없음"}

다음 5가지 항목을 각각 2-3문장으로 작성하세요. 마크다운 볼드(**) 사용 금지. 각 항목은 정확히 아래 헤더로 구분하세요:

[종합진단]
전체 포트폴리오의 건강 상태와 균형 평가. 수익률 현황과 강점/약점 요약.

[리스크 집중도]
업종·테마 쏠림, 비중이 30% 초과하는 종목의 위험도, 상관관계 분석. 구체적 종목명 언급 필수.

[기회 요인]
현재 포트폴리오에서 가장 주목할 종목과 그 이유. 수익률·AI 판정·상승여력 종합 판단.

[실행 권고]
PM 관점에서 지금 당장 실행할 1-2가지 구체적 행동. 비중 조절 수치(예: "A 비중을 20%→15%로") 포함 권장.

[리밸런싱 전략]
수익률 및 비중 데이터를 근거로 한 리밸런싱 제안. 익절/손절 라인, 추가매수 우선순위, 섹터 보완 방향을 구체적으로 명시하세요.`;

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
        overall:      extractSection(text, "종합진단"),
        risk:         extractSection(text, "리스크 집중도"),
        opportunity:  extractSection(text, "기회 요인"),
        action:       extractSection(text, "실행 권고"),
        rebalancing:  extractSection(text, "리밸런싱 전략"),
        recommend:    extractSection(text, "섹터 보완"),
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
  // 코드 펜스 제거
  let s = raw.trim()
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  // FINAL_VALUATION_DATA / VALUATION_DATA / CHART_DATA / EVENTS_DATA 메타 블록 제거
  // — 이 블록이 JSON 뒤에 붙어 있으면 JSON.parse 실패 원인이 됨
  s = s
    .replace(/FINAL_VALUATION_DATA:\s*\{[^\n]*\}/g, "")
    .replace(/VALUATION_DATA:\s*\{[^\n]*\}/g, "")
    .replace(/CHART_DATA:\s*\[[^\n]*\]/g, "")
    .replace(/EVENTS_DATA:\s*\[[^\n]*\]/g, "")
    .trim();

  // 첫 번째 { 위치에서 중괄호 카운팅으로 매칭되는 } 까지 JSON 블록 추출
  const start = s.indexOf("{");
  if (start !== -1) {
    let depth = 0, end = -1;
    for (let i = start; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      try {
        const obj = JSON.parse(s.slice(start, end + 1));
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const key of ["summary", "key_issue", "description", "content", "text", "analysis"]) {
            if (typeof obj[key] === "string" && obj[key].length > 20)
              return (obj[key] as string).replace(/\\n/g, "\n");
          }
          const parts = Object.values(obj)
            .filter((v): v is string => typeof v === "string" && v.length > 20)
            .join("\n");
          if (parts) return parts;
        }
      } catch { /* JSON 파싱 실패 → 정규식 fallback */ }
    }

    // JSON 파싱 실패 시 정규식으로 주요 필드 직접 추출
    const mSummary = s.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (mSummary) return mSummary[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    const mIssue = s.match(/"key_issue"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (mIssue) return mIssue[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }

  return s.replace(/^#{1,4}\s*/gm, "").replace(/\*\*/g, "").trim();
}

/** investment_strategy JSON에서 risks 배열을 꺼내 텍스트로 변환 */
function extractRisksFromStrategyJson(raw: string): string {
  if (!raw) return "";
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const obj = JSON.parse(stripped);
    if (Array.isArray(obj?.risks) && obj.risks.length > 0) {
      return (obj.risks as string[]).slice(0, 3).join(" ");
    }
  } catch { /* fall through */ }
  return "";
}

/**
 * 투자 아이디어 추출:
 * investment_strategy JSON의 key_issue(최신 이슈) + monitoring_indicators(모니터링 포인트)
 * + 기본 시나리오 목표가 → 중복 없이 "현재 이슈 → 앞으로 무엇을 봐야 하는가"에 집중
 */
function extractInvestmentIdea(strategyRaw: string): string {
  if (!strategyRaw) return "";
  const stripped = strategyRaw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const obj = JSON.parse(stripped);
    const parts: string[] = [];

    // 1) 핵심 이슈 (최신 상황 한 문장)
    if (typeof obj.key_issue === "string" && obj.key_issue.trim().length > 10) {
      parts.push(obj.key_issue.trim());
    }

    // 2) 핵심 모니터링 지표 (앞으로 봐야 할 것)
    if (Array.isArray(obj.monitoring_indicators) && obj.monitoring_indicators.length > 0) {
      const monitors = (obj.monitoring_indicators as string[])
        .slice(0, 2)
        .join(", ");
      parts.push(`모니터링 포인트: ${monitors}`);
    }

    if (parts.length > 0) return parts.join(". ");
  } catch { /* fall through */ }
  return "";
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
  // catalyst_analysis = 촉매/핵심이슈 분석 (실제 step_key)
  // investment_strategy = JSON 포맷 전략 (summary·risks 배열 포함)
  const { rows: aRows } = await pool.query(`
    SELECT a.id, a.company_name, a.industry, a.investment_verdict, a.target_price,
      a.created_at,
      (SELECT content FROM analysis_steps WHERE analysis_id = a.id AND step_key = 'catalyst_analysis'   LIMIT 1) AS catalysts,
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
  if (analysis?.catalysts || analysis?.strategy) {
    const verdict     = analysis.investment_verdict ?? "미분석";
    const targetPrice = analysis.target_price
      ? ` (목표주가 ${Number(analysis.target_price).toLocaleString()}원)`
      : "";

    // investment_strategy JSON → summary 필드를 오늘의 핵심으로
    const core = extractSentences(analysis.strategy ?? "", 2)
      || `AI 판정: ${verdict}${targetPrice}`;

    // investment_strategy JSON의 risks 배열 → 리스크
    const risk = extractRisksFromStrategyJson(analysis.strategy ?? "")
      || extractSentences(analysis.catalysts ?? "", 1)
      || "현재 등록된 리스크 정보가 없습니다.";

    // investment_strategy JSON → 최신 이슈 + 모니터링 포인트 + 목표가 (중복 없는 투자 아이디어)
    const catalyst = extractInvestmentIdea(analysis.strategy ?? "")
      || extractSentences(analysis.catalysts ?? "", 2)
      || "현재 등록된 투자 아이디어 정보가 없습니다.";

    const analysisDate = (analysis.created_at as Date).toISOString().slice(0, 10);
    const summary = `[오늘의핵심]\n${core}\n\n[리스크]\n${risk}\n\n[투자포인트]\n${catalyst}`;
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

[투자포인트]
지금 이 종목의 핵심 투자 포인트. 구체적인 매수 근거(밸류에이션, 예상 실적 반등 시점, 예정된 이벤트 일정 등)와 목표 주가 도달 시나리오를 포함.`;

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

// ── GET /api/portfolio/check/:ticker — 포트폴리오/관심종목 포함 여부 확인 ────
router.get("/portfolio/check/:ticker", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.json({ inPortfolio: false, inWatchlist: false }); return; }

  await ensureTable();
  const ticker = String(req.params.ticker).trim().toUpperCase();
  const { rows } = await pool.query(
    `SELECT id, holding_type FROM portfolio_holdings WHERE user_id = $1 AND ticker = $2`,
    [userId, ticker]
  );
  const row = rows[0] ?? null;
  const holdingType = row?.holding_type ?? null;
  res.json({
    inPortfolio: !!row && holdingType === "portfolio",
    inWatchlist: !!row && holdingType === "watchlist",
    holdingId: row?.id ?? null,
  });
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

// ── Google News RSS 뉴스 fetch (심층 업데이트용) ──────────────────────────────
async function fetchRecentNews(companyName: string): Promise<string> {
  try {
    const query = encodeURIComponent(companyName);
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const xml = await res.text();

    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    if (items.length === 0) return "";

    const lines: string[] = [];
    for (const item of items.slice(0, 12)) {
      const cdataTitle = item.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/)?.[1];
      const plainTitle = item.match(/<title>([^<]+)<\/title>/)?.[1];
      const title = (cdataTitle ?? plainTitle ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      const pubDate = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1] ?? "";
      const source = item.match(/<source[^>]*>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/source>/)?.[1] ?? "";
      if (!title) continue;
      const dateStr = pubDate
        ? new Date(pubDate).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
        : "";
      lines.push(`[${dateStr}] ${title}${source ? ` (${source})` : ""}`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── POST /api/portfolio/deep-update/:ticker — 심층 현황 업데이트 브리핑 ──────
router.post("/portfolio/deep-update/:ticker", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  const ticker = decodeURIComponent(req.params.ticker);

  // 크레딧 차감
  const credit = await checkAndDeductCredit(userId);
  if (!credit.ok) {
    res.status(402).json({ error: credit.reason ?? "크레딧이 부족합니다" });
    return;
  }

  try {
    // 1) 포트폴리오에서 회사명 조회
    const holdingRes = await pool.query(
      `SELECT company_name FROM portfolio_holdings WHERE user_id = $1 AND ticker = $2`,
      [userId, ticker]
    );
    const companyName: string = holdingRes.rows[0]?.company_name ?? ticker;

    // 2) 유저 본인 분석 (없으면 집단지성 최신)
    let analysis = await fetchLatestAnalysis(ticker, userId);
    if (!analysis) analysis = await fetchBestAnalysis(ticker);

    // 3) 현재가
    const priceData = await fetchPrice(ticker);
    const currentPrice = priceData.price;

    // 4) 최신 뉴스
    const newsText = await fetchRecentNews(companyName);

    // 5) Gemini 프롬프트 구성
    const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
    const analysisDate = analysis
      ? new Date(analysis.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
      : null;
    const targetPrice = analysis?.target_price ?? null;
    const verdict = analysis?.investment_verdict ?? null;
    const catalysts = analysis?.catalysts ?? null;
    const risks = analysis?.risks ?? null;

    const priceLine = currentPrice && targetPrice
      ? `현재가: ${currentPrice.toLocaleString("ko-KR")}원 / 목표가: ${targetPrice.toLocaleString("ko-KR")}원 (현재가 기준 괴리 ${((currentPrice / targetPrice - 1) * 100).toFixed(1)}%)`
      : currentPrice
      ? `현재가: ${currentPrice.toLocaleString("ko-KR")}원 (목표가 미설정)`
      : "현재가 조회 불가";

    const prompt = `당신은 한국 주식 투자 분석가입니다. 오늘은 ${today}입니다.
아래 정보를 바탕으로 **${companyName}(${ticker})** 심층 현황 업데이트 브리핑을 작성해주세요.

## 마지막 분석 정보${analysisDate ? ` (${analysisDate})` : " (분석 없음)"}
- 투자 의견: ${verdict ?? "없음"}
- ${priceLine}
- 주요 촉매: ${catalysts ? catalysts.slice(0, 300) : "없음"}
- 주요 리스크: ${risks ? risks.slice(0, 300) : "없음"}

## 최근 뉴스 헤드라인
${newsText || "(뉴스 없음)"}

## 작성 지침
- 각 섹션은 2~4문장으로 간결하게 작성
- 구체적인 사실(날짜, 수치, 이름)을 반드시 포함
- 투자자 관점에서 실질적으로 유용한 내용만 작성
- 반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이)

{
  "changed": "마지막 분석 이후 달라진 핵심 사항들 (실적, 이벤트, 업계 변화 등)",
  "priceAction": "현재 주가 흐름과 목표가 대비 상황 평가",
  "thesisCheck": "원래 분석의 핵심 thesis가 여전히 유효한지 검토",
  "action": "현 시점에서 투자자가 취해야 할 행동 제안"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 3000,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // SDK의 response.text 사용 (thinking 파트 자동 제외)
    const raw = (response.text ?? "").trim();

    // 마크다운 코드펜스 제거
    const stripped = raw
      .replace(/^```(?:json)?\s*/im, "")
      .replace(/\s*```\s*$/m, "")
      .trim();

    // JSON 추출 — stripped가 {로 시작하면 직접 파싱, 아니면 regex로 추출
    let parsed: { changed: string; priceAction: string; thesisCheck: string; action: string };
    try {
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("no json block");
      parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.changed || !parsed.action) throw new Error("missing fields");
    } catch (parseErr) {
      console.error("[deep-update] parse failed, raw:", raw.slice(0, 600));
      res.status(500).json({ error: "AI 응답을 파싱할 수 없습니다" });
      return;
    }

    res.json({
      ticker,
      companyName,
      analysisDate,
      currentPrice,
      targetPrice,
      verdict,
      ...parsed,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[deep-update] error:", err);
    res.status(500).json({ error: "업데이트 생성 중 오류가 발생했습니다" });
  }
});

// ── POST /api/portfolio/review — 포트폴리오 전체 리뷰 ─────────────────────────
router.post("/portfolio/review", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  // 크레딧 차감
  const credit = await checkAndDeductCredit(userId);
  if (!credit.ok) {
    res.status(402).json({ error: credit.reason ?? "크레딧이 부족합니다" });
    return;
  }

  try {
    // 1) 보유 종목만 조회 (관심종목 제외 — avg_price/quantity 없어 분석 부정확)
    const { rows: holdingRows } = await pool.query(
      `SELECT ticker, company_name, avg_price, quantity, currency FROM portfolio_holdings WHERE user_id = $1 AND holding_type = 'portfolio'`,
      [userId]
    );

    if (holdingRows.length === 0) {
      res.status(400).json({ error: "보유 종목이 없습니다 (관심종목은 포트폴리오 리뷰 대상이 아닙니다)" });
      return;
    }

    // 2) 각 종목: 분석 + 현재가 + 최신 뉴스 병렬 조회
    const holdingDetails = await Promise.all(
      holdingRows.map(async (h: any) => {
        const companyName: string = h.company_name || h.ticker;
        const [analysis, priceData, newsText] = await Promise.all([
          fetchLatestAnalysis(h.ticker, userId).then(a => a ?? fetchBestAnalysis(h.ticker)),
          fetchPrice(h.ticker),
          fetchRecentNews(companyName),
        ]);
        const avgPrice = h.avg_price ? parseFloat(h.avg_price) : null;
        const returnPct = avgPrice && priceData.price
          ? ((priceData.price - avgPrice) / avgPrice) * 100
          : null;
        const upsidePct = analysis?.target_price && priceData.price
          ? ((analysis.target_price - priceData.price) / priceData.price) * 100
          : null;
        // 분석일 기준 경과 일수 계산
        const daysSinceAnalysis = analysis?.created_at
          ? Math.floor((Date.now() - new Date(analysis.created_at).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          ticker: h.ticker,
          companyName,
          currentPrice: priceData.price,
          avgPrice,
          currency: priceData.currency,
          returnPct,
          verdict: analysis?.investment_verdict ?? null,
          targetPrice: analysis?.target_price ?? null,
          upsidePct,
          catalysts: analysis?.catalysts ? String(analysis.catalysts).slice(0, 300) : null,
          risks: analysis?.risks ? String(analysis.risks).slice(0, 300) : null,
          strategy: analysis?.strategy ? String(analysis.strategy).slice(0, 300) : null,
          analysisDate: analysis?.created_at
            ? new Date(analysis.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
            : null,
          daysSinceAnalysis,
          recentNews: newsText || "(뉴스 없음)",
        };
      })
    );

    // 3) 자본 비중 계산 (현재가 × 수량)
    const totalValue = holdingDetails.reduce((sum, h) => {
      const val = (h.currentPrice ?? h.avgPrice ?? 0) * 1; // quantity not in holdingDetails from DB query
      return sum + val;
    }, 0);
    // 실제론 quantity가 있으므로 재계산
    const weightedDetails = holdingDetails.map(h => {
      const qty = holdingRows.find((r: any) => r.ticker === h.ticker)?.quantity ?? 0;
      const val = (h.currentPrice ?? h.avgPrice ?? 0) * parseFloat(qty || 0);
      return { ...h, qty: parseFloat(qty || 0), marketValue: val };
    });
    const totalMarketValue = weightedDetails.reduce((s, h) => s + h.marketValue, 0);
    const withWeights = weightedDetails.map(h => ({
      ...h,
      capitalWeightPct: totalMarketValue > 0 ? (h.marketValue / totalMarketValue) * 100 : null,
    }));

    // 4) 프롬프트 컨텍스트 생성 — 종목별 뉴스 + (참고용) 과거 thesis + 현재 비중
    const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

    const holdingsSummary = withWeights.map(h => {
      const priceStr = h.currentPrice != null
        ? `${h.currentPrice.toLocaleString("ko-KR")} ${h.currency}`
        : "조회 불가";
      const returnStr = h.returnPct != null ? `${h.returnPct >= 0 ? "+" : ""}${h.returnPct.toFixed(1)}%` : "미기록";
      const upsideStr = h.upsidePct != null ? `${h.upsidePct >= 0 ? "+" : ""}${h.upsidePct.toFixed(1)}%` : "—";
      const daysStr = h.daysSinceAnalysis != null ? `분석 후 ${h.daysSinceAnalysis}일 경과` : "분석 없음";
      const weightStr = h.capitalWeightPct != null ? `${h.capitalWeightPct.toFixed(1)}%` : "미집계";
      const staleNote = (h.daysSinceAnalysis ?? 0) > 30 ? " ⚠️ 오래된 분석 — 현재 상황과 다를 수 있음" : "";

      return `### ${h.companyName} (${h.ticker})
[현재 시장 데이터 — 지금 이 순간 기준]
- 현재가: ${priceStr} | 매입 대비 수익률: ${returnStr} | 포트폴리오 자본 비중: ${weightStr}
- 이전 AI 목표가 대비 업사이드: ${upsideStr} (${daysStr}${staleNote})

[최신 뉴스 헤드라인 — 판단의 핵심 근거]
${h.recentNews}

[참고: 과거 진입 당시 thesis — 현재 유효성 직접 판단 필요]
- 핵심 촉매(당시): ${h.catalysts ?? "기록 없음"}
- 주요 리스크(당시): ${h.risks ?? "기록 없음"}
- 투자 전략(당시): ${h.strategy ?? "기록 없음"}`;
    }).join("\n\n---\n\n");

    const sectorList = withWeights.map(h => h.companyName).join(", ");
    const tickerList = withWeights.map(h => h.ticker);

    // 5) Gemini 호출 — 현재 상황 기반 포트폴리오 유지보수 전략
    const prompt = `당신은 월스트리트 헤지펀드의 시니어 포트폴리오 매니저(PM)입니다. 오늘은 ${today}입니다.

아래는 투자자의 **현재 보유 종목** 정보입니다.
각 종목별로 ① 현재가·수익률·자본비중(실시간), ② 오늘 기준 최신 뉴스 헤드라인, ③ 참고용 과거 진입 thesis가 제공됩니다.

**중요 지침:**
- 과거 thesis는 "참고 자료"일 뿐입니다. 오래된 것이면 현재 상황과 맞지 않을 수 있습니다.
- 판단의 핵심은 **최신 뉴스 + 현재 수익률·비중**입니다.
- 지금 이 포트폴리오를 어떻게 유지·관리할지 구체적인 액션 플랜을 제시하세요.
- "thesis가 유효한가"보다 "지금 뉴스 흐름에서 이 종목을 어떻게 다룰 것인가"에 집중하세요.

${holdingsSummary}

실제 헤지펀드 PM처럼 다음 모든 섹션을 포함한 JSON으로 포트폴리오 리뷰를 작성하세요.
stockUpdates는 보유 중인 모든 종목을 빠짐없이 포함해야 합니다.

**출력 형식 (JSON만 출력, 다른 텍스트 없이):**
{
  "stockUpdates": [
    {
      "ticker": "종목코드",
      "companyName": "회사명",
      "sentiment": "bullish 또는 neutral 또는 bearish",
      "thesisStatus": "유효 또는 일부변화 또는 훼손",
      "keyEvent": "분석 이후 가장 중요한 단일 뉴스/이벤트 1문장 (없으면 빈 문자열)",
      "update": "① 분석 이후 주요 뉴스 흐름 요약 ② thesis(촉매/리스크)에 미친 영향 ③ 지금 주목할 포인트 — 3-4문장",
      "action": "매도검토 또는 홀드 또는 추가매수",
      "thesisChangeNote": "thesis 가장 중요한 변화 1문장 (변화 없으면 '주요 thesis 변화 없음')"
    }
  ],
  "riskScore": {
    "grade": "A 또는 B 또는 C 또는 D",
    "sectorConcentration": "섹터 집중도 분석 1-2문장",
    "correlationRisk": "종목 간 상관관계 리스크 1문장"
  },
  "riskContributions": [
    {
      "ticker": "종목코드",
      "companyName": "회사명",
      "volatilityTier": "high 또는 medium 또는 low — 종목의 역사적 변동성 수준",
      "beta": "숫자 — 시장(코스피 또는 S&P500) 대비 베타 추정치 (소수점 1자리)",
      "riskSharePct": "숫자 — 이 종목이 포트폴리오 전체 변동성에 기여하는 비중(%) 추정. 자본비중 × 베타 기준으로 정규화. 합산 100이 되도록",
      "note": "이 종목의 리스크 특성 10자 이내"
    }
  ],
  "varMdd": {
    "var95": "1개월 기준 95% 신뢰수준 VaR 추정 — '약 -X% ~ -Y%' 형식으로",
    "mddEstimate": "현재 포트폴리오 구성상 예상 최대낙폭(MDD) 추정 — '약 -X% ~ -Y%' 형식, 주요 시나리오 포함 1-2문장",
    "worstCaseScenario": "포트폴리오 전체가 가장 크게 타격받을 수 있는 구체적 시나리오 1문장 (예: 반도체 수출 규제 강화 + 엔 약세 동시 발생 등)"
  },
  "catalystTracking": [
    {
      "ticker": "종목코드",
      "companyName": "회사명",
      "thesisCore": "진입 당시 핵심 thesis 한 줄 요약",
      "catalystStatus": "진행중 또는 달성 또는 훼손 또는 미달성",
      "nextMilestone": "다음 확인해야 할 구체적 촉매/이벤트 1문장",
      "hardStop": "이 조건이 달성되면 기계적으로 포지션을 청산해야 하는 Hard Stop 조건 1문장"
    }
  ],
  "positionSizing": [
    {
      "ticker": "종목코드",
      "companyName": "회사명",
      "currentWeightPct": "숫자 — 현재 자본 비중(%)",
      "suggestedWeightPct": "숫자 — Kelly Criterion 기반 권고 비중(%). 현재 포트폴리오 내 승률·손익비 반영",
      "action": "reduce 또는 hold 또는 increase 또는 exit",
      "rationale": "조정 근거 — 현재 비중과 권고 비중 차이, Kelly 판단 기준 1-2문장"
    }
  ],
  "liquidityRisk": "포트폴리오 전체 유동성 평가 — 긴급 청산 시 소요 영업일, 대형주·소형주 구분, 슬리피지 위험 1-2문장",
  "correlationAlert": "종목 간 공분산 리스크 — 동일 섹터/팩터 노출로 인한 동반 하락 가능성, 실질 분산 효과 여부 2-3문장",
  "portfolioView": "전체 포트폴리오 종합 평가 — 현재 시장 환경, 섹터 노출, 전체 방향성 3-4문장",
  "concentration": "종목·섹터 집중도, 상관관계 리스크, 분산 수준 평가 2-3문장",
  "rebalancing": "룰 기반 리밸런싱 제안 — 비중 이탈 종목, 손절 검토, 추가매수 기회, 분할 집행 권고 3-4문장",
  "sectorRecommendations": [
    {
      "sector": "추천 섹터명",
      "reason": "현재 포트폴리오와 보완 관계 + 현재 시장 환경 매력 이유 2-3문장",
      "exampleTickers": ["대표 종목 1 (종목명+코드)", "대표 종목 2"]
    }
  ]
}

주의사항:
- sectorRecommendations는 현재 포트폴리오(${sectorList})에 없는 섹터 2-3개 추천
- riskContributions의 riskSharePct는 합산이 100이 되도록 정규화
- positionSizing의 currentWeightPct는 위에 제공된 자본 비중을 사용
- catalystTracking은 모든 보유 종목 포함
- action 기준: thesis 훼손+bearish → 매도검토, thesis 유효+bullish → 추가매수, 그 외 → 홀드
- 모든 내용은 한국어, PM이 직접 투자자에게 말하듯 구체적·실용적으로
- beta와 riskSharePct, currentWeightPct, suggestedWeightPct는 반드시 숫자(number)로`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 8000,
        temperature: 0.5,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const raw = response.text ?? "";
    const cleaned = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("[portfolio-review] parse failed, raw:", raw.slice(0, 600));
      res.status(500).json({ error: "AI 응답 파싱 실패. 다시 시도해주세요." });
      return;
    }

    const parsed = JSON.parse(match[0]);
    res.json({
      stockUpdates: Array.isArray(parsed.stockUpdates)
        ? parsed.stockUpdates.map((s: any) => ({
            ticker: s.ticker ?? "",
            companyName: s.companyName ?? "",
            sentiment: s.sentiment ?? "neutral",
            thesisStatus: s.thesisStatus ?? "유효",
            keyEvent: s.keyEvent ?? "",
            update: s.update ?? "",
            action: s.action ?? "홀드",
            thesisChangeNote: s.thesisChangeNote ?? "",
          }))
        : [],
      riskScore: parsed.riskScore
        ? {
            grade: parsed.riskScore.grade ?? "B",
            sectorConcentration: parsed.riskScore.sectorConcentration ?? "",
            correlationRisk: parsed.riskScore.correlationRisk ?? "",
          }
        : null,
      riskContributions: Array.isArray(parsed.riskContributions)
        ? parsed.riskContributions.map((r: any) => ({
            ticker: r.ticker ?? "",
            companyName: r.companyName ?? "",
            volatilityTier: r.volatilityTier ?? "medium",
            beta: typeof r.beta === "number" ? r.beta : parseFloat(r.beta) || 1.0,
            riskSharePct: typeof r.riskSharePct === "number" ? r.riskSharePct : parseFloat(r.riskSharePct) || 0,
            note: r.note ?? "",
          }))
        : [],
      varMdd: parsed.varMdd
        ? {
            var95: parsed.varMdd.var95 ?? "",
            mddEstimate: parsed.varMdd.mddEstimate ?? "",
            worstCaseScenario: parsed.varMdd.worstCaseScenario ?? "",
          }
        : null,
      catalystTracking: Array.isArray(parsed.catalystTracking)
        ? parsed.catalystTracking.map((c: any) => ({
            ticker: c.ticker ?? "",
            companyName: c.companyName ?? "",
            thesisCore: c.thesisCore ?? "",
            catalystStatus: c.catalystStatus ?? "진행중",
            nextMilestone: c.nextMilestone ?? "",
            hardStop: c.hardStop ?? "",
          }))
        : [],
      positionSizing: Array.isArray(parsed.positionSizing)
        ? parsed.positionSizing.map((p: any) => ({
            ticker: p.ticker ?? "",
            companyName: p.companyName ?? "",
            currentWeightPct: typeof p.currentWeightPct === "number" ? p.currentWeightPct : parseFloat(p.currentWeightPct) || 0,
            suggestedWeightPct: typeof p.suggestedWeightPct === "number" ? p.suggestedWeightPct : parseFloat(p.suggestedWeightPct) || 0,
            action: p.action ?? "hold",
            rationale: p.rationale ?? "",
          }))
        : [],
      liquidityRisk: parsed.liquidityRisk ?? "",
      correlationAlert: parsed.correlationAlert ?? "",
      portfolioView: parsed.portfolioView ?? "",
      concentration: parsed.concentration ?? "",
      rebalancing: parsed.rebalancing ?? "",
      sectorRecommendations: Array.isArray(parsed.sectorRecommendations)
        ? parsed.sectorRecommendations.map((r: any) => ({
            sector: r.sector ?? "",
            reason: r.reason ?? "",
            exampleTickers: Array.isArray(r.exampleTickers) ? r.exampleTickers : [],
          }))
        : [],
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[portfolio-review] error:", err);
    res.status(500).json({ error: "리뷰 생성 중 오류가 발생했습니다" });
  }
});

// ── GET /api/portfolio/admin/all — 어드민: 전체 유저 포트폴리오 ───────────────
router.get("/portfolio/admin/all", async (req, res) => {
  try {
    const requesterId = getUserId(req);
    if (!requesterId) return res.status(401).json({ error: "로그인이 필요합니다." });

    const adminCheck = await pool.query(`SELECT 1 FROM admins WHERE user_id = $1`, [requesterId]);
    if ((adminCheck.rowCount ?? 0) === 0) return res.status(403).json({ error: "관리자 전용 기능입니다." });

    const search = ((req.query.search as string) ?? "").trim().toLowerCase();

    let whereClause = "WHERE 1=1";
    const params: any[] = [];
    let idx = 1;

    if (search) {
      whereClause += ` AND (LOWER(ph.ticker) LIKE $${idx} OR LOWER(ph.company_name) LIKE $${idx} OR LOWER(uc.display_name) LIKE $${idx} OR LOWER(uc.email) LIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const { rows } = await pool.query(
      `SELECT
         ph.id, ph.user_id, ph.ticker, ph.company_name,
         ph.avg_price, ph.quantity, ph.currency, ph.note, ph.added_at,
         uc.display_name AS user_display_name,
         uc.email        AS user_email
       FROM portfolio_holdings ph
       LEFT JOIN user_credits uc ON uc.user_id = ph.user_id
       ${whereClause}
       ORDER BY uc.display_name NULLS LAST, ph.added_at DESC`,
      params
    );

    // 유저별로 그룹핑
    const userMap: Record<string, {
      userId: string;
      displayName: string | null;
      email: string | null;
      holdings: any[];
    }> = {};

    for (const row of rows) {
      if (!userMap[row.user_id]) {
        userMap[row.user_id] = {
          userId: row.user_id,
          displayName: row.user_display_name,
          email: row.user_email,
          holdings: [],
        };
      }
      userMap[row.user_id].holdings.push({
        id: row.id,
        ticker: row.ticker,
        companyName: row.company_name,
        avgPrice: row.avg_price,
        quantity: row.quantity,
        currency: row.currency,
        note: row.note,
        addedAt: row.added_at,
      });
    }

    res.json({
      users: Object.values(userMap),
      totalUsers: Object.keys(userMap).length,
      totalHoldings: rows.length,
    });
  } catch (err: any) {
    console.error("[GET /portfolio/admin/all] error:", err?.message);
    res.status(500).json({ error: "DB error" });
  }
});

// ── GET /api/portfolio/news — 보유종목·관심종목 뉴스 피드 ───────────────────
interface NewsItem {
  ticker: string;
  companyName: string;
  holdingType: "portfolio" | "watchlist";
  title: string;
  source: string;
  pubDate: string; // ISO string
  url: string;
}

// 메모리 캐시: user_id → { ts, items }
const newsCache = new Map<string, { ts: number; items: NewsItem[] }>();
const NEWS_CACHE_TTL = 15 * 60 * 1000; // 15분

// HTML entity 디코드 (서버 사이드)
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

// 네이버 증권 뉴스 API (한국 종목 전용)
async function fetchNaverNews(code: string, ticker: string, companyName: string): Promise<NewsItem[]> {
  const url = `https://m.stock.naver.com/api/news/stock/${code}?page=1&pageSize=10`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const groups: any[] = await r.json();
    // 응답: 배열 of { total, items: [...] }
    const result: NewsItem[] = [];
    for (const group of groups) {
      for (const n of (group.items ?? [])) {
        const raw   = String(n.title ?? "").trim();
        const title = decodeHtmlEntities(raw);
        const source = String(n.officeName ?? "").trim();
        const link   = String(n.mobileNewsUrl ?? "").trim();
        // datetime: "YYYYMMDDHHMI" → ISO
        const dt = String(n.datetime ?? "");
        let ts = new Date().toISOString();
        if (dt.length >= 12) {
          const d = `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}T${dt.slice(8,10)}:${dt.slice(10,12)}:00+09:00`;
          const parsed = new Date(d);
          if (!isNaN(parsed.getTime())) ts = parsed.toISOString();
        }
        if (!title) continue;
        result.push({ ticker, companyName, title, source, pubDate: ts, url: link });
        if (result.length >= 6) break;
      }
      if (result.length >= 6) break;
    }
    return result;
  } catch {
    return [];
  }
}

// Yahoo Finance 검색 API (미국/해외 종목)
async function fetchYahooNews(ticker: string, companyName: string): Promise<NewsItem[]> {
  const query = encodeURIComponent(ticker);
  const url   = `https://query1.finance.yahoo.com/v1/finance/search?q=${query}&newsCount=20&enableFuzzyQuery=false&quotesCount=0`;
  const url2  = `https://query2.finance.yahoo.com/v1/finance/search?q=${query}&newsCount=20&enableFuzzyQuery=false&quotesCount=0`;

  const tryFetch = async (endpoint: string) => {
    const r = await fetch(endpoint, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<any>;
  };

  try {
    let data: any;
    try { data = await tryFetch(url); }
    catch { data = await tryFetch(url2); }

    const newsArr: any[] = data?.news ?? [];
    const tickerUpper = ticker.toUpperCase();

    // relatedTickers[0] === 해당 티커 = 주인공 기사 우선
    const scored = newsArr.map((n: any) => {
      const related: string[] = (n.relatedTickers ?? []).map((t: string) => t.toUpperCase());
      let score = 0;
      if (related[0] === tickerUpper)         score = 3;
      else if (related.includes(tickerUpper)) score = 1;
      return { n, score };
    });

    const primary   = scored.filter(s => s.score >= 3).slice(0, 6);
    const secondary = scored.filter(s => s.score === 1).slice(0, Math.max(0, 6 - primary.length));
    const picked    = [...primary, ...secondary];

    const result: NewsItem[] = [];
    for (const { n } of picked) {
      const title  = String(n.title ?? "").trim();
      const source = String(n.publisher ?? "").trim();
      const link   = String(n.link ?? "").trim();
      const ts     = typeof n.providerPublishTime === "number"
        ? new Date(n.providerPublishTime * 1000).toISOString()
        : new Date().toISOString();
      if (!title) continue;
      result.push({ ticker, companyName, title, source, pubDate: ts, url: link });
    }
    return result;
  } catch {
    return [];
  }
}

// 종목별 뉴스 fetch — 한국 종목은 네이버, 해외는 Yahoo Finance
async function fetchNewsForTicker(ticker: string, companyName: string, holdingType: "portfolio" | "watchlist"): Promise<NewsItem[]> {
  const krCode = ticker.match(/^(\d{6})(\.KS|\.KQ)?$/i)?.[1];
  const items = krCode
    ? await fetchNaverNews(krCode, ticker, companyName)
    : await fetchYahooNews(ticker, companyName);
  return items.map(item => ({ ...item, holdingType }));
}

router.get("/portfolio/news", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  // 캐시 확인 (force=true 이면 캐시 무시)
  const force = req.query.force === "true";
  const cached = newsCache.get(userId);
  if (!force && cached && Date.now() - cached.ts < NEWS_CACHE_TTL) {
    res.json({ items: cached.items, cachedAt: new Date(cached.ts).toISOString() });
    return;
  }

  try {
    // 보유종목 + 관심종목 모두 포함 (최대 20개)
    const holdingsRes = await pool.query<{ ticker: string; company_name: string; holding_type: string }>(
      `SELECT ticker, company_name, holding_type FROM portfolio_holdings WHERE user_id = $1 ORDER BY holding_type ASC, added_at DESC LIMIT 20`,
      [userId]
    );
    const holdings = holdingsRes.rows;
    if (holdings.length === 0) {
      res.json({ items: [], cachedAt: new Date().toISOString() });
      return;
    }

    // 병렬 fetch (최대 8개 동시)
    const CONCURRENCY = 8;
    const allItems: NewsItem[] = [];
    for (let i = 0; i < holdings.length; i += CONCURRENCY) {
      const batch = holdings.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(h => fetchNewsForTicker(h.ticker, h.company_name, (h.holding_type ?? "portfolio") as "portfolio" | "watchlist"))
      );
      for (const r of results) allItems.push(...r);
    }

    // 날짜 내림차순 정렬
    allItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

    // 최대 50개
    const items = allItems.slice(0, 50);
    newsCache.set(userId, { ts: Date.now(), items });
    res.json({ items, cachedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error("[portfolio/news] error:", err?.message);
    res.status(500).json({ error: "뉴스를 가져오지 못했습니다" });
  }
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
