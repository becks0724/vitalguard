// 로그인 직후 현장 선택 단계 — 메인 현장(스마트인재개발원 신축 공사) + 데모 현장 5개를 콤보박스로 고르고 입장. 선택값은 LoginScreen 이 site-info 로 저장.
"use client";

import { useState } from "react";

import type { SiteInfo } from "./AdminExportModal";
import { ComboBox, Input, ListBox, Header, Separator } from "./heroui-combo-box";

type Lang = "ko" | "en";
type SiteOption = { id: string; label: string; info: SiteInfo };

// 메인 현장 — 스마트인재개발원 신축 공사(데모 아님, 항상 노출). 라벨은 데모와 동일하게 "지역 현장이름" 순.
const MAIN_SITE: SiteOption = {
  id: "main",
  label: "광주 스마트인재개발원 신축 공사",
  info: {
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
      companyName: "(주)한울종합건설",
      siteName: "세종 행복도시 6-3생활권 공동주택 신축공사",
      constructionType: "건축 (공동주택)",
      address: "세종특별자치시 한누리대로 2130",
      startDate: "2026-05-04",
      completionDate: "2028-06-30",
    },
  },
];

// 데모 현장 표시는 가나다순(라벨이 "지역 현장이름" 순이라 사실상 지역 가나다 — 광주·부산·세종·인천·평택).
const SORTED_DEMO_SITES: SiteOption[] = [...DEMO_SITES].sort((a, b) =>
  a.label.localeCompare(b.label, "ko"),
);

const ALL_SITES: SiteOption[] = [MAIN_SITE, ...DEMO_SITES];

const TX: Record<Lang, Record<string, string>> = {
  ko: {
    title: "현장 선택",
    subtitle: "관제할 현장을 선택하세요",
    search: "현장 검색…",
    main: "메인 현장",
    demo: "데모 현장",
    enter: "현장 입장",
    back: "← 로그인으로",
  },
  en: {
    title: "Select site",
    subtitle: "Choose a site to monitor",
    search: "Search sites…",
    main: "Main site",
    demo: "Demo sites",
    enter: "Enter site",
    back: "← Back to login",
  },
};

export function LoginSiteSelect({
  lang,
  onConfirm,
  onBack,
}: {
  lang: Lang;
  onConfirm: (info: SiteInfo) => void;
  onBack: () => void;
}) {
  const t = TX[lang];
  const [selectedId, setSelectedId] = useState<string | null>(MAIN_SITE.id);

  const chosen = ALL_SITES.find((s) => s.id === selectedId);

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
          fullWidth
          defaultSelectedKey={MAIN_SITE.id}
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
                <ListBox.Item id={MAIN_SITE.id} textValue={MAIN_SITE.label}>
                  {MAIN_SITE.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox.Section>
              <Separator />
              <ListBox.Section>
                <Header>{t.demo}</Header>
                {SORTED_DEMO_SITES.map((s) => (
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

      <button
        type="button"
        disabled={!chosen}
        onClick={() => {
          if (chosen) onConfirm(chosen.info);
        }}
        className="mt-7 w-full rounded-pill bg-white px-4 py-3 text-sm font-semibold text-primary shadow-lg transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-white/40 disabled:text-white/70"
      >
        {t.enter}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="mt-4 text-xs text-white/75 underline-offset-2 transition hover:text-white hover:underline"
      >
        {t.back}
      </button>
    </div>
  );
}
