import { useState, useEffect, useCallback, useRef, useMemo, useId } from "react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { ko, enUS } from "date-fns/locale";
import {
  CalendarDays, RefreshCw, TrendingUp, DollarSign,
  ChevronRight, Building2, AlertCircle, Sparkles, Globe, X,
  ChevronDown, TrendingDown, Minus,
} from "lucide-react";
import { cn, getApiUrl, formatCurrency } from "@/lib/utils";
import StockLogo from "@/components/ui/stock-logo";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/language-context";
import { getKrEngName } from "@/lib/kr-eng-names";

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface EarningsEntry {
  ticker: string;
  companyName: string;
  earningsDate: string;
  epsEstimate: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  revenueEstimate: number | null;
  revenueLow?: number | null;
  revenueHigh?: number | null;
  analyticCount?: number | null;
  fiscalQuarterEnding?: string | null;
  epsActualPrev?: number | null;
  epsEstimatePrev?: number | null;
  epsSurprisePct?: number | null;
  currency: string;
  isKorean: boolean;
  isCompleted?: boolean;
}

interface DartDisclosure {
  ticker: string;
  companyName: string;
  disclosureDate: string;
  reportName: string;
  dartUrl: string;
}

interface EconomicEvent {
  date: string;
  time?: string;
  title: string;
  country: string;
  category: string;
  importance: "high" | "medium" | "low";
  forecast?: string;
  previous?: string;
  unit?: string;
}

type CalendarItem =
  | { kind: "earnings"; date: string; data: EarningsEntry }
  | { kind: "economic"; date: string; data: EconomicEvent };

type Range = "week" | "month";
type Filter = "all" | "earnings" | "economic";

// ── 주요 지표 추이 타입 ────────────────────────────────────────────────────────
interface IndicatorPoint { date: string; value: number; }
interface IndicatorSeries {
  id: string;
  name: string;
  nameEn: string;
  country: string;
  unit: string;
  category: string;
  frequency: "monthly" | "quarterly";
  data: IndicatorPoint[];
  targetLine?: number;
  rangeLabel?: string;  // FOMC 기준금리 레인지 (예: "4.25~4.50%")
}

// ── 클라이언트 캐시 ────────────────────────────────────────────────────────────
const _earningsCache = new Map<string, { data: EarningsEntry[]; fetchedAt: number }>();
const _economicCache = new Map<string, { data: EconomicEvent[]; fetchedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── 헬퍼 함수 ─────────────────────────────────────────────────────────────────
function fmtEps(val: number | null, currency: string): string {
  if (val == null) return "—";
  if (currency === "KRW") return `${Math.round(val).toLocaleString("ko-KR")}원`;
  return `$${val.toFixed(2)}`;
}

function fmtRevenue(val: number | null, isKorean: boolean): string {
  if (val == null) return "—";
  if (isKorean) {
    if (val >= 1e12) return `${(val / 1e12).toFixed(1)}조원`;
    if (val >= 1e8) return `${(val / 1e8).toFixed(0)}억원`;
    return `${val.toLocaleString("ko-KR")}원`;
  }
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

function DateBadge({ dateStr }: { dateStr: string }) {
  const { isEn } = useLanguage();
  const d = parseISO(dateStr);
  if (isToday(d)) return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 ml-2">
      {isEn ? "Today" : "오늘"}
    </span>
  );
  if (isTomorrow(d)) return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ml-2">
      {isEn ? "Tomorrow" : "내일"}
    </span>
  );
  return null;
}

function ExchangeBadge({ ticker, isKorean }: { ticker: string; isKorean: boolean }) {
  const exchange = ticker.endsWith(".KS") ? "KOSPI" : ticker.endsWith(".KQ") ? "KOSDAQ" : isKorean ? "KRX" : "US";
  const cls = isKorean
    ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
    : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300";
  return <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", cls)}>{exchange}</span>;
}

const COUNTRY_FLAG: Record<string, string> = {
  US: "🇺🇸", KR: "🇰🇷", EU: "🇪🇺", EZ: "🇪🇺", CN: "🇨🇳", JP: "🇯🇵",
  DE: "🇩🇪", GB: "🇬🇧", FR: "🇫🇷", AU: "🇦🇺", CA: "🇨🇦",
};

