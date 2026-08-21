// 현장 안전 설비 모니터링 샘플 표 — 가스 누출 감지기 / 심장 제세동기(AED). 작업자 표와 동일 타입(세로 표).
// 실 센서 데이터 소스는 발표 후 연동. 현재는 가상 샘플 + 수동 스크롤만(자동 상하 슬라이딩 없음).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { BarChart, LineChart, SummaryCell } from "./VitalHistoryPanel";
import { AED_DEVICES, normalizeAedItems, type AedDevice, type AedItem } from "../../lib/aed-devices";
import { vbatToPercent } from "../../lib/gaspod-battery";
import {
  AED_SWAP_DUE_SOON_DAYS,
  aedCycleSev,
  battDaysSince,
  battDueDays,
  padDaysSince,
  padDueDays,
} from "../../lib/aed-status";
import { getSessionToken } from "./session-token";

export type Sev = "normal" | "caution" | "danger";

// 선택된 설비 메트릭(가스 측정값/제세동기 배터리) — 하단 추세 그래프용. 작업자 그래프와 동일 차트 재사용.
export type SiteMetric = {
  key: string;
  title: string;
  unit: string;
  color: string;
  value: number;
  decimals: number;
  kind: "gas" | "battery";
  threshold?: { value: number; label: string }; // 가스 임계값 — 그래프 기준선용.
};

const DOT: Record<Sev, string> = {
  normal: "bg-semantic-up",
  caution: "bg-orange-400/90 vital-blink-caution",
  danger: "bg-semantic-down vital-blink-danger",
};
const TONE: Record<Sev, string> = {
  normal: "text-semantic-up",
  caution: "text-orange-700/90 vital-blink-caution dark:text-orange-400/85",
  danger: "text-semantic-down vital-blink-danger",
};
const SEV_ROW_BG: Record<Sev, string> = {
  normal: "",
  // 다크모드 — 라이트 배경(orange-50/red-100)에 흰 글씨가 얹혀 가독성 저하. 어두운 틴트로 교정.
  // /8·/12 는 Tailwind 기본 opacity 스케일 밖이라 클래스 미생성 → 다크 변형이 무효였음. 스케일 내 /20 사용.
  caution: "bg-orange-50/90 dark:bg-amber-500/20",
  danger: "bg-red-100 dark:bg-red-500/20",
};

