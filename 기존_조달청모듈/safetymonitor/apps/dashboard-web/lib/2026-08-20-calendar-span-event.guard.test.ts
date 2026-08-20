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
  assert.match(body, /end_time, end_date_key, hazard_type/, "INSERT 컬럼 목록에서 빠졌다");
  assert.match(body, /end_date_key = EXCLUDED\.end_date_key,/, "UPDATE 에서 빠졌다 — 수정이 반영 안 된다");
  // ★ 자리 수가 어긋나면 값이 엉뚱한 컬럼에 들어간다.
  assert.match(body, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9\)/, "플레이스홀더 수가 안 맞는다");
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
