// 구조적 재발 방지 — 태풍 선택 칩의 "경보 주체 ≠ 보기 대상" 분리 가드.
//
// 왜 가드 테스트인가 — 이 레포에는 컴포넌트 렌더 테스트 인프라가 없다(Playwright·testing-library 미설치).
// 분리가 깨져도 tsc·lint·단위테스트는 전부 통과한다 — 타입이 같은 GateResult 라 서로 바꿔 끼워도
// 컴파일된다. 되돌리면 여기서 실패로 드러나게 소스 불변식을 고정한다.
//
// 배경 — 발효 태풍이 둘 이상일 때 사용자가 볼 태풍을 고를 수 있다(2026-08-11). 이때 지도·관측값·
// 참고 진로·푸터는 고른 태풍을 따르지만 **경보 배너는 worst 태풍을 따라야 한다.** 배너가 선택을
// 따라가면 다른 태풍을 보는 동안 경보가 화면에서 사라져, 보기 편의 기능이 곧 경보 누락이 된다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(join(ROOT, "app", "components", "TyphoonTrack.tsx"), "utf8");

// 지정한 여는 토큰부터 닫는 토큰까지 잘라낸다(가장 가까운 닫힘 기준).
function block(open: string, close: string): string {
  const start = source.indexOf(open);
  assert.ok(start >= 0, `소스에서 ${open} 를 찾지 못함 — 구조가 바뀌었는지 확인`);
  const end = source.indexOf(close, start);
  assert.ok(end > start, `${open} 의 닫힘(${close})을 찾지 못함`);
  return source.slice(start, end + close.length);
}

test("경보 배너(인라인 지도)는 worst 태풍 기준만 쓴다 — 보기 선택을 따르지 않는다", () => {
  const banner = block("<ZoneBanner", "/>");
  // 등급·조치는 경보 게이트에서만 온다.
  assert.match(banner, /zone=\{gate\.zone\}/, "배너 등급이 gate.zone 이 아니다");
  assert.match(banner, /gate\.forecast \? ZONE_FORECAST_ADVISORY/, "배너 조치가 gate 기준이 아니다");
  assert.match(banner, /\$\{alertZoneText\}/, "배너 제목이 alertZoneText 가 아니다");
  assert.match(banner, /lead=\{alertLeadText\}/, "배너 리드타임이 alertLeadText 가 아니다");
  // 보기 대상 값이 배너에 새어 들어오면 안 된다.
  assert.doesNotMatch(
    banner,
    /viewGate|viewZoneText|viewLeadText/,
    "배너가 보기 선택(view*)을 따른다 — 다른 태풍을 보는 동안 경보가 사라진다",
  );
});

test("확대 팝업 배너도 worst 태풍 기준만 쓴다(인라인과 같은 규칙)", () => {
  const modalBanner = block("banner={{", "}}");
  assert.match(modalBanner, /zone: gate\.zone/, "팝업 배너 등급이 gate.zone 이 아니다");
  assert.match(modalBanner, /\$\{alertZoneText\}/, "팝업 배너 제목이 alertZoneText 가 아니다");
  assert.match(modalBanner, /lead: alertLeadText/, "팝업 배너 리드타임이 alertLeadText 가 아니다");
  assert.doesNotMatch(
    modalBanner,
    /viewGate|viewZoneText|viewLeadText/,
    "팝업 배너가 보기 선택(view*)을 따른다",
  );
});

test("경보 대상(active·gate)은 선택 상태(viewSeq)에서 파생되지 않는다", () => {
  // active/gate 는 pickWorst 결과에서만 나와야 한다. viewSeq 가 끼면 경보가 선택을 따라간다.
  assert.match(
    source,
    /const active = worstIdx >= 0 \? \(liveList\[worstIdx\] \?\? null\) : null;/,
    "active 가 worstIdx 파생이 아니다",
  );
  assert.match(
    source,
    /const gate = worstIdx >= 0 \? \(gates\[worstIdx\] \?\? EMPTY_GATE\) : EMPTY_GATE;/,
    "gate 가 worstIdx 파생이 아니다",
  );
  const worstLine = source.indexOf("const worstIdx");
  const viewLine = source.indexOf("const viewIdx");
  assert.ok(worstLine >= 0 && viewLine > worstLine, "viewIdx 가 worstIdx 보다 앞에 있다 — 순서 확인");
});

test("지도·관측값·참고 진로는 보기 선택을 따른다(선택이 없으면 경보 대상)", () => {
  assert.match(
    source,
    /const disp = viewed \?\? active \?\? typhoons\[0\] \?\? data;/,
    "disp 가 보기 선택을 먼저 보지 않는다 — 칩을 눌러도 지도가 바뀌지 않는다",
  );
  // 관측값(중심기압·최대풍속·이동)은 지도에 뜬 태풍의 것이어야 한다.
  assert.match(source, /const cur = disp\.track\[/, "관측값이 disp 파생이 아니다");
  // JMA 참고 진로도 같은 태풍의 것 — 다른 태풍의 진로가 겹쳐 그려지면 안 된다.
  assert.match(source, /disp\.source === "live" && disp\.seq/, "JMA 참고 진로가 disp 파생이 아니다");
  assert.match(source, /track=\{disp\.track\}/, "지도가 disp.track 을 그리지 않는다");
});

test("★ 드롭다운 닫기 조건 — 화면 어디의 스크롤에나 닫히면 안 된다(마퀴 티커 회귀 방지)", () => {
  // scroll 은 버블링하지 않아 캡처로 받아야 하는데, 캡처는 문서 안 모든 스크롤을 잡는다.
  // 이 대시보드에는 매 프레임 scrollLeft 를 쓰는 마퀴 티커(useMarqueeScroll — 현장 환경 스트립·
  // KOSHA 목록)가 상시 돌아서, 무조건 닫으면 메뉴가 열린 지 16ms 만에 사라진다(2026-08-11 실제 증상).
  const start = source.indexOf("const onScroll");
  assert.ok(start >= 0, "onScroll 핸들러가 없다 — 스크롤 시 좌표가 어긋난 채로 남는다");
  const body = source.slice(start, source.indexOf("\n    };", start));
  assert.match(
    body,
    /contains\?\.\(btn\)|contains\(btn\)/,
    "스크롤 출처가 버튼을 품는지 보지 않는다 — 티커 한 프레임에 메뉴가 닫힌다",
  );
  // 조건 없이 닫는 형태가 남아 있으면 안 된다.
  assert.doesNotMatch(
    body,
    /^\s*setOpen\(false\);\s*$/m,
    "onScroll 이 조건 없이 닫는다 — 화면 어디의 스크롤에나 메뉴가 사라진다",
  );
});

test("선택 드롭다운이 가리키는 태풍은 실제로 지도에 뜬 태풍(disp)이다", () => {
  // viewSeq 를 그대로 넘기면 '자동(선택 없음)' 상태에서 value 가 "" 이 되어
  // 드롭다운이 빈 칸으로 보이고, 지도에는 worst 태풍이 떠 있어 둘이 어긋난다.
  assert.match(
    source,
    /selectedSeq=\{disp\.seq\}/,
    "드롭다운 선택값이 disp.seq 가 아니다 — 지도와 드롭다운이 어긋난다",
  );
  // 목록은 발효 태풍 전부여야 한다(worst 하나만 넘기면 고를 것이 없다).
  assert.match(source, /list=\{liveList\}/, "드롭다운 목록이 liveList 가 아니다");
});
