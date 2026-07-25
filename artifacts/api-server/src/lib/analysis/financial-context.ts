// 재무 컨텍스트 빌더 — 티커 해석, Naver/Yahoo 재무 데이터, 뉴스 수집
import { db, pool } from "@workspace/db";
import { normalizeTicker } from "@workspace/shared";
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
import { buildFmpContext } from "../fmp-client.js";
import YahooFinance from "yahoo-finance2";
import { rawQuery, dbCacheGet, dbCacheSet } from "./store.js";
import { getKRXSectorPeerContext, getDartCompetitorPeerContext, getDartCompetitorTickerPeers, KOREAN_SECTOR_MULTIPLES } from "./korea-context.js";
import { extractJsonSafe } from "./json-repair.js";

const yahooFinance = new YahooFinance();

// ─── Ticker resolution ────────────────────────────────────────────────────────

async function tryQuoteSummary(symbol: string) {
  try {
    const result = await yahooFinance.quoteSummary(symbol, {
      modules: ["quoteType", "summaryProfile"] as any,
    });
    const companyName =
      (result.quoteType as any)?.longName ||
      (result.quoteType as any)?.shortName ||
      null;
    if (!companyName || /^\d{6}/.test(companyName)) return null;
    const industry =
      (result.summaryProfile as any)?.industry ||
      (result.summaryProfile as any)?.sector ||
      "일반";
    return { companyName, industry };
  } catch {
    return null;
  }
}

async function fetchTickerInfo(ticker: string): Promise<{ companyName: string; englishName: string | null; industry: string; resolvedSymbol: string }> {
  await loadKRXList();

  if (/^\d{6}$/.test(ticker)) {
    const [ksResult, kqResult] = await Promise.all([
      tryQuoteSummary(`${ticker}.KS`),
      tryQuoteSummary(`${ticker}.KQ`),
    ]);
    const yahooResult = kqResult ?? ksResult;
    const resolvedSymbol = kqResult ? `${ticker}.KQ` : `${ticker}.KS`;
    const koreanName = lookupKoreanName(ticker);
    const englishName = yahooResult?.companyName ?? null;
    const companyName = koreanName ?? englishName ?? ticker;
    return { companyName, englishName: englishName !== companyName ? englishName : null, industry: yahooResult?.industry ?? "일반", resolvedSymbol };
  }

  const result = await tryQuoteSummary(ticker);
  const koreanName = lookupKoreanName(ticker);
  const englishName = result?.companyName ?? null;
  const companyName = koreanName ?? englishName ?? ticker;
  return { companyName, englishName: englishName !== companyName ? englishName : null, industry: result?.industry ?? "일반", resolvedSymbol: ticker };
}

// ─── Naver Finance data fetching ─────────────────────────────────────────────

const NAVER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Referer": "https://m.stock.naver.com/",
};

function naverFmt(val: string | undefined | null): number | null {
  if (!val) return null;
  const n = Number(String(val).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

async function fetchNaverFinanceData(code: string): Promise<{ context: string; naverSharesCalc: number | null }> {
  const cacheKey = `naver:${code}`;
  const cached = cache.get<{ context: string; naverSharesCalc: number | null }>(cacheKey);
  if (cached) return cached;

  // DB 영속 캐시 체크 — 재시작 후에도 8시간 재사용
  const dbNaverKey = `naver_fin:${code}`;
  const dbCached = await dbCacheGet<{ context: string; naverSharesCalc: number | null }>(dbNaverKey);
  if (dbCached) {
    cache.set(cacheKey, dbCached, TTL.NAVER_PRICE);
    console.log(`[naver-fin] DB 캐시 히트: ${code}`);
    return dbCached;
  }

  const lines: string[] = [];
  let naverSharesCalc: number | null = null;

  // Fetch all endpoints in parallel
  const [basicResult, integrationResult, summaryResult, priceResult] = await Promise.allSettled([
    fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, { headers: NAVER_HEADERS }).then(r => r.ok ? r.json() : null),
    fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, { headers: NAVER_HEADERS }).then(r => r.ok ? r.json() : null),
    fetch(`https://m.stock.naver.com/api/stock/${code}/finance/summary`, { headers: NAVER_HEADERS }).then(r => r.ok ? r.json() : null),
    fetch(`https://m.stock.naver.com/api/stock/${code}/price?pageSize=65`, { headers: NAVER_HEADERS }).then(r => r.ok ? r.json() : null),
  ]);

  const basic: any = basicResult.status === "fulfilled" ? basicResult.value : null;
  const integration: any = integrationResult.status === "fulfilled" ? integrationResult.value : null;
  const summary: any = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const priceHistory: any[] = priceResult.status === "fulfilled" && Array.isArray(priceResult.value) ? priceResult.value : [];

  // ── 1. 현재 시세 (basic) ──────────────────────────────────────────────────
  lines.push("\n=== 네이버증권 실시간 시세 데이터 ===");
  if (basic) {
    const close = naverFmt(basic.closePrice);
    const exchName = basic.stockExchangeName ?? basic.stockExchangeType?.nameKor ?? "";
    if (close) lines.push(`KRX(${exchName}) 최종 종가: ${close.toLocaleString("ko-KR")}원`);
    const fluctRatio = basic.compareToPreviousPrice?.text ?? "";
    const fluctPct = basic.fluctuationsRatio ?? "";
    if (fluctRatio && fluctPct) lines.push(`당일 등락: ${fluctRatio} ${fluctPct}%`);

    const nxt = basic.overMarketPriceInfo;
    if (nxt?.overPrice) {
      const nxtPrice = naverFmt(nxt.overPrice);
      const sessionType = nxt.tradingSessionType === "AFTER_MARKET" ? "NXT 장후거래" : nxt.tradingSessionType === "PRE_MARKET" ? "NXT 장전거래" : "NXT";
      const status = nxt.overMarketStatus === "CLOSE" ? "(마감)" : nxt.overMarketStatus === "OPEN" ? "(거래중)" : "";
      if (nxtPrice) {
        lines.push(`${sessionType}${status} 최종가: ${nxtPrice.toLocaleString("ko-KR")}원 (등락 ${nxt.fluctuationsRatio}%, 변동 ${nxt.compareToPreviousClosePrice}원)`);
        const tradedAt = nxt.localTradedAt ? ` [${nxt.localTradedAt.replace("T", " ").substring(0, 16)} KST]` : "";
        lines.push(`NXT 거래 시각:${tradedAt}`);
      }
    }
  }

  // ── 2. 핵심 지표 (integration) ────────────────────────────────────────────
  if (integration) {
    lines.push("\n[네이버증권 핵심 투자지표]");
    const infoMap: Record<string, string> = {};
    for (const item of (integration.totalInfos ?? [])) {
      infoMap[item.code] = item.value ?? "";
    }
    if (infoMap.marketValue)         lines.push(`시가총액: ${infoMap.marketValue}`);

    // 발행주식수 역산: 시가총액(원) / 현재가(원)
    if (infoMap.marketValue && basic) {
      try {
        // 네이버 시총 형식: "648조 5,592억" 또는 "5,592억" 등
        const mcapStr = infoMap.marketValue;
        const triMatch = mcapStr.match(/([0-9,]+)조/);
        const hundMatch = mcapStr.match(/([0-9,]+)억/);
        const tri  = triMatch  ? Number(triMatch[1].replace(/,/g, ""))  * 1e12 : 0;
        const hund = hundMatch ? Number(hundMatch[1].replace(/,/g, "")) * 1e8  : 0;
        const mcapKRW = tri + hund;
        const currentPrice = naverFmt(basic.closePrice);
        if (mcapKRW > 0 && currentPrice && currentPrice > 0) {
          const sharesCalc = Math.round(mcapKRW / currentPrice);
          naverSharesCalc = sharesCalc; // 전체 함수 공유용 저장
          lines.push(`⭐ 발행주식수 [KRX/Naver 기준, 권장]: ${sharesCalc.toLocaleString("ko-KR")}주 (${(sharesCalc / 1e8).toFixed(4)}억주)`);
          lines.push(`  계산식: 네이버 시총 ${mcapKRW.toLocaleString("ko-KR")}원 ÷ 현재가 ${currentPrice.toLocaleString("ko-KR")}원 = ${sharesCalc.toLocaleString("ko-KR")}주`);
          lines.push(`⛔ 밸류에이션 주당가치 계산 시 반드시 이 수치(${sharesCalc.toLocaleString("ko-KR")}주)를 사용할 것. Yahoo Finance 주식수가 다를 경우 이 KRX 기준값 우선.`);
        }
      } catch { /* ignore */ }
    }

    if (infoMap.foreignRate)         lines.push(`외국인 보유 비중: ${infoMap.foreignRate}`);
    if (infoMap.highPriceOf52Weeks)  lines.push(`52주 최고가: ${infoMap.highPriceOf52Weeks}원`);
    if (infoMap.lowPriceOf52Weeks)   lines.push(`52주 최저가: ${infoMap.lowPriceOf52Weeks}원`);
    if (infoMap.per)                 lines.push(`PER: ${infoMap.per} (기준 ${integration.totalInfos?.find((x: any) => x.code === "per")?.valueDesc ?? ""})`);
    if (infoMap.eps)                 lines.push(`EPS: ${infoMap.eps}`);
    if (infoMap.cnsPer)              lines.push(`컨센서스 추정 PER: ${infoMap.cnsPer}`);
    if (infoMap.cnsEps)              lines.push(`컨센서스 추정 EPS: ${infoMap.cnsEps}`);
    if (infoMap.pbr)                 lines.push(`PBR: ${infoMap.pbr}`);
    if (infoMap.bps)                 lines.push(`BPS: ${infoMap.bps}`);
    if (infoMap.dividendYieldRatio)  lines.push(`배당수익률: ${infoMap.dividendYieldRatio}`);
    if (infoMap.dividend)            lines.push(`주당배당금: ${infoMap.dividend}`);

    // ── 3. 투자자별 순매수 추이 (dealTrendInfos) ─────────────────────────
    const deals: any[] = integration.dealTrendInfos ?? [];
    if (deals.length > 0) {
      lines.push("\n[네이버 투자자별 순매수 (최근 5일, 주식수 기준)]");
      lines.push("날짜 | 외국인 | 기관 | 개인 | 종가");
      for (const d of deals) {
        const date = `${d.bizdate.slice(0, 4)}-${d.bizdate.slice(4, 6)}-${d.bizdate.slice(6, 8)}`;
        const fgn = d.foreignerPureBuyQuant ?? "-";
        const org = d.organPureBuyQuant ?? "-";
        const ind = d.individualPureBuyQuant ?? "-";
        const close = d.closePrice ?? "-";
        lines.push(`${date} | 외국인 ${fgn} | 기관 ${org} | 개인 ${ind} | 종가 ${close}원`);
      }
      // 5일 누적 순매수
      const totalFgn = deals.reduce((sum, d) => sum + (naverFmt(d.foreignerPureBuyQuant) ?? 0), 0);
      const totalOrg = deals.reduce((sum, d) => sum + (naverFmt(d.organPureBuyQuant) ?? 0), 0);
      lines.push(`5일 누적 순매수: 외국인 ${totalFgn.toLocaleString("ko-KR")}주 | 기관 ${totalOrg.toLocaleString("ko-KR")}주`);
      const latestFgnRatio = deals[0]?.foreignerHoldRatio;
      if (latestFgnRatio) lines.push(`최근 외국인 보유 비중: ${latestFgnRatio}`);
    }
  }

  // ── 4. 수익률 계산 (price history) ───────────────────────────────────────
  if (priceHistory.length >= 2) {
    lines.push("\n[네이버 최근 수익률]");
    const latestClose = naverFmt(priceHistory[0]?.closePrice);
    if (latestClose) {
      const calc = (days: number, label: string) => {
        const past = priceHistory[Math.min(days, priceHistory.length - 1)];
        const pastClose = naverFmt(past?.closePrice);
        if (pastClose && pastClose > 0) {
          const ret = ((latestClose - pastClose) / pastClose * 100).toFixed(1);
          lines.push(`최근 ${label} 수익률: ${Number(ret) >= 0 ? "+" : ""}${ret}% (${pastClose.toLocaleString("ko-KR")}원 → ${latestClose.toLocaleString("ko-KR")}원)`);
        }
      };
      calc(20, "1개월");
      calc(60, "3개월");
    }
  }

  // ── 5. 실적 데이터 (finance/summary) ─────────────────────────────────────
  if (summary) {
    const parseIncomeStatement = (stmtObj: any, label: string) => {
      const cols: string[][] = stmtObj?.columns ?? [];
      const titleList: any[] = stmtObj?.trTitleList ?? [];
      const periods: string[] = cols[0]?.slice(1) ?? [];
      const revenues = cols.find((c: string[]) => c[0] === "매출액")?.slice(1) ?? [];
      const opIncomes = cols.find((c: string[]) => c[0] === "영업이익")?.slice(1) ?? [];
      const netIncomes = cols.find((c: string[]) => c[0] === "당기순이익")?.slice(1) ?? [];
      if (!periods.length) return;
      lines.push(`\n[네이버 ${label} 실적 (단위: 억원, [E]=컨센서스예측)]`);
      periods.forEach((period: string, i: number) => {
        const isE = titleList[i]?.isConsensus === "Y" ? "[E] " : "";
        const rev = revenues[i] ? fmtNum(Number(revenues[i]) * 1e8, "KRW") : "-";
        const op = opIncomes[i] ? fmtNum(Number(opIncomes[i]) * 1e8, "KRW") : "-";
        const net = netIncomes[i] ? fmtNum(Number(netIncomes[i]) * 1e8, "KRW") : "-";
        const marginVal = (revenues[i] && opIncomes[i] && Number(revenues[i]) > 0)
          ? (Number(opIncomes[i]) / Number(revenues[i])) * 100
          : null;
        const margin = marginVal !== null
          ? ` (영업이익률 ${marginVal < 0 ? "적자" : `${marginVal.toFixed(1)}%`})`
          : "";
        lines.push(`  ${isE}${period}: 매출 ${rev} | 영업이익 ${op}${margin} | 순이익 ${net}`);
      });
    };

    parseIncomeStatement(summary.chartIncomeStatement?.annual, "연간");
    parseIncomeStatement(summary.chartIncomeStatement?.quarter, "분기");

    // ── Q확정 실적 → 연간 컨센서스 괴리 분석 (Naver 기준) ───────────────────────
    // Q1(또는 Q1+Q2) 확정 실적이 있을 때, 단순 연환산 vs Naver 연간 컨센서스를 비교해
    // "컨센서스 상향/하향 압력"을 수치로 주입 → AI가 전망치 조정 판단에 활용
    try {
      const curYear = new Date().getFullYear();

      // ① 현재 연도 Naver 연간 컨센서스 추출
      const aCols: string[][] = summary.chartIncomeStatement?.annual?.columns ?? [];
      const aTitleList: any[] = summary.chartIncomeStatement?.annual?.trTitleList ?? [];
      const aPeriods: string[] = aCols[0]?.slice(1) ?? [];
      const aRevs = aCols.find((c: string[]) => c[0] === "매출액")?.slice(1) ?? [];
      const aOps  = aCols.find((c: string[]) => c[0] === "영업이익")?.slice(1) ?? [];
      const aNets = aCols.find((c: string[]) => c[0] === "당기순이익")?.slice(1) ?? [];

      let cnsRev: number | null = null;
      let cnsOp:  number | null = null;
      let cnsNet: number | null = null;
      let cnsYear = curYear;
      for (let i = 0; i < aPeriods.length; i++) {
        const yr = parseInt(aPeriods[i].slice(0, 4), 10);
        if (aTitleList[i]?.isConsensus === "Y" && yr === curYear) {
          cnsRev  = aRevs[i]  ? Number(aRevs[i])  * 1e8 : null;
          cnsOp   = aOps[i]   ? Number(aOps[i])   * 1e8 : null;
          cnsNet  = aNets[i]  ? Number(aNets[i])  * 1e8 : null;
          cnsYear = yr;
          break;
        }
      }

      // ② 현재 연도 확정 분기 매출·영업이익 합산
      const qCols2: string[][] = summary.chartIncomeStatement?.quarter?.columns ?? [];
      const qTList: any[] = summary.chartIncomeStatement?.quarter?.trTitleList ?? [];
      const qPeriods2: string[] = qCols2[0]?.slice(1) ?? [];
      const qRevs2 = qCols2.find((c: string[]) => c[0] === "매출액")?.slice(1) ?? [];
      const qOps2  = qCols2.find((c: string[]) => c[0] === "영업이익")?.slice(1) ?? [];
      const qNets2 = qCols2.find((c: string[]) => c[0] === "당기순이익")?.slice(1) ?? [];

      type QActual = { qNum: number; rev: number; op: number; net: number | null };
      const confirmedQActuals: QActual[] = [];
      for (let i = 0; i < qPeriods2.length; i++) {
        const yr  = parseInt(qPeriods2[i].slice(0, 4), 10);
        const isE = qTList[i]?.isConsensus === "Y";
        if (!isE && yr === curYear) {
          const rev = Number(qRevs2[i]);
          const op  = Number(qOps2[i]);
          if (!isNaN(rev) && rev > 0) {
            const month = parseInt(qPeriods2[i].slice(5), 10);
            const qNum  = month > 0 ? Math.ceil(month / 3) : 0;
            const net   = qNets2[i] != null ? Number(qNets2[i]) : null;
            confirmedQActuals.push({
              qNum, rev: rev * 1e8, op: op * 1e8,
              net: (net != null && !isNaN(net)) ? net * 1e8 : null,
            });
          }
        }
      }

      // ③ 괴리 계산 및 주입
      if (confirmedQActuals.length > 0 && cnsRev != null) {
        const nConfirmed  = confirmedQActuals.length;
        const sumRev      = confirmedQActuals.reduce((s, d) => s + d.rev, 0);
        const sumOp       = confirmedQActuals.reduce((s, d) => s + d.op,  0);
        const sumNet      = confirmedQActuals.every(d => d.net != null)
          ? confirmedQActuals.reduce((s, d) => s + (d.net ?? 0), 0) : null;

        // 단순 연환산 (계절성 보정 없음 — 방향 신호용)
        const annRev = sumRev * (4 / nConfirmed);
        const annOp  = sumOp  * (4 / nConfirmed);
        const annNet = sumNet != null ? sumNet * (4 / nConfirmed) : null;

        const revGap = (annRev - cnsRev) / cnsRev;
        const opGap  = (cnsOp != null && cnsOp !== 0) ? (annOp - cnsOp) / Math.abs(cnsOp) : null;
        const netGap = (sumNet != null && cnsNet != null && cnsNet !== 0) ? (annNet! - cnsNet) / Math.abs(cnsNet) : null;

        const signal = (gap: number | null) => {
          if (gap == null) return "";
          if (gap > 0.15)  return " ⬆️ 강한 상향 압력";
          if (gap > 0.07)  return " ↑ 상향 압력";
          if (gap < -0.15) return " ⬇️ 강한 하향 압력";
          if (gap < -0.07) return " ↓ 하향 압력";
          return " → 컨센서스 부합";
        };

        lines.push(`\n[📊 ${cnsYear}E 컨센서스 대비 실적 괴리 분석 — Q${nConfirmed} 확정 기준]`);
        lines.push(`  ⚠️ 단순 연환산(Q${nConfirmed}×${(4/nConfirmed).toFixed(2)}) = 계절성 무시한 방향 신호값. 계절성 보정 후 사용.`);
        lines.push(`  확정 누계(${nConfirmed}Q): 매출 ${fmtNum(sumRev, "KRW")} | 영업이익 ${fmtNum(sumOp, "KRW")}${sumNet != null ? ` | 순이익 ${fmtNum(sumNet, "KRW")}` : ''}`);
        lines.push(`  단순 연환산:  매출 ${fmtNum(annRev, "KRW")} | 영업이익 ${fmtNum(annOp, "KRW")}${annNet != null ? ` | 순이익 ${fmtNum(annNet, "KRW")}` : ''}`);
        lines.push(`  Naver ${cnsYear}E 컨센서스: 매출 ${fmtNum(cnsRev, "KRW")}${cnsOp != null ? ` | 영업이익 ${fmtNum(cnsOp, "KRW")}` : ''}${cnsNet != null ? ` | 순이익 ${fmtNum(cnsNet, "KRW")}` : ''}`);
        lines.push(`  괴리: 매출 ${revGap >= 0 ? '+' : ''}${(revGap * 100).toFixed(1)}%${signal(revGap)}${opGap != null ? `  영업이익 ${opGap >= 0 ? '+' : ''}${(opGap * 100).toFixed(1)}%${signal(opGap)}` : ''}${netGap != null ? `  순이익 ${netGap >= 0 ? '+' : ''}${(netGap * 100).toFixed(1)}%${signal(netGap)}` : ''}`);

        const hasUpward   = revGap > 0.07 || (opGap != null && opGap > 0.07);
        const hasDownward = revGap < -0.07 || (opGap != null && opGap < -0.07);
        if (hasUpward || hasDownward) {
          lines.push(`  ⚠️ AI 전망 조정 가이드: 확정 ${nConfirmed}Q 실적이 컨센서스를 ${hasUpward ? '상회' : '하회'}하고 있습니다.`);
          lines.push(`     → ${cnsYear}E 연간 추정치는 컨센서스보다 ${hasUpward ? '높은 쪽' : '낮은 쪽'}에서 검토하세요.`);
          lines.push(`     → 단, 계절성(Q별 가중) 및 하반기 업황 변수를 반드시 가감하세요. 단순 연환산은 방향 참고용.`);
        }
      }
    } catch { /* ignore — optional enhancement */ }

    // ── 과거 연간 실적 CAGR 및 OPM 추세 사전 계산 → AI 전망 기준점 주입 ─────────
    try {
      const annCols: string[][] = summary.chartIncomeStatement?.annual?.columns ?? [];
      const annTitleList: any[] = summary.chartIncomeStatement?.annual?.trTitleList ?? [];
      const annPeriods: string[] = annCols[0]?.slice(1) ?? [];
      const annRevs = annCols.find((c: string[]) => c[0] === "매출액")?.slice(1) ?? [];
      const annOps  = annCols.find((c: string[]) => c[0] === "영업이익")?.slice(1) ?? [];
      const annNets = annCols.find((c: string[]) => c[0] === "당기순이익")?.slice(1) ?? [];

      // 확정 연도만 추출 (isConsensus != Y)
      type AnnualRow = { period: string; rev: number; op: number; net: number | null };
      const confirmed: AnnualRow[] = [];
      annPeriods.forEach((period: string, i: number) => {
        const isE = annTitleList[i]?.isConsensus === "Y";
        if (!isE) {
          const rev = Number(annRevs[i]);
          const op  = Number(annOps[i]);
          const net = annNets[i] != null ? Number(annNets[i]) : null;
          if (!isNaN(rev) && !isNaN(op) && rev !== 0) confirmed.push({ period, rev, op, net: (net != null && !isNaN(net)) ? net : null });
        }
      });

      if (confirmed.length >= 2) {
        const last  = confirmed[confirmed.length - 1];
        const prev1 = confirmed[confirmed.length - 2];
        const prev2 = confirmed.length >= 3 ? confirmed[confirmed.length - 3] : null;
        const prev3 = confirmed.length >= 4 ? confirmed[confirmed.length - 4] : null;

        const cagr1y = (last.rev / prev1.rev - 1) * 100;
        const cagr2y = prev2 ? (Math.pow(last.rev / prev2.rev, 1/2) - 1) * 100 : null;
        const cagr3y = prev3 ? (Math.pow(last.rev / prev3.rev, 1/3) - 1) * 100 : null;

        // OPM 추세
        const opmLast  = last.rev  > 0 ? (last.op  / last.rev)  * 100 : null;
        const opmPrev1 = prev1.rev > 0 ? (prev1.op / prev1.rev) * 100 : null;
        const opmDelta = (opmLast !== null && opmPrev1 !== null) ? opmLast - opmPrev1 : null;

        // 대표 CAGR (3y > 2y > 1y)
        const refCagr = cagr3y ?? cagr2y ?? cagr1y;
        const e1guide = (refCagr * 0.9).toFixed(1);
        const e2guide = (refCagr * 0.7).toFixed(1);

        const sign = (n: number) => n >= 0 ? "+" : "";
        const cagrParts: string[] = [
          `매출 YoY ${sign(cagr1y)}${cagr1y.toFixed(1)}%`,
          ...(cagr2y !== null ? [`2년CAGR ${sign(cagr2y)}${cagr2y.toFixed(1)}%`] : []),
          ...(cagr3y !== null ? [`3년CAGR ${sign(cagr3y)}${cagr3y.toFixed(1)}%`] : []),
          ...(opmDelta !== null ? [`OPM추세 YoY ${sign(opmDelta)}${opmDelta.toFixed(1)}pp`] : []),
        ];
        lines.push(`\n[⭐ 과거 실적 추이 요약 — AI 전망 기준점]`);
        lines.push(`  ${cagrParts.join(" | ")}`);
        lines.push(`  → E+1 성장률 기준점: ${sign(Number(e1guide))}${e1guide}% (역사CAGR×90%), E+2: ${sign(Number(e2guide))}${e2guide}% (역사CAGR×70%)`);
        lines.push(`  ⚠️ 이 기준점에서 크게 벗어나는 전망은 반드시 구조적 근거를 명시하세요.`);

        // ── ticker_financials DB 저장 (Naver 확정 연간 실적) ─────────────────────
        // fire-and-forget: 저장 실패해도 분석 진행
        const upsertRows = confirmed.map(row => {
          const bsnsYear = parseInt(row.period.slice(0, 4), 10);
          const revKrw   = Math.round(row.rev * 1e8);
          const opKrw    = Math.round(row.op  * 1e8);
          const netKrw   = row.net != null ? Math.round(row.net * 1e8) : null;
          return { bsnsYear, revKrw, opKrw, netKrw, period: row.period };
        }).filter(r => !isNaN(r.bsnsYear) && r.bsnsYear >= 2010);

        Promise.all(upsertRows.map(r =>
          rawQuery(
            `INSERT INTO ticker_financials
               (ticker, bsns_year, reprt_code, period_label, fs_type, revenue, operating_income, net_income, fetched_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (ticker, bsns_year, reprt_code, fs_type) DO UPDATE
               SET revenue = EXCLUDED.revenue,
                   operating_income = EXCLUDED.operating_income,
                   net_income = EXCLUDED.net_income,
                   period_label = EXCLUDED.period_label,
                   fetched_at = NOW()`,
            [code, r.bsnsYear, "11011", r.period, "연결",
             r.revKrw, r.opKrw, r.netKrw]
          ).catch(() => {})
        )).catch(() => {});
      }
    } catch {
      // 계산 실패 시 무시 — 선택적 개선 데이터
    }
    // ────────────────────────────────────────────────────────────────────────────

    const epsCols: string[][] = summary.chartEps?.columns ?? [];
    const epsTitleList: any[] = summary.chartEps?.trTitleList ?? [];
    const epsPeriods: string[] = epsCols[0]?.slice(1) ?? [];
    const epsVals: string[] = epsCols.find((c: string[]) => c[0] === "EPS")?.slice(1) ?? [];
    if (epsPeriods.length > 0 && epsVals.length > 0) {
      lines.push("\n[네이버 분기 EPS (원, [E]=컨센서스예측)]");
      epsPeriods.forEach((period: string, i: number) => {
        const isE = epsTitleList[i]?.isConsensus === "Y" ? "[E] " : "";
        const epsNum = naverFmt(epsVals[i]);
        if (epsNum != null) lines.push(`  ${isE}${period}: EPS ${epsNum.toLocaleString("ko-KR")}원`);
      });
    }
  }

  // ── 6. FnGuide 컨센서스 (investment + consensus 엔드포인트) ──────────────────
  const [invResult, cnsResult] = await Promise.allSettled([
    fetch(`https://m.stock.naver.com/api/stock/${code}/investment`, {
      headers: NAVER_HEADERS, signal: AbortSignal.timeout(6000),
    }).then(r => r.ok ? r.json() : null),
    fetch(`https://m.stock.naver.com/api/stock/${code}/consensus`, {
      headers: NAVER_HEADERS, signal: AbortSignal.timeout(6000),
    }).then(r => r.ok ? r.json() : null),
  ]);
  const inv: any = invResult.status === "fulfilled" ? invResult.value : null;
  const cns: any = cnsResult.status === "fulfilled" ? cnsResult.value : null;

  if (inv || cns) {
    lines.push("\n=== 증권가 컨센서스 (FnGuide/Naver 기준) ===");
  }

  // 애널리스트 목표가 + 투자의견
  if (inv) {
    const tpCns = inv.targetPriceCns ?? inv.consensusTargetPrice ?? inv.targetPrice ?? null;
    if (tpCns) {
      const avg = naverFmt(tpCns.averageTargetPrice ?? tpCns.average ?? tpCns.avg);
      const high = naverFmt(tpCns.highestTargetPrice ?? tpCns.highest ?? tpCns.high);
      const low = naverFmt(tpCns.lowestTargetPrice ?? tpCns.lowest ?? tpCns.low);
      if (avg) lines.push(`애널리스트 평균 목표가: ${avg.toLocaleString("ko-KR")}원`);
      if (high && low) lines.push(`목표가 범위: ${low.toLocaleString("ko-KR")}원 – ${high.toLocaleString("ko-KR")}원`);
    }
    const opCns = inv.investmentOpinionCns ?? inv.opinionCns ?? inv.opinion ?? null;
    if (opCns) {
      const total = Number(opCns.totalCount ?? opCns.total ?? 0);
      const buy   = Number(opCns.strongBuyCount ?? opCns.strongBuy ?? 0) + Number(opCns.buyCount ?? opCns.buy ?? 0);
      const hold  = Number(opCns.holdCount ?? opCns.hold ?? 0);
      const sell  = Number(opCns.underperformCount ?? 0) + Number(opCns.sellCount ?? opCns.sell ?? 0);
      if (total > 0) lines.push(`투자의견 (총 ${total}개): 매수 ${buy}개 / 중립 ${hold}개 / 매도 ${sell}개`);
    }
  }

  // 연간 실적 전망 (consensus 엔드포인트)
  if (cns) {
    const annual = cns.chartCnsEstimatedFinancial?.annual ?? cns.annual ?? null;
    if (annual?.columns) {
      const cols: string[][] = annual.columns;
      const periods: string[] = cols[0]?.slice(1) ?? [];
      const revenues  = cols.find((c: string[]) => /매출/.test(c[0] ?? ""))?.slice(1) ?? [];
      const opIncomes = cols.find((c: string[]) => /영업이익/.test(c[0] ?? ""))?.slice(1) ?? [];
      const netIncomes= cols.find((c: string[]) => /순이익|당기순/.test(c[0] ?? ""))?.slice(1) ?? [];
      const epsCol    = cols.find((c: string[]) => c[0] === "EPS")?.slice(1) ?? [];
      if (periods.length > 0) {
        lines.push("\n[연간 실적 컨센서스 전망]");
        periods.forEach((period: string, i: number) => {
          const items: string[] = [];
          if (revenues[i])   items.push(`매출 ${fmtNum(Number(revenues[i]) * 1e8, "KRW")}`);
          if (opIncomes[i])  items.push(`영업이익 ${fmtNum(Number(opIncomes[i]) * 1e8, "KRW")}`);
          if (netIncomes[i]) items.push(`순이익 ${fmtNum(Number(netIncomes[i]) * 1e8, "KRW")}`);
          if (epsCol[i])     items.push(`EPS ${Number(epsCol[i]).toLocaleString("ko-KR")}원`);
          if (items.length > 0) lines.push(`  ${period}: ${items.join(" | ")}`);
        });
      }
    }
    // EPS 컨센서스 (별도 테이블)
    const epsData = cns.chartCnsEps?.annual ?? null;
    if (epsData?.columns) {
      const cols: string[][] = epsData.columns;
      const periods: string[] = cols[0]?.slice(1) ?? [];
      const epsVals = cols.find((c: string[]) => c[0] === "EPS")?.slice(1) ?? [];
      const bpsVals = cols.find((c: string[]) => c[0] === "BPS")?.slice(1) ?? [];
      const dpsVals = cols.find((c: string[]) => c[0] === "DPS")?.slice(1) ?? [];
      if (periods.length > 0 && (epsVals.length > 0 || bpsVals.length > 0)) {
        if (!lines.some(l => l.includes("연간 실적 컨센서스 전망"))) {
          lines.push("\n[EPS/BPS/DPS 컨센서스 전망]");
        } else {
          lines.push("[EPS/BPS/DPS 컨센서스 추가]");
        }
        periods.forEach((p: string, i: number) => {
          const eps = epsVals[i] ? `EPS ${naverFmt(epsVals[i])?.toLocaleString("ko-KR")}원` : null;
          const bps = bpsVals[i] ? `BPS ${naverFmt(bpsVals[i])?.toLocaleString("ko-KR")}원` : null;
          const dps = dpsVals[i] ? `DPS ${naverFmt(dpsVals[i])?.toLocaleString("ko-KR")}원` : null;
          const items = [eps, bps, dps].filter(Boolean);
          if (items.length > 0) lines.push(`  ${p}: ${items.join(" | ")}`);
        });
      }
    }
  }

  const result = { context: lines.join("\n"), naverSharesCalc };
  cache.set(cacheKey, result, TTL.NAVER_PRICE);
  // DB 영속 캐시 저장 (8시간 TTL) — fire-and-forget
  dbCacheSet(dbNaverKey, result, 8 * 3600).catch(() => {});
  return result;
}

