// 앱(현장 단말) 단일 업로드 — 사진/영상/녹음/잉크+메타를 받아 서버가 Object Storage 업로드 + 캘린더 DB 등록.
import { NextResponse } from "next/server";

import { appUploadTokenMatches, verifyAppUploadToken } from "../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../lib/app-jwt";
import {
  findUserByUsername,
  getCalendarMediaById,
  getOwnerProfile,
  getWorkerAliasMap,
  insertCalendarMedia,
  insertCalendarMediaComment,
} from "../../../lib/db";
import { mediaMatchesScope, workerIdGroup, type MediaScope } from "../../../lib/media-scope";
import { isStorageConfigured, putObject } from "../../../lib/storage";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INK_BYTES = 2 * 1024 * 1024; // 기존 미디어 업로드 상한 없음 — 실측 후 조정할 2MB.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "application/json": "json",
};
const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4a: "audio/mp4",
  aac: "audio/aac",
  json: "application/json",
};

// 흔한 필드명 변형 중 첫 비어있지 않은 값.
function pick(form: FormData, keys: string[]): string | null {
  for (const k of keys) {
    const v = form.get(k);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// 숫자 문자열 → number(유효할 때만), 아니면 null. GPS 좌표 파싱용.
function toNum(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// KST 기준 현재 시각/날짜 — 앱이 촬영시각을 안 보낼 때 폴백.
function nowKstIso(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19) + "+09:00";
}
function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 작업 ID가 있으면 DB가 INSERT로 키를 확보한 뒤 upload를 호출한다.
// 없으면 기존 PUT → INSERT 순서와 응답 계약을 유지한다.
async function saveUpload<T extends { id: string }>(
  operationId: string | null,
  file: File,
  key: string,
  contentType: string,
  resultField: "media" | "comment",
  insert: (id: string, upload?: () => Promise<void>) => Promise<T>,
) {
  const id = crypto.randomUUID();
  let uploadFailed = false;
  const upload = async () => {
    try {
      await putObject(key, new Uint8Array(await file.arrayBuffer()), contentType);
    } catch (e) {
      uploadFailed = true;
      console.error("[app-media] putObject 실패", e);
      throw e;
    }
  };
  try {
    if (!operationId) await upload();
    const row = await insert(id, operationId ? upload : undefined);
    return NextResponse.json({
      ok: true,
      [resultField]: row,
      ...(operationId ? { clientOperationId: operationId, deduplicated: row.id !== id } : {}),
    });
  } catch (e) {
    if (uploadFailed) {
      return NextResponse.json({ ok: false, error: "스토리지 업로드 실패" }, { status: 502 });
    }
    throw e;
  }
}

export async function POST(request: Request) {
  const ctype = request.headers.get("content-type") ?? "";

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // 진단 — 앱이 multipart 가 아니면 어떤 형식인지 로그로 남긴다.
    console.warn(`[app-media] formData 파싱 실패 content-type=${ctype}`);
    return NextResponse.json(
      { ok: false, error: "multipart/form-data 로 사진/영상/녹음/잉크 파일을 첨부하세요", contentType: ctype },
      { status: 400 },
    );
  }

  // 진단 로그(값 미포함) — 앱이 실제 보내는 필드명/파일 유무/인증 방식.
  const fieldNames = [...form.keys()];
  const fileEntry = [...form.entries()].find(
    ([, v]) => typeof v !== "string" && (v as Blob).size > 0,
  );
  console.warn(
    `[app-media] content-type=${ctype} fields=${JSON.stringify(fieldNames)} fileField=${fileEntry?.[0] ?? null} authHeader=${!!request.headers.get("authorization")}`,
  );

  // 인증 — 앱 로그인 JWT(사용자별), 공유 APP_UPLOAD_TOKEN(Bearer/헤더/폼) 중 하나라도 유효.
  const jwtClaims = verifyAppJwt(bearerToken(request));
  const authed =
    jwtClaims != null ||
    verifyAppUploadToken(request) ||
    appUploadTokenMatches(request.headers.get("x-app-upload-token")) ||
    appUploadTokenMatches(pick(form, ["token", "appUploadToken", "app_upload_token", "APP_UPLOAD_TOKEN"]));
  if (!authed) {
    return NextResponse.json({ ok: false, error: "인증 필요(APP_UPLOAD_TOKEN)" }, { status: 401 });
  }

  const operationIds = form.getAll("clientOperationId");
  const operationId = operationIds[0];
  // 잘못 보낸 키를 미전송으로 취급하면 재시도 때 조용히 중복이 생긴다.
  if (operationIds.length > 1 || (operationId !== undefined &&
      (typeof operationId !== "string" || !operationId.trim() ||
       operationId !== operationId.trim() || operationId.length > 128))) {
    return NextResponse.json(
      { ok: false, error: "clientOperationId는 앞뒤 공백 없는 1~128자 문자열 하나여야 합니다" },
      { status: 400 },
    );
  }
  const clientOperationId = typeof operationId === "string" ? operationId : null;

  if (!isStorageConfigured()) {
    return NextResponse.json({ ok: false, error: "스토리지(Object Storage) 미설정" }, { status: 503 });
  }

  if (!fileEntry) {
    return NextResponse.json(
      { ok: false, error: "사진/영상/녹음/잉크 파일이 없습니다", receivedFields: fieldNames },
      { status: 400 },
    );
  }
  const file = fileEntry[1] as File;

  // 콘텐츠타입 결정 — 파트 타입 우선, 없으면 파일명 확장자로 추론.
  let contentType = file.type || "";
  let ext = EXT_BY_TYPE[contentType];
  if (!ext) {
    const e = (file.name ?? "").toLowerCase().split(".").pop() ?? "";
    if (TYPE_BY_EXT[e]) {
      contentType = TYPE_BY_EXT[e];
      ext = EXT_BY_TYPE[contentType];
    }
  }
  if (!ext) {
    return NextResponse.json(
      { ok: false, error: `지원하지 않는 형식(jpg/png/webp/heic/mp4/mov/m4a/aac/json만): type=${file.type} name=${file.name}` },
      { status: 400 },
    );
  }

  const commentOf = pick(form, ["commentOf", "comment_of", "commentOfId", "comment_of_id"]);
  const declaredType = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  // 확장자 추론이 명시된 이미지/영상 타입을 음성으로 바꾸거나, 음성을 독립 사진으로 숨기지 못하게 한다.
  const isAudio = contentType.startsWith("audio/") &&
    (!declaredType || declaredType === "application/octet-stream" || declaredType.startsWith("audio/"));
  if (commentOf && !isAudio) {
    return NextResponse.json({ ok: false, error: "댓글에는 오디오 파일만 첨부할 수 있습니다" }, { status: 400 });
  }
  if (!commentOf && (contentType.startsWith("audio/") || declaredType.startsWith("audio/"))) {
    return NextResponse.json({ ok: false, error: "오디오는 commentOf(원본 사진 ID)가 있는 댓글로만 올릴 수 있습니다" }, { status: 400 });
  }
  if (commentOf) {
    // 공유 토큰에는 작성자 신원이 없다. 댓글은 앱 JWT의 로그인 ID로만 귀속한다.
    if (typeof jwtClaims?.sub !== "string" || !jwtClaims.sub.trim()) {
      return NextResponse.json({ ok: false, error: "음성 댓글에는 앱 로그인 인증이 필요합니다" }, { status: 401 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ ok: false, error: "음성 댓글은 최대 10MB까지 허용됩니다" }, { status: 413 });
    }
    const original = await getCalendarMediaById(commentOf);
    if (!original) {
      return NextResponse.json({ ok: false, error: "댓글을 남길 원본 사진을 찾을 수 없습니다" }, { status: 404 });
    }
    if (original.annotation_of !== null) {
      return NextResponse.json({ ok: false, error: "잉크본에는 음성 댓글을 남길 수 없습니다" }, { status: 400 });
    }

    // calendar/media/comment의 resolveAuthor와 동일: JWT sub=username, 표시정보는 DB 프로필.
    // 댓글은 소통 수단이므로 원본의 작성자·사번과 일치할 필요가 없다.
    const username = jwtClaims.sub;
    const role = jwtClaims.role;
    const owner = role === "owner" ? await getOwnerProfile(username).catch(() => null) : null;
    const user = role !== "owner" ? await findUserByUsername(username).catch(() => null) : null;
    const duration = toNum(pick(form, ["audioMs", "audio_ms"]));
    // 선택 메타데이터: PostgreSQL INTEGER 범위의 0 이상 정수만 보관한다.
    const audioMs = duration !== null && Number.isInteger(duration) && duration >= 0 && duration <= 2_147_483_647
      ? duration : null;
    const key = `calendar-media/${original.date_key}/${crypto.randomUUID()}.${ext}`;
    return saveUpload(clientOperationId, file, key, contentType, "comment", (id, upload) => insertCalendarMediaComment({
      id,
      clientOperationId,
      mediaId: commentOf,
      body: "",
      authorId: username,
      authorRole: role,
      authorName: role === "owner" ? owner?.name ?? "관리자" : user?.name ?? username,
      authorTitle: role === "owner" ? owner?.job_title ?? "시스템 관리자" : user?.job_title ?? null,
      audioStorageKey: key,
      audioUrl: null,
      audioMs,
    }, upload));
  }

  // 메타 — 앱이 보내면 사용, 없으면 KST 현재로 폴백.
  const capturedAt = pick(form, ["capturedAt", "captured_at", "time", "datetime", "takenAt"]) ?? nowKstIso();
  let dateKey = pick(form, ["dateKey", "date"]) ?? "";
  if (!DATE_RE.test(dateKey)) {
    dateKey = capturedAt.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? todayKst();
  }
  const ocrText = pick(form, ["ocrText", "ocr", "ocr_text", "text"]);
  const title = pick(form, ["title"]);
  const siteId = pick(form, ["siteId", "site", "site_id"]);
  // 귀속 위조 방지 — 로그인 JWT 로 인증했으면 JWT 신원(name/workerId)을 강제하고 폼 값은 무시한다.
  // (폼 workerId 가 JWT 보다 우선하면 인증된 사용자가 미디어를 타인에게 귀속시킬 수 있음.)
  // APP_UPLOAD_TOKEN 만의 익명 기기 업로드는 신원이 없어 폼 값 폴백을 허용.
  const uploader = jwtClaims?.name ?? pick(form, ["uploader", "workerName", "worker", "name"]) ?? null;
  const workerId =
    jwtClaims?.workerId ?? pick(form, ["workerId", "worker_id", "employeeId", "empId", "empNo"]) ?? null;
  const roadAddress = pick(form, ["roadAddress", "road_address", "address", "addr", "roadAddr"]);
  const latitude = toNum(pick(form, ["latitude", "lat", "gpsLat"]));
  const longitude = toNum(pick(form, ["longitude", "lng", "lon", "gpsLng", "gpsLon"]));
  const annotationOf = pick(form, ["annotationOf", "annotation_of", "annotationOfId", "annotation_of_id"]);
  const mediaType = contentType.startsWith("video/")
    ? "video"
    : contentType === "application/json"
      ? "ink"
      : "image";

  if (mediaType === "ink") {
    // JSON 파싱·스토리지 업로드 전에 바이트 크기를 확인한다.
    if (file.size > MAX_INK_BYTES) {
      return NextResponse.json({ ok: false, error: "잉크 JSON은 최대 2MB까지 허용됩니다" }, { status: 413 });
    }
    if (!annotationOf) {
      return NextResponse.json({ ok: false, error: "잉크본에는 annotationOf(원본 ID)가 필요합니다" }, { status: 400 });
    }
    let ink: unknown;
    try {
      ink = JSON.parse(await file.text());
    } catch {
      return NextResponse.json({ ok: false, error: "잉크 파일은 유효한 JSON이어야 합니다" }, { status: 400 });
    }
    // 획·도구·렌더 규칙은 앱 계약이다. 서버는 최상위 정수 버전만 확인하고 원문을 보관한다.
    if (typeof ink !== "object" || ink === null || Array.isArray(ink) ||
        !Number.isInteger((ink as { v?: unknown }).v)) {
      return NextResponse.json({ ok: false, error: "잉크 JSON 최상위에 정수 v(형식 버전)가 필요합니다" }, { status: 400 });
    }

    const original = await getCalendarMediaById(annotationOf);
    if (!original) {
      return NextResponse.json({ ok: false, error: "잉크본을 연결할 원본을 찾을 수 없습니다" }, { status: 404 });
    }
    if (original.annotation_of !== null) {
      return NextResponse.json({ ok: false, error: "잉크본을 원본으로 지정할 수 없습니다" }, { status: 400 });
    }
    // 기존 미디어 수정·삭제 규칙: owner는 moderator, 나머지는 JWT 사번의 병합 그룹.
    // 공유 업로드 토큰·폼 사번은 작성자 증명이 아니므로 권한 범위에 사용하지 않는다.
    const jwtWorkerId = jwtClaims?.workerId?.trim();
    const scope: MediaScope | null = jwtClaims?.role === "owner"
      ? "moderator"
      : jwtWorkerId
        ? { workerIds: workerIdGroup(jwtWorkerId, await getWorkerAliasMap()) }
        : null;
    if (!scope || !mediaMatchesScope(original.worker_id, scope)) {
      return NextResponse.json({ ok: false, error: "본인이 올린 원본에만 잉크본을 추가할 수 있습니다" }, { status: 403 });
    }
  }

  // Object Storage 업로드 + 캘린더 DB 등록.
  const key = `calendar-media/${dateKey}/${crypto.randomUUID()}.${ext}`;
  return saveUpload(clientOperationId, file, key, contentType, "media", (id, upload) => insertCalendarMedia({
    id,
    clientOperationId,
    annotationOf: annotationOf ?? undefined,
    dateKey,
    capturedAt,
    mediaType,
    title,
    storageProvider: "naver",
    storageKey: key,
    mediaUrl: null,
    thumbnailUrl: null,
    ocrText,
    description: null,
    siteId,
    uploader,
    workerId,
    latitude,
    longitude,
    roadAddress,
  }, upload));
}
