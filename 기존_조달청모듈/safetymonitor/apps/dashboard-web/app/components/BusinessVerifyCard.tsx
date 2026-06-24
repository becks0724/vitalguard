"use client";
// ②사용축 — 국세청 사업자등록 상태조회. 안전관리비 지출 세금계산서의 발급처(공급자)가
// 정상(계속사업자)인지 검증한다. 휴업·폐업·미등록 발급처 = 가공/허위 세금계산서 위험 신호.
import { useState } from "react";

type Status = { bno: string; status: string; statusCode: string; taxType: string; closedDate?: string; ok: boolean };
type Resp = { source: "live" | "mock"; items: Status[]; note?: string };

export default function BusinessVerifyCard() {
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

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-3 dark:border-white/10 dark:bg-surface-dark">
      <div className="text-[10px] font-semibold text-muted">② 사용(지출)</div>
      <div className="mt-1 text-xs font-semibold text-body dark:text-on-dark-soft">세금계산서 발급처 검증</div>

      <div className="mt-2 flex gap-1">
        <input
          value={bno}
          onChange={(e) => setBno(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") check();
          }}
          inputMode="numeric"
          placeholder="사업자번호 10자리"
          className="min-w-0 flex-1 rounded-md border border-hairline bg-surface-soft px-2 py-1 text-[11px] tabular-nums text-ink outline-none focus:border-primary dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
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
    </div>
  );
}
