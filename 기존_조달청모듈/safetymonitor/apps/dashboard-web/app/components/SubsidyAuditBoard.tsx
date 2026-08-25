"use client";
// 공단 보조금 정합 검증 — 검사 1·2·3 을 화면의 1급 구조로 둔다.
// 각 검사 = 책갈피 탭이 달린 컨테이너 + [축A 카드][축B 카드]…[결과 카드]. 상태는 결과 카드 하단 띠로 나타낸다.
//   초과액 검사(1)    : ② 세금계산서 공급가액 ↔ ③ 참조가 — 신호 "단가편차" · 참조가 없으면 "참조없음"
//   산식 비교 검사(2) : ① 교부(통지서) ↔ 산식 상한 — 신호 "산식초과"
//   기준 편차 비교(3) : ③ 표준가격 ↔ ③ 조달단가 — 신호 "잣대불일치"
// 좌측 목록은 건별 안전신호등 하나로 요약: 3검사 통과 수 3=초록 · 2=노랑 · 1=빨강 · 0=빨강 점멸.
// (통과=정상. 신호·대조불가는 불통과로 센다 — 규칙은 화면에 명시)
// 신호는 표시 기준에 따른 관측이지 법적 판정이 아니다(관측 전용 원칙).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis } from "recharts";

import type { SubsidyReconRow } from "../api/subsidy-audit/route";
import { QuantumPulseLoader } from "./ui/quantum-pulse-loader";

// 검사별 표시 기준(임계) — 판정이 아니라 화면 표시용 관측 기준. 값은 화면에 그대로 명시한다.
const T1_DEV_PCT = 5; // 검사1: 참조가 대비 편차 5% 초과 시 신호
const T2_ITEM_CAP = 15_000_000; // 검사2: 품목당 한도
const T3_GAP_PP = 30; // 검사3: 두 잣대의 편차 차이 30%p 초과 시 신호

// 상태 색 — 알약 배지가 아니라 카드 하단 띠(쓰는 쪽에서 border-t 를 붙인다)에 쓴다.
// ★ 상태마다 색이 하나씩이다. 같은 색을 두 상태가 쓰면 띠만 보고는 구분이 안 된다(2026-08-25 정리).
//   정상 초록 · 단가편차 적 · 산식초과 청록 · 잣대불일치 앰버 · 대조불가 노랑
//   · 참조없음 슬레이트 · 조사후보 보라 · 중복참조 자주 · 해당없음 중립
// ⚠ dataviz 검증기로 확인한 결과 8색 전부를 ΔE 15 이상으로 벌리는 조합은 없다. 남은 최악 쌍은
//   적↔앰버(정상시야 9.7)이고 이건 정리 전에도 있던 쌍이다. 모든 띠에 글자 라벨이 붙으므로 색만으로 판별하지 않는다.
// 색은 hex 직접 표기 — 토큰은 CSS 변수 매핑이라 /15 같은 투명도 수식이 생성되지 않는다
// (computed rgba(0,0,0,0) 실측 · 2026-08-25). #10b981 = --color-semantic-up 과 동일 값.
const BADGE_GREEN = "border-[#10b981]/30 bg-[#10b981]/15 text-semantic-up";
const BADGE_RED = "border-[#cf202f]/30 bg-[#cf202f]/10 text-[#cf202f]";
const BADGE_CYAN = "border-[#0a7ea4]/30 bg-[#0a7ea4]/10 text-[#0a7ea4]";
const BADGE_AMBER = "border-[#b45309]/30 bg-[#b45309]/10 text-[#b45309]";
const BADGE_YELLOW = "border-[#f59e0b]/40 bg-[#f59e0b]/15 text-[#a16207] dark:text-[#fbbf24]";
const BADGE_SLATE = "border-[#475569]/30 bg-[#475569]/10 text-[#475569] dark:text-[#94a3b8]";
const BADGE_MAGENTA = "border-[#a21caf]/30 bg-[#a21caf]/10 text-[#a21caf]";
const BADGE_VIOLET = "border-[#6d28d9]/30 bg-[#6d28d9]/10 text-[#6d28d9]";
const BADGE_NEUTRAL = "border-hairline-strong bg-surface-strong text-body dark:border-white/20 dark:bg-white/10 dark:text-on-dark-soft";

type Verdict = { pass: boolean; label: string; cls: string; tone: "ok" | "red" | "cyan" | "amber" | "na" };

function won(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`;
}
function pct(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function devPct(invoice: number | null, ref: number | null): number | null {
  if (invoice == null || ref == null || ref === 0) return null;
  return ((invoice - ref) / ref) * 100;
}

// ── 검사 3종 실행 — 좌측 신호등과 우측 카드가 같은 계산을 쓴다 ─────────
function runTests(r: SubsidyReconRow) {
  const V_PASS: Verdict = { pass: true, label: "정상", cls: BADGE_GREEN, tone: "ok" };

  const ref1 = r.stdPrice ?? r.shopSupply;
  const d1 = devPct(r.invoiceSupply, ref1);
  const premium = r.invoiceSupply != null && ref1 != null ? r.invoiceSupply - ref1 : null;
  const v1: Verdict =
    d1 == null
      ? { pass: false, label: "참조없음", cls: BADGE_SLATE, tone: "na" }
      : d1 > T1_DEV_PCT
        ? { pass: false, label: "단가편차", cls: BADGE_RED, tone: "red" }
        : V_PASS;

  const cap2 = r.invoiceSupply != null ? Math.min(r.invoiceSupply * 0.8, T2_ITEM_CAP) : null;
  const over2 = cap2 != null ? r.grantAmt - cap2 : null;
  const v2: Verdict =
    cap2 == null
      ? { pass: false, label: "대조불가(계산서 필요)", cls: BADGE_YELLOW, tone: "na" }
      : r.grantAmt > cap2 + 0.5
        ? { pass: false, label: "산식초과", cls: BADGE_CYAN, tone: "cyan" }
        : V_PASS;

  const d3std = devPct(r.invoiceSupply, r.stdPrice);
  const d3shop = devPct(r.invoiceSupply, r.shopSupply);
  const gap3 = d3std != null && d3shop != null ? Math.abs(d3std - d3shop) : null;
  // 검사3 대조불가 — 어느 잣대가 부족한지 배지에 명시(노랑).
  const missing3 = [r.stdPrice == null ? "표준가격" : null, r.shopSupply == null ? "조달단가" : null].filter(Boolean).join("·");
  const v3: Verdict =
    gap3 == null
      ? { pass: false, label: `대조불가(${missing3} 필요)`, cls: BADGE_YELLOW, tone: "na" }
      : gap3 > T3_GAP_PP
        ? { pass: false, label: "잣대불일치", cls: BADGE_AMBER, tone: "amber" }
        : V_PASS;

  const passCount = [v1, v2, v3].filter((v) => v.pass).length;
  return { v1, v2, v3, ref1, d1, premium, cap2, over2, d3std, d3shop, gap3, passCount };
}

// ── 안전신호등 — 통과 수 3/2/1/0 → 초록/노랑/빨강/빨강 점멸 ────────────
function TrafficLight({ pass }: { pass: number }) {
  const color = pass === 3 ? "bg-semantic-up" : pass === 2 ? "bg-warning" : "bg-semantic-down";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color} ${pass === 0 ? "animate-pulse" : ""}`} aria-hidden />
      <span className="text-[10px] font-semibold text-body dark:text-on-dark-soft">검사 {pass}/3 통과</span>
    </span>
  );
}

function SourceChip({ kind }: { kind: "실데이터" | "샘플" }) {
  return kind === "실데이터" ? (
    <span className="shrink-0 whitespace-nowrap rounded-pill border border-[#0d74ce]/30 bg-primary-subtle px-1.5 py-px text-[9px] font-bold text-primary">실데이터</span>
  ) : (
    <span className="shrink-0 whitespace-nowrap rounded-pill border border-hairline-strong bg-surface-soft px-1.5 py-px text-[9px] font-semibold text-muted dark:border-white/20 dark:bg-white/5">샘플</span>
  );
}

