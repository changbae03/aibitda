import { useState, useEffect, useCallback, useId, useMemo } from "react";
import {
  Globe, Package, DollarSign, TrendingUp, BarChart2, Landmark,
  RefreshCw, ChevronDown, ChevronRight, Sparkles, ExternalLink,
  TrendingDown, Minus, Info,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { motion, AnimatePresence } from "framer-motion";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface DashMarketItem {
  id: string; cat: string;
  name: string; nameEn: string;
  symbol: string; unit: string; flag: string;
  value: number | null; change1d: number | null; prevClose: number | null;
}

interface DashCategory {
  id: string; name: string; nameEn: string; icon: string;
  items: DashMarketItem[];
}

interface ETFReco {
  ticker: string; name: string; reason: string;
}

interface MacroInsight {
  theme: string; themeEn: string; description: string;
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  krETFs?: ETFReco[];
  usETFs?: ETFReco[];
}

interface MacroDashboard {
  categories: DashCategory[];
  narrative: string;
  insights: MacroInsight[];
  generatedAt: number;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const CAT_ICON: Record<string, typeof Globe> = {
  markets: Globe, commodities: Package,
  currencies: DollarSign, rates: TrendingUp, fred: BarChart2, korea: Landmark,
};

const SENTIMENT_CONFIG = {
  positive: { bg: "bg-emerald-500/10 border-emerald-500/20", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-500", label: "긍정" },
  negative: { bg: "bg-red-500/10 border-red-500/20",         badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",           dot: "bg-red-500",     label: "부정" },
  neutral:  { bg: "bg-slate-500/10 border-slate-500/20",     badge: "bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400",   dot: "bg-slate-400",   label: "중립" },
  mixed:    { bg: "bg-amber-500/10 border-amber-500/20",     badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",   dot: "bg-amber-500",   label: "혼조" },
};

// ─── 값 포매터 ────────────────────────────────────────────────────────────────

function fmtValue(v: number | null, unit: string, id: string): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  // 지수
  if (id === "sp500" || id === "nasdaq" || id === "dow" || id === "nikkei" ||
      id === "hsi" || id === "stoxx" || id === "shanghai" || id === "kospi") {
    return v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) :
           v >= 100  ? v.toFixed(1) : v.toFixed(2);
  }
  // 환율
  if (id === "usdkrw") return v.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
  if (id === "eurusd") return v.toFixed(4);
  if (id === "usdjpy" || id === "usdcnh") return v.toFixed(2);
  // 곡물 선물 (¢)
  if (id === "corn" || id === "wheat") return v.toFixed(0);
  // 채권 금리
  if (unit === "%") return v.toFixed(2);
  // 원자재
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10)  return v.toFixed(2);
  return v.toFixed(3);
}

// ─── 미니 스파크라인 (prev값 기반 단순 바) ────────────────────────────────────

function ChangeBadge({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground/40 text-[10px]">—</span>;
  const up = v >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[11px] font-mono font-semibold",
      up ? "text-red-500" : "text-blue-500",
    )}>
      <Icon className="w-2.5 h-2.5" />
      {up ? "+" : ""}{v.toFixed(2)}%
    </span>
  );
}

// ─── 스파크라인 (범위 bar) ────────────────────────────────────────────────────

function MiniBar({ change }: { change: number | null }) {
  if (change == null) return <div className="w-14 h-1 rounded-full bg-muted/30" />;
  const pct = Math.min(Math.abs(change) / 5, 1); // ±5% = 100%
  const up = change >= 0;
  return (
    <div className="w-14 h-1 rounded-full bg-muted/30 overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all", up ? "bg-red-400" : "bg-blue-400")}
        style={{ width: `${(pct * 100).toFixed(1)}%`, float: up ? "left" : "right" }}
      />
    </div>
  );
}

// ─── 개별 지표 카드 ───────────────────────────────────────────────────────────

