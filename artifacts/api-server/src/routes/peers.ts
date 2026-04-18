import { Router, type IRouter } from "express";
import {
  collectPeers,
  getLatestPeers,
  getPeerHistory,
  getPeersByDate,
  updateManualFields,
  computePeerAverages,
} from "../lib/peer-collector.js";

const router: IRouter = Router();

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
