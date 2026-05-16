import { Router, Request, Response } from "express";
import { pool } from "@workspace/db";
import YahooFinance from "yahoo-finance2";

const router = Router();
const yahooFinance = new YahooFinance();

interface ScreeningStock {
  id: number;
  ticker: string;
  company_name: string;
  industry: string | null;
  verdict: string;
  target_price: number;
  current_price: number;
  entry_price: number;
  stop_loss: number;
  upside_pct: number;
  rr: number;
  age_days: number;
  score: number;
  price_stale: boolean;
  analysis_date: string;
}

let screeningCache: { data: ScreeningStock[]; ts: number } | null = null;
const SCREENING_CACHE_TTL = 15 * 60 * 1000;

function toYahooSymbol(ticker: string): string {
  if (/^\d{6}$/.test(ticker.trim())) return `${ticker.trim()}.KS`;
  return ticker;
}

function calcScore(verdict: string, upsidePct: number, rr: number, ageDays: number): number {
  const verdictScore: Record<string, number> = {
    "Strong Buy": 50, "Buy": 40, "Hold": 25, "Sell": 15, "Strong Sell": 5,
  };
  const vs = verdictScore[verdict] ?? 25;
  const isBull = verdict === "Buy" || verdict === "Strong Buy";
  const isBear = verdict === "Sell" || verdict === "Strong Sell";

  let upsideBonus = 0;
  if (isBull) upsideBonus = Math.min(Math.max(upsidePct / 4, 0), 25);
  else if (isBear) upsideBonus = Math.min(Math.max(-upsidePct / 4, 0), 25);

  let rrBonus = 0;
  if (isBull) rrBonus = Math.min(Math.max(rr * 3, 0), 15);
  else if (isBear) rrBonus = Math.min(Math.max(-rr * 3, 0), 15);

  const freshBonus = Math.max(0, Math.min((90 - ageDays) / 9, 10));

  return Math.round(vs + upsideBonus + rrBonus + freshBonus);
}

async function buildScreeningData(): Promise<ScreeningStock[]> {
  const { rows } = await pool.query<{
    id: number; ticker: string; company_name: string; industry: string | null;
    investment_verdict: string; target_price: string; start_price: string;
    entry_price: string | null; stop_loss: string | null; created_at: Date;
  }>(`
    SELECT DISTINCT ON (ticker)
      id, ticker, company_name, industry,
      investment_verdict, target_price, start_price,
      entry_price, stop_loss, created_at
    FROM analyses
    WHERE status = 'completed'
      AND target_price IS NOT NULL
      AND start_price > 0
      AND created_at > NOW() - INTERVAL '90 days'
    ORDER BY ticker, created_at DESC
  `);

  if (rows.length === 0) return [];

  const tickerToSymbol = new Map<string, string>();
  const ksSymbols: string[] = [];
  for (const row of rows) {
    const sym = toYahooSymbol(row.ticker);
    tickerToSymbol.set(row.ticker, sym);
    ksSymbols.push(sym);
  }

  const quoteMap = new Map<string, number>();

  const fetchQuotes = async (syms: string[]) => {
    if (syms.length === 0) return;
    try {
      const quotes = await (yahooFinance as any).quote(syms, {}, { validateResult: false });
      const arr: any[] = Array.isArray(quotes) ? quotes : [quotes];
      for (const q of arr) {
        if (q?.symbol && q?.regularMarketPrice != null) {
          quoteMap.set(q.symbol, q.regularMarketPrice);
        }
      }
    } catch {
      for (const sym of syms) {
        try {
          const q: any = await (yahooFinance as any).quote(sym, {}, { validateResult: false });
          if (q?.regularMarketPrice != null) quoteMap.set(sym, q.regularMarketPrice);
        } catch { /* skip */ }
      }
    }
  };

  const BATCH = 50;
  for (let i = 0; i < ksSymbols.length; i += BATCH) {
    await fetchQuotes(ksSymbols.slice(i, i + BATCH));
  }

  const kqNeeded = rows
    .filter(r => /^\d{6}$/.test(r.ticker) && !quoteMap.has(`${r.ticker}.KS`))
    .map(r => `${r.ticker}.KQ`);

  for (let i = 0; i < kqNeeded.length; i += BATCH) {
    await fetchQuotes(kqNeeded.slice(i, i + BATCH));
  }

  for (const sym of kqNeeded) {
    if (quoteMap.has(sym)) {
      const ticker = sym.replace(".KQ", "");
      tickerToSymbol.set(ticker, sym);
    }
  }

  const now = Date.now();
  return rows.map(row => {
    const sym = tickerToSymbol.get(row.ticker)!;
    const currentPrice = quoteMap.get(sym) ?? Number(row.start_price);
    const priceStale = !quoteMap.has(sym);

    const tp = Number(row.target_price);
    const ep = Number(row.entry_price) || currentPrice;
    const sl = Number(row.stop_loss);
    const cp = Number(currentPrice);

    const upsidePct = tp && cp ? ((tp - cp) / cp) * 100 : 0;
    const rr = ep && sl && tp && ep !== sl ? (tp - ep) / (ep - sl) : 0;
    const ageDays = Math.floor((now - new Date(row.created_at).getTime()) / 86400000);
    const score = calcScore(row.investment_verdict, upsidePct, rr, ageDays);

    return {
      id: row.id,
      ticker: row.ticker,
      company_name: row.company_name,
      industry: row.industry,
      verdict: row.investment_verdict,
      target_price: tp,
      current_price: cp,
      entry_price: ep,
      stop_loss: sl,
      upside_pct: Math.round(upsidePct * 10) / 10,
      rr: Math.round(rr * 10) / 10,
      age_days: ageDays,
      score,
      price_stale: priceStale,
      analysis_date: row.created_at.toISOString(),
    };
  });
}

