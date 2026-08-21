// 실내 현장 환경 — 가스포드(gaspod-01) 실기기가 5초마다 올리는 온도·습도·기압을 표시.
// 현장 환경 패널(WeatherStrip layout="list") 하단에 같은 행 디자인으로 붙는다.
"use client";

import { useEffect, useState } from "react";

import { getSessionToken } from "./LoginGate";
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
  // 신선도 기준 시각 — 응답 헤더의 서버 시계다. 브라우저 Date.now() 를 쓰면 PC 시계가
  // 1분 이상 어긋난 사용자에게만 멀쩡한 값이 '수신 지연'으로 보인다(실제 발생).
  const [serverNowMs, setServerNowMs] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    // 세션 토큰 동봉 — GET 이 2026-08-21 봉인(P1-3)으로 세션 인증 뒤로 갔다.
    // 401(비로그인·만료)이면 아래 !r.ok 경로로 latest=null → 미수신 표시로 열화한다.
    const load = () =>
      fetch("/api/gaspod/telemetry?n=1", {
        cache: "no-store",
        headers: (() => {
          const t = getSessionToken();
          return t ? { Authorization: `Bearer ${t}` } : undefined;
        })(),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          // Date 헤더는 초 단위지만 60초 게이트에는 충분하다. 없으면 신선도 판정을 포기한다
          // (클라 시계로 대신 재면 이 버그가 그대로 돌아온다).
          const d = Date.parse(r.headers.get("date") ?? "");
          return r.json().then((j) => ({ j, serverNow: Number.isNaN(d) ? null : d }));
        })
        .then(({ j, serverNow }: { j: { ok?: boolean; latest?: Latest | null }; serverNow: number | null }) => {
          if (!alive) return;
          setLatest(j.ok && j.latest ? j.latest : null);
          setServerNowMs(serverNow);
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

  // 서버 시각을 못 얻으면(헤더 없음) 신선도를 못 재므로 값은 그대로 보여준다 —
  // 잴 수 없는 것을 '오래됐다'로 단정하면 멀쩡한 실측값을 가린다.
  const ageMs =
    latest && serverNowMs !== null ? serverNowMs - new Date(latest.ts).getTime() : 0;
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

  // 수신 상태 표시 — 현장 환경 헤더의 점·라벨과 같은 3단 구성(실시간 / 지연 / 대기).
  // 값이 없거나 오래됐으면 시각 대신 상태를 적는다 — 빈칸은 '정상'으로 오독된다.
  const dotCls = fresh
    ? "bg-semantic-up"
    : latest
      ? "bg-amber-400 vital-blink-caution"
      : "bg-muted/50 dark:bg-white/20";
  const dotLabel = fresh ? "실시간" : latest ? "수신 지연" : "미수신";
  const dotTitle = fresh
    ? `${latest.device_id} 실시간 수신 중 — ${hm(latest.ts)} 측정`
    : latest
      ? `${Math.round(ageMs / 1000)}초째 새 값 없음 — 마지막 수신 ${hm(latest.ts)}`
      : "가스포드 미수신 — 기기 연결 대기";

  return (
    <div className="mt-2.5 border-t border-hairline pt-2.5 dark:border-white/10">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-body dark:text-on-dark-soft">
        <span className="font-semibold text-ink dark:text-on-dark">실내 현장 환경</span>
        <span className="inline-flex shrink-0 items-center gap-1.5" title={dotTitle}>
          {fresh && (
            <span className="font-mono text-[10px] text-body dark:text-on-dark-soft">
              {latest.device_id} · {hm(latest.ts)}
            </span>
          )}
          <span className={`h-2.5 w-2.5 rounded-full ring-1 ring-hairline ${dotCls}`} />
          <span className="text-[11px] font-medium text-muted dark:text-on-dark-soft">{dotLabel}</span>
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
