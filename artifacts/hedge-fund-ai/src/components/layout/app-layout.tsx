import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, Settings, LogIn, LogOut, Bell, Info,
  Sparkles, BookOpen, CalendarDays, BarChart2, ScanLine,
  User, Search, ChevronRight, Download, Share,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { AnimatePresence, motion } from "framer-motion";
import { openCommandPalette } from "@/components/ui/command-palette";

interface AppLayoutProps {
  children: ReactNode;
}

interface AuthUser {
  id: string;
  nickname: string;
  profileImage: string | null;
}

interface CreditInfo {
  remaining: number;
  dailyLimit: number;
  dailyUsed: number;
}

function useAuth() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  useEffect(() => {
    fetch(getApiUrl("/api/auth/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => setUser(d?.user ?? null))
      .catch(() => setUser(null));
  }, []);
  return user;
}

function useCredits(loggedIn: boolean) {
  const [credits, setCredits] = useState<CreditInfo | null>(null);
  useEffect(() => {
    if (!loggedIn) return;
    fetch(getApiUrl("/api/credits"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCredits(d); })
      .catch(() => {});
  }, [loggedIn]);
  return credits;
}

async function logout() {
  await fetch(getApiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
  window.location.href = "/";
}

interface NoticeSettings { notice_enabled?: string; notice_text?: string; notice_type?: string }

function useNotice(): NoticeSettings {
  const [settings, setSettings] = useState<NoticeSettings>({});
  useEffect(() => {
    fetch(getApiUrl("/api/admin/settings/public"), { credentials: "include" })
      .then(r => r.ok ? r.json() : {})
      .then(setSettings)
      .catch(() => {});
  }, []);
  return settings;
}


function NoticeBanner({ settings }: { settings: NoticeSettings }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || settings.notice_enabled !== "true" || !settings.notice_text) return null;
  const type = settings.notice_type ?? "info";
  const colors = {
    info:    "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300",
    warning: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300",
    error:   "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300",
  }[type] ?? "bg-blue-50 border-blue-200 text-blue-700";

  return (
    <div className={cn("flex items-center gap-2 px-4 py-2 border-b text-sm print:hidden shrink-0", colors)}>
      <Bell className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1">{settings.notice_text}</span>
      <button onClick={() => setDismissed(true)} className="opacity-60 hover:opacity-100 transition-opacity">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

const NAV_ITEMS = [
  { href: "/analysis/new", label: "AI 기업분석",  labelEn: "AI Analysis",     Icon: Sparkles },
  { href: "/screening",    label: "종목 스크리닝", labelEn: "Screening",       Icon: ScanLine },
  { href: "/history",      label: "내가 본 자료",  labelEn: "My Reports",      Icon: BookOpen },
  { href: "/calendar",     label: "마켓 캘린더",   labelEn: "Market Calendar", Icon: CalendarDays },
  { href: "/popular",      label: "애빛다 통계",   labelEn: "Statistics",      Icon: BarChart2 },
];

const ADMIN_ITEMS = [
  { href: "/admin/dashboard",       label: "대시보드" },
  { href: "/admin/live",            label: "실시간 분석 현황" },
  { href: "/admin/analyses",        label: "전체 보고서 목록" },
  { href: "/admin/user-management", label: "유저 관리" },
  { href: "/admin/promo-codes",     label: "프로모 코드" },
  { href: "/admin/ticker-notes",    label: "종목 보정 메모" },
  { href: "/admin/notices",         label: "공지사항 관리" },
  { href: "/admin/feedback",        label: "유저 피드백" },
  { href: "/admin/support",         label: "고객 문의" },
  { href: "/admin/calibration",     label: "모델 보정 현황" },
  { href: "/admin/quality",         label: "AI 품질 관리" },
  { href: "/admin/users",           label: "관리자 관리" },
];

function CreditDots({ credits }: { credits: CreditInfo }) {
  const remaining = Math.max(0, credits.dailyLimit - credits.dailyUsed);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: credits.dailyLimit }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "w-2 h-2 rounded-full transition-colors",
            i < remaining ? "bg-[#FF8A7A]" : "bg-muted-foreground/20"
          )}
        />
      ))}
    </div>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const user = useAuth();
  const credits = useCredits(user !== undefined && user !== null);
  const notice = useNotice();
  const { isEn } = useLanguage();

  useEffect(() => {
    fetch(getApiUrl("/api/admin/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.isAdmin) setIsAdmin(true); })
      .catch(() => {});
  }, []);

  // PWA 설치 프롬프트
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isIos, setIsIos] = useState(false);
  const [isKakao, setIsKakao] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua);
    const kakao = /KAKAOTALK/i.test(ua);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    setIsIos(ios);
    setIsKakao(kakao);
    setIsStandalone(standalone);
    if (standalone) return;

    // 7일 이내 닫은 경우 배너 숨김
    const dismissed = localStorage.getItem("pwa-banner-dismissed");
    if (dismissed && Date.now() < Number(dismissed)) { setBannerDismissed(true); return; }

    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);

    // 3초 후 배너 표시
    const timer = setTimeout(() => setShowBanner(true), 3000);
    return () => { window.removeEventListener("beforeinstallprompt", handler); clearTimeout(timer); };
  }, []);

  // iOS(카카오 포함)는 installPrompt 없이도 배너 표시
  useEffect(() => {
    if (isStandalone || bannerDismissed) return;
    if (isIos) { const t = setTimeout(() => setShowBanner(true), 3000); return () => clearTimeout(t); }
  }, [isIos, isStandalone, bannerDismissed]);

  const dismissBanner = () => {
    setShowBanner(false);
    localStorage.setItem("pwa-banner-dismissed", String(Date.now() + 7 * 24 * 60 * 60 * 1000));
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") { setInstallPrompt(null); setShowBanner(false); }
  };

  // 카카오톡 iOS: Safari에서 열기 유도
  // 카카오톡 Android / 일반 Chrome: beforeinstallprompt 직접 설치
  // 일반 iOS Safari: 공유 버튼 안내
  const isKakaoIos = isKakao && isIos;
  const isSafariIos = isIos && !isKakao; // 순수 Safari

  const [showKakaoGuide, setShowKakaoGuide] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.origin).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const handleFooterInstall = () => setShowBanner(true);

  const NavLinks = ({ onSelect, expanded }: { onSelect?: () => void; expanded?: boolean }) => (
    <>
      {NAV_ITEMS.map(({ href, label, labelEn, Icon }) => {
        const isActive =
          location === href || (href !== "/" && location.startsWith(href));
        const displayLabel = isEn ? labelEn : label;
        return (
          <Link
            key={href}
            href={href}
            onClick={onSelect}
            title={!expanded ? displayLabel : undefined}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-all duration-150 overflow-hidden",
              isActive
                ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-[#FF8A7A]" : "text-muted-foreground/60")} />
            <span className={cn(
              "whitespace-nowrap transition-[opacity,max-width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
              expanded ? "opacity-100 max-w-[160px] delay-75" : "opacity-0 max-w-0 overflow-hidden delay-0"
            )}>
              {displayLabel}
            </span>
          </Link>
        );
      })}
    </>
  );

  const UserSection = ({ expanded }: { expanded?: boolean }) => (
    <div className="px-2 py-3 border-t border-border space-y-1">
      {user && expanded && (
        <div className="flex items-center gap-2.5 px-2 py-1.5 mb-0.5">
          <div className="w-7 h-7 rounded-full bg-[#FF8A7A]/20 flex items-center justify-center shrink-0">
            {user.profileImage ? (
              <img src={user.profileImage} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <User className="w-3.5 h-3.5 text-[#FF8A7A]" />
            )}
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            <p className="text-[12px] font-semibold text-foreground truncate">{user.nickname}</p>
            {credits && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <CreditDots credits={credits} />
                <span className="text-[10px] text-muted-foreground/60">{isEn ? `${Math.max(0, credits.dailyLimit - credits.dailyUsed)} left today` : `오늘 ${Math.max(0, credits.dailyLimit - credits.dailyUsed)}회 남음`}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {user && !expanded && (
        <div className="flex justify-center py-1">
          <div className="w-7 h-7 rounded-full bg-[#FF8A7A]/20 flex items-center justify-center">
            {user.profileImage ? (
              <img src={user.profileImage} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <User className="w-3.5 h-3.5 text-[#FF8A7A]" />
            )}
          </div>
        </div>
      )}

      <Link
        href="/about"
        title={!expanded ? (isEn ? "About" : "애빛다 소개") : undefined}
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 overflow-hidden",
          location === "/about"
            ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        <Info className="w-3.5 h-3.5 shrink-0" />
        <span className={cn("whitespace-nowrap transition-all duration-200", expanded ? "opacity-100 max-w-[160px]" : "opacity-0 max-w-0 overflow-hidden")}>
          {isEn ? "About" : "애빛다 소개"}
        </span>
      </Link>

      <Link
        href="/settings"
        title={!expanded ? (isEn ? "Settings" : "설정") : undefined}
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 overflow-hidden",
          location === "/settings"
            ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        <Settings className="w-3.5 h-3.5 shrink-0" />
        <span className={cn("whitespace-nowrap transition-all duration-200", expanded ? "opacity-100 max-w-[160px]" : "opacity-0 max-w-0 overflow-hidden")}>
          {isEn ? "Settings" : "설정"}
        </span>
      </Link>

      {user ? (
        <button
          onClick={logout}
          title={!expanded ? (isEn ? "Sign Out" : "로그아웃") : undefined}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 text-muted-foreground hover:text-foreground hover:bg-accent overflow-hidden"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          <span className={cn("whitespace-nowrap transition-all duration-200", expanded ? "opacity-100 max-w-[160px]" : "opacity-0 max-w-0 overflow-hidden")}>
            {isEn ? "Sign Out" : "로그아웃"}
          </span>
        </button>
      ) : user === null ? (
        <Link
          href="/login"
          title={!expanded ? (isEn ? "Sign In" : "로그인") : undefined}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 overflow-hidden",
            location === "/login"
              ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
        >
          <LogIn className="w-3.5 h-3.5 shrink-0" />
          <span className={cn("whitespace-nowrap transition-all duration-200", expanded ? "opacity-100 max-w-[160px]" : "opacity-0 max-w-0 overflow-hidden")}>
            {isEn ? "Sign In" : "로그인"}
          </span>
        </Link>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
      {/* ── Desktop Sidebar Rail ── */}
      <aside
        className={cn(
          "shrink-0 flex-col z-20 hidden md:flex print:hidden border-r border-border bg-background/95 backdrop-blur-sm overflow-hidden",
          "transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          sidebarExpanded ? "w-52" : "w-14"
        )}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
      >
        {/* Logo */}
        <div className="h-14 flex items-center border-b border-border overflow-hidden relative">
          {/* 접힌 상태: 애 글자 가운데 */}
          <Link
            href="/analysis/new"
            className={cn(
              "absolute inset-0 flex items-center justify-center group transition-opacity duration-300",
              sidebarExpanded ? "opacity-0 pointer-events-none" : "opacity-100"
            )}
          >
            <span
              className="text-[20px] font-black tracking-tighter leading-none select-none group-hover:opacity-70 transition-opacity duration-200"
              style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900, color: "#FF8A7A" }}
            >
              애
            </span>
          </Link>
          {/* 펼쳐진 상태: 애빛다 + 검색 버튼 */}
          <div className={cn(
            "flex items-center w-full transition-opacity duration-300",
            sidebarExpanded ? "opacity-100 delay-100" : "opacity-0 pointer-events-none"
          )}>
            <Link href="/analysis/new" className="flex items-center group px-3 min-w-0">
              <span
                className="text-[22px] font-black tracking-tighter leading-none select-none group-hover:opacity-70 transition-opacity duration-200 whitespace-nowrap"
                style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900, color: "#FF8A7A" }}
              >
                애빛다
              </span>
            </Link>
            <button
              onClick={openCommandPalette}
              title="검색 (⌘K)"
              className="ml-auto mr-2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-1.5 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden scrollbar-none">
          <NavLinks expanded={sidebarExpanded} />
          {isAdmin && sidebarExpanded && (
            <div className="pt-4">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">관리자</p>
              {ADMIN_ITEMS.map(item => {
                const isActive = location === item.href || location.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "block px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors duration-150 whitespace-nowrap overflow-hidden",
                      isActive
                        ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
                        : "text-muted-foreground/60 hover:text-foreground hover:bg-accent"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        <UserSection expanded={sidebarExpanded} />

        {/* Slogan */}
        <div className={cn(
          "px-4 py-2.5 border-t border-border overflow-hidden transition-opacity duration-300",
          sidebarExpanded ? "opacity-100 delay-100" : "opacity-0 delay-0"
        )}>
          <p className="text-[10px] text-muted-foreground/35 leading-relaxed tracking-wide whitespace-nowrap">
            {isEn ? "Illuminating value with AI" : "AI로 기업가치를 밝히다"}
          </p>
        </div>

        {/* Expand toggle hint */}
        <div className={cn(
          "absolute right-0 top-1/2 -translate-y-1/2 w-4 h-8 flex items-center justify-center transition-all duration-200",
          sidebarExpanded ? "opacity-0" : "opacity-0 hover:opacity-40"
        )}>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </div>
      </aside>

      {/* ── Mobile Drawer ── */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black z-40 md:hidden print:hidden"
              onClick={() => setMenuOpen(false)}
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className="fixed left-0 top-0 h-full w-64 z-50 flex flex-col md:hidden print:hidden bg-background border-r border-border"
            >
              <div className="px-5 h-14 flex items-center justify-between border-b border-border">
                <span
                  className="text-[22px] font-black tracking-tighter leading-none"
                  style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900, color: "#FF8A7A" }}
                >
                  애빛다
                </span>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
                <NavLinks onSelect={() => setMenuOpen(false)} expanded={true} />
                {isAdmin && (
                  <div className="pt-4">
                    <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">관리자</p>
                    {ADMIN_ITEMS.map(item => {
                      const isActive = location === item.href || location.startsWith(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMenuOpen(false)}
                          className={cn(
                            "block px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors duration-150",
                            isActive
                              ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
                              : "text-muted-foreground/60 hover:text-foreground hover:bg-accent"
                          )}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </nav>

              {/* Mobile user section */}
              <div className="px-3 py-3 border-t border-border space-y-0.5">
                {user && (
                  <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
                    <div className="w-7 h-7 rounded-full bg-[#FF8A7A]/20 flex items-center justify-center shrink-0">
                      {user.profileImage ? (
                        <img src={user.profileImage} alt="" className="w-7 h-7 rounded-full object-cover" />
                      ) : (
                        <User className="w-3.5 h-3.5 text-[#FF8A7A]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-foreground truncate">{user.nickname}</p>
                      {credits && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <CreditDots credits={credits} />
                          <span className="text-[10px] text-muted-foreground/60">{isEn ? `${Math.max(0, credits.dailyLimit - credits.dailyUsed)} left today` : `오늘 ${Math.max(0, credits.dailyLimit - credits.dailyUsed)}회 남음`}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <Link href="/about" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Info className="w-3.5 h-3.5" /> {isEn ? "About" : "애빛다 소개"}
                </Link>
                <Link href="/settings" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Settings className="w-3.5 h-3.5" /> {isEn ? "Settings" : "설정"}
                </Link>
                {user ? (
                  <button onClick={() => { setMenuOpen(false); logout(); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <LogOut className="w-3.5 h-3.5" /> {isEn ? "Sign Out" : "로그아웃"}
                  </button>
                ) : user === null ? (
                  <Link href="/login" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <LogIn className="w-3.5 h-3.5" /> {isEn ? "Sign In" : "로그인"}
                  </Link>
                ) : null}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main Content ── */}
      <main id="print-main" className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Top Bar */}
        <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-border bg-background z-30 sticky top-0 shrink-0 print:hidden">
          <span
            className="text-[20px] font-black tracking-tighter leading-none"
            style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900, color: "#FF8A7A" }}
          >
            애빛다
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={openCommandPalette}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
              title="검색"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={() => setMenuOpen(true)}
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        <NoticeBanner settings={notice} />

        {/* Scrollable Content */}
        <div id="print-scroll" className="flex-1 overflow-y-auto">
          <div className="container max-w-5xl mx-auto px-3 py-4 md:p-10">
            {children}
          </div>

          {/* Footer */}
          <footer className="border-t border-border mt-8 print:hidden">
            <div className="container max-w-5xl mx-auto px-3 sm:px-6 md:px-10 py-5 sm:py-6">
              <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground mb-4">
                <Link href="/privacy" className="hover:text-foreground transition-colors">{isEn ? "Privacy Policy" : "개인정보처리방침"}</Link>
                <span className="text-border select-none">|</span>
                <Link href="/terms" className="hover:text-foreground transition-colors">{isEn ? "Terms of Service" : "이용약관"}</Link>
                <span className="text-border select-none">|</span>
                <Link href="/notices" className="hover:text-foreground transition-colors">{isEn ? "Notices" : "공지사항"}</Link>
                <span className="text-border select-none">|</span>
                <Link href="/disclaimer" className="hover:text-foreground transition-colors">{isEn ? "Disclaimer" : "투자유의사항"}</Link>
                <span className="text-border select-none">|</span>
                <Link href="/support" className="hover:text-foreground transition-colors">{isEn ? "Support" : "고객센터"}</Link>

                {/* 푸터 앱 설치 링크 — 클릭 시 슬라이드업 배너 열기 */}
                {!isStandalone && (
                  <button
                    onClick={handleFooterInstall}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    {isEn ? "Install App" : "앱 설치"}
                  </button>
                )}
              </nav>
              {isEn ? (
                <>
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    All content on CBST (애빛다) is AI-generated for reference purposes only and does not constitute a recommendation to buy, sell, or hold any financial instrument. Final investment decisions remain solely the responsibility of the investor.
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
                    This service does not constitute investment advisory or discretionary investment management under applicable law. All content is AI-generated and disclosed as such.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    애빛다의 모든 콘텐츠는 AI가 자동 생성한 참고용 정보이며, 특정 금융투자상품의 매수·매도·보유를 권유하거나 추천하지 않습니다. 투자 판단의 최종 책임은 투자자 본인에게 있습니다.
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
                    본 서비스는 자본시장법상 투자자문업·투자일임업에 해당하지 않으며, 인공지능 기본법에 따라 AI 생성 콘텐츠임을 고지합니다.
                  </p>
                </>
              )}
              <p className="text-[11px] text-muted-foreground/50 mt-1.5">
                © {new Date().getFullYear()} 애빛다 · CBST. {isEn ? "Illuminating value with AI." : "AI로 기업가치를 밝히다."}
              </p>
            </div>
          </footer>
        </div>

      </main>

      {/* PWA 하단 슬라이드업 배너 */}
      <AnimatePresence>
        {showBanner && (
          <motion.div
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm"
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
              {/* 헤더 */}
              <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                <img
                  src="/pwa-192x192.png"
                  alt="애빛다"
                  className="w-12 h-12 rounded-xl shrink-0 shadow"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-foreground leading-tight">
                    {isEn ? "Install AiBITDA" : "애빛다 앱 설치"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {isEn
                      ? "Add to home screen for faster access & offline use"
                      : "홈 화면 추가로 더 빠르게, 언제든지"}
                  </p>
                </div>
                <button
                  onClick={dismissBanner}
                  className="shrink-0 p-1.5 -mr-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 케이스별 설치 안내 */}
              {isKakaoIos ? (
                /* ── 카카오톡 iOS: 링크 복사 + 안내 오버레이 ── */
                <div className="px-4 pb-4 space-y-2">
                  <button
                    onClick={() => {
                      // 링크 자동 복사
                      navigator.clipboard.writeText(window.location.origin).catch(() => {});
                      // window.open 시도 (일부 카카오 버전에서 외부 브라우저로 열림)
                      window.open(window.location.href, "_blank");
                      setShowBanner(false);
                      setShowKakaoGuide(true);
                    }}
                    className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:scale-[.98] transition-all flex items-center justify-center gap-2"
                  >
                    <Share className="w-4 h-4" />
                    Safari에서 열고 설치하기
                  </button>
                </div>
              ) : isSafariIos ? (
                /* ── 일반 Safari iOS: 공유 버튼 안내 ── */
                <div className="px-4 pb-4">
                  <div className="bg-muted/40 rounded-xl p-3 space-y-2">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">설치 방법</p>
                    <ol className="space-y-1.5">
                      {[
                        ["하단 공유 버튼", "(□↑) 탭"],
                        ['"홈 화면에 추가"', "선택"],
                        ['"추가"', "탭"],
                      ].map(([a, b], i) => (
                        <li key={i} className="flex items-center gap-2.5 text-xs text-foreground">
                          <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                            {i + 1}
                          </span>
                          <span>{a} <span className="text-muted-foreground">{b}</span></span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="flex justify-center mt-2.5">
                    <div className="flex items-center gap-1 text-muted-foreground text-[11px]">
                      <Share className="w-3 h-3" />
                      <span>Safari 하단 공유 아이콘을 찾아요</span>
                    </div>
                  </div>
                </div>
              ) : (
                /* ── Android / Chrome / 카카오 Android: 직접 설치 ── */
                <div className="px-4 pb-4">
                  <button
                    onClick={handleInstall}
                    className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-[.98] transition-all"
                  >
                    {isEn ? "Add to Home Screen" : "홈 화면에 추가"}
                  </button>
                  <p className="text-center text-[11px] text-muted-foreground mt-2">
                    {isEn ? "No download required · Free forever" : "별도 다운로드 없음 · 무료"}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 카카오톡 iOS 전용 — Safari로 여는 방법 전체화면 가이드 */}
      <AnimatePresence>
        {showKakaoGuide && (
          <motion.div
            key="kakao-guide"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex flex-col"
          >
            {/* 우상단 ··· 화살표 영역 — 탭해도 안내 유지 */}
            <div className="flex justify-end pt-3 pr-4">
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.35, ease: "easeOut" }}
                className="flex flex-col items-center gap-1"
              >
                {/* 위를 향한 화살표 */}
                <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
                  <path d="M14 34 L14 4 M14 4 L5 14 M14 4 L23 14"
                    stroke="#FF8A7A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-xs text-primary font-bold">여기 ···</span>
              </motion.div>
            </div>

            {/* 중앙 안내 카드 */}
            <div className="flex-1 flex items-center justify-center px-8">
              <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 12 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.92, opacity: 0 }}
                transition={{ delay: 0.1, duration: 0.3, ease: "easeOut" }}
                className="w-full max-w-xs bg-card border border-border rounded-2xl shadow-2xl p-5"
              >
                <p className="font-bold text-base text-foreground mb-1">Safari에서 열기</p>

                {/* 링크 자동 복사 안내 */}
                <div className="bg-primary/10 border border-primary/20 rounded-xl px-3 py-2 mb-4 flex items-center gap-2">
                  <span className="text-primary text-base">✓</span>
                  <p className="text-xs text-primary font-medium leading-snug">
                    링크가 복사됐어요! Safari 주소창에 붙여넣기 해주세요.
                  </p>
                </div>

                <p className="text-[11px] text-muted-foreground mb-3 font-medium">또는 ··· 메뉴로 바로 열기</p>
                <ol className="space-y-3 mb-4">
                  {[
                    ["오른쪽 상단 ···", "탭"],
                    ['"외부 브라우저로 열기"', '또는 "Safari로 열기" 선택'],
                    ["배너에서", '"홈 화면에 추가" 탭'],
                  ].map(([a, b], i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-foreground leading-snug">
                        <span className="font-medium">{a}</span>{" "}
                        <span className="text-muted-foreground">{b}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </motion.div>
            </div>

            {/* 하단 닫기 */}
            <div className="pb-10 flex justify-center">
              <button
                onClick={() => setShowKakaoGuide(false)}
                className="text-white/60 text-sm"
              >
                닫기
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
