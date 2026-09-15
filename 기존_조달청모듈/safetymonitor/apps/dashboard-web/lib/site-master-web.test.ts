// 실제 현장 선택 컴포넌트·로그인 콜백을 실행해 API 폴백과 서버 저장 순서를 검증한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import type { SiteInfo } from "../app/components/AdminExportModal";
import type { SiteRow } from "./db";

type Element = React.ReactElement<Record<string, unknown>>;
const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const compile = (code: string) => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const siteCode = compile(read("app/components/LoginSiteSelect.tsx"));
const ComboBox = Object.assign(() => null, { InputGroup: "fixture-group", Trigger: "fixture-trigger", Popover: "fixture-popover" });
const ListBox = Object.assign(() => null, { Section: "fixture-section", Item: "fixture-item", ItemIndicator: "fixture-indicator" });
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
const itemIds = (tree: Element) => elements(tree).filter((node) => node.type === ListBox.Item).map((node) => node.props.id);
const enterButton = (tree: Element) => elements(tree).find((node) => node.type === "button")!;
const press = (tree: Element) => (enterButton(tree).props.onClick as () => Promise<void>)();
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const response = (sites: unknown, status = 200) => new Response(JSON.stringify({ ok: status === 200, sites }), { status });
const master = (siteId = "DB-NEW", uiKey = "db-new", kind: SiteRow["kind"] = "contract"): SiteRow => ({
  site_id: siteId, ui_key: uiKey, kind, label: "DB에서 추가한 현장", company_name: "DB 회사",
  site_name: "DB 현장명", construction_type: "토목", address: "DB 주소", start_date: "2026-09-01",
  completion_date: "2027-09-01", sort_order: 30, active: true, created_at: "2026-09-01T00:00:00.000Z",
});

function selector(fetcher: typeof fetch, onConfirm = async (_info: SiteInfo, _uiKey: string) => {}) {
  const values: unknown[] = [];
  let index = 0;
  let effect: (() => (() => void)) | undefined;
  const timers: (() => void)[] = [];
  const exported = {} as { LoginSiteSelect(props: Record<string, unknown>): Element };
  runInNewContext(siteCode, {
    exports: exported, fetch: fetcher, AbortController, Error,
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    require: (name: string) => {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "react") return {
        useState: (initial: unknown) => {
          const slot = index++;
          if (!(slot in values)) values[slot] = initial;
          return [values[slot], (next: unknown) => {
            values[slot] = typeof next === "function" ? next(values[slot]) : next;
          }];
        },
        useEffect: (callback: typeof effect) => { effect ??= callback; },
      };
      if (name === "./heroui-combo-box") return { ComboBox, ListBox, Input: "input", Header: "header", Separator: "hr" };
      assert.fail(`허용하지 않은 브라우저 의존성: ${name}`);
    },
  });
  const render = () => { index = 0; return exported.LoginSiteSelect({ lang: "ko", token: "fixture-session", onConfirm, onBack: () => {} }); };
  const choose = (id: string) => {
    const combo = elements(render()).find((node) => node.type === ComboBox)!;
    (combo.props.onSelectionChange as (key: string) => void)(id);
  };
  render();
  return { render, choose, timers, load: () => effect!() };
}

test("현장 목록: 로그인 토큰을 보내고 DB의 새 현장·kind·필드를 그대로 사용한다", async () => {
  const selections: { info: SiteInfo; uiKey: string }[] = [];
  const h = selector(async (url, init) => {
    assert.equal(url, "/api/sites");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-session");
    assert.equal(init?.cache, "no-store");
    return response([master()]);
  }, async (info, uiKey) => { selections.push({ info, uiKey }); });
  h.load();
  await tick();
  const tree = h.render();
  assert.deepEqual(itemIds(tree), ["db-new"]);
  const sections = elements(tree).filter((node) => node.type === ListBox.Section);
  assert.deepEqual(itemIds(sections[0]!), []);
  assert.deepEqual(itemIds(sections[1]!), []);
  assert.deepEqual(itemIds(sections[2]!), ["db-new"]);
  await press(tree);
  assert.equal(selections[0]?.uiKey, "db-new");
  assert.deepEqual(structuredClone(selections[0]?.info), { noticeId: "DB-NEW", companyName: "DB 회사",
    siteName: "DB 현장명", constructionType: "토목", address: "DB 주소", startDate: "2026-09-01", completionDate: "2027-09-01" });
});

