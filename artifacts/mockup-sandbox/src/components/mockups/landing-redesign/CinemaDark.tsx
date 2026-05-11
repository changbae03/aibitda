import React from 'react';
import { motion } from 'framer-motion';

export default function CinemaDark() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-[#0A0A0F] text-white selection:bg-[#FF8A7A]/30 font-sans">
      
      {/* Animated Background Glow */}
      <motion.div 
        animate={{ scale: [1, 1.1, 1], opacity: [0.08, 0.12, 0.08] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] md:w-[800px] h-[600px] md:h-[800px] rounded-full pointer-events-none blur-[100px] md:blur-[120px]"
        style={{ background: "radial-gradient(circle, #FF8A7A 0%, transparent 70%)" }}
      />
      
      {/* Subtle Dot Grid */}
      <div 
        className="absolute inset-0 opacity-[0.12] pointer-events-none" 
        style={{ 
          backgroundImage: "radial-gradient(circle at center, #ffffff 1px, transparent 1px)", 
          backgroundSize: "24px 24px",
          maskImage: "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)"
        }}
      />

      <motion.div 
        className="relative z-10 flex flex-col items-center w-full max-w-md px-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Badge */}
        <motion.div variants={itemVariants} className="mb-6">
          <span className="px-3 py-1 text-xs font-medium tracking-wide text-[#FF8A7A] uppercase bg-[#FF8A7A]/10 border border-[#FF8A7A]/20 rounded-full backdrop-blur-sm">
            AI 주식 리서치
          </span>
        </motion.div>

        {/* Title */}
        <motion.h1 variants={itemVariants} className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-center">
          애빛다 <span className="text-white/40 font-light mx-1">·</span> AiBITDA
        </motion.h1>

        {/* Description */}
        <motion.p variants={itemVariants} className="text-lg text-white/60 mb-8 text-center max-w-sm">
          AI가 분석하는 한국·미국 주식 인사이트
        </motion.p>

        {/* Stats Row */}
        <motion.div variants={itemVariants} className="flex items-center space-x-3 text-sm text-white/50 mb-12 font-medium">
          <span>18개 종목 커버</span>
          <span className="w-1 h-1 rounded-full bg-white/20" />
          <span>AI DCF 분석</span>
          <span className="w-1 h-1 rounded-full bg-white/20" />
          <span>실시간 리포트</span>
        </motion.div>

        {/* Login Card */}
        <motion.div variants={itemVariants} className="w-full">
          <div className="p-6 md:p-8 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md shadow-2xl flex flex-col items-center">
            
            <button className="w-full flex items-center justify-center gap-3 bg-[#FEE500] hover:bg-[#FEE500]/90 text-black/90 font-semibold py-3.5 px-4 rounded-xl transition-all duration-200 active:scale-[0.98]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M12 3C5.9 3 1 6.5 1 11.5C1 14.8 3.1 17.6 6.3 19.1L4.8 23.3C4.7 23.6 5 23.9 5.3 23.7L10.3 20.3C10.9 20.4 11.4 20.4 12 20.4C18.1 20.4 23 16.9 23 11.9C23 6.9 18.1 3 12 3Z" />
              </svg>
              <span>카카오로 계속하기</span>
            </button>

            <p className="mt-5 text-[11px] text-white/40 text-center leading-relaxed">
              계속 진행하면 <a href="#" className="underline underline-offset-2 hover:text-white/60">이용약관</a> 및 <a href="#" className="underline underline-offset-2 hover:text-white/60">개인정보처리방침</a>에 동의하게 됩니다.
            </p>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.footer variants={itemVariants} className="mt-16 text-xs text-white/30">
          © 2026 애빛다
        </motion.footer>

      </motion.div>
    </div>
  );
}
