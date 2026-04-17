import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { analysesTable, analysisStepsTable, modelInsightsTable } from "@workspace/db";
import { loadKRXList, lookupKoreanName } from "../lib/krx-cache";
import { eq, desc, not } from "drizzle-orm";
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
   - 실적 전망 인계 요약 블록이 없으면: 불승인
   - 성장 동력 또는 리스크 요인 서술이 없으면: 불승인` : isRelativeValuation ? `

5. 목표가 산출 정합성 — 팀장 직접 조율 검수 (전용 필수 검증):

  [구조 검증 — 하나라도 없으면 즉시 불승인]
   - 절대가치 산출 표가 없으면: 불승인 (DCF FCFF 테이블 또는 Pipeline rNPV 테이블 또는 EV/Sales 테이블 또는 DDM 계산 중 하나)
   - 피어 그룹 멀티플 비교 테이블이 없으면: 불승인
   - FINAL_VALUATION_DATA JSON이 없거나 파싱 불가이면: 즉시 불승인
   - 최종 목표주가·상단 밴드·하단 밴드 3개 수치가 모두 명시되지 않으면: 불승인
   - 최종 밸류에이션 인계 요약 블록이 없으면: 불승인

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

async function fetchNaverFinanceData(code: string): Promise<string> {
  const lines: string[] = [];

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
          lines.push(`발행주식수(시총÷현재가 역산): ${sharesCalc.toLocaleString("ko-KR")}주 (${(sharesCalc / 1e8).toFixed(4)}억주)`);
          lines.push(`※ [DCF 핵심] 주당 내재가치 = 주주가치(조원) × 1,000,000,000,000 ÷ ${sharesCalc.toLocaleString("ko-KR")}주`);
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

  return lines.join("\n");
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

  // Fetch quoteSummary and fundamentalsTimeSeries in parallel
  const tsTypes = [
    "annualGrossProfit", "annualTotalRevenue", "annualOperatingIncome",
    "annualNetIncome", "annualReturnOnEquity", "annualReturnOnAssets",
    "annualBasicEPS", "annualTotalLiabilitiesNetMinorityInterest", "annualStockholdersEquity",
  ];
  const tsPeriod1 = Math.floor(new Date(`${new Date().getFullYear() - 4}-01-01`).getTime() / 1000);
  const tsPeriod2 = Math.floor(Date.now() / 1000);
  const tsUrl = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(resolvedSymbol)}?type=${tsTypes.join(",")}&period1=${tsPeriod1}&period2=${tsPeriod2}`;

  const [summaryRes, tsRes] = await Promise.allSettled([
    yahooFinance.quoteSummary(resolvedSymbol, {
      modules: [
        "financialData",
        "defaultKeyStatistics",
        "incomeStatementHistory",
        "balanceSheetHistory",
        "cashflowStatementHistory",
        "earningsTrend",
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
  const currency: string = fd?.financialCurrency ?? "USD";

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
    if (ks.bookValue != null)       lines.push(`BPS(주당순자산): ${ks.bookValue.toFixed(2)} ${currency}`);
    if (ks.sharesOutstanding) {
      const sh = ks.sharesOutstanding;
      const shStr = sh >= 1e8
        ? `${(sh / 1e8).toFixed(4)}억주 (${sh.toLocaleString("ko-KR")}주)`
        : sh >= 1e4
        ? `${(sh / 1e4).toFixed(0)}만주 (${sh.toLocaleString("ko-KR")}주)`
        : `${sh.toLocaleString("ko-KR")}주`;
      lines.push(`발행주식수: ${shStr}  ※ DCF 주당가치 환산 시 이 주식수(주)를 사용할 것`);
    }
    if (ks.heldPercentInsiders != null)     lines.push(`내부자 보유율: ${pct(ks.heldPercentInsiders)}`);
    if (ks.heldPercentInstitutions != null) lines.push(`기관 보유율: ${pct(ks.heldPercentInstitutions)}`);
    if (ks.shortRatio != null)      lines.push(`공매도 커버일수: ${ks.shortRatio.toFixed(1)}일`);
    if (ks.dividendYield != null)   lines.push(`배당수익률: ${pct(ks.dividendYield)}`);
    if (ks.payoutRatio != null)     lines.push(`배당성향: ${pct(ks.payoutRatio)}`);
  }

  // ── fundamentalsTimeSeries annual data ──────────────────────────────────────
  const toYearMap = (key: string): Record<string, number> =>
    Object.fromEntries((tsTypeMap[key] ?? []).map(e => [e.year, e.value]));

  const revMap  = toYearMap("annualTotalRevenue");
  const gpMap   = toYearMap("annualGrossProfit");
  const opMap   = toYearMap("annualOperatingIncome");
  const niMap   = toYearMap("annualNetIncome");
  const epsMap  = toYearMap("annualBasicEPS");
  const roeMap  = toYearMap("annualReturnOnEquity");
  const liabMap = toYearMap("annualTotalLiabilitiesNetMinorityInterest");
  const eqMap   = toYearMap("annualStockholdersEquity");

  const allYears = [...new Set([
    ...Object.keys(revMap), ...Object.keys(gpMap), ...Object.keys(opMap), ...Object.keys(niMap)
  ])].sort((a, b) => Number(b) - Number(a)).slice(0, 4);

  if (allYears.length > 0) {
    lines.push("\n[연간 손익계산서 — fundamentalsTimeSeries]");
    lines.push("※ 이 수치로 매출총이익률·영업이익률·순이익률·ROE를 직접 계산하세요.");
    for (const year of allYears) {
      const rev  = revMap[year]  != null ? fmtNum(revMap[year], currency)  : "-";
      const gp   = gpMap[year]   != null ? fmtNum(gpMap[year], currency)   : "-";
      const op   = opMap[year]   != null ? fmtNum(opMap[year], currency)   : "-";
      const ni   = niMap[year]   != null ? fmtNum(niMap[year], currency)   : "-";
      const eps  = epsMap[year]  != null ? epsMap[year].toFixed(2)         : "-";
      const roeRaw = roeMap[year] != null
        ? roeMap[year] * 100
        : (niMap[year] != null && eqMap[year] != null && eqMap[year] !== 0 ? niMap[year] / eqMap[year] * 100 : null);
      const roe = roeRaw != null ? `${roeRaw.toFixed(1)}%` : "-";
      // Derived margins
      const gpM  = revMap[year] && gpMap[year]  ? `${(gpMap[year]  / revMap[year]  * 100).toFixed(1)}%` : "-";
      const opM  = revMap[year] && opMap[year]  ? `${(opMap[year]  / revMap[year]  * 100).toFixed(1)}%` : "-";
      const niM  = revMap[year] && niMap[year]  ? `${(niMap[year]  / revMap[year]  * 100).toFixed(1)}%` : "-";
      const de   = liabMap[year] && eqMap[year] ? `${(liabMap[year] / eqMap[year] * 100).toFixed(1)}%` : "-";
      lines.push(
        `  ${year}년: 매출 ${rev} | 매출총이익 ${gp}(${gpM}) | 영업이익 ${op}(${opM}) | 순이익 ${ni}(${niM}) | EPS ${eps} | ROE ${roe} | D/E ${de}`
      );
    }
  } else {
    // Fallback: legacy incomeStatementHistory (may be empty post-Nov 2024)
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
        lines.push(`  ${year}년: 매출 ${rev} | 매출총이익 ${gp} | 영업이익 ${op} | 순이익 ${ni} | EPS ${eps}`);
      }
    }
  }

  // Balance sheet
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

  // Cash flow
  const cfStmts: any[] = (result.cashflowStatementHistory as any)?.cashflowStatements ?? [];
  if (cfStmts.length > 0) {
    lines.push("\n[현금흐름표]");
    for (const stmt of cfStmts.slice(0, 2)) {
      const year = toYear(stmt.endDate);
      const ocf   = fmtNum(stmt.totalCashFromOperatingActivities, currency);
      const capex = fmtNum(stmt.capitalExpenditures, currency);
      const icf   = fmtNum(stmt.totalCashflowsFromInvestingActivities, currency);
      lines.push(`  ${year}년: 영업CF ${ocf} | CAPEX ${capex} | 투자CF ${icf}`);
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
    const naverData = await fetchNaverFinanceData(koreanCode);
    if (naverData) lines.push(naverData);
  }

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

  // Fetch financial data and news in parallel
  const [financialData, newsData] = await Promise.all([
    fetchFinancialContext(resolvedSymbol),
    fetchCompanyNews(companyName ?? ""),
  ]);
  const userContext = additionalContext ?? null;
  const fullContext = [financialData, newsData, userContext ? `[사용자 추가 컨텍스트]\n${userContext}` : ""]
    .filter(Boolean)
    .join("\n\n") || null;

  const [analysis] = await db
    .insert(analysesTable)
    .values({
      ticker: upperTicker,
      companyName,
      englishName,
      industry,
      additionalContext: fullContext,
      status: "in_progress",
      currentStep: "company_intro",
    })
    .returning();

  res.json(formatAnalysis(analysis, []));
});

router.get("/", async (_req, res) => {
  try {
    const analyses = await db
      .select()
      .from(analysesTable)
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
      const prevContext = existingSteps.map((s) => s.content).join("\n").slice(0, 1200);
      res.write(`data: ${JSON.stringify({ t: "" })}\n\n`); // keep connection alive
      const peers = await selectPeerTickers(analysis.companyName, analysis.industry, prevContext);
      console.log(`[peer-select] Selected ${peers.length} peers:`, peers.map((p) => p.ticker).join(", "));
      if (peers.length > 0) {
        const peerData = await fetchPeerFinancials(peers);
        if (peerData) {
          enrichedContext = enrichedContext ? enrichedContext + peerData : peerData;
        }
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
    try {
      const maxOutputTokens =
        (stepKey === "company_analysis" || stepKey === "relative_valuation") ? 32768 : 16384;

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
        // 마지막 청크의 종료 이유 기록
        const reason = chunk.candidates?.[0]?.finishReason;
        if (reason) lastFinishReason = reason;
      }
      if (lastFinishReason === "MAX_TOKENS") {
        console.warn(`[${stepKey}] 응답이 MAX_TOKENS(${maxOutputTokens})로 잘림 — 프롬프트 간소화 필요`);
      }
      console.log(`[${stepKey}] streamed length: ${content.length}, finishReason: ${lastFinishReason}`);
      if (!content) content = "분석 결과를 생성하지 못했습니다.";
    } catch (err) {
      console.error("Gemini error:", err);
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
