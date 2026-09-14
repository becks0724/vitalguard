import assert from "node:assert/strict";
import { test } from "node:test";
import { argbToRgba, containImageRect, drawInk, pressureWidth, readInk, type InkCanvas } from "./ink-render";

const pen = { tool: "pen", color: 0xff123456, width: 0.01, points: [[0.1, 0.2, 0], [0.2, 0.4, 0.5], [0.6, 0.7, 1]] };
const rect = { left: 100, top: 50, width: 400, height: 200 };
function recordingCanvas() {
  const calls: { method: string; args: number[]; width: number; color: unknown }[] = [];
  const record = (method: string, args: number[]) => calls.push({ method, args, width: context.lineWidth, color: context.strokeStyle });
  const context: InkCanvas = {
    lineWidth: 1, lineCap: "butt", lineJoin: "miter", miterLimit: 10, strokeStyle: "", fillStyle: "",
    beginPath: () => { record("beginPath", []); },
    arc: (...args) => { record("arc", args.slice(0, 5) as number[]); },
    fill: () => { record("fill", []); },
    moveTo: (...args) => { record("moveTo", args); },
    lineTo: (...args) => { record("lineTo", args); },
    stroke: () => { record("stroke", []); },
    strokeRect: (...args) => { record("strokeRect", args); },
  };
  return { context, calls };
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("ARGB의 채널 순서와 0/중간/255 알파를 rgba로 보존한다", () => {
  assert.equal(argbToRgba(4278190080), "rgba(0, 0, 0, 1)");
  assert.equal(argbToRgba(0x80123456), `rgba(18, 52, 86, ${128 / 255})`);
  assert.equal(argbToRgba(0x00123456), "rgba(18, 52, 86, 0)");
  assert.equal(argbToRgba(0xffffffff), "rgba(255, 255, 255, 1)");
});

test("필압은 0~1로 clamp한 뒤 앱의 0.45 + 0.9*p 공식을 적용한다", () => {
  for (const [pressure, expected] of [[-2, 1.8], [0, 1.8], [0.5, 3.6], [1, 5.4], [3, 5.4]]) {
    close(pressureWidth(0.01, 400, pressure!), expected!);
  }
  close(pressureWidth(0.01, 800, 0.5), 7.2);
});

test("펜: 첫 점은 필압 반지름의 채운 원, 이후는 현재 점 굵기의 개별 round 선분", () => {
  const { context, calls } = recordingCanvas();
  drawInk(context, readInk({ v: 1, strokes: [pen] }), rect);
  assert.equal(context.lineCap, "round");
  assert.deepEqual(calls.map((c) => c.method), [
    "beginPath", "arc", "fill", "beginPath", "moveTo", "lineTo", "stroke", "beginPath", "moveTo", "lineTo", "stroke",
  ]);
  assert.deepEqual(calls[1]!.args, [140, 90, 0.9, 0, Math.PI * 2]);
  assert.deepEqual(calls.filter((c) => c.method === "moveTo").map((c) => c.args), [[140, 90], [180, 130]]);
  assert.deepEqual(calls.filter((c) => c.method === "lineTo").map((c) => c.args), [[180, 130], [340, 190]]);
  const segments = calls.filter((c) => c.method === "stroke");
  close(segments[0]!.width, 3.6);
  close(segments[1]!.width, 5.4);
  assert.equal(context.fillStyle, "rgba(18, 52, 86, 1)");
});

test("형광펜: 원래 알파에 곱하지 않고 0.35로 대체, 점·선분마다 따로 합성한다", () => {
  const { context, calls } = recordingCanvas();
  drawInk(context, readInk({ v: 1, strokes: [{ ...pen, tool: "marker", color: 0x80123456 }] }), rect);
  assert.equal(context.fillStyle, "rgba(18, 52, 86, 0.35)");
  const painted = calls.filter((c) => c.method === "fill" || c.method === "stroke");
  assert.equal(painted.length, 3);
  assert.ok(painted.every((c) => c.color === "rgba(18, 52, 86, 0.35)"));
  close(painted[2]!.width, 5.4);
});

test("사각형: 첫/마지막 점의 최소 모서리, 고정 너비, 채우기 없음", () => {
  const { context, calls } = recordingCanvas();
  drawInk(context, readInk({ v: 1, strokes: [{ ...pen, tool: "rectangle", points: [[0.8, 0.8, 0], [0.9, 0.9, 0.5], [0.2, 0.1, 1]] }] }), rect);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { method: "strokeRect", args: [180, 70, 240, 140], width: 4, color: "rgba(18, 52, 86, 1)" });
  assert.equal(context.lineJoin, "miter");
});

