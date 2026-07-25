import { pgTable, serial, text, integer, timestamp, unique, index } from "drizzle-orm/pg-core";

/**
 * 종목별 피어그룹 (비교 대상 경쟁사).
 *
 * 예전에는 분석할 때마다 AI가 피어를 새로 고르고, 각 피어의 재무를 외부 API로
 * 하나씩 다시 조회한 뒤 분석이 끝나면 전부 버렸다. 같은 종목을 다시 분석해도
 * 피어가 달라질 수 있어 비교가 흔들렸고, 외부 호출도 매번 반복됐다.
 *
 * 여기에 남겨두면 ① 다음 분석이 같은 피어를 재사용해 결과가 일관되고
 * ② 피어의 지표는 stocks 뷰에서 조인해 오므로 외부 호출이 사라진다.
 *
 * peerTicker는 stocks 뷰의 ticker와 같은 표준형(005930 / NVDA)이다.
 * 뷰는 외래키 대상이 될 수 없어 제약으로 강제하지는 못한다 — 저장 시
 * normalizeTicker를 반드시 통과시킬 것.
 */
export const stockPeersTable = pgTable("stock_peers", {
  id: serial("id").primaryKey(),

  /** 비교의 기준이 되는 종목 */
  ticker: text("ticker").notNull(),
  /** 비교 대상 (경쟁사) */
  peerTicker: text("peer_ticker").notNull(),

  /** 화면·프롬프트에 넣을 표시용 이름. 마스터에 없을 때를 대비한 사본 */
  peerName: text("peer_name"),

  /** 낮을수록 대표적인 피어. AI가 준 순서를 보존한다 */
  rank: integer("rank").notNull().default(0),

  /** AI가 이 종목을 피어로 고른 이유 — 나중에 선정 품질을 되짚을 때 쓴다 */
  reason: text("reason"),

  /** 'ai' = LLM 선정, 'sector' = 같은 업종 자동 추출, 'manual' = 손으로 지정 */
  source: text("source").notNull().default("ai"),

  /** 이 피어를 고른 분석. 분석이 지워져도 피어는 남기므로 외래키를 걸지 않는다 */
  selectedByAnalysisId: integer("selected_by_analysis_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("stock_peers_ticker_peer_key").on(t.ticker, t.peerTicker),
  index("idx_stock_peers_ticker").on(t.ticker, t.rank),
]);

export type StockPeer = typeof stockPeersTable.$inferSelect;
