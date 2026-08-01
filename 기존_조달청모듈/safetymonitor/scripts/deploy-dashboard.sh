#!/usr/bin/env bash
# 대시보드 배포 원자화 — 검증 → 커밋 고정 아카이브 빌드 → 배포 → 서빙 digest 대조를 한 호출로 (L-32·L-33).
#
# 왜 아카이브 빌드인가 — `gcloud builds submit … .` 은 git 이 아니라 워킹트리를 tar 로 올린다.
# 공유 워킹트리에서는 병렬 세션의 미커밋 수정이 이미지에 실리고(실사고 2026-08-01),
# 커밋 SHA 와 이미지 내용이 양방향으로 어긋난다. `git archive HEAD` 를 풀어 제출하면
# 이미지 = HEAD 커밋이 구성상 보증되고, 빌드 중 HEAD 전진·SHA 대조·tarball 포렌식이 전부 무의미해진다.
#
# 사용.  기존_조달청모듈/safetymonitor/scripts/deploy-dashboard.sh
#   DRY_RUN=1         gcloud 쓰기 호출 없이 계획만 출력(상태검사·검증·아카이브는 실제 수행)
#   SKIP_VERIFY=1     tsc·lint·test 생략(같은 HEAD 를 방금 검증했을 때만)
#   ALLOW_DIRTY=1     빌드 범위 미커밋 변경 무시(검증 트리 ≠ 배포 이미지가 됨 — 알고 강행할 때만)
#   ALLOW_UNPUSHED=1  origin/main 미반영 커밋 배포 허용
#   AI_URL=…          _AI_URL 치환 재정의(기본 cctv-ai 프로덕션)
set -euo pipefail

REGION=asia-northeast3
SERVICE=vitalguard-dashboard
IMAGE_REPO=asia-northeast3-docker.pkg.dev/safetymonitor-498508/vitalguard/dashboard
LIVE_URL="https://vitalguard-dashboard-569797426568.asia-northeast3.run.app"
AI_URL="${AI_URL:-https://cctv-ai-569797426568.asia-northeast3.run.app}"
SUBTREE="기존_조달청모듈/safetymonitor"

export PATH="~/Documents/google-cloud-sdk/bin:$PATH"
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

REPO=$(git -C "$(cd "$(dirname "$0")" && pwd)" rev-parse --show-toplevel)
cd "$REPO"

say "0/5 상태 검사"
git fetch origin -q
SHA=$(git rev-parse HEAD)
BEHIND=$(git rev-list --count HEAD..origin/main)
AHEAD=$(git rev-list --count origin/main..HEAD)
[ "$BEHIND" = 0 ] || die "origin/main 보다 ${BEHIND}커밋 뒤짐 — pull 후 재실행"
if [ "$AHEAD" != 0 ] && [ "${ALLOW_UNPUSHED:-}" != 1 ]; then
  die "미push 커밋 ${AHEAD}개 — push 후 재실행(알고 강행하려면 ALLOW_UNPUSHED=1)"
fi
# 빌드 범위(=이미지에 실리는 범위) dirty 검사 — .gcloudignore 제외 디렉터리는 이미지 밖이라 무시.
DIRTY=$(git -c core.quotepath=false status --porcelain -- "$SUBTREE" \
  | grep -vE "safetymonitor/(docs|scripts|ml|demo|cctv-ai|apps/worker-phone|apps/worker-watch-poc)/" || true)
if [ -n "$DIRTY" ]; then
  if [ "${ALLOW_DIRTY:-}" != 1 ]; then
    echo "$DIRTY"
    die "빌드 범위에 미커밋 변경 — 커밋 후 재실행(강행: ALLOW_DIRTY=1 · 이미지는 HEAD 고정이라 위 변경은 배포에서 빠진다)"
  fi
  echo "HEAD=$SHA (origin 동기 · ⚠ ALLOW_DIRTY 강행 — 빌드 범위 dirty, 이미지에는 HEAD 커밋만 실린다)"
else
  echo "HEAD=$SHA (origin 동기 · 빌드 범위 clean)"
fi

say "1/5 선검증 tsc·lint·test (L-10 — 3종 전부)"
if [ "${SKIP_VERIFY:-}" = 1 ]; then
  echo "SKIP_VERIFY=1 — 생략(같은 HEAD 직전 검증 전제)"
else
  VLOG=$(mktemp)
  (cd "$SUBTREE/apps/dashboard-web" && npx tsc --noEmit) >"$VLOG" 2>&1 \
    || { tail -30 "$VLOG"; die "typecheck 실패"; }
  (cd "$SUBTREE" && pnpm lint) >"$VLOG" 2>&1 \
    || { tail -30 "$VLOG"; die "lint 실패"; }
  (cd "$SUBTREE" && pnpm test) >"$VLOG" 2>&1 \
    || { grep -E "^not ok|# fail|# pass" "$VLOG" | head -20; die "test 실패"; }
  grep -hE "^apps/dashboard-web test: # (tests|pass|fail)" "$VLOG" || true
  rm -f "$VLOG"
