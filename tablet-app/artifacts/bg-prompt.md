# 반투명 카드용 산업 배경 이미지 프롬프트

이 문서는 GPT 이미지 생성에 바로 넣을 배경 자산 프롬프트다. 앱 UI·카드·글자를 그리는 프롬프트가 아니다.
중앙의 반투명 카드가 안정적으로 읽히도록 **장면이 아닌 저대비 질감·분위기**를 만드는 것이 목적이다.

## 프롬프트 전문

### 어두운 안

```text
Create one square 1:1 master background image for a Korean industrial safety tablet application. This is a background asset only, not a photograph, not a scene, not a poster, not a dashboard, and not a UI mockup. Do not draw cards, panels, buttons, navigation, charts, labels, or interface chrome.

Visual concept: a quiet abstract industrial-engineering atmosphere made from very large-scale matte cast-concrete and brushed-steel mineral tones, with an extremely faint isometric engineering grid and a few soft topographic contour lines. The material texture must be broad, smooth, low-frequency, and nearly featureless rather than gritty or photographic. Suggest industrial construction through material and drafting language only; do not depict an actual construction site.

Composition and crop safety: create a square master composition designed to be center-cropped both to 2944 x 1840 px landscape and 1840 x 2944 px portrait while the app is running. Keep the central 70% of the image calm, evenly toned, unfocused, and free of recognizable forms because translucent content cards and text will occupy that area. Place any grid, contour, or structural suggestion only near the outer edges and corners, especially as a barely visible cluster near the upper-right edge and lower-left edge. Nothing important may depend on an edge surviving either crop. Do not draw crop guides or borders.

Dark palette: deep graphite, charcoal, muted slate blue, and desaturated steel blue. Use broad gradual tonal transitions with no pure black, no pure white, no bright accent colors, and no neighboring light-dark patches. Flat diffuse ambient illumination only. No highlights, reflections, glare, rim light, cast shadows, vignette, bloom, glow, neon, or dramatic lighting. The result should feel restrained, matte, technical, institutional, and dependable, never cinematic or decorative.

Readability and compression constraints: very low local contrast everywhere, especially behind the central card-safe area; no sharp focal point; no crisp central detail; no fine grain, speckle, dust, scratches, dense hatching, micro-texture, or visual noise. Favor large smooth color fields so the final app asset can compress efficiently toward 500 KB or less without obvious artifacts.

Hard exclusions: no people, no faces, no silhouettes of workers, no injuries, no accidents, no fire, no smoke, no sparks, no hazardous event, no vehicles, no cranes, no recognizable equipment, no branded machinery, no logos, no trademarks, no company colors, no readable text, no numbers, no signs, no watermarks, no safety pictograms, and no recognizable real-world company or site. Output one opaque high-resolution PNG background only.
```

### 밝은 안

```text
Create one square 1:1 master background image for a Korean industrial safety tablet application. This is the light-theme counterpart of a dark background variant. Match the dark variant's spatial composition exactly: the same broad material fields, the same quiet central safe area, and the same extremely faint edge-only engineering lines. If the dark result is available, use it only as a composition reference and change the tonal palette, not the geometry. This is a background asset only, not a photograph, not a scene, not a poster, not a dashboard, and not a UI mockup. Do not draw cards, panels, buttons, navigation, charts, labels, or interface chrome.

Visual concept: a quiet abstract industrial-engineering atmosphere made from very large-scale matte pale concrete and satin steel mineral tones, with an extremely faint isometric engineering grid and a few soft topographic contour lines. The material texture must be broad, smooth, low-frequency, and nearly featureless rather than gritty or photographic. Suggest industrial construction through material and drafting language only; do not depict an actual construction site.

Composition and crop safety: create a square master composition designed to be center-cropped both to 2944 x 1840 px landscape and 1840 x 2944 px portrait while the app is running. Keep the central 70% of the image calm, evenly toned, unfocused, and free of recognizable forms because translucent content cards and text will occupy that area. Place any grid, contour, or structural suggestion only near the outer edges and corners, especially as a barely visible cluster near the upper-right edge and lower-left edge. Nothing important may depend on an edge surviving either crop. Do not draw crop guides or borders.

Light palette: pale mineral gray, soft cool concrete, misty blue-gray, and restrained off-white. Use broad gradual tonal transitions with no pure white hotspots, no deep black seams, no saturated accents, and no neighboring light-dark patches. Flat diffuse ambient illumination only. No highlights, reflections, glare, rim light, cast shadows, vignette, bloom, glow, neon, or dramatic lighting. The result should feel restrained, matte, technical, institutional, and dependable, never glossy or decorative.

Readability and compression constraints: very low local contrast everywhere, especially behind the central card-safe area; no sharp focal point; no crisp central detail; no fine grain, speckle, dust, scratches, dense hatching, micro-texture, or visual noise. Favor large smooth color fields so the final app asset can compress efficiently toward 500 KB or less without obvious artifacts.

Hard exclusions: no people, no faces, no silhouettes of workers, no injuries, no accidents, no fire, no smoke, no sparks, no hazardous event, no vehicles, no cranes, no recognizable equipment, no branded machinery, no logos, no trademarks, no company colors, no readable text, no numbers, no signs, no watermarks, no safety pictograms, and no recognizable real-world company or site. Output one opaque high-resolution PNG background only.
```

