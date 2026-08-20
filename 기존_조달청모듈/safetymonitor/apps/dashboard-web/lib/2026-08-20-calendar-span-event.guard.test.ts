// 여러 날 일정(기간) 가드 (2026-08-20 · 사용자 요청).
//
// 발단. "8/16~22 일정에 색상 태그를 쓰면 가로 색상줄로 보이나?" → **안 됐다.**
// `calendar_event` 는 `date_key` 하나뿐이라 여러 날을 담을 자리가 없었고, 7일이면 7건을
// 따로 등록해야 했다(칸마다 따로 뜨고 이어진 줄이 아니다).
//
// ★ 이 기능은 **네 층이 함께** 있어야 산다 — 하나만 빠지면 값이 조용히 사라진다
//   (BND-CONTRACT-01. 이 레포가 `locationAccuracyMeters`·낙상 텔레메트리에서 이미 당했다).
//     ① DB 컬럼  ② insert 매핑  ③ API 수용  ④ 화면 타입·렌더
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const db = readFileSync(join(ROOT, "lib/db.ts"), "utf8");
const api = readFileSync(join(ROOT, "app/api/calendar/events/route.ts"), "utf8");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");

test("앵커 — 네 층의 대상이 실재한다", () => {
  assert.ok(db.includes("CREATE TABLE IF NOT EXISTS calendar_event"), "일정 테이블 소실");
  assert.ok(db.includes("export async function upsertCalendarEvent"), "upsert 소실");
  assert.ok(api.includes("upsertCalendarEvent"), "API 소실");
  assert.ok(dash.includes("function spanInWeek("), "기간 계산 소실");
});

// ── ① DB 컬럼
test("① 종료 날짜 컬럼이 있다", () => {
  assert.match(
    db,
    /ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS end_date_key TEXT;/,
    "end_date_key 컬럼이 사라졌다",
  );
});

// ── ② insert 매핑 — 컬럼만 있고 매핑이 없으면 값이 영영 NULL 이다.
test("② insert 가 종료 날짜를 싣는다", () => {
  const i = db.indexOf("export async function upsertCalendarEvent");
  const body = db.slice(i, i + 2000);
  assert.match(body, /input\.endDateKey \?\? null,/, "params 에서 빠졌다");
  assert.match(body, /INSERT INTO calendar_event \([^)]*\bend_date_key\b/, "INSERT 컬럼 목록에서 빠졌다");
  assert.match(body, /end_date_key = EXCLUDED\.end_date_key,/, "UPDATE 에서 빠졌다 — 수정이 반영 안 된다");
  // ★ 자리 수가 어긋나면 값이 엉뚱한 컬럼에 들어간다.
  // ★ 컬럼 수와 플레이스홀더 수가 **같은지**를 본다 — 숫자를 박으면 컬럼이 늘 때마다 깨진다.
  const cols = body.match(/INSERT INTO calendar_event \(([^)]*)\)/)?.[1]?.split(",").length ?? 0;
  const vals = body.match(/VALUES \(([^)]*)\)/)?.[1]?.split(",").length ?? -1;
  assert.equal(vals, cols, `컬럼 ${cols}개 vs 플레이스홀더 ${vals}개 — 값이 엉뚱한 컬럼에 들어간다`);
});

// ── ③ API
test("③ API 가 종료 날짜를 받고 거꾸로 된 기간을 거부한다", () => {
  assert.match(api, /body\.endDateKey/, "API 가 종료 날짜를 안 읽는다");
  assert.match(api, /endRaw < dateKey/, "거꾸로 된 기간 검사가 사라졌다");
  // 시작과 같으면 null — 하루짜리를 기간처럼 저장하면 화면이 1일 띠를 그린다.
  assert.match(api, /endRaw !== dateKey \? endRaw : null/, "같은 날 정규화가 사라졌다");
});

// ── ④ 화면
test("④ 화면이 종료 날짜를 읽는다", () => {
  assert.match(dash, /endDateKey\?: string;/, "타입에서 빠졌다");
  assert.match(dash, /r\.end_date_key === "string"/, "서버 행 매핑에서 빠졌다");
});

test("주 경계에서 잘라 그린다 — 주가 바뀌면 띠가 쪼개진다", () => {
  const i = dash.indexOf("function spanInWeek(");
  const body = dash.slice(i, i + 1200);
  assert.match(body, /if \(s1 < first \|\| s0 > last\) return null;/, "겹침 판정이 사라졌다");
  assert.match(body, /openStart|openEnd/, "주 밖으로 이어지는 표시가 사라졌다");
});

test("주간·월간 둘 다 가로 띠를 그린다", () => {
  const bars = dash.match(/gridColumnStart:/g) ?? [];
  assert.equal(bars.length, 2, `가로 띠가 ${bars.length}곳 — 주간·월간 2곳이어야 한다`);
  // 라벨 색을 그대로 쓴다 — 새 색을 만들지 않는다(`band` 는 이 용도로 이미 있는 토큰).
  const bands = dash.match(/LABEL_COLOR_META\[findLabelDef\(labels, e\.labelId\)\.color\]\.band/g) ?? [];
  assert.ok(bands.length >= 1, "라벨 색이 안 쓰인다");
});

