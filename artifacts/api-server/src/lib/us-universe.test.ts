import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSecUniverse } from "./us-universe";

// SEC 목록은 미국 종목 마스터의 단일 출처다. 여기가 조용히 실패하면
// 종목 목록이 폴백(손으로 적은 358개)으로 되돌아가므로 계약을 고정해 둔다.
// 실제 네트워크는 부르지 않고 응답 모양만 흉내 낸다.

const secResponse = (rows: Record<string, unknown>) =>
  ({ ok: true, status: 200, json: async () => rows }) as unknown as Response;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchSecUniverse", () => {
  it("SEC 응답을 티커·이름·CIK로 변환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => secResponse({
      "0": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
      "1": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    })));

    const got = await fetchSecUniverse({ force: true });
    expect(got).not.toBeNull();
    expect(got).toHaveLength(2);
    expect(got![0]).toEqual({ ticker: "NVDA", name: "NVIDIA CORP", cik: "0001045810" });
  });

  it("CIK를 10자리로 채운다 (EDGAR 조회 형식)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => secResponse({
      "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    })));
    const got = await fetchSecUniverse({ force: true });
    expect(got![0].cik).toBe("0000320193");
  });

  it("같은 티커가 중복으로 와도 한 번만 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => secResponse({
      "0": { cik_str: 1, ticker: "DUP", title: "First" },
      "1": { cik_str: 2, ticker: "DUP", title: "Second" },
    })));
    const got = await fetchSecUniverse({ force: true });
    expect(got).toHaveLength(1);
    expect(got![0].name).toBe("First");
  });

  it("티커나 이름이 비면 건너뛴다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => secResponse({
      "0": { cik_str: 1, ticker: "", title: "이름만 있음" },
      "1": { cik_str: 2, ticker: "OK", title: "정상" },
      "2": { cik_str: 3, ticker: "NONAME", title: "" },
    })));
    const got = await fetchSecUniverse({ force: true });
    expect(got!.map((e) => e.ticker)).toEqual(["OK"]);
  });

  it("티커를 대문자로 맞춘다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => secResponse({
      "0": { cik_str: 1, ticker: "nvda", title: "NVIDIA" },
    })));
    const got = await fetchSecUniverse({ force: true });
    expect(got![0].ticker).toBe("NVDA");
  });

  it("HTTP 오류면 null을 돌려준다 (호출부가 폴백을 쓰도록)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response));
    expect(await fetchSecUniverse({ force: true })).toBeNull();
  });

  it("네트워크가 끊겨도 던지지 않고 null을 돌려준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await fetchSecUniverse({ force: true })).toBeNull();
  });

  it("응답이 비어 있으면 null을 돌려준다 (빈 목록으로 덮어쓰지 않도록)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => secResponse({})));
    expect(await fetchSecUniverse({ force: true })).toBeNull();
  });
});
