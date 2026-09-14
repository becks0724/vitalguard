# TASK-web-ink-render 구현 결과 — 2026-09-13

관제웹의 사진 확대 화면에 최신 잉크 표시와 Y축 뒤집기를 연결했다. 잉크 없는 사진은 기존 `<img>` 분기와 속성을 그대로 사용한다.

## 변경 파일

줄 수는 작업 시작 시 미커밋 상태와 비교한 추가 줄 수다. 기존 변경분은 포함하지 않는다.

| 파일 | 추가 | 삭제 | 내용 |
|---|---:|---:|---|
| `app/components/DemoDashboard.tsx` | 17 | 0 | annotationId 타입·매핑·최신 포인터 갱신·조건부 연결 |
| `app/components/CalendarInkPhoto.tsx` | 79 | 0 | 원본/표시본·지연 조회·로딩/재시도 |
| `app/components/CalendarInkPhoto.module.css` | 70 | 0 | 양면 회전·reduced motion |
| `app/components/InkOverlay.tsx` | 66 | 0 | canvas 크기·DPR·이미지/리사이즈 관찰·버전 안내 |
| `lib/ink-render.ts` | 110 | 0 | 버전/데이터 검사·ARGB·필압·contain 영역·도형 그리기 |
| `lib/calendar-ink.ts` | 39 | 0 | 다운로드 URL/JSON 조회·세션별 메모리 캐시 |
| `lib/ink-render.test.ts` | 126 | 0 | 렌더 규칙 11건 |
| `lib/calendar-ink.test.ts` | 74 | 0 | 조회·캐시·실패·세션 경합 8건 |
| `lib/2026-09-13-calendar-ink.guard.test.ts` | 89 | 0 | 실제 목록/라이트박스 코드 회귀 5건 |
| `lib/2026-09-13-ink-components.test.ts` | 214 | 0 | 실제 컴포넌트 이벤트/effect·회전 CSS 6건 |

코드·테스트 합계 **10개 파일, +884/-0줄**. 이 보고서는 별도 신규 파일이다.

## 렌더 방식과 앱 일치 근거

**Canvas 2D**를 선택했다. 앱 `record_editor.dart`의 `drawCircle`, `drawLine`, `drawRect`를 각각 `arc+fill`, 개별 `moveTo+lineTo+stroke`, `strokeRect`로 대응시킬 수 있다. 획의 수많은 점을 DOM 노드로 만들지 않아도 된다.

- `width × 실제 사진 표시너비 × (0.45 + 0.9 × clamp(pressure, 0, 1))`를 매 점에 적용한다. 첫 점은 반지름이 이 굵기의 절반인 채운 원이다. 이후 선분은 현재 점의 굵기를 사용하며 선끝은 round다.
- 각 점/선분을 별도 경로로 그린다. 형광펜도 각각 source-over 합성하므로 겹친 부분의 알파 누적 순서가 앱과 같다. 하나의 polyline이나 획 전체 opacity로 대체하지 않았다.
- ARGB의 알파를 `/255`로 rgba에 보존한다. 형광펜은 원래 알파에 곱하지 않고 **0.35로 대체**한다.
- 사각형은 첫 점/끝 점의 두 모서리, `width × 표시너비`, 채움 없음이다. 앱 Paint 기본값에 맞춰 모서리는 miter, miterLimit은 4다. 지우개는 건너뛴다.
- 표본 검증: 표시너비 400, width 0.01일 때 필압 0/0.5/1의 굵기는 **1.8/3.6/5.4px**다. 첫 원과 이후 각 선분의 실제 canvas 호출을 검사했다.

## Letterbox 정렬

원본 `naturalWidth/naturalHeight`와 이미지 요소의 변형 전 CSS 크기를 이용한다. 배율은 `min(박스너비/원본너비, 박스높이/원본높이)`이며 좌우·상하 차이의 절반을 오프셋으로 더한다. 좌표는 `left+x×표시너비`, `top+y×표시높이`다.

예를 들어 800×1600 원본을 800×600 박스에 넣으면 사진 영역은 **left=250, top=0, width=300, height=600**이다. 선 굵기도 박스너비 800이 아니라 사진너비 300으로 계산한다.

canvas bitmap은 DPR에 맞춰 반올림하고 실제 bitmap/CSS 크기 비율로 transform을 설정한다. `ResizeObserver`, 이미지 load/error, window resize에 다시 계산한다. Y회전 중 크기가 변하는 `getBoundingClientRect()`는 사용하지 않는다.

## 구현 시 정한 사항

