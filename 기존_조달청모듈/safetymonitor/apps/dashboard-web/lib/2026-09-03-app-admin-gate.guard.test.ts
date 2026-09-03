// 관리자 앱 조회 게이트 가드(2026-09-03) — 지키는 성질 다섯:
//   ① 관제 라우트(/api/monitor/*)를 앱에 열지 않는다 — 새 경로를 따로 둔다
//   ② 레거시 토큰(워치·수집 단말)은 관리자 조회에 닿지 못한다
//   ③ 권한은 토큰이 아니라 **DB 에서** 읽는다 — refresh 30일이라 회수가 안 듣는다
//   ④ 조회 실패를 통과로 읽지 않는다 — DB 장애가 인가 우회가 되면 안 된다
//   ⑤ 판정을 라우트가 새로 하지 않는다 — 웹과 다른 색이 뜨면 안 된다
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { signAppJwt, signMobileAccessJwt, verifyMobileAccessJwt } from "./app-jwt";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string): string => readFileSync(resolve(here, "..", p), "utf8");
const readCode = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const GATE = "lib/app-admin-auth.ts";
const ROUTE = "app/api/app/admin/workers/route.ts";

const withSecret = (fn: () => void) => {
  const prev = process.env.APP_JWT_SECRET;
  process.env.APP_JWT_SECRET = "guard-fixture-not-a-credential";
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.APP_JWT_SECRET;
    else process.env.APP_JWT_SECRET = prev;
  }
};

// ── ① 축을 지킨다 ────────────────────────────────────────────────────────────

test("관제 조회를 앱에 열지 않는다 — 앱은 /api/app/*, 관제는 /api/monitor/*", () => {
  // 관제 라우트가 앱 토큰 검증을 들이면 작업자 폰이 동료 전원의 생체를 보게 된다.
  for (const p of ["app/api/monitor/vital/route.ts", "app/api/monitor/track/route.ts"]) {
    assert.ok(
      !/verifyMobileAccessJwt|requireAppAdmin/.test(read(p)),
      `${p} 가 앱 토큰을 받는다 — 권한 범위가 뒤집힌다`,
    );
  }
  // 반대로 앱 관리자 라우트는 관제 인가(Basic)를 쓰지 않는다.
  assert.ok(!/verifyBasicAuth/.test(readCode(ROUTE)), "앱 라우트가 관제 Basic 인가를 쓴다");
});

// ── ② 레거시 토큰 차단 ───────────────────────────────────────────────────────

