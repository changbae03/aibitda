import { describe, it, expect } from "vitest";
import { formatCurrency, formatPercent, isUSTicker } from "./format";

// 웹·모바일이 함께 쓰는 표기 규칙. 여기가 바뀌면 두 앱의 숫자 표기가 동시에 달라진다.

describe("formatCurrency", () => {
  it("원화는 천 단위 구분과 '원'을 붙인다", () => {
    expect(formatCurrency(249500)).toBe("249,500원");
  });

  it("원화 영문 모드는 KRW 접두사를 쓴다", () => {
    expect(formatCurrency(249500, "KRW", true)).toBe("KRW 249,500");
  });

  it("달러는 통화 기호와 소수 둘째 자리까지", () => {
    expect(formatCurrency(1234.5, "USD")).toBe("$1,234.50");
  });

  it("값이 없으면 N/A", () => {
    expect(formatCurrency(null)).toBe("N/A");
    expect(formatCurrency(undefined)).toBe("N/A");
  });

  it("0은 N/A가 아니라 0으로 표기한다", () => {
    expect(formatCurrency(0)).toBe("0원");
  });
});

describe("formatPercent", () => {
  it("숫자를 퍼센트 표기로 바꾼다 (입력은 이미 백분율 값)", () => {
    expect(formatPercent(12.34)).toBe("12.34%");
  });

  it("음수도 처리한다", () => {
    expect(formatPercent(-5)).toBe("-5%");
  });

  it("값이 없으면 N/A", () => {
    expect(formatPercent(null)).toBe("N/A");
  });

  it("0은 0%로 표기한다", () => {
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("isUSTicker", () => {
  it("6자리 숫자와 한국 거래소 접미사는 미국이 아니다", () => {
    expect(isUSTicker("005930")).toBe(false);
    expect(isUSTicker("005930.KS")).toBe(false);
    expect(isUSTicker("035720.KQ")).toBe(false);
  });

  it("영문 티커는 미국", () => {
    expect(isUSTicker("NVDA")).toBe(true);
  });

  it("빈 값은 미국이 아니다", () => {
    expect(isUSTicker(null)).toBe(false);
    expect(isUSTicker("")).toBe(false);
  });
});
