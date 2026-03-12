import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { hypothesesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const hypotheses = await db
    .select()
    .from(hypothesesTable)
    .orderBy(desc(hypothesesTable.createdAt));

  res.json(hypotheses.map(formatHypothesis));
});

router.post("/", async (req, res) => {
  const {
    analysisId,
    ticker,
    companyName,
    hypothesisText,
    targetPrice,
    entryPrice,
    timeHorizon,
    catalysts,
    risks,
  } = req.body as {
    analysisId?: number;
    ticker: string;
    companyName: string;
    hypothesisText: string;
    targetPrice: number;
    entryPrice: number;
    timeHorizon?: string;
    catalysts?: string;
    risks?: string;
  };

  if (!ticker || !companyName || !hypothesisText || !targetPrice || !entryPrice) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }

  const [hypothesis] = await db
    .insert(hypothesesTable)
    .values({
      analysisId: analysisId ?? null,
      ticker,
      companyName,
      hypothesisText,
      targetPrice,
      entryPrice,
      timeHorizon: timeHorizon ?? null,
      catalysts: catalysts ?? null,
      risks: risks ?? null,
      outcome: "pending",
    })
    .returning();

  res.json(formatHypothesis(hypothesis));
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { actualPrice, outcome, notes } = req.body as {
    actualPrice?: number;
    outcome?: string;
    notes?: string;
  };

  const [existing] = await db
    .select()
    .from(hypothesesTable)
    .where(eq(hypothesesTable.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Hypothesis not found" });
    return;
  }

  let accuracyScore: number | null = null;
  if (actualPrice && outcome && outcome !== "pending") {
    const upside = existing.targetPrice - existing.entryPrice;
    const actual = actualPrice - existing.entryPrice;
    if (upside !== 0) {
      accuracyScore = Math.min(100, Math.max(0, (actual / upside) * 100));
    }
  }

  const [updated] = await db
    .update(hypothesesTable)
    .set({
      actualPrice: actualPrice ?? existing.actualPrice,
      outcome: outcome ?? existing.outcome,
      notes: notes ?? existing.notes,
      accuracyScore,
      updatedAt: new Date(),
    })
    .where(eq(hypothesesTable.id, id))
    .returning();

  res.json(formatHypothesis(updated));
});

function formatHypothesis(h: any) {
  return {
    id: h.id,
    analysisId: h.analysisId,
    ticker: h.ticker,
    companyName: h.companyName,
    hypothesisText: h.hypothesisText,
    targetPrice: h.targetPrice,
    entryPrice: h.entryPrice,
    actualPrice: h.actualPrice,
    timeHorizon: h.timeHorizon,
    catalysts: h.catalysts,
    risks: h.risks,
    outcome: h.outcome,
    accuracyScore: h.accuracyScore,
    notes: h.notes,
    createdAt: h.createdAt?.toISOString?.() ?? h.createdAt,
    updatedAt: h.updatedAt?.toISOString?.() ?? h.updatedAt,
  };
}

export default router;
