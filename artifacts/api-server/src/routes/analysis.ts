import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { analysesTable, analysisStepsTable, modelInsightsTable } from "@workspace/db";
import { getUserId, checkAndDeductCredit } from "../lib/credits.js";
import { loadKRXList, lookupKoreanName } from "../lib/krx-cache";
import { fetchDartSubjectBalance } from "../lib/peer-collector.js";
import { eq, desc, not, sql } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import YahooFinance from "yahoo-finance2";
import {
  AGENTS,
  STEP_ORDER,
  buildPrompt,
  type AgentKey,
} from "../lib/ai-agents.js";
import { triggerModelReview } from "./model-insights.js";

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
  // Use longer excerpt for relative_valuation so FINAL_VALUATION_DATA at end is captured
  const excerptLength = isRelativeValuation ? 6000 : 3000;
  const excerpt = content.slice(0, excerptLength);
  const fundamentalExtra = isFundamental ? `

5. 실적 전망 정합성 (실적 전망 단계 전용 필수 검증):
   - 재무 분석 섹션이 없으면: 불승인
   - 수익성 표(영업이익률 포함)가 없으면: 불승인 (단, 계산 불가 셀을 "—"으로 채운 경우는 통과)
   - 현금흐름 섹션이 아예 없으면: 불승인. 단, 현금흐름표 데이터가 없어 "N/A (컨텍스트에 현금흐름표 미제공)"으로 표기한 경우는 통과 허용
   - 재무건전성(부채비율 또는 순현금, 발행주식수)이 없으면: 불승인
   - Base 실적 추정 테이블(매출·영업이익·EBITDA·EPS 행)이 없으면: 불승인
   - EPS 수치가 아예 없으면: 불승인 (적자 기업의 음수 EPS는 유효, 추정값 명시 필요)
   - 밸류에이션을 위한 핵심 지표 도출 블록이 없으면: 불승인
   - 성장 동력 또는 리스크 요인 서술이 없으면: 불승인` : isRelativeValuation ? `

5. 목표가 산출 정합성 — 팀장 직접 조율 검수 (전용 필수 검증):

  [구조 검증 — 하나라도 없으면 즉시 불승인]
   - 절대가치 산출 표가 없으면: 불승인 (DCF FCFF 테이블 또는 Pipeline rNPV 테이블 또는 EV/Sales 테이블 또는 DDM 계산 중 하나)
   - 피어 그룹 멀티플 비교 테이블이 없으면: 불승인
   - FINAL_VALUATION_DATA JSON이 없거나 파싱 불가이면: 즉시 불승인
   - 최종 목표주가·상단 밴드·하단 밴드 3개 수치가 모두 명시되지 않으면: 불승인
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
   - 최종 목표주가가 상단 밴드보다 높거나 하단 밴드보다 낮으면: 불승인

  [극단값 방어]
   - 하단 밴드가 현재 주가의 20% 미만이면: 불승인` : "";

  const prompt = `당신은 AI 헤지펀드 리서치 팀의 Lead Portfolio Strategist(팀장)입니다.
아래는 ${agentName}가 ${companyName}(${ticker})에 대해 작성한 분석 보고서입니다.

[보고서]
${excerpt}

다음 기준으로 품질을 평가하세요:
1. 구체적 수치 인용 (시장 규모, 성장률, 점유율, 재무 수치 등)
2. 핵심 이슈와의 명확한 연결
3. 투자 판단에 도움되는 실행 가능한 인사이트
4. 분석 깊이 (표면적 나열 vs 인과관계 해석)${fundamentalExtra}

반드시 아래 JSON 형식으로만 응답하세요 (코드블록·설명 없이):
{"score": [1~10 정수], "approved": [7점 이상이면 true, 미만이면 false], "feedback": "미흡한 점 한 줄 요약 (approved이면 빈 문자열)"}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 256 },
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

  return { context: lines.join("\n"), naverSharesCalc };
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

async function fetchFinancialContext(resolvedSymbol: string): Promise<string> {
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

  const [summaryRes, tsRes] = await Promise.allSettled([
    yahooFinance.quoteSummary(resolvedSymbol, {
      modules: [
        "financialData",
        "defaultKeyStatistics",
        "summaryDetail",
        "incomeStatementHistory",
        "balanceSheetHistory",
        "cashflowStatementHistory",
        "earningsTrend",
        "institutionOwnership",
        "insiderTransactions",
      ] as any,
    }),
    fetch(tsUrl, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: AbortSignal.timeout(12000) })
      .then(r => r.ok ? r.json() : null),
  ]);

  if (summaryRes.status === "rejected") {
    console.error(`[financial-data] Failed for ${resolvedSymbol}:`, summaryRes.reason);
    return "";
  }
  result = summaryRes.value;

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
    if (ks.priceToBook != null)     lines.push(`P/B: ${ks.priceToBook.toFixed(2)}x`);
    if (ks.enterpriseToRevenue != null) lines.push(`EV/매출: ${ks.enterpriseToRevenue.toFixed(2)}x`);
    if (ks.enterpriseToEbitda != null)  lines.push(`EV/EBITDA: ${ks.enterpriseToEbitda.toFixed(2)}x`);
    if (ks.pegRatio != null)        lines.push(`PEG: ${ks.pegRatio.toFixed(2)}`);
    if (ks.beta != null)            lines.push(`베타: ${ks.beta.toFixed(2)}`);
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
        const codRaw = (debt != null && debt > 0) ? (intExp / debt) : null;
        if (codRaw != null && codRaw > 0.30) {
          // 이자비용 > 총부채(×0.3) → 부채 분류 오류 또는 이자 데이터 이상
          waccLines.push(
            `이자비용(Interest Expense, ${latestWaccYear}): ${fmtNum(intExp, currency)}` +
            `  ⚠️ [CoD 계산값 비정상] 역산 CoD(세전) = ${(codRaw * 100).toFixed(1)}% — ` +
            `이자비용(${fmtNum(intExp, currency)})이 총부채(${fmtNum(debt ?? 0, currency)})보다 큽니다. ` +
            `부채 분류 오류 또는 단기차입 미반영 의심. ` +
            `⛔ AI는 이 이자비용으로 CoD 계산하지 말 것 → 업종 시장 기본값 CoD(세전) 4~6% 사용.`
          );
        } else {
          waccLines.push(`이자비용(Interest Expense, ${latestWaccYear}): ${fmtNum(intExp, currency)}  ※ CoD 계산: 이자비용 ÷ 총부채`);
        }
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
    if (waccLines.length > 0) {
      lines.push("\n[⚡ WACC·EBITDA 계산 핵심 데이터 — 반드시 아래 수치를 사용할 것]");
      lines.push("※ CoD = 이자비용 ÷ 총부채, EBITDA = 영업이익 + D&A (추정 금지, 아래 수치 직접 사용)");
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
    for (const t of trends.slice(0, 4)) {
      const period  = t.period ?? "?";
      const epsAvg  = t.earningsEstimate?.avg?.toFixed(2) ?? "-";
      const epsLow  = t.earningsEstimate?.low?.toFixed(2) ?? "-";
      const epsHigh = t.earningsEstimate?.high?.toFixed(2) ?? "-";
      const revAvg  = t.revenueEstimate?.avg ? fmtNum(t.revenueEstimate.avg, currency) : "-";
      const growth  = t.earningsEstimate?.growth != null ? pct(t.earningsEstimate.growth) : "-";
      lines.push(`  ${period}: EPS ${epsAvg} (${epsLow}~${epsHigh}), 매출 ${revAvg}, 성장률 ${growth}`);
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

  // 섹터 벤치마크 멀티플 (밸류에이션 단계에서 피어 비교 시 사용)
  lines.push(KOREAN_SECTOR_MULTIPLES);

  const text = lines.join("\n");
  console.log(`[financial-data] Fetched ${text.length} chars for ${resolvedSymbol}`);
  return text;
}

// ─── Company news fetching (Google News RSS) ─────────────────────────────────

async function fetchCompanyNews(companyName: string): Promise<string> {
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
    return lines.join("\n");
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
- For pipeline-only biotechs (pre-revenue or minimal revenue), prefer peers that are also pre-revenue or early-commercial stage with similar therapeutic area and modality (RNA, cell therapy, small molecule, etc.)
- If a strictly comparable peer set cannot be found in Korea, include 1-2 US-listed peers of similar stage and modality.

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
        systemInstruction: "You are a financial analyst. Respond with a valid JSON object only.",
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    });
    const raw = resp.text ?? "";
    console.log(`[peer-select] Raw response (first 500): ${raw.slice(0, 500)}`);

    // Try direct parse first (JSON mode response)
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = extractJsonSafe(raw);
    }

    if (parsed?.peers && Array.isArray(parsed.peers) && parsed.peers.length > 0) {
      console.log(`[peer-select] Success: ${parsed.peers.length} peers`);
      return parsed.peers.slice(0, 5);
    }
    console.warn(`[peer-select] No valid peers in response: ${JSON.stringify(parsed)}`);
  } catch (err) {
    console.error("[peer-select] Failed:", err);
  }
  return [];
}

async function fetchPeerFinancials(
  peers: Array<{ ticker: string; name: string; exchange: string; reason?: string }>
): Promise<string> {
  if (peers.length === 0) return "";

  const rows: string[] = [];
  rows.push("\n=== 피어 그룹 실시간 재무 데이터 (Yahoo Finance) ===");
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

        // 시가총액 & 가격
        const currency = quote.currency ?? pr.currency ?? "USD";
        const isKrw = currency === "KRW";
        const price = quote.regularMarketPrice ?? pr.regularMarketPrice ?? null;
        const mcap = quote.marketCap ?? pr.marketCap ?? sd.marketCap ?? null;
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
        // PER Fwd: earningsTrend '0y' 또는 '+1y' 트렌드에서 FY EPS 추출 후 계산
        let fwdPE: number | null = ks.forwardPE ?? sd.forwardPE ?? null;
        if (fwdPE == null && price != null) {
          const trend1y = et.trend?.find((t: any) => t.period === "+1y");
          const trend0y = et.trend?.find((t: any) => t.period === "0y");
          const fwdEps = trend1y?.earningsEstimate?.avg ?? trend0y?.earningsEstimate?.avg ?? null;
          if (fwdEps != null && fwdEps > 0) fwdPE = price / fwdEps;
        }

        // PER TTM: 직접 제공 → market cap / net income 계산
        let trailPE: number | null = sd.trailingPE ?? ks.trailingPE ?? quote.trailingPE ?? null;
        if (trailPE == null && mcap != null && netIncome != null && netIncome > 0) {
          trailPE = mcap / netIncome;
        }

        // PBR: priceToBook → market cap / 자본총계
        let pbr: number | null = ks.priceToBook ?? null;
        if (pbr == null && mcap != null && totalEquity != null && totalEquity > 0) {
          pbr = mcap / totalEquity;
        }

        // EV 계산: enterpriseValue 직접 제공 → market cap + 순부채
        const ev: number | null = ks.enterpriseValue != null
          ? ks.enterpriseValue
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
        const roe = fd.returnOnEquity
          ?? (netIncome != null && totalEquity != null && totalEquity > 0 ? netIncome / totalEquity : null);
        const opMargin = fd.operatingMargins
          ?? (opIncome != null && totalRevenue != null && totalRevenue > 0 ? opIncome / totalRevenue : null);
        const revGrowth  = fd.revenueGrowth  ?? null;
        const grossMargin = fd.grossMargins  ?? null;
        const netMargin  = fd.profitMargins
          ?? (netIncome != null && totalRevenue != null && totalRevenue > 0 ? netIncome / totalRevenue : null);

        const line = [
          `[${peer.name} (${peer.ticker}) — ${peer.exchange ?? ""}]`,
          peer.reason ? `  선정 이유: ${peer.reason}` : null,
          `  시가총액: ${mcapStr}${price ? ` | 현재가: ${isKrw ? Math.round(price).toLocaleString() : price.toFixed(2)} ${currency}` : ""}`,
          `  PER(Fwd): ${fmt1(fwdPE)}x | PER(TTM): ${fmt1(trailPE)}x | PBR: ${fmt2(pbr)}x | EV/EBITDA: ${fmt1(evEbitda)}x | EV/매출: ${fmt2(evRev)}x`,
          `  ROE: ${pct(roe)} | 영업이익률: ${pct(opMargin)} | 순이익률: ${pct(netMargin)} | 매출총이익률: ${pct(grossMargin)} | 매출성장률(YoY): ${pct(revGrowth)}`,
          `  매출(TTM): ${fmtAbs(totalRevenue, isKrw)} | 영업이익: ${fmtAbs(opIncome, isKrw)} | 순이익: ${fmtAbs(netIncome, isKrw)} | EBITDA: ${fmtAbs(ebitda, isKrw)}`,
          `  자본총계: ${fmtAbs(totalEquity, isKrw)} | 총부채: ${fmtAbs(totalDebt, isKrw)} | 현금: ${fmtAbs(cash, isKrw)}`,
        ].filter(Boolean).join("\n");
        return line;
      } catch (err) {
        return `[${peer.name} (${peer.ticker})] 데이터 수집 실패: ${String(err).slice(0, 120)}`;
      }
    })
  );

  for (const r of results) {
    rows.push(r.status === "fulfilled" ? r.value : `[데이터 오류] ${r.reason}`);
    rows.push("");
  }

  const text = rows.join("\n");
  console.log(`[peer-data] Fetched ${peers.length} peers, ${text.length} chars`);
  return text;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

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

  const userId = getUserId(req);
  if (userId) {
    const credit = await checkAndDeductCredit(userId);
    if (!credit.ok) {
      res.status(402).json({ error: credit.reason });
      return;
    }
  }

  const upperTicker = ticker.toUpperCase();
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

  // Fetch financial data, news, DART balance sheet in parallel
  const [financialData, newsData, dartBalance] = await Promise.all([
    fetchFinancialContext(resolvedSymbol),
    fetchCompanyNews(companyName ?? ""),
    isKoreanTicker ? fetchDartSubjectBalance(krxCode) : Promise.resolve(null),
  ]);

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

    dartBalanceContext = [
      `\n[⭐ DART 사업보고서 재무상태표 — ${dartBalance.year}년 ${dartBalance.fsType === "CFS" ? "연결" : "별도"} 기준]`,
      `⚠️ 이 데이터는 DART OpenAPI 원천 데이터입니다. Yahoo Finance 수치와 다를 경우 이 값을 우선 사용하세요.`,
      `현금및현금성자산: ${fmtKrw(dartBalance.cash)}`,
      `자산총계: ${fmtKrw(dartBalance.totalAssets)}`,
      `부채총계(DART전체): ${fmtKrw(dartBalance.totalLiab)}  ※ 매입채무·충당부채 등 영업부채 포함, 순현금 계산엔 금융부채만 사용`,
      `자본총계: ${fmtKrw(dartBalance.equity)}`,
      dartBalance.totalDebt != null ? `금융부채(차입금+사채+리스 합계): ${fmtKrw(dartBalance.totalDebt)}` : `금융부채: 개별 차입금·사채 항목 미검출 (무차입/소액 차입 가능성)`,
      `순현금/순부채: ${netDebtStr}`,
    ].filter(Boolean).join("\n");
  }

  const userContext = additionalContext ?? null;
  const fullContext = [
    financialData,
    dartBalanceContext,
    newsData,
    userContext ? `[사용자 추가 컨텍스트]\n${userContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n") || null;

  const [analysis] = await db
    .insert(analysesTable)
    .values({
      userId: userId ?? null,
      ticker: upperTicker,
      companyName,
      englishName,
      industry,
      additionalContext: fullContext,
      status: "in_progress",
      currentStep: "company_intro",
      isPublic: "true",
    })
    .returning();

  res.json(formatAnalysis(analysis, []));
});

