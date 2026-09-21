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
#   APPROVED_AT=<sha> 배포 대상을 **승인 시점 커밋**으로 고정(기본 HEAD · L-116⑥).
#                     승인 이후 쌓인 커밋은 출력에는 보이되 이미지에는 안 실린다.
#                     검증도 그 트리(아카이브)에서 한다 — 워킹트리는 배포될 트리가 아니게 되므로.
#   AI_URL=…          _AI_URL 치환 재정의(기본 cctv-ai 프로덕션)
#   CAM03_GATE=…      CAM-03 젯슨 직결 게이트 주소. **기본값이 채워져 있다**(아래 참조).
#                     끄려면 CAM03_GATE= 로 **빈값을 명시**한다 — 그러면 종전 _AI_URL 경로를 쓴다.
#                     ⚠ NEXT_PUBLIC_* 라 빌드타임에 번들로 들어간다 — 런타임 env 로는 못 바꾼다.
set -euo pipefail

REGION=asia-northeast3
SERVICE=vitalguard-dashboard
IMAGE_REPO=asia-northeast3-docker.pkg.dev/safetymonitor-498508/vitalguard/dashboard
LIVE_URL="https://vitalguard-dashboard-569797426568.asia-northeast3.run.app"
AI_URL="${AI_URL:-https://cctv-ai-569797426568.asia-northeast3.run.app}"
# ★ 2026-09-15 기본값을 채웠다. 종전엔 빈값이라 **매 배포마다 사람이 넘겨야** 했고,
#   09-11 에 실제로 두 번 연속 빠져 CAM-03 이 이틀 죽었다(00371·00372).
#   ⚠ 그 고장은 아무 경보도 안 낸다 — 배포 성공·테스트 1658/1658·소스 가드 전부 초록이었다.
#   가드는 "코드 배선"을 보는데 빠진 것은 "빌드 치환"이라 단위가 다르다.
#   판정은 라이브 번들 검색으로만 된다(청크에서 게이트 주소 적중 · 통제군 함께).
#   ⚠ 콜론 없는 ${VAR-기본값} 이다(:- 아님) — 그래야 `CAM03_GATE= ...` 로 **끌 수 있다**.
#     :- 를 쓰면 빈값을 명시해도 기본값이 살아나 cctv-ai 폴백으로 못 되돌린다.
#   되돌리기 = CAM03_GATE= 를 앞에 붙여 실행. 시연 등으로 cctv-ai 경로가 필요할 때 쓴다.
#
# ⛔⛔ 2026-09-21 기본값을 갈았다 — **구조는 살아 있었는데 담긴 값이 낡아 있었다.**
#   종전 기본값 `https://cctv-gate.example.invalid:8443` 은 09-18 에 무효가 됐다.
#   그날 CCTV 를 Tailscale 직결로 옮기면서(00402) 이 줄이 따라오지 않았다.
#   ```
#   cctv-gate.example.invalid → 192.168.219.47   ← 사설 대역. 그 랜 안에서만 닿는다
#   ```
#   09-11 의 고장(사람이 매번 넘겨야 함)은 기본값을 채워 막았는데, 그 기본값 자체가 죽은 것을
#   사흘간 아무도 안 봤다. 라이브(00403)가 멀쩡했던 것은 누군가 손으로 명시했기 때문이다.
#   ★ 구조는 「빠뜨림」을 막지만 「값이 낡음」은 안 막는다. 주소를 바꾸는 날 이 줄을 같이 본다.
CAM03_GATE="${CAM03_GATE-https://jetson-1.tailnet.invalid:8443}"
SUBTREE="기존_조달청모듈/safetymonitor"

export PATH="~/Documents/google-cloud-sdk/bin:$PATH"
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

SELFDIR=$(cd "$(dirname "$0")" && pwd)   # ★ cd 전에 절대경로로 굳힌다 — 아래 cd 뒤엔 $0 가 못 쓰인다
REPO=$(git -C "$SELFDIR" rev-parse --show-toplevel)
cd "$REPO"

say "0/5 상태 검사"
git fetch origin -q
HEAD_SHA=$(git rev-parse HEAD)

