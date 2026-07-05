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
  // 보안 헤더(D1) — 다운그레이드(HSTS)·클릭재킹(X-Frame-Options)·MIME 스니핑(nosniff) 방어 +
  // CSP 는 우선 Report-Only 로 도입(위반을 브라우저 콘솔에 관측만, 요청 차단은 안 함) → 관측 후 enforce 로 승격.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "font-src 'self' data:",
      "connect-src 'self' https:",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
