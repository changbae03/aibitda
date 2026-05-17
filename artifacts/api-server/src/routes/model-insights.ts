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

  const isBearish = verdict && /매도|Strong Sell|Sell/i.test(verdict) && !/Buy/i.test(verdict);

  if (isBearish) {
    // 매도 콜: 목표가는 진입가보다 낮아야 함
    // hit_target = 현재가가 목표가 이하로 하락
    if (targetPrice && targetPrice < entryPrice && currentPrice <= targetPrice * 1.03) return "hit_target";
    // hit_stoploss = 현재가가 손절가(매도 손절 = 진입가보다 높은 가격) 이상으로 상승
    if (stopLoss && stopLoss > entryPrice && currentPrice >= stopLoss * 0.97) return "hit_stoploss";
  } else {
    // 매수 콜: 목표가는 진입가보다 높아야 함
    // hit_target = 현재가가 목표가 이상으로 상승
    if (targetPrice && currentPrice >= targetPrice * 0.97) return "hit_target";
    // hit_stoploss = 현재가가 손절가 이하로 하락
    if (stopLoss && currentPrice <= stopLoss * 1.03) return "hit_stoploss";
  }

  return "ongoing";
}

/**
 * 예측 방향 일치 여부:
 * - 목표가 > 진입가 (상승 예측) → 현재가 > 진입가 이면 일치
 * - 목표가 < 진입가 (하락 예측) → 현재가 < 진입가 이면 일치
 */
function computeDirectionMatch(
  entryPrice: number | null,
  targetPrice: number | null,
  currentPrice: number | null
): boolean | null {
  if (!entryPrice || !targetPrice || !currentPrice) return null;
  if (targetPrice === entryPrice) return null;
  const predictedUp = targetPrice > entryPrice;
  const actuallyUp = currentPrice > entryPrice;
  return predictedUp === actuallyUp;
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
  daysElapsed: number,
  valuationMethod: string | null = null,
  targetAchievementPct: number | null = null
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
밸류에이션 방법론: ${valuationMethod ?? "미상"}
목표주가 달성도: ${targetAchievementPct !== null ? targetAchievementPct.toFixed(0) + "%" : "미상"} (100%=완전달성, 음수=역방향)

위 성과를 바탕으로 다음에 같은 유형의 종목을 분석할 때 개선해야 할 핵심 교훈 1가지를 2-3문장으로 도출하세요.
밸류에이션 방법론과 목표주가 달성도를 고려하여 방법론 적합성도 평가하세요.
마크다운 볼드(**) 사용 금지. 간결하고 실용적으로 작성.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 250 },
    });
    return response.text?.trim() ?? "";
  } catch {
    return `${companyName} 분석 ${daysElapsed}일 후 ${priceReturn.toFixed(1)}% ${direction}. 결과: ${successOrFail}.`;
  }
}

async function extractValuationMethod(analysisId: number | null): Promise<string | null> {
  if (!analysisId) return null;
  try {
    const rows = await rawQuery(
      `SELECT content FROM analysis_steps WHERE analysis_id = $1 AND step_key = 'intrinsic_valuation' LIMIT 1`,
      [analysisId]
    );
    if (!rows[0]?.content) return null;
    const c: string = rows[0].content;
    if (/rNPV|r-NPV/i.test(c)) return "rNPV";
    if (/DCF/i.test(c)) return "DCF";
    if (/DDM|배당할인모델/i.test(c)) return "DDM";
    if (/EV\/EBITDA/i.test(c)) return "EV/EBITDA";
    if (/EV\/Revenue|EV\/매출/i.test(c)) return "EV/Revenue";
    if (/PSR|주가매출비율/i.test(c)) return "PSR";
    if (/PBR|주가순자산/i.test(c)) return "PBR";
    if (/PER|주가수익비율/i.test(c)) return "PER";
    return null;
  } catch {
    return null;
  }
}

