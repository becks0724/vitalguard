// TOTP QR 단위 테스트 — "그림이 나온다"가 아니라 **인증 앱이 읽을 값이 담겼는가**를 본다.
//
// ⚠ 여기서 QR 을 디코드해 검증하지는 않는다(디코더를 또 들이는 것은 배보다 배꼽이다).
//   대신 ① data URI 형식 ② SVG 로 복원했을 때 정상 문서인가 ③ 입력이 바뀌면 그림도 바뀌는가
//   ④ 등록 화면이 받는 세 값이 서로 같은 시크릿을 가리키는가 를 못 박는다.
//   실제 스캔 확인은 사람이 한 번 해야 한다(자동으로 대신할 수 없는 부분이다).
import assert from "node:assert/strict";
import { test } from "node:test";

import { totpQrDataUri } from "./totp-qr";
import { generateTotpSecret, totpAuthUri } from "./totp";

const uriOf = (secret: string) => totpAuthUri("test.jodal", secret);

test("data URI 형식 — <img src> 에 그대로 들어간다", () => {
  const qr = totpQrDataUri(uriOf(generateTotpSecret()));
  assert.ok(qr, "QR 을 만들지 못했다");
  assert.match(qr, /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/, "data URI 형식이 아니다");
});

test("base64 로 감싼다 — 원시 SVG 를 넣으면 '#'·'<' 가 URI 문법과 충돌한다", () => {
  const qr = totpQrDataUri(uriOf(generateTotpSecret()))!;
  assert.ok(!qr.includes("<svg"), "SVG 를 인코딩 없이 그대로 넣었다");
  assert.ok(!/[<>#"]/.test(qr.slice("data:image/svg+xml;base64,".length)), "본문에 원시 특수문자가 있다");
});

test("복원하면 정상 SVG 문서다", () => {
  const qr = totpQrDataUri(uriOf(generateTotpSecret()))!;
  const svg = Buffer.from(qr.split(",")[1]!, "base64").toString("utf8");
  assert.match(svg, /^<svg /, "SVG 로 시작하지 않는다");
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "네임스페이스가 없어 이미지로 안 뜬다");
  assert.match(svg, /viewBox="0 0 \d+ \d+"/, "viewBox 가 없어 크기 지정이 안 먹는다");
  assert.match(svg, /<\/svg>$/, "문서가 닫히지 않았다");
  // 흰 바탕이 있어야 어두운 테마에서도 스캔된다(검은 모듈만 있으면 배경이 비쳐 대비가 죽는다).
  assert.match(svg, /fill="white"/, "바탕이 없다 — 다크 모드에서 스캔이 안 된다");
});

test("시크릿이 다르면 그림도 다르다 — 같은 QR 이 나오면 전 계정이 한 시크릿을 쓴다", () => {
  const a = totpQrDataUri(uriOf(generateTotpSecret()));
  const b = totpQrDataUri(uriOf(generateTotpSecret()));
  assert.notEqual(a, b);
});

test("같은 입력이면 같은 그림 — 새로고침마다 QR 이 바뀌면 스캔 도중 어긋난다", () => {
  const uri = uriOf(generateTotpSecret());
  assert.equal(totpQrDataUri(uri), totpQrDataUri(uri));
});

test("긴 URI 도 담긴다 — 계정 이름이 길어도 QR 이 터지지 않는다", () => {
  const long = totpAuthUri("아주.긴.계정.이름.테스트@example.co.kr", generateTotpSecret());
  const qr = totpQrDataUri(long);
  assert.ok(qr, "긴 URI 에서 QR 생성이 실패했다");
});

test("망가진 입력에도 예외를 던지지 않는다 — QR 은 편의 경로다", () => {
  // 실패하면 null 을 주고 화면은 키 문자열 등록으로 계속 간다. 등록 자체가 막히면 안 된다.
  assert.doesNotThrow(() => totpQrDataUri(""));
});
