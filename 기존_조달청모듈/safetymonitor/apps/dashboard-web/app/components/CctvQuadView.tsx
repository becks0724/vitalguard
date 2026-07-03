// CCTV 관제 8분할 화면 — 1·2·3번째 타일은 AI 실시간 라이브(CAM-01 객체감지·CAM-02 낙상감지·CAM-03 GoPro PPE 안전모 감지), 나머지 5개는 현장 샘플.
// 타일 이름은 ✎ 로 수정(로컬 저장), AI 타일은 연결 ON/OFF(백엔드 일시중지)·클릭 시 팝업 확대+하단 감지 내용.
// aiApi=MJPEG 라이브 <img>+감지 통계 / streamUrl=<video> / 둘 다 없으면 샘플 placeholder.
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// AI 감지 백엔드(YOLOv8 MJPEG 스트림 + 감지 통계/연결 API) 주소.
// 빌드타임 주입(Dockerfile build-arg). 미주입/빈값이면 로컬 데모 기본값으로 폴백(|| — 빈 문자열도 폴백).
const AI_CCTV_API = process.env.NEXT_PUBLIC_AI_CCTV_API || "http://localhost:8000";
// 카메라 이름 오버라이드 로컬 저장 키.
const NAMES_KEY = "safetymonitor.cctv.names.v1";

// AI 종류 — object(객체감지)·fall(낙상감지)·ppe(안전모 감지). suffix 는 백엔드 엔드포인트 접미사("" 또는 "2"·"3").
type AiKind = "object" | "fall" | "ppe";
type Cam = {
  id: string;
  location: string;
  streamUrl?: string;
  aiApi?: string;
  aiKind?: AiKind;
  aiSuffix?: string;
};

// 현장 주요 위치 8개소 — 1·2·3번째 타일이 AI 실시간 라이브(객체감지·낙상감지·GoPro PPE 안전모 감지).
const CAMERAS: Cam[] = [
  { id: "CAM-01", location: "정문 출입구", aiApi: AI_CCTV_API, aiKind: "object", aiSuffix: "" },
  { id: "CAM-02", location: "지하 기계실", aiApi: AI_CCTV_API, aiKind: "fall", aiSuffix: "2" },
  { id: "CAM-03", location: "현장 작업구역(GoPro)", aiApi: AI_CCTV_API, aiKind: "ppe", aiSuffix: "3" },
  { id: "CAM-04", location: "자재 야적장" },
  { id: "CAM-05", location: "동측 비계" },
  { id: "CAM-06", location: "콘크리트 타설구역" },
  { id: "CAM-07", location: "후문 차량 통제" },
  { id: "CAM-08", location: "가설 전기실" },
];

// CCTV/보안 카메라 라인 아이콘 (대시보드 모노톤 테마와 동일).
function CameraIcon({ size = 40 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7.5h11v9H3z" />
      <path d="M14 10.5 21 7v10l-7-3.5" />
      <circle cx="8.5" cy="12" r="2" />
    </svg>
  );
}

// 연필(이름 수정) 아이콘.
function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

// 전원(연결 ON/OFF) 아이콘.
function PowerIcon({ size = 10 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v9" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </svg>
  );
}

