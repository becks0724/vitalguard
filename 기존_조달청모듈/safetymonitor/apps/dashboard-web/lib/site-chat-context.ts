// 현장 정보 챗 컨텍스트 수집(I/O · server-only) — 의도별 서버 확정 DTO + 규칙 폴백 텍스트.
//
// 경계(위반 금지):
//  - LLM 에 실을 수 있는 것은 여기서 만든 DTO 가 전부다. 개인 식별 정보(작업자 이름·AED 담당자
//    이름·원시 생체값)는 어떤 DTO 에도 넣지 않는다 — 경보 이력은 가명 사번(worker_id)까지만.
//  - 어떤 조회 실패도 챗을 깨지 않는다(site-environment 와 같은 best-effort): 실패 의도는
//    data=null + "조회 불가" 로 강등되고, 규칙 폴백 텍스트가 그 사실을 그대로 말한다.
//  - 중심 좌표는 관제 화면·env-check 와 같은 출처 순서다(주소 지오코딩 → 작업자 좌표 캐시 →
//    기상 일별 스냅숏 — 2026-08-27 실측 교훈: 캐시 우선이면 화면과 1km 어긋난다).
import "server-only";

import {
  BINDING_LABEL,
  SEVERITY_LABEL,
  evaluateApparentTemp,
  evaluateDiscomfortIndex,
  evaluatePM25,
  evaluatePrecipitation,
  evaluateUV,
  evaluateWindKmh,
  type RuleEvaluation,
} from "./weather-rules";
import { matchEnvironment } from "./site-env-rules";
import { readSiteEnvironment } from "./site-environment";
import {
  getLatestSiteCoord,
  getLatestSiteInfo,
  getLatestWeatherDaily,
  listAlerts,
  listGaspodTelemetry,
  listRegisteredAedDevices,
} from "./db";
import { geocodeAddress, vworldConfigured } from "../app/lib/vworld";
import { warningsForLocation } from "../app/lib/kma";
import { disasterMsgsForLocation } from "../app/lib/disaster-msg-api";
import { getActiveTyphoons } from "../app/lib/typhoon";
import { getSafetyLight } from "../app/lib/kosha";
import { searchNearbyHospitals } from "../app/lib/naver-local";
import { getShopPrices } from "../app/lib/g2b-shop";
import { LAW_SNAPSHOT_NOTICE, searchLawArticles } from "./law-snapshot";
import { weatherLabel } from "./weather-code-label";
import { getRateNoticeStatus } from "../app/lib/moleg";
import { extractItemKeywords, type SiteChatIntentDef, type SiteChatIntentId } from "./site-chat-intents";

export type SiteChatContextResult = {
  id: SiteChatIntentId;
  label: string;
  /** CLOVA 에 [현장 정보 데이터]로 실리는 서버 확정 DTO. null = 조회 불가. */
  data: unknown;
  /** CLOVA 실패·정책 위반 시 그대로 내보내는 결정적 텍스트. */
  fallbackText: string;
  /** 영역 권한 거부 — true 면 data 는 항상 null 이고 CLOVA 컨텍스트에 싣지 않는다(서버 트리밍). */
  denied?: boolean;
};

export type SiteChatBuildOptions = {
  /** 자체 라우트 호출용 origin(Host 헤더 기반). */
  origin: string;
  /** 들어온 요청의 Authorization 헤더 — 영역 게이트가 있는 자체 라우트에 그대로 전달한다.
   *  권한 판정 주체는 그 라우트(verifyAreaAccess)이지 챗봇이 아니다(사본 금지·드리프트 방지). */
  authHeader: string | null;
  /** 감독관 질문 원문 — 품명 추출 등 결정적 파생에만 쓰고 LLM 프롬프트 구성은 route 소유. */
  message: string;
};

