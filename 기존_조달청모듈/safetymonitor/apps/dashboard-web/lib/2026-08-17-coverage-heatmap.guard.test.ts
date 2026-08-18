// 수집 커버리지 히트맵 가드 — 빈칸이 거짓말하지 않게 못 박는다.
//
// 이 화면은 **빈칸이 주 메시지**다. 사용자 계정 실측 기준 365칸 중 수집 39 · 미수신 14 ·
// 운영 이전 312 다(2026-08-17). 즉 화면의 89% 가 빈칸이고, 그 빈칸의 뜻이 갈리지 않으면
// **없는 사고를 312건 그리는 것**이다.
//
// GitHub 히트맵은 "기여 0건"과 "그날이 없음"을 같은 연회색으로 그린다. 우리에겐 그게 이 레포가
// 반복해 고쳐 온 false-OK 다 — 미수신이 "활동 없음"으로 읽힌다. 세 상태를 가르는 장치가
// **서버(0인 날을 안 채운다) · 판정(before/missing/covered) · 화면(색 아닌 무늬)** 세 겹에 있고,
// 하나만 빠져도 나머지가 조용히 무력해진다. 그래서 셋을 함께 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const logic = read("lib", "coverage-heatmap.ts");
const view = read("app", "components", "CoverageHeatmap.tsx");
const panel = read("app", "components", "VitalHistoryPanel.tsx");
const real = read("app", "api", "monitor", "vital", "history", "real.ts");
const route = read("app", "api", "monitor", "vital", "history", "route.ts");
const mock = read("app", "api", "monitor", "vital", "history", "data.ts");
const db = read("lib", "db.ts");

/** 줄 주석을 걷어낸 본문 — 금지 검사가 자기 설명 주석에 걸리지 않게(L-83). */
const codeOnly = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

test("① ★ 빈칸 세 상태가 살아 있다", () => {
  assert.match(logic, /state: "before" \| "missing" \| "covered"/, "상태 유니온이 사라졌다");
  for (const s of ["before", "missing", "covered"]) {
    assert.match(
      codeOnly(logic),
      new RegExp(`state: "${s}"`),
      `${s} 상태를 만드는 코드가 없다 — 빈칸이 한 종류로 뭉개진다`,
    );
  }
  assert.match(
    codeOnly(logic),
    /ms < firstMs/,
    "최초 수집일 비교가 사라졌다 — 운영 이전과 미수신을 가를 기준이 없어진다",
  );
});

