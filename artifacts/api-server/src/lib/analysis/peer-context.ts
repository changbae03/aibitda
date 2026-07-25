// 피어(경쟁사) 선정·재무 수집 — US 하드코딩 맵 + AI 선택 + 데이터 수집
import { db, pool } from "@workspace/db";
import { analysesTable, analysisStepsTable, modelInsightsTable } from "@workspace/db";
import { eq, desc, not, sql, and, isNotNull } from "drizzle-orm";
import { refreshBriefForTicker } from "../../routes/portfolio.js";
import { scheduleAnalysisSelfReview } from "../self-review.js";
import { validateTicker } from "../sanitize.js";
import { getUserId, checkAndDeductCredit } from "../credits.js";
import { loadKRXList, lookupKoreanName, correctKoreanTicker } from "../krx-cache";
import { cache, TTL } from "../mem-cache.js";
import { fetchDartSubjectBalance, fetchNaverPBR, writeMetricCache } from "../peer-collector.js";
import { validatePeers } from "../peer-validator.js";
import { fetchKISStockQuotes, buildKISStockContext } from "../kis-client.js";
import { fetchECOSMacro, buildECOSContext } from "../ecos-client.js";
import { fetchFREDMacro, buildFREDContext } from "../fred-client.js";
import { AGENTS, STEP_ORDER, buildPrompt, needsFinancialSector, type AgentKey } from "../ai-agents.js";
import { getCalibrationContext, classifySector } from "../../routes/performance.js";
import { triggerModelReview } from "../../routes/model-insights.js";
import { runQACheck } from "../qa-checker.js";
import { getDartHistoricalContext, fetchAndStoreDartQuarterly, getDartAnchorNumerics, type DartAnchorNumerics } from "../dart-store.js";
import { fetchDartBusinessContent, fetchDartCompetitorSection, fetchDartOrderBacklog } from "../dart-business-content.js";
import { fetchSECEdgarContent } from "../sec-edgar-content.js";
import { fetchKOSISData, buildKOSISContext } from "../kosis-client.js";
import { buildSOTPSubsidiaryContext, hasSOTPSubsidiaryData } from "../sotp-subsidiary-context.js";
import { getLatestMarketRegime } from "../market-regime-updater.js";
import { getSectorLearningNote } from "../sector-learning.js";
import { buildFmpContext } from "../fmp-client.js";
import { rawQuery, dbCacheGet, dbCacheSet } from "./store.js";
import { yahooFinance, fetchNaverFinanceData, naverFmt, fmtNum, pct, opm, NAVER_HEADERS } from "./financial-context.js";
import { getDartCompetitorTickerPeers, extractCompanyNamesFromDart } from "./korea-context.js";
import { extractJsonSafe } from "./json-repair.js";
import { ai, geminiSemaphore } from "./gemini.js";

// ─── Peer Data Auto-Fetch ─────────────────────────────────────────────────────

