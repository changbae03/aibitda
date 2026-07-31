/**
 * /api/filings — DART 공시 이력 관리 API
 *
 * POST /api/filings/sync/:ticker           공시 목록 + 섹션 전체 동기화
 * GET  /api/filings/:ticker/history        저장된 공시 목록 조회
 * GET  /api/filings/:ticker/section        특정 공시 섹션 원문 조회
 * POST /api/filings/:ticker/diff           두 공시 간 AI 변화 분석 생성
 * GET  /api/filings/:ticker/diffs          저장된 변화 분석 전체 조회
 * POST /api/filings/:ticker/sync-diffs     연속 공시 간 diff 일괄 생성
 */

import { Router } from "express";
import { getUserId } from "../lib/credits.js";
import { lookupCorpCode } from "../lib/dart-store.js";
import {
  syncFilingRegistry,
  syncAllFilings,
  getFilingHistory,
  getFilingSection,
  generateFilingDiff,
  generateAllDiffs,
  getFilingDiffs,
  SECTION_KEYS,
  type SectionKey,
} from "../lib/dart-filing-store.js";
import {
  syncAllEdgarFilings,
  getEdgarFilingHistory,
  getEdgarSection,
  generateEdgarDiff,
  generateAllEdgarDiffs,
  getEdgarFilingDiffs,
  type EdgarSectionKey,
} from "../lib/edgar-filing-store.js";

const router = Router();

// ─── 종목 코드 → corp_code 헬퍼 ─────────────────────────────────────────────
async function resolveCorpCode(ticker: string): Promise<string | null> {
  return await lookupCorpCode(ticker);
}

/**
 * POST /api/filings/sync/:ticker
 * DART에서 공시 목록을 가져와 DB에 저장하고, 각 공시의 주요 섹션을 다운로드합니다.
 * body: { sections?: string[], maxFilings?: number }
 */
