// 실내 현장 환경 — 가스포드(gaspod-01) 실기기가 5초마다 올리는 온도·습도·기압을 표시.
// 현장 환경 패널(WeatherStrip layout="list") 하단에 같은 행 디자인으로 붙는다.
"use client";

import { useEffect, useState } from "react";

import { WeatherIcon } from "./WeatherIcons";

// 기기 POST 주기가 5초 → 60초(12회 연속 누락)면 끊긴 것으로 본다.
// 오래된 값을 현재값처럼 보여주면 false-OK 다(2026-07-30 CCTV 통계 사고와 같은 계열).
const FRESH_MS = 60_000;

type Latest = {
  device_id: string;
  temp: number;
  humidity: number;
  pressure: number;
  ts: string;
};

type Row = { icon: "thermometer" | "humidity" | "pressure"; label: string; value: string; unit: string };

function hm(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? "--:--"
    : d.toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}

export function IndoorEnvRows() {
  const [latest, setLatest] = useState<Latest | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/gaspod/telemetry?n=1", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j: { ok?: boolean; latest?: Latest | null }) => {
          if (!alive) return;
          setLatest(j.ok && j.latest ? j.latest : null);
          setNowMs(Date.now());
        })
        .catch(() => {
          if (alive) setLatest(null);
        });
    load();
    // 기기 주기(5초)보다 성기게 — 표시 갱신에 8초면 충분하고 호출도 줄인다(가스 표와 동일 주기).
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const ageMs = latest ? nowMs - new Date(latest.ts).getTime() : Infinity;
  const fresh = latest !== null && ageMs <= FRESH_MS;

  const rows: Row[] = fresh
    ? [
        { icon: "thermometer", label: "온도", value: latest.temp.toFixed(1), unit: "°C" },
        { icon: "humidity", label: "습도", value: `${Math.round(latest.humidity)}`, unit: "%" },
        { icon: "pressure", label: "기압", value: latest.pressure.toFixed(1), unit: "hPa" },
      ]
    : [
        { icon: "thermometer", label: "온도", value: "—", unit: "°C" },
        { icon: "humidity", label: "습도", value: "—", unit: "%" },
        { icon: "pressure", label: "기압", value: "—", unit: "hPa" },
      ];

  return (
    <div className="mt-2.5 border-t border-hairline pt-2.5 dark:border-white/10">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-body dark:text-on-dark-soft">
        <span className="font-semibold text-ink dark:text-on-dark">실내 현장 환경</span>
        {/* 값이 없거나 오래됐으면 시각 대신 상태를 적는다 — 빈칸은 '정상'으로 오독된다. */}
        <span className="font-mono text-[10px] text-body dark:text-on-dark-soft">
          {fresh ? `${latest.device_id} · ${hm(latest.ts)}` : latest ? "수신 지연" : "미수신"}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex w-full items-center gap-2 rounded-lg border border-hairline/70 bg-surface-soft/70 px-2.5 py-1.5 dark:border-white/10 dark:bg-white/[0.04]"
          >
            <WeatherIcon
              name={r.icon}
              className="h-[18px] w-[18px] shrink-0 text-body dark:text-on-dark-soft"
            />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-tight text-body dark:text-on-dark-soft">
              {r.label}
            </span>
            <span
              className={`shrink-0 text-sm font-semibold tabular-nums ${
                fresh ? "text-ink dark:text-on-dark" : "text-muted dark:text-on-dark-soft"
              }`}
            >
              {r.value}
            </span>
            <span className="shrink-0 text-[10px] font-medium text-muted dark:text-on-dark-soft/80">
              {r.unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
