import { Router, type IRouter } from "express";
import { getUpcomingEvents, refreshUpcomingEvents } from "../lib/upcoming-events.js";

/**
 * 다가오는 일정 API — "며칠에 무슨 일이 있고 어느 종목이 움직이나".
 * 수집은 스케줄러(장마감 후)가 하고 여기서는 조회만 한다. 화면이 기다리지 않게.
 */
const router: IRouter = Router();

router.get("/upcoming", async (req, res) => {
  try {
    const days = Math.min(14, Math.max(1, Number(req.query["days"]) || 7));
    const events = await getUpcomingEvents(days);
    res.json({ days, count: events.length, events });
  } catch (e) {
    console.warn("[events] 조회 실패:", (e as Error)?.message?.slice(0, 80));
    res.status(500).json({ error: "events_lookup_failed" });
  }
});

/** 수동 갱신 — 스케줄이 돌기 전 확인하거나, 큰 일정이 새로 잡혔을 때 */
router.post("/refresh", async (req, res) => {
  try {
    const days = Math.min(14, Math.max(1, Number(req.body?.days) || 7));
    const saved = await refreshUpcomingEvents(days);
    res.json({ saved, days });
  } catch (e) {
    console.warn("[events] 갱신 실패:", (e as Error)?.message?.slice(0, 80));
    res.status(500).json({ error: "events_refresh_failed" });
  }
});

export default router;
