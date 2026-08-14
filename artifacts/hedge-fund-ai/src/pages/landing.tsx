import { useLocation, Link } from "wouter";
import { useEffect, useState } from "react";
import { useAuth, getKakaoLoginUrl } from "@/lib/auth";
import { getApiUrl } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { FileSearch, Compass, Quote } from "lucide-react";
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

/**
 * 랜딩의 일은 하나다 — **"이 앱이 나에게 무엇을 해주는가"를 5초 안에 알리는 것.**
 *
 * 예전 랜딩은 "7단계 파이프라인 · DCF·rNPV로 적정주가 산출"을 팔았다. 목표주가를 접은
 * 지금은 파는 물건이 달라졌는데 간판만 남아 있던 셈이다. 그리고 파이프라인 단계 수는
 * 만든 사람의 사정이지 사용자의 이득이 아니다.
 *
 * 지금 파는 것: **아무도 안 읽는 사업보고서를 대신 읽고, 이 회사가 어디로 가는지 말해준다.**
 */
const COPY = {
  ko: {
    badge: "공시 기반 AI 리서치",
    h1a: "애빛다,",
    h1b: "행간을 읽다.",
    sub: "축적된 사업보고서에서 기업의 행간을 분석합니다. 회사가 무엇을 바꿨고 무엇을 감췄는지, 몇 년치를 나란히 놓아야 보입니다.",
    values: [
      {
        icon: Quote,
        title: "공시로 찾는 관련주",
        desc: "뉴스가 짚어준 종목 말고, 회사가 사업보고서에 직접 적어놓은 것으로 찾습니다. 왜 걸렸는지 근거 문장까지 보여드립니다.",
      },
      {
        icon: FileSearch,
        title: "5년치를 나란히 놓고",
        desc: "300쪽짜리 사업보고서를 해마다 겹쳐 읽고 무엇이 달라졌는지 짚어줍니다. 설비투자·연구개발·인력·재고 회전까지.",
      },
      {
        icon: Compass,
        title: "지금 어느 단계인가",
        desc: "폭발 성장 · 턴어라운드 · 피크아웃 전조… 아홉 자리 중 어디인지 판정하고, 왜 그렇게 봤는지 근거를 함께 보여줍니다.",
      },
    ],
    proof: ["상장사 2,700여 곳 공시 수집", "모든 수치에 출처 문장", "한국 · 미국 주식"],
    cta: "카카오로 시작하기",
    ctaLoading: "연결 중…",
    ctaNote: "3분이면 첫 리포트가 나옵니다",
    devOnly: "개발 환경 전용",
    devLogin: "관리자 계정으로 로그인",
    checking: "로그인 확인 중...",
  },
  en: {
    badge: "AI research, grounded in filings",
    h1a: "aibitda,",
    h1b: "reading between the lines.",
    sub: "We analyze what companies imply, not just what they state — across years of accumulated filings, side by side.",
    values: [
      {
        icon: Quote,
        title: "Find theme stocks in the filings",
        desc: "Not the tickers the news happened to name — the companies that wrote about that business themselves, quoted line by line.",
      },
      {
        icon: FileSearch,
        title: "Five years, side by side",
        desc: "We line up 300-page annual reports year by year and point out what changed — capex, R&D, headcount, inventory turns.",
      },
      {
        icon: Compass,
        title: "Which stage is it in?",
        desc: "Hypergrowth, turnaround, peaking out — we place the company in one of nine stages and show the evidence behind it.",
      },
    ],
    proof: ["Filings from 2,700+ listed companies", "Every figure carries its source", "Korea · US markets"],
    cta: "Continue with Kakao",
    ctaLoading: "Connecting…",
    ctaNote: "Your first report takes about 3 minutes",
    devOnly: "Dev only",
    devLogin: "Admin account login",
    checking: "Checking sign-in...",
  },
} as const;

