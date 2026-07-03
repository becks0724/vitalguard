// 관제 대시보드 진입 로그인 화면 — 반투명 글래스 카드(셰이더 배경 비침) 안에 좌측 현장 사진 + 우측 폼 2분할(데스크톱). 브랜드 로고/슬로건 + 토글 + 관리자 로그인 + 구글/스토어 배지.
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { CARRIERS, MVNO_NETS, composeCarrier } from "../../lib/carriers";
import { ALLOWED_COMPANIES } from "../../lib/companies";
import type { SiteInfo } from "./AdminExportModal";
import { LiquidMetalButton } from "./LiquidMetalButton";
import { LoginShaderBackground } from "./LoginShaderBackground";
import { LoginSiteSelect } from "./LoginSiteSelect";
import { StoreBadges } from "./StoreBadges";
import { ThemeToggle } from "./ThemeToggle";

type Lang = "ko" | "en";

// 명시적 키 타입 — noUncheckedIndexedAccess 하에서 인덱스 접근이 undefined 로 넓어지지 않도록.
type Strings = {
  slogan: string;
  line1: string;
  line2: string;
  subtitle: string;
  idLabel: string;
  idPlaceholder: string;
  pwLabel: string;
  pwPlaceholder: string;
  submit: string;
  submitting: string;
  google: string;
  googleSoon: string;
  error: string;
  networkError: string;
  footer: string;
  // 회원가입(승인제)
  signupTitle: string;
  companyLabel: string;
  companyPlaceholder: string;
  companySelect: string;
  nameLabel: string;
  namePlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  pwConfirmLabel: string;
  pwConfirmPlaceholder: string;
  signupSubmit: string;
  signupSubmitting: string;
  toSignup: string;
  toLogin: string;
  noAccount: string;
  haveAccount: string;
  pwMismatch: string;
  pwTooShort: string;
  fillAll: string;
  invalidEmail: string;
  signupSuccess: string;
  // ID 중복 확인
  idCheckBtn: string;
  idChecking: string;
  idAvailable: string;
  idTaken: string;
  idInvalid: string;
  idReserved: string;
  idNeedCheck: string;
  // 연락처(3박스 + 통신사)
  carrierLabel: string;
  carrierSelect: string;
  // 이메일(아이디 + 도메인 선택 + 인증)
  emailLocalPlaceholder: string;
  emailDomainCustom: string;
  emailDomainPlaceholder: string;
  emailVerifyBtn: string;
  emailResendBtn: string;
  emailSending: string;
  emailSentMsg: string;
  codeLabel: string;
  codePlaceholder: string;
  codeVerifyBtn: string;
  codeVerifiedMsg: string;
  needEmailVerify: string;
  demoCodePrefix: string;
  // 구글 가입 추가정보 + 콜백 메시지
  gcompleteTitle: string;
  gcompleteDesc: string;
  googleMsgPending: string;
  googleMsgRejected: string;
  googleMsgFailed: string;
  googleMsgUnconfigured: string;
};

const LANG_KEY = "safetymonitor.lang.v1";

