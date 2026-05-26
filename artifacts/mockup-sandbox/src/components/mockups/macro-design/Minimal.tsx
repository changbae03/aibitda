import { useState } from "react";

const MOCK_CATS = [
  {
    id: "markets", name: "글로벌 시장",
    items: [
      { id: "sp500",  name: "S&P 500",   flag: "🇺🇸", value: "7,508", chg: +0.46, unit: "pt" },
      { id: "nasdaq", name: "나스닥",     flag: "🇺🇸", value: "26,554", chg: +0.80, unit: "pt" },
      { id: "dow",    name: "다우존스",   flag: "🇺🇸", value: "50,451", chg: -0.25, unit: "pt" },
      { id: "nikkei", name: "닛케이 225", flag: "🇯🇵", value: "64,996", chg: -0.25, unit: "pt" },
      { id: "kospi",  name: "코스피",     flag: "🇰🇷", value: "8,048",  chg: +2.55, unit: "pt" },
      { id: "stoxx",  name: "Euro Stoxx", flag: "🇪🇺", value: "6,064",  chg: -1.18, unit: "pt" },
    ]
  },
  {
    id: "commodities", name: "원자재",
    items: [
      { id: "wti",   name: "WTI 원유", flag: "🛢️", value: "93.97",  chg: -2.72, unit: "$/bbl" },
      { id: "brent", name: "브렌트",   flag: "🛢️", value: "97.19",  chg: -3.01, unit: "$/bbl" },
      { id: "gold",  name: "금",       flag: "🥇", value: "4,506",  chg: -0.38, unit: "$/oz" },
      { id: "silver",name: "은",       flag: "🥈", value: "76.34",  chg: +0.19, unit: "$/oz" },
    ]
  },
];

const INSIGHTS = [
  { theme: "미 연준 금리 동결 기대", label: "긍정", labelColor: "#16a34a", desc: "연준의 금리 동결 시사로 채권 가격 상승 압력이 지속됩니다." },
  { theme: "유럽 경기 둔화 우려",   label: "부정", labelColor: "#dc2626", desc: "Euro Stoxx 약세와 독일 제조업 PMI 부진이 이를 반영합니다." },
  { theme: "원자재 복합 시그널",    label: "혼조", labelColor: "#d97706", desc: "유가 하락, 금 횡보로 인플레이션 기대가 혼재합니다." },
];

const TABS = ["전체", "글로벌 시장", "원자재", "AI 시사점"];

export function Minimal() {
  const [activeTab, setActiveTab] = useState("전체");
  const [openInsight, setOpenInsight] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 font-sans">
      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* 헤더 */}
        <div className="flex items-baseline justify-between mb-8">
          <div>
            <h2 className="text-xs font-semibold tracking-[0.18em] text-zinc-400 uppercase mb-1">
              Global Macro Dashboard
            </h2>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">
              글로벌 거시 대시보드
            </p>
          </div>
          <span className="text-xs text-zinc-400">오후 04:16 업데이트</span>
        </div>

        {/* AI 내러티브 — 심플 인용 스타일 */}
        <div className="border-l-2 border-zinc-200 dark:border-zinc-700 pl-4 mb-8">
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
            현재 글로벌 금융시장은 한국 증시의 독보적인 강세와 미국 기술주의 상승세 속에서
            지역별 차별화된 흐름을 보이고 있습니다. 국제 유가 하락 및 미 국채 금리 동반 하락은
            인플레이션 완화의 신호로 읽힙니다.
          </p>
        </div>

        {/* 카테고리 탭 — 텍스트 언더라인 스타일 */}
        <div className="flex gap-6 mb-6 border-b border-zinc-100 dark:border-zinc-800">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === t
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
            >
              {t}
              {activeTab === t && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 dark:bg-zinc-50 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* 시장 데이터 */}
        {activeTab !== "AI 시사점" && MOCK_CATS
          .filter(c => activeTab === "전체" || c.name === activeTab)
          .map(cat => (
          <div key={cat.id} className="mb-8">
            <p className="text-[11px] font-semibold text-zinc-400 tracking-widest uppercase mb-3">
              {cat.name}
            </p>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {cat.items.map(item => (
                <div key={item.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">{item.flag}</span>
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                      {item.value}
                      {item.unit !== "pt" && <span className="text-[10px] font-normal text-zinc-400 ml-1">{item.unit}</span>}
                    </span>
                    <span className={`text-sm font-mono w-16 text-right ${item.chg >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {item.chg >= 0 ? "+" : ""}{item.chg.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* AI 시사점 */}
        {(activeTab === "전체" || activeTab === "AI 시사점") && (
          <div className="mt-2">
            {activeTab === "전체" && (
              <p className="text-[11px] font-semibold text-zinc-400 tracking-widest uppercase mb-3">AI 시사점</p>
            )}
            <div className="space-y-px">
              {INSIGHTS.map((ins, i) => (
                <div key={i} className="border border-zinc-100 dark:border-zinc-800 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setOpenInsight(openInsight === i ? null : i)}
                    className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{ins.theme}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                        style={{ color: ins.labelColor, borderColor: ins.labelColor + "40", backgroundColor: ins.labelColor + "10" }}>
                        {ins.label}
                      </span>
                    </div>
                    <svg className={`w-4 h-4 text-zinc-300 transition-transform ${openInsight === i ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {openInsight === i && (
                    <div className="px-4 pb-4 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{ins.desc}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 레이블 */}
        <div className="mt-12 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-widest text-zinc-300 dark:text-zinc-600 uppercase">A — 미니멀 클린</span>
          <span className="text-[11px] text-zinc-300 dark:text-zinc-700">리스트형 · 보더 없는 카드 · 언더라인 탭</span>
        </div>
      </div>
    </div>
  );
}
