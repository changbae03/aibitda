import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Settings, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

interface AppLayoutProps {
  children: ReactNode;
}

const bottomItems = [
  { href: "/settings", label: "설정", icon: Settings },
  { href: "/login", label: "로그인", icon: LogIn },
];

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { href: "/analysis/new", label: "AI 기업분석" },
    { href: "/history", label: "내가 본 자료" },
  ];

  const NavLinks = ({ onSelect }: { onSelect?: () => void }) =>
    navItems.map((item) => {
      const isActive =
        location === item.href ||
        (item.href !== "/" && location.startsWith(item.href));
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onSelect}
          className={cn(
            "block px-3 py-2 rounded-md text-[13.5px] font-medium transition-colors duration-150",
            isActive
              ? "bg-neutral-100 text-neutral-900"
              : "text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50"
          )}
        >
          {item.label}
        </Link>
      );
    });

  const BottomNav = ({ onSelect }: { onSelect?: () => void }) => (
    <div className="px-2 py-3 space-y-0.5 border-t border-neutral-100">
      {bottomItems.map((item) => {
        const isActive = location === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onSelect}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors duration-150",
              isActive
                ? "bg-neutral-100 text-neutral-900"
                : "text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50"
            )}
          >
            <item.icon className="w-3.5 h-3.5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-white text-neutral-900 flex overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside className="w-52 shrink-0 flex-col z-20 hidden md:flex print:hidden border-r border-neutral-100">
        {/* Logo */}
        <div className="px-5 h-14 flex items-center border-b border-neutral-100">
          <Link href="/analysis/new" className="block">
            <span
              className="text-[22px] font-black tracking-tighter leading-none select-none"
              style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900, color: "#FF8A7A" }}
            >
              애빛다
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          <NavLinks />
        </nav>

        {/* Bottom Nav */}
        <BottomNav />

        {/* Slogan */}
        <div className="px-5 py-3 border-t border-neutral-100">
          <p className="text-[10px] text-neutral-300 leading-relaxed">
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
              animate={{ opacity: 0.3 }}
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
              className="fixed left-0 top-0 h-full w-64 z-50 flex flex-col md:hidden print:hidden bg-white border-r border-neutral-100"
            >
              <div className="px-5 h-14 flex items-center justify-between border-b border-neutral-100">
                <span
                  className="text-[22px] font-black tracking-tighter leading-none"
                  style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900, color: "#FF8A7A" }}
                >
                  애빛다
                </span>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="p-1.5 text-neutral-400 hover:text-neutral-700 transition-colors rounded-md hover:bg-neutral-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="flex-1 px-2 py-4 space-y-0.5">
                <NavLinks onSelect={() => setMenuOpen(false)} />
              </nav>
              <BottomNav onSelect={() => setMenuOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main Content ── */}
      <main id="print-main" className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Top Bar */}
        <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-neutral-100 bg-white z-30 sticky top-0 shrink-0 print:hidden">
          <span
            className="text-[20px] font-black tracking-tighter leading-none"
            style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900, color: "#FF8A7A" }}
          >
            애빛다
          </span>
          <button
            onClick={() => setMenuOpen(true)}
            className="p-1.5 text-neutral-400 hover:text-neutral-700 transition-colors rounded-md hover:bg-neutral-100"
          >
            <Menu className="w-5 h-5" />
          </button>
        </header>

        <div id="print-scroll" className="flex-1 overflow-y-auto">
          <div className="container max-w-5xl mx-auto p-4 md:p-10 animate-fade-in">
            {children}
          </div>

          {/* Footer */}
          <footer className="border-t border-neutral-100 mt-8 print:hidden">
            <div className="container max-w-5xl mx-auto px-6 md:px-10 py-6">
              <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-neutral-400 mb-4">
                <a href="#" className="hover:text-neutral-700 transition-colors">개인정보처리방침</a>
                <span className="text-neutral-200 select-none">|</span>
                <a href="#" className="hover:text-neutral-700 transition-colors">이용약관</a>
                <span className="text-neutral-200 select-none">|</span>
                <a href="#" className="hover:text-neutral-700 transition-colors">공지사항</a>
                <span className="text-neutral-200 select-none">|</span>
                <a href="#" className="hover:text-neutral-700 transition-colors">자주 묻는 질문</a>
                <span className="text-neutral-200 select-none">|</span>
                <a href="#" className="hover:text-neutral-700 transition-colors">투자 유의사항</a>
                <span className="text-neutral-200 select-none">|</span>
                <a href="#" className="hover:text-neutral-700 transition-colors">이용자권리 및 유의사항</a>
                <span className="text-neutral-200 select-none">|</span>
                <a href="#" className="hover:text-neutral-700 transition-colors">고객센터</a>
              </nav>
              <p className="text-[11px] text-neutral-300 leading-relaxed">
                애빛다에서 제공하는 투자 정보는 투자 판단을 위한 단순 참고용일 뿐, 투자 제안 및 권유, 종목 추천을 위해 작성된 것이 아닙니다.
              </p>
              <p className="text-[11px] text-neutral-300 mt-1">
                © {new Date().getFullYear()} 애빛다. AI로 기업가치를 밝히다.
              </p>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
