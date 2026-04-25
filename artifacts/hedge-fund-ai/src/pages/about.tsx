import { useEffect, useState } from "react";
import { cn, getApiUrl } from "@/lib/utils";
import { TrendingUp, Globe, RefreshCw, Loader2 } from "lucide-react";

interface MacroData {
  ecos: {
    baseRate: number | null;
    cpiYoY: number | null;
    usdKrw: number | null;
    latestPeriods: { baseRate: string; cpi: string; usdKrw: string };
  } | null;
  fred: {
    fedFundsRate: number | null;
    t10y: number | null;
    t2y: number | null;
    yieldSpread: number | null;
    cpiYoY: number | null;
    gdpGrowth: number | null;
    unemploymentRate: number | null;
    latestDates: { fedFunds: string; treasury: string; cpi: string; gdp: string };
  } | null;
  fetchedAt: number;
}

const pipeline = [
  { step: "01", title: "기업 개요", desc: "사업모델·경영진·주요제품·성장전략·지배구조 분석" },
  { step: "02", title: "재무 분석", desc: "매출·이익·현금흐름·부채·WACC 등 정량 지표 심층 분석" },
  { step: "03", title: "산업·경쟁", desc: "TAM·경쟁 포지셔닝·시장점유율·해자 강도 평가" },
  { step: "04", title: "절대 가치", desc: "DCF / 배당할인·rNPV·NAV·AFFO 등 섹터별 절대가치 산출" },
  { step: "05", title: "상대 가치", desc: "P/E·EV/EBITDA·P/B·EV/R 등 피어 멀티플 비교 분석" },
  { step: "06", title: "리스크 분석", desc: "매크로·규제·경쟁·재무·이벤트 리스크 5축 평가" },
  { step: "07", title: "최종 조율", desc: "6단계 결과를 종합해 목표주가·투자의견·핵심 논거 도출" },
];

const dataSources = [
  {
    name: "Yahoo Finance",
    role: "재무제표 · WACC 핵심 수치",
    detail: "EPS·매출·EBITDA·총부채·시가총액·베타·발행주식수 등 글로벌 재무 데이터",
    color: "bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800",
    dot: "bg-purple-500",
  },
  {
    name: "DART (금융감독원)",
    role: "한국 기업 원천 재무상태표",
    detail: "연결·별도 재무상태표 (현금·자산·부채·자본·금융부채 직접 조회) — Yahoo Finance 수치보다 우선 적용",
    color: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
    dot: "bg-blue-500",
  },
  {
    name: "KRX (한국거래소)",
    role: "KOSPI·KOSDAQ 종목 목록",
    detail: "2,700+ 상장 종목의 정확한 거래소·티커 매핑 — AI의 심볼 오류 자동 교정",
    color: "bg-teal-50 border-teal-200 dark:bg-teal-950/30 dark:border-teal-800",
    dot: "bg-teal-500",
  },
  {
    name: "ECOS (한국은행)",
    role: "한국 실시간 거시지표",
    detail: "기준금리·CPI·원달러환율·GDP 성장률 — WACC 무위험수익률·환율 환산에 실시간 반영",
    color: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
    dot: "bg-amber-500",
  },
  {
    name: "FRED (연준)",
    role: "미국 실시간 거시지표",
    detail: "Fed 금리·10Y/2Y 국채수익률·장단기 스프레드·CPI·GDP·실업률 — 미국 주식 WACC Rf에 실시간 반영",
    color: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
    dot: "bg-red-500",
  },
];

type MethodTag = {
  label: string;
  color: string;
};

type SectorItem = {
  name: string;
  tags: MethodTag[];
};

type SectorGroup = {
  market: string;
  subtitle: string;
  headerCls: string;
  borderCls: string;
  items: SectorItem[];
};

const METHOD_COLORS: Record<string, string> = {
  DCF:        "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  EV:         "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  SOTP:       "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  NAV:        "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  FFO:        "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  rNPV:       "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  PBV:        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  Backlog:    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  RAB:        "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  Rule40:     "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
  Royalty:    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  NII:        "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300",
};

