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
  /** 그 지역에 생산시설이 있다고 적어놓았나 (지역 검색일 때만) */
  regionMatch?: boolean;
  /** 지역 근거 문장 */
  regionEvidence?: string | null;
}

// ─── 지역 인식 ───────────────────────────────────────────────────────────────
//
// 지역 인프라 테마(광주공항 이전·국가산단)는 **그 지역에 시설이 있는 회사**가 수혜를 본다.
// 다만 지역명을 그냥 찾으면 안 된다 — NHN·쏘카·BGF리테일이 걸린다(지점·매장 목록에
// 지역명이 있을 뿐이다). **공장·사업장·생산 같은 말 근처**에 있을 때만 시설로 본다.
//
// 실측: 근접 매칭으로 90곳이 걸렸고 SK시그넷(전남영광공장)·세아제강(순천공장)·
// 삼성전자(광주사업장)처럼 실제 시설이 잡혔다.

/** 광역 지명 → 그 권역에서 함께 볼 지명들. 사람은 "광주"라 치지만 시설은 인근 시·군에 있다. */
const REGION_MAP: Record<string, string[]> = {
  광주: ["광주", "전남", "나주", "화순", "장성", "함평"],
  전남: ["전남", "여수", "순천", "광양", "목포", "나주", "영광"],
  전북: ["전북", "전주", "익산", "군산", "완주"],
  호남: ["광주", "전남", "전북", "나주", "여수", "순천", "익산", "군산"],
  대구: ["대구", "경북", "구미", "포항", "경산"],
  부산: ["부산", "경남", "김해", "양산", "창원"],
  울산: ["울산"],
  대전: ["대전", "충남", "세종", "천안", "아산"],
  충북: ["충북", "청주", "음성", "진천"],
  충남: ["충남", "천안", "아산", "당진", "서산"],
  경기: ["경기", "평택", "화성", "이천", "용인", "안성"],
  강원: ["강원", "원주", "강릉", "동해"],
  제주: ["제주"],
};

