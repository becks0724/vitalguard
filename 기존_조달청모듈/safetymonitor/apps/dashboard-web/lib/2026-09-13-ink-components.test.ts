// 브라우저/라이브 API 없이 실제 컴포넌트의 이벤트·effect를 표본 DOM/Canvas에 실행한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as inkRender from "./ink-render";

type Element = React.ReactElement<Record<string, unknown>>;
type Effect = { deps: unknown[]; cleanup?: () => void };
function component(name: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const slots: unknown[] = [];
  const effects = new Map<number, Effect>();
  let pending: (() => void)[] = [];
  let cursor = 0;
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: unknown) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo: (calculate: () => unknown) => calculate(),
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++;
      const previous = effects.get(index);
      if (previous && deps.length === previous.deps.length && deps.every((v, i) => Object.is(v, previous.deps[i]))) return;
      pending.push(() => {
        previous?.cleanup?.();
        effects.set(index, { deps, cleanup: effect() || undefined });
      });
    },
  };
  const text = readFileSync(join(import.meta.dirname, `../app/components/${name}.tsx`), "utf8");
  const code = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exported: Record<string, (props: Record<string, unknown>) => Element> = {};
  runInNewContext(code, {
    exports: exported,
    require: (id: string) => {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return jsxRuntime;
      assert.ok(id in modules, `예상 밖 의존성: ${id}`);
      return modules[id];
    },
    ...globals,
  });
  return {
    render(props: Record<string, unknown>, commit?: (tree: Element) => void) {
      cursor = 0;
      pending = [];
      const tree = exported[name]!(props);
      commit?.(tree);
      pending.forEach((effect) => effect());
      return tree;
    },
    unmount() { effects.forEach((effect) => effect.cleanup?.()); },
  };
}
function elements(tree: React.ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children as React.ReactNode)];
}
const buttons = (tree: Element) => elements(tree).filter((e) => e.type === "button");
const click = (button: Element) => (button.props.onClick as () => Promise<void>)();
const sample = { v: 1, strokes: [{ tool: "pen", color: 0xff000000, width: 0.02, points: [[0.5, 0.5, 1]] }] };
const props = { annotationId: "latest", src: "fixture-photo", alt: "표본" };
function photo(load: () => Promise<unknown>) {
  return component("CalendarInkPhoto", {
    "../../lib/calendar-ink": { loadCalendarInk: load },
    "./InkOverlay": { InkOverlay: "fixture-overlay" },
    "./session-token": { getSessionToken: () => "fixture-token" },
    "./CalendarInkPhoto.module.css": { photo: "photo", rotator: "rotator", flipped: "flipped", front: "front", back: "back", image: "image" },
  });
}

test("실제 사진 이벤트: 최초 원본 → 로딩 → 표시본 → 원본 → 표시본, 파일 로드는 1회", async () => {
  let requests = 0;
  let resolve!: (data: unknown) => void;
  const h = photo(() => { requests++; return new Promise((done) => { resolve = done; }); });
  let tree = h.render(props);
  assert.equal(requests, 0);
  assert.equal(buttons(tree)[0]!.props["aria-pressed"], false);
  const loading = click(buttons(tree)[0]!);
  tree = h.render(props);
  assert.ok(buttons(tree).every((b) => b.props.disabled === true));
  assert.equal(buttons(tree)[0]!.props["aria-busy"], true);
  await click(buttons(tree)[1]!);
  assert.equal(requests, 1);
  resolve(sample);
  await loading;
  tree = h.render(props);
  assert.equal(buttons(tree)[0]!.props["aria-pressed"], true);
  assert.ok(elements(tree).some((e) => e.props.className === "rotator flipped"));
  assert.equal(elements(tree).find((e) => e.type === "fixture-overlay")!.props.data, sample);
  await click(buttons(tree)[1]!);
  tree = h.render(props);
  assert.equal(buttons(tree)[0]!.props["aria-pressed"], false);
  await click(buttons(tree)[0]!);
  tree = h.render(props);
  assert.equal(buttons(tree)[0]!.props["aria-pressed"], true);
  assert.equal(requests, 1);
  const images = elements(tree).filter((e) => e.type === "img");
  assert.deepEqual(images.map((e) => e.props.src), ["fixture-photo", "fixture-photo"]);
  h.unmount();
});

