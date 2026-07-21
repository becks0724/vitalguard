// 배치 권고 서비스 — DB 신호 집계 → 컨디션 등급(결정적) → 태그 매칭(결정적) → 환경 게이트(결정적).
// LLM 은 이 결과를 '언어화'만 한다(판정 관여 금지). 원시 생체는 이 모듈 밖으로 나가지 않는다.
import "server-only";
import { THRESHOLDS } from "@safetymonitor/analyzers";

import { getLatestSiteTaskDoc, getWorkerAliasMap, workerConditionSignals } from "./db";
import { WORK_HR } from "./severity";
import {
  gradeCondition,
  GRADE_LABEL,
  type ConditionResult,
  type ConditionSignals,
} from "./worker-condition";
import {
  ALL_RISK_TAGS,
  matchAssignments,
  type AssignmentAdvice,
  type RiskTagName,
} from "./assignment-rules";
import { readSiteEnvironment } from "./site-environment";
import { matchEnvironment, type SiteEnvSignals } from "./site-env-rules";

export type SiteEnvironmentSummary = {
  sido: string | null;
  warningSummary: string; // "강풍경보 · 폭염주의보" | "특보 없음"
  gaspodSummary: string; // "gaspod-01 DANGER (O₂ 17.9%)" | "감지기 미연결" 등
  notes: string[]; // 배제까지는 아닌 환경 안내(주의보·휴식 의무 등)
};

export type WorkerAssignment = {
  workerId: string;
  mergedIds: string[]; // 별칭 병합으로 함께 집계된 ID
  condition: ConditionResult;
  advice: AssignmentAdvice;
  environment: SiteEnvironmentSummary;
  // 현장 과업지시서 태깅이 있으면 매칭 범위가 그 태그로 축소됨(없으면 전체 어휘 폴백).
  taskDoc: { tags: RiskTagName[]; updatedAt: string } | null;
  signals: Pick<ConditionSignals, "sampleCount" | "latestTs">; // 요약만 노출(원시 생체 비노출)
};

const LOOKBACK_MS = 24 * 3_600_000;

/** 별칭 병합: 입력 ID 가 secondary 면 primary 로 승격 + primary 의 모든 secondary 동반 집계. */
async function resolveMergedIds(workerId: string): Promise<{ primary: string; ids: string[] }> {
  const aliasMap = await getWorkerAliasMap(); // { secondary: primary }
  const primary = aliasMap[workerId] ?? workerId;
  const ids = new Set<string>([primary]);
  for (const [secondary, prim] of Object.entries(aliasMap)) {
    if (prim === primary) ids.add(secondary);
  }
  return { primary, ids: [...ids] };
}

/** 저장된 과업지시서 태그 → 매칭 범위(어휘 밖 값 방어). 없거나 비면 null(전체 폴백). */
async function activeTaskTags(): Promise<{ tags: RiskTagName[]; updatedAt: string } | null> {
  try {
    const doc = await getLatestSiteTaskDoc();
    if (!doc) return null;
    const parsed: unknown = JSON.parse(doc.tags_json);
    if (!Array.isArray(parsed)) return null;
    const names = parsed
      .map((t) => (t && typeof t === "object" ? (t as { tag?: unknown }).tag : undefined))
      .filter((tag): tag is RiskTagName => (ALL_RISK_TAGS as readonly string[]).includes(tag as string));
    const unique = [...new Set(names)];
    return unique.length > 0 ? { tags: unique, updatedAt: doc.updated_at } : null;
  } catch {
    return null; // 과업 문서 조회/파싱 실패 — 전체 어휘 폴백(챗 무중단)
  }
}

function summarizeEnvironment(env: SiteEnvSignals, notes: string[]): SiteEnvironmentSummary {
  const g = env.gaspod;
  const gaspodSummary = !g
    ? "감지기 미연결"
    : g.stale
      ? `${g.deviceId} 수신 없음(최근 ${g.receivedAt})`
      : `${g.deviceId} ${g.state} (O₂ ${g.o2}%)`;
  const warningSummary =
    env.warnings.length > 0 ? env.warnings.map((w) => w.type).join(" · ") : "특보 없음";
  return { sido: env.sido, warningSummary, gaspodSummary, notes };
}

/** 작업자 1명 배치 권고 산출(등급+태그별 권고+환경 게이트). */
export async function assessWorker(workerId: string): Promise<WorkerAssignment> {
  const { primary, ids } = await resolveMergedIds(workerId.trim());
  const sinceIso = new Date(Date.now() - LOOKBACK_MS).toISOString();

  const [signals, envSignals, taskDoc] = await Promise.all([
    workerConditionSignals({
      workerIds: ids,
      sinceIso,
      spo2CautionPct: THRESHOLDS.spo2.cautionPct,
      spo2DangerPct: THRESHOLDS.spo2.dangerPct,
      hrHeavyBpm: WORK_HR.heavyBpm,
      hrOverloadBpm: WORK_HR.overloadBpm,
      hrCollapseBpm: WORK_HR.collapseBpm,
    }),
    readSiteEnvironment(),
    activeTaskTags(),
  ]);

  const condition = gradeCondition(signals);
  const advice = matchAssignments(condition, taskDoc?.tags ?? ALL_RISK_TAGS);

  // 환경 게이트 — 작업자 컨디션과 무관하게 현장 환경(가스·특보)이 막는 태그는 확정적 배제 권고.
  const envAdvice = matchEnvironment(envSignals);
  for (const b of envAdvice.blocks) {
    const t = advice.perTag.find((x) => x.tag === b.tag);
    if (t) {
      t.allowed = false;
      t.pending = false;
      t.blockedBy.push({ code: "SITE_ENV", label: `${b.label} · ${b.basis}` });
    }
  }

  return {
    workerId: primary,
    mergedIds: ids,
    condition,
    advice,
    environment: summarizeEnvironment(envSignals, envAdvice.notes),
    taskDoc,
    signals: { sampleCount: signals.sampleCount, latestTs: signals.latestTs },
  };
}

/** 챗/폴백 공용 — 판정 결과의 결정적 텍스트 요약(LLM 없이도 완결). */
export function formatAssignment(a: WorkerAssignment): string {
  const lines: string[] = [];
  lines.push(
    `작업자 ${a.workerId} — 컨디션 등급: ${GRADE_LABEL[a.condition.grade]}` +
      (a.signals.sampleCount > 0 ? ` (최근 24시간 실측 ${a.signals.sampleCount}건)` : ""),
  );
  for (const r of a.condition.reasons) lines.push(`- 사유: ${r.label} · ${r.detail}`);
  lines.push(a.advice.note);
  lines.push(
    `현장 환경 — 기상특보: ${a.environment.warningSummary} / 가스 감지기: ${a.environment.gaspodSummary}`,
  );
  for (const n of a.environment.notes) lines.push(`- 환경 안내: ${n}`);
  if (a.taskDoc) lines.push(`- 과업지시서 기준 검토 작업: ${a.taskDoc.tags.join(", ")}`);
  const blocked = a.advice.perTag.filter((t) => !t.allowed && !t.pending);
  const allowed = a.advice.perTag.filter((t) => t.allowed);
  if (blocked.length > 0) {
    for (const t of blocked) {
      const by = t.blockedBy.map((b) => b.label).join(", ") || "등급 제한";
      lines.push(`- 배제 권고: ${t.tag} (사유: ${by} · 근거: ${t.basis})`);
    }
  }
  if (allowed.length > 0) lines.push(`- 배치 가능(권고): ${allowed.map((t) => t.tag).join(", ")}`);
  return lines.join("\n");
}
