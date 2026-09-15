// 실제 DB 함수·라우트·세션/앱 JWT 인증을 실행한다. DB 입출력만 대역으로 바꾸며 실 DB 접속은 허용하지 않는다.
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import * as clientIp from "./client-ip";
import type * as Db from "./db";
import * as orgType from "./org-type";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const source = read("lib/db.ts");
const ast = ts.createSourceFile("db.ts", source, ts.ScriptTarget.Latest, true);
const names = ["listSites", "getSite", "getCurrentSite", "setCurrentSite", "getLatestSiteInfo", "persistSiteInfoDaily", "ymdInKst"];
const selected = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""));
assert.equal(selected.length, names.length, "실제 현장 함수 추출 누락");
const cache = new Map<string, string>();
function execute<T>(code: string, globals: Record<string, unknown>): T {
  if (!cache.has(code)) cache.set(code, ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const module = { exports: {} };
  runInNewContext(cache.get(code)!, { module, exports: module.exports, ...globals });
  return module.exports as T;
}

// 운영 환경변수와 분리된 키로 실제 토큰을 발급한다. 인증 함수의 성공/실패는 모킹하지 않는다.
const authGlobals = {
  Buffer,
  process: { env: {
    ADMIN_ID: "fixture-owner", ADMIN_PASSWORD: "test-sites-admin-password", APP_JWT_SECRET: "test-sites-jwt-secret",
  } },
  require: (name: string) => {
    if (name === "node:crypto") return crypto;
    assert.fail(`허용하지 않은 인증 의존성: ${name}`);
  },
};
const sessionJwt = execute<typeof import("./session-jwt")>(read("lib/session-jwt.ts"), authGlobals);
const appJwt = execute<typeof import("./app-jwt")>(read("lib/app-jwt.ts"), authGlobals);

type SiteDb = Pick<typeof Db, "listSites" | "getSite" | "getCurrentSite" | "setCurrentSite" | "getLatestSiteInfo" | "persistSiteInfoDaily">;
type SiteRoute = { GET(request: Request): Promise<Response>; POST(request: Request): Promise<Response>; PUT(request: Request): Promise<Response> };
const MAIN = "SITE-SMARTHRD-2026";
const CONTRACT = "R26TE13895124";
const DAY = "2026-09-15";
function site(siteId: string, sortOrder: number, active = true): Db.SiteRow {
  return { site_id: siteId, ui_key: `ui-${siteId}`, kind: "main", label: `현장 ${siteId}`,
    company_name: "마스터 회사", site_name: `현장 ${siteId}`, construction_type: "건축",
    address: "마스터 주소", start_date: "2026-01-02", completion_date: "2027-06-30",
    sort_order: sortOrder, active, created_at: "2026-09-01T00:00:00.000Z" };
}
function input(siteId = MAIN, address = "사람이 수정한 주소"): Db.SiteInfoInput {
  return { siteId, companyName: "수정 회사", siteName: "수정 현장", constructionType: "건축 (신축)",
    address, startDate: "2026-03-24", completionDate: "2026-10-06" };
}
function snapshot(siteId = MAIN, date = DAY): Db.SiteInfoRow {
  return { id: 1, site_id: siteId, snapshot_date: date, recorded_at: `${date}T00:00:00.000Z`,
    company_name: "수정 회사", site_name: "수정 현장", construction_type: "건축 (신축)",
    address: "광주광역시 동구 중앙로 196", start_date: "2026-03-24", completion_date: "2026-10-06" };
}
function request(method = "GET", body?: unknown, token: string | null = "web-alice") {
  if (token?.startsWith("web-")) {
    token = sessionJwt.signSessionJwt({ sub: token.slice(4), role: "admin", orgType: "vitalguard" });
  } else if (token?.startsWith("app-")) {
    token = appJwt.signAppJwt({ sub: token.slice(4), role: "worker", name: null, workerId: "fixture-worker" });
  }
  return new Request("http://fixture.test/api/admin/site-info", {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function sitesRequest(token: string | null, scheme = "Bearer") {
  return new Request("http://fixture.test/api/sites", {
    headers: token ? { authorization: `${scheme} ${token}` } : {},
  });
}

function harness() {
  const state = {
    sites: [site(CONTRACT, 20), site("inactive", -1, false), site(MAIN, 0), site("B", 10), site("A", 10)],
    snapshots: [] as Db.SiteInfoRow[], current: [] as Db.CurrentSiteRow[],
    queries: [] as { sql: string; params: unknown[] }[],
    userLookups: [] as string[],
    adminAccess: true, failSnapshot: false, failSelection: false, tick: 0,
  };
  const query = async (raw: string, params: unknown[] = []) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    state.queries.push({ sql, params: structuredClone(params) });
    const now = `${DAY}T03:00:${String(state.tick++).padStart(2, "0")}.000Z`;
    if (sql.startsWith("SELECT * FROM site WHERE active")) {
      assert.match(sql, /WHERE active = TRUE ORDER BY sort_order, site_id$/);
      return { rows: state.sites.filter((row) => row.active).sort((a, b) => a.sort_order - b.sort_order || a.site_id.localeCompare(b.site_id)) };
    }
    if (sql === "SELECT * FROM site WHERE site_id = $1") {
      return { rows: state.sites.filter((row) => row.site_id === params[0]) };
    }
    if (sql === "SELECT * FROM user_current_site WHERE username = $1") {
      return { rows: state.current.filter((row) => row.username === params[0]) };
    }
    if (sql.startsWith("INSERT INTO user_current_site")) {
      assert.match(sql, /ON CONFLICT \(username\) DO UPDATE SET site_id = excluded.site_id, selected_at = excluded.selected_at RETURNING \*/);
      if (state.failSelection) throw new Error("검증용 선택 저장 실패");
      assert.ok(state.sites.some((row) => row.site_id === params[1]), "현장 외래키 위반");
      const row = { username: String(params[0]), site_id: String(params[1]), selected_at: now };
      state.current = [...state.current.filter((old) => old.username !== row.username), row];
      return { rows: [row] };
    }
    if (sql.startsWith("SELECT * FROM site_info_daily")) {
      assert.match(sql, /ORDER BY snapshot_date DESC, recorded_at DESC/);
      const rows = state.snapshots.filter((row) => !sql.includes("WHERE") || row.site_id === params[0]);
      if (params.length) assert.match(sql, /WHERE site_id = \$1/);
      return { rows: rows.sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date) ||
        b.recorded_at.localeCompare(a.recorded_at) || b.id - a.id).slice(0, 1) };
    }
    if (sql.startsWith("INSERT INTO site_info_daily")) {
      assert.match(sql, /ON CONFLICT \(snapshot_date, site_id\) DO UPDATE SET/);
      if (state.failSnapshot) throw new Error("검증용 snapshot 저장 실패");
      const columns = sql.match(/INSERT INTO site_info_daily \(([^)]+)\)/)![1]!.split(",").map((part) => part.trim());
      const values = Object.fromEntries(columns.map((column, index) => [column, column === "recorded_at" ? now : params[index]]));
      const old = state.snapshots.find((row) => row.snapshot_date === values.snapshot_date && row.site_id === values.site_id);
      const row = { id: old?.id ?? state.snapshots.length + 1, ...values } as Db.SiteInfoRow;
      state.snapshots = [...state.snapshots.filter((item) => item !== old), row];
      return { rows: [row] };
    }
    assert.fail(`허용하지 않은 SQL: ${sql}`);
  };
  class FixedDate extends Date {
    constructor(value?: string | number) { super(value ?? `${DAY}T16:00:00.000Z`); } // KST는 다음 날이다.
  }
  const db = execute<SiteDb>(selected.map((node) => node.getText(ast)).join("\n"), {
    q: query, NOW_ISO: "fixture_now()", Date: FixedDate,
  });
  const auth = execute<typeof import("./admin-auth")>(read("lib/admin-auth.ts"), {
    ...authGlobals,
    require: (name: string) => {
      if (name === "./session-jwt") return sessionJwt;
      if (name === "./client-ip") return clientIp;
      if (name === "./org-type") return orgType;
      if (name === "./db") return {
        findUserByUsername: async (username: string) => {
          state.userLookups.push(username);
          return { username, role: "admin", status: "approved", admin_access: state.adminAccess };
        },
      };
      return authGlobals.require(name);
    },
  });
  const loadRoute = (path: string) => execute<SiteRoute>(read(path), {
    require: (name: string) => {
      if (name === "next/server") return { NextResponse };
      if (name.endsWith("/admin-auth")) return auth;
      if (name.endsWith("/app-jwt")) return appJwt;
      if (name.endsWith("/db")) return db;
      assert.fail(`실 DB/통신을 허용하지 않은 의존성: ${name}`);
    },
  });
  return { state, db, auth, route: loadRoute("app/api/admin/site-info/route.ts"), sitesRoute: loadRoute("app/api/sites/route.ts") };
}

