"use client";
// 현장 과업지시서 패널 — PDF 업로드 전용(텍스트 직접 입력은 위변조 우려로 미수용).
// 관리자가 과업지시서 PDF 를 올리면 서버가 텍스트 추출→위험작업 태깅(근거 문장 검증)→저장하고,
// 배치 어시스턴트의 매칭 범위가 그 태그로 축소된다. 미등록 시 전체 어휘 폴백.
// hwp/hwpx 는 파싱이 불안정하므로 감독관이 PDF 로 변환 후 업로드한다.
import { useCallback, useEffect, useRef, useState } from "react";

import { getSessionToken } from "./session-token";

type TaskTag = { tag: string; severity: number; evidence: string; source: string };

type DocResponse = {
  ok: boolean;
  doc?: {
    tags: TaskTag[];
    updatedBy: string;
    updatedAt: string;
    srcName: string | null;
    srcSha256: string | null;
  } | null;
  tags?: TaskTag[];
  error?: string;
};

function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

type NoticeDoc = { name: string; url: string };
type NoticeDocsResponse = {
  ok: boolean;
  source?: "live" | "mock";
  title?: string | null;
  docs?: NoticeDoc[];
  note?: string;
};

// 현장정보(localStorage)의 나라장터 공고번호 — 안전관리비 검증과 동일 매칭 키.
function siteNoticeId(): string {
  try {
    const raw = window.localStorage.getItem("safetymonitor.site-info.v1");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { noticeId?: unknown };
    return typeof parsed.noticeId === "string" ? parsed.noticeId.trim() : "";
  } catch {
    return "";
  }
}

const isPdfName = (name: string) => /\.pdf$/i.test(name);
const isHwpName = (name: string) => /\.hwpx?$/i.test(name);