// ── 경제지표 한국어 제목 → 영어 번역 ─────────────────────────────────────────
// Gemini가 생성하는 한국어 이벤트명을 키워드 매칭으로 영어로 변환
const ECONOMIC_TITLE_EN: Array<[RegExp, string]> = [
  // 미국
  [/FOMC.*금리|연방준비제도.*금리|연준.*금리결정/i,       "FOMC Rate Decision"],
  [/FOMC/i,                                              "FOMC"],
  [/비농업.*고용|비농업일자리|비농업고용/i,               "Non-Farm Payrolls (NFP)"],
  [/신규.*실업.*수당|실업수당.*청구/i,                    "Initial Jobless Claims"],
  [/실업률/i,                                            "Unemployment Rate"],
  [/소매.*판매/i,                                        "Retail Sales"],
  [/ISM.*제조업.*PMI|ISM.*제조업/i,                      "ISM Manufacturing PMI"],
  [/ISM.*서비스.*PMI|ISM.*서비스업/i,                    "ISM Services PMI"],
  [/PCE.*물가|개인소비지출.*물가/i,                       "PCE Price Index"],
  [/PPI|생산자.*물가/i,                                   "Producer Price Index (PPI)"],
  [/미국.*CPI|미국.*소비자.*물가/i,                       "US CPI"],
  [/CPI|소비자.*물가/i,                                   "Consumer Price Index (CPI)"],
  [/미국.*GDP|미국.*국내총생산/i,                         "US GDP"],
  [/GDP.*성장|국내총생산.*성장/i,                         "GDP Growth Rate"],
  [/GDP/i,                                               "GDP"],
  [/내구재.*주문/i,                                       "Durable Goods Orders"],
  [/주택.*착공|신규.*주택.*착공/i,                        "Housing Starts"],
  [/기존.*주택.*판매/i,                                   "Existing Home Sales"],
  [/신규.*주택.*판매/i,                                   "New Home Sales"],
  [/소비자.*심리|미시간.*심리/i,                          "Consumer Sentiment (UMich)"],
  [/컨퍼런스.*소비자.*신뢰/i,                             "Conference Board Consumer Confidence"],
  // 한국
  [/한국은행.*기준금리|BOK.*금리/i,                       "Bank of Korea Rate Decision"],
  [/한국.*무역수지/i,                                     "Korea Trade Balance"],
  [/한국.*산업생산/i,                                     "Korea Industrial Production"],
  [/한국.*GDP/i,                                          "Korea GDP"],
  // 유로존
  [/ECB.*금리|유럽중앙은행.*금리/i,                       "ECB Rate Decision"],
  [/유로존.*CPI|유로존.*소비자.*물가/i,                   "Eurozone CPI"],
  [/유로존.*GDP/i,                                        "Eurozone GDP"],
  [/유로존.*PMI/i,                                        "Eurozone PMI"],
  // 중국
  [/중국.*제조업.*PMI/i,                                  "China Manufacturing PMI"],
  [/중국.*비제조업.*PMI/i,                                "China Non-Manufacturing PMI"],
  [/중국.*PMI/i,                                          "China PMI"],
  [/중국.*CPI|중국.*소비자.*물가/i,                       "China CPI"],
  [/중국.*무역수지/i,                                     "China Trade Balance"],
  [/중국.*GDP/i,                                          "China GDP"],
  // 일본
  [/BOJ.*금리|일본은행.*금리/i,                           "BOJ Rate Decision"],
  [/일본.*CPI|일본.*소비자.*물가/i,                       "Japan CPI"],
  [/일본.*GDP/i,                                          "Japan GDP"],
  [/일본.*무역수지/i,                                     "Japan Trade Balance"],
  // 공통
  [/금리결정|금리.*결정/i,                                "Rate Decision"],
  [/무역수지/i,                                           "Trade Balance"],
  [/제조업.*PMI/i,                                        "Manufacturing PMI"],
  [/서비스.*PMI|비제조업.*PMI/i,                          "Services PMI"],
  [/PMI/i,                                                "PMI"],
  [/산업생산/i,                                           "Industrial Production"],
];

function translateEconomicTitle(title: string): string {
  for (const [pattern, en] of ECONOMIC_TITLE_EN) {
    if (pattern.test(title)) return en;
  }
  return title;
}

// ── 한국 종목 ticker → 영어 회사명 매핑 ──────────────────────────────────────
const KR_TICKER_EN: Record<string, string> = {
  // KOSPI 대형주
  "005930.KS": "Samsung Electronics", "005930": "Samsung Electronics",
  "000660.KS": "SK Hynix",            "000660": "SK Hynix",
  "373220.KS": "LG Energy Solution",  "373220": "LG Energy Solution",
  "207940.KS": "Samsung Biologics",   "207940": "Samsung Biologics",
  "005380.KS": "Hyundai Motor",       "005380": "Hyundai Motor",
  "068270.KS": "Celltrion",           "068270": "Celltrion",
  "000270.KS": "Kia",                 "000270": "Kia",
  "035420.KS": "NAVER",               "035420": "NAVER",
  "105560.KS": "KB Financial",        "105560": "KB Financial",
  "051910.KS": "LG Chem",             "051910": "LG Chem",
  "055550.KS": "Shinhan Financial",   "055550": "Shinhan Financial",
  "006400.KS": "Samsung SDI",         "006400": "Samsung SDI",
  "035720.KS": "Kakao",               "035720": "Kakao",
  "012330.KS": "Hyundai Mobis",       "012330": "Hyundai Mobis",
  "005490.KS": "POSCO Holdings",      "005490": "POSCO Holdings",
  "086790.KS": "Hana Financial",      "086790": "Hana Financial",
  "066570.KS": "LG Electronics",      "066570": "LG Electronics",
  "028260.KS": "Samsung C&T",         "028260": "Samsung C&T",
  "009150.KS": "Samsung Electro-Mech","009150": "Samsung Electro-Mech",
  "011070.KS": "LG Innotek",          "011070": "LG Innotek",
  "003670.KS": "POSCO Future M",      "003670": "POSCO Future M",
  "316140.KS": "Woori Financial",     "316140": "Woori Financial",
  "010130.KS": "Korea Zinc",          "010130": "Korea Zinc",
  "024110.KS": "IBK",                 "024110": "IBK",
  "017670.KS": "SK Telecom",          "017670": "SK Telecom",
  "323410.KS": "KakaoBank",           "323410": "KakaoBank",
  "377300.KS": "Kakao Pay",           "377300": "Kakao Pay",
  "259960.KS": "Krafton",             "259960": "Krafton",
  "352820.KS": "HYBE",                "352820": "HYBE",
  "030200.KS": "KT",                  "030200": "KT",
  "012450.KS": "Hanwha Aerospace",    "012450": "Hanwha Aerospace",
  "034020.KS": "Doosan Enerbility",   "034020": "Doosan Enerbility",
  "096770.KS": "SK Innovation",       "096770": "SK Innovation",
  "015760.KS": "KEPCO",               "015760": "KEPCO",
  "000720.KS": "Hyundai E&C",         "000720": "Hyundai E&C",
  "329180.KS": "HD Hyundai Heavy Ind","329180": "HD Hyundai Heavy Ind",
  "004020.KS": "Hyundai Steel",       "004020": "Hyundai Steel",
  "036570.KS": "NCSoft",              "036570": "NCSoft",
  "251270.KS": "Netmarble",           "251270": "Netmarble",
  "011170.KS": "Lotte Chemical",      "011170": "Lotte Chemical",
  "086280.KS": "Hyundai Glovis",      "086280": "Hyundai Glovis",
  "010950.KS": "S-Oil",               "010950": "S-Oil",
  "033780.KS": "KT&G",                "033780": "KT&G",
  "009830.KS": "Hanwha Solutions",    "009830": "Hanwha Solutions",
  "267260.KS": "HD Hyundai Electric", "267260": "HD Hyundai Electric",
  "454910.KS": "Doosan Robotics",     "454910": "Doosan Robotics",
  "000100.KS": "Yuhan",               "000100": "Yuhan",
  "128940.KS": "Hanmi Pharm",         "128940": "Hanmi Pharm",
  // KOSDAQ
  "247540.KQ": "EcoPro BM",           "247540": "EcoPro BM",
  "086520.KQ": "EcoPro",              "086520": "EcoPro",
  "028300.KQ": "HLB",                 "028300": "HLB",
  "196170.KQ": "Alteogen",            "196170": "Alteogen",
  "141080.KQ": "LegaChem Bio",        "141080": "LegaChem Bio",
  "214150.KQ": "Classys",             "214150": "Classys",
  "293490.KQ": "Kakao Games",         "293490": "Kakao Games",
  "263750.KQ": "Pearl Abyss",         "263750": "Pearl Abyss",
  "357780.KQ": "SoulBrain",           "357780": "SoulBrain",
  "240810.KQ": "Wonik IPS",           "240810": "Wonik IPS",
  "078160.KQ": "Medipost",            "078160": "Medipost",
  "091990.KQ": "Celltrion Healthcare","091990": "Celltrion Healthcare",
  "048260.KQ": "Osstem Implant",      "048260": "Osstem Implant",
  "069620.KQ": "Daewoong Pharma",     "069620": "Daewoong Pharma",
  "007660.KQ": "ISU Petasys",         "007660": "ISU Petasys",
};

