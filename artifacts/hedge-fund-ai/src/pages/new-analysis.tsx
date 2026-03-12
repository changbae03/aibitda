import { useState } from "react";
import { useLocation } from "wouter";
import { useStartAnalysis } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BrainCircuit, Loader2, Target, Briefcase, Building } from "lucide-react";
import { motion } from "framer-motion";

const formSchema = z.object({
  ticker: z.string().min(1, "종목코드를 입력해주세요").max(10),
  companyName: z.string().min(2, "기업명을 입력해주세요"),
  industry: z.string().min(2, "산업/섹터를 입력해주세요"),
  additionalContext: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const inputClass = "w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-sm";

export default function NewAnalysis() {
  const [, setLocation] = useLocation();
  const { mutateAsync: startAnalysis, isPending } = useStartAnalysis();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { ticker: "", companyName: "", industry: "", additionalContext: "" }
  });

  const onSubmit = async (data: FormValues) => {
    try {
      const result = await startAnalysis({ data });
      setLocation(`/analysis/${result.id}`);
    } catch (error) {
      console.error("Failed to start analysis", error);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-2xl border border-primary/20">
          <BrainCircuit className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground">
          AI 기업분석 시작
        </h1>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          8개의 전문 AI 에이전트가 9단계 분석 파이프라인을 통해 기관급 리서치를 수행합니다.
        </p>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm"
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" /> 종목코드
              </label>
              <input 
                {...form.register("ticker")}
                placeholder="예: 005930, AAPL, 078160.KS"
                className={inputClass + " font-mono uppercase"}
              />
              {form.formState.errors.ticker && (
                <p className="text-destructive text-xs mt-1">{form.formState.errors.ticker.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Building className="w-4 h-4 text-primary" /> 기업명
              </label>
              <input 
                {...form.register("companyName")}
                placeholder="예: 삼성전자, Apple Inc."
                className={inputClass}
              />
              {form.formState.errors.companyName && (
                <p className="text-destructive text-xs mt-1">{form.formState.errors.companyName.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-primary" /> 산업 / 섹터
            </label>
            <input 
              {...form.register("industry")}
              placeholder="예: 반도체, 바이오, 2차전지, 소비재"
              className={inputClass}
            />
            {form.formState.errors.industry && (
              <p className="text-destructive text-xs mt-1">{form.formState.errors.industry.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-foreground flex items-center justify-between">
              <span>추가 분석 포커스</span>
              <span className="text-xs text-muted-foreground font-normal">선택사항</span>
            </label>
            <textarea 
              {...form.register("additionalContext")}
              placeholder="AI가 집중 분석할 특정 항목을 입력하세요. 예: '최근 중국 수출규제 영향 분석', '배당 성장 가능성에 초점'"
              rows={3}
              className={inputClass + " resize-none"}
            />
          </div>

          <div className="pt-2">
            <button 
              type="submit" 
              disabled={isPending}
              className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AI 분석 팀 구성 중...
                </>
              ) : (
                <>
                  <BrainCircuit className="w-4 h-4" />
                  분석 시작하기
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
