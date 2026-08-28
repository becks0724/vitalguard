// 다건 INSERT 문 조립 — 건별 왕복을 한 왕복으로 접기 위한 순수 빌더(DB 접근 없음).
//
// 왜 필요한가 — 2026-08-28. 폰이 500건 배치를 보내면 서버가 건당 33ms 로 순차 INSERT 해
// 16.5초가 걸렸고, 폰 타임아웃 15초를 넘겨 **매번 실패**했다. 폰은 큐를 안 비우고 같은 500건을
// 재전송하고, 서버는 끝까지 처리해 201 을 쓰지만 받는 사람이 없다 — 스스로 못 빠져나오는
// 고착 루프다(장우진 20분 무수신). 왕복 수가 원인이므로 왕복을 접는다.
//
// db.ts 의 `q` 를 안 건드리도록 순수 함수로 분리했다 — 문자열 조립만 하므로 DB 없이 시험된다.

/** Postgres 한 문(statement)의 바인드 파라미터 상한. */
export const PG_MAX_BIND_PARAMS = 65_535;

/**
 * 한 문에 담을 행 수. 파라미터 개수 = 행 수 × 컬럼 수 이므로 컬럼이 늘면 자동으로 쪼개진다.
 *
 * ★ 상수로 박지 않는 이유 — `vital_samples` 는 컬럼이 계속 늘어온 테이블이다(현재 55개).
 * "500건이면 된다"를 박아 두면 컬럼이 늘어난 어느 날 상한을 조용히 넘는다.
 *
 * @param columnCount 행당 컬럼 수(≥1)
 * @param budget 쓸 파라미터 예산 — 기본은 상한에 여유를 둔 값
 */
export function chunkSizeFor(columnCount: number, budget = 60_000): number {
  if (!Number.isFinite(columnCount) || columnCount < 1) {
    throw new Error(`컬럼 수가 잘못됐습니다: ${columnCount}`);
  }
  return Math.max(1, Math.floor(budget / columnCount));
}

/**
 * 다건 INSERT 문과 바인드 값을 만든다.
 *
 * 모든 행이 `keys` 순서로 값을 낸다. 행에 없는 키는 null 로 채운다 — 행마다 컬럼 집합이
 * 다르면 VALUES 개수가 어긋나 문 자체가 깨지므로, 빈자리를 명시적으로 메운다.
 *
 * @param table 대상 테이블
 * @param keys 컬럼 이름(순서 고정)
 * @param rows 행별 값 맵
 * @param suffix `ON CONFLICT ... DO NOTHING` 같은 꼬리말(그대로 이어 붙인다)
 */
export function buildBulkInsert(
  table: string,
  keys: string[],
  rows: Record<string, unknown>[],
  suffix = "",
): { text: string; values: unknown[] } {
  if (keys.length === 0) throw new Error("컬럼이 없습니다");
  if (rows.length === 0) throw new Error("행이 없습니다");

  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = keys.map((k) => {
      values.push(row[k] ?? null);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const text =
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES ${tuples.join(", ")}` +
    (suffix ? ` ${suffix}` : "");
  return { text, values };
}
