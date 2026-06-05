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
  type AgentKey,
} from "../lib/ai-agents.js";
import { getCalibrationContext, classifySector } from "./performance.js";
import { triggerModelReview } from "./model-insights.js";
import { runQACheck } from "../lib/qa-checker.js";
import { getDartHistoricalContext, fetchAndStoreDartQuarterly } from "../lib/dart-store.js";
import { fetchDartBusinessContent, fetchDartCompetitorSection } from "../lib/dart-business-content.js";
import { fetchSECEdgarContent } from "../lib/sec-edgar-content.js";
import { fetchKOSISData, buildKOSISContext } from "../lib/kosis-client.js";
import { buildSOTPSubsidiaryContext, hasSOTPSubsidiaryData } from "../lib/sotp-subsidiary-context.js";
import { getLatestMarketRegime } from "../lib/market-regime-updater.js";
import { getSectorLearningNote } from "../lib/sector-learning.js";

const router: IRouter = Router();
const yahooFinance = new YahooFinance();

// ─── 한국 업종별 밸류에이션 벤치마크 (KRX 기반, 2024~2025 평균) ──────────────────
// 출처: KRX 업종 시가총액·멀티플 통계, Damodaran emerging market data 참고
const KOREAN_SECTOR_MULTIPLES = `
=== 한국 코스피·코스닥 업종별 밸류에이션 벤치마크 (피어 멀티플 상대가치 참조용) ===
※ 아래 범위는 KRX 업종 평균 기준입니다. 피어 멀티플 산출 시 이 기준과 비교하세요.

| 업종 | P/E (배) | P/B (배) | EV/EBITDA (배) | EV/Sales (배) | Unlevered β | 비고 |
|------|---------|---------|--------------|-------------|------------|------|
| 반도체·메모리 | 18~35 | 1.5~3.0 | 8~15 | 1.5~3.5 | 1.2~1.5 | 업황 사이클 크게 반영 |
| 반도체장비·소재 | 20~40 | 2.0~4.0 | 12~20 | 2.0~4.0 | 1.1~1.4 | 성장 프리미엄 반영 |
| IT·소프트웨어·인터넷 | 25~45 | 2.5~5.0 | 15~30 | 2.5~6.0 | 1.0~1.3 | 플랫폼은 EV/Sales 선호 |
| 2차전지·배터리 | 20~40 | 2.0~4.5 | 10~20 | 1.5~4.0 | 1.2~1.6 | 수주잔고·증설 모멘텀 |
| 바이오·제약(흑자) | 20~50 | 2.0~5.0 | 10~20 | 3.0~8.0 | 1.3~1.7 | DCF 가능 |
| 바이오·제약(적자/파이프라인) | N/A | 2.0~6.0 | N/A | 4.0~12.0 | 1.4~1.8 | rNPV 필수, EV/Sales 보조 |
| 의료기기·진단 | 20~40 | 2.0~4.5 | 12~22 | 2.0~5.0 | 1.1~1.4 | |
| 자동차·완성차 | 6~12 | 0.5~1.0 | 3~6 | 0.3~0.6 | 0.9~1.2 | PBR 0.7 이하 → 저평가 신호 |
| 자동차부품·타이어 | 7~14 | 0.6~1.2 | 4~8 | 0.4~0.8 | 0.9~1.2 | |
| 화학·정유·소재 | 8~16 | 0.7~1.4 | 5~9 | 0.3~0.7 | 1.0~1.3 | |
| 철강·비철금속 | 7~13 | 0.5~1.0 | 4~8 | 0.4~0.8 | 0.9~1.2 | |
| 건설·인프라 | 6~11 | 0.5~0.9 | 4~8 | 0.3~0.6 | 0.9~1.2 | |
| 미디어·엔터·게임 | 18~35 | 2.0~4.0 | 10~18 | 1.5~4.0 | 1.0~1.4 | |
| 소비재·유통·음식료 | 12~20 | 1.0~2.0 | 7~13 | 0.5~1.2 | 0.7~1.0 | |
| 에너지·유틸리티 | 9~15 | 0.6~1.1 | 6~10 | 0.8~1.5 | 0.5~0.8 | |
| 금융·보험·증권 | 6~10 | 0.4~0.9 | N/A | N/A | 0.5~0.8 | PBR·ROE 위주 평가 |
| 조선·기계·방산 | 10~25 | 1.0~2.5 | 6~14 | 0.5~1.5 | 0.9~1.2 | 수주잔고 모멘텀 |
| 통신 | 8~14 | 1.0~1.5 | 5~8 | 1.0~2.0 | 0.6~0.8 | 배당수익률 중시 |

WACC 공통 가정 (한국 주식):
- 무위험수익률(Rf): 한국 국고채 10년물 2.8~3.2% (미국 국채 사용 절대 금지)
- 시장 ERP(한국): 5.5~6.5% (글로벌 평균 적용 금지)
- Relevered β = Unlevered β × (1 + (1-세율) × D/E)
- 법인세율: 25~27.5% (과세표준 200억 초과 기업 기준)
`;


// ─── KRX 실데이터 + KIS 실시간 보강 기반 업종 PBR 조회 ──────────────────────
async function getKRXSectorPeerContext(krxCode: string): Promise<string | null> {
  try {
    // 1. 해당 종목의 업종 조회
    const stockRes = await pool.query<{ sector: string; market: string; name: string }>(
      `SELECT sector, market, name FROM krx_peer_data WHERE code = $1 ORDER BY snapshot_date DESC LIMIT 1`,
      [krxCode]
    );
    if (!stockRes.rows.length) return null;

    const { sector, market, name } = stockRes.rows[0];

    // 2. 같은 업종 피어 전체 조회 (최신 스냅샷)
    const peerRes = await pool.query<{
      code: string; name: string; pbr: string | null; per: string | null;
      bps: string | null; mcap: string | null;
    }>(
      `SELECT code, name, pbr, per, bps, mcap
       FROM krx_peer_data
       WHERE sector = $1 AND market = $2
         AND snapshot_date = (SELECT MAX(snapshot_date) FROM krx_peer_data)
         AND pbr IS NOT NULL AND pbr > 0
       ORDER BY mcap DESC NULLS LAST
       LIMIT 30`,
      [sector, market]
    );

    if (!peerRes.rows.length) return null;

    const peerCodes = peerRes.rows.map(r => r.code);

    // 3. KIS 실시간 데이터 병렬 조회 (상위 15개 + 분석 대상 종목)
    const allCodes = [...new Set([krxCode, ...peerCodes.slice(0, 14)])];
    const kisData = await fetchKISStockQuotes(allCodes).catch(() => new Map());

    // 4. 피어 데이터 통합 (KIS 실시간 우선, 없으면 KRX 정적 fallback)
    // ⚠️ 단위 통일: mcapEok(억원) 기준
    //   - KIS: kis.mcap 이미 억원
    //   - KRX: r.mcap 는 원 단위 → ÷ 1e8 → 억원
    const peers = peerRes.rows.map(r => {
      const kis = kisData.get(r.code);

      // 시가총액(억원) — KIS 실시간 → KRX 원→억원 → price×shares 역산 순
      let mcapEok: number | null = null;
      if (kis?.mcap != null && kis.mcap > 0) {
        mcapEok = kis.mcap;                                   // KIS: 이미 억원
      } else if (r.mcap != null) {
        mcapEok = parseFloat(r.mcap) / 1e8;                  // KRX: 원 → 억원
      }
      // KIS price × sharesOutstanding 역산 fallback
      if ((mcapEok == null || mcapEok < 10) && kis?.price && kis.sharesOutstanding) {
        mcapEok = Math.round((kis.price * kis.sharesOutstanding) / 1e8);
      }

      return {
        code: r.code,
        name: r.name,
        pbr: kis?.pbr ?? (r.pbr ? parseFloat(r.pbr) : null),
        per: kis?.per ?? (r.per ? parseFloat(r.per) : null),
        bps: kis?.bps ?? (r.bps ? parseFloat(r.bps) : null),
        mcapEok,                                              // 억원 단위로 통일
        price: kis?.price ?? null,
        roe: kis?.roe ?? null,
        kisEnriched: !!kis,
      };
    });

    // 5. 분포 통계 (KIS 보강된 PBR 기준)
    const validPBR = peers.filter(p => p.pbr && p.pbr > 0 && p.pbr < 30).map(p => p.pbr!);
    const sorted = [...validPBR].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const avg    = validPBR.reduce((s, v) => s + v, 0) / validPBR.length;
    const q1     = sorted[Math.floor(sorted.length * 0.25)];
    const q3     = sorted[Math.floor(sorted.length * 0.75)];

    const validPER = peers.filter(p => p.per && p.per > 0 && p.per < 200).map(p => p.per!);
    const perSorted = [...validPER].sort((a, b) => a - b);
    const perMedian = validPER.length ? perSorted[Math.floor(perSorted.length / 2)] : null;

    const kisEnrichedCount = peers.filter(p => p.kisEnriched).length;
    const dataSource = kisEnrichedCount > 0
      ? `KIS 실시간(${kisEnrichedCount}개) + KRX 스냅샷 혼합`
      : "KRX 스냅샷 (KRX 기준)";

    const peerTable = peers
      .slice(0, 15)
      .map(p => {
        const priceStr  = p.price    ? `${p.price.toLocaleString("ko-KR")}원` : "—";
        const roeStr    = p.roe !== null ? `${p.roe.toFixed(1)}%` : "—";
        // 시가총액: 1조 이상이면 조원, 미만이면 억원으로 표시
        const mcapStr   = p.mcapEok != null
          ? p.mcapEok >= 10000
            ? `${(p.mcapEok / 10000).toFixed(2)}조원`
            : `${Math.round(p.mcapEok).toLocaleString("ko-KR")}억원`
          : "—";
        return `| ${p.code} | ${p.name} | ${mcapStr} | ${p.pbr?.toFixed(2) ?? "—"} | ${p.per?.toFixed(1) ?? "—"} | ${roeStr} | ${priceStr} |`;
      })
      .join("\n");

    // 분석 대상 종목 KIS 실시간 지표
    const targetKIS = kisData.get(krxCode);
    const targetSection = targetKIS ? `
[분석 대상 종목 — KIS 실시간]
| 지표 | 값 |
|------|-----|
| 현재가 | ${targetKIS.price.toLocaleString("ko-KR")}원 |
| PBR(실시간) | ${targetKIS.pbr !== null ? targetKIS.pbr.toFixed(2) + "배" : "N/A"} |
| PER(실시간) | ${targetKIS.per !== null ? targetKIS.per.toFixed(1) + "배" : "N/A"} |
| EPS | ${targetKIS.eps !== null ? targetKIS.eps.toLocaleString("ko-KR") + "원" : "N/A"} |
| BPS | ${targetKIS.bps !== null ? targetKIS.bps.toLocaleString("ko-KR") + "원" : "N/A"} |
| ROE | ${targetKIS.roe !== null ? targetKIS.roe.toFixed(1) + "%" : "N/A"} |
| 52주 최고 | ${targetKIS.w52High !== null ? targetKIS.w52High.toLocaleString("ko-KR") + "원" : "N/A"} |
| 52주 최저 | ${targetKIS.w52Low !== null ? targetKIS.w52Low.toLocaleString("ko-KR") + "원" : "N/A"} |
` : "";

    return `
=== KRX + KIS 실시간 업종 피어 벤치마크 ===
분석 대상: ${name} (${krxCode}) | 업종: ${sector} | 시장: ${market}
데이터 출처: ${dataSource}
피어 모수: ${validPBR.length}개 종목 (PBR 유효 기준)
${targetSection}
[업종 PBR 분포]
- 중앙값(Median):  ${median.toFixed(2)}x
- 평균(Average):   ${avg.toFixed(2)}x
- 1Q~3Q:           ${q1.toFixed(2)}x ~ ${q3.toFixed(2)}x
- PER 중앙값:      ${perMedian ? perMedian.toFixed(1) + "x" : "N/A (적자 기업 다수)"}

[시가총액 상위 피어 15개 — KIS 실시간 보강]
⚠️ 아래 시가총액은 KIS 실시간 데이터 기반 정확값입니다. 피어 그룹 선정 표 작성 시 이 값을 그대로 인용하세요.
| 종목코드 | 종목명 | 시가총액(KIS실시간) | PBR(배) | PER(배) | ROE | 현재가 |
|--------|--------|-----------------|--------|--------|-----|-------|
${peerTable}

※ KIS 실시간 데이터로 보강된 피어 멀티플입니다. 상대가치(PBR/PER) 산출 시 위 중앙값을 기준 배수로 사용하고,
   분석 대상 기업의 ROE·성장률·수익성이 업종 평균 대비 우위인 경우 프리미엄을 정당화하세요.
   무근거 프리미엄 적용은 금지됩니다.
`;
  } catch (err) {
    console.error("[krx-peer] getKRXSectorPeerContext failed:", err);
    return null;
  }
}

// DART 사업보고서 "경쟁 현황"에서 경쟁사명 추출
function extractCompanyNamesFromDart(text: string): string[] {
  const names: string[] = [];
  // 패턴 1: XXX(주) 또는 XXX㈜
  const p1 = /([가-힣A-Za-z0-9·\-]+(?:\s[가-힣A-Za-z0-9·\-]+){0,3})\s*(?:\(주\)|㈜)/g;
  let m: RegExpExecArray | null;
  while ((m = p1.exec(text)) !== null) names.push(m[1].trim());
  // 패턴 2: (주)XXX 또는 ㈜XXX
  const p2 = /(?:\(주\)|㈜)\s*([가-힣A-Za-z0-9·\-]+(?:\s[가-힣A-Za-z0-9·\-]+){0,3})/g;
  while ((m = p2.exec(text)) !== null) names.push(m[1].trim());
  // 패턴 3: 주식회사 XXX
  const p3 = /주식회사\s+([가-힣A-Za-z0-9·\-]+(?:\s[가-힣A-Za-z0-9·\-]+){0,3})/g;
  while ((m = p3.exec(text)) !== null) names.push(m[1].trim());
  return [...new Set(names)].filter(n => n.length >= 2 && n.length <= 20);
}

