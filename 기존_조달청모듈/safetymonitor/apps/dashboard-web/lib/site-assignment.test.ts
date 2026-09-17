// D-5: site-master와 같은 실제 함수·라우트·토큰 하네스이며 실 DB에는 접속하지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { appJwt, CONTRACT, harness, input, MAIN, mobileToken, request, sitesRequest, snapshot, source } from "./site-test-harness";

const WORKER = "test.worker";
const WORKER_ID = 4;
const OWNER = "fixture-owner";
const assignmentBody = (action = "assign_site", siteId: unknown = CONTRACT, id = WORKER_ID) => ({ id, action, siteId });
const writes = (h: ReturnType<typeof harness>) => h.state.queries.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));
const contractorSession = (h: ReturnType<typeof harness>) => h.auth.createSession("admin", WORKER, "contractor");

test("ensureSchema: site 바로 뒤에 멱등 배정 표·복합 PK·현장 FK·기본 배정 시각을 둔다", () => {
  const ddl = source.match(/CREATE TABLE IF NOT EXISTS site \([\s\S]+?\);\s*CREATE TABLE IF NOT EXISTS user_site_assignment \(([\s\S]+?)\);/);
  assert.ok(ddl, "배정 표는 site DDL 바로 뒤에서 생성해야 한다");
  assert.match(ddl[1]!, /username TEXT NOT NULL/);
  assert.match(ddl[1]!, /site_id TEXT NOT NULL REFERENCES site\(site_id\)/);
  assert.match(ddl[1]!, /assigned_at TEXT NOT NULL DEFAULT \(\$\{NOW_ISO\}\)/);
  assert.match(ddl[1]!, /assigned_by TEXT,/);
  assert.match(ddl[1]!, /PRIMARY KEY \(username, site_id\)/);
});

test("assignSite: 배정자·시각을 기록하며 중복 배정은 true이고 최초 기록을 보존한다", async () => {
  const h = harness();
  assert.equal(await h.db.assignSite(WORKER, CONTRACT, OWNER), true);
  const first = structuredClone(h.state.assignments[0]);
  assert.equal(first?.assigned_by, OWNER);
  assert.ok(first?.assigned_at);
  assert.equal(await h.db.assignSite(WORKER, CONTRACT, "다른 관리자"), true);
  assert.deepEqual(h.state.assignments, [first]);
  assert.deepEqual((await h.db.listAssignedSites(WORKER)).map((site) => site.site_id), [CONTRACT]);
});

test("unassignSite: 사용자·현장 쌍만 해제하며 실제 삭제 여부를 반환한다", async () => {
  const h = harness();
  await h.db.assignSite(WORKER, MAIN, OWNER);
  await h.db.assignSite(WORKER, CONTRACT, OWNER);
  await h.db.assignSite("bob", MAIN, OWNER);
  assert.equal(await h.db.unassignSite(WORKER, MAIN), true);
  assert.equal(await h.db.unassignSite(WORKER, MAIN), false);
  assert.equal(await h.db.unassignSite(WORKER, "없는 현장"), false);
  assert.deepEqual((await h.db.listAssignedSites(WORKER)).map((site) => site.site_id), [CONTRACT]);
  assert.deepEqual((await h.db.listAssignedSites("bob")).map((site) => site.site_id), [MAIN]);
});

for (const siteId of ["없는 현장", "inactive"]) {
  test(`assignSite: ${siteId}은 false이며 배정을 쓰지 않는다`, async () => {
    const h = harness();
    assert.equal(await h.db.assignSite(WORKER, siteId, OWNER), false);
    assert.deepEqual(writes(h), []);
  });
}

test("listAssignedSites: 자기 active 배정만 sort_order·site_id 순서로 반환한다", async () => {
  const h = harness();
  for (const siteId of [CONTRACT, "B", "A"]) await h.db.assignSite(WORKER, siteId, OWNER);
  await h.db.assignSite("bob", MAIN, OWNER);
  h.state.sites.find((site) => site.site_id === CONTRACT)!.active = false;
  assert.deepEqual((await h.db.listAssignedSites(WORKER)).map((site) => site.site_id), ["A", "B"]);
  assert.deepEqual(await h.db.listAssignedSites("미배정 사용자"), []);
});

