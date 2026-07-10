"use client";
// 스마트경리(데모) — 시공사 회계 시스템 역할극 화면. 관제 대시보드와 별개 시스템처럼 보이도록 자체 룩.
// 화면 구조는 실무 엑셀 서식 「산업안전보건관리비 사용계획서」(산업안전보건법 시행규칙 별지 제102호서식 계열)를 따른다:
//   ① 사용계획서(일반사항 + 공사원가 입력 → 계상대상금액·계상금액 자동산출, 1.2배 상한 규칙 포함)
//   ② 항목별 사용계획(법정 9항목 실행계획 · 금액/비율)
//   ③ 사용내역·증빙(매입 전자세금계산서) → '발주처 검증시스템 전송' = POST /api/tax-invoice
// 계상 산출은 관제와 동일한 현행 고시(제2025-11호) 요율 엔진(lib/safety-cost)을 재사용 — 두 시스템이 같은 법정 기준.
import { useEffect, useMemo, useState } from "react";

import { computeRequiredSafetyCost, SAFETY_COST_RATES, type RateRow } from "../lib/safety-cost";
import type { ConstructionType } from "../lib/safeprocure-types";

type Item = { name: string; spec?: string; qty: number; unit: number; supply: number; tax: number };
type Invoice = {
  siteId: string;
  approvalNo: string;
  writeDate: string;
  supplierName: string;
  supplierBno: string;
  buyerName: string;
  buyerBno: string;
  items: Item[];
};

type Company = {
  siteId: string;
  name: string; // 시공사(공급받는자)
  siteName: string;
  client: string; // 발주자
  period: string; // 사업기간
  type: ConstructionType;
  material: number; // ①재료비(원)
  provided: number; // ②관급재료비 또는 지급자재액(원)
  labor: number; // ③직접노무비(원)
  winRate: number | null; // 낙찰률(%)
};

// 시공사·현장 — 현장 선택 드롭다운(LoginSiteSelect)·계약 목록과 siteId 1:1. 공사원가는 [데모값].
const COMPANIES: Company[] = [
  {
    siteId: "SITE-SMARTHRD-2026",
    name: "스마트인재개발원",
    siteName: "광주 스마트인재개발원 신축 공사",
    client: "광주광역시",
    period: "2026년 1월 2일 ~ 2027년 6월 30일",
    type: "건축공사",
    material: 4_500_000_000,
    provided: 500_000_000,
    labor: 3_200_000_000,
    winRate: 78.5,
  },
  {
    siteId: "R26TE13895124",
    name: "주식회사 백산건설",
    siteName: "아산 시민문화복지센터 내진성능 보강공사",
    client: "충청남도 아산시",
    period: "2026년 4월 20일 ~ 2026년 9월 16일",
    type: "건축공사",
    material: 260_000_000,
    provided: 40_000_000,
    labor: 190_000_000,
    winRate: null,
  },
  {
    siteId: "R26TE13894834",
    name: "현대도건 주식회사",
    siteName: "광주 사직동 코워킹스페이스 리모델링공사",
    client: "광주광역시 남구",
    period: "2025년 11월 27일 ~ 2026년 9월 16일",
    type: "건축공사",
    material: 130_000_000,
    provided: 0,
    labor: 110_000_000,
    winRate: null,
  },
  {
    siteId: "R26TE13877355",
    name: "성광종합건설(주)",
    siteName: "봉화 삼계2교 외 2개소 교량보수공사",
    client: "경상북도 봉화군",
    period: "2026년 4월 15일 ~ 2026년 8월 12일",
    type: "토목공사",
    material: 60_000_000,
    provided: 0,
    labor: 50_000_000,
    winRate: null,
  },
];

// 법정 사용항목 9종(고시 제7조) — 서식 '2. 항목별 실행계획' 행 순서 그대로.
const PLAN_ITEMS = [
  "안전·보건관리자 임금 등",
  "안전시설비 등",
  "개인보호구 및 안전장구 구입비",
  "안전보건진단비 등",
  "안전보건교육비 등",
  "근로자 건강장해 예방비 등",
  "건설재해예방전문지도기관 기술지도비",
  "본사 전담조직 근로자 임금 등",
  "위험성평가 등에 따른 소요비용",
] as const;
// 실행계획 배분율 [데모값] — 참고 서식 사례와 유사한 구성(합계 100%). 계상액이 바뀌면 금액 자동 재배분.
const PLAN_SPLIT = [0.1, 0.3, 0.2, 0.08, 0.2, 0.12, 0, 0, 0];

