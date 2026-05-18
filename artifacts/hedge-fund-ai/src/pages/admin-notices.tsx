import { useState, useEffect, useCallback } from "react";
import { Loader2, Plus, Trash2, Edit3, Bell, RefreshCw, Pin, PinOff, X, Check } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

interface Notice {
  id: number;
  title: string;
  content: string;
  category: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ["공지", "업데이트", "법적고지", "점검", "이벤트"];

const CATEGORY_COLORS: Record<string, string> = {
  "공지": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "업데이트": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "법적고지": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "점검": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "이벤트": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

function formatDate(iso: string, isEn: boolean) {
  return new Date(iso).toLocaleString(isEn ? "en-US" : "ko-KR", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const EMPTY_FORM = { title: "", content: "", category: "공지", is_pinned: false };

export default function AdminNotices() {
  const { isEn } = useLanguage();
  const t = (ko: string, en: string) => isEn ? en : ko;
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("api/notices"), { credentials: "include" });
      if (r.status === 403) { setForbidden(true); return; }
      const d = await r.json();
      setNotices(Array.isArray(d) ? d : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (n: Notice) => {
    setEditingId(n.id);
    setForm({ title: n.title, content: n.content, category: n.category, is_pinned: n.is_pinned });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      const url = editingId
        ? getApiUrl(`api/admin/notices/${editingId}`)
        : getApiUrl("api/admin/notices");
      const r = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (r.ok) {
        setShowForm(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        await load();
      }
    } finally { setSaving(false); }
  };

  const togglePin = async (n: Notice) => {
    await fetch(getApiUrl(`api/admin/notices/${n.id}`), {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_pinned: !n.is_pinned }),
    });
    setNotices(prev => prev.map(i => i.id === n.id ? { ...i, is_pinned: !n.is_pinned } : i));
  };

  const handleDelete = async (id: number) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setDeletingId(id); setConfirmDelete(null);
    try {
      await fetch(getApiUrl(`api/admin/notices/${id}`), { method: "DELETE", credentials: "include" });
      setNotices(prev => prev.filter(n => n.id !== id));
    } finally { setDeletingId(null); }
  };

  if (forbidden) return (
    <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground text-sm">{t("관리자 전용 페이지입니다.", "Admin only page.")}</div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary" />
            {t("공지사항 관리", "Notice Management")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("총", "Total")} <span className="font-semibold text-foreground">{notices.length}</span>{t("건", " items")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> {t("새로고침", "Refresh")}
          </button>
          <button onClick={openNew}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" /> {t("공지 작성", "New Notice")}
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="border border-primary/30 bg-primary/5 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">{editingId ? t("공지 수정", "Edit Notice") : t("새 공지 작성", "New Notice")}</h2>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Category + Pin */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5 flex-wrap">
              {CATEGORIES.map(c => (
                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, category: c }))}
                  className={cn("px-3 py-1 text-xs rounded-full border font-medium transition-all",
                    form.category === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/30 text-muted-foreground border-border hover:border-primary/40"
                  )}>{c}</button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input type="checkbox" checked={form.is_pinned} onChange={e => setForm(f => ({ ...f, is_pinned: e.target.checked }))}
                className="rounded" />
              <Pin className="w-3.5 h-3.5 text-primary" /> {t("필독 고정", "Pin as Required")}
            </label>
          </div>

          {/* Title */}
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder={t("제목을 입력하세요", "Enter title")}
            className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:border-primary/60"
          />

          {/* Content */}
          <textarea
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            placeholder={t("공지 내용을 입력하세요...", "Enter notice content...")}
            rows={8}
            className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:border-primary/60 resize-none"
          />

          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setEditingId(null); }}
              className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:border-primary/40">
              {t("취소", "Cancel")}
            </button>
            <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.content.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-40">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editingId ? t("수정 저장", "Save Changes") : t("공지 등록", "Post Notice")}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : notices.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <Bell className="w-10 h-10 opacity-30" />
          <p className="text-sm">{t("공지사항이 없습니다.", "No notices yet.")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notices.map(notice => {
            const isExpanded = expandedId === notice.id;
            const catColor = CATEGORY_COLORS[notice.category] ?? "bg-muted text-muted-foreground";
            return (
              <div key={notice.id} className={cn(
                "bg-card border rounded-2xl overflow-hidden",
                notice.is_pinned ? "border-primary/40" : "border-border"
              )}>
                <div className="px-4 py-3.5 flex items-start gap-3">
                  <button className="flex-1 text-left flex items-center gap-2 flex-wrap min-w-0"
                    onClick={() => setExpandedId(isExpanded ? null : notice.id)}>
                    {notice.is_pinned && (
                      <span className="text-[10px] font-bold text-primary border border-primary/40 rounded px-1.5 py-0.5 shrink-0">{t("필독", "Required")}</span>
                    )}
                    <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0", catColor)}>{notice.category}</span>
                    <span className="text-sm font-medium truncate">{notice.title}</span>
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">{formatDate(notice.created_at, isEn)}</span>
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => togglePin(notice)} title={notice.is_pinned ? t("고정 해제", "Unpin") : t("필독 고정", "Pin as Required")}
                      className={cn("p-1.5 rounded-lg transition-colors",
                        notice.is_pinned ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                      )}>
                      {notice.is_pinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
                    </button>
                    <button onClick={() => openEdit(notice)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {confirmDelete === notice.id ? (
                      <>
                        <button onClick={() => handleDelete(notice.id)} className="px-2 py-1 text-[11px] bg-destructive text-destructive-foreground rounded-md">{t("삭제확인", "Confirm")}</button>
                        <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 text-[11px] border border-border rounded-md text-muted-foreground">{t("취소", "Cancel")}</button>
                      </>
                    ) : (
                      <button onClick={() => handleDelete(notice.id)} disabled={deletingId === notice.id}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40">
                        {deletingId === notice.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border pt-3 text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                    {notice.content}
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
