import { useState, useRef } from "react";

const mock = {
  ticker: "018290",
  companyName: "에이피알",
  verdict: "BUY",
  targetPrice: 477800,
  currentPrice: 404000,
  upside: 18.3,
  entryMin: 380000,
  entryMax: 402000,
  stopLoss: 370000,
  rrRatio: 4.18,
  bear: 311900,
  base: 477800,
  bull: 548900,
  dcf: 548900,
  peer: 311900,
  catalysts: [
    "북미·유럽 오프라인 채널 가속 확장",
    "메디컬 뷰티 디바이스 신제품 출시",
    "2026E 매출 2.86조원 (+87%)",
  ],
  risks: [
    "글로벌 경기 침체 → 소비 심리 위축",
    "경쟁사 대비 밸류에이션 프리미엄 부담",
    "환율 변동 (달러·유로 약세)",
  ],
  eps26: 15279,
  rev26: 28600,
  op26: 7150,
};

const CARDS = [
  {
    id: "verdict",
    label: "투자 의견",
    icon: "🎯",
    accent: "#FF8A7A",
    render: () => (
      <div className="flex flex-col h-full justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50 uppercase tracking-widest">Investment Verdict</span>
        </div>
        <div>
          <div
            className="text-4xl font-black mb-1"
            style={{ color: "#FF8A7A" }}
          >
            {mock.verdict}
          </div>
          <div className="text-2xl font-bold text-white">
            ₩{mock.targetPrice.toLocaleString()}
          </div>
          <div className="text-sm mt-1" style={{ color: "#FF8A7A" }}>
            +{mock.upside}% 상승여력
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg p-2" style={{ background: "rgba(255,138,122,0.08)" }}>
            <div className="text-white/40">진입 구간</div>
            <div className="text-white font-semibold">₩{mock.entryMin.toLocaleString()}~</div>
          </div>
          <div className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className="text-white/40">손절선</div>
            <div className="text-white font-semibold">₩{mock.stopLoss.toLocaleString()}</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "valuation",
    label: "밸류에이션",
    icon: "💰",
    accent: "#7AB8FF",
    render: () => {
      const range = mock.bull - mock.bear;
      const currentPct = ((mock.currentPrice - mock.bear) / range) * 100;
      const basePct = ((mock.base - mock.bear) / range) * 100;
      return (
        <div className="flex flex-col h-full justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50 uppercase tracking-widest">Valuation Band</span>
          </div>
          <div>
            <div className="text-2xl font-bold text-white mb-1">
              ₩{mock.base.toLocaleString()}
            </div>
            <div className="text-sm text-white/50 mb-3">12개월 목표주가 (DCF 70%+피어 30%)</div>
            <div className="relative h-2 rounded-full mb-2" style={{ background: "rgba(255,255,255,0.1)" }}>
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: "100%", background: "linear-gradient(90deg,#FF6B6B,#FF8A7A,#7AB8FF)" }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-white" style={{ left: `${currentPct}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ left: `${basePct}%`, background: "#7AB8FF", border: "2px solid white" }} />
            </div>
            <div className="flex justify-between text-xs text-white/40">
              <span>Bear ₩{(mock.bear / 10000).toFixed(1)}만</span>
              <span>Base ₩{(mock.base / 10000).toFixed(1)}만</span>
              <span>Bull ₩{(mock.bull / 10000).toFixed(1)}만</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 text-xs">
            {[["DCF", mock.dcf], ["현재가", mock.currentPrice], ["피어", mock.peer]].map(([label, val]) => (
              <div key={label as string} className="rounded-lg p-2 text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div className="text-white/40">{label}</div>
                <div className="text-white font-semibold">₩{(Number(val) / 10000).toFixed(0)}만</div>
              </div>
            ))}
          </div>
        </div>
      );
    },
  },
  {
    id: "catalyst",
    label: "핵심 촉매",
    icon: "🚀",
    accent: "#7AE8B4",
    render: () => (
      <div className="flex flex-col h-full justify-between">
        <div>
          <span className="text-xs text-white/50 uppercase tracking-widest">Key Catalysts</span>
        </div>
        <div className="flex flex-col gap-2 flex-1 justify-center">
          {mock.catalysts.map((c, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl p-3" style={{ background: "rgba(122,232,180,0.07)" }}>
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: "rgba(122,232,180,0.2)", color: "#7AE8B4" }}>{i + 1}</div>
              <span className="text-sm text-white/90 leading-snug">{c}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-white/30 mt-2">catalyst_analysis 기반</div>
      </div>
    ),
  },
  {
    id: "risk",
    label: "주요 리스크",
    icon: "⚠️",
    accent: "#FFB87A",
    render: () => (
      <div className="flex flex-col h-full justify-between">
        <div>
          <span className="text-xs text-white/50 uppercase tracking-widest">Key Risks</span>
        </div>
        <div className="flex flex-col gap-2 flex-1 justify-center">
          {mock.risks.map((r, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl p-3" style={{ background: "rgba(255,184,122,0.07)" }}>
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: "rgba(255,184,122,0.2)", color: "#FFB87A" }}>!</div>
              <span className="text-sm text-white/90 leading-snug">{r}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-white/30 mt-2">investment_strategy 기반</div>
      </div>
    ),
  },
  {
    id: "earnings",
    label: "실적 전망",
    icon: "📈",
    accent: "#C87AFF",
    render: () => (
      <div className="flex flex-col h-full justify-between">
        <div>
          <span className="text-xs text-white/50 uppercase tracking-widest">2026E Forecasts</span>
        </div>
        <div className="flex flex-col gap-3 flex-1 justify-center">
          {[
            { label: "매출", value: `${(mock.rev26 / 10000).toFixed(2)}조원`, change: "+86.9%", color: "#C87AFF" },
            { label: "영업이익", value: `${(mock.op26 / 10000).toFixed(2)}조원`, change: "+72.3%", color: "#7AB8FF" },
            { label: "EPS", value: `₩${mock.eps26.toLocaleString()}`, change: "+12.4%", color: "#7AE8B4" },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
              <span className="text-sm text-white/60">{item.label}</span>
              <div className="text-right">
                <div className="text-sm font-bold text-white">{item.value}</div>
                <div className="text-xs" style={{ color: item.color }}>{item.change} YoY</div>
              </div>
            </div>
          ))}
        </div>
        <div className="text-xs text-white/30 mt-2">company_analysis 기반</div>
      </div>
    ),
  },
];

export function VariantA() {
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollTo = (idx: number) => {
    setActiveIdx(idx);
    scrollRef.current?.children[idx]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#0f0f0f", fontFamily: "'Pretendard', 'Inter', sans-serif" }}>
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-lg">{mock.companyName}</span>
              <span className="text-white/30 text-sm">{mock.ticker}</span>
            </div>
            <div className="text-white/40 text-xs mt-0.5">AI 분석 요약 · 5개 핵심 카드</div>
          </div>
          <div className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "rgba(255,138,122,0.15)", color: "#FF8A7A", border: "1px solid rgba(255,138,122,0.3)" }}>
            {mock.verdict}
          </div>
        </div>

        {/* Scrollable cards */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-3"
          style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none", msOverflowStyle: "none" }}
          onScroll={(e) => {
            const el = e.currentTarget;
            const idx = Math.round(el.scrollLeft / (el.scrollWidth / CARDS.length));
            setActiveIdx(idx);
          }}
        >
          {CARDS.map((card, i) => (
            <div
              key={card.id}
              className="flex-shrink-0 rounded-2xl p-4"
              style={{
                width: "260px",
                height: "240px",
                scrollSnapAlign: "center",
                background: i === activeIdx
                  ? `linear-gradient(135deg, rgba(${card.accent === "#FF8A7A" ? "255,138,122" : card.accent === "#7AB8FF" ? "122,184,255" : card.accent === "#7AE8B4" ? "122,232,180" : card.accent === "#FFB87A" ? "255,184,122" : "200,122,255"},0.12) 0%, rgba(255,255,255,0.03) 100%)`
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${i === activeIdx ? card.accent + "33" : "rgba(255,255,255,0.06)"}`,
                transition: "all 0.3s ease",
                cursor: "pointer",
              }}
              onClick={() => scrollTo(i)}
            >
              {card.render()}
            </div>
          ))}
        </div>

        {/* Dots */}
        <div className="flex justify-center gap-1.5 mt-3">
          {CARDS.map((card, i) => (
            <button
              key={i}
              onClick={() => scrollTo(i)}
              className="rounded-full transition-all"
              style={{
                width: i === activeIdx ? "20px" : "6px",
                height: "6px",
                background: i === activeIdx ? "#FF8A7A" : "rgba(255,255,255,0.2)",
              }}
            />
          ))}
        </div>

        {/* Tab labels */}
        <div className="flex gap-2 mt-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {CARDS.map((card, i) => (
            <button
              key={i}
              onClick={() => scrollTo(i)}
              className="flex-shrink-0 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-all"
              style={{
                background: i === activeIdx ? "rgba(255,138,122,0.15)" : "rgba(255,255,255,0.05)",
                color: i === activeIdx ? "#FF8A7A" : "rgba(255,255,255,0.4)",
                border: `1px solid ${i === activeIdx ? "rgba(255,138,122,0.3)" : "transparent"}`,
              }}
            >
              <span>{card.icon}</span>
              <span>{card.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 text-center text-white/20 text-xs">
          Variant A — 수평 스와이프 (항상 상단 노출)
        </div>
      </div>
    </div>
  );
}