// 현재 시각(HH:MM:SS) — hydration 불일치 방지 위해 mount 후 클라이언트에서만 채운다.
function ClockTime() {
  const [t, setT] = useState("");
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString("ko-KR", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono tabular-nums">{t}</span>;
}

// AI 실시간 감지 영상 — 백엔드 MJPEG 스트림(<img>). OFF=절약 placeholder, 서버 미연결=대기 placeholder.
// suffix 로 객체감지(/cctv/stream)·낙상감지(/cctv/stream2) 분기.
function AiLiveScreen({
  aiApi,
  suffix = "",
  enabled,
  large,
}: {
  aiApi: string;
  suffix?: string;
  enabled?: boolean | null;
  large?: boolean;
}) {
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0); // 재연결용 — 캐시 버스트 + img 리마운트.
  // 다시 ON 되면 에러 상태 초기화(재연결 시도).
  useEffect(() => {
    if (enabled !== false) setErr(false);
  }, [enabled]);
  // 스트림 끊김 시 빠르게 자동 재연결(서버 재기동·MJPEG 일시적 onError·네트워크 블립 자가복구).
  // 1.2초로 짧게 — 분할 타일이 영상 대신 빈 안내 화면에 머무는 시간을 최소화해 "영상이 안 채워짐" 체감을 줄인다.
  useEffect(() => {
    if (!err || enabled === false) return;
    const id = setTimeout(() => {
      setErr(false);
      setTick((t) => t + 1);
    }, 1200);
    return () => clearTimeout(id);
  }, [err, enabled]);

  if (enabled === false) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-zinc-500">
        <PowerIcon size={large ? 56 : 32} />
        <span className={large ? "text-sm text-zinc-400" : "text-[11px] text-zinc-400"}>연결 꺼짐 · 절약 모드</span>
        <span className={large ? "text-xs text-zinc-600" : "text-[10px] text-zinc-600"}>ON 시 실시간 감지 재개</span>
      </div>
    );
  }
  if (err) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-zinc-500">
        <CameraIcon size={large ? 72 : 40} />
        <span className={large ? "text-sm text-zinc-400" : "text-[11px] text-zinc-400"}>AI 서버 연결 대기</span>
        <span className={large ? "text-xs text-zinc-600" : "text-[10px] text-zinc-600"}>{aiApi}</span>
      </div>
    );
  }
  return (
    <img
      key={tick}
      src={`${aiApi}/cctv/stream${suffix}${tick ? `?t=${tick}` : ""}`}
      alt="AI 실시간 감지 영상"
      onError={() => setErr(true)}
      // object-contain — 영상 전체를 잘림 없이 한 화면에 표시(줌아웃). 정사각형(shorts) 소스는 좌우 여백 발생.
      // CAM-02 낙상 영상 전체가 레이아웃 안에 온전히 들어오도록. 16:9 소스(CAM-01/03)는 여백 없이 동일.
      className="absolute inset-0 h-full w-full object-contain"
    />
  );
}

