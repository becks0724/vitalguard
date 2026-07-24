// 회원 본인 정보 수정 모달 — 로그인한 가입 회원(admin)이 이름·회사·연락처·통신사 + (선택)비밀번호 변경. /api/admin/profile (Bearer).
"use client";

import { useCallback, useEffect, useState } from "react";

import { CARRIERS, MVNO_NETS, composeCarrier, parseCarrier } from "../../lib/carriers";
import { ALLOWED_COMPANIES } from "../../lib/companies";
import { getSessionToken } from "./LoginGate";

const PHONE_PREFIXES = ["010", "011", "016", "017", "018", "019"];

const LBL = "text-xs font-semibold text-muted dark:text-on-dark-soft";
const FIELD_BASE =
  "rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink outline-none transition focus:border-primary dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark";
const FIELD = `mt-1 w-full ${FIELD_BASE}`;
const FIELD_RO =
  "mt-1 w-full rounded-lg border border-hairline bg-surface-strong px-3 py-1.5 text-sm text-muted dark:border-white/10 dark:bg-white/5 dark:text-on-dark-soft";
// 셀렉트 — appearance-none 으로 네이티브 위젯(사각·기본 화살표) 끄고 입력 박스와 동일한 둥근 모양으로 통일.
const SELECT_BASE =
  "appearance-none rounded-lg border border-hairline bg-canvas py-1.5 pl-3 pr-9 text-sm text-ink outline-none transition focus:border-primary dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark";
const SELECT_FULL = `mt-1 w-full ${SELECT_BASE}`;
// 드롭다운 화살표 — 라이트/다크 공통으로 보이는 회색(gray-400) SVG 배경.
const SELECT_CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.6rem center",
  backgroundSize: "1.1rem 1.1rem",
};

type Profile = {
  username: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  carrier: string | null;
  email: string | null;
  auth_provider: string;
  department: string | null;
  job_title: string | null;
  employee_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
};

// 저장된 연락처를 3박스로 역분해(숫자만 추출 → 접두 3 / 끝 4 / 중간).
function splitPhone(phone: string | null): { prefix: string; mid: string; last: string } {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 7) return { prefix: "010", mid: "", last: "" };
  return { prefix: d.slice(0, 3), mid: d.slice(3, -4), last: d.slice(-4) };
}

