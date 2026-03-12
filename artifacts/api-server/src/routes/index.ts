import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import analysisRouter from "./analysis.js";
import hypothesesRouter from "./hypotheses.js";
import marketDataRouter from "./market-data.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/analysis", analysisRouter);
router.use("/hypotheses", hypothesesRouter);
router.use("/market-data", marketDataRouter);

export default router;