test("getUserOrgType: 현재 users.org_type을 읽고 없는 사용자는 null이다", async () => {
  const h = harness();
  assert.equal(await h.db.getUserOrgType(WORKER), "contractor");
  h.state.users.find((user) => user.username === WORKER)!.org_type = "kosha";
  assert.equal(await h.db.getUserOrgType(WORKER), "kosha");
  assert.equal(await h.db.getUserOrgType("없는 사용자"), null);
  assert.deepEqual(writes(h), []);
});

for (const action of ["assign_site", "unassign_site"]) {
  test(`${action}: 미인증·관리 권한 없음·contractor 자가취득은 401이다`, async () => {
    const h = harness();
    const usersRoute = h.loadRoute("app/api/admin/users/route.ts");
    for (const token of [null, "invalid-token", contractorSession(h), mobileToken(WORKER, "owner")]) {
      assert.equal((await usersRoute.POST(request("POST", assignmentBody(action), token))).status, 401);
    }
    h.state.adminAccess = false;
    assert.equal((await usersRoute.POST(request("POST", assignmentBody(action)))).status, 401);
    assert.deepEqual(writes(h), []);
    assert.deepEqual(h.state.queries, [], "관리 권한 검사 뒤에서만 배정 데이터를 읽는다");
  });

  test(`${action}: 없는 사용자는 404이며 배정을 쓰지 않는다`, async () => {
    const h = harness();
    const usersRoute = h.loadRoute("app/api/admin/users/route.ts");
    const response = await usersRoute.POST(request("POST", assignmentBody(action, CONTRACT, 999), h.auth.createSession()));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: "사용자를 찾을 수 없습니다." });
    assert.deepEqual(writes(h), []);
  });

  test(`${action}: 없는 현장은 404이며 배정을 쓰지 않는다`, async () => {
    const h = harness();
    const usersRoute = h.loadRoute("app/api/admin/users/route.ts");
    assert.equal((await usersRoute.POST(request("POST", assignmentBody(action, "없는 현장"), h.auth.createSession()))).status, 404);
    assert.deepEqual(writes(h), []);
  });

  test(`${action}: 누락·빈 값·문자열 아닌 siteId는 400이다`, async () => {
    const h = harness();
    const usersRoute = h.loadRoute("app/api/admin/users/route.ts");
    for (const body of [{ id: WORKER_ID, action }, ...[null, "", "  ", 1, true, [], {}].map((siteId) => assignmentBody(action, siteId))]) {
      assert.equal((await usersRoute.POST(request("POST", body, h.auth.createSession()))).status, 400);
    }
    assert.deepEqual(h.state.queries, []);
  });
}

for (const actor of [OWNER, "alice"]) {
  test(`assign_site: ${actor} 관리 권한으로 200·공개 사용자·assignedSites를 반환한다`, async () => {
    const h = harness();
    const usersRoute = h.loadRoute("app/api/admin/users/route.ts");
    const token = actor === OWNER ? h.auth.createSession() : h.auth.createSession("admin", actor, "vitalguard");
    const original = structuredClone(h.state.users);
    const response = await usersRoute.POST(request("POST", { ...assignmentBody("assign_site", ` ${CONTRACT} `), assignedBy: "위조 배정자", username: "bob" }, token));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.user.id, WORKER_ID);
    assert.equal(body.user.username, WORKER);
    assert.deepEqual(body.assignedSites, await h.db.listAssignedSites(WORKER));
    for (const field of ["password_hash", "google_sub", "totp_secret", "totp_last_step"]) assert.equal(Object.hasOwn(body.user, field), false);
    assert.equal(h.state.assignments[0]?.assigned_by, actor);
    assert.equal(h.state.assignments[0]?.username, WORKER);
    assert.deepEqual(h.state.users, original);
    assert.equal(h.state.current.length + h.state.snapshots.length, 0);
  });
}