router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const analyses = await db
      .select()
      .from(analysesTable)
      .where(userId ? eq(analysesTable.userId, userId) : sql`1=0`)
      .orderBy(desc(analysesTable.createdAt));

    const results = await Promise.all(
      analyses.map(async (a) => {
        const steps = await db
          .select()
          .from(analysisStepsTable)
          .where(eq(analysisStepsTable.analysisId, a.id));
        return formatAnalysis(a, steps);
      })
    );

    res.json(results);
  } catch (err: any) {
    console.error("[GET /analysis] DB error:", err?.message, err?.cause);
    res.status(500).json({ error: "Database query failed", detail: err?.message });
  }
});

router.delete("/", async (_req, res) => {
  await db.delete(analysisStepsTable);
  await db.delete(analysesTable);
  res.json({ success: true });
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const userId = getUserId(req);
  const [analysis] = await db.select().from(analysesTable).where(eq(analysesTable.id, id)).limit(1);
  if (!analysis) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (analysis.userId && analysis.userId !== userId) {
    res.status(403).json({ error: "권한이 없습니다" });
    return;
  }
  await db.delete(analysisStepsTable).where(eq(analysisStepsTable.analysisId, id));
  await db.delete(analysesTable).where(eq(analysesTable.id, id));
  res.json({ success: true });
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const analysis = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.id, id))
    .limit(1);

  if (!analysis[0]) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const steps = await db
    .select()
    .from(analysisStepsTable)
    .where(eq(analysisStepsTable.analysisId, id));

  res.json(formatAnalysis(analysis[0], steps));
});

