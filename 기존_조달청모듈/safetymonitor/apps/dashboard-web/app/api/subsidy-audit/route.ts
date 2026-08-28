// 공단 보조금 정합 검증 API — 정합 행(교부·계산서·표준가격)은 데이터 게이트 전까지 샘플이고,
// 참조가 ②(조달단가)만 나라장터 종합쇼핑몰 실단가로 실연동한다(g2b-shop 재사용 · vat 정규화).
// 게이트: 교부통지서 실물 → subsidy_grant 적재 / 공단 온보드 → 표준가격·대장. (ERD 14번)
import { NextResponse } from "next/server";

import { verifyAreaAccess } from "../../../lib/admin-auth";
import { getShopPrices } from "../../lib/g2b-shop";

export const dynamic = "force-dynamic";

export type SubsidyObservation = "정합" | "단가편차" | "중복참조" | "잣대불일치" | "참조없음" | "대조불가";

export type SubsidyReconRow = {
  item: string; // 지원품목명(공단 38종 분류)
  shopKeyword: string; // 조달 품명 검색 키워드(정확 일치 — 피드 특성)
  site: string;
  grantAmt: number; // 교부결정액(원)
  invoiceSupply: number | null; // 계산서 공급가액(부가세 제외)
  stdPrice: number | null; // 공단 표준가격(참조가 ①) — 온보드 전 샘플
  shopSupply: number | null; // 조달단가 공급가액 환산(참조가 ②)
  shopSource: "live" | "sample" | null; // 조달단가 출처 라벨
  approvalNo: string; // 세금계산서 승인번호(24자리)
  obs: SubsidyObservation;
  note: string;
};

// 샘플 행 — 실데이터 게이트 전 화면 검증용. shopSupply 는 live 조회가 잡히면 덮어쓴다.
const SAMPLE_ROWS: SubsidyReconRow[] = [
  {
    item: "인공지능(AI)기반 인체감지시스템(고정식)",
    shopKeyword: "인체감지시스템",
    site: "○○금속 (천안)",
    grantAmt: 11_440_000,
    invoiceSupply: 14_300_000,
    stdPrice: 13_780_000,
    shopSupply: null,
    shopSource: null,
    approvalNo: "20260712-41000012-11122233",
    obs: "정합",
    note: "표준가격 대비 +3.8% · 한도식 min(판단금액×80%, 1,500만) 충족",
  },
  {
    item: "인공지능(AI)기반 인체감지시스템(고정식)",
    shopKeyword: "인체감지시스템",
    site: "△△산업 (광주)",
    grantAmt: 11_440_000,
    invoiceSupply: 14_300_000,
    stdPrice: 13_780_000,
    shopSupply: 6_880_000,
    shopSource: "sample",
    approvalNo: "20260718-41000012-55667788",
    obs: "잣대불일치",
    note: "표준가격 기준 +3.8%(정합)인데 조달단가 기준 +107.7% — 기준가 자체가 시장가 조사 우선 후보",
  },
  {
    item: "스마트 밀폐공간 질식재해 예방장비",
    shopKeyword: "가스감지기",
    site: "□□환경 (여수)",
    grantAmt: 9_600_000,
    invoiceSupply: 12_000_000,
    stdPrice: null,
    shopSupply: null,
    shopSource: null,
    approvalNo: "20260721-52000031-99887766",
    obs: "참조없음",
    note: "표준가격 미수신 · 조달 미등재(08-24 OpenAPI 실측) — 침묵 신호 대상 품목",
  },
  {
    item: "차량계 건설기계 스마트 안전장치",
    shopKeyword: "충돌방지장치",
    site: "◇◇중공업 (울산)",
    grantAmt: 15_000_000,
    invoiceSupply: 17_800_000,
    stdPrice: 16_500_000,
    shopSupply: 16_100_000,
    shopSource: "sample",
    approvalNo: "20260725-30000077-12341234",
    obs: "단가편차",
    note: "역산 R3: 교부액 > 계산서 공급가액×80% (1,500만 > 1,424만) — 산식 초과 관측",
  },
  {
    item: "인공지능(AI)기반 인체감지시스템(고정식)",
    shopKeyword: "인체감지시스템",
    site: "△△산업 2공장 (광주)",
    grantAmt: 11_440_000,
    invoiceSupply: 14_300_000,
    stdPrice: 13_780_000,
    shopSupply: null,
    shopSource: null,
    approvalNo: "20260718-41000012-55667788",
    obs: "중복참조",
    note: "같은 승인번호가 다른 교부 건에 재등장 — 계산서 재사용 관측",
  },
];

export async function GET(req: Request) {
  // 공단 보조금 영역 — 조달청 관리자·현장 관리자는 거부(2026-08-28 소속별 화면 분리).
  // ⚠ 종전엔 게이트가 아예 없어 비로그인 호출도 통과했다. 화면(SubsidyAuditBoard)이 세션
  //   토큰을 Authorization 으로 함께 보내도록 같이 고쳤다 — 한쪽만 바꾸면 보드가 401 로 빈다.
  if (!(await verifyAreaAccess(req, "subsidy"))) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "공단 보조금 검증 열람 권한이 없습니다" } },
      { status: 403 },
    );
  }
  const rows: SubsidyReconRow[] = SAMPLE_ROWS.map((r) => ({ ...r }));

  // 참조가 ② 실연동 — 당일 피드에 잡히는 품목만 live 로 전환(부분 성공 허용, 실패 시 샘플 유지).
  let shopNote = "조달단가: 샘플 (당일 피드 미조회)";
  try {
    const keywords = [...new Set(rows.map((r) => r.shopKeyword))];
    const shop = await getShopPrices(keywords);
    if (shop.source === "live") {
      let hitCount = 0;
      for (const row of rows) {
        const hit = shop.prices[row.shopKeyword];
        if (hit) {
          row.shopSupply = hit.supplyPrice;
          row.shopSource = "live";
          hitCount += 1;
        }
      }
      shopNote =
        hitCount > 0
          ? `조달단가: 나라장터 당일 피드 실단가 반영 (${hitCount}행 · 공급가액 환산)`
          : "조달단가: 당일 피드에 해당 품목 없음 — 샘플 유지";
    } else if (shop.note) {
      shopNote = `조달단가: ${shop.note}`;
    }
  } catch {
    // 실연동 실패는 화면을 막지 않는다 — 샘플 유지가 폴백.
  }

  const anyLive = rows.some((r) => r.shopSource === "live");
  return NextResponse.json(
    { source: anyLive ? "live" : "mock", rows, shopNote },
    { headers: { "cache-control": "no-store" } },
  );
}