// 로그인 화면 텍스트만 한·영 전환(대시보드 본문은 한국어 유지 — 다국어는 발표 후 로드맵).
const T: Record<Lang, Strings> = {
  ko: {
    slogan: "OPEN SAFETY · NEVER ALONE",
    line1: "보이지 않는 위험은 없습니다. 혼자가 아니기 때문입니다",
    line2:
      "모든 생체 신호와 현장 환경을 투명하게 — 이상 징후를 발견하는 즉시 대응합니다.",
    subtitle: "관제 대시보드 로그인",
    idLabel: "관리자 ID",
    idPlaceholder: "관리자 ID",
    pwLabel: "비밀번호",
    pwPlaceholder: "비밀번호",
    submit: "로그인",
    submitting: "확인 중…",
    google: "구글로 계속하기",
    googleSoon: "구글 로그인은 준비 중입니다.",
    error: "아이디 또는 비밀번호가 일치하지 않습니다.",
    networkError: "로그인 요청 중 오류가 발생했습니다. 다시 시도하세요.",
    footer: "발표용 프로토타입 · (주)바이탈가드",
    signupTitle: "관리자 회원가입",
    companyLabel: "회사(상호)",
    companyPlaceholder: "(주)바이탈가드",
    companySelect: "회사(상호) 선택",
    nameLabel: "이름",
    namePlaceholder: "홍길동",
    phoneLabel: "연락처",
    phonePlaceholder: "010-1234-5678",
    emailLabel: "관리자 이메일",
    emailPlaceholder: "admin@company.com",
    pwConfirmLabel: "비밀번호 확인",
    pwConfirmPlaceholder: "비밀번호 재입력",
    signupSubmit: "가입 신청",
    signupSubmitting: "신청 중…",
    toSignup: "회원가입",
    toLogin: "로그인으로 돌아가기",
    noAccount: "계정이 없으신가요?",
    haveAccount: "이미 계정이 있으신가요?",
    pwMismatch: "비밀번호가 일치하지 않습니다.",
    pwTooShort: "비밀번호는 8자 이상이어야 합니다.",
    fillAll: "모든 항목을 입력해주세요.",
    invalidEmail: "이메일 형식이 올바르지 않습니다.",
    signupSuccess: "가입 신청이 완료됐습니다. 관리자 승인 후 로그인할 수 있습니다.",
    idCheckBtn: "중복 확인",
    idChecking: "확인 중…",
    idAvailable: "사용 가능한 ID입니다.",
    idTaken: "이미 사용 중인 ID입니다.",
    idInvalid: "3~40자의 영문·숫자·. _ - 만 사용할 수 있습니다.",
    idReserved: "사용할 수 없는 ID입니다.",
    idNeedCheck: "ID 중복 확인을 해주세요.",
    carrierLabel: "통신사",
    carrierSelect: "통신사 선택",
    emailLocalPlaceholder: "이메일 아이디",
    emailDomainCustom: "직접 입력",
    emailDomainPlaceholder: "도메인 입력 (예: company.com)",
    emailVerifyBtn: "인증번호 받기",
    emailResendBtn: "재발송",
    emailSending: "발송 중…",
    emailSentMsg: "인증번호를 메일로 보냈습니다. (유효 10분)",
    codeLabel: "인증번호",
    codePlaceholder: "6자리 숫자",
    codeVerifyBtn: "확인",
    codeVerifiedMsg: "이메일 인증 완료",
    needEmailVerify: "이메일 인증을 완료해주세요.",
    demoCodePrefix: "데모 코드: ",
    gcompleteTitle: "구글 계정 추가 정보",
    gcompleteDesc: "승인을 위해 회사(상호)와 연락처를 입력해주세요.",
    googleMsgPending: "가입 승인 대기 중입니다. 관리자 승인 후 구글 로그인으로 입장할 수 있습니다.",
    googleMsgRejected: "가입이 거절된 계정입니다. 관리자에게 문의하세요.",
    googleMsgFailed: "구글 로그인에 실패했습니다. 다시 시도해주세요.",
    googleMsgUnconfigured: "구글 로그인이 아직 설정되지 않았습니다.",
  },
  en: {
    slogan: "OPEN SAFETY · NEVER ALONE",
    line1: "No risk stays unseen — because you are never alone.",
    line2:
      "Every vital sign and site condition, fully transparent — we act the moment an anomaly appears.",
    subtitle: "Sign in to the control dashboard",
    idLabel: "Admin ID",
    idPlaceholder: "Admin ID",
    pwLabel: "Password",
    pwPlaceholder: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    google: "Continue with Google",
    googleSoon: "Google sign-in is coming soon.",
    error: "ID or password does not match.",
    networkError: "An error occurred while signing in. Please try again.",
    footer: "Demo prototype · VitAlGuard Inc.",
    signupTitle: "Admin sign-up",
    companyLabel: "Company",
    companyPlaceholder: "VitAlGuard Inc.",
    companySelect: "Select company",
    nameLabel: "Name",
    namePlaceholder: "Jane Doe",
    phoneLabel: "Phone",
    phonePlaceholder: "+82 10-1234-5678",
    emailLabel: "Admin email",
    emailPlaceholder: "admin@company.com",
    pwConfirmLabel: "Confirm password",
    pwConfirmPlaceholder: "Re-enter password",
    signupSubmit: "Request sign-up",
    signupSubmitting: "Submitting…",
    toSignup: "Sign up",
    toLogin: "Back to sign in",
    noAccount: "No account?",
    haveAccount: "Already have an account?",
    pwMismatch: "Passwords do not match.",
    pwTooShort: "Password must be at least 8 characters.",
    fillAll: "Please fill in all fields.",
    invalidEmail: "Invalid email format.",
    signupSuccess: "Sign-up requested. You can sign in after admin approval.",
    idCheckBtn: "Check",
    idChecking: "Checking…",
    idAvailable: "ID is available.",
    idTaken: "ID is already taken.",
    idInvalid: "3–40 chars: letters, digits, . _ - only.",
    idReserved: "This ID is reserved.",
    idNeedCheck: "Please check ID availability.",
    carrierLabel: "Carrier",
    carrierSelect: "Select carrier",
    emailLocalPlaceholder: "email id",
    emailDomainCustom: "Custom",
    emailDomainPlaceholder: "domain (e.g. company.com)",
    emailVerifyBtn: "Send code",
    emailResendBtn: "Resend",
    emailSending: "Sending…",
    emailSentMsg: "Verification code sent. (valid 10 min)",
    codeLabel: "Verification code",
    codePlaceholder: "6-digit code",
    codeVerifyBtn: "Verify",
    codeVerifiedMsg: "Email verified",
    needEmailVerify: "Please verify your email.",
    demoCodePrefix: "Demo code: ",
    gcompleteTitle: "Complete your Google sign-up",
    gcompleteDesc: "Enter your company and phone for approval.",
    googleMsgPending: "Sign-up pending approval. You can sign in with Google after an admin approves.",
    googleMsgRejected: "This account was rejected. Please contact an administrator.",
    googleMsgFailed: "Google sign-in failed. Please try again.",
    googleMsgUnconfigured: "Google sign-in is not configured yet.",
  },
};

