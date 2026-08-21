// 테스트가 실제로 읽는 파일을 실행 중에 관찰한다 — guard-read-paths.mjs 가 --import 로 얹는다
//
// ★ 왜 정적 파싱이 아닌가. 가드는 경로를 `join(ROOT, "..", "vitalguard_app", …)` 처럼 조립하고
//   ROOT 자체도 계산된다. 소스에서 경로를 맞히는 것은 추론이고, 이 레포는 추론으로 여러 번
//   틀렸다. 실행시켜 **무엇을 열었는지 직접 묻는다**.
//
// ★★ 왜 몽키패치가 아니라 로더 훅인가 — **실측으로 갈렸다**.
//   `fs.readFileSync = wrapped` 는 `import fs from "node:fs"; fs.readFileSync(...)` 만 잡고
//   **`import { readFileSync } from "node:fs"` 는 못 잡는다**(네임드 바인딩이 링크 시점에
//   원본으로 굳는다). 확인 = /etc/passwd 는 잡히고 /etc/hosts 는 안 잡혔다.
//   그런데 이 레포의 가드는 **전부 네임드 import** 라 몽키패치로는 0건을 내고,
//   0건은 "아무것도 안 읽는다" 로 조용히 오독된다(2026-08-20 에 같은 형태로 당한 적 있다).
//   ⟹ `node:fs` 스펙파이어를 **shim 으로 갈아끼워** 네임드 export 자체를 우리 것으로 만든다.
import { register } from "node:module";

// ⚠ `pathToFileURL(url.pathname)` 로 감싸면 안 된다 — 한글 경로가 **이중 인코딩**돼
//   ERR_MODULE_NOT_FOUND 가 난다(작성 중 실제로 났다). URL 을 그대로 넘긴다.
if (process.env.GUARD_TRACE_OUT) {
  register(new URL("./guard-trace-hooks.mjs", import.meta.url));
}
