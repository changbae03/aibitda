import { useEffect, useState, useCallback } from "react";
import { RefreshCw, ExternalLink, Zap, Newspaper, ChevronDown } from "lucide-react";
import { formatDistanceToNow, parseISO, format, isToday, isYesterday } from "date-fns";
import { ko } from "date-fns/locale";
import { cn, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface MacroNewsItem {
  title: string;
  source: string;
  pubDate: string;
  url: string;
  category: string;
  tags: string[];
}

function relTime(iso: string) {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: ko }); }
  catch { return ""; }
}

function dateLabel(iso: string) {
  try {
    const d = parseISO(iso);
    if (isToday(d)) return "오늘";
    if (isYesterday(d)) return "어제";
    return format(d, "M월 d일 (E)", { locale: ko });
  } catch { return ""; }
}

function timeStr(iso: string) {
  try { return format(parseISO(iso), "HH:mm"); }
  catch { return ""; }
}

function isBreaking(iso: string) {
  return Date.now() - new Date(iso).getTime() < 30 * 60 * 1000;
}

function isVeryNew(iso: string) {
  return Date.now() - new Date(iso).getTime() < 10 * 60 * 1000;
}

/* ── 뉴스 카드 ──────────────────────────────────────────────────────────── */
function NewsCard({ item }: { item: MacroNewsItem }) {
  const breaking = isBreaking(item.pubDate);
  const veryNew  = isVeryNew(item.pubDate);

  return (
    <motion.a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex gap-4 px-3 py-3.5 rounded-xl hover:bg-muted/25 transition-colors duration-150"
    >
      {/* 시간 컬럼 */}
      <div className="w-12 shrink-0 flex flex-col items-end gap-1.5 pt-0.5">
        <span className={cn(
          "text-[13px] tabular-nums font-semibold leading-none",
          veryNew ? "text-primary" : "text-muted-foreground/60",
        )}>
          {timeStr(item.pubDate)}
        </span>
        {breaking && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded leading-none">
            <Zap className="w-2.5 h-2.5" />속보
          </span>
        )}
      </div>

      {/* 구분선 */}
      <div className="relative shrink-0 flex flex-col items-center">
        <div className={cn(
          "w-2 h-2 rounded-full mt-1 shrink-0 ring-2 ring-background",
          breaking ? "bg-primary" : veryNew ? "bg-primary/50" : "bg-border",
        )} />
        <div className="w-px flex-1 bg-border/40 mt-1" />
      </div>

      {/* 본문 */}
      <div className="flex-1 min-w-0 pb-1">
        <p className={cn(
          "text-[14px] leading-snug break-keep mb-2",
          "text-foreground/90 group-hover:text-foreground transition-colors",
          veryNew && "font-semibold",
        )}>
          {item.title}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground/70">{item.source}</span>
          <span className="text-muted-foreground/30 text-[10px]">·</span>
          <span className="text-[11px] text-muted-foreground/50">{relTime(item.pubDate)}</span>
          <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 ml-auto shrink-0 transition-colors" />
        </div>
      </div>
    </motion.a>
  );
}

