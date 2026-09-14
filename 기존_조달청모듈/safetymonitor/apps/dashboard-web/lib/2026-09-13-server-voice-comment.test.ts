// 실제 라우트와 댓글 DB 함수 원문을 실행한다. SQL·스토리지만 대체하며 라이브 DB는 적재하지 않는다.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import { commentScopeClause } from "./comment-scope";
import * as mediaScope from "./media-scope";
import type {
  CalendarMediaCommentRow, CalendarMediaListRow,
  deleteCalendarMediaComment, insertCalendarMediaComment, listCommentsForMedia, updateCalendarMediaComment,
} from "./db";

const ROOT = join(import.meta.dirname, "..");
const dbSource = readFileSync(join(ROOT, "lib/db.ts"), "utf8");
const ast = ts.createSourceFile("db.ts", dbSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set([
  "buildInsert", "insertCalendarMediaComment", "listCommentsForMedia",
  "deleteCalendarMediaComment", "updateCalendarMediaComment",
]);
const selected = ast.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text),
);
assert.equal(selected.length, names.size, "실제 DB 함수 추출 누락");
const compiled = new Map<string, string>();
function execute<T>(source: string, globals: Record<string, unknown>): T {
  let code = compiled.get(source);
  if (!code) {
    code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    compiled.set(source, code);
  }
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, ...globals });
  return module.exports as T;
}

type CommentDb = {
  insertCalendarMediaComment: typeof insertCalendarMediaComment;
  listCommentsForMedia: typeof listCommentsForMedia;
  deleteCalendarMediaComment: typeof deleteCalendarMediaComment;
  updateCalendarMediaComment: typeof updateCalendarMediaComment;
};
type Route = { POST(request: Request): Promise<Response>; GET(request: Request): Promise<Response>;
  DELETE(request: Request): Promise<Response>; PATCH(request: Request): Promise<Response> };

