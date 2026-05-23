import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp,
  Loader2, BookOpen, Save, Eye, EyeOff,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
const CATEGORIES = ["전체", "FOMC", "지정학", "원자재", "금리", "유가", "고용", "부동산", "기타"] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_COLORS: Record<string, string> = {
  FOMC:    "bg-violet-500/15 text-violet-400 border-violet-500/30",
  지정학:  "bg-orange-500/15 text-orange-400 border-orange-500/30",
  원자재:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  금리:    "bg-blue-500/15 text-blue-400 border-blue-500/30",
  유가:    "bg-green-500/15 text-green-400 border-green-500/30",
  고용:    "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  부동산:  "bg-rose-500/15 text-rose-400 border-rose-500/30",
  기타:    "bg-muted/60 text-muted-foreground border-border",
};

interface MacroReport {
  id: number;
  title: string;
  category: string;
  summary: string | null;
  content?: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border",
      CATEGORY_COLORS[category] ?? CATEGORY_COLORS["기타"]
    )}>
      {category}
    </span>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted/40", className)} />;
}

function ReportCard({
  report,
  isAdmin,
  onEdit,
  onDelete,
}: {
  report: MacroReport;
  isAdmin: boolean;
  onEdit: (r: MacroReport) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(report.content ?? null);
  const [contentLoading, setContentLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleExpand = async () => {
    if (!expanded && content === null) {
      setContentLoading(true);
      try {
        const r = await fetch(getApiUrl(`/api/macro-reports/${report.id}`));
        if (r.ok) { const d = await r.json(); setContent(d.content); }
      } catch {}
      setContentLoading(false);
    }
    setExpanded((v) => !v);
  };

  return (
    <motion.div
      layout
      className="bg-card border border-border rounded-xl overflow-hidden"
    >
      <button
        className="w-full text-left p-4 sm:p-5 flex items-start gap-3 hover:bg-accent/40 transition-colors"
        onClick={handleExpand}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <CategoryBadge category={report.category} />
            <span className="text-[11px] text-muted-foreground/50">
              {format(new Date(report.created_at), "yyyy. M. d.", { locale: ko })}
            </span>
            {!report.is_published && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">비공개</span>
            )}
          </div>
          <h3 className="text-[15px] font-semibold text-foreground leading-snug line-clamp-2 text-left">
            {report.title}
          </h3>
          {report.summary && !expanded && (
            <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed line-clamp-2 text-left">
              {report.summary}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {isAdmin && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(report); }}
                className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
                title="수정"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {confirmDelete ? (
                <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(report.id); }}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                    className="p-1.5 rounded-lg text-muted-foreground/50 hover:bg-accent transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                  className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="삭제"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground/40" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground/40" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-5 pb-5 border-t border-border/50 pt-4">
              {contentLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중...
                </div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/85 text-[13.5px] leading-[1.85] whitespace-pre-wrap">
                  {content ?? "내용을 불러올 수 없습니다."}
                </div>
              )}
              {report.updated_at !== report.created_at && (
                <p className="mt-4 text-[11px] text-muted-foreground/40">
                  마지막 수정: {format(new Date(report.updated_at), "yyyy. M. d. HH:mm", { locale: ko })}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ReportForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: MacroReport | null;
  onSave: (r: MacroReport) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "기타");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [isPublished, setIsPublished] = useState(initial?.is_published ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      setError("제목과 본문을 입력해주세요."); return;
    }
    setSaving(true); setError("");
    try {
      const isEdit = !!initial;
      const url = isEdit
        ? getApiUrl(`/api/admin/macro-reports/${initial!.id}`)
        : getApiUrl(`/api/admin/macro-reports`);
      const r = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, summary, content, is_published: isPublished }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "저장 실패"); setSaving(false); return; }
      onSave(data);
    } catch (e: any) {
      setError(e.message ?? "저장 실패");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-[15px] font-semibold">
            {initial ? "보고서 수정" : "새 매크로 보고서"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 카테고리 */}
          <div>
            <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">카테고리</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.filter(c => c !== "전체").map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[12px] font-medium border transition-all",
                    category === c
                      ? (CATEGORY_COLORS[c] ?? CATEGORY_COLORS["기타"]) + " ring-1 ring-current"
                      : "bg-muted/40 text-muted-foreground border-border hover:bg-accent"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* 제목 */}
          <div>
            <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">제목 *</label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="보고서 제목"
              className="w-full px-3 py-2.5 text-[14px] bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-[#FF8A7A]/50"
            />
          </div>

          {/* 요약 */}
          <div>
            <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">요약 (선택)</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="카드에 표시될 짧은 요약문"
              rows={2}
              className="w-full px-3 py-2.5 text-[13.5px] bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-[#FF8A7A]/50 leading-relaxed"
            />
          </div>

          {/* 본문 */}
          <div>
            <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">본문 *</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="보고서 본문 내용을 작성하세요."
              rows={14}
              className="w-full px-3 py-2.5 text-[13.5px] bg-background border border-border rounded-lg resize-y focus:outline-none focus:ring-1 focus:ring-[#FF8A7A]/50 leading-relaxed font-mono"
            />
          </div>

          {/* 공개 여부 */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <button
              type="button"
              onClick={() => setIsPublished((v) => !v)}
              className={cn(
                "relative w-9 h-5 rounded-full transition-colors",
                isPublished ? "bg-[#FF8A7A]" : "bg-muted"
              )}
            >
              <span className={cn(
                "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                isPublished ? "translate-x-4" : "translate-x-0"
              )} />
            </button>
            <span className="text-[13px] text-muted-foreground flex items-center gap-1">
              {isPublished ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {isPublished ? "공개" : "비공개"}
            </span>
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-accent transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-[#FF8A7A] text-white hover:bg-[#FF8A7A]/90 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MacroReports() {
  const { isEn } = useLanguage();
  const [reports, setReports] = useState<MacroReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<Category>("전체");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<MacroReport | null>(null);

  useEffect(() => {
    fetch(getApiUrl("/api/admin/dashboard"))
      .then((r) => { if (r.ok) setIsAdmin(true); })
      .catch(() => {});
  }, []);

  const fetchReports = async (category = activeCategory) => {
    setLoading(true);
    try {
      const url = category === "전체"
        ? getApiUrl("/api/macro-reports")
        : getApiUrl(`/api/macro-reports?category=${encodeURIComponent(category)}`);
      const r = await fetch(url);
      if (r.ok) setReports(await r.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchReports(activeCategory); }, [activeCategory]);

  const handleSave = (saved: MacroReport) => {
    setReports((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    setShowForm(false);
    setEditTarget(null);
  };

  const handleDelete = async (id: number) => {
    try {
      const r = await fetch(getApiUrl(`/api/admin/macro-reports/${id}`), { method: "DELETE" });
      if (r.ok) setReports((prev) => prev.filter((rp) => rp.id !== id));
    } catch {}
  };

  const handleEdit = async (report: MacroReport) => {
    if (report.content === undefined) {
      const r = await fetch(getApiUrl(`/api/macro-reports/${report.id}`));
      if (r.ok) { const d = await r.json(); setEditTarget(d); }
      else setEditTarget(report);
    } else {
      setEditTarget(report);
    }
    setShowForm(true);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">
            매크로 분석 보고서
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            FOMC, 지정학, 금리, 원자재 등 주요 매크로 이슈 심층 분석
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold bg-[#FF8A7A] text-white hover:bg-[#FF8A7A]/90 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" /> 보고서 작성
          </button>
        )}
      </div>

      {/* 카테고리 필터 */}
      <div className="flex gap-1.5 flex-wrap mb-6">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "px-3 py-1.5 rounded-full text-[12.5px] font-medium border transition-all",
              activeCategory === cat
                ? cat === "전체"
                  ? "bg-foreground text-background border-foreground"
                  : (CATEGORY_COLORS[cat] ?? CATEGORY_COLORS["기타"]) + " ring-1 ring-current"
                : "bg-muted/30 text-muted-foreground border-border hover:bg-accent hover:text-foreground"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 리스트 */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BookOpen className="w-10 h-10 text-muted-foreground/20 mb-3" />
          <p className="text-[15px] font-medium text-muted-foreground/60">
            {activeCategory === "전체" ? "아직 작성된 보고서가 없습니다." : `${activeCategory} 카테고리 보고서가 없습니다.`}
          </p>
          {isAdmin && (
            <button
              onClick={() => { setEditTarget(null); setShowForm(true); }}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold bg-[#FF8A7A]/10 text-[#FF8A7A] border border-[#FF8A7A]/20 hover:bg-[#FF8A7A]/15 transition-colors"
            >
              <Plus className="w-4 h-4" /> 첫 보고서 작성
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {reports.map((report) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <ReportCard
                  report={report}
                  isAdmin={isAdmin}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* 작성/수정 폼 */}
      <AnimatePresence>
        {showForm && (
          <ReportForm
            initial={editTarget}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditTarget(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
