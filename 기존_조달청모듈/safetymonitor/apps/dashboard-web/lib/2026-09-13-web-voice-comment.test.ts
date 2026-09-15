// 라이브 음성 없이 실제 댓글 JSX·매핑·플레이어 이벤트를 표본으로 실행한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

type Element = React.ReactElement<Record<string, unknown>>;
type VoiceProps = { src: string | null; audioMs: number | null };
const root = join(import.meta.dirname, "..");
const dashboard = readFileSync(join(root, "app/components/DemoDashboard.tsx"), "utf8");
const voice = readFileSync(join(root, "app/components/CalendarVoiceComment.tsx"), "utf8");
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText;
const runtime = (id: string) => {
  assert.equal(id, "react/jsx-runtime");
  return jsxRuntime;
};
const voiceCode = compile(voice);
function loadVoice(hooks: unknown) {
  const exported = {} as { CalendarVoiceComment: (props: VoiceProps) => Element };
  runInNewContext(voiceCode, {
    exports: exported,
    require: (id: string) => id === "react" ? hooks : runtime(id),
  });
  return exported.CalendarVoiceComment;
}
const CalendarVoiceComment = loadVoice(React);
const sourceFile = ts.createSourceFile("dashboard.tsx", dashboard, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let mapping = "";
let thread = "";
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === "comments" &&
      node.initializer.getText(sourceFile).startsWith("(r.comments ?? []).map(")) {
    mapping = node.initializer.getText(sourceFile);
  }
  if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === "m.comments.map") {
    thread = node.getText(sourceFile);
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);
assert.ok(mapping && thread, "실제 서버 댓글 매핑과 댓글 목록 렌더가 있어야 한다");
const mapCode = compile(`result = ${mapping};`);
const threadCode = compile(`result = ${thread};`);
const rawComment = (overrides: Record<string, unknown> = {}) => ({
  id: "text-1", author_name: "표본 담당관", author_id: "author-1", author_role: "admin",
  author_title: "팀장", body: "첫 줄\n둘째 줄 <사진 확인>",
  created_at: "2026-09-13T01:02:00Z", updated_at: null, ...overrides,
});
const voiceComment = (overrides: Record<string, unknown> = {}) => rawComment({
  id: "voice-1", body: "", audio_storage_key: "calendar-media/fixture.m4a",
  audio_url: "https://storage.test/fixture.m4a?signed=old", audio_ms: 7000, ...overrides,
});
function fixture(comments: Record<string, unknown>[], editingComment: { id: string; body: string } | null = null) {
  const mapped = { r: { comments }, result: [] as Record<string, unknown>[] };
  runInNewContext(mapCode, mapped);
  const edits: unknown[] = [];
  const deletes: string[] = [];
  const context = {
    exports: {}, require: runtime, CalendarVoiceComment, m: { comments: mapped.result }, editingComment,
    workerAliases: { "author-1": "EMP-001" }, formatCommentTime: (value: string) => value,
    setEditingComment: (value: unknown) => edits.push(value),
    removeComment: (id: string) => deletes.push(id), saveCommentEdit: () => {},
    result: [] as Element[],
  };
  runInNewContext(threadCode, context);
  return { comments: mapped.result, rows: context.result, edits, deletes };
}
function elements(tree: React.ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children as React.ReactNode)];
}
const html = (tree: React.ReactNode) => renderToStaticMarkup(React.createElement(React.Fragment, null, tree));
const audioElement = (tree: React.ReactNode) => {
  const audio = elements(tree).find((element) => element.type === "audio");
  assert.ok(audio, "네이티브 오디오가 렌더되어야 한다");
  return audio;
};
const button = (tree: React.ReactNode, label: string) => elements(tree).find(
  (element) => element.type === "button" && element.props["aria-label"] === label,
);

test("서버의 글·음성·글 순서와 오디오 필드·작성자·시각을 그대로 보존한다", () => {
  const f = fixture([rawComment(), voiceComment(), rawComment({ id: "text-2", body: "다음 글" })]);
  assert.deepEqual(Array.from(f.rows, (row) => row.key), ["text-1", "voice-1", "text-2"]);
  assert.equal(f.comments[1]!.audioStorageKey, "calendar-media/fixture.m4a");
  assert.equal(f.comments[1]!.audioUrl, "https://storage.test/fixture.m4a?signed=old");
  assert.equal(f.comments[1]!.audioMs, 7000);
  assert.equal(f.comments[0]!.audioMs, null);
  for (const row of f.rows) {
    const markup = html(row);
    assert.match(markup, /표본 담당관.*팀장.*사번 EMP-001.*2026-09-13T01:02:00Z/);
    assert.ok(button(row, "댓글 삭제"));
  }
  assert.equal((html(f.rows).match(/<audio\b/g) ?? []).length, 1);
});

