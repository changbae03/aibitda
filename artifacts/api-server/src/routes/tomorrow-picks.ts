/**
 * /api/market/tomorrow-picks
 * 두 가지 소스에서 "내일 상승 후보"를 스크리닝합니다.
 *
 * 1) 테마 laggard: 핫 테마 내 아직 안 오른 종목 (기존)
 * 2) 거래량 집중: kr_volume 시그널 기반 중소형주 수급 포착 (신규)
 *
 * 캐시: system_cache 테이블, 3시간 TTL
 */
import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

const PICKS_CACHE_KEY = "tomorrow_picks_v2";
const THEMES_CACHE_KEY = "themes_feed_cache_v19";
const TTL_MS = 3 * 60 * 60 * 1000;

// ─── 인터페이스 ──────────────────────────────────────────────────────────────

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

interface SignalStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  changePercent?: number;
  volume?: number;
  close?: number;
}

interface SignalGroup {
  id: string;
  label: string;
  market: "US" | "KR";
  stocks: SignalStock[];
}

export type PickCategory = "laggard" | "volume" | "momentum";

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
  category: PickCategory;
}

// ─── 테마 laggard 스코어링 ────────────────────────────────────────────────────

function scoreThemePicks(feed: ThemeFeedItem[]): TomorrowPick[] {
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
        category: "laggard",
      };

      const existing = seen.get(s.ticker);
      if (!existing || finalScore > existing.finalScore) {
        seen.set(s.ticker, pick);
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.finalScore - a.finalScore);
}

// ─── 시그널 기반 중소형주 스코어링 ───────────────────────────────────────────

function scoreSignalPicks(signals: SignalGroup[], themeSet: Set<string>): TomorrowPick[] {
  const picks: TomorrowPick[] = [];

  // kr_volume: 거래량 집중 + 소폭 등락 = 조용한 수급 유입
  const krVolume = signals.find(g => g.id === "kr_volume");
  if (krVolume) {
    for (const s of krVolume.stocks) {
      if (s.market !== "KR") continue;
      if (themeSet.has(s.ticker)) continue; // 이미 테마 laggard에 있으면 중복 제외
      const change = s.changePercent ?? 0;
      const vol = s.volume ?? 0;
      if (Math.abs(change) > 10) continue;   // 너무 급등·급락 제외
      if (vol < 8_000_000) continue;          // 800만주 미만 제외

      // 거래량 강도 정규화 (3천만주 = 1)
      const volNorm = Math.min(vol / 30_000_000, 1);
      // 가격 조용함 점수 (덜 움직인 게 더 좋음)
      const quietNorm = Math.max(0, 1 - Math.abs(change) / 10);
      const finalScore = volNorm * 0.55 + quietNorm * 0.45;

      const sigs: string[] = ["거래량 집중"];
      if (change > 2) sigs.push("소폭 상승");
      else if (change < -2) sigs.push("하락 후 매집");
      else sigs.push("보합 수급");

      picks.push({
        ticker: s.ticker,
        name: s.name,
        market: "KR",
        theme: "거래량 집중",
        themeEmoji: "💰",
        themeHeat: 0,
        priceChange: Math.round(change * 10) / 10,
        volumeRatio: Math.round((vol / 10_000_000) * 10) / 10,
        laggardGap: 0,
        finalScore: Math.round(finalScore * 1000) / 1000,
        signals: sigs,
        rationale: `오늘 ${vol >= 10_000_000 ? `${(vol / 10_000_000).toFixed(0)}천만주` : `${(vol / 1_000_000).toFixed(0)}백만주`} 거래량 집중, 수급 유입 여부 주목`,
        category: "volume",
      });
    }
  }

  // kr_gainers 중 5~22% (서킷브레이커 아닌 범위) 중소형 모멘텀
  const krGainers = signals.find(g => g.id === "kr_gainers");
  if (krGainers) {
    for (const s of krGainers.stocks) {
      if (s.market !== "KR") continue;
      if (themeSet.has(s.ticker)) continue;
      const change = s.changePercent ?? 0;
      if (change < 5 || change > 22) continue;

      const momentumNorm = Math.min((change - 5) / 17, 1);
      const finalScore = 0.32 + momentumNorm * 0.25;

      picks.push({
        ticker: s.ticker,
        name: s.name,
        market: "KR",
        theme: "상승 모멘텀",
        themeEmoji: "📈",
        themeHeat: change,
        priceChange: Math.round(change * 10) / 10,
        volumeRatio: 1,
        laggardGap: 0,
        finalScore: Math.round(finalScore * 1000) / 1000,
        signals: ["모멘텀"],
        rationale: `오늘 ${change.toFixed(1)}% 상승 — 내일 모멘텀 지속 여부 확인 필요`,
        category: "momentum",
      });
    }
  }

  return picks.sort((a, b) => b.finalScore - a.finalScore).slice(0, 15);
}

// ─── DB 캐시 ─────────────────────────────────────────────────────────────────

async function loadFromDB(): Promise<{ data: TomorrowPick[]; cachedAt: string } | null> {
  try {
    const r = await pool.query(
      "SELECT data, expires_at FROM system_cache WHERE key=$1 AND expires_at > NOW() LIMIT 1",
      [PICKS_CACHE_KEY],
    );
    if (r.rows.length > 0) {
      const raw = r.rows[0].data;
      const parsed: TomorrowPick[] = Array.isArray(raw) ? raw : (typeof raw === "string" ? JSON.parse(raw) : raw);
      return { data: parsed, cachedAt: r.rows[0].expires_at };
    }
    return null;
  } catch { return null; }
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

async function loadSignals(): Promise<SignalGroup[]> {
  try {
    const port = process.env.PORT ?? "8080";
    const r = await fetch(`http://localhost:${port}/api/themes/signals`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return [];
    return (await r.json()) as SignalGroup[];
  } catch {
    return [];
  }
}

// ─── 라우트 ──────────────────────────────────────────────────────────────────

router.get("/market/tomorrow-picks", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";

    if (!forceRefresh) {
      const cached = await loadFromDB();
      if (cached) {
        return res.json({ picks: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const [feed, signals] = await Promise.all([loadThemesFeed(), loadSignals()]);

    if (!feed || feed.length === 0) {
      return res.status(503).json({ error: "테마 피드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." });
    }

    const themePicks = scoreThemePicks(feed);
    const themeTickerSet = new Set(themePicks.map(p => p.ticker));
    const signalPicks = signals.length > 0 ? scoreSignalPicks(signals, themeTickerSet) : [];

    // 합산: 테마 laggard 15개 + 중소형 시그널 15개 혼합 후 점수순 정렬
    const combined = [...themePicks.slice(0, 15), ...signalPicks]
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 30);

    await saveToDB(combined);

    return res.json({ picks: combined, cachedAt: new Date().toISOString(), fromCache: false });
  } catch (e: any) {
    console.error("[tomorrow-picks]", e);
    res.status(500).json({ error: "오류가 발생했습니다." });
  }
});

export default router;
