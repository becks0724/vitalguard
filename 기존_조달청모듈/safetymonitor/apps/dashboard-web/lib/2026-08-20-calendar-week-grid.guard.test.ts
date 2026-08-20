// 주간 일정표 가드 (2026-08-20 · 사용자 지시 = 구글 캘린더 참고).
// 결정 근거 = docs/calendar-week-view/context-notes.md
//
// 화면 구성 — 미니 월간(좌상단) + 주간 격자(메인) + 우측 끝 고정 사이드바(선택 상세).
// 이 배치는 **좌측이 이미 차 있다**는 실측에서 나왔다(fixed left-0 · 현장 환경 332px).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");

test("앵커 — 주간 격자·미니 월간이 실재한다", () => {
  assert.ok(dash.includes("function WeekGrid("), "WeekGrid 소실");
  assert.ok(dash.includes("function MiniMonth("), "MiniMonth 소실");
  assert.ok(dash.includes("const WEEK_START_HOUR"), "시간 범위 상수 소실");
});

test("시간 범위는 07~19시다 — 24시간이면 대부분 빈칸이고 스크롤만 길어진다", () => {
  assert.match(dash, /const WEEK_START_HOUR = 7;/, "시작 시각이 바뀌었다");
  assert.match(dash, /const WEEK_END_HOUR = 19;/, "종료 시각이 바뀌었다");
});

// ★ 실측 = `end_time` 이 절반은 없다. 없다고 안 그리면 그 일정이 화면에서 사라진다.
test("종료 시각이 없는 일정도 그린다 — 기본 1시간", () => {
  const i = dash.indexOf("function WeekGrid(");
  const body = dash.slice(i, i + 14_000);
  assert.match(
    body,
    /const dur = endMin !== null && endMin > startMin \? endMin - startMin : 60;/,
    "종료 없는 일정의 기본 길이가 사라졌다 — 그 일정이 안 보이게 된다",
  );
});

// ── 사진 배치 (2026-08-20 계획 변경)
test("사진은 촬영 시각 위치에 놓는다 — 종일 띠로 밀지 않는다", () => {
  assert.match(dash, /function mediaMinutes\(m: CalendarMedia\)/, "촬영 시각 파서 소실");
  // 표시 코드와 같은 관례를 써야 한다 — 다르면 격자 위치와 카드의 시각이 갈린다.
  assert.match(dash, /hhmmToMinutes\(m\.capturedAt\?\.slice\(11, 16\)\)/, "촬영 시각 파싱 관례가 바뀌었다");
});

test("같은 시간대에 여럿이면 한 블록으로 묶는다", () => {
  const i = dash.indexOf("function WeekGrid(");
  const body = dash.slice(i, i + 14_000);
  assert.match(body, /const many = group\.length > 1;/, "묶음 판정이 사라졌다");
  assert.match(body, /many \? `이미지 \$\{group\.length\}건`/, "묶음 표기가 사라졌다");
  // 1건이면 시각을 그대로 — 묶으면 정보를 잃는다(실측상 시간대의 56%가 1건).
  assert.match(body, /: \(head\.m\.capturedAt\?\.slice\(11, 16\) \?\? ""\)/, "1건일 때 시각 표기가 사라졌다");
});

test("시각을 못 읽은 사진도 버리지 않는다 — 종일 띠에 남는다", () => {
  const i = dash.indexOf("function WeekGrid(");
  const body = dash.slice(i, i + 14_000);
  assert.match(
    body,
    /\.filter\(\(m\) => mediaMinutes\(m\) === null\)\.length/,
    "시각 미상 사진의 자리가 사라졌다 — 조용히 안 보이게 된다",
  );
});

