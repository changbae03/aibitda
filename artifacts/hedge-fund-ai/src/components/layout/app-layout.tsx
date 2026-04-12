import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  BrainCircuit,
  Menu,
  X,
  Newspaper,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { href: "/analysis/new", label: "AI 기업분석", icon: BrainCircuit },
    { href: "/reports", label: "투자 아이디어", icon: FileText },
    { href: "/news", label: "뉴스", icon: Newspaper },
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
            "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group font-medium text-sm",
            isActive
              ? "bg-white/15 text-white"
              : "text-white/55 hover:text-white hover:bg-white/8"
          )}
        >
          <item.icon
            className={cn(
              "w-4 h-4 shrink-0",
              isActive ? "text-white" : "text-white/50 group-hover:text-white"
            )}
          />
          {item.label}
        </Link>
      );
    });

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside
        className="w-64 flex-col z-20 hidden md:flex"
        style={{ background: "hsl(220, 45%, 18%)" }}
      >
        <div className="px-5 py-5 flex items-center gap-3 border-b border-white/10">
          <img
            src={`${import.meta.env.BASE_URL}images/cbst-logo-nobg.png`}
            alt="CBST Research"
            className="h-8 w-auto object-contain"
          />
          <div className="flex flex-col leading-tight">
            <span className="font-display font-bold text-[13px] tracking-tight text-white">
              CBST AI 리서치센터
            </span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-5 space-y-1">
          <div className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-3 px-3">
            메뉴
          </div>
          <NavLinks />
        </nav>
      </aside>

      {/* ── Mobile Drawer ── */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.45 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black z-40 md:hidden"
              onClick={() => setMenuOpen(false)}
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className="fixed left-0 top-0 h-full w-72 z-50 flex flex-col md:hidden"
              style={{ background: "hsl(220, 45%, 18%)" }}
            >
              <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <img
                    src={`${import.meta.env.BASE_URL}images/cbst-logo-nobg.png`}
                    alt="CBST"
                    className="h-7 w-auto object-contain"
                  />
                  <span className="font-display font-bold text-[13px] tracking-tight text-white">
                    CBST AI 리서치센터
                  </span>
                </div>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="p-2 text-white/50 hover:text-white transition-colors rounded-lg hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 px-3 py-5 space-y-1">
                <div className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-3 px-3">
                  메뉴
                </div>
                <NavLinks onSelect={() => setMenuOpen(false)} />
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-white z-30 sticky top-0 shrink-0">
          <div className="flex items-center gap-2">
            <img
              src={`${import.meta.env.BASE_URL}images/cbst-logo.png`}
              alt="CBST"
              className="h-7 w-auto object-contain"
            />
            <span className="font-display font-bold text-sm text-foreground">
              CBST AI 리서치센터
            </span>
          </div>
          <button
            onClick={() => setMenuOpen(true)}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted"
          >
            <Menu className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="container max-w-6xl mx-auto p-4 md:p-8 lg:p-10 animate-fade-in">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
