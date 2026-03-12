import { useRoute } from "wouter";
import { useGetAnalysis, useRunAnalysisStep, getGetAnalysisQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENTS, ANALYSIS_STEPS_ORDER, type AgentInfo } from "@/lib/agents";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { 
  CheckCircle2, 
  Clock, 
  Play, 
  Loader2, 
  Target, 
  ChevronRight,
  MessageSquareQuote,
  ShieldCheck,
  Briefcase,
  BrainCircuit
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import StockChart from "@/components/StockChart";

export default function AnalysisDetail() {
  const [, params] = useRoute("/analysis/:id");
  const id = params?.id ? parseInt(params.id, 10) : 0;
  
  const queryClient = useQueryClient();
  const { data: analysis, isLoading, error } = useGetAnalysis(id, {
    query: {
      refetchInterval: (query) => query.state.data?.status === 'in_progress' ? 3000 : false
    }
  });

  const { mutate: runStep, isPending: isRunningStep } = useRunAnalysisStep();

  if (isLoading) return (
    <div className="p-20 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
      <p className="text-muted-foreground text-sm">분석 데이터 로딩 중...</p>
    </div>
  );
  if (error || !analysis) return (
    <div className="p-20 text-center text-destructive text-sm">분석 데이터를 불러올 수 없습니다.</div>
  );

  const currentStepCount = analysis.steps.length;
  const isComplete = analysis.status === 'completed';
  
  const handleRunNextStep = () => {
    if (isComplete || currentStepCount >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[currentStepCount];
    runStep(
      { id, data: { stepKey: nextStepKey } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) }) }
    );
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="px-2.5 py-1 bg-primary/10 text-primary rounded-md font-mono font-bold tracking-wider text-sm border border-primary/20">
                {analysis.ticker}
              </span>
              <span className={cn(
                "px-2 py-0.5 text-xs font-semibold rounded border",
                isComplete 
                  ? "bg-success/10 text-success border-success/20" 
                  : "bg-warning/10 text-warning border-warning/20 animate-pulse"
              )}>
                {isComplete ? '분석 완료' : '분석 진행중'}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-2">
              {analysis.companyName}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> {analysis.industry}</span>
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {format(new Date(analysis.createdAt), 'M월 d일 HH:mm', { locale: ko })}</span>
            </div>
            {analysis.additionalContext && (
              <p className="mt-3 text-sm bg-primary/5 p-3 rounded-lg border border-primary/15 text-foreground/80 max-w-2xl border-l-2 border-l-primary">
                <span className="font-semibold text-primary block mb-0.5 text-xs uppercase tracking-wide">분석 포커스</span>
                {analysis.additionalContext}
              </p>
            )}
          </div>

          {/* Verdict Card */}
          {isComplete && analysis.investmentVerdict && (
            <div className="bg-primary/5 border border-primary/20 p-5 rounded-xl min-w-[250px]">
              <div className="text-[11px] font-mono text-primary/70 mb-1 uppercase tracking-widest">최종 투자 의견</div>
              <div className="text-xl font-bold text-foreground mb-3">{analysis.investmentVerdict}</div>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex justify-between items-center border-b border-border pb-1.5">
                  <span className="text-muted-foreground">목표가</span>
                  <span className="text-success font-bold">{formatCurrency(analysis.targetPrice)}</span>
                </div>
                <div className="flex justify-between items-center border-b border-border pb-1.5">
                  <span className="text-muted-foreground">진입가</span>
                  <span className="text-foreground font-semibold">{formatCurrency(analysis.entryPrice)}</span>
                </div>
                <div className="flex justify-between items-center pt-0.5">
                  <span className="text-muted-foreground">손절가</span>
                  <span className="text-destructive font-semibold">{formatCurrency(analysis.stopLoss)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stock Chart */}
      <StockChart ticker={analysis.ticker} companyName={analysis.companyName} />

      {/* Progress Track */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display font-semibold text-base flex items-center gap-2">
            <BrainCircuit className="text-primary w-4 h-4" />
            AI 분석 파이프라인
          </h3>
          <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{currentStepCount} / 9 단계</span>
        </div>
        
        <div className="relative">
          <div className="absolute top-4 left-4 right-4 h-0.5 bg-border z-0" />
          <div 
            className="absolute top-4 left-4 h-0.5 bg-primary z-0 transition-all duration-700 ease-out"
            style={{ width: `calc(${(currentStepCount / 9) * 100}% - 2rem)` }}
          />
          <div className="relative z-10 flex justify-between">
            {ANALYSIS_STEPS_ORDER.map((stepKey, idx) => {
              const isDone = idx < currentStepCount;
              const isCurrent = idx === currentStepCount;
              const agent = AGENTS[stepKey];
              return (
                <div key={stepKey} className="flex flex-col items-center gap-1.5" title={agent.role}>
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                    isDone ? "bg-primary border-primary text-primary-foreground" : 
                    isCurrent ? "bg-card border-primary text-primary animate-pulse" : 
                    "bg-card border-border text-muted-foreground"
                  )}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : <agent.icon className="w-3.5 h-3.5" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Analysis Steps Feed */}
      <div className="space-y-4">
        <AnimatePresence>
          {analysis.steps.map((step, idx) => (
            <StepCard key={step.id} step={step} agent={AGENTS[step.stepKey]} delay={idx * 0.05} />
          ))}
        </AnimatePresence>

        {/* Next Action */}
        {!isComplete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-8 rounded-xl border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center text-center gap-4"
          >
            {currentStepCount < ANALYSIS_STEPS_ORDER.length ? (
              <>
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  {(() => {
                    const NextIcon = AGENTS[ANALYSIS_STEPS_ORDER[currentStepCount]].icon;
                    return <NextIcon className="w-7 h-7 text-primary/60" />;
                  })()}
                </div>
                <div>
                  <h4 className="text-base font-display font-semibold text-foreground mb-1">다음 분석 단계 대기 중</h4>
                  <p className="text-muted-foreground text-sm">
                    다음 에이전트: <span className="text-foreground font-medium">{AGENTS[ANALYSIS_STEPS_ORDER[currentStepCount]].role}</span>
                  </p>
                </div>
                <button
                  onClick={handleRunNextStep}
                  disabled={isRunningStep}
                  className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm"
                >
                  {isRunningStep ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중...</>
                  ) : (
                    <><Play className="w-4 h-4 fill-current" /> {currentStepCount + 1}단계 실행</>
                  )}
                </button>
              </>
            ) : (
              <div className="text-center">
                <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">최종 보고서 작성 중...</p>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

function StepCard({ step, agent, delay }: { step: any, agent: AgentInfo, delay: number }) {
  const getBadgeStyle = (type: string) => {
    switch(type) {
      case 'confirmed_fact': return "bg-success/10 text-success border-success/20";
      case 'data_based_estimate': return "bg-blue-500/10 text-blue-600 border-blue-200";
      case 'hypothesis': return "bg-purple-500/10 text-purple-600 border-purple-200";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const getBadgeLabel = (type: string) => {
    switch(type) {
      case 'confirmed_fact': return "확인된 사실";
      case 'data_based_estimate': return "데이터 기반 추정";
      case 'hypothesis': return "가설";
      default: return type;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card border border-border rounded-xl overflow-hidden border-l-4"
      style={{ borderLeftColor: `hsl(218, 67%, 44%)` }}
    >
      {/* Agent Header */}
      <div className="bg-muted/40 px-5 py-3.5 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/15">
            <agent.icon className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <h4 className="font-display font-semibold text-sm text-foreground leading-tight">{agent.role}</h4>
            <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">{agent.name}</span>
          </div>
        </div>
        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded border hidden sm:inline", getBadgeStyle(step.informationType))}>
          {getBadgeLabel(step.informationType)}
        </span>
      </div>

      {/* Content */}
      <div className="p-5">
        <div className="text-sm text-foreground/85 leading-relaxed space-y-3">
          {step.content.split('\n').map((para: string, i: number) => (
            para.trim() ? <p key={i}>{para}</p> : null
          ))}
        </div>

        {/* Lead Strategist Note */}
        {step.validationNotes && (
          <div className="mt-5 pt-5 border-t border-dashed border-border">
            <div className="flex gap-3">
              <div className="shrink-0">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                </div>
              </div>
              <div className="bg-primary/5 rounded-xl rounded-tl-none p-4 border border-primary/10 flex-1">
                <h5 className="text-xs font-bold text-primary mb-1.5 uppercase tracking-wide">
                  수석 포트폴리오 전략가 검증
                </h5>
                <div className="text-sm text-foreground/75 italic leading-relaxed">
                  "{step.validationNotes}"
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
