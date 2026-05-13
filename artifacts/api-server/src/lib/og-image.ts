import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

let _fontRegular: ArrayBuffer | null | undefined = undefined;
let _fontBold: ArrayBuffer | null | undefined = undefined;
let _resvgUnavailable = false;

async function loadFont(weight: 400 | 700): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&display=swap`;
    const cssRes = await fetch(cssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OGBot/1.0)" },
    });
    const css = await cssRes.text();
    const match = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+\.(ttf|otf))\)/);
    if (!match) return null;
    const fontRes = await fetch(match[1]);
    return fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

async function getFonts(): Promise<{ regular: ArrayBuffer | null; bold: ArrayBuffer | null }> {
  if (_fontRegular === undefined) _fontRegular = await loadFont(400);
  if (_fontBold === undefined) _fontBold = await loadFont(700);
  return { regular: _fontRegular ?? null, bold: _fontBold ?? null };
}

function verdictColor(v: string | null): string {
  switch (v) {
    case "Strong Buy":  return "#22c55e";
    case "Buy":         return "#86efac";
    case "Hold":        return "#fbbf24";
    case "Sell":        return "#f87171";
    case "Strong Sell": return "#ef4444";
    default:            return "#64748b";
  }
}

function verdictLabel(v: string | null): string {
  switch (v) {
    case "Strong Buy":  return "높은 상승여력";
    case "Buy":         return "상승여력";
    case "Hold":        return "적정 수준";
    case "Sell":        return "하락여지";
    case "Strong Sell": return "높은 하락여지";
    default:            return "분석 완료";
  }
}

function fmtKRW(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

function fmtUSD(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface OgImageData {
  companyName: string;
  ticker: string;
  verdict: string | null;
  targetPrice: number | null;
  startPrice: number | null;
  currency: string;
  createdAt: Date | null;
}

function el(type: string, style: Record<string, any>, children: any): any {
  return { type, props: { style, children } };
}

function text(content: string, style: Record<string, any>): any {
  return el("span", { display: "flex", ...style }, content);
}

export async function generateOgPng(data: OgImageData): Promise<Buffer | null> {
  const { companyName, ticker, verdict, targetPrice, startPrice, currency, createdAt } = data;

  const { regular, bold } = await getFonts();
  if (!regular || !bold) return null;

  const isUS = currency === "USD";
  const vColor = verdictColor(verdict);
  const vLabel = verdictLabel(verdict);

  let upsideStr = "";
  let upsideColor = "#22c55e";
  let upsideArrow = "↗";
  if (targetPrice && startPrice && startPrice > 0) {
    const pct = ((targetPrice - startPrice) / startPrice) * 100;
    const sign = pct >= 0 ? "+" : "";
    upsideStr = `${sign}${pct.toFixed(1)}%`;
    upsideColor = pct >= 0 ? "#22c55e" : "#ef4444";
    upsideArrow = pct >= 0 ? "↗" : "↘";
  }

  const targetStr = targetPrice ? (isUS ? fmtUSD(targetPrice) : fmtKRW(targetPrice)) : "";
  const startStr = startPrice ? (isUS ? fmtUSD(startPrice) : fmtKRW(startPrice)) : "";
  const dateStr = createdAt
    ? `${createdAt.getFullYear()}년 ${createdAt.getMonth() + 1}월 ${createdAt.getDate()}일`
    : "";

  const nameFontSize = companyName.length > 10 ? 56 : 68;

  const root = {
    type: "div",
    props: {
      style: {
        width: 1200,
        height: 630,
        background: "linear-gradient(135deg, #0a0e1a 0%, #0d1424 60%, #0f1a2e 100%)",
        display: "flex",
        flexDirection: "column" as const,
        justifyContent: "space-between",
        padding: "52px 64px",
        fontFamily: "Noto Sans KR",
      },
      children: [
        // 메인 콘텐츠
        el("div", { display: "flex", flexDirection: "column" as const, gap: 0 }, [
          // 판단 뱃지
          el("div", { display: "flex", marginBottom: 28 },
            el("div", {
              display: "flex",
              background: vColor + "22",
              border: `1.5px solid ${vColor}`,
              borderRadius: 8,
              padding: "6px 18px",
              color: vColor,
              fontSize: 22,
              fontWeight: 700,
            }, vLabel)
          ),
          // 회사명
          el("div", {
            display: "flex",
            color: "#ffffff",
            fontSize: nameFontSize,
            fontWeight: 700,
            letterSpacing: "-1px",
            lineHeight: 1.1,
            marginBottom: 12,
          }, companyName),
          // 티커 + 마켓
          el("div", {
            display: "flex",
            color: "#94a3b8",
            fontSize: 24,
            fontWeight: 400,
            marginBottom: 36,
          }, `${ticker}  ·  ${isUS ? "NYSE/NASDAQ" : "KRX"}`),
          // 적정주가 + 상승여력
          ...(targetStr ? [
            el("div", { display: "flex", flexDirection: "column" as const, gap: 8 }, [
              el("div", { display: "flex", alignItems: "flex-end" as const, gap: 24 }, [
                el("div", { display: "flex", flexDirection: "column" as const, gap: 4 }, [
                  el("div", { display: "flex", color: "#64748b", fontSize: 18 }, "적정주가"),
                  el("div", {
                    display: "flex",
                    color: "#f8fafc",
                    fontSize: 50,
                    fontWeight: 700,
                    letterSpacing: "-1px",
                  }, targetStr),
                ]),
                ...(upsideStr ? [
                  el("div", {
                    display: "flex",
                    color: upsideColor,
                    fontSize: 38,
                    fontWeight: 700,
                    paddingBottom: 8,
                  }, `${upsideArrow} ${upsideStr}`)
                ] : []),
              ]),
              ...(startStr ? [
                el("div", { display: "flex", color: "#64748b", fontSize: 18 }, `분석 당시 현재가: ${startStr}`)
              ] : []),
            ])
          ] : []),
        ]),
        // 하단 브랜딩
        el("div", {
          display: "flex",
          alignItems: "center" as const,
          justifyContent: "space-between" as const,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 24,
        }, [
          el("div", { display: "flex", alignItems: "center" as const, gap: 14 }, [
            el("div", {
              display: "flex",
              alignItems: "center" as const,
              justifyContent: "center" as const,
              background: "linear-gradient(135deg, #f97316, #fb923c)",
              borderRadius: 10,
              width: 40,
              height: 40,
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
            }, "AI"),
            el("div", { display: "flex", flexDirection: "column" as const, gap: 2 }, [
              el("div", { display: "flex", color: "#f97316", fontSize: 20, fontWeight: 700 }, "애빛다"),
              el("div", { display: "flex", color: "#64748b", fontSize: 15 }, "AI로 기업가치를 밝히다"),
            ]),
          ]),
          el("div", { display: "flex", color: "#475569", fontSize: 18 }, dateStr),
        ]),
      ],
    },
  };

  if (_resvgUnavailable) return null;

  try {
    const svg = await satori(root, {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Noto Sans KR", data: regular, weight: 400, style: "normal" },
        { name: "Noto Sans KR", data: bold, weight: 700, style: "normal" },
      ],
    });

    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
    return Buffer.from(resvg.render().asPng());
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes("is not a function") || msg.includes("is not a constructor")) {
      _resvgUnavailable = true;
      console.warn("[og-image] @resvg/resvg-js 네이티브 바이너리 사용 불가 — OG 이미지 생성 비활성화");
    } else {
      console.error("[og-image] 생성 실패:", msg);
    }
    return null;
  }
}
