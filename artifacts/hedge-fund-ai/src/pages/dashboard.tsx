import { Link } from "wouter";
import { useListAnalyses, useListHypotheses } from "@workspace/api-client-react";
import { format } from "date-fns";
import { 
  ArrowRight, 
  BrainCircuit, 
  Target, 
  TrendingUp, 
  Activity,
  AlertCircle
} from "lucide-react";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { motion } from "framer-motion";

export default function Dashboard() {
  const { data: analyses, isLoading: loadingAnalyses } = useListAnalyses();
  const { data: hypotheses, isLoading: loadingHypotheses } = useListHypotheses();

  const completedAnalyses = analyses?.filter(a => a.status === 'completed') || [];
  const inProgressAnalyses = analyses?.filter(a => a.status === 'in_progress') || [];
  
  const activeHypotheses = hypotheses?.filter(h => h.outcome === 'pending' || h.outcome === 'ongoing') || [];
  const successfulHypotheses = hypotheses?.filter(h => h.outcome === 'hit_target') || [];
  
  const winRate = hypotheses && hypotheses.length > 0 
    ? (successfulHypotheses.length / (hypotheses.filter(h => h.outcome !== 'pending' && h.outcome !== 'ongoing').length || 1)) * 100
    : 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Alpha Command Center
          </h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm">
            AI Research Team Status & Portfolio Insights
          </p>
        </div>
        <Link 
          href="/analysis/new"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 shadow-[0_0_20px_rgba(234,179,8,0.3)] hover:shadow-[0_0_30px_rgba(234,179,8,0.5)] transition-all hover:-translate-y-0.5"
        >
          <BrainCircuit className="w-5 h-5" />
          Deploy Research Team
        </Link>
      </header>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Active Investigations" 
          value={inProgressAnalyses.length.toString()} 
          icon={Activity} 
          trend="Currently running"
          delay={0.1}
        />
        <StatCard 
          title="Completed Reports" 
          value={completedAnalyses.length.toString()} 
          icon={Target} 
          trend="Historical database"
          delay={0.2}
        />
        <StatCard 
          title="Active Hypotheses" 
          value={activeHypotheses.length.toString()} 
          icon={AlertCircle} 
          trend="Tracking in market"
          delay={0.3}
        />
        <StatCard 
          title="AI Alpha Win Rate" 
          value={`${winRate.toFixed(1)}%`} 
          icon={TrendingUp} 
          trend="Based on resolved cases"
          trendColor="text-success"
          delay={0.4}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Analyses */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold">Recent Intelligence</h2>
            <Link href="/analysis/new" className="text-sm text-primary hover:underline flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="glass-panel rounded-2xl overflow-hidden">
            {loadingAnalyses ? (
              <div className="p-8 text-center text-muted-foreground animate-pulse">Loading intelligence...</div>
            ) : analyses?.length === 0 ? (
              <div className="p-12 text-center">
                <BrainCircuit className="w-12 h-12 text-white/10 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">No data available</h3>
                <p className="text-muted-foreground">Deploy the AI research team to generate insights.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {analyses?.slice(0, 5).map((analysis, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 * i }}
                    key={analysis.id}
                  >
                    <Link 
                      href={`/analysis/${analysis.id}`}
                      className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors group cursor-pointer block"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center font-mono font-bold text-primary border border-white/5 shadow-inner">
                          {analysis.ticker.substring(0, 4)}
                        </div>
                        <div>
                          <h4 className="font-semibold text-white group-hover:text-primary transition-colors">
                            {analysis.companyName}
                          </h4>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                            <span className="font-mono bg-white/5 px-2 py-0.5 rounded text-xs">{analysis.industry}</span>
                            <span>{format(new Date(analysis.createdAt), 'MMM d, yyyy')}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        {analysis.status === 'in_progress' ? (
                          <div className="flex items-center gap-2 text-amber-400">
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                            </span>
                            <span className="text-sm font-medium">Processing ({analysis.steps.length}/9)</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end">
                            <span className="text-sm font-medium text-success">Completed</span>
                            <span className="text-xs text-muted-foreground font-mono mt-1">
                              TGT: {formatCurrency(analysis.targetPrice)}
                            </span>
                          </div>
                        )}
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Hot Hypotheses */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold">Tracked Convictions</h2>
            <Link href="/hypotheses" className="text-sm text-primary hover:underline">
              View Board
            </Link>
          </div>

          <div className="glass-panel rounded-2xl p-4 flex flex-col gap-3">
            {loadingHypotheses ? (
              <div className="py-8 text-center text-muted-foreground animate-pulse">Loading tracker...</div>
            ) : activeHypotheses.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">No active hypotheses being tracked.</div>
            ) : (
              activeHypotheses.slice(0, 4).map((hyp, i) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * i }}
                  key={hyp.id} 
                  className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-primary/30 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-mono font-bold text-primary">{hyp.ticker}</span>
                    <span className="text-xs uppercase tracking-wider font-semibold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
                      Pending
                    </span>
                  </div>
                  <p className="text-sm text-white/80 line-clamp-2 leading-relaxed mb-3">
                    {hyp.hypothesisText}
                  </p>
                  <div className="flex justify-between text-xs font-mono text-muted-foreground">
                    <span>IN: {formatCurrency(hyp.entryPrice)}</span>
                    <span className="text-white">TGT: {formatCurrency(hyp.targetPrice)}</span>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, trend, trendColor = "text-muted-foreground", delay }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className="glass-panel p-6 rounded-2xl"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <div className="p-2 bg-white/5 rounded-lg">
          <Icon className="w-5 h-5 text-primary" />
        </div>
      </div>
      <div className="text-3xl font-display font-bold text-white mb-1">{value}</div>
      <div className={cn("text-xs font-medium", trendColor)}>{trend}</div>
    </motion.div>
  );
}
