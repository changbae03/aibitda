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
const THEMES_CACHE_KEY = "themes_feed_cache_v21";
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

    // 테마 리더 수 (오늘 실제로 오른 종목) — 리더가 2개 이상인 테마만 유효
    const leaders = krStocks.filter(s => (s.priceChange ?? 0) >= 2);
    if (leaders.length < 2) continue;

    const changes = krStocks.map(s => s.priceChange ?? 0);
    const positiveChanges = changes.filter(c => c > 0);
    const themeHeat =
      positiveChanges.length > 0
        ? positiveChanges.reduce((a, b) => a + b, 0) / positiveChanges.length
        : changes.reduce((a, b) => a + b, 0) / changes.length;

    // 테마 열기: 2% 이상인 테마만 유효 (1% → 2%: 실질 순환매 기대 기준 강화)
    if (themeHeat < 2.0) continue;

    for (const s of krStocks) {
      const change = s.priceChange ?? 0;
      const volRatio = s.volumeRatio ?? 1;

      // 이미 테마보다 2배 이상 올랐거나 이미 충분히 반영됨 → 제외
      if (change > themeHeat * 2.0) continue;
      // 거래량 너무 낮으면 제외 (0.6 → 0.7: 수급 유입 최소 확인)
      if (volRatio < 0.7) continue;
      // 낙하 중인 종목 제외: 테마가 오르는데 혼자 -8% 이하면 악재 있는 종목
      if (change < -8) continue;

      const laggardGap = Math.max(0, themeHeat - change);

      // 갭 최소 기준 강화 (1.5% → 2%): 더 명확한 미반영만 선별
      if (laggardGap < 2.0) continue;

      const normGap  = Math.min(laggardGap / Math.max(themeHeat, 0.5), 1);
      const normHeat = Math.min(themeHeat / 8, 1);
      const normVol  = Math.min(Math.max(0, volRatio - 0.8) / 2.2, 1);
      let finalScore = normHeat * 0.25 + normGap * 0.40 + normVol * 0.35;

      // 주가 방향 보너스: 종목이 소폭이라도 오르고 있으면 추세 동조 가능성 높음
      if (change >= 0 && change < themeHeat) finalScore += 0.06;

      // 교차 시그널 보너스: 네이버 인기 검색에도 등장하면 점수 업
      const sigEntry = signalMap.get(s.ticker);
      const isTrending = sigEntry?.groups.has("kr_trending") ?? false;
      const isVolume   = sigEntry?.groups.has("kr_volume")   ?? false;
      const confluenceGroups: string[] = ["테마 미반영"];
      if (isTrending) { finalScore += 0.15; confluenceGroups.push("네이버 인기"); }
      if (isVolume)   { finalScore += 0.10; confluenceGroups.push("거래량 폭발"); }

      const signals: string[] = [];
      if (themeHeat >= 4) signals.push("테마 강세");
      else if (themeHeat >= 2) signals.push("테마 상승");
      if (laggardGap >= 3.0) signals.push("미반영 구간");
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
        let base = `${theme.name} 테마가 오늘 ${themePct} 올랐는데, 이 종목은 ${stockPct}에 그쳤어요. 같은 테마에서 ${gapStr} 덜 오른 셈이라 내일 뒤늦게 따라 오를 가능성이 있어요.`;
        if (isTrending) base += " 네이버 인기 검색에도 오르고 있어 개인 투자자 관심도 높아요.";
        else if (volRatio >= 1.5) base += ` 거래량도 평소의 ${volRatio.toFixed(1)}배 수준으로 사는 사람이 늘고 있어요.`;
        if (laggardGap >= 3) base += " 내일 시작부터 크게 오를 수 있으니 거래가 활발한지도 함께 확인하세요.";
        else base += " 내일 테마가 계속되면 따라 올라올 수 있어요.";
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

    // 상한가 근처(28%+) 종목은 D+1 추가 상승보다 차익실현 가능성 높아 제외
    if (change >= 28) continue;

    // ① 최강: 네이버 인기 + 거래량 폭발 (두 독립 신호 동시 포착)
    if (hasTrending && hasVolume) {
      // 보합 매집(주가 안 오른 채 거래량만 폭발) = 더 강한 신호
      baseScore = Math.abs(change) < 3 ? 0.90 : 0.82;
      emoji = "🔥";
      themeLabel = "네이버 인기 + 거래량 폭발";
      confidence = "high";
      confluenceGroups.push("네이버 인기", "거래량 폭발");

    // ② 강함: 네이버 인기 + 급등 모멘텀 (단, 15% 이상 급등은 차익 위험으로 감점)
    } else if (hasTrending && hasGainers) {
      baseScore = change >= 15 ? 0.65 : 0.75;
      emoji = "⚡";
      themeLabel = "네이버 인기 + 급등 모멘텀";
      confidence = change >= 15 ? "medium" : "high";
      confluenceGroups.push("네이버 인기", "급등주");

    // ③ 강함: 거래량 폭발 + 급등 동반 (단, 20% 이상은 차익 위험으로 낮게)
    } else if (hasVolume && hasGainers && change >= 5) {
      baseScore = change >= 20 ? 0.62 : change >= 15 ? 0.68 : 0.72;
      emoji = "📡";
      themeLabel = "거래량 폭발 + 상승 모멘텀";
      confidence = change >= 15 ? "medium" : "high";
      confluenceGroups.push("거래량 폭발", "급등주");

    // ④ 보통: 네이버 트렌딩 + 5~15% (16% 이상은 차익 위험 — 상한 축소)
    } else if (hasTrending && change >= 5 && change <= 15) {
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
          ? `주가는 거의 안 움직였는데 거래량이 크게 늘었어요. 주가가 안 오른 채 거래만 많으면 큰손이 조용히 사 모으는 신호일 수 있어요.`
          : `오늘 ${change >= 0 ? "+" : ""}${change.toFixed(1)}% 오르면서 거래량도 함께 폭발했어요.`;
        return `${priceDesc} 여기에 네이버 인기 검색까지 오르며 개인 투자자 관심도 높아요. 여러 신호가 동시에 나온 만큼 내일 추가 상승 가능성이 가장 높은 종목이에요.`;
      }
      if (hasTrending && hasGainers) {
        return `오늘 +${change.toFixed(1)}% 올랐고, 네이버 인기 검색에도 올라오고 있어요. 상승세와 개인 투자자 관심이 겹쳤어요. 내일도 추가로 오를 가능성이 있으니, 시작 시 거래량이 따라오는지 확인하세요.`;
      }
      if (hasVolume && hasGainers) {
        return `오늘 +${change.toFixed(1)}% 오르면서 거래량도 함께 폭발했어요. 오르는 힘과 거래량이 같이 왔다는 건 좋은 신호예요. 내일 추가 상승 여력이 있는지 시작 시 거래량을 봐주세요.`;
      }
      // trending only
      return `네이버 인기 검색에 오르고 있고, 오늘 주가도 +${change.toFixed(1)}% 상승했어요. 개인 투자자 관심이 높아 내일 매수세가 추가로 들어올 수 있어요. 거래량이 따라오는지 확인하세요.`;
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
  // 거래량이 폭발하면서 주가가 크게 안 움직이는 종목 = 큰손 매집 패턴
  const krVolume = signals.find(g => g.id === "kr_volume");
  if (krVolume) {
    for (const s of krVolume.stocks) {
      if (s.market !== "KR") continue;
      if (themeSet.has(s.ticker)) continue;
      const change = s.changePercent ?? 0;
      const vol = s.volume ?? 0;
      if (Math.abs(change) > 8) continue;   // 너무 급등·급락 제외 (10→8: 좁은 범위)
      if (vol < 10_000_000) continue;         // 1천만주 미만 제외 (800만→1000만 강화)

      // 거래량 강도 정규화 (5천만주 = 1)
      const volNorm  = Math.min(vol / 50_000_000, 1);
      // 가격 조용함 점수 (덜 움직인 게 더 좋음 — 매집 패턴 핵심)
      const quietNorm = Math.max(0, 1 - Math.abs(change) / 8);
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
          return `오늘 ${volStr}이 거래됐는데 주가는 ${changStr} 거의 안 움직였어요. 주가가 안 오른 채 거래만 많으면 큰손이 조용히 사 모으는 신호일 수 있어요. 내일 시작 시 강하게 오르고 거래량이 유지되는지 확인하세요.`;
        if (change >= 2)
          return `오늘 ${volStr}이 거래되며 주가도 ${changStr} 같이 올랐어요. 거래량과 상승이 함께 나왔다는 건 본격적으로 사는 사람이 늘고 있다는 신호예요. 내일 추가 상승 가능성과 거래량이 유지되는지 보세요.`;
        return `오늘 ${volStr}이 거래됐는데 주가는 ${changStr} 하락했어요. 내릴 때 사 모으는 패턴일 수 있어요. 내일 하락이 멈추고 반등하는지 확인해 보세요.`;
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
        confidence: vol >= 30_000_000 ? "high" : vol >= 15_000_000 ? "medium" : "low",
        confluenceGroups: sigs,
      });
    }
  }

  // kr_gainers: 단독 모멘텀 픽은 D+1 평균 수익률이 매우 낮으므로 완전 제거.
  // 단, confluence 픽(kr_trending + kr_gainers)으로 이미 scoreConfluencePicks에서 처리됨.
  // → kr_gainers 단독 픽은 생성하지 않음 (정확도 개선)

  return picks.sort((a, b) => b.finalScore - a.finalScore).slice(0, 12);
}

