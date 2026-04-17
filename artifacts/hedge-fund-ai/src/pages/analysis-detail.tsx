import { useEffect, useRef, useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useGetAnalysis, getGetAnalysisQueryKey, useDeleteAnalysis } from "@workspace/api-client-react";
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
  Trash2,
  ArrowLeft,
  ShieldCheck,
  RefreshCw,
  Bookmark,
  BookmarkCheck,
  Share2,
  Link,
  Check,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import StockChart, { type ChartLevels } from "@/components/StockChart";
import FinancialChart from "@/components/FinancialChart";
import PeerGroupSection from "@/components/PeerGroupSection";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 야후 파이낸스 영문 업종명 → 한국어 변환
const INDUSTRY_KO: Record<string, string> = {
  // 자동차
  "Auto Manufacturers": "자동차",
  "Auto Parts": "자동차 부품",
  "Auto & Truck Dealerships": "자동차 딜러",
  // 반도체·전자
  "Semiconductors": "반도체",
  "Semiconductor Equipment & Materials": "반도체 장비·소재",
  "Electronic Components": "전자부품",
  "Electronic Technology": "전자기술",
  "Consumer Electronics": "가전제품",
  "Electrical Equipment & Parts": "전기장비",
  // IT·소프트웨어
  "Software—Application": "소프트웨어",
  "Software—Infrastructure": "인프라 소프트웨어",
  "Information Technology Services": "IT 서비스",
  "Internet Content & Information": "인터넷·정보서비스",
  "Internet Retail": "인터넷 쇼핑몰",
  "Communication Equipment": "통신 장비",
  "Computer Hardware": "컴퓨터 하드웨어",
  "Scientific & Technical Instruments": "과학·기술 장비",
  // 통신
  "Telecom Services": "통신서비스",
  "Telecommunications Services": "통신서비스",
  // 금융
  "Banks—Regional": "지방은행",
  "Banks—Diversified": "종합은행",
  "Insurance—Life": "생명보험",
  "Insurance—Property & Casualty": "손해보험",
  "Insurance—Diversified": "종합보험",
  "Financial Services": "금융서비스",
  "Asset Management": "자산운용",
  "Capital Markets": "자본시장",
  "Credit Services": "신용·카드",
  // 바이오·헬스
  "Biotechnology": "바이오",
  "Drug Manufacturers—General": "제약(대형)",
  "Drug Manufacturers—Specialty & Generic": "제약(전문·제네릭)",
  "Medical Devices": "의료기기",
  "Medical Care Facilities": "의료서비스",
  "Health Information Services": "헬스케어 IT",
  "Healthcare Plans": "건강보험",
  "Diagnostics & Research": "진단·연구",
  // 에너지
  "Oil & Gas Integrated": "정유·가스(통합)",
  "Oil & Gas E&P": "석유·가스 탐사",
  "Oil & Gas Refining & Marketing": "정유·마케팅",
  "Oil & Gas Equipment & Services": "유전 장비·서비스",
  "Chemicals": "화학",
  "Specialty Chemicals": "특수화학",
  // 소비재
  "Beverages—Non-Alcoholic": "음료(비알코올)",
  "Beverages—Brewers": "주류(맥주)",
  "Food Distribution": "식품 유통",
  "Packaged Foods": "가공식품",
  "Household & Personal Products": "생활용품",
  "Apparel Manufacturing": "의류 제조",
  "Apparel Retail": "의류 소매",
  "Luxury Goods": "명품",
  "Specialty Retail": "전문 소매",
  "Department Stores": "백화점",
  // 산업재
  "Aerospace & Defense": "항공우주·방산",
  "Industrial Machinery": "산업기계",
  "Industrial Distribution": "산업 유통",
  "Engineering & Construction": "건설·엔지니어링",
  "Building Materials": "건자재",
  "Steel": "철강",
  "Aluminum": "알루미늄",
  "Metal Fabrication": "금속 가공",
  "Paper & Paper Products": "제지",
  // 유통·물류
  "Grocery Stores": "식품 마트",
  "Discount Stores": "할인점",
  "Shipping & Ports": "해운·항만",
  "Airlines": "항공",
  "Trucking": "육상 화물",
  "Integrated Freight & Logistics": "종합 물류",
  // 부동산
  "Real Estate Services": "부동산 서비스",
  "Real Estate—Development": "부동산 개발",
  "REIT—Office": "오피스 리츠",
  "REIT—Retail": "리테일 리츠",
  // 기타
  "Entertainment": "엔터테인먼트",
  "Media—Diversified": "종합 미디어",
  "Publishing": "출판",
  "Education & Training Services": "교육·훈련",
  "Staffing & Employment Services": "인력파견",
  "Waste Management": "폐기물 처리",
  "Utilities—Regulated Electric": "전기 유틸리티",
  "Utilities—Diversified": "종합 유틸리티",
};

function toKoreanIndustry(industry: string | null | undefined): string {
  if (!industry) return "—";
  return INDUSTRY_KO[industry] ?? industry;
}

