import { useState, useEffect } from "react";
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";
import {
  Loader2, Users, BarChart2, Activity, Crown, RefreshCw, Bell, BellOff, Save,
  DollarSign, Cpu, TrendingUp, ArrowRight, Bot, CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface RevenueStats {
  tierCounts: Record<string, number>;
  mrrKrw: number;
  weeklySignups: Array<{ week: string; signups: number }>;
  tokenCosts: { tracked_analyses: number; total_tokens: number; total_cost_usd: number; avg_cost_usd: number };
  repeatUserCount: number;
  funnel?: { totalUsers: number; analyzedUsers: number; repeatUsers: number };
}

interface DayCount { day: string; count: number; }
interface StatsData {
  analysisByDay: DayCount[];
  usersByDay: DayCount[];
  activeUsersByDay: DayCount[];
  totals: { users: number; analyses: number; todayAnalyses: number };
  tierCounts: Record<string, number>;
}
interface Settings { [key: string]: string }

interface BatchItem {
  id: number;
  ticker: string;
  companyName: string;
  status: string;
  verdict: string | null;
  createdAt: string;
}
interface BatchStatus {
  lastRun: string | null;
  todayRan: boolean;
  lockActive: boolean;
  lockExpiresAt: string | null;
  todayStats: { total: number; completed: number; failed: number; running: number };
  todayItems: BatchItem[];
  history: { day: string; completed: number; failed: number; total: number }[];
  totalAutoAnalyses: number;
}

const TIER_LABEL: Record<string, { label: string; color: string }> = {
  free:    { label: "무료",    color: "text-slate-600 bg-slate-100 border-slate-200" },
  beta:    { label: "베타",    color: "text-blue-600 bg-blue-50 border-blue-200" },
  premium: { label: "프리미엄", color: "text-amber-600 bg-amber-50 border-amber-200" },
};

const TIER_LIMITS: Record<string, number> = { free: 3, beta: 10, premium: 50 };

function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtWeek(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}주`;
}

function StatCard({ icon: Icon, label, value, sub, highlight }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; highlight?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-4 flex items-start gap-3 bg-background", highlight ? "border-primary/30" : "border-border")}>
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", highlight ? "bg-primary/15" : "bg-primary/10")}>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">{typeof value === "number" ? value.toLocaleString() : value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{value.toLocaleString()}명 <span className="text-muted-foreground font-normal">({pct}%)</span></span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState<Settings>({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [globalLimitVal, setGlobalLimitVal] = useState("");
  const [globalLimitTier, setGlobalLimitTier] = useState("all");
  const [globalLimitLoading, setGlobalLimitLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [revenue, setRevenue] = useState<RevenueStats | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(true);

  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const [batchLoading, setBatchLoading] = useState(true);

  const showMsg = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const loadStats = async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/admin/stats?days=${days}`), { credentials: "include" });
      if (r.ok) setStats(await r.json());
    } finally { setLoading(false); }
  };

  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/settings"), { credentials: "include" });
      if (r.ok) setSettings(await r.json());
    } finally { setSettingsLoading(false); }
  };

  const loadRevenue = async () => {
    setRevenueLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/revenue-stats"), { credentials: "include" });
      if (r.ok) setRevenue(await r.json());
    } finally { setRevenueLoading(false); }
  };

  const loadBatch = async () => {
    setBatchLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/batch-status"), { credentials: "include" });
      if (r.ok) setBatch(await r.json());
    } finally { setBatchLoading(false); }
  };

  useEffect(() => { loadStats(); }, [days]);
  useEffect(() => { loadSettings(); loadRevenue(); loadBatch(); }, []);

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/settings"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (r.ok) showMsg("ok", "설정 저장 완료");
      else showMsg("err", "저장 실패");
    } finally { setSettingsSaving(false); }
  };

  const applyGlobalLimit = async () => {
    const limit = parseInt(globalLimitVal, 10);
    if (isNaN(limit) || limit < 0) { showMsg("err", "유효한 숫자를 입력하세요"); return; }
    setGlobalLimitLoading(true);
    try {
      const body: Record<string, unknown> = { limit };
      if (globalLimitTier !== "all") body.tier = globalLimitTier;
      const r = await fetch(getApiUrl("/api/admin/global-limit"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) showMsg("ok", `일일 한도 ${limit}회로 변경 완료 (${globalLimitTier === "all" ? "전체" : TIER_LABEL[globalLimitTier]?.label})`);
      else showMsg("err", "변경 실패");
    } finally { setGlobalLimitLoading(false); }
  };

  const merged = (() => {
    if (!stats) return [];
    const map: Record<string, { day: string; analyses: number; newUsers: number; activeUsers: number }> = {};
    for (const r of stats.analysisByDay) {
      const k = String(r.day).slice(0, 10);
      if (!map[k]) map[k] = { day: k, analyses: 0, newUsers: 0, activeUsers: 0 };
      map[k].analyses = r.count;
    }
    for (const r of stats.usersByDay) {
      const k = String(r.day).slice(0, 10);
      if (!map[k]) map[k] = { day: k, analyses: 0, newUsers: 0, activeUsers: 0 };
      map[k].newUsers = r.count;
    }
    for (const r of (stats.activeUsersByDay ?? [])) {
      const k = String(r.day).slice(0, 10);
      if (!map[k]) map[k] = { day: k, analyses: 0, newUsers: 0, activeUsers: 0 };
      map[k].activeUsers = r.count;
    }
    return Object.values(map).sort((a, b) => a.day.localeCompare(b.day)).map(d => ({ ...d, day: fmt(d.day) }));
  })();

  const weeklyData = (revenue?.weeklySignups ?? []).map(r => ({
    week: fmtWeek(String(r.week)),
    signups: parseInt(String(r.signups), 10),
  }));

  const noticeEnabled = settings.notice_enabled === "true";
  const funnel = revenue?.funnel;
  const totalUsers = stats?.totals.users ?? funnel?.totalUsers ?? 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">대시보드</h1>
          <p className="text-sm text-muted-foreground mt-0.5">사용량 현황 및 서비스 운영 설정</p>
        </div>
      </div>

      {msg && (
        <div className={cn("text-sm rounded-xl px-4 py-2.5 border", msg.type === "ok"
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-red-50 text-red-600 border-red-200"
        )}>{msg.text}</div>
      )}

      {/* ── 요약 카드 ── */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </div>
      ) : stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard icon={Users} label="전체 가입자" value={stats.totals.users} />
            <StatCard icon={Activity} label="오늘 분석" value={stats.totals.todayAnalyses} highlight />
            <StatCard icon={BarChart2} label="전체 분석" value={stats.totals.analyses} />
          </div>

          {/* ── 유저 퍼널 ── */}
          {!revenueLoading && funnel && (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">유저 활성 퍼널</p>
              </div>
              <div className="space-y-3">
                <FunnelBar label="가입" value={funnel.totalUsers} max={funnel.totalUsers} color="bg-slate-400" />
                <div className="flex items-center gap-1.5 text-muted-foreground/40">
                  <ArrowRight className="w-3 h-3" />
                </div>
                <FunnelBar label="첫 분석 완료" value={funnel.analyzedUsers} max={funnel.totalUsers} color="bg-blue-400" />
                <div className="flex items-center gap-1.5 text-muted-foreground/40">
                  <ArrowRight className="w-3 h-3" />
                </div>
                <FunnelBar label="재방문 (2회+)" value={funnel.repeatUsers} max={funnel.totalUsers} color="bg-primary" />
              </div>
            </div>
          )}

          {/* 등급 분포 */}
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">유저 등급 분포</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              {(["free", "beta", "premium"] as const).map(t => {
                const cnt = stats.tierCounts[t] ?? 0;
                const total = stats.totals.users || 1;
                const pct = Math.round((cnt / total) * 100);
                const s = TIER_LABEL[t];
                return (
                  <div key={t} className={cn("rounded-lg border px-3 py-2 min-w-[100px]", s.color)}>
                    <p className="text-[10px] font-medium mb-0.5">{s.label}</p>
                    <p className="text-xl font-bold tabular-nums">{cnt.toLocaleString()}</p>
                    <p className="text-[10px] opacity-70">{pct}%</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 수익 & 비용 지표 ── */}
          {!revenueLoading && revenue && (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">수익 & 비용 지표</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">예상 MRR</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{revenue.mrrKrw.toLocaleString("ko-KR")}원</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">재방문 유저</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{revenue.repeatUserCount.toLocaleString()}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><Cpu className="w-3 h-3" />총 AI 토큰</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">
                    {revenue.tokenCosts?.total_tokens ? `${(Number(revenue.tokenCosts.total_tokens) / 1_000_000).toFixed(2)}M` : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">총 API 비용 (추정)</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">
                    ${revenue.tokenCosts?.total_cost_usd ? Number(revenue.tokenCosts.total_cost_usd).toFixed(4) : "0"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">건당 ${revenue.tokenCosts?.avg_cost_usd ? Number(revenue.tokenCosts.avg_cost_usd).toFixed(5) : "0"}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── 일별 사용량 (분석+액티브 유저 복합) ── */}
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">일별 사용량</p>
              <div className="flex gap-1">
                {[7, 14, 30].map(d => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={cn("px-2.5 py-1 text-xs rounded-md transition-colors", days === d
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >{d}일</button>
                ))}
                <button onClick={loadStats} className="ml-1 p-1 rounded-md hover:bg-muted text-muted-foreground">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {merged.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">데이터가 없습니다</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={merged} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} labelStyle={{ fontWeight: 600 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="analyses" name="분석 수" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="left" dataKey="newUsers" name="신규 가입" fill="#6ee7b7" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="activeUsers" name="액티브 유저" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── 주간 신규 가입 트렌드 ── */}
          {!revenueLoading && weeklyData.length > 1 && (
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">주간 신규 가입 트렌드</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={weeklyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} labelStyle={{ fontWeight: 600 }} />
                  <Line type="monotone" dataKey="signups" name="신규 가입" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {/* ── 자동 배치 현황 ── */}
      <div className="rounded-xl border border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">자동 배치 현황</p>
          </div>
          <button onClick={loadBatch} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
            <RefreshCw className={cn("w-3.5 h-3.5", batchLoading && "animate-spin")} />
          </button>
        </div>

        {batchLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
          </div>
        ) : batch ? (
          <>
            {/* 요약 카드 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-[10px] text-muted-foreground mb-1">마지막 실행</p>
                <p className="text-sm font-bold text-foreground">{batch.lastRun ?? "없음"}</p>
                <p className={cn("text-[10px] mt-0.5 font-medium", batch.todayRan ? "text-green-600" : "text-amber-500")}>
                  {batch.todayRan ? "✓ 오늘 실행됨" : "오늘 미실행"}
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-[10px] text-muted-foreground mb-1">오늘 완료</p>
                <p className="text-2xl font-bold tabular-nums text-green-600">{batch.todayStats.completed}</p>
                <p className="text-[10px] text-muted-foreground">/ {batch.todayStats.total}개</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-[10px] text-muted-foreground mb-1">오늘 실패</p>
                <p className={cn("text-2xl font-bold tabular-nums", batch.todayStats.failed > 0 ? "text-red-500" : "text-muted-foreground")}>
                  {batch.todayStats.failed}
                </p>
                <p className="text-[10px] text-muted-foreground">진행중 {batch.todayStats.running}</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-[10px] text-muted-foreground mb-1">누적 자동 분석</p>
                <p className="text-2xl font-bold tabular-nums text-foreground">{batch.totalAutoAnalyses.toLocaleString()}</p>
                <p className={cn("text-[10px] mt-0.5 font-medium", batch.lockActive ? "text-amber-500" : "text-muted-foreground")}>
                  {batch.lockActive ? "🔒 배치 실행 중" : "대기 중"}
                </p>
              </div>
            </div>

            {/* 최근 14일 히스토리 */}
            {batch.history.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground font-medium mb-2">최근 14일 일별 실행 현황</p>
                <ResponsiveContainer width="100%" height={100}>
                  <ComposedChart data={batch.history} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 9 }} tickFormatter={d => `${parseInt(d.slice(5,7))}/${parseInt(d.slice(8,10))}`} />
                    <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                      formatter={(v: any, name: string) => [v, name === "completed" ? "완료" : name === "failed" ? "실패" : "전체"]}
                    />
                    <Bar dataKey="completed" name="completed" stackId="a" fill="hsl(var(--primary))" radius={[0,0,0,0]} />
                    <Bar dataKey="failed" name="failed" stackId="a" fill="#ef4444" radius={[2,2,0,0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 오늘 종목 목록 */}
            {batch.todayItems.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground font-medium mb-2">오늘 분석 종목 ({batch.todayItems.length}개)</p>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {batch.todayItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between text-xs py-1 px-2 rounded-md hover:bg-muted/60 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.status === "completed" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : item.status === "error" || item.status === "failed" ? (
                          <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-pulse" />
                        )}
                        <span className="font-mono text-[11px] text-muted-foreground shrink-0">{item.ticker}</span>
                        <span className="truncate text-foreground">{item.companyName}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.verdict && (
                          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", {
                            "bg-green-100 text-green-700": item.verdict === "Strong Buy",
                            "bg-emerald-100 text-emerald-700": item.verdict === "Buy",
                            "bg-slate-100 text-slate-600": item.verdict === "Hold",
                            "bg-orange-100 text-orange-600": item.verdict === "Sell",
                            "bg-red-100 text-red-600": item.verdict === "Strong Sell",
                          })}>
                            {item.verdict}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(item.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">데이터를 불러올 수 없습니다</p>
        )}
      </div>

      {/* ── 전체 유저 일일 한도 변경 ── */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">전체 유저 일일 한도 변경</p>
        <p className="text-[11px] text-muted-foreground">
          등급별 기본값: 무료 3회 · 베타 10회 · 프리미엄 50회. 일괄 변경 시 해당 등급 전체에 즉시 적용됩니다.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={globalLimitTier}
            onChange={e => setGlobalLimitTier(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="all">전체</option>
            <option value="free">무료</option>
            <option value="beta">베타</option>
            <option value="premium">프리미엄</option>
          </select>
          <input
            type="number"
            min="0"
            value={globalLimitVal}
            onChange={e => setGlobalLimitVal(e.target.value)}
            placeholder="새 한도 (예: 5)"
            className="w-32 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 tabular-nums"
          />
          <button
            onClick={applyGlobalLimit}
            disabled={globalLimitLoading || !globalLimitVal}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1.5"
          >
            {globalLimitLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            적용
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(TIER_LIMITS).map(([t, lim]) => (
            <button
              key={t}
              onClick={() => { setGlobalLimitTier(t); setGlobalLimitVal(String(lim)); }}
              className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
            >
              {TIER_LABEL[t]?.label} 기본값 ({lim}회) 복원
            </button>
          ))}
        </div>
      </div>

      {/* ── 공지 배너 ── */}
      {settingsLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> 설정 불러오는 중…
        </div>
      ) : (
        <div className="rounded-xl border border-border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              {noticeEnabled ? <Bell className="w-3.5 h-3.5 text-amber-500" /> : <BellOff className="w-3.5 h-3.5" />}
              서비스 공지 배너
            </p>
            <button
              onClick={() => setSettings(s => ({ ...s, notice_enabled: noticeEnabled ? "false" : "true" }))}
              className={cn(
                "relative w-10 h-5.5 rounded-full transition-colors",
                noticeEnabled ? "bg-primary" : "bg-muted border border-border"
              )}
            >
              <span className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                noticeEnabled ? "translate-x-5" : "translate-x-0.5"
              )} />
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] text-muted-foreground font-medium">배너 유형</label>
            <div className="flex gap-2">
              {(["info", "warning", "error"] as const).map(t => {
                const colors = { info: "border-blue-200 bg-blue-50 text-blue-700", warning: "border-amber-200 bg-amber-50 text-amber-700", error: "border-red-200 bg-red-50 text-red-700" };
                const labels = { info: "안내", warning: "주의", error: "긴급" };
                return (
                  <button
                    key={t}
                    onClick={() => setSettings(s => ({ ...s, notice_type: t }))}
                    className={cn(
                      "px-3 py-1.5 text-xs rounded-lg border transition-all",
                      settings.notice_type === t ? colors[t] + " font-semibold" : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >{labels[t]}</button>
                );
              })}
            </div>

            <label className="text-[11px] text-muted-foreground font-medium">배너 메시지</label>
            <textarea
              value={settings.notice_text ?? ""}
              onChange={e => setSettings(s => ({ ...s, notice_text: e.target.value }))}
              placeholder="앱 상단에 표시될 공지 내용을 입력하세요"
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
          </div>

          {settings.notice_text && (
            <div className={cn("rounded-lg border px-4 py-2.5 text-sm", {
              "border-blue-200 bg-blue-50 text-blue-700": (settings.notice_type ?? "info") === "info",
              "border-amber-200 bg-amber-50 text-amber-700": settings.notice_type === "warning",
              "border-red-200 bg-red-50 text-red-700": settings.notice_type === "error",
            })}>
              <span className="text-[10px] font-semibold uppercase tracking-wide mr-2 opacity-60">미리보기</span>
              {settings.notice_text}
            </div>
          )}

          <button
            onClick={saveSettings}
            disabled={settingsSaving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {settingsSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            설정 저장
          </button>
        </div>
      )}
    </div>
  );
}
