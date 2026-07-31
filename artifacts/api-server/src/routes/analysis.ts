import { Router, type IRouter } from "express";
import { refreshBriefForTicker } from "./portfolio.js";
import { scheduleAnalysisSelfReview } from "../lib/self-review.js";
import { db, pool } from "@workspace/db";
import { validateTicker } from "../lib/sanitize.js";
import { analysesTable, analysisStepsTable, modelInsightsTable } from "@workspace/db";
import { getUserId, checkAndDeductCredit } from "../lib/credits.js";
import { loadKRXList, lookupKoreanName, correctKoreanTicker } from "../lib/krx-cache";
import { cache, TTL } from "../lib/mem-cache.js";
import { fetchDartSubjectBalance, fetchNaverPBR, writeMetricCache } from "../lib/peer-collector.js";
import { validatePeers } from "../lib/peer-validator.js";
import { fetchKISStockQuotes, buildKISStockContext } from "../lib/kis-client.js";
import { fetchECOSMacro, buildECOSContext } from "../lib/ecos-client.js";
import { fetchFREDMacro, buildFREDContext } from "../lib/fred-client.js";
import { eq, desc, not, sql, and, isNotNull } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import YahooFinance from "yahoo-finance2";
import {
  AGENTS,
  STEP_ORDER,
  buildPrompt,
  needsFinancialSector,
  type AgentKey,
} from "../lib/ai-agents.js";
import { getCalibrationContext, classifySector } from "./performance.js";
import { triggerModelReview } from "./model-insights.js";
import { runQACheck } from "../lib/qa-checker.js";
import { normalizeTicker } from "@workspace/shared";
import { ensureStockRegistered } from "../lib/stock-registry.js";
import { getDartHistoricalContext, fetchAndStoreDartQuarterly, getDartAnchorNumerics, type DartAnchorNumerics } from "../lib/dart-store.js";
import { fetchDartBusinessContent, fetchDartCompetitorSection, fetchDartOrderBacklog } from "../lib/dart-business-content.js";
import { fetchSECEdgarContent, fetchEdgarTimeSeries, fetchEdgarMDA } from "../lib/sec-edgar-content.js";
import { fetchDartTimeSeries } from "../lib/dart-timeseries.js";
import { fetchKOSISData, buildKOSISContext } from "../lib/kosis-client.js";
import { buildSOTPSubsidiaryContext, hasSOTPSubsidiaryData } from "../lib/sotp-subsidiary-context.js";
import { getLatestMarketRegime } from "../lib/market-regime-updater.js";
import { getSectorLearningNote } from "../lib/sector-learning.js";
import { buildFmpContext } from "../lib/fmp-client.js";

const router: IRouter = Router();
import { yahooFinance, fetchTickerInfo, fetchNaverFinanceData, naverFmt, fetchFinancialContext, fetchCompanyNews, computeHistoricalBeta, tryQuoteSummary, toYear, fmtNum, pct, opm } from "../lib/analysis/financial-context.js";
import { KOREAN_SECTOR_MULTIPLES, getKRXSectorPeerContext, getDartCompetitorPeerContext, getDartCompetitorTickerPeers } from "../lib/analysis/korea-context.js";
import { US_PEER_MAP, selectPeerTickers, fetchPeerFinancials } from "../lib/analysis/peer-context.js";
import { extractJsonSafe, extractFvdJson, repairInvestmentStrategyContent } from "../lib/analysis/json-repair.js";
import { rawQuery, dbCacheGet, dbCacheSet, mapAnalysisRow, mapStepRow, ensureQaPeerColumns } from "../lib/analysis/store.js";
import { ai, geminiSemaphore, MAX_CONCURRENT_GEMINI } from "../lib/analysis/gemini.js";
import { runningStepsLock, pendingDataFetch, preFetchedPeerData, preFetchedWeeklyMA, MAX_CONCURRENT_PIPELINES, pipelineSemaphore, MAX_QUEUE_SIZE, enqueueAnalysis, runningPipelineIds, executeStep, runPipelineBackground, type PipelineCtx } from "../lib/analysis/pipeline.js";
import { sanitizeFeedback, stripDisplayContent, formatStep, formatAnalysis } from "../lib/analysis/format.js";

// 서버 시작 시 미완료 분석 복구 — src/index.ts가 사용
export { resumeInProgressAnalyses } from "../lib/analysis/pipeline.js";

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/cache-stats", (_req, res) => {
  res.json(cache.getStats());
});

router.delete("/cache", (_req, res) => {
  cache.purgeExpired();
  res.json({ ok: true, stats: cache.getStats() });
});