router.post("/:id/step", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { stepKey } = req.body as { stepKey: AgentKey };
  if (!stepKey || !AGENTS[stepKey]) {
    res.status(400).json({ error: "Invalid stepKey" });
    return;
  }

  const [analysis] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.id, id))
    .limit(1);

  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  const rawSteps = await db
    .select()
    .from(analysisStepsTable)
    .where(eq(analysisStepsTable.analysisId, id));

  // STEP_ORDER 순서로 정렬하고, 현재 단계 이전 단계만 context로 전달
  const existingSteps = [...rawSteps].sort(
    (a, b) => STEP_ORDER.indexOf(a.stepKey as AgentKey) - STEP_ORDER.indexOf(b.stepKey as AgentKey)
  );

  const alreadyRun = existingSteps.some((s) => s.stepKey === stepKey);
  if (alreadyRun) {
    res.status(409).json({ error: "Step already completed" });
    return;
  }

  const lockKey = `${id}-${stepKey}`;
  if (runningStepsLock.get(lockKey)) {
    res.status(409).json({ error: "Step already running" });
    return;
  }
  runningStepsLock.set(lockKey, true);

  // SSE streaming headers — send before anything else
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const agent = AGENTS[stepKey];

  let enrichedContext = analysis.additionalContext ?? null;
  if (stepKey === "company_intro" || stepKey === "investment_strategy") {
    try {
      const insights = await db
        .select()
        .from(modelInsightsTable)
        .where(not(eq(modelInsightsTable.outcome, "pending")));

      const relevantLessons = insights
        .filter((i) => i.lesson && i.lesson.trim())
        .slice(-5)
        .map((i) => `[${i.companyName}(${i.ticker}) ${i.daysElapsed}일, ${i.priceReturn?.toFixed(1)}%] ${i.lesson}`)
        .join("\n");

      if (relevantLessons) {
        const lessonBlock = `\n\n[AI 모델 과거 교훈]\n${relevantLessons}`;
        enrichedContext = enrichedContext ? enrichedContext + lessonBlock : lessonBlock;
      }
    } catch {
      // insights injection optional
    }
  }

  // ── relative_valuation: 피어 데이터 자동 수집 ────────────────────────────
  if (stepKey === "relative_valuation") {
    try {
      // prevContext를 5000자로 확장 — 기업 브리핑·산업 분석이 충분히 포함되도록
      const prevContext = existingSteps.map((s) => s.content).join("\n").slice(0, 5000);
      res.write(`data: ${JSON.stringify({ t: "" })}\n\n`); // keep connection alive

      let peers = await selectPeerTickers(analysis.companyName, analysis.industry, prevContext);
      console.log(`[peer-select] Selected ${peers.length} peers:`, peers.map((p) => p.ticker).join(", "));

      // 피어 선정 실패 시 1회 재시도 (더 많은 컨텍스트)
      if (peers.length === 0) {
        console.warn("[peer-select] 1st attempt returned 0 peers — retrying with full context");
        const fullContext = existingSteps.map((s) => s.content).join("\n").slice(0, 3000);
        peers = await selectPeerTickers(analysis.companyName, analysis.industry ?? "바이오/제약", fullContext);
        console.log(`[peer-select] Retry selected ${peers.length} peers`);
      }

      // US 주식 전용: AI 선택 실패 시 하드코딩 피어 맵으로 대체
      const tickerKrxCode = analysis.ticker.split(".")[0];
      const isKoreanTicker = /^\d{6}$/.test(tickerKrxCode);
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

  const { systemPrompt, userPrompt } = buildPrompt(
    stepKey,
    analysis.ticker,
    analysis.companyName,
    analysis.industry,
    enrichedContext,
    previousStepsForContext
  );

  let content = "";
  try {
    const maxOutputTokens =
      (stepKey === "company_analysis" || stepKey === "relative_valuation") ? 32768 : 16384;

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
          res.write(`data: ${JSON.stringify({ t: "" })}\n\n`); // keep-alive
          await new Promise((r) => setTimeout(r, waitMs));
        }

        const stream = await ai.models.generateContentStream({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          config: {
            systemInstruction: systemPrompt,
            maxOutputTokens,
          },
        });
        let lastFinishReason: string | undefined;
        for await (const chunk of stream) {
          const text = chunk.text ?? "";
          if (text) {
            content += text;
            res.write(`data: ${JSON.stringify({ t: text })}\n\n`);
          }
          const reason = chunk.candidates?.[0]?.finishReason;
          if (reason) lastFinishReason = reason;
        }
        if (lastFinishReason === "MAX_TOKENS") {
          console.warn(`[${stepKey}] 응답이 MAX_TOKENS(${maxOutputTokens})로 잘림`);
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
      res.write(`data: ${JSON.stringify({ error: content })}\n\n`);
    }

    // ── Lead Portfolio Strategist QC ──────────────────────────────────────────
    let finalContent = content;
    let validationNotes: string | null = null;

    if (QC_STEPS.has(stepKey) && content && !content.startsWith("분석 오류")) {
      res.write(`data: ${JSON.stringify({ qc: "checking" })}\n\n`);
      const qcResult = await runQCCheck(stepKey, content, analysis.companyName, analysis.ticker);
      console.log(`[QC] ${stepKey} score=${qcResult.score} approved=${qcResult.approved}`);

      if (!qcResult.approved) {
        res.write(`data: ${JSON.stringify({ qc: "revising", score: qcResult.score, feedback: qcResult.feedback })}\n\n`);
        try {
          const revisedUserPrompt = userPrompt +
            `\n\n---\n[팀장 재검토 지시 — 반드시 보완하세요]\n${qcResult.feedback}\n위 사항을 명확히 보완하여 더 완성도 높은 분석을 다시 작성하세요.`;
          const revisedMaxTokens = stepKey === "company_analysis" ? 32768 : 16384;
          const revisedStream = await ai.models.generateContentStream({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: revisedUserPrompt }] }],
            config: { systemInstruction: systemPrompt, maxOutputTokens: revisedMaxTokens },
          });
          let revisedContent = "";
          for await (const chunk of revisedStream) {
            const text = chunk.text ?? "";
            if (text) {
              revisedContent += text;
              res.write(`data: ${JSON.stringify({ t: text, revised: true })}\n\n`);
            }
          }
          if (revisedContent) finalContent = revisedContent;
          validationNotes = `팀장 재검토 완료 (초기 점수: ${qcResult.score}/10, 사유: ${qcResult.feedback})`;
          res.write(`data: ${JSON.stringify({ qc: "revised", score: qcResult.score })}\n\n`);
        } catch (err) {
          console.error("[QC] revision error:", err);
          validationNotes = `QC 완료 (점수: ${qcResult.score}/10)`;
          res.write(`data: ${JSON.stringify({ qc: "approved", score: qcResult.score })}\n\n`);
        }
      } else {
        validationNotes = `팀장 검토 통과 (점수: ${qcResult.score}/10)`;
        res.write(`data: ${JSON.stringify({ qc: "approved", score: qcResult.score })}\n\n`);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const [step] = await db
      .insert(analysisStepsTable)
      .values({
        analysisId: id,
        stepKey,
        agentName: agent.name,
        agentRole: agent.role,
        content: finalContent,
        validationNotes,
        informationType: "data_based_estimate",
      })
      .returning();

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

        if (targetPrice && entryPrice && stopLoss && entryPrice !== stopLoss) {
          riskRewardRatio = Math.abs((targetPrice - entryPrice) / (entryPrice - stopLoss));
        }

        const rr = json.risk_reward;
        if (!riskRewardRatio && rr) {
          const m = String(rr).match(/[\d.]+/g);
          if (m && m.length >= 2) riskRewardRatio = parseFloat(m[1]) / parseFloat(m[0]);
        }
      } catch {
        // JSON parse failed
      }

      await db
        .update(analysesTable)
        .set({
          status: "completed",
          currentStep: null,
          investmentVerdict,
          targetPrice,
          entryPrice,
          stopLoss,
          riskRewardRatio,
          updatedAt: new Date(),
        })
        .where(eq(analysesTable.id, id));

      triggerModelReview().catch(console.error);
    } else if (nextStep) {
      await db
        .update(analysesTable)
        .set({ currentStep: nextStep, updatedAt: new Date() })
        .where(eq(analysesTable.id, id));
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } finally {
    runningStepsLock.delete(lockKey);
  }
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
    await db.update(analysesTable).set({ memo: memo ?? null, updatedAt: new Date() }).where(eq(analysesTable.id, id));
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
    entryPrice: analysis.entryPrice,
    stopLoss: analysis.stopLoss,
    riskRewardRatio: analysis.riskRewardRatio,
    memo: analysis.memo ?? null,
    steps: sortedSteps.map(formatStep),
    createdAt: analysis.createdAt?.toISOString?.() ?? analysis.createdAt,
    updatedAt: analysis.updatedAt?.toISOString?.() ?? analysis.updatedAt,
  };
}

export default router;
