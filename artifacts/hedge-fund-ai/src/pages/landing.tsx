import { useSignIn, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { useAuth, getKakaoLoginUrl } from "@/lib/auth";
import { motion } from "framer-motion";
import { Clock, Globe, Zap, BarChart2 } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function KakaoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3C6.477 3 2 6.582 2 11.01c0 2.868 1.792 5.39 4.5 6.865L5.5 21.6a.5.5 0 0 0 .73.54l4.42-2.94c.44.06.89.09 1.35.09 5.523 0 10-3.582 10-8.01C22 6.582 17.523 3 12 3Z"
        fill="#3C1E1E"
      />
    </svg>
  );
}

export default function Landing() {
  const { isSignedIn, isLoaded } = useUser();
  const { signIn } = useSignIn();
  const [, setLocation] = useLocation();
  const { data: kakaoAuth, isLoading: kakaoLoading } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      localStorage.setItem("pending_referral", ref);
    }
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setLocation("/analysis/new");
      return;
    }
    if (!kakaoLoading && kakaoAuth?.user) {
      setLocation("/analysis/new");
    }
  }, [isLoaded, isSignedIn, kakaoLoading, kakaoAuth, setLocation]);

  const handleKakaoLogin = () => {
    window.location.href = getKakaoLoginUrl();
  };

  const handleGoogleLogin = async () => {
    if (!signIn) return;
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: `${basePath}/sign-in/sso-callback`,
        redirectUrlComplete: `${basePath}/analysis/new`,
      });
    } catch (err) {
      console.error("Google login error:", err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-12" style={{ fontFamily: "'Pretendard', sans-serif" }}>

      {/* 배경 텍스처 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#FF8A7A]/5 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full bg-[#FF8A7A]/5 blur-2xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm">

        {/* 로고 */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-10 text-center"
        >
          <h1 className="text-[42px] font-black tracking-tighter mb-2 leading-none" style={{ color: "#FF8A7A" }}>
            애빛다
          </h1>
          <p className="text-[14px] text-muted-foreground font-medium tracking-wide">AI로 기업가치를 밝히다</p>
        </motion.div>

        {/* 설명 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="mb-8 text-center"
        >
          <p className="text-[15px] text-foreground/75 leading-relaxed font-medium mb-4">
            산업 분석부터 기술적 분석, 적정주가 산출까지<br />
            7단계에 걸쳐 깊이 있게 분석합니다.
          </p>
          <div className="flex items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FF8A7A]/10 border border-[#FF8A7A]/20 text-[11.5px] font-bold text-[#FF8A7A]">
              <Clock className="w-3 h-3" />
              평균 3분 완성
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/80 border border-border text-[11.5px] font-medium text-muted-foreground">
              <Globe className="w-3 h-3" />
              한국·미국 주식
            </span>
          </div>
        </motion.div>

        {/* 로그인 버튼 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.14 }}
          className="space-y-3 mb-8"
        >
          <button
            onClick={handleKakaoLogin}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-bold text-[14.5px] transition-all hover:opacity-90 active:scale-[0.98] shadow-sm"
            style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
          >
            <KakaoIcon />
            카카오로 시작하기
          </button>
        </motion.div>

        {/* 특징 3가지 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="grid grid-cols-3 gap-2.5 mb-8"
        >
          {[
            { Icon: Globe,     label: "한국·미국", desc: "주식 분석" },
            { Icon: Zap,       label: "7단계 AI",  desc: "파이프라인", highlight: true },
            { Icon: BarChart2, label: "실시간",    desc: "주가·재무" },
          ].map(f => (
            <div
              key={f.label}
              className={`rounded-xl p-3 text-center border transition-colors ${
                f.highlight
                  ? "border-[#FF8A7A]/30 bg-[#FF8A7A]/6"
                  : "bg-muted/40 border-border"
              }`}
            >
              <f.Icon className={`w-4 h-4 mx-auto mb-1.5 ${f.highlight ? "text-[#FF8A7A]" : "text-muted-foreground/60"}`} />
              <div className={`text-[11.5px] font-bold ${f.highlight ? "text-[#FF8A7A]" : "text-foreground/90"}`}>{f.label}</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{f.desc}</div>
            </div>
          ))}
        </motion.div>

        <p className="text-center text-[11px] text-muted-foreground/45 leading-relaxed">
          로그인 시 <span className="underline cursor-pointer text-muted-foreground/70 hover:text-foreground transition-colors">이용약관</span> 및{" "}
          <span className="underline cursor-pointer text-muted-foreground/70 hover:text-foreground transition-colors">개인정보처리방침</span>에 동의하는 것으로 간주됩니다.
        </p>
      </div>
    </div>
  );
}
