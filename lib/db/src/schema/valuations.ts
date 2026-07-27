import { pgTable, pgView, serial, text, integer, real, boolean, timestamp, unique, index } from "drizzle-orm/pg-core";
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

  /**
   * 이 값을 믿어도 되는가 — 저장 시점에 검산한 결과.
   *
   * 분석은 종목당 여러 번 쌓이고 결과가 크게 엇갈린다. 한화시스템은 같은 날 5건이
   * 저장됐는데 목표가가 1,590원 ~ 57,900원으로 36배 벌어져 있었다(현재가 68,200원).
   * 재사용하려면 어느 것이 정본인지 가릴 근거가 있어야 한다.
   * NULL은 검산 도입 전 행이다 — 정본 선정에서 배제하지는 않는다.
   */
  auditOk: boolean("audit_ok"),
  /** 무엇이 걸렸는지 — 사람이 되짚을 수 있게 사유를 남긴다 */
  auditIssues: text("audit_issues"),

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

// ─── 종목별 정본 ──────────────────────────────────────────────────────────────
// 실제 정의는 lib/db/src/migrate.ts에 있다(.existing()은 "이미 있는 뷰를 쓰겠다"는 선언).
//
// "이 종목의 현재 유효한 값"을 한 줄로 꺼내는 창구. 분석은 여러 번 쌓이지만
// 밸류에이션에 갖다 쓸 값은 하나여야 한다 — 조회를 stocks 뷰로 모은 것과 같은 원칙.
// 고르는 규칙은 **검산을 통과한 가장 최근 분석**이다.

export const stockValuationCurrentView = pgView("stock_valuation_current", {
  ticker: text("ticker").notNull(),
  analysisId: integer("analysis_id").notNull(),
  currentPrice: real("current_price"),
  bear: real("bear"),
  base: real("base"),
  bull: real("bull"),
  absModel: text("abs_model"),
  absBase: real("abs_base"),
  relBase: real("rel_base"),
  auditOk: boolean("audit_ok"),
  createdAt: timestamp("created_at", { withTimezone: true }),
}).existing();

export const stockSegmentForecastCurrentView = pgView("stock_segment_forecast_current", {
  ticker: text("ticker").notNull(),
  fiscalYear: integer("fiscal_year").notNull(),
  segmentName: text("segment_name").notNull(),
  currency: text("currency").notNull(),
  revenue: real("revenue"),
  operatingIncome: real("operating_income"),
  analysisId: integer("analysis_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
}).existing();

export type AnalysisValuation = typeof analysisValuationsTable.$inferSelect;
export type AnalysisSegmentForecast = typeof analysisSegmentForecastsTable.$inferSelect;
export type StockValuationCurrent = typeof stockValuationCurrentView.$inferSelect;
export type StockSegmentForecastCurrent = typeof stockSegmentForecastCurrentView.$inferSelect;
