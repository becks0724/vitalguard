// 세션 종료 계측 가드 — 넷이 함께 있어야 지문이 성립한다
//
// 발단(2026-08-20). 30시간 9세션 전부 `session_auto_resumed = 0` 이었다. 자동 재개(f67442f)가
// 한 번도 발동한 적이 없다는 뜻인데, **`0` 은 "시도조차 안 됐다" 와 "사람이 [시작] 을 눌렀다" 를
// 같은 값으로 만든다.** 넷을 더해 네 가설이 배타적 지문을 갖게 한다(docs/watch-auto-resume R-05).
//
// 여기서 조용히 깨질 수 있는 것.
//  ① 스키마·컬럼·매핑 트리오 중 하나만 빠지면 값이 **무음 소실**한다(감사 BND-CONTRACT-01 ·
//     이 레포가 세 번 당했다 — mlFallPipelineActive · locationAccuracyMeters · 이산 6종).
//  ② `sessionEndByUser` 를 `?? null` 로 접으면 **false 가 null 이 된다** — "사람이 안 눌렀다"와
//     "모른다"는 정반대 판정이라 섞이면 지문 자체가 무너진다.
//  ③ 스트립 허용목록에 숫자 필드를 안 넣으면 기본값이 "샘플 전체 거부" 라, 진단 필드 하나가
//     생체를 통째로 날린다(motionVariabilityMg 때 겪음).
//  ④ 진단값이 판정·경보·화면에 새어 들어가면 그게 곧 근거 없는 판정이다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseResilientVitalSample } from "@safetymonitor/schemas";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = join(here, "..");
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const schema = readFileSync(
  join(ROOT, "..", "..", "packages", "schemas", "src", "vital-stream.ts"),
  "utf8",
);
const bare = (s: string) => s.replace(/^\s*(\/\/|--).*$/gm, "");

const FIELDS = [
  ["sessionEndSeenAt", "session_end_seen_at"],
  ["sessionEndByUser", "session_end_by_user"],
  ["sessionResumeTriedAt", "session_resume_tried_at"],
  ["sessionResumeTries", "session_resume_tries"],
] as const;

const base = {
  workerId: "EMP-6861",
  ts: "2026-08-20T02:00:00.000Z",
  heartRate: 88,
};

test("★ 트리오가 셋 다 있다 — 하나만 빠져도 값이 무음 소실한다", () => {
  for (const [camel, snake] of FIELDS) {
    assert.match(schema, new RegExp(`${camel}:\\s*z\\.`), `스키마에 ${camel} 없음`);
    assert.match(
      bare(db),
      new RegExp(`ADD COLUMN IF NOT EXISTS ${snake}\\b`),
      `DB 컬럼 ${snake} 없음`,
    );
    assert.match(bare(db), new RegExp(`${snake}:`), `insert 매핑 ${snake} 없음`);
  }
});

test("★ 네 값이 실제로 파서를 통과한다 — 소스에 있는 것과 살아남는 것은 다르다", () => {
  const out = parseResilientVitalSample({
    ...base,
    sessionEndSeenAt: "2026-08-20T01:43:19.000Z",
    sessionEndByUser: false,
    sessionResumeTriedAt: "2026-08-20T01:43:19.500Z",
    sessionResumeTries: 2,
  });
  assert.equal(out.sessionEndSeenAt, "2026-08-20T01:43:19.000Z");
  assert.equal(out.sessionEndByUser, false, "false 가 사라졌다 — 지문의 절반이 무너진다");
  assert.equal(out.sessionResumeTriedAt, "2026-08-20T01:43:19.500Z");
  assert.equal(out.sessionResumeTries, 2);
});

test("★ endByUser=false 가 null 로 접히지 않는다 — false 와 '모름'은 정반대 판정이다", () => {
  const fn = bare(db).slice(bare(db).indexOf("session_end_by_user:"));
  const body = fn.slice(0, fn.indexOf("\n    session_resume_tried_at"));
  assert.match(body, /=== true \? 1/, "3분기 매핑이 아니다");
  assert.match(body, /=== false \? 0/, "false 분기가 없다 — null 로 접힌다");
  assert.doesNotMatch(
    body,
    /sessionEndByUser \?\? null/,
    "`?? null` 로 접었다 — false 가 '모름'이 된다",
  );
});

