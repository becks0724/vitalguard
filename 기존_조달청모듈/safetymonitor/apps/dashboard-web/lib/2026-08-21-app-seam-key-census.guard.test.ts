// 폰·워치 앱 이음새 A·B 키 전수 계약 — 문자열 합의를 집합 대조로 고정한다
//
// 발단(2026-08-21 · docs/seam-contracts/findings.md). 워치→폰(WCSession)과 폰 Swift→Dart
// (Flutter 채널)는 키가 전부 문자열 합의인데, 가드는 **사고가 났던 키 12개만** 지키고 있었다 —
// 가장 오래되고 하중이 큰 bpm·ae·stp·이산 6종과 Dart 표면 전체(채널명·이벤트 키)는 무가드.
// 키 하나가 어긋나면 예외가 아니라 **값이 조용히 빈다**(A = 서버는 정상인데 폰 화면만,
// B = 08-20 에 하루 두 번 화면이 얼었던 바로 그 자리).
//
// 이 가드가 초록이면 보장되는 것(L-101③) —
//  A. 워치가 싣는 샘플 키 집합 == 아래 SAMPLE_KEYS == 폰(VitalPipeline)이 읽는 키 집합.
//  B. Swift 가 emit 하는 이벤트 키 집합 == 아래 EVENT_KEYS == Dart 가 읽는 키 집합.
//     채널명 리터럴이 Swift·Dart 양쪽에 있다. 이산 6종 목록 세 벌이 같은 집합이다.
// 보장하지 않는 것 — 값의 **타입**(WCSession 은 plist 라 수신측이 NSNumber 로 관대하다 ·
// 타입까지 계약하려면 공유 상수 파일뿐, findings A-방안②) · 서버 스키마와의 정합(그쪽은
// 필드별 트리오 가드가 맡는다).
//
// 키를 추가·삭제하려면 — 코드 양끝과 **이 파일의 계약 목록을 같은 커밋에서** 고친다.
// 목록이 세 번째 자리인 것이 의도다. 한쪽만 고친 커밋이 여기서 빨개진다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = join(ROOT, "..", "vitalguard_app");
const watch = readFileSync(join(APP, "ios", "VitalWatch", "WatchStreamer.swift"), "utf8");
const watchView = readFileSync(join(APP, "ios", "VitalWatch", "ContentView.swift"), "utf8");
const pipeline = readFileSync(join(APP, "ios", "Runner", "VitalPipeline.swift"), "utf8");
const receiver = readFileSync(join(APP, "ios", "Runner", "PhoneReceiver.swift"), "utf8");
const bridge = readFileSync(join(APP, "ios", "Runner", "VitalBridge.swift"), "utf8");
const dartStream = readFileSync(join(APP, "lib", "vital_stream.dart"), "utf8");
const dartMain = readFileSync(join(APP, "lib", "main.dart"), "utf8");

// 주석을 걷어낸 본문에서만 추출한다 — 설명 주석 속 키 예시가 집합에 섞이면 안 된다(L-83).
const bare = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ── 계약 목록 (이 파일이 세 번째 자리다) ─────────────────────────────────────
// A 이음새 — 워치 hrBatch 샘플 항목의 키 23개.
const SAMPLE_KEYS = [
  "ts", "bpm", "ae", "stp", "flt", "bat", "sst", "sar",
  "seAt", "seBy", "seErr", "srAt", "srN", "mv", "wdm",
  "hrv", "rhr", "whr", "rr", "pe", "dl",
  "spo2", "spo2Ts", "still",
  // 낙상 ML 판정(2026-08-27 · 섀도) — fcid=후보 UUID · fph=단계 · fpo=결말 ·
  // frs=응답 초 · fpg=피크 G · ftr=모듈 추적 dict.
  "fcid", "fph", "fpo", "frs", "fpg", "ftr",
].sort();
// B 이음새 — EventChannel 이벤트 키 15개("hr" 스냅숏 12 + "pipeline" 상태 3).
const EVENT_KEYS = [
  "type", "seq", "channel",
  "bpm", "measuredAtMs", "spo2", "spo2AtMs", "stillSec", "steps", "flights",
  "discreteCounts", "discreteValues",
  "pending", "uploadOk", "authRejected",
].sort();
// 이산 측정 6종 — 워치 정의·워치 화면·폰 수신 세 벌이 전부 손복사라 집합으로 묶는다.
const DISCRETE_KEYS = ["hrv", "rhr", "whr", "rr", "pe", "dl"].sort();

const sorted = (s: Set<string>) => [...s].sort();
// 첫 캡처 그룹 수집 — noUncheckedIndexedAccess 라 undefined 를 여기서 걷어낸다.
const caps = (src: string, re: RegExp): string[] =>
  [...src.matchAll(re)].map((m) => m[1] ?? "").filter(Boolean);
const DICT_KEY = /"([A-Za-z][A-Za-z0-9]*)"\s*:/g;

