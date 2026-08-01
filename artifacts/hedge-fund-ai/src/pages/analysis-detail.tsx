import { useEffect, useRef, useState, useCallback, useMemo, Children, isValidElement, cloneElement, createContext, useContext } from "react";
import { useRoute, useLocation } from "wouter";
import { useGetAnalysis, getGetAnalysisQueryKey, useDeleteAnalysis } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENTS, ANALYSIS_STEPS_ORDER, type AgentInfo } from "@/lib/agents";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { 
  CheckCircle2, 
  Clock, 
  Loader2, 
  Briefcase,
  BrainCircuit,
  Trash2,
  ArrowLeft,
  ShieldCheck,
  RefreshCw,
  Share2,
  Check,
  Database,
  Pencil,
  X,
  StickyNote,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Swords,
  History,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Building2,
  BarChart2,
  Table2,
  Home,
  Search,
  Zap,
  Sparkles,
  ExternalLink,
  ChevronUp,
  Newspaper,
  FileText,
  Users,
  AlertTriangle,
  Star,
  Minus,
} from "lucide-react";
import { cn, formatCurrency, isUSTicker, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { useUser } from "@clerk/react";
import { useAuth as useKakaoAuth } from "@/lib/auth";
import { motion, AnimatePresence } from "framer-motion";
import StockChart, { type ChartLevels } from "@/components/StockChart";
import FinancialChart from "@/components/FinancialChart";
import { ErrorBoundary } from "@/components/error-boundary";
import SummaryCardsB from "@/components/SummaryCardsB";
import ETFSection from "@/components/ETFSection";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ── 메모 헬퍼 ─────────────────────────────────────────────────────────────────
const MEMO_KEY = "avitda-memos";
function getMemo(id: number): string {
  try { return JSON.parse(localStorage.getItem(MEMO_KEY) || "{}")[String(id)] || ""; } catch { return ""; }
}
function saveMemo(id: number, text: string) {
  try {
    const memos = JSON.parse(localStorage.getItem(MEMO_KEY) || "{}");
    if (text.trim()) memos[String(id)] = text.trim(); else delete memos[String(id)];
    localStorage.setItem(MEMO_KEY, JSON.stringify(memos));
  } catch {}
}

function MemoSection({ analysisId, isEn = false }: { analysisId: number; isEn?: boolean }) {
  const [saved, setSaved] = useState(() => getMemo(analysisId));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = () => { setDraft(saved); setEditing(true); setTimeout(() => textareaRef.current?.focus(), 50); };
  const handleSave = () => { saveMemo(analysisId, draft); setSaved(draft.trim()); setEditing(false); };
  const handleCancel = () => setEditing(false);

  if (!saved && !editing) {
    return (
      <button
        onClick={startEdit}
        className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-amber-500 transition-colors print:hidden"
      >
        <StickyNote className="w-3.5 h-3.5" />
        {isEn ? "Add note" : "메모 추가"}
      </button>
    );
  }

  if (editing) {
    return (
      <div className="print:hidden mt-1 flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isEn ? "Enter notes about this report..." : "이 보고서에 대한 메모를 입력하세요..."}
          rows={2}
          className="w-full text-[13px] text-foreground/80 placeholder:text-muted-foreground/50 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-300 dark:focus:ring-amber-700 leading-relaxed"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); handleCancel(); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
          }}
        />
        <div className="flex items-center gap-2">
          <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-400 hover:bg-amber-500 text-white text-[12px] font-semibold transition-colors">
            <Check className="w-3.5 h-3.5" /> {isEn ? "Save" : "저장"}
          </button>
          <button onClick={handleCancel} className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-muted hover:bg-muted text-muted-foreground text-[12px] font-semibold transition-colors">
            <X className="w-3.5 h-3.5" /> {isEn ? "Cancel" : "취소"}
          </button>
          <span className="text-[11px] text-muted-foreground/50">{isEn ? "⌘Enter to save" : "⌘Enter로 저장"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="group/memo flex items-start gap-2 print:hidden">
      <StickyNote className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
      <p className="flex-1 text-[13px] text-foreground/70 leading-relaxed whitespace-pre-wrap break-words">{saved}</p>
      <button
        onClick={startEdit}
        className="shrink-0 p-1 rounded text-muted-foreground/50 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors opacity-0 group-hover/memo:opacity-100"
        title={isEn ? "Edit note" : "메모 수정"}
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * 한국 금융 단위 앞 4자리 이상 숫자에 천단위 쉼표를 삽입합니다.
 * 연도(2024년), 종목코드(078160), 원/주 단위는 제외합니다.
 */
function addKrwCommas(text: string): string {
  return text.replace(
    /(-?)(\d{4,})(\.\d+)?(억원|억|조원|조|만원|만|달러|원(?!\/주))/g,
    (_match, sign: string, intPart: string, decimal: string | undefined, unit: string) => {
      const formatted = parseInt(intPart, 10).toLocaleString("ko-KR");
      return `${sign}${formatted}${decimal ?? ""}${unit}`;
    }
  );
}

// ── 테이블 행 분할 복구 헬퍼 ──────────────────────────────────────────────────
function countTableCols(row: string): number {
  return row.split("|").length - 2;
}
function isSeparatorRow(row: string): boolean {
  if (!/^\s*\|/.test(row)) return false;
  const cells = row.split("|").slice(1, -1);
  return cells.length > 0 && cells.every(c => /^[\s\-:]+$/.test(c)) && cells.some(c => c.includes("-"));
}
function mergeRowsToTarget(rows: string[], targetCols: number): string[] {
  if (rows.length === 0) return rows;
  const out: string[] = [];
  let current = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (countTableCols(current) < targetCols) {
      current = current.trimEnd().replace(/\|\s*$/, "") + rows[i].trimStart();
    } else {
      out.push(current);
      current = rows[i];
    }
  }
  out.push(current);
  return out;
}
// 한 줄에 여러 행이 이어 붙어있는 경우 targetCols 단위로 잘라서 분리
function splitOverflowRows(rows: string[], targetCols: number): string[] {
  if (targetCols <= 0) return rows;
  const out: string[] = [];
  for (const row of rows) {
    const cols = countTableCols(row);
    if (cols <= targetCols * 1.5) {
      out.push(row);
      continue;
    }
    // 셀 단위로 분리 후 targetCols개씩 재조합
    const parts = row.split("|");
    // parts[0]은 앞 공백, parts[parts.length-1]은 뒤 공백
    const cells = parts.slice(1, -1);
    for (let start = 0; start < cells.length; start += targetCols) {
      const chunk = cells.slice(start, start + targetCols);
      if (chunk.length === 0) continue;
      out.push("| " + chunk.map(c => c.trim()).join(" | ") + " |");
    }
  }
  return out;
}
function fixSplitTableRows(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) { out.push(line); i++; continue; }
    const block: string[] = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) { block.push(lines[i]); i++; }
    const sepIdx = block.findIndex(l => isSeparatorRow(l));
    if (sepIdx < 0) { out.push(...block); continue; }
    const targetCols = countTableCols(block[sepIdx]);
    out.push(...mergeRowsToTarget(block.slice(0, sepIdx), targetCols));
    out.push(block[sepIdx]);
    const dataRows = mergeRowsToTarget(block.slice(sepIdx + 1), targetCols);
    out.push(...splitOverflowRows(dataRows, targetCols));
  }
  return out;
}

const RoadmapEnContext = createContext(false);

const KO_MONTHS: Record<number, string> = {
  1:"January",2:"February",3:"March",4:"April",5:"May",6:"June",
  7:"July",8:"August",9:"September",10:"October",11:"November",12:"December",
};

const ROADMAP_KO_TO_EN: [RegExp, string | ((m: string, ...a: string[]) => string)][] = [
  // ── 날짜: "2026년 5월" → "May 2026"
  [/(\d{4})년\s*(\d{1,2})월/g, (_m, y, mo) => `${KO_MONTHS[Number(mo)] ?? mo+"M"} ${y}`],
  // ── 섹션 제목 (긴 것 먼저)
  [/향후\s*예상\s*일정\s*및\s*시나리오/g, "Upcoming Schedule & Scenarios"],
  [/주요\s*예정\s*일정/g, "Key Upcoming Events"],
  [/예상\s*주가[·\s]*실적\s*영향/g, "Expected Price / Earnings Impact"],
  [/시나리오\s*전망/g, "Scenario Outlook"],
  // ── 수급 & 기대감 섹션 헤더
  [/수급\s*[&＆]\s*기대감\s*진단/g, "Supply & Sentiment Diagnostics"],
  [/수급\s*흐름/g, "Capital Flow"],
  [/기대감\s*선반영\s*판정\s*및\s*(?:단기|Short-term)\s*대응/g, "Expectation Pricing & Short-term Response"],
  [/기대감\s*선반영\s*판정/g, "Expectation Pricing Assessment"],
  [/선반영\s*수준/g, "Pricing Level"],
  [/선반영/g, "Pre-Priced"],
  [/셀온뉴스/g, "Sell-on-News"],
  [/셀\s*온\s*뉴스/g, "Sell-on-News"],
  [/과열\s*반영/g, "Over-Reflected"],
  [/저\s*반영/g, "Under-Reflected"],
  [/적정\s*반영/g, "Fairly Reflected"],
  [/과열반영/g, "Over-Reflected"],
  [/저반영/g, "Under-Reflected"],
  [/적정반영/g, "Fairly Reflected"],
  // ── 기타 공통 한국어 단어
  [/수급/g, "Supply & Demand"],
  [/기대감/g, "Sentiment"],
  // ── 시나리오 레이블 괄호 한국어 제거: "Base (핵심 이슈 정상 실현)" → "Base"
  [/(Base|Bull|Bear)\s*\([^)]*[\uAC00-\uD7A3][^)]*\)/g, "$1"],
  // ── 테이블 헤더
  [/시점/g, "Timeframe"],
  [/이벤트\s*\/\s*확인\s*지표/g, "Event / Indicator"],
  [/의미/g, "Implication"],
  // ── 기간 레이블 (상세 먼저)
  [/단기\s*\([~\s]*3\s*개월\)/g, "Short-term (~3M)"],
  [/중기\s*\(3\s*[~–]\s*12\s*개월\)/g, "Mid-term (3–12M)"],
  [/장기\s*\(1\s*년\s*\+?\)/g, "Long-term (1Y+)"],
  [/장기\s*\(12\s*개월\s*\+?\)/g, "Long-term (12M+)"],
  [/단기/g, "Short-term"],
  [/중기/g, "Mid-term"],
  [/장기/g, "Long-term"],
  // ── 혼합 출력: "Short-term(~3개월)" 등 영문 term + 한국어 괄호
  [/(\d+)\s*[~–]\s*(\d+)\s*개월/g, "$1~$2M"],
  [/[~]\s*(\d+)\s*개월/g, "~$1M"],
  [/(\d+)\s*개월\s*\+/g, "$1M+"],
  [/(\d+)\s*개월/g, "$1M"],
  // ── 신호
  [/→\s*부정\s*신호/g, "→ Negative Signal"],
  [/→\s*긍정\s*신호/g, "→ Positive Signal"],
  [/→\s*중립\s*신호/g, "→ Neutral Signal"],
  [/부정\s*신호/g, "Negative Signal"],
  [/긍정\s*신호/g, "Positive Signal"],
  [/중립\s*신호/g, "Neutral Signal"],
];

function translateRoadmapTerms(md: string): string {
  let out = md;
  for (const [pattern, replacement] of ROADMAP_KO_TO_EN) {
    out = out.replace(pattern as RegExp, replacement as any);
  }
  return out;
}

function prepareMarkdown(md: string, isEn = false): string {
  if (!md) return md;

  // AI가 테이블 행을 여러 줄에 걸쳐 출력하는 경우 병합 후 remark-gfm에 전달
  const lines = fixSplitTableRows(md.split("\n"));
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 백엔드 전용 검증 메시지 — 프론트 미표시
    if (/Terminal Value 비중 확인/.test(line)) continue;

    // remark-gfm이 단독 ~ 를 strikethrough/subscript로 파싱하는 문제 방지
    // ~~ (취소선) 은 유지, 나머지 단독 ~ 는 모두 이스케이프
    line = line.replace(/(?<!~)~(?!~)/g, '\\~');

    const prev = i > 0 ? lines[i - 1] : "";
    const isTableRow = /^\s*\|/.test(line);
    const prevIsTableRow = /^\s*\|/.test(prev);
    const prevIsBlank = prev.trim() === "";

    // 테이블 첫 번째 행 바로 앞에만 빈 줄 삽입
    if (isTableRow && !prevIsTableRow && !prevIsBlank) {
      out.push("");
    }
    out.push(addKrwCommas(line));
  }

  const result = out.join("\n");
  return isEn ? translateRoadmapTerms(result) : result;
}

const ROADMAP_GROUPS: Record<string, { labelKo: string; labelEn: string; rangeKo: string; rangeEn: string; bg: string; text: string; border: string }> = {
  "단기":       { labelKo: "단기",      labelEn: "Short",  rangeKo: "1~3개월",  rangeEn: "1~3M",   bg: "#EFF6FF", text: "#1D4ED8", border: "#93C5FD" },
  "중기":       { labelKo: "중기",      labelEn: "Mid",    rangeKo: "3~12개월", rangeEn: "3~12M",  bg: "#FFFBEB", text: "#B45309", border: "#FCD34D" },
  "장기":       { labelKo: "장기",      labelEn: "Long",   rangeKo: "12개월+",  rangeEn: "12M+",   bg: "#F0FDF4", text: "#15803D", border: "#86EFAC" },
  "Short-term": { labelKo: "단기",      labelEn: "Short",  rangeKo: "1~3개월",  rangeEn: "1~3M",   bg: "#EFF6FF", text: "#1D4ED8", border: "#93C5FD" },
  "Mid-term":   { labelKo: "중기",      labelEn: "Mid",    rangeKo: "3~12개월", rangeEn: "3~12M",  bg: "#FFFBEB", text: "#B45309", border: "#FCD34D" },
  "Long-term":  { labelKo: "장기",      labelEn: "Long",   rangeKo: "12개월+",  rangeEn: "12M+",   bg: "#F0FDF4", text: "#15803D", border: "#86EFAC" },
};

function getCellText(el: any): string {
  if (!isValidElement(el)) return "";
  const cells = Children.toArray((el as any).props?.children ?? []);
  const first = cells[0] as any;
  const text = first?.props?.children;
  return typeof text === "string" ? text.trim() : "";
}

