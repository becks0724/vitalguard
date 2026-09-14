import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";

const source = readFileSync(join(import.meta.dirname, "../app/components/DemoDashboard.tsx"), "utf8");
const ast = ts.createSourceFile("dashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let render = "";
let mapping = "";
let refresh = "";
function visit(node: ts.Node) {
  if (ts.isConditionalExpression(node) && node.condition.getText(ast) === 'lightbox.mediaType === "video"' &&
      ts.isParenthesizedExpression(node.whenTrue) && ts.isJsxSelfClosingElement(node.whenTrue.expression)) {
    render = node.getText(ast);
  }
  if (ts.isObjectLiteralExpression(node) && node.properties.some((p) =>
    ts.isPropertyAssignment(p) && p.name.getText(ast) === "annotationId" && p.initializer.getText(ast).includes("r.annotationId"),
  )) mapping = node.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "setLightbox" &&
      node.arguments[0] && ts.isArrowFunction(node.arguments[0])) {
    refresh = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
function evaluate(expression: string, inputs: Record<string, unknown>) {
  assert.ok(expression, "실제 렌더/매핑을 찾지 못했다");
  const code = ts.transpileModule(`result = (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const context = { React, result: null, ...inputs };
  runInNewContext(code, context);
  return context.result;
}
function photo(props: Record<string, unknown>) {
  return evaluate(render, {
    lightbox: { id: "photo", title: "표본", mediaUrl: "/fixture.jpg", mediaType: "image", ...props },
    CalendarInkPhoto: "fixture-ink-photo",
  }) as unknown as React.ReactElement<Record<string, unknown>>;
}

test("목록 매핑은 최신 annotationId를 싣고 구 응답/잉크 없음은 null로 유지한다", () => {
  for (const annotationId of [undefined, null, "ink-latest"]) {
    const mapped = evaluate(mapping, { r: { annotationId }, dateKey: "2026-09-13" }) as unknown as { annotationId: unknown };
    assert.equal(mapped.annotationId, annotationId ?? null);
  }
});

test("잉크 없는 사진은 기존 img의 URL·alt·contain 클래스 그대로이며 버튼이 없다", () => {
  for (const annotationId of [undefined, null, ""]) {
    const rendered = photo({ annotationId });
    assert.equal(rendered.type, "img");
    assert.deepEqual(Object.keys(rendered.props).sort(), ["alt", "className", "src"]);
    assert.equal(rendered.props.src, "/fixture.jpg");
    assert.equal(rendered.props.alt, "표본");
    assert.equal(rendered.props.className, "max-h-[80vh] w-full rounded-lg object-contain");
  }
});

test("잉크 있는 사진만 최신 id와 원본 URL로 뒤집기를 열고 id 변경 시 상태를 리셋한다", () => {
  for (const annotationId of ["ink-1", "ink-2"]) {
    const rendered = photo({ annotationId });
    assert.equal(rendered.type, "fixture-ink-photo");
    assert.equal(rendered.props.src, "/fixture.jpg");
    assert.equal(rendered.props.annotationId, annotationId);
    assert.equal(rendered.key, `photo:${annotationId}`);
  }
});

test("영상은 잉크 id 유무에 관계없이 기존 미디어 컨트롤을 유지한다", () => {
  for (const annotationId of [null, "unexpected-ink"]) {
    const rendered = photo({ mediaType: "video", annotationId });
    assert.equal(rendered.type, "video");
    assert.equal(rendered.props.controls, true);
    assert.equal(rendered.props.src, "/fixture.jpg");
  }
});

test("폴링 중 최신 잉크가 바뀌면 열린 사진에 반영하고, 변화 없는 사진은 같은 객체를 유지한다", () => {
  const current = { id: "photo", dateKey: "2026-09-13", annotationId: null };
  const apply = (rows: unknown[]) => evaluate(refresh, { map: { [current.dateKey]: rows } }) as unknown as
    (media: typeof current | null) => { annotationId: string | null } | null;
  assert.equal(apply([])(null), null);
  assert.equal(apply([])(current), current);
  assert.equal(apply([current])(current), current);
  assert.equal(apply([{ ...current, annotationId: "latest" }])(current)?.annotationId, "latest");
});