function translateCompanyName(ticker: string, companyName: string): string {
  const enName = KR_TICKER_EN[ticker] ?? KR_TICKER_EN[ticker.replace(/\.(KS|KQ)$/, "")];
  return enName ?? companyName;
}

const IMPORTANCE_STYLE: Record<string, { dot: string; badge: string; ko: string; en: string }> = {
  high:   { dot: "bg-red-500",    badge: "text-red-700 dark:bg-red-900/40 dark:text-red-300",    ko: "매우 중요", en: "High" },
  medium: { dot: "bg-amber-400",  badge: "text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", ko: "중요", en: "Medium" },
  low:    { dot: "bg-slate-300",  badge: "text-slate-500 dark:bg-slate-800 dark:text-slate-400", ko: "보통", en: "Low" },
};

const CATEGORY_ICON: Record<string, string> = {
  금리결정: "🏦", 물가지표: "📊", 고용: "👷", 성장률: "📈",
  무역: "🚢", 제조업: "🏭", 소비: "🛒", 기타: "📋",
};

// ── 서브 컴포넌트 ──────────────────────────────────────────────────────────────
function EarningsCard({ entry, onSelect }: { entry: EarningsEntry; onSelect: (e: EarningsEntry) => void }) {
  const { isEn } = useLanguage();
  const isCompleted   = !!entry.isCompleted;
  const hasEps        = entry.epsEstimate !== null;
  const hasRevenue    = entry.revenueEstimate !== null;
  const hasConsensus  = hasEps || hasRevenue;
  const hasSurprise   = entry.epsSurprisePct != null;
  const shortTicker   = entry.ticker.replace(/\.(KS|KQ)$/, "");
  const surprisePct   = entry.epsSurprisePct ?? 0;
  const surpriseBeat  = surprisePct >= 0;

  const [displayName, setDisplayName] = useState(entry.companyName);
  useEffect(() => {
    if (isEn && entry.isKorean) {
      getKrEngName(entry.ticker).then(name => {
        setDisplayName(name || translateCompanyName(entry.ticker, entry.companyName));
      });
    } else {
      setDisplayName(entry.companyName);
    }
  }, [isEn, entry.ticker, entry.companyName, entry.isKorean]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onSelect(entry)}
      className={cn(
        "flex items-start gap-3 p-3 rounded-xl border bg-card hover:bg-accent/40 active:scale-[0.99] transition-all cursor-pointer",
        isCompleted && hasSurprise
          ? surpriseBeat
            ? "border-l-4 border-l-emerald-500 border-border"
            : "border-l-4 border-l-red-500 border-border"
          : "border-border"
      )}
    >
      <StockLogo ticker={entry.ticker} companyName={entry.companyName} size="sm" className="mt-0.5" />
      <div className="flex-1 min-w-0">
        {/* 종목명 + 뱃지 행 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">
            {displayName}
          </span>
          <ExchangeBadge ticker={entry.ticker} isKorean={entry.isKorean} />
          <span className="text-xs text-muted-foreground">{shortTicker}</span>
          {isCompleted && (
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-medium border",
              hasSurprise && surpriseBeat
                ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
                : hasSurprise
                  ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
                  : "bg-muted text-muted-foreground border-border"
            )}>
              ✓ {isEn ? "Reported" : "발표 완료"}
            </span>
          )}
          {!isCompleted && entry.analyticCount != null && entry.analyticCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground/70 border border-border">
              {entry.analyticCount}{isEn ? " analysts" : "명 추정"}
            </span>
          )}
        </div>

        {entry.fiscalQuarterEnding && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/50">
            {isEn ? `Quarter: ${entry.fiscalQuarterEnding}` : `분기: ${entry.fiscalQuarterEnding}`}
          </p>
        )}

        {/* ── 발표 완료: 실제 결과 표시 ── */}
        {isCompleted && hasSurprise ? (
          <div className="mt-1.5 space-y-0.5">
            {/* EPS 실제 vs 예상 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <TrendingUp className="w-3 h-3" />
                {isEn ? "EPS:" : "EPS 결과:"}
                <span className="text-foreground font-semibold ml-0.5">
                  {entry.epsActualPrev != null ? fmtEps(entry.epsActualPrev, entry.currency) : "—"}
                </span>
              </span>
              {entry.epsEstimatePrev != null && (
                <span className="text-muted-foreground/60 text-[11px]">
                  {isEn ? "est." : "예상"} {fmtEps(entry.epsEstimatePrev, entry.currency)}
                </span>
              )}
            </div>
            {/* 서프라이즈 뱃지 */}
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
              surpriseBeat
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            )}>
              {surpriseBeat ? "▲" : "▼"}
              {" "}{surpriseBeat ? "+" : ""}{surprisePct.toFixed(1)}%
              {" "}{isEn ? "surprise" : "서프라이즈"}
            </span>
          </div>
        ) : isCompleted ? (
          /* 발표 완료지만 서프라이즈 데이터 없음 */
          <p className="mt-1 text-xs text-muted-foreground/60">
            {isEn ? "Results not yet available" : "실적 데이터 집계 중"}
          </p>
        ) : (
          /* ── 발표 예정: 컨센서스 예상치 표시 ── */
          <>
            {hasConsensus ? (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {hasEps && (
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    {isEn ? "EPS Est:" : "EPS 예상:"}{" "}
                    <span className="text-foreground font-medium ml-0.5">{fmtEps(entry.epsEstimate, entry.currency)}</span>
                    {entry.epsLow !== null && entry.epsHigh !== null && (
                      <span className="text-muted-foreground/70">({fmtEps(entry.epsLow, entry.currency)} – {fmtEps(entry.epsHigh, entry.currency)})</span>
                    )}
                  </span>
                )}
                {hasRevenue && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    {isEn ? "Rev Est:" : "매출 예상:"}{" "}
                    <span className="text-foreground font-medium ml-0.5">{fmtRevenue(entry.revenueEstimate, entry.isKorean)}</span>
                    {entry.revenueLow != null && entry.revenueHigh != null && (
                      <span className="text-muted-foreground/70">
                        ({fmtRevenue(entry.revenueLow, entry.isKorean)} – {fmtRevenue(entry.revenueHigh, entry.isKorean)})
                      </span>
                    )}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground/60">{isEn ? "No consensus data" : "컨센서스 데이터 없음"}</p>
            )}
            {/* 발표 예정 카드의 전분기 서프라이즈 참고 */}
            {hasSurprise && (
              <div className="mt-1.5">
                <span className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium",
                  surpriseBeat
                    ? "bg-emerald-100/60 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-500"
                    : "bg-red-100/60 text-red-700 dark:bg-red-900/20 dark:text-red-500"
                )}>
                  {surpriseBeat ? "▲" : "▼"}
                  {isEn ? " Prev Q:" : " 전분기 참고:"}
                  {entry.epsActualPrev != null && <span className="ml-0.5">{fmtEps(entry.epsActualPrev, entry.currency)}</span>}
                  <span className="ml-0.5">
                    ({surpriseBeat ? "+" : ""}{surprisePct.toFixed(1)}%)
                  </span>
                </span>
              </div>
            )}
          </>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-1" />
    </motion.div>
  );
}

