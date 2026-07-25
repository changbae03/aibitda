import { pgTable, serial, text, integer, real, timestamp, unique, index } from "drizzle-orm/pg-core";
import { analysesTable } from "./analyses";

/**
 * 분석이 산출한 밸류에이션 결과.
 *
 * AI는 relative_valuation 단계 끝에 FINAL_VALUATION_DATA JSON을 내보내는데,
 * 예전에는 그중 base(기본 시나리오 목표가) 하나만 analyses.target_price로 옮기고
 * 나머지 10개 값을 버렸다. 시나리오 밴드와 절대·상대 평가 근거를 남겨야
 * "목표가가 왜 바뀌었나", "밴드가 얼마나 넓었나(불확실성)"를 나중에 따질 수 있다.
 *
 * 분석 1건당 1행. 같은 분석을 다시 계산해도 덮어쓴다.
 */
export const analysisValuationsTable = pgTable("analysis_valuations", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id").notNull().references(() => analysesTable.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),

  /** 분석 시점 주가 — 목표가와의 괴리를 나중에 재계산하지 않아도 되도록 함께 남긴다 */
  currentPrice: real("current_price"),

  /** 최종 시나리오별 목표가 */
  bear: real("bear"),
  base: real("base"),
  bull: real("bull"),

  /** 절대가치 평가 (DCF·rNPV·SOTP 등). absModel은 실제 사용한 모델명 */
  absModel: text("abs_model"),
  absBear: real("abs_bear"),
  absBase: real("abs_base"),
  absBull: real("abs_bull"),

  /** 상대가치 평가 (피어 멀티플 기반) */
  relBear: real("rel_bear"),
  relBase: real("rel_base"),
  relBull: real("rel_bull"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("analysis_valuations_analysis_id_key").on(t.analysisId),
  index("idx_analysis_valuations_ticker").on(t.ticker, t.createdAt.desc()),
]);

/**
 * 사업부문별 실적 전망.
 *
 * AI가 SEGMENT_FORECAST_DATA로 내보내는 {name, rev26, rev27, op26, op27} 구조를
 * 연도별 행으로 펼쳐 저장한다. 컬럼(rev26/rev27)으로 두면 AI가 3년치를 내보내는
 * 순간 표를 고쳐야 하므로, 연도를 값으로 들고 간다.
 *
 * 이 표가 쌓이면 "예상 매출 vs 실제 매출"을 대조해 업종별 낙관 편향을 잴 수 있다.
 * 단위는 AI 프롬프트 기준 억원이며 currency로 통화를 구분한다.
 */
export const analysisSegmentForecastsTable = pgTable("analysis_segment_forecasts", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id").notNull().references(() => analysesTable.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),

  segmentName: text("segment_name").notNull(),
  currency: text("currency").notNull().default("KRW"),

  /** 전망 대상 회계연도 (2026, 2027 …) */
  fiscalYear: integer("fiscal_year").notNull(),

  /** 억원 단위 (currency 기준) */
  revenue: real("revenue"),
  operatingIncome: real("operating_income"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("analysis_segment_forecasts_uniq").on(t.analysisId, t.segmentName, t.fiscalYear),
  index("idx_analysis_segment_forecasts_ticker").on(t.ticker, t.fiscalYear),
]);

export type AnalysisValuation = typeof analysisValuationsTable.$inferSelect;
export type AnalysisSegmentForecast = typeof analysisSegmentForecastsTable.$inferSelect;
