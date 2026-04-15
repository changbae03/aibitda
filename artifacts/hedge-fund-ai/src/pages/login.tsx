import { useSignIn, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { useEffect } from "react";

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

export default function Login() {
  const { isSignedIn, isLoaded } = useUser();
  const { signIn, isLoaded: signInLoaded } = useSignIn();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setLocation("/");
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
        redirectUrlComplete: `${basePath}/`,
      });
    } catch (err) {
      console.error("Google login error:", err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-10">
          <h1
            className="text-[28px] font-black tracking-tight text-neutral-900 mb-2"
            style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif" }}
          >
            애빛다
          </h1>
          <p className="text-[14px] text-neutral-400">AI로 기업가치를 밝히다</p>
        </div>

        {/* Login Buttons */}
        <div className="space-y-3">
          {/* Kakao */}
          <button
            onClick={handleKakaoLogin}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-semibold text-[14px] transition-all"
            style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
          >
            <KakaoIcon />
            카카오로 계속하기
          </button>

          {/* Google */}
          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-semibold text-[14px] border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 transition-all"
          >
            <GoogleIcon />
            구글로 계속하기
          </button>
        </div>

        {/* Disclaimer */}
        <p className="text-center text-[11.5px] text-neutral-400 mt-8 leading-relaxed">
          로그인하면 <span className="underline cursor-pointer">이용약관</span> 및{" "}
          <span className="underline cursor-pointer">개인정보처리방침</span>에 동의하는 것으로 간주됩니다.
        </p>
      </div>
    </div>
  );
}
