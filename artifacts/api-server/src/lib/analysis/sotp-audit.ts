/**
 * sotp-audit.ts — SOTP 표의 산수를 검산한다.
 *
 * AI가 만든 SOTP(Sum-of-the-Parts) 표에서 `배수 × 기준값 = EV`가 실제로 맞는지
 * 서버가 다시 계산한다. 프롬프트로 "정확히 계산하라"고 지시해도 LLM은 산수를
 * 틀린다 — 막을 방법은 검산뿐이다.
 *
 * 실제 사고(한화시스템, 2026-07): EV/Sales 계산이 두 부문 모두 정확히 1/10로 나왔다.
 *   ICT 서비스   매출 12,100 × 3.0배 = 36,300  →  표에는 3,630
 *   우주항공     매출  5,000 × 8.0배 = 40,000  →  표에는 4,000
 * 그 결과 주주가치가 12,705억으로 계산돼 주당 6,725원이 나왔다. 바로잡으면
 * 81,375억·주당 43,074원으로 6배 넘게 달라진다. 목표주가가 통째로 무너진 것이다.
 *
 * 표 형식은 프롬프트가 정하므로 열 순서가 바뀌면 파싱이 조용히 실패한다.
 * 그래서 "검출된 행이 0개"인 것과 "검산에서 어긋난 행이 있는" 것을 구분해 돌려준다.
 */

export interface SotpRow {
  /** 사업부·자회사 이름 */
  name: string;
  /** 적용 모델 — EV/EBITDA, EV/Sales, PER 등 */
  model: string;
  /** 배수 (15.0x → 15.0) */
  multiple: number;
  /** 표에 적힌 EV */
  statedEv: number;
  /** 모델에 맞는 기준값 — EV/Sales면 매출, 그 외엔 영업이익 */
  base: number;
  /** 배수 × 기준값 */
  expectedEv: number;
  /** statedEv / expectedEv — 1에 가까워야 정상 */
  ratio: number;
  ok: boolean;
}

export interface SotpAudit {
  rows: SotpRow[];
  /** 검산에서 어긋난 행 */
  mismatches: SotpRow[];
  /** 표를 찾지 못했으면 true — 형식이 바뀌었을 수 있다 */
  notFound: boolean;
}

/** "15.0x", "15배", "3.0" 등에서 숫자만 */
function parseMultiple(cell: string): number | null {
  const m = cell.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(?:x|배)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "19,575", "1,305" 등 숫자 셀. 음수와 대시는 null */
function parseNum(cell: string): number | null {
  const c = cell.replace(/[,\s*]/g, "");
  if (!c || c === "—" || c === "-") return null;
  const n = parseFloat(c.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 마크다운 표에서 SOTP 행을 뽑아 검산한다.
 * 허용 오차 2% — 반올림 표기 차이는 넘어가고 자릿수 실수만 잡는다.
 */
export function auditSotp(content: string, tolerance = 0.02): SotpAudit {
  const rows: SotpRow[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 8) continue;

    // 모델 열을 단서로 삼는다 — 헤더·구분선·합계행에는 없다
    const modelIdx = cells.findIndex((c) => /^(EV\/EBITDA|EV\/Sales|EV\/EBIT|PER|PBR|rNPV|DCF)$/i.test(c));
    if (modelIdx < 0) continue;

    const model = cells[modelIdx];
    const multiple = parseMultiple(cells[modelIdx + 1] ?? "");
    const statedEv = parseNum(cells[modelIdx + 2] ?? "");
    if (multiple == null || statedEv == null || statedEv <= 0) continue;

    // 모델 앞쪽 숫자 셀이 매출·영업이익 — EV/Sales는 매출, 나머지는 이익 기준
    const nums = cells.slice(1, modelIdx).map(parseNum).filter((v): v is number => v != null);
    if (nums.length === 0) continue;
    const isSales = /sales/i.test(model);
    const base = isSales ? nums[0] : (nums[1] ?? nums[0]);
    if (!Number.isFinite(base) || base === 0) continue;

    const expectedEv = base * multiple;
    const ratio = statedEv / expectedEv;
    rows.push({
      name: cells[1] ?? "",
      model, multiple, statedEv, base, expectedEv, ratio,
      ok: Math.abs(ratio - 1) <= tolerance,
    });
  }

  return {
    rows,
    mismatches: rows.filter((r) => !r.ok),
    notFound: rows.length === 0,
  };
}

/** QC 단계에 넘길 지적 사항. 문제가 없으면 null */
export function formatSotpIssues(audit: SotpAudit): string | null {
  if (audit.mismatches.length === 0) return null;
  const lines = audit.mismatches.map((m) => {
    const scale = m.ratio < 1 ? `${(1 / m.ratio).toFixed(0)}배 축소` : `${m.ratio.toFixed(0)}배 확대`;
    return `- ${m.name}: ${m.model} ${m.multiple}배 × ${m.base.toLocaleString()} = ${m.expectedEv.toLocaleString()} 이어야 하는데 표에는 ${m.statedEv.toLocaleString()} (${scale})`;
  });
  return [
    "⛔ SOTP 표의 산수가 맞지 않습니다. 아래 행을 다시 계산해 표와 최종 주당가치를 모두 고치세요.",
    ...lines,
    "※ EV를 고치면 주주가치 합계와 주당가치도 함께 바뀝니다. 합계만 맞추지 말고 각 행부터 정정하세요.",
  ].join("\n");
}
