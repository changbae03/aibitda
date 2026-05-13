import { Router, type IRouter } from "express";
import { db, pool } from "@workspace/db";
import { validateTicker } from "../lib/sanitize.js";
import { analysesTable, analysisStepsTable, modelInsightsTable } from "@workspace/db";
import { getUserId, checkAndDeductCredit } from "../lib/credits.js";
import { loadKRXList, lookupKoreanName, correctKoreanTicker } from "../lib/krx-cache";
import { cache, TTL } from "../lib/mem-cache.js";
import { fetchDartSubjectBalance, fetchNaverPBR, writeMetricCache } from "../lib/peer-collector.js";
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
    const peers = peerRes.rows.map(r => {
      const kis = kisData.get(r.code);
      return {
        code: r.code,
        name: r.name,
        pbr: kis?.pbr ?? (r.pbr ? parseFloat(r.pbr) : null),
        per: kis?.per ?? (r.per ? parseFloat(r.per) : null),
        bps: kis?.bps ?? (r.bps ? parseFloat(r.bps) : null),
        mcap: kis?.mcap ?? (r.mcap ? parseFloat(r.mcap) : null),
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
        const priceStr = p.price ? `${p.price.toLocaleString("ko-KR")}원` : "—";
        const roeStr = p.roe !== null ? `${p.roe.toFixed(1)}%` : "—";
        return `| ${p.code} | ${p.name} | ${p.pbr?.toFixed(2) ?? "—"} | ${p.per?.toFixed(1) ?? "—"} | ${roeStr} | ${priceStr} |`;
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
| 종목코드 | 종목명 | PBR(배) | PER(배) | ROE | 현재가 |
|--------|--------|--------|--------|-----|-------|
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

function extractJsonSafe(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch { return null; }
}

// Prevent concurrent duplicate step execution
const runningStepsLock = new Map<string, boolean>();

// ─── Lead Portfolio Strategist QC Check ──────────────────────────────────────

const QC_STEPS = new Set<AgentKey>(["company_analysis", "relative_valuation"]);

async function runQCCheck(
  stepKey: AgentKey,
  content: string,
  companyName: string,
  ticker: string
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
   - 올해E 또는 내년E 영업이익률이 전년 실적 대비 +15%p 이상 점프했는데 전망 근거에 구체적 드라이버(원가 구조 변화·매출 레버리지·사업 믹스 개선 등) 없으면: 불승인` : isRelativeValuation ? `

5. 목표가 산출 정합성 — 팀장 직접 조율 검수 (전용 필수 검증):

  [구조 검증 — 하나라도 없으면 즉시 불승인]
   - 절대가치 산출 표가 없으면: 불승인 (DCF FCFF 테이블 또는 Pipeline rNPV 테이블 또는 EV/Sales 테이블 또는 DDM 계산 중 하나)
   - 피어 그룹 멀티플 비교 테이블이 없으면: 불승인
   - FINAL_VALUATION_DATA JSON이 없거나 파싱 불가이면: 즉시 불승인
   - 최종 적정주가·상단 밴드·하단 밴드 3개 수치가 모두 명시되지 않으면: 불승인
   - 최종 밸류에이션 핵심 지표 요약 블록이 없으면: 불승인

  [모델 선택 및 가정 검증]
   - 밸류에이션 모델 선택 섹션(4개 평가 기준 테이블)이 없으면: 불승인
   - 선택 모델 이유가 없으면: 불승인
   - 모델 가정 수립 섹션이 없으면: 불승인
   - WACC 산출 근거(Rf, β, ERP, CoE 수치)가 없으면: 불승인
   - 바이오/제약 기업이 임상단계(미허가 파이프라인 중심, 매출 극소)임에도 DCF를 선택했고, 선택 이유가 없거나 빈약하면: 불승인

  [절대가치 모델 품질 검증 — 선택된 모델에 따라 아래 중 하나 적용]
   A) DCF 모델: FCFF 10년 테이블이 있어야 하고, 주당 내재가치 수치가 있어야 함. Reverse DCF 분석이 없으면: 불승인
   B) Pipeline rNPV 모델: 파이프라인별 PoS·rNPV 표가 있어야 하고, 주당 내재가치 수치가 있어야 함. 현재 주가 역산 분석이 없으면: 불승인
   C) EV/Sales 모델: EV/Sales 배수·산출 EV·주당 내재가치 수치가 있어야 함
   D) DDM 모델: D₁·CoE·g·DDM 내재가치 수치가 있어야 함
   - 어떤 모델이든 최종 주당 내재가치(원) 수치가 없으면: 불승인
   - 내재가치가 현재 주가 대비 터무니없이 높거나(4배↑) 낮으면(0.2배↓): 가정 재검토 여부 확인, 없으면 불승인

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
   - 바이오/제약 파이프라인 rNPV 할인율이 15%를 초과하면: 불승인 (PoS가 이미 임상 위험 반영 — 이중 할인 금지)` : "";

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
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 256,
        temperature: 0.1, // QC는 채점 로직 — 거의 결정론적으로
        topP: 0.8,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const raw = response.text ?? "";
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
아래는 ${companyName}(${ticker})의 적정주가 산출 초안입니다. 밸류에이션의 핵심 가정을 정확히 3가지 각도로 치열하게 반론하세요.

[반론 원칙]
- "틀렸다"가 아니라 "이 가정이 성립하려면 X 조건이 필요한데 그 근거가 불충분하다"는 형식
- 각 반론은 반드시 구체적 수치·비교 근거 포함

[반론 3가지]
1. 할인율·WACC 가정 반론: WACC 또는 할인율 설정이 너무 낮거나 높은 이유 (2-3문장)
2. 성장률·멀티플 가정 반론: 터미널 성장률 또는 피어 배수 적용의 취약한 논리 (2-3문장)
3. 목표가 도출 반론: 최종 적정주가·밴드 산출 과정에서 가장 약한 논리적 연결고리 (2-3문장)

[초안]
${excerpt}

JSON·마크다운 테이블 없이 번호 형식으로 간결하게 작성 (총 400-700자).`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: challengerPrompt }] }],
      config: {
        maxOutputTokens: 1024,
        temperature: 0.6,
        topP: 0.9,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    return response.text ?? "";
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
    console.log(`[Cache HIT] ${cacheKey}`);
    return cached;
  }
  console.log(`[Cache MISS] ${cacheKey} — fetching from Naver Finance`);

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
        const margin = (revenues[i] && opIncomes[i] && Number(revenues[i]) > 0)
          ? ` (영업이익률 ${((Number(opIncomes[i]) / Number(revenues[i])) * 100).toFixed(1)}%)`
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
    console.log(`[Cache HIT] ${fcCacheKey}`);
    return fcCached;
  }
  console.log(`[Cache MISS] ${fcCacheKey} — fetching from Yahoo Finance`);

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
    console.log(`[financial-data] timeseries rows: ${tsRows.length}`);
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
    if (fd.operatingMargins != null) lines.push(`영업이익률: ${pct(fd.operatingMargins)}`);
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
      if (pbMain != null) console.log(`[financial-data] Naver PBR for ${resolvedSymbol}: ${pbMain}`);
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

        let waccTag = "";
        if (waccEstPct < 8) {
          waccTag = " ⚠️ [과소 가능성] AI는 최소 8%로 하향 조정 필요 여부 검토";
        } else if (waccEstPct > 16) {
          waccTag = " ⚠️ [과대 가능성] AI는 재검토 필요";
        } else {
          waccTag = " ✅ 정상 범위 — AI는 이 값을 WACC 출발점으로 사용 (가드레일 내 조정 허용)";
        }
        waccLines.push(
          `\n[🧮 서버 계산 WACC 추정값 — 반드시 출발점으로 사용]` +
          `\n  Beta(${betaSrc}): ${beta.toFixed(2)} | Rf: ${(Rf*100).toFixed(1)}% | ERP: ${(ERP*100).toFixed(1)}%` +
          `\n  CoE = ${(Rf*100).toFixed(1)}% + ${beta.toFixed(2)}×${(ERP*100).toFixed(1)}% = ${CoEPct}%` +
          `\n  D/(D+E) = ${(DoverEplusD*100).toFixed(1)}%  |  E/(D+E) = ${(EoverEplusD*100).toFixed(1)}%` +
          `\n  CoD(after-tax) = ${(codAfterTax*100).toFixed(2)}%` +
          `\n  ➡️ 서버 WACC 추정값: ${waccEstPct}%${waccTag}`
        );
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
    const toQtrMap = (key: string): Array<{period: string; value: number}> => {
      const rows = tsTypeMap[key] ?? [];
      // For quarterly we need the asOfDate with quarter info
      // tsTypeMap currently stores only year; rebuild from raw tsRows for quarterly
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
            .slice(0, 6);
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
  console.log(`[financial-data] Fetched ${text.length} chars for ${resolvedSymbol}`);
  cache.set(fcCacheKey, text, TTL.YAHOO_FINANCIAL);
  return text;
}