for (const [label, fetcher] of [
  ["네트워크 실패", async () => { throw new Error("통신 실패"); }],
  ["HTTP 503", async () => response([], 503)],
  ["깨진 JSON", async () => new Response("{")],
  ["잘못된 목록", async () => response([null])],
] as const) {
  test(`현장 목록 ${label}: 기존 상수 9개와 입장 버튼을 유지한다`, async () => {
    const h = selector(fetcher);
    const original = itemIds(h.render());
    h.load();
    await tick();
    assert.equal(original.length, 9);
    assert.deepEqual(itemIds(h.render()), original);
    assert.equal(enterButton(h.render()).props.disabled, false);
  });
}

test("활성 현장 0개 응답은 폴백으로 되살리지 않고 입장을 비활성화한다", async () => {
  const h = selector(async () => response([]));
  h.load();
  await tick();
  assert.deepEqual(itemIds(h.render()), []);
  assert.equal(enterButton(h.render()).props.disabled, true);
});

test("목록 시간 초과는 요청을 중단하고 기존 9개를 유지한다", async () => {
  let signal: AbortSignal | null | undefined;
  const h = selector(async (_url, init) => {
    signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("시간 초과"))));
  });
  h.load();
  h.timers[0]!();
  await tick();
  assert.ok(signal?.aborted);
  assert.equal(itemIds(h.render()).length, 9);
});

test("마운트 해제 뒤 늦게 도착한 목록은 선택 상태를 바꾸지 않는다", async () => {
  let resolve!: (value: Response) => void;
  const h = selector(() => new Promise<Response>((done) => { resolve = done; }));
  const cleanup = h.load();
  cleanup();
  resolve(response([master()]));
  await tick();
  assert.equal(itemIds(h.render()).length, 9);
});

test("현장 저장 실패는 오류를 보여주고 다시 입장할 수 있게 한다", async () => {
  const h = selector(async () => response([]), async () => { throw new Error("현장 저장 실패"); });
  await press(h.render());
  const tree = h.render();
  assert.equal(elements(tree).find((node) => node.props.role === "alert")?.props.children, "현장 저장 실패");
  assert.equal(enterButton(tree).props.disabled, false);
});

test("ensureSchema의 시드 9행은 폴백 원문 전체 필드와 같고 정렬 번호도 유지한다", async () => {
  const choices = new Map<string, SiteInfo>();
  const h = selector(async () => response([]), async (info, uiKey) => { choices.set(uiKey, info); });
  const originalItems = elements(h.render()).filter((node) => node.type === ListBox.Item);
  for (const node of originalItems) { h.choose(String(node.props.id)); await press(h.render()); }
  const seed = read("lib/db.ts").match(/INSERT INTO site \(([\s\S]*?)\) VALUES([\s\S]*?)ON CONFLICT \(site_id\) DO NOTHING/)!;
  const columns = seed[1]!.split(",").map((value) => value.trim());
  const values = Array.from(seed[2]!.matchAll(/'((?:[^']|'')*)'|(\d+)/g), (match) => match[1] ?? Number(match[2]));
  assert.equal(values.length, 9 * columns.length);
  const order = [0, 10, 11, 12, 13, 14, 20, 21, 22];
  for (let i = 0; i < 9; i++) {
    const row = Object.fromEntries(columns.map((column, offset) => [column, values[i * columns.length + offset]]));
    const original = choices.get(String(row.ui_key));
    assert.ok(original);
    assert.equal(row.site_id, original.noticeId);
    assert.equal(row.label, originalItems.find((node) => node.props.id === row.ui_key)?.props.textValue);
    assert.equal(row.kind, i === 0 ? "main" : i < 6 ? "demo" : "contract");
    assert.equal(row.sort_order, order[i]);
    for (const [column, field] of [["company_name", "companyName"], ["site_name", "siteName"],
      ["construction_type", "constructionType"], ["address", "address"], ["start_date", "startDate"],
      ["completion_date", "completionDate"]] as const) assert.equal(row[column], original[field]);
  }
});