function harness() {
  const state = {
    auth: "jwt" as "jwt" | "shared" | "session" | "basic" | "none",
    username: "officer-login" as string | null,
    role: "admin",
    workerId: "EMP-officer-login" as string | null,
    user: { name: "담당관 이름", job_title: "안전 담당관" } as { name: string | null; job_title: string | null } | null,
    owner: { name: "소유자 이름", job_title: "현장 책임자" } as { name: string | null; job_title: string | null } | null,
    profileFailure: false,
    profiles: [] as string[],
    original: { id: "photo-id", date_key: "2026-09-12", annotation_of: null,
      worker_id: "EMP-other", media_type: "image", media_url: null, storage_provider: null,
      storage_key: null, deleteWindowExpired: false } as CalendarMediaListRow | null,
    lookups: [] as string[],
    aliasLookups: 0,
    comments: [] as CalendarMediaCommentRow[],
    mediaInserts: [] as unknown[],
    queries: [] as { sql: string; params: unknown[] }[],
    puts: [] as { key: string; bytes: Uint8Array; contentType: string }[],
    deletes: [] as string[],
    signed: [] as string[],
    events: [] as string[],
    storageOn: true,
    putFailure: false,
    deleteFailure: false,
    signFailures: new Set<string>(),
    dbFailure: null as "insert" | "delete" | null,
    warnings: [] as string[],
    clock: 0,
  };
  const q = async (sql: string, params: unknown[] = []) => {
    state.queries.push({ sql, params: structuredClone(params) });
    const insert = sql.match(/^INSERT INTO calendar_media_comment \(([^)]+)\)/);
    if (insert) {
      if (state.dbFailure === "insert") throw new Error("검증용 DB 등록 실패");
      assert.match(sql, /RETURNING \*$/);
      const columns = insert[1]!.split(", ");
      assert.equal(columns.length, params.length);
      const row = {
        audio_storage_key: null, audio_url: null, audio_ms: null,
        ...Object.fromEntries(columns.map((column, i) => [column, params[i]])),
        created_at: new Date(Date.UTC(2026, 8, 13, 0, 0, state.clock++)).toISOString(), updated_at: null,
      } as CalendarMediaCommentRow;
      state.comments.push(row);
      state.events.push("댓글 등록");
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (sql.startsWith("SELECT * FROM calendar_media_comment")) {
      assert.match(sql, /WHERE media_id = ANY\(\$1\)\s+ORDER BY created_at ASC/);
      const rows = state.comments.filter((c) => (params[0] as string[]).includes(c.media_id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (sql.startsWith("DELETE FROM calendar_media_comment")) {
      if (state.dbFailure === "delete") throw new Error("검증용 DB 삭제 실패");
      assert.match(sql, /WHERE id = \$1(?: AND author_id = \$2)? RETURNING audio_storage_key$/);
      const rows = state.comments.filter((c) => c.id === params[0] &&
        (!sql.includes("AND author_id") || c.author_id === params[1]));
      state.comments = state.comments.filter((c) => !rows.includes(c));
      if (rows.length) state.events.push("댓글 삭제");
      return { rows: rows.map((c) => ({ audio_storage_key: c.audio_storage_key })), rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE calendar_media_comment")) {
      assert.match(sql, /WHERE id = \$1(?: AND author_id = \$3)?$/);
      const rows = state.comments.filter((c) => c.id === params[0] &&
        (!sql.includes("AND author_id") || c.author_id === params[2]));
      for (const c of rows) { c.body = params[1] as string; c.updated_at = "2026-09-13T01:00:00.000Z"; }
      return { rows: [], rowCount: rows.length };
    }
    assert.fail(`예상 밖 SQL: ${sql}`);
  };
  const db = execute<CommentDb>(selected.map((node) => node.getText(ast)).join("\n"), {
    q, commentScopeClause, NOW_ISO: "CURRENT_TIMESTAMP",
  });
  const imports = {
    db: {
      ...db,
      getCalendarMediaById: async (id: string) => {
        state.lookups.push(id);
        return state.original?.id === id ? state.original : null;
      },
      getWorkerAliasMap: async () => { state.aliasLookups++; return {}; },
      findUserByUsername: async (name: string) => {
        state.profiles.push(`users:${name}`);
        if (state.profileFailure) throw new Error("검증용 프로필 조회 실패");
        return state.user;
      },
      getOwnerProfile: async (name: string) => {
        state.profiles.push(`owner:${name}`);
        if (state.profileFailure) throw new Error("검증용 프로필 조회 실패");
        return state.owner;
      },
      listCalendarMedia: async () => state.original ? [state.original] : [],
      insertCalendarMedia: async (input: unknown) => { state.mediaInserts.push(input); return input; },
    },
    "app-jwt": {
      bearerToken: () => "검증용 토큰",
      verifyAppJwt: () => state.auth === "jwt" ? {
        sub: state.username, role: state.role, name: "JWT의 옛 이름", workerId: state.workerId,
      } : null,
      diagnoseAppAuth: () => ({ action: "reauth", logLine: "검증용 인증 실패" }),
    },
    "admin-auth": {
      verifyAppUploadToken: () => state.auth === "shared",
      appUploadTokenMatches: () => false,
      verifyBasicAuth: () => state.auth === "basic" || state.auth === "session",
      getSession: () => state.auth === "session" ? { username: state.username, role: state.role } : null,
    },
    "media-scope": mediaScope,
    storage: {
      isStorageConfigured: () => state.storageOn,
      putObject: async (key: string, bytes: Uint8Array, contentType: string) => {
        if (state.putFailure) throw new Error("검증용 업로드 실패");
        state.puts.push({ key, bytes, contentType });
        state.events.push("객체 저장");
      },
      presignDownload: async (key: string) => {
        state.signed.push(key);
        if (state.signFailures.has(key)) throw new Error("검증용 URL 발급 실패");
        return `https://storage.test/${key}?signed=fixture`;
      },
      deleteObject: async (key: string) => {
        state.deletes.push(key);
        state.events.push("객체 삭제");
        if (state.deleteFailure) throw new Error("검증용 객체 삭제 실패");
      },
    },
  };
  const route = (path: string) => execute<Route>(readFileSync(join(ROOT, path), "utf8"), {
    require: (name: string) => {
      if (name === "next/server") return { NextResponse };
      const key = name.split("/").at(-1)!;
      assert.ok(Object.hasOwn(imports, key), `미허용 의존성: ${name}`);
      return imports[key as keyof typeof imports];
    },
    console: { warn: (text: string) => state.warnings.push(text), error: () => {} },
    crypto, URL, Uint8Array,
  });
  return { state, db, upload: route("app/api/app-media/route.ts"),
    comment: route("app/api/calendar/media/comment/route.ts"), calendar: route("app/api/calendar/media/route.ts") };
}

function audioRequest(options: {
  type?: string; filename?: string; size?: number; parentField?: string | null; fields?: Record<string, string>;
} = {}) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(options.size ?? 7).fill(17)], {
    type: options.type ?? "audio/mp4",
  }), options.filename ?? "voice.m4a");
  if (options.parentField !== null) form.set(options.parentField ?? "commentOf", " photo-id ");
  for (const [key, value] of Object.entries(options.fields ?? {})) form.set(key, value);
  return new Request("https://fixture.test/api/app-media", { method: "POST", body: form });
}
function textRequest(body = " 사진 확인했습니다 ") {
  return new Request("https://fixture.test/api/calendar/media/comment", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaId: "photo-id", body }) });
}
function deletion(id: string) {
  return new Request(`https://fixture.test/api/calendar/media/comment?id=${id}`, { method: "DELETE" });
}
function listing() {
  return new Request("https://fixture.test/api/calendar/media?from=2026-09-01&to=2026-09-30");
}
async function expectRejected(h: ReturnType<typeof harness>, request: Request, status: number) {
  assert.equal((await h.upload.POST(request)).status, status);
  assert.equal(h.state.puts.length, 0);
  assert.equal(h.state.comments.length, 0);
  assert.equal(h.state.mediaInserts.length, 0);
}

