import { useUser } from "@clerk/react";
import { useLocation, Link } from "wouter";
import { useEffect, useState, useRef } from "react";
import { useAuth, getKakaoLoginUrl } from "@/lib/auth";
import { getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import {
  Clock, Globe, ShieldCheck, Globe2, PieChart, BarChart2, Zap, Scale, FileText, Activity,
  TrendingUp, TrendingDown, Minus, ArrowRight, Search, Brain, Database, ChevronRight,
  Star, CheckCircle2, Layers, LineChart,
} from "lucide-react";
import { useLanguage } from "@/lib/language-context";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function KakaoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 3C6.477 3 2 6.582 2 11.01c0 2.868 1.792 5.39 4.5 6.865L5.5 21.6a.5.5 0 0 0 .73.54l4.42-2.94c.44.06.89.09 1.35.09 5.523 0 10-3.582 10-8.01C22 6.582 17.523 3 12 3Z" fill="#3C1E1E"/>
    </svg>
  );
}

function AnimatedCount({ target, suffix = "" }: { target: number; suffix?: string }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v).toLocaleString() + suffix);
  const [display, setDisplay] = useState("0" + suffix);
  useEffect(() => {
    const controls = animate(count, target, { duration: 1.8, ease: "easeOut" });
    const unsub = rounded.on("change", (v) => setDisplay(v));
    return () => { controls.stop(); unsub(); };
  }, [target]);
  return <span>{display}</span>;
}

interface PublicStats {
  totalAnalyses: number;
  winRate: number | null;
  avgReturn: number | null;
  ongoingCount: number;
}

const STEPS_KO = [
  { num: 1, name: "브리핑", icon: FileText, desc: "종목 개요 & 분석 방향 설정" },
  { num: 2, name: "매크로·산업", icon: Globe2, desc: "산업 구조, 성장률, 경쟁 구도" },
  { num: 3, name: "투자 촉매", icon: Zap, desc: "주가 촉매, 세력 움직임" },
  { num: 4, name: "실적 전망", icon: PieChart, desc: "재무 분석 + Base 실적 추정" },
  { num: 5, name: "적정주가 산출", icon: Scale, desc: "DCF·rNPV·EV/EBITDA 자동 선정" },
  { num: 6, name: "기술적 분석", icon: BarChart2, desc: "차트, 진입 구간, 손절 전략" },
  { num: 7, name: "최종 결론", icon: ShieldCheck, desc: "통합 검토 → 최종 투자 전략" },
];

const STEPS_EN = [
  { num: 1, name: "Briefing", icon: FileText, desc: "Company overview & research scope" },
  { num: 2, name: "Macro & Industry", icon: Globe2, desc: "Structure, growth rate, competition" },
  { num: 3, name: "Catalysts", icon: Zap, desc: "Price catalysts, institutional flow" },
  { num: 4, name: "Earnings Outlook", icon: PieChart, desc: "Financial analysis + earnings estimate" },
  { num: 5, name: "Valuation", icon: Scale, desc: "Auto-selects: DCF, rNPV, EV/EBITDA" },
  { num: 6, name: "Technical Analysis", icon: BarChart2, desc: "Chart patterns, entry zones, stops" },
  { num: 7, name: "Final Strategy", icon: ShieldCheck, desc: "Integrated review → investment plan" },
];

const FEATURES_KO = [
  {
    icon: Brain,
    title: "Gemini AI 기반 분석",
    desc: "구글 Gemini 2.5 Flash로 구동되는 7단계 AI 파이프라인. 단순 요약이 아닌 헤지펀드 수준의 심층 분석.",
    accent: "#FF8A7A",
  },
  {
    icon: Database,
    title: "멀티 데이터 소스",
    desc: "KIS·Yahoo Finance·DART·FnGuide 컨센서스·ECOS·FRED 등 7개 데이터 소스를 자동 통합.",
    accent: "#60a5fa",
  },
  {
    icon: Layers,
    title: "섹터별 최적 밸류에이션",
    desc: "반도체는 DCF, 바이오는 rNPV, 금융주는 P/B-ROE — 종목 특성에 맞는 방법론을 자동 선정.",
    accent: "#34d399",
  },
  {
    icon: LineChart,
    title: "기술적 분석 통합",
    desc: "펀더멘털 + 기술적 분석을 결합. 적정주가·진입가·손절선을 한 보고서에서 확인.",
    accent: "#f59e0b",
  },
];

