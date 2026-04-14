import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import analysisRouter from "./analysis.js";
import marketDataRouter from "./market-data.js";
import modelInsightsRouter from "./model-insights.js";
import newsRouter from "./news.js";
import authRouter from "./auth.js";
import feedRouter from "./feed.js";
import stockInsightsRouter from "./stock-insights.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use("/analysis", analysisRouter);
router.use("/market-data", marketDataRouter);
router.use("/market-data", stockInsightsRouter);
router.use("/model-insights", modelInsightsRouter);
router.use("/feed", feedRouter);
router.use(newsRouter);

export default router;
