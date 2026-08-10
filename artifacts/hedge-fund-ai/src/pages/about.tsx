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
  { step: "01", title: "기업 개요", desc: "무슨 사업으로 어떻게 돈을 버는지 — 사업모델·주요제품·산업 내 위치" },
  { step: "02", title: "산업 분석", desc: "이 산업이 지금 어디로 가는지 — 시장 구조·경쟁 구도·전방 수요" },
  { step: "03", title: "촉매 분석", desc: "주가를 움직일 재료 — 실적·수주·규제·이벤트와 그 반영도" },
  { step: "04", title: "실적·재무", desc: "숫자가 무엇을 말하는지 — 연간·분기 손익, 재무 건전성, 컨센서스" },
  { step: "05", title: "사업보고서 행간", desc: "숫자의 '왜' — 몇 년치 공시를 대조해 사업 구성 이동·캐파·고객 집중도·전략 행동을 읽는다" },
  { step: "06", title: "투자 전략", desc: "관점 정리 — 강세·약세 논거와 확인해야 할 조건" },
  { step: "07", title: "6렌즈 행간읽기", desc: "내러티브·조류·사이클·배수 온도·재료의 깊이·정합 — 그리고 종합 한 줄" },
  { step: "08", title: "체크리스트", desc: "12개 항목 점검. 임상 바이오는 파이프라인·현금 런웨이 기준으로 전환" },
];

const PIPELINE_EN = [
  { step: "01", title: "Company Overview", desc: "What the business is and how it makes money — model, products, position" },
  { step: "02", title: "Industry Analysis", desc: "Where the industry is heading — structure, competition, end demand" },
  { step: "03", title: "Catalysts", desc: "What can move the stock — earnings, orders, regulation, events" },
  { step: "04", title: "Earnings & Financials", desc: "What the numbers say — annual/quarterly P&L, balance-sheet health, consensus" },
  { step: "05", title: "Reading Between the Lines", desc: "Why the numbers moved — multi-year filings compared for segment shifts, capacity, customer concentration, strategic moves" },
  { step: "06", title: "Investment Strategy", desc: "Bull and bear cases, and the conditions to verify" },
  { step: "07", title: "Six Lenses", desc: "Narrative, tide, cycle, multiple temperature, depth of catalyst, coherence — plus a one-line verdict" },
  { step: "08", title: "Checklist", desc: "12-point check; clinical-stage biotech switches to pipeline and cash-runway criteria" },
];

/** 주식 관점의 9개 단계 — 백엔드 stage-classifier.ts의 Phase와 같은 순서·같은 말 */
const STAGES = [
  { emoji: "🚀", ko: "폭발 성장", en: "Explosive Growth", tag: "속도가 전부", tagEn: "Speed is everything",
    desc: "매출이 폭발적으로 늘고 있어요. 밸류에이션보다 성장 속도 자체가 주가를 끌고 갑니다.",
    descEn: "Revenue is compounding fast. Growth rate, not valuation, drives the stock here." },
  { emoji: "📈", ko: "숫자 싸움", en: "Proving the Numbers", tag: "실적도 기대도 높음", tagEn: "High bar, high price",
    desc: "실적이 좋고 주가도 그만큼 높아요. 높은 눈높이를 매번 증명해야 유지됩니다.",
    descEn: "Strong results with a price to match. The bar must be cleared every quarter." },
  { emoji: "🔍", ko: "실체 확인", en: "Undervalued but Improving", tag: "좋은데 아직 쌈", tagEn: "Good, still cheap",
    desc: "실적은 좋아지는데 주가는 아직 싸요. 시장이 아직 덜 알아본 상태일 수 있습니다.",
    descEn: "Fundamentals improving while the price lags. The market may not have caught on." },
  { emoji: "🔄", ko: "턴어라운드", en: "Turnaround", tag: "바닥 찍고 반등", tagEn: "Off the bottom",
    desc: "바닥을 찍고 실적이 다시 살아나기 시작했어요. 분위기가 바뀌는 국면입니다.",
    descEn: "Results have started to recover from a trough. The direction is changing." },
  { emoji: "⏳", ko: "증명 대기", en: "Awaiting Proof", tag: "숫자를 기다리는 중", tagEn: "Waiting on numbers",
    desc: "기대는 이미 주가에 붙었는데 숫자는 아직 안 나왔어요. 다음 실적이 방향을 가릅니다.",
    descEn: "Expectations are priced in but the numbers haven't arrived. The next print decides." },
  { emoji: "⚠️", ko: "피크아웃 전조", en: "Past the Peak", tag: "기대가 실적을 앞섬", tagEn: "Hope outruns results",
    desc: "정점을 지나 성장이 식는데 주가 기대는 아직 높아요. 기대가 실적을 앞서간 구간입니다.",
    descEn: "Growth is cooling while expectations stay elevated." },
  { emoji: "🏦", ko: "성숙·가치", en: "Mature / Value", tag: "빠른 성장은 끝", tagEn: "Growth has plateaued",
    desc: "빠른 성장은 끝났고 기대도 낮아졌어요. 이제는 이익과 배당으로 보는 구간입니다.",
    descEn: "Rapid growth is over and expectations are low. Judged on earnings and payout." },
  { emoji: "🫧", ko: "기대 선반영", en: "Priced on Hope", tag: "기대만 앞섬", tagEn: "Story without substance",
    desc: "실적은 뒷걸음치는데 주가엔 기대만 실렸어요. 거품을 경계할 자리입니다.",
    descEn: "Results are sliding while the price carries only expectation." },
  { emoji: "🔻", ko: "쇠퇴", en: "Decline", tag: "실적·기대 동반 하락", tagEn: "Both falling",
    desc: "실적도 기대도 같이 내려가요. 사업이 힘을 잃어가는 국면입니다.",
    descEn: "Both fundamentals and expectations are falling." },
];

