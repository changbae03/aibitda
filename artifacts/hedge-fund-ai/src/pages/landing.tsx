import { useSignIn, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { motion } from "framer-motion";

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

const REPORT_SECTIONS = [
  {
    step: "산업 분석",
    color: "#6366f1",
    summary:
      "글로벌 AI 서버 투자 확대로 HBM·LPDDR5 수요가 구조적으로 증가하고 있습니다. 2025년 반도체 사이클은 메모리 공급 긴축과 맞물려 상승 국면 초입에 진입한 것으로 판단합니다.",
  },
  {
    step: "투자 촉매",
    color: "#f59e0b",
    summary:
      "2025년 2분기 HBM3E 12단 양산 본격화(4월), 엔비디아 B200 공급망 편입(6월), 파운드리 GAA 2nm 수율 개선 발표(8월)가 핵심 촉매로 작용할 전망입니다.",
  },
  {
    step: "실적 전망",
    color: "#10b981",
    summary:
      "2025년 연간 매출 320조 원(+18% YoY), 영업이익 46조 원(+72% YoY) 전망. DS 부문이 영업이익의 약 68%를 차지하며 실적 회복을 주도할 것으로 예상합니다.",
  },
  {
    step: "기술적 분석",
    color: "#FF8A7A",
    summary:
      "주봉 기준 RSI 44로 과매도 구간에서 반등 중. 53,000~54,500원 지지대가 견고하며 60,000원 저항 돌파 시 추세 전환 가능성이 높습니다.",
  },
];

function SampleReport() {
  return (
    <div className="flex flex-col h-full bg-neutral-50 border-l border-neutral-100 overflow-y-auto">
      {/* 보고서 헤더 */}
      <div className="bg-white border-b border-neutral-100 px-8 py-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[10px] font-semibold text-neutral-300 uppercase tracking-widest mb-2">AI 분석 보고서 예시</div>
            <div className="flex items-baseline gap-2.5">
              <span className="text-2xl font-black text-neutral-900">삼성전자</span>
              <span className="text-xs font-mono text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-md">005930</span>
            </div>
            <div className="text-xs text-neutral-400 mt-0.5">Consumer Electronics · 코스피</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-neutral-400 mb-1">현재가</div>
            <div className="text-xl font-bold font-mono text-neutral-900">₩54,800</div>
          </div>
        </div>

        {/* 핵심 지표 행 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            상승여력
          </span>
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="text-neutral-300">적정주가</span>
            <span className="font-bold font-mono text-emerald-600">₩72,000</span>
            <span className="text-emerald-500 font-semibold">(+31.4%)</span>
          </div>
          <div className="h-3 w-px bg-neutral-200" />
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="text-neutral-300">손절가</span>
            <span className="font-bold font-mono text-red-500">₩49,500</span>
          </div>
        </div>
      </div>

      {/* 최종 결론 */}
      <div className="px-8 py-5 bg-white border-b border-neutral-100">
        <div className="text-[10px] font-semibold text-neutral-300 uppercase tracking-widest mb-2">최종 결론</div>
        <p className="text-sm text-neutral-700 leading-relaxed">
          HBM 수요 구조적 증가와 파운드리 수율 개선이 맞물리는 2025년은 삼성전자의 실적 턴어라운드가 가시화되는 해입니다.
          현 주가는 12개월 선행 PBR 1.1배로 역사적 저점권에 위치해 있어 <strong>진입 매력도가 높습니다.</strong>
          53,000원 지지대를 활용한 분할 매수를 권고합니다.
        </p>
      </div>

      {/* 섹션별 분석 카드 */}
      <div className="px-8 py-5 space-y-3">
        <div className="text-[10px] font-semibold text-neutral-300 uppercase tracking-widest mb-3">단계별 분석 요약</div>
        {REPORT_SECTIONS.map((s, i) => (
          <motion.div
            key={s.step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.12 }}
            className="bg-white border border-neutral-100 rounded-xl p-4 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-1.5 h-4 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-[11px] font-bold text-neutral-600">{s.step}</span>
            </div>
            <p className="text-xs text-neutral-500 leading-relaxed">{s.summary}</p>
          </motion.div>
        ))}
      </div>

      {/* 밸류에이션 */}
      <div className="px-8 pb-6">
        <div className="bg-white border border-neutral-100 rounded-xl p-4 shadow-sm">
          <div className="text-[10px] font-semibold text-neutral-300 uppercase tracking-widest mb-3">밸류에이션 요약</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: "DCF",      value: "₩69,400",  sub: "WACC 8.2%" },
              { label: "PBR",      value: "₩71,500",  sub: "Target 1.5x" },
              { label: "EV/EBITDA",value: "₩75,100",  sub: "Target 8.0x" },
            ].map(v => (
              <div key={v.label} className="bg-neutral-50 rounded-lg p-2.5">
                <div className="text-[9px] text-neutral-400 mb-1">{v.label}</div>
                <div className="text-sm font-bold font-mono text-neutral-800">{v.value}</div>
                <div className="text-[9px] text-neutral-400 mt-0.5">{v.sub}</div>
              </div>
            ))}
          </div>
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

      {/* 오른쪽: 삼성전자 샘플 보고서 (모바일 숨김) */}
      <div className="hidden md:flex flex-1 flex-col overflow-hidden">
        <SampleReport />
      </div>
    </div>
  );
}
