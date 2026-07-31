/**
 * dart-filing-store.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * DART 사업보고서 / 반기보고서 / 분기보고서 이력을 Neon DB에 구조적으로 저장합니다.
 *
 * 테이블 3개:
 *  - dart_filing_registry  : 공시 목록 메타데이터 (rcept_no = PK)
 *  - dart_filing_sections  : 섹션별 원문 텍스트
 *  - dart_filing_diffs     : AI 생성 버전 간 변화 분석 (JSONB + 요약)
 *
 * 주요 API:
 *  - ensureFilingTables()          : 테이블 생성 (서버 시작 시 1회)
 *  - syncFilingRegistry(corpCode)  : DART list API → registry 저장
 *  - fetchAndStoreFilingSections() : ZIP 다운로드 → 섹션 파싱 → sections 저장
 *  - syncAllFilings(corpCode)      : registry + sections 전체 동기화
 *  - generateFilingDiff()          : 두 공시 간 AI 변화 분석 → diffs 저장
 *  - getFilingHistory(corpCode)    : 저장된 공시 목록 조회
 *  - getFilingDiffReport(corpCode) : 모든 diff 보고서 조회
 */

import { pool } from "@workspace/db";
import { ai, geminiSemaphore } from "./analysis/gemini.js";

// ─── 환경 변수 ────────────────────────────────────────────────────────────────
const DART_BASE = "https://opendart.fss.or.kr/api";
const DART_KEY = () => process.env.DART_API_KEY ?? "";

// ─── 섹션 키 정의 ─────────────────────────────────────────────────────────────
export const SECTION_KEYS = {
  BUSINESS_CONTENT:  "business_content",   // 사업의 내용
  RISK_FACTORS:      "risk_factors",        // 위험요소
  COMPETITORS:       "competitors",         // 경쟁 현황
  BACKLOG:           "backlog",             // 수주 현황
  RND:               "rnd",                 // 연구개발 활동
  BUSINESS_OVERVIEW: "business_overview",   // 사업의 개요
} as const;

export type SectionKey = typeof SECTION_KEYS[keyof typeof SECTION_KEYS];

// ─── 타입 정의 ────────────────────────────────────────────────────────────────
export interface FilingMeta {
  id: number;
  corpCode: string;
  stockCode: string | null;
  companyName: string | null;
  rceptNo: string;
  reportType: string;     // '사업보고서' | '반기보고서' | '1분기보고서' | '3분기보고서'
  fiscalYear: number;
  periodCode: string;     // 'FY' | 'H1' | 'Q1' | 'Q3'
  filedAt: string | null;
  hasSections: boolean;
}

export interface FilingSection {
  rceptNo: string;
  sectionKey: string;
  sectionTitle: string | null;
  content: string;
  charCount: number;
  fetchedAt: string;
}

export interface FilingDiff {
  fromRceptNo: string;
  toRceptNo: string;
  sectionKey: string;
  changesJson: {
    added: string[];
    removed: string[];
    modified: string[];
  } | null;
  aiSummary: string | null;
  createdAt: string;
}

