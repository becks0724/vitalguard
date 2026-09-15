# Orbbec Astra ROS2 이미지 토픽(color/ir)을 cctv-ai 인제스트로 푸시하는 엣지 스크립트 (관제웹 라이브 표출)
# 사용(라이브): CCTV_BASE=https://cctv-ai-....run.app INGEST=/cctv/ingest2 ROS_DOMAIN_ID=77 python3 orbbec_cctv_push.py
# 사용(자가검증): SAVE_ONLY=3 ROS_DOMAIN_ID=77 python3 orbbec_cctv_push.py  # /tmp 에 샘플 저장 후 종료
import os
import time
import urllib.request

import cv2
import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Image
from cv_bridge import CvBridge

TOPIC = os.environ.get("TOPIC", "/camera/color/image_raw")  # IR = /camera/ir/image_raw
CCTV_BASE = os.environ.get("CCTV_BASE", "").rstrip("/")
INGEST = os.environ.get("INGEST", "/cctv/ingest2")
PUSH_FPS = float(os.environ.get("PUSH_FPS", "5"))
SAVE_ONLY = int(os.environ.get("SAVE_ONLY", "0"))  # >0 = 로컬 프레임 N장 저장 후 종료(과금 0)
RUN_SEC = float(os.environ.get("RUN_SEC", "0"))  # >0 = N초 후 자동 종료(0 = 무한)
W, H = 640, 360  # ingest2 계약 해상도(서버도 리사이즈하지만 전송량 절약)

bridge = CvBridge()


class Pusher(Node):
    def __init__(self) -> None:
        super().__init__("orbbec_cctv_push")
        # 카메라 이미지 토픽은 BEST_EFFORT(sensor_data) QoS — 기본 RELIABLE 로 구독하면 정합 실패로 무수신
        self.create_subscription(Image, TOPIC, self.on_img, qos_profile_sensor_data)
        self.interval = 1.0 / PUSH_FPS
        self.last = 0.0
        self.sent = 0
        self.done = False
        self.get_logger().info(f"subscribe {TOPIC} -> {'SAVE' if SAVE_ONLY else INGEST} @ {PUSH_FPS}fps")

    def on_img(self, msg: Image) -> None:
        now = time.time()
        if now - self.last < self.interval:
            return  # 수신은 계속, 푸시만 스로틀
        self.last = now
        # 인코딩에 맞춰 BGR 3채널로 변환 (IR mono8 포함)
        if msg.encoding in ("mono8", "8UC1"):
            img = bridge.imgmsg_to_cv2(msg, desired_encoding="mono8")
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        else:
            img = bridge.imgmsg_to_cv2(msg, desired_encoding="bgr8")
        img = cv2.resize(img, (W, H))
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return

        if SAVE_ONLY:
            path = f"/tmp/orbbec_sample_{self.sent}.jpg"
            with open(path, "wb") as f:
                f.write(buf.tobytes())
            self.get_logger().info(
                f"saved {path} bytes={int(buf.size)} mean_brightness={float(img.mean()):.1f}"
            )
            self.sent += 1
            if self.sent >= SAVE_ONLY:
                self.done = True
            return

        req = urllib.request.Request(
            CCTV_BASE + INGEST, data=buf.tobytes(), headers={"Content-Type": "image/jpeg"}, method="POST"
        )
        try:
            urllib.request.urlopen(req, timeout=4).read()
            self.sent += 1
            if self.sent % 25 == 1:
                self.get_logger().info(f"pushed {self.sent} -> {INGEST}")
        except Exception as e:
            self.get_logger().warn(f"POST fail: {e}")


def main() -> None:
    if not SAVE_ONLY and not CCTV_BASE:
        raise SystemExit("[orbbec-push] 라이브 모드는 CCTV_BASE 환경변수 필요")
    rclpy.init()
    node = Pusher()
    deadline = time.time() + RUN_SEC if RUN_SEC > 0 else None
    try:
        # spin_once 루프 = 매 0.2s 파이썬 복귀 → SIGTERM/데드라인으로 확실히 종료 가능
        while rclpy.ok() and not node.done:
            rclpy.spin_once(node, timeout_sec=0.2)
            if deadline and time.time() > deadline:
                node.get_logger().info(f"deadline {RUN_SEC}s reached, exit (sent={node.sent})")
                break
    except KeyboardInterrupt:
        pass
    finally:
        try:
            node.destroy_node()
        except Exception:
            pass
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
