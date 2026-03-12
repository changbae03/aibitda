import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import analysisRouter from "./analysis.js";
import marketDataRouter from "./market-data.js";
import modelInsightsRouter from "./model-insights.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/analysis", analysisRouter);
router.use("/market-data", marketDataRouter);
router.use("/model-insights", modelInsightsRouter);

export default router;