// 구글 콜백 ?gmsg= 코드 → 현지화 메시지.
function googleMsgText(code: string, t: Strings): string | null {
  switch (code) {
    case "pending":
      return t.googleMsgPending;
    case "rejected":
      return t.googleMsgRejected;
    case "google_failed":
    case "google_state":
      return t.googleMsgFailed;
    case "google_unconfigured":
      return t.googleMsgUnconfigured;
    default:
      return null;
  }
}

// 셰이더 배경 위 글래스 입력 — 박스 없이 배경과 조화(반투명 흰색 + backdrop-blur).
const FIELD_BASE =
  "rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm text-white outline-none backdrop-blur-md transition placeholder:text-white/50 focus:border-white/70 focus:bg-white/15";
const INPUT_CLASS = `mt-1 w-full ${FIELD_BASE}`;

// 셀렉트(통신사·이메일 도메인) — INPUT_CLASS 톤 통일. 옵션은 네이티브 메뉴라 text-black 지정.
// appearance-none 으로 네이티브 셀렉트 렌더(사각·기본 화살표)를 끄고 입력 박스와 동일한 둥근 글래스로 통일.
const SELECT_BASE =
  "appearance-none rounded-xl border border-white/25 bg-white/10 py-3 pl-4 pr-9 text-sm text-white outline-none backdrop-blur-md transition focus:border-white/70 focus:bg-white/15";
const SELECT_CLASS = `mt-1 w-full ${SELECT_BASE}`;

// appearance-none 으로 사라진 드롭다운 화살표를 흰색 SVG 배경으로 대체(우측).
const SELECT_CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23ffffff' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.625rem center",
  backgroundSize: "1.1rem 1.1rem",
};

// 인라인 보조 버튼(중복 확인·인증번호 받기·확인).
const MINI_BTN =
  "shrink-0 rounded-xl border border-white/30 bg-white/15 px-3 py-3 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-white/25 disabled:opacity-50";

// 이메일 도메인 옵션. (통신사·알뜰폰 망 옵션은 lib/carriers)
const EMAIL_DOMAINS = [
  "naver.com",
  "gmail.com",
  "daum.net",
  "hanmail.net",
  "nate.com",
  "kakao.com",
];
const CUSTOM_DOMAIN = "__custom__";
const PHONE_PREFIXES = ["010", "011", "016", "017", "018", "019"];

// 구글 'G' 4색 공식 로고.
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-0.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

function LangToggle({
  lang,
  onChange,
}: {
  lang: Lang;
  onChange: (next: Lang) => void;
}) {
  // 라이트/다크 토글(ThemeToggle)과 동일한 알약 슬라이딩 스위치 — 썸이 현재 언어를 표시하며 좌(한)↔우(EN) 슬라이드.
  const isEn = lang === "en";
  return (
    <button
      type="button"
      onClick={() => onChange(isEn ? "ko" : "en")}
      aria-label={isEn ? "한국어로 전환" : "Switch to English"}
      title={isEn ? "한국어로 전환" : "Switch to English"}
      className="flex h-8 w-16 shrink-0 cursor-pointer rounded-full border border-hairline bg-surface-strong p-1 transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-white/10 dark:bg-surface-dark-elevated"
    >
      <div className="flex w-full items-center justify-between">
        {/* 슬롯 A — 채워진 썸: 현재 언어 */}
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-on-primary transition-transform duration-300 ${
            isEn ? "translate-x-8" : "translate-x-0"
          }`}
        >
          {isEn ? "EN" : "한"}
        </div>
        {/* 슬롯 B — 흐린 대체 언어 */}
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-body transition-transform duration-300 dark:text-on-dark-soft ${
            isEn ? "-translate-x-8" : ""
          }`}
        >
          {isEn ? "한" : "EN"}
        </div>
      </div>
    </button>
  );
}

