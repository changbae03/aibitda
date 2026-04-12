import { useEffect, useState, useCallback, useRef } from "react";
import { Send, RefreshCw, ExternalLink, WifiOff, Zap, Pin, X } from "lucide-react";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import { ko } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

interface NewsItem {
  id: string;
  text: string;
  html: string;
  date: string;
  link: string;
  images: string[];
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function formatRelativeDate(iso: string) {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: ko });
  } catch {
    return iso;
  }
}

function formatAbsDate(iso: string) {
  try {
    return format(parseISO(iso), "yyyy년 M월 d일 HH:mm", { locale: ko });
  } catch {
    return iso;
  }
}

function parseTitle(text: string): { title: string; body: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { title: "", body: "" };
  return { title: lines[0], body: lines.slice(1).join("\n").trim() };
}

// ── Detail Panel ────────────────────────────────
function DetailPanel({
  item,
  onClose,
}: {
  item: NewsItem | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const { title, body } = item ? parseTitle(item.text ?? "") : { title: "", body: "" };

  return (
    <AnimatePresence>
      {item && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />

          {/* Slide panel */}
          <motion.div
            key="panel"
            ref={panelRef}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <span className="text-xs text-muted-foreground">
                {formatAbsDate(item.date)}
              </span>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Image */}
              {item.images[0] && (
                <div className="rounded-xl overflow-hidden bg-slate-100">
                  <img
                    src={item.images[0]}
                    alt=""
                    className="w-full object-cover max-h-56"
                    onError={(e) => {
                      (e.target as HTMLImageElement).parentElement!.style.display = "none";
                    }}
                  />
                </div>
              )}

              {/* Title */}
              {title && (
                <h2 className="text-lg font-bold text-foreground leading-snug">
                  {title}
                </h2>
              )}

              {/* Body */}
              {body && (
                <div className="space-y-2">
                  {body
                    .split("\n")
                    .filter((l) => l.trim())
                    .map((line, i) => {
                      const t = line.trim();
                      const isHeading =
                        t.length <= 50 &&
                        !t.startsWith("•") &&
                        !t.startsWith("-") &&
                        !t.startsWith("*") &&
                        !t.match(/^https?:\/\//);
                      return isHeading && i > 0 ? (
                        <p key={i} className="text-sm font-semibold text-foreground/90 pt-2">
                          {t}
                        </p>
                      ) : (
                        <p key={i} className="text-sm text-muted-foreground leading-relaxed break-words">
                          {t}
                        </p>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Panel footer */}
            <div className="shrink-0 px-6 py-4 border-t border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {formatRelativeDate(item.date)}
              </span>
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-medium transition-colors"
              >
                <Send className="w-3 h-3" />
                원문 보기
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── 실시간 뉴스 카드 (compact) ──────────────────
function RadarCard({
  item,
  onClick,
}: {
  item: NewsItem;
  onClick: () => void;
}) {
  const { title, body } = parseTitle(item.text ?? "");
  return (
    <button
      onClick={onClick}
      className="w-full text-left group flex flex-col gap-1 px-4 py-3 hover:bg-sky-50/60 transition-colors border-b border-border last:border-0"
    >
      <span className="text-[11px] text-muted-foreground/60">
        {formatRelativeDate(item.date)}
      </span>
      {title && (
        <p className="text-[13px] font-medium text-foreground leading-snug line-clamp-2 group-hover:text-sky-700 transition-colors">
          {title}
        </p>
      )}
      {body && (
        <p className="text-[12px] text-muted-foreground line-clamp-2 leading-relaxed">
          {body}
        </p>
      )}
    </button>
  );
}

// ── 큐레이션 카드 (rich) ────────────────────────
function CurationCard({
  item,
  onClick,
}: {
  item: NewsItem;
  onClick: () => void;
}) {
  const { title, body } = parseTitle(item.text ?? "");
  const hasImage = item.images.length > 0;
  return (
    <button
      onClick={onClick}
      className="w-full text-left group bg-white border border-border rounded-xl overflow-hidden hover:border-violet-300 hover:shadow-md transition-all duration-200"
    >
      {hasImage && (
        <div className="w-full h-40 bg-slate-100 overflow-hidden">
          <img
            src={item.images[0]}
            alt=""
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            onError={(e) => {
              (e.target as HTMLImageElement).parentElement!.style.display = "none";
            }}
          />
        </div>
      )}
      <div className="p-4 space-y-2">
        <span className="text-[11px] text-muted-foreground/60">
          {formatRelativeDate(item.date)}
        </span>
        {title && (
          <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-violet-700 transition-colors">
            {title}
          </p>
        )}
        {body && (
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {body}
          </p>
        )}
        <div className="flex items-center justify-end pt-1 border-t border-border">
          <span className="text-[11px] text-violet-500 font-medium flex items-center gap-0.5 group-hover:gap-1 transition-all">
            보기 <ExternalLink className="w-3 h-3" />
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Column wrapper ──────────────────────────────
function NewsColumn({
  title,
  icon,
  accentClass,
  telegramUrl,
  items,
  loading,
  error,
  onRefresh,
  refreshing,
  cardRenderer,
  emptyMessage,
  compact,
}: {
  title: string;
  icon: React.ReactNode;
  accentClass: string;
  telegramUrl: string;
  items: NewsItem[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  refreshing: boolean;
  cardRenderer: (item: NewsItem) => React.ReactNode;
  emptyMessage: string;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className={cn("text-base font-bold flex items-center gap-1.5", accentClass)}>
          {icon}
          {title}
        </h2>
        <button
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          title="새로고침"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
        </button>
      </div>

      <div className={cn(
        "flex-1 rounded-xl border border-border overflow-y-auto bg-white",
        compact ? "divide-y divide-border" : "flex flex-col gap-3 p-3 bg-transparent border-0"
      )}>
        {loading ? (
          <div className={cn("space-y-px", !compact && "space-y-3")}>
            {Array.from({ length: compact ? 8 : 4 }).map((_, i) => (
              <div key={i} className={cn(
                "animate-pulse bg-muted/40",
                compact ? "h-16 border-b border-border last:border-0 px-4 py-3" : "h-40 rounded-xl"
              )} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <WifiOff className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">{error}</p>
            <button
              onClick={onRefresh}
              className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              다시 시도
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50 text-sm">
            <Send className="w-8 h-8 mb-2 opacity-30" />
            {emptyMessage}
          </div>
        ) : (
          items.map((item) => <div key={item.id}>{cardRenderer(item)}</div>)
        )}
      </div>

      {!loading && !error && items.length > 0 && (
        <a
          href={telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 text-center text-[11px] text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 transition-colors"
        >
          <Send className="w-3 h-3" />
          텔레그램에서 더보기
        </a>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────
export default function News() {
  const [selectedItem, setSelectedItem] = useState<NewsItem | null>(null);

  const [radarItems, setRadarItems] = useState<NewsItem[]>([]);
  const [radarLoading, setRadarLoading] = useState(true);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [radarRefreshing, setRadarRefreshing] = useState(false);

  const [researchItems, setResearchItems] = useState<NewsItem[]>([]);
  const [researchLoading, setResearchLoading] = useState(true);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchRefreshing, setResearchRefreshing] = useState(false);

  const fetchRadar = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRadarRefreshing(true);
    else setRadarLoading(true);
    setRadarError(null);
    try {
      const res = await fetch(`${API_BASE}/api/news/radar`);
      if (!res.ok) throw new Error("서버 오류");
      const data = await res.json();
      setRadarItems(data.items ?? []);
    } catch (e: any) {
      setRadarError(e.message ?? "불러오지 못했습니다.");
    } finally {
      setRadarLoading(false);
      setRadarRefreshing(false);
    }
  }, []);

  const fetchResearch = useCallback(async (isRefresh = false) => {
    if (isRefresh) setResearchRefreshing(true);
    else setResearchLoading(true);
    setResearchError(null);
    try {
      const res = await fetch(`${API_BASE}/api/news`);
      if (!res.ok) throw new Error("서버 오류");
      const data = await res.json();
      setResearchItems(data.items ?? []);
    } catch (e: any) {
      setResearchError(e.message ?? "불러오지 못했습니다.");
    } finally {
      setResearchLoading(false);
      setResearchRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRadar();
    fetchResearch();
    const interval = setInterval(() => {
      fetchRadar(true);
      fetchResearch(true);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchRadar, fetchResearch]);

  return (
    <>
      <div className="h-[calc(100vh-8rem)] flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-5 flex-1 min-h-0">
          {/* Left — 실시간 뉴스 */}
          <NewsColumn
            title="실시간 뉴스"
            icon={<Zap className="w-4 h-4 text-sky-500 fill-sky-200" />}
            accentClass="text-sky-700"
            telegramUrl="https://t.me/cbstradar"
            items={radarItems}
            loading={radarLoading}
            error={radarError}
            onRefresh={() => fetchRadar(true)}
            refreshing={radarRefreshing}
            cardRenderer={(item) => (
              <RadarCard item={item} onClick={() => setSelectedItem(item)} />
            )}
            emptyMessage="아직 뉴스가 없습니다"
            compact
          />

          {/* Right — CBST 큐레이션 */}
          <NewsColumn
            title="CBST 큐레이션"
            icon={<Pin className="w-4 h-4 text-violet-500 fill-violet-200" />}
            accentClass="text-violet-700"
            telegramUrl="https://t.me/cbstresearch"
            items={researchItems}
            loading={researchLoading}
            error={researchError}
            onRefresh={() => fetchResearch(true)}
            refreshing={researchRefreshing}
            cardRenderer={(item) => (
              <CurationCard item={item} onClick={() => setSelectedItem(item)} />
            )}
            emptyMessage="아직 큐레이션 글이 없습니다"
          />
        </div>
      </div>

      {/* Detail slide panel */}
      <DetailPanel item={selectedItem} onClose={() => setSelectedItem(null)} />
    </>
  );
}
