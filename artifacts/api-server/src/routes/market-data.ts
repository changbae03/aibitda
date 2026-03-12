import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

const router: IRouter = Router();

function calculateRSI(closes: number[], window = 14): (number | null)[] {
  const rsi: (number | null)[] = new Array(window).fill(null);
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= window; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / window;
  let avgLoss = losses / window;
  
  for (let i = window; i < closes.length; i++) {
    if (i === window) {
      rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
      continue;
    }
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (window - 1) + gain) / window;
    avgLoss = (avgLoss * (window - 1) + loss) / window;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  
  return rsi;
}

function calculateMA(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calculateBollingerBands(closes: number[], period = 20, multiplier = 2) {
  const upper: (number | null)[] = [];
  const middle: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      middle.push(null);
      lower.push(null);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper.push(avg + multiplier * std);
    middle.push(avg);
    lower.push(avg - multiplier * std);
  }
  return { upper, middle, lower };
}

function isValidEquityName(name: string | undefined, symbol: string): boolean {
  if (!name) return false;
  // Invalid if name contains commas (fund/index codes) or is identical to the ticker
  if (name.includes(",")) return false;
  if (name.trim() === symbol.trim()) return false;
  return true;
}

async function resolveKoreanTicker(
  ticker: string,
  period1: string,
  period2: string,
  interval: string,
) {
  if (!/^\d{6}$/.test(ticker)) return null;

  const [ksChart, kqChart, ksQuote, kqQuote] = await Promise.allSettled([
    yahooFinance.chart(`${ticker}.KS`, { period1, period2, interval: interval as any }),
    yahooFinance.chart(`${ticker}.KQ`, { period1, period2, interval: interval as any }),
    yahooFinance.quote(`${ticker}.KS`),
    yahooFinance.quote(`${ticker}.KQ`),
  ]);

  const ksValid = ksChart.status === "fulfilled" && ksChart.value?.quotes?.some((q) => q.close && q.close > 0);
  const kqValid = kqChart.status === "fulfilled" && kqChart.value?.quotes?.some((q) => q.close && q.close > 0);

  const ksName = ksQuote.status === "fulfilled" ? (ksQuote.value.longName ?? ksQuote.value.shortName ?? "") : "";
  const kqName = kqQuote.status === "fulfilled" ? (kqQuote.value.longName ?? kqQuote.value.shortName ?? "") : "";

  const ksNameOk = isValidEquityName(ksName, `${ticker}.KS`);
  const kqNameOk = isValidEquityName(kqName, `${ticker}.KQ`);

  // Prefer the exchange whose company name looks like a real stock
  if (kqValid && kqNameOk && !ksNameOk) {
    return { symbol: `${ticker}.KQ`, result: kqChart.value! };
  }
  if (ksValid && ksNameOk && !kqNameOk) {
    return { symbol: `${ticker}.KS`, result: ksChart.value! };
  }
  // Both valid or both invalid → prefer KQ (KOSDAQ has more individual stocks)
  if (kqValid) return { symbol: `${ticker}.KQ`, result: kqChart.value! };
  if (ksValid) return { symbol: `${ticker}.KS`, result: ksChart.value! };
  return null;
}

router.get("/:ticker", async (req, res) => {
  const { ticker } = req.params;
  const { period = "1y", interval = "1d" } = req.query as {
    period?: string;
    interval?: string;
  };

  try {
    const periodMap: Record<string, number> = {
      "3m": 90,
      "6m": 180,
      "1y": 365,
      "2y": 730,
      "5y": 1825,
    };
    const days = periodMap[period] ?? 365;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const periodStr = period as string;
    const p1 = startDate.toISOString().split("T")[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const p2 = tomorrow.toISOString().split("T")[0];

    const koreanResolved = await resolveKoreanTicker(ticker, p1, p2, interval as string);
    const result = koreanResolved?.result ?? await yahooFinance.chart(ticker, {
      period1: p1,
      period2: p2,
      interval: (interval as any) ?? "1d",
    });

    const rawQuotes = result?.quotes;
    if (!rawQuotes || rawQuotes.length === 0) {
      res.status(404).json({ error: "No data found for ticker" });
      return;
    }

    const quotes = rawQuotes.filter((d) => d.close != null && d.close > 0);
    if (quotes.length === 0) {
      res.status(404).json({ error: "No valid price data for ticker" });
      return;
    }

    const dates = quotes.map((d) => {
      // Yahoo Finance stores timestamps at midnight of the exchange's local timezone.
      // KRX (Seoul, UTC+9): midnight KST = 15:00 UTC previous day → ISO date is wrong.
      // Adding 12 h normalises across all major exchanges (KST +9, ET -5, etc.).
      const adjusted = new Date(new Date(d.date).getTime() + 12 * 3600 * 1000);
      return adjusted.toISOString().split("T")[0];
    });
    const opens = quotes.map((d) => d.open ?? 0);
    const highs = quotes.map((d) => d.high ?? 0);
    const lows = quotes.map((d) => d.low ?? 0);
    const closes = quotes.map((d) => d.close ?? 0);
    const volumes = quotes.map((d) => d.volume ?? 0);
    void periodStr;

    const rsi = calculateRSI(closes);
    const ma20 = calculateMA(closes, 20);
    const ma60 = calculateMA(closes, 60);
    const ma120 = calculateMA(closes, 120);
    const bb = calculateBollingerBands(closes);

    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2] ?? currentPrice;
    const changePercent = ((currentPrice - prevPrice) / prevPrice) * 100;
    const yearHigh = Math.max(...highs);
    const yearLow = Math.min(...lows);
    const currentRsi = rsi[rsi.length - 1];

    let quoteInfo = null;
    const resolvedSymbol = koreanResolved?.symbol ?? ticker;
    try {
      const quote = await yahooFinance.quote(resolvedSymbol);
      quoteInfo = {
        longName: quote.longName ?? quote.shortName,
        marketCap: quote.marketCap,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
        averageVolume: quote.averageDailyVolume10Day,
        currency: quote.currency,
      };
    } catch {
      // quote info optional
    }

    res.json({
      ticker,
      quoteInfo,
      currentPrice,
      changePercent,
      yearHigh,
      yearLow,
      currentRsi,
      candles: dates.map((date, i) => ({
        date,
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i],
        volume: volumes[i],
        rsi: rsi[i],
        ma20: ma20[i],
        ma60: ma60[i],
        ma120: ma120[i],
        bbUpper: bb.upper[i],
        bbMiddle: bb.middle[i],
        bbLower: bb.lower[i],
      })),
    });
  } catch (err: any) {
    console.error("Market data error:", err);
    res.status(500).json({ error: err?.message ?? "Failed to fetch market data" });
  }
});

export default router;