const sectorGroups: SectorGroup[] = [
  {
    market: "한국",
    subtitle: "KOSPI · KOSDAQ",
    headerCls: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
    borderCls: "border-l-blue-400",
    items: [
      { name: "일반기업",    tags: [{ label: "DCF",          color: METHOD_COLORS.DCF   }, { label: "EV/EBITDA",   color: METHOD_COLORS.EV    }] },
      { name: "지주·복합기업", tags: [{ label: "SOTP",         color: METHOD_COLORS.SOTP  }] },
      { name: "리츠",        tags: [{ label: "FFO/AFFO",     color: METHOD_COLORS.FFO   }, { label: "NAV",         color: METHOD_COLORS.NAV   }] },
      { name: "바이오·신약",  tags: [{ label: "rNPV (PoS)",   color: METHOD_COLORS.rNPV  }] },
      { name: "은행·금융",   tags: [{ label: "P/BV",         color: METHOD_COLORS.PBV   }, { label: "ROE-CoE",     color: METHOD_COLORS.PBV   }] },
      { name: "자원·에너지", tags: [{ label: "EV/Reserve",   color: METHOD_COLORS.EV    }, { label: "NAV",         color: METHOD_COLORS.NAV   }] },
      { name: "통신·인프라", tags: [{ label: "EV/EBITDA",    color: METHOD_COLORS.EV    }, { label: "배당수익률",   color: METHOD_COLORS.FFO   }] },
      { name: "건설·디벨로퍼", tags: [{ label: "수주잔고",    color: METHOD_COLORS.Backlog}, { label: "분양률 NAV",  color: METHOD_COLORS.NAV   }] },
      { name: "유틸리티·전력", tags: [{ label: "RAB",         color: METHOD_COLORS.RAB   }, { label: "EV/EBITDA",  color: METHOD_COLORS.EV    }] },
    ],
  },
  {
    market: "미국 · 글로벌",
    subtitle: "NYSE · NASDAQ",
    headerCls: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
    borderCls: "border-l-red-400",
    items: [
      { name: "리츠 (REIT)",      tags: [{ label: "P/AFFO",      color: METHOD_COLORS.FFO   }, { label: "Cap Rate NAV",  color: METHOD_COLORS.NAV   }] },
      { name: "바이오 (Biotech)", tags: [{ label: "rNPV",         color: METHOD_COLORS.rNPV  }, { label: "PDUFA 드리븐",  color: METHOD_COLORS.rNPV  }] },
      { name: "방산 (Defense)",   tags: [{ label: "Backlog",      color: METHOD_COLORS.Backlog}, { label: "EAC FCF",      color: METHOD_COLORS.DCF   }] },
      { name: "은행 (Bank)",      tags: [{ label: "P/TBVPS",      color: METHOD_COLORS.PBV   }, { label: "Justified",    color: METHOD_COLORS.PBV   }] },
      { name: "MLP",              tags: [{ label: "DCF 분배",      color: METHOD_COLORS.DCF   }, { label: "EV/EBITDA",    color: METHOD_COLORS.EV    }] },
      { name: "BDC",              tags: [{ label: "포트폴리오 NAV", color: METHOD_COLORS.NAV  }, { label: "NII 배당",      color: METHOD_COLORS.NII   }] },
      { name: "로열티 스트림",    tags: [{ label: "로열티 DCF",    color: METHOD_COLORS.Royalty}] },
      { name: "빅테크·플랫폼",   tags: [{ label: "Rule of 40",   color: METHOD_COLORS.Rule40}, { label: "FCF Yield",     color: METHOD_COLORS.DCF   }, { label: "SOTP", color: METHOD_COLORS.SOTP }] },
    ],
  },
];