export default function AssignmentTaskDocPanel() {
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [srcName, setSrcName] = useState<string | null>(null);
  const [srcSha256, setSrcSha256] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 현장 공고 문서(나라장터 첨부) — noticeId 로 자동 조회, 미연결 시 공고번호 수동 입력.
  const [noticeIdInput, setNoticeIdInput] = useState("");
  const [noticeTitle, setNoticeTitle] = useState<string | null>(null);
  const [noticeDocs, setNoticeDocs] = useState<NoticeDoc[] | null>(null);
  const [noticeNote, setNoticeNote] = useState<string | null>(null);
  const [noticeLoading, setNoticeLoading] = useState(false);

  const loadNoticeDocs = useCallback(async (id: string) => {
    if (!id) return;
    setNoticeLoading(true);
    setNoticeNote(null);
    try {
      const res = await fetch(
        `/api/assignment/site-notice-docs?noticeId=${encodeURIComponent(id)}`,
        { headers: authHeaders() },
      );
      const json = (await res.json()) as NoticeDocsResponse;
      if (!res.ok || !json.ok) throw new Error("fetch failed");
      setNoticeTitle(json.title ?? null);
      setNoticeDocs(json.docs ?? []);
      if (json.source === "mock") setNoticeNote("나라장터 키 미설정/응답 실패 — 샘플 조회 상태입니다.");
      else if (json.note) setNoticeNote(json.note);
    } catch {
      setNoticeDocs([]);
      setNoticeNote("공고 문서 조회에 실패했습니다.");
    } finally {
      setNoticeLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = siteNoticeId();
    if (id) {
      setNoticeIdInput(id);
      void loadNoticeDocs(id);
    }
  }, [loadNoticeDocs]);

  useEffect(() => {
    fetch("/api/assignment/task-doc", { headers: authHeaders() })
      .then((r) => (r.ok ? (r.json() as Promise<DocResponse>) : null))
      .then((json) => {
        if (json?.ok && json.doc) {
          setTags(Array.isArray(json.doc.tags) ? json.doc.tags : []);
          setUpdatedAt(json.doc.updatedAt);
          setSrcName(json.doc.srcName);
          setSrcSha256(json.doc.srcSha256);
        }
      })
      .catch(() => {
        /* 조회 실패 — 미등록 표시 유지 */
      });
  }, []);

  // PDF 업로드 → 서버 텍스트 추출·태깅·저장(유일한 등록 경로).
  const uploadPdf = useCallback(
    async (file: File) => {
      if (busy) return;
      setBusy(true);
      setNotice(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/assignment/task-doc", {
          method: "POST",
          headers: authHeaders(),
          body: form,
        });
        const json = (await res.json()) as DocResponse;
        if (res.status === 403) {
          setNotice("과업지시서 등록은 관리자 권한(권한있음) 계정만 가능합니다.");
          return;
        }
        if (!json.ok) {
          setNotice(json.error ?? "PDF 처리에 실패했습니다.");
          return;
        }
        setTags(json.tags ?? []);
        setUpdatedAt(new Date().toISOString());
        setSrcName(file.name);
        const n = json.tags?.length ?? 0;
        setNotice(
          n > 0
            ? `"${file.name}" 태깅 완료 — 검토 대상 작업 ${n}종으로 설정됐습니다.`
            : `"${file.name}" 처리 완료 — 문서에서 위험작업 내용을 찾지 못했습니다(행정 공고문 등). 전체 7종 검토를 유지합니다. 작업 내용이 담긴 문서(내역서·시방서 등)를 올려 보세요.`,
        );
      } catch {
        setNotice("업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [busy],
  );

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={(e) => {
        // 자식 요소로의 이동은 무시(섹션을 완전히 벗어날 때만 해제).
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !busy) void uploadPdf(f);
      }}
      className={
        "flex min-h-full flex-col rounded-2xl border bg-white px-5 py-4 shadow-sm transition-colors dark:bg-zinc-900 " +
        (dragging
          ? "border-blue-500 bg-blue-50/60 dark:border-blue-400 dark:bg-blue-500/10"
          : "border-zinc-200 dark:border-white/10")
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">현장 과업지시서</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {tags.length > 0
              ? `검토 대상 작업 ${tags.length}종 · ${updatedAt ? new Date(updatedAt).toLocaleString("ko-KR") : ""}` +
                (srcName ? ` · 원본 ${srcName}` : "") +
                (srcSha256 ? ` (SHA-256 ${srcSha256.slice(0, 12)}…)` : "")
              : "미등록 — 전체 위험작업 7종을 검토 대상으로 사용합니다."}
          </p>
        </div>
        <div className="shrink-0">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadPdf(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busy ? "PDF 분석·태깅 중…" : "PDF 업로드·태깅"}
          </button>
        </div>
      </div>

      {/* 현장 공고 문서(나라장터 첨부) — 감독관이 나라장터 접속 없이 시방서·과업내용서·공고규격서를 내려받는 곳 */}
      <div className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50/60 px-4 py-3 dark:border-white/5 dark:bg-white/5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            이 현장의 나라장터 문서
            {noticeTitle ? (
              <span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-400">
                — {noticeTitle}
              </span>
            ) : null}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              value={noticeIdInput}
              onChange={(e) => setNoticeIdInput(e.target.value)}
              placeholder="공고번호"
              className="w-36 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button
              type="button"
              onClick={() => void loadNoticeDocs(noticeIdInput.trim())}
              disabled={noticeLoading || noticeIdInput.trim().length === 0}
              aria-label="공고번호로 문서 조회"
              title={noticeLoading ? "조회 중…" : "조회"}
              className="grid w-[28px] shrink-0 self-stretch place-items-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/10"
            >
              {noticeLoading ? (
                <svg className="animate-spin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.6-3.6" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {noticeDocs === null ? (
          <p className="mt-1.5 text-[11px] text-zinc-400">
            현장정보에 연결된 공고번호가 없으면 공고번호를 입력해 조회하세요.
          </p>
        ) : noticeDocs.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-zinc-400">공고 첨부문서가 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {noticeDocs.map((d) => (
              <li key={d.url} className="flex items-center gap-2 text-[11px]">
                <span
                  className={
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                    (isPdfName(d.name)
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
                      : "bg-zinc-200 text-zinc-600 dark:bg-white/10 dark:text-zinc-300")
                  }
                >
                  {isPdfName(d.name) ? "PDF" : isHwpName(d.name) ? "한글" : "기타"}
                </span>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200"
                  title={d.name}
                >
                  {d.name}
                </a>
                {!isPdfName(d.name) ? (
                  <span className="shrink-0 text-zinc-400">→ PDF 변환 후 아래에 업로드</span>
                ) : (
                  <span className="shrink-0 text-zinc-400">→ 내려받아 아래에 업로드</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {noticeNote ? <p className="mt-1.5 text-[11px] text-zinc-400">{noticeNote}</p> : null}
      </div>

      {tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t.tag}
              title={t.evidence}
              className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-700 dark:bg-white/10 dark:text-zinc-200"
            >
              {t.tag}
            </span>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className={
          "mt-3 flex w-full flex-1 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors " +
          (dragging
            ? "border-blue-500 bg-blue-50/70 dark:border-blue-400 dark:bg-blue-500/10"
            : "border-zinc-300 hover:border-blue-400 hover:bg-zinc-50/60 dark:border-white/15 dark:hover:bg-white/5")
        }
      >
        <svg
          className={"h-6 w-6 " + (dragging ? "text-blue-500" : "text-zinc-400")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span
          className={
            "text-xs font-medium " +
            (dragging ? "text-blue-600 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-300")
          }
        >
          {busy
            ? "PDF 분석·태깅 중…"
            : dragging
              ? "여기에 놓으면 업로드·태깅이 시작됩니다"
              : "PDF를 여기에 끌어다 놓거나 클릭해 선택하세요"}
        </span>
      </button>

      <p className="mt-2 text-[11px] text-zinc-400">
        PDF 업로드 전용 — 한글(hwp·hwpx) 문서는 한컴오피스에서 PDF로 저장 후 업로드해 주세요. (10MB
        이하)
      </p>
      {notice ? (
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{notice}</p>
      ) : null}
    </section>
  );
}
