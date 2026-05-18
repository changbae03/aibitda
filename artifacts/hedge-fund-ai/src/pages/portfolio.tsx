import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Plus, Trash2, TrendingUp,
  ChevronDown, ChevronUp, ChevronRight, RefreshCw,
  ShieldAlert, ExternalLink,
  Briefcase, PencilLine, Check, X as XIcon,
  Search, Building2, ArrowUpRight, ArrowDownRight,
  Zap, AlertTriangle, Bell, Brain, PieChart,
  Activity, Target, Lightbulb, ChevronsRight,
  Newspaper, Clock, Compass, Users,
  Sparkles, TrendingDown, CheckCircle2, MoveRight, ArrowRight,
} from "lucide-react";
import { cn, getApiUrl, formatCurrency, isUSTicker } from "@/lib/utils";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

// ── 타입 ────────────────────────────────────────────────────────────────────
interface AnalysisSummary {
  id: number;
  targetPrice: number | null;
  collectiveTargetPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  verdict: string;
  qaScore: number | null;
  createdAt: string;
  riskRewardRatio: number | null;
  upsidePct: number | null;
  collectiveUpsidePct: number | null;
  catalysts: string | null;
  risks: string | null;
  strategy: string | null;
  industry: string | null;
}

interface Holding {
  id: number;
  ticker: string;
  companyName: string;
  avgPrice: number | null;
  quantity: number | null;
  currency: string;
  note: string | null;
  addedAt: string;
  currentPrice: number | null;
  change1d: number | null;
  priceCurrency: string;
  returnPct: number | null;
  analysis: AnalysisSummary | null;
}

// ── 포트폴리오 전체 리뷰 결과 타입 ─────────────────────────────────────────
interface StockUpdate {
  ticker: string;
  companyName: string;
  sentiment: "bullish" | "neutral" | "bearish";
  thesisStatus: "유효" | "일부변화" | "훼손";
  keyEvent: string;
  update: string;
}
interface SectorRecommendation {
  sector: string;
  reason: string;
  exampleTickers: string[];
}
interface PortfolioReviewResult {
  stockUpdates: StockUpdate[];
  portfolioView: string;
  concentration: string;
  rebalancing: string;
  sectorRecommendations: SectorRecommendation[];
  generatedAt: string;
}

// ── 판정 헬퍼 ───────────────────────────────────────────────────────────────
const VERDICT_KO: Record<string, string> = {
  "Strong Buy":  "높은 상승여력",
  "Buy":         "상승여력",
  "Hold":        "적정 수준",
  "Sell":        "하락여지",
  "Strong Sell": "높은 하락여지",
};

function verdictColor(v: string) {
  if (v === "Strong Buy")  return "text-emerald-600 dark:text-emerald-400";
  if (v === "Buy")         return "text-green-600 dark:text-green-400";
  if (v === "Hold")        return "text-amber-600 dark:text-amber-400";
  if (v === "Sell")        return "text-red-500 dark:text-red-400";
  if (v === "Strong Sell") return "text-red-600 dark:text-red-500";
  return "text-muted-foreground";
}

function verdictBg(v: string) {
  if (v === "Strong Buy")  return "bg-emerald-500/10 border-emerald-500/20";
  if (v === "Buy")         return "bg-green-500/10 border-green-500/20";
  if (v === "Hold")        return "bg-amber-500/10 border-amber-500/20";
  if (v === "Sell")        return "bg-red-400/10 border-red-400/20";
  if (v === "Strong Sell") return "bg-red-600/10 border-red-600/20";
  return "bg-muted/40 border-border";
}

function isKRTicker(t: string) { return /^\d{5,6}/.test(t.split(".")[0]); }

