import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

let ready = false;

export function setReady(value: boolean) {
  ready = value;
}

router.get("/healthz", (_req, res) => {
  if (!ready) {
    res.status(503).json({ status: "initializing" });
    return;
  }
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
