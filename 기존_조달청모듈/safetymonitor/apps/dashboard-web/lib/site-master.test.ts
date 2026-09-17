import assert from "node:assert/strict";
import { test } from "node:test";

import { appJwt, CONTRACT, DAY, harness, input, MAIN, request, sitesRequest, snapshot, source } from "./site-test-harness";

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

test("GET sites: contractor 세션은 관리자 메뉴 권한과 무관하게 배정 목록만 200으로 반환한다", async () => {
  for (const adminAccess of [false, true]) {
    const h = harness();
    h.state.adminAccess = adminAccess;
    await h.db.assignSite("test.worker", CONTRACT, "fixture-owner");
    const req = sitesRequest(h.auth.createSession("admin", "test.worker", "contractor"));
    assert.equal(h.auth.getSession(req)?.orgType, "contractor");
    assert.equal(h.auth.verifyBasicAuth(req), false);
    assert.equal(appJwt.verifyAppJwt(appJwt.bearerToken(req)), null);
    const response = await h.sitesRoute.GET(req);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, sites: await h.db.listAssignedSites("test.worker") });
    assert.deepEqual(h.state.userLookups, []);
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
