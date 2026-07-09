/**
 * /api/market/presurge — 급등 전조 종목 스캔
 * 최근 15영업일 KOSPI+KOSDAQ 전 종목 OHLCV를 분석해
 * 거래량 수축→팽창·박스권·이동평균 정배열 등 기술적 전조 신호 종목을 반환.
 *
 * 캐시 전략:
 * - "내일 종목"은 하루 종일 유효 → 메모리 TTL 24시간
 * - DB에는 36시간 보관 (서버 재시작 시 즉시 복원)
 * - 오래된 캐시도 항상 먼저 반환 → 백그라운드에서 갱신
 * - 유저는 절대 빈 화면을 보지 않음
 */
import { Router } from "express";
import { fetchPresurgeScan, type PresurgeScanResult } from "../lib/pykrx-client.js";
import { pool } from "@workspace/db";
import { saveDailyPicks, getPresurgePickAccuracy } from "../lib/presurge-tracker.js";

const router = Router();

const CACHE_KEY   = "presurge_scan_v1";
const FRESH_MS    = 24 * 3600_000;   // 24시간: 이 이내면 "신선"
const STALE_MS    = 36 * 3600_000;   // 36시간: 이 이내면 stale-serve 가능

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

/** expires_at 무관하게 저장된 최신 데이터를 가져옴 (항상 복원) */
async function loadFromDB(): Promise<CachedPresurge | null> {
  try {
    const r = await pool.query<{ data: CachedPresurge }>(
      `SELECT data FROM system_cache WHERE key = $1 LIMIT 1`,
      [CACHE_KEY],
    );
    return r.rows[0]?.data ?? null;
  } catch { return null; }
}

async function saveToDB(cached: CachedPresurge): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '36 hours')
       ON CONFLICT (key) DO UPDATE
         SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [CACHE_KEY, JSON.stringify(cached)],
    );
  } catch { /* silent */ }
}

/* ── 캐시 신선도 ────────────────────────────────────────────────────── */

/** 데이터가 있으면 (오래됐어도) 서빙 가능 */
function hasData(c: CachedPresurge | null): c is CachedPresurge {
  return !!c && c.result.candidates.length > 0;
}

/** 24시간 이내 = 신선 (갱신 불필요) */
function isFresh(c: CachedPresurge): boolean {
  return Date.now() - c.cachedAt < FRESH_MS;
}

/* ── 스캔 실행 ─────────────────────────────────────────────────────── */
let scanning = false;

async function runScan(): Promise<CachedPresurge> {
  if (scanning) {
    // 이미 실행 중이면 현재 캐시 반환
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
    // pykrx 실패 등으로 0건이면 기존 캐시 보존 (빈 결과로 덮어쓰지 않음)
    if (result.candidates.length === 0) {
      console.log("[presurge] 스캔 0건 — 기존 캐시 유지 (덮어쓰기 생략)");
      return memCache ?? { result, cachedAt: Date.now() };
    }
    const cached: CachedPresurge = { result, cachedAt: Date.now() };
    memCache = cached;
    await saveToDB(cached);
    saveDailyPicks(result.candidates, result.scannedAt).catch(e =>
      console.error("[presurge] 픽 스냅샷 저장 실패:", e?.message ?? e)
    );
    return cached;
  } finally {
    scanning = false;
  }
}

/* ── 서버 시작 시 DB 복원 ─────────────────────────────────────────── */
loadFromDB().then(db => {
  if (hasData(db)) {
    memCache = db;
    const ageMin = Math.round((Date.now() - db.cachedAt) / 60_000);
    console.log(`[presurge] DB 캐시 복원 (${db.result.candidates.length}개, ${ageMin}분 전) — 즉시 서빙 가능`);
    // 오래됐으면 백그라운드에서 조용히 갱신 (유저는 기존 데이터 봄)
    if (!isFresh(db)) {
      console.log(`[presurge] 캐시 ${ageMin}분 경과 — 백그라운드 갱신 시작`);
      setTimeout(() => {
        runScan()
          .then(c => console.log(`[presurge] 백그라운드 갱신 완료: ${c.result.candidates.length}개`))
          .catch(e => console.error("[presurge] 백그라운드 갱신 실패:", e));
      }, 15_000);
    }
  } else {
    // 데이터 자체가 없을 때만 스캔 대기 (첫 실행 등)
    const reason = db ? `DB 후보 0개` : "캐시 없음";
    console.log(`[presurge] ${reason} — 15초 후 초기 스캔 시작`);
    setTimeout(() => {
      runScan()
        .then(c => console.log(`[presurge] 초기 스캔 완료: ${c.result.candidates.length}개`))
        .catch(e => console.error("[presurge] 초기 스캔 실패:", e));
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
  // 데이터가 있으면 항상 즉시 반환 (스캔 중이어도, 오래됐어도)
  if (hasData(memCache)) {
    // 오래됐고 스캔 안 중이면 백그라운드 갱신 트리거
    if (!isFresh(memCache) && !scanning) {
      runScan()
        .then(c => console.log(`[presurge] 스테일 갱신 완료: ${c.result.candidates.length}개`))
        .catch(e => console.error("[presurge] 스테일 갱신 실패:", e));
    }
    return res.json({
      data:        memCache.result.candidates,
      backtest:    memCache.result.backtest,
      tradingDays: memCache.result.tradingDays,
      cachedAt:    memCache.cachedAt,
      scanning:    scanning,  // 갱신 중임을 알려주되 기존 데이터 제공
    });
  }

  // 데이터가 전혀 없을 때만 "스캔 중" 반환
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
    const cached = await runScan();
    return res.json({
      data:        cached.result.candidates,
      backtest:    cached.result.backtest,
      tradingDays: cached.result.tradingDays,
      cachedAt:    cached.cachedAt,
      scanning:    false,
    });
  } catch (err) {
    console.error("[presurge] refresh 오류:", err);
    // 강제 새로고침 실패해도 기존 캐시라도 반환
    if (hasData(memCache)) {
      return res.json({
        data:        memCache.result.candidates,
        backtest:    memCache.result.backtest,
        tradingDays: memCache.result.tradingDays,
        cachedAt:    memCache.cachedAt,
        scanning:    false,
      });
    }
    return res.status(500).json({ error: "스캔 실패" });
  }
});

/* ── GET /market/presurge/accuracy ────────────────────────────────── */
// 실제 픽 적중률 추적: 매 스캔의 후보 스냅샷 → 다음 거래일 종가 확인 → 익일 등락률 집계.
// 오늘부터 순방향으로 데이터가 쌓이므로, 서비스 시작 초기에는 표본이 적을 수 있음.
router.get("/market/presurge/accuracy", async (_req, res) => {
  try {
    const accuracy = await getPresurgePickAccuracy();
    return res.json(accuracy);
  } catch (err) {
    console.error("[presurge] accuracy 조회 오류:", err);
    return res.status(500).json({ error: "적중률 조회 실패" });
  }
});

export default router;
