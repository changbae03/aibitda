import { Router, type IRouter } from "express";
import { normalizeTicker } from "@workspace/shared";
import { getStageHistory } from "../lib/stage-store.js";

/**
 * 사업 국면 판정 API. 분석 상세 페이지의 "국면 지도"가 읽는다.
 * 판정은 dart_report_analysis 단계에서 서버가 계산·저장하므로 여기서는 조회만 한다.
 */
const router: IRouter = Router();

router.get("/:ticker", async (req, res) => {
  try {
    const ticker = normalizeTicker(req.params.ticker);
    const history = await getStageHistory(ticker, 12);
    res.json({ ticker, history, latest: history.length ? history[history.length - 1] : null });
  } catch (e) {
    console.warn("[stage] 조회 실패:", (e as Error)?.message?.slice(0, 80));
    res.status(500).json({ error: "stage_lookup_failed" });
  }
});

export default router;