// DART 사업보고서 명시 경쟁사 KIS 실시간 피어 컨텍스트
async function getDartCompetitorPeerContext(krxCode: string): Promise<string | null> {
  try {
    // 1. DART 경쟁사 섹션 원문 가져오기
    const dartText = await fetchDartCompetitorSection(krxCode);
    if (!dartText || dartText.length < 10) return null;

    // 2. 회사명 추출
    const companyNames = extractCompanyNamesFromDart(dartText);
    if (companyNames.length === 0) {
      console.log(`[dart-peer] ${krxCode}: 회사명 패턴 추출 실패 — 원문 첨부로 대체`);
      return `\n=== 📄 DART 사업보고서 경쟁사 현황 (참고) ===\n${dartText.slice(0, 600)}\n`;
    }

    // 3. KRX DB 퍼지 매칭 (각 이름의 핵심 키워드로 검색)
    const matchedCodes = new Map<string, string>(); // code → name
    await Promise.allSettled(
      companyNames.slice(0, 12).map(async (rawName) => {
        const keyword = rawName.replace(/[\(\)（）\s]/g, "").slice(0, 8);
        const res = await pool.query<{ code: string; name: string }>(
          `SELECT code, name FROM krx_peer_data
           WHERE name ILIKE $1
             AND snapshot_date = (SELECT MAX(snapshot_date) FROM krx_peer_data)
           ORDER BY mcap DESC NULLS LAST
           LIMIT 1`,
          [`%${keyword}%`]
        );
        if (res.rows.length > 0 && res.rows[0].code !== krxCode) {
          matchedCodes.set(res.rows[0].code, res.rows[0].name);
        }
      })
    );

    if (matchedCodes.size === 0) {
      // 종목코드 매칭 실패 → 원문만 첨부
      return `\n=== 📄 DART 사업보고서 경쟁사 현황 ===\n${dartText.slice(0, 800)}\n※ 상대가치평가 시 위 경쟁사들을 기준 피어로 활용하세요.\n`;
    }

    // 4. KIS 실시간 데이터 조회
    const codes = [krxCode, ...matchedCodes.keys()];
    const kisData = await fetchKISStockQuotes(codes).catch(() => new Map<string, any>());

    // 5. 피어 테이블 생성
    const peerRows = [...matchedCodes.entries()].map(([code, name]) => {
      const kis = kisData.get(code);
      // 시가총액: KIS mcap(억원) → 표시
      const mcapEok = kis?.mcap != null && kis.mcap > 0 ? kis.mcap : null;
      const mcapStr = mcapEok != null
        ? mcapEok >= 10000 ? `${(mcapEok / 10000).toFixed(2)}조원` : `${Math.round(mcapEok).toLocaleString("ko-KR")}억원`
        : "—";
      return `| ${code} | ${name} | ${mcapStr} | ${kis?.pbr?.toFixed(2) ?? "—"} | ${kis?.per?.toFixed(1) ?? "—"} | ${kis?.roe !== null && kis?.roe !== undefined ? kis.roe.toFixed(1) + "%" : "—"} | ${kis?.price ? kis.price.toLocaleString("ko-KR") + "원" : "—"} |`;
    });

    // 분석 대상 종목 멀티플
    const targetKIS = kisData.get(krxCode);
    const targetRow = targetKIS
      ? `\n[분석 대상] PBR ${targetKIS.pbr?.toFixed(2) ?? "N/A"}배 | PER ${targetKIS.per?.toFixed(1) ?? "N/A"}배 | ROE ${targetKIS.roe?.toFixed(1) ?? "N/A"}%\n`
      : "";

    // DART 경쟁사 중 PER, PBR 유효값 기반 중앙값
    const validPERs = [...matchedCodes.keys()]
      .map(c => kisData.get(c)?.per)
      .filter((v): v is number => v != null && v > 0 && v < 200);
    const validPBRs = [...matchedCodes.keys()]
      .map(c => kisData.get(c)?.pbr)
      .filter((v): v is number => v != null && v > 0 && v < 30);
    const perMedian = validPERs.length
      ? [...validPERs].sort((a, b) => a - b)[Math.floor(validPERs.length / 2)]
      : null;
    const pbrMedian = validPBRs.length
      ? [...validPBRs].sort((a, b) => a - b)[Math.floor(validPBRs.length / 2)]
      : null;

    return `
=== 📄 DART 사업보고서 명시 직접 경쟁사 — 최우선 피어 벤치마크 ===
⚠️ 아래 기업들은 분석 대상(${krxCode})의 DART 사업보고서 "경쟁 현황"에서 직접 명시된 경쟁사입니다.
상대가치평가(PBR·PER·EV/EBITDA) 시 이 피어들을 1순위 기준으로 사용하세요.
${targetRow}
[DART 경쟁사 KIS 실시간 멀티플]
| 종목코드 | 종목명 | 시가총액 | PBR(배) | PER(배) | ROE | 현재가 |
|--------|--------|---------|--------|--------|-----|-------|
${peerRows.join("\n")}

[DART 경쟁사 밸류에이션 분포]
- PER 중앙값: ${perMedian ? perMedian.toFixed(1) + "x" : "N/A (적자 기업 다수)"}
- PBR 중앙값: ${pbrMedian ? pbrMedian.toFixed(2) + "x" : "N/A"}

※ 분석 대상의 ROE·성장률이 경쟁사 평균 대비 우위인 경우에만 프리미엄 적용을 정당화하세요.
`;
  } catch (err) {
    console.error("[dart-peer] getDartCompetitorPeerContext failed:", err);
    return null;
  }
}

// DART 경쟁사 → Yahoo Finance 티커 구조체로 변환 (피어 선정 seed 용)
async function getDartCompetitorTickerPeers(krxCode: string): Promise<{
  peers: Array<{ ticker: string; name: string; exchange: string; reason: string }>;
  hint: string; // selectPeerTickers에 주입할 힌트 텍스트 (비상장사 포함)
} | null> {
  try {
    const dartText = await fetchDartCompetitorSection(krxCode);
    if (!dartText || dartText.length < 10) return null;

    const companyNames = extractCompanyNamesFromDart(dartText);
    const hintNames = companyNames.length > 0 ? companyNames : [];

    // KRX DB에서 이름 매칭 → market(KOSPI/KOSDAQ) + code 확인
    const matchedPeers: Array<{ ticker: string; name: string; exchange: string; reason: string }> = [];
    const seenCodes = new Set<string>();

    await Promise.allSettled(
      hintNames.slice(0, 12).map(async (rawName) => {
        const keyword = rawName.replace(/[\(\)（）\s]/g, "").slice(0, 8);
        const res = await pool.query<{ code: string; name: string; market: string }>(
          `SELECT code, name, market FROM krx_peer_data
           WHERE name ILIKE $1
             AND snapshot_date = (SELECT MAX(snapshot_date) FROM krx_peer_data)
           ORDER BY mcap DESC NULLS LAST
           LIMIT 1`,
          [`%${keyword}%`]
        );
        if (res.rows.length > 0 && res.rows[0].code !== krxCode && !seenCodes.has(res.rows[0].code)) {
          const { code, name, market } = res.rows[0];
          seenCodes.add(code);
          // KOSPI → .KS, KOSDAQ → .KQ
          const suffix = market?.toUpperCase().includes("KOSDAQ") ? ".KQ" : ".KS";
          matchedPeers.push({
            ticker: `${code}${suffix}`,
            name,
            exchange: market ?? "KOSPI",
            reason: `DART 사업보고서 "경쟁 현황"에 직접 명시된 경쟁사. 동일 제품/시장에서 직접 경쟁 관계.`,
          });
        }
      })
    );

    // hint 텍스트: 상장/비상장 모두 포함 (selectPeerTickers AI가 추가로 고려)
    const hint = hintNames.length > 0
      ? `DART 사업보고서 명시 경쟁사: ${hintNames.slice(0, 8).join(", ")}. ` +
        `이 중 상장사가 있다면 반드시 피어 그룹에 포함하세요.`
      : "";

    return { peers: matchedPeers, hint };
  } catch (err) {
    console.error("[dart-peer-tickers] failed:", err);
    return null;
  }
}

function extractJsonSafe(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  // 괄호 카운팅으로 첫 JSON 객체 범위 추출 (lastIndexOf보다 안전)
  const startIdx = s.indexOf("{");
  if (startIdx === -1) return null;
  let depth = 0, endIdx = -1, inString = false, escaped = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) return null;
  s = s.slice(startIdx, endIdx + 1);
  // 시도 1: 원본 그대로
  try { return JSON.parse(s); } catch { /* 계속 */ }
  // 시도 2: trailing comma 제거
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch { /* 계속 */ }
  // 시도 3: 문자열 내 실제 개행 → 이스케이프
  try {
    const fixedNl = s.replace(/"((?:[^"\\]|\\.)*)"/gs, (_m: string, inner: string) =>
      `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
    );
    return JSON.parse(fixedNl);
  } catch { /* 계속 */ }
  // 시도 4: 따옴표 없는 % 숫자값 → 문자열로 변환
  try { return JSON.parse(s.replace(/:\s*([+-]?\d+\.?\d*)%/g, (_: string, n: string) => `: "${n}%"`)); } catch { /* 계속 */ }
  // 시도 5: 전체 복합 수정 (개행 이스케이프 + 미따옴표 % + trailing comma)
  try {
    const fixedAll = s
      .replace(/"((?:[^"\\]|\\.)*)"/gs, (_m: string, inner: string) =>
        `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
      )
      .replace(/:\s*([+-]?\d+\.?\d*)%/g, (_: string, n: string) => `: "${n}%"`)
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixedAll);
  } catch { return null; }
}

/**
 * FINAL_VALUATION_DATA JSON을 텍스트에서 robust하게 추출
 * ─ 기존 regex(\{[\s\S]*?\})는 중첩 JSON에서 첫 번째 }에 멈추는 버그 있음
 * ─ 이 함수는 문자열 이스케이프를 인식하는 bracket-counting으로 정확한 범위를 찾음
 */
function extractFvdJson(text: string): Record<string, any> | null {
  const keyIdx = text.indexOf("FINAL_VALUATION_DATA");
  if (keyIdx === -1) return null;
  const start = text.indexOf("{", keyIdx);
  if (start === -1) return null;

  // bracket-counting (문자열 내부 괄호 무시)
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const raw = text.slice(start, i + 1);
        // 시도 1: 원본 그대로
        try { return JSON.parse(raw); } catch { /* 계속 */ }
        // 시도 2: trailing comma + 개행 제거
        try { return JSON.parse(raw.replace(/,\s*([}\]])/g, "$1").replace(/[\r\n\t]/g, " ")); } catch { /* 계속 */ }
        // 시도 3: 마지막 수단 — base 숫자만 직접 추출
        const baseM = raw.match(/"?base"?\s*:\s*([\d.]+)/);
        if (baseM) return { base: parseFloat(baseM[1]) };
        return null;
      }
    }
  }
  return null;
}

/** investment_strategy JSON이 파싱 불가인 경우 복구된 문자열 반환, 이미 정상이면 원본 반환 */
function repairInvestmentStrategyContent(raw: string): string {
  if (!raw) return raw;
  if (extractJsonSafe(raw)) return raw; // 이미 정상
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const startIdx = s.indexOf("{");
  if (startIdx === -1) return raw;
  let depth = 0, endIdx = -1, inString = false, escaped = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) return raw;
  const jsonPart = s.slice(startIdx, endIdx + 1);
  try {
    const fixedAll = jsonPart
      .replace(/"((?:[^"\\]|\\.)*)"/gs, (_m: string, inner: string) =>
        `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
      )
      .replace(/:\s*([+-]?\d+\.?\d*)%/g, (_: string, n: string) => `: "${n}%"`)
      .replace(/,\s*([}\]])/g, "$1");
    JSON.parse(fixedAll); // 검증
    console.log("[repair] investment_strategy JSON 복구 성공");
    return fixedAll;
  } catch {
    console.warn("[repair] investment_strategy JSON 복구 실패 — 원본 저장");
    return raw;
  }
}

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

// ─── Lead Portfolio Strategist QC Check ──────────────────────────────────────

const QC_STEPS = new Set<AgentKey>(["relative_valuation", "company_analysis"]); // DA debate 이후 팀장 QC 추가 검증

async function runQCCheck(
  stepKey: AgentKey,
  content: string,
  companyName: string,
  ticker: string,
  dartFloorAuk?: number | null
): Promise<{ approved: boolean; score: number; feedback: string }> {
  const agentName = AGENTS[stepKey].name;
  const isFundamental = stepKey === "company_analysis";
  const isRelativeValuation = stepKey === "relative_valuation";
  // Use longer excerpts so full financial tables and key-metrics blocks are captured
  const excerptLength = isRelativeValuation ? 5000 : isFundamental ? 5000 : 2500;
  // For fundamental analysis also include the tail (핵심 지표 도출 블록은 맨 끝에 위치)
  const tailLength = isFundamental ? 2000 : 0;
  const excerpt = tailLength > 0
    ? content.slice(0, excerptLength) + (content.length > excerptLength ? "\n...[중략]...\n" + content.slice(-tailLength) : "")
    : content.slice(0, excerptLength);
  const fundamentalExtra = isFundamental ? `

5. 실적 전망 정합성 (실적 전망 단계 전용 필수 검증):
   - 재무 분석 섹션이 없으면: 불승인
   - 수익성 표(영업이익률 포함)가 없으면: 불승인 (단, 계산 불가 셀을 "—"으로 채운 경우는 통과)
   - 현금흐름 섹션이 아예 없으면: 불승인. 단, 현금흐름표 데이터가 없어 "N/A (컨텍스트에 현금흐름표 미제공)"으로 표기한 경우는 통과 허용
   - 재무건전성(부채비율 또는 순현금, 발행주식수)이 없으면: 불승인
   - Base 실적 추정 테이블(매출·영업이익·EBITDA·EPS 행)이 없으면: 불승인
   - EPS 수치가 아예 없으면: 불승인 (적자 기업의 음수 EPS는 유효, 추정값 명시 필요)
   - 밸류에이션을 위한 핵심 지표 도출 블록이 없으면: 불승인
   - 성장 동력 또는 리스크 요인 서술이 없으면: 불승인

