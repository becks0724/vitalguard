# VitAlGuard 관리자 앱

관제웹의 작업자 현황을 폰에서 **보기 위한** 앱이다. 생체를 수집하지 않고 경보를 조작하지도 않는다.

- 로그인 = 관제웹과 같은 2단계 인증 (`/api/mobile/v1/session/login`)
- 현황 = `/api/app/admin/workers` — 서버가 판정한 `tone`·`label`·`counts` 를 그리기만 한다
- 네이티브 코드 0줄 — HTTP 로 서버에 직접 붙는다(작업자 앱의 `vitalguard/bridge` 를 안 쓴다)

왜 이렇게 만들었는지는 [context-notes.md](./context-notes.md), 남은 일은 [checklist.md](./checklist.md).

## 개발

```
dart analyze     # ⚠ flutter analyze 는 이 레포의 한글 경로에서 죽는다 — context-notes 참조
flutter test
flutter build apk --debug
```

서버를 바꿔 붙이려면 `--dart-define=VG_BASE_URL=http://...` 를 준다.
