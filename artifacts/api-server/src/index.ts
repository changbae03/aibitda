import app from "./app";
import { runMigrations, pool } from "@workspace/db";
import { triggerModelReview } from "./routes/model-insights.js";
import { autoRecalibrate, autoUpdateAllSectorPriors } from "./routes/performance.js";
import { runDueSchedules } from "./lib/schedule-runner.js";
import { warmupEarningsCache, initCalendarCache } from "./routes/market-data.js";
import { resumeInProgressAnalyses } from "./routes/analysis.js";
import { harvestMarketData } from "./lib/market-harvester.js";
import { runDailyAutoBatch } from "./lib/auto-batch-runner.js";
import { runKrxFullHarvest } from "./lib/krx-full-harvester.js";
import { runUsFullHarvest } from "./lib/us-full-harvester.js";
import { runDailyPortfolioBriefs } from "./routes/portfolio.js";
import { updateMarketRegime } from "./lib/market-regime-updater.js";
import { updateAllSectorLearning } from "./lib/sector-learning.js";
import { initPredictionTable } from "./lib/prediction-tracker.js";
import { fetchECOSMacro } from "./lib/ecos-client.js";
import { fetchFREDMacro } from "./lib/fred-client.js";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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
const ONE_WEEK_MS   = 7 * 24 * 60 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

// ── 시장분석 서버 (TF.js 분리 — 이벤트 루프 블로킹 방지) ────────────────────
const MARKET_INTERNAL_PORT = process.env.MARKET_INTERNAL_PORT ?? "8082";

// esbuild CJS 번들에서 import.meta.url === undefined → fileURLToPath가 throw됨
// try/catch로 안전하게 처리: dev(ESM)에서는 실제 경로, prod(CJS)에서는 cwd 기준 경로 사용
function getServerDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    // 프로덕션 CJS 번들: 실행 파일은 artifacts/api-server/dist/index.cjs
    return resolve(process.cwd(), "artifacts/api-server/dist");
  }
}

function findTsxBin(): string {
  const __dir = getServerDir();
  const candidates = [
    resolve(__dir, "../../node_modules/.bin/tsx"),
    resolve(__dir, "../../../node_modules/.bin/tsx"),
    resolve(__dir, "../../../../node_modules/.bin/tsx"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "tsx";
}

let _marketChild: ChildProcess | null = null;

function spawnMarketServer() {
  const isDev = process.env.NODE_ENV !== "production";
  const __dir = getServerDir();

  const child = isDev
    ? spawn(findTsxBin(), [resolve(__dir, "market-index.ts")], {
        env: { ...process.env, PORT: MARKET_INTERNAL_PORT },
        stdio: "inherit",
      })
    : spawn(process.execPath, [resolve(__dir, "market-index.cjs")], {
        env: { ...process.env, PORT: MARKET_INTERNAL_PORT },
        stdio: "inherit",
      });

  child.on("error", (err) =>
    console.error(`[MARKET] 프로세스 오류:`, err.message)
  );
  child.on("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGKILL") return;
    console.error(`[MARKET] 비정상 종료 (code=${code}) — 5초 후 재시작`);
    _marketChild = null;
    setTimeout(spawnMarketServer, 5_000);
  });
  _marketChild = child;
  console.log(`[MARKET] 시장분석 서버 시작 (내부포트 ${MARKET_INTERNAL_PORT})`);
}

