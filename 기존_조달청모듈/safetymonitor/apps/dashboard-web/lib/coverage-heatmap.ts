// 수집 커버리지 히트맵의 달력 배치·칸 상태 판정 — 순수 함수라 화면 없이 테스트된다.
//
// ★★ 이 파일의 존재 이유는 **빈칸 세 종류를 가르는 것**이다.
//
// GitHub 히트맵은 "기여 0건"과 "그날이 없음"을 같은 연회색으로 그린다. 우리에게 그건 이 레포가
// 반복해 고쳐 온 false-OK 다 — **미수신이 "활동 없음"으로 읽힌다.** 1년 창에서는 여기에 세 번째가
// 붙는다. 사용자 계정 기준 365칸 중 채워지는 것은 39칸(11%)뿐이고, 빈 326칸의 대부분은
// "그날 미수신"이 아니라 **애초에 이 시스템이 없던 날**이다. 그걸 미수신으로 칠하면 없는 사고를
// 326건 그리는 것이다.
//
//   before   첫 수집일 이전            "운영 이전"
//   missing  운영 기간 중인데 데이터 0   "미수신"
//   covered  수집된 분 > 0             "N시간 M분"

/** 칸 하나. `minutes` 는 covered 일 때만 의미가 있다. */
export type CoverageCell = {
  /** `YYYY-MM-DD` (KST 달력일) */
  date: string;
  state: "before" | "missing" | "covered";
  minutes: number;
  /** 0(미수집) ~ 5(12시간 초과). 색 강도. */
  level: 0 | 1 | 2 | 3 | 4 | 5;
};

/**
 * 색 단계 — **교대 시간을 기준으로 자른 절대 임계**다.
 *
 * 균등 분위수로 자르면 데이터가 적을 때 경계가 매일 바뀌어 **어제와 오늘의 같은 색이 다른 뜻**이
 * 된다. 8시간 교대라는 고정 기준이 있으므로 고정한다.
 */
export function coverageLevel(minutes: number): CoverageCell["level"] {
  if (minutes <= 0) return 0;
  if (minutes <= 60) return 1; // ~1시간 — 잠깐 켜졌다
  if (minutes <= 240) return 2; // ~4시간
  if (minutes <= 480) return 3; // ~8시간
  if (minutes <= 720) return 4; // ~12시간 — 교대 1회분
  return 5;
}

/** `62` → `1시간 2분` · `0` → `0분`. 툴팁에 정확한 값을 적는다(색만으로 읽게 두지 않는다). */
export function formatCoverage(minutes: number): string {
  if (minutes <= 0) return "0분";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

/** `2026-08-17` → 그 날짜의 KST 자정을 가리키는 Date(UTC 기준으로 다룬다 — 표준시 이동 없음). */
function parseDay(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * 마지막 날(`endDay`)로 끝나는 `days` 일치 칸 배열. 오래된 날이 앞이다.
 *
 * @param points   서버가 준 수집된 날만(값 0 인 날은 행 자체가 없다 — `dailyCoverageMinutes` 계약)
 * @param firstDataDate 그 워커의 최초 수집일. null 이면 **전 기간이 운영 이전**이다
 *                      (한 번도 수집된 적 없는 워커를 365칸 미수신으로 칠하지 않는다).
 */
export function buildCoverageCells(
  points: { date: string; value: number }[],
  firstDataDate: string | null,
  endDay: string,
  days: number,
): CoverageCell[] {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.date, p.value);

  const firstMs = firstDataDate ? parseDay(firstDataDate) : Number.POSITIVE_INFINITY;
  const endMs = parseDay(endDay);
  const cells: CoverageCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ms = endMs - i * 86_400_000;
    const date = dayKey(ms);
    const minutes = byDay.get(date) ?? 0;
    // 수집된 날은 무조건 covered — 최초 수집일 계산과 어긋나더라도 **실제 데이터가 이긴다**.
    if (minutes > 0) {
      cells.push({ date, state: "covered", minutes, level: coverageLevel(minutes) });
    } else if (ms < firstMs) {
      cells.push({ date, state: "before", minutes: 0, level: 0 });
    } else {
      cells.push({ date, state: "missing", minutes: 0, level: 0 });
    }
  }
  return cells;
}

/**
 * 달력 격자 — 열 = 주, 행 = 요일(0=월 … 6=일). 첫 열의 시작 요일 앞은 `null` 로 비운다.
 *
 * 월요일 시작인 이유는 참고 디자인(Mon/Wed/Fri 라벨)과 현장 주 단위가 그렇기 때문이다.
 */
export function toWeekGrid(cells: CoverageCell[]): (CoverageCell | null)[][] {
  if (cells.length === 0) return [];
  const weeks: (CoverageCell | null)[][] = [];
  // JS getUTCDay: 0=일 … 6=토 → 0=월 … 6=일 로 옮긴다.
  const rowOf = (date: string) => (new Date(parseDay(date)).getUTCDay() + 6) % 7;

  let col: (CoverageCell | null)[] = Array.from({ length: 7 }, () => null);
  for (const cell of cells) {
    const row = rowOf(cell.date);
    if (row === 0 && col.some((c) => c !== null)) {
      weeks.push(col);
      col = Array.from({ length: 7 }, () => null);
    }
    col[row] = cell;
  }
  weeks.push(col);
  return weeks;
}

/** 각 열(주)의 첫 칸이 새 달의 첫 주면 그 달 라벨을 준다. 아니면 빈 문자열. */
export function monthLabels(weeks: (CoverageCell | null)[][]): string[] {
  let prev = "";
  return weeks.map((week) => {
    const first = week.find((c) => c !== null);
    if (!first) return "";
    const month = first.date.slice(0, 7);
    if (month === prev) return "";
    prev = month;
    return `${Number(first.date.slice(5, 7))}월`;
  });
}

/** 요약 — 화면 상단에 적는다. 색만으로 읽게 두지 않기 위한 수치다. */
export function summarizeCoverage(cells: CoverageCell[]) {
  const covered = cells.filter((c) => c.state === "covered");
  const missing = cells.filter((c) => c.state === "missing").length;
  const totalMinutes = covered.reduce((a, c) => a + c.minutes, 0);
  return {
    coveredDays: covered.length,
    missingDays: missing,
    beforeDays: cells.length - covered.length - missing,
    totalMinutes,
    /** 운영 기간(운영 이전 제외) 대비 수집일 비율. 운영 기간이 0이면 null — 0% 가 아니다. */
    rate:
      covered.length + missing === 0 ? null : covered.length / (covered.length + missing),
  };
}