const DATA_SOURCES_KO = [
  { name: "Yahoo Finance",    role: "재무제표 · 시세 · 지표",    detail: "EPS·매출·EBITDA·총부채·시가총액·발행주식수 등 글로벌 재무 데이터",                                                                   accent: "border-l-purple-500", dot: "bg-purple-500" },
  { name: "DART (금융감독원)", role: "한국 기업 원천 재무상태표",     detail: "연결·별도 재무상태표 (현금·자산·부채·자본·금융부채 직접 조회) — Yahoo Finance 수치보다 우선 적용",                                          accent: "border-l-blue-500",   dot: "bg-blue-500"   },
  { name: "KRX (한국거래소)", role: "KOSPI·KOSDAQ 종목 목록",         detail: "2,700+ 상장 종목의 정확한 거래소·티커 매핑 — AI의 심볼 오류 자동 교정",                                                                      accent: "border-l-teal-500",   dot: "bg-teal-500"   },
  { name: "ECOS (한국은행)",  role: "한국 실시간 거시지표",            detail: "기준금리·CPI·원달러환율·GDP 성장률 — 업황과 환율 맥락에 실시간 반영",                                                              accent: "border-l-amber-500",  dot: "bg-amber-500"  },
  { name: "FRED (연준)",      role: "미국 실시간 거시지표",            detail: "Fed 금리·10Y/2Y 국채수익률·장단기 스프레드·CPI·GDP·실업률 — 미국 업황 국면 판단에 반영",                                                accent: "border-l-red-500",    dot: "bg-red-500"    },
];