// 신호등 점 — 작업자 표와 동일(정상 정적 / 주의·위험 블링크).
function SignalDot({ sev }: { sev: Sev }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/10 dark:ring-white/20 ${DOT[sev]}`} />;
}

// 실 연동/데모 구분 배지 — 실 연동=실제 하드웨어(RPi) 폴링, 데모=발표용 샘플(하드웨어 미연동).
function KindBadge({ demo }: { demo: boolean }) {
  return demo ? (
    <span className="shrink-0 rounded-pill bg-surface-strong px-1.5 py-px text-[9px] font-medium text-muted dark:bg-surface-dark dark:text-on-dark-soft">
      데모
    </span>
  ) : (
    <span className="shrink-0 rounded-pill bg-emerald-500/15 px-1.5 py-px text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
      실 연동
    </span>
  );
}

// 제세동기 배터리 게이지 — 텍스트 % 대체용 원형 링(레퍼런스 Gauge 축약, 의존성 0).
// 36px 고정이라 행 높이(h-12=48px) 불변. 색=배터리 임계(≤20 위험/≤50 주의/그 외 정상).
function BatteryGauge({ pct }: { pct: number }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const color = v <= 20 ? "#dc2626" : v <= 50 ? "#f59e0b" : "#16a34a";
  const radius = 15.5;
  const circ = 2 * Math.PI * radius;
  const dash = (v / 100) * circ;
  return (
    <span
      className="relative inline-flex h-9 w-9 items-center justify-center"
      role="img"
      aria-label={`배터리 ${v}%`}
    >
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3.5"
          className="stroke-zinc-200 dark:stroke-white/10"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          stroke={color}
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <span className="absolute text-[9px] font-semibold tabular-nums" style={{ color }}>
        {v}
      </span>
    </span>
  );
}

// 공통 외곽 — 헤더(카운트·표기·액션) + 표 헤더 행 + 수동 스크롤 본문(자동 슬라이딩 없음).
function TableShell({
  count,
  header,
  children,
  minWidthClass = "min-w-[760px]",
  action,
  note,
  footer,
}: {
  count: number;
  header: React.ReactNode;
  children: React.ReactNode;
  minWidthClass?: string;
  action?: React.ReactNode; // 우측 액션(예: AED '+ 장비 등록' 버튼).
  note?: React.ReactNode; // 우측 표기(기본=샘플 안내).
  footer?: React.ReactNode; // 하단 고정 스트립(예: 가스 실시간 수집·DB 영속 누적).
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-4 py-2 dark:border-white/10">
        <span className="rounded-pill bg-surface-strong px-2 py-0.5 text-xs font-medium text-body dark:bg-surface-dark dark:text-on-dark-soft">
          {count}개소
        </span>
        <div className="flex items-center gap-2">
          {action}
          <span className="text-[11px] text-muted dark:text-on-dark-soft">
            {note ?? "샘플 · 자체 디바이스 연동 시 실시간 · 수동 스크롤"}
          </span>
        </div>
      </div>
      <div className="wx-cards-scroll min-h-0 flex-1 overflow-x-auto">
        <div className={`flex h-full ${minWidthClass} flex-col`}>
          {header}
          {/* 수동 스크롤 전용(오토 상하 슬라이딩 없음) */}
          <div className="wx-cards-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
      {footer && (
        <div className="shrink-0 border-t border-hairline bg-surface-soft dark:border-white/10 dark:bg-surface-dark-elevated">
          {footer}
        </div>
      )}
    </div>
  );
}

// ── 가스 누출 감지기 ──────────────────────────────────────────────
// 실기기(gaspod-01)는 O₂·CO·H₂S·온습압·배터리를 동시 측정 → 표(한 행=한 가스)엔 O₂/CO/H₂S 3행(실 연동)으로 상단 배치.
// 데모 프리셋은 '데모' 배지. 설치위치·가스종류는 권한있음(관리자)만 편집(오버라이드=gaspod_config, 서버 저장).
const GAS_GRID =
  "grid items-center gap-x-2 grid-cols-[1.5rem_minmax(8rem,1.5fr)_minmax(6rem,1fr)_5rem_6rem_4rem_3.5rem_5rem]";

// 데모 샘플 1행 형태(발표용 · 실 하드웨어 미연동).
type GasSample = {
  loc: string;
  gas: string;
  val: string;
  unit: string;
  thr: string;
  sev: Sev;
  recv: string;
};

const GAS_ROWS: GasSample[] = [
  { loc: "지하 1층 펌프실", gas: "CH₄ 메탄", val: "0.3", unit: "%LEL", thr: "≥5 %LEL", sev: "normal", recv: "5초 전" },
  { loc: "B2 집수정", gas: "H₂S 황화수소", val: "8", unit: "ppm", thr: "≥10 ppm", sev: "caution", recv: "4초 전" },
  { loc: "탱크 야드", gas: "CO 일산화탄소", val: "52", unit: "ppm", thr: "≥30 ppm", sev: "danger", recv: "6초 전" },
  { loc: "배관 트렌치", gas: "O₂ 산소", val: "20.9", unit: "%", thr: "<18 %", sev: "normal", recv: "5초 전" },
  { loc: "도장 작업장", gas: "VOC 휘발성유기", val: "120", unit: "ppm", thr: "≥200 ppm", sev: "caution", recv: "7초 전" },
  { loc: "보일러실", gas: "CH₄ 메탄", val: "0.1", unit: "%LEL", thr: "≥5 %LEL", sev: "normal", recv: "5초 전" },
  { loc: "폐수 처리조", gas: "H₂S 황화수소", val: "3", unit: "ppm", thr: "≥10 ppm", sev: "normal", recv: "5초 전" },
  { loc: "지하 전기실", gas: "CO 일산화탄소", val: "12", unit: "ppm", thr: "≥30 ppm", sev: "normal", recv: "5초 전" },
];

// 실기기(gaspod) 텔레메트리 1건 — GET /api/gaspod/telemetry latest.
type GaspodLatest = {
  device_id: string;
  o2: number;
  temp: number;
  humidity: number;
  pressure: number;
  mq7_raw: number;
  mq136_raw: number;
  vbat: number;
  state: string;
  acked: boolean;
  ts: string;
};

// 가스 표시 오버라이드(설치위치·가스종류) — GET /api/gaspod/config 응답.
type GasConfigOverride = { loc: string | null; gas: string | null };

// 표시·편집용 런타임 행 — 데모 샘플 + { key(오버라이드/편집), demo, latest(실기기 상세) }.
type GasRow = GasSample & { key: string; demo: boolean; latest?: GaspodLatest };

// 가스별 임계(raw ADC) — O₂ 경고19.2/위험18.5(%), MQ-7(CO) 경고150/위험350, MQ-136(H₂S) 경고1800/위험2200.
// O₂·H₂S는 펌웨어(gaspod_v4.ino)와 동일 · CO는 관제 표시 임계(펌웨어 500/1000보다 민감하게 조정).
function o2Sev(v: number): Sev {
  return v > 0 && v < 18.5 ? "danger" : v > 0 && v < 19.2 ? "caution" : "normal";
}
function mq7Sev(v: number): Sev {
  return v > 350 ? "danger" : v > 150 ? "caution" : "normal";
}
function mq136Sev(v: number): Sev {
  return v > 2200 ? "danger" : v > 1800 ? "caution" : "normal";
}

// 최근 수신 경과("N초 전"/"N분 전").
function recvAgo(ts: string): string {
  const s = Math.round((Date.now() - Date.parse(ts)) / 1000);
  if (Number.isNaN(s)) return "-";
  const c = Math.max(0, s);
  return c < 60 ? `${c}초 전` : `${Math.floor(c / 60)}분 전`;
}

// 데모 8행 → 런타임 행(key=demo:i) + 오버라이드 적용.
function demoGasRows(ov: Record<string, GasConfigOverride>): GasRow[] {
  return GAS_ROWS.map((r, i) => {
    const key = `demo:${i}`;
    const o = ov[key];
    return { ...r, key, demo: true, loc: o?.loc || r.loc, gas: o?.gas || r.gas };
  });
}

// 실기기 텔레메트리 1건 → O₂/CO/H₂S 3행(실 연동). sev=펌웨어 임계 실측 + 오버라이드 적용.
function realGasRows(l: GaspodLatest, ov: Record<string, GasConfigOverride>): GasRow[] {
  const recv = recvAgo(l.ts);
  const mk = (
    suffix: "o2" | "co" | "h2s",
    gas: string,
    val: string,
    unit: string,
    thr: string,
    sev: Sev,
  ): GasRow => {
    const key = `${l.device_id}:${suffix}`;
    const o = ov[key];
    return {
      key,
      loc: o?.loc || "현장 가스 감지기",
      gas: o?.gas || gas,
      val,
      unit,
      thr,
      sev,
      recv,
      demo: false,
      latest: l,
    };
  };
  return [
    mk("o2", "O₂ 산소", l.o2.toFixed(1), "%", "<18.5 %", o2Sev(l.o2)),
    mk("co", "CO 일산화탄소", String(l.mq7_raw), "raw", "≥350 raw", mq7Sev(l.mq7_raw)),
    mk("h2s", "H₂S 황화수소", String(l.mq136_raw), "raw", "≥2200 raw", mq136Sev(l.mq136_raw)),
  ];
}

function gasMetric(r: GasSample): SiteMetric {
  const value = Number(r.val);
  const thrMatch = r.thr.match(/[\d.]+/); // "≥5 %LEL" / "<18 %" → 숫자 추출
  const thrValue = thrMatch ? Number(thrMatch[0]) : NaN;
  return {
    key: `gas-${r.loc}`,
    title: `가스 측정값 — ${r.loc} · ${r.gas}`,
    unit: r.unit,
    color: "#f59e0b",
    value: Number.isFinite(value) ? value : 0,
    decimals: r.val.includes(".") ? 1 : 0,
    kind: "gas",
    threshold: Number.isFinite(thrValue) ? { value: thrValue, label: `임계 ${r.thr}` } : undefined,
  };
}

// 실기기 상세 팝업 — O₂·CO·H₂S 실측 + 온습도·기압·배터리·종합상태·최근수신. 실기기 행 측정값 클릭 시.
function GaspodDetailModal({ latest, onClose }: { latest: GaspodLatest; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const l = latest;
  const stateKo = l.state === "DANGER" ? "위험" : l.state === "WARNING" ? "주의" : "정상";
  const stateSev: Sev = l.state === "DANGER" ? "danger" : l.state === "WARNING" ? "caution" : "normal";
  const gasItems = [
    { label: "O₂ 산소", val: `${l.o2.toFixed(1)} %`, sev: o2Sev(l.o2) },
    { label: "CO 일산화탄소", val: `${l.mq7_raw} raw`, sev: mq7Sev(l.mq7_raw) },
    { label: "H₂S 황화수소", val: `${l.mq136_raw} raw`, sev: mq136Sev(l.mq136_raw) },
  ];
  const envItems = [
    { label: "온도", val: `${l.temp.toFixed(1)} ℃` },
    { label: "습도", val: `${Math.round(l.humidity)} %` },
    { label: "기압", val: `${l.pressure.toFixed(1)} hPa` },
    { label: "단말 배터리", val: `${l.vbat.toFixed(2)} V` },
  ];
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-hairline bg-canvas dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-hairline bg-surface-soft px-5 py-3 dark:border-white/10 dark:bg-surface-dark-elevated">
          <span className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink dark:text-on-dark">가스 감지기 상세</span>
            <KindBadge demo={false} />
          </span>
          <span className="text-xs text-muted dark:text-on-dark-soft">{l.device_id}</span>
        </div>
        <div className="px-5 py-4 text-sm text-ink dark:text-on-dark">
          <div className="mb-3 flex items-center justify-between rounded-lg border border-hairline px-3 py-2 dark:border-white/10">
            <span className="text-xs font-semibold text-body dark:text-on-dark-soft">종합 상태</span>
            <span className={`flex items-center gap-1.5 font-semibold ${TONE[stateSev]}`}>
              <SignalDot sev={stateSev} />
              {stateKo}
              {l.acked ? " · 현장 확인됨" : ""}
            </span>
          </div>
          <p className="mb-1.5 text-xs font-semibold text-body dark:text-on-dark-soft">가스 측정값</p>
          <ul className="mb-3 space-y-1.5">
            {gasItems.map((g) => (
              <li
                key={g.label}
                className="flex items-center justify-between rounded-lg border border-hairline px-3 py-1.5 text-xs dark:border-white/10"
              >
                <span className="flex items-center gap-1.5">
                  <SignalDot sev={g.sev} />
                  {g.label}
                </span>
                <span className={`font-mono font-semibold tabular-nums ${TONE[g.sev]}`}>{g.val}</span>
              </li>
            ))}
          </ul>
          <p className="mb-1.5 text-xs font-semibold text-body dark:text-on-dark-soft">환경 센서</p>
          <div className="grid grid-cols-2 gap-1.5">
            {envItems.map((e) => (
              <div
                key={e.label}
                className="flex items-center justify-between rounded-lg border border-hairline px-3 py-1.5 text-xs dark:border-white/10"
              >
                <span className="text-body dark:text-on-dark-soft">{e.label}</span>
                <span className="font-mono font-semibold tabular-nums">{e.val}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted dark:text-on-dark-soft">
            최근 수신 {recvAgo(l.ts)} · CO·H₂S는 무보정 원시값(raw ADC, ppm 아님) · 임계·종합상태는 기기 계산값
          </p>
        </div>
        <div className="flex justify-end border-t border-hairline px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-active"
          >
            확인
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// 가스 행 설정 편집(관리자 권한) — 설치위치·가스종류 수정. PUT /api/gaspod/config → 성공 시 캐시 갱신. ESC/배경 닫기.
function GasConfigEditModal({
  row,
  onClose,
  onSaved,
}: {
  row: GasRow;
  onClose: () => void;
  onSaved: (key: string, cfg: GasConfigOverride) => void;
}) {
  const [loc, setLoc] = useState(row.loc);
  const [gas, setGas] = useState(row.gas);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const t = getSessionToken();
      const res = await fetch("/api/gaspod/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ rowKey: row.key, loc, gas }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr(j.error || "저장 실패 — 관리자 권한을 확인하세요.");
        setSaving(false);
        return;
      }
      onSaved(row.key, { loc: loc.trim() || null, gas: gas.trim() || null });
    } catch {
      setErr("저장 실패 — 네트워크 오류.");
      setSaving(false);
    }
  };

  const fieldCls =
    "w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-primary dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark";
  const labelCls = "mb-1 block text-xs font-semibold text-body dark:text-on-dark-soft";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-hairline bg-canvas dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hairline bg-surface-soft px-5 py-3 dark:border-white/10 dark:bg-surface-dark-elevated">
          <span className="text-sm font-bold text-ink dark:text-on-dark">가스 감지기 설정 수정</span>
          <KindBadge demo={row.demo} />
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div>
            <label className={labelCls}>설치 위치</label>
            <input
              className={fieldCls}
              value={loc}
              maxLength={40}
              onChange={(e) => setLoc(e.target.value)}
              placeholder="예: 지하 1층 집수정"
            />
          </div>
          <div>
            <label className={labelCls}>가스 종류</label>
            <input
              className={fieldCls}
              value={gas}
              maxLength={30}
              onChange={(e) => setGas(e.target.value)}
              placeholder="예: H₂S 황화수소"
            />
          </div>
          {err && <p className="text-xs font-semibold text-semantic-down">{err}</p>}
          <p className="text-[11px] text-muted dark:text-on-dark-soft">
            빈 칸으로 저장하면 기본값으로 복귀합니다. 관리자 권한 계정만 저장됩니다.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-hairline px-4 py-1.5 text-sm font-semibold text-body hover:bg-surface-soft disabled:opacity-50 dark:border-white/10 dark:text-on-dark-soft dark:hover:bg-white/10"
          >
            취소
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-active disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function GasDetectorTable({
  onSelect,
  canManage = false,
}: {
  onSelect?: (m: SiteMetric) => void;
  canManage?: boolean;
}) {
  const [latest, setLatest] = useState<GaspodLatest | null>(null);
  const [count, setCount] = useState(0); // DB 영속 누적 수집 건수.
  const [overrides, setOverrides] = useState<Record<string, GasConfigOverride>>({});
  const [detail, setDetail] = useState<GaspodLatest | null>(null);
  const [editRow, setEditRow] = useState<GasRow | null>(null);
  const [, setTick] = useState(0); // recvAgo 표시 갱신용.

  // 실기기 텔레메트리 폴링(8초) — 최신 1건 + DB 누적 수집 건수. 없으면(미수신) 데모만 표시.
  useEffect(() => {
    let alive = true;
    const load = () => {
      // 세션 토큰 동봉 — GET 이 2026-08-21 봉인(P1-3)으로 세션 인증 뒤로 갔다.
      const t = getSessionToken();
      fetch("/api/gaspod/telemetry?n=1", {
        headers: t ? { Authorization: `Bearer ${t}` } : undefined,
      })
        .then((r) => r.json())
        .then((j: { ok?: boolean; latest?: GaspodLatest | null; count?: number }) => {
          if (!alive) return;
          setLatest(j.ok && j.latest ? j.latest : null);
          if (typeof j.count === "number") setCount(j.count);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // 설치위치·가스종류 오버라이드 폴링(60초) — 로그인 세션 필요.
  useEffect(() => {
    let alive = true;
    const load = () => {
      const t = getSessionToken();
      const hdr = t ? { headers: { Authorization: `Bearer ${t}` } } : undefined;
      fetch("/api/gaspod/config", hdr)
        .then((r) => r.json())
        .then((j: { ok?: boolean; configs?: Record<string, GasConfigOverride> }) => {
          if (alive && j.ok && j.configs) setOverrides(j.configs);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // "N초 전" 표시 갱신(10초).
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(id);
  }, []);

  const rows: GasRow[] = [...(latest ? realGasRows(latest, overrides) : []), ...demoGasRows(overrides)];
  const realCount = latest ? 3 : 0;

  const header = (
    <div className={`${GAS_GRID} shrink-0 border-b border-hairline bg-surface-soft px-3 py-2 text-[11px] font-semibold text-muted dark:border-white/10 dark:bg-surface-dark dark:text-on-dark-soft`}>
      <div />
      <div>설치 위치</div>
      <div>가스 종류</div>
      <div className="text-center">측정값</div>
      <div className="text-center">임계</div>
      <div className="text-center">상태</div>
      <div className="text-center">단말</div>
      <div className="text-center">최근수신</div>
    </div>
  );
  return (
    <TableShell
      count={rows.length}
      header={header}
      minWidthClass="min-w-[840px]"
      note={`실 연동 ${realCount} · 데모 ${GAS_ROWS.length} · 수동 스크롤`}
      footer={
        <div className="flex items-center justify-between gap-2 px-4 py-1.5 text-[11px]">
          <span className="flex items-center gap-1.5 font-medium text-body dark:text-on-dark-soft">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${latest ? "bg-semantic-up animate-pulse" : "bg-zinc-400"}`}
            />
            실기기 실시간 수집{latest ? ` · 최근 ${recvAgo(latest.ts)}` : " · 수신 대기"}
          </span>
          <span className="tabular-nums text-muted dark:text-on-dark-soft">
            가스 누적 <b className="text-body dark:text-on-dark">{count.toLocaleString()}</b>건 · DB 영속
          </span>
        </div>
      }
    >
      {rows.map((r) => (
        <div
          key={r.key}
          className={`${GAS_GRID} h-12 border-b border-hairline px-3 text-xs text-ink dark:border-white/5 dark:text-on-dark ${SEV_ROW_BG[r.sev]}`}
        >
          <div className="flex justify-center">
            <SignalDot sev={r.sev} />
          </div>
          <div className="flex min-w-0 items-center gap-1">
            {canManage ? (
              <button
                type="button"
                onClick={() => setEditRow(r)}
                title="클릭 → 설치위치·가스종류 수정 (관리자 권한)"
                className="truncate text-left font-medium hover:text-primary hover:underline"
              >
                {r.loc}
              </button>
            ) : (
              <div className="truncate font-medium">{r.loc}</div>
            )}
            <KindBadge demo={r.demo} />
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={() => setEditRow(r)}
              title="클릭 → 설치위치·가스종류 수정 (관리자 권한)"
              className="truncate text-left text-body hover:text-primary hover:underline dark:text-on-dark-soft"
            >
              {r.gas}
            </button>
          ) : (
            <div className="truncate text-body dark:text-on-dark-soft">{r.gas}</div>
          )}
          <button
            type="button"
            onClick={() => (r.demo ? onSelect?.(gasMetric(r)) : r.latest && setDetail(r.latest))}
            title={r.demo ? "클릭 → 측정값 추세 그래프" : "클릭 → 실기기 상세(온습도·기압·배터리·종합상태)"}
            className="mx-auto rounded px-1 text-center font-mono font-semibold tabular-nums hover:bg-primary-subtle hover:underline"
          >
            {r.val}
            <span className="ml-0.5 text-[10px] font-normal text-muted">{r.unit}</span>
          </button>
          <div className="text-center font-mono text-[11px] text-muted dark:text-on-dark-soft">{r.thr}</div>
          <div className={`text-center font-semibold ${TONE[r.sev]}`}>
            {r.sev === "normal" ? "정상" : r.sev === "caution" ? "주의" : "위험"}
          </div>
          <div className="flex justify-center" title={r.latest ? `단말 배터리 ${r.latest.vbat.toFixed(2)} V` : undefined}>
            {r.latest ? (
              <BatteryGauge pct={vbatToPercent(r.latest.vbat)} />
            ) : (
              <span className="text-[11px] text-muted dark:text-on-dark-soft">—</span>
            )}
          </div>
          <div className="text-center text-[11px] text-muted dark:text-on-dark-soft">{r.recv}</div>
        </div>
      ))}
      {detail && <GaspodDetailModal latest={detail} onClose={() => setDetail(null)} />}
      {editRow && (
        <GasConfigEditModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={(key, cfg) => {
            setOverrides((prev) => ({ ...prev, [key]: cfg }));
            setEditRow(null);
          }}
        />
      )}
    </TableShell>
  );
}

