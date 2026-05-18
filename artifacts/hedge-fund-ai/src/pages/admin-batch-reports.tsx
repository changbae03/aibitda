import { useState, useEffect, useCallback } from "react";
import {
  Bot, RefreshCw, Loader2, CheckCircle2, XCircle, Clock,
  ChevronLeft, ChevronRight, AlertTriangle, FileText, ShieldCheck,
  Target, TrendingUp, Zap, Filter,
} from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { cn, getApiUrl } from "@/lib/utils";

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface BatchItem {
  id: number;
  ticker: string;
  companyName: string;
  status: string;
  verdict: string | null;
  qaScore: number | null;
  hasPeerIssue: boolean;
  createdAt: string;
}

interface BatchStatus {
  lastRun: string | null;
  todayRan: boolean;
  lockActive: boolean;
  todayStats: { total: number; completed: number; failed: number; running: number };
  todayItems: BatchItem[];
  history: { day: string; completed: number; failed: number; total: number }[];
  totalAutoAnalyses: number;
  dailyTarget: number;
  qaAvgToday: number | null;
  calibCountToday: number;
  peerIssueCountToday: number;
  coverageKr: number;
  coverageUs: number;
}

interface ReportItem {
  id: number;
  ticker: string;
  companyName: string;
  status: string;
  verdict: string | null;
  createdAt: string;
  qaScore: number | null;
  qaFlags: string[];
  peerResult: { hasIssues: boolean; validPeerCount: number; issues: { type: string }[] } | null;
  hasCalib: boolean;
  calibNote: string | null;
}

interface ReportsPage {
  items: ReportItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const TOTAL_KR = 2719;
const TOTAL_US = 358;

const VERDICT_COLORS: Record<string, string> = {
  "Strong Buy":  "bg-green-500/15 text-green-400 border-green-500/30",
  "Buy":         "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "Hold":        "bg-slate-500/15 text-slate-400 border-slate-500/30",
  "Sell":        "bg-orange-500/15 text-orange-400 border-orange-500/30",
  "Strong Sell": "bg-red-500/15 text-red-400 border-red-500/30",
};

// ─── 진행률 링 ───────────────────────────────────────────────────────────────

function ProgressRing({ value, max, size = 72, stroke = 7 }: {
  value: number; max: number; size?: number; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const offset = circ * (1 - pct);
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="hsl(var(--border))" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="#FF8A7A" strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }} />
    </svg>
  );
}

// ─── QA 점수 배지 ────────────────────────────────────────────────────────────

function QaBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const color =
    score >= 90 ? "text-green-400" :
    score >= 75 ? "text-amber-400" : "text-red-400";
  return <span className={cn("font-mono text-xs font-bold tabular-nums", color)}>{score}점</span>;
}

// ─── 메인 페이지 ─────────────────────────────────────────────────────────────

