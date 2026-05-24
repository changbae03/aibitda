import { useState, useEffect, useCallback } from "react";
import { Search, Save, Plus, RefreshCw, ChevronDown, ChevronUp, Loader2, CheckCircle, Bot, PencilLine, Eye, Brain, BarChart3, Cpu } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

const AI_REVIEW_TAG = "[AI검수]";

function splitMemo(raw: string): { aiBlocks: string[]; adminBlocks: string[] } {
  if (!raw.trim()) return { aiBlocks: [], adminBlocks: [] };
  const chunks = raw.split(/\n\n---\n\n/);
  const aiBlocks: string[] = [];
  const adminBlocks: string[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(AI_REVIEW_TAG)) aiBlocks.push(trimmed);
    else adminBlocks.push(trimmed);
  }
  return { aiBlocks, adminBlocks };
}

function AiReviewBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  const header = lines[0] ?? "";
  const body = lines.slice(1).join("\n").trim();
  return (
    <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] p-2.5 text-[12px]">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Bot className="w-3 h-3 text-sky-400 shrink-0" />
        <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">{header}</span>
      </div>
      <p className="text-foreground/70 leading-relaxed whitespace-pre-wrap">{body}</p>
    </div>
  );
}

interface InjectionBlock {
  type: "memo" | "autoLearning" | "sectorCalibration";
  label: string;
  content: string;
}

interface InjectionData {
  ticker: string;
  companyName: string;
  industry: string;
  sectorKey: string;
  blocks: InjectionBlock[];
  historyCount: number;
}

const BLOCK_STYLES: Record<string, { color: string; icon: React.ElementType; border: string; bg: string }> = {
  memo:              { color: "text-amber-500 dark:text-amber-400",  icon: PencilLine, border: "border-amber-500/20", bg: "bg-amber-500/[0.04]" },
  autoLearning:      { color: "text-blue-500 dark:text-blue-400",    icon: BarChart3,  border: "border-blue-500/20",  bg: "bg-blue-500/[0.04]"  },
  sectorCalibration: { color: "text-violet-500 dark:text-violet-400",icon: Brain,      border: "border-violet-500/20",bg: "bg-violet-500/[0.04]" },
};

