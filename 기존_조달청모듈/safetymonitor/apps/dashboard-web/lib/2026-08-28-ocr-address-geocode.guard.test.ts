// 각인 주소 계약 가드 — 서버 역지오코딩이 광역·자치구를 싣고, 좌표 순서가 안 뒤집히며, 실패를 감추지 않는가
//
// ★ 왜 필요한가. 2026-08-28 촬영 각인이 `광주광역시 금남로3가 15-2` 를 찍었는데 실제는
//   `전남광주 동구 금남로3가 1-10` 이었다. **좌표는 맞았고 주소만 세 축이 동시에 틀렸다** —
//   광역명(통합 전 옛 이름) · 자치구(누락) · 지번(다른 필지). 셋 중 둘이 애플 지오코딩
//   데이터 문제라 필드를 더해도 안 고쳐져서, 지오코더를 서버 NCP 로 옮겼다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **조립된 주소가 광역·자치구를 반드시 담고, 도로명과 지번이 각각 따로 나오며,
//   NCP 좌표 인자가 경도·위도 순서이고, 조회 실패가 200 으로 위장되지 않는다.**
//   보장하지 않는 것 = NCP 가 옳은 주소를 주는가(그것은 실응답 1건으로 사람이 확인한다).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAddresses, type NcpResult } from "../app/lib/address-format";
import { stripComments } from "./test-support/strip-comments";

const here = fileURLToPath(new URL(".", import.meta.url));
const geo = readFileSync(join(here, "..", "app", "lib", "reverse-geocode.ts"), "utf8");
const fmt = readFileSync(join(here, "..", "app", "lib", "address-format.ts"), "utf8");
const route = readFileSync(
  join(here, "..", "app", "api", "app", "address", "route.ts"),
  "utf8",
);

/** 2026-08-28 촬영 지점. 실제 주소는 사용자가 확인해 준 `전남광주 동구 금남로3가 1-10`. */
const FIXTURE: NcpResult[] = [
  {
    name: "roadaddr",
    region: {
      area1: { name: "전남광주통합특별시" },
      area2: { name: "동구" },
      area3: { name: "금남로3가" },
      area4: { name: "" },
    },
    land: {
      type: "",
      number1: "194",
      number2: "",
      name: "중앙로",
      addition0: { type: "building", value: "금성직업전문학교" },
    },
  },
  {
    name: "addr",
    region: {
      area1: { name: "전남광주통합특별시" },
      area2: { name: "동구" },
      area3: { name: "금남로3가" },
      area4: { name: "" },
    },
    land: { type: "1", number1: "1", number2: "10" },
  },
];

test("★ 조립 결과가 실제 주소와 같은 모양이다 — 자치구·지번이 살아 있다", () => {
  const { road, jibun } = buildAddresses(FIXTURE);
  assert.equal(jibun, "전남광주통합특별시 동구 금남로3가 1-10");
  assert.equal(road, "전남광주통합특별시 동구 중앙로 194 (금성직업전문학교)");
  // 애플 경로가 빠뜨린 바로 그 축. 이름이 아니라 **결과 문자열**에서 확인한다.
  assert.ok(jibun!.includes("동구"), "지번주소에 자치구가 없다 — 애플 경로의 결함이 재발했다");
  assert.ok(road!.includes("동구"), "도로명주소에 자치구가 없다");
});

test("★ 도로명과 지번을 각각 낸다 — 한 칸에 뭉개면 무엇을 보는지 알 수 없다", () => {
  const { road, jibun } = buildAddresses(FIXTURE);
  assert.notEqual(road, jibun, "도로명과 지번이 같은 문자열이다 — 둘을 안 가르고 있다");
  assert.ok(road!.includes("중앙로 194"), "도로명주소가 도로명+건물번호가 아니다");
  assert.ok(!jibun!.includes("중앙로"), "지번주소에 도로명이 섞였다");
});

test("★ 번지 표기 — 부번 없음과 산 지번을 구분한다", () => {
  const one = buildAddresses([
    {
      name: "addr",
      region: { area1: { name: "전남광주통합특별시" }, area2: { name: "동구" }, area3: { name: "금남로3가" } },
      land: { type: "1", number1: "15", number2: "" },
    },
  ]);
  assert.equal(one.jibun, "전남광주통합특별시 동구 금남로3가 15", "부번이 없는데 대시가 붙었다");

  const mountain = buildAddresses([
    {
      name: "addr",
      region: { area1: { name: "전남광주통합특별시" }, area2: { name: "동구" }, area3: { name: "지원동" } },
      land: { type: "2", number1: "12", number2: "3" },
    },
  ]);
  assert.equal(mountain.jibun, "전남광주통합특별시 동구 지원동 산 12-3", "산 지번 표기가 빠졌다");
});

test("★ 값이 모자라면 문자열을 만들지 않는다 — 반쪽 주소가 확정처럼 읽힌다", () => {
  // 도로명 없이 번호만 있으면 도로명주소가 아니다.
  const noStreet = buildAddresses([
    { name: "roadaddr", region: { area1: { name: "전남광주통합특별시" }, area2: { name: "동구" } }, land: { number1: "194" } },
  ]);
  assert.equal(noStreet.road, null, "도로명이 없는데 도로명주소를 만들었다");
  assert.deepEqual(buildAddresses(undefined), { road: null, jibun: null });
  assert.deepEqual(buildAddresses([]), { road: null, jibun: null });
});

test("★★ NCP 좌표 인자가 경도,위도 순서다 — 뒤집혀도 정상 200 이라 다른 방법으로는 안 잡힌다", () => {
  const code = stripComments(geo);
  // 앵커 — 호출 자체가 사라지면 아래 순서 검사가 빈 문자열에서도 통과한다.
  assert.match(code, /map-reversegeocode/, "NCP 역지오코딩 호출이 사라졌다");
  assert.match(
    code,
    /coords=\$\{lon\},\$\{lat\}/,
    "coords 가 경도,위도 순서가 아니다 — 뒤집으면 엉뚱한 지역이 200 으로 온다",
  );
  assert.match(code, /orders=roadaddr,addr/, "도로명·지번 둘 다 요청하지 않는다");
});

test("★ 조립부가 광역·자치구를 항상 앞에 붙인다", () => {
  const code = stripComments(fmt);
  assert.match(
    code,
    /area1\?\.name\), t\(g\?\.area2\?\.name\)/,
    "광역(area1)과 자치구(area2)를 함께 꺼내지 않는다 — 자치구 누락이 이 건의 결함이었다",
  );
});

test("★ 라우트가 앱 JWT 로 잠겨 있고 실패를 200 으로 감추지 않는다", () => {
  const code = stripComments(route);
  assert.match(code, /verifyAppJwt\(bearerToken\(request\)\)/, "앱 JWT 검증이 없다 — 지오코딩 쿼터가 열린다");
  assert.match(code, /status: 401/, "미인증에 401 을 안 낸다");
  assert.match(code, /status: 502/, "역지오코딩 실패에 502 를 안 낸다 — 200 으로 감추면 앱이 폴백 판단을 못 한다");
  // 실패 경로가 빈 주소를 성공으로 포장하지 않는지 — `ok: true` 는 성공 분기 한 곳뿐이어야 한다.
  const okTrue = code.split("\n").filter((l) => l.includes("ok: true"));
  assert.equal(okTrue.length, 1, `\`ok: true\` 가 ${okTrue.length}곳이다 — 실패가 성공으로 새어나갈 수 있다`);
});
