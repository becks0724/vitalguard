# 태블릿 기상 효과 응답 계약 · 2026-09-29

`GET /api/app/admin/site-status`의 `weather`에 표시 전용 필드를 추가한다. 기존 인증·관제 위험 임계·DB 쓰기·외부 요청 수는 바꾸지 않는다.

| 필드 | 의미 |
|---|---|
| current.precipitationType | 기존 기상청 초단기실황 응답의 PTY. 허용 코드 0/1/2/3/5/6/7. 미수신·비정상·구 DB 폴백이면 생략 |
| effects.precipitation | none / rain / snow / mixed / unknown. 기상청 출처만 사용 |
| effects.precipitationSource | kma-ncst 또는 null |
| effects.windDanger | 관제 `evaluateWindKmh(평균 km/h, 돌풍 km/h)`의 danger 판정. 종합 위험 단계로 추측하지 않음 |

0=없음, 1·5=비, 3·7=눈, 2·6=혼합이다. 값이 없으면 unknown이며 맑음으로 간주하지 않는다. WMO weatherCode와 PTY는 별도 코드다. 신 DB weather_reading.weather_code에 PTY를 대입하지 않는다.

앱은 기상 상세가 전면에 있고 온라인·수신 성공·weather.stale=false·persisted 아님·서버 fetchedAt 기준 0~299초인 동안만 효과를 켠다. 다른 탭·백그라운드·오래된 값·실패에서는 중지한다. 이는 5분 이내 현장 실측이라는 뜻이 아니다. 기상청 실황 관측은 40~100분 늦을 수 있으므로 관측 출처·obsAt을 별도로 표시한다.

단일 배경 Canvas에서 약 30fps로 제한하고 기존 캐시 배경 흐림을 유지한다. 카드별 blur 또는 애니메이션 네트워크 호출은 없다. 시스템 애니메이션 배율 0에서는 효과가 꺼진다. 맑음·일반 흐림에는 지속 효과가 없다.

공식 근거: [초단기실황 서비스](https://www.data.go.kr/data/15084084/openapi.do), [초단기 강수형태 코드](https://data.kma.go.kr/data/rmt/rmtList.do?code=410&pgmNo=571).

검증: 관련 서버 테스트44/44, TypeScript·ESLint 통과. 관제/app weather 함수 본문 동등성 가드 통과. 신규 계약은 신 DB 준비 이미지의 검증 범위에 아직 포함되지 않는다. 배포 여부는 실제 리비전 확인 후 별도 기록한다.
