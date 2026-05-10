import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Clock, TrendingUp, X, ArrowRight } from "lucide-react";
import { getApiUrl, cn } from "@/lib/utils";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("open-command-palette"));
}

interface AnalysisItem {
  id: number;
  ticker: string;
  companyName: string;
  investmentVerdict: string | null;
  createdAt: string;
}

function toKoreanVerdict(verdict: string | null | undefined): string {
  if (!verdict) return "분석 중";
  const s = verdict.toLowerCase();
  if (s.includes("strong buy")) return "높은 상승여력";
  if (s.includes("buy")) return "상승여력";
  if (s.includes("strong sell")) return "높은 하락여지";
  if (s.includes("sell")) return "하락여지";
  return "적정 수준";
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AnalysisItem[]>([]);
  const [recent, setRecent] = useState<AnalysisItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const customHandler = () => setOpen(true);
    window.addEventListener("keydown", handler);
    window.addEventListener("open-command-palette", customHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("open-command-palette", customHandler);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch(getApiUrl("/api/analysis?limit=6"), { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => setRecent(Array.isArray(d) ? d.slice(0, 6) : []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setSelectedIdx(0); return; }
    const t = setTimeout(() => {
      fetch(getApiUrl(`/api/analysis?search=${encodeURIComponent(query)}&limit=8`), { credentials: "include" })
        .then(r => r.ok ? r.json() : [])
        .then(d => { setResults(Array.isArray(d) ? d : []); setSelectedIdx(0); })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
      setSelectedIdx(0);
    }
  }, [open]);

  const displayed = query.trim() ? results : recent;

  const handleSelect = (id: number) => {
    navigate(`/analysis/${id}`);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, displayed.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && displayed[selectedIdx]) { handleSelect(displayed[selectedIdx].id); }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
            onClick={() => setOpen(false)}
          />
          <motion.div
            key="palette"
            initial={{ opacity: 0, scale: 0.97, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -10 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed top-[14vh] left-1/2 -translate-x-1/2 w-full max-w-lg z-[101] px-4"
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="종목명 또는 티커로 검색..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {displayed.length > 0 ? (
                <div className="py-1 max-h-[360px] overflow-y-auto scrollbar-none">
                  <p className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {query.trim() ? "검색 결과" : "최근 분석"}
                  </p>
                  {displayed.map((item, i) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left group",
                        i === selectedIdx ? "bg-muted/80" : "hover:bg-muted/40"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                        i === selectedIdx ? "bg-primary/20" : "bg-primary/10"
                      )}>
                        {query.trim() ? (
                          <TrendingUp className="w-3.5 h-3.5 text-primary" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground shrink-0">{item.ticker}</span>
                          <span className="text-sm font-medium text-foreground truncate">{item.companyName}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {new Date(item.createdAt).toLocaleDateString("ko-KR")} · {toKoreanVerdict(item.investmentVerdict)}
                        </p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  ))}
                </div>
              ) : query.trim() ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다</div>
              ) : (
                <div className="px-4 py-8 text-center">
                  <Search className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">종목명 또는 티커를 입력하세요</p>
                </div>
              )}

              <div className="px-4 py-2.5 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground/50">
                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-muted border border-border/60 font-mono">↑↓</kbd> 선택</span>
                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-muted border border-border/60 font-mono">↵</kbd> 이동</span>
                <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-muted border border-border/60 font-mono">esc</kbd> 닫기</span>
                <span className="ml-auto flex items-center gap-1 text-muted-foreground/40">
                  <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/60 font-mono text-[9px]">⌘K</kbd>
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