// ── 심장 제세동기(AED) 알림 ──────────────────────────────────────
// 현실 모델: AED 본체 배터리·전극패드는 실시간 상태 측정 불가 → 제조사 권장 "교환 주기"로만 관리(임박/경과 알림).
// 실시간 배터리(%)는 'AED 알림 단말'(우리 IoT 장비) 자체 배터리 → "배터리 부족" 알림은 단말 한정.
// 갱신은 관제 센터가 아니라 현장: 관리자(여러 명)가 배터리·패드 교체·점검 후 장비의 'NFC 태그를 폰으로 태깅'하면
//   점검 페이지가 열리고(점검자·항목 입력) 관제 웹으로 전송됨 → 이력 기록·최근 교환 갱신. 관제 웹은 '표시만'.
// 「응급의료에 관한 법률」 제47조의2(설치·관리)·제62조(미설치 과태료)·시행규칙 제38조의3(관리책임자·월1회 점검·결과 통보).
const AED_GRID =
  "grid items-center gap-x-2 grid-cols-[1.5rem_minmax(7.5rem,1.3fr)_minmax(5.5rem,0.9fr)_4.5rem_5.5rem_5.5rem_5.5rem_7.5rem]";

// 표시·계산용 런타임 행 — 장비 레지스트리(AED_DEVICES) + 병합 이력. history = DB 점검(NFC) + seed.
type AedHistRecord = { daysAgo: number; items: AedItem[]; by: string; ts?: string };
type AedRow = {
  id: string;
  loc: string;
  manager: string;
  product: string | null; // 관제웹 편집 제품명(모델) — 오버라이드 없으면 null.
  note: string | null; // 관제웹 편집 비고(관련 내용) — 오버라이드 없으면 null.
  devBatt: number; // 알림 단말 배터리 %(실시간 — "배터리 부족"은 이것만)
  battCycleMonths: number;
  padCycleMonths: number;
  history: AedHistRecord[]; // 최신(작은 경과일) 먼저. 최근 배터리/패드 교체일이 교환 주기 기준.
  demo: boolean; // true=데모 프리셋 · false=실 연동(등록 장비 또는 real 프리셋).
  registered: boolean; // true=관리자 등록 장비(aed_registered_device·해제 가능) · false=코드 프리셋(데모 또는 real 프리셋·설정 편집 가능).
};

// AED 설정 오버라이드(설치위치·관리책임자·제품명·비고) — /api/aed/config 응답 1건.
type AedConfigOverride = { loc: string | null; manager: string | null; product: string | null; note: string | null };

// GET /api/aed/inspections 응답 1건.
type AedInspectionDTO = { aed_id: string; inspector: string; items: string | null; ts: string };

// 등록 실 연동 장비 — GET /api/aed/devices 응답 1건.
type RegisteredAedDeviceDTO = {
  aedId: string;
  loc: string;
  product: string | null;
  manager: string;
  devBatt: number;
  battCycleMonths: number;
  padCycleMonths: number;
  lastSwapTs: string | null;
  registeredAt: string;
};

// 폴링으로 채워지는 점검 기록 캐시 — aedDetail(통합 신호등)과 표가 공유. SSR/첫 렌더엔 빈 배열(하이드레이션 안전).
let aedInspectionsCache: AedInspectionDTO[] = [];
// 관제웹 설정 오버라이드 캐시(aedId → 설치위치·관리책임자·비고). 표·통합 신호등이 레지스트리 기본값보다 우선 적용.
let aedConfigCache: Record<string, AedConfigOverride> = {};
// 등록 실 연동 장비 캐시 — 관리자가 등록한 실제 장비(데모 프리셋과 별개). GET /api/aed/devices 로 채움.
let aedRegisteredCache: RegisteredAedDeviceDTO[] = [];
// 폴링 소유권 가드 — 다중 AedAlertTable 인스턴스가 동시에 모듈 캐시를 덮어쓰지 않도록 한 번에 한 인스턴스만 폴링.
let aedPollingOwned = false;

