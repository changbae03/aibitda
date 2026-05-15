import app from "./app";
import { runMigrations } from "@workspace/db";
import { triggerModelReview } from "./routes/model-insights.js";
import { autoRecalibrate } from "./routes/performance.js";
import { runDueSchedules } from "./lib/schedule-runner.js";
import { warmupEarningsCache, initCalendarCache } from "./routes/market-data.js";
import { resumeInProgressAnalyses } from "./routes/analysis.js";

console.log("[STARTUP] API Server 기동 중…");

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
const THIRTY_MIN_MS = 30 * 60 * 1000;

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);

  runMigrations()
    .then(() => {
      console.log("[MIGRATION] 완료");
      return initCalendarCache();
    })
    .then(() => {
      console.log("[CACHE] system_cache 테이블 준비 완료");
      // 서버 재시작 시 미완료 분석 자동 복구 (30초 후 — 다른 초기화 완료 이후)
      setTimeout(() => {
        resumeInProgressAnalyses().catch(e =>
          console.error("[STARTUP] 미완료 분석 복구 실패:", e?.message)
        );
      }, 30_000);
      console.log("[STARTUP] 초기화 완료");
    })
    .catch((err) => {
      console.error("[MIGRATION/CACHE] 실패:", err?.message ?? err);
      if (err?.cause) console.error("[MIGRATION] 원인:", err.cause);
    });

  setTimeout(() => {
    console.log("[SCHEDULER] 초기 모델 리뷰 시작");
    triggerModelReview().catch((e) =>
      console.error("[SCHEDULER] 초기 리뷰 실패:", e?.message ?? e)
    );
  }, 60 * 1000);

  setInterval(() => {
    console.log("[SCHEDULER] 정기 모델 리뷰 시작 (6시간 주기)");
    triggerModelReview().catch((e) =>
      console.error("[SCHEDULER] 정기 리뷰 실패:", e?.message ?? e)
    );
  }, SIX_HOURS_MS);

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

  // ── 일일 섹터 재보정 (model_calibration 자동 갱신) ─────────────────────────
  // 6시간마다 model_insights 가격 갱신(triggerModelReview) + 하루 1회 섹터 통계 재계산
  // 이 두 루프가 맞물려야 getCalibrationContext()가 항상 최신 편향 데이터를 반환함
  setTimeout(() => {
    autoRecalibrate().catch((e) =>
      console.error("[SCHEDULER] 초기 섹터 재보정 실패:", e?.message ?? e)
    );
  }, 5 * 60 * 1000); // 서버 시작 5분 후 첫 실행

  setInterval(() => {
    console.log("[SCHEDULER] 일일 섹터 재보정 시작");
    autoRecalibrate().catch((e) =>
      console.error("[SCHEDULER] 일일 섹터 재보정 실패:", e?.message ?? e)
    );
  }, ONE_DAY_MS);

  setTimeout(() => {
    runDueSchedules(port).catch((e) =>
      console.error("[SCHEDULER] 재실행 스케줄 첫 실행 실패:", e?.message ?? e)
    );
  }, 2 * 60 * 1000);

  setInterval(() => {
    runDueSchedules(port).catch((e) =>
      console.error("[SCHEDULER] 재실행 스케줄 실패:", e?.message ?? e)
    );
  }, THIRTY_MIN_MS);
});

function gracefulShutdown(signal: string) {
  console.log(`[SHUTDOWN] ${signal} 수신 — graceful shutdown 시작`);
  server.close((err) => {
    if (err) {
      console.error("[SHUTDOWN] 서버 종료 중 오류:", err.message);
      process.exit(1);
    }
    console.log("[SHUTDOWN] 서버 종료 완료");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[SHUTDOWN] 강제 종료 (10초 초과)");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
