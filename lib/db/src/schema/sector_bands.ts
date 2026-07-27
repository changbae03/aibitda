import { pgTable, text, integer, real, timestamp } from "drizzle-orm/pg-core";

/**
 * 업종별 배수 밴드 — 실측값.
 *
 * 프롬프트에 들어가는 "업종 PER/PBR 범위"가 코드 여러 곳에 손으로 적혀 있었고,
 * 적어둔 시점에 그대로 멈춰 있었다. 2026-07 실측과 대조한 결과:
 *
 *   한국 방산  코드 "PER 12~28x"  vs  실제 중앙값 50x   ← 목표가가 반토막 난다
 *   한국 건설  코드 "PBR 0.3~0.6x" vs  실제 중앙값 1.12x
 *   한국 금융  코드 "PBR 0.4~0.9x" vs  실제 중앙값 0.86x  (얼추 맞음)
 *
 * 손으로 적은 숫자는 반드시 낡는다. 그래서 stocks 뷰에서 직접 계산해 여기 적재하고,
 * 프롬프트는 이 표를 읽는다. 하드코딩 값은 표본이 모자랄 때의 폴백으로만 남긴다.
 *
 * 평균 대신 사분위수를 쓰는 이유: 적자 전환·일회성 이익 때문에 PER은 한두 종목이
 * 수백 배로 튀어 평균을 통째로 망가뜨린다. 중앙값은 그 영향을 받지 않는다.
 */
export const sectorMultipleBandsTable = pgTable("sector_multiple_bands", {
  /** classifySector()가 내는 값. 예: KR_DEFENSE, US_REIT */
  sector: text("sector").primaryKey(),

  /** 'KR' | 'US' — 섹터 접두사에서 따온 값이지만 조회 편의를 위해 컬럼으로 둔다 */
  market: text("market").notNull(),

  /** 이 섹터로 분류된 종목 수 (지표 유무와 무관한 전체) */
  stockCount: integer("stock_count").notNull().default(0),

  /** PER이 유효했던 종목 수. 이 값이 작으면 밴드를 신뢰하지 않는다 */
  perN: integer("per_n").notNull().default(0),
  perP25: real("per_p25"),
  perP50: real("per_p50"),
  perP75: real("per_p75"),

  /** PBR이 유효했던 종목 수 */
  pbrN: integer("pbr_n").notNull().default(0),
  pbrP25: real("pbr_p25"),
  pbrP50: real("pbr_p50"),
  pbrP75: real("pbr_p75"),

  /**
   * P/S = 시가총액 ÷ 매출.
   * 순부채를 전 종목에 갖고 있지 않아 EV가 아닌 시가총액 기준이다 — 이름도 그렇게 붙였다.
   * 이 지표를 넣은 직접적인 이유: 한국 방산주가 야후 업종만 보고 "EV/Sales 20~60x"
   * 지시를 받았는데 실제 배수는 2~4x였다. 실측이 있어야 그 지시를 대체할 수 있다.
   */
  psrN: integer("psr_n").notNull().default(0),
  psrP25: real("psr_p25"),
  psrP50: real("psr_p50"),
  psrP75: real("psr_p75"),

  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SectorMultipleBand = typeof sectorMultipleBandsTable.$inferSelect;