test("assign_site: inactive는 404이고 중복 요청은 200으로 최초 배정을 보존한다", async () => {
  const h = harness();
  const usersRoute = h.loadRoute("app/api/admin/users/route.ts");
  const token = h.auth.createSession();
  assert.equal((await usersRoute.POST(request("POST", assignmentBody("assign_site", "inactive"), token))).status, 404);
  assert.equal((await usersRoute.POST(request("POST", assignmentBody(), token))).status, 200);
  const first = structuredClone(h.state.assignments);
  assert.equal((await usersRoute.POST(request("POST", assignmentBody(), token))).status, 200);
  assert.deepEqual(h.state.assignments, first);
});

test("unassign_site: 비활성 배정도 해제하고 재요청은 빈 assignedSites와 200이다", async () => {
  const h = harness();
  const usersRoute = h.loadRoute("app/api/admin/users/route.ts");
  await h.db.assignSite(WORKER, CONTRACT, OWNER);
  h.state.sites.find((site) => site.site_id === CONTRACT)!.active = false;
  for (let i = 0; i < 2; i++) {
    const response = await usersRoute.POST(request("POST", assignmentBody("unassign_site"), h.auth.createSession()));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.username, WORKER);
    assert.deepEqual(body.assignedSites, []);
  }
  assert.deepEqual(h.state.assignments, []);
});

test("사용자 액션 400 안내는 assign_site·unassign_site를 포함한다", async () => {
  const h = harness();
  const response = await h.loadRoute("app/api/admin/users/route.ts").POST(request("POST", { id: WORKER_ID, action: "unknown" }, h.auth.createSession()));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /\bassign_site\|unassign_site\b/);
});

test("GET sites: contractor 웹 세션에는 자기 배정만 반환하고 같은 회사의 미배정 현장은 숨긴다", async () => {
  const h = harness();
  h.state.adminAccess = false;
  await h.db.assignSite(WORKER, CONTRACT, OWNER);
  await h.db.assignSite("bob", MAIN, OWNER);
  const response = await h.sitesRoute.GET(sitesRequest(contractorSession(h)));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sites.map((site: { site_id: string }) => site.site_id), [CONTRACT]);
  assert.deepEqual(h.state.userLookups, [], "관리자 메뉴 권한은 목록 열람 요건이 아니다");
});

test("GET sites: contractor 배정 0건은 빈 배열과 200이다", async () => {
  const h = harness();
  const response = await h.sitesRoute.GET(sitesRequest(contractorSession(h)));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sites: [] });
});

for (const orgType of ["vitalguard", "jodal", "kosha", "test"]) {
  test(`GET sites: 직원 ${orgType}는 배정 유무와 무관하게 전체 active 현장을 본다`, async () => {
    const h = harness();
    h.state.users[0]!.org_type = orgType;
    await h.db.assignSite("alice", CONTRACT, OWNER);
    const response = await h.sitesRoute.GET(sitesRequest(h.auth.createSession("admin", "alice", orgType)));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).sites, await h.db.listSites());
  });
}

for (const [kind, tokenFor] of [
  ["모바일", (role: string) => mobileToken(WORKER, role)],
  ["기존 앱", (role: string) => appJwt.signAppJwt({ sub: WORKER, role, name: null, workerId: null })],
] as const) {
  for (const role of ["owner", "worker"]) {
    test(`GET sites: ${kind} JWT role=${role}도 DB contractor 배정만 본다`, async () => {
      const h = harness();
      await h.db.assignSite(WORKER, CONTRACT, OWNER);
      const token = tokenFor(role);
      assert.equal(Object.hasOwn(appJwt.verifyAppJwt(token)!, "orgType"), false);
      const response = await h.sitesRoute.GET(sitesRequest(token));
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).sites, await h.db.listAssignedSites(WORKER));
      assert.ok(h.state.queries.some(({ sql, params }) => sql === "SELECT org_type FROM users WHERE username = $1" && params[0] === WORKER));
    });
  }
}

