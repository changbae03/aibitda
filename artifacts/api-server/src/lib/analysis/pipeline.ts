// 분석 파이프라인 엔진 — 단계 실행(executeStep), 백그라운드 완주, 큐 관리
import { db, pool } from "@workspace/db";
import { analysesTable, analysisStepsTable, modelInsightsTable } from "@workspace/db";
import { eq, desc, not, sql, and, isNotNull } from "drizzle-orm";
import { refreshBriefForTicker } from "../../routes/portfolio.js";
import { scheduleAnalysisSelfReview } from "../self-review.js";
import { validateTicker } from "../sanitize.js";
import { getUserId, checkAndDeductCredit } from "../credits.js";
import { loadKRXList, lookupKoreanName, correctKoreanTicker } from "../krx-cache";
import { cache, TTL } from "../mem-cache.js";
import { fetchDartSubjectBalance, fetchNaverPBR, writeMetricCache } from "../peer-collector.js";
import { validatePeers } from "../peer-validator.js";
import { fetchKISStockQuotes, buildKISStockContext } from "../kis-client.js";
import { fetchECOSMacro, buildECOSContext } from "../ecos-client.js";
import { fetchFREDMacro, buildFREDContext } from "../fred-client.js";
import { AGENTS, STEP_ORDER, buildPrompt, needsFinancialSector, needsSOTP, type AgentKey } from "../ai-agents.js";
import { getCalibrationContext, classifySector } from "../../routes/performance.js";
import { triggerModelReview } from "../../routes/model-insights.js";
import { runQACheck } from "../qa-checker.js";
import { getDartHistoricalContext, fetchAndStoreDartQuarterly, getDartAnchorNumerics, fetchAnnualAllRows, fetchEmployeeCounts, fetchLatestQuarterAllRows, fetchLatestQuarterEmployees, type DartAnchorNumerics } from "../dart-store.js";
import { fetchLatestAnnualText } from "../biz-timeline.js";
import { fetchDartBusinessContent, fetchDartCompetitorSection, fetchDartOrderBacklog } from "../dart-business-content.js";
import { collectBizTimeline, getBizTimeline, periodLabel } from "../biz-timeline.js";
import { extractMetrics, renderMetricTable } from "../biz-metrics.js";
import { diffSegments, renderSegmentDiff, segmentsFromContent } from "../biz-diff.js";
import { buildSignalTimeline, emergingTerms, renderBizSignals } from "../biz-signals.js";
import { collectUSBizReports } from "../us-biz-reports.js";
import { computeWorkingCapital, renderWorkingCapital, computeCapex, renderCapex, computeHealth, renderHealthTrend, computeQuarterWC } from "../working-capital.js";
import { aggregateEmployees, renderHeadcount, extractCustomerConcentration, renderCustomerConcentration } from "../company-facts.js";
import {
  classifyStage, renderStageVerdict, pctChange, capexTrendOf,
  percentileAgainst, expectationPercentile, type StageSignals,
} from "../stage-classifier.js";
import { getSectorBand } from "../valuation/sector-bands.js";
import { saveStageVerdict, getPriorStageScore, computeStageTrajectory } from "../stage-store.js";
import { collectUSFinancials, usStageSignals, renderUSFinancials } from "../us-financials.js";
import { renderTrajectory } from "../stage-trajectory.js";
import { fetchSECEdgarContent } from "../sec-edgar-content.js";
import { fetchKOSISData, buildKOSISContext } from "../kosis-client.js";
import { buildSOTPSubsidiaryContext, hasSOTPSubsidiaryData } from "../sotp-subsidiary-context.js";
import { getLatestMarketRegime } from "../market-regime-updater.js";
import { getSectorLearningNote } from "../sector-learning.js";
import { buildSectorBandBlock } from "../valuation/sector-bands.js";
import { collectValuationInputs, renderInputGaps, describeInputs,
         getPriorValuation, getPriorSegments, renderPriorBlock } from "../valuation/inputs.js";
import { normalizeTicker, isKoreanTicker } from "@workspace/shared";
import { Semaphore } from "./semaphore.js";
import { ai, geminiSemaphore, MAX_CONCURRENT_GEMINI } from "./gemini.js";
import { extractJsonSafe, extractFvdJson, repairInvestmentStrategyContent } from "./json-repair.js";
import { rawQuery, dbCacheGet, dbCacheSet, mapAnalysisRow, mapStepRow, ensureQaPeerColumns } from "./store.js";
import { KOREAN_SECTOR_MULTIPLES, getKRXSectorPeerContext, getDartCompetitorPeerContext, getDartCompetitorTickerPeers } from "./korea-context.js";
import { yahooFinance, tryQuoteSummary, fetchTickerInfo, naverFmt, fetchNaverFinanceData, toYear, fmtNum, pct, opm, computeHistoricalBeta, fetchFinancialContext, fetchCompanyNews } from "./financial-context.js";
import { US_PEER_MAP, selectPeerTickers, fetchPeerFinancials, type PeerEntry } from "./peer-context.js";
import { savePeers, getPeersWithMetrics, getSectorPeers, formatPeerTable, type PeerWithMetrics } from "../peer-store.js";
import { QC_STEPS, runQCCheck, DEBATE_STEPS, runDebateChallenge } from "./qc-debate.js";
import { formatStep, formatAnalysis, stripDisplayContent, sanitizeFeedback } from "./format.js";
import { storeValuationArtifacts } from "./valuation-store.js";

// Prevent concurrent duplicate step execution
const runningStepsLock = new Map<string, boolean>();
// Track analyses currently fetching external data (before pipeline starts)
const pendingDataFetch = new Set<number>();

// ── 파이프라인 세션 공통 컨텍스트 (스텝마다 중복 DB 조회 방지) ───────────────
interface PipelineCtx {
  tickerNote: { memo?: string | null } | null;
  regimeNote: string | null;
  sectorNote: string | null;
}

// ── 사전 수집 캐시: company_analysis 실행 중 피어 데이터를, relative_valuation 실행 중 주봉 MA를 미리 수집 ──
const preFetchedPeerData = new Map<number, Promise<{ peers: any[]; data: string }>>();
const preFetchedWeeklyMA = new Map<number, Promise<string>>();

// 분석 파이프라인 동시 실행 제한: 서버 과부하 방지
const MAX_CONCURRENT_PIPELINES = 10;
const pipelineSemaphore = new Semaphore(MAX_CONCURRENT_PIPELINES);

// 큐 최대 대기 크기: 초과 시 신규 요청을 즉시 거절
const MAX_QUEUE_SIZE = 25;

// 파이프라인 큐 실행: 동시 실행 수 초과 시 DB 상태를 'queued'로 전환하고 대기
async function enqueueAnalysis(id: number): Promise<void> {
  // 큐 최대 크기 초과 시 즉시 오류 처리 (POST 엔드포인트의 1차 방어 후 안전망)
  if (pipelineSemaphore.waiting >= MAX_QUEUE_SIZE) {
    await rawQuery(
      `UPDATE analyses SET status='error', error_message='서버 과부하로 분석이 취소되었습니다. 잠시 후 다시 시도해주세요.' WHERE id=$1`,
      [id]
    );
    console.warn(`[queue] Analysis ${id} rejected — queue full (${pipelineSemaphore.waiting} waiting)`);
    return;
  }
  const isAtCapacity = pipelineSemaphore.active >= MAX_CONCURRENT_PIPELINES || pipelineSemaphore.waiting > 0;
  if (isAtCapacity) {
    const pos = pipelineSemaphore.waiting + 1;
    await rawQuery(
      `UPDATE analyses SET status='queued', current_step=$1 WHERE id=$2 AND status='in_progress'`,
      [`queue:${pos}`, id]
    );
    console.log(`[queue] Analysis ${id} queued (estimated position ~${pos})`);
  }
  await pipelineSemaphore.acquire();
  try {
    // 대기 후 실행 슬롯 확보 → 상태를 in_progress로 복원 (watchdog이 이미 오류 처리한 경우 스킵)
    await rawQuery(
      `UPDATE analyses SET status='in_progress', current_step='company_intro' WHERE id=$1 AND status='queued'`,
      [id]
    );
    await runPipelineBackground(id);
  } finally {
    pipelineSemaphore.release();
    console.log(`[queue] Analysis ${id} pipeline done, released slot`);
  }
}

// ─── 큐 타임아웃 감시 ─────────────────────────────────────────────────────────
// 20분 이상 대기 중인 분석을 자동 오류 처리 (5분마다 실행)
setInterval(async () => {
  try {
    const staleRows = await rawQuery(
      `UPDATE analyses
       SET status='error', error_message='서버 혼잡으로 인해 분석이 취소되었습니다. 잠시 후 다시 시도해주세요.',
           updated_at=NOW()
       WHERE status='queued' AND updated_at < NOW() - INTERVAL '20 minutes'
       RETURNING id`
    );
    if (staleRows.length > 0) {
      console.warn(`[queue-watchdog] 큐 타임아웃 ${staleRows.length}개:`, staleRows.map((r: any) => r.id));
    }
  } catch (err) {
    console.error("[queue-watchdog] 오류:", err);
  }
}, 5 * 60 * 1000);

// ─── 백그라운드 파이프라인 실행 인프라 ────────────────────────────────────────
// 클라이언트 연결 여부와 무관하게 서버에서 단계를 완주하기 위한 구조
const runningPipelineIds = new Set<number>();

