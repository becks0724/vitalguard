// 로컬 데모 전용 가입회원 — DATABASE_URL 미설정(로컬 dev)일 때만 활성.
//   실 서버(DATABASE_URL 설정)에선 비활성 → DB의 실제 회원(admin3470 등)을 사용한다(백도어 아님).
//   목적: 로컬에서 DB 없이도 "가입회원(role=admin) → 내 정보 탭" 흐름을 시연.
//   ⚠ 아래 비밀번호는 로컬 시연 전용. 실 서버 인증과 무관(DEMO 비활성). 커밋 시 노출 유의.
//   in-memory(프로세스 단위) — 내 정보 수정(POST) 반영, dev 재시작 시 초기값으로 리셋.

import { DEFAULT_ORG_TYPE } from "./org-type";

export const DEMO_ENABLED = !process.env.DATABASE_URL;

export type DemoProfile = {
  username: string;
  name: string | null;
  company: string | null;
  // 가입 유형 — 회사(상호) 선택지를 정한다. 실 DB 경로와 같은 검증을 타게 하려고 데모에도 둔다
  // (없으면 로컬에서만 유형 검증이 통과해 "로컬은 되는데 서버는 거부"가 된다).
  org_type: string;
  phone: string | null;
  carrier: string | null;
  email: string | null;
  auth_provider: string;
  department: string | null;
  job_title: string | null;
  employee_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  admin_access: boolean;
};

type DemoEntry = { password: string; profile: DemoProfile };

function seed(): Map<string, DemoEntry> {
  return new Map<string, DemoEntry>([
    [
      "admin3470",
      {
        password: "57053470",
        profile: {
          username: "admin3470",
          name: "현장안전관리자",
          company: null, // 내 정보에서 승인 회사 선택(저장 시 검증)
          org_type: DEFAULT_ORG_TYPE,
          phone: null,
          carrier: null,
          email: "admin3470@safetymonitor.local",
          auth_provider: "password",
          department: "안전관리팀",
          job_title: "현장 안전관리자",
          employee_id: null,
          guardian_name: null,
          guardian_phone: null,
          admin_access: false,
        },
      },
    ],
  ]);
}

// HMR/요청 간 in-memory 상태 보존(프로세스 단위).
const g = globalThis as typeof globalThis & { __demoMembers?: Map<string, DemoEntry> };
const store: Map<string, DemoEntry> = g.__demoMembers ?? (g.__demoMembers = seed());

export function verifyDemoMember(id: string, password: string): boolean {
  const m = store.get(id);
  return !!m && m.password === password;
}

export function getDemoProfile(username: string): DemoProfile | null {
  return store.get(username)?.profile ?? null;
}

export function updateDemoProfile(username: string, patch: Partial<DemoProfile>): DemoProfile | null {
  const m = store.get(username);
  if (!m) return null;
  m.profile = { ...m.profile, ...patch };
  return m.profile;
}

// ── env 관리자(owner) 내 정보 ───────────────────────────────────────────────
// 실서버는 owner_profile 테이블에 저장한다. DB 없는 로컬에서도 같은 흐름을 시연하려고 한 칸만 메모리에 둔다.
// 비밀번호는 여기 없다 — owner 자격은 env(ADMIN_ID/ADMIN_PASSWORD)가 단일 소스.
export type DemoOwnerProfile = {
  name: string | null;
  company: string | null;
  phone: string | null;
  carrier: string | null;
  department: string | null;
  job_title: string | null;
  employee_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
};

const ownerG = globalThis as typeof globalThis & { __demoOwnerProfile?: Map<string, DemoOwnerProfile> };
const ownerStore: Map<string, DemoOwnerProfile> =
  ownerG.__demoOwnerProfile ?? (ownerG.__demoOwnerProfile = new Map());

export function getDemoOwnerProfile(username: string): DemoOwnerProfile | null {
  return ownerStore.get(username) ?? null;
}

export function setDemoOwnerProfile(username: string, p: DemoOwnerProfile): DemoOwnerProfile {
  ownerStore.set(username, p);
  return p;
}
