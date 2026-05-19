import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useListAnalyses, useDeleteAnalysis, getListAnalysesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  Loader2, Inbox, Share2, CheckCircle2, Clock, Trash2,
  Pencil, Check, X, RefreshCw,
  ChevronDown, AlertTriangle, SlidersHorizontal, Timer,
} from "lucide-react";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";
import StockLogo from "@/components/ui/stock-logo";
import { useLanguage } from "@/lib/language-context";
import { motion, AnimatePresence } from "framer-motion";

interface QuoteResult {
  price: number | null;
  currency: string;
  change: number | null;
}

interface SparklineResult {
  closes: number[];
  change3m: number | null;
}

function isUSTicker(t: string) {
  return !/^\d{5,6}/.test(t.split(".")[0]);
}

const STORAGE_KEY = "avitda-recent-analyses";
const MEMO_KEY = "avitda-memos";

function getLocalRecents(): any[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function removeLocalRecent(id: number) {
  try {
    const stored = getLocalRecents().filter((x: any) => x.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {}
}
function getAllMemos(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MEMO_KEY) || "{}"); } catch { return {}; }
}
function saveMemo(id: number, text: string) {
  try {
    const memos = getAllMemos();
    if (text.trim()) memos[String(id)] = text.trim();
    else delete memos[String(id)];
    localStorage.setItem(MEMO_KEY, JSON.stringify(memos));
  } catch {}
}
function getMemo(id: number): string {
  return getAllMemos()[String(id)] || "";
}