1. 양면은 클릭당 Y축 180도, 480ms ease-in-out, perspective 1200px로 전환한다. 다시 누르면 0도로 돌아간다. 뒷면 자체를 180도 돌려 최종 사진·글자가 거울상으로 보이지 않게 했다.
2. 사진 자체와 별도 `표시본 보기`/`원본 보기` 버튼 모두 전환한다. 브라우저 기본 버튼의 키보드 조작을 사용한다. annotationId가 있는 image에만 적용하며 영상/녹음의 컨트롤과 기존 원본 다운로드는 유지한다.
3. 첫 클릭은 데이터 수신까지 원본과 로딩 안내를 유지한 후 뒤집는다. 로딩 중 버튼을 잠그고, 요청 실패 시 원본과 재시도 버튼을 유지한다. 닫힌 사진의 늦은 응답은 화면에 반영하지 않는다.
4. 기존 `/api/calendar/media/download-url?id=...`로 URL을 받은 뒤 JSON을 직접 읽는다. 각 요청의 제한시간은 15초다. 관리자 Bearer는 첫 요청에만 전달하고 파일 요청은 credentials omit이다.
5. annotationId별 결과와 진행 중 Promise를 메모리에 보관해 재열기/동시 요청도 공유한다. 페이지 재로딩까지 유지하되 세션 토큰 변경 시 비우고, 요청/JSON 파싱 실패는 제거해 재시도한다. localStorage에는 저장하지 않는다.
6. 사진 ID 또는 최신 잉크 ID 변경 시 앞면부터 시작한다. 목록 갱신에서 최신 포인터가 바뀌면 열린 사진에도 적용한다. 변화 없는 사진 객체는 그대로 반환한다.
7. 정확히 숫자 `v:1`만 해석한다. 다른 버전에는 `다른 앱 버전에서 만든 표시입니다. 현재 버전에서는 표시할 수 없습니다.` 안내를 표시한다.
8. v1의 알 수 없는 도구, unsigned 32비트 범위 밖 색, 양수가 아닌 굵기, 유한 숫자 3개가 아닌 점은 전체 렌더를 차단하고 `표시 데이터를 읽을 수 없습니다.`를 보여준다. 부분 렌더는 하지 않는다. 지우개는 이 검사 전에 제외하고 빈 획은 건너뛴다. 좌표 자체는 기록값 그대로 쓰고 필압만 0~1로 clamp한다.
9. `prefers-reduced-motion: reduce`에서는 회전 transform과 transition 모두 없애고 앞/뒷면 visibility를 즉시 바꾼다.

## 검증 결과

- 변경 전: 타입 오류 **0**, 테스트 **1,721/1,721** 통과.
- 변경 후: 타입 오류 **0**, 테스트 **1,751/1,751** 통과, 실패 **0**, 취소 **0**, 건너뜀 **0**. 신규 테스트 **30**.
- 변경한 TS/TSX 9개 파일 ESLint: 오류 **0**, 경고 **0**. `git diff --check` 통과.
- 실행: `./node_modules/.bin/tsc --noEmit`, `node --import tsx --test 'lib/**/*.test.ts' 'app/**/*.test.ts'`. pnpm 실행기가 응답하지 않아 설치된 실행 파일로 package.json의 검사 내용을 실행했다. 설치는 하지 않았다.
- 표본 JSON과 가짜 fetch/DOM/Canvas만 사용했다. 앱 실제 렌더 함수와 도형·좌표·굵기·합성 순서를 대조했다. 브라우저/실기기 PNG의 픽셀 차 비교는 수행하지 못했다.
- 임시 표본 페이지는 설치된 esbuild/Tailwind로 빌드했다. 로컬 서버 listen은 시스템 권한으로 거부됐고, 브라우저 로컬 파일 열기는 자동 보안 검토가 URL 정책을 이유로 거부했다. 브라우저 실화면 검증은 미실시다.
- 작업 전 미커밋 파일들의 해시를 비교했다. DemoDashboard의 위 17줄 추가 외에 기존 변경 파일은 모두 동일하다. 서버 라우트·db.ts·verifyBasicAuth·앱은 변경하지 않았고 커밋/배포도 하지 않았다.

## 완료 기록

**TASK-web-ink-render 완료** — 웹 구현과 자동 검증 완료.

지정된 `Lenova idea tap 12.7/astra-done.txt`에 이 문구를 덧붙이려 했으나 작업공간 밖 쓰기가 `Operation not permitted`로 거부됐다. 해당 파일은 변경되지 않았다.
