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

const DART_API = "https://opendart.fss.or.kr/api";
const MAX_ZIP_BYTES = 20 * 1024 * 1024;

/**
 * 연도 비교에 쓸 섹션들.
 *
 * **무엇을 비교할지 미리 정해두는 것이 핵심이다.** 정하지 않고 LLM에 맡기면 회사마다,
 * 실행마다 다른 것을 말한다 — 이번 작업에서 밸류에이션이 흔들린 이유가 정확히 그것이었다.
 * 같은 잣대를 모든 회사·모든 해에 적용해야 변화가 눈에 띈다.
 */
export const TIMELINE_SECTIONS = [
  { key: "사업개요",   markers: ["사업의 개요", "사업의 내용", "회사의 현황", "영업 개황"] },
  { key: "주요제품",   markers: ["주요 제품", "주요제품", "제품 및 서비스", "매출 구성"] },
  { key: "매출처",     markers: ["주요 매출처", "매출처", "판매 경로", "판매경로"] },
  { key: "생산판매",   markers: ["생산 및 설비", "생산능력", "생산실적", "판매실적", "가동률"] },
  { key: "수주",       markers: ["수주 현황", "수주현황", "수주잔고", "신규수주"] },
  { key: "연구개발",   markers: ["연구개발 활동", "연구개발비", "연구개발 실적", "신규 사업"] },
  { key: "시장경쟁",   markers: ["시장 점유율", "경쟁 현황", "업계의 현황", "시장 여건"] },
] as const;

export interface BizReportYear {
  bsnsYear: number;
  rceptNo: string;
  reportNm: string;
  content: string;
}

/** 사업보고서 목록에서 연도별 최신 원본을 고른다 */
async function listAnnualReports(corpCode: string, key: string, fromYear: number) {
  const res = await fetch(
    `${DART_API}/list.json?crtfc_key=${key}&corp_code=${corpCode}` +
    `&bgn_de=${fromYear}0101&end_de=${new Date().toISOString().slice(0, 10).replace(/-/g, "")}` +
    `&pblntf_ty=A&last_reprt_at=N&page_count=100`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) return [];
  const data = await res.json() as any;
  if (data.status !== "000" || !Array.isArray(data.list)) return [];

  const byYear = new Map<number, { rceptNo: string; reportNm: string }>();
  for (const r of data.list as any[]) {
    const nm: string = r.report_nm ?? "";
    if (!nm.includes("사업보고서") || /분기|반기/.test(nm)) continue;
    // "사업보고서 (2025.12)" → 2025
    const y = Number(nm.match(/\((\d{4})\./)?.[1]);
    if (!Number.isFinite(y)) continue;
    const rceptNo = r.rcept_no ?? r.rcp_no;
    if (!rceptNo) continue;
    // 정정본은 원문 ZIP이 없는 경우가 많다 — 원본을 우선한다
    const isCorrection = /정정/.test(nm);
    const cur = byYear.get(y);
    if (!cur || (isCorrection === false && /정정/.test(cur.reportNm))) {
      byYear.set(y, { rceptNo, reportNm: nm });
    }
  }
  return [...byYear.entries()]
    .map(([bsnsYear, v]) => ({ bsnsYear, ...v }))
    .sort((a, b) => b.bsnsYear - a.bsnsYear);
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
 * 정해둔 섹션만 잘라낸다.
 *
 * 원문은 수백 페이지라 통째로 넣으면 프롬프트가 감당하지 못한다. 그렇다고 앞부분만
 * 자르면(예전 방식) 연도별로 다른 대목이 잘려 비교가 안 된다.
 * **섹션을 정해 같은 자리를 뽑아야** 해가 바뀌어도 같은 것을 비교하게 된다.
 */
export function extractSections(text: string, perSection = 2_500): string {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 3);
  const out: string[] = [];

  for (const sec of TIMELINE_SECTIONS) {
    let best = "";
    for (let i = 0; i < lines.length; i++) {
      if (!sec.markers.some(m => lines[i].includes(m))) continue;
      const chunk = lines.slice(i, i + 60).join("\n").slice(0, perSection);
      if (chunk.length > best.length) best = chunk;
      if (best.length >= perSection) break;
    }
    if (best.length > 100) out.push(`### [${sec.key}]\n${best}`);
  }
  return out.join("\n\n");
}

/**
 * 최근 N년치 사업보고서를 받아 저장한다. 이미 받은 해는 건너뛴다.
 */
export async function collectBizTimeline(
  ticker: string,
  years = 5,
): Promise<{ collected: number; skipped: number; years: number[] }> {
  if (!isKoreanTicker(ticker)) return { collected: 0, skipped: 0, years: [] };
  const key = process.env["DART_API_KEY"];
  if (!key) { console.warn("[biz-timeline] DART_API_KEY 없음"); return { collected: 0, skipped: 0, years: [] }; }

  const corpCode = await lookupCorpCode(ticker);
  if (!corpCode) { console.warn(`[biz-timeline] ${ticker} corp_code 조회 실패`); return { collected: 0, skipped: 0, years: [] }; }

  const fromYear = new Date().getFullYear() - years - 1;
  const reports = (await listAnnualReports(corpCode, key, fromYear)).slice(0, years);
  if (!reports.length) { console.warn(`[biz-timeline] ${ticker} 사업보고서 없음`); return { collected: 0, skipped: 0, years: [] }; }

  const { rows: have } = await pool.query<{ bsns_year: number }>(
    `SELECT bsns_year FROM dart_biz_reports WHERE ticker = $1`, [ticker]);
  const haveYears = new Set(have.map(r => Number(r.bsns_year)));

  let collected = 0, skipped = 0;
  const got: number[] = [];

  for (const rep of reports) {
    if (haveYears.has(rep.bsnsYear)) { skipped++; got.push(rep.bsnsYear); continue; }

    const raw = await fetchReportText(rep.rceptNo, key);
    if (!raw) { console.warn(`[biz-timeline] ${ticker} ${rep.bsnsYear}년 원문 실패 (${rep.reportNm})`); continue; }

    const content = extractSections(raw);
    if (content.length < 300) { console.warn(`[biz-timeline] ${ticker} ${rep.bsnsYear}년 섹션 추출 실패`); continue; }

    await pool.query(
      `INSERT INTO dart_biz_reports (ticker, corp_code, bsns_year, rcept_no, report_nm, content, char_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (ticker, bsns_year) DO UPDATE SET
         rcept_no=EXCLUDED.rcept_no, report_nm=EXCLUDED.report_nm,
         content=EXCLUDED.content, char_count=EXCLUDED.char_count, fetched_at=NOW()`,
      [ticker, corpCode, rep.bsnsYear, rep.rceptNo, rep.reportNm, content, content.length],
    );
    collected++;
    got.push(rep.bsnsYear);
    console.log(`[biz-timeline] ${ticker} ${rep.bsnsYear}년 저장 (${content.length}자)`);
  }

  return { collected, skipped, years: got.sort() };
}

/** 저장된 연도별 보고서를 오래된 것부터 */
export async function getBizTimeline(ticker: string): Promise<BizReportYear[]> {
  const { rows } = await pool.query<{
    bsns_year: number; rcept_no: string; report_nm: string; content: string;
  }>(
    `SELECT bsns_year, rcept_no, report_nm, content
       FROM dart_biz_reports WHERE ticker = $1 ORDER BY bsns_year ASC`, [ticker]);
  return rows.map(r => ({
    bsnsYear: Number(r.bsns_year), rceptNo: r.rcept_no,
    reportNm: r.report_nm, content: r.content,
  }));
}
