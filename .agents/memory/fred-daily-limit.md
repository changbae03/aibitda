---
name: FRED daily series limit trap
description: FRED 일별 시계열(DFEDTARU 등)을 asc+limit=300으로 가져오면 최신값이 아닌 초기값이 반환됨
---

FRED API의 `sort_order=asc&limit=300` 패턴은 월별 시계열에는 문제없지만
일별 시계열(DFEDTARU, DFEDTARL 등)에는 치명적이다.

4년치 일별 데이터 ≈ 1460개인데 limit=300이면 시작점 기준 첫 300일 (≈2022년 7월 ~ 2023년 4월)만 반환된다.
마지막값이 2023년 4월 (연방기금금리 상단 5.0%, 하한 4.75%)에 멈춰 `rangeLabel=4.75~5%`가 표시됐다.

**Why:** 개발팀이 limit=300을 "충분히 크다"고 가정했지만 일별 시계열 4년치는 이 한계를 초과한다.

**How to apply:**
- DFEDTARU/DFEDTARL처럼 최신값만 필요한 일별 시계열 → `sort_order=desc&limit=5` 사용, `[0]`이 최신값
- 차트 표시가 필요한 일별 시계열 → `limit=2000` 이상으로 올리거나 startDate를 좁혀서 요청
- `fredGet()` 함수에 `{ limit, order, startDate }` 옵션이 추가됐으므로 시리즈 특성에 맞게 지정할 것
