// 워치 QR 로그인(기기 승인 · RFC 8628 형태) 순수 유틸 — 코드 생성·정규화·secret 해시·QR 행렬 (I/O 없음)
//
// ★ 왜 (2026-08-29 사용자 지시). 갤럭시워치 화면이 좁아 아이디·비번 입력이 어렵다. 워치는 코드(+QR)만 보이고,
//   폰 브라우저가 /pair 에서 자격을 넣어 승인한다. 토큰은 QR 로 나가지 않는다 — 워치가 start 때 받은 secret 을
//   든 poll 에만 내려준다(QR 사진·코드 엿보기로는 토큰을 못 가져간다).
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { encode } from "uqr";

/** 코드 유효기간(초). 5분 — 폰을 꺼내 스캔하고 비번을 치는 데 충분하고, 방치된 코드가 오래 살지 않는다. */
export const DEVICE_LOGIN_TTL_SEC = 300;
/** 코드 글자 — 0/O·1/I/L 처럼 눈으로 헷갈리는 글자를 뺐다(사람이 읽어 폰에 칠 수 있어야 한다). */
export const DEVICE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const DEVICE_CODE_LEN = 8;

/** `XXXX-XXXX` — 31^8 ≈ 8.5×10^11 · 5분 만료 · start 레이트리밋과 함께 추측을 막는다. */
export function newDeviceCode(): string {
  let s = "";
  for (let i = 0; i < DEVICE_CODE_LEN; i++) s += DEVICE_CODE_ALPHABET[randomInt(DEVICE_CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** 사람이 친 코드를 정규화 — 소문자·공백·하이픈 허용. 글자 집합 밖이거나 길이가 다르면 null(존재 여부와 무관). */
export function normalizeDeviceCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== DEVICE_CODE_LEN) return null;
  for (const ch of s) if (!DEVICE_CODE_ALPHABET.includes(ch)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** 워치만 아는 비밀 — 서버는 해시만 저장한다(DB 가 새도 토큰 수령 자격이 안 샌다). */
export function newDeviceSecret(): string {
  return randomBytes(32).toString("hex");
}

export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatches(secret: unknown, secretHash: string): boolean {
  if (typeof secret !== "string" || secret.length < 32) return false;
  const a = Buffer.from(hashDeviceSecret(secret), "hex");
  const b = Buffer.from(secretHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function pairUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/pair?code=${encodeURIComponent(code)}`;
}

/** QR 행렬 — 워치는 라이브러리 없이 `rows` 의 '1' 칸만 정사각형으로 그린다(Canvas). ECC M · 테두리 0. */
export function qrMatrix(text: string): { size: number; rows: string[] } {
  const r = encode(text, { ecc: "M", border: 0 });
  return { size: r.size, rows: r.data.map((row) => row.map((b) => (b ? "1" : "0")).join("")) };
}

/** 공개 origin — Cloud Run 앞단이 host 를 x-forwarded-host 로 준다. 없으면 요청 URL 의 origin. */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto") ?? "https";
  return fwdHost ? `${fwdProto}://${fwdHost}` : url.origin;
}
