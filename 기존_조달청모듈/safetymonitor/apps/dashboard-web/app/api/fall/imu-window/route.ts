// 레포 경로: apps/dashboard-web/app/api/fall/imu-window/route.ts
// 워치(미니앱) → raw 6축 윈도 1건 수신 → imu_window 임시 버퍼 INSERT. A3 임시 수집용.
// 인증 없음(임시 수집 버퍼, 본 파이프라인과 미연결). 필요 시 토큰 헤더 추가.
import { NextResponse } from "next/server";

import { ingestAuthStatus } from "../../../../lib/ingest-auth";
import { insertImuWindow } from "../../../../lib/db";

// 무인증 수집 전송 경고(soft) — 프로세스당 1회.
let warnedUnauthedImu = false;
// axes 행 수 상한 — 대용량 JSONB 로 메모리·디스크·임시테이블 고갈 방지(윈도는 통상 수백 행 이하).
const MAX_IMU_ROWS = 2000;

export async function POST(request: Request) {
  // 토큰 병행(soft) — 유효 토큰 있으면 인증, 무토큰 한시 허용(경고), 무효 토큰 거부.
  const auth = ingestAuthStatus(request);
  if (auth === "invalid") {
    return NextResponse.json({ ok: false, error: "유효하지 않은 토큰" }, { status: 401 });
  }
  if (auth === "none" && !warnedUnauthedImu) {
    warnedUnauthedImu = true;
    console.warn("[fall/imu-window] 무인증 수집 전송 수용 중(soft) — 발표 후 토큰 필수화 예정");
  }
  try {
    const b = await request.json();
    // 미니앱 payload: { workerId, fs, impactIndex, axes:[[6]...], family }
    if (!Array.isArray(b?.axes) || b.axes.length === 0) {
      return NextResponse.json(
        { ok: false, error: "axes(6축 배열) 필수" },
        { status: 400 },
      );
    }
    if (b.axes.length > MAX_IMU_ROWS) {
      return NextResponse.json(
        { ok: false, error: `윈도 행 수 상한(${MAX_IMU_ROWS}) 초과` },
        { status: 400 },
      );
    }
    // 각 윈도 행이 정확히 6축인지 검증(DDL CHECK 로는 서브쿼리 불가라 여기서 막음).
    if (!b.axes.every((r: unknown) => Array.isArray(r) && r.length === 6)) {
      return NextResponse.json(
        { ok: false, error: "각 윈도는 6축([ax,ay,az,gx,gy,gz]) 이어야 함" },
        { status: 400 },
      );
    }
    await insertImuWindow({
      worker_id: String(b.workerId ?? "UNSET"),
      family: typeof b.family === "string" ? b.family : null,
      fs: typeof b.fs === "number" ? b.fs : null,
      impact_index: typeof b.impactIndex === "number" ? b.impactIndex : null,
      axes: b.axes,
    });
    return NextResponse.json(
      { ok: true, samples: b.axes.length },
      { status: 201 },
    );
  } catch (error: unknown) {
    // 내부 상세(스키마·드라이버)는 응답에 노출하지 않고 서버 로그로만.
    console.error("[fall/imu-window]", error);
    return NextResponse.json({ ok: false, error: "수집 처리 실패" }, { status: 400 });
  }
}
