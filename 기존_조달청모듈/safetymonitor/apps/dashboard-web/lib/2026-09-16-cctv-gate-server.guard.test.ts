// 구조적 재발 방지 — CAM-03 서버 중계의 배선 불변식 가드 (docs/cctv-gate-server).
//
// 왜 가드인가 — 이 라우트들은 DB 가 있어야 돌아 단위 테스트가 닿지 않는다. 그런데 「인제스트가 soft 모드로 풀린다」
// 「stream3 이 표를 검증하지 않는다」「폴링이 다시 장시간 연결로 돌아간다」는 전부 tsc·lint 초록인 채로 일어난다.
// 소스가 그 문을 지나가는지를 고정한다. 음성 대조는 각 단언의 반대 문자열이 없는 것으로 한다.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("ingest3 — 젯슨 전용 토큰만 받고, 가스포드의 soft 인제스트(ingestAuthStatus)를 쓰지 않는다", () => {
  const src = read("app/api/cctv-gate/cctv/ingest3/route.ts");
  assert.match(src, /ingestTokenMatches\(/, "상수 시간 토큰 비교를 거친다");
  assert.match(src, /CCTV_INGEST_TOKEN/, "젯슨 전용 env 를 읽는다");
  assert.doesNotMatch(src, /ingestAuthStatus/, "soft 모드(무토큰 수용)로 풀리면 아무나 프레임을 덮어쓴다");
  assert.match(src, /503/, "토큰 env 가 없으면 받지 않는다(조용한 200 금지)");
  assert.match(src, /MAX_JPEG_BYTES/, "본문 상한을 본다");
  assert.match(src, /upsertCctvFrame\(/, "DB 한 행에 덮어쓴다 — 메모리 보관 없음");
});

