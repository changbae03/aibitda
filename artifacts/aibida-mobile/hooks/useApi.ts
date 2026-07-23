import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const getBase = () =>
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "";

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${getBase()}${path}`;
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface Session {
  session: string;
  sessionLabel: string;
  status: "done" | "pending" | "error" | "generating";
  generatedAt?: string;
  summary?: string;
}

export interface SessionsResponse {
  sessions: Session[];
  market: string;
  marketDate: string;
  currentSession?: string;
}

export interface BriefResponse {
  content: string;
  market: string;
  session: string;
  cachedAt?: string;
  generatedAt?: string;
}

export interface TomorrowPick {
  ticker: string;
  name: string;
  market?: string;
  category: "confluence" | "laggard" | "volume" | "momentum" | "theme" | "signal";
  confidence: "high" | "medium" | "low";
  rationale?: string;
  reason?: string;
  theme?: string;
  themeEmoji?: string;
  themeHeat?: number;
  themes?: string[];
  finalScore: number;
  signals?: string[];
  priceChange?: number;
  volumeRatio?: number;
  laggardGap?: number;
  confluenceGroups?: string[];
}

export interface TomorrowPicksResponse {
  picks: TomorrowPick[];
  cachedAt: string;
  fromCache: boolean;
  stale?: boolean;
}

export interface PresurgePick {
  ticker: string;
  name: string;
  market?: string;
  score: number;
  change?: number;
  close?: number;
  maAligned?: boolean;
  bbWidthPct?: number;
  momentum3d?: number;
  nearHighPct?: number;
  volDryupDays?: number;
  volExpansion?: number;
  priceRangePct?: number;
  reason?: string;
  signals?: string[];
  themes?: string[];
  /** 후보 유형: upper_limit=상한가 연속후보, momentum=급등모멘텀후보, presurge=박스권전조 */
  category?: "upper_limit" | "momentum" | "presurge";
}

export interface PresurgeResponse {
  picks?: PresurgePick[];
  data?: PresurgePick[];
  cachedAt?: number | string;
  scanning?: boolean;
  backtest?: any;
}

export interface ThemeSignal {
  theme: string;
  signal?: string;
  strength?: "strong" | "moderate" | "weak";
  momentum?: string;
  stocks?: string[];
  tickers?: string[];
  reason?: string;
  description?: string;
  createdAt?: string;
  score?: number;
}

export interface ThemeSignalsResponse {
  signals: ThemeSignal[];
  feed?: ThemeSignal[];
  cachedAt?: string;
}

export interface StockSearchResult {
  ticker: string;
  name: string;
  market?: string;
  sector?: string;
  exchange?: string;
}

// Tracker
export interface TrackerItem {
  id: number;
  ticker: string;
  companyName: string;
  industry: string;
  investmentVerdict: string | null;
  targetPrice: number | null;
  entryPrice: number | null;
  createdAt: string;
}

export interface QuoteResult {
  price: number | null;
  currency: string;
  change: number | null;
}

// Scanner
export interface ScannerItem {
  id: number;
  ticker: string;
  companyName: string;
  englishName: string | null;
  industry: string | null;
  investmentVerdict: string;
  targetPrice: number;
  startPrice: number | null;
  currentPrice: number | null;
  upside: number | null;
  todayChangePct: number | null;
  analysisDate: string;
}

// News
export interface NewsItem {
  id?: number;
  title: string;
  source?: string;
  pubDate?: string;
  url?: string;
  category?: string;
  tags?: string[];
  text?: string;
  date?: string;
}

export interface NewsResponse {
  items: NewsItem[];
  cached?: boolean;
}

// Popular
export interface PopularItem {
  id: number;
  ticker: string;
  companyName: string;
  englishName: string | null;
  industry: string;
  investmentVerdict: string | null;
  targetPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  createdAt: string;
  currentPrice?: number | null;
  priceReturn?: number | null;
  outcome?: string | null;
  daysElapsed?: number | null;
}

// Analysis
export interface AnalysisListItem {
  id: number;
  ticker: string;
  companyName: string | null;
  englishName: string | null;
  investmentVerdict: string | null;
  targetPrice: number | null;
  startPrice: number | null;
  createdAt: string;
  status: string;
}

export interface AnalysisCreateResult {
  id: number;
  ticker: string;
  status: string;
}

// Portfolio watchlist item (local + remote prices)
export interface WatchItem {
  ticker: string;
  name: string;
  addedAt: string;
  currentPrice?: number | null;
  currency?: string;
  change?: number | null;
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export function useMarketSessions(market: "kr" | "us") {
  return useQuery({
    queryKey: ["market-sessions", market],
    queryFn: () =>
      apiFetch<SessionsResponse>(
        `/api/market-analysis/sessions?market=${market}`
      ),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useMarketBrief(market: "kr" | "us", session: string | null) {
  return useQuery({
    queryKey: ["market-brief", market, session],
    queryFn: () =>
      apiFetch<BriefResponse>(
        `/api/market-analysis/brief?market=${market}&session=${session}`
      ),
    enabled: !!session,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

export function useTomorrowPicks() {
  return useQuery({
    queryKey: ["tomorrow-picks"],
    queryFn: () =>
      apiFetch<TomorrowPicksResponse>(`/api/market/tomorrow-picks`),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

export function usePresurge() {
  return useQuery({
    queryKey: ["presurge"],
    queryFn: async () => {
      const raw = await apiFetch<PresurgeResponse>(`/api/market/presurge`);
      // API returns { data: [...] } but we normalise to { picks: [...] }
      const picks = raw.picks ?? raw.data ?? [];
      return { ...raw, picks } as PresurgeResponse & { picks: PresurgePick[] };
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

export function useThemeSignals() {
  return useQuery({
    queryKey: ["theme-signals"],
    queryFn: () =>
      apiFetch<ThemeSignalsResponse>(`/api/themes/signals`),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useThemesFeed() {
  return useQuery({
    queryKey: ["themes-feed"],
    queryFn: () =>
      apiFetch<ThemeSignalsResponse>(`/api/themes/trending-feed`),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useStockSearch(query: string) {
  return useQuery({
    queryKey: ["stock-search", query],
    queryFn: async () => {
      const raw = await apiFetch<any[]>(
        `/api/market-data/search/${encodeURIComponent(query)}`
      );
      return raw.map((r: any): StockSearchResult => ({
        ticker: r.ticker ?? r.symbol ?? r.code ?? "",
        name: r.name ?? r.shortname ?? r.companyName ?? "",
        market: r.market ?? r.exchange ?? "",
        sector: r.sector,
        exchange: r.exchange ?? r.market,
      }));
    },
    enabled: query.trim().length >= 1,
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function useTracker() {
  return useQuery({
    queryKey: ["tracker"],
    queryFn: () => apiFetch<TrackerItem[]>(`/api/analysis/tracker`),
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });
}

export function useScanner(market: "ALL" | "KR" | "US", minUpside: number) {
  return useQuery({
    queryKey: ["scanner", market, minUpside],
    queryFn: () =>
      apiFetch<ScannerItem[]>(
        `/api/analysis/scanner?market=${market}&minUpside=${minUpside}`
      ),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useNewsResearch() {
  return useQuery({
    queryKey: ["news-research"],
    queryFn: () => apiFetch<NewsResponse>(`/api/news`),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useNewsRadar() {
  return useQuery({
    queryKey: ["news-radar"],
    queryFn: () => apiFetch<NewsResponse>(`/api/news/radar`),
    staleTime: 3 * 60 * 1000,
    retry: 1,
  });
}

export function useNewsScraps() {
  return useQuery({
    queryKey: ["news-scraps"],
    queryFn: () => apiFetch<{ items: NewsItem[] }>(`/api/news/scraps`),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function usePopular() {
  return useQuery({
    queryKey: ["popular"],
    queryFn: () => apiFetch<PopularItem[]>(`/api/analysis/popular`),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useRecentAnalyses() {
  return useQuery({
    queryKey: ["recent-analyses"],
    queryFn: () =>
      apiFetch<AnalysisListItem[]>(`/api/analysis?limit=20`),
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });
}

export function useBatchQuotes(tickers: string[]) {
  return useQuery({
    queryKey: ["batch-quotes", tickers.sort().join(",")],
    queryFn: () =>
      apiFetch<Record<string, QuoteResult>>(`/api/market-data/batch-quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      }),
    enabled: tickers.length > 0,
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function useCreateAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ticker: string; companyName?: string; additionalContext?: string }) =>
      apiFetch<AnalysisCreateResult>(`/api/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recent-analyses"] }),
  });
}

export function useRunPipeline() {
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ ok: boolean }>(`/api/analysis/${id}/run-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
  });
}
