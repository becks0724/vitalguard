// 태풍 응답 파싱 단위 테스트 — typSeq 그룹핑·태풍별 최신 통보문 선택·한국 최근접 정렬(쌍태풍 드랍 버그 회귀 고정).
import assert from "node:assert/strict";
import { test } from "node:test";

import { groupTyphoonItems, pickCurrentIndex } from "./typhoon-parse";

// 2026-07-13~14 실사례 축약 픽스처 — 바비(9호, 한국 근접·통보문 2건)와 하이선(11호, 원거리·통보문이 더 최신).
// 구 코드(전역 최신 tmFc 의 typSeq 하나)는 하이선만 남기고 근접 태풍 바비를 드랍했다.
const ITEMS: Record<string, unknown>[] = [
  // 바비 — 옛 통보문(진로 2점: 관측 + 예보)
  { typSeq: "9", typName: "바비", typEn: "BAVI", tmFc: "202607130400", typTm: "202607130300", typLat: 32.9, typLon: 118.5, typPs: 990, typWs: 21, typ15: "300", typDir: "N", typSp: 15 },
  { typSeq: "9", typName: "바비", typEn: "BAVI", tmFc: "202607130400", typTm: "202607140300", typLat: 39.0, typLon: 127.5, typPs: 998, typWs: 17, typ15: "250" },
  // 바비 — 최신 통보문(관측 1점만 — 이 통보문만 진로로 써야 함)
  { typSeq: "9", typName: "바비", typEn: "BAVI", tmFc: "202607131000", typTm: "202607130900", typLat: 33.5, typLon: 117.7, typPs: 992, typWs: 19, typ15: "300", typDir: "NNW", typSp: 15 },
  // 하이선 — 최신 통보문(전역 최신 tmFc, 원거리)
  { typSeq: "11", typName: "하이선", typEn: "HAISHEN", tmFc: "202607141030", typTm: "202607140900", typLat: 13.3, typLon: 134.1, typPs: 1004, typWs: 15, typ15: "0" },
];

// 활성 중첩 시점(07/13 12:00 KST) — 바비 최신 통보문 2시간 경과(활성), 하이선도 발효 중.
const NOW_OVERLAP = Date.UTC(2026, 6, 13, 3, 0); // KST 07/13 12:00

test("groupTyphoonItems — 쌍태풍이 각각 살아남고(드랍 없음), 한국 최근접(바비)이 대표(첫 원소)", () => {
  const infos = groupTyphoonItems(ITEMS, NOW_OVERLAP);
  assert.equal(infos.length, 2);
  assert.equal(infos[0]?.seq, "9"); // 바비(칭다오 부근)가 하이선(팔라우 부근)보다 한국에 가까움
  assert.equal(infos[0]?.name, "바비");
  assert.equal(infos[1]?.seq, "11");
});

test("groupTyphoonItems — 통보문 12시간 초과 두절 태풍은 소멸 간주 제외(죽은 태풍 배너 부활 방지)", () => {
  // 07/14 12:00 KST — 바비 마지막 통보문(07/13 10:00) 26시간 경과 → 제외, 하이선(07/14 10:30)만 잔존.
  const NOW_AFTER = Date.UTC(2026, 6, 14, 3, 0);
  const infos = groupTyphoonItems(ITEMS, NOW_AFTER);
  assert.equal(infos.length, 1);
  assert.equal(infos[0]?.seq, "11");
});

test("groupTyphoonItems — 관측점은 모든 통보문에서 모아 잇고, 옛 통보문의 낡은 예보는 버린다", () => {
  const infos = groupTyphoonItems(ITEMS, NOW_OVERLAP);
  const bavi = infos.find((t) => t.seq === "9");
  assert.ok(bavi);
  assert.equal(bavi.tmFc, "202607131000"); // 전역 최신(하이선 141030)이 아니라 바비 자신의 최신
  // 관측 2점(0300·0900)이 이어진다 — 옛 통보문(0400)의 예보점 202607140300 은 이미 갱신됐으므로 제외.
  assert.equal(bavi.track.length, 2);
  assert.equal(bavi.track[0]?.lat, 32.9); // 지나온 위치
  assert.equal(bavi.track[1]?.lat, 33.5); // 최신 관측
  assert.equal(bavi.currentIndex, 1); // 현재 = 마지막 관측점(뒤에 예보가 없으므로 끝)
  assert.equal(bavi.source, "live");
});

