/**
 * us-biz-reports.ts — 미국 연차보고서(10-K/20-F) 사업 섹션을 저장·조회한다.
 *
 * 한국 dart_biz_reports(사업보고서 시계열)에 대응하는 미국판이다. 10-K HTML은 최대
 * 15MB라 매 분석마다 여러 해를 다시 받는 건 비싸다 — 한 번 받아 us_biz_reports에 넣고
 * 다음부터는 DB에서 읽는다(저장 우선). 수집은 분석 경로가 필요할 때 호출한다.
 */

import { pool } from "@workspace/db";
import { fetchMultiYearBusiness, getCikToTicker } from "./sec-edgar-content.js";

export interface USBizReport { fy: number; filedDate: string | null; content: string; }

export async function saveUSBizReports(ticker: string, rows: USBizReport[]): Promise<void> {
  for (const r of rows) {
    await pool.query(
      `INSERT INTO us_biz_reports (ticker, fy, filed_date, content, char_count, fetched_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (ticker, fy) DO UPDATE SET
         filed_date=EXCLUDED.filed_date, content=EXCLUDED.content,
         char_count=EXCLUDED.char_count, fetched_at=NOW()`,
      [ticker, r.fy, r.filedDate, r.content, r.content.length],
    ).catch((e) => console.warn(`[us-biz-reports] 저장 실패 ${ticker} FY${r.fy}:`, (e as Error)?.message?.slice(0, 60)));
  }
}

/** 저장된 미국 사업 섹션을 회계연도 오름차순으로 읽는다. */
export async function getUSBizReports(ticker: string): Promise<USBizReport[]> {
  const { rows } = await pool.query(
    `SELECT fy, filed_date, content FROM us_biz_reports WHERE ticker = $1 ORDER BY fy ASC`,
    [ticker],
  );
  return rows.map((r: any) => ({ fy: Number(r.fy), filedDate: r.filed_date, content: r.content }));
}

/**
 * 저장 우선. 저장된 게 2개년 이상이면 그대로, 아니면 SEC에서 받아 저장한 뒤 돌려준다.
 * 분석 경로와 배치 러너가 함께 쓴다.
 */
export async function collectUSBizReports(ticker: string, n = 4): Promise<USBizReport[]> {
  const cached = await getUSBizReports(ticker).catch(() => []);
  if (cached.length >= 2) return cached;
  const fetched = await fetchMultiYearBusiness(ticker, n);
  const rows: USBizReport[] = fetched.map(f => ({ fy: f.fy, filedDate: f.filedDate, content: f.text }));
  if (rows.length > 0) await saveUSBizReports(ticker, rows);
  return rows.sort((a, b) => a.fy - b.fy);
}

/**
 * **오늘 새로 올라온 10-K**를 종목 단위로 훑는다 — 한국의 `collectNewFilings`와 짝이다.
 *
 * 회사별로 10,000번 물어볼 필요가 없다. SEC 일별 색인(daily-index)이 그날 접수된
 * 모든 제출을 한 파일로 준다. 여기서 10-K만 골라 그 회사만 받아온다.
 *
 * ⚠️ 미국은 회계연도 말이 회사마다 달라 10-K가 1년 내내 흩어져 들어온다.
 * 한국처럼 마감일에 몰리지 않으므로 하루 물량은 보통 수십 건이다.
 */
export async function collectNewUSFilings(days = 3): Promise<{ filers: number; updated: number }> {
  const rev = await getCikToTicker().catch(() => new Map<number, string>());
  if (rev.size === 0) { console.warn("[us-biz] CIK 맵 로드 실패 — 신규 10-K 훑기 건너뜀"); return { filers: 0, updated: 0 }; }

  const tickers = new Set<string>();
  for (let d = 0; d < days; d++) {
    const day = new Date(Date.now() - d * 86_400_000);
    const y = day.getUTCFullYear();
    const qtr = Math.floor(day.getUTCMonth() / 3) + 1;
    const ymd = day.toISOString().slice(0, 10).replace(/-/g, "");
    const url = `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${qtr}/form.${ymd}.idx`;

    const res = await fetch(url, {
      headers: { "User-Agent": "AiBITDA Research ai@aibotda.com" },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    // 주말·공휴일은 색인 파일 자체가 없다(404). 오류가 아니다.
    if (!res?.ok) continue;

    for (const line of (await res.text()).split("\n")) {
      // 고정폭: 폼종류 · 회사명 · CIK · 날짜 · 파일경로
      // ⚠️ 날짜는 `20260813` 형식이다. `2026-08-13`으로 찾으면 한 건도 안 걸린다.
      if (!/^10-K(\/A)?\s/.test(line)) continue;
      const m = line.match(/\s(\d{1,10})\s+\d{8}\s/);
      if (!m) continue;
      const t = rev.get(Number(m[1]));
      if (t) tickers.add(t);
    }
  }

  let updated = 0;
  for (const ticker of tickers) {
    try {
      // 이미 있는 종목은 `collectUSBizReports`가 저장본을 그대로 돌려주므로,
      // 새 회계연도가 들어와도 갱신되지 않는다. 그래서 여기서는 직접 받아 저장한다.
      const fetched = await fetchMultiYearBusiness(ticker, 4);
      if (fetched.length === 0) continue;
      await saveUSBizReports(ticker, fetched.map(f => ({ fy: f.fy, filedDate: f.filedDate, content: f.text })));
      updated++;
    } catch (e) {
      console.warn(`[us-biz] ${ticker} 신규 10-K 수집 실패:`, (e as Error)?.message?.slice(0, 80));
    }
  }
  console.log(`[us-biz] 신규 10-K ${tickers.size}종목 확인, ${updated}종목 갱신`);
  return { filers: tickers.size, updated };
}
