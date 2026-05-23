import { useLocation, Link } from "wouter";
import { useEffect, useState } from "react";
import { useAuth, getKakaoLoginUrl } from "@/lib/auth";
import { getApiUrl } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Clock, Globe, ShieldCheck, Globe2, PieChart, BarChart2, Zap, Scale, FileText, Activity } from "lucide-react";
import { useLanguage } from "@/lib/language-context";

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


const STEPS_KO = [
  { num: 1, name: "브리핑",                icon: FileText,    desc: "종목 개요 & 분석 방향 설정" },
  { num: 2, name: "매크로·산업 분석",       icon: Globe2,      desc: "산업 구조, 성장률, 경쟁 구도" },
  { num: 3, name: "투자 촉매·수급 분석",    icon: Zap,         desc: "주가 촉매, 세력 움직임" },
  { num: 4, name: "실적 전망",              icon: PieChart,    desc: "재무 분석 + Base 실적 추정" },
  { num: 5, name: "적정주가 산출",          icon: Scale,       desc: "DCF·rNPV·EV/EBITDA 등 종목별 최적 방법론 자동 선정" },
  { num: 6, name: "기술적 분석",            icon: BarChart2,   desc: "차트, 진입 구간, 손절 전략" },
  { num: 7, name: "최종 결론",              icon: ShieldCheck, desc: "통합 검토 → 최종 투자 전략" },
];

const STEPS_EN = [
  { num: 1, name: "Briefing",               icon: FileText,    desc: "Company overview & research scope setting" },
  { num: 2, name: "Macro & Industry",       icon: Globe2,      desc: "Industry structure, growth rate, competitive landscape" },
  { num: 3, name: "Catalysts & Flow",       icon: Zap,         desc: "Price catalysts, institutional activity" },
  { num: 4, name: "Earnings Outlook",       icon: PieChart,    desc: "Financial analysis + earnings estimate" },
  { num: 5, name: "Valuation",              icon: Scale,       desc: "DCF, rNPV, EV/EBITDA — best method auto-selected" },
  { num: 6, name: "Technical Analysis",     icon: BarChart2,   desc: "Chart patterns, entry zones, stop-loss strategy" },
  { num: 7, name: "Final Conclusion",       icon: ShieldCheck, desc: "Integrated review → final investment strategy" },
];


