/**
 * sector-taxonomy.ts — 종목 업종 분류.
 *
 * 업종은 피어 선정과 업종 벤치마크의 기준이므로, 잘못 분류되면 엉뚱한 회사와
 * 비교해 목표가 근거가 흔들린다.
 *
 * 예전 구현은 키워드 몇 개만 훑어서 실제 데이터와 어긋났다. 운영 DB 기준으로
 * 한국 2,800종목 중 1,257개(58%)가 KR_OTHER로 빠졌고, 특히 `Auto Manufacturers`가
 * 어느 키워드에도 안 걸려 현대차·기아가 미분류였다.
 * (코드는 "auto part"·"automotive"·"car"만 봤다.)
 *
 * 그래서 실제 industry 값 119종을 전부 조사해 표로 다시 짰다.
 * industry 문자열의 출처는 야후 파이낸스이며 영문 고정 명칭이다.
 *
 * ⚠️ 순서가 의미를 갖는다 — 부분 문자열로 검사하므로 더 좁은 항목을 위에 둔다.
 *    ("semiconductor equipment"가 "semiconductor"보다 먼저 와야 한다)
 */

export type Market = "KR" | "US";

/** [검사할 부분 문자열, 배정할 업종] — 위에서부터 처음 걸리는 항목을 쓴다 */
type Rule = readonly [string, string];

/**
 * 시장 구분 없이 공통으로 쓰는 규칙. 접두사만 시장별로 붙인다.
 * 접미사 OTHER는 어디에도 안 걸렸을 때.
 */
