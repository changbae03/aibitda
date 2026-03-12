import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  BarChart2, 
  BrainCircuit, 
  Crosshair, 
  LayoutDashboard, 
  LogOut, 
  Settings,
  Menu
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/analysis/new", label: "New AI Analysis", icon: BrainCircuit },
    { href: "/hypotheses", label: "Hypothesis Tracker", icon: Crosshair },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 bg-card/30 backdrop-blur-xl flex flex-col z-20 hidden md:flex">
        <div className="p-6 flex items-center gap-3">
          <img 
            src={`${import.meta.env.BASE_URL}images/logo-mark.png`} 
            alt="Logo" 
            className="w-8 h-8 object-contain drop-shadow-[0_0_8px_rgba(255,215,0,0.5)]"
          />
          <span className="font-display font-bold text-lg tracking-wide text-white">
            QUANT<span className="text-primary">AI</span>
          </span>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4 px-2">
            Platform Menu
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 group font-medium text-sm",
                  isActive 
                    ? "bg-primary/10 text-primary shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]" 
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                )}
              >
                <item.icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", isActive ? "text-primary" : "")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto border-t border-white/5">
          <button className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 rounded-xl transition-colors">
            <Settings className="w-5 h-5" />
            Settings
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2 mt-1 text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-colors">
            <LogOut className="w-5 h-5" />
            Disconnect
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-white/5 bg-background/80 backdrop-blur-lg z-30">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}images/logo-mark.png`} alt="Logo" className="w-6 h-6" />
            <span className="font-display font-bold">QUANT<span className="text-primary">AI</span></span>
          </div>
          <button className="p-2 text-muted-foreground hover:text-white">
            <Menu className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto relative">
          {/* Abstract ambient background elements */}
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-accent/5 blur-[100px] pointer-events-none" />
          
          <div className="container max-w-6xl mx-auto p-4 md:p-8 lg:p-10 relative z-10 animate-fade-in">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
