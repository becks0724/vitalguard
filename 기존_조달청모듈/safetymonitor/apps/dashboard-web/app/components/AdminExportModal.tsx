// 관리자 모달 — 로그인 + 워커/기간 필터 CSV 내보내기 (산업재해 자료 제출용)
"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import type {
  WorkerSummary,
  ExportRow,
  FallDatasetRow,
  FallStats,
} from "../../lib/db";
import type { Status } from "../../lib/severity";

type PreviewRow = ExportRow & {
  hr_status: Status;
  spo2_status: Status;
  temp_status: Status;
  overall_status: Status;
};

type PreviewState = {
  totalMatched: number;
  shown: number;
  dangerCount: number;
  cautionCount: number;
  rows: PreviewRow[];
};

export type SiteInfo = {
  companyName: string;
  siteName: string;
  constructionType: string;
  address: string;
  startDate: string;
  completionDate: string;
  noticeId?: string; // 안전관리비 실집행 검증 데이터(g2b-mock) 매칭 키 — 현장 선택 시 부여.
};

const TOKEN_KEY = "safetymonitor.admin.token.v1";

function loadStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // 시크릿 브라우징 등 — 조용히 무시
  }
}

// 오늘 / 30일 전 — date input value (yyyy-mm-dd)
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: toYmd(from), to: toYmd(today) };
}

function toYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// date input (yyyy-mm-dd) → ISO 8601 (KST 0시/24시)
function fromYmdToIso(ymd: string, end: boolean): string {
  // KST = UTC+9. 한국 현장 사용 가정. 00:00:00 또는 23:59:59
  const parts = ymd.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const ms = Date.UTC(y, m - 1, d, end ? 14 : -9, end ? 59 : 0, end ? 59 : 0);
  return new Date(ms).toISOString();
}

export function AdminExportModal({
  onClose,
  siteInfo,
  onSiteInfoSave,
}: {
  onClose: () => void;
  siteInfo: SiteInfo;
  onSiteInfoSave: (siteInfo: SiteInfo) => void;
}) {
  const [token, setToken] = useState<string | null>(() => loadStoredToken());

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleLogout = useCallback(() => {
    saveToken(null);
    setToken(null);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="관리자 메뉴"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
    >
      {token !== null ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-hairline bg-canvas shadow-xl dark:border-white/10 dark:bg-surface-dark"
        >
          <header className="flex items-center justify-between gap-3 border-b border-hairline bg-surface-card/70 px-5 py-3 dark:border-white/10 dark:bg-canvas/[0.02]">
            <div className="flex items-center gap-2 text-sm text-muted dark:text-muted-soft">
              <span className="font-semibold text-ink dark:text-zinc-100">관리자</span>
              <span className="text-zinc-300 dark:text-muted">/</span>
              <span>산업재해 자료</span>
              <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 vital-blink-caution" />
                로그인됨
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted transition hover:bg-zinc-200/70 dark:text-muted-soft dark:hover:bg-canvas/10"
              >
                <AdminIcon name="logout" className="h-4 w-4" />
                로그아웃
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="닫기"
                className="rounded-md p-1.5 text-muted transition hover:bg-zinc-200/70 hover:text-body dark:text-muted-soft dark:hover:bg-canvas/10 dark:hover:text-zinc-200"
              >
                <AdminIcon name="close" className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-auto">
            <ExportPanel
              token={token}
              siteInfo={siteInfo}
              onSiteInfoSave={onSiteInfoSave}
              onAuthFail={() => {
                saveToken(null);
                setToken(null);
              }}
            />
          </div>
        </div>
      ) : (
        <LoginCard
          onClose={onClose}
          onLogin={(t) => {
            saveToken(t);
            setToken(t);
          }}
        />
      )}
    </div>
  );
}

// 구글 'G' 4색 공식 로고(레퍼런스 FcGoogle 대체 — 의존성 0 인라인 SVG).
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-0.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

