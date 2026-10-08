// Cloud Scheduler 무인 트리거 — 생체 수신이 끊긴 작업자를 서버가 주기로 찾아 알리고, 돌아오면 닫는다.
//
// ★ 왜 크론인가. 다른 경보는 전부 `recordAlert` 를 **수신 경로**에서 부른다. 부재는 수신이 없어서
//   발생하므로 그 자리에서는 영원히 발화하지 않는다 — 2026-08-18 19:01 부터 12.9시간 끊겼는데
//   경보 0건이었고 사람이 워치에서 [시작] 을 눌러서야 끝났다. 부재는 캐물어야만 보인다.
import { NextResponse } from "next/server";

import {
  absenceMessage,
  classifyRecovery,
  decideAbsences,
  recoveryAckBy,
  recoveryMessage,
} from "../../../../lib/absence-watch";
import { cronAuth } from "../../../../lib/cron-auth";
import {
  ackAlert,
  lastSeenByWorker,
  listOpenAbsenceAlerts,
  maxMeasuredLagSecAfter,
  recordAlert,
  rosterSize,
  rosterWorkerNames,
} from "../../../../lib/db";
import { sendTelegramMessage } from "../../../../lib/telegram";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = cronAuth(request.headers.get("x-cron-key"), process.env.CRON_SECRET);
  if (auth === "notConfigured") {
    return NextResponse.json({ ok: false, error: "CRON_SECRET 미설정" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();

  // ★ 이름은 **관제 화면과 같은 소스**에서 가져온다(`rosterWorkerNames` = 시간 창 없는 최빈 라벨).
  //
  //   `lastSeenByWorker` 의 이름은 **24시간 창** 안의 최빈이라, 그 창이 폴백 라벨로 채워진
  //   작업자를 잘못 부른다.
  //
  //   실측(2026-08-19 · 프로덕션 · `EMP-admin7276` 별칭 5개 합산)
  //     전수 최빈        `전 팀원` 17,513건(마지막 사용 07-28)
  //     마지막 쓰인 라벨  `워치PoC` 957건(마지막 사용 08-01)
  //     그 워커가 **마지막으로 수신되던 24시간** 안에서는 `워치PoC` 가 최빈이었다
  //     ⟹ 그 시점에 부재가 발화했다면 텔레그램은 `워치PoC` 라고 불렀다. 화면은 `전 팀원` 다.
  //
  //   ⚠ **지금은 재현되지 않는다** — 마지막 수신이 18일 전이라 `now() - 24h` 창에 샘플이
  //   0건이고 이 워커는 알림 대상 자체가 아니다. 기기가 그 라벨로 돌아왔다가 끊기는 순간
  //   되살아나는 **잠복 결함**이다(관측된 발화가 아니라 라벨 분포로 세운 인과다 — L-85).
  //
  //   ⚠ 최근 라벨이 아니라 최빈이라는 규칙은 그대로다. 바뀐 것은 **창을 없앤 것**뿐이다.
  //   조회 실패·미등록이면 종전 값으로 떨어진다(이름 때문에 알림을 잃지 않는다).
  const names = await rosterWorkerNames().catch(() => ({}) as Record<string, string>);

  // ── ① 복귀 해제 먼저. 순서가 중요하다 — 방금 돌아온 작업자를 여기서 닫아야
  //     아래 ② 가 같은 사람을 다시 공백으로 세지 않는다.
  let resolved = 0;
  let resolveFailed = 0;
  for (const open of await listOpenAbsenceAlerts()) {
    let outcome: Awaited<ReturnType<typeof maxMeasuredLagSecAfter>>;
    try {
      outcome = await maxMeasuredLagSecAfter(open.worker_id, open.ts);
    } catch {
      resolveFailed += 1;
      continue;
    }
    if (!outcome) continue; // 아직 안 돌아왔다 — 열어 둔다.

    const cause = classifyRecovery(outcome.maxLagSec);
    const changed = await ackAlert(open.id, recoveryAckBy(cause));
    if (changed === 0) continue; // 사람이 먼저 확인했다 — 통지하지 않는다.
    resolved += 1;

    const gapMs = Date.parse(outcome.resumedAtIso) - Date.parse(open.ts);
    // ★ 시각이 아니라 **그 공백이 어떤 공백이었나**로 정한다(2026-09-03).
    //   벗어 둔 공백은 아래 ②에서 push 되지 않았다 — 그 복귀만 알리면 선행 알림 없이
    //   "✅ 재개" 가 홀로 떠서 관제자가 무엇이 닫혔는지 모른다.
    if (!outcome.offBody && Number.isFinite(gapMs)) {
      await sendTelegramMessage(
        recoveryMessage({
          workerId: open.worker_id,
          workerName: names[open.worker_id] ?? open.worker_name,
          gapStartIso: open.ts,
          gapMs,
          cause,
        }),
      );
    }
  }

  // ── ② 공백 감지. 원장에는 언제나 남기고, push 만 **착용 상태**로 막는다(2026-09-03).
  //     종전엔 시계(07~19)로 막았는데 그러면 야간 작업자의 생체 알림을 통째로 못 받는다.
  //     지금은 벗어 둔 워치만 조용하고, 차고 있는데 심박이 끊기면 시각 무관 push 한다.
  //
  //     ★ 명부가 비면 `workers` 도 비어 **아무 일도 안 일어난 것과 구별되지 않는다**(0건이
  //     "정상" 으로 읽히는 자리). 그래서 배정 수를 함께 응답에 싣는다.
  const [roster, workers] = await Promise.all([rosterSize(), lastSeenByWorker()]);
  const decisions = decideAbsences(
    workers.map((w) => ({
      workerId: w.worker_id,
      workerName: names[w.worker_id] ?? w.worker_name,
      lastHeartbeatIso: w.last_hr_ts,
      // 'true'/'false' 문자열 → boolean. 그 밖(없음·이상값)은 null = 모름 → push 쪽으로 떨어진다.
      worn: w.last_worn === "true" ? true : w.last_worn === "false" ? false : null,
      batteryStatus: w.last_battery_status,
    })),
    now,
  );

  let fired = 0;
  // push 는 이제 시각이 아니라 착용 상태로 갈린다 — 응답에 건수를 실어 "조용한 이유" 를 남긴다.
  let pushed = 0;
  for (const d of decisions) {
    // 원장이 먼저다 — 통지만 나가고 기록이 없으면 발동 이력을 아무도 못 본다(온열 알림 전례).
    const isNew = await recordAlert(
      {
        workerId: d.workerId,
        workerName: d.workerName,
        type: "absence",
        ts: d.gapStartIso,
      },
      { notify: false },
    );
    if (!isNew) continue; // 같은 공백은 한 번만 — 자연키 (worker_id, type, ts) 가 막는다.
    fired += 1;
    if (d.push) {
      pushed += 1;
      await sendTelegramMessage(absenceMessage(d));
    }
  }

  return NextResponse.json({
    ok: true,
    roster,
    checked: workers.length,
    absent: decisions.length,
    fired,
    pushed,
    resolved,
    ...(resolveFailed > 0 ? { resolveFailed } : {}),
  });
}
