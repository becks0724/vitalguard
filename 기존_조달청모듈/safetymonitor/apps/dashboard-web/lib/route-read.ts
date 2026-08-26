// 조회 라우트의 DB 실패를 **읽을 수 있는 실패**로 바꾼다 — 삼키지도, 벌거벗은 500 으로 두지도 않는다.
//
// 무엇이 문제였나(2026-08-26 실측). 설정·목록 조회 라우트 다섯이 `await getX()` 를 맨몸으로
// 부르고 있었다. D-3 접속 타임아웃(미해명 잔여 · 캠퍼스 쪽 지연)이 뜨면 그대로 **처리되지 않은
// 500** 이 되고, 로그에는 **라벨 없는 ERROR** 만 남는다. 24시간 실측 —
//   Connection terminated 라우트별   aed/config 16 · gaspod/config 8 · alerts 4 · inspections 4 · devices 4
//   그중 사용자에게 500 으로 나간 것  cron/absence-check 12 · aed/config 6 · monitor/vital 4 · gaspod/config 4
//
// ★ 그런데 **화면은 안 깨진다** — 소비부가 이미 방어적이다(`if (j.ok && j.configs) cache = ...`,
//   `if (!res.ok) return`). 실패하면 직전 정상값을 유지하지 빈 값으로 덮지 않는다.
//   그러니 이 헬퍼의 목적은 "사용자 피해 차단" 이 아니라 **운영 신호를 읽을 수 있게 만드는 것**이다.
//     · 라벨 없는 ERROR → 라우트 이름이 박힌 로그(2026-08-26 에 스택을 찾느라 파야 했다)
//     · 무구분 500 → 503 `transient:true`(일시 장애와 코드 버그를 가른다)
//
// ★★ **빈 값으로 degrade 하지 않는다.** `configs: {}` 나 `alerts: []` 를 200 으로 내리면
//    "설정 없음"·"경보 없음" 이라는 **거짓 단언**이 된다. 이 레포가 반복해 고쳐 온 false-OK 다
//    (미수신→준수율 100% · 미착용→정상 · 대기 인원→정상 N명). 조회가 실패했으면 실패라고 말한다.
//
// ★★ **200 으로 감추지도 않는다.** 5xx 를 없애면 배포 사후 관찰·모니터링이 조용해지는데,
//    DB 는 실제로 타임아웃 중이다. 운영 층의 false-OK 이므로 상태 코드는 5xx 로 남긴다.
//    바뀌는 것은 "무슨 일인지 읽히는가" 뿐이다.
import { NextResponse } from "next/server";

/**
 * 조회 한 건을 감싼다. 성공하면 `build(값)` 이 만든 응답을, 실패하면 503 `transient` 를 낸다.
 *
 * @param label 로그·응답에 박히는 라우트 이름(예: `aed/config`). **비우지 않는다** — 이 인자가
 *              없어서 오늘 로그가 벌거벗은 ERROR 였다.
 */
export async function readOr503<T>(
  label: string,
  read: () => Promise<T>,
  build: (value: T) => NextResponse,
): Promise<NextResponse> {
  try {
    return build(await read());
  } catch (e) {
    // 스택을 함께 남긴다 — 라우트 이름만으로는 어느 쿼리인지 못 가른다.
    console.error(`[${label}] 조회 실패 — 503 반환(일시 장애로 표시)`, e);
    return NextResponse.json(
      {
        ok: false,
        error: "일시적으로 조회할 수 없습니다. 잠시 후 다시 시도하세요.",
        // 소비부가 "값이 없다" 와 "못 읽었다" 를 구별할 수 있게 하는 유일한 표식.
        transient: true,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