test("★ 시도 횟수는 범위를 벗어나도 샘플을 죽이지 않는다(스트립 허용목록)", () => {
  let stripped: string[] = [];
  const out = parseResilientVitalSample(
    { ...base, sessionResumeTries: 9999 },
    (keys) => { stripped = keys; },
  );
  assert.equal(out.heartRate, 88, "진단 필드 하나가 생체 샘플을 통째로 날렸다");
  assert.equal(out.sessionResumeTries, undefined, "범위 밖 값이 그대로 통과했다");
  assert.deepEqual(stripped, ["sessionResumeTries"], "스트립이 관측되지 않는다");
});

test("★ 생체값은 여전히 스트립되지 않는다 — 허용목록이 넓어지지 않았다", () => {
  // 이 가드가 없으면 위 항목을 넣다가 생체까지 허용목록에 들어가도 아무도 모른다.
  assert.throws(
    () => parseResilientVitalSample({ ...base, heartRate: 5 }),
    "범위 밖 심박이 조용히 스트립된다 — 응급 신호가 사라진다",
  );
});

test("★ ExportRow 에는 넣지 않는다 — 진단 필드이지 사용자에게 주는 값이 아니다", () => {
  const t = db.slice(db.indexOf("export type ExportRow"));
  const body = t.slice(0, t.indexOf("\n};"));
  assert.ok(body.length > 50, "ExportRow 본문을 못 잘랐다");
  for (const [, snake] of FIELDS) {
    assert.doesNotMatch(body, new RegExp(snake), `${snake} 가 내보내기에 실렸다`);
  }
});

test("★ 판정·경보·화면에 유입되지 않는다", () => {
  const targets = [
    ["lib/severity.ts", "판정"],
    ["lib/telegram.ts", "경보"],
    ["app/components/DemoDashboard.tsx", "화면"],
  ] as const;
  for (const [rel, label] of targets) {
    const src = readFileSync(join(ROOT, ...rel.split("/")), "utf8");
    // 앵커 — 파일이 비거나 옮겨가면 금지 검사가 빈 문자열에서도 통과한다(L-79).
    assert.ok(src.length > 500, `${rel} 를 못 읽었다 — 가드가 참조를 잃었다`);
    for (const [camel, snake] of FIELDS) {
      assert.doesNotMatch(bare(src), new RegExp(`${camel}|${snake}`), `${label}에 유입(${camel})`);
    }
  }
});

// ── 워치·폰 쪽 계약 (2026-08-20 2단계) ────────────────────────────────────────
const APP = join(ROOT, "..", "vitalguard_app", "ios");
const watch = readFileSync(join(APP, "VitalWatch", "WatchStreamer.swift"), "utf8");
const phone = readFileSync(join(APP, "Runner", "VitalPipeline.swift"), "utf8");
const swiftBare = (s: string) => s.replace(/^\s*\/\/.*$/gm, "");

test("★ 종료 기록이 중첩 콜백 **밖**에 있다 — 안에 두면 H1 을 관측할 수 없다", () => {
  const fn = watch.slice(watch.indexOf("didChangeTo toState: HKWorkoutSessionState"));
  const body = fn.slice(0, fn.indexOf("\n    }"));
  const noteAt = body.indexOf("SessionEndCrumb.noteEnd");
  // 2026-08-22 리팩터가 빌더를 캡처로 고정하며 이름이 endedBuilder 가 됐다 — 앵커는 둘 다 잡는다.
  const nestAt = body.search(/(endedBuilder|builder)\?\.endCollection/);
  assert.ok(noteAt !== -1, "종료 기록이 없다");
  assert.ok(nestAt !== -1, "중첩 콜백을 못 찾았다 — 가드를 다시 맞춰야 한다");
  // 의심 대상이 바로 그 중첩이다. 그 안에서 적으면 콜백이 안 올 때 기록도 함께 사라진다.
  assert.ok(noteAt < nestAt, "기록이 중첩 콜백 안에 있다 — 그 경로가 죽으면 관측 자체가 불가능하다");
});

test("★ 오류 경로에도 같은 기록이 있다 — 경로별로 갈리는지 봐야 한다", () => {
  const fn = watch.slice(watch.indexOf("didFailWithError error: Error"));
  assert.match(
    fn.slice(0, fn.indexOf("\n    }")),
    /SessionEndCrumb\.noteEnd/,
    "오류 종료는 기록이 없다 — 두 경로 중 어느 쪽으로 끝났는지 못 가른다",
  );
});