function tsToDaysAgo(ts: string): number {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// 장비 + 점검 기록 → 런타임 행. 이력 = DB 점검(NFC 태깅) + seed, 최신 먼저.
function buildAedRow(d: AedDevice, inspections: AedInspectionDTO[]): AedRow {
  const scanned: AedHistRecord[] = inspections
    .filter((i) => i.aed_id === d.id)
    .map((i) => ({ daysAgo: tsToDaysAgo(i.ts), items: normalizeAedItems(i.items), by: i.inspector, ts: i.ts }));
  const seed: AedHistRecord[] = d.seedHistory.map((s) => ({ daysAgo: s.daysAgo, items: s.items, by: s.by }));
  const history = [...scanned, ...seed].sort((a, b) => a.daysAgo - b.daysAgo);
  const cfg = aedConfigCache[d.id];
  return {
    id: d.id,
    loc: cfg?.loc || d.loc, // 오버라이드 있으면 우선, 빈/없음이면 레지스트리 기본값.
    manager: cfg?.manager || d.manager,
    product: cfg?.product ?? d.product ?? null, // 오버라이드 > 프리셋 product(실 장치) > 없음.
    note: cfg?.note ?? null,
    devBatt: d.devBatt,
    battCycleMonths: d.battCycleMonths,
    padCycleMonths: d.padCycleMonths,
    history,
    demo: !d.real, // real 프리셋(실 장치)은 '실 연동', 나머지는 '데모'.
    registered: false, // 코드 프리셋 — 설정 편집 가능(해제 대상 아님).
  };
}

// 등록 실 연동 장비 → 런타임 행. 이력 = NFC 점검(DB) + 최근 교환일(없으면 등록일) 신품 seed, 최신 먼저.
function buildRegisteredAedRow(d: RegisteredAedDeviceDTO): AedRow {
  const scanned: AedHistRecord[] = aedInspectionsCache
    .filter((i) => i.aed_id === d.aedId)
    .map((i) => ({ daysAgo: tsToDaysAgo(i.ts), items: normalizeAedItems(i.items), by: i.inspector, ts: i.ts }));
  const baseTs = d.lastSwapTs ?? d.registeredAt;
  const seed: AedHistRecord[] = [{ daysAgo: tsToDaysAgo(baseTs), items: ["battery", "pad"] as AedItem[], by: "등록" }];
  const history = [...scanned, ...seed].sort((a, b) => a.daysAgo - b.daysAgo);
  return {
    id: d.aedId,
    loc: d.loc,
    manager: d.manager,
    product: d.product,
    note: null,
    devBatt: d.devBatt,
    battCycleMonths: d.battCycleMonths,
    padCycleMonths: d.padCycleMonths,
    history,
    demo: false,
    registered: true, // 관리자 등록 장비 — 해제 가능(설정 편집 대상 아님).
  };
}

// 실 연동 장비(등록순, 상단) + 데모 프리셋. 통합 신호등·표가 공유.
function buildAedRows(): AedRow[] {
  const real = aedRegisteredCache.map(buildRegisteredAedRow);
  const demo = AED_DEVICES.map((d) => buildAedRow(d, aedInspectionsCache));
  return [...real, ...demo];
}

// ── 통합 안전 신호등용 상세(worst-of + 도메인 안내) ───────────────
const SEV_RANK: Record<Sev, number> = { normal: 0, caution: 1, danger: 2 };
const SEV_KO: Record<Sev, string> = { normal: "정상", caution: "주의", danger: "위험" };

function worstSev(sevs: Sev[]): Sev {
  return sevs.reduce<Sev>((acc, s) => (SEV_RANK[s] > SEV_RANK[acc] ? s : acc), "normal");
}

// 통합 신호등 상세 팝업 본문 구조(클릭 시 표시).
export type LampDetail = { title: string; lines: { label: string; text: string }[]; location: string; note?: string };
// 보드 2줄(summary + short) + 상세(detail).
export type CategorySignal = { sev: Sev; summary: string; short: string; detail: LampDetail };

// 가스 종류별 작업자 영향 · 노출 기준(참고) · 권장 대응(골든타임). 수치는 KOSHA/NIOSH 참고값(법적 단정 아님).
const GAS_INFO: Record<string, { name: string; effect: string; exposure: string; action: string; short: string }> = {
  "CH₄": {
    name: "메탄(CH₄)",
    effect: "단순 질식제이자 폭발성 가스. 고농도 시 산소를 밀어내 질식 위험.",
    exposure: "폭발하한 LEL 5%vol · 표시값 %LEL 은 LEL 대비 비율 (참고)",
    action: "즉시 환기 + 화기 엄금. 25%LEL 이상 시 작업 중지·대피.",
    short: "폭발성·질식 위험 — 화기 엄금·즉시 환기",
  },
  "H₂S": {
    name: "황화수소(H₂S)",
    effect: "썩은 달걀 냄새(고농도 시 후각 마비). 점막 자극, 고농도 의식상실·호흡정지.",
    exposure: "TWA 10ppm · STEL 15ppm · IDLH 100ppm (참고)",
    action: "즉시 대피·환기. 100ppm↑ 단독 진입 금지, 의식저하 시 119.",
    short: "고농도 후각마비·호흡정지 — 즉시 대피",
  },
  "CO": {
    name: "일산화탄소(CO)",
    effect: "무색·무취. 헤모글로빈과 결합해 산소 운반을 방해. 50ppm↑ 두통·어지러움, 800ppm↑ 의식상실.",
    exposure: "TWA 30ppm(8h) · STEL 200ppm · IDLH 1200ppm (참고)",
    action: "강제 환기 + 작업자 대피, 고농도 구역 진입 금지. 증상자 신선한 공기 후 119 (저산소 뇌손상 4~6분 내 시작).",
    short: "산소운반 방해 — 두통·어지러움, 즉시 환기·대피",
  },
  "O₂": {
    name: "산소(O₂)",
    effect: "18% 미만 산소결핍(판단력 저하·의식상실), 23.5% 초과 화재·폭발 위험.",
    exposure: "적정 19.5~23.5% · 18%↓ 산소결핍 위험작업 (참고)",
    action: "18% 미만 즉시 대피·환기. 밀폐공간 진입 전 농도 측정·송기마스크.",
    short: "산소결핍/과잉 — 18%↓ 즉시 대피",
  },
  "VOC": {
    name: "휘발성유기화합물(VOC)",
    effect: "두통·현기증·점막 자극, 고농도 마취작용·의식저하. 일부 발암성·인화성.",
    exposure: "물질별 상이 · 화기 엄금 (참고)",
    action: "국소배기·환기 강화, 방독마스크 착용, 화기 엄금.",
    short: "마취작용·인화성 — 환기·방독마스크",
  },
};

// 가스 감지기 worst-of + 상세. 현재는 가상 샘플 기준(발표 후 실센서).
export function gasDetail(): CategorySignal {
  const sev = worstSev(GAS_ROWS.map((r) => r.sev));
  if (sev === "normal") {
    return {
      sev,
      summary: `정상 ${GAS_ROWS.length}개소`,
      short: "전 구역 기준치 이내",
      detail: { title: "가스 누출 감지기 정상", location: "전 구역", lines: [{ label: "상태", text: `${GAS_ROWS.length}개소 전부 기준치 이내` }] },
    };
  }
  const row = GAS_ROWS.find((r) => r.sev === sev) ?? GAS_ROWS[0]!;
  const sym = row.gas.split(" ")[0] ?? row.gas;
  const info = GAS_INFO[sym];
  return {
    sev,
    summary: `${sym} ${row.val}${row.unit} · ${row.loc}`,
    short: info?.short ?? `${SEV_KO[sev]} — 즉시 확인`,
    detail: {
      title: `가스 ${SEV_KO[sev]} — ${info?.name ?? sym}`,
      location: `${row.loc} · 최근 수신 ${row.recv}`,
      lines: [
        { label: "측정", text: `${row.val}${row.unit} · 임계 ${row.thr} ${sev === "danger" ? "초과" : "근접"}` },
        ...(info
          ? [
              { label: "작업자 영향", text: info.effect },
              { label: "노출 기준", text: info.exposure },
              { label: "권장 대응(골든타임)", text: info.action },
            ]
          : []),
      ],
      note: "노출 기준은 KOSHA/NIOSH 참고값 · 법적 단정 아님",
    },
  };
}

// ── AED 관리 임계·교환 주기 — 심각도 계산은 lib/aed-status(임계 단일 소스, 물리 알림 엔드포인트와 공유) ──
function fmtYMD(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}
function dateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return fmtYMD(d);
}

// 최근 교환(점검)일 = 가장 최근 이력.
function aedLastSwap(r: AedRow): { date: string; daysAgo: number } {
  const all = r.history.map((h) => h.daysAgo);
  const daysAgo = all.length ? Math.min(...all) : 0;
  return { date: dateDaysAgo(daysAgo), daysAgo };
}
// 교환 셀 짧은 표기.
function dueShort(dueDays: number): string {
  if (dueDays < 0) return `경과 ${-dueDays}일`;
  if (dueDays <= AED_SWAP_DUE_SOON_DAYS) return `임박 D-${dueDays}`;
  return `~${Math.round(dueDays / 30)}개월`;
}

type AedDim = "device" | "battery" | "pad";
type AedIssue = { dim: AedDim; sev: Sev; label: string; text: string; basis?: string };

