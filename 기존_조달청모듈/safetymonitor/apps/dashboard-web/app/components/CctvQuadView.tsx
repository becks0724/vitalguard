// CCTV 관제 8분할 화면 — 1·2·3번째 타일은 AI 실시간 라이브(CAM-01 객체감지·CAM-02 낙상감지·CAM-03 GoPro PPE 안전모 감지), 나머지 5개는 현장 샘플.
// 타일 이름은 ✎ 로 수정(로컬 저장), AI 타일은 연결 ON/OFF(백엔드 일시중지)·클릭 시 팝업 확대+하단 감지 내용.
// aiApi=MJPEG 라이브 <img>+감지 통계 / streamUrl=<video> / 둘 다 없으면 샘플 placeholder.
"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CarouselPageVisibleContext } from "./WidgetCarousel";

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
  const retryCountRef = useRef(0); // 연속 재연결 실패 횟수 — 지수 백오프 계산용(연결 성공 시 리셋).
  // 가시성 — 캐러셀 숨은 페이지(캐러셀 밖 소비처는 기본 true) 또는 탭 숨김이면 스트림 연결·재시도 중단.
  const pageVisible = useContext(CarouselPageVisibleContext);
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const onVisibility = () => setTabVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const visible = pageVisible && tabVisible;
  // 다시 ON 되면 에러·백오프 상태 초기화(재연결 시도).
  useEffect(() => {
    if (enabled !== false) {
      retryCountRef.current = 0;
      setErr(false);
    }
  }, [enabled]);
  // 스트림 끊김 시 자동 재연결(서버 재기동·MJPEG 일시적 onError·네트워크 블립 자가복구).
  // 첫 재시도 1.2초 — 빈 안내 화면 체감 최소화. 이후 실패마다 지수 증가(최대 30초)로 죽은 백엔드 무한 폴 방지.
  // 안 보일 때(탭 숨김·캐러셀 다른 페이지)는 재시도 중단, 가시화되면 재개.
  useEffect(() => {
    if (!err || enabled === false || !visible) return;
    const delayMs = Math.min(1200 * 2 ** retryCountRef.current, 30000);
    const id = setTimeout(() => {
      retryCountRef.current += 1;
      setErr(false);
      setTick((t) => t + 1);
    }, delayMs);
    return () => clearTimeout(id);
  }, [err, enabled, visible]);

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
        <span className={large ? "text-sm text-zinc-400" : "text-[11px] text-zinc-400"}>서버 과금 절감을 위한 CCTV 일시 중단</span>
        <span className={large ? "text-xs text-zinc-600" : "text-[10px] text-zinc-600"}>객체인식(AI) 모델 연구·고도화 진행 중</span>
      </div>
    );
  }
  // 숨김 상태(탭 비활성·캐러셀 다른 페이지) — img 언마운트로 MJPEG 연결 해제(대역폭·백엔드 부하 절약), 가시화 시 재연결.
  if (!visible) return null;
  return (
    <img
      key={tick}
      src={`${aiApi}/cctv/stream${suffix}${tick ? `?t=${tick}` : ""}`}
      alt="AI 실시간 감지 영상"
      onLoad={() => {
        retryCountRef.current = 0; // 연결 성공 — 백오프 리셋(다음 끊김은 다시 1.2초부터).
      }}
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
      className="group relative flex min-h-0 cursor-pointer flex-col overflow-hidden border border-transparent bg-zinc-900 text-left transition hover:border-white/40 hover:ring-1 hover:ring-white/30"
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
// AI 통계 폴링 공용 훅 — 객체·낙상·PPE 세 스트립이 같은 구조를 세 번 반복하고 있었다.
// 폴링 주기·신선도 판정·미수신 표시를 한 곳에 모은다.
//
// ★ 미수신을 "이상 없음" 으로 보이게 하면 안 된다.
//   PPE 는 `compliance_rate ?? 100` 으로 준수율 100% 를, 낙상은 초록 점 + "감지 대상 없음" 으로
//   안전한 상태를 표시했다. 관제자가 화면을 믿고 넘어가는 false-OK 다
//   (생체 연결끊김 게이트 STALE_MS 와 같은 이유).
//   data 가 null 이면 미수신이고 label 이 그 사유다. 호출부는 수치를 가려야 한다.
//
// 폴링 60초는 감지 갱신율에 비해 너무 성겨서, 서버가 올라온 뒤에도 최대 1분 옛 화면이 남았다.
// 신선도 임계는 폴 실패 한 번으로 깜빡이지 않게 폴링의 약 4배를 둔다.
const AI_POLL_MS = 8_000;
const AI_STALE_MS = 30_000;

function useAiStats<T>(aiApi: string, suffix: string) {
  const [rx, setRx] = useState<{ data: T; at: number } | null>(null);
  // 폴이 실패하면 setRx 가 안 일어나 리렌더도 없다 → 신선도 표시가 갱신되지 않는다.
  // 성패와 무관하게 갱신해 stale 판정이 화면에 반영되게 한다.
  const [probedAt, setProbedAt] = useState(0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${aiApi}/cctv/stats${suffix}`);
        if (res.ok) {
          const r = (await res.json()) as T;
          if (active) setRx({ data: r, at: Date.now() });
        }
      } catch {
        /* 서버 미연결 — 다음 폴에서 재시도. 값은 두고 신선도로 판정한다 */
      }
      if (active) setProbedAt(Date.now());
    };
    poll();
    const id = setInterval(poll, AI_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [aiApi, suffix]);

  const fresh = rx !== null && probedAt - rx.at <= AI_STALE_MS;
  return {
    data: fresh ? rx.data : null,
    // 미수신 사유 — 한 번도 못 받았는가, 받다가 끊겼는가
    label: rx === null ? "수신 대기" : "연결끊김",
  };
}

// 미수신 안내 — 세 스트립 공통 문구.
const AI_NO_RX = "수신 없음 — 연결 확인 필요";

// 객체감지 스트립(CAM-01) — 팝업 영상 하단에 클래스별 감지 수를 표시.
function DetectionStrip({ aiApi, suffix = "" }: { aiApi: string; suffix?: string }) {
  const { data: stats, label } = useAiStats<{
    fps: number;
    total: number;
    byClass: { label: string; count: number }[];
    alertsLastMinute: number;
  }>(aiApi, suffix);

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
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${stats ? "bg-emerald-400" : "bg-zinc-500"}`} />
          실시간 감지
        </span>
        <span className="text-[11px] text-zinc-400">
          {stats ? (
            <>
              YOLOv8 · {stats.fps} fps · 총 {stats.total}
            </>
          ) : (
            <>
              YOLOv8 · <span className="font-semibold text-zinc-300">{label}</span> · 총{" "}
              <span className="text-zinc-400">—</span>
            </>
          )}
        </span>
      </div>
      {stats && items.length > 0 ? (
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
        <p className="text-[11px] text-zinc-500">{stats ? "감지된 객체 없음" : AI_NO_RX}</p>
      )}
    </div>
  );
}

