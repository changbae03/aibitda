import { useEffect, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ScanLine, RefreshCw, TrendingUp, TrendingDown, Minus,
  ArrowRight, Clock, Wifi, WifiOff, ChevronDown, Filter,
  Zap, BarChart3, Target, Shield,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLocation } from "wouter";
import { useLanguage } from "@/lib/language-context";

const VERDICT_CONFIG: Record<string, {
  label: string; labelEn: string;
  bg: string; text: string; border: string; dot: string; scoreColor: string;
}> = {
  "Strong Buy":  { label: "강력 매수", labelEn: "Strong Buy",  bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", dot: "bg-emerald-400", scoreColor: "#10b981" },
  "Buy":         { label: "매수",     labelEn: "Buy",          bg: "bg-green-500/10",   text: "text-green-400",   border: "border-green-500/30",   dot: "bg-green-400",   scoreColor: "#4ade80" },
  "Hold":        { label: "중립",     labelEn: "Hold",         bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/30",   dot: "bg-amber-400",   scoreColor: "#fbbf24" },
  "Sell":        { label: "매도",     labelEn: "Sell",         bg: "bg-orange-500/10",  text: "text-orange-400",  border: "border-orange-500/30",  dot: "bg-orange-400",  scoreColor: "#fb923c" },
  "Strong Sell": { label: "강력 매도", labelEn: "Strong Sell", bg: "bg-red-500/10",     text: "text-red-400",     border: "border-red-500/30",     dot: "bg-red-400",     scoreColor: "#ef4444" },
};

const SORT_OPTIONS = [
  { value: "score",  label: "AI 점수순",   labelEn: "AI Score" },
  { value: "upside", label: "상승여력순",   labelEn: "Upside %" },
  { value: "rr",     label: "손익비순",    labelEn: "Risk/Reward" },
  { value: "date",   label: "최신 분석순", labelEn: "Newest First" },
];

const VERDICT_FILTERS = ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"];

interface Stock {
  id: number;
  ticker: string;
  company_name: string;
  industry: string | null;
  verdict: string;
  target_price: number;
  current_price: number;
  entry_price: number;
  stop_loss: number;
  upside_pct: number;
  rr: number;
  age_days: number;
  score: number;
  price_stale: boolean;
  analysis_date: string;
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-border/40" />
        <circle
          cx="28" cy="28" r={r} fill="none"
          stroke={color} strokeWidth="4"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-foreground">
        {score}
      </span>
    </div>
  );
}

function StockCard({ stock, onClick }: { stock: Stock; onClick: () => void }) {
  const { isEn } = useLanguage();
  const cfg = VERDICT_CONFIG[stock.verdict] ?? VERDICT_CONFIG["Hold"];
  const isBull = stock.verdict === "Buy" || stock.verdict === "Strong Buy";
  const isBear = stock.verdict === "Sell" || stock.verdict === "Strong Sell";

  const fmt = (n: number, dec = 0) =>
    n >= 10000 ? `${(n / 10000).toFixed(1)}만` : n.toLocaleString("ko-KR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-3 p-4 rounded-2xl border cursor-pointer",
        "bg-card hover:bg-muted/20 transition-all duration-200",
        "hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5",
        cfg.border
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold mb-1.5", cfg.bg, cfg.text)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
            {isEn ? cfg.labelEn : cfg.label}
          </div>
          <h3 className="text-[14px] font-bold text-foreground truncate leading-tight">{stock.company_name}</h3>
          <p className="text-[11px] font-mono text-muted-foreground/60 mt-0.5">{stock.ticker}</p>
        </div>
        <ScoreRing score={stock.score} color={cfg.scoreColor} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 bg-muted/30 rounded-xl p-2.5">
          <span className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wide flex items-center gap-1">
            <TrendingUp className="w-2.5 h-2.5" />
            {isEn ? "Upside" : "상승여력"}
          </span>
          <span className={cn(
            "text-[16px] font-bold tabular-nums",
            isBull && stock.upside_pct > 0 ? "text-emerald-400" :
            isBear && stock.upside_pct < 0 ? "text-red-400" : "text-foreground"
          )}>
            {stock.upside_pct > 0 ? "+" : ""}{stock.upside_pct.toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-col gap-0.5 bg-muted/30 rounded-xl p-2.5">
          <span className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wide flex items-center gap-1">
            <Shield className="w-2.5 h-2.5" />
            {isEn ? "Risk/Reward" : "손익비"}
          </span>
          <span className={cn(
            "text-[16px] font-bold tabular-nums",
            Math.abs(stock.rr) >= 2 ? (isBull ? "text-emerald-400" : "text-red-400") : "text-foreground"
          )}>
            {stock.rr !== 0 ? (stock.rr > 0 ? "" : "") : ""}{Math.abs(stock.rr) > 99 ? "∞" : `${Math.abs(stock.rr).toFixed(1)}`}
            <span className="text-[11px] font-normal text-muted-foreground/50"> :1</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground/60 flex items-center gap-1">
            <Target className="w-3 h-3" />
            {isEn ? "Target" : "목표가"}
          </span>
          <span className="font-semibold text-foreground tabular-nums">₩{fmt(stock.target_price)}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground/60">{isEn ? "Current" : "현재가"}</span>
          <span className={cn("font-medium tabular-nums", stock.price_stale ? "text-muted-foreground/50" : "text-foreground")}>
            ₩{fmt(stock.current_price)}
            {stock.price_stale && <WifiOff className="inline w-2.5 h-2.5 ml-1 opacity-50" />}
          </span>
        </div>
        {stock.entry_price > 0 && stock.stop_loss > 0 && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground/60">{isEn ? "Entry / Stop" : "진입 / 손절"}</span>
            <span className="text-muted-foreground/70 tabular-nums">
              {fmt(stock.entry_price)} <span className="text-border/80">/</span> {fmt(stock.stop_loss)}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <div className="flex items-center gap-1.5 min-w-0">
          {stock.industry && (
            <span className="text-[10px] bg-muted/60 text-muted-foreground/70 px-2 py-0.5 rounded-full truncate max-w-[110px]">
              {stock.industry}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5 shrink-0">
            <Clock className="w-2.5 h-2.5" />
            {stock.age_days === 0 ? (isEn ? "Today" : "오늘") : `${stock.age_days}${isEn ? "d ago" : "일 전"}`}
          </span>
        </div>
        <span className="text-[11px] text-primary/60 group-hover:text-primary transition-colors shrink-0 flex items-center gap-0.5 font-medium">
          {isEn ? "View" : "분석 보기"} <ArrowRight className="w-3 h-3" />
        </span>
      </div>
    </motion.div>
  );
}

function TopPickCard({ stock, rank, onClick }: { stock: Stock; rank: number; onClick: () => void }) {
  const { isEn } = useLanguage();
  const cfg = VERDICT_CONFIG[stock.verdict] ?? VERDICT_CONFIG["Hold"];
  const isBull = stock.verdict === "Buy" || stock.verdict === "Strong Buy";

  const fmt = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}만` : n.toLocaleString("ko-KR");
  const rankColors = ["text-yellow-400", "text-slate-300", "text-amber-600"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.1 }}
      onClick={onClick}
      className={cn(
        "relative cursor-pointer rounded-2xl border p-5 flex flex-col gap-3",
        "bg-gradient-to-br from-card to-card/60 hover:from-muted/20 hover:to-card/80",
        "transition-all duration-200 hover:shadow-xl hover:shadow-black/30 hover:-translate-y-1",
        cfg.border
      )}
    >
      <div className="absolute top-4 right-4 text-[11px] font-bold opacity-30 tabular-nums">
        AI 점수 {stock.score}
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className={cn("text-2xl font-black tabular-nums", rankColors[rank] ?? "text-muted-foreground/50")}>
          #{rank + 1}
        </span>
        <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold", cfg.bg, cfg.text)}>
          <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
          {isEn ? cfg.labelEn : cfg.label}
        </div>
      </div>
      <div>
        <h3 className="text-[17px] font-extrabold text-foreground">{stock.company_name}</h3>
        <p className="text-[11px] font-mono text-muted-foreground/50">{stock.ticker}</p>
      </div>
      <div className="flex items-end gap-4">
        <div>
          <p className="text-[10px] text-muted-foreground/60 mb-0.5">{isEn ? "Upside" : "상승여력"}</p>
          <p className={cn("text-[26px] font-black tabular-nums leading-none", isBull ? "text-emerald-400" : "text-red-400")}>
            {stock.upside_pct > 0 ? "+" : ""}{stock.upside_pct.toFixed(1)}%
          </p>
        </div>
        <div className="pb-1">
          <p className="text-[10px] text-muted-foreground/60 mb-0.5">{isEn ? "Target" : "목표가"}</p>
          <p className="text-[15px] font-bold text-foreground tabular-nums">₩{fmt(stock.target_price)}</p>
        </div>
        <div className="pb-1 ml-auto">
          <ScoreRing score={stock.score} color={cfg.scoreColor} />
        </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-border/40">
        <span className="text-[10px] text-muted-foreground/50">
          {stock.industry ?? ""} · {stock.age_days === 0 ? (isEn ? "Today" : "오늘") : `${stock.age_days}${isEn ? "d" : "일 전"}`}
        </span>
        <span className="text-[11px] text-primary/70 font-medium flex items-center gap-0.5">
          {isEn ? "View Analysis" : "분석 전문 보기"} <ArrowRight className="w-3 h-3" />
        </span>
      </div>
    </motion.div>
  );
}

export default function Screening() {
  const { isEn } = useLanguage();
  const [, setLocation] = useLocation();
  const t = (ko: string, en: string) => isEn ? en : ko;

  const [stocks, setStocks] = useState<Stock[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const [selectedVerdicts, setSelectedVerdicts] = useState<string[]>(["Strong Buy", "Buy"]);
  const [selectedSector, setSelectedSector] = useState("all");
  const [minUpside, setMinUpside] = useState(0);
  const [sortBy, setSortBy] = useState("score");
  const [showFilters, setShowFilters] = useState(false);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
      await fetch(getApiUrl("api/screening/refresh"), { method: "POST" }).catch(() => {});
    } else {
      setLoading(true);
    }

    const params = new URLSearchParams({ sortBy });
    if (selectedVerdicts.length > 0 && selectedVerdicts.length < 5) params.set("verdicts", selectedVerdicts.join(","));
    if (selectedSector !== "all") params.set("sector", selectedSector);
    if (minUpside > 0) params.set("minUpside", String(minUpside));

    try {
      const res = await fetch(getApiUrl(`api/screening?${params}`));
      const data = await res.json();
      setStocks(data.stocks ?? []);
      setIndustries(data.industries ?? []);
      setTotal(data.total ?? 0);
      setCachedAt(data.cached_at ?? null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedVerdicts, selectedSector, minUpside, sortBy]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const topPicks = useMemo(() =>
    [...stocks].sort((a, b) => b.score - a.score).slice(0, 3),
    [stocks]
  );

  const gridStocks = useMemo(() => {
    const sorted = [...stocks];
    switch (sortBy) {
      case "upside": sorted.sort((a, b) => Math.abs(b.upside_pct) - Math.abs(a.upside_pct)); break;
      case "rr":     sorted.sort((a, b) => Math.abs(b.rr) - Math.abs(a.rr)); break;
      case "date":   sorted.sort((a, b) => new Date(b.analysis_date).getTime() - new Date(a.analysis_date).getTime()); break;
      default:       sorted.sort((a, b) => b.score - a.score);
    }
    return sorted;
  }, [stocks, sortBy]);

  const toggleVerdict = (v: string) => {
    setSelectedVerdicts(prev =>
      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
    );
  };

  const cacheAge = cachedAt
    ? Math.floor((Date.now() - new Date(cachedAt).getTime()) / 60000)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
                <ScanLine className="w-4 h-4 text-primary" />
              </div>
              <h1 className="text-2xl font-black text-foreground">{t("종목 스크리닝", "Stock Screening")}</h1>
            </div>
            <p className="text-[13px] text-muted-foreground/70">
              {t(
                `애빛다 DB의 ${total}개 종목 분석을 AI 점수로 정렬한 투자 후보 리스트`,
                `${total} analyzed stocks ranked by AI composite score`
              )}
            </p>
          </div>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted text-[12px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
            {t("현재가 갱신", "Refresh Prices")}
          </button>
        </div>

        {/* Cache info */}
        {cachedAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
            <Wifi className="w-3 h-3" />
            {cacheAge === 0
              ? t("방금 업데이트됨", "Just updated")
              : t(`${cacheAge}분 전 데이터`, `Data from ${cacheAge}m ago`)}
            <span className="text-border/60">·</span>
            <span>{t("15분마다 자동 갱신", "Auto-refreshed every 15 min")}</span>
          </div>
        )}

        {/* Filter Bar */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Verdict chips */}
            {VERDICT_FILTERS.map(v => {
              const cfg = VERDICT_CONFIG[v];
              const active = selectedVerdicts.includes(v);
              return (
                <button
                  key={v}
                  onClick={() => toggleVerdict(v)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all duration-150",
                    active ? `${cfg.bg} ${cfg.text} ${cfg.border}` : "bg-muted/30 text-muted-foreground/60 border-border/40 hover:border-border"
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", active ? cfg.dot : "bg-muted-foreground/30")} />
                  {isEn ? cfg.labelEn : cfg.label}
                </button>
              );
            })}

            {/* More filters toggle */}
            <button
              onClick={() => setShowFilters(p => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border border-border/40 bg-muted/20 text-muted-foreground/70 hover:text-foreground hover:border-border transition-colors"
            >
              <Filter className="w-3 h-3" />
              {t("추가 필터", "More Filters")}
              <ChevronDown className={cn("w-3 h-3 transition-transform", showFilters && "rotate-180")} />
            </button>

            {/* Sort */}
            <div className="ml-auto">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="text-[11px] bg-muted/40 border border-border/40 text-muted-foreground rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary/50 cursor-pointer"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{isEn ? o.labelEn : o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Expanded filters */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap items-center gap-4 p-4 bg-muted/20 rounded-xl border border-border/40">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-muted-foreground/70 whitespace-nowrap">{t("업종", "Sector")}</label>
                    <select
                      value={selectedSector}
                      onChange={e => setSelectedSector(e.target.value)}
                      className="text-[11px] bg-background border border-border/50 text-foreground rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary/50 max-w-[180px]"
                    >
                      <option value="all">{t("전체", "All")}</option>
                      {industries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-muted-foreground/70 whitespace-nowrap">
                      {t(`최소 상승여력 ${minUpside}%`, `Min upside ${minUpside}%`)}
                    </label>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={minUpside}
                      onChange={e => setMinUpside(Number(e.target.value))}
                      className="w-28 accent-primary"
                    />
                  </div>
                  <button
                    onClick={() => { setSelectedVerdicts(["Strong Buy", "Buy"]); setSelectedSector("all"); setMinUpside(0); setSortBy("score"); }}
                    className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors underline-offset-2 hover:underline"
                  >
                    {t("초기화", "Reset")}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
              <div className="absolute inset-2 rounded-full border-2 border-primary/40 animate-pulse" />
              <ScanLine className="absolute inset-0 m-auto w-6 h-6 text-primary/60" />
            </div>
            <div className="text-center">
              <p className="text-[14px] font-semibold text-foreground/80">{t("실시간 데이터 로딩 중", "Loading real-time data")}</p>
              <p className="text-[12px] text-muted-foreground/60 mt-1">{t("야후 파이낸스에서 현재가를 가져옵니다…", "Fetching current prices from Yahoo Finance…")}</p>
            </div>
          </div>
        ) : stocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <BarChart3 className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-[14px] text-muted-foreground/60">{t("조건에 맞는 종목이 없습니다", "No stocks match the current filters")}</p>
            <button
              onClick={() => { setSelectedVerdicts(VERDICT_FILTERS); setSelectedSector("all"); setMinUpside(0); }}
              className="text-[12px] text-primary/70 hover:text-primary"
            >
              {t("필터 전체 해제", "Clear all filters")}
            </button>
          </div>
        ) : (
          <>
            {/* TOP 3 Picks */}
            {topPicks.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-4 h-4 text-primary" />
                  <h2 className="text-[13px] font-bold text-foreground/80 uppercase tracking-wide">
                    {t("AI 추천 TOP 3", "AI Top Picks")}
                  </h2>
                  <span className="text-[10px] text-muted-foreground/50 ml-1">
                    {t("현재 필터 기준 점수 상위 3개 종목", "Top 3 by score in current filter")}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {topPicks.map((s, i) => (
                    <TopPickCard
                      key={s.id}
                      stock={s}
                      rank={i}
                      onClick={() => setLocation(`/analysis/${s.id}`)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Result summary */}
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-muted-foreground/60">
                {t(`총 ${stocks.length}개 종목`, `${stocks.length} stocks`)}
                {selectedVerdicts.length < 5 && (
                  <span className="ml-1.5 text-muted-foreground/40">
                    ({selectedVerdicts.map(v => VERDICT_CONFIG[v]?.[isEn ? "labelEn" : "label"]).join(", ")})
                  </span>
                )}
              </p>
            </div>

            {/* Card Grid */}
            <motion.div
              layout
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4"
            >
              <AnimatePresence mode="popLayout">
                {gridStocks.map(s => (
                  <StockCard
                    key={s.id}
                    stock={s}
                    onClick={() => setLocation(`/analysis/${s.id}`)}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
