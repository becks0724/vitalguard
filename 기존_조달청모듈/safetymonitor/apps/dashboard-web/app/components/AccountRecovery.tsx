// 계정 찾기 화면 — 아이디 찾기(즉시 조회)와 비밀번호 재설정 신청(관리자 승인)을 탭으로 묶는다.
// LoginScreen 에 넣지 않고 분리한 이유는 그 파일이 이미 1,400줄이기 때문이다.
"use client";

import { useCallback, useState, type FormEvent } from "react";

import { LiquidMetalButton } from "./LiquidMetalButton";
import { INPUT_CLASS } from "./login-styles";

import { SlidingSegmented } from "./ui/SlidingSegmented";
type Lang = "ko" | "en";
type Tab = "findId" | "resetPw";

type Strings = {
  title: string;
  tabFindId: string;
  tabResetPw: string;
  findIdDesc: string;
  resetPwDesc: string;
  idLabel: string;
  idPlaceholder: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  submitFind: string;
  submitReset: string;
  submitting: string;
  backToLogin: string;
  foundTitle: string;
  joinedAt: string;
  maskNote: string;
  statusPending: string;
  statusRejected: string;
  networkError: string;
  fillAll: string;
  invalidEmail: string;
};

const T: Record<Lang, Strings> = {
  ko: {
    title: "계정 찾기",
    tabFindId: "아이디 찾기",
    tabResetPw: "비밀번호 찾기",
    findIdDesc: "가입할 때 등록한 이름과 이메일을 입력하세요.",
    resetPwDesc:
      "관리자가 확인 후 임시 비밀번호를 알려드립니다. 임시 비밀번호는 24시간 동안만 쓸 수 있습니다.",
    idLabel: "관리자 ID",
    idPlaceholder: "관리자 ID",
    nameLabel: "이름",
    namePlaceholder: "홍길동",
    emailLabel: "이메일",
    emailPlaceholder: "admin@company.com",
    submitFind: "아이디 찾기",
    submitReset: "재설정 신청",
    submitting: "확인 중…",
    backToLogin: "로그인으로 돌아가기",
    foundTitle: "찾은 아이디",
    joinedAt: "가입",
    maskNote: "보안을 위해 일부만 표시합니다.",
    statusPending: "승인 대기",
    statusRejected: "가입 거절",
    networkError: "요청 중 오류가 발생했습니다. 다시 시도하세요.",
    fillAll: "모든 항목을 입력해주세요.",
    invalidEmail: "이메일 형식이 올바르지 않습니다.",
  },
  en: {
    title: "Find your account",
    tabFindId: "Find ID",
    tabResetPw: "Reset password",
    findIdDesc: "Enter the name and email you signed up with.",
    resetPwDesc:
      "An administrator will review your request and give you a temporary password, valid for 24 hours.",
    idLabel: "Admin ID",
    idPlaceholder: "Admin ID",
    nameLabel: "Name",
    namePlaceholder: "Jane Doe",
    emailLabel: "Email",
    emailPlaceholder: "admin@company.com",
    submitFind: "Find ID",
    submitReset: "Request reset",
    submitting: "Checking…",
    backToLogin: "Back to sign in",
    foundTitle: "Your ID",
    joinedAt: "Joined",
    maskNote: "Partially masked for security.",
    statusPending: "Pending approval",
    statusRejected: "Rejected",
    networkError: "An error occurred. Please try again.",
    fillAll: "Please fill in all fields.",
    invalidEmail: "Invalid email format.",
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LABEL_CLASS = "text-xs font-semibold text-white/90 drop-shadow";

type FoundAccount = { username: string; createdAt: string; status: string };

// 가입일은 날짜까지만 — 시각은 계정 구분에 쓸모가 없고 줄만 길어진다.
function joinedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(0, 10);
}

export function AccountRecovery({
  lang,
  onBack,
}: {
  lang: Lang;
  onBack: () => void;
}) {
  const t = T[lang];
  const [tab, setTab] = useState<Tab>("findId");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundAccount[] | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // 탭을 옮기면 앞 탭의 결과·오류를 지운다 — 안 지우면 아이디 찾기 결과가 재설정 화면에 남는다.
  const switchTab = useCallback((next: Tab) => {
    setTab(next);
    setError(null);
    setFound(null);
    setDone(null);
  }, []);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);
      setFound(null);
      setDone(null);

      const personName = name.trim();
      const mail = email.trim();
      const uname = id.trim();
      if (!personName || !mail || (tab === "resetPw" && !uname)) {
        setError(t.fillAll);
        return;
      }
      if (!EMAIL_RE.test(mail)) {
        setError(t.invalidEmail);
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch(
          tab === "findId" ? "/api/admin/find-id" : "/api/admin/password-reset",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              tab === "findId"
                ? { name: personName, email: mail }
                : { username: uname, name: personName, email: mail },
            ),
          },
        );
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          message?: string;
          accounts?: FoundAccount[];
        };
        if (!res.ok || !json.ok) {
          // 서버 안내(불일치·중복 신청·구글 계정 등)를 그대로 보여준다 — 가장 정확한 문구다.
          setError(json.error || t.networkError);
          return;
        }
        if (tab === "findId") setFound(json.accounts ?? []);
        else setDone(json.message ?? null);
      } catch {
        setError(t.networkError);
      } finally {
        setSubmitting(false);
      }
    },
    [tab, id, name, email, submitting, t],
  );

  return (
    <div className="mt-6 w-full max-w-sm">
      <p className="text-center text-xs font-semibold uppercase tracking-wider text-white/75 drop-shadow">
        {t.title}
      </p>

      {/* 탭 — 가입 유형 선택과 같은 알약 버튼(같은 카드 안에서 톤을 맞춘다) */}
      {/* 간격(gap)이 있는 2열이라 이동거리가 칸 폭과 다르다 — 실측 방식이라 그대로 정확히 앉는다. */}
      <SlidingSegmented
        className="mt-3 grid grid-cols-2 gap-1.5"
        indicatorClassName="rounded-xl border border-white/70 bg-white/25 backdrop-blur-md"
        items={[
          { value: "findId" as const, label: t.tabFindId },
          { value: "resetPw" as const, label: t.tabResetPw },
        ]}
        value={tab}
        onChange={switchTab}
        itemClassName={(active) =>
          `rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur-md transition-colors ${
            active ? "border-transparent text-white" : "border-white/25 bg-white/10 text-white/70 hover:text-white"
          }`
        }
      />

      <p className="mt-3 text-center text-[11px] leading-relaxed text-white/70 drop-shadow">
        {tab === "findId" ? t.findIdDesc : t.resetPwDesc}
      </p>

      <form onSubmit={submit} className="mt-3 space-y-2">
        {/* 아이디는 재설정 신청에만 — 아이디 찾기는 그것을 모르는 사람이 쓰는 화면이다. */}
        {tab === "resetPw" && (
          <label className="block">
            <span className={LABEL_CLASS}>{t.idLabel}</span>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t.idPlaceholder}
              autoComplete="username"
              required
              className={INPUT_CLASS}
            />
          </label>
        )}
        <label className="block">
          <span className={LABEL_CLASS}>{t.nameLabel}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            autoComplete="name"
            required
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>{t.emailLabel}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.emailPlaceholder}
            autoComplete="email"
            required
            className={INPUT_CLASS}
          />
        </label>

        {found && found.length > 0 && (
          <div className="rounded-xl border border-emerald-300/50 bg-emerald-500/25 px-3 py-2 text-emerald-50 backdrop-blur-md">
            <p className="text-[11px] font-semibold">{t.foundTitle}</p>
            <ul className="mt-1 space-y-1">
              {found.map((a) => (
                <li key={`${a.username}-${a.createdAt}`} className="text-xs">
                  <span className="font-mono font-bold tracking-wider">{a.username}</span>
                  <span className="ml-2 text-[10px] text-emerald-100/80">
                    {t.joinedAt} {joinedDate(a.createdAt)}
                  </span>
                  {/* 승인 전·거절 계정은 아이디를 알아도 로그인할 수 없다 — 미리 알려준다. */}
                  {a.status === "pending" && (
                    <span className="ml-2 text-[10px] text-amber-100">{t.statusPending}</span>
                  )}
                  {a.status === "rejected" && (
                    <span className="ml-2 text-[10px] text-red-100">{t.statusRejected}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10px] text-emerald-100/70">{t.maskNote}</p>
          </div>
        )}

        {done && (
          <p className="rounded-xl border border-emerald-300/50 bg-emerald-500/25 px-3 py-2 text-xs text-emerald-50 backdrop-blur-md">
            {done}
          </p>
        )}
        {error && (
          <p className="rounded-xl border border-red-300/50 bg-red-500/25 px-3 py-2 text-xs text-red-50 backdrop-blur-md">
            {error}
          </p>
        )}

        <LiquidMetalButton
          type="submit"
          disabled={submitting}
          label={
            submitting ? t.submitting : tab === "findId" ? t.submitFind : t.submitReset
          }
          className="w-full"
        />

        <p className="pt-1 text-center text-xs text-white/80 drop-shadow">
          <button
            type="button"
            onClick={onBack}
            className="font-semibold text-white underline underline-offset-2 hover:text-sky-200"
          >
            {t.backToLogin}
          </button>
        </p>
      </form>
    </div>
  );
}
