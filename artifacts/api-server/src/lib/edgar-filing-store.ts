/**
 * edgar-filing-store.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SEC EDGAR 10-K / 20-F (연간) + 10-Q (분기) 이력을 Neon DB에 구조적으로 저장합니다.
 * dart-filing-store.ts와 동일한 3-테이블 구조를 사용합니다.
 *
 * 테이블 3개:
 *  - edgar_filing_registry : 공시 목록 메타데이터 (accession_no = PK)
 *  - edgar_filing_sections : 섹션별 원문 (Item 1/1A/7)
 *  - edgar_filing_diffs    : AI 생성 버전 간 변화 분석 (JSONB + 요약)
 *
 * 주요 API:
 *  - ensureEdgarTables()           : 테이블 생성 (서버 시작 시 1회)
 *  - syncEdgarRegistry(ticker)     : submissions API → registry 저장
 *  - fetchAndStoreEdgarSections()  : HTML 다운로드 → 섹션 파싱 → sections 저장
 *  - syncAllEdgarFilings(ticker)   : registry + sections 전체 동기화
 *  - generateEdgarDiff()           : 두 공시 간 AI 변화 분석 → diffs 저장
 *  - getEdgarFilingHistory(ticker) : 저장된 공시 목록 조회
 */

import { pool } from "@workspace/db";
import { ai, geminiSemaphore } from "./analysis/gemini.js";

const SEC_BASE   = "https://www.sec.gov";
const SEC_DATA   = "https://data.sec.gov";
const UA         = "AiBITDA Research ai@aibotda.com";
const FETCH_TIMEOUT = 20_000;
const MAX_HTML   = 15 * 1024 * 1024;

// ─── CIK 맵 (인메모리 24h 캐시, sec-edgar-content.ts와 독립 관리) ─────────────
let _cikMap: Map<string, number> | null = null;
let _cikFetchedAt = 0;

async function getCikMap(): Promise<Map<string, number>> {
  if (_cikMap && Date.now() - _cikFetchedAt < 24 * 3_600_000) return _cikMap;
  const res = await fetch(`${SEC_BASE}/files/company_tickers.json`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`company_tickers ${res.status}`);
  const raw = await res.json() as Record<string, { cik_str: number; ticker: string }>;
  const map = new Map<string, number>();
  for (const e of Object.values(raw)) map.set(e.ticker.toUpperCase(), e.cik_str);
  _cikMap = map;
  _cikFetchedAt = Date.now();
  return map;
}

// ─── 섹션 키 ─────────────────────────────────────────────────────────────────
export const EDGAR_SECTION_KEYS = {
  BUSINESS:     "business",      // Item 1. Business
  RISK_FACTORS: "risk_factors",  // Item 1A. Risk Factors
  MDA:          "mda",           // Item 7. MD&A
} as const;

export type EdgarSectionKey = typeof EDGAR_SECTION_KEYS[keyof typeof EDGAR_SECTION_KEYS];

export interface EdgarFilingMeta {
  id: number;
  ticker: string;
  cik: number;
  accessionNo: string;    // "0000000000-24-000001" 형식
  formType: string;       // "10-K" | "10-Q" | "20-F"
  fiscalYear: number;
  periodCode: string;     // "FY" | "Q1" | "Q2" | "Q3"
  filedAt: string | null;
  hasSections: boolean;
}

export interface EdgarFilingDiff {
  fromAccessionNo: string;
  toAccessionNo: string;
  sectionKey: string;
  changesJson: { added: string[]; removed: string[]; modified: string[] } | null;
  aiSummary: string | null;
  createdAt: string;
}

// ─── 테이블 생성 ──────────────────────────────────────────────────────────────
let _tablesReady = false;