## 왜 이 프롬프트인가

외부 레퍼런스 저장소에 **이 앱의 대비 제약을 그대로 만족하는 완성형 배경 템플릿은 없었다.**
아래 항목에서 재료·구도를 통제하는 문장 구조만 가져오고, 주제·글자·장식은 앱 규칙에 맞게 제거했다.

| 레퍼런스 | 파일·키 | 가져온 것 | 이 작업에서 바꾼 것 |
|---|---|---|---|
| 카테고리 개요 | `README.md` → `Category Overview` → `Architecture & Spaces` | 재료·공간 개념을 비주얼 언어로 다루는 방향 | 건축 장면 대신 추상 재료 분위기만 남김 |
| 템플릿 카테고리 | `README.md` → `Prompt Template Categories` → `Architecture & Spaces` | perspective·materials·lighting을 분리해 지정하는 구조 | 원근 대신 평면 배경, 광원 대신 평탄한 확산광으로 제한 |
| UI 템플릿 | `data/style-library.json` → `templates[id="ui-screenshot-system"].guidance.en[0]` | aspect ratio와 layout hierarchy를 먼저 고정 | UI를 생성하지 않고, 정사각 마스터·가로/세로 센터 크롭 규칙으로 전환 |
| 건축 템플릿 | `data/style-library.json` → `templates[id="architecture-space"].guidance.en[0]` · `docs/templates.md#tpl-architecture` | viewpoint·scale·material·lighting·function을 명시 | 1:1 배경, 대형 질감, 엣지 선, 카드 중앙 안전 영역으로 구체화 |
| 사진 템플릿 | `data/style-library.json` → `templates[id="realistic-photography"].guidance.en[0]` · `docs/templates.md#tpl-photo` | light source·texture·background을 별도 제약 | 사진성과 렌즈 표현은 버리고 matte·diffuse·low-frequency texture 제약만 사용 |
| 레이아웃 사례 | `data/cases.json` → `cases[id=175].prompt` · `docs/gallery-part-2.md#case-175` | soft gradient background과 화면 왼쪽의 넓은 clean whitespace | 오른쪽 UI·산 이미지·타이포·브랜드를 전부 제거하고 크게 이어지는 색면과 여백 원칙만 사용 |
| 기술 선 사례 | `data/cases.json` → `cases[id=418].prompt` · `docs/gallery-part-2.md#case-418` | 절제된 팔레트, isometric bird's-eye view, technical linework | 랜드마크·글자·초세밀 해칭을 제거하고 모서리의 아주 흐린 격자만 사용 |

`data/style-library.json`의 `styles[id="architecture"]`·`styles[id="ui"]`·`scenes[id="tech"]`는 관련 분류이지만,
이름과 키워드 외에 배경을 제어할 구체 지침은 없었다. 근거를 부풀리지 않기 위해 선정 근거로는 쓰지 않았다.

앱 정본의 근거는 `artifacts/design-constraints.md` §9이다. 특히 `V-7`(우리가 그린 배경에서만 반투명),
`V-8`(사진·영상·펜 캔버스 위 반투명 금지), `V-9`(발광·광택·그림자 장식 금지), `§9-5`(밝은 안·어두운 안 실외 비교)를 프롬프트의 상위 제약으로 두었다.

## 거른 것