# ── 배포 대상 = 승인 시점 커밋 (2026-08-28 · L-116⑥ 의 나머지 절반) ──────────────
# 아래에서 `HEAD` 를 뜨는 것만으로는 창이 하나 남는다 — **사용자가 승인한 시각과 스크립트가
# 시작한 시각 사이.** 그 사이 옆 세션이 커밋하면(이 레포는 세션 셋이 한 워킹트리에 붙어 있다)
# 승인한 적 없는 코드가 같은 이미지로 나간다. 그리고 tsc·lint·test 3종은 그것을 못 잡는다 —
# **타입검사는 색을 안 본다**(L-116④ · 전역 CSS·색 토큰은 3종을 통과한 채 화면을 깬다).
#
# ⚠ 창 하나는 이미 같은 방식으로 닫혀 있다(1/5 의 고정 아카이브 · L-116⑥ 앞절반). 여기도 같은 처방이다 —
#   ★ 그 줄을 여기서 **글자 그대로 인용하지 않는다** — 옛 가드가 그 문자열을 파일에서 처음
#     나오는 자리로 앵커해 1/5 구간을 찾는다. 주석이 인용하면 앵커가 주석을 집어 가드가 거짓
#     빨간불을 낸다(2026-08-28 실측). 앵커의 유일성은 파일 전체의 성질이고 주석도 그 일부다.
#   **대조가 아니라 값.** 대조로 닫으려 하면 검사와 사용 사이가 또 임계 구간이 된다([[L-31]]).
# ⚠ 기본값은 바꾸지 않는다. APPROVED_AT 이 없으면 오늘과 완전히 같이 동작한다(옵트인).
if [ -n "${APPROVED_AT:-}" ]; then
  SHA=$(git rev-parse --verify --quiet "${APPROVED_AT}^{commit}") \
    || die "APPROVED_AT=${APPROVED_AT} 가 이 클론의 커밋이 아니다"
  # ★ 조상 검사가 없으면 APPROVED_AT 은 안전장치가 아니라 **임의 커밋 배포 도구**가 된다.
  git merge-base --is-ancestor "$SHA" "$HEAD_SHA" \
    || die "APPROVED_AT ${SHA:0:7} 이 HEAD(${HEAD_SHA:0:7})의 조상이 아니다 — 오타이거나 갈라진 히스토리"
else
  SHA=$HEAD_SHA
fi
PINNED=""
if [ "$SHA" != "$HEAD_SHA" ]; then PINNED=1; fi

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
    die "빌드 범위에 미커밋 변경 — 커밋 후 재실행(강행: ALLOW_DIRTY=1 · 이미지는 ${SHA:0:7} 고정이라 위 변경은 배포에서 빠진다)"
  fi
  echo "배포대상=$SHA${PINNED:+ ★APPROVED_AT 고정} (origin 동기 · ⚠ ALLOW_DIRTY 강행 — 빌드 범위 dirty, 이미지에는 해당 커밋만 실린다)"
else
  echo "배포대상=$SHA${PINNED:+ ★APPROVED_AT 고정} (origin 동기 · 빌드 범위 clean)"
fi

# ── 배포 범위 = "내 커밋"이 아니라 <직전 라이브>..HEAD 전부다 (L-59) ─────────────
# 아카이브 빌드는 HEAD 를 통째로 싣는다. 공유 main 에서는 병렬 세션의 커밋이 함께 나가는데,
# 자기 diff 만 보면 그게 안 보여 **검증 범위와 배포 범위가 어긋난다**(2026-08-14 양쪽 세션이
# 대칭으로 같은 착각 — 한쪽은 열 폭만, 다른 쪽은 체감온도만 검증할 뻔했다).
# 직전 라이브 커밋은 추측하지 않고 **서빙 리비전의 commit-sha 라벨**에서 가져온다(4/5 가 매번 심는다).
# 전 구간 실패 무해 — 정보 출력이라 조회가 안 되면 그 사실만 알리고 배포는 계속한다.
LIVE_REV=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format="value(status.traffic.filter(\"percent:100\").extract(revisionName))" 2>/dev/null \
  | tr -d "[]' " || true)
