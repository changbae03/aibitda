---
name: News timeline city-name collision fix
description: How to prevent stocks with city/place names (e.g. 서산 079650) from showing city news instead of company news in the timeline feature.
---

## Problem
When a stock's name matches a Korean city (e.g. 서산, 광양, 여수, 안산), the news timeline shows municipal/infrastructure news instead of company news. Google News returns city articles, and Gemini defaults to city content from training data.

## 4-Layer Defense (implemented in timeline.ts)

**Layer 1 — Google News search strategy (fetchGoogleNewsRss)**
- When `ticker` is present: search `${ticker}` (code alone) AND `${keyword} 주식` in parallel
- Without ticker: search keyword in KR + EN as before
- Ticker-code search returns stock-specific results only

**Layer 2 — Pre-processing article filter (router)**
- CITY_PATTERNS regex covers: 시장|군수|도지사|지자체|공항 개항|해상풍력|크루즈|대산항|행정복지|지역개발|관광객 유치
- If >30% of articles are city-like: send EMPTY article list to Gemini
- Otherwise: filter out individual city articles before sending

**Layer 3 — Gemini prompt (generateTimeline)**
- When ticker present: use a completely different prompt template
- Explicitly warns: "this keyword matches a city name, ignore all city content"
- Instructs: return empty timeline if company is unknown (don't hallucinate)
- Bold section headers (━━━) make the instructions harder to ignore

**Layer 4 — Post-processing validator**
- CITY_VERIFY regex scans Gemini's full output (summary + all timeline events)
- If ≥3 city keyword hits detected → replace with standard "뉴스 정보 제한" message + empty timeline
- Logs: `[timeline] "keyword" (ticker) — 도시 내용 감지 (hit=N), 빈 결과 반환`

## Cache key
`${keyword.toLowerCase()}__${ticker}` when ticker present (avoids sharing cache with non-ticker searches for same keyword).

**Why:** Gemini 2.5 Flash's training data strongly associates Korean city names with municipal content. Even with empty RSS articles, it generates city content unless all 4 layers are active.

**How to apply:** Whenever a stock analysis page calls `/api/news/timeline`, always pass `&ticker=` from the frontend. The backend detects this and applies all 4 filters automatically.