// ─── US 주요 종목 하드코딩 피어 맵 (AI 선택 실패 시 대체) ───────────────────────
type PeerEntry = { ticker: string; name: string; exchange: string; reason: string };
const US_PEER_MAP: Record<string, PeerEntry[]> = {
  // Semiconductors / AI
  "NVDA": [
    { ticker: "AMD",  name: "AMD",      exchange: "NASDAQ", reason: "GPU/CPU 경쟁사, 데이터센터 AI 가속기" },
    { ticker: "INTC", name: "Intel",    exchange: "NASDAQ", reason: "데이터센터 반도체, x86 CPU 경쟁사" },
    { ticker: "TSM",  name: "TSMC",     exchange: "NYSE",   reason: "첨단 파운드리, NVIDIA 웨이퍼 생산" },
    { ticker: "AVGO", name: "Broadcom", exchange: "NASDAQ", reason: "AI 네트워킹 칩, ASIC 경쟁사" },
    { ticker: "QCOM", name: "Qualcomm", exchange: "NASDAQ", reason: "모바일·엣지 AI 반도체" },
  ],
  "AMD": [
    { ticker: "NVDA", name: "NVIDIA",   exchange: "NASDAQ", reason: "GPU 시장 1위 직접 경쟁사" },
    { ticker: "INTC", name: "Intel",    exchange: "NASDAQ", reason: "CPU/데이터센터 경쟁사" },
    { ticker: "AVGO", name: "Broadcom", exchange: "NASDAQ", reason: "AI 칩 경쟁사" },
    { ticker: "QCOM", name: "Qualcomm", exchange: "NASDAQ", reason: "모바일 반도체" },
    { ticker: "TSM",  name: "TSMC",     exchange: "NYSE",   reason: "첨단 파운드리 파트너" },
  ],
  "INTC": [
    { ticker: "AMD",  name: "AMD",         exchange: "NASDAQ", reason: "x86 CPU 직접 경쟁사" },
    { ticker: "NVDA", name: "NVIDIA",      exchange: "NASDAQ", reason: "데이터센터 AI 칩" },
    { ticker: "AVGO", name: "Broadcom",    exchange: "NASDAQ", reason: "반도체 경쟁사" },
    { ticker: "QCOM", name: "Qualcomm",    exchange: "NASDAQ", reason: "모바일/IoT 칩" },
    { ticker: "TSM",  name: "TSMC",        exchange: "NYSE",   reason: "파운드리 경쟁사" },
  ],
  "AVGO": [
    { ticker: "NVDA", name: "NVIDIA",   exchange: "NASDAQ", reason: "AI 칩 경쟁사" },
    { ticker: "AMD",  name: "AMD",      exchange: "NASDAQ", reason: "반도체 동종" },
    { ticker: "MRVL", name: "Marvell",  exchange: "NASDAQ", reason: "데이터 인프라 반도체" },
    { ticker: "QCOM", name: "Qualcomm", exchange: "NASDAQ", reason: "반도체 동종" },
    { ticker: "TSM",  name: "TSMC",     exchange: "NYSE",   reason: "첨단 파운드리" },
  ],
  // Big Tech
  "AAPL": [
    { ticker: "MSFT", name: "Microsoft",    exchange: "NASDAQ", reason: "빅테크 동종, 클라우드/AI 경쟁" },
    { ticker: "GOOGL", name: "Alphabet",    exchange: "NASDAQ", reason: "AI/광고 경쟁사" },
    { ticker: "META", name: "Meta",         exchange: "NASDAQ", reason: "소비자 기술 동종" },
    { ticker: "AMZN", name: "Amazon",       exchange: "NASDAQ", reason: "클라우드·디지털 서비스" },
    { ticker: "SONY", name: "Sony",         exchange: "NYSE",   reason: "소비자 가전·엔터테인먼트 경쟁사" },
  ],
  "MSFT": [
    { ticker: "GOOGL", name: "Alphabet",    exchange: "NASDAQ", reason: "클라우드(Azure vs GCP)·AI 경쟁사" },
    { ticker: "AMZN",  name: "Amazon",      exchange: "NASDAQ", reason: "AWS vs Azure 클라우드" },
    { ticker: "AAPL",  name: "Apple",       exchange: "NASDAQ", reason: "빅테크 동종" },
    { ticker: "CRM",   name: "Salesforce",  exchange: "NYSE",   reason: "엔터프라이즈 SaaS" },
    { ticker: "ORCL",  name: "Oracle",      exchange: "NYSE",   reason: "클라우드 ERP·DB 경쟁사" },
  ],
  "GOOGL": [
    { ticker: "MSFT",  name: "Microsoft",   exchange: "NASDAQ", reason: "클라우드·AI·검색 경쟁사" },
    { ticker: "META",  name: "Meta",         exchange: "NASDAQ", reason: "디지털 광고 직접 경쟁사" },
    { ticker: "AMZN",  name: "Amazon",       exchange: "NASDAQ", reason: "클라우드(AWS vs GCP)" },
    { ticker: "AAPL",  name: "Apple",        exchange: "NASDAQ", reason: "빅테크 동종" },
    { ticker: "BIDU",  name: "Baidu",        exchange: "NASDAQ", reason: "AI 검색 경쟁사(중국)" },
  ],
  "META": [
    { ticker: "GOOGL", name: "Alphabet",    exchange: "NASDAQ", reason: "디지털 광고 직접 경쟁사" },
    { ticker: "SNAP",  name: "Snap",        exchange: "NYSE",   reason: "소셜미디어·광고 경쟁사" },
    { ticker: "PINS",  name: "Pinterest",   exchange: "NYSE",   reason: "소셜 광고 플랫폼" },
    { ticker: "MSFT",  name: "Microsoft",   exchange: "NASDAQ", reason: "빅테크·AI 동종" },
    { ticker: "AMZN",  name: "Amazon",      exchange: "NASDAQ", reason: "디지털 광고 경쟁사" },
  ],
  "AMZN": [
    { ticker: "MSFT",  name: "Microsoft",   exchange: "NASDAQ", reason: "Azure vs AWS 클라우드" },
    { ticker: "GOOGL", name: "Alphabet",    exchange: "NASDAQ", reason: "GCP vs AWS 클라우드" },
    { ticker: "BABA",  name: "Alibaba",     exchange: "NYSE",   reason: "글로벌 이커머스·클라우드" },
    { ticker: "WMT",   name: "Walmart",     exchange: "NYSE",   reason: "리테일 경쟁사" },
    { ticker: "SHOP",  name: "Shopify",     exchange: "NYSE",   reason: "이커머스 플랫폼 경쟁사" },
  ],
  // New Space / Aerospace & Defense
  "RKLB": [
    { ticker: "ASTS",  name: "AST SpaceMobile", exchange: "NASDAQ", reason: "뉴스페이스 위성·통신 초기 성장주, 유사 밸류에이션 프로파일" },
    { ticker: "LUNR",  name: "Intuitive Machines", exchange: "NASDAQ", reason: "뉴스페이스 달 탐사·NASA 계약 초기 성장주" },
    { ticker: "PL",    name: "Planet Labs",     exchange: "NYSE",   reason: "위성 운영·데이터 서비스, 유사 EV/Sales 고배수 성장주" },
    { ticker: "SPCE",  name: "Virgin Galactic",  exchange: "NYSE",   reason: "민간 우주 초기 스타트업" },
    { ticker: "KTOS",  name: "Kratos Defense",  exchange: "NASDAQ", reason: "방산·우주 인프라, 미국 정부 계약 유사 구조" },
  ],
  "ASTS": [
    { ticker: "RKLB",  name: "Rocket Lab",      exchange: "NASDAQ", reason: "뉴스페이스 발사체·위성 동종" },
    { ticker: "LUNR",  name: "Intuitive Machines", exchange: "NASDAQ", reason: "뉴스페이스 초기 성장주" },
    { ticker: "PL",    name: "Planet Labs",     exchange: "NYSE",   reason: "위성 서비스 동종" },
    { ticker: "VSAT",  name: "ViaSat",          exchange: "NASDAQ", reason: "위성통신 서비스" },
    { ticker: "IRDM",  name: "Iridium",         exchange: "NASDAQ", reason: "위성통신, 단 수익성 있는 성숙 기업으로 배수 직접 적용 주의" },
  ],
  // EV / Auto
  "TSLA": [
    { ticker: "GM",    name: "General Motors", exchange: "NYSE",   reason: "전통차·EV 전환 경쟁사" },
    { ticker: "F",     name: "Ford",           exchange: "NYSE",   reason: "픽업트럭·EV 경쟁사" },
    { ticker: "RIVN",  name: "Rivian",         exchange: "NASDAQ", reason: "순수 EV 스타트업" },
    { ticker: "NIO",   name: "NIO",            exchange: "NYSE",   reason: "중국 프리미엄 EV 경쟁사" },
    { ticker: "BYD",   name: "BYD (ADR)근사치 BYDDF", exchange: "OTC", reason: "글로벌 EV 판매 1위 경쟁사" },
  ],
  // Biotech / Pharma
  "MRNA": [
    { ticker: "BNTX",  name: "BioNTech",   exchange: "NASDAQ", reason: "mRNA 기술 직접 경쟁사" },
    { ticker: "PFE",   name: "Pfizer",     exchange: "NYSE",   reason: "백신·항바이러스 파트너/경쟁사" },
    { ticker: "REGN",  name: "Regeneron",  exchange: "NASDAQ", reason: "바이오로직스 대형사" },
    { ticker: "AMGN",  name: "Amgen",      exchange: "NASDAQ", reason: "대형 바이오텍" },
    { ticker: "GILD",  name: "Gilead",     exchange: "NASDAQ", reason: "항바이러스·면역 분야" },
  ],
  "PFE": [
    { ticker: "JNJ",   name: "Johnson & Johnson", exchange: "NYSE",   reason: "대형 제약 동종" },
    { ticker: "MRK",   name: "Merck",              exchange: "NYSE",   reason: "대형 제약 동종" },
    { ticker: "AZN",   name: "AstraZeneca",        exchange: "NASDAQ", reason: "글로벌 빅파마" },
    { ticker: "ABBV",  name: "AbbVie",             exchange: "NYSE",   reason: "대형 바이오파마" },
    { ticker: "MRNA",  name: "Moderna",            exchange: "NASDAQ", reason: "mRNA 백신 경쟁사" },
  ],
  "REGN": [
    { ticker: "AMGN",  name: "Amgen",      exchange: "NASDAQ", reason: "대형 바이오텍 동종" },
    { ticker: "BIIB",  name: "Biogen",     exchange: "NASDAQ", reason: "신경·면역 바이오텍" },
    { ticker: "GILD",  name: "Gilead",     exchange: "NASDAQ", reason: "대형 바이오텍" },
    { ticker: "VRTX",  name: "Vertex",     exchange: "NASDAQ", reason: "CF·희귀질환 바이오텍" },
    { ticker: "MRNA",  name: "Moderna",    exchange: "NASDAQ", reason: "mRNA 바이오텍" },
  ],
  // Finance
  "JPM": [
    { ticker: "BAC",  name: "Bank of America", exchange: "NYSE",   reason: "대형 상업은행" },
    { ticker: "GS",   name: "Goldman Sachs",   exchange: "NYSE",   reason: "투자은행 경쟁사" },
    { ticker: "MS",   name: "Morgan Stanley",  exchange: "NYSE",   reason: "투자은행" },
    { ticker: "WFC",  name: "Wells Fargo",     exchange: "NYSE",   reason: "대형 상업은행" },
    { ticker: "C",    name: "Citigroup",       exchange: "NYSE",   reason: "글로벌 대형 은행" },
  ],
  // Energy
  "XOM": [
    { ticker: "CVX",  name: "Chevron",    exchange: "NYSE", reason: "Integrated Oil & Gas 동종" },
    { ticker: "COP",  name: "ConocoPhillips", exchange: "NYSE", reason: "독립 석유 E&P" },
    { ticker: "BP",   name: "BP",         exchange: "NYSE", reason: "글로벌 메이저 오일" },
    { ticker: "SHEL", name: "Shell",      exchange: "NYSE", reason: "글로벌 메이저 오일" },
    { ticker: "TTE",  name: "TotalEnergies", exchange: "NYSE", reason: "글로벌 메이저 오일" },
  ],
};

