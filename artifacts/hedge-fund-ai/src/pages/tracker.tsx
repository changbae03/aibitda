import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  TrendingUp, TrendingDown, RefreshCw, Loader2, ChevronRight,
} from "lucide-react";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface TrackerItem {
  id: number;
  ticker: string;
  companyName: string;
  industry: string;
  investmentVerdict: string | null;
  targetPrice: number | null;
  entryPrice: number | null;
  createdAt: string;
}

interface QuoteResult {
  price: number | null;
  currency: string;
  change: number | null;
}

const REFRESH_INTERVAL = 30_000;

function verdictBadge(verdict: string | null) {
  if (!verdict) return null;
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return { label: "높은 상승여력", cls: "border bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-400 dark:border-emerald-700" };
  if (s.includes("buy"))         return { label: "상승여력",     cls: "border bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300 border-green-400 dark:border-green-700" };
  if (s.includes("strong sell")) return { label: "높은 하락여지", cls: "border bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border-blue-400 dark:border-blue-700" };
  if (s.includes("sell"))        return { label: "하락여지",     cls: "border bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-700" };
  return { label: "보유", cls: "border bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-amber-400 dark:border-amber-700" };
}

function upsideColor(pct: number) {
  if (pct >= 20) return "text-emerald-600";
  if (pct >= 5)  return "text-green-600";
  if (pct >= 0)  return "text-green-500";
  if (pct >= -10) return "text-red-500";
  return "text-red-600";
}

function isUSTicker(t: string) {
  return !/^\d{5,6}/.test(t.split(".")[0]);
}

export default function Tracker() {
  const [, setLocation] = useLocation();
  const [items, setItems] = useState<TrackerItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, QuoteResult>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchItems() {
    try {
      const r = await fetch(getApiUrl("/api/analysis/tracker"), { credentials: "include" });
      if (!r.ok) return;
      const data: TrackerItem[] = await r.json();
      setItems(data);
      return data;
    } catch {}
  }

  async function fetchQuotes(data: TrackerItem[]) {
    if (!data.length) return;
    const tickers = [...new Set(data.map((d) => d.ticker))];
    try {
      const r = await fetch(getApiUrl("/api/market-data/batch-quotes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (!r.ok) return;
      const q: Record<string, QuoteResult> = await r.json();
      setQuotes(q);
      setLastUpdated(new Date());
    } catch {}
  }

  async function init() {
    setLoading(true);
    const data = await fetchItems();
    if (data) await fetchQuotes(data);
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    const data = await fetchItems();
    if (data) await fetchQuotes(data);
    setRefreshing(false);
  }

  useEffect(() => {
    init();
    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const enriched = items.map((item) => {
    const q = quotes[item.ticker];
    const currentPrice = q?.price ?? null;
    const currency = q?.currency ?? (isUSTicker(item.ticker) ? "USD" : "KRW");
    const upside = item.targetPrice && currentPrice
      ? ((item.targetPrice - currentPrice) / currentPrice) * 100
      : null;
    const dayChange = q?.change ?? null;
    return { ...item, currentPrice, currency, upside, dayChange };
  });

  const sorted = [...enriched].sort((a, b) => {
    if (a.upside !== null && b.upside !== null) return b.upside - a.upside;
    if (a.upside !== null) return -1;
    if (b.upside !== null) return 1;
    return 0;
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground/90">업사이드 실시간 트래커</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI 적정주가 vs 현재가 · {REFRESH_INTERVAL / 1000}초마다 자동 갱신
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted transition-colors text-sm font-medium text-foreground/70 disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          갱신
        </button>
      </div>

      {lastUpdated && (
        <p className="text-xs text-muted-foreground">
          마지막 업데이트: {lastUpdated.toLocaleTimeString("ko-KR")}
        </p>
      )}

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="flex items-center gap-4 pb-2">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-4 w-16 bg-muted rounded" />
            <div className="ml-auto h-4 w-20 bg-muted rounded" />
          </div>
          {[0,1,2,3,4].map(i => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-muted flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-28 bg-muted rounded" />
                <div className="h-3 w-16 bg-muted/60 rounded" />
              </div>
              <div className="space-y-1 text-right">
                <div className="h-4 w-20 bg-muted rounded" />
                <div className="h-3 w-14 bg-muted/60 rounded ml-auto" />
              </div>
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-20">
          <TrendingUp className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">아직 분석된 종목이 없습니다.</p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-background rounded-2xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                  <th className="px-5 py-3 text-left">종목</th>
                  <th className="px-4 py-3 text-left">의견</th>
                  <th className="px-4 py-3 text-right">현재가</th>
                  <th className="px-4 py-3 text-right">적정주가</th>
                  <th className="px-4 py-3 text-right">업사이드</th>
                  <th className="px-4 py-3 text-right">일간 등락</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                <AnimatePresence initial={false}>
                  {sorted.map((item) => {
                    const badge = verdictBadge(item.investmentVerdict);
                    return (
                      <motion.tr
                        key={item.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => setLocation(`/analysis/${item.id}`)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-foreground/90 text-sm">{item.companyName}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">{item.ticker}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          {badge && (
                            <span className={cn("text-xs font-bold px-2.5 py-0.5 rounded-full", badge.cls)}>
                              {badge.label}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono">
                          {item.currentPrice != null
                            ? <span className="text-foreground/80">{formatCurrency(item.currentPrice, item.currency)}</span>
                            : <span className="text-muted-foreground/50 text-xs">—</span>
                          }
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono">
                          {item.targetPrice != null
                            ? <span className="text-foreground/80">{formatCurrency(item.targetPrice, item.currency)}</span>
                            : <span className="text-muted-foreground/50 text-xs">—</span>
                          }
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {item.upside != null ? (
                            <div className={cn("font-bold text-sm flex items-center justify-end gap-0.5", upsideColor(item.upside))}>
                              {item.upside >= 0
                                ? <TrendingUp className="w-3.5 h-3.5" />
                                : <TrendingDown className="w-3.5 h-3.5" />
                              }
                              {item.upside >= 0 ? "+" : ""}{item.upside.toFixed(1)}%
                            </div>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {item.dayChange != null ? (
                            <span className={cn("text-xs font-semibold", item.dayChange >= 0 ? "text-green-600" : "text-red-500")}>
                              {item.dayChange >= 0 ? "+" : ""}{item.dayChange.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-muted-foreground/50">
                          <ChevronRight className="w-4 h-4" />
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2.5">
            {sorted.map((item) => {
              const badge = verdictBadge(item.investmentVerdict);
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-background rounded-xl border border-border shadow-sm p-4 cursor-pointer active:bg-muted/50"
                  onClick={() => setLocation(`/analysis/${item.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground/90 truncate">{item.companyName}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">{item.ticker}</div>
                    </div>
                    {item.upside != null && (
                      <div className={cn("font-bold text-base flex items-center gap-0.5 shrink-0", upsideColor(item.upside))}>
                        {item.upside >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {item.upside >= 0 ? "+" : ""}{item.upside.toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                    {badge && (
                      <span className={cn("text-xs font-bold px-2.5 py-0.5 rounded-full", badge.cls)}>{badge.label}</span>
                    )}
                    {item.currentPrice != null && (
                      <span>현재가 <span className="font-semibold text-foreground/80">{formatCurrency(item.currentPrice, item.currency)}</span></span>
                    )}
                    {item.targetPrice != null && (
                      <span>목표 <span className="font-semibold text-foreground/80">{formatCurrency(item.targetPrice, item.currency)}</span></span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
