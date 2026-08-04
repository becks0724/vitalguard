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
#   ALLOW_DIRTY=1     빌드 범위 미커밋 변경 무시(이미지엔 HEAD 만 실린다).
#                     이때 검증은 워킹트리가 아니라 **아카이브에서** 수행한다 — 갈라진 채 워킹트리로
#                     재면 "검증한 것 ≠ 배포한 것"이 되어, 미커밋 변경이 타입 오류를 가려주고 있었을 때
#                     검증은 통과하고 이미지가 깨진다. 대가로 의존성 설치가 붙어 수 분 더 걸린다.
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

say "1/5 커밋 고정 아카이브 (이미지=HEAD 보증 · L-32)"
TMP=$(mktemp -d /tmp/vg-deploy.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
git -c core.quotepath=false archive "HEAD:$SUBTREE" | tar -x -C "$TMP"
for f in Dockerfile cloudbuild.dashboard.yaml .gcloudignore .dockerignore pnpm-lock.yaml pnpm-workspace.yaml; do
  [ -f "$TMP/$f" ] || die "아카이브에 $f 없음 — git 추적 여부 확인"
done
N=$(find "$TMP" -type f | wc -l | tr -d ' ')
[ "$N" -gt 100 ] || die "아카이브 파일 ${N}개 — 추출 실패 의심(조용한 0 금지)"
echo "아카이브 ${N}파일 → $TMP"

say "2/5 선검증 tsc·lint·test (L-10 — 3종 전부)"
# 검증 대상은 **배포될 트리**여야 한다. clean 이면 워킹트리 = HEAD 라 워킹트리에서 재며(node_modules
# 재사용으로 빠르다), ALLOW_DIRTY 강행이면 둘이 갈라지므로 아카이브에서 잰다.
# 갈라진 채 워킹트리로 검증하면 "검증한 것 ≠ 배포한 것"이 된다 — 미커밋 변경이 타입 오류를
# 가려주고 있었다면 검증은 통과하고 이미지는 깨진다(2026-08-01 ALLOW_DIRTY 배포에서 드러난 구멍).
if [ "${SKIP_VERIFY:-}" = 1 ]; then
  echo "SKIP_VERIFY=1 — 생략(같은 HEAD 직전 검증 전제)"
else
  VLOG=$(mktemp)
  if [ -n "$DIRTY" ]; then
    echo "⚠ dirty 강행 — 워킹트리 대신 아카이브에서 검증(검증=이미지 보장). 의존성 설치가 필요해 수 분 걸린다."
    (cd "$TMP" && pnpm install --frozen-lockfile) >"$VLOG" 2>&1 \
      || { tail -30 "$VLOG"; die "아카이브 pnpm install 실패"; }
    # analyzers·schemas 는 dist 를 import 한다 — 빌드 전에는 tsc 가 대량 실패한다.
    (cd "$TMP" && pnpm -r --filter=./packages/* build) >"$VLOG" 2>&1 \
      || { tail -30 "$VLOG"; die "packages 빌드 실패"; }
    # ⚠️ subtree 아카이브에는 **레포 루트의 iOS/워치 앱 소스가 없다**(빌드 컨텍스트가 safetymonitor 라서).
    #    그 파일을 readFileSync 로 읽는 계약 가드는 모듈 로드에서 죽어 테스트 10개가 통째로 빠진다
    #    (실측 513 → 503 + 파일 실패 1). **이미지에 안 들어가는 자산의 계약 검사라 배포 안전성과 무관**하므로
    #    아카이브 검증에서만 제외한다 — 워킹트리 검증(clean 경로)에서는 그대로 돈다.
    ARCHIVE_SKIP="lib/2026-07-29-hyperclova-secret-boundary.test.ts"
    for t in $ARCHIVE_SKIP; do
      [ -f "$TMP/apps/dashboard-web/$t" ] || die "제외 대상 $t 이 아카이브에 없다 — 경로가 바뀌었는지 확인"
      rm -f "$TMP/apps/dashboard-web/$t"
      echo "  제외(레포 루트 참조·이미지 밖 자산 가드): $t"
    done
    VROOT="$TMP"
  else
    VROOT="$SUBTREE"
  fi
  (cd "$VROOT/apps/dashboard-web" && npx tsc --noEmit) >"$VLOG" 2>&1 \
    || { tail -30 "$VLOG"; die "typecheck 실패"; }
  (cd "$VROOT" && pnpm lint) >"$VLOG" 2>&1 \
    || { tail -30 "$VLOG"; die "lint 실패"; }
  (cd "$VROOT" && pnpm test) >"$VLOG" 2>&1 \
    || { grep -E "^not ok|# fail|# pass" "$VLOG" | head -20; die "test 실패"; }
  grep -hE "^apps/dashboard-web test: # (tests|pass|fail)" "$VLOG" || true
  echo "검증 트리 = $([ -n "$DIRTY" ] && echo "아카이브(HEAD 고정)" || echo "워킹트리(= HEAD)")"
  rm -f "$VLOG"
fi

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
# 트래픽 판정 — 세 번 고쳐서 여기까지 왔다(2026-08-04~05 실측). 순서대로 다 필요했다.
#  ① `status.traffic[0]` 을 그대로 읽으면 안 된다. 태그가 붙은 옛 리비전(예: tag=verify)이
#     배열에 함께 들어가고 순서가 보장되지 않아 **엉뚱한 리비전명**이 찍혔다.
#     → `revisionName` 으로 필터한다.
#  ② 그래도 "0%" 로 경고가 떴다. `gcloud run deploy` 직후 `status` 는 아직 0 이기 때문이다.
#  ③ 재시도로 기다려도 부족했다 — **라우팅 전파가 60초 이상 걸린다**(배포 로그의
#     `Routing traffic....(점 63개)....done` 이 그 시간이다). status 를 기다리는 것은
#     매번 1분을 버리고 그동안 경고를 띄우는 셈이다.
#
# → **`spec.traffic` 으로 판정한다.** deploy 가 설정하는 "의도된 라우팅" 은 즉시 100 이고,
#   `status` 는 그것을 뒤따를 뿐이다. 실제 서빙 여부는 아래 **digest 대조 + HTTP 200** 이 잡는다.
#   `spec` 도 `describe` 결과이므로 "deploy 메시지를 믿지 않는다"(L-20·L-33)는 그대로 지킨다.
# ⚠️ 경고가 상시화되면 진짜 경고를 못 알아본다. 오탐 제거가 이 블록의 목적이다.
TPCT=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format="value(spec.traffic.filter(\"revisionName:$REV\").extract(percent))" 2>/dev/null | tr -d '[] ')
[ -n "$TPCT" ] || TPCT=0
if [ "$TPCT" != "100" ]; then
  echo "⚠ 트래픽이 새 리비전 100% 아님(${REV}=${TPCT}%) → update-traffic 보정(2026-07-31 실사고 재발 방지)"
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
# dirty 강행 사실은 0단계에서 한 번 보이지만 긴 빌드 로그에 묻힌다 — 요약에 다시 남긴다.
if [ -n "$DIRTY" ]; then
  echo "⚠ ALLOW_DIRTY 강행 — 아래 미커밋 변경은 이미지에 없다(검증은 아카이브에서 수행):"
  echo "$DIRTY" | sed 's/^/           /'
fi
echo "남은 수동 단계 — 변경 기능 라이브 실측(브라우저) + harness/5-observability/run-log.md 기록"
