# 태블릿 기상 상세 응답 확장 · 2026-09-30

기존 GET /api/app/admin/site-status의 인증·위험 임계·DB 쓰기는 유지한다. 새로운 외부 호출/DB 조회를 추가하지 않고 기존 최신 기상·가스포드1건을 재사용한다.

- `weather.metricLevels`: apparent/wind/rain/uv/pm25는 기존 WeatherStrip의 evaluate* 판정을 normal/warn/danger/null로 전달한다. temperature/humidity/pm10/wbgt는 참고 항목이므로 null. 수신 실패·오래됨·없음은 정상으로 합성하지 않는다. 앱은 경계값을 복제하지 않고 warn=노랑·danger=빨강 네온선만 표시한다. 정상선은 무채색이다.
- `weather.conditions`: PM2.5를 제외한 기존 기상 판정의 level/summary. 기존 최상위 weather.level/summary는 유지하므로 현장 요약의 종합 판정은 변하지 않는다. 대기질은 별도 위젯으로 표시한다.
- `weather.forecast`: 기존 daily7의 최대7개 날짜·WMO weatherCode/기존 한국어 label·highC/lowC·precipitationProbabilityPct. 미수신/비정상 값은 null이며 예보를 생성하지 않는다. 앱은 서버 수신일의 한국 날짜부터7일 칸을 표시하고 없는 날짜는 미수신으로 둔다.
- `gas.environment`: source=gaspod, temperatureC/ humidityPct/pressureHpa, checkedAt, validForMs. gas.deviceId/lastSeenAt과 같은 최신 표본이다. hPa는 기존 IndoorEnvRows와 동일하다. 실외 기상 조회 실패와 독립이다. 표본이 없으면 null.
- 실내 유효기간은 관제와 같은60초를 서버에서 계산해 남은 밀리초로 보낸다. 앱은 서버 checkedAt→최상위 fetchedAt 지연과 응답 수신 후 경과시간만 빼므로 단말 시각 오차를 측정 시각과 직접 비교하지 않는다. 만료/실패/초기 캐시에는 값을 —로 표시한다. 조회 주기는 기존 현장 조회60초를 유지한다.

필드는 모두 읽기 확장이다. 실내 온습도/기압에는 현재 관제의 직접 위험 임계가 없어 임의 네온을 붙이지 않는다. PM10과 WBGT도 동일하다. 새 계약은 신 DB 호환 이식·운영 배포 완료로 간주하지 않는다. 기존 운영 배포 보류를 유지한다.
