// 작업자 폰 GPS 좌표 평균 위치의 현장 환경 패널 — 가로 11 항목 그리드 (Open-Meteo)
// 각 항목 클릭 시 정책 임계 단계 + 권고 조치 모달 표시. 정책 항목은 주의/위험 색상 자동 적용.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMarqueeScroll } from "../hooks/useMarqueeScroll";
import {
  computeDiscomfortIndex,
  discomfortGrade,
  evaluateApparentTemp,
  evaluateDiscomfortIndex,
  evaluatePM25,
  evaluatePrecipitation,
  evaluateUV,
  evaluateWindKmh,
  infoEvaluation,
  type RuleEvaluation,
  type RuleSeverity,
  type ThresholdStep,
} from "../../lib/weather-rules";
import { getSessionToken } from "./LoginGate";
import { WeatherAlertToast } from "./WeatherAlertToast";
import { WeatherIcon, weatherIconKey } from "./WeatherIcons";
import {
  WeatherRuleModal,
  type ForecastDay,
  type ForecastExtra,
  type ForecastHour,
} from "./WeatherRuleModal";

type WeatherCurrent = {
  weatherCode: number;
  temperatureC: number;
  apparentTempC: number;
  humidityPct: number;
  windKmh: number;
  precipitationMm: number;
  uvIndex: number;
  pm10?: number;
  pm25?: number;
};

type WeatherDaily = {
  sunrise?: string;
  sunset?: string;
};

type WeatherDaily7 = {
  time: string[];
  weatherCode: number[];
  tMax: number[];
  tMin: number[];
  precipProbMax: (number | null)[];
};

type WeatherHourly = {
  time: string[];
  temperatureC: number[];
};

type WeatherResponse = {
  ok: boolean;
  cached?: boolean;
  source?: string;
  lat?: number;
  lon?: number;
  current?: WeatherCurrent;
  daily?: WeatherDaily;
  daily7?: WeatherDaily7;
  hourly?: WeatherHourly;
  fetchedAt?: string;
};

type KmaWarningResponse = {
  ok: boolean;
  source: "live" | "mock";
  sido: string;
  warnings: { type: string; level: "경보" | "주의보"; regions: string[] }[];
  severity: "normal" | "caution" | "danger";
  summary: string;
  preliminary: { type: string; when: string; regions: string[] }[];
  preliminarySeverity: "normal" | "caution";
  preliminarySummary: string;
};

type Props = {
  lat?: number;
  lon?: number;
  workerCount: number;
  // 현장 좌표 출처 — live: 작업자 실시간 GPS / cached: 연결 끊겨 캐시 좌표 / none: 좌표 없음. 우측 신호등 색.
  coordSource?: "live" | "cached" | "none";
  onRefresh?: () => void; // 수동 새로고침(좌표 재캡처 + 기상 재요청)
  refreshing?: boolean; // 새로고침 진행 중(아이콘 회전)
  refreshNonce?: number; // 증가 시 기상 재요청 트리거
};

// 현장 환경 경보 확인/조치 → 억제 상태(항목→확인 시 심각도) localStorage 키. 리마운트·임계 흔들림에도 유지.
const ENV_ACK_KEY = "safetymonitor.envAck.v1";
const SEV_RANK: Record<RuleSeverity, number> = { normal: 0, caution: 1, danger: 2 };

// 기상특보 종류별 현장 대응 안내(확인/조치 팝업 currentStep.action). type 에 종류명이 포함되면 매칭.
const KMA_WARN_ACTION: { match: string; action: string }[] = [
  { match: "강풍", action: "비계·거푸집·크레인 등 고소·양중 작업 중지 검토. 자재 결박·낙하물 방지." },
  { match: "태풍", action: "고소·양중·해안 작업 전면 중지 검토. 가설물 결박·대피 계획 점검." },
  { match: "호우", action: "굴착·사면·지하 작업 침수·붕괴 주의. 배수·전기설비 감전 예방." },
  { match: "대설", action: "지붕·고소 작업 중지. 제설·미끄럼 방지, 구조물 적설 하중 점검." },
  { match: "폭염", action: "옥외 중작업 시간 조정·휴식 강화. 그늘·물·염분 비치(체감온도 항목 연동)." },
  { match: "한파", action: "옥외 작업 시간 단축·온열 보호. 동결·미끄럼 주의." },
  { match: "황사", action: "미세먼지 마스크 착용. 옥외 정밀·호흡 부담 작업 자제(미세먼지 항목 연동)." },
  { match: "건조", action: "화기·용접 작업 주의. 소화기 비치·불티 비산 방지." },
  { match: "풍랑", action: "해상·해안 인접 작업 중지 검토." },
];
function kmaWarnAction(type: string): string {
  const hit = KMA_WARN_ACTION.find((k) => type.includes(k.match));
  return hit ? hit.action : "기상청 특보 대응 지침에 따라 해당 작업 안전조치·중지를 검토하세요.";
}

