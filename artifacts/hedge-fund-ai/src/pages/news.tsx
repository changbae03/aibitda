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
  return Date.now() - new Date(iso).getTime() < 2 * 60 * 60 * 1000;
}

function isVeryNew(iso: string) {
  return Date.now() - new Date(iso).getTime() < 30 * 60 * 1000;
}

/* ── 종목 태그 뱃지 ─────────────────────────────────────────────────────── */
const STOCK_SET = new Set([
  "삼성전자", "SK하이닉스", "LG에너지솔루션", "현대차", "기아",
  "POSCO", "포스코", "카카오", "네이버", "셀트리온", "삼성바이오로직스",
  "현대모비스", "LG화학", "삼성SDI", "SK이노베이션", "한화", "롯데",
  "크래프톤", "넷마블", "두산에너빌리티", "HD현대", "KT", "SK텔레콤", "LG전자",
]);

function TagBadge({ tag }: { tag: string }) {
  const isStock = STOCK_SET.has(tag);
  return (
    <span className={cn(
      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
      isStock
        ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
        : "bg-muted/60 text-muted-foreground/70 border border-border/60",
    )}>
      {tag}
    </span>
  );
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
      className={cn(
        "group flex items-start gap-3 px-4 py-3.5 rounded-xl border transition-all duration-150",
        "hover:bg-muted/30 hover:border-border",
        veryNew
          ? "bg-primary/[0.03] border-primary/20"
          : "bg-transparent border-border/40",
      )}
    >
      <div className="mt-[5px] shrink-0">
        <div className={cn(
          "w-1.5 h-1.5 rounded-full",
          breaking ? "bg-primary" : "bg-muted-foreground/25",
        )} />
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] tabular-nums text-muted-foreground/50 shrink-0">
            {timeStr(item.pubDate)}
          </span>
          {breaking && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
              <Zap className="w-2.5 h-2.5" />속보
            </span>
          )}
        </div>

        <p className={cn(
          "text-[13px] leading-snug break-keep",
          "text-foreground/85 group-hover:text-foreground transition-colors",
          veryNew && "font-medium",
        )}>
          {item.title}
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground/45 shrink-0">{item.source}</span>
          <span className="text-[10px] text-muted-foreground/30">·</span>
          <span className="text-[10px] text-muted-foreground/45">{relTime(item.pubDate)}</span>
          {(item.tags?.length ?? 0) > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground/30">·</span>
              <div className="flex items-center gap-1 flex-wrap">
                {item.tags.slice(0, 4).map(t => <TagBadge key={t} tag={t} />)}
              </div>
            </>
          )}
          <ExternalLink className="w-3 h-3 text-muted-foreground/25 group-hover:text-muted-foreground/50 ml-auto shrink-0 transition-colors" />
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
            className="block text-[12px] font-medium text-foreground/90 hover:text-foreground truncate transition-colors"
          >
            {latest.title}
          </motion.a>
        </AnimatePresence>
      </div>
      <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">
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
                한국경제 · 매일경제 · 연합뉴스 · 이데일리 · 조선비즈 등
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {cachedAt && !loading && (
              <span className="text-[10px] text-muted-foreground/40 tabular-nums">
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
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/30 p-4 space-y-2">
                <div className="h-2.5 w-16 rounded bg-muted/50 animate-pulse" />
                <div className="h-4 w-4/5 rounded bg-muted/50 animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-muted/40 animate-pulse" />
              </div>
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground/40">
            <Newspaper className="w-8 h-8" />
            <p className="text-sm">뉴스를 불러오지 못했습니다</p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(group => (
              <div key={group.label}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-semibold text-muted-foreground/50">{group.label}</span>
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-[10px] text-muted-foreground/35">{group.items.length}건</span>
                </div>
                <div className="space-y-1">
                  {group.items.map((item, i) => (
                    <NewsCard key={`${item.url}-${i}`} item={item} />
                  ))}
                </div>
              </div>
            ))}

            {items.length > PAGE && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="w-full py-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
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
