/**
 * biz-timeline-extract.ts — 사업보고서 원문에서 섹션을 잘라내는 **순수 로직**.
 *
 * DB·네트워크에 손대지 않는다. 그래서 픽스처만으로 테스트할 수 있다
 * (peer-format·band-format과 같은 결). 수집·저장은 biz-timeline.ts가 맡고,
 * 여기서 뽑는 규칙만 검증한다.
 *
 * DART 원문은 htmlToText를 거치면 셀마다 줄바꿈된 형태가 된다.
 */

/**
 * 사업보고서 "II. 사업의 내용"의 표준 소분류.
 *
 * **DART 서식은 금융감독원이 정한 고정 틀이다** — 회사가 바꿀 수 없다. 그래서 회사마다
 * 다른 마커를 추측하는 것보다, 이 표준 소분류 머리글에 앵커를 거는 것이 훨씬 안정적이다.
 * 예전에는 "주요 매출처"·"판매 경로" 같은 마커를 찾았는데, SK하이닉스는 그 단어를
 * 안 써서(매출은 "4. 매출 및 수주상황" 아래에 있다) 통째로 놓쳤다.
 *
 * `head`는 소분류 머리글(예: "4. 매출 및 수주상황"). 이 줄부터 다음 소분류 전까지가
 * 한 덩어리다. **위험관리(파생거래)만 버린다** — 정형 보일러플레이트라 연도 비교에
 * 아무 정보가 없고, 분량만 30%를 먹는다.
 *
 * key는 기간마다 같은 이름표를 달아 LLM이 대조하기 쉽게 하려는 것이다.
 */
const BIZ_SUBSECTIONS = [
  // weight = 소분류별 상한 배분. 정보 밀도가 극단적으로 다르다 —
  // SK하이닉스 기준 기타참고 20,244자(점유율·매출비중·산업분석)인데
  // 연구개발 11,398자는 특허·조직 목록 보일러플레이트다. 같은 상한을 주면
  // 정작 중요한 기타참고가 잘리고 목록만 남는다. 그래서 가중치로 나눈다.
  //
  // qWeight = 분기·반기용 가중치. **분기 보고서는 연간의 산업분석·점유율을 거의
  // 그대로 반복한다** — 분기에서 값이 있는 건 "바뀐 숫자"(생산실적·매출·수주)뿐이다.
  // 그래서 반복되는 서술(기타참고·사업개요)은 대폭 줄이고, 바뀌는 표(생산설비·매출수주)는
  // 그대로 둔다. 기타참고를 줄여도 트림의 SIGNAL이 점유율 한 줄은 여전히 끌어온다.
  { key: "사업개요",   head: /^\d+\.\s*사업의\s*개요/,           weight: 1,   qWeight: 0.5 },
  { key: "주요제품",   head: /^\d+\.\s*주요\s*제품/,             weight: 1.5, qWeight: 1.5 }, // 매출비중은 분기에도 변한다
  { key: "생산설비",   head: /^\d+\.\s*(원재료|생산)/,           weight: 1.5, qWeight: 1.5 }, // 생산실적·가동률 — 분기의 핵심
  { key: "매출수주",   head: /^\d+\.\s*매출/,                     weight: 2,   qWeight: 2 },   // 매출·수주잔고 — 분기의 핵심
  { key: null,         head: /^\d+\.\s*위험\s*관리/,             weight: 0,   qWeight: 0 },   // 파생거래 보일러플레이트 — 버림
  { key: "연구개발",   head: /^\d+\.\s*(주요\s*계약|연구개발)/,   weight: 1,   qWeight: 0.5 }, // R&D 수치는 앞쪽뿐
  { key: "기타참고",   head: /^\d+\.\s*기타\s*참고/,             weight: 3,   qWeight: 0.5 }, // 산업분석은 연간과 중복
] as const;

/** 참고용으로만 남긴 옛 이름 */
export const TIMELINE_SECTIONS = BIZ_SUBSECTIONS;

export interface BizReportYear {
  bsnsYear: number;
  /** 1=1분기 · 2=반기 · 3=3분기 · 4=사업보고서(연간) */
  quarter: number;
  rceptNo: string;
  reportNm: string;
  content: string;
}

/** 사람이 읽는 기간 표기 */
export function periodLabel(bsnsYear: number, quarter: number): string {
  return quarter === 4 ? `${bsnsYear}년 연간`
    : quarter === 2 ? `${bsnsYear}년 상반기`
    : `${bsnsYear}년 ${quarter}분기`;
}

/**
 * 보고서 이름의 결산월로 분기를 가른다.
 *   "사업보고서 (2025.12)" → 4   "반기보고서 (2025.06)" → 2
 *   "분기보고서 (2025.03)" → 1   "분기보고서 (2025.09)" → 3
 */
