// 레이더 베이스맵 가드 — 워터마크를 굽는 호스트로 되돌아가면 실패한다.
//
// 배경(2026-08-27 실측). 관제웹 실시간 레이더 영상의 지도 배경에 "API KEY REQUIRED" 사선
// 워터마크가 박혀 나왔다. CARTO(basemaps.cartocdn.com)가 키 없는 요청에 워터마크를 **구워서**
// 보내기 시작한 것이다. 우리 코드는 2026-06 부터 키 없이 그 호스트를 써 왔다.
//   실측  GET a.basemaps.cartocdn.com/light_all/6/54/24@2x.png → HTTP 200 · 31,957B · 정상 PNG
//
// ★★ 왜 아무도 못 잡았나. **200 이기 때문이다.** 에러도 아니고 빈 응답도 아니다. 게다가
//    베이스맵은 브라우저가 CDN 에서 **직접** 받는다 — 서버를 안 거치므로 배포 스크립트의
//    라우트 검증(/api/radar 는 RainViewer 프레임 목록만 본다)·5xx 사후 관찰·에러 로그
//    어디에도 흔적이 없다. 오직 사람 눈에만 보인다. 그래서 **소스 가드**로 막는다.
//    (L-52 의 반대 방향 사례 — 그때는 "서버가 죽어도 화면은 멀쩡", 이번은 그 역이다.)
//
// ★ 이 가드의 한 문장 보장.
//   "레이더 두 화면(인라인 그리드·확대 팝업)의 지도 배경은 **키를 요구하는 호스트를 쓰지 않고**,
//    바탕과 짝을 이룬 지명 레이어를 **레이더 아래에** 함께 그린다."
//
// ⚠ 이 가드가 답하지 못하는 것 — CARTO 가 아닌 **다른** 제공자가 나중에 같은 정책을 켜는 경우.
//   호스트 목록은 알려진 것만 담는다(추측 금지). 새 사례가 나오면 여기 한 줄 추가하고 배경에 실측을 적는다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments as strip } from "./test-support/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/** 키 없이 쓰면 타일에 워터마크가 구워져 오는 호스트 — 실측으로 확인된 것만 적는다. */
const WATERMARKING_HOSTS = ["basemaps.cartocdn.com", "cartocdn.com"];

/** 지도 배경을 그리는 컴포넌트 전부. 새 지도를 추가하면 여기에도 넣는다. */
const MAP_COMPONENTS: [label: string, file: string][] = [
  ["RadarRealtime", "RadarRealtime.tsx"],
  ["TyphoonTrack", "TyphoonTrack.tsx"],
  ["WorkerGpsMap", "WorkerGpsMap.tsx"],
];

// 주석은 검사 대상이 아니다 — 위 배경 설명에 호스트 이름이 등장하므로,
// 주석을 지우지 않으면 **설명문이 스스로를 잡아** 거짓 빨간불이 난다(이 레포에서 3회 발생).
//
// ⚠️ 순진한 정규식 제거기를 직접 쓰지 않는다 — URL 의 `https://` 를 주석 시작으로 먹어
//   코드를 잘라낸다(이 가드를 처음 돌릴 때 실제로 당했다). 경위·양방향 위험도는 [[L-119]].

const radar = read("app", "components", "RadarRealtime.tsx");
const radarCode = strip(radar);

test("① ★ 지도 컴포넌트 어디에도 워터마크 호스트가 없다", () => {
  const hits: string[] = [];
  for (const [label, file] of MAP_COMPONENTS) {
    const code = strip(read("app", "components", file));
    for (const host of WATERMARKING_HOSTS) {
      if (code.includes(host)) hits.push(`${label} → ${host}`);
    }
  }
  assert.deepEqual(hits, [], `키를 요구하는 호스트가 되살아났다 — 타일에 워터마크가 구워진다`);
});

test("② 바탕·지명 두 레이어가 같은 Esri 호스트를 쓴다", () => {
  assert.match(
    radarCode,
    /const ESRI_CANVAS = "https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/Canvas"/,
    "Esri Canvas 호스트 상수가 없다",
  );
  for (const fn of ["baseTileUrl", "labelTileUrl"]) {
    const m = radarCode.match(new RegExp(`function ${fn}[^{]*\\{\\s*return \`([^\`]+)\``));
    const tpl = m?.[1];
    assert.ok(tpl, `${fn} 이 템플릿 리터럴로 URL 을 만들지 않는다`);
    assert.ok(tpl.startsWith("${ESRI_CANVAS}"), `${fn} 이 호스트 상수를 안 거친다 — 하드코딩 URL`);
    // Esri MapServer 는 z/y/x 순서다. z/x/y 로 "고치면" 엉뚱한 지역이 그려지는데,
    // 타일이 정상 200 으로 오기 때문에 화면만 보고는 원인을 못 찾는다.
    assert.ok(
      tpl.endsWith("/tile/${z}/${y}/${x}"),
      `${fn} 의 타일 좌표 순서가 z/y/x 가 아니다 — Esri 는 XYZ 와 순서가 반대다`,
    );
  }
});