6. 수치 정합성 검증 (실적 전망 단계 전용 — 수치 오류는 밸류에이션 전체를 망침):
   - 실적 추정 테이블의 EPS와 "순이익 ÷ 발행주식수" 결과가 ±20% 이상 차이 나면: 불승인
   - 매출성장률 YoY(%)가 테이블에 명시되어 있는데 실제 매출 수치로 역산한 성장률과 방향이 다르면(예: 매출은 감소인데 성장률은 +면): 불승인
   - EBITDA = 영업이익 + D&A 원칙이 지켜지지 않아 EBITDA < 영업이익인 비바이오 흑자 기업이면: 불승인 (단, D&A 데이터 없는 경우 통과)
   - 발행주식수 출처가 명시되지 않으면(KRX/Naver/Yahoo/서버계산 중 어느 것인지 불분명): 감점(−2점)
   - 컨텍스트에 애널리스트 컨센서스(EPS 또는 매출 전망)가 있음에도 전망 섹션에서 컨센서스를 전혀 언급하지 않으면: 불승인
   - 올해E 또는 내년E 영업이익률이 전년 실적 대비 +15%p 이상 점프했는데 전망 근거에 구체적 드라이버(원가 구조 변화·매출 레버리지·사업 믹스 개선 등) 없으면: 불승인
   - 컨텍스트에 이익 품질(현금전환율 OCF/순이익) 경고가 있음에도 순이익·EPS 추정에 이를 반영하지 않으면: 불승인
   - 컨텍스트에 GPM(매출총이익률) 추세가 있음에도 GPM 추세에 역행하는 OPM 추정을 근거 없이 제시하면: 불승인
   - 컨텍스트에 서프라이즈 보정 지침(Beat/Miss 패턴)이 있음에도 추정치에 해당 보정을 전혀 반영하지 않으면: 감점(−2점)${(dartFloorAuk && dartFloorAuk > 0) ? `
   - [⛔ DART 확정 분기 하한선 체크] DART에서 확정된 올해 분기 영업이익 합계 = ${dartFloorAuk.toFixed(1)}억원. 이 값은 수학적 최솟값입니다(확정 분기 이후 분기들은 최소 0이므로). 보고서 실적 추정 테이블에서 올해E 영업이익을 찾아 단위를 변환(백만원→억 ÷10, 원→억 ÷1억)하여 비교하세요. 올해E 영업이익이 ${dartFloorAuk.toFixed(1)}억원 미만으로 추정되어 있으면: 즉시 불승인 (피드백에 "올해E 영업이익 수학적 하한선 위반: 확정 ${dartFloorAuk.toFixed(1)}억 > 추정 X억" 명시).` : ""}` : isRelativeValuation ? `

5. 목표가 산출 정합성 — 팀장 직접 조율 검수 (전용 필수 검증):

  [구조 검증 — 하나라도 없으면 즉시 불승인]
   - 절대가치 산출 표가 없으면: 불승인 (DCF FCFF 테이블 또는 Pipeline rNPV 테이블 또는 EV/Sales 테이블 또는 DDM 계산 중 하나)
   - 피어 그룹 멀티플 비교 테이블이 없으면: 불승인
   - FINAL_VALUATION_DATA JSON이 없거나 파싱 불가이면: 즉시 불승인
   - 최종 적정주가·상단 밴드·하단 밴드 3개 수치가 모두 명시되지 않으면: 불승인
   - 최종 밸류에이션 핵심 지표 요약 블록이 없으면: 불승인

  [모델 선택 및 가정 검증]
   - 모델 가정 수립 섹션이 없으면: 불승인
   - WACC 산출 근거(Rf, β, ERP, CoE 수치)가 없으면: 불승인
   - 바이오/제약 기업이 임상단계(미허가 파이프라인 중심, 매출 극소)임에도 DCF를 선택했고, 선택 이유가 없거나 빈약하면: 불승인

  [절대가치 모델 품질 검증 — 선택된 모델에 따라 아래 중 하나 적용]
   A) DCF 모델: FCFF 10년 테이블이 있어야 하고, 주당 내재가치 수치가 있어야 함. Reverse DCF 분석이 없으면: 불승인
   B) Pipeline rNPV 모델: 파이프라인별 PoS·rNPV 표가 있어야 하고, 주당 내재가치 수치가 있어야 함. 현재 주가 역산 분석이 없으면: 불승인
   C) EV/Sales 모델: EV/Sales 배수·산출 EV·주당 내재가치 수치가 있어야 함
   D) DDM 모델: D₁·CoE·g·DDM 내재가치 수치가 있어야 함
   - 어떤 모델이든 최종 주당 내재가치(원) 수치가 없으면: 불승인
   - 내재가치가 현재 주가 대비 터무니없이 높거나(소형 성장주·바이오 3.5배↑, 일반 성숙 대형주 시총 5조↑ 2.0배↑) 낮으면(0.2배↓): 가정 재검토 여부 확인, 없으면 불승인
   - ⚠️ 성숙 대형주(시총 5조원↑, 예: 삼성전자·SK하이닉스·현대차·NAVER·카카오 등) 목표주가가 현재가 대비 +100% 초과인 경우: DCF 성장률 가정이 컨센서스를 크게 상회하거나 피어 배수 적용이 과도한 것으로 판단. Reverse DCF 역산 CAGR 명시 없으면 즉시 불승인

  [피어 조율 품질 검증]
   - 피어 기업이 3개 미만으로 선정되면: 불승인
   - 피어 기업명이 "Peer A", "Peer B", "Peer C", "Peer D" 등 플레이스홀더이면: 불승인 (실제 회사명 필수)
   - 피어 선정 논리(왜 이 피어들이 유의미한지)가 없으면: 불승인
   - 적용 멀티플(PER 또는 EV/EBITDA) 선택 이유가 없으면: 불승인
   - 프리미엄/디스카운트 적용 근거가 없으면: 불승인

  [조율 품질 검증 — 핵심]
   - DCF 내재가치와 피어 목표가 두 숫자가 모두 명시되지 않으면: 불승인
   - 괴리율이 명시되지 않으면: 불승인
   - 조율 방법(가중평균 수식 또는 Lead 조율 근거)이 없으면: 불승인
   - 상단/하단 밴드 산출 근거가 없으면: 불승인
   - 상단 밴드 = 하단 밴드이면(밴드 차이 없음): 불승인
   - 최종 적정주가가 상단 밴드보다 높거나 하단 밴드보다 낮으면: 불승인

  [극단값 방어]
   - 하단 밴드가 현재 주가의 20% 미만이면: 불승인
   - 목표주가(Base)가 현재 주가의 30% 미만이면: 불승인 (단, 보고서 내 부도·상장폐지 위험이 명시된 경우 예외)
   - EV/Sales 모델 적용 배수가 피어 평균 EV/Sales의 25% 미만이면(극단적 디스카운트): 불승인 — 반드시 배수 재검토
   - 바이오/제약 기업(업종 키워드: 바이오, 제약, 헬스케어, 세포치료, 줄기세포, Biotech, Pharma)에 PBR을 30% 이상 가중했으면: 불승인 (PBR은 자산 기반 성숙 기업 전용, 바이오텍 부적합)
   - FCF 음수이면서 매출성장률 30%+ 또는 EV/매출 10x+ 고성장 기업에 PBR을 30% 이상 가중했으면: 불승인
   - 바이오/제약 파이프라인 rNPV 할인율이 15%를 초과하면: 불승인 (PoS가 이미 임상 위험 반영 — 이중 할인 금지)
   - DCF 테이블에서 3개 이상 연도의 재투자(Reinvestment/CAPEX) 값이 동일한 숫자로 기재되어 있으면: 불승인 (과거 CAPEX 고정 오류 — S-to-C 기반 연도별 공식 계산 필수)
   - FCF 음수 고성장 기업(Year 1~3 FCFF 전부 음수 AND 매출성장률 1개 연도 이상 15%↑)임에도 DCF를 단독 모델(가중 60%↑)로 사용하고 EV/Sales 피어 비교가 없으면: 불승인` : "";

  const prompt = `당신은 AI 헤지펀드 리서치 팀의 Lead Portfolio Strategist(팀장)입니다.
아래는 ${agentName}가 ${companyName}(${ticker})에 대해 작성한 분석 보고서입니다.

[보고서]
${excerpt}

다음 기준으로 품질을 평가하세요:
1. 구체적 수치 인용 (시장 규모, 성장률, 점유율, 재무 수치 등)
2. 핵심 이슈와의 명확한 연결
3. 투자 판단에 도움되는 실행 가능한 인사이트
4. 분석 깊이 (표면적 나열 vs 인과관계 해석)
5. 할루시네이션 방지 검증 (모든 단계 필수):
   - 다음 유형의 내용이 구체적 출처·근거 없이 기재되면 감점(-2점) 또는 불승인:
     · 실제 확인되지 않은 M&A·계약·파트너십 사실 주장
     · 경영진 발언·IR 내용을 인용 없이 단정 기술
     · 존재하지 않거나 검증 안 된 피어 기업명·수치 사용
     · 컨텍스트에 없는 수치를 있는 것처럼 제시
     · 특정 증권사·애널리스트명을 거론하며 목표가·의견 인용 (예: "OO증권은 목표가 X원을 제시") → 즉시 불승인
     · 임상시험 성공·실패, 규제 허가 결과를 컨텍스트 없이 단정 기술
   - "업계 평균으로 추정", "일반적으로 알려진 바에 의하면" 등으로 수치를 근거 없이 단정하면: 감점(-1점)
   - 산업 분석(industry_analysis) 단계에서 시장 규모·점유율 수치를 출처 없이 단정하면: 감점(-1점)${fundamentalExtra}

반드시 아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{"score": [1~10 정수], "approved": [7점 이상이면 true, 미만이면 false], "feedback": "미흡한 점 한 줄 요약 (approved이면 빈 문자열)"}`;

  try {
    await geminiSemaphore.acquire();
    let raw = "";
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: 256,
          temperature: 0.1,
          topP: 0.8,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      raw = response.text ?? "";
    } finally {
      geminiSemaphore.release();
    }
    const parsed = extractJsonSafe(raw);
    if (parsed && typeof parsed.score === "number") {
      return {
        score: Math.min(10, Math.max(1, Number(parsed.score))),
        approved: parsed.approved ?? Number(parsed.score) >= 7,
        feedback: String(parsed.feedback ?? ""),
      };
    }
  } catch (err) {
    console.error("[QC] check error:", err);
  }
  return { approved: true, score: 8, feedback: "" };
}

// ─── Devil's Advocate Debate (company_analysis & relative_valuation) ─────────

// Debate는 목표주가 산출(relative_valuation)에만 유지 — company_analysis는 QC 검증으로 대체
const DEBATE_STEPS = new Set<AgentKey>(["relative_valuation"]);

// ── 사전 수집 캐시: company_analysis 실행 중 피어 데이터를, relative_valuation 실행 중 주봉 MA를 미리 수집 ──
const preFetchedPeerData = new Map<number, Promise<{ peers: any[]; data: string }>>();
const preFetchedWeeklyMA = new Map<number, Promise<string>>();

async function runDebateChallenge(
  stepKey: "company_analysis" | "relative_valuation",
  draft: string,
  companyName: string,
  ticker: string
): Promise<string> {
  const isFundamental = stepKey === "company_analysis";
  const excerpt = draft.slice(0, 6000);

  const challengerPrompt = isFundamental
    ? `당신은 AI 헤지펀드 리서치 팀의 Devil's Advocate(반론 전문가)입니다.
아래는 ${companyName}(${ticker})의 실적 전망 초안입니다. 이 보고서의 핵심 가정에 대해 정확히 3가지 각도로 치열하게 반론하세요.

[반론 원칙]
- "틀렸다"가 아니라 "이 가정이 성립하려면 X 조건이 필요한데 그 증거가 부족하다"는 형식으로 작성
- 각 반론은 반드시 구체적 수치나 로직 근거 포함
- 낙관적 편향과 비관적 편향 모두 지적 가능

[반론 3가지]
1. 매출·성장률 가정 반론: 가장 낙관적으로 보이는 성장 가정의 약점 지적 (2-3문장)
2. 이익률·비용 가정 반론: 마진 추정의 취약한 논리 지적 (2-3문장)
3. 핵심 리스크 누락 반론: 실적 추정을 뒤엎을 수 있는 가장 중요한 하방 리스크 1개 제시 (2-3문장)

[초안]
${excerpt}

JSON·마크다운 테이블 없이 번호 형식으로 간결하게 작성 (총 400-700자).`
    : `당신은 AI 헤지펀드 리서치 팀의 Valuation Skeptic(밸류에이션 검증 전문가)입니다.
아래는 ${companyName}(${ticker})의 적정주가 산출 초안입니다. 밸류에이션의 핵심 가정을 정확히 3가지 각도로 검증하세요.

[반론 원칙]
- "틀렸다"가 아니라 "이 가정이 성립하려면 X 조건이 필요한데 그 근거가 불충분하다"는 형식
- 각 반론은 반드시 구체적 수치·비교 근거 포함
- ⚠️ 핵심 제약: 이 반론의 목적은 가정의 정밀도를 높이는 것입니다. 초안의 적정주가 방향성(저평가·고평가)을 뒤집거나 목표가를 초안 대비 ±25% 초과 이동시키는 주장은 하지 마세요.

[검증 3가지]
1. 할인율·WACC 가정 검증: WACC 또는 할인율 설정의 취약점 (2-3문장)
2. 성장률·멀티플 가정 검증: 터미널 성장률 또는 피어 배수 적용의 취약한 논리 (2-3문장)
3. 목표가 도출 검증: 최종 적정주가·밴드 산출 과정에서 가장 약한 논리적 연결고리 (2-3문장)

[초안]
${excerpt}

