// 미디어 삭제 계약 가드 — 지웠는데 파일이 남거나, 남의 파일을 지우는 두 방향을 막는다
//
// 발단(2026-08-20 실측). 관제웹에 삭제 버튼이 있는데 서버가 **DB 행만** 지우고 있었다.
// 버킷을 훑어 대조하니 참조 없는 고아 객체 4개 · 21.2MB 가 쌓여 있었다. 앱 기록 탭에도 같은
// 버튼을 붙이는 참이라 그대로 두면 빈도만 늘어난다.
//
// 고치는 방향에 함정이 둘 있고 서로 반대다.
//  ① **키를 먼저 조회해서 지우면 안 된다** — 조회는 소유권을 안 보므로 남의 사진 키를 읽어
//     파일을 지울 수 있다. 키는 `DELETE … RETURNING` 으로만 얻는다(권한을 통과한 것만 나온다).
//  ② **파일 삭제 실패를 요청 실패로 만들면 안 된다** — 행은 이미 없는데 사용자는 "안 지워졌다"
//     로 읽고 다시 누르고, 그때는 404 가 난다. 파일만 남는 것은 고아일 뿐 되돌릴 일이 아니다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = join(here, "..");
const route = readFileSync(join(ROOT, "app", "api", "calendar", "media", "route.ts"), "utf8");
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const storage = readFileSync(join(ROOT, "lib", "storage.ts"), "utf8");
const record = readFileSync(
  join(ROOT, "..", "vitalguard_app", "lib", "record_screen.dart"),
  "utf8",
);

/** DELETE 핸들러 본문만 자른다 — 파일 전체로 보면 GET 의 프리사인 호출까지 섞인다. */
function deleteHandler(): string {
  const at = route.indexOf("export async function DELETE(");
  assert.notEqual(at, -1, "DELETE 핸들러가 없다");
  return route.slice(at);
}

test("★ 삭제가 버킷 객체까지 지운다 — 안 지우면 고아가 쌓인다", () => {
  assert.match(storage, /export async function deleteObject\(/, "객체 삭제 헬퍼가 없다");
  assert.match(
    deleteHandler(),
    /await deleteObject\(deleted\.storageKey\)/,
    "행만 지우고 파일을 안 지운다 — 실측으로 21.2MB 가 이미 고아였다",
  );
});

test("★ 저장 키는 삭제가 돌려준 것만 쓴다 — 따로 조회하면 남의 파일을 지울 수 있다", () => {
  const fn = db.slice(db.indexOf("export async function deleteCalendarMedia("));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(body.length > 100, "deleteCalendarMedia 본문을 못 잘랐다");
  assert.match(body, /RETURNING storage_provider, storage_key/, "RETURNING 이 없다");
  assert.match(body, /mediaScopeClause\(scope, params\)/, "소유권 조건이 빠졌다 — 남의 사진도 지워진다");
  // 핸들러가 키를 얻으려 별도 조회로 되돌아가면 소유권 검사를 건너뛴다.
  assert.doesNotMatch(
    deleteHandler(),
    /getCalendarMediaById/,
    "키를 별도 조회로 얻는다 — 그 조회는 소유권을 안 본다",
  );
});

test("★ 파일 삭제 실패가 요청을 실패로 만들지 않는다", () => {
  const h = deleteHandler();
  const at = h.indexOf("await deleteObject(");
  assert.notEqual(at, -1, "객체 삭제 호출이 없다");
  // 호출을 감싼 try/catch 가 있어야 한다.
  const before = h.slice(0, at);
  assert.match(before.slice(-200), /try \{/, "객체 삭제가 try 로 감싸여 있지 않다");
  assert.match(h.slice(at), /catch \(e\) \{/, "실패를 삼키는 catch 가 없다");
  // 고아가 생긴 사실은 남긴다 — 조용히 삼키면 다음 사람이 또 21.2MB 를 발견한다.
  assert.match(h.slice(at), /console\.warn\(/, "실패를 기록하지 않는다");
});

test("★ 행을 지운 뒤에 파일을 지운다 — 순서를 뒤집으면 남의 증빙이 파괴된다", () => {
  const h = deleteHandler();
  const rowAt = h.indexOf("await deleteCalendarMedia(");
  const objAt = h.indexOf("await deleteObject(");
  assert.ok(rowAt !== -1 && objAt !== -1, "두 호출 중 하나가 없다");
  assert.ok(rowAt < objAt, "파일을 먼저 지운다 — 권한이 없어 행이 안 지워져도 파일은 사라진다");
  // 권한 실패(=null)면 파일에 손대기 전에 빠져나가야 한다.
  const guardAt = h.indexOf("if (!deleted) return");
  assert.ok(guardAt !== -1 && guardAt < objAt, "권한 실패 조기 반환이 객체 삭제 뒤에 있다");
});

test("★ 앱은 삭제 권한을 다시 계산하지 않는다 — 서버가 내려준 canDelete 를 쓴다", () => {
  const code = record.replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /m\['canDelete'\] == true/, "서버 판정을 안 쓴다");
  // 사번을 직접 비교하기 시작하면 서버 규칙과 갈리고, 그때 "눌러도 안 되는 버튼" 이 생긴다.
  assert.doesNotMatch(code, /worker_id/, "앱이 사번을 직접 비교한다 — 규칙이 두 곳으로 갈린다");
});

test("★ 삭제는 확인을 거치고, 되돌릴 수 없다고 말한다", () => {
  assert.match(record, /showDialog<bool>/, "확인 대화상자가 없다 — 오탭으로 증빙이 사라진다");
  assert.match(record, /되돌릴 수 없습니다/, "되돌릴 수 없다는 고지가 없다");
});

test("★ 목록은 최신순으로 뒤집는다 — 서버는 시간 오름차순으로 준다", () => {
  // ⚠ 파일 전체에서 `newestFirst(` 를 찾으면 **함수 정의**가 걸려, 호출을 지워도 통과한다
  //   (작성 중 음성 대조로 확인). 목록을 채우는 `_load` 안에서 실제로 부르는지 본다.
  const loadAt = record.indexOf("Future<void> _load() async {");
  assert.notEqual(loadAt, -1, "_load 를 못 찾았다 — 가드를 다시 맞춰야 한다");
  const load = record.slice(loadAt, record.indexOf("\n  }", loadAt));
  assert.match(load, /newestFirst\(/, "정렬을 안 한다 — 방금 찍은 것이 맨 아래로 간다");
  // 서버 계약(관제 캘린더가 하루를 시간순으로 읽는다)은 건드리지 않는다.
  const list = db.slice(db.indexOf("export async function listCalendarMedia("));
  assert.match(
    list.slice(0, 500),
    /ORDER BY date_key ASC, captured_at ASC/,
    "서버 정렬을 바꿨다 — 관제 캘린더가 함께 뒤집힌다",
  );
});
