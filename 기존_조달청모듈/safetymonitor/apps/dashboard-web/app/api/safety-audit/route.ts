// 안전관리비 실집행 감사 — ?id=공고번호 [&from&to(ISO)]. ①계상(조달)×③실집행(워치 출역) 교차.
import { NextResponse } from "next/server";

import { verifyAreaAccess } from "../../../lib/admin-auth";
import { getNoticeDetail } from "../../lib/g2b";
import { auditWorkerDays } from "../../../lib/db";
import { buildExecutionAudit } from "../../lib/safety-execution";
import { MAIN_SITE_ID, mockWorkerDayAudit } from "../../lib/site-workerdays-mock";

export const dynamic = "force-dynamic";

// 감사 대상 기간(KST 달력일) — 기본값은 '최근 90일 롤링' 이 아니라 고정 구간이다.
// 안전관리비 정산은 계약기간·정산기준일 기준으로 하는 것이지 굴러가는 창으로 하지 않는다.
// 롤링이면 같은 현장을 어제 보고 오늘 다시 봤을 때 계상액 ÷ 출역이 달라져 감사 근거가 되지 못하고,
// 기준일 이후 새로 들어온 출역이 판정(청구수량 ÷ 실측인원)을 조용히 바꾼다.
// from = 워치 출역 수집 개시일, to = 검증 기준일. 호출부가 ?from&to 로 덮어쓸 수 있다.
const AUDIT_PERIOD_FROM = "2026-06-22";
const AUDIT_PERIOD_TO = "2026-07-30";

export async function GET(req: Request) {
  // 안전관리비 영역 — 공단 관리자·현장 관리자는 거부(2026-08-28 소속별 화면 분리).
  // ⚠ 종전엔 게이트가 없어 비로그인 호출도 통과했다. 화면(SafetyCostAuditBoard)이 세션 토큰을
  //   함께 보내도록 같이 고쳤다.
  if (!(await verifyAreaAccess(req, "safetyCost"))) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "안전관리비 검증 열람 권한이 없습니다" } },
      { status: 403 },
    );
  }
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: { code: "BAD_ID", message: "공고 id 가 필요합니다" } }, { status: 400 });
    }

    const from = url.searchParams.get("from") ?? AUDIT_PERIOD_FROM;
    const to = url.searchParams.get("to") ?? AUDIT_PERIOD_TO;

    const detail = await getNoticeDetail(id);
    if (!detail.notice) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "공고를 찾을 수 없습니다" } }, { status: 404 });
    }

    // 현장별 격리 — 메인 관제 현장만 실 워치 출역(vital_samples), 그 외는 현장별 가상 출역.
    // 메인 현장도 DB 불가(로컬 dev 미설정·장애) 시 가상 출역으로 강등(KOSHA/G2B mock 폴백 패턴) — 500 대신 데모 표기.
    const isMainSite = id === MAIN_SITE_ID;
    let dbLive = isMainSite;
    let wd;
    if (isMainSite) {
      try {
        wd = await auditWorkerDays({ from, to });
      } catch (err) {
        console.error("[api/safety-audit] DB 불가 — 가상 출역 폴백:", err);
        dbLive = false;
        wd = mockWorkerDayAudit(id);
        // 메인 현장은 가상 출역 테이블에 없어 0 — 로컬 dev 판정이 돌도록 라이브 규모의 데모 출역 사용.
        if (wd.totalWorkerDays === 0) {
          wd = { totalWorkerDays: 91, safetyWorkerDays: 55, distinctWorkers: 16, days: 20, byDay: [] };
        }
      }
    } else {
      wd = mockWorkerDayAudit(id);
    }
    const audit = buildExecutionAudit(detail.notice, wd);
    if (!dbLive && wd.totalWorkerDays > 0) {
      audit.note = `[가상 출역 데모] ${audit.note}`;
    }
    const execution: "live" | "simulated" | "none" =
      wd.totalWorkerDays === 0 ? "none" : dbLive ? "live" : "simulated";

    return NextResponse.json({ source: detail.source, execution, notice: detail.notice, audit, period: { from, to } });
  } catch (err) {
    console.error("[api/safety-audit]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "안전관리비 실집행 감사 실패" } }, { status: 500 });
  }
}