test("판정은 storage key만 따른다 — URL·빈 body만으로 글을 음성으로 바꾸지 않는다", () => {
  for (const audio_storage_key of [undefined, null, ""]) {
    for (const body of ["글 본문", ""]) {
      const row = fixture([rawComment({ audio_storage_key, audio_url: "https://storage.test/stray", body })]).rows[0]!;
      assert.doesNotMatch(html(row), /<audio\b/);
      assert.ok(button(row, "댓글 수정"));
    }
  }
  const unavailable = fixture([voiceComment({ audio_url: null })]).rows[0]!;
  assert.match(html(unavailable), /<audio\b/);
  assert.match(html(unavailable), /다시 불러오세요/);
  assert.equal(button(unavailable, "댓글 수정"), undefined);
});

for (const [audioMs, duration] of [
  [7000, "0:07"], [7999, "0:07"], [61000, "1:01"], [3600000, "60:00"], [0, "0:00"],
  [null, null], [-1, null], [NaN, null], [Infinity, null],
] as const) {
  test(`길이 표기: ${audioMs} → ${duration ?? "생략"}`, () => {
    const markup = html(fixture([voiceComment({ audio_ms: audioMs })]).rows);
    if (duration === null) {
      assert.doesNotMatch(markup, /aria-label="음성 길이 /);
    } else {
      assert.ok(markup.includes(`aria-label="음성 길이 ${duration}"`));
      assert.ok(markup.includes(`>${duration}</span>`));
    }
  });
}

test("글 본문·줄바꿈·스타일·수정 진입을 보존하고 음성에는 수정 버튼이 없다", () => {
  const f = fixture([rawComment(), voiceComment()]);
  const paragraph = elements(f.rows[0]).find((element) => element.props.children === rawComment().body)!;
  assert.equal(paragraph.type, "p");
  assert.equal(paragraph.props.className, "mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-muted dark:text-on-dark-soft");
  assert.match(html(paragraph), /첫 줄\n둘째 줄 &lt;사진 확인&gt;/);
  (button(f.rows[0], "댓글 수정")!.props.onClick as () => void)();
  assert.equal(JSON.stringify(f.edits), JSON.stringify([{ id: "text-1", body: rawComment().body }]));
  assert.equal(button(f.rows[1], "댓글 수정"), undefined);
  for (const row of f.rows) (button(row, "댓글 삭제")!.props.onClick as () => void)();
  assert.deepEqual(f.deletes, ["text-1", "voice-1"]);
});

test("글 수정 입력·동일/빈 본문 저장 잠금·취소는 기존 동작을 유지한다", () => {
  for (const [body, disabled] of [[rawComment().body, true], ["   ", true], ["수정한 글", false]] as const) {
    const f = fixture([rawComment()], { id: "text-1", body });
    const textarea = elements(f.rows).find((element) => element.type === "textarea")!;
    assert.equal(textarea.props.value, body);
    const save = elements(f.rows).find((element) => element.type === "button" && element.props.children === "수정")!;
    assert.equal(save.props.disabled, disabled);
    (textarea.props.onChange as (event: unknown) => void)({ target: { value: "새 입력" } });
    const cancel = elements(f.rows).find((element) => element.type === "button" && element.props.children === "취소")!;
    (cancel.props.onClick as () => void)();
    assert.equal(JSON.stringify(f.edits), JSON.stringify([{ id: "text-1", body: "새 입력" }, null]));
    assert.doesNotMatch(html(f.rows), /<audio\b/);
  }
});

// 설치된 React JSX 런타임에 실제 이벤트/effect를 연결한다. 여러 인스턴스는 같은 모듈을 공유한다.
type Effect = { deps: unknown[]; cleanup?: () => void };
function playerHarness() {
  type Instance = {
    slots: unknown[]; effects: Map<number, Effect>; pending: (() => void)[]; cursor: number;
    props: VoiceProps; tree?: Element; audio: {
      paused: boolean; pauses: number; plays: number; currentTime: number; duration: number;
      pause: () => void; play: () => Promise<void>;
    };
  };
  let current: Instance;
  const hooks = {
    useState(initial: unknown) {
      const owner = current;
      const index = owner.cursor++;
      if (!(index in owner.slots)) owner.slots[index] = initial;
      return [owner.slots[index], (next: unknown) => {
        owner.slots[index] = typeof next === "function" ? next(owner.slots[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = current.cursor++;
      if (!(index in current.slots)) current.slots[index] = { current: initial };
      return current.slots[index];
    },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const owner = current;
      const index = owner.cursor++;
      const previous = owner.effects.get(index);
      if (previous && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      owner.pending.push(() => {
        previous?.cleanup?.();
        owner.effects.set(index, { deps, cleanup: effect() || undefined });
      });
    },
  };
  const Component = loadVoice(hooks);
  function render(instance: Instance, props = instance.props) {
    current = instance;
    instance.props = props;
    instance.cursor = 0;
    instance.pending = [];
    instance.tree = Component(props);
    (audioElement(instance.tree).props.ref as { current: unknown }).current = instance.audio;
    instance.pending.forEach((effect) => effect());
    return instance.tree;
  }
  function create(src: string | null) {
    const instance: Instance = {
      slots: [], effects: new Map(), pending: [], cursor: 0, props: { src, audioMs: 7000 },
      audio: {
        paused: true, pauses: 0, plays: 0, currentTime: 0, duration: 20,
        pause() { this.paused = true; this.pauses++; },
        play() { this.paused = false; this.plays++; return Promise.resolve(); },
      },
    };
    render(instance);
    return instance;
  }
  function event(instance: Instance, name: string) {
    (audioElement(instance.tree).props[name] as (event: unknown) => void)({ currentTarget: instance.audio });
    render(instance);
  }
  return {
    create, render, event,
    play(instance: Instance) { instance.audio.paused = false; event(instance, "onPlay"); },
    unmount(instance: Instance) { instance.effects.forEach((effect) => effect.cleanup?.()); },
  };
}

test("재생 제어는 진짜 button이고 상태에 따라 aria-label과 아이콘을 바꾼다", () => {
  const h = playerHarness();
  const a = h.create("fixture-a");
  const playButton = button(a.tree, "음성 재생");
  assert.ok(playButton);
  assert.equal(playButton.type, "button");
  assert.equal(playButton.props.type, "button");
  (playButton.props.onClick as () => void)();
  assert.equal(a.audio.plays, 1);
  h.event(a, "onPlay");
  const pauseButton = button(a.tree, "일시정지");
  assert.ok(pauseButton);
  (pauseButton.props.onClick as () => void)();
  h.event(a, "onPause");
  assert.ok(button(a.tree, "음성 재생"));
  h.unmount(a);
});

test("파형의 투명 range를 클릭하면 currentTime과 진행 오버레이가 바뀐다", () => {
  const h = playerHarness();
  const a = h.create("fixture-a");
  const sliders = elements(a.tree).filter((element) => element.type === "input" && element.props.type === "range");
  assert.equal(sliders.length, 1);
  assert.equal(sliders[0]!.props["aria-label"], "음성 재생 위치");
  (sliders[0]!.props.onChange as (event: unknown) => void)({ currentTarget: { value: "25" } });
  assert.equal(a.audio.currentTime, 5);
  h.render(a);
  const slider = elements(a.tree).find((element) => element.type === "input" && element.props.type === "range")!;
  assert.equal(slider.props.value, 25);
  const waveformBars = elements(a.tree).filter((element) =>
    element.type === "span" && String(element.props.className).includes("w-[2px]"),
  );
  assert.equal(waveformBars.length, 30);
  const progressOverlay = elements(a.tree).find((element) =>
    element.type === "div" && String(element.props.className).includes("pointer-events-none"),
  )!;
  assert.equal((progressOverlay.props.style as { width: string }).width, "25%");
  h.unmount(a);
});

test("timeupdate로 진행률이 바뀌어 리렌더되어도 파형 막대 30개의 높이는 같다", (t) => {
  const h = playerHarness();
  const a = h.create("fixture-a");
  t.after(() => h.unmount(a));
  h.play(a);
  const heights = () => elements(a.tree)
    .filter((element) => element.type === "span" && String(element.props.className).includes("w-[2px]"))
    .map((element) => (element.props.style as { height: number }).height);
  const initialHeights = heights();
  assert.equal(initialHeights.length, 30);
  assert.ok(initialHeights.every((height) => Number.isFinite(height) && height > 0));

  for (const currentTime of [5, 10, 15]) {
    a.audio.currentTime = currentTime;
    h.event(a, "onTimeUpdate");
    const progress = currentTime / a.audio.duration * 100;
    const slider = elements(a.tree).find((element) =>
      element.type === "input" && element.props["aria-label"] === "음성 재생 위치",
    )!;
    const overlay = elements(a.tree).find((element) =>
      element.type === "div" && String(element.props.className).includes("pointer-events-none"),
    )!;
    assert.equal(slider.props.value, progress, "timeupdate가 실제로 진행률을 갱신해야 한다");
    assert.equal((overlay.props.style as { width: string }).width, `${progress}%`);
    assert.deepEqual(heights(), initialHeights, `${progress}% 진행 후에도 30개 막대 높이가 같아야 한다`);
  }
});

test("audioMs가 없으면 한 줄 버블에서 길이 표기만 빠진다", () => {
  const markup = html(fixture([voiceComment({ audio_ms: null })]).rows);
  assert.doesNotMatch(markup, /aria-label="음성 길이 /);
  assert.match(markup, /<button[^>]+aria-label="음성 재생"/);
  assert.match(markup, /<input type="range"/);
});

test("A→B→C 재생: 다른 댓글을 멈추고 늦은 pause·ended 이벤트에도 하나만 재생한다", () => {
  const h = playerHarness();
  const a = h.create("fixture-a");
  const b = h.create("fixture-b");
  const c = h.create("fixture-c");
  h.play(a);
  h.play(a);
  assert.equal(a.audio.pauses, 0, "같은 플레이어의 중복 이벤트는 스스로 멈추지 않는다");
  h.play(b);
  assert.equal(a.audio.paused, true);
  h.event(a, "onPause");
  h.event(a, "onEnded");
  h.event(a, "onError");
  h.event(a, "onPlay"); // 이미 멈춘 오디오의 지연 이벤트.
  h.play(c);
  assert.equal(b.audio.paused, true);
  assert.equal(c.audio.paused, false);
  assert.equal([a, b, c].filter((instance) => !instance.audio.paused).length, 1);
  h.unmount(a);
  h.play(b);
  assert.equal(c.audio.paused, true, "다른 댓글의 unmount가 재생 중인 참조를 지우면 안 된다");
  h.unmount(b);
  assert.equal(b.audio.paused, true, "삭제/날짜 이동/캘린더 닫기 시 음성도 멈춘다");
  h.unmount(c);
});

test("빠른 재개 뒤 도착한 옛 pause/ended 이벤트도 동시 재생 방지를 유지한다", () => {
  const h = playerHarness();
  const a = h.create("fixture-a");
  const b = h.create("fixture-b");
  h.play(a);
  a.audio.pause();
  h.play(a);
  h.event(a, "onPause");
  h.event(a, "onEnded");
  h.play(b);
  assert.equal(a.audio.paused, true);
  assert.equal(b.audio.paused, false);
  h.unmount(a);
  h.unmount(b);
});

test("만료·네트워크/형식 오류는 안내하고 반복 오류로 조회·자동 재생을 하지 않는다", () => {
  const h = playerHarness();
  const a = h.create("expired-url");
  assert.equal(audioElement(a.tree).props.controls, undefined);
  assert.equal(audioElement(a.tree).props.preload, "none");
  assert.equal(audioElement(a.tree).props.autoPlay, undefined);
  h.play(a); // 로드 실패가 paused=false 상태에서 발생해도 갱신할 수 있어야 한다.
  for (let attempt = 0; attempt < 3; attempt++) h.event(a, "onError");
  assert.match(html(a.tree), /role="alert".*다시 불러오세요/);
  assert.equal(audioElement(a.tree).props.src, "expired-url");
  assert.equal(a.audio.paused, true);
  h.render(a, { ...a.props, src: "renewed-url" });
  h.render(a);
  assert.equal(audioElement(a.tree).props.src, "renewed-url");
  assert.doesNotMatch(html(a.tree), /role="alert"/);
  assert.equal(a.audio.paused, true);
  h.event(a, "onError");
  h.event(a, "onPlaying");
  assert.doesNotMatch(html(a.tree), /role="alert"/);
  h.unmount(a);
});

test("URL 누락도 안내하고 기존 새로고침이 주소를 채우면 재생기를 복구한다", () => {
  const h = playerHarness();
  const a = h.create(null);
  assert.match(html(a.tree), /다시 불러오세요/);
  assert.equal(audioElement(a.tree).props.src, undefined);
  h.render(a, { ...a.props, src: "available-url" });
  h.render(a);
  assert.equal(audioElement(a.tree).props.src, "available-url");
  assert.doesNotMatch(html(a.tree), /role="alert"/);
  h.unmount(a);
});

for (const stopEvent of ["onPause", "onEnded"]) {
  test(`폴링 URL 갱신은 재생을 유지하고 ${stopEvent} 후 최신 주소를 적용한다`, () => {
    const h = playerHarness();
    const a = h.create("old-url");
    h.play(a);
    h.render(a, { ...a.props, src: "new-url" });
    assert.equal(audioElement(a.tree).props.src, "old-url");
    assert.equal(a.audio.pauses, 0);
    a.audio.paused = true;
    h.event(a, stopEvent);
    assert.equal(audioElement(a.tree).props.src, "new-url");
    h.unmount(a);
  });
}
