// 검증 화면 경로 ↔ 영역 매핑 — 화면(LoginGate)과 서버(API 게이트)가 같은 표를 본다.
// 둘이 어긋나면 "메뉴엔 안 보이는데 API 는 열려 있는" 구멍이 생긴다.
//
// 영역이 없는 경로(/, /assignment, /erp, /aed/inspect)는 소속과 무관하게 공통이다
// — 2026-08-28 사용자 결정: 검증 화면만 소속별로 가르고 관제·배치·ERP·AED 는 양쪽 다 본다.
import type { VerificationArea } from "./org-type";

// 경로 접두사 → 영역. 긴 접두사가 먼저 오도록 정렬해 둔다(부분 일치 오판 방지).
const AREA_ROUTES: readonly { prefix: string; area: VerificationArea }[] = [
  { prefix: "/safeprocure", area: "safetyCost" },
  { prefix: "/safety-audit", area: "safetyCost" },
  { prefix: "/weekly-report", area: "safetyCost" },
  { prefix: "/contractor", area: "safetyCost" },
  { prefix: "/subsidy-audit", area: "subsidy" },
];

// 이 경로가 속한 검증 영역(공통 경로면 null).
export function areaForPath(pathname: string): VerificationArea | null {
  for (const r of AREA_ROUTES) {
    if (pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)) return r.area;
  }
  return null;
}

// 영역에 속한 대표 경로 — 접근이 막혔을 때 어디로 보낼지 정할 때 쓴다.
export const AREA_HOME: Record<VerificationArea, string> = {
  safetyCost: "/safeprocure",
  subsidy: "/subsidy-audit",
};