const DATA_SOURCES_EN = [
  { name: "Yahoo Finance",    role: "Financials · Prices · Metrics",      detail: "EPS, revenue, EBITDA, total debt, market cap, shares outstanding — global financial data",                                              accent: "border-l-purple-500", dot: "bg-purple-500" },
  { name: "DART (FSS Korea)", role: "Korean company balance sheets",       detail: "Consolidated & separate balance sheets (cash, assets, liabilities, equity, financial debt direct lookup) — takes precedence over Yahoo Finance", accent: "border-l-blue-500",   dot: "bg-blue-500"   },
  { name: "KRX (Korea Exchange)", role: "KOSPI · KOSDAQ listings",         detail: "Accurate exchange and ticker mapping for 2,700+ listed stocks — auto-corrects AI symbol errors",                                                accent: "border-l-teal-500",   dot: "bg-teal-500"   },
  { name: "ECOS (Bank of Korea)", role: "Korean real-time macro data",     detail: "Base rate, CPI, USD/KRW, GDP growth — live context for industry conditions and FX",                                                  accent: "border-l-amber-500",  dot: "bg-amber-500"  },
  { name: "FRED (Fed Reserve)",   role: "US real-time macro data",         detail: "Fed funds rate, 10Y/2Y Treasury yields, yield spread, CPI, GDP, unemployment — live context for US cycle reads",                              accent: "border-l-red-500",    dot: "bg-red-500"    },
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
  { title: "숫자는 코드가 뽑습니다", badge: "Server-Extracted Metrics", badgeColor: "bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-700", desc: "매출·설비투자·R&D·생산능력·가동률·임직원 수·운전자본을 서버가 공시 원문에서 직접 추출해 표로 만든 뒤 AI에 넘깁니다. AI가 수백 쪽에서 숫자를 찾게 하면 다른 해의 값이 섞입니다 — 찾을 일 자체를 없앴습니다.", icon: "📐" },
  { title: "사라진 것을 찾아냅니다", badge: "Disappearance Detection", badgeColor: "bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-900/50 dark:text-rose-200 dark:border-rose-700", desc: "회사는 접은 사업을 굳이 말하지 않습니다. 연도별 매출 비중 표의 사업부문 목록을 집합으로 비교해, 조용히 사라진 부문과 새로 등장한 부문을 기간까지 짚어 보여줍니다.", icon: "🔎" },
  { title: "9개 단계 자동 판정", badge: "Business Stage Classifier", badgeColor: "bg-blue-100 text-blue-900 border border-blue-300 dark:bg-blue-900/50 dark:text-blue-200 dark:border-blue-700", desc: "성장률·이익률 추세·설비투자 방향·운전자본·인력 변화와 업종 배수 대비 위치를 조합해 폭발 성장·숫자 싸움·턴어라운드 등 9개 단계 중 하나로 판정합니다. 판정에 쓰인 신호를 전부 공개합니다.", icon: "🧭" },
  { title: "최신 분기가 먼저 반영됩니다", badge: "Quarter-First Signals", badgeColor: "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-700", desc: "연간 실적만 보면 턴어라운드를 1년 늦게 압니다. 최신 확정 분기를 전년 같은 분기와 비교(계절성 제거)해, 연간이 아직 적자여도 분기가 먼저 돌아선 것을 잡아냅니다.", icon: "⚡" },
  { title: "고객 집중도를 숫자로", badge: "Customer Concentration", badgeColor: "bg-violet-100 text-violet-900 border border-violet-300 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-700", desc: "회사가 고객명을 밝히지 않아도, 재무제표 주석의 '단일 외부고객 매출 10% 초과' 공시에서 금액을 뽑아 매출 대비 비중과 전년 대비 증감을 계산합니다.", icon: "🎯" },
  { title: "새로 등장한 기술을 포착", badge: "Emerging Terms", badgeColor: "bg-sky-100 text-sky-900 border border-sky-300 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-700", desc: "과거 보고서엔 없다가 최근에 반복 등장한 기술·제품 용어를 추려냅니다. 회사가 어디로 가고 있는지는 새 단어에서 먼저 드러납니다.", icon: "🆕" },
  { title: "뉴스로 행간을 보충", badge: "News Cross-Reference", badgeColor: "bg-orange-100 text-orange-900 border border-orange-300 dark:bg-orange-900/50 dark:text-orange-200 dark:border-orange-700", desc: "공시는 6~12개월 전 회사가 밝힌 방향이고, 뉴스는 지금 벌어지는 일입니다. 각 지표 해설에 관련 뉴스를 엮어 '왜 이렇게 변했는가'를 채웁니다.", icon: "📰" },
  { title: "없는 것은 없다고 적습니다", badge: "No Silent Gaps", badgeColor: "bg-slate-100 text-slate-900 border border-slate-300 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-600", desc: "공시에 없는 항목은 추정하지 않고 '공시 미확인'으로 남깁니다. 수집이 실패하면 실패한 사실을 드러냅니다 — 조용히 빈칸을 지어내는 것이 가장 위험합니다.", icon: "🚧" },
];

