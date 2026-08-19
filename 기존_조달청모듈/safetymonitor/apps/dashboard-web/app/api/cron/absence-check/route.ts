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
  isWithinPushWindow,
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
  const pushWindow = isWithinPushWindow(now);

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
    if (pushWindow && Number.isFinite(gapMs)) {
      await sendTelegramMessage(
        recoveryMessage({
          workerId: open.worker_id,
          workerName: open.worker_name,
          gapStartIso: open.ts,
          gapMs,
          cause,
        }),
      );
    }
  }

  // ── ② 공백 감지. 원장에는 야간에도 남기고, push 만 근무시간으로 막는다.
  //     ⚠ 야간에 시작해 아침까지 이어지는 공백은 push 되지 않는다(자연키가 같아 재삽입이 안 된다).
  //     화면에는 보인다 — 야간을 표시만으로 둔 2026-08-19 결정에 포함된 결과다.
  const workers = await lastSeenByWorker();
  const decisions = decideAbsences(
    workers.map((w) => ({
      workerId: w.worker_id,
      workerName: w.worker_name,
      lastSeenIso: w.last_ts,
    })),
    now,
  );

  let fired = 0;
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
    if (d.push) await sendTelegramMessage(absenceMessage(d));
  }

  return NextResponse.json({
    ok: true,
    pushWindow,
    checked: workers.length,
    absent: decisions.length,
    fired,
    resolved,
    ...(resolveFailed > 0 ? { resolveFailed } : {}),
  });
}
