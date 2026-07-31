/**
 * biz-diff.ts — 사업보고서 시계열에서 **"조용히 사라진 것"을 기계가 잡는다.**
 *
 * 회사는 새로 시작한 사업은 앞세우지만, 접은 사업은 말하지 않는다. 사람이 5년치
 * 사업보고서를 나란히 놓고 "작년엔 있던 ○○부문이 올해 목록에서 빠졌다"를 찾기는
 * 지루하고 놓치기 쉽다. 그런데 이건 집합 연산이라 코드가 정확히 할 수 있다.
 *
 * 설계 원칙(이 프로젝트의 뼈대): **코드가 사실을 뽑고, LLM은 해석만 한다.**
 * LLM에게 "무엇이 사라졌나 찾아봐"라고 시키면 기간을 섞고 지어낸다. 그래서 집합을
 * 코드가 만들어 넘기고, LLM은 "왜 사라졌을까"만 쓰게 한다.
 *
 * 무엇을 항목으로 보는가 — **매출 비중 표의 사업부문**이다. DART 표준 서식에서
 * 이 표는 항상 "부문" 열이 첫 칸이고 각 행이 비율(%)로 끝난다. 그 규칙 하나로
 * 제조·유통·바이오·대기업(삼성 DX/DS/SDC/Harman, 롯데 백화점/할인점/…)까지
 * 같은 코드로 읽힌다. DB를 모르는 순수 함수만 둔다(테스트 가능).
 */

/** 매출비중 표의 시작 — "부문"/"사업부문"/"부  문"(사이 공백) */
const TABLE_START = /^(사업\s*)?부\s*문$/;

/** 열 머리글 — 이 줄들은 사업부문명이 아니다. 헤더 블록을 건너뛰는 데 쓴다 */
const HEADER_WORDS = /^(사업\s*)?부\s*문$|^(매출\s*유형|주요\s*제품|품\s*목|구체적?\s*용도|용도|매출액\s*\(?비?율?\)?|비\s*중|비율|주요\s*상표\s*등?|구\s*분|매출\s*비중|제\d+기(\s*누?계)?|주요상표등)$/;

/** 매출유형 값(제품·상품·용역 등) — 부문명이 아니다 */
const NOT_SEGMENT = /^(제품\s*외|제품|상품|용역|서비스|임대수익|기타수익|비고|-|제ㆍ상품)$/;

/** 표의 끝 — 합계·소계·총계 행 */
const STOP = /^(합\s*계|소\s*계|총\s*계)$/;

/** 숫자로 시작하는 줄(매출액·비율·음수) — 부문명일 수 없다 */
const IS_NUMISH = /^[\d(△▲-]/;

/**
 * 행의 끝(비율 셀)인가.
 *   "56.4%" · "24.3" · "47.63" · "△8.9%"  → 예 (≤100 비율)
 *   "97,146,675(100%)"                     → 예 (병합 셀 …(NN%))
 *   "3,339,352" · "1,879,673"              → 아니오 (매출액, >100·콤마)
 */
function isRowEnd(l: string): boolean {
  const bare = l.match(/^△?(\d{1,3}(?:\.\d+)?)\s*%?$/);
  if (bare && Number(bare[1]) <= 100) return true;
  return /\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)$/.test(l); // …(100%) 병합 셀
}

/**
 * 매출비중 표에서 사업부문 집합을 뽑는다.
 *
 * %가 행 경계다. 헤더 블록을 건너뛴 뒤, 각 행의 첫 "이름다운" 줄(숫자·헤더·매출유형이
 * 아닌 줄)이 부문명이다. 표가 여러 개면 모두 훑어 합집합을 만든다.
 */
export function extractSegments(sectionText: string): string[] {
  const lines = sectionText.split("\n").map(l => l.trim()).filter(Boolean);
  const segs: string[] = [];
  let inTable = false, headerDone = false, buf: string[] = [];

  for (const l of lines) {
    if (TABLE_START.test(l)) { inTable = true; headerDone = false; buf = []; continue; }
    if (!inTable) continue;
    if (STOP.test(l)) { inTable = false; buf = []; continue; }
    if (!headerDone) { if (HEADER_WORDS.test(l)) continue; headerDone = true; }

    buf.push(l);
    if (isRowEnd(l)) {
      const name = buf.find(x =>
        !HEADER_WORDS.test(x) && !NOT_SEGMENT.test(x) && !IS_NUMISH.test(x) && x.length <= 25);
      if (name) segs.push(name.replace(/\s+/g, " "));
      buf = [];
    }
  }
  return [...new Set(segs)];
}

