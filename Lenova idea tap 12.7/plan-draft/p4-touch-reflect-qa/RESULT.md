# P4 터치 반영 결과

상태: 설계 Markdown 2개 반영 완료. DOCX 2개는 사용자가 변환기를 수정하고 재생성했으며 새 규칙 반영을 읽기 전용으로 확인했다. 옵시디언 4번 항목은 사용자가 취소하고 직접 반영하기로 했으므로 첫 작업은 1~3번 범위로 완료.

## 반영 완료

- artifacts/design-constraints.md:59 — C-2 세로 수치 유지와 가로 수치 보완.
- artifacts/design-constraints.md:67 — C-5 가로 IME 43.5%, 네비바 중복 차감 방지.
- artifacts/design-constraints.md:142 — 원본 실측표, 면 95% 의류 원단 조건, 겹수·두께 미기록, 소표본·이상치 한계.
- artifacts/design-constraints.md:170 — 손가락 축과 장갑 자동감지 불가.
- artifacts/design-constraints.md:180 — T-1 관측 근거·40dp 금지.
- artifacts/design-constraints.md:190 — T-5 세로 간격 약 13dp 초과, 12dp 부족.
- artifacts/design-constraints.md:193 — T-6 핵심 동작 펜 도달 경로.
- artifacts/design-constraints.md:238 — P-4·P-5·P-6 추가.
- app_uIuX_plan.md:27 — 규칙 표 동기화.
- app_uIuX_plan.md:47 — 실측 조건·한계.
- app_uIuX_plan.md:252 — R-04 기존 설명에 P-4~P-6 연결, 설명 중복 방지.
- app_uIuX_plan.md:479 — 부분 해소·실제 장갑 미검증 상태.
- app_uIuX_plan.md:510 — 변경 이력 0.7.

## 원본 반영 미완료

옵시디언 원본은 이 세션의 쓰기 허용 경로 밖이다. 원본에 쓰기를 시도하거나 다른 수단으로 권한을 우회하지 않았다.
정확한 적용본: 태블릿 앱 제작 기록.updated.md
패치: obsidian-note.patch
적용본 행: 47 손가락 축 / 65 P4 편향 항목 7 / 255 장갑 항목 부분 해소 / 287 원칙 추가.

## DOCX 동기화 후속 확인

사용자 후속 조치: md2docx.py에 flock 직렬화와 전용 UserInstallation 프로필을 추가하고 동시 실행 시험을 통과했다. 사용자가 두 DOCX를 재생성했으며, Codex는 재생성 없이 해시 변경과 C-5/T-5/T-6/P-4~P-6, 43.5/13dp/40dp, UI 문서 0.7 반영을 확인했다.
앞으로 soffice를 직접 호출하지 않고 tools/md2docx.py만 사용한다. 이번 확인은 내용 검사이며 페이지 렌더 검증은 아니다.

이하 기록은 사용자 수정 전 실패 이력이다.
요청된 명령 python3 tools/md2docx.py tab_plan.md app_uIuX_plan.md를 실행했다.
LibreOffice가 SIGABRT(exit -6)로 종료됐다. 임시 디렉터리·격리 프로필·headless backend 조건에서도 동일했다.
크래시 기록의 상위 호출은 _RegisterApplication과 NSMenuBarPresentationInstance이며 stdout/stderr는 비었다.
변환기는 기존 DOCX 파일의 존재만 확인해 성공 문구를 출력했지만, 두 DOCX의 SHA-256은 변경 전과 같다.
DOCX 내부에도 새 T-5·13dp가 없어 동기화 실패로 판정했다. 변환기 소스나 DOCX를 직접 수정하지 않았다.
문서 스킬 렌더러는 pdf2image 미설치로 실행 실패했다. 새 패키지는 설치하지 않았다.

## 보호·검증

research/device-facts.md와 tab_plan.md는 SHA-256 동일. app_uIuX_plan.md의 N-1 행은 변경 전과 동일.
정본 규칙 ID는 중복 없으며 C-5·T-5·T-6·P-4~P-6가 정본과 UI 규칙 표에 각각 한 번씩 있다.
세로 26.5% 유지, 가로 43.5%·손가락 축·실제 장갑 미측정·72dp 이상치 조건을 확인했다.
지시서 말미의 1겹 표기는 원본의 겹수·두께 미기록과 충돌하므로 원본 측정 기록을 따랐다.

## 옵시디언 후속 상태

사용자 후속 메시지 이후 원본을 다시 읽었다. 다른 내용은 변경됐지만 7번 장갑 터치 상태는 272행에서 여전히 남음이고 손가락 축/편향 추가 항목은 없다. 원본 적용은 아직 완료되지 않았다. 기존 적용본 전체로 최신 원본을 덮어쓰면 다른 변경을 잃을 수 있으므로, 적용 시 패치의 해당 항목만 최신 원본에 반영해야 한다.

## 사용자 범위 정정

옵시디언 4번은 사용자 지시로 취소됐다. 첫 작업은 1~3번 완료 처리하며 두 번째 STT/ML Kit 지시서에 착수한다. DOCX는 사용자 재생성본을 사용하고 soffice는 직접 호출하지 않는다.
