import React from "react";
import { motion } from "framer-motion";

export function GlowGrid() {
  const stocks = [
    { name: "삼성전자", ticker: "005930", summary: "HBM3E 공급 가시화 및 파운드리 실적 턴어라운드 기대", change: "+3.2%", isPositive: true },
    { name: "SK하이닉스", ticker: "000660", summary: "AI 반도체 수요 강세로 수익성 개선 지속 전망", change: "+1.5%", isPositive: true },
    { name: "NAVER", ticker: "035420", summary: "커머스/광고 매출 성장 둔화 우려 반영", change: "-0.8%", isPositive: false },
    { name: "NVIDIA", ticker: "NVDA", summary: "차세대 Blackwell 칩 수요 폭발적, 마진 확대", change: "+4.1%", isPositive: true },
    { name: "Apple", ticker: "AAPL", summary: "iPhone 판매량 회복 및 서비스 부문 호조", change: "+0.5%", isPositive: true },
  ];

  return (
    <div className="min-h-screen w-full flex flex-col lg:grid lg:grid-cols-2 font-sans">
      {/* Left Panel */}
      <div className="relative flex flex-col justify-between p-8 lg:p-16 h-full min-h-[100dvh] lg:min-h-screen border-b lg:border-b-0 lg:border-r" style={{ backgroundColor: "#0C0C0F", borderColor: "#FFFFFF0D" }}>
        {/* Top Left Logo */}
        <div className="flex items-center gap-1.5 z-10">
          <span className="text-white text-base font-semibold">애빛다</span>
          <div className="w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: "#FF8A7A" }} />
        </div>

        {/* Center Content */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto"
        >
          <h1 className="text-[64px] font-light text-white tracking-tight leading-none mb-3">안녕하세요</h1>
          <p className="text-[#A1A1AA] text-[18px] font-light mb-8">AI로 주식을 분석하세요</p>
          
          <button className="w-full max-w-xs h-12 rounded-md font-bold text-[#191919] flex items-center justify-center gap-2 mb-2 transition-opacity hover:opacity-90" style={{ backgroundColor: "#FEE500" }}>
            <span>🐻</span>
            카카오로 계속하기
          </button>
          
          <p className="text-[#71717A] text-[10px]">
            계속하면 이용약관에 동의합니다
          </p>
        </motion.div>

        {/* Bottom Left */}
        <div className="text-[#71717A] text-[10px] opacity-30 z-10">
          © 2026 애빛다
        </div>
      </div>

      {/* Right Panel */}
      <div className="relative p-8 lg:p-16 flex flex-col h-full min-h-[100dvh] lg:min-h-screen" style={{ backgroundColor: "#111116" }}>
        <div className="w-full max-w-lg mx-auto flex-1 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-6">
            <h2 className="text-white text-[20px] font-medium">오늘의 AI 분석</h2>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#FF8A7A" }} />
          </div>

          <div className="flex flex-col gap-2 mb-8">
            {stocks.map((stock, idx) => (
              <div key={idx} className="flex items-center rounded-lg px-4 py-3" style={{ backgroundColor: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
                <div className="w-16 flex-shrink-0">
                  <span className="font-mono text-[11px] text-[#A1A1AA]">{stock.ticker}</span>
                </div>
                
                <div className="flex-1 min-w-0 pr-4">
                  <div className="text-white text-[14px] leading-tight mb-0.5">{stock.name}</div>
                  <div className="text-[#A1A1AA] opacity-70 text-[12px] truncate">{stock.summary}</div>
                </div>

                <div className={`flex-shrink-0 text-[13px] font-medium ${stock.isPositive ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {stock.isPositive ? '▲' : '▼'} {stock.change.replace(/[+-]/, '')}
                </div>
              </div>
            ))}
          </div>

          <div className="text-[#71717A] text-[11px]">
            AI 분석은 투자 권유가 아닙니다
          </div>
        </div>
      </div>
      
    </div>
  );
}

export default GlowGrid;