// ─── DB 캐시 ─────────────────────────────────────────────────────────────────

async function loadFromDB(allowExpired = false): Promise<{ data: TomorrowPick[]; cachedAt: string } | null> {
  try {
    const query = allowExpired
      ? "SELECT data, expires_at FROM system_cache WHERE key=$1 ORDER BY expires_at DESC LIMIT 1"
      : "SELECT data, expires_at FROM system_cache WHERE key=$1 AND expires_at > NOW() LIMIT 1";
    const r = await pool.query(query, [PICKS_CACHE_KEY]);
    if (r.rows.length > 0) {
      const raw = r.rows[0].data;
      const parsed: TomorrowPick[] = Array.isArray(raw) ? raw : (typeof raw === "string" ? JSON.parse(raw) : raw);
      if (parsed.length === 0) return null;
      // 실제 생성시각 = expires_at - TTL_MS
      const createdAt = new Date(new Date(r.rows[0].expires_at).getTime() - TTL_MS).toISOString();
      return { data: parsed, cachedAt: createdAt };
    }
    return null;
  } catch { return null; }
}

async function saveToDB(picks: TomorrowPick[]): Promise<void> {
  // 0개 결과는 저장하지 않음 — 테마 피드 미준비 상태의 빈 캐시가 장시간 서빙되는 것을 방지
  if (picks.length === 0) {
    console.warn("[tomorrow-picks] picks 0개 — DB 저장 스킵");
    return;
  }
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

async function loadSignals(force = false): Promise<SignalGroup[]> {
  // force=true 이면 캐시 무시하고 새로 fetch
  if (!force) {
    const cached = getSignalsCache();
    if (cached.length > 0) return cached;
  }

  try {
    if (force) console.log("[tomorrow-picks] signals 강제 갱신 시작...");
    else console.log("[tomorrow-picks] signals 캐시 미스 → 직접 fetch 시작...");
    const fresh = await fetchSignalsData();
    console.log(`[tomorrow-picks] signals fetch 완료: ${fresh.length}개 그룹`);
    return fresh;
  } catch (e) {
    // force 실패 시 기존 캐시 반환
    if (force) {
      const cached = getSignalsCache();
      if (cached.length > 0) { console.warn("[tomorrow-picks] signals 강제 갱신 실패 — 기존 캐시 사용"); return cached; }
    }
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

    const [feed, signals] = await Promise.all([
      loadThemesFeed(),
      loadSignals(forceRefresh),
    ]);

    if (!feed || feed.length === 0) {
      // 갱신 실패 시 만료된 캐시라도 반환 (503 대신 stale 플래그)
      const stale = await loadFromDB(true);
      if (stale) {
        console.warn("[tomorrow-picks] 테마 피드 없음 — 만료 캐시 반환 (stale)");
        return res.json({ picks: stale.data, cachedAt: stale.cachedAt, fromCache: true, stale: true });
      }
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
