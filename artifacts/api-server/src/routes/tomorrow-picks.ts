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
import { getSignalsCache, fetchSignalsData } from "./themes";

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

export type PickCategory = "laggard" | "volume" | "momentum" | "confluence";
export type PickConfidence = "high" | "medium" | "low";

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
  confidence: PickConfidence;
  confluenceGroups?: string[];  // 동시에 포착된 시그널 그룹 이름들
}

// ─── 시그널 교집합 맵 ────────────────────────────────────────────────────────

/** ticker → 해당 종목이 포착된 시그널 그룹 ID 집합 */
function buildTickerSignalMap(signals: SignalGroup[]): Map<string, { groups: Set<string>; stock: SignalStock }> {
  const map = new Map<string, { groups: Set<string>; stock: SignalStock }>();
  for (const g of signals) {
    for (const s of g.stocks) {
      if (s.market !== "KR") continue;
      if (!map.has(s.ticker)) map.set(s.ticker, { groups: new Set(), stock: s });
      map.get(s.ticker)!.groups.add(g.id);
    }
  }
  return map;
}

const SIGNAL_LABEL: Record<string, string> = {
  kr_volume:   "거래량 폭발",
  kr_gainers:  "급등주",
  kr_trending: "네이버 인기",
};

// ─── 테마 laggard 스코어링 ────────────────────────────────────────────────────