// '3. 개인보호구 및 안전장구 구입비' 상세 내역 — 현장별 품목·수량·단가 구매계획.
// 실계약 3현장 품목은 공종별 리서치(산업안전보건기준 규칙 §32 위험→보호구 매핑 + KCs 12종 +
// 고시 제2025-11호 제7조 3호 계상범위 + 시장 통상단가, dist/ppe-by-construction-type STORM 종합) 기반.
// 규격란에 위험을 명시(감리 삭감 방어 관행). 수량 = 배치 인원 + 예비, 소모품은 매·쌍·세트 단위.
// 항목 3 계상액 = 이 상세 합계. 제출 시 품목 단위로 ④증액 검증의 대조 기준이 된다.
// shopKey = 종합쇼핑몰 검색용 세부품명(품목명이 복합어라 직접 검색이 안 되는 항목만 지정).
type PpePlanItem = { name: string; spec: string; uom?: string; qty: number; unit: number; shopKey?: string };
const PPE_PLAN: Record<string, PpePlanItem[]> = {
  "SITE-SMARTHRD-2026": [
    { name: "안전모", spec: "AB형 통풍·KCs", uom: "개", qty: 16, unit: 25_000 },
    { name: "안전화", spec: "6인치 절연·KCs", uom: "족", qty: 14, unit: 60_000 },
    { name: "안전대", spec: "그네식 더블 죔줄·KCs", uom: "개", qty: 8, unit: 80_000 },
  ],
  // ① 내진성능 보강(6명) — 치핑·천공 실리카(방진 1급), 철골 용접, 에폭시 수지 접촉.
  R26TE13895124: [
    { name: "안전모", spec: "AB형 통풍(하절기 시공)·KCs", uom: "개", qty: 8, unit: 25_000 },
    { name: "안전화", spec: "6인치 절연·KCs", uom: "족", qty: 7, unit: 60_000 },
    { name: "안전대", spec: "그네식 더블 죔줄·KCs (브레이스 설치 고소)", uom: "개", qty: 5, unit: 80_000 },
    { name: "방진마스크", spec: "1급 안면부여과식 (치핑·천공 실리카)", uom: "매", qty: 60, unit: 2_000 },
    { name: "방독마스크", spec: "반면형+유기화합물 정화통 (에폭시 수지)", uom: "세트", qty: 7, unit: 40_000 },
    { name: "보안경", spec: "김서림방지·KCs (치핑 비산물)", uom: "개", qty: 8, unit: 8_000 },
    { name: "용접용 보안면", spec: "자동차광 (철골 브레이스 용접)", uom: "개", qty: 2, unit: 78_000, shopKey: "용접면" },
    { name: "용접장갑", spec: "가죽·방열", uom: "켤레", qty: 6, unit: 6_000 },
    { name: "내화학 장갑", spec: "니트릴 (에폭시 접촉 방지)", uom: "켤레", qty: 12, unit: 6_000 },
    { name: "귀마개", spec: "폼 1회용 (치핑·천공 소음)", uom: "쌍", qty: 100, unit: 300 },
  ],
  // ② 실내 리모델링(5명) — 도장·접착 유기용제(방독+정화통 교체분), 목분진(방진 2급), 전기 작업.
  R26TE13894834: [
    { name: "안전모", spec: "경량 AB형·KCs", uom: "개", qty: 6, unit: 25_000 },
    { name: "안전화", spec: "6인치 경량·KCs", uom: "족", qty: 6, unit: 60_000 },
    { name: "방독마스크", spec: "반면형+유기화합물 정화통 (도장·접착 용제)", uom: "세트", qty: 6, unit: 40_000 },
    { name: "방독 정화통", spec: "유기화합물용 2개입 (교체분)", uom: "세트", qty: 12, unit: 11_000, shopKey: "정화통" },
    { name: "방진마스크", spec: "2급 안면부여과식 (목분진·철거분진)", uom: "매", qty: 50, unit: 1_000 },
    { name: "보안경", spec: "김서림방지·KCs (전동공구 비산물)", uom: "개", qty: 6, unit: 12_000 },
    { name: "절연장갑", spec: "저압용·KCs (전기 작업)", uom: "켤레", qty: 2, unit: 30_000 },
    { name: "절단방지장갑", spec: "컷레벨5 (철거·목공)", uom: "켤레", qty: 10, unit: 5_000 },
    { name: "안전대", spec: "그네식 싱글 죔줄·KCs (우마·사다리 고소)", uom: "개", qty: 3, unit: 70_000 },
    { name: "귀마개", spec: "폼 1회용 (전동공구 소음)", uom: "쌍", qty: 80, unit: 300 },
  ],
  // ③ 교량 보수(4명) — 교하부 추락(더블 죔줄+추락방지대), 도로변 차량(고휘도 조끼), 하천 인접(구명조끼).
  //    안전대 계획 5개 vs 시드 계산서 청구 6개 → 품목 초과 증액 시나리오 유지.
  R26TE13877355: [
    { name: "안전대", spec: "그네식 더블 죔줄·KCs (교하부 추락)", uom: "개", qty: 5, unit: 80_000 },
    { name: "추락방지대", spec: "안전블록/로프그립 (승·하강)", uom: "개", qty: 4, unit: 34_000 },
    { name: "안전모", spec: "AB형·KCs", uom: "개", qty: 5, unit: 25_000 },
    { name: "안전화", spec: "6인치 방수·KCs (하천 인접)", uom: "족", qty: 5, unit: 60_000 },
    { name: "고휘도 안전조끼", spec: "도로변 차량 통행 대응·반사", uom: "개", qty: 5, unit: 12_000, shopKey: "안전조끼" },
    { name: "구명조끼", spec: "KC 성인용 (하천 인접 교하부)", uom: "개", qty: 5, unit: 44_000 },
    { name: "방진마스크", spec: "1급 안면부여과식 (치핑 실리카)", uom: "매", qty: 40, unit: 2_000 },
    { name: "방독마스크", spec: "반면형+유기화합물 정화통 (교량 도장)", uom: "세트", qty: 5, unit: 40_000 },
    { name: "보안면", spec: "투명 페이스쉴드 (치핑 비산물)", uom: "개", qty: 4, unit: 8_000 },
    { name: "귀마개", spec: "폼 1회용 (치핑 소음)", uom: "쌍", qty: 60, unit: 300 },
  ],
};

