import { autoRecalibrate, autoUpdateAllSectorPriors } from "../routes/performance.js";
import { pool } from "@workspace/db";

(async () => {
  try {
    console.log("[recalibrate] 섹터 재보정 시작...");
    const result = await autoRecalibrate();
    console.log(`[recalibrate] 완료 — ${result.analysesProcessed}건 처리, ${result.sectorsUpdated}개 섹터`);
    console.log("[recalibrate] 섹터별 결과:", JSON.stringify(result.sectors, null, 2));

    if (result.sectorsUpdated > 0) {
      console.log("[recalibrate] 섹터 프라이어 업데이트 시작...");
      const prior = await autoUpdateAllSectorPriors();
      console.log(`[recalibrate] 프라이어 업데이트 완료 — ${prior.updated}개 업데이트, ${prior.skipped}개 스킵`);
    }
  } catch (e) {
    console.error("[recalibrate] 실패:", e);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
