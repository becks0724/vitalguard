// 워치 출처 계약 가드 — 워치가 보내는 source 를 서버가 알아보는가, 그리고 기기를 갈라 놓는가
//
// ★ 왜 필요한가. 두 방향의 사고가 실재한다.
//   ① **유실.** 서버는 미분류 source 를 저장하지 않고 버리는데(store.ts `classifyVitalDataOrigin`
//      → null), 그 거부는 `persistFailed` 를 세우지 않는다. 워치는 201 을 성공으로 읽고 큐에서
//      원본을 지운다. 즉 워치의 sourceTag 만 먼저 바꾸면 **배포 전까지 전량 조용히 사라진다.**
//   ② **혼입.** 갤럭시(Wear OS)와 애플(watchOS)이 같은 source 를 쓰면 DB 에서 구분이 불가능해진다.
//      두 기기는 체온의 성격이 다르다 — 갤럭시는 손목 온도를 **실측**해 보내고, 애플은 실시간
//      송출이 없어 손목값에 고정 오프셋을 더한 **추정**이다. 섞이면 되짚을 수 없다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **워치가 보내는 sourceTag 가 서버 화이트리스트에 실재하고, 갤럭시와 애플이 서로 다른
//   dataOrigin 으로 떨어지며, 그 origin 이 스키마 열거형에 등재돼 있다.**
//   보장하지 않는 것 = 배포 순서(서버가 먼저 떠 있는가). 그것은 사람이 지킨다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const WEAR = join(
  here, "..", "..", "vitalguard_app", "android", "wear",
  "src", "main", "kotlin", "com", "vitalguard", "wear",
);
const upload = readFileSync(join(WEAR, "pipeline", "UploadPipeline.kt"), "utf8");
const store = readFileSync(join(here, "..", "app", "api", "app", "vital", "store.ts"), "utf8");
const schema = readFileSync(
  join(here, "..", "..", "..", "packages", "schemas", "src", "vital-stream.ts"), "utf8",
);
const db = readFileSync(join(here, "db.ts"), "utf8");

/** 주석을 걷어낸 본문에서만 검사한다 — 이름이 주석에 남아도 통과하면 가드가 아니다([[L-104]]). */
const codeOnly = (src: string) => src.replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\/\/\/.*$/gm, "");
const uploadCode = codeOnly(upload);
const storeCode = codeOnly(store);
const schemaCode = codeOnly(schema);
const dbCode = codeOnly(db);

/** `classifyVitalDataOrigin` 본문만 잘라낸다 — 파일 전체에서 case 를 세면 남의 switch 가 섞인다. */
function classifyBody(): string {
  const at = storeCode.indexOf("export function classifyVitalDataOrigin");
  assert.notEqual(at, -1, "classifyVitalDataOrigin 이 사라졌다 — 출처 확정 지점이 옮겨졌다");
  const rest = storeCode.slice(at);
  const end = rest.indexOf("\n}");
  assert.notEqual(end, -1, "classifyVitalDataOrigin 본문의 끝을 못 찾았다");
  return rest.slice(0, end);
}

/** switch 의 `case "X":` 문자열을 그 아래 처음 나오는 return 값과 짝지어 뽑는다. */
function sourceToOrigin(): Map<string, string> {
  const body = classifyBody();
  const out = new Map<string, string>();
  let pending: string[] = [];
  for (const line of body.split("\n")) {
    const c = /case\s+"([^"]+)"\s*:/.exec(line)?.[1];
    if (c !== undefined) { pending.push(c); continue; }
    const r = /return\s+"([^"]+)"/.exec(line)?.[1];
    if (r !== undefined && pending.length > 0) {
      for (const s of pending) out.set(s, r);
      pending = [];
    }
  }
  return out;
}

