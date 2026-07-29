// 5칸 슬롯 빈자리 클릭 시 노출 — 등록 대기 작업자 목록 + 슬롯 할당 액션
"use client";

import type { VitalSample } from "@safetymonitor/schemas";

type Props = {
  slotIndex: number;
  pendingWorkers: VitalSample[];
  onAssign: (workerId: string) => void;
  onCancel: () => void;
};

function formatTime(ts?: string) {
  if (!ts) return "--:--:--";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

function workerLabel(sample: VitalSample): { title: string; subtitle: string } {
  const name = sample.workerName?.trim();
  const empId = sample.employeeId?.trim();
  if (name && empId) return { title: name, subtitle: `사원번호 ${empId}` };
  if (empId) return { title: empId, subtitle: `workerId ${sample.workerId}` };
  if (name) return { title: name, subtitle: `workerId ${sample.workerId}` };
  return { title: sample.workerId, subtitle: "사원번호 미설정" };
}

export function WorkerQueueModal({
  slotIndex,
  pendingWorkers,
  onAssign,
  onCancel,
}: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-md border border-hairline-strong bg-canvas p-5 dark:border-white/10 dark:bg-surface-dark"
      >
        <header className="mb-3 flex items-center justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-white/10">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              슬롯 {slotIndex + 1}번에 작업자 등록
            </h2>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              현재 publish 중인 작업자 중 미등록 인원을 선택하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5"
          >
            취소
          </button>
        </header>

        {pendingWorkers.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            등록 대기 중인 작업자가 없습니다.
            <br />
            <span className="text-xs text-zinc-400 dark:text-zinc-600">
              작업자 폰에서 vital publish 가 시작되면 여기에 자동으로 표시됩니다.
            </span>
          </p>
        ) : (
          <ul className="wx-cards-scroll flex max-h-[60vh] flex-col gap-2 overflow-auto">
            {pendingWorkers.map((sample) => {
              const { title, subtitle } = workerLabel(sample);
              return (
                <li key={sample.workerId}>
                  <button
                    type="button"
                    onClick={() => onAssign(sample.workerId)}
                    className="flex w-full items-center justify-between gap-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-left hover:border-cyan-500 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-cyan-400/60 dark:hover:bg-cyan-400/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {title}
                      </div>
                      <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">{subtitle}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        마지막 수신 {formatTime(sample.ts)}
                        {sample.heartRate !== undefined && (
                          <>
                            {" · "}
                            <span className="font-mono">HR {Math.round(sample.heartRate)}</span>
                          </>
                        )}
                        {sample.spo2 !== undefined && (
                          <>
                            {" · "}
                            <span className="font-mono">SpO₂ {Math.round(sample.spo2)}%</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 rounded border border-cyan-500 bg-cyan-100 px-2 py-1 text-xs text-cyan-700 dark:border-cyan-400/40 dark:bg-cyan-400/10 dark:text-cyan-200">
                      등록
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
