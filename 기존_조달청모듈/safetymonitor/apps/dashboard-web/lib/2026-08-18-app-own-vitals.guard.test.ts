// 본인 생체 조회 가드 — 남의 데이터가 새지 않게 못 박는다
//
// ★ 이 엔드포인트의 유일한 위험은 **스코프가 넓어지는 것**이다. 관제 조회를 폰에 열지 않은
//   이유가 그것이고(전 작업자 + PII), 여기서 사번을 파라미터로 받거나 관제 인가를 재사용하는
//   순간 같은 상태로 돌아간다. 값이 틀리는 게 아니라 **권한 범위가 뒤집히는** 형태라
//   화면으로는 안 보인다 — 그래서 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const route = readFileSync(join(ROOT, "app", "api", "app", "me", "vitals", "route.ts"), "utf8");
const post = readFileSync(join(ROOT, "app", "api", "app", "vital", "route.ts"), "utf8");

/** 줄 주석을 걷어낸 본문 — 금지 검사가 자기 설명 주석에 걸리지 않게(L-83). */
const codeOnly = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

// 앵커 — 대상이 비면 아래 금지들이 빈 문자열에서 조용히 통과한다(L-79).
test("앵커 — 라우트 소스를 읽었다", () => {
  assert.ok(route.length > 800, "라우트가 비었거나 옮겨갔다 — 가드를 갱신할 것");
  assert.ok(post.length > 800, "수집 라우트를 못 읽었다");
});

test("① ★ 스코프를 서명된 클레임에서만 읽는다", () => {
  assert.match(
    codeOnly(route),
    /verifyAppJwt\(bearerToken\(request\)\)/,
    "앱 JWT 검증이 사라졌다",
  );
  assert.match(codeOnly(route), /claims\?\.workerId/, "사번 클레임 검사가 사라졌다");
  assert.match(codeOnly(route), /status: 401/, "무자격 요청을 거부하지 않는다");
});

test("② ★★ 사번을 요청에서 받지 않는다 — 남의 사번 조회 차단", () => {
  const code = codeOnly(route);
  for (const [what, re] of [
    ["쿼리 파라미터", /searchParams/],
    ["URL 파싱", /new URL\(request\.url\)/],
    ["본문 파싱", /request\.json\(\)|readBoundedJson/],
  ] as const) {
    assert.doesNotMatch(
      code,
      re,
      `${what} 로 입력을 받는다 — 사번이 클라이언트에서 오면 남의 것을 조회할 수 있다`,
    );
  }
});

test("③ ★ 관제 인가를 재사용하지 않는다", () => {
  // verifyBasicAuth 는 관제 세션·오너 자격이다. 여기 쓰면 폰이 관제 권한으로 도는 셈이 된다.
  assert.doesNotMatch(
    codeOnly(route),
    /verifyBasicAuth/,
    "관제 인가가 유입됐다 — 이 경로는 앱 JWT 전용이다",
  );
  // 반대로 수집 라우트의 GET 은 여전히 관제 인가여야 한다(폰에 열리면 전 작업자가 샌다).
  assert.match(
    codeOnly(post),
    /export async function GET[\s\S]{0,400}?verifyBasicAuth\(request\)/,
    "관제 조회가 앱 JWT 로 열렸다 — 작업자 폰이 동료 전원의 생체를 보게 된다",
  );
});

test("④ ★ 응답에 본인 키만 담긴다(맵을 통째로 싣지 않는다)", () => {
  const code = codeOnly(route);
  // 맵 전체를 실으면 한 줄 실수로 전 작업자가 나간다.
  for (const bare of ["coreMap,", "countMap,", "latest,", "aliases,"]) {
    assert.ok(!code.includes(`    ${bare}`), `${bare} 를 응답에 통째로 실었다`);
  }
  assert.match(code, /coreMap\?\.\[me\]/, "추정 체온을 본인 키로 꺼내지 않는다");
  assert.match(code, /countMap\[me\]/, "누적을 본인 키로 꺼내지 않는다");
});

test("⑤ 별칭을 관제웹과 같은 방식으로 접는다", () => {
  // 접지 않으면 EMP-admin6861 과 EMP-6861 이 따로 세어져 폰·관제 누적이 갈린다(08-12 전례).
  assert.match(codeOnly(route), /workerAliases/, "별칭 접기가 없다");
  assert.match(
    codeOnly(route),
    /aliases\[claims\.workerId\] \?\? claims\.workerId/,
    "본인 키를 별칭으로 정규화하지 않는다",
  );
});