// ─── 테이블 생성 ──────────────────────────────────────────────────────────────
export async function ensureFilingTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dart_filing_registry (
      id           SERIAL PRIMARY KEY,
      corp_code    VARCHAR(8)   NOT NULL,
      stock_code   VARCHAR(10),
      company_name VARCHAR(100),
      rcept_no     VARCHAR(14)  NOT NULL,
      report_type  VARCHAR(30)  NOT NULL,
      fiscal_year  SMALLINT     NOT NULL,
      period_code  VARCHAR(5)   NOT NULL,
      filed_at     DATE,
      created_at   TIMESTAMPTZ  DEFAULT now(),
      UNIQUE(rcept_no)
    );

    CREATE INDEX IF NOT EXISTS idx_dart_filing_registry_corp
      ON dart_filing_registry(corp_code, fiscal_year DESC, period_code);

    CREATE TABLE IF NOT EXISTS dart_filing_sections (
      id            SERIAL PRIMARY KEY,
      corp_code     VARCHAR(8)   NOT NULL,
      rcept_no      VARCHAR(14)  NOT NULL,
      section_key   VARCHAR(50)  NOT NULL,
      section_title VARCHAR(200),
      content       TEXT         NOT NULL,
      char_count    INT,
      fetched_at    TIMESTAMPTZ  DEFAULT now(),
      UNIQUE(rcept_no, section_key)
    );

    CREATE INDEX IF NOT EXISTS idx_dart_filing_sections_corp
      ON dart_filing_sections(corp_code, section_key, rcept_no);

    CREATE TABLE IF NOT EXISTS dart_filing_diffs (
      id             SERIAL PRIMARY KEY,
      corp_code      VARCHAR(8)   NOT NULL,
      from_rcept_no  VARCHAR(14)  NOT NULL,
      to_rcept_no    VARCHAR(14)  NOT NULL,
      section_key    VARCHAR(50)  NOT NULL,
      changes_json   JSONB,
      ai_summary     TEXT,
      created_at     TIMESTAMPTZ  DEFAULT now(),
      UNIQUE(from_rcept_no, to_rcept_no, section_key)
    );

    CREATE INDEX IF NOT EXISTS idx_dart_filing_diffs_corp
      ON dart_filing_diffs(corp_code, section_key);
  `);
}

// ─── 기간 코드 파싱 ───────────────────────────────────────────────────────────
function parsePeriodCode(reportType: string): string {
  if (reportType.includes("1분기")) return "Q1";
  if (reportType.includes("반기"))  return "H1";
  if (reportType.includes("3분기")) return "Q3";
  return "FY";
}

/**
 * DART 접수일(YYYYMMDD) + 보고서 유형으로 회계연도 추정
 * - 사업보고서는 보통 3~4월에 제출 → 전년도 실적
 * - 분기/반기는 당해년도
 */
function parseFiscalYear(rceptDt: string, reportType: string): number {
  const year = parseInt(rceptDt.slice(0, 4), 10);
  const month = parseInt(rceptDt.slice(4, 6), 10);
  if (reportType.includes("사업보고서") && month <= 5) return year - 1;
  return year;
}

// ─── DART 공시 목록 조회 → registry 저장 ─────────────────────────────────────
/**
 * DART list API로 해당 법인의 정기공시 목록을 가져와 dart_filing_registry에 저장합니다.
 * pblntf_ty=A (정기공시) — 사업/반기/분기보고서 모두 포함
 */
export async function syncFilingRegistry(
  corpCode: string,
  stockCode?: string,
  pageCount = 40,
): Promise<FilingMeta[]> {
  const key = DART_KEY();
  if (!key) throw new Error("DART_API_KEY 없음");

  const url =
    `${DART_BASE}/list.json?crtfc_key=${key}` +
    `&corp_code=${corpCode}&pblntf_ty=A&page_no=1&page_count=${pageCount}`;

  const res  = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`DART list API HTTP ${res.status}`);

  const data = (await res.json()) as any;
  if (data.status !== "000" || !Array.isArray(data.list)) {
    console.warn(`[dart-filing] list API status=${data.status}, corp=${corpCode}`);
    return [];
  }

  await ensureFilingTables();

  const saved: FilingMeta[] = [];

  for (const item of data.list as any[]) {
    const reportType: string = item.report_nm ?? "";
    // 정기공시만 (사업보고서, 반기보고서, 분기보고서)
    if (
      !reportType.includes("사업보고서") &&
      !reportType.includes("반기보고서") &&
      !reportType.includes("분기보고서")
    ) continue;

    const rceptNo   = String(item.rcept_no ?? "");
    const rceptDt   = String(item.rcept_dt ?? "");
    const periodCode = parsePeriodCode(reportType);
    const fiscalYear = parseFiscalYear(rceptDt, reportType);
    const companyName = item.corp_name ?? null;
    const sc = stockCode ?? item.stock_code ?? null;

    try {
      await pool.query(
        `INSERT INTO dart_filing_registry
           (corp_code, stock_code, company_name, rcept_no, report_type, fiscal_year, period_code, filed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (rcept_no) DO UPDATE SET
           company_name = EXCLUDED.company_name,
           stock_code   = COALESCE(EXCLUDED.stock_code, dart_filing_registry.stock_code)`,
        [
          corpCode,
          sc,
          companyName,
          rceptNo,
          reportType,
          fiscalYear,
          periodCode,
          rceptDt ? `${rceptDt.slice(0,4)}-${rceptDt.slice(4,6)}-${rceptDt.slice(6,8)}` : null,
        ],
      );
      saved.push({
        id: 0, corpCode, stockCode: sc, companyName,
        rceptNo, reportType, fiscalYear, periodCode,
        filedAt: rceptDt || null, hasSections: false,
      });
    } catch (err: any) {
      console.error(`[dart-filing] registry insert error rcept_no=${rceptNo}:`, err.message);
    }
  }

  console.log(`[dart-filing] registry sync: corp=${corpCode}, ${saved.length}건 저장`);
  return saved;
}

// ─── ZIP 파싱 (dart-business-content.ts에서 동일 로직 독립 복제) ──────────────
interface ZipEntry { name: string; data: Buffer }

function parseZip(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const sig = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === sig) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) return entries;

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdCount  = buf.readUInt16LE(eocdOffset + 10);
  let pos = cdOffset;

  for (let i = 0; i < cdCount; i++) {
    if (pos + 46 > buf.length) break;
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const compressedSize   = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const fileNameLen      = buf.readUInt16LE(pos + 28);
    const extraLen         = buf.readUInt16LE(pos + 30);
    const commentLen       = buf.readUInt16LE(pos + 32);
    const localOffset      = buf.readUInt32LE(pos + 42);
    const fileName = buf.subarray(pos + 46, pos + 46 + fileNameLen).toString("utf8");
    pos += 46 + fileNameLen + extraLen + commentLen;

    const lhPos = localOffset;
    if (lhPos + 30 > buf.length) continue;
    const lhExtraLen = buf.readUInt16LE(lhPos + 28);
    const lhFileLen  = buf.readUInt16LE(lhPos + 26);
    const dataStart  = lhPos + 30 + lhFileLen + lhExtraLen;
    const dataEnd    = dataStart + compressedSize;
    if (dataEnd > buf.length) continue;

    let data: Buffer;
    const method = buf.readUInt16LE(lhPos + 8);
    if (method === 0) {
      data = buf.subarray(dataStart, dataEnd);
    } else {
      try {
        const zlib = require("zlib");
        data = zlib.inflateRawSync(buf.subarray(dataStart, dataEnd));
      } catch {
        continue;
      }
    }
    entries.push({ name: fileName, data });
  }
  return entries;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

// 섹션 마커 정의
const SECTION_MARKERS: Record<SectionKey, string[]> = {
  business_content:  ["사업의 내용", "사업내용", "2. 사업의 내용", "Ⅱ. 사업의 내용"],
  risk_factors:      ["위험요소", "위험 요소", "투자 위험", "2. 위험요소"],
  competitors:       ["경쟁현황", "경쟁 현황", "경쟁상황", "경쟁사 현황"],
  backlog:           ["수주현황", "수주 현황", "수주잔고", "매출현황"],
  rnd:               ["연구개발", "연구 개발", "R&D", "연구개발활동"],
  business_overview: ["사업의 개요", "사업 개요", "1. 사업의 개요", "Ⅰ. 사업의 개요"],
};

function extractSection(text: string, markers: string[], maxChars = 8_000): string | null {
  const lower = text.toLowerCase();
  for (const marker of markers) {
    const idx = lower.indexOf(marker.toLowerCase());
    if (idx < 0) continue;
    const snippet = text.slice(idx, idx + maxChars);
    return snippet.trim();
  }
  return null;
}

// ─── 공시 문서 다운로드 → 섹션 파싱 → DB 저장 ───────────────────────────────
export async function fetchAndStoreFilingSections(
  rceptNo: string,
  corpCode: string,
  sections: SectionKey[] = ["business_content", "risk_factors", "competitors", "backlog", "rnd"],
): Promise<Record<SectionKey, string | null>> {
  const key = DART_KEY();
  if (!key) throw new Error("DART_API_KEY 없음");

  await ensureFilingTables();

  // 이미 모두 저장돼 있으면 스킵
  const existingR = await pool.query<{ section_key: string }>(
    `SELECT section_key FROM dart_filing_sections WHERE rcept_no = $1`,
    [rceptNo],
  );
  const existingKeys = new Set(existingR.rows.map(r => r.section_key));
  const needed = sections.filter(s => !existingKeys.has(s));
  if (needed.length === 0) {
    console.log(`[dart-filing] ${rceptNo} 섹션 이미 저장됨 — 스킵`);
    return {} as any;
  }

  // ZIP 다운로드
  const url = `${DART_BASE}/document.xml?crtfc_key=${key}&rcept_no=${rceptNo}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`DART document HTTP ${res.status} for rcept_no=${rceptNo}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error(`ZIP 크기 이상: ${buf.length}bytes`);

  const zipEntries = parseZip(buf);
  const htmlEntries = zipEntries.filter(e =>
    /\.(html?|xhtml|xml)$/i.test(e.name) && !e.name.includes("__MACOSX")
  );

  if (htmlEntries.length === 0) {
    console.warn(`[dart-filing] ${rceptNo} HTML 엔트리 없음`);
    return {} as any;
  }

  // 모든 HTML 텍스트 합치기 (가장 큰 파일 우선)
  const sorted = [...htmlEntries].sort((a, b) => b.data.length - a.data.length);
  const fullText = sorted
    .slice(0, 3)
    .map(e => stripHtml(e.data.toString("utf8")))
    .join("\n\n===\n\n");

  const result: Record<string, string | null> = {};

  for (const sectionKey of needed) {
    const markers = SECTION_MARKERS[sectionKey as SectionKey];
    const content = extractSection(fullText, markers);
    result[sectionKey] = content;

    if (!content) {
      console.log(`[dart-filing] ${rceptNo} 섹션 '${sectionKey}' 없음`);
      continue;
    }

    await pool.query(
      `INSERT INTO dart_filing_sections
         (corp_code, rcept_no, section_key, section_title, content, char_count)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (rcept_no, section_key) DO UPDATE SET
         content     = EXCLUDED.content,
         char_count  = EXCLUDED.char_count,
         fetched_at  = now()`,
      [corpCode, rceptNo, sectionKey, null, content, content.length],
    );
    console.log(`[dart-filing] ${rceptNo} 섹션 '${sectionKey}' ${content.length}자 저장`);
  }

  return result as any;
}

// ─── 전체 동기화 ──────────────────────────────────────────────────────────────
/**
 * 특정 법인의 모든 정기공시를 registry에 등록하고,
 * 아직 섹션이 저장되지 않은 공시에 대해 순서대로 다운로드합니다.
 * @param maxFilings 최대 처리할 공시 수 (비용/시간 제한)
 */
export async function syncAllFilings(
  corpCode: string,
  stockCode?: string,
  maxFilings = 20,
  sections: SectionKey[] = ["business_content", "risk_factors", "competitors"],
): Promise<{ synced: number; skipped: number; errors: number }> {
  console.log(`[dart-filing] 전체 동기화 시작: corp=${corpCode}`);
  const metas = await syncFilingRegistry(corpCode, stockCode);

  // 최신순 정렬 → maxFilings 제한
  const toProcess = metas
    .sort((a, b) => b.fiscalYear - a.fiscalYear || b.rceptNo.localeCompare(a.rceptNo))
    .slice(0, maxFilings);

  let synced = 0, skipped = 0, errors = 0;

  for (const meta of toProcess) {
    // 이미 섹션 있으면 스킵
    const r = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM dart_filing_sections WHERE rcept_no = $1`,
      [meta.rceptNo],
    );
    if (parseInt(r.rows[0]?.cnt ?? "0") >= sections.length) {
      skipped++;
      continue;
    }
    try {
      await fetchAndStoreFilingSections(meta.rceptNo, corpCode, sections);
      synced++;
      // API rate limit 배려
      await new Promise(r => setTimeout(r, 800));
    } catch (err: any) {
      console.error(`[dart-filing] 섹션 저장 실패 ${meta.rceptNo}:`, err.message);
      errors++;
    }
  }

  console.log(`[dart-filing] 완료 — synced:${synced}, skipped:${skipped}, errors:${errors}`);
  return { synced, skipped, errors };
}

