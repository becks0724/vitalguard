// 공단 보조금 정합 검증 — 독립 라우트(로그인 필요). /safety-audit 형태를 따른다.
import { LoginGate } from "../components/LoginGate";
import SubsidyAuditBoard from "../components/SubsidyAuditBoard";

export const metadata = {
  title: "공단 보조금 검증 — VitAlGuard",
  description: "교부결정액·세금계산서·참조가 스택을 교차해 보조금의 금액 도달을 관측",
};

export default function SubsidyAuditPage() {
  return (
    <LoginGate>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <SubsidyAuditBoard />
      </main>
    </LoginGate>
  );
}
