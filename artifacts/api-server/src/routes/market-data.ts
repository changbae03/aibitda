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

const KOREAN_COMPANY_MAP: Array<{ name: string; keywords: string[]; symbol: string; exchange: string }> = [
  { name: "삼성전자", keywords: ["삼성전자", "삼성"], symbol: "005930.KS", exchange: "KSC" },
  { name: "SK하이닉스", keywords: ["sk하이닉스", "하이닉스"], symbol: "000660.KS", exchange: "KSC" },
  { name: "카카오", keywords: ["카카오"], symbol: "035720.KS", exchange: "KSC" },
  { name: "NAVER", keywords: ["네이버", "naver"], symbol: "035420.KS", exchange: "KSC" },
  { name: "현대차", keywords: ["현대차", "현대자동차"], symbol: "005380.KS", exchange: "KSC" },
  { name: "기아", keywords: ["기아"], symbol: "000270.KS", exchange: "KSC" },
  { name: "LG화학", keywords: ["lg화학", "엘지화학"], symbol: "051910.KS", exchange: "KSC" },
  { name: "LG전자", keywords: ["lg전자", "엘지전자"], symbol: "066570.KS", exchange: "KSC" },
  { name: "LG에너지솔루션", keywords: ["lg에너지", "엘지에너지솔루션", "lges"], symbol: "373220.KS", exchange: "KSC" },
  { name: "셀트리온", keywords: ["셀트리온"], symbol: "068270.KS", exchange: "KSC" },
  { name: "삼성바이오로직스", keywords: ["삼성바이오", "바이오로직스"], symbol: "207940.KS", exchange: "KSC" },
  { name: "삼성SDI", keywords: ["삼성sdi", "삼성에스디아이"], symbol: "006400.KS", exchange: "KSC" },
  { name: "삼성전기", keywords: ["삼성전기"], symbol: "009150.KS", exchange: "KSC" },
  { name: "현대모비스", keywords: ["현대모비스", "모비스"], symbol: "012330.KS", exchange: "KSC" },
  { name: "POSCO홀딩스", keywords: ["포스코", "posco"], symbol: "005490.KS", exchange: "KSC" },
  { name: "KB금융", keywords: ["kb금융", "kb국민은행"], symbol: "105560.KS", exchange: "KSC" },
  { name: "신한지주", keywords: ["신한지주", "신한"], symbol: "055550.KS", exchange: "KSC" },
  { name: "하나금융지주", keywords: ["하나금융", "하나은행"], symbol: "086790.KS", exchange: "KSC" },
  { name: "우리금융지주", keywords: ["우리금융", "우리은행"], symbol: "316140.KS", exchange: "KSC" },
  { name: "카카오뱅크", keywords: ["카카오뱅크"], symbol: "323410.KS", exchange: "KSC" },
  { name: "카카오페이", keywords: ["카카오페이"], symbol: "377300.KS", exchange: "KSC" },
  { name: "크래프톤", keywords: ["크래프톤", "배틀그라운드"], symbol: "259960.KS", exchange: "KSC" },
  { name: "하이브", keywords: ["하이브", "빅히트"], symbol: "352820.KS", exchange: "KSC" },
  { name: "SK텔레콤", keywords: ["sk텔레콤", "에스케이텔레콤"], symbol: "017670.KS", exchange: "KSC" },
  { name: "KT", keywords: ["kt", "케이티"], symbol: "030200.KS", exchange: "KSC" },
  { name: "SK이노베이션", keywords: ["sk이노베이션"], symbol: "096770.KS", exchange: "KSC" },
  { name: "한화에어로스페이스", keywords: ["한화에어로", "한화항공우주"], symbol: "012450.KS", exchange: "KSC" },
  { name: "두산에너빌리티", keywords: ["두산에너빌리티", "두산중공업"], symbol: "034020.KS", exchange: "KSC" },
  { name: "메디포스트", keywords: ["메디포스트"], symbol: "078160.KS", exchange: "KSC" },
  { name: "에코프로비엠", keywords: ["에코프로비엠", "에코프로"], symbol: "247540.KQ", exchange: "KOE" },
  { name: "포스코퓨처엠", keywords: ["포스코퓨처엠", "포스코케미칼"], symbol: "003670.KS", exchange: "KSC" },
  { name: "고려아연", keywords: ["고려아연"], symbol: "010130.KS", exchange: "KSC" },
  { name: "삼성물산", keywords: ["삼성물산"], symbol: "028260.KS", exchange: "KSC" },
  { name: "롯데케미칼", keywords: ["롯데케미칼", "롯데화학"], symbol: "011170.KS", exchange: "KSC" },
  { name: "한국전력", keywords: ["한국전력", "한전"], symbol: "015760.KS", exchange: "KSC" },
  { name: "기업은행", keywords: ["기업은행", "ibk"], symbol: "024110.KS", exchange: "KSC" },
  { name: "현대건설", keywords: ["현대건설"], symbol: "000720.KS", exchange: "KSC" },
  { name: "HD현대중공업", keywords: ["hd현대중공업", "현대중공업"], symbol: "329180.KS", exchange: "KSC" },
  { name: "한진칼", keywords: ["한진칼", "대한항공"], symbol: "180640.KS", exchange: "KSC" },
  { name: "엔씨소프트", keywords: ["엔씨소프트", "엔씨"], symbol: "036570.KS", exchange: "KSC" },
  { name: "넷마블", keywords: ["넷마블"], symbol: "251270.KS", exchange: "KSC" },
];