export async function ensureEdgarTables(): Promise<void> {
  if (_tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS edgar_filing_registry (
      id            SERIAL PRIMARY KEY,
      ticker        VARCHAR(20)  NOT NULL,
      cik           INT          NOT NULL,
      accession_no  VARCHAR(25)  NOT NULL,
      form_type     VARCHAR(10)  NOT NULL,
      fiscal_year   SMALLINT     NOT NULL,
      period_code   VARCHAR(5)   NOT NULL,
      filed_at      DATE,
      created_at    TIMESTAMPTZ  DEFAULT now(),
      UNIQUE(accession_no)
    );

    CREATE INDEX IF NOT EXISTS idx_edgar_filing_registry_ticker
      ON edgar_filing_registry(ticker, fiscal_year DESC, period_code);

    CREATE TABLE IF NOT EXISTS edgar_filing_sections (
      id            SERIAL PRIMARY KEY,
      ticker        VARCHAR(20)  NOT NULL,
      accession_no  VARCHAR(25)  NOT NULL,
      section_key   VARCHAR(30)  NOT NULL,
      content       TEXT         NOT NULL,
      char_count    INT,
      fetched_at    TIMESTAMPTZ  DEFAULT now(),
      UNIQUE(accession_no, section_key)
    );

    CREATE INDEX IF NOT EXISTS idx_edgar_filing_sections_ticker
      ON edgar_filing_sections(ticker, section_key, accession_no);

    CREATE TABLE IF NOT EXISTS edgar_filing_diffs (
      id               SERIAL PRIMARY KEY,
      ticker           VARCHAR(20)  NOT NULL,
      from_accession   VARCHAR(25)  NOT NULL,
      to_accession     VARCHAR(25)  NOT NULL,
      section_key      VARCHAR(30)  NOT NULL,
      changes_json     JSONB,
      ai_summary       TEXT,
      created_at       TIMESTAMPTZ  DEFAULT now(),
      UNIQUE(from_accession, to_accession, section_key)
    );

    CREATE INDEX IF NOT EXISTS idx_edgar_filing_diffs_ticker
      ON edgar_filing_diffs(ticker, section_key);
  `);
  _tablesReady = true;
}

// ─── 기간 코드 파싱 ───────────────────────────────────────────────────────────
function parsePeriodCode(formType: string, filingDate: string): string {
  if (formType === "10-K" || formType === "20-F") return "FY";
  // 10-Q: 분기 추정 (미국 회계연도는 보통 1월 또는 7월 시작이지만, 단순화)
  const month = parseInt(filingDate.slice(5, 7), 10);
  if (month <= 5) return "Q1";
  if (month <= 8) return "Q2";
  return "Q3";
}

function parseFiscalYear(formType: string, filingDate: string): number {
  const year  = parseInt(filingDate.slice(0, 4), 10);
  const month = parseInt(filingDate.slice(5, 7), 10);
  // 10-K 는 보통 1~4월 제출 → 전년도 실적
  if ((formType === "10-K" || formType === "20-F") && month <= 5) return year - 1;
  return year;
}

// ─── submissions API → registry ──────────────────────────────────────────────
export async function syncEdgarRegistry(
  ticker: string,
  maxFilings = 20,
): Promise<EdgarFilingMeta[]> {
  const bare = ticker.replace(/\.(US|NYSE|NASDAQ)$/i, "").toUpperCase();
  const cikMap = await getCikMap();
  const cik = cikMap.get(bare);
  if (!cik) {
    console.warn(`[edgar-filing] CIK 없음: ${bare}`);
    return [];
  }

  const paddedCik = String(cik).padStart(10, "0");
  const url = `${SEC_DATA}/submissions/CIK${paddedCik}.json`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) throw new Error(`submissions API ${res.status}`);

  const data  = await res.json() as any;
  const recent = data.filings?.recent ?? {};
  const forms:   string[] = recent.form ?? [];
  const accNums: string[] = recent.accessionNumber ?? [];
  const dates:   string[] = recent.filingDate ?? [];

  await ensureEdgarTables();

  const saved: EdgarFilingMeta[] = [];
  let count = 0;

  for (let i = 0; i < forms.length && count < maxFilings; i++) {
    const form = forms[i];
    if (form !== "10-K" && form !== "10-Q" && form !== "20-F") continue;

    const accNo     = accNums[i];
    const filedDate = dates[i];
    const periodCode = parsePeriodCode(form, filedDate);
    const fiscalYear = parseFiscalYear(form, filedDate);

    try {
      await pool.query(
        `INSERT INTO edgar_filing_registry
           (ticker, cik, accession_no, form_type, fiscal_year, period_code, filed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (accession_no) DO NOTHING`,
        [bare, cik, accNo, form, fiscalYear, periodCode, filedDate || null],
      );
      saved.push({
        id: 0, ticker: bare, cik, accessionNo: accNo,
        formType: form, fiscalYear, periodCode,
        filedAt: filedDate || null, hasSections: false,
      });
      count++;
    } catch (err: any) {
      console.error(`[edgar-filing] insert error ${accNo}:`, err.message);
    }
  }

  console.log(`[edgar-filing] registry sync: ${bare}, ${saved.length}건`);
  return saved;
}

// ─── HTML 다운로드 → 섹션 추출 ────────────────────────────────────────────────
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6]|section|article)>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#\d+;|&#x[\da-f]+;/gi, "")
    .replace(/[ \t]{4,}/g, "  ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
}

type EdgarSectionDef = { start: RegExp[]; end: RegExp[]; maxChars: number };

const EDGAR_SECTIONS: Record<EdgarSectionKey, EdgarSectionDef> = {
  business: {
    start: [
      /ITEM\s+1\.?\s+BUSINESS\s*[\n\r]/i,
      /ITEM\s+1\b[.\s]*\n\s*BUSINESS\b/i,
    ],
    end: [
      /ITEM\s+1A\.?\s+RISK/i,
      /ITEM\s+2\.?\s+PROP/i,
    ],
    maxChars: 6_000,
  },
  risk_factors: {
    start: [
      /ITEM\s+1A\.?\s+RISK\s+FACTOR/i,
      /ITEM\s+1A\b[.\s]*\n\s*RISK/i,
    ],
    end: [
      /ITEM\s+1B\.?\s+/i,
      /ITEM\s+2\.?\s+/i,
    ],
    maxChars: 5_000,
  },
  mda: {
    start: [
      /ITEM\s+7\.?\s+MANAGEMENT.{0,30}DISCUSSION/i,
      /ITEM\s+7\b[.\s]*\n\s*MANAGEMENT/i,
    ],
    end: [
      /ITEM\s+7A\.?\s+/i,
      /ITEM\s+8\.?\s+/i,
    ],
    maxChars: 6_000,
  },
};

function extractEdgarSection(text: string, def: EdgarSectionDef): string | null {
  let startIdx = -1;
  for (const pat of def.start) {
    const m = pat.exec(text);
    if (m && m.index > startIdx) startIdx = m.index;
  }
  if (startIdx < 0) return null;

  let endIdx = startIdx + def.maxChars;
  for (const pat of def.end) {
    const m = pat.exec(text.slice(startIdx + 50));
    if (m) {
      const candidate = startIdx + 50 + m.index;
      if (candidate < endIdx) endIdx = candidate;
    }
  }

  return text.slice(startIdx, Math.min(endIdx, startIdx + def.maxChars)).trim();
}

async function findPrimaryDocUrl(cik: number, accession: string): Promise<string | null> {
  const accNoDash = accession.replace(/-/g, "");
  const indexUrl  = `${SEC_BASE}/Archives/edgar/data/${cik}/${accNoDash}/${accession}-index.htm`;
  const res = await fetch(indexUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const matches = [...html.matchAll(/href="([^"]+\.htm(?:l)?)"[^>]*>/gi)];
  for (const m of matches) {
    const href = m[1];
    if (href.includes("-index") || /R\d+\.htm/.test(href)) continue;
    return href.startsWith("http")
      ? href
      : `${SEC_BASE}${href.startsWith("/") ? href : `/Archives/edgar/data/${cik}/${accNoDash}/${href}`}`;
  }
  return null;
}

// ─── 섹션 다운로드 + 저장 ────────────────────────────────────────────────────
export async function fetchAndStoreEdgarSections(
  ticker: string,
  accessionNo: string,
  cik: number,
  sections: EdgarSectionKey[] = ["business", "risk_factors", "mda"],
): Promise<Record<EdgarSectionKey, string | null>> {
  await ensureEdgarTables();

  // 이미 저장된 섹션 확인
  const existingR = await pool.query<{ section_key: string }>(
    `SELECT section_key FROM edgar_filing_sections WHERE accession_no = $1`,
    [accessionNo],
  );
  const existingKeys = new Set(existingR.rows.map(r => r.section_key));
  const needed = sections.filter(s => !existingKeys.has(s));
  if (needed.length === 0) return {} as any;

  // HTML 다운로드
  const docUrl = await findPrimaryDocUrl(cik, accessionNo);
  if (!docUrl) {
    console.warn(`[edgar-filing] 문서 URL 없음: ${accessionNo}`);
    return {} as any;
  }

  const res = await fetch(docUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.warn(`[edgar-filing] HTML HTTP ${res.status}: ${docUrl}`);
    return {} as any;
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_HTML) {
    console.warn(`[edgar-filing] HTML 너무 큼 (${buf.byteLength}): ${accessionNo}`);
    return {} as any;
  }

  const text = htmlToText(Buffer.from(buf).toString("utf8"));
  const result: Record<string, string | null> = {};

  for (const sectionKey of needed) {
    const def     = EDGAR_SECTIONS[sectionKey as EdgarSectionKey];
    const content = extractEdgarSection(text, def);
    result[sectionKey] = content;

    if (!content) {
      console.log(`[edgar-filing] ${accessionNo} 섹션 '${sectionKey}' 없음`);
      continue;
    }

    await pool.query(
      `INSERT INTO edgar_filing_sections
         (ticker, accession_no, section_key, content, char_count)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (accession_no, section_key) DO UPDATE SET
         content    = EXCLUDED.content,
         char_count = EXCLUDED.char_count,
         fetched_at = now()`,
      [ticker.toUpperCase(), accessionNo, sectionKey, content, content.length],
    );
    console.log(`[edgar-filing] ${accessionNo} '${sectionKey}' ${content.length}자 저장`);
  }

  return result as any;
}

// ─── 전체 동기화 ──────────────────────────────────────────────────────────────
export async function syncAllEdgarFilings(
  ticker: string,
  maxFilings = 15,
  sections: EdgarSectionKey[] = ["business", "risk_factors", "mda"],
): Promise<{ synced: number; skipped: number; errors: number }> {
  const metas = await syncEdgarRegistry(ticker, maxFilings);
  let synced = 0, skipped = 0, errors = 0;

  for (const meta of metas) {
    const r = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM edgar_filing_sections WHERE accession_no = $1`,
      [meta.accessionNo],
    );
    if (parseInt(r.rows[0]?.cnt ?? "0") >= sections.length) { skipped++; continue; }

    try {
      await fetchAndStoreEdgarSections(ticker, meta.accessionNo, meta.cik, sections);
      synced++;
      await new Promise(r => setTimeout(r, 600)); // rate limit
    } catch (err: any) {
      console.error(`[edgar-filing] ${meta.accessionNo} 실패:`, err.message);
      errors++;
    }
  }

  return { synced, skipped, errors };
}

