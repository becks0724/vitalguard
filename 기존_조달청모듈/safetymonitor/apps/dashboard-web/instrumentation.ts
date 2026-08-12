// Next.js 서버 기동 훅 — 아웃바운드 연결 시도 상한을 올리고, CCTV CAM-02 낙상 폴러(백그라운드 루프)를
// nodejs 런타임에서 1회 기동한다. Edge 런타임/빌드 타임엔 기동하지 않는다(fetch 루프는 노드 서버 프로세스 전용).

// Node 의 Happy Eyeballs 는 주소 하나당 이 시간 안에 TCP 연결이 끝나지 않으면 그 시도를 버린다(기본 250ms).
// Cloud NAT 도입 후 RainViewer(독일)까지 connect 가 253~266ms 가 돼 매번 완료 6~16ms 전에 잘렸고,
// 다음 후보인 IPv6 는 IPv4 전용 VPC 라 경로가 없어 전 시도 실패 → fetch failed → /api/radar 502.
// 같은 자리에서 curl 은 200 이라(이 상한이 없다) 원인이 이틀간 안 보였다 — 하네스 교훈 L-52.
// ⚠ 기본값은 런타임 버전에 따라 다르다 — 프로덕션 이미지 node:22 는 250ms, 로컬 node:26 은 500ms 라
// 로컬에서는 재현되지 않는다. 그래서 기본값에 기대지 않고 명시한다.
// 3000ms 는 VPC 안 node:22 컨테이너에서 3/3 성공을 실측한 값. 라우트별 AbortSignal.timeout 이
// 요청 총 시간을 따로 제한하므로 이 값을 올려도 응답이 그만큼 늘어지지 않는다.
// open-meteo 도 237~246ms 로 기본값 경계에 붙어 있어 함께 보호된다.
const CONNECT_ATTEMPT_TIMEOUT_MS = 3000;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setDefaultAutoSelectFamilyAttemptTimeout } = await import("node:net");
    setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
    const { startCctvFallPoller } = await import("./lib/cctv-fall-poller");
    startCctvFallPoller();
  }
}