test("listSites: active 현장만 sort_order·site_id 순서로 반환한다", async () => {
  const h = harness();
  assert.deepEqual((await h.db.listSites()).map((row) => row.site_id), [MAIN, "A", "B", CONTRACT]);
});

test("현재 현장: 사용자별 왕복·재선택 upsert·선택 시각 갱신", async () => {
  const h = harness();
  assert.equal(await h.db.getCurrentSite("alice"), null);
  const first = await h.db.setCurrentSite("alice", MAIN);
  await h.db.setCurrentSite("bob", MAIN);
  const second = await h.db.setCurrentSite("alice", CONTRACT);
  assert.equal((await h.db.getCurrentSite("alice"))?.site_id, CONTRACT);
  assert.equal((await h.db.getCurrentSite("bob"))?.site_id, MAIN);
  assert.notEqual(first.selected_at, second.selected_at);
  assert.equal(h.state.current.length, 2);
});

test("getLatestSiteInfo: 현장별 최신·전체 최신·없는 현장 null", async () => {
  const h = harness();
  h.state.snapshots = [snapshot(MAIN, "2026-09-13"), { ...snapshot(MAIN, "2026-09-14"), id: 2 },
    { ...snapshot(CONTRACT), id: 3 }, { ...snapshot(CONTRACT), id: 4, recorded_at: `${DAY}T03:00:00.000Z` }];
  assert.equal((await h.db.getLatestSiteInfo(MAIN))?.id, 2);
  assert.equal((await h.db.getLatestSiteInfo())?.id, 4);
  assert.equal(await h.db.getLatestSiteInfo("없는 현장"), null);
});

