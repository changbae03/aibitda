import app from "./app";
import { runMigrations } from "@workspace/db";
import { triggerModelReview } from "./routes/model-insights.js";
import { runDueSchedules } from "./lib/schedule-runner.js";
import { warmupEarningsCache } from "./routes/market-data.js";

console.log("[STARTUP] API Server v2 - SSL fix + auto migration enabled");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const SIX_HOURS_MS  = 6 * 60 * 60 * 1000;
const ONE_DAY_MS    = 24 * 60 * 60 * 1000;

runMigrations()
  .then(() => {
    console.log("[MIGRATION] 완료");
  })
  .catch((err) => {
    console.error("[MIGRATION] 실패:", err?.message ?? err);
    if (err?.cause) console.error("[MIGRATION] 원인:", err.cause);
  })
  .finally(() => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);

      // 서버 시작 1분 후 초기 예측 정확도 리뷰 실행
      setTimeout(() => {
        console.log("[SCHEDULER] 초기 모델 리뷰 시작");
        triggerModelReview().catch((e) =>
          console.error("[SCHEDULER] 초기 리뷰 실패:", e?.message ?? e)
        );
      }, 60 * 1000);

      // 이후 6시간마다 자동 반복
      setInterval(() => {
        console.log("[SCHEDULER] 정기 모델 리뷰 시작 (6시간 주기)");
        triggerModelReview().catch((e) =>
          console.error("[SCHEDULER] 정기 리뷰 실패:", e?.message ?? e)
        );
      }, SIX_HOURS_MS);

      // 실적 캘린더 캐시 워밍업: 서버 시작 30초 후 첫 실행, 이후 24시간마다 갱신
      setTimeout(() => {
        warmupEarningsCache().catch((e) =>
          console.error("[SCHEDULER] 실적 캘린더 워밍업 실패:", e?.message ?? e)
        );
      }, 30 * 1000);
      setInterval(() => {
        console.log("[SCHEDULER] 실적 캘린더 일일 갱신 시작");
        warmupEarningsCache().catch((e) =>
          console.error("[SCHEDULER] 실적 캘린더 일일 갱신 실패:", e?.message ?? e)
        );
      }, ONE_DAY_MS);

      // 30분마다 재실행 스케줄 확인
      const THIRTY_MIN_MS = 30 * 60 * 1000;
      setTimeout(() => {
        runDueSchedules(port).catch((e) =>
          console.error("[SCHEDULER] 재실행 스케줄 첫 실행 실패:", e?.message ?? e)
        );
      }, 2 * 60 * 1000); // 서버 시작 2분 후 첫 확인

      setInterval(() => {
        runDueSchedules(port).catch((e) =>
          console.error("[SCHEDULER] 재실행 스케줄 실패:", e?.message ?? e)
        );
      }, THIRTY_MIN_MS);
    });
  });
