// 작업자 신호등 톤 합성 — 생체 판정에 위치(구획 이탈) 상태를 얹는 순수 함수.
// 컴포넌트 안 useMemo 에 흩어져 있으면 회귀 테스트가 안 붙어 여기로 분리한다.
// DemoDashboard 의 지역 VitalStatus 와 동일한 유니온(구조적 타이핑으로 상호 호환).
export type SignalTone = "idle" | "normal" | "caution" | "danger";
type VitalStatus = SignalTone;

export const TONE_RANK: Record<VitalStatus, number> = {
  idle: 0,
  normal: 1,
  caution: 2,
  danger: 3,
};

export function worseTone(a: VitalStatus, b: VitalStatus): VitalStatus {
  return TONE_RANK[a] >= TONE_RANK[b] ? a : b;
}

/**
 * 생체 톤 + 위치 상태 → 카드/신호등에 표시할 최종 톤.
 *
 * 구획 이탈은 주의(caution) 로 본다. 워치는 작업 중에만 착용하므로 "착용 중 + 구획 밖"은
 * 근무지 이탈로 간주하되, 생체 이상만큼 즉각적 위해는 아니라 danger 로 올리지 않는다.
 * 생체가 이미 danger 면 worst-of 로 danger 가 유지된다.
 *
 * 연결끊김(stale)도 같은 이유로 최소 caution 이다 — 낡은 값이 "정상"으로 보이면 안 된다.
 *
 * 2026-07-26 정정(감사 DLT-LIB-012/014) — 과거에는 stale 과 outside 를 별도 분기로 썼으나
 * 두 분기의 반환식이 동일해 **순서가 아무 효과도 없는 no-op** 이었고, 주석은 "stale 이면 이탈을
 * 얹지 않는다"고 적혀 있어 코드와 어긋났다. 톤 합성에서 둘은 실제로 같은 효과(최소 caution)이므로
 * 한 식으로 합친다. **두 상태의 구분은 톤이 아니라 라벨이 담당한다**(disconnectMetric 참조) —
 * "구획 밖에서 신호 두절"은 수색 위치 단서라 "그냥 연결끊김"과 반드시 구별되어야 한다.
 *
 * 호출부는 **가공하지 않은 생체 톤**을 넘긴다. 과거 통합 신호등은 `stale ? "caution"` 으로 미리
 * 강등해 넘기고 표 행은 원 톤을 넘겨, 같은 작업자가 화면마다 caution/danger 로 갈렸다(DLT-LIB-014).
 */
export function effectiveTone(
  vitalTone: VitalStatus,
  opts: { stale?: boolean; outside?: boolean },
): VitalStatus {
  if (opts.stale || opts.outside) return worseTone(vitalTone, "caution");
  return vitalTone;
}

/**
 * 연결끊김 작업자의 이상 사유 라벨.
 *
 * 구획 밖에서 신호가 끊긴 것은 "배터리 방전"과 전혀 다른 사건이다 — 마지막 확인 위치가
 * 작업구역 밖이라는 뜻이라 수색 시작점이 달라진다. 톤은 같아도 라벨은 구별한다(감사 DLT-LIB-013).
 */
export function disconnectMetric(outside: boolean): string {
  return outside ? "구획밖 연결끊김" : "연결끊김";
}

/** 표에 실제로 렌더할 생체 3종 — 값이 없으면 undefined 로 통일(호출부는 "--" 로 렌더). */
export type GatedVitals = {
  heartRate: number | undefined;
  spo2: number | undefined;
  skinTempC: number | undefined;
};

/**
 * 연결끊김(stale)이면 sticky 직전값을 현재값처럼 보여주지 않는다(false-OK 차단).
 *
 * store.ts 의 sticky merge 는 "아이폰 잠금 중 iOS 가 HealthKit 읽기를 막아 폰이 null 을 보낼 때"
 * 카드가 비지 않게 하려는 장치다. 잠금 중에도 폰은 vital 만 null 로 채워 **계속 POST 하므로**
 * ts 가 갱신되어 stale 이 되지 않는다 — 이 게이트는 잠금 연속성을 깨지 않고 진짜 미수신만 비운다.
 *
 * 서버측 SpO₂ TTL(store.ts SPO2_TTL_MS)은 마지막 샘플 ts 기준이라 송신이 멈추면 나이가 더 이상
 * 자라지 않아 이 경우를 못 잡는다. 표시 계층의 벽시계 기준 게이트가 그 구멍을 메운다.
 */
export function gateStaleVitals(
  sample:
    | { heartRate?: number | null; spo2?: number | null; skinTempC?: number | null }
    | undefined,
  stale: boolean,
): GatedVitals {
  if (stale || sample === undefined) {
    return { heartRate: undefined, spo2: undefined, skinTempC: undefined };
  }
  return {
    heartRate: sample.heartRate ?? undefined,
    spo2: sample.spo2 ?? undefined,
    skinTempC: sample.skinTempC ?? undefined,
  };
}

/** 이상 명단에 표시할 사유 토큰에 위치 사유를 덧붙인다(생체 사유가 없으면 위치 단독). */
export function withOutsideMetric(metrics: string[], outside: boolean): string[] {
  if (!outside) return metrics;
  return [...metrics, "구획이탈"];
}

