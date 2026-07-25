import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// 통화·퍼센트 포맷터와 티커 판별은 웹·모바일 공용 패키지에서 가져온다
export { formatCurrency, formatPercent, isUSTicker, BRAND_COLOR, BRAND_COLOR_RGB } from "@workspace/shared";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p;
}
