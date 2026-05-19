/**
 * SOTP 자회사 시총 자동 주입 시스템
 *
 * 지주사·복합기업 분석 시 핵심 상장 자회사의 시가총액을 KIS로 실시간 조회해
 * AI 컨텍스트에 주입합니다.
 *
 * 문제 배경:
 *   - AI가 상장 자회사 시총을 모르면 배수(EV/EBITDA) 임의 적용 → SOTP 결과 왜곡
 *   - 예: SK하이닉스 시총 없이 SK스퀘어 분석 → 결과 천차만별
 *   - 이 모듈이 자회사 시총을 먼저 조회해서 컨텍스트에 박아주면 AI가 올바른 계산 수행
 */

import { fetchKISStockQuotes } from "./kis-client.js";

interface Subsidiary {
  name: string;
  ticker: string;
  stakePercent: number;
  isListed: true;
}

interface UnlistedSubsidiary {
  name: string;
  stakePercent: number;
  isListed: false;
  businessDesc: string;
  suggestedMultiple: string;
}

type SubsidiaryEntry = Subsidiary | UnlistedSubsidiary;

/**
 * 주요 SOTP 대상 기업 → 자회사 매핑 테이블
 * ticker: 6자리 KRX 코드 (KIS API 기준)
 * stakePercent: 지분율(%)
 */