function toKoreanVerdict(verdict: string): string {
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return "높은 상승여력";
  if (s.includes("buy"))         return "상승여력";
  if (s.includes("strong sell")) return "높은 하락여지";
  if (s.includes("sell"))        return "하락여지";
  return "적정 수준";
}
function verdictStyle(verdict: string): string {
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return "dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-400 dark:border-red-700";
  if (s.includes("buy"))         return "dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-300 dark:border-red-800";
  if (s.includes("strong sell")) return "dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-700";
  if (s.includes("sell"))        return "dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-700";
  return "dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-400 dark:border-amber-700";
}
function toEnVerdict(verdict: string): string {
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return "Strong Buy";
  if (s.includes("buy"))         return "Buy";
  if (s.includes("strong sell")) return "Strong Sell";
  if (s.includes("sell"))        return "Sell";
  return "Hold";
}
function verdictBadge(verdict?: string, isEn?: boolean) {
  if (!verdict) return null;
  const label = isEn ? toEnVerdict(verdict) : toKoreanVerdict(verdict);
  const cls = verdictStyle(verdict);
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border", cls)}>
      {label}
    </span>
  );
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────
function Sparkline({ closes }: { closes: number[] }) {
  if (closes.length < 2) {
    return <div className="w-[72px] h-[28px] flex items-center justify-center text-[9px] text-muted-foreground/30">—</div>;
  }
  const W = 72, H = 28, PAD = 2;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pts = closes.map((v, i) => [
    PAD + (i / (closes.length - 1)) * (W - PAD * 2),
    (H - PAD) - ((v - min) / range) * (H - PAD * 2),
  ]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const isUp = closes[closes.length - 1] >= closes[0];
  const lineColor = isUp ? "#10b981" : "#ef4444";
  const fillColor = isUp ? "#10b98118" : "#ef444418";
  const last = pts[pts.length - 1];
  // area fill
  const areaD = d + ` L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;

  return (
    <svg width={W} height={H} style={{ display: "block", flexShrink: 0 }}>
      <path d={areaD} fill={fillColor} />
      <path d={d} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={lineColor} />
    </svg>
  );
}

// ── Memo inline ───────────────────────────────────────────────────────────────
function MemoInline({ id }: { id: number }) {
  const { isEn } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(() => getMemo(id));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) { setDraft(saved); setTimeout(() => textareaRef.current?.focus(), 50); }
  }, [editing]);

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    saveMemo(id, draft); setSaved(draft.trim()); setEditing(false);
  };
  const handleCancel = (e: React.MouseEvent) => { e.stopPropagation(); setEditing(false); };
  const handleEdit = (e: React.MouseEvent) => { e.stopPropagation(); setEditing(true); };
  const handleDelete = (e: React.MouseEvent) => { e.stopPropagation(); saveMemo(id, ""); setSaved(""); };

  if (editing) {
    return (
      <div className="mt-2.5 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isEn ? "Add a note about this report..." : "이 보고서에 대한 메모를 입력하세요..."}
          rows={2}
          className="w-full text-[12px] text-foreground/80 placeholder:text-muted-foreground/50 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-300 dark:focus:ring-amber-700 leading-relaxed"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { saveMemo(id, draft); setSaved(draft.trim()); setEditing(false); }
          }}
        />
        <div className="flex items-center gap-1.5">
          <button onClick={handleSave} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-400 hover:bg-amber-500 text-white text-[11px] font-semibold transition-colors">
            <Check className="w-3 h-3" /> {isEn ? "Save" : "저장"}
          </button>
          <button onClick={handleCancel} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted hover:bg-muted text-muted-foreground text-[11px] font-semibold transition-colors">
            <X className="w-3 h-3" /> {isEn ? "Cancel" : "취소"}
          </button>
          <span className="text-[10px] text-muted-foreground/50 ml-1">{isEn ? "⌘Enter to save" : "⌘Enter로 저장"}</span>
        </div>
      </div>
    );
  }
  if (saved) {
    return (
      <div className="mt-2 flex items-start gap-1.5 group/memo" onClick={(e) => e.stopPropagation()}>
        <div className="flex-1 text-[12px] text-muted-foreground leading-relaxed bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-800/40 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap break-words">{saved}</div>
        <div className="shrink-0 mt-0.5 flex items-center gap-0.5 opacity-0 group-hover/memo:opacity-100 transition-opacity">
          <button onClick={handleEdit} className="p-1 rounded text-muted-foreground/50 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors" title={isEn ? "Edit memo" : "메모 수정"}><Pencil className="w-3 h-3" /></button>
          <button onClick={handleDelete} className="p-1 rounded text-muted-foreground/50 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors" title={isEn ? "Delete memo" : "메모 삭제"}><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>
    );
  }
  return (
    <button onClick={handleEdit} className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-amber-500 transition-colors opacity-0 group-hover:opacity-100">
      <Pencil className="w-3 h-3" /> Add memo
    </button>
  );
}

// ── PriceTrack: 중앙 진입가 기준 좌우 이동 시각화 ───────────────────────────────
function PriceTrack({
  entry, tgt, cur, currency, isEn,
}: {
  entry: number; tgt: number; cur: number;
  currency: string; isEn?: boolean;
}) {
  // 방향: target이 entry보다 낮으면 하락 목표 (과평가 해소)
  const isDownside = tgt < entry;

  const tgtDist  = Math.abs(tgt - entry);
  const curDist  = Math.abs(cur - entry);
  const halfRange = Math.max(tgtDist, curDist) * 1.4 || tgtDist * 2 || 1;

  const toX = (price: number) =>
    Math.min(Math.max(50 + ((price - entry) / halfRange) * 50, 1), 99);

  const tgtX   = toX(tgt);
  const curX   = toX(cur);
  const fillLeft  = Math.min(50, curX);
  const fillWidth = Math.abs(curX - 50);

  // 달성: 상승 목표면 cur≥tgt, 하락 목표면 cur≤tgt
  const exceeded  = isDownside ? cur <= tgt : cur >= tgt;
  const isPositive = cur >= entry;
  const returnPct = ((cur - entry) / entry) * 100;

  // 레이블용: 상승 목표 → 남은 업사이드, 하락 목표 → 과열 정도
  const gapPct = isDownside
    ? ((cur - tgt) / tgt) * 100      // 적정가 대비 고평가율 (양수=과열)
    : ((tgt - cur) / cur) * 100;     // 적정가까지 남은 상승률 (양수=업사이드)

  const tgtLabel = (() => {
    if (exceeded) return isDownside
      ? (isEn ? "✓ Target reached" : "✓ 적정가 도달")
      : (isEn ? "✓ Achieved" : "✓ 달성");
    if (isDownside) return gapPct > 0
      ? (isEn ? `Overheated +${gapPct.toFixed(1)}%` : `과열 +${gapPct.toFixed(1)}%`)
      : (isEn ? "Near target" : "적정가 근접");
    return `${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(1)}%`;
  })();

  const dotColor = exceeded ? "bg-emerald-500" : isPositive ? "bg-red-400" : "bg-blue-500";
  const fillColor = exceeded ? "bg-emerald-300" : isPositive ? "bg-red-200" : "bg-blue-200";
  const curLabelColor = exceeded ? "text-emerald-600" : isPositive ? "text-red-500" : "text-blue-600";

  // 레이블 위치: 각 마커 바로 아래 절대좌표
  // 겹침 방지: 두 마커가 너무 가까우면 벌려줌
  const GAP = 18; // 최소 % 간격
  let entryPos = 50;
  let tgtPos = Math.min(Math.max(tgtX, 5), 95);
  if (Math.abs(tgtPos - entryPos) < GAP) {
    const mid = (entryPos + tgtPos) / 2;
    entryPos = isDownside ? mid + GAP / 2 : mid - GAP / 2;
    tgtPos   = isDownside ? mid - GAP / 2 : mid + GAP / 2;
  }
  entryPos = Math.min(Math.max(entryPos, 5), 85);
  tgtPos   = Math.min(Math.max(tgtPos, 15), 95);

  return (
    <div className="mt-3 select-none">

      {/* ── 위: 현재가만 (dot 위치 추종, 혼자라 겹칠 상대 없음) ── */}
      <div className="relative h-9">
        <motion.div
          className="absolute bottom-1 text-center pointer-events-none"
          style={{ transform: "translateX(-50%)" }}
          initial={{ left: "50%" }}
          animate={{ left: `${Math.min(Math.max(curX, 8), 92)}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <p className={cn("text-[8px] leading-none mb-0.5 tabular-nums", returnPct >= 0 ? "text-red-400" : "text-blue-400")}>
            {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%
          </p>
          <p className={cn("font-mono text-[12px] font-bold leading-none tabular-nums", curLabelColor)}>
            {formatCurrency(cur, currency, isEn)}
          </p>
        </motion.div>
      </div>

      {/* ── 트랙 ── */}
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-muted" />
        <motion.div
          className={cn("absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full", fillColor)}
          initial={{ left: "50%", width: 0 }}
          animate={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${tgtX}%` }}>
          <div className={cn("w-px h-5 rounded-full", exceeded ? "bg-emerald-500" : "bg-emerald-400")} />
        </div>
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: "50%" }}>
          <div className="w-px h-4 bg-muted-foreground/30 rounded-full" />
        </div>
        <motion.div
          className={cn("absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-md", dotColor)}
          initial={{ left: "50%" }}
          animate={{ left: `${curX}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>

      {/* ── 아래: 각 마커 바로 밑에 절대좌표로 배치 ── */}
      <div className="relative mt-1" style={{ height: 30 }}>
        {/* 분석 당시 — 중앙 마커(50%) 바로 밑 */}
        <div
          className="absolute text-center"
          style={{ left: `${entryPos}%`, transform: "translateX(-50%)" }}
        >
          <p className="text-[8px] text-muted-foreground/50 leading-none mb-0.5 whitespace-nowrap">{isEn ? "At Analysis" : "분석 당시"}</p>
          <p className="font-mono text-[9px] font-semibold text-muted-foreground/60 tabular-nums whitespace-nowrap">{formatCurrency(entry, currency, isEn)}</p>
        </div>

        {/* 적정주가 — 초록 마커(tgtX%) 바로 밑 */}
        <div
          className="absolute text-center"
          style={{ left: `${tgtPos}%`, transform: "translateX(-50%)" }}
        >
          <p className={cn("text-[8px] leading-none mb-0.5 whitespace-nowrap", exceeded ? "text-emerald-500" : "text-muted-foreground/50")}>
            {isEn ? "Target " : "적정주가 "}{tgtLabel}
          </p>
          <p className={cn("font-mono text-[9px] font-semibold tabular-nums whitespace-nowrap", exceeded ? "text-emerald-600" : "text-muted-foreground/60")}>
            {formatCurrency(tgt, currency, isEn)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── PerformanceBadges ─────────────────────────────────────────────────────────
interface PerfResult {
  w1: number | null;
  m1: number | null;
  m3: number | null;
  entryClose: number | null;
}

function PerfBadge({ label, pct, daysElapsed, requiredDays }: {
  label: string; pct: number | null; daysElapsed: number; requiredDays: number;
}) {
  const { isEn } = useLanguage();
  const elapsed = daysElapsed >= requiredDays;

  if (!elapsed) {
    const remaining = requiredDays - daysElapsed;
    return (
      <div className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg bg-muted/60 border border-border/60 min-w-[52px]">
        <span className="text-[9px] font-medium text-muted-foreground/60 leading-none">{label}</span>
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/40 leading-none mt-0.5">
          <Timer className="w-2.5 h-2.5" />{remaining}{isEn ? "d" : "일"}
        </span>
      </div>
    );
  }

  if (pct == null) {
    return (
      <div className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/40 min-w-[52px]">
        <span className="text-[9px] font-medium text-muted-foreground/60 leading-none">{label}</span>
        <span className="text-[10px] text-muted-foreground/30 leading-none mt-0.5">—</span>
      </div>
    );
  }

  const isPos = pct >= 0;
  const colorCls = isPos
    ? "bg-red-50 dark:bg-red-950/40 border-red-400 dark:border-red-700 text-red-800 dark:text-red-300"
    : "bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-700 text-blue-800 dark:text-blue-300";

  return (
    <div className={cn("flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg border min-w-[52px]", colorCls)}>
      <span className="text-[9px] font-medium leading-none opacity-70">{label}</span>
      <span className="text-[11px] font-bold leading-none tabular-nums mt-0.5">
        {isPos ? "+" : ""}{pct.toFixed(1)}%
      </span>
    </div>
  );
}

function PerformanceBadges({ analysisDate, perf, isEn }: {
  analysisDate: string;
  perf: PerfResult | undefined;
  isEn?: boolean;
}) {
  const daysElapsed = Math.floor((Date.now() - new Date(analysisDate).getTime()) / (1000 * 60 * 60 * 24));

  if (daysElapsed < 5) return null;

  return (
    <div className="mt-2.5 flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
      <span className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wide mr-0.5 whitespace-nowrap">{isEn ? "Post-Analysis Return" : "분석 후 성과"}</span>
      <PerfBadge label={isEn ? "1W" : "1주일"} pct={perf?.w1 ?? null} daysElapsed={daysElapsed} requiredDays={7} />
      <PerfBadge label={isEn ? "1M" : "1개월"} pct={perf?.m1 ?? null} daysElapsed={daysElapsed} requiredDays={30} />
      <PerfBadge label={isEn ? "3M" : "3개월"} pct={perf?.m3 ?? null} daysElapsed={daysElapsed} requiredDays={90} />
    </div>
  );
}

// ── Re-analysis badge logic ───────────────────────────────────────────────────
function getReanalysisLevel(
  createdAt: string,
  entryPrice: number | null,
  currentPrice: number | null
): "urgent" | "recommend" | null {
  const daysOld = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysOld < 14) return null;

  if (entryPrice && currentPrice) {
    const changePct = Math.abs((currentPrice - entryPrice) / entryPrice) * 100;
    if (changePct >= 25 && daysOld >= 14) return "urgent";
    if (changePct >= 15 && daysOld >= 30) return "recommend";
  }
  if (daysOld >= 90) return "recommend";
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────
type SortKey = "date" | "upside" | "return" | "name";
type VerdictFilter = "all" | "buy" | "sell" | "hold" | "reanalysis";

export default function History() {
  const { isEn } = useLanguage();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: serverAnalyses, isLoading } = useListAnalyses();
  const { mutate: deleteAnalysis } = useDeleteAnalysis();
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [localItems, setLocalItems] = useState<any[]>(() => getLocalRecents());
  const [quotes, setQuotes] = useState<Record<string, QuoteResult>>({});
  const [sparklines, setSparklines] = useState<Record<string, SparklineResult>>({});
  const [perf, setPerf] = useState<Record<number, PerfResult>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesUpdatedAt, setQuotesUpdatedAt] = useState<Date | null>(null);

  // ── Filter / Sort state ────────────────────────────────────────────────────
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showIndustryMenu, setShowIndustryMenu] = useState(false);

  const list = useMemo(() => {
    const serverList = serverAnalyses ?? [];
    const serverIds = new Set(serverList.map((a: any) => a.id));
    const localOnly = localItems.filter((x) => !serverIds.has(x.id));
    return [...serverList, ...localOnly];
  }, [serverAnalyses, localItems]);

  // 전체 업종 목록
  const industries = useMemo(() => {
    const set = new Set<string>();
    list.forEach((a) => { if (a.industry) set.add(a.industry); });
    return Array.from(set).sort();
  }, [list]);

  const fetchQuotes = useCallback(async (items: any[]) => {
    const tickers = [...new Set(
      items.filter((a) => a.status === "completed" && a.targetPrice != null).map((a) => a.ticker)
    )];
    if (tickers.length === 0) return;
    setQuotesLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/market-data/batch-quotes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (r.ok) { setQuotes(await r.json()); setQuotesUpdatedAt(new Date()); }
    } catch {}
    setQuotesLoading(false);
  }, []);

  const fetchSparklines = useCallback(async (items: any[]) => {
    const tickers = [...new Set(items.map((a) => a.ticker))];
    if (tickers.length === 0) return;
    try {
      const r = await fetch(getApiUrl("/api/market-data/batch-sparklines"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, days: 90 }),
      });
      if (r.ok) setSparklines(await r.json());
    } catch {}
  }, []);

  const fetchPerformance = useCallback(async (items: any[]) => {
    // 5일 이상 된 완료된 분석만 성과 조회
    const eligible = items.filter((a) => {
      if (a.status !== "completed") return false;
      const days = (Date.now() - new Date(a.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      return days >= 5;
    });
    if (eligible.length === 0) return;
    try {
      const payload = eligible.map((a: any) => ({
        id: a.id,
        ticker: a.ticker,
        analysisDate: a.createdAt,
      }));
      const r = await fetch(getApiUrl("/api/market-data/batch-performance"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) setPerf(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (list.length > 0) {
      fetchQuotes(list);
      fetchSparklines(list);
      fetchPerformance(list);
    }
  }, [list.length]);

  const handleDelete = (id: number, e: React.MouseEvent) => { e.stopPropagation(); setConfirmId(id); };
  const confirmDelete = (id: number, isLocalOnly: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id); setConfirmId(null);
    if (isLocalOnly) {
      removeLocalRecent(id); setLocalItems(getLocalRecents()); setDeletingId(null);
    } else {
      deleteAnalysis(id, {
        onSuccess: () => { removeLocalRecent(id); setLocalItems(getLocalRecents()); setDeletingId(null); queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey() }); },
        onError: () => setDeletingId(null),
      });
    }
  };
  const cancelConfirm = (e: React.MouseEvent) => { e.stopPropagation(); setConfirmId(null); };

  const handleDeleteAll = async () => {
    setDeletingAll(true);
    try {
      const r = await fetch(getApiUrl("/api/analysis/mine"), {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) {
        localStorage.removeItem("avitda-recent-analyses");
        setLocalItems([]);
        setConfirmDeleteAll(false);
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey() });
      }
    } catch {}
    setDeletingAll(false);
  };

  // ── 필터 + 정렬 (모든 useMemo는 early return 전에 위치해야 함) ────────────
  const filteredAndSorted = useMemo(() => {
    const verdictMatch = (a: any): boolean => {
      if (verdictFilter === "all") return true;
      const s = (a.investmentVerdict ?? "").toLowerCase();
      if (verdictFilter === "buy")  return s.includes("buy");
      if (verdictFilter === "sell") return s.includes("sell");
      if (verdictFilter === "hold") return !s.includes("buy") && !s.includes("sell");
      if (verdictFilter === "reanalysis") {
        const cur = quotes[a.ticker]?.price ?? null;
        return getReanalysisLevel(a.createdAt, a.startPrice ?? a.entryPrice, cur) != null;
      }
      return true;
    };
    const getUpsideForSort = (a: any): number => {
      const q = quotes[a.ticker];
      if (!q?.price || !a.targetPrice) return -Infinity;
      return ((a.targetPrice - q.price) / q.price) * 100;
    };
    const getReturnForSort = (a: any): number => {
      const q = quotes[a.ticker];
      const ep = a.startPrice ?? a.entryPrice;
      if (!q?.price || !ep) return -Infinity;
      return ((q.price - ep) / ep) * 100;
    };
    let items = list.filter((a) =>
      verdictMatch(a) &&
      (industryFilter === "all" || a.industry === industryFilter)
    );
    if (sortBy === "date")   items = [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (sortBy === "upside") items = [...items].sort((a, b) => getUpsideForSort(b) - getUpsideForSort(a));
    if (sortBy === "return") items = [...items].sort((a, b) => getReturnForSort(b) - getReturnForSort(a));
    if (sortBy === "name")   items = [...items].sort((a, b) => (a.companyName ?? "").localeCompare(b.companyName ?? "", "ko"));
    return items;
  }, [list, verdictFilter, industryFilter, sortBy, quotes]);

  const sortLabels: Record<SortKey, string> = isEn
    ? { date: "Newest", upside: "Highest Upside", return: "Best Return", name: "Alphabetical" }
    : { date: "최신순", upside: "업사이드 큰 순", return: "수익률 순", name: "기업명순" };

  // ── 정확도 통계 ────────────────────────────────────────────────────────
  const accuracyStats = useMemo(() => {
    // 현재가 + 목표가가 있는 전체 집합
    const allTracked = list.filter((a) => quotes[a.ticker]?.price != null && a.targetPrice != null);
    if (allTracked.length === 0) return null;

    // 가격이 분석 시점 대비 0.5% 이상 움직인 종목만 정확도 평가 대상으로 포함
    // → 분석 직후 미반영 종목(+0.0%)이 정확도를 왜곡하는 문제 방지
    const MIN_MOVE = 0.005; // 0.5%
    const tracked = allTracked.filter((a) => {
      const cur   = quotes[a.ticker]!.price!;
      const entry = a.startPrice ?? a.entryPrice;
      if (entry == null || entry === 0) return false;
      return Math.abs(cur - entry) / entry >= MIN_MOVE;
    });
    const pendingCount = allTracked.length - tracked.length;

    if (tracked.length === 0) return { total: 0, pendingCount, exceededCount: 0, dirAccuracy: 0, achievementRate: 0, avgAccuracy: null };

    let exceededCount = 0, approachingCount = 0, divergingCount = 0;
    let accSum = 0, accCount = 0;
    tracked.forEach((a) => {
      const cur = quotes[a.ticker]!.price!;
      const tgt = a.targetPrice!;
      const entry = a.startPrice ?? a.entryPrice;
      const effectiveEntry = entry ?? cur;
      const isDownside = tgt < effectiveEntry;
      const exceeded  = isDownside ? cur <= tgt : cur >= tgt;
      const distNow   = Math.abs(cur - tgt);
      const distThen  = entry != null ? Math.abs(entry - tgt) : null;
      const approaching = !exceeded && distThen != null && distNow < distThen;
      const diverging   = !exceeded && distThen != null && distNow > distThen;
      if (exceeded)    exceededCount++;
      if (approaching) approachingCount++;
      if (diverging)   divergingCount++;
      if (entry != null && tgt !== entry) {
        accSum += ((cur - entry) / (tgt - entry)) * 100;
        accCount++;
      }
    });
    return {
      total: tracked.length,
      pendingCount,
      exceededCount,
      dirAccuracy: ((exceededCount + approachingCount) / tracked.length) * 100,
      achievementRate: (exceededCount / tracked.length) * 100,
      avgAccuracy: accCount > 0 ? accSum / accCount : null,
    };
  }, [list, quotes]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  const serverIds = new Set((serverAnalyses ?? []).map((a: any) => a.id));


  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[22px] font-black tracking-tight text-foreground" style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif" }}>
            {isEn ? "My Reports" : "내가 본 자료"}
          </h1>
          {list.length > 0 && (() => {
            const buyCount  = list.filter((a) => (a.investmentVerdict ?? "").toLowerCase().includes("buy")).length;
            const sellCount = list.filter((a) => (a.investmentVerdict ?? "").toLowerCase().includes("sell")).length;
            const holdCount = list.filter((a) => {
              const s = (a.investmentVerdict ?? "").toLowerCase();
              return !s.includes("buy") && !s.includes("sell") && a.investmentVerdict;
            }).length;
            const reanalysisCount = list.filter((a) => {
              const cur = quotes[a.ticker]?.price ?? null;
              return getReanalysisLevel(a.createdAt, a.entryPrice, cur) != null;
            }).length;
            return (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-muted-foreground/50">{isEn ? `${list.length} Reports` : `${list.length}건`}</span>
                {buyCount > 0  && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-400 dark:border-red-700">{isEn ? `Buy ${buyCount}` : `상승여력 ${buyCount}`}</span>}
                {holdCount > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-400 dark:border-amber-700">{isEn ? `Hold ${holdCount}` : `적정수준 ${holdCount}`}</span>}
                {sellCount > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-400 dark:border-blue-700">{isEn ? `Sell ${sellCount}` : `하락여지 ${sellCount}`}</span>}
                {reanalysisCount > 0 && (
                  <button
                    onClick={() => setVerdictFilter(verdictFilter === "reanalysis" ? "all" : "reanalysis")}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold border transition-colors ${
                      verdictFilter === "reanalysis"
                        ? "bg-orange-500 text-white border-orange-500"
                        : "bg-orange-50 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300 border-orange-400 dark:border-orange-700 hover:bg-orange-100 dark:hover:bg-orange-950/50"
                    }`}
                  >
                    {isEn ? `Re-analyze ${reanalysisCount}` : `재분석 ${reanalysisCount}`}
                  </button>
                )}
              </div>
            );
          })()}
        </div>
        {list.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchQuotes(list); fetchSparklines(list); }}
              disabled={quotesLoading}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors disabled:opacity-30"
              title={isEn ? "Refresh prices" : "현재가 새로고침"}
            >
              <RefreshCw className={cn("w-3 h-3", quotesLoading && "animate-spin")} />
              <span>{isEn ? "Refresh" : "새로고침"}</span>
            </button>

            <AnimatePresence mode="wait">
              {confirmDeleteAll ? (
                <motion.div
                  key="confirm"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-1.5"
                >
                  <span className="text-[11px] text-red-500 font-medium">{isEn ? "Delete all?" : "전체 삭제?"}</span>
                  <button
                    onClick={handleDeleteAll}
                    disabled={deletingAll}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-500 text-white text-[11px] font-semibold hover:bg-red-600 transition-colors disabled:opacity-60"
                  >
                    {deletingAll ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }} className="w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    {isEn ? "Confirm" : "확인"}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteAll(false)}
                    className="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {isEn ? "Cancel" : "취소"}
                  </button>
                </motion.div>
              ) : (
                <motion.button
                  key="delete-all"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setConfirmDeleteAll(true)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-red-400 transition-colors"
                  title={isEn ? "Delete All" : "전체 삭제"}
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{isEn ? "Delete All" : "전체 삭제"}</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── 방향 정확도 패널 ─────────────────────────────────────────────── */}
      {accuracyStats && (
        <div className="mb-4">
          <div className="rounded-xl border border-border bg-background px-5 py-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{isEn ? "Price Direction Accuracy" : "주가 방향 정확도"}</p>
              <p className="text-[11px] text-muted-foreground/50">{isEn ? "Based on up/down direction predictions" : "상승·하락 방향 예측 기준"}</p>
              {accuracyStats.pendingCount > 0 && (
                <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                  {isEn ? `${accuracyStats.pendingCount} excluded (±0.5% move)` : `${accuracyStats.pendingCount}건 미반영 제외 (±0.5% 미만)`}
                </p>
              )}
            </div>
            <div className="text-right">
              {accuracyStats.total === 0 ? (
                <p className="text-[13px] font-semibold text-muted-foreground/40">{isEn ? "Awaiting evaluation" : "평가 대기 중"}</p>
              ) : (
                <>
                  <p className={cn(
                    "text-[32px] font-black leading-none tabular-nums",
                    accuracyStats.dirAccuracy >= 60 ? "text-blue-600"
                    : accuracyStats.dirAccuracy >= 40 ? "text-amber-500"
                    : "text-red-500"
                  )}>
                    {accuracyStats.dirAccuracy.toFixed(0)}<span className="text-[14px] font-semibold text-muted-foreground ml-0.5">%</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5">{isEn ? `${accuracyStats.total} samples` : `${accuracyStats.total}건 기준`}</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 필터 + 정렬 바 ─────────────────────────────────────────────── */}
      {list.length > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />

          {/* Verdict 필터 */}
          {(["all", "buy", "sell", "hold", "reanalysis"] as VerdictFilter[]).map((v) => {
            const labels: Record<VerdictFilter, string> = isEn
              ? { all: "All", buy: "Buy", sell: "Sell", hold: "Hold", reanalysis: "Re-analyze" }
              : { all: "전체", buy: "상승여력", sell: "하락여지", hold: "적정수준", reanalysis: "재분석" };
            const active = verdictFilter === v;
            const isReanalysis = v === "reanalysis";
            return (
              <button
                key={v}
                onClick={() => setVerdictFilter(v)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors border",
                  active
                    ? isReanalysis
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-foreground text-background border-foreground"
                    : isReanalysis
                      ? "bg-background text-orange-600 dark:text-orange-400 border-orange-400 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                      : "bg-background text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground"
                )}
              >
                {labels[v]}
              </button>
            );
          })}

          {/* Divider */}
          <div className="w-px h-4 bg-muted mx-0.5" />

          {/* 정렬 드롭다운 */}
          <div className="relative">
            <button
              onClick={() => { setShowSortMenu(!showSortMenu); setShowIndustryMenu(false); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-background text-muted-foreground border border-border hover:border-foreground/40 hover:text-foreground transition-colors"
            >
              {sortLabels[sortBy]} <ChevronDown className="w-3 h-3" />
            </button>
            <AnimatePresence>
              {showSortMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.1 }}
                  className="absolute top-full mt-1 left-0 z-20 bg-background border border-border rounded-xl shadow-lg py-1 min-w-[130px]"
                >
                  {(Object.entries(sortLabels) as [SortKey, string][]).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => { setSortBy(k); setShowSortMenu(false); }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-[12px] hover:bg-muted/50 transition-colors",
                        sortBy === k ? "font-semibold text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>


          {/* 결과 카운트 */}
          {(verdictFilter !== "all" || industryFilter !== "all") && (
            <span className="text-[11px] text-muted-foreground ml-auto">
              {isEn ? `${filteredAndSorted.length} results` : `${filteredAndSorted.length}건`}
            </span>
          )}
        </div>
      )}

      {/* ── 리스트 ───────────────────────────────────────────────────────── */}
      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <Inbox className="w-10 h-10 text-muted-foreground/30" />
          <p className="text-[15px] font-medium text-muted-foreground">{isEn ? "No analyses yet" : "아직 분석한 기업이 없어요"}</p>
          <p className="text-[13px] text-muted-foreground/50">{isEn ? "Search for a company to start your first analysis" : "AI 기업분석 메뉴에서 종목을 검색해 분석을 시작해보세요"}</p>
          <button
            onClick={() => setLocation("/analysis/new")}
            className="mt-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-colors"
            style={{ backgroundColor: "#FF8A7A" }}
          >
            {isEn ? "Start Analysis" : "분석 시작하기"}
          </button>
        </div>
      ) : filteredAndSorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <p className="text-[14px] font-medium text-muted-foreground">{isEn ? "No items match the filter" : "필터 조건에 맞는 항목이 없어요"}</p>
          <button onClick={() => { setVerdictFilter("all"); setIndustryFilter("all"); }} className="text-[12px] text-blue-500 hover:underline">
            {isEn ? "Reset Filters" : "필터 초기화"}
          </button>
        </div>
      ) : (
        <div className="space-y-2" onClick={() => { setShowSortMenu(false); setShowIndustryMenu(false); }}>
          <AnimatePresence initial={false}>
            {filteredAndSorted.map((a) => {
              const isConfirming = confirmId === a.id;
              const isThisDeleting = deletingId === a.id;
              const isLocalOnly = !serverIds.has(a.id);
              const sparkData = sparklines[a.ticker];
              const q = quotes[a.ticker];
              const cur = q?.price ?? null;
              const reanalysisLevel = getReanalysisLevel(a.createdAt, a.startPrice ?? a.entryPrice, cur);

              // ── 방향 배지 (카드 헤더에 표시) ────────────────────────────
              const directionBadge = (() => {
                const tgt = a.targetPrice;
                const entry = a.startPrice ?? a.entryPrice;
                if (!cur || !tgt) return null;
                const effectiveEntry = entry ?? cur;
                const isDownside = tgt < effectiveEntry;
                const exceeded = isDownside ? cur <= tgt : cur >= tgt;
                if (exceeded) return { label: isEn ? "🎯 Target Hit" : "🎯 목표 달성", cls: "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-400 dark:border-red-700" };
                const distNow  = Math.abs(cur - tgt);
                const distThen = entry != null ? Math.abs(entry - tgt) : null;
                if (distThen == null) return null;
                if (distNow < distThen) return { label: isEn ? "▲ Approaching" : "▲ 목표 접근", cls: "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-400 dark:border-red-700" };
                if (distNow > distThen) return { label: isEn ? "▼ Diverging" : "▼ 목표 이탈", cls: "bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border-blue-400 dark:border-blue-700" };
                return { label: isEn ? "— Flat" : "— 보합", cls: "bg-muted/50 text-muted-foreground border-border" };
              })();

              const verdictLeftBorder = (() => {
                const v = (a.investmentVerdict ?? "").toLowerCase();
                if (v.includes("buy")) return "border-l-red-500/50";
                if (v.includes("sell")) return "border-l-blue-400/50";
                if (v.includes("hold")) return "border-l-amber-400/50";
                return "";
              })();

              return (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: isThisDeleting ? 0.4 : 1, y: 0 }}
                  exit={{ opacity: 0, x: -24, transition: { duration: 0.22 } }}
                  transition={{ duration: 0.18 }}
                  className={cn(
                    "group relative flex flex-col px-5 py-4 rounded-xl border border-border/60 bg-card hover:bg-muted/30 transition-all cursor-pointer",
                    verdictLeftBorder && `border-l-2 ${verdictLeftBorder}`
                  )}
                  onClick={() => !isConfirming && !isThisDeleting && setLocation(`/analysis/${a.id}`)}
                >
                  {/* ── 상단 행: 로고 + 종목정보 + 버튼 ── */}
                  <div className="flex items-start gap-3">
                    {/* 회사 로고 + 상태 오버레이 */}
                    <div className="relative shrink-0">
                      <StockLogo ticker={a.ticker} companyName={a.companyName ?? a.ticker} size="sm" />
                      <span className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background flex items-center justify-center",
                        isThisDeleting ? "bg-muted" : a.status === "completed" ? "bg-green-500" : "bg-amber-400"
                      )}>
                        {isThisDeleting && <Loader2 className="w-2 h-2 animate-spin text-white" />}
                      </span>
                    </div>

                    {/* 종목명 + 배지 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[15px] font-semibold text-foreground truncate">
                          {isEn && (a as any).englishName ? (a as any).englishName : a.companyName}
                        </span>
                        <span className="text-[12px] text-muted-foreground font-mono">{a.ticker}</span>
                        {verdictBadge(a.investmentVerdict, isEn)}
                        {reanalysisLevel === "urgent" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-400 dark:border-red-700">
                            <AlertTriangle className="w-2.5 h-2.5" /> {isEn ? "Re-analyze Now" : "긴급 재분석"}
                          </span>
                        )}
                        {reanalysisLevel === "recommend" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300 border border-orange-400 dark:border-orange-700">
                            <RefreshCw className="w-2.5 h-2.5" /> {isEn ? "Re-analyze" : "재분석 추천"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        <span>{format(new Date(a.createdAt), "yyyy.MM.dd", { locale: ko })}</span>
                      </div>
                    </div>

                    {/* 삭제/이동 버튼 */}
                    <div className="shrink-0">
                      <AnimatePresence mode="wait">
                        {isConfirming ? (
                          <motion.div
                            key="confirm"
                            initial={{ opacity: 0, scale: 0.92 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.92 }}
                            transition={{ duration: 0.12 }}
                            className="flex items-center gap-1.5"
                            onClick={cancelConfirm}
                          >
                            <span className="text-[12px] text-muted-foreground mr-0.5">{isEn ? "Delete?" : "삭제할까요?"}</span>
                            <button onClick={(e) => confirmDelete(a.id, isLocalOnly, e)} className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-[11px] font-semibold hover:bg-red-600 transition-colors">{isEn ? "Delete" : "삭제"}</button>
                            <button onClick={cancelConfirm} className="px-2.5 py-1 rounded-lg bg-muted text-foreground/70 text-[11px] font-semibold hover:bg-muted transition-colors">{isEn ? "Cancel" : "취소"}</button>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="default"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.1 }}
                            className="flex items-center gap-2"
                          >
                            <button
                              onClick={(e) => handleDelete(a.id, e)}
                              className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                              title={isEn ? "Delete" : "삭제"}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                                const url = `${window.location.origin}${base}/analysis/${a.id}`;
                                try { await navigator.clipboard.writeText(url); } catch {}
                                setCopiedId(a.id);
                                setTimeout(() => setCopiedId((prev) => prev === a.id ? null : prev), 1800);
                              }}
                              className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-primary hover:bg-primary/10 transition-all"
                              title={isEn ? "Copy link" : "링크 복사"}
                            >
                              {copiedId === a.id
                                ? <Check className="w-4 h-4 text-emerald-500" />
                                : <Share2 className="w-4 h-4" />
                              }
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* ── 하단: 풀너비 PriceTrack ── */}
                  {(() => {
                    const tgt = a.targetPrice;
                    const entry = a.startPrice ?? a.entryPrice;
                    const currency = q?.currency ?? (isUSTicker(a.ticker) ? "USD" : "KRW");
                    const dayChange = q?.change ?? null;

                    if (!cur || !tgt) {
                      if (tgt) return (
                        <div className="mt-3 flex items-stretch rounded-xl overflow-hidden border border-border text-center">
                          <div className="flex-1 px-2.5 py-2 bg-muted/50 border-r border-border">
                            <p className="text-[9px] text-muted-foreground mb-0.5">{isEn ? "At Analysis" : "분석 당시"}</p>
                            <p className="text-[12px] font-bold text-foreground/70 tabular-nums">
                              {entry != null ? formatCurrency(entry, currency, isEn) : <span className="text-muted-foreground/50">—</span>}
                            </p>
                          </div>
                          <div className="flex-1 px-2.5 py-2 bg-background border-r border-border">
                            <p className="text-[9px] text-muted-foreground mb-0.5">{isEn ? "Current" : "현재가"}</p>
                            <p className="text-[12px] font-bold text-muted-foreground/50">—</p>
                          </div>
                          <div className="flex-1 px-2.5 py-2 bg-background">
                            <p className="text-[9px] text-muted-foreground mb-0.5">{isEn ? "Target" : "적정주가"}</p>
                            <p className="text-[12px] font-bold text-foreground/80 tabular-nums">{formatCurrency(tgt, currency, isEn)}</p>
                          </div>
                        </div>
                      );
                      return null;
                    }

                    return (
                      <>
                        <PriceTrack
                          entry={entry ?? cur}
                          tgt={tgt}
                          cur={cur}
                          currency={currency}
                          isEn={isEn}
                        />
                        {dayChange != null && (
                          <p className={cn("text-[13px] font-bold text-right tabular-nums", dayChange >= 0 ? "text-red-500" : "text-blue-500")}>
                            {isEn ? "Today " : "오늘 "}{dayChange >= 0 ? "+" : ""}{dayChange.toFixed(2)}%
                          </p>
                        )}
                      </>
                    );
                  })()}

                  {/* 기간별 성과 트래킹 */}
                  <PerformanceBadges analysisDate={a.createdAt} perf={perf[a.id]} isEn={isEn} />

                  {/* ⑮ Hover card preview */}
                  {a.status === "completed" && (a.targetPrice || a.entryPrice || a.stopLoss) && (
                    <div className="mt-2 overflow-hidden max-h-0 group-hover:max-h-24 transition-all duration-200 ease-in-out">
                      <div className="pt-2 border-t border-border/60 flex items-center gap-3 flex-wrap">
                        {a.targetPrice && (
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                            <span className="text-[10px] text-muted-foreground/60">{isEn ? "Target" : "적정주가"}</span>
                            <span className="text-[11px] font-mono font-bold text-foreground/80">
                              {formatCurrency(a.targetPrice, isUSTicker(a.ticker) ? "USD" : "KRW", isEn)}
                            </span>
                          </div>
                        )}
                        {a.entryPrice && (
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                            <span className="text-[10px] text-muted-foreground/60">{isEn ? "Entry" : "진입가"}</span>
                            <span className="text-[11px] font-mono font-bold text-foreground/80">
                              {formatCurrency(a.entryPrice, isUSTicker(a.ticker) ? "USD" : "KRW", isEn)}
                            </span>
                          </div>
                        )}
                        {a.stopLoss && (
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                            <span className="text-[10px] text-muted-foreground/60">{isEn ? "Stop Loss" : "손절가"}</span>
                            <span className="text-[11px] font-mono font-bold text-destructive/80">
                              {formatCurrency(a.stopLoss, isUSTicker(a.ticker) ? "USD" : "KRW", isEn)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Memo */}
                  <MemoInline id={a.id} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