test("★ 실어 보낸 뒤 지운다 — 안 지우면 다음 종료의 지문과 섞인다", () => {
  const fn = watch.slice(watch.indexOf("static func take()"));
  const body = fn.slice(0, fn.indexOf("\n    }"));
  assert.match(body, /removeObject\(forKey:/, "꺼내고 안 지운다");
  // 세션마다 한 번만 실린다 — 매 배치에 실으면 같은 지문이 수천 행에 복사된다.
  assert.match(swiftBare(watch), /if !endCrumbSent \{/, "첫 배치 한정 조건이 없다");
  assert.match(swiftBare(watch), /endCrumbSent = false/, "세션 시작에서 리셋하지 않는다");
});

test("★ 폰이 네 키를 서버 필드로 옮긴다 — 없으면 억지로 만들지 않는다", () => {
  const bare = swiftBare(phone);
  for (const [w, srv] of [
    ["seAt", "sessionEndSeenAt"],
    ["seBy", "sessionEndByUser"],
    ["srAt", "sessionResumeTriedAt"],
    ["srN", "sessionResumeTries"],
  ] as const) {
    assert.match(bare, new RegExp(`"${w}"`), `워치 키 ${w} 를 안 읽는다`);
    assert.match(bare, new RegExp(`"${srv}"`), `서버 필드 ${srv} 로 안 옮긴다`);
  }
  // 값이 없을 때 기본값을 채우면 H2("델리게이트가 안 왔다")가 사라진다 — 없음도 지문이다.
  assert.doesNotMatch(bare, /sessionEndSeenAt"\] = self\.isoMs\.string\(from: Date\(\)\)/,
    "값이 없을 때 현재 시각으로 채운다 — 없음이라는 지문이 사라진다");
});

test("★ 사용자 중지는 **시각까지** 봐야 인정된다 — 플래그만 보면 자동 재개가 영영 안 걸린다", () => {
  // 2026-08-20 실측 — 세션이 `stopRequestedByUser = true` 로 끝났는데 사용자는 누른 적이 없었다.
  // 그 플래그가 서 있으면 자동 재개를 통째로 건너뛴다. 30시간 9세션 전부 0 이던 이유다.
  const fn = watch.slice(watch.indexOf("private var endedByUser: Bool"));
  const body = fn.slice(0, fn.indexOf("\n    }"));
  assert.ok(body.length > 50, "endedByUser 를 못 찾았다");
  assert.match(body, /stopRequestedAt/, "누른 시각을 안 본다");
  assert.match(body, /userStopGraceSec/, "시간 제한이 없다");

  // 델리게이트 두 경로가 **둘 다** 시각을 본 판정을 써야 한다 — 하나만 고치면 그 경로만 산다.
  const bare = swiftBare(watch);
  // 2026-08-22 onMainSync 통일로 두 경로의 self. 접두 구분이 사라졌다 — 개수로 못 박는다.
  // 계약은 그대로다: 델리게이트 **두 경로 모두** 시각을 본 판정(endedByUser)을 써야 한다.
  const uses = bare.match(/let byUser = (self\.)?endedByUser/g) ?? [];
  assert.ok(uses.length >= 2, `시각 판정 사용이 ${uses.length}곳 — 두 델리게이트 경로가 다 써야 한다`);
  assert.doesNotMatch(
    bare,
    /let byUser = (self\.)?stopRequestedByUser/,
    "플래그만 읽는 경로가 남아 있다",
  );
  // 새 세션에서 시각도 함께 지워야 한다 — 안 지우면 옛 누름이 다음 종료를 오염시킨다.
  assert.match(bare, /stopRequestedAt = nil/, "새 세션에서 시각을 안 지운다");
});

test("★ [중지] 는 확인을 거치고 [시작] 은 안 거친다", () => {
  const view = readFileSync(join(APP, "VitalWatch", "ContentView.swift"), "utf8");
  assert.match(view, /confirmationDialog\(/, "중지 확인이 없다 — 오탭 한 번에 수집이 멎는다");
  assert.match(
    swiftBare(view),
    /if streamer\.isRunning \{ confirmingStop = true \} else \{ streamer\.start\(\) \}/,
    "시작에도 확인이 걸렸거나 중지가 바로 실행된다",
  );
});