test("stream3·stats3·connection3 — 셋 다 같은 문(authorizeGate)을 지난다", () => {
  for (const r of ["stream3", "stats3", "connection3"]) {
    const src = read(`app/api/cctv-gate/cctv/${r}/route.ts`);
    assert.match(src, /authorizeGate\(request/, `${r} 가 표 검증·소비 문을 지난다`);
    assert.doesNotMatch(src, /verifyTicket\(/, `${r} 가 검증을 직접 하지 않는다 — 문은 하나여야 한다`);
  }
  const auth = read("lib/cctv-gate-auth.ts");
  assert.match(auth, /verifyTicket\(ticket, want\)/);
  assert.match(auth, /consumeCctvTicketJti\(/, "jti 를 DB 에서 1회 소비한다");
  assert.match(auth, /cctvCameraSite\(/, "현장은 표가 아니라 대장에서 되찾아 대조한다");
  // 소비가 검증보다 먼저 오면 틀린 표가 정당한 표의 jti 를 태운다
  assert.ok(auth.indexOf("verifyTicket(") < auth.indexOf("consumeCctvTicketJti("), "검증 뒤에 소비한다");
});

test("stream3 — 단발 image/jpeg 이고 stale 이면 503 (옛 그림을 살아 있는 척 주지 않는다)", () => {
  const src = read("app/api/cctv-gate/cctv/stream3/route.ts");
  assert.match(src, /"Content-Type": "image\/jpeg"/);
  assert.match(src, /X-Captured-At/);
  assert.match(src, /isStale\(/);
  assert.doesNotMatch(src, /multipart/, "서버는 MJPEG 를 흘리지 않는다 — 장시간 연결은 요청 단위 과금을 깬다");
});

test("stats3 — 게이트와 같은 화이트리스트(publicStats)로만 내보낸다", () => {
  const src = read("app/api/cctv-gate/cctv/stats3/route.ts");
  assert.match(src, /publicStats\(frame\.stats\)/);
  assert.doesNotMatch(src, /json\(frame\.stats/, "stats 를 통째로 내보내지 않는다 — publicStats 를 거치지 않은 직접 반환 금지");
});

test("CctvGateStream — 응답 형식으로 두 상류를 가른다: image/jpeg 는 5초 스냅샷 폴링, multipart(젯슨 게이트)는 표 만료까지 흘려 받는다", () => {
  const src = read("app/components/CctvGateStream.tsx");
  assert.match(src, /const POLL_MS = 5000/, "서버 중계는 5초 폴링(설계 §5-2)");
  assert.match(src, /const RENEW_MARGIN_MS/, "게이트 경로는 표 만료 직전까지 연결을 유지한다 — 09-17 회귀(5초에 한 장) 재발 방지");
  assert.match(src, /SNAPSHOT_MODE/);
  assert.match(src, /STREAM_MODE/);
  assert.match(src, /startsWith\("image\/jpeg"\)/, "형식 판정은 content-type 으로 한다");
  assert.match(src, /drainMultipart\(/, "multipart 는 끝까지 읽는다");
  assert.doesNotMatch(src, /FIRST_FRAME_ONLY|readFirstJpeg/, "첫 프레임만 읽고 끊는 방식이 남으면 게이트 영상이 다시 5초에 한 장이 된다");
  assert.match(src, /res\.status === 503/, "stale 을 별도 상태로 그린다");
  assert.match(src, /reader\.cancel\(\)/, "끝나면 스트림을 닫는다");
});

test("db — cctv_frame · cctv_ticket_jti 가 ensureSchema(initSchema) 안에 있다 (정본은 ensureSchema · DDL 파일 아님)", () => {
  const src = read("lib/db.ts");
  const schemaStart = src.indexOf("async function initSchema");
  const frame = src.indexOf("CREATE TABLE IF NOT EXISTS cctv_frame");
  const jti = src.indexOf("CREATE TABLE IF NOT EXISTS cctv_ticket_jti");
  assert.ok(schemaStart > 0 && frame > schemaStart && jti > schemaStart, "두 표가 initSchema 안에서 만들어진다");
  assert.match(src, /REFERENCES cctv_camera\(camera_id\)/, "프레임 행은 카메라 대장에 묶인다");
  assert.match(src, /ON CONFLICT \(jti\) DO NOTHING RETURNING jti/, "jti 소비는 INSERT 충돌로 판정한다");
});

// ★ 2026-09-18 추가 — CAM-01 이 다른 장소·다른 공유기로 옮겨가 게이트 경로가 끊겼다.
//   2호기 젯슨이 인터넷으로 직접 밀도록 ingest1 을 신설했다. ingest3 를 베껴 만든 경로다.
test("ingest1 — CAM-01 전용이고 ingest3 와 같은 문을 지난다", () => {
  const src = read("app/api/cctv-gate/cctv/ingest1/route.ts");
  // ingest3 와 같은 불변식 — 베끼면서 빠지기 쉬운 것들
  assert.match(src, /ingestTokenMatches\(/, "상수 시간 토큰 비교를 거친다");
  assert.match(src, /CCTV_INGEST_TOKEN/, "젯슨 전용 env 를 읽는다");
  assert.doesNotMatch(src, /ingestAuthStatus/, "soft 모드(무토큰 수용)로 풀리면 아무나 프레임을 덮어쓴다");
  assert.match(src, /503/, "토큰 env 가 없으면 받지 않는다(조용한 200 금지)");
  assert.match(src, /MAX_JPEG_BYTES/, "본문 상한을 본다");
  assert.match(src, /upsertCctvFrame\(/, "DB 한 행에 덮어쓴다 — 메모리 보관 없음");
});

test("경로마다 카메라가 하나로 고정된다 — 8개 전부", () => {
  // ★ 이것이 이 가드의 핵심이다. 1번 넷은 3번 넷을 베껴 만들었고,
  //   접미사를 안 바꾸면 **CAM-01 자리와 CAM-03 자리가 섞인다.** tsc·lint 는 이것을 못 본다.
  //   넣는 문(ingest)에서 틀리면 영상이 남의 자리를 덮고, 꺼내는 문(stream·stats)에서 틀리면
  //   화면이 남의 카메라를 보여준다. 방향만 다르고 둘 다 조용히 일어난다.
  for (const kind of ["ingest", "stream", "stats", "connection"]) {
    for (const [suffix, other] of [["1", "3"], ["3", "1"]] as const) {
      const path = `app/api/cctv-gate/cctv/${kind}${suffix}/route.ts`;
      const src = read(path);
      assert.match(src, new RegExp(`cameraIdForSuffix\\("${suffix}"\\)`), `${kind}${suffix} 는 CAM-0${suffix} 를 가리킨다`);
      assert.doesNotMatch(src, new RegExp(`cameraIdForSuffix\\("${other}"\\)`), `${kind}${suffix} 에 CAM-0${other} 가 있으면 베끼기 사고다`);
      // 접미사는 상수여야 한다 — 요청에서 받으면 아무 카메라나 지목할 수 있다
      assert.doesNotMatch(src, /cameraIdForSuffix\([^"]/, `${kind}${suffix} 가 접미사를 상수가 아닌 값으로 받으면 안 된다`);
    }
  }
});

test("stream1·stats1·connection1 — 셋 다 같은 문(authorizeGate)을 지난다", () => {
  // stream3 짝과 같은 불변식. 베끼면서 문을 빠뜨리면 표 없이 남의 영상이 나간다.
  for (const r of ["stream1", "stats1", "connection1"]) {
    const src = read(`app/api/cctv-gate/cctv/${r}/route.ts`);
    assert.match(src, /authorizeGate\(request/, `${r} 가 표 검증·소비 문을 지난다`);
    assert.doesNotMatch(src, /verifyTicket\(/, `${r} 가 검증을 직접 하지 않는다 — 문은 하나여야 한다`);
  }
  // 꺼내는 문 둘은 오래된 프레임을 살아 있는 척 주지 않는다
  for (const r of ["stream1", "stats1"]) {
    assert.match(read(`app/api/cctv-gate/cctv/${r}/route.ts`), /isStale\(/, `${r} 가 stale 을 본다`);
  }
  // 토글은 할 수 없다고 말한다 — 조용한 200 금지
  assert.match(read("app/api/cctv-gate/cctv/connection1/route.ts"), /501/, "connection1 은 501 로 답한다");
});