// 카드 공통 문법 — 출처 칩은 우측 상단 모서리 고정, 소제목 아래 헤어라인으로 제목/내용 2단 구분.
// 제목은 FitText 로 항상 1줄이고 줄상자를 20px 로 고정한다 — 글자 크기가 카드마다 달라져도 헤더 높이가
// 같아야 칩·구분선·금액이 한 행 안에서 같은 높이에 놓인다(2026-08-25 지적).
// 제목은 카드 상단 전폭 띠 — 배경을 한 톤 눌러 [제목 띠][본문] 두 블록으로 나눈다. 제목과 금액이
// 크기·굵기·색·정렬이 모두 비슷해 헤어라인 한 줄로는 구분되지 않던 문제의 해법(2026-08-25).
// 결과 카드의 하단 상태 띠와 위아래 대칭이 된다.
// 결과 카드는 검사 1·2·3 에서 같은 크기여야 세 결과를 나란히 비교할 수 있다. fr 로 두면 열 수(4/3)와
// 간격 수가 달라 폭이 어긋나므로 마지막 열만 고정 폭으로 못박고, 높이는 하한을 준다(기준: 검사 1의 183×137).
// ⚠ 폭 11.5rem 은 세 TestSection 의 cols 문자열에 그대로 적혀 있다 — Tailwind 는 템플릿 문자열로 만든
//    클래스를 생성하지 못하므로 상수로 뺄 수 없다. 바꿀 때 세 곳을 같이 고칠 것.
const RESULT_MIN_H = "min-h-[8.5rem]"; // 136px

// 제목 띠에는 아래 선을 두지 않는다 — 아래 내용 블록이 사방 테두리를 가지므로 둘을 겹치면 선이 두 겹이 된다.
const CARD_HEAD = "flex items-center bg-surface-strong px-3 py-1.5 text-sm font-bold leading-5 text-ink dark:bg-white/10 dark:text-on-dark";
// 제목 띠의 바깥 테두리 — 신호가 난 카드도 제목은 중립 테두리를 쓴다(색은 내용·판정 띠에만).
// 라운드는 필수 — 사각 테두리를 둥근 부모 안에 두면 모서리에서 선이 잘려 각져 보인다.
// 아래쪽도 둥글려 제목 띠 자체가 하나의 둥근 블록이 되게 한다(아래 내용 블록도 사방이 둥글다).
const HEAD_EDGE = "rounded-lg border border-hairline dark:border-white/10";
// 칩이 본문 우측 하단으로 내려가 제목 줄이 비었으므로 제목은 카드 정중앙에 온다(여백 보정 불필요).

// 제목이 카드 폭을 넘으면 줄바꿈 대신 글자 크기를 줄여 1줄로 맞춘다. 폭 변화(반응형·좌측 열 조절)마다
// 다시 잰다. 최대 크기로 되돌린 뒤 넘치는 비율만큼 줄이는 1회 계산이라 루프가 없다.
function FitText({ text, marker, max = 14, min = 9.5 }: { text: string; marker?: boolean; max?: number; min?: number }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const el = textRef.current;
    if (!box || !el) return;
    const fit = () => {
      el.style.fontSize = `${max}px`;
      const avail = box.clientWidth;
      const full = el.scrollWidth;
      if (!avail || !full || full <= avail) return;
      el.style.fontSize = `${Math.max(min, (avail / full) * max - 0.2)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [text, max, min]);

  return (
    <span ref={boxRef} className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap text-center">
      {/* 마커는 텍스트와 한 덩어리로 묶어야 둘이 함께 가운데로 온다 */}
      <span ref={textRef} className="inline-flex items-center gap-1.5 align-middle">
        {marker && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />}
        {text}
      </span>
    </span>
  );
}
function ValueCard({ label, value, sub, chip }: { label: string; value: string; sub: string; chip?: "실데이터" | "샘플" }) {
  return (
    <div className="relative flex min-w-0 flex-col overflow-hidden rounded-lg bg-canvas dark:bg-surface-dark">
      {chip && (
        <span className="absolute bottom-0.5 right-0.5 z-[1]">
          <SourceChip kind={chip} />
        </span>
      )}
      <div className={`${CARD_HEAD} ${HEAD_EDGE}`}>
        <FitText text={label} />
      </div>
      {/* 같은 행의 카드는 높이가 늘어나므로 본문을 세로 중앙에 둔다 */}
      <div className="flex flex-1 flex-col justify-center rounded-lg border border-hairline p-3 dark:border-white/10">
        <div className="text-center text-[13px] font-semibold tabular-nums text-ink dark:text-on-dark">{value}</div>
        <div className="mt-0.5 text-center text-[10px] text-muted dark:text-on-dark-soft">{sub}</div>
      </div>
    </div>
  );
}

function ResultCard({ v, main, sub }: { v: Verdict; main: ReactNode; sub: string }) {
  // 신호 색은 테두리와 "내용 영역"에만 준다 — 카드 전체를 물들이면 제목 띠까지 색이 번져 구조가 흐려진다.
  const frame =
    v.tone === "red"
      ? "border-[#cf202f]/40"
      : v.tone === "cyan"
        ? "border-[#0a7ea4]/40"
        : v.tone === "amber"
          ? "border-[#b45309]/40"
          : "border-hairline dark:border-white/10";
  const bodyTint = v.tone === "red" ? "bg-[#cf202f]/5" : v.tone === "cyan" ? "bg-[#0a7ea4]/5" : v.tone === "amber" ? "bg-[#b45309]/5" : "";
  return (
    // 결과는 "비교 축"이 아니라 그 축들이 만든 결론이라, 왼쪽에 구분선과 여백을 둬 시각적으로 떼어 놓는다.
    // 구분선은 카드 바깥 래퍼에 둔다 — 카드 자신은 overflow-hidden 이라 안쪽에 그리면 잘린다.
    <div className="relative flex min-w-0 pl-4">
      <span className="absolute inset-y-3 left-0 w-px bg-hairline-strong dark:bg-white/15" aria-hidden />
      <div className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-canvas dark:bg-surface-dark ${RESULT_MIN_H}`}>
      {/* 제목 띠 테두리는 중립 — 신호색은 아래 블록부터 두른다 */}
      <div className={`${CARD_HEAD} ${HEAD_EDGE}`}>
        <FitText text="결과" />
      </div>
      <div className={`flex flex-1 flex-col overflow-hidden rounded-lg border ${frame}`}>
        <div className={`flex flex-1 flex-col justify-center p-3 ${bodyTint}`}>
          <div className="text-center text-[13px] font-semibold tabular-nums text-ink dark:text-on-dark">{main}</div>
          <div className="mt-0.5 text-center text-[10px] text-muted dark:text-on-dark-soft">{sub}</div>
        </div>
        {/* 상태 띠 — 카드 하단 전폭. 긴 라벨(대조불가(계산서 필요) 등)도 가로라 그대로 들어간다 */}
        <div className={`border-t px-3 py-1 text-center text-[10px] font-bold ${v.cls}`}>{v.label}</div>
      </div>
      </div>
    </div>
  );
}

