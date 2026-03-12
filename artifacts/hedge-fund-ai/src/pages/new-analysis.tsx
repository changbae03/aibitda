import { useState } from "react";
import { useLocation } from "wouter";
import { useStartAnalysis } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BrainCircuit, Loader2, Target, Briefcase, Building } from "lucide-react";
import { motion } from "framer-motion";

const formSchema = z.object({
  ticker: z.string().min(1, "Ticker is required").max(10),
  companyName: z.string().min(2, "Company name is required"),
  industry: z.string().min(2, "Industry is required"),
  additionalContext: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewAnalysis() {
  const [, setLocation] = useLocation();
  const { mutateAsync: startAnalysis, isPending } = useStartAnalysis();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      ticker: "",
      companyName: "",
      industry: "",
      additionalContext: "",
    }
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
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-2xl mb-2 border border-primary/20">
          <BrainCircuit className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-bold text-white">
          Initialize AI Research Protocol
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Deploy 8 specialized AI agents to conduct a comprehensive institutional-grade analysis. 
          The Lead Strategist will synthesize findings in real-time.
        </p>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel p-6 md:p-8 rounded-3xl"
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white/80 flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" /> Ticker Symbol
              </label>
              <input 
                {...form.register("ticker")}
                placeholder="e.g. AAPL, NVDA"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono uppercase transition-all"
              />
              {form.formState.errors.ticker && (
                <p className="text-destructive text-sm mt-1">{form.formState.errors.ticker.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-white/80 flex items-center gap-2">
                <Building className="w-4 h-4 text-primary" /> Company Name
              </label>
              <input 
                {...form.register("companyName")}
                placeholder="e.g. Apple Inc."
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              />
              {form.formState.errors.companyName && (
                <p className="text-destructive text-sm mt-1">{form.formState.errors.companyName.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-white/80 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-primary" /> Industry / Sector
            </label>
            <input 
              {...form.register("industry")}
              placeholder="e.g. Consumer Electronics, Semiconductors"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
            />
            {form.formState.errors.industry && (
              <p className="text-destructive text-sm mt-1">{form.formState.errors.industry.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-white/80 flex items-center justify-between">
              <span>Investment Context / Focus Area</span>
              <span className="text-xs text-muted-foreground font-normal">Optional</span>
            </label>
            <textarea 
              {...form.register("additionalContext")}
              placeholder="Provide specific angles for the AI to focus on (e.g. 'Analyze impact of recent China export bans' or 'Focus on potential dividend hikes')."
              rows={4}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none transition-all"
            />
          </div>

          <div className="pt-4">
            <button 
              type="submit" 
              disabled={isPending}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-primary to-amber-500 text-primary-foreground font-bold text-lg hover:shadow-[0_0_30px_rgba(234,179,8,0.4)] transition-all disabled:opacity-70 flex items-center justify-center gap-3 group"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Initializing Neural Core...
                </>
              ) : (
                <>
                  Commence Analysis
                  <BrainCircuit className="w-6 h-6 group-hover:scale-110 transition-transform" />
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