test("기존 댓글 테이블에 nullable 음성 3컬럼을 더하고 body NOT NULL은 유지한다", () => {
  for (const [column, type] of [["audio_storage_key", "TEXT"], ["audio_url", "TEXT"], ["audio_ms", "INTEGER"]]) {
    assert.match(dbSource, new RegExp(`ALTER TABLE calendar_media_comment ADD COLUMN IF NOT EXISTS ${column} ${type};`));
  }
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS calendar_media_comment \([\s\S]*?body TEXT NOT NULL/);
  assert.doesNotMatch(dbSource, /ALTER COLUMN body DROP NOT NULL/);
});

for (const [type, filename] of [["audio/mp4", "voice.m4a"], ["audio/aac", "voice.aac"]]) {
  test(`${type} + commentOf는 원문 바이트와 빈 body의 댓글 한 행만 생성한다`, async () => {
    const h = harness();
    const response = await h.upload.POST(audioRequest({ type, filename, fields: { audioMs: "7000", dateKey: "1999-01-01" } }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["comment", "ok"]);
    assert.equal(h.state.mediaInserts.length, 0);
    assert.equal(h.state.comments.length, 1);
    assert.equal(body.comment.body, "");
    assert.equal(body.comment.media_id, "photo-id");
    assert.equal(body.comment.audio_ms, 7000);
    assert.equal(body.comment.audio_url, null);
    assert.equal(body.comment.audio_storage_key, h.state.puts[0]?.key);
    assert.match(body.comment.audio_storage_key, /^calendar-media\/2026-09-12\/.+\.(m4a|aac)$/);
    assert.equal(h.state.puts[0]?.contentType, type);
    assert.deepEqual([...h.state.puts[0]!.bytes], Array(7).fill(17));
    assert.deepEqual(h.state.events, ["객체 저장", "댓글 등록"]);
  });
}

for (const parentField of ["commentOf", "comment_of", "commentOfId", "comment_of_id"]) {
  test(`댓글 대상 필드 ${parentField}를 공백 제거 후 사용한다`, async () => {
    const h = harness();
    assert.equal((await h.upload.POST(audioRequest({ parentField }))).status, 200);
    assert.equal(h.state.comments[0]?.media_id, "photo-id");
    assert.deepEqual(h.state.lookups, ["photo-id"]);
  });
}

test("대상이 없으면 404이며 스토리지·DB에 남기지 않는다", async () => {
  const h = harness();
  h.state.original = null;
  await expectRejected(h, audioRequest(), 404);
  assert.deepEqual(h.state.lookups, ["photo-id"]);
});

test("잉크본 대상은 400이며 스토리지·DB에 남기지 않는다", async () => {
  const h = harness();
  h.state.original!.annotation_of = "parent-photo";
  await expectRejected(h, audioRequest(), 400);
});

test("이미지·영상·JSON + commentOf는 크기·대상 조회 전에 400이다", async () => {
  for (const type of ["image/jpeg", "image/png", "video/mp4", "application/json"]) {
    const h = harness();
    h.state.original = null;
    await expectRejected(h, audioRequest({ type }), 400);
    assert.deepEqual(h.state.lookups, []);
  }
});

test("commentOf 없는 오디오는 JWT·공유 토큰 모두 400이며 독립 미디어를 만들지 않는다", async () => {
  for (const auth of ["jwt", "shared"] as const) {
    for (const type of ["audio/mp4", "audio/aac"]) {
      const h = harness();
      h.state.auth = auth;
      await expectRejected(h, audioRequest({ type, parentField: null }), 400);
      await expectRejected(h, audioRequest({ type, fields: { commentOf: "  " } }), 400);
      assert.deepEqual(h.state.lookups, []);
    }
  }
});

test("MIME 없는 m4a·aac의 기존 확장자 추론은 댓글에서도 유지한다", async () => {
  for (const [filename, expected] of [["VOICE.M4A", "audio/mp4"], ["voice.aac", "audio/aac"]]) {
    for (const type of ["", "application/octet-stream"]) {
      const h = harness();
      assert.equal((await h.upload.POST(audioRequest({ type, filename }))).status, 200);
      assert.equal(h.state.puts[0]?.contentType, expected);
      await expectRejected(harness(), audioRequest({ type, filename, parentField: null }), 400);
    }
  }
});

test("확장자 위장으로 이미지 댓글·독립 오디오를 만들 수 없다", async () => {
  await expectRejected(harness(), audioRequest({ type: "image/gif", filename: "voice.m4a" }), 400);
  await expectRejected(harness(), audioRequest({ type: "audio/wav", filename: "photo.jpg", parentField: null }), 400);
});

test("10MiB는 허용하고 1바이트 초과는 대상 조회 전에 413이다", async () => {
  const h = harness();
  assert.equal((await h.upload.POST(audioRequest({ size: 10 * 1024 * 1024 }))).status, 200);
  assert.equal(h.state.puts[0]?.bytes.length, 10 * 1024 * 1024);
  const denied = harness();
  denied.state.original = null;
  await expectRejected(denied, audioRequest({ size: 10 * 1024 * 1024 + 1 }), 413);
  assert.deepEqual(denied.state.lookups, []);
});

test("사진·영상은 10MiB 음성 제한 없이 기존 메타데이터와 JWT·공유 토큰 업로드를 유지한다", async () => {
  for (const auth of ["jwt", "shared"] as const) {
    for (const [type, filename, mediaType] of [["image/jpeg", "photo.jpg", "image"], ["video/mp4", "video.mp4", "video"]]) {
      const h = harness();
      h.state.auth = auth;
      const fields = { dateKey: "2026-09-10", capturedAt: "2026-09-10T08:30:00+09:00",
        ocrText: "기존 OCR", title: "기존 제목", siteId: "현장", uploader: "폼 이름", workerId: "form-worker",
        roadAddress: "기존 주소", latitude: "37.5", longitude: "127.1" };
      const response = await h.upload.POST(audioRequest({ type, filename, parentField: null,
        size: 10 * 1024 * 1024 + 1, fields }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ["media", "ok"]);
      assert.equal(body.media.mediaType, mediaType);
      for (const key of ["dateKey", "capturedAt", "ocrText", "title", "siteId", "roadAddress"] as const) {
        assert.equal(body.media[key], fields[key]);
      }
      assert.equal(body.media.uploader, auth === "jwt" ? "JWT의 옛 이름" : "폼 이름");
      assert.equal(body.media.workerId, auth === "jwt" ? "EMP-officer-login" : "form-worker");
      assert.equal(body.media.latitude, 37.5);
      assert.equal(body.media.longitude, 127.1);
      assert.equal(body.media.mediaUrl, null);
      assert.equal(h.state.puts[0]?.contentType, type);
      assert.equal(h.state.puts[0]?.bytes.length, 10 * 1024 * 1024 + 1);
      assert.equal(h.state.mediaInserts.length, 1);
      assert.equal(h.state.comments.length, 0);
      assert.deepEqual(h.state.lookups, []);
      assert.deepEqual(h.state.profiles, []);
    }
  }
});

for (const role of ["worker", "admin", "owner"]) {
  test(`${role} JWT는 남의 사진·사번 없는 사진에도 댓글을 남긴다`, async () => {
    for (const workerId of ["EMP-other", null]) {
      const h = harness();
      h.state.role = role;
      h.state.workerId = null;
      h.state.original!.worker_id = workerId;
      assert.equal((await h.upload.POST(audioRequest())).status, 200);
      assert.equal(h.state.comments[0]?.author_id, "officer-login");
      assert.equal(h.state.aliasLookups, 0, "댓글에 사진 소유권·사번 병합 검사를 적용하면 안 된다");
    }
  });
}

test("폼 작성자 위조를 무시하고 기존 글 댓글과 같은 JWT·프로필 작성자를 쓴다", async () => {
  for (const role of ["admin", "owner"]) {
    for (const profile of ["registered", "missing", "failed"] as const) {
      const h = harness();
      h.state.role = role;
      if (profile === "missing") { h.state.user = null; h.state.owner = null; }
      h.state.profileFailure = profile === "failed";
      const fields = { authorId: "위조", authorName: "위조", authorRole: "owner", authorTitle: "위조",
        author_id: "위조", author_name: "위조", workerId: "위조", uploader: "위조", name: "위조", body: "위조" };
      const voice = (await (await h.upload.POST(audioRequest({ fields }))).json()).comment;
      const text = (await (await h.comment.POST(textRequest())).json()).comment;
      for (const key of ["author_id", "author_name", "author_role", "author_title"]) assert.equal(voice[key], text[key]);
      assert.equal(voice.author_id, "officer-login");
      assert.equal(voice.author_role, role);
      assert.equal(voice.body, "");
      const expected = profile === "registered"
        ? role === "owner" ? ["소유자 이름", "현장 책임자"] : ["담당관 이름", "안전 담당관"]
        : role === "owner" ? ["관리자", "시스템 관리자"] : ["officer-login", null];
      assert.deepEqual([voice.author_name, voice.author_title], expected);
      assert.deepEqual(h.state.profiles, Array(2).fill(`${role === "owner" ? "owner" : "users"}:officer-login`));
    }
  }
});

test("공유 토큰·무인증·JWT 로그인 ID 누락은 폼 신원을 보내도 음성 댓글을 생성하지 못한다", async () => {
  for (const auth of ["shared", "none"] as const) {
    const h = harness();
    h.state.auth = auth;
    await expectRejected(h, audioRequest({ fields: { authorId: "officer-login", role: "owner" } }), 401);
  }
  for (const username of [null, "", "  "]) {
    const h = harness();
    h.state.username = username;
    await expectRejected(h, audioRequest(), 401);
  }
});

test("선택 길이는 audioMs·audio_ms의 정수만 저장하고 누락·잘못된 값은 null이다", async () => {
  for (const field of ["audioMs", "audio_ms"]) {
    for (const [value, expected] of [["0", 0], ["7000", 7000], ["2147483647", 2147483647],
      ["", null], ["-1", null], ["7.5", null], ["NaN", null], ["Infinity", null], ["2147483648", null]] as const) {
      const h = harness();
      assert.equal((await h.upload.POST(audioRequest({ fields: { [field]: value } }))).status, 200);
      assert.equal(h.state.comments[0]?.audio_ms, expected);
    }
  }
  const h = harness();
  await h.upload.POST(audioRequest());
  assert.equal(h.state.comments[0]?.audio_ms, null);
});

test("스토리지 미설정·업로드 실패는 음성 댓글 행을 생성하지 않는다", async () => {
  for (const mode of ["config", "put"]) {
    const h = harness();
    h.state.storageOn = mode !== "config";
    h.state.putFailure = mode === "put";
    await expectRejected(h, audioRequest(), mode === "config" ? 503 : 502);
  }
});

test("글 댓글 등록·조회·수정은 JWT·관제 세션·Basic에서 기존 응답과 null 음성 필드를 유지한다", async () => {
  for (const auth of ["jwt", "session", "basic"] as const) {
    const h = harness();
    h.state.auth = auth;
    const response = await h.comment.POST(textRequest());
    assert.equal(response.status, 200);
    const { comment } = await response.json();
    assert.equal(comment.body, "사진 확인했습니다");
    assert.deepEqual([comment.audio_storage_key, comment.audio_url, comment.audio_ms], [null, null, null]);
    assert.equal(comment.author_id, auth === "basic" ? "admin" : "officer-login");
    const list = await (await h.calendar.GET(listing())).json();
    assert.deepEqual(list.media[0].comments, [comment]);
    assert.deepEqual(h.state.signed, []);
    const patch = await h.comment.PATCH(new Request("https://fixture.test/api/calendar/media/comment", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: comment.id, body: " 수정된 글 " }),
    }));
    assert.equal(patch.status, 200);
    assert.deepEqual(await patch.json(), { ok: true });
    assert.equal(h.state.comments[0]?.body, "수정된 글");
  }
});

