// 기상청 태풍정보(getTyphoonInfo) 응답 파싱 순수 유틸 — 다중 태풍(typSeq) 그룹핑·태풍별 최신 통보문 선택.
// server-only 인 typhoon.ts 에서 분리해 단위테스트 가능하게 유지(레포 관례: hospital.ts↔naver-local.ts).
import { haversineKm, KOREA_CENTER } from "./typhoon-gate";

export type TrackPoint = {
  tm: string; // typTm — 분석/예보 시각(yyyyMMddHHmm)
  lat: number; // typLat
  lon: number; // typLon
  dir?: string; // typDir — 이동방향
  speedKmh?: number; // typSp — 이동속도(km/h)
  pressureHpa?: number; // typPs — 중심기압(hPa)
  maxWindMs?: number; // typWs — 최대풍속(m/s)
  rad25?: string; // typ25 — 25m/s 반경
  rad15?: string; // typ15 — 15m/s 반경
};

export type TyphoonInfo = {
  source: "live" | "mock" | "none";
  seq?: string; // typSeq — 태풍 번호
  name?: string; // typName — 태풍명(한글)
  nameEn?: string; // typEn — 태풍명(영문)
  img?: string; // 공식 진로 이미지 URL
  tmFc?: string; // 통보문 발표시각
  track: TrackPoint[]; // 시간순 진로
  currentIndex: number; // track 중 현재(통보문 시각 최근접) 인덱스
  note?: string; // 상태 안내 문구
};

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// 통보문 발표시각(tmFc, KST yyyyMMddHHmm) → epoch ms. 형식 이상이면 null(판정 불가 → 제외하지 않음).
function tmFcToMs(tmFc: string): number | null {
  if (!/^\d{12}/.test(tmFc)) return null;
  const y = Number(tmFc.slice(0, 4));
  const mo = Number(tmFc.slice(4, 6));
  const d = Number(tmFc.slice(6, 8));
  const h = Number(tmFc.slice(8, 10));
  const mi = Number(tmFc.slice(10, 12));
  return Date.UTC(y, mo - 1, d, h - 9, mi); // KST(+9) → UTC
}

// 소멸 간주 임계 — 통보문 간격(3~6시간)의 2배. 마지막 통보문이 이보다 오래되면 태풍 종료(약화·소멸)로 보고
// 제외한다. 조회 창(2일) 안에 남은 죽은 태풍이 live 로 부활해 작업중지 배너를 점등하는 것 방지.
export const TMFC_STALE_MS = 12 * 60 * 60 * 1000;

// 통보문 시각(tmFc) 이하의 마지막 지점 = 현재 관측 위치(그 뒤 typTm 은 예보 위치).
// track 이 시간순 정렬돼 있다는 전제(groupTyphoonItems 가 보장). 최근접이 아니라 '이하의 마지막'인 이유는
// 예보점이 관측점보다 tmFc 에 가까운 경우에도 관측을 현재로 잡아야 하기 때문이다.
export function pickCurrentIndex(track: TrackPoint[], tmFc?: string): number {
  if (track.length === 0) return 0;
  if (!tmFc) return 0;
  const target = tmFc.slice(0, 12); // yyyyMMddHHmm — 고정 길이라 문자열 비교로 충분
  let best = 0;
  track.forEach((p, i) => {
    if (String(p.tm).slice(0, 12) <= target) best = i;
  });
  return best;
}