const SOTP_SUBSIDIARY_MAP: Record<string, SubsidiaryEntry[]> = {
  // ── SK스퀘어 (402340) ────────────────────────────────────────────────────
  "402340": [
    { name: "SK하이닉스", ticker: "000660", stakePercent: 20.1, isListed: true },
    { name: "11번가", stakePercent: 80.0, isListed: false, businessDesc: "이커머스 플랫폼", suggestedMultiple: "EV/Sales 0.5~1.5x (적자 이커머스)" },
    { name: "원스토어", stakePercent: 50.8, isListed: false, businessDesc: "앱스토어", suggestedMultiple: "EV/Sales 2~4x (플랫폼 소형)" },
  ],

  // ── SK㈜ (034730) ─────────────────────────────────────────────────────────
  "034730": [
    { name: "SK텔레콤", ticker: "017670", stakePercent: 30.0, isListed: true },
    { name: "SK이노베이션", ticker: "096770", stakePercent: 33.4, isListed: true },
    { name: "SKC", ticker: "011790", stakePercent: 39.9, isListed: true },
    { name: "SK스퀘어", ticker: "402340", stakePercent: 31.8, isListed: true },
    { name: "SK에코플랜트", stakePercent: 44.5, isListed: false, businessDesc: "환경·친환경 에너지", suggestedMultiple: "EV/EBITDA 6~9x (건설·환경 피어)" },
  ],

  // ── 삼성물산 (028260) ─────────────────────────────────────────────────────
  "028260": [
    { name: "삼성전자", ticker: "005930", stakePercent: 4.0, isListed: true },
    { name: "삼성바이오로직스", ticker: "207940", stakePercent: 43.4, isListed: true },
    { name: "삼성SDS", ticker: "018260", stakePercent: 17.1, isListed: true },
    { name: "삼성엔지니어링", ticker: "028050", stakePercent: 7.3, isListed: true },
    { name: "삼성생명", ticker: "032830", stakePercent: 19.3, isListed: true },
  ],

  // ── 한화㈜ (000880) ───────────────────────────────────────────────────────
  "000880": [
    { name: "한화에어로스페이스", ticker: "012450", stakePercent: 32.6, isListed: true },
    { name: "한화솔루션", ticker: "009830", stakePercent: 36.1, isListed: true },
    { name: "한화생명", ticker: "088350", stakePercent: 33.5, isListed: true },
    { name: "한화시스템", ticker: "272210", stakePercent: 39.7, isListed: true },
  ],

  // ── GS㈜ (078930) ─────────────────────────────────────────────────────────
  "078930": [
    { name: "GS리테일", ticker: "007070", stakePercent: 30.7, isListed: true },
    { name: "GS건설", ticker: "006360", stakePercent: 35.5, isListed: true },
    { name: "GS칼텍스", stakePercent: 50.0, isListed: false, businessDesc: "정유·석유화학", suggestedMultiple: "EV/EBITDA 4~6x (정유 피어: S-Oil, SK이노베이션 참고)" },
  ],

  // ── GS홀딩스 (000800) — GS㈜와 동일 구조 ──────────────────────────────
  "000800": [
    { name: "GS리테일", ticker: "007070", stakePercent: 30.7, isListed: true },
    { name: "GS건설", ticker: "006360", stakePercent: 35.5, isListed: true },
    { name: "GS칼텍스", stakePercent: 50.0, isListed: false, businessDesc: "정유·석유화학", suggestedMultiple: "EV/EBITDA 4~6x (정유 피어)" },
  ],

  // ── CJ㈜ (001040) ─────────────────────────────────────────────────────────
  "001040": [
    { name: "CJ제일제당", ticker: "097950", stakePercent: 36.6, isListed: true },
    { name: "CJ대한통운", ticker: "000120", stakePercent: 38.9, isListed: true },
    { name: "CJ ENM", ticker: "035760", stakePercent: 43.5, isListed: true },
    { name: "CJ올리브영", stakePercent: 53.0, isListed: false, businessDesc: "헬스앤뷰티 유통", suggestedMultiple: "EV/EBITDA 15~20x (고성장 뷰티유통, 상장전 멀티플)" },
  ],

  // ── HD현대 (267250) ───────────────────────────────────────────────────────
  "267250": [
    { name: "HD한국조선해양", ticker: "009540", stakePercent: 34.6, isListed: true },
    { name: "HD현대인프라코어", ticker: "042670", stakePercent: 32.2, isListed: true },
    { name: "HD현대건설기계", ticker: "267270", stakePercent: 46.1, isListed: true },
    { name: "HD현대일렉트릭", ticker: "267260", stakePercent: 49.4, isListed: true },
    { name: "HD현대마린솔루션", ticker: "443060", stakePercent: 44.0, isListed: true },
  ],

  // ── 두산㈜ (000150) ───────────────────────────────────────────────────────
  "000150": [
    { name: "두산에너빌리티", ticker: "034020", stakePercent: 38.5, isListed: true },
    { name: "두산로보틱스", ticker: "454910", stakePercent: 46.8, isListed: true },
    { name: "두산밥캣", ticker: "241560", stakePercent: 46.1, isListed: true },
  ],

  // ── 효성㈜ (004800) ───────────────────────────────────────────────────────
  "004800": [
    { name: "효성중공업", ticker: "298040", stakePercent: 32.1, isListed: true },
    { name: "효성티앤씨", ticker: "298050", stakePercent: 32.1, isListed: true },
    { name: "효성첨단소재", ticker: "298060", stakePercent: 32.1, isListed: true },
    { name: "효성화학", ticker: "298000", stakePercent: 32.1, isListed: true },
  ],

  // ── 포스코홀딩스 (005490) ─────────────────────────────────────────────────
  "005490": [
    { name: "포스코퓨처엠", ticker: "003670", stakePercent: 62.6, isListed: true },
    { name: "포스코인터내셔널", ticker: "047050", stakePercent: 62.6, isListed: true },
    { name: "POSCO DX", ticker: "022100", stakePercent: 61.7, isListed: true },
    { name: "포스코스틸리온", stakePercent: 100.0, isListed: false, businessDesc: "도금강판·컬러강판", suggestedMultiple: "EV/EBITDA 5~7x (특수강판 가공)" },
  ],

  // ── LG㈜ (003550) ─────────────────────────────────────────────────────────
  "003550": [
    { name: "LG전자", ticker: "066570", stakePercent: 33.7, isListed: true },
    { name: "LG화학", ticker: "051910", stakePercent: 33.4, isListed: true },
    { name: "LG에너지솔루션", ticker: "373220", stakePercent: 81.8, isListed: true },
    { name: "LG유플러스", ticker: "032640", stakePercent: 36.1, isListed: true },
    { name: "LG디스플레이", ticker: "034220", stakePercent: 37.9, isListed: true },
  ],

  // ── 롯데지주 (004990) ─────────────────────────────────────────────────────
  "004990": [
    { name: "롯데쇼핑", ticker: "023530", stakePercent: 52.7, isListed: true },
    { name: "롯데케미칼", ticker: "011170", stakePercent: 53.9, isListed: true },
    { name: "롯데칠성음료", ticker: "005300", stakePercent: 39.5, isListed: true },
    { name: "롯데웰푸드", ticker: "280360", stakePercent: 53.0, isListed: true },
    { name: "롯데건설", stakePercent: 100.0, isListed: false, businessDesc: "건설·주택사업", suggestedMultiple: "EV/EBITDA 5~8x (건설 피어)" },
  ],

  // ── SK스퀘어 별칭: 한국금융지주 (071050) ─────────────────────────────────
  "071050": [
    { name: "한국투자증권", stakePercent: 100.0, isListed: false, businessDesc: "증권업 (IB+리테일)", suggestedMultiple: "PBR 0.8~1.2x (증권사 피어: 미래에셋·NH투자증권 참고)" },
    { name: "한국투자신탁운용", stakePercent: 100.0, isListed: false, businessDesc: "자산운용", suggestedMultiple: "PER 10~15x (자산운용사 피어)" },
    { name: "카카오뱅크", ticker: "323410", stakePercent: 27.1, isListed: true },
  ],

  // ── 현대지에프홀딩스 (005440) ─────────────────────────────────────────────
  "005440": [
    { name: "현대백화점", ticker: "069960", stakePercent: 22.3, isListed: true },
    { name: "현대그린푸드", ticker: "453340", stakePercent: 80.0, isListed: true },
    { name: "현대홈쇼핑", ticker: "057050", stakePercent: 23.4, isListed: true },
  ],
};