test("글 댓글의 빈 글·잘못된 JSON·무인증 거부는 그대로다", async () => {
  const h = harness();
  assert.equal((await h.comment.POST(textRequest("  "))).status, 400);
  assert.equal((await h.comment.POST(new Request("https://fixture.test", { method: "POST", body: "{" }))).status, 400);
  h.state.auth = "none";
  assert.equal((await h.comment.POST(textRequest())).status, 401);
  assert.equal(h.state.comments.length, 0);
});

test("글·음성·글이 한 목록에 시간순으로 나오고 음성 저장 키로만 URL을 발급한다", async () => {
  const h = harness();
  await h.comment.POST(textRequest("첫 글"));
  await h.upload.POST(audioRequest({ fields: { audio_ms: "7000" } }));
  await h.comment.POST(textRequest("마지막 글"));
  const voice = h.state.comments[1]!;
  // 반환 순서는 저장 배열이 아니라 실제 SELECT의 created_at 오름차순 계약을 따른다.
  h.state.comments.reverse();
  const { media } = await (await h.calendar.GET(listing())).json();
  assert.equal(media.length, 1);
  const comments = media[0].comments as CalendarMediaCommentRow[];
  assert.deepEqual(comments.map((c) => c.body), ["첫 글", "", "마지막 글"]);
  assert.deepEqual(comments.map((c) => c.audio_ms), [null, 7000, null]);
  assert.equal(comments[1]?.audio_storage_key, voice.audio_storage_key);
  assert.equal(comments[1]?.audio_url, `https://storage.test/${voice.audio_storage_key}?signed=fixture`);
  assert.deepEqual(h.state.signed, [voice.audio_storage_key]);
  assert.equal(h.state.mediaInserts.length, 0);
});