const FEATURES_EN = [
  {
    icon: Brain,
    title: "Gemini AI Engine",
    desc: "Powered by Google Gemini 2.5 Flash. 7-step pipeline delivers hedge-fund quality, not just summaries.",
    accent: "#FF8A7A",
  },
  {
    icon: Database,
    title: "7 Data Sources",
    desc: "KIS, Yahoo Finance, DART, FnGuide consensus, ECOS, FRED — all automatically integrated.",
    accent: "#60a5fa",
  },
  {
    icon: Layers,
    title: "Sector-Optimized Valuation",
    desc: "Semiconductors use DCF, biotech uses rNPV, financials use P/B-ROE. Model auto-selected per stock.",
    accent: "#34d399",
  },
  {
    icon: LineChart,
    title: "Technical + Fundamental",
    desc: "Combines fundamental valuation with technical analysis. Target price, entry zone & stop-loss in one report.",
    accent: "#f59e0b",
  },
];

const SAMPLE_REPORT = {
  ticker: "000660",
  name: "SK하이닉스",
  verdict: "Buy",
  upside: "+17.4%",
  target: "₩1,979,540",
  entry: "₩1,640,000",
  stopLoss: "₩1,420,000",
  steps: ["브리핑", "산업 분석", "촉매 분석", "실적 전망", "적정주가", "기술적 분석", "최종 결론"],
};