test("persistSiteInfoDaily: 같은 날 다른 현장은 새 행, 같은 현장은 갱신한다", async () => {
  const h = harness();
  const first = await h.db.persistSiteInfoDaily(input());
  const second = await h.db.persistSiteInfoDaily(input(CONTRACT, "계약현장 주소"));
  const updated = await h.db.persistSiteInfoDaily(input(MAIN, "수정한 메인 주소"));
  assert.equal(h.state.snapshots.length, 2);
  assert.notEqual(first.id, second.id);
  assert.equal(first.id, updated.id);
  assert.equal((await h.db.getLatestSiteInfo(CONTRACT))?.address, "계약현장 주소");
  assert.equal(updated.address, "수정한 메인 주소");
  assert.equal(updated.snapshot_date, "2026-09-16", "일일 snapshot은 KST 날짜를 쓴다");
  assert.equal(updated.company_name, "수정 회사");
  assert.equal(updated.site_name, "수정 현장");
  assert.equal(updated.construction_type, "건축 (신축)");
  assert.equal(updated.start_date, "2026-03-24");
  assert.equal(updated.completion_date, "2026-10-06");
});

for (const token of ["web-alice", "app-alice"]) {
  test(`GET site-info: ${token}의 user_current_site가 전체 최신보다 우선하며 site_id를 반환한다`, async () => {
    const h = harness();
    h.state.snapshots = [snapshot(MAIN, "2026-09-14"), snapshot(CONTRACT)];
    await h.db.setCurrentSite("alice", MAIN);
    await h.db.setCurrentSite("bob", CONTRACT);
    const response = await h.route.GET(request("GET", undefined, token));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.siteInfo.site_id, MAIN);
    assert.equal(body.siteInfo.address, "광주광역시 동구 중앙로 196");
  });
}

