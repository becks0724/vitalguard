// Next.js 15 설정 — 모노레포 workspace 패키지 transpile + Cloud Run 배포용 standalone 출력
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // 두 워크스페이스 패키지 모두 번들(standalone 에 dist 가 별도 모듈로 안 들어가는 monorepo 트레이싱
  // 한계 회피 — analyzers 누락 시 fusion(decideFusion) 런타임 실패).
  transpilePackages: ["@safetymonitor/schemas", "@safetymonitor/analyzers"],
  // Cloud Run 컨테이너용 최소 런타임 산출물(.next/standalone) — server.js + 추적된 node_modules 만.
  output: "standalone",
  // 모노레포라 트레이싱 루트를 레포 루트로 올려 workspace 패키지(@safetymonitor/*)를 standalone 에 포함.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
