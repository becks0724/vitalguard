// 기존 관제 화면 테스트처럼 실제 TSX를 실행하고 렌더된 HTML·클릭 전달값을 검증한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as heatWorkRest from "./heat-work-rest";
import * as weatherCodeLabel from "./weather-code-label";
import * as weatherRules from "./weather-rules";

type Element = React.ReactElement<Record<string, unknown>>;
type Layout = "strip" | "list";
const source = readFileSync(join(import.meta.dirname, "../app/components/WeatherStrip.tsx"), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText;

function elements(tree: React.ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  if (typeof tree.type === "function") {
    return [tree, ...elements((tree.type as (props: unknown) => React.ReactNode)(tree.props))];
  }
  return [tree, ...elements(tree.props.children as React.ReactNode)];
}

function fixture(windKmh: number, windGustKmh: number | undefined, layout: Layout) {
  const current = Object.freeze({
    weatherCode: 0, temperatureC: 24.3, apparentTempC: 25.6, humidityPct: 61,
    wbgt: 23.4, pm25: 12.4, precipitationMm: 0.6, uvIndex: 3.2,
    windKmh, windGustKmh,
  });
  const data = Object.freeze({ ok: true, current });
  const slots: unknown[] = [data];
  let cursor = 0;
  const calls: { args: [number, number | undefined]; result: weatherRules.RuleEvaluation }[] = [];
  const WeatherRuleModal = () => null;
  const modules: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value: unknown) => { slots[index] = value; }];
      },
      // 수신 완료 상태를 주입한다. 네트워크·타이머 effect는 이 표시 회귀 테스트의 범위 밖이다.
      useEffect: () => {},
      useMemo: (calculate: () => unknown) => calculate(),
      useCallback: (callback: unknown) => callback,
      useRef: (initial: unknown) => ({ current: initial }),
    },
    "react/jsx-runtime": jsxRuntime,
    "../hooks/useMarqueeScroll": { useMarqueeScroll: () => ({ current: null }) },
    "../../lib/weather-code-label": weatherCodeLabel,
    "../../lib/heat-work-rest": heatWorkRest,
    "../../lib/weather-rules": {
      ...weatherRules,
      evaluateWindKmh(kmh: number, gustKmh?: number) {
        const result = weatherRules.evaluateWindKmh(kmh, gustKmh);
        calls.push({ args: [kmh, gustKmh], result });
        return result;
      },
    },
    "./session-token": { getSessionToken: () => null },
    "./IndoorEnvRows": { IndoorEnvRows: () => null },
    "./WeatherAlertToast": { WeatherAlertToast: () => null },
    "./WeatherIcons": { WeatherIcon: () => null, weatherIconKey: () => "sun" },
    "./WeatherRuleModal": { WeatherRuleModal },
  };
  const exported = {} as { WeatherStrip: (props: Record<string, unknown>) => Element };
  runInNewContext(code, {
    exports: exported,
    require(id: string) {
      assert.ok(id in modules, `예상 밖 의존성: ${id}`);
      return modules[id];
    },
  });
  const render = () => {
    cursor = 0;
    return exported.WeatherStrip({ lat: 37, lon: 127, workerCount: 1, layout });
  };
  const tree = render();
  const windButtons = elements(tree).filter(
    (element) => element.type === "button" && element.props.title === "풍속 정책 근거 보기",
  );
  assert.equal(windButtons.length, layout === "strip" ? 2 : 1);
  return { windButtons, calls, render, WeatherRuleModal };
}

for (const layout of ["strip", "list"] as const) {
  for (const [label, gust, value, sub] of [
    ["순간풍속 있음", 32.76, "9.1 m/s", "순간 (평균 1.8 m/s)"],
    ["순간풍속 없음", undefined, "1.8 m/s", "평균 대체 (순간풍속 없음)"],
    ["순간풍속 0도 유효값", 0, "0.0 m/s", "순간 (평균 1.8 m/s)"],
  ] as const) {
    test(`${layout}: ${label} — 헤드라인 m/s·순간/평균 대체 구분`, () => {
      const f = fixture(6.5, gust, layout);
      for (const button of f.windButtons) {
        const markup = renderToStaticMarkup(button);
        assert.ok(markup.includes(`>${value}</span>`), `헤드라인: ${value}\n${markup}`);
        assert.ok(markup.includes(`>${sub}</span>`), `부제: ${sub}\n${markup}`);
        assert.doesNotMatch(markup, /km\/h/);
        if (gust !== undefined) assert.doesNotMatch(markup, /대체|순간풍속 없음/);
      }
    });
  }

  for (const [mean, gust, severity, threshold] of [
    [6.5, 35.99, "normal", undefined],
    [6.5, 36, "caution", "10m/s"],
    [6.5, 53.99, "caution", "10m/s"],
    [6.5, 54, "danger", "15m/s"],
    [6.5, 108, "danger", "30m/s"],
    [35.99, undefined, "normal", undefined],
    [36, undefined, "caution", "10m/s"],
    [54, undefined, "danger", "15m/s"],
    [40, 20, "caution", "10m/s"],
  ] as const) {
    test(`${layout}: 평균 ${mean}·순간 ${gust ?? "없음"} km/h — 기존 판정·색상·모달 전달 유지`, () => {
      const f = fixture(mean, gust, layout);
      assert.equal(f.calls.length, 1);
      const call = f.calls[0]!;
      assert.deepEqual(call.args, [mean, gust], "표시용 m/s를 판정 입력에 전달하면 안 된다");
      assert.deepEqual(call.result, weatherRules.evaluateWindKmh(mean, gust));
      assert.equal(call.result.currentSeverity, severity);
      if (threshold) {
        assert.ok(call.result.currentStep?.label.includes(threshold));
        assert.equal(call.result.currentStep?.binding, "legal");
      } else {
        assert.equal(call.result.currentStep, undefined);
      }
      if (gust === undefined) assert.match(call.result.baseline, /평균풍속으로 판정\(과소경보 가능\)/);
      const color = { normal: "text-ink", caution: "text-amber-600", danger: "text-red-600" }[severity];
      for (const button of f.windButtons) {
        const headline = elements(button).find((element) =>
          element.type === "span" && String(element.props.className).includes("tabular-nums"));
        assert.ok(String(headline?.props.className).includes(color));
        (button.props.onClick as () => void)();
        const modal = elements(f.render()).find((element) => element.type === f.WeatherRuleModal);
        assert.equal(modal?.props.evaluation, call.result, "판정 객체를 그대로 정책 근거 모달에 전달한다");
      }
    });
  }
}
