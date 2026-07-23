// 현장 환경 × 위험작업 배제 규칙(결정적) — GasPod 가스 상태·기상특보를 태그 배제/안내로 매핑.
// 배제는 '권고'다(최종 배치 결정 권한은 감독관). 조문 번호는 확실한 것만 적는다.
//  - 가스: 규칙 제618조가 산소농도 18% 미만을 '산소결핍'으로 법정 정의 — 감지기 경고/위험 시 밀폐공간 배제.
//  - 특보: 경보(danger)는 배제 권고, 주의보(caution)는 안내만(제37조 중지 기준은 특보 자체가 아니라 보수적으로).
import type { RiskTagName } from "./assignment-rules";

export type SiteEnvSignals = {
  // GasPod 최신 텔레메트리 요약(null = 미수신/조회 불가). stale = 최신 수신이 오래됨(측정 필요 안내).
  gaspod: {
    deviceId: string;
    state: "CLEAR" | "WARNING" | "DANGER";
    o2: number;
    receivedAt: string;
    stale: boolean;
  } | null;
  // 현장 시·도에 발효 중인 기상특보(경보/주의보).
  warnings: { type: string; level: "경보" | "주의보" }[];
  sido: string | null;
};

export type EnvBlock = { tag: RiskTagName; label: string; basis: string };
export type EnvAdvice = { blocks: EnvBlock[]; notes: string[] };

const GAS_BASIS =
  "산업안전보건기준에 관한 규칙 제618조(산소결핍: 산소농도 18% 미만)·제619조(밀폐공간 작업 프로그램)";
const WIND_BASIS =
  "산업안전보건기준에 관한 규칙 제37조(악천후 및 강풍 시 작업 중지)·제383조(강풍 시 철골작업 중지)";
const RAIN_BASIS = "산업안전보건기준에 관한 규칙 제37조(악천후 및 강풍 시 작업 중지)";

// 특보 종류 키워드 → 배제 대상 태그(경보 발효 시).
const WARNING_BLOCKS: { match: RegExp; tags: RiskTagName[]; basis: string }[] = [
  { match: /강풍|태풍/, tags: ["고소작업", "중장비/양중", "해체/철거"], basis: WIND_BASIS },
  { match: /호우/, tags: ["고소작업", "굴착/흙막이", "전기/감전"], basis: RAIN_BASIS },
  { match: /대설/, tags: ["고소작업", "굴착/흙막이"], basis: RAIN_BASIS },
];

/** 환경 신호 → 태그 배제(blocks) + 안내(notes). */
export function matchEnvironment(signals: SiteEnvSignals): EnvAdvice {
  const blocks: EnvBlock[] = [];
  const notes: string[] = [];

  const g = signals.gaspod;
  if (g && !g.stale && (g.state === "WARNING" || g.state === "DANGER")) {
    blocks.push({
      tag: "밀폐공간",
      label: `가스 감지기 ${g.state === "DANGER" ? "위험" : "경고"} 발효(${g.deviceId} · O₂ ${g.o2}%)`,
      basis: GAS_BASIS,
    });
  } else if (g) {
    // 페일세이프: 감지기가 있으나 WARNING/DANGER 가 아닌 경우(정상 CLEAR·수신 지연)에도 밀폐공간은
    //   법정 사전 측정을 요구한다. 실시간 센서값(조작 가능)이 사전 측정을 대체하지 못하게 하여,
    //   위조된 CLEAR 텔레메트리로 밀폐공간 게이트를 해제할 수 없도록 한다(규칙 제619조의2).
    const detail = g.stale ? "수신 지연" : "정상 표시는 사전 측정을 대체하지 않음";
    notes.push(
      `밀폐공간 투입 전 산소·유해가스 농도 측정 필요(규칙 제619조의2) — 감지기(${g.deviceId}) ${detail}.`,
    );
  }

  for (const w of signals.warnings) {
    const rule = WARNING_BLOCKS.find((r) => r.match.test(w.type));
    if (rule && w.level === "경보") {
      for (const tag of rule.tags) {
        if (!blocks.some((b) => b.tag === tag)) {
          blocks.push({ tag, label: `${w.type} 발효(${signals.sido ?? "현장"})`, basis: rule.basis });
        }
      }
    } else if (rule) {
      notes.push(`${w.type} 발효 — ${rule.tags.join("·")} 배치 시 감독관 확인 필요(${rule.basis}).`);
    } else if (/폭염/.test(w.type)) {
      notes.push(
        `${w.type} 발효 — 체감온도 33℃ 이상 작업 시 2시간마다 20분 이상 휴식 의무(산업안전보건기준에 관한 규칙 온열질환 예방 규정 · 2025.7.17. 시행).`,
      );
    } else if (/한파/.test(w.type)) {
      notes.push(`${w.type} 발효 — 옥외작업 보온·휴식 조치 권고.`);
    }
  }

  return { blocks, notes };
}