// ─── Company news fetching (Google News RSS) ─────────────────────────────────

async function fetchCompanyNews(companyName: string): Promise<string> {
  const newsCacheKey = `news:${companyName}`;
  const newsCached = cache.get<string>(newsCacheKey);
  if (newsCached) {
    console.log(`[Cache HIT] ${newsCacheKey}`);
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
  previousContext: string
): Promise<Array<{ ticker: string; name: string; exchange: string; reason: string }>> {
  try {
    const prompt = `Company: ${companyName}, Industry: ${industry}.

Based on the context below, identify 4-5 publicly traded peer companies for valuation comparison.
Select peers based on: similar business model, competitive relationship, or meaningful valuation comparison.
Prefer peers that are well-covered on Yahoo Finance (major Korean listed companies and global companies).
${previousContext ? `\nContext:\n${previousContext.slice(0, 1500)}` : ""}

PEER SELECTION RULES (strictly enforce):
- Business model match is MANDATORY. Do NOT mix these types in the same peer group:
  * Pure pipeline biotech (파이프라인 바이오텍) vs CDMO/CMO (위탁생산기업, e.g., 삼성바이오로직스, 에스티팜, 바이넥스). EV/Sales comparison between them is invalid.
  * Drug discovery/royalty model vs self-commercialization model — flag if you must include a mixed model peer.

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

- GLOBAL PEER → KOREAN STOCK NOTE: When any non-Korean (US/global) peer is selected for a Korean company, add to reason: "글로벌 피어 적용 시 한국 시장 구조적 특성(유동성·지배구조·주주환원) 반영 10-15% 할인 적용 필요". Do NOT use the word "코리아 디스카운트" in any report output — use "한국 시장 구조적 특성 반영 할인" or "지배구조·주주환원 기반 조정" instead.

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
    console.log(`[peer-select] Raw response (${raw.length} chars, first 800): ${raw.slice(0, 800)}`);

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
      // 분석 대상 기업 자체가 피어에 포함된 경우 제거
      const filtered = parsed.peers.filter((p: any) => {
        const t = (p.ticker ?? "").toUpperCase();
        return t !== companyName.toUpperCase() && !p.reason?.includes("분석 대상");
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

  const results = await Promise.allSettled(
    peers.map(async (peer) => {
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
        const currency = quote.currency ?? pr.currency ?? "USD";
        const isKrw = currency === "KRW";
        const price = kis?.price ?? quote.regularMarketPrice ?? pr.regularMarketPrice ?? null;
        // KIS 시가총액(억원) → 원화 변환
        const kisMcap = kis?.mcap != null ? kis.mcap * 1e8 : null;
        const mcap = kisMcap ?? quote.marketCap ?? pr.marketCap ?? sd.marketCap ?? null;
        const mcapStr = mcap
          ? isKrw
            ? `${(mcap / 1e12).toFixed(2)}조원`
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
          console.log(`[peer-data] KIS PER for ${peer.ticker}: ${trailPE}`);
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
          console.log(`[peer-data] KIS PBR for ${peer.ticker}: ${pbr}`);
        } else {
          pbr = ks.priceToBook ?? (quote as any).priceToBook ?? null;
        }
        if (pbr == null) {
          const koreanMatch = peer.ticker.match(/^(\d{6})\.(KS|KQ)$/i);
          if (koreanMatch) {
            try {
              const nb = await fetch(
                `https://m.stock.naver.com/api/stock/${koreanMatch[1]}/basic`,
                { headers: NAVER_HEADERS, signal: AbortSignal.timeout(5000) }
              ).then(r => r.ok ? r.json() : null);
              const raw = nb?.pbr;
              if (raw != null) {
                const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/,/g, ""));
                if (!isNaN(n) && n > 0) { pbr = n; console.log(`[peer-data] Naver PBR for ${peer.ticker}: ${n}`); }
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
        return {
          line: [
            `[${peer.name} (${peer.ticker}) — ${peer.exchange ?? ""}]`,
            peer.reason ? `  선정 이유: ${peer.reason}` : null,
            `  시가총액: ${mcapStr}${price ? ` | 현재가: ${isKrw ? Math.round(price).toLocaleString() : price.toFixed(2)} ${currency}` : ""}`,
            `  PER(Fwd): ${fmt1(fwdPE)}x | PER(TTM): ${fmt1(trailPE)}x | PBR: ${fmt2(pbr)}x | EV/EBITDA: ${fmt1(evEbitda)}x | EV/매출: ${fmt2(evRev)}x`,
            `  ROE: ${pct(roe)} | 영업이익률: ${pct(opMargin)} | 순이익률: ${pct(netMargin)} | 매출총이익률: ${pct(grossMargin)} | 매출성장률(YoY): ${pct(revGrowth)}`,
            `  매출(TTM): ${fmtAbs(totalRevenue, isKrw)} | 영업이익: ${fmtAbs(opIncome, isKrw)} | 순이익: ${fmtAbs(netIncome, isKrw)} | EBITDA: ${fmtAbs(ebitda, isKrw)}`,
            `  자본총계: ${fmtAbs(totalEquity, isKrw)} | 총부채: ${fmtAbs(totalDebt, isKrw)} | 현금: ${fmtAbs(cash, isKrw)}`,
          ].filter(Boolean).join("\n"),
          ticker: peer.ticker,
          name: peer.name,
          ev_ebitda: evEbitda,
          per_trailing: trailPE,
          per_fwd: fwdPE,
          ev_sales: evRev,
          pbr,
        };
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
        res.status(400).json({ error: "ETF·인덱스펀드는 분석 대상이 아닙니다. 개별 주식 종목코드를 입력해주세요." });
        return;
      }
      // 비지원 US 거래소(OTC 핑크, 회색 시장 등) 추가 차단
      const US_ALLOWED = new Set(["NMS", "NGM", "NCM", "NYQ", "NYS", "NYE", "ASE", "AMX", "PCX", "CBOE", "PNK", ""]);
      if (qExchange && !US_ALLOWED.has(qExchange)) {
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

  // Fetch financial data, news, DART balance sheet, macro data, start price, KIS real-time in parallel
  const [financialData, newsData, dartBalance, ecosMacro, fredMacro, startQuote, kisResult] = await Promise.all([
    fetchFinancialContext(resolvedSymbol),
    fetchCompanyNews(companyName ?? ""),
    isKoreanTicker ? fetchDartSubjectBalance(krxCode) : Promise.resolve(null),
    isKoreanTicker ? fetchECOSMacro() : Promise.resolve(null),
    !isKoreanTicker ? fetchFREDMacro() : Promise.resolve(null),
    yahooFinance.quote(resolvedSymbol).catch(() => null),
    isKoreanTicker ? buildKISStockContext(krxCode).catch(() => null) : Promise.resolve(null),
  ]);

  // KIS 결과 분리 — 한국 종목은 KIS 현재가 우선, 없으면 Yahoo fallback
  const kisContext = kisResult?.context ?? null;
  const kisQuote = kisResult?.quote ?? null;
  const yahooPrice: number | null = (startQuote as any)?.regularMarketPrice ?? null;
  const startPrice: number | null = isKoreanTicker
    ? (kisQuote?.price ?? yahooPrice)
    : yahooPrice;
  if (isKoreanTicker && kisQuote?.price) {
    console.log(`[analysis] startPrice KIS 우선: ${kisQuote.price}원 (Yahoo: ${yahooPrice})`);
  }

  // DART 재무상태표 컨텍스트 구성
  let dartBalanceContext = "";
  if (dartBalance) {
    const fmtKrw = (v: number | null) =>
      v == null ? "N/A" : `${(v / 1e8).toFixed(1)}억원`;

    // 순현금 계산: totalDebt가 null이면 금융부채 항목이 DART에서 미검출된 것
    // → Yahoo Finance의 WACC 섹션에서 totalDebt를 보완 사용하도록 안내
    let netDebtStr: string;
    if (dartBalance.totalDebt != null && dartBalance.cash != null) {
      const netDebt = dartBalance.totalDebt - dartBalance.cash;
      netDebtStr = netDebt < 0
        ? `${fmtKrw(-netDebt)} (순현금)  ← DCF 주주가치 환산 시 이 값 사용`
        : `${fmtKrw(netDebt)} (순부채)  ← DCF 주주가치 환산 시 이 값 사용`;
    } else if (dartBalance.cash != null && dartBalance.totalDebt == null) {
      // 금융부채 항목 미검출 — Yahoo Finance WACC 섹션의 총부채 수치로 보완
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
  // 한국 종목 → ECOS(한국은행), 미국/글로벌 종목 → FRED(연준) 거시지표 주입
  const macroContext = isKoreanTicker
    ? buildECOSContext(ecosMacro)
    : buildFREDContext(fredMacro);

  const fullContext = [
    kisContext,          // KIS 실시간 (상장주식수·현재가·PBR/PER/BPS) — 최우선 오버라이드
    financialData,
    dartBalanceContext,
    macroContext,
    newsData,
    userContext ? `[사용자 추가 컨텍스트]\n${userContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n") || null;

  // 사용자 언어 설정 조회
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
          fullContext,
          "in_progress",
          "company_intro",
          "true",
          startPrice,
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

  res.json(formatAnalysis(analysis, []));
});

router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.json([]);
      return;
    }
    const aRows = await rawQuery(
      `SELECT * FROM analyses WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    if (aRows.length === 0) {
      res.json([]);
      return;
    }
    const ids = aRows.map((r: any) => r.id);
    const sRows = await rawQuery(
      `SELECT * FROM analysis_steps WHERE analysis_id = ANY($1::int[]) ORDER BY created_at ASC`,
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
      .map((a: any) => formatAnalysis(a, (stepsByAnalysis.get(a.id) ?? []).map(mapStepRow)));
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

router.delete("/", async (_req, res) => {
  await rawQuery(`DELETE FROM analysis_steps`);
  await rawQuery(`DELETE FROM analyses`);
  res.json({ success: true });
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

router.get("/popular", async (_req, res) => {
  try {
    const rawRows = await rawQuery(
      `SELECT id, ticker, company_name, industry, investment_verdict, target_price, entry_price, stop_loss, created_at
       FROM analyses
       WHERE status = 'completed' AND is_public = 'true' AND investment_verdict IS NOT NULL
       ORDER BY created_at DESC LIMIT 50`
    );

    const rows = rawRows.map(r => ({
      id: r.id as number,
      ticker: r.ticker as string,
      companyName: r.company_name as string,
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

    const tickerCounts: Record<string, { count: number; companyName: string }> = {};
    for (const r of rows) {
      if (!tickerCounts[r.ticker]) tickerCounts[r.ticker] = { count: 0, companyName: r.companyName };
      tickerCounts[r.ticker].count++;
    }
    const tickerStats = Object.entries(tickerCounts)
      .map(([ticker, v]) => ({ ticker, companyName: v.companyName, count: v.count }))
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

    res.json({ items: enriched, tickerStats, verdictStats, marketStats });
  } catch (err: any) {
    console.error("[GET /analysis/popular]", err?.message, err?.cause?.message);
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
      .select()
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

    res.json({ total, verdictMap, krCount, usCount, topTickers, uniqueTickerCount, recentTrend, weekdayDist, bullRate, repeatRate, repeatTickerCount });
  } catch (err) {
    console.error("[GET /analysis/public-stats]", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/period-stats", async (_req, res) => {
  try {
    // 완료된 분석 + model_insights 조인
    const rows = await rawQuery<{
      analysis_id: number;
      created_at: string;
      investment_verdict: string | null;
      outcome: string | null;
      price_return: number | null;
      days_elapsed: number | null;
    }>(`
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
    `);

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
  onEvent?: (data: object) => void
): Promise<AgentKey | null> {
  const agent = AGENTS[stepKey];
  let enrichedContext = analysis.additionalContext ?? null;

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
  // 운영자가 특정 종목에 입력한 보정 노트를 AI 컨텍스트에 항상 반영
  try {
    const noteRows = await rawQuery(
      `SELECT memo FROM ticker_notes WHERE ticker = $1 AND memo != ''`,
      [analysis.ticker]
    );
    if (noteRows[0]?.memo) {
      const memoBlock = `\n\n[📝 운영자 종목 보정 메모 — ${analysis.companyName}(${analysis.ticker}) — 반드시 반영하세요]\n${noteRows[0].memo}`;
      enrichedContext = enrichedContext ? enrichedContext + memoBlock : memoBlock;
      console.log(`[ticker-note] Injected ${memoBlock.length}chars for ${analysis.ticker}`);
    }
  } catch {
    // 실패해도 분석 진행
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

        // ── auto_learning 누적 통계 주입 ──────────────────────────────────
        try {
          const learningRows = await rawQuery(
            `SELECT auto_learning FROM ticker_notes WHERE ticker = $1`,
            [analysis.ticker]
          );
          const learningData = learningRows[0]?.auto_learning as { history?: Array<{ date: string; verdict: string; targetPrice: number; entryPrice: number; upsidePct: number }> } | null;
          if (learningData?.history && learningData.history.length >= 2) {
            const hist = learningData.history;
            const avgUpside = hist.reduce((s, h) => s + h.upsidePct, 0) / hist.length;
            const bullishCount = hist.filter(h => ["Strong Buy", "Buy"].includes(h.verdict)).length;
            const bullishPct = Math.round((bullishCount / hist.length) * 100);
            const upsides = hist.map(h => `${h.date.slice(0, 7)}: ${h.upsidePct > 0 ? "+" : ""}${h.upsidePct}%`).join(", ");

            const statsBlock = `\n\n[📊 ${analysis.ticker} 밸류에이션 누적 통계 — ${hist.length}회 분석 기반]`
              + `\n- 평균 upside: ${avgUpside > 0 ? "+" : ""}${avgUpside.toFixed(1)}% | 매수 판정 비율: ${bullishPct}%`
              + `\n- 회차별 upside: ${upsides}`
              + `\n- 이 통계를 참고해 지나치게 낙관적/비관적인 편향이 있었는지 자기검토 후 이번 분석에 반영하세요.`;
            enrichedContext = enrichedContext ? enrichedContext + statsBlock : statsBlock;
          }
        } catch {
          // optional
        }
        // ─────────────────────────────────────────────────────────────────
      }

      // ── 투자 판정 일관성 앵커 (investment_strategy 전용) ────────────────────
      // 7일 이내: 동일 판정 유지 강제 / 8~30일: 변경 시 근거 요구
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
            // 7일 이내: 강한 앵커 — 동일 판정 유지 의무
            const anchorBlock = `\n\n[🔒 투자 판정 일관성 앵커 — ${analysis.companyName}(${analysis.ticker}) ${daysAgo}일 전 분석]\n`
              + `⛔ 중요: ${daysAgo}일 전 이 종목 분석에서 아래 판정이 내려졌습니다.\n`
              + `  판정: ${rec.investment_verdict} | 목표가: ${fmt(rec.target_price)}원 | 진입가: ${fmt(rec.entry_price)}원\n`
              + `📌 지시 사항:\n`
              + `- 명백한 시장 변화(어닝 서프라이즈, 급락/급등, 업황 전환 등)가 없는 한 동일 판정(${rec.investment_verdict})을 유지하세요.\n`
              + `- 목표가는 직전 분석 대비 ±15% 이내로 제한하세요.\n`
              + `- 판정을 바꿀 경우 반드시 "판정 변경 근거:" 항목을 별도 문단으로 명시하세요.\n`
              + `- 위 지시를 무시하고 임의로 반대 판정을 내리는 것은 금지됩니다.`;
            enrichedContext = enrichedContext ? enrichedContext + anchorBlock : anchorBlock;
            console.log(`[verdict-anchor] 강한 앵커 주입 — ${analysis.ticker} (${daysAgo}일 전: ${rec.investment_verdict})`);
          } else if (daysAgo <= 30) {
            // 8~30일: 소프트 앵커 — 판정 변경 시 설명 요구
            const softBlock = `\n\n[📌 투자 판정 참고 앵커 — ${analysis.companyName}(${analysis.ticker}) ${daysAgo}일 전 분석]\n`
              + `  판정: ${rec.investment_verdict} | 목표가: ${fmt(rec.target_price)}원 | 진입가: ${fmt(rec.entry_price)}원\n`
              + `- 위 판정과 다른 결론을 낼 경우 판정 섹션에 변경 이유를 반드시 명시하세요.\n`
              + `- 목표가는 직전 분석 대비 ±20% 이내가 되도록 노력하세요.`;
            enrichedContext = enrichedContext ? enrichedContext + softBlock : softBlock;
            console.log(`[verdict-anchor] 소프트 앵커 주입 — ${analysis.ticker} (${daysAgo}일 전: ${rec.investment_verdict})`);
          }
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
            const valAnchorBlock = `\n\n[🔒 밸류에이션 일관성 앵커 — ${analysis.companyName}(${analysis.ticker}) ${prevDate} 기준]\n`
              + `직전 분석 적정주가(Base): ${prevTarget.toLocaleString()}원 | 판정: ${prevVerdict}\n`
              + `⛔ 핵심 지시: 이번 분석에서 도출하는 적정주가 Base는 반드시 ${lower}원 ~ ${upper}원 범위 이내에서 산정하세요.\n`
              + `- 단, 임상 결과 발표·대형 파트너십·어닝 쇼크 등 명백한 펀더멘털 변화가 있으면 이 제한을 무시하고 그 이유를 명시하세요.\n`
              + `- 할인율·성공확률·피크세일즈 등 핵심 가정은 직전 분석과 동일하게 유지하는 것을 기본 원칙으로 합니다.`;
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

      // ── Feature 2: 틀린 예측 패턴 반영 (model_insights 교훈) ──────────────
      const allInsightRows = await rawQuery(
        `SELECT * FROM model_insights WHERE outcome != 'pending'`
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
  // 일관성 확보: 직전 완료 분석의 재무 전망 요약을 참조로 제공
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
        // 핵심 지표 도출 블록 추출 (맨 마지막 부분)
        const keyMetricsIdx = prevContent.lastIndexOf("밸류에이션을 위한 핵심 지표");
        const summarySection = keyMetricsIdx !== -1
          ? prevContent.slice(keyMetricsIdx, keyMetricsIdx + 1500)
          : prevContent.slice(-1200);
        // 실적 전망 테이블 추출 (추정 재무 모델 섹션)
        const forecastIdx = prevContent.indexOf("추정 재무 모델");
        const forecastSection = forecastIdx !== -1
          ? prevContent.slice(forecastIdx, forecastIdx + 800)
          : "";
        const anchorBlock = `\n\n[📌 ${analysis.companyName}(${analysis.ticker}) 직전 분석(${prevDate}) 실적 전망 앵커]\n`
          + `⚠️ 아래는 직전 분석에서 산출된 재무 전망 수치입니다. 새로운 분기 데이터나 업황 변화가 없는 한 수치 방향성을 유지하세요. 크게 달라진다면 그 이유를 전망 근거에 명시하세요.\n`
          + (forecastSection ? forecastSection.slice(0, 600) + "\n" : "")
          + summarySection.slice(0, 800);
        enrichedContext = enrichedContext ? enrichedContext + anchorBlock : anchorBlock;
        console.log(`[company_analysis] Injected prev forecast anchor from ${prevDate} (${anchorBlock.length} chars)`);
      }
    } catch {
      // optional — 이전 데이터 없어도 무방
    }
  }

  // ── relative_valuation: 피어 데이터 자동 수집 ────────────────────────────
  if (stepKey === "relative_valuation") {
    try {
      // prevContext를 5000자로 확장 — 기업 브리핑·산업 분석이 충분히 포함되도록
      const prevContext = existingSteps.map((s) => s.content).join("\n").slice(0, 5000);
      onEvent?.({ t: "" }); // keep connection alive

      let peers = await selectPeerTickers(analysis.companyName, analysis.industry, prevContext);
      console.log(`[peer-select] Selected ${peers.length} peers:`, peers.map((p) => p.ticker).join(", "));

      // 피어 선정 실패 시 1회 재시도 (더 많은 컨텍스트)
      if (peers.length === 0) {
        console.warn("[peer-select] 1st attempt returned 0 peers — retrying with full context");
        const fullContext = existingSteps.map((s) => s.content).join("\n").slice(0, 3000);
        peers = await selectPeerTickers(analysis.companyName, analysis.industry ?? "바이오/제약", fullContext);
        console.log(`[peer-select] Retry selected ${peers.length} peers`);
      }

      // 한국 주식: KRX 실데이터 기반 업종 PBR 주입
      const tickerKrxCode = analysis.ticker.split(".")[0];
      const isKoreanTicker = /^\d{6}$/.test(tickerKrxCode);
      if (isKoreanTicker) {
        const krxCtx = await getKRXSectorPeerContext(tickerKrxCode);
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

        guideLines.push(`\n[🎯 밸류에이션 모델 선택 필수 가이드라인]`);
        guideLines.push(`⚠️ 아래 규칙을 반드시 준수하세요. 위반 시 QC 불승인.`);

        if (isBio) {
          guideLines.push(`· 업종(${analysis.industry}): 바이오/제약 → rNPV(SOTP) 우선 사용. PBR 가중 30% 이상 금지.`);
          guideLines.push(`· rNPV 할인율: 8~12% 범위 (PoS가 이미 임상 위험 반영 — 15% 초과 이중할인 금지)`);
          guideLines.push(`· 피어: 동일 임상 단계의 세포치료/바이오텍 기업 기준. 수익성 있는 대형 제약사와 직접 배수 비교 금지.`);
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

        const guideBlock = guideLines.join("\n");
        enrichedContext = enrichedContext ? enrichedContext + "\n" + guideBlock : guideBlock;
        console.log(`[model-guide] 밸류에이션 모델 가이드라인 주입 (isBio=${isBio}, isNewSpace=${isNewSpace})`);
      }

      // US 주식 전용: AI 선택 실패 시 하드코딩 피어 맵으로 대체
      if (peers.length === 0 && !isKoreanTicker) {
        const mappedPeers = US_PEER_MAP[analysis.ticker.toUpperCase()];
        if (mappedPeers?.length) {
          peers = mappedPeers;
          console.log(`[peer-select] Using hardcoded US peer map for ${analysis.ticker}: ${peers.map(p => p.ticker).join(", ")}`);
        }
      }

      if (peers.length > 0) {
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
    ((analysis as any).language ?? "ko") as "ko" | "en"
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
    // 토큰 한도: company_analysis·relative_valuation은 32k 유지 (잘림 방지)
    // 나머지 5개 단계는 6k (원래 8k에서 절감)
    const maxOutputTokens =
      (stepKey === "company_analysis" || stepKey === "relative_valuation") ? 32768 : 6144;

    // 일시적 오류(503 UNAVAILABLE, 타임아웃) 여부 판별
    const isTransient = (err: unknown) => {
      const msg = String(err);
      return msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("timed out") || msg.includes("timeout");
    };

    const MAX_ATTEMPTS = 3;
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          const waitMs = (attempt - 1) * 3000; // 3s, 6s
          console.warn(`[${stepKey}] Retry ${attempt}/${MAX_ATTEMPTS} after ${waitMs}ms…`);
          onEvent?.({ t: "" }); // keep-alive
          await new Promise((r) => setTimeout(r, waitMs));
        }

        // 밸류에이션 단계는 수치 일관성을 위해 더 낮은 temperature 사용
        // 비밸류에이션도 0.15로 낮춰 단계별 결론 일관성 향상
        const stepTemperature = isValuationStep ? 0.12 : 0.15;
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
            // 500자마다 실시간 반복 루프 감지 — 감지 시 스트림 즉시 종료
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
        // 스트림 종료 후 한 번 더 검사 (마지막 청크에서 완성된 루프 처리)
        content = trimRepetitionLoop(content);
        if (lastFinishReason === "MAX_TOKENS") {
          console.warn(`[${stepKey}] 응답이 MAX_TOKENS(${maxOutputTokens})로 잘림`);
          // relative_valuation: FINAL_VALUATION_DATA JSON이 없으면 복구 시도
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
        if (!content) content = "분석 결과를 생성하지 못했습니다.";
        lastErr = null;
        break; // 성공 — 루프 탈출
      } catch (err) {
        lastErr = err;
        console.error(`[${stepKey}] Gemini error (attempt ${attempt}):`, err);
        if (!isTransient(err) || attempt === MAX_ATTEMPTS) break; // 비일시적 오류 or 마지막 시도
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
          const synthesisInstruction = isEnLang
            ? (stepKey === "company_analysis"
              ? `\n\n---\n[Round 1 Draft — Base this revision on the draft below]\n${content}\n\n---\n[Internal Review — Devil's Advocate Feedback]\n${challengerFeedback}\n\n[Instruction] Review the 3 challenges above. Incorporate valid criticisms by supplementing figures and arguments; rebut points you disagree with using specific evidence. Maintain the existing report format, length, and structure — do NOT shorten the report. Do not expose the challenge items as a separate section. Write the final version ENTIRELY in English.`
              : `\n\n---\n[Round 1 초안 — 아래 초안을 기반으로 수정하세요]\n${content}\n\n---\n[내부 검토 — Valuation Skeptic 반론 피드백]\n${challengerFeedback}\n\n[Instruction] Review the 3 challenges above. Re-examine WACC, growth rate, and multiple assumptions. Incorporate valid criticisms with updated figures; rebut points you disagree with using specific evidence. Maintain the existing report format (DCF table, FINAL_VALUATION_DATA JSON included). Write the final version ENTIRELY in English.`)
            : (stepKey === "company_analysis"
              ? `\n\n---\n[Round 1 초안 — 아래 초안을 기반으로 수정하세요]\n${content}\n\n---\n[내부 검토 — Devil's Advocate 반론 피드백]\n${challengerFeedback}\n\n[지시] 위 3가지 반론을 검토하세요. 타당한 지적은 수치·논거를 보완하여 반영하고, 동의하지 않는 부분은 구체적 근거로 반박하세요. 기존 보고서의 형식·구조·분량을 그대로 유지하면서(줄이지 마세요) 최종 완성본을 작성하세요. 반론 항목을 별도 섹션으로 노출하지 마세요.`
              : `\n\n---\n[Round 1 초안 — 아래 초안을 기반으로 수정하세요]\n${content}\n\n---\n[내부 검토 — Valuation Skeptic 반론 피드백]\n${challengerFeedback}\n\n[지시] 위 3가지 반론을 검토하세요. WACC·성장률·멀티플 가정을 재점검하고, 타당한 지적은 수치를 보완하여 반영, 동의하지 않으면 구체적 근거로 반박하세요. 기존 보고서의 형식(DCF 테이블, FINAL_VALUATION_DATA JSON 포함)과 분량을 그대로 유지하면서(줄이지 마세요) 최종 완성본을 작성하세요.`);

          const synthesisUserPrompt = userPrompt + synthesisInstruction;
          const synthesisMaxTokens = 24576; // Debate 합성: 24k (잘림 방지 + 비용 절감 절충)

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

          let synthesizedContent = "";
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
      const qcResult = await runQCCheck(stepKey, content, analysis.companyName, analysis.ticker);
      console.log(`[QC] ${stepKey} score=${qcResult.score} approved=${qcResult.approved}`);

      if (!qcResult.approved) {
        onEvent?.({ qc: "revising", score: qcResult.score, feedback: qcResult.feedback });
        try {
          const revisedUserPrompt = userPrompt +
            ((analysis as any).language === 'en'
              ? `\n\n---\n[Lead Strategist Review — Mandatory Revision]\n${qcResult.feedback}\nAddress the above points clearly and rewrite the analysis to a higher standard of completeness. Write the ENTIRE revised report in English only.`
              : `\n\n---\n[팀장 재검토 지시 — 반드시 보완하세요]\n${qcResult.feedback}\n위 사항을 명확히 보완하여 더 완성도 높은 분석을 다시 작성하세요.`);
          const revisedMaxTokens = (stepKey === "company_analysis" || stepKey === "relative_valuation") ? 32768 : 6144;
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
          let revisedContent = "";
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
      try {
        if (!json) throw new Error("JSON parse failed");
        investmentVerdict = json.verdict ?? null;

        const parsePrice = (val: string | undefined) => {
          if (!val) return null;
          const num = parseFloat(String(val).replace(/[^0-9.]/g, ""));
          return isNaN(num) ? null : num;
        };

        targetPrice = parsePrice(json.target_price);
        entryPrice = parsePrice(json.entry_price);
        stopLoss = parsePrice(json.stop_loss);

        // ── 목표가·진입가·손절가 이상값 가드 ─────────────────────────────────
        const startPriceRow = await rawQuery(
          `SELECT start_price, ticker FROM analyses WHERE id=$1`,
          [id]
        );
        const savedStartPrice: number | null = startPriceRow[0]?.start_price ?? null;
        const savedTicker: string = startPriceRow[0]?.ticker ?? "";
        const isKR = /^\d{6}$/.test(savedTicker);

        if (savedStartPrice && savedStartPrice > 0) {
          // ── 목표주가 하드캡: KR 3.5x / US 4.5x ─────────────────────────
          // AI 프롬프트의 소프트 가드레일을 무시하는 극단값을 서버에서 강제 보정
          const TARGET_MAX_RATIO = isKR ? 3.5 : 4.5;
          const TARGET_MIN_RATIO = isKR ? 0.15 : 0.12;
          if (targetPrice) {
            const tRatio = targetPrice / savedStartPrice;
            if (tRatio > TARGET_MAX_RATIO) {
              const capped = Math.round(savedStartPrice * TARGET_MAX_RATIO);
              console.warn(
                `[analysis ${id}] target_price ${targetPrice} is ${tRatio.toFixed(2)}x startPrice ${savedStartPrice} (>${TARGET_MAX_RATIO}x ${isKR ? "KR" : "US"} cap) — clamped to ${capped}`
              );
              targetPrice = capped;
            } else if (tRatio < TARGET_MIN_RATIO) {
              const floored = Math.round(savedStartPrice * TARGET_MIN_RATIO);
              console.warn(
                `[analysis ${id}] target_price ${targetPrice} is ${tRatio.toFixed(2)}x startPrice ${savedStartPrice} (<${TARGET_MIN_RATIO}x ${isKR ? "KR" : "US"} floor) — clamped to ${floored}`
              );
              targetPrice = floored;
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

      await rawQuery(
        `UPDATE analyses SET status='completed', current_step=NULL, investment_verdict=$1,
         target_price=$2, entry_price=$3, stop_loss=$4, risk_reward_ratio=$5, updated_at=NOW()
         WHERE id=$6`,
        [investmentVerdict, targetPrice, entryPrice, stopLoss, riskRewardRatio, id]
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

      // ── QA 자동 채점 (백그라운드) ──────────────────────────────────────────
      (async () => {
        try {
          await pool.query(`
            ALTER TABLE analyses
              ADD COLUMN IF NOT EXISTS qa_score INTEGER,
              ADD COLUMN IF NOT EXISTS qa_flags TEXT
          `);
          const [aRes, sRes] = await Promise.all([
            pool.query(
              `SELECT investment_verdict, target_price, entry_price, stop_loss, risk_reward_ratio
               FROM analyses WHERE id = $1`, [id]
            ),
            pool.query(
              `SELECT step_key, content FROM analysis_steps WHERE analysis_id = $1`, [id]
            ),
          ]);
          if (aRes.rows[0]) {
            const a = aRes.rows[0];
            const qaResult = runQACheck({
              investmentVerdict: a.investment_verdict,
              targetPrice: a.target_price,
              entryPrice: a.entry_price,
              stopLoss: a.stop_loss,
              riskRewardRatio: a.risk_reward_ratio,
              steps: sRes.rows.map((r: any) => ({ stepKey: r.step_key, content: r.content ?? "" })),
            });
            await pool.query(
              `UPDATE analyses SET qa_score=$1, qa_flags=$2 WHERE id=$3`,
              [qaResult.score, JSON.stringify(qaResult.flags), id]
            );
            console.log(`[qa] #${id} 자동 채점 완료: ${qaResult.score}점 (${qaResult.grade})`);
          }
        } catch (e) {
          console.error(`[qa] #${id} 자동 채점 실패:`, e);
        }
      })();

      // ── 종목별 자동 학습 데이터 저장 ─────────────────────────────────────
      // 분석 완료 시마다 ticker_notes.auto_learning 업데이트 (누적)
      if (targetPrice && entryPrice && investmentVerdict) {
        try {
          const upsidePct = ((targetPrice - entryPrice) / entryPrice) * 100;
          const newEntry = {
            analysisId: id,
            date: new Date().toISOString().slice(0, 10),
            verdict: investmentVerdict,
            targetPrice,
            entryPrice,
            upsidePct: Math.round(upsidePct * 10) / 10,
          };

          // 기존 학습 데이터 가져오기
          const existingRows = await rawQuery(
            `SELECT auto_learning FROM ticker_notes WHERE ticker = $1`,
            [analysis.ticker]
          );

          let existing: { history?: typeof newEntry[] } = {};
          if (existingRows[0]?.auto_learning) {
            existing = existingRows[0].auto_learning as typeof existing;
          }
          const history = (existing.history ?? []).slice(-9); // 최대 10건 유지
          history.push(newEntry);

          await rawQuery(
            `INSERT INTO ticker_notes (ticker, memo, auto_learning, updated_at)
             VALUES ($1, '', $2, NOW())
             ON CONFLICT (ticker) DO UPDATE SET auto_learning = $2, updated_at = NOW()`,
            [analysis.ticker, JSON.stringify({ history })]
          );
          console.log(`[learning] Updated auto_learning for ${analysis.ticker} (${history.length} entries)`);
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
  runningPipelineIds.add(id);
  console.log(`[pipeline-bg] Starting background pipeline for analysis ${id}`);
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
        console.log(`[pipeline-bg] Running step ${nextStepKey} for analysis ${id}`);
        await executeStep(id, nextStepKey, analysis, existingSteps);
      } finally {
        runningStepsLock.delete(lockKey);
      }
    }
  } catch (err) {
    console.error(`[pipeline-bg] Error for analysis ${id}:`, err);
  } finally {
    runningPipelineIds.delete(id);
    console.log(`[pipeline-bg] Background pipeline complete for analysis ${id}`);
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
  if (analysis.status !== "in_progress") return res.json({ ok: true, status: analysis.status });

  runPipelineBackground(id).catch(console.error);
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

function formatStep(step: any) {
  return {
    id: step.id,
    analysisId: step.analysisId,
    stepKey: step.stepKey,
    agentName: step.agentName,
    agentRole: step.agentRole,
    content: step.content,
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