// ─── 이력 조회 ────────────────────────────────────────────────────────────────
export async function getEdgarFilingHistory(ticker: string): Promise<EdgarFilingMeta[]> {
  await ensureEdgarTables();
  const bare = ticker.replace(/\.(US|NYSE|NASDAQ)$/i, "").toUpperCase();
  const r = await pool.query<any>(
    `SELECT r.id, r.ticker, r.cik, r.accession_no, r.form_type,
            r.fiscal_year, r.period_code,
            TO_CHAR(r.filed_at, 'YYYY-MM-DD') AS filed_at,
            COUNT(s.id)::int > 0 AS has_sections
     FROM edgar_filing_registry r
     LEFT JOIN edgar_filing_sections s ON s.accession_no = r.accession_no
     WHERE r.ticker = $1
     GROUP BY r.id
     ORDER BY r.fiscal_year DESC, r.accession_no DESC`,
    [bare],
  );
  return r.rows.map(row => ({
    id: row.id, ticker: row.ticker, cik: row.cik,
    accessionNo: row.accession_no, formType: row.form_type,
    fiscalYear: row.fiscal_year, periodCode: row.period_code,
    filedAt: row.filed_at, hasSections: row.has_sections,
  }));
}

export async function getEdgarSection(
  accessionNo: string,
  sectionKey: EdgarSectionKey,
): Promise<{ accessionNo: string; sectionKey: string; content: string; charCount: number } | null> {
  const r = await pool.query<any>(
    `SELECT accession_no, section_key, content, char_count
     FROM edgar_filing_sections WHERE accession_no = $1 AND section_key = $2`,
    [accessionNo, sectionKey],
  );
  if (!r.rows[0]) return null;
  return {
    accessionNo: r.rows[0].accession_no,
    sectionKey:  r.rows[0].section_key,
    content:     r.rows[0].content,
    charCount:   r.rows[0].char_count,
  };
}