function computeTargetAchievementPct(
  verdict: string | null,
  entryPrice: number | null,
  targetPrice: number | null,
  currentPrice: number | null
): number | null {
  if (!entryPrice || !targetPrice || !currentPrice) return null;
  if (targetPrice === entryPrice) return null;
  const isBearish = verdict && /매도|Strong Sell|Sell/i.test(verdict) && !/Buy/i.test(verdict);
  if (isBearish) {
    const total = entryPrice - targetPrice;
    if (total === 0) return null;
    return Math.min(200, Math.max(-100, ((entryPrice - currentPrice) / total) * 100));
  } else {
    const total = targetPrice - entryPrice;
    if (total === 0) return null;
    return Math.min(200, Math.max(-100, ((currentPrice - entryPrice) / total) * 100));
  }
}

export async function triggerModelReview(): Promise<void> {
  try {
    const completedRows = await rawQuery(
      `SELECT * FROM analyses WHERE status = 'completed' AND investment_verdict IS NOT NULL`
    );
    const completed = completedRows.map((r: any) => ({
      id: r.id,
      ticker: r.ticker,
      companyName: r.company_name,
      industry: r.industry,
      investmentVerdict: r.investment_verdict ?? null,
      entryPrice: r.entry_price ?? null,
      startPrice: r.start_price ?? null,
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
          kq.value?.longName &&
          !kq.value.longName.includes(",")
        ) {
          resolvedTicker = `${ticker}.KQ`;
        } else if (ks.status === "fulfilled" && ks.value?.regularMarketPrice) {
          resolvedTicker = `${ticker}.KS`;
        } else {
          resolvedTicker = `${ticker}.KQ`; // 기본 fallback
        }
      }

      const currentPrice = await fetchCurrentPrice(resolvedTicker);
      if (!currentPrice) continue;

      // start_price = 분석 시점 실제 시장가. 방향 정확도·수익률의 기준점.
      // entry_price = AI가 설정한 진입 구간 (매도 콜은 재관심 기준가로 설정되어 기준으로 부적합)
      const basePrice = analysis.startPrice ?? analysis.entryPrice;
      const priceReturn = basePrice
        ? ((currentPrice - basePrice) / basePrice) * 100
        : 0;
      const daysElapsed = Math.floor(
        (Date.now() - new Date(analysis.createdAt).getTime()) / (1000 * 3600 * 24)
      );
      const outcome = resolveOutcome(
        analysis.investmentVerdict,
        analysis.startPrice ?? analysis.entryPrice,
        analysis.targetPrice,
        analysis.stopLoss,
        currentPrice
      );

      // 방향성 일치 여부: 분석 시점 주가(startPrice) 대비 현재가 방향과
      // 목표가 방향(targetPrice vs startPrice)이 일치하는지 판단
      const directionMatch = computeDirectionMatch(
        analysis.startPrice ?? analysis.entryPrice,
        analysis.targetPrice,
        currentPrice
      );

      const valuationMethod = await extractValuationMethod(analysis.id);
      const targetAchievementPct = computeTargetAchievementPct(
        analysis.investmentVerdict,
        analysis.startPrice ?? analysis.entryPrice,
        analysis.targetPrice,
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
          daysElapsed,
          valuationMethod,
          targetAchievementPct
        );
      }

      if (existing.length > 0) {
        await rawQuery(
          `UPDATE model_insights SET price_at_review=$1, price_return=$2, days_elapsed=$3, outcome=$4, lesson=$5, direction_match=$6, valuation_method=$7, target_achievement_pct=$8, reviewed_at=NOW() WHERE id=$9`,
          [currentPrice, priceReturn, daysElapsed, outcome, lesson, directionMatch, valuationMethod, targetAchievementPct, existing[0].id]
        );
      } else {
        await rawQuery(
          `INSERT INTO model_insights (analysis_id, ticker, company_name, industry, verdict, entry_price, target_price, stop_loss, price_at_review, price_return, days_elapsed, outcome, lesson, direction_match, valuation_method, target_achievement_pct, analysis_date, reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())`,
          [analysis.id, ticker, analysis.companyName, analysis.industry, analysis.investmentVerdict,
           analysis.entryPrice, analysis.targetPrice, analysis.stopLoss,
           currentPrice, priceReturn, daysElapsed, outcome, lesson, directionMatch,
           valuationMethod, targetAchievementPct, analysis.createdAt]
        );
      }

      // ── auto_learning 역주입: model_insights의 실제 수익률·방향을 auto_learning history에 반영 ──
      // auto_learning은 분석 시점에 "다음 분석 시점 주가"로 실제 수익률을 추정하는데,
      // 재분석을 안 하면 실제 수익률이 영원히 비어 있음.
      // triggerModelReview가 6시간마다 현재가를 조회하므로 이 정확한 값을 역주입.
      try {
        const noteRows = await rawQuery(
          `SELECT auto_learning FROM ticker_notes WHERE ticker = $1`,
          [analysis.ticker]
        );
        if (noteRows[0]?.auto_learning) {
          const learningData = noteRows[0].auto_learning as { history?: any[] };
          if (learningData?.history) {
            let changed = false;
            const updated = learningData.history.map((entry: any) => {
              if (entry.analysisId === analysis.id) {
                const newEntry = {
                  ...entry,
                  actualReturn: Math.round(priceReturn * 10) / 10,
                  directionMatch,
                  daysElapsed,
                };
                // 값이 실제로 달라졌을 때만 플래그
                if (
                  entry.actualReturn !== newEntry.actualReturn ||
                  entry.directionMatch !== newEntry.directionMatch
                ) changed = true;
                return newEntry;
              }
              return entry;
            });
            if (changed) {
              await rawQuery(
                `UPDATE ticker_notes SET auto_learning = $1, updated_at = NOW() WHERE ticker = $2`,
                [JSON.stringify({ history: updated }), analysis.ticker]
              );
            }
          }
        }
      } catch {
        // optional — auto_learning 백필 실패는 분석 흐름에 영향 없음
      }

      console.log(`[direction-check] ${analysis.companyName}(${ticker}) ${daysElapsed}일 경과 | 수익률 ${priceReturn.toFixed(1)}% | 방향 ${directionMatch === true ? "✓ 일치" : directionMatch === false ? "✗ 불일치" : "정보 없음"} | 방법론: ${valuationMethod ?? "미상"} | 달성도: ${targetAchievementPct !== null ? targetAchievementPct.toFixed(0) + "%" : "미상"}`);
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

  // 많이 분석된 종목 Top 10 (전체 분석 기준)
  const tickerCountMap: Record<string, { companyName: string; count: number; winRate: number | null }> = {};
  for (const item of all) {
    const key = item.ticker;
    if (!tickerCountMap[key]) tickerCountMap[key] = { companyName: item.company_name ?? key, count: 0, winRate: null };
    tickerCountMap[key].count++;
  }
  for (const ticker of Object.keys(tickerCountMap)) {
    const tickerReviewed = reviewed.filter((i) => i.ticker === ticker && i.outcome !== "ongoing");
    const tickerHit = tickerReviewed.filter((i) => i.outcome === "hit_target");
    tickerCountMap[ticker].winRate = tickerReviewed.length > 0 ? (tickerHit.length / tickerReviewed.length) * 100 : null;
  }
  const topTickers = Object.entries(tickerCountMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([ticker, data]) => ({ ticker, companyName: data.companyName, count: data.count, winRate: data.winRate }));

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
    topTickers,
    recentCases,
  });
});

router.post("/review", async (_req, res) => {
  res.json({ message: "Review started" });
  triggerModelReview().catch(console.error);
});

// 기존 model_insights 데이터 강제 재계산 (계산 로직 변경 후 사용)
router.post("/recalculate", async (_req, res) => {
  try {
    // reviewed_at을 오래된 날짜로 초기화 → 6시간 쿨다운 통과하도록
    await rawQuery(`UPDATE model_insights SET reviewed_at = '2000-01-01' WHERE 1=1`);
    res.json({ message: "Recalculation started", note: "All records reset, triggering fresh review" });
    triggerModelReview().catch(console.error);
  } catch (err) {
    console.error("[recalculate] error:", err);
    res.status(500).json({ error: "Recalculation failed" });
  }
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