// 카메라 영상 영역 — AI 라이브 / 실 stream / 샘플 placeholder.
function CameraScreen({ cam, enabled, large }: { cam: Cam; enabled?: boolean | null; large?: boolean }) {
  if (cam.aiApi) {
    return (
      <AiLiveScreen
        aiApi={cam.aiApi}
        suffix={cam.aiSuffix ?? ""}
        enabled={enabled}
        large={large}
      />
    );
  }
  if (cam.streamUrl) {
    return (
      <video
        src={cam.streamUrl}
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-zinc-500">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent" />
      <CameraIcon size={large ? 72 : 40} />
      <span className={large ? "text-sm text-zinc-400" : "text-[11px] text-zinc-400"}>샘플 영상</span>
      <span className={large ? "text-xs text-zinc-600" : "text-[10px] text-zinc-600"}>
        자체 카메라 연동 시 실시간{large ? " 영상 표시" : ""}
      </span>
    </div>
  );
}

// 연결 ON/OFF 토글 버튼 (AI 타일 전용).
function ConnToggle({ enabled, onToggle }: { enabled?: boolean | null; onToggle: () => void }) {
  const off = enabled === false;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={off ? "CCTV 연결 켜기" : "CCTV 연결 끄기"}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold transition ${
        off ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600" : "bg-emerald-500 text-white hover:bg-emerald-400"
      }`}
    >
      <PowerIcon size={10} />
      {off ? "OFF" : "ON"}
    </button>
  );
}

function CameraTile({
  cam,
  name,
  enabled,
  canManage,
  onRename,
  onToggle,
  onSelect,
}: {
  cam: Cam;
  name: string;
  enabled?: boolean | null;
  // 이름 ✎ 수정 권한 — 관리자 권한(권한있음)만 true. false 면 ✎ 버튼 미표시.
  canManage: boolean;
  onRename: (value: string) => void;
  onToggle?: () => void;
  onSelect: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    onRename(draft.trim() || name);
    setEditing(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !editing) onSelect();
      }}
      className="group relative flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-lg border border-hairline bg-zinc-900 text-left transition hover:border-white/40 hover:ring-1 hover:ring-white/30 dark:border-white/10"
    >
      {/* 상단 위치 항목 — 이름 ✎ 수정 + (AI) 연결 토글 */}
      <div className="flex shrink-0 items-center justify-between gap-2 bg-black/40 px-2.5 py-1.5 text-xs text-zinc-100">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
          {editing ? (
            <input
              autoFocus
              value={draft}
              maxLength={20}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(name);
                  setEditing(false);
                }
              }}
              className="w-28 rounded border border-white/20 bg-black/60 px-1 py-0.5 text-xs text-white outline-none focus:border-emerald-400"
            />
          ) : (
            <span className="truncate font-semibold">{name}</span>
          )}
          {!editing && canManage && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDraft(name);
                setEditing(true);
              }}
              aria-label="카메라 이름 수정"
              title="카메라 이름 수정(관리자 권한 필요)"
              className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 transition hover:bg-white/10 hover:text-zinc-100 group-hover:opacity-100"
            >
              <EditIcon />
            </button>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {cam.aiApi && onToggle && <ConnToggle enabled={enabled} onToggle={onToggle} />}
          {cam.aiApi && (
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold text-white ${
                cam.aiKind === "fall" ? "bg-rose-500" : cam.aiKind === "ppe" ? "bg-amber-500" : "bg-emerald-500"
              }`}
            >
              {cam.aiKind === "fall" ? "낙상AI" : cam.aiKind === "ppe" ? "PPE" : "AI"}
            </span>
          )}
          <span className="text-[10px] text-zinc-400">{cam.id}</span>
        </span>
      </div>
      {/* 영상 영역 */}
      <div className="relative min-h-0 flex-1">
        <CameraScreen cam={cam} enabled={enabled} />
      </div>
      {/* 하단 LIVE/OFF 표식 + 타임스탬프 */}
      <div className="absolute bottom-1.5 left-2.5 flex items-center gap-1 text-[10px] font-semibold">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${enabled === false ? "bg-zinc-500" : "bg-red-500"}`} />
        <span className={enabled === false ? "text-zinc-400" : "text-red-400"}>{enabled === false ? "OFF" : "LIVE"}</span>
      </div>
      <div className="absolute bottom-1.5 right-2.5 text-[10px] text-zinc-300">
        <ClockTime />
      </div>
      {/* hover 확대 힌트 */}
      <span className="pointer-events-none absolute right-2.5 top-9 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-zinc-200 opacity-0 transition group-hover:opacity-100">
        ⤢ 확대
      </span>
    </div>
  );
}

// AI 감지 통계 스트립 — 팝업 영상 하단에 실시간 감지 내용(클래스별 카운트)을 60초 폴링으로 표시.
// suffix 로 객체감지 소스 분기(CAM-01 /cctv/stats · CAM-03 /cctv/stats3).
function DetectionStrip({ aiApi, suffix = "" }: { aiApi: string; suffix?: string }) {
  const [stats, setStats] = useState<{
    fps: number;
    total: number;
    byClass: { label: string; count: number }[];
    alertsLastMinute: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${aiApi}/cctv/stats${suffix}`);
        if (!res.ok) return;
        const s = await res.json();
        if (active) setStats(s);
      } catch {
        /* 서버 미연결 — 다음 폴에서 재시도 */
      }
    };
    poll();
    const id = setInterval(poll, 60000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [aiApi, suffix]);

  const emoji: Record<string, string> = {
    보행자: "🚶",
    차량: "🚗",
    트럭: "🚛",
    버스: "🚌",
    오토바이: "🏍️",
    자전거: "🚴",
  };
  const items = stats?.byClass ?? [];

  return (
    <div className="border-t border-white/10 bg-black/50 px-4 py-3 text-zinc-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          실시간 감지
        </span>
        <span className="text-[11px] text-zinc-400">
          YOLOv8 · {stats ? `${stats.fps} fps` : "—"} · 총 {stats?.total ?? 0}
        </span>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((c) => (
            <span
              key={c.label}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs"
            >
              <span>{emoji[c.label] ?? "▫️"}</span>
              <span className="text-zinc-300">{c.label}</span>
              <span className="font-bold tabular-nums">{c.count}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500">감지된 객체 없음</p>
      )}
    </div>
  );
}

