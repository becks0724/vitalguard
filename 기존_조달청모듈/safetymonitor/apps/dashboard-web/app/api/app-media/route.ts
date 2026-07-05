// 앱(현장 단말) 단일 업로드 — OCR 이미지+메타를 한 번에 받아 서버가 Object Storage 업로드 + 캘린더 DB 등록.
import { NextResponse } from "next/server";

import { appUploadTokenMatches, verifyAppUploadToken } from "../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../lib/app-jwt";
import { insertCalendarMedia } from "../../../lib/db";
import { isStorageConfigured, putObject } from "../../../lib/storage";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};
const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
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

export async function POST(request: Request) {
  const ctype = request.headers.get("content-type") ?? "";

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // 진단 — 앱이 multipart 가 아니면 어떤 형식인지 로그로 남긴다.
    console.warn(`[app-media] formData 파싱 실패 content-type=${ctype}`);
    return NextResponse.json(
      { ok: false, error: "multipart/form-data 로 이미지 파일을 첨부하세요", contentType: ctype },
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

  if (!isStorageConfigured()) {
    return NextResponse.json({ ok: false, error: "스토리지(Object Storage) 미설정" }, { status: 503 });
  }

  if (!fileEntry) {
    return NextResponse.json(
      { ok: false, error: "이미지/영상 파일이 없습니다", receivedFields: fieldNames },
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
      { ok: false, error: `지원하지 않는 형식(jpg/png/webp/heic/mp4/mov만): type=${file.type} name=${file.name}` },
      { status: 400 },
    );
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
  const mediaType = contentType.startsWith("video/") ? "video" : "image";

  // Object Storage 업로드(서버측 PUT).
  const key = `calendar-media/${dateKey}/${crypto.randomUUID()}.${ext}`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await putObject(key, bytes, contentType);
  } catch (e) {
    console.error("[app-media] putObject 실패", e);
    return NextResponse.json({ ok: false, error: "스토리지 업로드 실패" }, { status: 502 });
  }

  // 캘린더 DB 등록.
  const row = await insertCalendarMedia({
    id: crypto.randomUUID(),
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
  });

  return NextResponse.json({ ok: true, media: row });
}
