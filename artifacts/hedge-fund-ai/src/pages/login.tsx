import { useLocation, Link } from "wouter";
import { useEffect, useState } from "react";
import { getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { useAuth } from "@/lib/auth";

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

function Spinner({ size = 18, color = "#3C1E1E" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 0.7s linear infinite" }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke={color} strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function Login() {
  const { data: authData, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { isEn, language, setLanguage } = useLanguage();
  const [kakaoLoading, setKakaoLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && authData?.user) {
      setLocation("/");
    }
  }, [authLoading, authData, setLocation]);

  const handleKakaoLogin = () => {
    setKakaoLoading(true);
    window.location.href = `${basePath}/api/auth/kakao`;
  };

  const handleDevLogin = async () => {
    setKakaoLoading(true);
    try {
      await fetch(getApiUrl("/api/auth/dev-login"), { method: "POST", credentials: "include" });
      window.location.href = basePath + "/";
    } finally {
      setKakaoLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4" style={{ minHeight: "50vh" }}>
        <div className="w-5 h-5 rounded-full border-2 border-[#FF8A7A] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 relative">
      {/* 언어 토글 */}
      <div className="absolute top-4 right-4 flex items-center gap-1 bg-muted/60 border border-border rounded-full p-1">
        <button
          onClick={() => setLanguage("ko")}
          className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all ${language === "ko" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          한국어
        </button>
        <button
          onClick={() => setLanguage("en")}
          className={`px-3 py-1 text-[11px] font-bold rounded-full transition-all ${language === "en" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          English
        </button>
      </div>

      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-10">
          <h1
            className="text-[28px] font-black tracking-tight mb-2"
            style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", color: "#FF8A7A" }}
          >
            {isEn ? "AiBITDA" : "애빛다"}
          </h1>
          <p className="text-[14px] text-muted-foreground">
            {isEn ? "Illuminating value with AI." : "AI로 기업가치를 밝히다"}
          </p>
        </div>

        {/* Login Buttons */}
        <div className="space-y-3">
          {/* Kakao */}
          <button
            onClick={handleKakaoLogin}
            disabled={kakaoLoading}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-semibold text-[14px] transition-all active:scale-[0.98] disabled:opacity-75"
            style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
          >
            {kakaoLoading ? (
              <>
                <Spinner size={18} color="#3C1E1E" />
                {isEn ? "Connecting…" : "연결 중…"}
              </>
            ) : (
              <>
                <KakaoIcon />
                {isEn ? "Continue with Kakao" : "카카오로 계속하기"}
              </>
            )}
          </button>
        </div>

        {/* Disclaimer */}
        <p className="text-center text-[11.5px] text-muted-foreground mt-8 leading-relaxed">
          {isEn ? (
            <>By signing in, you agree to our{" "}<Link href="/terms" className="underline hover:text-foreground transition-colors">Terms of Service</Link> and{" "}<Link href="/privacy" className="underline hover:text-foreground transition-colors">Privacy Policy</Link>.</>
          ) : (
            <>로그인하면{" "}<Link href="/terms" className="underline hover:text-foreground transition-colors">이용약관</Link> 및{" "}<Link href="/privacy" className="underline hover:text-foreground transition-colors">개인정보처리방침</Link>에 동의하는 것으로 간주됩니다.</>
          )}
        </p>

        {/* 개발 환경 전용 미리보기 로그인 */}
        {import.meta.env.DEV && (
          <div className="mt-8 pt-6 border-t border-dashed border-border">
            <p className="text-center text-[10.5px] text-muted-foreground/50 mb-3 uppercase tracking-widest font-medium">
              {isEn ? "Dev only" : "개발 환경 전용"}
            </p>
            <button
              onClick={handleDevLogin}
              disabled={kakaoLoading}
              className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl text-[13px] font-semibold border border-dashed border-muted-foreground/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all disabled:opacity-60"
            >
              <span className="text-[15px]">🛠</span>
              {isEn ? "Preview account login" : "미리보기 계정으로 로그인"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