// ── 중심 좌표 — env-check(app/api/cron/env-check)와 같은 출처 순서(주소 1순위) ──────
// env-check 쪽 구현은 가드 테스트(2026-08-27-env-alert-consistency)가 원문을 고정하고 있어
// 함수로 빼지 않고 순서를 여기 재기술한다. 순서가 어긋나면 아래 가드가 잡는다
// (lib/2026-08-31-site-chat-boundary.guard.test.ts — 주소 → 캐시 → weatherDaily).
async function resolveSiteCenter(): Promise<{ lat: number; lon: number; source: string } | null> {
  const info = await getLatestSiteInfo().catch(() => null);
  const address = info?.address?.trim() ?? "";
  if (address && vworldConfigured()) {
    const g = await geocodeAddress(address).catch(() => ({ ok: false }) as const);
    if (g.ok) return { lat: g.lat, lon: g.lon, source: "address" };
  }
  const coord = await getLatestSiteCoord().catch(() => null);
  if (coord) return { lat: coord.lat, lon: coord.lon, source: "cache" };
  const daily = await getLatestWeatherDaily().catch(() => null);
  if (daily) return { lat: daily.lat, lon: daily.lon, source: "weatherDaily" };
  return null;
}

// ── 의도별 수집기 ────────────────────────────────────────────────────────────────

function ruleEvalDto(ev: RuleEvaluation, withSteps: boolean) {
  return {
    항목: ev.itemLabel,
    현재값: ev.currentValue,
    단계: SEVERITY_LABEL[ev.currentSeverity],
    적용단계: ev.currentStep
      ? {
          라벨: ev.currentStep.label,
          조치: ev.currentStep.action,
          근거: ev.currentStep.source,
          구속력: BINDING_LABEL[ev.currentStep.binding],
        }
      : null,
    기준선: ev.baseline,
    ...(withSteps
      ? {
          전체임계단계: ev.steps.map((s) => ({
            라벨: s.label,
            조치: s.action,
            근거: s.source,
            구속력: BINDING_LABEL[s.binding],
          })),
        }
      : {}),
  };
}

type WeatherCurrent = {
  weatherCode?: number;
  temperatureC: number;
  apparentTempC: number;
  humidityPct: number;
  windKmh: number;
  windGustKmh?: number;
  precipitationMm: number;
  uvIndex: number;
  pm25?: number;
  /** WBGT(습구흑구) — 참고 지표. 법적 판정 기준은 체감온도(2026-08-14 가드). */
  wbgt?: number;
};

type WeatherDaily = { sunrise?: string; sunset?: string };

