import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, Search, ChevronRight, X,
  Zap, TrendingUp, RotateCcw, Plus, Minus, History,
  ArrowLeft, ArrowRight, User, Crown, FileText, ExternalLink, BarChart2, Star,
  Download, SlidersHorizontal, Users, Activity, UserCheck,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface AdminStats {
  totals?: { users: number; analyses: number; todayAnalyses: number };
  activeUsersByDay?: { day: string; count: number }[];
  tierCounts?: { free?: number; beta?: number; premium?: number };
}

function StatsBadge({ label, value, icon: Icon, accent }: { label: string; value: string | number; icon: React.ElementType; accent?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-muted/40 border border-border/60 min-w-0">
      <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", accent ?? "bg-primary/10")}>
        <Icon className={cn("w-3.5 h-3.5", accent ? "text-white" : "text-primary")} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground font-medium leading-none mb-0.5">{label}</p>
        <p className="text-sm font-bold text-foreground tabular-nums truncate">{value}</p>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border/50">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 rounded bg-muted/60 animate-pulse" style={{ width: `${40 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

interface UserDetail {
  user: {
    user_id: string;
    daily_limit: number;
    daily_used: number;
    bonus_credits: number;
    total_analyses: number;
    tier: string;
    admin_memo: string;
    display_name: string | null;
    email: string | null;
    created_at: string | null;
  };
  topTickers: Array<{ ticker: string; company_name: string | null; cnt: number; last_verdict: string | null; last_at: string }>;
  recentAnalyses: Array<{ id: number; ticker: string; company_name: string | null; investment_verdict: string | null; target_price: number | null; created_at: string }>;
  activityByDay: Array<{ day: string; cnt: number }>;
}

function UserDetailModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(getApiUrl(`/api/admin/user-detail/${encodeURIComponent(userId)}`), { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [userId]);

  const VERDICT_COLOR: Record<string, string> = {
    "Strong Buy": "text-emerald-600", "Buy": "text-green-600",
    "Hold": "text-amber-600", "Sell": "text-orange-500", "Strong Sell": "text-red-500",
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-background border border-border rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <span className="font-bold text-sm">유저 상세 프로필</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          {loading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground text-center py-8">데이터를 불러오지 못했습니다</p>
          ) : (
            <>
              {/* 기본 정보 */}
              <div className="rounded-xl bg-muted/30 p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">기본 정보</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><p className="text-xs text-muted-foreground">닉네임</p><p className="font-semibold">{data.user.display_name ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">등급</p><p className="font-semibold capitalize">{data.user.tier}</p></div>
                  <div className="col-span-2"><p className="text-xs text-muted-foreground">이메일</p><p className="font-semibold truncate">{data.user.email ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">전체 분석 수</p><p className="font-semibold tabular-nums">{Number(data.user.total_analyses).toLocaleString()}건</p></div>
                  <div><p className="text-xs text-muted-foreground">가입일</p><p className="font-semibold">{data.user.created_at ? new Date(data.user.created_at).toLocaleDateString("ko-KR") : "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">보너스 크레딧</p><p className="font-semibold tabular-nums">{data.user.bonus_credits}</p></div>
                  <div><p className="text-xs text-muted-foreground">오늘 사용</p><p className="font-semibold tabular-nums">{data.user.daily_used} / {data.user.daily_limit}</p></div>
                </div>
              </div>

              {/* 최다 분석 종목 */}
              {data.topTickers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <Star className="w-3.5 h-3.5" /> 자주 분석한 종목
                  </div>
                  <div className="space-y-1.5">
                    {data.topTickers.map(t => (
                      <div key={t.ticker} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 text-sm">
                        <div>
                          <span className="font-semibold">{t.company_name ?? t.ticker}</span>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{t.ticker.replace(/\.(KS|KQ)$/,"")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {t.last_verdict && (
                            <span className={cn("text-xs font-semibold", VERDICT_COLOR[t.last_verdict] ?? "text-foreground")}>{t.last_verdict}</span>
                          )}
                          <span className="text-xs text-muted-foreground">{t.cnt}회</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 최근 분석 */}
              {data.recentAnalyses.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <BarChart2 className="w-3.5 h-3.5" /> 최근 분석 리포트
                  </div>
                  <div className="space-y-1.5">
                    {data.recentAnalyses.map(a => (
                      <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 text-sm">
                        <div>
                          <span className="font-semibold">{a.company_name ?? a.ticker}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString("ko-KR")}</span>
                        </div>
                        {a.investment_verdict && (
                          <span className={cn("text-xs font-semibold", VERDICT_COLOR[a.investment_verdict] ?? "text-foreground")}>{a.investment_verdict}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 30일 활동 */}
              {data.activityByDay.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">최근 30일 활동</p>
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: 30 }, (_, i) => {
                      const d = new Date();
                      d.setDate(d.getDate() - (29 - i));
                      const key = d.toISOString().slice(0, 10);
                      const found = data.activityByDay.find(a => String(a.day).slice(0, 10) === key);
                      const n = found ? Number(found.cnt) : 0;
                      return (
                        <div
                          key={key}
                          title={`${key}: ${n}건`}
                          className={cn("w-4 h-4 rounded-sm", n >= 5 ? "bg-emerald-500" : n >= 3 ? "bg-emerald-300" : n >= 1 ? "bg-emerald-100" : "bg-muted/50")}
                        />
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground">밝을수록 분석 많음</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface UserRow {
  userId: string;
  dailyUsed: number;
  dailyLimit: number;
  bonusCredits: number;
  totalAnalyses: number;
  recentAnalyses: number;
  tier: string;
  adminMemo: string;
  displayName: string | null;
  email: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  lastActivity: string | null;
}

function isInactive(lastActivity: string | null, createdAt: string | null): boolean {
  const ref = lastActivity ?? createdAt;
  if (!ref) return false;
  return Date.now() - new Date(ref).getTime() > 7 * 24 * 60 * 60 * 1000;
}

const TIER_CONFIG: Record<string, { label: string; color: string; limit: number }> = {
  free:    { label: "무료",    color: "text-slate-600 bg-slate-100 border-slate-200", limit: 3 },
  beta:    { label: "베타",    color: "text-blue-600 bg-blue-50 border-blue-200",     limit: 10 },
  premium: { label: "프리미엄", color: "text-amber-600 bg-amber-50 border-amber-200", limit: 50 },
};

interface AnalysisRow {
  id: number;
  ticker: string;
  companyName: string | null;
  status: string;
  verdict: string | null;
  targetPrice: number | null;
  startPrice: number | null;
  createdAt: string;
}

const VERDICT_LABEL: Record<string, { label: string; color: string }> = {
  "Strong Buy": { label: "높은 상승여력", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  "Buy":        { label: "상승여력",      color: "text-green-600 bg-green-50 border-green-200" },
  "Hold":       { label: "적정 수준",     color: "text-amber-600 bg-amber-50 border-amber-200" },
  "Sell":       { label: "하락여지",      color: "text-orange-600 bg-orange-50 border-orange-200" },
  "Strong Sell":{ label: "높은 하락여지", color: "text-red-600 bg-red-50 border-red-200" },
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function shortId(id: string) {
  if (id.length <= 20) return id;
  return id.slice(0, 10) + "…" + id.slice(-6);
}

function CreditBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-red-400" : pct >= 66 ? "bg-amber-400" : "bg-emerald-400")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("text-xs font-mono tabular-nums", pct >= 100 ? "text-red-500" : "text-muted-foreground")}>
        {used}/{limit}
      </span>
    </div>
  );
}

export default function AdminUserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created_at");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    fetch(getApiUrl("/api/admin/stats"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => {});
  }, []);

  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [analysesTotal, setAnalysesTotal] = useState(0);
  const [analysesPage, setAnalysesPage] = useState(1);
  const [analysesLoading, setAnalysesLoading] = useState(false);

  const [creditDelta, setCreditDelta] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditLoading, setCreditLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [tierLoading, setTierLoading] = useState(false);
  const [memoText, setMemoText] = useState("");
  const [memoLoading, setMemoLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const limit = 50;
  const totalPages = Math.ceil(total / limit);

  const loadUsers = useCallback(async (p: number, s: string, tier: string, sort: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), sortBy: sort });
      if (s) params.set("search", s);
      if (tier && tier !== "all") params.set("tier", tier);
      const r = await fetch(getApiUrl(`/api/admin/user-list?${params}`), { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setUsers(d.users);
        setTotal(d.total);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/user-list/export"), { credentials: "include" });
      if (!r.ok) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `users_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const loadAnalyses = useCallback(async (userId: string, p: number) => {
    setAnalysesLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/admin/user-list/${encodeURIComponent(userId)}/analyses?page=${p}`), { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setAnalyses(d.analyses);
        setAnalysesTotal(d.total);
      }
    } finally {
      setAnalysesLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(page, search, tierFilter, sortBy); }, [page, search, tierFilter, sortBy, loadUsers]);

  useEffect(() => {
    if (!selected) return;
    setAnalysesPage(1);
    loadAnalyses(selected.userId, 1);
    setMemoText(selected.adminMemo ?? "");
  }, [selected, loadAnalyses]);

  useEffect(() => {
    if (!selected) return;
    loadAnalyses(selected.userId, analysesPage);
  }, [analysesPage, selected, loadAnalyses]);

  const handleSearchChange = (v: string) => {
    setSearchInput(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(v);
      setPage(1);
    }, 400);
  };

  const handleTierChange = (t: string) => {
    setTierFilter(t);
    setPage(1);
    setSelected(null);
  };

  const handleSortChange = (s: string) => {
    setSortBy(s);
    setPage(1);
  };

  const showMsg = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const adjustCredits = async () => {
    if (!selected || !creditDelta.trim()) return;
    const delta = parseInt(creditDelta, 10);
    if (isNaN(delta) || delta === 0) return;
    setCreditLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/admin/user-list/${encodeURIComponent(selected.userId)}/credits`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta, reason: creditReason }),
      });
      const d = await r.json();
      if (r.ok) {
        showMsg("ok", `보너스 크레딧 조정 완료 → ${d.newBonusCredits}개`);
        setSelected(prev => prev ? { ...prev, bonusCredits: d.newBonusCredits } : prev);
        setUsers(prev => prev.map(u => u.userId === selected.userId ? { ...u, bonusCredits: d.newBonusCredits } : u));
        setCreditDelta("");
        setCreditReason("");
      } else {
        showMsg("err", d.error ?? "조정 실패");
      }
    } finally {
      setCreditLoading(false);
    }
  };

  const resetDaily = async () => {
    if (!selected) return;
    setResetLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/admin/user-list/${encodeURIComponent(selected.userId)}/daily-reset`), {
        method: "POST",
        credentials: "include",
      });
      if (r.ok) {
        showMsg("ok", "일일 크레딧 초기화 완료");
        setSelected(prev => prev ? { ...prev, dailyUsed: 0 } : prev);
        setUsers(prev => prev.map(u => u.userId === selected.userId ? { ...u, dailyUsed: 0 } : u));
      } else {
        showMsg("err", "초기화 실패");
      }
    } finally {
      setResetLoading(false);
    }
  };

  const changeTier = async (tier: string) => {
    if (!selected) return;
    setTierLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/admin/user-list/${encodeURIComponent(selected.userId)}/tier`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const d = await r.json();
      if (r.ok) {
        showMsg("ok", `등급 → ${tier} (한도 ${d.dailyLimit}회/일)`);
        setSelected(prev => prev ? { ...prev, tier, dailyLimit: d.dailyLimit } : prev);
        setUsers(prev => prev.map(u => u.userId === selected.userId ? { ...u, tier, dailyLimit: d.dailyLimit } : u));
      } else {
        showMsg("err", d.error ?? "변경 실패");
      }
    } finally {
      setTierLoading(false);
    }
  };

  const saveMemo = async () => {
    if (!selected) return;
    setMemoLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/admin/user-list/${encodeURIComponent(selected.userId)}/memo`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: memoText }),
      });
      if (r.ok) {
        showMsg("ok", "메모 저장 완료");
        setSelected(prev => prev ? { ...prev, adminMemo: memoText } : prev);
        setUsers(prev => prev.map(u => u.userId === selected.userId ? { ...u, adminMemo: memoText } : u));
      } else {
        showMsg("err", "저장 실패");
      }
    } finally {
      setMemoLoading(false);
    }
  };

  return (
    <>
    <div className="flex h-full min-h-[calc(100vh-4rem)]">
      {/* ── 왼쪽: 유저 목록 ── */}
      <div className={cn(
        "flex flex-col border-r border-border transition-all",
        selected ? "hidden md:flex md:w-[55%] md:min-w-0" : "w-full"
      )}>
        <div className="px-5 py-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-foreground">유저 관리</h1>
              <p className="text-xs text-muted-foreground mt-0.5">총 {total.toLocaleString()}명의 유저</p>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              CSV
            </button>
          </div>

          {/* 통계 바 */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatsBadge
                label="전체 유저"
                value={(stats.totals?.users ?? total).toLocaleString() + "명"}
                icon={Users}
              />
              <StatsBadge
                label="7일 활성"
                value={(stats.activeUsersByDay?.reduce((s, d) => s + d.count, 0) ?? 0).toLocaleString() + "명"}
                icon={Activity}
              />
              <StatsBadge
                label="유료 유저"
                value={((stats.tierCounts?.beta ?? 0) + (stats.tierCounts?.premium ?? 0)).toLocaleString() + "명"}
                icon={UserCheck}
                accent="bg-amber-500"
              />
              <StatsBadge
                label="프리미엄"
                value={(stats.tierCounts?.premium ?? 0).toLocaleString() + "명"}
                icon={Crown}
                accent="bg-[#FF8A7A]"
              />
            </div>
          )}

          {/* 검색 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
            <input
              type="text"
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="닉네임, 이메일, 유저 ID 검색..."
              className="w-full pl-8 pr-3 py-2 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* 티어 필터 탭 + 정렬 */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1">
              {([
                { key: "all", label: "전체" },
                { key: "free", label: "무료" },
                { key: "beta", label: "베타" },
                { key: "premium", label: "프리미엄" },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => handleTierChange(key)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] rounded-md border transition-colors font-medium",
                    tierFilter === key
                      ? "bg-primary text-white border-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >{label}</button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <SlidersHorizontal className="w-3 h-3" />
              <select
                value={sortBy}
                onChange={e => handleSortChange(e.target.value)}
                className="text-[11px] bg-transparent border-none outline-none cursor-pointer"
              >
                <option value="created_at">최근 가입</option>
                <option value="total_analyses">분석 많은</option>
                <option value="recent_analyses">7일 활성</option>
                <option value="last_activity">최근 활동</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-auto flex-1">
          {loading ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">유저</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">등급</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">마지막 활동</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">총</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">7일</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">오늘</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>{[...Array(8)].map((_, i) => <SkeletonRow key={i} />)}</tbody>
            </table>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">유저가 없습니다</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">유저</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">등급</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">마지막 활동</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">총</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">7일</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">오늘</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const inactive = isInactive(u.lastActivity, u.createdAt);
                  return (
                    <tr
                      key={u.userId}
                      onClick={() => setSelected(prev => prev?.userId === u.userId ? null : u)}
                      className={cn(
                        "border-b border-border/50 cursor-pointer transition-colors",
                        selected?.userId === u.userId
                          ? "bg-primary/5 border-l-2 border-l-primary"
                          : "hover:bg-muted/40",
                        inactive && selected?.userId !== u.userId && "opacity-50"
                      )}
                    >
                      <td className="px-4 py-2.5">
                        {u.displayName && (
                          <p className="text-[12px] font-semibold text-foreground">{u.displayName}</p>
                        )}
                        {u.email && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{u.email}</p>
                        )}
                        <span className="font-mono text-[10px] text-muted-foreground/60">{shortId(u.userId)}</span>
                        {u.adminMemo && <span className="ml-1.5 text-[10px] text-amber-500" title={u.adminMemo}>📝</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {(() => {
                          const t = TIER_CONFIG[u.tier ?? "free"] ?? TIER_CONFIG.free;
                          return <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", t.color)}>{t.label}</span>;
                        })()}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                        {u.lastActivity ? fmt(u.lastActivity) : <span className="text-muted-foreground/40">없음</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-sm font-semibold text-foreground tabular-nums">{u.totalAnalyses}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={cn("text-xs tabular-nums", u.recentAnalyses > 0 ? "text-blue-600 font-medium" : "text-muted-foreground")}>
                          {u.recentAnalyses}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 hidden sm:table-cell">
                        <CreditBar used={u.dailyUsed} limit={u.dailyLimit} />
                      </td>
                      <td className="pr-3">
                        <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground/40 transition-transform", selected?.userId === u.userId && "rotate-90")} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
            <span>{page} / {totalPages} 페이지</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-muted disabled:opacity-30">
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-muted disabled:opacity-30">
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 오른쪽: 유저 상세 (데스크톱 사이드패널 + 모바일 full-screen 오버레이) ── */}
      {selected && (
        <div className={cn(
          "flex flex-col bg-background",
          "fixed inset-0 z-40",
          "md:static md:flex-1 md:overflow-hidden md:z-auto"
        )}>
          {/* 헤더 */}
          <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  {selected.displayName && (
                    <p className="text-sm font-semibold text-foreground">{selected.displayName}</p>
                  )}
                  <p className="text-xs font-mono text-muted-foreground truncate">{selected.userId}</p>
                  {selected.email && (
                    <p className="text-xs text-muted-foreground truncate">{selected.email}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>가입 {fmt(selected.createdAt)}</span>
                {selected.lastLoginAt && <span>로그인 {fmt(selected.lastLoginAt)}</span>}
                <span>총 분석 <strong className="text-foreground">{selected.totalAnalyses}</strong>회</span>
                <span>7일 <strong className="text-foreground">{selected.recentAnalyses}</strong>회</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowDetailModal(true)}
                className="px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent transition-colors flex items-center gap-1"
              >
                <User className="w-3 h-3" /> 상세 프로필
              </button>
              {/* 모바일: 뒤로가기, 데스크톱: 닫기(X) */}
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0 flex items-center gap-1">
                <span className="md:hidden">
                  <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                </span>
                <span className="hidden md:inline">
                  <X className="w-4 h-4 text-muted-foreground" />
                </span>
              </button>
            </div>
          </div>

          <div className="overflow-auto flex-1 px-5 py-4 space-y-5">
            {/* 피드백 */}
            {msg && (
              <div className={cn("text-sm rounded-xl px-4 py-2.5 border", msg.type === "ok"
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-red-50 text-red-600 border-red-200"
              )}>{msg.text}</div>
            )}

            {/* 크레딧 현황 */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" /> 크레딧 현황
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "오늘 사용", value: `${selected.dailyUsed} / ${selected.dailyLimit}`, highlight: selected.dailyUsed >= selected.dailyLimit },
                  { label: "보너스", value: String(selected.bonusCredits), highlight: false },
                  { label: "총 잔여", value: String(Math.max(0, selected.dailyLimit - selected.dailyUsed) + selected.bonusCredits), highlight: false },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
                    <p className={cn("text-lg font-bold tabular-nums", highlight ? "text-red-500" : "text-foreground")}>{value}</p>
                  </div>
                ))}
              </div>

              {/* 일일 초기화 */}
              <button
                onClick={resetDaily}
                disabled={resetLoading || selected.dailyUsed === 0}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
              >
                {resetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                오늘 사용량 초기화
              </button>
            </div>

            {/* 보너스 크레딧 조정 */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> 보너스 크레딧 조정
              </p>
              <div className="flex gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCreditDelta(v => v.startsWith("-") ? v.slice(1) : v ? "-" + v : "-1")}
                    className="px-2.5 py-2 hover:bg-muted text-muted-foreground text-xs"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    value={creditDelta}
                    onChange={e => setCreditDelta(e.target.value)}
                    placeholder="0"
                    className="w-16 text-center text-sm font-mono bg-transparent border-none outline-none py-2 tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => setCreditDelta(v => v.startsWith("-") ? v.slice(1) : v)}
                    className="px-2.5 py-2 hover:bg-muted text-muted-foreground text-xs"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <input
                  type="text"
                  value={creditReason}
                  onChange={e => setCreditReason(e.target.value)}
                  placeholder="사유 (선택)"
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={adjustCredits}
                  disabled={creditLoading || !creditDelta.trim() || creditDelta === "0"}
                  className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  {creditLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  적용
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">양수: 지급, 음수: 차감. 0 미만으로 내려가지 않습니다.</p>
            </div>

            {/* 유저 등급 */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5" /> 유저 등급
              </p>
              <div className="flex flex-wrap gap-2">
                {(["free", "beta", "premium"] as const).map(t => {
                  const cfg = TIER_CONFIG[t];
                  const isActive = (selected.tier ?? "free") === t;
                  return (
                    <button
                      key={t}
                      onClick={() => changeTier(t)}
                      disabled={tierLoading || isActive}
                      className={cn(
                        "px-3 py-1.5 text-xs rounded-lg border transition-all flex items-center gap-1.5 disabled:cursor-default",
                        isActive ? cfg.color + " font-semibold" : "border-border text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {tierLoading && isActive && <Loader2 className="w-3 h-3 animate-spin" />}
                      {cfg.label}
                      <span className="opacity-60">({cfg.limit}회/일)</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 관리자 메모 */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> 관리자 메모
              </p>
              <textarea
                value={memoText}
                onChange={e => setMemoText(e.target.value)}
                placeholder="이 유저에 대한 내부 메모 (유저에게 보이지 않습니다)"
                rows={3}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
              <button
                onClick={saveMemo}
                disabled={memoLoading}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-primary text-primary hover:bg-primary/5 transition-colors disabled:opacity-40"
              >
                {memoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                메모 저장
              </button>
            </div>

            {/* 분석 이력 */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" /> 분석 이력 ({analysesTotal}건)
                </p>
                {Math.ceil(analysesTotal / 20) > 1 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <button onClick={() => setAnalysesPage(p => Math.max(1, p - 1))} disabled={analysesPage <= 1} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <span>{analysesPage} / {Math.ceil(analysesTotal / 20)}</span>
                    <button onClick={() => setAnalysesPage(p => p + 1)} disabled={analysesPage >= Math.ceil(analysesTotal / 20)} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {analysesLoading ? (
                <div className="flex items-center justify-center h-24 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> 불러오는 중…
                </div>
              ) : analyses.length === 0 ? (
                <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">분석 이력 없음</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/10">
                      <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">종목</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">판정</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">일시</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {analyses.map(a => {
                      const v = a.verdict ? VERDICT_LABEL[a.verdict] : null;
                      return (
                        <tr key={a.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2.5">
                            <span className="font-mono text-[12px] font-semibold text-foreground">{a.ticker}</span>
                            {a.companyName && <span className="ml-1.5 text-xs text-muted-foreground">{a.companyName}</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            {v ? (
                              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", v.color)}>{v.label}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">{a.status}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[11px] text-muted-foreground whitespace-nowrap">{fmt(a.createdAt)}</td>
                          <td className="pr-3 py-2.5 text-right">
                            <a
                              href={getApiUrl(`/analysis/${a.id}`)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="보고서 보기"
                              className="inline-flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary px-1.5 py-1 rounded hover:bg-primary/5 transition-colors"
                              onClick={e => e.stopPropagation()}
                            >
                              <ExternalLink className="w-3 h-3" />
                              보기
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

    </div>

    {/* 유저 상세 프로필 모달 */}
    {showDetailModal && selected && (
      <UserDetailModal userId={selected.userId} onClose={() => setShowDetailModal(false)} />
    )}
    </>
  );
}
