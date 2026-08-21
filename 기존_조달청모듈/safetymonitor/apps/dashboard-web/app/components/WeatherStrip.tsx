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
  evaluateKmaPreliminary,
  evaluateKmaWarning,
  evaluatePM25,
  evaluatePrecipitation,
  evaluateUV,
  evaluateWindKmh,
  infoEvaluation,
  type RuleEvaluation,
  type RuleSeverity,
  type ThresholdStep,
} from "../../lib/weather-rules";
import {
  INTENSITY_LABEL,
  REGIMEN_LABEL,
  workRestRegimen,
} from "../../lib/heat-work-rest";
import { getSessionToken } from "./session-token";
import { IndoorEnvRows } from "./IndoorEnvRows";
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
  /** WBGT(℃) — 참고 지표. 산출 실패·구 폴백 응답에는 없다. */
  wbgt?: number;
  humidityPct: number;
  windKmh: number;
  // 순간풍속(돌풍·km/h) — 크레인/고소 중지 판정 기준. 구 DB 폴백 응답엔 없을 수 있음.
  windGustKmh?: number;
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
  // regions = 현장·인근 시·도 지역화 목록, otherRegionCount = 그 외 시·도 구역 수(전국 발효 맥락).
  warnings: { type: string; level: "경보" | "주의보"; regions: string[]; otherRegionCount?: number }[];
  severity: "normal" | "caution" | "danger";
  summary: string;
  preliminary: { type: string; when: string; regions: string[]; otherRegionCount?: number }[];
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
    // 현장·인근 시·도만 표시(서버 지역화) + 그 외 시·도 수로 전국 발효 맥락 보존.
    const regionText =
      (w.regions.length > 0 ? w.regions.join(", ") : kma.sido) +
      (w.otherRegionCount ? ` 외 ${w.otherRegionCount}개 지역` : "");
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
  layout = "strip",
  // 경보 팝업 주체 — 화면에 뜬 인스턴스가 하나뿐일 때만 true 여야 한다(아래 렌더 주석).
  showAlertToast = layout !== "list",
}: Props & { layout?: "strip" | "list"; showAlertToast?: boolean }) {
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
        // 토큰 동봉 — 서버가 세션이 있을 때만 이력 저장·환경 알림을 수행한다(BE-AUTHZ-02).
        const wxToken = getSessionToken();
        const res = await fetch(
          `/api/weather?lat=${lat}&lon=${lon}&workers=${workerCount}`,
          {
            cache: "no-store",
            headers: wxToken ? { Authorization: `Bearer ${wxToken}` } : undefined,
          },
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
        // 토큰 동봉 — 서버가 세션·크론키가 있을 때만 특보 알림을 발사한다(BE-AUTHZ-02).
        // 18ae4b8 이 같은 파일의 weather load() 에만 붙이고 여기를 빠뜨려, 브라우저 경로
        // 특보 알림이 항상 스킵되고 있었다(감사 DLT-FE-2).
        const kmaToken = getSessionToken();
        const res = await fetch(`/api/kma-warning?lat=${lat}&lon=${lon}`, {
          cache: "no-store",
          headers: kmaToken ? { Authorization: `Bearer ${kmaToken}` } : undefined,
        });
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
        "직접 임계 없음. 체감온도(기상청 식)와 WBGT 산출의 입력.",
        "고온 + 고습 = 체감온도·WBGT 동시 상승. 습구온도를 통해 두 지표 모두에 들어간다.",
      ),
      // WBGT — 국제 표준(ACGIH/ISO 7243) 참고 지표. **임계를 붙이지 않는다**:
      // ACGIH 허용한계는 작업 강도(대사율)별로 달라 체표면적이 필요하고, 한국 법정 폭염 기준은
      // 체감온도다. 값과 근거만 보이고 판정은 체감온도 항목이 담당한다.
      wbgt: infoEvaluation(
        "wbgt",
        "WBGT",
        c.wbgt === undefined ? "--" : `${c.wbgt.toFixed(1)}℃`,
        "습구흑구온도 — 기온·습도·풍속·일사를 함께 반영하는 국제 표준 열스트레스 지표(ACGIH/ISO 7243).",
        "산출 = Liljegren(2008) 물리 모델. OSHA 공식 계산기와 ±0.03℃ 로 일치하나 이는 " +
          "구현이 모델을 정확히 재현한다는 뜻이며, 모델 자체 오차는 약 1℃ 다. " +
          "입력은 기온·습도·풍속 = 기상청 관측, 일사량 = Open-Meteo(실황에 일사가 없음). " +
          "실외·직사광 기준이라 실내·그늘 작업에는 과대. " +
          "★ 법적 판정 기준은 체감온도(31/33/35℃)이며 WBGT 는 참고 지표다. " +
          "⚠ 다만 직업보건 기준으로는 WBGT 가 표준이고 체감온도는 그늘·안정 상태 기준이라 " +
          "일사·풍속·작업강도를 반영하지 못한다 — 옥외 중작업에서는 체감온도가 위험을 " +
          "과소평가할 수 있으므로 이 값을 함께 본다.\n\n" +
          workRestAdviceText(c.wbgt),
      ),
      discomfort: evaluateDiscomfortIndex(c.temperatureC, c.humidityPct),
      pm25: evaluatePM25(c.pm25),
      wind: evaluateWindKmh(c.windKmh, c.windGustKmh),
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

  // 기상특보·예비특보(기상청) — 현장 시·도 발효 특보. 다른 항목과 동일하게 weather-rules 가 평가.
  const kmaEvaluation = evaluateKmaWarning(kma);
  const prelimWhen = kma?.preliminary?.[0]?.when;
  const prelimEvaluation = evaluateKmaPreliminary(kma);

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
    // WBGT — 체감온도 옆이 아니라 불쾌지수 뒤에 둔다. 앞쪽은 법정 판정 항목(기온·체감) 자리라
    // 참고 지표를 섞으면 무엇이 판정 근거인지 흐려진다.
    { icon: "thermometer", label: "WBGT", value: c.wbgt === undefined ? "--" : c.wbgt.toFixed(1), sub: "습구흑구 (참고)", evaluation: evaluations.wbgt },
    { icon: "dust", label: "미세먼지", value: c.pm25 !== undefined ? `${c.pm25.toFixed(0)}` : "--", sub: "PM2.5 (μg/㎥)", evaluation: evaluations.pm25 },
    {
      icon: "wind",
      label: "풍속",
      // 판정 기준(순간풍속)을 헤드라인으로 — 평균만 보여주면 "돌풍 초과인데 정상 표시" 혼동 재발.
      value: c.windGustKmh !== undefined ? `${(c.windGustKmh / 3.6).toFixed(1)}` : `${c.windKmh.toFixed(1)}`,
      sub:
        c.windGustKmh !== undefined
          ? `m/s·순간 (평균 ${(c.windKmh / 3.6).toFixed(1)} m/s)`
          : `km/h (${(c.windKmh / 3.6).toFixed(1)} m/s)`,
      evaluation: evaluations.wind,
    },
    { icon: "uv", label: "자외선", value: c.uvIndex.toFixed(1), sub: uvLabel(c.uvIndex), evaluation: evaluations.uv },
    { icon: "umbrella", label: "강수량", value: `${c.precipitationMm.toFixed(1)}`, sub: "mm/h", evaluation: evaluations.precipitation },
    { icon: "sunrise", label: "일출", value: formatHm(data.daily?.sunrise), sub: undefined, evaluation: evaluations.sunrise },
    { icon: "sunset", label: "일몰", value: formatHm(data.daily?.sunset), sub: undefined, evaluation: evaluations.sunset },
  ];

  return (
    <>
      <section className={`min-w-0 overflow-hidden rounded-xl border border-hairline bg-canvas py-2.5 dark:border-white/10 dark:bg-surface-dark-elevated ${layout === "list" ? "px-3" : "px-6"}`}>
        <div className="mb-2.5 flex items-center justify-between gap-3 text-xs text-body dark:text-on-dark-soft">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-ink dark:text-on-dark">현장 환경</span>
            {/* 좁은 호버 패널(list)에서는 부제가 여러 줄로 뭉쳐 읽기 어렵다 → 갱신 시각만 남긴다. */}
            {layout !== "list" && (
              <span className="text-body dark:text-on-dark-soft">
                · 작업자 {workerCount}명 GPS 평균 ({data.lat?.toFixed(3)}, {data.lon?.toFixed(3)})
              </span>
            )}
            {updatedAt && (
              <span className="font-mono text-body dark:text-on-dark-soft">
                · {layout === "list" ? updatedAt.slice(-5) : `업데이트 ${updatedAt}`}
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
            {/* 좁은 패널에서는 우측 statusControls(좌표 출처)와 글자가 겹쳐 읽혀 혼동된다 → 생략. */}
            {layout !== "list" && (
              <span className="text-body dark:text-on-dark-soft">
                {data.cached ? "캐시" : "실시간"} · Open-Meteo · 항목 클릭 시 정책 근거
              </span>
            )}
            {statusControls}
          </div>
        </div>
        {/* list = 좌측 호버 패널용 세로 목록(가로 오토슬라이딩 금지 — 사용자 요청).
            항목 클릭 시 정책 근거 모달은 strip 과 동일하게 동작한다. */}
        {layout === "list" ? (
          <>
            <ul className="flex flex-col gap-1">
            {items.map((it) => (
              <li key={it.label}>
                <button
                  type="button"
                  onClick={() => setSelected(it.evaluation)}
                  title={`${it.label} 정책 근거 보기`}
                  className="flex w-full items-center gap-2 rounded-lg border border-hairline/70 bg-surface-soft/70 px-2.5 py-1.5 text-left transition-colors hover:border-ink/20 hover:bg-surface-card dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
                >
                  <WeatherIcon
                    name={it.icon ?? "cloud"}
                    className="h-[18px] w-[18px] shrink-0 text-body dark:text-on-dark-soft"
                  />
                  {/* 라이트모드 가독성 — text-muted(#999)는 흰 배경에서 너무 흐리다 → text-body(#60646c). */}
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-tight text-body dark:text-on-dark-soft">
                    {it.label}
                  </span>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${VALUE_CLASS[it.evaluation.currentSeverity]}`}>
                    {it.value}
                  </span>
                  {it.sub && (
                    <span className="shrink-0 text-[10px] font-medium text-muted dark:text-on-dark-soft/80">
                      {it.sub}
                    </span>
                  )}
                </button>
              </li>
            ))}
            </ul>
            {/* 실내(가스포드 실기기 온습압) — 위 항목은 전부 실외 기상이라 구분해 아래에 붙인다. */}
            <IndoorEnvRows />
          </>
        ) : (
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
        )}
      </section>

      {selected && (
        <WeatherRuleModal
          evaluation={selected}
          forecast={forecast}
          onClose={() => setSelected(null)}
        />
      )}

      {/* 경보 팝업은 화면에 하나만 — 두 인스턴스가 모두 띄우면 같은 경보 모달이 겹쳐 뜨고
          확인/조치 기록도 이중으로 남는다. 그래서 보조 표시인 layout="list" 는 기본으로 띄우지 않되,
          그 인스턴스가 화면의 유일한 현장 환경일 때만(관제 탭 고정 패널) 호출부가 켠다. */}
      {showAlertToast && alerts.length > 0 && (
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
/**
 * 현재 WBGT 에서 작업강도별 허용 작업–휴식 시간비를 한 줄로 만든다(KOSHA GUIDE W-12-2017 <표 1>).
 *
 * ★ 작업자별이 아니라 **강도별 전체**를 보여준다. 관리자는 "우리 현장 작업이 어느 강도인가"를
 * 알고 있으므로, 세 줄이면 개인 작업대사율을 몰라도 판단이 선다 — 개인별 산출을 기다릴 필요가 없다.
 *
 * ⚠ 이 표의 대상은 **실내 열원 작업**이고 옥외 폭염의 법정 기준은 체감온도다. 참고 권고로만 쓴다.
 * 복장 보정은 여름작업복(0℃) 기준 — 방수복 등은 최대 +6℃ 불리해진다.
 */
function workRestAdviceText(wbgt: number | undefined): string {
  if (wbgt === undefined) return "작업–휴식 권고: WBGT 미산출로 판정 불가.";
  const rows = (["light", "moderate", "heavy"] as const)
    .map((i) => `${INTENSITY_LABEL[i]} ${REGIMEN_LABEL[workRestRegimen(wbgt, i)]}`)
    .join(" · ");
  return (
    `작업–휴식 권고(KOSHA GUIDE W-12-2017 <표 1> · 여름작업복 기준) — ${rows}. ` +
    "이 지침의 대상은 용광로 등 실내 열원 작업이라 옥외 건설현장에는 참고로만 적용한다. " +
    "방수복·면작업복 착용 시 기준이 각각 +6℃·+2℃ 불리해진다."
  );
}

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
