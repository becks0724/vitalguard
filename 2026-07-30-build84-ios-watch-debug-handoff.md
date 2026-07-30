# Build 84 iPhone·Apple Watch 디버깅 인수인계

작성일: 2026-07-30
대상: VitAlGuard iPhone·Apple Watch·관제웹 담당자

## 요약

커밋 `4b3359e`에서 사라진 iPhone 어시스턴트의 서버 작업 목록 계약을 복원했고, 같은 변경 범위에서 발견한 iPhone 앱 잠금 우회와 Apple Watch 낙상 경보 억제 회귀를 수정했다.

관제웹의 목업 DB 격리(`store.ts`, `db.ts`)는 이 작업에서 수정하지 않았다. 전달 문서의 판단대로 서버 격리 동작은 기존 변경을 우선하며, 현재 워킹 트리에 있는 서버 변경은 다른 작업자의 범위로 보존했다.

## 수정한 범위

| 표면 | 파일 | 수정 내용 |
| --- | --- | --- |
| iPhone 어시스턴트 | `apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/2026-07-24-VitAlGuardAssistant.swift` | 서버 채팅 계약, 후속 작업자 ID, `taskSummaries` 표 렌더링을 복원했다. |
| iPhone 어시스턴트 | 같은 파일 | 첨부 파일명과 원본을 서버/LLM 질문에 포함하지 않도록 제거했다. 화면에는 첨부 개수만 남긴다. |
| iPhone 앱 잠금 | `apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/VitAlGuardPreviewApp.swift` | 설정 모달이 열린 채 앱을 재개해도 최상위 화면에 잠금 화면을 표시하도록 수정했다. |
| Watch 낙상 경보 | `apps/VitAlGuard-iOS-WatchOS-App/Watch/Sources/WorkoutManager.swift` | 미해결 낙상 ID에 5분 TTL과 작업자 ID 범위를 추가하고, 모든 최종 처리 경로에서 키를 제거한다. |

## iPhone 어시스턴트 계약 복원

`/api/assignment/chat` 서버는 계속 `taskSummaries`와 `assignments`를 반환하고 있었지만, build 84 iPhone 클라이언트가 이를 받거나 표시하지 않았다. 다음을 복원했다.

- `ChatMessage.taskSummaries`, `TaskSummary`, `AssignmentChatContract`, `AssignmentChatResponse`
- 앱 진입과 대화 새로고침 시 `refreshChatContract()` 호출
- 이전 응답이 단일 작업자일 때만 `followUpWorkerIds`를 다음 질의에 전달
- 보조 답변 버블 안의 `서버 판정 작업 목록` 표
- 서버 응답 출처 표시

첨부 동작은 서버 계약과 분리했다. 선택한 파일의 이름, 경로, 원본은 대화 요청에 넣지 않는다. 이는 외부 LLM 경계로 파일명에 포함될 수 있는 개인정보·현장정보가 전달되는 것을 막기 위한 조치다.

## iPhone·Watch 안전 회귀 수정

### iPhone 앱 잠금

기존에는 앱이 다시 활성화될 때 설정 시트 같은 모달이 이미 열려 있으면 잠금 화면을 표시하지 않고 반환했다. 이후 설정 시트를 닫으면 인증 없이 앱 내용이 노출될 수 있었다.

이제 표시 중인 내비게이션/탭/모달의 최상위 컨트롤러를 찾아 그 위에 전체 화면 잠금을 표시한다.

### Apple Watch 낙상 경보

미해결 낙상 ID가 `UserDefaults`에 남으면 이후 낙상 후보도 계속 억제될 수 있었다. 다음 조건에서 저장 상태를 제거한다.

- 저장 후 5분 경과
- 현재 작업자 ID와 저장 당시 작업자 ID가 다름
- 수동 SOS, 자동 에스컬레이션, 해제, 안전 보류 등 모든 낙상 프롬프트 종료

따라서 이전 작업자나 이전 세션의 상태가 새 작업자의 실제 낙상 경보를 장기간 막지 않는다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| 대시보드 타입 검사 `pnpm typecheck` | 통과 |
| `2026-07-29-hyperclova-secret-boundary.test.ts` | 10/10 통과 |
| iPhone `VitAlGuard` Simulator 빌드·설치·실행 | 통과 |
| Apple Watch `VitAlGuard Watch` Simulator 빌드·설치·실행 | 통과 |
| iPhone 챗봇 화면 | 서버 계약 환영 문구 표시 확인 |
| Watch 관리자 관제 화면 | 연결 상태 및 관제 요약 표시 확인 |

자동 UI 도구의 한글 키보드 레이아웃 문제로 실제 한국어 작업자 질의를 전송해 서버가 반환한 표를 화면에서 촬영하는 단계는 수행하지 못했다. 다만 해당 데이터 흐름과 버블 렌더링은 위 회귀 테스트 10건에서 검증했다. 실제 기기 또는 일반 Simulator 키보드에서 `EMP-…` 질의 1건을 보내 표 표시를 최종 확인하면 된다.

## 목업 DB·배포 경계

`양지후 전달.md`의 기준을 따른다.

- 서버는 이미 `VitAlGuard-Mock-iOS`, `VitAlGuard-Mock-Watch`를 `data_mockup`으로 분리하는 경로를 보유한다는 전제를 유지한다.
- `store.ts`, `db.ts`의 현재 워킹 트리 변경은 이 작업에서 건드리지 않았다.
- 새 `mockup_vitalguard_db` 또는 별도 테이블을 추가하지 않았다. `data_mockup` 대체/병행 정책은 관제웹·Cloud Run 담당자의 결정 후 진행한다.
- 커밋, push, Cloud Run 배포는 수행하지 않았다. 배포 시에는 `latest` 대신 이미지 digest, 0% 리비전 검증 후 트래픽 전환 원칙을 사용한다.

## 회원가입/권한 모델 상태

요청된 플랫폼 관리자·회원사 관리자·작업자·현장 단위 권한 모델은 구현 가능하나, 이번 변경에는 포함하지 않았다. 구현 시에는 다음을 분리해야 한다.

- 플랫폼 관리자 승인 권한과 회원사/현장 권한
- 회원사 목록과 회원사 소속 회원
- 현장별 협력 관리자 권한
- 표시 이름이 아닌 실제 로그인 ID를 기준으로 하는 초기 관리자 시드

## 다음 담당자 체크리스트

1. 실제 iPhone 또는 일반 Simulator 키보드에서 `EMP-…` 질의를 보내 `서버 판정 작업 목록` 표를 확인한다.
2. 앱 잠금을 활성화한 뒤 설정 시트를 연 상태에서 앱 전환·복귀하여 잠금이 시트 위에 표시되는지 확인한다.
3. Watch에서 낙상 프롬프트의 수동 SOS와 자동 에스컬레이션 후 다음 후보가 정상적으로 경보되는지 확인한다.
4. 서버 목업 DB 정책(`data_mockup` 대체 또는 병행)을 확정하기 전에는 `store.ts`·`db.ts`를 중복 수정하지 않는다.
5. 변경사항을 검토한 뒤 필요한 파일만 별도 커밋·push한다. 이 문서 작성 시점에는 커밋과 push를 하지 않았다.

## 워킹 트리 주의

이 레포에는 Flutter/Wear OS, Watch 설정, 관제웹 목업 저장소와 DB 관련의 기존 미커밋 변경이 있다. 이 문서의 수정 범위가 아닌 파일은 되돌리거나 덮어쓰지 않았다.