/** 신호등 상세 줄 — 라벨 + 본문. */
export type SignalLine = { label: string; text: string };

/** 신호등 작업자 항목 문구 산출 입력 — 등록 인원과 판정된 인원을 분리해 받는다. */
export type WorkerTally = {
  /** 등록(채워진) 슬롯 인원 */
  count: number;
  /** 생체 판정이 실제로 가능했던 인원(tone !== "idle") */
  evaluated: number;
  /** 이상 명단 */
  issues: { name: string; metrics: string }[];
  /** 생체 미수신이라 판정 대상이 아니었던 작업자 표시명 */
  waitingNames: string[];
};

function waitingLine(names: string[]): SignalLine[] {
  if (names.length === 0) return [];
  return [{ label: "수신 대기", text: `${names.join("·")} — 생체 미수신이라 판정 대상이 아니다.` }];
}

/**
 * 신호등 작업자 항목 문구 — **등록 인원과 실제 판정된 인원을 반드시 구분해서** 적는다.
 *
 * 2026-08-12 결함 — 생체 샘플이 없는 작업자(tone `idle` · 표에서는 대기)는 이상 명단에 들어가지
 * 않는데 인원수에는 함께 세어졌다. 그래서 4명 중 1명만 수신 중인데도 신호등이 "정상 4명 ·
 * 전 작업자 정상 범위 · 등록 4명 전부 정상 범위(심박·SpO₂·체온·낙상·SOS)" 로 표시했다.
 * **한 번도 받은 적 없는 값 5종을 정상이라고 단언하는 문장**이라 관리자가 "4명이 감시되고 있다"고
 * 오독한다. 2026-07-30 CCTV "미수신 → 준수율 100%" 와 같은 false-OK 계열이다.
 *
 * 원인은 `isStale(undefined) === false` 가 아니다 — 등록만 해두고 출근 전인 작업자를 "연결끊김"
 * 으로 알리면 오탐이므로 그 판정은 옳다. 잘못은 그 다음, **idle 을 정상으로 셈한 집계**에 있다.
 *
 * ★ 톤은 올리지 않는다 — 대기를 매번 주의로 띄우면 경보 피로가 생긴다. 처방은 사실을 문장으로
 * 구분해 적는 것이고, 그래서 이 함수는 **문구만** 만든다(`sev` 는 호출부의 worst-of 를 유지).
 */
export function workerSignalCopy(t: WorkerTally): {
  summary: string;
  short: string;
  title: string;
  lines: SignalLine[];
} {
  const anomaly = t.issues.length;
  const first = t.issues[0];
  const waiting = t.waitingNames.length;

  if (t.count === 0) {
    return {
      summary: "작업자 대기",
      short: "작업자 등록 대기",
      title: "작업자 대기",
      lines: [{ label: "안내", text: "빈 슬롯에 작업자 등록 시 실시간 평가됩니다." }],
    };
  }

  if (anomaly > 0 && first) {
    return {
      summary: `이상 ${anomaly}명 / 전체 ${t.count}명`,
      short:
        first.metrics === "연결끊김"
          ? `${first.name} 연결끊김 — 즉시 연락·현장 확인`
          : `${first.name} ${first.metrics} 이상 — 심정지·SOS 골든타임 4분`,
      title: `작업자 이상 ${anomaly}명 / 전체 ${t.count}명`,
      lines: [
        ...t.issues.map((it, idx) => ({ label: `이상 ${idx + 1}`, text: `${it.name} — ${it.metrics}` })),
        ...waitingLine(t.waitingNames),
        { label: "골든타임", text: "심정지·SOS 4분 / 낙상 후 의식없음 즉시 / 열사병 즉시 냉각·수분" },
        {
          label: "권장 대응",
          text: "해당 작업자 카드·생체 확인. SOS 시 119·보호자 연락, 낙상 시 의식·외상 확인.",
        },
      ],
    };
  }

  // 이상 0명 — 여기서 "전원 정상" 이라고 적으면 안 된다. 판정된 인원만 정상이라고 적는다.
  if (t.evaluated === 0) {
    return {
      summary: `대기 ${t.count}명`,
      short: `${t.count}명 전원 수신 대기 — 생체 판정 없음`,
      title: `작업자 수신 대기 (${t.count}명)`,
      lines: [
        { label: "상태", text: `등록 ${t.count}명 전원 생체 미수신 — 정상 여부를 판정하지 못했다.` },
        ...waitingLine(t.waitingNames),
      ],
    };
  }

  if (waiting > 0) {
    return {
      summary: `정상 ${t.evaluated}명 · 대기 ${waiting}명`,
      short: `정상 ${t.evaluated}명 · ${waiting}명 수신 대기`,
      title: `작업자 정상 ${t.evaluated}명 · 대기 ${waiting}명 (등록 ${t.count}명)`,
      lines: [
        { label: "상태", text: `판정 ${t.evaluated}명 정상 범위(심박·SpO₂·체온·낙상·SOS)` },
        ...waitingLine(t.waitingNames),
      ],
    };
  }

  return {
    summary: `정상 ${t.count}명`,
    short: "전 작업자 정상 범위",
    title: `작업자 정상 (${t.count}명)`,
    lines: [{ label: "상태", text: `등록 ${t.count}명 전부 정상 범위(심박·SpO₂·체온·낙상·SOS)` }],
  };
}
