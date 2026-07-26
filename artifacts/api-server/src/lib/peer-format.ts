/**
 * peer-format.ts — 피어 지표를 프롬프트용 표로 만드는 순수 함수들.
 *
 * peer-store.ts와 나눠 둔 이유: 그쪽은 DB 연결을 임포트하므로 DATABASE_URL 없이는
 * 로딩조차 되지 않아 테스트를 붙일 수 없다. 표기 규칙은 프롬프트에 그대로 들어가
 * AI 판단을 좌우하는 부분이라 반드시 테스트로 고정해야 한다.
 */

export interface PeerWithMetrics {
  ticker: string;
  name: string | null;
  rank: number;
  reason: string | null;
  source: string;
  /** 아래는 stocks 뷰에서 조인해 온 값. 마스터에 없으면 전부 null */
  market: string | null;
  sector: string | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  opm: number | null;
  marketCap: number | null;
  currentPrice: number | null;
}

/**
 * PER·PBR이 정확히 0으로 들어오는 경우가 있다(수집 실패를 0으로 채운 흔적).
 * 실제로 0인 배수는 존재하지 않으므로 "값 없음"으로 취급한다. 0을 그대로
 * 프롬프트에 넣으면 AI가 "초저평가"로 오해한다.
 * 음수는 적자 기업의 실제 값이므로 그대로 둔다.
 */
export function metric(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v === 0) return null;
  return v;
}

/**
 * 시가총액은 시장에 따라 통화가 다르다. 한국은 원, 미국은 달러로 저장돼 있으므로
 * 원화 단위(억·조)로 일괄 표기하면 미국 종목의 규모가 왜곡된다. 실제로 알파벳
 * 시총이 "4.2조"로 찍혀 한국 대형주와 비슷해 보이는 문제가 있었다.
 */
export function formatCap(v: number | null, market: string | null): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  if (market === "US") {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    return `$${(v / 1e6).toFixed(0)}M`;
  }
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조원`;
  return `${Math.round(v / 1e8).toLocaleString("ko-KR")}억원`;
}

/** 프롬프트에 넣을 수 있게 표 형태 문자열로 만든다. 지표가 없는 피어는 표시만 남긴다. */
export function formatPeerTable(peers: PeerWithMetrics[]): string {
  if (peers.length === 0) return "";
  const lines = [
    "| 종목 | 시장 | PER | PBR | ROE(%) | 영업이익률(%) | 시가총액 |",
    "|------|------|----:|----:|-------:|-------------:|---------:|",
  ];
  const fmt = (v: number | null, d = 2) => {
    const m = metric(v);
    return m == null ? "—" : m.toFixed(d);
  };
  for (const p of peers) {
    lines.push(
      `| ${p.name ?? p.ticker} (${p.ticker}) | ${p.market ?? "—"} | ${fmt(p.per)} | ${fmt(p.pbr)} | ${fmt(p.roe, 1)} | ${fmt(p.opm, 1)} | ${formatCap(p.marketCap, p.market)} |`,
    );
  }
  return lines.join("\n");
}
