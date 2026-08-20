#!/usr/bin/env bash
# 리비전별 DB 커넥션 타임아웃 건수를 **하나의 고정 필터**로 재는 스크립트 (L-95).
#
# 왜 스크립트인가 — 손으로 리비전을 하나씩 재는 동안 필터가 조용히 흘러갔다.
# `textPayload:"Connection terminated"` 는 에러 줄과 그 아래
# `[cause]: [Error: Connection terminated unexpectedly]` 줄을 **둘 다** 세서 값이 2.5배가 된다
# (2026-08-20 실사고 — 00300 을 33건으로 보고, 실제 13건. 그 위에 "1.00건/분 = 폴링 박자"라는
#  해석이 얹혀 인과 오판까지 갔다 · L-94).
# 서로 다른 자로 잰 값은 비교가 아니다. 이 파일이 그 자를 고정한다.
#
# 사용.  scripts/db-timeout-count.sh [리비전접미사 ...]
#        scripts/db-timeout-count.sh                 최근 5개 리비전 자동
#        scripts/db-timeout-count.sh 00300-xf5 00302-kg8
#        FRESHNESS=24h scripts/db-timeout-count.sh    조회 창(기본 12h)
set -euo pipefail

REGION=asia-northeast3
SERVICE=vitalguard-dashboard
FRESHNESS="${FRESHNESS:-12h}"

# ★ 이 한 줄이 자다. 바꾸려면 이 파일에서 바꾸고, 바꾼 뒤에는 비교 대상 전부를 다시 재라.
FILTER_TEXT='Connection terminated due to connection timeout'

command -v gcloud >/dev/null || { echo "gcloud 없음 — PATH 확인" >&2; exit 1; }

# ⚠ macOS 기본 bash 는 3.2 라 `mapfile` 이 없다. while-read 로 담는다.
revs=()
if [ "$#" -gt 0 ]; then
  revs=("$@")
else
  while IFS= read -r line; do
    [ -n "$line" ] && revs+=("$line")
  done < <(gcloud run revisions list --service "$SERVICE" --region "$REGION" \
    --format="value(metadata.name)" --limit=5 | sed "s/^$SERVICE-//")
fi
[ "${#revs[@]}" -gt 0 ] || { echo "리비전을 못 찾았다 — 서비스명·리전 확인" >&2; exit 1; }

echo "필터  textPayload:\"$FILTER_TEXT\"   창=$FRESHNESS"
printf '%-14s %8s %12s %10s\n' 리비전 건수 서빙분 건/분
printf '%-14s %8s %12s %10s\n' -------------- -------- ------------ ----------

now=$(date -u +%s)
prev_start=""
for r in "${revs[@]}"; do
  name="$SERVICE-$r"
  n=$(gcloud logging read "resource.type=\"cloud_run_revision\"
    AND resource.labels.service_name=\"$SERVICE\"
    AND resource.labels.revision_name=\"$name\"
    AND textPayload:\"$FILTER_TEXT\"" \
    --limit=1000 --freshness="$FRESHNESS" --format="value(timestamp)" 2>/dev/null | wc -l | tr -d ' ')

  created=$(gcloud run revisions describe "$name" --region "$REGION" \
    --format="value(metadata.creationTimestamp)" 2>/dev/null | cut -c1-19)
  if [ -n "$created" ]; then
    start=$(date -u -j -f "%Y-%m-%dT%H:%M:%S" "$created" +%s 2>/dev/null || echo "")
    # 다음(=더 새) 리비전이 뜬 시각까지가 서빙 구간. 목록은 최신순이라 직전 루프의 시작이 내 끝이다.
    end=${prev_start:-$now}
    mins=$(( (end - start) / 60 ))
    prev_start=$start
  else
    mins=0
  fi

  if [ "$mins" -gt 0 ]; then rate=$(awk -v a="$n" -v b="$mins" 'BEGIN{printf "%.2f", a/b}'); else rate="-"; fi
  printf '%-14s %8s %12s %10s\n' "$r" "$n" "$mins" "$rate"
done

echo
echo "⚠ 건수만으로 인과를 적지 않는다(L-94) — 실패 라우트와 UA(node/Mozilla/curl)를 함께 본다."
echo "   내 변경이 실린 리비전에서도 같은 증상이 나면 그 인과는 거기서 기각된다."
