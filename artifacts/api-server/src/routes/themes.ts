import { Router } from "express";
import { GoogleGenAI } from "@google/genai";

const router = Router();

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

interface TrendingTheme {
  id: string;
  name: string;
  description: string;
  emoji: string;
}

interface DiscoveredStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  rationale: string;
}

interface DiscoverResult {
  theme: string;
  summary: string;
  stocks: DiscoveredStock[];
}

let trendingCache: { themes: TrendingTheme[]; cachedAt: number } | null = null;
const TRENDING_TTL = 3 * 60 * 60 * 1000;

function safeParseJson<T>(text: string): T | null {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // 1) 전체 텍스트 직접 파싱 (마크다운 제거 후 순수 JSON인 경우)
  try { return JSON.parse(cleaned) as T; } catch {}
  // 2) 객체 추출
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]) as T; } catch {} }
  // 3) 배열 추출
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]) as T; } catch {} }
  return null;
}

const FALLBACK_THEMES: TrendingTheme[] = [
  { id: "hvdc_transformer",  name: "HVDC·변압기",      description: "데이터센터 전력 병목으로 수주 급증",   emoji: "⚡" },
  { id: "k_defense_export",  name: "K-방산 수출",      description: "트럼프 후 동맹 재편·수출 계약 급증",  emoji: "🛡️" },
  { id: "glp1_cmo",          name: "GLP-1 CMO",        description: "비만치료제 공급 부족·CMO 수주 폭증",  emoji: "💊" },
  { id: "shipbuilding_lng",  name: "조선 LNG선",       description: "LNG 운반선 수주잔고 역대 최고",       emoji: "🚢" },
  { id: "value_up_bank",     name: "밸류업 금융주",    description: "자사주 소각·배당 확대 정책 수혜",     emoji: "🏦" },
  { id: "ai_agent_infra",    name: "AI 에이전트 인프라", description: "추론 모델 확산으로 서버·스토리지 수요", emoji: "🤖" },
  { id: "tariff_reroute",    name: "관세 우회 물류",   description: "미중 관세로 공급망 재편·물류 수혜",   emoji: "🌐" },
  { id: "battery_solid",     name: "전고체 배터리",    description: "2027 양산 경쟁·소재·장비주 선반영",   emoji: "🔋" },
];

router.get("/themes/trending", async (_req, res) => {
  try {
    if (trendingCache && Date.now() - trendingCache.cachedAt < TRENDING_TTL) {
      return res.json(trendingCache.themes);
    }

    const today = new Date().toLocaleDateString("ko-KR", {
      year: "numeric", month: "long", day: "numeric",
    });

    const prompt = `${today} 기준으로 최근 1~2주간 한국·글로벌 주식시장에서 기관·외국인 수급이 실제로 몰린 테마와 섹터 8개를 선정해주세요.

조건:
- "AI 반도체", "바이오", "2차전지" 같은 상시 포괄 테마는 피하세요
- 구체적인 드라이버가 있는 테마여야 합니다 (예: 트럼프 관세 → K-방산 수출 수혜, 데이터센터 전력 부족 → HVDC·변압기, 비만치료제 GLP-1 확산 → CMO·원료의약품)
- 최근 실적·수주·정책 이슈로 섹터 로테이션이 일어난 경우 우선
- 한국 코스피·코스닥과 미국 시장을 모두 커버

마크다운 없이 아래 JSON 배열만 출력하세요:
[{"id":"영문_스네이크","name":"한글 테마명(10자 이내)","description":"수급 이유 한 줄(20자 이내)","emoji":"이모지"}]`;

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
    });

    const themes = safeParseJson<TrendingTheme[]>(resp.text ?? "");
    if (!themes || !Array.isArray(themes) || themes.length === 0) throw new Error("parse fail");

    trendingCache = { themes, cachedAt: Date.now() };
    return res.json(themes);
  } catch (e) {
    console.error("[themes/trending]", e);
    return res.json(FALLBACK_THEMES);
  }
});

router.post("/themes/discover", async (req, res) => {
  try {
    const { theme, market = "ALL" } = req.body as { theme: string; market?: string };
    if (!theme?.trim()) return res.status(400).json({ error: "테마를 입력해주세요." });

    const marketGuide =
      market === "KR"
        ? "⚠️ 반드시 한국 상장 주식(코스피·코스닥)만 추천하세요. 미국 주식은 절대 포함 금지. ticker는 반드시 6자리 숫자(예: 005930). market 필드는 반드시 \"KR\"."
        : market === "US"
        ? "⚠️ 반드시 미국 상장 주식(NYSE·NASDAQ)만 추천하세요. 한국 주식은 절대 포함 금지. ticker는 반드시 영문 심볼(예: NVDA). market 필드는 반드시 \"US\"."
        : "한국(코스피·코스닥)과 미국(NYSE·NASDAQ)을 적절히 혼합해 추천. ticker가 6자리 숫자면 KR, 영문 심볼이면 US로 market 필드 설정.";

    const prompt = `투자 테마: "${theme}"

이 테마의 수혜 상장 주식 6~8개를 선정하세요.
${marketGuide}

조건:
- 매출·사업구조가 테마와 직접 연결된 기업 우선
- 간접 수혜 포함 가능하나 연결고리를 한 문장으로 명확히
- 실제 상장된 정확한 ticker 사용

마크다운 없이 아래 JSON만 출력하세요:
{"theme":"${theme}","summary":"테마 한 줄 요약","stocks":[{"ticker":"005930","name":"삼성전자","market":"KR","sector":"반도체","rationale":"HBM3E 양산으로 AI 서버 메모리 최대 수혜"}]}`;

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
    });

    const result = safeParseJson<DiscoverResult>(resp.text ?? "");
    if (!result?.stocks?.length) throw new Error("parse fail");

    // 서버 사이드 필터: KR=6자리숫자, US=영문심볼
    if (market === "KR") {
      result.stocks = result.stocks.filter(s => /^\d{6}$/.test(s.ticker));
    } else if (market === "US") {
      result.stocks = result.stocks.filter(s => /^[A-Za-z]{1,5}$/.test(s.ticker));
    }
    if (!result.stocks.length) throw new Error("filter resulted in empty");

    return res.json(result);
  } catch (e) {
    console.error("[themes/discover]", e);
    return res.status(500).json({ error: "테마 발굴 중 오류가 발생했습니다. 다시 시도해주세요." });
  }
});

export default router;
