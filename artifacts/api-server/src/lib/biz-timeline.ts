/**
 * biz-timeline.ts — 사업보고서를 연도별로 쌓아 "이 회사가 어디로 가고 있나"를 본다.
 *
 * 왜 이 방향인가.
 *
 * 목표주가도 실적 전망도 결국 **예측**이다. 12개월 뒤 주가나 다음 분기 매출을 맞추는 건
 * 구조적으로 어렵고, 틀리면 나머지 분석까지 신뢰를 잃는다.
 *
 * 반면 "2023년엔 제대혈 보관이 매출의 70%였는데 2025년엔 55%다"는 **서술**이다.
 * 근거가 공시 원문이라 틀릴 수가 없고, 반박하려면 원문으로 해야 한다.
 *
 * 그리고 아무도 안 한다 — 증권사는 분기 코멘트를 쓰고, 사람이 사업보고서 5년치를
 * 나란히 읽기엔 너무 지루하다. LLM이 하기에 딱 맞는 일이다.
 *
 * ⚠️ 기존 `dart_biz_content`는 `UNIQUE(corp_code)`라 회사당 최신 1건만 남는다.
 * 비교할 과거가 없으면 이 분석 자체가 성립하지 않아 표를 따로 뒀다.
 */

import { pool } from "@workspace/db";
import { isKoreanTicker } from "@workspace/shared";
import { lookupCorpCode } from "./dart-store.js";
import { parseZip, htmlToText } from "./dart-business-content.js";
import {
  type BizReportYear, TIMELINE_SECTIONS, extractSections, parsePeriod, periodLabel,
  renderTimelineBody, BODY_BUDGET,
} from "./biz-timeline-extract.js";

// 순수 추출 로직은 biz-timeline-extract.ts(DB 무관, 테스트 가능)로 나갔다.
// 여기서는 그대로 재노출해 기존 import 경로를 유지한다.
export { TIMELINE_SECTIONS, extractSections, periodLabel, renderTimelineBody, BODY_BUDGET };
export type { BizReportYear };

const DART_API = "https://opendart.fss.or.kr/api";
const MAX_ZIP_BYTES = 20 * 1024 * 1024;

/**
 * 정기공시(사업·반기·분기) 목록을 기간별로 하나씩 고른다.
 *
 * 연간만 보면 1년에 한 점뿐이라 "언제부터 시작했나"를 1년 단위로만 알 수 있다.
 * 신규 사업·계약은 **분기보고서에 먼저 뜬다** — 분기까지 봐야 변화 시점이 잡힌다.
 */
async function listPeriodicReports(corpCode: string, key: string, fromYear: number) {
  const res = await fetch(
    `${DART_API}/list.json?crtfc_key=${key}&corp_code=${corpCode}` +
    `&bgn_de=${fromYear}0101&end_de=${new Date().toISOString().slice(0, 10).replace(/-/g, "")}` +
    `&pblntf_ty=A&last_reprt_at=N&page_count=100`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) return [];
  const data = await res.json() as any;
  if (data.status !== "000" || !Array.isArray(data.list)) return [];

  const byPeriod = new Map<string, { bsnsYear: number; quarter: number; rceptNo: string; reportNm: string }>();
  for (const r of data.list as any[]) {
    const nm: string = r.report_nm ?? "";
    if (!/사업보고서|반기보고서|분기보고서/.test(nm)) continue;
    const p = parsePeriod(nm);
    if (!p) continue;
    const rceptNo = r.rcept_no ?? r.rcp_no;
    if (!rceptNo) continue;

    // 정정본은 원문 ZIP이 없는 경우가 많다 — 원본을 우선한다
    const key2 = `${p.year}-${p.quarter}`;
    const cur = byPeriod.get(key2);
    if (!cur || (!/정정/.test(nm) && /정정/.test(cur.reportNm))) {
      byPeriod.set(key2, { bsnsYear: p.year, quarter: p.quarter, rceptNo, reportNm: nm });
    }
  }
  return [...byPeriod.values()]
    .sort((a, b) => b.bsnsYear - a.bsnsYear || b.quarter - a.quarter);
}

/** 원문 ZIP → 평문 */
async function fetchReportText(rceptNo: string, key: string): Promise<string | null> {
  const res = await fetch(
    `${DART_API}/document.xml?crtfc_key=${key}&rcept_no=${rceptNo}`,
    { signal: AbortSignal.timeout(40_000) },
  );
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_ZIP_BYTES || buf.length < 4) return null;
  if (buf.readUInt32LE(0) !== 0x04034b50) return null; // ZIP 서명 아님 = 오류 문서

  const files = parseZip(buf)
    .filter(e => /\.(x?html?|xml)$/i.test(e.name))
    .sort((a, b) => b.data.length - a.data.length);
  if (!files.length) return null;

  // 가장 큰 파일이 본문이다. 여러 개면 이어붙인다(사업보고서는 분할되기도 한다).
  return files.slice(0, 3).map(f => htmlToText(f.data.toString("utf8"))).join("\n");
}