test("② ★ 서버가 0 인 날을 채워 보내지 않는다", () => {
  // 0 을 채워 보내면 "미수신"과 "수집됐는데 0분"이 서버에서 이미 합쳐져 화면이 복구할 수 없다.
  assert.match(db, /export async function dailyCoverageMinutes/, "집계 함수가 사라졌다");
  assert.match(
    codeOnly(db),
    /COUNT\(DISTINCT date_trunc\('minute'/,
    "분 단위 집계가 아니다 — 시간 단위면 샘플 1건이 1시간으로 계산돼 커버리지가 과대평가된다",
  );
  const branch = real.slice(real.indexOf('if (metric === "coverage")'));
  assert.ok(branch.length > 100, "coverage 분기를 못 찾았다");
  assert.doesNotMatch(
    codeOnly(branch.slice(0, 900)),
    /value: 0|\?\? 0/,
    "0 을 채워 보낸다 — 미수신과 0분이 서버에서 합쳐진다",
  );
});

test("③ ★ 미수신을 색이 아니라 무늬로도 구분한다", () => {
  // 색만으로 가르면 색각 이상·직사광선에서 사라진다. 현장 조건에서 남는 것은 무늬다.
  assert.match(view, /MISSING_STRIPE/, "미수신 무늬 상수가 사라졌다");
  assert.match(view, /repeating-linear-gradient/, "빗금 정의가 사라졌다");
  assert.match(view, /border-dashed/, "점선 테두리가 사라졌다");
  // 범례가 없으면 무늬가 무슨 뜻인지 화면에 없다.
  assert.match(view, /운영 이전/, "범례에서 '운영 이전' 이 사라졌다");
  assert.match(view, /미수신/, "범례에서 '미수신' 이 사라졌다");
});

test("④ 최초 수집일이 서버→화면까지 실려 온다", () => {
  assert.match(db, /export async function firstDataDay/, "DB 조회가 사라졌다");
  assert.match(real, /export async function firstDataDateOf/, "래퍼가 사라졌다");
  assert.match(
    route,
    /firstDataDate: metric === "coverage" \? await firstDataDateOf\(workerId\) : undefined,/,
    "응답에서 빠졌다 — 화면이 운영 이전을 못 가려 전부 미수신이 된다",
  );
  const n = route.split("firstDataDate:").length - 1;
  assert.equal(n, 2, `응답 경로 2곳(구간 지정·프리셋) 중 ${n}곳만 싣는다`);
  assert.match(panel, /firstDataDate\?: string \| null;/, "패널 응답 타입에서 빠졌다");
  assert.match(panel, /firstDataDate=\{data\.firstDataDate \?\? null\}/, "히트맵에 전달되지 않는다");
});

test("⑤ ★ 커버리지 탭이 시계열 차트로 새지 않는다", () => {
  // 선/막대로 내려보내면 365개 점이 축에 균등 배치돼 "며칠이 비었는지"가 사라진다 —
  // 이 탭의 존재 이유가 바로 그것이다.
  const i = panel.indexOf('if (selection.metric === "coverage") {');
  assert.ok(i > 0, "커버리지 조기 분기가 사라졌다");
  const j = panel.indexOf("const chartProps = {");
  assert.ok(i < j, "차트 props 조립보다 뒤에 있다 — 차트 경로로 샐 수 있다");
  assert.match(panel, /<CoverageHeatmap/, "히트맵을 렌더하지 않는다");
});

test("⑥ 모의 생성기가 커버리지를 만들지 않는다", () => {
  // 생성하면 화면이 "감시되고 있다"는 거짓을 그린다 — 값이 틀리는 게 아니라 사실이 뒤집힌다.
  assert.match(codeOnly(mock), /if \(metric === "coverage"\) return 0;/, "모의 방어선이 사라졌다");
  assert.doesNotMatch(
    codeOnly(mock),
    /coverage: \{ base:/,
    "모의 프로필이 생겼다 — 가짜 커버리지 곡선이 그려진다",
  );
  assert.match(route, /"coverage",\n\];/, "coverage 가 허용 메트릭에 없다");
  assert.match(
    route,
    /const REAL_METRICS: RealMetric\[\] = \[[^\]]*"coverage"/,
    "실데이터 메트릭이 아니다 — 모의 경로로 떨어진다",
  );
});

test("⑦ 1년 범위가 고정된다", () => {
  assert.match(
    codeOnly(panel),
    /selection\.metric === "coverage" && \(range !== 365 \|\| customRange\)/,
    "범위 강제가 사라졌다 — 다른 탭에서 넘어온 7일이 남아 격자가 비어 보인다",
  );
  assert.match(panel, /days=\{365\}/, "히트맵에 365 를 넘기지 않는다");
});

test("⑧ 표시 전용 — 판정·알림 경로에 넣지 않는다", () => {
  // 커버리지가 낮은 날은 작업자 상태가 아니라 "감시가 덜 됐다"이다. 알림으로 만들면
  // 퇴근·휴일마다 울린다(근무 시간 개념이 아직 없다 — gps-phone-collection G-07 과 같은 이유).
  // 참고선 열거 — 비워 두면 다음 사람이 임계를 채워 넣는다. 구간만 잘라 검사한다
  // (파일 전체를 assert.match 에 넘기면 실패 출력이 3만 자를 쏟아 진단이 어려워진다).
  const refFn = panel.slice(panel.indexOf("function metricReferenceLines"));
  const refBody = refFn.slice(0, refFn.indexOf("\n}") + 2);
  assert.ok(refBody.includes("metricReferenceLines"), "참고선 함수를 못 찾았다");
  assert.match(
    codeOnly(refBody),
    /case "coverage":\s*\n\s*return \[\];/,
    "커버리지에 안전 임계가 붙었다 — 이 값은 작업자 상태가 아니라 감시 여부다",
  );
  for (const [name, src] of [
    ["severity", read("lib", "severity.ts")],
    ["store", read("app", "api", "app", "vital", "store.ts")],
  ] as const) {
    // 앵커 — 파일이 비면 아래 금지가 빈 문자열에서 통과한다(L-79).
    assert.ok(src.length > 500, `${name} 소스를 못 읽었다`);
    assert.doesNotMatch(
      codeOnly(src),
      /coverage/i,
      `${name} 에 커버리지가 유입됐다 — 표시 전용 계약이 깨졌다`,
    );
  }
});

// ── 2026-08-18 · 툴바·격자 폭 (사용자 지적) ──────────────────────────────
// ① "히트맵 우측에 여백이 많이 남는다" ② "라인/막대·기간 메뉴는 해당사항이 없음".
// 둘 다 **화면이 사실과 다른 것을 말하는** 같은 계열이다 — 여백은 격자가 1년치를 다 그렸는지
// 의심하게 만들고, 죽은 기간 버튼은 "다른 기간도 볼 수 있다"는 거짓을 말한다(L-… 차트토글과 동종).

test("⑨ ★ 커버리지 탭에서 기간·차트 컨트롤을 감추되 고정 범위는 글자로 남긴다", () => {
  assert.match(
    codeOnly(panel),
    /const isCoverage = selection\.metric === "coverage";/,
    "커버리지 판별이 사라졌다",
  );
  const i = panel.indexOf("{isCoverage ? (");
  assert.ok(i > 0, "툴바 분기를 못 찾았다");
  const mid = panel.indexOf(") : (", i);
  const end = panel.indexOf("onClick={onClose}", mid);
  assert.ok(mid > i && end > mid, "분기 구간이 깨졌다");

  const shown = panel.slice(i, mid); // 커버리지일 때 보이는 것
  const hidden = panel.slice(mid, end); // 나머지 지표에서만 보이는 것
  assert.match(
    shown,
    /최근 1년/,
    "고정 범위 표기가 사라졌다 — 컨트롤을 지우면 '1년'이라는 사실도 함께 사라진다",
  );
  assert.doesNotMatch(
    shown,
    /<button/,
    "커버리지 쪽에 버튼이 생겼다 — 눌러도 안 변하는 컨트롤은 고장으로 읽힌다",
  );
  // 양방향으로 본다 — "나머지 지표에 있다"만 보면 **커버리지 쪽에도 있는** 경우를 놓친다
  // (작성 중 음성 대조 D 가 실제로 이 구멍을 뚫고 통과했다).
  for (const [what, re] of [
    ["차트 종류", /CHART_TYPES\.map/],
    ["기간 프리셋", /RANGES\.filter/],
    ["기간 지정", /type="date"/],
  ] as const) {
    assert.match(hidden, re, `${what} 컨트롤이 커버리지 분기 밖에 있다 — 이 탭에서 다시 뜬다`);
    assert.doesNotMatch(shown, re, `${what} 컨트롤이 커버리지 쪽에도 있다 — 감춘 게 아니다`);
  }
});

test("⑩ 격자가 컨테이너 폭을 채운다(칸 고정폭으로 되돌아가지 않았다)", () => {
  // 11px 고정이면 53주 = 766px 라 넓은 패널에서 우측이 400px 넘게 빈다(사용자 실측 화면).
  const v = codeOnly(view);
  assert.match(v, /minmax\(0, 1fr\)/, "열이 가변폭이 아니다 — 우측에 빈 공간이 남는다");
  assert.match(v, /aspect-square/, "칸이 정사각 비율이 아니다 — 열이 늘면 칸이 찌그러진다");
  assert.match(v, /minWidth: MIN_GRID_W/, "최소 폭이 없다 — 좁은 화면에서 칸이 11px 밑으로 뭉개진다");
  assert.match(v, /whitespace-nowrap/, "월 라벨 줄바꿈 방지가 사라졌다(좁은 열에서 두 줄로 접힌다)");
});

test("⑪ 칸 값이 호버로 읽힌다(네이티브 title 과 겹치지 않는다)", () => {
  // title 과 커스텀 툴팁을 함께 두면 같은 자리에 두 개가 뜬다.
  assert.match(view, /onMouseEnter=\{\(e\) => showTip\(e, c, di\)\}/, "칸에 호버 핸들러가 없다");
  assert.match(view, /onMouseLeave=\{\(\) => setHover\(null\)\}/, "격자를 벗어나도 툴팁이 남는다");
  assert.doesNotMatch(codeOnly(view), /title=\{/, "네이티브 title 이 되살아났다 — 툴팁이 두 겹으로 뜬다");
  assert.match(view, /aria-label=\{`\$\{c\.date\} · \$\{cellLabel\(c\)\}`\}/, "칸의 접근성 라벨이 사라졌다");
});