function applyFilters(stocks: ScreeningStock[], query: Partial<Record<string, string>>) {
  let result = [...stocks];

  const { verdicts, sector, minUpside, sortBy, side } = query;

  if (side === "bull") result = result.filter(s => s.verdict === "Buy" || s.verdict === "Strong Buy");
  else if (side === "bear") result = result.filter(s => s.verdict === "Sell" || s.verdict === "Strong Sell");

  if (verdicts) {
    const vList = verdicts.split(",").map(v => v.trim()).filter(Boolean);
    if (vList.length > 0) result = result.filter(s => vList.includes(s.verdict));
  }

  if (sector && sector !== "all") {
    result = result.filter(s => s.industry === sector);
  }

  if (minUpside !== undefined && minUpside !== "") {
    const min = Number(minUpside);
    result = result.filter(s => {
      const isBear = s.verdict === "Sell" || s.verdict === "Strong Sell";
      return isBear ? s.upside_pct <= -min : s.upside_pct >= min;
    });
  }

  switch (sortBy) {
    case "upside":
      result.sort((a, b) => Math.abs(b.upside_pct) - Math.abs(a.upside_pct));
      break;
    case "rr":
      result.sort((a, b) => Math.abs(b.rr) - Math.abs(a.rr));
      break;
    case "date":
      result.sort((a, b) => new Date(b.analysis_date).getTime() - new Date(a.analysis_date).getTime());
      break;
    case "score":
    default:
      result.sort((a, b) => b.score - a.score);
  }

  return result;
}

router.get("/screening", async (req: Request, res: Response) => {
  try {
    if (!screeningCache || Date.now() - screeningCache.ts > SCREENING_CACHE_TTL) {
      console.log("[screening] 캐시 갱신 중…");
      const data = await buildScreeningData();
      screeningCache = { data, ts: Date.now() };
      console.log(`[screening] 캐시 완료: ${data.length}건`);
    }
    const stocks = applyFilters(screeningCache.data, req.query as any);
    const industries = [...new Set(screeningCache.data.map(s => s.industry).filter(Boolean))].sort();
    return res.json({ stocks, industries, total: screeningCache.data.length, cached_at: new Date(screeningCache.ts).toISOString() });
  } catch (err: any) {
    console.error("[screening] error:", err?.message);
    return res.status(500).json({ error: "스크리닝 데이터를 불러오지 못했습니다" });
  }
});

router.post("/screening/refresh", async (_req: Request, res: Response) => {
  screeningCache = null;
  res.json({ ok: true });
});

export default router;
