// 사용자 관리(owner·관리 권한 VitAlGuard 관리자) — DB 스키마 그대로 테이블 표시 + 승인/거절/재승인/탈퇴 + 실시간 갱신(폴링). /api/admin/users (Bearer 토큰).
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { orgTypeLabel } from "../../lib/org-type";
import { getSessionToken } from "./session-token";

type User = {
  id: number;
  username: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  carrier: string | null;
  email: string | null;
  email_verified: boolean;
  auth_provider: string;
  role: string;
  org_type: string; // 'vitalguard' | 'member'
  status: string;
  birth_date: string | null;
  department: string | null;
  job_title: string | null;
  admin_access: boolean;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
};

// 비밀번호 재설정 요청 — 사용자가 로그인 화면에서 신청하고 여기서 처리한다.
// 이메일 발송이 막혀 있어(EMAIL_FROM 미설정) 사람이 승인하는 구조다 —
// 근거는 docs/account-recovery/context-notes.md.
type ResetRequest = {
  id: number;
  user_id: number;
  username: string;
  status: string; // pending | done | rejected
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

// 승인 직후 딱 한 번 받는 임시 비밀번호. 새로고침하면 사라진다(DB 에 평문이 없다).
type IssuedTempPassword = {
  username: string;
  tempPassword: string;
  expiresAt: string;
};

// ISO → "YYYY-MM-DD HH:MM" (UTC 문자열 앞부분만 — 데모 표시용).
function fmt(iso: string | null): string {
  if (!iso) return "-";
  return iso.replace("T", " ").slice(0, 16);
}

const POLL_MS = 60000; // DB 반영 — 60초 폴링

const TH = "whitespace-nowrap px-2 py-2 text-left font-semibold";
const TD = "whitespace-nowrap px-2 py-1.5 text-body dark:text-on-dark-soft";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: {
      label: "대기",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    },
    approved: {
      label: "승인",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    },
    rejected: {
      label: "거절",
      cls: "bg-zinc-200 text-zinc-600 dark:bg-white/10 dark:text-on-dark-soft",
    },
  };
  const s = map[status] ?? { label: status, cls: "bg-zinc-200 text-zinc-600" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function UserManagementModal({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 회사(상호)/부서/직책 인라인 편집(관리 권한자가 각 사용자 값 직접 수정). 편집 중 행은 폴링이 덮어쓰지 않도록 별도 draft 보관.
  const [editProfileId, setEditProfileId] = useState<number | null>(null);
  const [companyDraft, setCompanyDraft] = useState("");
  const [deptDraft, setDeptDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  // 비밀번호 재설정 요청 목록 + 방금 발급한 임시 비밀번호(1회 표시).
  const [resets, setResets] = useState<ResetRequest[]>([]);
  const [resetBusyId, setResetBusyId] = useState<number | null>(null);
  const [issued, setIssued] = useState<IssuedTempPassword | null>(null);
  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/users", {
        headers: { authorization: `Bearer ${getSessionToken() ?? ""}` },
        cache: "no-store",
      });
      const json = (await res.json()) as { ok?: boolean; users?: User[]; error?: string };
      if (!res.ok || !json.ok || !json.users) {
        setError(json.error || "목록을 불러오지 못했습니다.");
        return;
      }
      setUsers(json.users);
      setError(null);
      setSyncedAt(new Date().toTimeString().slice(0, 8));
    } catch {
      setError("네트워크 오류로 목록을 불러오지 못했습니다.");
    } finally {
      if (manual) setRefreshing(false);
    }
    // 재설정 요청은 실패해도 사용자 목록 표시를 막지 않는다 — 곁다리 패널이라 조용히 비워 둔다.
    try {
      const res = await fetch("/api/admin/password-reset/manage", {
        headers: { authorization: `Bearer ${getSessionToken() ?? ""}` },
        cache: "no-store",
      });
      const json = (await res.json()) as { ok?: boolean; requests?: ResetRequest[] };
      if (res.ok && json.ok && json.requests) setResets(json.requests);
    } catch {
      // 무시 — 다음 폴링에서 다시 시도한다
    }
  }, []);

  // 재설정 요청 처리 — 승인하면 임시 비밀번호가 응답에 딱 한 번 실려 온다.
  const actReset = useCallback(
    async (id: number, action: "approve" | "reject") => {
      const req = resets.find((r) => r.id === id);
      if (action === "approve") {
        const ok = window.confirm(
          `${req?.username ?? id} 의 비밀번호를 임시 비밀번호로 재설정할까요?\n` +
            "기존 비밀번호는 즉시 사용할 수 없게 됩니다.\n" +
            "임시 비밀번호는 이 화면에 한 번만 표시되니 본인 확인 후 직접 전달하세요.",
        );
        if (!ok) return;
      }
      setResetBusyId(id);
      setError(null);
      try {
        const res = await fetch("/api/admin/password-reset/manage", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${getSessionToken() ?? ""}`,
          },
          body: JSON.stringify({ id, action }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          tempPassword?: string;
          expiresAt?: string;
        };
        if (!res.ok || !json.ok) {
          setError(json.error || "처리에 실패했습니다.");
          return;
        }
        if (json.tempPassword) {
          setIssued({
            username: req?.username ?? String(id),
            tempPassword: json.tempPassword,
            expiresAt: json.expiresAt ?? "",
          });
        }
        await load();
      } catch {
        setError("네트워크 오류로 처리에 실패했습니다.");
      } finally {
        setResetBusyId(null);
      }
    },
    [resets, load],
  );

  // 최초 로드 + 60초 폴링(DB 변경 반영). 모달 닫히면 정리.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    loadRef.current();
    const t = setInterval(() => loadRef.current(), POLL_MS);
    return () => clearInterval(t);
  }, []);

  const act = useCallback(
    async (
      id: number,
      action: "approve" | "reject" | "delete" | "grant_admin" | "revoke_admin",
    ) => {
      if (action === "delete") {
        const u = users?.find((x) => x.id === id);
        const ok = window.confirm(
          `${u?.username ?? id} 계정을 탈퇴(삭제) 처리할까요?\nDB에서 영구 제거되며 되돌릴 수 없습니다.`,
        );
        if (!ok) return;
      }
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${getSessionToken() ?? ""}`,
          },
          body: JSON.stringify({ id, action }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          setError(json.error || "처리에 실패했습니다.");
          return;
        }
        await load();
      } catch {
        setError("네트워크 오류로 처리에 실패했습니다.");
      } finally {
        setBusyId(null);
      }
    },
    [load, users],
  );

  const startEditProfile = useCallback((u: User) => {
    setEditProfileId(u.id);
    setCompanyDraft(u.company ?? "");
    setDeptDraft(u.department ?? "");
    setTitleDraft(u.job_title ?? "");
    setError(null);
  }, []);

  const saveProfile = useCallback(
    async (id: number) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${getSessionToken() ?? ""}`,
          },
          body: JSON.stringify({
            id,
            action: "set_profile",
            company: companyDraft.trim() || null,
            department: deptDraft.trim() || null,
            jobTitle: titleDraft.trim() || null,
          }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          setError(json.error || "상호/부서/직책 저장에 실패했습니다.");
          return;
        }
        setEditProfileId(null);
        await load();
      } catch {
        setError("네트워크 오류로 저장에 실패했습니다.");
      } finally {
        setBusyId(null);
      }
    },
    [companyDraft, deptDraft, titleDraft, load],
  );

  const pending = users?.filter((u) => u.status === "pending").length ?? 0;
  const approved = users?.filter((u) => u.status === "approved").length ?? 0;
  const rejected = users?.filter((u) => u.status === "rejected").length ?? 0;
  const pendingResets = resets.filter((r) => r.status === "pending");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3 dark:border-white/10">
          <h2 className="text-sm font-bold text-ink dark:text-on-dark">
            사용자 관리{" "}
            <span className="font-normal text-muted dark:text-on-dark-soft">
              · DB 실시간 동기화
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              className="rounded-pill bg-surface-strong px-3 py-1 text-xs font-semibold text-body active:scale-95 disabled:opacity-50 dark:bg-surface-dark-elevated dark:text-on-dark-soft"
            >
              {refreshing ? "갱신 중…" : "새로고침"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-pill bg-surface-strong px-3 py-1 text-xs font-semibold text-body active:scale-95 dark:bg-surface-dark-elevated dark:text-on-dark-soft"
            >
              닫기
            </button>
          </div>
        </div>

        {/* 요약 바 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-5 py-2 text-[11px] text-muted dark:border-white/10 dark:text-on-dark-soft">
          <span>
            전체{" "}
            <b className="text-ink dark:text-on-dark">{users?.length ?? 0}</b>
          </span>
          <span className="text-amber-600 dark:text-amber-300">대기 {pending}</span>
          <span className="text-emerald-600 dark:text-emerald-300">승인 {approved}</span>
          <span>거절 {rejected}</span>
          {/* 재설정 요청은 사용자가 로그인을 못 하는 상태라 대기 카운트보다 급하다 — 0 이면 감춘다. */}
          {pendingResets.length > 0 && (
            <span className="font-semibold text-amber-600 dark:text-amber-300">
              비밀번호 재설정 요청 {pendingResets.length}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            자동 갱신 60초{syncedAt ? ` · 최근 ${syncedAt}` : ""}
          </span>
        </div>

        {/* 본문 — DB 스키마 테이블 */}
        <div className="wx-cards-scroll min-h-0 flex-1 overflow-auto px-5 py-4">
          {error && (
            <p className="mb-3 rounded-xl border border-red-300/50 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-200">
              {error}
            </p>
          )}

          {/* ★ 발급된 임시 비밀번호 — 이 화면을 벗어나면 다시 볼 수 없다(DB 에 평문이 없다). */}
          {issued && (
            <div className="mb-3 rounded-xl border border-emerald-400/60 bg-emerald-50 px-3 py-2.5 dark:border-emerald-400/30 dark:bg-emerald-500/15">
              <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200">
                {issued.username} 임시 비밀번호 발급됨
              </p>
              <p className="mt-1.5 select-all font-mono text-lg font-bold tracking-widest text-emerald-900 dark:text-emerald-100">
                {issued.tempPassword}
              </p>
              <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                본인 확인 후 직접 전달하세요. <b>이 창을 닫으면 다시 볼 수 없습니다.</b>
                {issued.expiresAt ? ` · 유효기간 ${fmt(issued.expiresAt)} 까지` : ""}
              </p>
              <button
                type="button"
                onClick={() => setIssued(null)}
                className="mt-2 rounded-pill bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white active:scale-95"
              >
                전달 완료 · 지우기
              </button>
            </div>
          )}

          {/* 비밀번호 재설정 요청 — 미처리 건만 보여준다(처리 이력은 DB 에 남는다). */}
          {pendingResets.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2.5 dark:border-amber-400/30 dark:bg-amber-500/15">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                비밀번호 재설정 요청 {pendingResets.length}건
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {pendingResets.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                    <b className="text-ink dark:text-on-dark">{r.username}</b>
                    <span className="text-muted dark:text-on-dark-soft">
                      신청 {fmt(r.requested_at)}
                    </span>
                    <button
                      type="button"
                      onClick={() => actReset(r.id, "approve")}
                      disabled={resetBusyId === r.id}
                      className="rounded-pill bg-emerald-600 px-2.5 py-1 font-semibold text-white active:scale-95 disabled:opacity-50"
                    >
                      임시 비밀번호 발급
                    </button>
                    <button
                      type="button"
                      onClick={() => actReset(r.id, "reject")}
                      disabled={resetBusyId === r.id}
                      className="rounded-pill bg-surface-strong px-2.5 py-1 font-semibold text-body active:scale-95 disabled:opacity-50 dark:bg-surface-dark-elevated dark:text-on-dark-soft"
                    >
                      거절
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                신청자가 본인이 맞는지 확인한 뒤 발급하세요. 발급 즉시 기존 비밀번호는 무효가 됩니다.
              </p>
            </div>
          )}
          {users === null ? (
            !error ? (
              <p className="py-6 text-center text-sm text-muted dark:text-on-dark-soft">
                불러오는 중…
              </p>
            ) : null
          ) : users.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted dark:text-on-dark-soft">
              가입한 사용자가 없습니다.
            </p>
          ) : (
            <div className="wx-cards-scroll overflow-x-auto">
              <table className="min-w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-hairline text-ink dark:border-white/10 dark:text-on-dark">
                    <th className={TH}>ID</th>
                    <th className={TH}>아이디</th>
                    <th className={TH}>이름</th>
                    <th className={TH}>생년월일</th>
                    <th className={TH}>가입유형</th>
                    <th className={TH}>회사</th>
                    <th className={TH}>부서</th>
                    <th className={TH}>직책</th>
                    <th className={TH}>연락처</th>
                    <th className={TH}>통신사</th>
                    <th className={TH}>이메일</th>
                    <th className={TH}>인증</th>
                    <th className={TH}>경로</th>
                    <th className={TH}>역할</th>
                    <th className={TH}>상태</th>
                    <th className={TH}>관리자권한</th>
                    <th className={TH}>가입일</th>
                    <th className={TH}>승인일</th>
                    <th className={TH}>승인자</th>
                    <th className={`${TH} text-right`}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className={`border-b border-hairline dark:border-white/5 ${
                        u.status === "pending"
                          ? "bg-amber-50 dark:bg-amber-500/10"
                          : ""
                      }`}
                    >
                      <td className={TD}>{u.id}</td>
                      <td className={`${TD} font-semibold text-ink dark:text-on-dark`}>
                        {u.username}
                      </td>
                      <td className={TD}>{u.name ?? "-"}</td>
                      <td className={TD}>{u.birth_date ?? "-"}</td>
                      <td className={TD}>
                        {u.role === "worker" ? "작업자" : orgTypeLabel(u.org_type)}
                      </td>
                      {editProfileId === u.id ? (
                        <>
                          <td className={TD}>
                            <input
                              value={companyDraft}
                              onChange={(e) => setCompanyDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveProfile(u.id);
                                if (e.key === "Escape") setEditProfileId(null);
                              }}
                              placeholder="상호"
                              autoFocus
                              className="w-24 rounded-md border border-hairline bg-canvas px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-primary dark:border-white/15 dark:bg-surface-dark-elevated dark:text-on-dark"
                            />
                          </td>
                          <td className={TD}>
                            <input
                              value={deptDraft}
                              onChange={(e) => setDeptDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveProfile(u.id);
                                if (e.key === "Escape") setEditProfileId(null);
                              }}
                              placeholder="부서"
                              className="w-20 rounded-md border border-hairline bg-canvas px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-primary dark:border-white/15 dark:bg-surface-dark-elevated dark:text-on-dark"
                            />
                          </td>
                          <td className={TD}>
                            <div className="flex items-center gap-1">
                              <input
                                value={titleDraft}
                                onChange={(e) => setTitleDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveProfile(u.id);
                                  if (e.key === "Escape") setEditProfileId(null);
                                }}
                                placeholder="직책"
                                className="w-20 rounded-md border border-hairline bg-canvas px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-primary dark:border-white/15 dark:bg-surface-dark-elevated dark:text-on-dark"
                              />
                              <button
                                type="button"
                                onClick={() => saveProfile(u.id)}
                                disabled={busyId === u.id}
                                className="rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-on-primary active:scale-95 disabled:opacity-40"
                              >
                                저장
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditProfileId(null)}
                                className="rounded-md border border-hairline px-1.5 py-0.5 text-[11px] font-semibold text-body dark:border-white/15 dark:text-on-dark-soft"
                              >
                                취소
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={TD}>
                            <button
                              type="button"
                              onClick={() => startEditProfile(u)}
                              title="상호/부서/직책 수정"
                              className="rounded px-1 py-0.5 text-left hover:bg-surface-strong dark:hover:bg-white/10"
                            >
                              {u.company ?? <span className="text-muted dark:text-on-dark-soft">-</span>}
                            </button>
                          </td>
                          <td className={TD}>
                            <button
                              type="button"
                              onClick={() => startEditProfile(u)}
                              title="상호/부서/직책 수정"
                              className="rounded px-1 py-0.5 text-left hover:bg-surface-strong dark:hover:bg-white/10"
                            >
                              {u.department ?? <span className="text-muted dark:text-on-dark-soft">-</span>}
                            </button>
                          </td>
                          <td className={TD}>
                            <button
                              type="button"
                              onClick={() => startEditProfile(u)}
                              title="상호/부서/직책 수정"
                              className="rounded px-1 py-0.5 text-left hover:bg-surface-strong dark:hover:bg-white/10"
                            >
                              {u.job_title ?? <span className="text-muted dark:text-on-dark-soft">-</span>}
                            </button>
                          </td>
                        </>
                      )}
                      <td className={TD}>{u.phone ?? "-"}</td>
                      <td className={TD}>{u.carrier ?? "-"}</td>
                      <td className={TD}>{u.email ?? "-"}</td>
                      <td className={TD}>
                        {u.email_verified ? (
                          <span className="font-semibold text-emerald-600 dark:text-emerald-300">
                            ✓
                          </span>
                        ) : (
                          <span className="text-muted dark:text-on-dark-soft">–</span>
                        )}
                      </td>
                      <td className={TD}>
                        {u.auth_provider === "google" ? "구글" : "비번"}
                      </td>
                      <td className={TD}>{u.role}</td>
                      <td className={TD}>
                        <StatusBadge status={u.status} />
                      </td>
                      <td className={TD}>
                        {u.role === "owner" ? (
                          <span className="text-muted dark:text-on-dark-soft">owner</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              act(u.id, u.admin_access ? "revoke_admin" : "grant_admin")
                            }
                            disabled={busyId === u.id}
                            title={u.admin_access ? "관리자 메뉴 접근 회수" : "관리자 메뉴 접근 부여"}
                            className={[
                              "rounded-md px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50",
                              u.admin_access
                                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-200"
                                : "border border-hairline text-muted hover:bg-surface-strong dark:border-white/15 dark:hover:bg-white/10",
                            ].join(" ")}
                          >
                            {u.admin_access ? "권한있음 ✓" : "권한없음"}
                          </button>
                        )}
                      </td>
                      <td className={TD}>{fmt(u.created_at)}</td>
                      <td className={TD}>{fmt(u.approved_at)}</td>
                      <td className={TD}>{u.approved_by ?? "-"}</td>
                      <td className={`${TD} text-right`}>
                        <div className="inline-flex gap-1.5">
                          {u.status === "pending" && (
                            <>
                              <button
                                type="button"
                                disabled={busyId === u.id}
                                onClick={() => act(u.id, "approve")}
                                className="rounded-pill bg-primary px-2.5 py-1 text-[11px] font-semibold text-on-primary active:scale-95 disabled:opacity-40"
                              >
                                승인
                              </button>
                              <button
                                type="button"
                                disabled={busyId === u.id}
                                onClick={() => act(u.id, "reject")}
                                className="rounded-pill border border-hairline px-2.5 py-1 text-[11px] font-semibold text-body active:scale-95 disabled:opacity-40 dark:border-white/10 dark:text-on-dark-soft"
                              >
                                거절
                              </button>
                            </>
                          )}
                          {u.status === "rejected" && (
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => act(u.id, "approve")}
                              className="rounded-pill bg-surface-strong px-2.5 py-1 text-[11px] font-semibold text-body active:scale-95 disabled:opacity-40 dark:bg-surface-dark-elevated dark:text-on-dark-soft"
                            >
                              재승인
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busyId === u.id}
                            onClick={() => act(u.id, "delete")}
                            title="계정 탈퇴(영구 삭제)"
                            className="rounded-pill border border-red-300/60 px-2.5 py-1 text-[11px] font-semibold text-red-600 active:scale-95 disabled:opacity-40 dark:border-red-400/30 dark:text-red-300"
                          >
                            탈퇴
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
