/**
 * 입력 값 검증 및 정제 유틸리티
 * 경로 탐색(path traversal), SQL injection 방지 등
 */

const TICKER_PATTERN = /^[A-Za-z0-9.\-]{1,20}$/;
const SAFE_PATH_COMPONENT = /^[A-Za-z0-9_\-]{1,60}$/;
const DATE_PATTERN = /^\d{8}$/;

/**
 * 주식 티커 검증 (영숫자, ., - 만 허용, 최대 20자)
 * e.g. "005930", "AAPL", "BRK.B", "BRK-B"
 */
export function validateTicker(ticker: unknown): string | null {
  if (typeof ticker !== "string") return null;
  const t = ticker.trim().toUpperCase();
  if (!TICKER_PATTERN.test(t)) return null;
  return t;
}

/**
 * 파일 경로 컴포넌트로 사용할 안전한 문자열 검증
 * 영숫자, _, - 만 허용
 */
export function sanitizePathComponent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!SAFE_PATH_COMPONENT.test(v)) return null;
  return v;
}

/**
 * YYYYMMDD 형식 날짜 문자열 검증
 */
export function validateDateStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!DATE_PATTERN.test(v)) return null;
  return v;
}

/**
 * 정수 범위 검증
 */
export function validateInt(value: unknown, min = 1, max = 10000): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/**
 * 텍스트 정제: HTML 특수문자 이스케이프
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * URL 검증 (http/https 만 허용)
 */
export function validateUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