test("GET site-info: 사용자 선택이 없으면 전체 최신으로 폴백한다", async () => {
  const h = harness();
  h.state.snapshots = [snapshot(MAIN, "2026-09-14"), snapshot(CONTRACT)];
  assert.equal((await (await h.route.GET(request())).json()).siteInfo.site_id, CONTRACT);
});

test("GET site-info: 선택한 현장의 snapshot이 없으면 그 현장 마스터를 반환한다", async () => {
  const h = harness();
  h.state.snapshots = [snapshot(CONTRACT)];
  await h.db.setCurrentSite("alice", MAIN);
  const body = await (await h.route.GET(request())).json();
  assert.equal(body.siteInfo.site_id, MAIN);
  assert.equal(body.siteInfo.address, "마스터 주소");
});

test("POST site-info: DB 현장 ID와 인증된 username으로 snapshot·선택을 함께 저장한다", async () => {
  const h = harness();
  const response = await h.route.POST(request("POST", { ...input(CONTRACT), username: "bob" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).siteInfo.site_id, CONTRACT);
  assert.equal((await h.db.getCurrentSite("alice"))?.site_id, CONTRACT);
  assert.equal(await h.db.getCurrentSite("bob"), null);
});

test("로그인 선택: 다른 현장을 거쳐 재선택해도 수동 수정값·과거 행은 보존한다", async () => {
  const h = harness();
  const previous = snapshot(MAIN, "2026-09-14");
  h.state.snapshots = [structuredClone(previous)];
  for (const siteId of [MAIN, CONTRACT, MAIN]) {
    const response = await h.route.POST(request("POST", { ...input(siteId, "코드 프리셋 주소"), selectOnly: true }));
    assert.equal(response.status, 200);
  }
  assert.deepEqual(h.state.snapshots.find((row) => row.id === previous.id), previous);
  assert.equal((await h.db.getLatestSiteInfo(MAIN))?.address, previous.address);
  assert.equal((await h.db.getLatestSiteInfo(CONTRACT))?.address, "마스터 주소");
});

test("일반 로그인 사용자는 같은 세션으로 현장 목록을 조회·선택할 수 있고 공용 정보 편집은 거부된다", async () => {
  const h = harness();
  h.state.adminAccess = false;
  const token = h.auth.createSession("admin", "test.jodal", "jodal");
  const response = await h.sitesRoute.GET(sitesRequest(token));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sites, await h.db.listSites());
  assert.equal((await h.route.POST(request("POST", { ...input(), selectOnly: true }, token))).status, 200);
  assert.equal((await h.db.getCurrentSite("test.jodal"))?.site_id, MAIN);
  assert.equal((await h.db.getLatestSiteInfo(MAIN))?.address, "마스터 주소");
  assert.equal((await h.route.POST(request("POST", input(), token))).status, 401);
  assert.equal((await h.route.PUT(request("PUT", { ...input(), selectOnly: true }, token))).status, 401);
});