// ── 주요 지표 추이 컴포넌트 ────────────────────────────────────────────────────
const COUNTRY_FLAG_INDICATOR: Record<string, string> = {
  US: "🇺🇸", KR: "🇰🇷", EU: "🇪🇺", CN: "🇨🇳", JP: "🇯🇵",
};

/** 지표별 색상/방향 계산 */
function getIndicatorTheme(s: IndicatorSeries): { color: string; bg: string; trend: "up" | "down" | "flat" } {
  const vals = s.data.map(d => d.value);
  if (vals.length < 2) return { color: "#6366f1", bg: "bg-indigo-500/10", trend: "flat" };
  const last = vals[vals.length - 1];
  const prev = vals[vals.length - 2];
  const trend: "up" | "down" | "flat" = Math.abs(last - prev) < 0.01 ? "flat" : last > prev ? "up" : "down";

  if (s.id === "fed-rate") {
    return { color: "#6366f1", bg: "bg-indigo-500/10", trend };
  }
  if (s.id === "us-cpi" || s.id === "core-pce") {
    // 목표 2% 기준 — 내려가면 good(green), 올라가면 bad(red)
    if (last <= 2.5) return { color: "#22c55e", bg: "bg-emerald-500/10", trend };
    if (last <= 3.5) return { color: "#f59e0b", bg: "bg-amber-500/10", trend };
    return { color: trend === "down" ? "#f59e0b" : "#ef4444", bg: trend === "down" ? "bg-amber-500/10" : "bg-red-500/10", trend };
  }
  if (s.id === "unemployment") {
    // 낮을수록 good
    if (last < 4.0) return { color: "#22c55e", bg: "bg-emerald-500/10", trend };
    if (last < 5.0) return { color: "#f59e0b", bg: "bg-amber-500/10", trend };
    return { color: "#ef4444", bg: "bg-red-500/10", trend };
  }
  if (s.id === "us-gdp") {
    if (last >= 2.0) return { color: "#22c55e", bg: "bg-emerald-500/10", trend };
    if (last >= 0) return { color: "#f59e0b", bg: "bg-amber-500/10", trend };
    return { color: "#ef4444", bg: "bg-red-500/10", trend };
  }
  if (s.id === "us-ppi") {
    if (last <= 2.5) return { color: "#22c55e", bg: "bg-emerald-500/10", trend };
    if (last <= 4.0) return { color: "#f59e0b", bg: "bg-amber-500/10", trend };
    return { color: trend === "down" ? "#f59e0b" : "#ef4444", bg: trend === "down" ? "bg-amber-500/10" : "bg-red-500/10", trend };
  }
  if (s.id === "us-nfp") {
    // 고용 증가는 good, 감소는 bad
    if (last >= 150) return { color: "#22c55e", bg: "bg-emerald-500/10", trend };
    if (last >= 50) return { color: "#f59e0b", bg: "bg-amber-500/10", trend };
    return { color: "#ef4444", bg: "bg-red-500/10", trend };
  }
  return { color: "#6366f1", bg: "bg-indigo-500/10", trend };
}

