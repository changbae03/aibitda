/**
 * 시장 분석 스케줄러
 * ─────────────────
 * - 장전 브리핑 갱신    : 평일 06:00 KST (= 21:00 UTC 전날) → Gemini 브리핑 캐시만 초기화
 * - 장중 브리핑 갱신    : 평일 13:00 KST (= 04:00 UTC)      → Gemini 브리핑 캐시만 초기화
 * - 장마감 브리핑 갱신  : 평일 15:30 KST (= 06:30 UTC)      → 장 종료 즉시 브리핑 캐시 초기화
 * - 장마감 증분 업데이트 : 평일 16:30 KST (= 07:30 UTC)     → LSTM+5트리 + 브리핑 캐시 초기화
 * - 월간 완전 재학습    : 매월 1일 00:00 KST (= 전날 15:00 UTC) → 5년 완전 재학습
 * - 서버 재시작 시      : 디스크 → DB → 즉시 학습 순서로 복원
 *
 * node-cron 없이 1분 간격 setInterval로 구현
 * (Replit 환경에서 외부 패키지 의존 최소화)
 */
import { runPipeline, runDailyIncrementalUpdate, tryRestoreFromDisk, tryRestoreFromDB, loadMeta } from "./lstm-predictor.js";
import { invalidateBriefCache } from "../routes/market-analysis.js";

// 실행 중복 방지용 플래그
let morningBriefToday  = "";   // "YYYY-MM-DD" 형식
let middayBriefToday   = "";   // "YYYY-MM-DD" 형식
let closingBriefToday  = "";   // "YYYY-MM-DD" 형식
let dailyRunToday      = "";   // "YYYY-MM-DD" 형식
let monthlyRunMonth    = "";   // "YYYY-MM" 형식
let weeklyRunWeek      = "";   // "YYYY-WNN" 형식 (주 번호)

function utcNow() { return new Date(); }

