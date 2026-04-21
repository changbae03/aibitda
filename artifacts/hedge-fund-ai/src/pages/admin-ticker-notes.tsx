import { useState, useEffect, useCallback } from "react";
import { Search, Save, Trash2, Plus, RefreshCw, ChevronDown, ChevronUp, Loader2, CheckCircle } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface TickerNote {
  ticker: string;
  memo: string;
  autoLearning: string;
  updatedAt: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminTickerNotes() {
  const [notes, setNotes] = useState<TickerNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [savedOk, setSavedOk] = useState<Record<string, boolean>>({});
  const [newTicker, setNewTicker] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/ticker-notes"), { credentials: "include" });
      if (r.ok) setNotes(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (ticker: string) => {
    setExpanded(prev => ({ ...prev, [ticker]: !prev[ticker] }));
    setEditing(prev => {
      if (!prev[ticker]) {
        const note = notes.find(n => n.ticker === ticker);
        return { ...prev, [ticker]: note?.memo ?? "" };
      }
      return prev;
    });
  };

  const save = async (ticker: string) => {
    setSaving(prev => ({ ...prev, [ticker]: true }));
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(ticker)}`), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: editing[ticker] ?? "" }),
      });
      if (r.ok) {
        setNotes(prev => prev.map(n => n.ticker === ticker ? { ...n, memo: editing[ticker] ?? "", updatedAt: new Date().toISOString() } : n));
        setSavedOk(prev => ({ ...prev, [ticker]: true }));
        setTimeout(() => setSavedOk(prev => ({ ...prev, [ticker]: false })), 2000);
      }
    } finally {
      setSaving(prev => ({ ...prev, [ticker]: false }));
    }
  };

  const addTicker = async () => {
    const t = newTicker.trim().toUpperCase();
    if (!t) return;
    if (notes.find(n => n.ticker === t)) {
      setExpanded(prev => ({ ...prev, [t]: true }));
      setNewTicker("");
      return;
    }
    setAdding(true);
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(t)}`), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: "" }),
      });
      if (r.ok) {
        const newNote: TickerNote = { ticker: t, memo: "", autoLearning: "", updatedAt: new Date().toISOString() };
        setNotes(prev => [newNote, ...prev]);
        setEditing(prev => ({ ...prev, [t]: "" }));
        setExpanded(prev => ({ ...prev, [t]: true }));
        setNewTicker("");
      }
    } finally {
      setAdding(false);
    }
  };

  const filtered = notes.filter(n =>
    !search || n.ticker.includes(search.toUpperCase()) || n.memo.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">종목 보정 메모</h1>
          <p className="text-sm text-muted-foreground mt-0.5">종목별 AI 분석에 반영되는 관리자 보정 메모를 관리합니다</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs hover:bg-muted/80 transition-colors"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          새로고침
        </button>
      </div>

      {/* 신규 추가 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Plus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={newTicker}
            onChange={e => setNewTicker(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addTicker()}
            placeholder="티커 입력 (예: 005930, AAPL)"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 uppercase"
          />
        </div>
        <button
          onClick={addTicker}
          disabled={adding || !newTicker.trim()}
          className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : "추가"}
        </button>
      </div>

      {/* 검색 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="티커 또는 메모 내용으로 검색"
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* 목록 */}
      {loading && notes.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> 불러오는 중…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {search ? "검색 결과가 없습니다" : "등록된 메모가 없습니다"}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(note => {
            const isOpen = !!expanded[note.ticker];
            const memo = editing[note.ticker] ?? note.memo;
            const isDirty = memo !== note.memo;
            return (
              <div key={note.ticker} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* 헤더 행 */}
                <button
                  onClick={() => toggle(note.ticker)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-sm text-foreground">{note.ticker}</span>
                    {note.memo ? (
                      <span className="text-xs text-muted-foreground truncate max-w-[240px]">{note.memo}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50 italic">메모 없음</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-muted-foreground">{formatDate(note.updatedAt)}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>

                {/* 편집 영역 */}
                {isOpen && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border">
                    <div className="pt-3">
                      <label className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                        📝 보정 메모 (AI 분석에 반영됨)
                      </label>
                      <textarea
                        value={memo}
                        onChange={e => setEditing(prev => ({ ...prev, [note.ticker]: e.target.value }))}
                        rows={4}
                        placeholder={`${note.ticker}에 대한 보정 정보를 입력하세요.\n예) 발행주식수: 5,969,782,550주 (KRX 기준)\n    최대주주: 삼성물산 19.01%`}
                        className="w-full mt-1.5 px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                      />
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[11px] text-muted-foreground">{memo.length}/1000자</span>
                        <button
                          onClick={() => save(note.ticker)}
                          disabled={saving[note.ticker] || !isDirty}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                            isDirty
                              ? "bg-amber-500 text-white hover:bg-amber-600"
                              : "bg-muted text-muted-foreground cursor-default"
                          )}
                        >
                          {saving[note.ticker] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedOk[note.ticker] ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                          {savedOk[note.ticker] ? "저장됨" : "저장"}
                        </button>
                      </div>
                    </div>

                    {/* AI 자동학습 내용 (읽기 전용) */}
                    {note.autoLearning && (
                      <div className="rounded-lg bg-muted/50 p-3">
                        <label className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                          🤖 AI 자동학습 (읽기 전용)
                        </label>
                        <pre className="mt-1.5 text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                          {note.autoLearning}
                        </pre>
                      </div>
                    )}
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
