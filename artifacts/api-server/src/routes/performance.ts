import { Router } from "express";
import { pool } from "@workspace/db";
import YahooFinance from "yahoo-finance2";

const router = Router();
const yahooFinance = new YahooFinance();

async function fetchCurrentPrice(ticker: string): Promise<number | null> {
  const isKorean = /^\d{6}$/.test(ticker);
  if (isKorean) {
    const [ks, kq] = await Promise.allSettled([
      yahooFinance.quote(`${ticker}.KS`, { fields: ["regularMarketPrice"] }),
      yahooFinance.quote(`${ticker}.KQ`, { fields: ["regularMarketPrice"] }),
    ]);
    const ksPrice = ks.status === "fulfilled" ? (ks.value?.regularMarketPrice ?? null) : null;
    const kqPrice = kq.status === "fulfilled" ? (kq.value?.regularMarketPrice ?? null) : null;
    return ksPrice ?? kqPrice;
  } else {
    try {
      const q = await yahooFinance.quote(ticker, { fields: ["regularMarketPrice"] });
      return q?.regularMarketPrice ?? null;
    } catch {
      return null;
    }
  }
}

export function classifySector(industry: string, market: "KR" | "US"): string {
  const ind = (industry ?? "").toLowerCase();
  if (market === "KR") {
    if (ind.includes("bio") || ind.includes("pharma") || ind.includes("바이오") || ind.includes("제약")) return "KR_BIOTECH";
    if (ind.includes("반도체") || ind.includes("semiconductor")) return "KR_SEMICONDUCTOR";
    if (ind.includes("금융") || ind.includes("은행") || ind.includes("보험") || ind.includes("financial") || ind.includes("banking")) return "KR_FINANCIAL";
    if (ind.includes("건설") || ind.includes("construc")) return "KR_CONSTRUCTION";
    if (ind.includes("통신") || ind.includes("telecom")) return "KR_TELECOM";
    if (ind.includes("리츠") || ind.includes("reit")) return "KR_REIT";
    if (ind.includes("자동차") || ind.includes("automotive")) return "KR_AUTO";
    return "KR_OTHER";
  } else {
    if (ind.includes("biotechnology") || ind.includes("pharmaceutical") || ind.includes("drug")) return "US_BIOTECH";
    if (ind.includes("semiconductor") || ind.includes("technology") || ind.includes("software")) return "US_TECH";
    if (ind.includes("bank") || ind.includes("financial") || ind.includes("insurance")) return "US_FINANCIAL";
    if (ind.includes("reit") || ind.includes("real estate")) return "US_REIT";
    if (ind.includes("energy") || ind.includes("oil") || ind.includes("mining")) return "US_ENERGY";
    if (ind.includes("defense") || ind.includes("aerospace")) return "US_DEFENSE";
    if (ind.includes("telecom") || ind.includes("communication")) return "US_TELECOM";
    if (ind.includes("utilities")) return "US_UTILITIES";
    return "US_OTHER";
  }
}

function isBullishVerdict(verdict: string): boolean | null {
  const v = verdict.trim();
  if (v.includes("강력매수") || v.includes("적극매수") || v.includes("Strong Buy") || v.includes("매수") || v.includes("Buy")) return true;
  if (v.includes("매도") || v.includes("적극매도") || v.includes("Sell") || v.includes("Strong Sell")) return false;
  return null;
}

