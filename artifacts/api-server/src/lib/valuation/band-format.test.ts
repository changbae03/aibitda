import { describe, it, expect } from "vitest";
import {
  percentile,
  toStat,
  isUsablePer,
  isUsablePbr,
  renderBandBlock,
  MIN_SAMPLES,
  type SectorBand,
} from "./band-format";

const band = (over: Partial<SectorBand> = {}): SectorBand => ({
  sector: "KR_DEFENSE",
  market: "KR",
  stockCount: 26,
  per: { n: 18, p25: 12.5, p50: 26.4, p75: 34.8 },
  pbr: { n: 22, p25: 0.98, p50: 1.98, p75: 3.71 },
  psr: { n: 20, p25: 1.2, p50: 2.9, p75: 4.1 },
  computedAt: new Date("2026-07-26T00:00:00Z"),
  ...over,
});

describe("백분위수", () => {
  it("정렬된 표본에서 위치를 집는다", () => {
    // 최근접 순위법: 표본 10개면 인덱스 floor(10×p)를 집는다 → 3번째·6번째·8번째 값
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(s, 0.25)).toBe(3);
    expect(percentile(s, 0.5)).toBe(6);
    expect(percentile(s, 0.75)).toBe(8);
  });

  it("빈 표본은 null", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("표본이 하나여도 터지지 않는다", () => {
    expect(percentile([7], 0.75)).toBe(7);
  });

  it("toStat이 정렬을 알아서 한다 — 입력 순서에 의존하지 않는다", () => {
    expect(toStat([9, 1, 5, 3, 7]).p50).toBe(toStat([1, 3, 5, 7, 9]).p50);
  });
});

describe("배수 걸러내기", () => {
  // 적자 기업의 음수 PER을 섞으면 "몇 배가 적정한가"라는 질문 자체가 깨진다.
  it("음수·0은 쓰지 않는다", () => {
    expect(isUsablePer(-6.97)).toBe(false); // 실제 대우건설 값
    expect(isUsablePer(0)).toBe(false);
    expect(isUsablePbr(-1)).toBe(false);
  });

  it("발산한 값은 쓰지 않는다", () => {
    expect(isUsablePer(1200)).toBe(false); // 이익이 0에 수렴한 경우
    expect(isUsablePbr(85)).toBe(false);
  });

  it("정상 범위는 통과한다", () => {
    expect(isUsablePer(26.4)).toBe(true);
    expect(isUsablePbr(1.98)).toBe(true);
  });

  it("숫자가 아닌 값에 걸려 넘어지지 않는다", () => {
    expect(isUsablePer(null)).toBe(false);
    expect(isUsablePer(undefined)).toBe(false);
    expect(isUsablePer("abc")).toBe(false);
    expect(isUsablePer(NaN)).toBe(false);
  });
});

describe("프롬프트 블록", () => {
  it("실측 배수를 그대로 싣는다", () => {
    const t = renderBandBlock(band(), "KR_DEFENSE");
    expect(t).toContain("중앙값 26.4x");
    expect(t).toContain("중앙값 1.98x");
    expect(t).toContain("2026-07-26");
  });

  /**
   * 이 프로젝트에서 실제로 났던 사고의 재발 방지선이다.
   * 예전에는 표본이 없으면 손으로 적어둔 기본값을 내보냈고, 그 값이 낡아서
   * 한국 방산주가 "EV/Sales 20~60x(스페이스X 비교군)" 지시를 받았다.
   * 한화시스템의 실제 EV/Sales는 3.4x였다.
   */
  it("표본이 없으면 숫자를 지어내지 않는다", () => {
    const t = renderBandBlock(null, "KR_DEFENSE");
    expect(t).toContain("표본이 없습니다");
    expect(t).not.toMatch(/\d+(\.\d+)?x/); // 배수 형태의 숫자가 하나도 없어야 한다
  });

  it("표본이 기준 미달이면 그 쪽 밴드를 내보내지 않는다", () => {
    const t = renderBandBlock(
      band({ per: { n: MIN_SAMPLES - 1, p25: 1, p50: 2, p75: 3 } }),
      "KR_DEFENSE",
    );
    expect(t).not.toContain("PER");
    expect(t).toContain("PBR"); // PBR은 표본이 충분하므로 남는다
  });

  it("전부 미달이면 밴드를 아예 제시하지 않는다", () => {
    const t = renderBandBlock(
      band({
        per: { n: 1, p25: 1, p50: 2, p75: 3 },
        pbr: { n: 2, p25: 1, p50: 2, p75: 3 },
        psr: { n: 0, p25: null, p50: null, p75: null },
      }),
      "KR_DEFENSE",
    );
    expect(t).toContain("개별 확인");
    expect(t).not.toMatch(/중앙값 \d/);
  });

  /**
   * 한화시스템 사고의 정면 대응. 예전 프롬프트는 야후 업종이 'Aerospace & Defense'
   * 라는 이유만으로 "EV/Sales 20~60x(스페이스X 비교군), 15x 미만은 근거 필수"를
   * 지시했다. 한화시스템의 실제 P/S는 3.4x다.
   */
  it("P/S 실측을 싣고, 시가총액 기준임을 밝힌다", () => {
    const t = renderBandBlock(band(), "KR_DEFENSE");
    expect(t).toContain("P/S");
    expect(t).toContain("중앙값 2.90x");
    expect(t).toContain("시가총액÷매출"); // EV와 혼동하면 순부채만큼 어긋난다
    expect(t).not.toContain("20~60x");
  });

  it("밴드를 벗어날 때 근거를 요구한다", () => {
    const t = renderBandBlock(band(), "KR_DEFENSE");
    expect(t).toContain("사유를 1줄 이상");
    expect(t).toContain("근거를 제시");
  });
});