test("기존 PUT: siteId가 빠져도 사용자의 현재 현장을 편집하고 다른 현장은 보존한다", async () => {
  const h = harness();
  h.state.snapshots = [snapshot(MAIN), snapshot(CONTRACT, "2026-09-14")];
  await h.db.setCurrentSite("alice", CONTRACT);
  const { siteId: _siteId, ...legacy } = input(CONTRACT, "관리자 편집 주소");
  const response = await h.route.PUT(request("PUT", legacy));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).siteInfo.site_id, CONTRACT);
  assert.equal((await h.db.getLatestSiteInfo(CONTRACT))?.address, legacy.address);
  assert.equal((await h.db.getLatestSiteInfo(MAIN))?.address, "광주광역시 동구 중앙로 196");
});

test("POST: 본문 오류·siteId 누락·ui_key·없는 현장·비활성 현장은 쓰기 전에 거부한다", async () => {
  const h = harness();
  for (const body of [null, [], {}, { siteId: " " }, { siteId: "main" }, { siteId: "없는 현장" }, { siteId: "inactive" }]) {
    assert.equal((await h.route.POST(request("POST", body))).status, 400);
  }
  const malformed = new Request("http://fixture.test/api/admin/site-info", { method: "POST",
    headers: { authorization: `Bearer ${h.auth.createSession("admin", "alice", "vitalguard")}` }, body: "{" });
  assert.equal((await h.route.POST(malformed)).status, 400);
  assert.equal(h.state.snapshots.length + h.state.current.length, 0);
});

test("GET sites·GET/POST/PUT site-info: 인증 없이는 401이며 데이터 쿼리가 없다", async () => {
  const h = harness();
  assert.equal((await h.sitesRoute.GET(request("GET", undefined, null))).status, 401);
  for (const method of ["GET", "POST", "PUT"] as const) {
    assert.equal((await h.route[method](request(method, undefined, null))).status, 401);
  }
  assert.equal(h.state.queries.length, 0);
});

for (const role of ["owner", "admin"] as const) {
  test(`GET sites: 관제웹 ${role} 세션만 있고 앱 JWT가 없으면 200과 DB 목록을 반환한다`, async () => {
    const h = harness();
    const token = h.auth.createSession(role, "alice", "vitalguard");
    const req = sitesRequest(token);
    assert.equal(appJwt.verifyAppJwt(appJwt.bearerToken(req)), null);
    assert.equal(h.auth.getSession(req)?.username, "alice");
    const response = await h.sitesRoute.GET(req);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.sites, await h.db.listSites());
    assert.deepEqual(h.state.userLookups, []);
  });
}

test("GET sites: 앱 JWT만 있으면 웹 권한 조회 없이 200과 DB 목록을 반환한다", async () => {
  const h = harness();
  h.state.adminAccess = false;
  const token = appJwt.signAppJwt({ sub: "alice", role: "worker", name: null, workerId: "fixture-worker" });
  const req = sitesRequest(token);
  assert.equal(h.auth.getSession(req), null);
  const response = await h.sitesRoute.GET(req);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.sites, await h.db.listSites());
  assert.deepEqual(h.state.userLookups, []);
});

test("GET sites: 웹 세션과 앱 JWT가 모두 없거나 유효하지 않으면 401이고 DB를 조회하지 않는다", async () => {
  const h = harness();
  const token = h.auth.createSession("admin", "alice", "vitalguard");
  for (const invalid of [null, "invalid-token", `${token}tampered`]) {
    const response = await h.sitesRoute.GET(sitesRequest(invalid));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "인증 필요" });
  }
  assert.equal(h.state.queries.length + h.state.userLookups.length, 0);
});

test("GET sites: admin_access=false인 승인된 관제웹 세션은 200과 DB 목록을 반환한다", async () => {
  const h = harness();
  h.state.adminAccess = false;
  const req = sitesRequest(h.auth.createSession("admin", "test.jodal", "jodal"));
  assert.equal(h.auth.getSession(req)?.role, "admin");
  assert.equal(appJwt.verifyAppJwt(appJwt.bearerToken(req)), null);
  const response = await h.sitesRoute.GET(req);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.sites, await h.db.listSites());
  assert.deepEqual(h.state.userLookups, []);
  assert.ok(h.state.queries.every(({ sql }) => sql.startsWith("SELECT ")), "목록 조회는 쓰기를 하지 않는다");
});

