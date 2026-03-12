import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { analysesTable, analysisStepsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import OpenAI from "openai";
import YahooFinance from "yahoo-finance2";
import {
  AGENTS,
  STEP_ORDER,
  buildPrompt,
  type AgentKey,
} from "../lib/ai-agents.js";

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
      currentStep: "industry_structure",
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
  const { systemPrompt, userPrompt } = buildPrompt(
    stepKey,
    analysis.ticker,
    analysis.companyName,
    analysis.industry,
    analysis.additionalContext,
    existingSteps.map((s) => ({
      stepKey: s.stepKey,
      agentName: s.agentName,
      content: s.content,
    }))
  );

  let content = "";
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 3000,
    });
    content = completion.choices[0]?.message?.content ?? "분석 결과를 생성하지 못했습니다.";
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
  const isLast = stepKey === "lead_validation";

  if (isLast) {
    const verdictMatch = content.match(/투자 등급[:\s]+([^\n]+)/);
    const targetMatch = content.match(/목표 가격[:\s]+[\₩]?([\d,]+)/);
    const entryMatch = content.match(/진입 가격[:\s]+[\₩]?([\d,]+)/);
    const stopMatch = content.match(/손절 가격[:\s]+[\₩]?([\d,]+)/);

    const targetPrice = targetMatch ? parseFloat(targetMatch[1].replace(/,/g, "")) : null;
    const entryPrice = entryMatch ? parseFloat(entryMatch[1].replace(/,/g, "")) : null;
    const stopLoss = stopMatch ? parseFloat(stopMatch[1].replace(/,/g, "")) : null;
    const riskRewardRatio =
      targetPrice && entryPrice && stopLoss && entryPrice !== stopLoss
        ? Math.abs((targetPrice - entryPrice) / (entryPrice - stopLoss))
        : null;

    await db
      .update(analysesTable)
      .set({
        status: "completed",
        currentStep: null,
        investmentVerdict: verdictMatch ? verdictMatch[1].trim() : null,
        targetPrice,
        entryPrice,
        stopLoss,
        riskRewardRatio,
        updatedAt: new Date(),
      })
      .where(eq(analysesTable.id, id));
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
