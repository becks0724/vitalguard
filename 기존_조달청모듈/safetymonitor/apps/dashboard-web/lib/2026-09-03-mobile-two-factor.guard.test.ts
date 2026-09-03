// 관리자 앱 2단계 인증 가드(2026-09-03 사용자 결정 "관제웹의 로그인 방식도 동일 구조").
//
// 지키는 성질 넷:
//   ① 모바일 세션 로그인은 관제웹과 **같은 규칙·같은 응답 모양**으로 2단계를 건다
//   ② 레거시 앱 로그인(/api/app-auth/login)에는 걸지 않는다 — 워치에 6자리 화면이 없다
//   ③ ②가 구멍이 되지 않는 이유 = **레거시 토큰은 모바일 검증을 통과하지 못한다**(구조적)
//   ④ 비번만 맞혀도 잠금이 리셋되지 않는다(6자리 무차별 대입 차단)
//
// ★ ③ 이 이 설계의 핵심이다. 워치는 2단계를 안 거치고 로그인하지만, 그 토큰으로는 관리자
//   조회에 닿을 수 없어야 한다. 그 보장이 무너지면 ② 는 그냥 우회로가 된다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { signAppJwt, signMobileAccessJwt, verifyAppJwt, verifyMobileAccessJwt } from "./app-jwt";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string): string => readFileSync(resolve(here, "..", p), "utf8");

// 주석을 걷어낸 소스 — 주석이 단언에 걸리는 것을 막는다(이 파일의 라우트 주석은
// `/api/app-auth/login` 과 `shouldChallenge` 를 **설명하려고** 언급한다).
const readCode = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const MOBILE_LOGIN = "app/api/mobile/v1/session/login/route.ts";

const withSecret = (fn: () => void) => {
  const prev = process.env.APP_JWT_SECRET;
  process.env.APP_JWT_SECRET = "test-secret-0123456789";
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.APP_JWT_SECRET;
    else process.env.APP_JWT_SECRET = prev;
  }
};

// ── ① 관제웹과 같은 구조 ─────────────────────────────────────────────────────