# ⚠ `[ ] && cmd` 형태로 쓰지 않는다 — 조건이 거짓이면 AND-list 가 1 을 돌려 `set -e` 가 배포를 죽인다.
LIVE_SHA=""
if [ -n "$LIVE_REV" ]; then
  LIVE_SHA=$(gcloud run revisions describe "$LIVE_REV" --region "$REGION" \
    --format="value(metadata.labels.commit-sha)" 2>/dev/null || true)
fi

if [ -z "$LIVE_SHA" ]; then
  echo "⚠ 배포 범위 미산출 — 라이브 리비전(${LIVE_REV:-조회실패})에 commit-sha 라벨이 없다. 범위를 눈으로 확인할 것"
elif ! git cat-file -e "${LIVE_SHA}^{commit}" 2>/dev/null; then
  echo "⚠ 배포 범위 미산출 — 라벨 커밋 ${LIVE_SHA:0:7} 이 이 클론에 없다(히스토리 재작성?). 범위를 눈으로 확인할 것"
elif [ "$LIVE_SHA" = "$SHA" ]; then
  echo "배포 범위 = 없음 — 라이브($LIVE_REV)와 같은 커밋을 재배포한다"
else
  RANGE="${LIVE_SHA}..${SHA}"
  git merge-base --is-ancestor "$LIVE_SHA" "$SHA" 2>/dev/null \
    || echo "⚠ 라이브 커밋이 배포대상의 조상이 아니다 — 롤백 이후이거나 갈라진 히스토리다. 아래 목록을 그대로 믿지 말 것"
  NCOMMIT=$(git rev-list --count "$RANGE")
  # ⚠ 작성자는 **팀원**을 가리지 병렬 세션을 가리지 못한다 — 같은 맥의 세션들은 같은 git 신원을 쓴다.
  # 세션 간 혼입은 작성자가 아니라 **커밋 제목**으로 판별한다(아래 목록).
  AUTHORS=$(git log --format='%an' "$RANGE" | sort -u | paste -sd', ' -)
  NAUTHOR=$(git log --format='%an' "$RANGE" | sort -u | grep -c .)
  # ★ 경고는 그 값이 찍히는 자리에 함께 찍는다(L-59 2026-08-22) — 주석에만 있으면 사람은 못 본다.
  #   저자가 1명이면 이 필드는 판별력이 0이다(병렬 세션은 같은 git 신원). 여럿이면 실제로 팀원을 가리므로 조용히 둔다.
  AUTHOR_NOTE=""
  [ "$NAUTHOR" = "1" ] && AUTHOR_NOTE="  ⚠ 1명 — 이 필드로는 병렬 세션이 안 갈린다. 제목·diff 로 판별할 것"
  echo "배포 범위 = $LIVE_REV(${LIVE_SHA:0:7}) → 배포대상(${SHA:0:7}) · ${NCOMMIT}커밋 · 작성자: ${AUTHORS}${AUTHOR_NOTE}"
  # `| head` 는 pipefail 과 함께 SIGPIPE 로 파이프라인을 실패시킨다 — `-n` 으로 git 쪽에서 자른다.
  git log -n 20 --format='  %h %an — %s' "$RANGE"
  if [ "$NCOMMIT" -gt 20 ]; then echo "  … 이하 $((NCOMMIT - 20))커밋 생략"; fi
  git -c core.quotepath=false diff --stat "$RANGE" -- "$SUBTREE" | tail -1 | sed 's/^/  /'
  echo "  ★ 라이브 검증 목록은 '내가 무엇을 고쳤나'가 아니라 위 범위 전체에서 만든다(L-59)."
fi

# ── 제외 범위 — 승인 이후 쌓였지만 이번에 안 나가는 것 ──────────────────────────
# 고정의 값어치는 여기서 눈에 보인다. 되묻기(L-116③)의 성격이 판정에서 **정보**로 바뀐다 —
# "5커밋 더 있는데 진행할까요" 가 아니라 "N줄이 더 쌓였지만 이번 배포엔 안 실립니다".
if [ -n "$PINNED" ]; then
  NEX=$(git rev-list --count "${SHA}..${HEAD_SHA}")
  echo "제외 범위 = 배포대상(${SHA:0:7}) → HEAD(${HEAD_SHA:0:7}) · ${NEX}커밋 — ★이번 배포에 안 실린다"
  git log -n 10 --format='  − %h %an — %s' "${SHA}..${HEAD_SHA}"
  if [ "$NEX" -gt 10 ]; then echo "  … 이하 $((NEX - 10))커밋 생략"; fi
  git -c core.quotepath=false diff --stat "${SHA}..${HEAD_SHA}" -- "$SUBTREE" | tail -1 | sed 's/^/  − /'