fi

say "2/5 커밋 고정 아카이브 (이미지=HEAD 보증 · L-32)"
TMP=$(mktemp -d /tmp/vg-deploy.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
git -c core.quotepath=false archive "HEAD:$SUBTREE" | tar -x -C "$TMP"
for f in Dockerfile cloudbuild.dashboard.yaml .gcloudignore .dockerignore pnpm-lock.yaml pnpm-workspace.yaml; do
  [ -f "$TMP/$f" ] || die "아카이브에 $f 없음 — git 추적 여부 확인"
done
N=$(find "$TMP" -type f | wc -l | tr -d ' ')
[ "$N" -gt 100 ] || die "아카이브 파일 ${N}개 — 추출 실패 의심(조용한 0 금지)"
echo "아카이브 ${N}파일 → $TMP"

say "3/5 빌드 (Cloud Build · _AI_URL=$AI_URL)"
if [ "${DRY_RUN:-}" = 1 ]; then
  echo "DRY_RUN> gcloud builds submit --config $TMP/cloudbuild.dashboard.yaml --substitutions=_AI_URL=$AI_URL $TMP"
  DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000000"
else
  BLOG=$(mktemp)
  gcloud builds submit --config "$TMP/cloudbuild.dashboard.yaml" \
    --substitutions=_AI_URL="$AI_URL" "$TMP" >"$BLOG" 2>&1 \
    || { tail -40 "$BLOG"; die "빌드 실패"; }
  grep -q "SUCCESS" "$BLOG" || { tail -40 "$BLOG"; die "빌드 로그에 SUCCESS 없음"; }
  DIGEST=$(grep -oE 'digest: sha256:[0-9a-f]{64}' "$BLOG" | tail -1 | awk '{print $2}')
  if [ -z "$DIGEST" ]; then
    BID=$(grep -oE 'builds/[0-9a-f-]{36}' "$BLOG" | head -1 | cut -d/ -f2)
    [ -n "$BID" ] && DIGEST=$(gcloud builds describe "$BID" --format='value(results.images[0].digest)')
  fi
  [ -n "${DIGEST:-}" ] || { tail -30 "$BLOG"; die "digest 캡처 실패"; }
  rm -f "$BLOG"
fi
echo "digest=$DIGEST"

say "4/5 배포 (이미지만 교체 · env/시크릿/스케일 보존 · commit-sha 라벨)"
if [ "${DRY_RUN:-}" = 1 ]; then
  echo "DRY_RUN> gcloud run deploy $SERVICE --image $IMAGE_REPO@$DIGEST --region $REGION --update-labels commit-sha=$SHA --quiet"
  echo "DRY_RUN — 5/5 서빙 검증은 실배포에서만. 종료"
  exit 0
fi
PREV_ENVN=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].env.len())' 2>/dev/null || echo "?")
gcloud run deploy "$SERVICE" --image "$IMAGE_REPO@$DIGEST" --region "$REGION" \
  --update-labels commit-sha="$SHA" --quiet >/dev/null 2>&1 \
  || die "gcloud run deploy 실패"

say "5/5 서빙 검증 (deploy 메시지 불신 — describe 로만 판정 · L-20·L-33)"
REV=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.latestCreatedRevisionName)')
TREV=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.traffic[0].revisionName)')
TPCT=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.traffic[0].percent)')
if [ "$TREV" != "$REV" ] || [ "$TPCT" != "100" ]; then
  echo "⚠ 트래픽이 새 리비전 100% 아님(${TREV}=${TPCT}%) → update-traffic 보정(2026-07-31 실사고 재발 방지)"
  gcloud run services update-traffic "$SERVICE" --region "$REGION" --to-revisions "$REV=100" --quiet >/dev/null
fi
RIMG=$(gcloud run revisions describe "$REV" --region "$REGION" --format='value(spec.containers[0].image)')
[ "${RIMG##*@}" = "$DIGEST" ] || die "서빙 digest 불일치 — 서빙 ${RIMG##*@} ≠ 빌드 $DIGEST (병렬 배포 레이스 의심)"
ENVN=$(gcloud run revisions describe "$REV" --region "$REGION" --format='value(spec.containers[0].env.len())')
LBL=$(gcloud run revisions describe "$REV" --region "$REGION" --format='value(metadata.labels.commit-sha)' 2>/dev/null || true)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$LIVE_URL")
[ "$HTTP" = 200 ] || die "라이브 HTTP $HTTP"

say "완료"
echo "리비전   $REV (100%)"
echo "digest   $DIGEST (서빙 대조 일치)"
echo "commit   $SHA (라벨 ${LBL:-서비스에만 기록됨})"
echo "env      ${ENVN}개 (직전 ${PREV_ENVN}개 — 줄었으면 조사)"
echo "HTTP     200"
echo "남은 수동 단계 — 변경 기능 라이브 실측(브라우저) + harness/5-observability/run-log.md 기록"
