import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { analysesTable, analysisStepsTable, modelInsightsTable } from "@workspace/db";
import { eq, desc, and, not } from "drizzle-orm";
import OpenAI from "openai";
import YahooFinance from "yahoo-finance2";
import {
  AGENTS,
  STEP_ORDER,
  buildPrompt,
  type AgentKey,
} from "../lib/ai-agents.js";
import { triggerModelReview } from "./model-insights.js";

const router: IRouter = Router();
const yahooFinance = new YahooFinance();

const client = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? undefined,
});

async function tryQuoteSummary(symbol: string) {
  try {
    const result = await yahooFinance.quoteSummary(symbol, {
      modules: ["quoteType", "summaryProfile"],
    });
    const companyName =
      (result.quoteType as any)?.longName ||
      (result.quoteType as any)?.shortName ||
      null;
    if (!companyName || /^\d{6}/.test(companyName)) return null;
    const industry =
      (result.summaryProfile as any)?.industry ||
      (result.summaryProfile as any)?.sector ||
      "일반";
    return { companyName, industry };
  } catch {
    return null;
  }
}

async function fetchTickerInfo(ticker: string): Promise<{ companyName: string; industry: string }> {
  if (/^\d{6}$/.test(ticker)) {
    const [ksResult, kqResult] = await Promise.all([
      tryQuoteSummary(`${ticker}.KS`),
      tryQuoteSummary(`${ticker}.KQ`),
    ]);
    const found = ksResult || kqResult;
    if (found) return found;
  } else {
    const result = await tryQuoteSummary(ticker);
    if (result) return result;
  }
  return { companyName: ticker, industry: "일반" };
}

router.post("/", async (req, res) => {
  const { ticker, companyName: rawCompanyName, industry: rawIndustry, additionalContext } = req.body as {
    ticker: string;
    companyName?: string;
    industry?: string;
    additionalContext?: string;
  };

  if (!ticker) {
    res.status(400).json({ error: "ticker는 필수입니다" });
    return;
  }

  let companyName = rawCompanyName?.trim();
  let industry = rawIndustry?.trim();

  if (!companyName || !industry) {
    const info = await fetchTickerInfo(ticker.toUpperCase());
    companyName = companyName || info.companyName;
    industry = industry || info.industry;
  }

  const [analysis] = await db
    .insert(analysesTable)
    .values({
      ticker: ticker.toUpperCase(),
      companyName,
      industry,
      additionalContext: additionalContext ?? null,
      status: "in_progress",
      currentStep: "company_intro",
    })
    .returning();

  res.json(formatAnalysis(analysis, []));
});

router.get("/", async (_req, res) => {
  const analyses = await db
    .select()
    .from(analysesTable)
    .orderBy(desc(analysesTable.createdAt));

  const results = await Promise.all(
    analyses.map(async (a) => {
      const steps = await db
        .select()
        .from(analysisStepsTable)
        .where(eq(analysisStepsTable.analysisId, a.id));
      return formatAnalysis(a, steps);
    })
  );

  res.json(results);
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const analysis = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.id, id))
    .limit(1);

  if (!analysis[0]) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const steps = await db
    .select()
    .from(analysisStepsTable)
    .where(eq(analysisStepsTable.analysisId, id));

  res.json(formatAnalysis(analysis[0], steps));
});

