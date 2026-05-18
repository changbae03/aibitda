import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, Brain, ChevronDown, History } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

interface CalibrationRow {
  sector: string;
  market: string;
  direction_accuracy: number | null;
  avg_price_deviation: number | null;
  sample_count: number;
  last_recalc_at: string;
}

interface RecalcResult {
  message: string;
  analysesProcessed: number;
  sectorsUpdated: number;
  sectors: Record<string, { directionAccuracy: number | null; avgPriceDeviation: number | null; sampleCount: number }>;
}

const SECTOR_LABELS: Record<string, string> = {
  KR_BIOTECH: "한국 · 바이오/제약",
  KR_SEMICONDUCTOR: "한국 · 반도체",
  KR_FINANCIAL: "한국 · 금융/은행/보험",
  KR_CONSTRUCTION: "한국 · 건설/주택",
  KR_TELECOM: "한국 · 통신",
  KR_REIT: "한국 · 리츠",
  KR_AUTO: "한국 · 자동차",
  KR_OTHER: "한국 · 기타",
  US_BIOTECH: "미국 · 바이오/제약",
  US_TECH: "미국 · 테크/반도체",
  US_FINANCIAL: "미국 · 금융/은행/보험",
  US_REIT: "미국 · 리츠",
  US_ENERGY: "미국 · 에너지/자원",
  US_DEFENSE: "미국 · 방산/항공",
  US_TELECOM: "미국 · 통신",
  US_UTILITIES: "미국 · 유틸리티",
  US_OTHER: "미국 · 기타",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function AccuracyBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground text-xs">데이터 없음</span>;
  const pct = Math.round(value);
  const color = pct >= 60 ? "text-emerald-600 bg-emerald-50 border-emerald-200"
    : pct >= 50 ? "text-amber-600 bg-amber-50 border-amber-200"
    : "text-red-600 bg-red-50 border-red-200";
  const Icon = pct >= 60 ? CheckCircle2 : pct >= 50 ? Minus : AlertTriangle;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border", color)}>
      <Icon className="w-3 h-3" />
      {pct}%
    </span>
  );
}

function DeviationBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground text-xs">데이터 없음</span>;
  const rounded = Math.round(value * 10) / 10;
  const abs = Math.abs(rounded);
  const isOver = rounded > 0;
  const severity = abs >= 10 ? "strong" : abs >= 5 ? "mild" : "low";
  const color = severity === "strong"
    ? (isOver ? "text-red-600 bg-red-50 border-red-200" : "text-blue-600 bg-blue-50 border-blue-200")
    : severity === "mild"
    ? "text-amber-600 bg-amber-50 border-amber-200"
    : "text-emerald-600 bg-emerald-50 border-emerald-200";
  const Icon = isOver ? TrendingUp : TrendingDown;
  const label = isOver ? `+${rounded}%p 낙관` : `${rounded}%p 비관`;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border", color)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function GuideText({ acc, dev }: { acc: number | null; dev: number | null }) {
  if (acc === null && dev === null) return null;
  const lines: string[] = [];
  if (acc !== null && acc < 50) lines.push("방향 예측 불확실 → 중립 의견 가중치 증가");
  if (dev !== null && Math.abs(dev) >= 10) {
    lines.push(dev > 0
      ? `목표주가 ${Math.min(15, Math.round(Math.abs(dev) * 0.6))}% 하향 보정 적용 중`
      : `목표주가 ${Math.min(15, Math.round(Math.abs(dev) * 0.6))}% 상향 보정 적용 중`
    );
  } else if (dev !== null && Math.abs(dev) >= 5) {
    lines.push("소폭 편향 감지 → 하단 시나리오 가중치 증가 적용 중");
  }
  if (lines.length === 0) lines.push("보정 미적용 (편향 허용 범위 내)");
  return (
    <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
      {lines.map((l, i) => <p key={i}>→ {l}</p>)}
    </div>
  );
}

interface HistoryPoint {
  label: string;
  direction_accuracy: number | null;
  avg_price_deviation: number | null;
  sample_count: number;
}

