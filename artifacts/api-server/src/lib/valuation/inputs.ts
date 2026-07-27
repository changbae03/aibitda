/**
 * inputs.ts — 밸류에이션 한 건에 필요한 입력을 한 곳에서 모은다.
 *
 * 예전에는 "이 종목 밸류에이션에 무엇이 들어갔나"를 알려면 pipeline.ts의 executeStep
 * 1,783줄을 읽어야 했다. 데이터는 14개 소스에서 병렬로 모이고, 컨텍스트는 24곳에서
 * 이어붙고, 수집은 전부 `.catch(() => null)`이라 **무엇이 빠졌는지 아무도 몰랐다.**
 *
 * 여기 모으면 세 가지가 된다.
 *   ① 로그에 "이 분석은 순부채 없이 돌았다"가 남는다
 *   ② 프롬프트가 AI에게 "없으니 추정하지 말라"고 명시할 수 있다
 *   ③ 입력이 갖춰진 분석과 아닌 분석을 나눌 수 있다 — 목표가 클램프를 풀 근거가 된다
 *
 * ⚠️ 이 모듈은 **읽기만 한다.** 수집(외부 API 호출)은 기존 경로가 그대로 하고,
 * 여기서는 이미 저장된 것을 확인한다. 그래야 분석 시간이 늘지 않고, 이 모듈을 넣는 것이
 * 동작을 바꾸지 않는다.
 */

import { pool } from "@workspace/db";
import { normalizeTicker, isKoreanTicker } from "@workspace/shared";
import { getPeersWithMetrics, type PeerWithMetrics } from "../peer-store.js";
import { classifySector } from "../sector-taxonomy.js";
import { getSectorBand } from "./sector-bands.js";
import { MIN_SAMPLES, type SectorBand } from "./band-format.js";
import {
  findMissingInputs,
  completeness,
  renderMissingBlock,
  type MissingInput,
} from "./input-format.js";

/** ticker_financials에서 읽어오는 연간 행 */
interface FinRow {
  bsns_year: number;
  net_debt: string | null;
  revenue: string | null;
}

export interface ValuationInputs {
  ticker: string;
  companyName: string;
  market: "KR" | "US";
  sector: string;

  /** 주당가치 환산과 괴리율의 기준 */
  currentPrice: number | null;
  sharesOut: number | null;
  marketCap: number | null;

  /** 기업가치 → 주주가치 환산. 없으면 목표주가가 통째로 흔들린다 */
  netDebt: number | null;
  netDebtAsOf: string | null;

  /** 확보된 연간 재무 연도 (매출 기준) */
  financialYears: string[];

  /** 상대가치 */
  peers: PeerWithMetrics[];
  band: SectorBand | null;

  /** SOTP·부문 평가 재료 (DART 사업의 내용) */
  hasSegmentData: boolean;
  hasBacklogData: boolean;

  /** 할인율 */
  beta: number | null;

  /** 무엇이 빠졌는가 */
  missing: MissingInput[];
  /** 0~1. 심각도 가중 */
  completeness: number;
}

/**
 * 밸류에이션 입력 현황을 모은다. 절대 던지지 않는다 — 분석을 막으면 안 된다.
 *
 * @param needsSegments SOTP 계열 모델이면 true. 부문 자료가 필수인지 갈린다.
 */
