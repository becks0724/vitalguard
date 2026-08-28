// 각인 주소 계약 가드 — VWorld 역지오코딩이 정본이고, 좌표 순서가 안 뒤집히며, 실패를 감추지 않는가
//
// ★ 왜 필요한가. 2026-08-28 촬영 각인이 `광주광역시 금남로3가 15-2` 를 찍었는데 실제는
//   `전남광주 동구 금남로3가 1-10` 이었다. **좌표는 맞았고 주소만 세 축이 동시에 틀렸다** —
//   광역명(통합 전 옛 이름) · 자치구(누락) · 지번(다른 필지). 셋 중 둘이 애플 지오코딩
//   데이터 문제라 필드를 더 읽어도 안 고쳐져서, 지오코더를 국토부 VWorld 로 옮겼다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **VWorld 요청이 경도·위도 순서와 `type=BOTH` 를 지키고, 응답에서 지번·도로명이 갈려 나오며,
//   주소 없음이 예외로 둔갑하지 않고, 앱이 그 값을 실제로 각인에 쓰고 못 받았을 때는
//   `(기기 추정)` 이라고 밝힌다.**
//   보장하지 않는 것 = VWorld 가 옳은 주소를 주는가(그건 아래 고정물이 실응답이라는 사실로 대신한다).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAddresses, type VworldAddress } from "../app/lib/address-format";
import { parseOcrStamp } from "./ocr-stamp";
import { stripComments } from "./test-support/strip-comments";

const here = fileURLToPath(new URL(".", import.meta.url));
const vworld = readFileSync(join(here, "..", "app", "lib", "vworld.ts"), "utf8");
const route = readFileSync(join(here, "..", "app", "api", "app", "address", "route.ts"), "utf8");
const media = readFileSync(
  join(here, "..", "..", "vitalguard_app", "ios", "Runner", "MediaCapture.swift"),
  "utf8",
);
const mediaCode = stripComments(media);

// ★ 아래 셋은 **손으로 만든 것이 아니라 2026-08-28 실응답**이다(`api.vworld.kr` 직접 호출).
//   문서상 형태로 쓴 고정물은 파서를 지키는 척만 한다.

/** 촬영 지점 `35.150535, 126.916294`. 사용자가 확인해 준 실주소와 글자 단위로 같다. */
const SHOT: VworldAddress[] = [
  { type: "parcel", text: "전남광주통합특별시 동구 금남로3가 1-10" },
];

/** 계림동 `35.162002, 126.927398`. 08-22 교훈이 "실제 계림동 1869" 로 적어 둔 바로 그 자리다. */
const GYERIM: VworldAddress[] = [{ type: "parcel", text: "전남광주통합특별시 동구 계림동 1869" }];

test("★★ 실응답이 사용자 확인 실주소와 같다 — 애플이 틀린 세 축이 모두 살아 있다", () => {
  const { jibun, display } = buildAddresses(SHOT);
  assert.equal(jibun, "전남광주통합특별시 동구 금남로3가 1-10");
  assert.equal(display, jibun, "각인에 실리는 값이 지번이 아니다");
  // 애플이 틀린 축을 결과 문자열에서 하나씩 확인한다.
  assert.ok(jibun!.startsWith("전남광주"), "광역명이 통합 전 옛 이름으로 돌아갔다");
  assert.ok(jibun!.includes("동구"), "자치구가 없다 — 애플 경로의 결함이 재발했다");
  assert.ok(jibun!.endsWith("1-10"), "지번이 다른 필지를 가리킨다");
});

test("★ 08-22 교훈의 실제 주소도 맞힌다 — 표본이 하나가 아니다", () => {
  // 그때 각인은 `계림동 463-8`(애플)이었고 교훈이 실제를 `계림동 1869` 로 적어 뒀다.
  assert.equal(buildAddresses(GYERIM).display, "전남광주통합특별시 동구 계림동 1869");
});

test("★ display 는 지번 우선 — 도로명은 우리 현장에 실제로 없다", () => {
  // 실측 — 촬영지점·하남산단·계림동 3곳 전부 `type=ROAD` 가 NOT_FOUND 였다.
  // 없는 값을 1순위로 두면 각인이 사진마다 들쭉날쭉해진다.
  const both = buildAddresses([
    { type: "road", text: "전남광주통합특별시 동구 중앙로 194" },
    ...SHOT,
  ]);
  assert.equal(both.road, "전남광주통합특별시 동구 중앙로 194", "도로명이 오면 담아는 둔다");
  assert.equal(both.display, both.jibun, "도로명이 있어도 각인은 지번이어야 한다");

  const roadOnly = buildAddresses([{ type: "road", text: "전남광주통합특별시 동구 중앙로 194" }]);
  assert.equal(roadOnly.display, roadOnly.road, "지번이 없으면 도로명으로 떨어져야 한다");
});

test("★ 값이 없으면 문자열을 만들지 않는다 — 반쪽 주소가 확정처럼 읽힌다", () => {
  assert.deepEqual(buildAddresses(undefined), { road: null, jibun: null, display: null });
  assert.deepEqual(buildAddresses([]), { road: null, jibun: null, display: null });
  assert.deepEqual(buildAddresses([{ type: "parcel", text: "   " }]), {
    road: null,
    jibun: null,
    display: null,
  });
});

