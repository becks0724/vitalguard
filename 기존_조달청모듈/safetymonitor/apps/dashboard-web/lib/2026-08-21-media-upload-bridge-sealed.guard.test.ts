// 캘린더 미디어 업로드 다리 봉인 가드 — 철거된 휴면 라우트가 되살아나지 않아야 한다
//
// 발단(docs/seam-contracts/findings.md H · 2026-08-21 철거). 프리사인 업로드 다리
// (POST upload-url 발급 + POST /api/calendar/media 등록)는 **레포 안 호출자 0 · 프로덕션
// 30일 성공 호출 0**(등록 2건은 우리 검증 curl 401)이었다. 게다가 등록이 임의 storageKey 를
// 무검증 수용했다 — 없는 실물 등록(깨진 이미지 행) · 남의 key 재등록(그 행 삭제가 남의 참조
// 파괴) · 프리픽스 밖 임의 경로 등록(버킷 임의 객체를 관제 화면에). 쓰는 사람이 없으니
// 프로토콜 강화가 아니라 철거가 계약이다.
//
// 모든 "없다" 단언에는 같은 부류의 "있다" 통제군을 짝지었다 — 없음과 조회가 눈먼 것은
// 같은 결과로 보이기 때문이다(L-79·L-88).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MEDIA_DIR = join(ROOT, "app", "api", "calendar", "media");
const media = readFileSync(join(MEDIA_DIR, "route.ts"), "utf8");
const storage = readFileSync(join(ROOT, "lib", "storage.ts"), "utf8");
const appMedia = readFileSync(join(ROOT, "app", "api", "app-media", "route.ts"), "utf8");
const bare = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("★ upload-url 라우트가 없다 — 통제군: 형제 download-url 은 있다", () => {
  assert.equal(
    existsSync(join(MEDIA_DIR, "upload-url", "route.ts")),
    false,
    "철거된 프리사인 업로드 라우트가 되살아났다 — findings H 의 무검증 수용 문제를 함께 풀었는지 확인할 것",
  );
  // 형제 라우트 존재 = 이 경로 탐색이 눈멀지 않았다는 증거.
  assert.equal(existsSync(join(MEDIA_DIR, "download-url", "route.ts")), true, "경로 탐색이 눈멀었다");
});

test("★ 등록 POST 가 없다 — 통제군: GET·PATCH·DELETE 는 있다", () => {
  const b = bare(media);
  assert.doesNotMatch(b, /export async function POST/, "등록 POST 가 되살아났다 — storageKey 무검증 수용 통로였다");
  for (const m of ["GET", "PATCH", "DELETE"]) {
    assert.match(b, new RegExp(`export async function ${m}`), `살아 있어야 할 ${m} 소실 — 파일이 통째로 바뀌었다`);
  }
});

test("프리사인 PUT 발급이 어댑터에서 사라졌다 — 통제군: GET 발급·서버 직접 PUT 은 있다", () => {
  const b = bare(storage);
  assert.doesNotMatch(b, /presignUpload/, "presignUpload 부활 — 업로드 다리 없이 쓸 곳이 없다");
  assert.match(b, /export async function presignDownload/, "표시용 GET 발급 소실");
  assert.match(b, /export async function putObject/, "서버 직접 업로드 소실 — 앱 업로드(G)가 죽는다");
});

test("★ 살아 있는 유일한 등록 경로 — app-media 가 putObject + insert 를 함께 한다", () => {
  const b = bare(appMedia);
  assert.match(b, /putObject\(/, "app-media 실물 업로드 소실");
  assert.match(b, /insertCalendarMedia\(/, "app-media DB 등록 소실 — 업로드만 되고 화면에 안 뜬다");
});