/**
 * 저장된 기간 content(### [주요제품]…### [매출수주]…)에서 부문 집합을 뽑는다.
 * 부문 표는 이 두 소분류에만 있으니 그 범위로 한정해 다른 표의 오인을 막는다.
 */
export function segmentsFromContent(content: string): string[] {
  const pick = (k: string) => {
    const seg = content.split(`### [${k}]`)[1];
    return seg ? seg.split("### [")[0] : "";
  };
  return extractSegments(pick("주요제품") + "\n" + pick("매출수주"));
}

export interface SegmentPeriod {
  bsnsYear: number;
  quarter: number;
  periodLabel: string;
  segments: string[];
}

export interface SegmentChange {
  name: string;
  /** 이 부문이 마지막으로 보인 기간(사라짐) 또는 처음 나타난 기간(신규) */
  atLabel: string;
}

export interface SegmentDiff {
  appeared: SegmentChange[];   // 과거엔 없다가 뒤에 새로 등장
  disappeared: SegmentChange[]; // 과거엔 있다가 뒤에서 사라짐
  stable: string[];             // 처음부터 끝까지 유지
}

/**
 * 기간별 부문 집합을 훑어 신규·소멸을 가른다.
 *
 * **연간 보고서만 본다.** 분기·반기는 부문 표를 생략하거나 축약해서, 비교에 넣으면
 * "분기라서 안 보임"을 "사라짐"으로 오인한다. 연간끼리만 비교해야 진짜 변화가 남는다.
 *
 * 판정: 전반부(가장 이른 연도)에 있었는데 후반부(가장 늦은 연도)에 없으면 소멸,
 * 그 반대면 신규. 한 해 반짝은 노이즈일 수 있어 **처음/마지막 등장 기간**을 함께 준다.
 */
export function diffSegments(periods: SegmentPeriod[]): SegmentDiff {
  const annual = periods
    .filter(p => p.quarter === 4 && p.segments.length > 0)
    .sort((a, b) => a.bsnsYear - b.bsnsYear);

  if (annual.length < 2) return { appeared: [], disappeared: [], stable: [] };

  const first = annual[0];
  const last = annual[annual.length - 1];
  const firstSet = new Set(first.segments);
  const lastSet = new Set(last.segments);

  const firstLabel = (name: string) =>
    annual.find(p => p.segments.includes(name))?.periodLabel ?? "";
  const lastLabel = (name: string) =>
    [...annual].reverse().find(p => p.segments.includes(name))?.periodLabel ?? "";

  const appeared: SegmentChange[] = [];
  const disappeared: SegmentChange[] = [];
  const stable: string[] = [];

  const allNames = new Set(annual.flatMap(p => p.segments));
  for (const name of allNames) {
    const inFirst = firstSet.has(name);
    const inLast = lastSet.has(name);
    if (inFirst && !inLast) disappeared.push({ name, atLabel: lastLabel(name) });
    else if (!inFirst && inLast) appeared.push({ name, atLabel: firstLabel(name) });
    else if (inFirst && inLast) stable.push(name);
  }
  return { appeared, disappeared, stable };
}

/**
 * 진단 결과를 프롬프트 블록으로 만든다. 변화가 없으면 빈 문자열 — 잡음을 만들지 않는다.
 */
export function renderSegmentDiff(diff: SegmentDiff): string {
  if (diff.appeared.length === 0 && diff.disappeared.length === 0) return "";

  const lines = [
    "",
    "[🔍 사업부문 변화 — 서버가 매출비중 표를 기간끼리 대조한 결과]",
    "⚠️ 아래는 코드가 연간 보고서의 부문 목록을 집합 비교해 뽑은 것입니다. 확정 사실이니 그대로 쓰되, **왜** 그렇게 됐는지를 해석하세요.",
  ];
  if (diff.disappeared.length) {
    lines.push(`· 사라진 부문: ${diff.disappeared.map(d => `${d.name}(${d.atLabel} 이후 목록에서 빠짐)`).join(", ")}`);
    lines.push("  → 매각·철수·부문 통합 중 무엇인지, 그게 좋은 신호인지 나쁜 신호인지 짚으세요.");
  }
  if (diff.appeared.length) {
    lines.push(`· 새로 등장한 부문: ${diff.appeared.map(a => `${a.name}(${a.atLabel}부터)`).join(", ")}`);
    lines.push("  → 신사업이 매출로 실체화되고 있는지, 인수 때문인지 짚으세요.");
  }
  if (diff.stable.length) {
    lines.push(`· 유지된 부문: ${diff.stable.join(", ")}`);
  }
  return lines.join("\n");
}
