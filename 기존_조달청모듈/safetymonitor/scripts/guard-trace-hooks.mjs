// 로더 훅 — `node:fs` 를 추적 shim 으로 바꿔치기한다(네임드 import 까지 잡기 위해)
//
// 재귀 방지 = shim 자신은 `node:fs?guard-trace-real` 로 원본을 부르고, 그 쿼리가 붙은 것은
// 훅이 그대로 통과시킨다. 이 표식이 없으면 shim 이 자기를 다시 로드해 스택이 터진다.
const REAL = "?guard-trace-real";

export async function resolve(specifier, context, next) {
  if (specifier === "node:fs" || specifier === "fs") {
    return {
      url: new URL("./guard-trace-fs.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === "node:fs" + REAL) {
    return { url: "node:fs", shortCircuit: true };
  }
  return next(specifier, context);
}
