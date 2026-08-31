// Open-Meteo weatherCode → 한글 날씨 상태 라벨(순수).
// WeatherStrip(화면 패널)과 현장 챗봇(site-chat-context)이 같은 매핑을 쓴다 — 사본 금지.
// WeatherStrip 은 "use client" 모듈이라 서버(챗봇 컨텍스트)가 직접 임포트할 수 없어 여기로 내렸다.
export function weatherLabel(code: number): string {
  if (code === 0) return "맑음";
  if (code === 1) return "대체로 맑음";
  if (code === 2) return "구름 조금";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if (code >= 51 && code <= 57) return "이슬비";
  if (code >= 61 && code <= 67) return "비";
  if (code >= 71 && code <= 77) return "눈";
  if (code >= 80 && code <= 82) return "소나기";
  if (code >= 85 && code <= 86) return "눈소나기";
  if (code === 95) return "뇌우";
  if (code === 96 || code === 99) return "강한 뇌우";
  return `코드 ${code}`;
}
