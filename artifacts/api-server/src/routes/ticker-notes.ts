import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

// GET /api/ticker-notes — 메모가 있는 전체 종목 목록
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT ticker, memo, auto_learning, updated_at
       FROM ticker_notes
       ORDER BY updated_at DESC NULLS LAST`
    );
    res.json(result.rows.map(r => ({
      ticker: r.ticker,
      memo: r.memo ?? "",
      autoLearning: r.auto_learning ?? "",
      updatedAt: r.updated_at ?? null,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// GET /api/ticker-notes/:ticker — 종목별 관리자 메모 조회
router.get("/:ticker", async (req, res) => {
  const ticker = (req.params.ticker ?? "").toUpperCase();
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  try {
    const result = await pool.query(
      `SELECT memo, updated_at FROM ticker_notes WHERE ticker = $1`,
      [ticker]
    );
    const row = result.rows[0];
    res.json({ ticker, memo: row?.memo ?? "", updatedAt: row?.updated_at ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// PUT /api/ticker-notes/:ticker — 종목별 관리자 메모 저장/수정
router.put("/:ticker", async (req, res) => {
  const ticker = (req.params.ticker ?? "").toUpperCase();
  const memo: string = req.body?.memo ?? "";
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  try {
    await pool.query(
      `INSERT INTO ticker_notes (ticker, memo, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (ticker) DO UPDATE SET memo = $2, updated_at = NOW()`,
      [ticker, memo.trim()]
    );
    res.json({ ok: true, ticker, memo: memo.trim() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

export default router;
