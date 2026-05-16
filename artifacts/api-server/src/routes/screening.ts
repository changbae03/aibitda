import { Router, Request, Response } from "express";
import { pool } from "@workspace/db";
import YahooFinance from "yahoo-finance2";
import { KR_UNIVERSE, US_UNIVERSE } from "../lib/universe-tickers.js";

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

// ═══════════════════════════════════════════════════════════════
// 전종목 유니버스 스크리닝 (KOSPI200+KOSDAQ150 + S&P500+NASDAQ100)
// ═══════════════════════════════════════════════════════════════

export interface UniverseStock {
  ticker: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "NASDAQ100" | "SP500";
  price: number;
  currency: "KRW" | "USD";
  change_pct: number;
  pe: number | null;
  pb: number | null;
  eps: number | null;
  dividend_yield: number | null;
  market_cap: number | null;
  week52_high: number | null;
  week52_low: number | null;
  momentum_pct: number | null;
  score: number;
}

let universeCache: { data: UniverseStock[]; ts: number } | null = null;
const UNIVERSE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6시간

function calcUniverseScore(
  pe: number | null, pb: number | null,
  dividendYield: number | null, momentumPct: number | null, eps: number | null
): number {
  let score = 0;

  // P/E 팩터 (0-30점)
  if (pe != null && pe > 0) {
    if (pe <= 12)       score += 30;
    else if (pe <= 20)  score += 22;
    else if (pe <= 35)  score += 12;
    else                score += 4;
  } else if (pe != null && pe <= 0) {
    score += 2; // 적자
  } else {
    score += 14; // 데이터 없음 → 중립
  }

  // 52주 모멘텀 (0-30점) — 저점 대비 10~50% 구간이 밸류+업사이드 최적
  if (momentumPct != null) {
    if (momentumPct >= 10 && momentumPct <= 45)       score += 30;
    else if (momentumPct > 45 && momentumPct <= 65)   score += 20;
    else if (momentumPct > 65 && momentumPct <= 80)   score += 12;
    else if (momentumPct < 10)                        score += 8;
    else                                              score += 6; // 80% 이상 → 과매수
  } else {
    score += 15;
  }

  // P/B 팩터 (0-20점)
  if (pb != null && pb > 0) {
    if (pb <= 1.0)      score += 20;
    else if (pb <= 2.0) score += 14;
    else if (pb <= 4.0) score += 7;
    else                score += 2;
  } else {
    score += 10;
  }

  // 배당수익률 (0-15점)
  if (dividendYield != null) {
    if (dividendYield >= 5)      score += 15;
    else if (dividendYield >= 3) score += 11;
    else if (dividendYield >= 1) score += 6;
    else if (dividendYield > 0)  score += 2;
  }

  // EPS 양수 여부 (0-5점)
  if (eps != null && eps > 0) score += 5;

  return Math.min(100, score);
}

