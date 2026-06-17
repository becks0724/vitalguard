// 로그인 화면 하단 — App Store / Google Play 다운로드 배지 버튼 (발표용 데모, 비공개 프로토타입이라 스토어 링크는 추후 연결).
"use client";

import type { ComponentProps } from "react";

// efferd/app-store-button(21st.dev) 아이콘 path 그대로 이식 — 단색 currentColor.
function AppleIcon({ fill = "currentColor", ...props }: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill={fill} aria-hidden="true" {...props}>
      <path d="M18.546,12.763c0.024-1.87,1.004-3.597,2.597-4.576c-1.009-1.442-2.64-2.323-4.399-2.378c-1.851-0.194-3.645,1.107-4.588,1.107c-0.961,0-2.413-1.088-3.977-1.056C6.122,5.927,4.25,7.068,3.249,8.867c-2.131,3.69-0.542,9.114,1.5,12.097c1.022,1.461,2.215,3.092,3.778,3.035c1.529-0.063,2.1-0.975,3.945-0.975c1.828,0,2.364,0.975,3.958,0.938c1.64-0.027,2.674-1.467,3.66-2.942c0.734-1.041,1.299-2.191,1.673-3.408C19.815,16.788,18.548,14.879,18.546,12.763z" />
      <path d="M15.535,3.847C16.429,2.773,16.87,1.393,16.763,0c-1.366,0.144-2.629,0.797-3.535,1.829c-0.895,1.019-1.349,2.351-1.261,3.705C13.352,5.548,14.667,4.926,15.535,3.847z" />
    </svg>
  );
}

// efferd/play-store-button(21st.dev) 아이콘 path 그대로 이식 — 단색 currentColor.
function PlayStoreIcon({ fill = "currentColor", ...props }: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill={fill} aria-hidden="true" {...props}>
      <path d="m21.762,9.942L4.67.378c-.721-.466-1.635-.504-2.393-.099-.768.411-1.246,1.208-1.246,2.08v19.282c0,.872.477,1.668,1.246,2.079.755.404,1.668.37,2.393-.098l17.092-9.564c.756-.423,1.207-1.192,1.207-2.058s-.451-1.635-1.207-2.058Zm-5.746-1.413l-2.36,2.36L5.302,2.534l10.714,5.995ZM2.604,21.906V2.094l9.941,9.906L2.604,21.906Zm2.698-.439l8.355-8.355,2.36,2.36-10.714,5.995Zm15.692-8.78l-3.552,1.987-2.674-2.674,2.674-2.674,3.552,1.987c.363.203.402.548.402.686s-.039.483-.402.686Z" />
    </svg>
  );
}

// 공식 배지 톤 — 셰이더 블루 배경 위 검정 배지(흰 로고/텍스트) + 글래스 마감.
const BADGE_CLASS =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-black/85 px-4 text-white shadow-lg backdrop-blur-sm transition hover:bg-black active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export function StoreBadges() {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        className={BADGE_CLASS}
        aria-label="Download on the App Store"
        title="App Store (출시 예정)"
      >
        <AppleIcon className="h-6 w-6" />
        <span className="flex flex-col items-start justify-center pr-1 text-left leading-none">
          <span className="text-[10px] tracking-tight">Download on the</span>
          <span className="text-base font-bold">App Store</span>
        </span>
      </button>

      <button
        type="button"
        className={BADGE_CLASS}
        aria-label="Get it on Google Play"
        title="Google Play (출시 예정)"
      >
        <PlayStoreIcon className="h-6 w-6" />
        <span className="flex flex-col items-start justify-center pr-1 text-left leading-none">
          <span className="text-[10px] tracking-tight">GET IT ON</span>
          <span className="text-base font-bold">Google Play</span>
        </span>
      </button>
    </div>
  );
}
