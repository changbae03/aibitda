import { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, useClerk } from "@clerk/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CommandPalette } from "@/components/ui/command-palette";
import { LanguageProvider, useLanguage } from "@/lib/language-context";
import { AppLayout } from "@/components/layout/app-layout";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/error-boundary";

// ── Lazy-loaded pages ──────────────────────────────────────────────────────────
// 각 페이지를 별도 청크로 분리 → 초기 번들 대폭 감소
const Landing          = lazy(() => import("@/pages/landing"));
const Login            = lazy(() => import("@/pages/login"));
const NewAnalysis      = lazy(() => import("@/pages/new-analysis"));
const AnalysisDetail   = lazy(() => import("@/pages/analysis-detail"));
const History          = lazy(() => import("@/pages/history"));
const ModelInsights    = lazy(() => import("@/pages/model-insights"));
const News             = lazy(() => import("@/pages/news"));
const Reports          = lazy(() => import("@/pages/reports"));
const Stats            = lazy(() => import("@/pages/stats"));
const Tracker          = lazy(() => import("@/pages/tracker"));
const Popular          = lazy(() => import("@/pages/popular"));
const Browse           = lazy(() => import("@/pages/browse"));
const SettingsPage     = lazy(() => import("@/pages/settings"));
const AboutPage        = lazy(() => import("@/pages/about"));
const SharePage        = lazy(() => import("@/pages/share"));
const CalendarPage      = lazy(() => import("@/pages/calendar"));
const MacroDashboard    = lazy(() => import("@/pages/macro-dashboard"));
const MarketAnalysis    = lazy(() => import("@/pages/market-analysis"));
const ETFAnalysis      = lazy(() => import("@/pages/etf-analysis"));
const Portfolio        = lazy(() => import("@/pages/portfolio"));
const MyPage           = lazy(() => import("@/pages/mypage"));
const PrivacyPage      = lazy(() => import("@/pages/privacy"));
const TermsPage        = lazy(() => import("@/pages/terms"));
const DisclaimerPage   = lazy(() => import("@/pages/disclaimer"));
const SupportPage      = lazy(() => import("@/pages/support"));
const NoticesPage      = lazy(() => import("@/pages/notices"));
const NotFound         = lazy(() => import("@/pages/not-found"));

// Admin pages — 일반 사용자 접근 없으므로 별도 청크로 완전 분리
const AdminLive            = lazy(() => import("@/pages/admin-live"));
const AdminAnalyses        = lazy(() => import("@/pages/admin-analyses"));
const AdminUsers           = lazy(() => import("@/pages/admin-users"));
const AdminFeedback        = lazy(() => import("@/pages/admin-feedback"));
const AdminUserManagement  = lazy(() => import("@/pages/admin-user-management"));
const AdminDashboard       = lazy(() => import("@/pages/admin-dashboard"));
const AdminPromoCodes      = lazy(() => import("@/pages/admin-promo-codes"));
const AdminSupportPage     = lazy(() => import("@/pages/admin-support"));
const AdminNoticesPage     = lazy(() => import("@/pages/admin-notices"));
const AdminQuality         = lazy(() => import("@/pages/admin-quality"));
const AdminPortfolios      = lazy(() => import("@/pages/admin-portfolios"));
const AdminCalibration     = lazy(() => import("@/pages/admin-calibration"));

const ConsentModal = lazy(() => import("@/components/consent-modal"));

// ── Page loader fallback ───────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="w-5 h-5 rounded-full border-2 border-[#FF8A7A] border-t-transparent animate-spin" />
    </div>
  );
}

// ── Splash screen ──────────────────────────────────────────────────────────────
const CORAL = "#FF8A7A";
const CHARS_KO = ["애", "빛", "다"];
const CHARS_EN = ["A", "i", "B", "I", "T", "D", "A"];

