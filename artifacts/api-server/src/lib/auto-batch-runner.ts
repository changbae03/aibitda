import { pool } from "@workspace/db";
import { SCHEDULER_TOKEN } from "./schedule-runner.js";

// ─── 워치리스트 ────────────────────────────────────────────────────────────────
// 하루 20개 (KR 10 + US 10) 자동 분석 대상 종목 pool
// ticker · name · industry

const KR_WATCHLIST = [
  { ticker: "005930", name: "삼성전자",       industry: "반도체·디스플레이" },
  { ticker: "000660", name: "SK하이닉스",      industry: "반도체" },
  { ticker: "373220", name: "LG에너지솔루션",  industry: "2차전지·에너지" },
  { ticker: "005380", name: "현대차",           industry: "자동차" },
  { ticker: "000270", name: "기아",             industry: "자동차" },
  { ticker: "005490", name: "POSCO홀딩스",      industry: "철강·소재" },
  { ticker: "035720", name: "카카오",           industry: "인터넷·플랫폼" },
  { ticker: "035420", name: "NAVER",            industry: "인터넷·플랫폼" },
  { ticker: "068270", name: "셀트리온",         industry: "바이오·제약" },
  { ticker: "207940", name: "삼성바이오로직스", industry: "바이오·CDMO" },
  { ticker: "105560", name: "KB금융",           industry: "금융·은행" },
  { ticker: "055550", name: "신한지주",         industry: "금융·은행" },
  { ticker: "066570", name: "LG전자",           industry: "가전·전자" },
  { ticker: "006400", name: "삼성SDI",          industry: "2차전지" },
  { ticker: "009150", name: "삼성전기",         industry: "전자부품·MLCC" },
  { ticker: "042700", name: "한미반도체",       industry: "반도체 장비" },
  { ticker: "096770", name: "SK이노베이션",     industry: "에너지·배터리" },
  { ticker: "015760", name: "한국전력",         industry: "전력·유틸리티" },
  { ticker: "010130", name: "고려아연",         industry: "비철금속·소재" },
  { ticker: "047810", name: "한국항공우주",     industry: "항공우주·방산" },
  { ticker: "128940", name: "한미약품",         industry: "제약·바이오" },
  { ticker: "000100", name: "유한양행",         industry: "제약" },
  { ticker: "034730", name: "SK",               industry: "지주·에너지" },
  { ticker: "003670", name: "포스코퓨처엠",    industry: "2차전지·소재" },
  { ticker: "114800", name: "메리츠금융지주",  industry: "금융" },
];

const US_WATCHLIST = [
  { ticker: "NVDA",  name: "NVIDIA",             industry: "Semiconductors/AI" },
  { ticker: "AAPL",  name: "Apple",               industry: "Consumer Technology" },
  { ticker: "MSFT",  name: "Microsoft",           industry: "Cloud/Software" },
  { ticker: "GOOGL", name: "Alphabet",            industry: "Digital Advertising/Cloud" },
  { ticker: "AMZN",  name: "Amazon",              industry: "E-Commerce/Cloud" },
  { ticker: "META",  name: "Meta Platforms",      industry: "Social Media/AI" },
  { ticker: "TSLA",  name: "Tesla",               industry: "EV/Autonomous" },
  { ticker: "AMD",   name: "Advanced Micro Devices", industry: "Semiconductors" },
  { ticker: "QCOM",  name: "Qualcomm",            industry: "Semiconductors/Mobile" },
  { ticker: "AVGO",  name: "Broadcom",            industry: "Semiconductors/Networking" },
  { ticker: "TSM",   name: "TSMC",                industry: "Semiconductor Foundry" },
  { ticker: "JPM",   name: "JPMorgan Chase",      industry: "Banking/Financials" },
  { ticker: "GS",    name: "Goldman Sachs",       industry: "Investment Banking" },
  { ticker: "BRK-B", name: "Berkshire Hathaway",  industry: "Diversified Conglomerate" },
  { ticker: "JNJ",   name: "Johnson & Johnson",   industry: "Pharma/MedTech" },
  { ticker: "LLY",   name: "Eli Lilly",           industry: "Pharma/GLP-1" },
  { ticker: "MRNA",  name: "Moderna",             industry: "Biotech/mRNA" },
  { ticker: "PLTR",  name: "Palantir",            industry: "AI/Data Analytics" },
  { ticker: "CRWD",  name: "CrowdStrike",         industry: "Cybersecurity" },
  { ticker: "SNOW",  name: "Snowflake",           industry: "Cloud Data" },
  { ticker: "MSTR",  name: "MicroStrategy",       industry: "Bitcoin/Software" },
  { ticker: "MU",    name: "Micron Technology",   industry: "Memory Semiconductors" },
  { ticker: "INTC",  name: "Intel",               industry: "Semiconductors" },
  { ticker: "NKE",   name: "Nike",                industry: "Consumer/Sportswear" },
  { ticker: "MCD",   name: "McDonald's",          industry: "Fast Food/Consumer" },
];

const STALE_DAYS = 3;
const DAILY_BATCH_KR = 10;
const DAILY_BATCH_US = 10;
const INTER_STOCK_DELAY_MS = 5 * 60 * 1000; // 5분 간격

