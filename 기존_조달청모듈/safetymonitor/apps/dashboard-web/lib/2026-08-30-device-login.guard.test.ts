// 워치 QR 로그인 가드 — 토큰은 secret 을 든 poll 에만 · 자격 판정은 login 과 한 함수 · 1회 소비 · /pair 는 로그인 화면과 같은 재료
//
// ★ 되돌아가는 방식은 값이 아니라 배선이다 — 토큰을 start 응답에 싣거나, approve 가 자기 검증을 만들거나,
//   poll 이 secret 을 안 보거나, /pair 가 스타일을 복사하거나. 소스를 읽어 못 박는다(주석 제외).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const start = codeOnly(read("app", "api", "app-auth", "device", "start", "route.ts"));
const approve = codeOnly(read("app", "api", "app-auth", "device", "approve", "route.ts"));
const poll = codeOnly(read("app", "api", "app-auth", "device", "poll", "route.ts"));
const login = codeOnly(read("app", "api", "app-auth", "login", "route.ts"));
const lib = codeOnly(read("lib", "device-login.ts"));
const db = codeOnly(read("lib", "db.ts"));
const pair = codeOnly(read("app", "components", "PairApprove.tsx"));
const page = codeOnly(read("app", "pair", "page.tsx"));

test("① start — 토큰이 없다 · secret 은 해시로 저장 · IP 토큰버킷 · QR 은 uqr 행렬", () => {
  assert.doesNotMatch(start, /signAppJwt|token:/, "start 응답에 토큰이 실린다 — QR 만 찍으면 로그인되는 구조");
  assert.match(start, /hashDeviceSecret\(secret\)/, "secret 원문을 저장한다");
  assert.match(start, /createDeviceLogin\(code, secretHash, DEVICE_LOGIN_TTL_SEC, ip\)/, "TTL·해시 배선이 바뀌었다");
  assert.match(start, /consumeToken\(`device-start:\$\{ip\}`, 10, 60_000\)/, "start 레이트리밋이 사라졌다");
  assert.match(start, /qr: qrMatrix\(url\)/, "QR 행렬을 안 준다 — 워치가 라이브러리를 들고 와야 한다");
  assert.match(lib, /from "uqr"/, "QR 인코더가 uqr 이 아니다(의존 추가 금지)");
});

test("② approve — 자격 판정·잠금·발급이 login 라우트와 같은 함수·같은 키 접두", () => {
  for (const re of [
    /const lockKey = `app:\$\{ip\}:\$\{id\}`/,
    /await loginLockRemainingMs\(lockKey\)/,
    /await authenticateAppLogin\(id, password\)/,
    /await recordLoginResult\(lockKey, countsAsPasswordSuccess\(outcome\)\)/,
    /signAppJwt\(\{ sub, role, name, workerId \}\)/,
  ]) {
    assert.match(login, re, `기준(login)에서 사라짐: ${re}`);
    assert.match(approve, re, `approve 가 login 과 갈라졌다: ${re}`);
  }
  // 코드 판정은 자격 뒤 — 코드 존재 여부가 무인증 탐색에 안 샌다.
  assert.ok(approve.indexOf("authenticateAppLogin(") < approve.indexOf("readDeviceLogin("), "코드를 자격보다 먼저 본다");
  assert.match(approve, /approveDeviceLogin\(code, \{ token, sub, workerId, workerName: name \}\)/, "토큰 바인딩 배선");
});

test("③ poll — secret 대조 없이는 404 · 없음과 불일치가 같은 응답 · 승인분은 1회 소비", () => {
  assert.match(poll, /if \(!row \|\| !secretMatches\(secret, row\.secret_hash\)\)/, "secret 을 안 보거나 없음/불일치를 가른다");
  assert.match(poll, /error: "not_found" \}, \{ status: 404 \}/, "불일치 응답이 404 가 아니다");
  assert.match(poll, /await consumeDeviceLogin\(code\)/, "소비 없이 토큰을 낸다 — 두 번째 poll 도 토큰을 받는다");
  assert.match(poll, /consumeToken\(`device-poll:\$\{ip\}`, 60, 60_000\)/, "poll 레이트리밋");
  assert.doesNotMatch(poll, /signAppJwt/, "poll 이 토큰을 새로 만든다 — 승인 없이 발급");
});

test("④ DB — 승인은 pending·미만료에만, 소비는 approved 에만(한 문장 · 경쟁 안전) · TTL 300", () => {
  assert.match(db, /WHERE code = \$1 AND status = 'pending' AND expires_at > now\(\)/, "승인 조건이 풀렸다");
  assert.match(db, /SET status = 'consumed', consumed_at = now\(\), token = NULL/, "소비 때 토큰을 지우지 않는다");
  assert.match(db, /WHERE a\.code = \$1 AND a\.status = 'approved'/, "소비 조건이 풀렸다");
  assert.match(db, /RETURNING cur\.token AS token/, "소비가 옛 토큰을 한 문장 안에서 돌려주지 않는다");
  assert.match(db, /CREATE TABLE IF NOT EXISTS app_device_login/, "테이블이 사라졌다");
  const ttl = /export const DEVICE_LOGIN_TTL_SEC = (\d+);/.exec(lib);
  assert.ok(ttl && Number(ttl[1]) >= 120 && Number(ttl[1]) <= 600, "TTL 이 2~10분 밖이다");
});

test("⑤ /pair — 로그인 화면과 같은 재료(셰이더 배경·글래스 입력·LiquidMetal 버튼·로고) · 코드 확인 문구 · 승인 라우트", () => {
  assert.match(pair, /import \{ LiquidMetalButton \} from "\.\/LiquidMetalButton"/, "버튼이 로그인 화면과 다르다");
  assert.match(pair, /import \{ LoginShaderBackground \} from "\.\/LoginShaderBackground"/, "배경이 로그인 화면과 다르다");
  assert.match(pair, /import \{ FIELD_BASE, INPUT_CLASS, LABEL_PHONE_HIDDEN \} from "\.\/login-styles"/, "입력 스타일을 복사했다");
  assert.match(pair, /\/brand\/vitalguard-logo-dark\.png/, "로고가 다르다");
  assert.match(pair, /다른 코드를 승인하면 다른 워치가 로그인됩니다/, "코드 확인 경고가 사라졌다");
  assert.match(pair, /fetch\("\/api\/app-auth\/device\/approve"/, "승인 라우트 배선");
  assert.doesNotMatch(pair, /rounded-xl border border-white\/25 bg-white\/10/, "글래스 입력 클래스를 인라인 복사했다 — login-styles 를 써라");
  assert.match(page, /<PairApprove initialCode=/, "페이지가 승인 컴포넌트를 안 쓴다");
});