// ── 추출기 (순수 함수 — 음성 대조가 아래에서 이 추출기 자체를 검증한다) ─────────
// 워치 쓰기 쪽 — 항목 딕셔너리 리터럴 · 항목 서브스크립트 대입 · 이산/카운트 key: 인자 ·
// 종료 지문(out[...]). 네 형태가 WatchStreamer 의 샘플 키 쓰기 전부다.
function watchWriteKeys(src: string): Set<string> {
  return new Set([
    ...caps(src, /pendingSamples\.append\(\[([^\]]*)\]\)/g).flatMap((c) => caps(c, DICT_KEY)),
    ...caps(src, /pendingSamples\[idx\]\["([A-Za-z0-9]+)"\]\s*=/g),
    ...caps(src, /\bkey:\s*"([A-Za-z0-9]+)"/g),
    ...caps(src, /out\["([A-Za-z0-9]+)"\]\s*=/g),
    // 낙상 판정 항목(2026-08-27) — 판정은 5초 주기 밖에서 나므로 대기열에 담았다가 flush 에서
    // 싣는다. 그래서 `pendingSamples` 에 직접 쓰지 않고 `fallItem` 을 거친다 = 위 네 형태로는
    // 안 잡힌다. 변수명을 계약으로 고정하고 여기서 읽는다(이름을 바꾸면 이 가드가 빨개진다).
    ...caps(src, /var fallItem: \[String: Any\] = \[([^\]]*)\]/g).flatMap((c) => caps(c, DICT_KEY)),
    ...caps(src, /fallItem\["([A-Za-z0-9]+)"\]\s*=/g),
  ]);
}
// 폰 읽기 쪽 — ingest() 의 `s["키"] as?` 전부.
const phoneReadKeys = (src: string): Set<string> =>
  new Set(caps(src, /\bs\["([A-Za-z0-9]+)"\]\s*as\?/g));
// Swift emit 쪽 — displayEvent 의 event["키"] 대입 + 리터럴 초기 딕셔너리 + pipeline emit 리터럴.
function swiftEmitKeys(recv: string, pipe: string): Set<string> {
  return new Set([
    ...caps(recv, /event\["([A-Za-z0-9]+)"\]\s*=/g),
    ...caps(recv, /var event: \[String: Any\] = \[([^\]]*)\]/g).flatMap((c) => caps(c, DICT_KEY)),
    ...caps(pipe, /emit\(\[([^\]]*)\]\)/g).flatMap((c) => caps(c, DICT_KEY)),
  ]);
}
// Dart 읽기 쪽 — fromMap 의 map['키'] 전부.
const dartReadKeys = (src: string): Set<string> =>
  new Set(caps(src, /map\['([A-Za-z0-9]+)'\]/g));

// ── A. 워치 → 폰 ────────────────────────────────────────────────────────────

test("★ A 계약 — 워치가 싣는 샘플 키 집합 == 계약 목록 == 폰이 읽는 키 집합", () => {
  assert.deepEqual(
    sorted(watchWriteKeys(bare(watch))),
    SAMPLE_KEYS,
    "워치 쓰기 키 ≠ 계약 목록 — 키를 더했으면 폰 읽기·이 목록도 같은 커밋에서",
  );
  assert.deepEqual(
    sorted(phoneReadKeys(bare(pipeline))),
    SAMPLE_KEYS,
    "폰 읽기 키 ≠ 계약 목록 — 워치가 안 싣는 키를 읽거나(죽은 읽기), 싣는 키를 버리고 있다",
  );
});

test("A 봉투 — type·seq·sentAt·samples 네 개가 양끝에 있다", () => {
  const w = bare(watch);
  assert.match(w, /"type": "hrBatch"/, "워치 봉투 type 소실");
  assert.match(w, /"seq": seq/, "워치 봉투 seq 소실");
  assert.match(w, /"samples": pendingSamples/, "워치 봉투 samples 소실");
  assert.match(bare(receiver), /payload\["type"\] as\? String == "hrBatch"/, "폰 type 분기 소실");
  assert.match(bare(pipeline), /payload\["samples"\] as\?/, "폰 samples 읽기 소실");
  // sentAt — 2026-08-21 사용자 결정 ⓐ(findings A-1)로 폰이 읽는다. 도착 시각과의 차가
  // 워치→폰 전달 지연이고 설정 진단 "전달 지연" 줄이 소비자다. 쓰기 전용이던 시절의
  // doesNotMatch 를 이 존재 단언으로 뒤집었다 — 읽기가 사라지면 그 줄이 조용히 죽는다.
  assert.match(w, /"sentAt": Date\(\)/, "워치 봉투 sentAt 소실 — 전달 지연 진단의 원천");
  assert.match(
    bare(receiver),
    /payload\["sentAt"\] as\? Double/,
    "폰 sentAt 읽기 소실 — 설정의 전달 지연 표시가 값 없이 조용히 사라진다",
  );
});