router.post("/filings/sync/:ticker", async (req, res) => {
  const { ticker } = req.params;
  const {
    sections = ["business_content", "risk_factors", "competitors"],
    maxFilings = 20,
  } = req.body ?? {};

  const corpCode = await resolveCorpCode(ticker);
  if (!corpCode) {
    return res.status(404).json({ error: `corp_code not found for ticker: ${ticker}` });
  }

  try {
    const result = await syncAllFilings(
      corpCode,
      ticker,
      maxFilings,
      sections as SectionKey[],
    );
    return res.json({ ok: true, ticker, corpCode, ...result });
  } catch (err: any) {
    console.error("[filings] sync error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/filings/:ticker/history
 * 저장된 공시 목록을 최신순으로 반환합니다.
 */
router.get("/filings/:ticker/history", async (req, res) => {
  const { ticker } = req.params;
  const corpCode = await resolveCorpCode(ticker);
  if (!corpCode) return res.status(404).json({ error: `corp_code not found: ${ticker}` });

  try {
    const history = await getFilingHistory(corpCode);
    return res.json({ ok: true, ticker, corpCode, count: history.length, filings: history });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/filings/:ticker/section?rcept_no=XXX&section_key=business_content
 * 특정 공시 + 섹션의 원문 텍스트를 반환합니다.
 */
router.get("/filings/:ticker/section", async (req, res) => {
  const { rcept_no, section_key = "business_content" } = req.query as Record<string, string>;
  if (!rcept_no) return res.status(400).json({ error: "rcept_no 필수" });

  try {
    const section = await getFilingSection(rcept_no, section_key as SectionKey);
    if (!section) return res.status(404).json({ error: "섹션 없음" });
    return res.json({ ok: true, ...section });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/filings/:ticker/diff
 * 두 공시 간 AI 변화 분석을 생성합니다 (결과는 DB에 캐시).
 * body: { from_rcept_no, to_rcept_no, section_key? }
 */
router.post("/filings/:ticker/diff", async (req, res) => {
  const { ticker } = req.params;
  const { from_rcept_no, to_rcept_no, section_key = "business_content" } = req.body ?? {};

  if (!from_rcept_no || !to_rcept_no) {
    return res.status(400).json({ error: "from_rcept_no, to_rcept_no 필수" });
  }

  const corpCode = await resolveCorpCode(ticker);
  if (!corpCode) return res.status(404).json({ error: `corp_code not found: ${ticker}` });

  try {
    const diff = await generateFilingDiff(corpCode, from_rcept_no, to_rcept_no, section_key as SectionKey);
    if (!diff) return res.status(404).json({ error: "섹션 데이터 없음 — 먼저 sync 필요" });
    return res.json({ ok: true, ...diff });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/filings/:ticker/diffs?section_key=business_content
 * 저장된 변화 분석 전체를 시간순으로 반환합니다.
 */
router.get("/filings/:ticker/diffs", async (req, res) => {
  const { ticker } = req.params;
  const { section_key } = req.query as Record<string, string>;

  const corpCode = await resolveCorpCode(ticker);
  if (!corpCode) return res.status(404).json({ error: `corp_code not found: ${ticker}` });

  try {
    const diffs = await getFilingDiffs(corpCode, section_key as SectionKey | undefined);
    return res.json({ ok: true, ticker, corpCode, count: diffs.length, diffs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/filings/:ticker/sync-diffs
 * 저장된 연속 공시 간 AI diff를 일괄 생성합니다.
 * body: { section_key?: string }
 */
router.post("/filings/:ticker/sync-diffs", async (req, res) => {
  const { ticker } = req.params;
  const { section_key = "business_content" } = req.body ?? {};

  const corpCode = await resolveCorpCode(ticker);
  if (!corpCode) return res.status(404).json({ error: `corp_code not found: ${ticker}` });

  try {
    // 오래 걸리므로 즉시 응답 후 백그라운드 실행
    res.json({ ok: true, message: "diff 생성 백그라운드 시작 (GET /diffs 로 결과 확인)" });
    generateAllDiffs(corpCode, section_key as SectionKey).catch(err =>
      console.error(`[filings] sync-diffs error:`, err.message)
    );
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// US EDGAR 라우트 (/api/filings/us/...)
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/filings/us/sync/:ticker
 * SEC EDGAR submissions에서 10-K/20-F/10-Q 목록을 가져와 섹션까지 저장합니다.
 * body: { sections?: string[], maxFilings?: number }
 */
router.post("/filings/us/sync/:ticker", async (req, res) => {
  const { ticker } = req.params;
  const { sections = ["business", "risk_factors", "mda"], maxFilings = 15 } = req.body ?? {};
  try {
    const result = await syncAllEdgarFilings(ticker, maxFilings, sections as EdgarSectionKey[]);
    return res.json({ ok: true, ticker, ...result });
  } catch (err: any) {
    console.error("[edgar-filings] sync error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/filings/us/:ticker/history
 * 저장된 공시 목록을 최신순으로 반환합니다.
 */
router.get("/filings/us/:ticker/history", async (req, res) => {
  try {
    const history = await getEdgarFilingHistory(req.params.ticker);
    return res.json({ ok: true, ticker: req.params.ticker, count: history.length, filings: history });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/filings/us/:ticker/section?accession_no=XXX&section_key=business
 */
router.get("/filings/us/:ticker/section", async (req, res) => {
  const { accession_no, section_key = "business" } = req.query as Record<string, string>;
  if (!accession_no) return res.status(400).json({ error: "accession_no 필수" });
  try {
    const section = await getEdgarSection(accession_no, section_key as EdgarSectionKey);
    if (!section) return res.status(404).json({ error: "섹션 없음" });
    return res.json({ ok: true, ...section });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/filings/us/:ticker/diff
 * 두 공시 간 AI 변화 분석.
 * body: { from_accession, to_accession, section_key? }
 */
router.post("/filings/us/:ticker/diff", async (req, res) => {
  const { ticker } = req.params;
  const { from_accession, to_accession, section_key = "business" } = req.body ?? {};
  if (!from_accession || !to_accession) {
    return res.status(400).json({ error: "from_accession, to_accession 필수" });
  }
  try {
    const diff = await generateEdgarDiff(ticker, from_accession, to_accession, section_key as EdgarSectionKey);
    if (!diff) return res.status(404).json({ error: "섹션 데이터 없음 — sync 먼저 필요" });
    return res.json({ ok: true, ...diff });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/filings/us/:ticker/diffs?section_key=business
 */
router.get("/filings/us/:ticker/diffs", async (req, res) => {
  const { section_key } = req.query as Record<string, string>;
  try {
    const diffs = await getEdgarFilingDiffs(req.params.ticker, section_key as EdgarSectionKey | undefined);
    return res.json({ ok: true, ticker: req.params.ticker, count: diffs.length, diffs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/filings/us/:ticker/sync-diffs
 * 연속 공시 간 diff 일괄 생성 (백그라운드).
 */
router.post("/filings/us/:ticker/sync-diffs", async (req, res) => {
  const { ticker } = req.params;
  const { section_key = "business" } = req.body ?? {};
  res.json({ ok: true, message: "Edgar diff 생성 백그라운드 시작" });
  generateAllEdgarDiffs(ticker, section_key as EdgarSectionKey).catch(err =>
    console.error(`[edgar-filings] sync-diffs error:`, err.message)
  );
});

export default router;
