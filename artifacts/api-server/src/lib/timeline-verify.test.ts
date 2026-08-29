import { describe, it, expect } from "vitest";
import { verifyTimeline } from "./timeline-verify.js";

const ART = ["2026-08-27", "2026-08-20", "2026-07-14", "2026-03-02"];
const TODAY = "2026-08-27";
const ev = (date: string, event = "사건") => ({ date, event });

describe("타임라인 검산 — 기사에 없는 날짜는 뺀다", () => {
  it("기사와 같은 날짜는 통과", () => {
    const r = verifyTimeline([ev("2026-08-20")], ART, TODAY);
    expect(r.kept).toHaveLength(1);
  });

  it("기사에 없는 날짜는 뺀다 — 지어낸 사건이 여기서 걸린다", () => {
    // 리센느 타임라인에 나왔던 "2025년 3월 데뷔" 같은 항목
    const r = verifyTimeline([ev("2025-03-15", "리센느 데뷔")], ART, TODAY);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0]?.why).toBe("그 날짜의 기사가 없음");
  });

  it("월 단위는 그달 기사가 있으면 통과", () => {
    expect(verifyTimeline([ev("2026-07")], ART, TODAY).kept).toHaveLength(1);
    expect(verifyTimeline([ev("2026-05")], ART, TODAY).kept).toHaveLength(0);
  });

  it("연 단위는 그해 기사가 있으면 통과", () => {
    expect(verifyTimeline([ev("2026")], ART, TODAY).kept).toHaveLength(1);
    expect(verifyTimeline([ev("2025")], ART, TODAY).kept).toHaveLength(0);
  });

  it("미래 날짜는 뺀다", () => {
    const r = verifyTimeline([ev("2026-12-01", "미래 사건")], ART, TODAY);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0]?.why).toBe("미래 날짜");
  });

  it("날짜 형식이 아니면 뺀다", () => {
    const r = verifyTimeline([ev("2026년 봄", "언젠가")], ART, TODAY);
    expect(r.dropped[0]?.why).toBe("날짜 형식 아님");
  });

  it("기사가 하나도 없으면 전부 뺀다 — 검산할 근거가 없다", () => {
    const r = verifyTimeline([ev("2026-08-20"), ev("2026-07-14")], [], TODAY);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toHaveLength(2);
    expect(r.dropped[0]?.why).toBe("근거 기사 없음");
  });

  it("왜 뺐는지 남는다 — 조용히 사라지면 고칠 수 없다", () => {
    const r = verifyTimeline([ev("2025-03-15", "지어낸 사건")], ART, TODAY);
    expect(r.dropped[0]?.event).toBe("지어낸 사건");
  });
});