// ── 우측 고정 사이드바
test("선택 상세는 화면 끝 고정 사이드바다 — 자체 스크롤", () => {
  assert.match(dash, /fixed right-0 top-44[^"]*overflow-y-auto/, "우측 고정·자체 스크롤이 사라졌다");
  // ★ 포털이 없으면 페이저의 translateX 가 fixed 의 기준이 되어 화면 끝에 안 붙는다.
  assert.match(dash, /aria-label="선택 날짜 상세"/, "사이드바 앵커 소실");
  // ⚠ 종전엔 "앞 900자 안에 createPortal 이 있나" 로 봤는데, 그 창에 **다른** 포털이 들어와
  //   포털을 지워도 통과했다(음성 대조로 실측). 이 사이드바를 여는 그 호출을 직접 본다.
  assert.match(
    dash,
    /inline && active && portalReady\s*\n\s*\? createPortal\(/,
    "이 사이드바의 포털이 사라졌다 — 페이저 트랙 transform 에 갇혀 화면 끝에 안 붙는다",
  );
});

test("다른 탭에서는 사이드바가 남지 않는다 — 페이저가 전 페이지를 마운트 유지한다", () => {
  assert.match(dash, /inline && active && portalReady/, "활성 탭 조건이 사라졌다");
  assert.match(dash, /active=\{pagerIdx === CALENDAR_PAGE_IDX\}/, "호출부가 활성 여부를 안 넘긴다");
});

// ── 클릭 → 우측 초점
test("격자에서 고른 사진이 우측에서 초점을 받는다", () => {
  assert.match(dash, /onOpenMedia=\{\(m\) => \{/, "사진 클릭 핸들러 소실");
  assert.match(dash, /setFocusMediaId\(m\.id\)/, "초점 지정이 사라졌다");
  assert.match(dash, /scrollIntoView\(\{ block: "nearest"/, "우측 스크롤이 사라졌다");
});

// ⚠ 무조건 초점을 풀면 다른 날 사진 클릭이 아무 일도 안 한 것처럼 보인다.
test("날짜가 바뀌어도 고른 항목이 그 날짜에 있으면 초점을 유지한다", () => {
  assert.match(
    dash,
    /prev && \(mediaByDate\[selectedKey\] \?\? \[\]\)\.some\(\(m\) => m\.id === prev\) \? prev : null/,
    "초점 해제가 무조건이 됐다 — 다른 날 사진을 누르면 그 자리에서 초점이 사라진다",
  );
});

test("주/월 전환이 있다 — 월간을 버리지 않았다", () => {
  assert.match(dash, /const \[weekMode, setWeekMode\] = useState\(true\)/, "주/월 상태 소실");
  assert.match(dash, /\{inline && weekMode \? \(/, "주간 분기 소실");
  // 팝업(580px)은 주간 격자가 안 들어간다 — inline 조건이 빠지면 팝업이 깨진다.
  assert.doesNotMatch(dash, /\{weekMode \? \(/, "inline 조건 없이 주간을 그린다 — 팝업이 깨진다");
});

// ⚠ 사용자 실측 버그(2026-08-20) — 14:07 이미지를 고른 뒤 사이드바를 아래로 내리면 계속 위로
//   끌려 올라갔다. 원인 = `ref` 콜백이 렌더마다 다시 붙는데 이 화면은 2초 주기로 폴링하므로
//   `scrollIntoView` 가 반복 실행됐다. **초점당 한 번만** 스크롤해야 한다.
test("초점 스크롤은 한 번만 — 폴링마다 위로 끌려 올라가지 않는다", () => {
  assert.match(dash, /const scrolledForRef = useRef<string \| null>\(null\);/, "스크롤 기록 소실");
  assert.match(
    dash,
    /focusMediaId === m\.id && scrolledForRef\.current !== m\.id/,
    "스크롤 1회 제한이 사라졌다 — 폴링마다 스크롤이 위로 튄다",
  );
  // 같은 항목을 다시 눌러도 스크롤돼야 한다 — 기록을 안 풀면 두 번째 클릭이 먹통이 된다.
  assert.match(dash, /scrolledForRef\.current = null; \/\/ 같은 항목을 다시 눌러도/, "재클릭 시 기록 해제가 사라졌다");
});
