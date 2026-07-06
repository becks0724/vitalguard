// Next.js 서버 기동 훅 — CCTV CAM-02 낙상 폴러(백그라운드 루프)를 nodejs 런타임에서 1회 기동한다.
// Edge 런타임/빌드 타임엔 기동하지 않는다(fetch 루프는 노드 서버 프로세스 전용).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCctvFallPoller } = await import("./lib/cctv-fall-poller");
    startCctvFallPoller();
  }
}