test("빈 획과 옛 지우개는 그리지 않고, 단일 점은 원 하나만 그린다", () => {
  const { context, calls } = recordingCanvas();
  drawInk(context, readInk({ v: 1, strokes: [
    { ...pen, points: [] }, { tool: "eraser" }, { ...pen, points: [[0.5, 0.5, 1]] },
  ] }), rect);
  assert.deepEqual(calls.map((c) => c.method), ["beginPath", "arc", "fill"]);
  close(calls[1]!.args[2]!, 2.7);
});

test("v가 정확히 숫자 1이 아니면 획을 해석하거나 그리지 않는다", () => {
  for (const v of [undefined, null, 0, 2, "1"]) {
    const { context, calls } = recordingCanvas();
    const ink = readInk({ v, strokes: [pen] });
    assert.equal(ink.status, "unsupported");
    drawInk(context, ink, rect);
    assert.equal(calls.length, 0);
  }
});

test("손상된 v1은 일부 획만 표시하지 않고 전체 렌더를 차단한다", () => {
  for (const value of [null, [], { v: 1 }, ...[
    { ...pen, width: 0 }, { ...pen, color: -1 }, { ...pen, tool: "future-tool" },
    { ...pen, points: [[0, 0, Number.NaN]] }, { ...pen, points: [[0, 0]] },
  ].map((bad) => ({ v: 1, strokes: [pen, bad] }))]) {
    const { context, calls } = recordingCanvas();
    const ink = readInk(value);
    assert.equal(ink.status, "invalid");
    drawInk(context, ink, rect);
    assert.equal(calls.length, 0);
  }
});

test("contain: 가로 사진의 상하 여백과 세로 사진의 좌우 여백을 포함한다", () => {
  assert.deepEqual(containImageRect(1600, 800, 800, 600), { left: 0, top: 100, width: 800, height: 400 });
  assert.deepEqual(containImageRect(800, 1600, 800, 600), { left: 250, top: 0, width: 300, height: 600 });
  assert.deepEqual(containImageRect(1600, 800, 400, 200), { left: 0, top: 0, width: 400, height: 200 });
});

test("contain: 리사이즈 후에도 중심 좌표와 너비 기준 굵기가 실제 사진에 맞는다", () => {
  for (const [width, height] of [[800, 600], [400, 300], [375.5, 240.25]]) {
    const contained = containImageRect(800, 1600, width!, height!)!;
    const { context, calls } = recordingCanvas();
    drawInk(context, readInk({ v: 1, strokes: [{ ...pen, points: [[0.5, 0.5, 0.5]] }] }), contained);
    const circle = calls.find((c) => c.method === "arc")!;
    close(circle.args[0]!, width! / 2);
    close(circle.args[1]!, height! / 2);
    close(circle.args[2]!, 0.01 * contained.width * 0.9 / 2);
  }
});

test("이미지가 로딩 중이거나 박스 크기가 잘못됐으면 영역을 만들지 않는다", () => {
  assert.equal(containImageRect(0, 100, 800, 600), null);
  assert.equal(containImageRect(100, 100, 0, 600), null);
  assert.equal(containImageRect(100, 100, Number.NaN, 600), null);
});