router.post("/performance/recalculate", async (req, res) => {
  try {
    const adminCheck = await pool.query(
      `SELECT 1 FROM admins WHERE user_id = $1`,
      [(req as any).session?.userId]
    );
    if (adminCheck.rowCount === 0) {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { rows: analyses } = await pool.query(
      `SELECT id, ticker, industry, investment_verdict, start_price, target_price, created_at
       FROM analyses
       WHERE status = 'completed'
         AND start_price IS NOT NULL
         AND target_price IS NOT NULL
         AND investment_verdict IS NOT NULL
         AND created_at < $1
       ORDER BY created_at DESC`,
      [cutoff]
    );

    if (analyses.length === 0) {
      return res.json({ message: "보정 가능한 데이터가 없습니다. 30일 이상 된 분석이 필요합니다.", count: 0 });
    }

    const uniqueTickers = [...new Set(analyses.map((r: any) => r.ticker as string))];
    const priceMap = new Map<string, number | null>();
    await Promise.all(
      uniqueTickers.map(async (ticker) => {
        const price = await fetchCurrentPrice(ticker);
        priceMap.set(ticker, price);
      })
    );

    const sectorStats = new Map<string, {
      market: "KR" | "US";
      directionCorrect: number;
      directionTotal: number;
      deviationSum: number;
      deviationCount: number;
    }>();

    for (const row of analyses) {
      const ticker = row.ticker as string;
      const industry = row.industry as string;
      const verdict = row.investment_verdict as string;
      const startPrice = parseFloat(row.start_price);
      const targetPrice = parseFloat(row.target_price);
      const currentPrice = priceMap.get(ticker);

      if (!currentPrice || isNaN(startPrice) || isNaN(targetPrice) || startPrice === 0) continue;

      const market: "KR" | "US" = /^\d{6}$/.test(ticker) ? "KR" : "US";
      const sector = classifySector(industry, market);

      if (!sectorStats.has(sector)) {
        sectorStats.set(sector, { market, directionCorrect: 0, directionTotal: 0, deviationSum: 0, deviationCount: 0 });
      }
      const stats = sectorStats.get(sector)!;

      const bullish = isBullishVerdict(verdict);
      if (bullish !== null) {
        const actualUp = currentPrice > startPrice;
        if ((bullish && actualUp) || (!bullish && !actualUp)) {
          stats.directionCorrect++;
        }
        stats.directionTotal++;
      }

      const deviationPct = ((targetPrice - currentPrice) / startPrice) * 100;
      stats.deviationSum += deviationPct;
      stats.deviationCount++;
    }

    let updatedSectors = 0;
    for (const [sector, stats] of sectorStats.entries()) {
      const directionAccuracy = stats.directionTotal > 0
        ? (stats.directionCorrect / stats.directionTotal) * 100
        : null;
      const avgPriceDeviation = stats.deviationCount > 0
        ? stats.deviationSum / stats.deviationCount
        : null;
      const sampleCount = stats.deviationCount;

      await pool.query(
        `INSERT INTO model_calibration (sector, market, direction_accuracy, avg_price_deviation, sample_count, last_recalc_at, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (sector) DO UPDATE SET
           market = EXCLUDED.market,
           direction_accuracy = EXCLUDED.direction_accuracy,
           avg_price_deviation = EXCLUDED.avg_price_deviation,
           sample_count = EXCLUDED.sample_count,
           last_recalc_at = NOW()`,
        [sector, stats.market, directionAccuracy, avgPriceDeviation, sampleCount]
      );
      updatedSectors++;
    }

    return res.json({
      message: "모델 보정 완료",
      analysesProcessed: analyses.length,
      sectorsUpdated: updatedSectors,
      sectors: Object.fromEntries(
        Array.from(sectorStats.entries()).map(([k, v]) => [
          k,
          {
            directionAccuracy: v.directionTotal > 0 ? Math.round((v.directionCorrect / v.directionTotal) * 100) : null,
            avgPriceDeviation: v.deviationCount > 0 ? Math.round((v.deviationSum / v.deviationCount) * 10) / 10 : null,
            sampleCount: v.deviationCount,
          }
        ])
      ),
    });
  } catch (err) {
    console.error("[performance/recalculate] error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/performance/calibration", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sector, market, direction_accuracy, avg_price_deviation, sample_count, last_recalc_at
       FROM model_calibration
       ORDER BY sector`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

export async function getCalibrationContext(sector: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT direction_accuracy, avg_price_deviation, sample_count
       FROM model_calibration
       WHERE sector = $1`,
      [sector]
    );
    if (rows.length === 0) return null;

    const cal = rows[0];
    const n = cal.sample_count as number;
    if (n < 3) return null;

    const dirAcc = cal.direction_accuracy as number | null;
    const dev = cal.avg_price_deviation as number | null;

    const lines: string[] = [`[📊 섹터 성과 보정 데이터 — 과거 ${n}건 분석 학습 결과]`];
    lines.push(`이 섹터(${sector})의 과거 분석 성과를 기반으로 다음 보정을 반드시 적용하세요:`);

    if (dirAcc !== null) {
      const accStr = Math.round(dirAcc) + "%";
      lines.push(`- 방향 예측 정확도: ${accStr}${dirAcc < 50 ? " ⚠️ (무작위 수준 — 투자의견을 더 보수적으로 설정하세요)" : dirAcc < 60 ? " (보통)" : " (양호)"}`);
    }

    if (dev !== null) {
      const devRounded = Math.round(dev * 10) / 10;
      const bias = devRounded > 0 ? `+${devRounded}%p 과대평가 경향` : `${devRounded}%p 과소평가 경향`;
      lines.push(`- 목표주가 편향: ${bias}`);

      if (Math.abs(devRounded) >= 10) {
        const adj = devRounded > 0
          ? `목표주가를 현재 산출값보다 ${Math.min(15, Math.round(Math.abs(devRounded) * 0.6))}% 낮게 조정하세요.`
          : `목표주가를 현재 산출값보다 ${Math.min(15, Math.round(Math.abs(devRounded) * 0.6))}% 높게 조정하세요.`;
        lines.push(`→ 보정 지침: ${adj}`);
      } else if (Math.abs(devRounded) >= 5) {
        lines.push(`→ 보정 지침: 소폭 편향이 감지되었습니다. 목표주가 산출 시 하단 시나리오 가중치를 높이세요.`);
      }
    }

    if (dirAcc !== null && dirAcc < 50) {
      lines.push(`→ 투자의견 보정: 이 섹터는 방향 예측이 불확실합니다. 매수/매도 판정 대신 중립적 의견과 함께 명확한 조건부 논리를 제시하세요.`);
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}

export { router as performanceRouter };
export default router;
