// 현장환경 항목용 단색(모노톤) 라인 아이콘 모음 — currentColor 상속, 외부 자산/의존성 없이 인라인 SVG.
// flaticon 등 외부 무료 아이콘은 출처 표기 의무·번들 라이선스 이슈가 있어 동일 스타일로 자체 제작.

type WeatherIconName =
  | "warning"
  | "bell"
  | "sun"
  | "partly"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder"
  | "thermometer"
  | "feels"
  | "humidity"
  | "discomfort"
  | "dust"
  | "wind"
  | "uv"
  | "umbrella"
  | "sunrise"
  | "sunset";

// WMO 기상 코드 → 날씨 아이콘 키 (TickerSegment '날씨' 항목용)
export function weatherIconKey(code: number): WeatherIconName {
  if (code === 0) return "sun";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 85 && code <= 86) return "snow";
  if (code === 95 || code === 96 || code === 99) return "thunder";
  return "cloud";
}

// 공통 구름 본체(여러 날씨 아이콘에서 재사용)
const CLOUD = "M7 18h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1A3.2 3.2 0 0 0 7 18Z";

function Paths({ name }: { name: string }) {
  switch (name) {
    case "warning":
      return (
        <>
          <path d="M12 3.5 2.5 20.5h19L12 3.5Z" />
          <path d="M12 10v4.5" />
          <path d="M12 17.6h.01" />
        </>
      );
    case "bell":
      return (
        <>
          <path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.8 5.8 1.8 5.8H4.2S6 13.5 6 9Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </>
      );
    case "sun":
      return (
        <>
          <circle cx="12" cy="12" r="3.6" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
        </>
      );
    case "partly":
      return (
        <>
          <circle cx="8" cy="7.5" r="2.6" />
          <path d="M8 2.6v1.4M3.3 7.5H1.9M4.4 3.9l1 1M11.6 3.9l-1 1" />
          <path d="M8.5 19h8a3 3 0 0 0 .3-6 4.3 4.3 0 0 0-8.2.7A2.8 2.8 0 0 0 8.5 19Z" />
        </>
      );
    case "cloud":
      return <path d={CLOUD} />;
    case "fog":
      return (
        <>
          <path d="M4 8.5h12.5" />
          <path d="M3 12.5h17" />
          <path d="M5 16.5h13" />
          <path d="M7 20.5h10" />
        </>
      );
    case "drizzle":
      return (
        <>
          <path d={CLOUD} />
          <path d="M9.5 20v1.6M12 20.4v1.6M14.5 20v1.6" />
        </>
      );
    case "rain":
      return (
        <>
          <path d={CLOUD} />
          <path d="M9 20l-1.2 2.2M12.2 20l-1.2 2.2M15.4 20l-1.2 2.2" />
        </>
      );
    case "snow":
      return (
        <>
          <path d={CLOUD} />
          <path d="M9 20.6h.01M12 22h.01M15 20.6h.01" />
        </>
      );
    case "thunder":
      return (
        <>
          <path d={CLOUD} />
          <path d="M12.5 19l-2.2 3h2.6l-2 3" />
        </>
      );
    case "thermometer":
      return (
        <>
          <path d="M13.5 13.6V5.2a2 2 0 0 0-4 0v8.4a3.6 3.6 0 1 0 4 0Z" />
          <path d="M11.5 8.5v6.4" />
        </>
      );
    case "feels":
      return (
        <>
          <path d="M11 13.6V5.2a2 2 0 0 0-4 0v8.4a3.6 3.6 0 1 0 4 0Z" />
          <path d="M9 8.5v6.4" />
          <path d="M16 6.5c1.3.9 1.3 2 0 3M18.5 5c1.8 1.4 1.8 3.1 0 4.5" />
        </>
      );
    case "humidity":
      return <path d="M12 3.2s5.8 6 5.8 10.2a5.8 5.8 0 0 1-11.6 0C6.2 9.2 12 3.2 12 3.2Z" />;
    case "discomfort":
      return (
        <>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M9 10.4h.01M15 10.4h.01" />
          <path d="M8.8 15.6q3.2-2.4 6.4 0" />
        </>
      );
    case "dust":
      return (
        <>
          <path d="M3 8h12" />
          <path d="M18 8h.01" />
          <path d="M3 12h16" />
          <path d="M3 16h10" />
          <path d="M16 16h.01" />
        </>
      );
    case "wind":
      return (
        <>
          <path d="M3 8h10.5a2.6 2.6 0 1 0-2.6-2.6" />
          <path d="M3 12h13.5a2.6 2.6 0 1 1-2.6 2.6" />
          <path d="M3 16h8" />
        </>
      );
    case "uv":
      return (
        <>
          <circle cx="12" cy="9.5" r="3.2" />
          <path d="M12 2.5v1.6M6.8 4.8l1.1 1.1M17.2 4.8l-1.1 1.1M3.4 9.5H5M19 9.5h1.6" />
          <path d="M5 20.5h14M8 17.4l-1 3M12 17.4l-1 3M16 17.4l-1 3" />
        </>
      );
    case "umbrella":
      return (
        <>
          <path d="M12 3.2a8 8 0 0 1 8 8H4a8 8 0 0 1 8-8Z" />
          <path d="M12 11.2v7.6a2 2 0 0 1-4 0" />
        </>
      );
    case "sunrise":
      return (
        <>
          <path d="M3 18.5h18" />
          <path d="M8 18.5a4 4 0 0 1 8 0" />
          <path d="M12 3v4.2M9.4 5.4 12 3l2.6 2.4" />
          <path d="M3 21.5h4M17 21.5h4" />
        </>
      );
    case "sunset":
      return (
        <>
          <path d="M3 18.5h18" />
          <path d="M8 18.5a4 4 0 0 1 8 0" />
          <path d="M12 7.6V3.4M9.4 5.2 12 7.6l2.6-2.4" />
          <path d="M3 21.5h4M17 21.5h4" />
        </>
      );
    default:
      return <circle cx="12" cy="12" r="8" />;
  }
}

export function WeatherIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <Paths name={name} />
    </svg>
  );
}
