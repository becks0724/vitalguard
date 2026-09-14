// 앱 record_editor.dart의 paintAnnotation과 같은 순서로 개별 도형을 합성한다.
export type InkPoint = [number, number, number];
export type InkStroke = {
  tool: "pen" | "marker" | "rectangle";
  color: number;
  width: number;
  points: InkPoint[];
};
export type InkReadResult =
  | { status: "ready"; strokes: InkStroke[] }
  | { status: "unsupported" | "invalid" };
export type ImageRect = { left: number; top: number; width: number; height: number };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function readInk(value: unknown): InkReadResult {
  if (!isObject(value)) return { status: "invalid" };
  // 버전을 확인하기 전에는 획의 구조나 의미를 추측하지 않는다.
  if (value.v !== 1) return { status: "unsupported" };
  if (!Array.isArray(value.strokes)) return { status: "invalid" };
  const strokes: InkStroke[] = [];
  for (const stroke of value.strokes) {
    if (!isObject(stroke)) return { status: "invalid" };
    // 옛 지우개는 표시하지 않는다. 현재 앱은 획 삭제 후 지우개 없이 저장한다.
    if (stroke.tool === "eraser") continue;
    if (
      !["pen", "marker", "rectangle"].includes(String(stroke.tool)) ||
      !isFiniteNumber(stroke.color) || !Number.isInteger(stroke.color) ||
      stroke.color < 0 || stroke.color > 0xffffffff ||
      !isFiniteNumber(stroke.width) || stroke.width <= 0 ||
      !Array.isArray(stroke.points) ||
      !stroke.points.every((p) => Array.isArray(p) && p.length === 3 && p.every(isFiniteNumber))
    ) return { status: "invalid" };
    strokes.push(stroke as InkStroke);
  }
  return { status: "ready", strokes };
}

export function argbToRgba(color: number, alphaOverride?: number): string {
  const alpha = alphaOverride ?? ((color >>> 24) & 0xff) / 255;
  return `rgba(${(color >>> 16) & 0xff}, ${(color >>> 8) & 0xff}, ${color & 0xff}, ${alpha})`;
}

export function pressureWidth(width: number, displayWidth: number, pressure: number): number {
  return width * displayWidth * (0.45 + 0.9 * Math.max(0, Math.min(1, pressure)));
}

/** object-fit: contain / object-position: center의 실제 사진 영역(CSS px). */
export function containImageRect(
  imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number,
): ImageRect | null {
  if (![imageWidth, imageHeight, boxWidth, boxHeight].every((n) => Number.isFinite(n) && n > 0)) {
    return null;
  }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height };
}

export type InkCanvas = Pick<CanvasRenderingContext2D,
  "strokeStyle" | "fillStyle" | "lineWidth" | "lineCap" | "lineJoin" | "miterLimit" |
  "beginPath" | "arc" | "fill" | "moveTo" | "lineTo" | "stroke" | "strokeRect"
>;

export function drawInk(context: InkCanvas, ink: InkReadResult, rect: ImageRect): void {
  if (ink.status !== "ready") return;
  context.lineCap = "round";
  context.lineJoin = "miter"; // Flutter Paint의 사각형 기본 모서리.
  context.miterLimit = 4;
  for (const stroke of ink.strokes) {
    const first = stroke.points[0];
    if (!first) continue;
    const color = argbToRgba(stroke.color, stroke.tool === "marker" ? 0.35 : undefined);
    context.strokeStyle = color;
    context.fillStyle = color;
    const x = (p: InkPoint) => rect.left + p[0] * rect.width;
    const y = (p: InkPoint) => rect.top + p[1] * rect.height;
    if (stroke.tool === "rectangle") {
      const last = stroke.points[stroke.points.length - 1]!;
      context.lineWidth = stroke.width * rect.width;
      context.strokeRect(
        Math.min(x(first), x(last)), Math.min(y(first), y(last)),
        Math.abs(x(last) - x(first)), Math.abs(y(last) - y(first)),
      );
      continue;
    }
    for (let i = 0; i < stroke.points.length; i++) {
      const point = stroke.points[i]!;
      context.lineWidth = pressureWidth(stroke.width, rect.width, point[2]);
      // 매 점마다 새 경로: 필압과 형광펜의 겹친 부분 알파 합성도 앱과 같게 유지한다.
      context.beginPath();
      if (i === 0) {
        context.arc(x(point), y(point), context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        const previous = stroke.points[i - 1]!;
        context.moveTo(x(previous), y(previous));
        context.lineTo(x(point), y(point));
        context.stroke();
      }
    }
  }
}
