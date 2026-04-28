import { useSignIn, useUser } from "@clerk/react";
import { useLocation, Link } from "wouter";
import { useEffect, useState } from "react";
import { useAuth, getKakaoLoginUrl } from "@/lib/auth";
import { motion, AnimatePresence } from "framer-motion";
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
  { num: 5, name: "적정주가 산출",          icon: Scale,       desc: "종목 특성에 맞는 방법론 자동 선정 (DCF·rNPV·EV/EBITDA 등)" },
  { num: 6, name: "기술적 분석",            icon: BarChart2,   desc: "차트, 진입 구간, 손절 전략" },
  { num: 7, name: "최종 결론",              icon: ShieldCheck, desc: "통합 검토 → 최종 투자 전략" },
];

const SAMPLE_TICKERS = [
  { label: "삼성전자", verdict: "상승여력 +21.4%", color: "#22c55e" },
  { label: "SK하이닉스", verdict: "높은 상승여력", color: "#10b981" },
  { label: "NVIDIA", verdict: "적정 수준", color: "#f59e0b" },
  { label: "NAVER", verdict: "상승여력 +15.2%", color: "#22c55e" },
  { label: "카카오뱅크", verdict: "분석 중...", color: "#FF8A7A" },
  { label: "현대차", verdict: "상승여력 +9.8%", color: "#22c55e" },
  { label: "LG에너지솔루션", verdict: "적정 수준", color: "#f59e0b" },
  { label: "Apple", verdict: "높은 상승여력", color: "#10b981" },
];

function FloatingTicker({ item, delay }: { item: typeof SAMPLE_TICKERS[0]; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 0 }}
      animate={{ opacity: [0, 0.55, 0.55, 0], y: -60 }}
      transition={{ duration: 4, delay, ease: "easeOut", repeat: Infinity, repeatDelay: SAMPLE_TICKERS.length * 1.1 }}
      className="absolute pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-background/60 backdrop-blur-sm shadow-sm"
      style={{ left: `${10 + (delay * 13) % 75}%`, bottom: "15%" }}
    >
      <span className="text-[10px] font-semibold text-foreground/70">{item.label}</span>
      <span className="text-[10px] font-bold" style={{ color: item.color }}>{item.verdict}</span>
    </motion.div>
  );
}