export function parsePeriod(reportNm: string): { year: number; quarter: number } | null {
  const m = reportNm.match(/\((\d{4})\.(\d{2})\)/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const quarter = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return Number.isFinite(year) ? { year, quarter } : null;
}

/**
 * "II. 사업의 내용" 본문 블록만 떼어낸다. 목차가 아니라 본문을 잡는 것이 핵심.
 *
 * 로마숫자 대분류 머리글("II. 사업의 내용")은 문서에 두 번 나온다 — 목차에 한 번,
 * 본문에 한 번. 목차의 항목들은 서로 30줄 안쪽으로 붙어 있고, 본문은 다음 대분류
 * ("III. 재무에 관한 사항")까지 1,000줄 넘게 벌어진다. 그래서 **다음 III까지 거리가
 * 가장 먼** II를 고르면 그게 본문이다.
 *
 * 예전 코드는 이 구분을 못 해서 "사업의 개요" 첫 매치(=목차 줄)를 잡고 그 근처
 * 60줄만 떴다. 정작 생산능력·가동률·매출비중 표가 있는 본문(2,000줄대)을 통째로 놓쳤다.
 */
function sliceBusinessSection(lines: string[]): [number, number] | null {
  const heads: number[] = [];
  const tails: number[] = [];
  lines.forEach((l, i) => {
    if (/^(?:II|Ⅱ)\.\s*사업의\s*내용/.test(l)) heads.push(i);
    if (/^(?:III|Ⅲ)\.\s*재무에\s*관한/.test(l)) tails.push(i);
  });
  let best: [number, number] | null = null;
  let bestGap = -1;
  for (const s of heads) {
    const e = tails.find(x => x > s);
    if (e !== undefined && e - s > bestGap) { bestGap = e - s; best = [s + 1, e]; }
  }
  return best;
}

/**
 * 시계열 분석에 값이 있는 신호. 소분류가 상한을 넘칠 때 **이 신호가 있는 대목은
 * 앞에서 잘려도 살려낸다.** 점유율이 문서 깊숙이(기타참고 243줄째) 있어도 놓치지 않게.
 */
const SIGNAL = /점유율|비중|시장\s*규모|경쟁|주요\s*고객|매출처|가동률|생산\s*능력|생산\s*실적|수주\s*잔고|연구개발비|증설|신규\s*(사업|수주|계약)|CAPA|M\/S/;

/**
 * 한 소분류를 상한까지 담되, 넘치면 앞 문맥 + 신호 대목을 함께 남긴다.
 *
 * 통짜로 앞부분만 자르면 문서 뒤쪽 표(점유율·매출비중)가 늘 잘린다. 그래서 넘칠 때는
 * 앞 60%를 문맥으로 두고, 나머지 예산으로 **신호 줄과 그 뒤 표 몇 줄**을 끌어온다.
 */
function trimSubsection(lines: string[], cap: number): string {
  const joined = lines.join("\n");
  if (joined.length <= cap) return joined;

  const head: string[] = [];
  let used = 0, i = 0;
  const headBudget = Math.floor(cap * 0.6);
  for (; i < lines.length && used < headBudget; i++) { head.push(lines[i]); used += lines[i].length + 1; }

  // 남은 예산으로 신호 줄 + 뒤따르는 표 셀(숫자 줄) 몇 개를 창으로 담는다.
  const tail: string[] = [];
  for (let j = i; j < lines.length && used < cap; j++) {
    if (!SIGNAL.test(lines[j])) continue;
    for (let k = j; k < Math.min(j + 8, lines.length) && used < cap; k++) {
      tail.push(lines[k]); used += lines[k].length + 1;
    }
    tail.push("");
  }
  return head.join("\n") + (tail.length ? "\n… (중략) …\n" + tail.join("\n") : "");
}

/**
 * "II. 사업의 내용" 본문을 표준 소분류대로 잘라 담는다.
 *
 * 설계 원칙 세 가지 — 셋 다 실제 사고에서 나왔다.
 *
 *  1. **본문 블록을 먼저 격리한다.** 목차 마커를 잡던 버그를 원천 차단한다.
 *  2. **짧은 줄을 버리지 않는다.** 옛 코드의 `length > 3` 필터가 "26%"·"70" 같은
 *     표 셀을 통째로 지웠다 — 숫자를 뽑으려고 표를 받아놓고 숫자를 버린 꼴이었다.
 *  3. **소분류마다 따로 담는다.** 통짜로 잘라 앞부분만 남기면 문서 뒤쪽의 시장점유율
 *     ("7. 기타 참고사항")이 늘 잘린다. 소분류별로 각자 상한을 두면 끝 항목도 살아남는다.
 *
 * 위험관리(파생거래) 소분류만 버린다 — 정형 문구라 연도 비교에 값이 없다.
 */
export function extractSections(text: string, base = 4_000, quarterly = false): string {
  const raw = text.split("\n").map(l => l.trim());
  const span = sliceBusinessSection(raw);
  // 본문 블록을 못 찾으면(비정형 서식) 전체에서 찾되, 빈 줄만 제거한다.
  const lines = (span ? raw.slice(span[0], span[1]) : raw).filter(l => l.length > 0);

  // 각 줄을 현재 소분류에 배정한다. 머리글을 만나면 소분류가 바뀐다.
  const buckets = new Map<string, string[]>();
  let current: string | null = null; // null = 아직 소분류 진입 전 or 버리는 구간
  for (const line of lines) {
    const hit = BIZ_SUBSECTIONS.find(s => s.head.test(line));
    if (hit) { current = hit.key; if (current && !buckets.has(current)) buckets.set(current, []); }
    if (current && buckets.has(current)) buckets.get(current)!.push(line);
  }

  // 소분류 정의 순서대로, 각자 가중치만큼의 상한까지.
  // 분기·반기는 qWeight를 써서 반복 서술을 줄인다.
  const out: string[] = [];
  for (const sec of BIZ_SUBSECTIONS) {
    if (!sec.key) continue; // 위험관리(weight 0)는 key가 null이라 여기서 걸러진다
    const body = buckets.get(sec.key);
    if (!body || body.length === 0) continue;
    const w = quarterly ? sec.qWeight : sec.weight; // non-null key는 항상 > 0
    const chunk = trimSubsection(body, Math.round(base * w));
    if (chunk.length > 100) out.push(`### [${sec.key}]\n${chunk}`);
  }
  return out.join("\n\n");
}
