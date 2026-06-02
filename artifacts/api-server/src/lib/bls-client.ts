/**
 * BLS (Bureau of Labor Statistics) 클라이언트
 * - 실제 CPI / NFP / 실업률 / PPI 발표 수치 조회
 * - BLS 공식 릴리즈 일정(날짜) 스크래핑
 * - FOMC 회의 날짜 (연준 공식 페이지)
 *
 * BLS Public Data API v2: https://api.bls.gov/publicAPI/v2/
 * 무료(미등록): 일 25 requests, 시리즈 25개, 10년치
 */

const BLS_API = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const ACTUALS_TTL = 12 * 60 * 60 * 1000;   // 12시간
const SCHEDULE_TTL = 24 * 60 * 60 * 1000;  // 24시간

// ─── 타입 정의 ────────────────────────────────────────────────────────────────
export interface BLSActuals {
  cpiYoY:              number | null;   // 미국 CPI 전년동월비 (%)
  cpiPrevious:         string;          // 직전 발표값 문자열 e.g. "2.4%"
  cpiPeriod:           string;          // e.g. "2026-04"

  nfpMonthly:          number | null;   // 비농업 고용 월별 변화 (천명)
  nfpPrevious:         string;          // e.g. "+228K"
  nfpPeriod:           string;

  unemployment:        number | null;   // 실업률 (%)
  unemploymentPrevious:string;          // e.g. "4.2%"
  unemploymentPeriod:  string;

  ppiYoY:              number | null;   // PPI 전년동월비 (%)
  ppiPrevious:         string;
  ppiPeriod:           string;

  fetchedAt: number;
}

export interface BLSReleaseDate {
  indicator: "CPI" | "NFP" | "PPI" | "Retail Sales" | "Jobless Claims";
  date: string;       // YYYY-MM-DD
  timeKST: string;    // HH:MM KST (BLS는 미국 동부 08:30 → KST 21:30 / 22:30)
}

export interface FOMCDate {
  startDate: string;  // YYYY-MM-DD
  endDate:   string;  // YYYY-MM-DD (당일 발표는 endDate 사용)
  type: "meeting" | "minutes";
}

// ─── 캐시 ─────────────────────────────────────────────────────────────────────
let _actualsCache: BLSActuals | null = null;
let _scheduleCache: { data: BLSReleaseDate[]; expiresAt: number } | null = null;
let _fomcCache: { data: FOMCDate[]; expiresAt: number } | null = null;

// ─── BLS 시리즈 ID ─────────────────────────────────────────────────────────────
const SERIES = {
  CPI:          "CUSR0000SA0",   // CPI-U 계절조정 전체 (Seasonally Adjusted All Items)
  NFP:          "CES0000000001", // Total Nonfarm Employment (천명)
  UNEMPLOYMENT: "LNS14000000",   // Unemployment Rate (%)
  PPI:          "WPUFD49104",    // PPI Final Demand (인덱스)
};

