# 3. DB 저장 확장 가이드 (영구 저장 원할 때)

대시보드 DB = **PostgreSQL** (`lib/db.ts`, DATABASE_URL, pg Pool).
스키마는 `ensureSchema()` 안에서 `CREATE TABLE IF NOT EXISTS`로 멱등 생성되는 구조라, 아래만 추가하면 됩니다.

## ① lib/db.ts — ensureSchema() 안에 테이블 추가
(다른 CREATE TABLE들 뒤에 이어붙이기 — `${NOW_ISO}`는 파일 내 기존 상수 그대로 사용)
```sql
    -- 가스포드 텔레메트리 — ESP32가 5초 주기 POST (state = CLEAR/WARNING/DANGER)
    CREATE TABLE IF NOT EXISTS gaspod_telemetry (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      o2 REAL, temp REAL, humidity REAL, pressure REAL,
      mq7_raw INTEGER, mq136_raw INTEGER, vbat REAL,
      state TEXT NOT NULL,
      acked BOOLEAN NOT NULL DEFAULT FALSE,
      received_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
```

## ② lib/db.ts — 함수 2개 추가 (기존 env_alert_ack 패턴 답습)
```ts
export type GaspodTelemetryRow = {
  id: number; device_id: string;
  o2: number | null; temp: number | null; humidity: number | null; pressure: number | null;
  mq7_raw: number | null; mq136_raw: number | null; vbat: number | null;
  state: string; acked: boolean; received_at: string;
};

export async function insertGaspodTelemetry(input: {
  deviceId: string; o2: number; temp: number; humidity: number; pressure: number;
  mq7Raw: number; mq136Raw: number; vbat: number; state: string; acked: boolean;
}): Promise<void> {
  const pool = await getPool();   // 파일 내 기존 pool 획득 방식 그대로
  await pool.query(
    `INSERT INTO gaspod_telemetry (device_id, o2, temp, humidity, pressure, mq7_raw, mq136_raw, vbat, state, acked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [input.deviceId, input.o2, input.temp, input.humidity, input.pressure,
     input.mq7Raw, input.mq136Raw, input.vbat, input.state, input.acked],
  );
}

export async function listGaspodTelemetry(limit: number): Promise<GaspodTelemetryRow[]> {
  const pool = await getPool();
  const r = await pool.query(
    "SELECT * FROM gaspod_telemetry ORDER BY received_at DESC, id DESC LIMIT $1", [limit]);
  return r.rows as GaspodTelemetryRow[];
}
```
> `getPool()` 이름은 파일 내 실제 pool 획득 함수명에 맞춰 조정 (기존 함수들이 쓰는 방식 그대로).

## ③ route.ts를 DB 버전으로 — 동봉된 `route_db.ts` 사용
메모리 버전(`route.ts`) 대신 `route_db.ts` 내용을 쓰면 영구 저장됩니다.

## 선택 기준
| | 메모리 버전 (route.ts) | DB 버전 (route_db.ts) |
|---|---|---|
| 난이도 | 파일 1개 복붙 | db.ts 수정 필요 |
| 데이터 | 최근 1시간, 재시작 시 소실 | 영구 (산업재해 자료 축적 방침과 일치) |
| 권장 | **시연이 급할 때** | 시간 있을 때 정식으로 |
