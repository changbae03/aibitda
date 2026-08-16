import { Router, type IRouter } from "express";
import { getPeersWithMetrics, getSectorPeers } from "../lib/peer-store.js";
import { pool } from "@workspace/db";
import { normalizeTicker } from "@workspace/shared";
import {
  collectPeers,
  getLatestPeers,
  getPeerHistory,
  getPeersByDate,
  updateManualFields,
  computePeerAverages,
} from "../lib/peer-collector.js";

const router: IRouter = Router();

/**
 * GET /api/peers/compare/:ticker — **리포트에 띄우는 피어 비교.**
 *
 * `/latest`는 밸류에이션 시절 스냅샷 표를 본다. 그 표는 채워지지 않아 운영에서
 * 늘 "데이터 없음"이었다. 지표는 이미 종목 마스터(`stocks` 뷰)에 한국 2,800 +
 * 미국 10,400 종목분이 정리돼 있으니 **외부 API로 다시 받지 않는다.**
 *
 * AI가 고른 피어(`stock_peers`)를 먼저 쓰고, 없으면 업종·시총이 비슷한 종목으로 채운다.
 */
router.get("/compare/:ticker", async (req, res) => {
  try {
    const ticker = normalizeTicker(req.params.ticker);
    if (!ticker) { res.status(400).json({ error: "종목코드가 올바르지 않습니다" }); return; }

    let peers = await getPeersWithMetrics(ticker, 6);
    let source: "ai" | "sector" = "ai";
    // AI가 아직 고른 적 없는 종목(분석 전)은 업종 피어로 대신한다.
    if (peers.length === 0) { peers = await getSectorPeers(ticker, 5); source = "sector"; }

    const { rows } = await pool.query(
      `SELECT ticker, name, market, sector, per, pbr, roe, opm, market_cap, current_price
         FROM stocks WHERE ticker = $1 LIMIT 1`, [ticker]);

    res.json({ subject: rows[0] ?? null, peers, source });
  } catch (e: any) {
    console.error("[peers] compare 실패:", e?.message);
    res.status(500).json({ error: "피어 비교를 불러오지 못했습니다" });
  }
});

// POST /api/peers/collect
router.post("/collect", async (req, res) => {
  const { subject, subject_name, peers } = req.body as {
    subject?: string;
    subject_name?: string;
    peers?: string[];
  };

  if (!subject || !Array.isArray(peers) || peers.length === 0) {
    return res.status(400).json({ error: "subject, peers[] 필수" });
  }

  try {
    const snapshot = await collectPeers(subject, subject_name ?? subject, peers);
    const averages = computePeerAverages(snapshot.peers);
    return res.json({ ...snapshot, averages });
  } catch (err) {
    console.error("[peers] collect error:", err);
    return res.status(500).json({ error: "수집 중 오류 발생" });
  }
});

// GET /api/peers/latest?subject=xxx
router.get("/latest", async (req, res) => {
  const { subject } = req.query as { subject?: string };
  if (!subject) return res.status(400).json({ error: "subject 필수" });

  const snapshot = await getLatestPeers(subject);
  if (!snapshot) return res.status(404).json({ error: "데이터 없음" });

  const averages = computePeerAverages(snapshot.peers);
  return res.json({ ...snapshot, averages });
});

// GET /api/peers/history?subject=xxx
router.get("/history", async (req, res) => {
  const { subject } = req.query as { subject?: string };
  if (!subject) return res.status(400).json({ error: "subject 필수" });
  const dates = await getPeerHistory(subject);
  return res.json({ subject, dates });
});

// GET /api/peers/by-date?subject=xxx&date=20260418
router.get("/by-date", async (req, res) => {
  const { subject, date } = req.query as { subject?: string; date?: string };
  if (!subject || !date) return res.status(400).json({ error: "subject, date 필수" });
  const snapshot = await getPeersByDate(subject, date);
  if (!snapshot) return res.status(404).json({ error: "해당 날짜 데이터 없음" });
  const averages = computePeerAverages(snapshot.peers);
  return res.json({ ...snapshot, averages });
});

// PATCH /api/peers/manual — 수동 입력 (per_fwd 등)
router.patch("/manual", async (req, res) => {
  const { subject, ticker, fields } = req.body as {
    subject?: string;
    ticker?: string;
    fields?: { per_fwd?: number | null };
  };
  if (!subject || !ticker || !fields) {
    return res.status(400).json({ error: "subject, ticker, fields 필수" });
  }
  const updated = await updateManualFields(subject, ticker, fields);
  if (!updated) return res.status(404).json({ error: "데이터 없음" });
  return res.json(updated);
});

export default router;
