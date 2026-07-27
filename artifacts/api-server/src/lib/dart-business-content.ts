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
import { lookupCorpCode } from "./dart-store.js";
import { isKoreanTicker } from "@workspace/shared";

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

/**
 * ⚠️ 여기에 corp_code 조회를 다시 구현하지 말 것.
 *
 * 예전에는 이 파일이 자체 구현을 갖고 있었고, 그것이 두 갈래로 실패했다.
 *   1순위 ticker_financials 조회 — 이미 분석된 종목에만 값이 있어 신규 종목은 빈손
 *   2순위 `company.json?stock_code=` — DART가 규격을 바꿔(corp_code 필수) 폐기된 API
 * 그 결과 삼성전자조차 corp_code를 못 얻어 사업보고서가 **한 건도** 수집되지 않았다.
 *
 * dart-store의 것은 서버 기동 시 적재된 3,967개 corp_code 맵을 먼저 본다.
 * 조회 창구는 그 하나뿐이다 — stocks 뷰로 종목 조회를 모은 것과 같은 원칙.
 */

// ─── ZIP 파서 (Local File Header 방식) ───────────────────────────────────────

interface ZipEntry { name: string; data: Buffer; }

/**
 * ZIP을 **중앙 디렉터리(Central Directory)** 기준으로 읽는다.
 *
 * 예전에는 로컬 파일 헤더만 훑으면서 압축크기가 0이면 건너뛰었다. 그런데 DART 원문 ZIP은
 * 스트리밍 압축(범용 플래그 bit 3 = 데이터 서술자)이라 **로컬 헤더의 크기가 항상 0**이고
 * 실제 크기는 데이터 뒤에 따로 붙는다. 그래서 파서가 모든 항목을 건너뛰고 0개를 돌려줬다.
 *
 * 중앙 디렉터리는 파일 끝에 있고 크기·오프셋이 언제나 정확히 적혀 있다.
 */
function parseZip(buf: Buffer): ZipEntry[] {
  const EOCD_SIG = 0x06054b50; // PK\x05\x06 — 중앙 디렉터리 끝 기록
  const CEN_SIG  = 0x02014b50; // PK\x01\x02 — 중앙 디렉터리 항목

  // 끝에서부터 EOCD를 찾는다(주석이 최대 64KB까지 붙을 수 있다)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return [];

  const count     = buf.readUInt16LE(eocd + 10);
  const cenOffset = buf.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  let p = cenOffset;

  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) break;

    const method   = buf.readUInt16LE(p + 10);
    const compSz   = buf.readUInt32LE(p + 20);
    const fnLen    = buf.readUInt16LE(p + 28);
    const exLen    = buf.readUInt16LE(p + 30);
    const cmLen    = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name     = buf.subarray(p + 46, p + 46 + fnLen).toString("utf8");
    p += 46 + fnLen + exLen + cmLen;

    // 로컬 헤더의 이름·부가필드 길이는 중앙 디렉터리와 다를 수 있어 그 자리에서 다시 읽는다
    if (localOff + 30 > buf.length) continue;
    const lFnLen = buf.readUInt16LE(localOff + 26);
    const lExLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + lFnLen + lExLen;
    if (compSz === 0 || dataOff + compSz > buf.length) continue;

    const compressed = buf.subarray(dataOff, dataOff + compSz);
    try {
      const data = method === 0 ? compressed : zlib.inflateRawSync(compressed);
      if (data.length > 1_000) entries.push({ name, data }); // 1KB 미만 파일 제외
    } catch { /* 손상된 항목 스킵 */ }
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
 * 실패 사유를 남기고 null을 돌려준다.
 *
 * 예전에는 이 파일의 수집 함수가 로그 없이 `return null`을 14군데에서 했다. 그래서
 * dart_biz_content가 0행인데도 **어디서 끊겼는지 알 수 없었다** — 분석마다 호출되는데
 * 한 건도 쌓이지 않았고, 그 사실조차 아무도 몰랐다.
 * 수집이 실패하는 것 자체는 괜찮다(분석을 막지 않는다). 조용히 실패하는 것이 문제다.
 */
function bail(stockCode: string, stage: string, detail?: string | number): null {
  console.warn(`[dart-biz] ${stockCode} 중단 — ${stage}${detail !== undefined ? `: ${detail}` : ""}`);
  return null;
}

/**
 * 한국 주식 종목코드를 입력받아 DART 사업보고서 "사업의 내용" 주요 섹션 텍스트를 반환.
 * 실패·타임아웃 시 null 반환 (분석 파이프라인을 블로킹하지 않음) — 다만 사유는 반드시 남긴다.
 */
