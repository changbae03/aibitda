import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import YahooFinance from "yahoo-finance2";
import { GoogleGenAI } from "@google/genai";

async function rawQuery(sql: string, params: any[] = []): Promise<any[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

const router: IRouter = Router();
const yahooFinance = new YahooFinance();

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

async function fetchCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const quote = await yahooFinance.quote(ticker);
    return quote.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

function resolveOutcome(
  verdict: string | null,
  entryPrice: number | null,
  targetPrice: number | null,
  stopLoss: number | null,
  currentPrice: number | null
): string {
  if (!currentPrice || !entryPrice) return "pending";
  if (targetPrice && currentPrice >= targetPrice * 0.97) return "hit_target";
  if (stopLoss && currentPrice <= stopLoss * 1.03) return "hit_stoploss";
  return "ongoing";
}

async function generateLesson(
  ticker: string,
  companyName: string,
  verdict: string | null,
  entryPrice: number | null,
  targetPrice: number | null,
  stopLoss: number | null,
  currentPrice: number,
  priceReturn: number,
  outcome: string,
  daysElapsed: number
): Promise<string> {
  const direction = priceReturn >= 0 ? "상승" : "하락";
  const successOrFail =
    outcome === "hit_target" ? "방향 일치" : outcome === "hit_stoploss" ? "손절 발생" : "진행중";

  const prompt = `당신은 AI 헤지펀드 리서치팀 팀장입니다. 과거 분석 성과를 검토하고 모델 고도화를 위한 핵심 교훈을 도출하세요.

분석 대상: ${companyName} (${ticker})
원래 투자 의견: ${verdict ?? "미정"}
진입가: ${entryPrice ?? "미정"}
목표가: ${targetPrice ?? "미정"}  
손절가: ${stopLoss ?? "미정"}
현재가: ${currentPrice}
수익률: ${priceReturn.toFixed(1)}% (${daysElapsed}일 경과, ${direction})
결과: ${successOrFail}

위 성과를 바탕으로 다음에 같은 유형의 종목을 분석할 때 개선해야 할 핵심 교훈 1가지를 2-3문장으로 도출하세요.
마크다운 볼드(**) 사용 금지. 간결하고 실용적으로 작성.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 200 },
    });
    return response.text?.trim() ?? "";
  } catch {
    return `${companyName} 분석 ${daysElapsed}일 후 ${priceReturn.toFixed(1)}% ${direction}. 결과: ${successOrFail}.`;
  }
}

export async function triggerModelReview(): Promise<void> {
  try {
    const completedRows = await rawQuery(
      `SELECT * FROM analyses WHERE status = 'completed' AND entry_price IS NOT NULL`
    );
    const completed = completedRows.map((r: any) => ({
      id: r.id,
      ticker: r.ticker,
      companyName: r.company_name,
      industry: r.industry,
      investmentVerdict: r.investment_verdict ?? null,
      entryPrice: r.entry_price ?? null,
      targetPrice: r.target_price ?? null,
      stopLoss: r.stop_loss ?? null,
      createdAt: r.created_at,
    }));

    for (const analysis of completed) {
      const existing = await rawQuery(
        `SELECT * FROM model_insights WHERE analysis_id = $1 LIMIT 1`,
        [analysis.id]
      );

      if (existing.length > 0) {
        const last = existing[0];
        const hoursSinceReview = last.reviewed_at
          ? (Date.now() - new Date(last.reviewed_at).getTime()) / (1000 * 3600)
          : Infinity;
        if (hoursSinceReview < 6) continue;
      }

      const ticker = analysis.ticker;
      let resolvedTicker = ticker;

      if (/^\d{6}$/.test(ticker)) {
        const [ks, kq] = await Promise.allSettled([
          yahooFinance.quote(`${ticker}.KS`),
          yahooFinance.quote(`${ticker}.KQ`),
        ]);
        if (
          kq.status === "fulfilled" &&
          kq.value.longName &&
          !kq.value.longName.includes(",")
        ) {
          resolvedTicker = `${ticker}.KQ`;
        } else if (ks.status === "fulfilled") {
          resolvedTicker = `${ticker}.KS`;
        }
      }

      const currentPrice = await fetchCurrentPrice(resolvedTicker);
      if (!currentPrice) continue;

      const entryPrice = analysis.entryPrice;
      const priceReturn = entryPrice
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : 0;
      const daysElapsed = Math.floor(
        (Date.now() - new Date(analysis.createdAt).getTime()) / (1000 * 3600 * 24)
      );
      const outcome = resolveOutcome(
        analysis.investmentVerdict,
        analysis.entryPrice,
        analysis.targetPrice,
        analysis.stopLoss,
        currentPrice
      );

      let lesson: string | null = null;
      if (daysElapsed >= 1) {
        lesson = await generateLesson(
          ticker,
          analysis.companyName,
          analysis.investmentVerdict,
          analysis.entryPrice,
          analysis.targetPrice,
          analysis.stopLoss,
          currentPrice,
          priceReturn,
          outcome,
          daysElapsed
        );
      }

      if (existing.length > 0) {
        await rawQuery(
          `UPDATE model_insights SET price_at_review=$1, price_return=$2, days_elapsed=$3, outcome=$4, lesson=$5, reviewed_at=NOW() WHERE id=$6`,
          [currentPrice, priceReturn, daysElapsed, outcome, lesson, existing[0].id]
        );
      } else {
        await rawQuery(
          `INSERT INTO model_insights (analysis_id, ticker, company_name, industry, verdict, entry_price, target_price, stop_loss, price_at_review, price_return, days_elapsed, outcome, lesson, analysis_date, reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
          [analysis.id, ticker, analysis.companyName, analysis.industry, analysis.investmentVerdict,
           analysis.entryPrice, analysis.targetPrice, analysis.stopLoss,
           currentPrice, priceReturn, daysElapsed, outcome, lesson, analysis.createdAt]
        );
      }
    }
  } catch (err) {
    console.error("[model-review] error:", err);
  }
}

