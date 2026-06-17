// Next.js 15 설정 — 모노레포 workspace 패키지 transpile 허용
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@safetymonitor/schemas"],
};

export default nextConfig;