// 관리자 로그인 카드 — 레퍼런스(shadcnblocks Signup1) 룩: 로고 상단 + 클린 인풋 + 풀폭 1차 버튼 + 구글 아웃라인 + 푸터.
function LoginCard({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: (token: string) => void;
}) {
  const [id, setId] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, password }),
      });
      const json = (await res.json()) as { ok: boolean; token?: string; error?: string };
      if (!res.ok || !json.ok || !json.token) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      onLogin(json.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-hairline bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-soft focus:border-ink focus:ring-2 focus:ring-ink/20 dark:border-white/15 dark:bg-surface-dark-elevated dark:text-on-dark dark:placeholder:text-muted-soft";

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="relative flex w-full max-w-sm flex-col items-center gap-y-7 rounded-2xl border border-hairline bg-canvas px-7 py-10 shadow-card-hover dark:border-white/10 dark:bg-surface-dark"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="absolute right-3.5 top-3.5 rounded-lg p-1 text-muted-soft transition hover:bg-surface-soft hover:text-ink dark:hover:bg-canvas/10 dark:hover:text-on-dark"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>

      {/* 로고 + 안내 */}
      <div className="flex flex-col items-center gap-y-3">
        <img src="/brand/vitalguard-logo-light.png" alt="VitalGuard" className="h-9 dark:hidden" />
        <img src="/brand/vitalguard-logo-dark.png" alt="VitalGuard" className="hidden h-9 dark:block" />
        <p className="max-w-[17rem] text-center text-xs leading-relaxed text-muted dark:text-on-dark-soft">
          산업재해 자료 제출용 vital 데이터 내보내기 메뉴입니다. 관리자 ID/비밀번호를 입력하세요.
        </p>
      </div>

      {/* 폼 */}
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
        <input
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="관리자 ID"
          aria-label="관리자 ID"
          autoComplete="username"
          required
          className={inputClass}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          aria-label="비밀번호"
          autoComplete="current-password"
          required
          className={inputClass}
        />

        {error && (
          <p className="rounded-md border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
            {error}
          </p>
        )}
        {info && (
          <p className="rounded-md border border-hairline bg-surface-card px-3 py-2 text-xs text-muted dark:border-white/10 dark:bg-canvas/[0.04] dark:text-zinc-300">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-1 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-on-primary shadow-card transition hover:bg-primary-active disabled:cursor-not-allowed disabled:bg-primary-disabled disabled:text-muted"
        >
          {busy ? "확인 중..." : "로그인"}
        </button>
        <button
          type="button"
          onClick={() => setInfo("구글 로그인은 준비 중입니다.")}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-hairline bg-canvas px-3 py-2.5 text-sm font-medium text-body transition hover:bg-surface-card dark:border-white/15 dark:bg-canvas/[0.03] dark:text-zinc-200 dark:hover:bg-canvas/[0.06]"
        >
          <GoogleIcon className="size-5" />
          구글로 계속하기
        </button>
      </form>

      {/* 푸터 */}
      <div className="flex justify-center gap-1 text-sm text-muted dark:text-muted-soft">
        <p>관리자 계정 문의는</p>
        <button
          type="button"
          onClick={() => setInfo("관리자 계정은 시스템 관리자에게 문의하세요.")}
          className="font-medium text-brand-accent hover:underline"
        >
          시스템 관리자
        </button>
      </div>
    </div>
  );
}

// 관리자 패널용 라인 아이콘(레퍼런스 lucide 대체 — 의존성 0 인라인 SVG). currentColor 상속.
function AdminIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    building: (
      <>
        <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
        <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
        <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
        <path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
      </>
    ),
    download: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="m7 10 5 5 5-5" />
        <path d="M12 15V3" />
      </>
    ),
    activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
    database: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </>
    ),
    logout: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </>
    ),
    close: <path d="M18 6 6 18M6 6l12 12" />,
    save: (
      <>
        <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name] ?? null}
    </svg>
  );
}