// ── 침묵 신호 · 분포 상세 ────────────────────────────────────────────
// CV 값의 근거를 점 플롯으로 보여준다. 요약 숫자(CV 1.6%)만으로는 담당관이 따져볼 수 없기 때문이다
// (관측 전용 원칙 — 결론이 아니라 원자료를 보인다).
// 비교군을 나란히 놓지 않으면 "왜 1.6% 가 이상한가" 가 읽히지 않는다. 정상 시장이 얼마나 퍼지는지가 기준이다.
// 한도선을 세로로 얹으면 분산 협소(뭉침)와 한도 추종(뭉친 자리가 한도에 붙음)을 한 그림에서 읽는다.
// ⚠ 아래 두 배열은 전부 샘플이다 — 교부 대장·계산서 수신 전이라 실측이 아니다. 화면에도 띠와 워터마크로 명시한다.
const DIST_CAP = 15_000_000; // 품목당 한도(고시 제2026-15호 제30조)
// 비교군: 독립 잣대가 있는 정상 품목 — 평균 1,060만 · CV 20.2%
const DIST_PEER = [7_200_000, 7_900_000, 8_600_000, 9_100_000, 9_800_000, 10_300_000, 10_700_000, 11_200_000, 11_900_000, 12_600_000, 13_400_000, 14_500_000];
// 이 품목: 평균 1,455만 · CV 1.6% · 한도 근접 97% — 모달 표의 관측값과 같은 표본이다
const DIST_ITEM = [14_130_000, 14_250_000, 14_340_000, 14_430_000, 14_490_000, 14_550_000, 14_550_000, 14_610_000, 14_670_000, 14_760_000, 14_850_000, 14_970_000];

const DIST_PEER_LABEL = "비교군(정상 품목)";
const DIST_ITEM_LABEL = "이 품목";

// 통계는 위 배열에서 직접 계산한다 — 표와 차트와 5지표 표의 숫자가 어긋나면 그 자체가 의심을 산다.
function distStat(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, mean, sd, cv: (sd / mean) * 100, min: Math.min(...xs), max: Math.max(...xs), capPct: (mean / DIST_CAP) * 100 };
}
const DIST_PEER_STAT = distStat(DIST_PEER);
const DIST_ITEM_STAT = distStat(DIST_ITEM);

// 만원 단위 표기 — 원 단위 숫자는 자릿수가 많아 표에서 대조가 안 된다.
function man(n: number, digits = 0): string {
  return `${(n / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: digits })}만원`;
}

// ── 한도 추종 시계열 ─────────────────────────────────────────────────
// 분산 협소가 "한 시점의 퍼짐"이라면 한도 추종은 "시간에 따른 따라감"이다. 고시가 한도를 올린 직후
// 거래 중앙값이 새 한도로 이동하면 시장이 아니라 보조금 최대치가 가격을 정한다는 뜻이다.
// ⚠ 전부 샘플 — 대장·공고 파싱 이력이 들어오기 전까지 실측이 아니다.
const CAP_REVISION = "2025-10"; // 고시 개정으로 한도가 1,200만 → 1,500만이 된 시점(샘플)
const CAP_SERIES: { m: string; cap: number; median: number }[] = [
  { m: "2025-03", cap: 12_000_000, median: 11_580_000 },
  { m: "2025-04", cap: 12_000_000, median: 11_630_000 },
  { m: "2025-05", cap: 12_000_000, median: 11_660_000 },
  { m: "2025-06", cap: 12_000_000, median: 11_610_000 },
  { m: "2025-07", cap: 12_000_000, median: 11_690_000 },
  { m: "2025-08", cap: 12_000_000, median: 11_720_000 },
  { m: "2025-09", cap: 12_000_000, median: 11_700_000 },
  { m: "2025-10", cap: 15_000_000, median: 13_100_000 },
  { m: "2025-11", cap: 15_000_000, median: 14_280_000 },
  { m: "2025-12", cap: 15_000_000, median: 14_470_000 },
  { m: "2026-01", cap: 15_000_000, median: 14_520_000 },
  { m: "2026-02", cap: 15_000_000, median: 14_550_000 },
  { m: "2026-03", cap: 15_000_000, median: 14_530_000 },
  { m: "2026-04", cap: 15_000_000, median: 14_560_000 },
  { m: "2026-05", cap: 15_000_000, median: 14_550_000 },
  { m: "2026-06", cap: 15_000_000, median: 14_580_000 },
  { m: "2026-07", cap: 15_000_000, median: 14_550_000 },
  { m: "2026-08", cap: 15_000_000, median: 14_570_000 },
];

type DetailKind = "spread" | "cap";

const TH = "px-3 py-1.5 text-left font-semibold";
const TD = "px-3 py-1.5 tabular-nums";