// 기상청 발효 특보(경보/주의보) → 확인/조치 팝업용 RuleEvaluation 목록.
// 경보=위험(danger)·주의보=주의(caution). itemKey=`kma:<종류>` 로 정책 경보와 같은 억제·DB 기록 파이프라인 재사용.
function kmaToEvaluations(kma: KmaWarningResponse | null): RuleEvaluation[] {
  if (!kma || kma.warnings.length === 0) return [];
  return kma.warnings.map((w) => {
    const severity: RuleSeverity = w.level === "경보" ? "danger" : "caution";
    const regionText = w.regions.length > 0 ? w.regions.join(", ") : kma.sido;
    const step: ThresholdStep = {
      severity,
      binding: "legal",
      label: `${w.type} 발효 — ${regionText}`,
      action: kmaWarnAction(w.type),
      source: "기상청 기상특보 (WthrWrnInfoService)",
    };
    return {
      itemKey: `kma:${w.type}`,
      itemLabel: `기상특보 · ${w.type}`,
      currentValue: w.level,
      currentSeverity: severity,
      currentStep: step,
      steps: [step],
      baseline: `${kma.sido} 발효 특보`,
      notes: `현장 시·도(${kma.sido})에 발효 중인 기상청 ${w.type}. 확인/조치 시 악화 전까지 재알림이 억제됩니다.`,
    };
  });
}