function RoadmapTbody({ children }: { children: React.ReactNode }) {
  const isEn = useContext(RoadmapEnContext);
  const rows = Children.toArray(children).filter(isValidElement);
  const labels = rows.map(getCellText);
  const isRoadmap = labels.some((l) => ROADMAP_GROUPS[l] != null);

  if (!isRoadmap) {
    // 빈 테이블(행 없음): 데이터 없음 메시지 행 표시
    if (rows.length === 0) {
      return (
        <tbody>
          <tr>
            <td colSpan={99} className="px-3 py-4 text-center text-[13px] text-muted-foreground/50 italic">
              데이터 없음
            </td>
          </tr>
        </tbody>
      );
    }
    return (
      <tbody>
        {rows.map((row: any, i) => {
          const firstCell = Children.toArray(row.props?.children ?? [])[0] as any;
          const text = firstCell?.props?.children ?? "";
          const isSubRow = typeof text === "string" && text.startsWith("↳");
          return cloneElement(row, { key: i, className: isSubRow ? "sub-metric-row" : "" });
        })}
      </tbody>
    );
  }

  type Group = { key: string; config: typeof ROADMAP_GROUPS[string]; rows: any[] };
  const groups: Group[] = [];
  for (const row of rows) {
    const lbl = getCellText(row);
    const cfg = ROADMAP_GROUPS[lbl];
    if (!cfg) continue;
    if (groups.length && groups[groups.length - 1].key === lbl) {
      groups[groups.length - 1].rows.push(row);
    } else {
      groups.push({ key: lbl, config: cfg, rows: [row] });
    }
  }

  return (
    <tbody>
      {groups.map((group, gi) =>
        group.rows.map((row: any, ri: number) => {
          const cells = Children.toArray(row.props?.children ?? []);
          const dataCells = cells.slice(1);
          const isFirstOfGroup = ri === 0;
          const isFirstRow = gi === 0 && ri === 0;
          return (
            <tr
              key={`${gi}-${ri}`}
              style={{ borderTop: isFirstOfGroup && !isFirstRow ? `2px solid ${group.config.border}` : undefined }}
            >
              {isFirstOfGroup && (
                <td
                  rowSpan={group.rows.length}
                  style={{
                    background: group.config.bg,
                    borderRight: `2px solid ${group.config.border}`,
                    verticalAlign: "middle",
                    textAlign: "center",
                    padding: "0.5rem 0.75rem",
                    whiteSpace: "nowrap",
                    width: "72px",
                    minWidth: "72px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                    <span style={{ color: group.config.text, fontWeight: 700, fontSize: "0.75rem" }}>
                      {isEn ? group.config.labelEn : group.config.labelKo}
                    </span>
                    <span style={{ color: group.config.text, fontSize: "0.65rem", opacity: 0.8 }}>
                      {isEn ? group.config.rangeEn : group.config.rangeKo}
                    </span>
                  </div>
                </td>
              )}
              {dataCells}
            </tr>
          );
        })
      )}
    </tbody>
  );
}

const MD_TABLE_COMPONENTS = {
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-4 rounded-xl border border-border/60 shadow-[var(--shadow-xs)]">
      <table className="w-full text-[14px] border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-muted border-b border-border">{children}</thead>,
  tbody: ({ children }: any) => <RoadmapTbody>{children}</RoadmapTbody>,
  tr: ({ children, ...props }: any) => {
    const firstCell = Array.isArray(children) ? children[0] : children;
    const cellText = firstCell?.props?.children ?? "";
    const cellStr = typeof cellText === "string" ? cellText : Array.isArray(cellText) ? cellText.join("") : String(cellText ?? "");
    const isSubRow = cellStr.startsWith("↳");
    // 매매 신호 행 색상 강조
    const isBuySignal  = /^🟢/.test(cellStr);
    const isSellSignal = /^🔴/.test(cellStr);
    const isStopSignal = /^🛑/.test(cellStr);
    const isReSignal   = /^📈/.test(cellStr);
    const signalClass  = isBuySignal  ? "bg-emerald-500/8 dark:bg-emerald-500/10 hover:bg-emerald-500/15"
                       : isSellSignal ? "bg-rose-500/8 dark:bg-rose-500/10 hover:bg-rose-500/15"
                       : isStopSignal ? "bg-orange-500/8 dark:bg-orange-500/10 hover:bg-orange-500/15"
                       : isReSignal   ? "bg-blue-500/8 dark:bg-blue-500/10 hover:bg-blue-500/15"
                       : "hover:bg-muted/20";
    return (
      <tr className={cn("border-b border-border/60 last:border-0 transition-colors", isSubRow ? "sub-metric-row" : "", signalClass)} {...props}>
        {children}
      </tr>
    );
  },
  th: ({ children }: any) => <th className="px-3 py-2.5 text-left text-[13px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{children}</th>,
  td: ({ children }: any) => <td className="px-3 py-2.5 text-foreground/90 leading-[1.75] align-top">{children}</td>,
};

// 야후 파이낸스 영문 업종명 → 한국어 변환
const INDUSTRY_KO: Record<string, string> = {
  // 자동차
  "Auto Manufacturers": "자동차",
  "Auto Parts": "자동차 부품",
  "Auto & Truck Dealerships": "자동차 딜러",
  // 반도체·전자
  "Semiconductors": "반도체",
  "Semiconductor Equipment & Materials": "반도체 장비·소재",
  "Electronic Components": "전자부품",
  "Electronic Technology": "전자기술",
  "Consumer Electronics": "가전제품",
  "Electrical Equipment & Parts": "전기장비",
  // IT·소프트웨어
  "Software—Application": "소프트웨어",
  "Software—Infrastructure": "인프라 소프트웨어",
  "Information Technology Services": "IT 서비스",
  "Internet Content & Information": "인터넷·정보서비스",
  "Internet Retail": "인터넷 쇼핑몰",
  "Communication Equipment": "통신 장비",
  "Computer Hardware": "컴퓨터 하드웨어",
  "Scientific & Technical Instruments": "과학·기술 장비",
  // 통신
  "Telecom Services": "통신서비스",
  "Telecommunications Services": "통신서비스",
  // 금융
  "Banks—Regional": "지방은행",
  "Banks—Diversified": "종합은행",
  "Insurance—Life": "생명보험",
  "Insurance—Property & Casualty": "손해보험",
  "Insurance—Diversified": "종합보험",
  "Financial Services": "금융서비스",
  "Asset Management": "자산운용",
  "Capital Markets": "자본시장",
  "Credit Services": "신용·카드",
  // 바이오·헬스
  "Biotechnology": "바이오",
  "Drug Manufacturers—General": "제약(대형)",
  "Drug Manufacturers—Specialty & Generic": "제약(전문·제네릭)",
  "Medical Devices": "의료기기",
  "Medical Care Facilities": "의료서비스",
  "Health Information Services": "헬스케어 IT",
  "Healthcare Plans": "건강보험",
  "Diagnostics & Research": "진단·연구",
  // 에너지
  "Oil & Gas Integrated": "정유·가스(통합)",
  "Oil & Gas E&P": "석유·가스 탐사",
  "Oil & Gas Refining & Marketing": "정유·마케팅",
  "Oil & Gas Equipment & Services": "유전 장비·서비스",
  "Chemicals": "화학",
  "Specialty Chemicals": "특수화학",
  // 소비재
  "Beverages—Non-Alcoholic": "음료(비알코올)",
  "Beverages—Brewers": "주류(맥주)",
  "Food Distribution": "식품 유통",
  "Packaged Foods": "가공식품",
  "Household & Personal Products": "생활용품",
  "Apparel Manufacturing": "의류 제조",
  "Apparel Retail": "의류 소매",
  "Luxury Goods": "명품",
  "Specialty Retail": "전문 소매",
  "Department Stores": "백화점",
  // 산업재
  "Aerospace & Defense": "항공우주·방산",
  "Industrial Machinery": "산업기계",
  "Industrial Distribution": "산업 유통",
  "Engineering & Construction": "건설·엔지니어링",
  "Building Materials": "건자재",
  "Steel": "철강",
  "Aluminum": "알루미늄",
  "Metal Fabrication": "금속 가공",
  "Paper & Paper Products": "제지",
  // 유통·물류
  "Grocery Stores": "식품 마트",
  "Discount Stores": "할인점",
  "Shipping & Ports": "해운·항만",
  "Airlines": "항공",
  "Trucking": "육상 화물",
  "Integrated Freight & Logistics": "종합 물류",
  // 부동산
  "Real Estate Services": "부동산 서비스",
  "Real Estate—Development": "부동산 개발",
  "REIT—Office": "오피스 리츠",
  "REIT—Retail": "리테일 리츠",
  // 기타
  "Entertainment": "엔터테인먼트",
  "Media—Diversified": "종합 미디어",
  "Publishing": "출판",
  "Education & Training Services": "교육·훈련",
  "Staffing & Employment Services": "인력파견",
  "Waste Management": "폐기물 처리",
  "Utilities—Regulated Electric": "전기 유틸리티",
  "Utilities—Diversified": "종합 유틸리티",
};

function toKoreanIndustry(industry: string | null | undefined): string {
  if (!industry) return "—";
  return INDUSTRY_KO[industry] ?? industry;
}

function toKoreanVerdict(verdict: string | null | undefined): string {
  if (!verdict) return "—";
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return "높은 상승여력";
  if (s.includes("buy"))         return "상승여력";
  if (s.includes("strong sell")) return "높은 하락여지";
  if (s.includes("sell"))        return "하락여지";
  return "적정 수준";
}

function verdictStyle(verdict: string | null | undefined, isEn = false) {
  if (!verdict) return { label: "—", color: "text-muted-foreground", bg: "bg-muted", border: "border-border" };
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return { label: isEn ? "Strong Upside" : "높은 상승여력", color: "text-emerald-800 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-400 dark:border-emerald-700" };
  if (s.includes("buy"))         return { label: isEn ? "Upside"        : "상승여력",      color: "text-green-800 dark:text-green-300",     bg: "bg-green-50 dark:bg-green-950/40",     border: "border-green-400 dark:border-green-700" };
  if (s.includes("strong sell")) return { label: isEn ? "Strong Downside" : "높은 하락여지", color: "text-blue-800 dark:text-blue-300",       bg: "bg-blue-50 dark:bg-blue-950/40",       border: "border-blue-400 dark:border-blue-700" };
  if (s.includes("sell"))        return { label: isEn ? "Downside"      : "하락여지",      color: "text-blue-700 dark:text-blue-300",       bg: "bg-blue-50 dark:bg-blue-950/40",       border: "border-blue-400 dark:border-blue-700" };
  return { label: isEn ? "Fair Value" : "적정 수준", color: "text-amber-800 dark:text-amber-300", bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-400 dark:border-amber-700" };
}

declare global { interface Window { Kakao: any } }

function loadKakaoSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById("kakao-sdk")) { resolve(); return; }
    const s = document.createElement("script");
    s.id = "kakao-sdk";
    s.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js";
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function ShareModal({ analysis, onClose }: { analysis: any; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [shareCredit, setShareCredit] = useState<'idle' | 'loading' | 'pending' | 'already'>('idle');
  const isEnModal = analysis?.language === 'en';
  const base = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
  const url = analysis?.id ? `${base}/share/${analysis.id}` : window.location.href;
  const currency = isUSTicker(analysis?.ticker) ? "USD" : "KRW";
  const vs = verdictStyle(analysis?.verdict, isEnModal);
  const targetPriceStr = analysis?.targetPrice
    ? formatCurrency(analysis.targetPrice, currency, isEnModal)
    : null;

  const shareDateStr = analysis?.createdAt
    ? new Date(analysis.createdAt).toISOString().slice(0, 10).replace(/-/g, ".")
    : new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  const verdictRaw = analysis?.investmentVerdict ?? analysis?.verdict ?? null;
  const verdictLabel = verdictRaw ? (isEnModal ? verdictRaw : toKoreanVerdict(verdictRaw)) : null;
  const shareText = verdictLabel && verdictLabel !== "—"
    ? (isEnModal
        ? `${analysis?.companyName ?? ""} [${verdictLabel}] · Check the AI-analyzed company valuation | AiBITDA`
        : `${analysis?.companyName ?? ""} [${verdictLabel}] · AI가 분석한 기업가치를 확인하세요 | 애빛다`)
    : (isEnModal
        ? `${analysis?.companyName ?? ""} · AI Equity Research Report | AiBITDA`
        : `${analysis?.companyName ?? ""} · AI 기업가치 분석 리포트 | 애빛다`);

  const claimShareCredit = async () => {
    if (shareCredit !== 'idle') return;
    setShareCredit('loading');
    try {
      const r = await fetch(getApiUrl("/api/credits/share"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: analysis?.id }),
      });
      const d = await r.json();
      if (!r.ok) { setShareCredit('idle'); return; }
      setShareCredit(d.registered ? 'pending' : 'already');
    } catch {
      setShareCredit('idle');
    }
  };

  const handleKakao = async () => {
    const key = import.meta.env.VITE_KAKAO_JS_KEY;
    if (!key) { handleCopy(); return; }
    try {
      await loadKakaoSDK();
      if (!window.Kakao.isInitialized()) window.Kakao.init(key);
      const imageUrl = `${window.location.origin}${import.meta.env.BASE_URL}opengraph.jpg`;
      window.Kakao.Share.sendDefault({
        objectType: "feed",
        content: {
          title: shareText,
          description: isEnModal ? `${shareDateStr} · AI 7-step pipeline equity research report` : `${shareDateStr} · AI 7단계 파이프라인이 분석한 기업가치 리포트`,
          imageUrl,
          link: { mobileWebUrl: url, webUrl: url },
        },
        buttons: [{ title: isEnModal ? "View Report" : "리포트 보기", link: { mobileWebUrl: url, webUrl: url } }],
      });
      claimShareCredit();
    } catch { handleCopy(); }
  };

  const handleTelegram = () => {
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`;
    window.open(tgUrl, "_blank", "noopener,noreferrer");
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(url); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // URL 표시용 단축 (긴 dev URL 일 때 잘라서 보여줌)
  const displayUrl = (() => {
    try {
      const u = new URL(url);
      return u.hostname.length > 30
        ? u.hostname.slice(0, 28) + "…" + u.pathname
        : u.hostname + u.pathname;
    } catch { return url; }
  })();

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

        <motion.div
          className="relative w-full max-w-sm mx-4 mb-4 sm:mb-0 bg-background rounded-[var(--radius)] shadow-2xl overflow-hidden"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <span className="text-sm font-bold text-foreground/90">{isEnModal ? "Share Report" : "리포트 공유"}</span>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── 리포트 정보 ── */}
          <div className="mx-5 mb-4 rounded-[var(--radius)] border border-border overflow-hidden">
            <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-background/10 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-[10px] font-black tracking-tight">AI</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white/60 text-[10px] font-semibold uppercase tracking-wider">{analysis?.ticker}</span>
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border", vs.bg, vs.color, vs.border)}>
                    {vs.label}
                  </span>
                </div>
                <p className="text-white text-[13px] font-bold truncate mt-0.5">{analysis?.companyName}</p>
              </div>
              {targetPriceStr && (
                <div className="text-right flex-shrink-0">
                  <div className="text-white/50 text-[9px]">{isEnModal ? "Target" : "적정주가"}</div>
                  <div className="text-white text-[13px] font-black">{targetPriceStr}</div>
                </div>
              )}
            </div>
            <div className="bg-muted/70 px-4 py-1.5 flex items-center gap-1.5">
              <svg className="w-3 h-3 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="text-[10px] text-muted-foreground truncate font-mono">{displayUrl}</span>
            </div>
          </div>

          {/* ── 메인 CTA: 링크 복사 ── */}
          <div className="px-5 mb-4">
            <motion.button
              onClick={handleCopy}
              className={cn(
                "w-full flex items-center justify-center gap-2.5 py-3.5 rounded-[var(--radius)] text-[14px] font-bold transition-all",
                copied
                  ? "bg-emerald-500 text-white"
                  : "bg-primary text-white hover:bg-primary/90"
              )}
              whileTap={{ scale: 0.98 }}
            >
              {copied
                ? <><Check className="w-4.5 h-4.5" /> {isEnModal ? "Link copied!" : "링크가 복사되었습니다!"}</>
                : <><svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  {isEnModal ? "Copy Link" : "링크 복사하기"}</>
              }
            </motion.button>
            <p className="text-center text-[10px] text-muted-foreground mt-1.5">
              {isEnModal ? "Anyone can view this report — no login required" : "로그인 없이도 누구나 리포트를 볼 수 있습니다"}
            </p>
          </div>

          {/* ── 소셜 공유 ── */}
          <div className="px-5 mb-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{isEnModal ? "Share via" : "소셜 공유"}</p>
            <div className="grid grid-cols-2 gap-2">
              {/* KakaoTalk */}
              <button
                onClick={handleKakao}
                className="flex items-center justify-center gap-2 py-2.5 rounded-[var(--radius)] bg-[#FEE500] hover:bg-[#F5DB00] transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.706 1.574 5.083 3.96 6.549L4.8 21l4.6-2.4A11.7 11.7 0 0012 18.6c5.523 0 10-3.477 10-7.8S17.523 3 12 3z" fill="#391B1B"/>
                </svg>
                <span className="text-[11px] font-bold text-[#391B1B]">카카오톡</span>
              </button>

              {/* Telegram */}
              <button
                onClick={handleTelegram}
                className="flex items-center justify-center gap-2 py-2.5 rounded-[var(--radius)] bg-[#229ED9] hover:bg-[#1a8fc4] transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="white">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8.02c-.12.57-.46.71-.94.44l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.52.26l.18-2.65 4.74-4.28c.21-.18-.04-.28-.31-.1L7.5 14.97 4.96 14.2c-.56-.17-.57-.56.12-.83l8.9-3.44c.47-.17.88.11.72.87z"/>
                </svg>
                <span className="text-[11px] font-bold text-white">텔레그램</span>
              </button>
            </div>
          </div>

          {/* ── 카카오 공유 크레딧 피드백 ── */}
          <AnimatePresence>
            {shareCredit === 'pending' && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mx-5 mb-4 flex items-center gap-2 px-3 py-2.5 rounded-[var(--radius)] bg-emerald-500/10 border border-emerald-500/25"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="text-[12px] font-semibold text-emerald-500">
                  {isEnModal
                    ? "Shared! Credit +1 will be awarded when someone else opens the link."
                    : "공유됐습니다! 다른 사람이 링크를 열면 크레딧 +1이 자동 적립됩니다."}
                </span>
              </motion.div>
            )}
            {shareCredit === 'already' && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mx-5 mb-4 flex items-center gap-2 px-3 py-2.5 rounded-[var(--radius)] bg-muted border border-border"
              >
                <Zap className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-[12px] text-muted-foreground">
                  {isEnModal ? "Share credit already registered today" : "오늘 공유 크레딧은 이미 등록됐습니다"}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── 카카오 공유 크레딧 안내 (idle 상태일 때만) ── */}
          {shareCredit === 'idle' && (
            <div className="mx-5 mb-4 flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius)] bg-amber-500/8 border border-amber-500/20">
              <Zap className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                {isEnModal
                  ? "Share via KakaoTalk · +1 credit when someone else opens the link (once daily)"
                  : "카카오톡으로 공유하면 다른 사람이 링크를 열었을 때 크레딧 +1 적립 (하루 1회)"}
              </span>
            </div>
          )}

        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── VersionTimelinePanel ─────────────────────────────────────────────────────
interface VersionItem {
  id: number;
  ticker: string;
  company_name: string;
  investment_verdict: string | null;
  target_price: number | null;
  start_price: number | null;
  created_at: string;
}

const VERDICT_SHORT: Record<string, { label: string; dot: string }> = {
  "Strong Buy":  { label: "강매수", dot: "bg-emerald-500" },
  "Buy":         { label: "매수",   dot: "bg-green-400" },
  "Hold":        { label: "보유",   dot: "bg-amber-400" },
  "Sell":        { label: "매도",   dot: "bg-orange-400" },
  "Strong Sell": { label: "강매도", dot: "bg-red-500" },
};

function VersionTimelinePanel({ ticker, currentId, isEn = false }: { ticker: string; currentId: number; isEn?: boolean }) {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    fetch(getApiUrl(`/api/analysis/ticker-history/${encodeURIComponent(ticker)}`), { credentials: "include" })
      .then(r => r.json())
      .then(data => setVersions(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) return (
    <div className="bg-card border border-border rounded-[var(--radius)] p-5 flex items-center gap-2 text-muted-foreground text-sm">
      <Loader2 className="w-4 h-4 animate-spin" /> {isEn ? "Loading version history…" : "버전 히스토리 로딩 중…"}
    </div>
  );
  if (versions.length <= 1) return null;

  const isKR = !ticker.includes(".") || ticker.endsWith(".KS") || ticker.endsWith(".KQ");

  const verdictLabel = (v: string | null): string => {
    if (!v) return "";
    if (isEn) return v;
    return VERDICT_SHORT[v]?.label ?? v;
  };

  return (
    <div className="bg-card rounded-[var(--radius)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="font-semibold text-base text-foreground">
          {isEn ? "Analysis Version Timeline" : "분석 버전 타임라인"}
        </h3>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {isEn ? `${versions.length} reports` : `${versions.length}개`}
        </span>
      </div>
      <div className="relative">
        <div className="absolute left-3.5 top-2 bottom-2 w-px bg-border" />
        <div className="space-y-3">
          {versions.map((v, i) => {
            const vc = VERDICT_SHORT[v.investment_verdict ?? ""];
            const isCurrent = v.id === currentId;
            const upside = v.target_price && v.start_price
              ? ((v.target_price - v.start_price) / v.start_price) * 100
              : null;
            return (
              <button
                key={v.id}
                onClick={() => !isCurrent && navigate(`/analysis/${v.id}`)}
                className={cn(
                  "relative flex items-start gap-3 w-full text-left pl-7 pr-2 py-2 rounded-[var(--radius)] transition-colors",
                  isCurrent ? "bg-primary/8 cursor-default" : "hover:bg-accent cursor-pointer"
                )}
              >
                {/* Timeline dot */}
                <div className={cn(
                  "absolute left-2 top-3.5 w-3 h-3 rounded-full border-2 border-background",
                  vc?.dot ?? "bg-muted-foreground",
                  isCurrent ? "ring-2 ring-primary/30" : ""
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] text-muted-foreground font-mono">
                      {new Date(v.created_at).toLocaleDateString(isEn ? "en-US" : "ko-KR", { month: "short", day: "numeric" })}
                    </span>
                    {isCurrent && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">{isEn ? "Current" : "현재"}</span>}
                    {i === 0 && !isCurrent && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{isEn ? "Latest" : "최신"}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {v.investment_verdict && (
                      <span className="text-xs font-semibold text-foreground">{verdictLabel(v.investment_verdict)}</span>
                    )}
                    {v.target_price != null && (
                      <span className="text-xs text-muted-foreground">
                        {isEn ? "Target" : "목표가"} {formatCurrency(Math.round(v.target_price), isKR ? "KRW" : "USD", isEn)}
                      </span>
                    )}
                    {upside !== null && (
                      <span className={cn("text-xs font-semibold", upside >= 0 ? "text-emerald-600" : "text-red-500")}>
                        {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}



// ─── EventRiskCard ────────────────────────────────────────────────────────────

interface EventRiskResult {
  ticker: string;
  score: number;
  level: "low" | "caution" | "warning" | "high";
  levelKo: string;
  runUp30d: number | null;
  runUp60d: number | null;
  runUp90d: number | null;
  rsi14: number | null;
  shortRatio: number | null;
  loanRatio: number | null;
  runUpScore: number;
  rsiScore: number;
  shortScore: number;
  warnings: string[];
  fetchedAt: string;
}

const RISK_COLORS = {
  low:     { bar: "bg-emerald-500", text: "text-emerald-500", badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-400" },
  caution: { bar: "bg-amber-400",   text: "text-amber-500",   badge: "bg-amber-400/15  text-amber-600  dark:text-amber-400",  ring: "ring-amber-400" },
  warning: { bar: "bg-orange-500",  text: "text-orange-500",  badge: "bg-orange-500/15 text-orange-600 dark:text-orange-400", ring: "ring-orange-400" },
  high:    { bar: "bg-red-500",     text: "text-red-500",     badge: "bg-red-500/15    text-red-600    dark:text-red-400",    ring: "ring-red-500" },
};

function EventRiskCard({ ticker, isEn = false }: { ticker: string; isEn?: boolean }) {
  const [data, setData] = useState<EventRiskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ticker || !open) return;
    setLoading(true);
    fetch(getApiUrl(`/api/market-data/event-risk/${encodeURIComponent(ticker)}`))
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker, open]);

  const colors = data ? RISK_COLORS[data.level] : RISK_COLORS["low"];
  const fmtPct = (v: number | null) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden shadow-[var(--shadow-card)]">
      <button
        className="w-full flex items-center justify-between px-4 sm:px-5 py-3.5 text-left gap-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <Zap className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="font-semibold text-base">
            {isEn ? "Event Risk Score" : "이벤트 리스크 점수"}
          </span>
          {data && (
            <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full", colors.badge)}>
              {data.score}점 · {data.levelKo}
            </span>
          )}
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{isEn ? "Calculating risk score…" : "리스크 점수 계산 중…"}</span>
            </div>
          )}

          {!loading && data && (
            <>
              {/* 종합 점수 게이지 */}
              <div className="space-y-2">
                <div className="flex items-end justify-between">
                  <span className="text-xs text-muted-foreground">{isEn ? "Overall Score" : "종합 점수"}</span>
                  <span className={cn("text-2xl font-black tabular-nums leading-none", colors.text)}>{data.score}<span className="text-sm font-semibold text-muted-foreground">/100</span></span>
                </div>
                <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-700", colors.bar)}
                    style={{ width: `${data.score}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>✅ {isEn ? "Low" : "낮음"}</span>
                  <span>⚠️ {isEn ? "Caution" : "주의"}</span>
                  <span>🔶 {isEn ? "Warn" : "경고"}</span>
                  <span>🔴 {isEn ? "High Risk" : "고위험"}</span>
                </div>
              </div>

              {/* 컴포넌트 3행 */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    label: isEn ? "Pre-pricing" : "선반영률",
                    sub:   `30d ${fmtPct(data.runUp30d)}`,
                    score: data.runUpScore,
                    max:   35,
                    hint:  data.runUp60d != null ? `60d ${fmtPct(data.runUp60d)} · 90d ${fmtPct(data.runUp90d)}` : undefined,
                  },
                  {
                    label: "RSI 14",
                    sub:   data.rsi14 != null ? `${data.rsi14.toFixed(1)}` : "—",
                    score: data.rsiScore,
                    max:   30,
                    hint:  data.rsi14 != null ? (data.rsi14 >= 70 ? "과열" : data.rsi14 <= 30 ? "과매도" : "보통") : undefined,
                  },
                  {
                    label: isEn ? "Short Ratio" : "공매도비율",
                    sub:   data.shortRatio != null ? `${data.shortRatio.toFixed(2)}%` : "N/A",
                    score: data.shortScore,
                    max:   35,
                    hint:  data.loanRatio != null ? `대차 ${data.loanRatio.toFixed(2)}%` : undefined,
                  },
                ].map(({ label, sub, score, max, hint }) => (
                  <div key={label} className="bg-muted/40 rounded-[var(--radius)] px-3 py-2.5 space-y-1.5">
                    <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide truncate">{label}</div>
                    <div className="text-base font-bold tabular-nums leading-tight">{sub}</div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", score >= max * 0.8 ? "bg-red-500" : score >= max * 0.5 ? "bg-amber-400" : "bg-emerald-500")}
                        style={{ width: `${(score / max) * 100}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">{score} / {max}점{hint ? ` · ${hint}` : ""}</div>
                  </div>
                ))}
              </div>

              {/* 경고 메시지 */}
              {data.warnings.length > 0 && (
                <div className="space-y-1.5">
                  {data.warnings.map((w, i) => (
                    <div key={i} className="text-[13px] text-foreground/80 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg px-3 py-2 leading-snug">
                      {w}
                    </div>
                  ))}
                </div>
              )}

              <div className="text-[10px] text-muted-foreground/50 text-right">
                {isEn ? "Updated" : "산출"}: {new Date(data.fetchedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </div>
            </>
          )}

          {!loading && !data && (
            <p className="text-xs text-muted-foreground py-2">
              {isEn ? "Unable to fetch data for this ticker." : "데이터를 불러올 수 없습니다."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PeerMultiplesPanel ───────────────────────────────────────────────────────

interface PeerMultiples {
  name: string;
  marketCap: number | null;
  pbr: number | null;
  per_trailing: number | null;
  per_fwd: number | null;
  ev_ebitda: number | null;
  ev_sales: number | null;
  roe: number | null;
  operating_margin: number | null;
  revenue: number | null;
  net_debt: number | null;
  _sources?: { yahoo: boolean; dart: boolean; calculated: string[] };
}
interface PeerSnapshotResponse {
  subject: string;
  collected_at: string;
  peers: Record<string, PeerMultiples>;
  averages?: Partial<PeerMultiples>;
}

function fmtNum(v: number | null | undefined, decimals = 1, suffix = ""): string {
  if (v == null) return "N/A";
  return `${v.toFixed(decimals)}${suffix}`;
}
function fmtMC(v: number | null | undefined): string {
  if (v == null) return "N/A";
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
  return `${(v / 1e6).toFixed(0)}M`;
}

function PeerMultiplesPanel({ ticker, isEn = false }: { ticker: string; isEn?: boolean }) {
  const [data, setData] = useState<PeerSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl(`api/peers/latest?subject=${encodeURIComponent(ticker)}`), { credentials: "include" });
      if (r.ok) setData(await r.json());
      else setData(null);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [ticker]);

  useEffect(() => { load(); }, [load]);

  const rows = data ? Object.entries(data.peers) : [];
  const avg = data?.averages;

  if (!loading && !data) return null;

  return (
    <div className="bg-card rounded-[var(--radius)] overflow-hidden shadow-[var(--shadow-card)]">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => e.key === "Enter" && setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-muted/40 transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-500" />
          <span className="font-semibold text-base">{isEn ? "Peer Multiples (Real Data)" : "피어 멀티플 실측 데이터"}</span>
          {data && (
            <span className="text-[10px] dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-500 dark:border-green-800/50 rounded px-1.5 py-0.5 font-medium">
              {isEn ? `${rows.length} peers` : `${rows.length}개 피어`}
            </span>
          )}
          {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              {isEn ? "Collected:" : "수집:"} {new Date(data.collected_at).toLocaleDateString(isEn ? "en-US" : "ko-KR")}
            </span>
          )}
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); load(); }}
            onKeyDown={e => e.key === "Enter" && (e.stopPropagation(), load())}
            className="p-1 rounded hover:bg-muted text-muted-foreground cursor-pointer"
            title="새로고침"
          >
            <RefreshCw className="w-3 h-3" />
          </span>
          <span className="text-muted-foreground text-xs">{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && data && rows.length > 0 && (
        <div className="border-t border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-muted">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{isEn ? "Ticker" : "종목"}</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">P/B</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">P/E</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap hidden sm:table-cell">P/E Fwd</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">EV/EBIT</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap hidden sm:table-cell">EV/Sales</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">ROE</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">OPM</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap hidden sm:table-cell">{isEn ? "Mkt Cap" : "시총"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map(([t, p]) => (
                  <tr key={t} className="hover:bg-muted/20">
                    <td className="px-3 py-1.5 whitespace-nowrap max-w-[90px] sm:max-w-none">
                      <span className="font-mono text-blue-600 font-medium text-[13px]">{t}</span>
                      <span className="text-muted-foreground ml-1 text-[9px] hidden sm:inline">{p.name}</span>
                    </td>
                    {([
                      [p.pbr, 2, "x"],
                      [p.per_trailing, 1, "x"],
                    ] as [number|null, number, string][]).map((args, i) => (
                      <td key={i} className={cn("px-3 py-1.5 text-right tabular-nums", args[0] == null ? "text-muted-foreground/40" : "text-foreground")}>
                        {fmtNum(args[0], args[1], args[2])}
                      </td>
                    ))}
                    <td className={cn("px-2 py-1.5 text-right tabular-nums hidden sm:table-cell", p.per_fwd == null ? "text-muted-foreground/40" : "text-foreground")}>
                      {p.per_fwd != null ? (
                        <span>{fmtNum(p.per_fwd, 1, "x")}</span>
                      ) : "N/A"}
                    </td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", p.ev_ebitda == null ? "text-muted-foreground/40" : "text-foreground")}>
                      {fmtNum(p.ev_ebitda, 1, "x")}
                    </td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums hidden sm:table-cell", p.ev_sales == null ? "text-muted-foreground/40" : "text-foreground")}>
                      {fmtNum(p.ev_sales, 2, "x")}
                    </td>
                    {([
                      [p.roe, 1, "%"],
                      [p.operating_margin, 1, "%"],
                    ] as [number|null, number, string][]).map((args, i) => (
                      <td key={i} className={cn("px-3 py-1.5 text-right tabular-nums", args[0] == null ? "text-muted-foreground/40" : "text-foreground")}>
                        {fmtNum(args[0], args[1], args[2])}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums hidden sm:table-cell">{fmtMC(p.marketCap)}</td>
                  </tr>
                ))}
                {avg && rows.length > 1 && (
                  <tr className="bg-blue-50/70 dark:bg-blue-950/30 font-semibold border-t border-blue-200/50 dark:border-blue-800/30">
                    <td className="px-3 py-1.5 text-blue-700 dark:text-blue-400 text-[13px]">{isEn ? "Peer Avg" : "피어 평균"}</td>
                    <td className="px-3 py-1.5 text-right text-blue-700 dark:text-blue-400 tabular-nums">{fmtNum(avg.pbr, 2, "x")}</td>
                    <td className="px-3 py-1.5 text-right text-blue-700 dark:text-blue-400 tabular-nums">{fmtNum(avg.per_trailing, 1, "x")}</td>
                    <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-400 tabular-nums hidden sm:table-cell">{fmtNum(avg.per_fwd, 1, "x")}</td>
                    <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-400 tabular-nums">{fmtNum(avg.ev_ebitda, 1, "x")}</td>
                    <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-400 tabular-nums hidden sm:table-cell">{fmtNum(avg.ev_sales, 2, "x")}</td>
                    <td className="px-3 py-1.5 text-right text-blue-700 dark:text-blue-400 tabular-nums">{fmtNum(avg.roe, 1, "%")}</td>
                    <td className="px-3 py-1.5 text-right text-blue-700 dark:text-blue-400 tabular-nums">{fmtNum(avg.operating_margin, 1, "%")}</td>
                    <td className="px-2 py-1.5 text-right text-blue-700 dark:text-blue-400 tabular-nums hidden sm:table-cell">{fmtMC(avg.marketCap)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border/50">
            {isEn
              ? <>Live data via Yahoo Finance · <span className="sm:hidden">Mobile: P/E Fwd, EV/Sales, Mkt Cap visible on desktop · </span>EV/Sales = (Mkt Cap + Net Debt) ÷ Revenue</>
              : <>실측 = Yahoo Finance 자동 수집 · <span className="sm:hidden">모바일: P/E Fwd·EV/Sales·시총은 PC에서 확인 · </span>EV/Sales = (시총+순차입금)÷매출</>
            }
          </p>
        </div>
      )}
    </div>
  );
}


// ── 포트폴리오 추가 CTA (분석 완료 후) ──────────────────────────────────────
/* ── 종목 뉴스 타임라인 ─────────────────────────────────────────────────────── */
interface StockNewsEvent {
  date: string;
  dateLabel: string;
  event: string;
  detail: string;
  importance: "high" | "medium" | "low";
  category: string;
  source?: string;
  url?: string;
}

const NEWS_IMPORTANCE: Record<string, { dot: string; badge: string; label: string; labelEn: string; ring: string }> = {
  high:   { dot: "bg-rose-500",  badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",    label: "핵심", labelEn: "Key",   ring: "border-l-rose-500"  },
  medium: { dot: "bg-amber-500", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", label: "주요", labelEn: "Major", ring: "border-l-amber-500" },
  low:    { dot: "bg-slate-400", badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",   label: "참고", labelEn: "Ref",   ring: "border-l-slate-300 dark:border-l-slate-600" },
};

const NEWS_CAT_COLOR: Record<string, string> = {
  실적: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  계약: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  규제: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  시장: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  인사: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "M&A": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  기술: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  외교: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  Earnings: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  Contract: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  Regulation: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  Market: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  Technology: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
};

// ─── 주요 공시 패널 ────────────────────────────────────────────────────────────
interface DartDisclosure {
  date: string;
  reportName: string;
  corpName: string;
  dartUrl: string;
}

function disclosureCategory(name: string): { label: string; cls: string } {
  if (/사업보고서|분기보고서|반기보고서/.test(name))
    return { label: "정기", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" };
  if (/잠정실적|실적/.test(name))
    return { label: "실적", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
  if (/유상증자|무상증자/.test(name))
    return { label: "증자", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
  if (/자기주식/.test(name))
    return { label: "자사주", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" };
  if (/주요사항/.test(name))
    return { label: "주요", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" };
  return { label: "", cls: "" };
}

function StockDisclosurePanel({ ticker, isEn = false }: { ticker: string; isEn?: boolean }) {
  const [items, setItems] = useState<DartDisclosure[]>([]);
  const [loading, setLoading] = useState(true);

  const isKR = ticker.endsWith(".KS") || ticker.endsWith(".KQ") || /^\d{6}$/.test(ticker);

  useEffect(() => {
    if (!isKR) { setLoading(false); return; }
    let cancelled = false;
    fetch(getApiUrl(`/api/market-data/dart-disclosures?ticker=${encodeURIComponent(ticker)}`))
      .then(r => r.ok ? r.json() : [])
      .then((d: DartDisclosure[]) => { if (!cancelled) { setItems(d ?? []); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isKR]);

  if (!isKR || (!loading && items.length === 0)) return null;

  return (
    <div className="bg-card rounded-[var(--radius)] p-5 sm:p-6 print:hidden shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-muted-foreground/50" />
        <h2 className="text-base font-semibold text-foreground">
          {isEn ? "Recent Disclosures" : "주요 공시"}
        </h2>
        <span className="text-[11px] text-muted-foreground/40">
          {isEn ? "last 90 days · DART" : "최근 90일 · DART"}
        </span>
        {!loading && items.length > 0 && (
          <span className="ml-auto text-[11px] font-mono text-muted-foreground/35">{items.length}</span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="h-3 w-16 rounded bg-muted/60 shrink-0" />
              <div className="h-3 rounded bg-muted/40 flex-1" style={{ width: `${55 + (i * 11) % 35}%` }} />
              <div className="h-3 w-8 rounded bg-muted/30 shrink-0" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {items.map((item, i) => {
            const cat = disclosureCategory(item.reportName);
            const dateParts = item.date.split("-");
            const dateLabel = dateParts.length === 3
              ? `${dateParts[1]}/${dateParts[2]}`
              : item.date;
            return (
              <li key={i} className="py-2.5 first:pt-0 last:pb-0">
                <a
                  href={item.dartUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 group"
                >
                  <span className="text-[11px] font-mono text-muted-foreground/50 shrink-0 w-10 tabular-nums">
                    {dateLabel}
                  </span>
                  <span className="text-[13px] text-foreground/80 flex-1 leading-snug group-hover:text-foreground transition-colors line-clamp-1">
                    {item.reportName}
                  </span>
                  {cat.label && (
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0", cat.cls)}>
                      {cat.label}
                    </span>
                  )}
                  <ExternalLink className="w-3 h-3 text-muted-foreground/25 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── 공시 이력 타임라인 패널 ──────────────────────────────────────────────────
interface FilingHistoryItem {
  id: number;
  rceptNo?: string;
  accessionNo?: string;
  reportType?: string;
  formType?: string;
  fiscalYear: number;
  periodCode: string;
  filedAt: string | null;
  hasSections: boolean;
}
interface FilingDiffItem {
  fromRceptNo?: string;
  toRceptNo?: string;
  fromAccessionNo?: string;
  toAccessionNo?: string;
  sectionKey: string;
  changesJson: { added: string[]; removed: string[]; modified: string[] } | null;
  aiSummary: string | null;
}

const PERIOD_LABELS: Record<string, string> = {
  FY: "사업보고서", H1: "반기", Q1: "1분기", Q2: "반기", Q3: "3분기",
};
const FORM_COLORS: Record<string, string> = {
  FY: "bg-violet-500/15 text-violet-400",
  H1: "bg-blue-500/15 text-blue-400",
  Q1: "bg-sky-500/15 text-sky-400",
  Q2: "bg-sky-500/15 text-sky-400",
  Q3: "bg-sky-500/15 text-sky-400",
};

function FilingTimelinePanel({ ticker, isEn = false }: { ticker: string; isEn?: boolean }) {
  const isKR = /^\d{6}$/.test(ticker) || ticker.endsWith(".KS") || ticker.endsWith(".KQ");
  const isUS = !isKR;

  const [filings, setFilings]   = useState<FilingHistoryItem[]>([]);
  const [diffs, setDiffs]       = useState<FilingDiffItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const baseUrl = isUS ? `/api/filings/us/${encodeURIComponent(ticker)}` : `/api/filings/${encodeURIComponent(ticker)}`;
  const syncUrl = isUS ? `/api/filings/us/sync/${encodeURIComponent(ticker)}` : `/api/filings/sync/${encodeURIComponent(ticker)}`;

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch(getApiUrl(`${baseUrl}/history`)).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(getApiUrl(`${baseUrl}/diffs?section_key=business_content`)).then(r => r.ok ? r.json() : null).catch(() => null),
      // US diff uses different key
      isUS ? fetch(getApiUrl(`${baseUrl}/diffs?section_key=business`)).then(r => r.ok ? r.json() : null).catch(() => null) : null,
    ]).then(([histData, diffsKR, diffsUS]) => {
      setFilings(histData?.filings ?? []);
      const rawDiffs = isUS ? (diffsUS?.diffs ?? []) : (diffsKR?.diffs ?? []);
      setDiffs(rawDiffs);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, [ticker]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch(getApiUrl(syncUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      load();
    } catch {}
    setSyncing(false);
  };

  const getDiffForFiling = (filing: FilingHistoryItem): FilingDiffItem | undefined => {
    const key = isUS ? filing.accessionNo : filing.rceptNo;
    return diffs.find(d => (d.toRceptNo === key) || (d.toAccessionNo === key));
  };

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  if (loading) return (
    <div className="bg-card rounded-[var(--radius)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 mb-4">
        <History className="w-4 h-4 text-muted-foreground/50" />
        <div className="h-3 w-32 rounded bg-muted/60 animate-pulse" />
      </div>
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 rounded-[var(--radius)] bg-muted/30 animate-pulse" />
        ))}
      </div>
    </div>
  );

  return (
    <div className="bg-card rounded-[var(--radius)] p-5 print:hidden shadow-[var(--shadow-card)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <History className="w-4 h-4 text-muted-foreground/50" />
        <h2 className="text-base font-semibold text-foreground">
          {isEn ? "Filing History" : "공시 이력"}
        </h2>
        <span className="text-[11px] text-muted-foreground/40">
          {isUS ? "SEC EDGAR" : "DART"}
        </span>
        {filings.length > 0 && (
          <span className="ml-auto text-[11px] font-mono text-muted-foreground/35">{filings.length}</span>
        )}
        <button
          onClick={handleSync}
          disabled={syncing}
          className="ml-auto flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-muted/50 hover:bg-muted/80 text-muted-foreground transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {isEn ? "Sync" : "동기화"}
        </button>
      </div>

      {filings.length === 0 ? (
        <div className="py-8 flex flex-col items-center gap-3 text-center">
          <p className="text-[13px] text-muted-foreground/60">
            {isEn ? "No filing history stored yet." : "저장된 공시 이력이 없습니다."}
          </p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {isEn ? "Fetch & Store Filings" : "공시 이력 동기화하기"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filings.map((filing) => {
            const key = isUS ? (filing.accessionNo ?? "") : (filing.rceptNo ?? "");
            const diff = getDiffForFiling(filing);
            const label = isUS
              ? (filing.formType ?? filing.periodCode)
              : (PERIOD_LABELS[filing.periodCode] ?? filing.reportType ?? filing.periodCode);
            const colorCls = FORM_COLORS[filing.periodCode] ?? "bg-muted/20 text-muted-foreground";
            const isOpen = expanded.has(key);
            const hasChanges = diff && diff.changesJson && (
              diff.changesJson.added.length > 0 ||
              diff.changesJson.removed.length > 0 ||
              diff.changesJson.modified.length > 0
            );

            return (
              <div key={key} className="rounded-[var(--radius)] border border-border/40 overflow-hidden">
                <button
                  onClick={() => hasChanges && toggleExpand(key)}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors ${hasChanges ? "hover:bg-muted/20 cursor-pointer" : "cursor-default"}`}
                >
                  {/* 연도 + 분기 */}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${colorCls}`}>
                    {label}
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums text-foreground/80">
                    {filing.fiscalYear}
                  </span>
                  <span className="text-[11px] text-muted-foreground/40 font-mono">
                    {filing.filedAt?.slice(0, 7) ?? "—"}
                  </span>
                  {/* 섹션 저장 여부 */}
                  {filing.hasSections ? (
                    <span className="text-[10px] text-emerald-400 ml-1">●</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/25 ml-1">○</span>
                  )}
                  {/* diff 요약 뱃지 */}
                  {hasChanges && (
                    <div className="flex items-center gap-1.5 ml-auto mr-1">
                      {diff!.changesJson!.added.length > 0 && (
                        <span className="text-[10px] font-bold text-emerald-400">+{diff!.changesJson!.added.length}</span>
                      )}
                      {diff!.changesJson!.removed.length > 0 && (
                        <span className="text-[10px] font-bold text-red-400">−{diff!.changesJson!.removed.length}</span>
                      )}
                      {diff!.changesJson!.modified.length > 0 && (
                        <span className="text-[10px] font-bold text-amber-400">~{diff!.changesJson!.modified.length}</span>
                      )}
                    </div>
                  )}
                  {hasChanges && (
                    <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  )}
                </button>

                {/* diff 상세 */}
                {isOpen && diff && diff.changesJson && (
                  <div className="px-3.5 pb-3.5 pt-1 border-t border-border/30 space-y-3">
                    {/* AI 요약 */}
                    {diff.aiSummary && (
                      <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
                        {diff.aiSummary}
                      </p>
                    )}
                    {/* Added */}
                    {diff.changesJson.added.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold text-emerald-500 dark:text-emerald-400 uppercase tracking-widest mb-1.5">
                          {isEn ? "Added" : "신규 추가"}
                        </p>
                        <ul className="space-y-1">
                          {diff.changesJson.added.map((item, i) => (
                            <li key={i} className="flex gap-2 text-[12px] text-foreground/70">
                              <span className="text-emerald-400 mt-0.5 shrink-0">+</span>
                              <span className="leading-snug">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {/* Removed */}
                    {diff.changesJson.removed.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold text-red-500 dark:text-red-400 uppercase tracking-widest mb-1.5">
                          {isEn ? "Removed" : "사라진 항목"}
                        </p>
                        <ul className="space-y-1">
                          {diff.changesJson.removed.map((item, i) => (
                            <li key={i} className="flex gap-2 text-[12px] text-foreground/70">
                              <span className="text-red-400 mt-0.5 shrink-0">−</span>
                              <span className="leading-snug">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {/* Modified */}
                    {diff.changesJson.modified.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-widest mb-1.5">
                          {isEn ? "Changed" : "변화된 항목"}
                        </p>
                        <ul className="space-y-1">
                          {diff.changesJson.modified.map((item, i) => (
                            <li key={i} className="flex gap-2 text-[12px] text-foreground/70">
                              <span className="text-amber-400 mt-0.5 shrink-0">~</span>
                              <span className="leading-snug">{item}</span>
                            </li>
                          ))}
                        </ul>
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

// ─── 배당 정보 패널 ────────────────────────────────────────────────────────────
interface DividendInfo {
  dividendRate: number | null;
  dividendYield: number | null;
  exDividendDate: string | null;
  payoutRatio: number | null;
  fiveYearAvgDividendYield: number | null;
  lastDividendValue: number | null;
  lastDividendDate: string | null;
  history: { date: string; amount: number }[];
}

function DividendInfoPanel({ ticker, isEn = false }: { ticker: string; isEn?: boolean }) {
  const [info, setInfo] = useState<DividendInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const isKR = ticker.endsWith(".KS") || ticker.endsWith(".KQ") || /^\d{6}$/.test(ticker);

  useEffect(() => {
    let cancelled = false;
    fetch(getApiUrl(`/api/market-data/dividend-info?ticker=${encodeURIComponent(ticker)}`))
      .then(r => r.ok ? r.json() : null)
      .then((d: DividendInfo | null) => { if (!cancelled) { setInfo(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (!loading && !info) return null;

  const fmtDiv = (v: number | null) => {
    if (v == null) return "—";
    return isKR ? `${Math.round(v).toLocaleString("ko-KR")}원` : `$${v.toFixed(2)}`;
  };
  const fmtPct = (v: number | null, multiply = false) => {
    if (v == null) return "—";
    return `${(multiply ? v * 100 : v).toFixed(2)}%`;
  };
  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const [, m, day] = d.split("-");
    return `${parseInt(m)}/${parseInt(day)}`;
  };

  const maxAmt = info?.history?.length ? Math.max(...info.history.map(h => h.amount)) : 1;

  return (
    <div className="bg-card rounded-[var(--radius)] p-5 sm:p-6 print:hidden shadow-[var(--shadow-card)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-muted-foreground/50" />
        <h2 className="text-base font-semibold text-foreground">
          {isEn ? "Dividend Info" : "배당 정보"}
        </h2>
        {!loading && info?.dividendYield != null && (
          <div className="ml-auto flex items-baseline gap-1">
            <span className="text-xs text-muted-foreground/60">{isEn ? "Div. Yield" : "시가배당률"}</span>
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {fmtPct(info.dividendYield, true)}
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="grid grid-cols-2 gap-2.5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-muted/40 rounded-[var(--radius)] h-14" />
            ))}
          </div>
          <div className="flex items-end gap-2 mt-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="h-2 w-full rounded bg-muted/30" />
                <div className="h-5 w-full rounded bg-muted/40" style={{ height: `${12 + (i * 7) % 24}px` }} />
                <div className="h-2 w-4 rounded bg-muted/25" />
              </div>
            ))}
          </div>
        </div>
      ) : info ? (
        <>
          {/* 지표 그리드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
            {[
              { label: isEn ? "Annual Div." : "연간 배당금", value: fmtDiv(info.dividendRate) },
              { label: isEn ? "Ex-Div. Date" : "배당락일", value: fmtDate(info.exDividendDate) },
              { label: isEn ? "Payout Ratio" : "배당성향", value: fmtPct(info.payoutRatio, true) },
              { label: isEn ? "5Y Avg Yield" : "5년 평균수익률", value: info.fiveYearAvgDividendYield != null ? `${info.fiveYearAvgDividendYield.toFixed(2)}%` : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted/30 rounded-[var(--radius)] px-3 py-2.5 text-center">
                <div className="text-[10.5px] text-muted-foreground/55 mb-1 leading-tight">{label}</div>
                <div className="text-[13px] font-semibold text-foreground tabular-nums">{value}</div>
              </div>
            ))}
          </div>

          {/* 배당 이력 인라인 바 차트 */}
          {info.history.length > 0 && (
            <div>
              <p className="text-[10.5px] text-muted-foreground/45 mb-2">
                {isEn ? "Dividend History" : "배당 이력"}
              </p>
              <div className="flex items-end gap-1.5">
                {info.history.map((h) => {
                  const barH = Math.max(6, (h.amount / maxAmt) * 44);
                  const amtLabel = isKR
                    ? Math.round(h.amount).toLocaleString("ko-KR")
                    : h.amount.toFixed(2);
                  return (
                    <div key={h.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <span className="text-[9px] font-mono text-muted-foreground/45 tabular-nums truncate w-full text-center">
                        {amtLabel}
                      </span>
                      <div
                        className="w-full rounded-sm bg-emerald-400/55 dark:bg-emerald-500/45 transition-all"
                        style={{ height: `${barH}px` }}
                      />
                      <span className="text-[9px] text-muted-foreground/35 tabular-nums">
                        {h.date}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// ─── 공매도 현황 패널 ──────────────────────────────────────────────────────────
interface ShortInfo {
  loanRate: number | null;
  loanQty: number | null;
  loanAmt: number | null;
  shortOverYn: string | null;
  shortSaleYn: string | null;
  lastShortQty: number | null;
  shortAmt: number | null;
  shortRatio: number | null;
}

function fmtShortAmt(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  if (v >= 1e8)  return `${Math.round(v / 1e8)}억`;
  if (v >= 1e4)  return `${Math.round(v / 1e4)}만`;
  return v.toLocaleString("ko-KR");
}

function ShortSellingPanel({ ticker, isEn = false }: { ticker: string; isEn?: boolean }) {
  const [info, setInfo] = useState<ShortInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const isKR = /^\d{6}$/.test(ticker) || ticker.endsWith(".KS") || ticker.endsWith(".KQ");

  useEffect(() => {
    if (!isKR) { setLoading(false); return; }
    let cancelled = false;
    fetch(getApiUrl(`/api/market-data/short-info?ticker=${encodeURIComponent(ticker)}`))
      .then(r => r.ok ? r.json() : null)
      .then((d: ShortInfo | null) => { if (!cancelled) { setInfo(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isKR]);

  if (!isKR || (!loading && !info)) return null;

  const isOverheat = info?.shortOverYn === "Y";
  const canShort   = info?.shortSaleYn !== "N";
  const hasShortAmt = info?.shortAmt != null;
  const hasLoanAmt  = info?.loanAmt  != null;

  const items = [
    { label: isEn ? "Loan Rate" : "대차잔고비율",  value: info?.loanRate   != null ? `${info.loanRate.toFixed(2)}%`   : "—", highlight: (info?.loanRate ?? 0) > 5 },
    ...(hasLoanAmt ? [{ label: isEn ? "Loan Bal." : "대차잔고금액", value: fmtShortAmt(info?.loanAmt ?? null), highlight: false }] : []),
    { label: isEn ? "Short Ratio" : "공매도잔고율", value: info?.shortRatio != null ? `${info.shortRatio.toFixed(2)}%` : "—", highlight: (info?.shortRatio ?? 0) >= 2 },
    ...(hasShortAmt ? [{ label: isEn ? "Short Bal." : "공매도잔고금액", value: fmtShortAmt(info?.shortAmt ?? null), highlight: false }] : []),
    { label: isEn ? "Short Avail." : "공매도 가능", value: canShort ? (isEn ? "Yes" : "가능") : (isEn ? "No" : "불가"),      highlight: !canShort },
  ];

  return (
    <div className="rounded-[var(--radius)] border border-border/40 bg-card/60 backdrop-blur-sm p-4 mb-3">
      <div className="flex items-center gap-2 mb-4">
        <TrendingDown className="w-4 h-4 text-muted-foreground/50" />
        <h2 className="text-base font-semibold text-foreground">{isEn ? "Short Selling" : "공매도 현황"}</h2>
        {!loading && isOverheat && (
          <span className="ml-auto text-xs font-semibold text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full">
            {isEn ? "Overheat" : "과열"}
          </span>
        )}
        {!loading && !isOverheat && info && (
          <span className="ml-auto text-xs text-muted-foreground/50">{isEn ? "Normal" : "정상"}</span>
        )}
      </div>
      {loading ? (
        <div className="grid grid-cols-4 gap-2.5 animate-pulse">
          {[0,1,2,3].map(i => <div key={i} className="h-12 rounded-lg bg-muted/30" />)}
        </div>
      ) : info ? (
        <div className={[
          "grid gap-2.5",
          items.length <= 3 ? "grid-cols-3" :
          items.length === 4 ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-5",
        ].join(" ")}>
          {items.map(({ label, value, highlight }) => (
            <div key={label} className="rounded-lg bg-muted/20 px-2 py-2.5 text-center">
              <div className="text-[10px] text-muted-foreground/60 mb-1 leading-tight">{label}</div>
              <div className={`text-sm font-semibold tabular-nums ${highlight ? "text-red-500" : "text-foreground"}`}>{value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── 애널리스트 컨센서스 패널 ──────────────────────────────────────────────────
interface AnalystConsensus {
  strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; total: number;
  recommendationKey: string | null;
  currency: string;
  targetLowPrice:  number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  trendHistory: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[];
  firmTargets: { firm: string; target: number; grade: string; date: string }[];
  earningsEstimates: { period: string; epsAvg: number | null; epsLow: number | null; epsHigh: number | null; epsNumAnalysts: number | null; revAvg: number | null; revNumAnalysts: number | null }[];
}

function AnalystConsensusPanel({ ticker, currentPrice, isEn = false }: { ticker: string; currentPrice?: number | null; isEn?: boolean }) {
  const [info, setInfo] = useState<AnalystConsensus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(getApiUrl(`/api/market-data/analyst-consensus?ticker=${encodeURIComponent(ticker)}`))
      .then(r => r.ok ? r.json() : null)
      .then((d: AnalystConsensus | null) => { if (!cancelled) { setInfo(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (!loading && !info) return null;

  const isKRW = info?.currency === "KRW";

  const buyCount  = (info?.strongBuy ?? 0) + (info?.buy ?? 0);
  const holdCount = info?.hold ?? 0;
  const sellCount = (info?.sell ?? 0) + (info?.strongSell ?? 0);
  const total     = info?.total ?? 1;
  const buyPct    = Math.round((buyCount / total) * 100);
  const holdPct   = Math.round((holdCount / total) * 100);
  const sellPct   = 100 - buyPct - holdPct;

  const keyLabel: Record<string, { label: string; color: string }> = {
    "strong_buy": { label: isEn ? "Strong Buy" : "강력매수", color: "text-emerald-500" },
    "buy":        { label: isEn ? "Buy" : "매수",           color: "text-emerald-400" },
    "hold":       { label: isEn ? "Hold" : "중립",          color: "text-amber-400" },
    "sell":       { label: isEn ? "Sell" : "매도",          color: "text-red-400" },
    "strong_sell":{ label: isEn ? "Strong Sell" : "강력매도", color: "text-red-500" },
  };
  const key = info?.recommendationKey ?? "";
  const consensus = keyLabel[key] ?? { label: key, color: "text-foreground" };

  // 3개월 추이 분석 (0m vs -1m)
  const th = info?.trendHistory ?? [];
  const trendDiff = th.length >= 2 ? (() => {
    const cur = th[0]; const prev = th[1];
    return {
      buyDelta:  (cur.strongBuy + cur.buy) - (prev.strongBuy + prev.buy),
      holdDelta: cur.hold - prev.hold,
      sellDelta: (cur.sell + cur.strongSell) - (prev.sell + prev.strongSell),
    };
  })() : null;

  // 기관별 목표주가 (미국) — 상위 10개만
  const firmTargets = (info?.firmTargets ?? []).slice(0, 10);

  // 실적 전망 포매터
  const fmtEps = (v: number | null) => {
    if (v == null) return "—";
    return isKRW ? `${Math.round(v).toLocaleString()}원` : `$${v.toFixed(2)}`;
  };
  const fmtRev = (v: number | null) => {
    if (v == null) return "—";
    if (isKRW) {
      const tril = v / 1e12;
      return tril >= 1 ? `${tril.toFixed(1)}조` : `${(v / 1e8).toFixed(0)}억`;
    }
    const bil = v / 1e9;
    return bil >= 1000 ? `$${(bil / 1000).toFixed(1)}T` : `$${bil.toFixed(0)}B`;
  };

  const gradeColor = (g: string) => {
    const l = g.toLowerCase();
    if (l.includes("strong buy") || l.includes("outperform") || l.includes("overweight")) return "text-emerald-500";
    if (l.includes("buy")) return "text-emerald-400";
    if (l.includes("hold") || l.includes("neutral") || l.includes("market perform")) return "text-amber-400";
    return "text-red-400";
  };

  return (
    <div className="rounded-[var(--radius)] border border-border/40 bg-card/60 backdrop-blur-sm p-4 mb-3">
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 className="w-4 h-4 text-muted-foreground/50" />
        <h2 className="text-base font-semibold text-foreground">{isEn ? "Analyst Consensus" : "애널리스트 컨센서스"}</h2>
        {!loading && info && (
          <span className={`ml-auto text-xs font-semibold ${consensus.color}`}>{consensus.label}</span>
        )}
      </div>
      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-4 rounded bg-muted/30 w-full" />
          <div className="h-24 rounded bg-muted/20" />
          <div className="h-20 rounded bg-muted/20" />
        </div>
      ) : info ? (
        <div className="space-y-3">
          {/* 매수/중립/매도 스택 바 */}
          <div className="flex rounded-full overflow-hidden h-2.5 gap-0.5">
            {buyPct  > 0 && <div style={{ width: `${buyPct}%`  }} className="bg-emerald-500 rounded-l-full" />}
            {holdPct > 0 && <div style={{ width: `${holdPct}%` }} className="bg-amber-400" />}
            {sellPct > 0 && <div style={{ width: `${sellPct}%` }} className="bg-red-400 rounded-r-full" />}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground/60">
            <span className="text-emerald-500">{isEn ? "Buy" : "매수"} {buyPct}% ({buyCount})</span>
            <span className="text-amber-400">{isEn ? "Hold" : "중립"} {holdPct}% ({holdCount})</span>
            <span className="text-red-400">{isEn ? "Sell" : "매도"} {sellPct}% ({sellCount})</span>
          </div>

          {/* 전달 대비 추이 */}
          {trendDiff && (trendDiff.buyDelta !== 0 || trendDiff.holdDelta !== 0 || trendDiff.sellDelta !== 0) && (
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
              <span>{isEn ? "vs last month" : "전달 대비"}</span>
              {trendDiff.buyDelta !== 0 && (
                <span className={trendDiff.buyDelta > 0 ? "text-emerald-500" : "text-red-400"}>
                  {isEn ? "Buy" : "매수"} {trendDiff.buyDelta > 0 ? "+" : ""}{trendDiff.buyDelta}
                </span>
              )}
              {trendDiff.holdDelta !== 0 && (
                <span className={trendDiff.holdDelta > 0 ? "text-amber-400" : "text-muted-foreground/50"}>
                  {isEn ? "Hold" : "중립"} {trendDiff.holdDelta > 0 ? "+" : ""}{trendDiff.holdDelta}
                </span>
              )}
              {trendDiff.sellDelta !== 0 && (
                <span className={trendDiff.sellDelta < 0 ? "text-emerald-500" : "text-red-400"}>
                  {isEn ? "Sell" : "매도"} {trendDiff.sellDelta > 0 ? "+" : ""}{trendDiff.sellDelta}
                </span>
              )}
            </div>
          )}

          {/* ── 한국 주식: 목표주가 레인지 바 ── */}
          {isKRW && info.targetMeanPrice != null && (() => {
            const low  = info.targetLowPrice  ?? info.targetMeanPrice!;
            const mean = info.targetMeanPrice!;
            const high = info.targetHighPrice ?? info.targetMeanPrice!;
            const span = high - low || 1;
            const pct  = (v: number) => Math.max(0, Math.min(100, ((v - low) / span) * 100));

            const meanPct = pct(mean);
            const curPct  = currentPrice != null ? pct(currentPrice) : null;
            const upside  = currentPrice ? ((mean - currentPrice) / currentPrice) * 100 : null;

            const fmtK = (v: number) => {
              if (v >= 10_000) {
                const man = v / 10_000;
                const str = man >= 100
                  ? `${Math.round(man)}만원`
                  : `${parseFloat(man.toFixed(1))}만원`;
                return str;
              }
              return `${Math.round(v).toLocaleString()}원`;
            };

            return (
              <div className="pt-2 border-t border-border/20 space-y-3">
                <div className="text-[10px] text-muted-foreground/50">{isEn ? "Target Price Range" : "목표주가 분포"}</div>

                {/* ── 레인지 바 ── */}
                <div className="relative h-10 select-none">
                  {/* 트랙 */}
                  <div className="absolute top-[18px] left-0 right-0 h-[3px] rounded-full bg-gradient-to-r from-amber-500/30 via-emerald-400/40 to-amber-500/30" />

                  {/* 현재가 세로선 */}
                  {curPct != null && (
                    <div
                      className="absolute top-[10px] w-[2px] h-[20px] rounded-full bg-foreground/25"
                      style={{ left: `${curPct}%`, transform: "translateX(-50%)" }}
                    />
                  )}

                  {/* 최저 점 */}
                  <div className="absolute top-[15px] left-0 w-[7px] h-[7px] rounded-full bg-muted-foreground/30 border border-background" style={{ transform: "translateX(-50%)" }} />

                  {/* 최고 점 */}
                  <div className="absolute top-[15px] right-0 w-[7px] h-[7px] rounded-full bg-muted-foreground/30 border border-background" style={{ transform: "translateX(50%)" }} />

                  {/* 컨센서스 다이아몬드 */}
                  <div
                    className="absolute top-[12px] w-[13px] h-[13px] rounded-sm bg-emerald-500 border-2 border-background shadow rotate-45"
                    style={{ left: `${meanPct}%`, transform: `translateX(-50%) rotate(45deg)` }}
                  />

                  {/* 컨센서스 라벨 (위) */}
                  <div
                    className="absolute top-0 text-[9px] font-semibold text-emerald-400 whitespace-nowrap"
                    style={{ left: `${meanPct}%`, transform: "translateX(-50%)" }}
                  >
                    {isEn ? "Consensus" : "컨센서스"}
                  </div>
                </div>

                {/* ── 수치 행 ── */}
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[9px] text-muted-foreground/50">{isEn ? "Low" : "최저"}</div>
                    <div className="text-[10px] font-medium tabular-nums text-foreground/60">{fmtK(low)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] font-bold tabular-nums text-foreground">{fmtK(mean)}</div>
                    {upside != null && (
                      <div className={`text-[10px] font-semibold ${upside >= 0 ? "text-emerald-500" : "text-red-400"}`}>
                        {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                      </div>
                    )}
                    {currentPrice != null && (
                      <div className="text-[9px] text-muted-foreground/40 mt-0.5">
                        {isEn ? "vs current" : "현재가 대비"}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-muted-foreground/50">{isEn ? "High" : "최고"}</div>
                    <div className="text-[10px] font-medium tabular-nums text-foreground/60">{fmtK(high)}</div>
                  </div>
                </div>

                {/* 현재가 범례 */}
                {curPct != null && currentPrice != null && (
                  <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50">
                    <div className="w-2.5 h-[2px] bg-foreground/25 rounded-full" />
                    <span>{isEn ? "Current price" : "현재가"} {fmtK(currentPrice)}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── 미국 주식: 기관별 목표주가 ── */}
          {!isKRW && firmTargets.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border/20">
              <div className="text-[10px] text-muted-foreground/50 mb-1.5">{isEn ? "Target Price by Firm" : "기관별 목표주가"}</div>
              {firmTargets.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className={`shrink-0 text-[9px] font-medium ${gradeColor(f.grade)}`}>{f.grade || "—"}</span>
                  <span className="flex-1 truncate text-foreground/70">{f.firm}</span>
                  <span className="shrink-0 text-muted-foreground/40">{f.date.slice(5)}</span>
                  <span className="shrink-0 tabular-nums font-semibold text-foreground/80">${f.target}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── 미국 주식: 실적 전망 (EPS / 매출) ── */}
          {!isKRW && (info.earningsEstimates ?? []).length > 0 && (
            <div className="pt-1 border-t border-border/20">
              <div className="text-[10px] text-muted-foreground/50 mb-2">{isEn ? "Earnings Estimates" : "실적 전망"}</div>
              <div className="grid grid-cols-2 gap-2">
                {(info.earningsEstimates ?? []).map((e) => (
                  <div key={e.period} className="rounded-lg bg-muted/20 px-3 py-2.5 space-y-1.5">
                    <div className="text-[10px] font-semibold text-muted-foreground/60">
                      {e.period === "0y" ? (isEn ? "This Year" : "올해") : (isEn ? "Next Year" : "내년")}
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] text-muted-foreground/50">EPS</span>
                      <span className="text-xs font-semibold tabular-nums text-foreground">{fmtEps(e.epsAvg)}</span>
                    </div>
                    {e.epsLow != null && e.epsHigh != null && (
                      <div className="text-[9px] text-muted-foreground/40 text-right tabular-nums">
                        {fmtEps(e.epsLow)} ~ {fmtEps(e.epsHigh)}
                      </div>
                    )}
                    {e.revAvg != null && (
                      <div className="flex justify-between items-baseline border-t border-border/10 pt-1">
                        <span className="text-[10px] text-muted-foreground/50">{isEn ? "Rev" : "매출"}</span>
                        <span className="text-xs font-semibold tabular-nums text-foreground">{fmtRev(e.revAvg)}</span>
                      </div>
                    )}
                    {e.epsNumAnalysts != null && (
                      <div className="text-[9px] text-muted-foreground/30 text-right">{e.epsNumAnalysts}{isEn ? " analysts" : "명"}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground/40 text-right">{info.total}{isEn ? " analysts" : "명 애널리스트"}</div>
        </div>
      ) : null}
    </div>
  );
}

// ─── 주요 주주 현황 패널 ───────────────────────────────────────────────────────
interface MajorShareholders {
  insidersPercent:     number | null;
  institutionsPercent: number | null;
  institutionsCount:   number | null;
  topInstitutions: { name: string; pctHeld: number; pctChange: number | null; reportDate: string | null }[];
  dartHolders: { name: string; relate: string; pct: number; shares: number }[];
  insiderActivity: { period: string; buyCount: number; buyShares: number; sellCount: number; sellShares: number; netShares: number; totalInsider: number } | null;
  recentInsiderTrades: { name: string; relation: string; shares: number; value: number; date: string | null; text: string }[];
}

function MajorShareholdersPanel({ ticker, isEn = false }: { ticker: string; isEn?: boolean }) {
  const [info, setInfo] = useState<MajorShareholders | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(getApiUrl(`/api/market-data/major-shareholders?ticker=${encodeURIComponent(ticker)}`))
      .then(r => r.ok ? r.json() : null)
      .then((d: MajorShareholders | null) => { if (!cancelled) { setInfo(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (!loading && !info) return null;

  const retailPct = info
    ? Math.max(0, 100 - (info.insidersPercent ?? 0) * 100 - (info.institutionsPercent ?? 0) * 100)
    : 0;

  const relateLabel = (r: string) => {
    if (r.includes("최대주주 본인")) return isEn ? "Largest SH" : "최대주주";
    if (r.includes("특수관계인")) return isEn ? "Related" : "특수관계인";
    if (r.includes("계열회사")) return isEn ? "Affiliate" : "계열사";
    if (r.includes("5%") || r.includes("5%이상")) return isEn ? "5%+ SH" : "5% 이상";
    if (r.includes("임원")) return isEn ? "Executive" : "임원";
    return r;
  };

  const fmtShares = (n: number) => {
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억주`;
    if (n >= 1e4) return `${Math.round(n / 1e4)}만주`;
    return `${n.toLocaleString()}주`;
  };

  // 내부자 거래: Sale/Gift 구분
  const isSale = (text: string) => /sale/i.test(text);
  const isPurchase = (text: string) => /purchase|acquisition/i.test(text);

  return (
    <div className="rounded-[var(--radius)] border border-border/40 bg-card/60 backdrop-blur-sm p-4 mb-3">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-4 h-4 text-muted-foreground/50" />
        <h2 className="text-base font-semibold text-foreground">{isEn ? "Major Shareholders" : "주요 주주 현황"}</h2>
        {!loading && info?.institutionsCount != null && (
          <span className="ml-auto text-xs text-muted-foreground/50">
            {info.institutionsCount.toLocaleString()}{isEn ? " institutions" : "개 기관"}
          </span>
        )}
      </div>
      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 rounded bg-muted/30 w-full" />
          <div className="h-20 rounded bg-muted/20" />
        </div>
      ) : info ? (
        <div className="space-y-3">
          {/* 보유 구성 스택 바 */}
          {(info.insidersPercent != null || info.institutionsPercent != null) && (() => {
            const insPct  = Math.round((info.insidersPercent ?? 0) * 100 * 10) / 10;
            const instPct = Math.round((info.institutionsPercent ?? 0) * 100 * 10) / 10;
            const retPct  = Math.round(retailPct * 10) / 10;
            return (
              <div className="space-y-1.5">
                <div className="flex rounded-full overflow-hidden h-2 gap-0.5">
                  {insPct  > 0 && <div style={{ width: `${insPct}%`  }} className="bg-violet-500" />}
                  {instPct > 0 && <div style={{ width: `${instPct}%` }} className="bg-blue-500" />}
                  {retPct  > 0 && <div style={{ width: `${retPct}%`  }} className="bg-muted/40 rounded-r-full" />}
                </div>
                <div className="flex gap-3 text-[10px] text-muted-foreground/60">
                  <span><span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1" />{isEn ? "Insiders" : "내부자"} {insPct}%</span>
                  <span><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />{isEn ? "Institutions" : "기관"} {instPct}%</span>
                  <span><span className="inline-block w-2 h-2 rounded-full bg-muted/60 mr-1" />{isEn ? "Retail" : "소액주주"} {retPct}%</span>
                </div>
              </div>
            );
          })()}

          {/* ── 한국: DART 임원·주요주주 소유상황 ── */}
          {(info.dartHolders ?? []).length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border/20">
              <div className="text-[10px] text-muted-foreground/50 mb-1.5">{isEn ? "Key Shareholders (DART)" : "임원·주요주주 소유현황 (DART)"}</div>
              {(info.dartHolders ?? []).map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-foreground/80 truncate">{h.name}</span>
                    <span className="ml-1.5 text-[10px] text-muted-foreground/40">{relateLabel(h.relate)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">{fmtShares(h.shares)}</div>
                  <div className="text-xs font-semibold tabular-nums text-foreground shrink-0 w-12 text-right">{h.pct.toFixed(2)}%</div>
                </div>
              ))}
            </div>
          )}

          {/* ── 미국: 기관 보유 목록 ── */}
          {(info.dartHolders ?? []).length === 0 && info.topInstitutions.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border/20">
              <div className="text-[10px] text-muted-foreground/50 mb-1.5">{isEn ? "Top Institutions" : "주요 기관"}</div>
              {info.topInstitutions.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-foreground/80 truncate">{h.name}</div>
                  </div>
                  <div className="text-xs font-semibold tabular-nums text-foreground shrink-0">{h.pctHeld.toFixed(2)}%</div>
                  {h.pctChange != null && (
                    <div className={`text-[10px] tabular-nums shrink-0 w-10 text-right ${h.pctChange > 0 ? "text-emerald-500" : h.pctChange < 0 ? "text-red-400" : "text-muted-foreground/40"}`}>
                      {h.pctChange > 0 ? "▲" : h.pctChange < 0 ? "▼" : "─"}{Math.abs(h.pctChange).toFixed(2)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── 미국: 내부자 거래 요약 + 개별 거래 ── */}
          {info.insiderActivity && (
            <div className="pt-1 border-t border-border/20 space-y-2">
              <div className="text-[10px] text-muted-foreground/50">{isEn ? `Insider Activity (${info.insiderActivity.period})` : `내부자 거래 현황 (${info.insiderActivity.period})`}</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-emerald-500/8 px-2.5 py-2 text-center">
                  <div className="text-[10px] text-muted-foreground/50 mb-0.5">{isEn ? "Buy" : "매수"}</div>
                  <div className="text-sm font-semibold text-emerald-500 tabular-nums">{info.insiderActivity.buyCount}{isEn ? " tx" : "건"}</div>
                  <div className="text-[10px] text-muted-foreground/40">{(info.insiderActivity.buyShares / 1000).toFixed(0)}K{isEn ? " sh" : "주"}</div>
                </div>
                <div className="rounded-lg bg-red-400/8 px-2.5 py-2 text-center">
                  <div className="text-[10px] text-muted-foreground/50 mb-0.5">{isEn ? "Sell" : "매도"}</div>
                  <div className="text-sm font-semibold text-red-400 tabular-nums">{info.insiderActivity.sellCount}{isEn ? " tx" : "건"}</div>
                  <div className="text-[10px] text-muted-foreground/40">{(info.insiderActivity.sellShares / 1000).toFixed(0)}K{isEn ? " sh" : "주"}</div>
                </div>
              </div>
              {info.recentInsiderTrades.length > 0 && (
                <div className="space-y-1">
                  {info.recentInsiderTrades.slice(0, 5).map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <span className={`shrink-0 px-1 py-0.5 rounded text-[9px] font-semibold ${isPurchase(t.text) ? "bg-emerald-500/15 text-emerald-500" : isSale(t.text) ? "bg-red-400/15 text-red-400" : "bg-muted/20 text-muted-foreground/50"}`}>
                        {isPurchase(t.text) ? (isEn ? "Buy" : "매수") : isSale(t.text) ? (isEn ? "Sell" : "매도") : (isEn ? "Other" : "기타")}
                      </span>
                      <span className="flex-1 truncate text-foreground/70">{t.name}</span>
                      <span className="shrink-0 text-muted-foreground/40">{t.relation?.split(" ")[0]}</span>
                      <span className="shrink-0 tabular-nums text-foreground/60">{t.shares >= 1000 ? `${(t.shares/1000).toFixed(0)}K` : t.shares}</span>
                      {t.date && <span className="shrink-0 text-muted-foreground/30">{t.date.slice(5)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── catalyst_analysis 마크다운을 섹션별로 파싱해 시각화 ────────────────
function parseCatalystSections(raw: string) {
  const clean = raw.replace(/```[\s\S]*?```/g, "").replace(/\bVALUATION_DATA[\s\S]*?}/g, "");
  const parts = clean.split(/\n(?=##\s)/);
  const lead = parts[0]?.trim().startsWith("##") ? "" : parts[0]?.trim() ?? "";
  const sections: { emoji: string; title: string; body: string }[] = [];
  for (const part of parts) {
    if (!part.trim().startsWith("##")) continue;
    const nl = part.indexOf("\n");
    const header = nl > 0 ? part.slice(2, nl).trim() : part.slice(2).trim();
    const body = nl > 0 ? part.slice(nl + 1).trim() : "";
    // emoji prefix if any
    const emojiMatch = header.match(/^([\p{Emoji}\u200d]+)\s*/u);
    sections.push({ emoji: emojiMatch?.[1] ?? "", title: header.replace(/^[\p{Emoji}\u200d]+\s*/u, ""), body });
  }
  return { lead, sections };
}

function ForwardTimeline({ body, accent }: { body: string; accent: string }) {
  const lines = body.split("\n").filter(l => l.trim().startsWith("-") || l.trim().match(/^\d+\./));
  if (lines.length === 0) return <p className="text-[13px] text-muted-foreground/70 leading-relaxed">{body}</p>;
  return (
    <div className="relative pl-5">
      <div className="absolute left-[3px] top-1.5 bottom-3 w-px" style={{ background: `${accent}30` }} />
      <div className="space-y-4">
        {lines.map((line, i) => {
          const text = line.replace(/^[-\d.]\s*/, "").trim();
          const colonIdx = text.search(/[：:]/);
          const date = colonIdx > 0 ? text.slice(0, colonIdx).trim() : null;
          const event = colonIdx > 0 ? text.slice(colonIdx + 1).trim() : text;
          return (
            <div key={i} className="flex gap-3">
              <div className="shrink-0 w-1.5 h-1.5 rounded-full mt-[6px] relative z-10" style={{ background: accent }} />
              <div className="flex-1 min-w-0">
                {date && <span className="text-[10.5px] font-mono font-semibold block mb-0.5" style={{ color: accent }}>{date}</span>}
                <p className="text-[13px] text-foreground/80 leading-snug">{event}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CatalystBullets({ body }: { body: string }) {
  const lines = body.split("\n").filter(l => l.trim().startsWith("-") || l.trim().match(/^\d+\./));
  if (lines.length === 0) return <div className="prose-narrative"><MdBlock src={body} /></div>;
  return (
    <div className="space-y-3">
      {lines.map((line, i) => {
        const text = line.replace(/^[-\d.]\s*/, "").trim();
        const isUp = /상승|긍정|호재|↑|강|상향|매수|개선|증가|확장/.test(text);
        const isDown = /하락|부정|악재|↓|약|하향|매도|악화|감소|축소/.test(text);
        const dotColor = isUp ? "#10B981" : isDown ? "#F87171" : "#F59E0B";
        return (
          <div key={i} className="flex gap-2.5 items-start">
            <div className="w-1.5 h-1.5 rounded-full mt-[6px] shrink-0" style={{ background: dotColor }} />
            <p className="text-[13px] text-foreground/80 leading-relaxed flex-1">{text}</p>
          </div>
        );
      })}
    </div>
  );
}

function CatalystView({ step, isEn, accent }: { step: any; isEn: boolean; accent: string }) {
  const { lead, sections } = parseCatalystSections(step.content ?? "");
  // 섹션 키워드 매핑
  const timelineSection = sections.find(s => /타임라인|timeline/i.test(s.title));
  const catalystSection = sections.find(s => /촉매|catalyst/i.test(s.title));
  const flowSection = sections.find(s => /수급|flow|smart|money/i.test(s.title));
  const others = sections.filter(s => s !== timelineSection && s !== catalystSection && s !== flowSection);

  return (
    <div className="space-y-6">
      {lead && (
        <p className="text-[14px] leading-[1.85] text-foreground/80 border-l-2 pl-4 py-0.5 italic"
          style={{ borderLeftColor: `${accent}70` }}>{lead}</p>
      )}

      {/* 향후 주목할 이벤트 (핵심 촉매 + 타임라인 통합) */}
      {(catalystSection || timelineSection) && (
        <div>
          <p className="text-[10.5px] font-bold tracking-widest uppercase text-muted-foreground/50 mb-3">
            {isEn ? "Events to watch" : "향후 주목할 이벤트"}
          </p>
          {catalystSection && <CatalystBullets body={catalystSection.body} />}
        </div>
      )}

      {/* 수급 동향 */}
      {flowSection && (
        <div className="pt-5 border-t border-border/30">
          <p className="text-[10.5px] font-bold tracking-widest uppercase text-muted-foreground/50 mb-3">
            {isEn ? "💰 Smart money flow" : "💰 수급 동향"}
          </p>
          <div className="prose-narrative text-[13.5px]">
            <MdBlock src={flowSection.body} isEn={isEn} />
          </div>
        </div>
      )}

      {/* 기타 섹션 fallback */}
      {others.map((s, i) => (
        <div key={i} className="pt-5 border-t border-border/30">
          <p className="text-[10.5px] font-bold tracking-widest uppercase text-muted-foreground/50 mb-3">{s.title}</p>
          <div className="prose-narrative text-[13.5px]"><MdBlock src={s.body} isEn={isEn} /></div>
        </div>
      ))}
    </div>
  );
}

// ── 투자 결론: 핵심 포인트 3개 렌더러 ────────────────────────────────────────
// ── 애빛다 6렌즈 행간읽기 ────────────────────────────────────────────────────
// ── 투자 체크리스트 ──────────────────────────────────────────────────────────
interface ChecklistItem {
  category: string;
  item: string;
  status: "pass" | "warn" | "fail";
  verdict: string;
  detail?: string;
}
interface ChecklistData {
  items: ChecklistItem[];
  score: number;
  total: number;
}

function parseChecklistJson(content: string): ChecklistData | null {
  try {
    // ```json ... ``` 블록 우선 추출
    const blockMatch = content.match(/```json\s*([\s\S]*?)```/);
    const raw = blockMatch ? blockMatch[1] : content.match(/\{[\s\S]*"items"[\s\S]*\}/)?.[0];
    if (!raw) return null;
    const obj = JSON.parse(raw.trim());
    if (!Array.isArray(obj.items) || obj.items.length === 0) return null;
    const score = obj.items.filter((i: ChecklistItem) => i.status === "pass").length;
    return { items: obj.items, score, total: obj.items.length };
  } catch {
    return null;
  }
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  "성장성":     { bg: "bg-blue-500/10",   text: "text-blue-400" },
  "수익성":     { bg: "bg-emerald-500/10", text: "text-emerald-400" },
  "밸류에이션": { bg: "bg-violet-500/10", text: "text-violet-400" },
  "재무건전성": { bg: "bg-orange-500/10", text: "text-orange-400" },
  "내러티브":   { bg: "bg-teal-500/10",   text: "text-teal-400" },
};

function ChecklistView({ step, isEn }: { step: any; isEn: boolean }) {
  const data = parseChecklistJson(step.content ?? "");
  if (!data) return null;

  const categories = [...new Set(data.items.map((i: ChecklistItem) => i.category))];
  const passCount = data.items.filter((i: ChecklistItem) => i.status === "pass").length;
  const warnCount = data.items.filter((i: ChecklistItem) => i.status === "warn").length;
  const failCount = data.items.filter((i: ChecklistItem) => i.status === "fail").length;
  const pct = Math.round((passCount / data.total) * 100);

  const statusIcon = (s: string) => s === "pass" ? "✅" : s === "warn" ? "⚠️" : "❌";
  const statusTextColor = (s: string) =>
    s === "pass" ? "text-green-400" : s === "warn" ? "text-amber-400" : "text-red-400";
  const statusBg = (s: string) =>
    s === "pass" ? "bg-green-500/8 border-green-500/20"
    : s === "warn" ? "bg-amber-500/8 border-amber-500/20"
    : "bg-red-500/8 border-red-500/20";

  return (
    <div className="space-y-5">
      {/* 스코어 헤더 */}
      <div className="flex items-center gap-4 p-4 rounded-[var(--radius)] bg-muted/30 border border-border/50">
        <div className="text-center">
          <div className="text-3xl font-bold tabular-nums">{passCount}</div>
          <div className="text-[10px] text-muted-foreground/60 mt-0.5">{isEn ? "Passed" : "충족"}</div>
        </div>
        <div className="text-muted-foreground/30 text-xl font-light">/</div>
        <div className="text-center">
          <div className="text-3xl font-bold tabular-nums text-muted-foreground/60">{data.total}</div>
          <div className="text-[10px] text-muted-foreground/60 mt-0.5">{isEn ? "Total" : "전체"}</div>
        </div>
        <div className="flex-1 ml-2">
          {/* 진행 바 */}
          <div className="h-2 w-full rounded-full bg-border/40 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                background: pct >= 70 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444",
              }}
            />
          </div>
          <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground/60">
            <span>✅ {passCount}</span>
            <span>⚠️ {warnCount}</span>
            <span>❌ {failCount}</span>
          </div>
        </div>
      </div>

      {/* 카테고리별 항목 */}
      {categories.map((cat) => {
        const col = CATEGORY_COLORS[cat] ?? { bg: "bg-muted/20", text: "text-muted-foreground" };
        const catItems = data.items.filter((i: ChecklistItem) => i.category === cat);
        return (
          <div key={cat} className="space-y-1.5">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full ${col.bg} ${col.text}`}>
                {cat}
              </span>
            </div>
            {catItems.map((item: ChecklistItem, idx: number) => (
              <div
                key={idx}
                className={`flex items-start gap-3 py-2.5 px-3.5 rounded-[var(--radius)] border ${statusBg(item.status)}`}
              >
                <span className="text-[15px] mt-0.5 flex-shrink-0">{statusIcon(item.status)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium text-foreground/85 leading-snug">{item.item}</span>
                    <span className={`text-[12px] font-semibold whitespace-nowrap leading-snug ${statusTextColor(item.status)}`}>
                      {item.verdict}
                    </span>
                  </div>
                  {item.detail && (
                    <p className="text-[11px] text-muted-foreground/55 mt-0.5 leading-relaxed">{item.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ThesisView({ step, isEn }: { step: any; isEn: boolean }) {
  const raw = (step.content ?? "").replace(/(#{1,3})\s*\d+\.\s+/g, "$1 ");

  const sectionParts = raw.split(/\n(?=## )/).filter((s: string) => s.trim().startsWith("##"));

  // 렌즈별 색상 (왼쪽 컬러 바 + 배지)
  const LENS_COLORS = [
    { bar: "#6366f1", bg: "bg-indigo-500/[0.04]",  border: "border-indigo-200/60 dark:border-indigo-800/40",  num: "text-indigo-400" },
    { bar: "#0ea5e9", bg: "bg-sky-500/[0.04]",     border: "border-sky-200/60 dark:border-sky-800/40",        num: "text-sky-400" },
    { bar: "#8b5cf6", bg: "bg-violet-500/[0.04]",  border: "border-violet-200/60 dark:border-violet-800/40",  num: "text-violet-400" },
    { bar: "#f59e0b", bg: "bg-amber-500/[0.04]",   border: "border-amber-200/60 dark:border-amber-800/40",    num: "text-amber-400" },
    { bar: "#f97316", bg: "bg-orange-500/[0.04]",  border: "border-orange-200/60 dark:border-orange-800/40",  num: "text-orange-400" },
    { bar: "#10b981", bg: "bg-emerald-500/[0.04]", border: "border-emerald-200/60 dark:border-emerald-800/40",num: "text-emerald-400" },
  ];

  // 버딕트 키워드 → 색상
  const verdictColor = (v?: string) => {
    if (!v) return { text: "text-muted-foreground", bg: "bg-muted/60" };
    const pos = /순풍|건재|양호|긍정|강한|우호|상승|우세|견고|Positive|Strong|Favorable|Tailwind/i.test(v);
    const neg = /역풍|취약|부정|위험|하락|우려|약세|Negative|Weak|Risk|Headwind/i.test(v);
    if (pos) return { text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10" };
    if (neg) return { text: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-500/10" };
    return   { text: "text-amber-700 dark:text-amber-400",          bg: "bg-amber-500/10" };
  };

  const parsed = sectionParts.map((section: string, i: number) => {
    const lines = section.split("\n");
    const header = lines[0].replace(/^##\s*/, "").trim();
    const verdictIdx = lines.findIndex((l: string, idx: number) => idx > 0 && l.trim().startsWith("→"));
    const verdictLine = verdictIdx >= 0 ? lines[verdictIdx] : null;
    const verdict = verdictLine?.replace(/^→\s*\*?\*?/, "").replace(/\*?\*?$/, "").trim();
    const bodyLines = lines.slice(1, verdictIdx >= 0 ? verdictIdx : undefined);
    const body = bodyLines.join("\n").trim();
    return { header, body, verdict, color: LENS_COLORS[i % LENS_COLORS.length] };
  });

  if (parsed.length === 0) {
    return <div className="prose-narrative"><MdBlock src={raw} isEn={isEn} /></div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {parsed.map((lens, i) => {
        const vc = verdictColor(lens.verdict);
        return (
          <div
            key={i}
            className={`rounded-[var(--radius)] border ${lens.color.border} ${lens.color.bg} overflow-hidden flex flex-col`}
          >
            {/* 왼쪽 컬러 바 + 본문 */}
            <div className="flex flex-1">
              {/* 왼쪽 컬러 바 */}
              <div className="w-[3px] shrink-0 rounded-l-[var(--radius)]" style={{ backgroundColor: lens.color.bar }} />

              <div className="flex-1 p-4 flex flex-col gap-2.5">
                {/* 렌즈 번호 + 제목 */}
                <div className="flex items-start gap-2.5">
                  <span className={`text-[10px] font-black tabular-nums mt-0.5 ${lens.color.num} shrink-0`}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="text-[13.5px] font-bold text-foreground leading-snug">{lens.header}</p>
                </div>

                {/* 본문 */}
                {lens.body && (
                  <p className="text-[12.5px] leading-[1.85] text-foreground/65 flex-1 pl-[22px]">{lens.body}</p>
                )}

                {/* 버딕트 */}
                {lens.verdict && (
                  <div className="pt-2 border-t border-border/25 flex items-center gap-2 pl-[22px]">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: lens.color.bar }} />
                    <span className={`text-[11.5px] font-semibold ${vc.text}`}>{lens.verdict}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InvestmentPointsView({ step, isEn }: { step: any; isEn: boolean }) {
  const content = step.content ?? "";

  // ① ② ③ 파싱 — 한 줄 또는 여러 줄 모두 지원
  const pointRegex = /[①②③]\s*([\s\S]*?)(?=[①②③]|$)/g;
  const points: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pointRegex.exec(content)) !== null) {
    const text = m[1].trim();
    if (text) points.push(text);
  }

  const COLORS = ["#6366F1", "#10B981", "#F59E0B"];

  if (points.length === 0) {
    return (
      <div className="prose-narrative px-1">
        <MdBlock src={content} isEn={isEn} />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {points.slice(0, 3).map((text, i) => (
        <div key={i} className="flex items-start gap-3">
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 mt-0.5"
            style={{ background: COLORS[i] }}
          >
            {i + 1}
          </span>
          <p className="text-[13.5px] text-foreground/80 leading-[1.75] flex-1">{text}</p>
        </div>
      ))}
    </div>
  );
}

function StockNewsTimeline({ ticker, companyName, isEn = false }: { ticker: string; companyName: string; isEn?: boolean }) {
  const [events, setEvents] = useState<StockNewsEvent[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [forceCount, setForceCount] = useState(0);
  const keyword = isEn ? (ticker || companyName) : companyName;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const isForce = forceCount > 0;
    const url = getApiUrl(`/api/news/timeline?keyword=${encodeURIComponent(keyword)}&ticker=${encodeURIComponent(ticker)}${isForce ? "&force=true" : ""}`);
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { summary?: string; timeline?: StockNewsEvent[]; generatedAt?: number }) => {
        if (cancelled) return;
        setSummary(d.summary ?? "");
        setEvents(d.timeline ?? []);
        setGeneratedAt(d.generatedAt ?? null);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e?.message ?? "뉴스 타임라인 생성 실패");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [keyword, forceCount]);

  const importanceDot: Record<string, string> = {
    high:   "bg-rose-500",
    medium: "bg-amber-400",
    low:    "bg-muted-foreground/30",
  };

  const generatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="bg-card rounded-[var(--radius)] p-5 sm:p-6 print:hidden shadow-[var(--shadow-card)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-5">
        <Newspaper className="w-4 h-4 text-muted-foreground/50" />
        <h2 className="text-base font-semibold text-foreground">
          {isEn ? "News Timeline" : "주요 뉴스 타임라인"}
        </h2>
        <span className="text-[11px] text-muted-foreground/40">
          {isEn ? "oldest → latest" : "과거 → 최신"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!loading && generatedLabel && (
            <span className="text-[10.5px] text-muted-foreground/30 font-mono">{generatedLabel}</span>
          )}
          {!loading && events.length > 0 && (
            <span className="text-[11px] font-mono text-muted-foreground/35">{events.length}</span>
          )}
          <button
            onClick={() => { setExpandedIdx(null); setForceCount(c => c + 1); }}
            disabled={loading}
            title={isEn ? "Refresh to latest news" : "최신 뉴스로 새로고침"}
            className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/50 transition-colors disabled:opacity-30"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* AI 요약 */}
      {!loading && summary && (
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-5 pb-5 border-b border-border/50">
          {summary}
        </p>
      )}

      {/* 로딩 스켈레톤 */}
      {loading && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground/60 animate-pulse">
            <Sparkles className="w-3.5 h-3.5 text-primary/50 shrink-0" />
            {isEn ? `Generating timeline for "${companyName}"…` : `"${companyName}" 타임라인 생성 중…`}
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4 animate-pulse">
              <div className="shrink-0 w-16 h-2.5 bg-muted rounded mt-1.5" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-muted rounded w-2/3" />
                <div className="h-2.5 bg-muted/60 rounded w-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 에러 */}
      {error && !loading && (
        <p className="text-sm text-muted-foreground/50 py-4 text-center">{error}</p>
      )}

      {/* 타임라인 */}
      {!loading && !error && events.length > 0 && (
        <div className="relative">
          {/* 세로선 */}
          <div className="absolute left-[3px] top-1 bottom-4 w-px bg-border/50" />

          <div>
            {events.map((ev, idx) => {
              const dot = importanceDot[ev.importance] ?? importanceDot.low;
              const isExpanded = expandedIdx === idx;
              const isLast = idx === events.length - 1;
              return (
                <motion.div
                  key={`${ev.date}-${idx}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03, duration: 0.2 }}
                  className={cn("flex gap-4", !isLast && "mb-0")}
                >
                  {/* 점 */}
                  <div className="shrink-0 flex flex-col items-center pt-[5px]">
                    <div className={cn("w-1.5 h-1.5 rounded-full z-10 relative", dot)} />
                  </div>

                  {/* 내용 */}
                  <div className={cn("flex-1 min-w-0", !isLast && "pb-5")}>
                    <button
                      className="w-full text-left group"
                      onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    >
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 text-[11px] font-mono text-muted-foreground/50 tabular-nums pt-px w-16">
                          {ev.dateLabel || ev.date}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn(
                              "text-[13px] font-medium leading-snug group-hover:text-primary transition-colors",
                              ev.importance === "high" ? "text-foreground" : "text-foreground/80"
                            )}>
                              {ev.event}
                            </p>
                            <span className="shrink-0 text-[10px] text-muted-foreground/40 font-medium">
                              {ev.category}
                            </span>
                          </div>
                        </div>
                        <ChevronDown className={cn(
                          "w-3 h-3 text-muted-foreground/30 shrink-0 mt-0.5 transition-transform duration-150",
                          isExpanded && "rotate-180"
                        )} />
                      </div>
                    </button>

                    {/* 펼침 상세 */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="ml-[72px] mt-2 text-[14px] text-muted-foreground leading-relaxed">
                            {ev.detail}
                            {ev.url && (
                              <a
                                href={ev.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-2 inline-flex items-center gap-0.5 text-primary/70 hover:text-primary"
                                onClick={e => e.stopPropagation()}
                              >
                                {isEn ? "more" : "원문"} <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && !error && events.length === 0 && (
        <p className="text-sm text-muted-foreground/40 text-center py-6">
          {isEn ? "No timeline available." : "타임라인 데이터 없음"}
        </p>
      )}

      {/* 푸터 */}
      {!loading && events.length > 0 && (
        <p className="mt-5 pt-4 border-t border-border/40 text-[11px] text-muted-foreground/40 flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 shrink-0" />
          {isEn ? "AI-generated · For reference only" : "AI 생성 · 참고용"}
        </p>
      )}
    </div>
  );
}

function PortfolioCTA({ ticker, companyName, isEn }: { ticker: string; companyName: string; isEn: boolean }) {
  const [, setLocation] = useLocation();
  const [pfStatus, setPfStatus] = useState<"idle" | "checking" | "adding" | "added" | "exists">("checking");
  const [wlStatus, setWlStatus] = useState<"idle" | "adding" | "added" | "exists">("idle");

  useEffect(() => {
    fetch(getApiUrl(`/api/portfolio/check/${encodeURIComponent(ticker)}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { setPfStatus("idle"); return; }
        if (d.inPortfolio) setPfStatus("exists");
        else if (d.inWatchlist) { setPfStatus("idle"); setWlStatus("exists"); }
        else setPfStatus("idle");
      })
      .catch(() => setPfStatus("idle"));
  }, [ticker]);

  async function addToPortfolio() {
    setPfStatus("adding");
    const currency = /^\d{5,6}$/.test(ticker) ? "KRW" : "USD";
    try {
      const r = await fetch(getApiUrl("/api/portfolio"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, companyName, currency, holdingType: "portfolio" }),
      });
      if (r.ok) { setPfStatus("added"); setWlStatus("idle"); }
      else setPfStatus("idle");
    } catch { setPfStatus("idle"); }
  }

  async function addToWatchlist() {
    setWlStatus("adding");
    const currency = /^\d{5,6}$/.test(ticker) ? "KRW" : "USD";
    try {
      const r = await fetch(getApiUrl("/api/portfolio"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, companyName, currency, holdingType: "watchlist" }),
      });
      if (r.ok) setWlStatus("added");
      else setWlStatus("idle");
    } catch { setWlStatus("idle"); }
  }

  return (
    <div className="mt-4 print:hidden">
      <div className="rounded-[var(--radius)] border border-border bg-card dark:bg-gradient-to-br dark:from-[#1a1a1a] dark:to-[#141414] px-5 py-5 space-y-3.5 shadow-[var(--shadow-card)]">
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
          {isEn ? "What's next?" : "다음으로 무엇을 하시겠어요?"}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {/* 홈으로 */}
          <button
            onClick={() => setLocation("/")}
            className="flex flex-col items-center gap-2 rounded-[var(--radius)] border border-border bg-muted/30 hover:border-border hover:bg-muted/60 px-4 py-4 transition-all duration-200 group"
          >
            <div className="w-10 h-10 rounded-[var(--radius)] bg-muted flex items-center justify-center group-hover:bg-muted/80 transition-colors">
              <Home className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
            <span className="text-[13px] font-semibold text-foreground leading-tight text-center">
              {isEn ? "Home" : "홈으로"}
            </span>
            <span className="text-[11px] text-muted-foreground leading-tight text-center">
              {isEn ? "Back to dashboard" : "대시보드로 돌아가기"}
            </span>
          </button>

          {/* 포트폴리오 추가 / 보기 */}
          {pfStatus === "exists" || pfStatus === "added" ? (
            <button
              onClick={() => setLocation("/portfolio")}
              className="relative flex flex-col items-center gap-2 rounded-[var(--radius)] border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15 px-4 py-4 transition-all duration-200 group overflow-hidden"
            >
              <div className="w-10 h-10 rounded-[var(--radius)] bg-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/30 transition-colors">
                <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400 leading-tight text-center">
                {pfStatus === "added" ? (isEn ? "Added!" : "추가 완료!") : (isEn ? "In Portfolio" : "포트폴리오에 있음")}
              </span>
              <span className="text-[11px] text-emerald-600/70 dark:text-emerald-400/60 leading-tight text-center">
                {isEn ? "View portfolio →" : "포트폴리오 보기 →"}
              </span>
            </button>
          ) : (
            <button
              onClick={addToPortfolio}
              disabled={pfStatus === "adding" || pfStatus === "checking"}
              className="relative flex flex-col items-center gap-2 rounded-[var(--radius)] border border-[#FF8A7A]/50 bg-gradient-to-br from-[#FF8A7A]/10 to-[#FF8A7A]/5 hover:from-[#FF8A7A]/20 hover:to-[#FF8A7A]/10 hover:border-[#FF8A7A]/70 px-4 py-4 transition-all duration-200 group overflow-hidden disabled:opacity-60"
            >
              <div className="absolute inset-0 rounded-[var(--radius)] bg-[#FF8A7A]/5 blur-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
              <div className="w-10 h-10 rounded-[var(--radius)] bg-[#FF8A7A]/15 flex items-center justify-center group-hover:bg-[#FF8A7A]/25 transition-colors relative">
                {pfStatus === "adding" || pfStatus === "checking"
                  ? <Loader2 className="w-5 h-5 text-[#FF8A7A] animate-spin" />
                  : <Briefcase className="w-5 h-5 text-[#FF8A7A]" />
                }
              </div>
              <span className="text-[13px] font-bold text-[#FF8A7A] leading-tight text-center relative">
                {isEn ? "Add to Portfolio" : "포트폴리오에 추가"}
              </span>
              <span className="text-[11px] text-[#FF8A7A]/70 leading-tight text-center relative">
                {isEn ? "Track this stock" : "이 종목 바로 편입하기"}
              </span>
            </button>
          )}
        </div>

        {/* 관심종목 추가 — 포트폴리오에 없을 때만 표시 */}
        {pfStatus !== "exists" && pfStatus !== "added" && (
          <div className="pt-0.5">
            {wlStatus === "exists" || wlStatus === "added" ? (
              <button
                onClick={() => setLocation("/portfolio")}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/8 hover:bg-amber-400/14 transition-all duration-200 group"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-400/15 flex items-center justify-center shrink-0">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[13px] font-bold text-amber-600 dark:text-amber-400 leading-tight">
                    {wlStatus === "added" ? (isEn ? "Added to Watchlist!" : "관심종목에 추가됨!") : (isEn ? "In Watchlist" : "관심종목에 있음")}
                  </p>
                  <p className="text-[11px] text-amber-500/70 leading-tight">
                    {isEn ? "View in portfolio →" : "포트폴리오에서 보기 →"}
                  </p>
                </div>
                <Check className="w-4 h-4 text-amber-500 shrink-0" />
              </button>
            ) : (
              <button
                onClick={addToWatchlist}
                disabled={wlStatus === "adding"}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] border border-border/60 bg-muted/20 hover:bg-muted/40 hover:border-amber-400/30 transition-all duration-200 group disabled:opacity-60"
              >
                <div className="w-8 h-8 rounded-lg bg-muted/60 group-hover:bg-amber-400/10 flex items-center justify-center shrink-0 transition-colors">
                  {wlStatus === "adding"
                    ? <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                    : <Star className="w-4 h-4 text-muted-foreground group-hover:text-amber-500 transition-colors" />
                  }
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[13px] font-semibold text-foreground/70 group-hover:text-foreground leading-tight transition-colors">
                    {isEn ? "Add to Watchlist" : "관심종목에 추가"}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60 leading-tight">
                    {isEn ? "Monitor without buying yet" : "아직 살 건 아니지만 지켜보기"}
                  </p>
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Phase indicator (성장/정체/축소) ──────────────────────────────────────────
function PhaseTag({ verdict, isEn }: { verdict: string | null; isEn: boolean }) {
  if (!verdict) return null;
  const v = verdict.toLowerCase();
  if (v.includes("buy")) return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
      <TrendingUp className="w-3.5 h-3.5" /> {isEn ? "Growth Phase" : "성장 단계"}
    </span>
  );
  if (v.includes("sell")) return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60">
      <TrendingDown className="w-3.5 h-3.5" /> {isEn ? "Contraction Phase" : "축소 단계"}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
      <Minus className="w-3.5 h-3.5" /> {isEn ? "Stabilization Phase" : "정체 단계"}
    </span>
  );
}

// ── Narrative section wrapper ─────────────────────────────────────────────────
function NarrativeSectionBlock({
  num, title, subtitle, accent, children, pending = false, isEn = false,
}: {
  num: number; title: string; subtitle: string; accent: string;
  children?: React.ReactNode; pending?: boolean; isEn?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: num * 0.05 }}
      className="rounded-[var(--radius)] bg-card border shadow-[var(--shadow-card)] overflow-hidden"
    >
      {/* 챕터 헤더 */}
      <div className="px-5 sm:px-6 pt-4 pb-3.5" style={{ borderBottom: `1px solid ${accent}22` }}>
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-[var(--radius)] flex items-center justify-center font-black text-[13px] text-white shrink-0"
            style={{ background: accent }}
          >
            {num}
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground leading-tight tracking-tight">{title}</h2>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* 본문 */}
      <div className="px-5 sm:px-6 py-5">
        {pending ? (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
            <span className="text-sm text-muted-foreground/60">{isEn ? "Analyzing…" : "분석 중…"}</span>
          </div>
        ) : children}
      </div>
    </motion.div>
  );
}

// ── 단일 스텝 컨텐츠 (어코디언 없이 산문체로) ────────────────────────────────
function NarrativeStepContent({
  step, isEn = false, ticker, accent, compact = false,
}: {
  step: any; isEn?: boolean; ticker?: string; accent?: string; compact?: boolean;
}) {
  const raw = (step.content ?? "")
    .replace(/##\s*\d*\.?\s*종합\s*판단/g, "## 사업보고서 분석 요약")
    .replace(/(#{1,3})\s*\d+\.\s+/g, "$1 ");  // 헤딩 숫자 번호 제거 (## 5. 제목 → ## 제목)
  const processed = stripPromptInstructions(stripEstimationLabels(
    step.stepKey === "company_analysis" ? stripValuationData(raw) : raw,
  ));

  const leadIdx = processed.search(/(?:^|\n)## /);
  const leadPara = leadIdx > 0 ? processed.slice(0, leadIdx).trim() : "";
  const body = leadIdx >= 0 ? processed.slice(leadIdx) : processed;
  const accentColor = accent ?? "hsl(var(--primary))";

  // compact 모드: 리드 문장 + 각 ## 섹션의 첫 단락만 digest로 표시
  if (compact) {
    // ## 섹션 단위로 분리
    const sections = processed.split(/\n(?=## )/);
    const lead = sections[0]?.trim() ?? "";

    // 각 섹션에서 제목 + 첫 단락 추출 (최대 3개)
    const digests = sections.slice(1).map(sec => {
      const nlIdx = sec.indexOf('\n');
      const header = nlIdx > 0 ? sec.slice(3, nlIdx).trim() : sec.slice(3).trim();
      const rest = nlIdx > 0 ? sec.slice(nlIdx + 1).trim() : '';
      // 첫 단락: 빈 줄이나 다음 헤더 전까지
      const firstPara = rest.split(/\n\n|\n(?=#{1,3} )/)[0]?.trim() ?? '';
      return { header, body: firstPara };
    }).filter(d => d.body.length > 20).slice(0, 4);

    return (
      <div className="space-y-5">
        {lead && (
          <p
            className="text-[14px] leading-[1.85] text-foreground/80 border-l-2 pl-4 py-0.5 italic"
            style={{ borderLeftColor: `${accentColor}70` }}
          >
            {lead}
          </p>
        )}
        {digests.length > 0 && (
          <div className="divide-y divide-border/30">
            {digests.map((d, i) => (
              <div key={i} className={i === 0 ? "pb-4" : "py-4"}>
                <p className="text-[10.5px] font-bold tracking-widest uppercase text-muted-foreground/50 mb-2">
                  {d.header}
                </p>
                <div className="prose-narrative text-[13.5px] leading-relaxed">
                  <MdBlock src={d.body} isEn={isEn} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {leadPara && (
        <p
          className="text-[14.5px] leading-[1.9] text-foreground/80 border-l-2 pl-4 py-0.5 italic"
          style={{ borderLeftColor: `${accentColor}80` }}
        >
          {leadPara}
        </p>
      )}
      <div className="prose-narrative">
        <MdBlock src={body} isEn={isEn} />
      </div>
    </div>
  );
}

export default function AnalysisDetail() {
  const [, params] = useRoute("/analysis/:id");
  const [, setLocation] = useLocation();
  const id = params?.id ? parseInt(params.id, 10) : 0;
  const { isEn } = useLanguage();

  const queryClient = useQueryClient();
  const { isSignedIn: isClerkSignedIn, isLoaded: isAuthLoaded } = useUser();
  const { data: kakaoAuth } = useKakaoAuth();
  const isSignedIn = isClerkSignedIn || !!kakaoAuth?.user;
  const { data: analysis, isLoading, error } = useGetAnalysis(id, {
    query: {
      refetchInterval: (query) => (query.state.data?.status === 'in_progress' || query.state.data?.status === 'queued') ? 3000 : false
    }
  });

  const { mutate: deleteAnalysis } = useDeleteAnalysis();
  const [showShareModal, setShowShareModal] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // 분석 시작 시 면책 팝업
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const disclaimerShown = useRef(false);
  useEffect(() => {
    if (!analysis) return;
    const isActive = analysis.status === "in_progress" || analysis.status === "queued";
    if (isActive && !disclaimerShown.current) {
      disclaimerShown.current = true;
      setShowDisclaimer(true);
      const t = setTimeout(() => setShowDisclaimer(false), 9000);
      return () => clearTimeout(t);
    }
  }, [analysis?.status]);
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 분석 중 스크롤 위치 고정 — 새 콘텐츠 추가 시 뷰포트 이동 방지
  useEffect(() => {
    const isGenerating = analysis?.status === "in_progress" || analysis?.status === "queued";
    if (!isGenerating) return;
    const prev = document.documentElement.style.overflowAnchor;
    document.documentElement.style.overflowAnchor = "none";
    document.body.style.overflowAnchor = "none";
    return () => {
      document.documentElement.style.overflowAnchor = prev;
      document.body.style.overflowAnchor = "";
    };
  }, [analysis?.status]);

  // 피드백 상태
  const [feedbackRating, setFeedbackRating] = useState<1 | 5 | null>(null);
  const [feedbackChips, setFeedbackChips] = useState<string[]>([]);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  // 관리자 여부
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch(getApiUrl("/api/admin/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.isAdmin) setIsAdmin(true); })
      .catch(() => {});
  }, []);

  // 종목별 관리자 메모 상태
  const [tickerMemo, setTickerMemo] = useState("");
  const [tickerMemoSaved, setTickerMemoSaved] = useState("");
  const [tickerMemoSaving, setTickerMemoSaving] = useState(false);
  const [tickerMemoSavedOk, setTickerMemoSavedOk] = useState(false);

  // 기존 피드백 로드
  useEffect(() => {
    if (!analysis) return;
    if (analysis.userRating) setFeedbackRating(analysis.userRating >= 4 ? 5 : 1);
    if (analysis.userFeedback) {
      setFeedbackChips(analysis.userFeedback.split(", ").filter(Boolean));
      setFeedbackSubmitted(true);
    }
  }, [analysis?.id, analysis?.userRating, analysis?.userFeedback]);

  // 시가총액 + 현재가 + 주요 지표 fetch
  const [headerMarketCap, setHeaderMarketCap] = useState<{ value: number; currency: string } | null>(null);
  const [headerLivePrice, setHeaderLivePrice] = useState<{ price: number; change: number | null; currency: string } | null>(null);
  const [headerTickerStats, setHeaderTickerStats] = useState<{
    per: number | null; pbr: number | null;
    week52High: number | null; week52Low: number | null;
    volume: number | null; dividendYield: number | null; beta: number | null;
  } | null>(null);

  useEffect(() => {
    if (!analysis?.ticker) return;
    // 주요 지표 (PER, PBR, 52주 고저, 거래량)
    fetch(getApiUrl(`/api/market-data/ticker-stats/${encodeURIComponent(analysis.ticker)}`))
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        if (!d) return;
        if (d.marketCap != null) setHeaderMarketCap({ value: d.marketCap, currency: d.currency ?? "KRW" });
        setHeaderTickerStats({
          per: d.per ?? null, pbr: d.pbr ?? null,
          week52High: d.week52High ?? null, week52Low: d.week52Low ?? null,
          volume: d.volume ?? null, dividendYield: d.dividendYield ?? null, beta: d.beta ?? null,
        });
      })
      .catch(() => {});
    // 실시간 현재가
    fetch(getApiUrl(`/api/market-data/batch-quotes`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: [analysis.ticker] }),
    })
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        const q = d?.[analysis.ticker];
        if (q?.price != null) {
          setHeaderLivePrice({ price: q.price, change: q.change ?? null, currency: q.currency ?? (isUSTicker(analysis.ticker) ? "USD" : "KRW") });
        }
      })
      .catch(() => {});
  }, [analysis?.ticker]);

  // 종목별 메모 로드
  useEffect(() => {
    if (!analysis?.ticker) return;
    fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(analysis.ticker)}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.memo) { setTickerMemo(d.memo); setTickerMemoSaved(d.memo); } })
      .catch(() => {});
  }, [analysis?.ticker]);

  async function saveTickerMemo() {
    if (tickerMemoSaving || !analysis?.ticker) return;
    setTickerMemoSaving(true);
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(analysis.ticker)}`), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: tickerMemo }),
      });
      if (r.ok) { setTickerMemoSaved(tickerMemo); setTickerMemoSavedOk(true); setTimeout(() => setTickerMemoSavedOk(false), 2000); }
    } finally {
      setTickerMemoSaving(false);
    }
  }

  const submitFeedback = async (ratingOverride?: 1 | 5, chipsOverride?: string[]) => {
    const rating = ratingOverride ?? feedbackRating;
    const chips = chipsOverride ?? feedbackChips;
    if (feedbackSubmitting || !rating) return;
    setFeedbackSubmitting(true);
    try {
      await fetch(getApiUrl(`/api/analysis/${id}/feedback`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, feedback: chips.length > 0 ? chips.join(", ") : undefined }),
      });
      setFeedbackSubmitted(true);
    } catch {}
    finally { setFeedbackSubmitting(false); }
  };

  // 방문한 분석을 localStorage에 저장 ("내가 본 자료" 기능)
  useEffect(() => {
    if (!analysis) return;
    try {
      const STORAGE_KEY = "avitda-recent-analyses";
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as any[];
      const entry = {
        id: analysis.id,
        ticker: analysis.ticker,
        companyName: analysis.companyName,
        englishName: analysis.englishName ?? null,
        industry: analysis.industry ?? null,
        investmentVerdict: analysis.investmentVerdict ?? null,
        targetPrice: analysis.targetPrice ?? null,
        startPrice: (analysis as any).startPrice ?? null,
        entryPrice: (analysis as any).entryPrice ?? null,
        stopLoss: (analysis as any).stopLoss ?? null,
        createdAt: analysis.createdAt,
        status: analysis.status,
        visitedAt: new Date().toISOString(),
      };
      const filtered = stored.filter((x: any) => x.id !== analysis.id);
      const updated = [entry, ...filtered].slice(0, 30);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  }, [analysis?.id, analysis?.status, analysis?.investmentVerdict, analysis?.targetPrice]);

  // 동적 OG 태그 & 페이지 타이틀 업데이트 (공유 미리보기 개선)
  useEffect(() => {
    if (!analysis) return;
    const ogDateStr = analysis.createdAt
      ? new Date(analysis.createdAt).toISOString().slice(0, 10).replace(/-/g, ".")
      : new Date().toISOString().slice(0, 10).replace(/-/g, ".");
    const ogVerdictRaw = (analysis as any).investmentVerdict ?? (analysis as any).verdict ?? null;
    const ogVerdictKo = ogVerdictRaw ? toKoreanVerdict(ogVerdictRaw) : null;
    const title = ogVerdictKo && ogVerdictKo !== "—"
      ? `${analysis.companyName} [${ogVerdictKo}] · AI가 분석한 기업가치 | 애빛다`
      : `${analysis.companyName} · AI 기업가치 분석 리포트 | 애빛다`;
    const desc = `${ogDateStr} · AI 7단계 파이프라인이 분석한 ${analysis.companyName}의 기업가치 리포트`;

    document.title = title;
    const setMeta = (prop: string, content: string) => {
      let el = document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement | null;
      if (!el) { el = document.createElement("meta"); el.setAttribute("property", prop); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    const setMetaName = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    setMeta("og:title", title);
    setMeta("og:description", desc);
    setMetaName("twitter:title", title);
    setMetaName("twitter:description", desc);

    return () => {
      document.title = "애빛다 — AI로 기업가치를 밝히다";
      setMeta("og:title", "애빛다 — AI로 기업가치를 밝히다");
      setMeta("og:description", "AI 7단계 파이프라인이 코스피·코스닥·미국 주식을 분석합니다. DCF·rNPV 기반 적정주가 산출.");
    };
  }, [analysis?.ticker, analysis?.companyName, analysis?.createdAt]);

  type QCStatus = "checking" | "approved" | "revising" | "revised";
  type DebateStatus = "challenging" | "synthesizing";
  interface StreamingStepState {
    key: string;
    content: string;
    qcStatus?: QCStatus;
    qcScore?: number;
    qcFeedback?: string;
    debateStatus?: DebateStatus;
  }
  const [streamingStep, setStreamingStep] = useState<StreamingStepState | null>(null);
  const isStreaming = streamingStep !== null;
  const triggeredSteps = useRef<Set<string>>(new Set());
  const runStreamingStepRef = useRef<((stepKey: string) => void) | null>(null);
  const hasInitiatedRef = useRef(false);

  // ⑨ Floating verdict card
  const verdictRef = useRef<HTMLDivElement>(null);
  const [showFloatingVerdict, setShowFloatingVerdict] = useState(false);

  // ⑩ Sticky step nav
  const headerRef = useRef<HTMLDivElement>(null);
  const [showStickyNav, setShowStickyNav] = useState(false);

  const handleDelete = () => {
    if (!confirm((analysis as any)?.language === 'en' ? "Delete this analysis?" : "이 분석을 삭제하시겠습니까?")) return;
    deleteAnalysis(id, { onSuccess: () => setLocation("/") });
  };

  const runStreamingStep = useCallback(async (stepKey: string) => {
    setStreamingStep({ key: stepKey, content: "" });
    let completedSuccessfully = false;
    try {
      const res = await fetch(getApiUrl(`/api/analysis/${id}/step`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey }),
      });
      if (!res.ok || !res.body) {
        setStreamingStep(null);
        // 409: 이미 백그라운드에서 실행 중 → 오류 없이 폴링에 맡김
        if (res.status === 409) return;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.debate === "challenging") {
              setStreamingStep(prev => prev ? { ...prev, debateStatus: "challenging" } : null);
            } else if (msg.debate === "synthesizing") {
              setStreamingStep(prev => prev ? { ...prev, debateStatus: "synthesizing" } : null);
            } else if (msg.qc === "checking") {
              setStreamingStep(prev => prev ? { ...prev, debateStatus: undefined, qcStatus: "checking" } : null);
            } else if (msg.qc === "approved") {
              setStreamingStep(prev => prev ? { ...prev, qcStatus: "approved", qcScore: msg.score } : null);
            } else if (msg.qc === "revising") {
              setStreamingStep(prev => prev ? { ...prev, qcStatus: "revising", qcScore: msg.score, qcFeedback: msg.feedback } : null);
            } else if (msg.qc === "revised") {
              setStreamingStep(prev => prev ? { ...prev, qcStatus: "revised", qcScore: msg.score } : null);
            }
            // msg.t (text token) — StreamingCard가 content를 표시하지 않으므로
            // state 업데이트 없이 무시. 서버가 DB에 저장 후 refetch로 표시됨.
            if (msg.done) {
              queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) });
              completedSuccessfully = true;
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch {
      setStreamingStep(null);
      return;
    }

    // Clear streaming card now that the step is saved
    setStreamingStep(null);

    // Auto-chain: immediately trigger the next step without relying on effects
    if (completedSuccessfully) {
      const nextIndex = ANALYSIS_STEPS_ORDER.indexOf(stepKey) + 1;
      if (nextIndex < ANALYSIS_STEPS_ORDER.length) {
        const nextKey = ANALYSIS_STEPS_ORDER[nextIndex];
        if (!triggeredSteps.current.has(nextKey)) {
          triggeredSteps.current.add(nextKey);
          // Slight delay to let React flush state before starting next step
          setTimeout(() => {
            runStreamingStepRef.current?.(nextKey);
          }, 200);
        }
      }
    }
  }, [id, queryClient]);

  // Keep ref up-to-date so the setTimeout inside can always call the latest version
  runStreamingStepRef.current = runStreamingStep;

  // On mount / resume: start from the first pending step if analysis is already in_progress
  // error 상태지만 미완료 스텝이 있는 경우에도 run-pipeline으로 자동 재시도
  useEffect(() => {
    if (!analysis) return;

    const isResumable =
      analysis.status === "in_progress" ||
      (analysis.status === "error" && analysis.steps.length < ANALYSIS_STEPS_ORDER.length);

    if (!isResumable) return;

    // 백그라운드 파이프라인이 실행 중인지 확인/보장 (클라이언트 이탈 후 재진입 시 안전망)
    fetch(getApiUrl(`/api/analysis/${id}/run-pipeline`), { method: "POST", headers: { "Content-Type": "application/json" } })
      .catch(console.error);

    if (analysis.status !== "in_progress") return; // error 상태는 서버 백그라운드에 위임
    if (hasInitiatedRef.current) return;
    const nextIndex = analysis.steps.length;
    if (nextIndex >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[nextIndex];
    if (triggeredSteps.current.has(nextStepKey)) return;
    hasInitiatedRef.current = true;
    triggeredSteps.current.add(nextStepKey);
    runStreamingStep(nextStepKey);
  }, [analysis?.status, analysis?.steps.length, id, runStreamingStep]);

  // Auto-advance: 스트리밍이 끝나고 다음 단계가 남아 있으면 자동으로 실행
  // 체인이 끊겨 수동 버튼이 나타나는 현상 방지
  useEffect(() => {
    if (!analysis || analysis.status !== "in_progress") return;
    if (isStreaming) return;
    const nextIndex = analysis.steps.length;
    if (nextIndex >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[nextIndex];
    if (triggeredSteps.current.has(nextStepKey)) return;

    // 짧은 딜레이 후 자동 실행 (React state flush 대기)
    const timer = setTimeout(() => {
      if (triggeredSteps.current.has(nextStepKey)) return;
      triggeredSteps.current.add(nextStepKey);
      runStreamingStep(nextStepKey);
    }, 800);

    return () => clearTimeout(timer);
  }, [analysis?.status, analysis?.steps.length, isStreaming, runStreamingStep]);

  // ⑨ IntersectionObserver for floating verdict card
  useEffect(() => {
    const el = verdictRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowFloatingVerdict(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [analysis?.id]);

  // ⑩ IntersectionObserver for sticky step nav
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyNav(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [analysis?.id]);

  if (isLoading) return (
    <div className="p-20 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
      <p className="text-muted-foreground text-sm">분석 데이터 로딩 중...</p>
    </div>
  );
  if (error || !analysis) return (
    <div className="p-20 text-center text-destructive text-sm">분석 데이터를 불러올 수 없습니다.</div>
  );

  const currentStepCount = analysis.steps.length;
  const isComplete = analysis.status === 'completed';
  const isError = analysis.status === 'error';

  // investment_strategy 스텝 JSON을 1차 소스로 → DB값 불일치 방지
  const effectiveVerdict: string | null = (() => {
    // DB값(서버 verdict-override 결과)이 존재하면 최우선 사용
    const dbVerdict = (analysis as any).investmentVerdict as string | null ?? null;
    if (dbVerdict) return dbVerdict;
    // 분석 진행 중(완료 전)에만 step JSON에서 임시로 파싱
    const stratStep = analysis.steps.find((s: any) => s.stepKey === "investment_strategy");
    if (stratStep?.content) {
      try {
        let s = (stratStep.content as string).replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
        const start = s.indexOf("{"); const end = s.lastIndexOf("}");
        if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
        const j = JSON.parse(s);
        if (j?.verdict) return j.verdict as string;
      } catch { /* fall through */ }
    }
    return null;
  })();

  const handleRunNextStep = () => {
    if (isComplete || isError || isStreaming || currentStepCount >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[currentStepCount];
    // 이전에 auto-chain이 실패했을 수 있으므로 triggeredSteps 체크를 제거하고 항상 재실행 허용
    triggeredSteps.current.delete(nextStepKey);
    triggeredSteps.current.add(nextStepKey);
    runStreamingStep(nextStepKey);
  };

  return (
    <div id="analysis-report-content" className="pb-20">
      {/* 분석 시작 면책 팝업 */}
      <AnimatePresence>
        {showDisclaimer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 print:hidden"
          >
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowDisclaimer(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ type: "spring", damping: 28, stiffness: 300, delay: 0.05 }}
              className="relative z-10 w-full max-w-sm overflow-hidden rounded-[var(--radius)] border border-border bg-background shadow-2xl"
            >
              {/* 상단 컬러 라인 */}
              <div className="h-0.5 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400" />

              <div className="p-6">
                {/* 종목 컨텍스트 */}
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground/50 bg-muted/40 rounded px-1.5 py-0.5">{analysis.ticker}</span>
                  <span className="text-[12px] font-semibold text-foreground/70 truncate">{isEn ? (analysis.englishName || analysis.companyName) : analysis.companyName}</span>
                </div>

                {/* 타이틀 행 */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="text-[15px] font-bold text-foreground leading-snug">
                    {isEn ? "For reference only." : "참고용 리포트입니다"}
                  </h3>
                  <button
                    onClick={() => setShowDisclaimer(false)}
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* 본문 */}
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {isEn
                    ? "AI agents read DART filings, earnings, news, and catalysts to surface what lies between the lines of a company’s disclosures. This is not investment advice. All investment decisions and their outcomes are solely your responsibility."
                    : "DART 사업보고서와 기업의 행간을 AI 에이전트들이 읽고 분석한 결과물입니다. 투자 자문이 아니며, 투자 판단과 그 결과에 대한 책임은 사용자 본인에게 있습니다."}
                </p>

                {/* AI 정확도 안내 */}
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground/60">
                  {isEn
                    ? "⚠ AI-generated content may contain errors in figures or judgments. Always verify key data before relying on this report."
                    : "⚠ AI 특성상 수치나 판단에 오류가 포함될 수 있습니다. 핵심 수치는 반드시 직접 확인 후 참고하세요."}
                </p>

                {/* 구분선 */}
                <div className="my-4 border-t border-border" />

                {/* 확인 버튼 */}
                <button
                  onClick={() => setShowDisclaimer(false)}
                  className="w-full rounded-[var(--radius)] bg-foreground py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-80 active:opacity-70"
                >
                  {isEn ? "Understood" : "확인했습니다"}
                </button>

                {/* 자동 닫힘 progress bar */}
                <motion.div className="mt-3 h-0.5 w-full rounded-full bg-border overflow-hidden">
                  <motion.div
                    initial={{ width: "100%" }}
                    animate={{ width: "0%" }}
                    transition={{ duration: 9, ease: "linear" }}
                    className="h-full rounded-full bg-muted-foreground/40"
                  />
                </motion.div>
                <p className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
                  {isEn ? "Closes automatically" : "잠시 후 자동으로 닫힙니다"}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 인쇄 전용 헤더 — 화면에서는 숨김, 인쇄 시에만 표시 */}
      <div className="hidden print:block mb-8 pb-6 border-b-2 border-gray-800">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{isEn ? "AiBITDA  |  AI Equity Research Report" : "애빛다 \u00a0|\u00a0 AI 기업분석 리포트"}</div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">
              {isEn ? (analysis.englishName || analysis.companyName) : analysis.companyName}
              <span className="ml-2 text-base font-mono text-gray-500">({analysis.ticker})</span>
            </h1>
            {!isEn && analysis.englishName && <p className="text-sm text-gray-500 mt-0.5">{analysis.englishName}</p>}
            <p className="text-xs text-gray-400 mt-1">{isEn ? (analysis.industry ?? '') : toKoreanIndustry(analysis.industry)} &nbsp;·&nbsp; {isEn ? format(new Date(analysis.createdAt), 'MMM d, yyyy HH:mm') : format(new Date(analysis.createdAt), 'yyyy년 M월 d일 HH:mm', { locale: ko })} {isEn ? "generated" : "생성"}</p>
          </div>
          {analysis.investmentVerdict && (
            <div className="text-right">
              <div className="text-xl font-bold text-gray-900">{isEn ? analysis.investmentVerdict : toKoreanVerdict(analysis.investmentVerdict)}</div>
              {analysis.targetPrice && (
                <div className="text-sm text-gray-600 mt-0.5">{isEn ? "12M Target Price" : "12개월 적정주가"} {formatCurrency(analysis.targetPrice, isUSTicker(analysis.ticker) ? "USD" : "KRW", isEn)}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Back button */}
      <button
        onClick={() => setLocation("/analysis/new")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group print:hidden"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        {isEn ? "Back" : "목록으로"}
      </button>

      {/* ⑩ Sticky Step Nav — 헤더 스크롤 아웃 시 표시 */}
      <AnimatePresence>
        {showStickyNav && analysis && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
            className="sticky top-0 z-30 -mx-3 md:-mx-10 px-3 md:px-10 py-2.5 bg-background/90 backdrop-blur-md border-b border-border print:hidden"
          >
            <div className="flex items-center gap-3 max-w-5xl mx-auto">
              <span className="font-mono text-xs text-muted-foreground/60 shrink-0">{analysis.ticker}</span>
              <span className="text-sm font-bold text-foreground truncate flex-1">{isEn ? (analysis.englishName || analysis.companyName) : analysis.companyName}</span>
              <div className="flex items-center gap-1 shrink-0">
                {ANALYSIS_STEPS_ORDER.map((stepKey, idx) => {
                  const isDone = idx < analysis.steps.length;
                  const isCurrent = idx === analysis.steps.length;
                  return (
                    <div
                      key={stepKey}
                      className={cn(
                        "w-2 h-2 rounded-full transition-colors",
                        isDone ? "bg-primary" : isCurrent ? "bg-primary/50 animate-pulse" : "bg-border"
                      )}
                      title={AGENTS[stepKey]?.name}
                    />
                  );
                })}
                <span className="ml-1.5 text-[10px] font-mono text-muted-foreground/60">
                  {analysis.steps.length}/{ANALYSIS_STEPS_ORDER.length}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 sm:mt-5 space-y-3.5 sm:space-y-4">

      {/* ── Report Hero ─────────────────────────────────────────────── */}
      <div ref={headerRef} className="rounded-[var(--radius)] overflow-hidden border shadow-[var(--shadow-card)] relative bg-card">

        {/* 방향성 글로우 배경 */}
        {headerLivePrice && headerLivePrice.change != null && (
          <div className={cn(
            "absolute inset-0 pointer-events-none opacity-60 dark:opacity-40",
            headerLivePrice.change >= 0
              ? "[background:radial-gradient(ellipse_60%_60%_at_50%_-20%,hsl(142_76%_36%/0.15),transparent)]"
              : "[background:radial-gradient(ellipse_60%_60%_at_50%_-20%,hsl(0_84%_60%/0.15),transparent)]"
          )} />
        )}

        {/* 상단 컬러 스트라이프 */}
        <div className={cn(
          "h-[4px] w-full relative z-10",
          isComplete && effectiveVerdict
            ? ["strong buy", "buy"].includes((effectiveVerdict ?? "").toLowerCase())
              ? "bg-gradient-to-r from-emerald-500/80 to-emerald-400/10"
              : ["sell", "strong sell"].includes((effectiveVerdict ?? "").toLowerCase())
              ? "bg-gradient-to-r from-rose-500/80 to-rose-400/10"
              : "bg-gradient-to-r from-amber-500/80 to-amber-400/10"
            : "bg-gradient-to-r from-primary/80 to-primary/10"
        )} />

        <div className="relative z-10 p-5 sm:p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-5 sm:gap-6">

            {/* ── 왼쪽: 종목 정보 ── */}
            <div className="flex-1 min-w-0">

              {/* 회사명 + 티커 인라인 + 상태 배지 */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h1 className="text-[1.75rem] md:text-[2.1rem] font-display font-extrabold text-foreground leading-tight tracking-[-0.02em]">
                      {isEn ? (analysis.englishName || analysis.companyName) : analysis.companyName}
                    </h1>
                    <span className="font-mono text-[11px] font-bold text-primary/80 bg-primary/8 px-2 py-0.5 rounded-md border border-primary/15 self-end mb-0.5 shrink-0">
                      {analysis.ticker}
                    </span>
                  </div>
                  {!isEn && analysis.englishName && (
                    <p className="text-[11px] text-muted-foreground/50 mt-0.5 font-normal">{analysis.englishName}</p>
                  )}
                </div>
                <span className={cn(
                  "shrink-0 mt-1 px-2.5 py-0.5 text-xs font-semibold rounded-full border",
                  isComplete
                    ? "bg-success/10 text-success border-success/20"
                    : isError
                      ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                      : analysis.status === 'queued'
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse"
                        : "bg-warning/10 text-warning border-warning/20 animate-pulse"
                )}>
                  {isComplete ? (isEn ? 'Complete' : '분석 완료')
                    : isError ? (isEn ? 'Failed' : '실패')
                    : analysis.status === 'queued' ? (isEn ? 'Queued' : '대기 중')
                    : (isEn ? 'In Progress' : '분석 중')}
                </span>
              </div>

              {/* 현재가 + 등락률 pill */}
              <div className="flex items-end gap-3 mb-5">
                {headerLivePrice ? (
                  <>
                    <span className="text-[2.75rem] md:text-[3.25rem] font-black tabular-nums tracking-[-0.035em] leading-none text-foreground">
                      {headerLivePrice.currency === "USD"
                        ? `$${headerLivePrice.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : isEn
                          ? `KRW ${Math.round(headerLivePrice.price).toLocaleString("en-US")}`
                          : `₩${Math.round(headerLivePrice.price).toLocaleString("ko-KR")}`}
                    </span>
                    {headerLivePrice.change != null && (
                      <span className={cn(
                        "inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-full mb-1.5 shrink-0 border",
                        headerLivePrice.change >= 0
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                      )}>
                        {headerLivePrice.change >= 0 ? "▲" : "▼"} {Math.abs(headerLivePrice.change).toFixed(2)}%
                      </span>
                    )}
                  </>
                ) : (
                  <div className="flex items-end gap-3">
                    <div className="h-12 w-44 bg-muted/50 rounded-lg animate-pulse" />
                    <div className="h-7 w-20 bg-muted/40 rounded-full animate-pulse mb-1.5" />
                  </div>
                )}
              </div>

              {/* 52주 레인지 바 */}
              {(() => {
                const currency = isUSTicker(analysis.ticker) ? "USD" : "KRW";
                const fmtP = (v: number | null) => {
                  if (v == null) return "—";
                  if (currency === "USD") return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
                  return `₩${Math.round(v).toLocaleString("ko-KR")}`;
                };
                const st = headerTickerStats;
                if (!st?.week52Low || !st?.week52High || !headerLivePrice) return null;
                const lo = st.week52Low, hi = st.week52High, cur = headerLivePrice.price;
                const pct = hi > lo ? Math.max(2, Math.min(98, ((cur - lo) / (hi - lo)) * 100)) : 50;
                const isUp = headerLivePrice.change != null ? headerLivePrice.change >= 0 : true;
                return (
                  <div className="mb-4">
                    <div className="flex justify-between text-[10px] text-muted-foreground/50 mb-1.5 tabular-nums">
                      <span>{isEn ? "52W Low " : "52주 저 "}<span className="font-semibold text-muted-foreground/70">{fmtP(lo)}</span></span>
                      <span className="text-muted-foreground/35 hidden sm:block">{isEn ? "52-week range" : "52주 레인지"}</span>
                      <span><span className="font-semibold text-muted-foreground/70">{fmtP(hi)}</span>{isEn ? " 52W High" : " 52주 고"}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/60 relative overflow-visible">
                      <div className="h-full rounded-full" style={{
                        width: `${pct}%`,
                        background: isUp
                          ? "linear-gradient(to right,hsl(var(--muted-foreground)/0.2),#10B981)"
                          : "linear-gradient(to right,hsl(var(--muted-foreground)/0.2),#F87171)",
                      }} />
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-background shadow-[var(--shadow-card)]"
                        style={{ left: `${pct}%`, background: isUp ? "#10B981" : "#F87171" }} />
                    </div>
                  </div>
                );
              })()}

              {/* 지표 칩 */}
              {(() => {
                const currency = isUSTicker(analysis.ticker) ? "USD" : "KRW";
                const fmtVol = (v: number | null) => {
                  if (v == null) return null;
                  if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
                  if (v >= 1e4) return `${Math.round(v / 1e3)}K`;
                  return v.toLocaleString();
                };
                const fmtMC = (v: number | null, cur: string) => {
                  if (v == null) return null;
                  if (cur === "USD") {
                    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
                    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
                    return `$${(v / 1e6).toFixed(0)}M`;
                  }
                  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
                  return `${Math.round(v / 1e8)}억`;
                };
                const st = headerTickerStats;
                const mc = headerMarketCap;
                const chips = [
                  { label: isEn ? "Mkt Cap" : "시총", value: fmtMC(mc?.value ?? null, mc?.currency ?? currency) },
                  { label: "PER", value: st?.per != null ? `${st.per.toFixed(1)}x` : null },
                  { label: "PBR", value: st?.pbr != null ? `${st.pbr.toFixed(2)}x` : null },
                  { label: isEn ? "Volume" : "거래량", value: st?.volume != null ? fmtVol(st.volume) : null },
                ].filter(c => c.value != null) as { label: string; value: string }[];

                if (!st && !mc) return (
                  <div className="flex flex-wrap gap-1.5 mb-3.5">
                    {[80, 60, 64, 72].map((w, i) => (
                      <div key={i} className="h-7 rounded-lg bg-muted/50 animate-pulse" style={{ width: w }} />
                    ))}
                  </div>
                );
                return (
                  <div className="flex flex-wrap gap-1.5 mb-3.5">
                    {chips.map(c => (
                      <div key={c.label} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/50">
                        <span className="text-[10px] text-muted-foreground/55 font-medium">{c.label}</span>
                        <span className="text-[11px] font-bold text-foreground tabular-nums">{c.value}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 하단 메타 행 */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground/55">
                <span className="flex items-center gap-1">
                  <Briefcase className="w-3 h-3 shrink-0" />
                  {isEn ? (analysis.industry ?? "—") : toKoreanIndustry(analysis.industry)}
                </span>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 shrink-0" />
                  {isEn ? format(new Date(analysis.createdAt), 'MMM d, HH:mm') : format(new Date(analysis.createdAt), 'M월 d일 HH:mm', { locale: ko })}
                </span>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1 text-amber-500/70">
                  <Zap className="w-3 h-3 shrink-0" />
                  {isEn ? 'AI · Reference only' : 'AI 자동생성 · 참고용'}
                </span>
              </div>
            </div>


            {/* ── 오른쪽: Verdict Card ── */}
            <div className="flex flex-col items-start md:items-end gap-3 print:hidden w-full md:w-auto">

          {/* Verdict Card */}
          {isComplete && effectiveVerdict && (
            <div ref={verdictRef} className="w-full md:w-auto md:min-w-[220px]">
              {(() => {
                const isSellVerdict = ["sell", "strong sell"].includes((effectiveVerdict ?? "").toLowerCase());
                const currency = isUSTicker(analysis.ticker) ? "USD" : "KRW";
                const sp = (analysis as any).startPrice as number | null ?? null;
                const tp = analysis.targetPrice ?? null;
                const upsidePct = (sp && tp && sp > 0) ? ((tp - sp) / sp * 100) : null;
                const isUp = upsidePct !== null ? upsidePct >= 0 : true;
                const upColor = isUp
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-500 dark:text-rose-400";
                return (
                  <div className="rounded-[var(--radius)] border border-border/60 bg-card overflow-hidden shadow-[var(--shadow-card)]">
                    {/* 적정주가 */}
                    <div className="px-5 pt-4 pb-3">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
                        {isEn ? "Fair Value (12M)" : "적정주가 (12개월)"}
                      </p>
                      <p className={`text-2xl font-black tabular-nums leading-none tracking-tight ${upColor}`}>
                        {formatCurrency(tp, currency, isEn)}
                      </p>
                      {upsidePct !== null && (
                        <p className={`text-[12px] font-bold mt-1 tabular-nums ${upColor}`}>
                          {upsidePct >= 0 ? "+" : ""}{upsidePct.toFixed(1)}%
                          <span className="text-[10px] font-normal text-muted-foreground ml-1">
                            {isEn ? "vs entry" : "상승여지"}
                          </span>
                        </p>
                      )}
                    </div>
                    {/* 공유 버튼 */}
                    <div className="px-3 pb-3">
                      <button
                        onClick={() => setShowShareModal(true)}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-[var(--radius)] bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        {isEn ? 'Share this analysis' : '이 분석 공유하기'}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          </div>
        </div>
      </div>
      </div>

      {/* ── 주가 차트 (헤더 바로 아래) ── */}
      <div className="rounded-[var(--radius)] bg-card overflow-hidden print:hidden shadow-[var(--shadow-card)]">
        <ErrorBoundary fallback={null}>
          <StockChart
            ticker={analysis.ticker}
            companyName={analysis.companyName}
            companyNameEn={analysis.englishName}
            currency={isUSTicker(analysis.ticker) ? "USD" : "KRW"}
            isEn={isEn}
            validatedTargetPrice={(analysis as any).targetPrice ?? null}
            hideHeader
          />
        </ErrorBoundary>
      </div>

      {/* ── 분석 파이프라인 미니 진행바 ── */}
      {!isComplete && !isError && (
        <div className="print:hidden flex items-center gap-3 px-1">
          <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
              style={{ width: `${(currentStepCount / ANALYSIS_STEPS_ORDER.length) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {currentStepCount}/{ANALYSIS_STEPS_ORDER.length}{isEn ? " steps" : " 단계"}
            {isStreaming && <span className="ml-1 text-primary/70 animate-pulse">{isEn ? " · analyzing…" : " · 분석 중…"}</span>}
          </span>
        </div>
      )}

      {/* ── 큐 대기 중 ── */}
      {analysis.status === 'queued' && (
        <div className="print:hidden rounded-[var(--radius)] bg-card border border-blue-500/20 p-5 flex items-center gap-4">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
          <div>
            <p className="font-semibold text-foreground text-sm">{isEn ? "Queued for Analysis" : "분석 대기 중"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{isEn ? "Will start when a slot opens." : "슬롯이 열리면 자동으로 시작됩니다."}</p>
          </div>
        </div>
      )}

      {/* ── 분석 실패 ── */}
      {isError && (
        <div className="print:hidden rounded-[var(--radius)] bg-card border border-red-500/20 p-5 flex items-center gap-4">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <div>
            <p className="font-semibold text-foreground text-sm">{isEn ? "Analysis Failed" : "분석 생성 실패"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{isEn ? "AI error — please re-run." : "AI 오류 — 다시 실행해 주세요."}</p>
          </div>
        </div>
      )}

      {/* ══ 섹션 1: 이 기업, 어떤 산업에서 어떻게 돈 버나요? ══ */}
      {(() => {
        const introStep = analysis.steps.find((s: any) => s.stepKey === "company_intro");
        const indStep   = analysis.steps.find((s: any) => s.stepKey === "industry_analysis");
        const streamingIntro = streamingStep?.key === "company_intro";
        const streamingInd   = streamingStep?.key === "industry_analysis";
        const hasAny = !!(introStep || indStep);
        const activelyStreaming = streamingIntro || streamingInd;
        if (!hasAny && !activelyStreaming && (isComplete || isError)) return null;
        return (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.45,ease:"easeOut"}}>
          <NarrativeSectionBlock
            num={1}
            title={isEn ? "What does this company do & what industry is it in?" : "이 기업, 어떤 산업에서 어떻게 돈 버나요?"}
            subtitle={isEn ? "Business overview · Revenue model · Industry position" : "사업 개요 · 수익 구조 · 산업 내 포지션"}
            accent="#6366F1"
            pending={!hasAny && !activelyStreaming}
            isEn={isEn}
          >
            {/* 기업 소개 */}
            {streamingIntro && !introStep ? (
              <div className="flex items-center gap-3 py-10 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#6366F1" }} />
                <span className="text-sm text-muted-foreground">{isEn ? "Figuring out how they make money…" : "이 회사가 어떻게 돈 버는지 파악 중…"}</span>
              </div>
            ) : introStep ? (
              <ErrorBoundary fallback={null}>
                <NarrativeStepContent step={introStep} isEn={isEn} ticker={analysis.ticker} accent="#6366F1" />
              </ErrorBoundary>
            ) : null}

            {/* 산업 소개 — compact 다이제스트 */}
            {indStep ? (
              <div className={introStep ? "mt-6 pt-6 border-t border-border/40" : ""}>
                <ErrorBoundary fallback={null}>
                  <NarrativeStepContent step={indStep} isEn={isEn} ticker={analysis.ticker} accent="#6366F1" compact />
                </ErrorBoundary>
              </div>
            ) : streamingInd ? (
              <div className={`flex items-center gap-3 py-6 justify-center ${introStep ? "mt-6 pt-6 border-t border-border/40" : ""}`}>
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#6366F1" }} />
                <span className="text-sm text-muted-foreground">{isEn ? "Mapping the playing field…" : "이 판이 어떻게 돌아가는지 읽는 중…"}</span>
              </div>
            ) : null}
          </NarrativeSectionBlock>
          </motion.div>
        );
      })()}

      {/* ══ 섹션 2 (핵심): 사업보고서로 읽는 이 기업의 진짜 이야기 ══ */}
      {(() => {
        const dartStep  = analysis.steps.find((s: any) => s.stepKey === "dart_report_analysis");
        const compStep  = analysis.steps.find((s: any) => s.stepKey === "company_analysis");
        const streamingDart = streamingStep?.key === "dart_report_analysis";
        const streamingComp = streamingStep?.key === "company_analysis";
        const sec1Done = !!(
          analysis.steps.find((s: any) => s.stepKey === "company_intro") ||
          analysis.steps.find((s: any) => s.stepKey === "industry_analysis")
        );
        const showSection = isComplete || !!(dartStep || compStep) || streamingDart || streamingComp || sec1Done;
        if (!showSection) return null;
        const currency: "KRW" | "USD" = isUSTicker(analysis.ticker) ? "USD" : "KRW";
        return (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.45,ease:"easeOut"}}>
          <NarrativeSectionBlock
            num={2}
            title={isEn ? "What do the filings really say?" : "사업보고서로 읽는 이 기업의 진짜 이야기"}
            subtitle={isEn ? "DART filings · Historical flow · Hidden context · Management signals" : "과거 흐름 · 숨은 맥락 · 사업 변화 · 경영진 신호"}
            accent="#10B981"
            pending={!dartStep && !streamingDart}
            isEn={isEn}
          >
            {dartStep ? (
              <ErrorBoundary fallback={null}>
                <NarrativeStepContent step={dartStep} isEn={isEn} ticker={analysis.ticker} accent="#10B981" />
              </ErrorBoundary>
            ) : streamingDart ? (
              <div className="flex items-center gap-3 py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#10B981" }} />
                <span className="text-sm text-muted-foreground">{isEn ? "Speed-reading filings… skipping the fluff 📄" : "사업보고서 정독 중… CEO 자랑은 건너뜀 📄"}</span>
              </div>
            ) : null}
          </NarrativeSectionBlock>
          </motion.div>
        );
      })()}

      {/* ══ 실적 분석 카드 ══ */}
      {(() => {
        const compStep = analysis.steps.find((s: any) => s.stepKey === "company_analysis");
        const streamingComp = streamingStep?.key === "company_analysis";
        const dartStarted = !!(
          analysis.steps.find((s: any) => s.stepKey === "dart_report_analysis") ||
          analysis.steps.find((s: any) => s.stepKey === "company_analysis") ||
          streamingStep?.key === "dart_report_analysis" ||
          streamingStep?.key === "company_analysis"
        );
        const showCard = isComplete || dartStarted;
        if (!showCard) return null;
        const currency: "KRW" | "USD" = isUSTicker(analysis.ticker) ? "USD" : "KRW";
        return (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.45,ease:"easeOut"}}>
          <NarrativeSectionBlock
            num={3}
            title={isEn ? "How are the numbers looking?" : "실적과 주가, 숫자로 보는 기업"}
            subtitle={isEn ? "Earnings trend · Financial deep-dive · Price action" : "실적 추이 · 재무 심층 · 주가 흐름"}
            accent="#10B981"
            pending={false}
            isEn={isEn}
          >
            <div className="divide-y divide-border/30 -mx-5 sm:-mx-6">
              {/* 실적 차트 */}
              <div className="px-5 sm:px-6 py-5">
                <FinancialChart ticker={analysis.ticker} isEn={isEn} />
              </div>

              {/* 재무 심층 분석 */}
              {compStep ? (
                <div className="px-5 sm:px-6 py-5">
                  <ErrorBoundary fallback={null}>
                    <NarrativeStepContent step={compStep} isEn={isEn} ticker={analysis.ticker} accent="#10B981" />
                  </ErrorBoundary>
                </div>
              ) : streamingComp ? (
                <div className="px-5 sm:px-6 py-6 flex items-center gap-3 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span className="text-sm text-muted-foreground">{isEn ? "Making numbers tell a story…" : "숫자에 이야기 입히는 중… 📊"}</span>
                </div>
              ) : null}

              {/* 주가 흐름 — 상단에 이미 표시되므로 이 섹션에서는 생략 */}
            </div>
          </NarrativeSectionBlock>
          </motion.div>
        );
      })()}

      {/* ══ 섹션 4: 지금 이 기업에 무슨 일이 일어나고 있나 ══ */}
      {(() => {
        const catStep = analysis.steps.find((s: any) => s.stepKey === "catalyst_analysis");
        const streamingCat = streamingStep?.key === "catalyst_analysis";
        const hasAny = !!catStep;
        // 뉴스 타임라인은 항상 표시 (캐시 기반 독립 fetch)
        const prevDone = !!(
          analysis.steps.find((s: any) => s.stepKey === "company_analysis") ||
          analysis.steps.find((s: any) => s.stepKey === "dart_report_analysis")
        );
        const showSection = isComplete || hasAny || streamingCat || prevDone;
        if (!showSection) return null;
        return (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.45,ease:"easeOut"}}>
          <NarrativeSectionBlock
            num={4}
            title={isEn ? "What's happening right now?" : "지금 이 기업에 무슨 일이 일어나고 있나"}
            subtitle={isEn ? "Recent news · Business change signals · Catalysts & risks" : "최근 뉴스 · 사업 변화 신호 · 촉매와 리스크"}
            accent="#F59E0B"
            pending={!hasAny && !streamingCat && !isComplete}
            isEn={isEn}
          >
            {/* ① 최근 뉴스 타임라인 */}
            <div>
              <p className="text-[10.5px] font-bold tracking-widest uppercase text-muted-foreground/50 mb-3">
                {isEn ? "Recent news" : "최근 뉴스"}
              </p>
              <StockNewsTimeline ticker={analysis.ticker} companyName={analysis.companyName} isEn={isEn} />
            </div>

            {/* ② 촉매 + 향후 타임라인 */}
            {catStep ? (
              <div className="mt-6 pt-6 border-t border-border/40">
                <ErrorBoundary fallback={null}>
                  <CatalystView step={catStep} isEn={isEn} accent="#F59E0B" />
                </ErrorBoundary>
              </div>
            ) : streamingCat ? (
              <div className="flex items-center gap-3 py-6 justify-center mt-6 pt-6 border-t border-border/40">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#F59E0B" }} />
                <span className="text-sm text-muted-foreground">{isEn ? "Filling in the events calendar… 📅" : "앞으로 뭔 일이 생길지 캘린더 채우는 중… 📅"}</span>
              </div>
            ) : null}
          </NarrativeSectionBlock>
          </motion.div>
        );
      })()}

      {/* ══ 섹션 5: 애빛다 총정리 (투자 판단 + 6렌즈) ══ */}
      {(() => {
        const stratStep = analysis.steps.find((s: any) => s.stepKey === "investment_strategy");
        const streamingStrat = streamingStep?.key === "investment_strategy";
        const thesisStep = analysis.steps.find((s: any) => s.stepKey === "investment_thesis");
        const streamingThesis = streamingStep?.key === "investment_thesis";
        const catStarted = !!(
          analysis.steps.find((s: any) => s.stepKey === "catalyst_analysis") ||
          streamingStep?.key === "catalyst_analysis"
        );
        const showSection = !!stratStep || streamingStrat || !!thesisStep || streamingThesis ||
          (catStarted && !isComplete && !isError);
        if (!showSection) return null;
        const canRunThesis = !thesisStep && !streamingThesis && !isStreaming && !!stratStep;
        return (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.45,ease:"easeOut"}}>
          <NarrativeSectionBlock
            num={5}
            title={isEn ? "Aibida Wrap-Up" : "애빛다 총정리"}
            subtitle={isEn ? "Investment verdict · 6-lens deep read" : "투자 판단 · 6렌즈 심층 해석"}
            accent="#8B5CF6"
            pending={!stratStep && !streamingStrat && !thesisStep && !streamingThesis}
            isEn={isEn}
          >
            {/* ① 투자 결론 */}
            {streamingStrat && !stratStep ? (
              <div className="flex items-center gap-3 py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#8B5CF6" }} />
                <span className="text-sm text-muted-foreground">{isEn ? "Drumroll for the verdict… 🥁" : "최종 판단 내리는 중… 두구두구 🥁"}</span>
              </div>
            ) : stratStep ? (
              <ErrorBoundary fallback={null}>
                <InvestmentPointsView step={stratStep} isEn={isEn} />
              </ErrorBoundary>
            ) : null}

            {/* ② 6렌즈 심층 해석 — 투자 결론 아래에 붙음 */}
            {stratStep && (
              <div className="mt-6 pt-6 border-t border-border/40">
                <p className="text-[10.5px] font-bold tracking-widest uppercase text-muted-foreground/50 mb-4">
                  {isEn ? "6-Lens Deep Read" : "6렌즈 심층 해석"}
                </p>
                {thesisStep ? (
                  <ErrorBoundary fallback={null}>
                    <ThesisView step={thesisStep} isEn={isEn} />
                  </ErrorBoundary>
                ) : streamingThesis ? (
                  <div className="flex items-center gap-3 py-8 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#8B5CF6" }} />
                    <span className="text-sm text-muted-foreground">{isEn ? "Mining for truths between the lines… 🔭" : "줄 사이에 숨은 진실 캐내는 중… 🔭"}</span>
                  </div>
                ) : canRunThesis ? (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <button
                      onClick={() => {
                        if (!triggeredSteps.current.has("investment_thesis")) {
                          triggeredSteps.current.add("investment_thesis");
                          runStreamingStepRef.current?.("investment_thesis");
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-white"
                      style={{ background: "#8B5CF6" }}
                    >
                      <span>🔭</span>
                      {isEn ? "Run 6-lens analysis" : "6렌즈 분석하기"}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </NarrativeSectionBlock>
          </motion.div>
        );
      })()}


      {/* ══ 섹션 6: 투자 체크리스트 ══ */}
      {(() => {
        const checklistStep = analysis.steps.find((s: any) => s.stepKey === "checklist");
        const streamingChecklist = streamingStep?.key === "checklist";
        const thesisStarted = !!(analysis.steps.find((s: any) => s.stepKey === "investment_thesis") || streamingStep?.key === "investment_thesis");
        // isComplete 여부와 무관하게 thesis가 시작된 이후엔 섹션 표시
        // (과거 완료 분석에서 checklist가 없어도 pending 상태로 표시 → 수동 실행 가능)
        const showSection = !!checklistStep || streamingChecklist || thesisStarted;
        if (!showSection) return null;
        return (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
          <NarrativeSectionBlock
            num={6}
            title={isEn ? "Investment Checklist" : "투자 체크리스트"}
            subtitle={isEn ? "10 must-check criteria · pass / warn / fail" : "주식 볼 때 반드시 점검해야 할 10가지"}
            accent="#10b981"
            pending={!checklistStep && !streamingChecklist}
            isEn={isEn}
          >
            {streamingChecklist && !checklistStep ? (
              <div className="flex items-center gap-3 py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#10b981" }} />
                <span className="text-sm text-muted-foreground">{isEn ? "Running checklist…" : "체크리스트 점검 중… ✅"}</span>
              </div>
            ) : checklistStep ? (
              <ErrorBoundary fallback={null}>
                <ChecklistView step={checklistStep} isEn={isEn} />
              </ErrorBoundary>
            ) : null}
          </NarrativeSectionBlock>
          </motion.div>
        );
      })()}

      {/* ── 추가 데이터 패널 ── */}
      <details className="group rounded-[var(--radius)] bg-card border border-border/60 overflow-hidden print:hidden shadow-[var(--shadow-card)]">
        <summary className="flex items-center justify-between px-5 py-4 cursor-pointer select-none hover:bg-muted/30 transition-colors list-none">
          <span className="text-[13px] font-semibold text-muted-foreground">{isEn ? "More data (ETF, peers, shareholders…)" : "추가 데이터 더 보기 (ETF · 동종업체 · 주주 현황 등)"}</span>
          <ChevronDown className="w-4 h-4 text-muted-foreground/50 group-open:rotate-180 transition-transform" />
        </summary>
        <div className="px-3 pb-4 space-y-3 border-t border-border/40 pt-4">
          <ETFSection ticker={analysis.ticker} companyName={analysis.companyName} industry={analysis.industry ?? undefined} />
          <StockDisclosurePanel ticker={analysis.ticker} isEn={isEn} />
          <DividendInfoPanel ticker={analysis.ticker} isEn={isEn} />
          <ShortSellingPanel ticker={analysis.ticker} isEn={isEn} />
          <AnalystConsensusPanel ticker={analysis.ticker} currentPrice={(analysis as any).startPrice ?? null} isEn={isEn} />
          <MajorShareholdersPanel ticker={analysis.ticker} isEn={isEn} />
          <PeerMultiplesPanel ticker={analysis.ticker} isEn={isEn} />
          <VersionTimelinePanel ticker={analysis.ticker} currentId={analysis.id} isEn={isEn} />
          <FilingTimelinePanel ticker={analysis.ticker} isEn={isEn} />
        </div>
      </details>


      {/* 보관하기 · 공유하기 + Disclaimer — 분석 완료 후 페이드인 */}
      <AnimatePresence>
        {isComplete && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
          >
            {/* 공유하기 */}
            <div className="mt-8 print:hidden">
              <button
                onClick={() => setShowShareModal(true)}
                className="w-full flex items-center justify-center gap-2.5 rounded-[var(--radius)] border border-border bg-background px-5 py-3.5 text-sm font-semibold text-foreground/80 transition-all duration-200 hover:border-primary/40 hover:text-primary hover:bg-primary/5"
              >
                <Share2 className="w-4 h-4" />
                {isEn ? "Share" : "공유하기"}
              </button>
            </div>
            {showShareModal && (
              <ShareModal analysis={analysis} onClose={() => setShowShareModal(false)} />
            )}

            {/* 비로그인 방문자 가입 유도 배너 */}
            {isAuthLoaded && !isSignedIn && (
              <div className="print:hidden fixed bottom-0 left-0 right-0 z-40 pointer-events-none flex justify-center px-4 pb-4">
                <motion.div
                  initial={{ y: 80, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 1.2, type: "spring", damping: 25 }}
                  className="pointer-events-auto w-full max-w-lg rounded-[var(--radius)] bg-card/95 backdrop-blur-md border border-border shadow-2xl px-5 py-4 flex items-center gap-4"
                >
                  <div className="w-9 h-9 rounded-[var(--radius)] bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <BrainCircuit className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground text-[13px] font-bold leading-tight">{isEn ? "Did you find this analysis useful?" : "이 분석이 마음에 드셨나요?"}</p>
                    <p className="text-muted-foreground text-[11px] mt-0.5">{isEn ? "Sign up and start your own AI analysis" : "가입하고 직접 AI 분석을 시작해 보세요"}</p>
                  </div>
                  <a
                    href="/login"
                    className="flex-shrink-0 px-4 py-2 rounded-[var(--radius)] bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors whitespace-nowrap"
                  >
                    {isEn ? "Start Analysis →" : "분석 시작하기 →"}
                  </a>
                </motion.div>
              </div>
            )}

            {/* 사용자 피드백 */}
            <div className="mt-4 print:hidden">
              {feedbackSubmitted ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center justify-center gap-2 rounded-[var(--radius)] bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 px-5 py-3 text-sm text-emerald-700 dark:text-emerald-400 font-medium"
                >
                  <Check className="w-4 h-4" />
                  {isEn ? "Your feedback helps improve our AI. Thank you!" : "피드백이 AI 학습에 반영되었습니다. 감사합니다!"}
                </motion.div>
              ) : (
                <div className="rounded-[var(--radius)] border border-border bg-background px-5 py-4 space-y-3">
                  {/* 헤더 */}
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{isEn ? "Was this analysis helpful?" : "이 분석이 도움이 됐나요?"}</span>
                    <span className="text-[10px] text-muted-foreground">{isEn ? "— Your answer helps improve our AI" : "— 답변이 AI 개선에 사용됩니다"}</span>
                  </div>

                  {/* 👍 / 👎 버튼 — 클릭 즉시 칩 펼침 */}
                  <div className="flex items-center gap-2">
                    {(
                      [
                        { value: 5 as const, label: isEn ? "Helpful" : "도움됐어요", icon: <ThumbsUp className="w-3.5 h-3.5" />, active: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400", hover: "hover:border-emerald-300 hover:text-emerald-700 dark:hover:text-emerald-400" },
                        { value: 1 as const, label: isEn ? "Not helpful" : "아쉬웠어요", icon: <ThumbsDown className="w-3.5 h-3.5" />, active: "bg-rose-50 dark:bg-rose-950/30 border-rose-400 dark:border-rose-600 text-rose-700 dark:text-rose-400", hover: "hover:border-rose-300 hover:text-rose-700 dark:hover:text-rose-400" },
                      ] as const
                    ).map(({ value, label, icon, active, hover }) => (
                      <button
                        key={value}
                        onClick={() => { setFeedbackRating(value); setFeedbackChips([]); }}
                        className={cn(
                          "flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-[13px] font-medium transition-all",
                          feedbackRating === value ? active : `bg-background border-border text-foreground/70 ${hover}`
                        )}
                      >
                        {icon}{label}
                      </button>
                    ))}
                  </div>

                  {/* 세부 이유 칩 */}
                  <AnimatePresence>
                    {feedbackRating && (
                      <motion.div
                        key={feedbackRating}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden space-y-2.5"
                      >
                        <p className="text-[13px] text-muted-foreground">
                          {isEn
                            ? (feedbackRating === 5 ? "What did you like?" : "What could be better?")
                            : (feedbackRating === 5 ? "어떤 점이 좋았나요?" : "어떤 점이 아쉬웠나요?")}
                          <span className="ml-1 text-muted-foreground/50">{isEn ? "(select multiple)" : "(여러 개 선택 가능)"}</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(feedbackRating === 5
                            ? (isEn
                              ? ["Valuation was clear", "Helped my investment decision", "Data was rich", "Risk analysis was solid", "Industry understanding was deep"]
                              : ["밸류에이션 근거가 명확해요", "투자 판단에 도움됐어요", "데이터가 풍부해요", "리스크 분석이 탄탄해요", "업종 이해가 깊어요"])
                            : (isEn
                              ? ["Data was inaccurate", "Valuation rationale was weak", "Conclusion was vague", "Lacked industry understanding", "Risks were overlooked"]
                              : ["데이터가 부정확해요", "밸류에이션 근거가 약해요", "결론이 모호해요", "업종 이해가 부족해요", "리스크가 간과됐어요"])
                          ).map((chip) => {
                            const selected = feedbackChips.includes(chip);
                            return (
                              <button
                                key={chip}
                                onClick={() => setFeedbackChips(prev =>
                                  selected ? prev.filter(c => c !== chip) : [...prev, chip]
                                )}
                                className={cn(
                                  "px-3 py-1.5 rounded-full border text-[12px] font-medium transition-all",
                                  feedbackRating === 5
                                    ? selected
                                      ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400"
                                      : "bg-background border-border text-muted-foreground hover:border-emerald-300 hover:text-emerald-600 dark:hover:text-emerald-400"
                                    : selected
                                      ? "bg-rose-50 dark:bg-rose-950/30 border-rose-400 dark:border-rose-600 text-rose-700 dark:text-rose-400"
                                      : "bg-background border-border text-muted-foreground hover:border-rose-300 hover:text-rose-600 dark:hover:text-rose-400"
                                )}
                              >
                                {selected && <span className="mr-1">✓</span>}{chip}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => submitFeedback()}
                          disabled={feedbackSubmitting}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-foreground text-white text-[13px] font-semibold hover:bg-foreground/80 transition-colors disabled:opacity-50"
                        >
                          {feedbackSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          {isEn ? "Submit" : "제출하기"}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* 분석 완료 후 행동 유도 CTA */}
            {isComplete && <PortfolioCTA ticker={analysis.ticker} companyName={analysis.companyName} isEn={isEn} />}

            {/* 관리자 종목 보정 메모 — 관리자에게만 표시 */}
            {isComplete && isAdmin && (
              <div className="mt-4 print:hidden">
                <div className="rounded-[var(--radius)] border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/15 px-5 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">📝 종목 보정 메모</span>
                    <span className="text-[10px] text-amber-600 dark:text-amber-500">— 다음 AI 분석에 자동 반영됩니다</span>
                  </div>
                  <textarea
                    value={tickerMemo}
                    onChange={e => setTickerMemo(e.target.value)}
                    placeholder={`${analysis.companyName}(${analysis.ticker})에 대한 특수 사항, 보정 지시, 사업 특성 등을 입력하세요.\n예) HBM 점유율 변화가 핵심 드라이버 / 2023년 DS 적자는 일회성 처리할 것`}
                    className="w-full text-[13px] rounded-lg border border-amber-200 dark:border-amber-800/50 bg-background px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700 text-foreground/80 placeholder:text-amber-300 dark:placeholder:text-amber-700"
                    rows={3}
                    maxLength={1000}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveTickerMemo}
                      disabled={tickerMemoSaving || tickerMemo === tickerMemoSaved}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700 transition-colors disabled:opacity-40"
                    >
                      {tickerMemoSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      저장하기
                    </button>
                    {tickerMemoSavedOk && (
                      <span className="text-[12px] text-emerald-600 dark:text-emerald-400 font-medium">✓ 저장됐습니다. 다음 분석부터 반영됩니다.</span>
                    )}
                    {tickerMemo.length > 0 && (
                      <span className="text-[11px] text-amber-500 ml-auto">{tickerMemo.length}/1000</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div className="mt-5 pt-6 border-t border-border print:mt-6">
              {/* AI 생성 명시 배너 (AI 기본법 투명성 의무) */}
              <div className="mb-3 flex items-start gap-2.5 rounded-lg bg-card border border-border border-l-4 border-l-amber-400 px-4 py-3">
                <span className="text-amber-500 text-base leading-none mt-0.5 shrink-0">⚠</span>
                <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                  {isEn ? (
                    <><span className="font-bold text-foreground/80">AI-Generated Content.</span> This report was automatically generated by a large language model (LLM) AI based on publicly available data. It has not been reviewed by human experts and may contain factual or reasoning errors. Always verify with official filings and professional advice before making investment decisions.</>
                  ) : (
                    <><span className="font-bold text-foreground/80">AI 자동 생성 콘텐츠.</span> 본 리포트는 대형 언어모델(LLM) AI가 공개 데이터를 바탕으로 자동 생성한 분석 참고 자료입니다. 인간 전문가의 검토를 거치지 않았으며, 사실 오류·추론 오류가 포함될 수 있습니다. 투자 결정 전 반드시 공식 공시 자료 및 전문가 의견을 별도로 확인하십시오.</>
                  )}
                </p>
              </div>

              <div className="rounded-[var(--radius)] bg-muted/70 border border-border px-5 py-4 space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{isEn ? "Legal Disclaimer" : "투자 유의사항 (Legal Disclaimer)"}</p>
                {isEn ? (
                  <>
                    <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                      This report is <span className="font-semibold">for reference only</span>. AI agents read DART filings, earnings data, news, and catalysts to surface insights from a company's disclosures. This service does not constitute investment advisory or discretionary investment management under applicable law.
                    </p>
                    <div className="space-y-2 mt-1">
                      <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground/70">Your responsibility:</span> Nothing in this report constitutes a recommendation to buy or sell any security. All investment decisions and their outcomes are solely your responsibility.
                      </p>
                      <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground/70">AI limitations:</span> AI-generated analysis may contain factual errors, misinterpretations, or omissions. Target prices and forward estimates are AI judgments, not guaranteed outcomes. Always verify key figures against primary sources.
                      </p>
                      <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground/70">Primary sources:</span> Before acting on this report, verify information through DART (dart.fss.or.kr), official exchange filings, and company press releases.
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border">
                      Unauthorized reproduction or redistribution is prohibited. &nbsp;·&nbsp; AI-generated content disclosed per applicable regulation.
                    </p>
                    <p className="text-[10.5px] text-muted-foreground mt-1">
                      Generated: {analysis.createdAt ? new Date(analysis.createdAt).toLocaleString("en-US") : "—"} &nbsp;·&nbsp; © CBST (애빛다). All rights reserved.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                      본 리포트는 「CBST」가 운영하는 AI 서비스 「애빛다」가 DART 사업보고서, 실적 데이터, 뉴스, 공시 자료를 바탕으로 자동 생성한 <span className="font-semibold">순수 참고용 정보</span>입니다. 본 서비스는 투자자문업·투자일임업에 해당하지 않으며, 특정 투자 행위를 권유하지 않습니다.
                    </p>
                    <div className="space-y-2 mt-1">
                      <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground/70">투자 책임:</span> 본 리포트의 모든 내용은 정보 제공 목적이며, 투자 판단과 그 결과에 대한 책임은 전적으로 투자자 본인에게 귀속됩니다.
                      </p>
                      <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground/70">AI 한계:</span> AI가 사업보고서·공시·뉴스를 해석하는 과정에서 사실 오류, 누락, 오해석이 포함될 수 있습니다. 적정주가 및 실적 전망은 AI의 판단으로, 보장된 수치가 아닙니다.
                      </p>
                      <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground/70">원본 확인 권장:</span> 투자 결정 전 금융감독원 전자공시시스템(DART), 거래소 공시, 기업 공식 보도자료를 통해 핵심 내용을 직접 확인하시기 바랍니다.
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border">
                      본 리포트의 무단 복제·배포·재가공은 금지됩니다. &nbsp;·&nbsp; 인공지능 기본법에 따라 AI 생성 콘텐츠임을 고지합니다.
                    </p>
                    <p className="text-[10.5px] text-muted-foreground mt-1">
                      분석 생성일: {analysis.createdAt ? new Date(analysis.createdAt).toLocaleString("ko-KR") : "—"} &nbsp;·&nbsp; © CBST(애빛다). All rights reserved.
                    </p>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ⑨ Floating Verdict Card — verdict card 뷰포트 이탈 시 우하단에 표시 */}
      <AnimatePresence>
        {showFloatingVerdict && isComplete && effectiveVerdict && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed bottom-5 right-4 z-50 bg-card/95 border border-border rounded-[var(--radius)] shadow-2xl p-4 min-w-[200px] max-w-[240px] print:hidden"
            style={{ backdropFilter: "blur(16px)" }}
          >
            <div className="flex items-start justify-between gap-2 mb-2.5">
              <div className="min-w-0">
                <p className="text-[10px] font-mono text-muted-foreground/60 leading-none mb-0.5">{analysis.ticker}</p>
                <p className="text-[12.5px] font-bold text-foreground leading-tight truncate">{isEn ? ((analysis as any).englishName ?? analysis.companyName) : analysis.companyName}</p>
              </div>
              {(() => {
                const sp = (analysis as any).startPrice as number | null ?? null;
                const tp = analysis.targetPrice ?? null;
                const upsidePct = (sp && tp && sp > 0) ? ((tp - sp) / sp * 100) : null;
                if (upsidePct == null) return (
                  <span className="text-[11px] font-bold text-foreground/80 shrink-0">{isEn ? (effectiveVerdict ?? '–') : toKoreanVerdict(effectiveVerdict)}</span>
                );
                return (
                  <div className="text-right shrink-0">
                    <p className={`text-[20px] font-black tabular-nums leading-none ${upsidePct >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {upsidePct >= 0 ? "+" : ""}{upsidePct.toFixed(1)}%
                    </p>
                    <p className="text-[9px] text-muted-foreground/60 mt-0.5">{isEn ? (upsidePct >= 0 ? "Upside" : "Downside") : (upsidePct >= 0 ? "상승여지" : "하락여지")}</p>
                  </div>
                );
              })()}
            </div>
            <div className="space-y-1 font-mono">
              {analysis.targetPrice && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground/60">{isEn ? "Target Price" : "적정주가"}</span>
                  <span className="font-bold text-foreground/80">{formatCurrency(analysis.targetPrice, isUSTicker(analysis.ticker) ? "USD" : "KRW", isEn)}</span>
                </div>
              )}
              {analysis.entryPrice && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground/60">{isEn ? "Entry" : "진입가"}</span>
                  <span className="font-semibold text-emerald-500">{formatCurrency(analysis.entryPrice, isUSTicker(analysis.ticker) ? "USD" : "KRW", isEn)}</span>
                </div>
              )}
            </div>
            <div className="mt-2.5 pt-2 border-t border-border/60">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                <TrendingUp className="w-3 h-3" />
                <span>{isEn ? "Scroll to read full analysis" : "스크롤하여 전체 분석 보기"}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* 맨 위로 가기 버튼 */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 8 }}
            transition={{ duration: 0.18 }}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 active:scale-95 transition-transform flex items-center justify-center print:hidden"
            aria-label="맨 위로"
          >
            <ChevronUp className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatPrice(val: string | number | undefined | null, currency: "KRW" | "USD" = "KRW", isEn = false): string {
  if (val == null) return "N/A";
  const str = String(val).trim();
  const num = parseFloat(str.replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return str;
  if (currency === "USD") {
    return "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(num);
  }
  if (isEn) return "KRW " + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(num);
  return new Intl.NumberFormat("ko-KR").format(num) + "원";
}

function extractJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();

  // 0) FINAL_VALUATION_DATA 제거 — 서버가 검증용으로 주입한 메타데이터 JSON
  //    이 블록이 남아 있으면 lastIndexOf("}")가 이 블록 끝을 잡아 파싱 실패 원인이 됨
  s = s.replace(/FINAL_VALUATION_DATA:\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}/g, "").trim();

  // 1) 마크다운 코드블록 제거 (```json ... ``` 또는 ``` ... ```)
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  // 2) 첫 { 부터 매칭되는 } 까지만 추출 — 중괄호 카운팅 방식
  //    (lastIndexOf는 뒤쪽 별도 JSON 블록까지 포함해버려 파싱 실패 유발)
  const startIdx = s.indexOf("{");
  if (startIdx === -1) return null;
  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) return null;
  s = s.slice(startIdx, endIdx + 1);

  // 시도 1: 원본 그대로
  try { return JSON.parse(s); } catch { /* 계속 */ }
  // 시도 2: trailing comma 제거 (AI가 자주 실수)
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch { /* 계속 */ }
  // 시도 3: 제어 문자 제거
  try { return JSON.parse(s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")); } catch { /* 계속 */ }
  // 시도 3-b: 문자열 값 안의 리터럴 개행(0x0a/0x0d) → 이스케이프 변환
  //   AI가 key_issue 등 긴 텍스트 필드에 실제 줄바꿈을 그대로 삽입할 때 발생
  try {
    const fixedNl = s.replace(/"((?:[^"\\]|\\.)*)"/gs, (_m, inner) =>
      `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
    );
    return JSON.parse(fixedNl);
  } catch { /* 계속 */ }
  // 시도 3-c: 개행 이스케이프 + trailing comma 복합
  try {
    const fixedNlComma = s
      .replace(/"((?:[^"\\]|\\.)*)"/gs, (_m, inner) =>
        `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
      )
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixedNlComma);
  } catch { /* 계속 */ }
  // 시도 4: 따옴표 없는 % 숫자 값 → 문자열로 변환
  //   AI가 "upside": 275.6%  로 출력하면 JSON 파싱 실패 → "275.6%"로 래핑
  try {
    const fixedPct = s.replace(/:\s*([+-]?\d+\.?\d*)%/g, (_, n) => `: "${n}%"`);
    return JSON.parse(fixedPct);
  } catch { /* 계속 */ }
  // 시도 5: trailing comma + % 복합 수정
  try {
    const fixedBoth = s
      .replace(/:\s*([+-]?\d+\.?\d*)%/g, (_, n) => `: "${n}%"`)
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixedBoth);
  } catch { /* 계속 */ }
  // 시도 6: 단일 따옴표 → 이중 따옴표 변환 후 재시도
  try { return JSON.parse(s.replace(/'/g, '"')); } catch { /* 계속 */ }
  // 시도 7: 전체 복합 수정 (개행 이스케이프 + 따옴표 없는 % + trailing comma 동시 처리)
  //   위 시도들은 각 문제를 개별 처리 — 세 가지 동시 발생 시 이 시도가 유일하게 성공
  try {
    const fixedAll = s
      .replace(/"((?:[^"\\]|\\.)*)"/gs, (_m, inner) =>
        `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
      )
      .replace(/:\s*([+-]?\d+\.?\d*)%/g, (_, n) => `: "${n}%"`)
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixedAll);
  } catch { return null; }
}

function TldrCard({ analysis, isEn }: { analysis: any; isEn: boolean }) {
  const stratStep = analysis.steps?.find((s: any) => s.stepKey === "investment_strategy");
  const json = stratStep ? extractJson(stratStep.content) : null;
  const verdict = (analysis as any).investmentVerdict ?? json?.verdict;
  const tp = analysis.targetPrice ?? (json?.target_price ? parseFloat(String(json.target_price).replace(/[^0-9.]/g, "")) || null : null);
  const sp = (analysis as any).startPrice as number | null ?? null;
  const currency: "KRW" | "USD" = isUSTicker(analysis.ticker) ? "USD" : "KRW";

  if (!verdict && !tp) return null;

  const upsidePct = (sp && tp && sp > 0) ? ((tp - sp) / sp * 100) : null;
  const verdictLabel = isEn ? (verdict ?? "") : toKoreanVerdict(verdict);
  const isBuy = verdict?.toLowerCase().includes("buy");
  const isSell = verdict?.toLowerCase().includes("sell");

  const accentColor = isBuy
    ? "text-emerald-700 dark:text-emerald-400"
    : isSell
    ? "text-blue-700 dark:text-blue-400"
    : "text-amber-700 dark:text-amber-400";
  const accentBg = isBuy
    ? "bg-emerald-50 dark:bg-emerald-950/30"
    : isSell
    ? "bg-blue-50 dark:bg-blue-950/30"
    : "bg-amber-50 dark:bg-amber-950/30";
  const accentBorder = isBuy
    ? "border-emerald-200 dark:border-emerald-800/50"
    : isSell
    ? "border-blue-200 dark:border-blue-800/50"
    : "border-amber-200 dark:border-amber-800/50";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-[var(--radius)] overflow-hidden shadow-[var(--shadow-card)]"
    >
      <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
          {isEn ? "Investment Summary · TL;DR" : "투자 요약 · 한눈에 보기"}
        </span>
        <span className="text-[10px] text-muted-foreground/50 font-mono">AI Research</span>
      </div>
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row gap-4">
        <div className={`rounded-[var(--radius)] border ${accentBorder} ${accentBg} px-5 py-4 flex flex-col justify-center sm:min-w-[152px] sm:max-w-[188px]`}>
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
            {isEn ? "Verdict" : "투자의견"}
          </p>
          <p className={`text-[18px] font-bold leading-tight ${accentColor}`}>{verdictLabel}</p>
          {upsidePct !== null && (
            <p className={`text-[28px] font-black tabular-nums leading-none mt-1 ${upsidePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
              {upsidePct >= 0 ? "+" : ""}{upsidePct.toFixed(1)}%
            </p>
          )}
          {tp && (
            <p className="text-[11px] text-muted-foreground mt-2 font-mono">
              {isEn ? "Target" : "목표가"} {formatCurrency(tp, currency, isEn)}
            </p>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-3.5">
          {json?.plain_verdict && (
            <div>
              <p className="text-[10px] font-semibold text-foreground/40 uppercase tracking-widest mb-1">
                {isEn ? "In Plain Language" : "쉽게 말하면"}
              </p>
              <p className="text-[13px] font-medium text-foreground leading-relaxed">{json.plain_verdict}</p>
            </div>
          )}
          {json?.key_issue && (
            <div>
              <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-1">
                {isEn ? "Key Issue" : "핵심 이슈"}
              </p>
              <p className="text-[13.5px] font-medium text-foreground leading-relaxed">{json.key_issue}</p>
            </div>
          )}
          {json?.summary && (
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
                {isEn ? "Investment Thesis" : "투자 논거"}
              </p>
              <p className="text-[13px] text-foreground/75 leading-relaxed">{json.summary}</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ScenarioCompareCard({ analysis, isEn }: { analysis: any; isEn: boolean }) {
  const stratStep = analysis.steps?.find((s: any) => s.stepKey === "investment_strategy");
  const json = stratStep ? extractJson(stratStep.content) : null;
  if (!json?.scenarios?.length) return null;

  const currency: "KRW" | "USD" = isUSTicker(analysis.ticker) ? "USD" : "KRW";

  const caseConfig: Record<string, { label: string; sublabel: string; bg: string; border: string; color: string; barColor: string; numColor: string }> = {
    Bull: {
      label: "▲ Bull",
      sublabel: isEn ? "Upside Case" : "낙관 시나리오",
      bg: "bg-emerald-50 dark:bg-emerald-950/25",
      border: "border-emerald-200 dark:border-emerald-800/50",
      color: "text-emerald-700 dark:text-emerald-400",
      barColor: "bg-emerald-500",
      numColor: "text-emerald-600 dark:text-emerald-400",
    },
    Base: {
      label: "— Base",
      sublabel: isEn ? "Base Case" : "기본 시나리오",
      bg: "bg-blue-50 dark:bg-blue-950/25",
      border: "border-blue-200 dark:border-blue-800/50",
      color: "text-blue-700 dark:text-blue-400",
      barColor: "bg-blue-500",
      numColor: "text-blue-600 dark:text-blue-400",
    },
    Bear: {
      label: "▼ Bear",
      sublabel: isEn ? "Downside Case" : "비관 시나리오",
      bg: "bg-red-50 dark:bg-red-950/25",
      border: "border-red-200 dark:border-red-800/50",
      color: "text-red-600 dark:text-red-400",
      barColor: "bg-red-400",
      numColor: "text-red-500 dark:text-red-400",
    },
  };

  const ordered = (["Bull", "Base", "Bear"] as const)
    .map(c => json.scenarios.find((s: any) => s.case === c))
    .filter(Boolean);

  if (ordered.length < 2) return null;

  return (
    <div
      className="bg-card rounded-[var(--radius)] overflow-hidden shadow-[var(--shadow-card)]"
    >
      <div className="px-5 py-3 border-b border-border/50">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
          {isEn ? "Scenario Analysis — Bull / Base / Bear" : "시나리오 분석 — 낙관 · 기본 · 비관"}
        </span>
      </div>
      <div className="p-4 grid grid-cols-3 gap-2 sm:gap-3">
        {ordered.map((s: any) => {
          const cfg = caseConfig[s.case as keyof typeof caseConfig];
          if (!cfg) return null;
          const uStr = String(s.upside ?? "");
          const uNum = parseFloat(uStr.replace(/[^0-9.\-]/g, ""));
          const uDisplay = !isNaN(uNum) ? (uNum >= 0 ? "+" : "") + uNum.toFixed(1) + "%" : uStr;
          const pStr = String(s.probability ?? "");
          const pNum = parseFloat(pStr.replace(/[^0-9.]/g, ""));
          return (
            <div key={s.case} className={`rounded-[var(--radius)] border ${cfg.border} ${cfg.bg} p-3 sm:p-4`}>
              <p className={`text-[11px] font-bold ${cfg.color}`}>{cfg.label}</p>
              <p className="text-[10px] text-muted-foreground mb-2.5">{cfg.sublabel}</p>
              <p className={`text-[13px] sm:text-[15px] font-bold tabular-nums leading-tight break-all ${cfg.color}`}>
                {formatPrice(s.target_price, currency, isEn)}
              </p>
              <p className={`text-[12px] font-bold mt-0.5 ${cfg.numColor}`}>{uDisplay}</p>
              {!isNaN(pNum) && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">{isEn ? "Prob." : "확률"}</span>
                    <span className="text-[11px] font-bold text-foreground/80">{pNum}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted/70 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${cfg.barColor}`}
                      style={{ width: `${Math.min(pNum, 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {s.assumption && (
                <p className="mt-2.5 text-[11px] text-foreground/60 leading-snug line-clamp-3">{s.assumption}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepNavSidebar({ steps, isEn }: { steps: any[]; isEn: boolean }) {
  const [activeStep, setActiveStep] = useState<string>("");
  const doneSteps = new Set(steps.map((s: any) => s.stepKey));

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    for (const stepKey of ANALYSIS_STEPS_ORDER) {
      const el = document.getElementById(`step-${stepKey}`);
      if (!el) continue;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveStep(stepKey); },
        { threshold: 0.1, rootMargin: "-10% 0px -60% 0px" }
      );
      obs.observe(el);
      observers.push(obs);
    }
    return () => observers.forEach(o => o.disconnect());
  }, [steps.length]);

  const scrollToStep = (stepKey: string) => {
    const el = document.getElementById(`step-${stepKey}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="hidden xl:block w-40 shrink-0">
      <div className="sticky top-6 pt-1">
        <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-2 px-2">
          {isEn ? "Contents" : "목차"}
        </p>
        <div className="space-y-0.5">
          {ANALYSIS_STEPS_ORDER.map((stepKey, idx) => {
            const agent = AGENTS[stepKey];
            const isDone = doneSteps.has(stepKey);
            const isActive = activeStep === stepKey;
            return (
              <button
                key={stepKey}
                onClick={() => scrollToStep(stepKey)}
                disabled={!isDone}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all duration-150",
                  isDone
                    ? isActive
                      ? "bg-primary/8 text-primary"
                      : "text-foreground/55 hover:text-foreground hover:bg-muted/60"
                    : "text-muted-foreground/30 cursor-not-allowed"
                )}
              >
                <span className={cn(
                  "w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isDone
                    ? "bg-muted-foreground/15 text-muted-foreground"
                    : "bg-muted text-muted-foreground/40"
                )}>
                  {idx + 1}
                </span>
                <span className="text-[11.5px] font-medium leading-tight truncate">
                  {isEn ? (agent?.nameEn ?? agent?.name) : agent?.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function InvestmentStrategyCard({ step, agent, delay, ticker, companyName, createdAt, isEn = false, validatedTargetPrice, validatedVerdict }: { step: any, agent: AgentInfo, delay: number, ticker?: string, companyName?: string, createdAt?: string, isEn?: boolean, validatedTargetPrice?: number | null, validatedVerdict?: string | null }) {
  const json = extractJson(step.content);
  const priceCurrency: "KRW" | "USD" = isUSTicker(ticker) ? "USD" : "KRW";

  const verdictMeta = (v: string) => {
    if (!v) return { label: "—", color: "text-foreground", bg: "bg-muted", border: "border-border", dot: "#6b7280" };
    const s = v.toLowerCase();
    if (s.includes("strong buy"))  return { label: isEn ? "Strong Upside" : "높은 상승여력", color: "text-emerald-700 dark:text-emerald-400", bg: "dark:bg-emerald-950/40", border: "border-emerald-500 dark:border-emerald-800", dot: "#059669" };
    if (s.includes("buy"))         return { label: isEn ? "Upside" : "상승여력",             color: "text-green-700 dark:text-green-400",     bg: "dark:bg-green-950/40",   border: "border-green-500 dark:border-green-800",     dot: "#16a34a" };
    if (s.includes("strong sell")) return { label: isEn ? "Strong Downside" : "높은 하락여지", color: "text-blue-700 dark:text-blue-400",       bg: "dark:bg-blue-950/40",    border: "border-blue-500 dark:border-blue-800",       dot: "#2563eb" };
    if (s.includes("sell"))        return { label: isEn ? "Downside" : "하락여지",            color: "text-blue-600 dark:text-blue-400",       bg: "dark:bg-blue-950/40",    border: "border-blue-400 dark:border-blue-800",       dot: "#3b82f6" };
    return { label: isEn ? "Fair Value" : "적정 수준", color: "text-amber-700 dark:text-amber-400", bg: "dark:bg-amber-900/20", border: "border-amber-500 dark:border-amber-700", dot: "#d97706" };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-[var(--radius)] bg-card overflow-hidden shadow-[var(--shadow-card)]"
    >
      {/* ── 상단 헤더 ── */}
      <div className="px-4 sm:px-6 py-4 flex items-center justify-between gap-3 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-8 rounded-full bg-foreground shrink-0" />
          <div>
            <p className="font-semibold text-[16px] text-foreground leading-tight">{isEn ? "Final Investment Strategy" : "최종 투자 전략"}</p>
            <p className="text-[13px] text-muted-foreground">{agent.role}</p>
          </div>
        </div>
        {companyName && (
          <span className="text-[12px] text-muted-foreground hidden sm:block">{companyName}{ticker ? ` · ${ticker}` : ""}</span>
        )}
      </div>

      {/* markdown prose fallback (investment_strategy는 JSON 아닌 마크다운 산문) */}
      {!json && step.content && !step.content.startsWith("분석 오류:") && !step.content.startsWith("분석 결과를 생성하지 못했습니다") ? (
        <div className="p-4 sm:p-6">
          <MdBlock src={step.content} isEn={isEn} />
        </div>
      ) : json ? (() => {
        const vm = verdictMeta(validatedVerdict ?? json.verdict ?? "");
        return (
          <div className="divide-y divide-border">

            {/* ── ① 판정 + 메타 ── */}
            <div className="px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3">
              <span className={cn("text-[26px] font-display font-bold leading-none", vm.color)}>{vm.label}</span>
              <div className="flex flex-wrap gap-1.5">
                {json.confidence && (
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-muted text-foreground/70 border border-border">
                    {isEn ? "Confidence" : "신뢰도"} {json.confidence}
                  </span>
                )}
                {json.investment_period && (
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-muted text-foreground/70 border border-border">
                    {json.investment_period}
                  </span>
                )}
                {json.risk_reward && (
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-muted text-foreground/70 border border-border">
                    {isEn ? "R/R" : "손익비(R/R)"} {json.risk_reward}
                  </span>
                )}
                {json.action_timing && (() => {
                  const at = String(json.action_timing);
                  const isUrgent = at === "즉시" || at.toLowerCase() === "immediately";
                  const isMomentum = at.includes("정점") || at.toLowerCase().includes("momentum");
                  const isSupport = at.includes("이탈") || at.toLowerCase().includes("support");
                  const isSplit = at.includes("분할") || at.toLowerCase().includes("partial");
                  const pillStyle = isUrgent
                    ? "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700"
                    : isMomentum
                    ? "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700"
                    : isSupport
                    ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                    : isSplit
                    ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700"
                    : "bg-muted text-foreground/70 border-border";
                  return (
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${pillStyle}`}>
                      ⏱ {isEn ? "Timing" : "실행시점"}: {at}
                    </span>
                  );
                })()}
                {json.momentum_grade && json.momentum_grade !== "N" && (() => {
                  const g = String(json.momentum_grade);
                  const pct = json.momentum_premium_pct != null ? Number(json.momentum_premium_pct) : null;
                  const gradeStyle: Record<string, string> = {
                    S: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700",
                    A: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700",
                    B: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700",
                    D: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700",
                  };
                  const gradeLabel: Record<string, string> = {
                    S: isEn ? "Supercycle" : "슈퍼사이클",
                    A: isEn ? "Theme ↑" : "테마 상승",
                    B: isEn ? "Theme △" : "테마 간접",
                    D: isEn ? "Theme ↓" : "테마 소멸",
                  };
                  return (
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${gradeStyle[g] ?? "bg-muted text-foreground/70 border-border"}`}>
                      {isEn ? "Momentum" : "모멘텀"} {gradeLabel[g] ?? g}
                      {pct != null && pct !== 0 ? ` ${pct > 0 ? "+" : ""}${pct}%` : ""}
                    </span>
                  );
                })()}
              </div>
            </div>

            {/* ── ② 일반 투자자 한 줄 요약 (plain_verdict) ── */}
            {json.plain_verdict && (
              <div className="px-4 sm:px-6 py-4 border-b border-border bg-gradient-to-r from-foreground/[0.04] to-transparent">
                <p className="text-[10px] font-semibold text-foreground/40 uppercase tracking-widest mb-1.5">{isEn ? "In Plain Language" : "쉽게 말하면"}</p>
                <p className="text-[14px] text-foreground leading-relaxed font-medium">{json.plain_verdict}</p>
              </div>
            )}

            {/* ── ③ 핵심 이슈 ── */}
            {json.key_issue && (
              <div className="px-4 sm:px-6 py-4 bg-amber-50/60 dark:bg-amber-900/15">
                <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-1">{isEn ? "Key Issue" : "핵심 이슈"}</p>
                <p className="text-sm text-foreground/90 leading-relaxed font-medium">{json.key_issue}</p>
              </div>
            )}

            {/* ── ④ 투자 논거 요약 ── */}
            {json.summary && (
              <div className="px-4 sm:px-6 py-5 bg-muted/25 border-b border-border">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-2.5">
                  {isEn ? "Investment Thesis" : "투자 논거"}
                </p>
                <p className="text-[13.5px] text-foreground/88 leading-[1.95]">{json.summary}</p>
              </div>
            )}

            {/* ── ④ 가격 3박스 ── */}
            {(() => {
              // 현재가: json.current_price (신규) 또는 Base 시나리오 역산
              const cp = parseFloat(String(json.current_price ?? "").replace(/[^0-9.]/g, "")) || null;
              const ep = parseFloat(String(json.entry_price ?? "").replace(/[^0-9.]/g, "")) || null;
              // ⭐ validatedTargetPrice(서버 검증값)가 있으면 AI 원본값 대신 사용 — 상단 카드와 일치
              const tpRaw = parseFloat(String(json.target_price ?? "").replace(/[^0-9.]/g, "")) || null;
              const tp: number | null = validatedTargetPrice ?? tpRaw;
              const sl = parseFloat(String(json.stop_loss ?? "").replace(/[^0-9.]/g, "")) || null;

              // 적정주가 ↔ 현재가 기준 upside: Base 시나리오 upside 우선, 없으면 직접 계산
              const baseScenario = json.scenarios?.find((s: any) => s.case === "Base");
              const baseUpsideStr = String(baseScenario?.upside ?? "");
              // parseFloat은 "+15.2%" → 15.2, "-63.3%" → -63.3 자동 처리
              const baseUpsideNum = parseFloat(baseUpsideStr);
              const upsideFromCurrent: number | null =
                // validatedTargetPrice가 있으면 서버 검증 기준 upside 직접 계산
                (validatedTargetPrice && cp && cp > 0) ? (validatedTargetPrice - cp) / cp * 100
                : !isNaN(baseUpsideNum) ? baseUpsideNum
                : (cp && tp && cp > 0) ? (tp - cp) / cp * 100
                : null;

              const isBearish = upsideFromCurrent !== null && upsideFromCurrent < 0;
              const targetCardStyle = isBearish
                ? { border: "border-rose-300 dark:border-rose-700", bg: "bg-card", dotColor: "bg-rose-400", labelColor: "text-rose-500 dark:text-rose-400", valColor: "text-rose-600 dark:text-rose-400", pctColor: "text-rose-500 dark:text-rose-400" }
                : { border: "border-emerald-300 dark:border-emerald-700", bg: "bg-card", dotColor: "bg-emerald-500", labelColor: "text-emerald-600 dark:text-emerald-400", valColor: "text-emerald-700 dark:text-emerald-400", pctColor: "text-emerald-600 dark:text-emerald-400" };

              // 매도 시나리오 여부
              const verdictStr = String(json.verdict ?? "").toLowerCase();
              const isSell = verdictStr.includes("sell");

              // 진입가 vs 현재가 거리
              const entryVsCurrent = (cp && ep && cp > 0)
                ? ((ep - cp) / cp * 100).toFixed(1)
                : null;

              // 손절: 매수 시 진입가 기준 / 매도 시 현재가 기준
              const slPct = !isSell && ep && sl && ep > 0
                ? Math.abs((sl - ep) / ep * 100).toFixed(1)
                : cp && sl && cp > 0 && Math.abs((sl - cp) / cp * 100) > 0.1
                  ? Math.abs((sl - cp) / cp * 100).toFixed(1)
                  : null;

              // 레이블 — 매도 시 의미에 맞는 용어로
              const entryLabel = isSell ? (isEn ? "Re-entry Threshold" : "재관심 기준가") : (isEn ? "Entry Price" : "진입가");
              const stopLabel = isSell ? (isEn ? "Liquidation Zone" : "청산 우선 구간") : (isEn ? "Stop Loss" : "손절가");
              const entrySubLabel = isSell ? (isEn ? "Re-entry zone after sell" : "매도 후 재진입 고려 구간") : (isEn ? "Target entry price" : "진입 목표 가격");
              const stopSubLabel = isSell ? (isEn ? "Profit-taking zone" : "단계적 차익실현 구간") : (isEn ? "Stop loss level" : "손절 기준선");

              // [v] 밸류에이션 vs 단기 모멘텀 설명 배너
              const momentumDivBanner = isSell
                ? `📌 ${isEn ? "This rating reflects 12-month DCF/WACC valuation (not short-term price direction). Momentum may diverge from fundamentals." : "이 의견은 DCF·WACC 기반 12개월 장기 가치평가 판단입니다. 단기 가격 모멘텀은 밸류에이션과 반대 방향으로 움직일 수 있습니다."}`
                : null;

              const techTarget = parseFloat(String(json.technical_target ?? "").replace(/[^0-9.]/g, "")) || null;
              const techTargetUpside = (techTarget && cp && cp > 0) ? ((techTarget - cp) / cp * 100) : null;

              return (
                <div className="px-4 sm:px-6 py-4">
                  {/* 단기 기술적 이정표 — technical_target 있을 때만 표시 */}
                  {techTarget && (
                    <div className="mt-3 rounded-[var(--radius)] border border-orange-300/60 dark:border-orange-700/40 bg-orange-50/40 dark:bg-orange-950/20 px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                        <div>
                          <p className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-widest">
                            {isEn ? "Short-Term Technical Target" : "단기 기술적 이정표"}
                            <span className="ml-1.5 font-normal normal-case text-orange-500/70 dark:text-orange-400/60">
                              {isEn ? "(1–3M momentum, not fair value)" : "(1~3개월 모멘텀 기준 · 내재가치 아님)"}
                            </span>
                          </p>
                          <p className="text-[11px] text-orange-600/70 dark:text-orange-400/60 mt-0.5">
                            {isSell
                              ? (isEn ? "Possible resistance zone — consider profit-taking if momentum reaches this level" : "모멘텀이 이 가격대에 도달 시 차익실현 검토")
                              : (isEn ? "Momentum upside target if current trend continues" : "현 추세 지속 시 단기 상방 목표")}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[15px] sm:text-[18px] font-bold text-orange-700 dark:text-orange-300 font-mono leading-none">
                          {formatPrice(String(techTarget), priceCurrency, isEn)}
                        </p>
                        {techTargetUpside !== null && (
                          <p className={`text-[11px] font-bold mt-0.5 ${techTargetUpside >= 0 ? "text-orange-600 dark:text-orange-400" : "text-orange-500 dark:text-orange-300"}`}>
                            {techTargetUpside >= 0 ? "+" : ""}{techTargetUpside.toFixed(1)}%
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}


            {/* ── ⑤ 시나리오 카드 ── */}
            {json.scenarios?.length > 0 && (
              <div className="px-4 sm:px-6 py-4">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">{isEn ? "Scenario Analysis" : "시나리오 분석"}</p>
                <div className="space-y-2">
                  {json.scenarios.map((s: any, i: number) => {
                    const isBear = s.case === "Bear";
                    const isBull = s.case === "Bull";
                    const isBase = s.case === "Base";
                    const uStr = String(s.upside ?? "");
                    const uNum = parseFloat(uStr.replace(/[^0-9.\-]/g, ""));
                    const uDisplay = !isNaN(uNum) && !uStr.includes("%")
                      ? (uNum > 0 ? "+" : "") + uNum + "%"
                      : uStr;
                    const pStr = String(s.probability ?? "");
                    const pNum = parseFloat(pStr.replace(/[^0-9.]/g, ""));
                    return (
                      <div
                        key={i}
                        className={cn(
                          "rounded-[var(--radius)] border border-border bg-card p-3 sm:p-3.5 flex items-center gap-3 sm:gap-4 border-l-4",
                          isBear ? "border-l-red-400" : isBull ? "border-l-emerald-500" : "border-l-blue-500"
                        )}
                      >
                        {/* 시나리오 이름 */}
                        <div className="w-14 sm:w-20 shrink-0">
                          <span className={cn(
                            "text-xs font-bold",
                            isBear ? "text-red-500" : isBull ? "text-emerald-600" : "text-blue-600"
                          )}>
                            {isBear ? "▼ Bear" : isBull ? "▲ Bull" : "— Base"}
                          </span>
                          {isBase && <p className="text-[10px] text-muted-foreground mt-0.5">{isEn ? "Base Case" : "기본 전망"}</p>}
                          {isBull && <p className="text-[10px] text-muted-foreground mt-0.5">{isEn ? "Bull Case" : "낙관 전망"}</p>}
                          {isBear && <p className="text-[10px] text-muted-foreground mt-0.5">{isEn ? "Bear Case" : "비관 전망"}</p>}
                        </div>

                        {/* 적정주가 + 등락률 */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold font-mono text-foreground">
                            {formatPrice(s.target_price, priceCurrency, isEn)}
                          </p>
                          <p className={cn(
                            "text-xs font-semibold mt-0.5",
                            uNum > 0 ? "text-emerald-600" : uNum < 0 ? "text-red-500" : "text-muted-foreground"
                          )}>
                            {uDisplay}
                          </p>
                        </div>

                        {/* 확률 바 */}
                        <div className="w-16 sm:w-20 shrink-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] text-muted-foreground">{isEn ? "Prob." : "확률"}</span>
                            <span className="text-[11px] font-bold text-foreground/80">{!isNaN(pNum) ? pNum + "%" : pStr}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all",
                                isBear ? "bg-red-400" : isBull ? "bg-emerald-500" : "bg-blue-500"
                              )}
                              style={{ width: `${Math.min(isNaN(pNum) ? 0 : pNum, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── ⑥ 핵심 리스크 + 모니터링 ── */}
            {(json.risks?.length > 0 || json.monitoring_indicators?.length > 0) && (
              <div className="px-4 sm:px-6 py-4 grid sm:grid-cols-2 gap-5">
                {json.risks?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">{isEn ? "Key Risks" : "핵심 리스크"}</p>
                    <ul className="space-y-2">
                      {json.risks.map((r: string, i: number) => (
                        <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-foreground/70 leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {json.monitoring_indicators?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">{isEn ? "Monitoring Indicators" : "모니터링 지표"}</p>
                    <ul className="space-y-2">
                      {json.monitoring_indicators.map((m: string, i: number) => (
                        <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-muted-foreground leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-300 mt-1.5 shrink-0" />
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}


          </div>
        );
      })() : (() => {
        const isApiErr = step.content?.startsWith("분석 오류:") || step.content?.startsWith("분석 결과를 생성하지 못했습니다");
        return (
          <div className="p-6 text-sm text-foreground/60 leading-relaxed">
            {isApiErr ? (
              <>
                <p className="text-red-500 font-medium mb-2 text-[11px] font-bold uppercase tracking-widest">{isEn ? "AI Service Error" : "AI 서비스 연결 오류"}</p>
                <p>{isEn ? "Failed to connect to AI service. Please re-run the analysis." : "AI 서비스 연결 실패로 최종 전략을 생성하지 못했습니다. 분석을 다시 실행해 주세요."}</p>
              </>
            ) : (
              <>
                <p className="text-amber-600 font-medium mb-2 text-[11px] font-bold uppercase tracking-widest">{isEn ? "Error loading analysis" : "분석 결과 로드 중 오류"}</p>
                <p>{isEn ? "Failed to load strategy data. Please re-run the analysis." : "최종 투자 전략 데이터를 불러오지 못했습니다. 분석을 다시 실행해 주세요."}</p>
              </>
            )}
          </div>
        );
      })()}
    </motion.div>
  );
}

const SLOW_STEP_MESSAGES: Record<string, string[]> = {
  company_intro: [
    "사업보고서 1페이지부터 정독 중... CEO 자랑은 건너뜀 📄",
    "이 회사 뭐 하는 곳인지... 저도 궁금해요 🤔",
    "IR 자료 읽는 중이에요. 미래 장밋빛 전망은 반의반만 믿어요",
    "창업 스토리 발굴 중... 차고 창업이면 더 좋고요 😄",
    "기업 소개 완성! 회사는 실존합니다 🎉",
  ],
  industry_analysis: [
    "아무도 안 시킨 업계 지도 그리는 중이에요 🗺️",
    "경쟁사 분석 중... (쟤네는 모름 😅)",
    "TAM, SAM, SOM... 누가 좀 말려줘요 🧮",
    "포터의 5가지 힘... 교수님이 그리울 때가 있어요",
    "이 업계 드라마가 넷플릭스보다 재밌네요",
    "산업 구조 파악 완료! 복잡하긴 해요 🗂️",
  ],
  catalyst_analysis: [
    "주가 흔들 재료 사냥 중이에요. 포인터 개처럼요 🎯",
    "실적 콘콜 전문 정독 중... 대신 들어드려요 😤",
    "찐 재료 vs 뇌동 재료 구분 중이에요 🔍",
    "수정구슬 꺼냈는데 흐리네요 🔮",
    "이게 재료인지 그냥 분위기인지 판별 중이에요",
    "촉매 분석 완료! 각오하세요 ⚡",
  ],
  company_analysis: [
    "재무제표 3개년치 펼쳐놨어요. 제 주말이에요 📊",
    "매출 오르고 이익 내려가고... 고전 레퍼토리 🤔",
    "영업CF랑 순이익이 왜 다른지 추궁 중이에요",
    "실적 드라이버가 IR팀 말이 아닌 곳에 있어요",
    "부채가 꽤 있는데... 갚을 수 있는지 확인 중이에요 💸",
    "EPS·EBITDA 직접 계산... 계산기 탓 안 해요 ✏️",
    "데이터가 많아요. 커피 한 잔 더 드세요 ☕",
    "마지막 검토 중이에요! 거의 다 왔어요 🏁",
  ],
  investment_strategy: [
    "5개 보고서를 종합 중이에요. 거의 다 왔어요 🧠",
    "상승여력 계산... 이 주식이 데이트 상대 자격이 있는지 💘",
    "투자 논거 한 문장으로 우겨넣는 중이에요 ✍️",
    "리스크 vs 기회, 최종 라운드 ⚖️",
    "목표주가 확정 중... 두구두구두구 🥁",
    "보고서 퇴고 중이에요. 명작이라고 믿고 있어요 📝",
  ],
};

const SLOW_STEP_MESSAGES_EN: Record<string, string[]> = {
  company_intro: [
    "Pretending to read every page of the annual report 📄",
    "Googling 'what does this company actually do' (just kidding) 🤔",
    "Reading the CEO letter... skipping the motivational quotes",
    "Checking if the founding story is cooler than Steve Jobs' garage 😄",
    "Almost done — spoiler: the company exists!",
  ],
  industry_analysis: [
    "Drawing an industry map nobody asked for 🗺️",
    "Spying on competitors (legally, of course 😅)",
    "TAM, SAM, SOM... somebody stop me 🧮",
    "Porter's Five Forces: the revenge 🎬",
    "This industry has more drama than a Netflix series",
    "Industry structure unlocked — it's complicated!",
  ],
  catalyst_analysis: [
    "Hunting catalysts like a stock-market truffle pig 🎯",
    "Reading earnings transcripts so you don't have to 😤",
    "Separating real catalysts from Twitter hype 🔍",
    "Consulting the crystal ball... it's foggy 🔮",
    "Is this a catalyst or just vibes? Investigating.",
    "Catalyst report incoming — brace yourself!",
  ],
  company_analysis: [
    "Three years of financials: my weekend plans 📊",
    "Revenue up, margins down — classic 🤔",
    "Why is operating cash flow ignoring the income statement?",
    "Looking for the real earnings drivers (hint: it's not PR)",
    "Lots of debt. Checking if they can actually pay it back 💸",
    "Computing EPS and EBITDA by hand like it's 1987 ✏️",
    "So much data. So little time. Hang tight 🙏",
    "Final lap — finishing strong!",
  ],
  investment_strategy: [
    "Turning five reports into one — final stretch 🧠",
    "Upside math: does this stock deserve a date? 💘",
    "Fitting the whole thesis into one sentence ✍️",
    "Risk vs. reward: final round ⚖️",
    "Target price is being finalized — drumroll please 🥁",
    "Proofreading the masterpiece 📝",
  ],
};

const DEBATE_MESSAGES: Record<string, string[]> = {
  challenging: [
    "팀원들이 초안을 처음부터 다시 뜯고 있어요. 저자는 긴장 중 🔍",
    "\"이 가정, 진짜 맞아요?\" 팀원 눈빛이 심상치 않아요",
    "숨은 리스크 색출 중... 어디 숨어있는지 다 찾아낼 거예요 🔥",
    "가정 하나하나 다시 검증 중. 틀리면 바로 들킴 💡",
    "\"실제 투자자가 이걸 믿을까?\" 이 질문이 핵심이에요",
    "팀원들 의견 쏟아지는 중... 회의가 뜨겁네요 ⚡",
  ],
  checking: [
    "팀장이 보고서를 또 처음부터 읽고 있어요. 이미 세 번째예요 👀",
    "숫자 일일이 손으로 검산 중이에요. 계산기도 못 믿어요 🔢",
    "\"근거가 충분한가?\" — 이 질문에 자신 있어야 통과해요",
    "논리 흐름 빈틈 체크 중... 한 군데만 헛점 나와도 반려예요 🔍",
    "팀장 싸인 직전이에요... 숨 참아봐요!",
  ],
};

const DEBATE_MESSAGES_EN: Record<string, string[]> = {
  challenging: [
    "Entire team tearing apart the draft. The author is sweating 🔍",
    "\"Is this assumption actually correct?\" — nobody is smiling",
    "Hidden risks have nowhere to hide 🔥",
    "Every assumption gets grilled. No free passes 💡",
    "\"Would a real investor buy this thesis?\" — still deciding",
    "Hot takes flying around. This is good chaos ⚡",
  ],
  checking: [
    "Lead analyst reading the report for the third time today 👀",
    "Verifying every number by hand. Yes, every single one 🔢",
    "\"Is the evidence actually solid?\" — the bar is high",
    "Hunting for logical gaps like a grammar pedant 🔍",
    "One signature away from done... hold your breath!",
  ],
};

function RotatingDebateMessage({ phase, isEn = false }: { phase: "challenging" | "checking"; isEn?: boolean }) {
  const messages = (isEn ? DEBATE_MESSAGES_EN : DEBATE_MESSAGES)[phase];
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setIdx(prev => {
        if (prev >= messages.length - 1) {
          clearInterval(interval);
          return prev;
        }
        setVisible(false);
        setTimeout(() => setVisible(true), 350);
        return prev + 1;
      });
    }, 3500);
    return () => clearInterval(interval);
  }, [messages]);

  return (
    <p
      className="text-[12px] text-muted-foreground/70 text-center italic leading-relaxed break-keep w-full"
      style={{ transition: "opacity 0.35s ease", opacity: visible ? 1 : 0 }}
    >
      {messages[idx]}
    </p>
  );
}

function RotatingAnalysisMessage({ stepKey, isEn = false }: { stepKey: string; isEn?: boolean }) {
  const messages = (isEn ? SLOW_STEP_MESSAGES_EN : SLOW_STEP_MESSAGES)[stepKey];
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!messages || messages.length <= 1) return;
    const interval = setInterval(() => {
      setIdx(prev => {
        if (prev >= messages.length - 1) {
          clearInterval(interval);
          return prev;
        }
        setVisible(false);
        setTimeout(() => setVisible(true), 350);
        return prev + 1;
      });
    }, 3800);
    return () => clearInterval(interval);
  }, [messages]);

  if (!messages) return <p className="text-[12px] text-muted-foreground/70 text-center italic">{isEn ? "Analyzing..." : "분석 중..."}</p>;

  return (
    <p
      style={{ transition: "opacity 0.35s ease" }}
      className={cn(
        "text-[12px] text-muted-foreground/70 text-center italic leading-relaxed break-keep w-full",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      {messages[idx]}
    </p>
  );
}

const BRAND_BLUE = "#1d4ed8";
const BRAND_AMBER = "#d97706";

const AGENT_COLORS: Record<string, string> = {
  company_intro: BRAND_BLUE,
  industry_analysis: BRAND_BLUE,
  company_analysis: BRAND_BLUE,
  dart_report_analysis: "hsl(158, 60%, 35%)",
  catalyst_analysis: BRAND_AMBER,
  investment_strategy: BRAND_BLUE,
};

function StreamingCard({ stepKey, content, qcStatus, qcScore, qcFeedback, debateStatus, isEn = false }: {
  stepKey: string;
  content: string;
  qcStatus?: "checking" | "approved" | "revising" | "revised";
  qcScore?: number;
  qcFeedback?: string;
  debateStatus?: "challenging" | "synthesizing";
  isEn?: boolean;
}) {
  const agent = AGENTS[stepKey];
  const color = AGENT_COLORS[stepKey] ?? "hsl(218, 67%, 44%)";
  if (!agent) return null;

  const phase = (() => {
    if (debateStatus === "challenging") return "challenging";
    if (debateStatus === "synthesizing") return "synthesizing";
    if (qcStatus === "checking") return "checking";
    if (qcStatus === "revising") return "revising";
    if (qcStatus === "approved" || qcStatus === "revised") return "done";
    return "writing";
  })();

  const phaseConfig = {
    writing:      { icon: Loader2,      spin: true,  pulse: false, color: "text-muted-foreground",  label: isEn ? "Writing analysis report..." : "분석 리포트 작성 중..." },
    challenging:  { icon: Swords,       spin: false, pulse: true,  color: "text-violet-600",         label: isEn ? "Deep review in progress..." : "팀 전원 심층 재검토 중..." },
    synthesizing: { icon: RefreshCw,    spin: true,  pulse: false, color: "text-blue-600",           label: isEn ? "Revising based on review..." : "재검토 의견 반영하여 재작성 중..." },
    checking:     { icon: ShieldCheck,  spin: false, pulse: true,  color: "text-amber-600",          label: isEn ? "Lead Portfolio Strategist reviewing..." : "Lead Portfolio Strategist 검토 중..." },
    revising:     { icon: RefreshCw,    spin: true,  pulse: false, color: "text-amber-600",          label: isEn ? "Revising based on lead feedback..." : "팀장 피드백 반영 재작성 중..." },
    done:         { icon: CheckCircle2, spin: false, pulse: false, color: "text-emerald-600",        label: isEn ? "Review complete, saving..." : "검토 완료, 저장 중..." },
  } as const;

  const cfg = phaseConfig[phase];
  const PhaseIcon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.3 } }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card rounded-[var(--radius)] overflow-hidden shadow-[var(--shadow-card)]"
    >
      {/* 헤더 */}
      <div className="px-4 sm:px-6 py-4 flex items-center gap-3 border-b border-border/50">
        <div className="w-1 h-8 rounded-full shrink-0" style={{ background: color }} />
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-[16px] text-foreground leading-tight">{agent.role}</h4>
          <span className="text-[13px] text-muted-foreground">{isEn ? (agent.nameEn ?? agent.name) : agent.name}</span>
        </div>
        <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${color}15` }}>
          <agent.icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
      </div>

      {/* 로딩 바디 — 단계 상태만 표시, 페이즈 전환 시 크로스페이드 */}
      <div className="flex flex-col items-center justify-center py-8 px-5 min-h-[120px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            className="flex flex-col items-center w-full"
          >
            {/* 단계 상태 아이콘 + 라벨 */}
            <div className={cn("flex items-center gap-2.5 text-sm font-medium", cfg.color)}>
              <PhaseIcon
                className={cn("w-5 h-5 shrink-0", cfg.spin && "animate-spin", cfg.pulse && "animate-pulse")}
              />
              <span className="text-center">{cfg.label}</span>
            </div>
            {/* 단계별 설명 — writing 단계에서 agent description 표시 */}
            {phase === "writing" && (agent.descriptionEn || agent.description) && (
              <p className="mt-2 text-[11px] text-muted-foreground/80 text-center font-mono tracking-wide">
                {isEn ? (agent.descriptionEn ?? agent.description) : agent.description}
              </p>
            )}
            {/* 세부 메시지 — 고정 높이 영역으로 레이아웃 안정화 */}
            <div className="mt-3 min-h-[36px] flex items-center justify-center px-4 w-full">
              {phase === "writing" && <RotatingAnalysisMessage stepKey={stepKey} isEn={isEn} />}
              {phase === "challenging" && <RotatingDebateMessage phase="challenging" isEn={isEn} />}
              {phase === "checking" && <RotatingDebateMessage phase="checking" isEn={isEn} />}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function parsePriceScenario(content: string): import("@/components/StockChart").PriceScenario {
  // 단기 주가 방향 분석 섹션에서 선택된 경로를 감지
  // AI 프롬프트: "선택한 경로를 먼저 굵게 선언"
  const nums = ["①", "②", "③", "④"] as const;
  const pathTypeMap: Record<string, 1 | 2 | 3 | 4> = { "①": 1, "②": 2, "③": 3, "④": 4 };

  // 방법 1: 볼드 선언 **경로 ① ...** 패턴 (가장 신뢰성 높음)
  for (const n of nums) {
    if (new RegExp(`\\*\\*경로\\s*${n}`).test(content)) {
      return { pathType: pathTypeMap[n] };
    }
  }
  // 방법 2: "경로 N 시나리오가 가장 유력" 패턴
  for (const n of nums) {
    if (new RegExp(`경로\\s*${n}[^\\n]{0,30}(?:가장\\s*유력|가장\\s*높은|선택)`).test(content)) {
      return { pathType: pathTypeMap[n] };
    }
  }
  // 방법 3: 단기 방향 섹션 내 첫 번째 경로 언급
  const sectionMatch = content.match(/## 🔮 단기 주가 방향[\s\S]{0,300}/);
  if (sectionMatch) {
    for (const n of nums) {
      if (sectionMatch[0].includes(`경로 ${n}`)) {
        return { pathType: pathTypeMap[n] };
      }
    }
  }
  return { pathType: null };
}

function parseChartLevels(content: string): ChartLevels | null {
  const match = content.match(/CHART_DATA:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as ChartLevels;
    const clean: ChartLevels = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v > 0) (clean as any)[k] = v;
    }
    return Object.keys(clean).length > 0 ? clean : null;
  } catch { return null; }
}

export interface ChartEvent { date: string; label: string; type: "catalyst" | "risk" | "earnings" | "news" }

function parseChartEvents(content: string): ChartEvent[] {
  const match = content.match(/EVENTS_DATA:(\[[^\n]*\])/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]) as ChartEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(e => e.date && e.label && /^\d{4}-\d{2}$/.test(e.date)).slice(0, 6);
  } catch { return []; }
}

function stripChartData(content: string): string {
  return content
    .replace(/\n?---\n[\s\S]*?CHART_DATA:\{[^\n]+\}[\s\S]*$/, "")
    .replace(/\nCHART_DATA:\{[^\n]+\}\s*(\nEVENTS_DATA:\[[^\n]*\])?\s*(\nMARKET_SIGNALS_DATA:\{[^\n]+\})?\s*$/, "")
    .replace(/\nEVENTS_DATA:\[[^\n]*\]\s*(\nMARKET_SIGNALS_DATA:\{[^\n]+\})?\s*$/, "")
    .replace(/\nMARKET_SIGNALS_DATA:\{[^\n]+\}\s*$/, "")
    // 가격 구간 판정 섹션 숨김
    .replace(/\n##\s*🎯\s*가격 구간 판정[\s\S]*?(?=\n##\s|$)/, "")
    // 주가 흐름 & 급변 이슈 분석 섹션 숨김
    .replace(/\n##\s*📈\s*주가 흐름[^\n]*[\s\S]*?(?=\n##\s|$)/, "")
    .trim();
}

interface MarketSignals {
  trend: "bullish" | "bearish" | "neutral";
  position52w: number;
  signal: "continuing" | "peaking" | "reversing" | "wait" | "buy" | "sell";
  rrRatio: number;
}

function parseMarketSignals(content: string): MarketSignals | null {
  const match = content.match(/MARKET_SIGNALS_DATA:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const p = JSON.parse(match[1]) as Partial<MarketSignals>;
    if (!p.trend) return null;
    return {
      trend: p.trend ?? "neutral",
      position52w: typeof p.position52w === "number" ? Math.max(0, Math.min(100, p.position52w)) : 50,
      signal: p.signal ?? "wait",
      rrRatio: typeof p.rrRatio === "number" ? p.rrRatio : 0,
    };
  } catch { return null; }
}

function MarketSignalChips({ signals, isEn = false }: { signals: MarketSignals; isEn?: boolean }) {
  const trendMap = {
    bullish: { label: isEn ? "▲ Uptrend" : "▲ 상승 추세", cls: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60" },
    bearish: { label: isEn ? "▼ Downtrend" : "▼ 하락 추세", cls: "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/60" },
    neutral: { label: isEn ? "→ Sideways" : "→ 횡보 구간", cls: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60" },
  };
  const signalMap: Record<string, { label: string; cls: string }> = {
    continuing: { label: isEn ? "▲ Momentum On"  : "▲ 모멘텀 지속",   cls: "bg-emerald-500 text-white" },
    peaking:    { label: isEn ? "⚠ Near Peak"    : "⚠ 정점 근접",     cls: "bg-orange-500 text-white"  },
    reversing:  { label: isEn ? "▼ Reversing"    : "▼ 추세 전환 중",   cls: "bg-red-500 text-white"     },
    wait:       { label: isEn ? "Hold"            : "방향 불명확",      cls: "bg-amber-500 text-white"   },
    buy:        { label: isEn ? "Buy Signal"      : "매수 진입",        cls: "bg-emerald-500 text-white" },
    sell:       { label: isEn ? "Sell Signal"     : "매도 대응",        cls: "bg-red-500 text-white"     },
  };
  const tc = trendMap[signals.trend] ?? trendMap.neutral;
  const sc = signalMap[signals.signal] ?? signalMap.wait;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-border">
      <span className={cn("text-[11px] font-bold px-3 py-1.5 rounded-full", tc.cls)}>{tc.label}</span>
      <div className="flex items-center gap-1.5 bg-muted border border-border rounded-full px-3 py-1.5">
        <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">52W</span>
        <div className="w-14 h-1.5 bg-muted-foreground/20 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-foreground/60 transition-all" style={{ width: `${signals.position52w}%` }} />
        </div>
        <span className="text-[10px] font-mono font-bold text-foreground/80">{signals.position52w}%</span>
      </div>
      <span className={cn("text-[11px] font-bold px-3 py-1.5 rounded-full", sc.cls)}>{sc.label}</span>
      {signals.rrRatio > 0 && (
        <div className="flex items-center gap-1.5 bg-muted border border-border rounded-full px-3 py-1.5">
          <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">R/R</span>
          <span className="text-[11px] font-mono font-bold text-foreground">{signals.rrRatio.toFixed(1)} : 1</span>
        </div>
      )}
    </div>
  );
}

function TechnicalLevelLadder({ levels, startPrice, currency, isEn = false }: {
  levels: ChartLevels;
  startPrice?: number;
  currency: "KRW" | "USD";
  isEn?: boolean;
}) {
  const cp = (levels.currentPrice && levels.currentPrice > 0) ? levels.currentPrice : (startPrice && startPrice > 0 ? startPrice : 0);
  if (!cp) return null;

  const fmtP = (v: number) => currency === "USD"
    ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : isEn
      ? `KRW ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v)}`
      : `${v.toLocaleString("ko-KR")}원`;
  const fmtPct = (v: number) => {
    const p = ((v - cp) / cp * 100);
    return { str: (p >= 0 ? "+" : "") + p.toFixed(1) + "%", isUp: p >= 0 };
  };

  type LItem = {
    key: string; label: string; price: number; sub?: string;
    variant: "stop" | "entry" | "current" | "resistance" | "support" | "target1" | "target2";
  };
  const raw: (LItem | null)[] = [
    (levels.stopLoss && levels.stopLoss > 0) ? { key: "sl", label: isEn ? "Stop Loss" : "손절가", price: levels.stopLoss, variant: "stop" } : null,
    (levels.entryMin && levels.entryMax && levels.entryMin > 0)
      ? { key: "em", label: isEn ? "Entry Zone" : "진입 구간", price: levels.entryMin, sub: "~" + fmtP(levels.entryMax), variant: "entry" }
      : (levels.entryMin && levels.entryMin > 0) ? { key: "em", label: isEn ? "Entry Low" : "진입 하단", price: levels.entryMin, variant: "entry" } : null,
    { key: "cp", label: isEn ? "Current" : "현재가", price: cp, variant: "current" },
    (levels.resistance && levels.resistance > 0) ? { key: "res", label: isEn ? "Resistance" : "저항선", price: levels.resistance, variant: "resistance" } : null,
    (levels.target1 && levels.target1 > 0) ? { key: "t1", label: isEn ? "Target 1" : "1차 목표가", price: levels.target1, variant: "target1" } : null,
    (levels.target2 && levels.target2 > 0) ? { key: "t2", label: isEn ? "Target 2" : "2차 목표가", price: levels.target2, variant: "target2" } : null,
  ];
  const items = raw.filter((v): v is LItem => v !== null).sort((a, b) => a.price - b.price);
  if (items.length < 2) return null;

  const prices = items.map(i => i.price);
  const minP = Math.min(...prices) * 0.988;
  const maxP = Math.max(...prices) * 1.012;
  const toPos = (p: number) => Math.max(0, Math.min(100, ((p - minP) / (maxP - minP)) * 100));

  const styleMap: Record<string, { bg: string; border: string; label: string; price: string }> = {
    stop:       { bg: "bg-red-50 dark:bg-red-950/30",        border: "border-red-200 dark:border-red-800/60",         label: "text-red-500 dark:text-red-400",           price: "text-red-700 dark:text-red-300" },
    entry:      { bg: "bg-blue-50 dark:bg-blue-950/30",      border: "border-blue-300 dark:border-blue-700/60",       label: "text-blue-600 dark:text-blue-400",          price: "text-blue-700 dark:text-blue-300" },
    current:    { bg: "bg-foreground",                       border: "border-foreground",                              label: "text-background/60",                       price: "text-background" },
    resistance: { bg: "bg-orange-50 dark:bg-orange-950/20",  border: "border-orange-200 dark:border-orange-700/50",   label: "text-orange-600 dark:text-orange-400",      price: "text-orange-700 dark:text-orange-300" },
    support:    { bg: "bg-amber-50 dark:bg-amber-950/20",    border: "border-amber-200 dark:border-amber-700/50",     label: "text-amber-600 dark:text-amber-400",        price: "text-amber-700 dark:text-amber-300" },
    target1:    { bg: "bg-emerald-50 dark:bg-emerald-950/30",border: "border-emerald-200 dark:border-emerald-700/60", label: "text-emerald-600 dark:text-emerald-400",    price: "text-emerald-700 dark:text-emerald-300" },
    target2:    { bg: "bg-emerald-100 dark:bg-emerald-900/30",border: "border-emerald-300 dark:border-emerald-600",   label: "text-emerald-700 dark:text-emerald-300",   price: "text-emerald-800 dark:text-emerald-200" },
  };

  return (
    <div className="mb-5 pt-4 border-t border-border">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-3.5 rounded-full bg-indigo-500" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{isEn ? "Price Level Summary" : "가격 구간 요약"}</span>
        <span className="text-[10px] text-muted-foreground/50 font-mono hidden sm:inline">{isEn ? "Relative to current price" : "현재가 기준 상대 위치"}</span>
      </div>

      {/* Cards */}
      <div className="overflow-x-auto scrollbar-none -mx-1 pb-1">
        <div className="flex items-stretch gap-1.5 min-w-max px-1">
          {items.map((item) => {
            const st = styleMap[item.variant] ?? styleMap.support;
            const p = item.variant !== "current" ? fmtPct(item.price) : null;
            return (
              <div key={item.key}
                className={cn("rounded-[var(--radius)] border px-2.5 sm:px-3 py-2 min-w-[76px] flex flex-col items-center gap-0.5", st.bg, st.border)}>
                <span className={cn("text-[9px] font-semibold uppercase tracking-wide leading-tight text-center", st.label)}>{item.label}</span>
                <span className={cn("text-[11px] font-mono font-bold leading-tight", st.price)}>{fmtP(item.price)}</span>
                {item.sub && <span className={cn("text-[9px] font-mono leading-tight", st.label)}>{item.sub}</span>}
                {p && <span className={cn("text-[10px] font-bold leading-tight", p.isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400")}>{p.str}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface ValuationData {
  current: number;
  dcf_bear: number; dcf_base: number; dcf_bull: number;
  pe_bear: number;  pe_base: number;  pe_bull: number;
  ev_bear: number;  ev_base: number;  ev_bull: number;
}

function parseValuationData(content: string): ValuationData | null {
  const match = content.match(/VALUATION_DATA:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as ValuationData;
    if (!parsed.dcf_base) return null;
    return parsed;
  } catch { return null; }
}

function stripValuationData(content: string): string {
  return content.replace(/\nVALUATION_DATA:\{[^\n]+\}\s*$/, "").trim();
}

interface FinalValuationData {
  current: number;
  bear: number; base: number; bull: number;
  abs_model?: string;
  abs_bear: number; abs_base: number; abs_bull: number;
  rel_bear: number; rel_base: number; rel_bull: number;
}

function detectAbsModelFromContent(content: string): string {
  const hasRNPV = /rNPV/i.test(content);
  const hasSOTP = /SOTP/i.test(content);
  if (hasRNPV && hasSOTP) return "rNPV+SOTP";
  if (hasRNPV) return "rNPV";
  if (hasSOTP) return "SOTP";
  if (/P\/B[-\s]*ROE/i.test(content)) return "P/B-ROE";
  if (/\bNAV\b/.test(content)) return "NAV";
  if (/\bDDM\b/i.test(content)) return "DDM";
  if (/EV\/Sales/i.test(content)) return "EV/Sales";
  if (/\bAFFO\b/i.test(content)) return "AFFO";
  return "DCF";
}

function parseFinalValuationData(content: string): FinalValuationData | null {
  // 멀티라인 JSON 우선 시도 (서버 analysis.ts와 동일한 패턴)
  const mlMatch = content.match(/FINAL_VALUATION_DATA:\s*(\{[\s\S]*?\})/);
  const raw = mlMatch?.[1] ?? content.match(/FINAL_VALUATION_DATA:\s*(\{[^\n]+\})/)?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.replace(/[\r\n\t]/g, " ")) as FinalValuationData;
    if (!parsed.base) return null;
    return parsed;
  } catch { return null; }
}

function stripFinalValuationData(content: string): string {
  return content
    .replace(/\nFINAL_VALUATION_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/^FINAL_VALUATION_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/FINAL_VALUATION_DATA:\{[^}]+\}/g, "")
    .replace(/\nSEGMENT_FORECAST_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/^SEGMENT_FORECAST_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/SEGMENT_FORECAST_DATA:\{[^\n]+\}/g, "")
    .trim();
}

interface SegmentForecastEntry { name: string; rev26: number | null; rev27: number | null; op26: number | null; op27: number | null; }
interface SegmentForecastData { currency: string; segments: SegmentForecastEntry[]; }

function parseSegmentForecastData(content: string): SegmentForecastData | null {
  const match = content.match(/SEGMENT_FORECAST_DATA:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as SegmentForecastData;
    if (!parsed.segments?.length) return null;
    return parsed;
  } catch { return null; }
}

function fmtAmt(value: number | null, currency: string): string {
  if (value == null) return "-";
  if (currency === "KRW") {
    const v = value * 1e8;
    const tril = v / 1e12;
    if (Math.abs(tril) >= 1) return `${tril.toFixed(1)}조`;
    return `${Math.round(v / 1e8)}억`;
  }
  const v = value * 1e6;
  const bil = v / 1e9;
  if (Math.abs(bil) >= 1) return `$${bil.toFixed(1)}B`;
  return `$${Math.round(v / 1e6)}M`;
}

function fmtAmtRaw(value: number | null, currency: string): string {
  if (value == null) return "-";
  if (currency === "KRW") {
    const tril = value / 1e12;
    if (Math.abs(tril) >= 1) return `${tril.toFixed(1)}조`;
    return `${Math.round(value / 1e8)}억`;
  }
  const bil = value / 1e9;
  if (Math.abs(bil) >= 1) return `$${bil.toFixed(1)}B`;
  return `$${(value / 1e6).toFixed(0)}M`;
}

function ForwardEstimatesTable({ ticker, isEn = false }: { ticker: string; isEn?: boolean }) {
  const [data, setData] = useState<{ annual: any[]; currency: string } | null>(null);
  useEffect(() => {
    fetch(getApiUrl(`/api/market-data/financials/${ticker}`))
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setData(d))
      .catch(() => {});
  }, [ticker]);

  if (!data) return null;
  const estimates = data.annual.filter((e: any) => e.isEstimate && e.revenue != null);
  if (estimates.length === 0) return null;
  const historicals = data.annual.filter((e: any) => !e.isEstimate && e.revenue != null);

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1 h-3.5 rounded-full bg-amber-400" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{isEn ? "Earnings Forecast" : "실적 전망"}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700">{isEn ? "Analyst Consensus" : "애널리스트 컨센서스"}</span>
      </div>
      <div className="rounded-[var(--radius)] border border-border overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[340px] text-xs border-collapse">
          <thead>
            <tr className="bg-muted">
              <th className="px-3 py-2 text-left font-semibold text-foreground/80 border-b border-border">{isEn ? "Year" : "연도"}</th>
              <th className="px-3 py-2 text-right font-semibold text-indigo-500 border-b border-border">{isEn ? "Revenue" : "매출"}</th>
              <th className="px-3 py-2 text-right font-semibold text-foreground/70 border-b border-border">YoY</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-600 border-b border-border">{isEn ? "Op. Income" : "영업이익"}</th>
              <th className="px-3 py-2 text-right font-semibold text-foreground/70 border-b border-border">OPM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {estimates.map((e: any, i: number) => {
              const prevArr = i === 0 ? historicals : estimates.slice(0, i);
              const prev = prevArr[prevArr.length - 1];
              const yoy = prev?.revenue && e.revenue ? ((e.revenue - prev.revenue) / prev.revenue * 100) : null;
              return (
                <tr key={e.period} className="hover:bg-muted/10 transition-colors">
                  <td className="px-3 py-2 font-semibold text-amber-500">{e.period.slice(0, 4)}E</td>
                  <td className="px-3 py-2 text-right font-mono text-indigo-500">{fmtAmtRaw(e.revenue, data.currency)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {yoy != null ? (
                      <span className={yoy >= 0 ? "text-emerald-500" : "text-rose-500"}>{yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%</span>
                    ) : <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-600">{e.operatingIncome != null ? fmtAmtRaw(e.operatingIncome, data.currency) : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">{e.operatingMargin != null ? `${e.operatingMargin.toFixed(1)}%` : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SegmentForecastTable({ data, isEn = false }: { data: SegmentForecastData; isEn?: boolean }) {
  const has27 = data.segments.some(s => s.rev27 != null || s.op27 != null);
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1 h-3.5 rounded-full bg-violet-400" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{isEn ? "Segment Forecast" : "사업부별 실적 전망"}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-700">{isEn ? "AI Estimate" : "AI 추정"}</span>
      </div>
      <div className="rounded-[var(--radius)] border border-border overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[380px] text-xs border-collapse">
          <thead>
            <tr className="bg-muted">
              <th className="px-3 py-2 text-left font-semibold text-foreground/80 border-b border-border">{isEn ? "Segment" : "사업부"}</th>
              <th className="px-3 py-2 text-right font-semibold text-indigo-500 border-b border-border">{isEn ? "Rev(26E)" : "매출(26E)"}</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-600 border-b border-border">{isEn ? "Op.(26E)" : "영업익(26E)"}</th>
              {has27 && <th className="px-3 py-2 text-right font-semibold text-indigo-400 border-b border-border">{isEn ? "Rev(27E)" : "매출(27E)"}</th>}
              {has27 && <th className="px-3 py-2 text-right font-semibold text-emerald-500 border-b border-border">{isEn ? "Op.(27E)" : "영업익(27E)"}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.segments.map(s => (
              <tr key={s.name} className="hover:bg-muted/10 transition-colors">
                <td className="px-3 py-2 font-medium text-foreground/80">{s.name}</td>
                <td className="px-3 py-2 text-right font-mono text-indigo-500">{fmtAmt(s.rev26, data.currency)}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-600">{fmtAmt(s.op26, data.currency)}</td>
                {has27 && <td className="px-3 py-2 text-right font-mono text-indigo-400">{fmtAmt(s.rev27, data.currency)}</td>}
                {has27 && <td className="px-3 py-2 text-right font-mono text-emerald-500">{fmtAmt(s.op27, data.currency)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function stripEstimationLabels(content: string): string {
  return content
    .replace(/\s*\(추정\)/g, "")
    .replace(/\s*\(추정치\)/g, "")
    .replace(/\s*\(E\)/g, "")
    .replace(/\s*\(F\)/g, "")
    .replace(/\s*\(컨센서스\)/g, "");
}

function stripPromptInstructions(content: string): string {
  // ── 섹션 단위 제거 (line 필터 전에 먼저 적용) ────────────────────────
  let cleaned = content
    .replace(/\n?---\n+##\s*📊\s*\[CHAIN-HANDOFF\][^\n]*\n[\s\S]*$/m, "")
    .replace(/\n?##\s*📊\s*\[CHAIN-HANDOFF\][^\n]*\n[\s\S]*$/m, "")
    .replace(/\[CHAIN-HANDOFF\][^\n]*/g, "")
    .replace(/\n{3,}/g, "\n\n");

  return cleaned
    .split("\n")
    .filter(line => {
      const t = line.trim();

      // ── 내부 STEP 레이블 ──────────────────────────────────────────
      if (/^\*?\*?\[STEP\s*\d+\]/.test(t)) return false;
      if (/\[STEP\s*[A-Z]\]/.test(t)) return false;
      if (/\[내부\s*계산/.test(t)) return false;

      // ── 지시사항 종료 마커 ────────────────────────────────────────
      if (/^※\s*(다음\s*지시사항|지시사항\s*끝)/.test(t)) return false;

      // ── upside 계산 내부 선언 ─────────────────────────────────────
      if (/^현재 종목의 Base upside:.*따라서.*전략을 작성합니다/.test(t)) return false;

      // ── 체인 인계 선언 문장 ───────────────────────────────────────
      if (/브리핑에서 확인된 핵심 이슈 .+을 중심으로/.test(t)) return false;
      if (/산업 分析에서 .+이 확인되었습니다\. 이를 배경으로/.test(t)) return false;
      if (/촉매 분석에서 도출된 핵심 이슈 .+의 재무 영향을 기반으로 실적을 전망합니다/.test(t)) return false;
      if (/^📌\s*\*?\*?\[체인 인계 규칙\]/.test(t)) return false;
      if (/^→\s*이 문장으로 리포트가 시작/.test(t)) return false;
      if (/^→\s*이 한 문장을 모든 소제목/.test(t)) return false;
      if (/체인\s*인계/.test(t)) return false;

      // ── 리서치 진행 순서 안내 문장 ───────────────────────────────
      if (/본 리서치는.*(실적 전망|적정주가|기술적|최종 결론).*순으로 진행됩니다/.test(t)) return false;

      // ── 단계 범위 선언 ────────────────────────────────────────────
      if (/이 단계의 담당 범위/.test(t)) return false;
      if (/이 범위 밖 내용은 타 단계에서/.test(t)) return false;
      if (/다른 단계 전담/.test(t)) return false;
      if (/다음 분석 단계/.test(t)) return false;
      if (/다음 에이전트에게/.test(t)) return false;

      // ── 검증 결과 문구 ────────────────────────────────────────────
      if (/논리 일관성 확인됨|논리 충돌 해소됨|검증 완료/.test(t)) return false;

      // ── 상투어 마감 ───────────────────────────────────────────────
      if (/이상으로 분석을 마칩니다|이로써 보고서를 마칩니다|이상으로 마칩니다/.test(t)) return false;

      // ── 지시 잔재 (instruction leakage) ──────────────────────────
      if (/^⚠️.*(선정 기준|자가 검증|담당 범위)/.test(t)) return false;
      if (/^✅\s*올바른 이슈:/.test(t)) return false;
      if (/^❌\s*제외 대상:/.test(t)) return false;
      if (/절대 표\(table\) 사용 금지/.test(t)) return false;
      if (/소제목은 이모지 \+ 제목만 사용하세요/.test(t)) return false;
      if (/단락과 단락 사이에 반드시 빈 줄/.test(t)) return false;
      if (/아래 구조 그대로 불릿으로 작성하세요/.test(t)) return false;

      // ── 미채워진 템플릿 플레이스홀더 ──────────────────────────────
      if (/^\- \[요인 이름\]:/.test(t)) return false;
      if (/^\- \[취약점 이름\]:/.test(t)) return false;
      if (/\(해당하면\)$/.test(t)) return false;

      return true;
    })
    .join("\n");
}

// ── 인터랙티브 DCF ────────────────────────────────────────────────────────────

function parseDCFDefaults(content: string, dcfBase: number): {
  wacc: number; shortG: number; termG: number; fcfPs: number;
} {
  const waccRaw   = parseFloat(content.match(/WACC[^0-9]*([\d.]+)\s*%/i)?.[1] ?? "NaN");
  const shortGRaw = parseFloat(
    content.match(/단기\s*성장률[^0-9]*([\d.]+)\s*%/i)?.[1]
    ?? content.match(/FCF\s*성장률[^0-9]*([\d.]+)\s*%/i)?.[1]
    ?? content.match(/성장률[^0-9]*([\d.]+)\s*%/i)?.[1]
    ?? "NaN"
  );
  const termGRaw  = parseFloat(
    content.match(/영구\s*성장률[^0-9]*([\d.]+)\s*%/i)?.[1]
    ?? content.match(/terminal.*?growth[^0-9]*([\d.]+)\s*%/i)?.[1]
    ?? "NaN"
  );

  const wacc   = isNaN(waccRaw)   ? 10   : Math.min(Math.max(waccRaw,   5),  30);
  const shortG = isNaN(shortGRaw) ? 15   : Math.min(Math.max(shortGRaw, -5), 80);
  const termG  = isNaN(termGRaw)  ? 2.5  : Math.min(Math.max(termGRaw,  0),   5);

  // dcfBase = FCF_ps × multiplier  →  FCF_ps = dcfBase / multiplier
  const r = wacc / 100, g = shortG / 100, tg = termG / 100;
  let mult = 0;
  for (let y = 1; y <= 5; y++) mult += Math.pow(1 + g, y) / Math.pow(1 + r, y);
  if (r > tg) mult += Math.pow(1 + g, 5) * (1 + tg) / ((r - tg) * Math.pow(1 + r, 5));
  const fcfPs = mult > 0.1 ? dcfBase / mult : dcfBase * 0.08;

  return { wacc, shortG, termG, fcfPs: Math.max(fcfPs, 0.01) };
}

function InteractiveDCFPanel({
  defaults, currentPrice, currency, isEn, color,
}: {
  defaults: ReturnType<typeof parseDCFDefaults>;
  currentPrice: number;
  currency: string;
  isEn: boolean;
  color: string;
}) {
  const [wacc,   setWacc]   = useState(defaults.wacc);
  const [shortG, setShortG] = useState(defaults.shortG);
  const [termG,  setTermG]  = useState(defaults.termG);
  const [fcfPs,  setFcfPs]  = useState(defaults.fcfPs);
  const [open,   setOpen]   = useState(false);

  const { chartData, fairValue } = useMemo(() => {
    const r = wacc / 100, g = shortG / 100, tg = termG / 100;
    let pvSum = 0;
    const rows = Array.from({ length: 5 }, (_, i) => {
      const y = i + 1;
      const nominal    = fcfPs * Math.pow(1 + g, y);
      const discounted = nominal / Math.pow(1 + r, y);
      pvSum += discounted;
      return {
        year: isEn ? `Yr ${y}` : `${y}년차`,
        [isEn ? "Future (Nominal)" : "미래 가치 (명목)"]: parseFloat(nominal.toFixed(2)),
        [isEn ? "PV (Discounted)"  : "현재 가치 (할인)"]: parseFloat(discounted.toFixed(2)),
      };
    });
    if (r > tg) pvSum += fcfPs * Math.pow(1 + g, 5) * (1 + tg) / ((r - tg) * Math.pow(1 + r, 5));
    return { chartData: rows, fairValue: pvSum };
  }, [wacc, shortG, termG, fcfPs, isEn]);

  const upside = currentPrice > 0 ? ((fairValue - currentPrice) / currentPrice * 100) : 0;
  const isUp   = upside >= 0;

  const nomKey = isEn ? "Future (Nominal)" : "미래 가치 (명목)";
  const pvKey  = isEn ? "PV (Discounted)"  : "현재 가치 (할인)";

  // 슬라이더 범위: fcfPs 기준 동적 계산
  const fcfMin  = Math.max(defaults.fcfPs * 0.1, 0.01);
  const fcfMax  = defaults.fcfPs * 6;
  const fcfStep = (fcfMax - fcfMin) / 200;

  function fmt(v: number) {
    if (currency === "KRW") {
      if (v >= 10000) return `${(v / 10000).toFixed(1)}만`;
      return v.toFixed(0);
    }
    return v.toFixed(2);
  }
  function fmtFair(v: number) {
    if (currency === "KRW") {
      if (v >= 10000) return `₩${Math.round(v / 100) * 100}`;
      return `₩${Math.round(v)}`;
    }
    return `$${v.toFixed(2)}`;
  }

  return (
    <div className="mt-4 pt-4 border-t border-border">
      {/* 헤더 토글 버튼 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius)] bg-muted/50 hover:bg-muted/80 transition-colors text-left"
      >
        <BarChart2 className="w-3.5 h-3.5 shrink-0" style={{ color }} />
        <span className="text-[12px] font-semibold text-muted-foreground flex-1">
          {isEn ? "Interactive DCF Model" : "인터랙티브 DCF 모델"}
        </span>
        {/* 현재 계산 결과 미리보기 */}
        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md shrink-0"
          style={{ background: `${color}20`, color }}>
          {fmtFair(fairValue)}
        </span>
        <span className={cn("text-[11px] font-bold shrink-0",
          isUp ? "text-emerald-600" : "text-rose-500")}>
          {isUp ? "+" : ""}{upside.toFixed(1)}%
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0",
          open ? "rotate-180" : "")} />
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {/* 슬라이더 패널 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 px-1">
            {([
              { label: isEn ? "FCF per Share" : "주당 FCF", value: fcfPs, set: setFcfPs,
                min: fcfMin, max: fcfMax, step: fcfStep, fmt: (v: number) => fmt(v), unit: currency === "KRW" ? "원" : "$" },
              { label: isEn ? "Short-term Growth (1–5yr %)" : "예상 성장률 (1-5년차 %)",
                value: shortG, set: setShortG, min: -5, max: 80, step: 0.5, fmt: (v: number) => `${v.toFixed(1)}%`, unit: "" },
              { label: isEn ? "Terminal Growth (%)" : "영구 성장률 (%)",
                value: termG, set: setTermG, min: 0, max: 5, step: 0.1, fmt: (v: number) => `${v.toFixed(1)}%`, unit: "" },
              { label: isEn ? "Discount Rate / WACC (%)" : "할인율 (WACC %)",
                value: wacc, set: setWacc, min: 5, max: 30, step: 0.5, fmt: (v: number) => `${v.toFixed(1)}%`, unit: "" },
            ] as const).map(({ label, value, set, min, max, step, fmt: f }) => (
              <div key={label}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[13px] text-muted-foreground">{label}</span>
                  <span className="text-[12px] font-mono font-bold text-foreground">{f(value)}</span>
                </div>
                <input
                  type="range" min={min} max={max} step={step} value={value}
                  onChange={e => (set as (v: number) => void)(parseFloat(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: color }}
                />
              </div>
            ))}
          </div>

          {/* 막대 차트 */}
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="year" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => fmt(v)} width={44} />
                <Tooltip
                  formatter={(v: number, name: string) => [fmtFair(v), name]}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--border)" }}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey={nomKey}  fill="#166534" radius={[3,3,0,0]} />
                <Bar dataKey={pvKey}   fill="#1d4ed8" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 결과 요약 */}
          <div className="flex flex-wrap gap-2 px-1 pb-1">
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
              <span className="text-[13px] text-muted-foreground">
                {isEn ? "DCF Fair Value" : "DCF 적정주가"}
              </span>
              <span className="text-[14px] font-mono font-bold text-foreground">{fmtFair(fairValue)}</span>
            </div>
            <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2",
              isUp ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-rose-50 dark:bg-rose-900/20")}>
              <TrendingUp className={cn("w-3.5 h-3.5", isUp ? "text-emerald-600" : "text-rose-600 rotate-180")} />
              <span className={cn("text-[11px]", isUp ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
                {isEn ? "vs. Current" : "현재가 대비"}
              </span>
              <span className={cn("text-[13px] font-mono font-bold",
                isUp ? "text-emerald-600" : "text-rose-500")}>
                {isUp ? "+" : ""}{upside.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 ml-auto">
              <span className="text-[10px] text-muted-foreground/70">
                {isEn ? "5yr DCF + Terminal" : "5년 DCF + 영구가치"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ValuationScaleBar: 방법론별 Bear/Base/Bull 범위를 공통 스케일로 시각화 ──────
function ValuationScaleBar({
  label, bear, base, bull, current, globalMin, globalMax, currency, isEn,
}: {
  label: string; bear: number; base: number; bull: number;
  current: number; globalMin: number; globalMax: number; currency: "KRW" | "USD"; isEn?: boolean;
}) {
  const span = globalMax - globalMin || 1;
  const toP = (v: number) => Math.max(0, Math.min(100, ((v - globalMin) / span) * 100));
  const bearP = toP(bear); const baseP = toP(base); const bullP = toP(bull); const curP = toP(current);
  const isUp = base >= current;
  const upside = current > 0 ? ((base - current) / current * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
      <span className="text-[11px] font-medium text-muted-foreground w-20 shrink-0 leading-tight">{label}</span>
      <div className="flex-1 relative h-7 min-w-0">
        {/* track */}
        <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-1 bg-border/60 rounded-full" />
        {/* fill bear→bull */}
        <div className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full opacity-25"
          style={{ left: `${bearP}%`, right: `${100 - bullP}%`, background: isUp ? "#10b981" : "#ef4444" }} />
        {/* bear dot */}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-rose-400 ring-2 ring-background"
          style={{ left: `${bearP}%` }} />
        {/* bull dot */}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-blue-400 ring-2 ring-background"
          style={{ left: `${bullP}%` }} />
        {/* base dot — larger */}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full shadow ring-2 ring-background z-10"
          style={{ left: `${baseP}%`, background: isUp ? "#10b981" : "#ef4444" }} />
        {/* current price line */}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-6 bg-foreground/50 z-20 rounded-full"
          style={{ left: `${curP}%` }} />
      </div>
      <div className="w-32 shrink-0 text-right flex items-baseline justify-end gap-1.5">
        <span className="text-[11px] font-mono font-semibold text-foreground">{formatPrice(base, currency, isEn)}</span>
        <span className={cn("text-[10px] font-mono font-bold", isUp ? "text-emerald-500" : "text-rose-500")}>
          {isUp ? "+" : ""}{upside.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function getReactNodeText(node: React.ReactNode): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getReactNodeText).join('');
  if (isValidElement(node)) return getReactNodeText((node.props as any).children);
  return '';
}

function CollapsibleBlockquote({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const childArray = Children.toArray(children);
  const firstChildText = getReactNodeText(childArray[0]);
  const isCollapsible = firstChildText.includes('핵심 지표') || firstChildText.includes('Key Metrics');

  if (!isCollapsible) {
    return (
      <blockquote className="my-3 pl-3 border-l-2 border-border text-foreground/75 text-[14px] italic">
        {children}
      </blockquote>
    );
  }

  const title = firstChildText.replace(/\(.*?\)/g, '').trim();
  const restChildren = childArray.slice(1);

  return (
    <div className="my-3 rounded-lg border border-border/50 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-muted/20 hover:bg-muted/35 transition-colors text-left"
      >
        <span className="text-[12px] font-semibold text-muted-foreground">{title}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-3 py-2.5 text-[12.5px] text-foreground/65 space-y-1 border-t border-border/40">
          {restChildren}
        </div>
      )}
    </div>
  );
}

const BLUR_GATED_STEPS = ["company_analysis", "dart_report_analysis", "investment_strategy"];

const MD_BODY_COMPONENTS = {
  // h2 — 섹션 소제목: 이모지 제거 후 소형 레이블 스타일로 통일
  h2: ({ children }: any) => {
    const text = typeof children === "string"
      ? children
      : Array.isArray(children) ? children.map((c: any) => typeof c === "string" ? c : "").join("") : String(children ?? "");
    // 앞쪽 이모지 제거
    const clean = text.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, "").trim();
    return (
      <div className="flex items-center gap-2 mt-7 mb-3 first:mt-0">
        <span className="h-px flex-1 bg-border/50" />
        <h2 className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground/60 shrink-0">
          {clean || text}
        </h2>
        <span className="h-px flex-1 bg-border/50" />
      </div>
    );
  },
  // h3 — 소단원: 본문보다 살짝 강조, 왼쪽 액센트 라인
  h3: ({ children }: any) => {
    const text = typeof children === "string"
      ? children
      : Array.isArray(children) ? children.map((c: any) => typeof c === "string" ? c : "").join("") : String(children ?? "");
    const clean = text.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, "").trim();
    return (
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground/80 mt-5 mb-2">
        <span className="w-[2px] h-3.5 rounded-full bg-muted-foreground/30 shrink-0" />
        {clean || text}
      </h3>
    );
  },
  h4: ({ children }: any) => (
    <h4 className="text-[15px] font-medium text-foreground/85 mt-3 mb-1.5">{children}</h4>
  ),
  p: ({ children }: any) => {
    const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
    if (text.startsWith("출처:") || text.startsWith("출처 :")) {
      return <p className="mt-5 pt-3 border-t border-border/40 text-[12px] text-muted-foreground">{children}</p>;
    }
    return <p className="mb-4 last:mb-0 text-foreground/90 leading-[1.95] text-[15px]">{children}</p>;
  },
  ul: ({ children }: any) => <ul className="my-3 pl-0 space-y-2 list-none">{children}</ul>,
  ol: ({ children }: any) => <ol className="my-3 pl-4 space-y-1.5 list-decimal">{children}</ol>,
  li: ({ children }: any) => (
    <li className="flex items-start gap-2.5 text-[15px] leading-[1.9] text-foreground/90">
      <span className="shrink-0 w-1 h-1 rounded-full bg-muted-foreground/50 mt-[0.75em]" />
      <span className="flex-1 min-w-0">{children}</span>
    </li>
  ),
  strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }: any) => <em className="text-foreground/65 not-italic">{children}</em>,
  blockquote: ({ children }: any) => <CollapsibleBlockquote>{children}</CollapsibleBlockquote>,
  hr: () => <hr className="my-5 border-border/40" />,
  ...MD_TABLE_COMPONENTS,
};

function MdBlock({ src, isEn }: { src: string; isEn: boolean }) {
  if (!src.trim()) return null;
  return (
    <div className="markdown-body prose-narrative">
      <RoadmapEnContext.Provider value={isEn}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_BODY_COMPONENTS}>{prepareMarkdown(src, isEn)}</ReactMarkdown>
      </RoadmapEnContext.Provider>
    </div>
  );
}

function BlurGateCard({ agent, color, delay, isEn }: { agent: AgentInfo; color: string; delay: number; isEn: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card rounded-[var(--radius)] overflow-hidden shadow-[var(--shadow-card)]"
    >
      <div className="px-4 sm:px-6 py-4 flex items-center gap-3 border-b border-border/50">
        <div className="w-1 h-8 rounded-full shrink-0" style={{ background: color }} />
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-[16px] text-foreground leading-tight">{agent.role}</h4>
          <span className="text-[13px] text-muted-foreground">{isEn ? (agent.nameEn ?? agent.name) : agent.name}</span>
        </div>
        <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${color}15` }}>
          <agent.icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
      </div>
      <div className="relative px-5 py-5 overflow-hidden">
        <div className="blur-sm pointer-events-none select-none space-y-2.5 opacity-50">
          {[85, 62, 78, 45, 90, 55, 0, 70, 88, 40].map((w, i) =>
            w === 0
              ? <div key={i} className="h-4" />
              : <div key={i} className="h-3 rounded-full bg-muted-foreground/30" style={{ width: `${w}%` }} />
          )}
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/70 backdrop-blur-[2px]">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${color}18` }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <p className="text-[13px] font-semibold text-foreground text-center px-4">
            {isEn ? "Sign in to unlock this section" : "로그인하면 전체 내용을 볼 수 있습니다"}
          </p>
          <a
            href="/login"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: color }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            {isEn ? "Sign In" : "로그인"}
          </a>
        </div>
      </div>
    </motion.div>
  );
}

// ── DART 사업보고서 재무 차트 컴포넌트 ──────────────────────────────────────
const FMT_EO = (v: number | null, isEn: boolean) => {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (isEn) {
    if (abs >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    return `$${(v / 1e6).toFixed(0)}M`;
  }
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  if (abs >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
  return v.toLocaleString("ko-KR");
};

function DartFinancialCharts({ ticker, isEn, color }: { ticker: string; isEn: boolean; color: string }) {
  const [data, setData] = useState<{ annual: any[]; quarterly: any[] } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(false);
    fetch(getApiUrl(`/api/market-data/financials/${encodeURIComponent(ticker)}`))
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j) setData({ annual: j.annual ?? [], quarterly: j.quarterly ?? [] }); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (err || !data || (data.annual.length === 0 && data.quarterly.length === 0)) return null;

  const annualRows = data.annual.filter((r: any) => r.revenue || r.operatingIncome).slice(-4);
  const qRows = data.quarterly.filter((r: any) => r.revenue || r.operatingIncome).slice(-6);

  const DIVIDER = isUSTicker(ticker) ? 1e9 : 1e8; // USD→십억, KRW→억
  const UNIT_LABEL = isEn ? "B USD" : "억원";

  const toChart = (rows: any[]) => rows.map((r: any) => ({
    name: r.period?.replace(/\d{4}-/, "").replace(/\.\d{2}$/, "") || r.period,
    fullName: r.period,
    revenue: r.revenue != null ? Math.round(r.revenue / DIVIDER) : null,
    opIncome: r.operatingIncome != null ? Math.round(r.operatingIncome / DIVIDER) : null,
    netIncome: r.netIncome != null ? Math.round(r.netIncome / DIVIDER) : null,
    opm: r.operatingMargin != null ? Math.round(r.operatingMargin * 10) / 10 : null,
    isEstimate: r.isEstimate,
  }));

  const annualChart = toChart(annualRows);
  const qChart = toChart(qRows);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 text-[12px] shadow-lg">
        <p className="font-semibold text-foreground mb-1">{payload[0]?.payload?.fullName || label}</p>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="font-mono text-foreground ml-auto pl-4">
              {p.value != null ? `${p.value.toLocaleString()} ${UNIT_LABEL}` : "—"}
            </span>
          </div>
        ))}
        {payload[0]?.payload?.opm != null && (
          <div className="mt-1 pt-1 border-t border-border/50 text-muted-foreground">
            OPM <span className="text-foreground font-mono">{payload[0].payload.opm}%</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-5 mb-1 flex flex-col gap-5">
      {annualChart.length >= 2 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-3.5 rounded-full" style={{ background: color }} />
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              {isEn ? "Annual P&L" : "연간 실적 추이"}
            </span>
            <span className="text-[10px] text-muted-foreground/60 ml-1">({UNIT_LABEL})</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={annualChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={38}
                tickFormatter={(v) => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted)/0.4)" }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={7} />
              <Bar dataKey="revenue" name={isEn ? "Revenue" : "매출"} fill={`${color}55`} radius={[3, 3, 0, 0]} />
              <Bar dataKey="opIncome" name={isEn ? "Op. Income" : "영업이익"} fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {qChart.length >= 2 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-3.5 rounded-full" style={{ background: color }} />
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              {isEn ? "Quarterly P&L" : "분기 실적 추이"}
            </span>
            <span className="text-[10px] text-muted-foreground/60 ml-1">({UNIT_LABEL})</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={qChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={38}
                tickFormatter={(v) => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted)/0.4)" }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={7} />
              <Bar dataKey="revenue" name={isEn ? "Revenue" : "매출"} fill={`${color}55`} radius={[3, 3, 0, 0]} />
              <Bar dataKey="opIncome" name={isEn ? "Op. Income" : "영업이익"} fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {qChart.some((r: any) => r.isEstimate) && (
            <p className="text-[10px] text-muted-foreground/50 mt-1 text-right">
              {isEn ? "E = Analyst consensus estimate" : "E = 애널리스트 컨센서스 추정치"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StepCard({ step, agent: agentProp, delay, ticker, companyName, companyNameEn, startPrice, isEn = false, isSignedIn = false, validatedTargetPrice, validatedVerdict }: { step: any, agent: AgentInfo | undefined, delay: number, ticker?: string, companyName?: string, companyNameEn?: string, startPrice?: number, isEn?: boolean, isSignedIn?: boolean, validatedTargetPrice?: number | null, validatedVerdict?: string | null }) {
  const priceCurrency: "KRW" | "USD" = isUSTicker(ticker) ? "USD" : "KRW";
  const agent: AgentInfo = agentProp ?? {
    id: step.stepKey,
    name: step.agentName ?? "에이전트",
    nameEn: step.agentName ?? "Agent",
    role: step.agentRole ?? step.stepKey,
    icon: BrainCircuit,
    color: "text-primary",
    bgColor: "bg-primary/10",
    description: "",
    descriptionEn: "",
  };

  const color = AGENT_COLORS[step.stepKey] ?? "hsl(218, 67%, 44%)";
  const isGated = !isSignedIn && BLUR_GATED_STEPS.includes(step.stepKey);

  const isFundamental = step.stepKey === "company_analysis";
  const content = step.content ?? "";

  const valuationData = useMemo(() => isFundamental ? parseValuationData(content) : null, [isFundamental, content]);
  const displayContent = useMemo(() => stripPromptInstructions(stripEstimationLabels(
    isFundamental
      ? stripValuationData(content)
      : content
  )), [isFundamental, content]);

  // 리드 문장 — 첫 번째 ## 소제목 이전의 텍스트
  const leadIdx = useMemo(() => displayContent.search(/(?:^|\n)## /), [displayContent]);
  const leadPara = useMemo(() => (leadIdx > 0 ? displayContent.slice(0, leadIdx).trim() : ""), [displayContent, leadIdx]);
  const bodyContent = useMemo(() => (leadIdx >= 0 ? displayContent.slice(leadIdx) : displayContent), [displayContent, leadIdx]);

  // 밸류에이션 핵심 지표 섹션 분리 (토글화)
  // 섹션이 bodyContent의 첫 번째 ## 제목일 경우 앞에 \n이 없으므로 두 경우 모두 처리
  const valuationMetricsSplit = useMemo(() => {
    if (!isFundamental) return null;
    // Case 1: 중간에 등장 — \n## 앞에 newline 있음
    const midIdx = bodyContent.search(/\n## 밸류에이션을 위한 핵심 지표/);
    if (midIdx >= 0) {
      return { before: bodyContent.slice(0, midIdx), section: bodyContent.slice(midIdx + 1) };
    }
    // Case 2: 맨 앞에 등장 — bodyContent 전체가 해당 섹션
    if (/^## 밸류에이션을 위한 핵심 지표/.test(bodyContent)) {
      return { before: '', section: bodyContent };
    }
    return null;
  }, [isFundamental, bodyContent]);
  const keyAssumptionsSplit = null; // relative_valuation removed

  const mainBodyContent = useMemo(() => {
    if (valuationMetricsSplit) return valuationMetricsSplit.before;
    return bodyContent;
  }, [bodyContent, valuationMetricsSplit]);


  const [showValuationMetrics, setShowValuationMetrics] = useState(false);
  const [showKeyAssumptions, setShowKeyAssumptions] = useState(false);
  const [showModelAssumptions, setShowModelAssumptions] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showDetailTable, setShowDetailTable] = useState(false);

  // investment_strategy는 모든 hook 선언 후에 분기 (Rules of Hooks 준수)
  if (step.stepKey === "investment_strategy") {
    if (isGated) return <BlurGateCard agent={agent} color={color} delay={delay} isEn={isEn} />;
    return <InvestmentStrategyCard step={step} agent={agent} delay={delay} ticker={ticker} companyName={companyName} createdAt={step.createdAt} isEn={isEn} validatedTargetPrice={validatedTargetPrice} validatedVerdict={validatedVerdict} />;
  }

  if (isGated) return <BlurGateCard agent={agent} color={color} delay={delay} isEn={isEn} />;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card rounded-[var(--radius)] overflow-hidden shadow-[var(--shadow-card)]"
    >
      {/* ⑪ Accordion header */}
      <div
        className="px-4 sm:px-6 py-4 flex items-center gap-3 cursor-pointer hover:bg-muted/40 transition-colors select-none border-b border-border/50"
        onClick={() => setCollapsed(c => !c)}
      >
        <div
          className="w-1 h-8 rounded-full shrink-0"
          style={{ background: color }}
        />
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-[16px] text-foreground leading-tight">{agent.role}</h4>
          <span className="text-[13px] text-muted-foreground">{isEn ? (agent.nameEn ?? agent.name) : agent.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${color}15` }}>
            <agent.icon className="w-3.5 h-3.5" style={{ color }} />
          </div>
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground/50 transition-transform duration-200 shrink-0", collapsed && "rotate-180")} />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
      <div className="p-4 sm:p-5">


        {/* ③ 현재가 vs 적정주가 + 단기 방향 분석 */}

        {/* ④ Market & Technical Analyst: 기술적 신호 칩 */}

        {/* 리드 문장 — 첫 번째 ## 소제목 이전 텍스트 강조 박스 */}
        {leadPara && (
          <div
            className="mb-4 px-4 py-3.5 rounded-[var(--radius)] bg-muted/50 text-[15px] leading-[1.95] text-foreground/90 whitespace-pre-line border-l-[3px]"
            style={{ borderLeftColor: color }}
          >
            {leadPara}
          </div>
        )}

        <MdBlock src={mainBodyContent} isEn={isEn} />





      </div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
}
