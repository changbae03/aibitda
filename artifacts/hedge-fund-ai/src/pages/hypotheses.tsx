import { useState } from "react";
import { useListHypotheses, useCreateHypothesis, useUpdateHypothesis } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Hypothesis } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { 
  Crosshair, 
  Plus, 
  RefreshCw,
  Search
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";

const inputClass = "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all";

export default function Hypotheses() {
  const { data: hypotheses, isLoading } = useListHypotheses();
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = hypotheses?.filter(h => 
    h.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
    h.companyName.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground flex items-center gap-2.5">
            <Crosshair className="w-6 h-6 text-primary" />
            투자 가설 트래커
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            AI 및 투자자 논리를 시간에 걸쳐 검증하는 시스템
          </p>
        </div>
        <CreateHypothesisDialog />
      </header>

      {/* Search */}
      <div className="bg-card border border-border rounded-lg flex items-center px-4 gap-3">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input 
          type="text" 
          placeholder="종목코드 또는 기업명으로 검색..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-transparent border-none focus:outline-none text-foreground placeholder:text-muted-foreground py-3 text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-muted/50 text-muted-foreground font-mono text-xs uppercase border-b border-border">
              <tr>
                <th className="px-5 py-3.5 tracking-wider">종목</th>
                <th className="px-5 py-3.5 tracking-wider">가설 내용</th>
                <th className="px-5 py-3.5 tracking-wider text-right">진입가</th>
                <th className="px-5 py-3.5 tracking-wider text-right">목표가</th>
                <th className="px-5 py-3.5 tracking-wider text-center">상태</th>
                <th className="px-5 py-3.5 tracking-wider text-right">업데이트</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground text-sm animate-pulse">
                    데이터 로딩 중...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground text-sm">
                    {searchTerm ? "검색 결과가 없습니다." : "등록된 가설이 없습니다. 새 가설을 추가하세요."}
                  </td>
                </tr>
              ) : (
                filtered.map((hyp) => <HypothesisRow key={hyp.id} hypothesis={hyp} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HypothesisRow({ hypothesis: hyp }: { hypothesis: Hypothesis }) {
  const getStatusStyle = (outcome: string) => {
    switch(outcome) {
      case 'hit_target': return 'bg-success/10 text-success border-success/20';
      case 'hit_stoploss': return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'pending':
      case 'ongoing': return 'bg-warning/10 text-warning border-warning/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getStatusLabel = (outcome: string) => {
    switch(outcome) {
      case 'hit_target': return '목표가 도달';
      case 'hit_stoploss': return '손절 도달';
      case 'pending': return '대기중';
      case 'ongoing': return '추적중';
      case 'expired': return '만료됨';
      default: return outcome;
    }
  };

  return (
    <tr className="hover:bg-muted/30 transition-colors group">
      <td className="px-5 py-4">
        <div className="font-bold text-primary font-mono text-sm group-hover:underline">
          {hyp.ticker}
        </div>
        <div className="text-xs text-muted-foreground truncate max-w-[110px]">
          {hyp.companyName}
        </div>
      </td>
      <td className="px-5 py-4">
        <div className="max-w-sm truncate text-foreground text-sm" title={hyp.hypothesisText}>
          {hyp.hypothesisText}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 font-mono">
          {format(new Date(hyp.createdAt), 'M월 d일, yyyy', { locale: ko })}
        </div>
      </td>
      <td className="px-5 py-4 text-right font-mono text-sm text-foreground">
        {formatCurrency(hyp.entryPrice)}
      </td>
      <td className="px-5 py-4 text-right font-mono text-sm">
        <div className="text-success font-semibold">{formatCurrency(hyp.targetPrice)}</div>
      </td>
      <td className="px-5 py-4 text-center">
        <span className={cn("px-2.5 py-0.5 rounded text-xs font-semibold border", getStatusStyle(hyp.outcome))}>
          {getStatusLabel(hyp.outcome)}
        </span>
      </td>
      <td className="px-5 py-4 text-right">
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
    ticker: "", companyName: "", hypothesisText: "", targetPrice: "", entryPrice: "",
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
        <button className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-sm">
          <Plus className="w-4 h-4" /> 가설 추가
        </button>
      </DialogTrigger>
      <DialogContent className="bg-card border border-border sm:max-w-[480px] text-foreground">
        <DialogHeader className="pb-4 border-b border-border">
          <DialogTitle className="text-lg font-display text-foreground">투자 가설 등록</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">AI 또는 투자자 논리를 등록하여 시간에 걸쳐 검증합니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">종목코드</label>
              <input required value={formData.ticker} onChange={e=>setFormData({...formData, ticker: e.target.value})} placeholder="예: 005930" className={inputClass + " font-mono uppercase"} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">기업명</label>
              <input required value={formData.companyName} onChange={e=>setFormData({...formData, companyName: e.target.value})} placeholder="예: 삼성전자" className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">진입가</label>
              <input required type="number" step="0.01" value={formData.entryPrice} onChange={e=>setFormData({...formData, entryPrice: e.target.value})} className={inputClass + " font-mono"} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-success uppercase tracking-wide">목표가</label>
              <input required type="number" step="0.01" value={formData.targetPrice} onChange={e=>setFormData({...formData, targetPrice: e.target.value})} className={inputClass + " font-mono border-success/30 focus:border-success focus:ring-success/20"} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">핵심 가설</label>
            <textarea required rows={3} value={formData.hypothesisText} onChange={e=>setFormData({...formData, hypothesisText: e.target.value})} placeholder="투자 근거를 입력하세요..." className={inputClass + " resize-none"} />
          </div>
          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">취소</button>
            <button type="submit" disabled={isPending} className="px-5 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {isPending ? "저장 중..." : "가설 저장"}
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
        <button className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-card border border-border sm:max-w-[400px] text-foreground">
        <DialogHeader className="pb-4 border-b border-border">
          <DialogTitle className="text-base font-display">상태 업데이트: {hypothesis.ticker}</DialogTitle>
          <div className="mt-1.5 text-sm text-muted-foreground border-l-2 border-primary/30 pl-3 line-clamp-2">
            {hypothesis.hypothesisText}
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">결과 상태</label>
            <select 
              value={formData.outcome} 
              onChange={e=>setFormData({...formData, outcome: e.target.value})}
              className={inputClass}
            >
              <option value="ongoing">추적중 / 진행중</option>
              <option value="hit_target">목표가 도달 (성공)</option>
              <option value="hit_stoploss">손절 도달 (실패)</option>
              <option value="expired">만료 / 기간 경과</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">실제 가격</label>
            <input 
              type="number" step="0.01" 
              value={formData.actualPrice} 
              onChange={e=>setFormData({...formData, actualPrice: e.target.value})} 
              className={inputClass + " font-mono"}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">회고 메모</label>
            <textarea 
              rows={3} 
              value={formData.notes} 
              placeholder="성공 혹은 실패 원인을 기록하세요..."
              onChange={e=>setFormData({...formData, notes: e.target.value})} 
              className={inputClass + " resize-none"}
            />
          </div>
          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">취소</button>
            <button type="submit" disabled={isPending} className="px-5 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {isPending ? "저장 중..." : "결과 저장"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
