"use client";
// 인근 병원 패널 — 현장 GPS+지역으로 진료과별 병원 리스트업(캐러셀) + SOS 응급 섹션(NearestEmergency).
// /api/hospitals 프록시(네이버 지역검색)에서 조회. 키 미설정·무결과는 graceful 안내.

import { useCallback, useEffect, useState } from "react";

import {
  formatDistance,
  type Hospital,
  type HospitalResult,
} from "../lib/hospital";

function naverMapLink(h: Hospital): string {
  // 병원명(+지역)으로 네이버 지도 검색 열기. 좌표가 있으면 이름으로도 충분히 특정됨.
  return `https://map.naver.com/p/search/${encodeURIComponent(h.name)}`;
}

function useHospitals(
  lat: number | undefined,
  lon: number | undefined,
  region: string,
  scope: "full" | "emergency",
  nonce = 0,
) {
  const [data, setData] = useState<HospitalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!region) {
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    const qs = new URLSearchParams({ region, scope });
    if (lat !== undefined && lon !== undefined) {
      qs.set("lat", String(lat));
      qs.set("lon", String(lon));
    }
    fetch(`/api/hospitals?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => {
        // HTTP 오류(500 등)의 에러 JSON 을 정상 데이터로 커밋하지 않도록 catch 로 던짐
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: HospitalResult & { ok?: boolean }) => {
        setData(json);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError(true);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [lat, lon, region, scope, nonce]);

  return { data, loading, error };
}

function HospitalRow({ h }: { h: Hospital }) {
  return (
    <li className="flex items-start justify-between gap-2 border-b border-hairline py-1.5 last:border-0 dark:border-white/10">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-ink dark:text-on-dark">
            {h.name}
          </span>
          {h.distanceKm !== undefined && (
            <span className="shrink-0 rounded-pill bg-surface-strong px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-brand-accent dark:bg-white/10 dark:text-primary">
              {formatDistance(h.distanceKm)}
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-muted dark:text-on-dark-soft">
          {h.roadAddress || h.address || "주소 정보 없음"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {h.telephone && (
          <a
            href={`tel:${h.telephone.replace(/[^0-9+]/g, "")}`}
            className="rounded-md bg-surface-strong px-1.5 py-1 text-[10px] font-medium text-body transition hover:opacity-80 dark:bg-white/10 dark:text-on-dark-soft"
            title={h.telephone}
          >
            전화
          </a>
        )}
        <a
          href={naverMapLink(h)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-surface-strong px-1.5 py-1 text-[10px] font-medium text-body transition hover:opacity-80 dark:bg-white/10 dark:text-on-dark-soft"
        >
          지도
        </a>
      </div>
    </li>
  );
}

export function HospitalPanel({
  lat,
  lon,
  region,
}: {
  lat: number | undefined;
  lon: number | undefined;
  region: string;
}) {
  const [nonce, setNonce] = useState(0);
  const { data, loading, error } = useHospitals(lat, lon, region, "full", nonce);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const groups = data?.groups ?? [];
  const total = groups.reduce((acc, grp) => acc + grp.items.length, 0);

  return (
    <div className="flex h-full flex-col p-2">
      <div className="flex items-center justify-between border-b border-hairline pb-1.5 dark:border-white/10">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink dark:text-on-dark">
            인근 병원
          </span>
          {region && (
            <span className="rounded-pill bg-surface-strong px-2 py-0.5 text-[11px] font-medium text-body dark:bg-white/10 dark:text-on-dark-soft">
              {region}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || !region}
          className="grid h-6 w-6 place-items-center rounded-md text-muted transition hover:bg-surface-strong disabled:opacity-40 dark:hover:bg-white/10"
          aria-label="병원 목록 새로고침"
          title="새로고침"
        >
          <svg
            className={loading ? "animate-spin" : ""}
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      <div className="wx-cards-scroll mt-1.5 flex-1 overflow-y-auto pr-0.5">
        {!region ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-muted dark:text-on-dark-soft">
            현장 주소가 없어 지역을 도출할 수 없습니다. 관리자 메뉴에서 현장 주소를 입력하세요.
          </div>
        ) : data && !data.configured ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-muted dark:text-on-dark-soft">
            네이버 검색 API 키(NAVER_SEARCH_CLIENT_ID/SECRET) 미설정 — 발급 후 인근 병원이 표시됩니다.
          </div>
        ) : data?.authError ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-semantic-down">
            네이버 인증 실패 — 검색 API Client ID/Secret 을 확인하세요.
          </div>
        ) : loading && !data ? (
          <div className="grid h-full place-items-center text-xs text-muted dark:text-on-dark-soft">
            불러오는 중…
          </div>
        ) : error ? (
          <div className="grid h-full place-items-center text-xs text-semantic-down">
            병원 정보를 불러오지 못했습니다.
          </div>
        ) : total === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-muted dark:text-on-dark-soft">
            {region} 인근 병원 검색 결과가 없습니다.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((grp) => (
              <div key={grp.department}>
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-brand-accent dark:text-primary">
                    {grp.department}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted dark:text-on-dark-soft">
                    {grp.items.length}
                  </span>
                </div>
                <ul className="rounded-lg bg-canvas px-2 dark:bg-surface-dark">
                  {grp.items.map((h, i) => (
                    <HospitalRow key={`${h.name}-${i}`} h={h} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// SOS 긴급 모달용 축약 — 가장 가까운 응급실/종합병원 상위 3. 키 미설정·무결과·좌표없음 시 렌더 안 함.
export function NearestEmergency({
  lat,
  lon,
  region,
}: {
  lat: number | undefined;
  lon: number | undefined;
  region: string;
}) {
  const { data } = useHospitals(lat, lon, region, "emergency");
  const items = data?.nearestEmergency ?? [];
  if (!region || !data?.configured || items.length === 0) return null;

  return (
    <div className="rounded-xl border border-hairline bg-canvas p-2.5 dark:border-white/10 dark:bg-surface-dark">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-xs font-semibold text-semantic-down">
          가장 가까운 응급실·응급의료센터
        </span>
        <span className="rounded-pill bg-surface-strong px-1.5 py-0.5 text-[10px] font-medium text-body dark:bg-white/10 dark:text-on-dark-soft">
          {region}
        </span>
      </div>
      <ul className="flex flex-col">
        {items.map((h, i) => (
          <li
            key={`${h.name}-${i}`}
            className="flex items-center justify-between gap-2 border-b border-hairline py-1.5 last:border-0 dark:border-white/10"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {h.emergencyKind === "응급실" ? (
                  <span className="shrink-0 rounded-pill bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-500/20 dark:text-red-200">
                    응급실
                  </span>
                ) : (
                  h.emergencyKind === "종합병원" && (
                    <span className="shrink-0 rounded-pill bg-surface-strong px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10 dark:text-on-dark-soft">
                      종합병원
                    </span>
                  )
                )}
                <span className="truncate text-[13px] font-semibold text-ink dark:text-on-dark">
                  {h.name}
                </span>
                {h.distanceKm !== undefined && (
                  <span className="shrink-0 rounded-pill bg-surface-strong px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-semantic-down dark:bg-white/10">
                    {formatDistance(h.distanceKm)}
                  </span>
                )}
              </div>
              <div className="truncate text-[11px] text-muted dark:text-on-dark-soft">
                {h.roadAddress || h.address || ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {h.telephone && (
                <a
                  href={`tel:${h.telephone.replace(/[^0-9+]/g, "")}`}
                  className="rounded-md bg-surface-strong px-2 py-1 text-[11px] font-medium text-body transition hover:opacity-80 dark:bg-white/10 dark:text-on-dark-soft"
                >
                  전화
                </a>
              )}
              <a
                href={naverMapLink(h)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-surface-strong px-2 py-1 text-[11px] font-medium text-body transition hover:opacity-80 dark:bg-white/10 dark:text-on-dark-soft"
              >
                지도
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
