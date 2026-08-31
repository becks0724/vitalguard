// 구획 이탈 서버 판정 — 저장된 GPS 표본을 되짚어 "지금 이탈 중인가"와 그 전이 시각을 낸다.
//
// ★ 왜 서버가 또 하나. 관제 화면(`DemoDashboard.tsx`)도 같은 판정을 하지만 **브라우저에서만**
//   돈다. 아무도 화면을 안 열어 두면 이탈 알림은 누구에게도 안 간다. `cron/absence-check` 가
//   같은 이유로 이미 서버로 옮겨진 전례다("부재는 수신이 없어서 발생하므로 수신 경로에서는
//   영원히 발화하지 않는다").
//
// ★ 클라이언트와 다른 점 = **상태를 못 든다.** 크론은 매번 새로 시작하므로 메모리 streak 이
//   없다. 그래서 최근 표본을 처음부터 되짚어 상태를 **재구성**한다. 판정 규칙 자체
//   (`stepGeofence` · 반경 · 마진 · 연속 3회)는 화면과 **같은 모듈을 공유**한다 — 두 곳이
//   갈리면 화면과 텔레그램이 서로 다른 말을 한다.
//
// ⚠ 되짚는 창은 유한하다. 창보다 오래전에 나간 사람은 창 안에 "이탈 전이"가 없어 안 잡힌다.
//   그 대신 창 안에서는 **연속 3회**가 그대로 요구되므로 스쳐 지나간 좌표 하나로는 안 울린다.
import {
  fixUsableForJudgment,
  GEOFENCE_INITIAL,
  GEOFENCE_RETURN_MARGIN_M,
  geofenceDistanceM,
  stepGeofence,
  type GeofenceState,
} from "../app/lib/geofence";

/** 한 작업자의 좌표 표본 하나. `ts` 는 ISO-8601 문자열(DB 원본 그대로). */
export type GpsFix = {
  workerId: string;
  workerName: string | null;
  ts: string;
  lat: number;
  lon: number;
  /** 수평 정확도(m). null/미보고 = 판정 통과(정확도를 안 싣던 구 경로의 종전 동작 보존). */
  accM?: number | null;
};

export type GeofenceVerdict = {
  workerId: string;
  workerName: string | null;
  /** 되짚기 끝에서 구획 밖으로 확정된 상태인가. */
  outside: boolean;
  /** 이탈이 확정된 표본의 `ts` — 알림 자연키(worker_id·type·ts)로 그대로 쓴다. */
  exitTs: string | null;
  /** 이탈 확정 시점의 중심으로부터 거리(m) — 로그·판단용. */
  exitDistM: number | null;
  /** 창 안에서 마지막으로 "확실히 안"(반경−마진 이내)에 관측된 표본의 ts — 에피소드 구분 근거.
      이탈이 되짚기 창보다 오래 지속되면 전이가 창 밖으로 밀려 매 실행 새 exitTs 가 발급된다
      (2026-08-30 실측: 같은 이탈 1건이 79건 통지 · 4~6분 간격). "이전 알림 이후 안 관측이
      있어야 새 사건" 규칙의 근거가 이 값이다. 상태머신 복귀(return)가 아니라 표본 자체로 잡는다 —
      창 시작이 이미 안쪽이면 return 이벤트는 영영 안 나오기 때문이다. */
  lastInsideTs: string | null;
  /** 되짚는 데 쓴 표본 수. 0이면 판정 근거가 없다는 뜻이다. */
  usedFixes: number;
};

/**
 * 작업자별 표본을 시간순으로 되짚어 현재 이탈 상태를 재구성한다.
 *
 * `exitTs` 를 **전이가 일어난 표본의 ts** 로 두는 것이 이 함수의 핵심이다.
 * 크론이 반복 실행돼도 같은 이탈 구간이면 같은 `ts` 가 나오므로,
 * `recordAlert` 의 자연키 dedup(`worker_id, type, ts`)이 **중복 발화를 구조적으로 막는다.**
 * 돌아왔다 다시 나가면 다른 표본이라 `ts` 가 달라지고 새 알림이 나간다 — 의도한 동작이다.
 */
export function replayGeofence(
  fixes: GpsFix[],
  center: { lat: number; lon: number },
  radiusM: number,
): GeofenceVerdict[] {
  const byWorker = new Map<string, GpsFix[]>();
  for (const f of fixes) {
    const list = byWorker.get(f.workerId);
    if (list) list.push(f);
    else byWorker.set(f.workerId, [f]);
  }

  const out: GeofenceVerdict[] = [];
  for (const [workerId, list] of byWorker) {
    // 호출측 정렬을 믿지 않는다 — 순서가 뒤집히면 streak 이 엉뚱하게 쌓인다.
    list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    let st: GeofenceState = GEOFENCE_INITIAL;
    let exitTs: string | null = null;
    let exitDistM: number | null = null;
    let lastInsideTs: string | null = null;
    let used = 0;
    for (const f of list) {
      if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
      // 부정확 측위(> R-33 상한)는 판정에도 에피소드 근거에도 안 쓴다 — 폴백 좌표가 이탈을
      // 선언하는 것도, 가짜 "안 관측" 으로 에피소드를 끊어 재알림을 여는 것도 함께 막는다.
      if (!fixUsableForJudgment(f.accM)) continue;
      used += 1;
      const dist = geofenceDistanceM(f.lat, f.lon, center.lat, center.lon);
      // 회색지대(반경±마진)는 "안 관측" 이 아니다 — 경계 플리커가 에피소드를 끊으면 연발이 재발한다.
      if (dist <= radiusM - GEOFENCE_RETURN_MARGIN_M) lastInsideTs = f.ts;
      const { state, event } = stepGeofence(st, dist, radiusM);
      st = state;
      if (event === "exit") {
        exitTs = f.ts;
        exitDistM = dist;
      } else if (event === "return") {
        // 복귀하면 지난 이탈은 닫힌 사건이다 — 다음 이탈은 새 ts 로 새로 알린다.
        exitTs = null;
        exitDistM = null;
      }
    }
    out.push({
      workerId,
      workerName: list[list.length - 1]?.workerName ?? null,
      outside: st.outside,
      exitTs: st.outside ? exitTs : null,
      exitDistM: st.outside ? exitDistM : null,
      lastInsideTs,
      usedFixes: used,
    });
  }
  return out;
}