/* ── 속보 LIVE 배너 ─────────────────────────────────────────────────────── */
function BreakingBanner({ items }: { items: MacroNewsItem[] }) {
  const [idx, setIdx] = useState(0);
  const latest = items[idx];

  useEffect(() => {
    if (items.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length]);

  if (!latest) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/20 mb-5">
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
        </span>
        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">속보</span>
      </div>
      <div className="flex-1 min-w-0">
        <AnimatePresence mode="wait">
          <motion.a
            key={idx}
            href={latest.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="block text-[13px] font-medium text-foreground/90 hover:text-foreground truncate transition-colors"
          >
            {latest.title}
          </motion.a>
        </AnimatePresence>
      </div>
      <span className="text-[11px] text-muted-foreground/60 shrink-0 tabular-nums font-medium">
        {timeStr(latest.pubDate)}
      </span>
      {items.length > 1 && (
        <span className="text-[10px] text-muted-foreground/40 shrink-0">
          {idx + 1}/{items.length}
        </span>
      )}
    </div>
  );
}

/* ── 스켈레톤 ───────────────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="flex gap-4 px-3 py-3.5">
      <div className="w-12 shrink-0 flex flex-col items-end gap-2 pt-1">
        <div className="h-3.5 w-10 rounded bg-muted/50 animate-pulse" />
      </div>
      <div className="relative shrink-0 flex flex-col items-center">
        <div className="w-2 h-2 rounded-full bg-muted/50 animate-pulse mt-1" />
        <div className="w-px flex-1 bg-border/30 mt-1" />
      </div>
      <div className="flex-1 space-y-2 pb-1">
        <div className="h-4 w-full rounded bg-muted/50 animate-pulse" />
        <div className="h-4 w-3/4 rounded bg-muted/40 animate-pulse" />
        <div className="h-3 w-1/3 rounded bg-muted/30 animate-pulse mt-1" />
      </div>
    </div>
  );
}

/* ── 메인 페이지 ────────────────────────────────────────────────────────── */
export default function NewsPage() {
  const [items, setItems]       = useState<MacroNewsItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const PAGE = 40;

  const load = useCallback((force = false) => {
    setLoading(true);
    setExpanded(false);
    fetch(getApiUrl(`/api/macro/news${force ? "?force=true" : ""}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.items) { setItems(d.items); setCachedAt(d.cachedAt); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const breakingItems = items.filter(i => isBreaking(i.pubDate));
  const visible = expanded ? items : items.slice(0, PAGE);

  type Group = { label: string; items: MacroNewsItem[] };
  const grouped: Group[] = [];
  for (const item of visible) {
    const lbl = dateLabel(item.pubDate);
    const last = grouped[grouped.length - 1];
    if (last?.label === lbl) last.items.push(item);
    else grouped.push({ label: lbl, items: [item] });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-16">

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-primary/10">
              <Newspaper className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground leading-none">경제 뉴스피드</h1>
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                한국경제 · 매일경제 · 연합뉴스 · 뉴시스 · 서울경제 등
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {cachedAt && !loading && (
              <span className="text-[11px] text-muted-foreground/50 tabular-nums">
                {format(parseISO(cachedAt), "HH:mm")} 기준
              </span>
            )}
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground/50 hover:text-foreground disabled:opacity-30"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* 속보 배너 */}
        <AnimatePresence>
          {breakingItems.length > 0 && !loading && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <BreakingBanner items={breakingItems} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* 뉴스 목록 */}
        {loading && items.length === 0 ? (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground/40">
            <Newspaper className="w-8 h-8" />
            <p className="text-sm">뉴스를 불러오지 못했습니다</p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(group => (
              <div key={group.label}>
                {/* 날짜 헤더 */}
                <div className="flex items-center gap-3 mb-1 px-3">
                  <span className="text-[12px] font-bold text-muted-foreground/70 tracking-wide">
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-[11px] text-muted-foreground/40">{group.items.length}건</span>
                </div>
                {/* 아이템 목록 */}
                <div>
                  {group.items.map((item, i) => (
                    <NewsCard key={`${item.url}-${i}`} item={item} />
                  ))}
                </div>
              </div>
            ))}

            {items.length > PAGE && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="w-full py-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                {expanded ? (
                  <><ChevronDown className="w-3.5 h-3.5 rotate-180" />접기</>
                ) : (
                  <><ChevronDown className="w-3.5 h-3.5" />{items.length - PAGE}건 더보기</>
                )}
              </button>
            )}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/30 text-center mt-8 leading-relaxed">
          본 뉴스피드는 각 언론사 RSS를 통해 제공되며, 투자 권유가 아닙니다.
        </p>
      </div>
    </div>
  );
}