function toKoreanVerdict(verdict: string | null | undefined): string {
  if (!verdict) return "—";
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return "높은 상승여력";
  if (s.includes("buy"))         return "상승여력";
  if (s.includes("strong sell")) return "높은 하락여지";
  if (s.includes("sell"))        return "하락여지";
  return "적정 수준";
}

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

  const { mutate: deleteAnalysis } = useDeleteAnalysis();
  const [bookmarked, setBookmarked] = useState(() => {
    try { return localStorage.getItem(`bookmark-${id}`) === "1"; } catch { return false; }
  });
  const [linkCopied, setLinkCopied] = useState(false);

  const toggleBookmark = () => {
    const next = !bookmarked;
    setBookmarked(next);
    try { next ? localStorage.setItem(`bookmark-${id}`, "1") : localStorage.removeItem(`bookmark-${id}`); } catch {}
    if (next) setLocation("/history");
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };
  type QCStatus = "checking" | "approved" | "revising" | "revised";
  interface StreamingStepState {
    key: string;
    content: string;
    qcStatus?: QCStatus;
    qcScore?: number;
    qcFeedback?: string;
  }
  const [streamingStep, setStreamingStep] = useState<StreamingStepState | null>(null);
  const isStreaming = streamingStep !== null;
  const triggeredSteps = useRef<Set<string>>(new Set());

  const handleDelete = () => {
    if (!confirm("이 분석을 삭제하시겠습니까?")) return;
    deleteAnalysis(id, { onSuccess: () => setLocation("/") });
  };

  const runStreamingStep = useCallback(async (stepKey: string) => {
    setStreamingStep({ key: stepKey, content: "" });
    try {
      const res = await fetch(`/api/analysis/${id}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey }),
      });
      if (!res.ok || !res.body) {
        setStreamingStep(null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.qc === "checking") {
              setStreamingStep(prev => prev ? { ...prev, content: "", qcStatus: "checking" } : null);
            } else if (msg.qc === "approved") {
              setStreamingStep(prev => prev ? { ...prev, qcStatus: "approved", qcScore: msg.score } : null);
            } else if (msg.qc === "revising") {
              setStreamingStep(prev => prev ? { ...prev, content: "", qcStatus: "revising", qcScore: msg.score, qcFeedback: msg.feedback } : null);
            } else if (msg.qc === "revised") {
              setStreamingStep(prev => prev ? { ...prev, qcStatus: "revised", qcScore: msg.score } : null);
            } else if (msg.t) {
              setStreamingStep(prev => prev ? { ...prev, content: prev.content + msg.t } : null);
            }
            if (msg.done) {
              queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(id) });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch {
      setStreamingStep(null);
    }
  }, [id, queryClient]);

  // Clear streaming card once the step appears in the DB-fetched list
  useEffect(() => {
    if (!streamingStep) return;
    if (analysis?.steps.some(s => s.stepKey === streamingStep.key)) {
      setStreamingStep(null);
    }
  }, [analysis?.steps, streamingStep]);

  // Auto-trigger next step sequentially
  useEffect(() => {
    if (!analysis || analysis.status !== "in_progress" || isStreaming) return;
    const nextIndex = analysis.steps.length;
    if (nextIndex >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[nextIndex];
    if (triggeredSteps.current.has(nextStepKey)) return;
    triggeredSteps.current.add(nextStepKey);
    runStreamingStep(nextStepKey);
  }, [analysis?.steps.length, analysis?.status, isStreaming, runStreamingStep]);

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
    if (isComplete || isStreaming || currentStepCount >= ANALYSIS_STEPS_ORDER.length) return;
    const nextStepKey = ANALYSIS_STEPS_ORDER[currentStepCount];
    if (triggeredSteps.current.has(nextStepKey)) return;
    triggeredSteps.current.add(nextStepKey);
    runStreamingStep(nextStepKey);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* 인쇄 전용 헤더 — 화면에서는 숨김, 인쇄 시에만 표시 */}
      <div className="hidden print:block mb-8 pb-6 border-b-2 border-gray-800">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-2">애빛다 &nbsp;|&nbsp; AI 기업분석 리포트</div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">
              {analysis.companyName}
              <span className="ml-2 text-base font-mono text-gray-500">({analysis.ticker})</span>
            </h1>
            {analysis.englishName && <p className="text-sm text-gray-500 mt-0.5">{analysis.englishName}</p>}
            <p className="text-xs text-gray-400 mt-1">{toKoreanIndustry(analysis.industry)} &nbsp;·&nbsp; {format(new Date(analysis.createdAt), 'yyyy년 M월 d일 HH:mm', { locale: ko })} 생성</p>
          </div>
          {analysis.investmentVerdict && (
            <div className="text-right">
              <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-1">최종 투자 의견</div>
              <div className="text-xl font-bold text-gray-900">{toKoreanVerdict(analysis.investmentVerdict)}</div>
              {analysis.targetPrice && (
                <div className="text-sm text-gray-600 mt-0.5">적정주가 {formatCurrency(analysis.targetPrice)}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Back button */}
      <button
        onClick={() => setLocation("/analysis/new")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group print:hidden"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        목록으로
      </button>

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
            <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground leading-tight">
              {analysis.companyName}
            </h1>
            {analysis.englishName && (
              <p className="text-sm text-muted-foreground mt-0.5 mb-1 font-normal">{analysis.englishName}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-2">
              <span className="flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> {toKoreanIndustry(analysis.industry)}</span>
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {format(new Date(analysis.createdAt), 'M월 d일 HH:mm', { locale: ko })}</span>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-3 print:hidden w-full md:w-auto">
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2.5 py-1.5 rounded-lg transition-colors border border-transparent hover:border-destructive/20 self-end"
              title="분석 삭제"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>삭제</span>
            </button>

          {/* Verdict Card */}
          {isComplete && analysis.investmentVerdict && (
            <div className="bg-primary/5 border border-primary/20 p-5 rounded-xl w-full md:min-w-[250px] md:w-auto">
              <div className="text-[11px] font-mono text-primary/70 mb-1 uppercase tracking-widest">최종 투자 의견</div>
              <div className="text-xl font-bold text-foreground mb-3">{toKoreanVerdict(analysis.investmentVerdict)}</div>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex justify-between items-center border-b border-border pb-1.5">
                  <span className="text-muted-foreground">적정주가</span>
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

      {/* Financial Chart */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <FinancialChart ticker={analysis.ticker} />
      </div>

      {/* Progress Track */}
      <div className="bg-card border border-border rounded-2xl p-5 print:hidden">
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
          {[...analysis.steps]
            .sort((a, b) => ANALYSIS_STEPS_ORDER.indexOf(a.stepKey as any) - ANALYSIS_STEPS_ORDER.indexOf(b.stepKey as any))
            .map((step, idx) => (
            <StepCard key={step.id} step={step} agent={AGENTS[step.stepKey]} delay={idx * 0.05} ticker={analysis.ticker} companyName={analysis.companyName} />
          ))}
        </AnimatePresence>

        {/* Streaming card — live typewriter while AI writes */}
        <div className="print:hidden">
          <AnimatePresence>
            {streamingStep && (
              <StreamingCard
                key={streamingStep.key}
                stepKey={streamingStep.key}
                content={streamingStep.content}
                qcStatus={streamingStep.qcStatus}
                qcScore={streamingStep.qcScore}
                qcFeedback={streamingStep.qcFeedback}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Next Action — only shown when not streaming and not complete */}
        {!isComplete && !isStreaming && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-8 rounded-xl border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center text-center gap-4 print:hidden"
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
                  className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all flex items-center gap-2 shadow-sm"
                >
                  <Play className="w-4 h-4 fill-current" /> {currentStepCount + 1}단계 실행
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

      {/* 연관기업 — 분석 시작 후 표시 */}
      {analysis.steps.length > 0 && (
        <PeerGroupSection
          ticker={analysis.ticker}
          companyName={analysis.companyName}
          industry={analysis.industry ?? undefined}
          analysisSteps={analysis.steps.map(s => ({ stepKey: s.stepKey, content: s.content ?? "" }))}
        />
      )}

      {/* 보관하기 · 공유하기 + Disclaimer — 분석 완료 후 페이드인 */}
      <AnimatePresence>
        {isComplete && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
          >
            {/* 보관하기 · 공유하기 */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3 print:hidden">
              <button
                onClick={toggleBookmark}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2.5 rounded-xl border px-5 py-3.5 text-sm font-semibold transition-all duration-200",
                  bookmarked
                    ? "bg-primary border-primary text-white shadow-sm hover:bg-primary/90"
                    : "bg-white border-neutral-200 text-neutral-700 hover:border-primary/40 hover:text-primary hover:bg-primary/5"
                )}
              >
                {bookmarked
                  ? <BookmarkCheck className="w-4 h-4" />
                  : <Bookmark className="w-4 h-4" />}
                {bookmarked ? "보관됨" : "보관하기"}
              </button>
              <button
                onClick={copyLink}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2.5 rounded-xl border px-5 py-3.5 text-sm font-semibold transition-all duration-200",
                  linkCopied
                    ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                    : "bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
                )}
              >
                {linkCopied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                {linkCopied ? "링크 복사됨" : "공유하기"}
              </button>
            </div>

            {/* Disclaimer */}
            <div className="mt-5 pt-6 border-t border-neutral-100 print:mt-6">
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-5 py-4 space-y-2">
                <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">투자 유의사항</p>
                <p className="text-[11.5px] text-neutral-500 leading-relaxed">
                  본 리포트는 <span className="font-semibold">애빛다 AI</span>가 공개된 재무 데이터 및 시장 정보를 기반으로 자동 생성한 참고 자료입니다.
                  투자 판단의 최종 책임은 투자자 본인에게 있으며, 본 내용은 특정 종목의 매수·매도를 권유하거나 추천하는 것이 아닙니다.
                </p>
                <p className="text-[11.5px] text-neutral-500 leading-relaxed">
                  AI가 생성한 수치와 전망은 실제 결과와 다를 수 있으며, 시장 상황·기업 공시·거시경제 변수에 따라 언제든지 변동될 수 있습니다.
                  과거 수익률이나 AI 분석 결과(적정주가 포함)는 미래 수익을 보장하지 않습니다. 투자 전 반드시 공식 공시 자료 및 전문가 의견을 병행하여 검토하시기 바랍니다.
                </p>
                <p className="text-[10.5px] text-neutral-400 mt-1">
                  분석 생성일: {analysis.createdAt ? new Date(analysis.createdAt).toLocaleString("ko-KR") : "—"} &nbsp;·&nbsp; © {new Date().getFullYear()} 애빛다. AI로 기업가치를 밝히다.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

function extractJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  // 1) 마크다운 코드블록 제거 (```json ... ``` 또는 ``` ... ```)
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  // 2) 앞뒤 설명 텍스트 제거 — 첫 { 부터 마지막 } 까지만 추출
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function InvestmentStrategyCard({ step, agent, delay, ticker, companyName, createdAt }: { step: any, agent: AgentInfo, delay: number, ticker?: string, companyName?: string, createdAt?: string }) {
  const json = extractJson(step.content);

  const verdictMeta = (v: string) => {
    if (!v) return { label: "—", color: "text-foreground", bg: "bg-neutral-100", border: "border-neutral-200", dot: "#6b7280" };
    const s = v.toLowerCase();
    if (s.includes("strong buy"))  return { label: "높은 상승여력", color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200", dot: "#059669" };
    if (s.includes("buy"))         return { label: "상승여력",      color: "text-green-700",   bg: "bg-green-50",    border: "border-green-200",   dot: "#16a34a" };
    if (s.includes("strong sell")) return { label: "높은 하락여지", color: "text-red-700",     bg: "bg-red-50",      border: "border-red-200",     dot: "#dc2626" };
    if (s.includes("sell"))        return { label: "하락여지",      color: "text-red-600",     bg: "bg-red-50",      border: "border-red-200",     dot: "#ef4444" };
    return { label: "적정 수준", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", dot: "#d97706" };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-2xl overflow-hidden border border-neutral-200 bg-white shadow-sm"
    >
      {/* ── 상단 헤더 ── */}
      <div className="bg-neutral-900 px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
            <agent.icon className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-white font-display font-semibold text-sm leading-tight">최종 투자 전략</p>
            <p className="text-neutral-400 text-[10px] font-mono uppercase tracking-widest">{agent.role}</p>
          </div>
        </div>
        {companyName && (
          <span className="text-[11px] text-neutral-400 font-medium hidden sm:block">{companyName}{ticker ? ` · ${ticker}` : ""}</span>
        )}
      </div>

      {json ? (() => {
        const vm = verdictMeta(json.verdict ?? "");
        return (
          <div className="divide-y divide-neutral-100">

            {/* ── ① 판정 + 메타 ── */}
            <div className="px-6 py-5 flex flex-wrap items-center gap-3">
              <span className={cn("text-[26px] font-display font-bold leading-none", vm.color)}>{vm.label}</span>
              <div className="flex flex-wrap gap-1.5">
                {json.confidence && (
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
                    신뢰도 {json.confidence}
                  </span>
                )}
                {json.investment_period && (
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
                    {json.investment_period}
                  </span>
                )}
                {json.risk_reward && (
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
                    R/R {json.risk_reward}
                  </span>
                )}
              </div>
            </div>

            {/* ── ② 핵심 이슈 ── */}
            {json.key_issue && (
              <div className="px-6 py-4 bg-amber-50/60">
                <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-widest mb-1">핵심 이슈</p>
                <p className="text-sm text-neutral-800 leading-relaxed font-medium">{json.key_issue}</p>
              </div>
            )}

            {/* ── ③ 투자 논거 요약 ── */}
            {json.summary && (
              <div className="px-6 py-4">
                <p className="text-sm text-neutral-600 leading-[1.8]">{json.summary}</p>
              </div>
            )}

            {/* ── ④ 가격 3박스 ── */}
            <div className="px-6 py-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-center">
                  <p className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider mb-1.5">진입가</p>
                  <p className="font-bold text-neutral-900 text-[15px] font-mono">{formatPrice(json.entry_price)}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center relative">
                  <div className="absolute -top-px left-1/2 -translate-x-1/2 w-10 h-0.5 bg-emerald-400 rounded-full" />
                  <p className="text-[10px] font-mono text-emerald-600 uppercase tracking-wider mb-1.5">적정주가</p>
                  <p className="font-bold text-emerald-700 text-[15px] font-mono">{formatPrice(json.target_price)}</p>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                  <p className="text-[10px] font-mono text-red-400 uppercase tracking-wider mb-1.5">손절가</p>
                  <p className="font-bold text-red-600 text-[15px] font-mono">{formatPrice(json.stop_loss)}</p>
                </div>
              </div>
            </div>

            {/* ── ⑤ 시나리오 테이블 ── */}
            {json.scenarios?.length > 0 && (
              <div className="px-6 py-4">
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">시나리오 분석</p>
                <div className="rounded-xl border border-neutral-200 overflow-hidden">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-neutral-50 border-b border-neutral-200">
                        <th className="px-4 py-2.5 text-left font-semibold text-neutral-500">시나리오</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-neutral-500">적정주가</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-neutral-500">등락률</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-neutral-500">확률</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {json.scenarios.map((s: any, i: number) => {
                        const isBear = s.case === "Bear";
                        const isBull = s.case === "Bull";
                        const isBase = s.case === "Base";
                        const uStr = String(s.upside ?? "");
                        const uNum = parseFloat(uStr.replace(/[^0-9.\-]/g, ""));
                        const uDisplay = !isNaN(uNum) && !uStr.includes("%") ? (uNum > 0 ? "+" : "") + uNum + "%" : uStr;
                        const uColor = uStr.startsWith("+") || (!uStr.startsWith("-") && uNum > 0) ? "text-emerald-600" : uStr.startsWith("-") || uNum < 0 ? "text-red-500" : "text-neutral-500";
                        const pStr = String(s.probability ?? "");
                        const pNum = parseFloat(pStr.replace(/[^0-9.]/g, ""));
                        const pDisplay = !isNaN(pNum) && !pStr.includes("%") ? pNum + "%" : pStr;
                        return (
                          <tr key={i} className={cn("transition-colors", isBase ? "bg-blue-50/60" : "bg-white hover:bg-neutral-50/60")}>
                            <td className="px-4 py-3 font-semibold">
                              <span className={cn("text-xs", isBear && "text-red-500", isBase && "text-blue-600", isBull && "text-emerald-600")}>
                                {isBear ? "▼ Bear" : isBull ? "▲ Bull" : "— Base"}
                              </span>
                            </td>
                            <td className={cn("px-4 py-3 text-right font-mono font-semibold", isBear ? "text-red-600" : isBull ? "text-emerald-600" : "text-neutral-900")}>
                              {formatPrice(s.target_price)}
                            </td>
                            <td className={cn("px-4 py-3 text-right font-mono font-medium", uColor)}>{uDisplay}</td>
                            <td className="px-4 py-3 text-right text-neutral-400 font-mono">{pDisplay}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── ⑥ 핵심 리스크 + 모니터링 ── */}
            {(json.risks?.length > 0 || json.monitoring_indicators?.length > 0) && (
              <div className="px-6 py-4 grid sm:grid-cols-2 gap-5">
                {json.risks?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">핵심 리스크</p>
                    <ul className="space-y-2">
                      {json.risks.map((r: string, i: number) => (
                        <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-neutral-600 leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {json.monitoring_indicators?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">모니터링 지표</p>
                    <ul className="space-y-2">
                      {json.monitoring_indicators.map((m: string, i: number) => (
                        <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-neutral-500 leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-300 mt-1.5 shrink-0" />
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

          </div>
        );
      })() : (
        <div className="p-6 text-sm text-neutral-600 leading-relaxed space-y-2">
          {step.content.split('\n').map((p: string, i: number) => p.trim() ? <p key={i}>{p}</p> : null)}
        </div>
      )}
    </motion.div>
  );
}

const SLOW_STEP_MESSAGES: Record<string, string[]> = {
  company_intro: [
    "사업보고서 첫 페이지부터 뒤지는 중이에요 📄",
    "이 회사... 뭐 하는 곳인지 파악 중이에요 🤔",
    "IR 자료 정독 중... 광고 문구는 걸러야 해요",
    "창업 스토리 찾는 중이에요, 재미있는 게 있으면 알려드릴게요 😄",
    "기업 소개 거의 완성됐어요!",
  ],
  industry_analysis: [
    "업계 지도 그리는 중이에요 🗺️",
    "경쟁사 몰래 분석 중... (농담이에요 😅)",
    "시장 규모 계산기 두드리는 중이에요 🧮",
    "포터의 5가지 힘... 교수님 생각나네요",
    "이 산업, 꽤 복잡하네요. 정리하고 있어요",
    "거의 다 됐어요, 산업 구조 윤곽 잡혔어요!",
  ],
  catalyst_analysis: [
    "주가 흔들 만한 이슈 사냥 중이에요 🎯",
    "악재와 호재 저울질 중이에요 ⚖️",
    "뉴스 더미에서 진짜 재료 캐는 중이에요 🔍",
    "다음 분기 뭐가 터질지 예측 중이에요 🔮",
    "재료주인지 아닌지 판단하는 중이에요",
    "촉매 분석 마무리 검토 중이에요!",
  ],
  company_analysis: [
    "재무제표 3개년치 펼쳐놨어요 📊",
    "매출은 오르는데 이익이... 🤔 이유 찾는 중이에요",
    "영업CF가 순이익이랑 왜 다른지 파고드는 중이에요",
    "실적 드라이버가 뭔지 파헤치는 중이에요",
    "부채 많긴 한데 괜찮은지 확인 중이에요",
    "EPS·EBITDA 직접 계산해보는 중이에요 ✏️",
    "데이터가 많아서요, 조금만 더 기다려주세요 🙏",
    "거의 다 됐어요! 막바지 검토 중이에요",
  ],
  relative_valuation: [
    "DCF 스프레드시트 10년치 펼치는 중이에요 📈",
    "WACC 계산 중... 수식이 꽤 많네요",
    "피어 멀티플 수집 중이에요, 비싼지 싼지 봐야죠",
    "Terminal Value가 너무 크지 않나 확인 중이에요 😅",
    "Reverse DCF로 현재 주가 역산 중이에요",
    "절대가치 vs 상대가치, 어떻게 조율할지 고민 중이에요",
    "FCFF 수치 정합성 검증 중이에요... 빈틈 없이 할게요",
    "적정주가 두 개를 하나로 좁히는 마지막 단계예요 🎯",
  ],
  market_analysis: [
    "차트 펼쳐보는 중이에요 📉📈",
    "지지선이 어딘지 눈금자 대는 중이에요 📏",
    "RSI 과매도 구간인지 확인 중이에요",
    "외국인·기관 수급 흐름 추적 중이에요 🕵️",
    "이 가격대에서 사도 되는지 계산하는 중이에요 💭",
    "손절선 어디 둘지... 신중하게 정하는 중이에요",
    "진입 타점 거의 잡혔어요!",
  ],
  investment_strategy: [
    "6단계 분석 전부 머릿속에서 합치는 중이에요 🧠",
    "상승여력이 충분한지... 숫자가 답을 내려줄 거예요",
    "투자 논거 한 문장으로 압축 중이에요 ✍️",
    "리스크와 기회, 마지막으로 저울질 중이에요 ⚖️",
    "최종 적정주가 확정 중이에요... 거의 다 됐어요!",
    "보고서 마무리 검토 중이에요 📝",
  ],
};

function RotatingAnalysisMessage({ stepKey }: { stepKey: string }) {
  const messages = SLOW_STEP_MESSAGES[stepKey];
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!messages || messages.length <= 1) return;
    const interval = setInterval(() => {
      setIdx(prev => {
        if (prev >= messages.length - 1) {
          clearInterval(interval);
          return prev;
        }
        setVisible(false);
        setTimeout(() => setVisible(true), 350);
        return prev + 1;
      });
    }, 3800);
    return () => clearInterval(interval);
  }, [messages]);

  if (!messages) return <span>분석 중...</span>;

  return (
    <span
      style={{ transition: "opacity 0.35s ease" }}
      className={visible ? "opacity-100" : "opacity-0"}
    >
      {messages[idx]}
    </span>
  );
}

const BRAND_BLUE = "#1d4ed8";
const BRAND_AMBER = "#d97706";

const AGENT_COLORS: Record<string, string> = {
  company_intro: BRAND_BLUE,
  industry_analysis: BRAND_BLUE,
  company_analysis: BRAND_BLUE,
  relative_valuation: BRAND_BLUE,
  market_analysis: BRAND_BLUE,
  catalyst_analysis: BRAND_AMBER,
  investment_strategy: BRAND_BLUE,
};

function StreamingCard({ stepKey, content, qcStatus, qcScore, qcFeedback }: {
  stepKey: string;
  content: string;
  qcStatus?: "checking" | "approved" | "revising" | "revised";
  qcScore?: number;
  qcFeedback?: string;
}) {
  const agent = AGENTS[stepKey];
  const color = AGENT_COLORS[stepKey] ?? "hsl(218, 67%, 44%)";
  if (!agent) return null;

  const isQCPhase = qcStatus === "checking" || qcStatus === "approved" || qcStatus === "revising" || qcStatus === "revised";
  const showCursor = !isQCPhase || qcStatus === "revising";

  const statusBadge = () => {
    if (qcStatus === "checking") return (
      <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
        <ShieldCheck className="w-3.5 h-3.5 animate-pulse" />
        <span>팀장 검토 중...</span>
      </div>
    );
    if (qcStatus === "approved") return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>검토 통과 {qcScore}/10</span>
      </div>
    );
    if (qcStatus === "revising") return (
      <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span>재분석 중... ({qcScore}/10)</span>
      </div>
    );
    if (qcStatus === "revised") return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>재분석 완료 {qcScore}/10</span>
      </div>
    );
    return null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden border-l-4"
      style={{ borderLeftColor: color }}
    >
      <div className="bg-muted/40 px-5 py-3.5 flex items-center gap-3 border-b border-border">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center border" style={{ background: `${color}15`, borderColor: `${color}30` }}>
          <agent.icon className="w-4.5 h-4.5" style={{ color }} />
        </div>
        <div className="flex-1">
          <h4 className="font-display font-semibold text-sm text-foreground leading-tight">{agent.role}</h4>
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">{agent.name}</span>
        </div>
        {statusBadge()}
      </div>

      {qcStatus === "checking" ? (
        <div className="p-5 flex items-center justify-center gap-3 text-sm text-muted-foreground py-8">
          <ShieldCheck className="w-5 h-5 text-amber-500 animate-pulse" />
          <span>Lead Portfolio Strategist가 분석 품질을 검토하고 있습니다...</span>
        </div>
      ) : (
        <div className="p-5">
          {qcStatus === "revising" && qcFeedback && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20 text-xs text-amber-700 flex items-start gap-2">
              <RefreshCw className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span><span className="font-semibold">팀장 피드백:</span> {qcFeedback}</span>
            </div>
          )}
          <div className="markdown-body" style={{ fontSize: "15px", lineHeight: "1.85", color: "#262626" }}>
            {!content && !isQCPhase ? (
              <span className="flex items-center gap-2 text-muted-foreground/50 select-none py-1">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                <RotatingAnalysisMessage stepKey={stepKey} />
              </span>
            ) : (
              <>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
                {showCursor && (
                  <span className="inline-block w-0.5 h-[1em] bg-primary ml-0.5 animate-[pulse_0.8s_ease-in-out_infinite] align-middle" />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function parseChartLevels(content: string): ChartLevels | null {
  const match = content.match(/CHART_DATA:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as ChartLevels;
    // Zero values are treated as absent
    const clean: ChartLevels = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v > 0) (clean as any)[k] = v;
    }
    return Object.keys(clean).length > 0 ? clean : null;
  } catch { return null; }
}

function stripChartData(content: string): string {
  return content.replace(/\n?---\n[\s\S]*?CHART_DATA:\{[^\n]+\}[\s\S]*$/, "").replace(/\nCHART_DATA:\{[^\n]+\}\s*$/, "").trim();
}

interface ValuationData {
  current: number;
  dcf_bear: number; dcf_base: number; dcf_bull: number;
  pe_bear: number;  pe_base: number;  pe_bull: number;
  ev_bear: number;  ev_base: number;  ev_bull: number;
}

function parseValuationData(content: string): ValuationData | null {
  const match = content.match(/VALUATION_DATA:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as ValuationData;
    if (!parsed.dcf_base) return null;
    return parsed;
  } catch { return null; }
}

function stripValuationData(content: string): string {
  return content.replace(/\nVALUATION_DATA:\{[^\n]+\}\s*$/, "").trim();
}

interface FinalValuationData {
  current: number;
  bear: number; base: number; bull: number;
  abs_bear: number; abs_base: number; abs_bull: number;
  rel_bear: number; rel_base: number; rel_bull: number;
}

function parseFinalValuationData(content: string): FinalValuationData | null {
  const match = content.match(/FINAL_VALUATION_DATA:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as FinalValuationData;
    if (!parsed.base) return null;
    return parsed;
  } catch { return null; }
}

function stripFinalValuationData(content: string): string {
  return content.replace(/\nFINAL_VALUATION_DATA:\{[^\n]+\}\s*$/, "").trim();
}

function StepCard({ step, agent: agentProp, delay, ticker, companyName }: { step: any, agent: AgentInfo | undefined, delay: number, ticker?: string, companyName?: string }) {
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
    return <InvestmentStrategyCard step={step} agent={agent} delay={delay} ticker={ticker} companyName={companyName} createdAt={step.createdAt} />;
  }

  const isMarket = step.stepKey === "market_analysis";
  const isFundamental = step.stepKey === "company_analysis";
  const isRelativeVal = step.stepKey === "relative_valuation";
  const chartLevels = isMarket ? parseChartLevels(step.content ?? "") : null;
  const valuationData = isFundamental ? parseValuationData(step.content ?? "") : null;
  const finalValuationData = isRelativeVal ? parseFinalValuationData(step.content ?? "") : null;
  const displayContent = isMarket
    ? stripChartData(step.content ?? "")
    : isFundamental
      ? stripValuationData(step.content ?? "")
      : isRelativeVal
        ? stripFinalValuationData(step.content ?? "")
        : (step.content ?? "");

  const color = AGENT_COLORS[step.stepKey] ?? "hsl(218, 67%, 44%)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card border border-border rounded-xl overflow-hidden border-l-4"
      style={{ borderLeftColor: color }}
    >
      <div className="bg-muted/40 px-5 py-3.5 flex items-center gap-3 border-b border-border">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center border" style={{ background: `${color}15`, borderColor: `${color}30` }}>
          <agent.icon className="w-4.5 h-4.5" style={{ color }} />
        </div>
        <div>
          <h4 className="font-display font-semibold text-sm text-foreground leading-tight">{agent.role}</h4>
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">{agent.name}</span>
        </div>
      </div>

      <div className="p-5">
        <div className="markdown-body" style={{ fontSize: "15px", lineHeight: "1.85", color: "#262626" }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => (
                <h2 className="text-base font-bold text-foreground mt-6 mb-3 first:mt-0 pb-1.5 border-b border-border/60">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-semibold text-foreground mt-5 mb-2 flex items-center gap-1.5">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="text-[13px] font-semibold text-foreground/80 mt-3 mb-1.5">{children}</h4>
              ),
              p: ({ children }) => {
                const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
                if (text.startsWith("출처:") || text.startsWith("출처 :")) {
                  return <p className="mt-4 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">{children}</p>;
                }
                return <p className="mb-3.5 last:mb-0 text-foreground/80 leading-[1.75]">{children}</p>;
              },
              ul: ({ children }) => <ul>{children}</ul>,
              ol: ({ children }) => <ol>{children}</ol>,
              li: ({ children }) => <li>{children}</li>,
              strong: ({ children }) => (
                <strong>{children}</strong>
              ),
              em: ({ children }) => <em className="text-foreground/70 not-italic">{children}</em>,
              blockquote: ({ children }) => (
                <blockquote className="my-3 pl-3 border-l-2 border-border text-foreground/60 text-[13px] italic">
                  {children}
                </blockquote>
              ),
              hr: () => <hr className="my-4 border-border/60" />,
              table: ({ children }) => (
                <div className="table-wrap">
                  <table>{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead>{children}</thead>,
              tbody: ({ children }) => <tbody>{children}</tbody>,
              tr: ({ children }) => <tr>{children}</tr>,
              th: ({ children }) => <th>{children}</th>,
              td: ({ children }) => <td>{children}</td>,
            }}
          >
            {displayContent}
          </ReactMarkdown>
        </div>

        {/* Valuation B 최종 조율 목표주가 요약 박스 */}
        {isRelativeVal && finalValuationData && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ background: color }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">최종 조율 적정주가</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>절대가치 × 상대가치 조율</span>
            </div>
            <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[300px] text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="px-3 py-2.5 text-left font-semibold text-foreground/80 border-b border-border">구분</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-rose-600 border-b border-border">하단 밴드</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-emerald-600 border-b border-border">적정주가</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-blue-600 border-b border-border">상단 밴드</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">절대가치(DCF)</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(finalValuationData.abs_bear)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono">{formatPrice(finalValuationData.abs_base)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(finalValuationData.abs_bull)}</td>
                  </tr>
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">상대가치(피어)</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(finalValuationData.rel_bear)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono">{formatPrice(finalValuationData.rel_base)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(finalValuationData.rel_bull)}</td>
                  </tr>
                  <tr className="bg-muted/20 font-semibold">
                    <td className="px-3 py-2.5 font-bold text-foreground">조율 적정주가</td>
                    <td className="px-3 py-2.5 text-right text-rose-600 font-mono font-bold">{formatPrice(finalValuationData.bear)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600 font-mono font-bold">{formatPrice(finalValuationData.base)}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 font-mono font-bold">{formatPrice(finalValuationData.bull)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="bg-muted/40 px-4 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border sm:flex sm:items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">현재 주가</span>
                <span className="font-mono text-sm font-semibold text-foreground text-right sm:text-left">{formatPrice(finalValuationData.current)}</span>
                <span className="text-xs text-muted-foreground">
                  {finalValuationData.base >= finalValuationData.current ? "상승여력" : "하락여지"}
                </span>
                <span className={`font-mono text-sm font-bold text-right sm:text-left ${finalValuationData.base > finalValuationData.current ? "text-emerald-600" : "text-rose-600"}`}>
                  {finalValuationData.current > 0 ? `${((finalValuationData.base - finalValuationData.current) / finalValuationData.current * 100).toFixed(1)}%` : "-"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Fundamental & Valuation 목표주가 요약 박스 */}
        {isFundamental && valuationData && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ background: color }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">밸류에이션 적정주가</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">3-Method 종합</span>
            </div>
            <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[300px] text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="px-3 py-2.5 text-left font-semibold text-foreground/80 border-b border-border">방법론</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-rose-600 border-b border-border">Bear</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-emerald-600 border-b border-border">Base</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-blue-600 border-b border-border">Bull</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">DCF</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(valuationData.dcf_bear)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono font-semibold">{formatPrice(valuationData.dcf_base)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(valuationData.dcf_bull)}</td>
                  </tr>
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">Forward P/E</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(valuationData.pe_bear)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono font-semibold">{formatPrice(valuationData.pe_base)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(valuationData.pe_bull)}</td>
                  </tr>
                  <tr className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground/80">EV/EBITDA</td>
                    <td className="px-3 py-2 text-right text-rose-600 font-mono">{formatPrice(valuationData.ev_bear)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono font-semibold">{formatPrice(valuationData.ev_base)}</td>
                    <td className="px-3 py-2 text-right text-blue-600 font-mono">{formatPrice(valuationData.ev_bull)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="bg-muted/40 px-4 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border sm:flex sm:items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">현재 주가</span>
                <span className="font-mono text-sm font-semibold text-foreground text-right sm:text-left">{formatPrice(valuationData.current)}</span>
                <span className="text-xs text-muted-foreground">
                  Base {valuationData.dcf_base >= valuationData.current ? "상승여력" : "하락여지"}
                </span>
                <span className={`font-mono text-sm font-bold text-right sm:text-left ${valuationData.dcf_base > valuationData.current ? "text-emerald-600" : "text-rose-600"}`}>
                  {valuationData.current > 0 ? `${((valuationData.dcf_base - valuationData.current) / valuationData.current * 100).toFixed(1)}%` : "-"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Market Analysis 전용 차트 */}
        {isMarket && ticker && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ background: color }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">기술적 분석 차트</span>
              {chartLevels && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">AI 레벨 오버레이 적용</span>}
            </div>
            <StockChart ticker={ticker} companyName={companyName} chartLevels={chartLevels ?? undefined} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