test("게이트는 모바일 토큰만 받는다 — 레거시(워치)는 2단계를 안 거쳤다", () => {
  const src = readCode(GATE);
  assert.match(src, /verifyMobileAccessJwt\(/, "모바일 검증을 안 쓴다");
  assert.ok(!/verifyAppJwt\(/.test(src), "레거시 검증을 받아들인다 — 워치 토큰이 관제 데이터에 닿는다");
});

test("레거시 토큰은 실제로 거부된다 — 소스가 아니라 동작으로 확인", () => {
  withSecret(() => {
    const legacy = signAppJwt({ sub: "admin6861", role: "admin", name: null, workerId: "EMP-6861" });
    assert.equal(verifyMobileAccessJwt(legacy), null, "레거시 토큰이 모바일 검증을 통과한다");
    const mobile = signMobileAccessJwt({
      sub: "admin6861",
      role: "admin",
      name: null,
      workerId: "EMP-6861",
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    assert.ok(verifyMobileAccessJwt(mobile), "정상 모바일 토큰이 거부됐다");
  });
});

// ── ③ 권한은 DB 에서 ─────────────────────────────────────────────────────────

test("권한을 토큰의 role 로 판정하지 않는다 — refresh 30일이라 회수가 안 듣는다", () => {
  const src = readCode(GATE);
  assert.match(src, /findUserByUsername\(claims\.sub\)/, "살아 있는 계정 행을 안 읽는다");
  // `claims.role === "admin"` 만으로 통과시키면 admin_access 회수가 30일간 무효가 된다.
  assert.ok(
    !/claims\.role === "admin"/.test(src),
    "토큰의 role 로 관리 권한을 인정한다 — 회수해도 30일 통과한다",
  );
  assert.match(src, /user\.admin_access/, "admin_access 비트를 안 본다");
});

test("퇴사·거절 계정은 토큰이 남아 있어도 막는다", () => {
  assert.match(
    readCode(GATE),
    /user\.status !== "approved"/,
    "status 를 안 본다 — 자격 회수(rejected)가 앱에 안 듣는다",
  );
});

test("role 을 늘려 나누지 않는다 — 배포된 앱이 owner/admin/worker 셋만 해석한다", () => {
  const src = readCode(GATE);
  for (const bad of ['"site_admin"', '"manager"', '"supervisor"']) {
    assert.ok(!src.includes(bad), `새 role ${bad} 을 도입했다 — 앱 로그인이 실패한다`);
  }
});

// ── ④ 실패를 통과로 읽지 않는다 ──────────────────────────────────────────────

test("조회 실패는 판정 불가다 — DB 장애가 인가 우회가 되면 안 된다", () => {
  const src = readCode(GATE);
  const at = src.indexOf("} catch (e) {");
  assert.ok(at > 0, "조회 실패 처리가 없다");
  // ⚠ 고정 길이로 자르면 catch 를 넘어 바로 아래 `!user` 분기의 `ok: true` 까지 읽는다
  //   (첫 회차에서 실제로 그렇게 걸렸다). 닫는 중괄호까지만 본다.
  const block = src.slice(at, src.indexOf("\n  }", at));
  assert.ok(!/ok: true/.test(block), "조회 실패를 통과로 처리한다");
  assert.match(block, /status: 503/, "실패를 403 으로 내리면 앱이 로그아웃한다 — 503 이어야 재시도한다");
});

test("401 과 403 을 구분한다 — 앱이 재인증과 권한없음을 다르게 처리해야 한다", () => {
  const src = readCode(GATE);
  assert.match(src, /status: 401/, "재인증 응답이 없다");
  assert.match(src, /status: 403/, "권한없음 응답이 없다");
  assert.match(src, /mobileUnauthorizedAction\(token\)/, "만료와 재로그인 필요를 구분하지 않는다");
});

// ── ⑤ 판정은 한 곳에서 ───────────────────────────────────────────────────────

test("라우트가 판정을 새로 하지 않는다 — 웹과 다른 색이 뜨면 안 된다", () => {
  const src = readCode(ROUTE);
  assert.match(src, /from "[^"]*\/worker-signal"/, "공용 판정 모듈을 안 쓴다");
  assert.match(src, /workerStatus\(/, "상태 판정을 공용 함수로 안 한다");
  assert.match(src, /effectiveTone\(/, "톤 합성을 공용 함수로 안 한다");
  // 임계를 라우트가 직접 들고 있으면 웹과 갈라진다.
  assert.ok(
    !/heartRate\s*[><]=?\s*\d|spo2\s*[><]=?\s*\d/.test(src),
    "라우트가 임계를 직접 비교한다 — 관제웹과 판정이 갈라진다",
  );
});

test("끊긴 작업자의 낡은 값을 현재값으로 내보내지 않는다", () => {
  assert.match(readCode(ROUTE), /gateStaleVitals\(sample, stale\)/, "신선도 게이트가 빠졌다 — false-OK");
});

test("PII 는 관제 GET 과 같은 스위치로 가린다 — 관리자 인증과 PII 노출은 별개다", () => {
  const src = readCode(ROUTE);
  assert.match(src, /MOCK_VITAL_EXPOSE_PII/, "PII 스위치를 안 본다");
  assert.match(src, /EXPOSE_PII && sample\.latitude/, "스위치가 꺼져도 좌표가 실린다");
});

test("이상 인원은 서버가 센다 — 폰이 따로 세면 같은 화면에서 두 숫자가 갈린다", () => {
  assert.match(readCode(ROUTE), /counts: \{/, "집계가 응답에 없다");
});
