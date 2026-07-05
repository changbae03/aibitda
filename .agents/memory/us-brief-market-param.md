---
name: US Brief market param case sensitivity
description: brief 라우트의 market 파라미터 대소문자 문제 및 US 브리핑 Korean 오염 수정
---

## 규칙

brief 라우트는 `req.query.market === "us"` (소문자)로 체크한다.
- 프론트엔드: `market=us` (소문자) ✅
- curl 테스트 시 반드시 `market=us` (소문자) 사용 — `market=US` 사용 시 KR 라우트로 타서 한국 브리핑 반환

**Why:** 코드에 `const market = req.query.market === "us" ? "us" : "kr"` 패턴이 있어 대소문자 구분 엄격

**How to apply:** curl로 US 브리핑 테스트/디버깅 시 항상 `?market=us`(소문자) 사용

## US 브리핑 Korean 콘텐츠 오염 수정 내역

fetchMarketNews()는 한국 뉴스를 반환하므로 US 브리핑에는 fetchUsMarketNews()를 사용
- fetchUsMarketNews(): 영어 US 뉴스 쿼리 6개 (Google News US edition)
- macroBlock에서 ecos.usdKrw(원달러환율) 제거 — US 지표만 유지
- 프롬프트에 한국 시장 금지 규칙 추가
- macroFactors 오염 감지: 한국 키워드 감지 시 데이터 기반으로 재구성