export async function fetchDartBusinessContent(stockCode: string): Promise<string | null> {
  if (!isKoreanTicker(stockCode)) return bail(stockCode, "한국 종목코드 형식 아님");

  const key = process.env["DART_API_KEY"];
  if (!key) return bail(stockCode, "DART_API_KEY 없음");

  // ── corp_code 획득 ──
  const corpCode = await lookupCorpCode(stockCode);
  if (!corpCode) return bail(stockCode, "corp_code 조회 실패");

  // ── 캐시 확인 ──
  const cached = await getCached(corpCode);
  if (cached) return cached;

  try {
    // ── 1. 최신 사업보고서 rcpNo ──
    const year = new Date().getFullYear();
    const bgn  = `${year - 2}0101`;
    const end  = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    // last_reprt_at=N — 정정본만이 아니라 **원본까지** 받는다.
    //   Y로 두면 각 보고서의 최신판만 오는데, 정정공시는 원문 ZIP이 없어 받을 수 없다.
    //   한화에어로스페이스는 Y에서 `[첨부정정]사업보고서`만 보였고, N으로 바꾸니
    //   원본 `사업보고서 (2025.12)`가 함께 나왔다.
    // page_count=30 — 5로 두면 분기·반기 공시에 밀려 사업보고서가 목록에서 잘린다.
    const listRes = await fetch(
      `${DART_API}/list.json?crtfc_key=${key}&corp_code=${corpCode}` +
      `&bgn_de=${bgn}&end_de=${end}&pblntf_ty=A&last_reprt_at=N&page_count=30`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) }
    );
    if (!listRes.ok) return bail(stockCode, "공시목록 HTTP 실패", listRes.status);
    const listData = await listRes.json() as any;
    if (listData.status !== "000") return bail(stockCode, "공시목록 status", `${listData.status} ${listData.message ?? ""}`);
    if (!Array.isArray(listData.list) || !listData.list.length) return bail(stockCode, "공시목록 비어 있음");

    // 분기·반기를 뺀 사업보고서 후보를 최신순으로 모은다.
    //
    // 하나만 고르면 안 된다. 정정공시(`[첨부정정]사업보고서`·`[기재정정]사업보고서`)가
    // 목록 맨 위에 오는 경우가 있는데, 정정 건은 원문 ZIP이 없어 DART가 status 014
    // "파일이 존재하지 않습니다"를 돌려준다. 실측에서 한화에어로스페이스·KB금융이
    // 정확히 이 경우였다 — 원본 사업보고서는 멀쩡히 있는데 정정 건에 걸려 실패했다.
    const candidates = (listData.list as any[])
      .filter((r) => r.report_nm?.includes("사업보고서") &&
                     !r.report_nm?.includes("분기") &&
                     !r.report_nm?.includes("반기") &&
                     (r.rcept_no ?? r.rcp_no))
      // 정정이 아닌 원본을 먼저, 그다음 최신 접수순으로 시도한다
      .sort((a, b) =>
        Number(/정정/.test(a.report_nm)) - Number(/정정/.test(b.report_nm)) ||
        String(b.rcept_no ?? "").localeCompare(String(a.rcept_no ?? "")));

    if (!candidates.length) return bail(stockCode, "사업보고서 없음(분기·반기만 존재)",
      (listData.list as any[]).map(r => r.report_nm).join(" / "));

    // ── 2. 원문 ZIP 내려받기 ──
    //
    // ⚠️ DART 원문 API는 `document.xml`이고 파라미터는 `rcept_no`이며, **응답이 곧 ZIP**이다.
    // 예전 코드는 `document.json?rcpNo=`을 부르고 응답 JSON에서 url을 꺼내 다시 받으려 했는데,
    // 그런 규격은 없다. DART는 status 101 "잘못된 URL입니다"를 돌려줬고, 코드는 그걸
    // 조용히 삼켜 null을 반환했다 — 그래서 사업보고서가 단 한 건도 수집되지 않았다.
    let zipBuf: Buffer | null = null;
    let rcpNo = "";
    let rcpDt = "";

    for (const cand of candidates.slice(0, 3)) {
      const tryNo: string = cand.rcept_no ?? cand.rcp_no;
      const docRes = await fetch(
        `${DART_API}/document.xml?crtfc_key=${key}&rcept_no=${tryNo}`,
        { signal: AbortSignal.timeout(25_000) }
      );
      if (!docRes.ok) { bail(stockCode, "원문 다운로드 HTTP 실패", docRes.status); continue; }

      const cl = Number(docRes.headers.get("content-length") ?? "0");
      if (cl > MAX_ZIP_BYTES) { bail(stockCode, "ZIP 크기 초과(헤더)", `${(cl / 1e6).toFixed(1)}MB`); continue; }

      const buf = Buffer.from(await docRes.arrayBuffer());
      if (buf.length > MAX_ZIP_BYTES) { bail(stockCode, "ZIP 크기 초과", buf.length); continue; }

      // 오류일 때는 ZIP 대신 XML 오류 문서가 온다. ZIP 서명(PK\x03\x04)으로 가려낸다.
      if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
        bail(stockCode, `원문 없음(${cand.report_nm})`,
          buf.subarray(0, 160).toString("utf8").replace(/\s+/g, " "));
        continue;
      }

      zipBuf = buf;
      rcpNo  = tryNo;
      rcpDt  = cand.rcept_dt ?? "";
      break;
    }

    if (!zipBuf) return bail(stockCode, "후보 사업보고서에서 원문을 못 받음",
      candidates.slice(0, 3).map(c => c.report_nm).join(" / "));

    // ── 4. ZIP 파싱 → HTML 파일 추출 ──
    const entries = parseZip(zipBuf);
    // DART 원문은 .xml로 들어 있다(태그 구조는 HTML과 같아 htmlToText로 처리된다).
    // 예전 필터는 .html/.htm만 받아 전부 걸러냈다.
    const htmlFiles = entries
      .filter((e) => /\.(x|s)?html?$/i.test(e.name) || /\.xml$/i.test(e.name))
      .sort((a, b) => b.data.length - a.data.length); // 크기 내림차순 (본문이 가장 큼)

    if (!htmlFiles.length) return bail(stockCode, "ZIP 안에 본문 파일 없음",
      entries.map(e => e.name).join(",").slice(0, 150));

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

    if (!extracted) return bail(stockCode, "본문에서 사업의 내용 섹션을 못 찾음",
      `html ${htmlFiles.length}개 검사`);

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
