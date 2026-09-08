// 사고 조사 패널 — 사고 등록(3년 보존 마킹)·시각 앵커 통합 조회(생체 4종+이벤트)·보고용 CSV 내보내기
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { WorkerSummary } from "../../lib/db";
import {
  INCIDENT_WINDOW_HOURS,
  buildIncidentCsv,
  type IncidentEvent,
  type IncidentReportData,
  type IncidentSeriesPoint,
  type IncidentWindowHours,
} from "../../lib/incident-report";

type IncidentRow = {
  id: number;
  worker_id: string;
  occurred_at: string;
  note: string | null;
  created_at: string;
};

type IncidentData = {
  ok: boolean;
  workerId: string;
  at: string;
  hours: number;
  windowFromMs: number;
  windowToMs: number;
  heartRate: IncidentSeriesPoint[];
  coreTempEst: IncidentSeriesPoint[];
  spo2: IncidentSeriesPoint[];
  activeEnergyKcal: IncidentSeriesPoint[];
  events: IncidentEvent[];
};

const EVENT_LABEL: Record<string, string> = {
  sos: "SOS",
  fall: "낙상",
  vital: "생체 이상",
  geofence: "구역 이탈",
};

// KST 시:분 — 조사 창이 하루 안팎이라 시각 축은 시:분이 읽기 단위.
function kstHm(ms: number): string {
  return new Date(ms + 9 * 3_600_000).toISOString().slice(11, 16);
}

function kstFull(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}