function MarketCard({ item, isEn }: { item: DashMarketItem; isEn: boolean }) {
  const displayName = isEn ? item.nameEn : item.name;
  const value = fmtValue(item.value, item.unit, item.id);
  const isUp = (item.change1d ?? 0) >= 0;

  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2.5 hover:border-border/70 transition-colors">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm leading-none">{item.flag}</span>
          <span className="text-[10px] text-muted-foreground/60 font-medium truncate max-w-[80px]">{displayName}</span>
        </div>
        <ChangeBadge v={item.change1d} />
      </div>
      <div className="flex items-end justify-between gap-1">
        <div className="flex items-baseline gap-0.5">
          <span className={cn(
            "text-base font-bold font-mono leading-none",
            item.change1d == null ? "text-foreground" :
            isUp ? "text-red-500" : "text-blue-500",
          )}>
            {value}
          </span>
          {item.unit && item.unit !== "pt" && item.unit !== "₩" && item.unit !== "¥" &&
            <span className="text-[9px] text-muted-foreground/50 ml-0.5">{item.unit}</span>}
        </div>
        <MiniBar change={item.change1d} />
      </div>
    </div>
  );
}

// ─── 카테고리 섹션 ────────────────────────────────────────────────────────────

function CategorySection({ cat, isEn }: { cat: DashCategory; isEn: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const Icon = CAT_ICON[cat.id] ?? Globe;
  const title = isEn ? cat.nameEn : cat.name;

  return (
    <div className="mb-4">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="flex items-center gap-2 mb-2 group"
      >
        <Icon className="w-3.5 h-3.5 text-primary/60" />
        <span className="text-sm font-semibold text-foreground/80">{title}</span>
        <span className="text-[10px] text-muted-foreground/40">({cat.items.length})</span>
        <ChevronDown className={cn(
          "w-3 h-3 text-muted-foreground/30 transition-transform ml-0.5",
          collapsed && "-rotate-90"
        )} />
      </button>
      {!collapsed && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {cat.items.map(it => (
            <MarketCard key={it.id} item={it} isEn={isEn} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ETF 태그 ────────────────────────────────────────────────────────────────

function ETFTag({ etf, market }: { etf: ETFReco; market: "KR" | "US" }) {
  const isKR = market === "KR";
  const searchUrl = isKR
    ? `https://finance.naver.com/item/main.naver?code=${etf.ticker}`
    : `https://finance.yahoo.com/quote/${etf.ticker}`;

  return (
    <a
      href={searchUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={etf.reason}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors hover:opacity-80",
        isKR
          ? "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400"
          : "bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400",
      )}
    >
      <span className="font-mono font-bold">{etf.ticker}</span>
      {etf.name && <span className="text-[10px] opacity-70 hidden sm:inline truncate max-w-[80px]">{etf.name}</span>}
      <ExternalLink className="w-2.5 h-2.5 opacity-40 shrink-0" />
    </a>
  );
}

// ─── 인사이트 카드 ────────────────────────────────────────────────────────────

function InsightCard({ insight, isEn }: { insight: MacroInsight; isEn: boolean }) {
  const [open, setOpen] = useState(false);
  const cfg = SENTIMENT_CONFIG[insight.sentiment] ?? SENTIMENT_CONFIG.neutral;
  const hasETFs = (insight.krETFs?.length ?? 0) > 0 || (insight.usETFs?.length ?? 0) > 0;
  const title = isEn ? insight.themeEn : insight.theme;

  return (
    <motion.div
      layout
      className={cn("rounded-xl border overflow-hidden", cfg.bg)}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className={cn("w-2 h-2 rounded-full shrink-0", cfg.dot)} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground/90">{title}</span>
              <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full", cfg.badge)}>
                {isEn
                  ? { positive: "Positive", negative: "Negative", neutral: "Neutral", mixed: "Mixed" }[insight.sentiment]
                  : cfg.label}
              </span>
            </div>
            {!open && (
              <p className="text-[11px] text-muted-foreground/60 mt-0.5 line-clamp-1">{insight.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {hasETFs && (
            <span className="text-[10px] text-muted-foreground/40">
              ETF {(insight.krETFs?.length ?? 0) + (insight.usETFs?.length ?? 0)}
            </span>
          )}
          <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/40 transition-transform", open && "rotate-180")} />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 space-y-3 border-t border-current/10">
              <p className="text-[12px] text-foreground/70 mt-3 leading-relaxed">{insight.description}</p>

              {hasETFs && (
                <div className="space-y-2">
                  {(insight.krETFs?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/50 mb-1.5 font-semibold">
                        🇰🇷 {isEn ? "Korean ETFs" : "국내 ETF"}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {insight.krETFs!.map(e => <ETFTag key={e.ticker} etf={e} market="KR" />)}
                      </div>
                    </div>
                  )}
                  {(insight.usETFs?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/50 mb-1.5 font-semibold">
                        🇺🇸 {isEn ? "US ETFs" : "미국 ETF"}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {insight.usETFs!.map(e => <ETFTag key={e.ticker} etf={e} market="US" />)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── 공유 캐시 & 데이터 훅 ────────────────────────────────────────────────────

let _dashCache: { data: MacroDashboard; fetchedAt: number } | null = null;

function useMacroDashboard() {
  const [data, setData] = useState<MacroDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!force && _dashCache && Date.now() - _dashCache.fetchedAt < 20 * 60 * 1000) {
      setData(_dashCache.data);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(getApiUrl("/api/macro/dashboard"), { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}`);
      const d: MacroDashboard = await r.json();
      _dashCache = { data: d, fetchedAt: Date.now() };
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? "오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, load };
}

// ─── 임베드용 패널 (ETF 분석 탭 등에서 사용) ─────────────────────────────────

export function MacroDashboardPanel() {
  const { isEn } = useLanguage();
  const { data, loading, error, load } = useMacroDashboard();
  const [activeTab, setActiveTab] = useState<string>("all");

  const tabs = useMemo(() => {
    if (!data) return [];
    return [
      { id: "all",      label: isEn ? "All" : "전체" },
      ...data.categories.map(c => ({ id: c.id, label: isEn ? c.nameEn : c.name })),
      { id: "insights", label: isEn ? "AI Insights" : "AI 시사점" },
    ];
  }, [data, isEn]);

  const visibleCats = useMemo(() => {
    if (!data) return [];
    if (activeTab === "all" || activeTab === "insights") return data.categories;
    return data.categories.filter(c => c.id === activeTab);
  }, [data, activeTab]);

  const updatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-4">
      {/* 상단 새로고침 줄 */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground/40">
          {updatedAt ? `${isEn ? "Updated" : "업데이트"}: ${updatedAt}` : ""}
        </p>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          {isEn ? "Refresh" : "새로고침"}
        </button>
      </div>

      {/* 로딩 */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <RefreshCw className="w-5 h-5 animate-spin text-primary/50" />
          <p className="text-xs text-muted-foreground/60">
            {isEn ? "Loading market data & generating AI insights…" : "시장 데이터 수집 및 AI 인사이트 생성 중…"}
          </p>
          <p className="text-[10px] text-muted-foreground/40">
            {isEn ? "(Yahoo Finance + FRED + Gemini AI, ~10s)" : "(Yahoo Finance + FRED + Gemini AI, 약 10초)"}
          </p>
        </div>
      )}

      {/* 오류 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-500">
          {isEn ? `Failed to load data (${error})` : `데이터 로드 실패 (${error})`} —{" "}
          <button onClick={() => load(true)} className="underline">{isEn ? "Retry" : "재시도"}</button>
        </div>
      )}

      {data && (
        <>
          {/* AI 내러티브 배너 */}
          {data.narrative && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
              <p className="text-[12px] text-foreground/80 leading-relaxed">{data.narrative}</p>
            </div>
          )}

          {/* 카테고리 탭 */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors shrink-0",
                  activeTab === t.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                {t.id === "insights" && <Sparkles className="w-2.5 h-2.5 inline mr-1 -mt-0.5" />}
                {t.label}
              </button>
            ))}
          </div>

          {/* 시장 지표 카테고리 */}
          {activeTab !== "insights" && (
            <div>
              {visibleCats.map(cat => (
                <CategorySection key={cat.id} cat={cat} isEn={isEn} />
              ))}
            </div>
          )}

          {/* AI 시사점 & ETF 추천 */}
          {(activeTab === "all" || activeTab === "insights") && data.insights.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-primary/60" />
                <h2 className="text-sm font-semibold text-foreground/80">
                  {isEn ? "AI Macro Insights & ETF Picks" : "AI 거시 시사점 & ETF 추천"}
                </h2>
                <span className="text-[10px] text-muted-foreground/40 ml-1">Powered by Gemini</span>
              </div>
              <div className="space-y-2">
                {data.insights.map((ins, i) => (
                  <InsightCard key={i} insight={ins} isEn={isEn} />
                ))}
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground/40 leading-relaxed">
                {isEn
                  ? "* AI-generated insights are for reference only and not investment advice."
                  : "* AI 인사이트는 참고용이며 투자 권유가 아닙니다. 투자 결정은 본인의 책임입니다."}
              </p>
            </div>
          )}

          {activeTab === "insights" && data.insights.length === 0 && (
            <div className="text-center py-10 text-muted-foreground/40 text-sm">
              {isEn ? "No AI insights available yet." : "AI 인사이트를 생성하지 못했습니다."}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function MacroDashboardPage() {
  const { isEn } = useLanguage();
  const { data, loading, error, load } = useMacroDashboard();
  const [activeTab, setActiveTab] = useState<string>("all");

  const tabs = useMemo(() => {
    if (!data) return [];
    return [
      { id: "all",         label: isEn ? "All" : "전체" },
      ...data.categories.map(c => ({ id: c.id, label: isEn ? c.nameEn : c.name })),
      { id: "insights",    label: isEn ? "AI Insights" : "AI 시사점" },
    ];
  }, [data, isEn]);

  const visibleCats = useMemo(() => {
    if (!data) return [];
    if (activeTab === "all" || activeTab === "insights") return data.categories;
    return data.categories.filter(c => c.id === activeTab);
  }, [data, activeTab]);

  const updatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-16">
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary/70" />
            {isEn ? "Macro Dashboard" : "거시 대시보드"}
          </h1>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            {isEn
              ? "Global markets · Commodities · FX · Rates · AI Insights · ETF picks"
              : "글로벌 시장 · 원자재 · 환율 · 금리 · 한국 경제 · AI 시사점 · ETF 추천"}
          </p>
          {updatedAt && (
            <p className="text-[10px] text-muted-foreground/40 mt-1">{isEn ? "Updated" : "업데이트"}: {updatedAt}</p>
          )}
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors px-2 py-1.5 rounded-lg hover:bg-accent/40"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          {isEn ? "Refresh" : "새로고침"}
        </button>
      </div>

      {/* 로딩 */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-primary/50" />
          <p className="text-sm text-muted-foreground/60">
            {isEn ? "Loading market data & generating AI insights…" : "시장 데이터 수집 및 AI 인사이트 생성 중…"}
          </p>
          <p className="text-[11px] text-muted-foreground/40">
            {isEn ? "(Yahoo Finance + FRED + Gemini AI, ~10s)" : "(Yahoo Finance + FRED + Gemini AI, 약 10초)"}
          </p>
        </div>
      )}

      {/* 오류 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-500 mb-4">
          {isEn ? `Failed to load data (${error})` : `데이터 로드 실패 (${error})`}
        </div>
      )}

      {data && (
        <>
          {/* AI 내러티브 배너 */}
          {data.narrative && (
            <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
              <p className="text-[12px] text-foreground/80 leading-relaxed">{data.narrative}</p>
            </div>
          )}

          {/* 탭 */}
          <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1 scrollbar-none">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors shrink-0",
                  activeTab === t.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                {t.id === "insights" && <Sparkles className="w-2.5 h-2.5 inline mr-1 -mt-0.5" />}
                {t.label}
              </button>
            ))}
          </div>

          {/* 시장 지표 카테고리 */}
          {activeTab !== "insights" && (
            <div className="mb-6">
              {visibleCats.map(cat => (
                <CategorySection key={cat.id} cat={cat} isEn={isEn} />
              ))}
            </div>
          )}

          {/* AI 시사점 & ETF 추천 */}
          {(activeTab === "all" || activeTab === "insights") && data.insights.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-primary/60" />
                <h2 className="text-sm font-semibold text-foreground/80">
                  {isEn ? "AI Macro Insights & ETF Picks" : "AI 거시 시사점 & ETF 추천"}
                </h2>
                <span className="text-[10px] text-muted-foreground/40 ml-1">Powered by Gemini</span>
              </div>
              <div className="space-y-2">
                {data.insights.map((ins, i) => (
                  <InsightCard key={i} insight={ins} isEn={isEn} />
                ))}
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground/40 leading-relaxed">
                {isEn
                  ? "* AI-generated insights are for reference only and not investment advice."
                  : "* AI 인사이트는 참고용이며 투자 권유가 아닙니다. 투자 결정은 본인의 책임입니다."}
              </p>
            </div>
          )}

          {/* 인사이트 탭인데 인사이트 없을 때 */}
          {activeTab === "insights" && data.insights.length === 0 && (
            <div className="text-center py-10 text-muted-foreground/40 text-sm">
              {isEn ? "No AI insights available yet." : "AI 인사이트를 생성하지 못했습니다."}
            </div>
          )}
        </>
      )}
    </div>
  );
}
