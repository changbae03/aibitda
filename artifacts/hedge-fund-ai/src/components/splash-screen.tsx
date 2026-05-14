import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");

  useEffect(() => {
    // fade in 700ms → hold 900ms → fade out 600ms
    const t1 = setTimeout(() => setPhase("hold"), 700);
    const t2 = setTimeout(() => setPhase("out"), 1600);
    const t3 = setTimeout(() => onDone(), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <AnimatePresence>
      {phase !== "out" ? (
        <motion.div
          key="splash"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#111111]"
        >
          {/* 로고 아이콘 */}
          <motion.div
            initial={{ scale: 0.82, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.65, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <img
              src="/pwa-192x192.png"
              alt="애빛다"
              className="w-24 h-24 rounded-[28px] shadow-2xl"
            />
          </motion.div>

          {/* 앱 이름 */}
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
            className="mt-5 text-xl font-bold tracking-tight"
            style={{ color: "#FF8A7A" }}
          >
            애빛다
          </motion.p>

          {/* 슬로건 */}
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 0.45, y: 0 }}
            transition={{ delay: 0.5, duration: 0.5, ease: "easeOut" }}
            className="mt-1.5 text-xs text-white tracking-wide"
          >
            AI로 기업가치를 밝히다
          </motion.p>
        </motion.div>
      ) : (
        <motion.div
          key="splash-out"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: "easeInOut" }}
          className="fixed inset-0 z-[9999] bg-[#111111]"
        />
      )}
    </AnimatePresence>
  );
}