test("⑥ 조회 실패를 0 으로 떨어뜨리지 않는다", () => {
  // 누적 0 은 "한 건도 수집된 적 없다" 로 읽힌다 — 조회 실패와 구별돼야 한다.
  assert.match(
    codeOnly(route),
    /countMap \? \(countMap\[me\] \?\? 0\) : null/,
    "DB 실패 시 누적이 0 이 된다",
  );
});

test("⑦ env owner 는 '대상 아님' 으로 답한다", () => {
  // 합성 사번이라 생체가 영영 없다. 누적 0 으로 주면 "수집됐는데 0" 이 된다.
  assert.match(codeOnly(route), /bootstrapOwnerWorkerId\(claims\.sub\)/, "owner 판별이 사라졌다");
  assert.match(codeOnly(route), /applicable: false/, "대상 아님 표기가 없다");
  // 접두사 문자열 비교로 되돌아가면 생성 규칙과 갈린다.
  assert.doesNotMatch(
    codeOnly(route),
    /startsWith\("owner-"\)/,
    "접두사 비교로 되돌아갔다 — 생성 함수와 규칙이 두 벌이 된다",
  );
});

test("⑧ ★ 인스턴스 메모리 링에 의존하지 않는다", () => {
  // `latestByWorker` 는 **그 프로세스가 받은 POST** 만 담는다. maxScale=4 라 폰이 자기 샘플을
  // 받은 적 없는 인스턴스에 붙으면 PSI·스트레스가 통째로 사라진다(2026-08-18 실측: 인스턴스 2개).
  // 한 사람만 보는 화면이라 관제보다 치명적이다.
  const code = codeOnly(route);
  assert.doesNotMatch(code, /latestByWorker/, "메모리 링으로 되돌아갔다 — 인스턴스에 따라 값이 사라진다");
  assert.match(code, /recentSamplesForWorkers/, "DB 조회가 사라졌다");
  // 병합은 관제와 **같은 함수**로 — 각자 구현하면 활동 필드 TTL 같은 규칙이 갈린다.
  assert.match(code, /mergeLatestByWorker/, "관제와 같은 병합을 쓰지 않는다");
});

test("⑨ ★ 신선도 게이트가 관제와 같은 기준이다", () => {
  // sticky 병합은 마지막 실측값을 유지한다 — 게이트가 없으면 워치를 벗어도 3시간 전 심박으로
  // PSI·스트레스를 계산해 "지금 내 상태" 로 보여준다.
  const code = codeOnly(route);
  assert.match(
    code,
    /vitalAgeMs\(merged, Date\.now\(\)\) >=\s*staleThresholdMs\(merged\.dataOrigin\)/,
    "신선도 판정이 사라졌다",
  );
  assert.match(code, /gateStaleVitals\(merged, stale\)/, "끊긴 값을 비우지 않는다");

  // ★ 2026-08-25 부터 문턱은 출처별이다(애플 60초 · 갤럭시 150초). 종전에는 양쪽이 각자
  //   `const STALE_MS = 60_000` 을 들고 **값이 같은지**를 대조했는데, 그 형태는 값이 하나일
  //   때만 성립한다. 이제는 **같은 함수를 쓰는지**로 묶는다 — 값이 갈릴 여지 자체를 없앤다.
  assert.doesNotMatch(
    code,
    /const STALE_MS\s*=/,
    "폰이 문턱을 자기 상수로 다시 들었다 — 관제와 갈릴 여지가 생긴다(lib/vital-age.ts 를 쓸 것)",
  );
  const dash = codeOnly(
    readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8"),
  );
  assert.match(
    dash,
    /staleThresholdMs\(sample\.dataOrigin\)/,
    "관제가 공용 문턱 함수를 안 쓴다 — 폰과 같은 순간에 다른 말을 한다",
  );
});

test("⑩ 안정 심박만 창을 길게 본다", () => {
  // 하루 단위 기준값이라 며칠 전 값도 유효하다(PSI 의 HR0). 반면 HRV·호흡수는 그 순간의
  // 상태 지표라 같은 취급을 하면 며칠 전 값으로 "지금 스트레스" 를 말하게 된다.
  const code = codeOnly(route);
  assert.match(code, /latestRestingHeartRate\(siblings\)/, "안정 심박 별도 조회가 사라졌다");
  assert.match(
    code,
    /recentSamplesForWorkers\(siblings, 180\)/,
    "상태 지표 창이 바뀌었다 — 길게 잡으면 며칠 전 HRV 로 현재를 말한다",
  );
});