const DIFFERENTIATORS_EN = [
  { title: "Metrics Extracted by Code", badge: "Server-Extracted Metrics", badgeColor: "bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-700", desc: "Revenue, capex, R&D, capacity, utilization, headcount and working capital are pulled straight from the filings by the server and handed to the AI as a table. Letting an AI hunt through hundreds of pages mixes up years — so we removed the hunting.", icon: "📐" },
  { title: "Detecting What Disappeared", badge: "Disappearance Detection", badgeColor: "bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-900/50 dark:text-rose-200 dark:border-rose-700", desc: "Companies rarely announce a business they quietly shut. We compare segment lists across years as sets, surfacing divisions that vanished and ones that newly appeared — with the period pinpointed.", icon: "🔎" },
  { title: "Nine-Stage Classifier", badge: "Business Stage Classifier", badgeColor: "bg-blue-100 text-blue-900 border border-blue-300 dark:bg-blue-900/50 dark:text-blue-200 dark:border-blue-700", desc: "Growth, margin trend, capex direction, working capital, headcount and position versus sector multiple bands combine into one of nine stages. Every signal behind the verdict is disclosed.", icon: "🧭" },
  { title: "Latest Quarter Leads", badge: "Quarter-First Signals", badgeColor: "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-700", desc: "Annual-only reading spots a turnaround a year late. We compare the latest reported quarter against the same quarter a year earlier, catching a turn even while the full year is still in the red.", icon: "⚡" },
  { title: "Customer Concentration in Numbers", badge: "Customer Concentration", badgeColor: "bg-violet-100 text-violet-900 border border-violet-300 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-700", desc: "Even when the customer is unnamed, the footnote disclosing revenue from a single external customer above 10% gives an amount — we turn it into a share of revenue and a year-over-year change.", icon: "🎯" },
  { title: "Newly Emerging Technology", badge: "Emerging Terms", badgeColor: "bg-sky-100 text-sky-900 border border-sky-300 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-700", desc: "Technical and product terms absent from older filings but repeated in recent ones are surfaced. Where a company is heading usually shows up in its new vocabulary first.", icon: "🆕" },
  { title: "News Fills the Gaps", badge: "News Cross-Reference", badgeColor: "bg-orange-100 text-orange-900 border border-orange-300 dark:bg-orange-900/50 dark:text-orange-200 dark:border-orange-700", desc: "Filings state where the company said it was going 6–12 months ago; news says what is happening now. Related headlines are woven into each metric to explain why it moved.", icon: "📰" },
  { title: "No Silent Gaps", badge: "No Silent Gaps", badgeColor: "bg-slate-100 text-slate-900 border border-slate-300 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-600", desc: "What isn't disclosed is marked as such rather than estimated. When collection fails, the failure is surfaced — quietly inventing the blanks is the most dangerous outcome.", icon: "🚧" },
];

const ASSUMPTIONS_KO = [
  {
    title: "단계 판정에 쓰는 신호",
    items: [
      "실적: 매출 성장률, 영업이익률 추세, 설비투자 방향",
      "체력: 운전자본(현금전환주기), 임직원 증감, 가동률",
      "구조: 사업부문 신규·소멸, 최신 확정 분기의 전년 동기 대비",
    ],
  },
  {
    title: "시장 기대(밸류에이션) 축",
    items: [
      "업종별 PER·PBR 실측 밴드에서 이 종목이 놓인 분위(0~100)",
      "밴드는 매일 장마감 후 종목 마스터에서 사분위수로 재집계",
      "표본이 5종목 미만이면 밴드를 쓰지 않습니다 — 틀린 숫자는 없는 숫자보다 나쁩니다",
    ],
  },
  {
    title: "단계 구분 문턱",
    items: [
      "폭발 성장: 매출 성장률 40% 이상(연간 또는 최신 분기)",
      "실체 강함/역성장: 신호 합산 점수 +30 이상 / −15 이하",
      "턴어라운드: 직전 바닥 대비 큰 폭 개선, 또는 최신 분기 흑자전환",
    ],
  },
  {
    title: "수집 범위",
    items: [
      "한국: DART 사업·반기·분기보고서 원문 (최근 4년)",
      "미국: SEC EDGAR 10-K/20-F 본문과 XBRL 재무 (최근 4~5년)",
      "직원 현황·재무제표 주석 등 구조화 공시는 전용 API로 별도 수집",
    ],
  },
];

