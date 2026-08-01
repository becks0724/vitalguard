// 관제 대시보드 진입 로그인 화면 — 반투명 글래스 카드(셰이더 배경 비침) 안에 좌측 현장 사진 + 우측 폼 2분할(데스크톱). 브랜드 로고/슬로건 + 토글 + 관리자 로그인 + 구글/스토어 배지.
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  checkPassword,
  checkUsername,
} from "../../lib/account-policy";
import { CARRIERS, MVNO_NETS, composeCarrier } from "../../lib/carriers";
import { ALLOWED_COMPANIES } from "../../lib/companies";
import { DEFAULT_ORG_TYPE, type OrgType } from "../../lib/org-type";
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
  // 가입 유형(VitAlGuard 관리자 / 회원사 관리자) — DB 에는 org_type 으로 저장
  orgTypeLabel: string;
  orgTypeVitalguard: string;
  orgTypeMember: string;
  birthLabel: string;
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
  pwTooLong: string;
  pwHasBirth: string;
  pwHasPhone: string;
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
    line1: "보이지 않는 위험은 없습니다.\n혼자가 아니기 때문입니다.",
    line2:
      "모든 생체 신호와 현장 환경을 투명하게\n이상 징후를 발견하는 즉시 대응합니다.",
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
    orgTypeLabel: "가입 유형",
    orgTypeVitalguard: "VitAlGuard 관리자",
    orgTypeMember: "회원사 관리자",
    birthLabel: "생년월일",
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
    pwTooShort: `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`,
    pwTooLong: `비밀번호는 ${PASSWORD_MAX}자 이하여야 합니다.`,
    pwHasBirth: "비밀번호에 생년월일을 넣을 수 없습니다.",
    pwHasPhone: "비밀번호에 연락처를 넣을 수 없습니다.",
    fillAll: "모든 항목을 입력해주세요.",
    invalidEmail: "이메일 형식이 올바르지 않습니다.",
    signupSuccess: "가입 신청이 완료됐습니다. 관리자 승인 후 로그인할 수 있습니다.",
    idCheckBtn: "중복 확인",
    idChecking: "확인 중…",
    idAvailable: "사용 가능한 ID입니다.",
    idTaken: "이미 사용 중인 ID입니다.",
    idInvalid: `${USERNAME_MIN}~${USERNAME_MAX}자이며 공백은 쓸 수 없습니다.`,
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
    orgTypeLabel: "Account type",
    orgTypeVitalguard: "VitAlGuard admin",
    orgTypeMember: "Member company admin",
    birthLabel: "Date of birth",
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
    pwTooShort: `Password must be at least ${PASSWORD_MIN} characters.`,
    pwTooLong: `Password must be at most ${PASSWORD_MAX} characters.`,
    pwHasBirth: "Password must not contain your date of birth.",
    pwHasPhone: "Password must not contain your phone number.",
    fillAll: "Please fill in all fields.",
    invalidEmail: "Invalid email format.",
    signupSuccess: "Sign-up requested. You can sign in after admin approval.",
    idCheckBtn: "Check",
    idChecking: "Checking…",
    idAvailable: "ID is available.",
    idTaken: "ID is already taken.",
    idInvalid: `${USERNAME_MIN}–${USERNAME_MAX} chars, no spaces.`,
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

// 폼 라벨 — 폰에서만 시각적으로 감춘다(sr-only 라 스크린리더에는 남는다).
// placeholder·선택지 첫 항목으로 뜻이 드러나는 필드에만 쓴다. 회원가입의 회사·ID·이름·생년월일은
// 그 자체로 알아볼 수 없어(홍길동·mm/dd/yyyy) 폰에서도 라벨을 남긴다.
const LABEL_PHONE_HIDDEN =
  "sr-only text-xs font-semibold text-white/90 drop-shadow md:not-sr-only";

