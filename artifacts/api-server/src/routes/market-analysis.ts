import { Router } from "express";
import { getStatus, runPipeline } from "../lib/lstm-predictor.js";

const router = Router();

router.get("/status", (req, res) => {
  res.json(getStatus());
});

router.post("/run", async (req, res) => {
  const force = req.query.force === "true";
  const status = getStatus();
  if (status.running) {
    res.json({ ok: true, message: "이미 학습 중입니다" });
    return;
  }
  runPipeline(force).catch(e => console.error("[market-analysis/run]", e));
  res.json({ ok: true, message: "파이프라인 시작" });
});

export default router;
