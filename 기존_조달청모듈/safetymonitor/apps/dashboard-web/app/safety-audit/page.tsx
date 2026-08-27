// 안전관리비 실집행 검증 — VitAlGuard 핵심 응용. 독립 라우트(로그인 필요).
import { LoginGate } from "../components/LoginGate";
import SafetyCostAuditBoard from "../components/SafetyCostAuditBoard";

export const metadata = {
  title: "안전관리비 실집행 검증 — VitAlGuard",
  description: "조달 계상액과 워치 출역(실집행)을 교차해 안전예산의 현장 도달을 검증",
};

export default function SafetyAuditPage() {
  return (
    <LoginGate>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <SafetyCostAuditBoard />
      </main>
    </LoginGate>
  );
}