function scoreThemePicks(
  feed: ThemeFeedItem[],
  signalMap: Map<string, { groups: Set<string>; stock: SignalStock }>,
): TomorrowPick[] {
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

    // 테마 열기 낮으면 스킵 (최소 1% — 이전보다 강화)
    if (themeHeat < 1.0) continue;

    for (const s of krStocks) {
      const change = s.priceChange ?? 0;
      const volRatio = s.volumeRatio ?? 1;

      if (change > themeHeat * 2.0) continue;
      if (volRatio < 0.6) continue;

      const laggardGap = Math.max(0, themeHeat - change);

      // 갭이 너무 작으면 스킵 (최소 1.5%p — 명확한 미반영만 선별)
      if (laggardGap < 1.5) continue;

      const normGap  = Math.min(laggardGap / Math.max(themeHeat, 0.5), 1);
      const normHeat = Math.min(themeHeat / 8, 1);
      const normVol  = Math.min(Math.max(0, volRatio - 0.8) / 2.2, 1);
      let finalScore = normHeat * 0.25 + normGap * 0.45 + normVol * 0.30;

      // 교차 시그널 보너스: 네이버 인기 검색에도 등장하면 점수 업
      const sigEntry = signalMap.get(s.ticker);
      const isTrending = sigEntry?.groups.has("kr_trending") ?? false;
      const isVolume   = sigEntry?.groups.has("kr_volume")   ?? false;
      const confluenceGroups: string[] = ["테마 미반영"];
      if (isTrending) { finalScore += 0.15; confluenceGroups.push("네이버 인기"); }
      if (isVolume)   { finalScore += 0.08; confluenceGroups.push("거래량 폭발"); }

      const signals: string[] = [];
      if (themeHeat >= 4) signals.push("테마 강세");
      else if (themeHeat >= 2) signals.push("테마 상승");
      if (laggardGap >= 2.5) signals.push("미반영 구간");
      else signals.push("상대 지연");
      if (volRatio >= 2.5) signals.push("거래량 급증");
      else if (volRatio >= 1.5) signals.push("거래량 증가");
      else if (volRatio >= 1.1) signals.push("수급 유입");
      if (isTrending) signals.push("네이버 인기");
      if (s.isLeader) signals.push("주도주");

      const confidence: PickConfidence =
        confluenceGroups.length >= 3 ? "high" :
        confluenceGroups.length >= 2 ? "medium" : "low";

      const laggardRationale = (() => {
        const themePct = `+${themeHeat.toFixed(1)}%`;
        const stockPct = `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
        const gapStr   = `${laggardGap.toFixed(1)}%p`;
        let base = `${theme.name} 테마 ${themePct} 상승 속 이 종목은 ${stockPct}에 그침 — 갭 ${gapStr}. 테마 수급이 뒤늦게 이 종목으로 이동할 가능성이 높음.`;
        if (isTrending) base += " 네이버 인기 검색에도 동시 포착 — 내일 개인 매수세 가세 기대.";
        else if (volRatio >= 1.5) base += ` 거래량도 평소 ${volRatio.toFixed(1)}배로 수급 유입 진행 중.`;
        if (laggardGap >= 3) base += " 내일 갭업 출발 + 거래량 수반 확인 필요.";
        else base += " 내일 테마 지속 시 추격 매수세 유입 기대.";
        return base;
      })();

      const pick: TomorrowPick = {
        ticker: s.ticker,
        name: s.name,
        market: s.market,
        sector: s.sector,
        theme: theme.name,
        themeEmoji: theme.emoji,
        themeHeat:   Math.round(themeHeat   * 10) / 10,
        priceChange: Math.round(change       * 10) / 10,
        volumeRatio: Math.round(volRatio     * 10) / 10,
        laggardGap:  Math.round(laggardGap   * 10) / 10,
        finalScore:  Math.round(Math.min(finalScore, 1) * 1000) / 1000,
        signals,
        rationale: laggardRationale,
        category: "laggard",
        confidence,
        confluenceGroups,
      };

      const existing = seen.get(s.ticker);
      if (!existing || finalScore > existing.finalScore) {
        seen.set(s.ticker, pick);
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.finalScore - a.finalScore);
}

// ─── 시그널 교집합 (confluence) 픽 ──────────────────────────────────────────

/**
 * 여러 시그널 그룹에 동시 포착된 종목 = 가장 높은 신뢰도
 *
 * HIGH:   kr_trending + kr_volume  → 개인 관심 + 거래량 폭발 = 최강 신호
 *         kr_trending + kr_gainers → 개인 관심 + 모멘텀
 *         kr_volume   + kr_gainers → 거래량 + 모멘텀 (상한가 포함)
 * MEDIUM: kr_trending + 5%+ 단독  → 개인 관심 + 의미있는 상승
 *
 * 참고: signalPicks와 중복 허용 — confluencePicks가 더 높은 신뢰도로 대체됨
 */
function scoreConfluencePicks(
  signals: SignalGroup[],
  signalMap: Map<string, { groups: Set<string>; stock: SignalStock }>,
  themeOnlyTickers: Set<string>, // 테마 laggard 픽만 제외 (signalPicks 중복 허용)
): TomorrowPick[] {
  const picks: TomorrowPick[] = [];

  for (const [ticker, { groups, stock }] of signalMap) {
    if (themeOnlyTickers.has(ticker)) continue; // 테마 laggard와 중복 방지

    const change = stock.changePercent ?? 0;
    if (change < -20) continue; // 급락 제외

    const hasTrending = groups.has("kr_trending");
    const hasVolume   = groups.has("kr_volume");
    const hasGainers  = groups.has("kr_gainers");

    let baseScore = 0;
    let emoji = "🔀";
    let themeLabel = "교차 시그널";
    let confidence: PickConfidence = "medium";
    const confluenceGroups: string[] = [];

    // ① 최강: 네이버 인기 + 거래량 폭발 (같은 종목에 두 가지 독립 신호)
    if (hasTrending && hasVolume) {
      baseScore = Math.abs(change) < 3 ? 0.88 : 0.82; // 보합 매집이면 더 높은 점수
      emoji = "🔥";
      themeLabel = "네이버 인기 + 거래량 폭발";
      confidence = "high";
      confluenceGroups.push("네이버 인기", "거래량 폭발");

    // ② 강함: 네이버 인기 + 급등 모멘텀
    } else if (hasTrending && hasGainers) {
      baseScore = 0.75;
      emoji = "⚡";
      themeLabel = "네이버 인기 + 급등 모멘텀";
      confidence = "high";
      confluenceGroups.push("네이버 인기", "급등주");

    // ③ 강함: 거래량 폭발 + 급등 동반 (상한가 포함)
    } else if (hasVolume && hasGainers && change >= 5) {
      baseScore = change >= 20 ? 0.68 : 0.72; // 상한가 근처면 살짝 낮게
      emoji = "📡";
      themeLabel = "거래량 폭발 + 상승 모멘텀";
      confidence = "high";
      confluenceGroups.push("거래량 폭발", "급등주");

    // ④ 보통: 네이버 트렌딩 + 5%+ 단독 (개인 관심 + 의미있는 상승)
    } else if (hasTrending && change >= 5 && change <= 25) {
      baseScore = 0.58;
      emoji = "🔍";
      themeLabel = "네이버 트렌딩 강세";
      confidence = "medium";
      confluenceGroups.push("네이버 인기", `+${change.toFixed(1)}%`);

    } else {
      continue;
    }

    const finalScore = Math.min(baseScore, 1.0);

    const rationale = (() => {
      if (hasTrending && hasVolume) {
        const priceDesc = Math.abs(change) < 2
          ? `주가 ${change >= 0 ? "+" : ""}${change.toFixed(1)}% 보합 속 거래량 폭발 — 조용한 기관 매집 가능성.`
          : `주가 ${change >= 0 ? "+" : ""}${change.toFixed(1)}% 상승 + 거래량 급증 동반.`;
        return `${priceDesc} 동시에 네이버 인기 검색 1위권 포착 — 내일 개인 추가 매수 유입 기대. 가장 강한 복합 신호.`;
      }
      if (hasTrending && hasGainers) {
        return `오늘 +${change.toFixed(1)}% 급등 + 네이버 인기 검색 동시 포착. 모멘텀 + 개인 관심 결합 — 내일 추가 상승 기대. 시초가 갭업 + 거래량 수반 확인.`;
      }
      if (hasVolume && hasGainers) {
        return `오늘 +${change.toFixed(1)}% 상승하며 거래량도 폭발적으로 증가. 수급 + 모멘텀 동반 — 내일 추가 상승 여력 확인. 상승폭이 크므로 시초가 갭업 여부 필수 확인.`;
      }
      // trending only
      return `네이버 인기 검색 + 오늘 +${change.toFixed(1)}% 상승. 개인 투자자 관심 집중 중 — 내일 추가 매수 유입 가능성. 거래량 수반 여부 확인.`;
    })();

    picks.push({
      ticker,
      name: stock.name,
      market: "KR",
      theme: themeLabel,
      themeEmoji: emoji,
      themeHeat: 0,
      priceChange: Math.round(change * 10) / 10,
      volumeRatio: 0,
      laggardGap: 0,
      finalScore: Math.round(finalScore * 1000) / 1000,
      signals: confluenceGroups,
      rationale,
      category: "confluence",
      confidence,
      confluenceGroups,
    });
  }

  return picks.sort((a, b) => b.finalScore - a.finalScore).slice(0, 8);
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

      const volStr = vol >= 10_000_000
        ? `${(vol / 10_000_000).toFixed(1)}천만주`
        : `${(vol / 1_000_000).toFixed(0)}백만주`;
      const changStr = `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
      const volumeRationale = (() => {
        if (Math.abs(change) < 2)
          return `오늘 ${volStr} 거래 집중, 주가는 ${changStr} 보합. 주가 안 오른 채 거래만 몰리면 기관·세력 매집 신호. 내일 시초가 강세 출발 + 거래량 지속 여부 확인.`;
        if (change >= 2)
          return `오늘 ${volStr} 거래 집중, 주가도 ${changStr} 동반 상승. 수급 본격 유입 신호 — 내일 추가 상승 여력 및 거래량 유지 여부 확인.`;
        return `오늘 ${volStr} 거래 집중, 주가는 ${changStr} 하락 중 매집 패턴. 저점 매집 가능성 — 내일 낙폭 회복 + 반등 출발 여부 확인.`;
      })();

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
        rationale: volumeRationale,
        category: "volume",
        confidence: vol >= 20_000_000 ? "high" : vol >= 12_000_000 ? "medium" : "low",
        confluenceGroups: sigs,
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

      const momentumRationale = (() => {
        if (change >= 15)
          return `오늘 +${change.toFixed(1)}% 급등, 상한가 아닌 중간 구간 — 추가 상승 여력 남아있음. 내일 시초가 갭업 출발 + 거래량 수반 여부가 핵심 확인 포인트.`;
        if (change >= 10)
          return `오늘 +${change.toFixed(1)}% 강한 상승. 초반 급등 모멘텀 — 내일도 연장될 가능성. 시초가 전고점 돌파 시 추가 상승 기대.`;
        return `오늘 +${change.toFixed(1)}% 상승 모멘텀. 당일 상승 추세가 내일까지 이어지는 경향 — 내일 거래량 수반 여부와 주가 지지 확인 필요.`;
      })();

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
        rationale: momentumRationale,
        category: "momentum",
        confidence: change >= 12 ? "medium" : "low",
        confluenceGroups: [`+${change.toFixed(1)}%`],
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
  // 1. 인메모리 캐시 우선 (HTTP 자기참조 없이 직접 읽기)
  const cached = getSignalsCache();
  if (cached.length > 0) return cached;

  // 2. 캐시 미스 → 직접 fetch (서버 시작 직후 등)
  try {
    console.log("[tomorrow-picks] signals 캐시 미스 → 직접 fetch 시작...");
    const fresh = await fetchSignalsData();
    console.log(`[tomorrow-picks] signals 직접 fetch 완료: ${fresh.length}개 그룹`);
    return fresh;
  } catch (e) {
    console.warn("[tomorrow-picks] signals fetch 실패:", e);
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

    // 시그널 교집합 맵 빌드 (kr_trending 포함)
    const signalMap = buildTickerSignalMap(signals);

    const themePicks    = scoreThemePicks(feed, signalMap);
    const themeTickerSet = new Set(themePicks.map(p => p.ticker));
    const signalPicks   = signals.length > 0 ? scoreSignalPicks(signals, themeTickerSet) : [];

    // 교차 시그널 픽 — themeTickerSet만 제외 (signalPicks와는 중복 허용하여 고신뢰로 대체)
    const confluencePicks = signals.length > 0
      ? scoreConfluencePicks(signals, signalMap, themeTickerSet)
      : [];
    const confluenceTickerSet = new Set(confluencePicks.map(p => p.ticker));

    // signalPicks 중 confluencePicks와 중복된 것 제거 (confluence가 더 높은 신뢰도)
    const filteredSignalPicks = signalPicks.filter(p => !confluenceTickerSet.has(p.ticker));

    // 합산: confluence(고신뢰) 먼저 → 테마 laggard → 시그널 픽, 점수순 정렬
    const combined = [
      ...confluencePicks,
      ...themePicks.slice(0, 15),
      ...filteredSignalPicks,
    ]
      .sort((a, b) => {
        const confOrder = { high: 2, medium: 1, low: 0 };
        const cDiff = (confOrder[b.confidence] ?? 0) - (confOrder[a.confidence] ?? 0);
        if (cDiff !== 0) return cDiff;
        return b.finalScore - a.finalScore;
      })
      .slice(0, 30);

    await saveToDB(combined);

    return res.json({ picks: combined, cachedAt: new Date().toISOString(), fromCache: false });
  } catch (e: any) {
    console.error("[tomorrow-picks]", e);
    res.status(500).json({ error: "오류가 발생했습니다." });
  }
});

export default router;