function ExportPanel({
  token,
  siteInfo,
  onSiteInfoSave,
  onAuthFail,
}: {
  token: string;
  siteInfo: SiteInfo;
  onSiteInfoSave: (siteInfo: SiteInfo) => void;
  onAuthFail: () => void;
}) {
  const [workers, setWorkers] = useState<WorkerSummary[] | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [selectedWorker, setSelectedWorker] = useState<string>(""); // "" = 전체
  const [{ from, to }, setRange] = useState(defaultRange);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/admin/workers", {
          headers: { authorization: `Basic ${token}` },
          cache: "no-store",
        });
        if (res.status === 401) {
          if (active) onAuthFail();
          return;
        }
        const json = (await res.json()) as {
          ok: boolean;
          total: number;
          workers: WorkerSummary[];
        };
        if (active && json.ok) {
          setWorkers(json.workers);
          setTotal(json.total);
        }

        const siteRes = await fetch("/api/admin/site-info", {
          headers: { authorization: `Basic ${token}` },
          cache: "no-store",
        });
        if (siteRes.status === 401) {
          if (active) onAuthFail();
          return;
        }
        const siteJson = await siteRes.json();
        if (active && siteJson.ok && siteJson.siteInfo) {
          onSiteInfoSave({
            companyName: siteJson.siteInfo.company_name ?? "",
            siteName: siteJson.siteInfo.site_name ?? "",
            constructionType: siteJson.siteInfo.construction_type ?? "",
            address: siteJson.siteInfo.address ?? "",
            startDate: siteJson.siteInfo.start_date ?? "",
            completionDate: siteJson.siteInfo.completion_date ?? "",
          });
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [token, onAuthFail, onSiteInfoSave]);

  async function handlePreview() {
    setError(null);
    setPreviewBusy(true);
    try {
      const params = new URLSearchParams();
      if (selectedWorker) params.set("workerId", selectedWorker);
      params.set("from", fromYmdToIso(from, false));
      params.set("to", fromYmdToIso(to, true));

      const res = await fetch(`/api/admin/preview?${params.toString()}`, {
        headers: { authorization: `Basic ${token}` },
        cache: "no-store",
      });
      if (res.status === 401) {
        onAuthFail();
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setPreview({
        totalMatched: json.totalMatched,
        shown: json.shown,
        dangerCount: json.dangerCount,
        cautionCount: json.cautionCount,
        rows: json.rows,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleDownload(format: "csv" | "xlsx") {
    setError(null);
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (selectedWorker) params.set("workerId", selectedWorker);
      params.set("from", fromYmdToIso(from, false));
      params.set("to", fromYmdToIso(to, true));

      const endpoint = format === "xlsx" ? "/api/admin/export-xlsx" : "/api/admin/export";
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        headers: { authorization: `Basic ${token}` },
      });

      if (res.status === 401) {
        onAuthFail();
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // content-disposition 의 filename 사용 (브라우저가 자동 적용하나, 명시)
      const cd = res.headers.get("content-disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(cd);
      a.download = m?.[1] ?? `safetymonitor-${from}_${to}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 px-6 py-6">
      {/* 타이틀 + 메타(레퍼런스 메타 그리드 축약) */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink dark:text-zinc-100">
          산업재해 자료 관리
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted dark:text-muted-soft">
          <span className="inline-flex items-center gap-1.5">
            <AdminIcon name="building" className="h-4 w-4" />
            {siteInfo.siteName?.trim() || "현장 미설정"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <AdminIcon name="database" className="h-4 w-4" />
            DB 영속{" "}
            <span className="font-mono text-body dark:text-zinc-300">{total.toLocaleString()}</span>
            건 누적
          </span>
        </div>
      </div>

      <SiteInfoPanel token={token} siteInfo={siteInfo} onSave={onSiteInfoSave} />

      {/* 섹션: 데이터 내보내기 */}
      <section className="rounded-xl border border-hairline bg-surface-card/60 p-4 dark:border-white/10 dark:bg-canvas/[0.02]">
        <div className="mb-3 flex items-center gap-2">
          <AdminIcon name="download" className="h-5 w-5 text-muted dark:text-muted-soft" />
          <h3 className="text-sm font-semibold text-ink dark:text-zinc-100">데이터 내보내기</h3>
          <span className="ml-auto rounded-full border border-hairline bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted dark:border-white/15 dark:bg-canvas/5 dark:text-zinc-300">
            워커 + 기간 선택 후 CSV
          </span>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-body dark:text-zinc-300">작업자</span>
        <select
          value={selectedWorker}
          onChange={(e) => setSelectedWorker(e.target.value)}
          className="mt-1 w-full rounded border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-cyan-500 dark:border-white/10 dark:bg-canvas/[0.02] dark:text-zinc-100 dark:focus:border-cyan-400/60"
        >
          <option value="">전체 ({total.toLocaleString()}건)</option>
          {(workers ?? []).map((w) => {
            const label =
              w.worker_name && w.employee_id
                ? `${w.worker_name} (${w.employee_id})`
                : w.worker_name ?? w.employee_id ?? w.worker_id;
            return (
              <option key={w.worker_id} value={w.worker_id}>
                {label} — {w.sample_count.toLocaleString()}건
              </option>
            );
          })}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-semibold text-body dark:text-zinc-300">시작 일자</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setRange((prev) => ({ ...prev, from: e.target.value }))}
            className="mt-1 w-full rounded border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-cyan-500 dark:border-white/10 dark:bg-canvas/[0.02] dark:text-zinc-100 dark:focus:border-cyan-400/60"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-body dark:text-zinc-300">종료 일자</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setRange((prev) => ({ ...prev, to: e.target.value }))}
            className="mt-1 w-full rounded border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-cyan-500 dark:border-white/10 dark:bg-canvas/[0.02] dark:text-zinc-100 dark:focus:border-cyan-400/60"
          />
        </label>
      </div>

      {error && (
        <p className="rounded border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewBusy || !from || !to}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-hairline bg-canvas px-4 py-2.5 text-sm font-semibold text-body shadow-sm transition hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-canvas/[0.03] dark:text-zinc-200 dark:hover:bg-canvas/[0.06]"
        >
          <AdminIcon name="eye" className="h-4 w-4" />
          {previewBusy ? "조회 중..." : "위험도 미리보기"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleDownload("xlsx")}
            disabled={busy || !from || !to}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-500 bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-400/60 dark:bg-emerald-500/30 dark:hover:bg-emerald-500/40"
          >
            <AdminIcon name="download" className="h-4 w-4" />
            {busy ? "내보내는 중..." : "XLSX 다운로드 (색·3시트)"}
          </button>
          <button
            type="button"
            onClick={() => handleDownload("csv")}
            disabled={busy || !from || !to}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-cyan-500 bg-cyan-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/60 dark:bg-cyan-500/30 dark:hover:bg-cyan-500/40"
          >
            <AdminIcon name="download" className="h-4 w-4" />
            {busy ? "내보내는 중..." : "CSV 다운로드"}
          </button>
        </div>
      </div>

          {preview && <PreviewTable preview={preview} />}

          <p className="text-[10px] text-muted">
            XLSX — 시트1 "현장정보" 일 1회 snapshot + 시트2 이상치 색 적용 + 시트3 "현장환경" 이력.
            CSV — 현장정보 snapshot 블록 + 생체데이터 위험도 4 컬럼. KOSHA 보고용 보존 권장 3년.
          </p>
        </div>
      </section>

      <FallMlPanel token={token} onAuthFail={onAuthFail} />
    </div>
  );
}

function SiteInfoPanel({
  token,
  siteInfo,
  onSave,
}: {
  token: string;
  siteInfo: SiteInfo;
  onSave: (siteInfo: SiteInfo) => void;
}) {
  const [draft, setDraft] = useState<SiteInfo>(siteInfo);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(siteInfo);
  }, [siteInfo]);

  function update<K extends keyof SiteInfo>(key: K, value: SiteInfo[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/site-info", {
        method: "PUT",
        headers: {
          authorization: `Basic ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      onSave(draft);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-hairline bg-surface-card/60 p-4 dark:border-white/10 dark:bg-canvas/[0.02]">
      <div className="mb-3 flex items-center gap-2">
        <AdminIcon name="building" className="h-5 w-5 text-muted dark:text-muted-soft" />
        <h3 className="text-sm font-semibold text-ink dark:text-zinc-100">현장 정보</h3>
        {saved && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
            저장됨
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 max-[640px]:grid-cols-1">
        <SiteInfoInput
          label="기업명"
          value={draft.companyName}
          onChange={(value) => update("companyName", value)}
        />
        <SiteInfoInput
          label="현장명"
          value={draft.siteName}
          onChange={(value) => update("siteName", value)}
        />
        <SiteInfoInput
          label="공사종류"
          value={draft.constructionType}
          onChange={(value) => update("constructionType", value)}
        />
        <SiteInfoInput
          label="주소"
          value={draft.address}
          onChange={(value) => update("address", value)}
        />
        <SiteInfoInput
          label="착수 날짜"
          type="date"
          value={draft.startDate}
          onChange={(value) => update("startDate", value)}
        />
        <SiteInfoInput
          label="준공 날짜"
          type="date"
          value={draft.completionDate}
          onChange={(value) => update("completionDate", value)}
        />
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-cyan-500 bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/60 dark:bg-cyan-500/30 dark:hover:bg-cyan-500/40"
      >
        <AdminIcon name="save" className="h-4 w-4" />
        {busy ? "저장 중..." : "현장 정보 저장"}
      </button>
      <p className="mt-2 text-[10px] text-muted">
        저장 시 서버 DB에 오늘 날짜 기준 1회 현장정보 snapshot 으로 기록되며,
        XLSX/CSV 자료에 포함됩니다.
      </p>
    </section>
  );
}

function SiteInfoInput({
  label,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  type?: "text" | "date";
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-body dark:text-zinc-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-cyan-500 dark:border-white/10 dark:bg-canvas/[0.02] dark:text-zinc-100 dark:focus:border-cyan-400/60"
      />
    </label>
  );
}

// 미리보기 표 — 이상 row (위험/주의) 배경 강조. 산업재해 자료 검토 동선 단축.
function PreviewTable({ preview }: { preview: PreviewState }) {
  const { totalMatched, shown, dangerCount, cautionCount, rows } = preview;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded border border-hairline bg-surface-soft px-2 py-0.5 text-body dark:border-white/15 dark:bg-canvas/5 dark:text-zinc-200">
          전체 일치 <span className="font-mono">{totalMatched.toLocaleString()}</span>건
        </span>
        <span
          className={`rounded border px-2 py-0.5 font-semibold ${
            dangerCount > 0
              ? "border-red-500/60 bg-red-100 text-red-700 dark:border-red-400/50 dark:bg-red-400/10 dark:text-red-200"
              : "border-hairline bg-surface-soft text-muted dark:border-white/15 dark:bg-canvas/5 dark:text-muted"
          }`}
        >
          위험 <span className="font-mono">{dangerCount.toLocaleString()}</span>건
        </span>
        <span
          className={`rounded border px-2 py-0.5 font-semibold ${
            cautionCount > 0
              ? "border-amber-500/60 bg-amber-100 text-amber-700 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-200"
              : "border-hairline bg-surface-soft text-muted dark:border-white/15 dark:bg-canvas/5 dark:text-muted"
          }`}
        >
          주의 <span className="font-mono">{cautionCount.toLocaleString()}</span>건
        </span>
        <span className="text-muted">표시 최근 {shown}건 (역순)</span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-hairline px-3 py-6 text-center text-xs text-muted dark:border-white/10">
          해당 조건에 일치하는 sample 이 없습니다.
        </p>
      ) : (
        <div className="max-h-[40vh] overflow-auto rounded-lg border border-hairline dark:border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface-soft text-[10px] uppercase tracking-wide text-muted dark:bg-surface-dark-elevated dark:text-muted-soft">
              <tr>
                <th className="px-2 py-2">시각</th>
                <th className="px-2 py-2">작업자</th>
                <th className="px-2 py-2 text-right">심박</th>
                <th className="px-2 py-2 text-right">SpO₂</th>
                <th className="px-2 py-2 text-right">손목℃</th>
                <th className="px-2 py-2 text-center">SOS</th>
                <th className="px-2 py-2 text-center">낙상</th>
                <th className="px-2 py-2 text-center">종합</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PreviewRowItem key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ROW_BG: Record<Status, string> = {
  idle: "",
  normal: "",
  caution:
    "bg-amber-50 hover:bg-amber-100 dark:bg-amber-400/10 dark:hover:bg-amber-400/15",
  danger:
    "bg-red-50 hover:bg-red-100 dark:bg-red-400/10 dark:hover:bg-red-400/15",
};

const CELL_TONE: Record<Status, string> = {
  idle: "text-muted",
  normal: "text-body dark:text-zinc-300",
  caution: "text-amber-700 font-semibold dark:text-amber-300",
  danger: "text-red-700 font-bold dark:text-red-300",
};

const STATUS_KO: Record<Status, string> = {
  idle: "대기",
  normal: "정상",
  caution: "주의",
  danger: "위험",
};

// ── 낙상 ML 데이터 수집 패널 ──────────────────────────────────────────────────
// 수집 통계 + 학습 데이터셋 CSV 내보내기 + 후보별 정답 라벨링(지도학습 ground truth).
const FALL_LABEL_OPTIONS: { value: string; ko: string }[] = [
  { value: "", ko: "미지정" },
  { value: "true_fall", ko: "실제 낙상" },
  { value: "false_positive", ko: "오탐(거짓 양성)" },
  { value: "unsure", ko: "미상" },
];

// 알고리즘 판정 배지 — 양성(발화)/음성(거부 사유별).
function decisionBadge(row: FallDatasetRow): { ko: string; cls: string } {
  if (row.fall_decision === "fall" || row.fall_detected === 1) {
    return {
      ko: "양성",
      cls: "border-red-500/50 bg-red-100 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200",
    };
  }
  const amber =
    "border-amber-500/50 bg-amber-100 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200";
  if (row.fall_decision === "rejected_no_corroboration") return { ko: "음성·미보강", cls: amber };
  if (row.fall_decision === "rejected_timeout") return { ko: "음성·정지미충족", cls: amber };
  return {
    ko: "후보",
    cls: "border-hairline bg-surface-soft text-muted dark:border-white/15 dark:bg-canvas/5 dark:text-muted-soft",
  };
}

function promptOutcomeBadge(row: FallDatasetRow): { ko: string; cls: string } {
  const zinc =
    "border-hairline bg-surface-soft text-muted dark:border-white/15 dark:bg-canvas/5 dark:text-muted-soft";
  const amber =
    "border-amber-500/50 bg-amber-100 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200";
  const red =
    "border-red-500/50 bg-red-100 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200";
  const emerald =
    "border-emerald-500/50 bg-emerald-100 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200";
  if (row.fall_prompt_outcome === "pending") return { ko: "대기", cls: amber };
  if (row.fall_prompt_outcome === "dismissed") return { ko: "해제", cls: emerald };
  if (row.fall_prompt_outcome === "manual_sos") return { ko: "SOS", cls: red };
  if (row.fall_prompt_outcome === "auto_escalated") return { ko: "자동경보", cls: red };
  return { ko: "--", cls: zinc };
}

function FallMlPanel({
  token,
  onAuthFail,
}: {
  token: string;
  onAuthFail: () => void;
}) {
  const [stats, setStats] = useState<FallStats | null>(null);
  const [candidates, setCandidates] = useState<FallDatasetRow[] | null>(null);
  const [{ from, to }, setRange] = useState(defaultRange);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/fall-candidates?limit=200", {
        headers: { authorization: `Basic ${token}` },
        cache: "no-store",
      });
      if (res.status === 401) {
        onAuthFail();
        return;
      }
      const json = (await res.json()) as {
        ok: boolean;
        stats: FallStats;
        candidates: FallDatasetRow[];
      };
      if (json.ok) {
        setStats(json.stats);
        setCandidates(json.candidates);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token, onAuthFail]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleLabel(sampleId: number, label: string) {
    // 낙관적 갱신 — 응답 전에 화면 라벨 반영, 실패 시 reload 로 복구.
    setCandidates((prev) =>
      prev
        ? prev.map((r) =>
            r.id === sampleId ? { ...r, ground_truth_label: label || null } : r,
          )
        : prev,
    );
    try {
      const res = await fetch("/api/admin/fall-label", {
        method: "POST",
        headers: { authorization: `Basic ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ sampleId, label }),
      });
      if (res.status === 401) {
        onAuthFail();
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(json.error ?? `HTTP ${res.status}`);
        reload();
        return;
      }
      // 통계(라벨됨 카운트) 갱신.
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      reload();
    }
  }

  async function handleDownload() {
    setError(null);
    setBusy(true);
    try {
      const params = new URLSearchParams();
      params.set("from", fromYmdToIso(from, false));
      params.set("to", fromYmdToIso(to, true));
      const res = await fetch(`/api/admin/fall-export?${params.toString()}`, {
        headers: { authorization: `Basic ${token}` },
      });
      if (res.status === 401) {
        onAuthFail();
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(cd);
      a.download = m?.[1] ?? `fall-ml-${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-indigo-300/60 bg-indigo-50/50 p-4 dark:border-indigo-400/20 dark:bg-indigo-400/[0.04]">
      <div className="mb-2 flex items-center gap-2">
        <AdminIcon name="activity" className="h-5 w-5 text-indigo-500 dark:text-indigo-300" />
        <h3 className="text-sm font-semibold text-ink dark:text-zinc-100">낙상 감지 ML 데이터 수집</h3>
        <span className="ml-auto rounded-full border border-indigo-400/50 bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:border-indigo-400/40 dark:bg-indigo-400/10 dark:text-indigo-200">
          임계 최적화 학습용
        </span>
      </div>

      <p className="mb-2 text-[10px] text-muted dark:text-muted-soft">
        워치 낙상 디텍터 후보(양성 발화 + 음성 거부)의 활성화 요소(충격G·정지초·자유낙하·회전)를
        수집합니다. 각 후보에 실제 낙상 여부를 라벨링하면 지도학습 데이터셋이 됩니다.
      </p>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <StatBadge label="총 후보" value={stats?.total} tone="zinc" />
        <StatBadge label="양성" value={stats?.positives} tone="red" />
        <StatBadge label="음성" value={stats?.negatives} tone="amber" />
        <StatBadge label="라벨됨" value={stats?.labeled} tone="emerald" />
      </div>

      <div className="mb-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label className="block">
          <span className="text-[10px] font-semibold text-body dark:text-zinc-300">시작</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setRange((prev) => ({ ...prev, from: e.target.value }))}
            className="mt-1 w-full rounded border border-hairline bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-canvas/[0.02] dark:text-zinc-100"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold text-body dark:text-zinc-300">종료</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setRange((prev) => ({ ...prev, to: e.target.value }))}
            className="mt-1 w-full rounded border border-hairline bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-canvas/[0.02] dark:text-zinc-100"
          />
        </label>
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy || !from || !to}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-400/60 dark:bg-indigo-500/30 dark:hover:bg-indigo-500/40"
        >
          <AdminIcon name="download" className="h-3.5 w-3.5" />
          {busy ? "내보내는 중..." : "ML CSV 다운로드"}
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded border border-red-400/40 bg-red-50 px-3 py-2 text-[10px] text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
          {error}
        </p>
      )}

      <FallCandidateTable candidates={candidates} onLabel={handleLabel} />

      <p className="mt-2 text-[10px] text-muted">
        라벨은 관제자 수기 판단(정답)입니다 — CCTV·현장 대조 권장. 음성 샘플은 거부된 작업충격으로
        임계 최적화 학습에 필수입니다. 모델 학습은 발표 후 트랙.
      </p>
    </section>
  );
}

function StatBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone: "zinc" | "red" | "amber" | "emerald";
}) {
  const cls: Record<typeof tone, string> = {
    zinc: "border-hairline bg-surface-soft text-body dark:border-white/15 dark:bg-canvas/5 dark:text-zinc-200",
    red: "border-red-500/50 bg-red-100 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200",
    amber:
      "border-amber-500/50 bg-amber-100 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200",
    emerald:
      "border-emerald-500/50 bg-emerald-100 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200",
  };
  return (
    <span className={`rounded border px-2 py-0.5 font-semibold ${cls[tone]}`}>
      {label} <span className="font-mono">{(value ?? 0).toLocaleString()}</span>건
    </span>
  );
}

function FallCandidateTable({
  candidates,
  onLabel,
}: {
  candidates: FallDatasetRow[] | null;
  onLabel: (sampleId: number, label: string) => void;
}) {
  if (candidates === null) {
    return <p className="px-1 py-3 text-[10px] text-muted">불러오는 중...</p>;
  }
  if (candidates.length === 0) {
    return (
      <p className="rounded border border-dashed border-hairline px-3 py-5 text-center text-[10px] text-muted dark:border-white/10">
        수집된 낙상 후보가 없습니다. 워치 재빌드·설치 후 누적됩니다.
      </p>
    );
  }
  return (
    <div className="max-h-[36vh] overflow-auto rounded-lg border border-hairline dark:border-white/10">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 bg-surface-soft text-[9px] uppercase tracking-wide text-muted dark:bg-surface-dark-elevated dark:text-muted-soft">
          <tr>
            <th className="px-2 py-1.5">시각</th>
            <th className="px-2 py-1.5">작업자</th>
            <th className="px-2 py-1.5 text-center">판정</th>
            <th className="px-2 py-1.5 text-right">충격G</th>
            <th className="px-2 py-1.5 text-right">정지s</th>
            <th className="px-2 py-1.5 text-right">회전</th>
            <th className="px-2 py-1.5 text-center">자유낙하</th>
            <th className="px-2 py-1.5 text-center">확인</th>
            <th className="px-2 py-1.5 text-right">응답s</th>
            <th className="px-2 py-1.5">정답 라벨</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((row) => {
            const badge = decisionBadge(row);
            const prompt = promptOutcomeBadge(row);
            const worker = row.worker_name ?? row.worker_id;
            return (
              <tr key={row.id} className="border-t border-hairline dark:border-white/5">
                <td className="px-2 py-1.5 font-mono text-[9px] text-muted dark:text-muted-soft">
                  {row.ts.slice(5, 19).replace("T", " ")}
                </td>
                <td className="px-2 py-1.5 text-body dark:text-zinc-200">{worker}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${badge.cls}`}>
                    {badge.ko}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-body dark:text-zinc-300">
                  {row.accel_magnitude_g != null ? row.accel_magnitude_g.toFixed(2) : "--"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-body dark:text-zinc-300">
                  {row.motion_still_sec != null ? row.motion_still_sec.toFixed(1) : "--"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-body dark:text-zinc-300">
                  {row.peak_rotation_rad_s != null ? row.peak_rotation_rad_s.toFixed(1) : "--"}
                </td>
                <td className="px-2 py-1.5 text-center text-muted dark:text-muted-soft">
                  {row.freefall_preceded === 1 ? "○" : row.freefall_preceded === 0 ? "×" : "--"}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${prompt.cls}`}
                  >
                    {prompt.ko}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-body dark:text-zinc-300">
                  {row.fall_prompt_response_sec != null
                    ? row.fall_prompt_response_sec.toFixed(1)
                    : "--"}
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={row.ground_truth_label ?? ""}
                    onChange={(e) => onLabel(row.id, e.target.value)}
                    className="w-full rounded border border-hairline bg-canvas px-1.5 py-1 text-[10px] text-ink outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-canvas/[0.03] dark:text-zinc-100"
                  >
                    {FALL_LABEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.ko}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PreviewRowItem({ row }: { row: PreviewRow }) {
  const workerLabel =
    row.worker_name && row.employee_id
      ? `${row.worker_name} (${row.employee_id})`
      : row.worker_name ?? row.employee_id ?? row.worker_id;

  return (
    <tr
      className={`border-t border-hairline dark:border-white/5 ${ROW_BG[row.overall_status]}`}
    >
      <td className="px-2 py-1.5 font-mono text-[10px] text-muted dark:text-muted-soft">
        {row.ts.slice(5, 19).replace("T", " ")}
      </td>
      <td className="px-2 py-1.5 text-body dark:text-zinc-200">{workerLabel}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${CELL_TONE[row.hr_status]}`}>
        {row.heart_rate ?? "--"}
      </td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${CELL_TONE[row.spo2_status]}`}>
        {row.spo2 ?? "--"}
      </td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${CELL_TONE[row.temp_status]}`}>
        {row.skin_temp_c?.toFixed(1) ?? "--"}
      </td>
      <td className="px-2 py-1.5 text-center">
        {row.manual_sos === 1 ? (
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            SOS
          </span>
        ) : (
          <span className="text-muted-soft">·</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        {row.fall_detected === 1 ? (
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            낙상
          </span>
        ) : (
          <span className="text-muted-soft">·</span>
        )}
      </td>
      <td className={`px-2 py-1.5 text-center text-[10px] font-bold ${CELL_TONE[row.overall_status]}`}>
        {STATUS_KO[row.overall_status]}
      </td>
    </tr>
  );
}
