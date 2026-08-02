/**
 * biz-signals.ts — 사업보고서 **서술(행간)**에서 전략 행동과 새 테마를 코드가 짚는다.
 *
 * 숫자(매출·CapEx·CCC)는 이미 뽑는다. 하지만 "이 회사가 새로운 걸 하는지, 어디로
 * 가는지"는 표가 아니라 **문장 속에 묻혀** 있다. SK하이닉스 2025 보고서에는 이런 게 있다:
 *   "세계 최초로 HBM4 양산 체제를 확보"
 *   "로보틱스/휴머노이드는 2026년을 기점으로 본격 양산 체제에 돌입"
 *   "CXL 시장을 선도하기 위해 SoC 협력사들과 협업"
 * 이것들이 사업의 방향을 말해준다 — 코드가 문장 단위로 짚어 LLM에 넘긴다.
 *
 * 두 가지를 한다:
 *  1. 전략 행동 추출 — 증설·양산·신사업·M&A·수주·철수·기술 리더십 문장을 테마별로.
 *  2. 새로 등장한 기술/제품 용어 — 과거엔 없다가 최근에 나온 영문·약어(HBM4·CXL·PIM 등).
 *
 * DB를 모르는 순수 함수만 둔다.
 */

export type SignalTheme = "증설·양산" | "신사업·신제품" | "M&A·제휴" | "수주·계약" | "축소·철수" | "기술·R&D";

interface ThemeSpec { theme: SignalTheme; re: RegExp; }

/** 테마별 탐지 패턴. 실제 보고서 문장에서 뽑아 만든 것 — 좁게 잡아 노이즈를 줄인다. */
const THEMES: ThemeSpec[] = [
  { theme: "증설·양산",   re: /증설|신설\s*(공장|라인|설비)|착공|양산\s*(체제|체계|돌입|시작|개시)|생산능력[^.]{0,8}(확대|증설|증가)|캐파|CAPA/ },
  { theme: "신사업·신제품", re: /신규\s*사업|신사업|사업[^.]{0,6}(진출|다각화)|신제품[^.]{0,6}출시|신규\s*(시장|제품|모델)[^.]{0,6}(진출|출시)|파이프라인/ },
  { theme: "M&A·제휴",    re: /인수(?!자)|합병|지분[^.]{0,6}(취득|인수|투자)|합작|(?:^|[^A-Za-z])JV(?![A-Za-z])|전략적?\s*제휴|MOU|협력[^.]{0,6}(체결|구축|강화)/ },
  { theme: "수주·계약",   re: /수주[^.]{0,8}(확대|증가|잔고|성공|획득)|공급\s*계약[^.]{0,6}체결|장기\s*(공급|계약)|대규모\s*수주|납품\s*계약/ },
  { theme: "축소·철수",   re: /매각|(?:사업|생산|공장)[^.]{0,6}(철수|중단|종료|청산)|구조\s*조정|사업\s*재편|철수하/ },
  { theme: "기술·R&D",    re: /세계\s*최초|업계\s*최초|기술\s*리더십|신기술[^.]{0,6}(개발|확보)|특허[^.]{0,6}(취득|출원|등록)|(?:품목\s*)?허가[^.]{0,6}획득|임상\s*[1-3]상/ },
];

export interface SignalHit {
  theme: SignalTheme;
  sentence: string;
}