| 후보 | 근거 항목 | 뺀 이유 |
|---|---|---|
| 네온 글래스모피즘·`mission control` | `data/cases.json` → `cases[id=131].prompt` · `docs/gallery-part-1.md#case-131` | dark glassmorphism 방향은 가깝지만 neon·glow·발광 카드·중앙 영상은 `V-9`과 배경 판독성을 어김 |
| 고밀도 도시 시스템 아이소메트릭 | `data/cases.json` → `cases[id=73].prompt` · `docs/gallery-part-1.md#case-73` | highly detailed·glowing accents·3D cutaway·중앙 주제·다수 라벨이 반투명 카드 뒤에서 국소 대비를 폭증시킴 |
| 현실적인 격납고·장비 사진 | `data/cases.json` → `cases[id=154].prompt` · `docs/gallery-part-1.md#case-154` | 브랜드 차량·항공기·읽을 수 있는 표지·반사 바닥·선명한 중앙 주제가 금지 조건과 정면 충돌 |
| 산업 오브젝트 접사 | `data/cases.json` → `cases[id=516].prompt` · `docs/gallery-part-2.md#case-516` | matte·diffused light·material texture 문법은 참고할 수 있지만 브랜드 색·로고 형상·macro·razor-sharp focus는 배경 용도에 부적합 |
| 선명한 비계 실루엣 | 지시서 방향 후보 3 | 산업성은 즉각적이지만 크롭에 따라 알아볼 수 있는 중앙 형태가 되기 쉽고 카드 뒤 국소 대비를 만듦 |
| 조밀한 청사진·도면 | `data/style-library.json` → `templates[id="infographic-engine"]` | 모듈·화살표·아이콘·라벨은 설명 그림에는 적합하지만 배경으로는 너무 바쁨. 격자와 등고선을 가장자리에만 남김 |

## 생성 후 확인 절차

`예쁘다`는 합격 기준이 아니다. **최종 카드 합성 후 흰 글자와 잉크 글자가 읽히는지**로 판정한다.

1. **원본 결과 검수**
   - 정사각 1:1, 단일 불투명 PNG인지 확인한다.
   - 사람·얼굴·사고·부상·연기·불·장비·로고·상표·글자·숫자·워터마크가 하나라도 보이면 불합격이다.
   - 중앙 70%에 즉시 이름 붙일 수 있는 물체·공간·실루엣·선명한 선이 있으면 불합격이다.

2. **가로·세로 크롭 검사**
   - 같은 정사각 원본을 중앙 기준으로 가로 **2944×1840px**, 세로 **1840×2944px**로 각각 잘라 본다.
   - 어느 방향에서도 중요한 형태가 절반만 남아 시선을 끌거나, 중앙에 새 초점이 생기면 불합격이다.
   - 다크·라이트 안의 격자·등고선 위치가 서로 다르면 구도 비교가 아니므로 재생성한다. 라이트 안은 다크 결과를 구도 참조로 넣는 방식을 우선한다.

3. **실제 카드·글자 합성 검사**
   - 앱에서 쓸 실제 반투명 카드 색과 알파값을 적용한다. 알파값을 확정하기 전에 배경만 보고 합격 처리하지 않는다.
   - 가로·세로 실제 카드 위치에 **흰 글자 `#FFFFFF`**와 **잉크 글자 `#171717`**를 각각 올린다. 다크에서 흰 글자, 라이트에서 잉크 글자를 기본 조합으로 보되 반대 조합도 함께 확인한다.
   - 글자가 지나는 배경의 가장 밝은 지점·가장 어두운 지점·선이 지나는 지점에서 **최종 합성색**까지 포함해 대비를 재고, 일반 본문이 **4.5:1 미만**이면 불합격이다. 평균색으로만 재지 않는다.
   - 흐린 격자나 재료 무늬가 글자 획을 끊어 읽히게 하면, 수치가 통과해도 불합격이다.

4. **화면 용도 경계 검사**
   - 반투명 카드는 이 배경 자산 위에서만 시험한다.
   - `R-03` 사진, `R-04` 펜 캔버스, `V` 영상 위에 반투명 면을 올려 통과시키지 않는다. 그 화면은 `V-8`대로 불투명 면을 쓴다.
   - 왼쪽 내비 레일은 배경 이미지와 무관하게 `V-6`대로 불투명을 유지한다.

5. **실기기·실외 비교**
   - TB373FU에서 동일한 화면·카드·글자를 두 배경에 올린다.
   - 실내만 보고 결정하지 않고, `§9-5`대로 **실외 주간**에서 밝은 안·어두운 안의 본문, 상태 표시, 버튼 경계를 같은 밝기 설정으로 비교한다.
   - 반사 때문에 카드 경계나 흰/잉크 글자 중 하나라도 평소 순찰 거리에서 바로 읽히지 않으면 불합격이다.

6. **용량·포맷 비교**
   - 생성 원본은 PNG로 보존한다. 앱용 가로·세로 파생본은 **1장당 500KB 이하**를 목표로 한다.
   - 같은 크기·품질에서 PNG와 WebP의 용량, 넓은 그라데이션의 밴딩, 카드 뒤 무늬 손실을 비교해 **수치만 기록**한다.
   - 이 단계에서 WebP 채택 여부를 확정하지 않는다. 판독성·용량 비교 결과와 함께 보고한다.
