/**
 * /api/market/live-gainers — 장중 실시간 상승률 순위 (KIS API)
 * 장 시간(09:00~15:30 KST)에만 KIS 등락률순위 API를 호출해 TOP30을 반환.
 * 5분 캐시 → 장 외 시간에는 빈 배열 반환.
 */
import { Router } from "express";
import { fetchKISLiveGainers, type KISGainerItem } from "../lib/kis-client.js";

const router = Router();

const CACHE_TTL = 5 * 60_000; // 5분

interface LiveGainersCache {
  data:     KISGainerItem[];
  cachedAt: number;
}

let memCache: LiveGainersCache | null = null;
let _fetching = false;

/** KST 09:00~15:30 평일 여부 */
function isMarketOpen(): boolean {
  const kst   = new Date(Date.now() + 9 * 3600_000);
  const dow   = kst.getUTCDay(); // 0=일, 6=토
  if (dow === 0 || dow === 6) return false;
  const h     = kst.getUTCHours();   // UTC 시각 (KST = UTC+9이므로 KST h = h+9)
  const m     = kst.getUTCMinutes();
  // KST 09:00~15:30 = UTC 00:00~06:30
  const minUTC = h * 60 + m;
  return minUTC >= 0 && minUTC <= 390;
}

function isFresh(): boolean {
  return !!memCache && Date.now() - memCache.cachedAt < CACHE_TTL;
}

async function fetchAndCache(): Promise<KISGainerItem[]> {
  if (_fetching) return memCache?.data ?? [];
  _fetching = true;
  try {
    const data = await fetchKISLiveGainers(30);
    if (data.length > 0) {
      memCache = { data, cachedAt: Date.now() };
      console.log(`[live-gainers] 갱신 완료: ${data.length}개 (상위 ${data[0]?.change.toFixed(1)}%)`);
    }
    return data;
  } catch (err) {
    console.error("[live-gainers] KIS 조회 실패:", (err as any)?.message);
    return memCache?.data ?? [];
  } finally {
    _fetching = false;
  }
}

/* ── GET /api/market/live-gainers ──────────────────────────────────────── */
router.get("/market/live-gainers", async (_req, res) => {
  const open = isMarketOpen();

  if (!open) {
    return res.json({
      data:       memCache?.data ?? [],
      marketOpen: false,
      cachedAt:   memCache?.cachedAt ?? null,
    });
  }

  // 신선한 캐시 → 즉시 반환
  if (isFresh()) {
    return res.json({
      data:       memCache!.data,
      marketOpen: true,
      cachedAt:   memCache!.cachedAt,
    });
  }

  // 캐시 만료 → 갱신 후 반환
  const data = await fetchAndCache();
  return res.json({
    data,
    marketOpen: true,
    cachedAt:   memCache?.cachedAt ?? Date.now(),
    stale:      data.length === 0,
  });
});

export default router;