async function buildUniverseData(): Promise<UniverseStock[]> {
  // 모든 유니버스 티커를 Yahoo 심볼로 변환
  type TickerMeta = { ticker: string; name: string; market: "KOSPI" | "KOSDAQ" | "NASDAQ100" | "SP500"; symbol: string; currency: "KRW" | "USD" };
  const allItems: TickerMeta[] = [];

  const seenTicker = new Set<string>();
  for (const kr of KR_UNIVERSE) {
    if (seenTicker.has(kr.ticker)) continue;
    seenTicker.add(kr.ticker);
    const symbol = kr.market === "KOSPI" ? `${kr.ticker}.KS` : `${kr.ticker}.KQ`;
    allItems.push({ ticker: kr.ticker, name: kr.name, market: kr.market, symbol, currency: "KRW" });
  }
  const seenUS = new Set<string>();
  for (const us of US_UNIVERSE) {
    if (seenUS.has(us.ticker)) continue;
    seenUS.add(us.ticker);
    allItems.push({ ticker: us.ticker, name: us.name, market: us.index as "NASDAQ100" | "SP500", symbol: us.ticker, currency: "USD" });
  }

  // 배치 병렬 조회 (배치 40개 × 동시 4)
  const BATCH = 40;
  const CONCURRENT = 4;
  const quoteMap = new Map<string, any>();

  const symbols = allItems.map(t => t.symbol);
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));

  for (let i = 0; i < batches.length; i += CONCURRENT) {
    await Promise.all(batches.slice(i, i + CONCURRENT).map(async batch => {
      try {
        const quotes = await (yahooFinance as any).quote(batch, {}, { validateResult: false });
        const arr: any[] = Array.isArray(quotes) ? quotes : (quotes ? [quotes] : []);
        for (const q of arr) { if (q?.symbol) quoteMap.set(q.symbol, q); }
      } catch { /* 개별 배치 실패 시 무시 */ }
    }));
  }

  // .KS 실패 시 .KQ 재시도 (또는 반대)
  const altNeeded = allItems
    .filter(t => t.currency === "KRW" && !quoteMap.has(t.symbol))
    .map(t => t.symbol.endsWith(".KS") ? t.symbol.replace(".KS", ".KQ") : t.symbol.replace(".KQ", ".KS"));

  for (let i = 0; i < altNeeded.length; i += BATCH) {
    try {
      const quotes = await (yahooFinance as any).quote(altNeeded.slice(i, i + BATCH), {}, { validateResult: false });
      const arr: any[] = Array.isArray(quotes) ? quotes : (quotes ? [quotes] : []);
      for (const q of arr) { if (q?.symbol) quoteMap.set(q.symbol, q); }
    } catch { /* skip */ }
  }

  // 결과 빌드
  const results: UniverseStock[] = [];
  for (const t of allItems) {
    let q = quoteMap.get(t.symbol);
    if (!q && t.currency === "KRW") {
      const alt = t.symbol.endsWith(".KS") ? t.symbol.replace(".KS", ".KQ") : t.symbol.replace(".KQ", ".KS");
      q = quoteMap.get(alt);
    }
    const price = q?.regularMarketPrice;
    if (price == null || price === 0) continue;

    const high   = q?.fiftyTwoWeekHigh ?? null;
    const low    = q?.fiftyTwoWeekLow ?? null;
    const momentumPct = (high != null && low != null && high > low)
      ? Math.round(((price - low) / (high - low)) * 100)
      : null;
    const pe           = q?.trailingPE ?? null;
    const pb           = q?.priceToBook ?? null;
    const eps          = q?.trailingEps ?? null;
    const rawYield     = q?.dividendYield;
    const dividendYield = rawYield != null
      ? Math.round(rawYield * (rawYield > 1 ? 1 : 100) * 10) / 10  // 소수 또는 % 혼용 대응
      : null;
    const marketCap    = q?.marketCap ?? null;
    const changePct    = q?.regularMarketChangePercent ?? 0;
    const score = calcUniverseScore(pe, pb, dividendYield, momentumPct, eps);

    results.push({
      ticker: t.ticker, name: t.name, market: t.market,
      price, currency: t.currency,
      change_pct: Math.round(changePct * 10) / 10,
      pe:   pe   != null ? Math.round(pe   * 10) / 10 : null,
      pb:   pb   != null ? Math.round(pb   * 10) / 10 : null,
      eps:  eps  != null ? Math.round(eps  * 10) / 10 : null,
      dividend_yield: dividendYield,
      market_cap: marketCap,
      week52_high: high, week52_low: low,
      momentum_pct: momentumPct,
      score,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

router.get("/universe-screening", async (req: Request, res: Response) => {
  try {
    if (!universeCache || Date.now() - universeCache.ts > UNIVERSE_CACHE_TTL) {
      console.log("[universe] 캐시 갱신 중… (약 15-30초 소요)");
      const data = await buildUniverseData();
      universeCache = { data, ts: Date.now() };
      console.log(`[universe] 캐시 완료: ${data.length}건`);
    }

    let result = [...universeCache.data];

    // 시장 필터
    const market = req.query.market as string | undefined;
    if (market === "KR")  result = result.filter(s => s.market === "KOSPI" || s.market === "KOSDAQ");
    if (market === "US")  result = result.filter(s => s.market === "NASDAQ100" || s.market === "SP500");
    if (market === "KOSPI")   result = result.filter(s => s.market === "KOSPI");
    if (market === "KOSDAQ")  result = result.filter(s => s.market === "KOSDAQ");
    if (market === "NASDAQ100") result = result.filter(s => s.market === "NASDAQ100");
    if (market === "SP500")  result = result.filter(s => s.market === "SP500");

    // P/E 필터
    const maxPE = Number(req.query.maxPE);
    if (!isNaN(maxPE) && maxPE > 0) result = result.filter(s => s.pe != null && s.pe > 0 && s.pe <= maxPE);

    // 최소 점수
    const minScore = Number(req.query.minScore);
    if (!isNaN(minScore) && minScore > 0) result = result.filter(s => s.score >= minScore);

    // 정렬
    const sortBy = req.query.sortBy as string | undefined;
    switch (sortBy) {
      case "pe":       result.sort((a, b) => (a.pe ?? 9999) - (b.pe ?? 9999)); break;
      case "pb":       result.sort((a, b) => (a.pb ?? 9999) - (b.pb ?? 9999)); break;
      case "momentum": result.sort((a, b) => (a.momentum_pct ?? 100) - (b.momentum_pct ?? 100)); break;
      case "change":   result.sort((a, b) => b.change_pct - a.change_pct); break;
      case "mktcap":   result.sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0)); break;
      case "yield":    result.sort((a, b) => (b.dividend_yield ?? 0) - (a.dividend_yield ?? 0)); break;
      default:         /* score — already sorted */ break;
    }

    return res.json({
      stocks: result.slice(0, 200), // 최대 200개 반환
      total: result.length,
      universe_size: universeCache.data.length,
      cached_at: new Date(universeCache.ts).toISOString(),
    });
  } catch (err: any) {
    console.error("[universe] error:", err?.message);
    return res.status(500).json({ error: "유니버스 스크리닝 실패" });
  }
});

router.post("/universe-screening/refresh", (_req: Request, res: Response) => {
  universeCache = null;
  res.json({ ok: true });
});

export default router;