/**
 * 최근 N년치 사업보고서를 받아 저장한다. 이미 받은 해는 건너뛴다.
 */
export async function collectBizTimeline(
  ticker: string,
  years = 4,
): Promise<{ collected: number; skipped: number; periods: string[] }> {
  const nil = { collected: 0, skipped: 0, periods: [] as string[] };
  if (!isKoreanTicker(ticker)) return nil;
  const key = process.env["DART_API_KEY"];
  if (!key) { console.warn("[biz-timeline] DART_API_KEY 없음"); return nil; }

  const corpCode = await lookupCorpCode(ticker);
  if (!corpCode) { console.warn(`[biz-timeline] ${ticker} corp_code 조회 실패`); return nil; }

  const fromYear = new Date().getFullYear() - years;
  const reports = await listPeriodicReports(corpCode, key, fromYear);
  if (!reports.length) { console.warn(`[biz-timeline] ${ticker} 정기공시 없음`); return nil; }

  const { rows: have } = await pool.query<{ bsns_year: number; quarter: number }>(
    `SELECT bsns_year, quarter FROM dart_biz_reports WHERE ticker = $1`, [ticker]);
  const haveKeys = new Set(have.map(r => `${r.bsns_year}-${r.quarter}`));

  let collected = 0, skipped = 0;
  const got: string[] = [];

  for (const rep of reports) {
    const k = `${rep.bsnsYear}-${rep.quarter}`;
    const label = periodLabel(rep.bsnsYear, rep.quarter);
    if (haveKeys.has(k)) { skipped++; got.push(label); continue; }

    const raw = await fetchReportText(rep.rceptNo, key);
    if (!raw) { console.warn(`[biz-timeline] ${ticker} ${label} 원문 실패 (${rep.reportNm})`); continue; }

    // 분기·반기는 짧게 뽑는다. 12개 기간을 연간과 같은 분량으로 넣으면 프롬프트가
    // 20만자를 넘어 감당이 안 되고, 무엇보다 분기 보고서는 연간의 요약·증분이라
    // 같은 내용이 반복된다. 변화가 드러나는 만큼만 담는다.
    // 연간은 full 가중치+큰 base, 분기·반기는 qWeight+작은 base로 반복 서술을 줄인다.
    // (분기의 바뀌는 숫자 표는 qWeight를 그대로 둬 살리고, 반복되는 기타참고만 깎는다)
    const content = extractSections(raw, rep.quarter === 4 ? 4_000 : 2_000, rep.quarter !== 4);
    if (content.length < 300) { console.warn(`[biz-timeline] ${ticker} ${label} 섹션 추출 실패`); continue; }

    await pool.query(
      `INSERT INTO dart_biz_reports
         (ticker, corp_code, bsns_year, quarter, rcept_no, report_nm, content, char_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (ticker, bsns_year, quarter) DO UPDATE SET
         rcept_no=EXCLUDED.rcept_no, report_nm=EXCLUDED.report_nm,
         content=EXCLUDED.content, char_count=EXCLUDED.char_count, fetched_at=NOW()`,
      [ticker, corpCode, rep.bsnsYear, rep.quarter, rep.rceptNo, rep.reportNm, content, content.length],
    );
    collected++;
    got.push(label);
    console.log(`[biz-timeline] ${ticker} ${label} 저장 (${content.length}자)`);
  }

  return { collected, skipped, periods: got.reverse() };
}

/** 저장된 기간별 보고서를 오래된 것부터 */
export async function getBizTimeline(ticker: string): Promise<BizReportYear[]> {
  const { rows } = await pool.query<{
    bsns_year: number; quarter: number; rcept_no: string; report_nm: string; content: string;
  }>(
    `SELECT bsns_year, quarter, rcept_no, report_nm, content
       FROM dart_biz_reports WHERE ticker = $1
      ORDER BY bsns_year ASC, quarter ASC`, [ticker]);
  return rows.map(r => ({
    bsnsYear: Number(r.bsns_year), quarter: Number(r.quarter),
    rceptNo: r.rcept_no, reportNm: r.report_nm, content: r.content,
  }));
}

/**
 * 최신 연간 사업보고서의 **원문 전체**를 평문으로 돌려준다.
 *
 * 고객 집중도(재무제표 주석)처럼 우리가 저장하는 "II. 사업의 내용"에는 없고
 * 원문 전체에만 있는 정보를 뽑을 때 쓴다. 저장하지 않고 그때그때 받는다(항상 최신).
 */
export async function fetchLatestAnnualText(ticker: string): Promise<string | null> {
  if (!isKoreanTicker(ticker)) return null;
  const key = process.env["DART_API_KEY"];
  if (!key) return null;
  const corpCode = await lookupCorpCode(ticker);
  if (!corpCode) return null;
  const reports = await listPeriodicReports(corpCode, key, new Date().getFullYear() - 2);
  const annual = reports.find(r => r.quarter === 4);
  if (!annual) return null;
  return fetchReportText(annual.rceptNo, key);
}