export default function Landing() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [fromKakao] = useState(() => new URLSearchParams(window.location.search).get("from") === "kakao");
  const { data: kakaoAuth, isLoading: kakaoLoading } = useAuth();
  const [activeStep, setActiveStep] = useState(0);
  const [kakaoButtonLoading, setKakaoButtonLoading] = useState(false);
  const { isEn, language, setLanguage } = useLanguage();

  const STEPS = isEn ? STEPS_EN : STEPS_KO;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) localStorage.setItem("pending_referral", ref);
    if (params.get("from") === "kakao") {
      qc.invalidateQueries({ queryKey: ["auth/me"] });
    }
  }, [qc]);

  useEffect(() => {
    if (!kakaoLoading && kakaoAuth?.user) setLocation("/analysis/new");
  }, [kakaoLoading, kakaoAuth, setLocation]);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep(prev => (prev + 1) % 6);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleKakaoLogin = () => {
    if (kakaoButtonLoading) return;
    setKakaoButtonLoading(true);
    // iOS Safari: 클릭 핸들러 직접 콜스택에서 호출해야 팝업 차단 안 됨
    window.location.href = getKakaoLoginUrl();
  };

  const handleDevLogin = async () => {
    setKakaoButtonLoading(true);
    try {
      await fetch(getApiUrl("/api/auth/dev-login"), { method: "POST", credentials: "include" });
      window.location.href = basePath + "/analysis/new";
    } finally {
      setKakaoButtonLoading(false);
    }
  };


  // 인증 상태 확인 중 — 항상 스피너 표시 (로그인된 사용자는 이후 /analysis/new로 자동 이동)
  if (kakaoLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="w-8 h-8 rounded-full border-2 border-[#FF8A7A] border-t-transparent animate-spin" />
        <p className="text-[13px] text-muted-foreground">
          {fromKakao ? "로그인 확인 중..." : ""}
        </p>
      </div>
    );
  }

  return (
    <>
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-background px-6 py-12 relative overflow-hidden"
      style={{ fontFamily: "'Pretendard', sans-serif" }}
    >
      {/* 언어 토글 */}
      <div className="absolute top-5 right-5 z-20 flex items-center gap-1 bg-muted/60 border border-border rounded-full p-1">
        <button
          onClick={() => setLanguage("ko")}
          className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all ${language === "ko" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {language === "en" ? "Korean" : "한국어"}
        </button>
        <button
          onClick={() => setLanguage("en")}
          className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all ${language === "en" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          English
        </button>
      </div>

      {/* 배경 그라디언트 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-slate-400/5 blur-[140px]" />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full bg-slate-500/4 blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.018] dark:opacity-[0.045]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-4xl flex flex-col gap-10">

        {/* ── 메인 콘텐츠 ── */}
        <div className="flex flex-col lg:flex-row items-center lg:items-start gap-12 lg:gap-16">

          {/* ── 왼쪽: 로그인 카드 ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="w-full max-w-sm flex-shrink-0"
          >
            {/* 로고 */}
            <div className="mb-8 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FF8A7A]/10 border border-[#FF8A7A]/20 text-[11px] font-bold text-[#FF8A7A] mb-4 tracking-widest uppercase">
                <Activity className="w-3 h-3" />
                {isEn ? "AI Stock Research" : "AI 주식 리서치"}
              </div>

              <p className="text-[14px] text-muted-foreground font-medium tracking-wide">
                {isEn ? "Illuminating value with AI." : "AI로 기업가치를 밝히다"}
              </p>
            </div>

            {/* 설명 */}
            <div className="mb-6 text-center lg:text-left">
              <p className="text-[15px] text-foreground/75 leading-relaxed font-medium mb-4">
                {isEn ? (
                  <>Korean KOSPI·KOSDAQ &amp; US stocks,<br />deeply analyzed in a 7-step AI pipeline.</>
                ) : (
                  <>코스피·코스닥·미국 주식을<br />7단계 AI 파이프라인으로 깊이 분석합니다.</>
                )}
              </p>
              <div className="flex items-center justify-center lg:justify-start gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FF8A7A]/10 border border-[#FF8A7A]/20 text-[11.5px] font-bold text-[#FF8A7A]">
                  <Clock className="w-3 h-3" />
                  {isEn ? "~3 min per report" : "평균 3분 완성"}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/80 border border-border text-[11.5px] font-medium text-muted-foreground">
                  <Globe className="w-3 h-3" />
                  {isEn ? "KR & US stocks" : "한국·미국 주식"}
                </span>
              </div>
            </div>

            {/* 로그인 버튼 */}
            <div className="space-y-3 mb-6">
              <button
                onClick={handleKakaoLogin}
                disabled={kakaoButtonLoading}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-bold text-[14.5px] transition-all hover:opacity-90 active:scale-[0.98] shadow-sm disabled:opacity-75 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
              >
                {kakaoButtonLoading ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.7s linear infinite" }}>
                      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                      <circle cx="12" cy="12" r="10" stroke="#3C1E1E" strokeOpacity="0.25" strokeWidth="3" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="#3C1E1E" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    {isEn ? "Connecting…" : "연결 중…"}
                  </>
                ) : (
                  <>
                    <KakaoIcon />
                    {isEn ? "Continue with Kakao" : "카카오로 시작하기"}
                  </>
                )}
              </button>

              {import.meta.env.DEV && (
                <div className="pt-3 border-t border-dashed border-border/50">
                  <p className="text-center text-[9.5px] text-muted-foreground/35 mb-2 uppercase tracking-widest">
                    {isEn ? "Dev only" : "개발 환경 전용"}
                  </p>
                  <button
                    onClick={handleDevLogin}
                    disabled={kakaoButtonLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-[12.5px] font-medium border border-dashed border-muted-foreground/25 text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground transition-all disabled:opacity-50"
                  >
                    <span>🛠</span>
                    {isEn ? "Preview account login" : "미리보기 계정으로 로그인"}
                  </button>
                </div>
              )}
            </div>

            <p className="text-center text-[11px] text-muted-foreground/45 leading-relaxed">
              {isEn ? (
                <>
                  By signing in, you agree to our{" "}
                  <Link href="/terms" className="underline text-muted-foreground/70 hover:text-foreground transition-colors">Terms of Service</Link>{" "}
                  and{" "}
                  <Link href="/privacy" className="underline text-muted-foreground/70 hover:text-foreground transition-colors">Privacy Policy</Link>.
                </>
              ) : (
                <>
                  로그인 시{" "}
                  <Link href="/terms" className="underline text-muted-foreground/70 hover:text-foreground transition-colors">이용약관</Link>{" "}
                  및{" "}
                  <Link href="/privacy" className="underline text-muted-foreground/70 hover:text-foreground transition-colors">개인정보처리방침</Link>
                  에 동의하는 것으로 간주됩니다.
                </>
              )}
            </p>
          </motion.div>

          {/* ── 오른쪽: 7단계 파이프라인 ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="w-full lg:pt-2"
          >
            <div className="mb-5">
              <p className="text-[12px] font-bold text-[#FF8A7A] tracking-widest uppercase mb-1">
                {isEn ? "AI Analysis Pipeline" : "AI 분석 파이프라인"}
              </p>
              <h2 className="text-[20px] font-black text-foreground tracking-tight">
                {isEn ? "7-Step Deep Research" : "7단계 심층 리서치"}
              </h2>
            </div>

            <div className="relative">
              {/* 수직 연결선 */}
              <div
                className="absolute left-[19px] top-5 w-px z-0"
                style={{ height: "calc(100% - 40px)" }}
              >
                <div className="absolute inset-0 bg-gradient-to-b from-[#FF8A7A]/30 via-[#FF8A7A]/15 to-transparent" />
                <motion.div
                  className="absolute top-0 left-0 w-full bg-[#FF8A7A]"
                  animate={{
                    height: `${((activeStep + 1) / 6) * 100}%`,
                    opacity: 0.6,
                  }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                />
              </div>

              <div className="space-y-1">
                {STEPS.map((step, idx) => {
                  const Icon = step.icon;
                  const isLast = idx === STEPS.length - 1;
                  const isActive = !isLast && activeStep === idx;
                  const isDone = !isLast && idx < activeStep;

                  return (
                    <div
                      key={step.num}
                      className="flex items-start gap-4"
                    >
                      {/* 아이콘 원형 */}
                      <div className="relative flex-shrink-0 w-10 h-10 flex items-center justify-center z-10">
                        <motion.div
                          animate={{
                            backgroundColor: isLast
                              ? "#FF8A7A"
                              : isActive
                              ? "#FF8A7A"
                              : isDone
                              ? "rgba(255,138,122,0.15)"
                              : "transparent",
                            borderColor: isLast || isActive
                              ? "#FF8A7A"
                              : isDone
                              ? "rgba(255,138,122,0.5)"
                              : "rgba(255,138,122,0.25)",
                          }}
                          transition={{ duration: 0.5, ease: "easeInOut" }}
                          className="w-10 h-10 rounded-full flex items-center justify-center border-2"
                        >
                          <span style={{ color: isLast || isActive ? "#ffffff" : "#FF8A7A" }}>
                            {isLast ? (
                              <Icon className="w-4 h-4" />
                            ) : isDone ? (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <span className="text-[12px] font-black">{step.num}</span>
                            )}
                          </span>
                        </motion.div>
                      </div>

                      {/* 텍스트 */}
                      <div className="pt-1.5 pb-2 min-w-0">
                        <span
                          className="text-[13.5px] font-bold leading-tight block transition-colors duration-500"
                          style={{
                            color: isLast || isActive
                              ? "#FF8A7A"
                              : isDone
                              ? "rgba(255,138,122,0.65)"
                              : undefined,
                          }}
                        >
                          {step.name}
                          {isActive && (
                            <span className="ml-2 text-[10px] font-bold text-[#FF8A7A] bg-[#FF8A7A]/10 px-1.5 py-0.5 rounded-full border border-[#FF8A7A]/20 tracking-wide">
                              {isEn ? "Analyzing" : "분석 중"}
                            </span>
                          )}
                        </span>
                        <p className="text-[12px] text-muted-foreground/65 mt-0.5 leading-snug line-clamp-1">{step.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </div>

      </div>
    </div>
    </>
  );
}