// 낙상 감지 스트립(CAM-02) — 상태별(정상/불안정/누움/낙상) 인원.
// ⚠️ 표시 전용이다. 실제 낙상 경보는 서버 폴러(lib/cctv-fall-poller.ts)가 /cctv/stats2 를
//    1.5초 주기로 따로 폴링해 decideFusion 으로 낸다. 이 스트립이 미수신이어도 경보는 별개다.
function FallDetectionStrip({ aiApi, suffix = "2" }: { aiApi: string; suffix?: string }) {
  const { data: stats, label } = useAiStats<{
    total: number;
    fallen: number;
    byStatus: { status: string; label: string; count: number }[];
  }>(aiApi, suffix);

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
          {/* 미수신에 초록 점을 켜면 "이상 없음" 으로 읽힌다 — 회색으로 강등한다 */}
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              !stats ? "bg-zinc-500" : fallen > 0 ? "bg-red-500" : "bg-emerald-400"
            }`}
          />
          낙상 감지
        </span>
        <span className="text-[11px] text-zinc-400">
          {stats ? (
            <>
              YOLOv8-pose · 대상 {stats.total}명
              {fallen > 0 && <span className="ml-1.5 font-bold text-red-300">· 낙상 {fallen}건</span>}
            </>
          ) : (
            <>
              YOLOv8-pose · <span className="font-semibold text-zinc-300">{label}</span> · 대상{" "}
              <span className="text-zinc-400">—</span>
            </>
          )}
        </span>
      </div>
      {stats && items.length > 0 ? (
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
        <p className="text-[11px] text-zinc-500">{stats ? "감지 대상 없음" : AI_NO_RX}</p>
      )}
    </div>
  );
}

// PPE(안전모) 감지 스트립(CAM-03) — 준수율·안전모/조끼 착용 현황.
function PpeDetectionStrip({ aiApi, suffix = "3" }: { aiApi: string; suffix?: string }) {
  const { data: stats, label } = useAiStats<{
    violation_count: number;
    compliance_rate: number;
    no_hardhat_count: number;
    no_vest_count: number;
    hardhat_count: number;
    vest_count: number;
    person_count: number;
  }>(aiApi, suffix);

  const violations = stats?.violation_count ?? 0;
  // ★ 안전조끼는 과업 범위 외(2026-07-30 결정) — 착용 판정을 하지 않는다.
  //   엣지의 no_vest_count 는 하드코딩 0(판정 미구현)이라 "미착용 0" 이 화면에서는
  //   판정 결과로 읽혔다. 수치를 내보내는 대신 범위 외임을 명시한다.
  //   근거 = docs/ppe-ml-run-20260729.md 12절 (학습 1,028개 · 배포 도메인 라벨 0 ·
  //   한국 공개셋에 조끼 없음 · person P 0.593 로 포함관계 판정도 불안정).
  const chips: { label: string; ok?: number; no?: number; scoped: boolean }[] = [
    { label: "안전모", ok: stats?.hardhat_count, no: stats?.no_hardhat_count, scoped: true },
    { label: "안전조끼", scoped: false },
  ];

  return (
    <div className="border-t border-white/10 bg-black/50 px-4 py-3 text-zinc-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              !stats ? "bg-zinc-500" : violations > 0 ? "bg-red-500" : "bg-emerald-400"
            }`}
          />
          PPE 안전모 감지
        </span>
        <span className="text-[11px] text-zinc-400">
          {stats ? (
            <>
              YOLOv8 · 작업자 {stats.person_count}명 · 준수율{" "}
              <span
                className={
                  stats.compliance_rate >= 100
                    ? "text-emerald-300"
                    : stats.compliance_rate >= 50
                      ? "text-amber-300"
                      : "text-red-300"
                }
              >
                {Math.round(stats.compliance_rate)}%
              </span>
              {violations > 0 && <span className="ml-1.5 font-bold text-red-300">· 위반 {violations}건</span>}
            </>
          ) : (
            <>
              YOLOv8 · <span className="font-semibold text-zinc-300">{label}</span> · 준수율{" "}
              <span className="text-zinc-400">—</span>
            </>
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) =>
          c.scoped ? (
            <span key={c.label} className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs">
              <span className="text-zinc-300">{c.label}</span>
              <span className={stats ? "text-emerald-300" : "text-zinc-500"}>착용 {stats ? (c.ok ?? 0) : "—"}</span>
              <span className={stats && (c.no ?? 0) > 0 ? "font-bold text-red-300" : "text-zinc-500"}>
                미착용 {stats ? (c.no ?? 0) : "—"}
              </span>
            </span>
          ) : (
            <span
              key={c.label}
              title="안전조끼는 현재 판정 범위 밖입니다. 검출은 하되 착용 여부는 판정하지 않습니다."
              className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs"
            >
              <span className="text-zinc-500">{c.label}</span>
              <span className="text-zinc-500">판정 범위 외</span>
            </span>
          ),
        )}
      </div>
    </div>
  );
}