function InjectionPreview({ ticker }: { ticker: string }) {
  const [data, setData] = useState<InjectionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(ticker)}/prompt-injection`), { credentials: "include" });
      if (r.ok) { setData(await r.json()); setLoaded(true); }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [ticker]);

  if (loading && !loaded) {
    return (
      <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> 프롬프트 주입 내용 로드 중…
      </div>
    );
  }

  if (!data) return null;

  const isEmpty = data.blocks.length === 0;

  return (
    <div className="space-y-2.5">
      {/* 섹터 뱃지 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-border bg-muted/60 text-muted-foreground">
          <Cpu className="w-3 h-3" />
          {data.sectorKey || "섹터 미분류"}
        </span>
        {data.industry && (
          <span className="text-[10px] text-muted-foreground/60">{data.industry}</span>
        )}
        <span className="text-[10px] text-muted-foreground/50">
          분석 이력 {data.historyCount}회 {data.historyCount >= 2 ? "✓ 통계 주입됨" : "(2회 이상부터 통계 주입)"}
        </span>
      </div>

      {isEmpty ? (
        <div className="text-xs text-muted-foreground/50 italic py-1">
          현재 주입되는 보정 데이터 없음 — 메모 작성 또는 분석 2회 이상 완료 시 활성화됩니다.
        </div>
      ) : (
        data.blocks.map((block, i) => {
          const style = BLOCK_STYLES[block.type] ?? BLOCK_STYLES.memo;
          const Icon = style.icon;
          return (
            <div key={i} className={cn("rounded-lg border p-3 text-[12px]", style.border, style.bg)}>
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className={cn("w-3.5 h-3.5 shrink-0", style.color)} />
                <span className={cn("text-[10px] font-bold uppercase tracking-wider", style.color)}>
                  {block.label}
                </span>
              </div>
              <pre className="text-foreground/70 leading-relaxed whitespace-pre-wrap font-sans text-[11.5px]">
                {block.content}
              </pre>
            </div>
          );
        })
      )}

      <button
        onClick={load}
        className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"
      >
        <RefreshCw className="w-3 h-3" /> 새로고침
      </button>
    </div>
  );
}

interface TickerNote {
  ticker: string;
  companyName?: string | null;
  memo: string;
  autoLearning: string;
  updatedAt: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isKoreanTicker(ticker: string) {
  return /^\d{6}$/.test(ticker);
}

function TickerLabel({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  if (isKoreanTicker(ticker) && companyName) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-sm text-foreground">{companyName}</span>
        <span className="text-xs font-mono text-muted-foreground/60">{ticker}</span>
      </span>
    );
  }
  return <span className="font-mono font-bold text-sm text-foreground">{ticker}</span>;
}

export default function AdminTickerNotes() {
  const [notes, setNotes] = useState<TickerNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [injectionOpen, setInjectionOpen] = useState<Record<string, boolean>>({});
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
        const newNote: TickerNote = { ticker: t, companyName: null, memo: "", autoLearning: "", updatedAt: new Date().toISOString() };
        setNotes(prev => [newNote, ...prev]);
        setEditing(prev => ({ ...prev, [t]: "" }));
        setExpanded(prev => ({ ...prev, [t]: true }));
        setNewTicker("");
      }
    } finally {
      setAdding(false);
    }
  };

  const q = search.toUpperCase();
  const filtered = notes.filter(n =>
    !search ||
    n.ticker.includes(q) ||
    (n.companyName ?? "").toLowerCase().includes(search.toLowerCase()) ||
    n.memo.toLowerCase().includes(search.toLowerCase())
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
          placeholder="종목명·티커·메모 내용으로 검색"
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
            const isInjectionOpen = !!injectionOpen[note.ticker];
            const memo = editing[note.ticker] ?? note.memo;
            const isDirty = memo !== note.memo;
            const displayName = isKoreanTicker(note.ticker) && note.companyName
              ? note.companyName
              : note.ticker;
            return (
              <div key={note.ticker} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* 헤더 행 */}
                <button
                  onClick={() => toggle(note.ticker)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <TickerLabel ticker={note.ticker} companyName={note.companyName} />
                    {note.memo ? (
                      <span className="text-xs text-muted-foreground truncate max-w-[220px]">{note.memo}</span>
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
                {isOpen && (() => {
                  const { aiBlocks, adminBlocks } = splitMemo(memo);
                  const adminOnly = adminBlocks.join("\n\n---\n\n");
                  return (
                  <div className="px-4 pb-4 space-y-3 border-t border-border">

                    {/* AI 자체 검수 결과 (읽기 전용) */}
                    {aiBlocks.length > 0 && (
                      <div className="pt-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Bot className="w-3.5 h-3.5 text-sky-400" />
                          <label className="text-xs font-semibold text-sky-500 dark:text-sky-400 uppercase tracking-wide">
                            AI 자체 검수 결과
                          </label>
                          <span className="text-[10px] text-muted-foreground/50">(자동 생성, 읽기 전용)</span>
                        </div>
                        {aiBlocks.map((block, i) => (
                          <AiReviewBlock key={i} text={block} />
                        ))}
                      </div>
                    )}

                    {/* 관리자 보정 메모 편집 */}
                    <div className={aiBlocks.length > 0 ? "" : "pt-3"}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <PencilLine className="w-3.5 h-3.5 text-amber-400" />
                        <label className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                          관리자 보정 메모 (AI 분석에 반영됨)
                        </label>
                      </div>
                      <textarea
                        value={adminOnly}
                        onChange={e => {
                          const newAdminPart = e.target.value;
                          const combined = [...aiBlocks, newAdminPart]
                            .map(s => s.trim()).filter(Boolean).join("\n\n---\n\n");
                          setEditing(prev => ({ ...prev, [note.ticker]: combined }));
                        }}
                        rows={4}
                        placeholder={`${displayName}에 대한 보정 정보를 입력하세요.\n예) 발행주식수: 5,969,782,550주 (KRX 기준)\n    최대주주: 삼성물산 19.01%`}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                      />
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[11px] text-muted-foreground">{adminOnly.length}/1000자</span>
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

                    {/* AI 자동학습 이력 (읽기 전용) */}
                    {note.autoLearning && (
                      <div className="rounded-lg bg-muted/50 p-3">
                        <label className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                          🤖 AI 자동학습 이력 (읽기 전용)
                        </label>
                        <pre className="mt-1.5 text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                          {typeof note.autoLearning === "string"
                            ? note.autoLearning
                            : JSON.stringify(note.autoLearning, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* 프롬프트 주입 미리보기 */}
                    <div className="border-t border-border/60 pt-3">
                      <button
                        onClick={() => setInjectionOpen(prev => ({ ...prev, [note.ticker]: !prev[note.ticker] }))}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                      >
                        <Eye className="w-3.5 h-3.5 text-violet-400" />
                        <span className="font-semibold text-violet-500 dark:text-violet-400 uppercase tracking-wide text-[10px]">
                          프롬프트 주입 미리보기
                        </span>
                        <span className="text-[10px] text-muted-foreground/50 ml-1">— 실제 Gemini에 전달되는 보정 내용</span>
                        {isInjectionOpen
                          ? <ChevronUp className="w-3 h-3 ml-auto text-muted-foreground" />
                          : <ChevronDown className="w-3 h-3 ml-auto text-muted-foreground" />}
                      </button>

                      {isInjectionOpen && (
                        <div className="mt-3">
                          <InjectionPreview ticker={note.ticker} />
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