const differentiators = [
  {
    title: "자기검증 반론 에이전트",
    badge: "Self-Adversarial Review",
    badgeColor: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    desc: "재무 전망과 밸류에이션 단계 완료 후, AI가 스스로 핵심 가정에 대해 3가지 각도로 반론을 생성합니다. WACC 과소/과대 여부, 성장률 낙관성, 멀티플 정당성을 별도 에이전트가 비판적으로 검토합니다.",
    icon: "⚔️",
  },
  {
    title: "WACC 자동 가드레일",
    badge: "Auto WACC Guardrail",
    badgeColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    desc: "한국 WACC 정상 범위 8~14%, 미국 7~12%를 코드에 하드코딩했습니다. WACC < 8% 감지 시 '과소 경고'와 함께 10%로 자동 상향, WACC > 15% 시 과대 경고 후 재검토를 강제합니다. 임의로 낮은 할인율을 써서 목표주가를 부풀리는 오류를 원천 차단합니다.",
    icon: "🛡️",
  },
  {
    title: "섹터별 지표 오용 차단",
    badge: "Metric Prohibition System",
    badgeColor: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    desc: "리츠에는 DCF·EV/EBITDA 단독 사용을 명시적으로 금지하고, 은행·금융주에는 EV/EBITDA를 금지합니다. MLP·BDC에는 EPS·PER을 완전 금지합니다. 섹터 특성을 무시한 잘못된 배수 적용이 불가능합니다.",
    icon: "🚫",
  },
  {
    title: "3단 데이터 우선순위 체계",
    badge: "Multi-Source Priority Stack",
    badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    desc: "한국 기업의 재무상태표는 DART(1순위) → Yahoo Finance(2순위) → Naver(3순위)로 자동 폴백합니다. Yahoo Finance가 한국 주식 주가를 IPO 가격으로 반환하는 버그를 Naver 실시간 종가로 교정하고, KRX 기준 발행주식수를 재계산해 EPS 왜곡을 방지합니다.",
    icon: "🗂️",
  },
  {
    title: "롤링 컨텍스트 누적",
    badge: "Rolling Context Pipeline",
    badgeColor: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    desc: "7단계 파이프라인에서 각 에이전트는 이전 단계의 분석 결과 전체를 읽고 명시적으로 반영합니다. 팀장 브리핑 → 산업 분석 → 재무 분석 → 밸류에이션 → 최종 조율로 이어지는 누적 컨텍스트가 일관된 논리를 보장합니다.",
    icon: "🔗",
  },
  {
    title: "FDA 지정별 PoS 자동 보정",
    badge: "FDA Designation PoS Adjuster",
    badgeColor: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
    desc: "미국 바이오 분석 시 FDA Breakthrough Therapy 지정(+5~10%p), Priority Review(+3~5%p), Fast Track(+2~3%p)에 따라 임상 성공 확률을 자동 상향합니다. PDUFA 날짜와 AdCom 반대 다수 시 CRL 리스크를 별도 시나리오로 강제 산출합니다.",
    icon: "💊",
  },
  {
    title: "실시간 뉴스·이벤트 반영",
    badge: "News & Catalyst Integration",
    badgeColor: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    desc: "실적 서프라이즈·FDA 결정·M&A·규제 이슈·경영진 교체 등 주가에 직접 영향을 미칠 수 있는 뉴스와 카탈리스트를 분석에 반영합니다. 단순 재무 수치를 넘어 시장 이벤트 드리븐 관점까지 목표주가에 통합합니다.",
    icon: "📰",
  },
];

