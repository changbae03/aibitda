/**
 * winner-pattern.ts — 누적 급등 데이터 패턴 분석 (AI 인사이트 생성)
 * ────────────────────────────────────────────────────────────────────
 * daily_winners 테이블에 2주+ 데이터가 쌓이면 Gemini로 인사이트를 생성한다.
 * 결과는 winner_pattern_cache 테이블에 저장 (24시간 TTL).
 *
 * 분석 항목:
 *  1. 어떤 특징 조합이 실제 급등(5%+)과 가장 상관이 높은가?
 *  2. 급등 예비군 / 상승 후보 픽 중 실제로 5%+ 오른 비율
 *  3. 시간대별(요일별) 급등 빈도
 *  4. 점수 가중치 조정 제안 (데이터 기반)
 */

import { pool } from "@workspace/db";
import { GoogleGenAI } from "@google/genai";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

// ─── 테이블 초기화 ───────────────────────────────────────────────────────────

async function ensurePatternTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS winner_pattern_cache (
      id          SERIAL PRIMARY KEY,
      report_date DATE NOT NULL UNIQUE,
      data_days   INT,
      total_winners INT,
      insight_md  TEXT,
      raw_stats   JSONB,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// ─── 통계 수집 ───────────────────────────────────────────────────────────────

interface PatternStats {
  dataDays: number;
  totalWinners: number;
  byVolumeRatio: { band: string; avgChange: number; count: number; hitRate10: number }[];
  bySmartMoney:  { band: string; avgChange: number; count: number; hitRate10: number }[];
  byTurnover:    { band: string; avgChange: number; count: number; hitRate10: number }[];
  byDayOfWeek:   { dow: string; avgCount: number; avgChange: number }[];
  presurgeHitRate5:  number | null;
  presurgeHitRate10: number | null;
  tomorrowHitRate5:  number | null;
  tomorrowHitRate10: number | null;
  topCorrelFeatures: { feature: string; lift: number; sampleN: number }[];
}

async function collectStats(days = 30): Promise<PatternStats | null> {
  const { rows: meta } = await pool.query<{ cnt: number; day_cnt: number }>(
    `SELECT COUNT(*)::int AS cnt, COUNT(DISTINCT trade_date)::int AS day_cnt
     FROM daily_winners WHERE trade_date >= CURRENT_DATE - ($1 || ' days')::interval`,
    [days],
  );
  const totalWinners = meta[0]?.cnt ?? 0;
  const dataDays     = meta[0]?.day_cnt ?? 0;
  if (totalWinners < 20 || dataDays < 5) return null;

  const bandQuery = (groupExpr: string) => `
    SELECT
      ${groupExpr} AS band,
      ROUND(AVG(change_pct)::numeric, 2) AS avg_change,
      COUNT(*)::int AS count,
      ROUND((SUM(CASE WHEN change_pct >= 10 THEN 1 ELSE 0 END)::numeric
             / NULLIF(COUNT(*),0) * 100), 1) AS hit_rate_10
    FROM daily_winners
    WHERE trade_date >= CURRENT_DATE - ($1 || ' days')::interval
    GROUP BY 1 ORDER BY AVG(change_pct) DESC
  `;

  const [volRows, smRows, toRows, dowRows, presurgeRows, tomorrowRows] = await Promise.all([
    pool.query(bandQuery(`
      CASE
        WHEN volume_ratio_75th >= 5 THEN '5배+ 거래량 폭발'
        WHEN volume_ratio_75th >= 3 THEN '3-5배 거래량 급증'
        WHEN volume_ratio_75th >= 2 THEN '2-3배 거래량 증가'
        ELSE '2배 미만'
      END
    `), [days]),
    pool.query(bandQuery(`
      CASE
        WHEN smart_money_aek >= 30 THEN '스마트머니 30억+'
        WHEN smart_money_aek >= 10 THEN '스마트머니 10-30억'
        WHEN smart_money_aek >= 0  THEN '스마트머니 0-10억'
        ELSE '스마트머니 순매도'
      END
    `), [days]),
    pool.query(bandQuery(`
      CASE
        WHEN turnover_aek >= 500 THEN '거래대금 500억+'
        WHEN turnover_aek >= 100 THEN '거래대금 100-500억'
        WHEN turnover_aek >= 20  THEN '거래대금 20-100억'
        ELSE '거래대금 20억 미만'
      END
    `), [days]),
    pool.query(`
      SELECT
        TO_CHAR(trade_date, 'Dy') AS dow,
        ROUND(AVG(daily_count)::numeric, 1) AS avg_count,
        ROUND(AVG(avg_chg)::numeric, 2)     AS avg_change
      FROM (
        SELECT trade_date,
               COUNT(*)           AS daily_count,
               AVG(change_pct)    AS avg_chg
        FROM daily_winners
        WHERE trade_date >= CURRENT_DATE - ($1 || ' days')::interval
        GROUP BY trade_date
      ) t
      GROUP BY TO_CHAR(trade_date, 'Dy')
      ORDER BY avg_count DESC
    `, [days]),
    // presurge 적중률
    pool.query(`
      SELECT
        ROUND(100.0 * SUM(CASE WHEN was_presurge_pick AND change_pct >= 5  THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN was_presurge_pick THEN 1 ELSE 0 END), 0), 1) AS hit5,
        ROUND(100.0 * SUM(CASE WHEN was_presurge_pick AND change_pct >= 10 THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN was_presurge_pick THEN 1 ELSE 0 END), 0), 1) AS hit10
      FROM daily_winners
      WHERE trade_date >= CURRENT_DATE - ($1 || ' days')::interval
    `, [days]),
    pool.query(`
      SELECT
        ROUND(100.0 * SUM(CASE WHEN was_tomorrow_pick AND change_pct >= 5  THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN was_tomorrow_pick THEN 1 ELSE 0 END), 0), 1) AS hit5,
        ROUND(100.0 * SUM(CASE WHEN was_tomorrow_pick AND change_pct >= 10 THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN was_tomorrow_pick THEN 1 ELSE 0 END), 0), 1) AS hit10
      FROM daily_winners
      WHERE trade_date >= CURRENT_DATE - ($1 || ' days')::interval
    `, [days]),
  ]);

  // 특징 리프트 계산 (급등 종목 중 비율 vs 전체 시장 중 비율)
  const { rows: liftRows } = await pool.query<{
    feature: string; lift: number; sample_n: number;
  }>(`
    SELECT feature, ROUND(lift::numeric, 2) AS lift, sample_n
    FROM (
      VALUES
        ('거래량 5배+',
          (SELECT ROUND((100.0 * COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM daily_winners WHERE trade_date >= CURRENT_DATE - INTERVAL '30 days'), 0)), 1)
           FROM daily_winners WHERE volume_ratio_75th >= 5 AND trade_date >= CURRENT_DATE - INTERVAL '30 days'),
          (SELECT COUNT(*)::int FROM daily_winners WHERE volume_ratio_75th >= 5 AND trade_date >= CURRENT_DATE - INTERVAL '30 days')
        ),
        ('스마트머니 10억+',
          (SELECT ROUND((100.0 * COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM daily_winners WHERE trade_date >= CURRENT_DATE - INTERVAL '30 days'), 0)), 1)
           FROM daily_winners WHERE smart_money_aek >= 10 AND trade_date >= CURRENT_DATE - INTERVAL '30 days'),
          (SELECT COUNT(*)::int FROM daily_winners WHERE smart_money_aek >= 10 AND trade_date >= CURRENT_DATE - INTERVAL '30 days')
        ),
        ('기관 순매수',
          (SELECT ROUND((100.0 * COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM daily_winners WHERE trade_date >= CURRENT_DATE - INTERVAL '30 days'), 0)), 1)
           FROM daily_winners WHERE institution_aek > 0 AND trade_date >= CURRENT_DATE - INTERVAL '30 days'),
          (SELECT COUNT(*)::int FROM daily_winners WHERE institution_aek > 0 AND trade_date >= CURRENT_DATE - INTERVAL '30 days')
        )
    ) AS t(feature, lift, sample_n)
    ORDER BY lift DESC
  `).catch(() => ({ rows: [] }));

  return {
    dataDays,
    totalWinners,
    byVolumeRatio: (volRows.rows as any[]).map(r => ({
      band: r.band, avgChange: r.avg_change, count: r.count, hitRate10: r.hit_rate_10 ?? 0,
    })),
    bySmartMoney: (smRows.rows as any[]).map(r => ({
      band: r.band, avgChange: r.avg_change, count: r.count, hitRate10: r.hit_rate_10 ?? 0,
    })),
    byTurnover: (toRows.rows as any[]).map(r => ({
      band: r.band, avgChange: r.avg_change, count: r.count, hitRate10: r.hit_rate_10 ?? 0,
    })),
    byDayOfWeek: (dowRows.rows as any[]).map(r => ({
      dow: r.dow, avgCount: r.avg_count, avgChange: r.avg_change,
    })),
    presurgeHitRate5:  presurgeRows.rows[0]?.hit5  ?? null,
    presurgeHitRate10: presurgeRows.rows[0]?.hit10 ?? null,
    tomorrowHitRate5:  tomorrowRows.rows[0]?.hit5  ?? null,
    tomorrowHitRate10: tomorrowRows.rows[0]?.hit10 ?? null,
    topCorrelFeatures: liftRows.map(r => ({
      feature: r.feature, lift: r.lift, sampleN: r.sample_n,
    })),
  };
}

// ─── Gemini 인사이트 생성 ────────────────────────────────────────────────────

async function generateInsight(stats: PatternStats, today: string): Promise<string> {
  const prompt = `
당신은 한국 주식시장 퀀트 분석가입니다.
아래 ${stats.dataDays}거래일(총 ${stats.totalWinners}개 급등 종목) 누적 데이터를 분석해
실전 투자에 바로 쓸 수 있는 핵심 인사이트를 마크다운으로 작성하세요.

## 거래량 배율별 평균 등락률
${JSON.stringify(stats.byVolumeRatio, null, 2)}

## 스마트머니(기관+외인)별 평균 등락률
${JSON.stringify(stats.bySmartMoney, null, 2)}

## 거래대금별 평균 등락률
${JSON.stringify(stats.byTurnover, null, 2)}

## 요일별 급등 종목 수
${JSON.stringify(stats.byDayOfWeek, null, 2)}

## 예측 적중률
- 급등 예비군 → 실제 5%+: ${stats.presurgeHitRate5 ?? "데이터 부족"}%
- 급등 예비군 → 실제 10%+: ${stats.presurgeHitRate10 ?? "데이터 부족"}%
- 상승 후보 → 실제 5%+: ${stats.tomorrowHitRate5 ?? "데이터 부족"}%
- 상승 후보 → 실제 10%+: ${stats.tomorrowHitRate10 ?? "데이터 부족"}%

작성 요령:
1. "## 핵심 발견" 섹션: 데이터에서 가장 강한 패턴 3가지 (숫자 근거 필수)
2. "## 점수 조정 제안" 섹션: 현재 알고리즘에서 가중치를 높이거나 낮춰야 할 특징
3. "## 주의 신호" 섹션: 오히려 급등과 역상관인 특징 (있으면)
4. "## 다음 단계" 섹션: 샘플이 더 쌓이면 할 수 있는 개선 방향
5. 각 섹션 3줄 이내, 총 300자 이내로 간결하게
`;

  try {
    const res = await genai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    return res.text?.replace(/```json\n?|```/g, "").trim() ?? "인사이트 생성 실패";
  } catch (e) {
    console.error("[winner-pattern] Gemini 실패:", e);
    return buildFallbackInsight(stats);
  }
}

function buildFallbackInsight(stats: PatternStats): string {
  const topVol = stats.byVolumeRatio[0];
  const topSm  = stats.bySmartMoney[0];
  const lines = [
    `## 핵심 발견 (${stats.dataDays}거래일 기준)`,
    topVol ? `- **${topVol.band}** 종목 평균 등락률 +${topVol.avgChange}% (${topVol.count}건)` : "",
    topSm  ? `- **${topSm.band}** 종목 평균 등락률 +${topSm.avgChange}%` : "",
    stats.presurgeHitRate5 != null
      ? `- 급등 예비군 적중률 **${stats.presurgeHitRate5}%** (5%+ 기준)`
      : "- 데이터 누적 중...",
    `\n## 데이터 현황`,
    `- ${stats.dataDays}거래일 / 급등 종목 총 ${stats.totalWinners}건 추적 중`,
    `- 2주 이상 쌓이면 AI 인사이트가 자동 생성됩니다.`,
  ];
  return lines.filter(Boolean).join("\n");
}

// ─── 공개 API ────────────────────────────────────────────────────────────────

export interface WinnerPatternReport {
  reportDate:   string;
  dataDays:     number;
  totalWinners: number;
  insightMd:    string;
  rawStats:     PatternStats | null;
  generatedAt:  string;
  isCached:     boolean;
}

export async function getWinnerPatternReport(forceRefresh = false): Promise<WinnerPatternReport> {
  await ensurePatternTable();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  if (!forceRefresh) {
    const { rows: cached } = await pool.query<{
      report_date: string; data_days: number; total_winners: number;
      insight_md: string; raw_stats: any; created_at: string;
    }>(
      `SELECT * FROM winner_pattern_cache WHERE report_date = $1`,
      [today],
    );
    if (cached.length > 0) {
      const c = cached[0]!;
      return {
        reportDate: c.report_date,
        dataDays:   c.data_days,
        totalWinners: c.total_winners,
        insightMd:  c.insight_md,
        rawStats:   c.raw_stats,
        generatedAt: c.created_at,
        isCached:   true,
      };
    }
  }

  const stats = await collectStats(30);
  if (!stats) {
    const msg = "## 데이터 누적 중\n\n아직 데이터가 부족합니다. 장 마감 후 매일 자동으로 수집되며, **5거래일 이상** 쌓이면 패턴 분석이 시작됩니다.";
    return {
      reportDate: today, dataDays: 0, totalWinners: 0,
      insightMd: msg, rawStats: null,
      generatedAt: new Date().toISOString(), isCached: false,
    };
  }

  const insightMd = await generateInsight(stats, today);

  await pool.query(`
    INSERT INTO winner_pattern_cache (report_date, data_days, total_winners, insight_md, raw_stats)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (report_date) DO UPDATE
    SET data_days = EXCLUDED.data_days, total_winners = EXCLUDED.total_winners,
        insight_md = EXCLUDED.insight_md, raw_stats = EXCLUDED.raw_stats, created_at = NOW()
  `, [today, stats.dataDays, stats.totalWinners, insightMd, JSON.stringify(stats)]);

  return {
    reportDate: today, dataDays: stats.dataDays, totalWinners: stats.totalWinners,
    insightMd, rawStats: stats, generatedAt: new Date().toISOString(), isCached: false,
  };
}