export function WeatherStrip({
  lat,
  lon,
  workerCount,
  coordSource = "none",
  onRefresh,
  refreshing,
  refreshNonce,
}: Props) {
  // 호버 시 정지가 아니라 22% 속도로 감속(InfiniteSlider 방식) — 끊김 없이 흐르며 읽을 수 있게.
  const scrollRef = useMarqueeScroll<HTMLDivElement>(0.5, "x", 0.22);
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RuleEvaluation | null>(null);
  // 기상특보(기상청 1360000) — 현장 GPS 시·도 발효 특보
  const [kma, setKma] = useState<KmaWarningResponse | null>(null);

  useEffect(() => {
    if (lat === undefined || lon === undefined) {
      setData(null);
      return;
    }

    let active = true;

    async function load() {
      try {
        const res = await fetch(
          `/api/weather?lat=${lat}&lon=${lon}&workers=${workerCount}`,
          { cache: "no-store" },
        );
        if (!active) return;
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as WeatherResponse;
        if (!active) return;
        if (!json.ok) {
          setError("weather unavailable");
          return;
        }
        setError(null);
        setData(json);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    }

    load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // workerCount 도 URL(workers=)에 포함되므로 deps 에 포함 — 작업자 수 변경 시 재요청해 weather_log 정확성 유지.
    // refreshNonce — 수동 새로고침 시 증가해 기상 재요청.
  }, [lat, lon, workerCount, refreshNonce]);

  // 기상특보 — 현장 GPS 시·도 발효 특보. 10분 주기 갱신.
  useEffect(() => {
    if (lat === undefined || lon === undefined) {
      setKma(null);
      return;
    }
    let active = true;
    async function loadKma() {
      try {
        const res = await fetch(`/api/kma-warning?lat=${lat}&lon=${lon}`, { cache: "no-store" });
        if (!active || !res.ok) return;
        const json = (await res.json()) as KmaWarningResponse;
        if (active && json.ok) setKma(json);
      } catch {
        /* 특보 실패는 무시(다른 현장환경 항목엔 영향 없음) */
      }
    }
    loadKma();
    const timer = window.setInterval(loadKma, 10 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [lat, lon, refreshNonce]);

  // 항목별 정책 평가 — current 데이터가 있을 때만
  const evaluations = useMemo(() => {
    if (!data?.current) return null;
    const c = data.current;
    const d = data.daily ?? {};

    return {
      weather: infoEvaluation(
        "weather",
        "날씨",
        weatherLabel(c.weatherCode),
        "WMO 기상 코드 기반 표시. 강수 발생 시 강수량 항목 참조.",
        "직접 임계 없음. 작업중지 판정은 강수량/풍속/체감온도 항목 기준.",
      ),
      temperature: infoEvaluation(
        "temperature",
        "기온",
        `${c.temperatureC.toFixed(1)}℃`,
        "법적 작업중지 임계는 체감온도 기준. 기온은 참고 표시.",
        "체감온도 = 기온 + 습도/풍속 보정. 실제 위험 판정은 '체감온도' 항목 참조.",
      ),
      apparentTemp: evaluateApparentTemp(c.apparentTempC),
      humidity: infoEvaluation(
        "humidity",
        "습도",
        `${Math.round(c.humidityPct)}%`,
        "직접 임계 없음. WBGT (습구흑구온도) 추정에 사용.",
        "고온 + 고습 = WBGT 상승 → 폭염 단계 가속. 체감온도가 이를 반영.",
      ),
      discomfort: evaluateDiscomfortIndex(c.temperatureC, c.humidityPct),
      pm25: evaluatePM25(c.pm25),
      wind: evaluateWindKmh(c.windKmh),
      uv: evaluateUV(c.uvIndex),
      precipitation: evaluatePrecipitation(c.precipitationMm),
      sunrise: infoEvaluation(
        "sunrise",
        "일출",
        formatHm(d.sunrise),
        "작업 시작 기준 시각 참고용.",
        "일출 전 옥외작업은 조명 안전 점검 필수.",
      ),
      sunset: infoEvaluation(
        "sunset",
        "일몰",
        formatHm(d.sunset),
        "작업 종료 기준 시각 참고용.",
        "일몰 후 옥외작업은 조명 + 반사조끼 필수.",
      ),
    };
  }, [data]);

  // 날씨 항목 → 일주일 예보, 기온 항목 → 24시간 시간대별 기온. 모달에 전달할 표시용 배열.
  const forecast = useMemo<ForecastExtra | undefined>(() => {
    if (!data) return undefined;
    const d7 = data.daily7;
    const days: ForecastDay[] | undefined = d7
      ? d7.time.map((t, i) => ({
          dateLabel: formatWeekday(t, i),
          icon: weatherIcon(d7.weatherCode[i] ?? 0),
          label: weatherLabel(d7.weatherCode[i] ?? 0),
          tMax: d7.tMax[i] ?? 0,
          tMin: d7.tMin[i] ?? 0,
          precipProb: d7.precipProbMax[i] ?? undefined,
        }))
      : undefined;
    const hr = data.hourly;
    const hourly: ForecastHour[] | undefined = hr
      ? hr.time.map((t, i) => ({
          label: formatHourLabel(t),
          temp: hr.temperatureC[i] ?? 0,
        }))
      : undefined;
    return { days, hourly };
  }, [data]);

  // ── 현장 환경 임계(주의/위험) 자동 경보 팝업 ──
  // 정책 평가 항목(체감온도/미세먼지/풍속/자외선/강수량) 중 임계에 걸린 게 새로 생기면 팝업.
  const [alerts, setAlerts] = useState<RuleEvaluation[]>([]);
  // 이미 알린 항목→심각도. 같은 상태로는 재알림 안 함(정상 복귀 후 재발·심각도 악화 시에만 재알림).
  const alertedRef = useRef<Map<string, RuleSeverity>>(new Map());
  // 관리자가 확인/조치완료한 항목→그때 심각도. 같은-이하 심각도면 팝업 억제(악화 시에만 재팝업). localStorage 영속.
  const ackedRef = useRef<Map<string, RuleSeverity>>(new Map());

  // 억제 상태 hydrate(마운트 1회) — 리마운트(캐러셀 전환)·새로고침에도 확인 기록 유지.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ENV_ACK_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, RuleSeverity>;
        ackedRef.current = new Map(Object.entries(obj));
      }
    } catch {
      // localStorage 불가/파싱 실패 무시
    }
  }, []);

  useEffect(() => {
    // 정책 경보(체감온도 등 6종) + KMA 발효 기상특보를 같은 확인/조치 팝업 대상으로 통합.
    const policy = evaluations
      ? [
          evaluations.apparentTemp,
          evaluations.discomfort,
          evaluations.pm25,
          evaluations.wind,
          evaluations.uv,
          evaluations.precipitation,
        ]
      : [];
    const all = [...policy, ...kmaToEvaluations(kma)];
    if (all.length === 0) return;
    const triggered = all.filter((e) => e.currentSeverity !== "normal");
    const triggeredKeys = new Set(triggered.map((e) => e.itemKey));
    // 정상으로 돌아온 항목은 기록에서 제거 → 다음에 다시 임계면 재알림
    for (const key of [...alertedRef.current.keys()]) {
      if (!triggeredKeys.has(key)) alertedRef.current.delete(key);
    }
    // 확인/조치완료로 억제된 항목 제외 — acked 심각도보다 악화돼야(주의→위험) 다시 뜸.
    const visible = triggered.filter((e) => {
      const acked = ackedRef.current.get(e.itemKey);
      return acked === undefined || SEV_RANK[e.currentSeverity] > SEV_RANK[acked];
    });
    // 신규 발생 또는 심각도 변화 항목이 있으면 억제 안 된 항목만 팝업
    const fresh = visible.filter((e) => alertedRef.current.get(e.itemKey) !== e.currentSeverity);
    if (fresh.length > 0) {
      triggered.forEach((e) => alertedRef.current.set(e.itemKey, e.currentSeverity));
      setAlerts(visible);
    }
  }, [evaluations, kma]);

  // 확인/조치완료 — 즉시 억제(localStorage 영속) + 팝업에서 제거 + DB 감사 기록(세션 인증).
  const handleAck = useCallback(
    async (e: RuleEvaluation, status: "확인" | "조치완료") => {
      ackedRef.current.set(e.itemKey, e.currentSeverity);
      try {
        window.localStorage.setItem(
          ENV_ACK_KEY,
          JSON.stringify(Object.fromEntries(ackedRef.current)),
        );
      } catch {
        // localStorage 불가 무시(메모리 억제는 유지)
      }
      setAlerts((prev) => prev.filter((a) => a.itemKey !== e.itemKey));
      try {
        const token = getSessionToken();
        await fetch("/api/env-alert/ack", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            itemKey: e.itemKey,
            itemLabel: e.itemLabel,
            value: e.currentValue,
            severity: e.currentSeverity,
            status,
            ackBy: "관제자",
          }),
        });
      } catch {
        // 기록 실패해도 클라 억제는 유지(다음 폴에서 재시도 안 함 — 억제됨)
      }
    },
    [],
  );

  // 1분 후 자동 닫힘(새 경보가 뜨면 타이머 리셋)
  useEffect(() => {
    if (alerts.length === 0) return;
    const t = window.setTimeout(() => setAlerts([]), 60_000);
    return () => window.clearTimeout(t);
  }, [alerts]);

  // 우측 연결상태 신호등 + 수동 새로고침 — placeholder·오류·데이터 상태 공통.
  const dotCls =
    coordSource === "live"
      ? "bg-semantic-up"
      : coordSource === "cached"
        ? "bg-amber-400 vital-blink-caution"
        : "bg-muted/50 dark:bg-white/20";
  const dotTitle =
    coordSource === "live"
      ? "작업자 GPS 실시간 수신 중 — 라이브 좌표"
      : coordSource === "cached"
        ? "작업자 연결 대기 — 마지막 캐시 좌표로 기상 표시"
        : "현장 좌표 없음 — 작업자 GPS 최초 수신 대기";
  const dotLabel = coordSource === "live" ? "실시간" : coordSource === "cached" ? "캐시" : "대기";
  const statusControls = (
    <div className="flex shrink-0 items-center gap-2">
      <span className="inline-flex items-center gap-1.5" title={dotTitle}>
        <span className={`h-2.5 w-2.5 rounded-full ring-1 ring-hairline ${dotCls}`} />
        <span className="text-[11px] font-medium text-muted dark:text-on-dark-soft">{dotLabel}</span>
      </span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="현장 위치·기상 새로고침"
          title="현장 위치·기상 새로고침"
          className="rounded-md p-1 text-muted transition hover:bg-zinc-200/60 disabled:opacity-50 dark:text-on-dark-soft dark:hover:bg-white/10"
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={refreshing ? "animate-spin" : ""}
            aria-hidden
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      )}
    </div>
  );

  if (lat === undefined || lon === undefined) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-canvas px-6 py-4 text-sm text-body dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark-soft">
        <span className="min-w-0">
          현장 위치 대기 중 — 등록된 작업자 {workerCount}명 · 폰 GPS 좌표 수신 시 자동 표시
        </span>
        {statusControls}
      </section>
    );
  }

  // 이미 받아둔 데이터가 있으면 일시적 갱신 실패에도 마지막 값 유지(패널을 통째로 깨지 않음).
  // 첫 로드부터 실패해 표시할 데이터가 없을 때만 오류 박스를 띄운다.
  if (error && !data) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-xl border border-semantic-down bg-canvas px-6 py-4 text-sm text-semantic-down dark:bg-surface-dark-elevated">
        <span className="min-w-0">날씨 조회 실패 — {error}</span>
        {statusControls}
      </section>
    );
  }

  if (!data?.current || !evaluations) {
    return (
      <section className="rounded-xl border border-hairline bg-canvas px-6 py-4 text-sm text-body dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark-soft">
        날씨 정보 불러오는 중…
      </section>
    );
  }

  const c = data.current;
  const discomfortDi = computeDiscomfortIndex(c.temperatureC, c.humidityPct);
  const updatedAt = formatDateMinute(data.fetchedAt);

  // 기상특보(기상청) — 현장 시·도 발효 특보. RuleEvaluation 형태로 만들어 다른 항목과 동일 렌더/모달.
  const kmaEvaluation: RuleEvaluation = {
    itemKey: "kma-warning",
    itemLabel: "기상특보",
    currentValue: kma?.summary ?? "조회 중",
    currentSeverity: kma?.severity ?? "normal",
    steps: [
      { severity: "danger", binding: "legal", label: "특보 '경보' 발효 — 옥외작업 중지 검토", action: "강풍·호우·태풍·폭염 경보 시 옥외 고소·중량물 작업 중지 검토.", source: "기상청 기상특보" },
      { severity: "caution", binding: "recommendation", label: "특보 '주의보' 발효 — 주의·대비", action: "작업자 안전 점검 및 현장 상황 주시.", source: "기상청 기상특보" },
    ],
    baseline: "특보 없음",
    notes: kma
      ? `현장 시·도(${kma.sido}) 기준 현재 발효 특보${kma.source === "mock" ? " · 샘플" : ""}. 출처 기상청 기상특보.`
      : "기상특보 조회 중",
  };

  // 예비특보(t7) — 현장 시·도에 발효 예정인 특보(사전 대비). 있으면 caution.
  const prelimWhen = kma?.preliminary?.[0]?.when;
  const prelimEvaluation: RuleEvaluation = {
    itemKey: "kma-preliminary",
    itemLabel: "예비특보",
    currentValue: kma?.preliminarySummary ?? "조회 중",
    currentSeverity: kma?.preliminarySeverity ?? "normal",
    steps: [
      { severity: "caution", binding: "recommendation", label: "예비특보 발효 예정 — 사전 대비", action: "발효 예정 시점 전 옥외작업 일정 조정·자재 결박·고소작업 점검.", source: "기상청 예비특보" },
    ],
    baseline: "예정 특보 없음",
    notes: kma
      ? `현장 시·도(${kma.sido}) 발효 예정 특보${prelimWhen ? ` · ${prelimWhen}` : ""}${kma.source === "mock" ? " · 샘플" : ""}. 출처 기상청 예비특보(통보문 t7).`
      : "예비특보 조회 중",
  };

  // 마퀴(가로 슬라이딩)로 순환시킬 항목. 같은 배열을 2벌 렌더해 끊김 없이 흐른다.
  // icon 은 WeatherIcons 의 모노톤 라인 아이콘 키(이모지 아님).
  const items = [
    { icon: "warning", label: "기상특보", value: kma?.summary ?? "조회 중", sub: kma?.sido, evaluation: kmaEvaluation },
    { icon: "bell", label: "예비특보", value: kma?.preliminarySummary ?? "조회 중", sub: prelimWhen, evaluation: prelimEvaluation },
    { icon: weatherIconKey(c.weatherCode), label: "날씨", value: weatherLabel(c.weatherCode), sub: undefined as string | undefined, evaluation: evaluations.weather },
    { icon: "thermometer", label: "기온", value: `${c.temperatureC.toFixed(1)}℃`, sub: undefined, evaluation: evaluations.temperature },
    { icon: "feels", label: "체감", value: `${c.apparentTempC.toFixed(1)}℃`, sub: undefined, evaluation: evaluations.apparentTemp },
    { icon: "humidity", label: "습도", value: `${Math.round(c.humidityPct)}%`, sub: undefined, evaluation: evaluations.humidity },
    { icon: "discomfort", label: "불쾌지수", value: discomfortDi.toFixed(1), sub: discomfortGrade(discomfortDi), evaluation: evaluations.discomfort },
    { icon: "dust", label: "미세먼지", value: c.pm25 !== undefined ? `${c.pm25.toFixed(0)}` : "--", sub: "PM2.5 (μg/㎥)", evaluation: evaluations.pm25 },
    { icon: "wind", label: "풍속", value: `${c.windKmh.toFixed(1)}`, sub: `km/h (${(c.windKmh / 3.6).toFixed(1)} m/s)`, evaluation: evaluations.wind },
    { icon: "uv", label: "자외선", value: c.uvIndex.toFixed(1), sub: uvLabel(c.uvIndex), evaluation: evaluations.uv },
    { icon: "umbrella", label: "강수량", value: `${c.precipitationMm.toFixed(1)}`, sub: "mm/h", evaluation: evaluations.precipitation },
    { icon: "sunrise", label: "일출", value: formatHm(data.daily?.sunrise), sub: undefined, evaluation: evaluations.sunrise },
    { icon: "sunset", label: "일몰", value: formatHm(data.daily?.sunset), sub: undefined, evaluation: evaluations.sunset },
  ];

  return (
    <>
      <section className="min-w-0 overflow-hidden rounded-xl border border-hairline bg-canvas px-6 py-2.5 dark:border-white/10 dark:bg-surface-dark-elevated">
        <div className="mb-2.5 flex items-center justify-between gap-3 text-xs text-body dark:text-on-dark-soft">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-ink dark:text-on-dark">현장 환경</span>
            <span className="text-body dark:text-on-dark-soft">
              · 작업자 {workerCount}명 GPS 평균 ({data.lat?.toFixed(3)}, {data.lon?.toFixed(3)})
            </span>
            {updatedAt && (
              <span className="font-mono text-body dark:text-on-dark-soft">
                · 업데이트 {updatedAt}
              </span>
            )}
            {/* 갱신 실패 중이나 직전 데이터를 유지 표시 — 오래된 값이 실시간처럼 보이지 않게 '갱신 지연' 경고. */}
            {error && data && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 vital-blink-caution dark:bg-amber-400/15 dark:text-amber-300">
                갱신 지연 · 마지막 수신값
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-body dark:text-on-dark-soft">
              {data.cached ? "캐시" : "실시간"} · Open-Meteo · 클릭 → 정책 근거
            </span>
            {statusControls}
          </div>
        </div>
        {/* 무한 슬라이드 티커 — 끊김 없이 흐르고, 호버 시 정지가 아니라 감속(InfiniteSlider 방식).
            좌우 가장자리는 mask 로 자연스럽게 페이드(별도 그라데이션 오버레이 불필요). */}
        <div
          ref={scrollRef}
          className="no-scrollbar relative w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden py-1 [mask-image:linear-gradient(to_right,transparent,#000_4%,#000_96%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,#000_4%,#000_96%,transparent)]"
        >
          <div className="flex w-max items-center">
            {[0, 1].map((copy) => (
              <div
                key={copy}
                className="flex items-center whitespace-nowrap"
                aria-hidden={copy === 1}
              >
                {items.map((it) => (
                  <TickerSegment
                    key={`${copy}-${it.label}`}
                    icon={it.icon}
                    label={it.label}
                    value={it.value}
                    sub={it.sub}
                    severity={it.evaluation.currentSeverity}
                    onClick={() => setSelected(it.evaluation)}
                    duplicate={copy === 1}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {selected && (
        <WeatherRuleModal
          evaluation={selected}
          forecast={forecast}
          onClose={() => setSelected(null)}
        />
      )}

      {alerts.length > 0 && (
        <WeatherAlertToast
          key={alerts.map((a) => `${a.itemKey}:${a.currentSeverity}`).join("|")}
          alerts={alerts}
          durationMs={60000}
          onSelect={(e) => setSelected(e)}
          onAck={handleAck}
          onClose={() => setAlerts([])}
        />
      )}
    </>
  );
}

// 칩 값 색상 — 대시보드 톤과 조화(라이트 진한 톤/다크 밝은 톤). 정상=중립 ink, 주의=amber(블링크), 위험=red(빠른 블링크).
const VALUE_CLASS: Record<RuleSeverity, string> = {
  normal: "text-ink dark:text-on-dark",
  caution: "text-amber-600 dark:text-amber-300 vital-blink-caution",
  danger: "text-red-600 dark:text-red-400 vital-blink-danger",
};

// 현장환경 1개 항목 — 둥근 칩 [아이콘 라벨 값 sub]. 칩마다 우측 여백(me-2.5)을 둬
// 2벌 사본이 같은 간격으로 이어붙어 끊김 없이 순환한다(seamless). 폰트는 대시보드 sans 로 통일.
function TickerSegment({
  icon,
  label,
  value,
  sub,
  severity,
  onClick,
  duplicate = false,
}: {
  icon?: string;
  label: string;
  value: string;
  sub?: string;
  severity: RuleSeverity;
  onClick: () => void;
  duplicate?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} 정책 근거 보기`}
      aria-hidden={duplicate || undefined}
      tabIndex={duplicate ? -1 : undefined}
      className="me-2.5 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline/70 bg-surface-soft/70 px-3.5 py-1.5 align-middle transition-colors hover:border-ink/20 hover:bg-surface-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
    >
      <WeatherIcon
        name={icon ?? "cloud"}
        className="h-[18px] w-[18px] shrink-0 text-body dark:text-on-dark-soft"
      />
      <span className="text-[11px] font-medium tracking-tight text-muted dark:text-on-dark-soft">
        {label}
      </span>
      <span className={`text-sm font-semibold tabular-nums ${VALUE_CLASS[severity]}`}>
        {value}
      </span>
      {sub && (
        <span className="text-[10px] font-medium text-muted-soft dark:text-on-dark-soft/70">
          {sub}
        </span>
      )}
    </button>
  );
}

// WMO weather code → 한국어 라벨에 대응하는 이모지
function weatherIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code >= 85 && code <= 86) return "🌨️";
  if (code === 95) return "⛈️";
  if (code === 96 || code === 99) return "⛈️";
  return "🌡️";
}

// WMO weather code → 한국어 간단 라벨
export function weatherLabel(code: number): string {
  if (code === 0) return "맑음";
  if (code === 1) return "대체로 맑음";
  if (code === 2) return "구름 조금";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if (code >= 51 && code <= 57) return "이슬비";
  if (code >= 61 && code <= 67) return "비";
  if (code >= 71 && code <= 77) return "눈";
  if (code >= 80 && code <= 82) return "소나기";
  if (code >= 85 && code <= 86) return "눈소나기";
  if (code === 95) return "뇌우";
  if (code === 96 || code === 99) return "강한 뇌우";
  return `코드 ${code}`;
}

function uvLabel(uv: number): string {
  if (uv < 3) return "낮음";
  if (uv < 6) return "보통";
  if (uv < 8) return "높음";
  if (uv < 11) return "매우 높음";
  return "위험";
}

// 일주일 예보 날짜 라벨 — 0=오늘 / 1=내일 / 그 외 요일, 뒤에 M/D.
function formatWeekday(iso: string, index: number): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (index === 0) return `오늘 ${md}`;
  if (index === 1) return `내일 ${md}`;
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${wd} ${md}`;
}

// 시간대 라벨 — "2026-06-01T14:00" → "14시"
function formatHourLabel(iso: string): string {
  const hh = iso.slice(11, 13);
  return `${Number(hh)}시`;
}

function formatHm(iso?: string): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function formatDateMinute(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${year}.${month}.${day} / ${hour}:${minute}`;
}
