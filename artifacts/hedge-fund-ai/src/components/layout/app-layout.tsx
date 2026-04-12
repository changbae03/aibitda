import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  BrainCircuit, 
  Menu,
  Newspaper,
  FileText,
  LogIn,
  LogOut,
  User
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, useLogout, getKakaoLoginUrl } from "@/lib/auth";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const { data: authData } = useAuth();
  const logoutMutation = useLogout();
  const user = authData?.user ?? null;

  const navItems = [
    { href: "/analysis/new", label: "AI 기업분석", icon: BrainCircuit },
    { href: "/reports", label: "투자 아이디어", icon: FileText },
    { href: "/news", label: "CBST 큐레이션", icon: Newspaper },
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

        {/* User / Login area */}
        <div className="p-3 mt-auto border-t border-white/10">
          {user ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 px-3 py-2">
                {user.profileImage ? (
                  <img src={user.profileImage} alt={user.nickname} className="w-6 h-6 rounded-full object-cover" />
                ) : (
                  <User className="w-4 h-4 text-white/50" />
                )}
                <span className="text-sm text-white/80 truncate">{user.nickname}</span>
              </div>
              <button
                onClick={() => logoutMutation.mutate()}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-white/50 hover:text-white hover:bg-white/8 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                로그아웃
              </button>
            </div>
          ) : (
            <a
              href={getKakaoLoginUrl()}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-semibold rounded-lg transition-colors"
              style={{ background: "#FEE500", color: "#191919" }}
            >
              <img 
                src="https://developers.kakao.com/assets/img/about/logos/kakaolink/kakaolink_btn_small.png"
                alt="카카오"
                className="w-5 h-5 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              카카오로 로그인
            </a>
          )}
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
          <div className="flex items-center gap-2">
            {user ? (
              <button
                onClick={() => logoutMutation.mutate()}
                className="p-2 text-muted-foreground"
              >
                <LogOut className="w-5 h-5" />
              </button>
            ) : (
              <a href={getKakaoLoginUrl()} className="p-2">
                <LogIn className="w-5 h-5 text-muted-foreground" />
              </a>
            )}
            <button className="p-2 text-muted-foreground">
              <Menu className="w-5 h-5" />
            </button>
          </div>
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
