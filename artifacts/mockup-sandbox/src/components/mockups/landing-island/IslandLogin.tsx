import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function IslandLogin() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center relative overflow-hidden" style={{ backgroundColor: "#080808" }}>
      {/* Island Container */}
      <div className="absolute top-[15vh] w-full flex justify-center z-10">
        <motion.div
          layout
          layoutId="island"
          initial={false}
          onClick={() => !isOpen && setIsOpen(true)}
          whileTap={!isOpen ? { scale: 0.98 } : undefined}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          style={{
            backgroundColor: "#141414",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.6)",
            width: isOpen ? 360 : 220,
            height: isOpen ? 220 : 44,
            borderRadius: isOpen ? 28 : 22,
            cursor: isOpen ? "default" : "pointer",
            overflow: "hidden",
            position: "relative"
          }}
        >
          <AnimatePresence mode="wait">
            {!isOpen ? (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 flex items-center justify-center gap-2"
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#FF8A7A" }} />
                <span className="text-white text-sm font-medium tracking-wide">애빛다</span>
              </motion.div>
            ) : (
              <motion.div
                key="open"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="absolute inset-0 p-5 flex flex-col"
              >
                {/* Header */}
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-white/60">애빛다 ·</span>
                    <span className="italic font-medium" style={{ color: "#FF8A7A" }}>AiBITDA</span>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsOpen(false);
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-white/40 hover:text-white/80"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 1L11 11M1 11L11 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
                
                {/* Divider */}
                <div className="w-full h-px mb-6" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
                
                {/* Content */}
                <div className="flex-1 flex flex-col items-center">
                  <h2 className="text-white text-2xl font-light mb-auto">환영합니다</h2>
                  
                  <button className="w-full h-10 rounded-lg flex items-center justify-center font-bold text-sm mb-2 transition-opacity hover:opacity-90 active:scale-[0.98]" style={{ backgroundColor: "#FEE500", color: "#191919" }}>
                    <span className="mr-1.5 text-base">🐻</span> 카카오로 시작하기
                  </button>
                  
                  <p className="text-[10px] text-white/40">계속하면 약관에 동의합니다</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Faint Status Line */}
      <div className="absolute bottom-[20vh] w-full flex justify-center pointer-events-none">
        <motion.div
          animate={{ opacity: [0.3, 0.15, 0.3] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="text-xs tracking-widest text-white"
        >
          AI 주식 리서치 플랫폼
        </motion.div>
      </div>
    </div>
  );
}

export default IslandLogin;
