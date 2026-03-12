import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useGetAnalysis, useRunAnalysisStep, getGetAnalysisQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENTS, ANALYSIS_STEPS_ORDER, type AgentInfo } from "@/lib/agents";
import { format } from "date-fns";
import { 
  CheckCircle2, 
  Clock, 
  Play, 
  Loader2, 
  Target, 
  AlertTriangle, 
  ChevronRight,
  MessageSquareQuote,
  ShieldCheck,
  Building,
  Briefcase
} from "lucide-react";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export default function AnalysisDetail() {
  const [, params] = useRoute("/analysis/:id");
  const id = params?.id ? parseInt(params.id, 10) : 0;
  
  const queryClient = useQueryClient();
  const { data: analysis, isLoading, error } = useGetAnalysis(id, {
    query: {
      refetchInterval: (query) => {
        // Poll if analysis is still in progress to catch backend updates
        return query.state.data?.status === 'in_progress' ? 3000 : false;
      }
    }
  });

  const { mutate: runStep, isPending: isRunningStep } = useRunAnalysisStep();

  if (isLoading) return <div className="p-20 text-center animate-pulse text-primary font-mono text-xl">Loading Intelligence Core...</div>;
  if (error || !analysis) return <div className="p-20 text-center text-destructive">Failed to load analysis or not found.</div>;

  const currentStepCount = analysis.steps.length;
  const isComplete = analysis.status === 'completed';
  
  const handleRunNextStep = () => {
    if (isComplete || currentStepCount >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[currentStepCount];
    
    runStep(
      { id, data: { stepKey: nextStepKey } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) });
        }
      }
    );
  };

  return (
    <div className="space-y-8 pb-20">
      {/* Header Profile */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl relative overflow-hidden">
        {/* Decorative background for header */}
        <div className="absolute top-0 right-0 w-[600px] h-full bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-white/10 text-white rounded-lg font-mono font-bold tracking-wider text-lg border border-white/20">
                {analysis.ticker}
              </span>
              <span className={cn(
                "px-2 py-1 text-xs font-semibold uppercase tracking-wider rounded border",
                isComplete 
                  ? "bg-success/10 text-success border-success/30" 
                  : "bg-amber-500/10 text-amber-500 border-amber-500/30 animate-pulse"
              )}>
                {isComplete ? 'Analysis Concluded' : 'Investigation Active'}
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">{analysis.companyName}</h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Briefcase className="w-4 h-4" /> {analysis.industry}</span>
              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> Initiated: {format(new Date(analysis.createdAt), 'MMM d, yyyy HH:mm')}</span>
            </div>
            {analysis.additionalContext && (
              <p className="mt-4 text-sm bg-black/30 p-3 rounded-lg border border-white/5 text-white/80 max-w-2xl border-l-2 border-l-primary">
                <span className="font-semibold text-primary block mb-1">Analyst Briefing:</span>
                "{analysis.additionalContext}"
              </p>
            )}
          </div>

          {/* Verdict Card (if complete) */}
          {isComplete && analysis.investmentVerdict && (
            <div className="bg-gradient-to-br from-black/80 to-secondary/80 border border-primary/30 p-5 rounded-2xl min-w-[280px] shadow-[0_0_30px_rgba(234,179,8,0.1)]">
              <div className="text-xs font-mono text-primary/80 mb-1 uppercase tracking-widest">Final Strategy Verdict</div>
              <div className="text-2xl font-bold text-white mb-4">{analysis.investmentVerdict}</div>
              
              <div className="space-y-2 font-mono text-sm">
                <div className="flex justify-between items-center border-b border-white/10 pb-1">
                  <span className="text-muted-foreground">Target</span>
                  <span className="text-success font-bold">{formatCurrency(analysis.targetPrice)}</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/10 pb-1">
                  <span className="text-muted-foreground">Entry</span>
                  <span className="text-white">{formatCurrency(analysis.entryPrice)}</span>
                </div>
                <div className="flex justify-between items-center pb-1">
                  <span className="text-muted-foreground">Stop Loss</span>
                  <span className="text-destructive">{formatCurrency(analysis.stopLoss)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Progress Track */}
      <div className="px-2">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-lg flex items-center gap-2">
            <BrainCircuit className="text-primary w-5 h-5" /> 
            Intelligence Pipeline
          </h3>
          <span className="font-mono text-sm text-muted-foreground">{currentStepCount} / 9 Phases</span>
        </div>
        
        <div className="relative">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-white/10 -translate-y-1/2 z-0" />
          <div 
            className="absolute top-1/2 left-0 h-0.5 bg-primary -translate-y-1/2 z-0 transition-all duration-700 ease-out shadow-[0_0_10px_rgba(234,179,8,0.5)]"
            style={{ width: `${(currentStepCount / 9) * 100}%` }}
          />
          
          <div className="relative z-10 flex justify-between">
            {ANALYSIS_STEPS_ORDER.map((stepKey, idx) => {
              const isDone = idx < currentStepCount;
              const isCurrent = idx === currentStepCount;
              const agent = AGENTS[stepKey];
              
              return (
                <div key={stepKey} className="flex flex-col items-center gap-2" title={agent.role}>
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 border-2",
                    isDone ? "bg-primary border-primary text-primary-foreground shadow-[0_0_15px_rgba(234,179,8,0.6)]" : 
                    isCurrent ? "bg-background border-primary text-primary animate-pulse shadow-[0_0_10px_rgba(234,179,8,0.3)]" : 
                    "bg-background border-white/20 text-muted-foreground"
                  )}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : <agent.icon className="w-4 h-4" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Analysis Feed */}
      <div className="space-y-6">
        <AnimatePresence>
          {analysis.steps.map((step, idx) => (
            <StepCard key={step.id} step={step} agent={AGENTS[step.stepKey]} delay={idx * 0.1} />
          ))}
        </AnimatePresence>

        {/* Next Action Area */}
        {!isComplete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-8 rounded-2xl border border-dashed border-white/20 flex flex-col items-center justify-center text-center gap-4 bg-white/[0.01]"
          >
            {currentStepCount < ANALYSIS_STEPS_ORDER.length ? (
              <>
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-2">
                  {(() => {
                    const NextIcon = AGENTS[ANALYSIS_STEPS_ORDER[currentStepCount]].icon;
                    return <NextIcon className="w-8 h-8 text-primary/50" />;
                  })()}
                </div>
                <div>
                  <h4 className="text-xl font-display font-semibold mb-1">Awaiting Next Phase</h4>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Next up: <span className="text-white font-medium">{AGENTS[ANALYSIS_STEPS_ORDER[currentStepCount]].role}</span> is ready to process the data.
                  </p>
                </div>
                <button
                  onClick={handleRunNextStep}
                  disabled={isRunningStep}
                  className="mt-4 px-8 py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all hover:shadow-[0_0_20px_rgba(255,255,255,0.2)] disabled:opacity-50 flex items-center gap-2"
                >
                  {isRunningStep ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</>
                  ) : (
                    <><Play className="w-5 h-5 fill-current" /> Execute Phase {currentStepCount + 1}</>
                  )}
                </button>
              </>
            ) : (
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
                <p className="text-muted-foreground">Finalizing report formulation...</p>
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
      case 'data_based_estimate': return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case 'hypothesis': return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      default: return "bg-white/10 text-white border-white/20";
    }
  };

  const getBadgeLabel = (type: string) => {
    switch(type) {
      case 'confirmed_fact': return "확인된 사실 (Confirmed Fact)";
      case 'data_based_estimate': return "데이터 기반 추정 (Data Estimate)";
      case 'hypothesis': return "가설 (Hypothesis)";
      default: return type;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-panel rounded-2xl overflow-hidden border-l-4"
      style={{ borderLeftColor: `var(--${agent.color.replace('text-', '')})`, borderLeftWidth: '4px' }}
    >
      {/* Agent Header */}
      <div className="bg-black/20 p-4 md:px-6 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center border border-white/10 shadow-inner", agent.bgColor)}>
            <agent.icon className={cn("w-6 h-6", agent.color)} />
          </div>
          <div>
            <h4 className="font-display font-semibold text-lg leading-tight">{agent.role}</h4>
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{agent.name}</span>
          </div>
        </div>
        <div className="text-right hidden sm:block">
          <span className={cn("text-xs font-mono px-2 py-1 rounded border", getBadgeStyle(step.informationType))}>
            {getBadgeLabel(step.informationType)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        <div className="prose prose-invert max-w-none text-white/90 font-serif leading-relaxed text-[15px]">
          {/* Simulate formatting if it's plain text, assuming backend might send raw text with newlines */}
          {step.content.split('\n').map((para: string, i: number) => (
            para.trim() ? <p key={i} className="mb-4">{para}</p> : null
          ))}
        </div>

        {/* Lead Strategist Validation Section */}
        {step.validationNotes && (
          <div className="mt-8 pt-6 border-t border-dashed border-white/10">
            <div className="flex gap-4">
              <div className="shrink-0 mt-1">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                </div>
              </div>
              <div className="bg-primary/5 rounded-2xl rounded-tl-none p-5 border border-primary/10 flex-1 relative">
                <MessageSquareQuote className="absolute top-4 right-4 w-12 h-12 text-primary/5 -z-10" />
                <h5 className="text-sm font-bold text-primary mb-2 uppercase tracking-wide flex items-center gap-2">
                  Lead Portfolio Strategist Validation
                </h5>
                <div className="text-sm text-white/80 italic font-medium leading-relaxed">
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