/** 기상 현재값 — 화면과 같은 /api/weather 를 자체 호출(공개 GET · 무인증 = 부작용 없음). */
async function fetchWeatherCurrent(
  origin: string,
  lat: number,
  lon: number,
): Promise<{ current: WeatherCurrent; daily: WeatherDaily } | null> {
  try {
    const res = await fetch(`${origin}/api/weather?lat=${lat}&lon=${lon}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      ok?: boolean;
      current?: WeatherCurrent;
      daily?: WeatherDaily;
    };
    return json.ok && json.current ? { current: json.current, daily: json.daily ?? {} } : null;
  } catch {
    return null;
  }
}

async function weatherContext(origin: string) {
  const center = await resolveSiteCenter();
  if (!center) return null;
  const fetched = await fetchWeatherCurrent(origin, center.lat, center.lon);
  if (!fetched) return null;
  const c = fetched.current;
  return {
    좌표출처: center.source,
    날씨상태: typeof c.weatherCode === "number" ? weatherLabel(c.weatherCode) : undefined,
    일출: fetched.daily.sunrise,
    일몰: fetched.daily.sunset,
    판정: [
      ruleEvalDto(evaluateApparentTemp(c.apparentTempC), true),
      ruleEvalDto(evaluateWindKmh(c.windKmh, c.windGustKmh), true),
      ruleEvalDto(evaluatePrecipitation(c.precipitationMm), false),
      ruleEvalDto(evaluatePM25(c.pm25), false),
      ruleEvalDto(evaluateUV(c.uvIndex), false),
      ruleEvalDto(evaluateDiscomfortIndex(c.temperatureC, c.humidityPct), false),
    ],
    원자료: {
      기온C: c.temperatureC,
      체감온도C: c.apparentTempC,
      습도pct: c.humidityPct,
      WBGT참고: c.wbgt !== undefined
        ? { 값C: c.wbgt, 안내: "습구흑구온도 — 참고 지표. 법적 판정 기준은 체감온도(31/33/35℃)다." }
        : undefined,
    },
  };
}

async function kmaWarningContext() {
  const center = await resolveSiteCenter();
  if (!center) return null;
  const w = await warningsForLocation(center.lat, center.lon);
  return {
    시도: w.sido,
    출처: w.source === "live" ? "기상청 실황" : "샘플(키 미설정·장애)",
    발효특보: w.warnings.map((x) => ({
      종류: x.type,
      수준: x.level,
      발효지역: x.regions,
      그외지역수: x.otherRegionCount ?? 0,
    })),
    요약: w.summary,
    예비특보요약: w.preliminarySummary,
    예비특보: w.preliminary.map((p) => ({ 종류: p.type, 시점: p.when, 구역: p.regions })),
  };
}

async function typhoonContext() {
  const typhoons = await getActiveTyphoons();
  if (typhoons.length === 0 || typhoons[0]?.source === "none") {
    return { 발효태풍수: 0, 안내: "현재 발효 중인 태풍 없음" };
  }
  return {
    발효태풍수: typhoons.length,
    태풍: typhoons.map((t) => {
      const cur = t.track[t.currentIndex];
      return {
        이름: t.name ?? t.nameEn ?? "이름 미상",
        번호: t.seq,
        발표시각: t.tmFc,
        안내: t.note,
        현재: cur
          ? {
              시각: cur.tm,
              위도: cur.lat,
              경도: cur.lon,
              이동방향: cur.dir,
              이동속도kmh: cur.speedKmh,
              중심기압hPa: cur.pressureHpa,
              최대풍속ms: cur.maxWindMs,
            }
          : null,
        예보점수: Math.max(0, t.track.length - t.currentIndex - 1),
      };
    }),
  };
}

async function disasterMsgContext() {
  const center = await resolveSiteCenter();
  if (!center) return null;
  const d = await disasterMsgsForLocation(center.lat, center.lon);
  const view = (m: { type: string; step: string; atMs: number; message: string; fresh: boolean }) => ({
    유형: m.type,
    단계: m.step,
    시각: new Date(m.atMs).toISOString(),
    신선: m.fresh,
    내용: m.message.length > 200 ? `${m.message.slice(0, 200)}…` : m.message,
  });
  return {
    시도: d.sido,
    출처: d.source === "live" ? "행안부 실황" : "샘플(키 미설정·장애)",
    요약: d.summary,
    현장발령: d.site.slice(0, 5).map(view),
    인근발령: d.nearby.slice(0, 3).map(view),
  };
}

/** 실내 현장 환경(화면 패널 하단) — 가스포드 센서의 온도·습도·기압. */
async function indoorEnvironment() {
  try {
    const rows = await listGaspodTelemetry(1);
    const latest = rows[0];
    if (!latest) return null;
    return {
      출처: "가스포드 센서(실내)",
      온도C: latest.temp,
      습도pct: latest.humidity,
      기압hPa: latest.pressure,
      최근수신: latest.received_at,
    };
  } catch {
    return null;
  }
}

async function gasContext() {
  const signals = await readSiteEnvironment();
  const advice = matchEnvironment(signals);
  return {
    감지기: signals.gaspod
      ? {
          장비: signals.gaspod.deviceId,
          상태: signals.gaspod.state,
          산소농도pct: signals.gaspod.o2,
          최근수신: signals.gaspod.receivedAt,
          수신지연: signals.gaspod.stale,
        }
      : null,
    실내환경: await indoorEnvironment(),
    안내: signals.gaspod === null ? "가스 감지기 미연결 또는 미수신" : undefined,
    환경배제권고: advice.blocks.map((b) => ({ 작업: b.tag, 사유: b.label, 근거: b.basis })),
    환경안내: advice.notes,
  };
}

async function aedContext() {
  const devices = await listRegisteredAedDevices();
  return {
    등록장비수: devices.length,
    // 담당자 이름은 개인정보 — DTO 에 싣지 않는다(loc·배터리·주기까지만).
    장비: devices.slice(0, 10).map((d) => ({
      장비ID: d.aedId,
      위치: d.loc,
      제품: d.product,
      장비배터리pct: d.devBatt,
      배터리교체주기개월: d.battCycleMonths,
      패드교체주기개월: d.padCycleMonths,
      최근교환일: d.lastSwapTs,
    })),
  };
}

// 경보 유형 → 감독관 표시 라벨(lib/alert-type.ts AlertType 유니온과 1:1) — 모델이
// "낙상=vital" 같은 매핑을 추측하지 않도록 서버가 확정해서 넘긴다.
const ALERT_TYPE_LABEL: Record<string, string> = {
  sos: "SOS",
  fall: "낙상",
  vital: "생체 이상",
  geofence: "구획 이탈",
  danger_zone: "위험구역 진입",
  absence: "장기 미수신",
};

async function alertsLogContext() {
  const alerts = await listAlerts(50);
  const byType = new Map<string, number>();
  let unacked = 0;
  for (const a of alerts) {
    const label = ALERT_TYPE_LABEL[a.type] ?? a.type;
    byType.set(label, (byType.get(label) ?? 0) + 1);
    if (a.ack_at === null) unacked += 1;
  }
  return {
    표본: `최근 ${alerts.length}건`,
    유형별건수: Object.fromEntries(byType),
    미확인건수: unacked,
    // 이름은 싣지 않는다 — 가명 사번까지만(배치 챗과 같은 경계).
    최근경보: alerts.slice(0, 5).map((a) => ({
      유형: ALERT_TYPE_LABEL[a.type] ?? a.type,
      시각: a.ts,
      작업자사번: a.worker_id,
      확인여부: a.ack_at !== null,
    })),
  };
}

async function safetyLightContext() {
  const s = await getSafetyLight();
  return {
    출처: s.source === "live" ? "KOSHA 실황" : "샘플(키 미설정·점검)",
    신호등: s.counts,
    조회시각: s.fetchedAt,
    안내: s.note,
  };
}

async function hospitalsContext() {
  const [center, info] = await Promise.all([
    resolveSiteCenter(),
    getLatestSiteInfo().catch(() => null),
  ]);
  const region = info?.address?.trim() ?? "";
  const result = await searchNearbyHospitals({
    region,
    lat: center?.lat ?? Number.NaN,
    lon: center?.lon ?? Number.NaN,
    scope: "emergency",
  });
  if (!result.configured) return null;
  return {
    지역: result.region,
    응급의료: result.nearestEmergency.slice(0, 5).map((h) => ({
      이름: h.name,
      분류: h.emergencyKind,
      주소: h.roadAddress || h.address,
      전화: h.telephone,
      거리km: h.distanceKm,
      진료시간: h.openHours,
    })),
    안내: result.note,
  };
}

// ── 조달청 도메인(도메인 ②) ─────────────────────────────────────────────────────

async function procurePriceContext(message: string) {
  const keywords = extractItemKeywords(message);
  if (keywords.length === 0) {
    return { 안내: "품명을 함께 질문해 주세요(예: 안전모 단가 알려줘)." };
  }
  const shop = await getShopPrices(keywords);
  const hits = keywords
    .map((k) => shop.prices[k])
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      검색어: p.keyword,
      품목명: p.name,
      규격: p.spec,
      단가원: p.price,
      부가세구분: p.vat,
      공급가액원: p.supplyPrice,
      표본수: p.count,
      출처구분: p.src,
    }));
  return {
    출처: shop.source === "live" ? "나라장터 종합쇼핑몰 당일 피드" : "당일 피드 미포착",
    // 피드 특성(g2b-shop 헤더 주석 그대로) — 모델이 "다른 판매처를 찾아보라"류 발명을 하지 않게
    // 원천의 성격을 서버가 명시한다.
    피드특성:
      "단가 원천은 나라장터 당일 납품요구(실거래)와 당일 카탈로그 등록·변경분 피드다. " +
      "종합쇼핑몰에 등록된 품목이라도 오늘 거래·등록이 없으면 조회되지 않고, 거래가 발생하면 자동 반영된다. " +
      "보호구처럼 거래 빈도가 낮은 품목은 당일 피드에 없는 날이 많다.",
    검색품명: keywords,
    단가: hits,
    안내: hits.length === 0 ? shop.note : shop.note,
  };
}

/** 공단 보조금 정합 — 영역 게이트(subsidy)가 있는 자체 라우트를 인증 전달로 호출한다.
 *  403 = 권한 없음(denied) — 데이터는 존재하지만 이 계정이 못 보는 것이므로 LLM 에 싣지 않는다. */
async function subsidyAuditContext(
  origin: string,
  authHeader: string | null,
): Promise<{ denied: true } | Record<string, unknown> | null> {
  const res = await fetch(`${origin}/api/subsidy-audit`, {
    cache: "no-store",
    headers: authHeader ? { authorization: authHeader } : {},
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 403 || res.status === 401) return { denied: true };
  if (!res.ok) return null;
  const json = (await res.json()) as {
    source?: string;
    rows?: {
      item: string; site: string; grantAmt: number; invoiceSupply: number | null;
      stdPrice: number | null; shopSupply: number | null; shopSource: string | null;
      obs: string; note: string;
    }[];
    shopNote?: string;
  };
  return {
    출처: json.source === "live" ? "조달단가 실연동" : "샘플 포함",
    조달단가안내: json.shopNote,
    정합행: (json.rows ?? []).slice(0, 12).map((r) => ({
      지원품목: r.item,
      사업장: r.site,
      교부결정액원: r.grantAmt,
      계산서공급가액원: r.invoiceSupply,
      공단표준가격원: r.stdPrice,
      조달단가공급가액원: r.shopSupply,
      조달단가출처: r.shopSource,
      관측: r.obs,
      비고: r.note,
    })),
  };
}

async function safetyRateContext() {
  const status = await getRateNoticeStatus();
  const applied = status.applied as { name?: string; noticeNo?: string; effectiveDate?: string };
  return {
    적용고시: {
      이름: applied?.name,
      발령번호: applied?.noticeNo,
      시행일: applied?.effectiveDate,
    },
    법제처최신: status.latest
      ? {
          이름: status.latest.name,
          발령번호: status.latest.noticeNo,
          발령일: status.latest.issueDate,
          시행일: status.latest.effectiveDate,
        }
      : null,
    개정드리프트: status.drift,
    요율표대조: status.rateCheck
      ? { 일치: status.rateCheck.verified, 차이: status.rateCheck.diffs }
      : "파싱 불가(수동 대조 필요)",
    안내: "공사 종류별 요율 계상·검증 상세는 안전관리비 검증 보드에서 확인",
  };
}

// ── 법령 조문(도메인 ③ · 스냅샷 검색) ───────────────────────────────────────────

function lawArticleContext(message: string) {
  const hits = searchLawArticles(message);
  if (hits.length === 0) {
    return {
      안내:
        "스냅샷에서 해당 조문을 찾지 못했습니다. 조번호(예: 제560조)나 키워드(폭염·밀폐공간·강풍 등)로 다시 질문해 주세요. " +
        "전체 원문은 법제처(국가법령정보센터)에서 확인할 수 있습니다.",
    };
  }
  return {
    표시판: hits[0]!.표시판,
    법령명: hits[0]!.법령명,
    조문: hits.map((a) => ({ 조: a.조, 제목: a.제목, 개정이력: a.개정이력, 원문: a.내용 })),
    주의: LAW_SNAPSHOT_NOTICE,
  };
}

// ── 규칙 폴백 텍스트(결정적) ────────────────────────────────────────────────────

function fallbackFor(id: SiteChatIntentId, label: string, data: unknown): string {
  if (data === null || data === undefined) {
    return `${label} — 현재 조회할 수 없습니다. 관제 화면에서 직접 확인해 주세요.`;
  }
  const d = data as Record<string, unknown>;
  switch (id) {
    case "weather": {
      const evals = (d.판정 as ReturnType<typeof ruleEvalDto>[]) ?? [];
      const lines = evals.map((e) =>
        e.적용단계
          ? `· ${e.항목} ${e.현재값} — ${e.적용단계.라벨} (${e.적용단계.구속력}) · ${e.적용단계.조치}`
          : `· ${e.항목} ${e.현재값} — 정상 범위`,
      );
      return [`현장 기상 판정:`, ...lines].join("\n");
    }
    case "kmaWarning": {
      return `기상특보(${String(d.시도 ?? "현장")}): ${String(d.요약 ?? "정보 없음")} · 예비특보: ${String(d.예비특보요약 ?? "없음")}`;
    }
    case "typhoon": {
      const n = Number(d.발효태풍수 ?? 0);
      if (n === 0) return "현재 발효 중인 태풍이 없습니다.";
      const names = ((d.태풍 as { 이름?: string }[]) ?? []).map((t) => t.이름).join(", ");
      return `발효 태풍 ${n}개(${names}) — 진로·상세는 관제 화면의 태풍 탭에서 확인해 주세요.`;
    }
    case "disasterMsg":
      return `재난문자(${String(d.시도 ?? "현장")}): ${String(d.요약 ?? "발령 없음")}`;
    case "gas": {
      const g = d.감지기 as { 장비?: string; 상태?: string; 산소농도pct?: number } | null;
      const head = g
        ? `가스 감지기 ${g.장비} — 상태 ${g.상태} · 산소 ${g.산소농도pct}%`
        : "가스 감지기 미연결 또는 미수신";
      const notes = (d.환경안내 as string[]) ?? [];
      return [head, ...notes.map((x) => `· ${x}`)].join("\n");
    }
    case "aed":
      return `등록 AED ${Number(d.등록장비수 ?? 0)}대 — 배터리·교체 주기는 관제 화면 AED 패널에서 확인해 주세요.`;
    case "alertsLog": {
      const types = Object.entries((d.유형별건수 as Record<string, number>) ?? {})
        .map(([k, v]) => `${k} ${v}건`)
        .join(" · ");
      return `경보 이력(${String(d.표본 ?? "")}): ${types || "없음"} · 미확인 ${Number(d.미확인건수 ?? 0)}건`;
    }
    case "safetyLight": {
      const c = d.신호등 as { red?: number; yellow?: number; green?: number; total?: number };
      return `건설현장 안전 신호등 — 빨강 ${c?.red ?? "?"} · 노랑 ${c?.yellow ?? "?"} · 초록 ${c?.green ?? "?"} (전체 ${c?.total ?? "?"})`;
    }
    case "hospitals": {
      const list = (d.응급의료 as { 이름?: string; 거리km?: number }[]) ?? [];
      if (list.length === 0) return "인근 응급의료기관을 찾지 못했습니다. 관제 화면에서 확인해 주세요.";
      const lines = list.map((h) =>
        `· ${h.이름}${typeof h.거리km === "number" ? ` (${h.거리km.toFixed(1)}km)` : ""}`,
      );
      return ["인근 응급의료기관:", ...lines].join("\n");
    }
    case "procurePrice": {
      const hits = (d.단가 as { 품목명?: string; 단가원?: number; 공급가액원?: number }[]) ?? [];
      if (hits.length === 0) {
        return (
          String(d.안내 ?? "당일 피드에 해당 품명이 없습니다.") +
          "\n(단가 원천은 당일 거래·등록 피드라, 종합쇼핑몰 등록 품목이라도 오늘 거래가 없으면 조회되지 않습니다.)"
        );
      }
      const lines = hits.map(
        (h) => `· ${h.품목명} — 단가 ${h.단가원?.toLocaleString()}원 (공급가액 ${h.공급가액원?.toLocaleString()}원)`,
      );
      return [`조달 품목 단가(${String(d.출처 ?? "")}):`, ...lines].join("\n");
    }
    case "subsidyAudit": {
      const rows = (d.정합행 as { 지원품목?: string; 사업장?: string; 관측?: string }[]) ?? [];
      if (rows.length === 0) return "보조금 정합 행이 없습니다. 보조금 정합 보드에서 확인해 주세요.";
      const lines = rows.slice(0, 6).map((r) => `· ${r.지원품목} (${r.사업장}) — ${r.관측}`);
      return [`공단 보조금 정합(${String(d.출처 ?? "")}):`, ...lines].join("\n");
    }
    case "safetyRate": {
      const applied = d.적용고시 as { 이름?: string; 발령번호?: string; 시행일?: string } | undefined;
      return (
        `안전관리비 요율 고시 — 적용 중: ${applied?.이름 ?? "미상"} (${applied?.발령번호 ?? "?"} · 시행 ${applied?.시행일 ?? "?"})` +
        `${d.개정드리프트 ? " · ⚠ 법제처에 더 최신 고시 발령(대조 필요)" : " · 최신 상태"}`
      );
    }
    case "lawArticle": {
      const arts = (d.조문 as { 조?: string; 제목?: string; 원문?: string }[]) ?? [];
      if (arts.length === 0) return String(d.안내 ?? "해당 조문을 찾지 못했습니다.");
      const lines = arts.map((a) => `[${a.조}(${a.제목})]\n${a.원문}`);
      return [`${String(d.법령명 ?? "")} ${String(d.표시판 ?? "")}`, ...lines].join("\n\n");
    }
  }
}

const FETCHERS: Record<SiteChatIntentId, (opts: SiteChatBuildOptions) => Promise<unknown>> = {
  weather: (o) => weatherContext(o.origin),
  kmaWarning: () => kmaWarningContext(),
  typhoon: () => typhoonContext(),
  disasterMsg: () => disasterMsgContext(),
  gas: () => gasContext(),
  aed: () => aedContext(),
  alertsLog: () => alertsLogContext(),
  safetyLight: () => safetyLightContext(),
  hospitals: () => hospitalsContext(),
  procurePrice: (o) => procurePriceContext(o.message),
  subsidyAudit: (o) => subsidyAuditContext(o.origin, o.authHeader),
  safetyRate: () => safetyRateContext(),
  lawArticle: (o) => Promise.resolve(lawArticleContext(o.message)),
};

/** 영역 권한 거부 시의 결정적 안내 — LLM 미경유. */
const DENIED_TEXT: Partial<Record<SiteChatIntentId, string>> = {
  subsidyAudit:
    "이 계정에는 공단 보조금 검증 열람 권한이 없습니다. 필요하면 관리자에게 권한을 요청해 주세요.",
};

/** 매칭된 의도들의 컨텍스트를 병렬 수집 — 개별 실패는 그 의도만 '조회 불가'로 강등,
 *  영역 권한 거부는 denied 로 표시해 CLOVA 컨텍스트에서 제외한다(서버 트리밍). */
export async function buildSiteChatContexts(
  intents: readonly SiteChatIntentDef[],
  opts: SiteChatBuildOptions,
): Promise<SiteChatContextResult[]> {
  return Promise.all(
    intents.map(async (intent) => {
      let data: unknown = null;
      try {
        data = await FETCHERS[intent.id](opts);
      } catch (error) {
        console.warn(`[site-chat] ${intent.id} 컨텍스트 수집 실패:`, error);
        data = null;
      }
      if (data !== null && typeof data === "object" && (data as { denied?: boolean }).denied === true) {
        return {
          id: intent.id,
          label: intent.label,
          data: null,
          denied: true,
          fallbackText:
            DENIED_TEXT[intent.id] ??
            `${intent.label} — 이 계정에는 열람 권한이 없습니다. 관리자에게 권한을 요청해 주세요.`,
        };
      }
      return {
        id: intent.id,
        label: intent.label,
        data,
        fallbackText: fallbackFor(intent.id, intent.label, data),
      };
    }),
  );
}