function fmtPrice(price: number, currency: string) {
  if (currency === "KRW") return `${price.toLocaleString("ko-KR")}원`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(pct: number | null, showPlus = true) {
  if (pct == null) return null;
  const sign = pct > 0 && showPlus ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

// ── 검색 결과 타입 ────────────────────────────────────────────────────────────
interface SearchResult {
  symbol: string;
  shortname: string;
  exchange: string;
  quoteType: string;
}

function isKorean(t: string) { return /[ㄱ-ㅎ가-힣]/.test(t); }

// ── 종목 추가 다이얼로그 — 검색 자동완성 ────────────────────────────────────
interface AddDialogProps { onClose: () => void; onAdded: () => void; }

function AddDialog({ onClose, onAdded }: AddDialogProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposing = useRef(false);

  // 자동완성 검색
  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim()) { setSuggestions([]); return; }
    setIsSearching(true);
    try {
      const r = await fetch(getApiUrl(`/api/market-data/search/${encodeURIComponent(q)}`));
      const data: SearchResult[] = await r.json();
      setSuggestions(data);
      setSelectedIndex(-1);
    } catch {
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = query.trim();
    const isKo = isKorean(t);
    const isDigit = /^\d{2,}$/.test(t);
    const isEn = /^[A-Za-z0-9\-\. ]{2,}$/.test(t);
    if (!isKo && !isDigit && !isEn) { setSuggestions([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchSuggestions(t), isDigit ? 150 : 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, fetchSuggestions]);

  // 종목 선택 → 즉시 추가
  async function addTicker(symbol: string, name: string) {
    // 한국 종목: .KS/.KQ 제거
    const cleanTicker = /^\d{6}\.(KS|KQ)$/.test(symbol.toUpperCase())
      ? symbol.split(".")[0]
      : symbol.toUpperCase();
    const currency = /^\d{5,6}$/.test(cleanTicker) ? "KRW" : "USD";

    setAdding(true); setError(null);
    try {
      const r = await fetch(getApiUrl("/api/portfolio"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: cleanTicker, companyName: name, currency }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "추가 실패"); }
      onAdded();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "추가 실패");
      setAdding(false);
    }
  }

  // 키보드 내비게이션
  function handleKeyDown(e: React.KeyboardEvent) {
    if (isComposing.current) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, -1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        const s = suggestions[selectedIndex];
        addTicker(s.symbol, s.shortname);
      }
    }
    else if (e.key === "Escape") onClose();
  }

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
          <Briefcase className="w-4 h-4 text-primary shrink-0" />
          <p className="text-sm font-semibold text-foreground flex-1">포트폴리오에 종목 추가</p>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* 검색 입력 */}
        <div className="px-4 pt-4 pb-2">
          <div className="relative flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
            {isSearching
              ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
              : <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            }
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              placeholder="종목명 또는 코드 검색 (예: 삼성전자, AAPL)"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposing.current = true; }}
              onCompositionEnd={() => { isComposing.current = false; }}
              autoComplete="off"
            />
            {query && (
              <button onClick={() => { setQuery(""); setSuggestions([]); inputRef.current?.focus(); }} className="text-muted-foreground hover:text-foreground">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 오류 */}
        {error && (
          <p className="mx-4 mb-2 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
        )}

        {/* 검색 결과 목록 */}
        <div ref={dropdownRef} className="max-h-72 overflow-y-auto pb-2">
          {adding ? (
            <div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> 추가 중...
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((s, i) => {
              const isKrStock = /\.(KS|KQ)$/.test(s.symbol);
              const code = isKrStock ? s.symbol.replace(/\.(KS|KQ)$/, "") : s.symbol;
              const ex = s.exchange;
              const badgeStyle =
                ex === "KOSPI"  ? "bg-blue-500/15 text-blue-400" :
                ex === "KOSDAQ" ? "bg-emerald-500/15 text-emerald-400" :
                ex === "NASDAQ" ? "bg-violet-500/15 text-violet-400" :
                ex === "NYSE"   ? "bg-orange-500/15 text-orange-400" :
                "bg-muted/60 text-muted-foreground";
              const badgeLabel =
                ex === "KOSPI" ? "코스피" :
                ex === "KOSDAQ" ? "코스닥" :
                ex || "US";
              const isHighlighted = i === selectedIndex;
              return (
                <button
                  key={s.symbol}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(i)}
                  onMouseDown={e => { e.preventDefault(); addTicker(s.symbol, s.shortname); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border/40 last:border-0",
                    isHighlighted ? "bg-muted/60" : "hover:bg-muted/30"
                  )}
                >
                  <div className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                    isHighlighted ? "bg-primary/15" : "bg-muted/60"
                  )}>
                    <Building2 className={cn("w-4 h-4 transition-colors", isHighlighted ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-foreground truncate">{s.shortname}</span>
                      <span className={cn("shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full", badgeStyle)}>
                        {badgeLabel}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{code}</span>
                  </div>
                  <Plus className="w-4 h-4 text-primary shrink-0 opacity-0 group-hover:opacity-100" />
                </button>
              );
            })
          ) : query.trim().length >= 2 && !isSearching ? (
            <div className="text-center py-10 text-sm text-muted-foreground">검색 결과가 없어요</div>
          ) : query.trim().length < 2 ? (
            <div className="text-center py-10 text-[13px] text-muted-foreground">
              종목명이나 코드를 입력하세요
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}

// ── 인라인 편집 (평단가/수량) ─────────────────────────────────────────────────
function InlineEdit({
  holdingId, avgPrice, quantity, note, onSaved,
}: { holdingId: number; avgPrice: number | null; quantity: number | null; note: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [ap, setAp] = useState(avgPrice?.toString() ?? "");
  const [qty, setQty] = useState(quantity?.toString() ?? "");
  const [nt, setNt] = useState(note ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await fetch(getApiUrl(`/api/portfolio/${holdingId}`), {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avgPrice: ap ? parseFloat(ap) : null,
          quantity: qty ? parseFloat(qty) : null,
          note: nt || null,
        }),
      });
      onSaved();
      setEditing(false);
    } finally { setSaving(false); }
  }

  if (!editing) return (
    <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="수정">
      <PencilLine className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input type="number" placeholder="평단가" className="w-24 px-2 py-1 text-xs rounded bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground" value={ap} onChange={e => setAp(e.target.value)} />
      <input type="number" placeholder="수량" className="w-16 px-2 py-1 text-xs rounded bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground" value={qty} onChange={e => setQty(e.target.value)} />
      <input placeholder="메모" className="w-32 px-2 py-1 text-xs rounded bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground" value={nt} onChange={e => setNt(e.target.value)} />
      <button onClick={save} disabled={saving} className="p-1 rounded hover:bg-muted text-green-400">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      </button>
      <button onClick={() => setEditing(false)} className="p-1 rounded hover:bg-muted text-muted-foreground"><XIcon className="w-3.5 h-3.5" /></button>
    </div>
  );
}


// ── 변화 감지 타입 ────────────────────────────────────────────────────────────
interface ChangeItem {
  type: "verdict" | "target_price" | "catalyst" | "risk";
  label: string;
  detail: string;
  direction: "up" | "down" | "neutral";
}
interface ChangesResult {
  hasChanges: boolean;
  analysisCount: number;
  latestDate?: string;
  prevDate?: string;
  changes: ChangeItem[];
}

interface DailyBrief {
  summary: string;
  date: string;
  cached: boolean;
  source?: "analysis" | "ai";
  contributorCount?: number;
  analysisDate?: string | null;
}

/** analysis_steps content가 JSON 문자열일 수 있어 파싱 후 읽기 좋은 텍스트 추출 */
function cleanStepText(raw: string | null | undefined, maxLen = 400): string {
  if (!raw) return "";
  let s = raw.trim();

  // 코드 펜스 제거: ```json ... ``` 또는 ``` ... ```
  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) s = fenceMatch[1].trim();

  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === "object") {
        // summary > key_issue > description 순서로 가장 의미 있는 텍스트 추출
        for (const key of ["summary", "key_issue", "description", "content", "text", "analysis"]) {
          if (typeof obj[key] === "string" && obj[key].length > 20)
            return obj[key].replace(/\*\*/g, "").replace(/\\n/g, "\n").slice(0, maxLen);
        }
        // 그래도 없으면 긴 문자열 값들을 이어붙임
        const parts = Object.values(obj)
          .filter((v): v is string => typeof v === "string" && v.length > 20)
          .join("\n");
        if (parts) return parts.replace(/\*\*/g, "").slice(0, maxLen);
      }
    } catch { /* JSON 파싱 실패 — 아래 일반 처리로 */ }
  }
  return s.replace(/^#{1,4}\s*/gm, "").replace(/\*\*/g, "").slice(0, maxLen);
}

