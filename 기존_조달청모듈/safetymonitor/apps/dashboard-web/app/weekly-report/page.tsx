// 안전관리비 주간 검증 보고서 — 감독관 제출본(데모). 4축 + 4중 교차대조 종합.
import { LoginGate } from "../components/LoginGate";
import WeeklyReportBoard from "../components/WeeklyReportBoard";

export const metadata = {
  title: "안전관리비 주간 검증 보고서 — VitAlGuard",
  description: "4축 + 4중 교차대조(장부·돈·사람·증빙)를 감독관 주간 제출본으로 종합",
};

export default function WeeklyReportPage() {
  return (
    <LoginGate>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <WeeklyReportBoard />
      </main>
    </LoginGate>
  );
}
