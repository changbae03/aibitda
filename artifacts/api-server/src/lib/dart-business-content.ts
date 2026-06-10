/**
 * dart-business-content.ts
 * DART 사업보고서 원문에서 "사업의 내용" 핵심 섹션 텍스트 추출.
 *
 * 흐름:
 *  1. DART /api/list.json → 최신 연간 사업보고서 rcpNo 조회
 *  2. DART /api/document.json → 원문 ZIP 다운로드 URL 획득
 *  3. ZIP 다운로드 (최대 20MB) → 로컬 ZIP 파서로 HTML 파일 추출
 *  4. 사업 관련 키워드 포함 HTML에서 텍스트 변환 및 핵심 구간 추출
 *  5. DB(dart_biz_content 테이블)에 30일 캐시
 */

import zlib from "node:zlib";
import { pool } from "@workspace/db";

const DART_API = "https://opendart.fss.or.kr/api";
const MAX_ZIP_BYTES = 20 * 1024 * 1024; // 20 MB
const CACHE_DAYS = 30;
const FETCH_TIMEOUT = 20_000;

// ─── DB 캐시 ──────────────────────────────────────────────────────────────────

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dart_biz_content (
      id         SERIAL PRIMARY KEY,
      corp_code  VARCHAR(20) NOT NULL,
      rcp_no     VARCHAR(20),
      content    TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(corp_code)
    )
  `);
  tableReady = true;
}

async function getCached(corpCode: string): Promise<string | null> {
  try {
    await ensureTable();
    const r = await pool.query<{ content: string; fetched_at: Date }>(
      "SELECT content, fetched_at FROM dart_biz_content WHERE corp_code = $1",
      [corpCode]
    );
    if (!r.rows[0]) return null;
    const ageMs = Date.now() - r.rows[0].fetched_at.getTime();
    return ageMs > CACHE_DAYS * 86_400_000 ? null : r.rows[0].content;
  } catch {
    return null;
  }
}

async function setCached(
  corpCode: string,
  rcpNo: string,
  content: string
): Promise<void> {
  try {
    await ensureTable();
    await pool.query(
      `INSERT INTO dart_biz_content (corp_code, rcp_no, content, fetched_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (corp_code) DO UPDATE
         SET rcp_no = $2, content = $3, fetched_at = NOW()`,
      [corpCode, rcpNo, content]
    );
  } catch { /* 캐시 저장 실패는 무시 */ }
}

// ─── corp_code 조회 ───────────────────────────────────────────────────────────

async function lookupCorpCode(stockCode: string, key: string): Promise<string | null> {
  // 1순위: DB에서 이미 수집된 corp_code 조회
  try {
    const r = await pool.query<{ corp_code: string }>(
      "SELECT DISTINCT corp_code FROM ticker_financials WHERE ticker = $1 LIMIT 1",
      [stockCode]
    );
    if (r.rows[0]?.corp_code) return r.rows[0].corp_code;
  } catch { /* fallthrough */ }

  // 2순위: DART API 직접 조회
  try {
    const res = await fetch(
      `${DART_API}/company.json?crtfc_key=${key}&stock_code=${stockCode}`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.status === "000" ? (data.corp_code ?? null) : null;
  } catch {
    return null;
  }
}

// ─── ZIP 파서 (Local File Header 방식) ───────────────────────────────────────

interface ZipEntry { name: string; data: Buffer; }

function parseZip(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const SIG = 0x04034b50; // PK\x03\x04
  let i = 0;

  while (i <= buf.length - 30) {
    if (buf.readUInt32LE(i) !== SIG) { i++; continue; }

    const method  = buf.readUInt16LE(i + 8);
    const compSz  = buf.readUInt32LE(i + 18);
    const fnLen   = buf.readUInt16LE(i + 26);
    const exLen   = buf.readUInt16LE(i + 28);
    const name    = buf.subarray(i + 30, i + 30 + fnLen).toString("utf8");
    const dataOff = i + 30 + fnLen + exLen;

    if (compSz === 0 || dataOff + compSz > buf.length) { i = Math.max(dataOff, i + 1); continue; }

    const compressed = buf.subarray(dataOff, dataOff + compSz);
    try {
      const data = method === 0 ? compressed : zlib.inflateRawSync(compressed);
      if (data.length > 1_000) entries.push({ name, data }); // 1KB 미만 파일 제외
    } catch { /* 손상된 항목 스킵 */ }

    i = dataOff + compSz;
  }

  return entries;
}

// ─── HTML → 평문 변환 ─────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6]|section|article)>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/[ \t]{3,}/g, "  ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
}

// ─── 핵심 섹션 추출 ───────────────────────────────────────────────────────────

const MARKERS = [
  "사업의 내용", "업계의 현황", "회사의 현황", "주요 제품", "주요제품",
  "수주 현황", "수주잔고", "영업 개황", "시장 점유율", "경쟁 현황",
  "연구개발 활동", "연구개발비", "주요 계약", "원재료 및 생산설비",
  "매출 현황", "생산 실적", "판매 경로", "지적재산권",
  // TAM/시장 규모 관련 키워드 추가
  "시장 현황", "시장현황", "시장 규모", "시장규모", "업계 규모", "시장 전망",
  "시장 성장", "타겟 시장", "목표 시장", "시장 점유", "글로벌 시장",
  "국내 시장", "제품 현황", "임상 현황", "파이프라인", "IR 자료",
  "사업 전망", "성장 전략", "시장 기회",
];

function extractKeyContent(text: string, maxChars = 4_500): string {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 4);
  const blocks: string[] = [];
  let current: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const isMarker = MARKERS.some((m) => line.includes(m));
    if (isMarker) {
      if (current.length > 2) blocks.push(current.join("\n"));
      current = [line];
      capturing = true;
    } else if (capturing) {
      current.push(line);
      if (current.length >= 80) {
        blocks.push(current.join("\n"));
        current = [];
        capturing = false;
      }
    }
    if (blocks.join("\n\n").length >= maxChars) break;
  }
  if (current.length > 2) blocks.push(current.join("\n"));

  return blocks.join("\n\n---\n").slice(0, maxChars);
}

// ─── 경쟁 현황 섹션 추출 ─────────────────────────────────────────────────────

const COMP_MARKERS = [
  "경쟁 현황", "경쟁현황", "시장 점유율", "시장점유율",
  "경쟁 업체", "경쟁업체", "주요 경쟁", "업계 현황", "경쟁사",
];

/**
 * 사업보고서 원문에서 경쟁 현황 관련 섹션만 추출.
 * 피어 선정 프롬프트에 주입하여 DART 기재 경쟁사를 우선 반영.
 * - 경쟁 현황 섹션이 없으면 전체 내용 앞부분(1500자) 반환.
 */
export async function fetchDartCompetitorSection(stockCode: string): Promise<string | null> {
  const full = await fetchDartBusinessContent(stockCode);
  if (!full) return null;

  const lines = full.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const isCompMarker = COMP_MARKERS.some((m) => line.includes(m));
    if (isCompMarker) {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [line];
      capturing = true;
    } else if (capturing) {
      current.push(line);
      if (current.length >= 60) {
        blocks.push(current.join("\n"));
        current = [];
        capturing = false;
      }
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));

  const result = blocks.join("\n\n").trim();
  if (result.length > 80) return result.slice(0, 2_500);

  // 경쟁 현황 섹션이 없으면 전체 원문 앞부분 반환
  return full.slice(0, 2_000);
}

// ─── 공개 함수 ────────────────────────────────────────────────────────────────

/**
 * 한국 주식 6자리 코드를 입력받아 DART 사업보고서 "사업의 내용" 주요 섹션 텍스트를 반환.
 * 실패·타임아웃 시 null 반환 (분석 파이프라인을 블로킹하지 않음).
 */
export async function fetchDartBusinessContent(stockCode: string): Promise<string | null> {
  if (!/^\d{6}$/.test(stockCode)) return null;

  const key = process.env["DART_API_KEY"];
  if (!key) return null;

  // ── corp_code 획득 ──
  const corpCode = await lookupCorpCode(stockCode, key);
  if (!corpCode) return null;

  // ── 캐시 확인 ──
  const cached = await getCached(corpCode);
  if (cached) return cached;

  try {
    // ── 1. 최신 사업보고서 rcpNo ──
    const year = new Date().getFullYear();
    const bgn  = `${year - 2}0101`;
    const end  = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const listRes = await fetch(
      `${DART_API}/list.json?crtfc_key=${key}&corp_code=${corpCode}` +
      `&bgn_de=${bgn}&end_de=${end}&pblntf_ty=A&last_reprt_at=Y&page_count=5`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) }
    );
    if (!listRes.ok) return null;
    const listData = await listRes.json() as any;
    if (listData.status !== "000" || !Array.isArray(listData.list) || !listData.list.length) return null;

    // 분기·반기 제외, 순수 사업보고서 선택
    const annual = (listData.list as any[]).find(
      (r) => r.report_nm?.includes("사업보고서") &&
             !r.report_nm?.includes("분기") &&
             !r.report_nm?.includes("반기")
    );
    if (!annual) return null;
    const rcpNo: string  = annual.rcp_no;
    const rcpDt: string  = annual.rcept_dt ?? "";

    // ── 2. 원문 ZIP URL 획득 ──
    const docRes = await fetch(
      `${DART_API}/document.json?crtfc_key=${key}&rcpNo=${rcpNo}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) }
    );
    if (!docRes.ok) return null;
    const docData = await docRes.json() as any;
    const zipUrl: string | undefined = docData.url;
    if (!zipUrl) return null;

    // ── 3. ZIP 다운로드 (크기 제한) ──
    const zipRes = await fetch(zipUrl, { signal: AbortSignal.timeout(25_000) });
    if (!zipRes.ok) return null;
    const cl = Number(zipRes.headers.get("content-length") ?? "0");
    if (cl > MAX_ZIP_BYTES) {
      console.warn(`[dart-biz-content] ${stockCode} ZIP 크기 ${(cl / 1e6).toFixed(1)}MB > 20MB 제한, 스킵`);
      return null;
    }
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    if (zipBuf.length > MAX_ZIP_BYTES) return null;

    // ── 4. ZIP 파싱 → HTML 파일 추출 ──
    const entries = parseZip(zipBuf);
    const htmlFiles = entries
      .filter((e) => /\.(html|htm)$/i.test(e.name))
      .sort((a, b) => b.data.length - a.data.length); // 크기 내림차순 (본문이 가장 큼)

    if (!htmlFiles.length) return null;

    // ── 5. 사업 내용 키워드 포함 파일에서 텍스트 추출 ──
    let extracted = "";
    for (const file of htmlFiles.slice(0, 10)) {
      const html = file.data.toString("utf8");
      if (!MARKERS.some((m) => html.includes(m))) continue;

      const text    = htmlToText(html);
      const content = extractKeyContent(text, 4_500);
      if (content.length > 400) {
        extracted = content;
        break;
      }
    }

    if (!extracted) return null;

    const reportPeriod = rcpDt ? `${rcpDt.slice(0, 4)}년도` : `${year - 1}년도`;
    const result = [
      `[📄 DART 사업보고서 — 사업의 내용 (${reportPeriod} 연간보고서, rcpNo: ${rcpNo})]`,
      `⚠️ DART 원문 기반 실제 사업 내용. 주요 제품·시장점유율·수주잔고·경쟁현황·R&D 파악에 활용. 숫자는 DART 재무데이터 섹션과 교차 검증 필수.`,
      extracted,
    ].join("\n");

    await setCached(corpCode, rcpNo, result);
    console.log(`[dart-biz-content] ${stockCode} 사업보고서 추출 완료 (${result.length}자)`);
    return result;

  } catch (e) {
    console.warn(
      "[dart-biz-content] 조회 실패:",
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

// ─── 수주잔고·매출구조 전용 추출 ───────────────────────────────────────────────

const BACKLOG_MARKERS = [
  "수주 현황", "수주현황", "수주잔고", "수주 잔고", "신규수주", "수주액",
  "수주 실적", "공사 수주", "잔여 수주", "수주 목표",
  "매출 현황", "매출현황", "생산 실적", "생산실적", "판매 실적", "판매실적",
  "생산·판매", "제품별 매출", "주요 제품 매출", "사업부별 매출",
  "품목별 매출", "부문별 매출", "부문별 실적",
  "ASP", "평균 판매단가", "판매단가", "판매가격", "단가 추이",
  "판매량", "출하량", "생산량", "판매 수량", "판매물량",
];

/**
 * DART 사업보고서에서 수주잔고·매출구조(P×Q) 관련 섹션만 추출.
 * 실적 전망 P×Q 분해 추정의 입력 데이터로 사용.
 * - 수주현황·생산실적·단가정보 섹션이 없으면 null 반환.
 */
export async function fetchDartOrderBacklog(stockCode: string): Promise<string | null> {
  const full = await fetchDartBusinessContent(stockCode);
  if (!full) return null;

  const lines = full.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const isMarker = BACKLOG_MARKERS.some((m) => line.includes(m));
    if (isMarker) {
      if (current.length > 1) blocks.push(current.join("\n"));
      current = [line];
      capturing = true;
    } else if (capturing) {
      current.push(line);
      if (current.length >= 60) {
        blocks.push(current.join("\n"));
        current = [];
        capturing = false;
      }
    }
  }
  if (current.length > 1) blocks.push(current.join("\n"));

  const result = blocks.join("\n\n").trim();
  if (result.length < 60) return null;

  return [
    `[📦 DART 수주잔고·매출구조 (P×Q 분해 추정용)]`,
    `⚠️ DART 사업보고서 원문 발췌. 수주잔고·단가·물량 수치를 P×Q 실적 추정의 1순위 입력값으로 사용하세요.`,
    result.slice(0, 3_000),
  ].join("\n");
}
