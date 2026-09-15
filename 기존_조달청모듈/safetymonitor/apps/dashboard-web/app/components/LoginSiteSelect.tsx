// 로그인 직후 DB 현장 목록을 선택한다. 기존 프리셋 9개는 목록 API 실패 시 폴백으로 유지한다.
"use client";

import { useEffect, useState } from "react";

import type { SiteRow } from "../../lib/db";
import type { SiteInfo } from "./AdminExportModal";
import { ComboBox, Input, ListBox, Header, Separator } from "./heroui-combo-box";

type Lang = "ko" | "en";
type SiteOption = { id: string; label: string; info: SiteInfo & { noticeId: string } };
type SelectableSite = SiteOption & { kind: SiteRow["kind"] };

// 메인 현장 — 스마트인재개발원 신축 공사(데모 아님, 항상 노출). 라벨은 데모와 동일하게 "지역 현장이름" 순.
const MAIN_SITE: SiteOption = {
  id: "main",
  label: "광주 스마트인재개발원 신축 공사",
  info: {
    noticeId: "SITE-SMARTHRD-2026",
    companyName: "스마트인재개발원",
    siteName: "스마트인재개발원 신축 공사",
    constructionType: "건축 (신축)",
    address: "광주광역시 광산구 임방울대로",
    startDate: "2026-01-02",
    completionDate: "2027-06-30",
  },
};

// 데모용 가상 현장 5곳 — 선택 시 대시보드 현장정보로 반영.
const DEMO_SITES: SiteOption[] = [
  {
    id: "demo-gwangju",
    label: "광주 첨단3지구 물류센터 신축",
    info: {
      noticeId: "SITE-GWANGJU-LOGI",
      companyName: "(주)스마트건설",
      siteName: "광주 첨단3지구 물류센터 신축공사",
      constructionType: "건축 (물류창고)",
      address: "광주광역시 광산구 첨단과기로 123",
      startDate: "2026-03-02",
      completionDate: "2027-02-26",
    },
  },
  {
    id: "demo-pyeongtaek",
    label: "평택 반도체 FAB 증설",
    info: {
      noticeId: "SITE-PYEONGTAEK-FAB",
      companyName: "(주)대성플랜트",
      siteName: "평택 반도체 P4 FAB 증설공사",
      constructionType: "플랜트 (반도체)",
      address: "경기도 평택시 고덕면 삼성로 1",
      startDate: "2026-01-06",
      completionDate: "2027-09-30",
    },
  },
  {
    id: "demo-busan",
    label: "부산 해운대 주상복합 신축",
    info: {
      noticeId: "SITE-BUSAN-RESI",
      companyName: "(주)해성건설",
      siteName: "부산 해운대 마린시티 주상복합 신축공사",
      constructionType: "건축 (주상복합)",
      address: "부산광역시 해운대구 우동 1408",
      startDate: "2026-04-01",
      completionDate: "2028-03-31",
    },
  },
  {
    id: "demo-incheon",
    label: "인천 송도 오피스타워 신축",
    info: {
      noticeId: "SITE-INCHEON-OFFICE",
      companyName: "(주)대륙건설",
      siteName: "인천 송도 국제업무지구 오피스타워 신축공사",
      constructionType: "건축 (업무시설)",
      address: "인천광역시 연수구 송도동 24",
      startDate: "2026-02-16",
      completionDate: "2028-01-31",
    },
  },
  {
    id: "demo-sejong",
    label: "세종 행복도시 공동주택 신축",
    info: {
      noticeId: "SITE-SEJONG-APT",
      companyName: "(주)한울종합건설",
      siteName: "세종 행복도시 6-3생활권 공동주택 신축공사",
      constructionType: "건축 (공동주택)",
      address: "세종특별자치시 한누리대로 2130",
      startDate: "2026-05-04",
      completionDate: "2028-06-30",
    },
  },
];

// 나라장터 실계약 현장 3곳 — g2b-mock 실계약 스냅샷(getCntrctInfoListCnstwk 실응답)과 noticeId 1:1 매칭.
// 기관·시공사·금액·기간 = 실값. 주소는 계약기관 관할 지역 근사(계약 API 미제공).
const REAL_SITES: SiteOption[] = [
  {
    id: "real-asan",
    label: "아산 시민문화복지센터 내진보강공사",
    info: {
      noticeId: "R26TE13895124",
      companyName: "주식회사 백산건설",
      siteName: "시민문화복지센터 내진성능 보강공사",
      constructionType: "건축 (내진보강)",
      address: "충청남도 아산시",
      startDate: "2026-04-20",
      completionDate: "2026-09-16",
    },
  },
  {
    id: "real-gwangju",
    label: "광주 사직동 코워킹스페이스 리모델링",
    info: {
      noticeId: "R26TE13894834",
      companyName: "현대도건 주식회사",
      siteName: "사직동 코워킹스페이스(녹성상회) 리모델링공사",
      constructionType: "건축 (리모델링)",
      address: "광주광역시 남구 사직동",
      startDate: "2025-11-27",
      completionDate: "2026-09-16",
    },
  },
  {
    id: "real-bonghwa",
    label: "봉화 삼계2교 교량보수공사",
    info: {
      noticeId: "R26TE13877355",
      companyName: "성광종합건설(주)",
      siteName: "삼계2교 외 2개소 교량보수공사",
      constructionType: "토목 (교량보수)",
      address: "경상북도 봉화군",
      startDate: "2026-04-15",
      completionDate: "2026-08-12",
    },
  },
];

// 데모 현장 표시는 가나다순(라벨이 "지역 현장이름" 순이라 사실상 지역 가나다 — 광주·부산·세종·인천·평택).
const SORTED_DEMO_SITES: SiteOption[] = [...DEMO_SITES].sort((a, b) =>
  a.label.localeCompare(b.label, "ko"),
);
const SORTED_REAL_SITES: SiteOption[] = [...REAL_SITES].sort((a, b) =>
  a.label.localeCompare(b.label, "ko"),
);