const RULES: readonly Rule[] = [
  // ── 좁은 항목 먼저 ────────────────────────────────────────────────────────
  ["shell companies", "SHELL"],              // SPAC·페이퍼컴퍼니 — 비교 대상 아님
  ["semiconductor equipment", "SEMICONDUCTOR_EQ"],
  ["semiconductor material", "SEMICONDUCTOR_EQ"],
  ["반도체 장비", "SEMICONDUCTOR_EQ"],
  ["반도체 소재", "SEMICONDUCTOR_EQ"],

  // ── 바이오·의료 ───────────────────────────────────────────────────────────
  ["biotech", "BIOTECH"],
  ["pharmaceutical", "BIOTECH"],
  ["drug manufacturers", "BIOTECH"],
  ["바이오", "BIOTECH"],
  ["제약", "BIOTECH"],
  ["diagnostics & research", "MEDICAL"],
  ["medical devices", "MEDICAL"],
  ["medical instruments", "MEDICAL"],
  ["medical distribution", "MEDICAL"],
  ["medical care", "MEDICAL"],
  ["health information", "MEDICAL"],
  ["healthcare", "MEDICAL"],

  // ── 반도체 ────────────────────────────────────────────────────────────────
  ["semiconductor", "SEMICONDUCTOR"],
  ["반도체", "SEMICONDUCTOR"],
  ["foundry", "SEMICONDUCTOR"],
  ["memory", "SEMICONDUCTOR"],

  // ── 전기·전자 (부품·장비) ─────────────────────────────────────────────────
  ["electronic components", "ELECTRONICS"],
  ["electrical equipment", "ELECTRONICS"],
  ["communication equipment", "ELECTRONICS"],
  ["computer hardware", "ELECTRONICS"],
  ["consumer electronics", "ELECTRONICS"],
  ["scientific & technical instruments", "ELECTRONICS"],
  ["electronics & computer distribution", "ELECTRONICS"],

  // ── IT·소프트웨어 ─────────────────────────────────────────────────────────
  ["software", "IT"],
  ["information technology services", "IT"],
  ["internet", "IT"],
  ["gaming", "IT"],
  ["multimedia", "IT"],
  ["게임", "IT"],
  ["it서비스", "IT"],

  // ── 금융 ─────────────────────────────────────────────────────────────────
  ["asset management", "FINANCIAL"],
  ["capital market", "FINANCIAL"],
  ["credit services", "FINANCIAL"],
  ["banks", "FINANCIAL"],
  ["bank", "FINANCIAL"],
  ["insurance", "FINANCIAL"],
  ["financial", "FINANCIAL"],
  ["금융", "FINANCIAL"],
  ["은행", "FINANCIAL"],
  ["보험", "FINANCIAL"],
  ["증권", "FINANCIAL"],

  // ── 부동산 ───────────────────────────────────────────────────────────────
  ["reit", "REIT"],
  ["real estate", "REIT"],
  ["리츠", "REIT"],

  // ── 자동차 (예전 구현이 Auto Manufacturers를 놓쳤다) ──────────────────────
  ["auto manufacturers", "AUTO"],
  ["auto parts", "AUTO"],
  ["auto & truck dealerships", "AUTO"],
  ["recreational vehicles", "AUTO"],
  ["automotive", "AUTO"],
  ["자동차", "AUTO"],

  // ── 조선 (방산보다 먼저 — 야후가 조선사를 Aerospace & Defense로 주기 때문) ──
  ["shipbuilding", "SHIPBUILDING"],
  ["marine engineering", "SHIPBUILDING"],
  ["조선", "SHIPBUILDING"],

  // ── 방산·항공우주 ────────────────────────────────────────────────────────
  ["aerospace & defense", "DEFENSE"],
  ["defense", "DEFENSE"],
  ["aerospace", "DEFENSE"],
  ["방위", "DEFENSE"],

  // ── 건설 ─────────────────────────────────────────────────────────────────
  ["engineering & construction", "CONSTRUCTION"],
  ["building products", "CONSTRUCTION"],
  ["construc", "CONSTRUCTION"],
  ["건설", "CONSTRUCTION"],
  ["건자재", "CONSTRUCTION"],

  // ── 소재·철강 ────────────────────────────────────────────────────────────
  ["building materials", "MATERIALS"],
  ["steel", "MATERIALS"],
  ["aluminum", "MATERIALS"],
  ["copper", "MATERIALS"],
  ["industrial metals", "MATERIALS"],
  ["packaging & containers", "MATERIALS"],
  ["paper & paper", "MATERIALS"],
  ["lumber & wood", "MATERIALS"],
  ["gold", "MATERIALS"],

  // ── 기계·산업재 ──────────────────────────────────────────────────────────
  ["specialty industrial machinery", "MACHINERY"],
  ["metal fabrication", "MACHINERY"],
  ["tools & accessories", "MACHINERY"],
  ["industrial distribution", "MACHINERY"],
  ["business equipment", "MACHINERY"],
  ["pollution & treatment", "MACHINERY"],
  ["farm & heavy construction machinery", "MACHINERY"],

  // ── 에너지·화학 ──────────────────────────────────────────────────────────
  ["oil & gas", "ENERGY"],
  ["chemical", "ENERGY"],
  ["energy", "ENERGY"],
  ["oil", "ENERGY"],
  ["화학", "ENERGY"],
  ["에너지", "ENERGY"],

  // ── 유틸리티 ─────────────────────────────────────────────────────────────
  ["utilities", "UTILITIES"],
  ["solar", "UTILITIES"],
  ["waste management", "UTILITIES"],

  // ── 운송 ─────────────────────────────────────────────────────────────────
  ["integrated freight", "TRANSPORT"],
  ["marine shipping", "TRANSPORT"],
  ["airlines", "TRANSPORT"],
  ["airports", "TRANSPORT"],
  ["railroads", "TRANSPORT"],
  ["trucking", "TRANSPORT"],

  // ── 음식료 ───────────────────────────────────────────────────────────────
  ["packaged foods", "FOOD"],
  ["confectioners", "FOOD"],
  ["food distribution", "FOOD"],
  ["farm products", "FOOD"],
  ["agricultural inputs", "FOOD"],
  ["beverages", "FOOD"],
  ["grocery stores", "FOOD"],
  ["restaurants", "FOOD"],
  ["tobacco", "FOOD"],

  // ── 미디어·엔터 ──────────────────────────────────────────────────────────
  ["entertainment", "MEDIA"],
  ["advertising", "MEDIA"],
  ["broadcasting", "MEDIA"],
  ["publishing", "MEDIA"],

  // ── 여가·숙박 ────────────────────────────────────────────────────────────
  ["resorts & casinos", "LEISURE"],
  ["lodging", "LEISURE"],
  ["travel services", "LEISURE"],
  ["leisure", "LEISURE"],

  // ── 서비스 ───────────────────────────────────────────────────────────────
  ["specialty business services", "SERVICES"],
  ["education & training", "SERVICES"],
  ["security & protection", "SERVICES"],
  ["consulting services", "SERVICES"],
  ["staffing", "SERVICES"],
  ["rental & leasing", "SERVICES"],

  // ── 통신 ─────────────────────────────────────────────────────────────────
  ["telecom", "TELECOM"],
  ["wireless", "TELECOM"],
  ["communication services", "TELECOM"],
  ["통신", "TELECOM"],

  // ── 지주회사 ─────────────────────────────────────────────────────────────
  ["conglomerates", "HOLDING"],

  // ── 소비재 (마지막 — 넓은 범주라 위에서 안 걸린 것만) ─────────────────────
  ["household & personal products", "CONSUMER"],
  ["apparel", "CONSUMER"],
  ["textile", "CONSUMER"],
  ["furnishings", "CONSUMER"],
  ["footwear", "CONSUMER"],
  ["department stores", "CONSUMER"],
  ["discount stores", "CONSUMER"],
  ["luxury goods", "CONSUMER"],
  ["personal services", "CONSUMER"],
  ["consumer", "CONSUMER"],
  ["retail", "CONSUMER"],
  ["소비재", "CONSUMER"],
] as const;