export default function Landing() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [fromKakao] = useState(() => new URLSearchParams(window.location.search).get("from") === "kakao");
  const { data: kakaoAuth, isLoading: kakaoLoading } = useAuth();
  const [kakaoButtonLoading, setKakaoButtonLoading] = useState(false);
  const { isEn, language, setLanguage } = useLanguage();

  const t = isEn ? COPY.en : COPY.ko;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) localStorage.setItem("pending_referral", ref);
    // 어디로 가려다 로그인 화면에 왔는지 기억한다. 카카오는 자기 주소로 돌아오므로
    // 쿼리로는 이어지지 않는다 — 저장해두지 않으면 공유받은 글을 잃어버린다.
    const next = params.get("next");
    if (next && next.startsWith("/")) sessionStorage.setItem("post_login_next", next);
    if (params.get("from") === "kakao") {
      qc.invalidateQueries({ queryKey: ["auth/me"] });
    }
  }, [qc]);

  useEffect(() => {
    if (kakaoLoading || !kakaoAuth?.user) return;
    const next = sessionStorage.getItem("post_login_next");
    sessionStorage.removeItem("post_login_next");
    // 열린 리다이렉트를 막는다 — 우리 앱 안의 경로만 따른다.
    setLocation(next && next.startsWith("/") && !next.startsWith("//") ? next : "/analysis/new");
  }, [kakaoLoading, kakaoAuth, setLocation]);

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

  // 카카오 OAuth 완료 후 auth 체크 중 — 로딩 스피너 표시
  if (fromKakao && kakaoLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-[13px] text-muted-foreground">{t.checking}</p>
      </div>
    );
  }

  const fade = (delay: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <div className="min-h-screen bg-background px-6 py-10 sm:py-16 relative overflow-hidden"
         style={{ fontFamily: "'Pretendard', sans-serif" }}>
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

      {/* 배경 — 아주 옅게. 조용한 인터페이스 원칙 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 left-1/4 w-[520px] h-[520px] rounded-full bg-primary/[0.06] blur-[150px]" />
      </div>

      <div className="relative z-10 w-full max-w-5xl mx-auto">
        {/* ── 히어로 ─────────────────────────────────────────────── */}
        <motion.div {...fade(0)} className="text-center pt-8 sm:pt-12">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-[11px] font-bold text-primary tracking-wide mb-6">
            {t.badge}
          </span>

          <h1 className="text-[38px] sm:text-[56px] font-black tracking-[-0.03em] leading-[1.08] text-foreground">
            {t.h1a}<br className="sm:hidden" />
            <span className="sm:ml-3 text-primary">{t.h1b}</span>
          </h1>

          <p className="mt-5 text-[15px] sm:text-[17px] text-foreground/60 leading-relaxed max-w-[540px] mx-auto">
            {t.sub}
          </p>
        </motion.div>

        {/* ── CTA — 위로 올린다. 읽기 전에 시작할 수 있어야 한다 ── */}
        <motion.div {...fade(0.1)} className="mt-9 max-w-sm mx-auto">
          <button
            onClick={handleKakaoLogin}
            disabled={kakaoButtonLoading}
            className="w-full flex items-center justify-center gap-3 py-4 px-5 rounded-2xl font-bold text-[15px] transition-all hover:opacity-90 active:scale-[0.98] shadow-sm disabled:opacity-75 disabled:cursor-not-allowed"
            style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
          >
            {kakaoButtonLoading ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.7s linear infinite" }}>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  <circle cx="12" cy="12" r="10" stroke="#3C1E1E" strokeOpacity="0.25" strokeWidth="3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="#3C1E1E" strokeWidth="3" strokeLinecap="round" />
                </svg>
                {t.ctaLoading}
              </>
            ) : (
              <><KakaoIcon />{t.cta}</>
            )}
          </button>
          <p className="text-center text-[12px] text-foreground/40 mt-2.5">{t.ctaNote}</p>
        </motion.div>

        {/* ── 무엇을 해주는가 — 기능이 아니라 이득으로 ── */}
        <div className="mt-16 sm:mt-20 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {t.values.map((v, i) => {
            const Icon = v.icon;
            return (
              <motion.div key={v.title} {...fade(0.2 + i * 0.08)}
                          className="rounded-2xl bg-card border border-border/50 p-5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-3.5">
                  <Icon className="w-[18px] h-[18px] text-primary" />
                </div>
                <h3 className="text-[15px] font-bold text-foreground leading-snug mb-1.5">{v.title}</h3>
                <p className="text-[13px] text-foreground/55 leading-relaxed">{v.desc}</p>
              </motion.div>
            );
          })}
        </div>

        {/* ── 신뢰 근거 ── */}
        <motion.div {...fade(0.5)}
                    className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {t.proof.map(p => (
            <span key={p} className="text-[12px] text-foreground/40 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-foreground/25" />
              {p}
            </span>
          ))}
        </motion.div>

        {/* ── 개발 로그인 · 약관 ── */}
        <div className="mt-12 max-w-sm mx-auto">
          {import.meta.env.DEV && (
            <div className="pt-4 border-t border-dashed border-border/50 mb-5">
              <p className="text-center text-[9.5px] text-muted-foreground/35 mb-2 uppercase tracking-widest">
                {t.devOnly}
              </p>
              <button
                onClick={handleDevLogin}
                disabled={kakaoButtonLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-[12.5px] font-medium border border-dashed border-muted-foreground/25 text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground transition-all disabled:opacity-50"
              >
                <span>🛠</span>{t.devLogin}
              </button>
            </div>
          )}

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
        </div>
      </div>
    </div>
  );
}
