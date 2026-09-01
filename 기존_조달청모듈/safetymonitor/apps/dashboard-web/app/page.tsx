import AssignmentChatWidget from "./components/AssignmentChatWidget";
import { DemoDashboard } from "./components/DemoDashboard";
import { LoginGate } from "./components/LoginGate";
import { SiteFooter } from "./components/SiteFooter";

export default function Home() {
  return (
    <LoginGate>
      <DemoDashboard />
      {/* 공개 문서 진입점 — 개인정보 처리방침은 로그인 없이 닿아야 한다 */}
      <SiteFooter />
      {/* 작업 배치 어시스턴트 — 우하단 말풍선 플로팅 위젯(접기/열기) */}
      <AssignmentChatWidget />
    </LoginGate>
  );
}
