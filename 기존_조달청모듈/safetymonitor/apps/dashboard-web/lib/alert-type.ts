// 관제 알림 종류 — 저장(db)·전송(telegram) 양쪽이 함께 쓰는 유니온.
//
// ★ db.ts 에서 떼어낸 이유 = **순환 의존**(2026-08-22).
//   db 가 알림을 기록하며 telegram 으로 보내는데, telegram 이 이 타입을 쓰려고 다시 db 를 불렀다.
//   되돌아오는 간선이 `import type` 이라 컴파일 후엔 지워졌지만 정적 그래프에는 순환으로 남았다.
//   타입을 여기로 내리면 두 파일이 모두 이 모듈만 바라본다.
//
// ⚠ 이 타입을 db.ts 로 되돌리지 말 것. 되돌리면 순환이 되살아나고 `pnpm graph:check` 가 빨개진다.

// ★ `absence` 만 성격이 다르다 — 나머지는 **샘플이 들어올 때** 발화하는데 이것은 **안 들어와서**
//   발화한다. 그래서 수신 경로가 아니라 크론(`/api/cron/absence-check`)이 넣는다.
export type AlertType = "sos" | "fall" | "vital" | "geofence" | "absence";
