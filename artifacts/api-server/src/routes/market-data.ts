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

    const result = await yahooFinance.chart(ticker, {
      period1: startDate.toISOString().split("T")[0],
      period2: new Date().toISOString().split("T")[0],
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

    const dates = quotes.map((d) => new Date(d.date).toISOString().split("T")[0]);
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
    try {
      const quote = await yahooFinance.quote(ticker);
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
