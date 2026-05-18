import { Link } from "wouter";
import { Home, Search, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { useLanguage } from "@/lib/language-context";

export default function NotFound() {
  const { isEn } = useLanguage();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="text-center max-w-sm w-full"
      >
        <div className="mb-6">
          <span
            className="text-[28px] font-black tracking-tighter"
            style={{ color: "#FF8A7A", fontFamily: "'Pretendard', sans-serif" }}
          >
            {isEn ? "AiBITDA" : "애빛다"}
          </span>
        </div>

        <div className="text-[72px] font-black text-foreground/8 leading-none mb-2 select-none">
          404
        </div>

        <h1 className="text-[20px] font-bold text-foreground mb-2">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="text-[13.5px] text-muted-foreground mb-8 leading-relaxed">
          주소가 잘못됐거나 삭제된 페이지입니다.<br />
          로그인이 필요한 페이지일 수도 있어요.
        </p>

        <div className="flex flex-col sm:flex-row gap-2.5 justify-center">
          <Link href="/">
            <button className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-foreground text-background text-[13.5px] font-semibold hover:bg-foreground/85 transition-colors">
              <Home className="w-4 h-4" />
              홈으로
            </button>
          </Link>
          <Link href="/analysis/new">
            <button className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-muted/50 text-foreground/80 text-[13.5px] font-medium hover:bg-accent transition-colors">
              <Search className="w-4 h-4" />
              AI 기업분석 시작
            </button>
          </Link>
        </div>

        <button
          onClick={() => window.history.back()}
          className="mt-5 flex items-center gap-1 text-[12px] text-muted-foreground/60 hover:text-muted-foreground transition-colors mx-auto"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          이전 페이지로
        </button>
      </motion.div>
    </div>
  );
}
