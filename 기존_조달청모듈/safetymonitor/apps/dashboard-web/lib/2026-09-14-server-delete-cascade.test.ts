// 실제 삭제 함수와 라우트를 실행하고, SQL 대역은 행 상태와 트랜잭션 롤백을 재현한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import type { CalendarMediaCommentRow, CalendarMediaRow, deleteCalendarMedia } from "./db";
import * as mediaScope from "./media-scope";

const ROOT = join(import.meta.dirname, "..");
const source = readFileSync(join(ROOT, "lib/db.ts"), "utf8");
const ast = ts.createSourceFile("db.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const selected = ast.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) && node.name?.text === "deleteCalendarMedia") ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) =>
    ts.isIdentifier(d.name) && d.name.text === "MEDIA_DELETE_WINDOW_MIN")),
);
assert.equal(selected.length, 2, "삭제 함수·유예 상수 추출 누락");
const compiled = new Map<string, string>();
function execute<T>(code: string, globals: Record<string, unknown>): T {
  if (!compiled.has(code)) compiled.set(code, ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const module = { exports: {} };
  runInNewContext(compiled.get(code)!, { module, exports: module.exports, ...globals });
  return module.exports as T;
}

type Media = Pick<CalendarMediaRow, "id" | "annotation_of" | "worker_id" | "storage_provider" | "storage_key" | "created_at">;
type Comment = Pick<CalendarMediaCommentRow, "id" | "media_id" | "author_id" | "body" | "audio_storage_key">;
const NOW = Date.parse("2026-09-14T03:00:00Z");
function photo(id: string, annotationOf: string | null = null): Media {
  return { id, annotation_of: annotationOf, worker_id: annotationOf ? "other-author" : "worker",
    storage_provider: "naver", storage_key: `${id}.${annotationOf ? "json" : "jpg"}`,
    created_at: new Date(NOW - (annotationOf ? 60 : 5) * 60_000).toISOString() };
}
function comment(id: string, mediaId = "photo", audioKey: string | null = null): Comment {
  return { id, media_id: mediaId, author_id: `author-${id}`, body: audioKey ? "" : "사진 확인",
    audio_storage_key: audioKey };
}

function harness(comments = [comment("text"), comment("voice", "photo", "voice.m4a")]) {
  const state = {
    media: [photo("photo"), photo("ink-1", "photo"), photo("ink-2", "photo"),
      photo("other"), photo("other-ink", "other")],
    comments: structuredClone(comments),
    queries: [] as { sql: string; params: unknown[] }[],
    deletes: [] as string[],
    warnings: [] as string[],
    released: 0,
    failure: null as "comments" | "commit" | null,
    storageFailure: null as string | null,
  };
  let snapshot: { media: Media[]; comments: Comment[] } | null = null;
  let committed = false;
  const returning = (sql: string, rows: (Media | Comment)[]) => {
    const columns = sql.split(" RETURNING ")[1]!.split(", ");
    return { rows: rows.map((row) => Object.fromEntries(columns.map((column) =>
      [column, row[column as keyof typeof row]]))) };
  };
  const query = async (raw: string, params: unknown[] = []) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    state.queries.push({ sql, params: structuredClone(params) });
    if (sql === "BEGIN") {
      snapshot = structuredClone({ media: state.media, comments: state.comments });
    } else if (sql === "ROLLBACK") {
      assert.ok(snapshot);
      state.media = snapshot.media;
      state.comments = snapshot.comments;
      snapshot = null;
    } else if (sql === "COMMIT") {
      if (state.failure === "commit") throw new Error("검증용 커밋 실패");
      snapshot = null;
      committed = true;
    } else if (sql.startsWith("SELECT annotation_of")) {
      const target = state.media.find((row) => row.id === params[0] &&
        (!sql.includes("worker_id = ANY") || (params[1] as string[]).includes(row.worker_id!)));
      return { rows: target ? [{ annotation_of: target.annotation_of }] : [] };
    } else if (sql.startsWith("SELECT created_at::timestamptz")) {
      assert.match(sql, /< statement_timestamp\(\) - interval '10 minutes'/);
      return { rows: [{ expired: Date.parse(state.media.find((row) => row.id === params[0])!.created_at) < NOW - 600_000 }] };
    } else if (sql.startsWith("DELETE FROM calendar_media WHERE")) {
      const rows = state.media.filter((row) => row.id === params[0] ||
        (sql.includes("OR annotation_of = $1") && row.annotation_of === params[0]));
      state.media = state.media.filter((row) => !rows.includes(row));
      return returning(sql, rows);
    } else if (sql.startsWith("DELETE FROM calendar_media_comment")) {
      assert.match(sql, /WHERE media_id = ANY\(\$1::text\[\]\) RETURNING audio_storage_key$/);
      if (state.failure === "comments") throw new Error("검증용 댓글 삭제 실패");
      const rows = state.comments.filter((row) => (params[0] as string[]).includes(row.media_id));
      state.comments = state.comments.filter((row) => !rows.includes(row));
      return returning(sql, rows);
    } else {
      assert.fail(`예상 밖 SQL: ${sql}`);
    }
    return { rows: [] };
  };
  const db = execute<{ deleteCalendarMedia: typeof deleteCalendarMedia; MEDIA_DELETE_WINDOW_MIN: number }>(
    selected.map((node) => node.getText(ast)).join("\n"), {
      mediaScopeClause: mediaScope.mediaScopeClause,
      ensureSchema: async () => {},
      getPool: () => ({ connect: async () => ({ query, release: () => { state.released++; } }) }),
    },
  );
  const imports: Record<string, unknown> = {
    "next/server": { NextResponse },
    "../../../../lib/db": db,
    "../../../../lib/media-scope": mediaScope,
    "../../../../lib/admin-auth": { verifyBasicAuth: () => false, getSession: () => null },
    "../../../../lib/app-jwt": { bearerToken: () => null, verifyAppJwt: () => ({ role: "owner" }) },
    "../../../../lib/storage": {
      isStorageConfigured: () => true,
      deleteObject: async (key: string) => {
        assert.ok(committed, "DB 커밋 전에 파일을 지웠다");
        assert.equal(state.released, 1, "DB 커넥션 반환 전에 파일을 지웠다");
        state.deletes.push(key);
        if (state.storageFailure === key) throw new Error("검증용 객체 삭제 실패");
      },
    },
  };
  const route = execute<{ DELETE(request: Request): Promise<Response> }>(
    readFileSync(join(ROOT, "app/api/calendar/media/route.ts"), "utf8"), {
      require: (name: string) => {
        assert.ok(Object.hasOwn(imports, name), `미허용 의존성: ${name}`);
        return imports[name];
      },
      URL, console: { warn: (message: string) => state.warnings.push(message) },
    },
  );
  return { state, db, route };
}
function deletion() {
  return new Request("https://fixture.test/api/calendar/media?id=photo", { method: "DELETE" });
}

