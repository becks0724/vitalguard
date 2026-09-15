# PPE 엔진과 포즈 엔진을 한 프레임에 같이 돌렸을 때의 비용을 재는 측정기 (낙상 트랙 타당성 판정용)
"""
PPE(yolo26s 960) 단독 · 포즈(yolo11n 640) 단독 · 둘 동시 를 각각 재서, 12 fps 파이프라인에서
GPU 예산(1/12초 = 83.3 ms)의 몇 %를 쓰는지 보여 준다. 낙상을 같은 젯슨에 얹을 수 있는지의 판정 근거다.

사용:  python3 bench_ppe_pose.py [PPE엔진] [포즈엔진] [PPE imgsz] [포즈 imgsz]
★ 고정형상 엔진은 imgsz 를 구운 형상과 **똑같이** 줘야 한다. v5 는 직사각(544x960) 이므로
  "544,960" 처럼 넘긴다. 960 하나만 주면 960x960 이 되어 assert 로 죽는다.
⚠ 푸셔가 돌고 있으면 GPU 를 나눠 쓰므로 값이 보수적으로 나온다. 무부하에서 재는 것이 정확하다.
"""
import statistics
import sys
import time

import numpy as np
from ultralytics import YOLO

PPE = sys.argv[1] if len(sys.argv) > 1 else "/home/jetson/ppe_yolo26s_rect544x960_v5_nc.engine"
POSE = sys.argv[2] if len(sys.argv) > 2 else "/home/jetson/ultralytics/ultralytics/yolo11n-pose.engine"


def _imgsz(v, default):
    """"544,960" → [544,960] · "640" → 640. 고정형상 엔진과 형상을 맞추기 위한 것이다."""
    if not v:
        return default
    parts = [int(x) for x in v.split(",")]
    return parts if len(parts) > 1 else parts[0]


PPE_SZ = _imgsz(sys.argv[3] if len(sys.argv) > 3 else None, [544, 960])
POSE_SZ = _imgsz(sys.argv[4] if len(sys.argv) > 4 else None, 640)
ITER, WARM, BUDGET = 60, 10, 1000.0 / 12   # 12 fps → 프레임당 83.3 ms

frame = (np.random.rand(540, 960, 3) * 255).astype(np.uint8)
ppe = YOLO(PPE, task="detect")
pose = YOLO(POSE, task="pose")


def run(models, imgszs):
    for _ in range(WARM):
        for m, z in zip(models, imgszs):
            m.predict(frame, imgsz=z, verbose=False)
    walls = []
    for _ in range(ITER):
        t = time.perf_counter()
        for m, z in zip(models, imgszs):
            r = m.predict(frame, imgsz=z, verbose=False)[0]
        walls.append((time.perf_counter() - t) * 1000)
    return walls, r


def show(name, walls):
    mean = statistics.mean(walls)
    print(f"{name:22s} {mean:6.2f} ms  (p95 {sorted(walls)[int(len(walls) * 0.95) - 1]:6.2f})"
          f"   12fps 예산의 {mean / BUDGET * 100:5.1f}%")


print(f"PPE  = {PPE.split('/')[-1]} @ {PPE_SZ}\n포즈 = {POSE.split('/')[-1]} @ {POSE_SZ}\n프레임 960x540 · {ITER}회 · 예산 {BUDGET:.1f} ms\n")
w_ppe, _ = run([ppe], [PPE_SZ])
w_pose, r = run([pose], [POSE_SZ])
w_both, _ = run([ppe, pose], [PPE_SZ, POSE_SZ])
show("PPE 단독", w_ppe)
show("포즈 단독", w_pose)
show("PPE + 포즈 동시", w_both)
k = r.keypoints
print(f"\n포즈 출력 = 사람 {0 if k is None else k.data.shape[0]}명 · 키포인트 {'-' if k is None else k.data.shape[1]}개")
print(f"동시 구동 추가분 = {statistics.mean(w_both) - statistics.mean(w_ppe):.2f} ms")