function searchKorean(query: string) {
  const q = query.toLowerCase().replace(/\s/g, "");
  return KOREAN_COMPANY_MAP.filter(c =>
    c.keywords.some(k => k.includes(q) || q.includes(k))
  ).map(c => ({ symbol: c.symbol, shortname: c.name, exchange: c.exchange, quoteType: "EQUITY" }));
}

router.get("/search/:query", async (req, res) => {
  const query = req.params.query;
  if (!query || query.trim().length < 1) {
    res.json([]);
    return;
  }

  const isKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(query);
  if (isKorean) {
    res.json(searchKorean(query));
    return;
  }

  try {
    const result = await yahooFinance.search(query, { newsCount: 0, quotesCount: 8 });
    const quotes = (result.quotes || [])
      .filter((q: any) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF"))
      .map((q: any) => ({
        symbol: q.symbol,
        shortname: q.shortname || q.longname || q.symbol,
        exchange: q.exchange || "",
        quoteType: q.quoteType || "",
      }));
    res.json(quotes);
  } catch {
    res.json([]);
  }
});

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

    const resolvedSymbol = koreanResolved?.symbol ?? ticker;

    let quoteInfo = null;
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

    // Fetch Naver real-time data for Korean stocks (NXT price + accurate close)
    let nxtInfo: { price: number; changePercent: number; compareToPrev: string; at: string; sessionType: string; status: string } | null = null;
    let naverKrxClose: number | null = null;
    const koreanCode = resolvedSymbol.match(/^(\d{6})\.(KS|KQ)$/)?.[1];
    if (koreanCode) {
      try {
        const naverBasicRes = await fetch(
          `https://m.stock.naver.com/api/stock/${koreanCode}/basic`,
          { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Referer": "https://m.stock.naver.com/" } }
        );
        if (naverBasicRes.ok) {
          const naverBasic: any = await naverBasicRes.json();
          const naverClose = naverBasic.closePrice ? Number(String(naverBasic.closePrice).replace(/,/g, "")) : null;
          if (naverClose && naverClose > 0) naverKrxClose = naverClose;
          const nxt = naverBasic.overMarketPriceInfo;
          if (nxt?.overPrice) {
            const nxtPriceNum = Number(String(nxt.overPrice).replace(/,/g, ""));
            if (nxtPriceNum > 0) {
              nxtInfo = {
                price: nxtPriceNum,
                changePercent: Number(nxt.fluctuationsRatio ?? 0),
                compareToPrev: nxt.compareToPreviousClosePrice ?? "0",
                at: nxt.localTradedAt ?? "",
                sessionType: nxt.tradingSessionType ?? "AFTER_MARKET",
                status: nxt.overMarketStatus ?? "CLOSE",
              };
            }
          }
        }
      } catch {
        // optional
      }
    }

    // Use Naver close price as authoritative for Korean stocks when available
    const effectiveCurrentPrice = naverKrxClose ?? currentPrice;

    res.json({
      ticker,
      quoteInfo,
      currentPrice: effectiveCurrentPrice,
      changePercent,
      yearHigh,
      yearLow,
      currentRsi,
      nxtInfo,
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

// GET /api/market-data/financials/:ticker — structured annual + quarterly income statement
router.get("/financials/:ticker", async (req, res) => {
  const ticker = (req.params.ticker as string).toUpperCase();
  const NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Referer": "https://m.stock.naver.com/",
  };

  const koreanCode = ticker.match(/^(\d{6})\.(KS|KQ)$/)?.[1]
    ?? ticker.match(/^(\d{6})$/)?.[1];

  if (koreanCode) {
    try {
      const summaryRes = await fetch(
        `https://m.stock.naver.com/api/stock/${koreanCode}/finance/summary`,
        { headers: NAVER_HEADERS }
      );
      if (!summaryRes.ok) { res.status(502).json({ error: "Naver API error" }); return; }
      const summary: any = await summaryRes.json();

      const parseStmt = (stmtObj: any) => {
        if (!stmtObj) return [];
        const cols: string[][] = stmtObj.columns ?? [];
        const titleList: any[] = stmtObj.trTitleList ?? [];
        const periods: string[] = cols[0]?.slice(1) ?? [];
        const revenues = cols.find((c: string[]) => c[0] === "매출액")?.slice(1) ?? [];
        const opIncomes = cols.find((c: string[]) => c[0] === "영업이익")?.slice(1) ?? [];
        const netIncomes = cols.find((c: string[]) => c[0] === "당기순이익")?.slice(1) ?? [];
        return periods.map((period: string, i: number) => ({
          period,
          isEstimate: titleList[i]?.isConsensus === "Y",
          revenue: revenues[i] ? Number(revenues[i]) * 1e8 : null,
          operatingIncome: opIncomes[i] ? Number(opIncomes[i]) * 1e8 : null,
          netIncome: netIncomes[i] ? Number(netIncomes[i]) * 1e8 : null,
          operatingMargin:
            revenues[i] && opIncomes[i] && Number(revenues[i]) > 0
              ? (Number(opIncomes[i]) / Number(revenues[i])) * 100
              : null,
        }));
      };

      res.json({
        ticker,
        currency: "KRW",
        annual: parseStmt(summary.chartIncomeStatement?.annual),
        quarterly: parseStmt(summary.chartIncomeStatement?.quarter),
      });
      return;
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to fetch Naver financials" });
      return;
    }
  }

  // US stocks — Yahoo Finance incomeStatementHistory
  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      modules: ["incomeStatementHistory", "incomeStatementHistoryQuarterly"],
    } as any);
    const toEntry = (s: any) => ({
      period: s.endDate ? new Date(s.endDate).toISOString().slice(0, 7) : "",
      isEstimate: false,
      revenue: s.totalRevenue ?? null,
      operatingIncome: s.operatingIncome ?? null,
      netIncome: s.netIncome ?? null,
      operatingMargin:
        s.totalRevenue && s.operatingIncome && s.totalRevenue > 0
          ? (s.operatingIncome / s.totalRevenue) * 100
          : null,
    });
    const annual = ((result as any).incomeStatementHistory?.incomeStatementHistory ?? []).map(toEntry);
    const quarterly = ((result as any).incomeStatementHistoryQuarterly?.incomeStatementHistory ?? []).map(toEntry);
    res.json({ ticker, currency: "USD", annual, quarterly });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to fetch Yahoo financials" });
  }
});

export default router;
