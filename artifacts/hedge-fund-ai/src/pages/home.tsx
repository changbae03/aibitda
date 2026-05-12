import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, Minus, Sparkles, ChevronRight,
  BarChart2, Clock, ArrowUpRight, Flame, Activity, Globe2,
  Zap, Search,
} from "lucide-react";
import { cn, getApiUrl, formatCurrency } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

interface AuthUser { id: string; nickname: string; profileImage: string | null }
function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  useEffect(() => {
    fetch(getApiUrl("/api/auth/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => setUser(d?.user ?? null))
      .catch(() => setUser(null));
  }, []);
  return user;
}

interface RecentAnalysis {
  id: number;
  ticker: string;
  companyName: string | null;
  investmentVerdict: string | null;
  targetPrice: number | null;
  startPrice: number | null;
  createdAt: string;
  status: string;
}

interface PopularTicker {
  ticker: string;
  companyName: string;
  count: number;
  investmentVerdict: string | null;
}

interface MacroData {
  "Fed금리"?: number;
  "10Y"?: number;
  "2Y"?: number;
  "CPI_YoY"?: number;
  "GDP"?: number;
  "실업률"?: number;
  "WTI"?: number;
  "장단기스프레드"?: string;
}

function useRecentAnalyses() {
  return useQuery<RecentAnalysis[]>({
    queryKey: ["home-recent-analyses"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/analyses?limit=8"), { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return d.data ?? d ?? [];
    },
    staleTime: 60_000,
  });
}

function useTrending() {
  return useQuery<{ items: any[]; tickerStats: PopularTicker[] }>({
    queryKey: ["home-trending"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/analysis/popular"));
      if (!r.ok) return { items: [], tickerStats: [] };
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
}

function useMacro() {
  return useQuery<MacroData>({
    queryKey: ["home-macro"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/market-data/macro"), { credentials: "include" });
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: 30 * 60_000,
  });
}

function useCreditsInfo() {
  return useQuery<{ remaining: number; dailyLimit: number; dailyUsed: number }>({
    queryKey: ["home-credits"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/credits"), { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 30_000,
  });
}

const VERDICT_CONFIG: Record<string, { label: string; labelEn: string; color: string; icon: React.ReactNode }> = {
  "Strong Buy":  { label: "강력매수", labelEn: "Strong Buy",  color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/25", icon: <TrendingUp className="w-3 h-3" /> },
  "Buy":         { label: "매수",     labelEn: "Buy",         color: "text-blue-400 bg-blue-400/10 border-blue-400/25",       icon: <TrendingUp className="w-3 h-3" /> },
  "Hold":        { label: "보유",     labelEn: "Hold",        color: "text-amber-400 bg-amber-400/10 border-amber-400/25",    icon: <Minus className="w-3 h-3" /> },
  "Sell":        { label: "매도",     labelEn: "Sell",        color: "text-orange-400 bg-orange-400/10 border-orange-400/25", icon: <TrendingDown className="w-3 h-3" /> },
  "Strong Sell": { label: "강력매도", labelEn: "Strong Sell", color: "text-red-400 bg-red-400/10 border-red-400/25",         icon: <TrendingDown className="w-3 h-3" /> },
};

function VerdictBadge({ verdict, isEn }: { verdict: string | null; isEn: boolean }) {
  if (!verdict) return null;
  const cfg = VERDICT_CONFIG[verdict];
  if (!cfg) return <span className="text-[10px] text-muted-foreground">{verdict}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border", cfg.color)}>
      {cfg.icon}
      {isEn ? cfg.labelEn : cfg.label}
    </span>
  );
}

function UpsideBadge({ target, start }: { target: number | null; start: number | null }) {
  if (!target || !start || start === 0) return null;
  const upside = ((target - start) / start) * 100;
  const isPos = upside >= 0;
  return (
    <span className={cn("text-[11px] font-bold tabular-nums", isPos ? "text-emerald-400" : "text-red-400")}>
      {isPos ? "+" : ""}{upside.toFixed(1)}%
    </span>
  );
}

function timeAgo(dateStr: string, isEn: boolean): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (isEn) {
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${mins}m ago`;
  }
  if (days > 0) return `${days}일 전`;
  if (hours > 0) return `${hours}시간 전`;
  return `${mins}분 전`;
}

export default function Home() {
  const { isEn } = useLanguage();
  const [, setLocation] = useLocation();
  const user = useAuthUser();
  const { data: recentAnalyses, isLoading: loadingRecent } = useRecentAnalyses();
  const { data: trending } = useTrending();
  const { data: macro } = useMacro();
  const { data: credits } = useCreditsInfo();
  const [searchQuery, setSearchQuery] = useState("");

  const hour = new Date().getHours();
  const greeting = isEn
    ? (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening")
    : (hour < 12 ? "좋은 아침이에요" : hour < 18 ? "안녕하세요" : "좋은 저녁이에요");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setLocation(`/analysis/new?ticker=${encodeURIComponent(searchQuery.trim().toUpperCase())}`);
  };

  const trendingList = trending?.tickerStats?.slice(0, 6) ?? [];

  const macroItems = macro ? [
    { label: isEn ? "Fed Rate" : "Fed 금리",   value: macro["Fed금리"] != null ? `${macro["Fed금리"]}%` : "—" },
    { label: isEn ? "US 10Y" : "미국 10년",    value: macro["10Y"] != null ? `${macro["10Y"]}%` : "—" },
    { label: isEn ? "CPI YoY" : "CPI",        value: macro["CPI_YoY"] != null ? `${macro["CPI_YoY"]}%` : "—" },
    { label: isEn ? "US GDP" : "미국 GDP",    value: macro["GDP"] != null ? `${macro["GDP"]}%` : "—" },
    { label: isEn ? "WTI" : "WTI유",          value: macro["WTI"] != null ? `$${macro["WTI"]}` : "—" },
    { label: isEn ? "Unemployment" : "실업률", value: macro["실업률"] != null ? `${macro["실업률"]}%` : "—" },
  ] : [];

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">

      {/* ── 인사 헤더 ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-4"
      >
        <div>
          <h1 className="text-[22px] font-black text-foreground tracking-tight">
            {greeting}{user?.nickname ? `, ${user.nickname}` : ""}
            {!isEn && " 👋"}
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {isEn ? "What stock would you like to analyze today?" : "오늘은 어떤 종목을 분석해볼까요?"}
          </p>
        </div>
        {credits && (
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border shrink-0",
            credits.remaining <= 1
              ? "bg-red-950/30 border-red-700/40 text-red-300"
              : credits.remaining <= 2
              ? "bg-amber-950/30 border-amber-700/40 text-amber-300"
              : "bg-emerald-950/30 border-emerald-700/40 text-emerald-400"
          )}>
            <Zap className="w-3 h-3" />
            {isEn ? `${credits.remaining} credits left` : `크레딧 ${credits.remaining}개 남음`}
          </div>
        )}
      </motion.div>

      {/* ── 빠른 검색 ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <form onSubmit={handleSearch} className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50">
            <Search className="w-4.5 h-4.5" />
          </div>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={isEn ? "Search by company name or ticker (e.g. Samsung, NVDA, 005930)" : "종목명 또는 종목코드 검색 (예: 삼성전자, NVDA, 005930)"}
            className="w-full pl-11 pr-28 py-3.5 rounded-2xl bg-muted/50 border border-border text-[14px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-[#FF8A7A]/30 focus:border-[#FF8A7A]/50 transition-all"
          />
          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF8A7A] text-white text-[12px] font-bold hover:opacity-90 transition-opacity"
          >
            <Sparkles className="w-3 h-3" />
            {isEn ? "Analyze" : "분석"}
          </button>
        </form>

        {/* Quick ticker suggestions */}
        <div className="flex flex-wrap gap-2 mt-3">
          {[
            { ticker: "005930", name: "삼성전자" },
            { ticker: "000660", name: "SK하이닉스" },
            { ticker: "035420", name: "NAVER" },
            { ticker: "NVDA",   name: "NVIDIA" },
            { ticker: "AAPL",   name: "Apple" },
            { ticker: "TSLA",   name: "Tesla" },
          ].map(({ ticker, name }) => (
            <button
              key={ticker}
              onClick={() => setLocation(`/analysis/new?ticker=${ticker}`)}
              className="px-3 py-1.5 rounded-full text-[11.5px] font-medium bg-muted/60 border border-border text-muted-foreground hover:text-foreground hover:border-[#FF8A7A]/40 hover:bg-[#FF8A7A]/5 transition-all"
            >
              {name}
            </button>
          ))}
        </div>
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-5">

        {/* ── 최근 내 분석 ── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-2 rounded-2xl border border-border bg-card p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-[13px] font-bold text-foreground">
                {isEn ? "My Recent Analyses" : "최근 분석 내역"}
              </h2>
            </div>
            <button
              onClick={() => setLocation("/history")}
              className="text-[11px] text-muted-foreground hover:text-[#FF8A7A] transition-colors flex items-center gap-1"
            >
              {isEn ? "View all" : "전체 보기"}
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {loadingRecent ? (
            <div className="space-y-2.5">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 rounded-xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : !recentAnalyses?.length ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#FF8A7A]/10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[#FF8A7A]" />
              </div>
              <p className="text-[13px] font-semibold text-foreground">
                {isEn ? "No analyses yet" : "아직 분석이 없어요"}
              </p>
              <p className="text-[12px] text-muted-foreground max-w-xs">
                {isEn ? "Start your first AI analysis above." : "위에서 종목을 검색해 첫 분석을 시작해보세요."}
              </p>
              <button
                onClick={() => setLocation("/analysis/new")}
                className="mt-1 px-4 py-2 rounded-xl bg-[#FF8A7A] text-white text-[12px] font-bold hover:opacity-90 transition-opacity"
              >
                {isEn ? "Analyze a stock →" : "지금 분석 시작 →"}
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentAnalyses.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.12 + i * 0.04 }}
                  onClick={() => setLocation(`/analysis/${a.id}`)}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#FF8A7A]/10 flex items-center justify-center shrink-0">
                      <Activity className="w-3.5 h-3.5 text-[#FF8A7A]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-foreground truncate">{a.companyName ?? a.ticker}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-mono text-muted-foreground/60">{a.ticker}</span>
                        <span className="text-muted-foreground/30">·</span>
                        <span className="text-[10px] text-muted-foreground/60">{timeAgo(a.createdAt, isEn)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    {a.status === "completed" ? (
                      <>
                        <UpsideBadge target={a.targetPrice} start={a.startPrice} />
                        <VerdictBadge verdict={a.investmentVerdict} isEn={isEn} />
                      </>
                    ) : a.status === "processing" ? (
                      <span className="flex items-center gap-1 text-[10px] text-[#FF8A7A] font-medium">
                        <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}
                          className="w-1.5 h-1.5 rounded-full bg-[#FF8A7A]" />
                        {isEn ? "Analyzing" : "분석 중"}
                      </span>
                    ) : null}
                    <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* ── 우측 컬럼 ── */}
        <div className="space-y-5">

          {/* 커뮤니티 트렌딩 */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-2xl border border-border bg-card p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Flame className="w-4 h-4 text-orange-400" />
              <h2 className="text-[13px] font-bold text-foreground">
                {isEn ? "Trending" : "많이 분석된 종목"}
              </h2>
            </div>

            {!trendingList.length ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-8 rounded-lg bg-muted/40 animate-pulse" />)}
              </div>
            ) : (
              <div className="space-y-1.5">
                {trendingList.map((t, i) => (
                  <motion.div
                    key={t.ticker}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.18 + i * 0.04 }}
                    onClick={() => setLocation(`/analysis/new?ticker=${t.ticker}`)}
                    className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[10px] font-black text-muted-foreground/30 w-4 text-right">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-foreground truncate">{t.companyName}</p>
                        <p className="text-[9px] font-mono text-muted-foreground/50">{t.ticker}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[9px] text-muted-foreground/50">{t.count}건</span>
                      <ChevronRight className="w-3 h-3 text-muted-foreground/20 group-hover:text-[#FF8A7A] transition-colors" />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>

          {/* 매크로 지표 */}
          {macroItems.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="rounded-2xl border border-border bg-card p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Globe2 className="w-4 h-4 text-blue-400" />
                <h2 className="text-[13px] font-bold text-foreground">
                  {isEn ? "US Macro" : "미국 거시지표"}
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {macroItems.map((m) => (
                  <div key={m.label} className="rounded-lg bg-muted/30 px-2.5 py-2">
                    <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">{m.label}</p>
                    <p className="text-[13px] font-bold text-foreground tabular-nums">{m.value}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* ── 바로가기 카드 ── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        {[
          { href: "/analysis/new", icon: Sparkles, label: isEn ? "New Analysis" : "AI 분석",     color: "text-[#FF8A7A] bg-[#FF8A7A]/10" },
          { href: "/history",      icon: Clock,     label: isEn ? "My Reports" : "내 보고서",     color: "text-blue-400 bg-blue-400/10" },
          { href: "/popular",      icon: BarChart2, label: isEn ? "Statistics" : "애빛다 통계",   color: "text-emerald-400 bg-emerald-400/10" },
          { href: "/news",         icon: Activity,  label: isEn ? "News" : "뉴스",               color: "text-amber-400 bg-amber-400/10" },
        ].map((item) => (
          <button
            key={item.href}
            onClick={() => setLocation(item.href)}
            className="flex items-center gap-3 p-4 rounded-2xl border border-border bg-card hover:border-white/16 hover:bg-muted/40 transition-all group text-left"
          >
            <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110", item.color)}>
              <item.icon className="w-4 h-4" />
            </div>
            <span className="text-[13px] font-semibold text-foreground">{item.label}</span>
          </button>
        ))}
      </motion.div>
    </div>
  );
}