/** 섹션 텍스트에 JSON/코드펜스가 섞여 있을 때 읽기 좋은 텍스트로 정제 */
function cleanSectionText(raw: string): string {
  if (!raw) return raw;
  // 코드펜스 제거
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // FINAL_VALUATION_DATA / VALUATION_DATA 메타 블록 제거 (JSON 파싱 방해 요소)
  s = s
    .replace(/FINAL_VALUATION_DATA:\s*\{[^\n]*\}/g, "")
    .replace(/VALUATION_DATA:\s*\{[^\n]*\}/g, "")
    .replace(/CHART_DATA:\s*\[[^\n]*\]/g, "")
    .replace(/EVENTS_DATA:\s*\[[^\n]*\]/g, "")
    .trim();

  // 첫 번째 { 위치에서 중괄호 카운팅으로 매칭되는 } 까지 JSON 블록 추출
  const start = s.indexOf("{");
  if (start !== -1) {
    let depth = 0, end = -1;
    for (let i = start; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      try {
        const obj = JSON.parse(s.slice(start, end + 1));
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const key of ["summary", "key_issue", "description", "content", "text", "analysis"]) {
            if (typeof obj[key] === "string" && obj[key].length > 20)
              return (obj[key] as string).replace(/\\n/g, "\n");
          }
          const parts = Object.values(obj)
            .filter((v): v is string => typeof v === "string" && v.length > 20)
            .join("\n");
          if (parts) return parts;
        }
      } catch { /* JSON 파싱 실패 → 정규식 fallback */ }
    }

    // 정규식으로 summary / key_issue 필드 직접 추출
    const mSummary = s.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (mSummary) return mSummary[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    const mIssue = s.match(/"key_issue"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (mIssue) return mIssue[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }

  return s;
}

function parseBrief(summary: string) {
  type Icon = "core" | "risk" | "catalyst";
  const sections: { label: string; icon: Icon; text: string }[] = [];

  // 태그 기반 분할 — [오늘의핵심] [리스크] [투자포인트] (구: 투자아이디어, 촉매)
  const tagRe = /\[(오늘의핵심|리스크|투자포인트|투자아이디어|촉매)\]/g;
  const parts: { tag: string; text: string }[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(summary)) !== null) {
    if (parts.length > 0) parts[parts.length - 1].text = summary.slice(lastIdx, m.index).trim();
    parts.push({ tag: m[1], text: "" });
    lastIdx = m.index + m[0].length;
  }
  if (parts.length > 0) parts[parts.length - 1].text = summary.slice(lastIdx).trim();

  for (const { tag, text } of parts) {
    const clean = cleanSectionText(text);
    if (!clean) continue;
    if (tag === "오늘의핵심")  sections.push({ label: "오늘의 핵심", icon: "core",     text: clean });
    else if (tag === "리스크") sections.push({ label: "리스크",     icon: "risk",     text: clean });
    else                       sections.push({ label: "투자 포인트", icon: "catalyst", text: clean });
  }

  return sections.length > 0 ? sections : [{ label: "브리핑", icon: "core" as const, text: cleanSectionText(summary) }];
}

