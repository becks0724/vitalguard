import AssignmentChatWidget from "./components/AssignmentChatWidget";
import { DemoDashboard } from "./components/DemoDashboard";
import { LoginGate } from "./components/LoginGate";

export default function Home() {
  return (
    <LoginGate>
      <DemoDashboard />
      {/* 작업 배치 어시스턴트 — 우하단 말풍선 플로팅 위젯(접기/열기) */}
      <AssignmentChatWidget />
    </LoginGate>
  );
}
