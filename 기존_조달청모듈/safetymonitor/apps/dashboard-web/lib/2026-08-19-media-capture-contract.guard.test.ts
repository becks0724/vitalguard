// 촬영 업로드 계약 가드 — 어겨도 화면은 성공처럼 보이는 것들만 모았다
//
// 여기 있는 다섯 가지는 전부 **조용히 어긋난다**. 업로드는 200 이고 DB 행도 생기는데
// 화면에서만 틀리거나(시각 9시간·이미지 깨짐) 나중에 못 고치는 형태로 굳는다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
const APP = join(here, "..", "..", "vitalguard_app");
const src = readFileSync(join(APP, "ios", "Runner", "MediaCapture.swift"), "utf8");
// ⚠ 금지어 검사는 **주석을 걷어낸 본문**에서 한다 — 안 그러면 "생체 경로에 얹지 않는다" 를
//   설명한 주석의 `ingest(payload:` 를 가드가 스스로 잡는다(이 레포에서 이미 한 번 났다).
const code = src.replace(/^\s*\/\/.*$/gm, "");

test("★ 촬영 시각은 KST 로컬 ISO 로 보낸다 — UTC 로 보내면 화면이 9시간 어긋난다", () => {
  // 구 앱이 실제로 UTC(`...Z`)를 보내 10:56 촬영이 화면에 "오전 1:56" 으로 떴다
  // (docs/app-media-upload-contract.md ③).
  const fn = src.slice(src.indexOf("static func kstIso("));
  const body = fn.slice(0, fn.indexOf("\n    }"));
  assert.match(body, /Asia\/Seoul/, "타임존 고정이 없다 — 기기 설정에 따라 값이 바뀐다");
  assert.match(body, /XXXXX/, "오프셋(+09:00)을 안 붙인다 — 서버가 UTC 로 읽는다");
  assert.doesNotMatch(body, /ISO8601DateFormatter/, "기본 ISO8601 은 Z(UTC)로 찍는다");
});

test("★ 업로드는 JPEG 로 고정한다 — HEIC 는 크롬·파이어폭스가 못 그린다", () => {
  // 서버는 heic 를 받아준다(route.ts EXT_BY_TYPE). 그래서 올라가고 저장되고 **화면만 깨진다**.
  assert.match(src, /jpegData\(compressionQuality:/, "JPEG 인코딩이 사라졌다");
  assert.match(src, /image\/jpeg/, "파트 Content-Type 이 image/jpeg 가 아니다");
  assert.doesNotMatch(src, /image\/heic/, "HEIC 를 그대로 올리면 관제웹에서 이미지가 깨진다");
});

test("★ OCR 은 원본으로, 축소는 업로드본에만 적용한다", () => {
  const fn = src.slice(src.indexOf("private func stampAndUpload("));
  const body = fn.slice(0, fn.indexOf("\n    }"));
  const ocr = body.indexOf("recognizeText(in: image)");
  const down = body.indexOf("downscaled(image)");
  assert.ok(ocr >= 0 && down >= 0, "두 호출 중 하나가 사라졌다 — 가드를 다시 맞춰야 한다");
  assert.ok(
    ocr < down,
    "축소본으로 OCR 을 돌린다 — 작은 글자가 먼저 사라지는데 결과는 그럴듯해 보인다",
  );
});

test("★ 하단 각인이 서버 파서가 읽는 형식이다", () => {
  // 앱이 구조화 필드를 함께 보내지만, 빠진 값은 서버가 이 스탬프를 파싱해 채운다(lib/ocr-stamp.ts).
  assert.match(src, /yyyy-MM-dd HH:mm:ss/, "촬영 시각 형식이 바뀌면 파서가 못 읽는다");
  assert.match(src, /작업자\/ID: /, "작업자 줄 라벨이 바뀌면 파서가 사번을 못 뽑는다");
  assert.match(src, /위치 미확보/, "좌표가 없을 때 빈 줄로 두면 '위치를 안 찍는 사진' 과 구별되지 않는다");
});

test("★ 생체 파이프라인을 건드리지 않고, 공유 업로드 토큰을 앱에 굽지 않는다", () => {
  assert.doesNotMatch(
    code,
    /VitalPipeline\.shared\.ingest|func ingest\(payload:/,
    "생체 배치 경로에 얹었다 — batch-ts 가드의 고정 창(3200자)이 또 밀리고 재시도 계약도 섞인다",
  );
  assert.match(src, /Bearer \\\(token\)/, "로그인 JWT 로 인증해야 서버가 신원 위조를 막아준다");
  assert.doesNotMatch(
    code,
    /APP_UPLOAD_TOKEN|x-app-upload-token/,
    "공유 토큰을 앱에 구우면 앱을 뜯는 누구나 남의 이름으로 올릴 수 있다",
  );
});