test("GET sites: orgType이 없는 기존 관제웹 세션도 200과 DB 목록을 반환한다", async () => {
  const h = harness();
  h.state.adminAccess = false;
  const req = sitesRequest(h.auth.createSession("admin", "alice"));
  assert.equal(h.auth.getSession(req)?.orgType, undefined);
  const response = await h.sitesRoute.GET(req);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sites, await h.db.listSites());
  assert.deepEqual(h.state.userLookups, []);
});

test("GET sites: contractor 세션은 관리자 메뉴 권한과 무관하게 401이고 DB를 조회하지 않는다", async () => {
  for (const adminAccess of [false, true]) {
    const h = harness();
    h.state.adminAccess = adminAccess;
    const req = sitesRequest(h.auth.createSession("admin", "alice", "contractor"));
    assert.equal(h.auth.getSession(req)?.orgType, "contractor");
    assert.equal(h.auth.verifyBasicAuth(req), false);
    assert.equal(appJwt.verifyAppJwt(appJwt.bearerToken(req)), null);
    const response = await h.sitesRoute.GET(req);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "인증 필요" });
    assert.equal(h.state.queries.length + h.state.userLookups.length, 0);
  }
});

test("GET sites: 기존 Basic 세션과 직접 관리자 자격도 getSession으로 호환된다", async () => {
  const h = harness();
  for (const token of [h.auth.createSession("owner"), Buffer.from("fixture-owner:test-sites-admin-password").toString("base64")]) {
    assert.equal((await h.sitesRoute.GET(sitesRequest(token, "Basic"))).status, 200);
  }
  assert.deepEqual(h.state.userLookups, []);
});

test("저장 실패: snapshot 실패 뒤에는 선택하지 않고, 선택 실패도 성공으로 응답하지 않는다", async () => {
  const h = harness();
  h.state.failSnapshot = true;
  await assert.rejects(h.route.POST(request("POST", input())), /snapshot 저장 실패/);
  assert.equal(h.state.current.length, 0);
  h.state.failSnapshot = false;
  h.state.failSelection = true;
  await assert.rejects(h.route.POST(request("POST", input())), /선택 저장 실패/);
});

test("ensureSchema: NULL 백필 후 NOT NULL·날짜/현장 유일키로 전환하며 다른 컬럼은 갱신하지 않는다", () => {
  const start = source.indexOf("CREATE TABLE IF NOT EXISTS site (");
  const ddl = source.slice(start, source.indexOf("-- 현장 좌표 일별 캐시", start));
  assert.ok(start > 0);
  const statements = [
    "ALTER TABLE site_info_daily ADD COLUMN IF NOT EXISTS site_id TEXT",
    "UPDATE site_info_daily SET site_id = 'SITE-SMARTHRD-2026' WHERE site_id IS NULL",
    "ALTER TABLE site_info_daily ALTER COLUMN site_id SET NOT NULL",
    "ALTER TABLE site_info_daily DROP CONSTRAINT IF EXISTS site_info_daily_snapshot_date_key",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sid_date_site ON site_info_daily(snapshot_date, site_id)",
  ];
  let previous = -1;
  for (const statement of statements) {
    const index = ddl.indexOf(statement);
    assert.ok(index > previous, `마이그레이션 순서/문장 누락: ${statement}`);
    previous = index;
  }
  assert.deepEqual(ddl.match(/UPDATE site_info_daily[^;]+/g), [statements[1]]);
  assert.match(ddl, /site_id TEXT NOT NULL REFERENCES site\(site_id\)/);
  assert.match(ddl, /ON CONFLICT \(site_id\) DO NOTHING/);
  assert.doesNotMatch(ddl, /\bt_site\b|UPDATE (?:cctv_site|use_plan|calendar_media)/);
});