// ─── 이력 조회 ────────────────────────────────────────────────────────────────
export async function getFilingHistory(corpCode: string): Promise<FilingMeta[]> {
  await ensureFilingTables();
  const r = await pool.query<any>(
    `SELECT
       r.id, r.corp_code, r.stock_code, r.company_name,
       r.rcept_no, r.report_type, r.fiscal_year, r.period_code,
       TO_CHAR(r.filed_at, 'YYYY-MM-DD') AS filed_at,
       COUNT(s.id)::int > 0 AS has_sections
     FROM dart_filing_registry r
     LEFT JOIN dart_filing_sections s ON s.rcept_no = r.rcept_no
     WHERE r.corp_code = $1
     GROUP BY r.id
     ORDER BY r.fiscal_year DESC, r.rcept_no DESC`,
    [corpCode],
  );
  return r.rows.map(row => ({
    id:          row.id,
    corpCode:    row.corp_code,
    stockCode:   row.stock_code,
    companyName: row.company_name,
    rceptNo:     row.rcept_no,
    reportType:  row.report_type,
    fiscalYear:  row.fiscal_year,
    periodCode:  row.period_code,
    filedAt:     row.filed_at,
    hasSections: row.has_sections,
  }));
}

export async function getFilingSection(rceptNo: string, sectionKey: SectionKey): Promise<FilingSection | null> {
  const r = await pool.query<any>(
    `SELECT rcept_no, section_key, section_title, content, char_count, fetched_at
     FROM dart_filing_sections WHERE rcept_no = $1 AND section_key = $2`,
    [rceptNo, sectionKey],
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    rceptNo:      row.rcept_no,
    sectionKey:   row.section_key,
    sectionTitle: row.section_title,
    content:      row.content,
    charCount:    row.char_count,
    fetchedAt:    row.fetched_at,
  };
}