test("조회 실패 시 원본을 유지하며 다시 누르면 재시도한다", async () => {
  let requests = 0;
  const h = photo(async () => { if (++requests === 1) throw new Error("offline"); return sample; });
  await click(buttons(h.render(props))[0]!);
  let tree = h.render(props);
  assert.equal(buttons(tree)[0]!.props["aria-pressed"], false);
  assert.ok(elements(tree).some((e) => e.props.role === "alert"));
  await click(buttons(tree)[0]!);
  tree = h.render(props);
  assert.equal(buttons(tree)[0]!.props["aria-pressed"], true);
  assert.equal(elements(tree).filter((e) => e.props.role === "alert").length, 0);
  assert.equal(requests, 2);
});

test("사진을 닫은 뒤 도착한 응답은 폐기하고 재열기는 앞면부터 시작한다", async () => {
  let resolve!: (data: unknown) => void;
  const h = photo(() => new Promise((done) => { resolve = done; }));
  const pending = click(buttons(h.render(props))[0]!);
  h.unmount();
  resolve(sample);
  await pending;
  assert.equal(buttons(h.render(props))[0]!.props["aria-pressed"], false);
  const reopened = photo(async () => sample);
  assert.equal(buttons(reopened.render(props))[0]!.props["aria-pressed"], false);
});

test("실제 overlay effect: contain 여백·DPR·리사이즈·이미지 load와 observer 정리를 적용한다", () => {
  const arcs: number[][] = [];
  const transforms: number[][] = [];
  const events = new Map<string, () => void>();
  let resize!: (entries: { contentRect: { width: number; height: number } }[]) => void;
  let disconnected = 0;
  let observed: unknown;
  const image = {
    naturalWidth: 800, naturalHeight: 1600,
    addEventListener: (type: string, handler: () => void) => events.set(type, handler),
    removeEventListener: (type: string) => events.delete(type),
  };
  const context = {
    setTransform: (...args: number[]) => transforms.push(args),
    beginPath() {}, arc: (...args: number[]) => arcs.push(args), fill() {},
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const h = component("InkOverlay", { "../../lib/ink-render": inkRender }, {
    window: {
      devicePixelRatio: 2,
      getComputedStyle: () => ({ width: "800px", height: "600px" }),
      addEventListener: (type: string, handler: () => void) => events.set(type, handler),
      removeEventListener: (type: string) => events.delete(type),
    },
    ResizeObserver: class {
      constructor(handler: typeof resize) { resize = handler; }
      observe(value: unknown) { observed = value; }
      disconnect() { disconnected++; }
    },
  });
  h.render({ data: sample, imageRef: { current: image }, src: "fixture" }, (tree) => {
    (elements(tree).find((e) => e.type === "canvas")!.props.ref as { current: unknown }).current = canvas;
  });
  assert.equal(observed, image);
  assert.deepEqual([canvas.width, canvas.height], [1600, 1200]);
  assert.deepEqual(transforms[0], [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(arcs[0]!.slice(0, 2), [400, 300]);
  assert.ok(Math.abs(arcs[0]![2]! - 4.05) < 1e-10); // 실제 사진 너비 300, 박스 너비 800 아님.
  resize([{ contentRect: { width: 400, height: 300 } }]);
  assert.deepEqual([canvas.width, canvas.height], [800, 600]);
  assert.deepEqual(arcs.at(-1)!.slice(0, 2), [200, 150]);
  image.naturalWidth = 0;
  events.get("error")!();
  assert.equal(canvas.width, 0);
  image.naturalWidth = 1600;
  image.naturalHeight = 800;
  events.get("load")!();
  assert.deepEqual(arcs.at(-1)!.slice(0, 2), [400, 300]);
  h.unmount();
  assert.equal(disconnected, 1);
  assert.equal(events.size, 0);
});

test("v2 overlay는 획 대신 버전 안내를 렌더한다", () => {
  const h = component("InkOverlay", { "../../lib/ink-render": inkRender });
  const tree = h.render({ data: { ...sample, v: 2 }, imageRef: { current: null }, src: "fixture" });
  const status = elements(tree).find((e) => e.props.role === "status");
  assert.match(String(status?.props.children), /다른 앱 버전/);
});

test("회전 CSS는 양면을 분리하고 reduced-motion에서는 transform과 transition을 모두 없앤다", () => {
  const css = readFileSync(join(import.meta.dirname, "../app/components/CalendarInkPhoto.module.css"), "utf8");
  assert.match(css, /transform-style: preserve-3d/);
  assert.match(css, /backface-visibility: hidden/);
  assert.match(css, /\.flipped\s*\{\s*transform: rotateY\(180deg\)/);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.rotator,\s*\.back\s*\{\s*transform: none;\s*transition: none;/);
  assert.match(reduced, /\.back,\s*\.flipped \.front\s*\{\s*visibility: hidden;/);
  assert.match(reduced, /\.flipped \.back\s*\{\s*visibility: visible;/);
});
