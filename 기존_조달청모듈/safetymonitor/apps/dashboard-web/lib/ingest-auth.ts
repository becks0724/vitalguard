// 기기 수집 API(생체·CCTV·IMU) 토큰 병행 인증 — 앱 로그인 JWT 또는 공유 APP_UPLOAD_TOKEN 수용.
// soft 모드(사용자 결정): 유효 토큰=authed, 무토큰=none(한시 허용+경고), 무효 토큰=invalid(거부).
// 폰/엣지가 아직 토큰을 안 보내므로 하드 강제 시 수집이 끊긴다 → 발표 후 토큰 필수화 시 none 도 401 로.
import { appUploadTokenMatches, verifyAppUploadToken } from "./admin-auth";
import { bearerToken, verifyAppJwt } from "./app-jwt";

export type IngestAuth = "authed" | "none" | "invalid";

export function ingestAuthStatus(request: Request): IngestAuth {
  if (
    verifyAppJwt(bearerToken(request)) !== null ||
    verifyAppUploadToken(request) ||
    appUploadTokenMatches(request.headers.get("x-app-upload-token"))
  ) {
    return "authed";
  }
  const hasToken =
    !!request.headers.get("authorization") || !!request.headers.get("x-app-upload-token");
  return hasToken ? "invalid" : "none";
}