// datetime-local 입력값(로컬 KST 가정) ↔ ISO — 등록 폼용.
function localInputToIso(v: string): string | null {
  const ms = Date.parse(`${v}:00+09:00`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// 선 그래프의 갭 표시 — 버킷 간격의 2.5배를 넘는 공백에는 null 을 끼워 선을 끊는다
// (미수신 구간이 이어진 척 그려지면 사고 전후 공백을 오독한다).
function withGaps(
  points: IncidentSeriesPoint[],
  maxGapMs: number,
): { tsMs: number; value: number | null }[] {
  const out: { tsMs: number; value: number | null }[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (prev && p.tsMs - prev.tsMs > maxGapMs) {
      out.push({ tsMs: prev.tsMs + 1, value: null });
    }
    out.push(p);
  }
  return out;
}

function sixTicks(fromMs: number, toMs: number): number[] {
  const step = (toMs - fromMs) / 6;
  return Array.from({ length: 7 }, (_, i) => Math.round(fromMs + step * i));
}

export function IncidentReviewPanel({
  token,
  onAuthFail,
  workers,
}: {
  token: string;
  onAuthFail: () => void;
  workers: WorkerSummary[] | null;
}) {
  const [incidents, setIncidents] = useState<IncidentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 등록 폼
  const [formWorker, setFormWorker] = useState("");
  const [formAt, setFormAt] = useState(""); // datetime-local
  const [formNote, setFormNote] = useState("");

  // 조회 상태
  const [hours, setHours] = useState<IncidentWindowHours>(24);
  const [selected, setSelected] = useState<{ workerId: string; at: string; note?: string | null } | null>(null);
  const [data, setData] = useState<IncidentData | null>(null);
  const [dataBusy, setDataBusy] = useState(false);

  const authHeaders = useMemo(
    () => ({ authorization: `Basic ${token}` }),
    [token],
  );

  const loadIncidents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/incidents", { headers: authHeaders, cache: "no-store" });
      if (res.status === 401) return onAuthFail();
      const json = await res.json();
      if (json.ok) setIncidents(json.incidents as IncidentRow[]);
      else setError("사고 목록을 불러오지 못했습니다.");
    } catch {
      setError("사고 목록을 불러오지 못했습니다.");
    }
  }, [authHeaders, onAuthFail]);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  const loadData = useCallback(
    async (workerId: string, atIso: string, h: IncidentWindowHours, note?: string | null) => {
      setDataBusy(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ workerId, at: atIso, hours: String(h) });
        const res = await fetch(`/api/admin/incidents/data?${qs}`, {
          headers: authHeaders,
          cache: "no-store",
        });
        if (res.status === 401) return onAuthFail();
        const json = await res.json();
        if (!json.ok) {
          setError(typeof json.error === "string" ? json.error : "조회 실패");
          setData(null);
          return;
        }
        setSelected({ workerId, at: atIso, note });
        setData(json as IncidentData);
      } catch {
        setError("조사 데이터를 불러오지 못했습니다.");
        setData(null);
      } finally {
        setDataBusy(false);
      }
    },
    [authHeaders, onAuthFail],
  );

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const atIso = localInputToIso(formAt);
    if (!formWorker || !atIso) {
      setError("작업자와 발생 시각을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/incidents", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ workerId: formWorker, occurredAt: atIso, note: formNote }),
      });
      if (res.status === 401) return onAuthFail();
      const json = await res.json();
      if (!json.ok) {
        setError(typeof json.error === "string" ? json.error : "등록 실패");
        return;
      }
      setFormNote("");
      await loadIncidents();
      await loadData(formWorker, atIso, hours, formNote || null);
    } catch {
      setError("등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function handleCsv() {
    if (!data || !selected) return;
    const report: IncidentReportData = {
      workerId: data.workerId,
      workerName: workers?.find((w) => w.worker_id === data.workerId)?.worker_name ?? null,
      occurredAt: data.at,
      windowFromMs: data.windowFromMs,
      windowToMs: data.windowToMs,
      heartRate: data.heartRate,
      coreTempEst: data.coreTempEst,
      spo2: data.spo2,
      activeEnergyKcal: data.activeEnergyKcal,
      events: data.events,
    };
    // BOM — 엑셀이 UTF-8 한글을 깨뜨리지 않게. 비가시 문자는 리터럴 금지(lint 규칙) — 이스케이프로.
    const csv = "\uFEFF" + buildIncidentCsv(report, new Date().toISOString());
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `사고조사_${data.workerId}_${data.at.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const atMs = data ? Date.parse(data.at) : 0;
  const ticks = data ? sixTicks(data.windowFromMs, data.windowToMs) : [];
  const hrGap = (data && data.hours <= 12 ? 60_000 : 300_000) * 2.5;

  const inputCls =
    "rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-sm text-body outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-canvas/5 dark:text-zinc-100";

  return (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-xs leading-relaxed text-muted dark:text-muted-soft">
        사고를 등록하면 해당 구간이 <b>3년 보존 대상</b>으로 마킹되고, 발생 시각 전후의 생체
        데이터(심박·산소포화도·활동 에너지·심부체온 추정)와 SOS·낙상 이벤트를 한 화면에서
        재구성합니다. 심부체온 추정은 조회 시점에 원시 심박으로 재계산한 값입니다(의료 판정 아님).
      </p>

      {/* 등록 폼 */}
      <form onSubmit={handleRegister} className="flex flex-wrap items-end gap-3 rounded-md border border-hairline p-3 dark:border-white/10">
        <label className="flex flex-col gap-1 text-xs text-muted dark:text-muted-soft">
          작업자
          <select
            value={formWorker}
            onChange={(e) => setFormWorker(e.target.value)}
            className={inputCls}
          >
            <option value="">선택</option>
            {(workers ?? []).map((w) => (
              <option key={w.worker_id} value={w.worker_id}>
                {w.worker_name ? `${w.worker_name} (${w.worker_id})` : w.worker_id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted dark:text-muted-soft">
          발생 시각 (KST)
          <input
            type="datetime-local"
            value={formAt}
            onChange={(e) => setFormAt(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-muted dark:text-muted-soft">
          메모 (사고 개요·최대 500자)
          <input
            type="text"
            value={formNote}
            maxLength={500}
            onChange={(e) => setFormNote(e.target.value)}
            className={inputCls}
            placeholder="예) 3층 비계 이동 중 낙상"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "등록 중…" : "사고 등록"}
        </button>
      </form>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-4">
        {/* 사고 목록 */}
        <div className="min-w-[18rem] flex-1">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-body dark:text-zinc-200">등록된 사고</h3>
            <label className="flex items-center gap-1 text-[11px] text-muted dark:text-muted-soft">
              조회 창
              <select
                value={hours}
                onChange={(e) => {
                  const h = Number(e.target.value) as IncidentWindowHours;
                  setHours(h);
                  if (selected) void loadData(selected.workerId, selected.at, h, selected.note);
                }}
                className="rounded border border-hairline bg-canvas px-1 py-0.5 text-[11px] dark:border-white/10 dark:bg-canvas/5"
              >
                {INCIDENT_WINDOW_HOURS.map((h) => (
                  <option key={h} value={h}>
                    전후 {h}시간
                  </option>
                ))}
              </select>
            </label>
          </div>
          {incidents === null ? (
            <p className="text-xs text-muted">불러오는 중…</p>
          ) : incidents.length === 0 ? (
            <p className="text-xs text-muted">등록된 사고가 없습니다.</p>
          ) : (
            <ul className="max-h-56 overflow-auto rounded-md border border-hairline text-xs dark:border-white/10">
              {incidents.map((it) => {
                const active = selected?.workerId === it.worker_id && selected?.at === it.occurred_at;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => void loadData(it.worker_id, it.occurred_at, hours, it.note)}
                      className={`flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-canvas/10 ${
                        active ? "bg-zinc-100 dark:bg-canvas/10" : ""
                      }`}
                    >
                      <span className="font-mono">{kstFull(Date.parse(it.occurred_at))}</span>
                      <span className="truncate">{it.worker_id}</span>
                      <span className="min-w-0 flex-1 truncate text-muted dark:text-muted-soft">
                        {it.note ?? ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* 조사 패널 */}
      {dataBusy && <p className="text-xs text-muted">조사 데이터 불러오는 중…</p>}
      {data && !dataBusy && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-body dark:text-zinc-200">
              <b>{data.workerId}</b> · 사고 {kstFull(atMs)} · 창 {kstFull(data.windowFromMs)} ~{" "}
              {kstFull(data.windowToMs)}
              {selected?.note ? <span className="text-muted"> · {selected.note}</span> : null}
            </p>
            <button
              type="button"
              onClick={handleCsv}
              className="rounded-md border border-hairline px-3 py-1.5 text-xs font-semibold text-body transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-canvas/10"
            >
              CSV 내보내기
            </button>
          </div>

          {(
            [
              {
                key: "heartRate",
                title: `심박 (bpm · ${data.hours <= 12 ? "1분" : "5분"} 평균)`,
                kind: "line",
                color: "#ef4444",
                points: withGaps(data.heartRate, hrGap),
              },
              {
                key: "coreTempEst",
                title: "심부체온 추정 (℃ · 재계산·의료 판정 아님)",
                kind: "line",
                color: "#f97316",
                points: withGaps(data.coreTempEst, 5 * 60_000 * 2.5),
              },
              {
                key: "spo2",
                title: "산소포화도 (% · 측정 시각 점)",
                kind: "dot",
                color: "#06b6d4",
                points: data.spo2,
              },
              {
                key: "activeEnergyKcal",
                title: "활동 에너지 (kcal · 5분 합)",
                kind: "bar",
                color: "#10b981",
                points: data.activeEnergyKcal,
              },
            ] as const
          ).map((c) => (
            <div key={c.key} className="rounded-md border border-hairline p-2 dark:border-white/10">
              <p className="mb-1 text-[11px] font-semibold text-muted dark:text-muted-soft">{c.title}</p>
              {c.points.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-muted">창 안에 데이터 없음</p>
              ) : (
                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={[...c.points]} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid strokeDasharray="2 4" strokeOpacity={0.25} vertical={false} />
                      <XAxis
                        dataKey="tsMs"
                        type="number"
                        domain={[data.windowFromMs, data.windowToMs]}
                        ticks={ticks}
                        tickFormatter={kstHm}
                        tick={{ fontSize: 10 }}
                        stroke="currentColor"
                        strokeOpacity={0.3}
                      />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={44} stroke="currentColor" strokeOpacity={0.3} />
                      <Tooltip
                        labelFormatter={(v) => kstFull(Number(v))}
                        formatter={(value) => [String(value ?? "—"), ""]}
                      />
                      <ReferenceLine x={atMs} stroke="#dc2626" strokeDasharray="4 3" label={{ value: "사고", fontSize: 10, fill: "#dc2626", position: "top" }} />
                      {c.kind === "line" && (
                        <Line dataKey="value" stroke={c.color} dot={false} strokeWidth={1.5} connectNulls={false} isAnimationActive={false} />
                      )}
                      {c.kind === "dot" && (
                        <Scatter dataKey="value" fill={c.color} isAnimationActive={false} />
                      )}
                      {c.kind === "bar" && (
                        <Bar dataKey="value" fill={c.color} isAnimationActive={false} barSize={3} />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ))}

          {/* 이벤트 타임라인 */}
          <div className="rounded-md border border-hairline p-2 dark:border-white/10">
            <p className="mb-1 text-[11px] font-semibold text-muted dark:text-muted-soft">
              이벤트 (SOS·낙상 등 알림 이력 · 대응 시각 포함)
            </p>
            {data.events.length === 0 ? (
              <p className="py-2 text-center text-[11px] text-muted">창 안에 이벤트 없음</p>
            ) : (
              <ul className="text-xs">
                {data.events.map((e, i) => (
                  <li key={i} className="flex items-baseline gap-2 border-b border-hairline/50 py-1 last:border-0 dark:border-white/5">
                    <span className="font-mono">{kstFull(Date.parse(e.ts))}</span>
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      {EVENT_LABEL[e.type] ?? e.type}
                    </span>
                    <span className="text-muted dark:text-muted-soft">
                      {e.ackAt ? `대응 ${kstFull(Date.parse(e.ackAt))}${e.ackBy ? ` · ${e.ackBy}` : ""}` : "미대응"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