/**
 * SOTP 자회사 시총 컨텍스트 생성
 *
 * @param krxCode 6자리 모회사 KRX 코드
 * @returns AI 주입용 컨텍스트 문자열 또는 null
 */
export async function buildSOTPSubsidiaryContext(krxCode: string): Promise<string | null> {
  const clean = krxCode.replace(/\.(KS|KQ)$/i, "").replace(/[^0-9]/g, "");
  const subsidiaries = SOTP_SUBSIDIARY_MAP[clean];
  if (!subsidiaries || subsidiaries.length === 0) return null;

  const listed   = subsidiaries.filter((s): s is Subsidiary => s.isListed);
  const unlisted = subsidiaries.filter((s): s is UnlistedSubsidiary => !s.isListed);

  // 상장 자회사 시총을 KIS로 일괄 조회
  const listedTickers = listed.map(s => s.ticker);
  let quotesMap: Map<string, { mcap: number | null; price: number }> = new Map();

  if (listedTickers.length > 0) {
    try {
      const kisMap = await fetchKISStockQuotes(listedTickers);
      for (const [ticker, quote] of kisMap) {
        quotesMap.set(ticker, {
          mcap: quote.mcap,
          price: quote.price,
        });
      }
    } catch {
      // KIS 실패해도 컨텍스트 생성 계속 (미확인 표시)
    }
  }

  const lines: string[] = [
    `\n[🏗️ SOTP 자회사 시총 데이터 — KIS 실시간 조회]`,
    `⚠️ 아래 데이터를 SOTP 계산에 반드시 사용하세요. 배수 추정으로 대체하는 것을 금지합니다.`,
    ``,
    `【상장 자회사 — 시가총액 × 지분율 = 귀속가치 (배수 적용 금지)】`,
  ];

  let hasAnyData = false;

  for (const sub of listed) {
    const q = quotesMap.get(sub.ticker);
    if (q?.mcap != null) {
      const mcapEok = q.mcap; // KIS mcap은 이미 억원 단위
      const attributedEok = Math.round(mcapEok * sub.stakePercent / 100);
      lines.push(
        `• ${sub.name} (${sub.ticker}): 시총 ${mcapEok.toLocaleString("ko-KR")}억원 × 지분 ${sub.stakePercent}% = 귀속가치 **${attributedEok.toLocaleString("ko-KR")}억원** (현재가 ${q.price.toLocaleString("ko-KR")}원)`
      );
      hasAnyData = true;
    } else {
      lines.push(`• ${sub.name} (${sub.ticker}): 시총 조회 실패 — KIS 데이터 없음. 지분율 ${sub.stakePercent}%`);
    }
  }

  if (unlisted.length > 0) {
    lines.push(``, `【비상장 자회사 — 추정 배수 적용 (출처·근거 명시 의무)】`);
    for (const sub of unlisted) {
      lines.push(`• ${sub.name}: 지분 ${sub.stakePercent}% | 사업: ${sub.businessDesc}`);
      lines.push(`  → 권장 배수: ${sub.suggestedMultiple}`);
    }
  }

  if (!hasAnyData && unlisted.length === 0) return null;

  lines.push(``);
  lines.push(`⭐ SOTP 계산 원칙:`);
  lines.push(`  1. 상장 자회사: 반드시 위 시총 × 지분율 사용 (EV/EBITDA 배수 적용 절대 금지)`);
  lines.push(`  2. 비상장 자회사: 권장 배수 범위 내에서 근거와 함께 적용`);
  lines.push(`  3. 순현금/순부채: DART 재무제표 현금 − 금융부채 (반드시 차감)`);
  lines.push(`  4. 지주할인 후 주당 NAV = SOTP 합계 ÷ KIS 상장주식수`);

  return lines.join("\n");
}

/**
 * 해당 티커가 SOTP 자회사 매핑 대상인지 확인
 */
export function hasSOTPSubsidiaryData(krxCode: string): boolean {
  const clean = krxCode.replace(/\.(KS|KQ)$/i, "").replace(/[^0-9]/g, "");
  return clean in SOTP_SUBSIDIARY_MAP;
}
