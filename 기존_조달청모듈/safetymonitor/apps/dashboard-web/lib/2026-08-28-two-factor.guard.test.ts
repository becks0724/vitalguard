// 2단계 인증 가드(2026-08-28 사용자 결정) — 지키는 성질 다섯:
//   ① 대상은 고권한 계정뿐이고, 앱 로그인 경로는 건드리지 않는다
//   ② 시크릿은 어떤 응답으로도 나가지 않는다
//   ③ 같은 30초 코드를 두 번 쓸 수 없다(다중 인스턴스에서도)
//   ④ 비번만 맞혀도 잠금이 리셋되지 않는다(6자리 무차별 대입 차단)
//   ⑤ 미등록 대상자를 로그인에서 막지 않는다(막으면 등록 화면에 못 가 계정이 잠긴다)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { requiresTwoFactor, shouldChallenge, twoFactorPending } from "./two-factor";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string): string => readFileSync(resolve(here, "..", p), "utf8");

// 주석을 걷어낸 소스 — "이 컬럼은 여기 적지 않는다" 같은 **주석이 단언에 걸리는** 것을 막는다.
// (실제로 걸렸다: users/route.ts 의 화이트리스트 주석이 totp_secret 을 언급한다)
const readCode = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const base = { role: "admin", admin_access: false, site_officer: false, totp_enabled: false };

// ── ① 대상 ───────────────────────────────────────────────────────────────────

test("대상은 고권한 계정뿐 — 일반 관리자는 제외", () => {
  assert.equal(requiresTwoFactor({ ...base, role: "owner" }), true, "최고관리자가 빠졌다");
  assert.equal(requiresTwoFactor({ ...base, admin_access: true }), true, "관리자메뉴 권한자가 빠졌다");
  assert.equal(requiresTwoFactor({ ...base, site_officer: true }), true, "담당관이 빠졌다");
  assert.equal(requiresTwoFactor(base), false, "권한 없는 계정까지 대상이 됐다");
});

test("현장 근로자는 절대 대상이 아니다 — 앱에 6자리 화면이 없어 현장에서 못 쓴다", () => {
  // worker 는 admin_access·site_officer 를 받을 수 없는 계정이지만, 혹시 켜지더라도
  // 이 테스트가 의도를 남긴다: 앱 로그인 경로(/api/app-auth/login)에는 단계를 끼우지 않는다.
  assert.equal(requiresTwoFactor({ ...base, role: "worker" }), false);
  const appLogin = read("app/api/app-auth/login/route.ts");
  assert.ok(!/verifyTotp|totpCode|shouldChallenge/.test(appLogin), "앱 로그인에 2단계가 끼었다");
});

test("대상이어도 등록 전에는 묻지 않는다 — 물으면 등록 화면에 못 가 계정이 잠긴다", () => {
  const target = { ...base, admin_access: true };
  assert.equal(shouldChallenge(target), false, "미등록자에게 코드를 요구한다");
  assert.equal(twoFactorPending(target), true, "미등록 안내가 안 뜬다");
  assert.equal(shouldChallenge({ ...target, totp_enabled: true }), true, "등록했는데 안 묻는다");
  assert.equal(twoFactorPending({ ...target, totp_enabled: true }), false);
});

test("대상이 아니면 켜져 있어도 묻지 않는다 — 권한을 잃은 계정이 갇히지 않게", () => {
  assert.equal(shouldChallenge({ ...base, totp_enabled: true }), false);
});

// ── ② 시크릿 유출 ────────────────────────────────────────────────────────────

test("사용자 목록은 화이트리스트다 — 새 비밀 컬럼이 자동으로 새지 않는다", () => {
  const src = readCode("app/api/admin/users/route.ts");
  // 스프레드로 바꾸면 totp_secret 이 그대로 나간다. 형태 자체를 못 박는다.
  assert.ok(!/\.\.\.u[,\s}]/.test(src), "publicUser 가 스프레드로 바뀌었다 — 비밀 컬럼이 샌다");
  assert.ok(!/totp_secret/.test(src), "사용자 목록에 시크릿이 실린다");
  assert.ok(!/totp_last_step/.test(src), "재사용 카운터가 노출된다");
  assert.match(src, /totp_enabled: u\.totp_enabled/, "켜짐 여부는 내려줘야 초기화 버튼이 뜬다");
});