test("음성 URL 발급 실패·스토리지 미설정 때 기존 URL·null을 유지하고 사진 URL 발급은 계속된다", async () => {
  for (const storageOn of [true, false]) {
    for (const audioUrl of [null, "https://fixture.test/existing-audio"]) {
      const h = harness();
      await h.db.insertCalendarMediaComment({ id: "voice-id", mediaId: "photo-id", body: "",
        audioStorageKey: "voice.m4a", audioUrl, audioMs: 7000 });
      h.state.storageOn = storageOn;
      h.state.signFailures.add("voice.m4a");
      Object.assign(h.state.original!, { storage_provider: "naver", storage_key: "photo.jpg", media_url: "existing-photo" });
      const response = await h.calendar.GET(listing());
      assert.equal(response.status, 200);
      const { media } = await response.json();
      assert.equal(media[0].comments[0].audio_url, audioUrl);
      assert.equal(media[0].media_url, storageOn ? "https://storage.test/photo.jpg?signed=fixture" : "existing-photo");
      assert.deepEqual(h.state.signed, storageOn ? ["voice.m4a", "photo.jpg"] : []);
    }
  }
});

test("다른 사진 댓글은 섞이지 않고 빈 미디어 목록은 댓글 SQL을 실행하지 않는다", async () => {
  const h = harness();
  await h.db.insertCalendarMediaComment({ id: "other", mediaId: "other-photo", body: "다른 댓글" });
  assert.deepEqual(await h.db.listCommentsForMedia(["photo-id"]), []);
  const count = h.state.queries.length;
  assert.deepEqual(structuredClone(await h.db.listCommentsForMedia([])), []);
  assert.equal(h.state.queries.length, count);
});