/** ISO 주 번호 계산 (YYYY-WNN) — 중복 실행 방지용 */
function getISOWeekStr(d: Date): string {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function checkAndRun() {
  const now    = utcNow();
  const utcH   = now.getUTCHours();
  const utcM   = now.getUTCMinutes();
  const dow    = now.getUTCDay();                   // 0=일, 1-5=평일, 6=토
  const dateStr  = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const monthStr = now.toISOString().slice(0, 7);  // YYYY-MM
  const weekStr  = getISOWeekStr(now);             // YYYY-WNN

  // ── 월간 완전 재학습: 매월 1일 00:00 KST = 전날 15:00 UTC ────────────────
  if (now.getUTCDate() === 1 && utcH === 15 && utcM === 0 && monthlyRunMonth !== monthStr) {
    monthlyRunMonth = monthStr;
    console.log("[scheduler] 월간 완전 재학습 시작");
    runPipeline(true).catch(e => console.error("[scheduler] 월간 재학습 실패:", e?.message));
    return;
  }

  // ── 주간 전체 재학습: 매주 일요일 01:00 UTC (= 일요일 10:00 KST) ─────────
  // 월간 재학습 사이에 최신 데이터로 GBDT+편향 교정 갱신 (LSTM 재훈련 포함)
  if (dow === 0 && utcH === 1 && utcM === 0 && weeklyRunWeek !== weekStr) {
    weeklyRunWeek = weekStr;
    console.log("[scheduler] 주간 완전 재학습 시작 (일요일 10:00 KST)");
    runPipeline(true).catch(e => console.error("[scheduler] 주간 재학습 실패:", e?.message));
    return;
  }

  // ── 장전 브리핑 갱신: 평일 06:00 KST = 전날 21:00 UTC ──────────────────
  // 미국 야간 데이터(S&P500, 나스닥, 공포지수 등) 반영한 장전 해설
  if (utcH === 21 && utcM === 0 && dow >= 0 && dow <= 4 && morningBriefToday !== dateStr) {
    // dow 0(일)~4(목): 다음날이 평일(월~금)인 경우만
    morningBriefToday = dateStr;
    console.log("[scheduler] 장전 브리핑 갱신 시작 (06:00 KST)");
    invalidateBriefCache();
  }

  // ── 장중 브리핑 갱신: 평일 13:00 KST = 04:00 UTC ────────────────────────
  // 오전 장 흐름 반영, 오후 전망 제공
  if (utcH === 4 && utcM === 0 && dow >= 1 && dow <= 5 && middayBriefToday !== dateStr) {
    middayBriefToday = dateStr;
    console.log("[scheduler] 장중 브리핑 갱신 시작 (13:00 KST)");
    invalidateBriefCache();
  }

  // ── 장마감 브리핑 갱신: 평일 15:30 KST = 06:30 UTC (장 종료 즉시) ─────────
  // 장이 끝난 직후 캐시를 초기화해 다음 요청부터 "장마감 브리핑"으로 전환
  if (utcH === 6 && utcM === 30 && dow >= 1 && dow <= 5 && closingBriefToday !== dateStr) {
    closingBriefToday = dateStr;
    console.log("[scheduler] 장마감 브리핑 갱신 (15:30 KST — 장 종료)");
    invalidateBriefCache();
  }

  // ── 장마감 증분 업데이트: 평일 16:30 KST = 07:30 UTC ────────────────────
  if (utcH === 7 && utcM === 30 && dow >= 1 && dow <= 5 && dailyRunToday !== dateStr) {
    dailyRunToday = dateStr;
    console.log("[scheduler] 장마감 증분 업데이트 시작 (16:30 KST)");
    runDailyIncrementalUpdate()
      .then(() => {
        // 학습 완료 후 브리핑 캐시도 초기화 → 당일 마감 데이터 반영
        invalidateBriefCache();
        console.log("[scheduler] 장마감 증분 업데이트 완료 — 브리핑 캐시 초기화");
      })
      .catch(e => console.error("[scheduler] 증분 업데이트 실패:", e?.message));
  }
}

export function startMarketScheduler() {
  // 1. 서버 시작 시 복원 순서: DB 예측 캐시(즉시) → 백그라운드 디스크 복원 → 전체학습
  console.log("[scheduler] 시작 — DB 예측 캐시 즉시 로드 시도...");

  (async () => {
    // ① DB 예측 캐시 먼저 — 즉시 ready=true, 사용자가 탭 열면 바로 볼 수 있음 (~100ms)
    console.log("[scheduler] DB 예측 캐시 시도 (즉시 서빙 목표)...");
    const dbCacheOk = await tryRestoreFromDB();
    if (dbCacheOk) {
      console.log("[scheduler] DB 캐시 복원 성공 → 사용자 즉시 서빙 가능");
      // ② 백그라운드에서 디스크 모델로 최신 예측 재계산 (silent=true → 기존 데이터 유지하며 조용히 갱신)
      setTimeout(async () => {
        console.log("[scheduler] 백그라운드 디스크 복원 시작 (silent)...");
        const diskOk = await tryRestoreFromDisk(true);
        if (diskOk) {
          console.log("[scheduler] 백그라운드 디스크 복원 완료 — 예측 갱신됨");
          // ③ 마지막 증분 업데이트가 오늘이 아니면 즉시 실행 → recentPerf 최신화
          const meta = loadMeta();
          const lastUpdated = meta?.lastUpdated ?? meta?.lastTrained ?? "";
          const todayStr = new Date().toISOString().slice(0, 10);
          const dow = new Date().getUTCDay(); // 0=일, 6=토
          if (lastUpdated.slice(0, 10) < todayStr && dow >= 1 && dow <= 5) {
            console.log(`[scheduler] 마지막 갱신(${lastUpdated.slice(0,10)}) < 오늘(${todayStr}) → 즉시 증분 업데이트 시작`);
            runDailyIncrementalUpdate()
              .then(() => console.log("[scheduler] 시작 시 즉시 증분 업데이트 완료"))
              .catch(e => console.error("[scheduler] 시작 즉시 증분 업데이트 실패:", e?.message));
          }
        } else {
          // 모델이 없거나 버전 불일치 → 백그라운드 전체 재학습 (기존 DB 캐시 데이터는 유지)
          console.log("[scheduler] 디스크 모델 없음 — 백그라운드 전체 재학습 시작 (기존 데이터 유지)");
          runPipeline(true, true).catch(e => console.error("[scheduler] 백그라운드 재학습 실패:", e?.message));
        }
      }, 5_000);
      return;
    }

    // ③ DB 캐시 없음 → 디스크 복원 시도 (수 분 소요 가능)
    console.log("[scheduler] DB 캐시 없음 — 디스크 복원 시도...");
    const diskOk = await tryRestoreFromDisk(false);
    if (diskOk) {
      const meta = loadMeta();
      console.log(`[scheduler] 디스크 복원 성공 (last_trained=${meta?.lastTrained ?? "?"})`);
      return;
    }

    // ④ 모델 자체가 없음 — 60초 후 전체 학습 (헬스체크 우선 통과)
    console.log("[scheduler] 모델 없음 — 60초 후 전체 학습 시작 (~90초)");
    setTimeout(() => {
      console.log("[scheduler] 초기 전체 학습 시작");
      runPipeline(false).catch(e => console.error("[scheduler] 초기 학습 실패:", e?.message));
    }, 60_000);
  })();

  // 2. 1분마다 스케줄 조건 확인
  setInterval(checkAndRun, 60_000);
  console.log("[scheduler] 시장분석 스케줄러 등록 완료");
  console.log("  - 장전 브리핑:   평일 06:00 KST (21:00 UTC 전날)");
  console.log("  - 장중 브리핑:   평일 13:00 KST (04:00 UTC)");
  console.log("  - 장마감 업데이트: 평일 16:30 KST (07:30 UTC)");
  console.log("  - 주간 재학습:   매주 일요일 10:00 KST (01:00 UTC)");
  console.log("  - 월간 재학습:   매월 1일 00:00 KST (전달 15:00 UTC)");
}

export { runDailyIncrementalUpdate, loadMeta };
