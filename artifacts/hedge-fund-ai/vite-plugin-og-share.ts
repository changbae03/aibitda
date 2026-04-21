import type { Plugin } from "vite";
import { readFileSync } from "fs";
import { resolve } from "path";

const VERDICT_LABEL: Record<string, string> = {
  "Strong Buy": "높은 상승여력",
  "Buy": "상승여력",
  "Hold": "적정 수준",
  "Sell": "하락여지",
  "Strong Sell": "높은 하락여지",
};

function formatPrice(price: number | null, ticker: string | null) {
  if (!price || !ticker) return null;
  const isUS = ticker ? (/^[A-Z]{1,5}$/.test(ticker) || ticker.endsWith(".US")) : false;
  if (isUS) return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `₩${Math.round(price).toLocaleString("ko-KR")}`;
}

async function fetchAnalysis(id: string) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const { rows } = await pool.query(
      `SELECT ticker, company_name, investment_verdict AS verdict, target_price, start_price AS current_price
       FROM analyses WHERE id = $1 AND is_public = 'true' LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

function buildOgHtml(baseHtml: string, data: any, id: string, baseUrl: string): string {
  const company = data.company_name ?? data.ticker ?? "종목";
  const verdictKo = VERDICT_LABEL[data.verdict] ?? data.verdict ?? "";
  const price = formatPrice(data.target_price, data.ticker);

  const title = `애빛다 | ${company} AI 분석 보고서`;
  const desc = [
    `애빛다 AI가 산출한 ${company} 보고서를 확인하세요.`,
    verdictKo && `판정: ${verdictKo}`,
    price && `적정주가 ${price}`,
  ].filter(Boolean).join(" · ");

  const canonical = `${baseUrl}/share/${id}`;

  return baseHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${desc}" />`)
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${canonical}" />`)
    .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${desc}" />`);
}

function makeMiddleware(root: string, base: string, outDir?: string) {
  return async (req: any, res: any, next: any) => {
    const url: string = req.url ?? "";
    const shareMatch = url.match(/^\/share\/(\d+)/);
    if (!shareMatch) return next();

    const id = shareMatch[1];
    try {
      const data = await fetchAnalysis(id);
      if (!data) return next();

      const htmlPath = outDir
        ? resolve(outDir, "index.html")
        : resolve(root, "index.html");
      const html = readFileSync(htmlPath, "utf-8");
      const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
      const proto = req.headers["x-forwarded-proto"] ?? "https";
      const baseUrl = `${proto}://${host}${base.replace(/\/$/, "")}`;

      const modified = buildOgHtml(html, data, id, baseUrl);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(modified);
    } catch (err) {
      console.warn("[og-share] error:", err);
      next();
    }
  };
}

export function ogSharePlugin(): Plugin {
  let root = "";
  let base = "/";
  let outDir = "";

  return {
    name: "og-share",
    configResolved(config) {
      root = config.root;
      base = config.base ?? "/";
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use(makeMiddleware(root, base));
    },
    configurePreviewServer(server) {
      server.middlewares.use(makeMiddleware(root, base, outDir));
    },
  };
}
