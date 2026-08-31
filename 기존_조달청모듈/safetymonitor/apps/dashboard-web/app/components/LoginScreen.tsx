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
import { VITALGUARD_COMPANY, companiesForOrgType } from "../../lib/companies";
import { DEFAULT_ORG_TYPE, type SignupOrgType } from "../../lib/org-type";
import { AccountRecovery } from "./AccountRecovery";
import type { SiteInfo } from "./AdminExportModal";
import { LiquidMetalButton } from "./LiquidMetalButton";
import { TwoFactorPrompt } from "./TwoFactorPrompt";
import { LoginShaderBackground } from "./LoginShaderBackground";
import { LoginSiteSelect } from "./LoginSiteSelect";
import { FIELD_BASE, INPUT_CLASS, LABEL_PHONE_HIDDEN } from "./login-styles";
import { StoreBadges } from "./StoreBadges";

import { SlidingSegmented } from "./ui/SlidingSegmented";
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
  privacyLink: string;
  // 회원가입(승인제)
  signupTitle: string;
  // 가입 유형 — DB 에는 org_type 으로 저장. 담당 업무 축이라 소속 기관과 1:1 이 아니다.
  // ⚠ '테스트 계정'(test)은 여기 없다 — 양쪽 검증 화면을 다 보는 유형이라 가입 폼에 노출하지
  //   않는다(최고관리자가 사용자 관리에서만 지정 · lib/org-type.ts SIGNUP_ORG_TYPES).
  orgTypeLabel: string;
  orgTypeVitalguard: string;
  orgTypeJodal: string;
  orgTypeKosha: string;
  orgTypeContractor: string;
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
  // 가입 위저드(3단계) 이동 버튼
  signupNext: string;
  signupBack: string;
  toSignup: string;
  toLogin: string;
  noAccount: string;
  haveAccount: string;
  // 계정 찾기(아이디·비밀번호) 진입 + 임시 비밀번호 로그인 안내
  findAccount: string;
  tempPwNotice: string;
  twoFactorPendingNotice: string;
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
    privacyLink: "보안·개인정보 처리방침",
    signupTitle: "관리자 회원가입",
    orgTypeLabel: "가입 유형",
    orgTypeVitalguard: "VitAlGuard 관리자",
    orgTypeJodal: "조달청 관리자",
    orgTypeKosha: "산업안전공단 관리자",
    orgTypeContractor: "현장 관리자",
    birthLabel: "생년월일",
    companyLabel: "회사(상호)",
    companyPlaceholder: "(주)바이탈가드",
    companySelect: "회사(상호) 선택",
    nameLabel: "이름",
    namePlaceholder: "홍길동",
    phoneLabel: "연락처",
    phonePlaceholder: "010-1234-5678",
    emailLabel: "이메일",
    emailPlaceholder: "admin@company.com",
    pwConfirmLabel: "비밀번호 확인",
    pwConfirmPlaceholder: "비밀번호 재입력",
    signupSubmit: "가입 신청",
    signupSubmitting: "신청 중…",
    signupNext: "다음",
    signupBack: "이전",
    toSignup: "회원가입",
    toLogin: "로그인으로 돌아가기",
    noAccount: "계정이 없으신가요?",
    haveAccount: "이미 계정이 있으신가요?",
    findAccount: "아이디·비밀번호 찾기",
    tempPwNotice:
      "임시 비밀번호로 로그인했습니다. 24시간 안에 '내 정보'에서 비밀번호를 변경해주세요.",
    twoFactorPendingNotice:
      "권한이 큰 계정입니다. '내 정보'에서 2단계 인증을 등록해주세요.",
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
    carrierSelect: "선택",
    emailLocalPlaceholder: "아이디 입력",
    emailDomainCustom: "직접 입력",
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
    privacyLink: "Security & Privacy Policy",
    signupTitle: "Admin sign-up",
    orgTypeLabel: "Account type",
    orgTypeVitalguard: "VitAlGuard admin",
    orgTypeJodal: "PPS admin",
    orgTypeKosha: "KOSHA admin",
    orgTypeContractor: "Site manager",
    birthLabel: "Date of birth",
    companyLabel: "Company",
    companyPlaceholder: "VitAlGuard Inc.",
    companySelect: "Select company",
    nameLabel: "Name",
    namePlaceholder: "Jane Doe",
    phoneLabel: "Phone",
    phonePlaceholder: "+82 10-1234-5678",
    emailLabel: "Email",
    emailPlaceholder: "admin@company.com",
    pwConfirmLabel: "Confirm password",
    pwConfirmPlaceholder: "Re-enter password",
    signupSubmit: "Request sign-up",
    signupSubmitting: "Submitting…",
    signupNext: "Next",
    signupBack: "Back",
    toSignup: "Sign up",
    toLogin: "Back to sign in",
    noAccount: "No account?",
    haveAccount: "Already have an account?",
    findAccount: "Find ID or password",
    tempPwNotice:
      "You signed in with a temporary password. Change it under 'My profile' within 24 hours.",
    twoFactorPendingNotice:
      "This account has elevated access. Set up two-factor authentication under 'My profile'.",
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
    carrierSelect: "Select",
    emailLocalPlaceholder: "Enter ID",
    emailDomainCustom: "Custom",
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
// LABEL_PHONE_HIDDEN 은 login-styles 로 옮겼다(/pair 와 공유 · 2026-08-29).

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
  // 회원가입 3단계 위저드(2026-08-28 사용자 시나리오) — ①가입 유형 ②회사(상호) ③나머지 입력.
  const [signupStep, setSignupStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<
    "login" | "signup" | "gcomplete" | "recovery"
  >("login");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 회원가입 입력(전 항목 필수) + 가입 성공 안내(로그인 모드 상단에 표시).
  // 가입 유형 — role 이 아니라 org_type 으로 저장(배포된 앱이 role 3종만 해석하므로).
  const [sOrgType, setSOrgType] = useState<SignupOrgType>(DEFAULT_ORG_TYPE);
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
  const [emailDomainCustom, setEmailDomainCustom] = useState("");
  // 구글 가입 추가정보(유형·회사·연락처) — 구글 인증 후 입력 단계.
  const [gOrgType, setGOrgType] = useState<SignupOrgType>(DEFAULT_ORG_TYPE);
  const [gCompany, setGCompany] = useState("");
  const [gPhone, setGPhone] = useState("");
  // 로그인 성공 후 현장 선택 단계로 보류해 둔 세션 토큰/역할(null = 아직 로그인 폼 단계).
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  // 임시 비밀번호로 들어왔는가(서버 판정) — 현장 선택 단계에서 변경 안내를 띄운다.
  const [mustChangePw, setMustChangePw] = useState(false);
  // 2단계 인증(2026-08-28) — 로그인 카드 위에 떠오르는 패널의 상태.
  // ⚠ twoFactorError 를 로그인 폼의 error 와 나눠 두는 이유 = 섞으면 패널을 닫은 뒤에도
  //   빨간 글씨가 카드에 남아 "로그인 자체가 실패했다"로 읽힌다.
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  // 고권한인데 아직 2단계를 등록하지 않은 계정 — 입장은 시키되 안내한다(막으면 등록 화면이
  // 로그인 뒤에 있어 계정이 잠긴다).
  const [twoFactorPendingNotice, setTwoFactorPendingNotice] = useState(false);

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
  // 도메인 = 탭 안에 친 텍스트가 유일한 진실(프리셋 선택도 같은 칸에 채워진다 · 2026-08-28).
  const emailDomainFinal = emailDomainCustom.trim();

  // ★ VitAlGuard 관리자는 상호가 자사 하나뿐이라 고를 것이 없다(2026-08-28 사용자 지시) —
  //   2단계(회사 선택)를 건너뛰어 전체가 **2단계**가 되고, 상호는 유형 선택 시 자동으로 채워진다.
  //   내부 단계 번호(1·2·3)는 그대로 두고 **표시만** 접는다 — 번호를 바꾸면 분기가 두 벌이 된다.
  const skipCompanyStep = sOrgType === "vitalguard";
  const totalSignupSteps = skipCompanyStep ? 2 : 3;
  const shownSignupStep = skipCompanyStep && signupStep === 3 ? 2 : signupStep;
  const stepAfterOrgType = skipCompanyStep ? 3 : 2;
  // ⚠ 상호를 유형 선택 이벤트(onChange)에만 맡기지 않는다 — 그 이벤트가 한 번이라도 어긋나면
  //   상호가 빈 채 제출된다. 건너뛰는 유형은 여기서 자사 상호로 확정한다.
  const signupCompany = skipCompanyStep ? VITALGUARD_COMPANY : sCompany.trim();
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

  // 로그인 시도 — 1단계(비번만)와 2단계(비번+6자리)가 같은 엔드포인트를 쓴다.
  // ★ 비밀번호를 2단계 패널까지 내리지 않는다. 코드만 올려받아 여기서 합쳐 보낸다 —
  //   패널이 비번을 들고 있으면 그 컴포넌트가 커질수록 노출면이 같이 커진다.
  // ⚠ 서버가 twoFactorRequired 로 되물으면 **에러가 아니라 다음 단계**다. 로그인 폼의
  //   error 자리에 쓰지 않고 패널을 띄운다(빨간 글씨로 뜨면 실패한 줄 안다).
  const attemptLogin = useCallback(
    async (code?: string) => {
      setSubmitting(true);
      if (code) setTwoFactorError(null);
      else setError(null);
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, password, ...(code ? { totpCode: code } : {}) }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          token?: string;
          role?: string;
          error?: string;
          mustChangePassword?: boolean;
          twoFactorRequired?: boolean;
          twoFactorPending?: boolean;
        };
        if (json.twoFactorRequired) {
          setTwoFactorOpen(true);
          // 첫 요구엔 메시지를 비운다(아직 틀린 게 없다). 재시도 실패에만 사유를 보인다.
          setTwoFactorError(code ? (json.error ?? t.error) : null);
          return;
        }
        if (!res.ok || !json.ok || !json.token) {
          // 서버 안내(승인 대기·거절 등)가 있으면 그대로, 없으면 기본 메시지.
          setTwoFactorOpen(false);
          setError(json.error || t.error);
          return;
        }
        // 로그인 성공 → 바로 입장하지 않고 현장 선택 단계로 전환(역할도 보류).
        setTwoFactorOpen(false);
        setPendingToken(json.token);
        setPendingRole(json.role ?? null);
        setMustChangePw(json.mustChangePassword === true);
        setTwoFactorPendingNotice(json.twoFactorPending === true);
      } catch {
        if (code) setTwoFactorError(t.networkError);
        else setError(t.networkError);
      } finally {
        setSubmitting(false);
      }
    },
    [id, password, t],
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      await attemptLogin(undefined);
    },
    [attemptLogin, submitting],
  );

  // 회원가입 — /api/admin/register 로 가입 신청(승인제). 성공 시 로그인 모드로 전환하고 안내.
  const handleSignup = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      // ⚠ 위저드 중간 단계에서 Enter 를 치면 폼이 제출된다 — 그때는 '다음'으로 넘긴다.
      //   여기서 안 막으면 필수값이 빈 채 검증에 걸려 엉뚱한 오류 문구가 뜬다.
      if (signupStep === 1) {
        setSignupStep(stepAfterOrgType);
        return;
      }
      if (signupStep === 2) {
        if (sCompany.trim()) setSignupStep(3);
        return;
      }
      setError(null);
      setSignupMsg(null);
      // 필수 항목 + 보안 게이트(ID 중복확인·이메일 인증·비번 규칙) 전부 충족해야 제출.
      if (
        !signupCompany ||
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
            company: signupCompany,
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
        setSignupStep(1);
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
      signupStep,
      stepAfterOrgType,
      signupCompany,
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

      {/* 우상단 — 한·영 토글만. 라이트/다크 토글은 뺐다(2026-08-28 사용자 지시 — 대시보드 진입
          전(로그인·회원가입)에는 불필요. 테마 전환은 로그인 후 대시보드에서). */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <LangToggle lang={lang} onChange={changeLang} />
      </div>

      {/* 로그인 카드(레드박스) — 반투명 글래스. overflow 는 풀어 현장 콤보박스 드롭다운이 잘리지 않게(모서리 클리핑은 이미지 컬럼만). */}
      {/* ★ 카드 크기를 **고정**한다(2026-08-28 사용자 지시) — 종전엔 화면(로그인·가입 1~3단계)마다
          폼 길이가 달라 카드가 늘었다 줄었고, 그때마다 사진이 다른 비율로 잘렸다.
          높이를 830px(가장 긴 화면인 로그인 폼 817px 기준) 로 못 박고 사진 컬럼 폭을 원본 비율에서 역산하면 어느 화면에서도 같은 카드다. */}
      <div className="relative z-10 flex w-full max-w-[1180px] rounded-3xl border border-white/15 bg-white/5 shadow-2xl backdrop-blur-md md:h-[min(830px,calc(100dvh-5rem))]">
        {/* 좌측 — 현장 사진. 파일: public/brand/mainpic0.jpg (723×975 세로형, 없으면 네이비 폴백).
            ⚠ 2026-08-28 에 원본(820×1024)을 두 번 잘랐다. ①장식 프레임 선 제거(좌15·우805·
              상16·하994 픽셀 실측) → 787×975 ②「Strong Structures.」 좌우 여백 축소(문구 여백이
              66·64px 이라 절반씩) → **723×975**. 파일을 되돌리면 아래 aspect 도 함께 되돌릴 것 —
              둘이 어긋나면 그 차이만큼 사진이 잘린다.
            ★ 높이의 기준은 **사진**이다(2026-08-28 사용자 지시 — 옆 폼·버튼에 맞추지 말 것).
              종전엔 폼 높이에 사진을 맞춰(bg-cover) 위저드 1단계처럼 폼이 짧으면 포스터가 잘렸다.
              지금은 aspect 로 원본 비율을 고정해 사진이 카드 최소 높이를 정하고, 폼이 그보다
              길어질 때만(3단계 등) 카드가 늘어난다 — 그때도 사진은 비율을 지킨 채 위에 남는다. */}
        {/* 폭을 원본 비율(723/975)에서 역산 — 카드 높이 830px × 0.742 ≈ 615px.
            컨테이너 비율 = 파일 비율이라 bg-cover 여도 **잘리는 데가 없다**. */}
        <div className="relative hidden h-full shrink-0 aspect-[723/975] overflow-hidden rounded-l-3xl md:block">
          <div
            className="absolute inset-0 bg-cover"
            style={{
              backgroundColor: "#13243f",
              backgroundImage: "url(/brand/mainpic0.jpg)",
              // 중앙 정렬 구도(안전모·상단 문구가 가운데) → 중앙 크롭으로 좌우 균등 노출
              backgroundPosition: "50% 50%",
            }}
          />
        </div>

        {/* 우측 — 로그인 폼. 고정된 카드 높이 안에서 세로 중앙, 내용이 넘치면 이 칸만 스크롤한다
            (카드·사진 크기는 그대로 유지 — 넘치는 쪽이 양보한다). */}
        <div
          className={`no-scrollbar flex w-full flex-col items-center justify-center overflow-y-auto px-6 md:min-w-0 md:flex-1 ${
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

          {/* 계정 찾기 — 비밀번호를 잊으면 되돌릴 길이 아예 없었다(2026-08-15 사용자 지적). */}
          <p className="pt-1 text-center text-xs text-white/80 drop-shadow">
            <button
              type="button"
              onClick={() => {
                setMode("recovery");
                setError(null);
                setSignupMsg(null);
              }}
              className="font-semibold text-white underline underline-offset-2 hover:text-sky-200"
            >
              {t.findAccount}
            </button>
          </p>

          {/* 회원가입 전환 */}
          <p className="text-center text-xs text-white/80 drop-shadow">
            {t.noAccount}{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setSignupStep(1);
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
          {" · "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-white">
            {t.privacyLink}
          </a>
        </p>

        {/* 스토어 다운로드 배지 — 중앙 정렬(App Store / Google Play) */}
        <div className="hidden md:block">
          <StoreBadges />
        </div>
          </>
          ) : mode === "recovery" ? (
        <AccountRecovery
          lang={lang}
          onBack={() => {
            setMode("login");
            setError(null);
          }}
        />
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
            <span className="ml-2 font-normal normal-case tracking-normal text-white/55">
              {shownSignupStep} / {totalSignupSteps}
            </span>
          </p>
          {/* ── 1단계 · 가입 유형 — 저장은 org_type 컬럼(role 은 그대로 admin). */}
          {signupStep === 1 && (
          <div className="col-span-2">
            <span className={LABEL_PHONE_HIDDEN}>{t.orgTypeLabel}</span>
            <SlidingSegmented
              className="mt-1 grid grid-cols-3 gap-1.5"
              indicatorClassName="rounded-xl border border-white/70 bg-white/25 backdrop-blur-md"
              items={[
                { value: "vitalguard" as const, label: t.orgTypeVitalguard },
                { value: "jodal" as const, label: t.orgTypeJodal },
                { value: "kosha" as const, label: t.orgTypeKosha },
                { value: "contractor" as const, label: t.orgTypeContractor },
              ]}
              value={sOrgType}
              onChange={(value) => {
                setSOrgType(value);
                // 유형이 바뀌면 고를 수 있는 상호가 달라진다 — 자사 유형은 단일이라 바로 채우고,
                // 그 외 유형은 비워 다시 고르게 한다(안 비우면 이전 유형의 상호가 남아 제출된다).
                setSCompany(value === "vitalguard" ? VITALGUARD_COMPANY : "");
              }}
              itemClassName={(active) =>
                `rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur-md transition-colors md:py-3 ${
                  active ? "border-transparent text-white" : "border-white/25 bg-white/10 text-white/70 hover:text-white"
                }`
              }
            />
          </div>
          )}
          {signupStep === 1 && (
            <LiquidMetalButton
              type="button"
              onClick={() => setSignupStep(stepAfterOrgType)}
              label={t.signupNext}
              className="mt-1 w-full col-span-2"
            />
          )}

          {/* ── 2단계 · 회사(상호). 선택지는 1단계의 가입 유형이 정한다. */}
          {signupStep === 2 && (
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-white/90 drop-shadow">
              {t.companyLabel}
            </span>
            {/* 선택지는 가입 유형이 정한다 — VitAlGuard 관리자는 자사 1개뿐이라 고를 것이 없다. */}
            <select
              value={sCompany}
              onChange={(e) => setSCompany(e.target.value)}
              required
              style={SELECT_CHEVRON}
              className={SELECT_CLASS}
            >
              {sOrgType !== "vitalguard" && (
                <option value="" className="text-black">
                  {t.companySelect}
                </option>
              )}
              {companiesForOrgType(sOrgType).map((c) => (
                <option key={c} value={c} className="text-black">
                  {c}
                </option>
              ))}
            </select>
          </label>
          )}
          {signupStep === 2 && (
            <>
              <LiquidMetalButton
                type="button"
                onClick={() => setSignupStep(3)}
                disabled={!sCompany}
                label={t.signupNext}
                className="mt-1 w-full col-span-2"
              />
              <button
                type="button"
                onClick={() => setSignupStep(1)}
                className="col-span-2 pt-1 text-center text-xs font-semibold text-white/80 underline underline-offset-2 drop-shadow hover:text-sky-200"
              >
                {t.signupBack}
              </button>
            </>
          )}

          {/* ── 3단계 · 나머지 입력(이름 → … → 비밀번호 확인) */}
          {signupStep === 3 && (
          <>
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
          {/* 통신사(30%) + 연락처(70%) — 한 줄, 통신사 먼저. 라벨은 칸마다 따로 둔다(2026-08-28
              사용자 지시 — 합친 라벨로는 어느 칸이 무엇인지 구분이 안 된다). 폭 배분 근거 =
              통신사 텍스트는 짧고(SKT 등) 전화번호는 3분절로 길다. */}
          <div className="col-span-2 flex justify-between gap-1.5">
            {/* 통신사 칸을 30%→25% 로 줄여 연락처와의 사이 여백을 벌린다(2026-08-28 사용자 지시 —
                여백은 통신사 칸을 줄이는 방식으로). 남는 ~5% 가 justify-between 으로 사이 여백이 된다. */}
            <label className="block w-[25%] min-w-0">
              <span className={LABEL_PHONE_HIDDEN}>{t.carrierLabel}</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <select
                  value={carrierBase}
                  onChange={(e) => {
                    setCarrierBase(e.target.value);
                    if (e.target.value !== "알뜰폰") setMvno(""); // 일반 3사로 바꾸면 망 선택 해제
                  }}
                  required
                  style={SELECT_CHEVRON}
                  className={`${SELECT_BASE} w-full min-w-0`}
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
                    className={`${SELECT_BASE} w-full min-w-0`}
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
            <div className="w-[70%] min-w-0">
              <span className={LABEL_PHONE_HIDDEN}>{t.phoneLabel}</span>
              <div className="mt-1 flex items-center gap-1.5">
                <select
                  value={phonePrefix}
                  onChange={(e) => setPhonePrefix(e.target.value)}
                  style={SELECT_CHEVRON}
                  className={`${SELECT_BASE} w-20`}
                  aria-label={t.phoneLabel}
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
                  className={`${FIELD_BASE} w-full min-w-0 flex-1 text-center`}
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
                  className={`${FIELD_BASE} w-full min-w-0 flex-1 text-center`}
                />
              </div>
            </div>
          </div>
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
              {/* 도메인 = **탭 하나**(2026-08-28 사용자 지시 — 입력칸과 화살표를 분리하지 않는다).
                  겉보기엔 화살표 달린 입력 필드 하나다: 그 안에 도메인을 바로 치고(반투명
                  플레이스홀더 「직접 입력」), 우측 화살표를 누르면 목록(직접 입력·프리셋)이
                  열린다 — 프리셋을 고르면 **같은 칸에** 채워지고 이어서 수정도 된다.
                  구현 = 입력 위에 투명 셀렉트를 화살표 폭만큼 겹쳐 놓은 것. */}
              <div className="relative min-w-0 flex-1">
                <input
                  type="text"
                  value={emailDomainCustom}
                  onChange={(e) => setEmailDomainCustom(e.target.value.replace(/[\s@]/g, ""))}
                  placeholder={t.emailDomainCustom}
                  style={SELECT_CHEVRON}
                  className={`${FIELD_BASE} w-full min-w-0 pr-9`}
                />
                <select
                  // 친 값이 프리셋과 같으면 목록에서 그 항목에 체크가 가게, 아니면 직접 입력에.
                  value={EMAIL_DOMAINS.includes(emailDomainCustom) ? emailDomainCustom : CUSTOM_DOMAIN}
                  onChange={(e) =>
                    setEmailDomainCustom(e.target.value === CUSTOM_DOMAIN ? "" : e.target.value)
                  }
                  className="absolute inset-y-0 right-0 w-10 cursor-pointer opacity-0"
                  aria-label="이메일 도메인 선택"
                >
                  <option value={CUSTOM_DOMAIN} className="text-black">
                    {t.emailDomainCustom}
                  </option>
                  {EMAIL_DOMAINS.map((d) => (
                    <option key={d} value={d} className="text-black">
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {/* 계정 묶음 — 관리자 ID(중복확인) → 비밀번호 → 비밀번호 확인 순 세로 배치
              (2026-08-28 사용자 지시 "관리자 ID 비밀번호 위에 위치"). */}
          <div className="col-span-2">
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
          {/* 비밀번호 → 그 아래 비밀번호 확인 — 세로 배치(2026-08-28 사용자 지시).
              규칙 메시지는 비밀번호 바로 아래, 불일치 메시지는 확인 칸 바로 아래에 둔다. */}
          <label className="block col-span-2">
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
          {pwVerdictMsg && (
            <p className="col-span-2 text-[11px] font-semibold text-amber-200 drop-shadow">
              {pwVerdictMsg}
            </p>
          )}
          <label className="block col-span-2">
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
          {pwMismatchLive && (
            <p className="col-span-2 text-[11px] font-semibold text-amber-200 drop-shadow">
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
              !signupCompany ||
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
          <button
            type="button"
            onClick={() => setSignupStep(skipCompanyStep ? 1 : 2)}
            className="col-span-2 pt-1 text-center text-xs font-semibold text-white/80 underline underline-offset-2 drop-shadow hover:text-sky-200"
          >
            {t.signupBack}
          </button>
          </>
          )}

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
                  ["jodal", t.orgTypeJodal],
                  ["kosha", t.orgTypeKosha],
                  ["contractor", t.orgTypeContractor],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setGOrgType(value);
                    setGCompany(value === "vitalguard" ? VITALGUARD_COMPANY : "");
                  }}
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
              {gOrgType !== "vitalguard" && (
                <option value="" className="text-black">
                  {t.companySelect}
                </option>
              )}
              {companiesForOrgType(gOrgType).map((c) => (
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
          <>
            {/* 임시 비밀번호 안내 — 만료(24h)가 지나면 로그인 자체가 막히므로 여기서 알린다.
                입장을 막지는 않는다(서버가 만료로 강제하는 구조라 화면 차단은 실효가 없다). */}
            {mustChangePw && (
              <p className="mt-4 w-full max-w-sm rounded-xl border border-amber-300/50 bg-amber-500/25 px-3 py-2 text-xs text-amber-50 backdrop-blur-md">
                {t.tempPwNotice}
              </p>
            )}
            {/* 2단계 인증 미등록 안내 — 고권한 계정인데 아직 안 켠 경우.
                ⚠ 입장을 막지 않는다. 등록 화면이 로그인 뒤(내 정보)에 있어서, 여기서 막으면
                  등록할 방법 자체가 사라져 계정이 잠긴다. */}
            {twoFactorPendingNotice && (
              <p className="mt-4 w-full max-w-sm rounded-xl border border-sky-300/50 bg-sky-500/25 px-3 py-2 text-xs text-sky-50 backdrop-blur-md">
                {t.twoFactorPendingNotice}
              </p>
            )}
            <LoginSiteSelect
              lang={lang}
              onConfirm={handleSiteConfirm}
              onBack={() => setPendingToken(null)}
            />
          </>
        )}
          </div>
        </div>

        {/* 2단계 인증 — 카드 안에 절대배치해 카드 위로 떠오른다(2026-08-28 사용자 지시).
            ⚠ 카드 밖(화면 전체)에 두지 않는다 — 뒤 카드가 흐려진 채 그대로 보여야
              "로그인이 취소된 게 아니라 한 단계가 남았다"로 읽힌다. */}
        {twoFactorOpen && (
          <TwoFactorPrompt
            submitting={submitting}
            error={twoFactorError}
            onSubmit={(code) => void attemptLogin(code)}
            onCancel={() => {
              setTwoFactorOpen(false);
              setTwoFactorError(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
