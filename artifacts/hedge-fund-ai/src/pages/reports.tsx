import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  BookOpen,
  ExternalLink,
  Rss,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface SubstackItem {
  title: string;
  link: string;
  pubDate: string;
  summary: string;
  image: string | null;
  creator: string;
  tag: string | null;
}

interface SubstackFeed {
  title: string;
  description: string;
  link: string;
  items: SubstackItem[];
}

function useSubstackFeed() {
  return useQuery<SubstackFeed>({
    queryKey: ["substack-feed"],
    queryFn: async () => {
      const res = await fetch("/api/feed/substack");
      if (!res.ok) throw new Error("RSS 피드를 불러오지 못했습니다");
      return res.json();
    },
    staleTime: 1000 * 60 * 15,
  });
}

function formatPubDate(dateStr: string): string {
  try {
    return format(new Date(dateStr), "yyyy.MM.dd", { locale: ko });
  } catch {
    return dateStr?.slice(0, 10) ?? "";
  }
}


export default function Reports() {
  const { data: feed, isLoading, error } = useSubstackFeed();
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Build ordered unique tags from items
  const tags = useMemo(() => {
    if (!feed) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of feed.items) {
      if (item.tag && !seen.has(item.tag)) {
        seen.add(item.tag);
        result.push(item.tag);
      }
    }
    return result;
  }, [feed]);

  const filtered = useMemo(() => {
    if (!feed) return [];
    if (!activeTag) return feed.items;
    return feed.items.filter((i) => i.tag === activeTag);
  }, [feed, activeTag]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        {/* Tag tabs */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setActiveTag(null)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              !activeTag
                ? "bg-orange-600 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            전체
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(tag)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                activeTag === tag
                  ? "bg-orange-600 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Substack 구독 */}
        {feed?.link && (
          <a
            href={feed.link}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 text-xs font-medium hover:bg-orange-100 transition-colors"
          >
            <Rss className="w-3.5 h-3.5" />
            Substack 구독
          </a>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-24 gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">글을 불러오는 중...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center justify-center py-24 gap-2 text-red-500">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">피드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</span>
        </div>
      )}

      {/* Feed */}
      {feed && (
        <>
          <p className="text-xs text-muted-foreground">
            {activeTag ? (
              <>
                <span className="font-semibold text-foreground">{activeTag}</span>
                {" "}시리즈 · {filtered.length}개
              </>
            ) : (
              <>최신 <strong className="text-foreground">{filtered.length}개</strong> 글</>
            )}
          </p>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTag ?? "all"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="grid gap-5 md:grid-cols-2"
            >
              {filtered.map((item, i) => (
                <motion.a
                  key={item.link}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="group bg-white border border-border rounded-xl overflow-hidden hover:border-orange-300 hover:shadow-md transition-all duration-200 flex flex-col"
                >
                  {/* Thumbnail */}
                  {item.image ? (
                    <div className="w-full h-44 overflow-hidden bg-slate-100 shrink-0">
                      <img
                        src={item.image}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                        onError={(e) => {
                          const el = e.target as HTMLImageElement;
                          el.parentElement!.style.display = "none";
                        }}
                      />
                    </div>
                  ) : (
                    <div className="w-full h-28 bg-gradient-to-br from-orange-50 to-slate-100 flex items-center justify-center shrink-0">
                      <BookOpen className="w-8 h-8 text-orange-200" />
                    </div>
                  )}

                  {/* Body */}
                  <div className="p-4 flex flex-col gap-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {formatPubDate(item.pubDate)}
                      </span>
                      {item.tag && !activeTag && (
                        <span className="text-xs px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded font-medium border border-orange-100">
                          {item.tag}
                        </span>
                      )}
                    </div>

                    <h3 className="font-semibold text-sm text-foreground leading-snug group-hover:text-orange-700 transition-colors line-clamp-2 flex-1">
                      {item.title}
                    </h3>

                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <span className="text-xs text-muted-foreground">{item.creator}</span>
                      <span className="text-xs text-orange-600 font-medium flex items-center gap-1 group-hover:gap-1.5 transition-all">
                        읽기 <ExternalLink className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </motion.a>
              ))}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