function inv(
  siteId: string,
  approvalNo: string,
  writeDate: string,
  supplierName: string,
  supplierBno: string,
  items: { name: string; spec?: string; qty: number; unit: number }[],
): Invoice {
  const buyer = COMPANIES.find((c) => c.siteId === siteId)!;
  return {
    siteId,
    approvalNo,
    writeDate,
    supplierName,
    supplierBno,
    buyerName: buyer.name,
    buyerBno: "***-**-*****", // 데모 — 마스킹
    items: items.map((i) => ({ ...i, supply: i.qty * i.unit, tax: Math.round(i.qty * i.unit * 0.1) })),
  };
}

// 매입 세금계산서 시드 — 전자세금계산서 표준 필드 기반 [데모값]. '3.개인보호구' 항목의 사용내역 증빙.
// 수량은 현장별 워치 실측 인원과 다르게 구성 → 증액 검증 판정(정상/주의/의심)이 현장마다 갈리게.
const SEED_INVOICES: Invoice[] = [
  inv("SITE-SMARTHRD-2026", "20260617-41000012-77120034", "2026-06-17", "대한안전산업(주)", "123-81-45678", [
    { name: "안전모", spec: "AB형 통풍", qty: 14, unit: 25_000 },
    { name: "안전화", spec: "6인치 절연", qty: 12, unit: 60_000 },
    { name: "안전대", spec: "그네식 더블", qty: 8, unit: 80_000 },
  ]),
  inv("R26TE13895124", "20260702-52000341-90233412", "2026-07-02", "충남세이프텍(주)", "312-86-01234", [
    { name: "안전모", spec: "AB형", qty: 10, unit: 25_000 },
    { name: "안전화", spec: "6인치", qty: 7, unit: 60_000 },
    { name: "안전대", spec: "그네식", qty: 6, unit: 80_000 },
  ]),
  inv("R26TE13895124", "20260625-52000341-11543209", "2026-06-25", "충남세이프텍(주)", "312-86-01234", [
    { name: "방진마스크", spec: "1급 배기밸브", qty: 12, unit: 5_000 },
  ]),
  inv("R26TE13894834", "20260628-41500222-38765001", "2026-06-28", "호남안전물산(주)", "409-81-33210", [
    { name: "안전모", spec: "AB형", qty: 6, unit: 25_000 },
    { name: "안전화", spec: "6인치", qty: 5, unit: 60_000 },
    { name: "보안경", spec: "김서림방지", qty: 5, unit: 12_000 },
  ]),
  inv("R26TE13877355", "20260701-36200155-64209871", "2026-07-01", "경북산업안전(주)", "514-87-20981", [
    { name: "안전모", spec: "AB형", qty: 5, unit: 25_000 },
    { name: "안전대", spec: "그네식 더블", qty: 6, unit: 80_000 },
    { name: "안전화", spec: "6인치 방수", qty: 4, unit: 60_000 },
  ]),
];

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}
function pct(r: number): string {
  return `${(r * 100).toFixed(2)}%`;
}

// 계상금액 산출 — 대상액(①+②+③)에 요율 적용 + 고시 제4조 1.2배 상한:
// 관급재료비 포함 계상액이 [관급 제외 대상액 계상액 × 1.2]를 초과하면 작은 값을 적용.
function computeAppropriation(
  c: Company,
  material: number,
  provided: number,
  labor: number,
  rates: Record<ConstructionType, RateRow>,
) {
  const targetWith = material + provided + labor;
  const withProvided = computeRequiredSafetyCost(c.type, targetWith, rates);
  if (provided <= 0) return { target: targetWith, final: withProvided.requiredCost, capApplied: false, calc: withProvided };
  const without = computeRequiredSafetyCost(c.type, material + labor, rates);
  const cap = Math.round(without.requiredCost * 1.2);
  const capApplied = withProvided.requiredCost > cap;
  return { target: targetWith, final: capApplied ? cap : withProvided.requiredCost, capApplied, calc: withProvided, cap };
}

type Tab = "plan" | "usage" | "invoice";

