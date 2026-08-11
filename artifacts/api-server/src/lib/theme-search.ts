/**
 * theme-search.ts — 테마 관련주를 **사업보고서 원문**에서 찾는다.
 *
 * 왜 이게 다른가. 테마주를 찾을 때 보통은 뉴스가 짚어준 한두 종목이 전부다.
 * 우리는 한국 상장사 2,700여 곳의 사업보고서 본문을 갖고 있으니, **회사가 스스로
 * 그 사업을 한다고 적어놓은 것**을 찾을 수 있다. 뉴스보다 근거가 단단하다.
 *
 * 실측: "CDMO"로 찾으면 이엔셀(38회)·프레스티지바이오로직스(32회)·에스티팜(27회)이
 * 위로 온다. 언급 횟수가 곧 "그 사업이 이 회사에서 얼마나 중심인가"다.
 *
 * ⚠️ 단어를 AND로 묶지 말 것. "반도체 + 광주"로 찾으면 기아·현대차증권이 걸린다 —
 * 두 단어가 문서 어딘가에 각각 나왔을 뿐이다. **정확한 구문**으로 찾아야 한다.
 */

import { GoogleGenAI } from "@google/genai";
import { pool } from "@workspace/db";

export interface ThemeHit {
  ticker: string;
  name: string | null;
  marketCap: number | null;
  /** 최신 보고서에서 그 구문이 나온 횟수 — 사업의 중심일수록 많다 */
  mentions: number;
  /** 근거 — 구문이 등장한 문장 */
  evidence: string | null;
  bsnsYear: number;
}

/**
 * 본문에서 키워드가 나온 **문장 하나**를 뽑는다(근거로 보여줄 것).
 * 표·목차처럼 문장이 아닌 곳에서 걸리면 읽히지 않으므로 길이로 거른다.
 */
export function extractEvidence(content: string, keyword: string): string | null {
  const idx = content.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return null;
  // 앞뒤 문장 경계를 찾는다(마침표·줄바꿈)
  const from = Math.max(0, content.lastIndexOf("\n", idx), content.lastIndexOf(". ", idx));
  const dot = content.indexOf(". ", idx);
  const nl = content.indexOf("\n", idx);
  const to = Math.min(
    dot < 0 ? content.length : dot + 1,
    nl < 0 ? content.length : nl,
  );
  const s = content.slice(from, to).replace(/\s+/g, " ").trim();
  if (s.length < 12 || s.length > 220) return null;   // 표 조각·너무 긴 덩어리 제외
  return s;
}

// ─── 유사어 확장 (뉴스 말 → 사업보고서 말) ──────────────────────────────────
//
// **뉴스가 쓰는 말과 회사가 쓰는 말이 다르다.** 뉴스는 "호남 반도체 클러스터"라고 쓰지만
// 사업보고서에 그 표현을 적는 회사는 3곳뿐이다. 정작 관련 회사들은 "시스템반도체",
// "파운드리", "반도체 후공정"이라고 쓴다. 그 번역을 AI가 한다.
//
// 확장 결과는 캐시한다 — 같은 테마를 여러 사람이 검색해도 Gemini는 한 번만 부른다.

const _synCache = new Map<string, { words: string[]; at: number }>();
const SYN_TTL = 24 * 3600 * 1000; // 하루

/**
 * 테마 한 마디를 **사업보고서에 실제로 쓰이는 표현들**로 넓힌다.
 * 실패하면 원래 말만 돌려준다(확장은 거들 뿐, 없다고 검색이 막히면 안 된다).
 */
export async function expandThemeKeywords(theme: string): Promise<string[]> {
  const key = theme.trim().toLowerCase();
  if (!key) return [];
  const hit = _synCache.get(key);
  if (hit && Date.now() - hit.at < SYN_TTL) return hit.words;

  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) return [theme];

  const prompt = `한국 상장사의 **사업보고서(사업의 내용)**에서 아래 테마와 관련된 회사를 찾으려 합니다.
테마: "${theme}"

기사에 쓰이는 말 말고, **회사가 사업보고서에 실제로 적는 표현**을 5~7개 뽑아주세요.
- 예: "호남 반도체 클러스터" → 시스템반도체, 파운드리, 반도체 후공정, 반도체 장비, 웨이퍼
- 예: "광주공항 이전" → 공항 건설, 활주로, 토목공사, 관급공사
- 제품명·기술명·공정명처럼 **구체적인 명사**로. "성장", "확대" 같은 일반어는 금지.
- 너무 흔해서 아무 회사나 걸리는 말(예: "제조", "사업")은 금지.

쉼표로만 구분해 한 줄로 답하세요. 다른 말은 쓰지 마세요.`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.3, maxOutputTokens: 2000 },
    });
    const raw = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const words = raw
      .split(",")
      .map(s => s.replace(/[."'\n]/g, "").trim())
      .filter(s => s.length >= 2 && s.length <= 20)
      .slice(0, 7);
    // 원래 말을 앞에 두고 중복 제거 — 사용자가 친 말이 우선이다.
    const merged = [...new Set([theme.trim(), ...words])].slice(0, 8);
    if (merged.length > 1) _synCache.set(key, { words: merged, at: Date.now() });
    return merged;
  } catch (e) {
    console.warn(`[theme-search] 유사어 확장 실패(${theme}):`, (e as Error)?.message?.slice(0, 60));
    return [theme];
  }
}

/** 쉼표·공백으로 나뉜 입력을 구문 목록으로. 너무 짧은 것은 노이즈라 뺀다. */
export function parseKeywords(raw: string): string[] {
  return String(raw ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length >= 2)
    .slice(0, 4);
}

/**
 * 테마 구문으로 관련주를 찾는다. 여러 구문을 주면 **하나라도 나오면** 후보이고,
 * 여러 구문이 함께 나오면 더 위로 온다(합산 언급 횟수).
 */
export async function searchThemeStocks(keywords: string[], limit = 20): Promise<ThemeHit[]> {
  // 유사어 확장이 붙으면서 구문이 8개까지 올 수 있다(원래 말 + AI가 넓힌 표현들).
  const kws = keywords.filter(k => k.length >= 2).slice(0, 8);
  if (kws.length === 0) return [];

  // 종목별 최신 보고서 1건만 본다(같은 회사의 여러 해가 중복으로 잡히지 않게).
  // 언급 횟수는 replace로 센다 — 별도 확장 없이 되는 방법이다.
  const countExpr = kws
    .map((_, i) => `(length(l.content) - length(replace(lower(l.content), lower($${i + 1}), ''))) / NULLIF(length($${i + 1}), 0)`)
    .join(" + ");
  const whereExpr = kws.map((_, i) => `l.content ILIKE '%'||$${i + 1}||'%'`).join(" OR ");

  const { rows } = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (ticker) ticker, content, bsns_year
         FROM dart_biz_reports ORDER BY ticker, bsns_year DESC, quarter DESC)
     SELECT l.ticker, l.bsns_year, l.content, s.name, s.market_cap,
            (${countExpr}) AS mentions
       FROM latest l LEFT JOIN stocks s ON s.ticker = l.ticker
      WHERE ${whereExpr}
      ORDER BY mentions DESC NULLS LAST
      LIMIT $${kws.length + 1}`,
    [...kws, limit],
  );

  return rows.map((r: any) => ({
    ticker: r.ticker,
    name: r.name ?? null,
    marketCap: r.market_cap == null ? null : Number(r.market_cap),
    mentions: Number(r.mentions) || 0,
    evidence: kws.map(k => extractEvidence(r.content, k)).find(Boolean) ?? null,
    bsnsYear: Number(r.bsns_year),
  }));
}