fi

say "1/5 커밋 고정 아카이브 (이미지=\$SHA 보증 · L-32·L-116⑥)"
TMP=$(mktemp -d /tmp/vg-deploy.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
# ★ `HEAD` 가 아니라 **39행에서 떠 둔 $SHA** 를 아카이브한다(2026-08-26 · L-116⑥).
#
# 왜. `HEAD` 는 이름이라 **읽을 때마다 다른 커밋을 가리킬 수 있다.** 39행에서 $SHA 를 뜨고
# 여기까지 오는 사이(상태 검사·범위 산출로 수 초~수십 초) 병렬 세션이 커밋하면, 라벨은 $SHA 인데
# 아카이브는 새 커밋이 된다 — 이미지가 무엇인지 판정하는 유일한 근거(commit-sha 라벨)가 거짓이 된다.
# 공유 워킹트리에 세 세션이 붙어 있는 이 레포에서 실현 가능한 창이고, 08-26 배포에서는 옆 세션에
# **커밋 홀드를 부탁해서** 막았다. 사람의 협조로 막는 것은 구조가 아니다.
#
# ⚠ 대조로는 못 닫는다 — "검사 후 아카이브" 사이가 임계 구간이라 [[L-31]] 과 같은 모양이다.
#   닫는 방법은 이름 대신 **값**을 쓰는 것뿐이다. 아래 한 줄이 그 전부다.
git -c core.quotepath=false archive "$SHA:$SUBTREE" | tar -x -C "$TMP"
for f in Dockerfile cloudbuild.dashboard.yaml .gcloudignore .dockerignore pnpm-lock.yaml pnpm-workspace.yaml; do
  [ -f "$TMP/$f" ] || die "아카이브에 $f 없음 — git 추적 여부 확인"
done
N=$(find "$TMP" -type f | wc -l | tr -d ' ')
[ "$N" -gt 100 ] || die "아카이브 파일 ${N}개 — 추출 실패 의심(조용한 0 금지)"
echo "아카이브 ${N}파일 → $TMP"

say "2/5 선검증 tsc·lint·test (L-10 — 3종 전부)"
# 검증 대상은 **배포될 트리**여야 한다. clean 이고 고정이 없으면 워킹트리 = 배포대상이라 워킹트리에서
# 재며(node_modules 재사용으로 빠르다), 갈라지면 아카이브에서 잰다.
# 갈라진 채 워킹트리로 검증하면 "검증한 것 ≠ 배포한 것"이 된다 — 미커밋 변경이 타입 오류를
# 가려주고 있었다면 검증은 통과하고 이미지는 깨진다(2026-08-01 ALLOW_DIRTY 배포에서 드러난 구멍).
#
# ★ 갈라지는 길이 **둘**이다(2026-08-28). ① ALLOW_DIRTY 강행 ② APPROVED_AT 고정.
#   ②를 빠뜨리면 ①이 만들었던 구멍과 **완전히 같은 모양**이 된다 — 워킹트리는 HEAD 인데
#   배포되는 것은 승인 시점 커밋이므로, 승인 이후 커밋이 타입 오류를 가려주고 있으면 그대로 나간다.
VERIFY_IN_ARCHIVE=""
if [ -n "$DIRTY" ] || [ -n "$PINNED" ]; then VERIFY_IN_ARCHIVE=1; fi
if [ "${SKIP_VERIFY:-}" = 1 ]; then
  echo "SKIP_VERIFY=1 — 생략(같은 커밋 직전 검증 전제)"
else
  VLOG=$(mktemp)
  if [ -n "$VERIFY_IN_ARCHIVE" ]; then
    echo "⚠ 워킹트리 ≠ 배포대상(${DIRTY:+dirty 강행}${DIRTY:+ · }${PINNED:+APPROVED_AT 고정}) — 아카이브에서 검증한다(검증=이미지 보장). 의존성 설치가 필요해 수 분 걸린다."
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
  echo "검증 트리 = $([ -n "$VERIFY_IN_ARCHIVE" ] && echo "아카이브(${SHA:0:7} 고정)" || echo "워킹트리(= ${SHA:0:7})")"
  rm -f "$VLOG"
fi

say "3/5 빌드 (Cloud Build · _AI_URL=$AI_URL · _CAM03_GATE=${CAM03_GATE:-<없음>})"
if [ "${DRY_RUN:-}" = 1 ]; then
  echo "DRY_RUN> gcloud builds submit --config $TMP/cloudbuild.dashboard.yaml --substitutions=_AI_URL=$AI_URL,_CAM03_GATE=$CAM03_GATE $TMP"
  DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000000"
else
  BLOG=$(mktemp)
  gcloud builds submit --config "$TMP/cloudbuild.dashboard.yaml" \
    --substitutions=_AI_URL="$AI_URL",_CAM03_GATE="$CAM03_GATE" "$TMP" >"$BLOG" 2>&1 \
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
# 롤백 원터치용 — 배포 직전 서빙 리비전을 기억해 완료 요약에 롤백 한 줄을 인쇄한다.
PREV_REV=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format='value(status.traffic.filter("percent:100").extract(revisionName))' 2>/dev/null | tr -d '[] ' || true)
gcloud run deploy "$SERVICE" --image "$IMAGE_REPO@$DIGEST" --region "$REGION" \
  --update-labels commit-sha="$SHA" --quiet >/dev/null 2>&1 \
  || die "gcloud run deploy 실패"