export default function ErpDemoPage() {
  const [siteId, setSiteId] = useState(COMPANIES[1]!.siteId);
  const [tab, setTab] = useState<Tab>("plan");
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 공사원가 입력(서식 상단 '공사금액' 입력란) — 수정하면 계상액·실행계획 자동 재산출.
  const [costs, setCosts] = useState<Record<string, { material: number; provided: number; labor: number }>>(
    Object.fromEntries(COMPANIES.map((c) => [c.siteId, { material: c.material, provided: c.provided, labor: c.labor }])),
  );
  // 법제처 별표1 실시간 요율 — /api/safety-rate/notice 가 고시 원문 HWP 에서 파싱한 요율표.
  // 수신 성공 시 계상 산출에 이 요율을 사용, 실패/미수신이면 내장 요율표(제2025-11호) 폴백.
  const [liveRates, setLiveRates] = useState<{ rates: Record<ConstructionType, RateRow>; noticeNo: string } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/safety-rate/notice");
        if (!r.ok) return;
        const j = (await r.json()) as {
          latest: { noticeNo: string } | null;
          applied: { noticeNo: string };
          rateCheck: { rates: Record<ConstructionType, RateRow> } | null;
        };
        if (alive && j.rateCheck?.rates) {
          setLiveRates({ rates: j.rateCheck.rates, noticeNo: j.latest?.noticeNo ?? j.applied.noticeNo });
        }
      } catch {
        // 조회 실패 → 내장 요율 폴백
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 나라장터 실계약 연동 — 대시보드와 동일한 /api/g2b/contracts 에서 계약 실데이터
  // (공사명·계약기관·착공/준공·계약금액)를 받아 사용계획서 표시·공사원가 유도에 사용.
  type LiveContract = { title: string; agency: string; startDate: string | null; endDate: string | null; amount: number | null; winRate: number | null };
  const [liveContracts, setLiveContracts] = useState<Record<string, LiveContract>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/g2b/contracts");
        if (!r.ok) return;
        const j = (await r.json()) as {
          items: { id: string; title: string; agency: string; startDate: string | null; endDate: string | null; estimatedPrice: number | null; winRate?: number | null }[];
        };
        if (!alive) return;
        const map: Record<string, LiveContract> = {};
        for (const it of j.items) {
          map[it.id] = { title: it.title, agency: it.agency, startDate: it.startDate, endDate: it.endDate, amount: it.estimatedPrice, winRate: it.winRate ?? null };
        }
        setLiveContracts(map);
        // 실계약 현장(R26TE…) 공사원가 자동 유도 — 계약금액(실데이터) × 통상 구성비[추정]:
        // 재료비 42% · 직접노무비 28% (계약 API 에 관급 정보 없음 → 0). 백만원 반올림, 입력칸에서 수정 가능.
        setCosts((prev) => {
          const next = { ...prev };
          for (const c of COMPANIES) {
            if (!c.siteId.startsWith("R26TE")) continue;
            const amt = map[c.siteId]?.amount;
            if (!amt) continue;
            const mm = (ratio: number) => Math.round((amt * ratio) / 1_000_000) * 1_000_000;
            next[c.siteId] = { material: mm(0.42), provided: 0, labor: mm(0.28) };
          }
          return next;
        });
      } catch {
        // 연동 실패 → 시드값 폴백
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/tax-invoice");
        if (!r.ok) return;
        const j = (await r.json()) as { rows: { approval_no: string }[] };
        if (alive) setSent(new Set(j.rows.map((x) => x.approval_no)));
      } catch {
        // 조회 실패 → 미전송으로 표시
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const company = COMPANIES.find((c) => c.siteId === siteId)!;
  const liveC = liveContracts[siteId];
  const isRealSite = siteId.startsWith("R26TE");
  const cost = costs[siteId] ?? { material: 0, provided: 0, labor: 0 };
  const activeRates = liveRates?.rates ?? SAFETY_COST_RATES;
  const appr = useMemo(
    () => computeAppropriation(company, cost.material, cost.provided, cost.labor, activeRates),
    [company, cost.material, cost.provided, cost.labor, activeRates],
  );
  // 종합쇼핑몰 실단가 — /api/g2b/shop-prices 가 품목별 다수공급자계약 단가(중위값)·실품목명을 반환.
  // 수신 성공 품목은 통상 시장가[데모값] 대신 실단가 사용, 미승인/실패는 데모 단가 유지(graceful).
  type ShopPriceRow = { name: string; spec: string | null; price: number; corp: string | null };
  const [shopPrices, setShopPrices] = useState<Record<string, ShopPriceRow>>({});
  useEffect(() => {
    const keys = [...new Set((PPE_PLAN[siteId] ?? []).map((d) => d.shopKey ?? d.name))];
    if (keys.length === 0) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/g2b/shop-prices?names=${encodeURIComponent(keys.join(","))}`);
        if (!r.ok) return;
        const j = (await r.json()) as { source: string; prices: Record<string, ShopPriceRow> };
        if (alive && j.source === "live") setShopPrices((prev) => ({ ...prev, ...j.prices }));
      } catch {
        // 조회 실패 → 데모 단가 유지
      }
    })();
    return () => {
      alive = false;
    };
  }, [siteId]);

  // 항목 3(개인보호구)은 상세 구매계획 합계로 확정, 배분율과의 차액은 항목 2(안전시설비)가 흡수 → 합계 = 계상액 유지.
  const ppeDetail = PPE_PLAN[siteId] ?? [];
  const shopOf = (d: PpePlanItem) => shopPrices[d.shopKey ?? d.name];
  const effUnit = (d: PpePlanItem) => shopOf(d)?.price ?? d.unit;
  const shopHits = ppeDetail.filter((d) => shopOf(d)).length;
  const ppeTotal = ppeDetail.reduce((s, d) => s + d.qty * effUnit(d), 0);
  const [ppeOpen, setPpeOpen] = useState(false);
  const planAmounts = useMemo(() => {
    const base = PLAN_SPLIT.map((p) => Math.round((appr.final * p) / 10_000) * 10_000);
    if (ppeTotal > 0) {
      base[1] = Math.max(0, (base[1] ?? 0) + (base[2] ?? 0) - ppeTotal);
      base[2] = ppeTotal;
    }
    return base;
  }, [appr.final, ppeTotal]);
  const planTotal = planAmounts.reduce((s, n) => s + n, 0);
  const invoices = useMemo(() => SEED_INVOICES.filter((i) => i.siteId === siteId), [siteId]);

  function setCost(field: "material" | "provided" | "labor", value: string) {
    const n = Math.max(0, Number(value.replace(/[^0-9]/g, "")) || 0);
    setCosts((prev) => ({ ...prev, [siteId]: { ...(prev[siteId] ?? { material: 0, provided: 0, labor: 0 }), [field]: n } }));
  }

  // 사용계획서 제출 — 계상액·항목별 계획을 발주처 검증시스템(/api/use-plan)에 upsert.
  const [planSent, setPlanSent] = useState<Set<string>>(new Set());
  const [planBusy, setPlanBusy] = useState(false);
  async function submitPlan() {
    setPlanBusy(true);
    try {
      const r = await fetch("/api/use-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          targetAmount: appr.target,
          appropriated: appr.final,
          // 항목 3은 품목 상세 동봉 → ④증액 검증이 청구 내역과 품목 단위 대조. 단가는 쇼핑몰 실단가 반영값.
          items: PLAN_ITEMS.map((name, i) => ({
            name,
            amount: planAmounts[i] ?? 0,
            ...(i === 2 && ppeDetail.length > 0
              ? { detail: ppeDetail.map((d) => ({ name: d.name, spec: d.spec, uom: d.uom, qty: d.qty, unit: effUnit(d) })) }
              : {}),
          })),
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPlanSent((prev) => new Set(prev).add(siteId));
      setToast("사용계획서 — 발주처 검증시스템 제출 완료 (증액 검증 기준 반영)");
    } catch {
      setToast("계획서 제출 실패 — 검증시스템 연결을 확인하세요");
    } finally {
      setPlanBusy(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  async function send(invoice: Invoice) {
    setBusy(invoice.approvalNo);
    try {
      const r = await fetch("/api/tax-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: invoice.siteId,
          approvalNo: invoice.approvalNo,
          writeDate: invoice.writeDate,
          supplierName: invoice.supplierName,
          supplierBno: invoice.supplierBno,
          buyerName: invoice.buyerName,
          buyerBno: invoice.buyerBno,
          supplyAmount: invoice.items.reduce((s, i) => s + i.supply, 0),
          taxAmount: invoice.items.reduce((s, i) => s + i.tax, 0),
          items: invoice.items,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSent((prev) => new Set(prev).add(invoice.approvalNo));
      setToast(`승인번호 ${invoice.approvalNo} — 발주처 검증시스템 전송 완료`);
    } catch {
      setToast("전송 실패 — 검증시스템 연결을 확인하세요");
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 4000);
    }
  }

  const inputCls =
    "w-full rounded border border-slate-300 bg-amber-50 px-2 py-1 text-right text-sm tabular-nums focus:border-indigo-500 focus:outline-none";
  const th = "border border-slate-300 bg-slate-200 px-2 py-1.5 text-center text-[11px] font-semibold text-slate-700";
  const td = "border border-slate-300 px-2 py-1.5 text-[12px]";

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900">
      <header className="bg-indigo-700 px-6 py-3 text-white shadow">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-white/20 text-sm font-black">경</span>
            <div>
              <div className="text-sm font-bold leading-tight">스마트경리 SmartLedger</div>
              <div className="text-[10px] text-indigo-200">시공사 회계 시스템 (데모) · 산업안전보건관리비 사용계획·증빙</div>
            </div>
          </div>
          <span className="rounded bg-amber-400/90 px-2 py-0.5 text-[10px] font-bold text-amber-950">DEMO</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {/* 시공사 선택 + 탭 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm"
          >
            {COMPANIES.map((c) => (
              <option key={c.siteId} value={c.siteId}>
                {c.name} — {c.siteName}
              </option>
            ))}
          </select>
          <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white text-xs shadow-sm">
            {(
              [
                ["plan", "① 사용계획서"],
                ["usage", "② 항목별 사용계획"],
                ["invoice", "③ 사용내역·증빙 전송"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 font-semibold ${tab === key ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === "plan" && (
          <section className="rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
            <p className="text-[10px] text-slate-500">■ 산업안전보건법 시행규칙 [별지 제102호서식] 계열 · 데모 재현</p>
            <h1 className="mt-1 border-y-2 border-slate-800 py-2 text-center text-lg font-black tracking-[0.3em]">
              산업안전보건관리비 사용계획서
            </h1>

            {/* 1. 일반사항 */}
            <h2 className="mt-4 text-sm font-bold">1. 일반사항</h2>
            <table className="mt-1 w-full border-collapse">
              <tbody>
                <tr>
                  <td className={`${td} w-24 bg-slate-200 text-center font-semibold`}>공사현장</td>
                  <td className={td} colSpan={3}>
                    {liveC?.title ?? company.siteName}
                    {isRealSite && (
                      <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        나라장터 실계약 연동
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className={`${td} bg-slate-200 text-center font-semibold`}>사업기간</td>
                  <td className={td} colSpan={3}>
                    {liveC?.startDate ? `${liveC.startDate} ~ ${liveC.endDate ?? "—"}` : company.period}
                  </td>
                </tr>
                <tr>
                  <td className={`${td} bg-slate-200 text-center font-semibold`}>발주자</td>
                  <td className={td}>{liveC?.agency ?? company.client}</td>
                  <td className={`${td} w-24 bg-slate-200 text-center font-semibold`}>시공사</td>
                  <td className={td}>{company.name}</td>
                </tr>
                <tr>
                  <td className={`${td} bg-slate-200 text-center font-semibold`}>계약금액</td>
                  <td className={td}>
                    {liveC?.amount ? won(liveC.amount) : "—"}
                    {isRealSite && <span className="ml-1 text-[10px] text-slate-400">(계약번호 {siteId})</span>}
                  </td>
                  <td className={`${td} bg-slate-200 text-center font-semibold`}>원가 구성</td>
                  <td className={`${td} text-[10px] text-slate-500`}>
                    {isRealSite ? "계약금액 × 통상 구성비[추정] 자동 유도 · 수정 가능" : "데모값 · 수정 가능"}
                  </td>
                </tr>
                <tr>
                  <td className={`${td} bg-slate-200 text-center font-semibold`}>공사종류</td>
                  <td className={td}>{company.type} <span className="text-[10px] text-slate-400">(고시 제2025-11호 4공종)</span></td>
                  <td className={`${td} bg-slate-200 text-center font-semibold`}>낙찰률</td>
                  <td className={td}>
                    {liveC?.winRate != null ? (
                      <>
                        {liveC.winRate}%
                        <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-bold text-emerald-700">낙찰정보 연동</span>
                      </>
                    ) : company.winRate != null ? (
                      `${company.winRate}%`
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* 공사금액 입력 → 자동산출 */}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th} colSpan={2}>공사금액 (입력 → 자동산출)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={`${td} w-44 bg-slate-50`}>① 재료비 (관급 별도)</td>
                    <td className={td}>
                      <input className={inputCls} value={cost.material.toLocaleString("ko-KR")} onChange={(e) => setCost("material", e.target.value)} />
                    </td>
                  </tr>
                  <tr>
                    <td className={`${td} bg-slate-50`}>② 관급재료비·지급자재액</td>
                    <td className={td}>
                      <input className={inputCls} value={cost.provided.toLocaleString("ko-KR")} onChange={(e) => setCost("provided", e.target.value)} />
                    </td>
                  </tr>
                  <tr>
                    <td className={`${td} bg-slate-50`}>③ 직접노무비</td>
                    <td className={td}>
                      <input className={inputCls} value={cost.labor.toLocaleString("ko-KR")} onChange={(e) => setCost("labor", e.target.value)} />
                    </td>
                  </tr>
                </tbody>
              </table>

              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th} colSpan={2}>계상 자동산출 (①+②+③ 대상액 기준)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={`${td} w-44 bg-slate-50`}>계상 대상금액</td>
                    <td className={`${td} text-right font-semibold tabular-nums`}>{won(appr.target)}</td>
                  </tr>
                  <tr>
                    <td className={`${td} bg-slate-50`}>적용 요율</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {pct(appr.calc.rateApplied)}
                      {appr.calc.baseAdded > 0 ? ` + 기초액 ${won(appr.calc.baseAdded)}` : ""}
                      <span className="ml-1 text-[10px] text-slate-400">({company.type})</span>
                    </td>
                  </tr>
                  <tr>
                    <td className={`${td} bg-slate-50`}>요율 출처</td>
                    <td className={`${td} text-right text-[11px]`}>
                      {liveRates ? (
                        <span className="font-semibold text-emerald-700">법제처 별표1 실시간 (고시 {liveRates.noticeNo})</span>
                      ) : (
                        <span className="text-slate-500">내장 요율표 (고시 제2025-11호)</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className={`${td} bg-slate-50`}>1.2배 상한 규칙</td>
                    <td className={`${td} text-right text-[11px]`}>
                      {cost.provided > 0
                        ? appr.capApplied
                          ? `적용 — 관급 제외 계상액 × 1.2 = ${won(appr.cap ?? 0)}`
                          : "미적용 (상한 이내)"
                        : "해당 없음 (관급 0원)"}
                    </td>
                  </tr>
                  <tr>
                    <td className={`${td} bg-amber-100 font-bold`}>산업안전보건관리비 (계상)</td>
                    <td className={`${td} bg-amber-100 text-right text-base font-black tabular-nums text-indigo-800`}>{won(appr.final)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 2. 항목별 실행계획 */}
            <h2 className="mt-5 text-sm font-bold">2. 항목별 실행계획</h2>
            <table className="mt-1 w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>항목</th>
                  <th className={`${th} w-36`}>금액</th>
                  <th className={`${th} w-20`}>비율(%)</th>
                </tr>
              </thead>
              <tbody>
                {PLAN_ITEMS.map((label, i) => (
                  <tr
                    key={label}
                    onClick={i === 2 && ppeDetail.length > 0 ? () => setPpeOpen((v) => !v) : undefined}
                    className={i === 2 && ppeDetail.length > 0 ? "cursor-pointer select-none hover:bg-indigo-50" : undefined}
                  >
                    <td className={td}>
                      {i + 1}. {label}
                      {i === 2 && ppeDetail.length > 0 && (
                        <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                          {ppeOpen ? "상세 내역 닫기 ▴" : "클릭 → 상세 내역 ▾"}
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{planAmounts[i] ? won(planAmounts[i]!) : "-"}</td>
                    <td className={`${td} text-right tabular-nums`}>{planTotal > 0 ? (((planAmounts[i] ?? 0) / planTotal) * 100).toFixed(1) : "0.0"}%</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className={`${td} bg-slate-50`}>합계</td>
                  <td className={`${td} bg-slate-50 text-right tabular-nums`}>{won(planTotal)}</td>
                  <td className={`${td} bg-slate-50 text-right`}>100%</td>
                </tr>
              </tbody>
            </table>

            {/* 항목 3 상세 내역 탭 — 실행계획 표에서 '3. 개인보호구…' 클릭 시 토글 */}
            {ppeOpen && ppeDetail.length > 0 && (
              <div className="mt-3">
                <div className="flex items-end">
                  <span className="rounded-t-md border border-b-0 border-indigo-300 bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white">
                    3. 개인보호구 및 안전장구 구입비 — 상세 내역
                  </span>
                  <span className="ml-2 pb-1 text-[10px] text-slate-500">품목별 구매계획 · 항목 3 금액 = 상세 합계</span>
                  {shopHits > 0 && (
                    <span className="mb-0.5 ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      종합쇼핑몰 실단가 연동 ({shopHits}/{ppeDetail.length}품목)
                    </span>
                  )}
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>품목</th>
                      <th className={th}>규격</th>
                      <th className={`${th} w-14`}>단위</th>
                      <th className={`${th} w-14`}>수량</th>
                      <th className={`${th} w-24`}>단가</th>
                      <th className={`${th} w-28`}>금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ppeDetail.map((d) => {
                      const shop = shopOf(d);
                      return (
                        <tr key={d.name}>
                          <td className={td}>{d.name}</td>
                          <td className={`${td} text-slate-500`}>{d.spec}</td>
                          <td className={`${td} text-center`}>{d.uom ?? "Ea"}</td>
                          <td className={`${td} text-right tabular-nums`}>{d.qty}</td>
                          <td className={`${td} text-right tabular-nums`} title={shop ? `쇼핑몰 등록품: ${shop.name}${shop.corp ? ` · ${shop.corp}` : ""}` : undefined}>
                            {won(effUnit(d))}
                            {shop && <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-bold text-emerald-700">쇼핑몰</span>}
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{won(d.qty * effUnit(d))}</td>
                        </tr>
                      );
                    })}
                    <tr className="font-bold">
                      <td className={`${td} bg-slate-50`} colSpan={5}>합계 (→ 항목 3 계상액 반영)</td>
                      <td className={`${td} bg-slate-50 text-right tabular-nums`}>{won(ppeTotal)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-1 text-[10px] text-slate-500">
                  ※ 품목·규격 = 공종 위험 기반(산업안전보건기준 규칙 §32 매핑·KCs 인증 대상) · 수량 = 배치 인원+예비, 소모품은 교체분(매·쌍·세트) · 단가 =
                  {shopHits > 0 ? " 나라장터 종합쇼핑몰 다수공급자계약 실단가(중위값), 미연동 품목은 통상 시장가" : " 통상 시장가 [리서치 기반 — 종합쇼핑몰 피드에 해당 품목 거래·등록 발생 시 실단가 자동 전환]"}
                  <br />※ 사용계획서 제출 시 함께 전송되어 발주처 <b>④증액 검증의 품목별 계획 기준</b>으로 사용됩니다.
                </p>
              </div>
            )}

            {/* 검증시스템 제출 */}
            <div className="mt-4 flex items-center justify-between rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
              <span className="text-[11px] text-indigo-900">
                이 사용계획서(계상액·항목별 계획·개인보호구 품목 상세)를 발주처 검증시스템에 제출하면 <b>④증액 검증의 계획 기준</b>으로 사용됩니다.
              </span>
              {planSent.has(siteId) ? (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">✓ 검증시스템 제출됨</span>
              ) : (
                <button
                  type="button"
                  disabled={planBusy}
                  onClick={submitPlan}
                  className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
                >
                  {planBusy ? "제출 중…" : "발주처 검증시스템 제출"}
                </button>
              )}
            </div>

            {/* 서명란 */}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-6 border-t border-slate-200 pt-3 text-[12px]">
              <span>작성일자: <b>2026년 6월 2일</b></span>
              <span>작성자: 안전관리자 <b>김안전</b> (서명)</span>
              <span>현장대리인: 현장소장 <b>박현장</b> (서명)</span>
            </div>
          </section>
        )}

        {tab === "usage" && (
          <section className="rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
            <h1 className="border-y-2 border-slate-800 py-2 text-center text-base font-black tracking-[0.3em]">항 목 별 사 용 계 획</h1>
            <p className="mt-2 text-[11px] text-slate-500">
              실행계획 각 항목의 세부 사용 내역 — ③탭의 매입 세금계산서(증빙)와 품목 단위로 연동됩니다. [데모값]
            </p>
            <table className="mt-3 w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>항목</th>
                  <th className={`${th} w-24`}>사용일자</th>
                  <th className={th}>사용 내역</th>
                  <th className={`${th} w-14`}>단위</th>
                  <th className={`${th} w-14`}>수량</th>
                  <th className={`${th} w-24`}>단가</th>
                  <th className={`${th} w-28`}>금액</th>
                  <th className={`${th} w-24`}>증빙</th>
                </tr>
              </thead>
              <tbody>
                {invoices.flatMap((v) =>
                  v.items.map((i, idx) => (
                    <tr key={`${v.approvalNo}-${i.name}`}>
                      {idx === 0 && (
                        <td className={`${td} bg-slate-50 text-[11px]`} rowSpan={v.items.length}>
                          3. 개인보호구 및 안전장구 구입비
                        </td>
                      )}
                      <td className={`${td} text-center tabular-nums`}>{v.writeDate}</td>
                      <td className={td}>{i.name}{i.spec ? ` (${i.spec})` : ""}</td>
                      <td className={`${td} text-center`}>Ea</td>
                      <td className={`${td} text-right tabular-nums`}>{i.qty}</td>
                      <td className={`${td} text-right tabular-nums`}>{won(i.unit)}</td>
                      <td className={`${td} text-right tabular-nums`}>{won(i.supply)}</td>
                      {idx === 0 && (
                        <td className={`${td} text-center text-[10px] text-slate-500`} rowSpan={v.items.length}>
                          세금계산서
                          <br />
                          <span className="font-mono">…{v.approvalNo.slice(-8)}</span>
                        </td>
                      )}
                    </tr>
                  )),
                )}
                <tr className="font-bold">
                  <td className={`${td} bg-slate-50`} colSpan={6}>소계 (개인보호구 및 안전장구 구입비)</td>
                  <td className={`${td} bg-slate-50 text-right tabular-nums`}>
                    {won(invoices.reduce((s, v) => s + v.items.reduce((t, i) => t + i.supply, 0), 0))}
                  </td>
                  <td className={`${td} bg-slate-50`} />
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-slate-400">
              ※ 임금·시설비 등 그 외 항목의 사용내역은 데모 범위 밖(세금계산서 외 증빙 — 임금대장·거래명세표 영역)입니다.
            </p>
          </section>
        )}

        {tab === "invoice" && (
          <>
            <div className="mb-3 flex items-end justify-between">
              <h1 className="text-base font-bold">매입 세금계산서 ({invoices.length}건)</h1>
              <p className="text-[11px] text-slate-500">증빙 전송 = 발주처 안전관리비 검증시스템 (④증액 검증 반영)</p>
            </div>
            <div className="space-y-3">
              {invoices.map((v) => {
                const supply = v.items.reduce((s, i) => s + i.supply, 0);
                const tax = v.items.reduce((s, i) => s + i.tax, 0);
                const isSent = sent.has(v.approvalNo);
                return (
                  <div key={v.approvalNo} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-[11px] text-slate-500">국세청 승인번호</div>
                        <div className="font-mono text-sm font-semibold tracking-tight">{v.approvalNo}</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          작성일자 {v.writeDate} · 공급자 <b className="text-slate-700">{v.supplierName}</b> ({v.supplierBno}) · 공급받는자{" "}
                          <b className="text-slate-700">{v.buyerName}</b> ({v.buyerBno})
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSent ? (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">✓ 검증시스템 전송됨</span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy === v.approvalNo}
                            onClick={() => send(v)}
                            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {busy === v.approvalNo ? "전송 중…" : "발주처 검증시스템 전송"}
                          </button>
                        )}
                      </div>
                    </div>

                    <table className="mt-3 w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="py-1 font-medium">품목</th>
                          <th className="py-1 font-medium">규격</th>
                          <th className="py-1 text-right font-medium">수량</th>
                          <th className="py-1 text-right font-medium">단가</th>
                          <th className="py-1 text-right font-medium">공급가액</th>
                          <th className="py-1 text-right font-medium">세액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {v.items.map((i) => (
                          <tr key={i.name} className="border-b border-slate-100">
                            <td className="py-1">{i.name}</td>
                            <td className="py-1 text-slate-500">{i.spec ?? "—"}</td>
                            <td className="py-1 text-right tabular-nums">{i.qty}</td>
                            <td className="py-1 text-right tabular-nums">{won(i.unit)}</td>
                            <td className="py-1 text-right tabular-nums">{won(i.supply)}</td>
                            <td className="py-1 text-right tabular-nums">{won(i.tax)}</td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td className="py-1.5" colSpan={4}>합계</td>
                          <td className="py-1.5 text-right tabular-nums">{won(supply)}</td>
                          <td className="py-1.5 text-right tabular-nums">{won(tax)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p className="mt-6 text-center text-[10px] text-slate-400">
          스마트경리(데모)는 시연용 가상 회계 시스템입니다 · 서식은 산업안전보건관리비 사용계획서 실무 양식을 재현했으며 데이터는 샘플로 실거래가 아닙니다
        </p>
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-xs text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
