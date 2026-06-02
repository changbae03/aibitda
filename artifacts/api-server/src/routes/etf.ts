import { Router } from "express";
import {
  ALL_ETFS,
  searchEtf,
  getEtfHoldings,
  getStockExposure,
  getSectorRotation,
  getTimingSignals,
  getUnifiedSignals,
  getMomentumAnalysis,
  miraePreFetchAllHoldings,
  trackHoldingsChanges,
} from "../lib/etf-analyzer.js";
import { getCachedTigerEtfs } from "../lib/tiger-etf-scraper.js";
import { getStatus } from "../lib/lstm-predictor.js";
import { GoogleGenAI } from "@google/genai";
import YahooFinance from "yahoo-finance2";

const router = Router();

const cache = new Map<string, { data: any; ts: number }>();
const TTL = { rotation: 30 * 60_000, signals: 30 * 60_000 };

function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data as T);
  return fn().then(data => { cache.set(key, { data, ts: Date.now() }); return data; });
}

// GET /api/etf/list
router.get("/etf/list", (_req, res) => {
  const tigerEtfs = getCachedTigerEtfs() as any[];
  const existingCodes = new Set(ALL_ETFS.map(e => e.code));
  const merged = [...ALL_ETFS, ...tigerEtfs.filter(e => !existingCodes.has(e.code))];
  res.json(merged);
});

// GET /api/etf/search?q=
router.get("/etf/search", (req, res) => {
  const q = String(req.query.q ?? "");
  const tigerEtfs = getCachedTigerEtfs() as any[];
  res.json(searchEtf(q, tigerEtfs));
});

