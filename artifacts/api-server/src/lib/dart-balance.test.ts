import { describe, it, expect } from "vitest";
import { extractNetDebt, formatNetDebt, type DartRow } from "./dart-balance";

// 아래 계정명·IFRS 코드·금액은 모두 DART 전체 재무제표(fnlttSinglAcntAll)에서
// 실제로 받아온 값이다. 회사마다 한글 표기가 어떻게 갈리는지 보여주는 표본이다.

const row = (id: string, nm: string, 억: number): DartRow => ({
  sj_div: "BS",
  account_id: id ? `ifrs-full_${id}` : "",
  account_nm: nm,
  thstrm_amount: String(억 * 1e8),
});

describe("IFRS 코드로 이자부부채를 잡는다", () => {
  // 한화시스템 2024 — 차입금이 "유동/비유동 차입금 및 사채"로 표기된다
  it("한화시스템: 유동·비유동 차입금을 모두 합산한다", () => {
    const b = extractNetDebt([
      row("CashAndCashEquivalents", "현금및현금성자산", 1998),
      row("CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings", "유동 차입금 및 사채", 800),
      row("LongtermBorrowings", "비유동 차입금 및 사채", 2493),
      row("OtherCurrentFinancialLiabilities", "기타유동금융부채", 1955), // 이자부부채 아님
    ])!;
    expect(b.matchedBy).toBe("ifrs");
    expect(b.interestBearingDebt).toBe(3293e8);
    expect(b.cash).toBe(1998e8);
    expect(b.netDebt).toBe(1295e8);
  });

  // SK하이닉스는 유동·비유동 차입금이 **둘 다 "차입금"**이다.
  // 한글명으로 매칭하면 첫 번째만 잡혀 절반이 누락된다 — 코드 매칭이 필요한 이유.
  it("SK하이닉스: 이름이 같은 두 차입금을 모두 잡는다", () => {
    const b = extractNetDebt([
      row("CashAndCashEquivalents", "현금및현금성자산", 112051),
      row("CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings", "차입금", 52522),
      row("LongtermBorrowings", "차입금", 174315),
      row("CurrentLeaseLiabilities", "리스부채", 5884),
      row("NoncurrentLeaseLiabilities", "리스부채", 21800),
    ])!;
    expect(b.debtItems).toHaveLength(4);
    expect(b.interestBearingDebt).toBe((52522 + 174315 + 5884 + 21800) * 1e8);
  });

  // 삼성전자는 현금이 부채보다 훨씬 많다 — 순현금 상태가 음수로 나와야 한다
  it("삼성전자: 순현금 상태를 음수로 표현한다", () => {
    const b = extractNetDebt([
      row("CashAndCashEquivalents", "현금및현금성자산", 537056),
      row("CurrentPortionOfLongtermBorrowings", "유동성장기부채", 22073),
      row("NoncurrentPortionOfNoncurrentBondsIssued", "사채", 145),
    ])!;
    expect(b.netDebt).toBeLessThan(0);
    expect(formatNetDebt(b)).toContain("순현금");
  });

  it("KT&G: 표기가 달라도 같은 코드로 잡힌다", () => {
    const b = extractNetDebt([
      row("CashAndCashEquivalents", "현금및현금성자산", 11360),
      row("ShorttermBorrowings", "단기차입금", 2880),
      row("CurrentPortionOfLongtermBorrowings", "유동성장기차입금", 362),
      row("NoncurrentPortionOfNoncurrentBondsIssued", "장기사채", 8080),
      row("CurrentLeaseLiabilities", "유동성리스부채", 209),
      row("NoncurrentLeaseLiabilities", "장기리스부채", 279),
    ])!;
    expect(b.interestBearingDebt).toBe((2880 + 362 + 8080 + 209 + 279) * 1e8);
  });
});

describe("현금은 보수적으로 센다", () => {
  // 기타유동금융자산은 파생상품·대여금까지 담는 계정이라 현금으로 세면
  // 순차입금이 줄어 기업가치가 부풀려진다.
  it("기타유동금융자산을 현금에 넣지 않는다", () => {
    const b = extractNetDebt([
      row("CashAndCashEquivalents", "현금및현금성자산", 1998),
      row("OtherCurrentFinancialAssets", "기타유동금융자산", 1241),
      row("LongtermBorrowings", "차입금", 3000),
    ])!;
    expect(b.cash).toBe(1998e8);
    expect(b.netDebt).toBe(1002e8);
  });
});

describe("IFRS 코드가 없을 때의 대비책", () => {
  it("코드가 비면 한글명으로 잡는다", () => {
    const b = extractNetDebt([
      row("", "현금및현금성자산", 500),
      row("", "단기차입금", 300),
      row("", "장기차입금", 700),
    ])!;
    expect(b.matchedBy).toBe("name");
    expect(b.interestBearingDebt).toBe(1000e8);
  });

  // 코드와 이름을 섞으면 같은 계정을 두 번 더하게 된다
  it("코드로 잡혔으면 이름 매칭을 쓰지 않는다", () => {
    const b = extractNetDebt([
      row("CashAndCashEquivalents", "현금및현금성자산", 500),
      row("LongtermBorrowings", "장기차입금", 700),
    ])!;
    expect(b.matchedBy).toBe("ifrs");
    expect(b.interestBearingDebt).toBe(700e8); // 1400이 아니어야 한다
  });

  it("이름 매칭에서 자산 계정을 배제한다", () => {
    const b = extractNetDebt([
      row("", "현금및현금성자산", 500),
      row("", "리스채권", 900),     // 자산 — 부채로 세면 안 된다
      row("", "단기차입금", 300),
    ])!;
    expect(b.interestBearingDebt).toBe(300e8);
  });
});

describe("빈 입력", () => {
  it("대차대조표 행이 없으면 null", () => {
    expect(extractNetDebt([])).toBeNull();
    expect(extractNetDebt([{ sj_div: "CIS", account_nm: "매출액", thstrm_amount: "100" }])).toBeNull();
  });

  it("관련 계정이 하나도 없으면 null", () => {
    expect(extractNetDebt([row("Inventories", "재고자산", 100)])).toBeNull();
  });
});