// ─── Peer 선택 ──────────────────────────────────────────────────────────────────

async function selectPeerTickers(
  companyName: string,
  industry: string,
  previousContext: string,
  subjectTicker: string = "",
  dartHint: string = ""
): Promise<Array<{ ticker: string; name: string; exchange: string; reason: string }>> {
  try {
    const prompt = `Company: ${companyName}, Industry: ${industry}.

Based on the context below, identify 4-5 publicly traded peer companies for valuation comparison.
${dartHint ? `\n⭐ [DART 공시 참고] ${dartHint}\n위 경쟁사들이 상장사인 경우, 아래 3-axis 적합성 평가(≥2/3)를 통과할 때만 피어 그룹에 포함하세요. 사업 모델이 실질적으로 다르다면 제외하고, reason 필드에 "DART 명시 경쟁사이나 사업모델 불일치로 제외" 표기 가능.\n` : ""}
PEER QUALITY SCORING — for each candidate, mentally score these 3 axes and only include peers that score ≥2/3:
1. Business model match: same revenue model (product / service / subscription / royalty) and similar value chain position (upstream material / component / OEM / brand / platform)
2. Margin profile similarity: gross margin within ±15pp of subject company, or if margin data unavailable, same structural cost driver (e.g., both fab-heavy, both asset-light)
3. Growth stage match: same phase (pre-revenue pipeline / early commercial / mature growth / declining) — mixing stages severely distorts multiples

Flag any peer that fails one axis with a brief note in the reason field (e.g., "마진 프로파일 상이 — EV/Sales만 유효").
${previousContext ? `\nContext:\n${previousContext.slice(0, 1500)}` : ""}

PEER SELECTION RULES (strictly enforce):
- Business model match is MANDATORY. Do NOT mix these types in the same peer group:
  * Pure pipeline biotech (파이프라인 바이오텍) vs CDMO/CMO (위탁생산기업, e.g., 삼성바이오로직스, 에스티팜, 바이넥스). EV/Sales comparison between them is invalid.
  * Drug discovery/royalty model vs self-commercialization model — flag if you must include a mixed model peer.

- KOREAN BIOTECH SUBSECTOR RULES — 서브섹터 혼재 절대 금지 (한국 바이오 기업 분석 시 항상 적용):
  ┌─ 줄기세포 치료제: 파미셀(005690.KS), 코아스템켈생(166480.KQ), 강스템바이오텍(208370.KQ), 안트로젠(065660.KQ), 바이오솔루션(086820.KQ), 차바이오텍(085660.KQ)
  ├─ 제대혈 은행: 메디포스트(078160.KQ), 차바이오텍(085660.KQ)
  ├─ 바이오시밀러 전문기업: 셀트리온(068270.KS), 셀트리온헬스케어(091990.KQ), 삼성바이오로직스(207940.KS)
  ├─ 미용/보톡스/필러: 휴젤(145020.KQ), 메디톡스(086900.KQ), 대웅제약(069620.KS), 파마리서치(214450.KQ)
  ├─ 체성분/의료기기: 인바디(041830.KQ), 뷰웍스(180640.KQ), 오스템임플란트(048260.KQ)
  ├─ CDMO/CMO(위탁생산): 삼성바이오로직스(207940.KS), 에스티팜(237690.KQ), 바이넥스(053030.KQ)
  └─ 신약 개발(키나제·소분자): 오스코텍(039200.KQ), 보로노이(310210.KQ), 한미약품(128940.KS)

  ❌ FORBIDDEN cross-subsector mixing — 이 조합은 항상 피어 선정 오류:
  * 줄기세포 치료제 기업 피어에 셀트리온(바이오시밀러)·휴젤(보톡스/필러)·인바디(체성분기기)·오스코텍(키나제 신약) 절대 금지
  * 바이오시밀러 기업 피어에 줄기세포 기업·신약 파이프라인 기업 절대 금지
  * CDMO 기업 피어에 신약 개발사 절대 금지 (수익 모델 완전히 다름)
  * "바이오"라는 단어가 공통이더라도 실제 제품·수익 모델이 다르면 피어 불가
  * 적자 바이오텍 피어에 흑자 대형 제약사(PER 30x) 혼합 금지 — 멀티플 왜곡

- BATTERY / EV BATTERY COMPANY RULES (apply when subject is a battery cell/pack manufacturer like LG에너지솔루션, 삼성SDI, SK온, CATL, Panasonic Energy):
  * PRIORITY 1 — Korean battery peers: 삼성SDI(006400.KS), SK이노베이션(096770.KS)
  * PRIORITY 2 — Global battery peers: CATL is Shenzhen-listed (300750.SZ) — Yahoo Finance coverage may be limited; use 6752.T (Panasonic Holdings) as alternative
  * PRIORITY 3 — Battery materials: 에코프로비엠(247540.KQ), 포스코퓨처엠(003670.KS) acceptable as supply-chain peers (flag as "배터리 소재 공급망 피어")
  * FORBIDDEN PEERS for battery companies — DO NOT SELECT:
    - 삼성전자(005930.KS): consumer electronics + semiconductor, NOT a battery company
    - SK하이닉스(000660.KS): pure DRAM/HBM semiconductor, completely different business
    - Any semiconductor fab or memory company → business model completely different
  * DO NOT include the subject company itself as a peer

- SEMICONDUCTOR COMPANY RULES (apply when subject is a memory/DRAM/HBM company like SK하이닉스, Samsung Electronics, Micron):
  * PRIORITY 1 — Korean domestic peers first: 삼성전자(005930.KS) is always a valid peer for Korean memory companies.
  * PRIORITY 2 — Pure-play memory peers only: MU (Micron Technology) — only DRAM/NAND/HBM, no HDD/storage.
  * PRIORITY 3 — TSMC (TSM) acceptable as leading-edge foundry peer for EV/EBITDA comparison.
  * FORBIDDEN PEERS for pure DRAM/HBM companies — DO NOT SELECT:
    - WDC (Western Digital): HDD + NAND mixed business → EV/EBITDA structurally distorted (HDD cyclicality inflates multiples). Not comparable to DRAM/HBM pure-play.
    - STX (Seagate): HDD-only company → completely different business model.
    - SMCI (Super Micro Computer): Server assembler/AI infrastructure, not memory manufacturer → EV/EBITDA not comparable.
    - INTC (Intel): Diversified CPU/GPU/foundry → memory is minor segment.
  * If fewer than 3 pure-play memory peers exist, supplement with: AMAT, KLAC (semiconductor equipment), or ASML — but flag as "supply chain peer, not direct competitor".

- For pipeline-only biotechs (pre-revenue or minimal revenue), prefer peers that are also pre-revenue or early-commercial stage with similar therapeutic area and modality (RNA, cell therapy, small molecule, etc.)
- If a strictly comparable peer set cannot be found in Korea, include 1-2 US-listed peers of similar stage and modality.

- AI / 머신비전 / 컴퓨터비전 / 얼굴인식 / 딥러닝 솔루션 기업 규칙 (알체라·라온피플·코난테크놀로지·딥노이드·뷰런테크놀로지·수아랩·아이코아 등에 적용):
  * PRIORITY 1 — 한국 AI 비전/인식 기업: 라온피플(300120.KQ), 코난테크놀로지(402030.KQ), 딥노이드(315640.KQ), 뷰런테크놀로지(310210.KQ)
  * PRIORITY 2 — 한국 AI 소프트웨어/플랫폼: 셀바스AI(108310.KQ), 마인즈랩(377480.KQ), 솔트룩스(304100.KQ), 이스트소프트(047560.KQ)
  * PRIORITY 3 — 글로벌 AI 비전/인식 기업: NEC(6701.T) — 얼굴인식 솔루션 글로벌 리더, Cogent Systems/IDEMIA(비상장이면 제외), Aware Inc.(AWRE) — 생체인증/얼굴인식 상장사
  * ❌ FORBIDDEN PEERS for AI/CV 기업 — 이 조합은 항상 피어 선정 오류:
    - 핀테크/결제 플랫폼 (카카오페이·비바리퍼블리카·NHN페이코·핀크): 수익 모델 완전 다름, AI 솔루션 B2B와 비교 불가
    - 헬스케어/바이오/제대혈 (메디포스트·차바이오텍·파미셀·코아스템): 사업 영역·수익 모델 완전 다름
    - B2B SI/ERP/솔루션통합업체 (누리플렉스·신세계I&C·SK C&C·삼성SDS): AI 전문 기업이 아닌 IT 서비스 통합사
    - AI 반도체/칩 설계사: AI 소프트웨어 솔루션 기업과 사업 모델 구조적으로 다름
    - "AI"·"tech"·"디지털" 키워드만 공통이고 실제 제품·수익 모델이 다른 기업 절대 금지
    - 영상보안(CCTV 제조·설치) vs AI 영상분석 소프트웨어는 다른 사업 모델임에 주의

- PCB / MLB(Multi-Layer Board) / 서브스트레이트 / FPCB(연성회로기판) 제조사 규칙 (이수페타시스·대덕전자·코리아써키트·심텍·인터플렉스 등에 적용):
  * PRIORITY PEERS: 대덕전자(353200.KS), 코리아써키트(007810.KS), 심텍(222800.KQ), 인터플렉스(051370.KQ), TTM Technologies(TTMI), Tripod Technology(3044.TW)
  * ACCEPTABLE: 삼성전기(009150.KS) — PCB·MLCC 겸업, 전자부품 공급망 피어로 유효
  * ❌ FORBIDDEN PEERS for PCB/기판 companies:
    - 방산·항공우주 업체: 한화에어로스페이스(012450.KS), 한화시스템(272210.KQ), KAI(047810.KS), LIG넥스원(079550.KS), 한화오션(042660.KS) — PCB 납품 고객사이지 경쟁사 아님
    - 소비자 가전 완성품 업체: 삼성전자(005930.KS), LG전자(066570.KS) — 부품 수요자이지 PCB 제조 경쟁사 아님
    - 반도체 팹·패키징: TSMC(TSM), DB하이텍(000990.KS), 하나마이크론(067310.KQ) — 제조 공정 완전 상이

- 건설 / 기초건설 / 토목 / 특수건설 기업 규칙 (동양파일·삼보건설·KCC건설·대우건설·현대건설·삼성물산 건설부문 등에 적용):
  ★ 건설업은 사업 세부 유형이 다르면 수익 구조가 크게 달라서 피어 선정 오류가 잦음. 아래 구분을 반드시 확인하세요.
  ┌─ 기초건설/파일·항타 전문: 동양파일(228340.KQ), 삼보건설(009060.KQ), PHC파일 제조사 — 비교 피어는 동종 기초공사 업체
  ├─ 대형 종합건설(GC): 현대건설(000720.KS), 대우건설(047040.KS), GS건설(006360.KS), 삼성물산(028260.KS)
  ├─ 중견 주택·도급 건설: HDC현대산업개발(294870.KS), 태영건설(009410.KQ), 중흥건설(그룹 포함)
  ├─ 플랜트·EPC 전문: 현대엔지니어링(비상장), 삼성엔지니어링(028050.KS), SK에코플랜트
  └─ 정부 SOC·도로·터널 전문: 대림건설(매각/비상장), 한국종합기술 등
  * ❌ FORBIDDEN cross-category mixing for 기초건설/파일 기업:
    - 대형 종합건설(현대건설·대우건설·GS건설)을 기초건설 전문 기업 피어로 사용 금지 — 매출 규모·사업구조 완전 상이
    - 건설장비 임대·레미콘·골재 업체 혼합 금지
    - 부동산 개발·리츠(REITs) 업체 혼합 금지

- 소재 / 중간재 / 산업용 부품 기업 규칙 (철강·알루미늄·화학소재·플라스틱 중간재 등에 적용):
  * 동일 소재 체인 내 위치 기준: 원재료 생산(POSCO·현대제철) vs 중간재 가공(스틸텍·동국제강 선재) vs 특수 가공품 제조는 각각 다른 피어 그룹
  * ❌ 소재 기업 피어에 완성품 수요기업(자동차·조선·가전) 혼합 금지 — 고객사이지 경쟁사 아님
  * 수익성 지표(OPM·GPM)가 구조적으로 다르면 EV/EBITDA 대신 EV/Sales 또는 PBR로만 비교하고 근거 명시

- IT서비스 / SI / ERP / 공공 SW 기업 규칙 (코스콤·삼성SDS·LG CNS·SK C&C 등에 적용):
  * 피어 구분 필수: ① 금융 IT(코스콤·삼성증권IT) vs ② 제조 IT/MES(포스코ICT) vs ③ 공공 SI(LG CNS·SK C&C) vs ④ 클라우드/SaaS 전문 (더존비즈온·영림원소프트랩)
  * ❌ 순수 SW SaaS 기업(더존비즈온·클라우드 전문사)을 대형 SI(삼성SDS·LG CNS) 피어로 사용 금지 — 마진·성장성 구조 완전 상이

- GLOBAL PEER → KOREAN STOCK NOTE: When any non-Korean (US/global) peer is selected for a Korean company, apply the peer multiples directly without a structural market discount.

Return a JSON object with this exact schema:
{"peers": [{"ticker": "005930.KS", "name": "삼성전자", "exchange": "KOSPI", "reason": "동일 메모리 반도체 시장 경쟁사, PER/EV/EBITDA 비교 유효"}, ...]}

CRITICAL ticker format rules — Yahoo Finance tickers only:
- KOSPI stocks: 6-digit + ".KS"  (e.g., 005930.KS=삼성전자, 068270.KS=셀트리온, 207940.KS=삼성바이오로직스, 000660.KS=SK하이닉스)
- KOSDAQ stocks: 6-digit + ".KQ" (e.g., 086900.KQ=메디오젠, 196170.KQ=알테오젠)
- US NASDAQ/NYSE stocks: plain ticker (e.g., AMGN, REGN, MRNA, NVO, PFE, JNJ)
- Swiss SIX stocks: ticker + ".SW"  (e.g., SDZ.SW=Sandoz, NOVN.SW=Novartis, ROG.SW=Roche)
- Tokyo TSE stocks: 4-digit + ".T"  (e.g., 4502.T=Takeda, 4503.T=Astellas)
- Hong Kong HKEX: ticker + ".HK"    (e.g., 0941.HK=China Mobile)
- London LSE: ticker + ".L"         (e.g., AZN.L=AstraZeneca)
- Do NOT use .KO — invalid. Prefer KS/KQ for Korean stocks.
- STRONGLY PREFER Korean or US-listed peers (best Yahoo Finance coverage). Swiss/European peers only if no closer Korean/US alternative.
- reason: 이 기업이 유의미한 피어인 이유를 1~2문장으로 한국어로 설명 (사업 유사성, 경쟁 관계, 밸류에이션 비교 근거 중심)`;

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are a financial analyst. Respond with a valid JSON object only. No explanation, no markdown, just the JSON.",
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        // thinking 모드 비활성화 — 사고 토큰이 resp.text에 섞이면 JSON 파싱 실패
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const raw = resp.text ?? "";

    // 다중 폴백 JSON 추출
    let parsed: any = null;

    // 1. 직접 파싱 (가장 깨끗한 경우)
    try { parsed = JSON.parse(raw); } catch { /* 다음 시도 */ }

    // 2. 코드펜스·앞뒤 공백 제거 후 파싱
    if (!parsed?.peers) {
      parsed = extractJsonSafe(raw);
    }

    // 3. "peers" 키를 기준으로 서브스트링 추출
    if (!parsed?.peers) {
      const peersIdx = raw.indexOf('"peers"');
      if (peersIdx !== -1) {
        const braceStart = raw.lastIndexOf("{", peersIdx);
        const braceEnd = raw.indexOf("]", peersIdx);
        if (braceStart !== -1 && braceEnd !== -1) {
          // 닫는 ] 뒤에 }를 붙여 완전한 JSON 만들기
          const candidate = raw.slice(braceStart, braceEnd + 1) + "}";
          try { parsed = JSON.parse(candidate); } catch { /* 실패 */ }
        }
      }
    }

    // 4. 개별 ticker 패턴으로 최소 구성
    if (!parsed?.peers) {
      const tickerPattern = /["']ticker["']\s*:\s*["']([^"']+)["']/g;
      const namePattern = /["']name["']\s*:\s*["']([^"']+)["']/g;
      const reasonPattern = /["']reason["']\s*:\s*["']([^"']+)["']/g;
      const tickers = [...raw.matchAll(tickerPattern)].map(m => m[1]);
      const names = [...raw.matchAll(namePattern)].map(m => m[1]);
      const reasons = [...raw.matchAll(reasonPattern)].map(m => m[1]);
      if (tickers.length >= 2) {
        parsed = {
          peers: tickers.map((t, i) => ({
            ticker: t,
            name: names[i] ?? t,
            exchange: t.endsWith(".KS") ? "KOSPI" : t.endsWith(".KQ") ? "KOSDAQ" : "NYSE/NASDAQ",
            reason: reasons[i] ?? "피어 비교",
          }))
        };
        console.log(`[peer-select] Fallback regex extracted ${tickers.length} tickers`);
      }
    }

    if (parsed?.peers && Array.isArray(parsed.peers) && parsed.peers.length > 0) {
      // 분석 대상 기업 자체가 피어에 포함된 경우 제거 (ticker 또는 회사명 일치 모두 체크)
      const subjectTickerUpper = subjectTicker.toUpperCase();
      const filtered = parsed.peers.filter((p: any) => {
        const t = (p.ticker ?? "").toUpperCase();
        const n = (p.name ?? "").toUpperCase();
        if (subjectTickerUpper && t === subjectTickerUpper) return false;
        if (n === companyName.toUpperCase()) return false;
        if (p.reason?.includes("분석 대상")) return false;
        return true;
      });
      const raw_final = (filtered.length > 0 ? filtered : parsed.peers).slice(0, 5);

      // ── KRX 캐시로 한국 티커 교정 (.KS/.KQ 오류 방지) ──────────────────────
      const final = raw_final.map((p: any) => {
        const corrected = correctKoreanTicker(p.ticker ?? "");
        if (corrected !== p.ticker) {
          const newExchange = corrected.endsWith(".KS") ? "KOSPI" : "KOSDAQ";
          console.log(`[peer-select] Ticker corrected: ${p.ticker} → ${corrected} (${p.name})`);
          return { ...p, ticker: corrected, exchange: newExchange };
        }
        return p;
      });

      console.log(`[peer-select] Success: ${final.length} peers — ${final.map((p: any) => p.ticker).join(", ")}`);
      return final;
    }
    console.warn(`[peer-select] No valid peers in response (raw len=${raw.length}): ${JSON.stringify(parsed)?.slice(0, 200)}`);
  } catch (err) {
    console.error("[peer-select] Failed:", err);
  }
  return [];
}

async function fetchPeerFinancials(
  peers: Array<{ ticker: string; name: string; exchange: string; reason?: string }>
): Promise<string> {
  if (peers.length === 0) return "";

  // ── KIS 실시간 선조회: 한국 피어 종목 코드 추출 후 일괄 요청 ──────────────
  const koreanPeerMap = new Map<string, string>(); // ticker → 6-digit code
  for (const p of peers) {
    const m = p.ticker.match(/^(\d{6})\.(KS|KQ)$/i);
    if (m) koreanPeerMap.set(p.ticker, m[1]);
  }
  const kisQuotes = koreanPeerMap.size > 0
    ? await fetchKISStockQuotes([...koreanPeerMap.values()]).catch(() => new Map())
    : new Map();

  const rows: string[] = [];
  rows.push("\n=== 피어 그룹 실시간 재무 데이터 (Yahoo Finance + KIS 실시간) ===");
  rows.push("※ 아래 피어 기업들의 실제 수치를 Part B 상대가치 분석 표에 그대로 인용하세요. 피어 이름을 'Peer A/B/C/D' 등 플레이스홀더로 쓰지 말고 실제 회사명을 사용하세요.\n");

  // 오늘 날짜(KST) 기반 캐시 키 — 같은 날 모든 분석에서 동일한 피어 데이터 보장
  const today = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })
    .replace(/\. /g, "-").replace(/\.$/, ""); // "2026. 5. 18." → "2026-5-18"

  type PeerResult = {
    line: string; ticker: string; name: string;
    ev_ebitda: number | null; per_trailing: number | null; per_fwd: number | null;
    ev_sales: number | null; pbr: number | null;
  };

  const results = await Promise.allSettled(
    peers.map(async (peer) => {
      // ── 일간 캐시 확인 ─────────────────────────────────────────────────────
      const cacheKey = `peer-fin:${peer.ticker}:${today}`;
      const cached = cache.get<PeerResult>(cacheKey);
      if (cached) {
        console.log(`[peer-fin] 캐시 히트: ${peer.name} (${peer.ticker})`);
        // 캐시된 line은 reason 없이 저장됨 — 현재 분석의 reason이 있으면 삽입
        if (peer.reason) {
          const lines = cached.line.split("\n");
          lines.splice(1, 0, `  선정 이유: ${peer.reason}`);
          return { ...cached, line: lines.join("\n") };
        }
        return cached;
      }

      try {
        // quoteSummary + quote() 병렬 호출 — balanceSheetHistory·earningsTrend 추가로 멀티플 직접 계산 가능
        const [summaryResult, quoteResult] = await Promise.allSettled([
          yahooFinance.quoteSummary(peer.ticker, {
            modules: [
              "defaultKeyStatistics",
              "financialData",
              "summaryDetail",
              "price",
              "incomeStatementHistory",
              "balanceSheetHistory",
              "earningsTrend",
            ] as any,
          }),
          yahooFinance.quote(peer.ticker),
        ]);

        const summary = summaryResult.status === "fulfilled" ? summaryResult.value : {};
        const quote: any = quoteResult.status === "fulfilled" ? quoteResult.value : {};

        const ks: any = (summary as any).defaultKeyStatistics ?? {};
        const fd: any = (summary as any).financialData ?? {};
        const sd: any = (summary as any).summaryDetail ?? {};
        const pr: any = (summary as any).price ?? {};
        const is: any = (summary as any).incomeStatementHistory ?? {};
        const bs: any = (summary as any).balanceSheetHistory ?? {};
        const et: any = (summary as any).earningsTrend ?? {};

        const pct = (v: number | null | undefined) =>
          v != null ? `${(v * 100).toFixed(1)}%` : "N/A";
        const fmt1 = (v: number | null | undefined) =>
          v != null ? v.toFixed(1) : "N/A";
        const fmt2 = (v: number | null | undefined) =>
          v != null ? v.toFixed(2) : "N/A";
        const fmtAbs = (v: number | null | undefined, isKrw: boolean) => {
          if (v == null) return "N/A";
          if (isKrw) return `${(v / 1e8).toFixed(0)}억원`;
          return `${(v / 1e9).toFixed(1)}B`;
        };

        // ── KIS 실시간 데이터 (한국 피어 전용) ───────────────────────────────
        const kisCode = koreanPeerMap.get(peer.ticker);
        const kis = kisCode ? kisQuotes.get(kisCode) : null;

        // 시가총액 & 가격
        const currency = quote.currency ?? pr.currency ?? (peer.ticker.endsWith(".KS") || peer.ticker.endsWith(".KQ") ? "KRW" : "USD");
        const isKrw = currency === "KRW";
        const price = kis?.price ?? quote.regularMarketPrice ?? pr.regularMarketPrice ?? null;
        // KIS 시가총액(억원) → 원 변환 (가장 신뢰도 높음)
        const kisMcap = kis?.mcap != null && kis.mcap > 0 ? kis.mcap * 1e8 : null;
        // Yahoo Finance 시가총액 (원 단위, KRW 종목)
        const yahooMcap = quote.marketCap ?? pr.marketCap ?? sd.marketCap ?? null;
        // price × sharesOutstanding 역산 fallback (KIS 실시간 주가 × KIS 상장주식수)
        const calcMcap = (kis?.price && kis.sharesOutstanding)
          ? kis.price * kis.sharesOutstanding
          : (price && (quote as any).sharesOutstanding)
            ? price * (quote as any).sharesOutstanding
            : null;

        // 네이버 시가총액 fallback — KIS 없는 한국주 중 Yahoo가 부정확한 경우 보정
        let naverMcap: number | null = null;
        if (isKrw && !kisMcap && kisCode) {
          try {
            const naverInteg = await fetch(
              `https://m.stock.naver.com/api/stock/${kisCode}/integration`,
              { headers: NAVER_HEADERS, signal: AbortSignal.timeout(5000) }
            ).then(r => r.ok ? r.json() : null);
            const totalInfos: any[] = naverInteg?.totalInfos ?? [];
            const mcapItem = totalInfos.find((i: any) => i?.code === "marketValue");
            if (mcapItem?.value) {
              const raw = String(mcapItem.value).replace(/[,\s]/g, "");
              const trillM = raw.match(/^([\d.]+)조$/);
              const hundM  = raw.match(/^([\d.]+)억$/);
              if (trillM) naverMcap = parseFloat(trillM[1]) * 1e12;
              else if (hundM) naverMcap = parseFloat(hundM[1]) * 1e8;
              if (naverMcap) console.log(`[peer-data] ${peer.name} 네이버 시총: ${(naverMcap/1e8).toFixed(0)}억원`);
            }
          } catch { /* 네트워크 오류 무시 */ }
        }

        let mcap = kisMcap ?? naverMcap ?? yahooMcap ?? calcMcap;
        // Yahoo가 원 단위인데 너무 작으면(1,000억원 미만) 역산 결과로 교체
        if (isKrw && mcap != null && mcap < 1e11 && calcMcap != null && calcMcap > mcap) {
          console.warn(`[peer-data] ${peer.name} mcap 이상 보정: ${(mcap/1e8).toFixed(0)}억원 → ${(calcMcap/1e8).toFixed(0)}억원 (price×shares 역산)`);
          mcap = calcMcap;
        }
        // 억원 단위로 통일 — AI 프롬프트 표 헤더 "시가총액(억원)"과 단위 일치
        const mcapEokStr = mcap && isKrw
          ? `${Math.round(mcap / 1e8).toLocaleString("ko-KR")}억원`
          : null;
        const mcapStr = mcap
          ? isKrw
            ? `${mcapEokStr}` +
              (mcap >= 1e12 ? ` (≈${(mcap / 1e12).toFixed(2)}조원)` : "")
            : `${(mcap / 1e9).toFixed(1)}B ${currency}`
          : "N/A";

        // ── 원시 재무 데이터 ────────────────────────────────────────────────
        const latestIS = is.incomeStatementHistory?.[0] ?? null;
        const latestBS = bs.balanceSheetStatements?.[0] ?? null;

        const totalRevenue  = fd.totalRevenue  ?? latestIS?.totalRevenue  ?? null;
        const ebitda        = fd.ebitda        ?? null;
        const netIncome     = latestIS?.netIncome     ?? fd.netIncomeToCommon ?? null;
        const opIncome      = latestIS?.operatingIncome ?? null;
        const totalEquity   = latestBS?.totalStockholderEquity ?? latestBS?.stockholdersEquity ?? null;
        const totalDebt     = latestBS?.longTermDebt != null
                              ? (latestBS.longTermDebt + (latestBS.shortLongTermDebt ?? 0) + (latestBS.currentPortionOfLongTermDebt ?? 0))
                              : latestBS?.totalLiab ?? null;
        const cash          = latestBS?.cash ?? latestBS?.cashAndShortTermInvestments ?? latestBS?.cashAndCashEquivalents ?? null;

        // ── 멀티플: 직접 제공 → 계산 폴백 순서 ──────────────────────────
        // PER Fwd: earningsTrend '0y'/'+1y' → quote.forwardPE
        let fwdPE: number | null = ks.forwardPE ?? sd.forwardPE ?? (quote as any).forwardPE ?? null;
        if (fwdPE == null && price != null) {
          const trend1y = et.trend?.find((t: any) => t.period === "+1y");
          const trend0y = et.trend?.find((t: any) => t.period === "0y");
          const fwdEps = trend1y?.earningsEstimate?.avg ?? trend0y?.earningsEstimate?.avg ?? null;
          if (fwdEps != null && fwdEps > 0) fwdPE = price / fwdEps;
        }

        // PER TTM: KIS(한국) → Yahoo → price/EPS → mcap/순이익
        let trailPE: number | null = null;
        if (kis?.per != null && kis.per > 0 && kis.per < 500) {
          trailPE = kis.per;
        } else {
          trailPE = sd.trailingPE ?? ks.trailingPE ?? (quote as any).trailingPE ?? null;
          if (trailPE == null && price != null) {
            const eps = (quote as any).epsTrailingTwelveMonths ?? null;
            if (eps != null && eps > 0) trailPE = price / eps;
          }
          if (trailPE == null && mcap != null && netIncome != null && netIncome > 0) {
            trailPE = mcap / netIncome;
          }
        }

        // PBR: KIS(한국) → Yahoo Finance → Naver Finance → market cap / 자본총계
        let pbr: number | null = null;
        if (kis?.pbr != null && kis.pbr > 0) {
          pbr = kis.pbr;
        } else {
          pbr = ks.priceToBook ?? (quote as any).priceToBook ?? null;
        }
        if (pbr == null) {
          const koreanMatch = peer.ticker.match(/^(\d{6})\.(KS|KQ)$/i);
          if (koreanMatch) {
            try {
              // 1차: /basic (일반 기업 대부분)
              const nb = await fetch(
                `https://m.stock.naver.com/api/stock/${koreanMatch[1]}/basic`,
                { headers: NAVER_HEADERS, signal: AbortSignal.timeout(5000) }
              ).then(r => r.ok ? r.json() : null);
              const rawBasic = nb?.pbr;
              if (rawBasic != null) {
                const n = typeof rawBasic === "number" ? rawBasic : parseFloat(String(rawBasic).replace(/,/g, ""));
                if (!isNaN(n) && n > 0) { pbr = n; }
              }
              // 2차: /integration totalInfos (금융지주·은행 등 /basic PBR 미제공 종목 fallback)
              if (pbr == null) {
                const ni = await fetch(
                  `https://m.stock.naver.com/api/stock/${koreanMatch[1]}/integration`,
                  { headers: NAVER_HEADERS, signal: AbortSignal.timeout(5000) }
                ).then(r => r.ok ? r.json() : null);
                if (ni) {
                  const infoMap: Record<string, string> = {};
                  for (const item of (ni.totalInfos ?? [])) infoMap[item.code] = item.value ?? "";
                  if (infoMap.pbr) {
                    const n = parseFloat(String(infoMap.pbr).replace(/[^0-9.]/g, ""));
                    if (!isNaN(n) && n > 0) { pbr = n; }
                  }
                  // PER(TTM) fallback도 함께 수집 — 금융주는 KIS/Yahoo PER이 null인 경우가 많음
                  if (trailPE == null && infoMap.per) {
                    const n = parseFloat(String(infoMap.per).replace(/[^0-9.]/g, ""));
                    if (!isNaN(n) && n > 0) { trailPE = n; }
                  }
                }
              }
            } catch { /* optional */ }
          }
        }
        if (pbr == null && mcap != null && totalEquity != null && totalEquity > 0) {
          pbr = mcap / totalEquity;
        }

        // EV 계산: enterpriseValue 직접 제공 → market cap + 순부채
        const ev: number | null = ks.enterpriseValue != null
          ? ks.enterpriseValue
          : (quote as any).enterpriseValue != null
            ? (quote as any).enterpriseValue
            : (mcap != null && totalDebt != null && cash != null)
              ? mcap + totalDebt - cash
              : null;

        // EV/EBITDA: 직접 → 계산
        let evEbitda: number | null = ks.enterpriseToEbitda ?? null;
        if (evEbitda == null && ev != null && ebitda != null && ebitda > 0) {
          evEbitda = ev / ebitda;
        }

        // EV/매출
        let evRev: number | null = ks.enterpriseToRevenue ?? null;
        if (evRev == null && ev != null && totalRevenue != null && totalRevenue > 0) {
          evRev = ev / totalRevenue;
        }

        // ── 수익성 ────────────────────────────────────────────────────────
        // KIS ROE는 % 단위(예: 15.3) → 소수(0.153) 변환, Yahoo는 이미 소수 형태
        const kisRoe = kis?.roe != null && !isNaN(kis.roe) ? kis.roe / 100 : null;
        const roe = fd.returnOnEquity
          ?? kisRoe
          ?? (netIncome != null && totalEquity != null && totalEquity > 0 ? netIncome / totalEquity : null);
        const opMargin = fd.operatingMargins
          ?? (opIncome != null && totalRevenue != null && totalRevenue > 0 ? opIncome / totalRevenue : null);
        const revGrowth  = fd.revenueGrowth  ?? null;
        const grossMargin = fd.grossMargins  ?? null;
        const netMargin  = fd.profitMargins
          ?? (netIncome != null && totalRevenue != null && totalRevenue > 0 ? netIncome / totalRevenue : null);

        // 아웃라이어 감지를 위해 원시 배수도 반환
        // ⚠️ line에서 선정 이유(reason)는 제외하고 캐싱 — 분석마다 달라질 수 있음
        const lineBase = [
          `[${peer.name} (${peer.ticker}) — ${peer.exchange ?? ""}]`,
          `  시가총액: ${mcapStr}${price ? ` | 현재가: ${isKrw ? Math.round(price).toLocaleString() : price.toFixed(2)} ${currency}` : ""}`,
          `  PER(Fwd): ${fmt1(fwdPE)}x | PER(TTM): ${fmt1(trailPE)}x | PBR: ${fmt2(pbr)}x | EV/EBITDA: ${fmt1(evEbitda)}x | EV/매출: ${fmt2(evRev)}x`,
          `  ROE: ${pct(roe)} | 영업이익률: ${opm(opMargin)} | 순이익률: ${pct(netMargin)} | 매출총이익률: ${pct(grossMargin)} | 매출성장률(YoY): ${pct(revGrowth)}`,
          `  매출(TTM): ${fmtAbs(totalRevenue, isKrw)} | 영업이익: ${fmtAbs(opIncome, isKrw)} | 순이익: ${fmtAbs(netIncome, isKrw)} | EBITDA: ${fmtAbs(ebitda, isKrw)}`,
          `  자본총계: ${fmtAbs(totalEquity, isKrw)} | 총부채: ${fmtAbs(totalDebt, isKrw)} | 현금: ${fmtAbs(cash, isKrw)}`,
        ].filter(Boolean).join("\n");

        const result: PeerResult = {
          // 캐시 히트 시 reason 줄을 재삽입할 수 있도록 lineBase만 저장
          line: peer.reason
            ? `[${peer.name} (${peer.ticker}) — ${peer.exchange ?? ""}]\n  선정 이유: ${peer.reason}\n` +
              lineBase.split("\n").slice(1).join("\n")
            : lineBase,
          ticker: peer.ticker,
          name: peer.name,
          ev_ebitda: evEbitda,
          per_trailing: trailPE,
          per_fwd: fwdPE,
          ev_sales: evRev,
          pbr,
        };

        // 숫자 데이터가 하나라도 있을 때만 캐시 저장 (실패 결과는 캐싱 안 함)
        if (evEbitda != null || trailPE != null || pbr != null || mcap != null) {
          // lineBase를 캐시에 저장 (reason 제외), 이후 캐시 히트 시 reason 재삽입
          const cachePayload: PeerResult = { ...result, line: lineBase };
          cache.set(cacheKey, cachePayload, TTL.PEER_FINANCIALS);
          console.log(`[peer-fin] 캐시 저장: ${peer.name} (${peer.ticker})`);
        }

        return result;
      } catch (err) {
        return {
          line: `[${peer.name} (${peer.ticker})] 데이터 수집 실패: ${String(err).slice(0, 120)}`,
          ticker: peer.ticker, name: peer.name,
          ev_ebitda: null, per_trailing: null, per_fwd: null, ev_sales: null, pbr: null,
        };
      }
    })
  );

  // ── 서버 사이드 아웃라이어 감지 ──────────────────────────────────────────────
  // 1차: 절대값 상한, 2차: 중간값 2.0배 기준 → AI에 미리 경고 전달
  // "너무 차이나는 것만" 원칙 — 프리미엄 글로벌 기업 정상 배수 보존
  const OUTLIER_CAPS: Record<string, number> = {
    ev_ebitda: 80, per_trailing: 120, per_fwd: 120, ev_sales: 20, pbr: 150,
  };
  type PeerRow = { ticker: string; name: string; ev_ebitda: number | null; per_trailing: number | null; per_fwd: number | null; ev_sales: number | null; pbr: number | null };
  const peerRows: PeerRow[] = results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<any>).value as PeerRow);

  const outlierWarnings: string[] = [];
  const keys = ["ev_ebitda", "per_trailing", "per_fwd", "ev_sales", "pbr"] as const;
  for (const key of keys) {
    // 절대 상한 통과한 유효값 수집
    const valids: Array<{ ticker: string; name: string; v: number }> = [];
    for (const p of peerRows) {
      const v = p[key];
      if (v == null || !isFinite(v) || v <= 0) continue;
      if (v > OUTLIER_CAPS[key]) {
        outlierWarnings.push(`⛔ ${p.name}(${p.ticker}) ${key.toUpperCase().replace("_", "/")} = ${v.toFixed(1)}x → 절대 상한(${OUTLIER_CAPS[key]}x) 초과 이상치 → 중간값 계산 및 적용 배수에서 제외`);
      } else {
        valids.push({ ticker: p.ticker, name: p.name, v });
      }
    }
    if (valids.length < 2) continue;
    const sorted = [...valids].sort((a, b) => a.v - b.v);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 !== 0 ? sorted[mid].v : (sorted[mid - 1].v + sorted[mid].v) / 2;
    for (const { ticker, name, v } of valids) {
      if (v > med * 3.0) {
        outlierWarnings.push(`⚠️ ${name}(${ticker}) ${key.toUpperCase().replace("_", "/")} = ${v.toFixed(1)}x → 피어 중간값(${med.toFixed(1)}x)의 3.0배 초과 이상치 → 중간값 계산에서 제외`);
      }
    }
  }

  if (outlierWarnings.length > 0) {
    rows.push("⚠️ [서버 감지 피어 이상치 — AI는 아래 기업을 해당 배수의 평균/중간값 계산에서 반드시 제외하고 표에 \"(이상치 제외)\" 표기]");
    for (const w of outlierWarnings) rows.push(`  ${w}`);
    rows.push("");
  }

  for (const r of results) {
    if (r.status === "fulfilled") {
      rows.push(r.value.line);
    } else {
      rows.push(`[데이터 오류] ${(r as any).reason}`);
    }
    rows.push("");
  }

  const text = rows.join("\n");
  console.log(`[peer-data] Fetched ${peers.length} peers, ${outlierWarnings.length} outliers detected, ${text.length} chars`);
  return text;
}

export { US_PEER_MAP, selectPeerTickers, fetchPeerFinancials };
export type { PeerEntry };
