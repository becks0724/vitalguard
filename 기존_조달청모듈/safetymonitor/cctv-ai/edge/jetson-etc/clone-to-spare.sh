#!/bin/bash
# 예비 젯슨(2호기)을 기존 젯슨과 같게 만든다 — 기존 젯슨에서 실행한다.
# ⛔ 서비스는 켜지 않는다. 예비기는 꺼 둔 채로 두고 필요할 때 사람이 올린다.
set -u
TARGET="${1:-}"
[ -n "$TARGET" ] || { printf '⛔ 대상을 적어야 한다.  사용법: %s jetson@<주소>\n' "$0" >&2; exit 1; }
SRC_HOME="$HOME"
say() { printf '\n=== %s ===\n' "$1"; }
die() { printf '⛔ %s\n' "$1" >&2; exit 1; }

say "0. 접속 확인"
ssh -o BatchMode=yes -o ConnectTimeout=6 "$TARGET" true 2>/dev/null \
  || die "열쇠 접속이 안 된다. 먼저 ssh-copy-id 로 열쇠를 심어야 한다."
echo "  ok $TARGET"

# ⛔ 자기 자신에게 쏘면 --delete 로 원본이 망가진다.
#    ⚠ 식별자로 가르면 안 된다 — 두 대 다 호스트명이 yahboom 이고,
#      /etc/machine-id 까지 같다(제조사가 같은 이미지로 구웠다 · 09-18 실측
#      양쪽 5dbfb12414a3456d9014d88183e338b1). 그래서 표식을 하나 만들어 직접 본다.
MARK="$HOME/.clone-selfcheck.$$-${RANDOM}"
: > "$MARK"
if ssh "$TARGET" "test -e '$MARK'" 2>/dev/null; then
  rm -f "$MARK"
  die "대상이 이 기계 자신이다($TARGET). --delete 가 원본을 망가뜨린다."
fi
rm -f "$MARK"
echo "  대상 확인 $(ssh "$TARGET" 'hostname; hostname -I | awk "{print \$1}"' 2>/dev/null | paste -sd" " -)"

say "1. 젯팩 판 대조 — 다르면 엔진이 확실히 안 돈다"
HERE=$(head -1 /etc/nv_tegra_release)
THERE=$(ssh "$TARGET" 'head -1 /etc/nv_tegra_release' 2>/dev/null)
printf '  기존 %s\n  예비 %s\n' "$HERE" "$THERE"
HR=$(sed -n 's/.*R\([0-9]*\).*REVISION: \([0-9.]*\).*/\1-\2/p' <<<"$HERE")
TR=$(sed -n 's/.*R\([0-9]*\).*REVISION: \([0-9.]*\).*/\1-\2/p' <<<"$THERE")
if [ "$HR" = "$TR" ]; then
  # ⚠ 09-18 실측 — 이 판정만으로는 부족하다. 두 젯슨이 같은 L4T($HR)인데도 2호기에서
  #    TensorRT 가 「Using an engine plan file across different models of devices」를 냈다.
  #    L4T 판이 같아도 엔진에는 **구운 기기의 지문**(compute capability · SM 수 · 메모리 ·
  #    TensorRT/드라이버 판)이 박히기 때문이다. 경고는 기동 로그 안쪽에 파묻혀 누구도 못 봤고
  #    화면은 멀쩡히 나왔다. ⟹ 여기서 단정하지 않고 **아래 3-1 에서 대상에 물어본다**.
  #
  #    ⛔ 자기정정(09-18) — 같은 날 있었던 「추론 14ms → 32ms, 딱 2배」는 **이 경고 탓이 아니었다.**
  #    엔진을 2호기에서 다시 구워 경고가 2건 → 0건이 됐는데도 추론은 32~33ms 그대로였다
  #    ([CCTV/ML] 실측). 진짜 원인은 GPU 클럭이었다 — 2호기 GPU 가 306MHz 로 눌려 있었고
  #    1호기는 1020MHz 로 고정돼 있었다(09-07 에 jetson-clocks.service 를 박아 둔 것).
  #    `jetson_clocks` 적용 후 32ms → 17ms · 9.8fps → 25fps 로 1호기와 같아졌다.
  #    ★ 두 결함이 같은 날 같은 기계에 겹쳐 있었을 뿐이다. 경고를 고쳐도 속도는 안 돌아온다.
  #    ⟹ 속도 쪽은 **아래 3-2 가 따로 잰다.** 하나로 묶어 읽으면 또 틀린다.
  echo "  L4T 같다($HR) — 엔진을 복사해 보고 **3-1 에서 대상이 받아들이는지 확인한다**"
  COPY_ENGINE=1
else
  echo "  ⚠ 다르다($HR vs $TR) — 엔진(.engine)은 복사하지 않는다."
  echo "    .pt 만 옮기고 예비기에서 다시 만들어야 한다."
  COPY_ENGINE=0
fi