JSON·마크다운 테이블 없이 번호 형식으로 간결하게 작성 (총 400-700자).`;

  try {
    await geminiSemaphore.acquire();
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("challenger timeout")), 25_000)
      );
      const response = await Promise.race([
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: challengerPrompt }] }],
          config: {
            maxOutputTokens: 1024,
            temperature: 0.25,
            topP: 0.85,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        timeoutPromise,
      ]);
      return response.text ?? "";
    } finally {
      geminiSemaphore.release();
    }
  } catch (err) {
    console.error(`[debate] challenger error (${stepKey}):`, err);
    return "";
  }
}

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

// ─── 동시성 제어 — Semaphore ─────────────────────────────────────────────────
class Semaphore {
  private _count: number;
  private _queue: Array<() => void> = [];
  constructor(private readonly max: number) { this._count = max; }
  acquire(): Promise<void> {
    if (this._count > 0) { this._count--; return Promise.resolve(); }
    return new Promise(resolve => this._queue.push(resolve));
  }
  release(): void {
    if (this._queue.length > 0) { this._queue.shift()!(); }
    else { this._count++; }
  }
  get waiting() { return this._queue.length; }
  get active() { return this.max - this._count; }
}

// Gemini API 동시 호출 제한: 429 Rate Limit 방지
const MAX_CONCURRENT_GEMINI = 10;
const geminiSemaphore = new Semaphore(MAX_CONCURRENT_GEMINI);

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
  if (cached) {
    return cached;
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

async function fetchFinancialContext(resolvedSymbol: string): Promise<string> {
  const fcCacheKey = `financial:${resolvedSymbol}`;
  const fcCached = cache.get<string>(fcCacheKey);
  if (fcCached) {
    return fcCached;
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

        // ── fwdOpmCenter 최종값: 추세 방향에 따라 연간 앵커 혼합 비율 조정 ───
        // 상승 추세: 연간 앵커(역사 평균)로 회귀 기대 → 앵커 비중 높임
        // 하락 추세: 추세 지속 가능성 → 앵커 비중 낮춤 (평균 회귀 편향 억제)
        const isDeclineTrend = trendQoQ < -1; // QoQ -1%p 이상 하락이면 하락 추세 판정
        const fwdOpmCenter = (() => {
          if (annualOpmAnchor === null) return fwdOpmBase;
          if (confirmedQCount >= 2) return fwdOpmBase; // Q2 이상 확정: 확정 실적 우선
          if (isDeclineTrend) {
            // 하락 추세: 앵커 비중 낮춰 추세 반영 강화
            return confirmedQCount === 1
              ? fwdOpmBase * 0.65 + annualOpmAnchor * 0.35  // Q1 확정+하락: 추세 65%
              : fwdOpmBase * 0.75 + annualOpmAnchor * 0.25; // 확정 없음+하락: 추세 75%
          } else {
            // 상승/횡보 추세: 원래 방식 유지
            return confirmedQCount === 1
              ? fwdOpmBase * 0.35 + annualOpmAnchor * 0.65  // Q1만: 연간 앵커 65%
              : fwdOpmBase * 0.50 + annualOpmAnchor * 0.50; // 확정 없음: 연간 앵커 50%
          }
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

        const estRevByQ: Record<number, number> = {};
        for (const q of remainingQtrs) {
          const prevYearRev = revMap[`${targetYear - 1}_${q}`];
          const hist        = qRevByQNum[q].slice(0, 3);
          const histQAvg    = hist.length > 0 ? hist.reduce((s, v) => s + v, 0) / hist.length : null;

          if (confirmedYoYGrowth !== null && prevYearRev && prevYearRev > 0) {
            // 확정 YoY 성장률로 전년 동기에 적용 (70%) + 역사적 절대값 (30%)
            const yoyEst = prevYearRev * (1 + confirmedYoYGrowth);
            estRevByQ[q] = histQAvg ? yoyEst * 0.7 + histQAvg * 0.3 : yoyEst;
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
          lines.push(`     → 확정 누적: 매출 ${fmtNum(confirmedAnnualRev, currency)}, 영업이익 ${fmtNum(confirmedAnnualOp, currency)} (OPM ${confirmedOpmAvg?.toFixed(1) ?? '-'}%)`);
          if (confirmedYoYGrowth !== null) {
            lines.push(`     → 확정 분기 YoY 매출 성장률: ${(confirmedYoYGrowth * 100).toFixed(1)}% → 미확정 분기 매출 추정에 반영`);
          }
          const anchorNote = confirmedQCount === 1 && annualOpmAnchor !== null
            ? isDeclineTrend
              ? ` (Q1 단독 확정 + 하락 추세 → 추세 65%·연간 앵커 35% 반영, 추세 지속 가정)`
              : ` (Q1 단독 확정 → 연간 앵커 ${annualOpmAnchor.toFixed(1)}% 65% 반영)`
            : annualOpmAnchor !== null ? ` (연간 앵커 ${annualOpmAnchor.toFixed(1)}%)` : '';
          lines.push(`     → OPM 신뢰 가중치 ${(confirmedWeight * 100).toFixed(0)}% → 조정 forward OPM 중심값: ${fwdOpmCenter.toFixed(1)}%${anchorNote}`);
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
      }
    }
  }

  // Earnings estimates
  const trends: any[] = (result.earningsTrend as any)?.trend ?? [];
  if (trends.length > 0) {
    lines.push("\n[EPS 및 매출 전망 (애널리스트 컨센서스)]");
    lines.push("  ⚠️ 주의: 아래 '매출 성장률(YoY)'은 직전 연도 실제 매출 대비 계산값임. 'EPS 성장률'과 완전히 다른 수치. DCF에는 매출 성장률만 사용할 것.");

    // 직전 실제 연간 매출 (timeseries annualTotalRevenue 우선, 없으면 income statement)
    const tsRevArr: any[] = tsResult?.annualTotalRevenue ?? [];
    const isArr: any[] = (result as any)?.incomeStatementHistory?.incomeStatementHistory ?? [];
    let priorActualRev: number | null = null;
    if (tsRevArr.length > 0) {
      const sorted = [...tsRevArr].sort((a, b) => new Date(b.asOfDate ?? 0).getTime() - new Date(a.asOfDate ?? 0).getTime());
      priorActualRev = sorted[0]?.reportedValue?.raw ?? sorted[0]?.reportedValue ?? null;
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

// ─── Peer Data Auto-Fetch ─────────────────────────────────────────────────────

// ─── US 주요 종목 하드코딩 피어 맵 (AI 선택 실패 시 대체) ───────────────────────
type PeerEntry = { ticker: string; name: string; exchange: string; reason: string };
const US_PEER_MAP: Record<string, PeerEntry[]> = {
  // Semiconductors / AI
  "NVDA": [
    { ticker: "AMD",  name: "AMD",      exchange: "NASDAQ", reason: "GPU/CPU 경쟁사, 데이터센터 AI 가속기" },
    { ticker: "INTC", name: "Intel",    exchange: "NASDAQ", reason: "데이터센터 반도체, x86 CPU 경쟁사" },
    { ticker: "TSM",  name: "TSMC",     exchange: "NYSE",   reason: "첨단 파운드리, NVIDIA 웨이퍼 생산" },
    { ticker: "AVGO", name: "Broadcom", exchange: "NASDAQ", reason: "AI 네트워킹 칩, ASIC 경쟁사" },
    { ticker: "QCOM", name: "Qualcomm", exchange: "NASDAQ", reason: "모바일·엣지 AI 반도체" },
  ],
  "AMD": [
    { ticker: "NVDA", name: "NVIDIA",   exchange: "NASDAQ", reason: "GPU 시장 1위 직접 경쟁사" },
    { ticker: "INTC", name: "Intel",    exchange: "NASDAQ", reason: "CPU/데이터센터 경쟁사" },
    { ticker: "AVGO", name: "Broadcom", exchange: "NASDAQ", reason: "AI 칩 경쟁사" },
    { ticker: "QCOM", name: "Qualcomm", exchange: "NASDAQ", reason: "모바일 반도체" },
    { ticker: "TSM",  name: "TSMC",     exchange: "NYSE",   reason: "첨단 파운드리 파트너" },
  ],
  "INTC": [
    { ticker: "AMD",  name: "AMD",         exchange: "NASDAQ", reason: "x86 CPU 직접 경쟁사" },
    { ticker: "NVDA", name: "NVIDIA",      exchange: "NASDAQ", reason: "데이터센터 AI 칩" },
    { ticker: "AVGO", name: "Broadcom",    exchange: "NASDAQ", reason: "반도체 경쟁사" },
    { ticker: "QCOM", name: "Qualcomm",    exchange: "NASDAQ", reason: "모바일/IoT 칩" },
    { ticker: "TSM",  name: "TSMC",        exchange: "NYSE",   reason: "파운드리 경쟁사" },
  ],
  "AVGO": [
    { ticker: "NVDA", name: "NVIDIA",   exchange: "NASDAQ", reason: "AI 칩 경쟁사" },
    { ticker: "AMD",  name: "AMD",      exchange: "NASDAQ", reason: "반도체 동종" },
    { ticker: "MRVL", name: "Marvell",  exchange: "NASDAQ", reason: "데이터 인프라 반도체" },
    { ticker: "QCOM", name: "Qualcomm", exchange: "NASDAQ", reason: "반도체 동종" },
    { ticker: "TSM",  name: "TSMC",     exchange: "NYSE",   reason: "첨단 파운드리" },
  ],
  // Big Tech
  "AAPL": [
    { ticker: "MSFT", name: "Microsoft",    exchange: "NASDAQ", reason: "빅테크 동종, 클라우드/AI 경쟁" },
    { ticker: "GOOGL", name: "Alphabet",    exchange: "NASDAQ", reason: "AI/광고 경쟁사" },
    { ticker: "META", name: "Meta",         exchange: "NASDAQ", reason: "소비자 기술 동종" },
    { ticker: "AMZN", name: "Amazon",       exchange: "NASDAQ", reason: "클라우드·디지털 서비스" },
    { ticker: "SONY", name: "Sony",         exchange: "NYSE",   reason: "소비자 가전·엔터테인먼트 경쟁사" },
  ],
  "MSFT": [
    { ticker: "GOOGL", name: "Alphabet",    exchange: "NASDAQ", reason: "클라우드(Azure vs GCP)·AI 경쟁사" },
    { ticker: "AMZN",  name: "Amazon",      exchange: "NASDAQ", reason: "AWS vs Azure 클라우드" },
    { ticker: "AAPL",  name: "Apple",       exchange: "NASDAQ", reason: "빅테크 동종" },
    { ticker: "CRM",   name: "Salesforce",  exchange: "NYSE",   reason: "엔터프라이즈 SaaS" },
    { ticker: "ORCL",  name: "Oracle",      exchange: "NYSE",   reason: "클라우드 ERP·DB 경쟁사" },
  ],
  "GOOGL": [
    { ticker: "MSFT",  name: "Microsoft",   exchange: "NASDAQ", reason: "클라우드·AI·검색 경쟁사" },
    { ticker: "META",  name: "Meta",         exchange: "NASDAQ", reason: "디지털 광고 직접 경쟁사" },
    { ticker: "AMZN",  name: "Amazon",       exchange: "NASDAQ", reason: "클라우드(AWS vs GCP)" },
    { ticker: "AAPL",  name: "Apple",        exchange: "NASDAQ", reason: "빅테크 동종" },
    { ticker: "BIDU",  name: "Baidu",        exchange: "NASDAQ", reason: "AI 검색 경쟁사(중국)" },
  ],
  "META": [
    { ticker: "GOOGL", name: "Alphabet",    exchange: "NASDAQ", reason: "디지털 광고 직접 경쟁사" },
    { ticker: "SNAP",  name: "Snap",        exchange: "NYSE",   reason: "소셜미디어·광고 경쟁사" },
    { ticker: "PINS",  name: "Pinterest",   exchange: "NYSE",   reason: "소셜 광고 플랫폼" },
    { ticker: "MSFT",  name: "Microsoft",   exchange: "NASDAQ", reason: "빅테크·AI 동종" },
    { ticker: "AMZN",  name: "Amazon",      exchange: "NASDAQ", reason: "디지털 광고 경쟁사" },
  ],
  "AMZN": [
    { ticker: "MSFT",  name: "Microsoft",   exchange: "NASDAQ", reason: "Azure vs AWS 클라우드" },
    { ticker: "GOOGL", name: "Alphabet",    exchange: "NASDAQ", reason: "GCP vs AWS 클라우드" },
    { ticker: "BABA",  name: "Alibaba",     exchange: "NYSE",   reason: "글로벌 이커머스·클라우드" },
    { ticker: "WMT",   name: "Walmart",     exchange: "NYSE",   reason: "리테일 경쟁사" },
    { ticker: "SHOP",  name: "Shopify",     exchange: "NYSE",   reason: "이커머스 플랫폼 경쟁사" },
  ],
  // New Space / Aerospace & Defense
  "RKLB": [
    { ticker: "ASTS",  name: "AST SpaceMobile", exchange: "NASDAQ", reason: "뉴스페이스 위성·통신 초기 성장주, 유사 밸류에이션 프로파일" },
    { ticker: "LUNR",  name: "Intuitive Machines", exchange: "NASDAQ", reason: "뉴스페이스 달 탐사·NASA 계약 초기 성장주" },
    { ticker: "PL",    name: "Planet Labs",     exchange: "NYSE",   reason: "위성 운영·데이터 서비스, 유사 EV/Sales 고배수 성장주" },
    { ticker: "SPCE",  name: "Virgin Galactic",  exchange: "NYSE",   reason: "민간 우주 초기 스타트업" },
    { ticker: "KTOS",  name: "Kratos Defense",  exchange: "NASDAQ", reason: "방산·우주 인프라, 미국 정부 계약 유사 구조" },
  ],
  "ASTS": [
    { ticker: "RKLB",  name: "Rocket Lab",      exchange: "NASDAQ", reason: "뉴스페이스 발사체·위성 동종" },
    { ticker: "LUNR",  name: "Intuitive Machines", exchange: "NASDAQ", reason: "뉴스페이스 초기 성장주" },
    { ticker: "PL",    name: "Planet Labs",     exchange: "NYSE",   reason: "위성 서비스 동종" },
    { ticker: "VSAT",  name: "ViaSat",          exchange: "NASDAQ", reason: "위성통신 서비스" },
    { ticker: "IRDM",  name: "Iridium",         exchange: "NASDAQ", reason: "위성통신, 단 수익성 있는 성숙 기업으로 배수 직접 적용 주의" },
  ],
  // EV / Auto
  "TSLA": [
    { ticker: "GM",    name: "General Motors", exchange: "NYSE",   reason: "전통차·EV 전환 경쟁사" },
    { ticker: "F",     name: "Ford",           exchange: "NYSE",   reason: "픽업트럭·EV 경쟁사" },
    { ticker: "RIVN",  name: "Rivian",         exchange: "NASDAQ", reason: "순수 EV 스타트업" },
    { ticker: "NIO",   name: "NIO",            exchange: "NYSE",   reason: "중국 프리미엄 EV 경쟁사" },
    { ticker: "BYD",   name: "BYD (ADR)근사치 BYDDF", exchange: "OTC", reason: "글로벌 EV 판매 1위 경쟁사" },
  ],
  // Biotech / Pharma
  "MRNA": [
    { ticker: "BNTX",  name: "BioNTech",   exchange: "NASDAQ", reason: "mRNA 기술 직접 경쟁사" },
    { ticker: "PFE",   name: "Pfizer",     exchange: "NYSE",   reason: "백신·항바이러스 파트너/경쟁사" },
    { ticker: "REGN",  name: "Regeneron",  exchange: "NASDAQ", reason: "바이오로직스 대형사" },
    { ticker: "AMGN",  name: "Amgen",      exchange: "NASDAQ", reason: "대형 바이오텍" },
    { ticker: "GILD",  name: "Gilead",     exchange: "NASDAQ", reason: "항바이러스·면역 분야" },
  ],
  "PFE": [
    { ticker: "JNJ",   name: "Johnson & Johnson", exchange: "NYSE",   reason: "대형 제약 동종" },
    { ticker: "MRK",   name: "Merck",              exchange: "NYSE",   reason: "대형 제약 동종" },
    { ticker: "AZN",   name: "AstraZeneca",        exchange: "NASDAQ", reason: "글로벌 빅파마" },
    { ticker: "ABBV",  name: "AbbVie",             exchange: "NYSE",   reason: "대형 바이오파마" },
    { ticker: "MRNA",  name: "Moderna",            exchange: "NASDAQ", reason: "mRNA 백신 경쟁사" },
  ],
  "REGN": [
    { ticker: "AMGN",  name: "Amgen",      exchange: "NASDAQ", reason: "대형 바이오텍 동종" },
    { ticker: "BIIB",  name: "Biogen",     exchange: "NASDAQ", reason: "신경·면역 바이오텍" },
    { ticker: "GILD",  name: "Gilead",     exchange: "NASDAQ", reason: "대형 바이오텍" },
    { ticker: "VRTX",  name: "Vertex",     exchange: "NASDAQ", reason: "CF·희귀질환 바이오텍" },
    { ticker: "MRNA",  name: "Moderna",    exchange: "NASDAQ", reason: "mRNA 바이오텍" },
  ],
  // Finance
  "JPM": [
    { ticker: "BAC",  name: "Bank of America", exchange: "NYSE",   reason: "대형 상업은행" },
    { ticker: "GS",   name: "Goldman Sachs",   exchange: "NYSE",   reason: "투자은행 경쟁사" },
    { ticker: "MS",   name: "Morgan Stanley",  exchange: "NYSE",   reason: "투자은행" },
    { ticker: "WFC",  name: "Wells Fargo",     exchange: "NYSE",   reason: "대형 상업은행" },
    { ticker: "C",    name: "Citigroup",       exchange: "NYSE",   reason: "글로벌 대형 은행" },
  ],
  // Energy
  "XOM": [
    { ticker: "CVX",  name: "Chevron",    exchange: "NYSE", reason: "Integrated Oil & Gas 동종" },
    { ticker: "COP",  name: "ConocoPhillips", exchange: "NYSE", reason: "독립 석유 E&P" },
    { ticker: "BP",   name: "BP",         exchange: "NYSE", reason: "글로벌 메이저 오일" },
    { ticker: "SHEL", name: "Shell",      exchange: "NYSE", reason: "글로벌 메이저 오일" },
    { ticker: "TTE",  name: "TotalEnergies", exchange: "NYSE", reason: "글로벌 메이저 오일" },
  ],
};

// ─── Peer 선택 ──────────────────────────────────────────────────────────────────

async function selectPeerTickers(
  companyName: string,
  industry: string,
  previousContext: string,
  subjectTicker: string = "",
  dartHint: string = ""
): Promise<Array<{ ticker: string; name: string; exchange: string; reason: string }>> {
  try {
    const prompt = `Company: ${companyName}, Industry: ${industry}.