say "5/5 서빙 검증 (deploy 메시지 불신 — describe 로만 판정 · L-20·L-33)"
REV=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.latestCreatedRevisionName)')
# 트래픽 판정 — 2026-08-04~05 실측. "0% 경고" 를 오탐으로 보고 판정식을 세 번 고쳤는데
# **세 번 다 오진이었다.** 원인은 판정식이 아니라 서비스 설정이다.
#
# ★ 이 서비스는 트래픽이 **리비전 이름으로 고정(pinned)** 돼 있다 — `spec.traffic` 에
#   `latestRevision: true` 가 없고 `revisionName` 항목만 있다. 그래서 `gcloud run deploy` 는
#   새 리비전을 만들 뿐 라우팅을 옮기지 않고, 판정이 읽는 0% 는 **실제 상태**다.
#   아래 `update-traffic` 은 오탐 대응이 아니라 **매 배포에 실제로 필요한 절차**이며 지금까지
#   매번 성공해 왔다. 같은 뿌리로 시크릿 회전도 리비전을 갈아야만 반영된다(L-41).
#
# 판정은 `spec.traffic`(의도된 라우팅)으로 한다 — 보정 뒤 `status` 전파는 60초 넘게 걸려
#   기다리면 배포마다 1분을 버린다. 실제 서빙 여부는 아래 **digest 대조 + HTTP 200** 이 잡고,
#   `spec` 도 `describe` 결과이므로 "deploy 메시지를 믿지 않는다"(L-20·L-33)는 그대로 지킨다.
# ⚠️ `revisionName` 으로 필터할 것 — 태그가 붙은 옛 리비전(tag=verify)이 배열에 함께 들어가고
#   순서가 보장되지 않아 `[0]` 을 읽으면 엉뚱한 리비전의 퍼센트가 나온다.
# ⚠️ 두 라우팅 모드를 모두 다뤄야 한다(2026-08-13 사용자 결정으로 latestRevision 전환).
#   ① latestRevision: true  — 배포가 알아서 최신으로 넘어간다. 보정하면 **오히려 되돌린다**.
#   ② revisionName 고정      — 배포가 라우팅을 안 옮기므로 보정이 필요하다.
#   ①의 항목에는 `revisionName` 필드가 아예 없어, 아래 revisionName 필터가 빈 값을 낸다.
#   그것을 0% 로 읽고 보정하면 매 배포마다 ①이 ②로 되돌아간다(전환 당일 실제로 발견).
LATEST_PCT=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format="value(spec.traffic.filter(\"latestRevision:true\").extract(percent))" 2>/dev/null | tr -d '[] ')
TPCT=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format="value(spec.traffic.filter(\"revisionName:$REV\").extract(percent))" 2>/dev/null | tr -d '[] ')
[ -n "$TPCT" ] || TPCT=0
if [ "$LATEST_PCT" = "100" ]; then
  echo "트래픽 = 최신 리비전 자동 추종(latestRevision 100%) — 보정하지 않는다(보정하면 고정으로 되돌아간다)"
