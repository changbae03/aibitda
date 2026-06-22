import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, BarChart3, Target, Play,
  ChevronRight, Info,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface EstimateRow {
  id: number;
  analysis_id: number;
  ticker: string;
  company_name: string | null;
  est_year: number;
  is_estimate: boolean;
  unit_label: string;
  currency: "KRW" | "USD";
  revenue_raw: number | null;
  op_income_raw: number | null;
  net_income_raw: number | null;
  eps_raw: number | null;
  parsed_at: string;
  analysis_created_at: string;
  // DART 매칭값
  actual_revenue: string | null;
  actual_op_income: string | null;
  actual_net_income: string | null;
  actual_eps: string | null;
  revenue_dev_pct: number | null;
  op_income_dev_pct: number | null;
  net_income_dev_pct: number | null;
  revenue_bias: "over" | "under" | "hit" | null;
  op_income_bias: "over" | "under" | "hit" | null;
  matched_at: string | null;
}

interface Stats {
  total: number;
  totalEstimates: number;
  matched: number;
  avgOpDevAbs: number | null;
  avgOpDev: number | null;
  avgRevDevAbs: number | null;
  within20pct: number;
  within10pct: number;
  bias: Record<string, number>;
}

interface ParseResult {
  analysesProcessed: number;
  totalEstimates: number;
  totalMatched: number;
  summary: Array<{ id: number; ticker: string; estimates: number; matched: number }>;
}

// ── 헬퍼 컴포넌트 ─────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums", color ?? "text-foreground")}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function DevBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground/50 text-xs">—</span>;
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : "";
  const color =
    abs <= 10
      ? "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800"
      : abs <= 25
      ? "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800"
      : "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800";
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded border", color)}>
      <Icon className="w-3 h-3" />
      {sign}{value.toFixed(1)}%
    </span>
  );
}

