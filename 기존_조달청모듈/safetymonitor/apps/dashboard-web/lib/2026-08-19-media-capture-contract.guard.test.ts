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
const plist = readFileSync(join(APP, "ios", "Runner", "Info.plist"), "utf8");
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

test("★ 사진첩 저장은 추가 전용 권한으로, 업로드본과 같은 바이트를 넣는다", () => {
  // 권한 문구가 없으면 저장하는 순간 앱이 죽는다(카메라와 같은 규칙).
  const m = plist.match(/<key>NSPhotoLibraryAddUsageDescription<\/key>\s*<string>([\s\S]*?)<\/string>/);
  assert.ok(m, "NSPhotoLibraryAddUsageDescription 이 없다 — 사진첩 저장 시 앱이 종료된다");
  assert.ok((m[1] ?? "").trim().length >= 20, "문구가 라벨 수준이다 — 서술형이어야 한다");

  // 앨범 생성·기존 사진 조회는 **전체 접근**을 요구한다. 이 기능엔 필요 없는 권한이다.
  assert.match(code, /for:\s*\.addOnly/, "추가 전용이 아니다 — 필요 없는 전체 사진 접근을 요구하게 된다");
  assert.doesNotMatch(
    code,
    /NSPhotoLibraryUsageDescription|for:\s*\.readWrite/,
    "전체 사진 접근을 요구한다 — 최소 권한 원칙에 어긋나고 사용자가 거부할 이유가 생긴다",
  );

  // UIImage 로 다시 그리면 재인코딩돼 각인 글자가 뭉개진다. 업로드한 바이트를 그대로 넣는다.
  assert.match(
    code,
    /addResource\(with:\s*\.photo,\s*data:/,
    "이미지를 다시 인코딩해 저장한다 — 각인 글자가 뭉개지고 업로드본과 달라진다",
  );
  assert.doesNotMatch(
    code,
    /UIImageWriteToSavedPhotosAlbum/,
    "구식 API 는 바이트를 보존하지 않고 오류도 못 가른다",
  );
});

test("★ 역지오코딩 결과에서 중복 지명을 걷어낸다", () => {
  // 실측(2026-08-19 실기기) — 광역시는 administrativeArea·locality 가 둘 다 `광주광역시` 이고
  // 동 이름이 도로명과 같으면 subLocality·thoroughfare 도 겹친다. 단순 join 은
  // `광주광역시 광주광역시 금남로3가 금남로3가 15-2` 를 만든다. 사진에 각인되므로 되돌리기 어렵다.
  const fn = code.slice(code.indexOf("private func resolveAddress("));
  const body = fn.slice(0, fn.indexOf("\n    private func"));
  assert.ok(body.length > 100, "함수 본문을 못 잘랐다 — 가드를 다시 맞춰야 한다");
  assert.match(body, /seen\.contains\(part\)/, "중복 제거가 없다 — 같은 지명이 두 번 찍힌다");
  assert.doesNotMatch(
    body,
    /parts\.compactMap \{ \$0 \}\.joined/,
    "단순 join 으로 되돌아갔다 — 광역시에서 시·도가 두 번 들어간다",
  );
});
