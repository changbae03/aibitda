import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  BrainCircuit, 
  LayoutDashboard, 
  Settings,
  Menu,
  Sparkles,
  Newspaper
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { href: "/analysis/new", label: "AI 기업분석 시작", icon: BrainCircuit },
    { href: "/", label: "대시보드", icon: LayoutDashboard },
    { href: "/news", label: "CBST 레이더", icon: Newspaper },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
      {/* Sidebar — deep navy */}
      <aside className="w-64 flex flex-col z-20 hidden md:flex" style={{ background: "hsl(220, 45%, 18%)" }}>
        {/* Logo area */}
        <div className="px-5 py-5 flex items-center gap-3 border-b border-white/10">
          <img 
            src={`${import.meta.env.BASE_URL}images/cbst-logo-nobg.png`} 
            alt="CBST Research" 
            className="h-8 w-auto object-contain"
          />
          <div className="flex flex-col leading-tight">
            <span className="font-display font-bold text-[13px] tracking-tight text-white">CBST AI 리서치센터</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          <div className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-3 px-3">
            메뉴
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group font-medium text-sm",
                  isActive 
                    ? "bg-white/15 text-white" 
                    : "text-white/55 hover:text-white hover:bg-white/8"
                )}
              >
                <item.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-white" : "text-white/50 group-hover:text-white")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 mt-auto border-t border-white/10">
          <button className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-white/50 hover:text-white hover:bg-white/8 rounded-lg transition-colors">
            <Settings className="w-4 h-4" />
            설정
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-white z-30">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}images/cbst-logo.png`} alt="CBST" className="h-7 w-auto object-contain" />
            <span className="font-display font-bold text-sm text-foreground">CBST AI 리서치센터</span>
          </div>
          <button className="p-2 text-muted-foreground">
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