const assumptions = [
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

export default function AboutPage() {
  const [macroData, setMacroData] = useState<MacroData | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);

  const fetchMacro = async () => {
    setMacroLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/macro"), { credentials: "include" });
      if (r.ok) setMacroData(await r.json());
    } catch { /* silent */ } finally {
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
          애빛다 소개
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          AI로 기업가치를 밝히다 — 헤지펀드 수준의 밸류에이션 방법론을 누구나 사용할 수 있도록 설계된 AI 주식 리서치 플랫폼입니다.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {["KOSPI·KOSDAQ", "NYSE·NASDAQ", "16개 전용 밸류에이션 모델", "7단계 AI 파이프라인", "실시간 거시지표"].map((tag) => (
            <span key={tag} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* AI 파이프라인 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          7단계 AI 분석 파이프라인
        </h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {pipeline.map((p, i) => (
            <div key={p.step} className="flex items-start gap-4 px-4 py-3.5">
              <div className={cn(
                "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black mt-0.5",
                i === 6
                  ? "bg-primary text-white"
                  : "bg-muted text-muted-foreground"
              )}>
                {p.step}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-foreground">{p.title}</p>
                <p className="text-[12px] text-muted-foreground/70 mt-0.5 leading-relaxed">{p.desc}</p>
              </div>
              {i === 6 && (
                <span className="shrink-0 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20 mt-1">
                  조율
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 데이터 소스 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          실시간 데이터 소스
        </h2>
        <div className="space-y-2.5">
          {dataSources.map((src) => (
            <div key={src.name} className={cn("rounded-xl border px-4 py-3.5 flex gap-3", src.color)}>
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
          왜 애빛다인가
        </h2>

        {/* 차별화 포인트 */}
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
          섹터별 전문 밸류에이션 방법론 (17개)
        </h2>

        <div className="space-y-4">
          {sectorGroups.map((group) => (
            <div key={group.market} className={cn("rounded-xl border overflow-hidden", group.headerCls)}>
              {/* 그룹 헤더 */}
              <div className={cn("px-4 py-2.5 border-b flex items-center justify-between", group.headerCls)}>
                <span className="text-[13px] font-black tracking-tight text-foreground/80">{group.market}</span>
                <span className="text-[10.5px] font-semibold text-muted-foreground/60 font-mono">{group.subtitle}</span>
              </div>

              {/* 섹터 카드 그리드 */}
              <div className="bg-card grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x-0">
                {group.items.map((item, i) => (
                  <div
                    key={item.name}
                    className={cn(
                      "flex flex-col gap-1.5 px-3.5 py-3 border-l-[3px] border-b border-border/50",
                      group.borderCls,
                      i % 2 === 0 ? "" : ""
                    )}
                  >
                    <span className="text-[12.5px] font-semibold text-foreground">{item.name}</span>
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <span
                          key={tag.label}
                          className={cn("text-[10.5px] font-bold px-2 py-0.5 rounded-md", tag.color)}
                        >
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
          AI가 종목명·산업을 자동 감지해 해당 섹터 전용 밸류에이션 프레임을 적용합니다.
          일반 DCF와 별도로 섹터 고유 지표(AFFO·Backlog·rNPV 등)를 의무 산출합니다.
        </p>
      </section>

      {/* 주요 가정 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          주요 가정 및 방법론
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
            실시간 거시경제 현황
          </h2>
          <button
            onClick={fetchMacro}
            disabled={macroLoading}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-primary transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", macroLoading && "animate-spin")} />
            새로고침
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground/60 px-1 mb-3">AI 분석에 실시간으로 반영되는 거시경제 지표입니다.</p>

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
                <span className="text-[11px] font-bold text-foreground/70 uppercase tracking-wide">한국 (ECOS · 한국은행)</span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border/40">
                {[
                  {
                    label: "기준금리",
                    value: macroData?.ecos?.baseRate != null ? `${macroData.ecos.baseRate.toFixed(2)}%` : "—",
                    sub: macroData?.ecos?.latestPeriods?.baseRate
                      ? `${macroData.ecos.latestPeriods.baseRate.slice(0,4)}.${macroData.ecos.latestPeriods.baseRate.slice(4)}`
                      : "",
                  },
                  {
                    label: "CPI (YoY)",
                    value: macroData?.ecos?.cpiYoY != null ? `+${macroData.ecos.cpiYoY.toFixed(2)}%` : "—",
                    sub: macroData?.ecos?.latestPeriods?.cpi
                      ? `${macroData.ecos.latestPeriods.cpi.slice(0,4)}.${macroData.ecos.latestPeriods.cpi.slice(4)}`
                      : "",
                  },
                  {
                    label: "원/달러",
                    value: macroData?.ecos?.usdKrw != null ? `${macroData.ecos.usdKrw.toFixed(0)}원` : "—",
                    sub: "매매기준율",
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
                <span className="text-[11px] font-bold text-foreground/70 uppercase tracking-wide">미국 (FRED · 연준)</span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border/40">
                {[
                  {
                    label: "Fed 금리",
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
                    value: macroData?.fred?.cpiYoY != null ? `+${macroData.fred.cpiYoY.toFixed(2)}%` : "—",
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
              {macroData?.fred && (
                <div className={cn(
                  "px-3 py-2 border-t border-border/40 text-center text-[11px] font-medium",
                  (macroData.fred.yieldSpread ?? 0) < 0
                    ? "text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20"
                )}>
                  장단기 금리차(10Y-2Y) {macroData.fred.yieldSpread != null
                    ? `${macroData.fred.yieldSpread > 0 ? "+" : ""}${macroData.fred.yieldSpread.toFixed(2)}%p`
                    : "—"
                  } — {(macroData.fred.yieldSpread ?? 0) < 0 ? "수익률 곡선 역전 (경기침체 신호)" : "정상 우상향 (경기 회복 국면)"}
                </div>
              )}
            </div>

            {macroData?.fetchedAt && (
              <p className="text-[10px] text-muted-foreground/30 text-right">
                마지막 업데이트: {new Date(macroData.fetchedAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}
      </section>

      {/* 투자 유의사항 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          투자 유의사항
        </h2>
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-4 space-y-2">
          <p className="text-[13px] font-semibold text-amber-800 dark:text-amber-300">⚠️ 본 서비스는 투자 참고용 정보만을 제공합니다</p>
          <ul className="space-y-1.5">
            {[
              "애빛다의 분석 결과는 AI가 공개된 데이터를 기반으로 생성한 참고 자료이며, 투자 권유·자문이 아닙니다.",
              "목표주가 및 투자의견은 분석 시점의 데이터와 가정에 근거하며, 시장 상황 변화에 따라 달라질 수 있습니다.",
              "모든 투자 결정과 그에 따른 손익은 투자자 본인이 책임집니다.",
              "CBST 및 애빛다 서비스는 분석 결과의 정확성·완전성을 보장하지 않으며, 투자로 인한 손실에 대해 어떠한 책임도 지지 않습니다.",
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
                <span className="shrink-0 mt-0.5">•</span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[10px] text-muted-foreground/40 px-1 mt-2 text-center">운영사: CBST · support@cbst.ai</p>
      </section>
    </div>
  );
}
