import { DemoDashboard } from "./components/DemoDashboard";
import { LoginGate } from "./components/LoginGate";

export default function Home() {
  return (
    <LoginGate>
      <DemoDashboard />
    </LoginGate>
  );
}
