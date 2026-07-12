import { useQuery } from "@tanstack/react-query";

const getBase = () =>
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "";

async function apiFetch<T>(path: string): Promise<T> {
  const url = `${getBase()}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

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
  category: "confluence" | "theme" | "signal";
  confidence: "high" | "medium" | "low";
  reason: string;
  themes?: string[];
  finalScore: number;
  signals?: string[];
}

export interface TomorrowPicksResponse {
  picks: TomorrowPick[];
  cachedAt: string;
  fromCache: boolean;
}

export interface PresurgePick {
  ticker: string;
  name: string;
  score: number;
  reason: string;
  signals?: string[];
  themes?: string[];
}

export interface PresurgeResponse {
  picks: PresurgePick[];
  cachedAt?: string;
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

export interface PortfolioItem {
  ticker: string;
  name: string;
  market: string;
  addedAt: string;
  targetPrice?: number;
  memo?: string;
  currentPrice?: number;
  changePercent?: number;
}

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
    queryFn: () => apiFetch<PresurgeResponse>(`/api/market/presurge`),
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
    queryFn: () =>
      apiFetch<StockSearchResult[]>(
        `/api/market-data/search/${encodeURIComponent(query)}`
      ),
    enabled: query.trim().length >= 1,
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () => apiFetch<{ items: PortfolioItem[] }>(`/api/portfolio`),
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });
}
