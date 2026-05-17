import { useState } from "react";
import { cn, isUSTicker } from "@/lib/utils";

const BADGE_COLORS = [
  "bg-rose-500/20 text-rose-300",
  "bg-orange-500/20 text-orange-300",
  "bg-amber-500/20 text-amber-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-blue-500/20 text-blue-300",
  "bg-violet-500/20 text-violet-300",
  "bg-pink-500/20 text-pink-300",
];

export function stockLogoUrl(ticker: string): string {
  const raw = ticker.replace(/\.(KS|KQ|KN)$/i, "");
  return isUSTicker(ticker)
    ? `https://file.alphasquare.co.kr/media/images/stock_logo/us/${raw}.png`
    : `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${raw.padStart(6, "0")}.png`;
}

interface StockLogoProps {
  ticker: string;
  companyName: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZE_MAP = {
  xs: "w-7 h-7 rounded-lg text-[13px]",
  sm: "w-8 h-8 rounded-lg text-[14px]",
  md: "w-10 h-10 rounded-xl text-[16px]",
  lg: "w-11 h-11 rounded-xl text-[18px]",
};

export default function StockLogo({ ticker, companyName, size = "md", className }: StockLogoProps) {
  const [err, setErr] = useState(false);
  const initial = companyName.charAt(0) || ticker.charAt(0);
  const colorClass = BADGE_COLORS[(companyName.charCodeAt(0) ?? 0) % BADGE_COLORS.length];
  const sizeClass = SIZE_MAP[size];

  return (
    <div className={cn(
      "flex items-center justify-center shrink-0 font-bold overflow-hidden",
      sizeClass,
      err ? colorClass : "bg-white/5 border border-white/10",
      className,
    )}>
      {!err ? (
        <img
          src={stockLogoUrl(ticker)}
          alt={companyName}
          className="w-full h-full object-contain p-[15%]"
          onError={() => setErr(true)}
        />
      ) : initial}
    </div>
  );
}
