// AED 점검 NFC URL 서명 — 서명된 태그에서 온 제출만 허용해 위조(임의 인터넷 POST)를 차단(서버 전용 비밀).
// 비밀은 AED_INSPECT_SECRET(env). **fail-closed** — 미설정 시 소스 상수로 폴백하지 않고 서명·검증을 거부한다
// (admin-auth·app-jwt 와 동일 정책). 소스에 커밋된 상수로 폴백하면 소스를 본 누구나 위조 서명을 계산할 수 있다.
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.AED_INSPECT_SECRET ?? "";

// aedId 에 대한 안정적 서명(태그 URL 의 ?sig= 값). 장비당 고정. 시크릿 미설정이면 throw(라우트에서 500).
export function aedInspectSig(aedId: string): string {
  if (!SECRET) {
    throw new Error("AED_INSPECT_SECRET 미설정 — AED 서명 비활성(fail-closed). .env/시크릿에 설정하세요.");
  }
  return createHmac("sha256", SECRET).update(aedId).digest("base64url");
}

// 제출된 sig 가 aedId 의 정당한 서명인지 timing-safe 비교. 시크릿 미설정이면 항상 거부(fail-closed).
export function verifyAedSig(aedId: string, sig: string): boolean {
  if (!SECRET || !sig) return false;
  const expected = Buffer.from(aedInspectSig(aedId));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