function SilenceDetailModal({ item, kind, onClose }: { item: string; kind: DetailKind; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // y 는 수치(0=비교군, 1=이 품목)로 둔다 — 범주형 축은 점이 행에 안 붙는 문제가 있었다(실측).
  // 같은 값이 겹쳐 한 점처럼 보이지 않도록 세로로 조금씩 흩는다(표본 수가 눈에 보이게).
  const data = [
    ...DIST_PEER.map((x, i) => ({ x, y: 0, j: (i % 3) - 1, mine: false })),
    ...DIST_ITEM.map((x, i) => ({ x, y: 1, j: (i % 3) - 1, mine: true })),
  ];

  const spread = kind === "spread";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="침묵 신호 지표 상세">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-hairline bg-canvas shadow-xl dark:border-white/10 dark:bg-surface-dark-elevated">
        {/* 샘플 표기는 띠로 — 차트는 숫자보다 "실측했다"는 인상이 강해 작은 괄호로는 부족하다 */}
        <div className="flex items-center gap-2 border-b border-[#b45309]/30 bg-[#b45309]/10 px-4 py-2 text-[11px] font-bold text-[#b45309]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          {spread
            ? "샘플 분포 — 교부 대장·세금계산서 수신 전이라 실측이 아닙니다. 형태를 보여주기 위한 예시입니다."
            : "샘플 이력 — 교부 대장·공고 파싱 이력 수신 전이라 실측이 아닙니다. 형태를 보여주기 위한 예시입니다."}
        </div>

        <div className="flex items-start justify-between gap-3 px-4 pt-3">
          <div>
            <h4 className="text-sm font-semibold text-ink dark:text-on-dark">
              {spread ? "가격 분포 — 분산 협소" : "한도 추종 — 고시 개정과 거래가"}
            </h4>
            <p className="mt-0.5 text-[11px] text-body dark:text-on-dark-soft">
              {item} · {spread ? "거래 1건 = 점 1개" : "월별 거래 중앙값과 품목 한도"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md border border-hairline px-2 py-1 text-[11px] font-semibold text-body hover:bg-surface-soft dark:border-white/10 dark:text-on-dark-soft dark:hover:bg-white/5">
            닫기 ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
        {spread ? (
        <div className="relative px-2 pb-1 pt-2">
          <ResponsiveContainer width="100%" height={230}>
            <ScatterChart margin={{ top: 26, right: 24, bottom: 28, left: 8 }}>
              <CartesianGrid horizontal={false} stroke="currentColor" className="text-hairline-strong dark:text-white/10" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[6_500_000, 15_600_000]}
                tickFormatter={(v: number) => `${(v / 10_000).toLocaleString("ko-KR")}만`}
                tick={{ fontSize: 10, fill: "currentColor" }}
                className="text-muted dark:text-on-dark-soft"
                stroke="currentColor"
                tickLine={false}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[-0.6, 1.6]}
                ticks={[0, 1]}
                tickFormatter={(v: number) => (v === 1 ? DIST_ITEM_LABEL : DIST_PEER_LABEL)}
                width={104}
                tick={{ fontSize: 11, fill: "currentColor" }}
                className="text-body dark:text-on-dark-soft"
                stroke="currentColor"
                tickLine={false}
                axisLine={false}
              />
              <ReferenceLine
                x={DIST_CAP}
                stroke="#cf202f"
                strokeDasharray="4 4"
                label={{ value: `품목 한도 ${(DIST_CAP / 10_000).toLocaleString("ko-KR")}만`, position: "top", fontSize: 10, fill: "#cf202f" }}
              />
              <Scatter
                data={data}
                isAnimationActive={false}
                shape={(p: { cx?: number; cy?: number; payload?: { j: number; mine: boolean } }) => (
                  <circle
                    cx={p.cx}
                    cy={(p.cy ?? 0) + (p.payload?.j ?? 0) * 7}
                    r={p.payload?.mine ? 5 : 4}
                    fill={p.payload?.mine ? "#8b5cf6" : "#9aa0a6"}
                    fillOpacity={p.payload?.mine ? 0.8 : 0.55}
                  />
                )}
              />
            </ScatterChart>
          </ResponsiveContainer>
          {/* 워터마크 — 캡처가 돌아다녀도 샘플임이 따라가도록 */}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl font-black tracking-[0.2em] text-[#b45309]/10 dark:text-[#fbbf24]/10" aria-hidden>
            샘플
          </span>
        </div>
        ) : (
        <div className="relative px-2 pb-1 pt-2">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={CAP_SERIES} margin={{ top: 26, right: 24, bottom: 28, left: 8 }}>
              <CartesianGrid stroke="currentColor" className="text-hairline-strong dark:text-white/10" />
              <XAxis
                dataKey="m"
                tick={{ fontSize: 9, fill: "currentColor" }}
                className="text-muted dark:text-on-dark-soft"
                stroke="currentColor"
                tickLine={false}
                interval={2}
              />
              <YAxis
                domain={[10_500_000, 15_800_000]}
                tickFormatter={(v: number) => `${(v / 10_000).toLocaleString("ko-KR")}만`}
                width={64}
                tick={{ fontSize: 10, fill: "currentColor" }}
                className="text-muted dark:text-on-dark-soft"
                stroke="currentColor"
                tickLine={false}
              />
              <ReferenceLine
                x={CAP_REVISION}
                stroke="#b45309"
                strokeDasharray="4 4"
                label={{ value: "고시 개정", position: "top", fontSize: 10, fill: "#b45309" }}
              />
              <Line type="stepAfter" dataKey="cap" name="품목 한도" stroke="#cf202f" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="median" name="거래 중앙값" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2.5, fill: "#8b5cf6" }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl font-black tracking-[0.2em] text-[#b45309]/10 dark:text-[#fbbf24]/10" aria-hidden>
            샘플
          </span>
          <div className="flex flex-wrap items-center justify-center gap-4 pb-1 text-[10px] text-body dark:text-on-dark-soft">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-[#cf202f]" aria-hidden /> 품목 한도(고시)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-[#8b5cf6]" aria-hidden /> 거래 중앙값
            </span>
          </div>
        </div>
        )}

        {/* ── 표 — 차트만으로는 따져볼 수 없다. 원자료와 요약을 같이 둔다 ── */}
        {spread ? (
          <div className="space-y-3 px-4 pb-3">
            <div>
              <h5 className="mb-1.5 text-[11px] font-bold text-ink dark:text-on-dark">요약 통계</h5>
              <div className="overflow-x-auto rounded-lg border border-hairline dark:border-white/10">
                <table className="w-full min-w-[440px] text-[11px]">
                  <thead className="bg-surface-soft text-muted dark:bg-surface-dark dark:text-on-dark-soft">
                    <tr>
                      <th className={TH}>항목</th>
                      <th className={TH}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#9aa0a6]" aria-hidden /> {DIST_PEER_LABEL}
                        </span>
                      </th>
                      <th className={TH}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#8b5cf6]" aria-hidden /> {DIST_ITEM_LABEL}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline bg-canvas dark:divide-white/10 dark:bg-surface-dark">
                    {[
                      ["표본 수", `${DIST_PEER_STAT.n}건`, `${DIST_ITEM_STAT.n}건`],
                      ["평균", man(DIST_PEER_STAT.mean), man(DIST_ITEM_STAT.mean)],
                      ["표준편차", man(DIST_PEER_STAT.sd, 1), man(DIST_ITEM_STAT.sd, 1)],
                      ["최소~최대", `${man(DIST_PEER_STAT.min)} ~ ${man(DIST_PEER_STAT.max)}`, `${man(DIST_ITEM_STAT.min)} ~ ${man(DIST_ITEM_STAT.max)}`],
                      [`한도(${man(DIST_CAP)}) 대비 평균`, `${DIST_PEER_STAT.capPct.toFixed(1)}%`, `${DIST_ITEM_STAT.capPct.toFixed(1)}%`],
                    ].map(([k, a, b]) => (
                      <tr key={k}>
                        <td className={`${TD} font-semibold text-body dark:text-on-dark-soft`}>{k}</td>
                        <td className={`${TD} text-ink dark:text-on-dark`}>{a}</td>
                        <td className={`${TD} text-ink dark:text-on-dark`}>{b}</td>
                      </tr>
                    ))}
                    <tr className="bg-[#6d28d9]/5">
                      <td className={`${TD} font-semibold text-body dark:text-on-dark-soft`}>CV(변동계수)</td>
                      <td className={`${TD} font-bold text-ink dark:text-on-dark`}>{DIST_PEER_STAT.cv.toFixed(1)}%</td>
                      <td className={`${TD} font-bold text-[#6d28d9]`}>{DIST_ITEM_STAT.cv.toFixed(1)}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h5 className="mb-1.5 text-[11px] font-bold text-ink dark:text-on-dark">원자료 — 거래 {DIST_ITEM_STAT.n}건 (오름차순)</h5>
              <div className="overflow-x-auto rounded-lg border border-hairline dark:border-white/10">
                <table className="w-full min-w-[440px] text-[11px]">
                  <thead className="bg-surface-soft text-muted dark:bg-surface-dark dark:text-on-dark-soft">
                    <tr>
                      <th className={TH}>#</th>
                      <th className={TH}>{DIST_PEER_LABEL}</th>
                      <th className={TH}>{DIST_ITEM_LABEL}</th>
                      <th className={TH}>한도 대비</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline bg-canvas dark:divide-white/10 dark:bg-surface-dark">
                    {DIST_ITEM.map((v, i) => (
                      <tr key={i}>
                        <td className={`${TD} text-muted dark:text-on-dark-soft`}>{i + 1}</td>
                        <td className={`${TD} text-body dark:text-on-dark-soft`}>{man(DIST_PEER[i]!)}</td>
                        <td className={`${TD} font-semibold text-ink dark:text-on-dark`}>{man(v)}</td>
                        <td className={`${TD} text-[#6d28d9]`}>{((v / DIST_CAP) * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-3">
            <h5 className="mb-1.5 text-[11px] font-bold text-ink dark:text-on-dark">월별 원자료 — 한도와 거래 중앙값</h5>
            <div className="overflow-x-auto rounded-lg border border-hairline dark:border-white/10">
              <table className="w-full min-w-[460px] text-[11px]">
                <thead className="bg-surface-soft text-muted dark:bg-surface-dark dark:text-on-dark-soft">
                  <tr>
                    <th className={TH}>시점</th>
                    <th className={TH}>품목 한도</th>
                    <th className={TH}>거래 중앙값</th>
                    <th className={TH}>한도 대비</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline bg-canvas dark:divide-white/10 dark:bg-surface-dark">
                  {CAP_SERIES.map((r) => {
                    const pct = (r.median / r.cap) * 100;
                    const rev = r.m === CAP_REVISION;
                    return (
                      <tr key={r.m} className={rev ? "bg-[#b45309]/10" : undefined}>
                        <td className={`${TD} font-semibold text-body dark:text-on-dark-soft`}>
                          {r.m}
                          {rev && <span className="ml-1.5 rounded-pill border border-[#b45309]/40 px-1.5 py-px text-[9px] font-bold text-[#b45309]">고시 개정</span>}
                        </td>
                        <td className={`${TD} text-ink dark:text-on-dark`}>{man(r.cap)}</td>
                        <td className={`${TD} font-semibold text-ink dark:text-on-dark`}>{man(r.median)}</td>
                        <td className={`${TD} ${pct >= 95 ? "font-bold text-[#6d28d9]" : "text-body dark:text-on-dark-soft"}`}>{pct.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>

        <p className="border-t border-hairline px-4 py-2 text-[10px] text-muted dark:border-white/10 dark:text-on-dark-soft">
          {spread ? (
            <>
              CV(변동계수) = 표준편차 ÷ 평균. 낮을수록 가격이 한 점에 몰렸다는 뜻입니다. 규격이 표준화된 품목은 정상적으로도 CV가 낮을 수 있으므로
              단일 지표로는 올리지 않으며, 산출물은 판정이 아니라 <b>시장가 조사 우선 배정 제안</b>까지입니다.
            </>
          ) : (
            <>
              한도가 오른 직후 거래 중앙값이 새 한도로 따라 올라가면, 가격을 정한 것이 시장이 아니라 보조금 최대치라는 뜻입니다. 원자재가 상승 등
              다른 이유로도 같은 모양이 나올 수 있으므로 단일 지표로는 올리지 않으며, 산출물은 판정이 아니라 <b>시장가 조사 우선 배정 제안</b>까지입니다.
            </>
          )}
        </p>
      </div>
    </div>,
    document.body,
  );
}

// 침묵 신호 5지표 상세 모달 — 카드 클릭 시 화면 중앙 오버레이로 표를 띄운다.
function SilenceModal({ item, silent, onClose }: { item: string; silent: boolean; onClose: () => void }) {
  const [detail, setDetail] = useState<DetailKind | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 지표 정의(ERD 확정분) + 선택 품목의 관측(게이트 전까지 샘플).
  const ROWS: { name: string; what: string; source: string; obs: string; hit: boolean; detail?: DetailKind }[] = [
    {
      name: "분산 협소",
      what: "품목 거래가의 변동계수(CV)가 자연 시장 대비 비정상적으로 낮음 — \"전국 어디서나 거의 같은 가격\"의 흔적",
      source: "계산서 · 교부 대장",
      obs: silent ? `CV ${DIST_ITEM_STAT.cv.toFixed(1)}% (샘플 분포)` : "분포 표본 대기",
      hit: silent,
      detail: silent ? "spread" : undefined, // 근거 분포를 점 플롯 + 표로 따로 연다
    },
    {
      name: "한도 추종",
      what: "거래가 중앙값이 품목 한도(1,500만)·인정 상한에 붙고, 고시 개정 직후 일제히 새 한도로 이동 — 시장이 아니라 보조금 최대치가 가격을 정하는 흔적",
      source: "대장 + 공고 파싱 이력",
      obs: silent ? `한도 근접 ${DIST_ITEM_STAT.capPct.toFixed(0)}% (샘플 분포)` : "분포 표본 대기",
      hit: silent,
      detail: silent ? "cap" : undefined, // 고시 개정 시점과 거래가 이동을 시계열 + 표로
    },
    {
      name: "보조 유무 가격차",
      what: "같은 품목의 보조 수급 거래 vs 비수급 거래의 가격 차이 — 거품의 직접 측정",
      source: "공단 보유 데이터 (3층 온보드)",
      obs: "공단 온보드 대기",
      hit: false,
    },
    {
      name: "독립 잣대 부재",
      what: "조달단가·수입신고가·시중가 어느 것도 없음 — 검증 불가능 지대",
      source: "잣대 스택 메타",
      obs: silent ? "해당 — 조달 미등재 (08-24 OpenAPI 실측)" : "잣대 보유",
      hit: silent,
    },
    {
      name: "판매망 클러스터",
      what: "판매업체–원가검토업체–수급 사업장 조합의 반복",
      source: "업체 등록부(48건 스냅샷) + 계산서 공급자",
      obs: "표본 부족 (샘플)",
      hit: false,
    },
  ];

  // 포털 — 대시보드 페이저(transform 조상) 안에서도 fixed 가 화면 기준으로 뜨도록 body 에 붙인다.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="침묵 신호 5지표 상세">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-2xl rounded-xl border border-hairline bg-canvas p-4 shadow-xl dark:border-white/10 dark:bg-surface-dark-elevated">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-ink dark:text-on-dark">침묵 신호 — 5개 지표 (품목 단위)</h4>
            <p className="mt-0.5 text-[11px] text-body dark:text-on-dark-soft">{item} · 가격의 위치를 못 믿을 때 가격의 모양·움직임을 본다</p>
          </div>
          <button onClick={onClose} className="rounded-md border border-hairline px-2 py-1 text-[11px] font-semibold text-body hover:bg-surface-soft dark:border-white/10 dark:text-on-dark-soft dark:hover:bg-white/5">
            닫기 ✕
          </button>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-hairline dark:border-white/10">
          <table className="w-full min-w-[560px] text-left text-[11px]">
            <thead className="bg-surface-soft text-muted dark:bg-surface-dark dark:text-on-dark-soft">
              <tr>
                <th className="px-3 py-2 font-semibold">지표</th>
                <th className="px-3 py-2 font-semibold">무엇을 보나</th>
                <th className="px-3 py-2 font-semibold">재료</th>
                <th className="px-3 py-2 font-semibold">이 품목 관측</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline dark:divide-white/10">
              {ROWS.map((row) => (
                <tr key={row.name} className={row.hit ? "bg-[#6d28d9]/5" : "bg-canvas dark:bg-surface-dark"}>
                  <td className="px-3 py-2 font-semibold text-ink dark:text-on-dark">{row.name}</td>
                  <td className="px-3 py-2 leading-snug text-body dark:text-on-dark-soft">{row.what}</td>
                  <td className="px-3 py-2 text-muted dark:text-on-dark-soft">{row.source}</td>
                  <td className={`px-3 py-2 font-semibold ${row.hit ? "text-[#6d28d9]" : "text-muted dark:text-on-dark-soft"}`}>
                    {row.obs}
                    {row.detail && (
                      <button
                        type="button"
                        onClick={() => setDetail(row.detail!)}
                        className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-primary underline underline-offset-2 hover:text-primary-active"
                      >
                        {row.detail === "spread" ? "분포 상세 보기" : "이력 상세 보기"}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted dark:text-on-dark-soft">
          집계는 교부 건이 아니라 품목 단위이며 신호등 계산 밖입니다. 단일 지표로는 올리지 않고 결합 등급으로만 내며, 산출물은 판정이 아니라
          시장가 조사·지정 원가계산기관 검토·실물조사의 <b>우선 배정 제안</b>까지 — 권한은 공단에 있습니다. 규격 표준화 품목은 정상적으로도 CV가 낮을 수 있습니다(정황≠증거).
        </p>
      </div>
      {detail && <SilenceDetailModal item={item} kind={detail} onClose={() => setDetail(null)} />}
    </div>,
    document.body,
  );
}

// 검사 컨테이너 — 제목은 좌측 상단 돌출 탭(-mb-px 로 컨테이너 상단 보더를 끊어 폴더 탭처럼 이어붙인다).
// 좌측에 세로 스텝 레일을 둔다: 노드(번호)가 단계를, 레일이 "검사 1 → 검사 2·3" 분기를 나타낸다.
//   step 1 = 분기의 출발 → 노드 아래로 레일이 이어지고
//   step 2 = 중간 경유 → 위에서 내려온 레일이 지나가며 노드로 들어오고
//   step 3 = 분기의 끝  → 레일이 노드에서 끝난다
// ⚠ 1→2→3 일렬이 아니다. 검사 1의 공급가액이 검사 2로, 편차가 검사 3으로 각각 간다(호버 파이프라인과 같은 관계).
// 노드는 검사 결과와 무관하게 항상 같은 색(파랑)이다 — 결과 색은 상태 띠가 말하고,
// 레일은 "몇 번째 검사인가"만 말한다. 결과에 따라 색이 변하면 상태 띠와 신호가 겹쳐 읽힌다.
function StepRail({ step }: { step: 1 | 2 | 3 }) {
  const line = "absolute bg-hairline-strong dark:bg-white/15";
  // 줄기는 검사 1 노드에서 시작해 아래로 내려가고, 검사 2·3 은 가로 가지로 갈라져 나온다.
  // 섹션 사이 여백(16px)을 -top-4/-bottom-4 로 넘겨야 줄기가 끊기지 않는다.
  const stem =
    step === 1 ? "left-0 top-4 -bottom-4 w-px" : step === 2 ? "left-0 -top-4 -bottom-4 w-px" : "left-0 -top-4 h-8 w-px";
  return (
    <div className="relative w-8 shrink-0" aria-hidden>
      <span className={`${line} ${stem}`} />
      {/* 가로 가지 — 줄기(left-0)와 노드(right-0) 사이를 잇는다. 검사 1 도 있어야 노드가 줄기에 붙는다 */}
      <span className={`${line} left-0 top-4 h-px w-3`} />
      <span className="absolute right-0 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-on-primary">
        {step}
      </span>
    </div>
  );
}

function TestSection({
  title,
  question,
  cols,
  step,
  children,
}: {
  title: string;
  question: string;
  cols?: string;
  step?: 1 | 2 | 3;
  children: ReactNode;
}) {
  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-end gap-x-2">
        <span className="relative z-[1] -mb-px inline-flex items-center rounded-t-lg border border-b-0 border-hairline bg-canvas px-3 py-1.5 text-xs font-bold text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark">
          {title}
        </span>
        <span className="pb-1.5 text-[10px] text-muted dark:text-on-dark-soft">{question}</span>
      </div>
      <div className="rounded-b-xl rounded-tr-xl border border-hairline bg-canvas p-3 dark:border-white/10 dark:bg-surface-dark">
        {/* gap-3 — 비교 축 카드끼리는 여유를 준다. 결과 카드는 자체 좌측 여백(pl-4)과 구분선으로 더 떨어진다. */}
        <div className={`grid gap-3 ${cols ?? "sm:grid-cols-3"}`}>{children}</div>
      </div>
    </div>
  );

  if (!step) return body;
  return (
    <div className="flex gap-2">
      <StepRail step={step} />
      {body}
    </div>
  );
}

// 검사 1 ↔ 검사 3 을 잇는 편차 카드 — 같은 파란 마커(●)를 양쪽에 달고, 호버 시 두 카드가 함께 켜진다.
function LinkedDevCard({
  label,
  value,
  sub,
  active,
  onHover,
  chip,
  cardRef,
}: {
  label: string;
  value: string;
  sub: string;
  active: boolean;
  onHover: (on: boolean) => void;
  chip?: "실데이터" | "샘플";
  cardRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={cardRef}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-lg bg-canvas transition dark:bg-surface-dark ${active ? "z-30 ring-2 ring-[#0d74ce]/50" : ""}`}
    >
      {chip && (
        <span className="absolute bottom-0.5 right-0.5 z-[1]">
          <SourceChip kind={chip} />
        </span>
      )}
      <div className={`${CARD_HEAD} ${HEAD_EDGE}`}>
        <FitText text={label} marker />
      </div>
      {/* 비교 축 카드는 신호가 나도 중립으로 둔다 — 색은 결과 카드와 보조 검사 카드만 칠한다 */}
      <div className="flex flex-1 flex-col justify-center rounded-lg border border-hairline p-3 dark:border-white/10">
        <div className="text-center text-[13px] font-semibold tabular-nums text-ink dark:text-on-dark">{value}</div>
        <div className="mt-0.5 text-center text-[10px] text-muted dark:text-on-dark-soft">{sub}</div>
      </div>
    </div>
  );
}

type ApiResp = { source: "live" | "mock"; rows: SubsidyReconRow[]; shopNote: string };

export default function SubsidyAuditBoard() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selIdx, setSelIdx] = useState(0);
  const [silenceOpen, setSilenceOpen] = useState(false);
  const [devLinkHover, setDevLinkHover] = useState(false); // 검사1 편차 ↔ 검사3 편차 호버 연동
  const [capLinkHover, setCapLinkHover] = useState(false); // 검사1 공급가액 ↔ 검사2 산식 상한 호버 연동
  // 파이프라인 연결선 — 호버 중인 쌍의 카드 실좌표(뷰포트 기준)를 재서 ㄴ/ㄱ 꺾임 경로 + 스포트라이트 홀을 만든다.
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [linkGeo, setLinkGeo] = useState<{ path: string; holes: { x: number; y: number; w: number; h: number }[] } | null>(null);

  useEffect(() => {
    const hovering = devLinkHover || capLinkHover;
    if (!hovering) {
      setLinkGeo(null);
      return;
    }
    const [ka, kb] = devLinkHover ? ["dev1", "dev3"] : ["cap1", "cap2"];
    const measure = () => {
      const a = cardRefs.current[ka];
      const b = cardRefs.current[kb];
      if (!a || !b) return;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const ax = ra.left + ra.width / 2;
      const ay = ra.bottom;
      const bx = rb.left + rb.width / 2;
      const by = rb.top;
      const my = ay + Math.max(8, (by - ay) * 0.45); // 중간 꺾임 높이
      setLinkGeo({
        path: `M ${ax} ${ay} L ${ax} ${my} L ${bx} ${my} L ${bx} ${by}`, // 방향: 검사1 → 검사2/3
        holes: [ra, rb].map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })),
      });
    };
    measure();
    // 좌표는 뷰포트 기준이라 스크롤하면 어긋난다 — 호버 중엔 스크롤·리사이즈마다 rAF 스로틀로 재측정.
    let raf = 0;
    const remeasure = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    // L-51 — 이 보드는 /subsidy-audit 단독 라우트뿐 아니라 대시보드 탭(DemoDashboard)으로도 렌더된다.
    //   그 화면엔 매 프레임 `scrollLeft` 를 쓰는 마퀴 티커(`useMarqueeScroll`)가 상시 3개 돌아서,
    //   캡처 스크롤을 무조건 받으면 호버하는 내내 프레임마다 getBoundingClientRect + setState 가 돈다.
    //   좌표가 어긋나는 것은 **잰 카드를 품은 스크롤러**가 움직였을 때뿐이므로 그때만 다시 잰다
    //   (문서 스크롤은 target 이 document 라 contains 가 참 — 그대로 걸린다).
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      const a = cardRefs.current[ka];
      const b = cardRefs.current[kb];
      if ((a && t?.contains?.(a)) || (b && t?.contains?.(b))) remeasure();
    };
    // 캡처가 필요하되(scroll 은 버블링하지 않는다) 위 onScroll 이 포함 여부로 범위를 좁혔다.
    // eslint-disable-next-line no-restricted-syntax -- L-51: onScroll 이 잰 카드 포함 여부로 좁혔다
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", remeasure);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [devLinkHover, capLinkHover, selIdx]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/subsidy-audit");
        if (!r.ok) throw new Error(`교부 건 목록 조회 실패 (${r.status})`);
        const j = (await r.json()) as ApiResp;
        if (alive) setData(j);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "불러오기 실패");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = data?.rows ?? [];
  const r = rows[selIdx] ?? null;
  const t = r ? runTests(r) : null;
  const anyShopLive = rows.some((row) => row.shopSource === "live");

  const ref1Label = r ? (r.stdPrice != null ? "표준가격" : r.shopSupply != null ? "조달단가" : null) : null;
  // 검사 1 편차의 호버 짝 — 잣대를 못 정한 건도 표준가격 카드를 짝으로 둬서 연결이 끊기지 않게 한다.
  const devPartner: "표준가격" | "조달단가" = ref1Label === "조달단가" ? "조달단가" : "표준가격";
  const dupSites = r ? rows.filter((x, i) => i !== selIdx && x.approvalNo === r.approvalNo).map((x) => x.site) : [];
  const silent = r != null && r.stdPrice == null && r.shopSupply == null; // 잣대 전무 품목 → 침묵 신호 축

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink dark:text-on-dark">공단 보조금 검증</h2>
          <p className="text-xs text-body dark:text-on-dark-soft">
            교부 건마다 검사 3종을 돌립니다 — 초과액 검사(공급가액↔참조가) · 산식 비교(교부↔상한) · 기준 편차 비교(표준↔조달). 신호는 관측이지 판정이 아닙니다.
          </p>
          <p className="mt-0.5 text-[10px] text-muted dark:text-on-dark-soft">
            신호등 = 담당관 육안 확인 필요도. 3검사 통과 수: <span className="font-semibold text-semantic-up">3=초록(확인 불요)</span> · <span className="font-semibold text-warning">2=노랑</span> · <span className="font-semibold text-semantic-down">1=빨강 · 0=빨강 점멸</span> — 신호든 대조불가든 통과 못 한 검사는 사람이 봐야 하므로 불통과로 셈
          </p>
        </div>
        <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${anyShopLive ? "bg-primary-subtle text-primary" : "bg-surface-strong text-body dark:bg-white/10 dark:text-on-dark-soft"}`}>
          {anyShopLive ? "조달단가 실연동 · 나머지 샘플" : "전체 샘플 데이터"}
        </span>
      </div>

      {error && <p className="py-8 text-center text-xs text-semantic-down">{error}</p>}
      {!error && !data && <QuantumPulseLoader text="교부 건 불러오는 중" />}

      {data && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,240px)_1fr]">
          {/* 좌: 교부 건 목록 — 건별 안전신호등 */}
          <ul className="space-y-2">
            {rows.map((n, i) => {
              const sel = i === selIdx;
              const pass = runTests(n).passCount;
              return (
                <li key={i}>
                  <button
                    onClick={() => setSelIdx(i)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      sel
                        ? "border-[#171717]/20 bg-surface-card ring-1 ring-hairline dark:bg-white/10"
                        : "border-hairline bg-canvas hover:border-muted-soft dark:border-white/10 dark:bg-surface-dark dark:hover:border-white/20"
                    }`}
                  >
                    <div className="truncate text-sm font-semibold text-ink dark:text-on-dark">{n.item}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted dark:text-on-dark-soft">
                      <span className="truncate">{n.site}</span>
                      <span>·</span>
                      <span>{won(n.grantAmt)}</span>
                    </div>
                    <div className="mt-1.5">
                      <TrafficLight pass={pass} />
                    </div>
                  </button>
                </li>
              );
            })}
            {rows.length === 0 && <li className="text-xs text-muted">표시할 교부 건이 없습니다.</li>}
          </ul>

          {/* 우: 검사 1·2·3 — 헤더 스트립(건 식별) + 검사별 책갈피 탭 컨테이너 */}
          <div className="relative overflow-hidden rounded-xl border border-hairline bg-surface-soft dark:border-white/10 dark:bg-surface-dark-elevated">
            {r && t ? (
              <>
                {/* 헤더 스트립 — 물품명·사업장·승인번호를 검사 영역과 배경·보더로 구획 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-canvas px-4 py-3 dark:border-white/10 dark:bg-surface-dark">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-ink dark:text-on-dark">{r.item}</h3>
                    <p className="mt-0.5 text-[11px] text-body dark:text-on-dark-soft">{r.site} · 세금계산서 승인번호 …{r.approvalNo.slice(-8)}</p>
                  </div>
                  <TrafficLight pass={t.passCount} />
                </div>
                <div className="space-y-4 p-4">

                {/* 초과액 검사(1) — 편차 소카드는 결과 좌측, 기준 편차 비교(3)의 같은 편차와 마커·호버로 연결 */}
                <TestSection
                  title="초과액 검사(1)"
                  question="거래가가 잣대보다 부풀었는가 (표시 기준: 편차 +5% 초과)"
                  cols="sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.85fr_12.6rem]"
                  step={1}
                >
                  <LinkedDevCard
                    label="② 세금계산서 공급가액"
                    value={won(r.invoiceSupply)}
                    sub="부가세 제외 · 홈택스 원본"
                    active={capLinkHover}
                    onHover={setCapLinkHover}
                    chip="샘플"
                    cardRef={(el) => (cardRefs.current["cap1"] = el)}
                  />
                  <ValueCard
                    label={`③ 참조가${ref1Label ? ` — ${ref1Label}` : ""}`}
                    value={won(t.ref1)}
                    sub={t.ref1 == null ? "표준가격 미수신 · 조달 미등재" : ref1Label === "표준가격" ? "공단 잣대(스택 1순위)" : "시장 잣대(공급가액 환산)"}
                    chip={r.stdPrice == null && r.shopSource === "live" ? "실데이터" : "샘플"}
                  />
                  {/* 참조가가 없어도 카드와 검사 3 연결은 남긴다 — 자리를 비우면 "편차를 안 본다"로 읽히고,
                      값이 없다고 연결을 끊으면 "이 편차가 검사 3으로 간다"는 구조 자체가 안 보인다 */}
                  <LinkedDevCard
                    label={ref1Label ? `편차 — ${ref1Label} 기준` : "편차"}
                    value={pct(t.d1)}
                    sub={t.d1 != null ? "(공급가액 − 참조가) ÷ 참조가" : "참조가 없음 — 편차를 낼 수 없음"}
                    active={devLinkHover}
                    onHover={setDevLinkHover}
                    cardRef={(el) => (cardRefs.current["dev1"] = el)}
                  />
                  <ResultCard
                    v={t.v1}
                    main={t.d1 != null && t.premium != null ? won(t.premium) : "대조 불가"}
                    sub={
                      t.d1 != null && t.premium != null && t.premium > 0
                        ? `초과액 · 기금 초과 추정 ${won(t.premium * 0.8)} (지원율 0.8)`
                        : t.d1 != null
                          ? "참조가 이하 — 초과액 없음"
                          : "참조가 없음 → 침묵 신호로 이관"
                    }
                  />
                </TestSection>

                {/* 산식 비교 검사(2) */}
                <TestSection
                  title="산식 비교 검사(2)"
                  question="교부액이 규정 상한 안인가 (근거: 고용노동부고시 제2026-15호 제30조)"
                  cols="sm:grid-cols-3 xl:grid-cols-[1fr_1fr_12.6rem]"
                  step={2}
                >
                  <ValueCard label="① 교부(통지서)" value={won(r.grantAmt)} sub="교부결정통지서 업로드 → 담당관 확정" chip="샘플" />
                  <LinkedDevCard
                    label="산식 상한"
                    value={won(t.cap2)}
                    sub={`min(공급가액 ${won(r.invoiceSupply)}×80%, 한도 ${won(T2_ITEM_CAP)})`}
                    active={capLinkHover}
                    onHover={setCapLinkHover}
                    chip="샘플"
                    cardRef={(el) => (cardRefs.current["cap2"] = el)}
                  />
                  <ResultCard
                    v={t.v2}
                    main={
                      t.over2 != null ? (
                        t.v2.label === "산식초과" ? (
                          <>
                            {won(t.over2)} <span className="text-xs text-[#0a7ea4]">[초과]</span>
                          </>
                        ) : (
                          <>
                            상한 안 <span className="text-xs text-muted">[여유 {won(Math.abs(t.over2))}]</span>
                          </>
                        )
                      ) : (
                        "역산 불가"
                      )
                    }
                    sub={t.over2 != null ? "교부 − 상한 (양수면 규정 초과 관측)" : "계산서 미수신 — 상한을 만들 수 없음"}
                  />
                </TestSection>

                {/* 기준 편차 비교(3) */}
                <TestSection
                  title="기준 편차 비교(3)"
                  question="잣대끼리 서로 맞는가 — 기준가 오염 탐지 (표시 기준: 차이 30%p 초과)"
                  cols="sm:grid-cols-3 xl:grid-cols-[1fr_1fr_12.6rem]"
                  step={3}
                >
                  {/* 검사 1의 편차가 어느 잣대 기준인지에 따라 짝이 갈린다. 참조가가 없어 잣대를 못 정한
                      경우에도 표준가격 쪽을 짝으로 남겨 "검사 1 → 검사 3" 연결 자체는 보이게 한다. */}
                  {devPartner === "표준가격" ? (
                    <LinkedDevCard
                      label="③ 표준가격 기준 편차"
                      value={pct(t.d3std)}
                      sub={`(공급가액 − 표준가격) ÷ 표준가격 · 표준 ${won(r.stdPrice)}`}
                      active={devLinkHover}
                      onHover={setDevLinkHover}
                      cardRef={(el) => (cardRefs.current["dev3"] = el)}
                    />
                  ) : (
                    <ValueCard label="③ 표준가격 기준 편차" value={pct(t.d3std)} sub={`(공급가액 − 표준가격) ÷ 표준가격 · 표준 ${won(r.stdPrice)}`} chip="샘플" />
                  )}
                  {devPartner === "조달단가" ? (
                    <LinkedDevCard
                      label="③ 조달단가 기준 편차"
                      value={pct(t.d3shop)}
                      sub={`(공급가액 − 조달단가) ÷ 조달단가 · 조달 ${won(r.shopSupply)}`}
                      active={devLinkHover}
                      onHover={setDevLinkHover}
                      cardRef={(el) => (cardRefs.current["dev3"] = el)}
                    />
                  ) : (
                    <ValueCard label="③ 조달단가 기준 편차" value={pct(t.d3shop)} sub={`(공급가액 − 조달단가) ÷ 조달단가 · 조달 ${won(r.shopSupply)}`} chip={r.shopSource === "live" ? "실데이터" : "샘플"} />
                  )}
                  <ResultCard
                    v={t.v3}
                    main={
                      t.gap3 != null ? (
                        <>
                          {t.gap3.toFixed(1)}%p{" "}
                          {/* 접미어 색은 임계(30%p)를 넘겼을 때만 신호색 — 통과한 건까지 물들이지 않는다 */}
                          <span className={`text-xs ${t.v3.tone === "amber" ? "text-[#b45309]" : "text-muted"}`}>[차이]</span>
                        </>
                      ) : (
                        "대조 불가"
                      )
                    }
                    sub={
                      t.gap3 != null
                        ? t.v3.label === "잣대불일치"
                          ? "사업장 이전에 기준가 점검 후보 — 시장가 조사 우선 배정"
                          : "두 잣대가 같은 방향을 가리킴"
                        : `잣대 2개 필요 — 현재 ${r.stdPrice != null ? "표준가격만" : r.shopSupply != null ? "조달단가만" : "없음"}`
                    }
                  />
                </TestSection>

                {/* 보조 검사 — 중복 · 침묵 */}
                <TestSection title="보조 검사" question="승인번호 중복(계산서 재사용) · 침묵 신호(잣대 전무 품목) — 신호등 집계 밖" cols="sm:grid-cols-2">
                    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg bg-canvas dark:bg-surface-dark">
                      <div className={`${CARD_HEAD} ${HEAD_EDGE}`}>
                        <FitText text="승인번호 중복" />
                      </div>
                      <div className={`flex flex-1 flex-col rounded-lg border ${dupSites.length > 0 ? "border-[#a21caf]/40" : "border-hairline dark:border-white/10"}`}>
                      <div className={`flex-1 p-3 ${dupSites.length > 0 ? "bg-[#a21caf]/5" : ""}`}>
                        {/* 본문은 검은색 유지 — 신호 색은 테두리·바탕·상태 띠가 이미 말한다 */}
                        <p className={`text-[11px] ${dupSites.length > 0 ? "font-semibold text-ink dark:text-on-dark" : "text-muted dark:text-on-dark-soft"}`}>
                          {dupSites.length > 0 ? `…${r.approvalNo.slice(-8)} — ${dupSites.join(", ")}에서도 참조됨` : "이 승인번호의 중복 참조 없음"}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted dark:text-on-dark-soft">같은 계산서의 재사용만 잡는다 · 실물 대조는 공단 명판사진 영역</p>
                      </div>
                      <div className={`border-t px-3 py-1 text-center text-[10px] font-bold ${dupSites.length > 0 ? BADGE_MAGENTA : BADGE_GREEN}`}>{dupSites.length > 0 ? "중복참조" : "정상"}</div>
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg bg-canvas dark:bg-surface-dark">
                      <div className={`${CARD_HEAD} ${HEAD_EDGE}`}>
                        <FitText text="침묵 신호(품목)" />
                      </div>
                      <div className={`flex flex-1 flex-col rounded-lg border ${silent ? "border-[#6d28d9]/40" : "border-hairline dark:border-white/10"}`}>
                      <div className={`flex flex-1 flex-col p-3 ${silent ? "bg-[#6d28d9]/5" : ""}`}>
                        <p className={`flex-1 text-[11px] ${silent ? "font-semibold text-[#6d28d9]" : "text-muted dark:text-on-dark-soft"}`}>
                          {silent ? "5개 지표 중 3개 해당 (샘플)" : "해당 지표 없음"}
                        </p>
                        <button
                          type="button"
                          onClick={() => setSilenceOpen(true)}
                          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface-strong py-2 text-[11px] font-semibold text-ink transition hover:bg-hairline-strong dark:border-white/10 dark:bg-white/10 dark:text-on-dark dark:hover:bg-white/20"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                            <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
                          </svg>
                          5개 지표 상세 보기
                        </button>
                      </div>
                      <div className={`border-t px-3 py-1 text-center text-[10px] font-bold ${silent ? BADGE_VIOLET : BADGE_NEUTRAL}`}>{silent ? "조사 후보" : "해당 없음"}</div>
                      </div>
                    </div>
                </TestSection>

                <p className="text-[10px] text-muted dark:text-on-dark-soft">
                  ※ 교부·계산서·표준가격은 파일 업로드/공단 온보드 게이트 전까지 샘플이고, 조달단가만 나라장터 당일 피드로 실연동됩니다({data.shopNote.replace(/^조달단가:\s*/, "")}).
                  각 검사의 배지는 표시 기준에 따른 관측이며 법적 판정이 아닙니다 — 판정·시장가 조사·지급 보류는 공단의 권한입니다.
                  한계: 판매사와 사업장이 공모해 서류를 맞추면 이 검증은 통과됩니다.
                </p>
                </div>
              </>
            ) : (
              <p className="p-8 text-center text-xs text-muted">교부 건을 선택하세요.</p>
            )}
          </div>
        </div>
      )}

      {silenceOpen && r && <SilenceModal item={r.item} silent={silent} onClose={() => setSilenceOpen(false)} />}

      {/* 스포트라이트 — 화면 전체 딤 + 연결 카드 2장만 마스크 홀로 밝게 + 네온 실선(일방향 펄스: 검사1 → 검사2/3) */}
      {(devLinkHover || capLinkHover) &&
        linkGeo &&
        createPortal(
          <svg className="pointer-events-none fixed inset-0 z-[70] h-full w-full" aria-hidden>
            <defs>
              <mask id="subsidy-link-spot">
                <rect width="100%" height="100%" fill="white" />
                {linkGeo.holes.map((h, i) => (
                  <rect key={i} x={h.x - 6} y={h.y - 6} width={h.w + 12} height={h.h + 12} rx="12" fill="black" />
                ))}
              </mask>
            </defs>
            {/* 전체 화면 딤 (홀 2개 제외) */}
            <rect width="100%" height="100%" fill="rgba(10,12,18,0.55)" mask="url(#subsidy-link-spot)" />
            {/* 네온 실선 — 할로 + 코어 */}
            <path d={linkGeo.path} fill="none" stroke="#0d74ce" strokeOpacity="0.35" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
            <path
              d={linkGeo.path}
              fill="none"
              stroke="#3b9eff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 4px rgba(59,158,255,0.9)) drop-shadow(0 0 12px rgba(13,116,206,0.6))" }}
            />
            {/* 일방향 펄스 — 밝은 세그먼트가 검사1에서 출발해 도착 카드 쪽으로만 흐른다 */}
            <path d={linkGeo.path} pathLength={100} fill="none" stroke="#cfe6ff" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="16 84" style={{ filter: "drop-shadow(0 0 6px rgba(207,230,255,0.95))" }}>
              <animate attributeName="stroke-dashoffset" from="100" to="0" dur="1.3s" repeatCount="indefinite" />
            </path>
          </svg>,
          document.body,
        )}
    </section>
  );
}