test("GET sites: 오래된 웹 orgType 클레임보다 현재 DB 유형을 양방향 우선한다", async () => {
  const h = harness();
  await h.db.assignSite(WORKER, CONTRACT, OWNER);
  const oldEmployeeToken = h.auth.createSession("admin", WORKER, "vitalguard");
  const restricted = await h.sitesRoute.GET(sitesRequest(oldEmployeeToken));
  assert.deepEqual((await restricted.json()).sites, await h.db.listAssignedSites(WORKER));
  h.state.users.find((user) => user.username === WORKER)!.org_type = "jodal";
  const unrestricted = await h.sitesRoute.GET(sitesRequest(contractorSession(h)));
  assert.deepEqual((await unrestricted.json()).sites, await h.db.listSites());
});

test("GET sites: 미인증은 401이며 DB를 조회하지 않는다", async () => {
  const h = harness();
  for (const token of [null, "invalid-token"]) {
    const response = await h.sitesRoute.GET(sitesRequest(token));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "인증 필요" });
  }
  assert.equal(h.state.queries.length + h.state.userLookups.length, 0);
});

for (const auth of ["웹", "앱"]) {
  test(`GET site-info: ${auth} contractor의 첫 배정을 자동 지정하고 user_current_site에 기록한다`, async () => {
    const h = harness();
    h.state.adminAccess = false;
    h.state.snapshots = [snapshot(MAIN)];
    await h.db.assignSite(WORKER, CONTRACT, OWNER);
    const token = auth === "웹" ? contractorSession(h) : mobileToken();
    const response = await h.route.GET(request("GET", undefined, token));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.siteInfo.site_id, CONTRACT);
    assert.equal(body.siteInfo.address, "마스터 주소");
    assert.equal(body.assignedSiteCount, 1);
    assert.equal((await h.db.getCurrentSite(WORKER))?.site_id, CONTRACT);
    assert.ok(h.state.queries.some(({ sql, params }) => sql.startsWith("INSERT INTO user_current_site") && params[0] === WORKER));
    assert.equal(h.state.snapshots.length, 1, "GET은 snapshot을 새로 쓰지 않는다");
    assert.deepEqual(h.state.userLookups, []);
  });
}

test("GET site-info: 다중 배정 첫 정렬 현장과 그 snapshot을 반환하고 active 배정 수를 센다", async () => {
  const h = harness();
  for (const siteId of [CONTRACT, "B", "A"]) await h.db.assignSite(WORKER, siteId, OWNER);
  h.state.sites.find((site) => site.site_id === CONTRACT)!.active = false;
  h.state.snapshots = [snapshot("A"), snapshot(MAIN, "2026-09-17")];
  const body = await (await h.route.GET(request("GET", undefined, mobileToken()))).json();
  assert.equal(body.siteInfo.site_id, "A");
  assert.equal(body.siteInfo.address, "광주광역시 동구 중앙로 196");
  assert.equal(body.assignedSiteCount, 2);
  assert.equal((await h.db.getCurrentSite(WORKER))?.site_id, "A");
});

for (const oldCurrent of [false, true]) {
  test(`GET site-info: 배정 0건·기존 선택 ${oldCurrent}이면 null이며 전체 최신을 조회하지 않는다`, async () => {
    const h = harness();
    h.state.snapshots = [snapshot(MAIN)];
    if (oldCurrent) await h.db.setCurrentSite(WORKER, MAIN);
    h.state.queries.length = 0;
    const response = await h.route.GET(request("GET", undefined, mobileToken()));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, siteInfo: null, assignedSiteCount: 0 });
    assert.equal(h.state.queries.some(({ sql }) => sql.includes("site_info_daily")), false);
    assert.deepEqual(writes(h), []);
  });
}

test("GET site-info: 현재 선택이 배정 안이면 선택·시각을 유지하고 해제 뒤에는 남은 배정으로 전환한다", async () => {
  const h = harness();
  await h.db.assignSite(WORKER, MAIN, OWNER);
  await h.db.assignSite(WORKER, CONTRACT, OWNER);
  const selected = await h.db.setCurrentSite(WORKER, CONTRACT);
  let body = await (await h.route.GET(request("GET", undefined, mobileToken()))).json();
  assert.equal(body.siteInfo.site_id, CONTRACT);
  assert.equal(body.assignedSiteCount, 2);
  assert.deepEqual(await h.db.getCurrentSite(WORKER), selected);
  await h.db.unassignSite(WORKER, CONTRACT);
  body = await (await h.route.GET(request("GET", undefined, mobileToken()))).json();
  assert.equal(body.siteInfo.site_id, MAIN);
  assert.equal(body.assignedSiteCount, 1);
  assert.equal((await h.db.getCurrentSite(WORKER))?.site_id, MAIN);
});

