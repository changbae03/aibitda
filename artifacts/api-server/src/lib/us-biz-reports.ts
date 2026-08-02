/**
 * us-biz-reports.ts — 미국 연차보고서(10-K/20-F) 사업 섹션을 저장·조회한다.
 *
 * 한국 dart_biz_reports(사업보고서 시계열)에 대응하는 미국판이다. 10-K HTML은 최대
 * 15MB라 매 분석마다 여러 해를 다시 받는 건 비싸다 — 한 번 받아 us_biz_reports에 넣고
 * 다음부터는 DB에서 읽는다(저장 우선). 수집은 분석 경로가 필요할 때 호출한다.
 */

import { pool } from "@workspace/db";
import { fetchMultiYearBusiness } from "./sec-edgar-content.js";

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
