/**
 * biz-metrics.ts — 사업보고서에서 숫자를 **코드가** 뽑는다.
 *
 * 왜 LLM에게 맡기지 않는가.
 *
 * 기간이 4개에서 16개로 늘자 LLM이 다른 해 숫자를 끌어왔다(근거 확인 100% → 41%).
 * "2025년 유형자산 136,795백만원"이라고 썼는데 그 값은 2024년 원문에만 있었다.
 * 프롬프트로 "정확히 인용하라"고 해도 소용없다 — 원문 16개를 놓고 찾게 하면 섞인다.
 *
 * 그래서 순서를 바꾼다. **코드가 표를 뽑아 LLM에 넘기고, LLM은 "왜 변했나"만 쓴다.**
 * 숫자를 찾을 일이 없으면 섞일 일도 없다.
 *
 * DART 표는 htmlToText를 거치면 셀마다 줄바꿈된 형태가 된다.
 *
 *   연구개발비용 합계
 *   6,732,527      ← 당기
 *   4,954,447      ← 전기
 *   4,188,404      ← 전전기
 *
 * 라벨 한 줄 뒤에 값이 기수만큼 이어진다. 이 규칙 하나로 대부분의 표를 읽을 수 있다.
 *
 * DB를 모르는 순수 함수만 둔다.
 */

/** 뽑을 지표. key는 표 컬럼명이 되므로 짧게 */
export const METRIC_SPECS = [
  { key: "rndTotal",  label: "연구개발비",     unit: "백만원", match: /^연구개발비용\s*합계|^연구개발비용계/ },
  { key: "rndRatio",  label: "R&D/매출",       unit: "%",      match: /연구개발비\s*\/\s*매출액\s*비율/ },
  { key: "capacity",  label: "생산능력",       unit: "",       match: /^생산능력(\s*\(|\s*$|\s*합계)/ },
  { key: "output",    label: "생산실적",       unit: "",       match: /^생산실적(\s*\(|\s*$|\s*합계)/ },
  { key: "utilization", label: "가동률",       unit: "%",      match: /^(평균\s*)?가동률/ },
  { key: "backlog",   label: "수주잔고",       unit: "",       match: /^수주\s*잔고|^수주잔고/ },
] as const;

export type MetricKey = typeof METRIC_SPECS[number]["key"];

export interface MetricHit {
  key: MetricKey;
  label: string;
  unit: string;
  /** 라벨 뒤에 이어진 값들. 보통 [당기, 전기, 전전기] 순 */
  values: number[];
  /** 원문에서 라벨이 나온 줄 — 사람이 되짚을 때 쓴다 */
  sourceLine: string;
}

/** "6,732,527" · "6.9%" · "△1,234" → 숫자. 아니면 null */
function parseCell(raw: string): number | null {
  const s = raw.trim();
  if (!s || s.length > 24) return null;
  // 회계 표기: △·▲·() 는 음수
  const neg = /^[△▲(-]/.test(s) || /\)$/.test(s);
  const digits = s.replace(/[^\d.]/g, "");
  if (!digits || !/\d/.test(digits)) return null;
  // 숫자 외의 글자가 많으면 값이 아니라 문장이다
  const nonNumeric = s.replace(/[\d,.\s%△▲()\-원배억조]/g, "");
  if (nonNumeric.length > 0) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * 라벨 줄을 찾고 뒤따르는 값들을 읽는다.
 *
 * 값이 아닌 줄이 나오면 멈춘다 — 다음 라벨이 시작된 것이다.
 * 최대 6개까지만 읽는다(기수는 보통 3개, 넉넉히 잡아도 그 이상은 다른 표다).
 */
export function extractMetrics(content: string): MetricHit[] {
  const lines = content.split("\n").map(l => l.trim());
  const out: MetricHit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || parseCell(line) !== null) continue; // 값 줄은 라벨이 아니다

    for (const spec of METRIC_SPECS) {
      if (!spec.match.test(line)) continue;
      if (out.some(o => o.key === spec.key)) continue; // 첫 번째만 — 뒤는 대개 세부 항목

      const values: number[] = [];
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const v = parseCell(lines[j]);
        if (v === null) break;
        values.push(v);
        if (values.length >= 6) break;
      }
      if (values.length > 0) {
        out.push({ key: spec.key, label: spec.label, unit: spec.unit, values, sourceLine: line.slice(0, 120) });
      }
      break;
    }
  }
  return out;
}

export interface PeriodMetrics {
  periodLabel: string;
  bsnsYear: number;
  quarter: number;
  hits: MetricHit[];
}

const fmt = (v: number): string =>
  Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);

/**
 * 기간별 지표를 표 하나로 만든다. **LLM은 이 표만 보고 서술한다.**
 *
 * 각 기간의 첫 값(당기)만 쓴다 — 보고서마다 [당기, 전기, 전전기]가 들어 있지만
 * 전기·전전기는 이전 보고서의 당기와 같은 값이라 중복이다.
 */
export function renderMetricTable(periods: PeriodMetrics[]): string {
  const present = METRIC_SPECS.filter(s => periods.some(p => p.hits.some(h => h.key === s.key)));
  if (present.length === 0) return "";

  const lines = [
    "",
    "[📐 사업보고서에서 서버가 뽑은 수치 — 이 표의 값만 인용할 것]",
    "⚠️ 아래는 각 기간 원문에서 코드가 직접 추출한 값입니다. **원문을 다시 뒤져 숫자를 찾지 마세요.**",
    "⚠️ 표에 없는 지표는 그 기간 공시에 없는 것입니다 — 추정하지 말고 \"공시 미확인\"으로 적으세요.",
    "",
  ];

  const head = ["기간", ...present.map(s => `${s.label}${s.unit ? `(${s.unit})` : ""}`)];
  lines.push(`| ${head.join(" | ")} |`);
  lines.push(`|${head.map(() => "---").join("|")}|`);

  for (const p of periods) {
    const row = [p.periodLabel];
    for (const spec of present) {
      const hit = p.hits.find(h => h.key === spec.key);
      row.push(hit && hit.values.length ? fmt(hit.values[0]) : "—");
    }
    lines.push(`| ${row.join(" | ")} |`);
  }

  lines.push("", "· 값이 \"—\"인 칸은 그 기간 공시에 해당 항목이 없다는 뜻입니다.");
  return lines.join("\n");
}
