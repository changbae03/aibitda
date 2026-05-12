import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, Minus, SlidersHorizontal, Search,
  BarChart2, Globe, Globe2, ArrowUpRight, Flame, Filter,
  ChevronDown, X,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

interface AnalysisItem {
  id: number;
  ticker: string;
  companyName: string;
  industry: string | null;
  investmentVerdict: string | null;
  targetPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  createdAt: string;
  priceReturn: number | null;
  outcome: string | null;
  daysElapsed: number | null;
}

interface PopularData {
  items: AnalysisItem[];
  tickerStats: { ticker: string; companyName: string; count: number }[];
  verdictStats: { verdict: string; count: number }[];
  marketStats: { market: string; count: number }[];
}

function isKRTicker(ticker: string) {
  return /^\d/.test(ticker) || ticker.endsWith(".KQ") || ticker.endsWith(".KS");
}

function getUpside(item: AnalysisItem): number | null {
  if (!item.targetPrice || !item.entryPrice || item.entryPrice === 0) return null;
  return ((item.targetPrice - item.entryPrice) / item.entryPrice) * 100;
}

const VERDICT_MAP: Record<string, { labelKo: string; labelEn: string; color: string; bg: string; border: string; icon: React.ReactNode; order: number }> = {
  "Strong Buy": { labelKo: "강력매수", labelEn: "Strong Buy",  color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/30", icon: <TrendingUp className="w-3 h-3" />, order: 0 },
  "Buy":        { labelKo: "매수",     labelEn: "Buy",         color: "text-blue-400",    bg: "bg-blue-400/10",    border: "border-blue-400/30",    icon: <TrendingUp className="w-3 h-3" />, order: 1 },
  "Hold":       { labelKo: "보유",     labelEn: "Hold",        color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/30",   icon: <Minus className="w-3 h-3" />,     order: 2 },
  "Sell":       { labelKo: "매도",     labelEn: "Sell",        color: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-400/30",  icon: <TrendingDown className="w-3 h-3" />, order: 3 },
  "Strong Sell":{ labelKo: "강력매도", labelEn: "Strong Sell", color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/30",     icon: <TrendingDown className="w-3 h-3" />, order: 4 },
};

type SortKey = "upside" | "date" | "verdict" | "return";
type MarketFilter = "all" | "kr" | "us";
type VerdictFilter = "all" | "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";

function VerdictBadge({ verdict, isEn, size = "sm" }: { verdict: string; isEn: boolean; size?: "sm" | "xs" }) {
  const cfg = VERDICT_MAP[verdict];
  if (!cfg) return null;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 font-bold rounded-full border",
      cfg.color, cfg.bg, cfg.border,
      size === "xs" ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5"
    )}>
      {cfg.icon}
      {isEn ? cfg.labelEn : cfg.labelKo}
    </span>
  );
}

function AnalysisCard({ item, isEn, onClick }: { item: AnalysisItem; isEn: boolean; onClick: () => void }) {
  const upside = getUpside(item);
  const isKR = isKRTicker(item.ticker);
  const verdict = item.investmentVerdict ?? "";
  const cfg = VERDICT_MAP[verdict];

  const formatPrice = (p: number | null, currency: string) => {
    if (!p) return "—";
    if (currency === "KRW") return `₩${Math.round(p).toLocaleString()}`;
    return `$${p.toFixed(2)}`;
  };
  const currency = isKR ? "KRW" : "USD";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="group relative rounded-2xl border border-border bg-card hover:border-white/16 hover:shadow-lg hover:shadow-black/20 cursor-pointer transition-all duration-200 overflow-hidden"
    >
      {cfg && (
        <div className={cn("absolute top-0 left-0 right-0 h-0.5", cfg.color.replace("text-", "bg-"))} />
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn(
                "text-[9px] font-bold px-1.5 py-0.5 rounded font-mono",
                isKR ? "text-blue-400 bg-blue-400/10" : "text-green-400 bg-green-400/10"
              )}>
                {isKR ? "KR" : "US"}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground/60 truncate">{item.ticker}</span>
            </div>
            <h3 className="text-[14px] font-bold text-foreground leading-tight line-clamp-1">{item.companyName}</h3>
            {item.industry && (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{item.industry}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {verdict && <VerdictBadge verdict={verdict} isEn={isEn} />}
            {upside !== null && (
              <span className={cn(
                "text-[13px] font-black tabular-nums",
                upside >= 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        {/* Prices */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          {[
            { label: isEn ? "Target" : "목표가", value: formatPrice(item.targetPrice, currency) },
            { label: isEn ? "Entry" : "진입가", value: formatPrice(item.entryPrice, currency) },
          ].map((p) => (
            <div key={p.label} className="rounded-lg bg-muted/30 px-2.5 py-1.5">
              <p className="text-[8px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">{p.label}</p>
              <p className="text-[11px] font-bold text-foreground tabular-nums">{p.value}</p>
            </div>
          ))}
        </div>

        {/* Outcome badge if available */}
        {item.outcome && item.outcome !== "pending" && (
          <div className={cn(
            "mt-2.5 flex items-center gap-1.5 text-[9px] font-bold px-2 py-1 rounded-lg",
            item.outcome === "hit_target"
              ? "text-emerald-400 bg-emerald-400/8"
              : "text-red-400 bg-red-400/8"
          )}>
            {item.outcome === "hit_target" ? "✓" : "✗"}
            {item.outcome === "hit_target"
              ? (isEn ? "Hit target" : "목표 도달")
              : (isEn ? "Hit stop" : "손절 도달")}
            {item.priceReturn != null && (
              <span className="ml-auto tabular-nums">
                {item.priceReturn >= 0 ? "+" : ""}{item.priceReturn.toFixed(1)}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* Hover arrow */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/40" />
      </div>
    </motion.div>
  );
}

function FilterPill({
  label, active, onClick
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-all",
        active
          ? "bg-[#FF8A7A] border-[#FF8A7A] text-white"
          : "bg-muted/50 border-border text-muted-foreground hover:text-foreground hover:border-white/20"
      )}
    >
      {label}
    </button>
  );
}

export default function Screener() {
  const { isEn } = useLanguage();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("upside");
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = useQuery<PopularData>({
    queryKey: ["screener-popular"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/analysis/popular"));
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const items = data?.items ?? [];
  const verdictStats = data?.verdictStats ?? [];
  const marketStats = data?.marketStats ?? [];

  // Deduplicate by ticker (keep latest)
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    const result: AnalysisItem[] = [];
    for (const item of items) {
      if (!seen.has(item.ticker)) {
        seen.add(item.ticker);
        result.push(item);
      }
    }
    return result;
  }, [items]);

  const filtered = useMemo(() => {
    let list = deduped;

    // Market filter
    if (marketFilter === "kr") list = list.filter(i => isKRTicker(i.ticker));
    if (marketFilter === "us") list = list.filter(i => !isKRTicker(i.ticker));

    // Verdict filter
    if (verdictFilter !== "all") list = list.filter(i => i.investmentVerdict === verdictFilter);

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i =>
        i.ticker.toLowerCase().includes(q) ||
        i.companyName.toLowerCase().includes(q) ||
        (i.industry ?? "").toLowerCase().includes(q)
      );
    }

    // Sort
    list = [...list].sort((a, b) => {
      if (sortKey === "upside") {
        const ua = getUpside(a) ?? -999;
        const ub = getUpside(b) ?? -999;
        return ub - ua;
      }
      if (sortKey === "date") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortKey === "verdict") {
        const oa = VERDICT_MAP[a.investmentVerdict ?? ""]?.order ?? 99;
        const ob = VERDICT_MAP[b.investmentVerdict ?? ""]?.order ?? 99;
        return oa - ob;
      }
      if (sortKey === "return" && a.priceReturn != null && b.priceReturn != null) {
        return b.priceReturn - a.priceReturn;
      }
      return 0;
    });

    return list;
  }, [deduped, marketFilter, verdictFilter, searchQuery, sortKey]);

  const totalKR = deduped.filter(i => isKRTicker(i.ticker)).length;
  const totalUS = deduped.filter(i => !isKRTicker(i.ticker)).length;

  const SORT_OPTIONS: { key: SortKey; labelKo: string; labelEn: string }[] = [
    { key: "upside",  labelKo: "업사이드 순",  labelEn: "By Upside" },
    { key: "date",    labelKo: "최신순",       labelEn: "Newest" },
    { key: "verdict", labelKo: "의견 순",      labelEn: "By Verdict" },
    { key: "return",  labelKo: "수익률 순",    labelEn: "By Return" },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#FF8A7A]/10 flex items-center justify-center">
          <SlidersHorizontal className="w-4.5 h-4.5 text-[#FF8A7A]" />
        </div>
        <div>
          <h1 className="text-[17px] font-bold text-foreground">
            {isEn ? "Stock Screener" : "종목 스크리너"}
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {isEn ? "Browse AI-analyzed stocks with filters" : "AI 분석 완료 종목을 필터로 탐색"}
          </p>
        </div>
      </div>

      {/* Stats summary */}
      {!isLoading && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          {[
            { label: isEn ? "Total analyzed" : "분석 종목", value: deduped.length, icon: BarChart2, color: "text-[#FF8A7A]", bg: "bg-[#FF8A7A]/10" },
            { label: isEn ? "KR stocks" : "한국 종목", value: totalKR, icon: Globe2, color: "text-blue-400", bg: "bg-blue-400/10" },
            { label: isEn ? "US stocks" : "미국 종목", value: totalUS, icon: Globe, color: "text-green-400", bg: "bg-green-400/10" },
            {
              label: isEn ? "Strong Buy" : "강력매수",
              value: deduped.filter(i => i.investmentVerdict === "Strong Buy").length,
              icon: TrendingUp,
              color: "text-emerald-400",
              bg: "bg-emerald-400/10",
            },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-xl border border-border bg-card p-3.5 flex items-center gap-3"
            >
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", s.bg)}>
                <s.icon className={cn("w-4 h-4", s.color)} />
              </div>
              <div>
                <p className={cn("text-[20px] font-black leading-none tabular-nums", s.color)}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={isEn ? "Search by name, ticker, or sector..." : "종목명, 코드, 섹터 검색..."}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-[#FF8A7A]/30 focus:border-[#FF8A7A]/50 transition-all"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[12px] font-semibold transition-all",
            showFilters
              ? "bg-[#FF8A7A]/10 border-[#FF8A7A]/40 text-[#FF8A7A]"
              : "bg-muted/50 border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          {isEn ? "Filters" : "필터"}
          {(marketFilter !== "all" || verdictFilter !== "all") && (
            <span className="w-4 h-4 rounded-full bg-[#FF8A7A] text-white text-[9px] font-black flex items-center justify-center">
              {(marketFilter !== "all" ? 1 : 0) + (verdictFilter !== "all" ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      {/* Filter panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
              {/* Market */}
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  {isEn ? "Market" : "시장"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label={isEn ? "All" : "전체"} active={marketFilter === "all"} onClick={() => setMarketFilter("all")} />
                  <FilterPill label={isEn ? "KR (KOSPI/KOSDAQ)" : "한국 (코스피/코스닥)"} active={marketFilter === "kr"} onClick={() => setMarketFilter("kr")} />
                  <FilterPill label={isEn ? "US (NYSE/NASDAQ)" : "미국 (NYSE/NASDAQ)"} active={marketFilter === "us"} onClick={() => setMarketFilter("us")} />
                </div>
              </div>

              {/* Verdict */}
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  {isEn ? "AI Verdict" : "AI 투자 의견"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label={isEn ? "All" : "전체"} active={verdictFilter === "all"} onClick={() => setVerdictFilter("all")} />
                  {Object.entries(VERDICT_MAP).map(([v, cfg]) => (
                    <FilterPill
                      key={v}
                      label={isEn ? cfg.labelEn : cfg.labelKo}
                      active={verdictFilter === v}
                      onClick={() => setVerdictFilter(v as VerdictFilter)}
                    />
                  ))}
                </div>
              </div>

              {/* Sort */}
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  {isEn ? "Sort by" : "정렬"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {SORT_OPTIONS.map(o => (
                    <FilterPill
                      key={o.key}
                      label={isEn ? o.labelEn : o.labelKo}
                      active={sortKey === o.key}
                      onClick={() => setSortKey(o.key)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sort row (when filters hidden) */}
      {!showFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground font-medium">{isEn ? "Sort:" : "정렬:"}</span>
          {SORT_OPTIONS.map(o => (
            <button
              key={o.key}
              onClick={() => setSortKey(o.key)}
              className={cn(
                "text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all",
                sortKey === o.key
                  ? "text-[#FF8A7A] bg-[#FF8A7A]/10"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isEn ? o.labelEn : o.labelKo}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground/60">
            {filtered.length}{isEn ? " results" : "건"}
          </span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-44 rounded-2xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Results grid */}
      {!isLoading && filtered.length > 0 && (
        <motion.div layout className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence mode="popLayout">
            {filtered.map(item => (
              <AnalysisCard
                key={`${item.ticker}-${item.id}`}
                item={item}
                isEn={isEn}
                onClick={() => setLocation(`/analysis/${item.id}`)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center">
            <SlidersHorizontal className="w-6 h-6 text-muted-foreground/40" />
          </div>
          <p className="text-[14px] font-semibold text-foreground">
            {isEn ? "No results found" : "검색 결과가 없습니다"}
          </p>
          <p className="text-[12px] text-muted-foreground max-w-xs">
            {isEn ? "Try adjusting your filters or search term." : "필터나 검색어를 조정해보세요."}
          </p>
          <button
            onClick={() => { setSearchQuery(""); setMarketFilter("all"); setVerdictFilter("all"); }}
            className="mt-1 px-4 py-2 rounded-xl border border-border text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {isEn ? "Clear filters" : "필터 초기화"}
          </button>
        </div>
      )}
    </div>
  );
}
