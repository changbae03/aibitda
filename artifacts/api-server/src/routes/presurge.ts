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

/* ── 서버 시작 시 DB 복원 → 없으면 자동 스캔 ───────────────────────── */
loadFromDB().then(db => {
  if (db && isCacheValid(db)) {
    memCache = db;
    console.log(`[presurge] DB 캐시 복원 (${db.result.candidates.length}개) — 즉시 서빙 가능`);
  } else {
    const reason = db ? `DB 캐시 무효 (${db.result.candidates.length}개)` : "캐시 없음";
    console.log(`[presurge] ${reason} — 15초 후 자동 스캔 시작`);
    setTimeout(() => {
      runScan()
        .then(c => console.log(`[presurge] 자동 스캔 완료: ${c.result.candidates.length}개`))
        .catch(e => console.error("[presurge] 자동 스캔 실패:", e));
    }, 15_000);
  }
}).catch(() => {});

/* ── 매일 17:30 KST 정기 스캔 스케줄 ───────────────────────────────── */
(function scheduleDailyRefresh() {
  const kstNow   = new Date(Date.now() + 9 * 3600_000);
  const nextRun  = new Date(kstNow);
  nextRun.setUTCHours(8, 30, 0, 0); // 17:30 KST = 08:30 UTC
  if (nextRun <= kstNow) nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  const msUntil = nextRun.getTime() - kstNow.getTime();
  setTimeout(() => {
    console.log("[presurge] 정기 스캔 시작 (17:30 KST)");
    runScan()
      .then(c => console.log(`[presurge] 정기 스캔 완료: ${c.result.candidates.length}개`))
      .catch(e => console.error("[presurge] 정기 스캔 실패:", e));
    scheduleDailyRefresh();
  }, msUntil);
  console.log(`[presurge] 다음 정기 스캔: ${Math.round(msUntil / 60000)}분 후 (17:30 KST)`);
})();

/* ── GET /market/presurge ─────────────────────────────────────────── */
router.get("/market/presurge", (_req, res) => {
  // 스캔 중이면 즉시 반환 (클라이언트가 폴링)
  if (scanning) {
    return res.json({
      data:        memCache?.result.candidates ?? [],
      backtest:    memCache?.result.backtest    ?? null,
      tradingDays: memCache?.result.tradingDays ?? 0,
      cachedAt:    memCache?.cachedAt           ?? null,
      scanning:    true,
    });
  }
  // 유효 캐시 있으면 즉시 반환
  if (memCache && isCacheValid(memCache)) {
    return res.json({
      data:        memCache.result.candidates,
      backtest:    memCache.result.backtest,
      tradingDays: memCache.result.tradingDays,
      cachedAt:    memCache.cachedAt,
      scanning:    false,
    });
  }
  // 캐시 없음 — 백그라운드 스캔 트리거 후 즉시 반환
  if (!scanning) {
    runScan()
      .then(c => console.log(`[presurge] 온디맨드 스캔 완료: ${c.result.candidates.length}개`))
      .catch(e => console.error("[presurge] 온디맨드 스캔 실패:", e));
  }
  return res.json({ data: [], backtest: null, tradingDays: 0, cachedAt: null, scanning: true });
});

/* ── POST /market/presurge/refresh ────────────────────────────────── */
router.post("/market/presurge/refresh", async (_req, res) => {
  try {
    const cached = await getCached(true);
    return res.json({
      data:        cached.result.candidates,
      backtest:    cached.result.backtest,
      tradingDays: cached.result.tradingDays,
      cachedAt:    cached.cachedAt,
      scanning:    false,
    });
  } catch (err) {
    console.error("[presurge] refresh 오류:", err);
    return res.status(500).json({ error: "스캔 실패" });
  }
});

export default router;