test("내 정보 응답에도 시크릿이 없다", () => {
  assert.ok(!/totp_secret/.test(readCode("app/api/admin/profile/route.ts")));
});

test("활성화된 뒤에는 시크릿을 다시 주지 않는다 — 세션을 훔친 쪽의 앱 등록을 막는다", () => {
  const src = read("app/api/admin/totp/route.ts");
  // GET 은 '등록 중(!enabled && secret 있음)' 일 때만 secret/uri 를 싣는다.
  assert.match(src, /const enrolling = !user\.totp_enabled &&/, "등록 중 판정이 사라졌다");
  assert.match(src, /\.\.\.\(enrolling\s*\?/, "활성 계정에도 시크릿을 내려준다");
});

// ── ③ 코드 재사용 ────────────────────────────────────────────────────────────

test("재사용 차단은 DB 조건이다 — 메모리로 세면 인스턴스마다 따로 센다", () => {
  const db = read("lib/db.ts");
  assert.match(
    db,
    /WHERE id = \$1 AND \(totp_last_step IS NULL OR totp_last_step < \$2\)/,
    "재사용 차단 조건이 사라졌다 — 같은 코드가 여러 번 통과한다",
  );
  assert.match(db, /export async function markTotpStepUsed/, "재사용 기록 함수 소실");
});

test("로그인과 해제 양쪽에서 재사용을 막는다 — 훔친 코드 한 개로 2단계를 끄지 못하게", () => {
  for (const path of ["app/api/admin/login/route.ts", "app/api/admin/totp/route.ts"]) {
    assert.match(read(path), /markTotpStepUsed\(/, `${path} 가 재사용을 안 막는다`);
  }
});

test("2단계 해제에는 코드가 필요하다 — 세션만으로 끄면 붙인 의미가 없다", () => {
  const src = read("app/api/admin/totp/route.ts");
  const at = src.indexOf('action === "disable"');
  assert.ok(at > 0, "해제 경로 소실");

  // ⚠ 파일 전체를 보면 안 된다 — `if (user.totp_enabled)` 는 begin·confirm 에도 있어서,
  //   느슨한 매칭이 **다른 블록의 verifyTotp** 를 집어 통과한다(2026-08-28 변이 검증에서
  //   실제로 놓쳤다). 해제 블록만 잘라서 본다.
  const block = src.slice(at);
  assert.match(block, /verifyTotp\(/, "해제가 코드를 검증하지 않는다 — 세션만으로 꺼진다");
  assert.match(block, /markTotpStepUsed\(/, "해제가 코드 재사용을 막지 않는다");
  // 검증 결과를 무시하고 통과시키는 형태(상수 ok)도 막는다.
  assert.ok(
    !/const result = \{\s*ok:\s*true/.test(block),
    "해제가 검증 결과를 상수로 대체했다",
  );
});

test("분실 복구는 관리자 경로에만 있다 — 본인이 코드 없이 못 끄는 것의 짝", () => {
  const src = read("app/api/admin/users/route.ts");
  assert.match(src, /action === "reset_totp"/, "관리자 초기화 경로 소실");
  assert.match(src, /verifyUserAdmin/, "초기화가 관리 권한 게이트 뒤에 없다");
});

// ── ④ 무차별 대입 ────────────────────────────────────────────────────────────

test("비번만 맞혀도 잠금이 리셋되지 않는다 — 6자리 전수 탐색 차단", () => {
  const src = read("app/api/admin/login/route.ts");
  // 옛 형태: 비번 결과를 그대로 기록해 성공이면 리셋했다. 그러면 코드는 무한 시도가 된다.
  assert.ok(
    !/recordLoginResult\(lockKey, pwOk\)/.test(src),
    "비번 결과로 잠금을 리셋한다 — 비번을 아는 사람이 6자리를 무한정 시도할 수 있다",
  );
  assert.match(src, /if \(!pwOk\) await recordLoginResult\(lockKey, false\)/, "비번 실패 누적이 사라졌다");
  assert.match(src, /await recordLoginResult\(lockKey, true\)/, "성공 시 리셋이 사라졌다");
});

test("코드 실패도 잠금에 센다", () => {
  const src = read("app/api/admin/login/route.ts");
  // verifyTotp 실패 분기와 재사용 분기 양쪽에 실패 기록이 있어야 한다.
  const fails = src.match(/recordLoginResult\(lockKey, false\)/g) ?? [];
  assert.ok(fails.length >= 3, `실패 기록이 ${fails.length}곳뿐 — 비번·코드·재사용 셋 다 세야 한다`);
});

test("가입 계정의 성공 기록은 2단계 검사 뒤에 온다 — 앞에 두면 리셋이 먼저 일어난다", () => {
  const src = readCode("app/api/admin/login/route.ts");
  // ⚠ 성공 기록이 파일에 여러 번 나오는 것 자체는 정상이다 — env owner·데모 계정은 별도
  //   경로로 즉시 성공하며(둘 다 DB 행이 없어 2단계 대상이 아니다) 자기 자리에서 기록한다.
  //   지켜야 할 것은 **가입 계정 경로에서 순서**다: 2단계 검사 → 성공 기록.
  const challengeAt = src.indexOf("shouldChallenge(user)");
  const lastWin = src.lastIndexOf("recordLoginResult(lockKey, true)");
  assert.ok(challengeAt > 0, "2단계 검사 분기가 사라졌다");
  assert.ok(
    lastWin > challengeAt,
    "성공 기록이 2단계 검사보다 앞에 있다 — 코드를 틀려도 잠금이 이미 풀린다",
  );
});

// ── ⑤ 알고리즘·표준 ──────────────────────────────────────────────────────────

test("표준 파라미터를 바꾸지 않는다 — 바꾸면 인증 앱이 다른 숫자를 낸다", () => {
  const src = read("lib/totp.ts");
  assert.match(src, /TOTP_DIGITS = 6/);
  assert.match(src, /TOTP_PERIOD_SEC = 30/);
  // SHA-1 은 취약해서가 아니라 표준이라 쓴다. '개선'하면 앱 대부분이 못 읽는다.
  assert.match(src, /createHmac\("sha1"/, "HMAC 알고리즘이 바뀌었다 — 인증 앱이 못 읽는다");
  assert.match(src, /algorithm: "SHA1"/, "URI 의 알고리즘 표기가 어긋났다");
});

test("코드 비교는 상수시간 — 6자리는 탐색 공간이 좁아 타이밍 누출이 실제로 쓸모 있다", () => {
  const src = read("lib/totp.ts");
  assert.match(src, /timingSafeEqual\(/, "상수시간 비교가 사라졌다");
  assert.ok(
    !/expected === clean|clean === expected/.test(src),
    "문자열 === 로 코드를 비교한다 — 앞자리부터 응답시간이 샌다",
  );
});

test("시계 오차 창은 ±1스텝 — 넓히면 훔친 코드의 수명이 같이 늘어난다", () => {
  assert.match(read("lib/totp.ts"), /TOTP_WINDOW = 1/);
});

test("대상 판정은 한 곳에서만 — 화면·로그인·관리가 각자 판정하면 어긋난다", () => {
  for (const path of ["app/api/admin/login/route.ts", "app/api/admin/totp/route.ts"]) {
    const src = read(path);
    assert.match(src, /from "[^"]*\/two-factor"/, `${path} 가 정책 모듈을 안 쓴다`);
    // 라우트가 role/admin_access 를 직접 조합해 판정하면 규칙이 두 벌이 된다.
    assert.ok(
      !/user\.admin_access \|\| user\.site_officer/.test(src),
      `${path} 가 대상 판정을 자체 구현했다`,
    );
  }
});

// ── ⑥ 화면 ───────────────────────────────────────────────────────────────────

test("로그인 2단계는 카드를 덮는 패널이다 — 갈아치우면 취소된 줄 안다", () => {
  const prompt = read("app/components/TwoFactorPrompt.tsx");
  assert.match(prompt, /absolute inset-0/, "떠 있는 배치가 아니다");
  assert.match(prompt, /backdrop-blur/, "뒤 카드가 안 흐려진다");
  assert.match(prompt, /aria-modal="true"/, "모달로 읽히지 않는다");
  // 카드 안에 놓여야 뒤 카드가 그대로 보인다(화면 전체에 두면 카드가 사라진 것처럼 보인다).
  const login = read("app/components/LoginScreen.tsx");
  assert.match(login, /<TwoFactorPrompt/, "로그인 화면이 패널을 안 띄운다");
});

test("2단계 요구는 오류로 표시하지 않는다 — 실패가 아니라 다음 단계다", () => {
  const login = read("app/components/LoginScreen.tsx");
  assert.match(login, /if \(json\.twoFactorRequired\)/, "다음 단계 분기가 없다");
  // twoFactorError 를 로그인 폼 error 와 나눠 둔다(섞으면 패널을 닫아도 빨간 글씨가 남는다).
  assert.match(login, /setTwoFactorError/, "패널 전용 오류 상태가 없다");
});

test("등록은 문자열이 기본이고 QR 은 선택이다 — 2026-08-28 사용자 지시", () => {
  const setup = read("app/components/TwoFactorSetup.tsx");
  assert.match(setup, /useState\(false\)[^\n]*\n/, "상태 선언이 사라졌다");
  assert.match(setup, /const \[showQr, setShowQr\] = useState\(false\)/, "QR 이 기본으로 켜져 있다");
  assert.match(setup, /QR 코드로 보기/, "QR 전환 버튼이 없다");
  assert.match(setup, /키 문자열 보기/, "문자열로 돌아오는 길이 없다");
});

test("비밀번호가 2단계 패널까지 내려가지 않는다", () => {
  const prompt = read("app/components/TwoFactorPrompt.tsx");
  assert.ok(!/password/i.test(prompt), "패널이 비밀번호를 들고 있다 — 노출면이 커진다");
});

// ── ⑦ QR(선택 경로) ──────────────────────────────────────────────────────────

test("QR 은 등록 재료와 함께 한 곳에서 만든다 — GET·begin 이 다르면 새로고침에 화면이 달라진다", () => {
  const src = readCode("app/api/admin/totp/route.ts");
  assert.match(src, /function enrollmentPayload\(/, "등록 재료 조립이 한 곳에 없다");
  // GET(등록 중 복귀)과 begin(첫 발급) 둘 다 같은 함수를 써야 한다.
  const uses = src.match(/enrollmentPayload\(/g) ?? [];
  assert.ok(uses.length >= 3, `enrollmentPayload 사용이 ${uses.length}곳 — 정의 + GET + begin 이어야 한다`);
});

test("QR 실패가 등록을 막지 않는다 — 키 문자열이 기본 경로다", () => {
  const qr = readCode("lib/totp-qr.ts");
  // 예외를 밖으로 던지면 begin 이 통째로 500 이 되어 문자열 등록까지 못 하게 된다.
  assert.match(qr, /catch\s*\{[\s\S]*?return null/, "QR 실패가 예외로 새어 나간다");
  const route = readCode("app/api/admin/totp/route.ts");
  // qrDataUri 는 있을 때만 싣는다(없다고 응답 자체가 깨지면 안 된다).
  assert.match(route, /\.\.\.\(qr \? \{ qrDataUri: qr \} : \{\}\)/, "QR 없을 때의 처리가 사라졌다");
});

test("SVG 는 base64 로 감싼다 — 원시 SVG data URI 는 브라우저마다 깨진다", () => {
  const qr = readCode("lib/totp-qr.ts");
  assert.match(qr, /data:image\/svg\+xml;base64,/, "base64 data URI 가 아니다");
  assert.ok(!/data:image\/svg\+xml,\$\{/.test(qr), "원시 SVG 를 data URI 에 그대로 넣는다");
});

test("QR 라이브러리는 의존성 0짜리를 쓴다 — 2026-08-28 Socket 검사 후 사용자 승인", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
  assert.ok(pkg.dependencies?.uqr, "uqr 이 빠졌다");
  // qrcode 는 의존성 28개(안 쓸 CLI 파서 트리)라 기각했다 — 되돌아가면 공급망 표면이 다시 커진다.
  assert.ok(!pkg.dependencies?.qrcode, "qrcode 로 되돌아갔다 — 의존성 28개가 다시 붙는다");
});
