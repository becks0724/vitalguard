// VWorld 역지오코딩 응답을 각인용 주소로 고르는 순수 함수. I/O 는 vworld.ts 가 맡는다.
//
// ★ 왜 순수부를 따로 두는가 — 네트워크 없이 시험할 수 있어야 한다.
//   `hospital.ts`(순수) / `naver-local.ts`(server-only) 와 같은 가름이다.
//
// ★ 애플 지오코더를 버린 이유(2026-08-28 실측 · docs/ocr-address-geocode/context-notes.md).
//   같은 좌표에서 애플은 `광주광역시 금남로3가 15-2` 를 냈고 실제는 `전남광주 동구 금남로3가 1-10`
//   이었다. 광역명(통합 전 옛 이름)·자치구(누락)·지번(다른 필지) 세 축이 동시에 틀렸다.
//   VWorld 는 같은 좌표에 **사용자 확인 실주소와 글자 단위로 같은** 값을 낸다.

/** VWorld `getAddress` 결과 한 건. `text` 가 이미 완성된 한 줄이라 조립하지 않는다. */
export type VworldAddress = { type?: string; text?: string };

export type Addresses = {
  /** 도로명주소. 우리 현장에서는 대체로 비어 있다(아래 주석 참조). */
  road: string | null;
  /** 지번주소 — 광역 + 자치구 + 법정동 + 번지가 이미 한 줄로 들어 있다. */
  jibun: string | null;
  /**
   * 사진 각인에 실제로 찍는 한 줄. **지번 우선, 없으면 도로명.**
   *
   * ★ 표기 규칙을 앱이 아니라 여기에 둔다 — 규칙이 서버에 있으면 바꿀 때 앱을 다시 깔지
   *   않아도 된다(서버 경유를 택한 이유 그 자체다). 뒤집으려면 아래 한 줄만 고친다.
   *
   * ⚠ 지번을 앞에 둔 근거는 취향이 아니라 **실측**이다. 도로명이 법정 표준이지만
   *   VWorld 에 우리 현장의 도로명이 없다 — `type=ROAD` 가 촬영 지점·하남산단·계림동
   *   **3곳 전부 `NOT_FOUND`** 였다. 없는 값을 1순위로 두면 각인이 사진마다 들쭉날쭉해진다.
   *   사용자가 확인해 준 실주소도 지번이었다.
   */
  display: string | null;
};

/**
 * 결과 목록에서 도로명·지번을 갈라 담는다.
 *
 * ⚠ `structure` 로 재조립하지 않는다 — `text` 가 이미 완성형이고, `structure.level5` 에는
 *   실측에서 `1-10도`·`651도` 처럼 꼬리가 붙어 나온다(계림동은 `1869` 로 안 붙는다).
 *   손으로 조립하면 그 불규칙을 우리가 떠안는다.
 */
export function buildAddresses(results: VworldAddress[] | undefined | null): Addresses {
  let road: string | null = null;
  let jibun: string | null = null;

  for (const r of results ?? []) {
    const text = (r.text ?? "").trim();
    if (!text) continue;
    if (r.type === "road") road = text;
    else if (r.type === "parcel") jibun = text;
  }

  return { road, jibun, display: jibun ?? road };
}