const FALLBACK_SITES: SelectableSite[] = [
  { ...MAIN_SITE, kind: "main" },
  ...SORTED_DEMO_SITES.map((site) => ({ ...site, kind: "demo" as const })),
  ...SORTED_REAL_SITES.map((site) => ({ ...site, kind: "contract" as const })),
];

const TX: Record<Lang, Record<string, string>> = {
  ko: {
    title: "현장 선택",
    subtitle: "관제할 현장을 선택하세요",
    search: "현장 검색…",
    main: "메인 현장",
    demo: "데모 현장",
    real: "실계약 현장 (나라장터)",
    enter: "현장 입장",
    back: "← 로그인으로",
  },
  en: {
    title: "Select site",
    subtitle: "Choose a site to monitor",
    search: "Search sites…",
    main: "Main site",
    demo: "Demo sites",
    real: "Live contract sites (G2B)",
    enter: "Enter site",
    back: "← Back to login",
  },
};

export function LoginSiteSelect({
  lang,
  token,
  onConfirm,
  onBack,
}: {
  lang: Lang;
  token: string;
  onConfirm: (info: SiteInfo, siteId: string) => Promise<void>;
  onBack: () => void;
}) {
  const t = TX[lang];
  const [sites, setSites] = useState<SelectableSite[]>(FALLBACK_SITES);
  const [selectedId, setSelectedId] = useState<string | null>(MAIN_SITE.id);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    async function load() {
      try {
        const response = await fetch("/api/sites", {
          // /api/admin/login의 createSession() 발급 토큰 — getSession()이 이 헤더를 검증한다.
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const json = (await response.json()) as { ok?: boolean; sites?: SiteRow[] };
        if (!response.ok || !json.ok || !Array.isArray(json.sites)) return;
        const loaded = json.sites.map((site): SelectableSite => {
          if (!site || typeof site.site_id !== "string" || !site.site_id ||
              typeof site.ui_key !== "string" || !site.ui_key || typeof site.label !== "string" ||
              !["main", "demo", "contract"].includes(site.kind)) {
            throw new Error("현장 목록 형식 오류");
          }
          return {
            id: site.ui_key,
            kind: site.kind,
            label: site.label,
            info: {
              noticeId: site.site_id,
              companyName: site.company_name ?? "",
              siteName: site.site_name ?? "",
              constructionType: site.construction_type ?? "",
              address: site.address ?? "",
              startDate: site.start_date ?? "",
              completionDate: site.completion_date ?? "",
            },
          };
        });
        if (controller.signal.aborted) return;
        setSites(loaded);
        setSelectedId((current) => loaded.some((site) => site.id === current)
          ? current : loaded[0]?.id ?? null);
      } catch {
        // 네트워크·JSON 오류·시간 초과에도 기존 상수 목록으로 선택할 수 있다.
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [token]);

  const chosen = sites.find((s) => s.id === selectedId);

  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <h2
        className="text-center text-2xl text-white drop-shadow-lg"
        style={{ fontFamily: "'Archivo Black', 'Do Hyeon', system-ui, sans-serif" }}
      >
        {t.title}
      </h2>
      <p className="mt-2 text-center text-sm text-white/85 drop-shadow">{t.subtitle}</p>

      <div className="mt-6 w-full">
        <ComboBox
          key={sites === FALLBACK_SITES ? "fallback" : "server"}
          fullWidth
          defaultSelectedKey={selectedId ?? undefined}
          isDisabled={saving}
          menuTrigger="focus"
          onSelectionChange={(key) => setSelectedId(key == null ? null : String(key))}
        >
          <ComboBox.InputGroup>
            <Input placeholder={t.search} aria-label={t.title} />
            <ComboBox.Trigger />
          </ComboBox.InputGroup>
          <ComboBox.Popover>
            <ListBox>
              <ListBox.Section>
                <Header>{t.main}</Header>
                {sites.filter((site) => site.kind === "main").map((s) => (
                  <ListBox.Item key={s.id} id={s.id} textValue={s.label}>
                    {s.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
              <Separator />
              <ListBox.Section>
                <Header>{t.demo}</Header>
                {sites.filter((site) => site.kind === "demo").map((s) => (
                  <ListBox.Item key={s.id} id={s.id} textValue={s.label}>
                    {s.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
              <Separator />
              <ListBox.Section>
                <Header>{t.real}</Header>
                {sites.filter((site) => site.kind === "contract").map((s) => (
                  <ListBox.Item key={s.id} id={s.id} textValue={s.label}>
                    {s.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>
      </div>

      {saveError && <p role="alert" className="mt-4 text-sm text-red-100">{saveError}</p>}
      <button
        type="button"
        disabled={!chosen || saving}
        onClick={async () => {
          if (!chosen || saving) return;
          setSaving(true);
          setSaveError(null);
          try {
            await onConfirm(chosen.info, chosen.id);
          } catch (error) {
            setSaveError(error instanceof Error ? error.message : "현장 선택 저장에 실패했습니다. 다시 시도해 주세요.");
          } finally {
            setSaving(false);
          }
        }}
        className="mt-7 w-full rounded-pill bg-white px-4 py-3 text-sm font-semibold text-primary shadow-lg transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-white/40 disabled:text-white/70"
      >
        {saving ? "현장 저장 중…" : t.enter}
      </button>

      <button
        type="button"
        disabled={saving}
        onClick={onBack}
        className="mt-4 text-xs text-white/75 underline-offset-2 transition hover:text-white hover:underline"
      >
        {t.back}
      </button>
    </div>
  );
}
