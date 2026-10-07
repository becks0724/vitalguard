# 젯슨 태블릿 접속 로그 확인 — 2026-09-25

상태: **사용자 수집으로 이관·이번 세션에서는 보류, 서버 로그 미수집**.

9/25 태곤 님 지시: "젯슨은 그럼 내가 받아올테니까 넘어가고". 접속 경로 문의는 종료한다. 로그를 전달받은 뒤 대조한다.

- 확인 대상: 9/25 14:17~14:43 KST의 태블릿 `100.64.0.3` → Jetson 게이트 CAM-03 요청.
- 태블릿 쪽은 이전 세션에서 CCTV 실영상 수신을 확인했으나 게이트 접속 로그 대조는 완료하지 않았다.
- 현재 맥 Tailscale 읽기 결과: `BackendState=Stopped`. 기존 SSH 문서의 호스트는 `jetson@yahboom-1`.
- `cmux ssh-session-list --all-workspaces`: 기존 SSH PTY 세션 없음.
- 읽기 전용 SSH 시도(`BatchMode=yes`, `StrictHostKeyChecking=yes`, 8초 제한): `Could not resolve hostname yahboom-1`.
- 네트워크 설정, Tailscale 연결 설정, 서버 설정을 변경하지 않았다. 사용자에게 기존 접속 가능한 PC·원격 세션·호스트/계정을 문의했다.

접속 가능한 기존 환경에서 사용할 조회(시간대는 UTC 명시, KST 14:10~15:00):

```sh
journalctl -u cctv-gate --since '2026-09-25 05:10:00 UTC' --until '2026-09-25 06:00:00 UTC' --no-pager -o short-iso | grep -F '100.64.0.3'
```

조회 후 시각·클라이언트 IP·`/cctv/stream3`·HTTP 상태를 대조한다. 결과가 0줄이면 서비스명·로그 보존 범위·실제 접속 주소를 확인하며, 곧바로 접속 실패라고 판정하지 않는다.
