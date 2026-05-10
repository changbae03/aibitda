import { useState, useEffect, useCallback, useRef } from "react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { ko, enUS } from "date-fns/locale";
import {
  CalendarDays, RefreshCw, TrendingUp, DollarSign,
  ChevronRight, Building2, AlertCircle, Sparkles, Globe, X,
} from "lucide-react";
import { cn, getApiUrl, formatCurrency } from "@/lib/utils";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/language-context";

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface EarningsEntry {
  ticker: string;
  companyName: string;
  earningsDate: string;
  epsEstimate: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  revenueEstimate: number | null;
  currency: string;
  isKorean: boolean;
}

interface EconomicEvent {
  date: string;
  time?: string;
  title: string;
  country: string;
  category: string;
  importance: "high" | "medium" | "low";
  forecast?: string;
  previous?: string;
  unit?: string;
}

type CalendarItem =
  | { kind: "earnings"; date: string; data: EarningsEntry }
  | { kind: "economic"; date: string; data: EconomicEvent };

type Range = "week" | "month";
type Filter = "all" | "earnings" | "economic";

// ── 클라이언트 캐시 ────────────────────────────────────────────────────────────
const _earningsCache = new Map<string, { data: EarningsEntry[]; fetchedAt: number }>();
const _economicCache = new Map<string, { data: EconomicEvent[]; fetchedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── 헬퍼 함수 ─────────────────────────────────────────────────────────────────
function fmtEps(val: number | null, currency: string): string {
  if (val == null) return "—";
  if (currency === "KRW") return `${Math.round(val).toLocaleString("ko-KR")}원`;
  return `$${val.toFixed(2)}`;
}

function fmtRevenue(val: number | null, isKorean: boolean): string {
  if (val == null) return "—";
  if (isKorean) {
    if (val >= 1e12) return `${(val / 1e12).toFixed(1)}조원`;
    if (val >= 1e8) return `${(val / 1e8).toFixed(0)}억원`;
    return `${val.toLocaleString("ko-KR")}원`;
  }
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

function DateBadge({ dateStr }: { dateStr: string }) {
  const { isEn } = useLanguage();
  const d = parseISO(dateStr);
  if (isToday(d)) return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 ml-2">
      {isEn ? "Today" : "오늘"}
    </span>
  );
  if (isTomorrow(d)) return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ml-2">
      {isEn ? "Tomorrow" : "내일"}
    </span>
  );
  return null;
}

function ExchangeBadge({ ticker, isKorean }: { ticker: string; isKorean: boolean }) {
  const exchange = ticker.endsWith(".KS") ? "KOSPI" : ticker.endsWith(".KQ") ? "KOSDAQ" : isKorean ? "KRX" : "US";
  const cls = isKorean
    ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
    : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300";
  return <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", cls)}>{exchange}</span>;
}

const COUNTRY_FLAG: Record<string, string> = {
  US: "🇺🇸", KR: "🇰🇷", EU: "🇪🇺", EZ: "🇪🇺", CN: "🇨🇳", JP: "🇯🇵",
  DE: "🇩🇪", GB: "🇬🇧", FR: "🇫🇷", AU: "🇦🇺", CA: "🇨🇦",
};

const IMPORTANCE_STYLE: Record<string, { dot: string; badge: string; ko: string; en: string }> = {
  high:   { dot: "bg-red-500",    badge: "text-red-700 dark:bg-red-900/40 dark:text-red-300",    ko: "매우 중요", en: "High" },
  medium: { dot: "bg-amber-400",  badge: "text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", ko: "중요", en: "Medium" },
  low:    { dot: "bg-slate-300",  badge: "text-slate-500 dark:bg-slate-800 dark:text-slate-400", ko: "보통", en: "Low" },
};

const CATEGORY_ICON: Record<string, string> = {
  금리결정: "🏦", 물가지표: "📊", 고용: "👷", 성장률: "📈",
  무역: "🚢", 제조업: "🏭", 소비: "🛒", 기타: "📋",
};

