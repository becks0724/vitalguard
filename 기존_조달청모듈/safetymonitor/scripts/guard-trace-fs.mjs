// `node:fs` 대체 shim — 읽기 계열만 감싸 경로를 기록하고, 나머지는 그대로 다시 내보낸다
//
// ⚠ 원본을 부를 때 반드시 `?guard-trace-real` 을 붙인다 — 안 붙이면 훅이 이 파일로 되돌려
//   무한 재귀가 된다.
import * as real from "node:fs?guard-trace-real";

const OUT = process.env.GUARD_TRACE_OUT;
const seen = new Set();

function note(kind, target) {
  if (!OUT) return;
  let p;
  if (typeof target === "string") p = target;
  else if (target instanceof URL) p = target.pathname;
  else return;
  if (!p.startsWith("/")) return;
  const line = `${kind}\t${p}`;
  if (seen.has(line)) return;
  seen.add(line);
  try {
    real.appendFileSync(OUT, line + "\n");
  } catch {
    /* 추적 실패가 테스트를 죽이면 안 된다 */
  }
}

/** 읽기 계열만 감싼다 — 쓰기·삭제는 건드리지 않는다(추적 도구가 부작용을 만들면 안 된다). */
const TRACED = ["readFileSync", "existsSync", "readdirSync", "statSync", "openSync"];

const wrapped = {};
for (const [k, v] of Object.entries(real)) {
  wrapped[k] = TRACED.includes(k) && typeof v === "function"
    ? (target, ...rest) => {
        note(k, target);
        return v(target, ...rest);
      }
    : v;
}

export const readFileSync = wrapped.readFileSync;
export const existsSync = wrapped.existsSync;
export const readdirSync = wrapped.readdirSync;
export const statSync = wrapped.statSync;
export const openSync = wrapped.openSync;
export const promises = real.promises;
export default wrapped;

// 나머지 네임드 export 는 재수출한다 — 빠뜨리면 그 이름을 쓰는 모듈이 죽는다.
export * from "node:fs?guard-trace-real";