router.get("/", async (_req, res) => {
  const rows = await rawQuery(`SELECT * FROM model_insights ORDER BY reviewed_at DESC`);
  res.json(rows.map(formatInsight));
});

// 퍼블릭 집계 통계 (로그인 불필요)
router.get("/public-stats", async (_req, res) => {
  const all = await rawQuery(`SELECT * FROM model_insights`);
  const reviewed = all.filter((i) => i.outcome !== "pending");
  const hitTarget = reviewed.filter((i) => i.outcome === "hit_target");
  const hitStop = reviewed.filter((i) => i.outcome === "hit_stoploss");
  const ongoing = reviewed.filter((i) => i.outcome === "ongoing");
  const withReturn = reviewed.filter((i) => i.price_return != null);

  const avgReturn = withReturn.length
    ? withReturn.reduce((s, i) => s + (i.price_return ?? 0), 0) / withReturn.length
    : null;

  // 업종별 집계
  const byIndustry: Record<string, { total: number; hitTarget: number; avgReturn: number | null }> = {};
  for (const item of reviewed) {
    const ind = item.industry ?? "기타";
    if (!byIndustry[ind]) byIndustry[ind] = { total: 0, hitTarget: 0, avgReturn: null };
    byIndustry[ind].total++;
    if (item.outcome === "hit_target") byIndustry[ind].hitTarget++;
  }
  for (const ind of Object.keys(byIndustry)) {
    const items = reviewed.filter((i) => (i.industry ?? "기타") === ind && i.price_return != null);
    byIndustry[ind].avgReturn = items.length
      ? items.reduce((s, i) => s + (i.price_return ?? 0), 0) / items.length
      : null;
  }

  // 최근 방향 일치/손절 사례 (10건)
  const recentCases = reviewed
    .filter((i) => i.outcome !== "ongoing")
    .sort((a, b) => new Date(b.reviewed_at ?? 0).getTime() - new Date(a.reviewed_at ?? 0).getTime())
    .slice(0, 10)
    .map((i) => ({
      ticker: i.ticker,
      companyName: i.company_name,
      verdict: i.verdict,
      priceReturn: i.price_return,
      daysElapsed: i.days_elapsed,
      outcome: i.outcome,
      analysisId: i.analysis_id,
    }));

  res.json({
    totalAnalyses: all.length,
    reviewedCount: reviewed.length,
    hitTargetCount: hitTarget.length,
    hitStopCount: hitStop.length,
    ongoingCount: ongoing.length,
    winRate: reviewed.length ? (hitTarget.length / reviewed.length) * 100 : null,
    avgReturn,
    byIndustry,
    recentCases,
  });
});

router.post("/review", async (_req, res) => {
  res.json({ message: "Review started" });
  triggerModelReview().catch(console.error);
});

function formatInsight(i: any) {
  return {
    id: i.id,
    analysisId: i.analysis_id ?? i.analysisId,
    ticker: i.ticker,
    companyName: i.company_name ?? i.companyName,
    industry: i.industry,
    verdict: i.verdict,
    entryPrice: i.entry_price ?? i.entryPrice,
    targetPrice: i.target_price ?? i.targetPrice,
    stopLoss: i.stop_loss ?? i.stopLoss,
    priceAtReview: i.price_at_review ?? i.priceAtReview,
    priceReturn: i.price_return ?? i.priceReturn,
    daysElapsed: i.days_elapsed ?? i.daysElapsed,
    outcome: i.outcome,
    lesson: i.lesson,
    analysisDate: (i.analysis_date ?? i.analysisDate)?.toISOString?.() ?? (i.analysis_date ?? i.analysisDate),
    reviewedAt: (i.reviewed_at ?? i.reviewedAt)?.toISOString?.() ?? (i.reviewed_at ?? i.reviewedAt),
    createdAt: (i.created_at ?? i.createdAt)?.toISOString?.() ?? (i.created_at ?? i.createdAt),
  };
}

export default router;
