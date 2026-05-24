import { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, Clock, BarChart2, Plus, Edit3, Trash2,
  CheckCircle2, X, Save, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Activity, FlaskConical,
  ShieldCheck, RefreshCw, ExternalLink, Users, XCircle,
  Brain, TrendingUp, TrendingDown, Minus, History,
  PencilLine, Search, Eye, BarChart3, Cpu, CheckCircle, Bot,
  StickyNote, SlidersHorizontal, Target,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, LineChart, ReferenceLine,
} from "recharts";

// ─── 타입 ───────────────────────────────────────────────────────────────────

interface DailyRow {
  day: string;
  total: number;
  errors: number;
  error_rate: number | null;
  avg_duration_min: number | null;
}

interface QualitySummary {
  total: number;
  completed: number;
  errors: number;
  in_progress: number;
  error_rate: number | null;
  avg_duration_min: number | null;
}

interface RecentError {
  id: number;
  ticker: string;
  company_name: string;
  error_message: string | null;
  created_at: string;
}

interface PromptVersion {
  id: number;
  name: string;
  stage: string;
  description: string | null;
  ab_group: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  content_length: number;
  content?: string;
}

const STAGE_LABELS: Record<string, string> = {
  company_brief: "기업 브리핑",
  macro_industry: "거시·산업 분석",
  supply_demand: "투자 촉매·수급",
  earnings_forecast: "실적 전망",
  valuation: "적정주가 산출",
  technical: "기술적 분석",
  final_strategy: "최종 결론",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── 오류 모니터링 탭 ────────────────────────────────────────────────────────

function MonitoringTab() {
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [errors, setErrors] = useState<RecentError[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/quality-stats"), { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setDaily(d.daily ?? []);
        setSummary(d.summary ?? null);
        setErrors(d.recentErrors ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );

  const cards = summary ? [
    { label: "30일 총 분석", value: summary.total.toLocaleString(), sub: null, color: "" },
    { label: "완료", value: summary.completed.toLocaleString(), sub: null, color: "text-emerald-600" },
    { label: "오류 건수", value: summary.errors.toLocaleString(), sub: null, color: Number(summary.errors) > 0 ? "text-red-500" : "text-emerald-600" },
    { label: "오류율", value: summary.error_rate !== null ? `${summary.error_rate}%` : "—", sub: null, color: Number(summary.error_rate) > 5 ? "text-red-500" : "text-emerald-600" },
    { label: "평균 소요", value: summary.avg_duration_min !== null ? `${summary.avg_duration_min}분` : "—", sub: null, color: "" },
  ] : [];

  return (
    <div className="space-y-6">
      {/* 요약 카드 */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {cards.map(c => (
            <div key={c.label} className="rounded-xl border border-border bg-background px-4 py-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">{c.label}</p>
              <p className={cn("text-xl font-bold tabular-nums", c.color || "text-foreground")}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 일별 차트 */}
      {daily.length > 0 && (
        <div className="rounded-xl border border-border bg-background p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <BarChart2 className="w-3.5 h-3.5" /> 일별 분석 현황 (최근 30일)
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={daily} margin={{ top: 4, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="total" fill="hsl(var(--primary)/0.15)" stroke="hsl(var(--primary)/0.4)" name="총 분석" />
              <Bar yAxisId="left" dataKey="errors" fill="hsl(var(--destructive)/0.15)" stroke="hsl(var(--destructive)/0.5)" name="오류" />
              <Line yAxisId="right" type="monotone" dataKey="error_rate" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="오류율 %" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 소요 시간 차트 */}
      {daily.length > 0 && (
        <div className="rounded-xl border border-border bg-background p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> 평균 분석 소요 시간 (분)
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={daily} margin={{ top: 4, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit="분" />
              <Tooltip formatter={(v: number) => [`${v}분`, "평균 소요"]} />
              <Line type="monotone" dataKey="avg_duration_min" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} name="평균 소요(분)" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {daily.length === 0 && (
        <div className="rounded-xl border border-border bg-muted/20 py-16 text-center text-muted-foreground text-sm">
          최근 30일 분석 데이터 없음
        </div>
      )}

      {/* 최근 오류 목록 */}
      {errors.length > 0 && (
        <div className="rounded-xl border border-border bg-background overflow-x-auto">
          <div className="px-4 py-3 border-b border-border bg-muted/20">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> 최근 오류 분석 ({errors.length}건)
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">종목</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">오류 메시지</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">일시</th>
              </tr>
            </thead>
            <tbody>
              {errors.map(e => (
                <tr key={e.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs font-semibold">{e.ticker}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">{e.company_name}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground max-w-[280px] truncate">
                    {e.error_message ?? <span className="opacity-40">메시지 없음</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[11px] text-muted-foreground whitespace-nowrap">{fmt(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 프롬프트 버전 탭 ────────────────────────────────────────────────────────

const BLANK_FORM = { name: "", stage: "", content: "", description: "", ab_group: "" };

function PromptVersionTab() {
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(getApiUrl("/api/admin/prompt-versions"), { credentials: "include" });
    if (r.ok) setVersions(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const showMsg = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const startEdit = async (v: PromptVersion) => {
    const r = await fetch(getApiUrl(`/api/admin/prompt-versions/${v.id}`), { credentials: "include" });
    const full = await r.json();
    setForm({ name: v.name, stage: v.stage, content: full.content ?? "", description: v.description ?? "", ab_group: v.ab_group ?? "" });
    setEditId(v.id);
  };

  const startNew = () => {
    setForm(BLANK_FORM);
    setEditId("new");
  };

  const cancel = () => { setEditId(null); setForm(BLANK_FORM); };

  const save = async () => {
    if (!form.name.trim() || !form.stage || !form.content.trim()) {
      showMsg("err", "이름, 단계, 내용은 필수입니다");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        stage: form.stage,
        content: form.content,
        description: form.description || null,
        ab_group: form.ab_group || null,
      };
      const r = editId === "new"
        ? await fetch(getApiUrl("/api/admin/prompt-versions"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(getApiUrl(`/api/admin/prompt-versions/${editId}`), { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) {
        showMsg("ok", editId === "new" ? "프롬프트 버전 생성 완료" : "저장 완료");
        cancel();
        load();
      } else {
        const d = await r.json();
        showMsg("err", d.error ?? "저장 실패");
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (v: PromptVersion) => {
    const r = await fetch(getApiUrl(`/api/admin/prompt-versions/${v.id}/toggle-active`), { method: "PATCH", credentials: "include" });
    if (r.ok) { showMsg("ok", v.is_active ? "비활성화됨" : "활성화됨"); load(); }
  };

  const remove = async (v: PromptVersion) => {
    if (!confirm(`"${v.name}" 프롬프트를 삭제하시겠습니까?`)) return;
    await fetch(getApiUrl(`/api/admin/prompt-versions/${v.id}`), { method: "DELETE", credentials: "include" });
    showMsg("ok", "삭제됨");
    load();
  };

  const loadContent = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); setFullContent(null); return; }
    const r = await fetch(getApiUrl(`/api/admin/prompt-versions/${id}`), { credentials: "include" });
    const d = await r.json();
    setFullContent(d.content ?? "");
    setExpandedId(id);
  };

  const grouped = versions.reduce<Record<string, PromptVersion[]>>((acc, v) => {
    (acc[v.stage] ??= []).push(v);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {msg && (
        <div className={cn("rounded-xl px-4 py-2.5 text-sm border", msg.type === "ok" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200")}>
          {msg.text}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          각 분석 단계별 프롬프트를 버전 관리하고 A/B 테스트를 설정합니다.
        </p>
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> 새 버전
        </button>
      </div>

      {/* 편집 폼 */}
      {editId !== null && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <p className="text-xs font-semibold text-primary">{editId === "new" ? "새 프롬프트 버전 생성" : "프롬프트 버전 편집"}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">이름 *</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="예: valuation-v2"
                className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">단계 *</label>
              <select
                value={form.stage}
                onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">선택...</option>
                {Object.entries(STAGE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
                <option value="custom">기타</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">설명 (선택)</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="변경 내용 요약"
                className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">A/B 그룹 (선택)</label>
              <select
                value={form.ab_group}
                onChange={e => setForm(f => ({ ...f, ab_group: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">없음</option>
                <option value="A">A 그룹</option>
                <option value="B">B 그룹</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">프롬프트 내용 *</label>
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="프롬프트 내용을 입력하세요..."
              rows={10}
              className="w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
            />
            <p className="text-[10px] text-muted-foreground mt-1">{form.content.length.toLocaleString()}자</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              저장
            </button>
            <button onClick={cancel} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
              <X className="w-3.5 h-3.5" /> 취소
            </button>
          </div>
        </div>
      )}

      {/* 버전 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/20 py-16 text-center text-muted-foreground text-sm">
          등록된 프롬프트 버전이 없습니다. "새 버전" 버튼으로 추가하세요.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([stage, vs]) => (
            <div key={stage}>
              <h3 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-2 px-1 flex items-center gap-1.5">
                <FlaskConical className="w-3 h-3" /> {STAGE_LABELS[stage] ?? stage}
                <span className="normal-case font-normal">({vs.length}개)</span>
              </h3>
              <div className="space-y-2">
                {vs.map(v => (
                  <div key={v.id} className={cn("rounded-xl border bg-background overflow-hidden", v.is_active ? "border-primary/30" : "border-border")}>
                    <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">{v.name}</span>
                          {v.is_active && (
                            <span className="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-semibold">활성</span>
                          )}
                          {v.ab_group && (
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold border",
                              v.ab_group === "A" ? "text-blue-600 bg-blue-50 border-blue-200" : "text-purple-600 bg-purple-50 border-purple-200"
                            )}>
                              {v.ab_group} 그룹
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                          {v.description && <span>{v.description}</span>}
                          <span>{(v.content_length ?? 0).toLocaleString()}자</span>
                          <span>수정 {fmt(v.updated_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => loadContent(v.id)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="내용 보기"
                        >
                          {expandedId === v.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => toggleActive(v)}
                          className={cn("p-1.5 rounded transition-colors", v.is_active ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-muted")}
                          title={v.is_active ? "비활성화" : "활성화"}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => startEdit(v)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="편집"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => remove(v)}
                          className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {expandedId === v.id && fullContent !== null && (
                      <div className="border-t border-border/50 bg-muted/20 px-4 py-3">
                        <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                          {fullContent}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── QA 채점 탭 ──────────────────────────────────────────────────────────────

interface QAReport {
  id: number;
  ticker: string;
  company_name: string;
  investment_verdict: string | null;
  target_price: number | null;
  start_price: number | null;
  qa_score: number | null;
  qa_flags: string[];
  grade: string;
  created_at: string;
  user_name: string | null;
}

interface QASummary {
  total: string;
  avg_score: string | null;
  unscored: string;
  grade_a: string; grade_b: string; grade_c: string; grade_d: string; grade_f: string;
}

const FLAG_LABELS: Record<string, string> = {
  has_target_price: "목표가",
  has_verdict: "투자의견",
  has_stop_loss: "손절가",
  has_entry_price: "진입가",
  has_risk_reward: "위험/보상",
  all_steps: "7섹션",
  content_length: "내용길이",
  has_dcf_table: "DCF테이블",
  has_peer_table: "피어테이블",
  no_placeholder: "플레이스홀더",
  has_scenarios: "시나리오",
};

function gradeColor(grade: string) {
  if (grade === "A") return "text-emerald-500";
  if (grade === "B") return "text-blue-500";
  if (grade === "C") return "text-yellow-500";
  if (grade === "D") return "text-orange-500";
  if (grade === "F") return "text-red-500";
  return "text-muted-foreground";
}

function scoreBar(score: number | null) {
  if (score === null) return null;
  const color = score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-blue-500" : score >= 60 ? "bg-yellow-500" : score >= 40 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums font-semibold w-8 text-right">{score}</span>
    </div>
  );
}

function QATab() {
  const [data, setData] = useState<{ summary: QASummary; reports: QAReport[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [batchRunning, setBatchRunning] = useState(false);
  const [rescoring, setRescoring] = useState<number | null>(null);
  const [filterScore, setFilterScore] = useState<"all" | "low" | "unscored">("all");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const showMsg = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterScore === "low" ? "?maxScore=59" : filterScore === "unscored" ? "?maxScore=100&minScore=0" : "";
      const r = await fetch(getApiUrl(`/api/admin/qa-reports${params}`), { credentials: "include" });
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }, [filterScore]);

  useEffect(() => { load(); }, [load]);

  const rescore = async (id: number) => {
    setRescoring(id);
    try {
      const r = await fetch(getApiUrl(`/api/admin/qa-check/${id}`), { method: "POST", credentials: "include" });
      if (r.ok) { showMsg("ok", `#${id} 재채점 완료`); load(); }
      else showMsg("err", "재채점 실패");
    } finally { setRescoring(null); }
  };

  const batchRescore = async () => {
    setBatchRunning(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/qa-check-all"), { method: "POST", credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        showMsg("ok", `전체 ${d.count}건 채점 시작 (백그라운드 처리 중)`);
        setTimeout(load, 5000);
      } else showMsg("err", "배치 채점 실패");
    } finally { setBatchRunning(false); }
  };

  const s = data?.summary;
  const gradeStats = s ? [
    { g: "A", n: s.grade_a, color: "bg-emerald-500" },
    { g: "B", n: s.grade_b, color: "bg-blue-500" },
    { g: "C", n: s.grade_c, color: "bg-yellow-500" },
    { g: "D", n: s.grade_d, color: "bg-orange-500" },
    { g: "F", n: s.grade_f, color: "bg-red-500" },
  ] : [];

  return (
    <div className="space-y-5">
      {msg && (
        <div className={cn("rounded-xl px-4 py-2.5 text-sm border", msg.type === "ok" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20")}>
          {msg.text}
        </div>
      )}

      {/* 상단 요약 + 버튼 */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="text-[13px] text-muted-foreground">
          완성된 리포트를 자동으로 채점합니다. 새 분석이 완료될 때마다 자동으로 점수가 기록됩니다.
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} /> 새로고침
          </button>
          <button
            onClick={batchRescore}
            disabled={batchRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {batchRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
            전체 재채점
          </button>
        </div>
      </div>

      {/* 집계 카드 */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-[10px] text-muted-foreground mb-1">완성 리포트</p>
            <p className="text-xl font-bold tabular-nums">{Number(s.total).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">미채점 {Number(s.unscored).toLocaleString()}건</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-[10px] text-muted-foreground mb-1">평균 점수</p>
            <p className="text-xl font-bold tabular-nums">{s.avg_score ? `${s.avg_score}점` : "—"}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3 col-span-2">
            <p className="text-[10px] text-muted-foreground mb-2">등급 분포</p>
            <div className="flex items-end gap-2 h-10">
              {gradeStats.map(({ g, n, color }) => {
                const cnt = Number(n);
                const total = Number(s.total) || 1;
                const pct = Math.round((cnt / total) * 100);
                return (
                  <div key={g} className="flex flex-col items-center gap-0.5 flex-1">
                    <span className="text-[10px] text-muted-foreground">{cnt}</span>
                    <div className="w-full rounded-sm" style={{ height: `${Math.max(4, pct * 0.28)}px` }}>
                      <div className={cn("w-full h-full rounded-sm opacity-80", color)} />
                    </div>
                    <span className={cn("text-[10px] font-bold", gradeColor(g))}>{g}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-1.5">
        {([["all", "전체"], ["low", "C 이하 (저품질)"], ["unscored", "미채점"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilterScore(k)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              filterScore === k
                ? "bg-primary text-white border-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 리포트 테이블 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.reports.length ? (
        <div className="rounded-xl border border-border bg-muted/20 py-16 text-center text-muted-foreground text-sm">
          해당하는 리포트 없음
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-background overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">종목</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">점수</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">등급</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">실패 항목</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">의견</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">일시</th>
                <th className="px-3 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody>
              {data.reports.map(r => (
                <tr key={r.id} className="border-b border-border/30 last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-2.5">
                    <a
                      href={`/analysis/${r.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 group"
                    >
                      <span className="font-mono text-xs font-semibold group-hover:text-primary transition-colors">{r.ticker}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[100px]">{r.company_name}</span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0" />
                    </a>
                    {r.user_name && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{r.user_name}</p>}
                  </td>
                  <td className="px-3 py-2.5 w-28">
                    {r.qa_score !== null ? scoreBar(r.qa_score) : <span className="text-[11px] text-muted-foreground/40">미채점</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn("text-base font-black tabular-nums", gradeColor(r.grade))}>{r.grade}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {r.qa_flags.length === 0
                        ? <span className="text-[10px] text-emerald-500 font-medium">전항목 통과</span>
                        : r.qa_flags.map(f => (
                            <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-medium whitespace-nowrap">
                              {FLAG_LABELS[f] ?? f}
                            </span>
                          ))
                      }
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground truncate max-w-[80px] block">
                      {r.investment_verdict ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-[11px] text-muted-foreground whitespace-nowrap">
                    {fmt(r.created_at)}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => rescore(r.id)}
                      disabled={rescoring === r.id}
                      title="재채점"
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
                    >
                      {rescoring === r.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />
                      }
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 피어 이상 탭 ────────────────────────────────────────────────────────────

interface PeerIssueItem {
  id: number;
  ticker: string;
  companyName: string;
  industry: string | null;
  verdict: string | null;
  qaScore: number | null;
  createdAt: string;
  validPeerCount: number;
  totalPeerCount: number;
  issues: Array<{ type: string; ticker?: string; detail: string; severity: string }>;
}
interface PeerIssuesData {
  items: PeerIssueItem[];
  typeCounts: Record<string, number>;
  totalIssues: number;
  uncheckedCount: number;
}

const ISSUE_TYPE_LABEL: Record<string, string> = {
  no_data:         "데이터 없는 티커",
  count_low:       "피어 수 부족",
  size_extreme:    "시총 규모 불일치",
  sector_mismatch: "섹터 불일치",
};

function PeerIssuesTab() {
  const [data, setData] = useState<PeerIssuesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/peer-issues"), { credentials: "include" });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runValidateAll = async () => {
    setValidating(true);
    try {
      const r = await fetch(getApiUrl("/api/admin/peer-validate-all"), {
        method: "POST", credentials: "include",
      });
      if (r.ok) {
        const d = await r.json();
        alert(`${d.message}\n완료 후 새로고침하세요.`);
      }
    } finally { setValidating(false); }
  };

  const toggle = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          AI가 오선정한 피어(동종 비교 기업) 자동 감지 결과입니다.
          이상이 있는 보고서는 피어 비교 섹션의 신뢰도가 낮을 수 있습니다.
        </p>
        <div className="flex gap-2 shrink-0">
          <button onClick={load} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {(data?.uncheckedCount ?? 0) > 0 && (
            <button
              onClick={runValidateAll}
              disabled={validating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
            >
              {validating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              기존 {data?.uncheckedCount}개 검증
            </button>
          )}
        </div>
      </div>

      {/* 요약 */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground mb-1">이상 감지 보고서</p>
            <p className={cn("text-2xl font-bold tabular-nums", data.totalIssues > 0 ? "text-red-500" : "text-green-600")}>
              {data.totalIssues}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground mb-1">미검증</p>
            <p className={cn("text-2xl font-bold tabular-nums", data.uncheckedCount > 0 ? "text-amber-500" : "text-muted-foreground")}>
              {data.uncheckedCount}
            </p>
          </div>
          {Object.entries(data.typeCounts).map(([type, count]) => (
            <div key={type} className="rounded-lg bg-muted/40 p-3">
              <p className="text-[10px] text-muted-foreground mb-1">{ISSUE_TYPE_LABEL[type] ?? type}</p>
              <p className="text-2xl font-bold tabular-nums text-orange-500">{count}</p>
            </div>
          ))}
        </div>
      )}

      {/* 이상 목록 */}
      {data?.items.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-green-600 py-8 justify-center">
          <CheckCircle2 className="w-4 h-4" /> 피어 이상 없음
        </div>
      ) : (
        <div className="space-y-2">
          {data?.items.map(item => {
            const isOpen = expanded.has(item.id);
            const errorCount = item.issues.filter(i => i.severity === "error").length;
            const warnCount = item.issues.filter(i => i.severity === "warning").length;
            return (
              <div key={item.id} className="rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => toggle(item.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                >
                  <div className="shrink-0">
                    {errorCount > 0
                      ? <XCircle className="w-4 h-4 text-red-500" />
                      : <AlertTriangle className="w-4 h-4 text-amber-500" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{item.ticker}</span>
                      <span className="text-sm font-medium text-foreground truncate">{item.companyName}</span>
                      {item.industry && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{item.industry}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                      <span>피어 {item.validPeerCount}/{item.totalPeerCount}개 유효</span>
                      {item.qaScore != null && <span>QA {item.qaScore}점</span>}
                      <span>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {errorCount > 0 && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600">오류 {errorCount}</span>
                    )}
                    {warnCount > 0 && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-600">경고 {warnCount}</span>
                    )}
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border px-4 py-3 space-y-1.5 bg-muted/20">
                    {item.issues.map((issue, i) => (
                      <div key={i} className={cn(
                        "flex items-start gap-2 text-xs p-2 rounded-lg",
                        issue.severity === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                      )}>
                        {issue.severity === "error"
                          ? <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        }
                        <div>
                          <span className="font-semibold mr-1">[{ISSUE_TYPE_LABEL[issue.type] ?? issue.type}]</span>
                          {issue.detail}
                        </div>
                      </div>
                    ))}
                    <a
                      href={`/analysis/${item.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
                    >
                      <ExternalLink className="w-3 h-3" /> 보고서 보기
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 섹터 모델 보정 탭 ───────────────────────────────────────────────────────

const SECTOR_LABELS: Record<string, string> = {
  KR_BIOTECH: "한국 · 바이오/제약", KR_SEMICONDUCTOR: "한국 · 반도체",
  KR_FINANCIAL: "한국 · 금융/은행/보험", KR_CONSTRUCTION: "한국 · 건설/주택",
  KR_TELECOM: "한국 · 통신", KR_REIT: "한국 · 리츠", KR_AUTO: "한국 · 자동차",
  KR_OTHER: "한국 · 기타",
  US_BIOTECH: "미국 · 바이오/제약", US_TECH: "미국 · 테크/반도체",
  US_FINANCIAL: "미국 · 금융/은행/보험", US_REIT: "미국 · 리츠",
  US_ENERGY: "미국 · 에너지/자원", US_DEFENSE: "미국 · 방산/항공",
  US_TELECOM: "미국 · 통신", US_UTILITIES: "미국 · 유틸리티", US_OTHER: "미국 · 기타",
};

function AccuracyBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground text-xs">데이터 없음</span>;
  const pct = Math.round(value);
  const color = pct >= 60 ? "text-emerald-600 bg-emerald-50 border-emerald-200" : pct >= 50 ? "text-amber-600 bg-amber-50 border-amber-200" : "text-red-600 bg-red-50 border-red-200";
  const Icon = pct >= 60 ? CheckCircle2 : pct >= 50 ? Minus : AlertTriangle;
  return <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border", color)}><Icon className="w-3 h-3" />{pct}%</span>;
}

function DeviationBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground text-xs">데이터 없음</span>;
  const rounded = Math.round(value * 10) / 10;
  const abs = Math.abs(rounded);
  const isOver = rounded > 0;
  const severity = abs >= 10 ? "strong" : abs >= 5 ? "mild" : "low";
  const color = severity === "strong" ? (isOver ? "text-red-600 bg-red-50 border-red-200" : "text-blue-600 bg-blue-50 border-blue-200") : severity === "mild" ? "text-amber-600 bg-amber-50 border-amber-200" : "text-emerald-600 bg-emerald-50 border-emerald-200";
  return <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border", color)}>{isOver ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{isOver ? `+${rounded}%p 낙관` : `${rounded}%p 비관`}</span>;
}

function CalibGuideText({ acc, dev }: { acc: number | null; dev: number | null }) {
  if (acc === null && dev === null) return null;
  const lines: string[] = [];
  if (acc !== null && acc < 50) lines.push("방향 예측 불확실 → 중립 의견 가중치 증가");
  if (dev !== null && Math.abs(dev) >= 10) lines.push(dev > 0 ? `목표주가 ${Math.min(15, Math.round(Math.abs(dev) * 0.6))}% 하향 보정 적용 중` : `목표주가 ${Math.min(15, Math.round(Math.abs(dev) * 0.6))}% 상향 보정 적용 중`);
  else if (dev !== null && Math.abs(dev) >= 5) lines.push("소폭 편향 감지 → 하단 시나리오 가중치 증가 적용 중");
  if (lines.length === 0) lines.push("보정 미적용 (편향 허용 범위 내)");
  return <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">{lines.map((l, i) => <p key={i}>→ {l}</p>)}</div>;
}

function SectorHistoryChart({ sector, label }: { sector: string; label: string }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(getApiUrl(`/api/performance/calibration-history?sector=${encodeURIComponent(sector)}`), { credentials: "include" })
      .then(r => r.json()).then(d => setData(Array.isArray(d) ? d : [])).catch(() => setData([])).finally(() => setLoading(false));
  }, [sector]);
  if (loading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  if (data.length < 2) return <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">히스토리 데이터 부족 (재계산 2회 이상 필요)</div>;
  return (
    <div className="mt-4 space-y-4">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><History className="w-3 h-3" /> {label} · 성과 추이 ({data.length}회)</p>
      <div>
        <p className="text-[10px] text-muted-foreground mb-1">방향 정확도 (%)</p>
        <ResponsiveContainer width="100%" height={110}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: number) => [`${v?.toFixed(1)}%`, "정확도"]} />
            <ReferenceLine y={60} stroke="hsl(var(--chart-2))" strokeDasharray="4 2" />
            <ReferenceLine y={50} stroke="hsl(var(--destructive)/0.5)" strokeDasharray="4 2" />
            <Line type="monotone" dataKey="direction_accuracy" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="정확도" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground mb-1">목표주가 편향 (%p)</p>
        <ResponsiveContainer width="100%" height={110}>
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
  );
}

function CalibrationTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [recalcResult, setRecalcResult] = useState<any>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [expandedSector, setExpandedSector] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/performance/calibration"), { credentials: "include" });
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runRecalc = async () => {
    setRecalcLoading(true); setRecalcResult(null); setRecalcError(null);
    try {
      const r = await fetch(getApiUrl("/api/performance/recalculate"), { method: "POST", credentials: "include" });
      const data = await r.json();
      if (!r.ok) setRecalcError(data.error ?? "재계산 실패");
      else { setRecalcResult(data); load(); }
    } catch (e) { setRecalcError(String(e)); } finally { setRecalcLoading(false); }
  };

  const krRows = rows.filter(r => r.market === "KR");
  const usRows = rows.filter(r => r.market === "US");

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] text-muted-foreground">30일 이상 된 분석의 실제 주가 성과를 비교해 섹터별 편향을 측정합니다. 보정값은 이후 분석 프롬프트에 자동 주입됩니다.</p>
        <button onClick={runRecalc} disabled={recalcLoading} className="shrink-0 flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {recalcLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} 보정 재계산
        </button>
      </div>
      {recalcResult && <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"><p className="font-semibold">{recalcResult.message}</p><p className="text-[12px] mt-0.5 text-emerald-600 dark:text-emerald-400">분석 처리 {recalcResult.analysesProcessed}건 · 섹터 업데이트 {recalcResult.sectorsUpdated}개</p></div>}
      {recalcError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{recalcError}</div>}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/30 px-6 py-10 text-center space-y-2">
          <Brain className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="font-medium text-foreground">아직 보정 데이터가 없습니다</p>
          <p className="text-[13px] text-muted-foreground">30일 이상 된 완료 분석이 쌓인 후 "보정 재계산"을 눌러 시작하세요.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {[{ label: "한국 시장 (KR)", data: krRows }, { label: "미국 시장 (US)", data: usRows }].map(group =>
            group.data.length > 0 && (
              <section key={group.label}>
                <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">{group.label}</h2>
                <div className="space-y-2">
                  {group.data.map((row: any) => {
                    const sectorLabel = SECTOR_LABELS[row.sector] ?? row.sector;
                    const isExpanded = expandedSector === row.sector;
                    return (
                      <div key={row.sector} className="rounded-xl border border-border bg-background px-4 py-3.5">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground">{sectorLabel}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">샘플 {row.sample_count}건 · 최종 업데이트: {new Date(row.last_recalc_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            <div className="text-right"><p className="text-[10px] text-muted-foreground mb-1">방향 정확도</p><AccuracyBadge value={row.direction_accuracy} /></div>
                            <div className="text-right"><p className="text-[10px] text-muted-foreground mb-1">목표주가 편향</p><DeviationBadge value={row.avg_price_deviation} /></div>
                            <button onClick={() => setExpandedSector(isExpanded ? null : row.sector)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted transition-colors">
                              <History className="w-3 h-3" /><ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} />
                            </button>
                          </div>
                        </div>
                        {row.sample_count >= 3 ? <CalibGuideText acc={row.direction_accuracy} dev={row.avg_price_deviation} /> : <p className="text-[11px] text-amber-600 mt-1">→ 샘플 3건 미만 — 보정 미적용</p>}
                        {isExpanded && <div className="mt-3 pt-3 border-t border-border/50"><SectorHistoryChart sector={row.sector} label={sectorLabel} /></div>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )
          )}
        </div>
      )}
      <div className="rounded-xl border border-border bg-muted/20 px-4 py-4 space-y-2">
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">보정 동작 기준</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px] text-muted-foreground">
          <p>· 샘플 3건 이상 시 보정 활성화</p>
          <p>· 목표주가 편향 ±10%p 이상 → 강력 보정</p>
          <p>· 방향 정확도 50% 미만 → 투자의견 보수화</p>
          <p>· 편향 ±5~10%p → 하단 시나리오 가중치 증가</p>
        </div>
      </div>
    </div>
  );
}

// ─── 종목 보정 메모 탭 ───────────────────────────────────────────────────────

const INJECTION_BLOCK_STYLES: Record<string, { color: string; icon: React.ElementType; border: string; bg: string }> = {
  memo:              { color: "text-amber-500 dark:text-amber-400",   icon: PencilLine, border: "border-amber-500/20",  bg: "bg-amber-500/[0.04]"  },
  autoLearning:      { color: "text-blue-500 dark:text-blue-400",     icon: BarChart3,  border: "border-blue-500/20",   bg: "bg-blue-500/[0.04]"   },
  sectorCalibration: { color: "text-violet-500 dark:text-violet-400", icon: Brain,      border: "border-violet-500/20", bg: "bg-violet-500/[0.04]" },
};

function InjectionPreview({ ticker }: { ticker: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(ticker)}/prompt-injection`), { credentials: "include" });
      if (r.ok) { setData(await r.json()); setLoaded(true); }
    } finally { setLoading(false); }
  }, [ticker]);
  useEffect(() => { load(); }, [ticker]);
  if (loading && !loaded) return <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 로드 중…</div>;
  if (!data) return null;
  const isEmpty = (data.blocks ?? []).length === 0;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-border bg-muted/60 text-muted-foreground"><Cpu className="w-3 h-3" />{data.sectorKey || "섹터 미분류"}</span>
        {data.industry && <span className="text-[10px] text-muted-foreground/60">{data.industry}</span>}
        <span className="text-[10px] text-muted-foreground/50">분석 이력 {data.historyCount}회{data.historyCount >= 2 ? " ✓ 통계 주입됨" : " (2회 이상부터 통계 주입)"}</span>
      </div>
      {isEmpty ? (
        <div className="text-xs text-muted-foreground/50 italic py-1">현재 주입되는 보정 데이터 없음</div>
      ) : (data.blocks ?? []).map((block: any, i: number) => {
        const style = INJECTION_BLOCK_STYLES[block.type] ?? INJECTION_BLOCK_STYLES.memo;
        const Icon = style.icon;
        return (
          <div key={i} className={cn("rounded-lg border p-3 text-[12px]", style.border, style.bg)}>
            <div className="flex items-center gap-1.5 mb-2"><Icon className={cn("w-3.5 h-3.5 shrink-0", style.color)} /><span className={cn("text-[10px] font-bold uppercase tracking-wider", style.color)}>{block.label}</span></div>
            <pre className="text-foreground/70 leading-relaxed whitespace-pre-wrap font-sans text-[11.5px]">{block.content}</pre>
          </div>
        );
      })}
      <button onClick={load} className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"><RefreshCw className="w-3 h-3" /> 새로고침</button>
    </div>
  );
}

function TickerNoteItem({ note, onSaved }: { note: any; onSaved: (ticker: string, memo: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isInjectionOpen, setIsInjectionOpen] = useState(false);
  const [editMemo, setEditMemo] = useState(note.memo ?? "");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const isDirty = editMemo !== note.memo;
  const isKR = /^\d{6}$/.test(note.ticker);
  const displayName = isKR && note.companyName ? note.companyName : note.ticker;

  useEffect(() => { if (!isOpen) setEditMemo(note.memo ?? ""); }, [note.memo]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(note.ticker)}`), {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: editMemo }),
      });
      if (r.ok) { onSaved(note.ticker, editMemo); setSavedOk(true); setTimeout(() => setSavedOk(false), 2000); }
    } finally { setSaving(false); }
  };

  let hist: any[] = [];
  try {
    const parsed = typeof note.autoLearning === "string" ? JSON.parse(note.autoLearning) : note.autoLearning;
    hist = parsed?.history ?? [];
  } catch {}

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button onClick={() => { setIsOpen(o => !o); if (!isOpen) setEditMemo(note.memo ?? ""); }} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          {isKR && note.companyName ? (
            <span className="flex items-center gap-1.5"><span className="font-bold text-sm text-foreground">{note.companyName}</span><span className="text-xs font-mono text-muted-foreground/60">{note.ticker}</span></span>
          ) : (
            <span className="font-mono font-bold text-sm text-foreground">{note.ticker}</span>
          )}
          {note.memo ? <span className="text-xs text-muted-foreground truncate max-w-[220px]">{note.memo}</span> : <span className="text-xs text-muted-foreground/50 italic">메모 없음</span>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[11px] text-muted-foreground">{note.updatedAt ? new Date(note.updatedAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</span>
          {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          <div className="pt-3">
            <div className="flex items-center gap-1.5 mb-1.5"><PencilLine className="w-3.5 h-3.5 text-amber-400" /><label className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">관리자 보정 메모 (AI 분석에 반영됨)</label></div>
            <textarea
              value={editMemo}
              onChange={e => setEditMemo(e.target.value)}
              rows={4}
              placeholder={`${displayName}에 대한 보정 정보\n예) 발행주식수: 5,969,782,550주`}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-muted-foreground">{editMemo.length}/1000자</span>
              <button
                onClick={save} disabled={saving || !isDirty}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors", isDirty ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-muted text-muted-foreground cursor-default")}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedOk ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {savedOk ? "저장됨" : "저장"}
              </button>
            </div>
          </div>
          {hist.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <label className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">🤖 AI 자동학습 이력 ({hist.length}회, 읽기 전용)</label>
              <div className="space-y-1.5">
                {hist.map((h: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground border-l-2 border-blue-400/30 pl-2">
                    <span className="font-mono text-muted-foreground/60">{h.date?.slice(0, 10) ?? "-"}</span>
                    <span className={cn("font-semibold", /Buy/i.test(h.verdict ?? "") ? "text-emerald-500" : /Sell/i.test(h.verdict ?? "") ? "text-red-500" : "text-amber-500")}>{h.verdict ?? "-"}</span>
                    <span>진입 {h.entryPrice?.toLocaleString() ?? "-"} → 목표 {h.targetPrice?.toLocaleString() ?? "-"}</span>
                    <span className={cn("font-medium", (h.upsidePct ?? 0) >= 0 ? "text-emerald-500" : "text-red-500")}>{(h.upsidePct ?? 0) >= 0 ? "+" : ""}{h.upsidePct?.toFixed(1) ?? "-"}%</span>
                    {h.actualReturn !== undefined && <span className="text-muted-foreground/50">실제 {h.actualReturn >= 0 ? "+" : ""}{Number(h.actualReturn).toFixed(1)}%{h.daysElapsed ? ` (${h.daysElapsed}일)` : ""}</span>}
                    {h.directionMatch !== undefined && h.directionMatch !== null && <span>{h.directionMatch ? "✓ 방향일치" : "✗ 방향불일치"}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-border/60 pt-3">
            <button onClick={() => setIsInjectionOpen(o => !o)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
              <Eye className="w-3.5 h-3.5 text-violet-400" />
              <span className="font-semibold text-violet-500 dark:text-violet-400 uppercase tracking-wide text-[10px]">프롬프트 주입 미리보기</span>
              <span className="text-[10px] text-muted-foreground/50 ml-1">— 실제 Gemini에 전달되는 보정 내용</span>
              {isInjectionOpen ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </button>
            {isInjectionOpen && <div className="mt-3"><InjectionPreview ticker={note.ticker} /></div>}
          </div>
        </div>
      )}
    </div>
  );
}

function TickerNotesTab() {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [newTicker, setNewTicker] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/ticker-notes"), { credentials: "include" });
      if (r.ok) setNotes(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addTicker = async () => {
    const t = newTicker.trim().toUpperCase();
    if (!t) return;
    if (notes.find(n => n.ticker === t)) { setNewTicker(""); return; }
    setAdding(true);
    try {
      const r = await fetch(getApiUrl(`/api/ticker-notes/${encodeURIComponent(t)}`), {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: "" }),
      });
      if (r.ok) {
        setNotes(prev => [{ ticker: t, companyName: null, memo: "", autoLearning: "", updatedAt: new Date().toISOString() }, ...prev]);
        setNewTicker("");
      }
    } finally { setAdding(false); }
  };

  const q = search.toUpperCase();
  const filtered = notes.filter(n =>
    !search || n.ticker.includes(q) || (n.companyName ?? "").toLowerCase().includes(search.toLowerCase()) || n.memo.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">종목별 AI 분석에 반영되는 관리자 보정 메모, AI 자동학습 이력, 프롬프트 주입 내용을 확인합니다.</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Plus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={newTicker} onChange={e => setNewTicker(e.target.value)} onKeyDown={e => e.key === "Enter" && addTicker()} placeholder="티커 추가 (예: 005930, AAPL)" className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 uppercase" />
        </div>
        <button onClick={addTicker} disabled={adding || !newTicker.trim()} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors">
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : "추가"}
        </button>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted text-muted-foreground text-xs hover:bg-muted/80 transition-colors">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="종목명·티커·메모 검색" className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
      {loading && notes.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> 불러오는 중…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">{search ? "검색 결과가 없습니다" : "등록된 메모가 없습니다"}</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(note => (
            <TickerNoteItem
              key={note.ticker}
              note={note}
              onSaved={(ticker, memo) => setNotes(prev => prev.map(n => n.ticker === ticker ? { ...n, memo, updatedAt: new Date().toISOString() } : n))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 종목 커버리지 탭 ────────────────────────────────────────────────────────

interface CoverageItem {
  ticker: string;
  name: string;
  exchange: string;
  isCovered: boolean;
  reportCount: number;
  lastDate: string | null;
}

interface CoverageData {
  tickers: CoverageItem[];
  total: number;
  totalFull: number;
  covered: number;
  uncovered: number;
  page: number;
  pages: number;
  limit: number;
}

function CoverageTab() {
  const [market, setMarket]   = useState<"KR" | "US">("KR");
  const [search, setSearch]   = useState("");
  const [status, setStatus]   = useState<"all" | "covered" | "uncovered">("all");
  const [page, setPage]       = useState(1);
  const [data, setData]       = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ market, search, status, page: String(page), limit: "50" });
      const r = await fetch(getApiUrl(`/api/admin/ticker-coverage?${params}`), { credentials: "include" });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, [market, search, status, page]);

  useEffect(() => { load(); }, [load]);

  const coverPct = data ? Math.round((data.covered / Math.max(1, data.totalFull)) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* 헤더 + 마켓 토글 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> 종목 커버리지
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">AI 자동 분석 대상 종목 및 보고서 현황</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
          {(["KR", "US"] as const).map(m => (
            <button key={m} onClick={() => setMarket(m)}
              className={cn("px-3 py-1.5 text-xs font-semibold rounded-md transition-colors",
                market === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}>
              {m === "KR" ? "🇰🇷 국내" : "🇺🇸 해외"}
            </button>
          ))}
        </div>
      </div>

      {/* 커버리지 요약 */}
      {data && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">전체 대상</p>
              <p className="text-xl font-black tabular-nums">{data.totalFull.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">보고서 있음</p>
              <p className="text-xl font-black tabular-nums text-green-400">{data.covered.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">미분석</p>
              <p className="text-xl font-black tabular-nums text-muted-foreground/60">{data.uncovered.toLocaleString()}</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>커버리지</span>
              <span className="font-semibold text-foreground">{coverPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${coverPct}%`, background: "linear-gradient(90deg, #FF8A7A, #ff6b58)" }} />
            </div>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="종목명 / 코드 검색"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
          {([["all", "전체"], ["covered", "보고서 있음"], ["uncovered", "미분석"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v)}
              className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                status === v ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}>
              {l}
            </button>
          ))}
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {/* 목록 */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* 헤더 */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 bg-muted/40 border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>종목</span>
          <span className="text-right">거래소</span>
          <span className="text-right w-16">보고서</span>
          <span className="text-right w-20">최근 분석</span>
        </div>
        {!data || data.tickers.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {loading ? "로딩 중…" : "조건에 맞는 종목이 없습니다"}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.tickers.map(t => (
              <div key={t.ticker} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2.5 items-center hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", t.isCovered ? "bg-green-400" : "bg-muted-foreground/30")} />
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{t.ticker}</span>
                  <span className="text-sm text-foreground truncate">{t.name}</span>
                </div>
                <span className="text-[11px] text-muted-foreground/70 text-right">{t.exchange}</span>
                <span className={cn("text-xs font-semibold tabular-nums text-right w-16",
                  t.reportCount > 0 ? "text-green-400" : "text-muted-foreground/30")}>
                  {t.reportCount > 0 ? `${t.reportCount}건` : "—"}
                </span>
                <span className="text-[11px] text-muted-foreground text-right w-20">
                  {t.lastDate ? t.lastDate.slice(5) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{data.total.toLocaleString()}개 중 {(page - 1) * data.limit + 1}–{Math.min(page * data.limit, data.total)}개</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono">{page} / {data.pages}</span>
            <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page >= data.pages}
              className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 페이지 ─────────────────────────────────────────────────────────────

type Tab = "monitoring" | "qa" | "prompts" | "peers" | "calibration" | "tickerNotes" | "coverage";

export default function AdminQuality() {
  const [tab, setTab] = useState<Tab>("monitoring");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "monitoring",  label: "분석 모니터링", icon: Activity },
    { key: "qa",          label: "QA 채점",       icon: ShieldCheck },
    { key: "peers",       label: "피어 이상",      icon: Users },
    { key: "calibration", label: "섹터 보정",      icon: Brain },
    { key: "tickerNotes", label: "종목 메모",      icon: StickyNote },
    { key: "coverage",    label: "종목 커버리지",  icon: Target },
    { key: "prompts",     label: "프롬프트 버전",  icon: FlaskConical },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" /> AI 관리
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          오류율 모니터링, QA 채점, 섹터 모델 보정, 종목별 메모 관리를 한 곳에서.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-0">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {tab === "monitoring"  && <MonitoringTab />}
        {tab === "qa"          && <QATab />}
        {tab === "peers"       && <PeerIssuesTab />}
        {tab === "calibration" && <CalibrationTab />}
        {tab === "tickerNotes" && <TickerNotesTab />}
        {tab === "coverage"    && <CoverageTab />}
        {tab === "prompts"     && <PromptVersionTab />}
      </div>
    </div>
  );
}