/**
 * 한국 표준산업분류(KIS search-stock-info) 기반 규칙.
 *
 * 야후 industry는 한국 종목에서 틀릴 때가 있다. 대표적으로 삼성중공업·한화오션·
 * HD현대중공업이 모두 "Aerospace & Defense"로 와서 방산으로 분류됐다.
 * KIS는 "선박 및 보트 건조업"으로 정확히 준다.
 *
 * 반대로 KIS가 약한 영역도 있다 — 지주회사를 전부 "기타 금융업"으로 뭉뚱그린다
 * (SK스퀘어·SK·HD한국조선해양). 그런 모호한 값은 AMBIGUOUS_KIS에 넣어 야후로 넘긴다.
 */
/**
 * 야후 결과를 **덮어쓰는** 규칙. 야후가 확실히 틀린다고 검증된 것만 넣는다.
 *
 * 조선이 유일한 사례다 — 야후는 삼성중공업·한화오션·HD현대중공업을 모두
 * "Aerospace & Defense"로 준다. 방산과 조선은 사업도 밸류에이션도 다르다.
 *
 * ⚠️ 여기에 함부로 추가하지 말 것. KIS 표준산업분류는 **법인 등록 업종**이라
 * 실제 사업과 어긋나는 경우가 많다. 실제로 넓게 적용해봤더니
 * 두산(지주회사)이 "전자부품 제조업"으로, 한화시스템(방산전자)도 마찬가지로
 * 잘못 옮겨졌다. 추가 전에 반드시 실제 종목으로 드라이런할 것.
 */
const KIS_OVERRIDE: readonly Rule[] = [
  ["선박 및 보트 건조업", "SHIPBUILDING"],
] as const;

/**
 * 야후가 분류하지 못했을 때(OTHER)만 쓰는 보조 규칙.
 * 덮어쓰지 않으므로 위 목록보다 느슨해도 안전하다.
 */
