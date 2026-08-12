import { Router, type IRouter } from "express";
import { getUpcomingEvents, refreshUpcomingEvents } from "../lib/upcoming-events.js";
import { searchThemeStocks, parseKeywords, expandThemeKeywords, detectRegions, stripQuestionWords } from "../lib/theme-search.js";

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
    const rawQ = String(req.query["q"] ?? "");
    // "유리기판 관련 기업을 찾아줘" → "유리기판". 문장 그대로 찾으면 0건이 되고
    // 그제서야 AI 확장이 돌아 느려진다. 군더더기를 먼저 걷어낸다.
    const kws = parseKeywords(stripQuestionWords(rawQ));
    if (kws.length === 0) { res.status(400).json({ error: "q_required" }); return; }
    const limit = Math.min(40, Math.max(5, Number(req.query["limit"]) || 20));

    // 지역 인프라 테마("광주공항 이전")는 그 지역에 시설이 있는 회사가 수혜를 본다.
    // 지역은 원문에서 찾는다(군더더기 제거로 지명이 날아갈 수 있다).
    const regions = detectRegions(rawQ);

    // 먼저 사용자가 친 말 그대로 찾는다(빠르고, 대개 이걸로 충분하다).
    let used = kws;
    let hits = await searchThemeStocks(used, limit, regions);
    let expanded = false;

    // 결과가 빈약하면 그때만 AI로 넓힌다. 뉴스 말("호남 반도체 클러스터")을 회사가
    // 쓰는 말("시스템반도체·파운드리·후공정")로 옮기는 단계다. Gemini 호출이 붙으므로
    // 항상 하지 않고, 잘 안 걸릴 때만 — 흔한 테마(CDMO)는 확장 없이 즉시 답한다.
    if (hits.length < 5 && kws.length === 1) {
      used = await expandThemeKeywords(kws[0]);
      if (used.length > 1) {
        hits = await searchThemeStocks(used, limit, regions);
        expanded = true;
      }
    }
    res.json({ keywords: used, expanded, regions, count: hits.length, hits });
  } catch (e) {
    console.warn("[theme-search] 실패:", (e as Error)?.message?.slice(0, 80));
    res.status(500).json({ error: "theme_search_failed" });
  }
});

export default router;