// 낙상 감지 스트립 — 팝업 영상 하단에 상태별(정상/불안정/누움/낙상) 인원을 60초 폴링으로 표시.
function FallDetectionStrip({ aiApi, suffix = "2" }: { aiApi: string; suffix?: string }) {
  const [stats, setStats] = useState<{
    total: number;
    fallen: number;
    byStatus: { status: string; label: string; count: number }[];
  } | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${aiApi}/cctv/stats${suffix}`);
        if (!res.ok) return;
        const s = await res.json();
        if (active) setStats(s);
      } catch {
        /* 서버 미연결 — 다음 폴에서 재시도 */
      }
    };
    poll();
    const id = setInterval(poll, 60000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [aiApi, suffix]);

  // 상태별 칩 색상 — 정상(초록)/불안정(앰버)/누움(주황)/낙상(빨강).
  const style: Record<string, string> = {
    standing: "bg-emerald-500/15 text-emerald-300",
    unstable: "bg-amber-500/15 text-amber-300",
    lying: "bg-orange-500/15 text-orange-300",
    fallen: "bg-red-500/20 text-red-300",
  };
  const items = stats?.byStatus ?? [];
  const fallen = stats?.fallen ?? 0;

  return (
    <div className="border-t border-white/10 bg-black/50 px-4 py-3 text-zinc-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${fallen > 0 ? "bg-red-500" : "bg-emerald-400"}`} />
          낙상 감지
        </span>
        <span className="text-[11px] text-zinc-400">
          YOLOv8-pose · 대상 {stats?.total ?? 0}명
          {fallen > 0 && <span className="ml-1.5 font-bold text-red-300">· 낙상 {fallen}건</span>}
        </span>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((c) => (
            <span
              key={c.status}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${style[c.status] ?? "bg-white/10 text-zinc-300"}`}
            >
              <span>{c.label}</span>
              <span className="font-bold tabular-nums">{c.count}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500">감지 대상 없음</p>
      )}
    </div>
  );
}

// PPE(안전모) 감지 스트립 — 팝업 영상 하단에 준수율·안전모/조끼 착용 현황을 60초 폴링으로 표시.
function PpeDetectionStrip({ aiApi, suffix = "3" }: { aiApi: string; suffix?: string }) {
  const [stats, setStats] = useState<{
    violation_count: number;
    compliance_rate: number;
    no_hardhat_count: number;
    no_vest_count: number;
    hardhat_count: number;
    vest_count: number;
    person_count: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${aiApi}/cctv/stats${suffix}`);
        if (!res.ok) return;
        const r = await res.json();
        if (active) setStats(r);
      } catch {
        /* 서버 미연결 — 다음 폴에서 재시도 */
      }
    };
    poll();
    const id = setInterval(poll, 60000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [aiApi, suffix]);

  const violations = stats?.violation_count ?? 0;
  const rate = stats?.compliance_rate ?? 100;
  const chips = [
    { label: "안전모", ok: stats?.hardhat_count ?? 0, no: stats?.no_hardhat_count ?? 0 },
    { label: "안전조끼", ok: stats?.vest_count ?? 0, no: stats?.no_vest_count ?? 0 },
  ];

  return (
    <div className="border-t border-white/10 bg-black/50 px-4 py-3 text-zinc-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${violations > 0 ? "bg-red-500" : "bg-emerald-400"}`} />
          PPE 안전모 감지
        </span>
        <span className="text-[11px] text-zinc-400">
          YOLOv8 · 작업자 {stats?.person_count ?? 0}명 · 준수율{" "}
          <span className={rate >= 100 ? "text-emerald-300" : rate >= 50 ? "text-amber-300" : "text-red-300"}>
            {Math.round(rate)}%
          </span>
          {violations > 0 && <span className="ml-1.5 font-bold text-red-300">· 위반 {violations}건</span>}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <span key={c.label} className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs">
            <span className="text-zinc-300">{c.label}</span>
            <span className="text-emerald-300">착용 {c.ok}</span>
            <span className={c.no > 0 ? "font-bold text-red-300" : "text-zinc-500"}>미착용 {c.no}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// 클릭한 카메라를 확대 표시하는 팝업 — 캐러셀 transform 에 갇히지 않도록 body 로 portal.
function CctvModal({
  cam,
  name,
  enabled,
  onToggle,
  onClose,
}: {
  cam: Cam;
  name: string;
  enabled?: boolean | null;
  onToggle?: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-hairline-strong bg-surface-dark dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 — 위치 + ID + (AI) 연결 토글 + 닫기 */}
        <div className="flex items-center justify-between gap-2 bg-black/50 px-4 py-2.5 text-zinc-100">
          <span className="flex min-w-0 items-center gap-2">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />
            <span className="truncate text-sm font-semibold">{name}</span>
            <span className="shrink-0 text-xs text-zinc-400">{cam.id}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {cam.aiApi && onToggle && <ConnToggle enabled={enabled} onToggle={onToggle} />}
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="shrink-0 rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </span>
        </div>
        {/* 영상 영역 (16:9) */}
        <div className="relative aspect-video bg-zinc-950">
          <CameraScreen cam={cam} enabled={enabled} large />
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-xs font-semibold">
            <span className={`inline-block h-2 w-2 rounded-full ${enabled === false ? "bg-zinc-500" : "bg-red-500"}`} />
            <span className={enabled === false ? "text-zinc-400" : "text-red-400"}>{enabled === false ? "OFF" : "LIVE"}</span>
          </div>
          <div className="absolute bottom-3 right-3 rounded bg-black/50 px-2 py-1 text-xs text-zinc-200">
            <ClockTime />
          </div>
        </div>
        {/* AI 타일 — 영상 하단 실시간 감지 내용 (OFF 시 안내) */}
        {cam.aiApi && enabled !== false && cam.aiKind === "fall" && (
          <FallDetectionStrip aiApi={cam.aiApi} suffix={cam.aiSuffix ?? "2"} />
        )}
        {cam.aiApi && enabled !== false && cam.aiKind === "ppe" && (
          <PpeDetectionStrip aiApi={cam.aiApi} suffix={cam.aiSuffix ?? "3"} />
        )}
        {cam.aiApi && enabled !== false && cam.aiKind !== "fall" && cam.aiKind !== "ppe" && (
          <DetectionStrip aiApi={cam.aiApi} suffix={cam.aiSuffix ?? ""} />
        )}
        {cam.aiApi && enabled === false && (
          <div className="border-t border-white/10 bg-black/50 px-4 py-3 text-[11px] text-zinc-500">
            연결 꺼짐 · ON 시 실시간 감지 재개
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// canManage=false(관리자 권한 '권한있음' 아님)면 타일 이름 ✎ 수정 비활성(작업자 등록/해제와 동일 권한 게이트).
export function CctvQuadView({ canManage }: { canManage: boolean }) {
  const [selected, setSelected] = useState<Cam | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  // AI 타일별 연결 상태 — suffix("" 객체감지 / "2" 낙상감지) 별로 보관.
  const [aiState, setAiState] = useState<Record<string, boolean | null>>({});

  // 카메라 이름 오버라이드 로드.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAMES_KEY);
      if (raw) setNames(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // AI 타일 연결 상태 폴링(백엔드가 source of truth) — AI 카메라마다 자기 엔드포인트 조회.
  useEffect(() => {
    let active = true;
    const aiCams = CAMERAS.filter((c) => c.aiApi);
    const poll = async () => {
      await Promise.all(
        aiCams.map(async (c) => {
          const suffix = c.aiSuffix ?? "";
          try {
            const res = await fetch(`${c.aiApi}/cctv/connection${suffix}`);
            // 404/5xx(엔드포인트 부재·일시 오류)는 무시 — 잘못된 OFF 표시 방지(연결 대기 유지).
            if (!res.ok) return;
            const r = await res.json();
            if (active && typeof r.enabled === "boolean") {
              setAiState((prev) => ({ ...prev, [suffix]: r.enabled }));
            }
          } catch {
            /* 서버 미연결 — 상태 유지 */
          }
        }),
      );
    };
    poll();
    const id = setInterval(poll, 60000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const rename = (id: string, value: string) => {
    setNames((prev) => {
      const next = { ...prev, [id]: value };
      try {
        localStorage.setItem(NAMES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const enabledOf = (cam: Cam): boolean | null =>
    cam.aiApi ? aiState[cam.aiSuffix ?? ""] ?? null : null;

  const toggleAi = async (cam: Cam) => {
    if (!cam.aiApi) return;
    const suffix = cam.aiSuffix ?? "";
    const next = !(aiState[suffix] ?? true);
    setAiState((prev) => ({ ...prev, [suffix]: next })); // 낙관적 반영
    try {
      await fetch(`${cam.aiApi}/cctv/connection${suffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
    } catch {
      /* 실패 시 다음 폴링이 실제 상태로 보정 */
    }
  };

  const nameOf = (cam: Cam) => names[cam.id] ?? cam.location;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-4 py-2 dark:border-white/10">
        <span className="rounded-pill bg-surface-strong px-2 py-0.5 text-xs font-medium text-body dark:bg-surface-dark dark:text-on-dark-soft">
          8개소
        </span>
        <span className="text-xs text-muted dark:text-on-dark-soft">
          {canManage ? "이름 ✎ 수정 · " : ""}클릭 확대 · AI 타일 연결 ON/OFF
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-2 p-3">
        {CAMERAS.map((cam) => (
          <CameraTile
            key={cam.id}
            cam={cam}
            name={nameOf(cam)}
            enabled={enabledOf(cam)}
            canManage={canManage}
            onRename={(value) => rename(cam.id, value)}
            onToggle={cam.aiApi ? () => toggleAi(cam) : undefined}
            onSelect={() => setSelected(cam)}
          />
        ))}
      </div>
      {selected && (
        <CctvModal
          cam={selected}
          name={nameOf(selected)}
          enabled={enabledOf(selected)}
          onToggle={selected.aiApi ? () => toggleAi(selected) : undefined}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