function BiasBadge({ bias }: { bias: "over" | "under" | "hit" | null }) {
  if (!bias) return <span className="text-muted-foreground/50 text-xs">—</span>;
  const map = {
    over:  { label: "과대추정", color: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800", Icon: TrendingUp },
    under: { label: "과소추정", color: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800", Icon: TrendingDown },
    hit:   { label: "적중", color: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800", Icon: CheckCircle2 },
  };
  const { label, color, Icon } = map[bias];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded border", color)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function fmtRaw(val: number | null, unit: string): string {
  if (val === null) return "—";
  return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${unit}`;
}

function fmtWon(bigStr: string | null, unit: string, unitMult?: number): string {
  if (!bigStr) return "—";
  const num = parseFloat(bigStr);
  if (isNaN(num)) return "—";
  const divisor = unitMult ?? 1;
  const converted = num / divisor;
  return `${converted.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} ${unit}`;
}

// ── 메인 페이지 ────────────────────────────────────────────────────────────────
export default function AdminEarnings() {
  const [stats, setStats]         = useState<Stats | null>(null);
  const [rows, setRows]           = useState<EstimateRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseErr, setParseErr]   = useState<string | null>(null);
  const [filter, setFilter]       = useState<"all" | "estimate" | "matched" | "unmatched">("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, lRes] = await Promise.all([
        fetch(getApiUrl("/api/earnings-accuracy/stats"), { credentials: "include" }),
        fetch(getApiUrl("/api/earnings-accuracy/list"),  { credentials: "include" }),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (lRes.ok) setRows(await lRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleParseAll = useCallback(async () => {
    if (parsing) return;
    setParsing(true);
    setParseErr(null);
    setParseResult(null);
    try {
      const res = await fetch(getApiUrl("/api/earnings-accuracy/parse-all"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) { setParseErr("파싱 실패: " + res.status); return; }
      const data: ParseResult = await res.json();
      setParseResult(data);
      await loadData();
    } catch (e: any) {
      setParseErr(e.message);
    } finally {
      setParsing(false);
    }
  }, [parsing, loadData]);

  const filtered = rows.filter((r) => {
    if (filter === "estimate")  return r.is_estimate;
    if (filter === "matched")   return r.is_estimate && r.matched_at !== null;
    if (filter === "unmatched") return r.is_estimate && r.matched_at === null;
    return true;
  });

  const hitRate = stats && stats.matched > 0
    ? Math.round((stats.within20pct / stats.matched) * 100)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Target className="w-6 h-6 text-[#FF8A7A]" />
              실적 추정 정확도
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI 추정치 vs DART 공시 실적 비교 · 오류 패턴 분석
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted/50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              새로고침
            </button>
            <button
              onClick={handleParseAll}
              disabled={parsing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-[#FF8A7A] text-white rounded-lg hover:bg-[#FF7A68] disabled:opacity-50 transition-colors font-medium"
            >
              {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {parsing ? "파싱 중…" : "전체 파싱 실행"}
            </button>
          </div>
        </div>

        {/* 파싱 결과 알림 */}
        {parseResult && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 px-5 py-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
              <CheckCircle2 className="w-4 h-4" />
              파싱 완료
            </div>
            <p className="text-emerald-700/80 dark:text-emerald-400/80">
              {parseResult.analysesProcessed}개 분석 처리 · 추정치 {parseResult.totalEstimates}건 저장 · DART 매칭 {parseResult.totalMatched}건
            </p>
          </div>
        )}
        {parseErr && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-5 py-3 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {parseErr}
          </div>
        )}

        {/* 통계 카드 */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              label="전체 추정 연도"
              value={stats.totalEstimates}
              sub={`총 ${stats.total}건 (실적 포함)`}
            />
            <StatCard
              label="DART 매칭 완료"
              value={stats.matched}
              sub={stats.matched > 0 ? "공시 데이터 확인됨" : "DART 데이터 필요"}
              color={stats.matched > 0 ? "text-emerald-600" : "text-muted-foreground"}
            />
            <StatCard
              label="영업이익 오차율"
              value={stats.avgOpDevAbs !== null ? `±${stats.avgOpDevAbs}%` : "—"}
              sub={stats.avgOpDev !== null
                ? (stats.avgOpDev > 0 ? `평균 +${stats.avgOpDev}% 과대추정` : `평균 ${stats.avgOpDev}% 과소추정`)
                : "매칭 데이터 없음"}
              color={
                stats.avgOpDevAbs === null ? undefined
                : stats.avgOpDevAbs <= 15 ? "text-emerald-600"
                : stats.avgOpDevAbs <= 30 ? "text-amber-600"
                : "text-red-600"
              }
            />
            <StatCard
              label="매출 오차율"
              value={stats.avgRevDevAbs !== null ? `±${stats.avgRevDevAbs}%` : "—"}
              sub="절댓값 평균"
            />
            <StatCard
              label="±20% 적중률"
              value={hitRate !== null ? `${hitRate}%` : "—"}
              sub={stats.matched > 0 ? `${stats.within20pct}/${stats.matched}건` : ""}
              color={
                hitRate === null ? undefined
                : hitRate >= 60 ? "text-emerald-600"
                : hitRate >= 40 ? "text-amber-600"
                : "text-red-600"
              }
            />
          </div>
        )}

        {/* 바이어스 요약 */}
        {stats && Object.keys(stats.bias).length > 0 && (
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
              <BarChart3 className="w-4 h-4 text-[#FF8A7A]" />
              영업이익 추정 바이어스
            </div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(stats.bias).map(([b, cnt]) => (
                <div key={b} className="flex flex-col items-center gap-1">
                  <BiasBadge bias={b as any} />
                  <span className="text-xs font-bold text-foreground">{cnt}건</span>
                </div>
              ))}
            </div>
            {stats.matched > 0 && (
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                과대추정: AI가 실제보다 +5% 이상 높게 추정 · 과소추정: -5% 이상 낮게 추정 · 적중: ±5% 이내
              </p>
            )}
          </div>
        )}

        {/* 필터 탭 */}
        <div className="flex gap-1 border-b border-border">
          {(["all", "estimate", "matched", "unmatched"] as const).map((f) => {
            const labels = { all: "전체", estimate: "추정치만", matched: "매칭 완료", unmatched: "미매칭" };
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                  filter === f
                    ? "border-[#FF8A7A] text-[#FF8A7A]"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {labels[f]}
              </button>
            );
          })}
        </div>

        {/* 리스트 */}
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">불러오는 중…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Target className="w-10 h-10 opacity-20" />
            <p className="text-sm">
              {rows.length === 0
                ? "데이터 없음. '전체 파싱 실행'으로 분석 리포트에서 추정치를 추출하세요."
                : "해당 필터에 맞는 항목이 없습니다."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* 컬럼 헤더 */}
            <div className="hidden md:grid grid-cols-[7rem_1fr_4rem_6rem_6rem_7rem_7rem] gap-3 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>종목</span>
              <span>회사명</span>
              <span>연도</span>
              <span>AI 매출</span>
              <span>AI 영업이익</span>
              <span>매출 편차</span>
              <span>영업이익 편차</span>
            </div>

            {filtered.map((row) => {
              const isExpanded = expandedId === row.id;
              const hasMatch = row.matched_at !== null;

              return (
                <div
                  key={row.id}
                  className={cn(
                    "rounded-xl border transition-all duration-150",
                    hasMatch
                      ? "border-border bg-card"
                      : row.is_estimate
                      ? "border-amber-200/60 bg-amber-50/30 dark:border-amber-800/30 dark:bg-amber-950/10"
                      : "border-border/50 bg-muted/20"
                  )}
                >
                  {/* 요약 행 */}
                  <button
                    className="w-full text-left"
                    onClick={() => setExpandedId(isExpanded ? null : row.id)}
                  >
                    <div className="grid grid-cols-[1fr_auto] md:grid-cols-[7rem_1fr_4rem_6rem_6rem_7rem_7rem_1.5rem] gap-3 items-center px-4 py-3">
                      {/* 종목 */}
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#FF8A7A]">{row.ticker}</span>
                        {row.is_estimate ? (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700 font-medium">E</span>
                        ) : (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border font-medium">A</span>
                        )}
                      </div>

                      {/* 회사명 */}
                      <span className="text-sm text-foreground truncate hidden md:block">
                        {row.company_name ?? "—"}
                      </span>

                      {/* 연도 */}
                      <span className="text-sm font-semibold tabular-nums">{row.est_year}</span>

                      {/* AI 매출 */}
                      <span className="text-xs text-muted-foreground tabular-nums hidden md:block">
                        {fmtRaw(row.revenue_raw, row.unit_label || row.currency)}
                      </span>

                      {/* AI 영업이익 */}
                      <span className="text-xs text-muted-foreground tabular-nums hidden md:block">
                        {fmtRaw(row.op_income_raw, row.unit_label || row.currency)}
                      </span>

                      {/* 매출 편차 */}
                      <span className="hidden md:block">
                        {hasMatch ? <DevBadge value={row.revenue_dev_pct} /> : <span className="text-muted-foreground/40 text-xs">미매칭</span>}
                      </span>

                      {/* 영업이익 편차 */}
                      <span className="hidden md:block">
                        {hasMatch ? <DevBadge value={row.op_income_dev_pct} /> : <span className="text-muted-foreground/40 text-xs">미매칭</span>}
                      </span>

                      {/* 화살표 */}
                      <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                    </div>
                  </button>

                  {/* 확장 상세 */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border/50 mt-0 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">AI 추정치</h4>
                        <table className="text-sm w-full">
                          <tbody className="divide-y divide-border/30">
                            <tr>
                              <td className="py-1 text-muted-foreground">매출</td>
                              <td className="py-1 text-right tabular-nums font-medium">{fmtRaw(row.revenue_raw, row.unit_label)}</td>
                            </tr>
                            <tr>
                              <td className="py-1 text-muted-foreground">영업이익</td>
                              <td className="py-1 text-right tabular-nums font-medium">{fmtRaw(row.op_income_raw, row.unit_label)}</td>
                            </tr>
                            <tr>
                              <td className="py-1 text-muted-foreground">순이익</td>
                              <td className="py-1 text-right tabular-nums font-medium">{fmtRaw(row.net_income_raw, row.unit_label)}</td>
                            </tr>
                            <tr>
                              <td className="py-1 text-muted-foreground">EPS</td>
                              <td className="py-1 text-right tabular-nums font-medium">{fmtRaw(row.eps_raw, row.currency === "KRW" ? "원" : "$")}</td>
                            </tr>
                          </tbody>
                        </table>
                        <p className="text-[10px] text-muted-foreground/50 mt-2">
                          분석 #{row.analysis_id} · {new Date(row.analysis_created_at).toLocaleDateString("ko-KR")} 작성
                        </p>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          {hasMatch ? "DART 실제 공시" : "DART 미매칭"}
                        </h4>
                        {hasMatch ? (
                          <>
                            <table className="text-sm w-full">
                              <tbody className="divide-y divide-border/30">
                                <tr>
                                  <td className="py-1 text-muted-foreground">매출</td>
                                  <td className="py-1 text-right tabular-nums font-medium">
                                    {fmtRaw(row.actual_revenue ? Number(row.actual_revenue) / 1e12 : null, "조원")}
                                  </td>
                                  <td className="py-1 pl-2"><DevBadge value={row.revenue_dev_pct} /></td>
                                </tr>
                                <tr>
                                  <td className="py-1 text-muted-foreground">영업이익</td>
                                  <td className="py-1 text-right tabular-nums font-medium">
                                    {fmtRaw(row.actual_op_income ? Number(row.actual_op_income) / 1e12 : null, "조원")}
                                  </td>
                                  <td className="py-1 pl-2"><DevBadge value={row.op_income_dev_pct} /></td>
                                </tr>
                                <tr>
                                  <td className="py-1 text-muted-foreground">순이익</td>
                                  <td className="py-1 text-right tabular-nums font-medium">
                                    {fmtRaw(row.actual_net_income ? Number(row.actual_net_income) / 1e12 : null, "조원")}
                                  </td>
                                  <td className="py-1 pl-2"><DevBadge value={row.net_income_dev_pct} /></td>
                                </tr>
                                <tr>
                                  <td className="py-1 text-muted-foreground">EPS</td>
                                  <td className="py-1 text-right tabular-nums font-medium">
                                    {row.actual_eps ? `${Number(row.actual_eps).toLocaleString("ko-KR")}원` : "—"}
                                  </td>
                                  <td />
                                </tr>
                              </tbody>
                            </table>
                            <div className="flex items-center gap-2 mt-2">
                              <BiasBadge bias={row.op_income_bias} />
                              <span className="text-[10px] text-muted-foreground">
                                매칭 {new Date(row.matched_at!).toLocaleDateString("ko-KR")}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col gap-2 py-2">
                            <p className="text-xs text-muted-foreground">
                              {row.is_estimate
                                ? `${row.est_year}년 DART 사업보고서 미공시 또는 ticker_financials 미수집`
                                : "과거 실적 연도 (비교 불필요)"}
                            </p>
                            {row.is_estimate && (
                              <p className="text-[10px] text-muted-foreground/60">
                                DART에 해당 연도 사업보고서(11011)가 수집된 후 '전체 파싱 실행'을 다시 실행하면 자동 매칭됩니다.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
