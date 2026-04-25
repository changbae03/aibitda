import { cn } from "@/lib/utils";

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

const sectors = [
  { label: "한국 일반기업", method: "DCF + EV/EBITDA" },
  { label: "한국 지주·복합기업", method: "SOTP (사업부별 합산)" },
  { label: "한국 리츠", method: "FFO 배당수익률 + NAV" },
  { label: "한국 바이오·신약", method: "rNPV (임상 PoS 보정)" },
  { label: "한국 은행·금융", method: "P/BV + ROE-CoE 잔여이익" },
  { label: "한국 자원·에너지", method: "EV/Reserve + NAV" },
  { label: "한국 통신·인프라", method: "EV/EBITDA + 배당수익률" },
  { label: "한국 건설·디벨로퍼", method: "수주잔고 + 분양률 NAV" },
  { label: "한국 유틸리티·전력", method: "RAB Valuation + EV/EBITDA" },
  { label: "미국 리츠 (US REIT)", method: "P/AFFO + 서브섹터 Cap Rate NAV" },
  { label: "미국 바이오 (Biotech)", method: "rNPV + PDUFA 이벤트 드리븐" },
  { label: "미국 방산 (Defense)", method: "Backlog + Book-to-Bill + EAC FCF" },
  { label: "미국 은행 (Bank)", method: "P/TBVPS + Justified P/TBVPS" },
  { label: "MLP (마스터합자회사)", method: "DCF 분배 + EV/EBITDA" },
  { label: "BDC (사업개발회사)", method: "포트폴리오 NAV + NII 배당" },
  { label: "로열티 스트림", method: "로열티 수익 DCF" },
  { label: "빅테크·플랫폼", method: "Rule of 40 + FCF Yield + SOTP" },
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

      {/* 섹터별 밸류에이션 */}
      <section>
        <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
          섹터별 전문 밸류에이션 방법론 ({sectors.length}개)
        </h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {sectors.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[13px] font-medium text-foreground">{s.label}</span>
              <span className="text-[11.5px] text-muted-foreground/70 shrink-0 text-right">{s.method}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/50 px-1 mt-2 leading-relaxed">
          AI가 종목 이름과 산업을 자동 감지해 해당 섹터의 전용 밸류에이션 프레임을 적용합니다.
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
