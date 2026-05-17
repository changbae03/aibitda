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

// ── 최신 분석 조회 ────────────────────────────────────────────────────────────
async function fetchLatestAnalysis(ticker: string) {
  const { rows } = await pool.query(`
    SELECT id, target_price, entry_price, stop_loss, investment_verdict,
           qa_score, created_at, risk_reward_ratio,
           (SELECT content FROM analysis_steps
            WHERE analysis_id = analyses.id AND step_key = 'key_catalysts'
            LIMIT 1) AS catalysts,
           (SELECT content FROM analysis_steps
            WHERE analysis_id = analyses.id AND step_key = 'risk_factors'
            LIMIT 1) AS risks
    FROM analyses
    WHERE ticker = $1 AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  `, [ticker]);
  return rows[0] ?? null;
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
      fetchLatestAnalysis(row.ticker),
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

// ── GET /api/portfolio/changes/:ticker — 분석 이력 변화 감지 ────────────────
router.get("/portfolio/changes/:ticker", async (req, res) => {
  const ticker = String(req.params.ticker).trim().toUpperCase();

  // 최근 완료된 분석 3개 조회 (비교용)
  const { rows } = await pool.query(`
    SELECT
      a.id, a.investment_verdict, a.target_price, a.created_at,
      (SELECT content FROM analysis_steps
       WHERE analysis_id = a.id AND step_key = 'key_catalysts' LIMIT 1) AS catalysts,
      (SELECT content FROM analysis_steps
       WHERE analysis_id = a.id AND step_key = 'risk_factors' LIMIT 1) AS risks
    FROM analyses a
    WHERE a.ticker = $1 AND a.status = 'completed'
    ORDER BY a.created_at DESC
    LIMIT 3
  `, [ticker]);

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
