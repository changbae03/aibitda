import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p;
}

export function formatCurrency(value: number | undefined | null, currency: string = "KRW", isEn = false) {
  if (value == null) return "N/A";
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
  // KRW: 영문 모드 "KRW X,XXX" / 한국어 모드 "X,XXX원"
  if (isEn) {
    return `KRW ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
  }
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value)}원`;
}

export function isUSTicker(ticker: string | undefined | null): boolean {
  if (!ticker) return false;
  return !ticker.match(/^\d{6}/) && !ticker.match(/\.(KS|KQ)$/i);
}

export function formatPercent(value: number | undefined | null) {
  if (value == null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value / 100);
}
