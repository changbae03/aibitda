import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
  AreaChart, Area,
} from "recharts";
import {
  Search, TrendingUp, TrendingDown, Loader2, RefreshCw,
  BarChart3, Zap, LayoutGrid, ChevronRight, Info,
  Building2, Globe, ArrowUpDown, Brain, Sparkles,
  Flame, Target, Activity, X, ChevronDown,
  Package, DollarSign, Landmark, ExternalLink,
  Plus, Minus, ArrowUp, ArrowDown, GitCommitHorizontal,
  BarChart2, Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { MacroDashboardPanel } from "@/pages/macro-dashboard";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface ETFInfo {
  code: string; isuCd: string; name: string; sector: string;
  issuer: string; yahooCode: string; leverage: number; ter?: number; benchmark?: string;
}
interface ETFHolding {
  rank: number; stockCode: string; stockName: string; weight: number;
  ownershipPct?: number; valueBillion?: number;
  reportDate?: string; shares?: number; sharesChange?: number;
}
interface HoldingChangeItem {
  stockCode: string; stockName: string; weight: number;
  weightDelta?: number; prevWeight?: number; prevRank?: number; rank?: number;
}
interface HoldingsChanges {
  added: HoldingChangeItem[];
  removed: HoldingChangeItem[];
  increased: HoldingChangeItem[];
  decreased: HoldingChangeItem[];
  previousDate: string;
  currentDate: string;
}
interface SectorScore {
  sector: string; score: number; return5d: number; return20d: number;
  signal: string; etfCode: string; etfName: string; price?: number; change1d?: number;
}
interface TimingSignal {
  code: string; name: string; price: number; change1d: number;
  return5d: number; return20d: number; ma5: number; ma20: number;
  rsi14: number; signal: string; signalScore: number; reason: string;
}
interface UnifiedSignal {
  code: string; name: string; sector: string; issuer: string; leverage: number;
  price: number; change1d: number; return5d: number; return20d: number;
  rsi14: number; ma5: number; ma20: number;
  techScore: number; sectorRank: number; aiScore: number; aiBonus: number;
  combinedScore: number; signal: string;
  aiDirection: "up" | "down" | "neutral"; aiStrength: number; reason: string;
}
interface AiContext {
  kospi: { direction: "up" | "down" | "neutral"; strength: number };
  nasdaq: { direction: "up" | "down" | "neutral"; strength: number };
  ready: boolean;
}
interface MacroSnapshot {
  krRate: number; usRate: number; krCpi: number; usCpi: number;
  krwUsd: number; wti: number; gdpQoQ: number; yieldSpread: number;
}
interface MacroEnvironment {
  rateLevel: "high" | "moderate" | "low";
  inflation: "elevated" | "moderate" | "low";
  fxKrw: "weak" | "neutral" | "strong";
  growth: "strong" | "moderate" | "weak";
  oilPrice: "high" | "moderate" | "low";
  theme: string;
}
interface SectorMomentum {
  id: string; name: string; icon: string; score: number;
  outlook: "bullish" | "neutral" | "cautious"; horizon: string;
  reason: string; catalysts: string[]; risks: string[]; sectorTags: string[];
}
interface MarketSignal {
  id: string;
  category: "수급" | "심리" | "기술적" | "매크로" | "테마";
  label: string; description: string;
  impact: "positive" | "negative" | "neutral";
  strength: "strong" | "moderate" | "weak";
  icon: string;
  sectorTags: string[];
}
interface ThemeKeyword {
  label: string; description: string;
  sentiment: "hot" | "warm" | "cool";
  relatedSectors: string[];
}
interface InstitutionalFlow {
  sector: string;
  direction: "in" | "out" | "watch";
  reason: string;
  strength: number;
}
interface MarketPulse {
  fearGreedScore: number; fearGreedLabel: string;
  overallSentiment: "bullish" | "neutral" | "bearish";
  signals: MarketSignal[];
  themes: ThemeKeyword[];
  institutionalFocus: string[];
  institutionalFlow: InstitutionalFlow[];
  retailWarning: string[];
  marketNarrative: string;
}
interface IndexOutlook {
  name: string;
  symbol: string;
  trend: string;
  predictedReturn3d: number | null;
  agreementSignal: "up" | "down" | "neutral";
  agreementStrength: number;
  curVol20: number | null;
  wfDirAcc: number | null;
  gbdtDirAcc: number | null;
  latestPrice: number | null;
  change1d: number | null;
  sparkline: number[];
}
interface MomentumAnalysis {
  macro: MacroSnapshot;
  environment: MacroEnvironment;
  nowSectors: SectorMomentum[];
  futureSectors: SectorMomentum[];
  marketPulse: MarketPulse;
  updatedAt: number;
  indexOutlook?: {
    kospi: IndexOutlook;
    kosdaq: IndexOutlook;
    ready: boolean;
  };
}

// ─── 거시 대시보드 타입 ──────────────────────────────────────────────────────
interface DashMarketItem {
  id: string; cat: string;
  name: string; nameEn: string;
  symbol: string; unit: string; flag: string;
  value: number | null; change1d: number | null; prevClose: number | null;
}
interface DashCategory {
  id: string; name: string; nameEn: string; icon: string;
  items: DashMarketItem[];
}
interface ETFReco { ticker: string; name: string; reason: string; }
interface MacroInsight {
  theme: string; themeEn: string; description: string;
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  krETFs?: ETFReco[];
  usETFs?: ETFReco[];
}
interface DashData {
  categories: DashCategory[];
  narrative: string;
  insights: MacroInsight[];
  generatedAt: number;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const SIGNAL_CONFIG = {
  strong_buy:  { label: "강력 매수", color: "#16a34a", bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-500" },
  buy:         { label: "매수",     color: "#22c55e", bg: "bg-green-500/10",    border: "border-green-500/25",   text: "text-green-500"  },
  hold:        { label: "관망",     color: "#94a3b8", bg: "bg-slate-500/10",    border: "border-slate-500/20",   text: "text-slate-400"  },
  sell:        { label: "매도",     color: "#ef4444", bg: "bg-red-500/10",      border: "border-red-500/25",     text: "text-red-400"    },
  strong_sell: { label: "강력 매도", color: "#dc2626", bg: "bg-red-500/15",     border: "border-red-500/30",     text: "text-red-500"    },
};

const PIE_COLORS = ["#FF8A7A","#3b82f6","#22c55e","#f59e0b","#8b5cf6","#06b6d4","#f97316","#10b981","#6366f1","#ec4899","#84cc16","#14b8a6"];

const SECTOR_COLORS: Record<string, string> = {
  "국내주식":   "#3b82f6", "코스닥":     "#8b5cf6", "반도체":    "#f59e0b",
  "2차전지":    "#22c55e", "헬스케어":   "#ec4899", "금융":      "#06b6d4",
  "IT":         "#f97316", "해외주식":   "#6366f1", "배당":      "#10b981",
  "원자재":     "#d97706", "미국시장":   "#64748b", "미국나스닥":"#7c3aed",
  "미국반도체": "#f59e0b", "미국헬스케어":"#db2777","미국금융":  "#0891b2",
  "미국에너지": "#b45309", "미국혁신":   "#9333ea", "한국시장":  "#1d4ed8",
  "신흥국":     "#15803d", "항공우주방산":"#1e40af","로보틱스AI":"#0f766e",
  "사이버보안": "#7c3aed", "양자컴퓨팅": "#6d28d9", "클린에너지":"#16a34a",
  "리츠":       "#b45309",
  "기관투자자": "#7c3aed",
};

// ─── 유틸 컴포넌트 ────────────────────────────────────────────────────────────

function Pct({ v, bold }: { v: number; bold?: boolean }) {
  const up = v >= 0;
  return (
    <span className={cn(
      bold ? "font-bold" : "font-medium",
      up ? "text-red-500" : "text-blue-500",
    )}>
      {up ? "+" : ""}{v.toFixed(2)}%
    </span>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  const cfg = SIGNAL_CONFIG[signal as keyof typeof SIGNAL_CONFIG] ?? SIGNAL_CONFIG.hold;
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border",
      cfg.bg, cfg.border, cfg.text,
    )}>
      {cfg.label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "#16a34a" : score >= 55 ? "#22c55e" : score >= 40 ? "#94a3b8" : score >= 25 ? "#f97316" : "#dc2626";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold w-6 text-right" style={{ color }}>{score}</span>
    </div>
  );
}

function LeverageBadge({ lev }: { lev: number }) {
  if (lev === 1) return null;
  if (lev < 0) {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-blue-500/10 border-blue-500/30 text-blue-500">
        인버스
      </span>
    );
  }
  return (
    <span className={cn(
      "text-[10px] font-bold px-1.5 py-0.5 rounded border",
      lev >= 3
        ? "bg-red-500/10 border-red-500/30 text-red-500"
        : "bg-orange-500/10 border-orange-500/30 text-orange-500",
    )}>
      {lev}×
    </span>
  );
}

/** 펼치고 접는 개념 설명 박스 */
function HelpTip({ label = "💡 이게 뭔가요?", children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition-colors font-medium"
      >
        <span>{label}</span>
        <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 rounded-xl bg-primary/5 border border-primary/15 px-4 py-3 text-[12px] text-muted-foreground leading-relaxed space-y-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

/** ETF 섹터별 한 줄 해설 */
function etfDescription(etf: ETFInfo): string {
  const leverageNote = etf.leverage === 2
    ? " ⚠️ 2배 레버리지 상품으로, 수익과 손실 모두 2배로 증폭됩니다."
    : etf.leverage === -1
    ? " ⚠️ 인버스 상품으로, 지수가 하락할 때 수익이 납니다."
    : "";
  const base: Record<string, string> = {
    "국내주식":    "코스피200 대형주 전반에 분산 투자하는 ETF입니다. 한국 경제 전체에 베팅하는 가장 기본적인 선택으로, 시장 전반이 오를 때 수익을 냅니다.",
    "코스닥":      "코스닥 중소·성장주 중심 ETF입니다. 변동성이 높지만 성장 잠재력도 큰 기업들로 구성되어, 위험을 감수할 수 있는 투자자에게 적합합니다.",
    "반도체":      "삼성전자·SK하이닉스 등 반도체 기업에 집중 투자합니다. AI·데이터센터 수요와 글로벌 반도체 경기 사이클에 민감하게 반응합니다.",
    "2차전지":     "배터리 셀·소재·장비 기업들로 구성됩니다. 전기차(EV) 전환 속도, 리튬 등 핵심 광물 가격에 따라 크게 움직입니다.",
    "헬스케어":    "바이오·제약·의료기기 기업들을 담습니다. 임상 결과 발표, 신약 허가 여부에 따라 급등락이 잦은 고위험·고수익 섹터입니다.",
    "금융":        "은행·보험·증권주 중심 ETF입니다. 기준금리 방향에 가장 민감한 섹터로, 금리가 오를수록 수혜를 받는 경향이 있습니다.",
    "IT":          "소프트웨어·IT서비스·게임 기업들을 포함합니다. 플랫폼·디지털 전환 테마와 함께 움직이며, 기술주 심리에 영향을 받습니다.",
    "해외주식":    "미국 S&P500 등 글로벌 우량 기업에 투자합니다. 달러 강약에 따른 환율 효과도 함께 반영됩니다.",
    "배당":        "고배당 우량주 중심으로 안정적인 현금흐름을 추구합니다. 변동성이 낮아 보수적인 투자자나 인컴 전략에 적합합니다.",
    "원자재":      "금·원유·농산물 선물 가격을 추종합니다. 인플레이션 헷지나 포트폴리오 분산 목적으로 활용됩니다.",
    "미국시장":    "S&P 500 대형주 500종목을 추종하는 미국 대표 ETF입니다. 미국 경제 전반에 분산 투자하는 가장 기본적인 선택입니다.",
    "미국나스닥":  "나스닥 100 기술·성장주에 집중 투자합니다. Apple·Microsoft·NVIDIA 등 빅테크 비중이 높아 AI·반도체 테마와 동조화됩니다.",
    "미국반도체":  "NVIDIA·AMD·TSMC 등 글로벌 반도체 기업에 집중 투자합니다. AI 인프라 수요와 글로벌 반도체 사이클을 직접 반영합니다.",
    "미국헬스케어":"미국 제약·바이오·의료기기 기업들로 구성됩니다. 고령화·신약 개발 테마와 함께 움직이며 달러 강세에도 방어적입니다.",
    "미국금융":    "미국 은행·보험·자산운용사 중심 ETF입니다. 미국 기준금리 방향에 민감하게 반응합니다.",
    "미국에너지":  "미국 석유·가스·에너지 기업들을 담습니다. 유가 및 천연가스 가격 방향에 따라 크게 움직입니다.",
    "미국혁신":    "파괴적 혁신 기업에 집중 투자하는 액티브 ETF입니다. AI·로봇·게놈 등 미래 테마에 집중되어 변동성이 매우 높습니다.",
    "한국시장":    "미국 상장 한국 대표 기업에 투자하는 ETF입니다. 달러 기준으로 한국 증시에 투자하는 효과를 냅니다.",
    "신흥국":      "신흥국 우량 기업 전반에 분산 투자합니다. 중국·인도·브라질 등 고성장 국가의 경제 성장을 함께 누릴 수 있습니다.",
    "항공우주방산":"방위산업·항공우주·위성 기업들로 구성됩니다. 지정학적 긴장 고조, 글로벌 방위비 증가, 우주 경제 확대 테마와 함께 움직입니다.",
    "로보틱스AI":  "산업용 로봇·AI 소프트웨어·자동화 기업들을 담습니다. 제조업 자동화 사이클과 AI 수익화 속도에 민감하게 반응합니다.",
    "사이버보안":  "기업·정부 사이버 보안 전문 기업들로 구성됩니다. 클라우드·AI 확산과 함께 구조적으로 성장하며, 경기 방어적 특성이 있습니다.",
    "양자컴퓨팅":  "양자컴퓨터·머신러닝 인프라 기업에 투자합니다. 장기 성장 잠재력이 크지만 수익화 초기 단계로 변동성이 매우 높습니다.",
    "클린에너지":  "태양광·풍력·수소 등 재생에너지 기업들을 담습니다. 금리 환경과 정책 보조금에 민감하며, 장기 탄소 중립 트렌드를 반영합니다.",
    "리츠":        "부동산 임대 수익을 배분하는 리츠(REITs) ETF입니다. 금리 방향에 가장 민감하며, 데이터센터·물류창고 리츠는 AI 수요와 연동됩니다.",
  "기관투자자":  "한국 최대 기관투자자 국민연금공단의 국내주식 포트폴리오입니다. 국민연금이 5% 이상 지분을 보유한 기업의 주가에 큰 영향력을 행사하며, 포트폴리오 변화는 시장의 중요한 수급 신호로 해석됩니다.",
  };
  return (base[etf.sector] ?? "다양한 자산에 분산 투자하는 ETF입니다.") + leverageNote;
}

/** 보유 종목 집중도 해설 */
function holdingConcentration(holdings: ETFHolding[]): { text: string; level: "high" | "mid" | "low" } {
  const top3 = holdings.slice(0, 3).reduce((s, h) => s + h.weight, 0);
  if (top3 > 65) return {
    level: "high",
    text: `상위 3개 종목이 전체의 ${top3.toFixed(0)}%를 차지하는 고집중형 ETF입니다. 특정 종목의 주가 변동이 ETF 성과에 크게 영향을 줍니다.`,
  };
  if (top3 > 45) return {
    level: "mid",
    text: `상위 3개 종목 비중이 ${top3.toFixed(0)}%로, 핵심 종목에 어느 정도 집중된 구조입니다. 개별 종목 리스크와 분산 효과가 공존합니다.`,
  };
  return {
    level: "low",
    text: `상위 3개 종목 비중이 ${top3.toFixed(0)}%로, 비교적 균형 있게 분산된 포트폴리오입니다. 단일 종목 리스크가 낮습니다.`,
  };
}

// ─── 탭 1: 검색 ───────────────────────────────────────────────────────────────

interface StockSuggestion { symbol: string; shortname: string; englishName?: string; exchange: string; quoteType: string; }

function SearchTab() {
  const [mode, setMode]           = useState<"etf" | "stock">("etf");
  const [query, setQuery]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [etfResult, setEtfResult] = useState<{ etf: ETFInfo | null; holdings: ETFHolding[]; source?: string; dataDate?: string; changes?: HoldingsChanges | null } | null>(null);
  const [stockResult, setStockResult] = useState<{ etf: ETFInfo; holding: ETFHolding }[] | null>(null);
  const [searchList, setSearchList]   = useState<ETFInfo[]>([]);
  const [showList, setShowList]       = useState(false);
  const [allEtfs, setAllEtfs]         = useState<ETFInfo[]>([]);
  const [stockSuggestions, setStockSuggestions] = useState<StockSuggestion[]>([]);
  const [showStockDrop, setShowStockDrop]       = useState(false);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [aiReport, setAiReport]       = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const stockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(getApiUrl("/api/etf/list"), { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => setAllEtfs(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const fetchStockSuggestions = useCallback(async (q: string) => {
    if (!q.trim()) { setStockSuggestions([]); setShowStockDrop(false); return; }
    setIsFetchingSuggestions(true);
    try {
      const res = await fetch(getApiUrl(`/api/market-data/search/${encodeURIComponent(q.trim())}`));
      if (res.ok) {
        const data: StockSuggestion[] = await res.json();
        setStockSuggestions(data.slice(0, 8));
        setShowStockDrop(data.length > 0);
      }
    } catch {
      setStockSuggestions([]);
    } finally {
      setIsFetchingSuggestions(false);
    }
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setShowList(false);
    setShowStockDrop(false);
    setAiReport(null);
    setReportError(null);
    try {
      if (mode === "etf") {
        const r = await fetch(getApiUrl(`/api/etf/${encodeURIComponent(q.trim())}/holdings`), { credentials: "include" });
        if (r.ok) setEtfResult(await r.json());
      } else {
        const r = await fetch(getApiUrl(`/api/etf/stock/${encodeURIComponent(q.trim())}/exposure`), { credentials: "include" });
        if (r.ok) setStockResult(await r.json());
      }
    } finally {
      setLoading(false);
    }
  }, [mode]);

  const onInput = (v: string) => {
    setQuery(v);
    if (mode === "etf") {
      if (v.trim()) {
        const vl = v.toLowerCase();
        const filtered = allEtfs.filter(e =>
          e.name.toLowerCase().includes(vl) ||
          e.code.toLowerCase().includes(vl) ||
          (e.sector && e.sector.toLowerCase().includes(vl)) ||
          (e.benchmark && e.benchmark.toLowerCase().includes(vl)) ||
          (e.issuer && e.issuer.toLowerCase().includes(vl))
        );
        setSearchList(filtered.slice(0, 8));
        setShowList(true);
      } else {
        setShowList(false);
      }
    } else {
      if (stockTimerRef.current) clearTimeout(stockTimerRef.current);
      const delay = /^\d{2,}$/.test(v.trim()) ? 150 : 350;
      stockTimerRef.current = setTimeout(() => fetchStockSuggestions(v), delay);
    }
  };

  return (
    <div className="space-y-5">
      {/* 모드 토글 */}
      <div className="flex gap-1 p-1 rounded-2xl bg-muted/30 border border-border">
        {(["etf","stock"] as const).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); setQuery(""); setEtfResult(null); setStockResult(null); setShowList(false); setShowStockDrop(false); setStockSuggestions([]); }}
            className={cn(
              "flex-1 flex flex-col items-center py-2.5 px-2 rounded-xl text-xs font-semibold transition-all",
              mode === m
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="font-bold">{m === "etf" ? "ETF 검색" : "종목 검색"}</span>
            <span className={cn("text-[10px] mt-0.5 font-normal", mode === m ? "text-muted-foreground/60" : "text-muted-foreground/40")}>
              {m === "etf" ? "→ 구성 종목 분석" : "→ ETF 편입 현황"}
            </span>
          </button>
        ))}
      </div>

      {/* 검색창 */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <input
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder={mode === "etf" ? "069500, KODEX 200, 반도체..." : "005930, 삼성전자, SK하이닉스..."}
              value={query}
              onChange={e => onInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch(query)}
              onBlur={() => { setTimeout(() => { setShowList(false); setShowStockDrop(false); }, 150); }}
            />
            {/* ETF 자동완성 드롭다운 */}
            {showList && searchList.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-card border border-border rounded-xl shadow-xl z-20 overflow-hidden">
                {searchList.map(etf => (
                  <button
                    key={etf.code}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 text-left transition-colors"
                    onMouseDown={() => { setQuery(etf.code); setShowList(false); handleSearch(etf.code); }}
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{etf.name}</p>
                      <p className="text-[11px] text-muted-foreground">{etf.code} · {etf.issuer}</p>
                    </div>
                    <LeverageBadge lev={etf.leverage} />
                  </button>
                ))}
              </div>
            )}
            {/* 종목 자동완성 드롭다운 */}
            {showStockDrop && stockSuggestions.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-card border border-border rounded-xl shadow-xl z-20 overflow-hidden">
                {isFetchingSuggestions && (
                  <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground border-b border-border/50">
                    <Loader2 className="w-3 h-3 animate-spin" /> 검색 중...
                  </div>
                )}
                {stockSuggestions.map(s => {
                  const displayName = s.shortname || s.symbol;
                  const isKR = /^\d{6}(\.KS|\.KQ)?$/.test(s.symbol);
                  const code = isKR ? s.symbol.replace(/\.(KS|KQ)$/, "") : s.symbol;
                  return (
                    <button
                      key={s.symbol}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 text-left transition-colors"
                      onMouseDown={() => { setQuery(code); setShowStockDrop(false); handleSearch(code); }}
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{displayName}</p>
                        <p className="text-[11px] text-muted-foreground">{code} · {s.exchange}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground/50 bg-muted/40 px-1.5 py-0.5 rounded font-mono">
                        {s.quoteType === "EQUITY" ? "주식" : s.quoteType === "ETF" ? "ETF" : s.quoteType}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            onClick={() => handleSearch(query)}
            disabled={loading || !query.trim()}
            className="px-5 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 transition-all hover:opacity-90"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "검색"}
          </button>
        </div>
      </div>

      {/* 인기 ETF 바로가기 — 검색 결과 없을 때만 표시 */}
      {!etfResult && !stockResult && (
        <div className="space-y-4">
          {mode === "etf" && (() => {
            const POPULAR: { label: string; items: { code: string; name: string }[] }[] = [
              {
                label: "국내 대표",
                items: [
                  { code: "069500", name: "KODEX 200" },
                  { code: "229200", name: "코스닥150" },
                  { code: "139270", name: "ACE 국고채10년" },
                  { code: "102110", name: "TIGER KOSPI" },
                ],
              },
              {
                label: "반도체·AI",
                items: [
                  { code: "091160", name: "KODEX 반도체" },
                  { code: "395160", name: "AI반도체TOP2+" },
                  { code: "381180", name: "TIGER 반도체" },
                  { code: "SOXX",   name: "SOXX" },
                  { code: "SMH",    name: "SMH" },
                ],
              },
              {
                label: "2차전지·헬스케어",
                items: [
                  { code: "305720", name: "KODEX 2차전지" },
                  { code: "305540", name: "TIGER 2차전지" },
                  { code: "266420", name: "KODEX 헬스케어" },
                ],
              },
              {
                label: "미국 시장",
                items: [
                  { code: "SPY",  name: "SPY S&P500" },
                  { code: "QQQ",  name: "QQQ 나스닥100" },
                  { code: "IWM",  name: "IWM 러셀2000" },
                  { code: "XLF",  name: "XLF 금융" },
                  { code: "ITA",  name: "ITA 방산" },
                ],
              },
              {
                label: "기관투자자",
                items: [
                  { code: "NPS",    name: "국민연금 국내주식" },
                  { code: "NPSINT", name: "국민연금 해외주식" },
                ],
              },
            ];
            return (
              <div className="space-y-3">
                <p className="text-[11px] font-semibold text-muted-foreground/40 uppercase tracking-widest">인기 ETF</p>
                {POPULAR.map(group => (
                  <div key={group.label}>
                    <p className="text-[10px] text-muted-foreground/30 mb-1.5 px-0.5">{group.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map(item => (
                        <button
                          key={item.code}
                          onClick={() => { setQuery(item.code); handleSearch(item.code); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-all text-left"
                        >
                          <span className="text-[12px] font-medium text-foreground">{item.name}</span>
                          <span className="text-[10px] text-muted-foreground/40 font-mono">{item.code}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
          {mode === "stock" && (() => {
            const POPULAR_STOCKS = [
              { code: "005930", name: "삼성전자" },
              { code: "000660", name: "SK하이닉스" },
              { code: "035420", name: "NAVER" },
              { code: "051910", name: "LG화학" },
              { code: "373220", name: "LG에너지솔루션" },
              { code: "NVDA",   name: "NVIDIA" },
              { code: "TSLA",   name: "Tesla" },
              { code: "MSFT",   name: "Microsoft" },
              { code: "AAPL",   name: "Apple" },
              { code: "META",   name: "Meta" },
            ];
            return (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground/40 uppercase tracking-widest">인기 종목</p>
                <div className="flex flex-wrap gap-1.5">
                  {POPULAR_STOCKS.map(s => (
                    <button
                      key={s.code}
                      onClick={() => { setQuery(s.code); handleSearch(s.code); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-all"
                    >
                      <span className="text-[12px] font-medium text-foreground">{s.name}</span>
                      <span className="text-[10px] text-muted-foreground/40 font-mono">{s.code}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ETF 결과: 구성 종목 */}
      {mode === "etf" && etfResult && (
        <div className="space-y-4">
          {etfResult.etf && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  {/* 섹터 컬러 표시 */}
                  <div
                    className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                    style={{ background: SECTOR_COLORS[etfResult.etf.sector] ?? "#94a3b8" }}
                  />
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-foreground">{etfResult.etf.name}</h2>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[11px] text-muted-foreground/50">{etfResult.etf.code}</span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="text-[11px] text-muted-foreground/50">{etfResult.etf.issuer}</span>
                      {etfResult.etf.benchmark && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="text-[11px] text-muted-foreground/40 truncate max-w-[180px]">{etfResult.etf.benchmark}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full border"
                    style={{
                      background: `${SECTOR_COLORS[etfResult.etf.sector] ?? "#94a3b8"}18`,
                      borderColor: `${SECTOR_COLORS[etfResult.etf.sector] ?? "#94a3b8"}40`,
                      color: SECTOR_COLORS[etfResult.etf.sector] ?? "#94a3b8",
                    }}
                  >
                    {etfResult.etf.sector}
                  </span>
                  <LeverageBadge lev={etfResult.etf.leverage} />
                  {etfResult.etf.ter != null && (
                    <span className="text-[11px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full border border-border">
                      보수 {etfResult.etf.ter}%
                    </span>
                  )}
                </div>
              </div>
              {/* ETF 해설 */}
              <p className="text-[12px] text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
                {etfDescription(etfResult.etf)}
              </p>
              {/* 총보수 해설 */}
              {etfResult.etf.ter != null && (
                <p className="text-[11px] text-muted-foreground/55 bg-muted/20 rounded-lg px-3 py-2 border border-border/50">
                  💰 연간 총보수 {etfResult.etf.ter}% — 보유 기간 동안 자동으로 차감되는 운용 비용입니다. 낮을수록 유리합니다.
                </p>
              )}
            </div>
          )}

          {etfResult.holdings.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 도넛 차트 */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-3">구성 비중</p>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={[
                        ...etfResult.holdings.slice(0, 9),
                        etfResult.holdings.length > 9
                          ? { stockName: "기타", weight: 100 - etfResult.holdings.slice(0, 9).reduce((s, h) => s + h.weight, 0) }
                          : null,
                      ].filter(Boolean) as any}
                      dataKey="weight" nameKey="stockName"
                      cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                      paddingAngle={2}
                    >
                      {etfResult.holdings.slice(0, 10).map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => `${Number(v).toFixed(2)}%`} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* 테이블 */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest">Top {etfResult.holdings.length} 보유 종목</p>
                  {etfResult.source === "reference" ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 font-semibold">참고용 데이터</span>
                  ) : null}
                </div>
                <div className="divide-y divide-border/50">
                  {etfResult.holdings.map(h => {
                    const isNpsDart = etfResult.source === "nps-dart";
                    return (
                    <div key={h.rank} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-muted-foreground/40 w-4 text-right">{h.rank}</span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{h.stockName}</p>
                          <div className="flex items-center gap-1.5">
                            {h.stockCode && <p className="text-[11px] text-muted-foreground/50">{h.stockCode}</p>}
                            {isNpsDart && h.reportDate && (
                              <>
                                <span className="text-muted-foreground/20">·</span>
                                <p className="text-[11px] text-muted-foreground/40">
                                  {h.reportDate.replace(/-/g, ".")}
                                </p>
                              </>
                            )}
                            {!isNpsDart && h.ownershipPct != null && h.ownershipPct > 0 && (
                              <>
                                {h.stockCode && <span className="text-muted-foreground/20">·</span>}
                                <p className="text-[11px] text-violet-500/70">지분 {h.ownershipPct.toFixed(2)}%</p>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {isNpsDart ? (
                          <div className="flex items-center gap-2">
                            {h.sharesChange != null && h.sharesChange !== 0 && (
                              <span className={`text-[10px] font-semibold ${h.sharesChange > 0 ? "text-red-500" : "text-blue-500"}`}>
                                {h.sharesChange > 0 ? "▲" : "▼"}{Math.abs(h.sharesChange).toLocaleString()}주
                              </span>
                            )}
                            <span className="text-sm font-bold text-violet-400 w-14 text-right">{h.ownershipPct?.toFixed(2)}%</span>
                          </div>
                        ) : (
                          <>
                            <div className="w-24 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary/70"
                                style={{ width: `${Math.min(100, h.weight * 2.5)}%` }}
                              />
                            </div>
                            <span className="text-sm font-bold text-foreground w-12 text-right">{h.weight.toFixed(2)}%</span>
                          </>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div className="px-4 py-2.5 bg-muted/10 border-t border-border flex items-center justify-between gap-4">
                  <p className="text-[10px] text-muted-foreground/50">
                    {etfResult.source === "kis"       && "* KIS Open API"}
                    {etfResult.source === "samsung"   && "* 삼성자산운용 공시"}
                    {etfResult.source === "mirae"     && "* 미래에셋자산운용 공시"}
                    {etfResult.source === "krx"       && "* KRX 공시"}
                    {etfResult.source === "yahoo"     && "* Yahoo Finance — 분기별 비중 기준"}
                    {etfResult.source === "reference" && "* 참고용 — 실제 비중과 차이가 있을 수 있습니다"}
                    {etfResult.source === "nps"       && "* 국민연금공단 공시 (fund.nps.or.kr) — 연도 말 기준 다음 해 3분기 공시"}
                    {etfResult.source === "nps-dart"     && "* DART 대량보유 공시 — 국민연금 5% 이상 보유 종목 (최근 신고 기준)"}
                    {etfResult.source === "nps-overseas" && "* 국민연금공단 공시 (fund.nps.or.kr) — 해외주식 포트폴리오"}
                  </p>
                  {etfResult.dataDate && (
                    <p className="text-[10px] text-muted-foreground/60 shrink-0 font-medium">
                      {etfResult.source === "nps-dart" ? "최근 신고일" : "기준일"}{" "}
                      {etfResult.dataDate.replace(/-/g, ".")}
                    </p>
                  )}
                </div>
              </div>

              {/* 집중도 해설 */}
              {(() => {
                const conc = holdingConcentration(etfResult.holdings);
                return (
                  <div className={cn(
                    "rounded-xl px-4 py-3 text-[12px] leading-relaxed border",
                    conc.level === "high"
                      ? "bg-orange-500/5 border-orange-500/20 text-orange-700 dark:text-orange-400"
                      : conc.level === "mid"
                      ? "bg-blue-500/5 border-blue-500/20 text-blue-700 dark:text-blue-400"
                      : "bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400",
                  )}>
                    📊 {conc.text}
                  </div>
                );
              })()}

              {/* 리밸런싱 변화 */}
              {etfResult.changes && (() => {
                const { added, removed, increased, decreased, previousDate, currentDate } = etfResult.changes;
                const totalChanges = added.length + removed.length + increased.length + decreased.length;
                if (totalChanges === 0) return null;
                return (
                  <div className="rounded-2xl border border-border bg-card overflow-hidden col-span-full">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="w-3.5 h-3.5 text-primary" />
                        <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest">리밸런싱 변화</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground/50">{previousDate} → {currentDate}</p>
                    </div>
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* 신규 편입 */}
                      {added.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> 신규 편입 ({added.length})
                          </p>
                          <div className="space-y-1.5">
                            {added.map(h => (
                              <div key={h.stockCode} className="flex items-center justify-between text-xs">
                                <span className="text-foreground font-medium truncate max-w-[140px]">{h.stockName}</span>
                                <span className="text-emerald-500 font-bold shrink-0 ml-2">+{h.weight.toFixed(2)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* 편출 */}
                      {removed.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                            <TrendingDown className="w-3 h-3" /> 편출 ({removed.length})
                          </p>
                          <div className="space-y-1.5">
                            {removed.map(h => (
                              <div key={h.stockCode} className="flex items-center justify-between text-xs">
                                <span className="text-foreground font-medium truncate max-w-[140px]">{h.stockName}</span>
                                <span className="text-red-500 font-bold shrink-0 ml-2">−{h.weight.toFixed(2)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* 비중 확대 */}
                      {increased.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> 비중 확대 ({increased.length})
                          </p>
                          <div className="space-y-1.5">
                            {increased.map(h => (
                              <div key={h.stockCode} className="flex items-center justify-between text-xs">
                                <div className="min-w-0">
                                  <p className="text-foreground font-medium truncate max-w-[140px]">{h.stockName}</p>
                                  <p className="text-[10px] text-muted-foreground/50">{h.prevWeight?.toFixed(2)}% → {h.weight.toFixed(2)}%</p>
                                </div>
                                <span className="text-blue-500 font-bold shrink-0 ml-2">+{h.weightDelta?.toFixed(2)}%p</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* 비중 축소 */}
                      {decreased.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                            <TrendingDown className="w-3 h-3" /> 비중 축소 ({decreased.length})
                          </p>
                          <div className="space-y-1.5">
                            {decreased.map(h => (
                              <div key={h.stockCode} className="flex items-center justify-between text-xs">
                                <div className="min-w-0">
                                  <p className="text-foreground font-medium truncate max-w-[140px]">{h.stockName}</p>
                                  <p className="text-[10px] text-muted-foreground/50">{h.prevWeight?.toFixed(2)}% → {h.weight.toFixed(2)}%</p>
                                </div>
                                <span className="text-amber-500 font-bold shrink-0 ml-2">{h.weightDelta?.toFixed(2)}%p</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              구성 종목 데이터를 불러올 수 없습니다
            </div>
          )}

        </div>
      )}

      {/* 종목 결과: ETF 노출도 */}
      {mode === "stock" && stockResult && (
        <div className="space-y-3">
          {stockResult.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              해당 종목을 담고 있는 ETF를 찾지 못했습니다
            </div>
          ) : (
            <>
              {/* 노출도 요약 해설 */}
              <div className="rounded-xl bg-primary/5 border border-primary/15 px-4 py-3 text-[12px] text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">{stockResult[0]?.holding.stockName}</span>은(는) 현재 {stockResult.length}개 ETF에 편입되어 있습니다.
                {" "}가장 높은 비중으로 편입된 ETF는 <span className="font-semibold text-foreground">{stockResult[0]?.etf.name}</span>으로,
                전체 ETF 자산의 <span className="font-semibold text-foreground">{stockResult[0]?.holding.weight.toFixed(2)}%</span>를 차지합니다.
                ETF를 통하면 이 종목에 간접적으로 분산 투자할 수 있습니다.
              </div>
              <p className="text-xs text-muted-foreground px-1">
                <span className="font-semibold text-foreground">{stockResult[0]?.holding.stockName}</span>을 담고 있는 ETF {stockResult.length}개
              </p>
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest">ETF 편입 현황</p>
                </div>
                {/* 바 차트 */}
                <div className="px-4 pt-4 pb-2">
                  <ResponsiveContainer width="100%" height={stockResult.length * 36 + 20}>
                    <BarChart
                      layout="vertical"
                      data={stockResult.map(r => ({ name: r.etf.name, weight: r.holding.weight, sector: r.etf.sector }))}
                      margin={{ left: 10, right: 40 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" />
                      <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "편입 비중"]} />
                      <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
                        {stockResult.map((r, i) => (
                          <Cell key={i} fill={SECTOR_COLORS[r.etf.sector] ?? "#94a3b8"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="divide-y divide-border/50">
                  {stockResult.map(r => (
                    <div key={r.etf.code} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-foreground">{r.etf.name}</p>
                        <p className="text-[11px] text-muted-foreground/50">{r.etf.code} · {r.etf.issuer}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-foreground">{r.holding.weight.toFixed(2)}%</p>
                        <p className="text-[11px] text-muted-foreground/40">#{r.holding.rank}위</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}

// ─── ETF 상세 패널 ────────────────────────────────────────────────────────────

function EtfDetailPanel({
  code, detail, loading, allEtfs, onClose,
}: {
  code: string;
  detail: { etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null;
  loading: boolean;
  allEtfs: ETFInfo[];
  onClose: () => void;
}) {
  const etf      = detail?.etf ?? allEtfs.find(e => e.code === code) ?? null;
  const holdings = detail?.holdings ?? [];

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 space-y-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {etf ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-foreground">{etf.name}</h3>
                <span className="text-[10px] text-muted-foreground/40">{etf.code}</span>
                <LeverageBadge lev={etf.leverage} />
                {etf.ter != null && (
                  <span className="text-[10px] text-muted-foreground/50 bg-muted/30 px-1.5 py-0.5 rounded border border-border">
                    보수 {etf.ter}%
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">{etf.issuer} · {etf.sector}</p>
            </>
          ) : (
            <p className="text-sm font-bold text-foreground">{code}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted/30 transition-all shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {etf && (
        <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border/30 pt-2.5">
          {etfDescription(etf)}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-primary/50" />
        </div>
      ) : holdings.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
            주요 구성 종목 (Top {Math.min(holdings.length, 10)})
          </p>
          <div className="space-y-1.5">
            {holdings.slice(0, 10).map(h => (
              <div key={h.rank} className="flex items-center gap-2.5">
                <span className="text-[10px] text-muted-foreground/30 w-4 text-right shrink-0">{h.rank}</span>
                <span className="text-[11px] font-medium text-foreground flex-1 truncate min-w-0">{h.stockName}</span>
                <div className="w-20 h-1 bg-muted/30 rounded-full overflow-hidden shrink-0">
                  <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.min(100, h.weight * 3)}%` }} />
                </div>
                <span className="text-[11px] font-bold text-foreground w-10 text-right shrink-0">{h.weight.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          {(() => {
            const conc = holdingConcentration(holdings);
            return (
              <div className={cn(
                "rounded-xl px-3 py-2 text-[11px] leading-relaxed border",
                conc.level === "high" ? "bg-orange-500/5 border-orange-500/20 text-orange-600 dark:text-orange-400"
                : conc.level === "mid" ? "bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400"
                : "bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
              )}>
                📊 {conc.text}
              </div>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}

// ─── 탭 2: ETF 모멘텀 분석 ───────────────────────────────────────────────────

/** 전체 섹터 스코어보드 (히트맵 그리드) */
function SectorHeatMap({
  sectors, label, onSectorClick, selectedSectors,
}: {
  sectors: SectorMomentum[];
  label: string;
  onSectorClick: (sectorTags: string[]) => void;
  selectedSectors?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sectors : sectors.slice(0, 6);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">{label}</span>
        {sectors.length > 6 && (
          <button onClick={() => setExpanded(v => !v)} className="text-[10px] text-primary/60 hover:text-primary transition-colors font-medium">
            {expanded ? "접기" : `전체 ${sectors.length}개 보기`}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {visible.map((s, i) => {
          const sColor = s.score >= 75 ? "#16a34a" : s.score >= 60 ? "#f59e0b" : "#94a3b8";
          const isSelected = selectedSectors?.some(t => s.sectorTags.includes(t));
          return (
            <button
              key={s.id}
              onClick={() => onSectorClick(s.sectorTags)}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all hover:bg-muted/20",
                isSelected ? "border-primary/40 bg-primary/5" : "border-border/50 bg-card",
              )}
            >
              <span className="text-lg leading-none shrink-0">{s.icon}</span>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-bold text-foreground truncate">{s.name}</span>
                  <span className="text-[12px] font-black shrink-0" style={{ color: sColor }}>{s.score}</span>
                </div>
                <div className="h-1 bg-muted/25 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${s.score}%`, background: sColor }} />
                </div>
              </div>
              {i === 0 && <span className="text-[8px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.5 rounded shrink-0">TOP</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const OUTLOOK_CONFIG = {
  bullish:  { label: "강세", text: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/25" },
  neutral:  { label: "중립", text: "text-amber-500",   bg: "bg-amber-500/10",   border: "border-amber-500/25"   },
  cautious: { label: "관망", text: "text-slate-400",   bg: "bg-slate-500/10",   border: "border-slate-500/20"   },
};

function IndexOutlookCard({ idx }: { idx: IndexOutlook }) {
  const isUp   = idx.agreementSignal === "up";
  const isDown = idx.agreementSignal === "down";
  const pred   = idx.predictedReturn3d;
  const predColor = pred === null ? "text-muted-foreground" : pred >= 0 ? "text-emerald-500" : "text-red-500";
  const change1dColor = !idx.change1d ? "text-muted-foreground" : idx.change1d >= 0 ? "text-emerald-500" : "text-red-500";
  const sparkData = idx.sparkline.map((v, i) => ({ i, v }));
  const sparkMin  = Math.min(...idx.sparkline);
  const sparkMax  = Math.max(...idx.sparkline);
  const sparkColor = isUp ? "#22c55e" : isDown ? "#ef4444" : "#94a3b8";

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold text-foreground">{idx.name}</span>
            <span className="text-[10px] text-muted-foreground/50">{idx.symbol}</span>
            {isUp   && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-semibold">상승 전망</span>}
            {isDown && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-500 border border-red-500/30 font-semibold">하락 전망</span>}
            {!isUp && !isDown && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20 font-semibold">중립</span>}
          </div>
          {idx.latestPrice && (
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-foreground">{idx.latestPrice.toLocaleString()}</span>
              {idx.change1d !== null && (
                <span className={cn("text-xs font-semibold tabular-nums", change1dColor)}>
                  {idx.change1d >= 0 ? "+" : ""}{idx.change1d.toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </div>
        {sparkData.length > 3 && (
          <div className="w-24 h-12 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <defs>
                  <linearGradient id={`sg-${idx.symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={sparkColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={sparkColor} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <YAxis domain={[sparkMin * 0.998, sparkMax * 1.002]} hide />
                <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5}
                  fill={`url(#sg-${idx.symbol})`} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {/* 3일 예측 수익률 */}
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-0.5">AI 3일 예측</p>
          <p className={cn("text-sm font-bold tabular-nums", predColor)}>
            {pred === null ? "—" : `${pred >= 0 ? "+" : ""}${pred.toFixed(2)}%`}
          </p>
        </div>
        {/* AI 합의 강도 */}
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-1">모델 합의</p>
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full", isUp ? "bg-emerald-500" : isDown ? "bg-red-500" : "bg-slate-400")}
                style={{ width: `${Math.min(100, idx.agreementStrength)}%` }}
              />
            </div>
            <span className="text-[11px] font-semibold text-foreground tabular-nums w-8 text-right">{idx.agreementStrength.toFixed(0)}%</span>
          </div>
        </div>
        {/* 변동성 */}
        {idx.curVol20 !== null && (
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-0.5">20일 변동성</p>
            <p className={cn("text-sm font-bold tabular-nums", idx.curVol20 > 2 ? "text-orange-500" : "text-foreground")}>
              {idx.curVol20.toFixed(2)}%
            </p>
          </div>
        )}
        {/* GBDT 방향 정확도 */}
        {idx.gbdtDirAcc !== null && (
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-0.5">GBDT 방향 정확도</p>
            <p className={cn("text-sm font-bold tabular-nums", idx.gbdtDirAcc >= 55 ? "text-emerald-500" : idx.gbdtDirAcc >= 45 ? "text-foreground" : "text-red-400")}>
              {idx.gbdtDirAcc.toFixed(1)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MacroStatRow({
  label, value, signal, isWarn,
}: { label: string; value: string; signal: string; isWarn: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
      <span className="text-[13px] text-muted-foreground whitespace-nowrap shrink-0 mr-2">{label}</span>
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-[15px] font-bold text-foreground tabular-nums">{value}</span>
        <span className={cn("text-[12px] font-semibold w-[4.5rem] text-right shrink-0", isWarn ? "text-orange-500" : "text-emerald-500")}>
          {signal}
        </span>
      </div>
    </div>
  );
}

/** 매크로 조건을 일반 투자자가 읽기 쉬운 문장으로 변환 */
function buildMacroNarrative(macro: MacroSnapshot, env: MacroEnvironment): string {
  const sentences: string[] = [];
  if (env.rateLevel === "high") {
    sentences.push(`미국 Fed 금리가 ${macro.usRate}%로 높아 대출·투자 비용 부담이 큰 환경입니다`);
  } else if (env.rateLevel === "moderate") {
    sentences.push(`미국 Fed 금리(${macro.usRate}%)는 중립 수준을 유지하고 있습니다`);
  } else {
    sentences.push(`미국 Fed 금리(${macro.usRate}%)가 낮아 유동성이 풍부한 환경입니다`);
  }
  if (env.inflation === "elevated") {
    sentences.push(`물가(CPI ${macro.usCpi.toFixed(1)}%)가 Fed 목표치(2%)를 크게 웃돌아 금리 인하가 쉽지 않습니다`);
  } else if (env.inflation === "moderate") {
    sentences.push(`물가(CPI ${macro.usCpi.toFixed(1)}%)는 서서히 안정되고 있습니다`);
  }
  if (env.fxKrw === "weak") {
    sentences.push(`원화 약세(달러당 ${macro.krwUsd.toLocaleString()}원)로 해외 ETF 투자 시 환차익 효과가 추가됩니다`);
  } else if (env.fxKrw === "neutral") {
    sentences.push(`원달러 환율(${macro.krwUsd.toLocaleString()}원)은 중립적입니다`);
  }
  if (env.oilPrice === "high") {
    sentences.push(`국제 유가($${macro.wti.toFixed(0)})가 높아 에너지·방산주가 수혜를 받는 반면 물류·소비 비용은 늘어납니다`);
  }
  sentences.push("AI 인프라 투자 사이클은 꾸준히 진행 중입니다");
  return sentences.join(". ") + ".";
}


// ─── 공통: ETF 버튼 그룹 ─────────────────────────────────────────────────────

function EtfButtonGroup({
  label, labelClass, etfs, levEtfs, invEtfs,
  handleEtfClick, selectedEtfCode, etfDetail, loadingEtf, closeDetail, allEtfs,
  isNow,
}: {
  label?: string; labelClass?: string;
  etfs: ETFInfo[]; levEtfs: ETFInfo[]; invEtfs: ETFInfo[];
  handleEtfClick: (code: string) => void;
  selectedEtfCode: string | null;
  etfDetail: { etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null;
  loadingEtf: boolean; closeDetail: () => void; allEtfs: ETFInfo[];
  isNow?: boolean;
}) {
  const hasSel = [...etfs, ...levEtfs, ...invEtfs].some(e => e.code === selectedEtfCode);
  return (
    <div className="space-y-3">
      {etfs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground/60 font-semibold">관련 ETF</p>
          <div className="flex flex-wrap gap-1.5">
            {etfs.map(etf => (
              <button key={etf.code}
                onClick={e => { e.stopPropagation(); handleEtfClick(etf.code); }}
                className={cn(
                  "text-[12px] font-mono font-semibold px-2.5 py-1.5 rounded-lg transition-all",
                  selectedEtfCode === etf.code
                    ? "bg-foreground text-background"
                    : "bg-muted/50 text-foreground hover:bg-muted",
                )}
              >{etf.code}</button>
            ))}
          </div>
        </div>
      )}
      {levEtfs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-orange-500 font-semibold">레버리지 <span className="font-normal text-muted-foreground/55">— 고위험 단기매매 전용</span></p>
          <div className="flex flex-wrap gap-1.5">
            {levEtfs.map(etf => (
              <button key={etf.code}
                onClick={e => { e.stopPropagation(); handleEtfClick(etf.code); }}
                className={cn(
                  "text-[12px] font-mono font-bold px-2.5 py-1.5 rounded-lg border transition-all",
                  selectedEtfCode === etf.code
                    ? "bg-orange-500 text-white border-orange-500"
                    : "border-orange-500/20 text-orange-500 hover:bg-orange-500/10",
                )}
              >{etf.code} <span className="text-[10px] opacity-50 font-sans">{etf.leverage}×</span></button>
            ))}
          </div>
        </div>
      )}
      {invEtfs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-sky-500 font-semibold">역발상 <span className="font-normal text-muted-foreground/55">— 하락 시 수익</span></p>
          <div className="flex flex-wrap gap-1.5">
            {invEtfs.map(etf => (
              <button key={etf.code}
                onClick={e => { e.stopPropagation(); handleEtfClick(etf.code); }}
                className={cn(
                  "text-[12px] font-mono font-bold px-2.5 py-1.5 rounded-lg border transition-all",
                  selectedEtfCode === etf.code
                    ? "bg-sky-500 text-white border-sky-500"
                    : "border-sky-500/20 text-sky-500 hover:bg-sky-500/10",
                )}
              >{etf.code} <span className="text-[10px] opacity-50 font-sans">{etf.leverage}×</span></button>
            ))}
          </div>
        </div>
      )}
      {hasSel && (
        <EtfDetailPanel code={selectedEtfCode!} detail={etfDetail} loading={loadingEtf} allEtfs={allEtfs} onClose={closeDetail} />
      )}
    </div>
  );
}

// ─── 섹터 아코디언 행 ─────────────────────────────────────────────────────────

// ─── 거시 대시보드 헬퍼 & 컴포넌트 ──────────────────────────────────────────

const DASH_SENTIMENT_CFG = {
  positive: { bg: "bg-emerald-500/10 border-emerald-500/20", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-500", label: "긍정" },
  negative: { bg: "bg-red-500/10 border-red-500/20",         badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",           dot: "bg-red-500",     label: "부정" },
  neutral:  { bg: "bg-slate-500/10 border-slate-500/20",     badge: "bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400",   dot: "bg-slate-400",   label: "중립" },
  mixed:    { bg: "bg-amber-500/10 border-amber-500/20",     badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",   dot: "bg-amber-500",   label: "혼조" },
};

const CAT_ICON_MAP: Record<string, typeof Globe> = {
  markets: Globe, commodities: Package, currencies: DollarSign,
  rates: TrendingUp, fred: BarChart3, korea: Landmark,
};

function fmtDashValue(v: number | null, unit: string, id: string): string {
  if (v == null) return "—";
  if (["sp500","nasdaq","dow","nikkei","hsi","stoxx","shanghai","kospi"].includes(id))
    return v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
  if (id === "usdkrw") return v.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
  if (id === "eurusd") return v.toFixed(4);
  if (id === "usdjpy" || id === "usdcnh") return v.toFixed(2);
  if (id === "corn" || id === "wheat") return v.toFixed(0);
  if (unit === "%") return v.toFixed(2);
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10)  return v.toFixed(2);
  return v.toFixed(3);
}

function DashChangeBadge({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground/40 text-[10px]">—</span>;
  const up = v >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-mono font-semibold", up ? "text-red-500" : "text-blue-500")}>
      <Icon className="w-2.5 h-2.5" />
      {up ? "+" : ""}{v.toFixed(2)}%
    </span>
  );
}

function DashMiniBar({ change }: { change: number | null }) {
  if (change == null) return <div className="w-14 h-1 rounded-full bg-muted/30" />;
  const pct = Math.min(Math.abs(change) / 5, 1);
  const up = change >= 0;
  return (
    <div className="w-14 h-1 rounded-full bg-muted/30 overflow-hidden">
      <div className={cn("h-full rounded-full", up ? "bg-red-400" : "bg-blue-400")}
        style={{ width: `${(pct * 100).toFixed(1)}%`, float: up ? "left" : "right" }} />
    </div>
  );
}

function DashMarketCard({ item, isEn }: { item: DashMarketItem; isEn: boolean }) {
  const displayName = isEn ? item.nameEn : item.name;
  const value = fmtDashValue(item.value, item.unit, item.id);
  const isUp = (item.change1d ?? 0) >= 0;
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2.5 hover:border-primary/20 transition-colors">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm leading-none">{item.flag}</span>
          <span className="text-[10px] text-muted-foreground/60 font-medium truncate max-w-[90px]">{displayName}</span>
        </div>
        <DashChangeBadge v={item.change1d} />
      </div>
      <div className="flex items-end justify-between gap-1">
        <div className="flex items-baseline gap-0.5">
          <span className={cn("text-base font-bold font-mono leading-none",
            item.change1d == null ? "text-foreground" : isUp ? "text-red-500" : "text-blue-500")}>
            {value}
          </span>
          {item.unit && item.unit !== "pt" && item.unit !== "₩" && item.unit !== "¥" &&
            <span className="text-[9px] text-muted-foreground/50 ml-0.5">{item.unit}</span>}
        </div>
        <DashMiniBar change={item.change1d} />
      </div>
    </div>
  );
}

function DashCategorySection({ cat, isEn }: { cat: DashCategory; isEn: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const Icon = CAT_ICON_MAP[cat.id] ?? Globe;
  const title = isEn ? cat.nameEn : cat.name;
  return (
    <div className="mb-4">
      <button onClick={() => setCollapsed(v => !v)} className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-primary/60" />
        <span className="text-sm font-semibold text-foreground/80">{title}</span>
        <span className="text-[10px] text-muted-foreground/40">({cat.items.length})</span>
        <ChevronDown className={cn("w-3 h-3 text-muted-foreground/30 transition-transform ml-0.5", collapsed && "-rotate-90")} />
      </button>
      {!collapsed && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {cat.items.map(it => <DashMarketCard key={it.id} item={it} isEn={isEn} />)}
        </div>
      )}
    </div>
  );
}

// ─── 거시 시사점 & ETF 전략 (완전 재설계) ────────────────────────────────────

/** 인라인 보유종목 패널 - hooks 없이 순수 렌더 */
function InlineHoldings({
  loadingEtf, etfDetail, closeDetail,
}: {
  loadingEtf: boolean;
  etfDetail: { etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null;
  closeDetail: () => void;
}) {
  if (loadingEtf) {
    return (
      <div className="flex items-center justify-center gap-2 py-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/50" />
        <span className="text-[11px] text-muted-foreground/50">보유 종목 불러오는 중…</span>
      </div>
    );
  }
  const holdings = etfDetail?.holdings ?? [];
  if (holdings.length === 0) {
    return <p className="text-[11px] text-muted-foreground/40 text-center py-3">보유 종목 정보 없음</p>;
  }
  const top = holdings.slice(0, 10);
  const maxW = top[0]?.weight ?? 1;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
          보유 종목 Top {top.length}
        </p>
        <button
          onClick={closeDetail}
          className="text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors px-1"
        >
          ✕ 닫기
        </button>
      </div>
      {top.map(h => (
        <div key={h.rank} className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/30 w-4 text-right shrink-0 tabular-nums">{h.rank}</span>
          <span className="text-[11px] font-medium text-foreground flex-1 truncate min-w-0">{h.stockName}</span>
          <div className="w-20 h-1 bg-muted/30 rounded-full overflow-hidden shrink-0">
            <div className="h-full rounded-full bg-primary/60 transition-all"
              style={{ width: `${Math.min(100, (h.weight / maxW) * 100)}%` }} />
          </div>
          <span className="text-[11px] font-bold tabular-nums text-foreground w-10 text-right shrink-0">
            {h.weight.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** 전략 카드 하나 - sector 기반 */
function StrategyCard({
  sector, etfs, levEtfs, invEtfs,
  selectedEtfCode, etfDetail, loadingEtf, handleEtfClick, closeDetail,
}: {
  sector: SectorMomentum;
  etfs: ETFInfo[];
  levEtfs: ETFInfo[];
  invEtfs: ETFInfo[];
  selectedEtfCode: string | null;
  etfDetail: { etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null;
  loadingEtf: boolean;
  handleEtfClick: (code: string) => void;
  closeDetail: () => void;
}) {
  const cfg    = OUTLOOK_CONFIG[sector.outlook];
  const sColor = sector.score >= 75 ? "#22c55e" : sector.score >= 60 ? "#f59e0b" : "#94a3b8";
  const allEtfsInCard = [...etfs, ...levEtfs, ...invEtfs];
  const hasSelectedInCard = selectedEtfCode !== null && allEtfsInCard.some(e => e.code === selectedEtfCode);

  return (
    <div className={cn("rounded-2xl border overflow-hidden bg-card/40", cfg.border)}>
      {/* 카드 헤더 */}
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="text-xl leading-none shrink-0">{sector.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-bold text-foreground">{sector.name}</span>
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0", cfg.text, cfg.bg, cfg.border)}>
              {cfg.label}
            </span>
            {sector.horizon && (
              <span className="text-[10px] text-muted-foreground/40 ml-auto shrink-0">{sector.horizon}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${sector.score}%`, background: sColor }} />
            </div>
            <span className="text-[11px] font-black tabular-nums shrink-0" style={{ color: sColor }}>{sector.score}</span>
          </div>
        </div>
      </div>

      {/* 거시 분석 근거 */}
      <div className="px-4 pb-3">
        <p className="text-[12px] text-muted-foreground leading-relaxed">{sector.reason}</p>
        <div className="flex flex-wrap gap-1 mt-2">
          {sector.catalysts.map(c => (
            <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              ↑ {c}
            </span>
          ))}
          {sector.risks.slice(0, 2).map(r => (
            <span key={r} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground/60 border border-border/30">
              △ {r}
            </span>
          ))}
        </div>
      </div>

      {/* ETF 추천 그리드 */}
      <div className="px-4 pb-4 pt-2 border-t border-border/30 space-y-3">
        <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">추천 ETF</p>

        {/* 일반 ETF */}
        {etfs.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5">
            {etfs.map(etf => {
              const isSelected = selectedEtfCode === etf.code;
              const eColor = SECTOR_COLORS[etf.sector] ?? "#64748b";
              return (
                <div key={etf.code} className={cn("col-span-1", isSelected && "col-span-2")}>
                  <button
                    onClick={() => handleEtfClick(etf.code)}
                    className={cn(
                      "w-full flex flex-col gap-1 px-3 py-2.5 rounded-xl border transition-all text-left",
                      isSelected
                        ? "bg-primary/8 border-primary/30"
                        : "bg-card/80 border-border hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md leading-tight"
                        style={{ background: `${eColor}20`, color: eColor }}>
                        {etf.sector}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground/40">{etf.code}</span>
                    </div>
                    <span className="text-[12px] font-semibold text-foreground leading-snug line-clamp-2">{etf.name}</span>
                    {isSelected && <span className="text-[10px] text-primary/60 font-medium mt-0.5">▼ 보유 종목 확인 중</span>}
                  </button>
                  {isSelected && (
                    <div className="mt-1.5 rounded-xl border border-primary/20 bg-primary/5 p-3">
                      <InlineHoldings loadingEtf={loadingEtf} etfDetail={etfDetail} closeDetail={closeDetail} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 레버리지 / 인버스 */}
        {(levEtfs.length > 0 || invEtfs.length > 0) && (
          <div>
            <p className="text-[10px] text-muted-foreground/30 mb-1.5">레버리지 · 인버스</p>
            <div className="flex flex-wrap gap-1.5">
              {levEtfs.map(e => {
                const isSelected = selectedEtfCode === e.code;
                return (
                  <div key={e.code} className="w-full">
                    <button
                      onClick={() => handleEtfClick(e.code)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] transition-all w-auto",
                        isSelected
                          ? "bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400"
                          : "bg-amber-500/8 border-amber-500/20 text-amber-600 dark:text-amber-400 hover:opacity-80",
                      )}
                    >
                      <span className="font-bold text-[9px] bg-amber-500/20 px-1 py-0.5 rounded">2×</span>
                      <span className="font-mono">{e.code}</span>
                      <span className="opacity-60 truncate max-w-[100px]">{e.name}</span>
                    </button>
                    {isSelected && (
                      <div className="mt-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                        <InlineHoldings loadingEtf={loadingEtf} etfDetail={etfDetail} closeDetail={closeDetail} />
                      </div>
                    )}
                  </div>
                );
              })}
              {invEtfs.map(e => {
                const isSelected = selectedEtfCode === e.code;
                return (
                  <div key={e.code} className="w-full">
                    <button
                      onClick={() => handleEtfClick(e.code)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] transition-all w-auto",
                        isSelected
                          ? "bg-red-500/15 border-red-500/30 text-red-600 dark:text-red-400"
                          : "bg-red-500/8 border-red-500/20 text-red-600 dark:text-red-400 hover:opacity-80",
                      )}
                    >
                      <span className="font-bold text-[9px] bg-red-500/20 px-1 py-0.5 rounded">인버스</span>
                      <span className="font-mono">{e.code}</span>
                      <span className="opacity-60 truncate max-w-[100px]">{e.name}</span>
                    </button>
                    {isSelected && (
                      <div className="mt-1.5 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                        <InlineHoldings loadingEtf={loadingEtf} etfDetail={etfDetail} closeDetail={closeDetail} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** AI 인사이트 기반 전략 카드 */
function InsightStrategyCard({
  insight, allEtfs, selectedEtfCode, etfDetail, loadingEtf, handleEtfClick, closeDetail, isEn,
}: {
  insight: MacroInsight;
  allEtfs: ETFInfo[];
  selectedEtfCode: string | null;
  etfDetail: { etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null;
  loadingEtf: boolean;
  handleEtfClick: (code: string) => void;
  closeDetail: () => void;
  isEn: boolean;
}) {
  const cfg = DASH_SENTIMENT_CFG[insight.sentiment] ?? DASH_SENTIMENT_CFG.neutral;
  const krEtfs = (insight.krETFs ?? [])
    .map(e => allEtfs.find(a => a.code === e.ticker))
    .filter(Boolean) as ETFInfo[];
  const usEtfRecs = insight.usETFs ?? [];

  return (
    <div className={cn("rounded-2xl border overflow-hidden", cfg.bg)}>
      <div className="px-4 py-3 flex items-center gap-2.5">
        <div className={cn("w-2 h-2 rounded-full shrink-0", cfg.dot)} />
        <span className="text-[13px] font-bold text-foreground flex-1">
          {isEn ? insight.themeEn : insight.theme}
        </span>
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0", cfg.badge)}>
          {cfg.label}
        </span>
      </div>
      <div className="px-4 pb-3">
        <p className="text-[12px] text-muted-foreground leading-relaxed">{insight.description}</p>
      </div>
      <div className="px-4 pb-4 pt-2 border-t border-current/10 space-y-3">
        {krEtfs.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-2">
              🇰🇷 국내 ETF
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {krEtfs.map(etf => {
                const isSelected = selectedEtfCode === etf.code;
                const eColor = SECTOR_COLORS[etf.sector] ?? "#64748b";
                return (
                  <div key={etf.code} className={cn("col-span-1", isSelected && "col-span-2")}>
                    <button
                      onClick={() => handleEtfClick(etf.code)}
                      className={cn(
                        "w-full flex flex-col gap-1 px-3 py-2.5 rounded-xl border transition-all text-left",
                        isSelected ? "bg-primary/8 border-primary/30" : "bg-card/50 border-border hover:bg-muted/30",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md leading-tight"
                          style={{ background: `${eColor}20`, color: eColor }}>{etf.sector}</span>
                        <span className="text-[10px] font-mono text-muted-foreground/40">{etf.code}</span>
                      </div>
                      <span className="text-[12px] font-semibold text-foreground leading-snug line-clamp-2">{etf.name}</span>
                      {isSelected && <span className="text-[10px] text-primary/60 font-medium mt-0.5">▼ 보유 종목 확인 중</span>}
                    </button>
                    {isSelected && (
                      <div className="mt-1.5 rounded-xl border border-primary/20 bg-primary/5 p-3">
                        <InlineHoldings loadingEtf={loadingEtf} etfDetail={etfDetail} closeDetail={closeDetail} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {usEtfRecs.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mb-2">🇺🇸 미국 ETF</p>
            <div className="flex flex-wrap gap-1.5">
              {usEtfRecs.map(e => (
                <a key={e.ticker} href={`https://finance.yahoo.com/quote/${e.ticker}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400 hover:opacity-80 transition-colors">
                  <span className="text-[11px] font-mono font-bold">{e.ticker}</span>
                  {e.name && <span className="text-[10px] opacity-60 hidden sm:inline truncate max-w-[80px]">{e.name}</span>}
                  <ExternalLink className="w-2.5 h-2.5 opacity-40 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 거시 ETF 픽 섹션 (지금 유망 / 앞으로 주목) ──────────────────────────────

function EtfMacroPickSection({
  sectors, allEtfs, isNow, handleEtfClick, selectedEtfCode, etfDetail, loadingEtf, closeDetail,
}: {
  sectors: SectorMomentum[];
  allEtfs: ETFInfo[];
  isNow: boolean;
  handleEtfClick: (code: string) => void;
  selectedEtfCode: string | null;
  etfDetail: { etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null;
  loadingEtf: boolean;
  closeDetail: () => void;
}) {
  const sectorsWithEtfs = useMemo(() =>
    sectors.map(sector => ({
      sector,
      etfs: allEtfs.filter(e => sector.sectorTags.includes(e.sector) && e.leverage === 1).slice(0, 4),
    })).filter(x => x.etfs.length > 0),
  [sectors, allEtfs]);

  if (sectorsWithEtfs.length === 0) {
    return (
      <div className="text-[12px] text-muted-foreground/50 text-center py-6">
        매칭되는 ETF가 없습니다
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sectorsWithEtfs.map(({ sector, etfs }) => {
        const cfg    = OUTLOOK_CONFIG[sector.outlook];
        const sColor = sector.score >= 75 ? "#22c55e" : sector.score >= 60 ? "#f59e0b" : "#94a3b8";
        return (
          <div key={sector.id} className="space-y-2">
            {/* 섹터 헤더 */}
            <div className="flex items-center gap-2 px-1">
              <span className="text-base leading-none">{sector.icon}</span>
              <span className="text-[13px] font-semibold text-foreground">{sector.name}</span>
              <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden mx-1">
                <div className="h-full rounded-full" style={{ width: `${sector.score}%`, background: sColor }} />
              </div>
              <span className="text-[11px] font-bold tabular-nums" style={{ color: sColor }}>{sector.score}</span>
              <span className={cn("text-[11px] font-semibold shrink-0", cfg.text)}>{cfg.label}</span>
              {!isNow && <span className="text-[10px] text-muted-foreground/45 shrink-0">{sector.horizon}</span>}
            </div>
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed px-1">
              {sector.reason.length > 80 ? sector.reason.slice(0, 80) + "…" : sector.reason}
            </p>
            {/* ETF 카드 그리드 */}
            <div className="grid grid-cols-2 gap-1.5">
              {etfs.map(etf => {
                const isSelected = selectedEtfCode === etf.code;
                const eColor = SECTOR_COLORS[etf.sector] ?? "#64748b";
                return (
                  <div key={etf.code}>
                    <button
                      onClick={() => handleEtfClick(etf.code)}
                      className={cn(
                        "w-full flex flex-col gap-1 px-3 py-2.5 rounded-xl border transition-all text-left",
                        isSelected
                          ? "bg-primary/8 border-primary/25"
                          : "bg-card border-border hover:bg-muted/30",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-md leading-tight"
                          style={{ background: `${eColor}20`, color: eColor }}
                        >
                          {etf.sector}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground/45 ml-auto">{etf.code}</span>
                      </div>
                      <span className="text-[12px] font-semibold text-foreground leading-snug line-clamp-2">{etf.name}</span>
                      {isSelected && (
                        <span className="text-[10px] text-primary/70 font-medium mt-0.5">▼ 상세 보기</span>
                      )}
                    </button>
                    {isSelected && (
                      <div className="mt-1.5 rounded-xl border border-primary/20 bg-primary/5 p-3 col-span-2">
                        <InlineHoldings loadingEtf={loadingEtf} etfDetail={etfDetail} closeDetail={closeDetail} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectorAccordionRow({
  sector, isNow, rank, etfs, levEtfs, invEtfs,
  handleEtfClick, selectedEtfCode, etfDetail, loadingEtf, closeDetail, allEtfs,
}: {
  sector: SectorMomentum;
  isNow: boolean;
  rank: number;
  etfs: ETFInfo[];
  levEtfs: ETFInfo[];
  invEtfs: ETFInfo[];
  handleEtfClick: (code: string) => void;
  selectedEtfCode: string | null;
  etfDetail: { etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null;
  loadingEtf: boolean;
  closeDetail: () => void;
  allEtfs: ETFInfo[];
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg    = OUTLOOK_CONFIG[sector.outlook];
  const sColor = sector.score >= 75 ? "#22c55e" : sector.score >= 60 ? "#f59e0b" : "#94a3b8";

  return (
    <div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-1 py-3.5 hover:bg-muted/20 rounded-xl transition-colors text-left border-b border-border/30"
      >
        <span className="text-[12px] font-semibold text-muted-foreground/50 w-5 text-center shrink-0 tabular-nums">{rank + 1}</span>
        <span className="text-[18px] leading-none shrink-0">{sector.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[14px] font-semibold text-foreground truncate">{sector.name}</span>
            {!isNow && <span className="text-[11px] text-muted-foreground/55 shrink-0">{sector.horizon}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${sector.score}%`, background: sColor }} />
            </div>
            <span className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: sColor }}>{sector.score}</span>
          </div>
        </div>
        <span className={cn("text-[13px] font-semibold shrink-0 w-8 text-right", cfg.text)}>{cfg.label}</span>
        {!expanded && etfs.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            {etfs.slice(0, 2).map(e => (
              <span key={e.code} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-muted/40 text-muted-foreground/55">{e.code}</span>
            ))}
          </div>
        )}
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground/40 shrink-0 transition-transform duration-200", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="px-1 pt-3 pb-5 space-y-4">
          <p className="text-[13px] text-muted-foreground leading-relaxed">{sector.reason}</p>
          <div className="flex flex-wrap gap-1.5">
            {sector.catalysts.map(c => (
              <span key={c} className={cn(
                "text-[12px] px-2.5 py-1 rounded-full font-medium",
                isNow ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-blue-500/12 text-blue-700 dark:text-blue-300"
              )}>↑ {c}</span>
            ))}
            {sector.risks.map(r => (
              <span key={r} className="text-[12px] px-2.5 py-1 rounded-full bg-muted/50 text-muted-foreground/70">△ {r}</span>
            ))}
          </div>
          <EtfButtonGroup
            etfs={etfs} levEtfs={levEtfs} invEtfs={invEtfs}
            handleEtfClick={handleEtfClick} selectedEtfCode={selectedEtfCode}
            etfDetail={etfDetail} loadingEtf={loadingEtf} closeDetail={closeDetail}
            allEtfs={allEtfs} isNow={isNow}
          />
        </div>
      )}
    </div>
  );
}

// ─── 수급·테마 아코디언 행 ────────────────────────────────────────────────────

function PulseAccordionRow({
  icon, label, description, badgeText, badgeClass,
  impactIcon, impactClass, rank, isNegative,
  etfs, levEtfs, invEtfs,
  handleEtfClick, selectedEtfCode, etfDetail, loadingEtf, closeDetail, allEtfs,
}: {
  icon: string; label: string; description: string;
  badgeText: string; badgeClass: string;
  impactIcon: string; impactClass: string;
  rank: number;
  isNegative?: boolean;
  etfs: ETFInfo[]; levEtfs: ETFInfo[]; invEtfs: ETFInfo[];
  handleEtfClick: (code: string) => void;
  selectedEtfCode: string | null;
  etfDetail: { etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null;
  loadingEtf: boolean;
  closeDetail: () => void;
  allEtfs: ETFInfo[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-1 py-3.5 hover:bg-muted/20 rounded-xl transition-colors text-left border-b border-border/30"
      >
        <span className="text-[18px] leading-none shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-[14px] font-semibold text-foreground truncate block">{label}</span>
        </div>
        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0", badgeClass)}>
          {badgeText}
        </span>
        <span className={cn("text-[16px] font-bold shrink-0 w-5 text-center", impactClass)}>{impactIcon}</span>
        {!expanded && etfs.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            {etfs.slice(0, 2).map(e => (
              <span key={e.code} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-muted/40 text-muted-foreground/45">{e.code}</span>
            ))}
          </div>
        )}
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground/40 shrink-0 transition-transform duration-200", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="px-1 pt-3 pb-5 space-y-4">
          <p className="text-[13px] text-muted-foreground leading-relaxed">{description}</p>
          <EtfButtonGroup
            etfs={etfs} levEtfs={levEtfs} invEtfs={invEtfs}
            handleEtfClick={handleEtfClick} selectedEtfCode={selectedEtfCode}
            etfDetail={etfDetail} loadingEtf={loadingEtf} closeDetail={closeDetail}
            allEtfs={allEtfs}
          />
        </div>
      )}
    </div>
  );
}

// ─── 탭 2: 모멘텀 탭 ─────────────────────────────────────────────────────────

let _dashCache: { data: DashData; fetchedAt: number } | null = null;

function MomentumTab() {
  const { isEn } = useLanguage();
  const [data, setData]               = useState<MomentumAnalysis | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshed, setRefreshed]     = useState<Date | null>(null);
  const [allEtfs, setAllEtfs]         = useState<ETFInfo[]>([]);
  const [selectedEtfCode, setSelectedEtfCode] = useState<string | null>(null);
  const [etfDetail, setEtfDetail]     = useState<{ etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null>(null);
  const [loadingEtf, setLoadingEtf]   = useState(false);
  const [subTab, setSubTab]           = useState<"macro" | "pulse">(() => {
    const p = new URLSearchParams(window.location.search).get("sub");
    return p === "pulse" ? "pulse" : "macro";
  });

  /* 거시 대시보드 상태 */
  const [dashData, setDashData]       = useState<DashData | null>(_dashCache?.data ?? null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError]     = useState<string | null>(null);
  const [dashCatTab, setDashCatTab]   = useState<string>("all");

  const loadDash = useCallback(async (force = false) => {
    if (!force && _dashCache && Date.now() - _dashCache.fetchedAt < 20 * 60 * 1000) {
      setDashData(_dashCache.data); return;
    }
    setDashLoading(true); setDashError(null);
    try {
      const r = await fetch(getApiUrl("/api/macro/dashboard"), { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}`);
      const d: DashData = await r.json();
      _dashCache = { data: d, fetchedAt: Date.now() };
      setDashData(d);
    } catch (e: any) { setDashError(e?.message ?? "오류"); }
    finally { setDashLoading(false); }
  }, []);

  const dashTabs = useMemo(() => {
    if (!dashData) return [];
    return [
      { id: "all", label: isEn ? "All" : "전체" },
      ...dashData.categories.map(c => ({ id: c.id, label: isEn ? c.nameEn : c.name })),
      { id: "insights", label: isEn ? "AI Insights" : "AI 시사점" },
    ];
  }, [dashData, isEn]);

  const visibleDashCats = useMemo(() => {
    if (!dashData) return [];
    if (dashCatTab === "all" || dashCatTab === "insights") return dashData.categories;
    return dashData.categories.filter(c => c.id === dashCatTab);
  }, [dashData, dashCatTab]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch(getApiUrl("/api/etf/momentum-analysis"), { credentials: "include" }),
        fetch(getApiUrl("/api/etf/list"),              { credentials: "include" }),
      ]);
      if (r1.ok) { setData(await r1.json()); setRefreshed(new Date()); }
      if (r2.ok) { const d = await r2.json(); setAllEtfs(Array.isArray(d) ? d : []); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadDash(); }, [loadDash]);

  useEffect(() => { load(); }, [load]);

  const getEtfsForSector = useCallback(
    (tags: string[]) => {
      const matched  = allEtfs.filter(e => tags.includes(e.sector));
      const regular  = matched.filter(e => e.leverage === 1).slice(0, 6);
      const leveraged = matched.filter(e => e.leverage >= 2);
      const inverse  = matched.filter(e => e.leverage < 0);
      return { regular, leveraged, inverse };
    },
    [allEtfs],
  );

  const closeDetail = useCallback(() => { setSelectedEtfCode(null); setEtfDetail(null); }, []);

  const handleEtfClick = useCallback(async (code: string) => {
    if (selectedEtfCode === code) { closeDetail(); return; }
    setSelectedEtfCode(code);
    setEtfDetail(null);
    setLoadingEtf(true);
    try {
      const r = await fetch(getApiUrl(`/api/etf/${encodeURIComponent(code)}/holdings`), { credentials: "include" });
      if (r.ok) setEtfDetail(await r.json());
    } finally { setLoadingEtf(false); }
  }, [selectedEtfCode, closeDetail]);

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-primary" />
            ETF 모멘텀 분석
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            거시·수급·테마 기반 섹터 기회 선별 · 유망 ETF 추천
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          {refreshed && <span>{refreshed.getHours()}:{String(refreshed.getMinutes()).padStart(2, "0")}</span>}
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
          <p className="text-xs text-muted-foreground/50">매크로 데이터 분석 중...</p>
        </div>
      ) : !data ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          데이터를 불러오지 못했습니다
        </div>
      ) : (
        <>
          {/* 2-섹션 서브탭 */}
          <div className="flex gap-1 p-1 rounded-2xl bg-muted/30 border border-border">
            {([
              { id: "macro" as const, icon: "📊", label: "거시 지표" },
              { id: "pulse" as const, icon: "📡", label: "수급·테마" },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-semibold transition-all",
                  subTab === t.id
                    ? "bg-card text-foreground shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* ── 탭 1: 거시 대시보드 ── */}
          {subTab === "macro" && <MacroDashboardPanel />}

          {/* ── 탭 2: 수급·테마 통합 ── */}
          {subTab === "pulse" && (
            <div className="space-y-6">

              {/* 기관 수급 흐름 */}
              <div className="space-y-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">기관 수급 흐름</p>
                  <p className="text-[11px] text-muted-foreground/50">거시 지표 기반 추정</p>
                </div>
                {(data.marketPulse.institutionalFlow ?? []).map((item, i) => {
                  const isIn  = item.direction === "in";
                  const isOut = item.direction === "out";
                  const dirIcon  = isIn ? "↑" : isOut ? "↓" : "→";
                  const dirLabel = isIn ? "유입" : isOut ? "유출" : "관망";
                  const dirColor = isIn
                    ? "text-emerald-500"
                    : isOut
                    ? "text-red-400"
                    : "text-amber-400";
                  const barColor = isIn
                    ? "bg-emerald-500"
                    : isOut
                    ? "bg-red-400"
                    : "bg-amber-400";
                  return (
                    <div key={i} className="py-2.5 border-b border-border/25 last:border-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[13px] font-bold w-4 shrink-0 ${dirColor}`}>{dirIcon}</span>
                        <span className="text-[13px] font-semibold text-foreground flex-1">{item.sector}</span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1.5 rounded-full bg-border/40 overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${item.strength}%` }} />
                          </div>
                          <span className={`text-[11px] font-semibold ${dirColor}`}>{dirLabel}</span>
                        </div>
                      </div>
                      <p className="text-[12px] text-muted-foreground/70 leading-snug pl-6">{item.reason}</p>
                    </div>
                  );
                })}
              </div>

              {/* 매크로 내러티브 */}
              <p className="text-[12px] text-muted-foreground leading-relaxed border-t border-border/30 pt-3">
                {data.marketPulse.marketNarrative}
              </p>

              {/* 개인 투자자 주의 */}
              {data.marketPulse.retailWarning.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-2">개인 투자자 주의</p>
                  {data.marketPulse.retailWarning.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 py-1.5 border-b border-border/25 last:border-0">
                      <span className="text-[12px] text-amber-500 mt-0.5 shrink-0">⚠</span>
                      <p className="text-[13px] text-muted-foreground leading-snug">{w}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* 수급·심리 시그널 */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-1 mb-1">수급·심리 시그널</p>
                {data.marketPulse.signals.map((sig, i) => {
                  const { regular, leveraged, inverse } = getEtfsForSector(sig.sectorTags ?? []);
                  const catColor: Record<typeof sig.category, string> = {
                    "수급":   "bg-blue-500/8 text-blue-500",
                    "심리":   "bg-purple-500/8 text-purple-400",
                    "기술적": "bg-cyan-500/8 text-cyan-400",
                    "매크로": "bg-amber-500/8 text-amber-500",
                    "테마":   "bg-emerald-500/8 text-emerald-500",
                  };
                  const impactIcon  = sig.impact === "positive" ? "↑" : sig.impact === "negative" ? "↓" : "→";
                  const impactClass = sig.impact === "positive" ? "text-emerald-500" : sig.impact === "negative" ? "text-red-400" : "text-amber-400";
                  return (
                    <PulseAccordionRow
                      key={sig.id} icon={sig.icon} label={sig.label} description={sig.description}
                      badgeText={sig.category} badgeClass={catColor[sig.category]}
                      impactIcon={impactIcon} impactClass={impactClass}
                      rank={i} isNegative={sig.impact === "negative"}
                      etfs={regular} levEtfs={leveraged} invEtfs={inverse}
                      handleEtfClick={handleEtfClick} selectedEtfCode={selectedEtfCode}
                      etfDetail={etfDetail} loadingEtf={loadingEtf} closeDetail={closeDetail} allEtfs={allEtfs}
                    />
                  );
                })}
              </div>

              {/* 언론·소셜 주목 테마 */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-1 mb-1">주목 테마</p>
                {data.marketPulse.themes.map((t, i) => {
                  const { regular, leveraged, inverse } = getEtfsForSector(t.relatedSectors);
                  const sentimentCfg = {
                    hot:  { text: "인기", cls: "bg-red-500/8 text-red-500",          icon: "↑", iconCls: "text-emerald-500" },
                    warm: { text: "주목", cls: "bg-amber-500/8 text-amber-500",       icon: "→", iconCls: "text-amber-400"   },
                    cool: { text: "소강", cls: "bg-muted/30 text-muted-foreground/50", icon: "↓", iconCls: "text-slate-400"   },
                  }[t.sentiment];
                  const themeIcons: Record<string, string> = { hot: "🔥", warm: "📈", cool: "💤" };
                  return (
                    <PulseAccordionRow
                      key={t.label} icon={themeIcons[t.sentiment]} label={t.label} description={t.description}
                      badgeText={sentimentCfg.text} badgeClass={sentimentCfg.cls}
                      impactIcon={sentimentCfg.icon} impactClass={sentimentCfg.iconCls}
                      rank={i} isNegative={t.sentiment === "cool"}
                      etfs={regular} levEtfs={leveraged} invEtfs={inverse}
                      handleEtfClick={handleEtfClick} selectedEtfCode={selectedEtfCode}
                      etfDetail={etfDetail} loadingEtf={loadingEtf} closeDetail={closeDetail} allEtfs={allEtfs}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* 면책 */}
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground/50 bg-muted/20 rounded-xl px-3 py-2.5 border border-border/50">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <p>ETF 모멘텀 분석은 거시 지표 기반 참고용 투자 보조 지표입니다. 실제 투자 손실에 대해 애빛다는 책임지지 않습니다.</p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ETF 흐름 탭 ──────────────────────────────────────────────────────────────

interface FlowStock {
  code: string; name: string;
  etfCount: number; totalWeight: number; avgWeight: number;
  etfs: string[];
}
interface SectorConc { sector: string; etfCount: number; avgWeight: number; topStock: string; }
interface ThemeBreakdown { key: string; label: string; emoji: string; etfCount: number; totalEtfs: number; score: number; }
interface FundFlowData {
  krTopStocks: FlowStock[];
  usTopStocks: FlowStock[];
  sectorConcentration: SectorConc[];
  themeBreakdown: ThemeBreakdown[];
  coverageStats: { krEtfCount: number; usEtfCount: number };
  updatedAt: string;
}

const SECTOR_BADGE_COLOR: Record<string, string> = {
  "반도체":          "bg-amber-500/10 text-amber-500",
  "반도체(글로벌)":  "bg-amber-500/10 text-amber-500",
  "2차전지":         "bg-emerald-500/10 text-emerald-500",
  "헬스케어":        "bg-pink-500/10 text-pink-500",
  "IT":              "bg-blue-500/10 text-blue-400",
  "국내주식":        "bg-indigo-500/10 text-indigo-400",
  "코스닥":          "bg-purple-500/10 text-purple-400",
  "해외(미국)":      "bg-cyan-500/10 text-cyan-400",
  "배당":            "bg-green-500/10 text-green-500",
  "밸류업":          "bg-rose-500/10 text-rose-400",
};

const THEME_BAR_COLOR: Record<string, string> = {
  semiconductor: "#f59e0b",
  battery:       "#22c55e",
  healthcare:    "#ec4899",
  us_market:     "#06b6d4",
  domestic:      "#6366f1",
  kosdaq:        "#a855f7",
};

function FundFlowTab() {
  const [data, setData]       = useState<FundFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [panel, setPanel]     = useState<"kr" | "us">("kr");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/etf/fund-flow"), { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "로드 실패");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-primary/50" />
        <p className="text-sm text-muted-foreground">15개 국내 ETF + 9개 해외 ETF 집계 중…</p>
        <p className="text-xs text-muted-foreground/50">처음 로드 시 20~30초 소요</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">데이터를 불러오지 못했습니다.</p>
        <button onClick={() => load(true)} className="text-xs text-primary hover:underline">다시 시도</button>
      </div>
    );
  }

  const updatedLabel = (() => {
    try { return new Date(data.updatedAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return data.updatedAt; }
  })();

  const topList = panel === "kr" ? data.krTopStocks : data.usTopStocks;

  // 섹터 온도 계산: themeBreakdown → heat 레이블
  const sectorHeat = data.themeBreakdown.map(t => ({
    ...t,
    heat: t.score >= 75 ? "🔥" : t.score >= 40 ? "📈" : "❄️",
    label: t.label,
  }));

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground/60">
          {data.coverageStats.krEtfCount + data.coverageStats.usEtfCount}개 ETF 집계
          <span className="ml-2 text-muted-foreground/40">· {updatedLabel}</span>
        </p>
        <button
          onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-muted/30"
        >
          <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />새로고침
        </button>
      </div>

      {/* 섹터 온도 — 한눈에 보는 테마 온기 */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-3">지금 어떤 섹터가 뜨거운가</p>
        <div className="flex flex-wrap gap-2">
          {sectorHeat.map(t => (
            <div key={t.key} className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold border",
              t.score >= 75
                ? "bg-orange-500/10 border-orange-500/20 text-orange-500"
                : t.score >= 40
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted/30 border-border/50 text-muted-foreground/60"
            )}>
              <span>{t.heat}</span>
              <span>{t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* KR / US 탭 */}
      <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-0.5 border border-border/50">
        {(["kr", "us"] as const).map(p => (
          <button key={p} onClick={() => setPanel(p)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-semibold rounded-lg transition-all",
              panel === p ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {p === "kr" ? <><Landmark className="w-3.5 h-3.5" />국내 ETF 집중 종목</> : <><Globe className="w-3.5 h-3.5" />해외 ETF 집중 종목</>}
          </button>
        ))}
      </div>

      {/* 종목 리스트 */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/50 bg-muted/10">
          <p className="text-[12px] text-muted-foreground/70">
            {panel === "kr"
              ? `국내 ${data.coverageStats.krEtfCount}개 ETF가 공통으로 많이 담고 있는 종목 순위`
              : `해외 ${data.coverageStats.usEtfCount}개 ETF가 공통으로 많이 담고 있는 종목 순위`}
          </p>
        </div>
        <div className="divide-y divide-border/30">
          {topList.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">데이터 없음</div>
          )}
          {topList.map((stock, i) => {
            const rankColor = i === 0 ? "text-amber-500" : i === 1 ? "text-slate-400" : i === 2 ? "text-amber-700" : "text-muted-foreground/30";
            return (
              <div key={stock.code} className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/10 transition-colors">
                {/* 순위 번호 */}
                <span className={cn("w-5 text-center text-[13px] font-black shrink-0", rankColor)}>
                  {i + 1}
                </span>

                {/* 종목 정보 */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <p className="text-[14px] font-bold text-foreground">{stock.name || stock.code}</p>
                    <span className="text-[10px] text-muted-foreground/40">{stock.code}</span>
                  </div>
                  {/* ETF 이름 태그 */}
                  <div className="flex flex-wrap gap-1">
                    {stock.etfs.slice(0, 4).map(e => (
                      <span key={e} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground/70 truncate max-w-[130px]">
                        {e}
                      </span>
                    ))}
                    {stock.etfs.length > 4 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/20 text-muted-foreground/40">
                        +{stock.etfs.length - 4}개 ETF
                      </span>
                    )}
                  </div>
                </div>

                {/* ETF 편입 수 — 핵심 지표 */}
                <div className="text-right shrink-0">
                  <p className="text-[18px] font-black text-foreground leading-none">{stock.etfCount}</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">개 ETF</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── ETF 리밸런싱 탭 ──────────────────────────────────────────────────────────

interface RebalStock {
  ticker: string; name: string; etfs: string[];
  weight: number; delta?: number; region: "KR" | "US"; sector: string;
}
interface SectorMove {
  sector: string; region: "KR" | "US"; etfCount: number;
  direction: "up" | "down"; delta: number; topStocks: string[];
}
interface RebalancingData {
  newEntries: RebalStock[]; exits: RebalStock[];
  bigBuys: RebalStock[]; bigSells: RebalStock[];
  sectorMoves: SectorMove[];
  etfsAnalyzed: number; etfsWithChanges: number;
  hasChanges: boolean; updatedAt: string;
}

function RebalancingTab() {
  const [data, setData]             = useState<RebalancingData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [view, setView]             = useState<"changes" | "sector">("changes");

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/etf/rebalancing"), { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "로드 실패");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Loader2 className="w-7 h-7 animate-spin text-primary/50" />
      <p className="text-sm text-muted-foreground">24개 ETF 리밸런싱 데이터 집계 중…</p>
      <p className="text-xs text-muted-foreground/50">처음 로드 시 30~40초 소요</p>
    </div>
  );

  if (error || !data) return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-muted-foreground">데이터를 불러오지 못했습니다.</p>
      <button onClick={() => load(true)} className="text-xs text-primary hover:underline">다시 시도</button>
    </div>
  );

  const updatedLabel = (() => {
    try { return new Date(data.updatedAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return data.updatedAt; }
  })();

  // "신규 편입 + 비중 확대" 합산 (매수 방향)
  const buySignals = [
    ...data.newEntries.map(s => ({ ...s, type: "new" as const })),
    ...data.bigBuys.filter(s => !data.newEntries.find(n => n.ticker === s.ticker)).map(s => ({ ...s, type: "buy" as const })),
  ].sort((a, b) => b.etfs.length - a.etfs.length).slice(0, 12);

  // "제외 + 비중 축소" 합산 (매도 방향)
  const sellSignals = [
    ...data.exits.map(s => ({ ...s, type: "exit" as const })),
    ...data.bigSells.filter(s => !data.exits.find(n => n.ticker === s.ticker)).map(s => ({ ...s, type: "sell" as const })),
  ].sort((a, b) => b.etfs.length - a.etfs.length).slice(0, 12);

  const hasBuy  = buySignals.length > 0;
  const hasSell = sellSignals.length > 0;
  const hasSectorMoves = data.sectorMoves.length > 0;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground/60">
          {data.etfsAnalyzed}개 ETF 추적
          {data.hasChanges
            ? <span className="ml-1.5 text-primary/70">· {data.etfsWithChanges}개에서 변화 감지</span>
            : <span className="ml-1.5 text-amber-500/70">· 기준점 수집 중</span>
          }
          <span className="ml-2 text-muted-foreground/40">· {updatedLabel}</span>
        </p>
        <button
          onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-muted/30"
        >
          <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
          새로고침
        </button>
      </div>

      {/* 기준점 수집 중 안내 */}
      {!data.hasChanges && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
            <GitCommitHorizontal className="w-4 h-4 text-amber-500/70" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-foreground">기준점 수집 중</p>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
              처음 실행 시 현재 보유종목을 기준점으로 저장합니다. 다음 번 ETF 공시 이후 변화를 추적합니다. 아래는 현재 ETF들이 가장 많이 담고 있는 섹터입니다.
            </p>
          </div>
        </div>
      )}

      {/* 뷰 탭 (변화 있을 때만) */}
      {data.hasChanges && (
        <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-0.5 border border-border/50">
          {([
            { key: "changes", label: "종목 변화", icon: <GitCommitHorizontal className="w-3 h-3" /> },
            { key: "sector",  label: "섹터 방향", icon: <BarChart2 className="w-3 h-3" /> },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setView(t.key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] font-semibold rounded-lg transition-all",
                view === t.key ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── 종목 변화 뷰 ── */}
      {(!data.hasChanges || view === "changes") && (
        <div className="space-y-3">
          {/* 매수 신호 */}
          {hasBuy && (
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-emerald-500/3">
                <div className="w-5 h-5 rounded-md bg-emerald-500/15 flex items-center justify-center">
                  <ArrowUp className="w-3 h-3 text-emerald-500" />
                </div>
                <span className="text-[12px] font-bold text-foreground">신규 편입 · 비중 확대</span>
                <span className="ml-auto text-[11px] font-bold text-emerald-500">{buySignals.length}개 종목</span>
              </div>
              <div className="divide-y divide-border/30">
                {buySignals.map((s) => (
                  <div key={s.ticker} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                    {/* 타입 배지 */}
                    <div className={cn(
                      "shrink-0 w-6 h-6 rounded-md flex items-center justify-center",
                      s.type === "new" ? "bg-emerald-500/15" : "bg-blue-500/10"
                    )}>
                      {s.type === "new"
                        ? <Plus className="w-3 h-3 text-emerald-500" />
                        : <ArrowUp className="w-3 h-3 text-blue-400" />
                      }
                    </div>
                    {/* 종목명 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-bold text-foreground truncate">{s.name || s.ticker}</span>
                        <span className={cn(
                          "text-[9px] px-1.5 py-0.5 rounded font-semibold",
                          s.region === "KR" ? "bg-indigo-500/10 text-indigo-400" : "bg-cyan-500/10 text-cyan-400"
                        )}>{s.region}</span>
                        {s.type === "new" && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-bold">NEW</span>}
                      </div>
                      {/* ETF 태그 */}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.etfs.slice(0, 3).map(e => (
                          <span key={e} className="text-[9px] px-1.5 py-0.5 rounded-md bg-muted/40 text-muted-foreground/70 truncate max-w-[110px]">{e}</span>
                        ))}
                        {s.etfs.length > 3 && <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-muted/20 text-muted-foreground/50">+{s.etfs.length - 3}</span>}
                      </div>
                    </div>
                    {/* 숫자 */}
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-black text-foreground">{s.etfs.length}<span className="text-[9px] font-normal text-muted-foreground/60 ml-0.5">ETF</span></p>
                      {s.delta != null && Math.abs(s.delta) > 0 && (
                        <p className="text-[11px] font-bold text-emerald-500">+{s.delta.toFixed(1)}%</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 매도 신호 */}
          {hasSell && (
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-red-500/3">
                <div className="w-5 h-5 rounded-md bg-red-500/10 flex items-center justify-center">
                  <ArrowDown className="w-3 h-3 text-red-400" />
                </div>
                <span className="text-[12px] font-bold text-foreground">제외 · 비중 축소</span>
                <span className="ml-auto text-[11px] font-bold text-red-400">{sellSignals.length}개 종목</span>
              </div>
              <div className="divide-y divide-border/30">
                {sellSignals.map((s) => (
                  <div key={s.ticker} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                    <div className={cn(
                      "shrink-0 w-6 h-6 rounded-md flex items-center justify-center",
                      s.type === "exit" ? "bg-red-500/10" : "bg-orange-500/10"
                    )}>
                      {s.type === "exit"
                        ? <Minus className="w-3 h-3 text-red-400" />
                        : <ArrowDown className="w-3 h-3 text-orange-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-bold text-foreground truncate">{s.name || s.ticker}</span>
                        <span className={cn(
                          "text-[9px] px-1.5 py-0.5 rounded font-semibold",
                          s.region === "KR" ? "bg-indigo-500/10 text-indigo-400" : "bg-cyan-500/10 text-cyan-400"
                        )}>{s.region}</span>
                        {s.type === "exit" && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-bold">EXIT</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.etfs.slice(0, 3).map(e => (
                          <span key={e} className="text-[9px] px-1.5 py-0.5 rounded-md bg-muted/40 text-muted-foreground/70 truncate max-w-[110px]">{e}</span>
                        ))}
                        {s.etfs.length > 3 && <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-muted/20 text-muted-foreground/50">+{s.etfs.length - 3}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-black text-foreground">{s.etfs.length}<span className="text-[9px] font-normal text-muted-foreground/60 ml-0.5">ETF</span></p>
                      {s.delta != null && Math.abs(s.delta) > 0 && (
                        <p className="text-[11px] font-bold text-red-400">{s.delta.toFixed(1)}%</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasBuy && !hasSell && data.hasChanges && (
            <div className="py-10 text-center text-sm text-muted-foreground">감지된 변화 없음</div>
          )}
        </div>
      )}

      {/* ── 섹터 방향 뷰 ── */}
      {(view === "sector" || !data.hasChanges) && hasSectorMoves && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
            <Layers className="w-3.5 h-3.5 text-primary/60" />
            <span className="text-[12px] font-bold text-foreground">
              {data.hasChanges ? "섹터별 매니저 방향" : "현재 ETF 섹터 분포"}
            </span>
          </div>
          <div className="divide-y divide-border/30">
            {data.sectorMoves.map((s) => {
              const isUp = s.direction === "up";
              return (
                <div key={`${s.region}-${s.sector}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors">
                  <div className={cn(
                    "shrink-0 w-6 h-6 rounded-md flex items-center justify-center",
                    isUp ? "bg-emerald-500/12" : "bg-red-500/10"
                  )}>
                    {isUp
                      ? <TrendingUp className="w-3 h-3 text-emerald-500" />
                      : <TrendingDown className="w-3 h-3 text-red-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-foreground">{s.sector}</span>
                      <span className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded font-semibold",
                        s.region === "KR" ? "bg-indigo-500/10 text-indigo-400" : "bg-cyan-500/10 text-cyan-400"
                      )}>{s.region}</span>
                    </div>
                    {s.topStocks.length > 0 && (
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">{s.topStocks.join(", ")}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <p className={cn("text-[13px] font-black", isUp ? "text-emerald-500" : "text-red-400")}>
                      {isUp ? "+" : ""}{s.delta.toFixed(1)}%
                    </p>
                    <p className="text-[9px] text-muted-foreground/50">{s.etfCount}개 ETF</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 면책 */}
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground/50 bg-muted/20 rounded-xl px-3 py-2.5 border border-border/50">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>ETF 보유 종목 공시 주기에 따라 변화 감지에 시차가 있을 수 있습니다. 한국 ETF는 KIS·삼성·미래에셋·KRX, 미국 ETF는 Yahoo Finance 기준입니다.</p>
      </div>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function ETFAnalysis() {
  const [tab, setTab] = useState<"search" | "rebalancing" | "flow">("flow");

  return (
    <div className="space-y-5 pb-20">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">
          ETF 분석
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          국내·해외 ETF 구성 종목 분석
        </p>
      </div>

      {/* 탭 전환 */}
      <div className="flex gap-1 p-1 rounded-2xl bg-muted/30 border border-border">
        {([
          { key: "search",       label: "ETF 검색",  sub: "종목 검색·리포트",      icon: <Search className="w-3.5 h-3.5" /> },
          { key: "rebalancing",  label: "리밸런싱",   sub: "편입·제외·섹터 방향",   icon: <GitCommitHorizontal className="w-3.5 h-3.5" /> },
          { key: "flow",         label: "집중 종목",  sub: "스마트머니 현황",        icon: <Activity className="w-3.5 h-3.5" /> },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 flex flex-col items-center py-2.5 px-2 rounded-xl text-xs font-semibold transition-all gap-0.5",
              tab === t.key
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-1.5 font-bold">{t.icon}{t.label}</span>
            <span className={cn("text-[10px] font-normal", tab === t.key ? "text-muted-foreground/60" : "text-muted-foreground/40")}>
              {t.sub}
            </span>
          </button>
        ))}
      </div>

      {tab === "search"      && <SearchTab />}
      {tab === "rebalancing" && <RebalancingTab />}
      {tab === "flow"        && <FundFlowTab />}
    </div>
  );
}