function SampleReportCard({ isEn }: { isEn: boolean }) {
  const [activeStep, setActiveStep] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => {
      setActiveStep((p) => {
        const next = p + 1;
        if (next >= SAMPLE_REPORT.steps.length) { setDone(true); return p; }
        return next;
      });
    }, 900);
    return () => clearTimeout(t);
  }, [activeStep, done]);

  const verdictColor = {
    "Strong Buy": "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    "Buy": "text-blue-400 bg-blue-400/10 border-blue-400/30",
    "Hold": "text-amber-400 bg-amber-400/10 border-amber-400/30",
    "Sell": "text-orange-400 bg-orange-400/10 border-orange-400/30",
    "Strong Sell": "text-red-400 bg-red-400/10 border-red-400/30",
  }[SAMPLE_REPORT.verdict] ?? "text-muted-foreground bg-muted border-border";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3 }}
      className="relative rounded-2xl border border-white/8 bg-card/60 backdrop-blur-xl overflow-hidden shadow-2xl"
      style={{ boxShadow: "0 0 80px rgba(255,138,122,0.08)" }}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#FF8A7A]/15 flex items-center justify-center">
            <Activity className="w-4 h-4 text-[#FF8A7A]" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-foreground">{SAMPLE_REPORT.name}</p>
            <p className="text-[10px] font-mono text-muted-foreground">{SAMPLE_REPORT.ticker}</p>
          </div>
        </div>
        {done ? (
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${verdictColor}`}>
            {isEn ? SAMPLE_REPORT.verdict : "매수"}
          </span>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-[#FF8A7A]">
            <motion.div
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
              className="w-1.5 h-1.5 rounded-full bg-[#FF8A7A]"
            />
            {isEn ? "Analyzing..." : "분석 중..."}
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="px-5 py-4 space-y-2">
        {SAMPLE_REPORT.steps.map((step, i) => {
          const isActive = !done && i === activeStep;
          const isDone = done || i < activeStep;
          return (
            <div key={step} className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ${
                isDone ? "bg-[#FF8A7A]/20 border border-[#FF8A7A]/40" :
                isActive ? "bg-[#FF8A7A] shadow-[0_0_10px_rgba(255,138,122,0.5)]" :
                "bg-muted/50 border border-white/8"
              }`}>
                {isDone ? (
                  <CheckCircle2 className="w-3 h-3 text-[#FF8A7A]" />
                ) : isActive ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                    <div className="w-2.5 h-2.5 rounded-full border-2 border-white border-t-transparent" />
                  </motion.div>
                ) : (
                  <span className="text-[8px] font-bold text-muted-foreground/40">{i + 1}</span>
                )}
              </div>
              <span className={`text-[12px] transition-colors duration-300 ${isDone ? "text-foreground/70" : isActive ? "text-foreground font-semibold" : "text-muted-foreground/40"}`}>
                {isEn ? SAMPLE_REPORT.steps[i] : step}
              </span>
              {isActive && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-0.5">
                  {[0, 1, 2].map((d) => (
                    <motion.div key={d} animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.2, delay: d * 0.2 }}
                      className="w-1 h-1 rounded-full bg-[#FF8A7A]" />
                  ))}
                </motion.div>
              )}
            </div>
          );
        })}
      </div>

      {/* Result */}
      <AnimatePresence>
        {done && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="border-t border-white/8 px-5 py-4 bg-[#FF8A7A]/5"
          >
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: isEn ? "Target" : "목표가", value: SAMPLE_REPORT.target, color: "text-[#FF8A7A]" },
                { label: isEn ? "Entry" : "진입가", value: SAMPLE_REPORT.entry, color: "text-foreground" },
                { label: isEn ? "Upside" : "업사이드", value: SAMPLE_REPORT.upside, color: "text-emerald-400" },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
                  <p className={`text-[12px] font-bold tabular-nums ${m.color}`}>{m.value}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Landing() {
  const { isSignedIn, isLoaded } = useUser();
  const [, setLocation] = useLocation();
  const { data: kakaoAuth, isLoading: kakaoLoading } = useAuth();
  const { isEn, language, setLanguage } = useLanguage();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [statsVisible, setStatsVisible] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);

  const STEPS = isEn ? STEPS_EN : STEPS_KO;
  const FEATURES = isEn ? FEATURES_EN : FEATURES_KO;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) localStorage.setItem("pending_referral", ref);
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) { setLocation("/home"); return; }
    if (!kakaoLoading && kakaoAuth?.user) setLocation("/home");
  }, [isLoaded, isSignedIn, kakaoLoading, kakaoAuth, setLocation]);

  useEffect(() => {
    fetch(getApiUrl("/api/model-insights/public-stats"))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStatsVisible(true); }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleKakaoLogin = () => { window.location.href = getKakaoLoginUrl(); };
  const handleDevLogin = async () => {
    await fetch(getApiUrl("/api/auth/dev-login"), { method: "POST", credentials: "include" });
    window.location.href = "/home";
  };

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden" style={{ fontFamily: "'Pretendard', sans-serif" }}>

      {/* ── 배경 이펙트 ── */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-60 -left-60 w-[700px] h-[700px] rounded-full bg-[#FF8A7A]/5 blur-[140px]" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-[#FF8A7A]/4 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] rounded-full bg-[#FF8A7A]/3 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* ── TOP NAV ── */}
      <nav className="sticky top-0 z-50 border-b border-white/6 bg-background/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#FF8A7A]/15 flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-[#FF8A7A]" />
            </div>
            <span className="text-[18px] font-black" style={{ color: "#FF8A7A" }}>
              {isEn ? "AiBITDA" : "애빛다"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-muted/50 border border-border rounded-full p-1">
              <button onClick={() => setLanguage("ko")} className={`px-2.5 py-1 text-[10px] font-bold rounded-full transition-all ${language === "ko" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>한국어</button>
              <button onClick={() => setLanguage("en")} className={`px-2.5 py-1 text-[10px] font-bold rounded-full transition-all ${language === "en" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>English</button>
            </div>
            <button
              onClick={handleKakaoLogin}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-bold transition-all hover:opacity-90 active:scale-[0.97]"
              style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
            >
              <KakaoIcon />
              {isEn ? "Start free" : "무료로 시작"}
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative max-w-6xl mx-auto px-6 pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* Left: Copy + CTA */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FF8A7A]/10 border border-[#FF8A7A]/25 text-[11px] font-bold text-[#FF8A7A] mb-6 tracking-widest uppercase">
              <Star className="w-3 h-3" fill="currentColor" />
              {isEn ? "AI Stock Research" : "AI 주식 리서치 플랫폼"}
            </div>

            <h1 className="text-[44px] lg:text-[54px] font-black leading-[1.05] tracking-tighter mb-5">
              {isEn ? (
                <>
                  <span className="text-foreground">Hedge-fund</span><br />
                  <span style={{ color: "#FF8A7A" }}>grade analysis</span><br />
                  <span className="text-foreground">in 3 minutes.</span>
                </>
              ) : (
                <>
                  <span className="text-foreground">헤지펀드 수준의</span><br />
                  <span style={{ color: "#FF8A7A" }}>주식 분석</span>을<br />
                  <span className="text-foreground">3분 만에.</span>
                </>
              )}
            </h1>

            <p className="text-[16px] text-muted-foreground leading-relaxed mb-8 max-w-md">
              {isEn
                ? "KOSPI, KOSDAQ & US stocks analyzed through a 7-step AI pipeline — DCF, rNPV, peer comparison, technicals, all in one report."
                : "코스피·코스닥·미국 주식을 7단계 AI 파이프라인으로 분석. DCF·rNPV·피어비교·기술적 분석까지 한 보고서에."}
            </p>

            <div className="space-y-3 mb-8">
              <button
                onClick={handleKakaoLogin}
                className="w-full sm:w-auto flex items-center justify-center gap-3 px-7 py-4 rounded-2xl font-bold text-[15px] transition-all hover:opacity-90 active:scale-[0.98] shadow-lg"
                style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
              >
                <KakaoIcon />
                {isEn ? "Continue with Kakao — Free" : "카카오로 무료 시작"}
                <ArrowRight className="w-4 h-4" />
              </button>

              {import.meta.env.DEV && (
                <button onClick={handleDevLogin}
                  className="flex items-center gap-2 px-4 py-2 text-[11px] font-medium rounded-xl border border-dashed border-muted-foreground/20 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  🛠 {isEn ? "Preview account" : "미리보기 계정"}
                </button>
              )}
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                { icon: Clock, text: isEn ? "~3 min per report" : "평균 3분 완성" },
                { icon: Globe, text: isEn ? "KR & US stocks" : "한국·미국 주식" },
                { icon: ShieldCheck, text: isEn ? "Free to start" : "무료로 시작" },
              ].map((b) => (
                <span key={b.text} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/60 border border-border text-[11.5px] font-medium text-muted-foreground">
                  <b.icon className="w-3 h-3" />
                  {b.text}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Right: Animated report preview */}
          <div className="w-full max-w-sm mx-auto lg:max-w-none">
            <SampleReportCard isEn={isEn} />
          </div>
        </div>
      </section>

      {/* ── LIVE STATS BAR ── */}
      <section ref={statsRef} className="border-y border-white/6 bg-muted/20">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
            {[
              {
                value: statsVisible && stats ? <AnimatedCount target={stats.totalAnalyses} suffix="건" /> : <span className="text-muted-foreground/30">—</span>,
                label: isEn ? "Total analyses" : "누적 분석 건수",
                color: "text-[#FF8A7A]",
              },
              {
                value: statsVisible && stats?.winRate != null
                  ? <AnimatedCount target={Math.round(stats.winRate * 10) / 10} suffix="%" />
                  : <span className="text-muted-foreground/30">—</span>,
                label: isEn ? "Direction accuracy" : "주가 방향 일치율",
                color: "text-emerald-400",
              },
              {
                value: statsVisible && stats?.avgReturn != null
                  ? <span>{stats.avgReturn >= 0 ? "+" : ""}<AnimatedCount target={Math.round(stats.avgReturn * 10) / 10} suffix="%" /></span>
                  : <span className="text-muted-foreground/30">—</span>,
                label: isEn ? "Avg return tracked" : "추적 평균 수익률",
                color: "text-blue-400",
              },
              {
                value: statsVisible && stats ? <AnimatedCount target={stats.ongoingCount} suffix="건" /> : <span className="text-muted-foreground/30">—</span>,
                label: isEn ? "Ongoing tracking" : "현재 추적 중",
                color: "text-amber-400",
              },
            ].map((s, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={statsVisible ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <p className={`text-[28px] lg:text-[32px] font-black tabular-nums leading-none mb-1.5 ${s.color}`}>{s.value}</p>
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES GRID ── */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <p className="text-[11px] font-bold text-[#FF8A7A] tracking-widest uppercase mb-3">
            {isEn ? "Why AiBITDA" : "애빛다가 다른 이유"}
          </p>
          <h2 className="text-[28px] lg:text-[36px] font-black tracking-tight text-foreground">
            {isEn ? "Professional-grade, consumer-friendly." : "전문가 수준, 누구나 쉽게."}
          </h2>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="rounded-2xl border border-white/8 bg-card/50 p-5 hover:border-white/16 transition-colors group"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110" style={{ backgroundColor: `${f.accent}18` }}>
                <f.icon className="w-5 h-5" style={{ color: f.accent }} />
              </div>
              <h3 className="text-[14px] font-bold text-foreground mb-2">{f.title}</h3>
              <p className="text-[12.5px] text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── 7-STEP PIPELINE ── */}
      <section className="border-t border-white/6 bg-muted/10">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <p className="text-[11px] font-bold text-[#FF8A7A] tracking-widest uppercase mb-3">
                {isEn ? "AI Analysis Pipeline" : "AI 분석 파이프라인"}
              </p>
              <h2 className="text-[28px] lg:text-[36px] font-black tracking-tight text-foreground mb-4">
                {isEn ? "7 steps. One report.\nEvery time." : "7단계 심층 분석.\n매번 일관된 품질."}
              </h2>
              <p className="text-[14px] text-muted-foreground leading-relaxed mb-6">
                {isEn
                  ? "Each step is run independently by specialized AI agents, then cross-validated. No shortcuts."
                  : "각 단계는 전문화된 AI 에이전트가 독립 실행 후 교차 검증. 단계 생략 없음."}
              </p>
              <button onClick={handleKakaoLogin}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-[13px] transition-all hover:opacity-90"
                style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
              >
                <KakaoIcon />
                {isEn ? "Try it free →" : "무료로 체험하기 →"}
              </button>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <div className="relative space-y-1">
                {STEPS.map((step, idx) => {
                  const Icon = step.icon;
                  return (
                    <motion.div
                      key={step.num}
                      initial={{ opacity: 0, x: 16 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.06 }}
                      className="flex items-start gap-4 group"
                    >
                      <div className="w-9 h-9 rounded-xl bg-[#FF8A7A]/10 border border-[#FF8A7A]/20 flex items-center justify-center shrink-0 group-hover:bg-[#FF8A7A]/20 transition-colors">
                        <Icon className="w-4 h-4 text-[#FF8A7A]" />
                      </div>
                      <div className="pt-1 min-w-0 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-[#FF8A7A]/60 tabular-nums">0{step.num}</span>
                          <span className="text-[13.5px] font-bold text-foreground">{step.name}</span>
                        </div>
                        <p className="text-[12px] text-muted-foreground mt-0.5">{step.desc}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative rounded-3xl overflow-hidden border border-[#FF8A7A]/20 bg-gradient-to-br from-[#FF8A7A]/8 via-background to-background p-10 lg:p-16 text-center"
        >
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] rounded-full bg-[#FF8A7A]/8 blur-[80px]" />
          </div>
          <div className="relative">
            <p className="text-[11px] font-bold text-[#FF8A7A] tracking-widest uppercase mb-4">
              {isEn ? "Get started" : "지금 시작하기"}
            </p>
            <h2 className="text-[28px] lg:text-[40px] font-black tracking-tight text-foreground mb-4">
              {isEn ? "Your first report is free." : "첫 분석은 무료입니다."}
            </h2>
            <p className="text-[15px] text-muted-foreground mb-8 max-w-md mx-auto">
              {isEn
                ? "Sign in with Kakao and get your first AI analysis report in under 3 minutes."
                : "카카오로 로그인하면 바로 시작. 3분 안에 첫 AI 분석 보고서를 확인하세요."}
            </p>
            <button
              onClick={handleKakaoLogin}
              className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-[15px] transition-all hover:opacity-90 active:scale-[0.98] shadow-xl mx-auto"
              style={{ backgroundColor: "#FEE500", color: "#3C1E1E" }}
            >
              <KakaoIcon />
              {isEn ? "Start for free" : "무료로 시작하기"}
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-[11px] text-muted-foreground/40 mt-4">
              {isEn ? "No credit card required." : "신용카드 불필요."}
            </p>
          </div>
        </motion.div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/6 bg-muted/10">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-black" style={{ color: "#FF8A7A" }}>{isEn ? "AiBITDA" : "애빛다"}</span>
            <span className="text-[11px] text-muted-foreground/50">{isEn ? "AI Stock Research" : "AI 주식 리서치"}</span>
          </div>
          <nav className="flex gap-5 text-[12px] text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground transition-colors">{isEn ? "Terms" : "이용약관"}</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">{isEn ? "Privacy" : "개인정보처리방침"}</Link>
            <Link href="/disclaimer" className="hover:text-foreground transition-colors">{isEn ? "Disclaimer" : "투자 고지"}</Link>
          </nav>
          <p className="text-[11px] text-muted-foreground/40">© 2026 애빛다. {isEn ? "Not investment advice." : "투자 의견 아님."}</p>
        </div>
      </footer>
    </div>
  );
}