test("댓글 DB 삭제는 작성자 조건을 통과한 음성 키만 반환한다", async () => {
  const h = harness();
  await h.db.insertCalendarMediaComment({ id: "voice", mediaId: "photo-id", body: "",
    authorId: "author", audioStorageKey: "voice.m4a" });
  assert.equal(await h.db.deleteCalendarMediaComment("voice", { authorId: "other" }), null);
  assert.equal(h.state.comments.length, 1);
  const deleted = await h.db.deleteCalendarMediaComment("voice", { authorId: "author" });
  assert.deepEqual(structuredClone(deleted), { audioStorageKey: "voice.m4a" });
  const query = h.state.queries.at(-1)!;
  assert.match(query.sql, /WHERE id = \$1 AND author_id = \$2 RETURNING audio_storage_key/);
  assert.deepEqual(query.params, ["voice", "author"]);
  assert.equal(await h.db.deleteCalendarMediaComment("voice", "moderator"), null);
});

for (const role of ["admin", "owner"]) {
  test(`음성 댓글 삭제: ${role === "owner" ? "owner가 타인 댓글" : "작성자가 본인 댓글"}을 지운 뒤 파일도 지운다`, async () => {
    const h = harness();
    await h.upload.POST(audioRequest());
    const voice = h.state.comments[0]!;
    h.state.role = role;
    if (role === "owner") h.state.username = "another-owner";
    h.state.events = [];
    const response = await h.comment.DELETE(deletion(voice.id));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(h.state.events, ["댓글 삭제", "객체 삭제"]);
    assert.deepEqual(h.state.deletes, [voice.audio_storage_key]);
    assert.equal(h.state.comments.length, 0);
    if (role === "owner") assert.doesNotMatch(h.state.queries.at(-1)!.sql, /author_id =/);
  });
}

