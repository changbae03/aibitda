/**
 * dart-balance.ts — DART 전체 재무제표에서 순차입금을 뽑는다.
 *
 * 밸류에이션(SOTP·DCF)은 기업가치에서 순차입금을 빼 주주가치를 낸다. 이 값이
 * 틀리면 목표주가가 통째로 흔들린다. 실제로 한화시스템 분석에서 AI가 순부채를
 * 1조 4,500억으로 추정했는데 실제는 7,044억이었다.
 *
 * ⚠️ 한글 계정명으로 매칭하면 안 된다. 회사마다 표기가 다르다:
 *   LongtermBorrowings              → "비유동 차입금 및 사채"(한화시스템) / "차입금"(SK하이닉스)
 *   CurrentPortionOfLongtermBorrowings → "유동성장기부채"(삼성전자) / "유동성장기차입금"(KT&G)
 *   NoncurrentPortionOfNoncurrentBondsIssued → "사채"(삼성전자) / "장기사채"(KT&G)
 * SK하이닉스는 유동·비유동 차입금이 둘 다 "차입금"이라 한글명으로는 구분조차 안 된다.
 *
 * DART 전체 재무제표(fnlttSinglAcntAll)는 IFRS 표준 택소노미 account_id를 함께 준다.
 * 그쪽이 안정적이므로 코드로 매칭하고, 코드가 없을 때만 한글명으로 내려간다.
 *
 * 축약본(fnlttSinglAcnt)에는 차입금·사채 계정이 아예 없다(30계정) — 반드시 전체를 쓸 것.
 */

/** 이자를 지급하는 부채로 볼 IFRS 계정 코드 (접두사 ifrs-full_ 제거 후 비교) */
const DEBT_IDS: readonly string[] = [
  "ShorttermBorrowings",
  "LongtermBorrowings",
  "CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings",
  "CurrentPortionOfLongtermBorrowings",
  "BondsIssued",
  "NoncurrentPortionOfNoncurrentBondsIssued",
  "CurrentLeaseLiabilities",
  "NoncurrentLeaseLiabilities",
  "LeaseLiabilities",
];

/**
 * 현금성 자산으로 볼 IFRS 계정 코드.
 *
 * 현금및현금성자산만 센다. `OtherCurrentFinancialAssets`(기타유동금융자산)를 넣고
 * 싶어지지만 그건 파생상품·대여금까지 담는 잡동사니 계정이라 즉시 현금화를
 * 보장하지 못한다. 현금을 넉넉히 잡으면 순차입금이 줄어 기업가치가 부풀려지므로,
 * 밸류에이션에서는 보수적으로 가는 쪽이 안전하다.
 */
const CASH_IDS: readonly string[] = [
  "CashAndCashEquivalents",
];

/**
 * IFRS 코드가 비어 있는 회사를 위한 한글명 대비책.
 * 코드 매칭이 하나라도 성공하면 이쪽은 쓰지 않는다(중복 합산 방지).
 */
const DEBT_NAME_PATTERNS: readonly RegExp[] = [
  /차입금/, /사채/, /리스부채/,
];

export interface DartRow {
  sj_div?: string;
  account_id?: string;
  account_nm?: string;
  thstrm_amount?: string;
}

export interface NetDebtBreakdown {
  /** 이자부부채 합계 (원) */
  interestBearingDebt: number;
  /** 현금성 자산 합계 (원) */
  cash: number;
  /** 순차입금 = 이자부부채 − 현금. 음수면 순현금 상태 */
  netDebt: number;
  /** 어떤 계정을 합쳤는지 — 검산·감사용 */
  debtItems: Array<{ name: string; amount: number }>;
  cashItems: Array<{ name: string; amount: number }>;
  /** IFRS 코드로 잡았는지, 한글명 대비책으로 잡았는지 */
  matchedBy: "ifrs" | "name" | "none";
}

function amount(raw: unknown): number {
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function shortId(accountId: unknown): string {
  return String(accountId ?? "").replace(/^ifrs-full_/, "").replace(/^dart_/, "");
}

/**
 * 대차대조표 행에서 순차입금을 계산한다.
 *
 * 합산 대상을 로그로 남기는 이유: 계정 구성은 회사마다 달라서 숫자만 보면
 * 어디서 틀렸는지 알 수 없다. 나중에 이상한 값이 나오면 breakdown을 봐야 한다.
 */
export function extractNetDebt(rows: DartRow[]): NetDebtBreakdown | null {
  const bs = rows.filter((r) => r.sj_div === "BS");
  if (bs.length === 0) return null;

  const debtItems: Array<{ name: string; amount: number }> = [];
  const cashItems: Array<{ name: string; amount: number }> = [];

  // ① IFRS 표준 코드 우선
  for (const r of bs) {
    const id = shortId(r.account_id);
    if (!id) continue;
    const v = amount(r.thstrm_amount);
    if (v <= 0) continue;
    if (DEBT_IDS.includes(id)) debtItems.push({ name: String(r.account_nm ?? id), amount: v });
    else if (CASH_IDS.includes(id)) cashItems.push({ name: String(r.account_nm ?? id), amount: v });
  }

  let matchedBy: NetDebtBreakdown["matchedBy"] = debtItems.length > 0 ? "ifrs" : "none";

  // ② 코드로 하나도 못 잡았을 때만 한글명으로 — 둘을 섞으면 중복 합산된다
  if (debtItems.length === 0) {
    for (const r of bs) {
      const nm = String(r.account_nm ?? "").replace(/\s/g, "");
      if (!nm) continue;
      // 자산 쪽 계정이 섞이지 않도록 채권·자산은 제외
      if (/채권|자산/.test(nm)) continue;
      if (DEBT_NAME_PATTERNS.some((p) => p.test(nm))) {
        const v = amount(r.thstrm_amount);
        if (v > 0) debtItems.push({ name: String(r.account_nm), amount: v });
      }
    }
    if (debtItems.length > 0) matchedBy = "name";
  }

  if (cashItems.length === 0) {
    for (const r of bs) {
      const nm = String(r.account_nm ?? "").replace(/\s/g, "");
      if (/^현금및현금성자산/.test(nm)) {
        const v = amount(r.thstrm_amount);
        if (v > 0) cashItems.push({ name: String(r.account_nm), amount: v });
      }
    }
  }

  if (debtItems.length === 0 && cashItems.length === 0) return null;

  const interestBearingDebt = debtItems.reduce((s, x) => s + x.amount, 0);
  const cash = cashItems.reduce((s, x) => s + x.amount, 0);

  return {
    interestBearingDebt,
    cash,
    netDebt: interestBearingDebt - cash,
    debtItems,
    cashItems,
    matchedBy,
  };
}

/** 사람이 읽을 수 있는 요약 — 프롬프트에 넣어 AI가 추정하지 않도록 한다 */
export function formatNetDebt(b: NetDebtBreakdown): string {
  const 억 = (v: number) => `${Math.round(v / 1e8).toLocaleString("ko-KR")}억원`;
  const lines = [
    `이자부부채: ${억(b.interestBearingDebt)} (${b.debtItems.map((d) => `${d.name} ${억(d.amount)}`).join(", ")})`,
    `현금성자산: ${억(b.cash)}`,
    b.netDebt >= 0
      ? `순차입금: ${억(b.netDebt)} (순부채 상태)`
      : `순현금: ${억(-b.netDebt)} (순현금 상태)`,
  ];
  return lines.join("\n");
}
