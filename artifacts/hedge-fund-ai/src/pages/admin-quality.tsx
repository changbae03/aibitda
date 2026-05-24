import { useState, useEffect, useCallback } from "react";
import {
  Loader2, Save, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Activity, RefreshCw,
  Brain, PencilLine, Search, Eye, BarChart3, Cpu, CheckCircle,
  StickyNote, Target, Plus,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

// ─── 종목 보정 메모 탭 ───────────────────────────────────────────────────────

const INJECTION_BLOCK_STYLES: Record<string, { color: string; icon: React.ElementType; border: string; bg: string }> = {
  memo:              { color: "text-amber-500 dark:text-amber-400",   icon: PencilLine, border: "border-amber-500/20",  bg: "bg-amber-500/[0.04]"  },
  autoLearning:      { color: "text-blue-500 dark:text-blue-400",     icon: BarChart3,  border: "border-blue-500/20",   bg: "bg-blue-500/[0.04]"   },
  sectorCalibration: { color: "text-violet-500 dark:text-violet-400", icon: Brain,      border: "border-violet-500/20", bg: "bg-violet-500/[0.04]" },
};

function InjectionPreview({ ticker }: { ticker: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(ticker)}/prompt-injection`), { credentials: "include" });
      if (r.ok) { setData(await r.json()); setLoaded(true); }
    } finally { setLoading(false); }
  }, [ticker]);
  useEffect(() => { load(); }, [ticker]);
  if (loading && !loaded) return <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 로드 중…</div>;
  if (!data) return null;
  const isEmpty = (data.blocks ?? []).length === 0;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-border bg-muted/60 text-muted-foreground"><Cpu className="w-3 h-3" />{data.sectorKey || "섹터 미분류"}</span>
        {data.industry && <span className="text-[10px] text-muted-foreground/60">{data.industry}</span>}
        <span className="text-[10px] text-muted-foreground/50">분석 이력 {data.historyCount}회{data.historyCount >= 2 ? " ✓ 통계 주입됨" : " (2회 이상부터 통계 주입)"}</span>
      </div>
      {isEmpty ? (
        <div className="text-xs text-muted-foreground/50 italic py-1">현재 주입되는 보정 데이터 없음</div>
      ) : (data.blocks ?? []).map((block: any, i: number) => {
        const style = INJECTION_BLOCK_STYLES[block.type] ?? INJECTION_BLOCK_STYLES.memo;
        const Icon = style.icon;
        return (
          <div key={i} className={cn("rounded-lg border p-3 text-[12px]", style.border, style.bg)}>
            <div className="flex items-center gap-1.5 mb-2"><Icon className={cn("w-3.5 h-3.5 shrink-0", style.color)} /><span className={cn("text-[10px] font-bold uppercase tracking-wider", style.color)}>{block.label}</span></div>
            <pre className="text-foreground/70 leading-relaxed whitespace-pre-wrap font-sans text-[11.5px]">{block.content}</pre>
          </div>
        );
      })}
      <button onClick={load} className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"><RefreshCw className="w-3 h-3" /> 새로고침</button>
    </div>
  );
}

function TickerNoteItem({ note, onSaved }: { note: any; onSaved: (ticker: string, memo: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isInjectionOpen, setIsInjectionOpen] = useState(false);
  const [editMemo, setEditMemo] = useState(note.memo ?? "");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const isDirty = editMemo !== note.memo;
  const isKR = /^\d{6}$/.test(note.ticker);
  const displayName = isKR && note.companyName ? note.companyName : note.ticker;

  useEffect(() => { if (!isOpen) setEditMemo(note.memo ?? ""); }, [note.memo]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(note.ticker)}`), {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: editMemo }),
      });
      if (r.ok) { onSaved(note.ticker, editMemo); setSavedOk(true); setTimeout(() => setSavedOk(false), 2000); }
    } finally { setSaving(false); }
  };

  let hist: any[] = [];
  try {
    const parsed = typeof note.autoLearning === "string" ? JSON.parse(note.autoLearning) : note.autoLearning;
    hist = parsed?.history ?? [];
  } catch {}

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button onClick={() => { setIsOpen(o => !o); if (!isOpen) setEditMemo(note.memo ?? ""); }} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          {isKR && note.companyName ? (
            <span className="flex items-center gap-1.5"><span className="font-bold text-sm text-foreground">{note.companyName}</span><span className="text-xs font-mono text-muted-foreground/60">{note.ticker}</span></span>
          ) : (
            <span className="font-mono font-bold text-sm text-foreground">{note.ticker}</span>
          )}
          {note.memo ? <span className="text-xs text-muted-foreground truncate max-w-[220px]">{note.memo}</span> : <span className="text-xs text-muted-foreground/50 italic">메모 없음</span>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[11px] text-muted-foreground">{note.updatedAt ? new Date(note.updatedAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</span>
          {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          <div className="pt-3">
            <div className="flex items-center gap-1.5 mb-1.5"><PencilLine className="w-3.5 h-3.5 text-amber-400" /><label className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">관리자 보정 메모 (AI 분석에 반영됨)</label></div>
            <textarea
              value={editMemo}
              onChange={e => setEditMemo(e.target.value)}
              rows={4}
              placeholder={`${displayName}에 대한 보정 정보\n예) 발행주식수: 5,969,782,550주`}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-muted-foreground">{editMemo.length}/1000자</span>
              <button
                onClick={save} disabled={saving || !isDirty}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors", isDirty ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-muted text-muted-foreground cursor-default")}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedOk ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {savedOk ? "저장됨" : "저장"}
              </button>
            </div>
          </div>
          {hist.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <label className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">🤖 AI 자동학습 이력 ({hist.length}회, 읽기 전용)</label>
              <div className="space-y-1.5">
                {hist.map((h: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground border-l-2 border-blue-400/30 pl-2">
                    <span className="font-mono text-muted-foreground/60">{h.date?.slice(0, 10) ?? "-"}</span>
                    <span className={cn("font-semibold", /Buy/i.test(h.verdict ?? "") ? "text-emerald-500" : /Sell/i.test(h.verdict ?? "") ? "text-red-500" : "text-amber-500")}>{h.verdict ?? "-"}</span>
                    <span>진입 {h.entryPrice?.toLocaleString() ?? "-"} → 목표 {h.targetPrice?.toLocaleString() ?? "-"}</span>
                    <span className={cn("font-medium", (h.upsidePct ?? 0) >= 0 ? "text-emerald-500" : "text-red-500")}>{(h.upsidePct ?? 0) >= 0 ? "+" : ""}{h.upsidePct?.toFixed(1) ?? "-"}%</span>
                    {h.actualReturn !== undefined && <span className="text-muted-foreground/50">실제 {h.actualReturn >= 0 ? "+" : ""}{Number(h.actualReturn).toFixed(1)}%{h.daysElapsed ? ` (${h.daysElapsed}일)` : ""}</span>}
                    {h.directionMatch !== undefined && h.directionMatch !== null && <span>{h.directionMatch ? "✓ 방향일치" : "✗ 방향불일치"}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-border/60 pt-3">
            <button onClick={() => setIsInjectionOpen(o => !o)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
              <Eye className="w-3.5 h-3.5 text-violet-400" />
              <span className="font-semibold text-violet-500 dark:text-violet-400 uppercase tracking-wide text-[10px]">프롬프트 주입 미리보기</span>
              <span className="text-[10px] text-muted-foreground/50 ml-1">— 실제 Gemini에 전달되는 보정 내용</span>
              {isInjectionOpen ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </button>
            {isInjectionOpen && <div className="mt-3"><InjectionPreview ticker={note.ticker} /></div>}
          </div>
        </div>
      )}
    </div>
  );
}

function TickerNotesTab() {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [newTicker, setNewTicker] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/ticker-notes"), { credentials: "include" });
      if (r.ok) setNotes(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addTicker = async () => {
    const t = newTicker.trim().toUpperCase();
    if (!t) return;
    if (notes.find(n => n.ticker === t)) { setNewTicker(""); return; }
    setAdding(true);
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(t)}`), {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: "" }),
      });
      if (r.ok) {
        setNotes(prev => [{ ticker: t, companyName: null, memo: "", autoLearning: "", updatedAt: new Date().toISOString() }, ...prev]);
        setNewTicker("");
      }
    } finally { setAdding(false); }
  };

  const q = search.toUpperCase();
  const filtered = notes.filter(n =>
    !search || n.ticker.includes(q) || (n.companyName ?? "").toLowerCase().includes(search.toLowerCase()) || n.memo.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">종목별 AI 분석에 반영되는 관리자 보정 메모, AI 자동학습 이력, 프롬프트 주입 내용을 확인합니다.</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Plus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={newTicker} onChange={e => setNewTicker(e.target.value)} onKeyDown={e => e.key === "Enter" && addTicker()} placeholder="티커 추가 (예: 005930, AAPL)" className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 uppercase" />
        </div>
        <button onClick={addTicker} disabled={adding || !newTicker.trim()} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors">
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : "추가"}
        </button>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted text-muted-foreground text-xs hover:bg-muted/80 transition-colors">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="종목명·티커·메모 검색" className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
      {loading && notes.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> 불러오는 중…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">{search ? "검색 결과가 없습니다" : "등록된 메모가 없습니다"}</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(note => (
            <TickerNoteItem
              key={note.ticker}
              note={note}
              onSaved={(ticker, memo) => setNotes(prev => prev.map(n => n.ticker === ticker ? { ...n, memo, updatedAt: new Date().toISOString() } : n))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 종목 커버리지 탭 ────────────────────────────────────────────────────────

interface CoverageItem {
  ticker: string;
  name: string;
  exchange: string;
  isCovered: boolean;
  reportCount: number;
  lastDate: string | null;
}

interface CoverageData {
  tickers: CoverageItem[];
  total: number;
  totalFull: number;
  covered: number;
  uncovered: number;
  page: number;
  pages: number;
  limit: number;
}

function CoverageTab() {
  const [market, setMarket]   = useState<"KR" | "US">("KR");
  const [search, setSearch]   = useState("");
  const [status, setStatus]   = useState<"all" | "covered" | "uncovered">("all");
  const [page, setPage]       = useState(1);
  const [data, setData]       = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ market, search, status, page: String(page), limit: "50" });
      const r = await fetch(getApiUrl(`/api/admin/ticker-coverage?${params}`), { credentials: "include" });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, [market, search, status, page]);

  useEffect(() => { load(); }, [load]);

  const coverPct = data ? Math.round((data.covered / Math.max(1, data.totalFull)) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* 헤더 + 마켓 토글 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> 종목 커버리지
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">AI 자동 분석 대상 종목 및 보고서 현황</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
          {(["KR", "US"] as const).map(m => (
            <button key={m} onClick={() => setMarket(m)}
              className={cn("px-3 py-1.5 text-xs font-semibold rounded-md transition-colors",
                market === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}>
              {m === "KR" ? "🇰🇷 국내" : "🇺🇸 해외"}
            </button>
          ))}
        </div>
      </div>

      {/* 커버리지 요약 */}
      {data && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">전체 대상</p>
              <p className="text-xl font-black tabular-nums">{data.totalFull.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">보고서 있음</p>
              <p className="text-xl font-black tabular-nums text-green-400">{data.covered.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">미분석</p>
              <p className="text-xl font-black tabular-nums text-muted-foreground/60">{data.uncovered.toLocaleString()}</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>커버리지</span>
              <span className="font-semibold text-foreground">{coverPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${coverPct}%`, background: "linear-gradient(90deg, #FF8A7A, #ff6b58)" }} />
            </div>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="종목명 / 코드 검색"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
          {([["all", "전체"], ["covered", "보고서 있음"], ["uncovered", "미분석"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v)}
              className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                status === v ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}>
              {l}
            </button>
          ))}
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {/* 목록 */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 bg-muted/40 border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>종목</span>
          <span className="text-right">거래소</span>
          <span className="text-right w-16">보고서</span>
          <span className="text-right w-20">최근 분석</span>
        </div>
        {!data || data.tickers.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {loading ? "로딩 중…" : "조건에 맞는 종목이 없습니다"}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.tickers.map(t => (
              <div key={t.ticker} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2.5 items-center hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", t.isCovered ? "bg-green-400" : "bg-muted-foreground/30")} />
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{t.ticker}</span>
                  <span className="text-sm text-foreground truncate">{t.name}</span>
                </div>
                <span className="text-[11px] text-muted-foreground/70 text-right">{t.exchange}</span>
                <span className={cn("text-xs font-semibold tabular-nums text-right w-16",
                  t.reportCount > 0 ? "text-green-400" : "text-muted-foreground/30")}>
                  {t.reportCount > 0 ? `${t.reportCount}건` : "—"}
                </span>
                <span className="text-[11px] text-muted-foreground text-right w-20">
                  {t.lastDate ? t.lastDate.slice(5) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{data.total.toLocaleString()}개 중 {(page - 1) * data.limit + 1}–{Math.min(page * data.limit, data.total)}개</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono">{page} / {data.pages}</span>
            <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page >= data.pages}
              className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 페이지 ─────────────────────────────────────────────────────────────

type Tab = "tickerNotes" | "coverage";

export default function AdminQuality() {
  const [tab, setTab] = useState<Tab>("tickerNotes");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "tickerNotes", label: "종목 메모",     icon: StickyNote },
    { key: "coverage",    label: "종목 커버리지", icon: Target },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" /> AI 관리
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          종목별 AI 보정 메모 관리 및 분석 커버리지 현황을 확인합니다.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-0">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {tab === "tickerNotes" && <TickerNotesTab />}
        {tab === "coverage"    && <CoverageTab />}
      </div>
    </div>
  );
}
