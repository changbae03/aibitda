import { Router } from "express";
import {
  getUserId,
  getCreditStatus,
  getOrCreateReferralCode,
  registerReferral,
} from "../lib/credits.js";

const router = Router();

router.get("/credits", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "로그인이 필요합니다" });
  }
  const status = await getCreditStatus(userId);
  res.json(status);
});

router.post("/credits/referral/code", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "로그인이 필요합니다" });
  }
  const code = await getOrCreateReferralCode(userId);
  res.json({ code });
});

router.post("/credits/referral/register", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "로그인이 필요합니다" });
  }
  const { code } = req.body as { code?: string };
  if (!code) {
    return res.status(400).json({ error: "code 필드가 필요합니다" });
  }
  const result = await registerReferral(userId, code);
  res.json(result);
});

export default router;