Based on the context below, identify 4-5 publicly traded peer companies for valuation comparison.
${dartHint ? `\n⭐ [DART 공시 참고] ${dartHint}\n위 경쟁사들이 상장사인 경우, 아래 3-axis 적합성 평가(≥2/3)를 통과할 때만 피어 그룹에 포함하세요. 사업 모델이 실질적으로 다르다면 제외하고, reason 필드에 "DART 명시 경쟁사이나 사업모델 불일치로 제외" 표기 가능.\n` : ""}
PEER QUALITY SCORING — for each candidate, mentally score these 3 axes and only include peers that score ≥2/3:
1. Business model match: same revenue model (product / service / subscription / royalty) and similar value chain position (upstream material / component / OEM / brand / platform)
2. Margin profile similarity: gross margin within ±15pp of subject company, or if margin data unavailable, same structural cost driver (e.g., both fab-heavy, both asset-light)
3. Growth stage match: same phase (pre-revenue pipeline / early commercial / mature growth / declining) — mixing stages severely distorts multiples

Flag any peer that fails one axis with a brief note in the reason field (e.g., "마진 프로파일 상이 — EV/Sales만 유효").
${previousContext ? `\nContext:\n${previousContext.slice(0, 1500)}` : ""}

PEER SELECTION RULES (strictly enforce):
- Business model match is MANDATORY. Do NOT mix these types in the same peer group:
  * Pure pipeline biotech (파이프라인 바이오텍) vs CDMO/CMO (위탁생산기업, e.g., 삼성바이오로직스, 에스티팜, 바이넥스). EV/Sales comparison between them is invalid.
  * Drug discovery/royalty model vs self-commercialization model — flag if you must include a mixed model peer.

- KOREAN BIOTECH SUBSECTOR RULES — 서브섹터 혼재 절대 금지 (한국 바이오 기업 분석 시 항상 적용):
  ┌─ 줄기세포 치료제: 파미셀(005690.KS), 코아스템켈생(166480.KQ), 강스템바이오텍(208370.KQ), 안트로젠(065660.KQ), 바이오솔루션(086820.KQ), 차바이오텍(085660.KQ)
  ├─ 제대혈 은행: 메디포스트(078160.KQ), 차바이오텍(085660.KQ)
  ├─ 바이오시밀러 전문기업: 셀트리온(068270.KS), 셀트리온헬스케어(091990.KQ), 삼성바이오로직스(207940.KS)
  ├─ 미용/보톡스/필러: 휴젤(145020.KQ), 메디톡스(086900.KQ), 대웅제약(069620.KS), 파마리서치(214450.KQ)
  ├─ 체성분/의료기기: 인바디(041830.KQ), 뷰웍스(180640.KQ), 오스템임플란트(048260.KQ)
  ├─ CDMO/CMO(위탁생산): 삼성바이오로직스(207940.KS), 에스티팜(237690.KQ), 바이넥스(053030.KQ)
  └─ 신약 개발(키나제·소분자): 오스코텍(039200.KQ), 보로노이(310210.KQ), 한미약품(128940.KS)

  ❌ FORBIDDEN cross-subsector mixing — 이 조합은 항상 피어 선정 오류:
  * 줄기세포 치료제 기업 피어에 셀트리온(바이오시밀러)·휴젤(보톡스/필러)·인바디(체성분기기)·오스코텍(키나제 신약) 절대 금지
  * 바이오시밀러 기업 피어에 줄기세포 기업·신약 파이프라인 기업 절대 금지
  * CDMO 기업 피어에 신약 개발사 절대 금지 (수익 모델 완전히 다름)
  * "바이오"라는 단어가 공통이더라도 실제 제품·수익 모델이 다르면 피어 불가
  * 적자 바이오텍 피어에 흑자 대형 제약사(PER 30x) 혼합 금지 — 멀티플 왜곡

- BATTERY / EV BATTERY COMPANY RULES (apply when subject is a battery cell/pack manufacturer like LG에너지솔루션, 삼성SDI, SK온, CATL, Panasonic Energy):
  * PRIORITY 1 — Korean battery peers: 삼성SDI(006400.KS), SK이노베이션(096770.KS)
  * PRIORITY 2 — Global battery peers: CATL is Shenzhen-listed (300750.SZ) — Yahoo Finance coverage may be limited; use 6752.T (Panasonic Holdings) as alternative
  * PRIORITY 3 — Battery materials: 에코프로비엠(247540.KQ), 포스코퓨처엠(003670.KS) acceptable as supply-chain peers (flag as "배터리 소재 공급망 피어")
  * FORBIDDEN PEERS for battery companies — DO NOT SELECT:
    - 삼성전자(005930.KS): consumer electronics + semiconductor, NOT a battery company
    - SK하이닉스(000660.KS): pure DRAM/HBM semiconductor, completely different business
    - Any semiconductor fab or memory company → business model completely different
  * DO NOT include the subject company itself as a peer

- SEMICONDUCTOR COMPANY RULES (apply when subject is a memory/DRAM/HBM company like SK하이닉스, Samsung Electronics, Micron):
  * PRIORITY 1 — Korean domestic peers first: 삼성전자(005930.KS) is always a valid peer for Korean memory companies.
  * PRIORITY 2 — Pure-play memory peers only: MU (Micron Technology) — only DRAM/NAND/HBM, no HDD/storage.
  * PRIORITY 3 — TSMC (TSM) acceptable as leading-edge foundry peer for EV/EBITDA comparison.
  * FORBIDDEN PEERS for pure DRAM/HBM companies — DO NOT SELECT:
    - WDC (Western Digital): HDD + NAND mixed business → EV/EBITDA structurally distorted (HDD cyclicality inflates multiples). Not comparable to DRAM/HBM pure-play.
    - STX (Seagate): HDD-only company → completely different business model.
    - SMCI (Super Micro Computer): Server assembler/AI infrastructure, not memory manufacturer → EV/EBITDA not comparable.
    - INTC (Intel): Diversified CPU/GPU/foundry → memory is minor segment.
  * If fewer than 3 pure-play memory peers exist, supplement with: AMAT, KLAC (semiconductor equipment), or ASML — but flag as "supply chain peer, not direct competitor".

- For pipeline-only biotechs (pre-revenue or minimal revenue), prefer peers that are also pre-revenue or early-commercial stage with similar therapeutic area and modality (RNA, cell therapy, small molecule, etc.)
- If a strictly comparable peer set cannot be found in Korea, include 1-2 US-listed peers of similar stage and modality.

- PCB / MLB(Multi-Layer Board) / 서브스트레이트 / FPCB(연성회로기판) 제조사 규칙 (이수페타시스·대덕전자·코리아써키트·심텍·인터플렉스 등에 적용):
  * PRIORITY PEERS: 대덕전자(353200.KS), 코리아써키트(007810.KS), 심텍(222800.KQ), 인터플렉스(051370.KQ), TTM Technologies(TTMI), Tripod Technology(3044.TW)
  * ACCEPTABLE: 삼성전기(009150.KS) — PCB·MLCC 겸업, 전자부품 공급망 피어로 유효
  * ❌ FORBIDDEN PEERS for PCB/기판 companies:
    - 방산·항공우주 업체: 한화에어로스페이스(012450.KS), 한화시스템(272210.KQ), KAI(047810.KS), LIG넥스원(079550.KS), 한화오션(042660.KS) — PCB 납품 고객사이지 경쟁사 아님
    - 소비자 가전 완성품 업체: 삼성전자(005930.KS), LG전자(066570.KS) — 부품 수요자이지 PCB 제조 경쟁사 아님
    - 반도체 팹·패키징: TSMC(TSM), DB하이텍(000990.KS), 하나마이크론(067310.KQ) — 제조 공정 완전 상이

- GLOBAL PEER → KOREAN STOCK NOTE: When any non-Korean (US/global) peer is selected for a Korean company, apply the peer multiples directly without a structural market discount.

Return a JSON object with this exact schema:
{"peers": [{"ticker": "005930.KS", "name": "삼성전자", "exchange": "KOSPI", "reason": "동일 메모리 반도체 시장 경쟁사, PER/EV/EBITDA 비교 유효"}, ...]}

