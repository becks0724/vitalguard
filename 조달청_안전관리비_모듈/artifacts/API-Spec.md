# API Spec — 안전조달(SafeProcure)

> 클라이언트↔서버(내부 라우트) + 외부 연동(조달청 OpenAPI, Anthropic) 계약. 빌드 시 이 계약을 지킨다.
> 미정/추정은 `(미정 — Swagger/활용가이드 확인 필요)`로 표기. `g2b.ts`는 tolerant 추출로 필드명 불확실성을 흡수.

## 공통
- Base URL(내부): `/api/g2b`
- 인증(내부): 없음(데모). 외부 키는 서버에서만 사용.
- 콘텐츠 타입: `application/json`
- 공통 에러 포맷: `{ "error": { "code": "...", "message": "..." } }`
- 출처 표기: 모든 응답에 `source: "live" | "mock"` 포함(데이터 신뢰성 노출, KOSHA 패턴).

## 시퀀스 (데이터 흐름 1장 — codex 권고로 본 문서에 게재)
```
브라우저                /api/g2b              lib                        외부
  │── GET /notices ──────▶│                                            
  │                       │── fetchNotices() ─▶ g2b.ts                  
  │                       │                     │ key? ──yes──▶ 조달청 입찰공고 OpenAPI
  │                       │                     │ key? ──no───▶ g2b-mock(5건)
  │                       │                     │◀── 정규화(NoticeSummary[])
  │◀── 200 {items,source}─│                                            
  │── GET /notice/:id ───▶│                                            
  │                       │── detail+분석 ────▶ g2b.detail → safety-cost → risk-tagging → procure-risk
  │                       │                                     │ ANTHROPIC_KEY? ─▶ Claude / 룰 / 목업
  │◀── 200 {RiskProfile}──│                                            
```

## 내부 엔드포인트

### GET /api/g2b/notices — 공사 입찰공고 표준 목록
- 요청 파라미터:
  | 이름 | 위치 | 타입 | 필수 | 설명 |
  |---|---|---|---|---|
  | kind | query | string | 아니오 | `공사`(기본)/`용역`/`물품` |
  | region | query | string | 아니오 | 지역 필터(예: 대전) |
  | page | query | number | 아니오 | 기본 1 |
  | rows | query | number | 아니오 | 기본 20 |
- 성공 응답: `200`
  ```json
  {
    "source": "mock",
    "items": [
      {"id":"20260612-001","title":"○○청사 외벽 보수공사","kind":"공사",
       "agency":"△△구청","region":"대전","estimatedPrice":1450000000,
       "startDate":"2026-07-01","endDate":"2026-11-30","licenses":["건축공사업"]}
    ],
    "page":1,"total":5
  }
  ```
- 에러: `502 G2B_UPSTREAM`(조달청 오류, 자동 목업 강등) / `500 INTERNAL`
- 권한: 공개(데모)

### GET /api/g2b/notice/[id] — 공고 상세 + 사전 안전 리스크 프로파일
- 요청: path `id`(공고번호)
- 성공 응답: `200`
  ```json
  {
    "source":"mock",
    "notice":{"id":"20260612-001","title":"○○청사 외벽 보수공사","kind":"공사",
      "agency":"△△구청","region":"대전","estimatedPrice":1450000000,
      "startDate":"2026-07-01","endDate":"2026-11-30","taskText":"...과업내용...",
      "contractAmount":null,"winRate":null},
    "safetyCost":{"constructionType":"일반건설공사(갑)","baseAmount":1450000000,
      "durationDays":152,"requiredCost":32319000,
      "formula":"1,450,000,000 × 1.86% + 5,349,000원 (5억 이상 50억 미만 구간)",
      "inputSufficiency":"partial","verdict":"검토필요"},
    "tags":[{"tag":"고소작업","severity":3,"evidence":"외벽 보수를 위한 비계 설치","source":"rule"}],
    "risk":{"score":74,"breakdown":{"위험작업":30,"안전관리비의심":10,"낙찰/공기":12,"공종재해통계":22},
      "topFactors":["고소작업 다수","안전관리비 검토필요"],
      "recommendations":["비계 설치/해체 작업계획서 사전 검토","외벽 고소작업 추락방지 설비 확인","안전관리비 대상액 명세 확인"]}
  }
  ```
