/**
 * /api/market/tomorrow-picks
 * 핫 테마 피드 데이터를 분석해 "내일 상승 후보" 종목을 스코어링해 반환합니다.
 *
 * 알고리즘:
 *  - themeHeat   : 테마 내 종목 평균 등락률 (테마가 얼마나 달아오르나)
 *  - laggardScore: 테마 평균 대비 개별 종목 등락 갭 (아직 안 오른 종목 탐색)
 *  - volumeScore : 거래량 비율 (조용한 수급 유입 포착)
 *  - finalScore  = themeHeat×0.25 + laggardScore×0.45 + volumeScore×0.30
 *
 * 캐시: system_cache 테이블, 3시간 TTL
 */
import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

const PICKS_CACHE_KEY = "tomorrow_picks_v1";
const THEMES_CACHE_KEY = "themes_feed_cache_v19";
const TTL_MS = 3 * 60 * 60 * 1000;

interface FeedStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  rationale?: string;
  priceChange?: number;
  volumeRatio?: number;
  isLeader?: boolean;
}

interface ThemeFeedItem {
  id: string;
  name: string;
  description: string;
  emoji: string;
  summary: string;
  stocks: FeedStock[];
}

export interface TomorrowPick {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  theme: string;
  themeEmoji: string;
  themeHeat: number;
  priceChange: number;
  volumeRatio: number;
  laggardGap: number;
  finalScore: number;
  signals: string[];
  rationale: string;
}

function scorePicks(feed: ThemeFeedItem[]): TomorrowPick[] {
  const seen = new Map<string, TomorrowPick>();

  for (const theme of feed) {
    const krStocks = theme.stocks.filter(s => s.market === "KR");
    if (krStocks.length === 0) continue;

    const changes = krStocks.map(s => s.priceChange ?? 0);
    const positiveChanges = changes.filter(c => c > 0);
    const themeHeat =
      positiveChanges.length > 0
        ? positiveChanges.reduce((a, b) => a + b, 0) / positiveChanges.length
        : changes.reduce((a, b) => a + b, 0) / changes.length;

    if (themeHeat < 0.3) continue;

    for (const s of krStocks) {
      const change = s.priceChange ?? 0;
      const volRatio = s.volumeRatio ?? 1;

      if (change > themeHeat * 2.0) continue;
      if (volRatio < 0.6) continue;

      const laggardGap = Math.max(0, themeHeat - change);
      const normGap = Math.min(laggardGap / Math.max(themeHeat, 0.5), 1);
      const normHeat = Math.min(themeHeat / 8, 1);
      const normVol = Math.min(Math.max(0, volRatio - 0.8) / 2.2, 1);

      const finalScore = normHeat * 0.25 + normGap * 0.45 + normVol * 0.30;

      const signals: string[] = [];
      if (themeHeat >= 4) signals.push("테마 강세");
      else if (themeHeat >= 2) signals.push("테마 상승");
      if (laggardGap >= 2.5) signals.push("미반영 구간");
      else if (laggardGap >= 1) signals.push("상대 지연");
      if (volRatio >= 2.5) signals.push("거래량 급증");
      else if (volRatio >= 1.5) signals.push("거래량 증가");
      else if (volRatio >= 1.1) signals.push("수급 유입");
      if (s.isLeader) signals.push("주도주");

      const pick: TomorrowPick = {
        ticker: s.ticker,
        name: s.name,
        market: s.market,
        sector: s.sector,
        theme: theme.name,
        themeEmoji: theme.emoji,
        themeHeat: Math.round(themeHeat * 10) / 10,
        priceChange: Math.round(change * 10) / 10,
        volumeRatio: Math.round(volRatio * 10) / 10,
        laggardGap: Math.round(laggardGap * 10) / 10,
        finalScore: Math.round(finalScore * 1000) / 1000,
        signals,
        rationale: s.rationale ?? "",
      };

      const existing = seen.get(s.ticker);
      if (!existing || finalScore > existing.finalScore) {
        seen.set(s.ticker, pick);
      }
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 25);
}

async function loadFromDB(): Promise<{ data: TomorrowPick[]; cachedAt: string } | null> {
  try {
    const r = await pool.query(
      "SELECT data, expires_at FROM system_cache WHERE key=$1 AND expires_at > NOW() LIMIT 1",
      [PICKS_CACHE_KEY],
    );
    if (r.rows.length > 0) {
      const raw = r.rows[0].data;
      const parsed: TomorrowPick[] = Array.isArray(raw) ? raw : (typeof raw === "string" ? JSON.parse(raw) : raw);
      return {
        data: parsed,
        cachedAt: r.rows[0].expires_at,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function saveToDB(picks: TomorrowPick[]): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + TTL_MS);
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET data=$2::jsonb, expires_at=$3`,
      [PICKS_CACHE_KEY, JSON.stringify(picks), expiresAt],
    );
  } catch (e) {
    console.warn("[tomorrow-picks] DB 저장 실패:", e);
  }
}

async function loadThemesFeed(): Promise<ThemeFeedItem[] | null> {
  try {
    const r = await pool.query(
      "SELECT data FROM system_cache WHERE key=$1 AND expires_at > NOW() LIMIT 1",
      [THEMES_CACHE_KEY],
    );
    if (r.rows.length === 0) return null;
    const raw = r.rows[0].data;
    if (Array.isArray(raw)) return raw as ThemeFeedItem[];
    if (typeof raw === "string") return JSON.parse(raw) as ThemeFeedItem[];
    return raw as ThemeFeedItem[];
  } catch (e) {
    console.warn("[tomorrow-picks] themes feed 로드 실패:", e);
    return null;
  }
}

router.get("/market/tomorrow-picks", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";

    if (!forceRefresh) {
      const cached = await loadFromDB();
      if (cached) {
        return res.json({
          picks: cached.data,
          cachedAt: cached.cachedAt,
          fromCache: true,
        });
      }
    }

    const feed = await loadThemesFeed();
    if (!feed || feed.length === 0) {
      return res.status(503).json({ error: "테마 피드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." });
    }

    const picks = scorePicks(feed);
    await saveToDB(picks);

    return res.json({
      picks,
      cachedAt: new Date().toISOString(),
      fromCache: false,
    });
  } catch (e: any) {
    console.error("[tomorrow-picks]", e);
    res.status(500).json({ error: "오류가 발생했습니다." });
  }
});

export default router;