export async function collectValuationInputs(
  rawTicker: string,
  companyName: string,
  industryFallback: string,
  needsSegments = false,
): Promise<ValuationInputs> {
  const ticker = normalizeTicker(rawTicker);
  const market: "KR" | "US" = isKoreanTicker(ticker) ? "KR" : "US";

  const [master, fin, peers, corpRow] = await Promise.all([
    // 종목 마스터 — 가격·주식수·베타·업종
    pool.query<{
      name: string | null; industry: string | null; kis_industry: string | null;
      current_price: number | null; shares_out: string | null;
      market_cap: string | null; beta: number | null;
    }>(
      `SELECT name, industry, kis_industry, current_price, shares_out, market_cap, beta
         FROM stocks WHERE ticker = $1 LIMIT 1`, [ticker],
    ).then(r => r.rows[0] ?? null).catch(() => null),

    // DART 연간 재무.
    //
    // ⚠️ 순차입금은 total_debt로 계산하면 안 된다 — 그 컬럼은 **부채총계**(매입채무·
    // 충당부채까지 포함)다. 한화시스템 기준 부채총계 5.3조 vs 순차입금 0.7조 수준으로
    // 7배 차이가 난다. 기업가치에서 빼야 하는 것은 net_debt 컬럼(IFRS 코드 집계)이다.
    //
    // 같은 (연도, 보고서)에 fs_type이 'CFS'와 '연결'로 중복 적재된 행이 있고
    // '연결' 쪽은 대차대조표 항목이 비어 있다. 값이 있는 행을 먼저 집는다.
    // 매출이 있는 행과 순차입금이 있는 행은 다를 수 있다 — 순차입금은 별도 수집 경로가
    // 채우므로, 매출이 아직 없는 연도에 먼저 들어오기도 한다. 둘 중 하나라도 있으면 가져와
    // 각각 따로 센다. (예전에 revenue IS NOT NULL로 묶었다가 순차입금만 있는 행을 놓쳤다.)
    // .catch(() => [])를 그냥 쓰면 타입이 never[]로 무너져 아래 접근이 전부 깨진다.
    pool.query<FinRow>(
      `SELECT bsns_year, net_debt, revenue
         FROM ticker_financials
        WHERE ticker = $1 AND reprt_code = '11011'
          AND (revenue IS NOT NULL OR net_debt IS NOT NULL)
        ORDER BY bsns_year DESC, (net_debt IS NULL)
        LIMIT 12`, [ticker],
    ).then(r => r.rows).catch((): FinRow[] => []),

    getPeersWithMetrics(ticker, 6).catch((): PeerWithMetrics[] => []),

    // DART 사업의 내용 — 부문별 매출·수주잔고의 원천
    pool.query<{ content: string | null }>(
      `SELECT c.content FROM dart_biz_content c
         JOIN ticker_financials f ON f.corp_code = c.corp_code
        WHERE f.ticker = $1 LIMIT 1`, [ticker],
    ).then(r => r.rows[0] ?? null).catch(() => null),
  ]);

  const sector = classifySector(
    master?.industry ?? industryFallback,
    market,
    master?.kis_industry,
  );
  const band = await getSectorBand(sector).catch(() => null);

  const num = (v: string | number | null | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : null;
  };

  // 순차입금이 실제로 적재된 가장 최근 연도를 찾는다.
  // 0은 유효한 값이라(순부채와 현금이 같은 경우) num()의 0 제외 규칙을 쓰지 않는다.
  const withNetDebt = fin.find(f => f.net_debt !== null && Number.isFinite(Number(f.net_debt)));
  const netDebt = withNetDebt ? Number(withNetDebt.net_debt) : null;

  // 재무 연도는 **매출이 실제로 있는** 연도만 센다. 순차입금만 들어온 행을 함께 세면
  // "재무 3년"이라고 보고하면서 정작 DCF에 쓸 손익이 없는 상태가 된다.
  // 중복(CFS/연결)도 걷어낸다.
  const years = [...new Set(
    fin.filter(f => f.revenue !== null).map(f => String(f.bsns_year)),
  )];

  const content = corpRow?.content ?? "";
  // "사업의 내용"에 부문별 매출·수주 관련 표기가 실제로 들어 있는지 본다.
  // 본문이 있다고 해서 부문 자료가 있는 것은 아니다.
  const hasSegmentData = /부문별|사업부문|세그먼트|제품별 매출|주요 제품|매출 현황/.test(content);
  const hasBacklogData = /수주\s*잔고|수주\s*현황|신규\s*수주|수주액/.test(content);

  const missing = findMissingInputs({
    market,
    currentPrice: num(master?.current_price),
    sharesOut: num(master?.shares_out),
    netDebt,
    financialYears: years.length,
    peerCount: peers.length,
    bandUsable: !!band && (band.per.n >= MIN_SAMPLES || band.pbr.n >= MIN_SAMPLES),
    segmentText: hasSegmentData ? content : null,
    backlogText: hasBacklogData ? content : null,
    beta: num(master?.beta),
    needsSegments,
  });

  return {
    ticker,
    companyName: master?.name ?? companyName,
    market,
    sector,
    currentPrice: num(master?.current_price),
    sharesOut: num(master?.shares_out),
    marketCap: num(master?.market_cap),
    netDebt,
    netDebtAsOf: withNetDebt ? String(withNetDebt.bsns_year) : null,
    financialYears: years,
    peers,
    band,
    hasSegmentData,
    hasBacklogData,
    beta: num(master?.beta),
    missing,
    completeness: completeness(missing),
  };
}

/** 프롬프트에 넣을 "없는 것" 블록. 다 갖춰졌으면 빈 문자열 */
export function renderInputGaps(inputs: ValuationInputs): string {
  return renderMissingBlock(inputs.missing);
}

/** 로그 한 줄 요약 — 어떤 분석이 무엇 없이 돌았는지 남긴다 */
export function describeInputs(inputs: ValuationInputs): string {
  const pct = Math.round(inputs.completeness * 100);
  const gaps = inputs.missing.length
    ? inputs.missing.map(m => m.key).join(",")
    : "없음";
  return `${inputs.ticker} 입력 ${pct}% (재무 ${inputs.financialYears.length}년, ` +
    `피어 ${inputs.peers.length}, 순부채 ${inputs.netDebt !== null ? "○" : "×"}, ` +
    `밴드 ${inputs.band ? "○" : "×"}, 부문 ${inputs.hasSegmentData ? "○" : "×"}) 누락=${gaps}`;
}
