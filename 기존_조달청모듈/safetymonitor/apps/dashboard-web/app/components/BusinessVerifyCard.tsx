"use client";
// ②사용축 — 탭 전환: [발급처 검증] 국세청 사업자등록 상태조회 / [발급사실 확인] 홈택스 제3자 전자세금계산서 조회(CODEF).
// 발급처 검증 = 공급자가 정상(계속사업자)인지. 발급사실 확인 = 그 세금계산서가 실제 국세청에 전송됐는지(5요소, 인증서 불요).
// 발급사실 조회 이력(시각)을 남겨 '지급 직전 재조회'(제출 후 취소 감시 L1)를 기록한다.
import { useState } from "react";

type Status = { bno: string; status: string; statusCode: string; taxType: string; closedDate?: string; ok: boolean };
type Resp = { source: "live" | "mock"; items: Status[]; note?: string };

type TwoWayInfo = { jobIndex: number; threadIndex: number; jti: string; twoWayTimestamp: number };
type IssuancePayload = {
  source: "live" | "mock";
  issued: boolean | null;
  statusText: string;
  checkedAt: string;
  pendingAuth?: TwoWayInfo;
  note?: string;
};

const INPUT_CLS =
  "min-w-0 rounded-md border border-hairline bg-surface-soft px-2 py-1 text-[11px] tabular-nums text-ink outline-none focus:border-primary dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark";

// 시연용 데모 값(S9 시나리오 — 대한안전산업 → 시공사 청구건)
const DEMO_INVOICE = {
  supplierBno: "410-00-01277",
  buyerBno: "617-81-00124",
  approvalNo: "20260617-41000012-77120034",
  writeDate: "20260617",
  supplyAmount: "1710000",
};