/** 미니 스파크라인 (순수 SVG) */
function Sparkline({ data, color, targetLine, w = 96, h = 38 }: {
  data: number[]; color: string; targetLine?: number; w?: number; h?: number;
}) {
  const uid = useId().replace(/:/g, "");
  if (data.length < 2) return <div style={{ width: w, height: h }} />;

  const pad = 3;
  const allVals = targetLine !== undefined ? [...data, targetLine] : data;
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const xScale = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const yScale = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);

  const points = data.map((v, i) => `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`);
  const areaD = [
    `M ${points[0]}`,
    ...points.slice(1).map(p => `L ${p}`),
    `L ${xScale(data.length - 1).toFixed(1)},${h}`,
    `L ${xScale(0).toFixed(1)},${h}`,
    "Z",
  ].join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#sg-${uid})`} />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {targetLine !== undefined && (
        <line
          x1={pad} y1={yScale(targetLine).toFixed(1)}
          x2={w - pad} y2={yScale(targetLine).toFixed(1)}
          stroke={color} strokeWidth={0.8} strokeDasharray="3,2" opacity={0.35}
        />
      )}
      <circle cx={xScale(data.length - 1).toFixed(1)} cy={yScale(data[data.length - 1]).toFixed(1)} r={2.5} fill={color} />
    </svg>
  );
}

