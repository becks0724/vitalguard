// PSI 표시 전용 가드 — 문헌 지수를 판정·경보로 승격하는 것은 별도 결정이다.
//   입력인 심부체온이 추정치라 오차가 지수로 전파되고, 그 전파량을 검증할 정답 데이터가 없다.
//   온열 ②(저활동·고심박)가 표시 주석으로 시작해 ③에서 알림이 된 경로와 같은 규율.
//   결정 = docs/psi/context-notes.md
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const psi = readFileSync(join(ROOT, "lib", "psi.ts"), "utf8");
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");
const notify = readFileSync(join(ROOT, "app", "api", "app", "vital", "store.ts"), "utf8");
const vital = readFileSync(join(ROOT, "app", "api", "app", "vital", "route.ts"), "utf8");

test("① PSI 가 신호등·상태 판정에 들어가지 않는다", () => {
  // 판정 함수는 severity 모듈이 담당한다 — 거기에 psi 가 새어 들어가면 표시 전용이 깨진다.
  const severity = readFileSync(join(ROOT, "lib", "severity.ts"), "utf8");
  // 앵커 — 판정이 이 모듈에 실재함을 먼저 고정한다. 판정이 다른 파일로 옮겨가면 아래 금지는
  // 빈 파일을 검사하는 셈이 되어 PSI 가 새 판정 경로로 자유롭게 들어간다.
  assert.match(severity, /export function coreTempStatus/, "판정 모듈이 여기가 아니다 — 아래 금지가 공허하다");
  assert.doesNotMatch(severity, /psi|Psi|PSI/, "판정 모듈에 PSI 가 유입됨");
});

test("② PSI 가 알림·텔레그램 경로에 들어가지 않는다", () => {
  // 앵커 — 알림 조립·응답 조립이 이 두 파일에 실재하는가.
  assert.match(notify, /recordAlert\(/, "알림 조립부가 여기가 아니다 — 아래 금지가 공허하다");
  assert.match(vital, /export async function GET/, "응답 조립부가 여기가 아니다 — 아래 금지가 공허하다");
  assert.doesNotMatch(notify, /computePsi|psiBand/, "알림 조립부(store)에 PSI 가 유입됨");
  assert.doesNotMatch(vital, /computePsi|psiBand/, "vital 응답 조립부에 PSI 가 유입됨");
});

test("③ 문헌 임계 6 / 7.5 가 그대로다 — 우리가 고른 숫자가 아니다", () => {
  assert.match(psi, /PSI_HIGH = 6\b/, "높은 부담 임계가 바뀜");
  assert.match(psi, /PSI_CRITICAL = 7\.5\b/, "고위험 임계가 바뀜");
  assert.match(psi, /TC_MAX = 39\.5\b/, "논문 상한 체온이 바뀜");
  assert.match(psi, /HR_MAX = 180\b/, "논문 상한 심박이 바뀜");
});

test("④ Tc0 는 하드코딩이 아니라 analyzers 의 CT0 import 다", () => {
  assert.match(
    psi,
    /import \{ CT0 \} from "@safetymonitor\/analyzers"/,
    "CT0 를 import 하지 않으면 같은 숫자가 두 곳에 흩어진다",
  );
  assert.doesNotMatch(psi, /Tc0\s*=\s*37\.1|const CT0 = 37\.1/, "기준 체온이 재선언됨");
});

test("⑤ 대시보드는 PSI 로 색만 바꾼다 — 판정 토큰을 만들지 않는다", () => {
  const i = dash.indexOf("PSI {psi.value.toFixed(1)}");
  assert.ok(i >= 0, "PSI 표기가 사라짐");
  const block = dash.slice(i - 700, i + 200);
  // 색 클래스만 갈린다. overall/tone/status 같은 판정 값을 만들면 표시 전용이 아니다.
  assert.doesNotMatch(block, /overall\s*=|setOverall|worseTone/, "PSI 가 판정·신호등 계산에 개입함");
});