router.post("/:id/step", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { stepKey } = req.body as { stepKey: AgentKey };
  if (!stepKey || !AGENTS[stepKey]) {
    res.status(400).json({ error: "Invalid stepKey" });
    return;
  }

  const [analysis] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.id, id))
    .limit(1);

  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  const existingSteps = await db
    .select()
    .from(analysisStepsTable)
    .where(eq(analysisStepsTable.analysisId, id));

  const agent = AGENTS[stepKey];

  let enrichedContext = analysis.additionalContext ?? null;
  if (stepKey === "company_intro" || stepKey === "investment_strategy") {
    try {
      const insights = await db
        .select()
        .from(modelInsightsTable)
        .where(not(eq(modelInsightsTable.outcome, "pending")));

      const relevantLessons = insights
        .filter((i) => i.lesson && i.lesson.trim())
        .slice(-5)
        .map((i) => `[${i.companyName}(${i.ticker}) ${i.daysElapsed}일, ${i.priceReturn?.toFixed(1)}%] ${i.lesson}`)
        .join("\n");

      if (relevantLessons) {
        const lessonBlock = `\n\n[AI 모델 과거 교훈]\n${relevantLessons}`;
        enrichedContext = enrichedContext ? enrichedContext + lessonBlock : lessonBlock;
      }
    } catch {
      // insights injection optional
    }
  }

  const { systemPrompt, userPrompt } = buildPrompt(
    stepKey,
    analysis.ticker,
    analysis.companyName,
    analysis.industry,
    enrichedContext,
    existingSteps.map((s) => ({
      stepKey: s.stepKey,
      agentName: s.agentName,
      content: s.content,
    }))
  );

  let content = "";
  try {
    const stream = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 8192,
      stream: true,
    });
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content ?? "";
    }
    console.log(`[${stepKey}] streamed content length:`, content.length);
    if (!content) content = "분석 결과를 생성하지 못했습니다.";
  } catch (err) {
    console.error("OpenAI error:", err);
    content = `분석 오류: AI 서비스에 연결하지 못했습니다. (${stepKey})`;
  }

  const informationType = detectInformationType(content);

  const [step] = await db
    .insert(analysisStepsTable)
    .values({
      analysisId: id,
      stepKey,
      agentName: agent.name,
      agentRole: agent.role,
      content,
      validationNotes: null,
      informationType,
    })
    .returning();

  const nextStepIndex = STEP_ORDER.indexOf(stepKey) + 1;
  const nextStep = nextStepIndex < STEP_ORDER.length ? STEP_ORDER[nextStepIndex] : null;
  const isLast = stepKey === "investment_strategy";

  if (isLast) {
    let investmentVerdict: string | null = null;
    let targetPrice: number | null = null;
    let entryPrice: number | null = null;
    let stopLoss: number | null = null;
    let riskRewardRatio: number | null = null;

    try {
      const json = JSON.parse(content);
      investmentVerdict = json.verdict ?? null;

      const parsePrice = (val: string | undefined) => {
        if (!val) return null;
        const num = parseFloat(String(val).replace(/[^0-9.]/g, ""));
        return isNaN(num) ? null : num;
      };

      targetPrice = parsePrice(json.target_price);
      entryPrice = parsePrice(json.entry_price);
      stopLoss = parsePrice(json.stop_loss);

      if (targetPrice && entryPrice && stopLoss && entryPrice !== stopLoss) {
        riskRewardRatio = Math.abs((targetPrice - entryPrice) / (entryPrice - stopLoss));
      }

      const rr = json.risk_reward;
      if (!riskRewardRatio && rr) {
        const m = String(rr).match(/[\d.]+/g);
        if (m && m.length >= 2) riskRewardRatio = parseFloat(m[1]) / parseFloat(m[0]);
      }
    } catch {
      // JSON parse failed — fall back to null values
    }

    await db
      .update(analysesTable)
      .set({
        status: "completed",
        currentStep: null,
        investmentVerdict,
        targetPrice,
        entryPrice,
        stopLoss,
        riskRewardRatio,
        updatedAt: new Date(),
      })
      .where(eq(analysesTable.id, id));

    triggerModelReview().catch(console.error);
  } else if (nextStep) {
    await db
      .update(analysesTable)
      .set({ currentStep: nextStep, updatedAt: new Date() })
      .where(eq(analysesTable.id, id));
  }

  res.json(formatStep(step));
});

function detectInformationType(content: string): string {
  if (content.includes("[확인된 사실]")) return "confirmed_fact";
  if (content.includes("[가설]")) return "hypothesis";
  return "data_based_estimate";
}

function formatStep(step: any) {
  return {
    id: step.id,
    analysisId: step.analysisId,
    stepKey: step.stepKey,
    agentName: step.agentName,
    agentRole: step.agentRole,
    content: step.content,
    validationNotes: step.validationNotes,
    informationType: step.informationType,
    createdAt: step.createdAt?.toISOString?.() ?? step.createdAt,
  };
}

function formatAnalysis(analysis: any, steps: any[]) {
  return {
    id: analysis.id,
    ticker: analysis.ticker,
    companyName: analysis.companyName,
    industry: analysis.industry,
    additionalContext: analysis.additionalContext,
    status: analysis.status,
    currentStep: analysis.currentStep,
    investmentVerdict: analysis.investmentVerdict,
    targetPrice: analysis.targetPrice,
    entryPrice: analysis.entryPrice,
    stopLoss: analysis.stopLoss,
    riskRewardRatio: analysis.riskRewardRatio,
    steps: steps.map(formatStep),
    createdAt: analysis.createdAt?.toISOString?.() ?? analysis.createdAt,
    updatedAt: analysis.updatedAt?.toISOString?.() ?? analysis.updatedAt,
  };
}

export default router;
