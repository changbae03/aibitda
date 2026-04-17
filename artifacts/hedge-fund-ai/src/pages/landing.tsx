import { useSignIn, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

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

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" fill="#EA4335" />
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

const SAMPLE_ALERTS = [
  { time: "방금 전", text: "매크로 산업 분석 완료 — 반도체 수요 회복 사이클 초기" },
  { time: "1분 전",  text: "카탈리스트 확인 — 외국인 순매수 전환, 보유비중 +0.8%p" },
  { time: "2분 전",  text: "실적 전망 완료 — 2025E 영업이익 컨센서스 대비 +12%" },
];

function PulsingDot({ color = "#FF8A7A" }: { color?: string }) {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: color }} />
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
    </span>
  );
}

function RightPanel() {
  const [visibleAlerts, setVisibleAlerts] = useState(0);
  const [thinkingDots, setThinkingDots] = useState(1);

  useEffect(() => {
    const t1 = setInterval(() => setVisibleAlerts(v => Math.min(v + 1, SAMPLE_ALERTS.length)), 1200);
    const t2 = setInterval(() => setThinkingDots(d => (d % 3) + 1), 500);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  return (
    <div className="flex flex-col h-full bg-neutral-50 border-l border-neutral-100 p-8 overflow-hidden justify-center">

      {/* 종목 정보 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <PulsingDot color="#FF8A7A" />
          <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest">AI 분석 라이브 미리보기</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-neutral-900">삼성전자</span>
          <span className="text-xs font-mono text-neutral-400 bg-neutral-200 px-1.5 py-0.5 rounded">005930</span>
        </div>
        <div className="text-xs text-neutral-400 mt-0.5">Consumer Electronics · 코스피</div>
      </div>

      {/* 분석 단계 */}
      <div className="mb-6">
        <p className="text-[10px] font-semibold text-neutral-300 uppercase tracking-widest mb-3">분석 파이프라인 (7단계)</p>
        <div className="space-y-2">
          {DEMO_STEPS.map((step, i) => (
            <motion.div
              key={step.key}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="flex items-center gap-2.5"
            >
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                {step.done ? (
                  <span className="text-emerald-500 text-[11px]">✓</span>
                ) : step.active ? (
                  <PulsingDot color="#FF8A7A" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 block" />
                )}
              </div>
              <span className={`text-xs ${step.done ? "text-neutral-500" : step.active ? "text-neutral-800 font-semibold" : "text-neutral-300"}`}>
                {step.label}
              </span>
              {step.active && (
                <span className="text-[10px] text-[#FF8A7A] font-medium">
                  분석 중{".".repeat(thinkingDots)}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      <div className="border-t border-neutral-200 mb-4" />

      {/* 실시간 인사이트 */}
      <div className="overflow-hidden">
        <div className="flex items-center gap-1.5 mb-3">
          <PulsingDot color="#22c55e" />
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">실시간 인사이트</span>
        </div>
        <div className="space-y-2.5">
          <AnimatePresence>
            {SAMPLE_ALERTS.slice(0, visibleAlerts).map((alert, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-neutral-100 rounded-xl px-3.5 py-2.5 shadow-sm"
              >
                <div className="text-[10px] text-neutral-300 mb-0.5 font-mono">{alert.time}</div>
                <div className="text-xs text-neutral-600 leading-relaxed">{alert.text}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

    </div>
  );
}

export default function Landing() {
  const { isSignedIn, isLoaded } = useUser();
  const { signIn } = useSignIn();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setLocation("/analysis/new");
    }
  }, [isLoaded, isSignedIn, setLocation]);

  const handleKakaoLogin = () => {
    window.location.href = "/api/auth/kakao";
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
    <div className="min-h-screen flex" style={{ fontFamily: "'Pretendard', sans-serif" }}>

      {/* 왼쪽: 로그인 폼 */}
      <div className="w-full md:w-[420px] lg:w-[440px] shrink-0 flex flex-col justify-center px-10 py-12 bg-white">

        {/* 로고 */}
        <div className="mb-10">
          <h1 className="text-[32px] font-black tracking-tight mb-1" style={{ color: "#FF8A7A" }}>
            애빛다
          </h1>
          <p className="text-[15px] text-neutral-400 font-medium">AI로 기업가치를 밝히다</p>
        </div>

        {/* 설명 */}
        <div className="mb-8">
          <p className="text-[15px] text-neutral-600 leading-relaxed">
            산업 분석부터 기술적 분석, 적정주가 산출까지<br />
            7단계에 걸쳐 분석합니다.
          </p>
        </div>

        {/* 로그인 버튼 */}
        <div className="space-y-3 mb-8">
          <button
            onClick={handleKakaoLogin}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-semibold text-[14px] transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
          >
            <KakaoIcon />
            카카오로 시작하기
          </button>

          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-semibold text-[14px] border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 active:scale-[0.98] transition-all"
          >
            <GoogleIcon />
            구글로 시작하기
          </button>
        </div>

        {/* 둘러보기 */}
        <button
          onClick={() => setLocation("/analysis/new")}
          className="w-full text-center text-[13px] text-neutral-400 hover:text-neutral-600 transition-colors py-1"
        >
          로그인 없이 둘러보기 →
        </button>

        {/* 특징 3가지 */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { icon: "🏢", label: "2,700+", desc: "코스피·코스닥 종목" },
            { icon: "🤖", label: "7단계", desc: "AI 분석 파이프라인" },
            { icon: "📊", label: "실시간", desc: "주가·재무 데이터" },
          ].map(f => (
            <div key={f.label} className="bg-neutral-50 rounded-xl p-3 text-center border border-neutral-100">
              <div className="text-base mb-1">{f.icon}</div>
              <div className="text-xs font-bold text-neutral-800">{f.label}</div>
              <div className="text-[10px] text-neutral-400 mt-0.5">{f.desc}</div>
            </div>
          ))}
        </div>

        <p className="text-center text-[11px] text-neutral-300 leading-relaxed">
          로그인 시 <span className="underline cursor-pointer text-neutral-400">이용약관</span> 및{" "}
          <span className="underline cursor-pointer text-neutral-400">개인정보처리방침</span>에 동의하는 것으로 간주됩니다.
        </p>
      </div>

      {/* 오른쪽: 라이브 미리보기 (모바일 숨김) */}
      <div className="hidden md:flex flex-1 flex-col overflow-hidden">
        <RightPanel />
      </div>
    </div>
  );
}
