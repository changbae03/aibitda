import { useEffect, useState, useCallback } from "react";
import { Send, RefreshCw, ExternalLink, Clock, Wifi, WifiOff } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ko } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface NewsItem {
  id: string;
  text: string;
  html: string;
  date: string;
  link: string;
  images: string[];
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function News() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNews = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/news`);
      if (!res.ok) throw new Error("서버 오류");
      const data = await res.json();
      setItems(data.items ?? []);
      setLastFetched(new Date());
    } catch (e: any) {
      setError(e.message ?? "뉴스를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    // 5분마다 자동 갱신
    const interval = setInterval(() => fetchNews(true), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  function formatDate(iso: string) {
    try {
      return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: ko });
    } catch {
      return iso;
    }
  }

  function formatAbsDate(iso: string) {
    try {
      const d = parseISO(iso);
      return d.toLocaleString("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-[#229ED9] flex items-center justify-center">
              <Send className="w-4 h-4 text-white fill-white" />
            </div>
            <h1 className="text-xl font-bold text-foreground">CBST 큐레이션</h1>
          </div>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1">
              {error ? (
                <WifiOff className="w-3 h-3 text-destructive" />
              ) : (
                <Wifi className="w-3 h-3 text-emerald-500" />
              )}
            </span>
            @cbstresearch 텔레그램 채널
            {lastFetched && (
              <span className="text-muted-foreground/60">
                · {formatDate(lastFetched.toISOString())} 업데이트
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => fetchNews(true)}
          disabled={loading || refreshing}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground",
            "disabled:opacity-50"
          )}
        >
          <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
          새로고침
        </button>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border border-border rounded-xl p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-4/5" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <WifiOff className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="font-medium text-foreground mb-1">뉴스를 불러오지 못했습니다</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => fetchNews()}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            다시 시도
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Send className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>아직 뉴스가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-0 divide-y divide-border border border-border rounded-xl overflow-hidden">
          {items.map((item) => (
            <NewsCard key={item.id} item={item} formatDate={formatDate} formatAbsDate={formatAbsDate} />
          ))}
        </div>
      )}

      {/* Footer link */}
      {!loading && !error && items.length > 0 && (
        <div className="mt-4 text-center">
          <a
            href="https://t.me/cbstresearch"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Send className="w-3 h-3" />
            텔레그램에서 더보기
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}

function parseTitle(text: string): { title: string; body: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { title: "", body: "" };
  const title = lines[0];
  const body = lines.slice(1).join("\n").trim();
  return { title, body };
}

function NewsCard({
  item,
  formatDate,
  formatAbsDate,
}: {
  item: NewsItem;
  formatDate: (d: string) => string;
  formatAbsDate: (d: string) => string;
}) {
  const { title, body } = parseTitle(item.text ?? "");

  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block px-5 py-4 hover:bg-muted/40 transition-colors group"
    >
      {/* Time + link icon */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-muted-foreground/70" title={formatAbsDate(item.date)}>
          {formatDate(item.date)}
        </span>
        <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
      </div>

      {/* Title */}
      {title && (
        <p className="text-sm font-semibold text-foreground leading-snug mb-1.5">
          {title}
        </p>
      )}

      {/* Body */}
      {body && (
        <div className="space-y-2 mt-1">
          {body
            .split("\n")
            .filter((l) => l.trim())
            .map((line, i) => {
              const t = line.trim();
              const isSubHeading = t.length <= 40 && !t.startsWith("•") && !t.startsWith("-") && !t.startsWith("*") && !t.match(/^https?:\/\//);
              return isSubHeading ? (
                <p key={i} className="text-xs font-semibold text-foreground/80 mt-3 first:mt-0">
                  {t}
                </p>
              ) : (
                <p key={i} className="text-xs text-muted-foreground leading-relaxed break-words">
                  {t}
                </p>
              );
            })}
        </div>
      )}
    </a>
  );
}
