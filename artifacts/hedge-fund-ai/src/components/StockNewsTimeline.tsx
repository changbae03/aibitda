import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Newspaper, RefreshCw, Sparkles, ChevronDown, ExternalLink } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface StockNewsEvent {
  date: string;
  dateLabel: string;
  event: string;
  detail: string;
  importance: "high" | "medium" | "low";
  category: string;
  source?: string;
  url?: string;
}

export default function StockNewsTimeline({
  ticker,
  companyName,
  isEn = false,
}: {
  ticker: string;
  companyName: string;
  isEn?: boolean;
}) {
  const [events, setEvents] = useState<StockNewsEvent[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [forceCount, setForceCount] = useState(0);
  const keyword = isEn ? (ticker || companyName) : companyName;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const isForce = forceCount > 0;
    const url = getApiUrl(`/api/news/timeline?keyword=${encodeURIComponent(keyword)}&ticker=${encodeURIComponent(ticker)}${isForce ? "&force=true" : ""}`);
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { summary?: string; timeline?: StockNewsEvent[]; generatedAt?: number }) => {
        if (cancelled) return;
        setSummary(d.summary ?? "");
        setEvents(d.timeline ?? []);
        setGeneratedAt(d.generatedAt ?? null);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e?.message ?? "뉴스 타임라인 생성 실패");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [keyword, forceCount]);

  const importanceDot: Record<string, string> = {
    high:   "bg-rose-500",
    medium: "bg-amber-400",
    low:    "bg-muted-foreground/30",
  };

  const generatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="bg-card rounded-2xl p-5 sm:p-6" style={{ boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)" }}>
      <div className="flex items-center gap-2 mb-5">
        <Newspaper className="w-4 h-4 text-muted-foreground/50" />
        <h2 className="text-sm font-semibold text-foreground">
          {isEn ? "News Timeline" : "주요 뉴스 타임라인"}
        </h2>
        <span className="text-[11px] text-muted-foreground/40">
          {isEn ? "oldest → latest" : "과거 → 최신"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!loading && generatedLabel && (
            <span className="text-[10.5px] text-muted-foreground/30 font-mono">{generatedLabel}</span>
          )}
          {!loading && events.length > 0 && (
            <span className="text-[11px] font-mono text-muted-foreground/35">{events.length}</span>
          )}
          <button
            onClick={() => { setExpandedIdx(null); setForceCount(c => c + 1); }}
            disabled={loading}
            title={isEn ? "Refresh to latest news" : "최신 뉴스로 새로고침"}
            className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/50 transition-colors disabled:opacity-30"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {!loading && summary && (
        <p className="text-[13px] text-muted-foreground leading-relaxed mb-5 pb-5 border-b border-border/50">
          {summary}
        </p>
      )}

      {loading && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground/60 animate-pulse">
            <Sparkles className="w-3.5 h-3.5 text-primary/50 shrink-0" />
            {isEn ? `Generating timeline for "${companyName}"…` : `"${companyName}" 타임라인 생성 중…`}
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4 animate-pulse">
              <div className="shrink-0 w-16 h-2.5 bg-muted rounded mt-1.5" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-muted rounded w-2/3" />
                <div className="h-2.5 bg-muted/60 rounded w-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <p className="text-sm text-muted-foreground/50 py-4 text-center">{error}</p>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="relative">
          <div className="absolute left-[3px] top-1 bottom-4 w-px bg-border/50" />
          <div>
            {events.map((ev, idx) => {
              const dot = importanceDot[ev.importance] ?? importanceDot.low;
              const isExpanded = expandedIdx === idx;
              const isLast = idx === events.length - 1;
              return (
                <motion.div
                  key={`${ev.date}-${idx}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03, duration: 0.2 }}
                  className={cn("flex gap-4", !isLast && "mb-0")}
                >
                  <div className="shrink-0 flex flex-col items-center pt-[5px]">
                    <div className={cn("w-1.5 h-1.5 rounded-full z-10 relative", dot)} />
                  </div>
                  <div className={cn("flex-1 min-w-0", !isLast && "pb-5")}>
                    <button
                      className="w-full text-left group"
                      onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    >
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 text-[11px] font-mono text-muted-foreground/50 tabular-nums pt-px w-16">
                          {ev.dateLabel || ev.date}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn(
                              "text-[13px] font-medium leading-snug group-hover:text-primary transition-colors",
                              ev.importance === "high" ? "text-foreground" : "text-foreground/80"
                            )}>
                              {ev.event}
                            </p>
                            <span className="shrink-0 text-[10px] text-muted-foreground/40 font-medium">
                              {ev.category}
                            </span>
                          </div>
                        </div>
                        <ChevronDown className={cn(
                          "w-3 h-3 text-muted-foreground/30 shrink-0 mt-0.5 transition-transform duration-150",
                          isExpanded && "rotate-180"
                        )} />
                      </div>
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="ml-[72px] mt-2 text-[12px] text-muted-foreground leading-relaxed">
                            {ev.detail}
                            {ev.url && (
                              <a
                                href={ev.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-2 inline-flex items-center gap-0.5 text-primary/70 hover:text-primary"
                                onClick={e => e.stopPropagation()}
                              >
                                {isEn ? "more" : "원문"} <ExternalLink className="w-2.5 h-2.5" />
                              </a>
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
      )}

      {!loading && !error && events.length === 0 && (
        <p className="text-sm text-muted-foreground/40 text-center py-6">
          {isEn ? "No timeline available." : "타임라인 데이터 없음"}
        </p>
      )}

      {!loading && events.length > 0 && (
        <p className="mt-5 pt-4 border-t border-border/40 text-[11px] text-muted-foreground/40 flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 shrink-0" />
          {isEn ? "AI-generated · For reference only" : "AI 생성 · 참고용"}
        </p>
      )}
    </div>
  );
}
