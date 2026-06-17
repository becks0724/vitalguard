"use client";
// 시공사(현장 담당) 제출 폼 — 세금계산서·계좌·대장 수치 + 사진대지 업로드를 피검증자가 제출.
//   검증자(조달청)는 /weekly-report 에서 이 제출분을 워치 실측과 대조만 한다(수정 불가).
//   실서비스: 세금계산서=팝빌/CODEF 파싱 · 계좌=오픈뱅킹 · 대장/사진=관리자앱 업로드.
import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

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
        fetch(`/api/weekly-report/inputs?contractId=${encodeURIComponent(contractId)}`),
        fetch(`/api/weekly-report/photos?contractId=${encodeURIComponent(contractId)}`),
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
      const r = await fetch("/api/weekly-report/photos", { method: "POST", body: fd });
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
        headers: { "Content-Type": "application/json" },
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
        <div className="mt-1 flex items-center gap-2">
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFiles(e.target.files)}
            className="min-w-0 flex-1 text-xs text-body dark:text-on-dark-soft"
          />
          <button
            onClick={uploadPhotos}
            disabled={uploading || !files}
            className="shrink-0 rounded-md border border-hairline px-3 py-1.5 text-xs font-semibold text-body disabled:opacity-50 dark:border-white/10 dark:text-on-dark-soft"
          >
            {uploading ? "업로드 중…" : "업로드"}
          </button>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button onClick={save} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
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
