import { useEffect, useState } from "react";
import { cn, getApiUrl } from "@/lib/utils";
import { TrendingUp, Globe, RefreshCw, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/language-context";

interface MacroData {
  ecos: {
    baseRate: number | null;
    cpiYoY: number | null;
    usdKrw: number | null;
    gdpQoQ: number | null;
    gdpYoY: number | null;
    bondYield3Y: number | null;
    bondYield10Y: number | null;
    latestPeriods: { baseRate: string; cpi: string; usdKrw: string; gdp: string; bond: string };
  } | null;
  fred: {
    fedFundsRate: number | null;
    t10y: number | null;
    t2y: number | null;
    yieldSpread: number | null;
    cpiYoY: number | null;
    gdpGrowth: number | null;
    unemploymentRate: number | null;
    wtiOil: number | null;
    latestDates: { fedFunds: string; treasury: string; cpi: string; gdp: string; wti: string };
  } | null;
  fetchedAt: number;
}

const PIPELINE_KO = [
  { step: "01", title: "기업 개요", desc: "사업모델·경영진·주요제품·성장전략·지배구조 분석" },
  { step: "02", title: "재무 분석", desc: "매출·이익·현금흐름·부채·WACC 등 정량 지표 심층 분석" },
  { step: "03", title: "산업·경쟁", desc: "TAM·경쟁 포지셔닝·시장점유율·해자 강도 평가" },
  { step: "04", title: "절대 가치", desc: "DCF / 배당할인·rNPV·NAV·AFFO 등 섹터별 절대가치 산출" },
  { step: "05", title: "상대 가치", desc: "P/E·EV/EBITDA·P/B·EV/R 등 피어 멀티플 비교 분석" },
  { step: "06", title: "리스크 분석", desc: "매크로·규제·경쟁·재무·이벤트 리스크 5축 평가" },
  { step: "07", title: "최종 조율", desc: "6단계 결과를 종합해 목표주가·투자의견·핵심 논거 도출" },
];

const PIPELINE_EN = [
  { step: "01", title: "Company Overview", desc: "Business model, management, key products, growth strategy, governance analysis" },
  { step: "02", title: "Financial Analysis", desc: "Deep quantitative analysis of revenue, earnings, cash flow, debt, WACC, and more" },
  { step: "03", title: "Industry & Competition", desc: "TAM, competitive positioning, market share, and moat strength assessment" },
  { step: "04", title: "Absolute Valuation", desc: "Sector-specific intrinsic value: DCF, DDM, rNPV, NAV, AFFO, etc." },
  { step: "05", title: "Relative Valuation", desc: "Peer multiple comparison: P/E, EV/EBITDA, P/B, EV/R, and more" },
  { step: "06", title: "Risk Analysis", desc: "5-axis risk assessment: macro, regulatory, competitive, financial, event-driven" },
  { step: "07", title: "Final Synthesis", desc: "Integrates all 6 steps to produce a target price, investment opinion, and key thesis" },
];

const DATA_SOURCES_KO = [
  { name: "Yahoo Finance",    role: "재무제표 · WACC 핵심 수치",    detail: "EPS·매출·EBITDA·총부채·시가총액·베타·발행주식수 등 글로벌 재무 데이터",                                                                   accent: "border-l-purple-500", dot: "bg-purple-500" },
  { name: "DART (금융감독원)", role: "한국 기업 원천 재무상태표",     detail: "연결·별도 재무상태표 (현금·자산·부채·자본·금융부채 직접 조회) — Yahoo Finance 수치보다 우선 적용",                                          accent: "border-l-blue-500",   dot: "bg-blue-500"   },
  { name: "KRX (한국거래소)", role: "KOSPI·KOSDAQ 종목 목록",         detail: "2,700+ 상장 종목의 정확한 거래소·티커 매핑 — AI의 심볼 오류 자동 교정",                                                                      accent: "border-l-teal-500",   dot: "bg-teal-500"   },
  { name: "ECOS (한국은행)",  role: "한국 실시간 거시지표",            detail: "기준금리·CPI·원달러환율·GDP 성장률 — WACC 무위험수익률·환율 환산에 실시간 반영",                                                              accent: "border-l-amber-500",  dot: "bg-amber-500"  },
  { name: "FRED (연준)",      role: "미국 실시간 거시지표",            detail: "Fed 금리·10Y/2Y 국채수익률·장단기 스프레드·CPI·GDP·실업률 — 미국 주식 WACC Rf에 실시간 반영",                                                accent: "border-l-red-500",    dot: "bg-red-500"    },
];

const DATA_SOURCES_EN = [
  { name: "Yahoo Finance",    role: "Financials · Core WACC inputs",      detail: "EPS, revenue, EBITDA, total debt, market cap, beta, shares outstanding — global financial data",                                              accent: "border-l-purple-500", dot: "bg-purple-500" },
  { name: "DART (FSS Korea)", role: "Korean company balance sheets",       detail: "Consolidated & separate balance sheets (cash, assets, liabilities, equity, financial debt direct lookup) — takes precedence over Yahoo Finance", accent: "border-l-blue-500",   dot: "bg-blue-500"   },
  { name: "KRX (Korea Exchange)", role: "KOSPI · KOSDAQ listings",         detail: "Accurate exchange and ticker mapping for 2,700+ listed stocks — auto-corrects AI symbol errors",                                                accent: "border-l-teal-500",   dot: "bg-teal-500"   },
  { name: "ECOS (Bank of Korea)", role: "Korean real-time macro data",     detail: "Base rate, CPI, USD/KRW, GDP growth — live inputs for WACC risk-free rate and FX conversion",                                                  accent: "border-l-amber-500",  dot: "bg-amber-500"  },
  { name: "FRED (Fed Reserve)",   role: "US real-time macro data",         detail: "Fed funds rate, 10Y/2Y Treasury yields, yield spread, CPI, GDP, unemployment — live Rf input for US stock WACC",                              accent: "border-l-red-500",    dot: "bg-red-500"    },
];

type MethodTag = { label: string; color: string };
type SectorItem = { name: string; nameEn: string; tags: MethodTag[] };
type SectorGroup = { market: string; marketEn: string; subtitle: string; headerCls: string; borderCls: string; items: SectorItem[] };

const METHOD_COLORS: Record<string, string> = {
  DCF:     "bg-violet-100 text-violet-900 border border-violet-300 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-700",
  EV:      "bg-blue-100 text-blue-900 border border-blue-300 dark:bg-blue-900/50 dark:text-blue-200 dark:border-blue-700",
  SOTP:    "bg-indigo-100 text-indigo-900 border border-indigo-300 dark:bg-indigo-900/50 dark:text-indigo-200 dark:border-indigo-700",
  NAV:     "bg-teal-100 text-teal-900 border border-teal-300 dark:bg-teal-900/50 dark:text-teal-200 dark:border-teal-700",
  FFO:     "bg-cyan-100 text-cyan-900 border border-cyan-300 dark:bg-cyan-900/50 dark:text-cyan-200 dark:border-cyan-700",
  rNPV:    "bg-pink-100 text-pink-900 border border-pink-300 dark:bg-pink-900/50 dark:text-pink-200 dark:border-pink-700",
  PBV:     "bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-700",
  Backlog: "bg-orange-100 text-orange-900 border border-orange-300 dark:bg-orange-900/50 dark:text-orange-200 dark:border-orange-700",
  RAB:     "bg-sky-100 text-sky-900 border border-sky-300 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-700",
  Rule40:  "bg-fuchsia-100 text-fuchsia-900 border border-fuchsia-300 dark:bg-fuchsia-900/50 dark:text-fuchsia-200 dark:border-fuchsia-700",
  Royalty: "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-700",
  NII:     "bg-lime-100 text-lime-900 border border-lime-300 dark:bg-lime-900/50 dark:text-lime-200 dark:border-lime-700",
};

const sectorGroups: SectorGroup[] = [
  {
    market: "한국", marketEn: "Korea",
    subtitle: "KOSPI · KOSDAQ",
    headerCls: "bg-muted/40 border-border",
    borderCls: "border-l-blue-400",
    items: [
      { name: "일반기업",     nameEn: "General Corporates",    tags: [{ label: "DCF",         color: METHOD_COLORS.DCF   }, { label: "EV/EBITDA",  color: METHOD_COLORS.EV  }] },
      { name: "지주·복합기업", nameEn: "Holdings/Conglomerates", tags: [{ label: "SOTP",        color: METHOD_COLORS.SOTP  }] },
      { name: "리츠",         nameEn: "REITs",                 tags: [{ label: "FFO/AFFO",    color: METHOD_COLORS.FFO   }, { label: "NAV",        color: METHOD_COLORS.NAV }] },
      { name: "바이오·신약",  nameEn: "Biotech/Pharma",        tags: [{ label: "rNPV (PoS)",  color: METHOD_COLORS.rNPV  }] },
      { name: "은행·금융",    nameEn: "Banks/Financials",      tags: [{ label: "P/BV",        color: METHOD_COLORS.PBV   }, { label: "ROE-CoE",   color: METHOD_COLORS.PBV }] },
      { name: "자원·에너지",  nameEn: "Resources/Energy",      tags: [{ label: "EV/Reserve",  color: METHOD_COLORS.EV    }, { label: "NAV",       color: METHOD_COLORS.NAV }] },
      { name: "통신·인프라",  nameEn: "Telecom/Infrastructure", tags: [{ label: "EV/EBITDA",  color: METHOD_COLORS.EV    }, { label: "Div. Yield",color: METHOD_COLORS.FFO }] },
      { name: "건설·디벨로퍼", nameEn: "Construction/Developers", tags: [{ label: "Backlog",   color: METHOD_COLORS.Backlog }, { label: "Pre-sale NAV", color: METHOD_COLORS.NAV }] },
      { name: "유틸리티·전력", nameEn: "Utilities/Power",      tags: [{ label: "RAB",        color: METHOD_COLORS.RAB   }, { label: "EV/EBITDA", color: METHOD_COLORS.EV  }] },
    ],
  },
  {
    market: "미국 · 글로벌", marketEn: "US · Global",
    subtitle: "NYSE · NASDAQ",
    headerCls: "bg-muted/40 border-border",
    borderCls: "border-l-red-400",
    items: [
      { name: "리츠 (REIT)",      nameEn: "REIT",               tags: [{ label: "P/AFFO",     color: METHOD_COLORS.FFO    }, { label: "Cap Rate NAV", color: METHOD_COLORS.NAV  }] },
      { name: "바이오 (Biotech)", nameEn: "Biotech",             tags: [{ label: "rNPV",       color: METHOD_COLORS.rNPV   }, { label: "PDUFA-driven", color: METHOD_COLORS.rNPV }] },
      { name: "방산 (Defense)",   nameEn: "Defense",             tags: [{ label: "Backlog",    color: METHOD_COLORS.Backlog}, { label: "EAC FCF",      color: METHOD_COLORS.DCF  }] },
      { name: "은행 (Bank)",      nameEn: "Banks",               tags: [{ label: "P/TBVPS",   color: METHOD_COLORS.PBV    }, { label: "Justified",    color: METHOD_COLORS.PBV  }] },
      { name: "MLP",              nameEn: "MLP",                 tags: [{ label: "DCF Dist.",  color: METHOD_COLORS.DCF    }, { label: "EV/EBITDA",    color: METHOD_COLORS.EV   }] },
      { name: "BDC",              nameEn: "BDC",                 tags: [{ label: "Portfolio NAV", color: METHOD_COLORS.NAV }, { label: "NII Div.",     color: METHOD_COLORS.NII  }] },
      { name: "로열티 스트림",    nameEn: "Royalty Streams",     tags: [{ label: "Royalty DCF", color: METHOD_COLORS.Royalty }] },
      { name: "빅테크·플랫폼",   nameEn: "Big Tech/Platforms",  tags: [{ label: "Rule of 40", color: METHOD_COLORS.Rule40 }, { label: "FCF Yield",   color: METHOD_COLORS.DCF  }, { label: "SOTP", color: METHOD_COLORS.SOTP }] },
    ],
  },
];

const DIFFERENTIATORS_KO = [
  { title: "자기검증 반론 에이전트", badge: "Self-Adversarial Review", badgeColor: "bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-900/50 dark:text-rose-200 dark:border-rose-700", desc: "재무 전망과 밸류에이션 단계 완료 후, AI가 스스로 핵심 가정에 대해 3가지 각도로 반론을 생성합니다. WACC 과소/과대 여부, 성장률 낙관성, 멀티플 정당성을 별도 에이전트가 비판적으로 검토합니다.", icon: "⚔️" },
  { title: "WACC 자동 가드레일", badge: "Auto WACC Guardrail", badgeColor: "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-700", desc: "한국 WACC 정상 범위 8~14%, 미국 7~12%를 코드에 하드코딩했습니다. WACC < 8% 감지 시 '과소 경고'와 함께 10%로 자동 상향, WACC > 15% 시 과대 경고 후 재검토를 강제합니다. 임의로 낮은 할인율을 써서 목표주가를 부풀리는 오류를 원천 차단합니다.", icon: "🛡️" },
  { title: "섹터별 지표 오용 차단", badge: "Metric Prohibition System", badgeColor: "bg-orange-100 text-orange-900 border border-orange-300 dark:bg-orange-900/50 dark:text-orange-200 dark:border-orange-700", desc: "리츠에는 DCF·EV/EBITDA 단독 사용을 명시적으로 금지하고, 은행·금융주에는 EV/EBITDA를 금지합니다. MLP·BDC에는 EPS·PER을 완전 금지합니다. 섹터 특성을 무시한 잘못된 배수 적용이 불가능합니다.", icon: "🚫" },
  { title: "3단 데이터 우선순위 체계", badge: "Multi-Source Priority Stack", badgeColor: "bg-blue-100 text-blue-900 border border-blue-300 dark:bg-blue-900/50 dark:text-blue-200 dark:border-blue-700", desc: "한국 기업의 재무상태표는 DART(1순위) → Yahoo Finance(2순위) → Naver(3순위)로 자동 폴백합니다. Yahoo Finance가 한국 주식 주가를 IPO 가격으로 반환하는 버그를 Naver 실시간 종가로 교정하고, KRX 기준 발행주식수를 재계산해 EPS 왜곡을 방지합니다.", icon: "🗂️" },
  { title: "롤링 컨텍스트 누적", badge: "Rolling Context Pipeline", badgeColor: "bg-violet-100 text-violet-900 border border-violet-300 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-700", desc: "7단계 파이프라인에서 각 에이전트는 이전 단계의 분석 결과 전체를 읽고 명시적으로 반영합니다. 팀장 브리핑 → 산업 분석 → 재무 분석 → 밸류에이션 → 최종 조율로 이어지는 누적 컨텍스트가 일관된 논리를 보장합니다.", icon: "🔗" },
  { title: "FDA 지정별 PoS 자동 보정", badge: "FDA Designation PoS Adjuster", badgeColor: "bg-pink-100 text-pink-900 border border-pink-300 dark:bg-pink-900/50 dark:text-pink-200 dark:border-pink-700", desc: "미국 바이오 분석 시 FDA Breakthrough Therapy 지정(+5~10%p), Priority Review(+3~5%p), Fast Track(+2~3%p)에 따라 임상 성공 확률을 자동 상향합니다. PDUFA 날짜와 AdCom 반대 다수 시 CRL 리스크를 별도 시나리오로 강제 산출합니다.", icon: "💊" },
  { title: "실시간 뉴스·이벤트 반영", badge: "News & Catalyst Integration", badgeColor: "bg-sky-100 text-sky-900 border border-sky-300 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-700", desc: "실적 서프라이즈·FDA 결정·M&A·규제 이슈·경영진 교체 등 주가에 직접 영향을 미칠 수 있는 뉴스와 카탈리스트를 분석에 반영합니다. 단순 재무 수치를 넘어 시장 이벤트 드리븐 관점까지 목표주가에 통합합니다.", icon: "📰" },
  { title: "모델 자기보정 시스템", badge: "Self-Calibrating Model", badgeColor: "bg-indigo-100 text-indigo-900 border border-indigo-300 dark:bg-indigo-900/50 dark:text-indigo-200 dark:border-indigo-700", desc: "분석 30일 후 실제 주가 방향과 AI 판정을 자동 대조해 섹터별 정확도를 누적합니다. 특정 섹터에서 낙관 편향이 반복될 경우, 다음 분석 시 밸류에이션·투자의견 단계 프롬프트에 보정 맥락을 자동 주입합니다. 사람이 손대지 않아도 모델이 스스로 과거 실수를 다음 판단에 반영하는 구조입니다.", icon: "🔄" },
];

const DIFFERENTIATORS_EN = [
  { title: "Self-Adversarial Review Agent", badge: "Self-Adversarial Review", badgeColor: "bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-900/50 dark:text-rose-200 dark:border-rose-700", desc: "After completing the financial forecast and valuation steps, the AI generates counterarguments from 3 angles against its own key assumptions. A separate agent critically reviews whether WACC is under/overestimated, whether growth assumptions are too optimistic, and whether multiples are justified.", icon: "⚔️" },
  { title: "Auto WACC Guardrail", badge: "Auto WACC Guardrail", badgeColor: "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-700", desc: "Normal WACC ranges (Korea: 8–14%, US: 7–12%) are hard-coded. If WACC < 8%, an underestimation warning is triggered and it's automatically raised to 10%. If WACC > 15%, an overestimation warning forces re-review. This prevents inflated target prices from artificially low discount rates.", icon: "🛡️" },
  { title: "Sector Metric Abuse Prevention", badge: "Metric Prohibition System", badgeColor: "bg-orange-100 text-orange-900 border border-orange-300 dark:bg-orange-900/50 dark:text-orange-200 dark:border-orange-700", desc: "Standalone DCF/EV/EBITDA is explicitly prohibited for REITs. EV/EBITDA is banned for banks and financials. EPS/PER is completely prohibited for MLPs and BDCs. Wrong multiples that ignore sector characteristics simply cannot be applied.", icon: "🚫" },
  { title: "3-Tier Data Priority Stack", badge: "Multi-Source Priority Stack", badgeColor: "bg-blue-100 text-blue-900 border border-blue-300 dark:bg-blue-900/50 dark:text-blue-200 dark:border-blue-700", desc: "Korean company balance sheets auto-fallback: DART (1st) → Yahoo Finance (2nd) → Naver (3rd). Yahoo Finance's bug of returning IPO prices for Korean stocks is corrected with Naver real-time closing prices, and shares outstanding are recalculated from KRX data to prevent EPS distortion.", icon: "🗂️" },
  { title: "Rolling Context Pipeline", badge: "Rolling Context Pipeline", badgeColor: "bg-violet-100 text-violet-900 border border-violet-300 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-700", desc: "In the 7-step pipeline, each agent explicitly reads and incorporates the full output of all previous steps. The cumulative context — briefing → industry → financials → valuation → final synthesis — ensures consistent reasoning throughout.", icon: "🔗" },
  { title: "FDA Designation PoS Adjuster", badge: "FDA Designation PoS Adjuster", badgeColor: "bg-pink-100 text-pink-900 border border-pink-300 dark:bg-pink-900/50 dark:text-pink-200 dark:border-pink-700", desc: "For US biotech analysis, clinical success probabilities are automatically adjusted upward based on FDA designations: Breakthrough Therapy (+5–10%p), Priority Review (+3–5%p), Fast Track (+2–3%p). PDUFA dates and AdCom negative majority votes force a separate CRL risk scenario.", icon: "💊" },
  { title: "Real-time News & Catalyst Integration", badge: "News & Catalyst Integration", badgeColor: "bg-sky-100 text-sky-900 border border-sky-300 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-700", desc: "Earnings surprises, FDA decisions, M&A, regulatory issues, management changes — news and catalysts that can directly impact stock prices are incorporated into the analysis. Event-driven perspectives are integrated into the target price, going beyond simple financial figures.", icon: "📰" },
  { title: "Self-Calibrating Model System", badge: "Self-Calibrating Model", badgeColor: "bg-indigo-100 text-indigo-900 border border-indigo-300 dark:bg-indigo-900/50 dark:text-indigo-200 dark:border-indigo-700", desc: "30 days after analysis, the AI's verdict is automatically compared against actual price movement to accumulate sector-level accuracy. If optimism bias repeats in a sector, a calibration context is automatically injected into the valuation and opinion steps in subsequent analyses — without human intervention.", icon: "🔄" },
];

const ASSUMPTIONS_KO = [
  {
    title: "WACC 무위험수익률 (Rf)",
    items: [
      "한국 주식: 한국은행 ECOS 기준금리 실시간 반영",
      "미국 주식: FRED 10년 국채수익률(DGS10) 실시간 반영",
      "글로벌 평균 ERP: 5~6% 적용 (Damodaran 방법론 기반)",
    ],
  },
  {
    title: "DCF 터미널 성장률",
    items: [
      "한국 성숙기업: 1~2% (GDP 장기 성장률 근사)",
      "미국 성숙기업: 2~2.5%",
      "고성장 섹터(바이오·플랫폼): 3~5% 기간 성장 후 수렴",
    ],
  },
  {
    title: "섹터별 Cap Rate (미국 리츠)",
    items: [
      "데이터센터: 4.5~5.5% / 셀타워: 3.5~5%",
      "산업·물류: 4~6% / 헬스케어: 5~6.5%",
      "주거: 4~5.5% / 오피스: 6~9% (위기 섹터 할증)",
    ],
  },
  {
    title: "바이오 임상 확률 (PoS)",
    items: [
      "Phase I→II: 63% / Phase II→III: 31%",
      "Phase III→승인: 58% / 누적 승인 확률: ~11%",
      "PDUFA 일정·AdCom 결과로 개별 보정",
    ],
  },
];

const ASSUMPTIONS_EN = [
  {
    title: "WACC Risk-Free Rate (Rf)",
    items: [
      "Korean stocks: Bank of Korea ECOS base rate (real-time)",
      "US stocks: FRED 10-year Treasury yield (DGS10, real-time)",
      "Global average ERP: 5–6% (based on Damodaran methodology)",
    ],
  },
  {
    title: "DCF Terminal Growth Rate",
    items: [
      "Korean mature companies: 1–2% (approximating long-term GDP growth)",
      "US mature companies: 2–2.5%",
      "High-growth sectors (biotech, platforms): 3–5% converging after growth period",
    ],
  },
  {
    title: "Sector Cap Rates (US REITs)",
    items: [
      "Data centers: 4.5–5.5% / Cell towers: 3.5–5%",
      "Industrial/logistics: 4–6% / Healthcare: 5–6.5%",
      "Residential: 4–5.5% / Office: 6–9% (distressed sector premium)",
    ],
  },
  {
    title: "Biotech Clinical Probabilities (PoS)",
    items: [
      "Phase I→II: 63% / Phase II→III: 31%",
      "Phase III→Approval: 58% / Cumulative approval: ~11%",
      "Individually adjusted by PDUFA dates and AdCom outcomes",
    ],
  },
];

export default function AboutPage() {
  const [macroData, setMacroData] = useState<MacroData | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const { isEn } = useLanguage();

  const t = (ko: string, en: string) => isEn ? en : ko;

  const pipeline = isEn ? PIPELINE_EN : PIPELINE_KO;
  const dataSources = isEn ? DATA_SOURCES_EN : DATA_SOURCES_KO;
  const differentiators = isEn ? DIFFERENTIATORS_EN : DIFFERENTIATORS_KO;
  const assumptions = isEn ? ASSUMPTIONS_EN : ASSUMPTIONS_KO;

  const fetchMacro = async () => {
    setMacroLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/macro"), { credentials: "include" });
      if (r.ok) setMacroData(await r.json());
    } catch { } finally {
      setMacroLoading(false);
    }
  };

  useEffect(() => { fetchMacro(); }, []);

  return (
    <div className="max-w-2xl space-y-10 pb-20">
      {/* Hero */}
      <div className="space-y-2">
        <h1
          className="text-[26px] font-black tracking-tight text-foreground"
          style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif" }}
        >
          {t("애빛다 소개", "About AiBITDA")}
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t(
            "AI로 기업가치를 밝히다 — 기관급 밸류에이션 방법론을 누구나 사용할 수 있도록 설계된 AI 주식 리서치 플랫폼입니다.",
            "Illuminating value with AI — an AI-powered stock research platform designed to give everyone access to institutional-grade valuation methodology."
          )}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {(isEn
            ? ["KOSPI·KOSDAQ", "NYSE·NASDAQ", "17 Valuation Models", "7-Step AI Pipeline", "Live Macro Data", "AI Market Outlook"]
            : ["KOSPI·KOSDAQ", "NYSE·NASDAQ", "16개 전용 밸류에이션 모델", "7단계 AI 파이프라인", "실시간 거시지표", "AI 시장 전망"]
          ).map((tag) => (
            <span key={tag} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              {tag}
            </span>
          ))}
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-primary text-white border border-primary flex items-center gap-1">
            ⏱ {t("평균 3분 완성", "~3 min per report")}
          </span>
        </div>
      </div>

      {/* 철학 */}
      <section className="space-y-4">
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          {t("투자 철학", "Investment Philosophy")}
        </h2>

        {/* 그레이엄 인용 */}
        <blockquote className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
          <p className="text-[13.5px] leading-relaxed text-foreground/85 italic">
            {t(
              "\"주식은 단기적으로는 투표 기계처럼 시장의 감정을 반영하지만, 장기적으로는 체중계처럼 기업의 실제 가치를 측정한다.\"",
              "\"In the short run, the market is a voting machine, but in the long run, it is a weighing machine.\""
            )}
          </p>
          <footer className="mt-2 text-[11px] text-muted-foreground font-semibold not-italic">
            — Benjamin Graham
          </footer>
        </blockquote>

        {/* 핵심 철학 3블록 */}
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          <div className="px-4 py-4 flex gap-3.5">
            <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">📉</div>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-[13.5px] font-bold text-foreground">
                {t("한국 개인투자자의 구조적 불리함", "Structural Disadvantage of Retail Investors")}
              </p>
              <p className="text-[12px] text-muted-foreground/75 leading-relaxed">
                {t(
                  "기관과 외국인은 블룸버그 터미널, 독점 리서치 리포트, 애널리스트 컨퍼런스콜로 무장합니다. 반면 개인투자자에게 주어진 도구는 차트·커뮤니티 루머·단편적인 뉴스가 전부입니다. 이 정보 비대칭은 수익률 격차로 직결됩니다.",
                  "Institutions and foreign investors are armed with Bloomberg terminals, proprietary research reports, and analyst conference calls. Retail investors, by contrast, get charts, community rumors, and fragmented news. This information asymmetry directly translates into a performance gap."
                )}
              </p>
            </div>
          </div>

          <div className="px-4 py-4 flex gap-3.5">
            <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">🎯</div>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-[13.5px] font-bold text-foreground">
                {t("기본적 분석이 중요한 이유", "Why Fundamental Analysis Matters")}
              </p>
              <p className="text-[12px] text-muted-foreground/75 leading-relaxed">
                {t(
                  "테마와 모멘텀은 사라지지만 현금흐름과 이익은 남습니다. 버핏·린치·클라만이 증명했듯, 초과 수익의 원천은 결국 시장이 오판한 내재가치를 찾아내는 능력입니다. 주가와 기업가치의 괴리가 클수록 — 그 수렴 과정에서 수익이 발생합니다.",
                  "Themes and momentum fade, but cash flows and earnings remain. As Buffett, Lynch, and Klarman have proven, the source of excess returns is ultimately the ability to identify intrinsic value that the market has mispriced. The wider the gap between price and value — the greater the profit potential in its convergence."
                )}
              </p>
            </div>
          </div>

          <div className="px-4 py-4 flex gap-3.5">
            <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">⚖️</div>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-[13.5px] font-bold text-foreground">
                {t("애빛다의 존재 이유", "Why AiBITDA Exists")}
              </p>
              <p className="text-[12px] text-muted-foreground/75 leading-relaxed">
                {t(
                  "7단계 분석 — 재무 모델링, 섹터별 밸류에이션, 리스크 시나리오 — 을 AI를 통해 누구에게나 제공합니다. DCF·P/B-ROE·rNPV·SOTP·NAV 등 업종에 맞는 방법론을 자동 선택해 \"이 주식이 지금 비싼가, 싼가\"를 수치로 답합니다. 분석의 민주화가 곧 투자 기회의 균등입니다.",
                  "We deliver 7-step analysis — financial modeling, sector-specific valuation, risk scenarios — to everyone through AI. We auto-select the right methodology for each sector (DCF, P/B-ROE, rNPV, SOTP, NAV, etc.) to answer in numbers: \"Is this stock cheap or expensive right now?\" Democratizing analysis means equalizing opportunity."
                )}
              </p>
            </div>
          </div>
        </div>

        {/* 밸류에이션 방법론 철학 */}
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-4 space-y-2.5">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
            {t("밸류에이션 방법론 원칙", "Valuation Methodology Principles")}
          </p>
          <div className="space-y-2 text-[12px] text-muted-foreground/80 leading-relaxed">
            <p>
              <span className="font-semibold text-foreground">
                {t("① 업종에 맞는 모델을 씁니다.", "① Use the right model for the sector.")}
              </span>{" "}
              {t(
                "영업적자 바이오 기업에 DCF를 적용하면 현재 주가의 1/100 수준의 비현실적 값이 나옵니다. 금융주에 EV/EBITDA를 쓰면 이자비용이 왜곡됩니다. 애빛다는 업종을 감지하고 가장 신뢰할 수 있는 방법론을 자동 선택합니다.",
                "Applying DCF to an operating-loss biotech produces a value 1/100th of the current price. Using EV/EBITDA on a bank distorts interest expense. AiBITDA auto-detects the sector and selects the most reliable methodology."
              )}
            </p>
            <p>
              <span className="font-semibold text-foreground">
                {t("② 가정은 투명하게 명시합니다.", "② Assumptions are stated transparently.")}
              </span>{" "}
              {t(
                "WACC·성장률·터미널 밸류 등 핵심 가정을 숨기지 않습니다. 낮은 할인율로 목표주가를 부풀리는 행위를 원천 차단하는 가드레일을 코드에 직접 구현했습니다.",
                "WACC, growth rates, terminal value — key assumptions are never hidden. Guardrails are built directly into the code to prevent inflated target prices from artificially low discount rates."
              )}
            </p>
            <p>
              <span className="font-semibold text-foreground">
                {t("③ 반론을 스스로 제기합니다.", "③ The AI challenges its own conclusions.")}
              </span>{" "}
              {t(
                "분석 후 AI가 자체적으로 핵심 가정에 반론을 제시합니다. 낙관론에 빠지지 않도록 비판적 시각을 파이프라인 안에 내재화했습니다.",
                "After analysis, the AI generates counterarguments against its own key assumptions. Critical perspective is built into the pipeline to prevent optimism bias."
              )}
            </p>
          </div>
        </div>
      </section>

      {/* AI 파이프라인 */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest">
            {t("7단계 AI 분석 파이프라인", "7-Step AI Analysis Pipeline")}
          </h2>
          <span className="text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20">
            ⏱ {t("평균 3분 소요", "~3 min avg.")}
          </span>
        </div>
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {pipeline.map((p, i) => (
            <div key={p.step} className="flex items-start gap-4 px-4 py-3.5">
              <div className={cn(
                "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black mt-0.5",
                i === 6 ? "bg-primary text-white" : "bg-muted text-muted-foreground"
              )}>
                {p.step}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-foreground">{p.title}</p>
                <p className="text-[12px] text-muted-foreground/70 mt-0.5 leading-relaxed">{p.desc}</p>
              </div>
              {i === 6 && (
                <span className="shrink-0 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20 mt-1">
                  {t("조율", "Synthesis")}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 데이터 소스 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          {t("실시간 데이터 소스", "Real-time Data Sources")}
        </h2>
        <div className="space-y-2.5">
          {dataSources.map((src) => (
            <div key={src.name} className={cn("rounded-xl border border-border bg-card px-4 py-3.5 flex gap-3 border-l-4", src.accent)}>
              <div className={cn("w-2 h-2 rounded-full shrink-0 mt-1.5", src.dot)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[13.5px] font-bold text-foreground">{src.name}</span>
                  <span className="text-[11px] font-semibold text-muted-foreground">{src.role}</span>
                </div>
                <p className="text-[12px] text-muted-foreground/80 mt-1 leading-relaxed">{src.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 기술 차별화 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          {t("왜 애빛다인가", "Why AiBITDA?")}
        </h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {differentiators.map((d) => (
            <div key={d.title} className="px-4 py-4 flex gap-3.5">
              <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">{d.icon}</div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-bold text-foreground">{d.title}</span>
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md font-mono", d.badgeColor)}>
                    {d.badge}
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground/75 leading-relaxed">{d.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 섹터별 밸류에이션 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          {t("섹터별 전문 밸류에이션 방법론 (17개)", "Sector-Specific Valuation Methods (17)")}
        </h2>

        <div className="space-y-4">
          {sectorGroups.map((group) => (
            <div key={group.market} className={cn("rounded-xl border overflow-hidden", group.headerCls)}>
              <div className={cn("px-4 py-2.5 border-b flex items-center justify-between", group.headerCls)}>
                <span className="text-[13px] font-black tracking-tight text-foreground">
                  {isEn ? group.marketEn : group.market}
                </span>
                <span className="text-[10.5px] font-semibold text-muted-foreground/75 font-mono">{group.subtitle}</span>
              </div>
              <div className="bg-card grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x-0">
                {group.items.map((item) => (
                  <div
                    key={item.name}
                    className={cn("flex flex-col gap-1.5 px-3.5 py-3 border-l-[3px] border-b border-border/50", group.borderCls)}
                  >
                    <span className="text-[12.5px] font-semibold text-foreground">
                      {isEn ? item.nameEn : item.name}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <span key={tag.label} className={cn("text-[10.5px] font-bold px-2 py-0.5 rounded-md", tag.color)}>
                          {tag.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/50 px-1 mt-2.5 leading-relaxed">
          {t(
            "AI가 종목명·산업을 자동 감지해 해당 섹터 전용 밸류에이션 프레임을 적용합니다. 일반 DCF와 별도로 섹터 고유 지표(AFFO·Backlog·rNPV 등)를 의무 산출합니다.",
            "The AI auto-detects the company name and industry, then applies the sector-specific valuation framework. Sector-unique metrics (AFFO, Backlog, rNPV, etc.) are calculated in addition to standard DCF."
          )}
        </p>
      </section>

      {/* 주요 가정 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          {t("주요 가정 및 방법론", "Key Assumptions & Methodology")}
        </h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {assumptions.map((a) => (
            <div key={a.title} className="px-4 py-3.5 space-y-2">
              <p className="text-[13.5px] font-semibold text-foreground">{a.title}</p>
              <ul className="space-y-1">
                {a.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-muted-foreground/80">
                    <span className="text-primary mt-0.5 shrink-0">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 거시경제 현황 */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest">
            {t("실시간 거시경제 현황", "Real-time Macro Dashboard")}
          </h2>
          <button
            onClick={fetchMacro}
            disabled={macroLoading}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-primary transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", macroLoading && "animate-spin")} />
            {t("새로고침", "Refresh")}
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground/60 px-1 mb-3">
          {t("AI 분석에 실시간으로 반영되는 거시경제 지표입니다.", "These macro indicators are fed live into every AI analysis.")}
        </p>

        {macroLoading && !macroData ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* 한국 - ECOS */}
            <div className="rounded-xl bg-muted/40 border border-border/60 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/60">
                <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[11px] font-bold text-foreground/70 uppercase tracking-wide">
                  {t("한국 (ECOS · 한국은행)", "Korea (ECOS · Bank of Korea)")}
                </span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border/40 border-b border-border/30">
                {[
                  {
                    label: t("기준금리", "Base Rate"),
                    value: macroData?.ecos?.baseRate != null ? `${macroData.ecos.baseRate.toFixed(2)}%` : "—",
                    sub: macroData?.ecos?.latestPeriods?.baseRate
                      ? `${macroData.ecos.latestPeriods.baseRate.slice(0,4)}.${macroData.ecos.latestPeriods.baseRate.slice(4)}`
                      : "",
                  },
                  {
                    label: "CPI (YoY)",
                    value: macroData?.ecos?.cpiYoY != null
                      ? `${macroData.ecos.cpiYoY >= 0 ? "+" : ""}${macroData.ecos.cpiYoY.toFixed(2)}%`
                      : "—",
                    sub: macroData?.ecos?.latestPeriods?.cpi
                      ? `${macroData.ecos.latestPeriods.cpi.slice(0,4)}.${macroData.ecos.latestPeriods.cpi.slice(4)}`
                      : "",
                  },
                  {
                    label: t("원/달러", "USD/KRW"),
                    value: macroData?.ecos?.usdKrw != null ? `${macroData.ecos.usdKrw.toFixed(0)}₩` : "—",
                    sub: t("매매기준율", "Reference Rate"),
                  },
                ].map((item) => (
                  <div key={item.label} className="px-3 py-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground/50 mb-1">{item.label}</p>
                    <p className="text-[14px] font-bold text-foreground tabular-nums">{item.value}</p>
                    {item.sub && <p className="text-[10px] text-muted-foreground/40 mt-0.5">{item.sub}</p>}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 divide-x divide-border/40">
                {[
                  {
                    label: t("국고채 3Y", "KTB 3Y"),
                    value: macroData?.ecos?.bondYield3Y != null ? `${macroData.ecos.bondYield3Y.toFixed(2)}%` : "—",
                    sub: macroData?.ecos?.latestPeriods?.bond
                      ? `${macroData.ecos.latestPeriods.bond.slice(0,4)}.${macroData.ecos.latestPeriods.bond.slice(4,6)}.${macroData.ecos.latestPeriods.bond.slice(6)}`
                      : "",
                  },
                  {
                    label: t("국고채 10Y", "KTB 10Y"),
                    value: macroData?.ecos?.bondYield10Y != null ? `${macroData.ecos.bondYield10Y.toFixed(2)}%` : "—",
                    sub: t("Rf (WACC 기준)", "Rf (WACC basis)"),
                  },
                  {
                    label: "GDP (QoQ)",
                    value: macroData?.ecos?.gdpQoQ != null
                      ? `${macroData.ecos.gdpQoQ >= 0 ? "+" : ""}${macroData.ecos.gdpQoQ.toFixed(1)}%`
                      : "—",
                    sub: macroData?.ecos?.latestPeriods?.gdp ?? "",
                  },
                ].map((item) => (
                  <div key={item.label} className="px-3 py-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground/50 mb-1">{item.label}</p>
                    <p className="text-[14px] font-bold text-foreground tabular-nums">{item.value}</p>
                    {item.sub && <p className="text-[10px] text-muted-foreground/40 mt-0.5">{item.sub}</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* 미국 - FRED */}
            <div className="rounded-xl bg-muted/40 border border-border/60 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/60">
                <Globe className="w-3.5 h-3.5 text-red-500" />
                <span className="text-[11px] font-bold text-foreground/70 uppercase tracking-wide">
                  {t("미국 (FRED · 연준)", "US (FRED · Federal Reserve)")}
                </span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border/40 border-b border-border/30">
                {[
                  {
                    label: t("Fed 금리", "Fed Rate"),
                    value: macroData?.fred?.fedFundsRate != null ? `${macroData.fred.fedFundsRate.toFixed(2)}%` : "—",
                    sub: macroData?.fred?.latestDates?.fedFunds ?? "",
                  },
                  {
                    label: "10Y UST",
                    value: macroData?.fred?.t10y != null ? `${macroData.fred.t10y.toFixed(2)}%` : "—",
                    sub: macroData?.fred?.t2y != null ? `2Y: ${macroData.fred.t2y.toFixed(2)}%` : "",
                  },
                  {
                    label: "CPI (YoY)",
                    value: macroData?.fred?.cpiYoY != null
                      ? `${macroData.fred.cpiYoY >= 0 ? "+" : ""}${macroData.fred.cpiYoY.toFixed(2)}%`
                      : "—",
                    sub: "US CPI",
                  },
                ].map((item) => (
                  <div key={item.label} className="px-3 py-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground/50 mb-1">{item.label}</p>
                    <p className="text-[14px] font-bold text-foreground tabular-nums">{item.value}</p>
                    {item.sub && <p className="text-[10px] text-muted-foreground/40 mt-0.5">{item.sub}</p>}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 divide-x divide-border/40">
                {[
                  {
                    label: t("GDP 성장률", "GDP Growth"),
                    value: macroData?.fred?.gdpGrowth != null
                      ? `${macroData.fred.gdpGrowth >= 0 ? "+" : ""}${macroData.fred.gdpGrowth.toFixed(1)}%`
                      : "—",
                    sub: macroData?.fred?.latestDates?.gdp ?? t("전기대비 연율", "QoQ annualized"),
                  },
                  {
                    label: t("실업률", "Unemployment"),
                    value: macroData?.fred?.unemploymentRate != null ? `${macroData.fred.unemploymentRate.toFixed(1)}%` : "—",
                    sub: "UNRATE",
                  },
                  {
                    label: t("WTI 유가", "WTI Oil"),
                    value: macroData?.fred?.wtiOil != null ? `$${macroData.fred.wtiOil.toFixed(1)}` : "—",
                    sub: t("USD/배럴", "USD/bbl"),
                  },
                ].map((item) => (
                  <div key={item.label} className="px-3 py-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground/50 mb-1">{item.label}</p>
                    <p className="text-[14px] font-bold text-foreground tabular-nums">{item.value}</p>
                    {item.sub && <p className="text-[10px] text-muted-foreground/40 mt-0.5">{item.sub}</p>}
                  </div>
                ))}
              </div>
              {macroData?.fred && (
                <div className={cn(
                  "px-3 py-2 border-t border-border/40 text-center text-[11px] font-medium",
                  (macroData.fred.yieldSpread ?? 0) < 0
                    ? "text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20"
                )}>
                  {t("장단기 금리차(10Y-2Y)", "Yield Spread (10Y-2Y)")} {macroData.fred.yieldSpread != null
                    ? `${macroData.fred.yieldSpread > 0 ? "+" : ""}${macroData.fred.yieldSpread.toFixed(2)}%p`
                    : "—"
                  } — {(macroData.fred.yieldSpread ?? 0) < 0
                    ? t("수익률 곡선 역전 (경기침체 신호)", "Yield curve inverted (recession signal)")
                    : t("정상 우상향 (경기 회복 국면)", "Normal upward slope (recovery phase)")}
                </div>
              )}
            </div>

            {macroData?.fetchedAt && (
              <p className="text-[10px] text-muted-foreground/30 text-right">
                {t("마지막 업데이트:", "Last updated:")} {new Date(macroData.fetchedAt).toLocaleString(isEn ? "en-US" : "ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}
      </section>

      {/* 매크로 분석 활용 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          {t("매크로 분석 — AI가 거시환경을 읽는 방법", "Macro Analysis — How AI Reads the Macro Environment")}
        </h2>
        <p className="text-[12px] text-muted-foreground/60 px-1 mb-3 leading-relaxed">
          {t(
            "주식 가치는 기업 내부만으로 결정되지 않습니다. 금리·환율·경기 사이클·섹터 자금 흐름이 DCF 할인율과 투자자 심리를 동시에 움직입니다. 애빛다는 거시 데이터를 단순 참고가 아닌 분석 파이프라인에 직접 내재화합니다.",
            "Stock value is not determined by a company's internals alone. Interest rates, FX, business cycles, and sector fund flows simultaneously drive DCF discount rates and investor sentiment. AiBITDA embeds macro data directly into the analysis pipeline — not merely as a reference."
          )}
        </p>

        <div className="space-y-3">
          {/* WACC 실시간 연동 */}
          <div className="rounded-xl border border-border bg-card px-4 py-4 flex gap-3.5 border-l-4 border-l-blue-500">
            <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">📐</div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-[13.5px] font-bold text-foreground">
                {t("WACC에 실시간 거시지표 자동 반영", "Macro Data Wired Live into WACC")}
              </p>
              <p className="text-[12px] text-muted-foreground/75 leading-relaxed">
                {t(
                  "무위험수익률(Rf)을 고정값이 아닌 실시간으로 갱신합니다. 한국 주식은 ECOS 기준금리 및 국고채 10Y, 미국 주식은 FRED 10년 국채(DGS10)를 Rf로 자동 채택합니다. 금리가 1%p 오르면 WACC가 오르고, 목표주가는 하락합니다 — 이 연산이 분석마다 자동으로 실행됩니다.",
                  "The risk-free rate (Rf) is updated in real-time, not fixed. Korean stocks use the Bank of Korea base rate and KTB 10Y via ECOS; US stocks use FRED's DGS10. When rates rise 1%p, WACC increases and target prices fall — this calculation runs automatically on every analysis."
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  t("ECOS 기준금리", "ECOS Base Rate"),
                  t("KTB 10Y", "KTB 10Y"),
                  "FRED DGS10",
                  t("ERP 5~6%", "ERP 5–6%"),
                ].map((tag) => (
                  <span key={tag} className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 장단기 금리차 */}
          <div className="rounded-xl border border-border bg-card px-4 py-4 flex gap-3.5 border-l-4 border-l-red-500">
            <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">📉</div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-[13.5px] font-bold text-foreground">
                {t("장단기 금리차 — 경기침체 조기 경보", "Yield Curve — Early Warning System")}
              </p>
              <p className="text-[12px] text-muted-foreground/75 leading-relaxed">
                {t(
                  "미국 10Y-2Y 국채 스프레드는 역사적으로 가장 신뢰도 높은 경기침체 선행 지표입니다. 스프레드가 역전(음수)되면 리스크 분석 단계에서 매크로 리스크를 자동으로 상향 반영하며, 섹터별 DCF 성장률 가정을 보수적으로 조정합니다. 현재 스프레드 상태는 소개 페이지 하단 대시보드에서 실시간으로 확인할 수 있습니다.",
                  "The US 10Y-2Y Treasury spread is historically the most reliable leading indicator of recessions. When the spread inverts (goes negative), macro risk in the risk analysis step is automatically elevated and sector-specific DCF growth assumptions are adjusted conservatively. The current spread is visible in real-time on the macro dashboard below."
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  t("10Y-2Y 스프레드", "10Y-2Y Spread"),
                  t("역전 시 리스크 상향", "Risk Elevated on Inversion"),
                  t("성장률 보수 조정", "Conservative Growth Adj."),
                ].map((tag) => (
                  <span key={tag} className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-red-100 text-red-800 border border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ETF 섹터 모멘텀 */}
          <div className="rounded-xl border border-border bg-card px-4 py-4 flex gap-3.5 border-l-4 border-l-emerald-500">
            <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">🔄</div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-[13.5px] font-bold text-foreground">
                {t("ETF 섹터 모멘텀 — 자금 흐름 지도", "ETF Sector Momentum — Capital Flow Map")}
              </p>
              <p className="text-[12px] text-muted-foreground/75 leading-relaxed">
                {t(
                  "KOSPI·KOSDAQ·미국 주요 ETF의 가격 모멘텀(1M·3M·6M 스코어 가중 평균)을 계산해 자금이 어떤 섹터로 유입·유출되는지 지속적으로 추적합니다. 섹터 로테이션 신호는 개별 종목 분석 시 업종 매크로 배경 설명에 자동 반영됩니다. ETF 탭에서 실시간 모멘텀 순위를 확인할 수 있습니다.",
                  "Price momentum scores (1M/3M/6M weighted average) are computed across major KOSPI, KOSDAQ, and US ETFs to continuously track which sectors are attracting or shedding capital. Sector rotation signals are automatically incorporated into the macro backdrop description for individual stock analyses. Real-time momentum rankings are available in the ETF tab."
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  t("1M·3M·6M 모멘텀", "1M·3M·6M Momentum"),
                  t("섹터 로테이션", "Sector Rotation"),
                  t("ETF 리밸런싱 추적", "ETF Rebalancing Tracker"),
                  t("실시간 순위", "Live Rankings"),
                ].map((tag) => (
                  <span key={tag} className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* KOSPI·KOSDAQ AI 전망 */}
          <div className="rounded-xl border border-border bg-card px-4 py-4 flex gap-3.5 border-l-4 border-l-violet-500">
            <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">🤖</div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-[13.5px] font-bold text-foreground">
                {t("KOSPI·KOSDAQ AI 지수 전망 (LSTM + GBDT 앙상블)", "KOSPI·KOSDAQ AI Outlook (LSTM + GBDT Ensemble)")}
              </p>
              <p className="text-[12px] text-muted-foreground/75 leading-relaxed">
                {t(
                  "LSTM(장단기 메모리 신경망)과 GBDT(그래디언트 부스팅)를 앙상블해 KOSPI·KOSDAQ의 3일 예측 수익률과 두 모델의 방향 일치 여부를 산출합니다. 두 모델이 동일한 방향(상승/하락)을 가리킬 때 신호 신뢰도가 높아집니다. 이 지수 전망은 ETF 탭 상단에 표시되며, 개별 종목 분석 시 시장 전체 환경 맥락으로 활용됩니다.",
                  "An ensemble of LSTM (Long Short-Term Memory neural network) and GBDT (Gradient Boosting Decision Trees) produces 3-day predicted returns and a directional agreement signal for KOSPI and KOSDAQ. When both models point in the same direction, signal confidence is higher. This index outlook appears at the top of the ETF tab and provides broader market context for individual stock analyses."
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  "LSTM",
                  "GBDT",
                  t("앙상블 예측", "Ensemble Forecast"),
                  t("3일 예측 수익률", "3-Day Return Forecast"),
                  t("방향 일치 신호", "Agreement Signal"),
                ].map((tag) => (
                  <span key={tag} className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-violet-100 text-violet-800 border border-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 리스크 분석 매크로 축 */}
          <div className="rounded-xl border border-border bg-card px-4 py-4 flex gap-3.5 border-l-4 border-l-amber-500">
            <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">⚠️</div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-[13.5px] font-bold text-foreground">
                {t("리스크 분석 5축 — 매크로가 첫 번째", "5-Axis Risk Analysis — Macro Comes First")}
              </p>
              <p className="text-[12px] text-muted-foreground/75 leading-relaxed">
                {t(
                  "7단계 파이프라인의 리스크 분석(6단계)은 매크로·규제·경쟁·재무·이벤트 5개 축을 평가합니다. 특히 매크로 축에서는 금리 상승 민감도, 환율 익스포저, 원자재 가격 연동성, 경기 사이클 민감도를 정량화합니다. 고금리 환경에서 고평가 성장주와 고부채 기업의 리스크는 자동으로 가중됩니다.",
                  "The risk analysis step (step 6) of the 7-stage pipeline evaluates five axes: macro, regulatory, competitive, financial, and event-driven. The macro axis specifically quantifies interest rate sensitivity, FX exposure, commodity price linkage, and business cycle sensitivity. In a high-rate environment, overvalued growth stocks and highly leveraged companies are automatically weighted with greater risk."
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  t("금리 민감도", "Rate Sensitivity"),
                  t("환율 익스포저", "FX Exposure"),
                  t("원자재 연동", "Commodity Linkage"),
                  t("경기 사이클", "Business Cycle"),
                ].map((tag) => (
                  <span key={tag} className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 투자 유의사항 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          {t("투자 유의사항", "Investment Disclaimer")}
        </h2>
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-4 space-y-2">
          <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
            ⚠️ {t("본 서비스는 투자 참고용 정보만을 제공합니다", "This service provides information for reference purposes only")}
          </p>
          <ul className="space-y-1.5">
            {(isEn ? [
              "AiBITDA's analysis results are AI-generated reference materials based on publicly available data and do not constitute investment advice or solicitation.",
              "Target prices and investment opinions are based on data and assumptions at the time of analysis and may change with market conditions.",
              "All investment decisions and resulting gains or losses are the sole responsibility of the investor.",
              "CBST and AiBITDA do not guarantee the accuracy or completeness of analysis results and bear no responsibility for losses from investments.",
            ] : [
              "애빛다의 분석 결과는 AI가 공개된 데이터를 기반으로 생성한 참고 자료이며, 투자 권유·자문이 아닙니다.",
              "목표주가 및 투자의견은 분석 시점의 데이터와 가정에 근거하며, 시장 상황 변화에 따라 달라질 수 있습니다.",
              "모든 투자 결정과 그에 따른 손익은 투자자 본인이 책임집니다.",
              "CBST 및 애빛다 서비스는 분석 결과의 정확성·완전성을 보장하지 않으며, 투자로 인한 손실에 대해 어떠한 책임도 지지 않습니다.",
            ]).map((text, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-amber-900 dark:text-amber-200 leading-relaxed">
                <span className="shrink-0 mt-0.5">•</span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[10px] text-muted-foreground/40 px-1 mt-2 text-center">
          {t("운영사: CBST · support@cbst.ai", "Operator: CBST · support@cbst.ai")}
        </p>
      </section>
    </div>
  );
}
