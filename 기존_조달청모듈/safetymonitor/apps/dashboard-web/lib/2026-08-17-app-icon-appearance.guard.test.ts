// 앱 아이콘 가드 — 라이트/다크 변형과 App Store 제출 요건을 고정한다.
//
// 왜 필요한가. 아이콘은 **깨져도 테스트가 안 도는 자산**이라 사람 눈에만 걸린다. 그런데 틀리면
// 값이 비싸다.
//  ① 알파 채널이 있으면 **App Store Connect 업로드가 거부**된다(ITMS-90717). 로고 원본은
//     전부 투명 PNG 라 배경에 합성하지 않고 그대로 넣기 쉬운 자리다.
//  ② 1024x1024 가 아니면 심사 전에 걸린다.
//  ③ 다크 변형이 빠지면 오류 없이 **라이트 아이콘이 어두운 홈 화면에 그대로** 쓰인다 —
//     망가진 게 아니라 그냥 촌스러워지는 형태라 아무도 신고하지 않는다.
//  ④ 레거시 다중 사이즈(Icon-App-*.png)와 단일 1024 형식은 **섞이지 않는다**. 되살아나면
//     appearances 가 무시돼 ③ 과 같은 결과가 된다.
//
// ⚠ 워치는 라이트/다크 변형을 지원하지 않는다(watchOS 는 아이콘 하나뿐). 그래서 워치에는
//   다크 아트워크만 넣었고, 이 가드도 워치에는 변형을 요구하지 않는다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IOS = join(ROOT, "..", "vitalguard_app", "ios");
const PHONE_SET = join(IOS, "Runner", "Assets.xcassets", "AppIcon.appiconset");
const WATCH_SET = join(IOS, "VitalWatch", "Assets.xcassets", "AppIcon.appiconset");

type IconEntry = {
  filename?: string;
  idiom?: string;
  platform?: string;
  size?: string;
  appearances?: { appearance: string; value: string }[];
};

function manifest(dir: string): IconEntry[] {
  const j = JSON.parse(readFileSync(join(dir, "Contents.json"), "utf8")) as { images?: IconEntry[] };
  assert.ok(Array.isArray(j.images), `${dir} 의 images 배열이 없다`);
  return j.images;
}

/**
 * PNG IHDR 를 직접 읽어 크기와 알파 유무를 판정한다.
 * colorType 비트 2(값 4)가 알파, 3 은 팔레트라 tRNS 로 투명이 붙을 수 있다.
 */
function png(path: string) {
  const b = readFileSync(path);
  assert.equal(b.readUInt32BE(0), 0x89504e47, `${path} 가 PNG 가 아니다`);
  const colorType = b.readUInt8(25);
  return {
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
    hasAlpha: (colorType & 4) !== 0 || (colorType === 3 && b.includes(Buffer.from("tRNS"))),
  };
}

test("① 폰 아이콘에 라이트·다크 두 변형이 있다", () => {
  const imgs = manifest(PHONE_SET).filter((i) => i.platform === "ios");
  const light = imgs.filter((i) => !i.appearances);
  const dark = imgs.filter((i) =>
    i.appearances?.some((a) => a.appearance === "luminosity" && a.value === "dark"),
  );
  assert.equal(light.length, 1, "기본(라이트) 항목이 정확히 하나가 아니다");
  assert.equal(dark.length, 1, "다크 변형이 없다 — 어두운 홈 화면에 라이트 아이콘이 그대로 쓰인다");
  for (const i of [...light, ...dark]) {
    assert.equal(i.size, "1024x1024", "단일 1024 형식이 아니다 — appearances 가 무시된다");
    assert.equal(i.idiom, "universal");
  }
});

test("② ★ 아이콘 PNG 는 1024 정사각·알파 없음(App Store 요건)", () => {
  for (const dir of [PHONE_SET, WATCH_SET]) {
    for (const e of manifest(dir)) {
      assert.ok(e.filename, `${dir} 항목에 filename 이 없다`);
      const p = join(dir, e.filename);
      assert.ok(existsSync(p), `${e.filename} 파일이 없다 — 매니페스트만 남았다`);
      const m = png(p);
      assert.equal(m.width, 1024, `${e.filename} 폭이 ${m.width}`);
      assert.equal(m.height, 1024, `${e.filename} 높이가 ${m.height}`);
      assert.equal(
        m.hasAlpha,
        false,
        `${e.filename} 에 알파가 있다 — 업로드가 ITMS-90717 로 거부된다(로고 원본이 투명이라 그대로 넣기 쉽다)`,
      );
    }
  }
});

test("③ 레거시 다중 사이즈 아이콘이 되살아나지 않았다", () => {
  const legacy = readdirSync(PHONE_SET).filter((f) => /^Icon-App-.*\.png$/.test(f));
  assert.deepEqual(
    legacy,
    [],
    "Icon-App-*.png 가 돌아왔다 — 단일 1024 형식과 섞이면 라이트/다크 변형이 무시된다",
  );
});

test("④ 워치 아이콘이 존재한다(watchOS 는 변형 없이 하나)", () => {
  const imgs = manifest(WATCH_SET);
  assert.equal(imgs.length, 1, "워치는 아이콘 하나여야 한다 — watchOS 는 라이트/다크 변형이 없다");
  const only = imgs[0];
  assert.ok(only, "워치 아이콘 항목이 없다");
  assert.equal(only.platform, "watchos", "platform 이 watchos 가 아니다");
  assert.equal(only.size, "1024x1024");
  // 카탈로그가 워치 타깃에 실제로 묶여 있어야 한다. 빠지면 빌드는 통과하고 아이콘만 사라진다
  // (이 트랙 이전 상태가 정확히 그것이었다 — 워치 앱에 자산 카탈로그 자체가 없었다).
  const pbx = readFileSync(join(IOS, "Runner.xcodeproj", "project.pbxproj"), "utf8");
  const watchTarget = pbx.slice(pbx.indexOf("/* VitalWatch */ = {\n\t\t\tisa = PBXNativeTarget;"));
  const resPhase = watchTarget.match(/(\w{24}) \/\* Resources \*\//)?.[1];
  assert.ok(resPhase, "워치 타깃의 Resources 페이즈를 못 찾았다");
  const phaseBody = pbx.slice(pbx.indexOf(`${resPhase} /* Resources */ = {`));
  assert.match(
    phaseBody.slice(0, 400),
    /Assets\.xcassets in Resources/,
    "워치 Resources 페이즈에 자산 카탈로그가 없다 — 빌드는 되고 아이콘만 안 들어간다",
  );
});