say "2. 작업 폴더 복사 (16MB · 캐시 제외)"
# ⛔ --delete 는 대상에서 원본에 없는 파일을 지운다. 먼저 헛돌려 무엇이 지워지는지 센다.
#    [WATCH.APP] 지적(09-18) — 대상을 잘못 넣으면 그 기계의 코드가 원본과 같아진다.
DEL=$(rsync -a --delete --dry-run --exclude '__pycache__' --exclude '*.pyc' \
        "$SRC_HOME/vg_edge_poc/" "$TARGET:~/vg_edge_poc/" 2>/dev/null | grep -c '^deleting ' || true)
if [ "${DEL:-0}" -gt 0 ]; then
  echo "  ⚠ 대상에서 $DEL 개가 지워진다:"
  rsync -a --delete --dry-run --exclude '__pycache__' --exclude '*.pyc' \
    "$SRC_HOME/vg_edge_poc/" "$TARGET:~/vg_edge_poc/" 2>/dev/null | grep '^deleting ' | head -10 | sed 's/^/     /'
  [ "${ALLOW_DELETE:-0}" = "1" ] \
    || die "지울 것이 있으면 멈춘다. 목록을 확인하고 ALLOW_DELETE=1 로 다시 실행한다."
  echo "  ALLOW_DELETE=1 — 진행한다"
fi
rsync -a --delete --exclude '__pycache__' --exclude '*.pyc' \
  "$SRC_HOME/vg_edge_poc/" "$TARGET:~/vg_edge_poc/" || die "vg_edge_poc 복사 실패"
echo "  ok  $(ssh "$TARGET" 'ls ~/vg_edge_poc | wc -l') 항목"

say "3. 모델·글꼴 복사"
if [ "$COPY_ENGINE" = "1" ]; then
  FILES=(ppe_yolo26s_rect544x960_v7e_nc.engine ppe_yolo26s_rect544x960_v7e_nc.pt)
else
  FILES=(ppe_yolo26s_rect544x960_v7e_nc.pt)
fi
# ★ 09-18 글꼴을 여기 더한 이유 — 2호기에 이 파일이 없어 화면 라벨이 전부 □□□□ 로 나갔다.
#   코드는 못 찾으면 조용히 영문 기본 글꼴로 떨어진다(ImageFont.load_default). 로그에 아무것도
#   안 남고 검출·박스는 멀쩡하므로 **사람이 화면을 봐야만 드러난다.** 복제 목록에서 빠지면 재발한다.
FILES+=(NanumGothic-Regular.ttf)
MISSING=0
for f in "${FILES[@]}"; do
  if [ -f "$SRC_HOME/$f" ]; then
    rsync -a "$SRC_HOME/$f" "$TARGET:~/" && echo "  ok $f"
  else
    echo "  ⚠ 원본에 없다: $f"; MISSING=$((MISSING+1))
  fi
done
# 옮겼다고 끝이 아니다 — 대상에 실제로 있는지 되묻는다(「보냈다」≠「있다」)
for f in "${FILES[@]}"; do
  ssh "$TARGET" "test -s ~/'$f'" || { echo "  ⛔ 대상에 없다: $f"; MISSING=$((MISSING+1)); }
done
[ "$MISSING" -eq 0 ] || echo "  ⚠ 빠진 것 $MISSING 개 — 위 목록을 손으로 채운 뒤 서비스를 켠다"
ssh "$TARGET" 'mkdir -p ~/ultralytics/ultralytics'
P=~/ultralytics/ultralytics
if [ "$COPY_ENGINE" = "1" ]; then
  rsync -a "$P/yolo11s-pose.engine" "$TARGET:~/ultralytics/ultralytics/" && echo "  ok yolo11s-pose.engine"
fi
rsync -a "$P/yolo11s-pose.pt" "$TARGET:~/ultralytics/ultralytics/" && echo "  ok yolo11s-pose.pt"

