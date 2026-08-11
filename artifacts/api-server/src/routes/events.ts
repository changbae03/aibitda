import { Router, type IRouter } from "express";
import { getUpcomingEvents, refreshUpcomingEvents } from "../lib/upcoming-events.js";
import { searchThemeStocks, parseKeywords } from "../lib/theme-search.js";

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

/**
 * 테마 관련주 찾기 — 사업보고서 원문에서 그 사업을 한다고 적어놓은 회사를 찾는다.
 * 뉴스가 짚어준 한두 종목이 아니라, 회사 스스로 쓴 근거로 찾는 것이 이 기능의 값이다.
 */
router.get("/theme-stocks", async (req, res) => {
  try {
    const kws = parseKeywords(String(req.query["q"] ?? ""));
    if (kws.length === 0) { res.status(400).json({ error: "q_required" }); return; }
    const limit = Math.min(40, Math.max(5, Number(req.query["limit"]) || 20));
    const hits = await searchThemeStocks(kws, limit);
    res.json({ keywords: kws, count: hits.length, hits });
  } catch (e) {
    console.warn("[theme-search] 실패:", (e as Error)?.message?.slice(0, 80));
    res.status(500).json({ error: "theme_search_failed" });
  }
});

export default router;
