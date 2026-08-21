// 텔레그램 발신 지점 허용목록 — 관문 우회의 일반형을 막는다
//
// 발단(2026-08-21 · docs/seam-contracts/findings.md K-1). 관문(recordAlert →
// notifyAlertTelegram)은 타입이 계약이지만, `sendTelegramMessage(자유 문자열)` 직접 발신은
// 지점별 각개 가드뿐이었다 — 전부 **자기 파일 안**만 봐서, 네 번째 발신 지점이 생기면
// 원장 기록 없이·마스킹 없이·수치 검토 없이 나가도 아무 가드도 빨개지지 않았다.
// 온열 알림이 관문을 우회해 발동 이력을 아무도 못 본 전례가 있는 자리다.
//
// 이 가드가 초록이면 보장되는 것(L-101③) — *텔레그램으로 나가는 문자열의 발신 지점
// 집합(파일·건수)이 아래 검토된 목록과 같다.* 새 지점을 만들려면 이 목록을 같은 커밋에서
// 고쳐야 하고, 그때 원장 기록·이름 마스킹·생체 수치 미포함(SEC-PRIV-01)을 검토하게 된다.
// 보장하지 않는 것 — 별칭 import(`as`)·재수출로 이름을 바꿔 부르는 우회(작정한 우회는
// 리뷰 몫이다) · 허용된 지점이 싣는 **내용**의 적정성(그건 지점별 전용 가드가 맡는다).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// 허용목록 — 파일별 등장 수까지 고정한다. 허용된 파일 안의 "둘째 발신"도 새 지점이다.
const ALLOWLIST: Record<string, number> = {
  "lib/telegram.ts": 2, // 정의 1 + 관문(notifyAlertTelegram) 내부 호출 1
  "app/api/app/vital/store.ts": 1, // 온열 경고 — recordAlert(notify:false) 동반 · heat-alert-boundary 가드
  "app/api/cron/absence-check/route.ts": 2, // 감시 공백 — recordAlert 동반 · absence-ledger 가드
  "lib/env-alert-notify.ts": 1, // 환경 경보 — env_alert_state 단계 전이가 dedup 원장
};

// 주석을 걷어낸 본문에서 센다 — 주석 처리된 옛 호출이 지점으로 잡히면 안 된다(L-83).
const bare = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

type SrcFile = { path: string; text: string };

// 스캔 대상 = 서버 코드 전체(app + lib · 테스트 제외). 디렉터리가 없으면 readdirSync 가
// 던진다 — 조용히 0개를 훑고 통과하는 것(L-79 · client-ip 가드의 existsSync 폴백 사고)이
// 이 가드의 최악 실패 모드라, 폴백을 일부러 두지 않는다.
function scanFiles(): SrcFile[] {
  const out: SrcFile[] = [];
  for (const dir of ["app", "lib"]) {
    for (const entry of readdirSync(join(ROOT, dir), { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      out.push({
        path: [dir, ...entry.split(sep)].join("/"),
        text: readFileSync(join(ROOT, dir, entry), "utf8"),
      });
    }
  }
  return out;
}

// 발신 지점 조사 — 파일 → `sendTelegramMessage(` 등장 수(0건 파일은 생략).
function census(files: SrcFile[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of files) {
    const n = [...bare(f.text).matchAll(/\bsendTelegramMessage\(/g)].length;
    if (n > 0) out[f.path] = n;
  }
  return out;
}

const files = scanFiles();

test("★ K 계약 — 발신 지점(파일·건수)이 허용목록과 정확히 같다", () => {
  assert.deepEqual(
    census(files),
    ALLOWLIST,
    "텔레그램 발신 지점이 허용목록과 다르다 — 새 지점이면 원장 기록·마스킹·수치 미포함을 검토하고 이 목록을 같은 커밋에서 고칠 것",
  );
});

test("스캔 바닥 — 훑은 파일이 충분히 많다 (0개 스캔 통과 금지)", () => {
  // 2026-08-21 실측 278개. 크게 줄었다면 스캐너가 눈먼 것이지 코드가 준 것이 아니다.
  assert.ok(files.length >= 200, `스캔 파일 ${files.length}개 — 스캐너가 눈멀었다`);
});

test("음성 대조 — 새 지점·둘째 발신·주석 처리를 조사가 가른다", () => {
  // 새 파일의 새 발신 지점을 잡는다.
  const ghost = census([...files, { path: "lib/ghost.ts", text: "await sendTelegramMessage(x);" }]);
  assert.equal(ghost["lib/ghost.ts"], 1, "조사가 심은 새 발신 지점을 못 본다");
  // 허용된 파일 안의 둘째 발신도 건수로 잡는다.
  const dup = census(
    files.map((f) =>
      f.path === "lib/env-alert-notify.ts"
        ? { ...f, text: f.text + "\nawait sendTelegramMessage(extra);\n" }
        : f,
    ),
  );
  assert.equal(dup["lib/env-alert-notify.ts"], 2, "허용 파일 안의 둘째 발신을 못 본다");
  // 주석 처리된 호출은 지점이 아니다.
  const commented = census([{ path: "x.ts", text: "// await sendTelegramMessage(x);" }]);
  assert.equal(commented["x.ts"], undefined, "주석 처리된 호출을 지점으로 센다");
});
