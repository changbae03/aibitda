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

  // ── 방산·항공우주·조선 ────────────────────────────────────────────────────
  ["aerospace & defense", "DEFENSE"],
  ["defense", "DEFENSE"],
  ["aerospace", "DEFENSE"],
  ["shipbuilding", "DEFENSE"],
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
 * industry 문자열을 업종 코드로 바꾼다. 어디에도 안 걸리면 `{시장}_OTHER`.
 * industry가 비어 있으면 분류할 근거가 없으므로 그대로 OTHER를 돌려준다.
 */
export function classifySector(industry: string | null | undefined, market: Market): string {
  const ind = (industry ?? "").toLowerCase().trim();
  if (!ind) return `${market}_OTHER`;
  for (const [needle, sector] of RULES) {
    if (ind.includes(needle)) return `${market}_${sector}`;
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
