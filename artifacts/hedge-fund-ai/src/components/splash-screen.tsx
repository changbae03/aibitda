import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const CHARS = ["애", "빛", "다"];
const CHAR_DELAY = 0.14; // 글자 간 간격(초)

function AnimatedChar({ char, index }: { char: string; index: number }) {
  return (
    <motion.span
      style={{ display: "inline-block", position: "relative" }}
      initial={{ opacity: 0, y: 10, scale: 1.15 }}
      animate={[
        // 1) 등장: 밝은 흰색으로 팡 나타남
        {
          opacity: 1,
          y: 0,
          scale: 1.08,
          color: "#ffffff",
          textShadow: "0 0 24px rgba(255,255,255,0.8)",
          transition: {
            delay: index * CHAR_DELAY,
            duration: 0.2,
            ease: "easeOut",
          },
        },
        // 2) 안착: 코랄 색으로 부드럽게 전환
        {
          scale: 1,
          color: "#FF8A7A",
          textShadow: "0 0 0px rgba(255,138,122,0)",
          transition: {
            delay: index * CHAR_DELAY + 0.2,
            duration: 0.45,
            ease: "easeInOut",
          },
        },
      ]}
    >
      {char}
    </motion.span>
  );
}

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(true);

  const totalAnimDuration = CHARS.length * CHAR_DELAY + 0.65; // 마지막 글자 안착까지

  useEffect(() => {
    // 전체 애니메이션 + 여운 시간 후 페이드아웃
    const holdMs = (totalAnimDuration + 0.5) * 1000;
    const t1 = setTimeout(() => setVisible(false), holdMs);
    const t2 = setTimeout(() => onDone(), holdMs + 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone, totalAnimDuration]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#111111]"
        >
          {/* 앱 아이콘 */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.34, 1.4, 0.64, 1] }}
          >
            <img
              src="/pwa-192x192.png"
              alt="애빛다"
              className="w-24 h-24 rounded-[28px] shadow-2xl"
            />
          </motion.div>

          {/* 글자 한 자씩 등장 */}
          <div
            className="mt-6 flex gap-0.5 text-[2rem] font-bold tracking-tight select-none"
            style={{ color: "#FF8A7A" }}
          >
            {CHARS.map((char, i) => (
              <AnimatedChar key={char} char={char} index={i} />
            ))}
          </div>

          {/* 슬로건 — 마지막 글자 이후 페이드인 */}
          <motion.p
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 0.4, y: 0 }}
            transition={{
              delay: CHARS.length * CHAR_DELAY + 0.3,
              duration: 0.5,
              ease: "easeOut",
            }}
            className="mt-2 text-xs text-white tracking-wide"
          >
            AI로 기업가치를 밝히다
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
