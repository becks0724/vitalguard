// 각인 좌표 대조 가드 — 사진에 구워진 좌표가 틀렸을 때 화면이 그 사실을 말하게 고정한다
//
// ★ 무엇이 있었나(2026-08-21 실측). 각인 좌표가 실제와 크게 어긋난 사진이 둘 있었다 —
//   **08-19 5,239m** · 08-20 336m(지하 2층 촬영, 사용자 제보). 원인은 앱 각인 경로의
//   정확도 게이트 부재다. `requestFreshFix` 는 세 경로 전부 정확도를 안 보고 돌려주는데,
//   그 좌표는 `latestFix` 에 들어가지도 못한 것이었다(= 100m 게이트를 통과 못 했다).
//   같은 시각 **추적 좌표는 정확도 10m** 로 실제에서 149m 였다 — 폰은 더 나은 값을
//   들고 있었는데 각인이 나쁜 것을 골랐다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **미디어 조회가 각인 좌표를 같은 시각 생체 좌표와 대조해 거리를 내고, 화면이 그것을
//   읽어 관제 반경을 넘으면 경고로 그린다.**
//   보장하지 않는 것 = 각인 자체가 고쳐지는가(이미지라 못 고친다 · 앱 수정은 08-26 묶음) ·
//   대조 대상이 없는 사진(워커·생체 좌표 부재 20/40건)에 무엇이 보이는가(아무것도 안 보인다).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_RADIUS_MAX_M } from "./site-radius";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");

/** 주석을 걷어낸 본문 — 이름이 주석에만 남아도 통과하는 약한 단언을 막는다(L-104). */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** `listCalendarMedia` 본문만 — 파일 전체에서 찾으면 다른 쿼리에 걸린다. */
function listMediaBody(): string {
  const start = db.indexOf("export async function listCalendarMedia(");
  assert.ok(start >= 0, "listCalendarMedia 를 못 찾았다 — 조회 경로가 옮겨졌다");
  const end = db.indexOf("\nexport ", start + 10);
  return db.slice(start, end > 0 ? end : undefined);
}

test("★ 미디어 조회가 각인 좌표를 생체 좌표와 대조한다", () => {
  const body = listMediaBody();
  assert.match(body, /LEFT JOIN LATERAL/, "대조 조인이 사라졌다");
  assert.match(body, /FROM vital_samples v/, "생체 좌표를 안 본다");
  assert.match(body, /AS coord_gap_m/, "거리 컬럼을 안 낸다");
  assert.match(body, /AS coord_ref_accuracy_m/, "대조에 쓴 좌표의 정확도를 안 낸다");
  // 같은 작업자·같은 시각이어야 대조가 성립한다. 둘 중 하나만 빠져도 엉뚱한 값과 잰다.
  assert.match(body, /v\.worker_id = m\.worker_id/, "작업자를 안 맞춘다");
  assert.match(body, /interval '3 minutes'/, "시간 창이 사라졌다");
});

test("★ ts 는 문자열 범위로 훑는다 — 캐스팅하면 인덱스를 잃고 39만 행을 미디어마다 본다", () => {
  const body = listMediaBody();
  // `ts` 는 ISO-UTC TEXT 라 문자열 비교 = 시간 비교다. 경계를 ts 와 같은 형식으로 만들어야
  // `uq_vs_worker_ts` 인덱스를 탄다. 실측 = Index Scan · 총 1.9ms.
  assert.match(
    body,
    /v\.ts >= to_char\(/,
    "하한을 문자열로 안 만든다 — 캐스팅 비교로 되돌아가면 조용히 느려진다",
  );
  assert.match(body, /YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"/, "ts 형식(밀리초 포함)과 안 맞춘다");
  // WHERE 절에서 v.ts 를 캐스팅하면 인덱스를 못 쓴다. ORDER BY 의 캐스팅은 이미 좁혀진
  // 수십 행에만 걸리므로 무해하다 — 그래서 WHERE 쪽만 금지한다.
  const where = body.slice(body.indexOf("WHERE v.worker_id"), body.indexOf("ORDER BY abs("));
  assert.ok(
    !/v\.ts::timestamptz/.test(where),
    "WHERE 에서 v.ts 를 캐스팅한다 — 인덱스를 잃는다",
  );
});

test("★ 화면이 그 값을 실제로 읽는다 — 계산만 하고 안 쓰면 없는 것과 같다(L-91)", () => {
  const code = codeOnly(dash);
  assert.match(code, /coordGapM: r\.coord_gap_m/, "응답을 화면 모델로 안 옮긴다");
  // ⚠ 맨 이름(`/media\.coordGapM/`)으로 재면 **렌더 조건을 `false` 로 죽여도 통과한다** —
  //   그 이름이 조건문 안쪽에도 여러 번 나오기 때문이다. 작성 중 변이시험에서 실제로
  //   살아남았다(L-104). 그래서 **렌더 관문 자체**와 **행이 실제로 밀려 들어가는 지점**을 짚는다.
  assert.match(
    code,
    /if \(media\.coordGapM != null\)/,
    "렌더 관문이 사라졌거나 상수로 굳었다 — 값을 계산해도 화면에 안 뜬다",
  );
  assert.match(code, /rows\.push\(\[\s*"좌표 대조"/, "표에 행을 안 넣는다 — 사람 눈에 안 닿는다");
});

test("★ 임계는 관제 반경 상수를 쓴다 — 새 숫자를 만들지 않는다", () => {
  const code = codeOnly(dash);
  // 그 거리를 넘으면 두 좌표가 "같은 현장인가" 에서 갈린다. 뜻이 이미 정의된 유일한 숫자다.
  // 리터럴을 박으면 site-radius.ts 와 갈리고, 그 어긋남이 이 레포의 단골이다(단말 500 vs 관제 100).
  assert.match(code, /media\.coordGapM > SITE_RADIUS_MAX_M/, "임계가 상수에서 안 온다");
  assert.equal(SITE_RADIUS_MAX_M, 100, "관제 반경이 바뀌었다 — 대조 임계도 함께 움직인다");
});

test("★ 각인 값을 덮어쓰지 않는다 — 사진과 DB 가 갈리면 그것대로 혼란이다", () => {
  const body = listMediaBody();
  assert.ok(
    !/UPDATE calendar_media/.test(body),
    "조회 경로가 좌표를 고친다 — 대조는 밝히는 것이지 바꾸는 것이 아니다",
  );
  // 원본 좌표는 그대로 내려가야 화면이 각인과 같은 값을 보여준다.
  assert.match(body, /SELECT m\.\*/, "원본 컬럼을 안 내린다");
});
