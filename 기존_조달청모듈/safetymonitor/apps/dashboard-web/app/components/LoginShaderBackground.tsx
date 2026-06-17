// 로그인 화면 배경 — @paper-design/shaders-react MeshGradient(4색 네이비/블루 애니메이션 메시 그라데이션).
// WebGL 클라이언트 전용이라 mount 후에만 렌더(SSR/hydration 회피). 콘텐츠 뒤 고정 레이어.
"use client";

import { useEffect, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";

export function LoginShaderBackground() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
      <MeshGradient
        style={{ height: "100%", width: "100%" }}
        distortion={0.8}
        swirl={0.1}
        offsetX={0}
        offsetY={0}
        scale={1}
        rotation={0}
        speed={1}
        colors={[
          "hsl(216, 90%, 27%)",
          "hsl(243, 68%, 36%)",
          "hsl(205, 91%, 64%)",
          "hsl(211, 61%, 57%)",
        ]}
      />
    </div>
  );
}
