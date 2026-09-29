# 앱 본인 회원정보 조회

- 경로: `GET /api/app/admin/profile`. 모바일 v2 Bearer만 사용한다. 관제 세션/전체 사용자 관리 API를 앱에 열지 않는다.
- `requireAppAdmin(request, { readOnly: true })`로 현재 승인 상태/관리 권한을 확인하고 인증된 username만 조회한다. 요청의 ID/username 쿼리는 무시한다. 회원 프로필 재조회 시에도 승인/권한을 확인한다.
- 응답: `{ ok: true, profile: { username, name, role, company, department, jobTitle, employeeId, phoneMasked, email } }`. 값이 없으면 null이며 추정/임의 기본값을 넣지 않는다.
- 전화는 서버에서 앞3자리와 뒤2자리만 남긴다.11자리 예시는 `010-****-**70`,10자리는 `031-***-**70`. 원문 phone/보호자/비밀번호/TOTP는 DTO에 없다. 앱도 마스킹 문자열에 숫자가5개만 있는지 재검사한다.
- DB users 행 없는 env owner는 본인의 owner_profile을 조회한다. getOwnerProfile의 새 readOnly 옵션은 기존 getPool SELECT를 사용하고 q/스키마 초기화를 거치지 않는다. 기존 옵션 없는 호출 동작은 유지한다.
- 모든 응답 no-store. 인증401/권한403, DB조회 실패503. 부수 조회 실패로 앱 로그인 정보를 삭제하지 않는다.
- 현재 main의 레거시DB용이다. 신DB app_user/PII암호화 스키마로 그대로 이식됐다고 간주하지 않는다. 신DB 라이브 전환은 이번 범위가 아니다.

검증: 본인 한정 조회·무토큰/유효 legacy 거부·권한 회수·3단계 DB 실패·전화마스킹·readOnly 부작용 검사와 기존 관리자 게이트 합계20/20, TypeScript 전체 타입검사 및 신규 파일 ESLint 통과. 실제 DB/개인정보를 테스트에 사용하지 않았다. Peers 독립 읽기 검토에서 차단급 결함 없음; 지적된 추가 실패/유효 legacy 사례를 보완했다.

아직 라이브 배포 전 준비 상태다. 배포 시 고정 커밋 아카이브를 사용해 공유 작업트리의 다른 미커밋 변경을 포함하지 않는다.
