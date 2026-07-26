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
import { AGENTS, STEP_ORDER, buildPrompt, needsFinancialSector, type AgentKey } from "../ai-agents.js";
import { getCalibrationContext, classifySector } from "../../routes/performance.js";
import { triggerModelReview } from "../../routes/model-insights.js";
import { runQACheck } from "../qa-checker.js";
import { getDartHistoricalContext, fetchAndStoreDartQuarterly, getDartAnchorNumerics, type DartAnchorNumerics } from "../dart-store.js";
import { fetchDartBusinessContent, fetchDartCompetitorSection, fetchDartOrderBacklog } from "../dart-business-content.js";
import { fetchSECEdgarContent } from "../sec-edgar-content.js";
import { fetchKOSISData, buildKOSISContext } from "../kosis-client.js";
import { buildSOTPSubsidiaryContext, hasSOTPSubsidiaryData } from "../sotp-subsidiary-context.js";
import { getLatestMarketRegime } from "../market-regime-updater.js";
import { getSectorLearningNote } from "../sector-learning.js";
import { buildSectorBandBlock } from "../valuation/sector-bands.js";
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

  // relative_valuation 시작 → market_analysis용 주봉 MA를 백그라운드에서 미리 수집
  if (stepKey === "relative_valuation" && !preFetchedWeeklyMA.has(id)) {
    const snapTicker = analysis.ticker;
    const wkPromise: Promise<string> = (async () => {
      try {
        const wkStart = new Date();
        wkStart.setFullYear(wkStart.getFullYear() - 2);
        const wkHistory = await yahooFinance
          .historical(snapTicker, { period1: wkStart.toISOString().slice(0, 10), interval: "1wk" }, { validateResult: false })
          .catch(() => null);
        if (!wkHistory || wkHistory.length < 20) return "";
        const closes = wkHistory.map((q: any) => q.adjClose ?? q.close).filter((c: any) => c != null && c > 0) as number[];
        const calcMA = (arr: number[], n: number) => arr.length < n ? null : arr.slice(-n).reduce((a: number, b: number) => a + b, 0) / n;
        const ma20w = calcMA(closes, 20);
        const ma60w = calcMA(closes, 60);
        const latestClose = closes[closes.length - 1];
        const lines = ["\n[📊 주봉 이동평균 데이터 (서버 계산)]"];
        lines.push(`현재가(최근 주봉 종가): ${latestClose?.toLocaleString()}원`);
        if (ma20w != null) {
          const d = ((latestClose - ma20w) / ma20w * 100).toFixed(1);
          lines.push(`20주 이동평균(20주선): ${Math.round(ma20w).toLocaleString()}원 (현재가 대비 ${parseFloat(d) >= 0 ? "+" : ""}${d}%)`);
        }
        if (ma60w != null) {
          const d = ((latestClose - ma60w) / ma60w * 100).toFixed(1);
          lines.push(`60주 이동평균(60주선): ${Math.round(ma60w).toLocaleString()}원 (현재가 대비 ${parseFloat(d) >= 0 ? "+" : ""}${d}%)`);
        }
        if (ma20w != null && ma60w != null) {
          lines.push(`주봉 추세 판단: 현재가가 20주선 ${latestClose > ma20w ? "위" : "아래"}, 60주선 ${latestClose > ma60w ? "위" : "아래"} — ${latestClose > ma20w && latestClose > ma60w ? "중기 상승 추세" : latestClose < ma20w && latestClose < ma60w ? "중기 하락 추세" : "혼조"}`);
        }
        lines.push(`(데이터 기준: 최근 ${closes.length}주 주봉 종가 기반 계산)`);
        console.log(`[pre-fetch-wkma] #${id} 완료 — ma20=${ma20w?.toFixed(0)}, ma60=${ma60w?.toFixed(0)}`);
        return lines.join("\n");
      } catch (err: any) {
        console.warn(`[pre-fetch-wkma] #${id} 실패:`, err?.message?.slice(0, 80));
        return "";
      }
    })();
    preFetchedWeeklyMA.set(id, wkPromise);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── 소프트 앵커: 동일 종목 직전 분석 결과를 참고 ────────────────────────────
  // 밸류에이션 단계는 더 긴 스니펫 + 더 강한 일관성 지시 사용
  const isValuationStep = ["intrinsic_valuation", "relative_valuation"].includes(stepKey);
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
      const snippetLen = isValuationStep ? 900 : 400;
      const snippet = prevContent.slice(0, snippetLen).replace(/\n+/g, " ").trim();
      const binding = isValuationStep
        ? `⚠️ 밸류에이션 일관성 원칙: 아래 직전 분석 내용을 참고하여 동일한 모델 구조·할인율·핵심 가정을 유지하세요. 새로운 중요 정보(임상 결과, 대형 파트너십, 어닝 서프라이즈 등)가 없는 한, 이번 분석에서 도출되는 적정주가 Base 값은 직전 분석 대비 ±20% 이내를 목표로 하세요.`
        : `아래는 가장 최근 분석의 이 단계 요약입니다. 방향성 참고 후 독자적 판단으로 분석하세요.`;
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
    // 실패해도 분析 진행
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
      // 실패해도 분析 진행
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
          company_analysis:     "이 기업 재무 수치(매출·영업이익·순이익·EPS·마진율·ROE·FCF) 과거 이력·전망, 재무 건전성(부채비율·순현금), 실적 드라이버",
          intrinsic_valuation:  "절대가치 밸류에이션(DCF·rNPV·SOTP·DDM) 계산, 적정주가 밴드 산출",
          relative_valuation:   "피어 멀티플(EV/EBITDA·PER·PBR·EV/GWh 등) 비교, 최종 목표주가 결론",
          market_analysis:      "기술적 분析(지지선·저항선·이동평균·모멘텀), 최적 진입·손절 구간",
          investment_strategy:  "최종 투자 판정, 포지션 전략, 시나리오별 목표가·수익률",
        };
        const STEP_LABEL: Record<string, string> = {
          company_intro: "팀장 브리핑",
          industry_analysis: "산업 분析",
          catalyst_analysis: "투자 촉매",
          company_analysis: "기업 재무 분析",
          intrinsic_valuation: "절대가치 밸류에이션",
          relative_valuation: "상대가치 밸류에이션",
          market_analysis: "기술적 분析",
          investment_strategy: "투자 전략",
        };
        const completedLines = existingSteps
          .filter(s => STEP_OWNERSHIP[s.stepKey])
          .map(s => `- [${STEP_LABEL[s.stepKey] ?? s.stepKey}] 이미 다룬 영역: ${STEP_OWNERSHIP[s.stepKey]}`)
          .join("\n");
        if (completedLines) {
          const dedupBlock = `\n\n[⛔ 중복 작성 금지 — 이미 완료된 단계에서 다룬 영역]\n`
            + `아래 영역은 각 담당 단계에서 이미 상세히 분析됨. 이 단계에서 같은 내용을 다시 설명하는 것은 금지됩니다.\n`
            + `꼭 필요한 경우(현재 단계 논리 전개에 필수적인 수치 1개 인용 등) 1문장 이내로만 참조하고, 재분析·재설명은 하지 마세요.\n\n`
            + completedLines;
          enrichedContext = enrichedContext ? enrichedContext + dedupBlock : dedupBlock;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── 투자 판정 일관성 앵커 (investment_strategy 전용) ────────────────────
      // ⚠️ 단, 아래 [서버 검증 목표주가] 블록이 주입되면 목표가·판정 제한은 해제됨
      if (stepKey === "investment_strategy") {
        const recentRow = await rawQuery(
          `SELECT investment_verdict, target_price, entry_price, created_at
           FROM analyses
           WHERE ticker = $1 AND status = 'completed' AND id != $2
             AND investment_verdict IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
          [analysis.ticker, analysis.id]
        );
        if (recentRow[0]) {
          const rec = recentRow[0];
          const daysAgo = Math.floor(
            (Date.now() - new Date(rec.created_at).getTime()) / (1000 * 3600 * 24)
          );
          const fmt = (n: number | null) => n == null ? "N/A" : n.toLocaleString();

          if (daysAgo <= 7) {
            const anchorBlock = `\n\n[\uD83D\uDD12 투자 판정 참고 앵커 — ${analysis.companyName}(${analysis.ticker}) ${daysAgo}일 전 분석]\n`
              + `  이전 판정: ${rec.investment_verdict} | 이전 목표가: ${fmt(rec.target_price)}원 | 이전 진입가: ${fmt(rec.entry_price)}원\n`
              + `📌 참고 지시:\n`
              + `- 아래 [서버 검증 목표주가]가 있으면 그 수치와 판정 방향을 최우선으로 따르세요. 이 앵커는 보조 참고용입니다.\n`
              + `- [서버 검증 목표주가]가 없는 경우에만: 명백한 시장 변화가 없는 한 동일 판정(${rec.investment_verdict})을 유지하세요.\n`
              + `- 판정을 바꿀 경우 "판정 변경 근거:" 항목을 별도 문단으로 명시하세요.`;
            enrichedContext = enrichedContext ? enrichedContext + anchorBlock : anchorBlock;
            console.log(`[verdict-anchor] 앵커 주입 — ${analysis.ticker} (${daysAgo}일 전: ${rec.investment_verdict})`);
          } else if (daysAgo <= 30) {
            const softBlock = `\n\n[📌 투자 판정 참고 앵커 — ${analysis.companyName}(${analysis.ticker}) ${daysAgo}일 전 분석]\n`
              + `  이전 판정: ${rec.investment_verdict} | 이전 목표가: ${fmt(rec.target_price)}원 | 이전 진입가: ${fmt(rec.entry_price)}원\n`
              + `- [서버 검증 목표주가]가 있는 경우 그 수치가 이 앵커보다 우선합니다.\n`
              + `- 위 판정과 다른 결론을 낼 경우 판정 섹션에 변경 이유를 반드시 명시하세요.`;
            enrichedContext = enrichedContext ? enrichedContext + softBlock : softBlock;
            console.log(`[verdict-anchor] 소프트 앵커 주입 — ${analysis.ticker} (${daysAgo}일 전: ${rec.investment_verdict})`);
          }
        }
      }

      // ── investment_strategy 전용: 검증된 목표주가 하드 주입 ─────────────────
      // ⚠️ 반드시 verdict-anchor 이후 실행 — AI 컨텍스트에서 마지막 지시가 최우선됨
      // relative_valuation FINAL_VALUATION_DATA 추출 → 클램핑 → 판정 방향까지 주입
      if (stepKey === "investment_strategy") {
        try {
          const rvStep = existingSteps.find(s => s.stepKey === "relative_valuation");
          const rvContent = rvStep?.content ?? "";
          // bracket-counting 파서로 중첩 JSON 안전 추출 (regex 방식 제거)
          const fvd = extractFvdJson(rvContent);
          if (fvd) {
            // investment_strategy 프롬프트 1순위와 동일하게 'base' 필드를 우선 읽음
            // (AI가 {target: X, base: Y} 형태로 출력 시 investment_strategy는 base=Y를 쓰는데
            // tp-inject가 target=X를 읽으면 불일치 발생 → base 우선으로 통일)
            let rawTp = parseFloat(String(fvd.base ?? fvd.target ?? fvd.target_price ?? "0").replace(/[^0-9.]/g, ""));
            const spRow = await rawQuery(`SELECT start_price, ticker, company_name, industry FROM analyses WHERE id=$1`, [id]);
            const sp: number = spRow[0]?.start_price ?? 0;
            const tkr: string = spRow[0]?.ticker ?? "";
            const isKRtk = /^\d{6}$/.test(tkr);
            const spCompany: string = spRow[0]?.company_name ?? "";
            const spIndustry: string = spRow[0]?.industry ?? "";
            const isFinancialTk = isKRtk && needsFinancialSector(spIndustry, spCompany, tkr);

            // 중앙값 클램핑 제거: AI 결론 본문과 DB 저장값 불일치 원인
            // 상한 캡도 제거(DB 저장 로직과 일치): 하한 플로어만 유지
            const originalTp = rawTp;
            const medianCorrected = false;

            if (rawTp > 0 && sp > 0) {
              // 금융주(은행·보험·증권·금융지주)는 P/B-ROE 모델 → PBR 0.55x~1.8x 범위로 제한
              // 일반 한국주: 0.45x~3.0x / 미국주: 0.25x~5.0x
              const MIN_R = isFinancialTk ? 0.55 : (isKRtk ? 0.45 : 0.25);
              const MAX_R = isFinancialTk ? 1.8  : (isKRtk ? 3.0  : 5.0);
              if (isFinancialTk) console.log(`[tp-inject] 금융주 감지(${tkr} ${spCompany}) — 클램핑 ${MIN_R}x~${MAX_R}x 적용`);
              const ratio = rawTp / sp;
              const validated = ratio < MIN_R ? Math.round(sp * MIN_R)
                             : ratio > MAX_R ? Math.round(sp * MAX_R)
                             : Math.round(rawTp);
              // corrected = true if ANY adjustment occurred (median clamp OR floor clamp)
              const ratioCorrected = validated !== Math.round(rawTp);
              const corrected = ratioCorrected || medianCorrected;
              const valRatio = validated / sp;
              const impliedVerdict = valRatio >= 1.15 ? "매수(BUY/Strong Buy)"
                                   : valRatio >= 1.05 ? "매수(BUY)"
                                   : valRatio <= 0.88 ? "매도(SELL)"
                                   : "중립(HOLD)";
              const upPct = ((valRatio - 1) * 100).toFixed(1);
              const priceUnit = isKRtk ? "원" : "달러(USD)";
              const fmtTp = (n: number) => isKRtk ? `${n.toLocaleString()}원` : `$${n.toLocaleString()}`;
              const originalRatio = sp > 0 ? originalTp / sp : 1;
              const correctionNote = medianCorrected
                ? `※ 밸류에이션 섹션의 AI 산출값 ${fmtTp(Math.round(originalTp))}이 과거 분석 중앙값 대비 편차 과다로 ${fmtTp(validated)}으로 서버 보정됨. 최종 결론의 적정주가는 반드시 ${fmtTp(validated)}을 사용할 것. 밸류에이션 섹션 수치와 다를 수 있으나 이 지시를 따를 것.\n`
                : ratioCorrected
                  ? (originalRatio < 0.1
                      ? `⚠️ 재무 데이터 미확보 경고: AI가 산출한 적정주가 ${fmtTp(Math.round(originalTp))}(현재가의 ${(originalRatio * 100).toFixed(1)}%)는 DART 재무 데이터 부재로 인한 오산출로 판단됨. 서버가 하한선(현재가 × ${MIN_R})인 ${fmtTp(validated)}으로 기계적 보정. 이 목표주가는 AI 밸류에이션이 아닌 최소 안전값이므로 실제 적정주가 도출을 위해 반드시 재무제표 기반 DCF/멀티플 분석을 수행할 것.\n`
                      : `※ AI 원산출값 ${fmtTp(Math.round(originalTp))}이 하한선(현재가 대비 ${MIN_R}x) 미만으로 ${fmtTp(validated)}으로 자동 보정됨\n`)
                  : "";
              const tpBlock = `\n\n[⛔ 밸류에이션 확정 목표주가 — 보고서 전체 일관성 필수]\n`
                + `현재가(분석 시작 기준): ${fmtTp(sp)}\n`
                + `밸류에이션 산출 목표주가(12M Base): **${fmtTp(validated)}** (현재가 대비 ${Number(upPct) >= 0 ? "+" : ""}${upPct}%)\n`
                + correctionNote
                + `\n⛔ 보고서 전체 일관성 규칙 (위반 금지):\n`
                + `1. 이 목표주가는 위 밸류에이션 단계(FINAL_VALUATION_DATA)에서 산출된 값입니다.\n`
                + `2. 결론 본문 텍스트에도 반드시 이 수치(${fmtTp(validated)})를 사용하세요. 다른 숫자 사용 금지.\n`
                + `3. FINAL_JSON target_price = ${validated} (정수, 콤마 없이)\n`
                + `4. scenarios Base target_price = ${validated} — JSON 최상위 target_price와 반드시 동일\n`
                + `5. 권고 판정: **${impliedVerdict}** — 목표가/현재가 괴리율 ${Number(upPct) >= 0 ? "+" : ""}${upPct}% 기준\n`
                + `6. entry_price ≤ ${fmtTp(sp)} (현재가 이하), stop_loss = 현재가의 88~93% 수준\n`
                + `7. 시나리오 Base upside = (${validated} - 현재가) / 현재가 × 100 으로 재계산\n`
                + `8. 위의 [판정 일관성 앵커]의 판정·목표가 제한은 이 지시로 완전 해제됨`;
              enrichedContext = enrichedContext ? enrichedContext + tpBlock : tpBlock;
              console.log(`[tp-inject] ${tkr} validated=${validated} original=${Math.round(originalTp)} ratio=${valRatio.toFixed(2)}x verdict=${impliedVerdict} medianCorrected=${medianCorrected} ratioCorrected=${ratioCorrected}`);
            } else {
              console.log(`[tp-inject] ${id} — 조건 미충족: rawTp=${rawTp} sp=${sp}`);
            }
          } else {
            console.log(`[tp-inject] ${id} — FINAL_VALUATION_DATA 미탐지 (rvContent.length=${rvContent.length})`);
          }
        } catch (e) {
          console.warn("[tp-inject] failed:", e);
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── 밸류에이션 단계 적정주가 범위 앵커 ───────────────────────────────────
      // intrinsic_valuation / relative_valuation 단계에서 직전 분석의 목표가 기반
      // 수치 범위를 강하게 제한 → 동일 종목 반복 분석 시 결과 편차를 최소화
      if (isValuationStep) {
        try {
          const prevValRow = await rawQuery(
            `SELECT target_price, created_at, investment_verdict
             FROM analyses
             WHERE ticker = $1 AND status = 'completed' AND id != $2
               AND target_price IS NOT NULL
             ORDER BY created_at DESC LIMIT 1`,
            [analysis.ticker, id]
          );
          if (prevValRow[0]?.target_price) {
            const prevTarget = Number(prevValRow[0].target_price);
            const prevVerdict = prevValRow[0].investment_verdict ?? "N/A";
            const prevDate = new Date(prevValRow[0].created_at).toISOString().slice(0, 10);
            const lower = Math.round(prevTarget * 0.8).toLocaleString();
            const upper = Math.round(prevTarget * 1.2).toLocaleString();
            const valAnchorBlock = `\n\n[📌 밸류에이션 참고 앵커 — ${analysis.companyName}(${analysis.ticker}) ${prevDate} 기준]\n`
              + `직전 분석 적정주가(Base): ${prevTarget.toLocaleString()}원 | 판정: ${prevVerdict}\n`
              + `- 참고용입니다. 이번 분석의 독자적 판단이 우선합니다.\n`
              + `- 직전 분석과 크게 다른 결론이 나오면 그 이유(펀더멘털 변화, 가정 수정 등)를 밸류에이션 섹션에 한 문장으로 명시하세요.\n`
              + `- 할인율·성공확률·피크세일즈 등 핵심 가정을 바꾸는 경우에도 변경 이유를 명시하세요.`;
            enrichedContext = enrichedContext ? enrichedContext + valAnchorBlock : valAnchorBlock;
            console.log(`[val-anchor] ${stepKey} for ${analysis.ticker} — target range ${lower}~${upper}`);
          }
        } catch {
          // optional
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Feature 3: 섹터별 편향 보정 주입 (밸류에이션 단계) ──────────────────
      if (isValuationStep) {
        try {
          const sectorRows = await rawQuery(
            `SELECT
               COUNT(*) as sample_count,
               ROUND(AVG(price_return)::numeric, 1) as avg_return,
               ROUND((AVG(CASE WHEN direction_match = true THEN 1.0 ELSE 0.0 END) * 100)::numeric, 0) as direction_accuracy,
               ROUND(AVG(target_achievement_pct)::numeric, 0) as avg_target_pct,
               MODE() WITHIN GROUP (ORDER BY valuation_method) as top_method
             FROM model_insights
             WHERE industry = $1
               AND outcome != 'pending'
               AND price_return IS NOT NULL`,
            [analysis.industry]
          );
          const sr = sectorRows[0];
          const n = Number(sr?.sample_count ?? 0);
          if (n >= 3) {
            const avgRet = Number(sr.avg_return);
            const dirAcc = sr.direction_accuracy !== null ? Number(sr.direction_accuracy) : null;
            const avgTgtPct = sr.avg_target_pct !== null ? Number(sr.avg_target_pct) : null;
            const topMethod = sr.top_method ?? null;
            let calibBlock = `\n\n[🔬 AI 섹터 보정 데이터 — ${analysis.industry} 업종 (${n}건 누적)]\n`;
            calibBlock += `⚠️ 아래는 이 업종에서의 AI 모델 과거 성과입니다. 밸류에이션 산출 시 아래 편향을 반드시 보정하세요.\n`;
            calibBlock += `· 평균 수익률 편차: ${avgRet > 0 ? "+" : ""}${avgRet}%`;
            if (avgRet > 8) calibBlock += ` → AI가 이 업종에서 과도하게 낙관적. 목표주가를 보수적으로 하향 조정하세요.`;
            else if (avgRet < -8) calibBlock += ` → AI가 이 업종 하락을 과소평가. 리스크 프리미엄을 상향하세요.`;
            else calibBlock += ` → 비교적 중립적 성과.`;
            calibBlock += `\n`;
            if (dirAcc !== null) {
              calibBlock += `· 방향성 정확도: ${dirAcc}%`;
              if (dirAcc < 55) calibBlock += ` → 방향 예측 신뢰도 낮음. 상·하단 시나리오 가중치를 균등하게 설정하세요.`;
              calibBlock += `\n`;
            }
            if (avgTgtPct !== null) {
              calibBlock += `· 평균 목표주가 달성도: ${avgTgtPct}% (100%=완전달성)`;
              if (avgTgtPct < 50) calibBlock += ` → 목표주가 달성 빈도 낮음. 보수적으로 설정하세요.`;
              calibBlock += `\n`;
            }
            if (topMethod) calibBlock += `· 이 업종 최다 적용 밸류에이션 방법론: ${topMethod}\n`;
            enrichedContext = enrichedContext ? enrichedContext + calibBlock : calibBlock;
            console.log(`[sector-calib] ${analysis.industry} 업종 보정 주입 (${n}건)`);
          }
        } catch {
          // optional
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Feature 4: 종목별 누적 정확도 주입 (밸류에이션 + 상대가치 단계) ──────
      // 같은 종목을 2회 이상 분석한 경우, 과거 방향 정확도·목표달성도·수익률 편향을
      // 구조화하여 AI에 직접 주입 → 종목 특화 보정 효과
      if (isValuationStep || stepKey === "relative_valuation") {
        try {
          const tickerAccRows = await rawQuery(
            `SELECT direction_match, price_return, target_achievement_pct, outcome, days_elapsed, reviewed_at
             FROM model_insights
             WHERE ticker = $1
               AND outcome != 'pending'
             ORDER BY reviewed_at DESC
             LIMIT 10`,
            [analysis.ticker]
          );

          if (tickerAccRows.length >= 2) {
            const withDir = tickerAccRows.filter((r: any) => r.direction_match !== null);
            const dirCorrect = withDir.filter((r: any) => r.direction_match === true).length;
            const dirAcc = withDir.length > 0 ? Math.round(dirCorrect / withDir.length * 100) : null;

            const withAch = tickerAccRows.filter((r: any) => r.target_achievement_pct !== null);
            const avgAch = withAch.length > 0
              ? Math.round(withAch.reduce((s: number, r: any) => s + Number(r.target_achievement_pct), 0) / withAch.length)
              : null;

            const withRet = tickerAccRows.filter((r: any) => r.price_return !== null);
            const avgRet = withRet.length > 0
              ? Math.round(withRet.reduce((s: number, r: any) => s + Number(r.price_return), 0) / withRet.length * 10) / 10
              : null;

            let tickerAccBlock = `\n\n[🎯 이 종목(${analysis.ticker}) AI 예측 누적 성과 — ${tickerAccRows.length}건 분석 기록]\n`;
            tickerAccBlock += `⚠️ 이 종목에 대한 과거 AI 예측 성과입니다. 아래 편향을 반드시 이번 목표주가에 보정하세요.\n`;

            if (dirAcc !== null) {
              tickerAccBlock += `• 방향 예측 정확도: ${dirAcc}% (${withDir.length}건 기준)`;
              if (dirAcc < 45) tickerAccBlock += ` → ⛔ 방향 신뢰도 매우 낮음. 투자의견 단정 금지, 중립 + 조건부 논리만 사용`;
              else if (dirAcc < 60) tickerAccBlock += ` → ⚠️ 방향 신뢰도 보통. 상·하단 시나리오 가중치를 균등(50/50)으로 설정`;
              else tickerAccBlock += ` → ✓ 방향 예측 양호`;
              tickerAccBlock += `\n`;
            }

            if (avgAch !== null) {
              tickerAccBlock += `• 목표주가 달성도: 평균 ${avgAch}% (100%=완전달성, 음수=역방향)`;
              if (avgAch < 30) tickerAccBlock += ` → ⛔ 심각한 과대평가 경향. 이번 목표주가를 25~35% 하향 설정`;
              else if (avgAch < 55) tickerAccBlock += ` → ⚠️ 목표주가 과대평가 경향. 이번 목표주가를 10~20% 보수적으로 하향`;
              else if (avgAch < 80) tickerAccBlock += ` → ⚠️ 목표주가 달성 저조. 소폭(5~10%) 하향 권장`;
              else if (avgAch > 150) tickerAccBlock += ` → ✓ 과소평가 경향 있음. 목표주가 상향 가능`;
              tickerAccBlock += `\n`;
            }

            if (avgRet !== null) {
              const retStr = avgRet >= 0 ? `+${avgRet}` : `${avgRet}`;
              tickerAccBlock += `• 분석 이후 평균 실제 주가 수익률: ${retStr}% — 이 종목의 과거 실제 움직임 참고\n`;
            }

            // 최근 결과 요약 (2건)
            const recentSummary = tickerAccRows.slice(0, 2).map((r: any) => {
              const ret = r.price_return !== null ? `${Number(r.price_return) >= 0 ? "+" : ""}${Number(r.price_return).toFixed(1)}%` : "N/A";
              const dir = r.direction_match === true ? "방향✓" : r.direction_match === false ? "방향✗" : "";
              const days = r.days_elapsed ? `${r.days_elapsed}일` : "";
              return `  · ${days} 경과, 실제 ${ret}${dir ? " " + dir : ""}`;
            });
            if (recentSummary.length > 0) {
              tickerAccBlock += `• 최근 결과:\n${recentSummary.join("\n")}\n`;
            }

            enrichedContext = enrichedContext ? enrichedContext + tickerAccBlock : tickerAccBlock;
            console.log(`[ticker-acc] ${analysis.ticker} 누적 성과 주입 — ${tickerAccRows.length}건, 방향정확도 ${dirAcc ?? "N/A"}%, 달성도 ${avgAch ?? "N/A"}%`);
          }
        } catch {
          // optional — 오류 시 무시
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
  }

  // ── relative_valuation: 피어 데이터 자동 수집 ────────────────────────────
  if (stepKey === "relative_valuation") {
    try {
      onEvent?.({ t: "" }); // keep connection alive

      // 사전 수집 캐시 우선 사용 (company_analysis 실행 중 미리 수집한 결과)
      let peers: Array<{ ticker: string; name: string; exchange: string; reason?: string }> = [];
      let preFetchedData = "";
      const preFetchPromise = preFetchedPeerData.get(id);
      if (preFetchPromise) {
        preFetchedPeerData.delete(id); // 사용 후 즉시 cleanup
        const prefetch = await preFetchPromise;
        peers = prefetch.peers;
        preFetchedData = prefetch.data;
        console.log(`[peer-select] 사전 수집 결과 사용 — ${peers.length}개 피어`);
      }

      // 사전 수집 실패·미수집 시 폴백: 직접 수집
      if (peers.length === 0 && !preFetchedData) {
        const prevContext = existingSteps.map((s) => s.content).join("\n").slice(0, 5000);
        peers = await selectPeerTickers(analysis.companyName, analysis.industry, prevContext, analysis.ticker);
        console.log(`[peer-select] Selected ${peers.length} peers:`, peers.map((p) => p.ticker).join(", "));
        if (peers.length === 0) {
          console.warn("[peer-select] 1st attempt returned 0 peers — retrying with full context");
          const fullContext = existingSteps.map((s) => s.content).join("\n").slice(0, 3000);
          peers = await selectPeerTickers(analysis.companyName, analysis.industry ?? "바이오/제약", fullContext, analysis.ticker);
          console.log(`[peer-select] Retry selected ${peers.length} peers`);
        }
      }

      // 한국 주식: KRX 업종 PBR + DART 직접 경쟁사 병렬 조회
      const tickerKrxCode = normalizeTicker(analysis.ticker);
      const isKoreanTicker = /^\d{6}$/.test(tickerKrxCode);
      if (isKoreanTicker) {
        // 병렬 수집: KRX 업종 전체 + DART 명시 경쟁사
        const krxCacheKey  = `krx_peer_ctx:${tickerKrxCode}`;
        const dartCacheKey = `dart_peer_ctx:${tickerKrxCode}`;

        const [krxCtxRaw, dartCtxRaw] = await Promise.allSettled([
          (async () => {
            let ctx: string | null = cache.get<string>(krxCacheKey) ?? null;
            if (!ctx) { ctx = await getKRXSectorPeerContext(tickerKrxCode); if (ctx) cache.set(krxCacheKey, ctx, TTL.HOUR); }
            return ctx;
          })(),
          (async () => {
            let ctx: string | null = cache.get<string>(dartCacheKey) ?? null;
            if (!ctx) { ctx = await getDartCompetitorPeerContext(tickerKrxCode); if (ctx) cache.set(dartCacheKey, ctx, TTL.HOUR); }
            return ctx;
          })(),
        ]);

        const krxCtx  = krxCtxRaw.status  === "fulfilled" ? krxCtxRaw.value  : null;
        const dartCtx = dartCtxRaw.status === "fulfilled" ? dartCtxRaw.value : null;

        // DART 경쟁사 먼저 주입 (AI가 가장 먼저 읽도록) → KRX 업종 전체 이어 붙임
        if (dartCtx) {
          enrichedContext = enrichedContext ? enrichedContext + "\n\n" + dartCtx : dartCtx;
          console.log(`[dart-peer] Injected DART competitor peer context for ${tickerKrxCode}`);
        } else {
          console.log(`[dart-peer] No DART competitor data for ${tickerKrxCode}`);
        }
        if (krxCtx) {
          enrichedContext = enrichedContext ? enrichedContext + "\n\n" + krxCtx : krxCtx;
          console.log(`[krx-peer] Injected KRX sector PBR context for ${tickerKrxCode}`);
        } else {
          console.warn(`[krx-peer] No KRX data found for ${tickerKrxCode} — using hardcoded benchmark`);
        }
      }

      // ── 업종 실측 배수 밴드 주입 ──────────────────────────────────────────────
      // 예전에는 여기서 업종을 자체 정규식으로 다시 판정하고(ai-agents의 감지와
      // 완전히 별개였다) 손으로 적어둔 배수 범위를 붙였다. 세 가지가 문제였다.
      //
      // ① 판정이 엇갈렸다 — 삼성바이오로직스·셀트리온은 여기서 "rNPV 필수"를
      //    받는데 모델 선택기는 DCF를 배정했다.
      // ② 숫자가 서로를 위반했다 — 바이오 할인율이 여기선 "8~12%, 15% 초과 금지"
      //    인데 rNPV 모델은 "Phase 1 = 18% 고정"이었다.
      // ③ 무엇보다 숫자가 낡고 틀렸다 — isNewSpace 정규식이 'aerospace'만 보고
      //    한국 방산주에 "EV/Sales 20~60x(스페이스X 비교군)"를 지시했다. 한화시스템의
      //    실제 EV/Sales는 3.4x다. 20x만 적용해도 시총이 76조(실제 12.8조)가 된다.
      //    야후가 한국 방산을 스페이스X와 같은 칸에 넣은 것을 그대로 믿은 결과다.
      //
      // 이제 업종별 방법론은 lib/valuation의 모델 하나가 전담하고, 여기서는 그 모델이
      // 쓸 **오늘의 실측 배수**만 넘긴다. 숫자는 stocks 뷰에서 매일 다시 집계되므로
      // 낡지 않는다. 업종 판정도 KIS 분류를 함께 보는 classifySector 하나로 통일했다.
      {
        const guideLines: string[] = [];

        const bandBlock = await buildSectorBandBlock(
          tickerKrxCode,
          analysis.industry ?? "",
          isKoreanTicker ? "KR" : "US",
        );
        if (bandBlock) guideLines.push(bandBlock);

        guideLines.push(`\n[🎯 밸류에이션 공통 규칙]`);
        guideLines.push(`⚠️ 아래 규칙을 반드시 준수하세요. 위반 시 QC 불승인.`);
        guideLines.push(`· ⛔ 단위 오류 경고: 주당가치 = 총기업가치(원) ÷ 발행주식수(주). 발행주식수(주/천주)나 기업가치(원/억원/조원) 단위를 섞으면 목표가가 1/10~1/1000으로 오산됩니다.`);
        guideLines.push(`· ⛔ BPS 단위: 자본총계(원) ÷ 발행주식수(주) = BPS(원/주). 자본총계가 백만원 단위면 ×1,000,000 변환 후 계산하세요.`);
        guideLines.push(`· ⛔ 서버가 계산해 컨텍스트에 넣어준 BPS·순부채가 있으면 그 값을 우선 사용하세요. 직접 계산값이 서버값과 50% 이상 다르면 단위 오류를 의심하고 재계산하세요.`);
        guideLines.push(`· 목표주가가 현재가의 10% 미만으로 나오면 단위 오류(억원↔원 혼용) 가능성 — 즉시 재검토.`);
        guideLines.push(`· 피어 배수 선택 시 현재 시장 내재 멀티플(위 컨텍스트 참조)의 25% 미만 배수 사용 금지.`);
        guideLines.push(`· 최종 목표주가(Base)는 현재가의 30% 미만 산출 시 QC 불승인 — 가정 재검토 필수.`);
        guideLines.push(`\n⛔ 수치 일관성 필수 (위반 시 QC 불승인):`);
        guideLines.push(`· 본문 결론에 기재한 Base 목표주가(숫자)와 FINAL_VALUATION_DATA.base 값이 반드시 동일한 숫자여야 합니다.`);
        guideLines.push(`· 예: 본문에 "적정주가 350,000원"이라고 썼다면 FINAL_VALUATION_DATA.base = 350000. 두 값이 다르면 QC 불승인.`);

        const guideBlock = guideLines.join("\n");
        enrichedContext = enrichedContext ? enrichedContext + "\n" + guideBlock : guideBlock;
        console.log(`[model-guide] 공통 규칙 주입 (실측 밴드 ${bandBlock ? "포함" : "없음"})`);
      }

      // ── 테마 프리미엄 보정 (이전 스텝 텍스트에서 핫 테마 감지 → 멀티플 상향) ───────
      {
        const prevStepsText = existingSteps.map(s => (s.content ?? "")).join(" ").toLowerCase();
        const fullSignal = `${(analysis.companyName ?? "").toLowerCase()} ${(analysis.industry ?? "").toLowerCase()} ${prevStepsText.slice(0, 6000)}`;

        const hotThemes: { label: string; premiumPct: number; sotp: boolean }[] = [];

        if (/boston dynamics|보스턴다이나믹스|로보틱스|robotics|humanoid|인간형\s*로봇/.test(fullSignal)) {
          hotThemes.push({ label: "로보틱스/휴머노이드(보스턴다이나믹스)", premiumPct: 20, sotp: true });
        }
        if (/자율주행|autonomous driving|sdv|소프트웨어 정의 자동차|software.defined vehicle/.test(fullSignal)) {
          hotThemes.push({ label: "SDV/자율주행", premiumPct: 15, sotp: true });
        }
        if (/ai.반도체|ai chip|hbm|high bandwidth memory|ai 가속기|npu/.test(fullSignal)) {
          hotThemes.push({ label: "AI반도체/HBM", premiumPct: 25, sotp: false });
        }
        if (/k.방산|방위산업|방산수출|defense export|k.defense/.test(fullSignal)) {
          hotThemes.push({ label: "K-방산", premiumPct: 20, sotp: false });
        }
        if (/우주|space launch|발사체|위성통신|sat.?com|뉴스페이스/.test(fullSignal)) {
          hotThemes.push({ label: "우주항공/뉴스페이스", premiumPct: 30, sotp: true });
        }

        if (hotThemes.length > 0) {
          const needsSotp = hotThemes.some(t => t.sotp);
          const avgPremium = Math.round(hotThemes.reduce((s, t) => s + t.premiumPct, 0) / hotThemes.length);
          const themeLabels = hotThemes.map(t => t.label).join(", ");

          let themeBlock = `\n\n[🚀 테마 노출 감지: ${themeLabels}]\n`;
          themeBlock += `이 종목은 시장에서 고배수를 받는 테마에 노출됩니다. 상대가치 평가 시 아래를 적용하세요:\n`;
          themeBlock += `① ⛔ 업종 배수에 테마 프리미엄을 일괄 가산하지 마세요 — 이중 계상입니다.\n`;
          themeBlock += `   위에 제시된 '업종 실측 배수'는 오늘 시장 가격에서 뽑은 값이라, 업종 전체가\n`;
          themeBlock += `   이미 재평가됐다면 그 재평가가 밴드에 반영돼 있습니다(예: 한국 방산 PER 중앙값).\n`;
          themeBlock += `   여기에 다시 +${avgPremium}%를 얹으면 같은 프리미엄을 두 번 세는 셈입니다.\n`;
          themeBlock += `   이 종목이 **업종 평균보다 더** 테마에 노출됐다는 근거(매출 기여도·수주·고객사\n`;
          themeBlock += `   발표)를 정량으로 제시할 수 있을 때만, 밴드 중앙값 대신 상위25% 쪽을 쓰세요.\n`;
          if (needsSotp) {
            themeBlock += `② SOTP(Sum-of-the-Parts) 분석 권장:\n`;
            themeBlock += `   · [전통 사업부] 동종 피어 배수로 평가\n`;
            themeBlock += `   · [테마 사업부 — ${hotThemes.filter(t => t.sotp).map(t => t.label).join(", ")}] 성장주 EV/Sales 또는 프리미엄 EV/EBITDA로 별도 평가\n`;
            themeBlock += `   · 두 가치 합산 → 주당 SOTP 가치를 목표주가로 제시\n`;
          }
          themeBlock += `③ 피어 참고: 전통 섹터 피어 외에 테마 선도 기업을 보조 벤치마크로 추가\n`;
          themeBlock += `④ 테마 냉각(실적 미달·규제 리스크 현실화) 시 프리미엄 절반 이하로 축소`;

          enrichedContext = enrichedContext ? enrichedContext + "\n" + themeBlock : themeBlock;
          console.log(`[thematic-premium] 감지: ${themeLabels} | 평균 프리미엄: +${avgPremium}%`);
        }
      }

      // US 주식 전용: AI 선택 실패 시 하드코딩 피어 맵으로 대체
      if (peers.length === 0 && !isKoreanTicker) {
        const mappedPeers = US_PEER_MAP[analysis.ticker.toUpperCase()];
        if (mappedPeers?.length) {
          peers = mappedPeers;
          console.log(`[peer-select] Using hardcoded US peer map for ${analysis.ticker}: ${peers.map(p => p.ticker).join(", ")}`);
        }
      }

      // 사전 수집 데이터가 이미 있으면 그대로 주입, 없으면 직접 fetchPeerFinancials 호출
      if (preFetchedData) {
        enrichedContext = enrichedContext ? enrichedContext + preFetchedData : preFetchedData;
        console.log(`[peer-fetch] 사전 수집 데이터 주입 완료 (${preFetchedData.length}chars)`);
      } else if (peers.length > 0) {
        const peerData = await fetchPeerFinancials(peers);
        if (peerData) {
          enrichedContext = enrichedContext ? enrichedContext + peerData : peerData;
        }
      } else {
        // 피어 수집 완전 실패 시 — 수치 없이 구조만 유지하도록 지시 (추정 금지)
        const fallbackNote = `\n\n=== 피어 그룹 실시간 데이터 수집 실패 ===\n`
          + `Yahoo Finance에서 피어 기업 실시간 데이터를 가져오지 못했습니다.\n`
          + `⛔ 피어 비교 표에 수치를 AI가 임의로 채우거나 "(추정)" 표기를 사용하는 것을 엄격히 금지합니다.\n`
          + `대신 ${analysis.companyName}(${analysis.industry ?? "해당 업종"}) 업종 내 대표 경쟁사 4~5개의 이름만 나열하고,\n`
          + `모든 수치 셀은 "N/A (데이터 미수집)"으로 표기하세요. 피어 비교표는 구조만 유지하세요.\n`;
        enrichedContext = enrichedContext ? enrichedContext + fallbackNote : fallbackNote;
        console.warn("[peer-fetch] All peer attempts failed — injected no-estimate fallback note");
      }
    } catch (err) {
      console.error("[peer-fetch] Failed:", err);
    }
  }


  // ── 기술적 분析 전용: 주봉 이동평균(20주선·60주선) — 사전 수집 캐시 우선 사용 ──
  if (stepKey === "market_analysis") {
    try {
      const wkPromise = preFetchedWeeklyMA.get(id);
      let wkBlock = "";
      if (wkPromise) {
        preFetchedWeeklyMA.delete(id); // 사용 후 cleanup
        wkBlock = await wkPromise;
        if (wkBlock) console.log(`[weekly-ma] 사전 수집 데이터 주입 (${wkBlock.length}chars)`);
      }
      // 사전 수집 실패 시 폴백: 직접 계산
      if (!wkBlock) {
        const wkStart = new Date();
        wkStart.setFullYear(wkStart.getFullYear() - 2);
        const wkPeriod1 = wkStart.toISOString().slice(0, 10);
        const wkHistory = await yahooFinance
          .historical(analysis.ticker, { period1: wkPeriod1, interval: "1wk" }, { validateResult: false })
          .catch(() => null);
        if (wkHistory && wkHistory.length >= 20) {
          const closes = wkHistory
            .map((q: any) => (q as any).adjClose ?? (q as any).close)
            .filter((c: any) => c != null && c > 0) as number[];
          const calcMA = (arr: number[], period: number): number | null => {
            if (arr.length < period) return null;
            return arr.slice(-period).reduce((a, b) => a + b, 0) / period;
          };
          const ma20w = calcMA(closes, 20);
          const ma60w = calcMA(closes, 60);
          const latestClose = closes[closes.length - 1];
          const wkLines: string[] = ["\n[📊 주봉 이동평균 데이터 (서버 계산)]"];
          wkLines.push(`현재가(최근 주봉 종가): ${latestClose?.toLocaleString()}원`);
          if (ma20w != null) {
            const d = ((latestClose - ma20w) / ma20w * 100).toFixed(1);
            wkLines.push(`20주 이동평균(20주선): ${Math.round(ma20w).toLocaleString()}원 (현재가 대비 ${parseFloat(d) >= 0 ? "+" : ""}${d}%)`);
          }
          if (ma60w != null) {
            const d = ((latestClose - ma60w) / ma60w * 100).toFixed(1);
            wkLines.push(`60주 이동평균(60주선): ${Math.round(ma60w).toLocaleString()}원 (현재가 대비 ${parseFloat(d) >= 0 ? "+" : ""}${d}%)`);
          }
          if (ma20w != null && ma60w != null) {
            wkLines.push(`주봉 추세 판단: 현재가가 20주선 ${latestClose > ma20w ? "위" : "아래"}, 60주선 ${latestClose > ma60w ? "위" : "아래"} — ${latestClose > ma20w && latestClose > ma60w ? "중기 상승 추세" : latestClose < ma20w && latestClose < ma60w ? "중기 하락 추세" : "혼조"}`);
          }
          wkLines.push(`(데이터 기준: 최근 ${closes.length}주 주봉 종가 기반 계산)`);
          wkBlock = wkLines.join("\n");
          console.log(`[weekly-ma] 폴백 계산 완료 (${wkBlock.length}chars)`);
        } else {
          console.warn(`[weekly-ma] 주봉 데이터 부족 (${wkHistory?.length ?? 0}주) — 주봉 MA 주입 생략`);
        }
      }
      if (wkBlock) enrichedContext = enrichedContext ? enrichedContext + wkBlock : wkBlock;
    } catch (err: any) {
      console.warn("[weekly-ma] 주봉 MA 처리 실패:", err?.message?.slice(0, 80));
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

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
    analysis.startPrice ?? null,
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
    // 토큰 한도: company_analysis만 32k (긴 재무 테이블), relative_valuation은 10k (debate로 품질 보장, 속도 최적화)
    const maxOutputTokens =
      stepKey === "company_analysis" ? 32768
      : stepKey === "relative_valuation" ? 10240
      : 6144;

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

        // 밸류에이션 단계는 수치 일관성을 위해 더 낮은 temperature 사용
        const stepTemperature = isValuationStep ? 0.12 : 0.15;

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
            if (stepKey === "relative_valuation" && !content.includes("FINAL_VALUATION_DATA")) {
              try {
                console.log(`[${stepKey}] FINAL_VALUATION_DATA 누락 — 복구 시도`);
                const recoveryPrompt = (analysis as any).language === 'en'
                  ? `The valuation report below was truncated due to token limits. Based on the target price and bands presented in this report, generate ONLY the FINAL_VALUATION_DATA JSON block. Output the JSON block only — no explanation.\n\n[Truncated report tail]\n${content.slice(-3000)}`
                  : `아래는 밸류에이션 보고서가 토큰 한도로 잘린 내용입니다. 이 보고서에서 제시된 목표주가와 밴드를 기반으로 FINAL_VALUATION_DATA JSON 블록 하나만 생성하세요. 다른 설명 없이 JSON 블록만 출력하세요.\n\n[잘린 보고서 끝부분]\n${content.slice(-3000)}`;
                const recoveryResp = await ai.models.generateContent({
                  model: "gemini-2.5-flash",
                  contents: [{ role: "user", parts: [{ text: recoveryPrompt }] }],
                  config: { maxOutputTokens: 512, temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } },
                });
                const recoveryText = recoveryResp.text ?? "";
                if (recoveryText.includes("FINAL_VALUATION_DATA")) {
                  content = content + "\n\n" + recoveryText;
                  console.log(`[${stepKey}] FINAL_VALUATION_DATA 복구 성공`);
                }
              } catch (recoveryErr) {
                console.warn(`[${stepKey}] FINAL_VALUATION_DATA 복구 실패:`, recoveryErr);
              }
            }
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
          stepKey as "company_analysis" | "relative_valuation",
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
    let finalContent = stepKey === "investment_strategy"
      ? repairInvestmentStrategyContent(content)
      : content;
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
      const qcResult = await runQCCheck(stepKey, content, analysis.companyName, analysis.ticker, dartFloorAuk);
      console.log(`[QC] ${stepKey} score=${qcResult.score} approved=${qcResult.approved}`);

      if (!qcResult.approved) {
        onEvent?.({ qc: "revising", score: qcResult.score, feedback: qcResult.feedback });
        try {
          const revisedUserPrompt = userPrompt +
            ((analysis as any).language === 'en'
              ? `\n\n---\n[Lead Strategist Review — Mandatory Revision]\n${qcResult.feedback}\nAddress the above points clearly and rewrite the analysis to a higher standard of completeness. Write the ENTIRE revised report in English only.`
              : `\n\n---\n[팀장 재검토 지시 — 반드시 보완하세요]\n${qcResult.feedback}\n위 사항을 명확히 보완하여 더 완성도 높은 분석을 다시 작성하세요.`);
          const revisedMaxTokens = (stepKey === "company_analysis" || stepKey === "relative_valuation") ? 32768 : 6144;
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

    // 밸류에이션 근거 수치를 구조화해 보관한다.
    // 예전에는 이 단계 본문에서 목표가(base) 하나만 꺼내 쓰고 시나리오 밴드와
    // 절대·상대 평가, 부문별 실적 전망을 통째로 버렸다. 여기서 저장해 두면
    // 나중에 목표가 변화 추적과 "예상 vs 실제" 대조가 가능해진다.
    // 저장 실패가 분석을 막으면 안 되므로 예외는 삼킨다.
    if (stepKey === "relative_valuation") {
      storeValuationArtifacts(id, finalContent).catch((e) =>
        console.warn(`[valuation-store] #${id} 저장 실패:`, e?.message?.slice(0, 80))
      );
    }

    const nextStepIndex = STEP_ORDER.indexOf(stepKey) + 1;
    const nextStep = nextStepIndex < STEP_ORDER.length ? STEP_ORDER[nextStepIndex] : null;
    const isLast = stepKey === "investment_strategy";

    if (isLast) {
      let investmentVerdict: string | null = null;
      let targetPrice: number | null = null;
      let entryPrice: number | null = null;
      let stopLoss: number | null = null;
      let riskRewardRatio: number | null = null;

      const json = extractJsonSafe(content);
      let savedStartPrice: number | null = null;
      let savedTicker: string = "";
      try {
        if (!json) throw new Error("JSON parse failed");
        investmentVerdict = json.verdict ?? null;

        const parsePrice = (val: string | undefined) => {
          if (!val) return null;
          const num = parseFloat(String(val).replace(/[^0-9.]/g, ""));
          return isNaN(num) ? null : num;
        };

        entryPrice = parsePrice(json.entry_price);
        stopLoss = parsePrice(json.stop_loss);

        // ── 목표가·진입가·손절가 이상값 가드 ─────────────────────────────────
        const startPriceRow = await rawQuery(
          `SELECT start_price, ticker, company_name, industry FROM analyses WHERE id=$1`,
          [id]
        );
        savedStartPrice = startPriceRow[0]?.start_price ?? null;
        savedTicker = startPriceRow[0]?.ticker ?? "";
        const savedCompanyName: string = startPriceRow[0]?.company_name ?? "";
        const savedIndustry: string = startPriceRow[0]?.industry ?? "";
        const isKR = /^\d{6}$/.test(savedTicker);
        const isFinancialStock = isKR && needsFinancialSector(savedIndustry, savedCompanyName, savedTicker);

        // ── 1순위: relative_valuation FINAL_VALUATION_DATA.base 우선 사용 ──────
        // investment_strategy AI가 지시를 무시하고 다른 값을 쓰는 경우를 서버에서 강제 보정
        let rvBasePrice: number | null = null;
        try {
          const rvStepRow = await rawQuery(
            `SELECT content FROM analysis_steps WHERE analysis_id=$1 AND step_key='relative_valuation' LIMIT 1`,
            [id]
          );
          const rvContent: string = rvStepRow[0]?.content ?? "";
          // bracket-counting 파서 사용 — 중첩 JSON에서 regex 방식(\{[\s\S]*?\})이 첫 }에 멈추는 버그 수정
          const fvd = extractFvdJson(rvContent);
          if (fvd) {
            const parsed = parseFloat(String(fvd.base ?? fvd.target ?? fvd.target_price ?? "0").replace(/[^0-9.]/g, ""));
            if (!isNaN(parsed) && parsed > 0) rvBasePrice = parsed;
          }
        } catch { /* optional */ }

        if (rvBasePrice && rvBasePrice > 0) {
          // FINAL_VALUATION_DATA.base가 있으면 AI의 FINAL_JSON target_price 대신 사용
          const aiTp = parsePrice(json.target_price);
          if (aiTp && Math.abs(aiTp - rvBasePrice) / rvBasePrice > 0.02) {
            console.warn(`[tp-override] AI wrote target_price=${aiTp} but FINAL_VALUATION_DATA.base=${rvBasePrice} — using valuation base`);
          }
          targetPrice = Math.round(rvBasePrice);
        } else {
          // FINAL_VALUATION_DATA 없으면 AI 출력값 사용 (fallback)
          targetPrice = parsePrice(json.target_price);
        }

        // ── FINAL_VALUATION_DATA current price 검증 (AI가 wrong price 사용 시 조기 경보) ──
        if (savedStartPrice && savedStartPrice > 0) {
          const fvdMatch = content.match(/FINAL_VALUATION_DATA:\s*(\{[^\n]+\})/);
          if (fvdMatch) {
            try {
              const fvd = JSON.parse(fvdMatch[1]);
              const fvdCurrent = parseFloat(String(fvd.current ?? fvd.current_price ?? "0").replace(/[^0-9.]/g, ""));
              if (fvdCurrent > 0) {
                const drift = Math.abs(fvdCurrent - savedStartPrice) / savedStartPrice;
                if (drift > 0.2) {
                  console.warn(
                    `[analysis ${id}] FINAL_VALUATION_DATA current=${fvdCurrent} vs start_price=${savedStartPrice} (drift=${(drift * 100).toFixed(1)}%) — AI may have used wrong current price → target prices likely invalid`
                  );
                }
              }
            } catch (_) { /* JSON parse fail — ignore */ }
          }
        }

        if (savedStartPrice && savedStartPrice > 0) {
          // ── 하한 플로어 + 상한 캡 — LLM 오산출 방지 ──────────────────────
          // 하한: DART 재무 데이터 부재 시 AI 오산출 방지
          // 상한: LLM이 대형주에 황당한 목표가를 산출하는 사례 방지
          //   (삼성전자 +370% 같은 케이스는 소형주·바이오 고배수 시나리오가 아님)
          // 금융주(은행·보험·증권·금융지주): P/B-ROE 모델 기준으로 0.55x~1.8x 제한
          // 일반 한국주: 0.45x~3.0x / 미국주: 0.25x~5.0x
          const TARGET_MIN_RATIO = isFinancialStock ? 0.55 : (isKR ? 0.45 : 0.25);
          const TARGET_MAX_RATIO = isFinancialStock ? 1.8  : (isKR ? 3.0  : 5.0);
          if (isFinancialStock) console.log(`[tp-save] 금융주 감지(${savedTicker} ${savedCompanyName}) — 클램핑 ${TARGET_MIN_RATIO}x~${TARGET_MAX_RATIO}x 적용`);
          if (targetPrice) {
            const tRatio = targetPrice / savedStartPrice;
            if (tRatio < TARGET_MIN_RATIO) {
              const floored = Math.round(savedStartPrice * TARGET_MIN_RATIO);
              console.warn(
                `[analysis ${id}] target_price ${targetPrice} is ${tRatio.toFixed(2)}x startPrice ${savedStartPrice} (<${TARGET_MIN_RATIO}x ${isKR ? "KR" : "US"} floor) — raised to ${floored}`
              );
              if (tRatio < 0.1) {
                console.error(
                  `[analysis ${id}] DART 재무 부재 의심: AI target ${targetPrice}원은 현재가의 ${(tRatio * 100).toFixed(1)}% — 재무 데이터 없이 오산출된 것으로 판단. 기계적 floor(${floored})로 대체됨`
                );
              }
              targetPrice = floored;
            } else if (tRatio > TARGET_MAX_RATIO) {
              const capped = Math.round(savedStartPrice * TARGET_MAX_RATIO);
              console.warn(
                `[analysis ${id}] target_price ${targetPrice} is ${tRatio.toFixed(2)}x startPrice ${savedStartPrice} (>${TARGET_MAX_RATIO}x ${isKR ? "KR" : "US"} ceiling) — capped to ${capped}`
              );
              targetPrice = capped;
            } else {
              console.log(`[analysis ${id}] target_price ${targetPrice} (${tRatio.toFixed(2)}x startPrice ${savedStartPrice}) — 범위 내 정상`);
            }
          }

          // ── 진입가·손절가 3.5배 가드 ────────────────────────────────────
          const MAX_RATIO = 3.5;
          const MIN_RATIO = 1 / MAX_RATIO;
          if (entryPrice) {
            const ratio = entryPrice / savedStartPrice;
            if (ratio > MAX_RATIO || ratio < MIN_RATIO) {
              console.warn(`[analysis ${id}] entry_price ${entryPrice} is ${ratio.toFixed(2)}x startPrice ${savedStartPrice} — nullified`);
              entryPrice = null;
            }
          }
          if (stopLoss) {
            const ratio = stopLoss / savedStartPrice;
            if (ratio > MAX_RATIO || ratio < MIN_RATIO) {
              console.warn(`[analysis ${id}] stop_loss ${stopLoss} is ${ratio.toFixed(2)}x startPrice ${savedStartPrice} — nullified`);
              stopLoss = null;
            }
          }

          // ── entry_price null → start_price fallback ──────────────────
          // AI가 entry_price를 누락하거나 가드에 걸려 null이 된 경우,
          // 분석 시점 시장가(start_price)를 진입가 기준으로 사용한다.
          if (entryPrice === null) {
            entryPrice = savedStartPrice;
            console.log(`[analysis ${id}] entry_price null → fallback to start_price: ${savedStartPrice}`);
          }
        } else if (entryPrice === null) {
          // savedStartPrice 자체가 null인 경우에도 기록
          console.warn(`[analysis ${id}] entry_price null, start_price도 null — 가격 조회 실패`);
        }

        if (targetPrice && entryPrice && stopLoss && entryPrice !== stopLoss) {
          riskRewardRatio = Math.abs((targetPrice - entryPrice) / (entryPrice - stopLoss));
        }

        const rr = json.risk_reward;
        if (!riskRewardRatio && rr) {
          const m = String(rr).match(/[\d.]+/g);
          if (m && m.length >= 2) riskRewardRatio = parseFloat(m[1]) / parseFloat(m[0]);
        }

        // ── 서버 사이드 판정 강제 결정 (일관성 보장) ──────────────────────────────
        // AI 프롬프트가 같은 목표가에 다른 판정을 내릴 수 있는 확률적 오류를 방지.
        // 목표가(targetPrice)와 분석시점 주가(savedStartPrice)로 upside를 계산해
        // 판정을 완전 결정론적으로 덮어씀 — AI 판정은 무시함.
        if (targetPrice && savedStartPrice && savedStartPrice > 0) {
          const upside = (targetPrice - savedStartPrice) / savedStartPrice * 100;
          let deterministicVerdict: string;
          if (upside >= 30)        deterministicVerdict = "Strong Buy";
          else if (upside >= 15)   deterministicVerdict = "Buy";
          else if (upside >= -10)  deterministicVerdict = "Hold";
          else if (upside >= -25)  deterministicVerdict = "Sell";
          else                     deterministicVerdict = "Strong Sell";

          if (investmentVerdict !== deterministicVerdict) {
            console.log(
              `[verdict-override] ${savedTicker} | AI: "${investmentVerdict}" → 확정: "${deterministicVerdict}" | upside ${upside.toFixed(1)}% (target ${targetPrice} / start ${savedStartPrice})`
            );
          }
          investmentVerdict = deterministicVerdict;
        }
      } catch {
        // JSON parse failed
      }

      // AI API 실패로 오류 문자열이 저장된 경우 → 실패한 스텝 삭제 후 in_progress 유지 (재시도 가능)
      const stepHasApiError = content.startsWith("분석 오류:") || content.startsWith("분석 결과를 생성하지 못했습니다");
      if (stepHasApiError) {
        console.warn(`[analysis ${id}] investment_strategy API error — deleting failed step, keeping in_progress for retry`);
        await rawQuery(
          `DELETE FROM analysis_steps WHERE analysis_id = $1 AND step_key = 'investment_strategy'`,
          [id]
        );
        // in_progress 상태 유지 — run-pipeline 또는 background가 재시도
      } else {
        await rawQuery(
          `UPDATE analyses SET status='completed', current_step=NULL, investment_verdict=$1,
           target_price=$2, entry_price=$3, stop_loss=$4, risk_reward_ratio=$5,
           updated_at=NOW(), completed_at=NOW()
           WHERE id=$6`,
          [investmentVerdict, targetPrice, entryPrice, stopLoss, riskRewardRatio, id]
        );
      }

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

      // ── 종목별 자동 학습 데이터 저장 (#3/#5: priceAtAnalysis + predictedEps 추가) ──
      if (targetPrice && entryPrice && investmentVerdict) {
        try {
          const upsidePct = ((targetPrice - entryPrice) / entryPrice) * 100;

          // 분석 시점 실제 주가 = start_price (DB에서 이미 읽어온 savedStartPrice 재사용)
          const priceAtAnalysis: number | null = savedStartPrice ?? null;

          // 예측 EPS 추출: company_analysis 단계 본문에서 "EPS: X" 또는 "EPS __원" 패턴 파싱 (#5)
          let predictedEps: number | null = null;
          try {
            const caStep = existingSteps.find(s => s.stepKey === "company_analysis");
            if (caStep?.content) {
              const epsMatch = caStep.content.match(
                /(?:EPS|주당순이익)[^\d\-]*([\-]?\d[\d,]*\.?\d*)\s*(?:원|₩|\$|달러)?/i
              );
              if (epsMatch) {
                const raw = parseFloat(epsMatch[1].replace(/,/g, ""));
                if (!isNaN(raw)) predictedEps = raw;
              }
            }
          } catch { /* EPS 파싱 실패는 무시 */ }

          const newEntry = {
            analysisId: id,
            date: new Date().toISOString().slice(0, 10),
            verdict: investmentVerdict,
            targetPrice,
            entryPrice,
            upsidePct: Math.round(upsidePct * 10) / 10,
            priceAtAnalysis,
            predictedEps,
          };

          // 기존 학습 데이터 가져오기
          const existingLearningRows = await rawQuery(
            `SELECT auto_learning FROM ticker_notes WHERE ticker = $1`,
            [analysis.ticker]
          );

          let existing: { history?: typeof newEntry[] } = {};
          if (existingLearningRows[0]?.auto_learning) {
            existing = existingLearningRows[0].auto_learning as typeof existing;
          }
          const history = (existing.history ?? []).slice(-9); // 최대 10건 유지
          history.push(newEntry);

          await rawQuery(
            `INSERT INTO ticker_notes (ticker, memo, auto_learning, updated_at)
             VALUES ($1, '', $2, NOW())
             ON CONFLICT (ticker) DO UPDATE SET auto_learning = $2, updated_at = NOW()`,
            [analysis.ticker, JSON.stringify({ history })]
          );
          console.log(`[learning] Updated auto_learning for ${analysis.ticker} — priceAtAnalysis=${priceAtAnalysis}, predictedEps=${predictedEps} (${history.length} entries)`);
        } catch (e) {
          console.error("[learning] Failed to save auto_learning:", e);
        }
      }

      // ── 가설 자동 생성 (hypotheses 테이블 — 성과 추적을 위한 기준점 기록) ────
      if (targetPrice && entryPrice && investmentVerdict && analysis.companyName) {
        (async () => {
          try {
            const upsidePct = ((targetPrice - entryPrice) / entryPrice) * 100;
            const hypothesisText = `${investmentVerdict} — 목표주가 ${targetPrice.toLocaleString()}원/달러, 진입가 ${entryPrice.toLocaleString()} 대비 ${upsidePct >= 0 ? "+" : ""}${upsidePct.toFixed(1)}% 업사이드. 12개월 내 목표가 달성 여부 추적.`;
            await pool.query(
              `INSERT INTO hypotheses
                 (analysis_id, ticker, company_name, hypothesis_text, target_price, entry_price, time_horizon, outcome, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, '12months', 'pending', NOW(), NOW())
               ON CONFLICT DO NOTHING`,
              [id, analysis.ticker, analysis.companyName, hypothesisText, targetPrice, entryPrice]
            );
            console.log(`[hypothesis] #${id} ${analysis.ticker} 가설 생성 완료 (TP=${targetPrice}, EP=${entryPrice})`);
          } catch (e) {
            console.error(`[hypothesis] #${id} 가설 생성 실패:`, e);
          }
        })();
      }
      // ────────────────────────────────────────────────────────────────────────
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