test("★★ VWorld 요청이 경도,위도 순서와 type=BOTH 를 지킨다 — 뒤집혀도 정상 200 이라 안 잡힌다", () => {
  const code = stripComments(vworld);
  const fn = code.slice(code.indexOf("export async function reverseGeocode"));
  assert.ok(fn.length > 200, "reverseGeocode 를 못 찾았다 — 가드를 다시 맞춰야 한다");
  assert.match(fn, /request=getAddress/, "역지오코딩 호출이 사라졌다");
  assert.match(fn, /point=\$\{lon\},\$\{lat\}/, "point 가 경도,위도 순서가 아니다 — 엉뚱한 지역이 온다");
  assert.match(fn, /type=BOTH/, "type=BOTH 가 아니다 — 도로명이 영영 안 온다");
  assert.match(fn, /crs=epsg:4326/, "좌표계가 WGS84 가 아니다 — 좌표가 통째로 어긋난다");
});

test("★ 주소 없음(NOT_FOUND)을 예외로 둔갑시키지 않는다", () => {
  const code = stripComments(vworld);
  const fn = code.slice(code.indexOf("export async function reverseGeocode"));
  assert.match(fn, /"NOT_FOUND"/, "바다·미등록 구역을 빈 결과로 안 가른다 — 502 가 나간다");
  // 그 분기가 던지지 않고 값을 돌려주는지.
  const branch = fn.slice(fn.indexOf('"NOT_FOUND"'));
  assert.match(branch.slice(0, 300), /configured: true/, "NOT_FOUND 분기가 결과를 안 돌려준다");
});

test("★ 키는 서버에만 둔다", () => {
  assert.match(vworld, /import "server-only"/, "server-only 가 빠지면 키가 클라 번들로 샐 수 있다");
});

test("★ 라우트가 앱 JWT 로 잠겨 있고 실패를 200 으로 감추지 않는다", () => {
  const code = stripComments(route);
  assert.match(code, /verifyAppJwt\(bearerToken\(request\)\)/, "앱 JWT 검증이 없다 — 지오코딩 쿼터가 열린다");
  assert.match(code, /status: 401/, "미인증에 401 을 안 낸다");
  assert.match(code, /status: 502/, "역지오코딩 실패에 502 를 안 낸다 — 200 으로 감추면 앱이 폴백 판단을 못 한다");
  const okTrue = code.split("\n").filter((l) => l.includes("ok: true"));
  assert.equal(okTrue.length, 1, `\`ok: true\` 가 ${okTrue.length}곳이다 — 실패가 성공으로 새어나갈 수 있다`);
});

// ── 앱 배선 ─────────────────────────────────────────────────────────────────
// 서버 라우트가 있어도 앱이 안 부르면 각인은 그대로 애플 값이다. 양 끝을 함께 단언한다([[L-115]]③).

test("★★ 각인 주소는 서버가 정본 — 기기 지오코딩은 폴백이고 반드시 그렇다고 적는다", () => {
  const fn = mediaCode.slice(mediaCode.indexOf("private func resolveAddress"));
  const body = fn.slice(0, fn.indexOf("private static func serverAddress"));
  assert.ok(body.length > 100, "resolveAddress 본문을 못 잘랐다 — 가드를 다시 맞춰야 한다");
  assert.match(body, /Self\.serverAddress\(lat: lat, lon: lon\)/, "서버 역지오코딩을 먼저 안 부른다");

  // ★ 이 건의 핵심. 폴백 값이 라벨 없이 나가면 **틀린 주소가 확정으로 읽힌다.**
  const fallback = body.slice(body.indexOf("deviceAddress"));
  assert.ok(fallback.length > 20, "폴백 분기를 못 잘랐다");
  assert.match(fallback, /\(기기 추정\)/, "기기 추정 폴백에 라벨이 안 붙는다 — 틀린 주소가 확정으로 읽힌다");
});

test("★ 서버 호출이 앱 JWT 를 싣고 /api/app/address 로 가며 서버가 정한 표기를 쓴다", () => {
  const fn = mediaCode.slice(mediaCode.indexOf("private static func serverAddress"));
  const body = fn.slice(0, fn.indexOf("private func deviceAddress"));
  assert.ok(body.length > 100, "serverAddress 본문을 못 잘랐다");
  assert.match(body, /appendingPathComponent\("api\/app\/address"\)/, "라우트 경로가 다르다");
  assert.match(body, /"Bearer \\\(token\)"/, "앱 JWT 를 안 싣는다 — 서버가 401 을 낸다");
  assert.match(
    body,
    /json\["display"\]/,
    "서버가 정한 표기(display)를 안 쓴다 — 앱이 규칙을 다시 고르면 서버 경유의 의미가 사라진다",
  );
});

test("★★ 바뀐 각인 형식을 서버 파서가 여전히 읽는다 — 양 끝을 함께 단언한다", () => {
  const addr = buildAddresses(SHOT).display!;
  const stamped = [
    "[2026-08-28 09:45:11]",
    addr,
    "35.150535, 126.916294 (±10m)",
    "작업자/ID: 장우진, EMP-6861",
  ].join("\n");
  const parsed = parseOcrStamp(stamped);
  assert.equal(parsed.roadAddress, addr, "새 주소 줄을 서버 파서가 못 읽는다");
  assert.equal(parsed.gps, "35.150535, 126.916294", "좌표 추출이 깨졌다");
  assert.equal(parsed.workerId, "EMP-6861");
  assert.equal(parsed.capturedAt, "2026-08-28 09:45");

  // 폴백 표기가 붙어도 읽혀야 한다 — 안 읽히면 라벨을 붙인 대가로 주소를 잃는다.
  const fallback = ["[2026-08-28 09:45:11]", "광주광역시 금남로3가 15-2 (기기 추정)"].join("\n");
  assert.equal(parseOcrStamp(fallback).roadAddress, "광주광역시 금남로3가 15-2 (기기 추정)");
});
