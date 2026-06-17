// AED 점검 NFC URL 서명 — 서명된 태그에서 온 제출만 허용해 위조(임의 인터넷 POST)를 차단(서버 전용 비밀).
// 비밀은 AED_INSPECT_SECRET(env). 상용화 시 반드시 강한 값으로 설정(dev fallback 은 소스 노출 시 무력).
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.AED_INSPECT_SECRET ?? "safetymonitor-dev-aed-inspect";

// aedId 에 대한 안정적 서명(태그 URL 의 ?sig= 값). 장비당 고정.
export function aedInspectSig(aedId: string): string {
  return createHmac("sha256", SECRET).update(aedId).digest("base64url");
}

// 제출된 sig 가 aedId 의 정당한 서명인지 timing-safe 비교.
export function verifyAedSig(aedId: string, sig: string): boolean {
  if (!sig) return false;
  const expected = Buffer.from(aedInspectSig(aedId));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