test("★ 워치가 보내는 sourceTag 를 서버가 알아본다 — 모르면 조용히 버려진다", () => {
  const tag = /sourceTag\s*=\s*"([^"]+)"/.exec(uploadCode)?.[1];
  assert.ok(tag, "UploadPipeline 에서 sourceTag 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 따라가야 한다");

  const map = sourceToOrigin();
  assert.ok(map.size >= 4, `화이트리스트가 비었거나 파싱이 깨졌다(추출 ${map.size}건)`);

  assert.ok(
    map.has(tag),
    `워치 sourceTag "${tag}" 가 서버 화이트리스트에 없다 — 이대로 배포하면 ` +
      `store.ts 가 null 을 돌려 샘플을 버리고, persistFailed 를 안 세우므로 워치가 큐를 비운다(유실). ` +
      `알려진 값: ${[...map.keys()].join(", ")}`,
  );
});

test("★ 갤럭시와 애플이 서로 다른 출처로 떨어진다 — 같으면 체온의 성격이 섞인다", () => {
  const map = sourceToOrigin();
  const galaxy = map.get("VitAlGuard-GalaxyWatch");
  const apple = map.get("VitAlGuard-WatchVitals");

  assert.equal(galaxy, "wearos_data_vitalguard", "갤럭시 출처 매핑이 사라졌거나 바뀌었다");
  assert.equal(apple, "watchos_data_vitalguard", "애플 출처 매핑이 회귀했다");
  assert.notEqual(
    galaxy, apple,
    "갤럭시와 애플이 같은 dataOrigin 으로 접혔다 — 실측 체온과 추정 체온을 DB 에서 가를 수 없게 된다",
  );
});

test("★ 분류가 내놓는 실기기 출처를 적재 관문이 전부 받는다 — 안 받으면 accepted 인데 저장이 없다", () => {
  // 2026-08-25 실사고. schemas·classify·컬럼 셋만 맞추고 배포했더니 실기에서
  // `{"accepted":1,"persistFailures":1}` 가 났다 — `persistSample` 이 출처 화이트리스트를
  // **따로** 들고 있었고 거기에 wearos 가 없었다. 관문은 넷인데 셋만 봤다.
  // 이 시험이 없으면 매핑이 맞는 한 CI 는 초록이고, 적재 거부는 실기에서만 드러난다.
  const at = dbCode.indexOf("REAL_DEVICE_ORIGINS");
  assert.notEqual(at, -1, "db.ts 의 REAL_DEVICE_ORIGINS 가 사라졌다 — 적재 관문이 옮겨졌다");
  const accepted = new Set(
    (dbCode.slice(at, dbCode.indexOf("]", at)).match(/"([a-z_]+)"/g) ?? [])
      .map((s) => s.replace(/"/g, "")),
  );
  assert.ok(accepted.size >= 3, `적재 허용목록 파싱이 깨졌다(추출 ${accepted.size}건)`);

  for (const origin of new Set(sourceToOrigin().values())) {
    if (origin.startsWith("mockup_")) continue; // 목업은 data_mockup 으로 따로 간다
    assert.ok(
      accepted.has(origin),
      `분류는 "${origin}" 을 내놓는데 persistSample 이 안 받는다 — 실기에서 accepted 뒤 ` +
        `persistFailures 가 난다. db.ts REAL_DEVICE_ORIGINS 에 더할 것. 현재: ${[...accepted].join(", ")}`,
    );
  }
});

test("★ 서버가 돌려주는 출처가 스키마 열거형에 실재한다 — 없으면 파서가 거부한다", () => {
  const at = schemaCode.indexOf("VITAL_DATA_ORIGINS");
  assert.notEqual(at, -1, "VITAL_DATA_ORIGINS 가 사라졌다");
  const listed = new Set(
    (schemaCode.slice(at, schemaCode.indexOf("as const", at)).match(/"([a-z_]+)"/g) ?? [])
      .map((s) => s.replace(/"/g, "")),
  );
  assert.ok(listed.size >= 5, `열거형 파싱이 깨졌다(추출 ${listed.size}건)`);

  for (const origin of new Set(sourceToOrigin().values())) {
    assert.ok(
      listed.has(origin),
      `store.ts 가 "${origin}" 을 돌려주는데 스키마 열거형에 없다 — 등재: ${[...listed].join(", ")}`,
    );
  }
});
