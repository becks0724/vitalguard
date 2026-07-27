// 대시보드 루트 레이아웃 — 한국어 lang 고정, 라이트/다크 테마 컨텍스트
import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";

export const metadata: Metadata = {
  title: "VitAlGuard — 관제 대시보드",
  description: "산업 현장 작업자 생체 모니터링 데모 대시보드",
  // 파비콘 — 다크모드 가독성 때문에 테마별로 나눈다.
  // Chrome·Firefox 는 sizes=any 인 SVG 를 우선 골라 내부 media query 로 전환하고,
  // SVG 내부 media query 를 무시하는 Safari 는 media 링크로 건 테마별 PNG 를 쓴다.
  // 순서 = 다크 PNG → 라이트 PNG → SVG. media 를 무시하고 '마지막'을 쓰는 브라우저가
  // 라이트(기존 동작)로 떨어지도록 다크를 앞에 둔다.
  // ⚠ 이 icons 를 선언하면 파일 컨벤션 app/icon.* 은 emit 되지 않는다(그래서 SVG 도 여기 명시).
  icons: {
    icon: [
      { url: "/brand/favicon-dark.png", type: "image/png", sizes: "256x256", media: "(prefers-color-scheme: dark)" },
      { url: "/brand/favicon-light.png", type: "image/png", sizes: "256x256", media: "(prefers-color-scheme: light)" },
      { url: "/brand/favicon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    // app/apple-icon.png 도 같은 이유로 밀려나므로 다시 명시(iOS 홈화면 아이콘 회귀 방지).
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

// hydration 전에 html.dark 클래스 미리 적용 — 라이트 → 다크 깜빡임 방지
const themeBootstrap = `(function(){try{var t=localStorage.getItem('safetymonitor.theme.v1');var dark=t!=='light';var c=document.documentElement.classList;if(dark)c.add('dark');else c.remove('dark');}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <head>
        {/* Cal.com-inspired typography — Inter (UI + display substitute) + Lato (차트). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lato:wght@400;700;900&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
