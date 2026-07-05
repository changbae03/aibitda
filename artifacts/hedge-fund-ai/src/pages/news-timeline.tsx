import { useState, useCallback, useRef, useEffect } from "react";
import {
  Search, Sparkles, Clock, ExternalLink, RefreshCw,
  Globe, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { motion, AnimatePresence } from "framer-motion";

/* ── 타입 ───────────────────────────────────────────────────────────────── */
interface TimelineEvent {
  date: string;
  dateLabel: string;
  event: string;
  detail: string;
  importance: "high" | "medium" | "low";
  category: string;
  source?: string;
  url?: string;
}
interface TimelineData {
  keyword: string;
  summary: string;
  timeline: TimelineEvent[];
  generatedAt: number;
}

/* ── 상수 ───────────────────────────────────────────────────────────────── */
const PRESET_KEYWORDS = [
  "이란", "미중갈등", "연준 금리", "반도체", "트럼프 관세",
  "우크라이나", "엔비디아", "삼성전자", "원/달러", "OPEC",
];

const IMPORTANCE_CONFIG = {
  high:   { dot: "bg-rose-500",   badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",    label: "핵심", ring: "border-l-rose-500" },
  medium: { dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", label: "주요", ring: "border-l-amber-500" },
  low:    { dot: "bg-slate-400",  badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",   label: "참고", ring: "border-l-slate-300 dark:border-l-slate-600" },
};

const CAT_COLOR: Record<string, string> = {
  외교: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  경제: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  군사: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  시장: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  정치: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  에너지: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  기술: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  금융: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
};

/* ── 메인 컴포넌트 ──────────────────────────────────────────────────────── */
export default function NewsTimeline() {
  const { isEn } = useLanguage();
  const [activeKeyword, setActiveKeyword] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [trendingKeywords, setTrendingKeywords] = useState<string[]>(PRESET_KEYWORDS);
  const [data, setData] = useState<TimelineData | null>(null);

  useEffect(() => {
    fetch(getApiUrl("/api/market-analysis/trending-keywords"))
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.keywords) && d.keywords.length >= 4) setTrendingKeywords(d.keywords); })
      .catch(() => {});
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchTimeline = useCallback(async (kw: string, force = false) => {
    if (!kw.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setExpandedIdx(null);
    setActiveKeyword(kw.trim());
    try {
      const url = getApiUrl(`/api/news/timeline?keyword=${encodeURIComponent(kw.trim())}${force ? "&force=true" : ""}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TimelineData = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "타임라인 생성 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTimeline(inputVal);
  };

  const handlePreset = (kw: string) => {
    setInputVal(kw);
    fetchTimeline(kw);
  };

  const updatedAt = data
    ? new Date(data.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-6 h-6 text-primary/70" />
            {isEn ? "Issue Timeline" : "이슈 타임라인"}
          </h1>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            {isEn
              ? "Trace any keyword from origin to now · Powered by Gemini AI"
              : "키워드로 처음부터 지금까지의 흐름을 한눈에 · Gemini AI 생성"}
          </p>
        </div>
        {data && (
          <button
            onClick={() => fetchTimeline(activeKeyword, true)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-accent transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            {isEn ? "Refresh" : "새로고침"}
          </button>
        )}
      </div>

      {/* 검색 폼 */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            ref={inputRef}
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            placeholder={isEn
              ? "Enter keyword (e.g. Iran, NVIDIA, US tariffs...)"
              : "키워드 입력 (예: 이란, 엔비디아, 미중갈등...)"}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !inputVal.trim()}
          className="px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          <Sparkles className="w-4 h-4" />
          {isEn ? "Generate" : "생성"}
        </button>
      </form>

      {/* 트렌딩 키워드 칩 */}
      <div className="flex flex-wrap gap-2">
        {trendingKeywords.map(kw => (
          <button
            key={kw}
            onClick={() => handlePreset(kw)}
            disabled={loading}
            className={cn(
              "px-3 py-1 text-xs rounded-full border transition-colors",
              activeKeyword === kw
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
            )}
          >
            {kw}
          </button>
        ))}
      </div>

      {/* 로딩 스켈레톤 */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-5"
          >
            <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/5 border border-primary/10">
              <Sparkles className="w-5 h-5 text-primary animate-pulse" />
              <div>
                <p className="text-sm font-medium">
                  &quot;{activeKeyword}&quot; {isEn ? "timeline generating..." : "타임라인 생성 중..."}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  {isEn
                    ? "Gemini AI is analyzing news and historical context"
                    : "Gemini AI가 뉴스와 역사적 맥락을 분석하고 있습니다"}
                </p>
              </div>
            </div>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className="w-3.5 h-3.5 rounded-full bg-muted mt-1.5" />
                </div>
                <div className="flex-1 pb-5 space-y-2">
                  <div className="h-3 bg-muted rounded w-20" />
                  <div className="h-5 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 에러 */}
      {error && !loading && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* 결과 */}
      <AnimatePresence>
        {data && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            {/* AI 요약 */}
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 flex gap-3">
              <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-primary">
                    {isEn ? "AI Summary" : "AI 종합 분석"}
                  </span>
                  {updatedAt && (
                    <span className="text-[10px] text-muted-foreground/50">
                      {isEn ? "Updated" : "업데이트"}: {updatedAt}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">{data.summary}</p>
              </div>
            </div>

            {/* 이벤트 수 */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <Globe className="w-3.5 h-3.5" />
              <span>
                <span className="font-medium text-foreground">{data.timeline.length}개</span> 주요 사건
              </span>
              <span>·</span>
              <span className="text-rose-500 font-medium">
                {data.timeline.filter(e => e.importance === "high").length}개 핵심 이벤트
              </span>
            </div>

            {/* 타임라인 */}
            <div className="relative pl-1">
              {/* 세로 선 */}
              <div className="absolute left-[7px] top-2 bottom-8 w-px bg-border/60" />

              <div className="space-y-0">
                {data.timeline.map((ev, idx) => {
                  const cfg = IMPORTANCE_CONFIG[ev.importance] ?? IMPORTANCE_CONFIG.low;
                  const catColor = CAT_COLOR[ev.category] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
                  const isExpanded = expandedIdx === idx;

                  return (
                    <motion.div
                      key={`${ev.date}-${idx}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.045, duration: 0.25 }}
                      className="flex gap-4"
                    >
                      {/* 점 */}
                      <div className="shrink-0 flex flex-col items-center">
                        <div className={cn(
                          "w-3.5 h-3.5 rounded-full border-2 border-background mt-2 z-10",
                          cfg.dot
                        )} />
                      </div>

                      {/* 카드 */}
                      <div className={cn(
                        "flex-1 mb-4 rounded-xl border border-border border-l-[3px] bg-card shadow-sm overflow-hidden",
                        cfg.ring
                      )}>
                        {/* 클릭 영역 */}
                        <button
                          className="w-full text-left px-4 py-3 hover:bg-accent/30 transition-colors"
                          onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              {/* 배지 행 */}
                              <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
                                <span className="text-[11px] font-semibold text-muted-foreground/70 tabular-nums">
                                  {ev.dateLabel || ev.date}
                                </span>
                                <span className={cn("px-1.5 py-px text-[10px] font-semibold rounded-full", cfg.badge)}>
                                  {cfg.label}
                                </span>
                                <span className={cn("px-1.5 py-px text-[10px] font-medium rounded-full", catColor)}>
                                  {ev.category}
                                </span>
                              </div>
                              {/* 제목 */}
                              <p className="text-sm font-semibold leading-snug">{ev.event}</p>
                            </div>
                            {isExpanded
                              ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />
                              : <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />
                            }
                          </div>
                        </button>

                        {/* 펼침 상세 */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.18 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4 border-t border-border/50 pt-3">
                                <p className="text-sm text-muted-foreground leading-relaxed">{ev.detail}</p>
                                {(ev.source || ev.url) && (
                                  <div className="flex items-center gap-2 mt-3">
                                    {ev.source && (
                                      <span className="text-[11px] text-muted-foreground/60 bg-muted px-2 py-0.5 rounded-full">
                                        {ev.source}
                                      </span>
                                    )}
                                    {ev.url && (
                                      <a
                                        href={ev.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[11px] text-primary hover:underline flex items-center gap-1"
                                        onClick={e => e.stopPropagation()}
                                      >
                                        원문 보기 <ExternalLink className="w-3 h-3" />
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* 주의사항 */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-[11px] text-muted-foreground/60">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {isEn
                  ? "This timeline is AI-generated from RSS news + Gemini training data. Use as a reference only."
                  : "이 타임라인은 Gemini AI가 RSS 뉴스 + 학습 데이터를 바탕으로 생성했습니다. 투자 판단의 참고자료로만 활용하세요."}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 초기 빈 상태 */}
      {!data && !loading && !error && (
        <div className="text-center py-20 text-muted-foreground/30">
          <Clock className="w-14 h-14 mx-auto mb-4 opacity-20" />
          <p className="text-sm font-medium text-muted-foreground/50">
            {isEn ? "Enter a keyword to build an issue timeline" : "키워드를 입력하면 이슈 타임라인을 생성합니다"}
          </p>
          <p className="text-xs mt-1">
            {isEn ? "e.g. Iran crisis, Fed rate hike, semiconductor war..." : "예: 이란, 미중갈등, 연준 금리인상, 반도체..."}
          </p>
        </div>
      )}
    </div>
  );
}
