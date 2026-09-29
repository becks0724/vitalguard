import { evaluateWindKmh } from "./weather-rules";

type Current = { obsSource?: string; precipitationType?: number; windKmh: number; windGustKmh?: number };
/** 표시 효과만 정한다. 강수는 기상청 PTY, 풍속 위험은 관제의 기존 판정 단일 소스. */
export function appWeatherEffects(current: Current) {
  const pty = current.obsSource === "kma-ncst" ? current.precipitationType : undefined;
  const precipitation = pty === 0 ? "none" : pty === 1 || pty === 5 ? "rain"
    : pty === 3 || pty === 7 ? "snow" : pty === 2 || pty === 6 ? "mixed" : "unknown";
  return {
    precipitation,
    precipitationSource: precipitation === "unknown" ? null : "kma-ncst",
    // 온열·미세먼지·특보의 종합 danger로 바람을 추측하지 않는다.
    windDanger: Number.isFinite(current.windKmh) &&
      evaluateWindKmh(current.windKmh, current.windGustKmh).currentSeverity === "danger",
  };
}
