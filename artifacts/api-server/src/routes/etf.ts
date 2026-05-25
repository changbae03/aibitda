import { Router } from "express";
import {
  ALL_ETFS,
  searchEtf,
  getEtfHoldings,
  getStockExposure,
  getSectorRotation,
  getTimingSignals,
  getUnifiedSignals,
  getMomentumAnalysis,
  miraePreFetchAllHoldings,
} from "../lib/etf-analyzer.js";
import { getCachedTigerEtfs } from "../lib/tiger-etf-scraper.js";
import { getStatus } from "../lib/lstm-predictor.js";

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
  const tigerEtfs = getCachedTigerEtfs() as any[];
  const existingCodes = new Set(ALL_ETFS.map(e => e.code));
  const merged = [...ALL_ETFS, ...tigerEtfs.filter(e => !existingCodes.has(e.code))];
  res.json(merged);
});

// GET /api/etf/search?q=
router.get("/etf/search", (req, res) => {
  const q = String(req.query.q ?? "");
  const tigerEtfs = getCachedTigerEtfs() as any[];
  res.json(searchEtf(q, tigerEtfs));
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

// GET /api/etf/unified-signals
router.get("/etf/unified-signals", async (_req, res) => {
  try {
    // AI 예측 방향 추출 (없으면 neutral)
    const status = getStatus();
    const toAiSig = (idx: any) => ({
      direction: (idx?.agreementSignal ?? "neutral") as "up" | "down" | "neutral",
      strength:  idx?.agreementStrength ?? 0,
    });
    const aiSignals = {
      kospi:  toAiSig(status.kospi),
      nasdaq: toAiSig(status.nasdaq),
    };

    const cacheKey = `unified-signals:${aiSignals.kospi.direction}:${aiSignals.nasdaq.direction}`;
    const data = await cached(cacheKey, TTL.signals, () => getUnifiedSignals(aiSignals));

    res.json({
      signals:   data,
      aiContext: {
        kospi:  aiSignals.kospi,
        nasdaq: aiSignals.nasdaq,
        ready:  status.ready ?? false,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// GET /api/etf/:code/holdings
router.get("/etf/:code/holdings", async (req, res) => {
  try {
    const code = req.params.code.replace(/[^0-9A-Za-z]/g, "").slice(0, 10);
    // TIGER 스크래핑분의 isuCd를 주입하여 KRX 조회 가능하게
    const tigerEtfs = getCachedTigerEtfs();
    const tigerEtf  = tigerEtfs.find((e: any) => e.code === code);
    const { holdings, source, dataDate } = await getEtfHoldings(code, tigerEtf?.isuCd);
    const etf = ALL_ETFS.find(e => e.code === code) ?? (tigerEtf as any) ?? null;
    res.json({ etf, holdings, source, dataDate });
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

// POST /api/etf/prefetch-holdings
// 미래에셋 세션 1개로 모든 TIGER ETF holdings를 일괄 사전로딩
router.post("/etf/prefetch-holdings", async (_req, res) => {
  try {
    const tigerEtfs = getCachedTigerEtfs() as any[];
    // MAJOR_ETFS + tiger scraper에서 미래에셋 isuCd가 있는 것만
    const miraeIsuCds = [
      ...ALL_ETFS.filter(e => e.isuCd.startsWith("KR7") && e.issuer === "미래에셋").map(e => e.isuCd),
      ...tigerEtfs.filter(e => e.isuCd?.startsWith("KR7")).map((e: any) => e.isuCd),
    ];
    // 중복 제거
    const unique = [...new Set(miraeIsuCds)];
    const result = await miraePreFetchAllHoldings(unique);
    res.json({ ...result, total: unique.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// GET /api/etf/momentum-analysis
router.get("/etf/momentum-analysis", async (_req, res) => {
  try {
    const data = await cached("momentum-analysis", 30 * 60_000, getMomentumAnalysis);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

export default router;
