# 1.3.14 기상 효과 배경 계층·가장자리 음영·21st 검토

## 사용자 정정

효과는 카드 내부가 아니라 현장 배경 사진 위·전체 카드 패널 아래에 둔다. 비/눈/위험 강풍 중에는 화면 네 가장자리를 어둡게 하고, 균등한 점/곡선보다 자연스럽고 불규칙한 표현을 쓴다.

## 21st MCP 검색·시각 검토

기존 등록된21st MCP의 무료 search로 rain/snow/wind/weather를 검색했다. Rain, Snow Flakes와 Animated Weather Icons를 찾았으며, 실제21st 페이지의 동작 미리보기를 Chrome에서 확인했다. 코드 유료 조회/구매/React 의존성 설치는 하지 않았다. 이 앱은 Compose이므로 확인한 시각적 방식을 네이티브 배경 Canvas에 맞춰 구현했다.

- [Rain](https://21st.dev/@designali-in/components/rain): 촘촘하고 가는 빗줄기의 길이/농도 차이를 참고했다. 소리/번개는 요청 범위에 넣지 않았다.
- [Snow Flakes](https://21st.dev/@designali-in/components/snow-flakes): 크기/속도/불투명도/풍향 변화를 참고했다. 큰 눈꽃 문자는 사용하지 않고 부드러운 눈 입자로 구현했다.
- [Animated Weather Icons](https://21st.dev/@dev.yadhakim/components/animated-weather-icons)는 아이콘용이라 사진 배경 확대에는 맞지 않는다. [Animated Leaves](https://21st.dev/@designali-in/components/animated-leaves)도 실제 미리보기를 확인했지만 화려한 장식 입자여서 채택하지 않았다.
- 검색에서 현장 사진에 맞는 바람 전용 컴포넌트는 찾지 못했다. 별도로 넓은 옅은 먼지 흐름+빠른 작은 입자로 재구성하고 짧은 흰 곡선은 제거했다.

## 구현

- WeatherBackground를 DashboardWorkspace 내부에서 DashboardBackdrop의 사진 바로 위로 이동했다. 카드/전체 흐림 패널/사이드바는 그 위에서 합성된다.
- 비320개 가는 농도 차이 빗줄기, 눈168개 크기/속도/흔들림/깊이 차이, 바람은4개 넓은 먼지 층+144개 작은 입자다. 지속되는 독립 곡선은 없다.
- 가장자리 음영 브러시는 화면 크기/기상별 캐시한다. 바람 먼지는512×192 작은 노이즈 투명 텍스처를 CPU에서 한 번 만들고 공유한다. 프레임마다 흐림 셰이더/노이즈를 계산하지 않는다. 업데이트는약30fps이며 기상 상세를 벗어나거나 앱을 내리면 멈춘다.
- 미리보기와 실제 효과는 같은 코드이며 서버 수치/판정/경보 쓰기를 바꾸지 않는다.

검증: JVM320/320·프리뷰33/33 통과. 실기기 미리보기/배경 범위 검사1/1(6.365초) 통과: 효과 bounds가 전체 사진 bounds와 같고 큰 패널보다 넓음, 비/눈/강풍 선택·실제 값 보존·닫기/다른 탭에서 효과 종료·서버 쓰기0. 운영 서버 신규 프로필/effects 반영 승인은 여전히 응답 대기다.

정식1.3.14/code19 데이터 보존 설치 **23:54:41 KST**, 최초 설치2026-09-16 12:50:57 유지·COLD276ms. release59,830,128B SHA-256 `ea3d5ca0bad8c429d4fcc1cdd26ecc2fa3f5b3c9b60f5fb8b4c3fb56e31a3522`.