// 관리 차원별 비정상 항목 + 근거. 정상이면 빈 배열.
function aedIssues(r: AedRow): AedIssue[] {
  const out: AedIssue[] = [];
  const bDue = battDueDays(r);
  const bs = aedCycleSev(bDue);
  if (bs !== "normal") {
    out.push({
      dim: "battery",
      sev: bs,
      label: bs === "danger" ? "AED 배터리 교환 필요" : "AED 배터리 교환 임박",
      text:
        bDue < 0
          ? `교환 주기 ${-bDue}일 경과 (권장 ${r.battCycleMonths}개월 · 최근 교환 ${dateDaysAgo(battDaysSince(r))})`
          : `교환까지 ${bDue}일 (권장 주기 ${r.battCycleMonths}개월)`,
      basis: "AED 본체 배터리는 실시간 상태 확인 불가 → 제조사 권장 교환 주기로 관리",
    });
  }
  const pDue = padDueDays(r);
  const ps = aedCycleSev(pDue);
  if (ps !== "normal") {
    out.push({
      dim: "pad",
      sev: ps,
      label: ps === "danger" ? "전극패드 교환 필요" : "전극패드 교환 임박",
      text:
        pDue < 0
          ? `교환 주기 ${-pDue}일 경과 (권장 ${r.padCycleMonths}개월 · 최근 교환 ${dateDaysAgo(padDaysSince(r))})`
          : `교환까지 ${pDue}일 (권장 주기 ${r.padCycleMonths}개월)`,
      basis: "전극패드 유효기간 경과 시 점착력·전도 저하 → 제세동 정확도 하락",
    });
  }
  return out;
}

const AED_DIM_ORDER: Record<AedDim, number> = { battery: 0, pad: 1, device: 2 };