// ─── AI diff 생성 ──────────────────────────────────────────────────────────────
const SECTION_LABELS: Record<string, string> = {
  business_content:  "사업의 내용",
  risk_factors:      "위험요소",
  competitors:       "경쟁 현황",
  backlog:           "수주 현황",
  rnd:               "연구개발 활동",
  business_overview: "사업의 개요",
};

/**
 * 두 공시의 특정 섹션을 AI로 비교하여 변화 분석을 dart_filing_diffs에 저장합니다.
 * - changes_json: { added: string[], removed: string[], modified: string[] }
 * - ai_summary: 사람이 읽기 좋은 변화 요약
 */
export async function generateFilingDiff(
  corpCode: string,
  fromRceptNo: string,
  toRceptNo: string,
  sectionKey: SectionKey = "business_content",
): Promise<FilingDiff | null> {
  await ensureFilingTables();

  // 캐시 확인
  const cached = await pool.query<any>(
    `SELECT from_rcept_no, to_rcept_no, section_key, changes_json, ai_summary, created_at
     FROM dart_filing_diffs WHERE from_rcept_no=$1 AND to_rcept_no=$2 AND section_key=$3`,
    [fromRceptNo, toRceptNo, sectionKey],
  );
  if (cached.rows[0]) {
    const r = cached.rows[0];
    return {
      fromRceptNo: r.from_rcept_no,
      toRceptNo:   r.to_rcept_no,
      sectionKey:  r.section_key,
      changesJson: r.changes_json,
      aiSummary:   r.ai_summary,
      createdAt:   r.created_at,
    };
  }

  const [from, to] = await Promise.all([
    getFilingSection(fromRceptNo, sectionKey),
    getFilingSection(toRceptNo, sectionKey),
  ]);

  if (!from || !to) {
    console.warn(`[dart-filing-diff] 섹션 없음: from=${fromRceptNo}, to=${toRceptNo}, key=${sectionKey}`);
    return null;
  }

  const label = SECTION_LABELS[sectionKey] ?? sectionKey;

  const prompt = `다음은 동일 기업의 서로 다른 시점 사업보고서에서 추출한 "${label}" 섹션입니다.
두 버전을 꼼꼼히 비교하여 변화를 분석해 주세요.

[이전 보고서]
${from.content.slice(0, 4000)}

[최신 보고서]
${to.content.slice(0, 4000)}

다음 JSON 형식으로만 응답하세요 (설명·서문 없이):
{
  "added": ["새로 추가된 사업·제품·시장·전략·리스크 (항목당 한 문장, 최대 5개)"],
  "removed": ["사라진 사업·제품·시장·전략·리스크 (항목당 한 문장, 최대 5개)"],
  "modified": ["크게 강조/비중이 달라진 항목 (항목당 한 문장, 최대 5개)"],
  "summary": "전체 변화의 핵심을 2~3문장으로 요약. 이 기업이 어떤 방향으로 전략을 바꾸고 있는지 서술."
}`;

  let aiResult: any = null;

  await geminiSemaphore.acquire();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 1_200 },
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const cleaned = raw.replace(/```json\n?|```/g, "").trim();
    aiResult = JSON.parse(cleaned);
  } catch (err: any) {
    console.error(`[dart-filing-diff] AI 오류:`, err.message);
    return null;
  } finally {
    geminiSemaphore.release();
  }

  const changesJson = {
    added:    Array.isArray(aiResult.added)    ? aiResult.added    : [],
    removed:  Array.isArray(aiResult.removed)  ? aiResult.removed  : [],
    modified: Array.isArray(aiResult.modified) ? aiResult.modified : [],
  };
  const aiSummary: string = aiResult.summary ?? null;

  await pool.query(
    `INSERT INTO dart_filing_diffs
       (corp_code, from_rcept_no, to_rcept_no, section_key, changes_json, ai_summary)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (from_rcept_no, to_rcept_no, section_key) DO UPDATE SET
       changes_json = EXCLUDED.changes_json,
       ai_summary   = EXCLUDED.ai_summary,
       created_at   = now()`,
    [corpCode, fromRceptNo, toRceptNo, sectionKey, JSON.stringify(changesJson), aiSummary],
  );

  return {
    fromRceptNo, toRceptNo, sectionKey,
    changesJson, aiSummary,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 저장된 공시 이력을 시간순으로 나열하고 연속된 두 공시 간의 diff를 모두 생성합니다.
 * 분석에 오래 걸릴 수 있으므로 백그라운드 실행을 권장합니다.
 */
export async function generateAllDiffs(
  corpCode: string,
  sectionKey: SectionKey = "business_content",
): Promise<FilingDiff[]> {
  const history = await getFilingHistory(corpCode);
  const withSections = history.filter(h => h.hasSections).reverse(); // 오래된 것부터

  const diffs: FilingDiff[] = [];
  for (let i = 0; i < withSections.length - 1; i++) {
    const from = withSections[i];
    const to   = withSections[i + 1];
    try {
      const diff = await generateFilingDiff(corpCode, from.rceptNo, to.rceptNo, sectionKey);
      if (diff) diffs.push(diff);
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      console.error(`[dart-filing-diff] 생성 실패 ${from.rceptNo}→${to.rceptNo}:`, err.message);
    }
  }
  return diffs;
}

export async function getFilingDiffs(
  corpCode: string,
  sectionKey?: SectionKey,
): Promise<FilingDiff[]> {
  await ensureFilingTables();
  const r = await pool.query<any>(
    `SELECT d.from_rcept_no, d.to_rcept_no, d.section_key,
            d.changes_json, d.ai_summary, d.created_at,
            f1.fiscal_year AS from_year, f1.period_code AS from_period,
            f2.fiscal_year AS to_year,   f2.period_code AS to_period
     FROM dart_filing_diffs d
     JOIN dart_filing_registry f1 ON f1.rcept_no = d.from_rcept_no
     JOIN dart_filing_registry f2 ON f2.rcept_no = d.to_rcept_no
     WHERE d.corp_code = $1
       ${sectionKey ? "AND d.section_key = $2" : ""}
     ORDER BY f1.fiscal_year ASC, f1.rcept_no ASC`,
    sectionKey ? [corpCode, sectionKey] : [corpCode],
  );
  return r.rows.map(row => ({
    fromRceptNo: row.from_rcept_no,
    toRceptNo:   row.to_rcept_no,
    sectionKey:  row.section_key,
    changesJson: row.changes_json,
    aiSummary:   row.ai_summary,
    createdAt:   row.created_at,
  }));
}