CRITICAL ticker format rules — Yahoo Finance tickers only:
- KOSPI stocks: 6-digit + ".KS"  (e.g., 005930.KS=삼성전자, 068270.KS=셀트리온, 207940.KS=삼성바이오로직스, 000660.KS=SK하이닉스)
- KOSDAQ stocks: 6-digit + ".KQ" (e.g., 086900.KQ=메디오젠, 196170.KQ=알테오젠)
- US NASDAQ/NYSE stocks: plain ticker (e.g., AMGN, REGN, MRNA, NVO, PFE, JNJ)
- Swiss SIX stocks: ticker + ".SW"  (e.g., SDZ.SW=Sandoz, NOVN.SW=Novartis, ROG.SW=Roche)
- Tokyo TSE stocks: 4-digit + ".T"  (e.g., 4502.T=Takeda, 4503.T=Astellas)
- Hong Kong HKEX: ticker + ".HK"    (e.g., 0941.HK=China Mobile)
- London LSE: ticker + ".L"         (e.g., AZN.L=AstraZeneca)
- Do NOT use .KO — invalid. Prefer KS/KQ for Korean stocks.
- STRONGLY PREFER Korean or US-listed peers (best Yahoo Finance coverage). Swiss/European peers only if no closer Korean/US alternative.
- reason: 이 기업이 유의미한 피어인 이유를 1~2문장으로 한국어로 설명 (사업 유사성, 경쟁 관계, 밸류에이션 비교 근거 중심)`;

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are a financial analyst. Respond with a valid JSON object only. No explanation, no markdown, just the JSON.",
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        // thinking 모드 비활성화 — 사고 토큰이 resp.text에 섞이면 JSON 파싱 실패
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const raw = resp.text ?? "";

    // 다중 폴백 JSON 추출
    let parsed: any = null;

    // 1. 직접 파싱 (가장 깨끗한 경우)
    try { parsed = JSON.parse(raw); } catch { /* 다음 시도 */ }

    // 2. 코드펜스·앞뒤 공백 제거 후 파싱
    if (!parsed?.peers) {
      parsed = extractJsonSafe(raw);
    }

    // 3. "peers" 키를 기준으로 서브스트링 추출
    if (!parsed?.peers) {
      const peersIdx = raw.indexOf('"peers"');
      if (peersIdx !== -1) {
        const braceStart = raw.lastIndexOf("{", peersIdx);
        const braceEnd = raw.indexOf("]", peersIdx);
        if (braceStart !== -1 && braceEnd !== -1) {
          // 닫는 ] 뒤에 }를 붙여 완전한 JSON 만들기
          const candidate = raw.slice(braceStart, braceEnd + 1) + "}";
          try { parsed = JSON.parse(candidate); } catch { /* 실패 */ }
        }
      }
    }

    // 4. 개별 ticker 패턴으로 최소 구성
    if (!parsed?.peers) {
      const tickerPattern = /["']ticker["']\s*:\s*["']([^"']+)["']/g;
      const namePattern = /["']name["']\s*:\s*["']([^"']+)["']/g;
      const reasonPattern = /["']reason["']\s*:\s*["']([^"']+)["']/g;
      const tickers = [...raw.matchAll(tickerPattern)].map(m => m[1]);
      const names = [...raw.matchAll(namePattern)].map(m => m[1]);
      const reasons = [...raw.matchAll(reasonPattern)].map(m => m[1]);
      if (tickers.length >= 2) {
        parsed = {
          peers: tickers.map((t, i) => ({
            ticker: t,
            name: names[i] ?? t,
            exchange: t.endsWith(".KS") ? "KOSPI" : t.endsWith(".KQ") ? "KOSDAQ" : "NYSE/NASDAQ",
            reason: reasons[i] ?? "피어 비교",
          }))
        };
        console.log(`[peer-select] Fallback regex extracted ${tickers.length} tickers`);
      }
    }

    if (parsed?.peers && Array.isArray(parsed.peers) && parsed.peers.length > 0) {
      // 분석 대상 기업 자체가 피어에 포함된 경우 제거 (ticker 또는 회사명 일치 모두 체크)
      const subjectTickerUpper = subjectTicker.toUpperCase();
      const filtered = parsed.peers.filter((p: any) => {
        const t = (p.ticker ?? "").toUpperCase();
        const n = (p.name ?? "").toUpperCase();
        if (subjectTickerUpper && t === subjectTickerUpper) return false;
        if (n === companyName.toUpperCase()) return false;
        if (p.reason?.includes("분석 대상")) return false;
        return true;
      });
      const raw_final = (filtered.length > 0 ? filtered : parsed.peers).slice(0, 5);

      // ── KRX 캐시로 한국 티커 교정 (.KS/.KQ 오류 방지) ──────────────────────
      const final = raw_final.map((p: any) => {
        const corrected = correctKoreanTicker(p.ticker ?? "");
        if (corrected !== p.ticker) {
          const newExchange = corrected.endsWith(".KS") ? "KOSPI" : "KOSDAQ";
          console.log(`[peer-select] Ticker corrected: ${p.ticker} → ${corrected} (${p.name})`);
          return { ...p, ticker: corrected, exchange: newExchange };
        }
        return p;
      });

      console.log(`[peer-select] Success: ${final.length} peers — ${final.map((p: any) => p.ticker).join(", ")}`);
      return final;
    }
    console.warn(`[peer-select] No valid peers in response (raw len=${raw.length}): ${JSON.stringify(parsed)?.slice(0, 200)}`);
  } catch (err) {
    console.error("[peer-select] Failed:", err);
  }
  return [];
}

async function fetchPeerFinancials(
  peers: Array<{ ticker: string; name: string; exchange: string; reason?: string }>
): Promise<string> {
  if (peers.length === 0) return "";

  // ── KIS 실시간 선조회: 한국 피어 종목 코드 추출 후 일괄 요청 ──────────────
  const koreanPeerMap = new Map<string, string>(); // ticker → 6-digit code
  for (const p of peers) {
    const m = p.ticker.match(/^(\d{6})\.(KS|KQ)$/i);
    if (m) koreanPeerMap.set(p.ticker, m[1]);
  }
  const kisQuotes = koreanPeerMap.size > 0
    ? await fetchKISStockQuotes([...koreanPeerMap.values()]).catch(() => new Map())
    : new Map();

  const rows: string[] = [];
  rows.push("\n=== 피어 그룹 실시간 재무 데이터 (Yahoo Finance + KIS 실시간) ===");
  rows.push("※ 아래 피어 기업들의 실제 수치를 Part B 상대가치 분석 표에 그대로 인용하세요. 피어 이름을 'Peer A/B/C/D' 등 플레이스홀더로 쓰지 말고 실제 회사명을 사용하세요.\n");

  // 오늘 날짜(KST) 기반 캐시 키 — 같은 날 모든 분석에서 동일한 피어 데이터 보장
  const today = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })
    .replace(/\. /g, "-").replace(/\.$/, ""); // "2026. 5. 18." → "2026-5-18"

  type PeerResult = {
    line: string; ticker: string; name: string;
    ev_ebitda: number | null; per_trailing: number | null; per_fwd: number | null;
    ev_sales: number | null; pbr: number | null;
  };

  const results = await Promise.allSettled(
    peers.map(async (peer) => {
      // ── 일간 캐시 확인 ─────────────────────────────────────────────────────
      const cacheKey = `peer-fin:${peer.ticker}:${today}`;
      const cached = cache.get<PeerResult>(cacheKey);
      if (cached) {
        console.log(`[peer-fin] 캐시 히트: ${peer.name} (${peer.ticker})`);
        // 캐시된 line은 reason 없이 저장됨 — 현재 분석의 reason이 있으면 삽입
        if (peer.reason) {
          const lines = cached.line.split("\n");
          lines.splice(1, 0, `  선정 이유: ${peer.reason}`);
          return { ...cached, line: lines.join("\n") };
        }
        return cached;
      }

      try {
        // quoteSummary + quote() 병렬 호출 — balanceSheetHistory·earningsTrend 추가로 멀티플 직접 계산 가능
        const [summaryResult, quoteResult] = await Promise.allSettled([
          yahooFinance.quoteSummary(peer.ticker, {
            modules: [
              "defaultKeyStatistics",
              "financialData",
              "summaryDetail",
              "price",
              "incomeStatementHistory",
              "balanceSheetHistory",
              "earningsTrend",
            ] as any,
          }),
          yahooFinance.quote(peer.ticker),
        ]);

        const summary = summaryResult.status === "fulfilled" ? summaryResult.value : {};
        const quote: any = quoteResult.status === "fulfilled" ? quoteResult.value : {};

        const ks: any = (summary as any).defaultKeyStatistics ?? {};
        const fd: any = (summary as any).financialData ?? {};
        const sd: any = (summary as any).summaryDetail ?? {};
        const pr: any = (summary as any).price ?? {};
        const is: any = (summary as any).incomeStatementHistory ?? {};
        const bs: any = (summary as any).balanceSheetHistory ?? {};
        const et: any = (summary as any).earningsTrend ?? {};

        const pct = (v: number | null | undefined) =>
          v != null ? `${(v * 100).toFixed(1)}%` : "N/A";
        const fmt1 = (v: number | null | undefined) =>
          v != null ? v.toFixed(1) : "N/A";
        const fmt2 = (v: number | null | undefined) =>
          v != null ? v.toFixed(2) : "N/A";
        const fmtAbs = (v: number | null | undefined, isKrw: boolean) => {
          if (v == null) return "N/A";
          if (isKrw) return `${(v / 1e8).toFixed(0)}억원`;
          return `${(v / 1e9).toFixed(1)}B`;
        };

        // ── KIS 실시간 데이터 (한국 피어 전용) ───────────────────────────────
        const kisCode = koreanPeerMap.get(peer.ticker);
        const kis = kisCode ? kisQuotes.get(kisCode) : null;

        // 시가총액 & 가격
        const currency = quote.currency ?? pr.currency ?? (peer.ticker.endsWith(".KS") || peer.ticker.endsWith(".KQ") ? "KRW" : "USD");
        const isKrw = currency === "KRW";
        const price = kis?.price ?? quote.regularMarketPrice ?? pr.regularMarketPrice ?? null;
        // KIS 시가총액(억원) → 원 변환 (가장 신뢰도 높음)
        const kisMcap = kis?.mcap != null && kis.mcap > 0 ? kis.mcap * 1e8 : null;
        // Yahoo Finance 시가총액 (원 단위, KRW 종목)
        const yahooMcap = quote.marketCap ?? pr.marketCap ?? sd.marketCap ?? null;
        // price × sharesOutstanding 역산 fallback (KIS 실시간 주가 × KIS 상장주식수)
        const calcMcap = (kis?.price && kis.sharesOutstanding)
          ? kis.price * kis.sharesOutstanding
          : (price && (quote as any).sharesOutstanding)
            ? price * (quote as any).sharesOutstanding
            : null;
        let mcap = kisMcap ?? yahooMcap ?? calcMcap;
        // Yahoo가 원 단위인데 너무 작으면(1,000억원 미만) 역산 결과로 교체
        if (isKrw && mcap != null && mcap < 1e11 && calcMcap != null && calcMcap > mcap) {
          console.warn(`[peer-data] ${peer.name} mcap 이상 보정: ${(mcap/1e8).toFixed(0)}억원 → ${(calcMcap/1e8).toFixed(0)}억원 (price×shares 역산)`);
          mcap = calcMcap;
        }
        // 억원 단위로 통일 — AI 프롬프트 표 헤더 "시가총액(억원)"과 단위 일치
        const mcapEokStr = mcap && isKrw
          ? `${Math.round(mcap / 1e8).toLocaleString("ko-KR")}억원`
          : null;
        const mcapStr = mcap
          ? isKrw
            ? `${mcapEokStr}` +
              (mcap >= 1e12 ? ` (≈${(mcap / 1e12).toFixed(2)}조원)` : "")
            : `${(mcap / 1e9).toFixed(1)}B ${currency}`
          : "N/A";

        // ── 원시 재무 데이터 ────────────────────────────────────────────────
        const latestIS = is.incomeStatementHistory?.[0] ?? null;
        const latestBS = bs.balanceSheetStatements?.[0] ?? null;

        const totalRevenue  = fd.totalRevenue  ?? latestIS?.totalRevenue  ?? null;
        const ebitda        = fd.ebitda        ?? null;
        const netIncome     = latestIS?.netIncome     ?? fd.netIncomeToCommon ?? null;
        const opIncome      = latestIS?.operatingIncome ?? null;
        const totalEquity   = latestBS?.totalStockholderEquity ?? latestBS?.stockholdersEquity ?? null;
        const totalDebt     = latestBS?.longTermDebt != null
                              ? (latestBS.longTermDebt + (latestBS.shortLongTermDebt ?? 0) + (latestBS.currentPortionOfLongTermDebt ?? 0))
                              : latestBS?.totalLiab ?? null;
        const cash          = latestBS?.cash ?? latestBS?.cashAndShortTermInvestments ?? latestBS?.cashAndCashEquivalents ?? null;

        // ── 멀티플: 직접 제공 → 계산 폴백 순서 ──────────────────────────
        // PER Fwd: earningsTrend '0y'/'+1y' → quote.forwardPE
        let fwdPE: number | null = ks.forwardPE ?? sd.forwardPE ?? (quote as any).forwardPE ?? null;
        if (fwdPE == null && price != null) {
          const trend1y = et.trend?.find((t: any) => t.period === "+1y");
          const trend0y = et.trend?.find((t: any) => t.period === "0y");
          const fwdEps = trend1y?.earningsEstimate?.avg ?? trend0y?.earningsEstimate?.avg ?? null;
          if (fwdEps != null && fwdEps > 0) fwdPE = price / fwdEps;
        }

        // PER TTM: KIS(한국) → Yahoo → price/EPS → mcap/순이익
        let trailPE: number | null = null;
        if (kis?.per != null && kis.per > 0 && kis.per < 500) {
          trailPE = kis.per;
        } else {
          trailPE = sd.trailingPE ?? ks.trailingPE ?? (quote as any).trailingPE ?? null;
          if (trailPE == null && price != null) {
            const eps = (quote as any).epsTrailingTwelveMonths ?? null;
            if (eps != null && eps > 0) trailPE = price / eps;
          }
          if (trailPE == null && mcap != null && netIncome != null && netIncome > 0) {
            trailPE = mcap / netIncome;
          }
        }

        // PBR: KIS(한국) → Yahoo Finance → Naver Finance → market cap / 자본총계
        let pbr: number | null = null;
        if (kis?.pbr != null && kis.pbr > 0) {
          pbr = kis.pbr;
        } else {
          pbr = ks.priceToBook ?? (quote as any).priceToBook ?? null;
        }
        if (pbr == null) {
          const koreanMatch = peer.ticker.match(/^(\d{6})\.(KS|KQ)$/i);
          if (koreanMatch) {
            try {
              // 1차: /basic (일반 기업 대부분)
              const nb = await fetch(
                `https://m.stock.naver.com/api/stock/${koreanMatch[1]}/basic`,
                { headers: NAVER_HEADERS, signal: AbortSignal.timeout(5000) }
              ).then(r => r.ok ? r.json() : null);
              const rawBasic = nb?.pbr;
              if (rawBasic != null) {
                const n = typeof rawBasic === "number" ? rawBasic : parseFloat(String(rawBasic).replace(/,/g, ""));
                if (!isNaN(n) && n > 0) { pbr = n; }
              }
              // 2차: /integration totalInfos (금융지주·은행 등 /basic PBR 미제공 종목 fallback)
              if (pbr == null) {
                const ni = await fetch(
                  `https://m.stock.naver.com/api/stock/${koreanMatch[1]}/integration`,
                  { headers: NAVER_HEADERS, signal: AbortSignal.timeout(5000) }
                ).then(r => r.ok ? r.json() : null);
                if (ni) {
                  const infoMap: Record<string, string> = {};
                  for (const item of (ni.totalInfos ?? [])) infoMap[item.code] = item.value ?? "";
                  if (infoMap.pbr) {
                    const n = parseFloat(String(infoMap.pbr).replace(/[^0-9.]/g, ""));
                    if (!isNaN(n) && n > 0) { pbr = n; }
                  }
                  // PER(TTM) fallback도 함께 수집 — 금융주는 KIS/Yahoo PER이 null인 경우가 많음
                  if (trailPE == null && infoMap.per) {
                    const n = parseFloat(String(infoMap.per).replace(/[^0-9.]/g, ""));
                    if (!isNaN(n) && n > 0) { trailPE = n; }
                  }
                }
              }
            } catch { /* optional */ }
          }
        }
        if (pbr == null && mcap != null && totalEquity != null && totalEquity > 0) {
          pbr = mcap / totalEquity;
        }

        // EV 계산: enterpriseValue 직접 제공 → market cap + 순부채
        const ev: number | null = ks.enterpriseValue != null
          ? ks.enterpriseValue
          : (quote as any).enterpriseValue != null
            ? (quote as any).enterpriseValue
            : (mcap != null && totalDebt != null && cash != null)
              ? mcap + totalDebt - cash
              : null;

        // EV/EBITDA: 직접 → 계산
        let evEbitda: number | null = ks.enterpriseToEbitda ?? null;
        if (evEbitda == null && ev != null && ebitda != null && ebitda > 0) {
          evEbitda = ev / ebitda;
        }

        // EV/매출
        let evRev: number | null = ks.enterpriseToRevenue ?? null;
        if (evRev == null && ev != null && totalRevenue != null && totalRevenue > 0) {
          evRev = ev / totalRevenue;
        }

        // ── 수익성 ────────────────────────────────────────────────────────
        // KIS ROE는 % 단위(예: 15.3) → 소수(0.153) 변환, Yahoo는 이미 소수 형태
        const kisRoe = kis?.roe != null && !isNaN(kis.roe) ? kis.roe / 100 : null;
        const roe = fd.returnOnEquity
          ?? kisRoe
          ?? (netIncome != null && totalEquity != null && totalEquity > 0 ? netIncome / totalEquity : null);
        const opMargin = fd.operatingMargins
          ?? (opIncome != null && totalRevenue != null && totalRevenue > 0 ? opIncome / totalRevenue : null);
        const revGrowth  = fd.revenueGrowth  ?? null;
        const grossMargin = fd.grossMargins  ?? null;
        const netMargin  = fd.profitMargins
          ?? (netIncome != null && totalRevenue != null && totalRevenue > 0 ? netIncome / totalRevenue : null);

        // 아웃라이어 감지를 위해 원시 배수도 반환
        // ⚠️ line에서 선정 이유(reason)는 제외하고 캐싱 — 분석마다 달라질 수 있음
        const lineBase = [
          `[${peer.name} (${peer.ticker}) — ${peer.exchange ?? ""}]`,
          `  시가총액: ${mcapStr}${price ? ` | 현재가: ${isKrw ? Math.round(price).toLocaleString() : price.toFixed(2)} ${currency}` : ""}`,
          `  PER(Fwd): ${fmt1(fwdPE)}x | PER(TTM): ${fmt1(trailPE)}x | PBR: ${fmt2(pbr)}x | EV/EBITDA: ${fmt1(evEbitda)}x | EV/매출: ${fmt2(evRev)}x`,
          `  ROE: ${pct(roe)} | 영업이익률: ${opm(opMargin)} | 순이익률: ${pct(netMargin)} | 매출총이익률: ${pct(grossMargin)} | 매출성장률(YoY): ${pct(revGrowth)}`,
          `  매출(TTM): ${fmtAbs(totalRevenue, isKrw)} | 영업이익: ${fmtAbs(opIncome, isKrw)} | 순이익: ${fmtAbs(netIncome, isKrw)} | EBITDA: ${fmtAbs(ebitda, isKrw)}`,
          `  자본총계: ${fmtAbs(totalEquity, isKrw)} | 총부채: ${fmtAbs(totalDebt, isKrw)} | 현금: ${fmtAbs(cash, isKrw)}`,
        ].filter(Boolean).join("\n");

        const result: PeerResult = {
          // 캐시 히트 시 reason 줄을 재삽입할 수 있도록 lineBase만 저장
          line: peer.reason
            ? `[${peer.name} (${peer.ticker}) — ${peer.exchange ?? ""}]\n  선정 이유: ${peer.reason}\n` +
              lineBase.split("\n").slice(1).join("\n")
            : lineBase,
          ticker: peer.ticker,
          name: peer.name,
          ev_ebitda: evEbitda,
          per_trailing: trailPE,
          per_fwd: fwdPE,
          ev_sales: evRev,
          pbr,
        };

        // 숫자 데이터가 하나라도 있을 때만 캐시 저장 (실패 결과는 캐싱 안 함)
        if (evEbitda != null || trailPE != null || pbr != null || mcap != null) {
          // lineBase를 캐시에 저장 (reason 제외), 이후 캐시 히트 시 reason 재삽입
          const cachePayload: PeerResult = { ...result, line: lineBase };
          cache.set(cacheKey, cachePayload, TTL.PEER_FINANCIALS);
          console.log(`[peer-fin] 캐시 저장: ${peer.name} (${peer.ticker})`);
        }

        return result;
      } catch (err) {
        return {
          line: `[${peer.name} (${peer.ticker})] 데이터 수집 실패: ${String(err).slice(0, 120)}`,
          ticker: peer.ticker, name: peer.name,
          ev_ebitda: null, per_trailing: null, per_fwd: null, ev_sales: null, pbr: null,
        };
      }
    })
  );

  // ── 서버 사이드 아웃라이어 감지 ──────────────────────────────────────────────
  // 1차: 절대값 상한, 2차: 중간값 2.0배 기준 → AI에 미리 경고 전달
  // "너무 차이나는 것만" 원칙 — 프리미엄 글로벌 기업 정상 배수 보존
  const OUTLIER_CAPS: Record<string, number> = {
    ev_ebitda: 80, per_trailing: 120, per_fwd: 120, ev_sales: 20, pbr: 150,
  };
  type PeerRow = { ticker: string; name: string; ev_ebitda: number | null; per_trailing: number | null; per_fwd: number | null; ev_sales: number | null; pbr: number | null };
  const peerRows: PeerRow[] = results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<any>).value as PeerRow);

  const outlierWarnings: string[] = [];
  const keys = ["ev_ebitda", "per_trailing", "per_fwd", "ev_sales", "pbr"] as const;
  for (const key of keys) {
    // 절대 상한 통과한 유효값 수집
    const valids: Array<{ ticker: string; name: string; v: number }> = [];
    for (const p of peerRows) {
      const v = p[key];
      if (v == null || !isFinite(v) || v <= 0) continue;
      if (v > OUTLIER_CAPS[key]) {
        outlierWarnings.push(`⛔ ${p.name}(${p.ticker}) ${key.toUpperCase().replace("_", "/")} = ${v.toFixed(1)}x → 절대 상한(${OUTLIER_CAPS[key]}x) 초과 이상치 → 중간값 계산 및 적용 배수에서 제외`);
      } else {
        valids.push({ ticker: p.ticker, name: p.name, v });
      }
    }
    if (valids.length < 2) continue;
    const sorted = [...valids].sort((a, b) => a.v - b.v);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 !== 0 ? sorted[mid].v : (sorted[mid - 1].v + sorted[mid].v) / 2;
    for (const { ticker, name, v } of valids) {
      if (v > med * 3.0) {
        outlierWarnings.push(`⚠️ ${name}(${ticker}) ${key.toUpperCase().replace("_", "/")} = ${v.toFixed(1)}x → 피어 중간값(${med.toFixed(1)}x)의 3.0배 초과 이상치 → 중간값 계산에서 제외`);
      }
    }
  }

  if (outlierWarnings.length > 0) {
    rows.push("⚠️ [서버 감지 피어 이상치 — AI는 아래 기업을 해당 배수의 평균/중간값 계산에서 반드시 제외하고 표에 \"(이상치 제외)\" 표기]");
    for (const w of outlierWarnings) rows.push(`  ${w}`);
    rows.push("");
  }

  for (const r of results) {
    if (r.status === "fulfilled") {
      rows.push(r.value.line);
    } else {
      rows.push(`[데이터 오류] ${(r as any).reason}`);
    }
    rows.push("");
  }

  const text = rows.join("\n");
  console.log(`[peer-data] Fetched ${peers.length} peers, ${outlierWarnings.length} outliers detected, ${text.length} chars`);
  return text;
}