test("GET site-info: 직원 계정은 기존 전체 최신 폴백과 웹 관리자 권한 검사를 유지한다", async () => {
  const h = harness();
  h.state.snapshots = [snapshot(MAIN, "2026-09-14"), snapshot(CONTRACT)];
  const response = await h.route.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, siteInfo: snapshot(CONTRACT), assignedSiteCount: 0 });
  assert.deepEqual(h.state.current, []);
  h.state.adminAccess = false;
  assert.equal((await h.route.GET(request())).status, 401);
});

test("GET site-info: 자동 선택 저장 실패를 성공 응답으로 바꾸지 않는다", async () => {
  const h = harness();
  await h.db.assignSite(WORKER, CONTRACT, OWNER);
  h.state.failSelection = true;
  await assert.rejects(h.route.GET(request("GET", undefined, mobileToken())), /선택 저장 실패/);
  assert.deepEqual(h.state.current, []);
});

test("POST selectOnly: contractor의 배정 밖 현장은 403이고 snapshot·현재 선택을 쓰지 않는다", async () => {
  const h = harness();
  await h.db.assignSite(WORKER, CONTRACT, OWNER);
  await h.db.setCurrentSite(WORKER, CONTRACT);
  h.state.queries.length = 0;
  for (const siteId of [MAIN, "없는 현장", "inactive"]) {
    const response = await h.route.POST(request("POST", { siteId, selectOnly: true }, contractorSession(h)));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "배정되지 않은 현장입니다" });
  }
  assert.deepEqual(writes(h), []);
  assert.equal((await h.db.getCurrentSite(WORKER))?.site_id, CONTRACT);
});

test("POST selectOnly: contractor의 배정 안 현장은 200이며 저장된 정보와 인증 username을 사용한다", async () => {
  const h = harness();
  h.state.adminAccess = false;
  await h.db.assignSite(WORKER, CONTRACT, OWNER);
  h.state.snapshots = [snapshot(CONTRACT)];
  const response = await h.route.POST(request("POST", { ...input(CONTRACT, "위조 주소"), username: "bob", selectOnly: true }, contractorSession(h)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.siteInfo.site_id, CONTRACT);
  assert.equal(body.siteInfo.address, "광주광역시 동구 중앙로 196");
  assert.equal((await h.db.getCurrentSite(WORKER))?.site_id, CONTRACT);
  assert.equal(await h.db.getCurrentSite("bob"), null);
});

test("POST selectOnly: 오래된 직원 토큰도 현재 DB가 contractor면 배정 밖 선택은 403이다", async () => {
  const h = harness();
  const token = h.auth.createSession("admin", WORKER, "vitalguard");
  assert.equal((await h.route.POST(request("POST", { siteId: MAIN, selectOnly: true }, token))).status, 403);
  assert.deepEqual(writes(h), []);
});

test("POST selectOnly: 직원 계정은 관리자 메뉴 권한·배정 없이 전체 active 현장을 선택한다", async () => {
  const h = harness();
  h.state.adminAccess = false;
  const token = h.auth.createSession("admin", "test.jodal", "jodal");
  const response = await h.route.POST(request("POST", { siteId: CONTRACT, selectOnly: true }, token));
  assert.equal(response.status, 200);
  assert.equal((await h.db.getCurrentSite("test.jodal"))?.site_id, CONTRACT);
});

test("contractor 조회·선택 허용은 POST 편집·PUT 관리자 편집 권한을 열지 않는다", async () => {
  const h = harness();
  await h.db.assignSite(WORKER, CONTRACT, OWNER);
  h.state.queries.length = 0;
  const token = contractorSession(h);
  assert.equal((await h.route.POST(request("POST", input(CONTRACT), token))).status, 401);
  assert.equal((await h.route.PUT(request("PUT", { ...input(CONTRACT), selectOnly: true }, token))).status, 401);
  assert.deepEqual(writes(h), []);
});
