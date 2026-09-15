// 관리자 모달 — 로그인 + 워커/기간 필터 CSV 내보내기 (산업재해 자료 제출용)
"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { WorkerSummary, ExportRow, EnvAlertAckRow, AlertRow } from "../../lib/db";
import type { Status } from "../../lib/severity";
import { SEVERITY_BADGE_CLASS, SEVERITY_LABEL } from "../../lib/weather-rules";
import { GlassTabBar } from "./GlassTabBar";
import { IncidentReviewPanel } from "./IncidentReview";

// 관리자 메뉴 탭 — 리퀴드글래스 탭바(캐러셀과 동일 컴포넌트) 순서.
const ADMIN_TABS = [
  "현장 정보",
  "데이터 내보내기",
  "작업자 ID 병합",
  "환경·특보 이력",
  "SOS·낙상 이력",
  "사고 조사",
];

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
          className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
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

          <div className="wx-cards-scroll flex-1 overflow-auto">
            <ExportPanel
              token={token}
              siteInfo={siteInfo}
              onSiteInfoSave={onSiteInfoSave}
              onAuthFail={handleLogout}
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
      className="relative flex w-full max-w-sm flex-col items-center gap-y-7 rounded-2xl border border-hairline-strong bg-canvas px-7 py-10 dark:border-white/10 dark:bg-surface-dark"
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
          className="mt-1 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-primary-active disabled:cursor-not-allowed disabled:bg-primary-disabled disabled:text-muted"
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
// 내보내기 진행 표시 — 대용량 XLSX 는 수십 초 걸려 정지 화면처럼 보인다. 회전 아이콘으로 진행을 알린다.
function ExportSpinner() {
  return (
    <svg
      className="h-4 w-4 shrink-0 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
  // 진행 중인 내보내기 형식 — 눌린 버튼에만 스피너를 띄우기 위해 boolean 이 아닌 형식으로 보관한다.
  // (둘 다 "내보내는 중"으로 바뀌면 어느 쪽을 눌렀는지 알 수 없다.)
  const [busyFormat, setBusyFormat] = useState<"csv" | "xlsx" | null>(null);
  const busy = busyFormat !== null;
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  // 선택 기간 일치 건수 배지 — 드롭다운의 DB 누적 건수와 구분되는, 실제 내보내기 대상 수량
  const [rangeCount, setRangeCount] = useState<number | null>(null);
  const [tab, setTab] = useState(0); // 관리자 메뉴 활성 탭

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
            noticeId: siteJson.siteInfo.site_id,
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

  // 날짜/작업자 변경 시 기간 일치 건수만 서버 COUNT 집계로 조회(countOnly=1 · 디바운스 400ms).
  // 보조 배지라 실패는 조용히 숨긴다(내보내기 흐름에 영향 없음).
  useEffect(() => {
    setRangeCount(null);
    if (!from || !to) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (selectedWorker) params.set("workerId", selectedWorker);
        params.set("from", fromYmdToIso(from, false));
        params.set("to", fromYmdToIso(to, true));
        params.set("countOnly", "1");
        const res = await fetch(`/api/admin/preview?${params.toString()}`, {
          headers: { authorization: `Basic ${token}` },
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { ok: boolean; totalMatched: number };
        if (active && json.ok) setRangeCount(json.totalMatched);
      } catch {
        // 배지 전용 — 무시
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [from, to, selectedWorker, token]);

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
    setBusyFormat(format);
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
      setBusyFormat(null);
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

      {/* 메뉴 탭 — 리퀴드글래스 탭바(대시보드 캐러셀과 동일 GlassTabBar 컴포넌트) */}
      <GlassTabBar tabs={ADMIN_TABS} active={tab} onSelect={setTab} />

      {tab === 0 && (
        <SiteInfoPanel token={token} siteInfo={siteInfo} onSave={onSiteInfoSave} />
      )}

      {tab === 1 && (
      /* 섹션: 데이터 내보내기 */
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
          <option value="">전체 (DB 누적 {total.toLocaleString()}건)</option>
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

      {rangeCount !== null && (
        <p className="text-xs text-body dark:text-zinc-400">
          선택 기간 일치{" "}
          <span className="font-semibold tabular-nums text-ink dark:text-zinc-100">
            {rangeCount.toLocaleString()}
          </span>
          건 — 이 수량이 내보내기 대상입니다 (드롭다운 숫자는 DB 전체 누적)
        </p>
      )}

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
            aria-busy={busyFormat === "xlsx"}
            className="inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-emerald-500 bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-400/60 dark:bg-emerald-500/30 dark:hover:bg-emerald-500/40"
          >
            {busyFormat === "xlsx" ? (
              <ExportSpinner />
            ) : (
              <AdminIcon name="download" className="h-4 w-4 shrink-0" />
            )}
            {/* 라벨은 교체하지 않는다 — 진행 표시는 아이콘·문구 접미로만. 텍스트를 통째로 갈아끼우면
                버튼 폭이 흔들리고 어느 버튼을 눌렀는지 알 수 없게 된다. */}
            <span className="truncate">
              XLSX 다운로드{busyFormat === "xlsx" ? " — 내보내는 중" : " (색·3시트)"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleDownload("csv")}
            disabled={busy || !from || !to}
            aria-busy={busyFormat === "csv"}
            className="inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-cyan-500 bg-cyan-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/60 dark:bg-cyan-500/30 dark:hover:bg-cyan-500/40"
          >
            {busyFormat === "csv" ? (
              <ExportSpinner />
            ) : (
              <AdminIcon name="download" className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">
              CSV 다운로드{busyFormat === "csv" ? " — 내보내는 중" : ""}
            </span>
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
      )}

      {tab === 2 && <WorkerMergePanel token={token} onAuthFail={onAuthFail} />}

      {tab === 3 && <EnvAlertAckPanel token={token} onAuthFail={onAuthFail} />}

      {tab === 4 && <AlertAckPanel token={token} onAuthFail={onAuthFail} />}

      {/* 사고 조사(2026-08-13) — 사고 등록(3년 보존 마킹)·전후 창 통합 조회·보고 CSV */}
      {tab === 5 && <IncidentReviewPanel token={token} onAuthFail={onAuthFail} workers={workers} />}
    </div>
  );
}

// 확인/조치 기록 시각 표시 — ISO(KST) → "MM-DD HH:MM"(24h).
function formatAckTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// 현장 환경·기상특보 확인/조치 이력 — GET /api/env-alert/ack(최근 100건, 세션 인증) 열람 전용.
// 낙상 ML 수집 패널 자리를 대체(2026-07-02). 관제자가 경보 팝업을 확인/조치한 감사 기록 표시.
function EnvAlertAckPanel({
  token,
  onAuthFail,
}: {
  token: string;
  onAuthFail: () => void;
}) {
  const [acks, setAcks] = useState<EnvAlertAckRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/env-alert/ack", {
        headers: { authorization: `Basic ${token}` },
      });
      if (res.status === 401) {
        onAuthFail();
        return;
      }
      const j = (await res.json()) as { ok?: boolean; acks?: EnvAlertAckRow[] };
      if (j.ok && j.acks) setAcks(j.acks);
    } catch {
      /* 표시 전용 — 무시 */
    } finally {
      setBusy(false);
    }
  }, [token, onAuthFail]);

  useEffect(() => {
    void load();
  }, [load]);

  const sevLabel = (s: string) =>
    s === "danger" ? SEVERITY_LABEL.danger : s === "caution" ? SEVERITY_LABEL.caution : s;
  const sevCls = (s: string) =>
    s === "danger"
      ? SEVERITY_BADGE_CLASS.danger
      : s === "caution"
        ? SEVERITY_BADGE_CLASS.caution
        : SEVERITY_BADGE_CLASS.normal;

  return (
    <section className="rounded-xl border border-hairline bg-surface-card/60 p-4 dark:border-white/10 dark:bg-canvas/[0.02]">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink dark:text-zinc-100">환경·기상특보 확인/조치 이력</h3>
        <span className="ml-auto rounded-full border border-hairline bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted dark:border-white/15 dark:bg-canvas/5 dark:text-zinc-300">
          최근 {acks.length}건
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          aria-label="환경·기상특보 이력 새로고침"
          title={busy ? "불러오는 중…" : "새로고침"}
          className="rounded-md p-1.5 text-muted transition hover:bg-surface-strong hover:text-ink disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-on-dark"
        >
          <svg
            className={busy ? "animate-spin" : ""}
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
        </button>
      </div>
      <p className="mb-3 text-[11px] text-muted">
        관제자가 현장 환경 경보(체감온도·미세먼지 등)와 기상특보 팝업을 확인/조치한 기록입니다. KOSHA 보고·문제 추적용 감사 이력.
      </p>
      {acks.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">확인/조치 기록이 없습니다.</p>
      ) : (
        <div className="wx-cards-scroll max-h-72 overflow-auto rounded border border-hairline dark:border-white/10">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-surface-soft text-muted dark:bg-canvas/[0.04]">
              <tr>
                <th className="px-2 py-1.5 font-medium">시각</th>
                <th className="px-2 py-1.5 font-medium">구분</th>
                <th className="px-2 py-1.5 font-medium">항목</th>
                <th className="px-2 py-1.5 font-medium">값</th>
                <th className="px-2 py-1.5 font-medium">심각도</th>
                <th className="px-2 py-1.5 font-medium">상태</th>
                <th className="px-2 py-1.5 font-medium">확인자</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline dark:divide-white/10">
              {acks.map((a) => (
                <tr key={a.id} className="text-ink dark:text-zinc-200">
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{formatAckTime(a.ack_at)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {a.item_key.startsWith("kma:") ? "기상특보" : "정책"}
                  </td>
                  <td className="px-2 py-1.5">{a.item_label}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{a.value ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${sevCls(a.severity)}`}>
                      {sevLabel(a.severity)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">{a.status}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{a.ack_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// SOS·낙상·생체 알림 확인/조치 이력 — 환경 이력 패널과 동형(표시 전용 감사 이력).
// 알림 발생(alerts) + 관제자 대응 확인(ack). 팝업 '확인' / 헤더 알림 이력에서 ack 시 대응완료로 반영.
function AlertAckPanel({
  token,
  onAuthFail,
}: {
  token: string;
  onAuthFail: () => void;
}) {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/alerts", {
        headers: { authorization: `Basic ${token}` },
      });
      if (res.status === 401) {
        onAuthFail();
        return;
      }
      const j = (await res.json()) as { ok?: boolean; alerts?: AlertRow[] };
      if (j.ok && j.alerts) setAlerts(j.alerts);
    } catch {
      /* 표시 전용 — 무시 */
    } finally {
      setBusy(false);
    }
  }, [token, onAuthFail]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeLabel = (t: string) =>
    t === "fall"
      ? "낙상"
      : t === "vital"
        ? "생체 위험"
        : t === "geofence"
          ? "구획 이탈"
          : "SOS";
  const typeCls = (t: string) =>
    t === "fall"
      ? "border-amber-500/40 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300"
      : t === "vital"
        ? "border-rose-500/40 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300"
        : t === "geofence"
          ? "border-orange-500/40 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300"
          : "border-red-500/40 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300";

  const unacked = alerts.filter((a) => !a.ack_at).length;

  return (
    <section className="rounded-xl border border-hairline bg-surface-card/60 p-4 dark:border-white/10 dark:bg-canvas/[0.02]">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink dark:text-zinc-100">SOS·낙상·생체 알림 확인/조치 이력</h3>
        {unacked > 0 && (
          <span className="rounded-full border border-red-500/40 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
            미대응 {unacked}
          </span>
        )}
        <span className="ml-auto rounded-full border border-hairline bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted dark:border-white/15 dark:bg-canvas/5 dark:text-zinc-300">
          최근 {alerts.length}건
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          aria-label="긴급 알림 이력 새로고침"
          title={busy ? "불러오는 중…" : "새로고침"}
          className="rounded-md p-1.5 text-muted transition hover:bg-surface-strong hover:text-ink disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-on-dark"
        >
          <svg
            className={busy ? "animate-spin" : ""}
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
        </button>
      </div>
      <p className="mb-3 text-[11px] text-muted">
        작업자 SOS·낙상·생체 위험 긴급 알림의 발생과 관제자 대응 확인 기록입니다. 알림 팝업의 '확인' 버튼 또는 헤더 알림 이력에서 대응 확인 시 반영됩니다. KOSHA 보고·대응 추적용 감사 이력.
      </p>
      {alerts.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">알림 이력이 없습니다.</p>
      ) : (
        <div className="wx-cards-scroll max-h-72 overflow-auto rounded border border-hairline dark:border-white/10">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-surface-soft text-muted dark:bg-canvas/[0.04]">
              <tr>
                <th className="px-2 py-1.5 font-medium">발생</th>
                <th className="px-2 py-1.5 font-medium">구분</th>
                <th className="px-2 py-1.5 font-medium">작업자</th>
                <th className="px-2 py-1.5 font-medium">상태</th>
                <th className="px-2 py-1.5 font-medium">대응</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline dark:divide-white/10">
              {alerts.map((a) => (
                <tr key={a.id} className="text-ink dark:text-zinc-200">
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{formatAckTime(a.ts)}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${typeCls(a.type)}`}>
                      {typeLabel(a.type)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{a.worker_name || a.worker_id}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {a.ack_at ? (
                      <span className="font-semibold text-emerald-600 dark:text-emerald-300">대응완료</span>
                    ) : (
                      <span className="font-semibold text-red-600 dark:text-red-300">미대응</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {a.ack_at ? `${formatAckTime(a.ack_at)} · ${a.ack_by ?? "-"}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// 작업자 ID 병합 — owner 가 주 ID + 별칭 ID 입력 → /api/admin/worker-alias. 수신 시 정규화돼 1인 1카드로 합쳐진다.
function WorkerMergePanel({
  token,
  onAuthFail,
}: {
  token: string;
  onAuthFail: () => void;
}) {
  const [primaryId, setPrimaryId] = useState("");
  const [secondaryId, setSecondaryId] = useState("");
  const [aliases, setAliases] = useState<
    { secondary_worker_id: string; primary_worker_id: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/worker-alias", {
        headers: { authorization: `Basic ${token}` },
      });
      if (res.status === 401) {
        onAuthFail();
        return;
      }
      const j = (await res.json()) as {
        ok?: boolean;
        aliases?: { secondary_worker_id: string; primary_worker_id: string }[];
      };
      if (j.ok && j.aliases) setAliases(j.aliases);
    } catch {
      /* 표시 전용 — 무시 */
    }
  }, [token, onAuthFail]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMerge = useCallback(async () => {
    setError(null);
    const p = primaryId.trim();
    const s = secondaryId.trim();
    if (!p || !s) {
      setError("주 ID·별칭 ID를 모두 입력해주세요.");
      return;
    }
    if (p === s) {
      setError("같은 ID는 병합할 수 없습니다.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/worker-alias", {
        method: "POST",
        headers: { authorization: `Basic ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ primaryId: p, secondaryId: s }),
      });
      if (res.status === 401) {
        onAuthFail();
        return;
      }
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error || "병합 등록 실패");
        return;
      }
      setPrimaryId("");
      setSecondaryId("");
      await load();
    } catch {
      setError("네트워크 오류");
    } finally {
      setBusy(false);
    }
  }, [primaryId, secondaryId, token, onAuthFail, load]);

  const handleRemove = useCallback(
    async (sid: string) => {
      try {
        const res = await fetch("/api/admin/worker-alias", {
          method: "DELETE",
          headers: { authorization: `Basic ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ secondaryId: sid }),
        });
        if (res.status === 401) {
          onAuthFail();
          return;
        }
        await load();
      } catch {
        /* 무시 */
      }
    },
    [token, onAuthFail, load],
  );

  const inputCls =
    "mt-1 w-full rounded border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-cyan-500 dark:border-white/10 dark:bg-canvas/[0.02] dark:text-zinc-100 dark:focus:border-cyan-400/60";

  return (
    <section className="rounded-xl border border-hairline bg-surface-card/60 p-4 dark:border-white/10 dark:bg-canvas/[0.02]">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink dark:text-zinc-100">작업자 ID 병합</h3>
        <span className="ml-auto rounded-full border border-hairline bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted dark:border-white/15 dark:bg-canvas/5 dark:text-zinc-300">
          같은 사람 = 한 카드
        </span>
      </div>
      <p className="mb-3 text-[11px] text-muted">
        같은 작업자가 두 ID(예: 폰 EMP-6861 / 워치 EMP-admin6861)로 들어올 때, 별칭 ID를 주 ID로 합칩니다.
        등록 후 수신부터 한 카드로 합쳐집니다(과거 카드는 행의 "해제"로 정리).
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-semibold text-body dark:text-zinc-300">주 ID (남길 ID)</span>
          <input
            type="text"
            value={primaryId}
            onChange={(e) => {
              setPrimaryId(e.target.value);
              setError(null);
            }}
            placeholder="EMP-6861"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-body dark:text-zinc-300">별칭 ID (합칠 ID)</span>
          <input
            type="text"
            value={secondaryId}
            onChange={(e) => {
              setSecondaryId(e.target.value);
              setError(null);
            }}
            placeholder="EMP-admin6861"
            className={inputCls}
          />
        </label>
      </div>
      {error && (
        <p className="mt-2 rounded border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleMerge()}
        disabled={busy || !primaryId.trim() || !secondaryId.trim()}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-indigo-500 bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-400/60 dark:bg-indigo-500/30 dark:hover:bg-indigo-500/40"
      >
        {busy ? "등록 중..." : "병합 등록"}
      </button>

      {aliases.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <span className="text-[11px] font-semibold text-body dark:text-zinc-300">
            등록된 병합 ({aliases.length})
          </span>
          {aliases.map((a) => (
            <div
              key={a.secondary_worker_id}
              className="flex items-center gap-2 rounded border border-hairline bg-canvas px-2.5 py-1.5 text-xs dark:border-white/10 dark:bg-canvas/[0.02]"
            >
              <span className="font-mono text-muted dark:text-zinc-400">{a.secondary_worker_id}</span>
              <span className="text-muted">→</span>
              <span className="font-mono font-semibold text-ink dark:text-zinc-100">
                {a.primary_worker_id}
              </span>
              <button
                type="button"
                onClick={() => void handleRemove(a.secondary_worker_id)}
                className="ml-auto rounded px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-400/10"
              >
                해제
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
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
        body: JSON.stringify({ ...draft, siteId: draft.noticeId }),
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
        <div className="wx-cards-scroll max-h-[40vh] overflow-auto rounded-lg border border-hairline dark:border-white/10">
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
