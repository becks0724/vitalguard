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