// ── 서브 컴포넌트 ──────────────────────────────────────────────────────────────
function EarningsCard({ entry, onSelect }: { entry: EarningsEntry; onSelect: (e: EarningsEntry) => void }) {
  const { isEn } = useLanguage();
  const hasEps = entry.epsEstimate !== null;
  const hasRevenue = entry.revenueEstimate !== null;
  const shortTicker = entry.ticker.replace(/\.(KS|KQ)$/, "");

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onSelect(entry)}
      className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card hover:bg-accent/40 active:scale-[0.99] transition-all cursor-pointer"
    >
      <div className="mt-0.5 w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <Building2 className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">{entry.companyName}</span>
          <ExchangeBadge ticker={entry.ticker} isKorean={entry.isKorean} />
          <span className="text-xs text-muted-foreground">{shortTicker}</span>
        </div>
        {(hasEps || hasRevenue) ? (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {hasEps && (
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                {isEn ? "EPS Est:" : "EPS 예상:"} <span className="text-foreground font-medium ml-0.5">{fmtEps(entry.epsEstimate, entry.currency)}</span>
                {entry.epsLow !== null && entry.epsHigh !== null && (
                  <span className="text-muted-foreground/70">({fmtEps(entry.epsLow, entry.currency)} – {fmtEps(entry.epsHigh, entry.currency)})</span>
                )}
              </span>
            )}
            {hasRevenue && (
              <span className="flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                {isEn ? "Rev Est:" : "매출 예상:"} <span className="text-foreground font-medium ml-0.5">{fmtRevenue(entry.revenueEstimate, entry.isKorean)}</span>
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground/60">{isEn ? "No consensus data" : "컨센서스 데이터 없음"}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-1" />
    </motion.div>
  );
}

function fmtIndicator(value: string | undefined | null, unit: string | undefined | null): string {
  if (value == null || value === "") return "N/A";
  const v = String(value).trim();
  if (!unit) return v;
  const u = unit.trim();
  if (v.endsWith(u) || v.toLowerCase().endsWith(u.toLowerCase())) return v;
  return `${v}${u}`;
}

function EconomicCard({ event }: { event: EconomicEvent }) {
  const { isEn } = useLanguage();
  const imp = IMPORTANCE_STYLE[event.importance] ?? IMPORTANCE_STYLE.low;
  const flag = COUNTRY_FLAG[event.country] ?? "🌐";
  const catIcon = CATEGORY_ICON[event.category] ?? "📋";
  const impLabel = isEn ? imp.en : imp.ko;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card"
    >
      <div className="mt-0.5 w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 relative">
        <span className="text-base leading-none">{catIcon}</span>
        <span className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-background", imp.dot)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground leading-snug">{event.title}</span>
          <span className="text-sm">{flag}</span>
          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", imp.badge)}>
            {impLabel}
          </span>
          {event.time && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {event.time.replace(/\s*KST\s*$/i, "")} KST
            </span>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{event.category}</span>
          {event.forecast != null && event.forecast !== "" && (
            <span>{isEn ? "Fcst:" : "예상:"} <span className="text-foreground font-medium">
              {fmtIndicator(event.forecast, event.unit)}
            </span></span>
          )}
          {event.previous != null && event.previous !== "" && (
            <span>{isEn ? "Prev:" : "이전:"} <span className="text-foreground/70">
              {fmtIndicator(event.previous, event.unit)}
            </span></span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function DateGroup({
  date,
  items,
  onSelectEarnings,
}: {
  date: string;
  items: CalendarItem[];
  onSelectEarnings: (e: EarningsEntry) => void;
}) {
  const { isEn } = useLanguage();
  const d = parseISO(date);
  const label = isEn
    ? format(d, "MMM d (EEE)", { locale: enUS })
    : format(d, "M월 d일 (EEE)", { locale: ko });
  const earningsCount = items.filter(i => i.kind === "earnings").length;
  const economicCount = items.filter(i => i.kind === "economic").length;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <DateBadge dateStr={date} />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {earningsCount > 0 && <span>{isEn ? `${earningsCount} Earnings` : `${earningsCount}종목 실적`}</span>}
          {economicCount > 0 && <span>{isEn ? `${economicCount} Indicators` : `${economicCount}개 지표`}</span>}
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item, idx) =>
          item.kind === "earnings" ? (
            <EarningsCard key={`e-${item.data.ticker}`} entry={item.data} onSelect={onSelectEarnings} />
          ) : (
            <EconomicCard key={`ec-${idx}`} event={item.data} />
          )
        )}
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { isEn } = useLanguage();
  const t = (ko: string, en: string) => isEn ? en : ko;

  const [range, setRange] = useState<Range>("week");
  const [filter, setFilter] = useState<Filter>("all");
  const [earnings, setEarnings] = useState<EarningsEntry[]>([]);
  const [economic, setEconomic] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [pendingEntry, setPendingEntry] = useState<EarningsEntry | null>(null);
  const [, navigate] = useLocation();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const fetchAll = useCallback(async (r: Range, forceRefresh = false) => {
    const earCached = _earningsCache.get(r);
    const ecoCached = _economicCache.get(r);
    const earOk = !forceRefresh && earCached && Date.now() - earCached.fetchedAt < CACHE_TTL_MS;
    const ecoOk = !forceRefresh && ecoCached && Date.now() - ecoCached.fetchedAt < CACHE_TTL_MS;

    if (earOk && ecoOk) {
      setEarnings(earCached!.data);
      setEconomic(ecoCached!.data);
      setLastFetched(new Date(Math.max(earCached!.fetchedAt, ecoCached!.fetchedAt)));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range: r });
      const [earRes, ecoRes] = await Promise.all([
        earOk ? null : fetch(getApiUrl(`/api/market-data/earnings-calendar?${params}`), { credentials: "include" }),
        ecoOk ? null : fetch(getApiUrl(`/api/market-data/economic-calendar?${params}`), { credentials: "include" }),
      ]);

      if (earRes && !earRes.ok) throw new Error(`실적 캘린더 오류: ${earRes.status}`);
      if (ecoRes && !ecoRes.ok) throw new Error(`경제지표 캘린더 오류: ${ecoRes.status}`);

      const now = Date.now();
      const newEarnings: EarningsEntry[] = earRes ? await earRes.json() : earCached!.data;
      const newEconomic: EconomicEvent[] = ecoRes ? await ecoRes.json() : ecoCached!.data;

      _earningsCache.set(r, { data: newEarnings, fetchedAt: now });
      _economicCache.set(r, { data: newEconomic, fetchedAt: now });

      if (mountedRef.current) {
        setEarnings(newEarnings);
        setEconomic(newEconomic);
        setLastFetched(new Date(now));
      }
    } catch (e: any) {
      if (mountedRef.current) setError(e.message ?? t("불러오기 실패", "Failed to load"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(range); }, [range, fetchAll]);

  const allItems: CalendarItem[] = [
    ...(filter !== "economic" ? earnings.map(e => ({ kind: "earnings" as const, date: e.earningsDate, data: e })) : []),
    ...(filter !== "earnings" ? economic.map(e => ({ kind: "economic" as const, date: e.date, data: e })) : []),
  ];

  const grouped = allItems.reduce<Record<string, CalendarItem[]>>((acc, item) => {
    if (!acc[item.date]) acc[item.date] = [];
    acc[item.date].push(item);
    return acc;
  }, {});
  for (const date of Object.keys(grouped)) {
    grouped[date].sort((a, b) => {
      const imp = { high: 0, medium: 1, low: 2 };
      const ai = a.kind === "economic" ? imp[a.data.importance] : 3;
      const bi = b.kind === "economic" ? imp[b.data.importance] : 3;
      return ai - bi;
    });
  }
  const sortedDates = Object.keys(grouped).sort();

  const totalEarnings = earnings.length;
  const totalEconomic = economic.length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
      {/* 헤더 */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">{t("마켓 캘린더", "Market Calendar")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("실적 발표 · 경제지표 · 금리결정 등 주요 시장 일정", "Earnings · Economic Indicators · Rate Decisions and more")}
        </p>
      </div>

      {/* 기간 탭 + 새로고침 */}
      <div className="flex items-center gap-2 mb-3">
        {(["week", "month"] as Range[]).map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors",
              range === r
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {r === "week" ? t("이번 주 (7일)", "This Week (7d)") : t("이번 달 (30일)", "This Month (30d)")}
          </button>
        ))}
        <button
          onClick={() => fetchAll(range, true)}
          disabled={loading}
          className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex items-center gap-1.5 mb-4">
        {([
          { key: "all", ko: "전체", en: "All" },
          { key: "earnings", ko: "📢 실적 발표", en: "📢 Earnings" },
          { key: "economic", ko: "📊 경제지표", en: "📊 Economic" },
        ] as { key: Filter; ko: string; en: string }[]).map(({ key, ko: koLabel, en: enLabel }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-medium transition-colors",
              filter === key
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {isEn ? enLabel : koLabel}
          </button>
        ))}
      </div>

      {/* 업데이트 시각 */}
      {lastFetched && !loading && (
        <p className="text-xs text-muted-foreground mb-3">
          {t("업데이트:", "Updated:")} {format(lastFetched, "HH:mm:ss")}
        </p>
      )}

      {/* 콘텐츠 */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center py-16 text-muted-foreground"
          >
            <RefreshCw className="w-8 h-8 animate-spin mb-3 text-primary/60" />
            <p className="text-sm">{t("캘린더 데이터를 불러오는 중…", "Loading calendar data…")}</p>
            <p className="text-xs mt-1 text-muted-foreground/60">{t("실적 + 경제지표 일정 조회 중 (수 초 소요)", "Fetching earnings + economic events (may take a few seconds)")}</p>
          </motion.div>
        ) : error ? (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center py-16 text-muted-foreground"
          >
            <AlertCircle className="w-8 h-8 mb-3 text-destructive/60" />
            <p className="text-sm text-destructive">{error}</p>
            <button onClick={() => fetchAll(range, true)} className="mt-3 text-xs text-primary underline underline-offset-2">
              {t("다시 시도", "Retry")}
            </button>
          </motion.div>
        ) : sortedDates.length === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center py-16 text-muted-foreground"
          >
            <CalendarDays className="w-10 h-10 mb-3 text-muted-foreground/40" />
            <p className="text-sm font-medium">{t("해당 기간 일정 없음", "No events for this period")}</p>
            <p className="text-xs mt-1 text-muted-foreground/60">{t("기간이나 필터를 변경해 보세요", "Try changing the range or filter")}</p>
          </motion.div>
        ) : (
          <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* 요약 배너 */}
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-muted/60 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span>{t(`향후 ${range === "week" ? "7일" : "30일"}`, `Next ${range === "week" ? "7" : "30"} days`)}</span>
              {filter !== "economic" && (
                <span>
                  <span className="font-semibold text-foreground">{totalEarnings}{t("개 종목", " stocks")}</span> {t("실적 발표", "earnings")}
                </span>
              )}
              {filter !== "earnings" && (
                <span>
                  <span className="font-semibold text-foreground">{totalEconomic}{t("개", "")}</span> {t("경제지표", "economic indicators")}
                </span>
              )}
            </div>

            {/* 중요도 범례 */}
            {filter !== "earnings" && (
              <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/60">{t("중요도:", "Importance:")}</span>
                {(["high", "medium", "low"] as const).map(imp => (
                  <span key={imp} className="flex items-center gap-1">
                    <span className={cn("w-2 h-2 rounded-full", IMPORTANCE_STYLE[imp].dot)} />
                    {isEn ? IMPORTANCE_STYLE[imp].en : IMPORTANCE_STYLE[imp].ko}
                  </span>
                ))}
              </div>
            )}

            {/* 날짜별 그룹 */}
            {sortedDates.map(date => (
              <DateGroup key={date} date={date} items={grouped[date]} onSelectEarnings={setPendingEntry} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 분석 확인 배너 */}
      <AnimatePresence>
        {pendingEntry && (
          <motion.div
            key="confirm-banner"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm mx-auto px-4"
          >
            <div className="flex items-center gap-3 bg-background border border-border rounded-2xl shadow-xl px-4 py-3.5">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{pendingEntry.companyName}</p>
                <p className="text-xs text-muted-foreground">{t("AI 분석을 시작할까요?", "Start AI Analysis?")}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setPendingEntry(null)} className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">
                  {t("취소", "Cancel")}
                </button>
                <button
                  onClick={() => {
                    navigate(`/analysis/new?ticker=${encodeURIComponent(pendingEntry.ticker)}&autostart=true`);
                    setPendingEntry(null);
                  }}
                  className="px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  {t("분석 시작", "Analyze")}
                </button>
              </div>
              <button onClick={() => setPendingEntry(null)} className="ml-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