// ── 보유 종목 카드 ────────────────────────────────────────────────────────────
function HoldingCard({ holding, onDelete, onRefresh }: { holding: Holding; onDelete: (id: number) => void; onRefresh: () => void }) {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmNewReport, setConfirmNewReport] = useState(false);
  const [changes, setChanges] = useState<ChangesResult | null>(null);
  const [changesExpanded, setChangesExpanded] = useState(false);
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [briefExpanded, setBriefExpanded] = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);

  const a = holding.analysis;

  useEffect(() => {
    fetch(getApiUrl(`/api/portfolio/changes/${encodeURIComponent(holding.ticker)}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setChanges(d); })
      .catch(() => {});
  }, [holding.ticker]);

  // 마운트 시 브리핑 자동 로드 — 분석이 없으면 fetch 자체를 생략
  useEffect(() => {
    if (!holding.analysis) return;
    setBriefLoading(true);
    fetch(getApiUrl(`/api/portfolio/brief/${encodeURIComponent(holding.ticker)}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.summary) setBrief(d); })
      .catch(() => {})
      .finally(() => setBriefLoading(false));
  }, [holding.ticker, holding.analysis]);

  async function refreshBrief() {
    setBriefLoading(true);
    setBrief(null);
    try {
      const r = await fetch(getApiUrl(`/api/portfolio/brief/${encodeURIComponent(holding.ticker)}?force=true`), { credentials: "include" });
      const d = r.ok ? await r.json() : null;
      if (d?.summary) setBrief(d);
    } catch {}
    setBriefLoading(false);
  }

  async function handleDelete() {
    if (!confirm(`${holding.ticker}를 포트폴리오에서 제거할까요?`)) return;
    setDeleting(true);
    await fetch(getApiUrl(`/api/portfolio/${holding.id}`), { method: "DELETE", credentials: "include" });
    onDelete(holding.id);
  }

  const changeColor = holding.change1d == null ? "text-muted-foreground"
    : holding.change1d > 0 ? "text-emerald-400"
    : holding.change1d < 0 ? "text-red-400"
    : "text-muted-foreground";

  // 진행 바에 쓸 "대표" 목표가 — 내 분석 우선, 없으면 집단지성
  const barTarget = a?.targetPrice ?? a?.collectiveTargetPrice ?? null;
  // 현재가 vs 목표가 진행 바 (0~200% 범위에서 100% = 목표가)
  const priceBarPct = (() => {
    if (!holding.currentPrice || !barTarget) return null;
    const lo = Math.min(holding.currentPrice, barTarget) * 0.85;
    const hi = Math.max(holding.currentPrice, barTarget) * 1.05;
    return Math.round(((holding.currentPrice - lo) / (hi - lo)) * 100);
  })();
  const targetBarPct = (() => {
    if (!holding.currentPrice || !barTarget) return null;
    const lo = Math.min(holding.currentPrice, barTarget) * 0.85;
    const hi = Math.max(holding.currentPrice, barTarget) * 1.05;
    return Math.round(((barTarget - lo) / (hi - lo)) * 100);
  })();

  // 종목 이니셜 배지 색상 — 회사명 첫 글자 기준으로 고정 색상
  const BADGE_COLORS = [
    "bg-rose-500/20 text-rose-300",
    "bg-orange-500/20 text-orange-300",
    "bg-amber-500/20 text-amber-300",
    "bg-emerald-500/20 text-emerald-300",
    "bg-cyan-500/20 text-cyan-300",
    "bg-blue-500/20 text-blue-300",
    "bg-violet-500/20 text-violet-300",
    "bg-pink-500/20 text-pink-300",
  ];
  const badgeColorClass = BADGE_COLORS[(holding.companyName.charCodeAt(0) ?? 0) % BADGE_COLORS.length];
  const initial = holding.companyName.charAt(0) || holding.ticker.charAt(0);
  const [logoErr, setLogoErr] = useState(false);
  const rawTicker = holding.ticker.replace(/\.(KS|KQ|KN)$/i, "");
  const logoUrl = isUSTicker(holding.ticker)
    ? `https://file.alphasquare.co.kr/media/images/stock_logo/us/${rawTicker}.png`
    : `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${rawTicker.padStart(6, "0")}.png`;

  return (
    <>
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl border border-border bg-card overflow-hidden"
    >
      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          {/* 회사 로고 */}
          <div className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center text-[18px] font-bold shrink-0 overflow-hidden",
            logoErr ? badgeColorClass : "bg-muted/60 border border-border"
          )}>
            {!logoErr ? (
              <img
                src={logoUrl}
                alt={holding.companyName}
                className="w-full h-full object-contain p-1"
                onError={() => setLogoErr(true)}
              />
            ) : initial}
          </div>

          {/* 종목 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-foreground leading-tight truncate">
                  {holding.companyName}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="font-mono text-[11px] text-muted-foreground/60">{holding.ticker}</span>
                  {a?.industry && (
                    <span className="text-[10px] text-muted-foreground/50">· {a.industry}</span>
                  )}
                </div>
              </div>
              {/* 편집 · 삭제 */}
              <div className="flex items-center gap-0.5 shrink-0">
                <InlineEdit
                  holdingId={holding.id}
                  avgPrice={holding.avgPrice}
                  quantity={holding.quantity}
                  note={holding.note}
                  onSaved={onRefresh}
                />
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors"
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            {/* 판정 배지 */}
            {a && (
              <div className="mt-1.5">
                <span className={cn(
                  "inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-semibold",
                  verdictBg(a.verdict), verdictColor(a.verdict)
                )}>
                  {VERDICT_KO[a.verdict] ?? a.verdict}
                </span>
                {holding.note && (
                  <span className="ml-2 text-[11px] text-muted-foreground/50 truncate">{holding.note}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 현재가 · 적정주가 ───────────────────────────────── */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {/* 현재가 */}
          <div className="rounded-xl bg-muted/20 border border-border/60 px-3 py-2.5">
            <p className="text-[10px] text-muted-foreground mb-1">현재가</p>
            {holding.currentPrice != null ? (
              <>
                <p className="text-[18px] font-bold text-foreground tabular-nums leading-none">
                  {fmtPrice(holding.currentPrice, holding.priceCurrency)}
                </p>
                {holding.change1d != null && (
                  <p className={cn("text-[11px] tabular-nums mt-1 font-medium", changeColor)}>
                    {holding.change1d > 0 ? "▲" : holding.change1d < 0 ? "▼" : ""} {fmtPct(Math.abs(holding.change1d))} 오늘
                  </p>
                )}
              </>
            ) : (
              <p className="text-[15px] text-muted-foreground/40 mt-1">—</p>
            )}
          </div>

          {/* AI 적정주가 — 내 분석 + 집단지성 */}
          {(() => {
            const myTP = a?.targetPrice ?? null;
            const colTP = a?.collectiveTargetPrice ?? null;
            const hasBoth = myTP != null && colTP != null;
            // 대표 upside (카드 배경색 판단용)
            const primaryUpside = a?.upsidePct ?? null;
            const bgCls = primaryUpside != null && primaryUpside > 0
              ? "bg-emerald-500/5 border-emerald-500/20"
              : primaryUpside != null && primaryUpside < 0
              ? "bg-red-500/5 border-red-500/20"
              : "bg-muted/20 border-border/60";

            return (
              <div className={cn("rounded-xl border px-3 py-2.5", bgCls)}>
                <p className="text-[10px] text-muted-foreground mb-1.5">AI 적정주가</p>

                {hasBoth ? (
                  /* ── 두 목표가 나란히 표시 ── */
                  <div className="grid grid-cols-2 gap-x-2">
                    {/* 내 분석 */}
                    <div>
                      <p className="text-[9px] text-muted-foreground/60 mb-0.5">내 분석</p>
                      <p className="text-[15px] font-bold tabular-nums leading-none text-foreground">
                        {fmtPrice(myTP!, holding.priceCurrency)}
                      </p>
                      {a!.upsidePct != null && (
                        <p className={cn("text-[10px] tabular-nums mt-0.5 font-semibold",
                          a!.upsidePct >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {a!.upsidePct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(a!.upsidePct))}
                        </p>
                      )}
                    </div>
                    {/* 멀티뷰 */}
                    <div>
                      <p className="text-[9px] text-muted-foreground/60 mb-0.5 flex items-center gap-0.5">
                        <Users className="w-2.5 h-2.5" />멀티뷰
                      </p>
                      <p className="text-[15px] font-bold tabular-nums leading-none text-foreground">
                        {fmtPrice(colTP!, holding.priceCurrency)}
                      </p>
                      {a!.collectiveUpsidePct != null && (
                        <p className={cn("text-[10px] tabular-nums mt-0.5 font-semibold",
                          a!.collectiveUpsidePct >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {a!.collectiveUpsidePct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(a!.collectiveUpsidePct))}
                        </p>
                      )}
                    </div>
                  </div>
                ) : myTP != null ? (
                  /* ── 내 분석만 있을 때 ── */
                  <>
                    <p className="text-[18px] font-bold text-foreground tabular-nums leading-none">
                      {fmtPrice(myTP, holding.priceCurrency)}
                    </p>
                    {a!.upsidePct != null && (
                      <p className={cn("text-[11px] tabular-nums mt-1 font-semibold",
                        a!.upsidePct >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {a!.upsidePct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(a!.upsidePct))} 여력
                      </p>
                    )}
                  </>
                ) : colTP != null ? (
                  /* ── 멀티뷰만 있을 때 ── */
                  <>
                    <p className="text-[9px] text-muted-foreground/60 -mt-0.5 mb-0.5 flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" />멀티뷰
                    </p>
                    <p className="text-[18px] font-bold text-foreground tabular-nums leading-none">
                      {fmtPrice(colTP, holding.priceCurrency)}
                    </p>
                    {a!.upsidePct != null && (
                      <p className={cn("text-[11px] tabular-nums mt-1 font-semibold",
                        a!.upsidePct >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {a!.upsidePct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(a!.upsidePct))} 여력
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[15px] text-muted-foreground/40 mt-1">—</p>
                )}
              </div>
            );
          })()}
        </div>

        {/* 현재가 vs 목표가 바 */}
        {priceBarPct != null && targetBarPct != null && (
          <div className="mt-2.5 px-0.5">
            <div className="relative h-1.5 bg-muted/40 rounded-full overflow-visible">
              {/* 목표가 위치 마커 */}
              <div
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 border-background z-10",
                  a?.upsidePct != null && a.upsidePct >= 0 ? "bg-emerald-400" : "bg-red-400"
                )}
                style={{ left: `clamp(0%, ${targetBarPct}%, 98%)` }}
              />
              {/* 현재가 위치 */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-foreground border-2 border-background z-20"
                style={{ left: `clamp(0%, ${priceBarPct}%, 98%)` }}
              />
              {/* 채워진 구간 */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary/30"
                style={{ width: `${priceBarPct}%` }}
              />
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-muted-foreground/50">현재가</span>
              <span className="text-[9px] text-muted-foreground/50">적정주가</span>
            </div>
          </div>
        )}
      </div>

      {/* ── 분석 없음 → 분석 유도 배너 ─────────────────────────── */}
      {!a && (
        <button
          onClick={() => setLocation(`/analysis/new?ticker=${holding.ticker}`)}
          className="mx-3 mb-3 w-[calc(100%-1.5rem)] flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
        >
          <Brain className="w-3.5 h-3.5 text-primary/60 shrink-0" />
          <span className="flex-1 text-[12px] text-primary/60">AI 분석을 요청하면 적정주가와 오늘의 이슈를 확인할 수 있어요</span>
          <ChevronRight className="w-3.5 h-3.5 text-primary/40 shrink-0" />
        </button>
      )}

      {/* ── AI 데일리 이슈 브리핑 (뉴스라인: 한 줄 + 확장) ─────── */}
      {a && (brief || briefLoading) && (() => {
        const sections = brief ? parseBrief(brief.summary) : [];
        const coreSection = sections.find(s => s.icon === "core");
        const detailSections = sections.filter(s => s.icon !== "core");
        const headlineText = coreSection?.text ?? (sections[0]?.text ?? "");
        return (
          <div className="mx-3 mb-3 rounded-xl border border-border bg-muted/30 overflow-hidden">
            {/* 한 줄 헤더 — 항상 보임 */}
            <button
              onClick={() => setBriefExpanded(v => !v)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
            >
              {briefLoading
                ? <Loader2 className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-spin" />
                : <Newspaper className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              }
              {briefLoading ? (
                <span className="flex-1 text-[12px] text-muted-foreground/50">브리핑 생성 중…</span>
              ) : (
                <p className={cn("flex-1 text-[12px] text-foreground/70 leading-snug min-w-0", !briefExpanded && "line-clamp-1")}>
                  {headlineText}
                </p>
              )}
              {/* 멀티뷰 배지 */}
              {brief && !briefLoading && brief.source === "analysis" && (brief.contributorCount ?? 0) > 0 && (
                <span className="shrink-0 flex items-center gap-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
                  <Users className="w-2.5 h-2.5" />{brief.contributorCount}
                </span>
              )}
              {brief && !briefLoading && (
                briefExpanded
                  ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              )}
            </button>

            {/* 확장: 촉매 + 리스크 상세 */}
            <AnimatePresence initial={false}>
              {briefExpanded && brief && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: "auto" }}
                  exit={{ height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-white/[0.06] px-3 pb-3 pt-2.5 space-y-2.5">
                    {/* 나머지 섹션 (촉매·리스크) */}
                    {detailSections.map((sec, i) => (
                      <div key={i} className="flex gap-2">
                        {sec.icon === "risk"     && <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
                        {sec.icon === "catalyst" && <Zap           className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />}
                        <div>
                          <p className={cn(
                            "text-[10px] font-bold uppercase tracking-wider mb-0.5",
                            sec.icon === "risk"     && "text-red-400/80",
                            sec.icon === "catalyst" && "text-emerald-400/80",
                          )}>{sec.label}</p>
                          <p className="text-[12px] text-foreground/70 leading-relaxed">{sec.text}</p>
                        </div>
                      </div>
                    ))}
                    {/* 푸터: 멀티뷰 출처 + 새로고침 */}
                    <div className="flex items-center justify-between pt-0.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
                        {brief.source === "analysis" ? (
                          <>
                            <Users className="w-2.5 h-2.5 text-emerald-400/60" />
                            <span className="text-emerald-400/60">
                              멀티뷰 기반
                              {(brief.contributorCount ?? 0) > 0 && ` · ${brief.contributorCount}명 분석`}
                            </span>
                            {brief.analysisDate && (
                              <span>· {brief.analysisDate}</span>
                            )}
                          </>
                        ) : (
                          <>
                            <Brain className="w-2.5 h-2.5" />
                            <span>AI 생성 · {brief.date}</span>
                          </>
                        )}
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); refreshBrief(); }}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        새로고침
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })()}

      {/* ── 하단 액션 바 ──────────────────────────────────────── */}
      <div className="border-t border-border/60 px-3 py-2 flex items-center gap-1.5">
        {/* 기존 보고서 보기 */}
        {a && (
          <button
            onClick={() => setLocation(`/analysis/${a.id}`)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span>보고서</span>
            <span className="text-muted-foreground/40 font-normal">
              {format(new Date(a.createdAt), "M/d", { locale: ko })}
            </span>
          </button>
        )}

        <div className="flex-1" />

        {/* 새 보고서 산출하기 */}
        <button
          onClick={() => setConfirmNewReport(true)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-primary/70 hover:text-primary hover:bg-primary/8 border border-transparent hover:border-primary/20 transition-colors"
          title="이 종목으로 새 보고서 산출"
        >
          <RefreshCw className="w-3 h-3 shrink-0" />
          <span>새 보고서</span>
        </button>

        {/* AI 리서치 요약 토글 */}
        {a && (
          <button
            onClick={() => setExpanded(v => !v)}
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] transition-colors",
              expanded
                ? "text-foreground bg-muted/60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            요약
          </button>
        )}
      </div>

      {/* ── 확장: AI 리서치 요약 ─────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && a && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/60 bg-muted/40 divide-y divide-border/40">
              {/* 분석 메타 */}
              <div className="px-4 py-3 flex items-center gap-3">
                <Brain className="w-4 h-4 text-primary shrink-0" />
                <div>
                  <p className="text-[11px] font-semibold text-foreground">AI 리서치 요약</p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(a.createdAt), "yyyy년 M월 d일", { locale: ko })} 분석
                    {a.qaScore != null && ` · 신뢰도 ${a.qaScore}점`}
                  </p>
                </div>
                <button
                  onClick={() => setLocation(`/analysis/${a.id}`)}
                  className="ml-auto text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  전체 보기 <ExternalLink className="w-2.5 h-2.5" />
                </button>
              </div>

              {/* 핵심 촉매 */}
              {a.catalysts && cleanStepText(a.catalysts) && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">핵심 촉매</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {cleanStepText(a.catalysts, 400)}
                  </p>
                </div>
              )}

              {/* 주요 리스크 */}
              {a.risks && cleanStepText(a.risks) && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">주요 리스크</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {cleanStepText(a.risks, 400)}
                  </p>
                </div>
              )}

              {/* 전략 요약 (촉매·리스크 없을 때) */}
              {!a.catalysts && !a.risks && a.strategy && cleanStepText(a.strategy) && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Target className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-bold text-primary/80 uppercase tracking-wider">투자 전략</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {cleanStepText(a.strategy, 500)}
                  </p>
                </div>
              )}

              {/* 분석 없을 때 */}
              {!a.catalysts && !a.risks && !a.strategy && (
                <div className="px-4 py-6 text-center">
                  <p className="text-[12px] text-muted-foreground mb-2">세부 분석 데이터가 없습니다</p>
                  <button
                    onClick={() => setLocation(`/analysis/new?ticker=${holding.ticker}`)}
                    className="text-[11px] text-primary hover:underline"
                  >새 분석 요청하기 →</button>
                </div>
              )}

              {/* 손절가 · 위험보상 - 작게 표시 */}
              {(a.stopLoss != null || a.riskRewardRatio != null) && (
                <div className="px-4 py-2.5 flex gap-4">
                  {a.stopLoss != null && (
                    <div>
                      <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">손절가</p>
                      <p className="text-[12px] font-medium text-foreground/70 tabular-nums">
                        {fmtPrice(a.stopLoss, holding.priceCurrency)}
                      </p>
                    </div>
                  )}
                  {a.riskRewardRatio != null && (
                    <div>
                      <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">위험보상</p>
                      <p className="text-[12px] font-medium text-foreground/70 tabular-nums">
                        1 : {a.riskRewardRatio.toFixed(1)}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>

    {/* ── 새 보고서 확인 모달 ── */}
    <AnimatePresence>
      {confirmNewReport && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmNewReport(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6"
          >
            {/* 헤더 */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest mb-0.5">AI 기업분석</p>
                <h3 className="text-[18px] font-black text-foreground leading-tight truncate">{holding.companyName}</h3>
                <p className="font-mono text-[11px] text-muted-foreground/50">{holding.ticker}</p>
              </div>
            </div>

            {/* 설명 */}
            <div className="rounded-xl bg-muted/60 px-4 py-3.5 mb-5 space-y-1">
              <p className="text-[13.5px] text-foreground/85 leading-relaxed">
                <span className="font-bold" style={{ color: "#FF8A7A" }}>애빛다의 AI 애널리스트 팀</span>이<br />
                7단계 심층 분석을 시작합니다.
              </p>
              <p className="text-[11.5px] text-muted-foreground">
                평균 3분 소요 · DCF·rNPV 등 밸류에이션 자동 선정
              </p>
            </div>

            {/* 버튼 */}
            <div className="flex gap-2.5">
              <button
                onClick={() => setConfirmNewReport(false)}
                className="flex-1 py-3 rounded-xl border border-border text-[14px] font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => { setConfirmNewReport(false); setLocation(`/analysis/new?ticker=${holding.ticker}`); }}
                className="flex-1 py-3 rounded-xl text-[14px] font-bold text-white transition-colors flex items-center justify-center gap-2"
                style={{ backgroundColor: "#FF8A7A" }}
              >
                분석 시작 <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}


// ── 포트폴리오 전체 리뷰 컴포넌트 ──────────────────────────────────────────
function PortfolioReview({ holdings }: { holdings: Holding[] }) {
  const [review, setReview] = useState<PortfolioReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function runReview() {
    setLoading(true);
    setError(null);
    setOpen(true);
    setReview(null);
    try {
      const r = await fetch(getApiUrl("/api/portfolio/review"), {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setError((err as any).error ?? "리뷰 생성 실패");
        setLoading(false);
        return;
      }
      const d = await r.json() as PortfolioReviewResult;
      setReview(d);
    } catch {
      setError("네트워크 오류가 발생했습니다");
    }
    setLoading(false);
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">AI 포트폴리오 전체 리뷰</p>
          <p className="text-[11px] text-muted-foreground">
            종목별 최신 뉴스 수집 → thesis 점검 → 포트폴리오 종합 판단
          </p>
        </div>
        <button
          onClick={runReview}
          disabled={loading}
          className={cn(
            "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors",
            loading
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          )}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {loading ? "분석 중…" : "리뷰 시작"}
          {!loading && <span className="text-[10px] text-amber-400/60 font-normal">크레딧 1</span>}
        </button>
      </div>

      {/* 결과 패널 */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="border-t border-amber-500/15 bg-amber-500/[0.03]">
              {/* 로딩 */}
              {loading && (
                <div className="px-4 py-5 space-y-1.5">
                  <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground/60">
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                    종목별 최신 뉴스 수집 &amp; thesis 점검 중…
                  </div>
                  <p className="text-[11px] text-muted-foreground/40 pl-6">
                    보유 {holdings.length}개 종목 뉴스를 가져오고 있습니다. 잠시 기다려 주세요.
                  </p>
                </div>
              )}

              {/* 에러 */}
              {error && !loading && (
                <div className="px-4 py-4 flex items-center gap-2 text-[12px] text-red-400/80">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* 결과 */}
              {review && !loading && (
                <div className="divide-y divide-border/20">

                  {/* ① 종목별 뉴스 & thesis 점검 */}
                  <div className="px-4 pt-3 pb-2">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Newspaper className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">종목별 뉴스 & Thesis 점검</span>
                    </div>
                    <div className="space-y-4">
                      {review.stockUpdates.map(s => {
                        const sentimentCfg = s.sentiment === "bullish"
                          ? { label: "강세", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" }
                          : s.sentiment === "bearish"
                          ? { label: "약세", cls: "bg-red-500/10 text-red-400 border-red-500/20" }
                          : { label: "중립", cls: "bg-muted text-muted-foreground border-border/40" };
                        const thesisCfg = s.thesisStatus === "훼손"
                          ? { cls: "bg-red-500/10 text-red-400 border-red-500/20" }
                          : s.thesisStatus === "일부변화"
                          ? { cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" }
                          : { cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
                        return (
                          <div key={s.ticker} className="rounded-xl border border-border/30 bg-background/30 overflow-hidden">
                            {/* 헤더 */}
                            <div className="px-3 py-2 flex items-center gap-2 border-b border-border/20">
                              <div className="flex-1 min-w-0">
                                <span className="text-[12px] font-semibold text-foreground/90">{s.companyName}</span>
                                <span className="ml-1.5 text-[10px] text-muted-foreground/50">{s.ticker}</span>
                              </div>
                              <span className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-semibold border", sentimentCfg.cls)}>
                                {sentimentCfg.label}
                              </span>
                              <span className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-medium border", thesisCfg.cls)}>
                                thesis {s.thesisStatus}
                              </span>
                            </div>
                            {/* 핵심 이벤트 */}
                            {s.keyEvent && (
                              <div className="px-3 py-1.5 bg-sky-500/[0.04] border-b border-sky-500/10 flex items-start gap-1.5">
                                <Bell className="w-3 h-3 text-sky-400 shrink-0 mt-0.5" />
                                <p className="text-[11px] text-sky-300/80 leading-snug">{s.keyEvent}</p>
                              </div>
                            )}
                            {/* 상세 업데이트 */}
                            <div className="px-3 py-2">
                              <p className="text-[12px] text-foreground/70 leading-relaxed">{s.update}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ② 포트폴리오 종합 평가 */}
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">포트폴리오 종합 평가</span>
                    </div>
                    <p className="text-[12px] text-foreground/75 leading-relaxed">{review.portfolioView}</p>
                  </div>

                  {/* ③ 집중도 & 분산 */}
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <PieChart className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">집중도 & 분산 리스크</span>
                    </div>
                    <p className="text-[12px] text-foreground/75 leading-relaxed">{review.concentration}</p>
                  </div>

                  {/* ④ 리밸런싱 & 행동 제안 */}
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <MoveRight className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-[10px] font-bold text-primary/80 uppercase tracking-wider">리밸런싱 & 행동 제안</span>
                    </div>
                    <p className="text-[12px] text-foreground/75 leading-relaxed">{review.rebalancing}</p>
                  </div>

                  {/* ⑤ 미보유 섹터 추천 */}
                  {review.sectorRecommendations.length > 0 && (
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-3">
                        <Lightbulb className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                        <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">포트폴리오 보완 섹터 추천</span>
                      </div>
                      <div className="space-y-2.5">
                        {review.sectorRecommendations.map((rec, i) => (
                          <div key={i} className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] p-3">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-[12px] font-bold text-violet-300">{rec.sector}</span>
                              {rec.exampleTickers.length > 0 && (
                                <div className="flex gap-1 flex-wrap">
                                  {rec.exampleTickers.map((t, j) => (
                                    <span key={j} className="px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-[10px] text-violet-400 font-medium">
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <p className="text-[12px] text-foreground/70 leading-relaxed">{rec.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 푸터 */}
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                      <Brain className="w-2.5 h-2.5" />
                      Gemini AI · 실시간 뉴스 기반 · {new Date(review.generatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 생성
                    </span>
                    <button
                      onClick={runReview}
                      disabled={loading}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-amber-400 transition-colors"
                    >
                      <RefreshCw className="w-2.5 h-2.5" />
                      다시 실행 (-1 크레딧)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 포트폴리오 히어로 배너 (삼쩜삼 스타일) ────────────────────────────────────
function heroRelativeTime(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60)  return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return format(date, "HH:mm");
}

function PortfolioHero({
  holdings, lastPriceUpdate, priceUpdating, onAdd,
}: {
  holdings: Holding[];
  lastPriceUpdate: Date | null;
  priceUpdating: boolean;
  onAdd: () => void;
}) {
  const withUpside    = holdings.filter(h => h.analysis?.upsidePct != null);
  const avgUpside     = withUpside.length > 0
    ? withUpside.reduce((s, h) => s + (h.analysis!.upsidePct!), 0) / withUpside.length
    : null;
  const hasPositive   = avgUpside != null && avgUpside > 0;
  const analysedCount = holdings.filter(h => h.analysis).length;
  const analysedPct   = holdings.length > 0 ? (analysedCount / holdings.length) * 100 : 0;

  // Buy / Hold / Sell 분포
  const buyCount  = holdings.filter(h => /buy/i.test(h.analysis?.verdict ?? "")).length;
  const holdCount = holdings.filter(h => /hold/i.test(h.analysis?.verdict ?? "")).length;
  const sellCount = holdings.filter(h => /sell/i.test(h.analysis?.verdict ?? "")).length;

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      {/* 상단: 주요 수치 */}
      <div className="px-5 pt-5 pb-4">
        <p className="text-[12px] text-muted-foreground mb-1">내 포트폴리오</p>
        <div className="flex items-end gap-3">
          <div>
            <span className="text-[40px] font-bold text-foreground tabular-nums leading-none">
              {holdings.length}
            </span>
            <span className="text-[16px] text-muted-foreground ml-1.5">개 종목</span>
          </div>
          {avgUpside != null && (
            <div className={cn(
              "mb-1.5 flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-semibold",
              hasPositive ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            )}>
              {hasPositive ? "▲" : "▼"} 평균 {Math.abs(avgUpside).toFixed(1)}% 여력
            </div>
          )}
        </div>

        {/* 구분선 */}
        <div className="mt-4 pt-4 border-t border-border/40 grid grid-cols-3 gap-0">
          {/* AI 판정 분포 */}
          <div className="pr-4">
            <p className="text-[11px] text-muted-foreground mb-2">AI 판정</p>
            <div className="flex items-center gap-1.5">
              {buyCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />{buyCount}매수
                </span>
              )}
              {holdCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />{holdCount}홀드
                </span>
              )}
              {sellCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-red-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />{sellCount}매도
                </span>
              )}
              {buyCount + holdCount + sellCount === 0 && (
                <span className="text-[13px] font-bold text-muted-foreground/50">—</span>
              )}
            </div>
          </div>

          {/* AI 분석 완료 — 프로그레스 바 */}
          <div className="px-4 border-l border-border/40">
            <p className="text-[11px] text-muted-foreground mb-2">AI 분석</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${analysedPct}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold text-foreground tabular-nums shrink-0">
                {analysedCount}/{holdings.length}
              </span>
            </div>
          </div>

          {/* 가격 업데이트 — 상대 시간 */}
          <div className="pl-4 border-l border-border/40">
            <p className="text-[11px] text-muted-foreground mb-2">가격 갱신</p>
            <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              {priceUpdating
                ? <><Loader2 className="w-3 h-3 animate-spin" /> 갱신 중</>
                : lastPriceUpdate
                ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />{heroRelativeTime(lastPriceUpdate)}</>
                : "—"
              }
            </p>
          </div>
        </div>
      </div>

      {/* 하단 CTA */}
      <button
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-2 py-3 bg-primary/10 hover:bg-primary/15 transition-colors border-t border-primary/20 text-primary text-[13px] font-semibold"
      >
        <Plus className="w-4 h-4" /> 종목 추가하기
      </button>
    </div>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function Portfolio() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<"added" | "upside">("added");
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [priceUpdating, setPriceUpdating] = useState(false);
  const holdingsRef = useRef<Holding[]>([]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      // skipPrices=true: 분석/메타 데이터만 즉시 받고, 현재가는 batch-quotes로 후속 채움
      const r = await fetch(getApiUrl("/api/portfolio?skipPrices=true"), { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        const h = d.holdings ?? [];
        setHoldings(h);
        holdingsRef.current = h;
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 30초마다 현재가만 갱신 (batch-quotes)
  const refreshPrices = useCallback(async () => {
    const current = holdingsRef.current;
    if (current.length === 0) return;
    setPriceUpdating(true);
    try {
      const tickers = current.map(h => {
        const t = h.ticker.trim();
        return /^\d{5,6}$/.test(t.split(".")[0]) ? `${t}.KS` : t;
      });
      const r = await fetch(getApiUrl("/api/market-data/batch-quotes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers }),
      });
      if (!r.ok) return;
      const quotes: Record<string, { price: number | null; currency: string; change: number | null }> = await r.json();

      setHoldings(prev => {
        const next = prev.map(h => {
          const yticker = /^\d{5,6}$/.test(h.ticker.split(".")[0]) ? `${h.ticker}.KS` : h.ticker;
          const q = quotes[yticker] ?? quotes[h.ticker];
          if (!q || q.price == null) return h;
          const returnPct = h.avgPrice && h.avgPrice > 0
            ? ((q.price - h.avgPrice) / h.avgPrice) * 100
            : h.returnPct;
          return { ...h, currentPrice: q.price, change1d: q.change, priceCurrency: q.currency, returnPct };
        });
        holdingsRef.current = next;
        return next;
      });
      setLastPriceUpdate(new Date());
    } catch { /* silently ignore */ }
    finally { setPriceUpdating(false); }
  }, []);

  useEffect(() => {
    // 1단계: 분석/메타 데이터 즉시 렌더
    load().then(() => {
      // 2단계: 로드 직후 batch-quotes로 현재가 채움 (캐시 있으면 즉각 반영)
      refreshPrices();
    });
  }, [load, refreshPrices]);

  // 30초마다 가격 자동 갱신
  useEffect(() => {
    const id = setInterval(refreshPrices, 30_000);
    return () => clearInterval(id);
  }, [refreshPrices]);

  function handleDelete(id: number) {
    setHoldings(prev => prev.filter(h => h.id !== id));
  }

  const sorted = [...holdings].sort((a, b) => {
    if (sortKey === "upside") return ((b.analysis?.upsidePct) ?? -Infinity) - ((a.analysis?.upsidePct) ?? -Infinity);
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* 상단 헤더: 새로고침만 */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/60 hover:text-muted-foreground"
          title="새로고침"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-36">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-primary/60" />
            <p className="text-[13px] text-muted-foreground">포트폴리오 불러오는 중…</p>
          </div>
        </div>
      ) : holdings.length === 0 ? (
        /* ── 빈 상태 ── */
        <div className="flex flex-col items-center justify-center py-32 space-y-5 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Briefcase className="w-8 h-8 text-primary/60" />
          </div>
          <div>
            <p className="text-[16px] font-bold text-foreground">보유 종목이 없어요</p>
            <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
              종목을 추가하면 AI가 현재가, 적정주가,<br/>오늘의 이슈를 한눈에 보여드려요.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-[14px] font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> 첫 종목 추가하기
          </button>
        </div>
      ) : (
        <>
          {/* ── 히어로 배너 ── */}
          <PortfolioHero
            holdings={holdings}
            lastPriceUpdate={lastPriceUpdate}
            priceUpdating={priceUpdating}
            onAdd={() => setShowAdd(true)}
          />

          {/* ── 정렬 탭 ── */}
          <div className="flex items-center gap-1 pt-1">
            <span className="text-[11px] text-muted-foreground mr-1">정렬</span>
            {(["added", "upside"] as const).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={cn(
                  "px-3 py-1.5 text-[11px] rounded-full transition-colors",
                  sortKey === k
                    ? "bg-foreground/10 text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {{ added: "최근 추가순", upside: "상승여력순" }[k]}
              </button>
            ))}
          </div>

          {/* ── 보유 종목 목록 ── */}
          <div className="space-y-2.5">
            <AnimatePresence mode="popLayout">
              {sorted.map(h => (
                <HoldingCard
                  key={h.id}
                  holding={h}
                  onDelete={handleDelete}
                  onRefresh={() => load(true)}
                />
              ))}
            </AnimatePresence>
          </div>

          {/* ── 포트폴리오 전체 리뷰 ── */}
          <PortfolioReview holdings={holdings} />

        </>
      )}

      {/* 종목 추가 다이얼로그 */}
      <AnimatePresence>
        {showAdd && <AddDialog onClose={() => setShowAdd(false)} onAdded={() => load()} />}
      </AnimatePresence>

      {/* 멀티뷰 정의 */}
      <div className="mt-8 px-1 flex items-start gap-1.5 text-[10px] text-muted-foreground/35 leading-relaxed">
        <Users className="w-3 h-3 shrink-0 mt-0.5" />
        <p>
          <span className="font-semibold text-muted-foreground/50">멀티뷰</span>는 최근 30일 내 이 종목을 분석한 여러 분석자의 AI 적정주가를 평균낸 값입니다. 시점·이슈에 따라 적정주가가 달라질 수 있어 최신 분석만 반영합니다. 분석자가 2명 이상일 때 표시됩니다.
        </p>
      </div>
    </div>
  );
}
