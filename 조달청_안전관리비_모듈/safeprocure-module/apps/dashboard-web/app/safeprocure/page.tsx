// 안전조달(SafeProcure) 독립 데모 페이지 — 기존 화면을 건드리지 않는 신규 라우트.
// 방문: /safeprocure (키 없으면 샘플 데이터로 동작).
import ProcureRiskBoard from "../components/ProcureRiskBoard";

export const metadata = {
  title: "안전조달 — 발주 단계 안전 리스크",
  description: "나라장터 조달데이터와 AI로 착공 전 안전 리스크를 선별",
};

export default function SafeProcurePage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <ProcureRiskBoard />
    </main>
  );
}