// ─── AI diff ─────────────────────────────────────────────────────────────────
const EDGAR_SECTION_LABELS: Record<string, string> = {
  business:     "Item 1. Business",
  risk_factors: "Item 1A. Risk Factors",
  mda:          "Item 7. MD&A",
};

export async function generateEdgarDiff(
  ticker: string,
  fromAccessionNo: string,
  toAccessionNo: string,
  sectionKey: EdgarSectionKey = "business",
): Promise<EdgarFilingDiff | null> {
  await ensureEdgarTables();

  // 캐시 확인
  const cached = await pool.query<any>(
    `SELECT from_accession, to_accession, section_key, changes_json, ai_summary, created_at
     FROM edgar_filing_diffs
     WHERE from_accession=$1 AND to_accession=$2 AND section_key=$3`,
    [fromAccessionNo, toAccessionNo, sectionKey],
  );
  if (cached.rows[0]) {
    const r = cached.rows[0];
    return {
      fromAccessionNo: r.from_accession, toAccessionNo: r.to_accession,
      sectionKey: r.section_key, changesJson: r.changes_json,
      aiSummary: r.ai_summary, createdAt: r.created_at,
    };
  }

  const [from, to] = await Promise.all([
    getEdgarSection(fromAccessionNo, sectionKey),
    getEdgarSection(toAccessionNo, sectionKey),
  ]);
  if (!from || !to) return null;

  const label = EDGAR_SECTION_LABELS[sectionKey] ?? sectionKey;
  const prompt = `다음은 동일 기업의 서로 다른 시점 SEC EDGAR 보고서에서 추출한 "${label}" 섹션입니다.
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
  "summary": "전체 변화의 핵심을 2~3문장으로 요약."
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
    aiResult = JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
  } catch (err: any) {
    console.error(`[edgar-diff] AI 오류:`, err.message);
    return null;
  } finally {
    geminiSemaphore.release();
  }

  const changesJson = {
    added:    Array.isArray(aiResult.added)    ? aiResult.added    : [],
    removed:  Array.isArray(aiResult.removed)  ? aiResult.removed  : [],
    modified: Array.isArray(aiResult.modified) ? aiResult.modified : [],
  };

  await pool.query(
    `INSERT INTO edgar_filing_diffs
       (ticker, from_accession, to_accession, section_key, changes_json, ai_summary)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (from_accession, to_accession, section_key) DO UPDATE SET
       changes_json = EXCLUDED.changes_json,
       ai_summary   = EXCLUDED.ai_summary,
       created_at   = now()`,
    [ticker.toUpperCase(), fromAccessionNo, toAccessionNo, sectionKey,
     JSON.stringify(changesJson), aiResult.summary ?? null],
  );

  return {
    fromAccessionNo, toAccessionNo, sectionKey,
    changesJson, aiSummary: aiResult.summary ?? null,
    createdAt: new Date().toISOString(),
  };
}

export async function generateAllEdgarDiffs(
  ticker: string,
  sectionKey: EdgarSectionKey = "business",
): Promise<EdgarFilingDiff[]> {
  const history = (await getEdgarFilingHistory(ticker))
    .filter(h => h.hasSections).reverse();
  const diffs: EdgarFilingDiff[] = [];
  for (let i = 0; i < history.length - 1; i++) {
    try {
      const diff = await generateEdgarDiff(
        ticker, history[i].accessionNo, history[i + 1].accessionNo, sectionKey,
      );
      if (diff) diffs.push(diff);
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      console.error(`[edgar-diff] 실패:`, err.message);
    }
  }
  return diffs;
}

export async function getEdgarFilingDiffs(
  ticker: string,
  sectionKey?: EdgarSectionKey,
): Promise<EdgarFilingDiff[]> {
  await ensureEdgarTables();
  const bare = ticker.replace(/\.(US|NYSE|NASDAQ)$/i, "").toUpperCase();
  const r = await pool.query<any>(
    `SELECT d.from_accession, d.to_accession, d.section_key,
            d.changes_json, d.ai_summary, d.created_at
     FROM edgar_filing_diffs d
     WHERE d.ticker = $1
       ${sectionKey ? "AND d.section_key = $2" : ""}
     ORDER BY d.created_at ASC`,
    sectionKey ? [bare, sectionKey] : [bare],
  );
  return r.rows.map(row => ({
    fromAccessionNo: row.from_accession,
    toAccessionNo:   row.to_accession,
    sectionKey:      row.section_key,
    changesJson:     row.changes_json,
    aiSummary:       row.ai_summary,
    createdAt:       row.created_at,
  }));
}