test("글 댓글 삭제는 성공하되 파일 키·삭제 호출이 없다", async () => {
  const h = harness();
  const { comment } = await (await h.comment.POST(textRequest())).json();
  assert.deepEqual(structuredClone(await h.db.deleteCalendarMediaComment(comment.id, "moderator")), { audioStorageKey: null });
  const second = (await (await h.comment.POST(textRequest())).json()).comment;
  const response = await h.comment.DELETE(deletion(second.id));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(h.state.deletes, []);
});

test("댓글 없음·남의 댓글·무인증·DB 삭제 실패는 파일 삭제로 이어지지 않는다", async () => {
  for (const mode of ["missing", "other", "auth", "db"]) {
    const h = harness();
    await h.upload.POST(audioRequest());
    const id = h.state.comments[0]!.id;
    if (mode === "other") h.state.username = "another-admin";
    if (mode === "auth") h.state.auth = "none";
    if (mode === "db") {
      h.state.dbFailure = "delete";
      await assert.rejects(h.comment.DELETE(deletion(id)), /검증용 DB 삭제 실패/);
    } else {
      assert.equal((await h.comment.DELETE(deletion(mode === "missing" ? "missing" : id))).status, mode === "auth" ? 401 : 404);
    }
    assert.equal(h.state.comments.length, 1);
    assert.deepEqual(h.state.deletes, []);
  }
});

test("파일 삭제 실패는 기존 사진 삭제처럼 성공 응답을 유지하고 고아 로그를 남긴다", async () => {
  const h = harness();
  await h.upload.POST(audioRequest());
  const voice = h.state.comments[0]!;
  h.state.deleteFailure = true;
  h.state.warnings = [];
  const response = await h.comment.DELETE(deletion(voice.id));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(h.state.comments.length, 0);
  assert.deepEqual(h.state.deletes, [voice.audio_storage_key]);
  assert.equal(h.state.warnings.length, 1);
  assert.ok(h.state.warnings[0]?.includes("고아") && h.state.warnings[0]?.includes(voice.audio_storage_key!));
});

test("스토리지 미설정 댓글 삭제는 행만 지우고 객체 삭제를 호출하지 않는다", async () => {
  const h = harness();
  await h.upload.POST(audioRequest());
  h.state.storageOn = false;
  assert.equal((await h.comment.DELETE(deletion(h.state.comments[0]!.id))).status, 200);
  assert.equal(h.state.comments.length, 0);
  assert.deepEqual(h.state.deletes, []);
});

test("캘린더의 독립 오디오 분기·표시·길이 상태는 사라지고 경보 소리는 유지한다", () => {
  const source = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");
  assert.doesNotMatch(source, /mediaType === "audio"|audio: "녹음"|🎙|audioDurations|rememberAudioDuration|<audio\b/);
  assert.match(source, /const \[audioArmed, setAudioArmed\]/);
});