test("A 표시 경로 — PhoneReceiver 가 읽는 키는 계약 목록의 부분집합이다", () => {
  const reads = new Set(caps(bare(receiver), /(?:\bs|\$0|latestHr\?)\["([A-Za-z0-9]+)"\]/g));
  const known = new Set([...SAMPLE_KEYS, "type", "seq", "samples", "sentAt"]);
  const unknown = [...reads].filter((k) => !known.has(k));
  assert.deepEqual(unknown, [], `표시 경로가 계약에 없는 키를 읽는다: ${unknown.join(",")}`);
  // 스캔 바닥 — 아무것도 못 읽으면 위 부분집합 검사는 공허하게 통과한다(L-79).
  assert.ok(reads.has("bpm") && reads.has("spo2"), "표시 경로 스캔이 눈멀었다");
});

// ── B. 폰 Swift → Dart ──────────────────────────────────────────────────────

test("★ B 계약 — Swift 가 emit 하는 키 집합 == 계약 목록 == Dart 가 읽는 키 집합", () => {
  assert.deepEqual(
    sorted(swiftEmitKeys(bare(receiver), bare(pipeline))),
    EVENT_KEYS,
    "Swift emit 키 ≠ 계약 목록",
  );
  assert.deepEqual(
    sorted(dartReadKeys(bare(dartStream))),
    EVENT_KEYS,
    "Dart 읽기 키 ≠ 계약 목록 — 한쪽에만 키를 더하면 화면 값이 조용히 빈다",
  );
});

test("B 채널명 — 리터럴이 Swift·Dart 양쪽에 있다", () => {
  assert.match(bare(bridge), /FlutterEventChannel\(name: "vitalguard\/stream"/, "Swift 스트림 채널 소실");
  assert.match(bare(dartStream), /EventChannel\('vitalguard\/stream'\)/, "Dart 스트림 채널 소실");
  assert.match(bare(bridge), /FlutterMethodChannel\(name: "vitalguard\/bridge"/, "Swift 메서드 채널 소실");
  assert.match(bare(dartMain), /MethodChannel\('vitalguard\/bridge'\)/, "Dart 메서드 채널 소실");
});

test("B 이산 6종 — 손복사 세 벌(워치 정의·워치 화면·폰 수신)이 같은 집합이다", () => {
  // 워치 정의 — anchorKey 를 동반하는 key: 리터럴만이 이산 입력이다.
  const inputs = [...bare(watch).matchAll(/key:\s*"([A-Za-z0-9]+)",\s*anchorKey:/g)].map((m) => m[1]);
  assert.deepEqual([...inputs].sort(), DISCRETE_KEYS, "워치 discreteInputs ≠ 계약 목록");
  // 폰 수신 목록.
  const arr = bare(receiver).match(/discreteKeys = \[([^\]]*)\]/);
  assert.ok(arr, "PhoneReceiver.discreteKeys 소실");
  const phone = caps(arr[1] ?? "", /"([A-Za-z0-9]+)"/g);
  assert.deepEqual([...phone].sort(), DISCRETE_KEYS, "폰 discreteKeys ≠ 계약 목록");
  // 워치 화면 — 6종 각각이 어딘가에서 읽힌다(순서·묶음은 화면 재량, 집합만 계약).
  for (const k of DISCRETE_KEYS) {
    assert.match(bare(watchView), new RegExp(`"${k}"`), `워치 화면이 이산 키 ${k} 를 잃었다`);
  }
});

// ── 음성 대조 — 추출기가 실파일 형태에서 심은 키를 실제로 잡는지 ─────────────────
// 실파일 본문에 어긋난 줄을 덧붙여 추출기에 먹인다. 못 잡으면 위 계약 검사 전부가
// "정규식이 눈멀어 우연히 같은 집합" 일 수 있다 — 통과가 정보가 되려면 이게 필요하다(L-68).

test("음성 대조 — 심은 키가 네 추출기 모두에서 검출된다", () => {
  assert.ok(
    watchWriteKeys(bare(watch) + '\npendingSamples[idx]["ghost"] = 1\n').has("ghost"),
    "워치 쓰기 추출기가 심은 키를 못 본다",
  );
  assert.ok(
    phoneReadKeys(bare(pipeline) + '\nlet g = s["ghost"] as? Double\n').has("ghost"),
    "폰 읽기 추출기가 심은 키를 못 본다",
  );
  assert.ok(
    swiftEmitKeys(bare(receiver) + '\nevent["ghost"] = 1\n', bare(pipeline)).has("ghost"),
    "Swift emit 추출기가 심은 키를 못 본다",
  );
  assert.ok(
    dartReadKeys(bare(dartStream) + "\nfinal g = map['ghost'];\n").has("ghost"),
    "Dart 읽기 추출기가 심은 키를 못 본다",
  );
});
