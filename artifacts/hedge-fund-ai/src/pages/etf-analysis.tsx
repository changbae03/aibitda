import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";
import {
  Search, TrendingUp, TrendingDown, Loader2, RefreshCw,
  BarChart3, Zap, LayoutGrid, ChevronRight, Info,
  Building2, Globe, ArrowUpDown, Brain, Sparkles,
  Flame, Target, Activity, X, ChevronDown,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface ETFInfo {
  code: string; isuCd: string; name: string; sector: string;
  issuer: string; yahooCode: string; leverage: number; ter?: number; benchmark?: string;
}
interface ETFHolding {
  rank: number; stockCode: string; stockName: string; weight: number;
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
interface MomentumAnalysis {
  macro: MacroSnapshot;
  environment: MacroEnvironment;
  nowSectors: SectorMomentum[];
  futureSectors: SectorMomentum[];
  marketPulse: MarketPulse;
  updatedAt: number;
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
                  {etfResult.holdings.map(h => (
                    <div key={h.rank} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-muted-foreground/40 w-4 text-right">{h.rank}</span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{h.stockName}</p>
                          <p className="text-[11px] text-muted-foreground/50">{h.stockCode}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.min(100, h.weight * 2.5)}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold text-foreground w-12 text-right">{h.weight.toFixed(2)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2.5 bg-muted/10 border-t border-border flex items-center justify-between gap-4">
                  <p className="text-[10px] text-muted-foreground/50">
                    {etfResult.source === "kis"      && "* KIS Open API"}
                    {etfResult.source === "samsung"  && "* 삼성자산운용 공시"}
                    {etfResult.source === "mirae"    && "* 미래에셋자산운용 공시"}
                    {etfResult.source === "krx"      && "* KRX 공시"}
                    {etfResult.source === "yahoo"    && "* Yahoo Finance — 분기별 비중 기준"}
                    {etfResult.source === "reference" && "* 참고용 — 실제 비중과 차이가 있을 수 있습니다"}
                  </p>
                  {etfResult.dataDate && (
                    <p className="text-[10px] text-muted-foreground/60 shrink-0 font-medium">
                      기준일 {etfResult.dataDate}
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

function MomentumTab() {
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

          {/* ── 탭 1: 거시 지표 기반 ETF 추천 ── */}
          {subTab === "macro" && (
            <div className="space-y-6">
              {/* 매크로 지표 */}
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-1 mb-2">주요 매크로 지표</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  <div>
                    <MacroStatRow label="한국 기준금리" value={`${data.macro.krRate}%`} signal={data.macro.krRate > 2.5 ? "고금리" : "안정"} isWarn={data.macro.krRate > 2.5} />
                    <MacroStatRow label="미국 Fed 금리" value={`${data.macro.usRate}%`} signal={data.macro.usRate > 3.0 ? "고금리" : "완화"} isWarn={data.macro.usRate > 3.0} />
                    <MacroStatRow label="원/달러 환율" value={`${data.macro.krwUsd.toLocaleString()}원`} signal={data.macro.krwUsd > 1400 ? "원화약세" : "안정"} isWarn={data.macro.krwUsd > 1400} />
                  </div>
                  <div>
                    <MacroStatRow label="미국 물가(CPI)" value={`${data.macro.usCpi.toFixed(1)}%`} signal={data.macro.usCpi > 3.0 ? "목표초과" : "안정"} isWarn={data.macro.usCpi > 3.0} />
                    <MacroStatRow label="국제 유가(WTI)" value={`$${data.macro.wti.toFixed(0)}`} signal={data.macro.wti > 80 ? "고유가" : "안정"} isWarn={data.macro.wti > 80} />
                    <MacroStatRow label="장단기 금리차" value={`${data.macro.yieldSpread > 0 ? "+" : ""}${data.macro.yieldSpread.toFixed(2)}%`} signal={data.macro.yieldSpread > 0.2 ? "정상화" : "역전경고"} isWarn={data.macro.yieldSpread <= 0.2} />
                  </div>
                </div>
                <p className="text-[12px] text-muted-foreground leading-relaxed pt-3 px-1 border-t border-border/30">
                  {buildMacroNarrative(data.macro, data.environment)}
                </p>
              </div>

              {/* 지금 유망 섹터 */}
              <div>
                <div className="flex items-center justify-between px-1 mb-1">
                  <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">지금 유망 섹터</p>
                  <span className="text-[11px] text-muted-foreground/50">탭해서 ETF 확인</span>
                </div>
                {data.nowSectors.map((s, i) => {
                  const { regular, leveraged, inverse } = getEtfsForSector(s.sectorTags);
                  return (
                    <SectorAccordionRow
                      key={s.id} sector={s} isNow={true} rank={i}
                      etfs={regular} levEtfs={leveraged} invEtfs={inverse}
                      handleEtfClick={handleEtfClick} selectedEtfCode={selectedEtfCode}
                      etfDetail={etfDetail} loadingEtf={loadingEtf} closeDetail={closeDetail} allEtfs={allEtfs}
                    />
                  );
                })}
              </div>

              {/* 앞으로 주목 섹터 */}
              <div>
                <div className="flex items-center justify-between px-1 mb-1">
                  <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">앞으로 주목 섹터</p>
                  <span className="text-[11px] text-muted-foreground/50">향후 3–12개월 관점</span>
                </div>
                {data.futureSectors.map((s, i) => {
                  const { regular, leveraged, inverse } = getEtfsForSector(s.sectorTags);
                  return (
                    <SectorAccordionRow
                      key={s.id} sector={s} isNow={false} rank={i}
                      etfs={regular} levEtfs={leveraged} invEtfs={inverse}
                      handleEtfClick={handleEtfClick} selectedEtfCode={selectedEtfCode}
                      etfDetail={etfDetail} loadingEtf={loadingEtf} closeDetail={closeDetail} allEtfs={allEtfs}
                    />
                  );
                })}
              </div>
            </div>
          )}

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

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

type Tab = "search" | "momentum";

export default function ETFAnalysis() {
  const { isEn }      = useLanguage();
  const initTab = (): Tab => {
    const p = new URLSearchParams(window.location.search).get("tab");
    return p === "momentum" ? "momentum" : "search";
  };
  const [tab, setTab] = useState<Tab>(initTab);

  return (
    <div className="space-y-5 pb-20">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">
          ETF 분석
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          국내·해외 ETF 구성 종목 · 매크로 기반 섹터 모멘텀 분석
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 p-1 rounded-2xl bg-muted/30 border border-border">
        <button
          onClick={() => setTab("search")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all",
            tab === "search"
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Search className="w-3.5 h-3.5" />
          <span>ETF / 종목 검색</span>
        </button>
        <button
          onClick={() => setTab("momentum")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all",
            tab === "momentum"
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>ETF 모멘텀 분석</span>
        </button>
      </div>

      {/* 탭 콘텐츠 */}
      {tab === "search"   && <SearchTab />}
      {tab === "momentum" && <MomentumTab />}
    </div>
  );
}
