/**
 * /api/market/presurge — 급등 전조 종목 스캔
 * 최근 15영업일 KOSPI+KOSDAQ 전 종목 OHLCV를 분석해
 * 거래량 수축→팽창·박스권·이동평균 정배열 등 기술적 전조 신호 종목을 반환.
 */
import { Router } from "express";
import { fetchPresurgeScan, type PresurgeScanResult } from "../lib/pykrx-client.js";
import { pool } from "@workspace/db";

const router = Router();

const CACHE_KEY = "presurge_scan_v1";
const TTL_MS    = 60 * 60 * 1000;   // 1시간 (장 중 충분)

interface CachedPresurge {
  result:    PresurgeScanResult;
  cachedAt:  number;
}

let memCache: CachedPresurge | null = null;

/* ── KST 날짜 유틸 ────────────────────────────────────────────────── */
function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** 영업일 기준 N일 전 날짜 (주말 보정, 간략) */
function businessDaysAgo(n: number): string {
  let d = new Date(Date.now() + 9 * 3600_000);
  let count = 0;
  while (count < n) {
    d = new Date(d.getTime() - 86_400_000);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/* ── DB 캐시 ───────────────────────────────────────────────────────── */
async function loadFromDB(): Promise<CachedPresurge | null> {
  try {
    const r = await pool.query<{ data: CachedPresurge }>(
      `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW() LIMIT 1`,
      [CACHE_KEY],
    );
    return r.rows[0]?.data ?? null;
  } catch { return null; }
}

async function saveToDB(cached: CachedPresurge): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '2 hours')
       ON CONFLICT (key) DO UPDATE
         SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [CACHE_KEY, JSON.stringify(cached)],
    );
  } catch { /* silent */ }
}

/* ── 스캔 실행 ─────────────────────────────────────────────────────── */
let scanning = false;

async function runScan(): Promise<CachedPresurge> {
  if (scanning) {
    // 이미 실행 중이면 현재 캐시 반환 (없으면 대기)
    await new Promise(r => setTimeout(r, 1000));
    return memCache ?? { result: { candidates: [], backtest: null, tradingDays: 0, scannedAt: "" }, cachedAt: Date.now() };
  }
  scanning = true;
  try {
    const today  = kstDateStr(0);
    const from   = businessDaysAgo(22); // 22 영업일 = 여유 있게 15영업일치 확보
    console.log(`[presurge] 스캔 시작: ${from} ~ ${today}`);
    const result = await fetchPresurgeScan(from, today);
    console.log(`[presurge] 완료: ${result.candidates.length}개 전조 종목`);
    const cached: CachedPresurge = { result, cachedAt: Date.now() };
    memCache = cached;
    await saveToDB(cached);
    return cached;
  } finally {
    scanning = false;
  }
}

/* ── 캐시 유효성 검사 ───────────────────────────────────────────────── */
function isCacheValid(c: CachedPresurge): boolean {
  return c.result.candidates.length > 0 && Date.now() - c.cachedAt < TTL_MS;
}

/* ── 캐시 조회 (메모리 → DB → 스캔) ───────────────────────────────── */
async function getCached(forceRefresh = false): Promise<CachedPresurge> {
  if (!forceRefresh && memCache && isCacheValid(memCache)) {
    return memCache;
  }
  if (!forceRefresh) {
    const db = await loadFromDB();
    if (db && isCacheValid(db)) {
      memCache = db;
      return db;
    }
  }
  return runScan();
}

/* ── 서버 시작 시 DB 복원 (유효한 결과만 복원) ──────────────────────── */
loadFromDB().then(db => {
  if (db && isCacheValid(db)) {
    memCache = db;
    console.log(`[presurge] DB 캐시 복원 (${db.result.candidates.length}개)`);
  } else if (db) {
    console.log(`[presurge] DB 캐시 무효 (${db.result.candidates.length}개) — 첫 요청 시 재스캔`);
  }
}).catch(() => {});

/* ── GET /market/presurge ─────────────────────────────────────────── */
router.get("/market/presurge", async (_req, res) => {
  try {
    const cached = await getCached();
    return res.json({
      data:       cached.result.candidates,
      backtest:   cached.result.backtest,
      tradingDays: cached.result.tradingDays,
      cachedAt:   cached.cachedAt,
      cached:     true,
    });
  } catch (err) {
    console.error("[presurge] GET 오류:", err);
    return res.status(500).json({ error: "스캔 실패" });
  }
});

/* ── POST /market/presurge/refresh ────────────────────────────────── */
router.post("/market/presurge/refresh", async (_req, res) => {
  try {
    const cached = await getCached(true);
    return res.json({
      data:       cached.result.candidates,
      backtest:   cached.result.backtest,
      tradingDays: cached.result.tradingDays,
      cachedAt:   cached.cachedAt,
      cached:     false,
    });
  } catch (err) {
    console.error("[presurge] refresh 오류:", err);
    return res.status(500).json({ error: "스캔 실패" });
  }
});

export default router;