test("모바일 로그인이 2단계를 건다 — 대상 판정·코드 검증·재사용 차단 셋 다", () => {
  const src = readCode(MOBILE_LOGIN);
  assert.match(src, /shouldChallenge\(account\)/, "대상 판정이 사라졌다 — 관리자가 비번만으로 들어온다");
  assert.match(src, /verifyTotp\(/, "코드를 검증하지 않는다");
  assert.match(src, /markTotpStepUsed\(/, "같은 30초 코드를 두 번 쓸 수 있다");
});

test("대상 판정은 정책 모듈이 쥔다 — 라우트가 자체 조합하면 웹과 규칙이 갈라진다", () => {
  const src = readCode(MOBILE_LOGIN);
  assert.match(src, /from "[^"]*\/two-factor"/, "정책 모듈을 안 쓴다");
  assert.ok(
    !/account\.admin_access \|\| account\.site_officer/.test(src),
    "라우트가 대상 판정을 자체 구현했다 — 규칙이 두 벌이 된다",
  );
});

test("응답 모양이 관제웹과 같다 — 앱이 웹과 다른 분기를 타지 않게", () => {
  const src = readCode(MOBILE_LOGIN);
  // 웹은 `twoFactorRequired: true` 로 되묻고, 화면은 그 키 하나로 다음 단계를 안다.
  const asks = src.match(/twoFactorRequired: true/g) ?? [];
  assert.ok(asks.length >= 3, `되묻는 응답이 ${asks.length}곳 — 미입력·불일치·재사용 셋이어야 한다`);
  // 미등록 대상자는 막지 않고 표식만 내려보낸다(막으면 등록 화면이 웹에 있어 계정이 잠긴다).
  assert.match(src, /twoFactorPending:/, "미등록 안내 표식이 없다 — 앱이 등록을 권할 수 없다");
});

test("중간 토큰을 만들지 않는다 — 비밀번호를 쥔 채 코드만 더해 재전송(웹과 같은 형태)", () => {
  const src = readCode(MOBILE_LOGIN);
  assert.match(src, /body\.totpCode/, "totpCode 를 본문에서 받지 않는다");
  // 1단계 통과 표식을 따로 발급하면 발급·만료·폐기가 통째로 늘어난다. 웹이 안 하는 이유와 같다.
  assert.ok(
    !/twoFactorToken|pendingToken|challengeToken/.test(src),
    "중간 토큰을 도입했다 — 웹과 구조가 갈라지고 폐기 경로가 늘어난다",
  );
});

// ── ② 레거시는 건드리지 않는다(워치 보호) ────────────────────────────────────

test("레거시 앱 로그인에는 2단계가 없다 — 워치가 6자리를 입력할 화면이 없다", () => {
  // 2026-09-03 실측: 워치가 쓰는 admin6861 은 admin_access=true·totp_enabled=true 라
  // 여기에 걸면 shouldChallenge 가 곧바로 참이 되어 **수집이 그 자리에서 멈춘다.**
  const legacy = read("app/api/app-auth/login/route.ts");
  assert.ok(
    !/verifyTotp|totpCode|shouldChallenge/.test(legacy),
    "레거시 앱 로그인에 2단계가 끼었다 — 워치 수집이 멈춘다",
  );
});

// ── ③ 그래도 구멍이 아닌 이유 — 토큰이 구조적으로 다르다 ─────────────────────

test("레거시 토큰은 모바일 검증을 통과하지 못한다 — ②가 우회로가 되지 않는 근거", () => {
  withSecret(() => {
    const legacy = signAppJwt({ sub: "admin6861", role: "admin", name: null, workerId: "EMP-6861" });
    // 레거시 검증은 통과한다(수집 경로는 그대로 살아 있어야 한다).
    assert.ok(verifyAppJwt(legacy), "레거시 토큰이 레거시 검증에서 죽었다 — 수집이 끊긴다");
    // 그러나 모바일 검증은 통과하지 못한다 — 관리자 조회는 이 검증만 쓴다.
    assert.equal(
      verifyMobileAccessJwt(legacy),
      null,
      "2단계를 안 거친 레거시 토큰이 모바일 검증을 통과한다 — 워치 토큰으로 관제 데이터에 닿는다",
    );
  });
});

test("모바일 토큰은 네 표식을 모두 갖는다 — 하나라도 빠지면 검증이 거부한다", () => {
  withSecret(() => {
    const mobile = signMobileAccessJwt({
      sub: "admin6861",
      role: "admin",
      name: null,
      workerId: "EMP-6861",
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    const claims = verifyMobileAccessJwt(mobile);
    assert.ok(claims, "정상 모바일 토큰이 거부됐다");
    assert.equal(claims.aud, "vitalguard-mobile");
    assert.equal(claims.tokenUse, "access");
    assert.equal(claims.v, 2);
    assert.equal(claims.sessionId, "11111111-2222-3333-4444-555555555555");
    // role 이 토큰에 실려야 관리자 조회를 역할로 게이트할 수 있다.
    assert.equal(claims.role, "admin", "role 이 토큰에서 빠졌다 — 관리자 조회를 게이트할 수 없다");
  });
});

// ── ④ 무차별 대입 ────────────────────────────────────────────────────────────

test("비번만 맞혀도 잠금이 리셋되지 않는다 — 6자리 전수 탐색 차단", () => {
  const src = readCode(MOBILE_LOGIN);
  // 옛 형태: 검증 직후 결과를 그대로 기록해 비번이 맞으면 리셋했다. 그러면 코드는 무한 시도가 된다.
  assert.ok(
    !/const outcome = await authenticateAppLogin\(id, password\);\s*await recordLoginResult\(lockKey, countsAsPasswordSuccess\(outcome\)\);/.test(
      src,
    ),
    "비번 결과로 잠금을 즉시 리셋한다 — 비번을 아는 사람이 6자리를 무한정 시도할 수 있다",
  );
  const challengeAt = src.indexOf("shouldChallenge(account)");
  const win = src.indexOf("recordLoginResult(lockKey, true)");
  assert.ok(challengeAt > 0, "2단계 검사 분기가 사라졌다");
  assert.ok(win > challengeAt, "성공 기록이 2단계 검사보다 앞에 있다 — 코드를 틀려도 잠금이 이미 풀린다");
});

test("코드 실패와 재사용 둘 다 잠금에 센다", () => {
  const src = readCode(MOBILE_LOGIN);
  const fails = src.match(/recordLoginResult\(lockKey, false\)/g) ?? [];
  assert.ok(fails.length >= 2, `실패 기록이 ${fails.length}곳뿐 — 코드 불일치와 재사용 둘 다 세야 한다`);
});

test("미입력은 실패가 아니다 — 잠금을 세면 정상 로그인이 2회 만에 잠긴다", () => {
  const src = readCode(MOBILE_LOGIN);
  // 1단계만 보낸 요청과 그 직후의 응답 사이에 실패 기록이 있으면 안 된다.
  const askAt = src.indexOf("인증 앱의 6자리 코드를 입력하세요");
  assert.ok(askAt > 0, "되묻는 응답이 사라졌다");
  const before = src.slice(src.indexOf("shouldChallenge(account)"), askAt);
  assert.ok(
    !/recordLoginResult/.test(before),
    "코드 미입력을 실패로 센다 — 정상 사용자가 1단계 요청만으로 잠긴다",
  );
});
