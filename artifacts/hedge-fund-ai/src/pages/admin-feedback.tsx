import { useState, useEffect, useCallback } from "react";
import { Loader2, Trash2, MessageSquare, Search, RefreshCw } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface FeedbackItem {
  id: number;
  user_id: string | null;
  category: string | null;
  content: string;
  created_at: string;
}

const CATEGORIES = ["all", "분석 품질", "UI·UX", "기능 오류", "기능 제안", "기타"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryColor(cat: string | null) {
  switch (cat) {
    case "분석 품질": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "UI·UX": return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    case "기능 오류": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "기능 제안": return "bg-green-500/10 text-green-400 border-green-500/20";
    default: return "bg-muted/40 text-muted-foreground border-border";
  }
}

export default function AdminFeedback() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [selectedCat, setSelectedCat] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(async (cat: string, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (cat !== "all") params.set("category", cat);
      if (q.trim()) params.set("search", q.trim());

      const r = await fetch(getApiUrl(`api/feedback?${params}`), { credentials: "include" });
      if (r.status === 403) { setForbidden(true); return; }
      const d = await r.json();
      setItems(d.items ?? []);
      setTotal(d.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(selectedCat, search); }, [load, selectedCat, search]);

  const handleDelete = async (id: number) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setDeletingId(id);
    setConfirmDelete(null);
    try {
      await fetch(getApiUrl(`api/feedback/${id}`), { method: "DELETE", credentials: "include" });
      setItems(prev => prev.filter(i => i.id !== id));
      setTotal(prev => Math.max(0, prev - 1));
    } finally {
      setDeletingId(null);
    }
  };

  if (forbidden) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground text-sm">
        관리자 전용 페이지입니다.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-primary" />
            유저 피드백
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            총 <span className="font-semibold text-foreground">{total}건</span>의 피드백
          </p>
        </div>
        <button
          onClick={() => load(selectedCat, search)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          새로고침
        </button>
      </div>

      {/* 필터 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCat(cat)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                selectedCat === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/30 text-muted-foreground border-border hover:border-primary/40"
              )}
            >
              {cat === "all" ? "전체" : cat}
            </button>
          ))}
        </div>
        <form
          className="flex-1 flex gap-2 min-w-0"
          onSubmit={e => { e.preventDefault(); setSearch(searchInput); }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="내용 검색..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/30 border border-border rounded-lg focus:outline-none focus:border-primary/60"
            />
          </div>
          <button type="submit" className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium">
            검색
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(""); setSearchInput(""); }}
              className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg hover:border-primary/40"
            >
              초기화
            </button>
          )}
        </form>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <MessageSquare className="w-10 h-10 opacity-30" />
          <p className="text-sm">피드백이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div
              key={item.id}
              className="bg-card border border-border rounded-2xl p-4 space-y-2.5 hover:border-border/80 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[11px] font-medium border",
                    categoryColor(item.category)
                  )}>
                    {item.category ?? "기타"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(item.created_at)}
                  </span>
                  {item.user_id && (
                    <span className="text-[11px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                      {item.user_id.slice(0, 16)}…
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {confirmDelete === item.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="px-2 py-1 text-[11px] bg-destructive text-destructive-foreground rounded-md"
                      >
                        삭제확인
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-1 text-[11px] text-muted-foreground border border-border rounded-md"
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={deletingId === item.id}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    >
                      {deletingId === item.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />
                      }
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {item.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