test("③ ★ 지명 레이어가 두 화면 모두에 그려진다 — 한쪽만 고치면 실패", () => {
  // 정의부를 뺀 **호출부** 수만 센다. 인라인 그리드와 확대 팝업, 두 곳이어야 한다.
  const calls = (fn: string) =>
    (radarCode.match(new RegExp(`(?<!function )\\b${fn}\\(`, "g")) ?? []).length;
  const base = calls("baseTileUrl");
  const label = calls("labelTileUrl");
  assert.equal(base, 2, `바탕 호출부가 2곳이 아니다(실측 ${base}) — 화면이 늘거나 줄었다`);
  assert.equal(
    label,
    base,
    `지명 호출부 ${label}곳 ≠ 바탕 호출부 ${base}곳 — 한 화면에 지명이 빠졌다`,
  );
});

test("④ 쌓는 순서 = 바탕 → 지명 → 레이더 (화면마다 각각)", () => {
  // 종전 CARTO 는 지명이 바탕에 구워져 레이더 **아래**에 있었다. 순서를 뒤집으면
  // 지명이 강수 위로 올라와 화면 인상이 바뀐다 — 의도한 변경일 때만 이 가드를 고친다.
  const order = [...radarCode.matchAll(/\b(baseTileUrl|labelTileUrl|radarTileUrl)\(/g)]
    .map((m) => m[1])
    .filter((_, i, a) => i >= a.length - 6); // 정의부 3개를 지나 호출부 6개
  assert.deepEqual(
    order,
    ["baseTileUrl", "labelTileUrl", "radarTileUrl", "baseTileUrl", "labelTileUrl", "radarTileUrl"],
    "레이어 쌓는 순서가 바탕→지명→레이더 가 아니다",
  );
});

test("⑤ 라이트/다크가 짝을 이룬다 — 한쪽만 남기면 실패", () => {
  const picks = radarCode.match(/dark \? "(\w+)" : "(\w+)"/g) ?? [];
  assert.equal(picks.length, 2, `테마 분기가 2곳이 아니다(실측 ${picks.length})`);
  for (const p of picks) {
    assert.match(p, /dark \? "Dark" : "Light"/, `Esri 레이어 이름과 안 맞는 테마 분기 — ${p}`);
  }
});

test("⑦ ★ 지명은 z+1 이고 인덱스가 2배다 — 둘은 반드시 함께 간다", () => {
  // 2026-08-27 사용자 요청으로 지명 글자를 절반으로 줄였다. 방법은 z+1 타일 4장을
  // 절반 크기로 까는 것인데, **줌만 올리고 인덱스 2배를 빼먹으면 지명이 엉뚱한 지역**
  // 을 가리킨다. 그런데 타일은 정상 200 으로 온다 — ②의 z/y/x 함정과 같은 계열이고
  // 화면을 봐야만 안다. 그래서 줌과 인덱스를 한 단언에 묶는다.
  //
  // ⚠ 두 화면이 인덱스를 **다른 자리에서** 2배 한다. 호출부만 보면 인라인 쪽을 놓친다
  //   (가드를 처음 썼을 때 실제로 거짓 빨간불이 났다 — 코드가 아니라 가드가 좁았다).
  //     인라인  격자 생성부에서  labelCells.push({ x: x0 * 2 + c, … })
  //     팝업    호출부에서       labelTileUrl(base, t.z + OFFSET, t.x * 2 + dx, …)
  assert.match(radarCode, /LABEL_ZOOM_OFFSET = 1\b/, "지명 줌 오프셋 상수가 없다");

  // ⓐ 두 호출부 모두 줌을 올린다.
  const calls = [...radarCode.matchAll(/(?<!function )labelTileUrl\(([^)]*)\)/g)].map((m) => m[1]!);
  assert.equal(calls.length, 2, `지명 호출부가 2곳이 아니다(실측 ${calls.length})`);
  for (const args of calls) {
    const z = args.split(",")[1]?.trim() ?? "";
    assert.match(z, /\+ LABEL_ZOOM_OFFSET/, `지명 줌이 z+1 이 아니다 — ${args}`);
  }

  // ⓑ 인라인 — 격자 자체가 2배로 지어진다(원점·칸 수 둘 다).
  assert.match(radarCode, /labelCells\.push\(\{ c, r, x: x0 \* 2 \+ c, y: y0 \* 2 \+ r \}\)/,
    "인라인 지명 격자의 원점이 2배가 아니다 — 지명이 어긋난다");
  assert.match(radarCode, /const lCols = cols \* 2;/, "인라인 지명 격자 열 수가 2배가 아니다");
  assert.match(radarCode, /const lRows = rows \* 2;/, "인라인 지명 격자 행 수가 2배가 아니다");

  // ⓒ 팝업 — 호출부 인자가 2배다.
  const popup = calls.find((a) => a.includes("t.z"));
  assert.ok(popup, "팝업 지명 호출부를 못 찾았다");
  const [, , px, py] = popup.split(",").map((x) => x.trim());
  assert.match(px ?? "", /t\.x \* 2/, `팝업 지명 x 가 2배가 아니다 — ${popup}`);
  assert.match(py ?? "", /t\.y \* 2/, `팝업 지명 y 가 2배가 아니다 — ${popup}`);

  // ⓓ 바탕은 올리면 안 된다 — 올리면 바탕만 확대돼 레이더와 어긋난다.
  for (const m of radarCode.matchAll(/(?<!function )baseTileUrl\(([^)]*)\)/g)) {
    assert.doesNotMatch(m[1]!, /LABEL_ZOOM_OFFSET|\* 2/, `바탕 인자가 지명 규칙에 오염됐다 — ${m[1]}`);
  }
});
