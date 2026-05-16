import { useEffect, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ScanLine, RefreshCw, TrendingUp, TrendingDown, Minus,
  ArrowRight, Clock, Wifi, WifiOff, ChevronDown, Filter,
  Zap, BarChart3, Target, Shield, Globe, Loader2, ExternalLink,
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

const UNIVERSE_SORT_OPTIONS = [
  { value: "score",    label: "종합 점수순",  labelEn: "Composite Score" },
  { value: "pe",       label: "P/E 낮은순",  labelEn: "P/E (Low→High)" },
  { value: "pb",       label: "P/B 낮은순",  labelEn: "P/B (Low→High)" },
  { value: "momentum", label: "모멘텀 낮은순", labelEn: "Momentum (Low→High)" },
  { value: "yield",    label: "배당수익률 높은순", labelEn: "Dividend Yield" },
  { value: "mktcap",  label: "시가총액 높은순", labelEn: "Market Cap" },
  { value: "change",   label: "등락률 높은순", labelEn: "% Change" },
];

const MARKET_FILTERS = [
  { value: "all",       label: "전체",     labelEn: "All" },
  { value: "KR",        label: "🇰🇷 한국",  labelEn: "🇰🇷 Korea" },
  { value: "US",        label: "🇺🇸 미국",  labelEn: "🇺🇸 US" },
  { value: "KOSPI",     label: "KOSPI",   labelEn: "KOSPI" },
  { value: "KOSDAQ",    label: "KOSDAQ",  labelEn: "KOSDAQ" },
  { value: "NASDAQ100", label: "NASDAQ",  labelEn: "NASDAQ" },
  { value: "SP500",     label: "S&P 500", labelEn: "S&P 500" },
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

interface UniverseStock {
  ticker: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "NASDAQ100" | "SP500";
  price: number;
  currency: "KRW" | "USD";
  change_pct: number;
  pe: number | null;
  pb: number | null;
  eps: number | null;
  dividend_yield: number | null;
  market_cap: number | null;
  week52_high: number | null;
  week52_low: number | null;
  momentum_pct: number | null;
  score: number;
}

// ── 시장 배지 ──────────────────────────────────────────────────────
const MARKET_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  KOSPI:     { bg: "bg-blue-500/15",    text: "text-blue-400",    label: "KOSPI"   },
  KOSDAQ:    { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "KOSDAQ"  },
  NASDAQ100: { bg: "bg-violet-500/15",  text: "text-violet-400",  label: "NASDAQ"  },
  SP500:     { bg: "bg-sky-500/15",     text: "text-sky-400",     label: "S&P 500" },
};

// ── 공통 컴포넌트 ──────────────────────────────────────────────────

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

// ── 분석된 종목 카드 ────────────────────────────────────────────────

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

// ── 유니버스 종목 카드 ────────────────────────────────────────────

function MomentumBar({ pct }: { pct: number | null }) {
  if (pct == null) return (
    <div className="h-1.5 bg-muted/30 rounded-full" />
  );
  const color =
    pct < 15 ? "bg-red-500" :
    pct <= 45 ? "bg-emerald-500" :
    pct <= 70 ? "bg-amber-500" :
    "bg-rose-500";
  return (
    <div className="relative h-1.5 bg-muted/30 rounded-full overflow-hidden">
      <div
        className={cn("absolute left-0 top-0 h-full rounded-full transition-all duration-700", color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function UniverseStockCard({ stock, onAnalyze }: { stock: UniverseStock; onAnalyze: () => void }) {
  const { isEn } = useLanguage();
  const badge = MARKET_BADGE[stock.market] ?? MARKET_BADGE["SP500"];
  const isKR = stock.currency === "KRW";
  const scoreColor =
    stock.score >= 70 ? "#10b981" :
    stock.score >= 55 ? "#fbbf24" :
    stock.score >= 40 ? "#fb923c" : "#ef4444";

  const fmtPrice = (p: number) => {
    if (isKR) return p >= 10000 ? `₩${(p / 10000).toFixed(1)}만` : `₩${p.toLocaleString("ko-KR")}`;
    return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const fmtMktCap = (v: number | null) => {
    if (v == null) return "—";
    if (isKR) {
      if (v >= 1e12) return `₩${(v / 1e12).toFixed(1)}조`;
      if (v >= 1e8)  return `₩${(v / 1e8).toFixed(0)}억`;
      return `₩${v.toLocaleString("ko-KR")}`;
    } else {
      if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
      if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
      if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
      return `$${v.toLocaleString()}`;
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.22 }}
      className={cn(
        "group relative flex flex-col gap-3 p-4 rounded-2xl border cursor-default",
        "bg-card hover:bg-muted/10 transition-all duration-200 border-border/50",
        "hover:shadow-lg hover:shadow-black/15 hover:-translate-y-0.5"
      )}
    >
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold", badge.bg, badge.text)}>
              {badge.label}
            </span>
            <span className={cn(
              "text-[11px] font-semibold tabular-nums",
              stock.change_pct > 0 ? "text-emerald-400" :
              stock.change_pct < 0 ? "text-red-400" : "text-muted-foreground"
            )}>
              {stock.change_pct > 0 ? "▲" : stock.change_pct < 0 ? "▼" : "—"}
              {Math.abs(stock.change_pct).toFixed(1)}%
            </span>
          </div>
          <h3 className="text-[13px] font-bold text-foreground truncate leading-tight">{stock.name}</h3>
          <p className="text-[10px] font-mono text-muted-foreground/50 mt-0.5">{stock.ticker}</p>
        </div>
        <ScoreRing score={stock.score} color={scoreColor} />
      </div>

      {/* 52주 모멘텀 바 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[9px] text-muted-foreground/50 font-medium">
          <span>{isEn ? "52W Position" : "52주 위치"}</span>
          <span className="tabular-nums">
            {stock.momentum_pct != null ? `${stock.momentum_pct}%` : "—"}
          </span>
        </div>
        <MomentumBar pct={stock.momentum_pct} />
        <div className="flex justify-between text-[8px] text-muted-foreground/30 tabular-nums">
          <span>{stock.week52_low != null ? fmtPrice(stock.week52_low) : "—"}</span>
          <span>{stock.week52_high != null ? fmtPrice(stock.week52_high) : "—"}</span>
        </div>
      </div>

      {/* 지표 그리드 */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { label: "P/E",  value: stock.pe  != null ? stock.pe.toFixed(1)  : "—" },
          { label: "P/B",  value: stock.pb  != null ? stock.pb.toFixed(1)  : "—" },
          { label: isEn ? "Yield" : "배당", value: stock.dividend_yield != null ? `${stock.dividend_yield.toFixed(1)}%` : "—" },
          { label: isEn ? "Mkt Cap" : "시총", value: fmtMktCap(stock.market_cap) },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between bg-muted/25 rounded-lg px-2.5 py-1.5">
            <span className="text-[9px] text-muted-foreground/50 font-medium">{label}</span>
            <span className="text-[11px] font-semibold text-foreground tabular-nums">{value}</span>
          </div>
        ))}
      </div>

      {/* 하단 — 가격 + 버튼 */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <div>
          <span className="text-[13px] font-bold text-foreground tabular-nums">{fmtPrice(stock.price)}</span>
        </div>
        <button
          onClick={onAnalyze}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors",
            "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
          )}
        >
          <Zap className="w-2.5 h-2.5" />
          {isEn ? "AI Analysis" : "AI 분석"}
        </button>
      </div>
    </motion.div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────

export default function Screening() {
  const { isEn } = useLanguage();
  const [, setLocation] = useLocation();
  const t = (ko: string, en: string) => isEn ? en : ko;

  // ── 모드 토글
  const [mode, setMode] = useState<"analyzed" | "universe">("analyzed");

  // ── 분석된 종목 상태
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

  // ── 유니버스 상태
  const [uStocks, setUStocks] = useState<UniverseStock[]>([]);
  const [uLoading, setULoading] = useState(false);
  const [uCachedAt, setUCachedAt] = useState<string | null>(null);
  const [uTotal, setUTotal] = useState(0);
  const [uUniverseSize, setUUniverseSize] = useState(0);
  const [uMarket, setUMarket] = useState("all");
  const [uSortBy, setUSortBy] = useState("score");
  const [uMaxPE, setUMaxPE] = useState(0);
  const [uMinScore, setUMinScore] = useState(0);
  const [uShowFilters, setUShowFilters] = useState(false);
  const [uRefreshing, setURefreshing] = useState(false);

  // ── 분석된 종목 fetch
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
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [selectedVerdicts, selectedSector, minUpside, sortBy]);

  // ── 유니버스 fetch
  const fetchUniverse = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setURefreshing(true);
      await fetch(getApiUrl("api/universe-screening/refresh"), { method: "POST" }).catch(() => {});
    }
    setULoading(true);
    const params = new URLSearchParams({ sortBy: uSortBy });
    if (uMarket !== "all") params.set("market", uMarket);
    if (uMaxPE > 0) params.set("maxPE", String(uMaxPE));
    if (uMinScore > 0) params.set("minScore", String(uMinScore));
    try {
      const res = await fetch(getApiUrl(`api/universe-screening?${params}`));
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setUStocks(data.stocks ?? []);
      setUTotal(data.total ?? 0);
      setUUniverseSize(data.universe_size ?? 0);
      setUCachedAt(data.cached_at ?? null);
    } catch (e) { console.error(e); }
    finally { setULoading(false); setURefreshing(false); }
  }, [uMarket, uSortBy, uMaxPE, uMinScore]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (mode === "universe" && uStocks.length === 0 && !uLoading) {
      fetchUniverse();
    }
  }, [mode]);

  useEffect(() => {
    if (mode === "universe") fetchUniverse();
  }, [uMarket, uSortBy, uMaxPE, uMinScore]);

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
    setSelectedVerdicts(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };

  const cacheAge = cachedAt ? Math.floor((Date.now() - new Date(cachedAt).getTime()) / 60000) : null;
  const uCacheAge = uCachedAt ? Math.floor((Date.now() - new Date(uCachedAt).getTime()) / 60000) : null;

  const handleUniverseAnalyze = (stock: UniverseStock) => {
    setLocation(`/analysis?ticker=${stock.ticker}&name=${encodeURIComponent(stock.name)}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

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
              {mode === "analyzed"
                ? t(`애빛다 DB의 ${total}개 분석 종목을 AI 점수로 정렬`, `${total} AI-analyzed stocks ranked by composite score`)
                : t(`한국·미국 ${uUniverseSize}개 핵심 종목 실시간 스크리닝`, `Real-time screening of ${uUniverseSize} key stocks (Korea + US)`)}
            </p>
          </div>
          <button
            onClick={() => mode === "analyzed" ? fetchData(true) : fetchUniverse(true)}
            disabled={refreshing || loading || uLoading || uRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted text-[12px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (refreshing || uRefreshing) && "animate-spin")} />
            {t("갱신", "Refresh")}
          </button>
        </div>

        {/* 모드 토글 탭 */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/30 border border-border/40 w-fit">
          <button
            onClick={() => setMode("analyzed")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200",
              mode === "analyzed"
                ? "bg-background text-foreground shadow-sm border border-border/50"
                : "text-muted-foreground/60 hover:text-foreground"
            )}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            {t("분석된 종목", "AI-Analyzed")}
            {total > 0 && (
              <span className={cn("px-1.5 py-0.5 rounded-full text-[9px]", mode === "analyzed" ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground/50")}>
                {total}
              </span>
            )}
          </button>
          <button
            onClick={() => setMode("universe")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200",
              mode === "universe"
                ? "bg-background text-foreground shadow-sm border border-border/50"
                : "text-muted-foreground/60 hover:text-foreground"
            )}
          >
            <Globe className="w-3.5 h-3.5" />
            {t("전종목 탐색", "Universe Screen")}
            <span className={cn("px-1.5 py-0.5 rounded-full text-[9px]", mode === "universe" ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground/50")}>
              {t("한국+미국", "KR+US")}
            </span>
          </button>
        </div>

        {/* ══════════════════════════════════════════════════
            MODE: 분석된 종목
        ══════════════════════════════════════════════════ */}
        {mode === "analyzed" && (
          <>
            {cachedAt && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
                <Wifi className="w-3 h-3" />
                {cacheAge === 0 ? t("방금 업데이트됨", "Just updated") : t(`${cacheAge}분 전 데이터`, `Data from ${cacheAge}m ago`)}
                <span className="text-border/60">·</span>
                <span>{t("15분마다 자동 갱신", "Auto-refreshed every 15 min")}</span>
              </div>
            )}

            {/* Filter Bar */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
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
                <button
                  onClick={() => setShowFilters(p => !p)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border border-border/40 bg-muted/20 text-muted-foreground/70 hover:text-foreground hover:border-border transition-colors"
                >
                  <Filter className="w-3 h-3" />
                  {t("추가 필터", "More Filters")}
                  <ChevronDown className={cn("w-3 h-3 transition-transform", showFilters && "rotate-180")} />
                </button>
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
                        <TopPickCard key={s.id} stock={s} rank={i} onClick={() => setLocation(`/analysis/${s.id}`)} />
                      ))}
                    </div>
                  </section>
                )}
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
                <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  <AnimatePresence mode="popLayout">
                    {gridStocks.map(s => (
                      <StockCard key={s.id} stock={s} onClick={() => setLocation(`/analysis/${s.id}`)} />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════
            MODE: 전종목 유니버스 탐색
        ══════════════════════════════════════════════════ */}
        {mode === "universe" && (
          <>
            {/* 캐시 정보 */}
            {uCachedAt && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
                <Wifi className="w-3 h-3" />
                {uCacheAge === 0 ? t("방금 업데이트됨", "Just updated") : t(`${uCacheAge}분 전 데이터`, `Data from ${uCacheAge}m ago`)}
                <span className="text-border/60">·</span>
                <span>{t("6시간마다 자동 갱신", "Auto-refreshed every 6h")}</span>
              </div>
            )}

            {/* 안내 배너 */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/15">
              <Globe className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] font-semibold text-foreground/80">
                  {t("KOSPI200 + KOSDAQ150 + S&P500 + NASDAQ100", "KOSPI200 + KOSDAQ150 + S&P500 + NASDAQ100")}
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  {t(
                    "P/E · P/B · 52주 모멘텀 · 배당수익률 기반 종합 점수 산출 (AI 전문 분석 없음). 관심 종목 발견 후 'AI 분석' 버튼으로 심층 분석을 시작하세요.",
                    "Composite score based on P/E, P/B, 52W momentum, and dividend yield (no AI deep analysis). Click 'AI Analysis' on any stock to start a deep dive."
                  )}
                </p>
              </div>
            </div>

            {/* 유니버스 필터 바 */}
            <div className="space-y-3">
              {/* 시장 선택 */}
              <div className="flex flex-wrap items-center gap-2">
                {MARKET_FILTERS.map(mf => (
                  <button
                    key={mf.value}
                    onClick={() => setUMarket(mf.value)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all duration-150",
                      uMarket === mf.value
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-muted/30 text-muted-foreground/60 border-border/40 hover:border-border"
                    )}
                  >
                    {isEn ? mf.labelEn : mf.label}
                  </button>
                ))}

                {/* 필터 토글 */}
                <button
                  onClick={() => setUShowFilters(p => !p)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border border-border/40 bg-muted/20 text-muted-foreground/70 hover:text-foreground hover:border-border transition-colors"
                >
                  <Filter className="w-3 h-3" />
                  {t("지표 필터", "Metric Filters")}
                  <ChevronDown className={cn("w-3 h-3 transition-transform", uShowFilters && "rotate-180")} />
                </button>

                {/* 정렬 */}
                <div className="ml-auto">
                  <select
                    value={uSortBy}
                    onChange={e => setUSortBy(e.target.value)}
                    className="text-[11px] bg-muted/40 border border-border/40 text-muted-foreground rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary/50 cursor-pointer"
                  >
                    {UNIVERSE_SORT_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{isEn ? o.labelEn : o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <AnimatePresence>
                {uShowFilters && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap items-center gap-5 p-4 bg-muted/20 rounded-xl border border-border/40">
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-muted-foreground/70 whitespace-nowrap">
                          {t(`최대 P/E: ${uMaxPE === 0 ? "제한 없음" : uMaxPE}`, `Max P/E: ${uMaxPE === 0 ? "Any" : uMaxPE}`)}
                        </label>
                        <input
                          type="range" min={0} max={60} step={5}
                          value={uMaxPE}
                          onChange={e => setUMaxPE(Number(e.target.value))}
                          className="w-28 accent-primary"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-muted-foreground/70 whitespace-nowrap">
                          {t(`최소 점수: ${uMinScore}`, `Min score: ${uMinScore}`)}
                        </label>
                        <input
                          type="range" min={0} max={80} step={5}
                          value={uMinScore}
                          onChange={e => setUMinScore(Number(e.target.value))}
                          className="w-28 accent-primary"
                        />
                      </div>
                      <button
                        onClick={() => { setUMarket("all"); setUMaxPE(0); setUMinScore(0); setUSortBy("score"); }}
                        className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors underline-offset-2 hover:underline"
                      >
                        {t("초기화", "Reset")}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 로딩 */}
            {uLoading ? (
              <div className="flex flex-col items-center justify-center py-32 gap-4">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
                  <Loader2 className="absolute inset-0 m-auto w-7 h-7 text-primary/60 animate-spin" />
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-semibold text-foreground/80">
                    {t("전종목 데이터 수집 중", "Fetching universe data")}
                  </p>
                  <p className="text-[12px] text-muted-foreground/60 mt-1">
                    {t("한국+미국 전 종목 실시간 조회 중… 최초 로딩은 약 15~30초 소요됩니다", "Loading KR + US stocks from Yahoo Finance… First load takes ~15-30s")}
                  </p>
                </div>
              </div>
            ) : uStocks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <Globe className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-[14px] text-muted-foreground/60">{t("조건에 맞는 종목이 없습니다", "No stocks match the filters")}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-[12px] text-muted-foreground/60">
                    {t(`${uTotal}개 종목 표시 (유니버스 ${uUniverseSize}개 중)`, `Showing ${uTotal} of ${uUniverseSize} stocks`)}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground/40">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{t("가치구간 (10-45%)", "Value zone")}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{t("모멘텀 (45-70%)", "Momentum")}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />{t("과매수 (70%+)", "Overbought")}</span>
                  </div>
                </div>

                <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  <AnimatePresence mode="popLayout">
                    {uStocks.map(s => (
                      <UniverseStockCard
                        key={`${s.market}-${s.ticker}`}
                        stock={s}
                        onAnalyze={() => handleUniverseAnalyze(s)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