// ─── Financial data fetching ──────────────────────────────────────────────────

function toYear(val: any): string {
  if (!val) return "?";
  if (val instanceof Date) return String(val.getFullYear());
  if (typeof val === "number") return String(new Date(val * 1000).getFullYear());
  return "?";
}

function fmtNum(val: number | undefined | null, currency?: string): string {
  if (val == null || isNaN(val)) return "-";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (currency === "KRW") {
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}조원`;
    if (abs >= 1e8)  return `${sign}${(abs / 1e8).toFixed(1)}억원`;
    if (abs >= 1e4)  return `${sign}${(abs / 1e4).toFixed(0)}만원`;
    return `${sign}${abs.toLocaleString()}원`;
  }
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

function pct(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return "-";
  return `${(val * 100).toFixed(1)}%`;
}

/** 영업이익률 전용: 음수이면 "적자"로 표기 */
function opm(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return "-";
  if (val < 0) return "적자";
  return `${(val * 100).toFixed(1)}%`;
}

/**
 * 52주 주간 수익률 기반 역사적 베타 계산
 * 벤치마크: KOSPI(.KS)→^KS11 | KOSDAQ(.KQ)→^KQ11 | 미국→^GSPC
 * Blume 조정: β_adj = 0.67×β_raw + 0.33 (1.0 방향 회귀)
 * R² < 0.15이면 1.0 방향으로 추가 수렴
 */
async function computeHistoricalBeta(
  symbol: string,
  indexSymbol: string
): Promise<{ beta: number; rSquared: number; n: number } | null> {
  try {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setDate(startDate.getDate() - 14); // 1년 + 2주 여유
    const period1 = startDate.toISOString().slice(0, 10);

    const [stockHistory, indexHistory] = await Promise.all([
      yahooFinance.historical(symbol, { period1, interval: "1wk" }, { validateResult: false }).catch(() => null),
      yahooFinance.historical(indexSymbol, { period1, interval: "1wk" }, { validateResult: false }).catch(() => null),
    ]);

    if (!stockHistory?.length || !indexHistory?.length) return null;

    const getKey = (d: Date) => d.toISOString().slice(0, 10);
    const stockMap = new Map<string, number>();
    for (const q of stockHistory) {
      const c = (q as any).adjClose ?? (q as any).close;
      if (c != null && c > 0) stockMap.set(getKey(q.date), c);
    }
    const indexMap = new Map<string, number>();
    for (const q of indexHistory) {
      const c = (q as any).adjClose ?? (q as any).close;
      if (c != null && c > 0) indexMap.set(getKey(q.date), c);
    }

    const stockDates = [...stockMap.keys()].sort();
    const stockReturns: number[] = [];
    const indexReturns: number[] = [];

    for (let i = 1; i < stockDates.length; i++) {
      const d = stockDates[i];
      const dPrev = stockDates[i - 1];
      const sc = stockMap.get(d)!;
      const scPrev = stockMap.get(dPrev)!;
      const ic = indexMap.get(d);
      const icPrev = indexMap.get(dPrev);
      if (!ic || !icPrev || scPrev === 0 || icPrev === 0) continue;
      stockReturns.push((sc - scPrev) / scPrev);
      indexReturns.push((ic - icPrev) / icPrev);
    }

    const n = stockReturns.length;
    if (n < 12) return null;

    const meanS = stockReturns.reduce((a, b) => a + b, 0) / n;
    const meanI = indexReturns.reduce((a, b) => a + b, 0) / n;

    let covSI = 0, varI = 0, varS = 0;
    for (let i = 0; i < n; i++) {
      const ds = stockReturns[i] - meanS;
      const di = indexReturns[i] - meanI;
      covSI += ds * di;
      varI  += di * di;
      varS  += ds * ds;
    }
    covSI /= (n - 1);
    varI  /= (n - 1);
    varS  /= (n - 1);

    if (varI === 0 || varS === 0) return null;

    const betaRaw = covSI / varI;
    const rSquared = Math.min(1, Math.max(0, (covSI * covSI) / (varI * varS)));
    // Blume 조정: 1.0 방향으로 회귀
    const betaBlume = 0.67 * betaRaw + 0.33;
    // R² < 0.15이면 신뢰도 낮아 1.0 추가 수렴
    const rWeight = Math.min(1, rSquared / 0.15);
    const betaFinal = rSquared >= 0.15
      ? betaBlume
      : betaBlume * rWeight + 1.0 * (1 - rWeight);

    return {
      beta: parseFloat(betaFinal.toFixed(3)),
      rSquared: parseFloat(rSquared.toFixed(3)),
      n,
    };
  } catch (err) {
    console.warn("[beta] 역사적 베타 계산 오류:", (err as any)?.message?.slice(0, 80));
    return null;
  }
}

async function fetchFinancialContext(resolvedSymbol: string, dartNumerics?: DartAnchorNumerics | null): Promise<string> {
  const fcCacheKey = dartNumerics ? `financial:${resolvedSymbol}:dart` : `financial:${resolvedSymbol}`;
  const fcCached = cache.get<string>(fcCacheKey);
  if (fcCached) return fcCached;

  // DB 영속 캐시 체크 — in-memory 미스 시 DB에서 복원 (재시작 후에도 8시간 유지)
  const dbFcKey = `fin_ctx:${fcCacheKey}`;
  const dbFcCached = await dbCacheGet<string>(dbFcKey);
  if (dbFcCached) {
    cache.set(fcCacheKey, dbFcCached, TTL.YAHOO_FINANCIAL);
    console.log(`[fin-ctx] DB 캐시 히트: ${resolvedSymbol}`);
    return dbFcCached;
  }

  let result: any;
  let tsResult: any = null;
  let naverSharesCalc: number | null = null; // fetchNaverFinanceData에서 반환 받음

  // Fetch quoteSummary and fundamentalsTimeSeries in parallel
  const tsTypes = [
    // ── 연간 손익 ──
    "annualGrossProfit", "annualTotalRevenue", "annualOperatingIncome",
    "annualNetIncome", "annualReturnOnEquity", "annualReturnOnAssets",
    "annualBasicEPS", "annualTotalLiabilitiesNetMinorityInterest", "annualStockholdersEquity",
    // ── 연간 현금흐름 (cashflowStatementHistory Nov 2024 이후 중단 → timeseries 사용) ──
    "annualOperatingCashFlow", "annualFreeCashFlow", "annualCapitalExpenditure",
    // ── WACC·EBITDA 계산 핵심 ──
    "annualInterestExpense",                          // CoD(이자비용) 계산
    "annualDepreciationAmortizationDepletion",        // EBITDA = 영업이익 + D&A
    "annualTotalDebt",                                // D/E·순부채 계산
    "annualCashAndCashEquivalentsAndShortTermInvestments", // 순현금
    // ── 분기별 손익 (최근 6분기) ──
    "quarterlyTotalRevenue", "quarterlyOperatingIncome",
    "quarterlyNetIncome", "quarterlyBasicEPS",
    "quarterlyOperatingCashFlow", "quarterlyFreeCashFlow",
  ];
  const tsPeriod1 = Math.floor(new Date(`${new Date().getFullYear() - 4}-01-01`).getTime() / 1000);
  const tsPeriod2 = Math.floor(Date.now() / 1000);
  const tsUrl = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(resolvedSymbol)}?type=${tsTypes.join(",")}&period1=${tsPeriod1}&period2=${tsPeriod2}`;

  const koreanCodeEarly = resolvedSymbol.match(/^(\d{6})\.(KS|KQ)$/i)?.[1] ?? null;

  // 역사적 베타 계산 — 메인 fetches와 병렬로 시작 (대기 없이 즉시 실행)
  const betaIndexSymbol = resolvedSymbol.endsWith(".KS") ? "^KS11"
    : resolvedSymbol.endsWith(".KQ") ? "^KQ11" : "^GSPC";
  const histBetaPromise = computeHistoricalBeta(resolvedSymbol, betaIndexSymbol);

  const [summaryRes, tsRes, naverBasicRes, quoteRes] = await Promise.allSettled([
    yahooFinance.quoteSummary(resolvedSymbol, {
      modules: [
        "financialData",
        "defaultKeyStatistics",
        "summaryDetail",
        "incomeStatementHistory",
        "balanceSheetHistory",
        "cashflowStatementHistory",
        "earningsTrend",
        "earningsHistory",
        "recommendationTrend",
        "institutionOwnership",
        "insiderTransactions",
      ] as any,
    }),
    fetch(tsUrl, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: AbortSignal.timeout(12000) })
      .then(r => r.ok ? r.json() : null),
    koreanCodeEarly
      ? fetch(`https://m.stock.naver.com/api/stock/${koreanCodeEarly}/basic`, { headers: NAVER_HEADERS, signal: AbortSignal.timeout(12000) })
          .then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null),
    koreanCodeEarly
      ? yahooFinance.quote(resolvedSymbol).catch(() => null)
      : Promise.resolve(null),
  ]);

  // 역사적 베타 수거 (병렬 실행 완료 대기)
  const histBeta = await histBetaPromise.catch(() => null);
  if (histBeta) {
    console.log(`[beta] ${resolvedSymbol} vs ${betaIndexSymbol}: β=${histBeta.beta} R²=${histBeta.rSquared} n=${histBeta.n}주`);
  } else {
    console.log(`[beta] ${resolvedSymbol} 역사적 베타 계산 실패 — Yahoo 베타 폴백`);
  }

  if (summaryRes.status === "rejected") {
    console.error(`[financial-data] quoteSummary failed for ${resolvedSymbol} — will build context from Naver/quote fallback:`, (summaryRes.reason as any)?.message?.slice(0, 120));
    result = {} as any; // quoteSummary 실패 시 빈 객체로 계속 진행 (Naver + quote 데이터로 현재가 등 최소 컨텍스트 구성)
  } else {
    result = summaryRes.value;
  }

  // Override Yahoo Finance currentPrice with correct KRX price for Korean stocks.
  // Priority: 1) Naver closePrice  2) Yahoo quote.regularMarketPrice
  // Yahoo Finance financialData.currentPrice often returns stale IPO price for KRX stocks.
  if (koreanCodeEarly) {
    // Determine correct price: Naver first, then Yahoo quote regularMarketPrice as fallback
    let correctPrice: number | null = null;

    if (naverBasicRes.status === "fulfilled" && naverBasicRes.value) {
      const naverBasicEarly = naverBasicRes.value as any;
      const naverClose = naverBasicEarly.closePrice
        ? Number(String(naverBasicEarly.closePrice).replace(/,/g, ""))
        : null;
      if (naverClose && naverClose > 0) {
        correctPrice = naverClose;
      }
    }

    // Fallback: use Yahoo quote.regularMarketPrice (reliable real-time price)
    if (!correctPrice && quoteRes.status === "fulfilled" && quoteRes.value) {
      const qRegular = (quoteRes.value as any).regularMarketPrice;
      if (qRegular && qRegular > 0) {
        correctPrice = qRegular;
        console.log(`[financial-data] Using Yahoo quote.regularMarketPrice ${qRegular} as price fallback for ${resolvedSymbol}`);
      }
    }

    if (correctPrice && correctPrice > 0) {
      // Ensure financialData exists so we can set currentPrice
      if (!result) result = {} as any;
      if (!result.financialData) (result as any).financialData = {};
      const yahooPrice = result.financialData?.currentPrice;
      if (yahooPrice !== correctPrice) {
        console.log(`[financial-data] Overriding Yahoo currentPrice ${yahooPrice} → KRX correct price ${correctPrice} for ${resolvedSymbol}`);
        (result as any).financialData.currentPrice = correctPrice;
      }
    }
  }

  // Parse direct timeseries fetch: result is an array of items each with one type key
  let tsRows: any[] = [];
  if (tsRes.status === "fulfilled" && tsRes.value) {
    tsRows = tsRes.value?.timeseries?.result ?? [];
  } else {
    console.warn(`[financial-data] timeseries fetch failed for ${resolvedSymbol}:`, (tsRes as any).reason?.message ?? "unknown");
  }

  // Build a map: typeName → array of {asOfDate, raw}
  const tsTypeMap: Record<string, Array<{year: string; value: number}>> = {};
  for (const row of tsRows) {
    for (const typeName of tsTypes) {
      if (row[typeName]) {
        tsTypeMap[typeName] = (row[typeName] as any[])
          .filter((e: any) => e?.reportedValue?.raw != null)
          .map((e: any) => ({
            year: String(new Date(e.asOfDate).getFullYear()),
            value: e.reportedValue.raw as number,
          }))
          .sort((a, b) => Number(b.year) - Number(a.year));
      }
    }
  }

  const lines: string[] = [
    `=== Yahoo Finance 실제 재무 데이터 (${resolvedSymbol}, 기준일: ${new Date().toISOString().split("T")[0]}) ===`,
    "※ 아래 수치는 실제 공시 데이터 기반입니다. 분석 시 이 수치를 직접 인용하세요.",
  ];

  const fd = result.financialData as any;
  const ks = result.defaultKeyStatistics as any;
  const sd = result.summaryDetail as any;
  // 한국 주식(.KS/.KQ)은 Yahoo가 financialCurrency를 누락하거나 USD로 잘못 반환할 수 있음
  // → 심볼 기준으로 강제 KRW 고정 (fmtNum의 $B 폴백 경로 차단)
  const isKorean = /\.(KS|KQ)$/i.test(resolvedSymbol);
  const currency: string = isKorean ? "KRW" : (fd?.financialCurrency ?? "USD");

  // Current financial metrics
  if (fd) {
    lines.push("\n[현재 재무 현황]");
    if (fd.currentPrice)         lines.push(`현재가: ${fd.currentPrice} ${currency}`);
    if (fd.targetMeanPrice)      lines.push(`애널리스트 평균 목표가: ${fd.targetMeanPrice} ${currency}`);
    if (fd.targetHighPrice)      lines.push(`목표가 범위: ${fd.targetLowPrice} ~ ${fd.targetHighPrice} ${currency}`);
    if (fd.recommendationKey)    lines.push(`애널리스트 추천: ${fd.recommendationKey} (커버리지 ${fd.numberOfAnalystOpinions ?? "?"}명)`);
    if (fd.totalRevenue)         lines.push(`매출(TTM): ${fmtNum(fd.totalRevenue, currency)}`);
    if (fd.grossProfits)         lines.push(`매출총이익(TTM): ${fmtNum(fd.grossProfits, currency)}`);
    if (fd.ebitda)               lines.push(`EBITDA: ${fmtNum(fd.ebitda, currency)}`);
    if (fd.operatingCashflow)    lines.push(`영업현금흐름: ${fmtNum(fd.operatingCashflow, currency)}`);
    if (fd.freeCashflow)         lines.push(`잉여현금흐름(FCF): ${fmtNum(fd.freeCashflow, currency)}`);
    if (fd.totalCash)            lines.push(`보유 현금: ${fmtNum(fd.totalCash, currency)}`);
    if (fd.totalDebt)            lines.push(`총 부채: ${fmtNum(fd.totalDebt, currency)}`);
    if (fd.revenueGrowth != null) lines.push(`매출 성장률(YoY): ${pct(fd.revenueGrowth)}`);
    if (fd.earningsGrowth != null) lines.push(`이익 성장률(YoY): ${pct(fd.earningsGrowth)}`);
    if (fd.grossMargins != null)    lines.push(`매출총이익률: ${pct(fd.grossMargins)}`);
    if (fd.operatingMargins != null) lines.push(`영업이익률(Yahoo Finance TTM): ${opm(fd.operatingMargins)} ← ⚠️ 한국 종목은 TTM 계산 방식 차이로 부정확할 수 있음. 피어 멀티플 비교 테이블 작성 시 이 수치 대신 아래 [📊 DART 시계열] 최신 연간 OPM을 사용하세요.`);
    if (fd.profitMargins != null)   lines.push(`순이익률: ${pct(fd.profitMargins)}`);
    if (fd.returnOnEquity != null)  lines.push(`ROE: ${pct(fd.returnOnEquity)}`);
    if (fd.returnOnAssets != null)  lines.push(`ROA: ${pct(fd.returnOnAssets)}`);
    if (fd.debtToEquity != null)    lines.push(`부채비율(D/E): ${fd.debtToEquity.toFixed(1)}`);
    if (fd.currentRatio != null)    lines.push(`유동비율: ${fd.currentRatio.toFixed(2)}`);
    if (fd.quickRatio != null)      lines.push(`당좌비율: ${fd.quickRatio.toFixed(2)}`);
  }

  // Valuation multiples
  if (ks) {
    lines.push("\n[밸류에이션 지표]");
    if (ks.enterpriseValue)         lines.push(`기업가치(EV): ${fmtNum(ks.enterpriseValue, currency)}`);
    if (ks.trailingEps != null)     lines.push(`EPS(TTM): ${ks.trailingEps.toFixed(2)} ${currency}`);
    if (ks.forwardEps != null)      lines.push(`EPS(Forward): ${ks.forwardEps.toFixed(2)} ${currency}`);
    if (ks.trailingPE != null)      lines.push(`P/E(TTM): ${ks.trailingPE.toFixed(1)}x`);
    if (ks.forwardPE != null)       lines.push(`P/E(Forward): ${ks.forwardPE.toFixed(1)}x`);
    // P/B: Yahoo 우선, 한국주는 Naver 폴백, 그 다음 DB 캐시
    let pbMain: number | null = ks.priceToBook ?? null;
    if (pbMain == null && koreanCodeEarly) {
      pbMain = await fetchNaverPBR(koreanCodeEarly).catch(() => null);
    }
    if (pbMain != null) {
      lines.push(`P/B: ${pbMain.toFixed(2)}x`);
      // 성공적으로 얻은 PBR을 캐시에 저장 (피어 분석 시 재활용)
      writeMetricCache(resolvedSymbol, { pbr: pbMain }).catch(() => {});
    }
    if (ks.enterpriseToRevenue != null) lines.push(`EV/매출: ${ks.enterpriseToRevenue.toFixed(2)}x`);
    if (ks.enterpriseToEbitda != null)  lines.push(`EV/EBITDA: ${ks.enterpriseToEbitda.toFixed(2)}x`);
    if (ks.pegRatio != null)        lines.push(`PEG: ${ks.pegRatio.toFixed(2)}`);
    if (histBeta) {
      lines.push(`베타(역사적52주,Blume조정,${betaIndexSymbol}): ${histBeta.beta.toFixed(3)} | R²=${histBeta.rSquared.toFixed(3)} | n=${histBeta.n}주${histBeta.rSquared < 0.15 ? " ⚠️R²낮음→섹터베타50:50병용권장" : " ✅신뢰구간정상"}`);
      if (ks.beta != null) lines.push(`베타(Yahoo참고): ${ks.beta.toFixed(2)}`);
    } else if (ks.beta != null) {
      lines.push(`베타(Yahoo): ${ks.beta.toFixed(2)}`);
    }
    if (ks.bookValue != null)       lines.push(`BPS(Yahoo, 참고용): ${ks.bookValue.toFixed(2)}${currency} ← 아래 서버계산 BPS와 다를 경우 서버계산값 우선`);
    if (ks.sharesOutstanding) {
      const sh = ks.sharesOutstanding;
      const shStr = sh >= 1e8
        ? `${(sh / 1e8).toFixed(4)}억주 (${sh.toLocaleString("ko-KR")}주)`
        : sh >= 1e4
        ? `${(sh / 1e4).toFixed(0)}만주 (${sh.toLocaleString("ko-KR")}주)`
        : `${sh.toLocaleString("ko-KR")}주`;
      lines.push(`발행주식수(Yahoo, 참고용): ${shStr} ← KRX/Naver 기준값과 다를 수 있음. [네이버증권 핵심 투자지표]의 ⭐ 발행주식수 우선 사용`);
    }
    if (ks.heldPercentInsiders != null)     lines.push(`내부자 보유율: ${pct(ks.heldPercentInsiders)}`);
    if (ks.heldPercentInstitutions != null) lines.push(`기관 보유율: ${pct(ks.heldPercentInstitutions)}`);
    if ((ks as any).shortPercentOfFloat != null) lines.push(`공매도 비중(Float): ${pct((ks as any).shortPercentOfFloat)}`);
    if (ks.shortRatio != null)      lines.push(`공매도 커버일수: ${ks.shortRatio.toFixed(1)}일`);
    if (ks.dividendYield != null)   lines.push(`배당수익률: ${pct(ks.dividendYield)}`);
    if (ks.payoutRatio != null)     lines.push(`배당성향: ${pct(ks.payoutRatio)}`);

    // ── 서버 계산 Forward P/E — 섹터 벤치마크 비교 ────────────────────────────────
    // AI가 Forward P/E를 임의 해석하는 것을 방지. 섹터 중앙값과의 프리미엄/디스카운트를 명시해 AI가
    // 상대가치평가에서 올바른 기준을 사용하도록 유도.
    {
      const currentPrice: number | null = fd?.currentPrice ?? sd?.regularMarketPrice ?? null;
      const fwdEps: number | null = ks?.forwardEps ?? null;
      const sectorName: string | null = (result as any).assetProfile?.sector ?? null;

      if (currentPrice != null && fwdEps != null && Math.abs(fwdEps) > 0.001) {
        const fwdPE = currentPrice / fwdEps;

        // 섹터별 Forward P/E 벤치마크 중앙값 (2024~2025년 글로벌 기준)
        const sectorFwdPEBenchmarks: Record<string, { median: number; range: string; label: string }> = {
          "Technology":            { median: 28, range: "22~38x", label: "IT/테크" },
          "Semiconductors":        { median: 22, range: "18~32x", label: "반도체" },
          "Healthcare":            { median: 18, range: "14~25x", label: "헬스케어" },
          "Communication Services":{ median: 18, range: "14~24x", label: "통신서비스" },
          "Consumer Discretionary":{ median: 20, range: "15~28x", label: "소비재(경기)" },
          "Consumer Staples":      { median: 18, range: "15~22x", label: "소비재(필수)" },
          "Industrials":           { median: 18, range: "14~23x", label: "산업재" },
          "Financials":            { median: 13, range: "10~17x", label: "금융" },
          "Energy":                { median: 12, range: "9~16x",  label: "에너지" },
          "Materials":             { median: 14, range: "11~18x", label: "소재" },
          "Real Estate":           { median: 30, range: "22~40x", label: "부동산(리츠)" },
          "Utilities":             { median: 15, range: "12~19x", label: "유틸리티" },
        };

        // 한국 코스피/코스닥 섹터별 Forward P/E (KRW 기업 전용 중앙값 — 코리아 디스카운트 반영)
        const krSectorFwdPEBenchmarks: Record<string, { median: number; range: string; label: string }> = {
          "Technology":            { median: 14, range: "10~20x", label: "IT/테크(KR)" },
          "Semiconductors":        { median: 12, range: "9~18x",  label: "반도체(KR)" },
          "Healthcare":            { median: 20, range: "14~30x", label: "헬스케어(KR)" },
          "Consumer Discretionary":{ median: 12, range: "8~18x",  label: "소비재(KR)" },
          "Industrials":           { median: 10, range: "7~14x",  label: "산업재(KR)" },
          "Financials":            { median:  8, range: "5~11x",  label: "금융(KR)" },
          "Energy":                { median:  9, range: "6~13x",  label: "에너지(KR)" },
        };

        const benchmarkMap = currency === "KRW" ? krSectorFwdPEBenchmarks : sectorFwdPEBenchmarks;
        const benchmark = sectorName ? benchmarkMap[sectorName] : null;

        if (fwdPE > 0 && fwdPE < 500) {
          lines.push(`\n[📊 서버 계산 Forward P/E — 섹터 벤치마크 비교]`);
          lines.push(`  현재가: ${currency === "KRW" ? fmtNum(currentPrice, currency) : `$${currentPrice.toFixed(2)}`} | Forward EPS: ${fwdEps.toFixed(2)} ${currency}`);
          lines.push(`  서버 계산 Forward P/E = ${fwdPE.toFixed(1)}x`);
          if (benchmark) {
            const premDisc = ((fwdPE - benchmark.median) / benchmark.median * 100).toFixed(1);
            const premDiscLabel = fwdPE > benchmark.median * 1.2
              ? `⚠️ 섹터 중앙값 대비 ${premDisc}% 프리미엄 — 고성장 근거 없으면 피어 배수 보수적 적용`
              : fwdPE < benchmark.median * 0.8
              ? `ℹ️ 섹터 중앙값 대비 ${premDisc}% 디스카운트 — 코리아디스카운트·리스크 반영 또는 저평가 검토`
              : `✅ 섹터 중앙값(${benchmark.median}x) 대비 ${premDisc}% — 적정 밸류에이션 범위`;
            lines.push(`  섹터(${benchmark.label}) 중앙값: ${benchmark.median}x | 범위: ${benchmark.range}`);
            lines.push(`  → ${premDiscLabel}`);
            lines.push(`  ⛔ 상대가치평가 시 이 Forward P/E(${fwdPE.toFixed(1)}x)와 섹터 중앙값(${benchmark.median}x)을 기준으로 적정 배수 설정. 임의 배수 금지.`);
          } else {
            lines.push(`  (섹터 미분류 — 피어 멀티플과 직접 비교 요망)`);
          }
        } else if (fwdPE <= 0) {
          lines.push(`\n[📊 서버 계산 Forward P/E]`);
          lines.push(`  Forward EPS 음수(${fwdEps.toFixed(2)}) → Forward P/E 의미 없음 (적자 예상 기업)`);
          lines.push(`  → 상대가치평가: P/B, EV/Sales 등 대체 배수 사용`);
        }
      }
    }
  }

  // ── US 주식 수급 동향: 기관 투자자 13F + 내부자 거래 (SEC Form 4) ─────────────
  if (currency !== "KRW") {
    // Top institutional holders (13F)
    const instOwn: any = (result as any).institutionOwnership;
    if (instOwn?.ownershipList?.length) {
      lines.push("\n[주요 기관 투자자 보유 현황 — 13F 최신]");
      const top = (instOwn.ownershipList as any[]).slice(0, 8);
      for (const h of top) {
        const changePct = h.pctChange != null
          ? (h.pctChange > 0 ? `▲${(h.pctChange * 100).toFixed(1)}%` : h.pctChange < 0 ? `▼${Math.abs(h.pctChange * 100).toFixed(1)}%` : "변동없음")
          : "";
        const reportDate = h.reportDate ? new Date(h.reportDate).toISOString().slice(0, 7) : "";
        lines.push(`- ${h.organization}: 보유 ${h.pctHeld != null ? pct(h.pctHeld) : "-"} (포지션 ${h.position?.toLocaleString("en-US") ?? "-"}주${changePct ? ", 전분기比 " + changePct : ""}${reportDate ? ", " + reportDate : ""})`);
      }
      // Summarize net direction
      const buyers = (instOwn.ownershipList as any[]).filter((h: any) => h.pctChange > 0).length;
      const sellers = (instOwn.ownershipList as any[]).filter((h: any) => h.pctChange < 0).length;
      if (buyers + sellers > 0) {
        lines.push(`→ 상위 기관 순매수 방향: 증가 ${buyers}곳 / 감소 ${sellers}곳 / 총 ${buyers + sellers}곳 집계`);
      }
    }

    // Recent insider transactions (SEC Form 4)
    const insiderTxns: any = (result as any).insiderTransactions;
    if (insiderTxns?.transactions?.length) {
      lines.push("\n[내부자 최근 거래 — SEC Form 4]");
      const txns = (insiderTxns.transactions as any[]).slice(0, 6);
      for (const t of txns) {
        const dir = t.shares != null && t.shares > 0 ? "매수" : "매도";
        const sharesAbs = Math.abs(t.shares ?? 0).toLocaleString("en-US");
        const val = t.value != null ? ` ($${(t.value / 1e6).toFixed(1)}M)` : "";
        const txDate = t.startDate ? new Date(t.startDate).toISOString().slice(0, 10) : "";
        lines.push(`- ${txDate} ${t.filerName ?? "내부자"} (${t.filerRelation ?? "임원"}): ${dir} ${sharesAbs}주${val}`);
      }
      const netBuys = txns.filter((t: any) => t.shares > 0).length;
      const netSells = txns.filter((t: any) => t.shares < 0).length;
      lines.push(`→ 최근 내부자 거래: 매수 ${netBuys}건 / 매도 ${netSells}건`);
    }
  }

  // ── fundamentalsTimeSeries: 연간 데이터 맵 ────────────────────────────────────
  const toYearMap = (key: string): Record<string, number> =>
    Object.fromEntries((tsTypeMap[key] ?? []).map(e => [e.year, e.value]));

  const revMap   = toYearMap("annualTotalRevenue");
  const gpMap    = toYearMap("annualGrossProfit");
  const opMap    = toYearMap("annualOperatingIncome");
  const niMap    = toYearMap("annualNetIncome");
  const epsMap   = toYearMap("annualBasicEPS");
  const roeMap   = toYearMap("annualReturnOnEquity");
  const liabMap  = toYearMap("annualTotalLiabilitiesNetMinorityInterest");
  const eqMap    = toYearMap("annualStockholdersEquity");
  const ocfMap   = toYearMap("annualOperatingCashFlow");
  const fcfMap   = toYearMap("annualFreeCashFlow");
  const capexMap = toYearMap("annualCapitalExpenditure");
  // WACC·EBITDA 계산용
  const intExpMap = toYearMap("annualInterestExpense");
  const dnaMap    = toYearMap("annualDepreciationAmortizationDepletion");
  const debtMap   = toYearMap("annualTotalDebt");
  const cashTsMap = toYearMap("annualCashAndCashEquivalentsAndShortTermInvestments");
  const arMap     = toYearMap("annualAccountsReceivable");
  const invMap    = toYearMap("annualInventory");

  // ── DART 앵커 우선 적용 (한국 종목) ─────────────────────────────────────────
  // Yahoo Finance는 K-IFRS 연결 기준이 아닌 경우가 있어 OPM 앵커가 틀릴 수 있음.
  // DART OpenAPI 원천 데이터가 있으면 revMap·opMap·niMap·eqMap을 덮어써서
  // DCF OPM 상한·ROIC·ROE 앵커를 정확한 K-IFRS 값 기준으로 강제한다.
  if (dartNumerics) {
    const dartYears = new Set([
      ...Object.keys(dartNumerics.annualRev),
      ...Object.keys(dartNumerics.annualOp),
    ]);
    if (dartYears.size > 0) {
      console.log(`[financial-context] DART 앵커 적용 (${resolvedSymbol}): ${[...dartYears].sort().join(", ")} — Yahoo 수치 override`);
      for (const y of dartYears) {
        if (dartNumerics.annualRev[y] != null) revMap[y] = dartNumerics.annualRev[y];
        if (dartNumerics.annualOp[y]  != null) opMap[y]  = dartNumerics.annualOp[y];
        if (dartNumerics.annualNi[y]  != null) niMap[y]  = dartNumerics.annualNi[y];
        if (dartNumerics.annualEq[y]  != null) eqMap[y]  = dartNumerics.annualEq[y];
      }
    }
  }

  const allYears = [...new Set([
    ...Object.keys(revMap), ...Object.keys(gpMap), ...Object.keys(opMap), ...Object.keys(niMap)
  ])].sort((a, b) => Number(b) - Number(a)).slice(0, 4);

  if (allYears.length > 0) {
    lines.push("\n[연간 손익계산서 — fundamentalsTimeSeries]");
    lines.push("⛔ 아래 수치는 서버가 원천 데이터로부터 직접 계산한 확정값임. AI가 다른 소스로 재계산하거나 다른 값을 사용하는 것은 금지.");
    for (const year of allYears) {
      const revRaw = revMap[year] ?? null;
      const opRaw  = opMap[year] ?? null;
      const niRaw  = niMap[year] ?? null;
      const eqRaw  = eqMap[year] ?? null;

      const rev  = revRaw != null ? fmtNum(revRaw, currency)  : "-";
      const gp   = gpMap[year]   != null ? fmtNum(gpMap[year], currency)   : "-";
      const op   = opRaw  != null ? fmtNum(opRaw, currency)   : "-";
      const ni   = niRaw  != null ? fmtNum(niRaw, currency)   : "-";
      const eq   = eqRaw  != null ? fmtNum(eqRaw, currency)   : "-";
      const eps  = epsMap[year]  != null ? epsMap[year].toFixed(2)         : "-";

      // OPM: 서버에서 직접 계산해 제공 — AI 재계산 금지
      const opM = (revRaw && opRaw != null) ? `${(opRaw / revRaw * 100).toFixed(1)}%` : "-";
      const gpM = (revRaw && gpMap[year] != null) ? `${(gpMap[year] / revRaw * 100).toFixed(1)}%` : "-";
      const niM = (revRaw && niRaw != null) ? `${(niRaw / revRaw * 100).toFixed(1)}%` : "-";
      const de  = (liabMap[year] && eqRaw) ? `${(liabMap[year] / eqRaw * 100).toFixed(1)}%` : "-";

      // ROE: 서버에서 직접 계산 (NI÷자기자본). Yahoo annualReturnOnEquity는 일부 종목에서 누락되므로 항상 직접 계산 사용
      const roeCalc = (niRaw != null && eqRaw != null && eqRaw !== 0) ? niRaw / eqRaw * 100 : null;
      // Yahoo timeseries ROE는 참고용으로만 병기
      const roeTs  = roeMap[year] != null ? roeMap[year] * 100 : null;
      let roeStr: string;
      if (roeCalc != null) {
        roeStr = `${roeCalc.toFixed(1)}%`;
      } else {
        roeStr = roeTs != null ? `${roeTs.toFixed(1)}%` : "-";
      }

      // OPM 극단값 경고 (바이오 등 소매출 기업에서 -수천% 발생 가능 — 오류 아님)
      const opMRaw = (revRaw && opRaw != null) ? opRaw / revRaw * 100 : null;
      const opMFlag = opMRaw != null && Math.abs(opMRaw) > 200
        ? `⚠️OPM극단값(매출 ${rev}, 영업이익 ${op}, 비율 ${opM} — 소매출 기업 특성)` : "";

      // 순이익 부호 설명 (영업손실이지만 순이익 양수인 경우)
      const niNote = (opRaw != null && niRaw != null && opRaw < 0 && niRaw > 0)
        ? " ※영업손실에도 순이익양수=영업외수익(정부지원금·투자수익 등) 반영"
        : "";

      // EBITDA = 영업이익 + D&A
      const ebitdaRaw = (opRaw != null && dnaMap[year] != null) ? opRaw + dnaMap[year] : null;
      const ebitda  = ebitdaRaw != null ? fmtNum(ebitdaRaw, currency) : "-";
      const ebitdaM = (ebitdaRaw != null && revRaw) ? `${(ebitdaRaw / revRaw * 100).toFixed(1)}%` : "-";

      lines.push(
        `  ${year}년: 매출 ${rev} | GP ${gp}(${gpM}) | 영업이익 ${op}(${opM})${opMFlag} | EBITDA ${ebitda}(${ebitdaM}) | 순이익 ${ni}(${niM})${niNote} | EPS ${eps} | ROE ${roeStr} | 자기자본 ${eq} | D/E ${de}`
      );
    }

    // ── OPM 추세 요약 (DCF OPM 가정 앵커) ──────────────────────────────────────────
    // 역대 OPM 데이터를 집계해 AI가 DCF 영업이익률 가정을 과낙관하는 것을 방지
    {
      const opmHistory: Array<{year: string; opm: number}> = [];
      for (const y of allYears) {
        const revRaw = revMap[y];
        const opRaw  = opMap[y];
        if (revRaw != null && opRaw != null && Math.abs(revRaw) > 0) {
          const opmPct = opRaw / revRaw * 100;
          if (Math.abs(opmPct) < 200) opmHistory.push({ year: y, opm: opmPct }); // 극단값 제외
        }
      }
      if (opmHistory.length >= 2) {
        const sorted = opmHistory.sort((a, b) => Number(a.year) - Number(b.year));
        const firstOpm = sorted[0].opm;
        const lastOpm  = sorted[sorted.length - 1].opm;
        const maxOpm   = Math.max(...opmHistory.map(h => h.opm));
        const opmTrend = lastOpm > firstOpm + 3 ? "개선 추세" : lastOpm < firstOpm - 3 ? "악화 추세" : "안정적";
        lines.push(`\n[📈 OPM 추세 요약 — DCF 영업이익률 가정 상한 앵커]`);
        lines.push(`  ⛔ DCF 추정 OPM은 반드시 역사적 최고 OPM(${maxOpm.toFixed(1)}%)을 상한으로 설정. 초과 금지.`);
        lines.push(`  ${sorted.map(h => `${h.year}: ${h.opm.toFixed(1)}%`).join(" → ")} [${opmTrend}]`);
        lines.push(`  역사적 최고 OPM: ${maxOpm.toFixed(1)}% | 최근 OPM: ${lastOpm.toFixed(1)}%`);
        if (lastOpm < maxOpm - 10) {
          lines.push(`  ⚠️ 최근 OPM(${lastOpm.toFixed(1)}%)이 역사적 최고(${maxOpm.toFixed(1)}%)보다 ${(maxOpm - lastOpm).toFixed(1)}%p 낮음 → DCF 회복 가정 근거 명시 필수`);
        }
      }
    }

    // ── 역사적 ROIC 계산 — 자본 효율성 앵커 ──────────────────────────────────────
    // ROIC = NOPAT ÷ 투자자본 = [영업이익×(1-세율)] ÷ (Total Debt + Equity - Cash)
    // S-to-C 계산 및 자본경량 기업 분류의 핵심 근거
    {
      const taxRate = 0.25; // 법인세율 가정 (25%)
      const roicHistory: Array<{year: string; roic: number}> = [];
      for (const y of allYears.slice(0, 3)) {
        const opRaw  = opMap[y];
        const eqRaw  = eqMap[y];
        const debt   = debtMap[y] ?? 0;
        const cash   = cashTsMap[y] ?? 0;
        const ic     = (eqRaw ?? 0) + debt - cash;
        if (opRaw != null && ic > 0) {
          const nopat = opRaw * (1 - taxRate);
          const roicPct = nopat / ic * 100;
          if (Math.abs(roicPct) < 500) roicHistory.push({ year: y, roic: roicPct });
        }
      }
      if (roicHistory.length > 0) {
        const avgRoic = roicHistory.reduce((s, h) => s + h.roic, 0) / roicHistory.length;
        lines.push(`\n[⚙️ 역사적 ROIC — 자본효율성 · 재투자 앵커]`);
        lines.push(`  ROIC = [영업이익×(1-25%)] ÷ 투자자본(IC = Debt+Equity-Cash)`);
        for (const h of roicHistory) {
          lines.push(`  ${h.year}: ROIC ${h.roic.toFixed(1)}%`);
        }
        lines.push(`  평균 ROIC: ${avgRoic.toFixed(1)}% → 자본경량 기업 기준(>25%): ${avgRoic > 25 ? "✅ 해당" : "❌ 해당 안 됨"}`);
        lines.push(`  ✅ 자본경량 기업(ROIC>25%) 재투자: NOPAT × (성장률÷ROIC) 방식 권장`);
        lines.push(`  ⛔ DCF 장기 ROIC 가정이 역사적 평균(${avgRoic.toFixed(1)}%)의 2배를 초과하면 과낙관 — 재검토 필수`);
      }
    }
    // ── 이익 품질(Earnings Quality) 분석 ─────────────────────────────────────────
    // OCF/순이익 괴리, AR·재고 vs 매출 성장률 괴리 → 실적 추정 품질 판단
    {
      const sortedYrs = allYears.slice(0, 3); // 최근 3년
      const ccRatios: Array<{year: string; cc: number}> = [];
      for (const y of sortedYrs) {
        const ocf = ocfMap[y];
        const ni  = niMap[y];
        if (ocf != null && ni != null && Math.abs(ni) > 0) {
          ccRatios.push({ year: y, cc: ocf / ni });
        }
      }

      // AR vs 매출 성장률 괴리 (최근 2년)
      const arWarnings: string[] = [];
      const yrsForAR = sortedYrs.slice(0, 2);
      for (let i = 0; i < yrsForAR.length - 1; i++) {
        const y1 = yrsForAR[i], y0 = yrsForAR[i + 1];
        const revG = (revMap[y1] != null && revMap[y0] != null && revMap[y0] > 0)
          ? (revMap[y1] - revMap[y0]) / revMap[y0] * 100 : null;
        const arG  = (arMap[y1]  != null && arMap[y0]  != null && arMap[y0]  > 0)
          ? (arMap[y1]  - arMap[y0])  / arMap[y0]  * 100 : null;
        const invG = (invMap[y1] != null && invMap[y0] != null && invMap[y0] > 0)
          ? (invMap[y1] - invMap[y0]) / invMap[y0] * 100 : null;
        if (revG != null && arG != null && arG > revG + 15) {
          arWarnings.push(`${y1}: 매출채권 증가율(${arG.toFixed(1)}%) >> 매출 증가율(${revG.toFixed(1)}%) → 현금 회수 지연·허수 매출 가능성`);
        }
        if (revG != null && invG != null && invG > revG + 20) {
          arWarnings.push(`${y1}: 재고 증가율(${invG.toFixed(1)}%) >> 매출 증가율(${revG.toFixed(1)}%) → 수요 둔화·재고 부담 위험`);
        }
      }

      if (ccRatios.length > 0 || arWarnings.length > 0) {
        lines.push(`\n[🔬 이익 품질(Earnings Quality) 분석 — 실적 추정 신뢰도 핵심]`);
        lines.push(`  ⚠️ 아래 지표를 실적 추정 시 반드시 반영하세요.`);

        if (ccRatios.length > 0) {
          lines.push(`  [현금전환율 OCF/순이익 — 1.0x=정상, 0.5x↓=이익 품질 의심]`);
          for (const { year, cc } of ccRatios) {
            const flag = cc < 0.5 ? ` ⚠️ 낮음 — 이익 품질 의심, 순이익 추정치 보수화 필수`
              : cc < 0.8 ? ` 🟡 보통 — 일부 비현금 이익 포함, 주의 필요`
              : ` ✅ 양호`;
            lines.push(`    ${year}: ${cc.toFixed(2)}x${flag}`);
          }
          const avgCC = ccRatios.reduce((s, r) => s + r.cc, 0) / ccRatios.length;
          if (avgCC < 0.5) {
            lines.push(`  ⛔ 평균 현금전환율 ${avgCC.toFixed(2)}x — 순이익 기반 추정 신뢰도 낮음. EPS 추정치를 10~20% 하향 보수화 적용.`);
          }
        }

        if (arWarnings.length > 0) {
          lines.push(`  [매출채권·재고 이상 신호]`);
          for (const w of arWarnings) lines.push(`    ⚠️ ${w}`);
          lines.push(`    → 매출 추정 시 해당 연도 성장률을 5~10%p 추가 보수화 권장`);
        }
      }
    }

    // ── 매출총이익률(GPM) 추세 — 가격결정력 앵커 ───────────────────────────────
    {
      const gpmHistory: Array<{year: string; gpm: number}> = [];
      for (const y of allYears) {
        const rev = revMap[y];
        const gp  = gpMap[y];
        if (rev != null && gp != null && rev > 0) {
          const gpm = gp / rev * 100;
          if (gpm > 0 && gpm < 100) gpmHistory.push({ year: y, gpm });
        }
      }
      if (gpmHistory.length >= 2) {
        const sorted = gpmHistory.sort((a, b) => Number(a.year) - Number(b.year));
        const first = sorted[0].gpm, last = sorted[sorted.length - 1].gpm;
        const avgGpm = sorted.reduce((s, h) => s + h.gpm, 0) / sorted.length;
        const trend = last > first + 3 ? "개선(가격결정력 강화)" : last < first - 3 ? "악화(원가 압박 또는 경쟁 심화)" : "안정적";
        lines.push(`\n[📊 매출총이익률(GPM) 추세 — 가격결정력·원가구조 앵커]`);
        lines.push(`  ${sorted.map(h => `${h.year}: ${h.gpm.toFixed(1)}%`).join(" → ")} [${trend}]`);
        lines.push(`  평균 GPM: ${avgGpm.toFixed(1)}% | 최근 GPM: ${last.toFixed(1)}%`);
        lines.push(`  ⛔ 실적 추정 시 GPM이 역사적 최고(${Math.max(...gpmHistory.map(h => h.gpm)).toFixed(1)}%)를 초과하는 시나리오는 근거 없이 사용 금지.`);
        if (last < first - 5) {
          lines.push(`  ⚠️ GPM ${(first - last).toFixed(1)}%p 하락 추세 — OPM 회복 가정 시 GPM 개선 근거 반드시 명시.`);
        }
      }
    }

  } else {
    // Fallback: legacy incomeStatementHistory
    const incomeStmts: any[] = (result.incomeStatementHistory as any)?.incomeStatementHistory ?? [];
    if (incomeStmts.length > 0) {
      lines.push("\n[손익계산서 - 연간 실적 (legacy)]");
      for (const stmt of incomeStmts.slice(0, 4)) {
        const year = toYear(stmt.endDate);
        const rev  = fmtNum(stmt.totalRevenue, currency);
        const gp   = fmtNum(stmt.grossProfit, currency);
        const op   = fmtNum(stmt.operatingIncome ?? stmt.totalOperatingExpenses, currency);
        const ni   = fmtNum(stmt.netIncome, currency);
        const eps  = stmt.basicEps != null ? stmt.basicEps.toFixed(2) : (stmt.dilutedEps != null ? stmt.dilutedEps.toFixed(2) : "-");
        lines.push(`  ${year}년: 매출 ${rev} | GP ${gp} | 영업이익 ${op} | 순이익 ${ni} | EPS ${eps}`);
      }
    }
  }

  // ── 현금흐름표 (fundamentalsTimeSeries 우선, legacy fallback) ──────────────────
  const cfYears = [...new Set([
    ...Object.keys(ocfMap), ...Object.keys(fcfMap), ...Object.keys(capexMap)
  ])].sort((a, b) => Number(b) - Number(a)).slice(0, 4);

  if (cfYears.length > 0) {
    lines.push("\n[현금흐름표 — fundamentalsTimeSeries]");
    for (const year of cfYears) {
      const ocf   = ocfMap[year]   != null ? fmtNum(ocfMap[year], currency)   : "-";
      const fcf   = fcfMap[year]   != null ? fmtNum(fcfMap[year], currency)   : "-";
      const capex = capexMap[year] != null ? fmtNum(capexMap[year], currency) : "-";
      const fcfConv = (ocfMap[year] != null && fcfMap[year] != null && ocfMap[year] > 0)
        ? ` (FCF전환율 ${(fcfMap[year] / ocfMap[year] * 100).toFixed(0)}%)` : "";
      lines.push(`  ${year}년: 영업CF ${ocf} | FCF ${fcf}${fcfConv} | CAPEX ${capex}`);
    }
  } else {
    const cfStmtsLegacy: any[] = (result.cashflowStatementHistory as any)?.cashflowStatements ?? [];
    if (cfStmtsLegacy.length > 0) {
      lines.push("\n[현금흐름표]");
      for (const stmt of cfStmtsLegacy.slice(0, 4)) {
        const year  = toYear(stmt.endDate);
        const ocf   = fmtNum(stmt.totalCashFromOperatingActivities, currency);
        const capex = fmtNum(stmt.capitalExpenditures, currency);
        const icf   = fmtNum(stmt.totalCashflowsFromInvestingActivities, currency);
        lines.push(`  ${year}년: 영업CF ${ocf} | CAPEX ${capex} | 투자CF ${icf}`);
      }
    }
  }

  // ── DCF 재투자 앵커 (Maintenance Capex · D&A) ─────────────────────────────────
  {
    const latestCapexYear = Object.keys(capexMap).sort((a, b) => Number(b) - Number(a))[0];
    const latestDnaYear   = Object.keys(dnaMap).sort((a, b) => Number(b) - Number(a))[0];
    const capexVal = latestCapexYear ? capexMap[latestCapexYear] : null;
    const dnaVal   = latestDnaYear   ? dnaMap[latestDnaYear]    : null;

    // 자본경량(Capital-Light) IT/플랫폼 기업 감지
    // D&A의 대부분이 소프트웨어·IP 상각이라 물리 설비 유지비가 적음 → D&A×0.7 적용
    const capitalLightTickers = new Set([
      'AAPL', 'GOOGL', 'GOOG', 'META', 'NFLX', 'CRM', 'ADBE', 'NOW',
      'SHOP', 'SNAP', 'PINS', 'SPOT', 'UBER', 'LYFT', 'ABNB',
    ]);
    const capexRevRatio = (capexVal != null && fd?.totalRevenue)
      ? Math.abs(capexVal) / fd.totalRevenue : null;
    const isCapitalLight = !isKorean && (
      capitalLightTickers.has(resolvedSymbol.toUpperCase().split('.')[0]) ||
      (capexRevRatio !== null && capexRevRatio < 0.04)
    );
    const dnaMultiplier = isCapitalLight ? 0.7 : 1.2;
    const dnaMultiplierLabel = isCapitalLight ? "0.7 (IT/플랫폼 자본경량 업종)" : "1.2";

    if (capexVal != null || dnaVal != null) {
      lines.push("\n[DCF 재투자 앵커 — 반드시 재투자 하한으로 사용]");
      lines.push("⛔ 아래 수치를 DCF 재투자 계산의 기준점으로 사용하세요. 무시 금지.");
      if (isCapitalLight) {
        lines.push(`  ℹ️ 자본경량(Capital-Light) 기업 감지 → D&A 계수 ${dnaMultiplierLabel} 적용. ROIC 기반 재투자 방식 사용 권장.`);
      }

      if (capexVal != null) {
        const capexAbs = Math.abs(capexVal); // Yahoo sometimes stores as negative
        lines.push(`  최근 실제 CAPEX (${latestCapexYear}): ${fmtNum(capexAbs, currency)}  ← Maintenance Capex 하한 앵커`);
        if (dnaVal != null) {
          const dnaAbs = Math.abs(dnaVal);
          const maintenanceFloor = Math.max(capexAbs, dnaAbs * dnaMultiplier);
          lines.push(`  D&A (${latestDnaYear}): ${fmtNum(dnaAbs, currency)}`);
          lines.push(`  Maintenance Capex 하한 = MAX(실제CAPEX, D&A×${dnaMultiplierLabel}) = ${fmtNum(maintenanceFloor, currency)}  ← 어떤 연도에도 재투자가 이 값 미만이면 오류`);
          if (isCapitalLight) {
            lines.push(`  ⚠️ 자본경량 기업: Growth Capex 공식 대신 NOPAT×(g/ROIC) 방식으로 재투자 산출 권장`);
            lines.push(`  ⚠️ 총 재투자 = MAX(Maintenance Capex 하한, NOPAT × (g ÷ ROIC))`);
          } else {
            lines.push(`  ⚠️ Growth Capex = MAX(0, 매출증분÷S-to-C − Maintenance Capex 하한)`);
            lines.push(`  ⚠️ 총 재투자 = Maintenance Capex 하한 + Growth Capex`);
          }
        } else {
          lines.push(`  ⚠️ 총 재투자 ≥ ${fmtNum(capexAbs, currency)} (최근 CAPEX 이상 유지 필수)`);
        }
      } else if (dnaVal != null) {
        const dnaAbs = Math.abs(dnaVal);
        lines.push(`  D&A (${latestDnaYear}): ${fmtNum(dnaAbs, currency)}`);
        lines.push(`  Maintenance Capex 하한 (D&A×${dnaMultiplierLabel}) = ${fmtNum(dnaAbs * dnaMultiplier, currency)}  ← 재투자 최솟값`);
      }

      // ── 서버 계산 Sales-to-Capital(S-to-C) 비율 — DCF 성장 투자효율 앵커 ─────────
      // S-to-C = 매출 ÷ 투자자본(IC = Total Debt + Equity - Cash)
      // DCF 재투자: Growth Capex = 매출증분 ÷ S-to-C
      // 이 값 없이 AI가 임의로 S-to-C를 쓰면 재투자 수치가 크게 왜곡됨
      {
        const stocYears = Object.keys(revMap)
          .filter(y => revMap[y] != null && eqMap[y] != null)
          .sort((a, b) => Number(b) - Number(a))
          .slice(0, 3);

        if (stocYears.length > 0) {
          lines.push(`\n[📐 서버 계산 Sales-to-Capital(S-to-C) 비율 — DCF Growth Capex 앵커]`);
          lines.push(`  ⛔ Growth Capex = 매출증분 ÷ S-to-C (서버 계산 앵커 범위 사용. 임의 S-to-C 금지)`);

          const stocVals: number[] = [];
          for (const y of stocYears) {
            const rev   = revMap[y];
            const eq    = eqMap[y];
            const debt  = debtMap[y] ?? 0;
            const cash  = cashTsMap[y] ?? 0;
            const ic    = eq + debt - cash;
            if (ic > 0 && rev != null) {
              const stoc = rev / ic;
              stocVals.push(stoc);
              lines.push(`  ${y}: 매출 ${fmtNum(rev, currency)} ÷ 투자자본(IC) ${fmtNum(ic, currency)} = S-to-C ${stoc.toFixed(2)}x`);
            }
          }
          if (stocVals.length > 0) {
            const avg = stocVals.reduce((a, b) => a + b, 0) / stocVals.length;
            const stocLabel =
              avg < 0.8  ? "낮음 (자본집약 — 재투자 부담 대)" :
              avg < 1.5  ? "보통 (중간 자본집약)" :
              avg < 3.0  ? "높음 (자본경량 경향)" :
                           "매우 높음 (IT/플랫폼형 자본경량)";
            lines.push(`  ✅ 3년 평균 S-to-C: ${avg.toFixed(2)}x [${stocLabel}]`);
            lines.push(`  → Growth Capex 계산 시 이 범위(${Math.max(avg * 0.8, 0.5).toFixed(1)}x–${(avg * 1.2).toFixed(1)}x)를 사용. 범위 이탈 시 재계산 필수.`);
          }
        }
      }
    }
  }

  // ── 재무상태표 ────────────────────────────────────────────────────────────────
  const balanceStmts: any[] = (result.balanceSheetHistory as any)?.balanceSheetStatements ?? [];
  if (balanceStmts.length > 0) {
    lines.push("\n[재무상태표 - 최근 연도]");
    for (const stmt of balanceStmts.slice(0, 2)) {
      const year = toYear(stmt.endDate);
      lines.push(
        `  ${year}년: 총자산 ${fmtNum(stmt.totalAssets, currency)} | 총부채 ${fmtNum(stmt.totalLiab, currency)} | 자기자본 ${fmtNum(stmt.totalStockholderEquity, currency)} | 현금 ${fmtNum(stmt.cash, currency)}`
      );
    }
  }

  // ── WACC·EBITDA 계산 핵심 데이터 (가장 최근 연도 기준) ───────────────────────────
  {
    const latestWaccYear = [...new Set([
      ...Object.keys(intExpMap), ...Object.keys(dnaMap),
      ...Object.keys(debtMap), ...Object.keys(cashTsMap),
    ])].sort((a, b) => Number(b) - Number(a))[0];

    const waccLines: string[] = [];
    if (latestWaccYear) {
      if (intExpMap[latestWaccYear] != null) {
        // Yahoo stores interest expense as negative → take absolute value
        const intExp = Math.abs(intExpMap[latestWaccYear]);
        const debt = debtMap[latestWaccYear];
        // ─── 서버에서 CoD를 직접 계산해 전달 (AI 단위 변환 오류 방지) ─────────────
        // intExp와 debt는 Yahoo Finance raw 값으로 같은 단위(KRW 또는 USD)이므로 직접 나눠도 됨
        const codRaw = (debt != null && debt > 0) ? (intExp / debt) : null;
        const codPct = codRaw != null ? parseFloat((codRaw * 100).toFixed(2)) : null;

        // CoD 합리성 범위: 한국 IG 회사채 2~7%, US IG 3~8%.
        // 10% 초과는 이자부 금융부채(분모)가 실제 총차입보다 과소 집계됐을 가능성 높음.
        // 30% 초과는 분모가 총부채(무이자 부채 포함) 수준으로 오집계된 극단 케이스.
        let codTag = "";
        if (codPct == null) {
          codTag = "  ⚠️ [CoD 계산 불가] 이자부 금융부채 데이터 없음 → 신용등급 기준표 사용";
        } else if (codPct > 10) {
          codTag = `  ⚠️ [CoD 비정상 ↑] 서버 계산 CoD(세전) = ${codPct}% (10% 초과 — 이자부 금융부채 과소집계 또는 리스 이자 혼입 가능) → 신용등급 기준표 사용`;
        } else if (codPct < 0.5) {
          codTag = `  ⚠️ [CoD 비정상 ↓] 서버 계산 CoD(세전) = ${codPct}% (0.5% 미만 — 금융자회사 부채 혼입 가능) → 신용등급 기준표 사용`;
        } else {
          codTag = `  ✅ 서버 계산 CoD(세전) = ${codPct}% → AI는 이 값을 직접 사용 (단위 환산 불필요)`;
        }
        waccLines.push(
          `이자비용(Interest Expense, ${latestWaccYear}): ${fmtNum(intExp, currency)} | 이자부 금융부채(Total Debt): ${debt != null ? fmtNum(debt, currency) : "N/A"}${codTag}`
        );
      }
      if (dnaMap[latestWaccYear] != null) {
        waccLines.push(`D&A(감가상각비, ${latestWaccYear}): ${fmtNum(dnaMap[latestWaccYear], currency)}  ※ EBITDA = 영업이익 + 이 D&A`);
      }
      if (debtMap[latestWaccYear] != null) {
        waccLines.push(`총부채(Total Debt, ${latestWaccYear}): ${fmtNum(debtMap[latestWaccYear], currency)}`);
      }
      if (cashTsMap[latestWaccYear] != null) {
        waccLines.push(`현금성자산(${latestWaccYear}): ${fmtNum(cashTsMap[latestWaccYear], currency)}`);
      }
      // 순부채 계산
      if (debtMap[latestWaccYear] != null && cashTsMap[latestWaccYear] != null) {
        const netDebt = debtMap[latestWaccYear] - cashTsMap[latestWaccYear];
        waccLines.push(`순부채(Net Debt, ${latestWaccYear}): ${fmtNum(netDebt, currency)} ${netDebt < 0 ? "(순현금 상태)" : "(순부채 상태)"}`);
      }
    }
    // Supplement from financialData if timeseries missing
    if (!intExpMap[latestWaccYear ?? ""] && fd?.interestExpense != null) {
      waccLines.push(`이자비용(TTM, financialData): ${fmtNum(Math.abs(fd.interestExpense), currency)}`);
    }
    if (!dnaMap[latestWaccYear ?? ""] && fd?.ebitda != null && fd?.operatingCashflow != null) {
      // Rough D&A estimate from EBITDA - EBIT if both available
    }
    // 시가총액을 억원 단위로 명시 — AI가 조→억 변환 시 ×100,000 오류를 방지
    // summaryDetail.marketCap이 한국 주식에서 가장 안정적으로 값 제공
    const waccMcap: number | null = sd?.marketCap ?? ks?.marketCap ?? null;
    if (waccMcap != null) {
      if (currency === "KRW") {
        const mcapOkWon = Math.round(waccMcap / 1e8);
        waccLines.unshift(
          `시가총액(E, 억원 정확값): ${mcapOkWon.toLocaleString("ko-KR")}억원` +
          `  ← E% 계산 시 반드시 이 억원 숫자를 사용 (조원 직접 사용·재변환 금지)`
        );
      } else {
        waccLines.unshift(`시가총액(E): $${(waccMcap / 1e9).toFixed(2)}B`);
      }
    }
    // ── 서버 WACC 추정값 계산 (Rf + Beta × ERP 방식) ─────────────────────────────
    {
      const beta = histBeta?.beta ?? ks?.beta ?? null;
      const betaSrc = histBeta?.beta != null
        ? `역사적52주,Blume,R²=${histBeta.rSquared},${betaIndexSymbol}`
        : `Yahoo`;
      const mcap = waccMcap;
      const latestDebt = latestWaccYear ? debtMap[latestWaccYear] : null;
      const latestCash = latestWaccYear ? cashTsMap[latestWaccYear] : null;
      const latestIntExp = latestWaccYear ? Math.abs(intExpMap[latestWaccYear] ?? 0) : null;

      // Country-specific parameters
      const isKRW = currency === "KRW";
      const Rf   = isKRW ? 0.035 : 0.044;  // KRW: KTB10Y ~3.5%,  USD: UST10Y ~4.4%
      const ERP  = isKRW ? 0.060 : 0.046;  // KRW: Damodaran Korea ~6.0%, USD: Implied ~4.6%
      const taxRate = 0.25; // default corporate tax (25% KR, close enough for USD at 21%)

      if (beta != null && mcap != null) {
        const CoE = Rf + beta * ERP;

        // D/E ratio for relevered beta
        const D = latestDebt ?? 0;
        const E = mcap;
        const DoverEplusD = D / (D + E);
        const EoverEplusD = E / (D + E);

        // CoD: use server-computed value if available, else fallback
        const latestIntExpVal = latestIntExp ?? fd?.interestExpense != null ? Math.abs(fd!.interestExpense!) : 0;
        const codRawCalc = (latestDebt != null && latestDebt > 0)
          ? latestIntExpVal / latestDebt
          : null;
        const codAfterTax = codRawCalc != null && codRawCalc > 0.005 && codRawCalc < 0.10
          ? codRawCalc * (1 - taxRate)
          : 0.05 * (1 - taxRate); // fallback: BBB spread 5% (CoD 비정상 또는 미확인 시)

        const waccEst = CoE * EoverEplusD + codAfterTax * DoverEplusD;
        const waccEstPct = parseFloat((waccEst * 100).toFixed(2));
        const CoEPct     = parseFloat((CoE * 100).toFixed(2));

        const waccInRange = waccEstPct >= 8 && waccEstPct <= 16;

        if (waccInRange) {
          // 정상 범위: 서버 값을 출발점으로 사용하도록 지시
          waccLines.push(
            `\n[🧮 서버 계산 WACC 추정값 — 반드시 이 값을 출발점으로 사용]` +
            `\n  Beta(${betaSrc}): ${beta.toFixed(2)} | Rf: ${(Rf*100).toFixed(1)}% | ERP: ${(ERP*100).toFixed(1)}%` +
            `\n  CoE = ${(Rf*100).toFixed(1)}% + ${beta.toFixed(2)}×${(ERP*100).toFixed(1)}% = ${CoEPct}%` +
            `\n  D/(D+E) = ${(DoverEplusD*100).toFixed(1)}%  |  E/(D+E) = ${(EoverEplusD*100).toFixed(1)}%` +
            `\n  CoD(after-tax) = ${(codAfterTax*100).toFixed(2)}%` +
            `\n  ➡️ 서버 WACC 추정값: ${waccEstPct}% ✅ 정상 범위 (8~16%)` +
            `\n  ⚠️ 이 값에서 ±1~2%p 내에서만 조정 허용. 벗어나려면 구체적 근거 필수.`
          );
        } else {
          // 비정상 범위: 서버 값 폐기, AI 직접 산출 지시
          const rangeLabel = waccEstPct < 8 ? "과소(8% 미만)" : "과대(16% 초과)";
          waccLines.push(
            `\n[🧮 서버 계산 WACC 참고값 — ⛔ 신뢰 불가, 아래 값 사용 금지]` +
            `\n  서버 추정값: ${waccEstPct}% (${rangeLabel} — 데이터 품질 문제로 신뢰 불가)` +
            `\n  Beta(${betaSrc}): ${beta.toFixed(2)} | Rf: ${(Rf*100).toFixed(1)}% | ERP: ${(ERP*100).toFixed(1)}%` +
            `\n  ⚠️ [AI 지시] 위 서버 추정값(${waccEstPct}%)은 절대 사용하지 마세요.` +
            `\n     아래 가드레일 기준에 따라 Rf·β·ERP를 직접 입력해 WACC를 새로 산출하고,` +
            `\n     산출된 단일 값 하나만 보고서에 명시하세요. 두 개의 WACC 수치가 공존하면 안 됩니다.`
          );
        }
      } else {
        waccLines.push(
          `\n[🧮 서버 계산 WACC 추정값] Beta 또는 시가총액 미확보 — AI가 가드레일 기준으로 직접 산출 필요`
        );
      }
    }

    if (waccLines.length > 0) {
      lines.push("\n[⚡ WACC·EBITDA 계산 핵심 데이터 — 반드시 아래 수치를 사용할 것]");
      lines.push("※ CoD = 이자비용 ÷ 이자부 금융부채(차입금+사채, 무이자 매입채무·미지급금 제외), EBITDA = 영업이익 + D&A (추정 금지, 아래 수치 직접 사용)");
      lines.push("※ 단위 주의: 1조 = 10,000억 (AI 변환 오류 빈번) — 아래 시가총액은 이미 억원으로 변환된 값임");
      lines.push(...waccLines);
    }
  }

  // ── 분기별 실적 (fundamentalsTimeSeries quarterly) ───────────────────────────
  {
    const toQtrMap = (key: string, limit = 6): Array<{period: string; value: number}> => {
      for (const row of tsRows) {
        if (row[key]) {
          return (row[key] as any[])
            .filter((e: any) => e?.reportedValue?.raw != null)
            .map((e: any) => {
              const d = new Date(e.asOfDate);
              const q = `${d.getFullYear()}Q${Math.ceil((d.getMonth() + 1) / 3)}`;
              return { period: q, value: e.reportedValue.raw as number };
            })
            .sort((a, b) => b.period.localeCompare(a.period))
            .slice(0, limit);
        }
      }
      return [];
    };

    const qRev  = toQtrMap("quarterlyTotalRevenue");
    const qOp   = toQtrMap("quarterlyOperatingIncome");
    const qNi   = toQtrMap("quarterlyNetIncome");
    const qEps  = toQtrMap("quarterlyBasicEPS");
    const qOcf  = toQtrMap("quarterlyOperatingCashFlow");
    const qFcf  = toQtrMap("quarterlyFreeCashFlow");

    const qPeriods = [...new Set([
      ...qRev.map(x => x.period), ...qOp.map(x => x.period), ...qNi.map(x => x.period)
    ])].sort((a, b) => b.localeCompare(a)).slice(0, 6);

    if (qPeriods.length > 0) {
      lines.push("\n[분기별 실적 — 최근 6분기 (fundamentalsTimeSeries)]");
      lines.push("※ 분기 실적 추세로 연간 전망 추정 시 반드시 참고하세요.");
      for (const p of qPeriods) {
        const rv  = qRev.find(x => x.period === p)?.value;
        const op  = qOp.find(x => x.period === p)?.value;
        const ni  = qNi.find(x => x.period === p)?.value;
        const eps = qEps.find(x => x.period === p)?.value;
        const ocf = qOcf.find(x => x.period === p)?.value;
        const fcf = qFcf.find(x => x.period === p)?.value;
        const opM = rv && op != null ? ` (${(op / rv * 100).toFixed(1)}%)` : "";
        const epsStr = eps != null ? ` | EPS ${eps.toFixed(0)}원` : "";
        const cfStr = ocf != null ? ` | 영업CF ${fmtNum(ocf, currency)}` : "";
        const fcfStr = fcf != null ? ` | FCF ${fmtNum(fcf, currency)}` : "";
        lines.push(
          `  ${p}: 매출 ${rv != null ? fmtNum(rv, currency) : "-"} | 영업이익 ${op != null ? fmtNum(op, currency) : "-"}${opM} | 순이익 ${ni != null ? fmtNum(ni, currency) : "-"}${epsStr}${cfStr}${fcfStr}`
        );
      }

      // ── 서버 산출 bottom-up 앵커: 계절성 반영 분기별 OPM 추정 ──────────────
      // 계절성 계산용으로 최대 16분기(4년치) 수집
      const qRevAll = toQtrMap("quarterlyTotalRevenue", 16);
      const qOpAll  = toQtrMap("quarterlyOperatingIncome", 16);

      // 전체 OPM 시계열 구성
      const allPeriods = [...new Set([...qRevAll.map(x => x.period), ...qOpAll.map(x => x.period)])]
        .sort((a, b) => b.localeCompare(a));

      const fullOpmSeries: { period: string; year: number; qNum: number; rev: number; op: number; opm: number }[] = [];
      for (const p of allPeriods) {
        const rv = qRevAll.find(x => x.period === p)?.value ?? null;
        const op = qOpAll.find(x => x.period === p)?.value ?? null;
        if (rv != null && rv > 0 && op != null) {
          const year = parseInt(p.slice(0, 4), 10);
          const qNum = parseInt(p.slice(5), 10);
          fullOpmSeries.push({ period: p, year, qNum, rev: rv, op, opm: (op / rv) * 100 });
        }
      }

      // 최근 4분기 (추세 계산용)
      const recentSeries = fullOpmSeries.slice(0, 4);

      if (recentSeries.length >= 2) {
        const latest = recentSeries[0];  // 최신 확정 분기

        // ── 현재 연도 및 확정 분기 수집 ───────────────────────────────────────
        const confirmedYear = parseInt(latest.period.slice(0, 4), 10);
        const targetYear = Math.max(confirmedYear, new Date().getFullYear());

        // 현재 연도 내 모든 확정 분기 (오름차순 정렬)
        const curYearConfirmed = fullOpmSeries
          .filter(d => d.year === targetYear)
          .sort((a, b) => a.qNum - b.qNum);

        // 확정 분기 합산
        const confirmedRevSum = curYearConfirmed.reduce((s, d) => s + d.rev, 0);
        const confirmedOpSum  = curYearConfirmed.reduce((s, d) => s + d.op,  0);
        const confirmedOpmAvg = confirmedRevSum > 0 ? (confirmedOpSum / confirmedRevSum) * 100 : null;
        const confirmedQNums  = new Set(curYearConfirmed.map(d => d.qNum));
        const remainingQtrs   = [1, 2, 3, 4].filter(q => !confirmedQNums.has(q));
        const confirmedQCount = curYearConfirmed.length;

        // ── forward OPM 기준값 ────────────────────────────────────────────────
        const prevQ     = recentSeries[1];
        const trendQoQ  = latest.opm - prevQ.opm;
        const wts       = recentSeries.length >= 3 ? [0.5, 0.3, 0.2] : [0.6, 0.4];
        const weightedAvgOpm = recentSeries.slice(0, wts.length)
          .reduce((s, d, i) => s + d.opm * wts[i], 0);

        // 추세 방향에 따라 다른 가중치 적용:
        // 상승 추세: 최신 분기에 더 가중 (모멘텀 유지)
        // 하락 추세: 추세 지속을 더 신뢰 (평균 회귀 억제)
        // 강한 하락(QoQ -2%p 이상): 추세 외삽 비중 대폭 확대
        const trendOpmCenter = trendQoQ >= 0
          ? latest.opm * 0.65 + weightedAvgOpm * 0.35   // 상승: 최신 65%
          : trendQoQ >= -2
            ? latest.opm * 0.65 + weightedAvgOpm * 0.35 // 완만한 하락: 동일 (최신 실적 반영)
            : latest.opm * 0.80 + weightedAvgOpm * 0.20; // 강한 하락(-2%p↓): 최신 80%, 평균 20%

        // 확정 분기가 많을수록 확정 누적 OPM을 더 신뢰
        // Q1만(1개): 30%, 반기(2개): 55%, Q3까지(3개): 75%
        const confirmedWeight = confirmedQCount >= 3 ? 0.75 : confirmedQCount === 2 ? 0.55 : 0.30;
        const fwdOpmBase = confirmedOpmAvg !== null
          ? confirmedOpmAvg * confirmedWeight + trendOpmCenter * (1 - confirmedWeight)
          : trendOpmCenter;
        // fwdOpmCenter 최종값은 byYear 계산 후 연간 OPM 앵커와 혼합 (아래에서 선언)

        // ── 계절성 인덱스 계산 ────────────────────────────────────────────────
        const byYear: Record<number, { opm: number; qNum: number }[]> = {};
        for (const d of fullOpmSeries) {
          if (!byYear[d.year]) byYear[d.year] = [];
          byYear[d.year].push({ opm: d.opm, qNum: d.qNum });
        }
        const seasonDeltaRaw: Record<number, number[]> = {1: [], 2: [], 3: [], 4: []};
        for (const [, qData] of Object.entries(byYear)) {
          if (qData.length < 3) continue;
          const yearAvg = qData.reduce((s, d) => s + d.opm, 0) / qData.length;
          for (const d of qData) {
            seasonDeltaRaw[d.qNum]?.push(d.opm - yearAvg);
          }
        }
        const seasonIdx: Record<number, number | null> = {1: null, 2: null, 3: null, 4: null};
        const seasonYears = Object.keys(byYear).filter(yr => byYear[Number(yr)].length >= 3).length;
        const dampFactor = seasonYears >= 3 ? 0.55 : seasonYears === 2 ? 0.40 : 0.25;
        for (const q of [1, 2, 3, 4]) {
          const vals = seasonDeltaRaw[q];
          if (vals.length > 0) {
            seasonIdx[q] = (vals.reduce((s, v) => s + v, 0) / vals.length) * dampFactor;
          }
        }
        // fallback: 데이터 부족 시 한국 일반 제조업 기본 패턴
        const DEFAULT_SEASONAL: Record<number, number> = { 1: -1.0, 2: 0.2, 3: -0.3, 4: 1.2 };

        // ── 연간 OPM 앵커 (Q1 계절 왜곡 완화용) ───────────────────────────────
        // 과거 완성된 연도의 연간 영업이익/매출을 집계해 가중평균 OPM 계산
        const annualPerfByYear: Record<number, { rev: number; op: number }> = {};
        for (const d of fullOpmSeries) {
          if (!annualPerfByYear[d.year]) annualPerfByYear[d.year] = { rev: 0, op: 0 };
          annualPerfByYear[d.year].rev += d.rev;
          annualPerfByYear[d.year].op  += d.op;
        }
        // targetYear 제외, 3분기 이상 데이터가 있는 완성된 연도만 (최근 3개년)
        const completeAnnualYears = Object.entries(annualPerfByYear)
          .filter(([yr]) => Number(yr) < targetYear && (byYear[Number(yr)]?.length ?? 0) >= 3)
          .sort(([a], [b]) => Number(b) - Number(a))
          .slice(0, 3);
        const anchorWts = completeAnnualYears.length >= 3 ? [0.5, 0.3, 0.2]
          : completeAnnualYears.length === 2 ? [0.6, 0.4] : [1.0];
        const annualOpmAnchor: number | null = completeAnnualYears.length > 0
          ? completeAnnualYears.reduce((s, [, v], i) => {
              const opm = v.rev > 0 ? (v.op / v.rev) * 100 : 0;
              return s + opm * (anchorWts[i] ?? 0);
            }, 0)
          : null;

        // ── 흑자전환 여부 먼저 판정 (fwdOpmCenterRaw 계산에 필요) ────────────────
        const confirmedIsProfit = confirmedOpmAvg !== null && confirmedOpmAvg > 2.0;
        // 과거 적자 → 현재 흑자 전환: 역사 OPM 앵커가 구 레짐(적자기)을 반영하므로 미래 추정에 부적합
        const isDeepTurnaround  = confirmedIsProfit && annualOpmAnchor !== null && annualOpmAnchor < 0;

        // ── fwdOpmCenter 최종값: 추세 방향 + 흑자전환 여부에 따라 연간 앵커 혼합 비율 조정 ──
        // [핵심 원칙]
        //   흑자전환 기업: 과거 적자 OPM 앵커는 구 비즈니스 레짐 → 미래 추정 배제.
        //                  Q1 확정 OPM이 새 베이스라인. 수주 증가·원가 구조 개선이 반영된 현재 실적 우선.
        //   일반 기업:     역사 연간 OPM으로 평균 회귀 기대 (기존 로직 유지).
        const isDeclineTrend = trendQoQ < -1;
        const fwdOpmCenterRaw = (() => {
          if (annualOpmAnchor === null) return fwdOpmBase;
          if (confirmedQCount >= 2)     return fwdOpmBase; // Q2 이상 확정: 확정 실적 우선

          // ★ 흑자전환 기업: 과거 적자 앵커 완전 배제 — 현재 확정 Q1 OPM이 새 추정 기준
          if (isDeepTurnaround) return fwdOpmBase;

          if (isDeclineTrend) {
            return confirmedQCount === 1
              ? fwdOpmBase * 0.65 + annualOpmAnchor * 0.35
              : fwdOpmBase * 0.75 + annualOpmAnchor * 0.25;
          } else {
            return confirmedQCount === 1
              ? fwdOpmBase * 0.35 + annualOpmAnchor * 0.65
              : fwdOpmBase * 0.50 + annualOpmAnchor * 0.50;
          }
        })();

        // ── 흑자전환 보호: fwdOpmCenter가 확정 OPM 대비 과소하면 하한 보정 ──────
        let fwdOpmTurnaroundNote = "";
        const fwdOpmCenter = (() => {
          if (!confirmedIsProfit) return fwdOpmCenterRaw;
          if (fwdOpmCenterRaw >= confirmedOpmAvg! * 0.15) return fwdOpmCenterRaw;
          // 흑자전환 기업: floor를 55%로 높임 (지속 수주·원가 개선 반영)
          // 일반 흑자전환: 25% floor (계절성 감안)
          const turnaroundFloor = isDeepTurnaround
            ? confirmedOpmAvg! * 0.55
            : confirmedOpmAvg! * 0.25;
          const adjusted = Math.max(fwdOpmCenterRaw, turnaroundFloor);
          if (adjusted !== fwdOpmCenterRaw) {
            fwdOpmTurnaroundNote = isDeepTurnaround
              ? ` ⚠️ [흑자전환·레짐변화] 과거 적자 앵커 배제 후 원산출 ${fwdOpmCenterRaw.toFixed(1)}% → ${adjusted.toFixed(1)}%로 하한 보정 (확정 OPM ${confirmedOpmAvg!.toFixed(1)}%의 55% 최솟값. 수주 성장·원가 구조 개선으로 분기 실적이 지속 개선 중인 기업에 적용)`
              : ` ⚠️ [흑자전환보호] 원산출 ${fwdOpmCenterRaw.toFixed(1)}% → ${adjusted.toFixed(1)}%로 하한 보정 (확정 OPM ${confirmedOpmAvg!.toFixed(1)}%의 25% 최솟값)`;
          }
          return adjusted;
        })();

        // ── 매출 추정: 확정 분기 YoY 성장률 + 역사적 비율 혼합 ──────────────
        const qRevByQNum: Record<number, number[]> = {1: [], 2: [], 3: [], 4: []};
        for (const d of fullOpmSeries) {
          if (qRevByQNum[d.qNum]) qRevByQNum[d.qNum].push(d.rev);
        }

        // 분기별 전년 동기 빠른 조회 맵 (year_qNum → rev)
        const revMap: Record<string, number> = {};
        for (const d of fullOpmSeries) {
          revMap[`${d.year}_${d.qNum}`] = d.rev;
        }

        // ① 확정 분기들의 YoY 매출 성장률 계산
        const yoyGrowths: number[] = [];
        for (const d of curYearConfirmed) {
          const prevRev = revMap[`${d.year - 1}_${d.qNum}`];
          if (prevRev && prevRev > 0) {
            yoyGrowths.push((d.rev - prevRev) / prevRev);
          }
        }
        // 확정 평균 YoY 성장률 (없으면 null)
        const confirmedYoYGrowth = yoyGrowths.length > 0
          ? yoyGrowths.reduce((s, v) => s + v, 0) / yoyGrowths.length
          : null;

        // ② 미확정 분기 매출 추정
        // 기준점: 확정 Q1 또는 최신 확정 분기 매출
        const confirmedQ1 = curYearConfirmed.find(d => d.qNum === 1);
        const baseQ1Rev   = confirmedQ1?.rev ?? qRevByQNum[1][0] ?? latest.rev;
        const histQ1Avg   = qRevByQNum[1].slice(0, 3).reduce((s, v, _, a) => s + v / a.length, 0) || baseQ1Rev;

        // ── 구조적 회복 감지: Q1 실제가 역사 Q1 평균보다 크게 상회 시 Q1-비율법 가중치 증가 ──
        // 이유: 전년도 침체기 Q3 베이스가 낮을 때 YoY 방식만 쓰면 Q3E < Q1 실제가 되는 역설 발생.
        // Q1 구조적 개선폭에 비례해 Q1-비율법(현재 Q1 기준 Qn/Q1 역사비율)을 최대 50% 혼합.
        const q1StructuralGain = histQ1Avg > 0 ? (baseQ1Rev / histQ1Avg - 1) : 0;
        const q1RatioBlend     = Math.min(0.50, Math.max(0, q1StructuralGain * 1.5)); // 구조개선 33%→혼합 50%

        const estRevByQ: Record<number, number> = {};
        for (const q of remainingQtrs) {
          const prevYearRev = revMap[`${targetYear - 1}_${q}`];
          const hist        = qRevByQNum[q].slice(0, 3);
          const histQAvg    = hist.length > 0 ? hist.reduce((s, v) => s + v, 0) / hist.length : null;

          if (confirmedYoYGrowth !== null && prevYearRev && prevYearRev > 0) {
            // 주 방식: 확정 YoY 성장률 × 전년 동기
            const yoyEst = prevYearRev * (1 + confirmedYoYGrowth);
            // 보조 방식: 현재 Q1 기준 역사적 Qn/Q1 비율 (구조적 회복 반영)
            const q1RatioEst = histQAvg && histQ1Avg > 0
              ? baseQ1Rev * (histQAvg / histQ1Avg)
              : yoyEst;
            // 두 방식 혼합 (q1RatioBlend: Q1 구조개선 폭에 비례)
            const blendedEst = yoyEst * (1 - q1RatioBlend) + q1RatioEst * q1RatioBlend;
            estRevByQ[q] = histQAvg ? blendedEst * 0.7 + histQAvg * 0.3 : blendedEst;
          } else if (histQAvg && histQ1Avg > 0) {
            // 역사적 Qn/Q1 비율 적용
            const ratio  = histQAvg / histQ1Avg;
            estRevByQ[q] = (baseQ1Rev * ratio) * 0.7 + histQAvg * 0.3;
          } else {
            estRevByQ[q] = baseQ1Rev;
          }
        }

        // ── 미확정 분기 OPM 및 영업이익 추정 ─────────────────────────────────
        const estOpByQ:  Record<number, number>  = {};
        const estOpmByQ: Record<number, number>  = {};
        const usedFallback: Record<number, boolean> = {};
        for (const q of remainingQtrs) {
          const sIdx = seasonIdx[q];
          if (sIdx !== null && Math.abs(sIdx) >= 0.15) {
            estOpmByQ[q]    = fwdOpmCenter + sIdx;
            usedFallback[q] = false;
          } else {
            estOpmByQ[q]    = fwdOpmCenter + DEFAULT_SEASONAL[q];
            usedFallback[q] = true;
          }
          estRevByQ[q] = estRevByQ[q] ?? baseQ1Rev;
          estOpByQ[q]  = estRevByQ[q] * (estOpmByQ[q] / 100);
        }

        // ── 연간 합산 (확정 + 추정) ───────────────────────────────────────────
        const confirmedAnnualOp  = confirmedOpSum;
        const confirmedAnnualRev = confirmedRevSum;
        const estimatedOpSum  = remainingQtrs.reduce((s, q) => s + estOpByQ[q],  0);
        const estimatedRevSum = remainingQtrs.reduce((s, q) => s + (estRevByQ[q] ?? 0), 0);
        const annualOp  = confirmedAnnualOp  + estimatedOpSum;
        const annualRev = confirmedAnnualRev + estimatedRevSum;

        // 매출 불확실성 범위 (미확정 분기에만 ±5% 적용)
        const annualRevLow  = confirmedAnnualRev + remainingQtrs.reduce((s, q) => s + (estRevByQ[q] ?? 0) * 0.95, 0);
        const annualRevHigh = confirmedAnnualRev + remainingQtrs.reduce((s, q) => s + (estRevByQ[q] ?? 0) * 1.05, 0);
        // 영업이익 불확실성 범위 (미확정 분기에만 ±2%p OPM 적용)
        const annualOpLow  = confirmedAnnualOp + remainingQtrs.reduce((s, q) => s + (estRevByQ[q] ?? 0) * ((fwdOpmCenter - 2) / 100), 0);
        const annualOpHigh = confirmedAnnualOp + remainingQtrs.reduce((s, q) => s + (estRevByQ[q] ?? 0) * ((fwdOpmCenter + 2) / 100), 0);

        // ── 연간 목표에서 남은 분기 배분 (합산 정합성 보장) ──────────────────
        const restOpTarget  = annualOp  - confirmedAnnualOp;
        const restRevTarget = annualRev - confirmedAnnualRev;
        const totalEstRaw   = estimatedOpSum  || 1;
        const totalEstRevRaw = estimatedRevSum || 1;
        const distOpByQ:  Record<number, number> = {};
        const distRevByQ: Record<number, number> = {};
        for (const q of remainingQtrs) {
          distOpByQ[q]  = restOpTarget  * (estOpByQ[q]         / totalEstRaw);
          distRevByQ[q] = restRevTarget * ((estRevByQ[q] ?? 0) / totalEstRevRaw);
        }

        // ── 출력 ─────────────────────────────────────────────────────────────
        lines.push(`\n⛔⛔ [서버 산출 — 분기별 실적 앵커 (${targetYear}E 전망 시 반드시 이 값을 기준으로 사용, 무시 금지)]`);
        lines.push(`  OPM 추이 (오래된 → 최신): ${[...recentSeries].reverse().map(d => `${d.period} ${d.opm.toFixed(1)}%`).join(' → ')}`);
        lines.push(`  추세 방향: ${trendQoQ >= 0 ? '개선' : '악화'} (QoQ ${trendQoQ >= 0 ? '+' : ''}${trendQoQ.toFixed(1)}%p)`);

        // 확정 분기 현황 (매출 + 영업이익 함께)
        if (curYearConfirmed.length > 0) {
          const confirmedStr = curYearConfirmed
            .map(d => `Q${d.qNum}(매출 ${fmtNum(d.rev, currency)}, 영업이익 ${fmtNum(d.op, currency)}, OPM ${d.opm.toFixed(1)}%)`)
            .join(' | ');
          lines.push(`  ✅ ${targetYear}년 확정 분기(${confirmedQCount}개): ${confirmedStr}`);
          // 수학적 하한선 텍스트 — QA checker가 이 패턴을 파싱해 dartFloorAuk로 사용 (정규식 일치 필수)
          const confirmedOpAuk = currency === "KRW" ? confirmedAnnualOp / 1e8 : confirmedAnnualOp;
          const aukUnit = currency === "KRW" ? "억원" : "";
          lines.push(`     → 확정 누적: 매출 ${fmtNum(confirmedAnnualRev, currency)}, 영업이익 ${fmtNum(confirmedAnnualOp, currency)} (OPM ${confirmedOpmAvg?.toFixed(1) ?? '-'}%)`);
          lines.push(`     → [수학적 하한선] 올해E 영업이익 합계 = ${confirmedOpAuk.toFixed(1)}${aukUnit} (확정 분기 합계 — 이 값은 수학적 최솟값. 미확정 분기 영업이익 최소 0 가정시 연간 최솟값임)`);
          if (confirmedYoYGrowth !== null) {
            lines.push(`     → 확정 분기 YoY 매출 성장률: ${(confirmedYoYGrowth * 100).toFixed(1)}% → 미확정 분기 매출 추정에 반영`);
          }
          const anchorNote = confirmedQCount === 1 && annualOpmAnchor !== null
            ? isDeclineTrend
              ? ` (Q1 단독 확정 + 하락 추세 → 추세 65%·연간 앵커 35% 반영, 추세 지속 가정)`
              : ` (Q1 단독 확정 → 연간 앵커 ${annualOpmAnchor.toFixed(1)}% 65% 반영)`
            : annualOpmAnchor !== null ? ` (연간 앵커 ${annualOpmAnchor.toFixed(1)}%)` : '';
          lines.push(`     → OPM 신뢰 가중치 ${(confirmedWeight * 100).toFixed(0)}% → 조정 forward OPM 중심값: ${fwdOpmCenter.toFixed(1)}%${anchorNote}${fwdOpmTurnaroundNote}`);
        } else {
          const anchorNote = annualOpmAnchor !== null ? ` (연간 앵커 ${annualOpmAnchor.toFixed(1)}% 50% 반영)` : '';
          lines.push(`  forward OPM 중심값 (추세 기반): ${fwdOpmCenter.toFixed(1)}%${anchorNote}`);
        }

        // 미확정 분기 배분 (매출 + 영업이익)
        if (remainingQtrs.length > 0) {
          lines.push(`  📊 미확정 분기 추정 (연간 합계 정합, 촉매·업황 가감 후 사용):`);
          for (const q of remainingQtrs) {
            const applied = usedFallback[q] ? DEFAULT_SEASONAL[q] : seasonIdx[q]!;
            lines.push(`    Q${q}E: 매출 ${fmtNum(distRevByQ[q], currency)} / 영업이익 ${fmtNum(distOpByQ[q], currency)} (OPM ${estOpmByQ[q].toFixed(1)}%, 계절조정 ${applied >= 0 ? '+' : ''}${applied.toFixed(1)}%p)`);
          }
        }

        // 연간계 (매출 + 영업이익 모두 표시)
        const revParts = [1, 2, 3, 4].map(q => {
          if (confirmedQNums.has(q)) return `Q${q}✅(${fmtNum(curYearConfirmed.find(d => d.qNum === q)!.rev, currency)})`;
          return `Q${q}E(${fmtNum(distRevByQ[q] ?? 0, currency)})`;
        }).join(' + ');
        const opParts = [1, 2, 3, 4].map(q => {
          if (confirmedQNums.has(q)) return `Q${q}✅(${fmtNum(curYearConfirmed.find(d => d.qNum === q)!.op, currency)})`;
          return `Q${q}E(${fmtNum(distOpByQ[q] ?? 0, currency)})`;
        }).join(' + ');
        lines.push(`  연간 매출계: ${revParts} = ${fmtNum(annualRev, currency)} (범위: ${fmtNum(annualRevLow, currency)}~${fmtNum(annualRevHigh, currency)})`);
        lines.push(`  연간 영업이익계: ${opParts} = ${fmtNum(annualOp, currency)} (범위: ${fmtNum(annualOpLow, currency)}~${fmtNum(annualOpHigh, currency)})`);
        lines.push(`⛔⛔ 위 분기별 배분값을 출발점으로 촉매·업황 요인을 가감하세요. 이 값을 크게 벗어나려면 명시적 근거 필수.`);
        lines.push(`⛔⛔ 분기 합산이 연간 중심값(매출 ${fmtNum(annualRev, currency)}, 영업이익 ${fmtNum(annualOp, currency)}) 근방이 되도록 유지.`);

        // ── 바텀업 vs Yahoo 컨센서스 괴리 ──────────────────────────────────────────
        // earningsTrend 0y 컨센서스와 서버 바텀업을 비교해 상향/하향 압력을 명시적으로 주입
        (() => {
          const trendList: any[] = (result.earningsTrend as any)?.trend ?? [];
          const yr0T = trendList.find((t: any) => t.period === "0y");
          if (!yr0T) return;
          const cnsR = yr0T?.revenueEstimate?.avg?.raw ?? yr0T?.revenueEstimate?.avg ?? null;
          if (cnsR == null || cnsR <= 0 || annualRev <= 0) return;

          const revGap = (annualRev - cnsR) / cnsR;
          const gapSignal = (g: number) =>
            g > 0.15 ? "⬆️ 강한 상향 압력(+15%↑)" :
            g > 0.07 ? "↑ 상향 압력(+7~15%)" :
            g < -0.15 ? "⬇️ 강한 하향 압력(-15%↑)" :
            g < -0.07 ? "↓ 하향 압력(-7~15%)" :
            "→ 컨센서스 부합(7% 이내)";

          lines.push(`\n  📊 [바텀업 vs Yahoo 컨센서스 비교]`);
          lines.push(`     서버 바텀업 연간 매출: ${fmtNum(annualRev, currency)} vs Yahoo 컨센서스: ${fmtNum(cnsR, currency)}`);
          lines.push(`     매출 괴리: ${revGap >= 0 ? '+' : ''}${(revGap * 100).toFixed(1)}% → ${gapSignal(revGap)}`);
          if (Math.abs(revGap) > 0.07) {
            lines.push(`     → AI 가이드: 서버 바텀업(확정 실적 기반)이 컨센서스를 ${revGap > 0 ? '상회' : '하회'}. 연간 매출 추정 시 컨센서스 ${revGap > 0 ? '상향' : '하향'} 조정 검토.`);
          }
        })();

        // ── Q1 비수기 일관성 검토 — 계절적으로 Q1이 약한데 이후 분기가 더 낮을 때 AI에 경고 ──
        // 한국 Q1은 동절기 비수기. 외부 공사 업종(파일링·건설·토목)에서 Q3이 Q1보다 낮으면 반직관적.
        {
          const q1SeasonIdx = seasonIdx[1] ?? DEFAULT_SEASONAL[1]; // Q1 계절지수 (음수 = 비수기)
          const q1IsWeak    = q1SeasonIdx < -0.3; // Q1이 연간 평균 대비 0.3%p 이상 약한 경우
          const q1ConfRev   = curYearConfirmed.find(d => d.qNum === 1)?.rev ?? 0;

          if (q1IsWeak && confirmedQNums.has(1) && q1ConfRev > 0) {
            const weakerQs = remainingQtrs.filter(q => (distRevByQ[q] ?? 0) < q1ConfRev * 0.95);
            if (weakerQs.length > 0) {
              lines.push(`\n  ⚠️ [Q1 비수기 일관성 검토] 아래 분기 매출이 Q1 확정(${fmtNum(q1ConfRev, currency)})보다 낮게 추정됩니다:`);
              lines.push(`     해당 분기: ${weakerQs.map(q => `Q${q}E(${fmtNum(distRevByQ[q] ?? 0, currency)})`).join(', ')}`);
              lines.push(`     원인: Q1 계절지수 ${q1SeasonIdx.toFixed(1)}%p(비수기) 업종에서, 전년도 해당 분기 침체 베이스 때문에 YoY 성장 적용 후에도 Q1보다 낮게 추정될 수 있습니다.`);
              if (q1StructuralGain > 0.10) {
                lines.push(`     구조적 회복 감지: Q1 실제(${fmtNum(q1ConfRev, currency)})가 역사 Q1 평균보다 ${(q1StructuralGain * 100).toFixed(0)}% 상회 → Q1-비율법 ${(q1RatioBlend * 100).toFixed(0)}% 혼합 반영됨.`);
              }
              lines.push(`     → AI 검토: 실외 공사·파일링 등 Q1 동절기 비수기 업종이라면 Q2~Q4가 Q1보다 높아야 정상입니다. 업종 특성 및 수주 일정을 감안해 위 추정치를 상향 조정하세요.`);
              lines.push(`     → 한국 Q3 주의: 7~8월 장마로 외부 공사가 일시 위축될 수 있으나, 연간 기준 Q3 > Q1이 일반적.`);
            }
          }
        }

        // 흑자전환 기업 특별 경고
        if (confirmedIsProfit && annualOp > 0 && annualOpmAnchor !== null && annualOpmAnchor < 0) {
          lines.push(`⛔⛔ [흑자전환기업 추정 필수 원칙] 이 기업은 과거 적자에서 최근 흑자 전환한 기업입니다.`);
          lines.push(`  - 확정 분기 OPM(${confirmedOpmAvg!.toFixed(1)}%)이 흑자인데 연간 추정이 적자가 되면 수학적으로 불가능하거나(확정 분기 합계가 연간 추정보다 크면), 극도로 비관적인 하반기 가정을 전제하는 것입니다.`);
          lines.push(`  - 연간 영업이익 추정은 최소 확정 분기 합계(${fmtNum(confirmedOpSum, currency)}) 이상이어야 합니다. 하반기를 적자로 추정하려면 구체적인 실적 악화 근거(수주 취소, 원가 급등 등)를 반드시 명시하세요.`);
          lines.push(`  - 흑자 전환 추세 반영: 과거 적자는 이미 시장에 알려진 정보이며, 최근 분기 흑자 전환이 핵심 투자 포인트입니다. 연간 추정에서 흑자 전환 추세를 우선 반영하세요.`);
        }
      }
    }
  }

  // Earnings estimates
  const trends: any[] = (result.earningsTrend as any)?.trend ?? [];
  if (trends.length > 0) {
    lines.push("\n[EPS 및 매출 전망 (애널리스트 컨센서스)]");
    lines.push("  ⚠️ 주의: 아래 '매출 성장률(YoY)'은 직전 연도 실제 매출 대비 계산값임. 'EPS 성장률'과 완전히 다른 수치. DCF에는 매출 성장률만 사용할 것.");

    // 직전 실제 연간 매출 — DART(한국 종목) 우선, 없으면 Yahoo timeseries, 없으면 income statement
    const tsRevArr: any[] = tsResult?.annualTotalRevenue ?? [];
    const isArr: any[] = (result as any)?.incomeStatementHistory?.incomeStatementHistory ?? [];
    let priorActualRev: number | null = null;
    // ① DART primary (KRW 종목)
    if (dartNumerics?.latestFYRev != null) {
      priorActualRev = dartNumerics.latestFYRev;
      console.log(`[financial-context] priorActualRev DART 오버라이드 (${resolvedSymbol}): ${priorActualRev} (${dartNumerics.latestFYYear}FY)`);
    // ② Yahoo timeseries fallback
    } else if (tsRevArr.length > 0) {
      const sorted = [...tsRevArr].sort((a, b) => new Date(b.asOfDate ?? 0).getTime() - new Date(a.asOfDate ?? 0).getTime());
      priorActualRev = sorted[0]?.reportedValue?.raw ?? sorted[0]?.reportedValue ?? null;
    // ③ income statement fallback
    } else if (isArr.length > 0) {
      priorActualRev = isArr[0]?.totalRevenue?.raw ?? isArr[0]?.totalRevenue ?? null;
    }

    // 0y / +1y 연간 전망만 추출 (분기 제외)
    const annualTrends = trends.filter(t => t.period === "0y" || t.period === "+1y");
    const yr0Trend = annualTrends.find(t => t.period === "0y");
    const yr1Trend = annualTrends.find(t => t.period === "+1y");
    const yr0RevRaw = yr0Trend?.revenueEstimate?.avg ?? null;
    const yr1RevRaw = yr1Trend?.revenueEstimate?.avg ?? null;

    // ── 서버 주도 매출 성장률 계산 및 60% 캡 적용 ──────────────────────────────
    // Yahoo Finance "earningsEstimate.growth"는 EPS 성장률이며 매출 성장률이 아님.
    // 서버가 직접 절대치 기반으로 매출 성장률을 계산하고 60%로 상한을 강제함.
    const MAX_REV_GROWTH = 0.60; // 60% 상한

    // 0y 매출: priorActualRev 대비 계산
    let yr0RevCapped: number | null = null;
    let yr0GrowthActual: number | null = null;
    let yr0WasCapped = false;
    if (yr0RevRaw != null && priorActualRev != null && priorActualRev > 0) {
      yr0GrowthActual = (yr0RevRaw - priorActualRev) / priorActualRev;
      const yr0GrowthCapped = Math.min(yr0GrowthActual, MAX_REV_GROWTH);
      yr0WasCapped = yr0GrowthActual > MAX_REV_GROWTH;
      yr0RevCapped = yr0WasCapped ? priorActualRev * (1 + yr0GrowthCapped) : yr0RevRaw;
    }

    // +1y 매출: yr0(캡된 값) 또는 priorActualRev 대비 계산
    let yr1RevCapped: number | null = null;
    let yr1GrowthActual: number | null = null;
    let yr1WasCapped = false;
    const yr1Base = yr0RevCapped ?? priorActualRev;
    if (yr1RevRaw != null && yr1Base != null && yr1Base > 0) {
      yr1GrowthActual = (yr1RevRaw - yr1Base) / yr1Base;
      const yr1GrowthCapped = Math.min(yr1GrowthActual, MAX_REV_GROWTH);
      yr1WasCapped = yr1GrowthActual > MAX_REV_GROWTH;
      yr1RevCapped = yr1WasCapped ? yr1Base * (1 + yr1GrowthCapped) : yr1RevRaw;
    }

    // EPS 정보 (참고용)
    for (const t of annualTrends) {
      const period    = t.period ?? "?";
      const epsAvg    = t.earningsEstimate?.avg?.toFixed(2) ?? "-";
      const epsLow    = t.earningsEstimate?.low?.toFixed(2) ?? "-";
      const epsHigh   = t.earningsEstimate?.high?.toFixed(2) ?? "-";
      // EPS 성장률은 표시 안 함 (AI가 매출 성장률로 혼동하는 원인)
      const revCapped = period === "0y" ? yr0RevCapped : yr1RevCapped;
      const revActual = period === "0y" ? yr0RevRaw    : yr1RevRaw;
      const growthActual = period === "0y" ? yr0GrowthActual : yr1GrowthActual;
      const wasCapped    = period === "0y" ? yr0WasCapped    : yr1WasCapped;

      const revDisplay = revCapped ? fmtNum(revCapped, currency) : (revActual ? fmtNum(revActual, currency) : "-");
      // 캡 적용 시 원래 수치를 표시하지 않음 — AI가 인플레이션된 숫자에 앵커링되는 것을 방지
      const growthDisplay = growthActual != null
        ? (wasCapped
            ? `60.0% (서버 상한 적용 — Yahoo 컨센서스 이상 감지로 원본 수치 비표시)`
            : `${(growthActual * 100).toFixed(1)}%`)
        : "-";

      lines.push(`  [${period}] 매출 추정: ${revDisplay} | 매출 성장률(YoY, 서버계산): ${growthDisplay}`);
      lines.push(`         EPS 추정(참고용만): ${epsAvg} (${epsLow}~${epsHigh}) — EPS 수치는 DCF에 사용 불가`);
    }

    // ── 서버 계산 DCF 매출 출발점 (고정값) ──────────────────────────────────────
    // Yahoo earningsTrend 매핑:
    //   "0y" period  = 가장 최근 완료된 회계연도 (= DCF Base Year / Year 0)
    //   "+1y" period = 내년 회계연도 추정 (= DCF Year 1)
    //   "+2y" period = 2년후 추정 (= DCF Year 2 앵커)
    // 따라서: DCF Year 0 = priorActualRev(실제값), DCF Year 1 = yr1RevCapped
    if (priorActualRev != null) {
      lines.push(`\n[🔒 서버 계산 DCF 매출 출발점 — 이 값을 그대로 사용, 변경 금지]`);
      lines.push(`  DCF Year 0 (직전 실제 매출): ${fmtNum(priorActualRev, currency)}`);

      // Year 1 = "+1y" Yahoo 컨센서스 (60% 상한 적용된 값)
      if (yr1RevCapped != null) {
        const g1 = Math.min(yr1GrowthActual ?? 0, MAX_REV_GROWTH);
        lines.push(`  DCF Year 1 매출 (확정값): ${fmtNum(yr1RevCapped, currency)} | 성장률: ${(g1*100).toFixed(1)}%${yr1WasCapped ? " (서버 60% 상한 적용)" : ""}`);
        lines.push(`  ⛔ DCF Year 1 매출이 ${fmtNum(yr1RevCapped, currency)}을 초과하면 즉시 수정 필수`);
      }

      // Year 2 = "+2y" Yahoo 컨센서스 앵커 (가장 흔히 누락되어 AI가 임의 추정하는 구간)
      const yr2Trend = trends.find((t: any) => t.period === "+2y");
      if (yr2Trend && yr1RevCapped != null) {
        const yr2RevRaw: number | null = yr2Trend.revenueEstimate?.avg ?? null;
        if (yr2RevRaw != null) {
          const yr2GrowthActual = (yr2RevRaw - yr1RevCapped) / yr1RevCapped;
          const yr2GrowthCapped = Math.min(yr2GrowthActual, MAX_REV_GROWTH);
          const yr2WasCapped = yr2GrowthActual > MAX_REV_GROWTH;
          const yr2RevCapped = yr2WasCapped ? yr1RevCapped * (1 + yr2GrowthCapped) : yr2RevRaw;
          lines.push(`  DCF Year 2 매출 (컨센서스 앵커): ${fmtNum(yr2RevCapped, currency)} | 성장률: ${(yr2GrowthCapped*100).toFixed(1)}%${yr2WasCapped ? " (60% 상한 적용)" : ""}`);
          lines.push(`  ⚠️ DCF Year 2 매출은 이 컨센서스 앵커 기준으로 설정 — Year1→2 성장 둔화가 이미 반영된 값`);
        }
      } else if (yr2Trend == null && yr1RevCapped != null) {
        lines.push(`  DCF Year 2: 컨센서스 미제공 — Year 1 성장률의 30~50%로 자동 수렴 적용 필수`);
      }

      lines.push(`  ⛔ NOPAT = 영업이익(EBIT) × (1 - 유효세율). 세전 영업이익을 NOPAT으로 쓰는 것은 오류입니다.`);
      lines.push(`  ⛔ 재투자 = 매출증분 ÷ S-to-C + Maintenance CAPEX. 임의 추정 금지.`);
    }

    // ── EPS 추정 수정 방향 (밸류에이션 정확도 선행지표) ──────────────────────────────
    {
      const revisionPeriods = trends.filter((t: any) => ["0y", "+1y"].includes(t.period));
      const hasRevisionData = revisionPeriods.some((t: any) => t.epsTrend || t.epsRevisions);
      if (hasRevisionData) {
        lines.push("\n[📊 EPS 추정 수정 방향 — 밸류에이션 정확도 핵심 선행지표]");
        lines.push("⚠️ 애널리스트 추정이 상향 수정되는 종목은 실제 주가 상승을 선행합니다. 이 데이터를 밸류에이션 가정의 필수 인풋으로 활용하세요.");
        for (const t of revisionPeriods) {
          const periodLabel = t.period === "0y" ? "금년도(0y)" : "내년도(+1y)";
          const epsTrend = t.epsTrend as any;
          const epsRevisions = t.epsRevisions as any;
          if (!epsTrend && !epsRevisions) continue;

          lines.push(`\n  [${periodLabel} EPS 수정 추세]`);

          if (epsTrend) {
            const curr   = epsTrend.current     != null ? Number(epsTrend.current).toFixed(2)     : null;
            const d30    = epsTrend["30daysAgo"] != null ? Number(epsTrend["30daysAgo"]).toFixed(2) : null;
            const d90    = epsTrend["90daysAgo"] != null ? Number(epsTrend["90daysAgo"]).toFixed(2) : null;
            const currN  = epsTrend.current     != null ? Number(epsTrend.current)     : null;
            const d30N   = epsTrend["30daysAgo"] != null ? Number(epsTrend["30daysAgo"]) : null;
            const d90N   = epsTrend["90daysAgo"] != null ? Number(epsTrend["90daysAgo"]) : null;

            let trend1m = "";
            if (currN != null && d30N != null && d30N !== 0) {
              const chg = (currN - d30N) / Math.abs(d30N) * 100;
              trend1m = chg > 0.5 ? `▲${chg.toFixed(1)}% 상향` : chg < -0.5 ? `▼${Math.abs(chg).toFixed(1)}% 하향` : "→ 보합";
            }
            let trend3m = "";
            if (currN != null && d90N != null && d90N !== 0) {
              const chg = (currN - d90N) / Math.abs(d90N) * 100;
              trend3m = chg > 0.5 ? `▲${chg.toFixed(1)}% 상향` : chg < -0.5 ? `▼${Math.abs(chg).toFixed(1)}% 하향` : "→ 보합";
            }
            if (curr || d30 || d90) {
              lines.push(`    현재 EPS 컨센서스: ${curr ?? "-"} | 30일전: ${d30 ?? "-"}${trend1m ? ` (1개월: ${trend1m})` : ""} | 90일전: ${d90 ?? "-"}${trend3m ? ` (3개월: ${trend3m})` : ""}`);
            }
          }

          if (epsRevisions) {
            const up30 = Number(epsRevisions.upLast30days   ?? 0);
            const dn30 = Number(epsRevisions.downLast30days ?? 0);
            const dn90 = Number(epsRevisions.downLast90days ?? 0);
            const up7  = Number(epsRevisions.upLast7days    ?? 0);
            const direction = up30 > dn30 ? "📈 상향 우세" : up30 < dn30 ? "📉 하향 우세" : "→ 중립";
            lines.push(`    최근 30일: 상향 ${up30}건 / 하향 ${dn30}건 → ${direction} | 7일내 상향: ${up7}건 | 90일내 하향 누계: ${dn90}건`);
            if (up30 >= dn30 * 2 && up30 >= 3) {
              lines.push(`    ✅ 강한 상향 수정 모멘텀 — DCF 성장률 가정을 보수적으로 압축할 필요 없음`);
            } else if (dn30 >= up30 * 2 && dn30 >= 3) {
              lines.push(`    ⚠️ 강한 하향 수정 모멘텀 — DCF Year 2~3 성장률 가정을 컨센서스 대비 10~15% 추가 하향 보수화 필요`);
            }
          }
        }
      }
    }

    // ── 실적 서프라이즈 이력 (컨센서스 신뢰도 검증) ────────────────────────────────
    {
      const earningsHistory = (result as any).earningsHistory;
      if (earningsHistory?.history?.length) {
        lines.push("\n[📋 실적 서프라이즈 이력 — 컨센서스 신뢰도 & DCF 가정 보정 근거]");
        lines.push("⚠️ Beat 패턴이 강한 기업은 컨센서스 EPS를 그대로 써도 보수적. Miss 패턴이 강하면 DCF 성장률을 추가 하향해야 합니다.");
        const history = (earningsHistory.history as any[]).slice(0, 8);
        let beatCount = 0, missCount = 0;
        for (const h of history) {
          const qDate = h.quarter ? new Date(h.quarter * 1000).toISOString().slice(0, 7) : "?";
          const actual   = h.epsActual   != null ? Number(h.epsActual).toFixed(2)   : "-";
          const estimate = h.epsEstimate != null ? Number(h.epsEstimate).toFixed(2) : "-";
          const surprisePct = h.surprisePercent != null ? Number(h.surprisePercent) : null;
          const surpriseStr = surprisePct != null ? `${surprisePct > 0 ? "+" : ""}${surprisePct.toFixed(1)}%` : "-";
          const icon = surprisePct != null ? (surprisePct > 1 ? "✅" : surprisePct < -1 ? "❌" : "→") : "";
          if (surprisePct != null) { surprisePct > 1 ? beatCount++ : surprisePct < -1 ? missCount++ : null; }
          lines.push(`  ${qDate}: EPS 실제 ${actual} / 추정 ${estimate} → 서프라이즈 ${surpriseStr} ${icon}`);
        }
        const total = beatCount + missCount;
        if (total > 0) {
          const beatRate = (beatCount / total * 100).toFixed(0);
          const quality =
            beatCount >= total * 0.75 ? "🟢 높음 — 컨센서스 신뢰도 우수, 보수적 하향 불필요"
            : beatCount >= total * 0.5 ? "🟡 보통 — 컨센서스를 그대로 사용하되 Bear 가중치 조금 확대"
            : "🔴 낮음 — 컨센서스 과낙관, DCF Year 2~3 성장률을 10~15% 추가 하향 보수화 필수";
          lines.push(`  Beat율: ${beatRate}% (${beatCount}/${total}건) | 컨센서스 신뢰도: ${quality}`);
          // 서프라이즈 패턴 → 실적 추정 구체 보정 지침
          const beatRateNum = beatCount / total;
          if (beatRateNum >= 0.75) {
            lines.push(`  📌 추정 보정 지침: Beat 패턴 강함 → 컨센서스 EPS Year1 +5~8%, Year2 +8~12% 상향 조정 후 추정 시작 권장.`);
            lines.push(`     매출도 컨센서스 그대로 사용 시 실제보다 보수적일 가능성 높음. 상단 시나리오 가중치 확대.`);
          } else if (beatRateNum < 0.4) {
            lines.push(`  📌 추정 보정 지침: Miss 패턴 — 컨센서스 EPS Year1 −10%, Year2 −15% 추가 하향 후 추정 시작 필수.`);
            lines.push(`     Bear 시나리오 가중치 최소 35%로 설정. 매출 성장률도 컨센서스 대비 보수적 적용.`);
          }
        }
      }
    }

    // ── 애널리스트 투자의견 추세 ──────────────────────────────────────────────────
    {
      const recTrend = (result as any).recommendationTrend;
      if (recTrend?.trend?.length) {
        const rts = (recTrend.trend as any[]).slice(0, 4);
        lines.push("\n[📊 애널리스트 투자의견 추세 — 시장 컨센서스 방향]");
        for (const rt of rts) {
          const label = rt.period === "0m" ? "현재월" : rt.period === "-1m" ? "1개월전" : rt.period === "-2m" ? "2개월전" : "3개월전";
          const sb = Number(rt.strongBuy ?? 0);
          const b  = Number(rt.buy       ?? 0);
          const hv = Number(rt.hold      ?? 0);
          const s  = Number(rt.sell      ?? 0);
          const ss = Number(rt.strongSell ?? 0);
          const tot = sb + b + hv + s + ss;
          const bullPct = tot > 0 ? `${((sb + b) / tot * 100).toFixed(0)}%` : "-";
          lines.push(`  ${label}: 강매수 ${sb} / 매수 ${b} / 중립 ${hv} / 매도 ${s} / 강매도 ${ss} | 매수비중 ${bullPct}`);
        }
        if (rts.length >= 2) {
          const cur = rts[0];  const old = rts[rts.length - 1];
          const curBull = Number(cur.strongBuy ?? 0) + Number(cur.buy ?? 0);
          const oldBull = Number(old.strongBuy ?? 0) + Number(old.buy ?? 0);
          if (curBull > oldBull) lines.push(`  → 매수 의견 증가 추세 (긍정적 신호 — 밸류에이션 상방 바이어스 정당화)`);
          else if (curBull < oldBull) lines.push(`  → 매수 의견 감소 추세 (주의 신호 — 목표주가 달성 후 차익실현 가능성)`);
          else lines.push(`  → 투자의견 안정 유지`);
        }
      }
    }
  }

  // Supplement with Naver Finance for Korean stocks
  const koreanCode = resolvedSymbol.match(/^(\d{6})\.(KS|KQ)$/)?.[1];
  if (koreanCode) {
    const { context: naverData, naverSharesCalc: naverShares } = await fetchNaverFinanceData(koreanCode);
    if (naverData) lines.push(naverData);
    if (naverShares != null) naverSharesCalc = naverShares; // fetchFinancialContext 스코프로 전달
  }

  // ── 서버 계산: 발행주식수·BPS 검증 (Naver fetch 이후 — naverSharesCalc 사용 가능) ────
  {
    const latestEqYear = Object.keys(eqMap).sort((a, b) => Number(b) - Number(a))[0];
    const latestEq = latestEqYear ? eqMap[latestEqYear] : null;
    const sharesForBps: number | null = naverSharesCalc ?? (ks?.sharesOutstanding ?? null);

    if (sharesForBps != null) {
      lines.push("\n[⭐ 서버 계산 발행주식수·BPS 검증 — 밸류에이션 주당가치 계산에 이 수치 사용]");
      const sharesSource = naverSharesCalc ? "KRX/Naver 기준" : "Yahoo Finance (KRX 미확인)";
      lines.push(`발행주식수 확정: ${sharesForBps.toLocaleString("ko-KR")}주 (출처: ${sharesSource})`);
      if (naverSharesCalc && ks?.sharesOutstanding && Math.abs(naverSharesCalc - ks.sharesOutstanding) / ks.sharesOutstanding > 0.02) {
        lines.push(`  ⚠️ Yahoo 주식수 ${ks.sharesOutstanding.toLocaleString("ko-KR")}주 vs KRX 기준 ${naverSharesCalc.toLocaleString("ko-KR")}주 불일치 → KRX 기준 우선`);
      }
      if (latestEq != null) {
        const bpsCalc = latestEq / sharesForBps;
        const bpsUnit = currency === "USD" ? `$` : `원`;
        lines.push(`BPS 서버계산 (${latestEqYear}): ${fmtNum(latestEq, currency)} ÷ ${sharesForBps.toLocaleString("ko-KR")}주 = **${bpsUnit}${bpsCalc.toFixed(currency === "USD" ? 2 : 0)}/${bpsUnit === "$" ? "주" : "주"}**`);
        if (ks?.bookValue != null) {
          const diff = Math.abs(bpsCalc - ks.bookValue);
          if (diff / ks.bookValue > 0.02) {
            lines.push(`  ⚠️ Yahoo BPS ${bpsUnit}${ks.bookValue.toFixed(currency === "USD" ? 2 : 0)} vs 서버계산 BPS ${bpsUnit}${bpsCalc.toFixed(currency === "USD" ? 2 : 0)} 불일치 (${(diff / ks.bookValue * 100).toFixed(1)}% 차이) → 서버계산값 우선`);
          }
        }
      }
    }
  }

  // ── 서버 계산 주가 현실성 검증 ────────────────────────────────────────────────
  // 현재 주가 대비 상대적 허용 범위를 AI에 제공해 DCF 극단값 방지
  {
    const sharesForSanity: number | null = naverSharesCalc ?? (ks?.sharesOutstanding ?? null);
    const currentPrice: number | null = sd?.regularMarketPrice ?? null;
    const marketCap = sd?.marketCap ?? ks?.marketCap ?? null;
    const latestEqYear2 = Object.keys(eqMap).sort((a, b) => Number(b) - Number(a))[0];
    const latestEq2 = latestEqYear2 ? eqMap[latestEqYear2] : null;

    if (sharesForSanity != null && currentPrice != null && sharesForSanity > 0 && currentPrice > 0) {
      const priceFloor = currentPrice * 0.3;   // 현재가 대비 -70% 하단
      const priceCeil  = currentPrice * 3.5;   // 현재가 대비 +250% 상단

      lines.push(`\n[🔍 서버 계산 주가 현실성 검증 — DCF 결과 비교용]`);
      lines.push(`  현재 주가: ${fmtNum(currentPrice, currency)} | 시가총액: ${marketCap ? fmtNum(marketCap, currency) : "-"}`);
      if (latestEq2 != null && latestEq2 > 0) {
        const bpsNow = latestEq2 / sharesForSanity;
        const impliedPbNow = currentPrice / bpsNow;
        lines.push(`  현재 Implied P/B: ${impliedPbNow.toFixed(2)}x (BPS: ${fmtNum(bpsNow, currency)})`);
      }
      lines.push(`  ──────────────────────────────────────────────────────`);
      lines.push(`  DCF 허용 목표가 범위: ${fmtNum(priceFloor, currency)} ~ ${fmtNum(priceCeil, currency)}`);
      lines.push(`    (현재가 대비 −70% ~ +250% 범위 — 성숙 대형주 기준)`);
      lines.push(`  ⛔ DCF 결과가 위 허용 범위를 초과하면 반드시 다음을 재검토:`);
      lines.push(`    1. WACC ≥ 10% (성숙 대형주 기준) 인지 확인`);
      lines.push(`    2. OPM이 업종 역대 최고값을 초과하지 않는지 확인`);
      lines.push(`    3. FCFF Margin이 반도체 상한(Year1~5: 15%, Year6~10: 12%) 이내인지 확인`);
      lines.push(`    4. Year 2 성장률이 Year 1 성장률의 30~50% 수준으로 감소했는지 확인`);
      lines.push(`    5. 재투자 앵커 하한값(Maintenance Capex) 이상으로 재투자가 반영됐는지 확인`);
    }
  }

  // ── 시장 내재 멀티플 산출 — 목표주가 현실성 앵커 ────────────────────────────
  // 현재 시장이 이 기업을 몇 배수로 평가 중인지 AI에게 명시 → 극단적 멀티플 축소 방지
  {
    const impliedEV: number | null = ks?.enterpriseValue ?? null;
    const impliedRev: number | null = fd?.totalRevenue ?? null;
    const impliedMcap: number | null = sd?.marketCap ?? ks?.marketCap ?? null;
    const impliedCurPrice: number | null = sd?.regularMarketPrice ?? fd?.currentPrice ?? null;
    const impliedEVSales: number | null = ks?.enterpriseToRevenue != null
      ? ks.enterpriseToRevenue
      : (impliedEV != null && impliedRev != null && impliedRev > 0 ? impliedEV / impliedRev : null);
    const impliedEVEBITDA: number | null = ks?.enterpriseToEbitda ?? null;
    const impliedPS: number | null = (impliedMcap != null && impliedRev != null && impliedRev > 0)
      ? impliedMcap / impliedRev : null;
    const impliedPB: number | null = ks?.priceToBook ?? null;
    const impliedFCF: number | null = fd?.freeCashflow ?? null;
    const impliedRevGrowth: number | null = fd?.revenueGrowth ?? null;

    if (impliedCurPrice != null && (impliedEVSales != null || impliedPS != null || impliedPB != null)) {
      lines.push(`\n[📐 서버 계산 시장 내재 멀티플 — 목표주가 현실성 필수 확인]`);
      lines.push(`  ⚠️ 아래는 현재 주가 기준으로 시장이 이 기업을 평가 중인 배수입니다.`);
      lines.push(`  목표주가 산출 시 아래 배수가 50% 이상 축소되면 반드시 그 근거를 명시하세요.`);
      if (impliedEVSales != null) lines.push(`  현재 EV/Sales: ${impliedEVSales.toFixed(1)}x`);
      if (impliedEVEBITDA != null && impliedEVEBITDA > 0 && impliedEVEBITDA < 500) lines.push(`  현재 EV/EBITDA: ${impliedEVEBITDA.toFixed(1)}x`);
      if (impliedPS != null) lines.push(`  현재 P/S: ${impliedPS.toFixed(1)}x`);
      if (impliedPB != null) lines.push(`  현재 P/B: ${impliedPB.toFixed(2)}x`);
      if (impliedFCF != null && impliedFCF < 0) lines.push(`  FCF 상태: 음수 (${fmtNum(impliedFCF, currency)}) — DCF·DDM 부적합, EV/Sales 또는 rNPV 우선 고려`);
      if (impliedRevGrowth != null && impliedRevGrowth > 0.3) {
        lines.push(`  매출 성장률(YoY): ${pct(impliedRevGrowth)} — 고성장 기업. PBR 단독 사용 부적합.`);
      }
      if (impliedEVSales != null && impliedEVSales > 10) {
        lines.push(`  ⛔ EV/Sales ${impliedEVSales.toFixed(1)}x 고배수 기업 — 목표가에 EV/Sales 10x 미만 배수를 쓸 경우 반드시 멀티플 축소 근거 필요.`);
      }
      // 모델 선택 가이드: FCF 음수 + 고성장 시 PBR 경고
      if (impliedFCF != null && impliedFCF < 0 && impliedRevGrowth != null && impliedRevGrowth > 0.2) {
        lines.push(`  ⛔ FCF 음수 + 고성장 기업 — PBR 가중 30% 이상 적용 금지. EV/Sales 또는 rNPV(바이오) 기반 모델만 사용하세요.`);
      }
    }
  }

  // 섹터 벤치마크 멀티플 (밸류에이션 단계에서 피어 비교 시 사용)
  lines.push(KOREAN_SECTOR_MULTIPLES);

  const text = lines.join("\n");
  cache.set(fcCacheKey, text, TTL.YAHOO_FINANCIAL);

  // ── ticker_metric_cache 업데이트 (PBR/PER/ROE/OPM) ───────────────────────────
  // fire-and-forget: 실패해도 분석 진행
  try {
    const pbr      = (ks as any)?.priceToBook ?? null;
    const perTrail = (sd as any)?.trailingPE ?? null;
    const perFwd   = (sd as any)?.forwardPE ?? null;
    const evEbitda = (ks as any)?.enterpriseToEbitda ?? null;
    const roe      = (ks as any)?.returnOnEquity ?? null;
    const opMargin = (fd as any)?.operatingMargins ?? null;
    const mcap     = (sd as any)?.marketCap ?? (ks as any)?.marketCap ?? null;
    const bvShare  = (ks as any)?.bookValue ?? null;
    const shares   = (sd as any)?.sharesOutstanding ?? null;
    const bookVal  = (bvShare != null && shares != null) ? Math.round(bvShare * shares) : null;

    if (pbr != null || perTrail != null || roe != null || opMargin != null) {
      rawQuery(
        `INSERT INTO ticker_metric_cache
           (ticker, pbr, per_trailing, per_fwd, ev_ebitda, roe, operating_margin, market_cap, book_value, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (ticker) DO UPDATE
           SET pbr = EXCLUDED.pbr,
               per_trailing = EXCLUDED.per_trailing,
               per_fwd = EXCLUDED.per_fwd,
               ev_ebitda = EXCLUDED.ev_ebitda,
               roe = EXCLUDED.roe,
               operating_margin = EXCLUDED.operating_margin,
               market_cap = EXCLUDED.market_cap,
               book_value = EXCLUDED.book_value,
               updated_at = NOW()`,
        // 캐시 키는 표준형. resolvedSymbol은 야후용(005930.KS)이라 그대로 쓰면
        // 005930으로 조회하는 쪽과 어긋나 캐시가 영원히 미적중이 된다.
        [normalizeTicker(resolvedSymbol), pbr, perTrail, perFwd, evEbitda, roe, opMargin,
         mcap != null ? Math.round(mcap) : null, bookVal]
      ).catch(() => {});
    }
  } catch { /* ignore */ }

  // DB 영속 캐시 저장 (8시간 TTL) — fire-and-forget
  dbCacheSet(dbFcKey, text, 8 * 3600).catch(() => {});

  return text;
}