export function LoginScreen({
  onLogin,
}: {
  onLogin: (token: string, role?: string) => void;
}) {
  const [lang, setLang] = useState<Lang>("ko");
  const [mode, setMode] = useState<"login" | "signup" | "gcomplete">("login");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 회원가입 입력(6항목 전부 필수) + 가입 성공 안내(로그인 모드 상단에 표시).
  const [sCompany, setSCompany] = useState("");
  const [sId, setSId] = useState("");
  const [sName, setSName] = useState("");
  const [sPw, setSPw] = useState("");
  const [sPw2, setSPw2] = useState("");
  const [signupMsg, setSignupMsg] = useState<string | null>(null);
  // ID 중복 확인 상태(sId 변경 시 idle 로 리셋).
  const [idCheck, setIdCheck] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid" | "reserved"
  >("idle");
  // 연락처 — 010 / 0000 / 0000 3박스 + 통신사.
  const [phonePrefix, setPhonePrefix] = useState("010");
  const [phoneMid, setPhoneMid] = useState("");
  const [phoneLast, setPhoneLast] = useState("");
  const [carrierBase, setCarrierBase] = useState(""); // SKT/KT/LG U+/알뜰폰
  const [mvno, setMvno] = useState(""); // 알뜰폰일 때 호스트망(KT/SKT/LG U+)
  // 이메일 — 아이디 + 도메인(선택/직접입력). 인증 제거 — 가입 신청 후 관리자 승인 구조.
  const [emailLocal, setEmailLocal] = useState("");
  const [emailDomain, setEmailDomain] = useState(EMAIL_DOMAINS[0]!);
  const [emailDomainCustom, setEmailDomainCustom] = useState("");
  // 구글 가입 추가정보(회사·연락처) — 구글 인증 후 입력 단계.
  const [gCompany, setGCompany] = useState("");
  const [gPhone, setGPhone] = useState("");
  // 로그인 성공 후 현장 선택 단계로 보류해 둔 세션 토큰/역할(null = 아직 로그인 폼 단계).
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LANG_KEY);
      if (stored === "en" || stored === "ko") setLang(stored);
    } catch {
      // localStorage 불가 환경은 기본값(ko) 유지
    }
  }, []);

  const changeLang = useCallback((next: Lang) => {
    setLang(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      // 저장 실패는 조용히 무시
    }
  }, []);

  const t = T[lang];

  // 회원가입 파생값 — 합성 이메일/연락처 + 라이브 검증.
  const emailDomainFinal =
    emailDomain === CUSTOM_DOMAIN ? emailDomainCustom.trim() : emailDomain;
  const composedEmail = `${emailLocal.trim()}@${emailDomainFinal}`;
  const composedPhone = `${phonePrefix}-${phoneMid}-${phoneLast}`;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(composedEmail);
  const phoneValid = /^\d{3,4}$/.test(phoneMid) && /^\d{4}$/.test(phoneLast);
  const pwTooShortLive = sPw.length > 0 && sPw.length < 8;
  const pwMismatchLive = sPw2.length > 0 && sPw !== sPw2;

  // 구글 콜백 복귀 처리 — ?gsignup(추가정보 단계) / ?gmsg(안내). 처리 후 URL 정리.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gsignup = params.get("gsignup");
    const gmsg = params.get("gmsg");
    if (gsignup === "1") setMode("gcomplete");
    if (gmsg) {
      const msg = googleMsgText(gmsg, t);
      if (msg) setError(msg);
    }
    if (gsignup || gmsg) window.history.replaceState({}, "", "/");
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, password }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          token?: string;
          role?: string;
          error?: string;
        };
        if (!res.ok || !json.ok || !json.token) {
          // 서버 안내(승인 대기·거절 등)가 있으면 그대로, 없으면 기본 메시지.
          setError(json.error || t.error);
          return;
        }
        // 로그인 성공 → 바로 입장하지 않고 현장 선택 단계로 전환(역할도 보류).
        setPendingToken(json.token);
        setPendingRole(json.role ?? null);
      } catch {
        setError(t.networkError);
      } finally {
        setSubmitting(false);
      }
    },
    [id, password, submitting, t],
  );

  // 회원가입 — /api/admin/register 로 가입 신청(승인제). 성공 시 로그인 모드로 전환하고 안내.
  const handleSignup = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);
      setSignupMsg(null);
      // 필수 항목 + 보안 게이트(ID 중복확인·이메일 인증·비번 규칙) 전부 충족해야 제출.
      if (
        !sCompany.trim() ||
        !sId.trim() ||
        !sName.trim() ||
        !phoneValid ||
        !carrierBase ||
        (carrierBase === "알뜰폰" && !mvno) ||
        !emailLocal.trim() ||
        !emailDomainFinal ||
        !sPw ||
        !sPw2
      ) {
        setError(t.fillAll);
        return;
      }
      if (idCheck !== "available") {
        setError(t.idNeedCheck);
        return;
      }
      if (!emailValid) {
        setError(t.invalidEmail);
        return;
      }
      if (sPw.length < 8) {
        setError(t.pwTooShort);
        return;
      }
      if (sPw !== sPw2) {
        setError(t.pwMismatch);
        return;
      }
      setSubmitting(true);
      try {
        const res = await fetch("/api/admin/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            company: sCompany.trim(),
            username: sId.trim(),
            name: sName.trim(),
            phone: composedPhone,
            carrier: composeCarrier(carrierBase, mvno),
            email: composedEmail,
            password: sPw,
          }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          setError(json.error || t.networkError);
          return;
        }
        // 성공 → 로그인 모드로 돌아가 안내 노출, 입력 전부 초기화.
        setMode("login");
        setSignupMsg(t.signupSuccess);
        setSCompany("");
        setSId("");
        setSName("");
        setPhonePrefix("010");
        setPhoneMid("");
        setPhoneLast("");
        setCarrierBase("");
      setMvno("");
        setEmailLocal("");
        setEmailDomain(EMAIL_DOMAINS[0]!);
        setEmailDomainCustom("");
        setIdCheck("idle");
        setSPw("");
        setSPw2("");
      } catch {
        setError(t.networkError);
      } finally {
        setSubmitting(false);
      }
    },
    [
      sCompany,
      sId,
      sName,
      phoneValid,
      carrierBase,
      mvno,
      emailLocal,
      emailDomainFinal,
      composedPhone,
      composedEmail,
      emailValid,
      idCheck,
      sPw,
      sPw2,
      submitting,
      t,
    ],
  );

  // ID 중복 확인 — /api/admin/check-username.
  const handleCheckId = useCallback(async () => {
    const u = sId.trim();
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(u)) {
      setIdCheck("invalid");
      return;
    }
    setIdCheck("checking");
    try {
      const res = await fetch(`/api/admin/check-username?u=${encodeURIComponent(u)}`);
      const j = (await res.json()) as {
        ok?: boolean;
        available?: boolean;
        reason?: string;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setIdCheck("idle");
        setError(j.error || t.networkError);
        return;
      }
      if (j.available) setIdCheck("available");
      else
        setIdCheck(
          j.reason === "reserved"
            ? "reserved"
            : j.reason === "invalid"
              ? "invalid"
              : "taken",
        );
    } catch {
      setIdCheck("idle");
      setError(t.networkError);
    }
  }, [sId, t]);

  // 구글 가입 추가정보 제출 — 회사·연락처 → /api/auth/google/complete (pending 생성).
  const handleGoogleComplete = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);
      if (!gCompany.trim() || !gPhone.trim()) {
        setError(t.fillAll);
        return;
      }
      setSubmitting(true);
      try {
        const res = await fetch("/api/auth/google/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ company: gCompany.trim(), phone: gPhone.trim() }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          setError(json.error || t.networkError);
          return;
        }
        setMode("login");
        setSignupMsg(t.signupSuccess);
        setGCompany("");
        setGPhone("");
      } catch {
        setError(t.networkError);
      } finally {
        setSubmitting(false);
      }
    },
    [gCompany, gPhone, submitting, t],
  );

  // 현장 선택 완료 → 대시보드 입장. 현장정보 프리셋은 "다른 현장으로 전환할 때만" 적용한다.
  // 같은 현장(특히 메인) 재선택 시 프리셋으로 덮어쓰지 않아, 관리자 메뉴에서 저장한 값이
  // 다음 로그인에 원복되지 않는다(진실 소스=서버 DB, 대시보드가 mount 시 우선 로드).
  const handleSiteConfirm = useCallback(
    (info: SiteInfo, siteId: string) => {
      try {
        const prevId = window.localStorage.getItem("safetymonitor.site-id.v1");
        if (prevId !== siteId) {
          window.localStorage.setItem(
            "safetymonitor.site-info.v1",
            JSON.stringify(info),
          );
        }
        window.localStorage.setItem("safetymonitor.site-id.v1", siteId);
      } catch {
        // localStorage 불가 환경은 저장 생략(대시보드 기본/서버 현장정보 유지)
      }
      if (pendingToken) onLogin(pendingToken, pendingRole ?? undefined);
    },
    [pendingToken, pendingRole, onLogin],
  );

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-8 text-ink dark:bg-surface-dark dark:text-on-dark">
      {/* 배경 — MeshGradient 셰이더(콘텐츠 뒤 고정 레이어) */}
      <LoginShaderBackground />

      {/* 우상단 — 한·영 + 라이트/다크 토글 */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <LangToggle lang={lang} onChange={changeLang} />
        <ThemeToggle />
      </div>

      {/* 로그인 카드(레드박스) — 반투명 글래스. overflow 는 풀어 현장 콤보박스 드롭다운이 잘리지 않게(모서리 클리핑은 이미지 컬럼만). */}
      <div className="relative z-10 flex w-full max-w-5xl rounded-3xl border border-white/15 bg-white/5 shadow-2xl backdrop-blur-md">
        {/* 좌측 — 현장 사진(데스크톱 전용, 폼과 1:1 동일 비율로 꽉 채움). 파일: public/brand/mainpic0.jpg (없으면 네이비 폴백). */}
        <div className="relative hidden w-1/2 overflow-hidden rounded-l-3xl md:block">
          <div
            className="h-full w-full bg-cover"
            style={{
              backgroundColor: "#13243f",
              backgroundImage: "url(/brand/mainpic0.jpg)",
              // 중앙 정렬 구도(안전모·상단 문구가 가운데) → 중앙 크롭으로 좌우 균등 노출
              backgroundPosition: "50% 50%",
            }}
          />
        </div>

        {/* 우측 — 로그인 폼 (좌측 사진과 1:1 동일 비율) */}
        <div className="flex w-full flex-col items-center px-6 py-10 md:w-1/2">
          <div className="relative z-10 flex w-full flex-col items-center">
        {/* 중앙 로고 — 로그인 배경은 테마와 무관하게 항상 네이비 셰이더(LoginShaderBackground)라
            화이트 로고 고정. 투명 로고라 라이트 테마의 블루 워드마크(검정 글자)는 네이비에 묻힘. */}
        <div className="logo3d-stage">
          <img
            src="/brand/vitalguard-logo-dark.png"
            alt="VitAlGuard Industrial Safety OS"
            className="logo3d-badge"
          />
        </div>

        {/* 슬로건 + 문구 — 현장 선택 단계에선 숨김(로고만 유지) */}
        {pendingToken === null && (
          <>
        <p
          className="mt-6 text-sm uppercase tracking-wide text-sky-100 drop-shadow"
          style={{ fontFamily: "'Archivo Black', system-ui, sans-serif" }}
        >
          {t.slogan}
        </p>
        {/* 한↔영 전환 시 레이아웃 높이 고정 — min-h 로 영역 예약 + 영문은 폰트 축소해 1줄 유지(한글과 동일 높이). */}
        <h1
          className={`mt-2.5 flex min-h-[30px] flex-col items-center justify-center text-center leading-snug tracking-[-0.4px] text-white drop-shadow-lg ${
            lang === "en" ? "text-[15px]" : "text-[22px]"
          }`}
          style={{ fontFamily: "'Archivo Black', 'Do Hyeon', system-ui, sans-serif" }}
        >
          {t.line1}
        </h1>
        <p
          className={`mt-3 flex min-h-[20px] flex-col items-center justify-center text-center leading-5 text-white/85 drop-shadow ${
            lang === "en" ? "text-[10px]" : "text-sm"
          }`}
        >
          {t.line2}
        </p>
          </>
        )}

        {pendingToken === null ? (
          mode === "login" ? (
          <>
        {/* 로그인 폼 */}
        <form onSubmit={handleSubmit} className="mt-8 w-full max-w-sm space-y-3">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-white/75 drop-shadow">
            {t.subtitle}
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.idLabel}
            </span>
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
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.pwLabel}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.pwPlaceholder}
              autoComplete="current-password"
              required
              className={INPUT_CLASS}
            />
          </label>

          {signupMsg && (
            <p className="rounded-xl border border-emerald-300/50 bg-emerald-500/25 px-3 py-2 text-xs text-emerald-50 backdrop-blur-md">
              {signupMsg}
            </p>
          )}
          {error && (
            <p className="rounded-xl border border-red-300/50 bg-red-500/25 px-3 py-2 text-xs text-red-50 backdrop-blur-md">
              {error}
            </p>
          )}

          <LiquidMetalButton
            type="submit"
            disabled={submitting || !password}
            label={submitting ? t.submitting : t.submit}
            className="w-full"
          />

          {/* 구글로 계속하기 — OAuth 시작(서버 /api/auth/google 로 이동) */}
          <button
            type="button"
            onClick={() => {
              window.location.href = "/api/auth/google";
            }}
            className="flex w-full items-center justify-center gap-2.5 rounded-pill bg-white/95 px-4 py-3 text-sm font-semibold text-zinc-700 shadow-lg transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <GoogleIcon className="h-5 w-5" />
            {t.google}
          </button>

          {/* 회원가입 전환 */}
          <p className="pt-1 text-center text-xs text-white/80 drop-shadow">
            {t.noAccount}{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
                setSignupMsg(null);
              }}
              className="font-semibold text-white underline underline-offset-2 hover:text-sky-200"
            >
              {t.toSignup}
            </button>
          </p>
        </form>

        <p className="mt-8 text-xs text-white/70 drop-shadow">{t.footer}</p>

        {/* 스토어 다운로드 배지 — 중앙 정렬(App Store / Google Play) */}
        <StoreBadges />
          </>
          ) : mode === "signup" ? (
          <>
        {/* 회원가입 폼(승인제) — 가입 신청 후 owner 승인 시 로그인 가능 */}
        <form onSubmit={handleSignup} className="mt-8 w-full max-w-sm space-y-3">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-white/75 drop-shadow">
            {t.signupTitle}
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.companyLabel}
            </span>
            <select
              value={sCompany}
              onChange={(e) => setSCompany(e.target.value)}
              required
              style={SELECT_CHEVRON}
              className={SELECT_CLASS}
            >
              <option value="" className="text-black">
                {t.companySelect}
              </option>
              {ALLOWED_COMPANIES.map((c) => (
                <option key={c} value={c} className="text-black">
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.idLabel}
            </span>
            <div className="mt-1 flex items-stretch gap-2">
              <input
                type="text"
                value={sId}
                onChange={(e) => {
                  setSId(e.target.value);
                  setIdCheck("idle");
                }}
                placeholder={t.idPlaceholder}
                autoComplete="username"
                required
                className={`${FIELD_BASE} flex-1`}
              />
              <button
                type="button"
                onClick={handleCheckId}
                disabled={idCheck === "checking" || !sId.trim()}
                className={MINI_BTN}
              >
                {idCheck === "checking" ? t.idChecking : t.idCheckBtn}
              </button>
            </div>
            {idCheck === "available" && (
              <p className="mt-1 text-[11px] font-semibold text-emerald-200 drop-shadow">
                {t.idAvailable}
              </p>
            )}
            {(idCheck === "taken" ||
              idCheck === "invalid" ||
              idCheck === "reserved") && (
              <p className="mt-1 text-[11px] font-semibold text-red-200 drop-shadow">
                {idCheck === "taken"
                  ? t.idTaken
                  : idCheck === "reserved"
                    ? t.idReserved
                    : t.idInvalid}
              </p>
            )}
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.nameLabel}
            </span>
            <input
              type="text"
              value={sName}
              onChange={(e) => setSName(e.target.value)}
              placeholder={t.namePlaceholder}
              autoComplete="name"
              required
              className={INPUT_CLASS}
            />
          </label>
          <div>
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.phoneLabel}
            </span>
            <div className="mt-1 flex items-center gap-1.5">
              <select
                value={phonePrefix}
                onChange={(e) => setPhonePrefix(e.target.value)}
                style={SELECT_CHEVRON}
                className={`${SELECT_BASE} w-24`}
              >
                {PHONE_PREFIXES.map((p) => (
                  <option key={p} value={p} className="text-black">
                    {p}
                  </option>
                ))}
              </select>
              <span className="text-white/50">-</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={4}
                value={phoneMid}
                onChange={(e) =>
                  setPhoneMid(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="0000"
                required
                className={`${FIELD_BASE} w-full flex-1 text-center`}
              />
              <span className="text-white/50">-</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={4}
                value={phoneLast}
                onChange={(e) =>
                  setPhoneLast(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="0000"
                required
                className={`${FIELD_BASE} w-full flex-1 text-center`}
              />
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.carrierLabel}
            </span>
            <div className="mt-1 flex gap-1.5">
              <select
                value={carrierBase}
                onChange={(e) => {
                  setCarrierBase(e.target.value);
                  if (e.target.value !== "알뜰폰") setMvno(""); // 일반 3사로 바꾸면 망 선택 해제
                }}
                required
                style={SELECT_CHEVRON}
                className={`${SELECT_BASE} min-w-0 flex-1`}
              >
                <option value="" className="text-black">
                  {t.carrierSelect}
                </option>
                {CARRIERS.map((c) => (
                  <option key={c} value={c} className="text-black">
                    {c}
                  </option>
                ))}
              </select>
              {carrierBase === "알뜰폰" && (
                <select
                  value={mvno}
                  onChange={(e) => setMvno(e.target.value)}
                  required
                  style={SELECT_CHEVRON}
                  className={`${SELECT_BASE} min-w-0 flex-1`}
                  aria-label="알뜰폰 사용 망"
                >
                  <option value="" className="text-black">
                    알뜰폰 통신사 선택
                  </option>
                  {MVNO_NETS.map((n) => (
                    <option key={n} value={n} className="text-black">
                      알뜰폰 {n}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </label>
          <div>
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.emailLabel}
            </span>
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="text"
                value={emailLocal}
                onChange={(e) => setEmailLocal(e.target.value.replace(/[\s@]/g, ""))}
                placeholder={t.emailLocalPlaceholder}
                autoComplete="email"
                required
                className={`${FIELD_BASE} w-full flex-1`}
              />
              <span className="text-white/60">@</span>
              <select
                value={emailDomain}
                onChange={(e) => setEmailDomain(e.target.value)}
                style={SELECT_CHEVRON}
                className={`${SELECT_BASE} flex-1`}
              >
                {EMAIL_DOMAINS.map((d) => (
                  <option key={d} value={d} className="text-black">
                    {d}
                  </option>
                ))}
                <option value={CUSTOM_DOMAIN} className="text-black">
                  {t.emailDomainCustom}
                </option>
              </select>
            </div>
            {emailDomain === CUSTOM_DOMAIN && (
              <input
                type="text"
                value={emailDomainCustom}
                onChange={(e) => setEmailDomainCustom(e.target.value.replace(/[\s@]/g, ""))}
                placeholder={t.emailDomainPlaceholder}
                className={INPUT_CLASS}
              />
            )}

          </div>
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.pwLabel}
            </span>
            <input
              type="password"
              value={sPw}
              onChange={(e) => {
                setSPw(e.target.value);
                setError(null);
              }}
              placeholder={t.pwPlaceholder}
              autoComplete="new-password"
              required
              className={INPUT_CLASS}
            />
          </label>
          {/* 비밀번호 길이 — 입력값 기반 라이브 판정(8자 채우면 즉시 사라짐). */}
          {pwTooShortLive && (
            <p className="text-[11px] font-semibold text-amber-200 drop-shadow">
              {t.pwTooShort}
            </p>
          )}
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.pwConfirmLabel}
            </span>
            <input
              type="password"
              value={sPw2}
              onChange={(e) => {
                setSPw2(e.target.value);
                setError(null);
              }}
              placeholder={t.pwConfirmPlaceholder}
              autoComplete="new-password"
              required
              className={INPUT_CLASS}
            />
          </label>
          {pwMismatchLive && (
            <p className="text-[11px] font-semibold text-amber-200 drop-shadow">
              {t.pwMismatch}
            </p>
          )}

          {error && (
            <p className="rounded-xl border border-red-300/50 bg-red-500/25 px-3 py-2 text-xs text-red-50 backdrop-blur-md">
              {error}
            </p>
          )}

          <LiquidMetalButton
            type="submit"
            disabled={
              submitting ||
              !sCompany ||
              !sId ||
              !sName ||
              !phoneValid ||
              !carrierBase ||
              (carrierBase === "알뜰폰" && !mvno) ||
              !emailLocal ||
              !emailDomainFinal ||
              !sPw ||
              !sPw2 ||
              idCheck !== "available" ||
              sPw.length < 8 ||
              sPw !== sPw2
            }
            label={submitting ? t.signupSubmitting : t.signupSubmit}
            className="w-full"
          />

          {/* 로그인 전환 */}
          <p className="pt-1 text-center text-xs text-white/80 drop-shadow">
            {t.haveAccount}{" "}
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className="font-semibold text-white underline underline-offset-2 hover:text-sky-200"
            >
              {t.toLogin}
            </button>
          </p>
        </form>
          </>
          ) : (
          <>
        {/* 구글 가입 추가정보 폼 — 구글 인증 후 회사·연락처 입력 → pending 생성(승인제) */}
        <form onSubmit={handleGoogleComplete} className="mt-8 w-full max-w-sm space-y-3">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-white/75 drop-shadow">
            {t.gcompleteTitle}
          </p>
          <p className="text-center text-[11px] leading-relaxed text-white/70 drop-shadow">
            {t.gcompleteDesc}
          </p>
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.companyLabel}
            </span>
            <select
              value={gCompany}
              onChange={(e) => setGCompany(e.target.value)}
              required
              style={SELECT_CHEVRON}
              className={SELECT_CLASS}
            >
              <option value="" className="text-black">
                {t.companySelect}
              </option>
              {ALLOWED_COMPANIES.map((c) => (
                <option key={c} value={c} className="text-black">
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.phoneLabel}
            </span>
            <input
              type="tel"
              value={gPhone}
              onChange={(e) => setGPhone(e.target.value)}
              placeholder={t.phonePlaceholder}
              autoComplete="tel"
              required
              className={INPUT_CLASS}
            />
          </label>

          {error && (
            <p className="rounded-xl border border-red-300/50 bg-red-500/25 px-3 py-2 text-xs text-red-50 backdrop-blur-md">
              {error}
            </p>
          )}

          <LiquidMetalButton
            type="submit"
            disabled={submitting || !gCompany || !gPhone}
            label={submitting ? t.signupSubmitting : t.signupSubmit}
            className="w-full"
          />

          <p className="pt-1 text-center text-xs text-white/80 drop-shadow">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className="font-semibold text-white underline underline-offset-2 hover:text-sky-200"
            >
              {t.toLogin}
            </button>
          </p>
        </form>
          </>
          )
        ) : (
          /* 현장 선택 단계 — 로그인 성공 후 */
          <LoginSiteSelect
            lang={lang}
            onConfirm={handleSiteConfirm}
            onBack={() => setPendingToken(null)}
          />
        )}
          </div>
        </div>
      </div>
    </div>
  );
}