const ASSUMPTIONS_EN = [
  {
    title: "Signals Behind the Stage",
    items: [
      "Results: revenue growth, operating-margin trend, capex direction",
      "Health: cash conversion cycle, headcount change, utilization",
      "Structure: segments added or dropped, latest quarter versus the same quarter last year",
    ],
  },
  {
    title: "The Market-Expectation Axis",
    items: [
      "Where the stock sits (0–100) within measured PER/PBR bands for its sector",
      "Bands are recomputed daily after the close as quartiles across the stock master",
      "Bands with fewer than 5 constituents are not used — a wrong number is worse than none",
    ],
  },
  {
    title: "Stage Thresholds",
    items: [
      "Explosive growth: revenue up 40%+ (annual or latest quarter)",
      "Strong / contracting fundamentals: combined signal score above +30 / below −15",
      "Turnaround: large improvement off a trough, or the latest quarter swinging to profit",
    ],
  },
  {
    title: "Collection Scope",
    items: [
      "Korea: DART annual, semi-annual and quarterly filings (last 4 years)",
      "US: SEC EDGAR 10-K/20-F narrative plus XBRL financials (last 4–5 years)",
      "Structured disclosures such as headcount and footnotes are collected via dedicated APIs",
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
            "AI로 기업가치를 밝히다 — 사업보고서 몇 년치를 나란히 놓고 행간을 읽어, 이 기업이 지금 어떤 단계에 있는지 알려주는 AI 주식 리서치 플랫폼입니다.",
            "Illuminating value with AI — a stock research platform that reads between the lines of multi-year filings to tell you what stage a company is actually in."
          )}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {(isEn
            ? ["KOSPI·KOSDAQ", "NYSE·NASDAQ", "Multi-year Filings", "9 Business Stages", "8-Step AI Pipeline", "Live Macro Data"]
            : ["KOSPI·KOSDAQ", "NYSE·NASDAQ", "사업보고서 다년치 대조", "9개 사업 단계 판정", "8단계 AI 파이프라인", "실시간 거시지표"]
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
                  "테마와 모멘텀은 사라지지만 사업의 방향은 공시에 남습니다. 증설했는지, 사업을 접었는지, 고객이 한 곳에 몰렸는지 — 회사가 이미 밝혀 놓은 사실입니다. 다만 수백 쪽 보고서 여러 해치를 나란히 놓고 대조하는 일을 개인이 하기 어려울 뿐입니다.",
                  "Themes and momentum fade, but a company's direction is recorded in its filings. Capacity added, a business quietly dropped, customers concentrating — the company has already disclosed it. The hard part is placing hundreds of pages across several years side by side and comparing them."
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
                  "그 대조를 서버가 대신합니다. 몇 년치 공시에서 매출 구성의 이동, 생산능력, 고객 집중도, 임직원 수, 운전자본을 뽑아내고 — 사라진 사업과 새로 등장한 기술까지 짚습니다. 그리고 \"이 기업이 지금 어떤 단계인가\"를 9개 단계 중 하나로 판정합니다. 목표주가를 맞히는 대신, 공시된 사실로 흐름을 읽습니다.",
                  "We do that comparison for you. The server extracts segment shifts, capacity, customer concentration, headcount, and working capital from years of filings — and flags businesses that quietly disappeared and technologies that newly appeared. Then it classifies the company into one of nine business stages. Instead of predicting a target price, we read the trajectory from disclosed facts."
                )}
              </p>
            </div>
          </div>
        </div>

        {/* 분석 원칙 */}
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-4 space-y-2.5">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
            {t("분석 원칙", "How We Analyze")}
          </p>
          <div className="space-y-2 text-[12px] text-muted-foreground/80 leading-relaxed">
            <p>
              <span className="font-semibold text-foreground">
                {t("① 숫자는 코드가 뽑고, AI는 해석만 합니다.", "① Code extracts the numbers; the AI only interprets.")}
              </span>{" "}
              {t(
                "매출·설비투자·R&D·생산능력·임직원 수·운전자본을 서버가 공시 원문에서 직접 뽑아 표로 만든 뒤 AI에 넘깁니다. AI가 수백 쪽에서 숫자를 찾게 하면 다른 해의 값이 섞입니다 — 찾을 일 자체를 없앴습니다.",
                "The server pulls revenue, capex, R&D, capacity, headcount, and working capital straight from the filings and hands the AI a table. Letting an AI hunt for numbers across hundreds of pages mixes up years — so we removed the hunting."
              )}
            </p>
            <p>
              <span className="font-semibold text-foreground">
                {t("② 단계는 실측 신호로 판정합니다.", "② Stages are decided by measured signals.")}
              </span>{" "}
              {t(
                "매출 성장률·이익률 추세·설비투자 방향·운전자본·인력 변화, 그리고 업종 배수 대비 위치를 조합해 9개 단계 중 하나로 판정합니다. 판정에 쓰인 신호를 모두 공개하므로 근거를 되짚을 수 있습니다.",
                "Revenue growth, margin trend, capex direction, working capital, headcount, and where the multiple sits versus its sector band combine into one of nine stages. Every signal used is shown, so the verdict can be traced."
              )}
            </p>
            <p>
              <span className="font-semibold text-foreground">
                {t("③ 없는 것은 없다고 적습니다.", "③ If it isn't disclosed, we say so.")}
              </span>{" "}
              {t(
                "공시에 없는 항목은 추정하지 않고 \"공시 미확인\"으로 남깁니다. 수집이 실패하면 실패한 사실을 드러냅니다 — 조용히 빈칸을 지어내는 것이 가장 위험합니다.",
                "What the filings don't disclose is left as \"not disclosed\" rather than estimated. When collection fails, we surface the failure — quietly inventing the blanks is the most dangerous outcome."
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

      {/* 9개 사업 단계 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          {t("기업이 놓이는 9개 단계", "Nine Business Stages")}
        </h2>

        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {STAGES.map((s) => (
            <div key={s.ko} className="px-4 py-3 flex gap-3">
              <span className="text-[17px] leading-none mt-0.5 shrink-0 select-none">{s.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-foreground">{isEn ? s.en : s.ko}</span>
                  <span className="text-[11px] text-muted-foreground/70">{isEn ? s.tagEn : s.tag}</span>
                </div>
                <p className="text-[12px] text-muted-foreground/75 leading-relaxed mt-0.5">
                  {isEn ? s.descEn : s.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/50 px-1 mt-2.5 leading-relaxed">
          {t(
            "실적(성장률·이익률 추세·설비투자·운전자본·인력)과 시장 기대(업종 배수 대비 위치)를 조합해 판정합니다. 같은 '성장'이라도 속도가 전부인 구간과 눈높이를 증명해야 하는 구간은 판단 기준이 다르므로 나눕니다.",
            "Stages combine fundamentals (growth, margin trend, capex, working capital, headcount) with market expectation (position versus sector multiple bands). Explosive growth and 'prove the expectations' are separated because they demand different judgments."
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
                    sub: t("장기 금리", "Long-term rate"),
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
          {/* 금리 환경 반영 */}
          <div className="rounded-xl border border-border bg-card px-4 py-4 flex gap-3.5 border-l-4 border-l-blue-500">
            <div className="text-[20px] leading-none mt-0.5 shrink-0 select-none">📐</div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-[13.5px] font-bold text-foreground">
                {t("금리 환경을 국면 판단에 반영", "Rate Environment Feeds the Stage Read")}
              </p>
              <p className="text-[12px] text-muted-foreground/75 leading-relaxed">
                {t(
                  "금리는 업황과 투자 여력을 가릅니다. 한국은 ECOS 기준금리·국고채 10Y, 미국은 FRED 10년 국채(DGS10)를 실시간으로 받아 산업 분석과 촉매 판단의 배경으로 씁니다. 금리가 오르면 설비투자 확대와 차입 부담을 다르게 읽어야 합니다.",
                  "Rates decide industry conditions and a company's room to invest. Korean names pull the Bank of Korea base rate and KTB 10Y via ECOS; US names pull FRED's DGS10 — live context for the industry read and catalyst judgment. When rates rise, capex expansion and debt load must be read differently."
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
              "Stage classifications and interpretations rest on data disclosed at the time of analysis and may change with new filings or market conditions.",
              "All investment decisions and resulting gains or losses are the sole responsibility of the investor.",
              "CBST and AiBITDA do not guarantee the accuracy or completeness of analysis results and bear no responsibility for losses from investments.",
            ] : [
              "애빛다의 분석 결과는 AI가 공개된 데이터를 기반으로 생성한 참고 자료이며, 투자 권유·자문이 아닙니다.",
              "사업 단계 판정과 해석은 분석 시점에 공시된 데이터에 근거하며, 새 공시·시장 상황에 따라 달라질 수 있습니다.",
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