// 통보문 rows(다중 태풍·다중 발표시각 혼합) → 태풍별 TyphoonInfo[].
// 규칙 — ① typSeq 별 그룹핑
//   ② 진로 = 모든 통보문의 **관측점**(typTm ≤ tmFc) + **최신 통보문의 예보점**(typTm > tmFc).
//      관측점을 다 모아야 '지나온 경로'가 그려진다. 반면 옛 통보문의 예보점은 이미 갱신된 낡은 예측이라
//      버린다 — 섞으면 실제로 지나가지 않은 위치가 궤적에 낀다.
//      같은 typTm 이 여러 통보문에 나오면(옛 예보 vs 새 관측) **관측을 우선**하고, 동급이면 최신 통보문.
//      태풍별 발표시각이 다르므로 전역 최신 tmFc 필터는 금지(근접 태풍이 최신 발표 경쟁에서 드랍되던 버그).
//   ③ 통보문 12시간 초과 두절 = 소멸 간주 제외
//   ④ 한국 중앙 최근접 순 정렬(첫 원소 = 조기경보 대표). nowMs 는 테스트 주입용(기본 현재 시각).
export function groupTyphoonItems(
  items: Record<string, unknown>[],
  nowMs: number = Date.now(),
): TyphoonInfo[] {
  const bySeq = new Map<string, Record<string, unknown>[]>();
  for (const it of items) {
    const seq = String(it.typSeq ?? "");
    if (!seq) continue;
    const arr = bySeq.get(seq) ?? [];
    arr.push(it);
    bySeq.set(seq, arr);
  }

  const infos: TyphoonInfo[] = [];
  for (const [seq, rows] of bySeq) {
    const latestTmFc = rows.map((r) => String(r.tmFc ?? "")).sort().at(-1) ?? "";
    // 소멸 필터 — 마지막 통보문이 12시간 넘게 끊긴 태풍은 종료로 간주(죽은 태풍의 배너 점등 방지).
    const tmFcMs = tmFcToMs(latestTmFc);
    if (tmFcMs !== null && nowMs - tmFcMs > TMFC_STALE_MS) continue;
    const latest = rows.filter((r) => String(r.tmFc ?? "") === latestTmFc);

    // typTm 별 최선의 행 — 관측 우선, 동급이면 최신 통보문. 낡은 예보(옛 통보문의 미래 시각)는 버린다.
    const bySlot = new Map<string, { row: Record<string, unknown>; observed: boolean; fc: string }>();
    for (const r of rows) {
      const tm = String(r.typTm ?? "").slice(0, 12);
      const fc = String(r.tmFc ?? "").slice(0, 12);
      if (!tm) continue;
      const observed = tm <= fc; // 관측 시각은 발표시각보다 이르다(실측: 통상 1시간 전)
      if (!observed && fc !== latestTmFc.slice(0, 12)) continue;
      const prev = bySlot.get(tm);
      if (
        !prev ||
        (observed && !prev.observed) ||
        (observed === prev.observed && fc > prev.fc)
      ) {
        bySlot.set(tm, { row: r, observed, fc });
      }
    }

    const track: TrackPoint[] = [...bySlot.values()]
      .map(({ row: it }) => ({
        tm: String(it.typTm ?? ""),
        lat: num(it.typLat) ?? NaN,
        lon: num(it.typLon) ?? NaN,
        dir: it.typDir ? String(it.typDir) : undefined,
        speedKmh: num(it.typSp),
        pressureHpa: num(it.typPs),
        maxWindMs: num(it.typWs),
        rad25: it.typ25 ? String(it.typ25) : undefined,
        rad15: it.typ15 ? String(it.typ15) : undefined,
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .sort((a, b) => String(a.tm).localeCompare(String(b.tm)));
    if (track.length === 0) continue;

    const head = latest.find((r) => r.typName) ?? latest[0];
    infos.push({
      source: "live",
      seq,
      name: head?.typName ? String(head.typName) : undefined,
      nameEn: head?.typEn ? String(head.typEn) : undefined,
      img: head?.img ? String(head.img) : undefined,
      tmFc: latestTmFc || undefined,
      track,
      currentIndex: pickCurrentIndex(track, latestTmFc),
    });
  }

  // 한국 중앙 최근접 순 — 첫 원소가 조기경보 대표(최신 발표 우선이 아님, 조기경보 목적).
  const dist = (t: TyphoonInfo): number => {
    const c = t.track[Math.min(t.currentIndex, t.track.length - 1)];
    return c ? haversineKm(c.lat, c.lon, KOREA_CENTER.lat, KOREA_CENTER.lon) : Infinity;
  };
  return infos.sort((a, b) => dist(a) - dist(b));
}
