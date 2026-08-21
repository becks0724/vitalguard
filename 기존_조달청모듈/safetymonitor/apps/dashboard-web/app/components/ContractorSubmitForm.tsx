"use client";
// 시공사(현장 담당) 제출 폼 — 세금계산서·계좌·대장 수치 + 사진대지 업로드를 피검증자가 제출.
//   검증자(조달청)는 /weekly-report 에서 이 제출분을 워치 실측과 대조만 한다(수정 불가).
//   실서비스: 세금계산서=팝빌/CODEF 파싱 · 계좌=오픈뱅킹 · 대장/사진=관리자앱 업로드.
import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

import { getSessionToken } from "./session-token";

// 로그인 세션 토큰을 Authorization 으로 동봉 — 서버 게이트(verifyBasicAuth) 통과용. 없으면 빈 헤더(→401).
function authHeaders(): Record<string, string> {
  const t = getSessionToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

type Notice = { id: string; title: string; agency: string };
type Inputs = {
  supplier: string | null;
  supplierBno: string | null;
  claimedHeadcount: number | null;
  invoiceTotal: number | null;
  paidTotal: number | null;
  ledgerHeadcount: number | null;
  photoCount: number | null;
};

const inputCls =
  "w-full rounded-md border border-hairline bg-surface-soft px-2 py-1.5 text-sm text-ink outline-none focus:border-primary dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark";

export default function ContractorSubmitForm() {
  const [sites, setSites] = useState<Notice[]>([]);
  const [contractId, setContractId] = useState<string>("");
  const [form, setForm] = useState({
    supplier: "",
    supplierBno: "",
    claimedHeadcount: "",
    invoiceTotal: "",
    paidTotal: "",
    ledgerHeadcount: "",
  });
  const [photoCount, setPhotoCount] = useState(0);
  const [files, setFiles] = useState<FileList | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch("/api/g2b/contracts");
      const j = (await r.json()) as { items?: Notice[] };
      const items = j.items ?? [];
      if (!alive) return;
      setSites(items);
      const first = items[0];
      if (first) setContractId(first.id);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!contractId) return;
    let alive = true;
    (async () => {
      const [ir, pr] = await Promise.all([
        fetch(`/api/weekly-report/inputs?contractId=${encodeURIComponent(contractId)}`, { headers: authHeaders() }),
        fetch(`/api/weekly-report/photos?contractId=${encodeURIComponent(contractId)}`, { headers: authHeaders() }),
      ]);
      const ij = (await ir.json()) as { inputs: Inputs | null };
      const pj = (await pr.json()) as { count: number };
      if (!alive) return;
      const inp = ij.inputs;
      setForm({
        supplier: inp?.supplier ?? "",
        supplierBno: inp?.supplierBno ?? "",
        claimedHeadcount: inp?.claimedHeadcount?.toString() ?? "",
        invoiceTotal: inp?.invoiceTotal?.toString() ?? "",
        paidTotal: inp?.paidTotal?.toString() ?? "",
        ledgerHeadcount: inp?.ledgerHeadcount?.toString() ?? "",
      });
      setPhotoCount(pj.count ?? 0);
      setSaved(false);
    })();
    return () => {
      alive = false;
    };
  }, [contractId]);

  const num = (s: string): number | undefined => {
    const n = Number(s.replace(/[,\s]/g, ""));
    return s.trim() !== "" && Number.isFinite(n) ? n : undefined;
  };
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  async function uploadPhotos() {
    if (!files || files.length === 0 || !contractId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("contractId", contractId);
      Array.from(files).forEach((f) => fd.append("photos", f));
      const r = await fetch("/api/weekly-report/photos", { method: "POST", headers: authHeaders(), body: fd });
      const j = (await r.json()) as { count?: number };
      setPhotoCount(j.count ?? photoCount);
      setFiles(null);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!contractId) return;
    setSaving(true);
    try {
      await fetch("/api/weekly-report/inputs", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          contractId,
          supplier: form.supplier || undefined,
          supplierBno: form.supplierBno || undefined,
          claimedHeadcount: num(form.claimedHeadcount),
          invoiceTotal: num(form.invoiceTotal),
          paidTotal: num(form.paidTotal),
          ledgerHeadcount: num(form.ledgerHeadcount),
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-6 dark:border-white/10 dark:bg-surface-dark">
      <h1 className="text-lg font-bold text-ink dark:text-on-dark">시공사 안전관리비 청구 제출</h1>
      <p className="mt-1 text-xs text-muted dark:text-on-dark-soft">
        세금계산서·계좌이체·근로자 대장·사진대지를 제출합니다. 제출분은 조달청 검증 화면에서 워치 실측과 대조됩니다(검증자 수정 불가).
      </p>

      <label className="mt-4 block text-xs font-semibold text-body dark:text-on-dark-soft">현장</label>
      <select value={contractId} onChange={(e) => setContractId(e.target.value)} className={`mt-1 ${inputCls}`}>
        {sites.length === 0 && <option value="">현장 불러오는 중…</option>}
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="안전장비 공급자">
          <input value={form.supplier} onChange={set("supplier")} className={inputCls} placeholder="예: 대한안전산업(주)" />
        </Field>
        <Field label="공급자 사업자번호">
          <input value={form.supplierBno} onChange={set("supplierBno")} inputMode="numeric" className={inputCls} placeholder="10자리" />
        </Field>
        <Field label="세금계산서 청구 인원(명분)">
          <input value={form.claimedHeadcount} onChange={set("claimedHeadcount")} inputMode="numeric" className={inputCls} placeholder="예: 10" />
        </Field>
        <Field label="근로자 대장 인원(명)">
          <input value={form.ledgerHeadcount} onChange={set("ledgerHeadcount")} inputMode="numeric" className={inputCls} placeholder="예: 7" />
        </Field>
        <Field label="세금계산서 총액(원)">
          <input value={form.invoiceTotal} onChange={set("invoiceTotal")} inputMode="numeric" className={inputCls} placeholder="예: 850000" />
        </Field>
        <Field label="계좌이체 실지급(원)">
          <input value={form.paidTotal} onChange={set("paidTotal")} inputMode="numeric" className={inputCls} placeholder="예: 595000" />
        </Field>
      </div>

      <div className="mt-4">
        <label className="block text-xs font-semibold text-body dark:text-on-dark-soft">
          사진대지 업로드 <span className="text-muted">(현재 {photoCount}장)</span>
        </label>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted dark:text-on-dark-soft">
          안전관리비를 실제로 집행한 <b>증빙 사진</b>을 올립니다 — 안전모·안전대 등 <b>보호구 지급</b>, 안전난간·방호망 등 <b>안전시설 설치</b>,
          <b> 안전교육·점검</b> 활동 사진 등. 세금계산서·근로자 대장과 함께 실집행을 입증하며, 조달청 검증 화면에서 워치 실측과 대조됩니다.
        </p>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) setFiles(e.dataTransfer.files);
          }}
          className={`mt-1.5 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition dark:bg-surface-dark-elevated ${
            dragging ? "border-primary bg-surface-soft" : "border-hairline bg-surface-soft hover:border-primary dark:border-white/15"
          }`}
        >
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFiles(e.target.files)}
            className="hidden"
          />
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={dragging ? "text-primary" : "text-muted"}
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M12 15V3" />
            <path d="m7 8 5-5 5 5" />
          </svg>
          <span className="text-xs font-semibold text-body dark:text-on-dark-soft">
            {files && files.length > 0 ? `사진 ${files.length}장 선택됨` : "이미지를 드래그하거나 클릭해 선택"}
          </span>
          <span className="text-[11px] text-muted dark:text-on-dark-soft">JPG · PNG 등 이미지 파일 · 여러 장 가능</span>
        </label>
        <button
          onClick={uploadPhotos}
          disabled={uploading || !files}
          className="mt-2 w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted"
        >
          {uploading ? "업로드 중…" : files && files.length > 0 ? `${files.length}장 업로드` : "업로드"}
        </button>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button onClick={save} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted">
          {saving ? "제출 중…" : "청구 내역 제출"}
        </button>
        <a href="/weekly-report" className="rounded-md border border-hairline px-4 py-2 text-sm font-semibold text-body dark:border-white/10 dark:text-on-dark-soft">
          검증 보고서 보기 →
        </a>
      </div>
      {saved && <p className="mt-2 text-xs text-[#05b169]">제출 완료 — 검증 보고서에 반영됩니다.</p>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-body dark:text-on-dark-soft">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
