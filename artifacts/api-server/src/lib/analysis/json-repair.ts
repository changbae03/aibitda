// LLM 응답의 깨진 JSON을 복구하는 유틸리티 모음
function extractJsonSafe(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  // 괄호 카운팅으로 첫 JSON 객체 범위 추출 (lastIndexOf보다 안전)
  const startIdx = s.indexOf("{");
  if (startIdx === -1) return null;
  let depth = 0, endIdx = -1, inString = false, escaped = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) return null;
  s = s.slice(startIdx, endIdx + 1);
  // 시도 1: 원본 그대로
  try { return JSON.parse(s); } catch { /* 계속 */ }
  // 시도 2: trailing comma 제거
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch { /* 계속 */ }
  // 시도 3: 문자열 내 실제 개행 → 이스케이프
  try {
    const fixedNl = s.replace(/"((?:[^"\\]|\\.)*)"/gs, (_m: string, inner: string) =>
      `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
    );
    return JSON.parse(fixedNl);
  } catch { /* 계속 */ }
  // 시도 4: 따옴표 없는 % 숫자값 → 문자열로 변환
  try { return JSON.parse(s.replace(/:\s*([+-]?\d+\.?\d*)%/g, (_: string, n: string) => `: "${n}%"`)); } catch { /* 계속 */ }
  // 시도 5: 전체 복합 수정 (개행 이스케이프 + 미따옴표 % + trailing comma)
  try {
    const fixedAll = s
      .replace(/"((?:[^"\\]|\\.)*)"/gs, (_m: string, inner: string) =>
        `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
      )
      .replace(/:\s*([+-]?\d+\.?\d*)%/g, (_: string, n: string) => `: "${n}%"`)
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixedAll);
  } catch { return null; }
}

/**
 * FINAL_VALUATION_DATA JSON을 텍스트에서 robust하게 추출
 * ─ 기존 regex(\{[\s\S]*?\})는 중첩 JSON에서 첫 번째 }에 멈추는 버그 있음
 * ─ 이 함수는 문자열 이스케이프를 인식하는 bracket-counting으로 정확한 범위를 찾음
 */
function extractFvdJson(text: string): Record<string, any> | null {
  const keyIdx = text.indexOf("FINAL_VALUATION_DATA");
  if (keyIdx === -1) return null;
  const start = text.indexOf("{", keyIdx);
  if (start === -1) return null;

  // bracket-counting (문자열 내부 괄호 무시)
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const raw = text.slice(start, i + 1);
        // 시도 1: 원본 그대로
        try { return JSON.parse(raw); } catch { /* 계속 */ }
        // 시도 2: trailing comma + 개행 제거
        try { return JSON.parse(raw.replace(/,\s*([}\]])/g, "$1").replace(/[\r\n\t]/g, " ")); } catch { /* 계속 */ }
        // 시도 3: 마지막 수단 — base 숫자만 직접 추출
        const baseM = raw.match(/"?base"?\s*:\s*([\d.]+)/);
        if (baseM) return { base: parseFloat(baseM[1]) };
        return null;
      }
    }
  }
  return null;
}

/** investment_strategy JSON이 파싱 불가인 경우 복구된 문자열 반환, 이미 정상이면 원본 반환 */
function repairInvestmentStrategyContent(raw: string): string {
  if (!raw) return raw;
  if (extractJsonSafe(raw)) return raw; // 이미 정상
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const startIdx = s.indexOf("{");
  if (startIdx === -1) return raw;
  let depth = 0, endIdx = -1, inString = false, escaped = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) return raw;
  const jsonPart = s.slice(startIdx, endIdx + 1);
  try {
    const fixedAll = jsonPart
      .replace(/"((?:[^"\\]|\\.)*)"/gs, (_m: string, inner: string) =>
        `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
      )
      .replace(/:\s*([+-]?\d+\.?\d*)%/g, (_: string, n: string) => `: "${n}%"`)
      .replace(/,\s*([}\]])/g, "$1");
    JSON.parse(fixedAll); // 검증
    console.log("[repair] investment_strategy JSON 복구 성공");
    return fixedAll;
  } catch {
    console.warn("[repair] investment_strategy JSON 복구 실패 — 원본 저장");
    return raw;
  }
}

export { extractJsonSafe, extractFvdJson, repairInvestmentStrategyContent };
