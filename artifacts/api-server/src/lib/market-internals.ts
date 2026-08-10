/**
 * market-internals.ts — 한국 시장 브리핑에 넣을 **국내 시장 내부** 블록.
 *
 * 왜 필요한가. 브리핑 프롬프트가 받는 것은 지수·매크로·뉴스뿐이었다. 국내 시장에서
 * 실제로 무슨 일이 있었는지(어떤 종목이 왜 움직였고, 어느 업종에 자금이 몰렸는지)를
 * 주지 않으니, AI는 가진 것 — 미국 지수와 필라델피아 반도체 지수 — 으로 단락을 채웠다.
 * 사용자가 "한국은 SOX 얘기만 많다"고 느낀 원인이 이것이다.
 *
 * 여기서는 이미 있는 수집기(KIS 급등주, 종목 마스터)를 모아 다음을 만든다:
 *   · 오늘 크게 움직인 종목 (이름·등락률·거래대금)
 *   · 그 종목들이 어느 업종에 몰렸는지 (자금이 향한 곳)
 *
 * 수집 실패는 분석을 막지 않는다 — 블록을 비우고 그 사실을 로그로 남긴다.
 */

import { pool } from "@workspace/db";
import { fetchKISLiveGainers, type KISGainerItem } from "./kis-client.js";

export interface MoverRow {
  ticker: string;
  name: string;
  change: number;
  tradingValue: number; // 억원
  sector: string | null;
}

/**
 * 업종 코드를 사람이 읽는 말로. `stocks.sector`에는 KR_ELECTRONICS 같은 내부 코드가
 * 들어 있는데, 그대로 프롬프트에 넣으면 AI가 "KR_ELECTRONICS 업종"이라고 쓴다.
 */
const SECTOR_KO: Record<string, string> = {
  KR_SEMICONDUCTOR: "반도체", KR_SEMICONDUCTOR_EQ: "반도체 장비", KR_ELECTRONICS: "전자·전기부품",
  KR_IT: "IT·소프트웨어", KR_BIOTECH: "바이오", KR_MEDICAL: "의료기기·헬스케어",
  KR_PHARMA: "제약", KR_AUTO: "자동차·부품", KR_BATTERY: "2차전지", KR_CHEMICAL: "화학",
  KR_MATERIALS: "소재", KR_MACHINERY: "기계", KR_SHIPBUILDING: "조선", KR_DEFENSE: "방산",
  KR_STEEL: "철강·금속", KR_CONSTRUCTION: "건설", KR_CONSUMER: "소비재", KR_FOOD: "음식료",
  KR_RETAIL: "유통", KR_ENTERTAINMENT: "엔터·미디어", KR_GAME: "게임", KR_TELECOM: "통신",
  KR_FINANCIAL: "금융", KR_INSURANCE: "보험", KR_SECURITIES: "증권", KR_ENERGY: "에너지",
  KR_UTILITIES: "유틸리티", KR_TRANSPORT: "운송", KR_REIT: "리츠", KR_HOLDING: "지주",
  KR_TEXTILE: "섬유·의류", KR_PAPER: "제지", KR_AEROSPACE: "항공우주", KR_OTHER: "기타",
};

/** 표시용 업종명. 코드가 없으면 원문(KIS 분류 등)을 그대로 쓴다. */
function sectorLabel(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === "일반") return null;
  return SECTOR_KO[t] ?? (t.startsWith("KR_") || t.startsWith("US_") ? null : t);
}