test("원본 삭제는 작성자가 다른 글·음성 댓글을 모두 지우고 다른 사진·댓글은 보존한다", async () => {
  const h = harness([comment("text"), comment("voice", "photo", "voice.m4a"), comment("other", "other")]);
  assert.equal((await h.db.deleteCalendarMedia("photo", { workerIds: ["worker"] })).status, "deleted");
  assert.deepEqual(h.state.media.map((row) => row.id), ["other", "other-ink"]);
  assert.deepEqual(h.state.comments.map((row) => row.id), ["other"]);
  assert.equal(h.state.queries.at(-1)?.sql, "COMMIT");
  assert.equal(h.state.released, 1);
});

test("삭제된 음성 댓글의 키만 네이버 제공자로 반환하고 원본·잉크 파일 목록은 유지한다", async () => {
  const h = harness([comment("text"), comment("voice-1", "photo", "one.m4a"),
    comment("voice-2", "photo", "two.aac"), comment("other", "other", "other.m4a")]);
  const result = await h.db.deleteCalendarMedia("photo", "moderator");
  assert.deepEqual(structuredClone(result), { status: "deleted", files: [
    { storageProvider: "naver", storageKey: "photo.jpg" },
    { storageProvider: "naver", storageKey: "ink-1.json" },
    { storageProvider: "naver", storageKey: "ink-2.json" },
    { storageProvider: "naver", storageKey: "one.m4a" },
    { storageProvider: "naver", storageKey: "two.aac" },
  ] });
  assert.ok(h.state.queries.every(({ sql }) => !sql.startsWith("SELECT") || !sql.includes("calendar_media_comment")));
});

test("원본 삭제는 함께 삭제된 모든 잉크본의 글 댓글도 정리한다", async () => {
  const h = harness([comment("ink-text-1", "ink-1"), comment("ink-text-2", "ink-2"),
    comment("other-ink-text", "other-ink")]);
  await h.db.deleteCalendarMedia("photo", { workerIds: ["worker"] });
  assert.deepEqual(h.state.comments.map((row) => row.id), ["other-ink-text"]);
  const deletion = h.state.queries.find(({ sql }) => sql.startsWith("DELETE FROM calendar_media_comment"));
  assert.deepEqual(deletion?.params, [["photo", "ink-1", "ink-2"]]);
});

