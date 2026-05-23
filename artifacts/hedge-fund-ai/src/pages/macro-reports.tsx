import { useState, useEffect, useRef, Children, isValidElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp,
  Loader2, BookOpen, Save, Eye, EyeOff, Sparkles, Send, Wand2,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const TOPIC_SUGGESTIONS = [
  "미국 연준 금리 인하 사이클",
  "원달러 환율 급등",
  "미중 관세 전쟁",
  "국고채 금리 역전",
  "WTI 유가 급락",
  "일본 엔화 약세",
  "중국 경기 둔화",
  "KOSPI 외국인 수급",
  "반도체 업황 사이클",
  "한국 수출 지표",
];

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

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted/40", className)} />;
}

// ─── 보고서 카드 ─────────────────────────────────────────────────────────────

function ReportCard({
  report, isAdmin, onEdit, onDelete,
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
    setExpanded(v => !v);
  };

  const isAi = report.category === "AI";

  return (
    <motion.article layout className="group relative bg-card border border-border rounded-2xl overflow-hidden hover:border-border/80 transition-colors">
      {/* 왼쪽 액센트 라인 */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-[3px] transition-opacity",
        isAi ? "bg-gradient-to-b from-violet-500 to-[#FF8A7A]" : "bg-gradient-to-b from-blue-500/60 to-sky-400/30",
        expanded ? "opacity-100" : "opacity-40 group-hover:opacity-70"
      )} />

      <div
        role="button"
        tabIndex={0}
        className="w-full text-left px-5 pt-4 pb-4 pl-6 flex items-start gap-3 cursor-pointer"
        onClick={handleExpand}
        onKeyDown={e => e.key === "Enter" && handleExpand()}
      >
        <div className="flex-1 min-w-0">
          {/* 메타 행 */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {isAi ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 font-semibold">
                <Sparkles className="w-2.5 h-2.5" /> AI 분석
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border font-semibold">
                <FileText className="w-2.5 h-2.5" /> 리서치
              </span>
            )}
            <span className="text-[11px] text-muted-foreground/50 tabular-nums">
              {format(new Date(report.created_at), "yyyy. M. d.", { locale: ko })}
            </span>
            {!report.is_published && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">비공개</span>
            )}
          </div>

          {/* 제목 */}
          <h3 className="text-[15px] font-semibold text-foreground leading-snug line-clamp-2 pr-2">
            {report.title}
          </h3>

          {/* 요약 */}
          {report.summary && !expanded && (
            <p className="mt-1.5 text-[12.5px] text-muted-foreground/70 leading-relaxed line-clamp-2">
              {report.summary}
            </p>
          )}
        </div>

        {/* 우측 액션 */}
        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          {isAdmin && (
            <>
              <button
                onClick={e => { e.stopPropagation(); onEdit(report); }}
                className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-foreground hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {confirmDelete ? (
                <span className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                  <button onClick={e => { e.stopPropagation(); onDelete(report.id); }} className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); setConfirmDelete(false); }} className="p-1.5 rounded-lg text-muted-foreground/30 hover:bg-accent transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                  className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
          <div className={cn("p-1.5 rounded-lg text-muted-foreground/40 transition-transform duration-200", expanded && "rotate-180")}>
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* 펼침 콘텐츠 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pl-6 pb-6 border-t border-border/40 pt-4">
              {contentLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중...
                </div>
              ) : (
                <div className="max-w-none space-y-0">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // **굵은 텍스트만 있는 단락** → 섹션 헤더로 렌더링
                      p: ({ children }) => {
                        const arr = Children.toArray(children);
                        const isSectionHeader =
                          arr.length === 1 &&
                          isValidElement(arr[0]) &&
                          (arr[0] as any).type === "strong";
                        if (isSectionHeader) {
                          return (
                            <div className="flex items-center gap-2.5 mt-7 mb-3 first:mt-0">
                              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-violet-400 to-[#FF8A7A] shrink-0" />
                              <h4 className="text-[13.5px] font-bold text-foreground tracking-tight">
                                {(arr[0] as any).props.children}
                              </h4>
                            </div>
                          );
                        }
                        return (
                          <p className="text-[13.5px] leading-[1.95] text-foreground/75 mb-3.5">
                            {children}
                          </p>
                        );
                      },
                      strong: ({ children }) => (
                        <strong className="font-semibold text-foreground/90">{children}</strong>
                      ),
                      ul: ({ children }) => (
                        <ul className="my-3 ml-4 space-y-1.5 list-none">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="my-3 ml-4 space-y-1.5 list-decimal">{children}</ol>
                      ),
                      li: ({ children }) => (
                        <li className="text-[13.5px] leading-[1.85] text-foreground/75 flex gap-2">
                          <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
                          <span>{children}</span>
                        </li>
                      ),
                      h1: ({ children }) => <h1 className="text-lg font-bold text-foreground mt-6 mb-3">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-base font-bold text-foreground mt-6 mb-2.5">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-[14px] font-semibold text-foreground mt-5 mb-2">{children}</h3>,
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-violet-500/30 pl-4 my-4 text-muted-foreground/70 italic">
                          {children}
                        </blockquote>
                      ),
                      hr: () => <hr className="my-5 border-border/40" />,
                    }}
                  >
                    {content ?? "내용을 불러올 수 없습니다."}
                  </ReactMarkdown>
                </div>
              )}
              {report.updated_at !== report.created_at && (
                <p className="mt-5 pt-4 border-t border-border/30 text-[11px] text-muted-foreground/35">
                  마지막 수정: {format(new Date(report.updated_at), "yyyy. M. d. HH:mm", { locale: ko })}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

// ─── 관리자 주제 입력 카드 ─────────────────────────────────────────────────────

function AdminTopicCard({ onGenerated, generating, setGenerating }: {
  onGenerated: (r: MacroReport) => void;
  generating: boolean;
  setGenerating: (v: boolean) => void;
}) {
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    try {
      const r = await fetch(getApiUrl("/api/admin/macro-reports/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "생성 실패"); setGenerating(false); return; }
      onGenerated(data);
      setTopic("");
    } catch (e: any) {
      setError(e.message ?? "생성 실패");
    }
    setGenerating(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !generating) {
      handleGenerate();
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden mb-6">
      {/* 헤더 */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/60 bg-gradient-to-r from-violet-500/5 to-transparent">
        <div className="w-6 h-6 rounded-lg bg-violet-500/15 flex items-center justify-center">
          <Wand2 className="w-3.5 h-3.5 text-violet-400" />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-foreground">AI 보고서 생성</p>
          <p className="text-[11px] text-muted-foreground">주제를 입력하면 Gemini가 심층 분석 보고서를 작성합니다</p>
        </div>
        <span className="ml-auto text-[10.5px] text-violet-400/60 hidden sm:block">⌘ Enter로 생성</span>
      </div>

      <div className="p-4 space-y-3">
        {/* 텍스트 입력 */}
        <div className="relative">
          <textarea
            ref={inputRef}
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={generating}
            placeholder="분석 주제를 입력하세요 (예: 미국 연준 금리 동결 장기화, 원달러 환율 급등, 반도체 업황 회복…)&#10;비워두면 오늘의 핵심 이슈를 자동 선정합니다."
            rows={2}
            className="w-full px-3.5 py-3 text-[13.5px] bg-background border border-border rounded-xl resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/40 focus:border-violet-500/40 leading-relaxed placeholder:text-muted-foreground/35 transition-colors disabled:opacity-50"
          />
        </div>

        {/* 주제 제안 칩 */}
        <div className="flex flex-wrap gap-1.5">
          {TOPIC_SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => { setTopic(s); inputRef.current?.focus(); }}
              disabled={generating}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11.5px] border transition-all",
                topic === s
                  ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
                  : "bg-muted/40 text-muted-foreground/60 border-border hover:bg-muted hover:text-muted-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* 에러 */}
        {error && (
          <p className="text-[12.5px] text-red-400 bg-red-500/8 border border-red-500/15 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* 버튼 행 */}
        <div className="flex items-center justify-between pt-0.5">
          <p className="text-[11px] text-muted-foreground/40">
            {topic.trim() ? `"${topic.trim()}" 주제로 보고서를 생성합니다` : "주제 미입력 시 오늘의 핵심 이슈를 자동 선정"}
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold bg-violet-500 text-white hover:bg-violet-500/90 transition-colors disabled:opacity-50 shrink-0"
          >
            {generating
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 작성 중…</>
              : <><Send className="w-3.5 h-3.5" /> 보고서 생성</>
            }
          </button>
        </div>
      </div>

      {/* 생성 중 진행 바 */}
      <AnimatePresence>
        {generating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-4 pb-3"
          >
            <div className="flex items-center gap-2 text-[12px] text-violet-400/70 bg-violet-500/6 rounded-xl px-3 py-2.5 border border-violet-500/15">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>Gemini가 거시경제 지표를 분석하여 보고서를 작성하고 있습니다… <span className="text-violet-400/40">보통 20~40초 소요</span></span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 직접 작성 폼 ─────────────────────────────────────────────────────────────

function ReportForm({ initial, onSave, onClose }: {
  initial?: MacroReport | null;
  onSave: (r: MacroReport) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [isPublished, setIsPublished] = useState(initial?.is_published ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) { setError("제목과 본문을 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      const isEdit = !!initial;
      const url = isEdit
        ? getApiUrl(`/api/admin/macro-reports/${initial!.id}`)
        : getApiUrl(`/api/admin/macro-reports`);
      const r = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, summary, content, is_published: isPublished }),
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
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-[15px] font-semibold">{initial ? "보고서 수정" : "직접 작성"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">제목 *</label>
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="보고서 제목"
              className="w-full px-3.5 py-2.5 text-[14px] bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-[#FF8A7A]/50"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">요약 (선택)</label>
            <textarea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="카드에 표시될 짧은 요약문"
              rows={2}
              className="w-full px-3.5 py-2.5 text-[13.5px] bg-background border border-border rounded-xl resize-none focus:outline-none focus:ring-1 focus:ring-[#FF8A7A]/50 leading-relaxed"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">본문 * <span className="text-muted-foreground/40">(마크다운 지원)</span></label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="본문을 작성하세요. **굵게**, ## 제목 등 마크다운 사용 가능"
              rows={14}
              className="w-full px-3.5 py-2.5 text-[13px] bg-background border border-border rounded-xl resize-y focus:outline-none focus:ring-1 focus:ring-[#FF8A7A]/50 leading-relaxed font-mono"
            />
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <button type="button" onClick={() => setIsPublished(v => !v)}
              className={cn("relative w-9 h-5 rounded-full transition-colors", isPublished ? "bg-[#FF8A7A]" : "bg-muted")}>
              <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform", isPublished ? "translate-x-4" : "translate-x-0")} />
            </button>
            <span className="text-[13px] text-muted-foreground flex items-center gap-1">
              {isPublished ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {isPublished ? "공개" : "비공개"}
            </span>
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px] text-muted-foreground hover:bg-accent transition-colors">취소</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold bg-[#FF8A7A] text-white hover:bg-[#FF8A7A]/90 transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function MacroReports() {
  const { isEn } = useLanguage();
  const [reports, setReports] = useState<MacroReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<MacroReport | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(getApiUrl("/api/admin/dashboard"), { signal: ctrl.signal })
      .then(r => { if (r.ok) setIsAdmin(true); })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    // 8초 후 강제로 abort → finally에서 loading=false 보장
    const timer = setTimeout(() => ctrl.abort(), 8000);
    (async () => {
      try {
        const r = await fetch(getApiUrl("/api/macro-reports"), { signal: ctrl.signal });
        if (r.ok) setReports(await r.json());
      } catch {
        // AbortError 포함 모든 에러 — finally에서 loading 해제
      } finally {
        clearTimeout(timer);
        setLoading(false);
      }
    })();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, []);

  const handleGenerated = (saved: MacroReport) => {
    setReports(prev => [saved, ...prev]);
  };

  const handleSave = (saved: MacroReport) => {
    setReports(prev => {
      const idx = prev.findIndex(r => r.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [saved, ...prev];
    });
    setShowForm(false);
    setEditTarget(null);
  };

  const handleDelete = async (id: number) => {
    try {
      const r = await fetch(getApiUrl(`/api/admin/macro-reports/${id}`), { method: "DELETE" });
      if (r.ok) setReports(prev => prev.filter(rp => rp.id !== id));
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
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">매크로 분석 보고서</h1>
          <p className="text-sm text-muted-foreground mt-1">FOMC, 지정학, 금리, 원자재 등 주요 매크로 이슈 심층 분석</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold bg-muted/60 text-muted-foreground border border-border hover:bg-accent hover:text-foreground transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" /> 직접 작성
          </button>
        )}
      </div>

      {/* 관리자 전용: AI 주제 입력 카드 */}
      {isAdmin && (
        <AdminTopicCard
          onGenerated={handleGenerated}
          generating={generating}
          setGenerating={setGenerating}
        />
      )}

      {/* 보고서 목록 */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
            <BookOpen className="w-6 h-6 text-muted-foreground/30" />
          </div>
          <p className="text-[15px] font-medium text-muted-foreground/60">아직 작성된 보고서가 없습니다.</p>
          <p className="text-[13px] text-muted-foreground/40 mt-1">위 입력창에 주제를 입력하고 생성해보세요.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* 총 건수 */}
          <div className="flex items-center justify-between mb-1">
            <p className="text-[12px] text-muted-foreground/50">
              총 <span className="text-foreground/70 font-medium">{reports.length}</span>건
            </p>
          </div>

          <AnimatePresence initial={false}>
            {reports.map((report, idx) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.2, delay: idx < 4 ? idx * 0.04 : 0 }}
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

      {/* 직접 작성 폼 */}
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