// ─── Company news fetching (Google News RSS) ─────────────────────────────────

async function fetchCompanyNews(companyName: string): Promise<string> {
  const newsCacheKey = `news:${companyName}`;
  const newsCached = cache.get<string>(newsCacheKey);
  if (newsCached) {
    return newsCached;
  }
  try {
    const query = encodeURIComponent(companyName);
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const xml = await res.text();

    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    if (items.length === 0) return "";

    const lines: string[] = [
      `\n=== 최신 뉴스/공시 (${companyName}, 기준: ${new Date().toISOString().split("T")[0]}) ===`,
      "※ 아래 뉴스 이슈들을 분석에 직접 반영하세요. 특히 주가에 영향을 미치는 핵심 이벤트에 주목하세요.\n",
    ];

    for (const item of items.slice(0, 15)) {
      const cdataTitle = item.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/)?.[1];
      const plainTitle = item.match(/<title>([^<]+)<\/title>/)?.[1];
      const title = (cdataTitle ?? plainTitle ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      const pubDate = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1] ?? "";
      const source = item.match(/<source[^>]*>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/source>/)?.[1] ?? "";
      if (!title) continue;
      const dateStr = pubDate
        ? new Date(pubDate).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
        : "";
      lines.push(`[${dateStr}] ${title}${source ? ` (${source})` : ""}`);
    }

    console.log(`[news] Fetched ${items.length} news items for ${companyName}`);
    const newsText = lines.join("\n");
    cache.set(newsCacheKey, newsText, 10 * 60 * 1000); // 10분 캐시
    return newsText;
  } catch (err) {
    console.error("[news] Failed:", err);
    return "";
  }
}

export { yahooFinance, tryQuoteSummary, fetchTickerInfo, naverFmt, NAVER_HEADERS, fetchNaverFinanceData, toYear, fmtNum, pct, opm, computeHistoricalBeta, fetchFinancialContext, fetchCompanyNews };