router.post("/", async (req, res) => {
  const reqUserId = getUserId(req);
  console.log(`[analysis-create] POST from user=${reqUserId ?? "anonymous"} ip=${req.ip} ticker=${req.body?.ticker}`);
  const { ticker, companyName: rawCompanyName, industry: rawIndustry, additionalContext } = req.body as {
    ticker: string;
    companyName?: string;
    industry?: string;
    additionalContext?: string;
  };

  if (!ticker) {
    res.status(400).json({ error: "ticker는 필수입니다" });
    return;
  }
  const validatedTicker = validateTicker(ticker);
  if (!validatedTicker) {
    res.status(400).json({ error: "유효하지 않은 ticker 형식입니다 (영숫자, '.', '-' 최대 20자)" });
    return;
  }

  // ── 지원 시장 검증: 한국(KOSPI·KOSDAQ) + 미국(NYSE·NASDAQ·AMEX) 만 허용 ──
  // 비지원 거래소 suffix 차단 (.T=도쿄, .L=런던, .HK=홍콩, .AX=호주 등)
  const UNSUPPORTED_SUFFIX = /\.(T|L|HK|AX|TO|F|SW|PA|AS|MC|MI|BR|VI|WA|PR|IS|KL|SI|JK|NZ|SA|MX|BK|ST|CO|HE|NX|OL|LS|IC|TL|BO|NS|SZ|SS)$/i;
  if (UNSUPPORTED_SUFFIX.test(validatedTicker)) {
    res.status(400).json({ error: "한국(KOSPI·KOSDAQ) 및 미국(NYSE·NASDAQ·AMEX) 상장 주식만 분석 가능합니다. 일본·유럽·아시아 등 해외 거래소는 지원하지 않습니다." });
    return;
  }

  // 미국 영문 티커: Yahoo Finance로 quoteType·거래소 확인 (ETF·인덱스펀드 차단)
  const isKorean6 = /^\d{6}$/.test(validatedTicker);
  const isKoreanSuffix = /\.(KS|KQ)$/i.test(validatedTicker);
  if (!isKorean6 && !isKoreanSuffix) {
    try {
      const q = await yahooFinance.quote(validatedTicker, { fields: ["quoteType", "exchange"] as any });
      const qType = (q as any)?.quoteType as string | undefined;
      const qExchange = (q as any)?.exchange as string | undefined ?? "";
      if (qType === "ETF" || qType === "MUTUALFUND" || qType === "INDEX") {
        console.log(`[analysis-create] 400 ETF/펀드 차단: ${validatedTicker} qType=${qType}`);
        res.status(400).json({ error: "ETF·인덱스펀드는 분석 대상이 아닙니다. 개별 주식 종목코드를 입력해주세요." });
        return;
      }
      // 비지원 US 거래소(OTC 핑크, 회색 시장 등) 추가 차단
      const US_ALLOWED = new Set(["NMS", "NGM", "NCM", "NYQ", "NYS", "NYE", "ASE", "AMX", "PCX", "CBOE", "PNK", ""]);
      if (qExchange && !US_ALLOWED.has(qExchange)) {
        console.log(`[analysis-create] 400 비지원 거래소 차단: ${validatedTicker} exchange=${qExchange}`);
        res.status(400).json({ error: "한국(KOSPI·KOSDAQ) 및 미국(NYSE·NASDAQ·AMEX) 상장 주식만 분석 가능합니다. 해당 종목은 지원하지 않는 거래소에 상장되어 있습니다." });
        return;
      }
    } catch { /* Yahoo 조회 실패 시 무시하고 진행 */ }
  }

  if (additionalContext && additionalContext.length > 2000) {
    res.status(400).json({ error: "추가 컨텍스트는 2,000자를 초과할 수 없습니다" });
    return;
  }

  // 스케줄러 내부 호출 여부 확인 (크레딧 우회 — 이미 스케줄러에서 차감 완료)
  const isSchedulerCall =
    req.headers["x-scheduler-token"] === "internal-scheduler-cbst-2024";
  const schedulerUserId = isSchedulerCall
    ? (req.headers["x-scheduler-user-id"] as string | undefined) ?? null
    : null;

  const userId = schedulerUserId ?? getUserId(req);

  if (!isSchedulerCall) {
    // ── 서버 과부하 방어: 큐 용량 초과 시 크레딧 차감 전 즉시 거절 ──────────
    if (pipelineSemaphore.waiting >= MAX_QUEUE_SIZE) {
      res.status(503).json({
        error: `현재 서버가 혼잡합니다 (대기 ${pipelineSemaphore.waiting}개). 잠시 후 다시 시도해주세요.`,
      });
      return;
    }

    // ── 사용자별 동시 분석 제한: 로그인 사용자는 최대 2개까지 ───────────────
    if (userId) {
      const activeRows = await rawQuery(
        `SELECT COUNT(*) AS cnt FROM analyses WHERE user_id = $1 AND status IN ('in_progress', 'queued')`,
        [userId]
      );
      const activeCount = parseInt((activeRows[0] as any)?.cnt ?? "0", 10);
      if (activeCount >= 2) {
        res.status(429).json({
          error: `이미 ${activeCount}개의 분석이 진행 중입니다. 현재 분석이 완료된 후 새 분석을 요청해주세요.`,
        });
        return;
      }
    }
  }

  if (!isSchedulerCall && userId) {
    const adminCheck = await pool.query(`SELECT 1 FROM admins WHERE user_id = $1`, [userId]);
    const isUserAdmin = (adminCheck.rowCount ?? 0) > 0;
    if (!isUserAdmin) {
      const credit = await checkAndDeductCredit(userId);
      if (!credit.ok) {
        res.status(402).json({ error: credit.reason });
        return;
      }
    }
  }

  const rawUpperTicker = ticker.toUpperCase();
  // 한국 종목은 .KS/.KQ 없이 6자리 코드만 저장 (005930.KS → 005930)
  const upperTicker = normalizeTicker(rawUpperTicker);
  let companyName = rawCompanyName?.trim();
  let englishName: string | null = null;
  let industry = rawIndustry?.trim();
  let resolvedSymbol = upperTicker;

  const info = await fetchTickerInfo(upperTicker);
  // Korean name: prefer KRX lookup over user-provided (which may be a ticker code)
  companyName = info.companyName || companyName || upperTicker;
  englishName = info.englishName;
  industry = industry || info.industry;
  resolvedSymbol = info.resolvedSymbol;

  // 한국 종목 코드 추출 (078160.KQ → 078160)
  const krxCode = normalizeTicker(upperTicker);
  const isKoreanTicker = /^\d{6}$/.test(krxCode);

  // ── 사용자 언어 설정 — 빠른 조회 ──────────────────────────────────────────
  let userLanguage: "ko" | "en" = "ko";
  if (userId) {
    try {
      const langResult = await pool.query(
        `SELECT language FROM user_settings WHERE user_id = $1`,
        [userId]
      );
      if (langResult.rows[0]?.language === "en") userLanguage = "en";
    } catch { /* 기본값 'ko' 유지 */ }
  }

  // ── DB 레코드를 먼저 생성 → 즉시 응답 → 외부 데이터 수집은 백그라운드 ────
  // 이 구조로 "분석 시작" 버튼 클릭 후 분석 페이지까지 대기 시간이 ~1초로 단축
  let analysis: typeof analysesTable.$inferSelect;
  try {
    const client = await pool.connect();
    try {
      const insertResult = await client.query(
        `INSERT INTO analyses
           (user_id, ticker, company_name, english_name, industry, additional_context, status, current_step, is_public, start_price, language)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          userId ?? null,
          upperTicker,
          companyName,
          englishName ?? null,
          industry ?? "Unknown",
          null,           // additional_context: 백그라운드에서 채워짐
          "in_progress",
          "company_intro",
          "true",
          null,           // start_price: 백그라운드에서 채워짐
          userLanguage,
        ]
      );
      analysis = mapAnalysisRow(insertResult.rows[0]);
    } finally {
      client.release();
    }
  } catch (err: any) {
    const pgMsg = err?.cause?.message ?? err?.message ?? String(err);
    const pgCode = err?.cause?.code ?? err?.code;
    const pgDetail = err?.cause?.detail ?? err?.detail;
    console.error("[POST /analysis] INSERT failed:", { pgMsg, pgCode, pgDetail, fullError: String(err) });
    res.status(500).json({ error: "분석 시작 실패: DB INSERT 오류", detail: pgMsg });
    return;
  }

  // 즉시 응답 — 분석 페이지로 바로 이동
  res.json(formatAnalysis(analysis, []));

  // ── 백그라운드: 외부 API 12개 병렬 수집 → DB 업데이트 → 파이프라인 시작 ──
  const _analysisId = analysis.id;
  pendingDataFetch.add(_analysisId);
  console.log(`[analysis-create] #${_analysisId} 즉시 응답 완료 — 백그라운드 데이터 수집 시작`);

  // 종목 마스터 자가 치유 — 마스터에 없는 종목이면 지금 등록한다.
  // SEC 목록에도 없는 장외 ADR(NTDOY 등)과 상장 직후 종목이 여기서 메워진다.
  // 응답을 이미 보낸 뒤라 사용자 대기 시간에 영향이 없고, 실패해도 분석을 막지 않는다.
  ensureStockRegistered(upperTicker, companyName).catch(() => {});

  (async () => {
    try {
      const needsSOTPData = isKoreanTicker && hasSOTPSubsidiaryData(krxCode);
      // DART 앵커 수치 먼저 조회 (DB 쿼리, 빠름) — fetchFinancialContext에 전달해 Yahoo 오버라이드
      const dartAnchorNumerics = isKoreanTicker
        ? await getDartAnchorNumerics(krxCode).catch(() => null)
        : null;
      if (dartAnchorNumerics) {
        const years = Object.keys(dartAnchorNumerics.annualRev).sort();
        console.log(`[analysis] #${_analysisId} DART 앵커 수치 로드 완료: ${years.join(", ")} (${krxCode})`);
      }
      const [financialData, newsData, dartBalance, ecosMacro, fredMacro, startQuote, kisResult, dartHistorical, kosisData, sotpSubsidiaryContext, dartBizContent, secEdgarContent, fmpContext, dartOrderBacklog, dartTimeSeries, edgarTimeSeries, edgarMDA] = await Promise.all([
        fetchFinancialContext(resolvedSymbol, dartAnchorNumerics),
        fetchCompanyNews(companyName ?? ""),
        isKoreanTicker ? fetchDartSubjectBalance(krxCode) : Promise.resolve(null),
        isKoreanTicker ? fetchECOSMacro() : Promise.resolve(null),
        !isKoreanTicker ? fetchFREDMacro() : Promise.resolve(null),
        yahooFinance.quote(resolvedSymbol).catch(() => null),
        isKoreanTicker ? buildKISStockContext(krxCode).catch(() => null) : Promise.resolve(null),
        isKoreanTicker ? getDartHistoricalContext(krxCode).catch(() => null) : Promise.resolve(null),
        isKoreanTicker ? fetchKOSISData().catch(() => null) : Promise.resolve(null),
        needsSOTPData ? buildSOTPSubsidiaryContext(krxCode).catch(() => null) : Promise.resolve(null),
        isKoreanTicker ? fetchDartBusinessContent(krxCode).catch(() => null) : Promise.resolve(null),
        !isKoreanTicker ? fetchSECEdgarContent(resolvedSymbol).catch(() => null) : Promise.resolve(null),
        buildFmpContext(resolvedSymbol).catch(() => null),
        isKoreanTicker ? fetchDartOrderBacklog(krxCode).catch(() => null) : Promise.resolve(null),
        isKoreanTicker ? fetchDartTimeSeries(krxCode).catch(() => null) : Promise.resolve(null),
        !isKoreanTicker ? fetchEdgarTimeSeries(resolvedSymbol).catch(() => null) : Promise.resolve(null),
        !isKoreanTicker ? fetchEdgarMDA(resolvedSymbol).catch(() => null) : Promise.resolve(null),
      ]);

      const kisContext = kisResult?.context ?? null;
      const kisQuote = kisResult?.quote ?? null;
      const yahooPrice: number | null = (startQuote as any)?.regularMarketPrice ?? null;
      const startPrice: number | null = isKoreanTicker ? (kisQuote?.price ?? yahooPrice) : yahooPrice;
      if (isKoreanTicker && kisQuote?.price) {
        console.log(`[analysis] #${_analysisId} startPrice KIS 우선: ${kisQuote.price}원 (Yahoo: ${yahooPrice})`);
      }

      let dartBalanceContext = "";
      if (dartBalance) {
        const fmtKrw = (v: number | null) =>
          v == null ? "N/A" : `${(v / 1e8).toFixed(1)}억원`;
        // 순차입금은 IFRS 표준 코드로 집계한 값을 쓴다. 한글 계정명 매칭은 회사마다
        // 표기가 달라 누락이 잦았고(SK하이닉스는 유동·비유동 차입금이 둘 다 "차입금"),
        // 그 결과 AI가 순부채를 자체 추정해 목표주가가 크게 어긋났다.
        const nd = dartBalance.netDebt;
        let netDebtStr: string;
        let debtDetailStr: string;
        if (nd) {
          netDebtStr = nd.netDebt < 0
            ? `${fmtKrw(-nd.netDebt)} (순현금 상태)  ← SOTP·DCF 주주가치 환산 시 반드시 이 값 사용. 자체 추정 금지.`
            : `${fmtKrw(nd.netDebt)} (순부채 상태)  ← SOTP·DCF 주주가치 환산 시 반드시 이 값 사용. 자체 추정 금지.`;
          debtDetailStr =
            `이자부부채 합계: ${fmtKrw(nd.interestBearingDebt)}` +
            (nd.debtItems.length
              ? ` (${nd.debtItems.map((d) => `${d.name} ${fmtKrw(d.amount)}`).join(" + ")})`
              : "");
        } else if (dartBalance.totalDebt != null && dartBalance.cash != null) {
          const netDebt = dartBalance.totalDebt - dartBalance.cash;
          netDebtStr = netDebt < 0
            ? `${fmtKrw(-netDebt)} (순현금)  ← DCF 주주가치 환산 시 이 값 사용`
            : `${fmtKrw(netDebt)} (순부채)  ← DCF 주주가치 환산 시 이 값 사용`;
          debtDetailStr = `금융부채(차입금+사채+리스 합계): ${fmtKrw(dartBalance.totalDebt)}`;
        } else {
          // 수집 실패를 "빚이 없다"로 오해하면 기업가치가 부풀려진다 — 명확히 구분해 알린다
          netDebtStr = `산출 불가 (차입금 계정을 확보하지 못함). 무차입으로 단정하지 말고 "[⚡ WACC·EBITDA]" 섹션의 총부채로 보완하거나 N/A로 표기하세요.`;
          debtDetailStr = `이자부부채: 확보 실패 ※ 0원이라는 뜻이 아님`;
        }
        const constructionLines: string[] = [];
        if (dartBalance.unbilledWork != null) {
          constructionLines.push(`미청구공사: ${fmtKrw(dartBalance.unbilledWork)}  ※ 건설업 핵심 리스크 — 매출 대비 10% 초과 시 대손 주의`);
        }
        if (dartBalance.constructionReceivables != null) {
          constructionLines.push(`공사미수금: ${fmtKrw(dartBalance.constructionReceivables)}`);
        }
        dartBalanceContext = [
          `\n[⭐ DART 사업보고서 재무상태표 — ${dartBalance.year}년 ${dartBalance.fsType === "CFS" ? "연결" : "별도"} 기준]`,
          `⚠️ 이 데이터는 DART OpenAPI 원천 데이터입니다. Yahoo Finance 수치와 다를 경우 이 값을 우선 사용하세요.`,
          `현금및현금성자산: ${fmtKrw(dartBalance.cash)}`,
          `자산총계: ${fmtKrw(dartBalance.totalAssets)}`,
          `부채총계(DART전체): ${fmtKrw(dartBalance.totalLiab)}  ※ 매입채무·충당부채 등 영업부채 포함, 순차입금 계산엔 이자부부채만 사용`,
          `자본총계: ${fmtKrw(dartBalance.equity)}`,
          debtDetailStr,
          `순현금/순부채: ${netDebtStr}`,
          ...constructionLines,
        ].filter(Boolean).join("\n");
      }

      const userContext = additionalContext ?? null;
      const macroContext = isKoreanTicker ? buildECOSContext(ecosMacro) : buildFREDContext(fredMacro);
      const kosisContext = isKoreanTicker ? buildKOSISContext(kosisData, industry ?? "") : null;

      // ── 시장 수급 컨텍스트 (한국 종목 전용) ─────────────────────────────────
      // KOSPI/KOSDAQ 시장 전체 외국인·기관 순매수 방향을 AI에게 주입
      // → STEP M-1 ⑥ 시장 수급 컨텍스트 & STEP 2-B 시장 수급 역방향 보정에 활용
      let marketFlowContext: string | null = null;
      if (isKoreanTicker) {
        try {
          const flowRow = await pool.query<{ data: Record<string, unknown> }>(
            `SELECT data FROM system_cache WHERE key = 'market_flow_v2' AND expires_at > NOW() LIMIT 1`
          );
          const rawData = flowRow.rows[0]?.data;
          if (rawData) {
            const fd = (typeof rawData === "string" ? JSON.parse(rawData) : rawData) as {
              marketFlow?: {
                kospi:  { date: string; individual: number; institution: number; foreign: number }[];
                kosdaq: { date: string; individual: number; institution: number; foreign: number }[];
              };
              updatedAt?: string;
            };
            const kospi5  = fd.marketFlow?.kospi  ?? [];
            const kosdaq5 = fd.marketFlow?.kosdaq ?? [];

            if (kospi5.length > 0 || kosdaq5.length > 0) {
              const fmtAk = (n: number) =>
                n >= 0 ? `+${n.toLocaleString()}억` : `${n.toLocaleString()}억`;

              const kospiSum  = kospi5.reduce( (a, r) => ({ inst: a.inst + r.institution, for: a.for + r.foreign, ind: a.ind + r.individual }), { inst: 0, for: 0, ind: 0 });
              const kosdaqSum = kosdaq5.reduce((a, r) => ({ inst: a.inst + r.institution, for: a.for + r.foreign, ind: a.ind + r.individual }), { inst: 0, for: 0, ind: 0 });

              const kospiTrend  = kospi5.map(r  => `${r.date.slice(5)} 외${fmtAk(r.foreign)}`).join(" | ");
              const kosdaqTrend = kosdaq5.map(r => `${r.date.slice(5)} 외${fmtAk(r.foreign)}`).join(" | ");

              marketFlowContext = [
                `[📊 시장 수급 컨텍스트 — 최근 5영업일 누적 (KRX pykrx, ${fd.updatedAt ? fd.updatedAt.slice(0, 10) : "최근"} 기준)]`,
                `⚠️ 이 데이터는 STEP M-1 ⑥ 시장 전체 수급 및 STEP 2-B 시장 수급 역방향 보정의 1순위 근거입니다.`,
                `⚠️ 분석 종목이 KOSPI 상장이면 KOSPI 수급을, KOSDAQ 상장이면 KOSDAQ 수급을 기준으로 판정하세요.`,
                ``,
                `KOSPI 5일 누적: 외국인 ${fmtAk(kospiSum.for)}, 기관 ${fmtAk(kospiSum.inst)}, 개인 ${fmtAk(kospiSum.ind)}`,
                kospiTrend  ? `KOSPI 일별 외국인: ${kospiTrend}`  : null,
                ``,
                `KOSDAQ 5일 누적: 외국인 ${fmtAk(kosdaqSum.for)}, 기관 ${fmtAk(kosdaqSum.inst)}, 개인 ${fmtAk(kosdaqSum.ind)}`,
                kosdaqTrend ? `KOSDAQ 일별 외국인: ${kosdaqTrend}` : null,
              ].filter((l): l is string => l !== null).join("\n");
            }
          }
        } catch (e) {
          console.warn("[analysis] marketFlowContext 로드 실패 (캐시 없음, 무시):", e);
        }
      }

      const fullContext = [
        kisContext, sotpSubsidiaryContext, financialData, dartBalanceContext,
        dartHistorical,
        dartOrderBacklog ?? null,
        dartBizContent
          ? `[⭐ DART 사업보고서 사업내용 — 시장규모·TAM·업계현황·파이프라인 1순위 근거]\n` +
            `※ 아래 내용은 DART 공시 원문입니다. 시장 규모·TAM 추정·업계 현황 서술 시 훈련 데이터보다 이 수치를 우선 사용하세요.\n\n` +
            dartBizContent
          : null,
        // ── 재무 시계열 (한국: DART, 미국: EDGAR XBRL) ──
        dartTimeSeries   ?? null,
        edgarTimeSeries  ?? null,
        edgarMDA         ?? null,
        fmpContext,
        secEdgarContent, kosisContext, macroContext, marketFlowContext, newsData,
        userContext ? `[사용자 추가 컨텍스트]\n${userContext}` : "",
      ].filter(Boolean).join("\n\n") || null;

      await pool.query(
        `UPDATE analyses SET additional_context=$1, start_price=$2, updated_at=NOW() WHERE id=$3`,
        [fullContext, startPrice, _analysisId]
      );
      console.log(`[analysis-create] #${_analysisId} 데이터 수집 완료 (${fullContext?.length ?? 0}자)`);
    } catch (err) {
      console.error(`[analysis-create] #${_analysisId} 데이터 수집 실패:`, err);
      await pool.query(
        `UPDATE analyses SET status='error', error_message=$1, updated_at=NOW() WHERE id=$2`,
        [String(err), _analysisId]
      ).catch(() => {});
    } finally {
      pendingDataFetch.delete(_analysisId);
    }

    // 에러 없으면 파이프라인 시작
    try {
      const check = await pool.query(`SELECT status FROM analyses WHERE id=$1`, [_analysisId]);
      if (check.rows[0]?.status === "in_progress") {
        enqueueAnalysis(_analysisId).catch(console.error);
      }
    } catch { /* ignore */ }
  })();
});

router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.json([]);
      return;
    }
    const aRows = await rawQuery(
      `SELECT id, user_id, ticker, company_name, english_name, industry, additional_context,
              status, current_step, investment_verdict, target_price, start_price, entry_price,
              stop_loss, risk_reward_ratio, memo, is_public, user_rating, user_feedback,
              created_at, updated_at, language
       FROM analyses WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    if (aRows.length === 0) {
      res.json([]);
      return;
    }
    const ids = aRows.map((r: any) => r.id);
    // Exclude content column for history list — full content fetched only on detail view
    const sRows = await rawQuery(
      `SELECT id, analysis_id, step_key, agent_name, agent_role, information_type, validation_notes, created_at FROM analysis_steps WHERE analysis_id = ANY($1::int[]) ORDER BY created_at ASC`,
      [ids]
    );
    const stepsByAnalysis = new Map<number, any[]>();
    for (const s of sRows) {
      const list = stepsByAnalysis.get(s.analysis_id) ?? [];
      list.push(s);
      stepsByAnalysis.set(s.analysis_id, list);
    }
    const results = aRows
      .map(mapAnalysisRow)
      .map((a: any) => formatAnalysis(a, (stepsByAnalysis.get(a.id) ?? []).map((r: any) => ({
        ...mapStepRow({ ...r, content: "" }),
      }))));
    res.json(results);
  } catch (err: any) {
    console.error("[GET /analysis] DB error:", err?.message, err?.cause);
    res.status(500).json({ error: "Database query failed", detail: err?.message });
  }
});

router.delete("/mine", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  try {
    const ids = await rawQuery(
      `SELECT id FROM analyses WHERE user_id = $1`,
      [userId]
    );
    if (ids.length > 0) {
      const idList = ids.map((r: any) => r.id);
      await rawQuery(
        `DELETE FROM analysis_steps WHERE analysis_id = ANY($1::int[])`,
        [idList]
      );
      await rawQuery(`DELETE FROM analyses WHERE user_id = $1`, [userId]);
    }
    res.json({ success: true, deleted: ids.length });
  } catch (err: any) {
    console.error("[DELETE /analysis/mine] error:", err?.message);
    res.status(500).json({ error: "삭제 중 오류가 발생했습니다." });
  }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const userId = getUserId(req);
  const aRows = await rawQuery(`SELECT user_id FROM analyses WHERE id = $1 LIMIT 1`, [id]);
  if (!aRows[0]) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (aRows[0].user_id && aRows[0].user_id !== userId) {
    res.status(403).json({ error: "권한이 없습니다" });
    return;
  }
  await rawQuery(`DELETE FROM analysis_steps WHERE analysis_id = $1`, [id]);
  await rawQuery(`DELETE FROM analyses WHERE id = $1`, [id]);
  res.json({ success: true });
});

// ─── 인기 피드: 최근 완료된 공개 분석 목록 ──────────────────────────────────────
router.get("/live-insights", async (_req, res) => {
  try {
    const STEP_LABELS: Record<string, string> = {
      company_intro:      "기업 브리핑",
      industry_analysis:  "산업 분석",
      catalyst_analysis:  "촉매 분석",
      company_analysis:   "실적 분석",
      relative_valuation: "적정주가 산출",
      market_analysis:    "기술적 분석",
      investment_strategy:"최종 결론",
    };

    const rawRows = await rawQuery(
      `SELECT a.company_name, a.ticker, s.step_key, s.content, s.created_at
       FROM analysis_steps s
       INNER JOIN analyses a ON s.analysis_id = a.id
       WHERE a.status = 'completed' AND s.content IS NOT NULL
       ORDER BY s.created_at DESC LIMIT 30`
    );
    const rows = rawRows.map(r => ({
      companyName: r.company_name,
      ticker: r.ticker,
      stepKey: r.step_key,
      content: r.content,
      createdAt: r.created_at,
    }));

    // 종목당 하나만 (가장 최신 분석 기준)
    const seen = new Set<string>();
    const items: { time: string; text: string; companyName: string; ticker: string; stepLabel: string }[] = [];

    for (const row of rows) {
      const key = `${row.ticker}_${row.stepKey}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let snippet = "";
      if (row.stepKey === "company_intro" || row.stepKey === "investment_strategy") {
        // 이미 짧은 텍스트 — JSON이면 파싱해서 summary 추출
        try {
          const parsed = JSON.parse(row.content ?? "");
          snippet = parsed.summary ?? parsed.key_issue ?? "";
        } catch {
          snippet = (row.content ?? "").replace(/\n.*/s, "").trim();
        }
      } else {
        // 마크다운에서 첫 의미있는 문장 추출
        const clean = (row.content ?? "")
          .replace(/^#+.+/gm, "")      // 헤더 제거
          .replace(/\|.*\|/g, "")       // 테이블 제거
          .replace(/[*_`]/g, "")        // 마크다운 기호 제거
          .replace(/\n+/g, " ")
          .trim();
        const firstSentence = clean.match(/[^.!?。]+[.!?。]/)?.[0]?.trim() ?? clean.slice(0, 80);
        snippet = firstSentence;
      }

      if (!snippet || snippet.length < 10) continue;

      const elapsedMs = Date.now() - new Date(row.createdAt ?? "").getTime();
      const elapsedMin = Math.floor(elapsedMs / 60000);
      const timeLabel =
        elapsedMin < 1   ? "방금 전" :
        elapsedMin < 60  ? `${elapsedMin}분 전` :
        elapsedMin < 1440? `${Math.floor(elapsedMin / 60)}시간 전` :
                           `${Math.floor(elapsedMin / 1440)}일 전`;

      const stepLabel = STEP_LABELS[row.stepKey ?? ""] ?? row.stepKey ?? "";
      items.push({
        time: timeLabel,
        text: `${stepLabel} 완료 — ${row.companyName}: ${snippet.slice(0, 80)}`,
        companyName: row.companyName ?? "",
        ticker: row.ticker ?? "",
        stepLabel,
      });

      if (items.length >= 5) break;
    }

    res.json(items);
  } catch (err: any) {
    console.error("[GET /analysis/live-insights]", err?.message);
    res.status(500).json({ error: "인사이트를 가져오지 못했습니다" });
  }
});

// ── 관리자: 실시간 분석 현황 ────────────────────────────────────────────
router.get("/admin-live", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const adminCheck = await pool.query(`SELECT 1 FROM admins WHERE user_id = $1`, [userId]);
    if (!(adminCheck.rowCount ?? 0)) { res.status(403).json({ error: "Forbidden" }); return; }

    const STEP_LABELS: Record<string, string> = {
      company_intro:       "기업 브리핑",
      industry_analysis:   "산업 분석",
      catalyst_analysis:   "촉매 분석",
      company_analysis:    "실적 분석",
      relative_valuation:  "적정주가 산출",
      market_analysis:     "기술적 분석",
      investment_strategy: "최종 결론",
    };
    const STEPS_TOTAL = Object.keys(STEP_LABELS).length;

    // 진행 중 분석
    const inProgress = await rawQuery(
      `SELECT a.id, a.ticker, a.company_name, a.current_step, a.created_at, a.updated_at,
              u.display_name, u.email
       FROM analyses a
       LEFT JOIN user_credits u ON u.user_id = a.user_id
       WHERE a.status = 'in_progress'
       ORDER BY a.created_at DESC
       LIMIT 50`
    );

    // 최근 1시간 완료 분석
    const recentDone = await rawQuery(
      `SELECT a.id, a.ticker, a.company_name, a.investment_verdict, a.target_price,
              a.created_at, a.updated_at,
              u.display_name, u.email
       FROM analyses a
       LEFT JOIN user_credits u ON u.user_id = a.user_id
       WHERE a.status = 'completed' AND a.updated_at >= NOW() - INTERVAL '1 hour'
       ORDER BY a.updated_at DESC
       LIMIT 50`
    );

    // 최근 1시간 실패/오류 분석
    const recentFailed = await rawQuery(
      `SELECT a.id, a.ticker, a.company_name, a.created_at, a.updated_at,
              u.display_name, u.email
       FROM analyses a
       LEFT JOIN user_credits u ON u.user_id = a.user_id
       WHERE a.status = 'error' AND a.updated_at >= NOW() - INTERVAL '1 hour'
       ORDER BY a.updated_at DESC
       LIMIT 20`
    );

    const mapRow = (r: any) => ({
      id: r.id,
      ticker: r.ticker,
      companyName: r.company_name,
      currentStep: r.current_step ?? null,
      currentStepLabel: STEP_LABELS[r.current_step ?? ""] ?? r.current_step ?? null,
      stepsTotal: STEPS_TOTAL,
      investmentVerdict: r.investment_verdict ?? null,
      targetPrice: r.target_price ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      user: r.display_name ?? r.email ?? "익명",
    });

    res.json({
      inProgress: inProgress.map(mapRow),
      recentDone: recentDone.map(mapRow),
      recentFailed: recentFailed.map(mapRow),
      stepsTotal: STEPS_TOTAL,
      stepLabels: STEP_LABELS,
    });
  } catch (err: any) {
    console.error("[GET /analysis/admin-live]", err?.message);
    res.status(500).json({ error: "실시간 현황을 가져오지 못했습니다" });
  }
});

router.get("/all-reports", async (req, res) => {
  try {
    const requesterId = getUserId(req);
    if (!requesterId) {
      return res.status(401).json({ error: "로그인이 필요합니다." });
    }
    const adminCheck = await pool.query(
      `SELECT 1 FROM admins WHERE user_id = $1`,
      [requesterId]
    );
    if ((adminCheck.rowCount ?? 0) === 0) {
      return res.status(403).json({ error: "관리자 전용 기능입니다." });
    }

    const limit = Math.min(parseInt((req.query.limit as string) ?? "100"), 500);
    const offset = parseInt((req.query.offset as string) ?? "0") || 0;
    const statusFilter = (req.query.status as string) ?? "";
    const search = ((req.query.search as string) ?? "").trim().toLowerCase();

    let where = "WHERE a.status != 'in_progress' OR a.status = 'in_progress'";
    const params: any[] = [];
    let idx = 1;

    if (statusFilter && statusFilter !== "all") {
      where += ` AND a.status = $${idx++}`;
      params.push(statusFilter);
    }
    if (search) {
      where += ` AND (LOWER(a.ticker) LIKE $${idx} OR LOWER(a.company_name) LIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const rows = await rawQuery(
      `SELECT a.id, a.ticker, a.company_name, a.english_name, a.investment_verdict,
              a.target_price, a.start_price, a.status, a.created_at, a.completed_at,
              a.industry, a.current_step,
              uc.display_name AS user_display_name, uc.email AS user_email
       FROM analyses a
       LEFT JOIN user_credits uc ON uc.user_id = a.user_id
       ${where.replace("WHERE a.status != 'in_progress' OR a.status = 'in_progress'", "WHERE 1=1")}
       ORDER BY a.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    const countRows = await rawQuery(
      `SELECT COUNT(*) AS cnt FROM analyses a ${where.replace("WHERE a.status != 'in_progress' OR a.status = 'in_progress'", "WHERE 1=1")}`,
      params
    );

    res.json({
      data: rows,
      total: parseInt(countRows[0]?.cnt ?? "0", 10),
      limit,
      offset,
    });
  } catch (err: any) {
    console.error("[GET /analysis/all-reports] error:", err?.message);
    res.status(500).json({ error: "DB error" });
  }
});

const POPULAR_CACHE_KEY = "popular_feed";
const POPULAR_TTL_MS    = 5 * 60 * 1000;
let _popularCache: { data: any; ts: number } | null = null;



router.get("/popular", async (_req, res) => {
  if (_popularCache && Date.now() - _popularCache.ts < POPULAR_TTL_MS) {
    res.setHeader("X-Cache", "HIT");
    return res.json(_popularCache.data);
  }
  try {
    const rawRows = await rawQuery(
      `SELECT id, ticker, company_name, english_name, industry, investment_verdict, target_price, entry_price, stop_loss, created_at
       FROM analyses
       WHERE status = 'completed' AND is_public = 'true' AND investment_verdict IS NOT NULL
       ORDER BY created_at DESC LIMIT 50`
    );

    const rows = rawRows.map(r => ({
      id: r.id as number,
      ticker: r.ticker as string,
      companyName: r.company_name as string,
      englishName: (r.english_name ?? null) as string | null,
      industry: r.industry as string,
      investmentVerdict: r.investment_verdict as string | null,
      targetPrice: r.target_price as number | null,
      entryPrice: r.entry_price as number | null,
      stopLoss: r.stop_loss as number | null,
      createdAt: r.created_at,
    }));

    const analysisIds = rows.map((r) => r.id);
    let insightMap: Record<number, { currentPrice: number | null; priceReturn: number | null; outcome: string | null; daysElapsed: number | null }> = {};

    if (analysisIds.length > 0) {
      const insightRows = await rawQuery(
        `SELECT analysis_id, price_at_review, price_return, outcome, days_elapsed, reviewed_at
         FROM model_insights WHERE outcome != 'pending'`
      );

      for (const ins of insightRows) {
        const aid = ins.analysis_id;
        if (!aid || !analysisIds.includes(aid)) continue;
        if (!insightMap[aid] || ins.reviewed_at) {
          insightMap[aid] = {
            currentPrice: ins.price_at_review ?? null,
            priceReturn: ins.price_return ?? null,
            outcome: ins.outcome ?? null,
            daysElapsed: ins.days_elapsed ?? null,
          };
        }
      }
    }

    const tickerCounts: Record<string, { count: number; companyName: string; englishName: string | null }> = {};
    for (const r of rows) {
      if (!tickerCounts[r.ticker]) tickerCounts[r.ticker] = { count: 0, companyName: r.companyName, englishName: r.englishName };
      tickerCounts[r.ticker].count++;
    }
    const tickerStats = Object.entries(tickerCounts)
      .map(([ticker, v]) => ({ ticker, companyName: v.companyName, englishName: v.englishName, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const enriched = rows.map((r) => ({
      ...r,
      ...(insightMap[r.id] ?? { currentPrice: null, priceReturn: null, outcome: null, daysElapsed: null }),
    }));

    const allForStats = await rawQuery(
      `SELECT ticker, investment_verdict FROM analyses WHERE status = 'completed' AND is_public = 'true' AND investment_verdict IS NOT NULL`
    );

    const verdictMap: Record<string, number> = {};
    let krCount = 0, usCount = 0;
    for (const r of allForStats) {
      const v = (r.investment_verdict as string).trim();
      verdictMap[v] = (verdictMap[v] ?? 0) + 1;
      const t = r.ticker as string;
      if (/^\d/.test(t) || t.endsWith(".KQ") || t.endsWith(".KS") || t.endsWith(".KO")) {
        krCount++;
      } else {
        usCount++;
      }
    }

    const VERDICT_ORDER = ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"];
    const verdictStats = VERDICT_ORDER
      .filter((v) => verdictMap[v] != null)
      .map((v) => ({ verdict: v, count: verdictMap[v] }));

    const marketStats = [
      { market: "한국", count: krCount },
      { market: "미국", count: usCount },
    ].filter((m) => m.count > 0);

    const payload = { items: enriched, tickerStats, verdictStats, marketStats };
    _popularCache = { data: payload, ts: Date.now() };
    res.setHeader("X-Cache", "MISS");
    res.json(payload);
  } catch (err: any) {
    console.error("[GET /analysis/popular]", err?.message, err?.cause?.message);
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── 공개 보고서 탐색 (인증 불필요) ──────────────────────────────────────────
router.get("/browse", async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(String(req.query.page  ?? "1")) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20")) || 20));
    const offset = (page - 1) * limit;

    const verdict  = req.query.verdict  ? String(req.query.verdict)  : null;
    const industry = req.query.industry ? String(req.query.industry) : null;
    const market   = req.query.market   ? String(req.query.market)   : null; // KR | US
    const sort     = String(req.query.sort ?? "latest"); // latest | oldest
    const search   = req.query.search   ? String(req.query.search).trim() : null; // 종목명/티커 검색

    const conditions: string[] = [
      `status = 'completed'`,
      `is_public = 'true'`,
      `investment_verdict IS NOT NULL`,
    ];
    const params: any[] = [];

    if (verdict) {
      params.push(verdict);
      conditions.push(`investment_verdict = $${params.length}`);
    }
    if (industry) {
      params.push(industry);
      conditions.push(`industry = $${params.length}`);
    }
    if (market === "KR") {
      conditions.push(`(ticker ~ '^[0-9]' OR ticker LIKE '%.KQ' OR ticker LIKE '%.KS')`);
    } else if (market === "US") {
      conditions.push(`NOT (ticker ~ '^[0-9]' OR ticker LIKE '%.KQ' OR ticker LIKE '%.KS')`);
    }
    if (search) {
      const q = `%${search}%`;
      params.push(q);
      const n = params.length;
      conditions.push(`(company_name ILIKE $${n} OR ticker ILIKE $${n} OR english_name ILIKE $${n})`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const orderBy = sort === "oldest" ? "ORDER BY created_at ASC" : "ORDER BY created_at DESC";

    const countRows = await rawQuery(
      `SELECT COUNT(*) AS cnt FROM analyses ${where}`,
      params
    );
    const total = parseInt(countRows[0]?.cnt ?? "0");

    params.push(limit);
    params.push(offset);
    const dataRows = await rawQuery(
      `SELECT id, ticker, company_name, english_name, industry, investment_verdict,
              target_price, entry_price, language, created_at
       FROM analyses ${where} ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const items = dataRows.map((r: any) => ({
      id: r.id as number,
      ticker: r.ticker as string,
      companyName: r.company_name as string,
      englishName: (r.english_name ?? null) as string | null,
      industry: (r.industry ?? null) as string | null,
      investmentVerdict: r.investment_verdict as string,
      targetPrice: (r.target_price ?? null) as number | null,
      entryPrice: (r.entry_price ?? null) as number | null,
      language: (r.language ?? "ko") as string,
      createdAt: r.created_at,
    }));

    // 필터용 업종/판정 목록 (5분 인메모리 캐시)
    const META_KEY = "browse_meta";
    const META_TTL = 5 * 60 * 1000;
    let meta = cache.get<{ industries: string[]; verdicts: string[] }>(META_KEY);
    if (!meta) {
      const metaRows = await rawQuery(
        `SELECT DISTINCT industry, investment_verdict
         FROM analyses WHERE status='completed' AND is_public='true' AND investment_verdict IS NOT NULL`
      );
      const industries = [...new Set(metaRows.map((r: any) => r.industry).filter(Boolean))].sort() as string[];
      const verdicts   = ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"].filter(
        (v) => metaRows.some((r: any) => r.investment_verdict === v)
      );
      meta = { industries, verdicts };
      cache.set(META_KEY, meta, META_TTL);
    }

    res.json({ total, page, limit, items, meta });
  } catch (err: any) {
    console.error("[GET /analysis/browse]", err?.message);
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── 실시간 트래커: 적정주가 있는 완료 분석 목록 ──────────────────────────────
router.get("/tracker", async (_req, res) => {
  try {
    const rawRows = await rawQuery(
      `SELECT id, ticker, company_name, industry, investment_verdict, target_price, entry_price, created_at
       FROM analyses WHERE status='completed' AND is_public='true' AND target_price IS NOT NULL
       ORDER BY created_at DESC LIMIT 100`
    );
    const rows = rawRows.map(r => ({
      id: r.id,
      ticker: r.ticker,
      companyName: r.company_name,
      industry: r.industry,
      investmentVerdict: r.investment_verdict ?? null,
      targetPrice: r.target_price ?? null,
      entryPrice: r.entry_price ?? null,
      createdAt: r.created_at,
    }));
    res.json(rows);
  } catch (err: any) {
    console.error("[GET /analysis/tracker]", err?.message);
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── 저평가 스캐너: AI 적정주가 대비 상승여력 큰 종목 실시간 스캔 ────────────
router.get("/scanner", async (req, res) => {
  try {
    const market = req.query.market ? String(req.query.market) : "ALL"; // ALL | KR | US
    const minUpside = parseFloat(String(req.query.minUpside ?? "10"));
    const SCANNER_TTL = 5 * 60 * 1000;
    const CACHE_KEY = `scanner_v2_${market}_${minUpside}`;
    const cached = cache.get<any[]>(CACHE_KEY);
    if (cached) { res.json(cached); return; }

    // 최근 6개월 분석 중 티커별 최신 1건만 (Buy/Strong Buy, target_price 있는 것)
    const conditions = [
      `status = 'completed'`,
      `is_public = 'true'`,
      `target_price IS NOT NULL`,
      `investment_verdict IN ('Buy','Strong Buy')`,
      `created_at >= NOW() - INTERVAL '6 months'`,
    ];
    if (market === "KR") conditions.push(`(ticker ~ '^[0-9]')`);
    if (market === "US") conditions.push(`NOT (ticker ~ '^[0-9]')`);

    const rows = await rawQuery(
      `SELECT DISTINCT ON (ticker)
         id, ticker, company_name, english_name, industry, investment_verdict,
         target_price, start_price, created_at
       FROM analyses
       WHERE ${conditions.join(" AND ")}
       ORDER BY ticker, created_at DESC
       LIMIT 120`
    );

    // Yahoo Finance 현재가 배치 조회 (10개씩 병렬)
    async function fetchQuote(ticker: string): Promise<{ price: number | null; changePct: number | null }> {
      try {
        const isKR = /^\d{5,6}$/.test(ticker);
        if (isKR) {
          const [ks, kq] = await Promise.allSettled([
            yahooFinance.quote(`${ticker}.KS`),
            yahooFinance.quote(`${ticker}.KQ`),
          ]);
          const q = (ks.status === "fulfilled" && (ks.value as any)?.regularMarketPrice)
            ? ks.value
            : (kq.status === "fulfilled" ? kq.value : null);
          if (!q) return { price: null, changePct: null };
          return {
            price: (q as any).regularMarketPrice ?? null,
            changePct: (q as any).regularMarketChangePercent ?? null,
          };
        } else {
          const q = await yahooFinance.quote(ticker);
          return {
            price: (q as any).regularMarketPrice ?? null,
            changePct: (q as any).regularMarketChangePercent ?? null,
          };
        }
      } catch { return { price: null, changePct: null }; }
    }

    // 10개씩 배치
    const BATCH = 10;
    const quotes: Map<string, { price: number | null; changePct: number | null }> = new Map();
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((r: any) => fetchQuote(r.ticker)));
      batch.forEach((r: any, j: number) => quotes.set(r.ticker, results[j]));
    }

    // 상승여력 계산 후 필터링
    const items = rows
      .map((r: any) => {
        const q = quotes.get(r.ticker) ?? { price: null, changePct: null };
        const currentPrice = q.price;
        const targetPrice = r.target_price as number;
        const upside = currentPrice && currentPrice > 0
          ? ((targetPrice - currentPrice) / currentPrice) * 100
          : null;
        return {
          id: r.id as number,
          ticker: r.ticker as string,
          companyName: r.company_name as string,
          englishName: (r.english_name ?? null) as string | null,
          industry: (r.industry ?? null) as string | null,
          investmentVerdict: r.investment_verdict as string,
          targetPrice,
          startPrice: (r.start_price ?? null) as number | null,
          currentPrice,
          upside,
          todayChangePct: q.changePct,
          analysisDate: r.created_at,
        };
      })
      .filter(item => item.upside !== null && item.upside >= minUpside)
      .sort((a, b) => (b.upside ?? 0) - (a.upside ?? 0));

    cache.set(CACHE_KEY, items, SCANNER_TTL);
    res.json(items);
  } catch (err: any) {
    console.error("[GET /analysis/scanner]", err?.message);
    res.status(500).json({ error: "scanner error", detail: err?.message });
  }
});

// ─── 공유 전용 공개 엔드포인트 (인증 불필요, is_public=true인 경우만) ────────
router.get("/share/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const aRows = await rawQuery(
      `SELECT * FROM analyses WHERE id = $1 AND is_public = 'true' LIMIT 1`,
      [id]
    );
    if (!aRows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const stepsRows = await rawQuery(`SELECT * FROM analysis_steps WHERE analysis_id = $1`, [id]);
    res.json(formatAnalysis(mapAnalysisRow(aRows[0]), stepsRows.map(mapStepRow)));
  } catch (err: any) {
    console.error("[GET /analysis/share/:id] error:", err?.message, err?.cause?.message);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/share/:id/text", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).send("Invalid id"); return; }
  try {
    const aRows = await rawQuery(
      `SELECT * FROM analyses WHERE id = $1 AND is_public = 'true' LIMIT 1`,
      [id]
    );
    if (!aRows[0]) { res.status(404).send("Not found"); return; }
    const stepsRows = await rawQuery(
      `SELECT * FROM analysis_steps WHERE analysis_id = $1 ORDER BY id ASC`,
      [id]
    );
    const a = mapAnalysisRow(aRows[0]);

    const STEP_NAMES: Record<string, string> = {
      company_intro:      "브리핑",
      industry_analysis:  "매크로 및 산업 분석",
      catalyst_analysis:  "투자 촉매 및 수급 분석",
      company_analysis:   "실적 전망",
      relative_valuation: "적정주가 산출",
      market_analysis:    "기술적 분석",
      investment_strategy:"최종 결론",
    };
    const STEP_ORDER_LOCAL = [
      "company_intro","industry_analysis","catalyst_analysis",
      "company_analysis","relative_valuation","market_analysis","investment_strategy",
    ];

    function cleanContent(raw: string): string {
      return raw
        .replace(/\nCHART_DATA:\{[^\n]+\}(\nEVENTS_DATA:\[[^\n]*\])?(\nVALUATION_DATA:\{[^\n]+\})?(\nFINAL_VALUATION_DATA:\{[^\n]+\})?\s*$/m, "")
        .replace(/\nFINAL_VALUATION_DATA:\{[^\n]+\}\s*$/m, "")
        .replace(/FINAL_VALUATION_DATA:\{[^}]+\}/g, "")
        .replace(/```json[\s\S]*?```/g, "")
        .replace(/\{[\s\S]*?"verdict"[\s\S]*?\}/g, "")
        .replace(/^\[STEP \d+\][^\n]*/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    const steps = stepsRows
      .filter((s: any) => s.status === "completed" && s.content)
      .sort((a: any, b: any) => STEP_ORDER_LOCAL.indexOf(a.step_key) - STEP_ORDER_LOCAL.indexOf(b.step_key));

    const lines: string[] = [];
    lines.push(`# ${a.companyName} (${a.ticker}) 리서치 리포트`);
    lines.push(`분석일: ${a.createdAt ? new Date(a.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "—"}`);
    if (a.investmentVerdict) lines.push(`투자 판정: ${a.investmentVerdict}`);
    if (a.targetPrice) lines.push(`적정주가: ${a.targetPrice.toLocaleString()}`);
    lines.push(`\n${"=".repeat(60)}\n`);

    for (const step of steps) {
      const stepName = STEP_NAMES[step.step_key] ?? step.step_key;
      lines.push(`## ${stepName}`);
      lines.push(cleanContent(step.content ?? ""));
      lines.push(`\n${"─".repeat(40)}\n`);
    }

    const text = lines.join("\n");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(text);
  } catch (err: any) {
    console.error("[GET /analysis/share/:id/text] error:", err?.message);
    res.status(500).send("Server error");
  }
});

router.get("/public-stats", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: analysesTable.id,
        ticker: analysesTable.ticker,
        companyName: analysesTable.companyName,
        englishName: analysesTable.englishName,
        industry: analysesTable.industry,
        investmentVerdict: analysesTable.investmentVerdict,
        targetPrice: analysesTable.targetPrice,
        startPrice: analysesTable.startPrice,
        createdAt: analysesTable.createdAt,
        userId: analysesTable.userId,
      })
      .from(analysesTable)
      .where(eq(analysesTable.status, "completed"));

    const total = rows.length;

    const verdictMap: Record<string, number> = {};
    for (const r of rows) {
      const v = r.investmentVerdict ?? "미분류";
      verdictMap[v] = (verdictMap[v] ?? 0) + 1;
    }

    const tickerCount: Record<string, { count: number; companyName: string; englishName: string | null; latestVerdict: string | null; latestId: number }> = {};
    for (const r of rows) {
      if (!tickerCount[r.ticker]) {
        tickerCount[r.ticker] = { count: 0, companyName: r.companyName, englishName: r.englishName ?? null, latestVerdict: null, latestId: r.id };
      }
      tickerCount[r.ticker].count++;
      if (r.id > tickerCount[r.ticker].latestId) {
        tickerCount[r.ticker].latestId = r.id;
        tickerCount[r.ticker].latestVerdict = r.investmentVerdict ?? null;
        tickerCount[r.ticker].companyName = r.companyName;
        if (r.englishName) tickerCount[r.ticker].englishName = r.englishName;
      }
    }

    const uniqueTickers = Object.keys(tickerCount);
    const uniqueTickerCount = uniqueTickers.length;
    const krCount = uniqueTickers.filter(t => /^\d{6}$/.test(t)).length;
    const usCount = uniqueTickers.filter(t => !/^\d{6}$/.test(t)).length;
    const topTickers = Object.entries(tickerCount)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([ticker, d]) => ({ ticker, companyName: d.companyName, englishName: d.englishName, count: d.count, latestVerdict: d.latestVerdict, latestId: d.latestId }));

    // ── 기간별 topTickers ──────────────────────────────────────────────────────
    const nowMs = Date.now();
    const DAY_MS = 1000 * 60 * 60 * 24;
    function buildPeriodTopTickers(minusMs: number | null) {
      const filtered = minusMs == null ? rows : rows.filter(r => r.createdAt && new Date(r.createdAt).getTime() >= nowMs - minusMs);
      const map: Record<string, { count: number; companyName: string; englishName: string | null; latestVerdict: string | null; latestId: number }> = {};
      for (const r of filtered) {
        if (!map[r.ticker]) map[r.ticker] = { count: 0, companyName: r.companyName, englishName: r.englishName ?? null, latestVerdict: null, latestId: r.id };
        map[r.ticker].count++;
        if (r.id > map[r.ticker].latestId) {
          map[r.ticker].latestId = r.id;
          map[r.ticker].latestVerdict = r.investmentVerdict ?? null;
          map[r.ticker].companyName = r.companyName;
          if (r.englishName) map[r.ticker].englishName = r.englishName;
        }
      }
      return Object.entries(map)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([ticker, d]) => ({ ticker, companyName: d.companyName, englishName: d.englishName, count: d.count, latestVerdict: d.latestVerdict, latestId: d.latestId }));
    }
    const topTickersByPeriod = {
      day:   buildPeriodTopTickers(DAY_MS),
      week:  buildPeriodTopTickers(7 * DAY_MS),
      month: buildPeriodTopTickers(30 * DAY_MS),
      all:   buildPeriodTopTickers(null),
    };

    // ── 최근 14일 일별 분석 추이 ──────────────────────────────────────────────
    const recentTrend: { date: string; count: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const count = rows.filter(r => r.createdAt && r.createdAt.toISOString().slice(0, 10) === dateStr).length;
      recentTrend.push({ date: dateStr, count });
    }

    // ── 요일별 분석 분포 (0=일, 1=월, ..., 6=토) ──────────────────────────────
    const weekdayDist = [0, 0, 0, 0, 0, 0, 0]; // sun~sat
    for (const r of rows) {
      if (r.createdAt) weekdayDist[new Date(r.createdAt).getDay()]++;
    }

    // ── 매수 신호 비율 (Strong Buy + Buy) ────────────────────────────────────
    const bullCount = (verdictMap["Strong Buy"] ?? 0) + (verdictMap["Buy"] ?? 0);
    const bullRate = total > 0 ? Math.round((bullCount / total) * 100) : null;

    // ── 재분석률 (2회 이상 분석된 종목 비율) ────────────────────────────────────
    const repeatTickerCount = Object.values(tickerCount).filter(d => d.count >= 2).length;
    const repeatRate = uniqueTickerCount > 0 ? Math.round((repeatTickerCount / uniqueTickerCount) * 100) : null;

    res.json({ total, verdictMap, krCount, usCount, topTickers, topTickersByPeriod, uniqueTickerCount, recentTrend, weekdayDist, bullRate, repeatRate, repeatTickerCount });
  } catch (err) {
    console.error("[GET /analysis/public-stats]", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/period-stats", async (_req, res) => {
  try {
    // 성과 트래킹 기준일 (system_settings에서 읽음)
    const settingRow = await rawQuery<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = 'performance_tracking_start' LIMIT 1`
    );
    const trackingStart = settingRow[0]?.value ?? null;

    // 완료된 분석 + model_insights 조인
    const rows = await rawQuery<{
      analysis_id: number;
      created_at: string;
      investment_verdict: string | null;
      outcome: string | null;
      price_return: number | null;
      days_elapsed: number | null;
    }>(
      trackingStart
        ? `
          SELECT
            a.id               AS analysis_id,
            a.created_at,
            a.investment_verdict,
            mi.outcome,
            mi.price_return,
            mi.days_elapsed
          FROM analyses a
          LEFT JOIN model_insights mi ON mi.analysis_id = a.id
          WHERE a.status = 'completed'
            AND a.created_at >= $1
          ORDER BY a.created_at
        `
        : `
          SELECT
            a.id               AS analysis_id,
            a.created_at,
            a.investment_verdict,
            mi.outcome,
            mi.price_return,
            mi.days_elapsed
          FROM analyses a
          LEFT JOIN model_insights mi ON mi.analysis_id = a.id
          WHERE a.status = 'completed'
          ORDER BY a.created_at
        `,
      trackingStart ? [trackingStart] : []
    );

    const now = Date.now();

    // 기간 버킷 정의 (작성일 기준 X일 이상 경과한 분석)
    const BUCKETS = [
      { key: "1mo",  label: "1개월+", minDays: 30  },
      { key: "3mo",  label: "3개월+", minDays: 90  },
      { key: "6mo",  label: "6개월+", minDays: 180 },
      { key: "12mo", label: "1년+",   minDays: 365 },
    ];

    const result = BUCKETS.map(({ key, label, minDays }) => {
      const eligible = rows.filter(r => {
        const ageDays = (now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24);
        return ageDays >= minDays;
      });

      const total        = eligible.length;
      const reviewed     = eligible.filter(r => r.outcome && r.outcome !== "pending");
      const hitTarget    = reviewed.filter(r => r.outcome === "hit_target");
      const hitStop      = reviewed.filter(r => r.outcome === "hit_stoploss");
      const ongoing      = reviewed.filter(r => r.outcome === "ongoing");
      const withReturn   = eligible.filter(r => r.price_return != null);
      const avgReturn    = withReturn.length
        ? withReturn.reduce((s, r) => s + (r.price_return ?? 0), 0) / withReturn.length
        : null;

      // 방향 적중률 계산 (price_return 있는 분석 기준)
      const isBullish = (v: string | null) => {
        if (!v) return false;
        return /매수|적극매수|Strong Buy|Buy/i.test(v);
      };
      const isBearish = (v: string | null) => {
        if (!v) return false;
        return /매도|적극매도|Strong Sell|Sell/i.test(v);
      };
      const directional = withReturn.filter(r => isBullish(r.investment_verdict) || isBearish(r.investment_verdict));
      const directionCorrect = directional.filter(r =>
        (isBullish(r.investment_verdict) && (r.price_return ?? 0) > 0) ||
        (isBearish(r.investment_verdict) && (r.price_return ?? 0) < 0)
      );
      const directionAccuracy = directional.length > 0
        ? (directionCorrect.length / directional.length) * 100
        : null;

      return {
        key, label, minDays, total,
        reviewedCount: reviewed.length,
        hitTargetCount: hitTarget.length,
        hitStopCount: hitStop.length,
        ongoingCount: ongoing.length,
        directionAccuracy,
        directionCorrectCount: directionCorrect.length,
        directionTotalCount: directional.length,
        avgReturn,
      };
    });

    res.json({ periods: result });
  } catch (err) {
    console.error("[GET /analysis/period-stats]", err);
    res.status(500).json({ error: "Failed to fetch period stats" });
  }
});

// ─── GET /api/analysis/ticker-history/:ticker ────────────────────────────────
// 같은 종목의 과거 분석 히스토리 (버전 타임라인용)
router.get("/ticker-history/:ticker", async (req, res) => {
  try {
    const ticker = validateTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: "유효하지 않은 ticker" });
    const { rows } = await pool.query(
      `SELECT id, ticker, company_name, industry, status, investment_verdict, target_price,
              start_price, created_at, token_count, estimated_cost_usd
       FROM analyses
       WHERE ticker = $1 AND status = 'done' AND is_public = 'true'
       ORDER BY created_at DESC
       LIMIT 12`,
      [ticker]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "DB error" });
  }
});

// ─── GET /api/analysis/schedules ─────────────────────────────────────────────
router.get("/schedules", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });
  try {
    const r = await pool.query(
      `SELECT * FROM analysis_schedules WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    res.json(r.rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "DB error" });
  }
});

// ─── POST /api/analysis/:id/schedule ─────────────────────────────────────────
router.post("/:id/schedule", async (req, res) => {
  const analysisId = parseInt(req.params.id);
  if (isNaN(analysisId)) return res.status(400).json({ error: "Invalid id" });
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });

  const { frequency } = req.body as { frequency?: string };
  if (!["weekly", "biweekly", "monthly"].includes(frequency ?? ""))
    return res.status(400).json({ error: "frequency는 weekly|biweekly|monthly 중 하나여야 합니다" });

  // 분석 정보 조회
  const aRows = await rawQuery(`SELECT * FROM analyses WHERE id = $1 LIMIT 1`, [analysisId]);
  const analysis = aRows[0];
  if (!analysis) return res.status(404).json({ error: "분석을 찾을 수 없습니다" });

  // 최대 5개 제한
  const countRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM analysis_schedules WHERE user_id = $1 AND enabled = true`,
    [userId]
  );
  if (parseInt(countRes.rows[0].cnt) >= 5) {
    return res.status(429).json({ error: "활성 스케줄은 최대 5개까지 등록할 수 있습니다" });
  }

  // 동일 종목 스케줄 중복 확인
  const dup = await pool.query(
    `SELECT id FROM analysis_schedules WHERE user_id = $1 AND ticker = $2 AND enabled = true`,
    [userId, analysis.ticker]
  );
  if (dup.rows.length > 0) {
    // 기존 스케줄 업데이트
    const days = frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : 30;
    const nextRun = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const upd = await pool.query(
      `UPDATE analysis_schedules
       SET frequency = $1, next_run_at = $2, source_analysis_id = $3, enabled = true
       WHERE id = $4 RETURNING *`,
      [frequency, nextRun, analysisId, dup.rows[0].id]
    );
    return res.json(upd.rows[0]);
  }

  const days = frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : 30;
  const nextRun = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const ins = await pool.query(
    `INSERT INTO analysis_schedules
       (user_id, ticker, company_name, industry, additional_context, frequency, next_run_at, source_analysis_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      userId,
      analysis.ticker,
      analysis.company_name,
      analysis.industry ?? null,
      analysis.additional_context ?? null,
      frequency,
      nextRun,
      analysisId,
    ]
  );
  res.json(ins.rows[0]);
});

// ─── DELETE /api/analysis/schedules/:scheduleId ───────────────────────────────
router.delete("/schedules/:scheduleId", async (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId);
  if (isNaN(scheduleId)) return res.status(400).json({ error: "Invalid scheduleId" });
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });
  try {
    const r = await pool.query(
      `DELETE FROM analysis_schedules WHERE id = $1 AND user_id = $2 RETURNING id`,
      [scheduleId, userId]
    );
    if (!r.rowCount) return res.status(404).json({ error: "스케줄을 찾을 수 없습니다" });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ─── PATCH /api/analysis/schedules/:scheduleId/toggle ─────────────────────────
router.patch("/schedules/:scheduleId/toggle", async (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId);
  if (isNaN(scheduleId)) return res.status(400).json({ error: "Invalid scheduleId" });
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "로그인이 필요합니다" });
  try {
    const r = await pool.query(
      `UPDATE analysis_schedules SET enabled = NOT enabled WHERE id = $1 AND user_id = $2 RETURNING *`,
      [scheduleId, userId]
    );
    if (!r.rowCount) return res.status(404).json({ error: "스케줄을 찾을 수 없습니다" });
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ─── GET /analyses/queue-status ──────────────────────────────────────────────
router.get("/queue-status", (_req, res) => {
  const queueFull = pipelineSemaphore.waiting >= MAX_QUEUE_SIZE;
  res.json({
    pipelines: {
      active: pipelineSemaphore.active,
      waiting: pipelineSemaphore.waiting,
      max: MAX_CONCURRENT_PIPELINES,
      maxQueue: MAX_QUEUE_SIZE,
      queueFull,
    },
    gemini: {
      active: geminiSemaphore.active,
      waiting: geminiSemaphore.waiting,
      max: MAX_CONCURRENT_GEMINI,
    },
  });
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const aRows = await rawQuery(`SELECT * FROM analyses WHERE id = $1 LIMIT 1`, [id]);
    if (!aRows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const analysisUserId = aRows[0].user_id ?? null;
    const requestUserId = getUserId(req);
    const isPublic = aRows[0].is_public === 'true' || aRows[0].is_public === true;

    if (analysisUserId && analysisUserId !== requestUserId && !isPublic) {
      // 관리자는 모든 보고서 열람 가능
      const adminCheck = await pool.query(`SELECT 1 FROM admins WHERE user_id = $1`, [requestUserId]);
      if (!adminCheck.rowCount) {
        res.status(403).json({ error: "권한이 없습니다" });
        return;
      }
    }

    const stepsRows = await rawQuery(`SELECT * FROM analysis_steps WHERE analysis_id = $1`, [id]);
    res.json(formatAnalysis(mapAnalysisRow(aRows[0]), stepsRows.map(mapStepRow)));
  } catch (err: any) {
    console.error("[GET /analysis/:id] error:", err?.message, err?.cause?.message);
    res.status(500).json({ error: "DB error" });
  }
});

// ─── POST /analyses/:id/step ─────────────────────────────────────────────────
// SSE 스트리밍 핸들러. executeStep()으로 단계를 실행하고, 클라이언트 연결이
// 끊기면 runPipelineBackground()를 시작해 나머지 단계를 완주한다.
router.post("/:id/step", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { stepKey } = req.body as { stepKey: AgentKey };
  if (!stepKey || !AGENTS[stepKey]) { res.status(400).json({ error: "Invalid stepKey" }); return; }

  const aRows = await rawQuery(`SELECT * FROM analyses WHERE id = $1 LIMIT 1`, [id]);
  const analysis = aRows[0] ? mapAnalysisRow(aRows[0]) : null;
  if (!analysis) { res.status(404).json({ error: "Analysis not found" }); return; }

  const stepsRaw = await rawQuery(`SELECT * FROM analysis_steps WHERE analysis_id = $1`, [id]);
  const existingSteps = [...stepsRaw.map(mapStepRow)].sort(
    (a, b) => STEP_ORDER.indexOf(a.stepKey as AgentKey) - STEP_ORDER.indexOf(b.stepKey as AgentKey)
  );

  const alreadyRun = existingSteps.some((s) => s.stepKey === stepKey);
  if (alreadyRun) { res.status(409).json({ error: "Step already completed" }); return; }

  const lockKey = `${id}-${stepKey}`;
  if (runningStepsLock.get(lockKey)) { res.status(409).json({ error: "Step already running" }); return; }
  runningStepsLock.set(lockKey, true);

  // SSE 스트리밍 헤더
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let clientGone = false;
  req.on("close", () => { clientGone = true; });

  const safeWrite = (data: object) => {
    if (clientGone) return;
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { clientGone = true; }
  };

  try {
    const nextStep = await executeStep(id, stepKey, analysis, existingSteps, safeWrite);
    safeWrite({ done: true });
    if (!clientGone) res.end();

    // 클라이언트가 이탈했으면 나머지 단계를 백그라운드에서 완주
    if (clientGone && nextStep) {
      console.log(`[pipeline-bg] Client gone after ${stepKey} — running remaining steps in background for analysis ${id}`);
      runPipelineBackground(id).catch(console.error);
    }
  } finally {
    runningStepsLock.delete(lockKey);
  }
});