// ─── 마지막 실행일 체크 ────────────────────────────────────────────────────────
// system_cache 스키마: key TEXT PK, data JSONB, expires_at TIMESTAMPTZ
async function getLastBatchDate(): Promise<string | null> {
  try {
    const r = await pool.query(
      `SELECT data FROM system_cache WHERE key = 'auto_batch_last_run'`
    );
    const raw = r.rows[0]?.data;
    if (!raw) return null;
    return typeof raw === "string" ? raw : (raw as any).date ?? null;
  } catch {
    return null;
  }
}

async function setLastBatchDate(dateStr: string): Promise<void> {
  // expires_at을 30일 후로 설정 (만료 걱정 없음)
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO system_cache (key, data, expires_at)
     VALUES ('auto_batch_last_run', $1::jsonb, $2)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [JSON.stringify({ date: dateStr }), expiresAt]
  );
}

// ─── 종목별 마지막 분석 일자 조회 ─────────────────────────────────────────────
async function getLastAnalysedMap(tickers: string[]): Promise<Map<string, Date | null>> {
  const map = new Map<string, Date | null>();
  if (tickers.length === 0) return map;
  try {
    const r = await pool.query(
      `SELECT ticker, MAX(created_at) AS last_at
       FROM analyses
       WHERE ticker = ANY($1) AND status = 'completed'
       GROUP BY ticker`,
      [tickers]
    );
    for (const row of r.rows) {
      map.set(row.ticker, new Date(row.last_at));
    }
  } catch (e: any) {
    console.error("[auto-batch] 분석 이력 조회 오류:", e?.message);
  }
  return map;
}

// ─── 메인: 일일 자동 배치 실행 ────────────────────────────────────────────────
export async function runDailyAutoBatch(port: number): Promise<void> {
  // 오늘 이미 실행했으면 스킵
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10); // "YYYY-MM-DD"

  const lastRun = await getLastBatchDate();
  if (lastRun === todayKST) {
    console.log(`[auto-batch] 오늘(${todayKST}) 이미 실행됨 — 스킵`);
    return;
  }

  console.log(`[auto-batch] 일일 자동 배치 시작 (${todayKST})`);

  // 두 워치리스트에서 최근 분석일 조회
  const allTickers = [
    ...KR_WATCHLIST.map(s => s.ticker),
    ...US_WATCHLIST.map(s => s.ticker),
  ];
  const lastAnalysedMap = await getLastAnalysedMap(allTickers);
  const nowMs = Date.now();
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;

  // 오래됐거나 미분석 종목 우선순위 정렬 (가장 오래된 것 먼저)
  function pickStale<T extends { ticker: string }>(
    list: T[],
    count: number
  ): T[] {
    return list
      .filter(s => {
        const last = lastAnalysedMap.get(s.ticker);
        return !last || nowMs - last.getTime() > staleMs;
      })
      .sort((a, b) => {
        const aTime = lastAnalysedMap.get(a.ticker)?.getTime() ?? 0;
        const bTime = lastAnalysedMap.get(b.ticker)?.getTime() ?? 0;
        return aTime - bTime; // 오래된 것 먼저
      })
      .slice(0, count);
  }

  const krBatch = pickStale(KR_WATCHLIST, DAILY_BATCH_KR);
  const usBatch = pickStale(US_WATCHLIST, DAILY_BATCH_US);
  const batch = [...krBatch, ...usBatch];

  if (batch.length === 0) {
    console.log("[auto-batch] 오늘 분석할 종목 없음 (모두 최신 상태)");
    await setLastBatchDate(todayKST);
    return;
  }

  console.log(
    `[auto-batch] 오늘 대상: KR ${krBatch.length}개, US ${usBatch.length}개 — 총 ${batch.length}개`
  );
  console.log(
    "[auto-batch] 종목:",
    batch.map(s => `${s.name}(${s.ticker})`).join(", ")
  );

  // 오늘 날짜 기록 (중복 실행 방지)
  await setLastBatchDate(todayKST);

  // 5분 간격으로 순차 큐잉
  for (let i = 0; i < batch.length; i++) {
    const stock = batch[i];
    const delay = i * INTER_STOCK_DELAY_MS;

    setTimeout(async () => {
      try {
        const resp = await fetch(`http://localhost:${port}/api/analysis/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Scheduler-Token": SCHEDULER_TOKEN,
          },
          body: JSON.stringify({
            ticker: stock.ticker,
            companyName: stock.name,
            industry: stock.industry,
          }),
        });

        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          console.error(`[auto-batch] 분析 생성 실패: ${stock.name}(${stock.ticker})`, errBody);
          return;
        }

        const data = await resp.json();
        console.log(
          `[auto-batch] 분석 시작: ${stock.name}(${stock.ticker}) → analysis#${data?.id} (${i + 1}/${batch.length})`
        );
      } catch (e: any) {
        console.error(`[auto-batch] 요청 오류: ${stock.name}(${stock.ticker})`, e?.message);
      }
    }, delay);
  }

  const totalMinutes = Math.round((batch.length - 1) * INTER_STOCK_DELAY_MS / 60_000);
  console.log(`[auto-batch] ${batch.length}개 큐잉 완료 — 약 ${totalMinutes}분에 걸쳐 순차 실행`);
}
