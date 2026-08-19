import { GoogleGenAI } from "@google/genai";
import { searchThemeStocks, type ThemeHit } from "./theme-search.js";


/**
 * **간밤 재료로 만들어진 테마.**
 *
 * 테마 흐름은 어제까지의 기관·외국인 순매수로 만들어진다. 그래서 간밤 미국에서 나온
 * 재료(모더나·머크 암백신 3상 성공)는 아무 데도 안 나타난다 — 국내 수급은 아직
 * 그 재료를 모르기 때문이다. 하루 늦다.
 *
 * 여기서는 반대로 간다. 간밤 뉴스에서 **회사가 쓸 만한 말**을 뽑아, 그 말을 자기
 * 사업보고서에 적어둔 국내 종목을 찾는다. 뉴스가 "수혜주"라고 부르기 전에,
 * 공시에 이미 적혀 있는 관계다.
 *
 * ⚠️ 예측이 아니다. "오른다"고 말하지 않는다 — 적중률을 재는 장치가 아직 없다.
 * 간밤 재료와 공시 근거까지만 보여주고 판단은 사용자에게 남긴다.
 */
export interface OvernightTheme {
  /** 간밤에 무슨 일이 있었나 — 한 줄 */
  headline: string;
  /** 그 재료를 국내 공시에서 찾을 때 쓴 말 */
  keywords: string[];
  stocks: Array<{ ticker: string; name: string; snippet: string }>;
}

interface Seed { headline: string; keywords: string[] }

/** 간밤 뉴스 → 국내 공시에서 찾을 말. 못 뽑으면 빈 배열(억지로 만들지 않는다). */
async function extractSeeds(headlines: string): Promise<Seed[]> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey || !headlines.trim()) return [];

  const prompt = `간밤 미국 시장 뉴스입니다.

${headlines.slice(0, 6000)}

이 중 **한국 상장사에 영향이 갈 만한 재료**를 최대 3개 고르세요.
각 재료마다, 한국 회사가 **자기 사업보고서에 쓸 법한 말**을 3~5개 뽑으세요.

- 모더나 암백신 3상 성공 → mRNA, 지질나노입자, LNP, 항암백신
- 엔비디아 신형 GPU 발표 → HBM, 고대역폭메모리, 인터포저, 테스트소켓

지켜야 할 것:
- **회사가 파는 제품·서비스의 이름**이어야 합니다. 미국 회사 이름(모더나·엔비디아)은 금지 —
  한국 공시에 그 이름은 안 적혀 있습니다.
- 한 가지 뜻으로만 읽히는 말. "플랫폼·솔루션·시스템" 같은 말 금지.
- 마땅한 재료가 없으면 빈 배열을 주세요. **억지로 만들지 마세요.**

JSON 배열로만 답하세요:
[{"headline":"모더나·머크 암백신 3상 성공","keywords":["mRNA","지질나노입자","항암백신"]}]`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 1500, thinkingConfig: { thinkingBudget: 0 } },
    });
    const raw = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const json = raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1);
    const arr = JSON.parse(json) as Seed[];
    return arr
      .filter(x => x?.headline && Array.isArray(x.keywords) && x.keywords.length > 0)
      .slice(0, 3);
  } catch (e) {
    console.warn("[overnight] 재료 추출 실패:", (e as Error)?.message?.slice(0, 80));
    return [];
  }
}

let _cache: { at: number; themes: OvernightTheme[] } | null = null;
const TTL = 60 * 60 * 1000;   // 1시간 — 간밤 재료는 자주 바뀌지 않는다

export async function getOvernightThemes(force = false): Promise<OvernightTheme[]> {
  if (!force && _cache && Date.now() - _cache.at < TTL) return _cache.themes;

  // ⚠️ 이 import는 **함수 안에서** 한다.
  // 맨 위에 두면 routes/events → lib/overnight-themes → routes/market-analysis로
  // 순환이 생겨 events 모듈이 통째로 안 실린다. 라우트가 전부 SPA로 떨어졌다.
  const { fetchUsMarketNews } = await import("../routes/market-analysis.js");
  const news = await fetchUsMarketNews().catch(() => "");
  const seeds = await extractSeeds(news);
  const out: OvernightTheme[] = [];

  for (const seed of seeds) {
    const hits = await searchThemeStocks(seed.keywords, 8, []).catch((): ThemeHit[] => []);
    // 공시에 한 건도 안 걸리면 **그 재료는 버린다.** 억지로 종목을 붙이면 잡음이 된다.
    if (hits.length === 0) {
      console.log(`[overnight] "${seed.headline}" — 공시 0건, 제외 (${seed.keywords.join("·")})`);
      continue;
    }
    // 같은 종목이 여러 말에 걸려 두 번 나오는 것을 막는다(DXVX가 암백신·항암백신 양쪽에 걸렸다).
    const seen = new Set<string>();
    const stocks = hits
      .filter(h => !seen.has(h.ticker) && seen.add(h.ticker))
      .slice(0, 6)
      .map(h => ({ ticker: h.ticker, name: h.name ?? h.ticker, snippet: h.evidence ?? "" }));
    out.push({ headline: seed.headline, keywords: seed.keywords, stocks });
    console.log(`[overnight] "${seed.headline}" — ${stocks.length}종목 (${seed.keywords.join("·")})`);
  }

  _cache = { at: Date.now(), themes: out };
  return out;
}