const loginSource = read("app/components/LoginScreen.tsx");
const loginAst = ts.createSourceFile("LoginScreen.tsx", loginSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let confirmSource = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(loginAst) === "handleSiteConfirm" &&
      node.initializer && ts.isCallExpression(node.initializer)) confirmSource = node.initializer.arguments[0]!.getText(loginAst);
  ts.forEachChild(node, visit);
}
visit(loginAst);
assert.ok(confirmSource, "실제 로그인 콜백 추출 누락");
const confirmCode = compile(`exports.confirm = ${confirmSource};`);
function login(fetcher: typeof fetch, storageFails = false) {
  const stored = new Map<string, string>();
  const loggedIn: unknown[][] = [];
  const exported = {} as { confirm(info: SiteInfo, uiKey: string): Promise<void> };
  runInNewContext(confirmCode, {
    exports: exported, fetch: fetcher, AbortSignal, pendingToken: "fixture-session", pendingRole: "admin",
    onLogin: (...args: unknown[]) => loggedIn.push(args),
    window: { localStorage: { setItem: (key: string, value: string) => {
      if (storageFails) throw new Error("저장소 차단");
      stored.set(key, value);
    } } },
  });
  return { ...exported, stored, loggedIn };
}
const preset: SiteInfo = { noticeId: "SITE-SMARTHRD-2026", companyName: "프리셋 회사", siteName: "프리셋 현장",
  constructionType: "건축", address: "프리셋 주소", startDate: "2026-01-02", completionDate: "2027-06-30" };
const savedResponse = () => new Response(JSON.stringify({ ok: true, siteInfo: {
  site_id: preset.noticeId, company_name: "사람이 고친 회사", site_name: "사람이 고친 현장",
  address: "광주광역시 동구 중앙로 196", start_date: "2026-03-24", completion_date: "2026-10-06",
} }));

test("로그인: POST에 DB siteId를 보내고 서버 저장 완료 뒤 ui_key·응답을 캐시한 다음 입장한다", async () => {
  let resolve!: (value: Response) => void;
  const h = login(async (url, init) => {
    assert.equal(url, "/api/admin/site-info");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-session");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.siteId, preset.noticeId);
    assert.equal(body.selectOnly, true);
    return new Promise<Response>((done) => { resolve = done; });
  });
  const pending = h.confirm(preset, "main");
  assert.equal(h.loggedIn.length, 0);
  assert.equal(h.stored.size, 0);
  resolve(savedResponse());
  await pending;
  assert.equal(h.stored.get("safetymonitor.site-id.v1"), "main");
  assert.equal(JSON.parse(h.stored.get("safetymonitor.site-info.v1")!).address, "광주광역시 동구 중앙로 196");
  assert.deepEqual(h.loggedIn, [["fixture-session", "admin"]]);
});

test("로그인: 현장 저장 실패 시 캐시를 바꾸거나 대시보드에 입장하지 않는다", async () => {
  const h = login(async () => new Response(JSON.stringify({ ok: false, error: "저장 실패" }), { status: 503 }));
  await assert.rejects(h.confirm(preset, "main"), /저장 실패/);
  assert.equal(h.loggedIn.length + h.stored.size, 0);
});

test("로그인: localStorage가 차단돼도 서버 저장 성공 후 입장한다", async () => {
  const h = login(async () => savedResponse(), true);
  await h.confirm(preset, "main");
  assert.equal(h.stored.size, 0);
  assert.equal(h.loggedIn.length, 1);
});