// ─── POST /analyses/:id/run-pipeline ─────────────────────────────────────────
// 백그라운드 파이프라인 시작 엔드포인트 (fire-and-forget).
// 분석 페이지 진입/재진입 시 클라이언트가 호출하여 미완료 단계를 서버에서 완주한다.
router.post("/:id/run-pipeline", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const aRows = await rawQuery(`SELECT * FROM analyses WHERE id = $1 LIMIT 1`, [id]);
  const analysis = aRows[0] ? mapAnalysisRow(aRows[0]) : null;
  if (!analysis) return res.status(404).json({ error: "Analysis not found" });

  // error 상태지만 미완료 스텝이 있으면 in_progress로 복원 후 재시도
  if (analysis.status === "error") {
    const stepsRaw = await rawQuery(
      `SELECT step_key FROM analysis_steps WHERE analysis_id = $1`,
      [id]
    );
    const completedKeys = new Set(stepsRaw.map((r: any) => r.step_key));
    const hasIncompleteSteps = STEP_ORDER.some(s => !completedKeys.has(s));
    if (hasIncompleteSteps) {
      console.log(`[run-pipeline] Analysis ${id} in error state with incomplete steps — resetting to in_progress`);
      await rawQuery(
        `UPDATE analyses SET status='in_progress', current_step=NULL, error_message=NULL, updated_at=NOW() WHERE id=$1`,
        [id]
      );
      enqueueAnalysis(id).catch(console.error);
      return res.json({ ok: true, resumed: true });
    }
    return res.json({ ok: true, status: "error" });
  }

  // 데이터 수집이 아직 진행 중이면 파이프라인 시작 보류
  if (pendingDataFetch.has(id)) {
    return res.json({ ok: true, status: "fetching_data", message: "데이터 수집 중..." });
  }

  // 이미 큐 대기 중이거나 완료 상태면 재진입 방지
  if (analysis.status !== "in_progress" && analysis.status !== "queued") {
    return res.json({ ok: true, status: analysis.status });
  }
  // 이미 queued 상태라면 추가 enqueue 불필요 (semaphore 대기 중)
  if (analysis.status === "queued") {
    return res.json({ ok: true, status: "queued", queued: true });
  }

  enqueueAnalysis(id).catch(console.error);
  res.json({ ok: true });
});

