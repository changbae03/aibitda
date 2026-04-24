import { useState, useEffect, useCallback } from "react";
import { Loader2, Trash2, MessageSquare, Search, RefreshCw, Send, ChevronDown, ChevronUp, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface Inquiry {
  id: number;
  user_id: string | null;
  category: string | null;
  content: string;
  status: "open" | "replied" | "closed";
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
}

const CATEGORIES = ["all", "서비스 문의", "분석 오류", "계정·결제", "기능 제안", "기타"];
const STATUSES = ["all", "open", "replied", "closed"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "open") return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      <Clock className="w-3 h-3" /> 대기중
    </span>
  );
  if (status === "replied") return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
      <CheckCircle2 className="w-3 h-3" /> 답변완료
    </span>
  );
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
      <XCircle className="w-3 h-3" /> 종료
    </span>
  );
}

export default function AdminSupport() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(async (status: string, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (status !== "all") params.set("status", status);
      if (q.trim()) params.set("search", q.trim());
      const r = await fetch(getApiUrl(`api/support/inquiry?${params}`), { credentials: "include" });
      if (r.status === 403) { setForbidden(true); return; }
      const d = await r.json();
      setItems(d.items ?? []);
      setTotal(d.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(selectedStatus, search); }, [load, selectedStatus, search]);

  const handleReply = async (id: number) => {
    const text = replyText[id]?.trim();
    if (!text) return;
    setReplyingId(id);
    try {
      const r = await fetch(getApiUrl(`api/support/inquiry/${id}/reply`), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: text }),
      });
      if (r.ok) {
        setItems(prev => prev.map(i => i.id === id ? { ...i, status: "replied", admin_reply: text, replied_at: new Date().toISOString() } : i));
        setReplyText(prev => ({ ...prev, [id]: "" }));
      }
    } finally {
      setReplyingId(null);
    }
  };

  const handleStatusChange = async (id: number, status: string) => {
    await fetch(getApiUrl(`api/support/inquiry/${id}/status`), {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: status as Inquiry["status"] } : i));
  };

  const handleDelete = async (id: number) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setDeletingId(id); setConfirmDelete(null);
    try {
      await fetch(getApiUrl(`api/support/inquiry/${id}`), { method: "DELETE", credentials: "include" });
      setItems(prev => prev.filter(i => i.id !== id));
      setTotal(prev => Math.max(0, prev - 1));
    } finally { setDeletingId(null); }
  };

  if (forbidden) return (
    <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground text-sm">관리자 전용 페이지입니다.</div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-primary" />
            고객 문의
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            총 <span className="font-semibold text-foreground">{total}건</span>의 문의
          </p>
        </div>
        <button onClick={() => load(selectedStatus, search)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </button>
      </div>

      {/* 필터 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setSelectedStatus(s)}
              className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-all",
                selectedStatus === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/30 text-muted-foreground border-border hover:border-primary/40"
              )}>
              {s === "all" ? "전체" : s === "open" ? "대기중" : s === "replied" ? "답변완료" : "종료"}
            </button>
          ))}
        </div>
        <form className="flex-1 flex gap-2 min-w-0" onSubmit={e => { e.preventDefault(); setSearch(searchInput); }}>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="내용 검색..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/30 border border-border rounded-lg focus:outline-none focus:border-primary/60" />
          </div>
          <button type="submit" className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium">검색</button>
          {search && (
            <button type="button" onClick={() => { setSearch(""); setSearchInput(""); }}
              className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg hover:border-primary/40">초기화</button>
          )}
        </form>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <MessageSquare className="w-10 h-10 opacity-30" />
          <p className="text-sm">문의가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const isOpen = expandedId === item.id;
            return (
              <div key={item.id} className={cn(
                "bg-card border rounded-2xl overflow-hidden transition-colors",
                item.status === "open" ? "border-amber-300/60 dark:border-amber-700/60" : "border-border"
              )}>
                {/* 헤더 */}
                <button className="w-full text-left px-4 py-3.5 flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(isOpen ? null : item.id)}>
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <StatusBadge status={item.status} />
                    {item.category && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted/50 text-muted-foreground border border-border">
                        {item.category}
                      </span>
                    )}
                    <span className="text-sm font-medium truncate">{item.content.slice(0, 60)}{item.content.length > 60 ? "…" : ""}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>

                {/* 펼쳐진 내용 */}
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-border space-y-4">
                    {/* 문의 내용 */}
                    <div className="pt-3">
                      {item.user_id && (
                        <p className="text-[11px] text-muted-foreground font-mono mb-1.5">USER: {item.user_id.slice(0, 20)}…</p>
                      )}
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-lg p-3">
                        {item.content}
                      </p>
                    </div>

                    {/* 기존 답변 */}
                    {item.admin_reply && (
                      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                        <p className="text-[11px] font-semibold text-primary mb-1">관리자 답변 · {item.replied_at ? formatDate(item.replied_at) : ""}</p>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{item.admin_reply}</p>
                      </div>
                    )}

                    {/* 답변 입력 */}
                    <div className="space-y-2">
                      <textarea
                        value={replyText[item.id] ?? ""}
                        onChange={e => setReplyText(prev => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder={item.admin_reply ? "답변을 수정하려면 새 내용을 입력하세요..." : "답변을 입력하세요..."}
                        rows={3}
                        className="w-full text-sm bg-muted/30 border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary/60 resize-none"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex gap-1.5">
                          {["open", "replied", "closed"].map(s => (
                            <button key={s} onClick={() => handleStatusChange(item.id, s)}
                              className={cn("px-2.5 py-1 text-[11px] rounded-lg border transition-all",
                                item.status === s
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "text-muted-foreground border-border hover:border-primary/40"
                              )}>
                              {s === "open" ? "대기중" : s === "replied" ? "답변완료" : "종료"}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          {confirmDelete === item.id ? (
                            <>
                              <button onClick={() => handleDelete(item.id)} className="px-2.5 py-1 text-[11px] bg-destructive text-destructive-foreground rounded-lg">삭제확인</button>
                              <button onClick={() => setConfirmDelete(null)} className="px-2.5 py-1 text-[11px] border border-border rounded-lg text-muted-foreground">취소</button>
                            </>
                          ) : (
                            <button onClick={() => handleDelete(item.id)} disabled={deletingId === item.id}
                              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                              {deletingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          )}
                          <button onClick={() => handleReply(item.id)} disabled={!replyText[item.id]?.trim() || replyingId === item.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-40 transition-opacity">
                            {replyingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            답변 저장
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
