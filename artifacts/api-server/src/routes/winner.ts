/**
 * winner.ts — 오늘 급등 종목 & 피드백 루프 API 라우트
 *
 *  GET /market/winners/today          — 오늘 수집된 급등 종목 목록
 *  GET /market/winners/summary        — 적중률 요약 (presurge/tomorrow 히트율)
 *  GET /market/winners/patterns       — AI 패턴 인사이트 리포트
 *  POST /market/winners/collect       — 수동 수집 트리거 (관리자/테스트용)
 */

import { Router } from "express";
import {
  collectTodayWinners,
  getWinnerHitSummary,
  initDailyWinnersTable,
} from "../lib/daily-winners.js";
import { getWinnerPatternReport } from "../lib/winner-pattern.js";
import { pool } from "@workspace/db";

const router = Router();

// ─── 오늘 급등 종목 목록 ─────────────────────────────────────────────────────

router.get("/market/winners/today", async (req, res) => {
  try {
    await initDailyWinnersTable();
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 100);
    const { rows } = await pool.query(
      `SELECT
         ticker, name, market, close, change_pct, volume,
         turnover_aek, volume_ratio_75th,
         institution_aek, foreign_aek, smart_money_aek,
         was_presurge_pick, was_tomorrow_pick, presurge_score,
         trade_date::text
       FROM daily_winners
       ORDER BY trade_date DESC, change_pct DESC
       LIMIT $1`,
      [limit],
    );
    res.json({ ok: true, count: rows.length, data: rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// ─── 적중률 요약 ─────────────────────────────────────────────────────────────

router.get("/market/winners/summary", async (_req, res) => {
  try {
    const summary = await getWinnerHitSummary();
    res.json({ ok: true, ...summary });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// ─── AI 패턴 인사이트 ─────────────────────────────────────────────────────────

router.get("/market/winners/patterns", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";
    const report = await getWinnerPatternReport(forceRefresh);
    res.json({ ok: true, ...report });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// ─── 수동 수집 트리거 ────────────────────────────────────────────────────────

router.post("/market/winners/collect", async (req, res) => {
  try {
    const dateStr = req.body?.date as string | undefined;
    const result = await collectTodayWinners(dateStr);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

export default router;
