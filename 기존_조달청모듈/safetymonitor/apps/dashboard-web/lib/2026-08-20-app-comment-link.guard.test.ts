// 앱 설명 → 관제웹 댓글 연동 가드 — 두 화면이 같은 스레드를 보게 유지한다
//
// 발단(2026-08-20). 앱의 "설명 수정" 은 `calendar_media.description` 에 썼는데
// **관제웹은 그 필드를 화면에 아예 안 그린다**(타입에만 있다). 작업자가 적은 설명을
// 관리자가 영영 못 보는 상태였다. 그래서 앱이 댓글 스레드에 쓰도록 바꿨다.
//
// 여기서 조용히 깨질 수 있는 것이 셋이다.
//  ① 댓글 라우트가 앱 JWT 를 다시 거부하면 — 앱은 401 을 받고 설명이 안 올라간다.
//  ② `author_id` 를 사번(workerId)으로 적으면 — 관제는 `admin6861`, 앱은 `EMP-6861` 이라
//     같은 사람이 둘로 갈려 **자기 댓글을 자기가 못 고친다**(미디어 삭제에서 실제 제보된 형태).
//  ③ 앱이 "내 댓글" 판정에 사번을 쓰면 — 내 댓글이 전부 남의 것으로 보여 수정 경로가 닫힌다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = join(here, "..");
const route = readFileSync(
  join(ROOT, "app", "api", "calendar", "media", "comment", "route.ts"),
  "utf8",
);
const APP = join(ROOT, "..", "vitalguard_app");
const record = readFileSync(join(APP, "lib", "record_screen.dart"), "utf8");
const bridge = readFileSync(join(APP, "ios", "Runner", "VitalBridge.swift"), "utf8");
const settings = readFileSync(join(APP, "lib", "settings_screen.dart"), "utf8");

const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, "");

test("★ 댓글 라우트가 앱 JWT 를 받는다 — 거부하면 앱 설명이 관제에 안 뜬다", () => {
  assert.match(route, /verifyAppJwt/, "앱 JWT 검증을 안 부른다");
  const fn = route.slice(route.indexOf("function principal("));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(body.length > 100, "principal 본문을 못 잘랐다");
  assert.match(body, /verifyAppJwt\(bearerToken\(request\)\)/, "Bearer 토큰 경로가 없다");
  // 세 핸들러 전부 같은 게이트를 써야 한다 — 하나만 남으면 그 메서드만 앱에서 막힌다.
  assert.equal(
    (route.match(/if \(!authed\(request\)\)/g) ?? []).length,
    3,
    "POST·PATCH·DELETE 세 곳이 같은 게이트를 쓰지 않는다",
  );
});

test("★ 작성자 식별자는 로그인 ID(sub) 다 — 사번을 쓰면 같은 사람이 둘로 갈린다", () => {
  const fn = route.slice(route.indexOf("function principal("));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /claims\.sub/, "sub 를 안 쓴다");
  assert.doesNotMatch(
    code(body),
    /workerId/,
    "사번을 작성자 식별자로 쓴다 — 관제(admin6861)와 앱(EMP-6861)이 갈린다",
  );
});

test("★ 판정 불가는 거부 쪽이다 — 신원 없음이 전체 허용으로 떨어지면 안 된다", () => {
  const fn = route.slice(route.indexOf("function commentScope("));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /if \(!who\) return null;/, "주체 없음이 null 로 안 떨어진다");
  assert.match(body, /who\.role === "owner"/, "owner 모더레이션 분기가 사라졌다");
});

test("★ 앱은 로그인 ID 로 내 댓글을 가른다 — 사번으로 비교하면 전부 남의 것이 된다", () => {
  const c = code(record);
  assert.match(c, /c\['author_id'\] == _me/, "작성자 대조가 없다");
  assert.match(code(bridge), /"loginId": AuthStore\.loginId/, "브리지가 로그인 ID 를 안 준다");
  // 사번으로 비교하기 시작하면 조용히 전부 '남의 댓글' 이 된다.
  assert.doesNotMatch(c, /_me = res\?\['workerId'\]/, "사번을 내 식별자로 읽는다");
});

test("★ 앱 설명은 댓글로 간다 — description 에 쓰면 관제웹이 안 그린다", () => {
  const c = code(record);
  assert.match(c, /'addComment'/, "댓글 작성 경로가 없다");
  assert.doesNotMatch(
    c,
    /'updateMediaDescription'/,
    "다시 description 으로 쓴다 — 관제웹은 그 필드를 화면에 안 그린다",
  );
});

test("★ 설정 진단은 status 폴링에서 온다 — 스트림에 얹으면 같이 얼어붙는다", () => {
  // 2026-08-20 실측 — 서버는 12건/분 받는데 EventChannel 이 멈춰 홈 화면만 7분 41초 전에 얼었다.
  // 진단 항목까지 그 스트림에 얹으면 "언제부터 안 오는지" 를 보여줄 화면이 함께 죽는다.
  assert.match(code(settings), /_status\['lastVitalAgeSec'\]/, "수신 경과를 status 에서 안 읽는다");
  assert.match(code(bridge), /"lastVitalAgeSec"/, "브리지 status 가 경과를 안 준다");
  assert.match(
    code(bridge),
    /PhoneReceiver\.shared\.lastVitalAt/,
    "네이티브 스냅숏이 아니라 다른 곳에서 읽는다",
  );
});