// executeStep: HTTP 응답과 분리된 단계 실행 핵심 함수
// onEvent 콜백이 없으면 SSE 없이 DB에만 저장 (백그라운드 모드)
async function executeStep(
  id: number,
  stepKey: AgentKey,
  analysis: ReturnType<typeof mapAnalysisRow>,
  existingSteps: ReturnType<typeof mapStepRow>[],
  onEvent?: (data: object) => void,
  pipelineCtx?: PipelineCtx
): Promise<AgentKey | null> {
  const agent = AGENTS[stepKey];
  let enrichedContext = analysis.additionalContext ?? null;

  // ── 사전 수집 트리거 ──────────────────────────────────────────────────────
  // company_analysis 시작 → relative_valuation용 피어 데이터를 백그라운드에서 미리 수집
  if (stepKey === "company_analysis" && !preFetchedPeerData.has(id)) {
    const prevCtx = existingSteps.map(s => s.content).join("\n").slice(0, 5000);
    const snapName = analysis.companyName;
    const snapIndustry = analysis.industry;
    const snapTicker = analysis.ticker;
    const snapKrxCode = normalizeTicker(snapTicker);
    const isKoreanTicker = /^\d{6}$/.test(snapKrxCode);

    const peerPromise: Promise<{ peers: any[]; data: string }> = (async () => {
      try {
        // ① 한국 종목: DART 사업보고서에서 직접 경쟁사 먼저 추출 (seed 피어)
        let dartSeedPeers: Array<{ ticker: string; name: string; exchange: string; reason: string }> = [];
        let dartHint = "";
        if (isKoreanTicker) {
          const dartResult = await getDartCompetitorTickerPeers(snapKrxCode).catch(() => null);
          if (dartResult) {
            dartSeedPeers = dartResult.peers;
            dartHint = dartResult.hint;
            console.log(`[pre-fetch-peers] DART seed 피어 ${dartSeedPeers.length}개: ${dartSeedPeers.map(p => p.name).join(", ")} | hint="${dartHint.slice(0, 80)}"`);
          }
        }

        // ② 저장된 피어 재사용 — 같은 종목을 재분석할 때마다 AI가 다시 고르면
        //    피어가 달라져 비교가 흔들리고 토큰도 매번 든다. 최근에 고른 게 있으면 그대로 쓴다.
        let peers: any[] = [];
        const savedPeers: PeerWithMetrics[] = await getPeersWithMetrics(snapTicker, 6).catch(() => []);
        const fresh = savedPeers.filter(p => p.source !== "sector");
        if (fresh.length >= 3) {
          peers = fresh.map(p => ({
            ticker: p.ticker,
            name: p.name ?? p.ticker,
            exchange: p.market === "KR" ? "KRX" : "NASDAQ",
            reason: p.reason ?? "",
          }));
          console.log(`[pre-fetch-peers] 저장된 피어 재사용 ${peers.length}개 — AI 선정 생략`);
        }

        // ③ 저장된 게 없으면 AI 선정: DART 힌트 주입 + 부족한 피어 보완
        if (peers.length === 0) {
          peers = await selectPeerTickers(snapName, snapIndustry, prevCtx, snapTicker, dartHint);
          if (peers.length === 0) {
            peers = await selectPeerTickers(snapName, snapIndustry ?? "일반", prevCtx.slice(0, 3000), snapTicker, dartHint);
          }
          if (peers.length === 0 && !/^\d{6}/.test(snapTicker)) {
            const mapped = US_PEER_MAP[snapTicker.toUpperCase()];
            if (mapped?.length) peers = mapped;
          }

          // ④ DART seed 피어를 최우선 병합 (중복 제거)
          if (dartSeedPeers.length > 0) {
            const aiTickers = new Set(peers.map(p => p.ticker));
            const dartOnly = dartSeedPeers.filter(p => !aiTickers.has(p.ticker));
            // DART 피어 앞에 배치 (피어 테이블에서 먼저 보이도록)
            peers = [...dartOnly, ...peers].slice(0, 6); // 최대 6개
            console.log(`[pre-fetch-peers] 최종 피어 (DART+AI): ${peers.map(p => p.name).join(", ")}`);
          }

          // ⑤ 그래도 비면 같은 업종·유사 시총에서 자동 선정.
          //    예전에는 여기서 피어 없이 진행돼 상대가치 평가가 통째로 비었다.
          if (peers.length === 0) {
            const sectorPeers: PeerWithMetrics[] = await getSectorPeers(snapTicker, 5).catch(() => []);
            peers = sectorPeers.map(p => ({
              ticker: p.ticker,
              name: p.name ?? p.ticker,
              exchange: p.market === "KR" ? "KRX" : "NASDAQ",
              reason: p.reason ?? "같은 업종·유사 시가총액",
            }));
            if (peers.length > 0) {
              console.log(`[pre-fetch-peers] 업종 자동 피어 ${peers.length}개로 대체`);
              await savePeers(snapTicker, peers, { source: "sector", analysisId: id }).catch(() => {});
            }
          } else {
            // ⑥ 고른 피어를 남긴다. 다음 분석이 같은 피어를 재사용해 비교가 일관된다.
            await savePeers(snapTicker, peers, { source: "ai", analysisId: id }).catch(() => {});
          }
        }

        // ⑦ 종목 마스터에서 조인해 온 지표표를 앞에 붙인다.
        //    모든 분석이 같은 출처를 보므로 숫자가 흔들리지 않는다(외부 호출 0회).
        const metricRows: PeerWithMetrics[] = await getPeersWithMetrics(snapTicker, 6).catch(() => []);
        const metricTable = metricRows.length > 0
          ? `\n### 피어 지표 (종목 마스터 기준 — 전 분석 공통)\n${formatPeerTable(metricRows)}\n`
          : "";

        const data = peers.length > 0 ? metricTable + await fetchPeerFinancials(peers) : metricTable;
        console.log(`[pre-fetch-peers] #${id} 완료 — ${peers.length}개 피어, ${data.length}chars`);
        return { peers, data };
      } catch (err) {
        console.error(`[pre-fetch-peers] #${id} 실패:`, err);
        return { peers: [] as any[], data: "" };
      }
    })();
    preFetchedPeerData.set(id, peerPromise);
  }

  // ─────────────────────────────────────────────────────────────────────────

  // ── 소프트 앵커: 동일 종목 직전 분석 결과를 참고 ────────────────────────────
  // 밸류에이션 단계는 더 긴 스니펫 + 더 강한 일관성 지시 사용
  const isValuationStep = false; // intrinsic_valuation and relative_valuation have been removed
  try {
    const prevStepRef = await rawQuery(
      `SELECT s.content, a.created_at
       FROM analysis_steps s
       JOIN analyses a ON s.analysis_id = a.id
       WHERE a.ticker = $1 AND s.step_key = $2
         AND a.status = 'completed' AND a.id != $3
         AND s.content IS NOT NULL AND length(s.content) > 100
       ORDER BY a.created_at DESC LIMIT 1`,
      [analysis.ticker, stepKey, id]
    );
    if (prevStepRef[0]?.content) {
      const prevContent = prevStepRef[0].content as string;
      const prevDate = new Date(prevStepRef[0].created_at).toISOString().slice(0, 10);
      const snippetLen = 400;
      const snippet = prevContent.slice(0, snippetLen).replace(/\n+/g, " ").trim();
      const binding = `아래는 가장 최근 분석의 이 단계 요약입니다. 방향성 참고 후 독자적 판단으로 분석하세요.`;
      const softAnchor = `\n\n[💡 ${analysis.companyName}(${analysis.ticker}) 직전 분석(${prevDate}) 참고]\n`
        + binding + `\n"${snippet}…"`;
      enrichedContext = enrichedContext ? enrichedContext + softAnchor : softAnchor;
      console.log(`[soft-anchor] ${stepKey} for ${analysis.ticker} — injected ${softAnchor.length} chars snippet`);
    }
  } catch {
    // optional — 실패해도 AI 호출에 영향 없음
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── 종목별 관리자 보정 메모 주입 (모든 분석 단계 공통) ──────────────────
  // pipelineCtx가 있으면 캐시값 사용 (파이프라인 당 1회 DB 조회), 없으면 직접 조회
  try {
    const row = pipelineCtx !== undefined
      ? pipelineCtx.tickerNote
      : ((await rawQuery(`SELECT memo FROM ticker_notes WHERE ticker = $1`, [analysis.ticker]))[0] ?? null);

    // ① 운영자 수동 메모
    if (row?.memo) {
      const memoBlock = `\n\n[📝 운영자 종목 보정 메모 — ${analysis.companyName}(${analysis.ticker}) — 반드시 반영하세요]\n${row.memo}`;
      enrichedContext = enrichedContext ? enrichedContext + memoBlock : memoBlock;
      console.log(`[ticker-note] Injected operator memo ${memoBlock.length}chars for ${analysis.ticker}`);
    }

  } catch {
    // 실패해도 분석 진행
  }

  // ③④ 시장 레짐 + 섹터 학습 노트 주입 (KRW 종목 전용)
  // pipelineCtx가 있으면 파이프라인 시작 시 1회 pre-fetch한 값 재사용 (8회 중복 조회 방지)
  const isKrwTicker = /^\d{6}$/.test(analysis.ticker);
  if (isKrwTicker) {
    try {
      const regimeNote = pipelineCtx !== undefined ? pipelineCtx.regimeNote : await getLatestMarketRegime();
      const sectorNote = pipelineCtx !== undefined ? pipelineCtx.sectorNote : await getSectorLearningNote(analysis.ticker, analysis.industry ?? null);
      if (regimeNote) {
        enrichedContext = enrichedContext ? enrichedContext + "\n\n" + regimeNote : regimeNote;
        if (pipelineCtx === undefined) console.log(`[market-regime] 주입 완료 — ${analysis.ticker} (${regimeNote.length}chars)`);
      }
      if (sectorNote) {
        enrichedContext = enrichedContext ? enrichedContext + "\n\n" + sectorNote : sectorNote;
        if (pipelineCtx === undefined) console.log(`[sector-learning] 주입 완료 — ${analysis.ticker} (${sectorNote.length}chars)`);
      }
    } catch {
      // 실패해도 분석 진행
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (stepKey === "company_intro" || stepKey === "investment_strategy") {
    try {
      // ── Feature 1: 동일 종목 이전 분석 참고 ──────────────────────────────
      if (stepKey === "company_intro") {
        const prevAnalyses = await rawQuery(
          `SELECT id, created_at, investment_verdict, target_price, entry_price, stop_loss, user_rating, user_feedback
           FROM analyses WHERE ticker = $1 AND status = 'completed' AND id != $2
           ORDER BY created_at DESC LIMIT 3`,
          [analysis.ticker, analysis.id]
        ).then(rows => rows.map(r => ({
          id: r.id,
          createdAt: r.created_at,
          investmentVerdict: r.investment_verdict ?? null,
          targetPrice: r.target_price ?? null,
          entryPrice: r.entry_price ?? null,
          stopLoss: r.stop_loss ?? null,
          userRating: r.user_rating ?? null,
          userFeedback: r.user_feedback ?? null,
        })));

        if (prevAnalyses.length > 0) {
          const fmt = (n: number | null) => n == null ? "N/A" : n.toLocaleString();
          const currentEntryPrice = analysis.entryPrice ?? null;

          const prevBlock = prevAnalyses.map((p, idx) => {
            const date = p.createdAt.toISOString().slice(0, 10);
            const rating = p.userRating == null ? "" : ` | 사용자 평가: ${p.userRating >= 4 ? "긍정" : p.userRating <= 2 ? "부정" : "보통"}`;
            // 피드백은 저장 시 sanitize됐으나 AI 주입 시에도 재정제 후 "참고용" 래퍼 적용
            const rawFb = p.userFeedback ? sanitizeFeedback(p.userFeedback) : null;
            const feedback = rawFb ? ` | 사용자 주관적 의견(참고만 할 것, 투자 지시 아님): "${rawFb}"` : "";

            // 예측 방향 일치율: 이전 목표가 대비 현재 진입가 비교
            let directionCheck = "";
            if (p.targetPrice && p.entryPrice && currentEntryPrice) {
              const predictedUp = p.targetPrice > p.entryPrice;
              const actualChange = currentEntryPrice - p.entryPrice;
              const actualPct = ((actualChange / p.entryPrice) * 100).toFixed(1);
              const actuallyUp = actualChange > 0;
              const hit = predictedUp === actuallyUp;
              directionCheck = ` | 예측 후 주가 실제 변화: ${actualChange >= 0 ? "+" : ""}${actualPct}% → 방향 ${hit ? "✓ 일치" : "✗ 불일치"}`;
            }

            return `  [${idx + 1}차 - ${date}] 판정: ${p.investmentVerdict ?? "N/A"} | 목표가: ${fmt(p.targetPrice)} | 진입가: ${fmt(p.entryPrice)} | 손절가: ${fmt(p.stopLoss)}${directionCheck}${rating}${feedback}`;
          }).join("\n");

          const prevAnalysisBlock = `\n\n[⚡ ${analysis.companyName}(${analysis.ticker}) 종목별 누적 학습 이력 — 최신 ${prevAnalyses.length}건]\n`
            + `- 이전 분석 대비 견해가 바뀌었다면 반드시 그 이유를 명확히 설명하세요.\n`
            + `- 예측 방향이 틀렸던 경우 그 원인을 이번 분석에 반영하세요.\n`
            + `- 사용자 피드백이 있는 경우 해당 관점을 보완하세요.\n`
            + prevBlock;
          enrichedContext = enrichedContext ? enrichedContext + prevAnalysisBlock : prevAnalysisBlock;
        }

        // ── auto_learning 누적 통계 주입 (#3 강화: 방향 정확도 + 실제 수익률) ──
        try {
          const learningRows = await rawQuery(
            `SELECT auto_learning FROM ticker_notes WHERE ticker = $1`,
            [analysis.ticker]
          );
          type LearningEntry = {
            date: string; verdict: string; targetPrice: number;
            entryPrice: number; upsidePct: number;
            priceAtAnalysis?: number; predictedEps?: number | null;
            directionMatch?: boolean | null;
            actualReturn?: number;
            daysElapsed?: number;
          };
          const learningData = learningRows[0]?.auto_learning as { history?: LearningEntry[] } | null;
          if (learningData?.history && learningData.history.length >= 2) {
            const hist = learningData.history;
            const avgUpside = hist.reduce((s, h) => s + h.upsidePct, 0) / hist.length;
            const bullishCount = hist.filter(h => ["Strong Buy", "Buy"].includes(h.verdict)).length;
            const bullishPct = Math.round((bullishCount / hist.length) * 100);
            const upsides = hist.map(h => `${h.date.slice(0, 7)}: ${h.upsidePct > 0 ? "+" : ""}${h.upsidePct}%`).join(", ");

            // ① 방향 정확도
            // 우선순위: model_insights 역주입 directionMatch → 연속 분석 주가 비교(폴백)
            let dirCorrect = 0, dirTotal = 0;
            for (let i = 0; i < hist.length; i++) {
              const entry = hist[i];
              if (entry.directionMatch !== undefined && entry.directionMatch !== null) {
                // model_insights에서 역주입된 실제 방향 일치 여부 (가장 정확)
                if (entry.directionMatch === true) dirCorrect++;
                dirTotal++;
              } else if (i + 1 < hist.length) {
                // 폴백: 다음 분석 시점 주가로 추정
                const prevPrice = entry.priceAtAnalysis ?? entry.entryPrice;
                const currPrice = hist[i + 1].priceAtAnalysis ?? hist[i + 1].entryPrice;
                if (!prevPrice || !currPrice) continue;
                const actualUp = currPrice > prevPrice;
                const predictedUp = ["Strong Buy", "Buy"].includes(entry.verdict);
                if (actualUp === predictedUp) dirCorrect++;
                dirTotal++;
              }
            }
            const dirAccuracyStr = dirTotal >= 1
              ? `방향 정확도: ${dirCorrect}/${dirTotal}회 일치 (${Math.round((dirCorrect / dirTotal) * 100)}%)`
              : "";

            // ② 실제 수익률
            // 우선순위: model_insights 역주입 actualReturn → 연속 분석 주가 비교(폴백)
            const actualReturns: string[] = [];
            for (let i = 0; i < hist.length; i++) {
              const entry = hist[i];
              if (entry.actualReturn !== undefined) {
                // model_insights 6시간 갱신 현재가 기반 실제 수익률 (정확)
                const predicted = entry.upsidePct;
                const label = entry.daysElapsed ? `(${entry.daysElapsed}일 경과)` : "";
                actualReturns.push(
                  `${entry.date.slice(0, 7)}${label}: 예측 ${predicted > 0 ? "+" : ""}${predicted}% → 실제 ${entry.actualReturn >= 0 ? "+" : ""}${entry.actualReturn}%`
                );
              } else if (i + 1 < hist.length) {
                // 폴백: 다음 분석 시점 주가로 추정
                const p0 = entry.priceAtAnalysis ?? entry.entryPrice;
                const p1 = hist[i + 1].priceAtAnalysis ?? hist[i + 1].entryPrice;
                if (!p0 || !p1) continue;
                const actualRet = ((p1 - p0) / p0) * 100;
                actualReturns.push(
                  `${entry.date.slice(0, 7)}: 예측 ${entry.upsidePct > 0 ? "+" : ""}${entry.upsidePct}% → 실제(추정) ${actualRet > 0 ? "+" : ""}${actualRet.toFixed(1)}%`
                );
              }
            }

            // ③ EPS 예측 정확도 추적 (predictedEps가 있는 항목)
            const epsEntries = hist.filter(h => h.predictedEps != null);
            const epsNote = epsEntries.length > 0
              ? `\n- 직전 EPS 예측값: ${epsEntries.map(e => `${e.date.slice(0, 7)}: ${e.predictedEps}`).join(", ")} (실제 실적 발표 후 정확도 검증 참고)`
              : "";

            // ④ 낙관/비관 편향 감지
            const biasNote = avgUpside > 40
              ? "\n⚠️ 낙관 편향 감지: 과거 평균 upside가 +40%를 초과합니다. 이번 분석에서는 보수적 가정을 의식적으로 점검하세요."
              : avgUpside < -20
              ? "\n⚠️ 비관 편향 감지: 과거 평균 upside가 -20%를 하회합니다. 이번 분석에서 상방 촉매를 충분히 반영했는지 재검토하세요."
              : "";

            const statsBlock = `\n\n[📊 ${analysis.ticker} 밸류에이션 누적 통계 — ${hist.length}회 분석 기반]`
              + `\n- 평균 upside: ${avgUpside > 0 ? "+" : ""}${avgUpside.toFixed(1)}% | 매수 판정 비율: ${bullishPct}%`
              + `\n- 회차별 upside: ${upsides}`
              + (actualReturns.length > 0 ? `\n- 예측 vs 실제: ${actualReturns.join(" / ")}` : "")
              + (dirAccuracyStr ? `\n- ${dirAccuracyStr}` : "")
              + epsNote
              + biasNote
              + `\n- 위 통계를 바탕으로 낙관/비관 편향이 있었다면 이번 분석에서 의식적으로 보정하세요.`;
            enrichedContext = enrichedContext ? enrichedContext + statsBlock : statsBlock;
          }
        } catch {
          // optional
        }
        // ─────────────────────────────────────────────────────────────────
      }

      // ── 중복 방지: 이미 완료된 단계의 담당 영역을 AI에게 고지 ──────────────
      // 각 단계가 이미 다룬 영역을 명시 → AI가 같은 내용을 반복 작성하지 않도록 방지
      if (stepKey !== "company_intro" && existingSteps.length > 0) {
        const STEP_OWNERSHIP: Record<string, string> = {
          company_intro:        "기업 소개, 핵심 이슈 선언",
          industry_analysis:    "산업 구조·수익 모델, 시장 규모·성장률, 경쟁사 점유율·수익성 비교, 기업의 업계 내 경쟁 포지션(유리/불리), 정책·규제 환경",
          catalyst_analysis:    "핵심 이슈의 주가 반영도 판단, 투자 촉매·역촉매 이벤트(날짜·조건·주가영향), 이슈 전개 로드맵(단/중/장기), 수급 동향(외국인·기관 순매수)",
          company_analysis:     "이 기업 재무 수치(매출·영업이익·순이익·EPS·마진율·ROE·FCF) 과거 이력, 재무 건전성(부채비율·순현금), 컨센서스 전망치 소개",
          investment_strategy:  "전 단계 종합 — 산업 포지션, 실적 함의, 투자 기회·리스크, 모니터링 체크리스트",
        };
        const STEP_LABEL: Record<string, string> = {
          company_intro: "팀장 브리핑",
          industry_analysis: "산업 분석",
          catalyst_analysis: "투자 촉매",
          company_analysis: "기업 재무 분석",
          intrinsic_valuation: "절대가치 밸류에이션",
          investment_strategy: "투자 전략",
        };
        const completedLines = existingSteps
          .filter(s => STEP_OWNERSHIP[s.stepKey])
          .map(s => `- [${STEP_LABEL[s.stepKey] ?? s.stepKey}] 이미 다룬 영역: ${STEP_OWNERSHIP[s.stepKey]}`)
          .join("\n");
        if (completedLines) {
          const dedupBlock = `\n\n[⛔ 중복 작성 금지 — 이미 완료된 단계에서 다룬 영역]\n`
            + `아래 영역은 각 담당 단계에서 이미 상세히 분석됨. 이 단계에서 같은 내용을 다시 설명하는 것은 금지됩니다.\n`
            + `꼭 필요한 경우(현재 단계 논리 전개에 필수적인 수치 1개 인용 등) 1문장 이내로만 참조하고, 재분석·재설명은 하지 마세요.\n\n`
            + completedLines;
          enrichedContext = enrichedContext ? enrichedContext + dedupBlock : dedupBlock;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Feature 2: 틀린 예측 패턴 반영 (model_insights 교훈) ──────────────
      const allInsightRows = await rawQuery(
        `SELECT ticker, company_name, lesson, days_elapsed, price_return, outcome FROM model_insights WHERE outcome != 'pending'`
      );
      const allInsights = allInsightRows.map(r => ({
        ticker: r.ticker,
        companyName: r.company_name,
        lesson: r.lesson ?? null,
        daysElapsed: r.days_elapsed ?? null,
        priceReturn: r.price_return ?? null,
        outcome: r.outcome,
      }));

      // 동일 종목 교훈 우선, 나머지는 최신 5건
      const sameTickerLessons = allInsights
        .filter((i) => i.ticker === analysis.ticker && i.lesson && i.lesson.trim())
        .map((i) => `  [동일종목·${i.daysElapsed}일 경과, ${i.priceReturn?.toFixed(1)}% 수익률] ${i.lesson}`);

      const otherLessons = allInsights
        .filter((i) => i.ticker !== analysis.ticker && i.lesson && i.lesson.trim())
        .slice(-4)
        .map((i) => `  [${i.companyName}(${i.ticker})·${i.daysElapsed}일, ${i.priceReturn?.toFixed(1)}%] ${i.lesson}`);

      const allLessons = [...sameTickerLessons, ...otherLessons];
      if (allLessons.length > 0) {
        const lessonBlock = `\n\n[🎯 AI 모델 과거 예측 교훈 — 반드시 반영하세요]\n${allLessons.join("\n")}`;
        enrichedContext = enrichedContext ? enrichedContext + lessonBlock : lessonBlock;
      }
    } catch {
      // insights injection optional
    }
  }

  // ── company_analysis: 이전 동일 종목 실적 전망 수치 앵커 주입 ─────────────
  // 일관성 확보: 직전 완료 분석의 CHAIN-HANDOFF 구조화 수치 + 추정 재무 모델을 강하게 바인딩
  if (stepKey === "company_analysis") {
    try {
      const prevStepRows = await rawQuery(
        `SELECT s.content, a.created_at
         FROM analysis_steps s
         JOIN analyses a ON s.analysis_id = a.id
         WHERE a.ticker = $1 AND a.status = 'completed' AND a.id != $2
           AND s.step_key = 'company_analysis' AND s.content IS NOT NULL
         ORDER BY a.created_at DESC LIMIT 1`,
        [analysis.ticker, analysis.id]
      );
      if (prevStepRows[0]) {
        const prevContent: string = prevStepRows[0].content ?? "";
        const prevDate = new Date(prevStepRows[0].created_at).toISOString().slice(0, 10);

        // ① CHAIN-HANDOFF 핵심 지표 섹션 추출 (EPS·EBITDA·매출·영업이익률 등)
        const chainIdx = prevContent.lastIndexOf("CHAIN-HANDOFF");
        const chainSection = chainIdx !== -1
          ? prevContent.slice(chainIdx, chainIdx + 1800)
          : prevContent.slice(-1500);

        // ② 추정 재무 모델 테이블 추출 (연도별 매출·영업이익·순이익·EPS 수치)
        const forecastIdx = prevContent.search(/추정\s*재무\s*모델/);
        const forecastSection = forecastIdx !== -1
          ? prevContent.slice(forecastIdx, forecastIdx + 1400)
          : "";

        // ③ 실적 전망 인계 데이터 섹션 추출 (Bottom-up 임팩트 + 시나리오 가정)
        const handoffIdx = prevContent.lastIndexOf("실적 전망 인계 데이터");
        const handoffSection = handoffIdx !== -1
          ? prevContent.slice(handoffIdx, handoffIdx + 1200)
          : "";

        const anchorBlock = `\n\n[⛔ ${analysis.companyName}(${analysis.ticker}) 직전 분석(${prevDate}) 실적 전망 앵커 — 수치 일관성 강제]\n`
          + `⛔ 일관성 규칙 (반드시 준수):\n`
          + `1. 아래 직전 분석 수치에서 주요 지표(매출·영업이익·순이익·EPS)가 ±15% 이상 달라지면 반드시 "전망 수정 근거:" 별도 문단을 작성하세요.\n`
          + `2. 새로운 분기 실적 발표·공시·업황 변화·컨센서스 대규모 조정 등 명확한 사유 없이 수치의 방향성(성장↔감소)을 역전하지 마세요.\n`
          + `3. CHAIN-HANDOFF의 Base EPS·EBITDA·영업이익률 수치는 이번 분석의 출발점입니다. 수정 시 근거를 명시하세요.\n`
          + `4. 이전 분석의 "추정 재무 모델" 테이블의 연도별 수치를 확인하고, 같은 연도 수치가 크게 달라지면 이유를 밝히세요.\n\n`
          + (forecastSection ? `**[직전 추정 재무 모델]**\n${forecastSection.slice(0, 1200)}\n\n` : "")
          + (handoffSection ? `**[직전 실적 전망 인계 데이터]**\n${handoffSection.slice(0, 900)}\n\n` : "")
          + `**[직전 CHAIN-HANDOFF 핵심 지표]**\n${chainSection.slice(0, 1200)}`;

        enrichedContext = enrichedContext ? enrichedContext + anchorBlock : anchorBlock;
        console.log(`[company_analysis] prev forecast anchor injected from ${prevDate} — forecastLen=${forecastSection.length} chainLen=${chainSection.length}`);
      }
    } catch {
      // optional — 이전 데이터 없어도 무방
    }

    // 서버가 손익 표를 그려 넣는다 — AI가 표를 직접 그리다 구분선(---) 반복으로 스트림이
    // 끊겨 뒤 섹션(재무 건전성·컨센서스)까지 통째로 날아가던 문제를 없앤다.
    // 표는 서버가, 해석은 AI가 (조용한 실패·망친 표 방지).
    try {
      // 값은 원(raw) 단위이고, 같은 (연도·보고서)에 fs_type이 섞여 중복·NULL 행이 생긴다.
      // DISTINCT ON으로 매출 있는 행을 연도별 하나만 집는다(CLAUDE.md: 값 있는 행 우선).
      const [annual, quarter] = await Promise.all([
        rawQuery(
          `SELECT DISTINCT ON (bsns_year) bsns_year, revenue, operating_income, net_income
             FROM ticker_financials WHERE ticker = $1 AND reprt_code = '11011' AND revenue IS NOT NULL
             ORDER BY bsns_year DESC, revenue DESC LIMIT 4`, [analysis.ticker]),
        rawQuery(
          `SELECT DISTINCT ON (bsns_year, reprt_code) bsns_year, reprt_code, revenue, operating_income, net_income
             FROM ticker_financials WHERE ticker = $1 AND reprt_code != '11011' AND revenue IS NOT NULL
             ORDER BY bsns_year DESC, reprt_code DESC, revenue DESC LIMIT 8`, [analysis.ticker]),
      ]);
      // 보고서 코드는 시간순이 아니다(11013=Q1·11012=반기·11014=Q3). 시간순으로 다시 정렬해
      // 최근 5개만 최신순으로 — CLAUDE.md가 경고한 "Q1이 최신으로 집히는" 버그 방지.
      const qOrd: Record<string, number> = { "11013": 1, "11012": 2, "11014": 3 };
      const chrono = (r: any) => Number(r.bsns_year) * 10 + (qOrd[r.reprt_code] ?? 0);
      const quarterSorted = [...quarter].sort((a, b) => chrono(b) - chrono(a)).slice(0, 5);
      // 원 단위를 조/억으로 적응 포맷(대형주는 조, 중소형은 억).
      const money = (v: any): string => {
        if (v == null) return "—";
        const n = Number(v);
        if (!Number.isFinite(n)) return "—";
        if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(1)}조`;
        if (Math.abs(n) >= 1e8) return `${Math.round(n / 1e8).toLocaleString("ko-KR")}억`;
        return n.toLocaleString("ko-KR");
      };
      const opm = (oi: any, rev: any) =>
        oi != null && rev && Number(rev) !== 0 ? `${((Number(oi) / Number(rev)) * 100).toFixed(1)}%` : "—";
      const rl: Record<string, string> = { "11012": "반기", "11013": "1분기", "11014": "3분기" };
      const blocks: string[] = [];
      if (annual.length > 0) {
        let t = "\n[📊 서버 제공 · 연간 손익 — 이 표를 그대로 인용하고 직접 표를 다시 그리지 마세요]\n";
        t += "| 연도 | 매출 | 영업이익 | 순이익 | OPM |\n|---|---|---|---|---|\n";
        for (const r of annual) t += `| ${r.bsns_year}년 | ${money(r.revenue)} | ${money(r.operating_income)} | ${money(r.net_income)} | ${opm(r.operating_income, r.revenue)} |\n`;
        blocks.push(t);
      }
      if (quarterSorted.length > 0) {
        let t = "\n[📊 서버 제공 · 최근 분기 손익 — 이 표를 그대로 인용하고 직접 표를 다시 그리지 마세요]\n";
        t += "| 기간 | 매출 | 영업이익 | 순이익 | OPM |\n|---|---|---|---|---|\n";
        for (const r of quarterSorted) t += `| ${r.bsns_year}년 ${rl[r.reprt_code] ?? r.reprt_code} | ${money(r.revenue)} | ${money(r.operating_income)} | ${money(r.net_income)} | ${opm(r.operating_income, r.revenue)} |\n`;
        blocks.push(t);
      }
      // 재무 건전성 추이 — 최신 스냅샷이 아니라 과거부터의 흐름(개선/악화)을 짚게 한다.
      // 자본총계·부채총계·순이익은 ticker_financials에 비어 있어(equity NULL), CCC·CapEx와
      // 같은 전체 재무제표(fetchAnnualAllRows)에서 IFRS 코드로 뽑아 계산한다.
      let healthCount = 0;
      if (isKoreanTicker(analysis.ticker)) {
        try {
          const all = await fetchAnnualAllRows(analysis.ticker);
          if (all) {
            const ht = renderHealthTrend(computeHealth(all.rows, all.bsnsYear));
            if (ht) { blocks.push(ht); healthCount = 1; }
          }
        } catch (e) {
          console.warn("[company_analysis] 건전성 추이 계산 실패:", (e as Error)?.message?.slice(0, 80));
        }
      }

      if (blocks.length > 0) {
        const inj = "\n\n" + blocks.join("\n");
        enrichedContext = enrichedContext ? enrichedContext + inj : inj;
        console.log(`[company_analysis] 서버 손익표 주입 (연간 ${annual.length}, 분기 ${quarter.length}, 건전성 ${healthCount})`);
      }
    } catch (e) {
      console.warn("[company_analysis] 손익표 주입 실패:", (e as Error)?.message?.slice(0, 80));
    }
  }

  // ── dart_report_analysis: 사업보고서 원문 + 다기간 재무 데이터 주입 ────────
  if (stepKey === "dart_report_analysis") {
    try {
      const dartBlocks: string[] = [];
      // 사업 국면 판정에 쓸 신호를 이 블록을 지나며 하나씩 채운다(끝에서 한 번에 판정).
      const stageSig: StageSignals = {};
      let segCounts = { added: 0, dropped: 0 };

      // 1) 사업의 내용 — **여러 기간을 나란히** 넣는다.
      //
      // 이 단계의 임무는 "무엇이 달라졌나"인데, 최신 1건만 주면 비교할 과거가 없어
      // 프롬프트의 지시(사업 구성 이동·캐파 변화·매출처 집중도 추이)가 통째로 헛돈다.
      // dart_biz_reports에 분기·반기·연간을 (종목, 연도, 분기)로 쌓아두고 꺼내 쓴다.
      if (isKoreanTicker(analysis.ticker)) {
        // 아직 안 받은 기간이 있으면 이때 채운다(이미 있는 기간은 건너뛴다).
        await collectBizTimeline(analysis.ticker, 4).catch((e) =>
          console.warn(`[dart_report_analysis] 시계열 수집 실패:`, (e as Error)?.message?.slice(0, 80)));

        const timeline = await getBizTimeline(analysis.ticker)
          .catch(() => [] as Awaited<ReturnType<typeof getBizTimeline>>);
        if (timeline.length >= 2) {
          const body = timeline
            .map(t => `\n───────── ${periodLabel(t.bsnsYear, t.quarter)} (${t.reportNm}) ─────────\n${t.content}`)
            .join("\n");
          // 숫자는 코드가 뽑아 표로 먼저 준다.
          //
          // 기간이 4개에서 16개로 늘자 LLM이 다른 해 값을 끌어왔다(근거 확인 100%→41%).
          // 원문 16개를 놓고 숫자를 찾게 하면 섞인다 — 프롬프트로는 못 막는다.
          // 순서를 바꿔서, 찾을 일 자체를 없앤다.
          const metricTable = renderMetricTable(timeline.map(t => ({
            periodLabel: periodLabel(t.bsnsYear, t.quarter),
            bsnsYear: t.bsnsYear, quarter: t.quarter,
            hits: extractMetrics(t.content),
          })));
          if (metricTable) {
            dartBlocks.push(metricTable);
            console.log(`[dart_report_analysis] 서버 추출 지표표 주입 (${metricTable.length}chars)`);
          }

          // "사라진 것" — 매출비중 표의 사업부문을 연간끼리 집합 비교한다.
          // 회사는 접은 사업을 말하지 않으니, 코드가 목록에서 빠진 부문을 짚어준다.
          const segDiffResult = diffSegments(timeline.map(t => ({
            bsnsYear: t.bsnsYear, quarter: t.quarter,
            periodLabel: periodLabel(t.bsnsYear, t.quarter),
            segments: segmentsFromContent(t.content),
          })));
          segCounts = { added: segDiffResult.appeared.length, dropped: segDiffResult.disappeared.length };
          const segDiff = renderSegmentDiff(segDiffResult);
          if (segDiff) {
            dartBlocks.push(segDiff);
            console.log(`[dart_report_analysis] 사업부문 변화 진단 주입`);
          }

          // 행간 읽기 — 서술 속 전략 행동(증설·양산·M&A·수주·철수·기술)을 연도별로,
          // 그 해 '새로 나온 것'만 짚는다. + 과거엔 없던 새 기술·제품 용어.
          const annualPeriods = timeline
            .filter(t => t.quarter === 4)
            .sort((a, b) => a.bsnsYear - b.bsnsYear)
            .map(t => ({ label: periodLabel(t.bsnsYear, t.quarter), content: t.content }));
          const bizSignals = renderBizSignals(buildSignalTimeline(annualPeriods), emergingTerms(annualPeriods));
          if (bizSignals) {
            dartBlocks.push(bizSignals);
            console.log(`[dart_report_analysis] 행간(전략 행동) 주입`);
          }

          dartBlocks.push(
            `[📄 DART 사업보고서 시계열 — ${timeline.length}개 기간, 오래된 순]\n` +
            `⚠️ 같은 항목이 기간마다 어떻게 달라졌는지 대조하세요. **처음 등장한 기간·사라진 기간**을 분기까지 짚을 것.\n` +
            `⚠️ 수치는 위 [서버가 뽑은 수치] 표를 쓰세요. 아래 원문은 **맥락을 읽기 위한 것**이지 숫자를 찾는 곳이 아닙니다.\n` +
            `⚠️ 원문에서 숫자를 인용해야 한다면 반드시 그 기간 원문에 있는 값만 쓰세요 — 다른 기간 값을 끌어오면 서버 검산에서 걸립니다.` +
            body,
          );
          console.log(`[dart_report_analysis] 시계열 ${timeline.length}개 기간 주입 (${body.length}chars)`);
        } else {
          // 시계열이 없으면 최신 1건이라도 — 다만 비교 분석은 못 한다고 알린다.
          const bizContent = await fetchDartBusinessContent(analysis.ticker).catch(() => null);
          if (bizContent && bizContent.length > 100) {
            dartBlocks.push(
              `[📄 DART 사업보고서 — 최신 1건만 확보]\n` +
              `⚠️ 과거 보고서를 확보하지 못해 **기간 비교가 불가능합니다.** 변화·추이를 지어내지 말고, ` +
              `현재 시점의 사업 구조만 서술한 뒤 "과거 공시 미확보로 추이 분석 불가"라고 밝히세요.\n` +
              bizContent.slice(0, 12000),
            );
          } else {
            dartBlocks.push("[📄 DART 사업보고서] 수집 실패 또는 미수집 — 이전 단계 컨텍스트 기반으로 분석하세요.");
          }
        }
      } else {
        dartBlocks.push("[📄 미국 종목] SEC 10-K/10-Q 기반 분석. 아래 재무 데이터를 활용해 사업 흐름을 분석하세요.");
      }

      // 2) 다기간 재무 데이터 (연간 3개년 + 분기 4개)
      try {
        const [annualRows, quarterRows] = await Promise.all([
          rawQuery(
            // operating_margin 컬럼은 존재하지 않는다 — 넣으면 쿼리 전체가 던져지고
            // catch에 삼켜져 이 연간 재무표가 통째로 사라진다(조용한 실패). OPM은 코드가 계산한다.
            //
            // 같은 (종목·연도·보고서)에 fs_type이 다른 행이 여럿 쌓인다('CFS'·'연결'·'OFS').
            // 그중 매출이 NULL인 빈 껍데기 행이 섞여 있어, 단순 최신순으로 집으면 매출 0으로
            // 계산돼 "매출급감 -100%" 같은 헛값이 나온다(SK하이닉스 실측). 연도별로 매출이
            // 있는 행 중 규모가 가장 큰 것(=연결)을 하나만 집는다.
            `SELECT DISTINCT ON (bsns_year)
                    bsns_year, reprt_code, revenue, operating_income, net_income,
                    total_assets, equity, cash, total_debt
             FROM ticker_financials
             WHERE ticker = $1 AND reprt_code = '11011' AND revenue IS NOT NULL
             ORDER BY bsns_year DESC, revenue DESC
             LIMIT 4`,
            [analysis.ticker]
          ),
          rawQuery(
            `SELECT bsns_year, reprt_code, revenue, operating_income, net_income,
                    total_assets
             FROM ticker_financials
             WHERE ticker = $1 AND reprt_code != '11011'
             ORDER BY bsns_year DESC, reprt_code DESC LIMIT 5`,
            [analysis.ticker]
          ),
        ]);

        if (annualRows.length > 0) {
          // OPM은 영업이익/매출로 계산한다(저장된 마진 컬럼이 없다).
          const opmOf = (r: any): number | null => {
            const rev = Number(r?.revenue), oi = Number(r?.operating_income);
            return Number.isFinite(rev) && rev > 0 && Number.isFinite(oi) ? oi / rev : null;
          };
          // 국면 신호: 매출성장률·OPM 추세 (최근 확정 연간 vs 직전)
          if (annualRows.length >= 2) {
            stageSig.revGrowthPct = pctChange(Number(annualRows[0].revenue), Number(annualRows[1].revenue));
            const opmL = opmOf(annualRows[0]), opmP = opmOf(annualRows[1]);
            if (opmL != null && opmP != null) stageSig.opmDeltaPp = (opmL - opmP) * 100;
          }
          const fmt = (v: any) => (v == null ? "—" : Number(v).toLocaleString("ko-KR"));
          const pct = (v: any) => (v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`);
          const reprtLabel: Record<string, string> = { "11011": "연간", "11012": "반기", "11013": "1분기", "11014": "3분기" };

          let annualTable = "\n[📊 연간 재무 추이 (억원)]\n";
          annualTable += "| 연도 | 매출 | 영업이익 | 순이익 | OPM | 자산 | 자본 |\n";
          annualTable += "|------|------|---------|--------|-----|------|------|\n";
          for (const r of annualRows) {
            annualTable += `| ${r.bsns_year}년 | ${fmt(r.revenue)} | ${fmt(r.operating_income)} | ${fmt(r.net_income)} | ${pct(opmOf(r))} | ${fmt(r.total_assets)} | ${fmt(r.equity)} |\n`;
          }
          dartBlocks.push(annualTable);

          if (quarterRows.length > 0) {
            let qTable = "\n[📊 최근 분기 재무 추이 (억원)]\n";
            qTable += "| 기간 | 매출 | 영업이익 | 순이익 |\n";
            qTable += "|------|------|---------|--------|\n";
            for (const r of quarterRows) {
              const label = `${r.bsns_year}년 ${reprtLabel[r.reprt_code] ?? r.reprt_code}`;
              qTable += `| ${label} | ${fmt(r.revenue)} | ${fmt(r.operating_income)} | ${fmt(r.net_income)} |\n`;
            }
            dartBlocks.push(qTable);
          }
        }
      } catch (e) {
        console.warn("[dart_report_analysis] 재무 데이터 조회 실패:", (e as Error)?.message?.slice(0, 80));
        dartBlocks.push("[📊 재무 데이터] 조회 실패 — 이전 단계 컨텍스트 기반으로 추론하세요.");
      }

      // 3) 운전자본 효율성 — 서버가 재무제표에서 직접 계산한다(LLM에게 계산 안 시킴).
      //    전체 재무제표 한 보고서가 3개년을 주므로 한 번 호출로 DIO·DSO·DPO·CCC 추이가 나온다.
      if (isKoreanTicker(analysis.ticker)) {
        try {
          const all = await fetchAnnualAllRows(analysis.ticker);
          let latestRevenue: number | null = null;
          if (all) {
            // 같은 rows에서 CapEx(투자 방향)와 운전자본(현금 효율)을 함께 뽑는다.
            const capexYears = computeCapex(all.rows, all.bsnsYear);
            const capex = renderCapex(capexYears);
            if (capex) { dartBlocks.push(capex); console.log(`[dart_report_analysis] CapEx 주입 (${all.bsnsYear})`); }
            stageSig.capexTrend = capexTrendOf(capexYears.map(c => c.capex));
            const wcYears = computeWorkingCapital(all.rows, all.bsnsYear);
            // 국면 신호는 연간 기준으로만 (분기 연율화 잡음이 판정을 흔들지 않게).
            const cccs = wcYears.filter(w => w.ccc != null);
            if (cccs.length >= 2) stageSig.cccDeltaDays = cccs[cccs.length - 1].ccc! - cccs[cccs.length - 2].ccc!;
            // 표시용으로 최신 분기 포인트를 덧붙인다 — 연간에서 멈추지 않게(사용자 요청: 1Q26 기준).
            try {
              const q = await fetchLatestQuarterAllRows(analysis.ticker);
              if (q && q.bsnsYear > all.bsnsYear) {
                const qwc = computeQuarterWC(q.rows, q.bsnsYear, `${q.label}(연율)`, q.flowFactor);
                if (qwc && qwc.ccc != null) wcYears.push(qwc);
              }
            } catch { /* 분기 실패는 연간만으로 진행 */ }
            const wc = renderWorkingCapital(wcYears);
            if (wc) { dartBlocks.push(wc); console.log(`[dart_report_analysis] 운전자본 지표 주입 (${all.bsnsYear}+분기)`); }
            const revRow = all.rows.find(r => String(r.account_id ?? "").includes("Revenue"));
            const rev = Number(String(revRow?.thstrm_amount ?? "").replace(/,/g, ""));
            latestRevenue = Number.isFinite(rev) && rev > 0 ? rev : null;
          }

          // 임직원 수 추이(직원현황 API) — 인력 증감은 확장·구조조정의 직접 신호.
          const emp = await fetchEmployeeCounts(analysis.ticker);
          const hcYears = emp.map(e => aggregateEmployees(e.rows, e.year))
            .filter((x): x is NonNullable<typeof x> => x != null);
          // 국면 신호(인력 증감)는 연간 기준으로만.
          if (hcYears.length >= 2) stageSig.headcountGrowthPct = pctChange(hcYears[hcYears.length - 1].total, hcYears[hcYears.length - 2].total);
          // 표시용으로 최신 분기 인원을 덧붙인다(사용자 요청: 1Q26 기준).
          try {
            const qe = await fetchLatestQuarterEmployees(analysis.ticker);
            const lastYear = hcYears.length ? hcYears[hcYears.length - 1].year : 0;
            if (qe && qe.year > lastYear) {
              const qh = aggregateEmployees(qe.rows, qe.year, qe.label);
              if (qh) hcYears.push(qh);
            }
          } catch { /* 분기 실패는 연간만으로 진행 */ }
          const headcount = renderHeadcount(hcYears);
          if (headcount) { dartBlocks.push(headcount); console.log(`[dart_report_analysis] 임직원 수 주입`); }

          // 고객 집중도(재무제표 주석) — 고객명은 익명이어도 단일 대형고객 매출을 금액 공시.
          const rawAnnual = await fetchLatestAnnualText(analysis.ticker);
          const cust = renderCustomerConcentration(
            rawAnnual ? extractCustomerConcentration(rawAnnual) : null, latestRevenue);
          if (cust) { dartBlocks.push(cust); console.log(`[dart_report_analysis] 고객 집중도 주입`); }
        } catch (e) {
          console.warn("[dart_report_analysis] 운전자본 계산 실패:", (e as Error)?.message?.slice(0, 80));
        }
      }

      // 미국: SEC EDGAR XBRL(companyfacts)에서 같은 신호를 뽑는다 — DART의 미국판.
      // 매출성장·OPM추세·CapEx방향·CCC까지 나와 한국과 동일한 신호 밀도다.
      if (!isKoreanTicker(analysis.ticker)) {
        try {
          const usYears = await collectUSFinancials(analysis.ticker);
          Object.assign(stageSig, usStageSignals(usYears));
          const usTable = renderUSFinancials(usYears);
          if (usTable) { dartBlocks.push(usTable); console.log(`[dart_report_analysis] 미국 재무표 주입 (${usYears.length}개년, SEC EDGAR)`); }

          // 미국 행간 — 10-K "Item 1. Business" 다년치에서 전략 행동 + 새 기술 용어(영어 패턴).
          const bizRows = await collectUSBizReports(analysis.ticker, 4);
          const usPeriods = bizRows.map(r => ({ label: `FY${r.fy}`, content: r.content }));
          const usBizSignals = renderBizSignals(buildSignalTimeline(usPeriods, "en"), emergingTerms(usPeriods));
          if (usBizSignals) { dartBlocks.push(usBizSignals); console.log(`[dart_report_analysis] 미국 행간(전략 행동) 주입`); }
        } catch (e) {
          console.warn("[dart_report_analysis] 미국 재무(SEC) 실패:", (e as Error)?.message?.slice(0, 80));
        }
      }

      // 사업 국면 판정 — 한·미 공통. 위에서 모은 신호를 2축 매트릭스에 넣는다.
      // 실체(펀더멘털)와 기대(밴드 분위)를 조합해 ①~⑤·쇠퇴·턴어라운드를 찍는다.
      try {
        stageSig.segmentsAdded = segCounts.added;
        stageSig.segmentsDropped = segCounts.dropped;
        const stageMarket: "KR" | "US" = isKoreanTicker(analysis.ticker) ? "KR" : "US";
        // 기대 축: PER·PBR을 업종 밴드 분위(0~100)로 환산
        const master = await pool
          .query<{ per: number | null; pbr: number | null; industry: string | null; kis_industry: string | null }>(
            `SELECT per, pbr, industry, kis_industry FROM stocks WHERE ticker = $1 LIMIT 1`,
            [analysis.ticker])
          .then(r => r.rows[0] ?? null).catch(() => null);
        if (master) {
          const sec = classifySector(master.industry ?? analysis.industry ?? "", stageMarket, master.kis_industry);
          const band = await getSectorBand(sec).catch(() => null);
          stageSig.valuationPercentile = expectationPercentile(
            percentileAgainst(master.per, band?.per ?? null),
            percentileAgainst(master.pbr, band?.pbr ?? null),
          );
        }
        stageSig.priorSubstanceScore = await getPriorStageScore(analysis.ticker);
        const verdict = classifyStage(stageSig);
        dartBlocks.push(renderStageVerdict(verdict));
        await saveStageVerdict(analysis.ticker, verdict, (analysis as any).id ?? null);
        console.log(`[dart_report_analysis] 국면 판정(${stageMarket}): ${verdict.meta.labelKo} (실체 ${verdict.substance.score}, 신뢰도 ${verdict.confidence})`);
      } catch (e) {
        console.warn("[dart_report_analysis] 국면 판정 실패:", (e as Error)?.message?.slice(0, 80));
      }

      // 국면 흐름 — 저장된 다년치 재무를 연도별로 훑어 실체 궤적 + 주요 전환점을 뽑는다.
      // "현재 국면"만이 아니라 "과거부터 어떻게 흘러왔나"를 LLM에 준다(행간 읽기의 뼈대).
      try {
        const traj = renderTrajectory(await computeStageTrajectory(analysis.ticker));
        if (traj) { dartBlocks.push(traj); console.log(`[dart_report_analysis] 국면 흐름 주입`); }
      } catch (e) {
        console.warn("[dart_report_analysis] 국면 흐름 실패:", (e as Error)?.message?.slice(0, 80));
      }

      const dartContext = dartBlocks.join("\n\n");
      const injected = `\n\n${dartContext}`;
      enrichedContext = enrichedContext ? enrichedContext + injected : injected;
      console.log(`[dart_report_analysis] 컨텍스트 주입 완료 — ${dartContext.length}chars`);
    } catch (err) {
      console.error("[dart_report_analysis] 컨텍스트 주입 실패:", (err as Error)?.message?.slice(0, 80));
    }
  }


  // ── 기술적 분석 전용: 주봉 이동평균(20주선·60주선) — 사전 수집 캐시 우선 사용 ──

  // 현재 단계 이전에 완료된 단계만 context로 전달 (순서 보장)
  const currentStepIndex = STEP_ORDER.indexOf(stepKey);
  const previousStepsForContext = existingSteps
    .filter((s) => STEP_ORDER.indexOf(s.stepKey as AgentKey) < currentStepIndex)
    .map((s) => ({
      stepKey: s.stepKey,
      agentName: s.agentName,
      content: s.content,
    }));

  const tickerMarket: "KR" | "US" = isKoreanTicker(analysis.ticker) ? "KR" : "US";

  // 종목 마스터에서 분류 근거와 수익성을 한 번에 꺼낸다.
  // · kis_industry: 야후 industry 단독 분류는 한국 종목에서 자주 틀린다(한화시스템 사례).
  // · opm: 바이오를 rNPV로 볼지 DCF로 볼지 가르는 기준. 파이프라인 가치가 전부인
  //   적자 임상기업이라야 rNPV가 맞는다 — 삼성바이오로직스(CDMO)·셀트리온(바이오시밀러)
  //   처럼 이미 이익을 내는 회사에 rNPV를 쓰면 현재 사업가치를 통째로 놓친다.
  const masterRow = await pool
    .query<{ industry: string | null; kis_industry: string | null; opm: number | null }>(
      `SELECT industry, kis_industry, opm FROM stocks WHERE ticker = $1 LIMIT 1`,
      [analysis.ticker],
    )
    .then(r => r.rows[0] ?? null)
    .catch(() => null);

  const sectorKey = classifySector(
    masterRow?.industry ?? analysis.industry ?? "",
    tickerMarket,
    masterRow?.kis_industry,
  );
  const sectorCalibration = await getCalibrationContext(sectorKey);

  const { systemPrompt, userPrompt } = buildPrompt(
    stepKey,
    analysis.ticker,
    analysis.companyName,
    analysis.industry,
    enrichedContext,
    previousStepsForContext,
    sectorCalibration,
    ((analysis as any).language ?? "ko") as "ko" | "en",
    (analysis as any).startPrice ?? null,
    { opm: masterRow?.opm ?? null }
  );

  /**
   * LLM repetition loop 방어 — 동일 구문이 연속 3회 이상 반복되면 첫 번째 이후 잘라냄
   * 패턴 길이 20~400자 범위에서 검사
   */
  function trimRepetitionLoop(text: string): string {
    if (text.length < 60) return text;
    const searchWindow = Math.min(text.length, 4000);
    const tail = text.slice(-searchWindow);
    for (let patLen = 20; patLen <= 400; patLen++) {
      if (tail.length < patLen * 3) break;
      const p1 = tail.slice(-patLen);
      const p2 = tail.slice(-patLen * 2, -patLen);
      const p3 = tail.slice(-patLen * 3, -patLen * 2);
      if (p1 === p2 && p2 === p3) {
        // 세 번 이상 연속 반복 감지 → 첫 반복 직후까지만 유지
        const cutAt = text.length - searchWindow + (tail.length - patLen * 3 + patLen);
        console.warn(`[repetition-guard] loop detected patLen=${patLen}, trimming ${text.length - cutAt} chars`);
        return text.slice(0, cutAt).trimEnd();
      }
    }
    return text;
  }

  let content = "";
  try {
    // 토큰 한도: company_analysis는 32k (긴 재무 테이블), 나머지는 8k
    const maxOutputTokens =
      stepKey === "company_analysis" ? 32768
      : 8192;

    // 일시적 오류(503 UNAVAILABLE, 타임아웃, 429 Rate Limit) 여부 판별
    const isTransient = (err: unknown) => {
      const msg = String(err);
      return (
        msg.includes("503") || msg.includes("UNAVAILABLE") ||
        msg.includes("timed out") || msg.includes("timeout") ||
        msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") ||
        msg.includes("quota") || msg.includes("rate")
      );
    };

    const MAX_ATTEMPTS = 4;
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          // 429 Rate Limit은 더 긴 대기 (30s, 60s, 90s) — 일반 오류는 3s, 6s, 9s
          const is429 = String(lastErr).includes("429") || String(lastErr).includes("RESOURCE_EXHAUSTED") || String(lastErr).includes("quota");
          const waitMs = is429 ? attempt * 30_000 : (attempt - 1) * 3_000;
          console.warn(`[${stepKey}] Retry ${attempt}/${MAX_ATTEMPTS} after ${waitMs}ms (is429=${is429})…`);
          onEvent?.({ t: "" }); // keep-alive
          await new Promise((r) => setTimeout(r, waitMs));
        }

        const stepTemperature = 0.15;

        // Gemini 세마포어 획득 후 스트림 소비 완료까지 유지
        await geminiSemaphore.acquire();
        try {
          const stream = await ai.models.generateContentStream({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
              systemInstruction: systemPrompt,
              maxOutputTokens,
              temperature: stepTemperature,
              topP: 0.9,
              thinkingConfig: { thinkingBudget: 0 },
            },
          });
          let lastFinishReason: string | undefined;
          let lastRepeatCheck = 0;
          for await (const chunk of stream) {
            const text = chunk.text ?? "";
            if (text) {
              content += text;
              onEvent?.({ t: text });
              if (content.length - lastRepeatCheck > 500) {
                lastRepeatCheck = content.length;
                const trimmed = trimRepetitionLoop(content);
                if (trimmed.length < content.length) {
                  content = trimmed;
                  console.warn(`[${stepKey}] repetition loop detected mid-stream — breaking`);
                  break;
                }
              }
            }
            const reason = chunk.candidates?.[0]?.finishReason;
            if (reason) lastFinishReason = reason;
          }
          content = trimRepetitionLoop(content);

          if (lastFinishReason === "MAX_TOKENS") {
            console.warn(`[${stepKey}] 응답이 MAX_TOKENS(${maxOutputTokens})로 잘림`);

          }
          console.log(`[${stepKey}] streamed length: ${content.length}, finishReason: ${lastFinishReason}, attempt: ${attempt}`);
        } finally {
          geminiSemaphore.release();
        }

        if (!content) content = "분석 결과를 생성하지 못했습니다.";
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[${stepKey}] Gemini error (attempt ${attempt}):`, err);
        if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;
      }
    }

    if (lastErr) {
      content = `분석 오류: AI 서비스에 연결하지 못했습니다. (${stepKey})`;
      onEvent?.({ error: content });
    }

    // ── Devil's Advocate Debate (Round 2 → Round 3) ───────────────────────────
    if (DEBATE_STEPS.has(stepKey as AgentKey) && content && !content.startsWith("분석 오류")) {
      try {
        // Round 2: Challenger 반론 생성 (내부 처리 — 스트리밍 없음)
        onEvent?.({ debate: "challenging" });
        const challengerFeedback = await runDebateChallenge(
          stepKey as "company_analysis",
          content,
          analysis.companyName,
          analysis.ticker
        );

        if (challengerFeedback.trim()) {
          console.log(`[debate] ${stepKey} challenger feedback length: ${challengerFeedback.length}`);

          // Round 3: 애널리스트가 반론 수용·반박 후 최종본 확정 (스트리밍)
          onEvent?.({ debate: "synthesizing" });

          const isEnLang = (analysis as any).language === 'en';
          // Round 1 초안에서 핵심 섹션만 추출 (입력 토큰 절감: 전체 초안 대신 앞 4000자만 전달)
          const draftExcerpt = content.slice(0, 4000) + (content.length > 4000 ? "\n...[중략 — 상세 테이블 생략]...\n" + content.slice(-2000) : "");

          // ── Round 1 목표주가 앵커 추출 (synthesis 제약용) ──────────────────
          let round1BaseAnchor: number | null = null;
          const fvdR1 = extractFvdJson(content);
          if (fvdR1) {
            const r1base = parseFloat(String(fvdR1.base ?? fvdR1.target ?? fvdR1.target_price ?? "0").replace(/[^0-9.]/g, ""));
            if (!isNaN(r1base) && r1base > 0) round1BaseAnchor = r1base;
          }
          const anchorConstraintKo = round1BaseAnchor
            ? `\n⚠️ 목표주가 안정성 원칙: Round 1 초안의 적정주가는 ${round1BaseAnchor.toLocaleString()}원입니다. 반론을 반영하더라도 최종 FINAL_VALUATION_DATA의 base 값은 이 수치 대비 ±25% 이내(${Math.round(round1BaseAnchor * 0.75).toLocaleString()}~${Math.round(round1BaseAnchor * 1.25).toLocaleString()}원)에서 조정하세요. 이 범위를 벗어나는 수정은 허용되지 않습니다.`
            : `\n⚠️ 목표주가 안정성 원칙: 반론을 반영하더라도 최종 적정주가(base)는 Round 1 초안 대비 ±25% 이내에서 조정하세요.`;
          const anchorConstraintEn = round1BaseAnchor
            ? `\n⚠️ Target Price Stability: Round 1 base target was ${round1BaseAnchor.toLocaleString()}. The final FINAL_VALUATION_DATA base value must stay within ±25% of this (${Math.round(round1BaseAnchor * 0.75).toLocaleString()}–${Math.round(round1BaseAnchor * 1.25).toLocaleString()}). Do not move the target beyond this range.`
            : `\n⚠️ Target Price Stability: The final base target price must stay within ±25% of the Round 1 draft target.`;

          const synthesisInstruction = isEnLang
            ? (stepKey === "company_analysis"
              ? `\n\n---\n[Round 1 Draft]\n${draftExcerpt}\n\n---\n[Devil's Advocate Feedback]\n${challengerFeedback}\n\n[Instruction] Incorporate valid criticisms with updated figures; rebut invalid ones with evidence. Write a complete, focused final report. Do not expose challenge items as a separate section. Write ENTIRELY in English.`
              : `\n\n---\n[Round 1 Draft]\n${draftExcerpt}\n\n---\n[Valuation Skeptic Feedback]\n${challengerFeedback}\n\n[Instruction] Re-examine WACC, growth rate, and multiple assumptions. Update figures where criticism is valid; rebut where it is not. Write a complete valuation report with DCF/peer table and FINAL_VALUATION_DATA JSON. Write ENTIRELY in English.${anchorConstraintEn}`)
            : (stepKey === "company_analysis"
              ? `\n\n---\n[Round 1 초안]\n${draftExcerpt}\n\n---\n[Devil's Advocate 반론]\n${challengerFeedback}\n\n[지시] 타당한 지적은 수치·논거를 보완하여 반영하고, 동의하지 않는 부분은 구체적 근거로 반박하세요. 반론 항목을 별도 섹션으로 노출하지 말고 최종 완성본을 간결하게 작성하세요.`
              : `\n\n---\n[Round 1 초안]\n${draftExcerpt}\n\n---\n[Valuation Skeptic 반론]\n${challengerFeedback}\n\n[지시] WACC·성장률·멀티플 가정을 재점검하세요. 타당한 지적은 수치를 수정하여 반영, 동의하지 않으면 구체적 근거로 반박하세요. DCF 또는 피어 테이블과 FINAL_VALUATION_DATA JSON을 포함한 최종 밸류에이션 보고서를 간결하게 작성하세요.${anchorConstraintKo}`);

          const synthesisUserPrompt = userPrompt + synthesisInstruction;
          const synthesisMaxTokens = 8192; // 속도 최적화: 10k→8k (반론 반영 집중, 핵심만 수정)

          await geminiSemaphore.acquire();
          let synthesizedContent = "";
          try {
            const synthesisStream = await ai.models.generateContentStream({
              model: "gemini-2.5-flash",
              contents: [{ role: "user", parts: [{ text: synthesisUserPrompt }] }],
              config: {
                systemInstruction: systemPrompt,
                maxOutputTokens: synthesisMaxTokens,
                temperature: 0.12,
                topP: 0.85,
                thinkingConfig: { thinkingBudget: 0 },
              },
            });
            let synthRepeatCheck = 0;
            for await (const chunk of synthesisStream) {
              const text = chunk.text ?? "";
              if (text) {
                synthesizedContent += text;
                onEvent?.({ t: text, debateSynthesis: true });
                if (synthesizedContent.length - synthRepeatCheck > 500) {
                  synthRepeatCheck = synthesizedContent.length;
                  const trimmed = trimRepetitionLoop(synthesizedContent);
                  if (trimmed.length < synthesizedContent.length) {
                    synthesizedContent = trimmed;
                    console.warn(`[debate] repetition loop detected — breaking synthesis stream`);
                    break;
                  }
                }
              }
            }
          } finally {
            geminiSemaphore.release();
          }
          synthesizedContent = trimRepetitionLoop(synthesizedContent);
          if (synthesizedContent) {
            content = synthesizedContent;
            console.log(`[debate] ${stepKey} synthesis complete, length: ${content.length}`);
          }
        }
      } catch (debateErr) {
        console.error(`[debate] error (${stepKey}):`, debateErr);
        // 에러 시 Round 1 초안 그대로 사용
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Lead Portfolio Strategist QC ──────────────────────────────────────────
    let finalContent = content;
    let validationNotes: string | null = null;

    if (QC_STEPS.has(stepKey) && content && !content.startsWith("분석 오류")) {
      onEvent?.({ qc: "checking" });
      // DART 확정 분기 하한선 추출: enrichedContext에서 "수학적 하한선: X억원" 파싱
      let dartFloorAuk: number | null = null;
      if (stepKey === "company_analysis" && enrichedContext) {
        const floorMatch = enrichedContext.match(/수학적 하한선.*?합계\s*=\s*(\d+(?:\.\d+)?)억원/);
        if (floorMatch) {
          dartFloorAuk = parseFloat(floorMatch[1]);
          console.log(`[QC] DART floor extracted: ${dartFloorAuk}억원 for ${analysis.ticker}`);
        }
      }
      const qcResult = await runQCCheck(stepKey, content, analysis.companyName, analysis.ticker, dartFloorAuk, analysis.industry);
      console.log(`[QC] ${stepKey} score=${qcResult.score} approved=${qcResult.approved}`);

      if (!qcResult.approved) {
        onEvent?.({ qc: "revising", score: qcResult.score, feedback: qcResult.feedback });
        try {
          const revisedUserPrompt = userPrompt +
            ((analysis as any).language === 'en'
              ? `\n\n---\n[Lead Strategist Review — Mandatory Revision]\n${qcResult.feedback}\nAddress the above points clearly and rewrite the analysis to a higher standard of completeness. Write the ENTIRE revised report in English only.`
              : `\n\n---\n[팀장 재검토 지시 — 반드시 보완하세요]\n${qcResult.feedback}\n위 사항을 명확히 보완하여 더 완성도 높은 분석을 다시 작성하세요.`);
          const revisedMaxTokens = stepKey === "company_analysis" ? 32768 : 8192;
          await geminiSemaphore.acquire();
          let revisedContent = "";
          try {
            const revisedStream = await ai.models.generateContentStream({
              model: "gemini-2.5-flash",
              contents: [{ role: "user", parts: [{ text: revisedUserPrompt }] }],
              config: {
                systemInstruction: systemPrompt,
                maxOutputTokens: revisedMaxTokens,
                temperature: 0.1,
                topP: 0.85,
                thinkingConfig: { thinkingBudget: 0 },
              },
            });
            let revRepeatCheck = 0;
            for await (const chunk of revisedStream) {
              const text = chunk.text ?? "";
              if (text) {
                revisedContent += text;
                onEvent?.({ t: text, revised: true });
                if (revisedContent.length - revRepeatCheck > 500) {
                  revRepeatCheck = revisedContent.length;
                  const trimmed = trimRepetitionLoop(revisedContent);
                  if (trimmed.length < revisedContent.length) {
                    revisedContent = trimmed;
                    console.warn(`[QC] repetition loop detected — breaking revised stream`);
                    break;
                  }
                }
              }
            }
          } finally {
            geminiSemaphore.release();
          }
          revisedContent = trimRepetitionLoop(revisedContent);
          if (revisedContent) finalContent = revisedContent;
          validationNotes = `팀장 재검토 완료 (초기 점수: ${qcResult.score}/10, 사유: ${qcResult.feedback})`;
          onEvent?.({ qc: "revised", score: qcResult.score });
        } catch (err) {
          console.error("[QC] revision error:", err);
          validationNotes = `QC 완료 (점수: ${qcResult.score}/10)`;
          onEvent?.({ qc: "approved", score: qcResult.score });
        }
      } else {
        validationNotes = `팀장 검토 통과 (점수: ${qcResult.score}/10)`;
        onEvent?.({ qc: "approved", score: qcResult.score });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const stepRows = await rawQuery(
      `INSERT INTO analysis_steps (analysis_id, step_key, agent_name, agent_role, content, validation_notes, information_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, stepKey, agent.name, agent.role, finalContent, validationNotes, "data_based_estimate"]
    );
    const step = stepRows[0] ? mapStepRow(stepRows[0]) : null;


    const nextStepIndex = STEP_ORDER.indexOf(stepKey) + 1;
    const nextStep = nextStepIndex < STEP_ORDER.length ? STEP_ORDER[nextStepIndex] : null;
    // 실제 마지막 스텝(checklist)에서만 completed 처리 — investment_strategy를 isLast로 쓰면
    // 이후 investment_thesis · checklist 가 파이프라인 루프에서 실행 안 됨
    const isLast = stepKey === STEP_ORDER[STEP_ORDER.length - 1];

    if (isLast) {
      // investment_strategy는 이제 마크다운 산문 — JSON 파싱 불필요
      // DB의 investment_verdict, target_price 등은 새 분석에선 null로 유지
      await rawQuery(
        `UPDATE analyses SET status='completed', investment_verdict=NULL,
         target_price=NULL, entry_price=NULL, stop_loss=NULL,
         updated_at=NOW(), completed_at=NOW() WHERE id=$1`,
        [id]
      );

      // ── 토큰 비용 추정 저장 ────────────────────────────────────────────────
      try {
        const stepRows = await rawQuery(
          `SELECT content FROM analysis_steps WHERE analysis_id = $1`,
          [id]
        );
        const totalChars = stepRows.reduce((sum: number, r: any) => sum + (r.content?.length ?? 0), 0);
        // 1 토큰 ≈ 3.5 chars (한국어+영어 혼합)
        const estimatedTokens = Math.round(totalChars / 3.5);
        // Gemini 2.5 Flash: ~$0.15/1M tokens (입출력 평균)
        const estimatedCostUsd = (estimatedTokens / 1_000_000) * 0.15;
        await rawQuery(
          `UPDATE analyses SET token_count=$1, estimated_cost_usd=$2 WHERE id=$3`,
          [estimatedTokens, Math.round(estimatedCostUsd * 10000) / 10000, id]
        );
      } catch (e) {
        console.error("[token-tracking] 오류:", e);
      }

      triggerModelReview().catch(console.error);

      // ── DART 시계열 재무 데이터 백그라운드 수집 (한국 종목만) ─────────────────
      // 분석 완료 후 비동기로 실행 — 다음 분석 시 풍부한 시계열 컨텍스트 제공
      (async () => {
        try {
          const krxMatch = analysis.ticker?.match(/^(\d{6})/);
          if (krxMatch) {
            console.log(`[dart-store] ${krxMatch[1]} 백그라운드 수집 시작`);
            await fetchAndStoreDartQuarterly(krxMatch[1]);
          }
        } catch (e) {
          console.error("[dart-store] 백그라운드 수집 오류:", e);
        }
      })();

      // ── QA 채점 + 피어 검증 + 보정메모 (백그라운드 순차 실행) ─────────────
      // 순서: ① 피어검증 & QA 병렬 → ② 둘 다 완료 후 보정메모 생성
      (async () => {
        try {
          // 필요한 컬럼 추가 — 서버 기동 후 최초 1회만 실행 (pool 낭비 방지)
          await ensureQaPeerColumns();

          // ① 피어 검증 + QA 채점 데이터 로드 병렬 실행
          const [pvRes, aRes, sRes] = await Promise.all([
            // 피어 검증
            pool.query(`SELECT ticker, industry FROM analyses WHERE id = $1`, [id])
              .then(async (aInfo) => {
                if (!aInfo.rows[0]) return null;
                const { ticker: aTicker, industry: aIndustry } = aInfo.rows[0];
                const pvResult = await validatePeers(aTicker, aIndustry ?? null);
                if (pvResult.issues.length > 0 || pvResult.totalPeerCount > 0) {
                  await pool.query(`UPDATE analyses SET peer_flags=$1 WHERE id=$2`, [JSON.stringify(pvResult), id]);
                  if (pvResult.hasIssues) {
                    console.warn(`[peer-validator] #${id} ${aTicker} — ${pvResult.issues.length}개 이상 감지:`, pvResult.issues.map((i: any) => i.type).join(", "));
                  } else {
                    console.log(`[peer-validator] #${id} ${aTicker} — 이상 없음 (유효 피어 ${pvResult.validPeerCount}개)`);
                  }
                }
                return pvResult;
              })
              .catch((e) => { console.error(`[peer-validator] #${id} 검증 실패:`, e); return null; }),
            // QA 채점용 데이터 로드
            pool.query(`SELECT investment_verdict, target_price, entry_price, stop_loss, risk_reward_ratio FROM analyses WHERE id = $1`, [id]),
            pool.query(`SELECT step_key, content FROM analysis_steps WHERE analysis_id = $1`, [id]),
          ]);

          // ② QA 채점 (피어 검증과 병렬로 데이터 로드 완료 후)
          let qaResult: ReturnType<typeof runQACheck> | null = null;
          if (aRes.rows[0]) {
            const a = aRes.rows[0];
            qaResult = runQACheck({
              investmentVerdict: a.investment_verdict,
              targetPrice:       a.target_price,
              entryPrice:        a.entry_price,
              stopLoss:          a.stop_loss,
              riskRewardRatio:   a.risk_reward_ratio,
              steps: sRes.rows.map((r: any) => ({ stepKey: r.step_key, content: r.content ?? "" })),
            });
            await pool.query(`UPDATE analyses SET qa_score=$1, qa_flags=$2 WHERE id=$3`, [qaResult.score, JSON.stringify(qaResult.flags), id]);
            console.log(`[qa] #${id} 자동 채점 완료: ${qaResult.score}점 (${qaResult.grade})`);
          }

        } catch (e) {
          console.error(`[qa+peer+calib] #${id} 백그라운드 처리 실패:`, e);
        }
      })();

    } else if (nextStep) {
      await rawQuery(
        `UPDATE analyses SET current_step=$1, updated_at=NOW() WHERE id=$2`,
        [nextStep, id]
      );
    }

    // executeStep 반환값: 다음 단계 키 (또는 마지막 단계이면 null)
    return nextStep as AgentKey | null;
  } catch (err) {
    console.error(`[executeStep] Error in step ${stepKey} for analysis ${id}:`, err);
    return null;
  }
}