- 에러: `404 NOTICE_NOT_FOUND` / `502 G2B_UPSTREAM` / `500 INTERNAL`
- 권한: 공개(데모)

## 외부 서비스 연동
| 서비스 | 용도 | 인증/제약 | 출처 |
|---|---|---|---|
| 조달청 나라장터 입찰공고정보서비스 | 공사 공고 목록·상세·추정가격·기간·지역 | `serviceKey`(Decoding) query, data.go.kr rate limit | data.go.kr 15129394 |
| 조달청 나라장터 계약정보서비스 | 계약금액·계약기간·계약업체 | 동일 | data.go.kr 15129427 |
| 조달청 나라장터 낙찰정보서비스 | 낙찰률·경쟁강도(위험 프록시) | 동일 | data.go.kr 15129397 |
| Anthropic Claude (Messages API) | 공고문 위험작업 태그 추출 | `ANTHROPIC_API_KEY` Bearer, 상세 1건/1회 | api.anthropic.com (표준 fetch, SDK 불요) |
| KOSHA 산업재해(기존) | 공종별 재해통계 근거 | 기존 모듈 재사용 | data.go.kr(연동완료) |

### 조달청 입찰공고 OpenAPI 호출 규격 (⚠ 일부 추정 — 확정 필요)
- 엔드포인트(추정): `https://apis.data.go.kr/1230000/BidPublicInfoService<버전>/getBidPblancListInfoCnstwk`
  - ⚠ 조달청 기관코드 `1230000`·서비스명·**버전 접미사(04/05 등)·공사 오퍼레이션명**은 data.go.kr Swagger/활용가이드(docx)로 **확정 필수**. (KOSHA에서 했던 "키 발급 후 실응답 교정"과 동일 절차)
- 요청 파라미터(추정): `serviceKey`, `numOfRows`, `pageNo`, `inqryDiv`(조회구분), `inqryBgnDt`/`inqryEndDt`(YYYYMMDDHHMM), `type=json`.
- 응답 후보 필드(추정, tolerant `pick` 다중키): 공고번호 `bidNtceNo`, 공고명 `bidNtceNm`, 수요기관 `dminsttNm`/`ntceInsttNm`, 추정가격 `presmptPrce`, 배정예산 `asignBdgtAmt`, 공고일 `bidNtceDt`, 마감 `bidClseDt`, 개찰 `opengDt`, 지역 `prtcptPsblRgnNm`/`cnstrtsiteRgnNm`, 면허 `licenseLmt`/업종 관련.
  - ⚠ 실제 키명은 응답으로 확정. `g2b.ts`의 `pick(row, ['presmptPrce','estimatedPrice', ...])` 다중후보로 흡수.
- 인증키 인코딩: Decoding 키 가정(이미 인코딩된 키면 재인코딩 깨짐 주의 — KOSHA 노트와 동일).

## 데이터 검증 / 보안 규칙
- 입력 검증: `kind ∈ {공사,용역,물품}`, `page/rows` 양의정수 상한(rows≤100), `id` 화이트리스트 패턴.
- 외부 응답: zod로 파싱하되 누락 허용(partial) → 부족 필드는 분석에서 `검토필요`로 강등.
- 인젝션/XSS: 공고문 텍스트는 렌더 시 escape, `dangerouslySetInnerHTML` 금지. LLM 프롬프트에 사용자 입력 직접 삽입 시 구분자/지시 분리.
- 키 노출 금지: `G2B_SERVICE_KEY`/`ANTHROPIC_API_KEY`는 서버 라우트에서만, 클라 번들 유입 금지.
