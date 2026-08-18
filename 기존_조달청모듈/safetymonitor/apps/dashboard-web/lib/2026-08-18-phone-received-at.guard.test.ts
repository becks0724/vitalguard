// 폰 수신 시각 보존 가드(watch-delivery-lag E-2) — 세 시각 중 하나가 조용히 사라지지 않게 못 박는다.
//
// 왜 필요한가. 이 트랙의 모든 진단이 **세 시각의 분리** 위에 서 있다.
//   측정(heart_rate_measured_at) → 폰 수신 → 서버 도착(received_at)
// 08-18 시험 B 가 거리 가설을 확정한 것도 `ts − heart_rate_measured_at`(= 워치→폰 구간)이었다
// (무이동 통제 창 최장 5초 vs 20m·벽 너머 최장 332초).
//
// 그런데 2026-08-15 결정으로 **ts 계약이 전송 시각 → 측정 시각으로 바뀌게 돼 있다**(무음 유실 2.4%를
// 없애기 위해서다). 옮기는 순간 `ts − heart_rate_measured_at` 은 **항상 0** 이 되고, 그러면 이 지표는
// 값이 틀리는 게 아니라 **아예 사라진다** — 화면에도 경보에도 신호가 없는 형태다.
// 그래서 옮기기 **전에** 폰 수신 시각을 받을 자리를 먼저 만든다(L-64 가 정확히 이 상황의 교훈이다).
//
// 이 가드가 지키는 것 둘.
//
//  ① 트리오가 함께 있다 — 스키마 필드 · DB 컬럼 · insert 매핑.
//     **셋 중 하나만 빠져도 값은 조용히 사라진다**(감사 BND-CONTRACT-01). 이 레포는 같은 형태로
//     세 번 당했다 — `mlFallPipelineActive`, 낙상 ML 텔레메트리, 그리고 `locationAccuracyMeters`
//     (구 앱이 이미 보내고 있었는데 스키마에 없어 GPS 21만 행에 품질 지표가 하나도 없다).
//
//  ② 폴백이 남아 있다 — 앱이 아직 이 필드를 안 보내는 동안 `ts` 가 곧 폰 수신 시각이다.
//     폴백을 지우면 컬럼이 전부 NULL 로 채워져 "자리는 만들었는데 값이 없는" 상태가 된다.
//
// ⚠ 이 가드가 잡지 못하는 것 — **ts 계약을 바꾸는 앱 변경이 phoneReceivedAt 전송을 동반하는지**는
//   서버 소스만으로 알 수 없다. 그때는 폴백이 측정 시각을 폰 수신 시각 자리에 넣어 지연이 0 으로
//   굳는다. 앱 변경 시 반드시 함께 넣을 것 — 소스 주석 두 곳(vital-stream.ts · db.ts)에도 박아 뒀다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const schema = readFileSync(
  join(ROOT, "..", "..", "packages", "schemas", "src", "vital-stream.ts"),
  "utf8",
);

test("① 스키마 — phoneReceivedAt 필드가 있다(없으면 Zod 가 strip 해 서버에 도달조차 못 한다)", () => {
  assert.match(
    schema,
    /phoneReceivedAt:\s*z\.string\(\)\.datetime\(\)\.optional\(\)/,
    "스키마 필드가 사라졌다 — 앱이 보내도 Zod 가 버리고 raw_json 에도 안 남는다",
  );
});

test("① DB 컬럼 — phone_received_at 을 ensureSchema 가 만든다", () => {
  assert.match(
    db,
    /ADD COLUMN IF NOT EXISTS phone_received_at TEXT/,
    "컬럼 DDL 이 사라졌다 — 스키마가 받아도 저장할 자리가 없다",
  );
});

test("① insert 매핑 — 컬럼이 실제로 채워진다", () => {
  assert.match(
    db,
    /phone_received_at:\s*sample\.phoneReceivedAt/,
    "insert 매핑이 사라졌다 — 컬럼은 있는데 전부 NULL 이 된다(가장 알아채기 어려운 형태)",
  );
});

test("② 폴백 — 앱 전송 전에는 ts 로 채운다(지우면 컬럼이 통째로 비어 있게 된다)", () => {
  assert.match(
    db,
    /phone_received_at:\s*sample\.phoneReceivedAt\s*\?\?\s*sample\.ts/,
    "ts 폴백이 사라졌다 — 앱이 보내기 전까지 값이 하나도 안 쌓인다",
  );
});

test("★ 근거가 소스에 남아 있다 — 왜 세 시각을 나누는지(지우면 다음 사람이 컬럼을 정리한다)", () => {
  assert.match(db, /세 시각/, "db.ts 에서 근거 주석이 사라졌다");
  assert.match(schema, /세 시각/, "vital-stream.ts 에서 근거 주석이 사라졌다");
});
