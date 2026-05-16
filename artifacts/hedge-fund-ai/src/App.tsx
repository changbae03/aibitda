import { useEffect, useRef, useState } from "react";
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
import NotFound from "@/pages/not-found";

// Pages
import NewAnalysis from "@/pages/new-analysis";
import AnalysisDetail from "@/pages/analysis-detail";
import History from "@/pages/history";
import Login from "@/pages/login";
import Landing from "@/pages/landing";
import ModelInsights from "@/pages/model-insights";
import News from "@/pages/news";
import Reports from "@/pages/reports";
import AdminLive from "@/pages/admin-live";
import AdminAnalyses from "@/pages/admin-analyses";
import AdminTickerNotes from "@/pages/admin-ticker-notes";
import AdminUsers from "@/pages/admin-users";
import AdminFeedback from "@/pages/admin-feedback";
import AdminUserManagement from "@/pages/admin-user-management";
import AdminDashboard from "@/pages/admin-dashboard";
import Stats from "@/pages/stats";
import Tracker from "@/pages/tracker";
import Popular from "@/pages/popular";
import SettingsPage from "@/pages/settings";
import AboutPage from "@/pages/about";
import SharePage from "@/pages/share";
import CalendarPage from "@/pages/calendar";
import AdminPromoCodes from "@/pages/admin-promo-codes";
import AdminSupportPage from "@/pages/admin-support";
import AdminNoticesPage from "@/pages/admin-notices";
import AdminCalibration from "@/pages/admin-calibration";
import AdminQuality from "@/pages/admin-quality";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import DisclaimerPage from "@/pages/disclaimer";
import SupportPage from "@/pages/support";
import NoticesPage from "@/pages/notices";

const CORAL = "#FF8A7A";
const CHARS_KO = ["애", "빛", "다"];
const CHARS_EN = ["A", "i", "B", "I", "T", "D", "A"];

function GlobalSplash() {
  const { isEn } = useLanguage();
  const chars = isEn ? CHARS_EN : CHARS_KO;
  const [visible, setVisible] = useState(true);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const MIN_MS = 1800;
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
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
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
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

function Router() {
  return (
    <Switch>
      {/* 풀스크린 페이지 (사이드바 없음) */}
      <Route path="/" component={Landing} />
      <Route path="/login" component={Landing} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/share/:id" component={SharePage} />
      <Route path="/terms" component={PublicTermsPage} />
      <Route path="/privacy" component={PublicPrivacyPage} />

      {/* 사이드바 있는 앱 페이지 */}
      <Route>
        <AppLayout>
          <Switch>
            <Route path="/analysis/new" component={NewAnalysis} />
            <Route path="/analysis/:id" component={AnalysisDetail} />
            <Route path="/history" component={History} />
            <Route path="/reports" component={Reports} />
            <Route path="/model-insights" component={ModelInsights} />
            <Route path="/news" component={News} />
            <Route path="/stats" component={Stats} />
            <Route path="/tracker" component={Tracker} />
            <Route path="/popular" component={Popular} />
            <Route path="/admin/live" component={AdminLive} />
            <Route path="/admin/analyses" component={AdminAnalyses} />
            <Route path="/admin/ticker-notes" component={AdminTickerNotes} />
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
            <Route path="/admin/calibration" component={AdminCalibration} />
            <Route path="/admin/quality" component={AdminQuality} />
            <Route path="/disclaimer" component={DisclaimerPage} />
            <Route path="/support" component={SupportPage} />
            <Route path="/notices" component={NoticesPage} />
            <Route component={NotFound} />
          </Switch>
        </AppLayout>
      </Route>
    </Switch>
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
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
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
