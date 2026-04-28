import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, Settings, LogIn, LogOut, Bell, Info,
  Sparkles, BookOpen, CalendarDays, BarChart2,
  Zap, User,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

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

interface MacroBarData {
  usdKrw: number | null;
  t10y: number | null;
  fedRate: number | null;
  baseRate: number | null;
}

function useMarketBar() {
  const [data, setData] = useState<MacroBarData | null>(null);
  useEffect(() => {
    fetch(getApiUrl("/api/macro"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setData({
          usdKrw: d.ecos?.usdKrw ?? null,
          t10y: d.fred?.t10y ?? null,
          fedRate: d.fred?.fedFundsRate ?? null,
          baseRate: d.ecos?.baseRate ?? null,
        });
      })
      .catch(() => {});
  }, []);
  return data;
}

function MarketBar() {
  const data = useMarketBar();
  if (!data) return null;

  const items = [
    data.usdKrw != null && { label: "USD/KRW", value: `${data.usdKrw.toFixed(0)}원` },
    data.baseRate != null && { label: "한국 기준금리", value: `${data.baseRate.toFixed(2)}%` },
    data.t10y != null && { label: "미국 10Y", value: `${data.t10y.toFixed(2)}%` },
    data.fedRate != null && { label: "Fed 금리", value: `${data.fedRate.toFixed(2)}%` },
  ].filter(Boolean) as { label: string; value: string }[];

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-0 px-4 py-2 border-b border-border bg-muted/30 print:hidden overflow-x-auto shrink-0">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-1 whitespace-nowrap">
          {i > 0 && <span className="mx-3 text-border/60 select-none">·</span>}
          <span className="text-[11px] text-muted-foreground/70">{item.label}</span>
          <span className="text-[11px] font-mono font-bold text-foreground/80 ml-1">{item.value}</span>
        </span>
      ))}
    </div>
  );
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
  { href: "/analysis/new", label: "AI 기업분석",  Icon: Sparkles },
  { href: "/history",       label: "내가 본 자료", Icon: BookOpen },
  { href: "/calendar",      label: "마켓 캘린더",  Icon: CalendarDays },
  { href: "/popular",       label: "애빛다 통계",  Icon: BarChart2 },
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
  const user = useAuth();
  const credits = useCredits(user !== undefined && user !== null);
  const notice = useNotice();

  useEffect(() => {
    fetch(getApiUrl("/api/admin/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.isAdmin) setIsAdmin(true); })
      .catch(() => {});
  }, []);

  const NavLinks = ({ onSelect }: { onSelect?: () => void }) => (
    <>
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const isActive =
          location === href || (href !== "/" && location.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onSelect}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-all duration-150",
              isActive
                ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-[#FF8A7A]" : "text-muted-foreground/60")} />
            {label}
          </Link>
        );
      })}
    </>
  );

  const UserSection = () => (
    <div className="px-3 py-3 border-t border-border space-y-2">
      {user && (
        <div className="flex items-center gap-2.5 px-1 py-1.5">
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
                <span className="text-[10px] text-muted-foreground/60">
                  오늘 {Math.max(0, credits.dailyLimit - credits.dailyUsed)}회 남음
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <Link
        href="/about"
        onClick={() => {}}
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
          location === "/about"
            ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        <Info className="w-3.5 h-3.5 shrink-0" />
        애빛다 소개
      </Link>

      <Link
        href="/settings"
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
          location === "/settings"
            ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        <Settings className="w-3.5 h-3.5 shrink-0" />
        설정
      </Link>

      {user ? (
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          로그아웃
        </button>
      ) : user === null ? (
        <Link
          href="/login"
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
            location === "/login"
              ? "bg-[#FF8A7A]/12 text-[#FF8A7A] font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
        >
          <LogIn className="w-3.5 h-3.5 shrink-0" />
          로그인
        </Link>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside className="w-52 shrink-0 flex-col z-20 hidden md:flex print:hidden border-r border-border bg-background">
        {/* Logo */}
        <div className="px-5 h-14 flex items-center border-b border-border">
          <Link href="/analysis/new" className="block group">
            <span
              className="text-[22px] font-black tracking-tighter leading-none select-none transition-opacity group-hover:opacity-80"
              style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900, color: "#FF8A7A" }}
            >
              애빛다
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          <NavLinks />
          {isAdmin && (
            <div className="pt-4">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">관리자</p>
              {ADMIN_ITEMS.map(item => {
                const isActive = location === item.href || location.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
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

        <UserSection />

        {/* Slogan */}
        <div className="px-5 py-2.5 border-t border-border">
          <p className="text-[10px] text-muted-foreground/40 leading-relaxed tracking-wide">
            AI로 기업가치를 밝히다
          </p>
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
                <NavLinks onSelect={() => setMenuOpen(false)} />
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
                          <span className="text-[10px] text-muted-foreground/60">오늘 {Math.max(0, credits.dailyLimit - credits.dailyUsed)}회 남음</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <Link href="/about" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Info className="w-3.5 h-3.5" /> 애빛다 소개
                </Link>
                <Link href="/settings" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Settings className="w-3.5 h-3.5" /> 설정
                </Link>
                {user ? (
                  <button onClick={() => { setMenuOpen(false); logout(); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <LogOut className="w-3.5 h-3.5" /> 로그아웃
                  </button>
                ) : user === null ? (
                  <Link href="/login" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <LogIn className="w-3.5 h-3.5" /> 로그인
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
          <button
            onClick={() => setMenuOpen(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
          >
            <Menu className="w-5 h-5" />
          </button>
        </header>

        <NoticeBanner settings={notice} />
        <MarketBar />

        {/* Scrollable Content */}
        <div id="print-scroll" className="flex-1 overflow-y-auto">
          <div className="container max-w-5xl mx-auto p-4 md:p-10 animate-fade-in">
            {children}
          </div>

          {/* Footer */}
          <footer className="border-t border-border mt-8 print:hidden">
            <div className="container max-w-5xl mx-auto px-6 md:px-10 py-6">
              <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground mb-4">
                <Link href="/privacy" className="hover:text-foreground transition-colors">개인정보처리방침</Link>
                <span className="text-border select-none">|</span>
                <Link href="/terms" className="hover:text-foreground transition-colors">이용약관</Link>
                <span className="text-border select-none">|</span>
                <Link href="/notices" className="hover:text-foreground transition-colors">공지사항</Link>
                <span className="text-border select-none">|</span>
                <Link href="/disclaimer" className="hover:text-foreground transition-colors">투자유의사항</Link>
                <span className="text-border select-none">|</span>
                <Link href="/support" className="hover:text-foreground transition-colors">고객센터</Link>
              </nav>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                애빛다의 모든 콘텐츠는 AI가 자동 생성한 참고용 정보이며, 특정 금융투자상품의 매수·매도·보유를 권유하거나 추천하지 않습니다. 투자 판단의 최종 책임은 투자자 본인에게 있습니다.
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
                본 서비스는 자본시장법상 투자자문업·투자일임업에 해당하지 않으며, 인공지능 기본법에 따라 AI 생성 콘텐츠임을 고지합니다.
              </p>
              <p className="text-[11px] text-muted-foreground/50 mt-1.5">
                © {new Date().getFullYear()} 애빛다 · CBST. AI로 기업가치를 밝히다.
              </p>
            </div>
          </footer>
        </div>

      </main>
    </div>
  );
}
