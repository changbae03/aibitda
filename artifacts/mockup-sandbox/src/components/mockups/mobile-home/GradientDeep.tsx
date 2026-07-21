import React from "react";
import {
  Bell,
  Search,
  Menu,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Calendar,
  Clock,
  Home,
  PieChart,
  Activity,
  Briefcase,
  Play,
  CheckCircle2,
} from "lucide-react";

export function GradientDeep() {
  return (
    <div className="w-[390px] min-h-[844px] bg-[#0A0514] text-white relative overflow-hidden font-sans mx-auto shadow-2xl rounded-[40px] border-[8px] border-black my-8 scrollbar-hide">
      {/* Background Gradients */}
      <div className="absolute top-0 left-0 right-0 h-[400px] bg-gradient-to-b from-[#4A1D96] via-[#2A1054] to-[#0A0514] opacity-80 pointer-events-none" />
      <div className="absolute top-[-100px] left-[-50px] w-[300px] h-[300px] bg-[#7E22CE] rounded-full blur-[100px] opacity-40 pointer-events-none" />
      <div className="absolute top-[100px] right-[-50px] w-[200px] h-[200px] bg-[#EC4899] rounded-full blur-[80px] opacity-30 pointer-events-none" />

      {/* Header */}
      <header className="px-5 pt-12 pb-4 relative z-10 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
            애빛다
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Search size={22} className="text-white/80" />
          <div className="relative">
            <Bell size={22} className="text-white/80" />
            <span className="absolute top-0 right-0 w-2 h-2 bg-[#EC4899] rounded-full border-2 border-[#1E0B3B]"></span>
          </div>
        </div>
      </header>

      <div className="overflow-y-auto h-[calc(844px-160px)] pb-24 px-5 space-y-6 relative z-10 scrollbar-hide">
        {/* Date & Market Switcher */}
        <div className="flex justify-between items-end">
          <div>
            <div className="text-white/60 text-sm font-medium mb-1">
              4월 26일 (수)
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">국내증시</span>
              <span className="px-2 py-0.5 rounded bg-white/10 text-white/80 text-xs font-medium backdrop-blur-md border border-white/10">
                장중
              </span>
            </div>
          </div>
          <div className="flex p-1 bg-white/5 rounded-full backdrop-blur-md border border-white/5">
            <button className="px-4 py-1.5 rounded-full bg-white text-[#110826] text-sm font-bold shadow-lg">
              KR
            </button>
            <button className="px-4 py-1.5 rounded-full text-white/60 text-sm font-medium">
              US
            </button>
          </div>
        </div>

        {/* AI Sentiment Hero Card */}
        <div className="relative p-[1px] rounded-3xl overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-[#EC4899] to-[#7E22CE] opacity-50"></div>
          <div className="relative bg-[#1A0B33]/80 backdrop-blur-xl rounded-[23px] p-5 h-full border border-white/10 shadow-[0_8px_32px_rgba(126,34,206,0.3)]">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#EC4899] to-[#7E22CE] flex items-center justify-center shadow-lg">
                  <Activity size={16} className="text-white" />
                </div>
                <div>
                  <div className="text-xs text-white/60 font-medium">
                    AI 마켓 브리핑
                  </div>
                  <div className="font-bold text-[#F472B6]">상승 우위</div>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center backdrop-blur-md border border-white/10">
                <span className="text-lg">🐂</span>
              </div>
            </div>
            <h2 className="text-lg font-bold leading-snug mb-3">
              외인·기관 동반 매수세,<br />
              반도체 소부장 랠리 주도
            </h2>
            <p className="text-sm text-white/70 leading-relaxed mb-4">
              엔비디아 호실적 기대감에 HBM 관련주 중심의 강한 상승세가 나타나고
              있습니다. 저점 매수세가 유입되며 지수 하단을 지지하는 중입니다.
            </p>
            <button className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-sm font-semibold flex items-center justify-center gap-2 backdrop-blur-sm border border-white/10">
              <Play size={14} fill="currentColor" />
              AI 음성 브리핑 듣기
            </button>
          </div>
        </div>

        {/* Key Indices */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-bold">주요 지수</h3>
            <ChevronRight size={20} className="text-white/40" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                name: "코스피",
                value: "2,745.82",
                change: "+1.24%",
                up: true,
              },
              {
                name: "코스닥",
                value: "884.25",
                change: "+0.85%",
                up: true,
              },
              {
                name: "S&P 500",
                value: "5,078.65",
                change: "-0.22%",
                up: false,
              },
              {
                name: "나스닥",
                value: "15,906.17",
                change: "-0.41%",
                up: false,
              },
            ].map((idx, i) => (
              <div
                key={i}
                className="bg-white/5 backdrop-blur-md border border-white/5 rounded-2xl p-4 hover:bg-white/10 transition-colors"
              >
                <div className="text-white/60 text-xs font-medium mb-1">
                  {idx.name}
                </div>
                <div className="font-bold text-lg mb-1">{idx.value}</div>
                <div
                  className={`flex items-center gap-1 text-sm font-semibold ${
                    idx.up ? "text-[#10B981]" : "text-[#F43F5E]"
                  }`}
                >
                  {idx.up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {idx.change}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Session Cards */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-bold">세션별 전략</h3>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 -mx-5 px-5">
            {[
              {
                title: "장전",
                time: "08:00",
                desc: "전일 미 증시 요약",
                active: false,
                done: true,
              },
              {
                title: "장중",
                time: "11:30",
                desc: "수급 동향 체크",
                active: true,
                done: false,
              },
              {
                title: "마감",
                time: "15:30",
                desc: "종가 특징주 분석",
                active: false,
                done: false,
              },
              {
                title: "야간",
                time: "21:00",
                desc: "글로벌 매크로 전망",
                active: false,
                done: false,
              },
            ].map((session, i) => (
              <div
                key={i}
                className={`min-w-[140px] p-4 rounded-2xl border transition-all ${
                  session.active
                    ? "bg-gradient-to-br from-[#7E22CE]/40 to-[#4A1D96]/40 border-[#D8B4FE]/50 shadow-[0_0_15px_rgba(126,34,206,0.3)] backdrop-blur-md"
                    : "bg-white/5 border-white/5 backdrop-blur-sm"
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div
                    className={`text-sm font-bold ${
                      session.active ? "text-[#E9D5FF]" : "text-white/80"
                    }`}
                  >
                    {session.title}
                  </div>
                  {session.done ? (
                    <CheckCircle2 size={16} className="text-[#10B981]" />
                  ) : session.active ? (
                    <div className="w-2 h-2 rounded-full bg-[#E9D5FF] animate-pulse mt-1" />
                  ) : (
                    <Clock size={16} className="text-white/30" />
                  )}
                </div>
                <div className="text-2xl font-bold mb-1">{session.time}</div>
                <div className="text-xs text-white/50">{session.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Events */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-bold">주요 일정</h3>
            <span className="text-[#D8B4FE] text-sm font-medium">더보기</span>
          </div>
          <div className="bg-white/5 backdrop-blur-md border border-white/5 rounded-2xl p-4 space-y-4">
            <div className="flex gap-4 items-center">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex flex-col items-center justify-center border border-white/10 shrink-0">
                <span className="text-[10px] text-white/50 font-medium">오늘</span>
                <span className="font-bold text-lg">26</span>
              </div>
              <div>
                <div className="font-bold text-sm mb-1">
                  SK하이닉스 1분기 실적발표
                </div>
                <div className="flex gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/70">
                    실적
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#7E22CE]/30 text-[#D8B4FE]">
                    중요
                  </span>
                </div>
              </div>
            </div>
            <div className="h-[1px] bg-white/10"></div>
            <div className="flex gap-4 items-center">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex flex-col items-center justify-center border border-white/10 shrink-0">
                <span className="text-[10px] text-white/50 font-medium">내일</span>
                <span className="font-bold text-lg text-white/70">27</span>
              </div>
              <div>
                <div className="font-bold text-sm text-white/80 mb-1">
                  미국 1분기 GDP (예비치)
                </div>
                <div className="flex gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/70">
                    매크로
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Tab Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-[#0A0514]/80 backdrop-blur-xl border-t border-white/10 flex justify-around items-center px-6 pb-4 pt-2 z-20">
        <button className="flex flex-col items-center gap-1">
          <Home size={24} className="text-white" />
          <span className="text-[10px] font-medium text-white">홈</span>
        </button>
        <button className="flex flex-col items-center gap-1">
          <PieChart size={24} className="text-white/40" />
          <span className="text-[10px] font-medium text-white/40">테마</span>
        </button>
        <button className="flex flex-col items-center gap-1">
          <Activity size={24} className="text-white/40" />
          <span className="text-[10px] font-medium text-white/40">흐름</span>
        </button>
        <button className="flex flex-col items-center gap-1">
          <Briefcase size={24} className="text-white/40" />
          <span className="text-[10px] font-medium text-white/40">포트</span>
        </button>
      </div>
    </div>
  );
}