// 인라인 보조 버튼(중복 확인). 폰에서는 ID 입력과 반쪽 칸을 나눠 쓰므로 버튼을 줄여 입력 폭을 넘겨준다
// — 안 줄이면 375px 에서 입력이 60px 로 좁아져 placeholder 가 '관리:' 까지만 보인다.
const MINI_BTN =
  "shrink-0 rounded-xl border border-white/30 bg-white/15 px-2 py-2 text-[11px] font-semibold text-white backdrop-blur-md transition hover:bg-white/25 disabled:opacity-50 md:px-3 md:py-3 md:text-xs";

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
  // 회원가입 입력(전 항목 필수) + 가입 성공 안내(로그인 모드 상단에 표시).
  // 가입 유형 — role 이 아니라 org_type 으로 저장(배포된 앱이 role 3종만 해석하므로).
  const [sOrgType, setSOrgType] = useState<OrgType>(DEFAULT_ORG_TYPE);
  const [sCompany, setSCompany] = useState("");
  const [sId, setSId] = useState("");
  const [sName, setSName] = useState("");
  const [sBirth, setSBirth] = useState("");
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
  // 구글 가입 추가정보(유형·회사·연락처) — 구글 인증 후 입력 단계.
  const [gOrgType, setGOrgType] = useState<OrgType>(DEFAULT_ORG_TYPE);
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
  // 비밀번호 — 서버(register)와 같은 함수로 라이브 판정. 길이 + 본인 생년월일·연락처 포함 금지.
  const pwVerdict =
    sPw.length > 0
      ? checkPassword(sPw, { birthDate: sBirth, phone: composedPhone })
      : "ok";
  const pwVerdictMsg =
    pwVerdict === "too_short"
      ? t.pwTooShort
      : pwVerdict === "too_long"
        ? t.pwTooLong
        : pwVerdict === "has_birth"
          ? t.pwHasBirth
          : pwVerdict === "has_phone"
            ? t.pwHasPhone
            : null;
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
        !sBirth ||
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
      if (pwVerdictMsg) {
        setError(pwVerdictMsg);
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
            orgType: sOrgType,
            company: sCompany.trim(),
            username: sId.trim(),
            name: sName.trim(),
            birthDate: sBirth,
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
        setSOrgType(DEFAULT_ORG_TYPE);
        setSCompany("");
        setSId("");
        setSName("");
        setSBirth("");
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
      sOrgType,
      sCompany,
      sId,
      sName,
      sBirth,
      phoneValid,
      carrierBase,
      mvno,
      emailLocal,
      emailDomainFinal,
      composedPhone,
      composedEmail,
      emailValid,
      idCheck,
      pwVerdictMsg,
      sPw,
      sPw2,
      submitting,
      t,
    ],
  );

  // ID 중복 확인 — /api/admin/check-username.
  const handleCheckId = useCallback(async () => {
    const u = sId.trim();
    // 서버(check-username·register)와 같은 함수로 선판정 — 어긋나면 "확인은 통과, 가입은 거부"가 된다.
    const verdict = checkUsername(u);
    if (verdict !== "ok") {
      setIdCheck(verdict);
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
          body: JSON.stringify({
            orgType: gOrgType,
            company: gCompany.trim(),
            phone: gPhone.trim(),
          }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          setError(json.error || t.networkError);
          return;
        }
        setMode("login");
        setSignupMsg(t.signupSuccess);
        setGOrgType(DEFAULT_ORG_TYPE);
        setGCompany("");
        setGPhone("");
      } catch {
        setError(t.networkError);
      } finally {
        setSubmitting(false);
      }
    },
    [gOrgType, gCompany, gPhone, submitting, t],
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

  // 회원가입은 입력 항목이 10개라 세로로 늘어놓으면 어떤 노트북에서도 스크롤이 생긴다(실측 1445px).
  // 이 모드에서만 로고·브랜드 문구·여백을 줄이고 폼을 2열로 편다(실측 데스크톱 788 · 폰 524px).
  const compact = pendingToken === null && mode === "signup";

  // 로그인은 데스크톱에선 거의 맞는데 폰에서만 크게 넘친다(SE 카드 919px). md 미만에서만 줄인다 —
  // 데스크톱 로그인 화면은 로고 136·브랜드 문구 3줄·푸터·스토어 배지 전부 그대로다.
  const loginCompact = pendingToken === null && mode === "login";

  return (
    <div
      className={`relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 text-ink dark:bg-surface-dark dark:text-on-dark ${
        compact ? "py-2 md:py-8" : loginCompact ? "py-3 md:py-8" : "py-8"
      }`}
    >
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
        <div
          className={`flex w-full flex-col items-center px-6 md:w-1/2 ${
            compact ? "py-2 md:py-6" : loginCompact ? "py-3 md:py-6" : "py-10"
          }`}
        >
          <div className="relative z-10 flex w-full flex-col items-center">
        {/* 중앙 로고 — 로그인 배경은 테마와 무관하게 항상 네이비 셰이더(LoginShaderBackground)라
            화이트 로고 고정. 투명 로고라 라이트 테마의 블루 워드마크(검정 글자)는 네이비에 묻힘. */}
        <div className="logo3d-stage">
          <img
            src="/brand/vitalguard-logo-dark.png"
            alt="VitAlGuard Industrial Safety OS"
            // 폰에서만 축소 — 회원가입 32 / 로그인 64. globals.css 의 고정 픽셀(136)을 이기려면 ! 가 필요하고,
            // md 이상 값도 명시해야 한다(회원가입 96 · 로그인은 원래 크기 136).
            className={`logo3d-badge ${
              compact
                ? "!h-8 !w-8 md:!h-24 md:!w-24"
                : loginCompact
                  ? "!h-16 !w-16 md:!h-[8.5rem] md:!w-[8.5rem]"
                  : ""
            }`}
          />
        </div>

        {/* 슬로건 + 문구 — 현장 선택 단계·회원가입에선 숨김(로고만 유지). 회원가입은 이 167px 를 폼에 내준다. */}
        {pendingToken === null && !compact && (
          <>
        {/* 슬로건·설명은 폰에서 감춘다 — 둘이 96px 이고, 폰에서는 핵심 카피(line1) 하나만 남겨야 한 화면에 든다. */}
        <p
          className="mt-4 hidden text-sm uppercase tracking-wide text-sky-100 drop-shadow md:block"
          style={{ fontFamily: "'Archivo Black', system-ui, sans-serif" }}
        >
          {t.slogan}
        </p>
        {/* 한↔영 전환 시 레이아웃 높이 고정 — min-h 로 영역 예약 + 영문은 폰트 축소해 1줄 유지(한글과 동일 높이). */}
        <h1
          className={`mt-4 flex min-h-[30px] flex-col items-center justify-center whitespace-pre-line text-center leading-snug tracking-[-0.4px] text-white drop-shadow-lg md:mt-2.5 ${
            lang === "en" ? "text-[15px]" : "text-[22px]"
          }`}
          style={{ fontFamily: "'Archivo Black', 'Do Hyeon', system-ui, sans-serif" }}
        >
          {t.line1}
        </h1>
        <p
          className={`mt-2 hidden min-h-[20px] flex-col items-center justify-center whitespace-pre-line text-center leading-5 text-white/85 drop-shadow md:flex ${
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
        {/* 로그인 폼 — 폰에서만 여백과 라벨을 줄인다(라벨은 placeholder 와 같은 문구라 감춰도 잃는 게 없다). */}
        <form
          onSubmit={handleSubmit}
          className="mt-4 w-full max-w-sm space-y-2 md:mt-5 md:space-y-3"
        >
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-white/75 drop-shadow">
            {t.subtitle}
          </p>
          <label className="block">
            <span className={LABEL_PHONE_HIDDEN}>{t.idLabel}</span>
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
            <span className={LABEL_PHONE_HIDDEN}>{t.pwLabel}</span>
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

        {/* 푸터·스토어 배지는 폰에서 감춘다 — 둘이 168px 이고 로그인 자체에는 필요 없다. 데스크톱은 그대로. */}
        <p className="mt-4 hidden text-xs text-white/70 drop-shadow md:block">
          {t.footer}
        </p>

        {/* 스토어 다운로드 배지 — 중앙 정렬(App Store / Google Play) */}
        <div className="hidden md:block">
          <StoreBadges />
        </div>
          </>
          ) : mode === "signup" ? (
          <>
        {/* 회원가입 폼(승인제) — 가입 신청 후 owner 승인 시 로그인 가능.
            전 폭에서 2열 — 1열이면 카드가 데스크톱 1381px·폰 1010px 라 어디서도 스크롤이 생긴다.
            입력 세로 패딩은 이 폼 안에서만 py-3 → py-2 로 줄인다 — 공유 상수를 고치면 로그인 폼까지 얇아진다. */}
        <form
          onSubmit={handleSignup}
          className="mt-4 grid w-full max-w-sm grid-cols-2 gap-x-3 gap-y-1 [&_input]:py-2 [&_select]:py-2 md:max-w-none md:gap-y-2"
        >
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-white/75 drop-shadow col-span-2">
            {t.signupTitle}
          </p>
          {/* 가입 유형 — VitAlGuard 관리자 / 회원사 관리자. 저장은 org_type 컬럼(role 은 그대로 admin). */}
          <div className="col-span-2">
            <span className={LABEL_PHONE_HIDDEN}>{t.orgTypeLabel}</span>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {(
                [
                  ["vitalguard", t.orgTypeVitalguard],
                  ["member", t.orgTypeMember],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSOrgType(value)}
                  aria-pressed={sOrgType === value}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur-md transition md:py-3 ${
                    sOrgType === value
                      ? "border-white/70 bg-white/25 text-white"
                      : "border-white/25 bg-white/10 text-white/70 hover:bg-white/15"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
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
                // min-w-0 없으면 input 이 기본 최소 폭 아래로 안 줄어 2열에서 '중복 확인' 이 카드 밖으로 넘친다.
                className={`${FIELD_BASE} min-w-0 flex-1`}
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
          {/* 생년월일 — 비밀번호에 생년월일을 못 넣게 막는 판정 입력이라 비밀번호보다 위에 둔다. */}
          <label className="block">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.birthLabel}
            </span>
            <input
              type="date"
              value={sBirth}
              onChange={(e) => {
                setSBirth(e.target.value);
                setError(null);
              }}
              max={new Date().toISOString().slice(0, 10)}
              autoComplete="bday"
              required
              className={`${INPUT_CLASS} [color-scheme:dark]`}
            />
          </label>
          <div className="col-span-2">
            <span className={LABEL_PHONE_HIDDEN}>{t.phoneLabel}</span>
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
          <label className="block col-span-2">
            <span className={LABEL_PHONE_HIDDEN}>{t.carrierLabel}</span>
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
          <div className="col-span-2">
            <span className={LABEL_PHONE_HIDDEN}>{t.emailLabel}</span>
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
            <span className={LABEL_PHONE_HIDDEN}>{t.pwLabel}</span>
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
          <label className="block">
            <span className={LABEL_PHONE_HIDDEN}>{t.pwConfirmLabel}</span>
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
          {/* 비밀번호 규칙 — 입력값 기반 라이브 판정(요건을 채우면 즉시 사라짐).
              2열에서 비밀번호·확인이 같은 행에 오도록 두 입력 뒤로 모으고, 각 메시지는 자기 입력칸 아래 열에 둔다.
              불일치는 col-start-2 로 고정 — 규칙 메시지가 없을 때도 '확인' 칸 아래에 남아야 한다. */}
          {pwVerdictMsg && (
            <p className="text-[11px] font-semibold text-amber-200 drop-shadow">
              {pwVerdictMsg}
            </p>
          )}
          {pwMismatchLive && (
            <p className="text-[11px] font-semibold text-amber-200 drop-shadow col-start-2">
              {t.pwMismatch}
            </p>
          )}

          {error && (
            <p className="rounded-xl border border-red-300/50 bg-red-500/25 px-3 py-2 text-xs text-red-50 backdrop-blur-md col-span-2">
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
              !sBirth ||
              !phoneValid ||
              !carrierBase ||
              (carrierBase === "알뜰폰" && !mvno) ||
              !emailLocal ||
              !emailDomainFinal ||
              !sPw ||
              !sPw2 ||
              idCheck !== "available" ||
              pwVerdict !== "ok" ||
              sPw !== sPw2
            }
            label={submitting ? t.signupSubmitting : t.signupSubmit}
            className="w-full col-span-2"
          />

          {/* 로그인 전환 */}
          <p className="pt-1 text-center text-xs text-white/80 drop-shadow col-span-2">
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
          {/* 가입 유형 — 일반 가입 폼과 동일(구글 계정도 org_type 으로 분류). */}
          <div>
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.orgTypeLabel}
            </span>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {(
                [
                  ["vitalguard", t.orgTypeVitalguard],
                  ["member", t.orgTypeMember],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setGOrgType(value)}
                  aria-pressed={gOrgType === value}
                  className={`rounded-xl border px-3 py-3 text-xs font-semibold backdrop-blur-md transition ${
                    gOrgType === value
                      ? "border-white/70 bg-white/25 text-white"
                      : "border-white/25 bg-white/10 text-white/70 hover:bg-white/15"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
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
