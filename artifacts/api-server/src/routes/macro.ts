import { Router } from "express";
import { fetchECOSMacro } from "../lib/ecos-client.js";
import { fetchFREDMacro } from "../lib/fred-client.js";

const router = Router();

router.get("/macro", async (_req, res) => {
  try {
    const [ecos, fred] = await Promise.all([fetchECOSMacro(), fetchFREDMacro()]);
    res.json({ ecos, fred, fetchedAt: Date.now() });
  } catch {
    res.status(500).json({ error: "거시지표 조회 실패" });
  }
});

export default router;