say "3-1. ★ 복사한 엔진을 대상이 실제로 받아들이나 (추론 말고 관측)"
# 09-18 사고 — 1단계의 L4T 대조를 통과했는데도 엔진이 남의 기계 것이라 절반 속도로 돌았다.
# TensorRT 는 엔진을 열 때 스스로 답을 안다. 그 답을 읽는다.
if [ "$COPY_ENGINE" = "1" ]; then
  # ⚠ ssh 가 죽어도 0 이 나오면 「경고 없음」으로 읽힌다 — 못 잰 것과 괜찮은 것이 같은 값이 된다.
  #    그래서 종료 상태를 따로 받는다(오늘 여러 번 걸린 자리다).
  WARN=$(ssh "$TARGET" 'cd ~ && python3 - <<PYEOF 2>&1 | grep -c "across different models" || true
import os
os.environ["YOLO_VERBOSE"]="False"
from ultralytics import YOLO
for f in ("ppe_yolo26s_rect544x960_v7e_nc.engine", "ultralytics/ultralytics/yolo11s-pose.engine"):
    if os.path.exists(os.path.expanduser("~/"+f)):
        try: YOLO(os.path.expanduser("~/"+f))
        except Exception as e: print(e)
PYEOF')
  RC=$?
  if [ "$RC" -ne 0 ] || [ -z "$WARN" ]; then
    echo "  ⚠ 못 쟀다 (ssh 종료 $RC) — 「경고 없음」이 아니다. 대상에서 손으로 확인할 것"
  elif [ "$WARN" -gt 0 ]; then
    echo "  ⛔ 대상이 「across different models」 경고를 냈다 ($WARN 건)"
    echo "     복사한 .engine 은 **이 기계 것이 아니다.** 그대로 두면 조용히 절반 속도로 돈다."
    echo "     할 일 — 대상에서 .pt 로 다시 굽는다. 그때까지 서비스를 켜지 않는다."
  else
    echo "  ✅ 경고 없음 — 복사한 엔진을 그대로 써도 된다"
  fi
else
  echo "  ⏸ 엔진을 안 옮겼다(.pt 만) — 대상에서 굽는 것이 원래 계획이다"
fi

say "3-2. ★ 대상의 GPU 클럭이 고정돼 있나 (09-18 — 추론 2배의 진짜 원인)"
# 1호기에는 jetson-clocks.service 가 있고(09-07 설치) 2호기 복제에는 이것이 빠졌다.
# 빠지면 GPU 가 DVFS 로 306MHz 까지 내려가 추론이 2배 느려지는데 **로그에는 아무것도 안 남는다.**
# 판별 기준 = min_freq 와 max_freq 가 같은가. jetson_clocks 가 하는 일이 정확히 min 을 max 로 올리는 것이다.
#   ⚠ cur_freq 로 보면 안 된다 — 놀고 있는 기계는 고정돼 있어도 cur 가 낮게 나온다.
#   실측 근거 = [CCTV/ML] 09-18. 1호기 Min=Max=Cur 1020MHz(14ms) · 2호기 Min 306·Cur 306(32ms).
GPUINFO=$(ssh "$TARGET" 'for d in /sys/class/devfreq/*.gpu; do
  [ -d "$d" ] || continue; echo "$(cat $d/min_freq) $(cat $d/max_freq)"; done' 2>/dev/null)
GRC=$?
UNIT=$(ssh "$TARGET" 'systemctl is-enabled jetson-clocks.service 2>/dev/null' 2>/dev/null || true)
if [ "$GRC" -ne 0 ] || [ -z "$GPUINFO" ]; then
  # ⚠ 못 쟀을 때 조용히 넘어가면 「문제 없음」으로 읽힌다. 못 쟀다고 말한다.
  echo "  ⚠ 못 쟀다 (ssh 종료 $GRC) — 「고정돼 있다」가 아니다."
  echo "     대상에서 손으로: sudo jetson_clocks --show"
else
  GMIN=$(awk '{print $1; exit}' <<<"$GPUINFO")
  GMAX=$(awk '{print $2; exit}' <<<"$GPUINFO")
  printf '  GPU min %s · max %s · jetson-clocks.service %s\n' "$GMIN" "$GMAX" "${UNIT:-없음}"
  if [ "$GMIN" = "$GMAX" ]; then
    echo "  ok 최대로 고정돼 있다"
  else
    echo "  ⛔ 눌려 있다 — 이대로 투입하면 추론이 2배 느리다. 화면은 멀쩡해 보인다."
    echo "     지금만    ssh $TARGET 'sudo jetson_clocks'"
    echo "     재부팅 뒤에도  기존기의 /etc/systemd/system/jetson-clocks.service 를 옮기고 enable"
  fi
  [ "$UNIT" = "enabled" ] || echo "  ⚠ 유닛이 없다/꺼져 있다 — 재부팅하면 다시 눌린다"
fi

say "4. 파이썬 꾸러미 대조 (설치는 사람이 판단)"
for p in ultralytics flask opencv-python numpy requests; do
  A=$(python3 -c "import importlib.metadata as m;print(m.version('$p'))" 2>/dev/null || echo 없음)
  B=$(ssh "$TARGET" "python3 -c \"import importlib.metadata as m;print(m.version('$p'))\"" 2>/dev/null || echo 없음)
  [ "$A" = "$B" ] && S="같음" || S="⚠ 다름"
  printf '  %-16s 기존 %-12s 예비 %-12s %s\n' "$p" "$A" "$B" "$S"
done

say "5. 서비스 파일 (설치만 · 켜지 않음)"
echo "  ⏸ 건너뛴다 — 저장소 jetson-etc/README.md 의 되살리기 명령을 사람이 실행한다."
echo "     예비기를 실제로 투입할 때 하면 된다. 미리 깔면 잘못 켜질 위험이 있다."

say "6. ⛔ 사람이 직접 옮겨야 하는 것 (여기서 안 만진다)"
for f in .cctv_ingest.env .cam1_pusher.env .cam1_rtsp_cred .duckdns_token; do
  [ -e "$SRC_HOME/$f" ] && printf '  %s\n' "$f"
done
echo "  Tailscale — 예비기에서 따로 가입(sudo tailscale up)"

say "완료"
echo "  예비기는 지금 꺼져 있는 상태다(서비스 미설치). 이것이 의도한 상태다."