// 행 종합 상태 — worst-of(단말 배터리·AED 배터리 교환·패드 교환). 헤드라인은 가장 심각한 차원(동률 시 AED 가용성 우선).
function aedStatus(r: AedRow): { sev: Sev; label: string; issues: AedIssue[] } {
  const issues = aedIssues(r);
  if (issues.length === 0) return { sev: "normal", label: "정상", issues };
  const headline = [...issues].sort(
    (a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || AED_DIM_ORDER[a.dim] - AED_DIM_ORDER[b.dim],
  )[0]!;
  return { sev: worstSev(issues.map((i) => i.sev)), label: headline.label, issues };
}

// AED worst-of + 통합 신호등 상세. 관리 차원·관리책임자·교환 안내·법적 근거 포함. 현재는 가상 샘플 기준.
export function aedDetail(): CategorySignal {
  const statuses = buildAedRows().map((r) => ({ r, s: aedStatus(r) }));
  const sev = worstSev(statuses.map((x) => x.s.sev));
  if (sev === "normal") {
    return {
      sev,
      summary: `정상 ${statuses.length}대`,
      short: "AED 배터리·패드 교환주기 모두 정상",
      detail: {
        title: "자동심장충격기(AED) 정상",
        location: "전 구역",
        lines: [
          { label: "관리 상태", text: `${statuses.length}대 전부 AED 배터리·전극패드 교환 주기 이내` },
          { label: "법적 근거", text: "「응급의료에 관한 법률」 제47조의2 · 시행규칙 제38조의3(관리책임자·월1회 점검·결과 통보)" },
        ],
        note: "AED 본체 배터리·패드는 실시간 확인 불가 → 권장 교환 주기로 관리 · 현장 단말 교체·점검 시 이력 자동 기록",
      },
    };
  }
  const { r, s } = statuses.find((x) => x.s.sev === sev) ?? statuses[0]!;
  const last = aedLastSwap(r);
  const lines: { label: string; text: string }[] = s.issues.map((i) => ({
    label: i.label,
    text: i.basis ? `${i.text} · ${i.basis}` : i.text,
  }));
  lines.push({ label: "관리책임자", text: `${r.manager} · 최근 교환/점검 ${last.date} (${last.daysAgo}일 경과)` });
  lines.push({
    label: "권장 대응",
    text:
      sev === "danger"
        ? "현장에서 즉시 조치(AED 배터리/패드 교체). 현장 단말 리셋 시 이력 기록·최근 교환 갱신 · 관할 지자체 통보."
        : "교환 임박분 사전 확보·교체. 현장 단말 리셋 시 교체 이력 기록·주기 재카운팅.",
  });
  return {
    sev,
    summary: `${s.label} · ${r.loc}`,
    short: s.issues.length > 1 ? `${s.label} 외 ${s.issues.length - 1}건 · ${r.loc}` : `${s.label} · ${r.loc}`,
    detail: {
      title: `AED ${SEV_KO[sev]} — ${r.loc}`,
      location: `${r.loc} · 관리책임자 ${r.manager}`,
      lines,
      note: "AED 배터리·패드는 권장 교환 주기 기준(실시간 측정 불가) · 교환·점검은 현장 NFC 태깅으로 기록",
    },
  };
}

// 교환 셀 정적 색(블링크 없음 — 표 가독성). 신호등 점·상태 칩이 블링크를 담당.
function cycleStaticTone(sev: Sev): string {
  return sev === "danger"
    ? "text-semantic-down"
    : sev === "caution"
      ? "text-amber-600 dark:text-amber-300"
      : "text-muted dark:text-on-dark-soft";
}

const SWAP_ITEM_KO: Record<"battery" | "pad", string> = { battery: "배터리", pad: "전극패드" };

// 장비 NFC 점검 모달 — NFC 태그(점검 URL) 발급/쓰기 + 교체·점검 이력(표시 전용). ESC/배경 닫기.
function AedDeviceModal({ row, onClose }: { row: AedRow; onClose: () => void }) {
  const [nfcMsg, setNfcMsg] = useState("");
  const [url, setUrl] = useState("");
  const [nfcSupported, setNfcSupported] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setNfcSupported("NDEFReader" in window);
    const base = `${window.location.origin}/aed/inspect?id=${encodeURIComponent(row.id)}`;
    setUrl(base);
    let active = true;
    // 관리자(로그인 상태)만 서명을 발급받아 태그 URL 에 ?sig= 를 붙인다 → 서명된 태그에서 온 제출만 수락.
    (async () => {
      try {
        const token = getSessionToken();
        const res = await fetch(`/api/aed/inspect?aedId=${encodeURIComponent(row.id)}`, {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
        });
        const j = (await res.json()) as { ok?: boolean; sig?: string };
        if (active && res.ok && j.sig) setUrl(`${base}&sig=${encodeURIComponent(j.sig)}`);
      } catch {
        /* 서명 발급 실패 시 base URL 유지(제출은 서버에서 401 처리) */
      }
    })();
    return () => {
      active = false;
    };
  }, [row.id]);

  const writeNfc = async () => {
    if (!("NDEFReader" in window)) {
      setNfcMsg("이 브라우저는 Web NFC 미지원 — Android Chrome에서 쓰거나 위 URL을 NFC 쓰기 앱으로 태그에 기록하세요.");
      return;
    }
    try {
      setNfcMsg("빈 NFC 태그를 폰 뒷면에 대세요…");
      const Reader = (window as unknown as { NDEFReader: new () => { write: (m: unknown) => Promise<void> } }).NDEFReader;
      await new Reader().write({ records: [{ recordType: "url", data: url }] });
      setNfcMsg("NFC 태그에 점검 URL을 기록했습니다. 해당 AED에 부착하세요.");
    } catch (e) {
      setNfcMsg(`쓰기 실패: ${e instanceof Error ? e.message : "오류"}`);
    }
  };

  const last = aedLastSwap(row);
  const records = [...row.history].sort((a, b) => a.daysAgo - b.daysAgo); // 최신(작은 경과일) 먼저
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="wx-cards-scroll max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface-soft px-5 py-3 dark:bg-surface-dark-elevated">
          <span className="text-sm font-bold text-ink dark:text-on-dark">AED 점검 관리 — {row.loc}</span>
          <div className="text-[11px] text-muted dark:text-on-dark-soft">장비 {row.id} · 관리책임자 {row.manager}</div>
        </div>
        <div className="px-5 py-4 text-sm text-ink dark:text-on-dark">
          <div className="mb-4 rounded-lg border border-hairline px-3 py-3 dark:border-white/10">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink dark:text-on-dark">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-primary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12a7 7 0 0 1 14 0" />
                <path d="M8.5 12a3.5 3.5 0 0 1 7 0" />
                <circle cx="12" cy="12" r="1" />
              </svg>
              NFC 점검 태그
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-body dark:text-on-dark-soft">
              현장 AED에 부착 · 관리자(여러 명)가 폰을 태깅하면 점검 기록 페이지가 열립니다.
            </p>
            <div className="mb-2 break-all rounded bg-surface-soft px-2 py-1.5 font-mono text-[10px] text-body dark:bg-surface-dark-elevated dark:text-on-dark-soft">
              {url}
            </div>
            <button
              type="button"
              onClick={writeNfc}
              className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary hover:bg-primary-active"
            >
              NFC 태그에 쓰기
            </button>
            {!nfcSupported && (
              <p className="mt-1.5 text-[10px] text-muted dark:text-on-dark-soft">
                ※ Web NFC 쓰기는 Android Chrome 전용. 그 외 기기는 위 URL을 NFC 쓰기 앱으로 태그에 기록하세요.
              </p>
            )}
            {nfcMsg && <p className="mt-1.5 text-[11px] text-body dark:text-on-dark-soft">{nfcMsg}</p>}
          </div>

          <p className="mb-2 text-xs font-semibold text-ink dark:text-on-dark">
            교체·점검 이력{" "}
            <span className="font-normal text-muted dark:text-on-dark-soft">· 최근 {last.date} ({last.daysAgo}일 경과)</span>
          </p>
          <ul className="space-y-2">
            {records.map((rec, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-xs dark:border-white/10"
              >
                <span className="w-20 shrink-0 font-mono text-body dark:text-on-dark-soft">{dateDaysAgo(rec.daysAgo)}</span>
                <span className="flex flex-1 flex-wrap gap-1">
                  {rec.items.length === 0 ? (
                    <span className="rounded-pill bg-surface-strong px-1.5 py-0.5 text-[10px] font-medium text-body dark:bg-surface-dark dark:text-on-dark-soft">
                      점검(교체 없음)
                    </span>
                  ) : (
                    rec.items.map((it) => (
                      <span
                        key={it}
                        className="rounded-pill bg-surface-strong px-1.5 py-0.5 text-[10px] font-medium text-body dark:bg-surface-dark dark:text-on-dark-soft"
                      >
                        {SWAP_ITEM_KO[it]} 교체
                      </span>
                    ))
                  )}
                </span>
                <span className="shrink-0 text-[11px] text-muted dark:text-on-dark-soft">점검 {rec.by}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg bg-surface-soft px-3 py-2 text-[11px] leading-relaxed text-muted dark:bg-surface-dark-elevated dark:text-on-dark-soft">
            점검·교체 시각은 현장 NFC 태깅(점검 페이지 전송) 시 기록됩니다. 관제 센터는 이력을 표시만 하며 직접 수정·갱신하지
            않습니다.
          </div>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-hairline bg-canvas px-5 py-3 dark:border-white/10 dark:bg-surface-dark">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-active"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

// AED 관리 알림 모달 — 발생한 모든 관리 항목(단말 배터리·AED 배터리·패드 교환) + 관리책임자 + 교환·법적 근거. ESC/배경 닫기.
function AedManagementModal({
  row,
  status,
  onClose,
}: {
  row: AedRow;
  status: ReturnType<typeof aedStatus>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isDanger = status.sev === "danger";
  const accent = isDanger ? "border-semantic-down" : "border-amber-500";
  const headBg = isDanger ? "bg-semantic-down/15" : "bg-amber-500/15";
  const headText = isDanger ? "text-semantic-down" : "text-amber-600 dark:text-amber-300";
  const headDot = isDanger ? "bg-semantic-down vital-blink-danger" : "bg-amber-500 vital-blink-caution";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border-2 ${accent} bg-canvas dark:bg-surface-dark`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center gap-2 px-5 py-3 ${headBg}`}>
          <span className={`inline-block h-3 w-3 shrink-0 rounded-full ${headDot}`} />
          <span className={`text-sm font-bold ${headText}`}>제세동기(AED) 관리 알림 — {status.label}</span>
        </div>
        <div className="px-5 py-4 text-sm text-ink dark:text-on-dark">
          <p className="mb-3 leading-relaxed">
            <span className="font-semibold">{row.loc}</span> · 관리책임자{" "}
            <span className="font-semibold">{row.manager}</span>
            {row.note ? (
              <span className="mt-1 block text-xs text-muted dark:text-on-dark-soft">비고: {row.note}</span>
            ) : null}
          </p>
          <ul className="mb-3 space-y-2">
            {status.issues.map((i) => (
              <li key={i.dim} className="rounded-lg border border-hairline px-3 py-2 dark:border-white/10">
                <div className={`mb-0.5 flex items-center gap-1.5 text-xs font-semibold ${TONE[i.sev]}`}>
                  <span className={`inline-block h-2 w-2 rounded-full ${DOT[i.sev]}`} />
                  {i.label}
                </div>
                <div className="text-xs leading-relaxed text-body dark:text-on-dark-soft">{i.text}</div>
                {i.basis && (
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted dark:text-on-dark-soft">└ {i.basis}</div>
                )}
              </li>
            ))}
          </ul>
          <div className="rounded-lg bg-surface-soft px-3 py-2 text-[11px] leading-relaxed text-body dark:bg-surface-dark-elevated dark:text-on-dark-soft">
            <div className="mb-1 font-semibold text-ink dark:text-on-dark">관리 의무 (법적 근거)</div>
            <ul className="space-y-0.5">
              <li>· 관리책임자 지정 + <b>월 1회 이상 점검</b> 및 결과 관할 지자체 통보 (시행규칙 제38조의3)</li>
              <li>· 공개된 장소의 전용 보관함 보관 · 도난방지 설비 · 즉시 개방 가능 상태</li>
              <li>· 사용·이전·폐기 등 변경 시 신고 / 미점검·표지 미부착 시 과태료 대상</li>
            </ul>
          </div>
          <div className="mt-2 text-[11px] text-muted dark:text-on-dark-soft">
            AED 배터리 {dueShort(battDueDays(row))}(주기 {row.battCycleMonths}개월) · 패드{" "}
            {dueShort(padDueDays(row))}(주기 {row.padCycleMonths}개월) · 최근 교환 {aedLastSwap(row).date}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-active ${
              isDanger ? "bg-semantic-down" : "bg-amber-500"
            }`}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

// AED 설정 편집 모달(관리자 권한) — 설치위치·제품명·관리책임자·비고 수정. PUT /api/aed/config → 성공 시 캐시 갱신. ESC/배경 닫기.
function AedConfigEditModal({
  row,
  onClose,
  onSaved,
}: {
  row: AedRow;
  onClose: () => void;
  onSaved: (aedId: string, cfg: AedConfigOverride) => void;
}) {
  const [loc, setLoc] = useState(row.loc);
  const [product, setProduct] = useState(row.product ?? "");
  const [manager, setManager] = useState(row.manager);
  const [note, setNote] = useState(row.note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const t = getSessionToken();
      const res = await fetch("/api/aed/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ aedId: row.id, loc, manager, product, note }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr(j.error || "저장 실패 — 관리자 권한을 확인하세요.");
        setSaving(false);
        return;
      }
      onSaved(row.id, {
        loc: loc.trim() || null,
        manager: manager.trim() || null,
        product: product.trim() || null,
        note: note.trim() || null,
      });
    } catch {
      setErr("저장 실패 — 네트워크 오류.");
      setSaving(false);
    }
  };

  const fieldCls =
    "w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-primary dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark";
  const labelCls = "mb-1 block text-xs font-semibold text-body dark:text-on-dark-soft";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-hairline bg-canvas dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hairline bg-surface-soft px-5 py-3 dark:border-white/10 dark:bg-surface-dark-elevated">
          <span className="text-sm font-bold text-ink dark:text-on-dark">AED 알림 설정 수정</span>
          <span className="text-xs text-muted dark:text-on-dark-soft">{row.id}</span>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div>
            <label className={labelCls}>설치 위치</label>
            <input
              className={fieldCls}
              value={loc}
              maxLength={40}
              onChange={(e) => setLoc(e.target.value)}
              placeholder="예: 지하 주차장 B1"
            />
          </div>
          <div>
            <label className={labelCls}>제품명</label>
            <input
              className={fieldCls}
              value={product}
              maxLength={40}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="예: 필립스 HeartStart FRx"
            />
          </div>
          <div>
            <label className={labelCls}>관리책임자</label>
            <input
              className={fieldCls}
              value={manager}
              maxLength={30}
              onChange={(e) => setManager(e.target.value)}
              placeholder="예: 이현장"
            />
          </div>
          <div>
            <label className={labelCls}>비고 (관련 내용)</label>
            <textarea
              className={`${fieldCls} min-h-[64px] resize-y`}
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              placeholder="점검 특이사항·비상 연락처 등 (선택)"
            />
          </div>
          {err && <p className="text-xs font-semibold text-semantic-down">{err}</p>}
          <p className="text-[11px] text-muted dark:text-on-dark-soft">
            빈 칸으로 저장하면 기본값으로 복귀합니다. 관리자 권한 계정만 저장됩니다.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-hairline px-4 py-1.5 text-sm font-semibold text-body hover:bg-surface-soft disabled:opacity-50 dark:border-white/10 dark:text-on-dark-soft dark:hover:bg-white/10"
          >
            취소
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-active disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// AED 실 연동 장비 등록 모달(관리자 권한) — 장비 ID·설치위치·제품명·관리책임자·단말 배터리·최근 교환일. PUT /api/aed/devices register.
function AedRegisterModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [aedId, setAedId] = useState("");
  const [loc, setLoc] = useState("");
  const [product, setProduct] = useState("");
  const [manager, setManager] = useState("");
  const [devBatt, setDevBatt] = useState("100");
  const [lastSwap, setLastSwap] = useState(fmtYMD(new Date())); // 최근 교환일 기본=오늘(신품 가정).
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!aedId.trim() || !loc.trim() || !manager.trim()) {
      setErr("장비 ID·설치위치·관리책임자는 필수입니다.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const t = getSessionToken();
      const res = await fetch("/api/aed/devices", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({
          action: "register",
          device: {
            aedId: aedId.trim(),
            loc: loc.trim(),
            product: product.trim(),
            manager: manager.trim(),
            devBatt: Number(devBatt) || 100,
            lastSwapTs: lastSwap || null,
          },
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr(j.error || "등록 실패 — 관리자 권한을 확인하세요.");
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setErr("등록 실패 — 네트워크 오류.");
      setSaving(false);
    }
  };

  const fieldCls =
    "w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-primary dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark";
  const labelCls = "mb-1 block text-xs font-semibold text-body dark:text-on-dark-soft";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="wx-cards-scroll max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-hairline bg-canvas dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hairline bg-surface-soft px-5 py-3 dark:border-white/10 dark:bg-surface-dark-elevated">
          <span className="text-sm font-bold text-ink dark:text-on-dark">AED 알림 장비 등록</span>
          <KindBadge demo={false} />
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div>
            <label className={labelCls}>
              장비 ID <span className="text-semantic-down">*</span>
            </label>
            <input
              className={fieldCls}
              value={aedId}
              maxLength={40}
              onChange={(e) => setAedId(e.target.value)}
              placeholder="예: AED-08"
            />
            <p className="mt-1 text-[10px] text-muted dark:text-on-dark-soft">
              RPi 스크립트의 AED_ID와 일치해야 실 알림이 폴링됩니다. 데모 프리셋(AED-01~07)과 다른 ID를 쓰세요.
            </p>
          </div>
          <div>
            <label className={labelCls}>
              설치 위치 <span className="text-semantic-down">*</span>
            </label>
            <input
              className={fieldCls}
              value={loc}
              maxLength={40}
              onChange={(e) => setLoc(e.target.value)}
              placeholder="예: 스마트인재개발원 601호"
            />
          </div>
          <div>
            <label className={labelCls}>제품명</label>
            <input
              className={fieldCls}
              value={product}
              maxLength={40}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="예: VitAlGuard-AED-ALERT-01"
            />
          </div>
          <div>
            <label className={labelCls}>
              관리책임자 <span className="text-semantic-down">*</span>
            </label>
            <input
              className={fieldCls}
              value={manager}
              maxLength={30}
              onChange={(e) => setManager(e.target.value)}
              placeholder="예: 김태곤"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>단말 배터리 %</label>
              <input
                className={fieldCls}
                type="number"
                min={0}
                max={100}
                value={devBatt}
                onChange={(e) => setDevBatt(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>최근 교환일</label>
              <input className={fieldCls} type="date" value={lastSwap} onChange={(e) => setLastSwap(e.target.value)} />
            </div>
          </div>
          {err && <p className="text-xs font-semibold text-semantic-down">{err}</p>}
          <p className="text-[11px] text-muted dark:text-on-dark-soft">
            AED 배터리·전극패드 교환 주기는 표준(48/24개월)으로 등록됩니다. 관리자 권한 계정만 등록됩니다.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-hairline px-4 py-1.5 text-sm font-semibold text-body hover:bg-surface-soft disabled:opacity-50 dark:border-white/10 dark:text-on-dark-soft dark:hover:bg-white/10"
          >
            취소
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-active disabled:opacity-50"
          >
            {saving ? "등록 중…" : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AedAlertTable({ canManage = false }: { canManage?: boolean }) {
  // 행 맵에서 이미 계산한 status 를 함께 보관 → 모달에서 aedStatus 재계산 안 함.
  const [alert, setAlert] = useState<{ row: AedRow; status: ReturnType<typeof aedStatus> } | null>(null);
  const [deviceRow, setDeviceRow] = useState<AedRow | null>(null);
  const [editRow, setEditRow] = useState<AedRow | null>(null); // 권한있음 설정 편집 모달 대상(데모 프리셋).
  const [registerOpen, setRegisterOpen] = useState(false); // 실 연동 장비 등록 모달.
  const [, setTick] = useState(0);

  // 등록 실 장비 목록 재조회 → 캐시 갱신 + 표 리렌더(등록/해제 직후 즉시 반영).
  const reloadDevices = useCallback(() => {
    const t = getSessionToken();
    const hdr = t ? { headers: { Authorization: `Bearer ${t}` } } : undefined;
    return fetch("/api/aed/devices", hdr)
      .then((r) => r.json())
      .then((j: { ok?: boolean; devices?: RegisteredAedDeviceDTO[] }) => {
        if (j.ok && Array.isArray(j.devices)) aedRegisteredCache = j.devices;
        setTick((n) => n + 1);
      })
      .catch(() => {});
  }, []);

  // 실 연동 장비 등록 해제(삭제) — 관리자만. 확인 후 삭제.
  const removeDevice = useCallback(
    (r: AedRow) => {
      if (!window.confirm(`실 연동 장비 "${r.loc}" (${r.id}) 등록을 해제할까요?`)) return;
      const t = getSessionToken();
      fetch("/api/aed/devices", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ action: "remove", aedId: r.id }),
      })
        .then(() => reloadDevices())
        .catch(() => {});
    },
    [reloadDevices],
  );

  // 점검 기록 폴링 → 모듈 캐시 갱신(통합 신호등과 공유) + 표 리렌더.
  // 한 번에 한 인스턴스만 폴링·캐시 쓰기(aedPollingOwned) → 다중 인스턴스 경합 방지.
  useEffect(() => {
    if (aedPollingOwned) return; // 다른 인스턴스가 이미 폴링 중 → 공유 캐시 그대로 사용(중복 폴 방지).
    aedPollingOwned = true;
    let alive = true;
    const load = () => {
      const t = getSessionToken();
      const hdr = t ? { headers: { Authorization: `Bearer ${t}` } } : undefined;
      const pIns = fetch("/api/aed/inspections", hdr)
        .then((r) => r.json())
        .then((j: { ok?: boolean; inspections?: AedInspectionDTO[] }) => {
          if (alive && j.ok && Array.isArray(j.inspections)) aedInspectionsCache = j.inspections;
        })
        .catch(() => {});
      const pCfg = fetch("/api/aed/config", hdr)
        .then((r) => r.json())
        .then((j: { ok?: boolean; configs?: Record<string, AedConfigOverride> }) => {
          if (alive && j.ok && j.configs) aedConfigCache = j.configs;
        })
        .catch(() => {});
      const pDev = fetch("/api/aed/devices", hdr)
        .then((r) => r.json())
        .then((j: { ok?: boolean; devices?: RegisteredAedDeviceDTO[] }) => {
          if (alive && j.ok && Array.isArray(j.devices)) aedRegisteredCache = j.devices;
        })
        .catch(() => {});
      return Promise.all([pIns, pCfg, pDev]).then(() => {
        if (alive) setTick((t) => t + 1);
      });
    };
    load();
    const id = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(id);
      aedPollingOwned = false; // 소유권 반납 → 다음 마운트 인스턴스가 폴링 인계.
    };
  }, []);

  const rows = buildAedRows();
  const realCount = rows.filter((r) => !r.demo).length;

  const header = (
    <div className={`${AED_GRID} shrink-0 border-b border-hairline bg-surface-soft px-3 py-2 text-[11px] font-semibold text-muted dark:border-white/10 dark:bg-surface-dark dark:text-on-dark-soft`}>
      <div />
      <div>설치 위치</div>
      <div>제품명</div>
      <div>관리책임자</div>
      <div className="text-center">상태</div>
      <div className="text-center">AED 배터리</div>
      <div className="text-center">패드</div>
      <div className="text-center">최근 교환</div>
    </div>
  );
  return (
    <TableShell
      count={rows.length}
      header={header}
      minWidthClass="min-w-[1000px]"
      note={`실 연동 ${realCount} · 데모 ${AED_DEVICES.filter((d) => !d.real).length} · 수동 스크롤`}
      action={
        // 작업자 등록 버튼과 동일하게 항상 렌더 — 권한 없으면 disabled(회색+툴팁). 조건부 숨김은 canManage 로드 타이밍에 버튼이 통째로 사라져 "미구현"으로 보임.
        <button
          type="button"
          onClick={() => {
            if (canManage) setRegisterOpen(true);
          }}
          disabled={!canManage}
          title={
            canManage
              ? "AED 알림 장비 등록 (실 연동)"
              : "관리자 권한(권한있음)이 있는 계정만 장비 등록이 가능합니다"
          }
          className="inline-flex h-7 items-center gap-1 rounded-pill bg-primary px-3 text-[11px] font-semibold text-on-primary hover:bg-primary-active active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          + 장비 등록
        </button>
      }
    >
      {rows.map((r) => {
        const st = aedStatus(r);
        const bDue = battDueDays(r);
        const pDue = padDueDays(r);
        const last = aedLastSwap(r);
        return (
          <div
            key={r.id}
            className={`${AED_GRID} h-12 border-b border-hairline px-3 text-xs text-ink dark:border-white/5 dark:text-on-dark`}
          >
            <div className="flex justify-center">
              <SignalDot sev={st.sev} />
            </div>
            <div className="flex min-w-0 items-center gap-1">
              {!r.registered && canManage ? (
                <button
                  type="button"
                  onClick={() => setEditRow(r)}
                  title={r.note ? `비고: ${r.note} · 클릭하여 수정` : "클릭 → 설치위치·제품명·관리책임자·비고 수정 (관리자 권한)"}
                  className="truncate text-left font-medium hover:text-primary hover:underline"
                >
                  {r.loc}
                </button>
              ) : (
                <div className="truncate font-medium" title={r.note || undefined}>
                  {r.loc}
                </div>
              )}
              <KindBadge demo={r.demo} />
            </div>
            {!r.registered && canManage ? (
              <button
                type="button"
                onClick={() => setEditRow(r)}
                title="클릭 → 설치위치·제품명·관리책임자·비고 수정 (관리자 권한)"
                className="truncate text-left text-body hover:text-primary hover:underline dark:text-on-dark-soft"
              >
                {r.product || "—"}
              </button>
            ) : (
              <div className="truncate text-body dark:text-on-dark-soft">{r.product || "—"}</div>
            )}
            {!r.registered && canManage ? (
              <button
                type="button"
                onClick={() => setEditRow(r)}
                title="클릭 → 설치위치·제품명·관리책임자·비고 수정 (관리자 권한)"
                className="truncate text-left text-body hover:text-primary hover:underline dark:text-on-dark-soft"
              >
                {r.manager}
              </button>
            ) : (
              <div className="truncate text-body dark:text-on-dark-soft">{r.manager}</div>
            )}
            <div className="text-center">
              {st.sev === "normal" ? (
                <span className={`font-semibold ${TONE.normal}`}>정상</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setAlert({ row: r, status: st })}
                  title="클릭 → 관리 알림 상세"
                  className={`rounded px-1 font-semibold hover:underline ${TONE[st.sev]}`}
                >
                  {st.label}
                </button>
              )}
            </div>
            <div className={`text-center font-mono text-[11px] ${cycleStaticTone(aedCycleSev(bDue))}`} title={`AED 배터리 — 권장 교환 주기 ${r.battCycleMonths}개월`}>
              {dueShort(bDue)}
            </div>
            <div className={`text-center font-mono text-[11px] ${cycleStaticTone(aedCycleSev(pDue))}`} title={`전극패드 — 권장 교환 주기 ${r.padCycleMonths}개월`}>
              {dueShort(pDue)}
            </div>
            <div className="flex items-center justify-center gap-1.5 font-mono text-[10px] text-muted dark:text-on-dark-soft">
              <span>{last.date}</span>
              <button
                type="button"
                onClick={() => setDeviceRow(r)}
                title="NFC 점검 태그 · 교체·점검 이력"
                aria-label={`${r.loc} NFC 점검·이력`}
                className="inline-flex items-center justify-center rounded border border-hairline p-0.5 text-primary hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12a7 7 0 0 1 14 0" />
                  <path d="M8.5 12a3.5 3.5 0 0 1 7 0" />
                  <circle cx="12" cy="12" r="1" />
                </svg>
              </button>
              {r.registered && (
                // 관리자 등록 장비만 해제(코드 프리셋=데모·real 프리셋은 상수라 해제 불가). 작업자 해제와 동일하게 권한 없으면 disabled.
                <button
                  type="button"
                  onClick={() => {
                    if (canManage) removeDevice(r);
                  }}
                  disabled={!canManage}
                  title={canManage ? "실 연동 장비 등록 해제" : "관리자 권한(권한있음)만 해제 가능"}
                  aria-label={`${r.loc} 등록 해제`}
                  className="inline-flex items-center justify-center rounded border border-hairline p-0.5 text-semantic-down hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-red-500/10"
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        );
      })}
      {alert &&
        typeof document !== "undefined" &&
        createPortal(
          <AedManagementModal row={alert.row} status={alert.status} onClose={() => setAlert(null)} />,
          document.body,
        )}
      {deviceRow &&
        typeof document !== "undefined" &&
        createPortal(
          <AedDeviceModal row={deviceRow} onClose={() => setDeviceRow(null)} />,
          document.body,
        )}
      {editRow &&
        typeof document !== "undefined" &&
        createPortal(
          <AedConfigEditModal
            row={editRow}
            onClose={() => setEditRow(null)}
            onSaved={(aedId, cfg) => {
              aedConfigCache = { ...aedConfigCache, [aedId]: cfg };
              setTick((t) => t + 1);
              setEditRow(null);
            }}
          />,
          document.body,
        )}
      {registerOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <AedRegisterModal
            onClose={() => setRegisterOpen(false)}
            onSaved={() => {
              setRegisterOpen(false);
              reloadDevices();
            }}
          />,
          document.body,
        )}
    </TableShell>
  );
}

// ── 설비 메트릭 추세 그래프 (작업자 생체 그래프와 동일 차트 컴포넌트 재사용) ──
type ChartType = "line" | "bar";
const SITE_RANGES: { value: number; label: string }[] = [
  { value: 1, label: "24시간" },
  { value: 7, label: "1주일" },
  { value: 30, label: "30일" },
  { value: 60, label: "60일" },
  { value: 365, label: "1년" },
];

function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function labelDaysAgo(k: number): string {
  const d = new Date();
  d.setDate(d.getDate() - k);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 1년(월별) 라벨 — k개월 전 "YY/M".
function labelMonthsAgo(k: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - k);
  return `${`${d.getFullYear()}`.slice(2)}/${d.getMonth() + 1}`;
}

// 실 이력이 없어 현재값+seed 기반 결정적 합성 시계열 생성(마지막 점=현재 실측값).
// 배터리: 외부 충전 없음 가정 → 단조 감소(상승 구간 절대 없음). 과거가 높고 현재값으로 하락.
// 가스: 측정값 주변 자연 변동(상하 변동 정상).
function buildSeries(m: SiteMetric, days: number) {
  // 1년은 12 월별 포인트(일별 365점은 막대·도트가 겹쳐 가독성 저하).
  const count = days === 1 ? 24 : days === 365 ? 12 : days;
  const seed = strHash(m.key);
  const mkLabel = (i: number) =>
    days === 1 ? `${i}시` : days === 365 ? labelMonthsAgo(count - 1 - i) : labelDaysAgo(count - 1 - i);
  const points: { date: string; label: string; value: number }[] = [];

  if (m.kind === "battery") {
    // 단조 감소 — 각 구간 감소량을 양수 가중치로 배분(누적이라 절대 상승하지 않음).
    const desiredDrop = days === 1 ? 2 : days * 0.8; // 하루 ~0.8% 방전 가정
    const start = Math.min(100, m.value + desiredDrop);
    const totalDrop = start - m.value;
    const weights: number[] = [];
    let wsum = 0;
    for (let s = 0; s < count - 1; s++) {
      const raw = Math.sin(seed * 13.7 + s * 7.31) * 43758.5453;
      const w = 0.5 + (raw - Math.floor(raw)); // [0.5,1.5) — 항상 양수
      weights.push(w);
      wsum += w;
    }
    let acc = start;
    for (let i = 0; i < count; i++) {
      if (i > 0) acc -= ((weights[i - 1] ?? 0) / (wsum || 1)) * totalDrop;
      points.push({ date: mkLabel(i), label: mkLabel(i), value: Math.max(0, acc) });
    }
  } else {
    const amp = Math.max(Math.abs(m.value) * 0.3, m.decimals === 0 ? 1 : 0.3);
    for (let i = 0; i < count; i++) {
      const raw = Math.sin(seed * 97.13 + i * 12.9898) * 43758.5453;
      const r = raw - Math.floor(raw); // [0,1)
      points.push({ date: mkLabel(i), label: mkLabel(i), value: Math.max(0, m.value + (r - 0.5) * 2 * amp) });
    }
  }
  const last = points[count - 1];
  if (last) points[count - 1] = { ...last, value: m.value }; // 마지막=현재 실측값

  const vals = points.map((p) => p.value);
  return {
    points,
    summary: {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    },
  };
}

export function SiteMetricChartPanel({
  metric,
  onClose,
}: {
  metric: SiteMetric;
  onClose: () => void;
}) {
  const [range, setRange] = useState(7);
  const [chartType, setChartType] = useState<ChartType>("line");
  const { points, summary } = useMemo(() => buildSeries(metric, range), [metric, range]);
  // 가스 임계값을 그래프 기준선(빨강 점선)으로 표시. 배터리 등 임계 없는 메트릭은 미표시.
  const referenceLines = metric.threshold
    ? [{ value: metric.threshold.value, label: metric.threshold.label, color: "#ef4444" }]
    : undefined;

  return (
    <section className="rounded-md border border-cyan-500/40 bg-cyan-50 dark:border-cyan-400/30 dark:bg-cyan-400/[0.03]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink dark:text-on-dark">{metric.title}</span>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">누적 추세 · 샘플</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded border border-zinc-300 dark:border-white/10">
            {(["line", "bar"] as ChartType[]).map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => setChartType(ct)}
                aria-pressed={chartType === ct}
                className={`px-3 py-1 text-xs ${
                  chartType === ct
                    ? "bg-cyan-200 text-cyan-800 dark:bg-cyan-400/20 dark:text-cyan-100"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
                }`}
              >
                {ct === "line" ? "📈 라인" : "📊 막대"}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded border border-zinc-300 dark:border-white/10">
            {SITE_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={`px-3 py-1 text-xs ${
                  range === r.value
                    ? "bg-cyan-200 text-cyan-800 dark:bg-cyan-400/20 dark:text-cyan-100"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5"
          >
            닫기
          </button>
        </div>
      </header>
      <div className="px-4 py-4">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <SummaryCell label="평균" value={summary.avg} unit={metric.unit} decimals={metric.decimals} color={metric.color} />
          <SummaryCell label="최저" value={summary.min} unit={metric.unit} decimals={metric.decimals} color={metric.color} />
          <SummaryCell label="최고" value={summary.max} unit={metric.unit} decimals={metric.decimals} color={metric.color} />
        </div>
        {chartType === "bar" ? (
          <BarChart
            points={points}
            color={metric.color}
            unit={metric.unit}
            decimals={metric.decimals}
            referenceLines={referenceLines}
          />
        ) : (
          <LineChart
            points={points}
            color={metric.color}
            unit={metric.unit}
            decimals={metric.decimals}
            referenceLines={referenceLines}
          />
        )}
      </div>
    </section>
  );
}