// 클릭한 카메라를 확대 표시하는 플로팅 창 — 캐러셀 transform 에 갇히지 않도록 body 로 portal.
// 드래그 이동(헤더 핸들·pointer capture) + 여러 창 동시 표시(딤 없음·뒤 대시보드 조작 가능).
function CctvModal({
  cam,
  name,
  enabled,
  onToggle,
  onClose,
  initialIndex,
  zIndex,
  onFocus,
}: {
  cam: Cam;
  name: string;
  enabled?: boolean | null;
  onToggle?: () => void;
  onClose: () => void;
  initialIndex: number; // 계단식 초기 배치 시드(마운트 시 1회)
  zIndex: number; // z-순서(앞으로 가져오기)
  onFocus: () => void; // 클릭 시 맨 앞으로
}) {
  // 창 위치·너비(fixed left/top). 마운트 시 계단 오프셋으로 초기화.
  const [pos, setPos] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const w = Math.min(720, vw - 32);
    const left = Math.max(16, Math.min(vw - w - 16, 96 + initialIndex * 32));
    const top = 84 + initialIndex * 32;
    return { left, top, w };
  });
  const dragStart = useRef<{ px: number; py: number; left: number; top: number } | null>(null);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    onFocus();
    if ((e.target as HTMLElement).closest("button")) return; // 버튼 위 클릭은 드래그 시작 안 함
    dragStart.current = { px: e.clientX, py: e.clientY, left: pos.left, top: pos.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(vw - 160, Math.max(160 - pos.w, s.left + (e.clientX - s.px)));
    const top = Math.min(vh - 48, Math.max(8, s.top + (e.clientY - s.py)));
    setPos((p) => ({ ...p, left, top }));
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 이미 해제 */
    }
  };

  return createPortal(
    <div
      className="pointer-events-auto fixed overflow-hidden rounded-2xl border border-hairline-strong bg-surface-dark shadow-2xl dark:border-white/10"
      style={{ left: pos.left, top: pos.top, width: pos.w, zIndex }}
      onPointerDown={onFocus}
      role="dialog"
      aria-label={`CCTV ${name}`}
    >
      <div>
        {/* 헤더 — 드래그 핸들 · 위치 + ID + (AI) 연결 토글 + 닫기 */}
        <div
          className="flex cursor-grab touch-none select-none items-center justify-between gap-2 bg-black/50 px-4 py-2.5 text-zinc-100 active:cursor-grabbing"
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
        >
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
// 동시에 띄울 수 있는 CCTV 팝업 최대 개수 — 라이브 MJPEG 스트림 부하 상한(초과 시 가장 오래된 창 닫힘).
const MAX_OPEN_CAMS = 4;

export function CctvQuadView({ canManage }: { canManage: boolean }) {
  // 열린 카메라 창들(배열) — 여러 창 동시. 배열 끝 = 맨 앞(z-순서). 클릭 시 앞으로 이동.
  const [openCams, setOpenCams] = useState<Cam[]>([]);
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

  // 카메라 창 열기 — 이미 열려 있으면 맨 앞으로, 아니면 추가(상한 초과 시 가장 오래된 창 제거).
  const openCam = (cam: Cam) => {
    setOpenCams((prev) => {
      if (prev.some((c) => c.id === cam.id)) {
        return [...prev.filter((c) => c.id !== cam.id), cam]; // 앞으로
      }
      const next = [...prev, cam];
      return next.length > MAX_OPEN_CAMS ? next.slice(next.length - MAX_OPEN_CAMS) : next;
    });
  };
  const closeCam = (cam: Cam) =>
    setOpenCams((prev) => prev.filter((c) => c.id !== cam.id));
  const bringToFront = (cam: Cam) =>
    setOpenCams((prev) =>
      prev[prev.length - 1]?.id === cam.id
        ? prev // 이미 맨 앞 — 불필요 재렌더 방지
        : [...prev.filter((c) => c.id !== cam.id), cam],
    );

  // ESC — 맨 앞(마지막) 창부터 닫기(창별 리스너 중복 방지 위해 부모에서 일괄 처리).
  useEffect(() => {
    if (openCams.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenCams((prev) => prev.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCams.length]);

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
      <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-px bg-white/10">
        {CAMERAS.map((cam) => (
          <CameraTile
            key={cam.id}
            cam={cam}
            name={nameOf(cam)}
            enabled={enabledOf(cam)}
            canManage={canManage}
            onRename={(value) => rename(cam.id, value)}
            onToggle={cam.aiApi ? () => toggleAi(cam) : undefined}
            onSelect={() => openCam(cam)}
          />
        ))}
      </div>
      {openCams.map((cam, i) => (
        <CctvModal
          key={cam.id}
          cam={cam}
          name={nameOf(cam)}
          enabled={enabledOf(cam)}
          onToggle={cam.aiApi ? () => toggleAi(cam) : undefined}
          onClose={() => closeCam(cam)}
          initialIndex={i}
          zIndex={50 + i}
          onFocus={() => bringToFront(cam)}
        />
      ))}
    </div>
  );
}
