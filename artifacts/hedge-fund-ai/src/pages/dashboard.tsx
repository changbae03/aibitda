import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useListAnalyses, useStartAnalysis, useDeleteAnalysis, useDeleteAllAnalyses } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { 
  BrainCircuit, 
  Target, 
  Activity,
  ChevronRight,
  Search,
  Loader2,
  Trash2
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { motion } from "framer-motion";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: analyses, isLoading: loadingAnalyses } = useListAnalyses();
  const { mutateAsync: startAnalysis, isPending: isStarting } = useStartAnalysis();
  const { mutate: deleteAnalysis } = useDeleteAnalysis();
  const { mutate: deleteAllAnalyses, isPending: isDeletingAll } = useDeleteAllAnalyses();
  const isComposing = useRef(false);

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("이 분석을 삭제하시겠습니까?")) return;
    deleteAnalysis(id);
  };

  const handleDeleteAll = () => {
    if (!analyses?.length) return;
    if (!confirm(`분석 내역 ${analyses.length}건을 모두 삭제하시겠습니까?`)) return;
    deleteAllAnalyses();
  };

  const [quickTicker, setQuickTicker] = useState("");

  const completedAnalyses = analyses?.filter(a => a.status === 'completed') || [];
  const inProgressAnalyses = analyses?.filter(a => a.status === 'in_progress') || [];

  const handleQuickAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isComposing.current) return;
    const raw = quickTicker.trim();
    if (!raw) return;
    // 한글 또는 6자리 미만 숫자 → 전체 검색 페이지로
    if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(raw) || !/^\d{6}$/.test(raw)) {
      setLocation("/analysis/new");
      return;
    }
    const result = await startAnalysis({ data: { ticker: raw } });
    setLocation(`/analysis/${result.id}`);
  };

  return (
    <div className="space-y-7">
      {/* Quick Search */}
      <form onSubmit={handleQuickAnalysis}>
        <div className="flex items-center gap-3 bg-white border-2 border-border rounded-2xl px-5 py-3 shadow-sm focus-within:border-primary focus-within:shadow-md focus-within:shadow-primary/10 transition-all">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={quickTicker}
            onChange={e => { setQuickTicker(e.target.value); }}
            onCompositionStart={() => { isComposing.current = true; }}
            onCompositionEnd={(e) => { isComposing.current = false; setQuickTicker(e.currentTarget.value); }}
            placeholder="종목코드(6자리) 또는 회사명  예) 005930, 삼성전자"
            className="flex-1 bg-transparent outline-none border-none text-foreground text-base placeholder:font-sans placeholder:text-muted-foreground/60 placeholder:text-sm"
            disabled={isStarting}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={isStarting || !quickTicker.trim()}
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><BrainCircuit className="w-4 h-4" /> 분석 시작</>}
          </button>
        </div>
      </form>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          title="진행중 분석"
          value={inProgressAnalyses.length.toString()}
          icon={Activity}
          sub="현재 실행중"
          delay={0.05}
        />
        <StatCard
          title="완료 리포트"
          value={completedAnalyses.length.toString()}
          icon={Target}
          sub="누적 데이터베이스"
          delay={0.1}
        />
      </div>

      {/* Recent Analyses */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-display font-semibold text-foreground">최근 분석 내역</h2>
          {!!analyses?.length && (
            <button
              onClick={handleDeleteAll}
              disabled={isDeletingAll}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              모두 삭제
            </button>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loadingAnalyses ? (
            <div className="p-8 text-center text-muted-foreground text-sm animate-pulse">불러오는 중...</div>
          ) : !analyses?.length ? (
            <div className="p-16 text-center">
              <BrainCircuit className="w-10 h-10 text-muted mx-auto mb-3" />
              <h3 className="text-base font-medium text-foreground mb-1">분석 내역 없음</h3>
              <p className="text-muted-foreground text-sm">위 검색창에서 종목을 입력하면 AI 분석이 시작됩니다.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {analyses.map((analysis, i) => (
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 * i }}
                  key={analysis.id}
                >
                  <Link
                    href={`/analysis/${analysis.id}`}
                    className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 transition-colors group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center font-mono font-bold text-primary text-xs shrink-0">
                        {analysis.ticker.substring(0, 4)}
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground text-sm group-hover:text-primary transition-colors">
                          {analysis.companyName}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded text-[11px] font-mono">{analysis.ticker}</span>
                          <span>{format(new Date(analysis.createdAt), 'M월 d일 HH:mm', { locale: ko })}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {analysis.status === 'in_progress' ? (
                        <div className="flex items-center gap-1.5 text-warning text-xs font-medium">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-warning"></span>
                          </span>
                          분석중 ({analysis.steps.length}/{6})
                        </div>
                      ) : (
                        <div className="text-right">
                          <span className="text-xs font-medium text-success block">완료</span>
                          {analysis.targetPrice ? (
                            <span className="text-[11px] text-muted-foreground font-mono">
                              목표: {formatCurrency(analysis.targetPrice)}
                            </span>
                          ) : null}
                        </div>
                      )}
                      <button
                        onClick={(e) => handleDelete(e, analysis.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                        title="분석 삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, sub, delay }: {
  title: string;
  value: string;
  icon: any;
  sub: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="p-5 rounded-xl border bg-card border-border"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        <div className="p-1.5 rounded-md bg-muted">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
      <div className="text-2xl font-display font-bold mb-0.5 text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </motion.div>
  );
}
