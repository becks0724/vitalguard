// 대시보드 루트 레이아웃 — 한국어 lang 고정, 라이트/다크 테마 컨텍스트
import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";

export const metadata: Metadata = {
  title: "SafetyMonitor — 관제 대시보드 (프로토타입)",
  description: "산업 현장 작업자 생체 모니터링 데모 대시보드",
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