const KIS_FALLBACK: readonly Rule[] = [
  ["반도체 제조업", "SEMICONDUCTOR"],
  ["자동차용 엔진", "AUTO"],
  ["자동차 부품", "AUTO"],
  ["1차 철강", "MATERIALS"],
  ["1차 비철금속", "MATERIALS"],
  ["석유 정제품", "ENERGY"],
  ["기초화학물질", "ENERGY"],
  ["전기통신업", "TELECOM"],
  ["해상 운송업", "TRANSPORT"],
  ["항공 여객 운송업", "TRANSPORT"],
  ["은행 및 저축기관", "FINANCIAL"],
  ["보험업", "FINANCIAL"],
  ["금융지원 서비스업", "FINANCIAL"],
  ["무기 및 총포탄", "DEFENSE"],
  ["항공기", "DEFENSE"],
  ["전자부품 제조업", "ELECTRONICS"],
  ["통신 및 방송 장비", "ELECTRONICS"],
  ["일차전지 및 축전지", "ELECTRONICS"],
  ["전동기, 발전기", "ELECTRONICS"],
  ["기초 의약물질", "BIOTECH"],
  ["의약품 제조업", "BIOTECH"],
  ["자료처리, 호스팅", "IT"],
  ["소프트웨어 개발", "IT"],
  ["담배 제조업", "FOOD"],
  ["건축물 건설", "CONSTRUCTION"],
  ["토목 건설", "CONSTRUCTION"],
] as const;

/**
 * KIS가 실체를 못 담는 값들. 보조 규칙에서도 쓰지 않는다.
 * - "기타 금융업": 지주회사를 전부 여기로 보낸다(SK스퀘어는 반도체 지주다)
 * - "특수/일반 목적용 기계": 반도체 장비 업체도 여기로 온다(한미반도체)
 * - "기타 전문 도매업": 삼성물산(건설)이 여기로 온다
 */
const AMBIGUOUS_KIS: readonly string[] = [
  "기타 금융업",
  "기타 전문 도매업",
  "특수 목적용 기계",
  "일반 목적용 기계",
  "기타 서비스업",
  "그외 기타",
];

/**
 * KIS 분류를 업종 근거로 써도 되는가.
 *
 * 야후가 업종을 비운 종목에서 KIS 값을 대신 쓸 때 반드시 통과시킬 것. 모호한 값을
 * 그대로 넘기면 **야후용 규칙표에 잘못 걸린다** — "기타 금융업"이 배터리 소재 지주회사
 * 에코프로를 KR_FINANCIAL로 보내는 식이다. 판정 규칙을 새로 만들지 말고 이 함수를 쓸 것.
 */
export function isUsableKisIndustry(kis: string | null | undefined): boolean {
  const s = (kis ?? "").trim();
  return s.length > 0 && !AMBIGUOUS_KIS.some((a) => s.includes(a));
}

/**
 * industry 문자열을 업종 코드로 바꾼다. 어디에도 안 걸리면 `{시장}_OTHER`.
 * industry가 비어 있으면 분류할 근거가 없으므로 그대로 OTHER를 돌려준다.
 *
 * kisIndustry(한국 표준산업분류)를 주면 그쪽을 먼저 본다 — 단 모호한 값은 건너뛴다.
 */
export function classifySector(
  industry: string | null | undefined,
  market: Market,
  kisIndustry?: string | null,
): string {
  const kis = (kisIndustry ?? "").trim();
  const kisUsable = kis.length > 0 && !AMBIGUOUS_KIS.some((a) => kis.includes(a));

  // ① 야후가 확실히 틀리는 경우만 먼저 덮어쓴다 (지금은 조선뿐)
  if (kisUsable) {
    for (const [needle, sector] of KIS_OVERRIDE) {
      if (kis.includes(needle)) return `${market}_${sector}`;
    }
  }

  // ② 야후 분류
  const ind = (industry ?? "").toLowerCase().trim();
  for (const [needle, sector] of RULES) {
    if (ind && ind.includes(needle)) return `${market}_${sector}`;
  }

  // ③ 야후가 못 잡았을 때만 KIS로 메운다 — 덮어쓰지 않으므로 손해가 없다
  if (kisUsable) {
    for (const [needle, sector] of KIS_FALLBACK) {
      if (kis.includes(needle)) return `${market}_${sector}`;
    }
  }

  return `${market}_OTHER`;
}

/**
 * 피어 비교에 쓸 수 없는 업종인지. SPAC·페이퍼컴퍼니는 사업 실체가 없어
 * 멀티플 비교가 의미 없고, 미분류는 어떤 회사가 섞일지 알 수 없다.
 */
export function isComparableSector(sector: string | null | undefined): boolean {
  if (!sector) return false;
  return !sector.endsWith("_OTHER") && !sector.endsWith("_SHELL");
}
