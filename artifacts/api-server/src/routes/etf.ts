import { Router } from "express";
import {
  MAJOR_ETFS,
  searchEtf,
  getEtfHoldings,
  getStockExposure,
  getSectorRotation,
  getTimingSignals,
} from "../lib/etf-analyzer.js";

const router = Router();

const cache = new Map<string, { data: any; ts: number }>();
const TTL = { rotation: 30 * 60_000, signals: 30 * 60_000 };

function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data as T);
  return fn().then(data => { cache.set(key, { data, ts: Date.now() }); return data; });
}

// GET /api/etf/list
router.get("/etf/list", (_req, res) => {
  res.json(MAJOR_ETFS);
});

// GET /api/etf/search?q=
router.get("/etf/search", (req, res) => {
  const q = String(req.query.q ?? "");
  res.json(searchEtf(q));
});

// GET /api/etf/sector-rotation
router.get("/etf/sector-rotation", async (_req, res) => {
  try {
    const data = await cached("sector-rotation", TTL.rotation, getSectorRotation);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// GET /api/etf/timing-signals
router.get("/etf/timing-signals", async (_req, res) => {
  try {
    const data = await cached("timing-signals", TTL.signals, getTimingSignals);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// GET /api/etf/:code/holdings
router.get("/etf/:code/holdings", async (req, res) => {
  try {
    const code = req.params.code.replace(/[^0-9A-Za-z]/g, "").slice(0, 10);
    const data = await getEtfHoldings(code);
    const etf  = MAJOR_ETFS.find(e => e.code === code);
    res.json({ etf: etf ?? null, holdings: data });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// GET /api/etf/stock/:query/exposure
router.get("/etf/stock/:query/exposure", async (req, res) => {
  try {
    const query = decodeURIComponent(req.params.query);
    const data  = await getStockExposure(query);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

export default router;
