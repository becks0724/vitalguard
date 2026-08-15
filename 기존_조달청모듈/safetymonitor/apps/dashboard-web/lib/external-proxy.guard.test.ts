// 구조적 재발 방지 — 외부 유료·쿼터 API 프록시가 무방비로 열리는 것을 막는다 (감사 BE-AUTHZ-08).
// 이 4개는 우리 키로 외부 API 를 대신 호출해 주는 경로라, 열려 있으면 외부인이 우리 쿼터를 쓴다.
//
// 왜 가드 테스트인가 — 라우트 파일은 언제든 추가·수정되고, 인가 한 줄이 빠져도 화면은 멀쩡히 돈다.
// 눈으로 세면 놓친다(교훈 L-12: 개수를 세지 말고 열거할 것). 여기서 실패로 드러나게 한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function routeSource(name: string): string {
  return readFileSync(join(ROOT, "app", "api", name, "route.ts"), "utf8");
}

// 인가 + 빈도 제한을 모두 요구하는 프록시.
const GUARDED = ["news"];

// 빈도 제한만 두는 프록시 — 인가를 붙이면 **의도된 기능이 깨지는** 경우다(교훈 L-11).
// 예외는 취향이 아니라 소비처의 제약에서 나온다.
//  - vworld-tile        : 소비처가 <img src> 라 Authorization 헤더를 실을 수 없다(쿠키 인증 경로 없음).
//  - nts                : 소비처 BusinessVerifyCard 가 로그인 없는 공개 데모(safety-audit)에도 실린다.
//  - tax-invoice-issuance: 위와 같은 컴포넌트·같은 이유.
// 셋 다 실제 피해는 "유료·쿼터 키 소진"이므로 빈도 제한이 그 피해를 직접 막는다.
const RATE_LIMIT_ONLY = ["vworld-tile", "nts", "tax-invoice-issuance"];

test("인가 가능한 외부 API 프록시는 인가를 요구한다", () => {
  const offenders = GUARDED.filter(
    (r) => !/verifyBasicAuth|hasAdminMenuAccess|verifyOwner|getSession/.test(routeSource(r)),
  );
  assert.deepEqual(
    offenders,
    [],
    `인가 없이 외부 API 키를 쓰는 프록시가 있다: ${offenders.join(", ")}`,
  );
});

test("외부 API 프록시 4종 전부 빈도 제한을 건다", () => {
  const offenders = [...GUARDED, ...RATE_LIMIT_ONLY].filter(
    (r) => !/consumeToken\s*\(/.test(routeSource(r)),
  );
  assert.deepEqual(
    offenders,
    [],
    `빈도 제한 없는 외부 프록시가 있다: ${offenders.join(", ")}`,
  );
});

// 예외는 "그냥 안 붙인 것"과 구별돼야 한다. 근거가 사라지면(주석 삭제) 실패시켜
// 다음 사람이 예외를 재검토하게 만든다. 근거 없는 예외는 그냥 구멍이다.
test("인가 예외 3종은 각각 근거가 소스에 남아 있다", () => {
  const reasons: Record<string, RegExp> = {
    // <img> 소비라 헤더를 실을 수 없다.
    "vworld-tile": /<img/,
    // 로그인 없는 공개 데모 화면에서도 호출된다.
    nts: /공개 데모|로그인 없[는이]/,
    "tax-invoice-issuance": /공개 데모|로그인 없[는이]/,
  };
  for (const [route, re] of Object.entries(reasons)) {
    assert.match(
      routeSource(route),
      re,
      `${route} 의 인가 예외 근거가 주석에서 사라졌다 — 예외를 유지할지 다시 판단할 것`,
    );
  }
});

// 클라이언트가 토큰을 실어야 인가가 실제로 통과한다. 라우트만 막고 호출부를 안 고치면
// 기능이 조용히 죽는다(교훈 L-11 — 인가 추가가 호출자를 끊는 사고).
test("인가가 걸린 프록시의 호출부는 Authorization 을 동봉한다", () => {
  const callers = [["app/components/NewsPanel.tsx", "/api/news"]] as const;
  for (const [file, path] of callers) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.ok(src.includes(path), `${file} 이 ${path} 를 더는 호출하지 않는다(테스트 갱신 필요)`);
    assert.match(
      src,
      /Authorization/,
      `${file} 이 ${path} 호출에 Authorization 을 싣지 않는다`,
    );
  }
});

// 공개 데모 화면이 호출하는 프록시에 인가가 붙으면 그 화면이 401 로 죽는다.
// 위 RATE_LIMIT_ONLY 주석만으로는 다음 사람이 "인가가 낫지 않나" 하고 붙일 수 있으므로,
// 전제(safety-audit 가 로그인 없이 열린다)가 유지되는 동안에는 인가가 없음을 고정한다.
// 공개 데모를 접기로 하면 이 테스트가 먼저 깨져 함께 재검토하게 된다(FE-PUBLIC-01).
test("공개 데모가 여전히 로그인 없이 열린다면 그 프록시에는 인가가 없어야 한다", () => {
  const page = readFileSync(join(ROOT, "app/safety-audit/page.tsx"), "utf8");
  // 앵커 — 이 판정은 '없음'을 근거로 삼으므로(부재 → 공개) 파일이 비거나 화면이 옮겨가면
  // isPublic 이 참으로 굳는다. 그러면 이 고정이 **인가를 붙이려는 쪽을 잘못 막는다**
  // (다른 금지형 가드와 반대 방향의 사고다). 화면이 여기 실재함을 먼저 확인한다.
  assert.match(page, /SafetyCostAuditBoard/, "safety-audit 화면이 여기가 아니다 — 공개 여부 판정을 신뢰할 수 없다");
  const isPublic = !page.includes("LoginGate");
  if (!isPublic) return; // 로그인 뒤로 옮겨졌다면 이 고정은 더는 유효하지 않다.
  for (const route of ["nts", "tax-invoice-issuance"]) {
    assert.doesNotMatch(
      routeSource(route),
      /verifyBasicAuth|hasAdminMenuAccess|verifyOwner/,
      `${route} 에 인가가 붙었는데 safety-audit 는 아직 공개다 — 그 화면이 401 로 죽는다`,
    );
  }
});