/** 검색어에서 지역을 알아낸다. 없으면 빈 배열 — 지역 검색이 아니다. */
export function detectRegions(text: string): string[] {
  const s = String(text ?? "");
  for (const [key, group] of Object.entries(REGION_MAP)) {
    if (s.includes(key)) return group;
  }
  // 광역이 아니라 시·군만 친 경우(예: "여수")도 잡는다
  for (const group of Object.values(REGION_MAP)) {
    const hit = group.find(g => s.includes(g));
    if (hit) return [hit];
  }
  return [];
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

  const prompt = `한국 상장사의 **사업보고서(사업의 내용)**에서 아래 테마의 **수혜 기업**을 찾으려 합니다.
테마: "${theme}"

이 일이 진행되면 **수주하거나 납품하게 될 회사들이 자기 사업을 설명할 때 쓰는 말**을 5~7개 뽑으세요.
시설의 부품 이름이 아니라, **그 회사가 파는 제품·공사·서비스**여야 합니다.

- "광주공항 이전" → 토목공사, 레미콘, 골재, 콘크리트파일, 아스팔트콘크리트, 관급공사
  (✗ 활주로·계류장·관제탑 — 시설 부품이라 백화점·물류회사가 잘못 걸립니다)
- "호남 반도체 클러스터" → 시스템반도체, 파운드리, 반도체 장비, 반도체 소재
- "원전 수출" → 원자력발전소, 원전 기자재, 주기기, 밸브

지켜야 할 것:
- **한 가지 뜻으로만 읽히는 말**을 쓰세요. "터미널·플랫폼·솔루션"처럼 업종마다 뜻이
  다른 말은 금지(엉뚱한 회사가 걸립니다).
- "성장·확대·제조·사업" 같은 일반어 금지.

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

/**
 * 자연어 질문에서 **검색할 말만** 남긴다.
 *
 * 사용자는 "유리기판 관련 기업을 찾아줘"처럼 문장으로 친다. 그대로 찾으면 사업보고서에
 * 그런 문장이 있을 리 없어 0건이 되고, 그제서야 AI 확장이 도는 탓에 느려진다.
 * 군더더기를 먼저 걷어내면 "유리기판"으로 바로 찾아 대부분 즉시 답이 나온다.
 */
export function stripQuestionWords(raw: string): string {
  return String(raw ?? "")
    .replace(/(와|과|랑|이랑)?\s*(관련(이|되는|된|있는)?|연관(된|있는)?)\s*(있는)?\s*/g, " ")
    .replace(/(만드는|생산하는|제조하는|납품하는|공급하는|영위하는|하는)\s*/g, " ")
    .replace(/(기업|회사|종목|주식|테마|관련주|수혜주)\s*(들)?\s*(을|를|은|는|이|가)?\s*/g, " ")
    .replace(/(찾아\s*줘|찾아줘|찾아|알려\s*줘|알려줘|보여\s*줘|보여줘|추천해\s*줘|추천)\s*/g, " ")
    .replace(/[?!.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
 * 검색용 축약본을 최신 상태로 맞춘다 — 종목당 최신 보고서 1건.
 *
 * dart_biz_reports는 분기까지 쌓여 427MB지만 검색에 필요한 건 최신본(22MB)뿐이다.
 * 수집 배치가 끝난 뒤 한 번 부르면 된다. 새로 들어온 것만 갱신하므로 반복 호출이 싸다.
 */
export async function refreshThemeSearchDocs(): Promise<number> {
  const { rowCount } = await pool.query(`
    INSERT INTO theme_search_docs (ticker, bsns_year, quarter, doc, updated_at)
    SELECT DISTINCT ON (ticker) ticker, bsns_year, quarter, content, NOW()
      FROM dart_biz_reports
     ORDER BY ticker, bsns_year DESC, quarter DESC
    ON CONFLICT (ticker) DO UPDATE
      SET bsns_year = EXCLUDED.bsns_year, quarter = EXCLUDED.quarter,
          doc = EXCLUDED.doc, updated_at = NOW()
      WHERE theme_search_docs.bsns_year < EXCLUDED.bsns_year
         OR (theme_search_docs.bsns_year = EXCLUDED.bsns_year
             AND theme_search_docs.quarter < EXCLUDED.quarter)
  `);
  return rowCount ?? 0;
}

/**
 * 테마 구문으로 관련주를 찾는다. 여러 구문을 주면 **하나라도 나오면** 후보이고,
 * 여러 구문이 함께 나오면 더 위로 온다(합산 언급 횟수).
 */
export async function searchThemeStocks(
  keywords: string[], limit = 20, regions: string[] = [],
): Promise<ThemeHit[]> {
  // 유사어 확장이 붙으면서 구문이 8개까지 올 수 있다(원래 말 + AI가 넓힌 표현들).
  const kws = keywords.filter(k => k.length >= 2).slice(0, 8);
  if (kws.length === 0) return [];

  // ⚠️ 언급 횟수를 SQL에서 세면 안 된다. `lower(content)`·`replace(...)`가 매칭된
  // 본문(수만~수십만 자)을 통째로 복사해 만들기 때문이다. 실측 2.9초 — 운영에서는
  // 문장 타임아웃에 걸려 500 오류가 났다("찾지 못했습니다"로 보였다). 두 단계로 나눈다.
  //
  //  ① SQL은 **후보만** 싸게 고른다. 세지도 정렬하지도 않아 LIMIT에서 조기 종료된다.
  //  ② 세는 것과 지역 판정은 **JS**가 한다 — 후보만 다루므로 양이 정해져 있다.
  const whereExpr = kws.map((_, i) => `d.doc ILIKE '%'||$${i + 1}||'%'`).join(" OR ");
  // 순위를 매기려면 화면에 뿌릴 개수보다 넉넉히 봐야 한다.
  const candidateLimit = Math.max(60, limit * 4);

  // 본문(종목당 8~30KB)을 통째로 받으면 60건에 6MB — 네트워크가 병목이 된다.
  // 세는 것과 근거 문장 뽑기는 DB 안에서 끝내고 짧은 조각만 가져온다.
  const countExpr = kws
    .map((_, i) => `(length(d.doc) - length(replace(lower(d.doc), lower($${i + 1}), ''))) / NULLIF(length($${i + 1}), 0)`)
    .join(" + ");
  const params: any[] = [...kws, candidateLimit];
  let regionSel = "";
  let regionOrder = "";
  if (regions.length > 0) {
    const alt = regions.join("|");
    params.push(`(${alt})[^.]{0,40}(공장|사업장|생산|공사|시설)`);
    params.push(`(공장|사업장|생산|공사|시설)[^.]{0,40}(${alt})`);
    params.push(regions[0]);
    const a = params.length - 2, b = params.length - 1, c = params.length;
    regionSel = `, (d.doc ~ $${a} OR d.doc ~ $${b}) AS region_match,
              substring(d.doc from greatest(1, position($${c} in d.doc) - 60) for 220) AS region_snippet`;
    regionOrder = "c.region_match DESC NULLS LAST, ";
  }

  const { rows } = await pool.query(
    `WITH cand AS (
       SELECT d.ticker, d.bsns_year,
              (${countExpr}) AS mentions,
              substring(d.doc from greatest(1, (${kws.map((_, i) => `NULLIF(position(lower($${i + 1}) in lower(d.doc)), 0)`).join(", ")
                ? `COALESCE(${kws.map((_, i) => `NULLIF(position(lower($${i + 1}) in lower(d.doc)), 0)`).join(", ")}, 1)`
                : "1"}) - 60) for 220) AS snippet
              ${regionSel}
         FROM theme_search_docs d
        WHERE ${whereExpr}
        LIMIT $${kws.length + 1})
     SELECT c.*, s.name, s.market_cap
       FROM cand c LEFT JOIN stocks s ON s.ticker = c.ticker
      ORDER BY ${regionOrder}c.mentions DESC NULLS LAST
      LIMIT ${Math.min(40, Math.max(1, limit))}`,
    params,
  );

  // 이제 SQL이 세고 조각까지 뽑아 왔다 — 여기서는 다듬기만 한다.
  const tidy = (v: unknown): string | null => {
    const t = String(v ?? "").replace(/\s+/g, " ").trim();
    return t.length >= 12 ? t : null;
  };

  return rows.map((r: any) => {
    const hit: ThemeHit = {
      ticker: r.ticker,
      name: r.name ?? null,
      marketCap: r.market_cap == null ? null : Number(r.market_cap),
      mentions: Number(r.mentions) || 0,
      evidence: tidy(r.snippet),
      bsnsYear: Number(r.bsns_year),
    };
    if (regions.length > 0) {
      hit.regionMatch = !!r.region_match;
      hit.regionEvidence = hit.regionMatch ? tidy(r.region_snippet) : null;
    }
    return hit;
  });
}
