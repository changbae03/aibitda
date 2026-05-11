import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, ArrowRight, Sparkles, TrendingUp, ShieldAlert, LineChart, Bell } from "lucide-react";

export function GlowGrid() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    { name: "재무 데이터 수집", desc: "10년치 재무제표 및 컨센서스 취합", icon: TrendingUp },
    { name: "AI 기업 분석", desc: "사업모델, 경쟁우위, 해자 평가", icon: MessageSquare },
    { name: "DCF 밸류에이션", desc: "미래 현금흐름 추정 및 적정주가 산출", icon: LineChart },
    { name: "리스크 평가", desc: "거시경제 및 산업별 위험 요소 분석", icon: ShieldAlert },
    { name: "기술적 분석", desc: "수급 및 차트 패턴 AI 판독", icon: ArrowRight },
    { name: "종합 인사이트 생성", desc: "투자의견 및 액션 플랜 도출", icon: Sparkles },
    { name: "실시간 알림", desc: "목표가 도달 및 주요 이슈 푸시", icon: Bell },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="min-h-screen w-full flex flex-col lg:grid lg:grid-cols-2 overflow-hidden bg-[#0D0D14] text-white font-sans selection:bg-[#FF8A7A] selection:text-white">
      {/* Left Panel - Login */}
      <motion.div 
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex flex-col justify-between p-8 lg:p-16 h-full z-10"
      >
        {/* Glowing Grid Background */}
        <div 
          className="absolute inset-0 pointer-events-none z-[-1]"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
            maskImage: 'linear-gradient(to right, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%)'
          }}
        />
        
        {/* Soft Radial Glow */}
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none z-[-1]"
          style={{
            background: 'radial-gradient(circle, rgba(255,138,122,0.06) 0%, rgba(13,13,20,0) 70%)'
          }}
        />

        <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full pt-20 pb-10">
          <div className="mb-12">
            <h1 className="text-5xl font-bold tracking-tight mb-1">애빛다</h1>
            <p className="text-[#FF8A7A] italic text-lg font-medium tracking-wider">AiBITDA</p>
          </div>

          <div className="flex gap-3 mb-12 flex-wrap">
            <span className="px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 bg-white/5 backdrop-blur-sm shadow-sm">🇰🇷 국내주식</span>
            <span className="px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 bg-white/5 backdrop-blur-sm shadow-sm">🇺🇸 미국주식</span>
            <span className="px-3 py-1.5 rounded-full text-xs font-medium border border-[#FF8A7A]/20 bg-[#FF8A7A]/10 text-[#FF8A7A] shadow-[0_0_10px_rgba(255,138,122,0.1)]">✨ AI분석</span>
          </div>

          <div className="space-y-6">
            <p className="text-gray-400 text-sm">AI 주식 리서치 플랫폼에 오신 것을 환영합니다</p>
            
            <button className="w-full bg-[#FEE500] hover:bg-[#E5CD00] text-[#191919] font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-3 transition-colors duration-200 shadow-[0_4px_14px_rgba(254,229,0,0.15)] active:scale-[0.98]">
              <span className="text-xl">🐻</span>
              <span>카카오로 시작하기</span>
            </button>
            
            <p className="text-[#666670] text-xs text-center">
              로그인하면 이용약관 및 개인정보처리방침에 동의합니다
            </p>
          </div>
        </div>

        <div className="text-[#666670] text-sm text-center lg:text-left mt-auto">
          © 2026 애빛다 · Powered by Gemini
        </div>
      </motion.div>

      {/* Right Panel - Pipeline Showcase */}
      <div className="relative bg-[#111118] h-full p-8 lg:p-16 flex flex-col justify-center border-l border-white/5">
        
        {/* Subtle ambient light from right */}
        <div 
          className="absolute top-0 right-0 w-[500px] h-full pointer-events-none z-[-1]"
          style={{
            background: 'linear-gradient(to left, rgba(255,138,122,0.02) 0%, rgba(17,17,24,0) 100%)'
          }}
        />

        <div className="max-w-xl mx-auto w-full">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mb-12"
          >
            <h2 className="text-3xl font-bold text-white mb-2">AI가 만드는 투자 인사이트</h2>
            <p className="text-gray-400 text-sm">복잡한 데이터 분석부터 가치 평가까지, 애빛다가 대신합니다.</p>
          </motion.div>

          <div className="relative">
            {/* Connecting Line */}
            <div className="absolute left-[19px] top-4 bottom-4 w-px bg-white/5 z-0" />
            
            {/* Active Line Fill */}
            <motion.div 
              className="absolute left-[19px] top-4 w-px bg-gradient-to-b from-[#FF8A7A] to-transparent z-0"
              initial={{ height: 0 }}
              animate={{ height: `${(activeStep / (steps.length - 1)) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            />

            <div className="space-y-6 relative z-10">
              {steps.map((step, idx) => {
                const isActive = idx === activeStep;
                const isPast = idx < activeStep;
                const Icon = step.icon;
                
                return (
                  <motion.div 
                    key={idx}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 + idx * 0.1 }}
                    className="flex gap-6 items-start group"
                  >
                    <div className="relative flex-shrink-0 mt-1">
                      {isActive && (
                        <motion.div 
                          className="absolute inset-0 bg-[#FF8A7A] rounded-full blur-md"
                          animate={{ 
                            opacity: [0.4, 0.8, 0.4],
                            scale: [1, 1.2, 1]
                          }}
                          transition={{ 
                            duration: 2,
                            repeat: Infinity,
                            ease: "easeInOut"
                          }}
                        />
                      )}
                      <div 
                        className={`w-[38px] h-[38px] rounded-full flex items-center justify-center relative z-10 transition-all duration-300 border ${
                          isActive 
                            ? 'bg-gradient-to-br from-[#FF8A7A] to-[#ff6b57] border-[#FF8A7A]/50 text-white shadow-[0_0_15px_rgba(255,138,122,0.4)]' 
                            : isPast
                              ? 'bg-white/10 border-white/20 text-white'
                              : 'bg-[#1A1A24] border-white/5 text-gray-500'
                        }`}
                      >
                        <Icon size={16} strokeWidth={isActive || isPast ? 2.5 : 2} />
                      </div>
                    </div>
                    
                    <div className={`transition-all duration-300 ${
                      isActive ? 'opacity-100 transform translate-x-2' : isPast ? 'opacity-80' : 'opacity-40'
                    }`}>
                      <h3 className={`text-base font-semibold mb-1 ${isActive ? 'text-white' : 'text-gray-300'}`}>
                        {step.name}
                      </h3>
                      <p className={`text-sm ${isActive ? 'text-[#FF8A7A]' : 'text-gray-500'}`}>
                        {step.desc}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GlowGrid;