// ─── PATCH /analyses/:id/memo ────────────────────────────────────────────────
router.patch("/:id/memo", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { memo } = req.body as { memo?: string };
  if (typeof memo !== "string" && memo !== null && memo !== undefined) {
    return res.status(400).json({ error: "memo must be a string or null" });
  }
  try {
    await rawQuery(`UPDATE analyses SET memo=$1, updated_at=NOW() WHERE id=$2`, [memo ?? null, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});

// ─── POST /analyses/:id/feedback ─────────────────────────────────────────────
router.post("/:id/feedback", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { rating, feedback } = req.body as { rating?: number; feedback?: string };
  if (rating !== undefined && (typeof rating !== "number" || rating < 1 || rating > 5)) {
    return res.status(400).json({ error: "rating은 1~5 사이 숫자입니다" });
  }

  try {
    // 저장 전 정제 (프롬프트 인젝션 방지)
    const cleanFeedback = typeof feedback === "string" && feedback.trim()
      ? sanitizeFeedback(feedback)
      : null;

    const updRows = await rawQuery(
      `UPDATE analyses SET user_rating=$1, user_feedback=$2, updated_at=NOW() WHERE id=$3 RETURNING id`,
      [rating ?? null, cleanFeedback, id]
    );

    if (!updRows[0]) return res.status(404).json({ error: "Analysis not found" });

    // 사용자 피드백을 model_insights lesson으로 자동 반영 (부정 피드백 우선)
    if (cleanFeedback) {
      try {
        const aRows2 = await rawQuery(`SELECT * FROM analyses WHERE id=$1 LIMIT 1`, [id]);
        const a = aRows2[0] ? mapAnalysisRow(aRows2[0]) : null;
        if (a) {
          const verdictLabel = rating && rating <= 2 ? "[부정 피드백]" : "[긍정 피드백]";
          const lessonNote = `${verdictLabel} ${a.companyName}(${a.ticker}) 사용자 평가 ${rating ?? "?"}/5: ${cleanFeedback}`;
          await rawQuery(
            `INSERT INTO model_insights (ticker, company_name, industry, verdict, entry_price, target_price, price_at_review, price_return, days_elapsed, outcome, lesson)
             VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,'user_feedback',$7)`,
            [a.ticker, a.companyName, a.industry, a.investmentVerdict ?? null, a.entryPrice ?? null, a.targetPrice ?? null, lessonNote]
          );
        }
      } catch {
        // lesson 기록 실패해도 피드백 저장은 성공
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB error" });
  }
});


export default router;