/** 문장을 자른다 — 마침표·줄바꿈 기준, 너무 짧거나 긴 것은 버린다. */
function sentences(content: string): string[] {
  return content
    .split(/(?<=다\.)|[.\n]/)
    .map(s => s.replace(/\s+/g, " ").trim())
    // 목차·표 머리글·번호 목록은 행동이 아니다 — 걸러낸다.
    .filter(s => s.length >= 15 && s.length <= 160 && !/^[(\d①-⑳]|총괄표|연구개발\s*실적|다음과\s*같습니다$/.test(s));
}

/** 의미가 같은 문장인지 비교할 키 — 공백·숫자·기호를 지워 연도만 다른 반복을 잡는다. */
function normKey(s: string): string {
  return s.replace(/[\s\d.,·\-()[\]/%]/g, "").slice(0, 50);
}

/** 한 기간의 텍스트에서 테마별 전략 행동 문장을 뽑는다(테마당 최대 3개). */
export function extractSignals(content: string): SignalHit[] {
  const out: SignalHit[] = [];
  const perTheme = new Map<SignalTheme, number>();
  const seen = new Set<string>();
  for (const s of sentences(content)) {
    for (const spec of THEMES) {
      if ((perTheme.get(spec.theme) ?? 0) >= 3) continue;
      if (!spec.re.test(s)) continue;
      const key = s.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      perTheme.set(spec.theme, (perTheme.get(spec.theme) ?? 0) + 1);
      out.push({ theme: spec.theme, sentence: s.length > 130 ? s.slice(0, 127) + "…" : s });
      break; // 한 문장은 한 테마로만
    }
  }
  return out;
}

// ─── 새로 등장한 기술/제품 용어 ───────────────────────────────────────────────

// 영문·약어 제품/기술 용어는 한글 형태소 분석 없이도 잡힌다(HBM4·CXL·DDR5·SoC·PIM 등).
const TERM_RE = /\b([A-Z][A-Za-z]*[A-Z0-9][A-Za-z0-9]{0,9})\b/g;
// 사업 신호가 아닌 흔한 약어는 제외.
const STOP = new Set([
  "THE", "AND", "OR", "FOR", "USD", "KRW", "CEO", "CFO", "CTO", "ESG", "IR", "PR", "IT",
  "AI", "ROE", "ROA", "EPS", "BPS", "PER", "PBR", "EBITDA", "IFRS", "GAAP", "OEM", "ODM",
  "R&D", "M&A", "JV", "MOU", "TAM", "CAGR", "YoY", "QoQ", "FY", "USA", "USB", "TV",
]);

/**
 * 최근 기간에 새로 등장한 영문 기술/제품 용어를 찾는다.
 * "과거 절반에는 없다가 최근 절반에 2번 이상" 나온 용어 = 새 방향의 신호.
 */
export function emergingTerms(periods: Array<{ label: string; content: string }>): string[] {
  if (periods.length < 2) return [];
  const mid = Math.floor(periods.length / 2);
  const count = (texts: string[]) => {
    const m = new Map<string, number>();
    for (const t of texts) for (const mt of t.matchAll(TERM_RE)) {
      const w = mt[1];
      if (STOP.has(w.toUpperCase()) || w.length < 3) continue;
      m.set(w, (m.get(w) ?? 0) + 1);
    }
    return m;
  };
  const old = count(periods.slice(0, mid).map(p => p.content));
  const recent = count(periods.slice(mid).map(p => p.content));
  const emerged: Array<[string, number]> = [];
  for (const [w, n] of recent) {
    if (n >= 2 && !old.has(w)) emerged.push([w, n]);
  }
  return emerged.sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
}

// ─── 렌더 ─────────────────────────────────────────────────────────────────────

export interface PeriodSignals { label: string; hits: SignalHit[]; }

/**
 * 기간별로 **그 해에 새로 등장한** 전략 행동만 남긴다.
 * 매년 똑같이 실리는 보일러플레이트(회사 소개·정형 문구)를 걸러 진짜 '변화'만 남긴다.
 * periods는 오래된→최신 순으로 준다.
 */
export function buildSignalTimeline(periods: Array<{ label: string; content: string }>): PeriodSignals[] {
  const seen = new Set<string>();
  const out: PeriodSignals[] = [];
  for (const p of periods) {
    const fresh = extractSignals(p.content).filter(h => {
      const k = normKey(h.sentence);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (fresh.length > 0) out.push({ label: p.label, hits: fresh });
  }
  return out;
}

/**
 * 전략 행동 타임라인 + 새 테마를 프롬프트 블록으로. **LLM은 이걸 근거로 방향을 읽는다.**
 * 서버가 문장을 그대로 뽑았을 뿐이니, 맥락·중요도 판단은 LLM이 한다.
 */
export function renderBizSignals(periods: PeriodSignals[], emerged: string[]): string {
  const withHits = periods.filter(p => p.hits.length > 0);
  if (withHits.length === 0 && emerged.length === 0) return "";

  const lines = ["", "[🔍 사업보고서 행간 — 서버가 문장에서 짚은 전략 행동]",
    "⚠️ 아래는 원문 문장을 코드가 테마별로 추출한 것입니다. 이 흐름으로 '회사가 무엇을 새로 하고,", "   어디로 가는지'를 서술하세요. 중요도·맥락은 직접 판단하세요."];

  for (const p of withHits) {
    lines.push("", `▸ ${p.label}`);
    for (const h of p.hits) lines.push(`  · [${h.theme}] ${h.sentence}`);
  }

  if (emerged.length > 0) {
    lines.push("", "[🆕 최근 새로 등장한 기술·제품 용어 — 과거 보고서엔 없던 것]",
      `· ${emerged.join(", ")}`,
      "⚠️ 이 용어들이 새 사업·기술 방향의 신호인지, 단순 언급인지 원문 맥락으로 판단하세요.");
  }
  return lines.join("\n");
}
