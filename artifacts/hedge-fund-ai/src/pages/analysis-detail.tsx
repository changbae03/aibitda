import { useEffect, useRef, useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useGetAnalysis, getGetAnalysisQueryKey, useDeleteAnalysis } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENTS, ANALYSIS_STEPS_ORDER, type AgentInfo } from "@/lib/agents";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { 
  CheckCircle2, 
  Clock, 
  Play, 
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
} from "lucide-react";
import { cn, formatCurrency, isUSTicker, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import StockChart, { type ChartLevels } from "@/components/StockChart";
import FinancialChart from "@/components/FinancialChart";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

function MemoSection({ analysisId }: { analysisId: number }) {
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
        className="flex items-center gap-1.5 text-[12px] text-neutral-400 hover:text-amber-500 transition-colors print:hidden"
      >
        <StickyNote className="w-3.5 h-3.5" />
        메모 추가
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
          placeholder="이 보고서에 대한 메모를 입력하세요..."
          rows={2}
          className="w-full text-[13px] text-neutral-700 placeholder-neutral-300 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-300 leading-relaxed"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); handleCancel(); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
          }}
        />
        <div className="flex items-center gap-2">
          <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-400 hover:bg-amber-500 text-white text-[12px] font-semibold transition-colors">
            <Check className="w-3.5 h-3.5" /> 저장
          </button>
          <button onClick={handleCancel} className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-500 text-[12px] font-semibold transition-colors">
            <X className="w-3.5 h-3.5" /> 취소
          </button>
          <span className="text-[11px] text-neutral-300">⌘Enter로 저장</span>
        </div>
      </div>
    );
  }

  return (
    <div className="group/memo flex items-start gap-2 print:hidden">
      <StickyNote className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
      <p className="flex-1 text-[13px] text-neutral-600 leading-relaxed whitespace-pre-wrap break-words">{saved}</p>
      <button
        onClick={startEdit}
        className="shrink-0 p-1 rounded text-neutral-300 hover:text-amber-500 hover:bg-amber-50 transition-colors opacity-0 group-hover/memo:opacity-100"
        title="메모 수정"
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

function prepareMarkdown(md: string): string {
  if (!md) return md;

  // 줄 단위로 처리해서 테이블 "첫 번째 행" 바로 앞에만 빈 줄을 삽입
  // (헤더→구분선→데이터 사이에 빈 줄을 삽입하면 오히려 테이블이 깨짐)
  const lines = md.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";
    const isTableRow = /^\s*\|/.test(line);
    const prevIsTableRow = /^\s*\|/.test(prev);
    const prevIsBlank = prev.trim() === "";

    // 현재 줄이 테이블 행이고, 이전 줄이 테이블 행도 아니고 빈 줄도 아니면 → 빈 줄 삽입
    if (isTableRow && !prevIsTableRow && !prevIsBlank) {
      out.push("");
    }
    // 한국 금융 단위 앞 숫자에 천단위 쉼표 삽입
    out.push(addKrwCommas(line));
  }

  return out.join("\n");
}

