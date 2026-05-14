import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(false), 2000);
    const t2 = setTimeout(() => onDone(), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

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
          {/* 앱 아이콘 — 스프링감 있게 등장 */}
          <motion.div
            initial={{ scale: 0.78, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.34, 1.56, 0.64, 1] }}
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
            transition={{ delay: 0.35, duration: 0.45, ease: "easeOut" }}
            className="mt-5 text-[1.75rem] font-bold tracking-tight"
            style={{ color: "#FF8A7A" }}
          >
            애빛다
          </motion.p>

          {/* 슬로건 */}
          <motion.p
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 0.45, y: 0 }}
            transition={{ delay: 0.55, duration: 0.45, ease: "easeOut" }}
            className="mt-1.5 text-xs text-white tracking-wide"
          >
            AI로 기업가치를 밝히다
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