// ─── 백그라운드 파이프라인 러너 ──────────────────────────────────────────────
// 클라이언트 연결 없이 서버에서 모든 남은 단계를 순서대로 완주한다.
async function runPipelineBackground(id: number): Promise<void> {
  if (runningPipelineIds.has(id)) {
    console.log(`[pipeline-bg] Already running for analysis ${id} — skip`);
    return;
  }
  // 백그라운드 데이터 수집이 아직 진행 중이면 완료될 때까지 최대 60초 대기
  if (pendingDataFetch.has(id)) {
    console.log(`[pipeline-bg] Analysis ${id} 데이터 수집 진행 중 — 완료 대기...`);
    let waited = 0;
    while (pendingDataFetch.has(id) && waited < 60_000) {
      await new Promise(resolve => setTimeout(resolve, 500));
      waited += 500;
    }
    if (pendingDataFetch.has(id)) {
      console.warn(`[pipeline-bg] Analysis ${id} 데이터 수집 타임아웃 — 파이프라인 중단`);
      return;
    }
    console.log(`[pipeline-bg] Analysis ${id} 데이터 수집 완료 — 파이프라인 시작`);
  }
  runningPipelineIds.add(id);
  console.log(`[pipeline-bg] Starting background pipeline for analysis ${id}`);

  // 파이프라인 전체에서 공유할 컨텍스트를 1회만 pre-fetch (스텝별 중복 DB 조회 방지)
  let sharedCtx: PipelineCtx = { tickerNote: null, regimeNote: null, sectorNote: null };
  try {
    const firstRows = await rawQuery(`SELECT * FROM analyses WHERE id = $1 LIMIT 1`, [id]);
    const firstAnalysis = firstRows[0] ? mapAnalysisRow(firstRows[0]) : null;
    if (firstAnalysis) {
      const isKrw = /^\d{6}$/.test(firstAnalysis.ticker);
      const [noteRows, regimeNote, sectorNote] = await Promise.all([
        rawQuery(`SELECT memo FROM ticker_notes WHERE ticker = $1`, [firstAnalysis.ticker]),
        isKrw ? getLatestMarketRegime().catch(() => null) : Promise.resolve(null),
        isKrw ? getSectorLearningNote(firstAnalysis.ticker, firstAnalysis.industry ?? null).catch(() => null) : Promise.resolve(null),
      ]);
      sharedCtx = { tickerNote: noteRows[0] ?? null, regimeNote, sectorNote };
      console.log(`[pipeline-bg] Pre-fetched shared context for ${firstAnalysis.ticker} (regime=${!!regimeNote}, sector=${!!sectorNote})`);
    }
  } catch { /* context pre-fetch 실패해도 진행 */ }

  try {
    while (true) {
      const aRows = await rawQuery(`SELECT * FROM analyses WHERE id = $1 LIMIT 1`, [id]);
      const analysis = aRows[0] ? mapAnalysisRow(aRows[0]) : null;
      if (!analysis || analysis.status !== "in_progress") break;

      const stepsRaw = await rawQuery(`SELECT * FROM analysis_steps WHERE analysis_id = $1`, [id]);
      const existingSteps = [...stepsRaw.map(mapStepRow)].sort(
        (a, b) => STEP_ORDER.indexOf(a.stepKey as AgentKey) - STEP_ORDER.indexOf(b.stepKey as AgentKey)
      );
      const completedKeys = new Set(existingSteps.map(s => s.stepKey));
      const nextStepKey = STEP_ORDER.find(s => !completedKeys.has(s)) as AgentKey | undefined;
      if (!nextStepKey) break;

      const lockKey = `${id}-${nextStepKey}`;
      if (runningStepsLock.get(lockKey)) {
        // 이미 SSE 핸들러가 이 단계를 실행 중 — 잠시 기다린 후 재확인
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      runningStepsLock.set(lockKey, true);
      try {
        await executeStep(id, nextStepKey, analysis, existingSteps, undefined, sharedCtx);
      } finally {
        runningStepsLock.delete(lockKey);
      }
    }
  } catch (err) {
    console.error(`[pipeline-bg] Error for analysis ${id}:`, err);
  } finally {
    runningPipelineIds.delete(id);
    console.log(`[pipeline-bg] Background pipeline complete for analysis ${id}`);

    // 집단지성: 분석 완료 시 해당 종목을 포트폴리오에 담은 모든 유저의 브리핑 갱신
    try {
      const { rows } = await pool.query(
        `SELECT ticker, user_id FROM analyses WHERE id = $1 LIMIT 1`, [id]
      );
      if (rows[0]?.ticker) {
        refreshBriefForTicker(rows[0].ticker).catch(console.error);
        console.log(`[pipeline-bg] ${rows[0].ticker} 포트폴리오 브리핑 갱신 트리거`);

        // 모든 완료 분석에 30초 후 AI 자체 검수 실행
        scheduleAnalysisSelfReview(id);
        console.log(`[pipeline-bg] analysis#${id} 자체 검수 스케줄 등록 (30초 후)`);

      }
    } catch {}
  }
}

// ─── 서버 시작 시 미완료 분석 복구 ────────────────────────────────────────────
export async function resumeInProgressAnalyses(): Promise<void> {
  try {
    const rows = await rawQuery(
      `SELECT id FROM analyses WHERE status = 'in_progress' ORDER BY updated_at ASC LIMIT 10`
    );
    if (rows.length === 0) {
      console.log("[STARTUP] 미완료 분석 없음 — 복구 불필요");
      return;
    }
    console.log(`[STARTUP] 미완료 분석 ${rows.length}개 발견 — 백그라운드 재개`);
    for (const row of rows) {
      // 각 분석 사이 2초 딜레이로 thundering herd 방지
      await new Promise(resolve => setTimeout(resolve, 2000));
      enqueueAnalysis(row.id).catch(err =>
        console.error(`[STARTUP] analysis ${row.id} 재개 실패:`, err?.message)
      );
    }
  } catch (err: any) {
    console.error("[STARTUP] resumeInProgressAnalyses 오류:", err?.message);
  }
}

export { runningStepsLock, pendingDataFetch, preFetchedPeerData, preFetchedWeeklyMA, MAX_CONCURRENT_PIPELINES, pipelineSemaphore, MAX_QUEUE_SIZE, enqueueAnalysis, runningPipelineIds, executeStep, runPipelineBackground };
export type { PipelineCtx };
