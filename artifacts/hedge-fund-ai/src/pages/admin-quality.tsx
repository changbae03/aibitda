import { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, Clock, BarChart2, Plus, Edit3, Trash2,
  CheckCircle2, X, Save, ChevronDown, ChevronUp, Activity, FlaskConical,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
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
        <div className="rounded-xl border border-border bg-background overflow-hidden">
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

// ─── 메인 페이지 ─────────────────────────────────────────────────────────────

type Tab = "monitoring" | "prompts";

export default function AdminQuality() {
  const [tab, setTab] = useState<Tab>("monitoring");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "monitoring", label: "분석 모니터링", icon: Activity },
    { key: "prompts", label: "프롬프트 버전", icon: FlaskConical },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" /> AI 품질 관리
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          분석 오류율·소요 시간 모니터링과 프롬프트 버전 관리를 한 곳에서.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-border pb-0">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
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
        {tab === "monitoring" && <MonitoringTab />}
        {tab === "prompts" && <PromptVersionTab />}
      </div>
    </div>
  );
}
