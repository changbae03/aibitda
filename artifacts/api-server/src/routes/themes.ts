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
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const raw = arrMatch?.[0] ?? objMatch?.[0];
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

const FALLBACK_THEMES: TrendingTheme[] = [
  { id: "ai_semiconductor", name: "AI 반도체",        description: "HBM·패키징·전력반도체 수혜주",            emoji: "🤖" },
  { id: "k_defense",        name: "K-방산",           description: "글로벌 방산 수출 모멘텀 지속",            emoji: "🛡️" },
  { id: "shipbuilding",     name: "조선 슈퍼사이클",   description: "LNG·친환경선 수주잔고 사상 최고",          emoji: "🚢" },
  { id: "value_up",         name: "밸류업 수혜",       description: "자사주 소각·배당 확대 금융·지주사",        emoji: "📈" },
  { id: "data_center",      name: "데이터센터 전력",   description: "AI 수요로 전력·냉각 인프라 급성장",        emoji: "⚡" },
  { id: "obesity_drug",     name: "비만치료제",        description: "GLP-1 수요 확대 바이오·CMO 수혜",          emoji: "💊" },
  { id: "tariff_winner",    name: "관세 수혜주",       description: "미중 무역갈등 속 반사이익 기업",           emoji: "🌐" },
  { id: "battery_recovery", name: "2차전지 턴어라운드", description: "전기차 수요 회복으로 배터리주 반등",       emoji: "🔋" },
];

router.get("/themes/trending", async (_req, res) => {
  try {
    if (trendingCache && Date.now() - trendingCache.cachedAt < TRENDING_TTL) {
      return res.json(trendingCache.themes);
    }

    const today = new Date().toLocaleDateString("ko-KR", {
      year: "numeric", month: "long", day: "numeric",
    });

    const prompt = `오늘(${today}) 기준으로 한국·글로벌 주식시장에서 수급이 몰리거나 뉴스에서 부각되는 투자 테마 8개를 선정해주세요.
마크다운 없이 아래 JSON 배열만 출력하세요:
[{"id":"영문_스네이크","name":"한글 테마명","description":"15자 이내 한 줄 설명","emoji":"이모지"}]`;

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
        ? "한국 상장 주식(코스피·코스닥)만 추천. ticker는 6자리 숫자(예: 005930)."
        : market === "US"
        ? "미국 상장 주식(NYSE·NASDAQ)만 추천. ticker는 영문 심볼(예: NVDA)."
        : "한국(코스피·코스닥)과 미국(NYSE·NASDAQ)을 적절히 혼합해 추천.";

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

    return res.json(result);
  } catch (e) {
    console.error("[themes/discover]", e);
    return res.status(500).json({ error: "테마 발굴 중 오류가 발생했습니다. 다시 시도해주세요." });
  }
});

export default router;