elif [ "$TPCT" != "100" ]; then
  echo "트래픽이 리비전에 고정돼 있어 보정한다 — 정상 절차(${REV} ${TPCT}% → 100%)"
  gcloud run services update-traffic "$SERVICE" --region "$REGION" --to-revisions "$REV=100" --quiet >/dev/null
fi
RIMG=$(gcloud run revisions describe "$REV" --region "$REGION" --format='value(spec.containers[0].image)')
[ "${RIMG##*@}" = "$DIGEST" ] || die "서빙 digest 불일치 — 서빙 ${RIMG##*@} ≠ 빌드 $DIGEST (병렬 배포 레이스 의심)"
ENVN=$(gcloud run revisions describe "$REV" --region "$REGION" --format='value(spec.containers[0].env.len())')
LBL=$(gcloud run revisions describe "$REV" --region "$REGION" --format='value(metadata.labels.commit-sha)' 2>/dev/null || true)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$LIVE_URL")
[ "$HTTP" = 200 ] || die "라이브 HTTP $HTTP"

# 라우트 검증(L-52 + DB 왕복) — 화면 대신 서버 응답으로 판정한다. 외부 의존 4종은 이그레스
# 도미노(레이더 502 를 이틀 놓친 사고)를, health/db 는 DB 커넥션 이상(외부 4종은 전부
# 외부 API 경유라 DB 장애를 못 본다 — 2026-08-13 보완)을 잡는다. 실패는 경고만 — 배포는
# 이미 전환됐으므로 판단은 사람 몫이고, 아래 롤백 한 줄이 준비돼 있다.
ROUTE_FAIL=""
echo "라우트 검증 —"
for p in "radar" "typhoon" "weather?lat=35.16&lon=126.85" "disaster-msg?lat=35.16&lon=126.85" "health/db"; do
  RBODY=$(curl -s -m 25 "$LIVE_URL/api/$p" | head -c 40 || true)
  case "$RBODY" in
    '{"ok":true'*) printf '  %-14s ok\n' "${p%%\?*}" ;;
    *) printf '  %-14s ✖ %s\n' "${p%%\?*}" "$RBODY"; ROUTE_FAIL=1 ;;
  esac
done
[ -z "$ROUTE_FAIL" ] || echo "⚠ 라우트 검증 실패 항목 있음 — 원인 확인 후 필요 시 아래 롤백"

# CCTV 게이트 주소가 번들에 실렸는지 — 위의 HTTP 200·env 개수·라우트 검증으로는 원리적으로 안 보인다.
# 이 값은 빌드 때 번들에 박히므로(NEXT_PUBLIC_CAM03_GATE_API) 치환이 빠지면 런타임 env 에도 안 나오고
# 서버는 계속 200 을 낸다. 화면이 검게 나올 때까지 아무도 모른다(2026-09-18 반나절 · L-133).
# 배포를 되돌리지는 않는다 — 이미 나간 뒤라 판단은 사람이 한다. SKIP_CCTV_CHECK=1 로 건너뛴다.
CCTV_OUT=""; CCTV_RC=0
if [ "${SKIP_CCTV_CHECK:-0}" != "1" ]; then
  # ⛔ 2026-09-21 여기서 한 번 깨졌다 — $(dirname "$0") 는 상대경로라 위 `cd "$REPO"` 뒤에는
  #   레포 루트의 scripts/ 를 가리킨다(없다). 00404 배포에서 「No such file or directory」가
  #   결과 자리에 찍혔다. 절대경로 $SELFDIR 로 부른다.
  CCTV_OUT=$(sh "$SELFDIR/verify-cctv-bundle.sh" "$LIVE_URL" 2>&1) || CCTV_RC=$?