spawnMarketServer();

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);

  // 시장분석 스케줄러는 market-server 자식 프로세스에서 실행됨 (TF.js 분리)

  // 매크로 캐시 예열 — 분석 생성 시 ECOS/FRED 대기 없이 즉시 사용 가능
  setTimeout(() => {
    Promise.all([
      fetchECOSMacro().catch(e => console.warn("[CACHE] ECOS 예열 실패:", e?.message)),
      fetchFREDMacro().catch(e => console.warn("[CACHE] FRED 예열 실패:", e?.message)),
    ]).then(() => console.log("[CACHE] 매크로 캐시 예열 완료 (ECOS + FRED)"));
  }, 15_000);

  runMigrations()
    .then(() => {
      console.log("[MIGRATION] 완료");
      return Promise.all([
        pool.query(`CREATE INDEX IF NOT EXISTS idx_analyses_user_id   ON analyses(user_id)`),
        pool.query(`CREATE INDEX IF NOT EXISTS idx_analyses_ticker    ON analyses(ticker)`),
        pool.query(`CREATE INDEX IF NOT EXISTS idx_analyses_ticker_uid ON analyses(ticker, user_id)`),
        pool.query(`CREATE INDEX IF NOT EXISTS idx_analyses_ticker_st  ON analyses(ticker, status)`),
        pool.query(`CREATE INDEX IF NOT EXISTS idx_asteps_analysis_id ON analysis_steps(analysis_id)`),
        pool.query(`CREATE INDEX IF NOT EXISTS idx_asteps_aid_stepkey ON analysis_steps(analysis_id, step_key)`),
        // 공개 피드 / 탐색 / 인기 쿼리 최적화
        pool.query(`CREATE INDEX IF NOT EXISTS idx_analyses_is_public  ON analyses(is_public)`),
        pool.query(`CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC)`),
        pool.query(`CREATE INDEX IF NOT EXISTS idx_analyses_verdict    ON analyses(investment_verdict)`),
        pool.query(`CREATE INDEX IF NOT EXISTS idx_analyses_status_pub ON analyses(status, is_public)`),
        pool.query(`CREATE INDEX IF NOT EXISTS idx_analyses_industry   ON analyses(industry)`),
        // 관리자 유저 검색 최적화
        pool.query(`CREATE INDEX IF NOT EXISTS idx_user_credits_email  ON user_credits(email)`),
        initPredictionTable(),
      ]).then(() => console.log("[INDEXES] DB 인덱스 준비 완료"));
    })
    .then(() => initCalendarCache())
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

  // ── 주간 섹터 선행 지식 자동 최적화 (Gemini가 실적 기반으로 WACC·terminalG·레버 갱신) ──
  // autoRecalibrate 후 1시간 뒤 첫 실행(통계가 최신 상태여야 함), 이후 7일마다 반복
  setTimeout(() => {
    console.log("[SCHEDULER] 섹터 선행 지식 자동 최적화 시작");
    autoUpdateAllSectorPriors().catch((e) =>
      console.error("[SCHEDULER] 섹터 선행 지식 자동 최적화 실패:", e?.message ?? e)
    );
  }, 60 * 60 * 1000); // 서버 시작 1시간 후 첫 실행

  setInterval(() => {
    console.log("[SCHEDULER] 주간 섹터 선행 지식 자동 최적화 시작");
    autoUpdateAllSectorPriors().catch((e) =>
      console.error("[SCHEDULER] 주간 섹터 선행 지식 자동 최적화 실패:", e?.message ?? e)
    );
  }, 7 * ONE_DAY_MS);

  // ── 동적 시장 학습 시스템 ────────────────────────────────────────────────────
  // Layer 1: 매일 KOSPI/코스닥 트렌드 읽어 시장 레짐 컨텍스트 생성
  setTimeout(() => {
    console.log("[SCHEDULER] 시장 레짐 초기 업데이트 시작");
    updateMarketRegime().catch((e) =>
      console.error("[SCHEDULER] 시장 레짐 초기 업데이트 실패:", e?.message ?? e)
    );
  }, 3 * 60 * 1000); // 서버 시작 3분 후 첫 실행

  setInterval(() => {
    console.log("[SCHEDULER] 시장 레짐 일일 업데이트 시작");
    updateMarketRegime().catch((e) =>
      console.error("[SCHEDULER] 시장 레짐 일일 업데이트 실패:", e?.message ?? e)
    );
  }, ONE_DAY_MS);

  // Layer 2: 주 1회 섹터별 예측 정확도 → AI 가이던스 노트 생성
  setTimeout(() => {
    console.log("[SCHEDULER] 섹터 학습 노트 초기 생성 시작");
    updateAllSectorLearning().catch((e) =>
      console.error("[SCHEDULER] 섹터 학습 노트 초기 생성 실패:", e?.message ?? e)
    );
  }, 10 * 60 * 1000); // 서버 시작 10분 후 첫 실행

  setInterval(() => {
    console.log("[SCHEDULER] 섹터 학습 노트 주간 업데이트 시작");
    updateAllSectorLearning().catch((e) =>
      console.error("[SCHEDULER] 섹터 학습 노트 주간 업데이트 실패:", e?.message ?? e)
    );
  }, ONE_WEEK_MS);

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

  // ── 주간 시장 데이터 수집 (KRX 종목 재무지표 → sector_benchmarks) ─────────
  // AI 호출 없이 Yahoo Finance 재무 데이터만 수집. 비용 거의 0.
  // KRX 2719종목을 200개씩 배치(~14주 1순환). 서버 시작 10분 후 첫 실행.
  setTimeout(() => {
    harvestMarketData().catch((e) =>
      console.error("[SCHEDULER] 시장 데이터 수집 첫 실행 실패:", e?.message ?? e)
    );
  }, 10 * 60 * 1000);

  setInterval(() => {
    console.log("[SCHEDULER] 주간 시장 데이터 수집 시작");
    harvestMarketData().catch((e) =>
      console.error("[SCHEDULER] 주간 시장 데이터 수집 실패:", e?.message ?? e)
    );
  }, ONE_WEEK_MS);

  // ── 일일 자동 배치 분석 — 비활성화됨 (수동 분석 모드) ──────────────────────
  // setTimeout(() => {
  //   runDailyAutoBatch(port).catch((e) =>
  //     console.error("[SCHEDULER] 자동 배치 첫 실행 실패:", e?.message ?? e)
  //   );
  // }, 8 * 60 * 1000);
  //
  // setInterval(() => {
  //   console.log("[SCHEDULER] 일일 자동 배치 분석 시작");
  //   runDailyAutoBatch(port).catch((e) =>
  //     console.error("[SCHEDULER] 일일 자동 배치 실패:", e?.message ?? e)
  //   );
  // }, ONE_DAY_MS);

  // ── KRX 전체 종목 DB 구축 (2,719개 재무 데이터 증분 수집) ─────────────────
  // 서버 시작 2분 후 목록 동기화 + 미수집 300개 처리 → 이후 12시간마다 반복
  // 한 번에 300개 × 12시간 = 하루 600개 → 약 5일이면 전체 완성
  setTimeout(() => {
    console.log("[SCHEDULER] KRX 전체 종목 DB 구축 첫 실행");
    runKrxFullHarvest().catch((e) =>
      console.error("[SCHEDULER] KRX DB 구축 첫 실행 실패:", e?.message ?? e)
    );
  }, 2 * 60 * 1000);

  setInterval(() => {
    console.log("[SCHEDULER] KRX 전체 종목 DB 갱신 시작");
    runKrxFullHarvest().catch((e) =>
      console.error("[SCHEDULER] KRX DB 갱신 실패:", e?.message ?? e)
    );
  }, 12 * 60 * 60 * 1000);

  // ── 미국 주요 종목 DB 구축 (~600개 재무 데이터 증분 수집) ──────────────────
  // 서버 시작 4분 후 목록 동기화 + 미수집 300개 처리 → 이후 12시간마다 반복
  // KRX보다 종목 수가 적어 2-3회 실행이면 전체 완성
  setTimeout(() => {
    console.log("[SCHEDULER] US 전체 종목 DB 구축 첫 실행");
    runUsFullHarvest().catch((e) =>
      console.error("[SCHEDULER] US DB 구축 첫 실행 실패:", e?.message ?? e)
    );
  }, 4 * 60 * 1000);

  setInterval(() => {
    console.log("[SCHEDULER] US 전체 종목 DB 갱신 시작");
    runUsFullHarvest().catch((e) =>
      console.error("[SCHEDULER] US DB 갱신 실패:", e?.message ?? e)
    );
  }, 12 * 60 * 60 * 1000);

  // ── 포트폴리오 종목 일일 AI 브리핑 ──────────────────────────────────────────
  // 매일 오전 8시(KST) 기준 재실행: 오늘 브리핑이 없는 종목만 생성, 중복 없음
  setTimeout(() => {
    console.log("[SCHEDULER] 포트폴리오 일일 브리핑 첫 실행");
    runDailyPortfolioBriefs().catch((e) =>
      console.error("[SCHEDULER] 포트폴리오 브리핑 첫 실행 실패:", e?.message ?? e)
    );
  }, 7 * 60 * 1000); // 서버 시작 7분 후

  setInterval(() => {
    console.log("[SCHEDULER] 포트폴리오 일일 브리핑 시작");
    runDailyPortfolioBriefs().catch((e) =>
      console.error("[SCHEDULER] 포트폴리오 브리핑 실패:", e?.message ?? e)
    );
  }, ONE_DAY_MS);
});

function gracefulShutdown(signal: string) {
  console.log(`[SHUTDOWN] ${signal} 수신 — graceful shutdown 시작`);
  if (_marketChild) {
    _marketChild.kill("SIGTERM");
    _marketChild = null;
  }
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
