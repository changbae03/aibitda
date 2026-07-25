import { pgTable, pgView, serial, text, integer, real, timestamp, varchar, numeric, bigint, date, boolean, uniqueIndex, index, unique } from "drizzle-orm/pg-core";

// KRX 업종 피어 데이터 (밸류에이션 비교용 스냅샷)
export const krxPeerDataTable = pgTable("krx_peer_data", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  market: varchar("market", { length: 10 }).notNull(),
  sector: varchar("sector", { length: 50 }).notNull(),
  pbr: numeric("pbr", { precision: 10, scale: 2 }),
  per: numeric("per", { precision: 10, scale: 2 }),
  bps: numeric("bps", { precision: 14, scale: 2 }),
  eps: numeric("eps", { precision: 14, scale: 2 }),
  mcap: bigint("mcap", { mode: "number" }),
  snapshotDate: date("snapshot_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("krx_peer_data_code_date_idx").on(t.code, t.snapshotDate),
]);

// 티커별 지표 캐시 (Yahoo/Naver 폴백 실패 시 재활용)
export const tickerMetricCacheTable = pgTable("ticker_metric_cache", {
  ticker: text("ticker").primaryKey(),
  pbr: real("pbr"),
  perTrailing: real("per_trailing"),
  perFwd: real("per_fwd"),
  evEbitda: real("ev_ebitda"),
  roe: real("roe"),
  operatingMargin: real("operating_margin"),
  marketCap: real("market_cap"),
  bookValue: real("book_value"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// DART 시계열 재무 데이터
// 실 DB 대조 완료(2026-07-25): 두 설계가 한 테이블에 섞여 있다.
//   - migrate.ts가 먼저 만든 계정과목 방식(account_nm NOT NULL + 5컬럼 UNIQUE)
//   - dart-store.ts가 나중에 ALTER로 덧붙인 지표 방식(revenue/operating_income…)
// 그 결과 dart-store의 INSERT가 account_nm NOT NULL을 위반해 항상 실패하고,
// 테이블은 0행 상태다. 아래는 "현재 실제 모양"이며 정상 상태가 아니다 — 수리 필요.
export const tickerFinancialsTable = pgTable("ticker_financials", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  bsnsYear: text("bsns_year").notNull(),
  reprtCode: text("reprt_code").notNull(),
  fsType: text("fs_type").notNull(),
  accountNm: text("account_nm").notNull(),
  thstrmAmount: bigint("thstrm_amount", { mode: "number" }),
  frmtrmAmount: bigint("frmtrm_amount", { mode: "number" }),
  bfefrmtrmAmount: bigint("bfefrmtrm_amount", { mode: "number" }),
  thstrmAddAmount: bigint("thstrm_add_amount", { mode: "number" }),
  currency: text("currency").default("KRW"),
  corpCode: varchar("corp_code", { length: 20 }).notNull().default(""),
  periodLabel: varchar("period_label", { length: 16 }).notNull().default(""),
  revenue: bigint("revenue", { mode: "number" }),
  operatingIncome: bigint("operating_income", { mode: "number" }),
  netIncome: bigint("net_income", { mode: "number" }),
  totalAssets: bigint("total_assets", { mode: "number" }),
  equity: bigint("equity", { mode: "number" }),
  cash: bigint("cash", { mode: "number" }),
  totalDebt: bigint("total_debt", { mode: "number" }),
  eps: bigint("eps", { mode: "number" }),
  bps: bigint("bps", { mode: "number" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  unique("ticker_financials_ticker_bsns_year_reprt_code_fs_type_accou_key").on(t.ticker, t.bsnsYear, t.reprtCode, t.fsType, t.accountNm),
  index("idx_ticker_financials_ticker").on(t.ticker, t.bsnsYear.desc()),
]);

// 한국 전체 상장 종목 마스터
export const krxStocksTable = pgTable("krx_stocks", {
  code: varchar("code", { length: 6 }).primaryKey(),
  name: text("name").notNull(),
  exchange: varchar("exchange", { length: 10 }).notNull(),
  symbol: text("symbol"),
  sector: text("sector"),
  industry: text("industry"),
  marketCap: bigint("market_cap", { mode: "number" }),
  currentPrice: real("current_price"),
  per: real("per"),
  pbr: real("pbr"),
  roe: real("roe"),
  opm: real("opm"),
  revGrowth: real("rev_growth"),
  revenue: bigint("revenue", { mode: "number" }),
  netIncome: bigint("net_income", { mode: "number" }),
  sharesOut: bigint("shares_out", { mode: "number" }),
  beta: real("beta"),
  week52High: real("week52_high"),
  week52Low: real("week52_low"),
  dataFetched: boolean("data_fetched").notNull().default(false),
  fetchError: text("fetch_error"),
  lastUpdated: timestamp("last_updated", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_krx_stocks_exchange").on(t.exchange),
  index("idx_krx_stocks_sector").on(t.sector),
]);

// 미국 주요 상장 종목 마스터
export const usStocksTable = pgTable("us_stocks", {
  ticker: text("ticker").primaryKey(),
  name: text("name").notNull(),
  exchange: varchar("exchange", { length: 10 }),
  sector: text("sector"),
  industry: text("industry"),
  marketCap: bigint("market_cap", { mode: "number" }),
  currentPrice: real("current_price"),
  per: real("per"),
  pbr: real("pbr"),
  roe: real("roe"),
  opm: real("opm"),
  revGrowth: real("rev_growth"),
  revenue: bigint("revenue", { mode: "number" }),
  netIncome: bigint("net_income", { mode: "number" }),
  sharesOut: bigint("shares_out", { mode: "number" }),
  beta: real("beta"),
  week52High: real("week52_high"),
  week52Low: real("week52_low"),
  dataFetched: boolean("data_fetched").notNull().default(false),
  fetchError: text("fetch_error"),
  lastUpdated: timestamp("last_updated", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_us_stocks_sector").on(t.sector),
  index("idx_us_stocks_exchange").on(t.exchange),
]);

// ─── 종목 통합 조회 창구 ──────────────────────────────────────────────────────
// 실제 정의는 lib/db/src/migrate.ts에 있다(.existing()은 "이미 있는 뷰를 쓰겠다"는 선언).
// 조회는 이 뷰로, 저장은 여전히 krx_stocks / us_stocks로 한다.
// 두 테이블의 실제 병합은 호스팅 이관 후로 미뤄져 있다 — migrate.ts의 주석 참고.
export const stocksView = pgView("stocks", {
  ticker: text("ticker").notNull(),
  market: text("market").notNull(),
  name: text("name").notNull(),
  exchange: text("exchange"),
  sector: text("sector"),
  industry: text("industry"),
  marketCap: bigint("market_cap", { mode: "number" }),
  currentPrice: real("current_price"),
  per: real("per"),
  pbr: real("pbr"),
  roe: real("roe"),
  opm: real("opm"),
  revGrowth: real("rev_growth"),
  revenue: bigint("revenue", { mode: "number" }),
  netIncome: bigint("net_income", { mode: "number" }),
  sharesOut: bigint("shares_out", { mode: "number" }),
  beta: real("beta"),
  week52High: real("week52_high"),
  week52Low: real("week52_low"),
  dataFetched: boolean("data_fetched"),
  fetchError: text("fetch_error"),
  lastUpdated: timestamp("last_updated", { withTimezone: true }),
}).existing();

export type Stock = typeof stocksView.$inferSelect;

export type KrxPeerData = typeof krxPeerDataTable.$inferSelect;
export type TickerMetricCache = typeof tickerMetricCacheTable.$inferSelect;
export type TickerFinancial = typeof tickerFinancialsTable.$inferSelect;
export type KrxStock = typeof krxStocksTable.$inferSelect;
export type UsStock = typeof usStocksTable.$inferSelect;