/** 히스토리 테이블 (펼쳤을 때) */
function IndicatorHistoryTable({ series, isEn }: { series: IndicatorSeries; isEn: boolean }) {
  const rows = [...series.data].reverse().slice(0, 12);
  return (
    <div className="mt-2 rounded-lg border border-border/50 overflow-hidden">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="bg-muted/40">
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">{isEn ? "Date" : "날짜"}</th>
            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">{isEn ? "Value" : "값"}</th>
            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">{isEn ? "Change" : "변동"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const nextRow = rows[i + 1];
            const delta = nextRow ? row.value - nextRow.value : null;
            return (
              <tr key={row.date} className="border-t border-border/30 hover:bg-accent/20 transition-colors">
                <td className="px-2 py-1.5 text-muted-foreground font-mono">{row.date.slice(0, 7)}</td>
                <td className="px-2 py-1.5 text-right font-mono font-medium text-foreground">
                  {row.value.toFixed(series.id === "us-gdp" ? 1 : 2)}{series.unit}
                </td>
                <td className={cn(
                  "px-2 py-1.5 text-right font-mono",
                  delta === null ? "text-muted-foreground/40" :
                  delta > 0 ? "text-emerald-500" : delta < 0 ? "text-red-400" : "text-muted-foreground/40"
                )}>
                  {delta === null ? "—" :
                    `${delta > 0 ? "▲" : delta < 0 ? "▼" : ""}${Math.abs(delta).toFixed(2)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 지표 하나의 카드 */
function IndicatorCard({ series, isEn }: { series: IndicatorSeries; isEn: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { color, bg, trend } = useMemo(() => getIndicatorTheme(series), [series]);
  const vals = (series.data ?? []).map(d => d.value).filter(v => v != null && !isNaN(v));

  // 데이터 없으면 렌더링 생략 (빈 배열로 last.toFixed() 호출 방지)
  if (vals.length === 0) return null;

  const last = vals[vals.length - 1];
  const prev = vals[vals.length - 2] ?? last;
  const delta = last - prev;
  const lastDate = series.data[series.data.length - 1]?.date ?? "";
  const dateLabel = lastDate.slice(0, 7); // YYYY-MM

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <div className={cn("rounded-xl border border-border bg-card/60 overflow-hidden transition-all", expanded && "border-border/80")}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-3 pt-3 pb-2 hover:bg-accent/20 transition-colors"
      >
        {/* 헤더 행 */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm">{COUNTRY_FLAG_INDICATOR[series.country] ?? "🌐"}</span>
            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", bg, "text-foreground/70")}>{series.category}</span>
          </div>
          <ChevronDown className={cn("w-3 h-3 text-muted-foreground/40 transition-transform mt-0.5 shrink-0", expanded && "rotate-180")} />
        </div>

        {/* 지표명 */}
        <p className="text-[11px] font-medium text-foreground/80 mb-2 leading-tight">
          {isEn ? series.nameEn : series.name}
        </p>

        {/* 값 + 스파크라인 */}
        <div className="flex items-end justify-between gap-2">
          <div>
            {series.rangeLabel ? (
              /* FOMC 레인지 표시 (연방기금금리) */
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold text-foreground font-mono leading-none tracking-tight">
                    {series.rangeLabel}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[9px] text-muted-foreground/50">{isEn ? "FOMC target range" : "FOMC 목표 레인지"}</span>
                  <span className="text-[9px] text-muted-foreground/30">·</span>
                  <span className="text-[9px] text-muted-foreground/40">{dateLabel}</span>
                </div>
              </>
            ) : (
              /* 일반 단일값 표시 */
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold text-foreground font-mono leading-none">
                    {last.toFixed(series.id === "us-gdp" ? 1 : 2)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">{series.unit}</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <TrendIcon className="w-2.5 h-2.5" style={{ color }} />
                  <span className="text-[10px] font-mono" style={{ color }}>
                    {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                  </span>
                  <span className="text-[9px] text-muted-foreground/40">{dateLabel}</span>
                </div>
              </>
            )}
          </div>
          <Sparkline data={vals} color={color} targetLine={series.targetLine} />
        </div>
      </button>

      {/* 펼쳤을 때: 히스토리 테이블 */}
      {expanded && (
        <div className="px-3 pb-3">
          {series.targetLine !== undefined && (
            <p className="text-[10px] text-muted-foreground/50 mb-1.5">
              {isEn ? `Fed target: ${series.targetLine}%` : `목표: ${series.targetLine}%`}
              <span className="ml-1 text-muted-foreground/30">— — —</span>
            </p>
          )}
          <IndicatorHistoryTable series={series} isEn={isEn} />
        </div>
      )}
    </div>
  );
}

/** 주요 지표 추이 전체 섹션 */
const _indicatorCache: { data: IndicatorSeries[]; fetchedAt: number } | null = null;
let _indicatorCacheMut: { data: IndicatorSeries[]; fetchedAt: number } | null = null;

function IndicatorTrendSection() {
  const { isEn } = useLanguage();
  const [indicators, setIndicators] = useState<IndicatorSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (_indicatorCacheMut && Date.now() - _indicatorCacheMut.fetchedAt < 12 * 60 * 60 * 1000) {
      setIndicators(_indicatorCacheMut.data);
      return;
    }
    setLoading(true);
    fetch(getApiUrl("/api/market-data/indicator-history"), { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((data: IndicatorSeries[]) => {
        const valid = (Array.isArray(data) ? data : []).filter(
          s => Array.isArray(s.data) && s.data.length > 0
        );
        _indicatorCacheMut = { data: valid, fetchedAt: Date.now() };
        setIndicators(valid);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mb-5 rounded-xl border border-border bg-card/30 overflow-hidden">
      {/* 섹션 헤더 */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-accent/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-primary/70" />
          <span className="text-xs font-semibold text-foreground/80">
            {isEn ? "Key Indicator Trends" : "주요 지표 추이"}
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            {isEn ? "FRED · real data" : "FRED 실제 데이터"}
          </span>
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/40 transition-transform", collapsed && "-rotate-90")} />
      </button>

      {/* 컨텐츠 */}
      {!collapsed && (
        <div className="px-3 pb-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground/50">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span className="text-xs">{isEn ? "Loading FRED data…" : "FRED 데이터 불러오는 중…"}</span>
            </div>
          ) : error ? (
            <p className="text-xs text-muted-foreground/50 text-center py-4">
              {isEn ? `Failed to load (${error})` : `불러오기 실패 (${error})`}
            </p>
          ) : indicators.length === 0 ? null : (
            <div className="space-y-3">
              {/* 미국 지표 */}
              {indicators.filter(s => s.country === "US").length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2 px-0.5 flex items-center gap-1">
                    🇺🇸 {isEn ? "United States" : "미국"}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {indicators.filter(s => s.country === "US").map(s => (
                      <IndicatorCard key={s.id} series={s} isEn={isEn} />
                    ))}
                  </div>
                </div>
              )}
              {/* 한국 지표 */}
              {indicators.filter(s => s.country === "KR").length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2 px-0.5 flex items-center gap-1">
                    🇰🇷 {isEn ? "South Korea" : "한국"}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {indicators.filter(s => s.country === "KR").map(s => (
                      <IndicatorCard key={s.id} series={s} isEn={isEn} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DART 최근 잠정실적 공시 섹션 ──────────────────────────────────────────────
const _dartCache = new Map<string, { data: DartDisclosure[]; fetchedAt: number }>();

function DartRecentSection() {
  const { isEn } = useLanguage();
  const [disclosures, setDisclosures] = useState<DartDisclosure[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const cached = _dartCache.get(today);
    if (cached && Date.now() - cached.fetchedAt < 3 * 60 * 60 * 1000) {
      setDisclosures(cached.data);
      setLoading(false);
      return;
    }
    fetch(getApiUrl("/api/market-data/dart-recent-earnings?days=14"), { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((data: DartDisclosure[]) => {
        _dartCache.set(today, { data, fetchedAt: Date.now() });
        setDisclosures(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || disclosures.length === 0) return null;

  const shown = expanded ? disclosures : disclosures.slice(0, 4);

  return (
    <div className="mb-4 rounded-xl border border-border bg-card/60 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">DART</span>
          <span className="text-xs font-medium text-foreground">
            {isEn ? "Recent Earnings Disclosures" : "최근 잠정실적 공시"}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {isEn ? `${disclosures.length} filings · 14d` : `${disclosures.length}건 · 최근 14일`}
          </span>
        </div>
        <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground/50 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {shown.map((d, i) => {
            const bare = d.ticker.replace(/\.(KS|KQ)$/, "");
            const krName = d.companyName;
            return (
              <div key={i} className="flex items-center gap-2 py-1 border-t border-border/50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-foreground truncate">{krName}</span>
                    <span className="text-[10px] text-muted-foreground/60">{bare}</span>
                    <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
                      {isEn ? "Filed" : "공시"}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">{d.reportName}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-muted-foreground/60">{d.disclosureDate.slice(5)}</p>
                  <a
                    href={d.dartUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-[10px] text-sky-400 hover:underline"
                  >
                    {isEn ? "View" : "공시 보기"}
                  </a>
                </div>
              </div>
            );
          })}
          {disclosures.length > 4 && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="w-full text-center text-[10px] text-muted-foreground/50 hover:text-muted-foreground pt-1 transition-colors"
            >
              {expanded
                ? (isEn ? "Show less" : "접기")
                : (isEn ? `+${disclosures.length - 4} more` : `+${disclosures.length - 4}건 더 보기`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function fmtIndicator(value: string | undefined | null, unit: string | undefined | null): string {
  if (value == null || value === "") return "N/A";
  const v = String(value).trim();
  if (!unit) return v;
  const u = unit.trim();
  if (v.endsWith(u) || v.toLowerCase().endsWith(u.toLowerCase())) return v;
  return `${v}${u}`;
}

function EconomicCard({ event }: { event: EconomicEvent }) {
  const { isEn } = useLanguage();
  const imp = IMPORTANCE_STYLE[event.importance] ?? IMPORTANCE_STYLE.low;
  const flag = COUNTRY_FLAG[event.country] ?? "🌐";
  const catIcon = CATEGORY_ICON[event.category] ?? "📋";
  const impLabel = isEn ? imp.en : imp.ko;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card"
    >
      <div className="mt-0.5 w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 relative">
        <span className="text-base leading-none">{catIcon}</span>
        <span className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-background", imp.dot)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground leading-snug">
            {isEn ? translateEconomicTitle(event.title) : event.title}
          </span>
          <span className="text-sm">{flag}</span>
          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", imp.badge)}>
            {impLabel}
          </span>
          {event.time && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {event.time.replace(/\s*KST\s*$/i, "")} KST
            </span>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{event.category}</span>
          {event.forecast != null && event.forecast !== "" && (
            <span>{isEn ? "Fcst:" : "예상:"} <span className="text-foreground font-medium">
              {fmtIndicator(event.forecast, event.unit)}
            </span></span>
          )}
          {event.previous != null && event.previous !== "" && (
            <span>{isEn ? "Prev:" : "이전:"} <span className="text-foreground/70">
              {fmtIndicator(event.previous, event.unit)}
            </span></span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function DateGroup({
  date,
  items,
  onSelectEarnings,
}: {
  date: string;
  items: CalendarItem[];
  onSelectEarnings: (e: EarningsEntry) => void;
}) {
  const { isEn } = useLanguage();
  const d = parseISO(date);
  const label = isEn
    ? format(d, "MMM d (EEE)", { locale: enUS })
    : format(d, "M월 d일 (EEE)", { locale: ko });
  const earningsCount = items.filter(i => i.kind === "earnings").length;
  const economicCount = items.filter(i => i.kind === "economic").length;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <DateBadge dateStr={date} />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {earningsCount > 0 && <span>{isEn ? `${earningsCount} Earnings` : `${earningsCount}종목 실적`}</span>}
          {economicCount > 0 && <span>{isEn ? `${economicCount} Indicators` : `${economicCount}개 지표`}</span>}
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item, idx) =>
          item.kind === "earnings" ? (
            <EarningsCard key={`e-${item.data.ticker}`} entry={item.data} onSelect={onSelectEarnings} />
          ) : (
            <EconomicCard key={`ec-${idx}`} event={item.data} />
          )
        )}
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { isEn } = useLanguage();
  const t = (ko: string, en: string) => isEn ? en : ko;

  const [range, setRange] = useState<Range>("week");
  const [filter, setFilter] = useState<Filter>("all");
  const [earnings, setEarnings] = useState<EarningsEntry[]>([]);
  const [economic, setEconomic] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [pendingEntry, setPendingEntry] = useState<EarningsEntry | null>(null);
  const [, navigate] = useLocation();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const fetchAll = useCallback(async (r: Range, forceRefresh = false) => {
    const earCached = _earningsCache.get(r);
    const ecoCached = _economicCache.get(r);
    const earOk = !forceRefresh && earCached && Date.now() - earCached.fetchedAt < CACHE_TTL_MS;
    const ecoOk = !forceRefresh && ecoCached && Date.now() - ecoCached.fetchedAt < CACHE_TTL_MS;

    if (earOk && ecoOk) {
      setEarnings(earCached!.data);
      setEconomic(ecoCached!.data);
      setLastFetched(new Date(Math.max(earCached!.fetchedAt, ecoCached!.fetchedAt)));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range: r });
      const [earRes, ecoRes] = await Promise.all([
        earOk ? null : fetch(getApiUrl(`/api/market-data/earnings-calendar?${params}`), { credentials: "include" }),
        ecoOk ? null : fetch(getApiUrl(`/api/market-data/economic-calendar?${params}`), { credentials: "include" }),
      ]);

      if (earRes && !earRes.ok) throw new Error(`실적 캘린더 오류: ${earRes.status}`);
      if (ecoRes && !ecoRes.ok) throw new Error(`경제지표 캘린더 오류: ${ecoRes.status}`);

      const now = Date.now();
      const newEarnings: EarningsEntry[] = earRes ? await earRes.json() : earCached!.data;
      const newEconomic: EconomicEvent[] = ecoRes ? await ecoRes.json() : ecoCached!.data;

      _earningsCache.set(r, { data: newEarnings, fetchedAt: now });
      _economicCache.set(r, { data: newEconomic, fetchedAt: now });

      if (mountedRef.current) {
        setEarnings(newEarnings);
        setEconomic(newEconomic);
        setLastFetched(new Date(now));
      }
    } catch (e: any) {
      if (mountedRef.current) setError(e.message ?? t("불러오기 실패", "Failed to load"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(range); }, [range, fetchAll]);

  const allItems: CalendarItem[] = [
    ...(filter !== "economic" ? earnings.map(e => ({ kind: "earnings" as const, date: e.earningsDate, data: e })) : []),
    ...(filter !== "earnings" ? economic.map(e => ({ kind: "economic" as const, date: e.date, data: e })) : []),
  ];

  const grouped = allItems.reduce<Record<string, CalendarItem[]>>((acc, item) => {
    if (!acc[item.date]) acc[item.date] = [];
    acc[item.date].push(item);
    return acc;
  }, {});
  for (const date of Object.keys(grouped)) {
    grouped[date].sort((a, b) => {
      const imp = { high: 0, medium: 1, low: 2 };
      const ai = a.kind === "economic" ? imp[a.data.importance] : 3;
      const bi = b.kind === "economic" ? imp[b.data.importance] : 3;
      return ai - bi;
    });
  }
  const sortedDates = Object.keys(grouped).sort();

  const totalEarnings = earnings.length;
  const totalEconomic = economic.length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
      {/* 헤더 */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">{t("마켓 캘린더", "Market Calendar")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("실적 발표 · 경제지표 · 금리결정 등 주요 시장 일정", "Earnings · Economic Indicators · Rate Decisions and more")}
        </p>
      </div>

      {/* 기간 탭 + 새로고침 */}
      <div className="flex items-center gap-2 mb-3">
        {(["week", "month"] as Range[]).map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors",
              range === r
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {r === "week" ? t("이번 주 (7일)", "This Week (7d)") : t("이번 달 (30일)", "This Month (30d)")}
          </button>
        ))}
        <button
          onClick={() => fetchAll(range, true)}
          disabled={loading}
          className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex items-center gap-1.5 mb-4">
        {([
          { key: "all", ko: "전체", en: "All" },
          { key: "earnings", ko: "📢 실적 발표", en: "📢 Earnings" },
          { key: "economic", ko: "📊 경제지표", en: "📊 Economic" },
        ] as { key: Filter; ko: string; en: string }[]).map(({ key, ko: koLabel, en: enLabel }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-medium transition-colors",
              filter === key
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {isEn ? enLabel : koLabel}
          </button>
        ))}
      </div>

      {/* 업데이트 시각 */}
      {lastFetched && !loading && (
        <p className="text-xs text-muted-foreground mb-3">
          {t("업데이트:", "Updated:")} {format(lastFetched, "HH:mm:ss")}
        </p>
      )}

      {/* 콘텐츠 */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center py-16 text-muted-foreground"
          >
            <RefreshCw className="w-8 h-8 animate-spin mb-3 text-primary/60" />
            <p className="text-sm">{t("캘린더 데이터를 불러오는 중…", "Loading calendar data…")}</p>
            <p className="text-xs mt-1 text-muted-foreground/60">{t("실적 + 경제지표 일정 조회 중 (수 초 소요)", "Fetching earnings + economic events (may take a few seconds)")}</p>
          </motion.div>
        ) : error ? (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center py-16 text-muted-foreground"
          >
            <AlertCircle className="w-8 h-8 mb-3 text-destructive/60" />
            <p className="text-sm text-destructive">{error}</p>
            <button onClick={() => fetchAll(range, true)} className="mt-3 text-xs text-primary underline underline-offset-2">
              {t("다시 시도", "Retry")}
            </button>
          </motion.div>
        ) : sortedDates.length === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center py-16 text-muted-foreground"
          >
            <CalendarDays className="w-10 h-10 mb-3 text-muted-foreground/40" />
            <p className="text-sm font-medium">{t("해당 기간 일정 없음", "No events for this period")}</p>
            <p className="text-xs mt-1 text-muted-foreground/60">{t("기간이나 필터를 변경해 보세요", "Try changing the range or filter")}</p>
          </motion.div>
        ) : (
          <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* 요약 배너 */}
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-muted/60 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span>{t(`향후 ${range === "week" ? "7일" : "30일"}`, `Next ${range === "week" ? "7" : "30"} days`)}</span>
              {filter !== "economic" && (
                <span>
                  <span className="font-semibold text-foreground">{totalEarnings}{t("개 종목", " stocks")}</span> {t("실적 발표", "earnings")}
                </span>
              )}
              {filter !== "earnings" && (
                <span>
                  <span className="font-semibold text-foreground">{totalEconomic}{t("개", "")}</span> {t("경제지표", "economic indicators")}
                </span>
              )}
            </div>

            {/* 중요도 범례 */}
            {filter !== "earnings" && (
              <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/60">{t("중요도:", "Importance:")}</span>
                {(["high", "medium", "low"] as const).map(imp => (
                  <span key={imp} className="flex items-center gap-1">
                    <span className={cn("w-2 h-2 rounded-full", IMPORTANCE_STYLE[imp].dot)} />
                    {isEn ? IMPORTANCE_STYLE[imp].en : IMPORTANCE_STYLE[imp].ko}
                  </span>
                ))}
              </div>
            )}

            {/* 주요 지표 추이 섹션 */}
            {filter !== "earnings" && <IndicatorTrendSection />}

            {/* DART 최근 잠정실적 공시 섹션 */}
            {filter !== "economic" && <DartRecentSection />}

            {/* 날짜별 그룹 */}
            {sortedDates.map(date => (
              <DateGroup key={date} date={date} items={grouped[date]} onSelectEarnings={setPendingEntry} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 분석 확인 배너 */}
      <AnimatePresence>
        {pendingEntry && (
          <motion.div
            key="confirm-banner"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm mx-auto px-4"
          >
            <div className="flex items-center gap-3 bg-background border border-border rounded-2xl shadow-xl px-4 py-3.5">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{pendingEntry.companyName}</p>
                <p className="text-xs text-muted-foreground">{t("AI 분석을 시작할까요?", "Start AI Analysis?")}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setPendingEntry(null)} className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">
                  {t("취소", "Cancel")}
                </button>
                <button
                  onClick={() => {
                    navigate(`/analysis/new?ticker=${encodeURIComponent(pendingEntry.ticker)}&autostart=true`);
                    setPendingEntry(null);
                  }}
                  className="px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  {t("분석 시작", "Analyze")}
                </button>
              </div>
              <button onClick={() => setPendingEntry(null)} className="ml-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
