#!/usr/bin/env bash
# 엣지 코드를 젯슨에 배포하고 build 표식을 심는다 — 심는 것을 사람이 빠뜨릴 수 없게 한다
#
# ★ 09-14 신설. 세 가지를 절차로 고정한다.
#   ① 파일 목록을 **열거로** 뽑는다 — 손으로 적으면 그 순간부터 낡는다(09-14 실사고: 5개 목록에
#      pose_fall.py 가 없어 「엣지 격차 전부 닫혔다」가 거짓이었다).
#   ② 배포마다 .build 에 git commit 을 심는다 — 없으면 관측이 어느 코드에서 나왔는지 사후에 못 밝힌다.
#   ③ md5 대조 + 합 검산 — 개수가 안 맞으면 멈춘다.
#
# 사용: bash deploy_edge.sh [파일...]      (인자 없으면 커밋된 엣지 .py 전부)
set -euo pipefail

HOST="${EDGE_HOST:-jetson@yahboom-1}"
DEST="${EDGE_DEST:-~/vg_edge_poc}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ $# -gt 0 ]; then
  FILES=("$@")                          # 새 파일을 처음 올릴 때는 명시한다
else
  # ① 열거 — 손 목록을 쓰지 않는다.
  #   ⚠ 기본은 「저장소 전부」가 아니라 **양쪽에 이미 있는 것**이다. 저장소에는 맥에서만 돌리는
  #     도구(mjpeg_lag.py 등)도 있어서, 전부 밀면 젯슨에 안 쓰는 파일이 쌓이고 대조 기준이 흐려진다.
  #   ⚠ mapfile 은 bash 4+ 다. macOS 기본은 3.2 라 while 로 받는다(bash -n 은 이걸 못 잡는다).
  git -c core.quotepath=false ls-tree -r --name-only HEAD -- "$HERE" \
    | xargs -n1 basename | sort > /tmp/.edge_repo
  # ⚠ ls 는 매칭 0건이면 exit 2 다. 2>/dev/null 은 stderr 만 숨기고 exit code 는 남아
  #   pipefail 이 그걸 잡아 스크립트가 조용히 죽는다(출력 0줄 · exit 2). || true 로 닫는다.
  ssh "$HOST" "ls $DEST/*.py $DEST/*.sh 2>/dev/null || true" | xargs -n1 basename | sort > /tmp/.edge_jetson
  [ -s /tmp/.edge_jetson ] || { echo "⛔ 젯슨 열거가 0건 — 경로나 접속을 확인하라"; exit 1; }
  FILES=()
  while IFS= read -r line; do
    [ -z "$line" ] && continue          # 빈 줄 방어 — 계수가 조용히 흔들린다
    FILES+=("$line")
  done < <(comm -12 /tmp/.edge_repo /tmp/.edge_jetson)
fi
[ ${#FILES[@]} -gt 0 ] || { echo "⛔ 배포 대상이 0개다 — 열거가 실패했다"; exit 1; }
echo "배포 대상 ${#FILES[@]}개: ${FILES[*]}"

sent=0
for f in "${FILES[@]}"; do
  [ -f "$HERE/$f" ] || { echo "⛔ 저장소에 없다: $f"; exit 1; }
  scp -q "$HERE/$f" "$HOST:$DEST/$f"
  sent=$((sent + 1))
done

# ② build 표식 — 배포한 그 순간의 commit 을 심는다
COMMIT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DIRTY=""
git diff --quiet HEAD -- "$HERE" || DIRTY=" (미커밋 변경 있음)"
ssh "$HOST" "cat > $DEST/.build" <<EOF
{"commit": "$COMMIT", "branch": "$BRANCH", "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
echo "build 표식: commit=$COMMIT branch=$BRANCH$DIRTY"

# ③ md5 대조 + 합 검산
ok=0
for f in "${FILES[@]}"; do
  L="$(md5 -q "$HERE/$f" 2>/dev/null || md5sum "$HERE/$f" | cut -d' ' -f1)"
  R="$(ssh "$HOST" "md5sum $DEST/$f 2>/dev/null | cut -d' ' -f1")"
  if [ "$L" = "$R" ]; then ok=$((ok + 1)); else echo "  ⛔ 불일치 $f"; fi
done
echo "대조 $ok/$sent"
[ "$ok" -eq "$sent" ] || { echo "⛔ 합이 안 맞는다 — 배포 실패"; exit 1; }
echo "✅ 배포·대조 완료 — 푸셔 재시작이 필요하면 따로 한다"
cat <<'HOWTO'

── 재시작이 필요하면
   ⚠ 09-15 정정 — 여기 적었던 「& 를 밖에 두면 SSH 가 죽인다」는 **근거가 무너졌다.**
     그때 푸셔가 사라진 진짜 이유는 [M/L] 세션이 엔진 빌드를 위해 **의도적으로 내린 것**이었고
     (14:06:57 정지 · 사용자 승인), 내 SSH 세션 종료와 시각이 겹쳐 내가 오진했다.
     ★ 그러니 **먼저 옆 세션에 확인한다.** 엣지는 세션 셋이 공유하는 단일 자원이다.
     아래 ①~④ 는 그 자체로는 여전히 옳은 절차이므로 남긴다 — 다만 ③의 이유는
     「SSH 가 죽이더라」가 아니라 「부모에 매달지 않는 것이 표준」이다(PPID 1 확인은 유효).
   ① GoPro 가 스트리밍 중인지 먼저 본다. status 2 면 재시작이 카메라를 안 건드린다
        ssh jetson@yahboom-1 'curl -s --max-time 6 http://172.23.102.51:8080/gopro/webcam/status'
   ② PID 를 명시해 끊는다 — pgrep/pkill 패턴은 자기 자신을 잡는다
        ssh jetson@yahboom-1 'pgrep -f "python3 gopro_ppe_edge.py"'
        ssh jetson@yahboom-1 'kill <PID>'            # kill 과 start 는 **별도 호출**
   ③ ★ 반드시 이 형식으로 띄운다 — & 를 서브셸 **안**에 두어 부모를 즉시 끊는다
        ssh -n jetson@yahboom-1 'cd ~/vg_edge_poc && (setsid env POSE_FALL=1 POSE_LOG=1           nohup python3 gopro_ppe_edge.py >> gopro_edge.log 2>&1 </dev/null &) ; sleep 3 ;           pgrep -f "python3 gopro_ppe_edge.py"'
      ⚠ `setsid nohup ... &` 처럼 & 를 밖에 두면 SSH 가 반환을 못 해 호출이 매달린다.
        (그것이 프로세스를 죽인다는 주장은 09-15 에 **검증되지 않았다** — 위 정정 참조)
   ④ 확인 = ps 의 PPID 가 1 이어야 한다(init 입양) · **그리고 옆 세션에 「내가 띄웠다」를 알린다**
        ssh -n jetson@yahboom-1 'ps -eo pid,ppid,cmd | grep gopro_ppe_edge | grep -v grep'
HOWTO