export default function Landing() {
  const { isSignedIn, isLoaded } = useUser();
  const { signIn } = useSignIn();
  const [, setLocation] = useLocation();
  const { data: kakaoAuth, isLoading: kakaoLoading } = useAuth();
  const [activeStep, setActiveStep] = useState(-1);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) localStorage.setItem("pending_referral", ref);
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) { setLocation("/analysis/new"); return; }
    if (!kakaoLoading && kakaoAuth?.user) setLocation("/analysis/new");
  }, [isLoaded, isSignedIn, kakaoLoading, kakaoAuth, setLocation]);

  useEffect(() => {
    const start = setTimeout(() => setActiveStep(0), 1400);
    return () => clearTimeout(start);
  }, []);

  useEffect(() => {
    if (activeStep < 0) return;
    const t = setTimeout(() => {
      setActiveStep(prev => (prev + 1) % STEPS.length);
    }, 750);
    return () => clearTimeout(t);
  }, [activeStep]);

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
      className="min-h-screen flex items-center justify-center bg-background px-6 py-12 overflow-hidden"
      style={{ fontFamily: "'Pretendard', sans-serif" }}
    >
      {/* ── 배경 애니메이션 오브 ── */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          animate={{ x: [0, 28, -14, 0], y: [0, -22, 16, 0], scale: [1, 1.06, 0.97, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut", repeatType: "reverse" }}
          className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#FF8A7A]/8 blur-3xl"
        />
        <motion.div
          animate={{ x: [0, -24, 18, 0], y: [0, 18, -12, 0], scale: [1, 0.95, 1.04, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", repeatType: "reverse", delay: 3 }}
          className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-[#FF8A7A]/6 blur-2xl"
        />
        <motion.div
          animate={{ scale: [1, 1.08, 0.96, 1], opacity: [0.03, 0.06, 0.03] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", repeatType: "reverse", delay: 1 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#FF8A7A] blur-3xl"
        />
      </div>

      <div className="relative z-10 w-full max-w-4xl flex flex-col lg:flex-row items-center lg:items-start gap-12 lg:gap-16">

        {/* ── 왼쪽: 로그인 카드 ── */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45 }}
          className="w-full max-w-sm flex-shrink-0 relative"
        >
          {/* 플로팅 티커들 */}
          <div className="absolute inset-0 overflow-visible">
            {SAMPLE_TICKERS.map((t, i) => (
              <FloatingTicker key={t.label} item={t} delay={i * 1.1} />
            ))}
          </div>

          {/* 로고 */}
          <div className="mb-8 text-center lg:text-left">
            <motion.h1
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-[44px] font-black tracking-tighter mb-1.5 leading-none relative"
              style={{ color: "#FF8A7A" }}
            >
              애빛다
              {/* 로고 glow pulse */}
              <motion.span
                animate={{ opacity: [0.4, 0.9, 0.4] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 blur-xl pointer-events-none"
                style={{ color: "#FF8A7A", zIndex: -1 }}
                aria-hidden
              >
                애빛다
              </motion.span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="text-[14px] text-muted-foreground font-medium tracking-wide"
            >
              AI로 기업가치를 밝히다
            </motion.p>
          </div>

          {/* 설명 */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.3 }}
            className="mb-6 text-center lg:text-left"
          >
            <p className="text-[15px] text-foreground/75 leading-relaxed font-medium mb-4">
              코스피·코스닥·미국 주식을<br />
              7단계 AI 파이프라인으로 깊이 분석합니다.
            </p>
            <div className="flex items-center justify-center lg:justify-start gap-2">
              <motion.span
                animate={{ scale: [1, 1.03, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FF8A7A]/10 border border-[#FF8A7A]/20 text-[11.5px] font-bold text-[#FF8A7A]"
              >
                <Clock className="w-3 h-3" />
                평균 3분 완성
              </motion.span>
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
            transition={{ duration: 0.45, delay: 0.4 }}
            className="space-y-3 mb-6"
          >
            <div className="relative overflow-hidden rounded-xl">
              <button
                onClick={handleKakaoLogin}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-bold text-[14.5px] transition-all hover:opacity-90 active:scale-[0.98] shadow-sm relative z-10"
                style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
              >
                <KakaoIcon />
                카카오로 시작하기
              </button>
              {/* shimmer sweep */}
              <motion.div
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 3.5, ease: "easeInOut" }}
                className="absolute inset-y-0 w-1/3 pointer-events-none z-20"
                style={{
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
                }}
              />
            </div>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.55 }}
            className="text-center text-[11px] text-muted-foreground/45 leading-relaxed"
          >
            로그인 시{" "}
            <Link href="/terms" className="underline text-muted-foreground/70 hover:text-foreground transition-colors">이용약관</Link>{" "}
            및{" "}
            <Link href="/privacy" className="underline text-muted-foreground/70 hover:text-foreground transition-colors">개인정보처리방침</Link>
            에 동의하는 것으로 간주됩니다.
          </motion.p>
        </motion.div>

        {/* ── 오른쪽: 7단계 파이프라인 ── */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="w-full lg:pt-2"
        >
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mb-5"
          >
            <p className="text-[12px] font-bold text-[#FF8A7A] tracking-widest uppercase mb-1">AI 분석 파이프라인</p>
            <h2 className="text-[20px] font-black text-foreground tracking-tight">7단계 심층 리서치</h2>
          </motion.div>

          <div className="relative">
            {/* 연결선 – 로드 시 아래로 그려지는 애니메이션 */}
            <div
              className="absolute left-[19px] top-5 w-px overflow-hidden"
              style={{ height: "calc(100% - 40px)" }}
            >
              <motion.div
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 1.1, delay: 0.55, ease: "easeOut" }}
                style={{ transformOrigin: "top", height: "100%" }}
                className="w-full h-full bg-gradient-to-b from-[#FF8A7A]/50 via-[#FF8A7A]/20 to-transparent"
              />
            </div>

            <div className="space-y-1">
              {STEPS.map((step, idx) => {
                const Icon = step.icon;
                const isLast = idx === STEPS.length - 1;
                const isActive = activeStep === idx;
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
                      {/* 활성 스텝 pulse ring */}
                      <AnimatePresence>
                        {isActive && (
                          <motion.div
                            key="ring"
                            initial={{ scale: 0.8, opacity: 0.8 }}
                            animate={{ scale: 1.6, opacity: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.65, ease: "easeOut" }}
                            className="absolute inset-0 rounded-full border-2 border-[#FF8A7A]"
                          />
                        )}
                      </AnimatePresence>
                      <motion.div
                        animate={isActive ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                        transition={isActive ? { duration: 0.4, ease: "easeOut" } : {}}
                        className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                          isActive
                            ? "bg-[#FF8A7A] border-[#FF8A7A] text-white shadow-lg shadow-[#FF8A7A]/30"
                            : isLast
                            ? "bg-[#FF8A7A] border-[#FF8A7A] text-white"
                            : "bg-background border-[#FF8A7A]/35 text-[#FF8A7A] group-hover:border-[#FF8A7A]/70"
                        }`}
                      >
                        {isLast && !isActive ? (
                          <Icon className="w-4 h-4" />
                        ) : (
                          <span className="text-[12px] font-black">{step.num}</span>
                        )}
                      </motion.div>
                    </div>

                    {/* 텍스트 */}
                    <div className="pt-1.5 pb-2 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13.5px] font-bold leading-tight transition-colors duration-300 ${
                          isActive ? "text-[#FF8A7A]" : isLast ? "text-[#FF8A7A]" : "text-foreground"
                        }`}>
                          {step.name}
                        </span>
                        {/* 활성 스텝 "분석 중" 표시 */}
                        <AnimatePresence>
                          {isActive && (
                            <motion.span
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              transition={{ duration: 0.2 }}
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF8A7A]/15 text-[#FF8A7A] border border-[#FF8A7A]/30"
                            >
                              분석 중
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                      <p className={`text-[12px] mt-0.5 leading-snug transition-colors duration-300 ${
                        isActive ? "text-muted-foreground" : "text-muted-foreground/65"
                      }`}>
                        {step.desc}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* 하단 info */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.75 }}
            className="mt-6 px-4 py-3.5 rounded-xl bg-muted/40 border border-border space-y-2"
          >
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#FF8A7A] mt-1.5 flex-shrink-0" />
              <p className="text-[12px] text-muted-foreground/80 leading-snug">
                바이오(rNPV)·건설(P/BV)·금융(P/B-ROE)·조선(수주잔고 NPV) 등<br />
                <span className="font-semibold text-foreground/75">섹터·종목 특성에 따라 밸류에이션 방법론을 자동으로 선정합니다.</span>
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#FF8A7A]/50 mt-1.5 flex-shrink-0" />
              <p className="text-[12px] text-muted-foreground/80 leading-snug">
                <span className="font-semibold text-foreground/75">한국 주식시장에 특화된 AI</span>로, 코스피·코스닥의 업종 관행과 공시 체계를 반영해 지속적으로 발전합니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 flex-shrink-0" />
              <p className="text-[12px] text-muted-foreground/60 leading-snug">
                코스피·코스닥·NYSE·NASDAQ · 실시간 재무·공시·뉴스 데이터 연동
              </p>
            </div>
          </motion.div>
        </motion.div>

      </div>
    </div>
  );
}
