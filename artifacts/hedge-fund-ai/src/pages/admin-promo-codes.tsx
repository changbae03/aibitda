import { useState, useEffect } from "react";
import { Tag, Plus, Trash2, ToggleLeft, ToggleRight, Loader2, AlertCircle, Check, X } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface PromoCode {
  id: number;
  code: string;
  description: string | null;
  credit_amount: number;
  tier_upgrade: string | null;
  max_uses: number | null;
  uses_count: number;
  expires_at: string | null;
  enabled: boolean;
  created_at: string;
}

const TIER_LABEL: Record<string, string> = {
  beta: "베타", premium: "프리미엄",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminPromoCodes() {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "", description: "", credit_amount: "0", tier_upgrade: "",
    max_uses: "", expires_at: "",
  });
  const [formErr, setFormErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(getApiUrl("/api/admin/promo-codes"), { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setCodes(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.code.trim()) { setFormErr("코드를 입력하세요"); return; }
    setSaving(true); setFormErr(null);
    try {
      const r = await fetch(getApiUrl("/api/admin/promo-codes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: form.code.trim(),
          description: form.description || null,
          credit_amount: parseInt(form.credit_amount) || 0,
          tier_upgrade: form.tier_upgrade || null,
          max_uses: form.max_uses ? parseInt(form.max_uses) : null,
          expires_at: form.expires_at || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setFormErr(d.error ?? "오류 발생"); return; }
      setShowForm(false);
      setForm({ code: "", description: "", credit_amount: "0", tier_upgrade: "", max_uses: "", expires_at: "" });
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: number) => {
    await fetch(getApiUrl(`/api/admin/promo-codes/${id}/toggle`), { method: "PATCH", credentials: "include" });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(getApiUrl(`/api/admin/promo-codes/${id}`), { method: "DELETE", credentials: "include" });
    load();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" />
            프로모 코드 관리
          </h1>
          <p className="text-sm text-muted-foreground mt-1">크레딧 지급·등급 업그레이드 코드 생성 및 관리</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          코드 생성
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-5 rounded-2xl border border-border bg-card shadow-sm">
          <h2 className="text-sm font-bold mb-4">새 프로모 코드</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">코드 *</label>
              <input
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="LAUNCH2026"
                className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">설명</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="런칭 기념 코드"
                className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">지급 크레딧</label>
              <input
                type="number" min="0"
                value={form.credit_amount}
                onChange={e => setForm(f => ({ ...f, credit_amount: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">등급 업그레이드</label>
              <select
                value={form.tier_upgrade}
                onChange={e => setForm(f => ({ ...f, tier_upgrade: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">없음</option>
                <option value="beta">베타</option>
                <option value="premium">프리미엄</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">최대 사용 수</label>
              <input
                type="number" min="1"
                value={form.max_uses}
                onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))}
                placeholder="무제한"
                className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">만료일</label>
              <input
                type="datetime-local"
                value={form.expires_at}
                onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          {formErr && (
            <p className="mt-2 text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{formErr}</p>
          )}
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              저장
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-muted/50 animate-pulse" />)}</div>
      ) : codes.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Tag className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">등록된 프로모 코드가 없습니다</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">코드</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">혜택</th>
                <th className="px-4 py-3 text-center font-semibold text-muted-foreground">사용수</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">만료일</th>
                <th className="px-4 py-3 text-center font-semibold text-muted-foreground">상태</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">액션</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c, i) => (
                <tr key={c.id} className={cn("border-b border-border/50", i % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold text-foreground">{c.code}</span>
                    {c.description && <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.credit_amount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                          +{c.credit_amount} 크레딧
                        </span>
                      )}
                      {c.tier_upgrade && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
                          {TIER_LABEL[c.tier_upgrade] ?? c.tier_upgrade}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-mono tabular-nums">
                    {c.uses_count}{c.max_uses !== null ? `/${c.max_uses}` : ""}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(c.expires_at)}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleToggle(c.id)}>
                      {c.enabled
                        ? <ToggleRight className="w-5 h-5 text-emerald-500 inline" />
                        : <ToggleLeft className="w-5 h-5 text-muted-foreground inline" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <Trash2 className="w-4 h-4" />
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