function HistoryChart({ sector, label }: { sector: string; label: string }) {
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(getApiUrl(`/api/performance/calibration-history?sector=${encodeURIComponent(sector)}`), { credentials: "include" })
      .then(r => r.json())
      .then(d => setData(Array.isArray(d) ? d : []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [sector]);

  if (loading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  if (data.length < 2) return (
    <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
      히스토리 데이터 부족 (재계산 2회 이상 필요)
    </div>
  );

  return (
    <div className="mt-4 space-y-4">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
        <History className="w-3 h-3" /> {label} · 성과 추이 ({data.length}회 기록)
      </p>
      <div className="grid grid-cols-1 gap-4">
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">방향 정확도 (%)</p>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${v?.toFixed(1)}%`, "정확도"]} />
              <ReferenceLine y={60} stroke="hsl(var(--chart-2))" strokeDasharray="4 2" label={{ value: "60%", fontSize: 9 }} />
              <ReferenceLine y={50} stroke="hsl(var(--destructive)/0.5)" strokeDasharray="4 2" label={{ value: "50%", fontSize: 9 }} />
              <Line type="monotone" dataKey="direction_accuracy" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="정확도" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">목표주가 편향 (%p)</p>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${v?.toFixed(1)}%p`, "편향"]} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 2" />
              <Line type="monotone" dataKey="avg_price_deviation" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={{ r: 3 }} name="편향" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function AdminCalibration() {
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [recalcResult, setRecalcResult] = useState<RecalcResult | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [expandedSector, setExpandedSector] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/performance/calibration"), { credentials: "include" });
      if (r.status === 403) { setForbidden(true); return; }
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runRecalc() {
    setRecalcLoading(true);
    setRecalcResult(null);
    setRecalcError(null);
    try {
      const r = await fetch(getApiUrl("/api/performance/recalculate"), {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) {
        setRecalcError(data.error ?? "재계산 실패");
      } else {
        setRecalcResult(data);
        await load();
      }
    } catch (e) {
      setRecalcError(String(e));
    } finally {
      setRecalcLoading(false);
    }
  }

  if (forbidden) {
    return (
      <div className="p-8 text-center text-muted-foreground">관리자 권한이 필요합니다.</div>
    );
  }

  const krRows = rows.filter(r => r.market === "KR");
  const usRows = rows.filter(r => r.market === "US");

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">AI 모델 보정 현황</h1>
          </div>
          <p className="text-[13px] text-muted-foreground">
            30일 이상 된 분석의 실제 주가 성과를 비교해 섹터별 편향을 측정합니다. 보정값은 이후 분석의 밸류에이션·최종 전략 단계 프롬프트에 자동 주입됩니다.
          </p>
        </div>
        <button
          onClick={runRecalc}
          disabled={recalcLoading}
          className="shrink-0 flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {recalcLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          보정 재계산
        </button>
      </div>

      {recalcResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          <p className="font-semibold">{recalcResult.message}</p>
          <p className="text-[12px] mt-0.5 text-emerald-600 dark:text-emerald-400">
            분석 처리 {recalcResult.analysesProcessed}건 · 섹터 업데이트 {recalcResult.sectorsUpdated}개
          </p>
        </div>
      )}
      {recalcError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {recalcError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/30 px-6 py-10 text-center space-y-2">
          <Brain className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="font-medium text-foreground">아직 보정 데이터가 없습니다</p>
          <p className="text-[13px] text-muted-foreground">
            30일 이상 된 완료 분석이 쌓인 후 "보정 재계산" 버튼을 눌러 첫 번째 보정을 시작하세요.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {[{ label: "한국 시장 (KR)", data: krRows }, { label: "미국 시장 (US)", data: usRows }].map(group => (
            group.data.length > 0 && (
              <section key={group.label}>
                <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">
                  {group.label}
                </h2>
                <div className="space-y-2">
                  {group.data.map(row => {
                    const sectorLabel = SECTOR_LABELS[row.sector] ?? row.sector;
                    const isExpanded = expandedSector === row.sector;
                    return (
                      <div
                        key={row.sector}
                        className="rounded-xl border border-border bg-background px-4 py-3.5"
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground">{sectorLabel}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              샘플 {row.sample_count}건 · 최종 업데이트: {formatDate(row.last_recalc_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            <div className="text-right">
                              <p className="text-[10px] text-muted-foreground mb-1">방향 정확도</p>
                              <AccuracyBadge value={row.direction_accuracy} />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-muted-foreground mb-1">목표주가 편향</p>
                              <DeviationBadge value={row.avg_price_deviation} />
                            </div>
                            <button
                              onClick={() => setExpandedSector(isExpanded ? null : row.sector)}
                              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                            >
                              <History className="w-3 h-3" />
                              <ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} />
                            </button>
                          </div>
                        </div>
                        {row.sample_count >= 3 && (
                          <GuideText acc={row.direction_accuracy} dev={row.avg_price_deviation} />
                        )}
                        {row.sample_count < 3 && (
                          <p className="text-[11px] text-amber-600 mt-1">→ 샘플 3건 미만 — 보정 미적용 (더 많은 분석 필요)</p>
                        )}
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <HistoryChart sector={row.sector} label={sectorLabel} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-muted/20 px-4 py-4 space-y-2">
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">보정 동작 기준</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px] text-muted-foreground">
          <p>· 샘플 3건 이상 시 보정 활성화</p>
          <p>· 목표주가 편향 ±10%p 이상 → 강력 보정</p>
          <p>· 방향 정확도 50% 미만 → 투자의견 보수화</p>
          <p>· 편향 ±5~10%p → 하단 시나리오 가중치 증가</p>
          <p>· 보정값은 밸류에이션·최종 전략 단계에만 주입</p>
          <p>· 매월 수동 재계산 권장</p>
        </div>
      </div>
    </div>
  );
}
