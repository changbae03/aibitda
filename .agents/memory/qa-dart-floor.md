---
name: QA checker dartFloorAuk 파싱 연결
description: QA checker가 확정 분기 영업이익 합계(수학적 하한선)를 파싱해 AI 추정치 검증하는 체인
---

## 흐름
1. bottom-up 앵커에서 confirmedOpSum 계산
2. KRW면 /1e8 변환 후 "[수학적 하한선] 올해E 영업이익 합계 = X.X억원" 텍스트 생성 → enrichedContext에 포함
3. QA checker(line ~6401): `enrichedContext.match(/수학적 하한선.*?합계\s*=\s*(\d+(?:\.\d+)?)억원/)` 파싱
4. dartFloorAuk 추출 → runQCCheck에 전달 → AI가 연간 추정 < dartFloor이면 불승인

**Why:** 과거 파싱 실패(텍스트 없어서 regex 미매칭) → dartFloorAuk=null → 하한선 체크 무력화.
**How to apply:** KRW 종목 Q1+ 확정 분기 있을 때만 생성. 비KRW 종목은 aukUnit="".
