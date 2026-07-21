import React from 'react';
import { Bell, Search, Home, PieChart, TrendingUp, Briefcase, ChevronRight, ArrowUpRight, ArrowDownRight, Clock, CalendarDays } from 'lucide-react';

export function CleanLight() {
  return (
    <div className="w-[390px] min-h-[844px] bg-white font-sans text-slate-900 relative pb-20 shadow-2xl overflow-hidden mx-auto rounded-3xl border border-slate-200 ring-4 ring-slate-100/50">
      {/* Header */}
      <header className="px-5 pt-12 pb-4 sticky top-0 bg-white/80 backdrop-blur-xl z-20 border-b border-slate-100">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">애빛다</h1>
          </div>
          <div className="flex items-center gap-3">
            <button className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
              <Search size={20} />
            </button>
            <button className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors relative">
              <Bell size={20} />
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-indigo-500 rounded-full border-2 border-white"></span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-500">4월 26일 수요일</span>
            <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">장중</span>
          </div>
          <div className="flex bg-slate-100 p-0.5 rounded-lg">
            <button className="px-3 py-1 rounded-md bg-white text-slate-900 text-sm font-semibold shadow-sm">국내</button>
            <button className="px-3 py-1 rounded-md text-slate-500 text-sm font-medium hover:text-slate-700">해외</button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="px-5 py-6 space-y-8">
        
        {/* Market Brief Card */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-slate-400 tracking-wider uppercase">AI Market Brief</h2>
            <button className="text-xs font-medium text-indigo-500 flex items-center">전문 보기 <ChevronRight size={14} /></button>
          </div>
          
          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                <span className="text-indigo-600 text-xl font-bold">🐂</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">오늘의 시장은 <span className="text-indigo-600">상승세</span></h3>
                <p className="text-sm text-slate-500">외국인 매수세 유입, 반도체 주도</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">
              밤사이 미 증시 기술주 강세에 힘입어 국내 증시도 긍정적 흐름을 보이고 있습니다. 특히 AI 반도체 관련주들의 수급이 양호합니다.
            </p>
            <div className="flex gap-2">
              <span className="px-2.5 py-1 bg-white rounded-md border border-slate-200 text-xs font-medium text-slate-600 shadow-sm">#반도체</span>
              <span className="px-2.5 py-1 bg-white rounded-md border border-slate-200 text-xs font-medium text-slate-600 shadow-sm">#외국인순매수</span>
              <span className="px-2.5 py-1 bg-white rounded-md border border-slate-200 text-xs font-medium text-slate-600 shadow-sm">#환율안정</span>
            </div>
          </div>
        </section>

        {/* Indices */}
        <section>
          <h2 className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-3">Key Indices</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-red-50 rounded-full blur-2xl -mr-8 -mt-8 opacity-50"></div>
              <h4 className="text-sm font-medium text-slate-500 mb-1">코스피</h4>
              <div className="text-xl font-bold text-slate-900 mb-1">2,568.12</div>
              <div className="flex items-center text-red-500 text-sm font-semibold">
                <ArrowUpRight size={16} className="mr-0.5" />
                <span>+1.24%</span>
              </div>
            </div>
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-red-50 rounded-full blur-2xl -mr-8 -mt-8 opacity-50"></div>
              <h4 className="text-sm font-medium text-slate-500 mb-1">코스닥</h4>
              <div className="text-xl font-bold text-slate-900 mb-1">862.45</div>
              <div className="flex items-center text-red-500 text-sm font-semibold">
                <ArrowUpRight size={16} className="mr-0.5" />
                <span>+0.85%</span>
              </div>
            </div>
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-full blur-2xl -mr-8 -mt-8 opacity-50"></div>
              <h4 className="text-sm font-medium text-slate-500 mb-1">S&P 500</h4>
              <div className="text-xl font-bold text-slate-900 mb-1">5,078.65</div>
              <div className="flex items-center text-blue-500 text-sm font-semibold">
                <ArrowDownRight size={16} className="mr-0.5" />
                <span>-0.12%</span>
              </div>
            </div>
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-red-50 rounded-full blur-2xl -mr-8 -mt-8 opacity-50"></div>
              <h4 className="text-sm font-medium text-slate-500 mb-1">나스닥</h4>
              <div className="text-xl font-bold text-slate-900 mb-1">15,865.20</div>
              <div className="flex items-center text-red-500 text-sm font-semibold">
                <ArrowUpRight size={16} className="mr-0.5" />
                <span>+0.34%</span>
              </div>
            </div>
          </div>
        </section>

        {/* Sessions */}
        <section>
          <h2 className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-3">Daily Briefings</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 snap-x hide-scrollbar">
            
            <div className="snap-center shrink-0 w-40 bg-slate-50 border border-slate-100 rounded-2xl p-4 opacity-70">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={16} className="text-slate-400" />
                <span className="text-sm font-bold text-slate-500">장전</span>
              </div>
              <p className="text-sm font-medium text-slate-700 line-clamp-2">미 CPI 발표, 예상치 부합으로 시장 안도감 확산</p>
            </div>
            
            <div className="snap-center shrink-0 w-40 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 shadow-sm ring-1 ring-indigo-500/20">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                <span className="text-sm font-bold text-indigo-700">장중</span>
              </div>
              <p className="text-sm font-medium text-indigo-900 line-clamp-2">삼성전자 실적 호조에 반도체 섹터 일제히 강세</p>
            </div>
            
            <div className="snap-center shrink-0 w-40 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={16} className="text-slate-400" />
                <span className="text-sm font-bold text-slate-400">마감</span>
              </div>
              <p className="text-sm text-slate-400">15:30 발행 예정</p>
            </div>
            
            <div className="snap-center shrink-0 w-40 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={16} className="text-slate-400" />
                <span className="text-sm font-bold text-slate-400">야간</span>
              </div>
              <p className="text-sm text-slate-400">20:00 발행 예정</p>
            </div>

          </div>
        </section>

        {/* Upcoming Events */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-slate-400 tracking-wider uppercase">Upcoming Events</h2>
            <button className="text-xs font-medium text-indigo-500 flex items-center">더보기 <ChevronRight size={14} /></button>
          </div>
          
          <div className="bg-white border border-slate-100 rounded-2xl divide-y divide-slate-50 shadow-sm">
            <div className="p-4 flex gap-4 items-center">
              <div className="w-12 h-12 rounded-xl bg-red-50 flex flex-col items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-red-500 uppercase">Today</span>
                <span className="text-lg font-black text-red-600 leading-none">26</span>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-slate-900">현대차 1분기 실적발표</h4>
                <p className="text-xs text-slate-500 mt-0.5">시장 컨센서스 1.2조 상회 예상</p>
              </div>
            </div>
            <div className="p-4 flex gap-4 items-center">
              <div className="w-12 h-12 rounded-xl bg-slate-50 flex flex-col items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Tomorrow</span>
                <span className="text-lg font-black text-slate-600 leading-none">27</span>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-slate-900">미국 PCE 물가지수 발표</h4>
                <p className="text-xs text-slate-500 mt-0.5">금리 향방을 가를 주요 지표</p>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* Bottom Tab Bar */}
      <nav className="absolute bottom-0 w-full bg-white border-t border-slate-100 px-6 py-4 pb-8 flex justify-between items-center z-30">
        <button className="flex flex-col items-center gap-1.5 text-indigo-600">
          <Home size={22} strokeWidth={2.5} />
          <span className="text-[10px] font-bold">홈</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-slate-400 hover:text-slate-600 transition-colors">
          <PieChart size={22} strokeWidth={2} />
          <span className="text-[10px] font-medium">테마</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-slate-400 hover:text-slate-600 transition-colors">
          <TrendingUp size={22} strokeWidth={2} />
          <span className="text-[10px] font-medium">흐름</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-slate-400 hover:text-slate-600 transition-colors">
          <Briefcase size={22} strokeWidth={2} />
          <span className="text-[10px] font-medium">포트</span>
        </button>
      </nav>

      {/* Global styles for hiding scrollbar */}
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
