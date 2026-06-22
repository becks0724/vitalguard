// owner 전용 사용자 관리 — 가입 신청(pending) 승인/거절 + 전체 계정 목록. /api/admin/users (Bearer 토큰).
"use client";

import { useCallback, useEffect, useState } from "react";

import { getSessionToken } from "./LoginGate";

type User = {
  id: number;
  username: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
};

// ISO → "YYYY-MM-DD HH:MM" (UTC 문자열 앞부분만 — 데모 표시용).
function fmt(iso: string | null): string {
  if (!iso) return "-";
  return iso.replace("T", " ").slice(0, 16);
}

export function UserManagementModal({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        headers: { authorization: `Bearer ${getSessionToken() ?? ""}` },
      });
      const json = (await res.json()) as { ok?: boolean; users?: User[]; error?: string };
      if (!res.ok || !json.ok || !json.users) {
        setError(json.error || "목록을 불러오지 못했습니다.");
        return;
      }
      setUsers(json.users);
    } catch {
      setError("네트워크 오류로 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (id: number, action: "approve" | "reject") => {
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
    [load],
  );

  const pending = users?.filter((u) => u.status === "pending") ?? [];
  const others = users?.filter((u) => u.status !== "pending") ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-2xl dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3 dark:border-white/10">
          <h2 className="text-sm font-bold text-ink dark:text-on-dark">
            사용자 관리 <span className="font-normal text-muted dark:text-on-dark-soft">· 가입 승인</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill bg-surface-strong px-3 py-1 text-xs font-semibold text-body active:scale-95 dark:bg-surface-dark-elevated dark:text-on-dark-soft"
          >
            닫기
          </button>
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {error && (
            <p className="rounded-xl border border-red-300/50 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-200">
              {error}
            </p>
          )}
          {users === null && !error && (
            <p className="py-6 text-center text-sm text-muted dark:text-on-dark-soft">불러오는 중…</p>
          )}

          {/* 승인 대기 */}
          <section>
            <h3 className="mb-2 text-xs font-bold text-ink dark:text-on-dark">
              승인 대기 ({pending.length})
            </h3>
            {pending.length === 0 ? (
              <p className="text-xs text-muted dark:text-on-dark-soft">대기 중인 가입 신청이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {pending.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-amber-300/50 bg-amber-50 px-3.5 py-2.5 dark:border-amber-400/30 dark:bg-amber-500/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink dark:text-on-dark">
                        {u.username}
                        {u.name ? <span className="font-normal text-muted dark:text-on-dark-soft"> · {u.name}</span> : null}
                      </div>
                      {u.company ? (
                        <div className="truncate text-[11px] text-body dark:text-on-dark-soft">{u.company}</div>
                      ) : null}
                      {(u.email || u.phone) && (
                        <div className="truncate text-[11px] text-muted dark:text-on-dark-soft">
                          {[u.email, u.phone].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      <div className="text-[11px] text-muted dark:text-on-dark-soft">신청 {fmt(u.created_at)}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => act(u.id, "approve")}
                        className="rounded-pill bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary active:scale-95 disabled:opacity-40"
                      >
                        승인
                      </button>
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => act(u.id, "reject")}
                        className="rounded-pill border border-hairline px-3 py-1.5 text-xs font-semibold text-body active:scale-95 disabled:opacity-40 dark:border-white/10 dark:text-on-dark-soft"
                      >
                        거절
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 처리된 계정 */}
          <section>
            <h3 className="mb-2 text-xs font-bold text-ink dark:text-on-dark">
              처리된 계정 ({others.length})
            </h3>
            {others.length === 0 ? (
              <p className="text-xs text-muted dark:text-on-dark-soft">아직 없습니다.</p>
            ) : (
              <div className="space-y-1.5">
                {others.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3.5 py-2 dark:border-white/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-ink dark:text-on-dark">
                        {u.username}
                        {u.name ? <span className="text-muted dark:text-on-dark-soft"> · {u.name}</span> : null}
                      </div>
                      <div className="text-[11px] text-muted dark:text-on-dark-soft">
                        {u.status === "approved" ? `승인 ${fmt(u.approved_at)}` : `거절 ${fmt(u.approved_at)}`}
                        {u.approved_by ? ` · ${u.approved_by}` : ""}
                      </div>
                    </div>
                    {u.status === "approved" ? (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        승인됨
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => act(u.id, "approve")}
                        title="거절된 계정을 다시 승인"
                        className="shrink-0 rounded-full bg-surface-strong px-2.5 py-1 text-[11px] font-semibold text-body active:scale-95 disabled:opacity-40 dark:bg-surface-dark-elevated dark:text-on-dark-soft"
                      >
                        거절됨 · 재승인
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
