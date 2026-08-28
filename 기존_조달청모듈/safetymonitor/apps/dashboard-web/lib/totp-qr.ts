// TOTP 등록용 QR — otpauth URI 를 data URI 로 만든다. 화면은 <img src> 에 그대로 넣는다.
//
// ★ uqr 을 고른 이유(2026-08-28 Socket 검사 후 사용자 승인) = **의존성 0**.
//   널리 쓰이는 `qrcode` 는 의존성 28개에 transitive overall 64 였는데, 낮은 점수의 출처가
//   yargs·set-blocking 같은 **안 쓸 CLI 파서 트리**였다(우리는 라이브러리 API 만 쓴다).
//   uqr 은 transitive overall 81 · 의존성 0 · 권한이 url 하나뿐이다(qrcode 는 fs 도 요구).
//
// ⚠ PNG 가 아니라 SVG 다. 해상도 독립이라 확대해도 또렷하고 인코딩 비용이 없다.
//   대신 base64 로 감싸야 한다 — 원시 SVG 를 data URI 에 그대로 넣으면 '#'·'<' 같은 글자가
//   URI 문법과 충돌해 브라우저마다 다르게 깨진다.
import { renderSVG } from "uqr";

// otpauth URI → SVG data URI. 실패하면 null(화면이 문자열 등록으로 안내한다 — QR 은 선택이다).
export function totpQrDataUri(otpauthUri: string): string | null {
  try {
    const svg = renderSVG(otpauthUri);
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  } catch {
    // QR 은 편의 경로다 — 여기서 실패해도 등록 자체는 키 문자열로 끝까지 갈 수 있어야 한다.
    return null;
  }
}
