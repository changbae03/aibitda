import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, useClerk } from "@clerk/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/app-layout";
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
import AdminPeers from "@/pages/admin-peers";
import AdminTickerNotes from "@/pages/admin-ticker-notes";
import AdminUsers from "@/pages/admin-users";
import AdminFeedback from "@/pages/admin-feedback";
import AdminUserManagement from "@/pages/admin-user-management";
import AdminDashboard from "@/pages/admin-dashboard";
import Stats from "@/pages/stats";
import Tracker from "@/pages/tracker";
import Popular from "@/pages/popular";
import SettingsPage from "@/pages/settings";
import SharePage from "@/pages/share";
import CalendarPage from "@/pages/calendar";
import SchedulesPage from "@/pages/schedules";

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

function Router() {
  return (
    <Switch>
      {/* 풀스크린 페이지 (사이드바 없음) */}
      <Route path="/" component={Landing} />
      <Route path="/login" component={Landing} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/share/:id" component={SharePage} />

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
            <Route path="/admin/peers" component={AdminPeers} />
            <Route path="/admin/ticker-notes" component={AdminTickerNotes} />
            <Route path="/admin/feedback" component={AdminFeedback} />
            <Route path="/admin/users" component={AdminUsers} />
            <Route path="/admin/user-management" component={AdminUserManagement} />
            <Route path="/admin/dashboard" component={AdminDashboard} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/calendar" component={CalendarPage} />
            <Route path="/schedules" component={SchedulesPage} />
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
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
