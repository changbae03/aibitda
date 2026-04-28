import { useSignIn, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useAuth, getKakaoLoginUrl } from "@/lib/auth";
import { motion } from "framer-motion";
import { TrendingUp, CheckCircle2, Clock, BarChart2, Globe, Zap } from "lucide-react";

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

const DEMO_STEPS = [
  { key: "company_intro",       label: "기업 브리핑",           done: true,  active: false },
  { key: "industry_analysis",   label: "매크로 및 산업 분석",    done: true,  active: false },
  { key: "catalyst_analysis",   label: "투자 촉매 및 수급 분석", done: true,  active: false },
  { key: "company_analysis",    label: "실적 전망",             done: true,  active: false },
  { key: "relative_valuation",  label: "적정주가 산출",          done: false, active: true  },
  { key: "market_analysis",     label: "기술적 분석",            done: false, active: false },
  { key: "investment_strategy", label: "최종 결론",              done: false, active: false },
];

function PulsingDot({ color = "#FF8A7A" }: { color?: string }) {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: color }} />
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
    </span>
  );
}

const MOCK_METRICS = [
  { label: "현재가",      value: "74,100원",  sub: "KOSPI" },
  { label: "목표주가",    value: "95,000원",  sub: "+28.2%", highlight: true },
  { label: "PER (현재)",  value: "16.4×",    sub: "업종 평균 18.2×" },
  { label: "EV/EBITDA",  value: "8.9×",     sub: "적정 수준" },
];

function RightPanel() {
  const [thinkingDots, setThinkingDots] = useState(1);
  const [barWidths, setBarWidths] = useState([55, 78, 65, 90, 42]);

  useEffect(() => {
    const t = setInterval(() => setThinkingDots(d => (d % 3) + 1), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setBarWidths(prev => prev.map(w => {
        const delta = (Math.random() - 0.48) * 4;
        return Math.max(30, Math.min(95, w + delta));
      }));
    }, 1400);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col bg-gradient-to-br from-muted/40 to-muted/20 border-t md:border-t-0 md:border-l border-border overflow-hidden md:justify-center md:h-full px-6 py-8 md:px-10 md:py-10">

      {/* 라이브 헤더 */}
      <div className="flex items-center gap-2 mb-5">
        <PulsingDot color="#FF8A7A" />
        <span className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-widest">AI 분석 라이브 미리보기</span>
      </div>

      {/* 종목 카드 */}
      <div className="bg-background border border-border rounded-xl p-4 mb-4 shadow-sm">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] font-bold text-foreground">삼성전자</span>
              <span className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">005930</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Consumer Electronics · KOSPI</div>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <TrendingUp className="w-3 h-3" />
            매수
          </span>
        </div>

        {/* 핵심 지표 그리드 */}
        <div className="grid grid-cols-2 gap-2">
          {MOCK_METRICS.map(m => (
            <div key={m.label} className={`rounded-lg p-2.5 ${m.highlight ? "bg-[#FF8A7A]/8 border border-[#FF8A7A]/20" : "bg-muted/50"}`}>
              <p className="text-[10px] text-muted-foreground/70 mb-0.5">{m.label}</p>
              <p className={`text-[13px] font-bold ${m.highlight ? "text-[#FF8A7A]" : "text-foreground"}`}>{m.value}</p>
              <p className={`text-[10px] ${m.highlight ? "text-emerald-600 font-semibold" : "text-muted-foreground/60"}`}>{m.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 분석 파이프라인 */}
      <div className="bg-background border border-border rounded-xl p-4 shadow-sm">
        <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-3">분석 파이프라인 (7단계)</p>
        <div className="space-y-1.5">
          {DEMO_STEPS.map((step, i) => (
            <motion.div
              key={step.key}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07 }}
              className="flex items-center gap-2.5"
            >
              <div className="w-4 h-4 flex items-center justify-center shrink-0">
                {step.done ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                ) : step.active ? (
                  <PulsingDot color="#FF8A7A" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/25 block" />
                )}
              </div>
              <div className="flex-1 flex items-center gap-1.5">
                <span className={`text-[12px] ${step.done ? "text-muted-foreground" : step.active ? "text-foreground font-semibold" : "text-muted-foreground/40"}`}>
                  {step.label}
                </span>
                {step.active && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-[#FF8A7A]/40" />
                    <span className="text-[10px] text-[#FF8A7A] font-semibold">분석 중{".".repeat(thinkingDots)}</span>
                  </>
                )}
              </div>
              {step.done && (
                <div className="h-1 rounded-full bg-muted overflow-hidden" style={{ width: `${barWidths[i % barWidths.length]}px` }}>
                  <motion.div
                    className="h-full rounded-full bg-emerald-400/60"
                    animate={{ width: `${barWidths[i % barWidths.length]}%` }}
                    transition={{ duration: 1.2, ease: "easeInOut" }}
                    style={{ width: "100%" }}
                  />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>

    </div>
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
    <div className="min-h-screen flex flex-col md:flex-row" style={{ fontFamily: "'Pretendard', sans-serif" }}>

      {/* 왼쪽: 로그인 폼 */}
      <div className="w-full md:w-[420px] lg:w-[460px] shrink-0 flex flex-col justify-center px-8 py-10 md:px-12 md:py-14 bg-background relative">

        {/* 미묘한 배경 텍스처 */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-[#FF8A7A]/5 blur-3xl" />
          <div className="absolute -bottom-12 -right-12 w-48 h-48 rounded-full bg-[#FF8A7A]/5 blur-2xl" />
        </div>

        <div className="relative z-10">
          {/* 로고 */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-10"
          >
            <h1 className="text-[38px] font-black tracking-tighter mb-1.5 leading-none" style={{ color: "#FF8A7A" }}>
              애빛다
            </h1>
            <p className="text-[14px] text-muted-foreground font-medium tracking-wide">AI로 기업가치를 밝히다</p>
          </motion.div>

          {/* 설명 */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 }}
            className="mb-8"
          >
            <p className="text-[15px] text-foreground/80 leading-relaxed font-medium mb-3">
              산업 분석부터 기술적 분석, 적정주가 산출까지<br />
              7단계에 걸쳐 깊이 있게 분석합니다.
            </p>
            <div className="flex items-center gap-2">
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
              { Icon: Globe,    label: "한국·미국", desc: "주식 분석" },
              { Icon: Zap,      label: "7단계 AI",  desc: "파이프라인", highlight: true },
              { Icon: BarChart2, label: "실시간",   desc: "주가·재무" },
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

      {/* 오른쪽: 라이브 미리보기 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <RightPanel />
      </div>
    </div>
  );
}