function GlobalSplash() {
  const { isEn } = useLanguage();
  const chars = isEn ? CHARS_EN : CHARS_KO;
  const [visible, setVisible] = useState(true);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const MIN_MS = 600;
    const elapsed = Date.now() - startRef.current;
    const delay = Math.max(0, MIN_MS - elapsed);
    const timer = setTimeout(() => setVisible(false), delay);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
        >
          <div className="flex items-end gap-[2px]">
            {chars.map((ch, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.09, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  fontFamily: "'Pretendard', sans-serif",
                  fontSize: isEn ? "52px" : "68px",
                  fontWeight: 900,
                  letterSpacing: isEn ? "-0.04em" : "-0.02em",
                  color: CORAL,
                  lineHeight: 1,
                  display: "inline-block",
                }}
              >
                {ch}
              </motion.span>
            ))}
          </div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5, ease: "easeOut" }}
            style={{
              marginTop: "10px",
              fontSize: "13px",
              fontWeight: 500,
              letterSpacing: "0.05em",
              color: "hsl(var(--muted-foreground))",
              fontFamily: "'Pretendard', sans-serif",
            }}
          >
            {isEn ? "Illuminating value with AI." : "AI로 기업가치를 밝히다"}
          </motion.p>
          <div className="absolute bottom-12 flex gap-1.5">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: CORAL }}
                animate={{ opacity: [0.2, 0.8, 0.2] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.22, ease: "easeInOut" }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── QueryClient ────────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 15,
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    }
  }
});

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function SignInPage() {
  return (
    <div className="flex justify-center mt-8">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function PublicDocLayout({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "'Pretendard', sans-serif" }}>
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            돌아가기
          </button>
          <span className="text-muted-foreground/40">|</span>
          <span className="text-sm font-bold" style={{ color: "#FF8A7A" }}>애빛다</span>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function PublicTermsPage() {
  return <PublicDocLayout><TermsPage /></PublicDocLayout>;
}

function PublicPrivacyPage() {
  return <PublicDocLayout><PrivacyPage /></PublicDocLayout>;
}

function ConsentGate() {
  const { data } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const handleConsented = useCallback(() => setDismissed(true), []);

  const user = data?.user;
  if (!user || user.consented || dismissed) return null;

  return (
    <Suspense fallback={null}>
      <ConsentModal onConsented={handleConsented} />
    </Suspense>
  );
}

function HomeRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/analysis/new", { replace: true }); }, [setLocation]);
  return null;
}

function Router() {
  return (
    <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* 풀스크린 페이지 (사이드바 없음) */}
        <Route path="/" component={HomeRedirect} />
        <Route path="/login" component={Landing} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/share/:id" component={SharePage} />
        <Route path="/terms" component={PublicTermsPage} />
        <Route path="/privacy" component={PublicPrivacyPage} />

        {/* 사이드바 있는 앱 페이지 */}
        <Route>
          <AppLayout>
            <Suspense fallback={<PageLoader />}>
              <Switch>
                <Route path="/analysis/new" component={NewAnalysis} />
                <Route path="/analysis/:id" component={AnalysisDetail} />
                <Route path="/browse" component={Browse} />
                <Route path="/history" component={History} />
                <Route path="/reports" component={Reports} />
                <Route path="/model-insights" component={ModelInsights} />
                <Route path="/news" component={News} />
                <Route path="/stats" component={Stats} />
                <Route path="/tracker" component={Tracker} />
                <Route path="/popular" component={Popular} />
                <Route path="/admin/live" component={AdminLive} />
                <Route path="/admin/analyses" component={AdminAnalyses} />
                <Route path="/admin/feedback" component={AdminFeedback} />
                <Route path="/admin/users" component={AdminUsers} />
                <Route path="/admin/user-management" component={AdminUserManagement} />
                <Route path="/admin/dashboard" component={AdminDashboard} />
                <Route path="/settings" component={SettingsPage} />
                <Route path="/about" component={AboutPage} />
                <Route path="/calendar" component={CalendarPage} />
                <Route path="/admin/promo-codes" component={AdminPromoCodes} />
                <Route path="/admin/support" component={AdminSupportPage} />
                <Route path="/admin/notices" component={AdminNoticesPage} />
                <Route path="/admin/quality" component={AdminQuality} />
                <Route path="/admin/portfolios" component={AdminPortfolios} />
                <Route path="/admin/calibration" component={AdminCalibration} />
                <Route path="/macro" component={MacroDashboard} />
                <Route path="/market-analysis" component={MarketAnalysis} />
                <Route path="/etf-analysis" component={ETFAnalysis} />
                <Route path="/portfolio" component={Portfolio} />
                <Route path="/mypage" component={MyPage} />
                <Route path="/disclaimer" component={DisclaimerPage} />
                <Route path="/support" component={SupportPage} />
                <Route path="/notices" component={NoticesPage} />
                <Route component={NotFound} />
              </Switch>
            </Suspense>
          </AppLayout>
        </Route>
      </Switch>
    </Suspense>
    </ErrorBoundary>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <ConsentGate />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <WouterRouter base={basePath}>
        <LanguageProvider>
          <GlobalSplash />
          <ClerkProviderWithRoutes />
          <CommandPalette />
        </LanguageProvider>
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
