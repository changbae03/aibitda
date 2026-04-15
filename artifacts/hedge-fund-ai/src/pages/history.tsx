import { useState } from "react";
import { useListAnalyses, useDeleteAnalysis, getListAnalysesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Loader2, Inbox, ArrowRight, CheckCircle2, Clock, Trash2, X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  BUY:         { label: "매수",     cls: "bg-green-50 text-green-700 border-green-200" },
  STRONG_BUY:  { label: "강력매수", cls: "bg-green-50 text-green-700 border-green-200" },
  SELL:        { label: "매도",     cls: "bg-red-50 text-red-700 border-red-200" },
  STRONG_SELL: { label: "강력매도", cls: "bg-red-50 text-red-700 border-red-200" },
  HOLD:        { label: "보유",     cls: "bg-amber-50 text-amber-700 border-amber-200" },
  NEUTRAL:     { label: "중립",     cls: "bg-neutral-100 text-neutral-600 border-neutral-200" },
};

function verdictBadge(verdict?: string) {
  if (!verdict) return null;
  const s = VERDICT_STYLE[verdict.toUpperCase()] ?? { label: verdict, cls: "bg-neutral-100 text-neutral-600 border-neutral-200" };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border", s.cls)}>
      {s.label}
    </span>
  );
}

export default function History() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: analyses, isLoading } = useListAnalyses();
  const { mutate: deleteAnalysis, isPending: isDeleting } = useDeleteAnalysis();
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmId(id);
  };

  const confirmDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    setConfirmId(null);
    deleteAnalysis(id, {
      onSuccess: () => {
        try { localStorage.removeItem(`bookmark-${id}`); } catch {}
        setDeletingId(null);
      },
      onError: () => setDeletingId(null),
    });
  };

  const cancelConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmId(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  const list = analyses ?? [];

  return (
    <div>
      <h1
        className="text-[22px] font-black tracking-tight text-neutral-900 mb-6"
        style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif" }}
      >
        내가 본 자료
      </h1>

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <Inbox className="w-10 h-10 text-neutral-200" />
          <p className="text-[15px] font-medium text-neutral-400">아직 분석한 기업이 없어요</p>
          <p className="text-[13px] text-neutral-300">
            AI 기업분석 메뉴에서 종목을 검색해 분석을 시작해보세요
          </p>
          <button
            onClick={() => setLocation("/analysis/new")}
            className="mt-2 px-4 py-2 rounded-md text-[13px] font-medium bg-[#1d4ed8] text-white hover:bg-blue-700 transition-colors"
          >
            분석 시작하기
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {list.map((a) => {
              const isConfirming = confirmId === a.id;
              const isThisDeleting = deletingId === a.id;

              return (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: isThisDeleting ? 0.4 : 1, y: 0 }}
                  exit={{ opacity: 0, x: -24, transition: { duration: 0.22 } }}
                  transition={{ duration: 0.18 }}
                  className="group relative flex items-center gap-4 px-5 py-4 rounded-xl border border-neutral-100 hover:border-neutral-200 hover:bg-neutral-50 transition-all cursor-pointer"
                  onClick={() => !isConfirming && !isThisDeleting && setLocation(`/analysis/${a.id}`)}
                >
                  {/* Status icon */}
                  <div className="shrink-0">
                    {isThisDeleting ? (
                      <Loader2 className="w-4 h-4 animate-spin text-neutral-300" />
                    ) : a.status === "completed" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400" />
                    )}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-semibold text-neutral-900 truncate">
                        {a.companyName}
                      </span>
                      <span className="text-[12px] text-neutral-400 font-mono">{a.ticker}</span>
                      {verdictBadge(a.investmentVerdict)}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[12px] text-neutral-400">
                      <span>{a.industry || "—"}</span>
                      {a.targetPrice != null && (
                        <>
                          <span className="text-neutral-200">|</span>
                          <span>목표가 <span className="text-neutral-600 font-medium">{formatCurrency(a.targetPrice)}</span></span>
                        </>
                      )}
                      <span className="text-neutral-200">|</span>
                      <span>{format(new Date(a.createdAt), "yyyy.MM.dd HH:mm", { locale: ko })}</span>
                    </div>
                  </div>

                  {/* Right side: delete confirm or arrow */}
                  <div className="shrink-0 flex items-center gap-2">
                    <AnimatePresence mode="wait">
                      {isConfirming ? (
                        <motion.div
                          key="confirm"
                          initial={{ opacity: 0, scale: 0.92 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.92 }}
                          transition={{ duration: 0.12 }}
                          className="flex items-center gap-1.5"
                          onClick={cancelConfirm}
                        >
                          <span className="text-[12px] text-neutral-500 mr-0.5">삭제할까요?</span>
                          <button
                            onClick={(e) => confirmDelete(a.id, e)}
                            className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-[11px] font-semibold hover:bg-red-600 transition-colors"
                          >
                            삭제
                          </button>
                          <button
                            onClick={cancelConfirm}
                            className="px-2.5 py-1 rounded-lg bg-neutral-100 text-neutral-600 text-[11px] font-semibold hover:bg-neutral-200 transition-colors"
                          >
                            취소
                          </button>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="default"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.1 }}
                          className="flex items-center gap-2"
                        >
                          <button
                            onClick={(e) => handleDelete(a.id, e)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-neutral-300 hover:text-red-400 hover:bg-red-50"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 transition-colors" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
