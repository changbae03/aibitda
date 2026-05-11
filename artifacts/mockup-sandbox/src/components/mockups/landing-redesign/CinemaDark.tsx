import React from "react";
import { motion } from "framer-motion";

export function CinemaDark() {
  return (
    <div 
      className="min-h-[100dvh] w-full flex items-center justify-center font-['Inter',system-ui,sans-serif] relative overflow-hidden"
      style={{ backgroundColor: "#0C0C0F", color: "#FFFFFF" }}
    >
      {/* Background static horizontal rules for subtle texture */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between py-32 opacity-[0.03]">
        <div className="w-full h-[1px] bg-white"></div>
        <div className="w-full h-[1px] bg-white"></div>
        <div className="w-full h-[1px] bg-white"></div>
      </div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-[320px] px-6 sm:px-0 flex flex-col items-center text-center z-10"
      >
        {/* 1. Small uppercase label */}
        <p 
          className="text-[12px] uppercase tracking-[0.2em] font-mono mb-6"
          style={{ color: "#FF8A7A" }}
        >
          AI 주식 리서치
        </p>

        {/* 2. Large app name */}
        <div className="mb-8 w-full flex flex-col items-center">
          <h1 className="text-[clamp(56px,12vw,80px)] font-[600] leading-none tracking-tight mb-2">
            애빛다
          </h1>
          <p className="text-[18px] text-gray-500 italic font-[300]">
            AiBITDA
          </p>
        </div>

        {/* 3. Thin horizontal divider line */}
        <div className="w-full h-[1px] bg-white/10 mb-8" />

        {/* 4. One sentence in muted gray */}
        <p className="text-gray-400 font-[300] text-[15px] mb-4">
          한국·미국 주식을 AI가 분석합니다
        </p>

        {/* 5. 3 stats inline */}
        <div className="flex items-center justify-center gap-2 text-[13px] text-gray-500 font-[300] mb-12">
          <span>18개 종목</span>
          <span>·</span>
          <span>DCF 분석</span>
          <span>·</span>
          <span>실시간 알림</span>
        </div>

        {/* 6. Kakao login button */}
        <button 
          className="w-full h-[48px] rounded-md font-[700] text-[15px] flex items-center justify-center relative transition-opacity hover:opacity-90 mb-6"
          style={{ backgroundColor: "#FEE500", color: "#000000" }}
        >
          <span className="absolute left-4 text-[18px]">🐻</span>
          카카오로 시작하기
        </button>

        {/* 7. Very small muted text */}
        <p className="text-[11px] text-gray-400 opacity-40 font-[300]">
          로그인 시 이용약관에 동의합니다
        </p>
      </motion.div>
    </div>
  );
}

export default CinemaDark;
