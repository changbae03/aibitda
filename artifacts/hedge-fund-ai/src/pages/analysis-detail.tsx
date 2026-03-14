import { useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useGetAnalysis, useRunAnalysisStep, getGetAnalysisQueryKey, useDeleteAnalysis } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AGENTS, ANALYSIS_STEPS_ORDER, type AgentInfo } from "@/lib/agents";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { 
  CheckCircle2, 
  Clock, 
  Play, 
  Loader2, 
  Briefcase,
  BrainCircuit,
  Trash2
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import StockChart from "@/components/StockChart";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function AnalysisDetail() {
  const [, params] = useRoute("/analysis/:id");
  const [, setLocation] = useLocation();
  const id = params?.id ? parseInt(params.id, 10) : 0;
  
  const queryClient = useQueryClient();
  const { data: analysis, isLoading, error } = useGetAnalysis(id, {
    query: {
      refetchInterval: (query) => query.state.data?.status === 'in_progress' ? 3000 : false
    }
  });

  const { mutate: runStep, isPending: isRunningStep } = useRunAnalysisStep();
  const { mutate: deleteAnalysis } = useDeleteAnalysis();

  const handleDelete = () => {
    if (!confirm("이 분석을 삭제하시겠습니까?")) return;
    deleteAnalysis(id, { onSuccess: () => setLocation("/") });
  };
  const triggeredSteps = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!analysis || analysis.status !== "in_progress" || isRunningStep) return;
    const nextIndex = analysis.steps.length;
    if (nextIndex >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[nextIndex];
    if (triggeredSteps.current.has(nextStepKey)) return;
    triggeredSteps.current.add(nextStepKey);
    runStep(
      { id, data: { stepKey: nextStepKey } },
      {
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) });
        },
      }
    );
  }, [analysis?.steps.length, analysis?.status, isRunningStep]);

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
          </div>

          <div className="flex flex-col items-end gap-3">
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2.5 py-1.5 rounded-lg transition-colors border border-transparent hover:border-destructive/20"
              title="분석 삭제"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>삭제</span>
            </button>

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
          <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{currentStepCount} / {ANALYSIS_STEPS_ORDER.length} 단계</span>
        </div>
        
        <div className="relative">
          <div className="absolute top-4 left-4 right-4 h-0.5 bg-border z-0" />
          <div 
            className="absolute top-4 left-4 h-0.5 bg-primary z-0 transition-all duration-700 ease-out"
            style={{ width: `calc(${(currentStepCount / ANALYSIS_STEPS_ORDER.length) * 100}% - 2rem)` }}
          />
          <div className="relative z-10 flex justify-between">
            {ANALYSIS_STEPS_ORDER.map((stepKey, idx) => {
              const isDone = idx < currentStepCount;
              const isCurrent = idx === currentStepCount;
              const agent = AGENTS[stepKey];
              return (
                <div key={stepKey} className="flex flex-col items-center gap-1.5">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                    isDone ? "bg-primary border-primary text-primary-foreground" : 
                    isCurrent ? "bg-card border-primary text-primary animate-pulse" : 
                    "bg-card border-border text-muted-foreground"
                  )}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : <agent.icon className="w-3.5 h-3.5" />}
                  </div>
                  <span className={cn(
                    "text-[10px] font-medium leading-tight text-center max-w-[52px]",
                    isDone ? "text-primary" : isCurrent ? "text-primary" : "text-muted-foreground"
                  )}>
                    {agent.name}
                  </span>
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

function formatPrice(val: string | number | undefined | null): string {
  if (val == null) return "N/A";
  const str = String(val).trim();
  const num = parseFloat(str.replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return str;
  return new Intl.NumberFormat("ko-KR").format(num) + "원";
}

function InvestmentStrategyCard({ step, agent, delay }: { step: any, agent: AgentInfo, delay: number }) {
  let json: any = null;
  try { json = JSON.parse(step.content); } catch { /* fallback to text */ }

  const verdictColor = (v: string) => {
    if (!v) return "text-foreground";
    const s = v.toLowerCase();
    if (s.includes("strong buy")) return "text-emerald-600";
    if (s.includes("buy")) return "text-green-600";
    if (s.includes("strong sell")) return "text-red-600";
    if (s.includes("sell")) return "text-red-500";
    return "text-amber-600";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-primary/5 border-2 border-primary/30 rounded-2xl overflow-hidden"
    >
      <div className="bg-primary px-6 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
          <agent.icon className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <h4 className="font-display font-bold text-sm text-white">최종 투자 전략</h4>
          <span className="text-[11px] text-primary-foreground/70 font-mono uppercase tracking-wider">{agent.role}</span>
        </div>
      </div>

      {json ? (
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn("text-2xl font-display font-bold", verdictColor(json.verdict))}>{json.verdict}</span>
            <span className="text-xs font-semibold px-2 py-0.5 bg-white border border-border rounded text-muted-foreground">신뢰도: {json.confidence}</span>
            <span className="text-xs font-mono px-2 py-0.5 bg-white border border-border rounded text-muted-foreground">{json.investment_period} · R/R {json.risk_reward}</span>
          </div>

          {json.key_issue && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1.5">
              <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">최대 이슈</div>
              <p className="text-sm font-medium text-amber-900">{json.key_issue}</p>
              {json.issue_priced_in && (
                <p className="text-xs text-amber-700/80">{json.issue_priced_in}</p>
              )}
            </div>
          )}

          {json.summary && (
            <p className="text-sm text-foreground/80 leading-relaxed border-l-2 border-primary pl-4">{json.summary}</p>
          )}

          {json.scenarios?.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/60 border-b border-border">
                    <th className="px-3 py-2.5 text-left font-semibold text-foreground/80">시나리오</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-foreground/80">핵심 가정</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-foreground/80">목표가</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-foreground/80">등락률</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-foreground/80">확률</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {json.scenarios.map((s: any, i: number) => {
                    const isBear = s.case === "Bear";
                    const isBull = s.case === "Bull";
                    const isBase = s.case === "Base";
                    return (
                      <tr key={i} className={cn(
                        "hover:bg-muted/20 transition-colors",
                        isBase && "bg-primary/5"
                      )}>
                        <td className="px-3 py-2.5 font-semibold">
                          <span className={cn(
                            "inline-flex items-center gap-1 text-xs",
                            isBear && "text-red-500",
                            isBase && "text-primary",
                            isBull && "text-emerald-600"
                          )}>
                            {isBear ? "▼" : isBull ? "▲" : "—"} {s.case}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-foreground/70 max-w-[220px] whitespace-normal leading-snug">{s.assumption}</td>
                        <td className={cn(
                          "px-3 py-2.5 text-right font-mono font-semibold",
                          isBear ? "text-red-500" : isBull ? "text-emerald-600" : "text-foreground"
                        )}>{formatPrice(s.target_price)}</td>
                        <td className={cn(
                          "px-3 py-2.5 text-right font-mono",
                          s.upside?.startsWith("+") ? "text-emerald-600" : s.upside?.startsWith("-") ? "text-red-500" : "text-foreground/70"
                        )}>{s.upside}</td>
                        <td className="px-3 py-2.5 text-right text-foreground/60">{s.probability}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl p-4 border border-border text-center">
              <div className="text-[11px] text-muted-foreground font-mono mb-1">진입가</div>
              <div className="font-bold text-foreground text-base">{formatPrice(json.entry_price)}</div>
            </div>
            <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 text-center">
              <div className="text-[11px] text-emerald-600 font-mono mb-1">목표가 (Base)</div>
              <div className="font-bold text-emerald-700 text-base">{formatPrice(json.target_price)}</div>
            </div>
            <div className="bg-red-50 rounded-xl p-4 border border-red-200 text-center">
              <div className="text-[11px] text-red-500 font-mono mb-1">손절가</div>
              <div className="font-bold text-red-600 text-base">{formatPrice(json.stop_loss)}</div>
            </div>
          </div>

          {json.risks?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">핵심 리스크</div>
              <ul className="space-y-1.5">
                {json.risks.map((r: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="text-red-400 mt-0.5 shrink-0">▲</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {json.hypothesis && (
            <div className="bg-white rounded-xl p-4 border border-primary/20">
              <div className="text-[11px] font-semibold text-primary uppercase tracking-wider mb-1">투자 가설</div>
              <p className="text-sm text-foreground/85">{json.hypothesis}</p>
            </div>
          )}

          {json.monitoring_indicators?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">모니터링 지표</div>
              <div className="flex flex-wrap gap-2">
                {json.monitoring_indicators.map((m: string, i: number) => (
                  <span key={i} className="text-xs px-2.5 py-1 bg-white border border-border rounded-full text-foreground/70">{m}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-5 text-sm text-foreground/80 leading-relaxed">
          {step.content.split('\n').map((p: string, i: number) => p.trim() ? <p key={i}>{p}</p> : null)}
        </div>
      )}
    </motion.div>
  );
}

function StepCard({ step, agent: agentProp, delay }: { step: any, agent: AgentInfo | undefined, delay: number }) {
  const agent: AgentInfo = agentProp ?? {
    id: step.stepKey,
    name: step.agentName ?? "에이전트",
    role: step.agentRole ?? step.stepKey,
    icon: BrainCircuit,
    color: "text-primary",
    bgColor: "bg-primary/10",
    description: "",
  };

  if (step.stepKey === "investment_strategy") {
    return <InvestmentStrategyCard step={step} agent={agent} delay={delay} />;
  }

  const agentColors: Record<string, string> = {
    company_intro: "hsl(218, 67%, 44%)",
    industry_analysis: "#059669",
    company_analysis: "#4f46e5",
    market_analysis: "#e11d48",
    catalyst_analysis: "#d97706",
    investment_strategy: "hsl(218, 67%, 44%)",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card border border-border rounded-xl overflow-hidden border-l-4"
      style={{ borderLeftColor: agentColors[step.stepKey] ?? "hsl(218, 67%, 44%)" }}
    >
      <div className="bg-muted/40 px-5 py-3.5 flex items-center gap-3 border-b border-border">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center border" style={{ background: `${agentColors[step.stepKey]}15`, borderColor: `${agentColors[step.stepKey]}30` }}>
          <agent.icon className="w-4.5 h-4.5" style={{ color: agentColors[step.stepKey] }} />
        </div>
        <div>
          <h4 className="font-display font-semibold text-sm text-foreground leading-tight">{agent.role}</h4>
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">{agent.name}</span>
        </div>
      </div>

      <div className="p-5">
        <div className="text-sm text-foreground/85 leading-relaxed markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => <h2 className="text-base font-bold text-foreground mt-5 mb-2 pb-1 border-b border-border first:mt-0">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold text-foreground/90 mt-4 mb-1.5">{children}</h3>,
              p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="mb-3 space-y-1 pl-1">{children}</ul>,
              ol: ({ children }) => <ol className="mb-3 space-y-1 pl-4 list-decimal">{children}</ol>,
              li: ({ children }) => <li className="flex gap-2 text-foreground/85"><span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-current flex-shrink-0 opacity-50" /><span>{children}</span></li>,
              strong: ({ children }) => <span>{children}</span>,
              em: ({ children }) => <em className="text-foreground/70">{children}</em>,
              hr: () => <hr className="my-3 border-border" />,
              table: ({ children }) => (
                <div className="my-4 w-full overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs border-collapse">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
              tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
              tr: ({ children }) => <tr className="hover:bg-muted/30 transition-colors">{children}</tr>,
              th: ({ children }) => <th className="px-3 py-2.5 text-left font-semibold text-foreground/80 whitespace-nowrap border-b border-border">{children}</th>,
              td: ({ children }) => <td className="px-3 py-2 text-foreground/75 whitespace-nowrap">{children}</td>,
            }}
          >
            {step.content}
          </ReactMarkdown>
        </div>
      </div>
    </motion.div>
  );
}
