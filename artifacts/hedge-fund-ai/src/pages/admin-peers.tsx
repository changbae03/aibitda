import { useState, useCallback } from "react";
import { RefreshCw, Database, Plus, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PeerMultiples {
  name: string;
  marketCap: number | null;
  pbr: number | null;
  per_trailing: number | null;
  per_fwd: number | null;
  ev_ebitda: number | null;
  ev_sales: number | null;
  roe: number | null;
  operating_margin: number | null;
  revenue: number | null;
  net_debt: number | null;
  _sources?: { yahoo: boolean; dart: boolean; calculated: string[] };
}

interface PeerSnapshot {
  subject: string;
  subject_name: string;
  collected_at: string;
  peers: Record<string, PeerMultiples>;
  averages?: Partial<PeerMultiples>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 1, suffix = ""): string {
  if (v == null) return "N/A";
  return `${v.toFixed(decimals)}${suffix}`;
}

function fmtMarketCap(v: number | null | undefined): string {
  if (v == null) return "N/A";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
  return `${(v / 1e6).toFixed(0)}M`;
}

function Cell({ v, suffix = "", decimals = 1 }: { v: number | null | undefined; suffix?: string; decimals?: number }) {
  const text = fmt(v, decimals, suffix);
  return (
    <td className={cn("px-3 py-2 text-right text-xs tabular-nums", v == null ? "text-muted-foreground" : "text-foreground/90")}>
      {text}
    </td>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminPeers() {
  const [subject, setSubject] = useState("");
  const [peersInput, setPeersInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PeerSnapshot | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [editingFwd, setEditingFwd] = useState<Record<string, string>>({});
  const [savingFwd, setSavingFwd] = useState<string | null>(null);

  const loadHistory = useCallback(async (subj: string) => {
    try {
      const r = await fetch(getApiUrl(`api/peers/history?subject=${encodeURIComponent(subj)}`), { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setHistory(d.dates ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  const collect = async () => {
    const tickers = peersInput.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (!subject.trim() || tickers.length === 0) {
      setError("분석 대상 종목과 피어 종목을 입력하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(getApiUrl("api/peers/collect"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subject: subject.trim(), peers: tickers }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "수집 실패");
      setSnapshot(data);
      await loadHistory(subject.trim());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadLatest = async () => {
    if (!subject.trim()) { setError("종목 코드를 먼저 입력하세요."); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(getApiUrl(`api/peers/latest?subject=${encodeURIComponent(subject.trim())}`), { credentials: "include" });
      if (!r.ok) { setError("데이터 없음"); return; }
      setSnapshot(await r.json());
      await loadHistory(subject.trim());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const loadByDate = async (date: string) => {
    setSelectedDate(date);
    setLoading(true);
    try {
      const r = await fetch(
        getApiUrl(`api/peers/by-date?subject=${encodeURIComponent(subject.trim())}&date=${date}`),
        { credentials: "include" }
      );
      if (r.ok) setSnapshot(await r.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const saveFwd = async (ticker: string) => {
    const val = parseFloat(editingFwd[ticker] ?? "");
    setSavingFwd(ticker);
    try {
      await fetch(getApiUrl("api/peers/manual"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: subject.trim(),
          ticker,
          fields: { per_fwd: isNaN(val) ? null : val },
        }),
      });
      await loadLatest();
      setEditingFwd(prev => { const n = { ...prev }; delete n[ticker]; return n; });
    } catch { /* ignore */ }
    finally { setSavingFwd(null); }
  };

  const rows = snapshot ? Object.entries(snapshot.peers) : [];
  const avgRow = snapshot?.averages;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Database size={22} className="text-blue-600" />
        <div>
          <h1 className="text-xl font-bold text-foreground">피어 멀티플 수집</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Yahoo Finance + DART 기반 자동 수집 · 아카이빙</p>
        </div>
      </div>

      {/* Input Panel */}
      <div className="bg-background border border-border rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-foreground/70 mb-1.5">분석 대상 종목 티커</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value.toUpperCase())}
              placeholder="078160.KQ"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground/70 mb-1.5">피어 종목 (콤마 또는 줄바꿈 구분)</label>
            <input
              value={peersInput}
              onChange={e => setPeersInput(e.target.value.toUpperCase())}
              placeholder="235980.KQ, 144510.KQ, MRNA"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={collect}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            수집 실행
          </button>
          <button
            onClick={loadLatest}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground/80 text-sm font-medium rounded-lg hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} />
            최신 데이터 불러오기
          </button>

          {history.length > 0 && (
            <select
              value={selectedDate}
              onChange={e => loadByDate(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg text-sm text-foreground/80 focus:outline-none"
            >
              <option value="">히스토리 선택...</option>
              {history.map(d => (
                <option key={d} value={d}>
                  {d.slice(0, 4)}-{d.slice(4, 6)}-{d.slice(6, 8)}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>

      {/* Results Table */}
      {snapshot && (
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div>
              <span className="font-semibold text-foreground text-sm">{snapshot.subject}</span>
              <span className="text-muted-foreground text-xs ml-2">피어 그룹 멀티플</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle size={12} className="text-green-500" />
              마지막 수집: {new Date(snapshot.collected_at).toLocaleString("ko-KR", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" })}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-3 py-2.5 text-left font-semibold text-foreground/70 whitespace-nowrap">티커</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-foreground/70 whitespace-nowrap">기업명</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">시총</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">P/B (배)</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">P/E TTM (배)</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">P/E Fwd (배) ✏️</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">EV/EBITDA (배)</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">EV/Sales (배)</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">ROE (%)</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">OPM (%)</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">매출</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-foreground/70 whitespace-nowrap">출처</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {rows.map(([ticker, p]) => (
                  <tr key={ticker} className="hover:bg-muted/50 transition-colors">
                    <td className="px-3 py-2 font-mono text-blue-700 font-medium whitespace-nowrap">{ticker}</td>
                    <td className="px-3 py-2 text-foreground/90 whitespace-nowrap max-w-[120px] truncate">{p.name}</td>
                    <td className="px-3 py-2 text-right text-foreground/70 text-xs tabular-nums whitespace-nowrap">
                      {fmtMarketCap(p.marketCap)}
                    </td>
                    <Cell v={p.pbr} decimals={2} suffix="x" />
                    <Cell v={p.per_trailing} decimals={1} suffix="x" />
                    {/* Fwd P/E — editable */}
                    <td className="px-3 py-2 text-right">
                      {editingFwd[ticker] !== undefined ? (
                        <span className="flex items-center justify-end gap-1">
                          <input
                            className="w-16 border border-border rounded px-1.5 py-0.5 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={editingFwd[ticker]}
                            onChange={e => setEditingFwd(prev => ({ ...prev, [ticker]: e.target.value }))}
                            onKeyDown={e => e.key === "Enter" && saveFwd(ticker)}
                            autoFocus
                          />
                          <button
                            onClick={() => saveFwd(ticker)}
                            disabled={savingFwd === ticker}
                            className="text-blue-600 hover:text-blue-800 text-[10px] font-medium"
                          >
                            {savingFwd === ticker ? "..." : "저장"}
                          </button>
                        </span>
                      ) : (
                        <span
                          onClick={() => setEditingFwd(prev => ({ ...prev, [ticker]: String(p.per_fwd ?? "") }))}
                          className={cn(
                            "cursor-pointer rounded px-1.5 py-0.5 text-xs tabular-nums",
                            p.per_fwd == null
                              ? "text-muted-foreground/50 hover:bg-muted"
                              : "text-foreground/90 hover:bg-blue-50 font-medium"
                          )}
                        >
                          {p.per_fwd != null ? `${p.per_fwd.toFixed(1)}x` : "—"}
                          <span className="ml-1 text-[9px] text-blue-400">수동</span>
                        </span>
                      )}
                    </td>
                    <Cell v={p.ev_ebitda} decimals={1} suffix="x" />
                    <Cell v={p.ev_sales} decimals={2} suffix="x" />
                    <Cell v={p.roe} decimals={1} suffix="%" />
                    <Cell v={p.operating_margin} decimals={1} suffix="%" />
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-foreground/70 whitespace-nowrap">
                      {p.revenue != null ? fmtMarketCap(p.revenue) : <span className="text-muted-foreground/50">N/A</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className="flex gap-1 justify-end">
                        {p._sources?.yahoo && (
                          <span className="text-[9px] bg-sky-100 text-sky-700 rounded px-1 py-0.5">Yahoo</span>
                        )}
                        {p._sources?.dart && (
                          <span className="text-[9px] bg-green-100 text-green-700 rounded px-1 py-0.5">DART</span>
                        )}
                        {p._sources?.calculated?.length ? (
                          <span className="text-[9px] bg-purple-100 text-purple-700 rounded px-1 py-0.5">계산</span>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
                {/* Average row */}
                {avgRow && rows.length > 1 && (
                  <tr className="bg-blue-50 font-semibold border-t border-blue-200">
                    <td className="px-3 py-2 text-blue-700 text-xs" colSpan={2}>피어 평균</td>
                    <td className="px-3 py-2 text-right text-xs text-blue-700 tabular-nums">
                      {fmtMarketCap(avgRow.marketCap)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-blue-700 tabular-nums">{fmt(avgRow.pbr, 2, "x")}</td>
                    <td className="px-3 py-2 text-right text-xs text-blue-700 tabular-nums">{fmt(avgRow.per_trailing, 1, "x")}</td>
                    <td className="px-3 py-2 text-right text-xs text-blue-700 tabular-nums">{fmt(avgRow.per_fwd, 1, "x")}</td>
                    <td className="px-3 py-2 text-right text-xs text-blue-700 tabular-nums">{fmt(avgRow.ev_ebitda, 1, "x")}</td>
                    <td className="px-3 py-2 text-right text-xs text-blue-700 tabular-nums">{fmt(avgRow.ev_sales, 2, "x")}</td>
                    <td className="px-3 py-2 text-right text-xs text-blue-700 tabular-nums">{fmt(avgRow.roe, 1, "%")}</td>
                    <td className="px-3 py-2 text-right text-xs text-blue-700 tabular-nums">{fmt(avgRow.operating_margin, 1, "%")}</td>
                    <td className="px-3 py-2 text-right text-xs text-blue-700 tabular-nums">
                      {fmtMarketCap(avgRow.revenue)}
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
            * EV/Sales = (시총 + 순차입금) ÷ 매출 (직접 계산) · DART 미연동 시 Yahoo Finance 매출 사용 · Fwd P/E는 셀 클릭 후 수동 입력
          </div>
        </div>
      )}
    </div>
  );
}