// ─── Raw SQL helpers (production-safe: bypasses drizzle CJS bundle issues) ───
async function rawQuery<T = any>(sqlText: string, params: any[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sqlText, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

function mapAnalysisRow(row: any): typeof analysesTable.$inferSelect {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    ticker: row.ticker,
    companyName: row.company_name,
    englishName: row.english_name ?? null,
    industry: row.industry,
    additionalContext: row.additional_context ?? null,
    status: row.status,
    currentStep: row.current_step ?? null,
    investmentVerdict: row.investment_verdict ?? null,
    targetPrice: row.target_price ?? null,
    startPrice: row.start_price ?? null,
    entryPrice: row.entry_price ?? null,
    stopLoss: row.stop_loss ?? null,
    riskRewardRatio: row.risk_reward_ratio ?? null,
    memo: row.memo ?? null,
    isPublic: row.is_public ?? "true",
    userRating: row.user_rating ?? null,
    userFeedback: row.user_feedback ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    language: row.language ?? "ko",
  } as any;
}

function mapStepRow(row: any): typeof analysisStepsTable.$inferSelect {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    stepKey: row.step_key,
    agentName: row.agent_name,
    agentRole: row.agent_role,
    content: row.content,
    validationNotes: row.validation_notes ?? null,
    informationType: row.information_type ?? "data_based_estimate",
    createdAt: row.created_at,
  } as typeof analysisStepsTable.$inferSelect;
}

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
        res.status(400).json({ error: "한국(KOSPI·KOSDAQ) 및 미국(NYSE·NASDAQ·AMEX) 상장 주식만 분析 가능합니다. 해당 종목은 지원하지 않는 거래소에 상장되어 있습니다." });
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
  const upperTicker = /^\d{6}\.(KS|KQ)$/.test(rawUpperTicker)
    ? rawUpperTicker.split(".")[0]
    : rawUpperTicker;
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
  const krxCode = upperTicker.split(".")[0];
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
  // 이 구조로 "분析 시작" 버튼 클릭 후 분析 페이지까지 대기 시간이 ~1초로 단축
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
    res.status(500).json({ error: "분析 시작 실패: DB INSERT 오류", detail: pgMsg });
    return;
  }

  // 즉시 응답 — 분析 페이지로 바로 이동
  res.json(formatAnalysis(analysis, []));

  // ── 백그라운드: 외부 API 12개 병렬 수집 → DB 업데이트 → 파이프라인 시작 ──
  const _analysisId = analysis.id;
  pendingDataFetch.add(_analysisId);
  console.log(`[analysis-create] #${_analysisId} 즉시 응답 완료 — 백그라운드 데이터 수집 시작`);

  (async () => {
    try {
      const needsSOTPData = isKoreanTicker && hasSOTPSubsidiaryData(krxCode);
      const [financialData, newsData, dartBalance, ecosMacro, fredMacro, startQuote, kisResult, dartHistorical, kosisData, sotpSubsidiaryContext, dartBizContent, secEdgarContent] = await Promise.all([
        fetchFinancialContext(resolvedSymbol),
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
        let netDebtStr: string;
        if (dartBalance.totalDebt != null && dartBalance.cash != null) {
          const netDebt = dartBalance.totalDebt - dartBalance.cash;
          netDebtStr = netDebt < 0
            ? `${fmtKrw(-netDebt)} (순현금)  ← DCF 주주가치 환산 시 이 값 사용`
            : `${fmtKrw(netDebt)} (순부채)  ← DCF 주주가치 환산 시 이 값 사용`;
        } else if (dartBalance.cash != null && dartBalance.totalDebt == null) {
          netDebtStr = `금융부채 항목 미검출 (차입금·사채 계정이 DART 별도 항목으로 존재하지 않을 수 있음) — Yahoo Finance "[⚡ WACC·EBITDA 계산 핵심 데이터]" 섹션의 총부채(Total Debt) 수치로 보완하세요. 보완 후: 순현금 = 현금 ${fmtKrw(dartBalance.cash)} − Yahoo총부채`;
        } else {
          netDebtStr = "N/A";
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
          `부채총계(DART전체): ${fmtKrw(dartBalance.totalLiab)}  ※ 매입채무·충당부채 등 영업부채 포함, 순현금 계산엔 금융부채만 사용`,
          `자본총계: ${fmtKrw(dartBalance.equity)}`,
          dartBalance.totalDebt != null ? `금융부채(차입금+사채+리스 합계): ${fmtKrw(dartBalance.totalDebt)}` : `금융부채: 개별 차입금·사채 항목 미검출 (무차입/소액 차입 가능성)`,
          `순현금/순부채: ${netDebtStr}`,
          ...constructionLines,
        ].filter(Boolean).join("\n");
      }

      const userContext = additionalContext ?? null;
      const macroContext = isKoreanTicker ? buildECOSContext(ecosMacro) : buildFREDContext(fredMacro);
      const kosisContext = isKoreanTicker ? buildKOSISContext(kosisData, industry ?? "") : null;
      const fullContext = [
        kisContext, sotpSubsidiaryContext, financialData, dartBalanceContext,
        dartHistorical,
        dartBizContent
          ? `[⭐ DART 사업보고서 사업내용 — 시장규모·TAM·업계현황·파이프라인 1순위 근거]\n` +
            `※ 아래 내용은 DART 공시 원문입니다. 시장 규모·TAM 추정·업계 현황 서술 시 훈련 데이터보다 이 수치를 우선 사용하세요.\n\n` +
            dartBizContent
          : null,
        secEdgarContent, kosisContext, macroContext, newsData,
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

// QA/피어 컬럼 초기화 — 서버 기동 후 최초 1회만 실행 (pool 낭비 방지)
let _qaPeerColumnsReady = false;
async function ensureQaPeerColumns(): Promise<void> {
  if (_qaPeerColumnsReady) return;
  await Promise.all([
    pool.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS qa_score INTEGER, ADD COLUMN IF NOT EXISTS qa_flags TEXT`),
    pool.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS peer_flags TEXT`),
  ]);
  _qaPeerColumnsReady = true;
}

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
    const snapKrxCode = snapTicker.split(".")[0];
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

        // ② AI 피어 선정: DART 힌트 주입 + 부족한 피어 보완
        let peers = await selectPeerTickers(snapName, snapIndustry, prevCtx, snapTicker, dartHint);
        if (peers.length === 0) {
          peers = await selectPeerTickers(snapName, snapIndustry ?? "일반", prevCtx.slice(0, 3000), snapTicker, dartHint);
        }
        if (peers.length === 0 && !/^\d{6}/.test(snapTicker)) {
          const mapped = US_PEER_MAP[snapTicker.toUpperCase()];
          if (mapped?.length) peers = mapped;
        }

        // ③ DART seed 피어를 최우선 병합 (중복 제거)
        if (dartSeedPeers.length > 0) {
          const aiTickers = new Set(peers.map(p => p.ticker));
          const dartOnly = dartSeedPeers.filter(p => !aiTickers.has(p.ticker));
          // DART 피어 앞에 배치 (피어 테이블에서 먼저 보이도록)
          peers = [...dartOnly, ...peers].slice(0, 6); // 최대 6개
          console.log(`[pre-fetch-peers] 최종 피어 (DART+AI): ${peers.map(p => p.name).join(", ")}`);
        }

        const data = peers.length > 0 ? await fetchPeerFinancials(peers) : "";
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
            const spRow = await rawQuery(`SELECT start_price, ticker FROM analyses WHERE id=$1`, [id]);
            const sp: number = spRow[0]?.start_price ?? 0;
            const tkr: string = spRow[0]?.ticker ?? "";
            const isKRtk = /^\d{6}$/.test(tkr);

            // 중앙값 클램핑 제거: AI 결론 본문과 DB 저장값 불일치 원인
            // 비율 가드(0.45x~3.5x)만으로 극단값 방지
            const originalTp = rawTp;
            const medianCorrected = false;

            if (rawTp > 0 && sp > 0) {
              const MAX_R = isKRtk ? 2.5 : 4.0;
              const MIN_R = isKRtk ? 0.45 : 0.25;
              const ratio = rawTp / sp;
              const validated = ratio > MAX_R ? Math.round(sp * MAX_R)
                             : ratio < MIN_R ? Math.round(sp * MIN_R)
                             : Math.round(rawTp);
              // corrected = true if ANY adjustment occurred (median clamp OR ratio clamp)
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
                      : `※ AI 원산출값 ${fmtTp(Math.round(originalTp))}이 합리성 한도(현재가 대비 ${MIN_R}x~${MAX_R}x) 초과로 ${fmtTp(validated)}으로 자동 보정됨\n`)
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
      const tickerKrxCode = analysis.ticker.split(".")[0];
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

      // ── 밸류에이션 모델 선택 가이드라인 주입 ──────────────────────────────────
      // 재무 데이터 기반으로 부적절한 모델 사용을 사전 차단
      {
        const guideLines: string[] = [];
        const ind = (analysis.industry ?? "").toLowerCase();
        const isBio = /바이오|제약|헬스케어|세포치료|줄기세포|biotech|pharma|healthcare/i.test(ind);
        const isFinancial = /금융|은행|보험|증권|financ|bank|insur/i.test(ind);
        const isNewSpace = /우주|항공|aerospace|space|defense|방위/i.test(ind);
        const isBattery = /2차전지|배터리|battery|lges|lg에너지|삼성sdi|sk이노베이션|sk온|catl|파나소닉 에너지|에코프로비엠|포스코퓨처엠/i.test(ind) ||
          /2차전지|배터리|battery|lges|lg에너지|삼성sdi|sk이노베이션|sk온|catl|파나소닉 에너지|에코프로비엠|포스코퓨처엠/i.test(analysis.companyName ?? "");

        guideLines.push(`\n[🎯 밸류에이션 모델 선택 필수 가이드라인]`);
        guideLines.push(`⚠️ 아래 규칙을 반드시 준수하세요. 위반 시 QC 불승인.`);

        if (isBio) {
          guideLines.push(`· 업종(${analysis.industry}): 바이오/제약 → rNPV(SOTP) 우선 사용. PBR 가중 30% 이상 금지.`);
          guideLines.push(`· rNPV 할인율: 8~12% 범위 (PoS가 이미 임상 위험 반영 — 15% 초과 이중할인 금지)`);
          guideLines.push(`· 피어: 동일 임상 단계의 세포치료/바이오텍 기업 기준. 수익성 있는 대형 제약사와 직접 배수 비교 금지.`);
        } else if (isBattery) {
          guideLines.push(`· 업종(${analysis.industry}): 2차전지/배터리 → EV/GWh + EV/EBITDA 피어 비교를 주 모델(70% 가중). DCF는 보조(30%)로만 사용.`);
          guideLines.push(`· ⛔ STEP 0 Q1.5=YES(배터리 셀 제조사) 강제 적용 — EV/GWh 및 EV/EBITDA 피어 비교로 시작하세요. DCF 단독 사용은 치명적 오류.`);
          guideLines.push(`· GWh 용량 데이터 없으면: EV/EBITDA 피어 배수(삼성SDI, SK이노베이션, CATL 기준)를 주 모델로 대체 사용.`);
          guideLines.push(`· ⛔ 단위 오류 경고: 발행주식수 단위(주/천주)·기업가치 단위(원/억원/조원) 혼동 시 목표가가 1/10~1/1000 수준으로 오산됨. 주당가치 = 총기업가치(원) ÷ 발행주식수(주).`);
          guideLines.push(`· 피어 비교 의무: 삼성SDI, SK이노베이션을 기준 피어로 항상 포함하고, 반도체 기업(삼성전자·SK하이닉스)은 피어 대상에서 완전 제외.`);
        } else if (isFinancial) {
          guideLines.push(`· 업종(${analysis.industry}): 금융 → PBR·ROE 기반 모델 우선. DCF 시 배당 포함 여부 확인.`);
        } else if (isNewSpace) {
          guideLines.push(`· 업종(${analysis.industry}): 우주/항공/방위 → EV/Sales 우선. 발사체·플랫폼 옵션가치 별도 반영.`);
          guideLines.push(`· 뉴스페이스 섹터 EV/Sales: 시장 컨센서스 20~60x 범위 (SpaceX 비교군). 15x 미만 적용 시 근거 필수.`);
          guideLines.push(`· PBR 가중 30% 이상 금지 (자산 기반 평가 부적합).`);
        } else {
          guideLines.push(`· FCF 음수 + 고성장 기업: EV/Sales 우선, PBR 30% 이상 가중 금지.`);
          guideLines.push(`· FCF 양수 + 안정 성장: DCF 또는 PER 기반 모델 적합.`);
        }
        guideLines.push(`· 피어 배수 선택 시 현재 시장 내재 멀티플(위 컨텍스트 참조)의 25% 미만 배수 사용 금지.`);
        guideLines.push(`· 최종 목표주가(Base)는 현재가의 30% 미만 산출 시 QC 불승인 — 가정 재검토 필수.`);
        guideLines.push(`\n⛔ 수치 일관성 필수 (위반 시 QC 불승인):`);
        guideLines.push(`· 본문 결론에 기재한 Base 목표주가(숫자)와 FINAL_VALUATION_DATA.base 값이 반드시 동일한 숫자여야 합니다.`);
        guideLines.push(`· 예: 본문에 "적정주가 350,000원"이라고 썼다면 FINAL_VALUATION_DATA.base = 350000. 두 값이 다르면 QC 불승인.`);

        const guideBlock = guideLines.join("\n");
        enrichedContext = enrichedContext ? enrichedContext + "\n" + guideBlock : guideBlock;
        console.log(`[model-guide] 밸류에이션 모델 가이드라인 주입 (isBio=${isBio}, isBattery=${isBattery}, isNewSpace=${isNewSpace})`);
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

          let themeBlock = `\n\n[🚀 테마 프리미엄 보정 — 핫 테마 노출 감지: ${themeLabels}]\n`;
          themeBlock += `이 종목은 시장에서 고배수를 받는 핫 테마에 노출됩니다. 상대가치 평가 시 아래를 적용하세요:\n`;
          themeBlock += `① 전통 업종 피어 배수에 +${avgPremium}% 테마 프리미엄 가산\n`;
          themeBlock += `   - 근거: 해당 테마 사업부의 매출 기여도·공시된 성장 모멘텀을 정량적으로 제시할 것\n`;
          themeBlock += `   - 테마 가시성이 높을수록(계약·양산·고객사 발표 등) 프리미엄 범위 상향 가능\n`;
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

  const tickerMarket: "KR" | "US" = /^\d{6}$/.test(analysis.ticker) ? "KR" : "US";
  const sectorKey = classifySector(analysis.industry ?? "", tickerMarket);
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
    analysis.startPrice ?? null
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
                temperature: 0.2,
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
          `SELECT start_price, ticker FROM analyses WHERE id=$1`,
          [id]
        );
        savedStartPrice = startPriceRow[0]?.start_price ?? null;
        savedTicker = startPriceRow[0]?.ticker ?? "";
        const isKR = /^\d{6}$/.test(savedTicker);

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
          // ── 목표주가 상한 캡 제거 ──────────────────────────────────────────
          // FINAL_VALUATION_DATA.base는 AI가 DCF/rNPV+SOTP 단계에서 산출한 값으로,
          // 후처리 배수 캡이 오히려 밸류에이션 결과를 무력화하는 문제가 있었음.
          // (예: 10,660원 → FINAL_VALUATION_DATA.base 53,600원(5.03x) → 구 2.5x 캡으로 26,650원으로 잘림)
          // 캡이 필요하다면 valuation 프롬프트 단계에서 소프트 가드레일로 적용.
          //
          // ── 하한 플로어만 유지: DART 재무 데이터 부재 시 AI 오산출 방지 ──
          const TARGET_MIN_RATIO = isKR ? 0.45 : 0.25;
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
            } else {
              console.log(`[analysis ${id}] target_price ${targetPrice} (${tRatio.toFixed(2)}x startPrice ${savedStartPrice}) — 캡 없이 FINAL_VALUATION_DATA 원본 사용`);
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

        // 자동배치 분석(user_id IS NULL)이면 30초 후 AI 자체 검수 실행
        if (rows[0].user_id === null) {
          scheduleAnalysisSelfReview(id);
          console.log(`[pipeline-bg] analysis#${id} 자체 검수 스케줄 등록 (30초 후)`);
        }
      }
    } catch {}
  }
}

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