export default function BusinessVerifyCard() {
  const [tab, setTab] = useState<"issuer" | "issuance">("issuer");

  // ── 발급처 검증(기존) ──
  const [bno, setBno] = useState("");
  const [result, setResult] = useState<Status | null>(null);
  const [source, setSource] = useState<"live" | "mock" | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check() {
    const clean = bno.replace(/[^0-9]/g, "");
    if (clean.length !== 10) {
      setErr("사업자번호 10자리를 입력하세요");
      setResult(null);
      return;
    }
    setErr(null);
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch("/api/nts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bno: clean }),
      });
      const j = (await r.json()) as Resp;
      setResult(j.items[0] ?? null);
      setSource(j.source);
      if (!j.items[0]) setErr("조회 결과 없음");
    } catch {
      setErr("조회 실패");
    } finally {
      setLoading(false);
    }
  }

  // ── 발급사실 확인(신규) ──
  const [inv, setInv] = useState({ supplierBno: "", buyerBno: "", approvalNo: "", writeDate: "", supplyAmount: "" });
  const [invResult, setInvResult] = useState<IssuancePayload | null>(null);
  const [invErr, setInvErr] = useState<string | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invHistory, setInvHistory] = useState<{ at: string; issued: boolean | null }[]>([]);

  function setInvField(key: keyof typeof inv) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setInv((p) => ({ ...p, [key]: e.target.value }));
  }

  async function checkIssuance(twoWay?: TwoWayInfo) {
    setInvErr(null);
    setInvLoading(true);
    try {
      const r = await fetch("/api/tax-invoice-issuance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(twoWay ? { ...inv, twoWay } : inv),
      });
      const j = (await r.json()) as IssuancePayload & { error?: { message: string } };
      if (j.error) {
        setInvErr(j.error.message);
        setInvResult(null);
        return;
      }
      setInvResult(j);
      // 인증 대기 상태는 결과가 아니므로 이력에는 확정 결과만 기록.
      if (!j.pendingAuth) setInvHistory((p) => [{ at: j.checkedAt, issued: j.issued }, ...p].slice(0, 3));
    } catch {
      setInvErr("조회 실패");
      setInvResult(null);
    } finally {
      setInvLoading(false);
    }
  }

  const invPill =
    invResult?.issued === true
      ? "bg-[#05b169]/10 text-[#05b169]"
      : invResult?.issued === false
        ? "bg-[#cf202f]/10 text-[#cf202f]"
        : "bg-amber-500/10 text-amber-600";
  const pending = invResult?.pendingAuth;

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-3 dark:border-white/10 dark:bg-surface-dark">
      <div className="text-[10px] font-semibold text-muted">② 사용(지출)</div>
      <div className="mt-1.5 flex whitespace-nowrap rounded-md bg-surface-strong p-0.5 dark:bg-white/10">
        <button
          onClick={() => setTab("issuer")}
          className={`flex-1 rounded px-2 py-1 text-[11px] transition ${
            tab === "issuer"
              ? "bg-canvas font-semibold text-ink shadow-sm dark:bg-surface-dark-elevated dark:text-on-dark"
              : "font-medium text-muted hover:text-body dark:hover:text-on-dark-soft"
          }`}
        >
          발급처 검증
        </button>
        <button
          onClick={() => setTab("issuance")}
          className={`flex-1 rounded px-2 py-1 text-[11px] transition ${
            tab === "issuance"
              ? "bg-canvas font-semibold text-ink shadow-sm dark:bg-surface-dark-elevated dark:text-on-dark"
              : "font-medium text-muted hover:text-body dark:hover:text-on-dark-soft"
          }`}
        >
          발급사실 확인
        </button>
      </div>

      {tab === "issuer" && (
        <>
          <div className="mt-2 flex gap-1">
            <input
              value={bno}
              onChange={(e) => setBno(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") check();
              }}
              inputMode="numeric"
              placeholder="사업자번호 10자리"
              className={`${INPUT_CLS} flex-1`}
            />
            <button
              onClick={check}
              disabled={loading}
              className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-on-primary hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted"
            >
              {loading ? "…" : "조회"}
            </button>
          </div>

          {err && <p className="mt-1 text-[10px] text-[#cf202f]">{err}</p>}

          {result && (
            <div className="mt-2">
              <span
                className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
                  result.ok ? "bg-[#05b169]/10 text-[#05b169]" : "bg-[#cf202f]/10 text-[#cf202f]"
                }`}
              >
                ● {result.status}
              </span>
              {result.taxType && <p className="mt-1 text-[10px] text-muted dark:text-on-dark-soft">{result.taxType}</p>}
              {result.closedDate && <p className="mt-0.5 text-[10px] text-[#cf202f]">폐업일 {result.closedDate}</p>}
              {source === "mock" && <p className="mt-0.5 text-[9px] text-muted">샘플(국세청 키 연결 시 실데이터)</p>}
            </div>
          )}
        </>
      )}

      {tab === "issuance" && (
        <>
          <div className="mt-2 flex flex-col gap-1">
            <input
              value={inv.approvalNo}
              onChange={setInvField("approvalNo")}
              inputMode="numeric"
              placeholder="승인번호 24자리"
              className={INPUT_CLS}
            />
            <div className="flex gap-1">
              <input
                value={inv.supplierBno}
                onChange={setInvField("supplierBno")}
                inputMode="numeric"
                placeholder="공급자 사업자번호"
                className={`${INPUT_CLS} flex-1`}
              />
              <input
                value={inv.buyerBno}
                onChange={setInvField("buyerBno")}
                inputMode="numeric"
                placeholder="공급받는자 사업자번호"
                className={`${INPUT_CLS} flex-1`}
              />
            </div>
            <div className="flex gap-1">
              <input
                value={inv.writeDate}
                onChange={setInvField("writeDate")}
                inputMode="numeric"
                placeholder="작성일자 YYYYMMDD"
                className={`${INPUT_CLS} flex-1`}
              />
              <input
                value={inv.supplyAmount}
                onChange={setInvField("supplyAmount")}
                inputMode="numeric"
                placeholder="공급가액"
                className={`${INPUT_CLS} flex-1`}
              />
              <button
                onClick={() => checkIssuance()}
                disabled={invLoading}
                className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-on-primary hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted"
              >
                {invLoading ? "…" : "조회"}
              </button>
            </div>
            <button
              onClick={() => setInv(DEMO_INVOICE)}
              className="self-start text-[9px] text-muted underline underline-offset-2 hover:text-body dark:hover:text-on-dark-soft"
            >
              시나리오 값 채우기
            </button>
          </div>

          {invErr && <p className="mt-1 text-[10px] text-[#cf202f]">{invErr}</p>}

          {invResult && (
            <div className="mt-2">
              <span className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${invPill}`}>
                ● {invResult.statusText}
              </span>
              {pending && (
                <button
                  onClick={() => checkIssuance(pending)}
                  disabled={invLoading}
                  className="mt-1 block rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-on-primary hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted"
                >
                  {invLoading ? "…" : "카카오 인증 완료 — 결과 조회"}
                </button>
              )}
              {invResult.source === "mock" && (
                <p className="mt-0.5 text-[9px] text-muted">{invResult.note ?? "데모 — CODEF 키 연결 시 실조회 전환"}</p>
              )}
              {invResult.source === "live" && (
                <p className="mt-0.5 text-[9px] text-muted">홈택스 제3자 발급사실 조회 · CODEF 실호출</p>
              )}
            </div>
          )}

          {invHistory.length > 0 && (
            <div className="mt-2 border-t border-hairline pt-1 dark:border-white/10">
              <p className="text-[9px] font-semibold text-muted">조회 이력 (지급 직전 재조회 기록)</p>
              {invHistory.map((h) => (
                <p key={h.at} className="text-[9px] tabular-nums text-muted">
                  {new Date(h.at).toLocaleTimeString("ko-KR")} ·{" "}
                  {h.issued === true ? "전송 확인" : h.issued === false ? "발급사실 없음" : "판독 불가"}
                </p>
              ))}
            </div>
          )}

          <p className="mt-2 text-[9px] leading-relaxed text-muted">
            제출 후 취소(수정세금계산서) 감시: 지급 직전 재조회 + 주기 재조회 · 수집형 자동 탐지 [계획]
          </p>
        </>
      )}
    </div>
  );
}