test("groupTyphoonItems — 최신 통보문의 예보점은 진로에 남고, 현재는 마지막 '관측'점", () => {
  const items: Record<string, unknown>[] = [
    // 옛 통보문 — 관측 1 + 예보 1(이 예보는 아래 최신 통보문에 의해 갱신되므로 버려져야 한다)
    { typSeq: "9", typName: "바비", tmFc: "202607130400", typTm: "202607130300", typLat: 32.9, typLon: 118.5, typ15: "300" },
    { typSeq: "9", typName: "바비", tmFc: "202607130400", typTm: "202607140300", typLat: 99.9, typLon: 99.9, typ15: "250" },
    // 최신 통보문 — 관측 1 + 예보 2
    { typSeq: "9", typName: "바비", tmFc: "202607131000", typTm: "202607130900", typLat: 33.5, typLon: 117.7, typ15: "300" },
    { typSeq: "9", typName: "바비", tmFc: "202607131000", typTm: "202607132200", typLat: 35.8, typLon: 124.0, typ15: "280" },
    { typSeq: "9", typName: "바비", tmFc: "202607131000", typTm: "202607141000", typLat: 39.0, typLon: 127.5, typ15: "250" },
  ];
  const bavi = groupTyphoonItems(items, NOW_OVERLAP)[0];
  assert.ok(bavi);
  assert.equal(bavi.track.length, 4); // 관측 2 + 최신 예보 2 (낡은 예보 1 제외)
  assert.equal(bavi.currentIndex, 1); // 예보점이 뒤에 있어도 현재는 마지막 관측점
  assert.equal(bavi.track[1]?.lat, 33.5);
  assert.equal(bavi.track[2]?.lat, 35.8); // 이 뒤가 예보 구간 → computeGate 의 선행 경보 대상
  // 낡은 예보(99.9)가 궤적에 끼지 않았는지 — 끼면 지나가지 않은 위치가 경로로 그려진다
  assert.equal(bavi.track.some((p) => p.lat === 99.9), false);
});

test("groupTyphoonItems — 같은 시각이 옛 예보와 새 관측으로 겹치면 관측을 채택", () => {
  const items: Record<string, unknown>[] = [
    // 0400 통보문이 1000 시각을 예보(위치 오차 있음)
    { typSeq: "9", typName: "바비", tmFc: "202607130400", typTm: "202607131000", typLat: 40.0, typLon: 120.0, typ15: "300" },
    // 1100 통보문이 같은 1000 시각을 관측으로 확정
    { typSeq: "9", typName: "바비", tmFc: "202607131100", typTm: "202607131000", typLat: 33.5, typLon: 117.7, typ15: "300" },
  ];
  const bavi = groupTyphoonItems(items, NOW_OVERLAP)[0];
  assert.ok(bavi);
  assert.equal(bavi.track.length, 1);
  assert.equal(bavi.track[0]?.lat, 33.5); // 예보(40.0)가 아니라 관측(33.5)
});

test("groupTyphoonItems — 좌표 무효 행 제외·빈 그룹 스킵·빈 입력은 빈 배열", () => {
  assert.deepEqual(groupTyphoonItems([], NOW_OVERLAP), []);
  const infos = groupTyphoonItems(
    [{ typSeq: "7", typName: "무효", tmFc: "202607130400", typTm: "202607130300", typLat: "", typLon: "" }],
    NOW_OVERLAP,
  );
  assert.deepEqual(infos, []); // track 0점 그룹은 결과에서 제외
});

test("pickCurrentIndex — 통보문 시각 최근접 지점이 현재", () => {
  const track = [
    { tm: "202607130300", lat: 1, lon: 1 },
    { tm: "202607130900", lat: 2, lon: 2 },
    { tm: "202607140900", lat: 3, lon: 3 },
  ];
  assert.equal(pickCurrentIndex(track, "202607131000"), 1);
  assert.equal(pickCurrentIndex(track, undefined), 0);
});
