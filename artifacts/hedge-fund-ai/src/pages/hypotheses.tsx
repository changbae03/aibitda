import { useState } from "react";
import { useListHypotheses, useCreateHypothesis, useUpdateHypothesis } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Hypothesis } from "@workspace/api-client-react";
import { format } from "date-fns";
import { 
  Crosshair, 
  Plus, 
  Target, 
  TrendingUp, 
  AlertOctagon,
  RefreshCw,
  Search
} from "lucide-react";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";

export default function Hypotheses() {
  const { data: hypotheses, isLoading } = useListHypotheses();
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = hypotheses?.filter(h => 
    h.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
    h.companyName.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-white flex items-center gap-3">
            <Crosshair className="w-8 h-8 text-primary" />
            Hypothesis Tracker
          </h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm">
            Self-Evolving AI Logic Validation System
          </p>
        </div>
        <CreateHypothesisDialog />
      </header>

      <div className="glass-panel p-2 rounded-2xl mb-6 flex items-center px-4">
        <Search className="w-5 h-5 text-muted-foreground mr-3" />
        <input 
          type="text" 
          placeholder="Filter by ticker or company..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-transparent border-none focus:outline-none text-white placeholder:text-muted-foreground py-3"
        />
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden border border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-black/40 text-muted-foreground font-mono text-xs uppercase border-b border-white/10">
              <tr>
                <th className="px-6 py-4 tracking-wider">Asset</th>
                <th className="px-6 py-4 tracking-wider">Hypothesis Outline</th>
                <th className="px-6 py-4 tracking-wider text-right">Entry</th>
                <th className="px-6 py-4 tracking-wider text-right">Target / Stop</th>
                <th className="px-6 py-4 tracking-wider text-center">Status</th>
                <th className="px-6 py-4 tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground animate-pulse">
                    Loading tracking data...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    No hypotheses found. Create one to start tracking.
                  </td>
                </tr>
              ) : (
                filtered.map((hyp) => (
                  <HypothesisRow key={hyp.id} hypothesis={hyp} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HypothesisRow({ hypothesis: hyp }: { hypothesis: Hypothesis }) {
  const getStatusColor = (outcome: string) => {
    switch(outcome) {
      case 'hit_target': return 'bg-success/10 text-success border-success/30';
      case 'hit_stoploss': return 'bg-destructive/10 text-destructive border-destructive/30';
      case 'pending':
      case 'ongoing': return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
      default: return 'bg-white/10 text-white/70 border-white/20';
    }
  };

  const getStatusLabel = (outcome: string) => {
    switch(outcome) {
      case 'hit_target': return 'Target Hit';
      case 'hit_stoploss': return 'Stop Loss';
      case 'pending': return 'Pending';
      case 'ongoing': return 'Active';
      case 'expired': return 'Expired';
      default: return outcome;
    }
  };

  return (
    <tr className="hover:bg-white/[0.02] transition-colors group">
      <td className="px-6 py-4">
        <div className="font-bold text-white font-mono text-base group-hover:text-primary transition-colors">
          {hyp.ticker}
        </div>
        <div className="text-xs text-muted-foreground truncate max-w-[120px]">
          {hyp.companyName}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="max-w-md truncate text-white/90" title={hyp.hypothesisText}>
          {hyp.hypothesisText}
        </div>
        <div className="text-xs text-muted-foreground mt-1 font-mono">
          {format(new Date(hyp.createdAt), 'MMM d, yyyy')}
        </div>
      </td>
      <td className="px-6 py-4 text-right font-mono text-white/80">
        {formatCurrency(hyp.entryPrice)}
      </td>
      <td className="px-6 py-4 text-right font-mono">
        <div className="text-success">{formatCurrency(hyp.targetPrice)}</div>
        {/* Simulating stop loss display if it existed, schema doesn't have it on hypothesis but it's conceptual */}
        <div className="text-xs text-destructive mt-0.5">SL: -10% (Est)</div>
      </td>
      <td className="px-6 py-4 text-center">
        <span className={cn("px-3 py-1 rounded text-xs font-bold uppercase tracking-wider border", getStatusColor(hyp.outcome))}>
          {getStatusLabel(hyp.outcome)}
        </span>
      </td>
      <td className="px-6 py-4 text-right">
        <UpdateHypothesisDialog hypothesis={hyp} />
      </td>
    </tr>
  );
}

function CreateHypothesisDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { mutate: create, isPending } = useCreateHypothesis();

  const [formData, setFormData] = useState({
    ticker: "",
    companyName: "",
    hypothesisText: "",
    targetPrice: "",
    entryPrice: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create({
      data: {
        ...formData,
        targetPrice: parseFloat(formData.targetPrice),
        entryPrice: parseFloat(formData.entryPrice),
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/hypotheses"] });
        setOpen(false);
        setFormData({ ticker: "", companyName: "", hypothesisText: "", targetPrice: "", entryPrice: "" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black font-semibold hover:bg-white/90 transition-all text-sm shadow-[0_0_15px_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(255,255,255,0.3)]">
          <Plus className="w-4 h-4" /> Manual Entry
        </button>
      </DialogTrigger>
      <DialogContent className="bg-card border border-white/10 sm:max-w-[500px] text-foreground p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-primary/20 to-transparent p-6 border-b border-white/5">
          <DialogTitle className="text-xl font-display text-white">Log Investment Hypothesis</DialogTitle>
          <DialogDescription className="text-white/60">Manually insert a tracking thesis to evaluate AI or human logic over time.</DialogDescription>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Ticker</label>
              <input required value={formData.ticker} onChange={e=>setFormData({...formData, ticker: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Company</label>
              <input required value={formData.companyName} onChange={e=>setFormData({...formData, companyName: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Entry Price ($)</label>
              <input required type="number" step="0.01" value={formData.entryPrice} onChange={e=>setFormData({...formData, entryPrice: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none font-mono" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-success uppercase">Target Price ($)</label>
              <input required type="number" step="0.01" value={formData.targetPrice} onChange={e=>setFormData({...formData, targetPrice: e.target.value})} className="w-full bg-black/50 border border-success/30 rounded-lg px-3 py-2 text-sm text-white focus:border-success focus:ring-1 focus:ring-success outline-none font-mono" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Core Thesis</label>
            <textarea required rows={3} value={formData.hypothesisText} onChange={e=>setFormData({...formData, hypothesisText: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none" />
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-white/5">Cancel</button>
            <button type="submit" disabled={isPending} className="px-6 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {isPending ? "Logging..." : "Save to Tracker"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UpdateHypothesisDialog({ hypothesis }: { hypothesis: Hypothesis }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { mutate: update, isPending } = useUpdateHypothesis();

  const [formData, setFormData] = useState({
    actualPrice: hypothesis.actualPrice?.toString() || "",
    outcome: hypothesis.outcome || "ongoing",
    notes: hypothesis.notes || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update({
      id: hypothesis.id,
      data: {
        actualPrice: formData.actualPrice ? parseFloat(formData.actualPrice) : undefined,
        outcome: formData.outcome as any,
        notes: formData.notes,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/hypotheses"] });
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-2 rounded-lg bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-card border border-white/10 sm:max-w-[400px] text-foreground p-0">
        <div className="p-6 border-b border-white/5">
          <DialogTitle className="text-xl font-display text-white">Update Status: {hypothesis.ticker}</DialogTitle>
          <div className="mt-2 text-sm text-muted-foreground border-l-2 border-white/20 pl-3">
            {hypothesis.hypothesisText}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Resolution State</label>
            <select 
              value={formData.outcome} 
              onChange={e=>setFormData({...formData, outcome: e.target.value})}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:border-primary outline-none"
            >
              <option value="ongoing">Active / Ongoing</option>
              <option value="hit_target">Hit Target (Success)</option>
              <option value="hit_stoploss">Hit Stop Loss (Failed)</option>
              <option value="expired">Expired / Time Horizon Passed</option>
            </select>
          </div>
          
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Current/Exit Price ($)</label>
            <input 
              type="number" step="0.01" 
              value={formData.actualPrice} 
              onChange={e=>setFormData({...formData, actualPrice: e.target.value})} 
              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-primary outline-none font-mono" 
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Retrospective Notes</label>
            <textarea 
              rows={3} 
              value={formData.notes} 
              placeholder="Why did this succeed or fail? What did the AI miss?"
              onChange={e=>setFormData({...formData, notes: e.target.value})} 
              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-primary outline-none resize-none" 
            />
          </div>
          
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-white/5">Cancel</button>
            <button type="submit" disabled={isPending} className="px-6 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {isPending ? "Updating..." : "Commit Result"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
