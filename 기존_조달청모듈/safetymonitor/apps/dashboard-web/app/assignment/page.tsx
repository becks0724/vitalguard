// 작업 배치 어시스턴트 — 컨디션 등급×위험작업 매칭 챗(감독관용).
// 세션 토큰은 sessionStorage(탭 단위)라, 이 페이지도 LoginGate 로 감싸 새 탭에서도 로그인 흐름을 제공한다.
import AssignmentChatBoard from "../components/AssignmentChatBoard";
import AssignmentTaskDocPanel from "../components/AssignmentTaskDocPanel";
import { LoginGate } from "../components/LoginGate";

export const metadata = {
  title: "작업 배치 어시스턴트 — VitAlGuard",
  description: "작업자 컨디션 등급과 위험작업 태그를 규칙으로 매칭해 적재적소 배치를 보조",
};

export default function AssignmentPage() {
  return (
    <LoginGate>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <AssignmentTaskDocPanel />
        <AssignmentChatBoard />
      </main>
    </LoginGate>
  );
}
