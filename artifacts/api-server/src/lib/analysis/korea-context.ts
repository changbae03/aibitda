// 한국 시장 컨텍스트 빌더 — KRX 업종 피어, DART 경쟁사, 업종 밸류에이션 벤치마크
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


export { KOREAN_SECTOR_MULTIPLES, getKRXSectorPeerContext, extractCompanyNamesFromDart, getDartCompetitorPeerContext, getDartCompetitorTickerPeers };
