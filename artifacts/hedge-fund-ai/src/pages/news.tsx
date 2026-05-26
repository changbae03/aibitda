import { useEffect, useState, useCallback, useRef } from "react";
import {
  RefreshCw, ExternalLink, Zap, Newspaper, ChevronDown,
  Bookmark, BookmarkCheck, BookmarkX, ChevronRight, Tag,
  LayoutList, Clock, Search, X,
} from "lucide-react";
import { formatDistanceToNow, parseISO, format, isToday, isYesterday } from "date-fns";
import { ko } from "date-fns/locale";
import { cn, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";

/* ── 타입 ───────────────────────────────────────────────────────────────── */

interface MacroNewsItem {
  title: string;
  source: string;
  pubDate: string;
  url: string;
  category: string;
  tags: string[];
}

interface ScrapItem {
  id: number;
  title: string;
  source: string;
  url: string;
  pub_date: string | null;
  category: string;
  tags: string[];
  topic: string;
  note: string;
  scrapped_at: string;
}

interface TopicGroup {
  topic: string;
  count: number;
  latestAt: string | null;
  items: ScrapItem[];
}

/* ── 유틸 ───────────────────────────────────────────────────────────────── */

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

const BREAKING_KEYWORDS = [
  "속보", "긴급", "긴급속보", "[속보]", "[긴급]", "★속보",
  "폭등", "폭락", "급등", "급락", "급반등", "급반락", "서킷브레이커", "사이드카",
  "파산", "부도", "디폴트", "채무불이행", "뱅크런", "금융위기",
  "금리 인상", "금리 인하", "기준금리 인상", "기준금리 인하",
  "금리인상", "금리인하", "기준금리인상", "기준금리인하",
  "FOMC 결정", "금통위 결정", "피벗",
  "쇼크", "경제충격", "오일쇼크", "관세 폭탄", "전쟁 선포", "계엄",
  "긴급 회견", "긴급회의", "긴급 성명", "전격",
];
const BREAKING_RE = new RegExp(BREAKING_KEYWORDS.join("|"));
function isBreaking(title: string) { return BREAKING_RE.test(title); }
function isVeryNew(iso: string) { return Date.now() - new Date(iso).getTime() < 30 * 60 * 1000; }

/* ── 주제 색상 맵 ───────────────────────────────────────────────────────── */

const TOPIC_COLORS: Record<string, string> = {
  "금리·통화정책":  "text-blue-500   bg-blue-500/10   border-blue-500/20",
  "반도체·AI":      "text-violet-500 bg-violet-500/10 border-violet-500/20",
  "무역·관세":      "text-orange-500 bg-orange-500/10 border-orange-500/20",
  "부동산":         "text-amber-500  bg-amber-500/10  border-amber-500/20",
  "기업실적":       "text-green-500  bg-green-500/10  border-green-500/20",
  "에너지·원자재":  "text-yellow-600 bg-yellow-500/10 border-yellow-500/20",
  "2차전지·EV":     "text-teal-500   bg-teal-500/10   border-teal-500/20",
  "바이오·헬스케어":"text-pink-500   bg-pink-500/10   border-pink-500/20",
  "글로벌 거시":    "text-sky-500    bg-sky-500/10    border-sky-500/20",
  "증시·ETF":       "text-indigo-500 bg-indigo-500/10 border-indigo-500/20",
  "기타":           "text-muted-foreground bg-muted/40 border-border",
};

function topicColor(topic: string) {
  return TOPIC_COLORS[topic] ?? TOPIC_COLORS["기타"];
}

/* ── 뉴스 카드 ──────────────────────────────────────────────────────────── */

function NewsCard({
  item,
  scrapped,
  scrapId,
  onScrap,
  onUnscrap,
  loggedIn,
}: {
  item: MacroNewsItem;
  scrapped: boolean;
  scrapId: number | null;
  onScrap: (item: MacroNewsItem) => void;
  onUnscrap: (url: string, id: number) => void;
  loggedIn: boolean;
}) {
  const breaking = isBreaking(item.title);
  const veryNew  = isVeryNew(item.pubDate);
  const [pending, setPending] = useState(false);

  async function toggleScrap(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!loggedIn || pending) return;
    setPending(true);
    try {
      if (scrapped && scrapId != null) {
        onUnscrap(item.url, scrapId);
      } else {
        onScrap(item);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <motion.div
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

      {/* 타임라인 구분선 */}
      <div className="relative shrink-0 flex flex-col items-center">
        <div className={cn(
          "w-2 h-2 rounded-full mt-1 shrink-0 ring-2 ring-background",
          breaking ? "bg-primary" : veryNew ? "bg-primary/50" : "bg-border",
        )} />
        <div className="w-px flex-1 bg-border/40 mt-1" />
      </div>

      {/* 본문 */}
      <div className="flex-1 min-w-0 pb-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <p className={cn(
            "text-[14px] leading-snug break-keep mb-2",
            "text-foreground/90 group-hover:text-foreground transition-colors",
            veryNew && "font-semibold",
          )}>
            {item.title}
          </p>
        </a>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground/70">{item.source}</span>
          <span className="text-muted-foreground/30 text-[10px]">·</span>
          <span className="text-[11px] text-muted-foreground/50">{relTime(item.pubDate)}</span>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
          </a>
          {/* 스크랩 버튼 */}
          <button
            onClick={toggleScrap}
            title={
              !loggedIn ? "로그인 후 스크랩 가능" :
              scrapped ? "스크랩 취소" : "스크랩"
            }
            className={cn(
              "shrink-0 p-0.5 rounded transition-all",
              !loggedIn && "opacity-30 cursor-not-allowed",
              loggedIn && scrapped && "text-primary",
              loggedIn && !scrapped && "text-muted-foreground/30 hover:text-primary/70",
              pending && "opacity-50",
            )}
          >
            {scrapped
              ? <BookmarkCheck className="w-3.5 h-3.5" />
              : <Bookmark className="w-3.5 h-3.5" />
            }
          </button>
        </div>
      </div>
    </motion.div>
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

/* ── 스크랩 카드 ────────────────────────────────────────────────────────── */

function ScrapCard({
  item,
  onUnscrap,
}: {
  item: ScrapItem;
  onUnscrap: (id: number) => void;
}) {
  const [pending, setPending] = useState(false);
  const iso = item.pub_date ?? item.scrapped_at;

  async function handleUnscrap(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    try { onUnscrap(item.id); }
    finally { setPending(false); }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 6 }}
      className="group flex gap-3 px-3 py-3 rounded-xl hover:bg-muted/20 transition-colors"
    >
      {/* 타임라인 점 */}
      <div className="relative shrink-0 flex flex-col items-center mt-1">
        <div className="w-1.5 h-1.5 rounded-full bg-border ring-2 ring-background" />
        <div className="w-px flex-1 bg-border/30 mt-1" />
      </div>

      {/* 본문 */}
      <div className="flex-1 min-w-0">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-[13.5px] leading-snug break-keep text-foreground/85 hover:text-foreground transition-colors mb-1.5"
        >
          {item.title}
        </a>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-muted-foreground/60">{item.source}</span>
          {iso && (
            <>
              <span className="text-muted-foreground/30 text-[10px]">·</span>
              <span className="text-[11px] text-muted-foreground/40 tabular-nums">{relTime(iso)}</span>
            </>
          )}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3 text-muted-foreground/25 group-hover:text-muted-foreground/50 transition-colors" />
          </a>
          <button
            onClick={handleUnscrap}
            title="스크랩 취소"
            className={cn(
              "shrink-0 p-0.5 rounded text-muted-foreground/30 hover:text-red-400 transition-colors",
              pending && "opacity-40",
            )}
          >
            <BookmarkX className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ── 주제 그룹 ──────────────────────────────────────────────────────────── */

function TopicGroupCard({
  group,
  onUnscrap,
}: {
  group: TopicGroup;
  onUnscrap: (id: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const colorClass = topicColor(group.topic);

  return (
    <div className="rounded-2xl border border-border/50 overflow-hidden">
      {/* 헤더 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
      >
        <span className={cn(
          "inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-full border",
          colorClass,
        )}>
          <Tag className="w-3 h-3" />
          {group.topic}
        </span>
        <span className="text-[12px] text-muted-foreground/50 font-medium">{group.count}건</span>
        {group.latestAt && (
          <span className="text-[11px] text-muted-foreground/35 ml-auto flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {relTime(group.latestAt)}
          </span>
        )}
        <ChevronRight className={cn(
          "w-3.5 h-3.5 text-muted-foreground/40 transition-transform shrink-0",
          open && "rotate-90",
        )} />
      </button>

      {/* 아이템 목록 */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/40 px-1 py-1">
              <AnimatePresence>
                {group.items.map(item => (
                  <ScrapCard key={item.id} item={item} onUnscrap={onUnscrap} />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── 메인 페이지 ────────────────────────────────────────────────────────── */

type Tab = "feed" | "scraps";

export default function NewsPage() {
  const { data: authData } = useAuth();
  const loggedIn = !!authData?.user;

  /* 피드 상태 */
  const [items, setItems]       = useState<MacroNewsItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const PAGE = 40;

  /* 스크랩 상태 */
  const [scraps, setScraps]         = useState<ScrapItem[]>([]);
  const [scrapsLoading, setScrapsLoading] = useState(false);
  const scrappedUrls = useRef(new Map<string, number>()); // url → id

  /* 탭 */
  const [tab, setTab] = useState<Tab>("feed");

  /* 검색 */
  const [searchQuery, setSearchQuery] = useState("");

  /* ── 피드 로드 ── */
  const loadFeed = useCallback((force = false) => {
    setLoading(true);
    setExpanded(false);
    fetch(getApiUrl(`/api/macro/news${force ? "?force=true" : ""}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.items) { setItems(d.items); setCachedAt(d.cachedAt); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  /* ── 스크랩 로드 ── */
  const loadScraps = useCallback(() => {
    if (!loggedIn) return;
    setScrapsLoading(true);
    fetch(getApiUrl("/api/news/scraps"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.scraps) {
          setScraps(d.scraps);
          scrappedUrls.current = new Map(d.scraps.map((s: ScrapItem) => [s.url, s.id]));
        }
      })
      .catch(() => {})
      .finally(() => setScrapsLoading(false));
  }, [loggedIn]);

  useEffect(() => { if (loggedIn) loadScraps(); }, [loggedIn, loadScraps]);

  /* ── 스크랩 추가 ── */
  const handleScrap = useCallback(async (item: MacroNewsItem) => {
    if (!loggedIn) return;
    const res = await fetch(getApiUrl("/api/news/scraps"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        source: item.source,
        url: item.url,
        pubDate: item.pubDate,
        category: item.category,
        tags: item.tags,
      }),
    });
    if (!res.ok) return;
    const { scrap } = await res.json() as { scrap: ScrapItem };
    setScraps(prev => [scrap, ...prev.filter(s => s.url !== scrap.url)]);
    scrappedUrls.current.set(scrap.url, scrap.id);
  }, [loggedIn]);

  /* ── 스크랩 취소 ── */
  const handleUnscrap = useCallback(async (url: string, id: number) => {
    if (!loggedIn) return;
    const res = await fetch(getApiUrl(`/api/news/scraps/${id}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) return;
    setScraps(prev => prev.filter(s => s.id !== id));
    scrappedUrls.current.delete(url);
  }, [loggedIn]);

  /* ── 타임라인 그룹화 ── */
  const timeline = useCallback((): TopicGroup[] => {
    const grouped: Record<string, ScrapItem[]> = {};
    for (const s of scraps) {
      const t = s.topic ?? "기타";
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(s);
    }
    return Object.entries(grouped)
      .map(([topic, items]) => ({
        topic,
        count: items.length,
        latestAt: items[0]?.scrapped_at ?? null,
        items,
      }))
      .sort((a, b) => new Date(b.latestAt ?? 0).getTime() - new Date(a.latestAt ?? 0).getTime());
  }, [scraps]);

  /* ── 피드 그룹화 ── */
  const q = searchQuery.trim().toLowerCase();
  const feedFiltered = q
    ? items.filter(i => i.title.toLowerCase().includes(q) || i.source.toLowerCase().includes(q))
    : items;
  const scrapsFiltered = q
    ? scraps.filter(i => i.title.toLowerCase().includes(q) || i.source.toLowerCase().includes(q))
    : scraps;
  const breakingItems = feedFiltered.filter(i => isBreaking(i.title));
  const visible = q ? feedFiltered : (expanded ? feedFiltered : feedFiltered.slice(0, PAGE));
  type Group = { label: string; items: MacroNewsItem[] };
  const grouped: Group[] = [];
  for (const item of visible) {
    const lbl = dateLabel(item.pubDate);
    const last = grouped[grouped.length - 1];
    if (last?.label === lbl) last.items.push(item);
    else grouped.push({ label: lbl, items: [item] });
  }

  /* ── 렌더 ── */

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-16">

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
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
            {tab === "feed" && cachedAt && !loading && (
              <span className="text-[11px] text-muted-foreground/50 tabular-nums">
                {format(parseISO(cachedAt), "HH:mm")} 기준
              </span>
            )}
            {tab === "feed" && (
              <button
                onClick={() => loadFeed(true)}
                disabled={loading}
                className="p-2 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground/50 hover:text-foreground disabled:opacity-30"
              >
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              </button>
            )}
          </div>
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-1 mb-3 p-1 rounded-xl bg-muted/30 border border-border/40">
          <button
            onClick={() => { setTab("feed"); setSearchQuery(""); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium transition-all",
              tab === "feed"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            <LayoutList className="w-3.5 h-3.5" />
            피드
          </button>
          <button
            onClick={() => { setTab("scraps"); setSearchQuery(""); if (loggedIn && scraps.length === 0 && !scrapsLoading) loadScraps(); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium transition-all",
              tab === "scraps"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            <Bookmark className="w-3.5 h-3.5" />
            스크랩
            {scraps.length > 0 && (
              <span className="text-[10px] font-bold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full leading-none">
                {scraps.length}
              </span>
            )}
          </button>
        </div>

        {/* 검색창 */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="키워드로 뉴스 검색..."
            className={cn(
              "w-full pl-9 pr-9 py-2.5 rounded-xl text-[13px]",
              "bg-muted/30 border border-border/40 text-foreground placeholder:text-muted-foreground/40",
              "focus:outline-none focus:border-primary/40 focus:bg-muted/50 transition-colors",
            )}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ── 피드 탭 ── */}
        <AnimatePresence mode="wait">
          {tab === "feed" && (
            <motion.div
              key="feed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
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

              {/* 로그인 안내 (스크랩 기능 안내) */}
              {!loggedIn && (
                <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-xl bg-muted/30 border border-border/40">
                  <Bookmark className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  <p className="text-[12px] text-muted-foreground/50">
                    로그인하면 뉴스를 스크랩하고 주제별로 정리할 수 있습니다
                  </p>
                </div>
              )}

              {/* 검색 결과 수 표시 */}
              {q && !loading && (
                <div className="flex items-center gap-2 px-1 mb-3">
                  <Search className="w-3 h-3 text-muted-foreground/40" />
                  <span className="text-[12px] text-muted-foreground/60">
                    <span className="font-semibold text-foreground/70">"{searchQuery}"</span> 검색 결과{" "}
                    <span className="font-semibold text-primary">{feedFiltered.length}건</span>
                  </span>
                </div>
              )}

              {/* 뉴스 목록 */}
              {loading && items.length === 0 ? (
                <div className="space-y-0">
                  {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
              ) : grouped.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground/40">
                  <Newspaper className="w-8 h-8" />
                  <p className="text-sm">
                    {q ? `"${searchQuery}"에 해당하는 뉴스가 없습니다` : "뉴스를 불러오지 못했습니다"}
                  </p>
                  {q && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="text-[12px] text-primary/70 hover:text-primary underline underline-offset-2 transition-colors"
                    >
                      검색 초기화
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {grouped.map(group => (
                    <div key={group.label}>
                      <div className="flex items-center gap-3 mb-1 px-3">
                        <span className="text-[12px] font-bold text-muted-foreground/70 tracking-wide">
                          {group.label}
                        </span>
                        <div className="flex-1 h-px bg-border/50" />
                        <span className="text-[11px] text-muted-foreground/40">{group.items.length}건</span>
                      </div>
                      <div>
                        {group.items.map((item, i) => (
                          <NewsCard
                            key={`${item.url}-${i}`}
                            item={item}
                            scrapped={scrappedUrls.current.has(item.url)}
                            scrapId={scrappedUrls.current.get(item.url) ?? null}
                            onScrap={handleScrap}
                            onUnscrap={handleUnscrap}
                            loggedIn={loggedIn}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  {!q && items.length > PAGE && (
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
            </motion.div>
          )}

          {/* ── 스크랩 탭 ── */}
          {tab === "scraps" && (
            <motion.div
              key="scraps"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {!loggedIn ? (
                <div className="flex flex-col items-center gap-4 py-20 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                    <Bookmark className="w-6 h-6 text-muted-foreground/40" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground/70">로그인이 필요합니다</p>
                    <p className="text-[12px] text-muted-foreground/50 mt-1">
                      스크랩 기능은 로그인 후 이용할 수 있습니다
                    </p>
                  </div>
                </div>
              ) : scrapsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-20 rounded-2xl bg-muted/30 animate-pulse" />
                  ))}
                </div>
              ) : scraps.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-20 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                    <BookmarkCheck className="w-6 h-6 text-muted-foreground/40" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground/70">스크랩한 기사가 없습니다</p>
                    <p className="text-[12px] text-muted-foreground/50 mt-1">
                      피드에서 <Bookmark className="inline w-3 h-3 mx-0.5 relative -top-px" /> 버튼으로 기사를 저장하세요
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* 요약 헤더 */}
                  {/* 검색 결과 수 (스크랩) */}
                  {q && (
                    <div className="flex items-center gap-2 px-1 mb-3">
                      <Search className="w-3 h-3 text-muted-foreground/40" />
                      <span className="text-[12px] text-muted-foreground/60">
                        <span className="font-semibold text-foreground/70">"{searchQuery}"</span> 검색 결과{" "}
                        <span className="font-semibold text-primary">{scrapsFiltered.length}건</span>
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-[12px] text-muted-foreground/60">
                      총 <span className="font-bold text-foreground/70">{q ? scrapsFiltered.length : scraps.length}건</span>
                      {!q && ` · ${timeline().length}개 주제`}
                    </span>
                    <span className="text-[11px] text-muted-foreground/40">주제별 타임라인</span>
                  </div>

                  {q && scrapsFiltered.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground/40">
                      <Search className="w-7 h-7" />
                      <p className="text-sm">"{searchQuery}"에 해당하는 스크랩이 없습니다</p>
                      <button
                        onClick={() => setSearchQuery("")}
                        className="text-[12px] text-primary/70 hover:text-primary underline underline-offset-2 transition-colors"
                      >
                        검색 초기화
                      </button>
                    </div>
                  ) : (
                  <AnimatePresence>
                    {(q
                      ? [{
                          topic: "검색 결과",
                          count: scrapsFiltered.length,
                          latestAt: scrapsFiltered[0]?.scrapped_at ?? null,
                          items: scrapsFiltered,
                        }]
                      : timeline()
                    ).map(group => (
                      <TopicGroupCard
                        key={group.topic}
                        group={group}
                        onUnscrap={(id) => {
                          const scrap = scraps.find(s => s.id === id);
                          if (scrap) handleUnscrap(scrap.url, id);
                        }}
                      />
                    ))}
                  </AnimatePresence>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