test("10분 유예 경과는 소유자·owner 모두 롤백하고 모든 행·음성 파일을 보존한다", async () => {
  for (const scope of [{ workerIds: ["worker"] }, "moderator"] as mediaScope.MediaScope[]) {
    const h = harness();
    h.state.media[0]!.created_at = new Date(NOW - 600_001).toISOString();
    const before = structuredClone({ media: h.state.media, comments: h.state.comments });
    assert.equal((await h.db.deleteCalendarMedia("photo", scope)).status, "delete_window_expired");
    assert.deepEqual({ media: h.state.media, comments: h.state.comments }, before);
    assert.equal(h.state.queries.at(-1)?.sql, "ROLLBACK");
    assert.ok(h.state.queries.every(({ sql }) => !sql.startsWith("DELETE")));
    assert.equal(h.state.released, 1);
    assert.equal((await h.route.DELETE(deletion())).status, 403);
    assert.deepEqual(h.state.deletes, []);
  }
});

test("정확히 10분인 원본은 기존 경계대로 댓글과 함께 삭제한다", async () => {
  const h = harness();
  h.state.media[0]!.created_at = new Date(NOW - 600_000).toISOString();
  assert.equal((await h.db.deleteCalendarMedia("photo", "moderator")).status, "deleted");
  assert.deepEqual(h.state.comments, []);
});

test("잉크본 단독 삭제는 오래된 잉크에도 유예를 적용하지 않고 모든 댓글을 건드리지 않는다", async () => {
  const h = harness([comment("text"), comment("voice", "photo", "voice.m4a"), comment("ink-text", "ink-1")]);
  const before = structuredClone(h.state.comments);
  const result = await h.db.deleteCalendarMedia("ink-1", "moderator");
  assert.deepEqual(structuredClone(result), { status: "deleted", files: [{ storageProvider: "naver", storageKey: "ink-1.json" }] });
  assert.deepEqual(h.state.comments, before);
  assert.deepEqual(h.state.media.map((row) => row.id), ["photo", "ink-2", "other", "other-ink"]);
  assert.ok(h.state.queries.every(({ sql }) => !sql.includes("calendar_media_comment") && !sql.includes("timestamptz")));
});

test("글 댓글만 있거나 댓글이 없어도 사진·잉크 파일만 반환한다", async () => {
  for (const comments of [[], [comment("text"), comment("empty-key", "photo", "")]]) {
    const h = harness(comments);
    const result = await h.db.deleteCalendarMedia("photo", "moderator");
    if (result.status !== "deleted") assert.fail("원본 삭제 실패");
    assert.deepEqual(structuredClone(result.files.map((file) => file.storageKey)), ["photo.jpg", "ink-1.json", "ink-2.json"]);
    assert.deepEqual(h.state.comments, []);
  }
});

test("없음·남의 사진 거부는 댓글과 파일에 손대지 않는다", async () => {
  for (const id of ["missing", "photo"]) {
    const h = harness();
    const before = structuredClone(h.state.comments);
    assert.equal((await h.db.deleteCalendarMedia(id, { workerIds: ["stranger"] })).status, "not_found");
    assert.deepEqual(h.state.comments, before);
    assert.ok(h.state.queries.every(({ sql }) => !sql.startsWith("DELETE")));
  }
});

for (const failure of ["comments", "commit"] as const) {
  test(`${failure === "comments" ? "댓글 삭제" : "커밋"} 실패는 사진·잉크·댓글을 모두 복구하고 스토리지를 호출하지 않는다`, async () => {
    const h = harness();
    h.state.failure = failure;
    const before = structuredClone({ media: h.state.media, comments: h.state.comments });
    await assert.rejects(h.route.DELETE(deletion()), /검증용/);
    assert.deepEqual({ media: h.state.media, comments: h.state.comments }, before);
    assert.equal(h.state.queries.at(-1)?.sql, "ROLLBACK");
    assert.equal(h.state.released, 1);
    assert.deepEqual(h.state.deletes, []);
  });
}

test("실제 삭제 라우트는 DB 커밋 후 음성 키를 보내며 원본의 제공자를 음성에 상속하지 않는다", async () => {
  const h = harness();
  h.state.media[0]!.storage_provider = null;
  const response = await h.route.DELETE(deletion());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(h.state.comments, []);
  assert.deepEqual(h.state.deletes, ["ink-1.json", "ink-2.json", "voice.m4a"]);
});

test("음성 객체 하나가 실패해도 다음 음성을 지우고 기존 성공 응답·경고를 유지한다", async () => {
  const h = harness([comment("voice-1", "photo", "one.m4a"), comment("voice-2", "photo", "two.aac")]);
  h.state.storageFailure = "one.m4a";
  assert.equal((await h.route.DELETE(deletion())).status, 200);
  assert.deepEqual(h.state.deletes, ["photo.jpg", "ink-1.json", "ink-2.json", "one.m4a", "two.aac"]);
  assert.equal(h.state.warnings.length, 1);
  assert.match(h.state.warnings[0]!, /one\.m4a/);
});