fi

say "완료"
echo "리비전   $REV (100%)"
echo "digest   $DIGEST (서빙 대조 일치)"
echo "commit   $SHA (라벨 ${LBL:-서비스에만 기록됨})"
echo "env      ${ENVN}개 (직전 ${PREV_ENVN}개 — 줄었으면 조사)"
echo "HTTP     200"
if [ "${SKIP_CCTV_CHECK:-0}" = "1" ]; then
  echo "CCTV번들 건너뜀 (SKIP_CCTV_CHECK=1)"
else
  echo "CCTV번들 $(echo "$CCTV_OUT" | head -1)"
  if [ "$CCTV_RC" -ne 0 ]; then
    echo "$CCTV_OUT" | tail -n +2 | sed 's/^/         /'
  fi
fi
# dirty 강행 사실은 0단계에서 한 번 보이지만 긴 빌드 로그에 묻힌다 — 요약에 다시 남긴다.
if [ -n "$DIRTY" ]; then
  echo "⚠ ALLOW_DIRTY 강행 — 아래 미커밋 변경은 이미지에 없다(검증은 아카이브에서 수행):"
  echo "$DIRTY" | sed 's/^/           /'
fi
# 롤백 원터치 — 비상시 검색 없이 복사-실행. latest 모드 전환(2026-08-13)으로 배포 즉시
# 트래픽이 넘어가므로, 되돌릴 좌표를 항상 손에 쥐고 있어야 한다.
if [ -n "${PREV_REV:-}" ] && [ "$PREV_REV" != "$REV" ]; then
  echo "롤백     gcloud run services update-traffic $SERVICE --region $REGION --to-revisions $PREV_REV=100"
  echo "         ⚠ 롤백은 트래픽을 고정(pinned)으로 되돌린다 — 사태 수습 후 자동 추종 복원은"
  echo "           gcloud run services update-traffic $SERVICE --region $REGION --to-latest"
  echo "           을 한 번 더. 안 하면 다음 배포부터 조용히 옛(고정) 동작으로 돌아간다."
fi

say "6/6 사후 관찰 90초 (latest 자동 전환 대응 — 새 리비전 런타임 감시)"
# pinned 시절의 "0% 검사 여유"가 사라진 대가를 여기서 지불한다 — 전환 직후 90초간
# 새 리비전의 5xx·DB 커넥션 타임아웃을 30초 간격 3회 관찰한다. 경고만 하고 죽지 않는다
# (이미 라이브 — 자동 롤백은 오탐 시 더 위험, 판단은 위 롤백 한 줄로 사람이).
OBS_WARN=""
for i in 1 2 3; do
  sleep 30
  FIVEXX=$(gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.revision_name=\"$REV\" AND httpRequest.status>=500" \
    --freshness=5m --format='value(httpRequest.status)' 2>/dev/null | grep -c . || true)
  DBTO=$(gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.revision_name=\"$REV\" AND \"Connection terminated due to connection timeout\"" \
    --freshness=5m --format='value(timestamp)' 2>/dev/null | grep -c . || true)
  echo "  [$((i*30))초] 5xx=${FIVEXX}건 · DB타임아웃=${DBTO}건"
  [ "${FIVEXX:-0}" -gt 0 ] && OBS_WARN=1
  # DB 타임아웃은 에피소드성 기저(시간당 0~4건)가 있어 5분 창 3건 초과만 경고(08-13 실측 기준).
  [ "${DBTO:-0}" -gt 3 ] && OBS_WARN=1
done
if [ -n "$OBS_WARN" ]; then
  echo "⚠ 사후 관찰 경고 — 새 리비전에서 5xx 또는 DB 타임아웃 초과. 로그 확인 후 필요 시 위 롤백 한 줄."
else
  echo "  사후 관찰 정상 — 5xx 0건 · DB 타임아웃 기저 범위"
fi
echo "남은 수동 단계 — 변경 기능 라이브 실측(브라우저) + harness/5-observability/run-log.md 기록"