const MD_TABLE_COMPONENTS = {
  table: ({ children }: any) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead>{children}</thead>,
  tbody: ({ children }: any) => <tbody>{children}</tbody>,
  tr: ({ children }: any) => <tr>{children}</tr>,
  th: ({ children }: any) => <th>{children}</th>,
  td: ({ children }: any) => <td>{children}</td>,
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

function verdictStyle(verdict: string | null | undefined) {
  if (!verdict) return { label: "—", color: "text-neutral-500", bg: "bg-neutral-100" };
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return { label: "높은 상승여력", color: "text-emerald-700", bg: "bg-emerald-50" };
  if (s.includes("buy"))         return { label: "상승여력",      color: "text-green-700",   bg: "bg-green-50" };
  if (s.includes("strong sell")) return { label: "높은 하락여지", color: "text-red-700",     bg: "bg-red-50" };
  if (s.includes("sell"))        return { label: "하락여지",      color: "text-red-600",     bg: "bg-red-50" };
  return { label: "적정 수준", color: "text-amber-700", bg: "bg-amber-50" };
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
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const url = window.location.href;
  const currency = isUSTicker(analysis?.ticker) ? "USD" : "KRW";
  const vs = verdictStyle(analysis?.verdict);
  const targetPriceStr = analysis?.targetPrice
    ? formatCurrency(analysis.targetPrice, currency)
    : null;

  const shareText = `${analysis?.ticker ?? ""} ${analysis?.companyName ?? ""} — ${vs.label}${targetPriceStr ? ` | 적정주가 ${targetPriceStr}` : ""}\nAI 7단계 파이프라인 분석 리포트 · 애빛다`;

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
          title: `${analysis?.ticker ?? ""} ${analysis?.companyName ?? ""} — 애빛다`,
          description: `${vs.label}${targetPriceStr ? ` · 적정주가 ${targetPriceStr}` : ""} | AI 분석 리포트`,
          imageUrl,
          link: { mobileWebUrl: url, webUrl: url },
        },
        buttons: [{ title: "리포트 보기", link: { mobileWebUrl: url, webUrl: url } }],
      });
    } catch { handleCopy(); }
  };

  const handleTelegram = () => {
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`;
    window.open(tgUrl, "_blank", "noopener,noreferrer");
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(url); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportImage = async () => {
    if (!cardRef.current || exporting) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(cardRef.current, {
        scale: 3,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `애빛다_${analysis?.ticker ?? "분석"}_${analysis?.companyName ?? ""}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

        {/* Sheet */}
        <motion.div
          className="relative w-full max-w-sm mx-4 mb-4 sm:mb-0 bg-white rounded-2xl shadow-2xl overflow-hidden"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-neutral-100">
            <span className="text-sm font-semibold text-neutral-700">공유하기</span>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-neutral-100 transition-colors">
              <svg className="w-4 h-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Report Preview Card */}
          <div ref={cardRef} className="mx-5 mt-4 rounded-xl border border-neutral-200 bg-neutral-50 overflow-hidden">
            <div className="px-4 py-3 flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <span className="text-primary text-xs font-bold">AI</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">{analysis?.ticker}</span>
                  <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", vs.bg, vs.color)}>{vs.label}</span>
                </div>
                <p className="text-sm font-semibold text-neutral-800 mt-0.5 truncate">{analysis?.companyName}</p>
                {targetPriceStr && (
                  <p className="text-xs text-neutral-500 mt-0.5">적정주가 <span className="font-semibold text-neutral-700">{targetPriceStr}</span></p>
                )}
              </div>
            </div>
            <div className="px-4 py-2 border-t border-neutral-200 bg-white">
              <p className="text-[10px] text-neutral-400">애빛다 · AI 기업분석 리포트</p>
            </div>
          </div>

          {/* Share Buttons */}
          <div className="px-5 py-4 grid grid-cols-4 gap-2">
            {/* KakaoTalk */}
            <button
              onClick={handleKakao}
              className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-[#FEE500] hover:bg-[#F5DB00] transition-colors group"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.706 1.574 5.083 3.96 6.549L4.8 21l4.6-2.4A11.7 11.7 0 0012 18.6c5.523 0 10-3.477 10-7.8S17.523 3 12 3z" fill="#391B1B"/>
              </svg>
              <span className="text-[10px] font-semibold text-[#391B1B]">카카오톡</span>
            </button>

            {/* Telegram */}
            <button
              onClick={handleTelegram}
              className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-[#229ED9] hover:bg-[#1a8fc4] transition-colors"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="white">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8.02c-.12.57-.46.71-.94.44l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.52.26l.18-2.65 4.74-4.28c.21-.18-.04-.28-.31-.1L7.5 14.97 4.96 14.2c-.56-.17-.57-.56.12-.83l8.9-3.44c.47-.17.88.11.72.87z"/>
              </svg>
              <span className="text-[10px] font-semibold text-white">텔레그램</span>
            </button>

            {/* Copy Link */}
            <button
              onClick={handleCopy}
              className={cn(
                "flex flex-col items-center gap-1.5 py-3 rounded-xl transition-colors",
                copied ? "bg-emerald-500" : "bg-neutral-100 hover:bg-neutral-200"
              )}
            >
              {copied
                ? <Check className="w-6 h-6 text-white" />
                : <svg className="w-6 h-6 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
              }
              <span className={cn("text-[10px] font-semibold", copied ? "text-white" : "text-neutral-500")}>
                {copied ? "복사됨!" : "링크 복사"}
              </span>
            </button>

            {/* 이미지 저장 */}
            <button
              onClick={handleExportImage}
              disabled={exporting}
              className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-neutral-100 hover:bg-neutral-200 transition-colors disabled:opacity-60"
            >
              {exporting
                ? <Loader2 className="w-6 h-6 text-neutral-500 animate-spin" />
                : <svg className="w-6 h-6 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
              }
              <span className="text-[10px] font-semibold text-neutral-500">
                {exporting ? "생성중..." : "이미지 저장"}
              </span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
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

function PeerMultiplesPanel({ ticker }: { ticker: string }) {
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
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => e.key === "Enter" && setOpen(o => !o)}
        className="w-full px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-500" />
          <span className="font-semibold text-sm">피어 멀티플 실측 데이터</span>
          {data && (
            <span className="text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-medium">
              {rows.length}개 피어
            </span>
          )}
          {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              수집: {new Date(data.collected_at).toLocaleDateString("ko-KR")}
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
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">종목</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">P/B</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">P/E</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap hidden sm:table-cell">P/E Fwd</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">EV/EBIT</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap hidden sm:table-cell">EV/Sales</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">ROE</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">OPM</th>
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap hidden sm:table-cell">시총</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map(([t, p]) => (
                  <tr key={t} className="hover:bg-muted/20">
                    <td className="px-3 py-1.5 whitespace-nowrap max-w-[90px] sm:max-w-none">
                      <span className="font-mono text-blue-600 font-medium text-[11px]">{t}</span>
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
                  <tr className="bg-blue-50/70 font-semibold border-t border-blue-200/50">
                    <td className="px-3 py-1.5 text-blue-700 text-[11px]">피어 평균</td>
                    <td className="px-3 py-1.5 text-right text-blue-700 tabular-nums">{fmtNum(avg.pbr, 2, "x")}</td>
                    <td className="px-3 py-1.5 text-right text-blue-700 tabular-nums">{fmtNum(avg.per_trailing, 1, "x")}</td>
                    <td className="px-2 py-1.5 text-right text-blue-700 tabular-nums hidden sm:table-cell">{fmtNum(avg.per_fwd, 1, "x")}</td>
                    <td className="px-2 py-1.5 text-right text-blue-700 tabular-nums">{fmtNum(avg.ev_ebitda, 1, "x")}</td>
                    <td className="px-2 py-1.5 text-right text-blue-700 tabular-nums hidden sm:table-cell">{fmtNum(avg.ev_sales, 2, "x")}</td>
                    <td className="px-3 py-1.5 text-right text-blue-700 tabular-nums">{fmtNum(avg.roe, 1, "%")}</td>
                    <td className="px-3 py-1.5 text-right text-blue-700 tabular-nums">{fmtNum(avg.operating_margin, 1, "%")}</td>
                    <td className="px-2 py-1.5 text-right text-blue-700 tabular-nums hidden sm:table-cell">{fmtMC(avg.marketCap)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border/50">
            실측 = Yahoo Finance 자동 수집 · <span className="sm:hidden">모바일: P/E Fwd·EV/Sales·시총은 PC에서 확인 · </span>EV/Sales = (시총+순차입금)÷매출
          </p>
        </div>
      )}
    </div>
  );
}

export default function AnalysisDetail() {
  const [, params] = useRoute("/analysis/:id");
  const [, setLocation] = useLocation();
  const id = params?.id ? parseInt(params.id, 10) : 0;
  
  const queryClient = useQueryClient();
  const { data: analysis, isLoading, error } = useGetAnalysis(id, {
    query: {
      refetchInterval: (query) => query.state.data?.status === 'in_progress' ? 3000 : false
    }
  });

  const { mutate: deleteAnalysis } = useDeleteAnalysis();
  const [showShareModal, setShowShareModal] = useState(false);

  // 피드백 상태
  const [feedbackRating, setFeedbackRating] = useState<1 | 5 | null>(null);
  const [feedbackChips, setFeedbackChips] = useState<string[]>([]);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

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
    const currency = isUSTicker(analysis.ticker) ? "USD" : "KRW";
    const verdict = analysis.investmentVerdict ? toKoreanVerdict(analysis.investmentVerdict) : "";
    const targetStr = analysis.targetPrice ? formatCurrency(analysis.targetPrice, currency) : "";
    const title = verdict && targetStr
      ? `${analysis.ticker} ${analysis.companyName} — ${verdict} · 적정주가 ${targetStr} | 애빛다`
      : `${analysis.ticker} ${analysis.companyName} | 애빛다`;
    const desc = verdict && targetStr
      ? `${analysis.companyName} AI 분석 리포트 · ${verdict} · 적정주가 ${targetStr}. DCF·rNPV 기반 7단계 파이프라인 분석.`
      : `${analysis.companyName} AI 7단계 분석 리포트 · 산업·실적·밸류에이션·기술적 분석 | 애빛다`;

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
  }, [analysis?.investmentVerdict, analysis?.targetPrice, analysis?.ticker, analysis?.companyName]);

  type QCStatus = "checking" | "approved" | "revising" | "revised";
  interface StreamingStepState {
    key: string;
    content: string;
    qcStatus?: QCStatus;
    qcScore?: number;
    qcFeedback?: string;
  }
  const [streamingStep, setStreamingStep] = useState<StreamingStepState | null>(null);
  const isStreaming = streamingStep !== null;
  const triggeredSteps = useRef<Set<string>>(new Set());

  const handleDelete = () => {
    if (!confirm("이 분석을 삭제하시겠습니까?")) return;
    deleteAnalysis(id, { onSuccess: () => setLocation("/") });
  };

  const runStreamingStep = useCallback(async (stepKey: string) => {
    setStreamingStep({ key: stepKey, content: "" });
    try {
      const res = await fetch(`/api/analysis/${id}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey }),
      });
      if (!res.ok || !res.body) {
        setStreamingStep(null);
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
            if (msg.qc === "checking") {
              setStreamingStep(prev => prev ? { ...prev, content: "", qcStatus: "checking" } : null);
            } else if (msg.qc === "approved") {
              setStreamingStep(prev => prev ? { ...prev, qcStatus: "approved", qcScore: msg.score } : null);
            } else if (msg.qc === "revising") {
              setStreamingStep(prev => prev ? { ...prev, content: "", qcStatus: "revising", qcScore: msg.score, qcFeedback: msg.feedback } : null);
            } else if (msg.qc === "revised") {
              setStreamingStep(prev => prev ? { ...prev, qcStatus: "revised", qcScore: msg.score } : null);
            } else if (msg.t) {
              setStreamingStep(prev => prev ? { ...prev, content: prev.content + msg.t } : null);
            }
            if (msg.done) {
              queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch {
      setStreamingStep(null);
    }
  }, [id, queryClient]);

  // Clear streaming card once the step appears in the DB-fetched list
  useEffect(() => {
    if (!streamingStep) return;
    if (analysis?.steps.some(s => s.stepKey === streamingStep.key)) {
      setStreamingStep(null);
    }
  }, [analysis?.steps, streamingStep]);

  // Auto-trigger next step sequentially
  useEffect(() => {
    if (!analysis || analysis.status !== "in_progress" || isStreaming) return;
    const nextIndex = analysis.steps.length;
    if (nextIndex >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[nextIndex];
    if (triggeredSteps.current.has(nextStepKey)) return;
    triggeredSteps.current.add(nextStepKey);
    runStreamingStep(nextStepKey);
  }, [analysis?.steps.length, analysis?.status, isStreaming, runStreamingStep]);

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

  const handleRunNextStep = () => {
    if (isComplete || isStreaming || currentStepCount >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[currentStepCount];
    if (triggeredSteps.current.has(nextStepKey)) return;
    triggeredSteps.current.add(nextStepKey);
    runStreamingStep(nextStepKey);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* 인쇄 전용 헤더 — 화면에서는 숨김, 인쇄 시에만 표시 */}
      <div className="hidden print:block mb-8 pb-6 border-b-2 border-gray-800">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-2">애빛다 &nbsp;|&nbsp; AI 기업분석 리포트</div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">
              {analysis.companyName}
              <span className="ml-2 text-base font-mono text-gray-500">({analysis.ticker})</span>
            </h1>
            {analysis.englishName && <p className="text-sm text-gray-500 mt-0.5">{analysis.englishName}</p>}
            <p className="text-xs text-gray-400 mt-1">{toKoreanIndustry(analysis.industry)} &nbsp;·&nbsp; {format(new Date(analysis.createdAt), 'yyyy년 M월 d일 HH:mm', { locale: ko })} 생성</p>
          </div>
          {analysis.investmentVerdict && (
            <div className="text-right">
              <div className="text-xl font-bold text-gray-900">{toKoreanVerdict(analysis.investmentVerdict)}</div>
              {analysis.targetPrice && (
                <div className="text-sm text-gray-600 mt-0.5">12개월 적정주가 {formatCurrency(analysis.targetPrice, isUSTicker(analysis.ticker) ? "USD" : "KRW")}</div>
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
        목록으로
      </button>

      {/* Header */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              <span className="px-2.5 py-1 bg-primary/10 text-primary rounded-md font-mono font-bold tracking-wider text-sm border border-primary/20">
                {analysis.ticker}
              </span>
              <span className={cn(
                "px-2 py-0.5 text-xs font-semibold rounded border",
                isComplete 
                  ? "bg-success/10 text-success border-success/20" 
                  : "bg-warning/10 text-warning border-warning/20 animate-pulse"
              )}>
                {isComplete ? '분석 완료' : '분석 진행중'}
              </span>
              <span className="px-2 py-0.5 text-[10px] font-medium rounded border bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-1">
                <span>⚡</span>AI 자동 생성 · 참고용
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground leading-tight">
              {analysis.companyName}
            </h1>
            {analysis.englishName && (
              <p className="text-sm text-muted-foreground mt-0.5 mb-1 font-normal">{analysis.englishName}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-2">
              <span className="flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> {toKoreanIndustry(analysis.industry)}</span>
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {format(new Date(analysis.createdAt), 'M월 d일 HH:mm', { locale: ko })}</span>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-3 print:hidden w-full md:w-auto">

          {/* Verdict Card */}
          {isComplete && analysis.investmentVerdict && (
            <div className="bg-primary/5 border border-primary/20 p-5 rounded-xl w-full md:min-w-[250px] md:w-auto">
              <div className="text-xl font-bold text-foreground mb-3">{toKoreanVerdict(analysis.investmentVerdict)}</div>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex justify-between items-center border-b border-border pb-1.5">
                  <span className="text-muted-foreground">적정주가 <span className="text-xs opacity-60">(12개월)</span></span>
                  <span className="text-success font-bold">{formatCurrency(analysis.targetPrice, isUSTicker(analysis.ticker) ? "USD" : "KRW")}</span>
                </div>
                <div className="flex justify-between items-center border-b border-border pb-1.5">
                  <span className="text-muted-foreground">진입가</span>
                  <span className="text-foreground font-semibold">{formatCurrency(analysis.entryPrice, isUSTicker(analysis.ticker) ? "USD" : "KRW")}</span>
                </div>
                <div className="flex justify-between items-center pt-0.5">
                  <span className="text-muted-foreground">손절가</span>
                  <span className="text-destructive font-semibold">{formatCurrency(analysis.stopLoss, isUSTicker(analysis.ticker) ? "USD" : "KRW")}</span>
                </div>
              </div>

              {/* 인라인 공유 버튼 */}
              <button
                onClick={() => setShowShareModal(true)}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all"
              >
                <Share2 className="w-3.5 h-3.5" />
                이 분석 공유하기
              </button>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* 내 메모 */}
      <div className="bg-amber-50/60 border border-amber-100 rounded-2xl px-5 py-4 print:hidden">
        <MemoSection analysisId={analysis.id} />
      </div>

      {/* Financial Chart */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <FinancialChart ticker={analysis.ticker} />
      </div>

      {/* Peer Multiples Panel */}
      <PeerMultiplesPanel ticker={analysis.ticker} />

      {/* Progress Track */}
      <div className="bg-card border border-border rounded-2xl p-5 print:hidden">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display font-semibold text-base flex items-center gap-2">
            <BrainCircuit className="text-primary w-4 h-4" />
            AI 분석 파이프라인
          </h3>
          <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{currentStepCount} / {ANALYSIS_STEPS_ORDER.length} 단계</span>
        </div>
        
        <div className="relative">
          <div className="absolute top-4 left-4 right-4 h-0.5 bg-border z-0" />
          <div 
            className="absolute top-4 left-4 h-0.5 bg-primary z-0 transition-all duration-700 ease-out"
            style={{ width: `calc(${(currentStepCount / ANALYSIS_STEPS_ORDER.length) * 100}% - 2rem)` }}
          />
          <div className="relative z-10 flex justify-between">
            {ANALYSIS_STEPS_ORDER.map((stepKey, idx) => {
              const isDone = idx < currentStepCount;
              const isCurrent = idx === currentStepCount;
              const agent = AGENTS[stepKey];
              return (
                <div key={stepKey} className="flex flex-col items-center gap-1.5">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                    isDone ? "bg-primary border-primary text-primary-foreground" : 
                    isCurrent ? "bg-card border-primary text-primary animate-pulse" : 
                    "bg-card border-border text-muted-foreground"
                  )}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : <agent.icon className="w-3.5 h-3.5" />}
                  </div>
                  <span className={cn(
                    "text-[10px] font-medium leading-tight text-center max-w-[64px] break-keep",
                    isDone ? "text-primary" : isCurrent ? "text-primary" : "text-muted-foreground"
                  )}>
                    {agent.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Analysis Steps Feed */}
      <div className="space-y-4">
        <AnimatePresence>
          {[...analysis.steps]
            .sort((a, b) => ANALYSIS_STEPS_ORDER.indexOf(a.stepKey as any) - ANALYSIS_STEPS_ORDER.indexOf(b.stepKey as any))
            .map((step, idx) => (
            <StepCard key={step.id} step={step} agent={AGENTS[step.stepKey]} delay={idx * 0.05} ticker={analysis.ticker} companyName={analysis.companyName} />
          ))}
        </AnimatePresence>

        {/* Streaming card — live typewriter while AI writes */}
        <div className="print:hidden">
          <AnimatePresence>
            {streamingStep && (
              <StreamingCard
                key={streamingStep.key}
                stepKey={streamingStep.key}
                content={streamingStep.content}
                qcStatus={streamingStep.qcStatus}
                qcScore={streamingStep.qcScore}
                qcFeedback={streamingStep.qcFeedback}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Next Action — only shown when not streaming and not complete */}
        {!isComplete && !isStreaming && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-8 rounded-xl border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center text-center gap-4 print:hidden"
          >
            {currentStepCount < ANALYSIS_STEPS_ORDER.length ? (
              <>
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  {(() => {
                    const NextIcon = AGENTS[ANALYSIS_STEPS_ORDER[currentStepCount]].icon;
                    return <NextIcon className="w-7 h-7 text-primary/60" />;
                  })()}
                </div>
                <div>
                  <h4 className="text-base font-display font-semibold text-foreground mb-1">다음 분석 단계 대기 중</h4>
                  <p className="text-muted-foreground text-sm">
                    다음 에이전트: <span className="text-foreground font-medium">{AGENTS[ANALYSIS_STEPS_ORDER[currentStepCount]].role}</span>
                  </p>
                </div>
                <button
                  onClick={handleRunNextStep}
                  className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all flex items-center gap-2 shadow-sm"
                >
                  <Play className="w-4 h-4 fill-current" /> {currentStepCount + 1}단계 실행
                </button>
              </>
            ) : (
              <div className="text-center">
                <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">최종 보고서 작성 중...</p>
              </div>
            )}
          </motion.div>
        )}
      </div>

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
                className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-neutral-200 bg-white px-5 py-3.5 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:border-primary/40 hover:text-primary hover:bg-primary/5"
              >
                <Share2 className="w-4 h-4" />
                공유하기
              </button>
            </div>
            {showShareModal && (
              <ShareModal analysis={analysis} onClose={() => setShowShareModal(false)} />
            )}

            {/* 사용자 피드백 */}
            <div className="mt-4 print:hidden">
              {feedbackSubmitted ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-5 py-3 text-sm text-emerald-700 font-medium"
                >
                  <Check className="w-4 h-4" />
                  피드백이 AI 학습에 반영되었습니다. 감사합니다!
                </motion.div>
              ) : (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-4 space-y-3">
                  {/* 헤더 */}
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-neutral-400" />
                    <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">이 분석이 도움이 됐나요?</span>
                    <span className="text-[10px] text-neutral-400">— 답변이 AI 개선에 사용됩니다</span>
                  </div>

                  {/* 👍 / 👎 버튼 — 클릭 즉시 칩 펼침 */}
                  <div className="flex items-center gap-2">
                    {(
                      [
                        { value: 5 as const, label: "도움됐어요", icon: <ThumbsUp className="w-3.5 h-3.5" />, active: "bg-emerald-50 border-emerald-400 text-emerald-700", hover: "hover:border-emerald-300 hover:text-emerald-700" },
                        { value: 1 as const, label: "아쉬웠어요", icon: <ThumbsDown className="w-3.5 h-3.5" />, active: "bg-rose-50 border-rose-400 text-rose-700", hover: "hover:border-rose-300 hover:text-rose-700" },
                      ] as const
                    ).map(({ value, label, icon, active, hover }) => (
                      <button
                        key={value}
                        onClick={() => { setFeedbackRating(value); setFeedbackChips([]); }}
                        className={cn(
                          "flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-[13px] font-medium transition-all",
                          feedbackRating === value ? active : `bg-white border-neutral-200 text-neutral-600 ${hover}`
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
                        <p className="text-[11px] text-neutral-400">
                          {feedbackRating === 5 ? "어떤 점이 좋았나요?" : "어떤 점이 아쉬웠나요?"}
                          <span className="ml-1 text-neutral-300">(여러 개 선택 가능)</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(feedbackRating === 5
                            ? ["밸류에이션 근거가 명확해요", "투자 판단에 도움됐어요", "데이터가 풍부해요", "리스크 분석이 탄탄해요", "업종 이해가 깊어요"]
                            : ["데이터가 부정확해요", "밸류에이션 근거가 약해요", "결론이 모호해요", "업종 이해가 부족해요", "리스크가 간과됐어요"]
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
                                      ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                                      : "bg-white border-neutral-200 text-neutral-500 hover:border-emerald-300 hover:text-emerald-600"
                                    : selected
                                      ? "bg-rose-50 border-rose-400 text-rose-700"
                                      : "bg-white border-neutral-200 text-neutral-500 hover:border-rose-300 hover:text-rose-600"
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
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neutral-900 text-white text-[13px] font-semibold hover:bg-neutral-700 transition-colors disabled:opacity-50"
                        >
                          {feedbackSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          제출하기
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* 관리자 종목 보정 메모 — 개발 환경에서만 표시 */}
            {isComplete && import.meta.env.DEV && (
              <div className="mt-4 print:hidden">
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">📝 종목 보정 메모</span>
                    <span className="text-[10px] text-amber-600">— 다음 AI 분석에 자동 반영됩니다</span>
                  </div>
                  <textarea
                    value={tickerMemo}
                    onChange={e => setTickerMemo(e.target.value)}
                    placeholder={`${analysis.companyName}(${analysis.ticker})에 대한 특수 사항, 보정 지시, 사업 특성 등을 입력하세요.\n예) HBM 점유율 변화가 핵심 드라이버 / 2023년 DS 적자는 일회성 처리할 것`}
                    className="w-full text-[13px] rounded-lg border border-amber-200 bg-white px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 text-neutral-700 placeholder:text-amber-300"
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
                      <span className="text-[12px] text-emerald-600 font-medium">✓ 저장됐습니다. 다음 분석부터 반영됩니다.</span>
                    )}
                    {tickerMemo.length > 0 && (
                      <span className="text-[11px] text-amber-500 ml-auto">{tickerMemo.length}/1000</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div className="mt-5 pt-6 border-t border-neutral-100 print:mt-6">
              {/* AI 생성 명시 배너 (AI 기본법 투명성 의무) */}
              <div className="mb-3 flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <span className="text-amber-500 text-base leading-none mt-0.5">⚠</span>
                <p className="text-[11.5px] text-amber-800 leading-relaxed">
                  <span className="font-bold">AI 자동 생성 콘텐츠.</span> 본 리포트는 대형 언어모델(LLM) AI가 공개 데이터를 바탕으로 자동 생성한 분석 참고 자료입니다. 인간 전문가의 검토를 거치지 않았으며, 사실 오류·추론 오류가 포함될 수 있습니다. 투자 결정 전 반드시 공식 공시 자료 및 전문가 의견을 별도로 확인하십시오.
                </p>
              </div>

              <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-5 py-4 space-y-2">
                <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">투자 유의사항 (Legal Disclaimer)</p>
                <p className="text-[11.5px] text-neutral-500 leading-relaxed">
                  본 리포트는 「CBST」가 운영하는 AI 정보 서비스 「애빛다」가 공개된 재무 데이터, 시장 정보 및 기업 공시 자료를 바탕으로 자동 생성한 <span className="font-semibold">순수 참고용 정보</span>입니다. 본 서비스는 자본시장과 금융투자업에 관한 법률상 투자자문업 또는 투자일임업에 해당하지 않으며, 특정인을 대상으로 한 개별 투자 판단·조언을 제공하지 않습니다.
                </p>
                <div className="space-y-2 mt-1">
                  <p className="text-[11.5px] text-neutral-500 leading-relaxed">
                    <span className="font-semibold text-neutral-600">투자 책임:</span> 본 리포트에 포함된 가격 수준, 시나리오, 분석 수치는 특정 투자 행위를 권유하거나 추천하는 것이 아닙니다. 모든 내용은 정보 제공만을 목적으로 하며, 투자 판단의 최종 책임은 전적으로 투자자 본인에게 귀속됩니다.
                  </p>
                  <p className="text-[11.5px] text-neutral-500 leading-relaxed">
                    <span className="font-semibold text-neutral-600">AI 한계:</span> AI가 산출한 적정주가·재무 추정치는 특정 알고리즘과 가정에 기반한 예측값입니다. 학습 데이터의 한계, 모델 오류, 시장 변동성 등으로 인해 실제 결과와 크게 다를 수 있습니다. 당사는 해당 정보의 정확성, 완전성, 적시성을 보증하지 않습니다.
                  </p>
                  <p className="text-[11.5px] text-neutral-500 leading-relaxed">
                    <span className="font-semibold text-neutral-600">손실 위험:</span> 과거의 수익률이나 AI 시뮬레이션 성과가 미래의 수익을 보장하지 않습니다. 금융투자상품은 원금의 전부 또는 일부 손실이 발생할 수 있습니다.
                  </p>
                  <p className="text-[11.5px] text-neutral-500 leading-relaxed">
                    <span className="font-semibold text-neutral-600">독립 확인 권장:</span> 본 자료에 의존하기 전 금융감독원 전자공시시스템(DART), 거래소 공시, 공식 보도자료 등 신뢰할 수 있는 소스를 통해 정보를 독립적으로 재확인하시기 바랍니다.
                  </p>
                </div>
                <p className="text-[11px] text-neutral-400 mt-2 pt-2 border-t border-neutral-200">
                  본 리포트의 무단 복제·배포·재가공은 금지됩니다. &nbsp;·&nbsp; 인공지능 기본법에 따라 AI 생성 콘텐츠임을 고지합니다.
                </p>
                <p className="text-[10.5px] text-neutral-400 mt-1">
                  분석 생성일: {analysis.createdAt ? new Date(analysis.createdAt).toLocaleString("ko-KR") : "—"} &nbsp;·&nbsp; © CBST(애빛다 AI). All rights reserved.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatPrice(val: string | number | undefined | null, currency: "KRW" | "USD" = "KRW"): string {
  if (val == null) return "N/A";
  const str = String(val).trim();
  const num = parseFloat(str.replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return str;
  if (currency === "USD") {
    return "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(num);
  }
  return new Intl.NumberFormat("ko-KR").format(num) + "원";
}

function extractJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  // 1) 마크다운 코드블록 제거 (```json ... ``` 또는 ``` ... ```)
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  // 2) 앞뒤 설명 텍스트 제거 — 첫 { 부터 마지막 } 까지만 추출
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function InvestmentStrategyCard({ step, agent, delay, ticker, companyName, createdAt }: { step: any, agent: AgentInfo, delay: number, ticker?: string, companyName?: string, createdAt?: string }) {
  const json = extractJson(step.content);
  const priceCurrency: "KRW" | "USD" = isUSTicker(ticker) ? "USD" : "KRW";

  const verdictMeta = (v: string) => {
    if (!v) return { label: "—", color: "text-foreground", bg: "bg-neutral-100", border: "border-neutral-200", dot: "#6b7280" };
    const s = v.toLowerCase();
    if (s.includes("strong buy"))  return { label: "높은 상승여력", color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200", dot: "#059669" };
    if (s.includes("buy"))         return { label: "상승여력",      color: "text-green-700",   bg: "bg-green-50",    border: "border-green-200",   dot: "#16a34a" };
    if (s.includes("strong sell")) return { label: "높은 하락여지", color: "text-red-700",     bg: "bg-red-50",      border: "border-red-200",     dot: "#dc2626" };
    if (s.includes("sell"))        return { label: "하락여지",      color: "text-red-600",     bg: "bg-red-50",      border: "border-red-200",     dot: "#ef4444" };
    return { label: "적정 수준", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", dot: "#d97706" };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-2xl overflow-hidden border border-neutral-200 bg-white shadow-sm"
    >
      {/* ── 상단 헤더 ── */}
      <div className="bg-neutral-900 px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
            <agent.icon className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-white font-display font-semibold text-sm leading-tight">최종 투자 전략</p>
            <p className="text-neutral-400 text-[10px] font-mono uppercase tracking-widest">{agent.role}</p>
          </div>
        </div>
        {companyName && (
          <span className="text-[11px] text-neutral-400 font-medium hidden sm:block">{companyName}{ticker ? ` · ${ticker}` : ""}</span>
        )}
      </div>

      {json ? (() => {
        const vm = verdictMeta(json.verdict ?? "");
        return (
          <div className="divide-y divide-neutral-100">

            {/* ── ① 판정 + 메타 ── */}
            <div className="px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3">
              <span className={cn("text-[26px] font-display font-bold leading-none", vm.color)}>{vm.label}</span>
              <div className="flex flex-wrap gap-1.5">
                {json.confidence && (
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
                    신뢰도 {json.confidence}
                  </span>
                )}
                {json.investment_period && (
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
                    {json.investment_period}
                  </span>
                )}
                {json.risk_reward && (
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
                    R/R {json.risk_reward}
                  </span>
                )}
              </div>
            </div>

            {/* ── ② 핵심 이슈 ── */}
            {json.key_issue && (
              <div className="px-4 sm:px-6 py-4 bg-amber-50/60">
                <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-widest mb-1">핵심 이슈</p>
                <p className="text-sm text-neutral-800 leading-relaxed font-medium">{json.key_issue}</p>
              </div>
            )}

            {/* ── ③ 투자 논거 요약 ── */}
            {json.summary && (
              <div className="px-4 sm:px-6 py-4">
                <p className="text-sm text-neutral-600 leading-[1.8]">{json.summary}</p>
              </div>
            )}

            {/* ── ④ 가격 3박스 ── */}
            {(() => {
              // 현재가: json.current_price (신규) 또는 Base 시나리오 역산
              const cp = parseFloat(String(json.current_price ?? "").replace(/[^0-9.]/g, "")) || null;
              const ep = parseFloat(String(json.entry_price ?? "").replace(/[^0-9.]/g, "")) || null;
              const tp = parseFloat(String(json.target_price ?? "").replace(/[^0-9.]/g, "")) || null;
              const sl = parseFloat(String(json.stop_loss ?? "").replace(/[^0-9.]/g, "")) || null;

              // 적정주가 ↔ 현재가 기준 upside: Base 시나리오 upside 우선, 없으면 직접 계산
              const baseScenario = json.scenarios?.find((s: any) => s.case === "Base");
              const baseUpsideStr = String(baseScenario?.upside ?? "");
              // parseFloat은 "+15.2%" → 15.2, "-63.3%" → -63.3 자동 처리
              const baseUpsideNum = parseFloat(baseUpsideStr);
              const upsideFromCurrent: number | null =
                !isNaN(baseUpsideNum) ? baseUpsideNum
                : (cp && tp && cp > 0) ? (tp - cp) / cp * 100
                : null;

              const isBearish = upsideFromCurrent !== null && upsideFromCurrent < 0;
              const targetCardStyle = isBearish
                ? { border: "border-rose-200", bg: "bg-rose-50", dotColor: "bg-rose-400", labelColor: "text-rose-600", valColor: "text-rose-700", pctColor: "text-rose-600" }
                : { border: "border-emerald-200", bg: "bg-emerald-50", dotColor: "bg-emerald-500", labelColor: "text-emerald-700", valColor: "text-emerald-700", pctColor: "text-emerald-600" };

              // 진입가 vs 현재가 거리
              const entryVsCurrent = (cp && ep && cp > 0)
                ? ((ep - cp) / cp * 100).toFixed(1)
                : null;

              // 손절: 진입가 기준
              const slPct = (ep && sl && ep > 0)
                ? Math.abs((sl - ep) / ep * 100).toFixed(1)
                : null;

              return (
                <div className="px-4 sm:px-6 py-4">
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {/* 진입가 */}
                    <div className="rounded-xl border border-neutral-200 bg-white p-3 sm:p-4">
                      <div className="flex items-center gap-1 mb-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" />
                        <p className="text-[10px] sm:text-[11px] font-semibold text-neutral-500">진입가</p>
                      </div>
                      <p className="text-[13px] sm:text-[17px] font-bold text-neutral-900 font-mono leading-none break-all">{formatPrice(json.entry_price, priceCurrency)}</p>
                      {entryVsCurrent !== null ? (
                        <p className={`text-[10px] sm:text-[11px] font-bold mt-1 ${parseFloat(entryVsCurrent) < 0 ? "text-rose-500" : "text-emerald-600"}`}>
                          {parseFloat(entryVsCurrent) >= 0 ? "+" : ""}{entryVsCurrent}%
                        </p>
                      ) : (
                        <p className="text-[10px] text-neutral-400 mt-1 hidden sm:block">진입 목표 가격</p>
                      )}
                    </div>

                    {/* 적정주가 — 현재가 기준 upside/downside */}
                    <div className={`rounded-xl border ${targetCardStyle.border} ${targetCardStyle.bg} p-3 sm:p-4`}>
                      <div className="flex items-center gap-1 mb-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${targetCardStyle.dotColor} shrink-0`} />
                        <p className={`text-[10px] sm:text-[11px] font-semibold ${targetCardStyle.labelColor}`}>적정주가 <span className="font-normal opacity-70">(12개월)</span></p>
                      </div>
                      <p className={`text-[13px] sm:text-[17px] font-bold ${targetCardStyle.valColor} font-mono leading-none break-all`}>{formatPrice(json.target_price, priceCurrency)}</p>
                      {upsideFromCurrent !== null ? (
                        <p className={`text-[10px] sm:text-[11px] font-bold ${targetCardStyle.pctColor} mt-1`}>
                          {upsideFromCurrent >= 0 ? "+" : ""}{upsideFromCurrent.toFixed(1)}%
                        </p>
                      ) : (
                        <p className={`text-[10px] ${targetCardStyle.labelColor} mt-1 hidden sm:block`}>현재가 기준</p>
                      )}
                    </div>

                    {/* 손절가 — 진입가 기준 */}
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 sm:p-4">
                      <div className="flex items-center gap-1 mb-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        <p className="text-[10px] sm:text-[11px] font-semibold text-red-500">손절가</p>
                      </div>
                      <p className="text-[13px] sm:text-[17px] font-bold text-red-600 font-mono leading-none break-all">{formatPrice(json.stop_loss, priceCurrency)}</p>
                      {slPct !== null ? (
                        <p className="text-[10px] sm:text-[11px] font-bold text-red-500 mt-1">-{slPct}%</p>
                      ) : (
                        <p className="text-[10px] text-red-500 mt-1 hidden sm:block">손절 기준선</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── ④.5 핵심 밸류에이션 가정 (눈에 띄게) ── */}
            {json.key_assumptions && typeof json.key_assumptions === "object" && (() => {
              const KA = json.key_assumptions as Record<string, unknown>;
              const rows = [
                { label: "WACC",        key: "wacc",               icon: "%" },
                { label: "영구성장률",   key: "terminal_growth",    icon: "%" },
                { label: "단기 CAGR",   key: "revenue_cagr_short", icon: "" },
                { label: "장기 CAGR",   key: "revenue_cagr_long",  icon: "" },
                { label: "밸류에이션",  key: "valuation_model",    icon: "" },
                { label: "절대↔피어 괴리", key: "divergence_pct",  icon: "%" },
                { label: "조율 방법",   key: "weight_method",      icon: "" },
              ].filter(({ key }) => {
                const v = KA[key];
                if (v === null || v === undefined || v === "") return false;
                const s = String(v);
                return !s.includes("예:") && !s.includes("인용") && !s.includes("__");
              });
              if (rows.length === 0) return null;
              return (
                <div className="mx-4 sm:mx-6 my-2 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-blue-50/60 overflow-hidden">
                  {/* 헤더 */}
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-100/70 bg-indigo-50/80">
                    <div className="w-5 h-5 rounded-md bg-indigo-500 flex items-center justify-center shrink-0">
                      <span className="text-white text-[9px] font-bold">AI</span>
                    </div>
                    <p className="text-[11px] font-bold text-indigo-700 tracking-wide">핵심 밸류에이션 가정</p>
                    <span className="ml-auto text-[9px] text-indigo-400 font-medium">DCF 모델 핵심 드라이버</span>
                  </div>
                  {/* 가정값 그리드 */}
                  <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                    {rows.map(({ label, key }) => {
                      const val = String(KA[key]);
                      return (
                        <div key={key} className="flex flex-col gap-0.5">
                          <span className="text-[9px] font-semibold text-indigo-400 uppercase tracking-wider">{label}</span>
                          <span className="text-[14px] font-bold text-indigo-900 font-mono leading-tight">{val}</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* 안내 문구 */}
                  <div className="px-4 pb-2.5">
                    <p className="text-[10px] text-indigo-400 leading-relaxed">
                      위 가정값이 적정주가 산출의 핵심 변수입니다. 실제 수치가 달라지면 목표가도 변동됩니다.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* ── ⑤ 시나리오 카드 ── */}
            {json.scenarios?.length > 0 && (
              <div className="px-4 sm:px-6 py-4">
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">시나리오 분석</p>
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
                          "rounded-xl border p-3.5 flex items-center gap-4",
                          isBear ? "border-red-100 bg-red-50/50"
                            : isBull ? "border-emerald-100 bg-emerald-50/50"
                            : "border-blue-100 bg-blue-50/60"
                        )}
                      >
                        {/* 시나리오 이름 */}
                        <div className="w-20 shrink-0">
                          <span className={cn(
                            "text-xs font-bold",
                            isBear ? "text-red-500" : isBull ? "text-emerald-600" : "text-blue-600"
                          )}>
                            {isBear ? "▼ Bear" : isBull ? "▲ Bull" : "— Base"}
                          </span>
                          {isBase && <p className="text-[10px] text-blue-400 mt-0.5">기본 전망</p>}
                          {isBull && <p className="text-[10px] text-emerald-400 mt-0.5">낙관 전망</p>}
                          {isBear && <p className="text-[10px] text-red-400 mt-0.5">비관 전망</p>}
                        </div>

                        {/* 적정주가 + 등락률 */}
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            "text-sm font-bold font-mono",
                            isBear ? "text-red-700" : isBull ? "text-emerald-700" : "text-neutral-900"
                          )}>
                            {formatPrice(s.target_price, priceCurrency)}
                          </p>
                          <p className={cn(
                            "text-xs font-semibold mt-0.5",
                            uNum > 0 ? "text-emerald-600" : uNum < 0 ? "text-red-500" : "text-neutral-400"
                          )}>
                            {uDisplay}
                          </p>
                        </div>

                        {/* 확률 바 */}
                        <div className="w-20 shrink-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] text-neutral-400">확률</span>
                            <span className="text-[11px] font-bold text-neutral-700">{!isNaN(pNum) ? pNum + "%" : pStr}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-neutral-200 overflow-hidden">
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
                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">핵심 리스크</p>
                    <ul className="space-y-2">
                      {json.risks.map((r: string, i: number) => (
                        <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-neutral-600 leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {json.monitoring_indicators?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">모니터링 지표</p>
                    <ul className="space-y-2">
                      {json.monitoring_indicators.map((m: string, i: number) => (
                        <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-neutral-500 leading-relaxed">
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
      })() : (
        <div className="p-6 text-sm text-neutral-600 leading-relaxed space-y-2">
          {step.content.split('\n').map((p: string, i: number) => p.trim() ? <p key={i}>{p}</p> : null)}
        </div>
      )}
    </motion.div>
  );
}

const SLOW_STEP_MESSAGES: Record<string, string[]> = {
  company_intro: [
    "사업보고서 첫 페이지부터 뒤지는 중이에요 📄",
    "이 회사... 뭐 하는 곳인지 파악 중이에요 🤔",
    "IR 자료 정독 중... 광고 문구는 걸러야 해요",
    "창업 스토리 찾는 중이에요, 재미있는 게 있으면 알려드릴게요 😄",
    "기업 소개 거의 완성됐어요!",
  ],
  industry_analysis: [
    "업계 지도 그리는 중이에요 🗺️",
    "경쟁사 몰래 분석 중... (농담이에요 😅)",
    "시장 규모 계산기 두드리는 중이에요 🧮",
    "포터의 5가지 힘... 교수님 생각나네요",
    "이 산업, 꽤 복잡하네요. 정리하고 있어요",
    "거의 다 됐어요, 산업 구조 윤곽 잡혔어요!",
  ],
  catalyst_analysis: [
    "주가 흔들 만한 이슈 사냥 중이에요 🎯",
    "악재와 호재 저울질 중이에요 ⚖️",
    "뉴스 더미에서 진짜 재료 캐는 중이에요 🔍",
    "다음 분기 뭐가 터질지 예측 중이에요 🔮",
    "재료주인지 아닌지 판단하는 중이에요",
    "촉매 분석 마무리 검토 중이에요!",
  ],
  company_analysis: [
    "재무제표 3개년치 펼쳐놨어요 📊",
    "매출은 오르는데 이익이... 🤔 이유 찾는 중이에요",
    "영업CF가 순이익이랑 왜 다른지 파고드는 중이에요",
    "실적 드라이버가 뭔지 파헤치는 중이에요",
    "부채 많긴 한데 괜찮은지 확인 중이에요",
    "EPS·EBITDA 직접 계산해보는 중이에요 ✏️",
    "데이터가 많아서요, 조금만 더 기다려주세요 🙏",
    "거의 다 됐어요! 막바지 검토 중이에요",
  ],
  relative_valuation: [
    "DCF 스프레드시트 10년치 펼치는 중이에요 📈",
    "WACC 계산 중... 수식이 꽤 많네요",
    "피어 멀티플 수집 중이에요, 비싼지 싼지 봐야죠",
    "Terminal Value가 너무 크지 않나 확인 중이에요 😅",
    "Reverse DCF로 현재 주가 역산 중이에요",
    "절대가치 vs 상대가치, 어떻게 조율할지 고민 중이에요",
    "FCFF 수치 정합성 검증 중이에요... 빈틈 없이 할게요",
    "적정주가 두 개를 하나로 좁히는 마지막 단계예요 🎯",
  ],
  market_analysis: [
    "차트 펼쳐보는 중이에요 📉📈",
    "지지선이 어딘지 눈금자 대는 중이에요 📏",
    "지지·저항 구간 정밀하게 계산 중이에요",
    "외국인·기관 수급 흐름 추적 중이에요 🕵️",
    "이 가격대에서 사도 되는지 계산하는 중이에요 💭",
    "손절선 어디 둘지... 신중하게 정하는 중이에요",
    "진입 타점 거의 잡혔어요!",
  ],
  investment_strategy: [
    "6단계 분석 전부 머릿속에서 합치는 중이에요 🧠",
    "상승여력이 충분한지... 숫자가 답을 내려줄 거예요",
    "투자 논거 한 문장으로 압축 중이에요 ✍️",
    "리스크와 기회, 마지막으로 저울질 중이에요 ⚖️",
    "최종 적정주가 확정 중이에요... 거의 다 됐어요!",
    "보고서 마무리 검토 중이에요 📝",
  ],
};

function RotatingAnalysisMessage({ stepKey }: { stepKey: string }) {
  const messages = SLOW_STEP_MESSAGES[stepKey];
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

  if (!messages) return <span>분석 중...</span>;

  return (
    <span
      style={{ transition: "opacity 0.35s ease" }}
      className={visible ? "opacity-100" : "opacity-0"}
    >
      {messages[idx]}
    </span>
  );
}

const BRAND_BLUE = "#1d4ed8";
const BRAND_AMBER = "#d97706";

const AGENT_COLORS: Record<string, string> = {
  company_intro: BRAND_BLUE,
  industry_analysis: BRAND_BLUE,
  company_analysis: BRAND_BLUE,
  relative_valuation: BRAND_BLUE,
  market_analysis: BRAND_BLUE,
  catalyst_analysis: BRAND_AMBER,
  investment_strategy: BRAND_BLUE,
};

function StreamingCard({ stepKey, content, qcStatus, qcScore, qcFeedback }: {
  stepKey: string;
  content: string;
  qcStatus?: "checking" | "approved" | "revising" | "revised";
  qcScore?: number;
  qcFeedback?: string;
}) {
  const agent = AGENTS[stepKey];
  const color = AGENT_COLORS[stepKey] ?? "hsl(218, 67%, 44%)";
  if (!agent) return null;

  const isQCPhase = qcStatus === "checking" || qcStatus === "approved" || qcStatus === "revising" || qcStatus === "revised";
  const showCursor = !isQCPhase || qcStatus === "revising";

  const statusBadge = () => {
    if (qcStatus === "checking") return (
      <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
        <ShieldCheck className="w-3.5 h-3.5 animate-pulse" />
        <span>팀장 검토 중...</span>
      </div>
    );
    if (qcStatus === "approved") return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>검토 통과 {qcScore}/10</span>
      </div>
    );
    if (qcStatus === "revising") return (
      <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span>재분석 중... ({qcScore}/10)</span>
      </div>
    );
    if (qcStatus === "revised") return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>재분석 완료 {qcScore}/10</span>
      </div>
    );
    return null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden border-l-4"
      style={{ borderLeftColor: color }}
    >
      <div className="bg-muted/40 px-5 py-3.5 flex items-center gap-3 border-b border-border">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center border" style={{ background: `${color}15`, borderColor: `${color}30` }}>
          <agent.icon className="w-4.5 h-4.5" style={{ color }} />
        </div>
        <div className="flex-1">
          <h4 className="font-display font-semibold text-sm text-foreground leading-tight">{agent.role}</h4>
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">{agent.name}</span>
        </div>
        {statusBadge()}
      </div>

      {qcStatus === "checking" ? (
        <div className="p-5 flex items-center justify-center gap-3 text-sm text-muted-foreground py-8">
          <ShieldCheck className="w-5 h-5 text-amber-500 animate-pulse" />
          <span>Lead Portfolio Strategist가 분석 품질을 검토하고 있습니다...</span>
        </div>
      ) : (
        <div className="p-5">
          {qcStatus === "revising" && qcFeedback && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20 text-xs text-amber-700 flex items-start gap-2">
              <RefreshCw className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span><span className="font-semibold">팀장 피드백:</span> {qcFeedback}</span>
            </div>
          )}
          <div className="markdown-body" style={{ fontSize: "15px", lineHeight: "1.85", color: "#262626" }}>
            {!content && !isQCPhase ? (
              <span className="flex items-center gap-2 text-muted-foreground/50 select-none py-1">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                <RotatingAnalysisMessage stepKey={stepKey} />
              </span>
            ) : (
              <>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_TABLE_COMPONENTS}>
                  {prepareMarkdown(content)}
                </ReactMarkdown>
                {showCursor && (
                  <span className="inline-block w-0.5 h-[1em] bg-primary ml-0.5 animate-[pulse_0.8s_ease-in-out_infinite] align-middle" />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
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
    .replace(/\nCHART_DATA:\{[^\n]+\}\s*(\nEVENTS_DATA:\[[^\n]*\])?\s*$/, "")
    .replace(/\nEVENTS_DATA:\[[^\n]*\]\s*$/, "")
    .trim();
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
  abs_bear: number; abs_base: number; abs_bull: number;
  rel_bear: number; rel_base: number; rel_bull: number;
}

function parseFinalValuationData(content: string): FinalValuationData | null {
  const match = content.match(/FINAL_VALUATION_DATA:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as FinalValuationData;
    if (!parsed.base) return null;
    return parsed;
  } catch { return null; }
}

function stripFinalValuationData(content: string): string {
  return content.replace(/\nFINAL_VALUATION_DATA:\{[^\n]+\}\s*$/, "").trim();
}

function stripEstimationLabels(content: string): string {
  return content
    .replace(/\s*\(추정\)/g, "")
    .replace(/\s*\(추정치\)/g, "")
    .replace(/\s*\(E\)/g, "")
    .replace(/\s*\(F\)/g, "")
    .replace(/\s*\(컨센서스\)/g, "");
}

function StepCard({ step, agent: agentProp, delay, ticker, companyName }: { step: any, agent: AgentInfo | undefined, delay: number, ticker?: string, companyName?: string }) {
  const priceCurrency: "KRW" | "USD" = isUSTicker(ticker) ? "USD" : "KRW";
  const agent: AgentInfo = agentProp ?? {
    id: step.stepKey,
    name: step.agentName ?? "에이전트",
    role: step.agentRole ?? step.stepKey,
    icon: BrainCircuit,
    color: "text-primary",
    bgColor: "bg-primary/10",
    description: "",
  };

  if (step.stepKey === "investment_strategy") {
    return <InvestmentStrategyCard step={step} agent={agent} delay={delay} ticker={ticker} companyName={companyName} createdAt={step.createdAt} />;
  }

  const isMarket = step.stepKey === "market_analysis";
  const isFundamental = step.stepKey === "company_analysis";
  const isRelativeVal = step.stepKey === "relative_valuation";
  const chartLevels = isMarket ? parseChartLevels(step.content ?? "") : null;
  const chartEvents = isMarket ? parseChartEvents(step.content ?? "") : [];
  const valuationData = isFundamental ? parseValuationData(step.content ?? "") : null;
  const finalValuationData = isRelativeVal ? parseFinalValuationData(step.content ?? "") : null;
  const displayContent = stripEstimationLabels(
    isMarket
      ? stripChartData(step.content ?? "")
      : isFundamental
        ? stripValuationData(step.content ?? "")
        : isRelativeVal
          ? stripFinalValuationData(step.content ?? "")
          : (step.content ?? "")
  );

  const color = AGENT_COLORS[step.stepKey] ?? "hsl(218, 67%, 44%)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card border border-border rounded-xl overflow-hidden border-l-4"
      style={{ borderLeftColor: color }}
    >
      <div className="bg-muted/40 px-5 py-3.5 flex items-center gap-3 border-b border-border">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center border" style={{ background: `${color}15`, borderColor: `${color}30` }}>
          <agent.icon className="w-4.5 h-4.5" style={{ color }} />
        </div>
        <div>
          <h4 className="font-display font-semibold text-sm text-foreground leading-tight">{agent.role}</h4>
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">{agent.name}</span>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="markdown-body" style={{ fontSize: "14px", lineHeight: "1.8", color: "#262626" }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => (
                <h2 className="text-base font-bold text-foreground mt-6 mb-3 first:mt-0 pb-1.5 border-b border-border/60">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-semibold text-foreground mt-5 mb-2 flex items-center gap-1.5">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="text-[13px] font-semibold text-foreground/80 mt-3 mb-1.5">{children}</h4>
              ),
              p: ({ children }) => {
                const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
                if (text.startsWith("출처:") || text.startsWith("출처 :")) {
                  return <p className="mt-5 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">{children}</p>;
                }
                return <p className="mb-5 sm:mb-4 last:mb-0 text-foreground/80 leading-[1.9] sm:leading-[1.8]">{children}</p>;
              },
              ul: ({ children }) => <ul>{children}</ul>,
              ol: ({ children }) => <ol>{children}</ol>,
              li: ({ children }) => <li>{children}</li>,
              strong: ({ children }) => (
                <strong>{children}</strong>
              ),
              em: ({ children }) => <em className="text-foreground/70 not-italic">{children}</em>,
              blockquote: ({ children }) => (
                <blockquote className="my-3 pl-3 border-l-2 border-border text-foreground/60 text-[13px] italic">
                  {children}
                </blockquote>
              ),
              hr: () => <hr className="my-4 border-border/60" />,
              ...MD_TABLE_COMPONENTS,
            }}
          >
            {prepareMarkdown(displayContent)}
          </ReactMarkdown>
        </div>

        {/* 기술적 분석: 주가 차트 (지지/저항·진입·목표·이벤트 포함) */}
        {isMarket && ticker && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ background: color }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">주가 차트</span>
              {chartLevels && Object.values(chartLevels).some(v => v && v > 0) && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
                  진입·목표·손절 레벨 포함
                </span>
              )}
              {chartEvents.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-violet-50 text-violet-600 border border-violet-200">
                  핵심 이슈 {chartEvents.length}건
                </span>
              )}
            </div>
            <StockChart
              ticker={ticker}
              companyName={companyName}
              chartLevels={chartLevels ?? undefined}
              events={chartEvents}
            />
          </div>
        )}

        {/* Valuation B 최종 조율 적정주가 요약 박스 */}
        {isRelativeVal && finalValuationData && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ background: color }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">최종 조율 적정주가</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>절대가치 × 상대가치 조율</span>
            </div>
            <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[300px] text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="px-3 py-2.5 text-left font-semibold text-foreground/80 border-b border-border">구분</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-rose-600 border-b border-border">하단 밴드</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-emerald-600 border-b border-border">적정주가</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-blue-600 border-b border-border">상단 밴드</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">절대가치(DCF)</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(finalValuationData.abs_bear, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono">{formatPrice(finalValuationData.abs_base, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(finalValuationData.abs_bull, priceCurrency)}</td>
                  </tr>
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">상대가치(피어)</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(finalValuationData.rel_bear, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono">{formatPrice(finalValuationData.rel_base, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(finalValuationData.rel_bull, priceCurrency)}</td>
                  </tr>
                  <tr className="bg-muted/20 font-semibold">
                    <td className="px-3 py-2.5 font-bold text-foreground">조율 적정주가</td>
                    <td className="px-3 py-2.5 text-right text-rose-600 font-mono font-bold">{formatPrice(finalValuationData.bear, priceCurrency)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600 font-mono font-bold">{formatPrice(finalValuationData.base, priceCurrency)}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 font-mono font-bold">{formatPrice(finalValuationData.bull, priceCurrency)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="bg-muted/40 px-4 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border sm:flex sm:items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">현재 주가</span>
                <span className="font-mono text-sm font-semibold text-foreground text-right sm:text-left">{formatPrice(finalValuationData.current, priceCurrency)}</span>
                <span className="text-xs text-muted-foreground">
                  {finalValuationData.base >= finalValuationData.current ? "상승여력" : "하락여지"}
                </span>
                <span className={`font-mono text-sm font-bold text-right sm:text-left ${finalValuationData.base > finalValuationData.current ? "text-emerald-600" : "text-rose-600"}`}>
                  {finalValuationData.current > 0 ? `${((finalValuationData.base - finalValuationData.current) / finalValuationData.current * 100).toFixed(1)}%` : "-"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Fundamental & Valuation 적정주가 요약 박스 */}
        {isFundamental && valuationData && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ background: color }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">밸류에이션 적정주가</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">3-Method 종합</span>
            </div>
            <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[300px] text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="px-3 py-2.5 text-left font-semibold text-foreground/80 border-b border-border">방법론</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-rose-600 border-b border-border">Bear</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-emerald-600 border-b border-border">Base</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-blue-600 border-b border-border">Bull</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">DCF</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(valuationData.dcf_bear, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono font-semibold">{formatPrice(valuationData.dcf_base, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(valuationData.dcf_bull, priceCurrency)}</td>
                  </tr>
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">Forward P/E</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(valuationData.pe_bear, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono font-semibold">{formatPrice(valuationData.pe_base, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(valuationData.pe_bull, priceCurrency)}</td>
                  </tr>
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">EV/EBITDA</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(valuationData.ev_bear, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono font-semibold">{formatPrice(valuationData.ev_base, priceCurrency)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(valuationData.ev_bull, priceCurrency)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="bg-muted/40 px-4 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border sm:flex sm:items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">현재 주가</span>
                <span className="font-mono text-sm font-semibold text-foreground text-right sm:text-left">{formatPrice(valuationData.current, priceCurrency)}</span>
                <span className="text-xs text-muted-foreground">
                  Base {valuationData.dcf_base >= valuationData.current ? "상승여력" : "하락여지"}
                </span>
                <span className={`font-mono text-sm font-bold text-right sm:text-left ${valuationData.dcf_base > valuationData.current ? "text-emerald-600" : "text-rose-600"}`}>
                  {valuationData.current > 0 ? `${((valuationData.dcf_base - valuationData.current) / valuationData.current * 100).toFixed(1)}%` : "-"}
                </span>
              </div>
            </div>
          </div>
        )}

      </div>
    </motion.div>
  );
}