test("폼에 종료일 입력이 있고 거꾸로면 경고한다", () => {
  assert.match(dash, /const \[endDateDraft, setEndDateDraft\]/, "종료일 상태 소실");
  assert.match(dash, /endDateDraft > dateDraft/, "저장 시 기간 검사가 사라졌다");
  assert.match(dash, /종료일이 시작일보다 빠릅니다/, "거꾸로 된 기간 경고가 사라졌다");
  // 리셋에서 빠지면 다음 등록에 이전 종료일이 남는다.
  assert.match(dash, /setEndDateDraft\(""\);/, "폼 리셋에서 빠졌다");
});

// ── 메모(note) — 같은 네 층 + 폼 3고리 (2026-08-20 사용자 요청 A+B)
test("메모가 네 층에 이어져 있다", () => {
  assert.match(db, /ADD COLUMN IF NOT EXISTS note TEXT;/, "note 컬럼 소실");
  assert.match(db, /input\.note \?\? null,/, "insert params 에서 빠졌다");
  assert.match(db, /INSERT INTO calendar_event \([^)]*\bnote\b/, "INSERT 컬럼 목록에서 빠졌다");
  assert.match(db, /note = EXCLUDED\.note,/, "UPDATE 에서 빠졌다 — 수정이 반영 안 된다");
  assert.match(api, /noteRaw\.length > 2000/, "메모 길이 상한이 사라졌다");
  assert.match(dash, /note\?: string;/, "화면 타입에서 빠졌다");
  assert.match(dash, /r\.note === "string"/, "서버 행 매핑에서 빠졌다");
});

// ★ 폼 필드는 **상태·저장·복원 셋이 한 벌**이다. 복원이 빠지면 수정할 때마다 값이 지워진다.
//   실제로 기간(endDateKey)을 넣을 때 이 고리를 빠뜨렸다가 메모를 넣으며 함께 잡았다.
test("폼 새 필드는 상태·저장·복원 셋이 다 있다", () => {
  for (const [state, save, restore] of [
    ["const \\[note, setNote\\]", "note: note\\.trim\\(\\)", "setNote\\(event\\.note \\?\\? \"\"\\)"],
    ["const \\[endDateDraft, setEndDateDraft\\]", "endDateKey:", "setEndDateDraft\\(event\\.endDateKey \\?\\? \"\"\\)"],
  ] as const) {
    assert.match(dash, new RegExp(state), `상태 소실: ${state}`);
    assert.match(dash, new RegExp(save), `저장 payload 소실: ${save}`);
    assert.match(dash, new RegExp(restore), `수정 시 복원 소실: ${restore} — 저장할 때마다 값이 지워진다`);
  }
  // 리셋도 함께 — 없으면 다음 등록에 이전 값이 남는다.
  assert.match(dash, /setNote\(""\);/, "폼 리셋에서 메모가 빠졌다");
});

// ── 종일 일정 (2026-08-20 사용자 요청)
// ⚠⚠ 이 가드가 지키는 것은 **"저장은 되는데 화면에서 사라지는"** 형태다.
//   종일 토글을 넣었을 때 실제로 그 상태였다 — 시간 격자는 시각이 없으면 건너뛰고
//   종일 띠는 사진만 담고 있어, 저장은 되는데 어디에도 안 그려졌다.
test("종일 일정이 화면에 그려진다 — 저장만 되고 사라지지 않게", () => {
  assert.match(dash, /const \[allDay, setAllDay\] = useState\(false\)/, "종일 상태 소실");
  // 저장 — 종일이면 시각을 안 싣는다(start_time NULL 이 곧 종일).
  assert.match(dash, /startTime: allDay \? undefined : startTime\.trim\(\) \|\| undefined/, "종일 저장 규칙이 사라졌다");
  // 복원 — 시각이 없으면 종일이다.
  assert.match(dash, /setAllDay\(!event\.startTime\)/, "수정 시 종일 복원이 사라졌다");
  // ★ 렌더 — 종일 띠가 일정을 담아야 한다.
  assert.match(
    dash,
    /const allDayEvents = \(eventsByDate\[key\] \?\? \[\]\)\.filter\(/,
    "종일 띠가 일정을 안 담는다 — 저장은 되는데 화면에서 사라진다",
  );
  assert.match(dash, /allDayEvents\.map\(\(e\) => \(/, "종일 일정 렌더가 사라졌다");
});

test("등록·수정을 마치면 폼이 닫힌다", () => {
  const i = dash.indexOf("const handleSubmit = () => {");
  const body = dash.slice(i, i + 1400);
  assert.match(body, /resetForm\(\);\n[\s\S]{0,180}onClose\(\);/, "저장 후 닫기가 사라졌다 — 저장됐는지 화면으로 알 수 없다");
});

test("모달 폭이 제한돼 있다 — 탭에서 화면을 통째로 덮지 않게", () => {
  assert.match(dash, /floating \? "max-h-\[85vh\] max-w-\[26rem\]" : "max-h-\[85%\]"/, "모달 폭 제한이 사라졌다");
});
