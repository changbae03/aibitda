import React, { useState } from "react";
import {
  Home,
  LayoutGrid,
  Activity,
  Briefcase,
  Bell,
  Search,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Calendar,
  Clock,
} from "lucide-react";

export function PremiumDark() {
  const [marketTab, setMarketTab] = useState<"KR" | "US">("KR");

  return (
    <div className="w-[390px] min-h-[844px] bg-[#0d1117] text-[#c9d1d9] font-sans relative overflow-x-hidden flex flex-col mx-auto shadow-2xl">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#0d1117]/90 backdrop-blur-md border-b border-[#30363d] px-4 pt-12 pb-3">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">
              애빛다
            </h1>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#238636]/20 text-[#2ea043] border border-[#2ea043]/30">
              장중
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Search className="w-5 h-5 text-[#8b949e]" />
            <Bell className="w-5 h-5 text-[#8b949e]" />
          </div>
        </div>

        <div className="flex justify-between items-end">
          <div className="text-xs text-[#8b949e] font-mono tracking-wider">
            2026.04.29 (수) 14:30
          </div>
          <div className="flex bg-[#161b22] p-0.5 rounded-md border border-[#30363d]">
            <button
              onClick={() => setMarketTab("KR")}
              className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${
                marketTab === "KR"
                  ? "bg-[#21262d] text-white shadow-sm"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              국내
            </button>
            <button
              onClick={() => setMarketTab("US")}
              className={`px-3 py-1 text-xs font-semibold rounded-sm transition-colors ${
                marketTab === "US"
                  ? "bg-[#21262d] text-white shadow-sm"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              해외
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-4 space-y-6 hide-scrollbar">
        {/* Market Indices */}
        <section>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                name: "KOSPI",
                price: "2,684.52",
                change: "+12.40",
                pct: "+0.46%",
                isUp: true,
              },
              {
                name: "KOSDAQ",
                price: "862.15",
                change: "-3.20",
                pct: "-0.37%",
                isUp: false,
              },
              {
                name: "S&P 500",
                price: "5,123.41",
                change: "+28.10",
                pct: "+0.55%",
                isUp: true,
              },
              {
                name: "NASDAQ",
                price: "16,240.50",
                change: "+112.30",
                pct: "+0.69%",
                isUp: true,
              },
            ].map((idx, i) => (
              <div
                key={i}
                className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 flex flex-col justify-between"
              >
                <div className="text-xs text-[#8b949e] font-medium mb-1">
                  {idx.name}
                </div>
                <div className="text-lg font-mono font-bold text-white mb-1 tracking-tight">
                  {idx.price}
                </div>
                <div
                  className={`flex items-center text-xs font-mono font-semibold ${
                    idx.isUp ? "text-[#f59e0b]" : "text-[#58a6ff]"
                  }`}
                >
                  {idx.isUp ? (
                    <TrendingUp className="w-3 h-3 mr-1" />
                  ) : (
                    <TrendingDown className="w-3 h-3 mr-1" />
                  )}
                  {idx.pct} <span className="ml-1 opacity-70">({idx.change})</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* AI Market Brief Sentiment */}
        <section>
          <div className="bg-gradient-to-br from-[#161b22] to-[#0d1117] border border-[#30363d] rounded-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#f59e0b]/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/4"></div>
            <div className="p-4 relative z-10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#f59e0b] shadow-[0_0_8px_#f59e0b]"></span>
                  AI 마켓 브리프
                </h2>
                <div className="text-xs font-semibold text-[#f59e0b] bg-[#f59e0b]/10 px-2 py-1 rounded border border-[#f59e0b]/20">
                  Bullish (강세)
                </div>
              </div>
              <p className="text-sm text-[#c9d1d9] leading-relaxed mb-4">
                반도체 섹터의 실적 호조가 시장 상승을 주도하고 있습니다. 
                특히 AI 관련주의 수급이 집중되며 KOSPI 2,700선 돌파를 시도할 것으로 전망됩니다.
              </p>
              <div className="flex items-center justify-between border-t border-[#30363d] pt-3">
                <div className="flex gap-2">
                  <span className="text-[10px] px-2 py-1 bg-[#21262d] rounded text-[#8b949e]">#반도체</span>
                  <span className="text-[10px] px-2 py-1 bg-[#21262d] rounded text-[#8b949e]">#외인매수</span>
                </div>
                <button className="text-xs text-[#8b949e] flex items-center hover:text-white transition-colors">
                  상세보기 <ChevronRight className="w-3 h-3 ml-0.5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Session Cards */}
        <section>
          <h2 className="text-sm font-bold text-white mb-3">세션별 브리핑</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { title: "장전", time: "08:30", status: "완료", active: false, desc: "글로벌 증시 요약" },
              { title: "장중", time: "14:00", status: "업데이트", active: true, desc: "외국인 수급 동향" },
              { title: "마감", time: "16:00", status: "대기", active: false, desc: "오늘의 주도주" },
              { title: "야간", time: "22:00", status: "대기", active: false, desc: "미국장 프리뷰" },
            ].map((session, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg border ${
                  session.active
                    ? "bg-[#161b22] border-[#f59e0b]/50 shadow-[0_0_15px_rgba(245,158,11,0.05)]"
                    : "bg-[#0d1117] border-[#30363d] opacity-70"
                }`}
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-1.5">
                    <Clock className={`w-3 h-3 ${session.active ? "text-[#f59e0b]" : "text-[#8b949e]"}`} />
                    <span className={`text-xs font-bold ${session.active ? "text-[#f59e0b]" : "text-[#8b949e]"}`}>
                      {session.title}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[#8b949e]">{session.time}</span>
                </div>
                <div className={`text-xs ${session.active ? "text-white font-medium" : "text-[#8b949e]"}`}>
                  {session.desc}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Upcoming Events */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#8b949e]" />
              주요 일정
            </h2>
            <button className="text-xs text-[#8b949e] hover:text-white">더보기</button>
          </div>
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg divide-y divide-[#30363d]">
            {[
              { date: "오늘 21:30", title: "미국 1분기 GDP 발표", impact: "High" },
              { date: "오늘 05:00", title: "엔비디아 (NVDA) 실적발표", impact: "High" },
              { date: "내일", title: "한국은행 금융통화위원회", impact: "Medium" },
            ].map((event, i) => (
              <div key={i} className="p-3 flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-white font-medium">{event.title}</span>
                  <span className="text-[10px] font-mono text-[#8b949e]">{event.date}</span>
                </div>
                <div className={`text-[10px] font-bold px-2 py-1 rounded border ${
                  event.impact === "High" 
                    ? "bg-[#58a6ff]/10 text-[#58a6ff] border-[#58a6ff]/30" 
                    : "bg-[#8b949e]/10 text-[#8b949e] border-[#8b949e]/30"
                }`}>
                  {event.impact}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Bottom Tab Bar */}
      <nav className="absolute bottom-0 w-full bg-[#0d1117]/90 backdrop-blur-lg border-t border-[#30363d] pb-6 pt-2 px-6">
        <div className="flex justify-between items-center">
          {[
            { icon: Home, label: "홈", active: true },
            { icon: LayoutGrid, label: "테마", active: false },
            { icon: Activity, label: "흐름", active: false },
            { icon: Briefcase, label: "포트", active: false },
          ].map((tab, i) => {
            const Icon = tab.icon;
            return (
              <button
                key={i}
                className="flex flex-col items-center gap-1.5 min-w-[48px]"
              >
                <Icon
                  strokeWidth={tab.active ? 2.5 : 2}
                  className={`w-5 h-5 ${
                    tab.active ? "text-white" : "text-[#8b949e]"
                  }`}
                />
                <span
                  className={`text-[10px] font-medium ${
                    tab.active ? "text-white" : "text-[#8b949e]"
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <style dangerouslySetInnerHTML={{
        __html: `
          .hide-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .hide-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
        `
      }} />
    </div>
  );
}