/** 급등 종목에 업종을 붙인다. 업종은 종목 마스터(stocks 뷰)에서 한 번에 조인. */
export async function fetchTopMovers(limit = 20): Promise<MoverRow[]> {
  let gainers: KISGainerItem[] = [];
  try {
    gainers = await fetchKISLiveGainers(limit);
  } catch (e) {
    console.warn("[market-internals] 급등주 조회 실패:", (e as Error)?.message?.slice(0, 80));
    return [];
  }
  if (gainers.length === 0) return [];

  const tickers = gainers.map(g => g.ticker);
  const sectorOf = new Map<string, string | null>();
  try {
    const { rows } = await pool.query<{ ticker: string; sector: string | null; kis_industry: string | null }>(
      `SELECT ticker, sector, kis_industry FROM stocks WHERE ticker = ANY($1)`, [tickers]);
    for (const r of rows) sectorOf.set(r.ticker, r.sector ?? r.kis_industry ?? null);
  } catch (e) {
    console.warn("[market-internals] 업종 조인 실패:", (e as Error)?.message?.slice(0, 80));
  }

  return gainers.map(g => ({
    ticker: g.ticker, name: g.name, change: g.change,
    tradingValue: g.tradingValue, sector: sectorOf.get(g.ticker) ?? null,
  }));
}

/** 업종별로 몇 종목이 급등했는지 — 자금이 어디로 몰렸는지 보여준다. */
export function groupBySector(movers: MoverRow[]): Array<{ sector: string; count: number; names: string[] }> {
  const m = new Map<string, string[]>();
  for (const r of movers) {
    const s = sectorLabel(r.sector);
    if (!s || s === "기타") continue; // '기타'로 묶인 것은 성격을 말해주지 못한다
    if (!m.has(s)) m.set(s, []);
    m.get(s)!.push(r.name);
  }
  return [...m.entries()]
    .map(([sector, names]) => ({ sector, count: names.length, names }))
    .filter(x => x.count >= 2)          // 한 종목뿐이면 '자금이 몰렸다'고 말할 수 없다
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

/**
 * 프롬프트 블록으로 만든다. **AI는 이 종목·업종을 근거로 국내 이야기를 쓴다.**
 * 데이터가 없으면 빈 문자열 — 없는 것을 지어내게 하지 않는다.
 */
export function renderMarketInternals(movers: MoverRow[]): string {
  if (movers.length === 0) return "";
  // 거래대금은 장 시간 밖이면 0으로 온다 — 전부 0이면 열을 빼서 "0억"이 나가지 않게 한다.
  const hasValue = movers.some(r => r.tradingValue > 0);
  const fmt = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${Math.round(v).toLocaleString("ko-KR")}억`);
  const lines = [
    "",
    "[🇰🇷 오늘 국내 시장 내부 — 실제로 움직인 종목들]",
    "⚠️ 아래는 오늘 장에서 크게 오른 종목입니다. **국내 시장 서술은 이 종목·업종을 근거로 쓰세요.**",
    "⚠️ 미국 지수·SOX는 배경일 뿐입니다. 여기 있는 종목명과 업종을 구체적으로 인용하세요.",
    "",
    hasValue ? "| 종목 | 등락률 | 거래대금 | 업종 |" : "| 종목 | 등락률 | 업종 |",
    hasValue ? "|---|---|---|---|" : "|---|---|---|",
  ];
  for (const r of movers.slice(0, 15)) {
    const sec = sectorLabel(r.sector) ?? "—";
    lines.push(hasValue
      ? `| ${r.name} | +${r.change.toFixed(1)}% | ${fmt(r.tradingValue)} | ${sec} |`
      : `| ${r.name} | +${r.change.toFixed(1)}% | ${sec} |`);
  }
  const groups = groupBySector(movers);
  if (groups.length > 0) {
    lines.push("", "[자금이 몰린 업종 — 급등 종목이 2개 이상 나온 곳]");
    for (const g of groups) lines.push(`· ${g.sector} ${g.count}종목: ${g.names.slice(0, 5).join(", ")}`);
    lines.push("⚠️ 이 업종 쏠림이 오늘 시장의 성격을 말해줍니다 — 왜 그 업종인지 뉴스와 엮어 설명하세요.");
  }
  return lines.join("\n");
}
