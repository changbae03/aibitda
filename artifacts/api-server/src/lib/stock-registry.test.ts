import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// pool을 가로채 SQL만 검사한다 — 실제 DB에는 접속하지 않는다.
const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
vi.mock("@workspace/db", () => ({ pool: { query: (...a: unknown[]) => query(...(a as [])) } }));

const { ensureStockRegistered } = await import("./stock-registry");

beforeEach(() => query.mockClear());
afterEach(() => vi.restoreAllMocks());

const lastCall = () => query.mock.calls.at(-1) as unknown as [string, unknown[]];

describe("ensureStockRegistered — 시장에 맞는 마스터에 넣는다", () => {
  it("한국 종목은 krx_stocks에 코드로 넣는다", async () => {
    await ensureStockRegistered("005935", "삼성전자우");
    const [sql, params] = lastCall();
    expect(sql).toContain("INSERT INTO krx_stocks");
    expect(params).toEqual(["005935", "삼성전자우"]);
  });

  it("미국 종목은 us_stocks에 티커로 넣는다", async () => {
    await ensureStockRegistered("NTDOY", "Nintendo Co., Ltd.");
    const [sql, params] = lastCall();
    expect(sql).toContain("INSERT INTO us_stocks");
    expect(params).toEqual(["NTDOY", "Nintendo Co., Ltd."]);
  });

  it("거래소 접미사가 붙어 와도 표준형 코드로 넣는다", async () => {
    await ensureStockRegistered("005930.KS", "삼성전자");
    const [, params] = lastCall();
    expect(params[0]).toBe("005930");
  });

  it("소문자 티커는 대문자로 맞춘다", async () => {
    await ensureStockRegistered("ntdoy", "Nintendo");
    const [, params] = lastCall();
    expect(params[0]).toBe("NTDOY");
  });

  it("이미 있으면 덮어쓰지 않는다 (수집된 지표를 지우면 안 됨)", async () => {
    await ensureStockRegistered("NVDA", "NVIDIA");
    const [sql] = lastCall();
    expect(sql).toContain("DO NOTHING");
    expect(sql).not.toContain("DO UPDATE");
  });

  it("이름이 없으면 티커를 이름 자리에 쓴다", async () => {
    await ensureStockRegistered("ABCD");
    const [, params] = lastCall();
    expect(params[1]).toBe("ABCD");
  });

  it("빈 티커는 아무것도 하지 않는다", async () => {
    await ensureStockRegistered("");
    await ensureStockRegistered("   ");
    expect(query).not.toHaveBeenCalled();
  });

  it("DB가 실패해도 예외를 던지지 않는다 (분석 흐름을 막으면 안 됨)", async () => {
    query.mockRejectedValueOnce(new Error("connection refused") as never);
    await expect(ensureStockRegistered("NVDA", "NVIDIA")).resolves.toBeUndefined();
  });
});