// ─── 피드백 텍스트 보안 정제 ──────────────────────────────────────────────────
// 프롬프트 인젝션 방지: 명령형 패턴·제어문자·특수 구문을 제거
function sanitizeFeedback(raw: string): string {
  let s = raw
    .replace(/[\x00-\x1f\x7f]/g, " ")           // 제어 문자 제거
    .replace(/[<>\[\]{}]/g, "")                   // 브라켓류 제거
    .replace(/^[\s#*\-=_]+/gm, "")               // 줄 시작 마크다운 제거
    .trim()
    .slice(0, 300);                               // 저장 한도보다 짧게 자름

  // 프롬프트 인젝션 키워드 치환 (한/영)
  const injectionPatterns: [RegExp, string][] = [
    [/무시\s*하고/gi,          "***"],
    [/지금부터\s*[^은는이가]/gi, "***"],
    [/항상\s*(매수|매도|추천)/gi, "***"],
    [/반드시\s*(매수|매도|추천)/gi, "***"],
    [/system\s*:/gi,           "***"],
    [/assistant\s*:/gi,        "***"],
    [/user\s*:/gi,             "***"],
    [/ignore\s+(all\s+)?previous/gi, "***"],
    [/forget\s+previous/gi,    "***"],
    [/\bINST\b|\bSYS\b|\bHUMAN\b/g, "***"],
    [/분석\s*(결과|무효|조작)/gi, "***"],
  ];
  for (const [pat, rep] of injectionPatterns) {
    s = s.replace(pat, rep);
  }
  return s;
}

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

/**
 * 프론트엔드 표시용 content 정제.
 * DB에는 원본(체인 연결용) 보존, API 응답에서만 내부 섹션 제거.
 */
function stripDisplayContent(raw: string): string {
  if (!raw) return raw;
  return raw
    // ── CHAIN-HANDOFF 전체 섹션 제거 (--- 구분선 포함) ─────────────────
    .replace(/\n?---\n+##\s*📊\s*\[CHAIN-HANDOFF\][^\n]*\n[\s\S]*$/m, "")
    .replace(/\n?##\s*📊\s*\[CHAIN-HANDOFF\][^\n]*\n[\s\S]*$/m, "")
    // ── [CHAIN-HANDOFF] 레이블이 인라인으로 남은 경우 ────────────────────
    .replace(/\[CHAIN-HANDOFF\][^\n]*/g, "")
    // ── 체인 인계 규칙 선언 줄 ────────────────────────────────────────────
    .replace(/^📌\s*\*{0,2}\[체인 인계 규칙[^\]]*\][^\n]*/gm, "")
    .replace(/^→\s*이 문장으로 리포트가 시작[^\n]*/gm, "")
    // ── 내부 STEP 레이블 ──────────────────────────────────────────────────
    .replace(/^\[STEP\s*\d+\][^\n]*/gm, "")
    .replace(/^\[STEP\s*[A-Z]\][^\n]*/gm, "")
    .replace(/^\[내부\s*계산[^\]]*\][^\n]*/gm, "")
    // ── 지시 잔재 ─────────────────────────────────────────────────────────
    .replace(/^⛔\s*이 섹션은 다음 단계[^\n]*/gm, "")
    // ── 밸류에이션 핵심 지표 도출 섹션 제거 (실적 전망 단계 내부 계산용) ──
    // heading(##), bold(**), blockquote(>), 구분선(---) 포함 모든 형태 제거
    .replace(/\n?(?:---\n+)?(?:#{1,3}\s*|>\s*\*{1,2}|>\s*)밸류에이션을 위한 핵심 지표[\s\S]*?(?=\n#{1,3}\s|\n---\n#{1,3}|$)/g, "")
    // ── 연속 공백 정리 ────────────────────────────────────────────────────
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatStep(step: any) {
  return {
    id: step.id,
    analysisId: step.analysisId,
    stepKey: step.stepKey,
    agentName: step.agentName,
    agentRole: step.agentRole,
    content: stripDisplayContent(step.content),
    validationNotes: step.validationNotes,
    informationType: step.informationType,
    createdAt: step.createdAt?.toISOString?.() ?? step.createdAt,
  };
}

function formatAnalysis(analysis: any, steps: any[]) {
  const sortedSteps = [...steps].sort(
    (a, b) => STEP_ORDER.indexOf(a.stepKey as AgentKey) - STEP_ORDER.indexOf(b.stepKey as AgentKey)
  );
  return {
    id: analysis.id,
    ticker: analysis.ticker,
    companyName: analysis.companyName,
    englishName: analysis.englishName ?? null,
    industry: analysis.industry,
    additionalContext: analysis.additionalContext,
    status: analysis.status,
    currentStep: analysis.currentStep,
    investmentVerdict: analysis.investmentVerdict,
    targetPrice: analysis.targetPrice,
    startPrice: analysis.startPrice ?? null,
    entryPrice: analysis.entryPrice,
    stopLoss: analysis.stopLoss,
    riskRewardRatio: analysis.riskRewardRatio,
    memo: analysis.memo ?? null,
    userRating: analysis.userRating ?? null,
    userFeedback: analysis.userFeedback ?? null,
    steps: sortedSteps.map(formatStep),
    createdAt: analysis.createdAt?.toISOString?.() ?? analysis.createdAt,
    updatedAt: analysis.updatedAt?.toISOString?.() ?? analysis.updatedAt,
  };
}

export default router;