// ─── BLS API 호출 ──────────────────────────────────────────────────────────────
async function blsPost(seriesIds: string[]): Promise<Map<string, Array<{ year: string; period: string; value: string }>>> {
  const currentYear = new Date().getFullYear();
  const payload = {
    seriesid: seriesIds,
    startyear: String(currentYear - 1),
    endyear: String(currentYear),
  };
  const res = await fetch(BLS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`BLS API HTTP ${res.status}`);
  const json = await res.json() as any;
  if (json.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS API: ${json.message?.[0] ?? json.status}`);
  }
  const result = new Map<string, Array<{ year: string; period: string; value: string }>>();
  for (const s of json.Results?.series ?? []) {
    // API는 desc 정렬로 반환 (최신 → 과거)
    result.set(s.seriesID, (s.data ?? []).filter((d: any) => d.value !== "."));
  }
  return result;
}

function periodToYYYYMM(year: string, period: string): string {
  return `${year}-${period.replace("M", "").padStart(2, "0")}`;
}

// ─── 실제 발표값 조회 ──────────────────────────────────────────────────────────
export async function fetchBLSActuals(): Promise<BLSActuals | null> {
  if (_actualsCache && Date.now() - _actualsCache.fetchedAt < ACTUALS_TTL) {
    return _actualsCache;
  }
  try {
    const map = await blsPost(Object.values(SERIES));

    // CPI YoY
    const cpiData = map.get(SERIES.CPI) ?? [];
    let cpiYoY: number | null = null;
    let cpiPrevious = "";
    let cpiPeriod = "";
    if (cpiData.length >= 13) {
      const latest = parseFloat(cpiData[0].value);
      const yearAgo = parseFloat(cpiData[12].value);
      if (!isNaN(latest) && !isNaN(yearAgo) && yearAgo !== 0) {
        cpiYoY = ((latest - yearAgo) / yearAgo) * 100;
        cpiPrevious = `${cpiYoY.toFixed(1)}%`;
        cpiPeriod = periodToYYYYMM(cpiData[0].year, cpiData[0].period);
      }
    }

    // NFP 월별 변화 (latest - prev)
    const nfpData = map.get(SERIES.NFP) ?? [];
    let nfpMonthly: number | null = null;
    let nfpPrevious = "";
    let nfpPeriod = "";
    if (nfpData.length >= 2) {
      const cur = parseFloat(nfpData[0].value);
      const prev = parseFloat(nfpData[1].value);
      if (!isNaN(cur) && !isNaN(prev)) {
        nfpMonthly = Math.round(cur - prev);
        nfpPrevious = `${nfpMonthly >= 0 ? "+" : ""}${nfpMonthly}K`;
        nfpPeriod = periodToYYYYMM(nfpData[0].year, nfpData[0].period);
      }
    }

    // 실업률
    const urData = map.get(SERIES.UNEMPLOYMENT) ?? [];
    let unemployment: number | null = null;
    let unemploymentPrevious = "";
    let unemploymentPeriod = "";
    if (urData.length > 0) {
      unemployment = parseFloat(urData[0].value);
      if (isNaN(unemployment)) unemployment = null;
      unemploymentPrevious = unemployment !== null ? `${unemployment.toFixed(1)}%` : "";
      unemploymentPeriod = periodToYYYYMM(urData[0].year, urData[0].period);
    }

    // PPI YoY
    const ppiData = map.get(SERIES.PPI) ?? [];
    let ppiYoY: number | null = null;
    let ppiPrevious = "";
    let ppiPeriod = "";
    if (ppiData.length >= 13) {
      const latest = parseFloat(ppiData[0].value);
      const yearAgo = parseFloat(ppiData[12].value);
      if (!isNaN(latest) && !isNaN(yearAgo) && yearAgo !== 0) {
        ppiYoY = ((latest - yearAgo) / yearAgo) * 100;
        ppiPrevious = `${ppiYoY.toFixed(1)}%`;
        ppiPeriod = periodToYYYYMM(ppiData[0].year, ppiData[0].period);
      }
    }

    _actualsCache = {
      cpiYoY, cpiPrevious, cpiPeriod,
      nfpMonthly, nfpPrevious, nfpPeriod,
      unemployment, unemploymentPrevious, unemploymentPeriod,
      ppiYoY, ppiPrevious, ppiPeriod,
      fetchedAt: Date.now(),
    };
    console.log("[BLS] actuals:", JSON.stringify({
      CPI_YoY: cpiYoY?.toFixed(2), CPI기간: cpiPeriod,
      NFP: nfpMonthly, NFP기간: nfpPeriod,
      실업률: unemployment, PPI_YoY: ppiYoY?.toFixed(2),
    }));
    return _actualsCache;
  } catch (e: any) {
    console.warn("[BLS] actuals 조회 실패:", e.message);
    return null;
  }
}

// ─── BLS 릴리즈 일정 스크래핑 ──────────────────────────────────────────────────
// BLS 각 지표별 공식 릴리즈 일정 페이지
const BLS_SCHEDULE_URLS: Array<{ indicator: BLSReleaseDate["indicator"]; url: string }> = [
  { indicator: "CPI",           url: "https://www.bls.gov/schedule/news_release/cpi.htm" },
  { indicator: "NFP",           url: "https://www.bls.gov/schedule/news_release/empsit.htm" },
  { indicator: "PPI",           url: "https://www.bls.gov/schedule/news_release/ppi.htm" },
  { indicator: "Retail Sales",  url: "https://www.bls.gov/schedule/news_release/retail.htm" },
  { indicator: "Jobless Claims", url: "https://www.bls.gov/schedule/news_release/ui.htm" },
];

// BLS는 미국 동부 08:30 발표 → 서머타임 기간(3~11월)은 KST 21:30, 동절기는 KST 22:30
function blsTimeKST(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const month = d.getUTCMonth() + 1; // 1-indexed
  // 미국 서머타임: 3월 둘째 일요일 ~ 11월 첫째 일요일 (근사치)
  const isDST = month >= 3 && month <= 11;
  return isDST ? "21:30 KST" : "22:30 KST";
}

// BLS HTML에서 날짜 추출 — 테이블 셀에서 "Month DD, YYYY" 패턴 파싱
function parseBLSDates(html: string): string[] {
  const dates: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 패턴: "January 15, 2026" 또는 "Jan. 15, 2026"
  const re = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.|Feb\.|Mar\.|Apr\.|May\.|Jun\.|Jul\.|Aug\.|Sep\.|Oct\.|Nov\.|Dec\.)\s+(\d{1,2}),?\s+(202\d)\b/gi;
  const MONTH_MAP: Record<string, number> = {
    january:1, february:2, march:3, april:4, may:5, june:6,
    july:7, august:8, september:9, october:10, november:11, december:12,
    "jan.":1, "feb.":2, "mar.":3, "apr.":4, "may.":5, "jun.":6,
    "jul.":7, "aug.":8, "sep.":9, "oct.":10, "nov.":11, "dec.":12,
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const month = MONTH_MAP[m[1].toLowerCase()];
    const day   = parseInt(m[2], 10);
    const year  = parseInt(m[3], 10);
    if (!month) continue;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d >= today) {
      const iso = d.toISOString().split("T")[0];
      if (!dates.includes(iso)) dates.push(iso);
    }
  }
  return dates.sort();
}

async function fetchBLSSchedulePage(indicator: BLSReleaseDate["indicator"], url: string): Promise<BLSReleaseDate[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AiBITDA/1.0; +https://aibitda.com)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const dates = parseBLSDates(html);
    return dates.map(date => ({ indicator, date, timeKST: blsTimeKST(date) }));
  } catch {
    return [];
  }
}

export async function fetchBLSReleaseSchedule(): Promise<BLSReleaseDate[]> {
  if (_scheduleCache && Date.now() < _scheduleCache.expiresAt) {
    return _scheduleCache.data;
  }
  try {
    const results = await Promise.all(
      BLS_SCHEDULE_URLS.map(s => fetchBLSSchedulePage(s.indicator, s.url))
    );
    const data = results.flat().sort((a, b) => a.date.localeCompare(b.date));
    _scheduleCache = { data, expiresAt: Date.now() + SCHEDULE_TTL };
    console.log(`[BLS] 릴리즈 일정 ${data.length}건 로드`);
    return data;
  } catch (e: any) {
    console.warn("[BLS] schedule 조회 실패:", e.message);
    return [];
  }
}

// ─── FOMC 회의 날짜 (연준 공식 페이지) ──────────────────────────────────────────
// 2025-2026 FOMC 일정 (하드코드 폴백)
const FOMC_2025_2026: FOMCDate[] = [
  // 2025
  { startDate: "2025-01-28", endDate: "2025-01-29", type: "meeting" },
  { startDate: "2025-03-18", endDate: "2025-03-19", type: "meeting" },
  { startDate: "2025-05-06", endDate: "2025-05-07", type: "meeting" },
  { startDate: "2025-06-17", endDate: "2025-06-18", type: "meeting" },
  { startDate: "2025-07-29", endDate: "2025-07-30", type: "meeting" },
  { startDate: "2025-09-16", endDate: "2025-09-17", type: "meeting" },
  { startDate: "2025-10-28", endDate: "2025-10-29", type: "meeting" },
  { startDate: "2025-12-09", endDate: "2025-12-10", type: "meeting" },
  // 2026
  { startDate: "2026-01-27", endDate: "2026-01-28", type: "meeting" },
  { startDate: "2026-03-17", endDate: "2026-03-18", type: "meeting" },
  { startDate: "2026-04-28", endDate: "2026-04-29", type: "meeting" },
  { startDate: "2026-06-09", endDate: "2026-06-10", type: "meeting" },
  { startDate: "2026-07-28", endDate: "2026-07-29", type: "meeting" },
  { startDate: "2026-09-15", endDate: "2026-09-16", type: "meeting" },
  { startDate: "2026-10-27", endDate: "2026-10-28", type: "meeting" },
  { startDate: "2026-12-08", endDate: "2026-12-09", type: "meeting" },
];

// 연준 공식 FOMC 캘린더 파싱
async function scrapeFOMCDates(): Promise<FOMCDate[]> {
  try {
    const res = await fetch("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AiBITDA/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const results: FOMCDate[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 패턴: "January/February 28-29, 2025" or "May 6-7*" or "March 17-18"
    // 연준 HTML에서 날짜 범위를 포함하는 테이블 파싱
    const MONTH_MAP: Record<string, number> = {
      january:1, february:2, march:3, april:4, may:5, june:6,
      july:7, august:8, september:9, october:10, november:11, december:12,
    };

    // "Month DD-DD" or "Month/Month DD-DD"
    const re = /(January|February|March|April|May|June|July|August|September|October|November|December)(?:\/\w+)?\s+(\d{1,2})[-–](\d{1,2})\*?,?\s*(202\d)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const month = MONTH_MAP[m[1].toLowerCase()];
      if (!month) continue;
      const year = parseInt(m[4], 10);
      const dayStart = parseInt(m[2], 10);
      const dayEnd   = parseInt(m[3], 10);
      const start = new Date(Date.UTC(year, month - 1, dayStart));
      const end   = new Date(Date.UTC(year, month - 1, dayEnd));
      if (end >= today) {
        results.push({
          startDate: start.toISOString().split("T")[0],
          endDate:   end.toISOString().split("T")[0],
          type: "meeting",
        });
      }
    }
    if (results.length >= 4) {
      console.log(`[FOMC] 연준 페이지에서 ${results.length}건 파싱`);
      return results.sort((a, b) => a.startDate.localeCompare(b.startDate));
    }
    throw new Error("파싱 결과 불충분");
  } catch (e: any) {
    console.warn("[FOMC] scrape 실패, 하드코드 폴백:", e.message);
    return [];
  }
}

export async function fetchFOMCDates(): Promise<FOMCDate[]> {
  if (_fomcCache && Date.now() < _fomcCache.expiresAt) {
    return _fomcCache.data;
  }
  const scraped = await scrapeFOMCDates();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 스크래핑 성공하면 사용, 실패하면 하드코드 폴백
  const raw = scraped.length >= 4 ? scraped : FOMC_2025_2026.filter(f => new Date(f.endDate) >= today);
  _fomcCache = { data: raw, expiresAt: Date.now() + SCHEDULE_TTL };
  return raw;
}

// ─── 경제 캘린더 이벤트 보강 헬퍼 ──────────────────────────────────────────────
export interface EconomicActuals {
  actuals: BLSActuals | null;
  schedule: BLSReleaseDate[];
  fomc: FOMCDate[];
}

export async function fetchAllEconomicActuals(): Promise<EconomicActuals> {
  const [actuals, schedule, fomc] = await Promise.allSettled([
    fetchBLSActuals(),
    fetchBLSReleaseSchedule(),
    fetchFOMCDates(),
  ]);
  return {
    actuals: actuals.status === "fulfilled" ? actuals.value : null,
    schedule: schedule.status === "fulfilled" ? schedule.value : [],
    fomc: fomc.status === "fulfilled" ? fomc.value : [],
  };
}

// 서버 시작 시 프리로드
fetchAllEconomicActuals().catch(() => {});
