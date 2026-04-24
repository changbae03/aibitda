import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import {
  CalendarClock, Trash2, Power, PowerOff, RefreshCw,
  AlertCircle, Building2, ChevronRight, Plus, Clock,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface Schedule {
  id: number;
  ticker: string;
  company_name: string;
  industry: string | null;
  frequency: string;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_analysis_id: number | null;
  source_analysis_id: number | null;
  created_at: string;
}

const FREQ_LABEL: Record<string, string> = {
  weekly:   "매주",
  biweekly: "격주",
  monthly:  "매월",
};
const FREQ_DESC: Record<string, string> = {
  weekly:   "7일마다 자동 재분석",
  biweekly: "14일마다 자동 재분석",
  monthly:  "30일마다 자동 재분석",
};

function ScheduleCard({
  sch,
  onToggle,
  onDelete,
  onViewLatest,
}: {
  sch: Schedule;
  onToggle: () => void;
  onDelete: () => void;
  onViewLatest: () => void;
}) {
  const nextRun = new Date(sch.next_run_at);
  const isOverdue = nextRun < new Date();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={cn(
        "rounded-xl border p-4 bg-card transition-all",
        sch.enabled ? "border-border" : "border-border/50 opacity-60"
      )}
    >
      {/* 상단 */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{sch.company_name}</p>
            <p className="text-xs text-muted-foreground font-mono">{sch.ticker}</p>
          </div>
        </div>

        {/* 빈도 배지 */}
        <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
          {FREQ_LABEL[sch.frequency] ?? sch.frequency}
        </span>
      </div>

      {/* 다음 실행 / 마지막 실행 */}
      <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-muted-foreground">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">다음 실행</span>
          <span className={cn(
            "font-medium",
            !sch.enabled ? "text-muted-foreground" :
            isOverdue ? "text-amber-600 dark:text-amber-400" : "text-foreground"
          )}>
            {sch.enabled
              ? isOverdue
                ? "곧 실행 예정"
                : format(nextRun, "M월 d일 (EEE)", { locale: ko })
              : "일시 정지됨"}
          </span>
          {sch.enabled && !isOverdue && (
            <span className="text-[10px] text-muted-foreground/60">
              {formatDistanceToNow(nextRun, { locale: ko, addSuffix: true })}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">마지막 실행</span>
          <span className="font-medium text-foreground">
            {sch.last_run_at
              ? format(new Date(sch.last_run_at), "M월 d일 HH:mm")
              : "미실행"}
          </span>
        </div>
      </div>

      {/* 빈도 설명 */}
      <p className="text-[11px] text-muted-foreground/70 mb-3 flex items-center gap-1">
        <Clock className="w-3 h-3" />
        {FREQ_DESC[sch.frequency]}
      </p>

      {/* 버튼 */}
      <div className="flex items-center gap-2">
        {sch.last_analysis_id && (
          <button
            onClick={onViewLatest}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            최근 분석 보기
          </button>
        )}
        <button
          onClick={onToggle}
          title={sch.enabled ? "일시 정지" : "재개"}
          className={cn(
            "p-2 rounded-lg text-xs transition-colors",
            sch.enabled
              ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {sch.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={onDelete}
          title="삭제"
          className="p-2 rounded-lg bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive text-xs transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

export default function SchedulesPage() {
  const [, setLocation] = useLocation();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(getApiUrl("/api/analysis/schedules"), {
        credentials: "include",
      });
      if (r.status === 401) {
        setError("로그인이 필요합니다");
        return;
      }
      if (!r.ok) throw new Error(`서버 오류: ${r.status}`);
      const data: Schedule[] = await r.json();
      setSchedules(data);
    } catch (e: any) {
      setError(e.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  const handleToggle = async (sch: Schedule) => {
    try {
      const r = await fetch(getApiUrl(`/api/analysis/schedules/${sch.id}/toggle`), {
        method: "PATCH",
        credentials: "include",
      });
      if (r.ok) {
        const updated = await r.json();
        setSchedules(prev => prev.map(s => s.id === sch.id ? updated : s));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (sch: Schedule) => {
    if (!confirm(`'${sch.company_name}' 재실행 스케줄을 삭제할까요?`)) return;
    try {
      const r = await fetch(getApiUrl(`/api/analysis/schedules/${sch.id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) setSchedules(prev => prev.filter(s => s.id !== sch.id));
    } catch (e) {
      console.error(e);
    }
  };

  const active = schedules.filter(s => s.enabled);
  const paused = schedules.filter(s => !s.enabled);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
      {/* 헤더 */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">재실행 스케줄</h1>
          </div>
          <button
            onClick={fetchSchedules}
            disabled={loading}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          등록한 종목을 주기적으로 자동 재분석합니다. 실행 시 크레딧 1개가 차감됩니다.
        </p>
      </div>

      {/* 안내 박스 */}
      <div className="mb-5 px-4 py-3 rounded-xl bg-muted/60 border border-border text-xs text-muted-foreground flex items-start gap-2">
        <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          재실행 스케줄은 <span className="font-semibold text-foreground">30분 간격</span>으로 확인되며,
          크레딧이 부족하면 다음 주기로 자동 연기됩니다.
          최대 <span className="font-semibold text-foreground">5개</span> 활성 스케줄을 유지할 수 있습니다.
        </span>
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center py-16 text-muted-foreground">
            <RefreshCw className="w-7 h-7 animate-spin mb-3 text-primary/60" />
            <p className="text-sm">스케줄 불러오는 중…</p>
          </motion.div>
        ) : error ? (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center py-16">
            <AlertCircle className="w-8 h-8 mb-3 text-destructive/60" />
            <p className="text-sm text-destructive">{error}</p>
          </motion.div>
        ) : schedules.length === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center py-16 text-muted-foreground">
            <CalendarClock className="w-10 h-10 mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium mb-1">등록된 스케줄 없음</p>
            <p className="text-xs text-muted-foreground/60 text-center mb-4">
              분석 상세 페이지에서 '재실행 예약' 버튼으로 추가하세요
            </p>
            <button
              onClick={() => setLocation("/analysis/new")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              새 분석 시작
            </button>
          </motion.div>
        ) : (
          <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {active.length > 0 && (
              <div className="mb-5">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">
                  활성 스케줄 ({active.length}/5)
                </h2>
                <div className="space-y-3">
                  <AnimatePresence>
                    {active.map(sch => (
                      <ScheduleCard
                        key={sch.id}
                        sch={sch}
                        onToggle={() => handleToggle(sch)}
                        onDelete={() => handleDelete(sch)}
                        onViewLatest={() => setLocation(`/analysis/${sch.last_analysis_id}`)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {paused.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">
                  일시 정지 ({paused.length})
                </h2>
                <div className="space-y-3">
                  <AnimatePresence>
                    {paused.map(sch => (
                      <ScheduleCard
                        key={sch.id}
                        sch={sch}
                        onToggle={() => handleToggle(sch)}
                        onDelete={() => handleDelete(sch)}
                        onViewLatest={() => setLocation(`/analysis/${sch.last_analysis_id}`)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