export default function AdminBatchReports() {
  const [batch, setBatch]   = useState<BatchStatus | null>(null);
  const [batchLoading, setBatchLoading] = useState(true);

  const [reports, setReports] = useState<ReportsPage | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);

  const [page, setPage]         = useState(1);
  const [dateFilter, setDateFilter] = useState("");
  const [verdictFilter, setVerdictFilter] = useState("");
  const [calibFilter, setCalibFilter] = useState(false);
  const [peerFilter, setPeerFilter]   = useState(false);

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadBatch = useCallback(async () => {
    setBatchLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/batch-status"), { credentials: "include" });
      if (r.ok) setBatch(await r.json());
    } finally { setBatchLoading(false); }
  }, []);

  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "30",
        ...(dateFilter   ? { date: dateFilter } : {}),
        ...(verdictFilter ? { verdict: verdictFilter } : {}),
        ...(calibFilter  ? { hasCalib: "1" } : {}),
        ...(peerFilter   ? { hasPeerIssue: "1" } : {}),
      });
      const r = await fetch(getApiUrl(`/api/admin/batch-reports?${params}`), { credentials: "include" });
      if (r.ok) setReports(await r.json());
    } finally { setReportsLoading(false); }
  }, [page, dateFilter, verdictFilter, calibFilter, peerFilter]);

  useEffect(() => { loadBatch(); }, []);
  useEffect(() => { setPage(1); }, [dateFilter, verdictFilter, calibFilter, peerFilter]);
  useEffect(() => { loadReports(); }, [loadReports]);

  const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <div className="space-y-5 max-w-4xl">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            AI 자동 보고서
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI(익명)가 자동으로 생성한 보고서만 표시됩니다
          </p>
        </div>
        <button
          onClick={() => { loadBatch(); loadReports(); }}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
        >
          <RefreshCw className={cn("w-4 h-4", batchLoading && "animate-spin")} />
        </button>
      </div>

      {/* ── 오늘 진행 대시보드 ── */}
      {batchLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> 로딩 중…
        </div>
      ) : batch && (
        <>
          {/* 오늘 진행률 + 주요 지표 */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              오늘 배치 진행 현황 · {todayKST}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {/* 진행률 링 */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="relative">
                  <ProgressRing value={batch.todayStats.completed} max={batch.dailyTarget} size={80} stroke={8} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[15px] font-black tabular-nums text-foreground leading-none">
                      {batch.todayStats.completed}
                    </span>
                    <span className="text-[9px] text-muted-foreground">/{batch.dailyTarget}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[13px] font-bold text-foreground">
                    {Math.round((batch.todayStats.completed / batch.dailyTarget) * 100)}% 달성
                  </p>
                  <p className="text-[11px] text-muted-foreground">일일 목표 {batch.dailyTarget}개</p>
                  <p className={cn("text-[11px] mt-0.5 font-medium",
                    batch.todayRan ? "text-green-400" : "text-amber-400")}>
                    {batch.todayRan ? "✓ 오늘 배치 실행됨" : "오늘 배치 미실행"}
                  </p>
                </div>
              </div>

              {/* 구분선 */}
              <div className="hidden sm:block w-px bg-border self-stretch" />

              {/* 상태 세부 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 w-full">
                <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground mb-0.5">완료</p>
                  <p className="text-xl font-black tabular-nums text-green-400">{batch.todayStats.completed}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground mb-0.5">진행중</p>
                  <p className="text-xl font-black tabular-nums text-amber-400">{batch.todayStats.running}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground mb-0.5">실패</p>
                  <p className={cn("text-xl font-black tabular-nums",
                    batch.todayStats.failed > 0 ? "text-red-400" : "text-muted-foreground/40")}>
                    {batch.todayStats.failed}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground mb-0.5">남은 목표</p>
                  <p className="text-xl font-black tabular-nums text-foreground">
                    {Math.max(0, batch.dailyTarget - batch.todayStats.completed)}
                  </p>
                </div>
              </div>
            </div>

            {/* 진행 바 */}
            <div className="mt-4">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, (batch.todayStats.completed / batch.dailyTarget) * 100)}%`,
                    background: "linear-gradient(90deg, #FF8A7A, #ff6b58)",
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0</span>
                <span>KR 목표 {25}개</span>
                <span>US 목표 {15}개</span>
                <span>{batch.dailyTarget}</span>
              </div>
            </div>
          </div>

          {/* 4개 지표 카드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-card p-3.5 flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Target className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">누적 AI 보고서</p>
                <p className="text-xl font-black tabular-nums">{batch.totalAutoAnalyses.toLocaleString()}</p>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5 flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">오늘 QA 평균</p>
                <p className="text-xl font-black tabular-nums">
                  {batch.qaAvgToday !== null ? `${batch.qaAvgToday}점` : "—"}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5 flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">보정메모 생성</p>
                <p className="text-xl font-black tabular-nums">{batch.calibCountToday}개</p>
                <p className="text-[9px] text-muted-foreground">오늘 기준</p>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5 flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">피어 이슈</p>
                <p className={cn("text-xl font-black tabular-nums",
                  batch.peerIssueCountToday > 0 ? "text-red-400" : "text-muted-foreground/40")}>
                  {batch.peerIssueCountToday}개
                </p>
                <p className="text-[9px] text-muted-foreground">오늘 기준</p>
              </div>
            </div>
          </div>

          {/* 커버리지 */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              누적 종목 커버리지
            </p>
            <div className="space-y-2.5">
              {[
                { label: "국내 (KR)", value: batch.coverageKr, total: TOTAL_KR, color: "bg-primary" },
                { label: "해외 (US)", value: batch.coverageUs, total: TOTAL_US, color: "bg-blue-400" },
              ].map(({ label, value, total, color }) => {
                const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                return (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {value.toLocaleString()}
                        <span className="text-muted-foreground font-normal"> / {total.toLocaleString()} ({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", color)}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 14일 히스토리 */}
          {batch.history.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                최근 14일 배치 현황
              </p>
              <ResponsiveContainer width="100%" height={100}>
                <ComposedChart data={batch.history} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 9 }}
                    tickFormatter={d => `${parseInt(d.slice(5,7))}/${parseInt(d.slice(8,10))}`} />
                  <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                    formatter={(v: any, name: string) => [v, name === "completed" ? "완료" : "실패"]}
                  />
                  <Bar dataKey="completed" name="completed" stackId="a" fill="#FF8A7A" radius={[0,0,0,0]} />
                  <Bar dataKey="failed"    name="failed"    stackId="a" fill="#ef4444" radius={[2,2,0,0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {/* ── 전체 AI 보고서 목록 ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* 필터 바 */}
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <select
            value={verdictFilter}
            onChange={e => setVerdictFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            <option value="">전체 판정</option>
            {["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <button
            onClick={() => setCalibFilter(v => !v)}
            className={cn("px-2.5 py-1.5 text-xs rounded-lg border transition-colors",
              calibFilter
                ? "bg-amber-500/15 border-amber-500/40 text-amber-400 font-semibold"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            보정메모 있음
          </button>
          <button
            onClick={() => setPeerFilter(v => !v)}
            className={cn("px-2.5 py-1.5 text-xs rounded-lg border transition-colors",
              peerFilter
                ? "bg-red-500/15 border-red-500/40 text-red-400 font-semibold"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            피어 이슈
          </button>
          {(dateFilter || verdictFilter || calibFilter || peerFilter) && (
            <button
              onClick={() => { setDateFilter(""); setVerdictFilter(""); setCalibFilter(false); setPeerFilter(false); }}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              초기화
            </button>
          )}
          {reports && (
            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
              총 {reports.total.toLocaleString()}개
            </span>
          )}
        </div>

        {/* 테이블 */}
        {reportsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
          </div>
        ) : reports && reports.items.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">해당 조건의 AI 보고서가 없습니다</p>
        ) : reports && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">종목</th>
                  <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">기업명</th>
                  <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">날짜</th>
                  <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">상태</th>
                  <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">판정</th>
                  <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">QA</th>
                  <th className="text-center px-3 py-2.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">피어</th>
                  <th className="text-center px-3 py-2.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">보정메모</th>
                </tr>
              </thead>
              <tbody>
                {reports.items.map(item => (
                  <>
                    <tr
                      key={item.id}
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{item.ticker}</td>
                      <td className="px-3 py-2 text-foreground max-w-[160px] truncate">{item.companyName}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}
                        {" "}
                        <span className="text-muted-foreground/50">
                          {new Date(item.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {item.status === "completed" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                        ) : item.status === "error" || item.status === "failed" ? (
                          <XCircle className="w-3.5 h-3.5 text-red-400" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {item.verdict ? (
                          <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap",
                            VERDICT_COLORS[item.verdict] ?? "bg-muted text-muted-foreground border-border")}>
                            {item.verdict}
                          </span>
                        ) : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <QaBadge score={item.qaScore} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.peerResult ? (
                          item.peerResult.hasIssues ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-red-400 mx-auto" title="피어 이슈 감지" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 text-green-400 mx-auto" title="피어 검증 통과" />
                          )
                        ) : <span className="text-muted-foreground/30 text-[10px]">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.hasCalib ? (
                          <FileText className="w-3.5 h-3.5 text-amber-400 mx-auto" title="보정메모 있음" />
                        ) : <span className="text-muted-foreground/30 text-[10px]">—</span>}
                      </td>
                    </tr>
                    {expandedId === item.id && (
                      <tr key={`${item.id}-detail`} className="bg-muted/10">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            {/* QA 플래그 */}
                            {item.qaFlags.length > 0 && (
                              <div className="rounded-lg bg-muted/40 p-3">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">QA 플래그</p>
                                <div className="space-y-0.5">
                                  {item.qaFlags.map((f, i) => (
                                    <p key={i} className="text-xs text-red-400">• {f}</p>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* 피어 이슈 */}
                            {item.peerResult?.hasIssues && (
                              <div className="rounded-lg bg-muted/40 p-3">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">피어 이슈</p>
                                <div className="space-y-0.5">
                                  {item.peerResult.issues.slice(0, 4).map((iss, i) => (
                                    <p key={i} className="text-xs text-orange-400">• {iss.type}</p>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* 보정메모 */}
                            {item.calibNote && (
                              <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 sm:col-span-2">
                                <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1.5">AI 보정메모</p>
                                <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{item.calibNote}</p>
                              </div>
                            )}
                            {/* 보고서 링크 */}
                            <div className="flex items-center gap-2">
                              <a
                                href={`/analysis/${item.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline"
                                onClick={e => e.stopPropagation()}
                              >
                                보고서 상세 보기 →
                              </a>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 페이지네이션 */}
        {reports && reports.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-muted transition-colors disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> 이전
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {page} / {reports.pages} 페이지
            </span>
            <button
              onClick={() => setPage(p => Math.min(reports.pages, p + 1))}
              disabled={page >= reports.pages}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-muted transition-colors disabled:opacity-40"
            >
              다음 <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
