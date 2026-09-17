// 실제 DB 함수·라우트·세션/앱 JWT 인증을 실행한다. DB 입출력만 대역으로 바꾸며 실 DB 접속은 허용하지 않는다.
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import * as clientIp from "./client-ip";
import type * as Db from "./db";
import * as orgType from "./org-type";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
export const source = read("lib/db.ts");
const ast = ts.createSourceFile("db.ts", source, ts.ScriptTarget.Latest, true);
const names = ["listSites", "getSite", "getCurrentSite", "setCurrentSite", "getLatestSiteInfo", "persistSiteInfoDaily", "ymdInKst",
  "listAssignedSites", "assignSite", "unassignSite", "getUserOrgType", "listUsers"];
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
export const appJwt = execute<typeof import("./app-jwt")>(read("lib/app-jwt.ts"), authGlobals);

type SiteDb = Pick<typeof Db, "listSites" | "getSite" | "getCurrentSite" | "setCurrentSite" | "getLatestSiteInfo" | "persistSiteInfoDaily" |
  "listAssignedSites" | "assignSite" | "unassignSite" | "getUserOrgType" | "listUsers">;
type SiteRoute = { GET(request: Request): Promise<Response>; POST(request: Request): Promise<Response>; PUT(request: Request): Promise<Response> };
export const MAIN = "SITE-SMARTHRD-2026";
export const CONTRACT = "R26TE13895124";
export const DAY = "2026-09-15";
function site(siteId: string, sortOrder: number, active = true): Db.SiteRow {
  return { site_id: siteId, ui_key: `ui-${siteId}`, kind: "main", label: `현장 ${siteId}`,
    company_name: "마스터 회사", site_name: `현장 ${siteId}`, construction_type: "건축",
    address: "마스터 주소", start_date: "2026-01-02", completion_date: "2027-06-30",
    sort_order: sortOrder, active, created_at: "2026-09-01T00:00:00.000Z" };
}
export function input(siteId = MAIN, address = "사람이 수정한 주소"): Db.SiteInfoInput {
  return { siteId, companyName: "수정 회사", siteName: "수정 현장", constructionType: "건축 (신축)",
    address, startDate: "2026-03-24", completionDate: "2026-10-06" };
}
export function snapshot(siteId = MAIN, date = DAY): Db.SiteInfoRow {
  return { id: 1, site_id: siteId, snapshot_date: date, recorded_at: `${date}T00:00:00.000Z`,
    company_name: "수정 회사", site_name: "수정 현장", construction_type: "건축 (신축)",
    address: "광주광역시 동구 중앙로 196", start_date: "2026-03-24", completion_date: "2026-10-06" };
}
export function request(method = "GET", body?: unknown, token: string | null = "web-alice") {
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
export function sitesRequest(token: string | null, scheme = "Bearer") {
  return new Request("http://fixture.test/api/sites", {
    headers: token ? { authorization: `${scheme} ${token}` } : {},
  });
}

export function mobileToken(username = "test.worker", role = "admin") {
  return appJwt.signMobileAccessJwt({
    sub: username, role, name: null, workerId: "fixture-worker",
    sessionId: "11111111-2222-3333-4444-555555555555",
  });
}

function user(id: number, username: string, org: string): Db.UserRow {
  return {
    id, username, org_type: org, role: "admin", status: "approved", admin_access: true,
    name: "검증 사용자", company: "마스터 회사", phone: null, carrier: null, email: null,
    email_verified: false, password_hash: "test-password-hash", auth_provider: "password",
    google_sub: "test-google-sub", birth_date: null, department: null, job_title: null,
    employee_id: null, guardian_name: null, guardian_phone: null, site_officer: false,
    temp_password_expires_at: null, totp_secret: "test-totp-secret", totp_enabled: true, totp_last_step: 1,
    created_at: `${DAY}T00:00:00.000Z`, approved_at: null, approved_by: null,
  };
}

export function harness() {
  const state = {
    sites: [site(CONTRACT, 20), site("inactive", -1, false), site(MAIN, 0), site("B", 10), site("A", 10)],
    users: [user(1, "alice", "vitalguard"), user(2, "bob", "contractor"), user(3, "test.jodal", "jodal"), user(4, "test.worker", "contractor")],
    assignments: [] as { username: string; site_id: string; assigned_at: string; assigned_by: string | null }[],
    snapshots: [] as Db.SiteInfoRow[], current: [] as Db.CurrentSiteRow[],
    queries: [] as { sql: string; params: unknown[] }[],
    userLookups: [] as string[],
    adminAccess: true, failSnapshot: false, failSelection: false, tick: 0,
  };
  const query = async (raw: string, params: unknown[] = []) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    state.queries.push({ sql, params: structuredClone(params) });
    const now = `${DAY}T03:00:${String(state.tick++).padStart(2, "0")}.000Z`;
    if (sql === "SELECT org_type FROM users WHERE username = $1") {
      return { rows: state.users.filter((row) => row.username === params[0]).map(({ org_type }) => ({ org_type })) };
    }
    if (sql.startsWith("SELECT * FROM users ORDER BY")) {
      return { rows: [...state.users] };
    }
    if (sql.startsWith("SELECT s.* FROM site s JOIN user_site_assignment")) {
      assert.match(sql, /ON a.site_id = s.site_id WHERE a.username = \$1 AND s.active = TRUE ORDER BY s.sort_order, s.site_id$/);
      return { rows: state.sites.filter((row) => row.active && state.assignments.some((assignment) =>
        assignment.username === params[0] && assignment.site_id === row.site_id))
        .sort((a, b) => a.sort_order - b.sort_order || a.site_id.localeCompare(b.site_id)) };
    }
    if (sql.startsWith("INSERT INTO user_site_assignment")) {
      assert.match(sql, /\(username, site_id, assigned_by\) VALUES \(\$1, \$2, \$3\) ON CONFLICT \(username, site_id\) DO NOTHING$/);
      assert.ok(state.sites.some((row) => row.site_id === params[1]), "현장 외래키 위반");
      const duplicate = state.assignments.some((row) => row.username === params[0] && row.site_id === params[1]);
      if (!duplicate) state.assignments.push({ username: String(params[0]), site_id: String(params[1]), assigned_at: now, assigned_by: String(params[2]) });
      return { rows: [], rowCount: duplicate ? 0 : 1 };
    }
    if (sql === "DELETE FROM user_site_assignment WHERE username = $1 AND site_id = $2") {
      const previous = state.assignments.length;
      state.assignments = state.assignments.filter((row) => row.username !== params[0] || row.site_id !== params[1]);
      return { rows: [], rowCount: previous - state.assignments.length };
    }
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
          const row = state.users.find((candidate) => candidate.username === username);
          return row ? { ...row, admin_access: row.admin_access && state.adminAccess } : null;
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
      if (name.endsWith("/org-type")) return orgType;
      if (name.endsWith("/db")) return db;
      assert.fail(`실 DB/통신을 허용하지 않은 의존성: ${name}`);
    },
  });
  return { state, db, auth, loadRoute, route: loadRoute("app/api/admin/site-info/route.ts"), sitesRoute: loadRoute("app/api/sites/route.ts") };
}
