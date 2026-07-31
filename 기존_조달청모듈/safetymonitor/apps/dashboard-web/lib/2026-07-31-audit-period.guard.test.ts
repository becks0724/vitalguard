// 안전관리비 감사 기간이 '고정 구간' 임을 고정하는 가드.
//
// 왜 필요한가 — 원래 기본값이 '최근 90일 롤링' 이었고, 그 탓에 같은 현장을 어제 보고 오늘 다시 보면
// 계상액 ÷ 출역이 달라졌다. 더 나쁜 건 판정이다: ④증액 검증이 '청구수량 ÷ 실측인원' 이라
// 기준일 이후 새로 들어온 출역 한 건이 과다 산정 판정을 조용히 뒤집는다.
// 실제로 라이브에서 인원이 22명으로 불어 안전대 과다 4개가 0개로 사라진 적이 있다.
//
// 롤링으로 되돌리는 변경(Date.now 기반 기본값 부활)을 테스트 실패로 막는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROUTE = "app/api/safety-audit/route.ts";
const src = readFileSync(ROUTE, "utf8");

test("감사 기간 기본값은 고정 상수다", () => {
  assert.match(src, /const AUDIT_PERIOD_FROM = "\d{4}-\d{2}-\d{2}"/, "AUDIT_PERIOD_FROM 상수가 없다");
  assert.match(src, /const AUDIT_PERIOD_TO = "\d{4}-\d{2}-\d{2}"/, "AUDIT_PERIOD_TO 상수가 없다");
  assert.match(src, /searchParams\.get\("from"\) \?\? AUDIT_PERIOD_FROM/, "from 기본값이 상수가 아니다");
  assert.match(src, /searchParams\.get\("to"\) \?\? AUDIT_PERIOD_TO/, "to 기본값이 상수가 아니다");
});

test("기간 기본값에 현재시각(롤링 창)이 다시 끼어들지 않는다", () => {
  // 90일 롤링의 흔적(90 * 24 * 60 * 60 * 1000)과 now 기반 기본값을 막는다.
  assert.doesNotMatch(src, /90 \* 24 \* 60 \* 60 \* 1000/, "90일 롤링 창이 되살아났다");
  assert.doesNotMatch(
    src,
    /searchParams\.get\("(from|to)"\) \?\? (new Date|now)/,
    "기간 기본값이 현재시각 기반으로 되돌아갔다",
  );
});

test("호출부가 기간을 덮어쓸 수 있는 경로는 남아 있다", () => {
  // 주간 보고서·과거 정산처럼 다른 구간을 봐야 하는 소비처가 있으므로 ?from&to 는 유지한다.
  assert.match(src, /searchParams\.get\("from"\)/);
  assert.match(src, /searchParams\.get\("to"\)/);
});

test("응답에 감사 기간이 실려 화면이 표기할 수 있다", () => {
  assert.match(src, /period: \{ from, to \}/, "응답에 period 가 없으면 화면이 기간을 못 밝힌다");
  const board = readFileSync("app/components/SafetyCostAuditBoard.tsx", "utf8");
  assert.match(board, /검증 기간/, "감사 보드가 검증 기간을 표기하지 않는다");
});
