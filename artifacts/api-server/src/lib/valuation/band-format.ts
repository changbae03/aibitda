/**
 * band-format.ts — 업종 배수 밴드의 계산·표기. DB를 모른다.
 *
 * DB 접근과 분리해 둔 이유는 peer-format.ts와 같다. 여기 있는 것은 전부
 * 순수 함수라 DATABASE_URL 없이 테스트할 수 있다.
 */

/** 밴드 한 종류(PER 또는 PBR)의 분포 */
export interface BandStat {
  n: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
}

export interface SectorBand {
  sector: string;
  market: string;
  stockCount: number;
  per: BandStat;
  pbr: BandStat;
  /** P/S = 시가총액 ÷ 매출 (순부채가 없어 EV가 아니다) */
  psr: BandStat;
  computedAt: Date;
}

/**
 * 표본이 이보다 적으면 밴드를 쓰지 않는다.
 *
 * 5로 잡은 근거: 사분위수는 최소 4개 구간이 있어야 의미가 생긴다. 실측에서
 * KR_TELECOM이 PER 유효 7종목으로 가장 빠듯했고, 그 아래(US_AUTO 3종목)는
 * 한 종목만 튀어도 중앙값이 통째로 흔들렸다.
 */
export const MIN_SAMPLES = 5;

/**
 * 배수를 밴드 계산에 넣을지 판단한다.
 *
 * 음수 PER은 적자 기업이라 "몇 배가 적정한가"라는 질문 자체가 성립하지 않는다.
 * 300배 초과는 이익이 0에 수렴한 경우라 배수가 무한대로 발산한 것이고,
 * PBR 30배 초과도 마찬가지로 자본잠식 직전이거나 데이터 오류다.
 * 이런 값을 섞으면 중앙값은 버텨도 p75가 망가진다.
 */
export function isUsablePer(v: unknown): v is number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 300;
}

export function isUsablePbr(v: unknown): v is number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 30;
}

/**
 * P/S 상한을 50배로 둔 이유: 매출이 거의 없는 임상 바이오텍·스팩은 P/S가 수백~수천배로
 * 나와 업종 밴드를 통째로 끌어올린다. 반대로 매출이 0이면 나눗셈 자체가 성립하지 않는다.
 */
export function isUsablePsr(v: unknown): v is number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 50;
}

/**
 * 정렬된 표본에서 백분위수를 뽑는다(최근접 순위법).
 *
 * 보간법을 쓰지 않는 이유: 밴드는 프롬프트에 소수 한두 자리로 들어가고,
 * 보간해봐야 표시 자리에서 사라진다. 실제 종목의 배수를 그대로 쓰는 편이
 * "이 숫자는 어느 종목에서 왔나"를 되짚기 쉽다.
 */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export function toStat(values: number[]): BandStat {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
  };
}

const fmt = (v: number | null, digits: number) => (v === null ? "-" : v.toFixed(digits));

/**
 * 프롬프트에 넣을 밴드 블록을 만든다.
 *
 * 표본이 모자라면 **숫자를 지어내지 않고** 그 사실을 알린다. 예전 구조는
 * 손으로 적어둔 기본값을 그대로 내보냈고, 그 값이 낡아서 한국 방산 목표가가
 * 실제의 절반으로 나왔다. 틀린 숫자는 없는 숫자보다 나쁘다.
 */
export function renderBandBlock(band: SectorBand | null, sector: string): string {
  if (!band) {
    return `\n[업종 실측 배수 — ${sector}]\n· 아직 집계된 표본이 없습니다. 피어 종목의 배수를 개별로 확인해 쓰세요.`;
  }

  const asOf = band.computedAt.toISOString().slice(0, 10);
  const lines = [`\n[업종 실측 배수 — ${band.sector} · ${asOf} 기준 · 분류 종목 ${band.stockCount}개]`];

  const perOk = band.per.n >= MIN_SAMPLES;
  const pbrOk = band.pbr.n >= MIN_SAMPLES;
  const psrOk = band.psr.n >= MIN_SAMPLES;

  if (perOk) {
    lines.push(
      `· PER  하위25% ${fmt(band.per.p25, 1)}x / 중앙값 ${fmt(band.per.p50, 1)}x / 상위25% ${fmt(band.per.p75, 1)}x  (유효 ${band.per.n}종목)`,
    );
  }
  if (pbrOk) {
    lines.push(
      `· PBR  하위25% ${fmt(band.pbr.p25, 2)}x / 중앙값 ${fmt(band.pbr.p50, 2)}x / 상위25% ${fmt(band.pbr.p75, 2)}x  (유효 ${band.pbr.n}종목)`,
    );
  }
  if (psrOk) {
    lines.push(
      `· P/S  하위25% ${fmt(band.psr.p25, 2)}x / 중앙값 ${fmt(band.psr.p50, 2)}x / 상위25% ${fmt(band.psr.p75, 2)}x  (유효 ${band.psr.n}종목)`,
      `  ※ P/S는 시가총액÷매출입니다. EV/Sales를 쓰려면 순부채를 더해 보정하세요.`,
    );
  }

  if (!perOk && !pbrOk && !psrOk) {
    lines.push(`· 유효 표본이 ${MIN_SAMPLES}종목 미만이라 밴드를 제시하지 않습니다. 피어 배수를 개별 확인하세요.`);
    return lines.join("\n");
  }

  lines.push(
    `⚠️ 위 숫자는 오늘 시장에서 실제로 거래되는 배수입니다(우리 종목 DB 집계).`,
    `· 목표 배수를 중앙값에서 크게 벗어나게 잡으려면 그 사유를 1줄 이상 쓰세요.`,
    `· 상위25%를 넘는 배수를 적용하려면 해당 종목이 업종 상위 25%에 드는 근거를 제시하세요.`,
  );

  return lines.join("\n");
}