// GET /api/etf/sector-rotation
router.get("/etf/sector-rotation", async (_req, res) => {
  try {
    const data = await cached("sector-rotation", TTL.rotation, getSectorRotation);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// GET /api/etf/timing-signals
router.get("/etf/timing-signals", async (_req, res) => {
  try {
    const data = await cached("timing-signals", TTL.signals, getTimingSignals);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// GET /api/etf/unified-signals
router.get("/etf/unified-signals", async (_req, res) => {
  try {
    // AI 예측 방향 추출 (없으면 neutral)
    const status = getStatus();
    const toAiSig = (idx: any) => ({
      direction: (idx?.agreementSignal ?? "neutral") as "up" | "down" | "neutral",
      strength:  idx?.agreementStrength ?? 0,
    });
    const aiSignals = {
      kospi:  toAiSig(status.kospi),
      nasdaq: toAiSig(status.nasdaq),
    };

    const cacheKey = `unified-signals:${aiSignals.kospi.direction}:${aiSignals.nasdaq.direction}`;
    const data = await cached(cacheKey, TTL.signals, () => getUnifiedSignals(aiSignals));

    res.json({
      signals:   data,
      aiContext: {
        kospi:  aiSignals.kospi,
        nasdaq: aiSignals.nasdaq,
        ready:  status.ready ?? false,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// GET /api/etf/:code/holdings
router.get("/etf/:code/holdings", async (req, res) => {
  try {
    const code = req.params.code.replace(/[^0-9A-Za-z]/g, "").slice(0, 10);
    // TIGER 스크래핑분의 isuCd를 주입하여 KRX 조회 가능하게
    const tigerEtfs = getCachedTigerEtfs();
    const tigerEtf  = tigerEtfs.find((e: any) => e.code === code);
    const { holdings, source, dataDate } = await getEtfHoldings(code, tigerEtf?.isuCd);
    const etf = ALL_ETFS.find(e => e.code === code) ?? (tigerEtf as any) ?? null;
    // 리밸런싱 추적 (참고용 정적 데이터는 제외)
    const changes = source !== "reference"
      ? await trackHoldingsChanges(code, holdings, dataDate)
      : null;
    res.json({ etf, holdings, source, dataDate, changes });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// GET /api/etf/stock/:query/exposure
router.get("/etf/stock/:query/exposure", async (req, res) => {
  try {
    const query = decodeURIComponent(req.params.query);
    const data  = await getStockExposure(query);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// POST /api/etf/prefetch-holdings
// 미래에셋 세션 1개로 모든 TIGER ETF holdings를 일괄 사전로딩
router.post("/etf/prefetch-holdings", async (_req, res) => {
  try {
    const tigerEtfs = getCachedTigerEtfs() as any[];
    // MAJOR_ETFS + tiger scraper에서 미래에셋 isuCd가 있는 것만
    const miraeIsuCds = [
      ...ALL_ETFS.filter(e => e.isuCd.startsWith("KR7") && e.issuer === "미래에셋").map(e => e.isuCd),
      ...tigerEtfs.filter(e => e.isuCd?.startsWith("KR7")).map((e: any) => e.isuCd),
    ];
    // 중복 제거
    const unique = [...new Set(miraeIsuCds)];
    const result = await miraePreFetchAllHoldings(unique);
    res.json({ ...result, total: unique.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

/** 네이버 증권에서 지수 최근 가격 취득 (모델 학습 여부 무관) */
async function naverIndexPrices(code: "KOSPI" | "KOSDAQ", n = 20) {
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/index/${code}/price`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const rows: any[] = await res.json();
    const sorted   = rows.slice(0, n).reverse();
    const sparkline = sorted.map((r: any) => +String(r.closePrice).replace(/,/g, ""));
    const latest    = sparkline.at(-1) ?? null;
    const prev      = sparkline.at(-2) ?? null;
    const change1d  = latest && prev ? +((latest - prev) / prev * 100).toFixed(2) : null;
    return { sparkline, latestPrice: latest, change1d };
  } catch { return null; }
}

// GET /api/etf/momentum-analysis
router.get("/etf/momentum-analysis", async (_req, res) => {
  try {
    const [data, status, naverK, naverKQ] = await Promise.all([
      cached("momentum-analysis", 30 * 60_000, getMomentumAnalysis),
      Promise.resolve(getStatus()),
      naverIndexPrices("KOSPI",  20),
      naverIndexPrices("KOSDAQ", 20),
    ]);

    const toOutlook = (idx: any, name: string, symbol: string, naver: typeof naverK) => {
      // 스파크라인·현재가는 Naver API 우선, 없으면 LSTM historical 폴백
      const hist: Array<{ date: string; value: number }> = idx?.historical ?? [];
      const fallback = hist.slice(-20).map((p: { date: string; value: number }) => p.value);
      const sparkline    = naver?.sparkline?.length    ? naver.sparkline    : fallback;
      const latestPrice  = naver?.latestPrice          ?? hist.at(-1)?.value ?? null;
      const change1d     = naver?.change1d             ?? null;
      return {
        name,
        symbol,
        trend:             idx?.trend             ?? "neutral",
        predictedReturn3d: idx?.predictedReturn3d ?? null,
        agreementSignal:   idx?.agreementSignal   ?? "neutral",
        agreementStrength: idx?.agreementStrength ?? 0,
        curVol20:          idx?.curVol20          ?? null,
        wfDirAcc:          idx?.wfDirAcc          ?? null,
        gbdtDirAcc:        idx?.gbdtDirAcc        ?? null,
        latestPrice,
        change1d,
        sparkline,
      };
    };

    res.json({
      ...data,
      indexOutlook: {
        kospi:  toOutlook(status.kospi,  "KOSPI",  "^KS11", naverK),
        kosdaq: toOutlook(status.kosdaq, "KOSDAQ", "^KQ11", naverKQ),
        ready:  status.ready ?? false,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "error" });
  }
});

// POST /api/etf/:code/report — AI 분석 리포트 생성
router.post("/etf/:code/report", async (req, res) => {
  try {
    const code = req.params.code.replace(/[^0-9A-Za-z]/g, "").slice(0, 10);
    const tigerEtfs = getCachedTigerEtfs() as any[];
    const tigerEtf  = tigerEtfs.find((e: any) => e.code === code);
    const etf = ALL_ETFS.find(e => e.code === code) ?? (tigerEtf as any) ?? null;

    if (!etf) {
      res.status(404).json({ error: "ETF를 찾을 수 없습니다" });
      return;
    }

    const { holdings } = await getEtfHoldings(code, tigerEtf?.isuCd);

    // Yahoo Finance 가격 조회
    const yahooTicker = etf.yahooCode ?? (code.length === 6 ? `${code}.KS` : code);
    let priceInfo = "가격 데이터 없음";
    try {
      const q = await YahooFinance.quote(yahooTicker, {
        fields: ["regularMarketPrice","regularMarketChangePercent","fiftyTwoWeekHigh","fiftyTwoWeekLow","regularMarketVolume","marketCap"] as any,
      });
      const p = q as any;
      const cur  = p.regularMarketPrice;
      const chg  = p.regularMarketChangePercent;
      const hi52 = p.fiftyTwoWeekHigh;
      const lo52 = p.fiftyTwoWeekLow;
      const vol  = p.regularMarketVolume;
      const cap  = p.marketCap;
      if (cur) {
        priceInfo = [
          `현재가: ${cur.toLocaleString()}원`,
          chg != null && `전일대비: ${chg >= 0 ? "+" : ""}${(chg * 100).toFixed(2)}%`,
          hi52 && lo52 && `52주 범위: ${lo52.toLocaleString()} ~ ${hi52.toLocaleString()}`,
          vol  && `거래량: ${vol.toLocaleString()}`,
          cap  && `시총: ${(cap / 1e8).toFixed(0)}억원`,
        ].filter(Boolean).join(" | ");
      }
    } catch { /* 무시 */ }

    const top10 = holdings.slice(0, 10);
    const holdingStr = top10.map((h, i) =>
      `${i + 1}. ${h.stockName} ${h.weight.toFixed(2)}%`
    ).join("\n");
    const top10sum = top10.reduce((s, h) => s + h.weight, 0);
    const today = new Date().toISOString().slice(0, 10);
    const levLabel = etf.leverage === 1 ? "일반(1×)" : etf.leverage === 2 ? "레버리지(2×)" : etf.leverage === -1 ? "인버스(-1×)" : etf.leverage === -2 ? "인버스(−2×)" : `${etf.leverage}×`;

    const prompt = `당신은 국내 대형 증권사 ETF 리서치센터의 수석 애널리스트입니다.
아래 데이터를 바탕으로 기관 투자자급 ETF 분석 리포트를 작성하십시오.
문체는 증권사 공식 리서치 리포트 수준으로, 단정적이고 전문적이어야 합니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ETF 기본 데이터]
명칭: ${etf.name} (${code})
운용사: ${etf.issuer ?? "N/A"} | 추적지수: ${etf.benchmark ?? "N/A"}
섹터/테마: ${etf.sector ?? "N/A"} | 연간 총보수: ${etf.ter != null ? `${etf.ter}%` : "N/A"} | 레버리지: ${levLabel}
분석 기준일: ${today}

[가격 데이터]
${priceInfo}

[포트폴리오 상위 구성종목 (Top ${top10.length})]
${holdingStr}
→ 상위 ${top10.length}종목 합산 비중: ${top10sum.toFixed(1)}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━

[작성 지침]
1. key_points: "Buy" 논거 3개를 각각 한 문장으로 (투자 포인트 헤드라인 스타일)
2. executive_summary: 투자의견·핵심 논거·리스크를 담은 3~4문장 요약. 증권사 리서치 톤.
3. sections: 아래 5개 항목을 각 300자 이상 전문적으로 기술
   Ⅰ. ETF 구조 및 지수 분석 — 추적지수 구성 방식, 편입 기준, 운용 전략, 비용 효율성
   Ⅱ. 포트폴리오 집중도 및 섹터 분석 — 핵심 편입 종목별 투자 논거, 섹터 쏠림, 분산도
   Ⅲ. 거시·테마 환경 — 현재 매크로(금리·환율·경기 사이클)와 해당 테마의 연관성 및 수혜 구조
   Ⅳ. 기술적 분석 및 수급 — 가격 추세, 이동평균, 모멘텀 지표, 거래량 동향, 지지·저항
   Ⅴ. 동종 ETF 비교 — 유사 추적지수 상품과의 총보수·유동성·추적 오차·수익률 비교
4. investment_thesis: 지금 이 ETF를 보유해야 하는 핵심 논거 2~3문장 (리서치 결론 스타일)
5. entry_guide: 구체적인 가격·% 수치 포함
6. risk_factors: factor(리스크 제목)와 detail(2~3문장 상세 설명) 3~4개
7. conclusion: 투자의견 재확인 + 핵심 모니터링 포인트를 담은 2~3문장 최종 결론`;

    const genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!,
      ...(process.env.GEMINI_API_KEY ? {} : {
        httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
      }),
    });

    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object" as any,
          properties: {
            verdict:           { type: "string" as any, enum: ["매수", "중립", "매도"] },
            confidence:        { type: "string" as any, enum: ["높음", "보통", "낮음"] },
            target_return_3m:  { type: "string" as any },
            key_points:        { type: "array" as any, items: { type: "string" as any } },
            executive_summary: { type: "string" as any },
            sections: {
              type: "array" as any,
              items: {
                type: "object" as any,
                properties: {
                  title:   { type: "string" as any },
                  content: { type: "string" as any },
                },
                required: ["title", "content"],
              },
            },
            investment_thesis: { type: "string" as any },
            entry_guide: {
              type: "object" as any,
              properties: {
                entry_zone: { type: "string" as any },
                stop_loss:  { type: "string" as any },
                target_3m:  { type: "string" as any },
                horizon:    { type: "string" as any },
              },
              required: ["entry_zone", "stop_loss", "target_3m", "horizon"],
            },
            risk_factors: {
              type: "array" as any,
              items: {
                type: "object" as any,
                properties: {
                  factor: { type: "string" as any },
                  detail: { type: "string" as any },
                },
                required: ["factor", "detail"],
              },
            },
            conclusion: { type: "string" as any },
          },
          required: ["verdict", "confidence", "target_return_3m", "key_points", "executive_summary", "sections", "investment_thesis", "entry_guide", "risk_factors", "conclusion"],
        },
      },
    });

    const raw = result.text ?? "";
    res.json(JSON.parse(raw));
  } catch (e: any) {
    console.error("[ETF report]", e?.message);
    res.status(500).json({ error: e?.message ?? "리포트 생성 실패" });
  }
});

export default router;
