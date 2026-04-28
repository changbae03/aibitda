import { useSignIn, useUser } from "@clerk/react";
import { useLocation, Link } from "wouter";
import { useEffect } from "react";
import { useAuth, getKakaoLoginUrl } from "@/lib/auth";
import { motion } from "framer-motion";
import { Clock, Globe, ShieldCheck, Globe2, PieChart, BarChart2, Zap, Scale } from "lucide-react";

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

const STEPS = [
  { num: 1, name: "브리핑",                icon: ShieldCheck, desc: "종목 개요 & 분석 방향 설정" },
  { num: 2, name: "매크로·산업 분석",       icon: Globe2,      desc: "산업 구조, 성장률, 경쟁 구도" },
  { num: 3, name: "투자 촉매·수급 분석",    icon: Zap,         desc: "주가 촉매, 세력 움직임" },
  { num: 4, name: "실적 전망",              icon: PieChart,    desc: "재무 분석 + Base 실적 추정" },
  { num: 5, name: "적정주가 산출",          icon: Scale,       desc: "DCF + 피어 멀티플 → 목표주가" },
  { num: 6, name: "기술적 분석",            icon: BarChart2,   desc: "차트, 진입 구간, 손절 전략" },
  { num: 7, name: "최종 결론",              icon: ShieldCheck, desc: "통합 검토 → 최종 투자 전략" },
];

export default function Landing() {
  const { isSignedIn, isLoaded } = useUser();
  const { signIn } = useSignIn();
  const [, setLocation] = useLocation();
  const { data: kakaoAuth, isLoading: kakaoLoading } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) localStorage.setItem("pending_referral", ref);
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) { setLocation("/analysis/new"); return; }
    if (!kakaoLoading && kakaoAuth?.user) setLocation("/analysis/new");
  }, [isLoaded, isSignedIn, kakaoLoading, kakaoAuth, setLocation]);

  const handleKakaoLogin = () => { window.location.href = getKakaoLoginUrl(); };

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
    <div
      className="min-h-screen flex items-center justify-center bg-background px-6 py-12"
      style={{ fontFamily: "'Pretendard', sans-serif" }}
    >
      {/* 배경 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#FF8A7A]/5 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full bg-[#FF8A7A]/5 blur-2xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#FF8A7A]/3 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-4xl flex flex-col lg:flex-row items-center lg:items-start gap-12 lg:gap-16">

        {/* ── 왼쪽: 로그인 카드 ── */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45 }}
          className="w-full max-w-sm flex-shrink-0"
        >
          {/* 로고 */}
          <div className="mb-8 text-center lg:text-left">
            <h1 className="text-[44px] font-black tracking-tighter mb-1.5 leading-none" style={{ color: "#FF8A7A" }}>
              애빛다
            </h1>
            <p className="text-[14px] text-muted-foreground font-medium tracking-wide">AI로 기업가치를 밝히다</p>
          </div>

          {/* 설명 */}
          <div className="mb-6 text-center lg:text-left">
            <p className="text-[15px] text-foreground/75 leading-relaxed font-medium mb-4">
              코스피·코스닥·미국 주식을<br />
              7단계 AI 파이프라인으로 깊이 분석합니다.
            </p>
            <div className="flex items-center justify-center lg:justify-start gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FF8A7A]/10 border border-[#FF8A7A]/20 text-[11.5px] font-bold text-[#FF8A7A]">
                <Clock className="w-3 h-3" />
                평균 3분 완성
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/80 border border-border text-[11.5px] font-medium text-muted-foreground">
                <Globe className="w-3 h-3" />
                한국·미국 주식
              </span>
            </div>
          </div>

          {/* 로그인 버튼 */}
          <div className="space-y-3 mb-6">
            <button
              onClick={handleKakaoLogin}
              className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-bold text-[14.5px] transition-all hover:opacity-90 active:scale-[0.98] shadow-sm"
              style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
            >
              <KakaoIcon />
              카카오로 시작하기
            </button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground/45 leading-relaxed">
            로그인 시{" "}
            <Link href="/terms" className="underline text-muted-foreground/70 hover:text-foreground transition-colors">이용약관</Link>{" "}
            및{" "}
            <Link href="/privacy" className="underline text-muted-foreground/70 hover:text-foreground transition-colors">개인정보처리방침</Link>
            에 동의하는 것으로 간주됩니다.
          </p>
        </motion.div>

        {/* ── 오른쪽: 7단계 파이프라인 ── */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="w-full lg:pt-2"
        >
          <div className="mb-5">
            <p className="text-[12px] font-bold text-[#FF8A7A] tracking-widest uppercase mb-1">AI 분석 파이프라인</p>
            <h2 className="text-[20px] font-black text-foreground tracking-tight">7단계 심층 리서치</h2>
          </div>

          <div className="relative">
            {/* 연결선 */}
            <div
              className="absolute left-[19px] top-5 w-px bg-gradient-to-b from-[#FF8A7A]/40 via-[#FF8A7A]/20 to-transparent"
              style={{ height: "calc(100% - 40px)" }}
            />

            <div className="space-y-1">
              {STEPS.map((step, idx) => {
                const Icon = step.icon;
                const isLast = idx === STEPS.length - 1;
                return (
                  <motion.div
                    key={step.num}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: 0.18 + idx * 0.06 }}
                    className="flex items-start gap-4 group"
                  >
                    {/* 아이콘 + 번호 */}
                    <div className="relative flex-shrink-0 w-10 h-10 flex items-center justify-center z-10">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                          isLast
                            ? "bg-[#FF8A7A] border-[#FF8A7A] text-white"
                            : "bg-background border-[#FF8A7A]/35 text-[#FF8A7A] group-hover:border-[#FF8A7A]/70"
                        }`}
                      >
                        {isLast ? (
                          <Icon className="w-4 h-4" />
                        ) : (
                          <span className="text-[12px] font-black">{step.num}</span>
                        )}
                      </div>
                    </div>

                    {/* 텍스트 */}
                    <div className="pt-1.5 pb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13.5px] font-bold leading-tight ${isLast ? "text-[#FF8A7A]" : "text-foreground"}`}>
                          {step.name}
                        </span>
                        {idx === 4 && (
                          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-[#FF8A7A]/15 text-[#FF8A7A]">DCF·rNPV</span>
                        )}
                      </div>
                      <p className="text-[12px] text-muted-foreground/65 mt-0.5 leading-snug">{step.desc}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* 하단 info */}
          <div className="mt-6 flex items-center gap-2 px-4 py-3 rounded-xl bg-muted/40 border border-border">
            <div className="w-1.5 h-1.5 rounded-full bg-[#FF8A7A] animate-pulse flex-shrink-0" />
            <p className="text-[12px] text-muted-foreground/80 leading-snug">
              Gemini 2.5 Flash 기반 · 코스피·코스닥·NYSE·NASDAQ 전 종목 지원
            </p>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