export function MyProfileModal({ onClose }: { onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [editable, setEditable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false); // 저장 성공 → '변경 완료' 확인 다이얼로그 표시(예 클릭 시 모달 닫기).
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState("password");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [department, setDepartment] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [prefix, setPrefix] = useState("010");
  const [mid, setMid] = useState("");
  const [last, setLast] = useState("");
  const [carrierBase, setCarrierBase] = useState(""); // SKT/KT/LG U+/알뜰폰
  const [mvno, setMvno] = useState(""); // 알뜰폰일 때 호스트망(KT/SKT/LG U+)
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwOpen, setPwOpen] = useState(false); // 비밀번호 변경 섹션 접기(기본 접힘) — 한 화면 레이아웃.

  // 모달 열려 있는 동안 배경(관제웹) 스크롤 잠금 — 팝업 스크롤이 뒤로 전파되는 현상 방지.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/profile", {
          headers: { authorization: `Bearer ${getSessionToken() ?? ""}` },
          cache: "no-store",
        });
        const j = (await res.json()) as {
          ok?: boolean;
          editable?: boolean;
          profile?: Profile | null;
          error?: string;
        };
        if (!res.ok || !j.ok) {
          setError(j.error || "정보를 불러오지 못했습니다.");
          setLoaded(true);
          return;
        }
        if (!j.editable || !j.profile) {
          setEditable(false);
          setLoaded(true);
          return;
        }
        const p = j.profile;
        setUsername(p.username);
        setEmail(p.email ?? "");
        setProvider(p.auth_provider);
        setName(p.name ?? "");
        setCompany(p.company ?? "");
        setDepartment(p.department ?? "");
        setJobTitle(p.job_title ?? "");
        setEmployeeId(p.employee_id ?? "");
        setGuardianName(p.guardian_name ?? "");
        setGuardianPhone(p.guardian_phone ?? "");
        const pc = parseCarrier(p.carrier);
        setCarrierBase(pc.base);
        setMvno(pc.mvno);
        const sp = splitPhone(p.phone);
        setPrefix(sp.prefix);
        setMid(sp.mid);
        setLast(sp.last);
        setLoaded(true);
      } catch {
        setError("네트워크 오류로 정보를 불러오지 못했습니다.");
        setLoaded(true);
      }
    })();
  }, []);

  const phoneValid = /^\d{3,4}$/.test(mid) && /^\d{4}$/.test(last);
  const composedPhone = `${prefix}-${mid}-${last}`;

  const save = useCallback(async () => {
    setError(null);
    if (!name.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }
    if (!company) {
      setError("회사(상호)를 선택해주세요.");
      return;
    }
    if (!phoneValid) {
      setError("연락처를 올바르게 입력해주세요.");
      return;
    }
    // 보호자는 선택 — 전화번호를 입력한 경우에만 형식 검증(연락처와 동일 규칙).
    if (guardianPhone.trim() && !/^[0-9+\-\s]{7,20}$/.test(guardianPhone.trim())) {
      setError("보호자 전화번호를 올바르게 입력해주세요.");
      return;
    }
    if (newPw || curPw || newPw2) {
      if (!curPw) {
        setError("현재 비밀번호를 입력해주세요.");
        return;
      }
      if (newPw.length < 8) {
        setError("새 비밀번호는 8자 이상이어야 합니다.");
        return;
      }
      if (newPw !== newPw2) {
        setError("새 비밀번호가 일치하지 않습니다.");
        return;
      }
    }
    setSaving(true);
    const carrier = composeCarrier(carrierBase, mvno);
    try {
      const res = await fetch("/api/admin/profile", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${getSessionToken() ?? ""}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          company,
          phone: composedPhone,
          carrier,
          department: department.trim(),
          jobTitle: jobTitle.trim(),
          employeeId: employeeId.trim(),
          guardianName: guardianName.trim(),
          guardianPhone: guardianPhone.trim(),
          ...(newPw ? { currentPassword: curPw, newPassword: newPw } : {}),
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !j.ok) {
        setError(j.error || "수정에 실패했습니다.");
        return;
      }
      setSaved(true);
      setCurPw("");
      setNewPw("");
      setNewPw2("");
    } catch {
      setError("네트워크 오류로 수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [name, company, phoneValid, composedPhone, carrierBase, mvno, department, jobTitle, employeeId, guardianName, guardianPhone, curPw, newPw, newPw2]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3 dark:border-white/10">
          <h2 className="text-sm font-bold text-ink dark:text-on-dark">
            내 정보 수정{" "}
            <span className="font-normal text-muted dark:text-on-dark-soft">
              · 가입 정보 변경
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill bg-surface-strong px-3 py-1 text-xs font-semibold text-body active:scale-95 dark:bg-surface-dark-elevated dark:text-on-dark-soft"
          >
            닫기
          </button>
        </div>

        <div className="wx-cards-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-5 py-3">
          {!loaded ? (
            <p className="py-6 text-center text-sm text-muted dark:text-on-dark-soft">
              불러오는 중…
            </p>
          ) : !editable ? (
            <p className="py-6 text-center text-sm text-muted dark:text-on-dark-soft">
              이 계정은 자가 수정 대상이 아닙니다. (환경 관리자 계정)
            </p>
          ) : (
            <>
              {error && (
                <p className="rounded-lg border border-red-300/50 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-200">
                  {error}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={LBL}>아이디</span>
                  <input value={username} readOnly className={FIELD_RO} />
                </label>
                <label className="block">
                  <span className={LBL}>사원번호</span>
                  <input
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    placeholder="예) 2024-0042"
                    className={FIELD}
                  />
                </label>
              </div>
              <label className="block">
                <span className={LBL}>
                  이메일{" "}
                  <span className="font-normal">(변경 불가 · 재인증 필요)</span>
                </span>
                <input value={email} readOnly className={FIELD_RO} />
              </label>
              <label className="block">
                <span className={LBL}>이름</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={FIELD}
                />
              </label>
              <label className="block">
                <span className={LBL}>회사(상호)</span>
                <select
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  style={SELECT_CHEVRON}
                  className={SELECT_FULL}
                >
                  <option value="">회사(상호) 선택</option>
                  {ALLOWED_COMPANIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={LBL}>부서</span>
                  <input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="예) 안전관리팀"
                    className={FIELD}
                  />
                </label>
                <label className="block">
                  <span className={LBL}>직책</span>
                  <input
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="예) 결제권자"
                    className={FIELD}
                  />
                </label>
              </div>
              <div>
                <span className={LBL}>연락처</span>
                <div className="mt-1 flex items-center gap-1.5">
                  <select
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    style={SELECT_CHEVRON}
                    className={`${SELECT_BASE} w-20`}
                  >
                    {PHONE_PREFIXES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted dark:text-on-dark-soft">-</span>
                  <input
                    value={mid}
                    onChange={(e) =>
                      setMid(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    maxLength={4}
                    inputMode="numeric"
                    className={`${FIELD_BASE} w-24 text-center`}
                  />
                  <span className="text-muted dark:text-on-dark-soft">-</span>
                  <input
                    value={last}
                    onChange={(e) =>
                      setLast(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    maxLength={4}
                    inputMode="numeric"
                    className={`${FIELD_BASE} w-24 text-center`}
                  />
                </div>
              </div>
              <label className="block">
                <span className={LBL}>통신사</span>
                <div className="mt-1 flex gap-1.5">
                  <select
                    value={carrierBase}
                    onChange={(e) => {
                      setCarrierBase(e.target.value);
                      if (e.target.value !== "알뜰폰") setMvno(""); // 일반 3사로 바꾸면 망 선택 해제
                    }}
                    style={SELECT_CHEVRON}
                    className={`${SELECT_BASE} flex-1`}
                  >
                    <option value="">통신사 선택</option>
                    {CARRIERS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {carrierBase === "알뜰폰" && (
                    <select
                      value={mvno}
                      onChange={(e) => setMvno(e.target.value)}
                      style={SELECT_CHEVRON}
                      className={`${SELECT_BASE} flex-1`}
                      aria-label="알뜰폰 사용 망"
                    >
                      <option value="">알뜰폰 통신사 선택</option>
                      {MVNO_NETS.map((n) => (
                        <option key={n} value={n}>
                          알뜰폰 {n}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>

              <div className="rounded-lg border border-hairline p-2.5 dark:border-white/10">
                {/* 보호자 연락처(선택) — 등록 시 SOS/낙상 알람에서 본인 사번 매칭으로 표출. */}
                <span className="text-xs font-semibold text-ink dark:text-on-dark">
                  보호자 연락처{" "}
                  <span className="font-normal text-muted dark:text-on-dark-soft">
                    (선택)
                  </span>
                </span>
                <p className="mt-0.5 text-[11px] text-muted dark:text-on-dark-soft">
                  SOS·낙상 알람 시 관제 대시보드에서 보호자에게 전화·문자를 발신합니다.
                </p>
                <div className="mt-2 space-y-1.5">
                  <label className="block">
                    <span className={LBL}>보호자 이름 / 관계</span>
                    <input
                      value={guardianName}
                      onChange={(e) => setGuardianName(e.target.value)}
                      placeholder="예) 김보호 (배우자)"
                      maxLength={40}
                      className={FIELD}
                    />
                  </label>
                  <label className="block">
                    <span className={LBL}>보호자 전화번호</span>
                    <input
                      value={guardianPhone}
                      onChange={(e) => setGuardianPhone(e.target.value)}
                      placeholder="010-1234-5678"
                      inputMode="tel"
                      maxLength={20}
                      className={FIELD}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-lg border border-hairline p-2.5 dark:border-white/10">
                {/* 비밀번호 변경 — 기본 접힘(선택 항목이라 한 화면 레이아웃 위해 펼침 토글). */}
                <button
                  type="button"
                  onClick={() => setPwOpen((v) => !v)}
                  className="flex w-full items-center justify-between text-xs font-semibold text-ink dark:text-on-dark"
                >
                  <span>
                    비밀번호 변경{" "}
                    <span className="font-normal text-muted dark:text-on-dark-soft">
                      (선택)
                    </span>
                  </span>
                  <span className="text-[10px] text-muted dark:text-on-dark-soft">
                    {pwOpen ? "접기 ▲" : "펼치기 ▼"}
                  </span>
                </button>
                {pwOpen &&
                  (provider !== "password" ? (
                    <p className="mt-2 text-[11px] text-muted dark:text-on-dark-soft">
                      구글 로그인 계정은 비밀번호를 변경할 수 없습니다.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      <input
                        type="password"
                        value={curPw}
                        onChange={(e) => setCurPw(e.target.value)}
                        placeholder="현재 비밀번호"
                        autoComplete="current-password"
                        className={FIELD}
                      />
                      <input
                        type="password"
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                        placeholder="새 비밀번호 (8자 이상)"
                        autoComplete="new-password"
                        className={FIELD}
                      />
                      <input
                        type="password"
                        value={newPw2}
                        onChange={(e) => setNewPw2(e.target.value)}
                        placeholder="새 비밀번호 확인"
                        autoComplete="new-password"
                        className={FIELD}
                      />
                    </div>
                  ))}
              </div>

              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="w-full rounded-pill bg-primary py-2 text-sm font-semibold text-on-primary active:scale-95 disabled:opacity-40"
              >
                {saving ? "저장 중…" : "저장"}
              </button>
            </>
          )}
        </div>

        {/* 저장 완료 확인 — 성공 시 카드 위에 오버레이. '예' 클릭 시 모달 전체 닫기(2차 닫기 불필요). */}
        {saved && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-6">
            <div className="w-full max-w-xs rounded-2xl border border-hairline-strong bg-canvas p-5 text-center shadow-xl dark:border-white/10 dark:bg-surface-dark">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  className="h-6 w-6 text-emerald-600 dark:text-emerald-300"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-bold text-ink dark:text-on-dark">
                변경이 완료되었습니다.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 w-full rounded-pill bg-primary py-2 text-sm font-semibold text-on-primary active:scale-95"
              >
                예
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
