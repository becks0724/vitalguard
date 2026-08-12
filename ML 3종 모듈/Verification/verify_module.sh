#!/bin/bash
# 모듈 무결성 검사 — 팀원에게 받은(또는 통합된) 모듈이 원본과 같은지 검증.
#
# 사용:  ./verify_module.sh <검사할_모듈폴더>
#   예:  ./verify_module.sh ~/Downloads/받은모듈
#        ./verify_module.sh "../../앱레포/Watch"   (통합된 타깃 폴더도 가능 — 있는 파일만 대조)
#
# 기준: 이 스크립트 옆의 MANIFEST.sha256 (원본 릴리스 때 생성).
# 판정: ✅ 전부 일치 = 무변조 / ❌ 하나라도 다름·누락 = 오염 의심 → diff로 원인 확인.
set -u
BASE="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$BASE/MANIFEST.sha256"
TARGET="${1:?사용법: ./verify_module.sh <검사할_모듈폴더>}"

[ -f "$MANIFEST" ] || { echo "MANIFEST.sha256 없음 — 원본 모듈에서 실행하세요"; exit 2; }
cd "$TARGET" || exit 2

fail=0; miss=0; ok=0
while read -r hash path; do
  if [ ! -f "$path" ]; then
    # 통합 타깃엔 문서류가 없을 수 있음 — 코어(Sources/Models)만 누락을 오염으로 침
    case "$path" in
      Sources/*|Models/*) echo "❌ 누락: $path"; miss=$((miss+1)) ;;
      *) echo "· 생략(없음): $path" ;;
    esac
    continue
  fi
  actual=$(shasum -a 256 "$path" | awk '{print $1}')
  if [ "$actual" = "$hash" ]; then
    ok=$((ok+1))
  else
    echo "❌ 변조: $path"
    fail=$((fail+1))
  fi
done < "$MANIFEST"

echo "―――――――――――――――――――――"
echo "일치 $ok · 변조 $fail · 코어 누락 $miss"
if [ $fail -eq 0 ] && [ $miss -eq 0 ]; then
  echo "✅ 파일 무결 — 다음 단계: 워치 [ML 자가검증] 6/6 ✅ 로 기능 확인"
  exit 0
else
  echo "🔴 오염 의심 — 변조 파일을 원본과 diff 후, 검증절차.md 게이트 없이는 수용 금지"
  exit 1
fi
