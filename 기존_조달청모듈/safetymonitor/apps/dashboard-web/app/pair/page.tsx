// /pair — 워치 QR 을 폰으로 스캔했을 때 열리는 승인 페이지(무세션 · 코드는 ?code= 로 채운다)
import { PairApprove } from "../components/PairApprove";

export const metadata = {
  title: "워치 로그인 승인 — VitAlGuard",
  description: "워치에 표시된 코드를 관제웹 계정으로 승인합니다",
};

export const dynamic = "force-dynamic";

export default async function PairPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.code) ? sp.code[0] : sp.code;
  return <PairApprove initialCode={typeof raw === "string" ? raw.slice(0, 16) : ""} />;
}
