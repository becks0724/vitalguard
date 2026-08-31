#!/usr/bin/env bash
# 워치 @Preview 14장을 빌드만으로 PNG 로 뽑는다 — 실기·에뮬레이터 없이 화면을 본다 (docs/wear-preview-screenshot)
#
# ★ 왜 복사해서 빌드하나. Compose Preview Screenshot Testing(alpha15)은 엔진 파라미터를 UTF-8 로 쓰고
#   Latin-1 로 읽어서, 프로젝트 경로에 한글(`기존_조달청모듈`)이 있으면 NoSuchFileException 으로 죽는다.
#   심링크는 Gradle 이 실경로로 풀고, macOS JDK 는 sun.jnu.encoding 을 UTF-8 로 고정해 -D 로도 못 돌린다(실측).
#   그래서 소스만 ASCII 경로로 rsync 해서 거기서 돌린다. 복사본의 build/ 는 지우지 않아 두 번째부터는 수 초다.
#
# 사용.  scripts/wear-shots.sh            → apps/vitalguard_app/build/wear-shots/*.png (git 무시 경로)
#        WEAR_SHOTS_OUT=<dir> 로 출력 위치 변경 · WEAR_SHOTS_CACHE=<ascii dir> 로 복사 위치 변경
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/../apps/vitalguard_app"
CACHE="${WEAR_SHOTS_CACHE:-$HOME/Library/Caches/vitalguard/wear-shots}"
DST="$CACHE/vitalguard_app"
OUT="${WEAR_SHOTS_OUT:-$SRC/build/wear-shots}"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"

# 복사 위치에 ASCII 아닌 글자가 있으면 처음 문제로 되돌아간다 — 여기서 막는다.
case "$CACHE" in *[!A-Za-z0-9/._-]*) echo "✖ WEAR_SHOTS_CACHE 에 ASCII 아닌 문자가 있다 — 플러그인이 못 읽는다: $CACHE" >&2; exit 2 ;; esac
[ -x "$JAVA_HOME/bin/java" ] || { echo "✖ JAVA_HOME 에 java 가 없다: $JAVA_HOME" >&2; exit 2; }

mkdir -p "$DST" "$OUT"
# --delete 는 제외 항목(복사본의 build/)을 지우지 않는다 — 증분 빌드가 살아 있다.
rsync -a --delete \
  --exclude 'build/' --exclude '.dart_tool/' --exclude '.gradle/' --exclude '.kotlin/' --exclude '.git/' \
  --exclude 'ios/' --exclude 'macos/' --exclude 'linux/' --exclude 'windows/' --exclude 'web/' \
  --exclude 'node_modules/' --exclude '*.apk' --exclude '*.aab' --exclude '*.ipa' \
  "$SRC/" "$DST/"

( cd "$DST/android" && ./gradlew :wear:updateDebugScreenshotTest --console=plain -q )

REF="$DST/android/wear/src/screenshotTestDebug/reference"
rm -f "$OUT"/*.png
find "$REF" -name '*.png' -exec cp {} "$OUT"/ \;
N=$(ls "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ')
[ "$N" -gt 0 ] || { echo "✖ PNG 가 0장 — 렌더는 통과했는데 산출물이 없다. $REF 를 본다" >&2; exit 1; }
echo "✔ 워치 프리뷰 ${N}장 → $OUT"
ls "$OUT"
