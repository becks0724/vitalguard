# 포즈 키포인트로 작업자 자세를 standing/unstable/lying/fallen 으로 판정하는 모듈 (낙상 1단계 · 규칙 기반)
"""
근거 = ml/ppe-detection/PPE-낙상-통합-리서치.md §3.

★ 2단 구조다. 관절이 보이면 표준 특징을 쓰고, 안 보이면 어깨로 물러선다.
  A단 = 어깨+엉덩이 → **몸통 기울기**(엉덩이→어깨 벡터가 수직에서 몇 도). 서있음 0 · 누움 90 · 뒤집힘 180.
        다리(무릎·발목)가 함께 보이면 **하체 기울기**로 교차 확인한다.
  B단 = 어깨만 → **낙하 속도만** 본다. 자세를 선언하지 않는다 — 낙하가 없으면 `unknown` 이다.
        떨어지지 않은 것과 정상인 것은 다르다(부재 ≠ 음성).
  판정에 쓴 단수를 `tier` 로 함께 내보낸다 — 어느 근거로 내린 판정인지 모르면 오탐을 못 고친다.
  09-08 수업 중 실측은 엉덩이 20% · 발목 10% 였으나 쉬는 시간에 사람들이 서서 움직이면 A단이 열린다.

★ 09-08 10:55 정정 — B단에서 박스 종횡비와 어깨선 기울기로 누움을 선언하던 것을 걷어냈다.
  실측에서 누움 14건이 **전부 B단**이었고 육안 확인 결과 자세가 아니라 화각 때문이었다.
    · 종횡비 1.24~1.39 = 카메라 앞 착석자의 **상반신만 잡힌 박스**(가로가 세로보다 길다). 누운 게 아니다.
    · 어깨선 기울기 ≥45° = **옆을 본 사람**의 어깨가 겹쳐 보여 생긴 것. 자세가 아니라 시선 방향이다.
  엉덩이 없이는 누운 사람과 잘린 상반신을 구별할 수 없다. **못 하는 판정을 하지 않는다.**
  → 종횡비는 판정에서 완전히 뺐다(진단용으로만 내보낸다). B단의 낙상은 지속되는 `unstable` 로 나타난다.

★ 경보를 내지 않는다. 오탐을 세기 위한 1단계다. 임계는 실측 뒤에 조인다.
★ 판정 못 한 것을 "정상"으로 적지 않는다(fusion 설계 원칙 2 — 부재 ≠ 음성).
★ `standing` 의 표기는 "서있음" 이 아니라 **"직립"** 이다. 몸통만 재므로 앉은 사람과 선 사람을
  구별하지 못한다(무릎 관측률 4.1% · 09-08 실측). 앉아 있어도 몸통이 서 있으면 직립이고, 그것이
  낙상 판정에 필요한 전부다.

상태 도메인은 docs/fusion/artifacts/fusion-design.md §1.1 계약을 그대로 따른다.
"""

import hashlib
import json
import math
import os
import time
from collections import deque

# 임계 — 전부 환경변수로 조절한다. 실측 전이라 확정값이 아니다.
# ⚠ 종횡비·어깨선 기울기는 09-08 실측에서 오탐 전량의 원인이라 판정에서 뺐다(진단 출력용으로만 남긴다).
DROP_RATE = float(os.environ.get("POSE_DROP_RATE", "0.15"))         # 프레임 높이 대비 초당 하강율
DROP_WINDOW = float(os.environ.get("POSE_DROP_WINDOW", "1.0"))      # 낙하를 보는 시간 창(초)
KP_CONF = 0.5                # 키포인트 신뢰 임계 — 어깨·엉덩이(낙상 판정 경로)는 이 값을 지킨다
# 무릎은 책상에 자주 가려 0.5 로 자르면 관측률이 28% 로 떨어진다. 그런데 모델은 가려진 무릎도
# 몸 구조로 추정해 낮은 신뢰도로 내놓고, 그 값이 쓸 만하다(09-08 실측 · 문턱 0.3 이면 판정 가능
# 35.2 → 58.5% 인데 앉음 정확도는 92 → 90% 로 거의 그대로). 낙상 축과 분리해 무릎만 완화한다.
KP_CONF_KNEE = float(os.environ.get("POSE_KP_CONF_KNEE", "0.30"))
TORSO_UP = float(os.environ.get("POSE_TORSO_UP", "35"))     # 몸통이 수직에서 이 안이면 직립
TORSO_DOWN = float(os.environ.get("POSE_TORSO_DOWN", "65")) # 이 밖이면 누운 쪽
# 앉음·서있음은 허벅지(엉덩이→무릎)로 가른다. 무릎이 보일 때만 성립한다.
THIGH_STAND = float(os.environ.get("POSE_THIGH_STAND", "35"))  # 허벅지가 수직에 가까우면 서 있다
THIGH_SIT = float(os.environ.get("POSE_THIGH_SIT", "55"))      # 수평에 가까우면 앉아 있다
# 부감 화각에서 허벅지가 카메라 쪽을 향하면 짧게 눌려 보이고, 그때 각도는 우연히 수직에 가까워진다.
# 그래서 각도만으로 "서있음"을 선언하지 않고 허벅지가 실제 허벅지 길이인지 함께 본다.
# ★ 09-08 16:40 정정 — 0.80 은 실제 보행자 5명을 전부 걷어냈다(실측 눌림 0.61~0.74).
#   "선 사람은 허벅지가 몸통만큼 길어 보인다" 는 해부학 추론이 부감 화각에서 틀렸다.
#   선 사람도 위에서 내려다보면 허벅지가 눌린다 — 앉은 사람보다 덜 눌릴 뿐이다.
# ★ 09-08 17:05 확정 — 사용자가 직접 151초 서서 찍은 489 사람-프레임으로 교환비를 재고 0.55 로.
#   0.60 회수 66% / 오탐 0.85%   0.55 회수 87% / 오탐 2.48%   0.50 회수 92% / 오탐 6.60%
#   0.55 가 무릎점이다 — 0.60→0.55 는 회수 +21%p 에 오탐 +1.6%p, 그다음은 +5%p 에 +4.1%p.
#   ⚠ 서있음 표본은 아직 한 사람·한 자리·한 번이다. 사람이나 자리가 바뀌면 다시 잰다.
THIGH_LEN_MIN = float(os.environ.get("POSE_THIGH_LEN_MIN", "0.55"))  # 허벅지길이 / 몸통길이
# 걷기는 순간 속도가 아니라 **자취**로 본다. 09-08 16:40 실측 — 확인된 보행자 5명과 착석자를
# 가르는 힘이 자취 쪽이 압도적이었다(오검 0.196% vs 허벅지 눌림 3.26%). 자취는 관절을 안 쓰므로
# 무릎이 가려도 성립한다는 이점도 있다.
WALK_WINDOW = float(os.environ.get("POSE_WALK_WINDOW", "3.0"))   # 자취를 보는 시간 창(초)
WALK_SPAN = float(os.environ.get("POSE_WALK_SPAN", "0.20"))      # 창 안 두 점 사이 최대 거리
WALK_PROG = float(os.environ.get("POSE_WALK_PROG", "0.30"))      # 한 걸음 최대 점프 / 자취
# 서있음은 기하가 이만큼 이어져야 적는다. 착석자의 가짜 서있음은 깜빡이고(중앙 0.34초)
# 진짜 선 사람은 몇 초씩 서 있다 — 1.5초를 걸면 가짜가 266개에서 27개로 준다(09-08 실측).
STAND_HOLD = float(os.environ.get("POSE_STAND_HOLD", "1.5"))
# COCO 17 키포인트 인덱스
L_SH, R_SH = 5, 6            # 어깨
L_HIP, R_HIP = 11, 12        # 엉덩이
L_KNEE, R_KNEE = 13, 14      # 무릎
L_ANK, R_ANK = 15, 16        # 발목
JOINTS = {"shoulder": (L_SH, R_SH), "hip": (L_HIP, R_HIP),
          "knee": (L_KNEE, R_KNEE), "ankle": (L_ANK, R_ANK)}
# ★ 09-14 0.8 → 0.5. 143.88시간·사람프레임 283만 sweep 실측 —
#   가까운 거리 연출 낙상 검출 0 → 2건, 오탐 0.79 → 0.99건/시간(+0.2).
#   0.4초까지 내려도 검출은 안 늘고 오탐만 는다(1.01) — 0.5가 무릎점이다.
FALL_HOLD = float(os.environ.get("POSE_FALL_HOLD", "0.5"))   # 수평 자세가 이만큼 이어져야 낙상/누움
FALL_WINDOW = float(os.environ.get("POSE_FALL_WINDOW", "2.5"))  # 직전 낙하를 낙상 근거로 인정하는 창(초)
# ★ 09-15 실험 스위치. B단(엉덩이를 못 봐 자세를 못 재는 프레임)에서 수평 타이머를 지우면
#   「모름」이 「수평 아님」이 된다 — B단 주석이 "자세를 선언하지 않는다" 라고 적어 둔 것과 모순이다.
#   기본값 0 = 현행 거동 그대로(지운다). 1 이면 타이머를 유지한다. 상한은 TRACK_TTL 이 이미 준다.
HOLD_ON_UNKNOWN = os.environ.get("POSE_HOLD_ON_UNKNOWN", "0") == "1"
MATCH_DIST = 0.15            # 프레임 간 같은 사람으로 볼 정규화 중심 거리
# ★ 09-14 1.5 → 4.0. 종전엔 낙하 기억(FALL_WINDOW 2.5)보다 그릇이 먼저 사라졌다 —
#   넘어진 사람을 포즈가 2~3.4초 놓치는 사이 추적이 만료돼 새 번호를 받고,
#   새 추적엔 dropped_at 이 없어 낙상 → 누움으로 강등됐다(12:19 시연 실측 · 5건 중 2건).
#   하한 = FALL_HOLD 0.5 + FALL_WINDOW 2.5 = 3.0 · 실측 공백 최대 3.38초 · 3.5~5.0 은 결과 동일.
#   로그 재생 근사 = fallen 전이 8건 불변(새 낙상 안 생김) · fallen 프레임 73 → 110.
TRACK_TTL = 4.0              # 이 시간 동안 안 보이면 추적 폐기(초)

STATES = ("standing", "unstable", "lying", "fallen", "unknown")
# 자세 세부 — 위 STATES 는 fusion 계약이라 늘리지 않고, 화면 표기는 이 세부를 쓴다.
POSTURES = ("walking", "standing", "seated", "unknown")
KO_POSTURE = {"walking": "직립", "standing": "서있음", "seated": "앉음",
              "unknown": "판정불가"}
# ★ standing 을 "서있음" 이라 적지 않는다. 우리가 잰 것은 다리가 아니라 몸통이라
#   앉은 사람과 선 사람을 구별하지 못한다(무릎 관측률 4.1% · 09-08 실측). 둘 다 몸통은 직립이다.
KO = {"standing": "직립", "unstable": "불안정", "lying": "누움",
      "fallen": "낙상", "unknown": "판정불가"}
COLOR = {"standing": (90, 190, 130), "unstable": (235, 170, 60),
         "lying": (235, 120, 60), "fallen": (230, 50, 50), "unknown": (140, 140, 140),
         "walking": (70, 160, 220), "seated": (120, 165, 145)}


SKELETON = ((5, 6), (5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12),
            (11, 12), (11, 13), (13, 15), (12, 14), (14, 16))
KP_DRAW = 0.4                # 이 신뢰도 이상만 그린다


def label_of(p):
    """화면 칩에 적을 (글자, 색). 낙상 계열이 우선이고 그 밖에는 자세 세부를 적는다."""
    k = p["state"] if p["state"] in ("lying", "fallen", "unstable") else p["posture"]
    return (KO.get(k) or KO_POSTURE.get(k) or k), COLOR.get(k, (140, 140, 140))


def _mid(kp, a, b, conf=None):
    """좌우 한 쌍의 중점. 둘 다 신뢰해야 돌려준다(한쪽만으로는 중심선을 못 만든다)."""
    if kp is None or len(kp) <= max(a, b):
        return None
    ax, ay, ac = kp[a]
    bx, by, bc = kp[b]
    c = KP_CONF if conf is None else conf
    if ac < c or bc < c:
        return None
    return ((ax + bx) / 2, (ay + by) / 2)


def _vert_deg(lower, upper):
    """아래 점 → 위 점 벡터가 수직에서 몇 도 벌어졌나. 0=수직(직립) · 90=수평 · 180=뒤집힘."""
    if lower is None or upper is None:
        return None
    dx = upper[0] - lower[0]
    dy = lower[1] - upper[1]          # 화면 y 는 아래로 증가하므로 뒤집어 위를 양수로
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return None
    return math.degrees(math.atan2(abs(dx), dy))


def _tilt_deg(kp):
    """어깨선이 수평에서 몇 도 기울었나(B단 대비책). 어깨 둘 다 신뢰 못 하면 None."""
    sh_l, sh_r = None, None
    if kp is not None and len(kp) > R_SH:
        if kp[L_SH][2] >= KP_CONF and kp[R_SH][2] >= KP_CONF:
            sh_l, sh_r = kp[L_SH], kp[R_SH]
    if sh_l is None:
        return None
    dx, dy = sh_r[0] - sh_l[0], sh_r[1] - sh_l[1]
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return None
    return abs(math.degrees(math.atan2(dy, dx)))  # 0=수평 · 90=수직


def _len_ratio(hip, knee, sh):
    """허벅지 길이를 몸통 길이로 나눈 값. 사람마다 비슷해 거리·화각에 덜 흔들린다."""
    if hip is None or knee is None or sh is None:
        return None
    torso = math.hypot(sh[0] - hip[0], sh[1] - hip[1])
    if torso < 1:
        return None
    return math.hypot(knee[0] - hip[0], knee[1] - hip[1]) / torso


def _features(kp):
    """이 사람에게서 뽑을 수 있는 것을 전부 뽑는다. 없는 것은 None 으로 남긴다."""
    sh = _mid(kp, L_SH, R_SH)
    hip = _mid(kp, L_HIP, R_HIP)
    knee = _mid(kp, L_KNEE, R_KNEE, KP_CONF_KNEE)   # 무릎만 완화 — 위 주석 참조
    ank = _mid(kp, L_ANK, R_ANK)
    lower = ank or knee                       # 발목이 없으면 무릎으로 대신한다
    return {
        "torso": _vert_deg(hip, sh),          # 엉덩이→어깨 (A단 주 특징)
        "legs": _vert_deg(lower, hip),        # 발목·무릎→엉덩이 (교차 확인)
        "thigh": _vert_deg(knee, hip),        # 무릎→엉덩이 — 0=서있음(허벅지 수직) · 90=앉음(수평)
        "thigh_len": _len_ratio(hip, knee, sh),   # 허벅지가 눌려 보이는 정도(1.0 ≈ 안 눌림)
        "shoulder_tilt": _tilt_deg(kp),       # 진단용(판정 미사용)
        # 관측률 표시도 판정과 같은 문턱을 써야 한다 — 다르면 화면의 28% 와 실제 판정이 어긋난다
        "has": {k: _mid(kp, *v, KP_CONF_KNEE if k == "knee" else None) is not None
                for k, v in JOINTS.items()},
    }


def _posture(f, travel, t, now):
    """화면에 적을 자세 세부. 근거가 없으면 unknown 이다 — 없음을 자세로 적지 않는다.

    ★ 09-08 14:30 — 무릎이 안 보이면 upright("몸통직립")라 적던 갈래를 걷어냈다. 전원 착석
      영상에서 그 값이 54.5% 였고 그중 94.8% 가 '무릎 안 보임' 이었다.
    ★ 09-08 16:45 — 걷기를 순간 속도에서 **3초 자취**로 바꾸고, 서있음에 **지속 조건**을 걸었다.
      자동 채집한 보행자 5명이 전부 판정불가로 새고 있었다(눌림 0.61~0.74 < 당시 기준 0.80).
      자취는 관절을 쓰지 않으므로 무릎이 가려도 걷는 사람을 잡는다.
    """
    span, prog = travel
    if span >= WALK_SPAN and prog <= WALK_PROG:
        t.pop("stand_since", None)
        return "walking"                       # 자취가 크고 여러 걸음에 나뉘었다 = 실제로 이동했다
    thigh, tlen = f["thigh"], f["thigh_len"]
    if thigh is None:
        t.pop("stand_since", None)
        return "unknown"                       # 무릎을 못 봤다 = 앉음/서있음 판정 불가
    if thigh >= THIGH_SIT:
        t.pop("stand_since", None)
        return "seated"                        # 허벅지가 수평 — 흔들려 보여도 앉은 것이다
    if thigh > THIGH_STAND or tlen is None or tlen < THIGH_LEN_MIN:
        t.pop("stand_since", None)
        return "unknown"                       # 중간대이거나, 허벅지가 너무 눌려 각도를 못 믿는다
    t.setdefault("stand_since", now)
    if now - t["stand_since"] < STAND_HOLD:
        return "unknown"                       # 아직 짧다 — 착석자의 가짜 서있음은 여기서 걸린다
    return "standing"


def _file_sha(path, n=12):
    """엔진 파일의 sha1 앞 n 자. 「어느 가중치로 잰 수인가」를 로그만으로 갈라내기 위한 것."""
    try:
        h = hashlib.sha1()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()[:n]
    except Exception:
        return None


class PoseLog:
    """자세 판정을 JSONL 로 남긴다 — 임계 조정 근거이자 4단계 시간 분류기의 학습 재료다.

    ★ 특징값만 적지 않고 **키포인트 원본(17×3)** 을 함께 남긴다. 특징만 남기면 오늘 정한
      특징 정의에 갇혀, 나중에 다른 각도(엉덩이-발목 벡터 등)나 시퀀스 모델을 시도할 수 없다.
    ★ `label` 은 `/mark` 로 사람이 붙인다 — 연출 촬영(앉음·일어섬·걷기·눕기)에서 정답을 만드는 유일한 길이다.
      라벨이 없으면 관측 기록일 뿐 데이터셋이 아니다.
    """

    def __init__(self, dirpath, max_mb=200, every=1, meta=None):
        self.dir = dirpath
        self.max_bytes = max_mb * 1024 * 1024
        self.every = max(1, int(every))       # N 번에 한 번만 기록(용량 조절)
        self.meta = meta or {}
        os.makedirs(dirpath, exist_ok=True)
        self.seq = self.lines = self.bytes = 0
        self.label = ""
        self.note = ""
        self.path = None
        self._open()

    def _open(self):
        """파일을 열고 **첫 줄에 임계·엔진·코드 판을 적는다.**
        ★ 이게 없으면 나중에 파일만 보고 어느 기준으로 판정한 기록인지 알 수 없다 —
          임계를 바꿔 가며 재채점할 때 옛 판정과 새 판정이 조용히 섞인다(09-08 실제로 겪음)."""
        self.path = os.path.join(self.dir, time.strftime("pose-%Y%m%d-%H%M%S.jsonl"))
        self.f = open(self.path, "a", buffering=1)
        self._head()

    def _head(self):
        """임계·엔진·코드 판을 _meta 한 줄로 적는다.
        ★ 여는 순간만이 아니라 /config 로 설정이 바뀔 때도 부른다 — 첫 줄만 믿으면
          fps·부표본을 바꾼 뒤의 기록이 조용히 거짓이 된다(09-11)."""
        head = {"_meta": True, "ts": round(time.time(), 3),
                "every": self.every,          # 몇 번에 한 번 기록했나 — 실효 기록율 = 추론 fps / every
                "code_mtime": time.strftime("%Y-%m-%dT%H:%M:%S",
                                            time.localtime(os.path.getmtime(__file__))),
                "thresholds": {"torso_up": TORSO_UP, "torso_down": TORSO_DOWN,
                               "thigh_stand": THIGH_STAND, "thigh_sit": THIGH_SIT,
                               "thigh_len_min": THIGH_LEN_MIN,
                               "kp_conf_knee": KP_CONF_KNEE,
                               "walk_span": WALK_SPAN, "walk_prog": WALK_PROG,
                               "walk_window_s": WALK_WINDOW, "stand_hold_s": STAND_HOLD,
                               "drop_rate": DROP_RATE,
                               "drop_window_s": DROP_WINDOW,
                               "fall_hold_s": FALL_HOLD, "fall_window_s": FALL_WINDOW,
                               # ★ 09-15 스위치를 로그에 남긴다 — 종전엔 env 로만 정해져
                               #   같은 code_sha 로 OFF 와 ON 을 가를 수 없었다(codex 3차 실행 확인:
                               #   두 프로세스의 threshold 키 16개가 동일). A/B 결론이 보존되지 않는다.
                               "hold_on_unknown": HOLD_ON_UNKNOWN,
                               # ★ 추적 상수도 남긴다 — 09-14 에 「이 로그가 TTL 1.5 인가 4.0 인가」를
                               #   code_mtime 으로 겨우 갈랐다. 판정에 쓴 상수는 로그에 있어야 한다.
                               "track_ttl_s": TRACK_TTL, "match_dist": MATCH_DIST},
                **self.meta}
        self.f.write(json.dumps(head, ensure_ascii=False, separators=(",", ":")) + "\n")

    def note_meta(self, **kv):
        """설정 변경을 기록한다 — meta 를 갱신하고 _meta 줄을 하나 더 남긴다."""
        self.meta.update(kv)
        self._head()

    def set_label(self, label, note=""):
        self.label, self.note = label or "", note or ""
        return {"label": self.label, "note": self.note}

    def _rotate(self):
        self.f.close()
        self._open()
        self.bytes = 0

    def write(self, people, wh, now):
        self.seq += 1
        if self.seq % self.every:
            return
        rec = {"ts": round(now, 3), "seq": self.seq, "wh": list(wh), "n": len(people),
               "p": [{"id": q["id"],
                      "box": [int(v) for v in q["box"]],
                      "st": q["state"], "po": q["posture"], "tr": q["tier"],
                      "to": q["torso"], "th": q["thigh"], "lg": q["legs"],
                      "tl": q["thigh_len"],
                      "sp": q["speed"], "dr": q["drop"], "as": q["aspect"],
                      # ★ 09-14 추가 — cf 사람검출 신뢰도 · gp 직전 관측과의 공백(신규면 -1) ·
                      #   nw 새 추적인가 · sd 낙하 후 경과 · sh 수평 시작 후 경과 · lt 래치 걸렸나
                      "cf": q.get("conf"), "gp": q.get("gap"), "nw": q.get("new"),
                      "sd": q.get("since_drop"), "sh": q.get("since_horiz"),
                      "lt": q.get("latched"),
                      "kp": q.get("kp")} for q in people]}
        if self.label:
            rec["label"] = self.label
            if self.note:
                rec["note"] = self.note
        line = json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n"
        self.f.write(line)
        self.lines += 1
        self.bytes += len(line)
        if self.bytes >= self.max_bytes:
            self._rotate()

    def health(self):
        return {"file": os.path.basename(self.path), "dir": self.dir, "lines": self.lines,
                "mb": round(self.bytes / 1048576, 2), "every": self.every,
                "label": self.label or None, "note": self.note or None}


class PoseFall:
    """포즈 엔진 하나를 들고 프레임마다 사람별 자세를 판정한다. 스레드 하나에서만 부른다."""

    def __init__(self, engine, imgsz, conf, log=None):
        # ★ 09-14 imgsz·conf 의 기본값을 **일부러 없앴다.** 종전엔 conf=0.35 가 기본 인자로 있었는데
        #   진입점은 POSE_CONF 0.25 를 넘기고 있었고, 내가 그 기본 인자를 실제 문턱으로 읽어
        #   하루 종일 틀린 값을 인용했다(codex 가 찾았다). 쓰이지 않는 기본값은 함정이므로 두지 않는다.
        from ultralytics import YOLO
        self.m = YOLO(engine, task="pose")
        self.log = log                         # PoseLog 또는 None
        self.engine = engine
        self.imgsz, self.conf = imgsz, conf
        self.engine_sha = _file_sha(engine)
        if self.log is not None:               # 추론 조건을 로그에 박는다 — 없으면 재현이 안 된다
            self.log.note_meta(pose_conf=conf, pose_imgsz=imgsz,
                               pose_engine=os.path.basename(engine),
                               pose_engine_sha=self.engine_sha)
        self.ms = 0.0
        self.tracks = {}                       # tid -> {"seen": t, "hist": deque[(t, cy)]}
        self._next = 1
        self.counts = {s: 0 for s in STATES}   # 누적 판정 횟수 — 오탐 세기용
        self.tiers = {}                        # 어느 단으로 판정했나 (A+ · A · B · -)
        self.by_tier = {}                      # 단수별 상태 분포 — 오탐이 어느 단에서 나오는지 본다
        self.postures = {}                     # 자세 세부 누적(앉음·서있음·걷는중)
        self.joint_seen = {k: 0 for k in JOINTS}   # 관절별 관측 횟수 — 화각 판정 근거
        self.joint_total = 0
        self.events = 0                        # fallen 으로 넘어간 횟수(사람 단위 전이)
        self._last_state = {}                  # tid -> 직전 상태

    # ── 추적 — 정규화 중심 최근접 매칭. 속도를 재려면 프레임 간 동일인이 필요하다 ──
    def _match(self, cx, cy, now, claimed):
        best, bd = None, MATCH_DIST
        for tid, t in self.tracks.items():
            if tid in claimed or now - t["seen"] > TRACK_TTL or not t["hist"]:
                continue           # ★ 이미 이 프레임에서 쓴 추적은 제외 — 안 그러면 한 번호가 두 사람을 오간다
            px, py = t["hist"][-1][1], t["hist"][-1][2]  # (t, cx, cy)
            d = math.hypot(cx - px, cy - py)
            if d < bd:
                best, bd = tid, d
        fresh = best is None
        if fresh:
            best = self._next
            self._next += 1
            self.tracks[best] = {"seen": now, "hist": deque(maxlen=64)}
        claimed.add(best)
        t = self.tracks[best]
        # ★ 09-14 공백을 기록한다 — 「TTL 이 덮었다」를 나중에 검증하려면 g 가 있어야 하고,
        #   공백이 큰데 기존 추적에 붙은 것이 identity aliasing 의심 지점이다(다른 사람이 그 자리에 왔을 수 있다).
        t["gap"] = -1.0 if fresh else round(now - t["seen"], 3)
        t["new"] = fresh
        t["seen"] = now
        t["hist"].append((now, cx, cy))
        return (best, t, self._drop_rate(t["hist"], now), self._speed_x(t["hist"], now),
                self._travel(t["hist"], now))

    @staticmethod
    def _travel(hist, now):
        """시간 창 안의 (자취, 진행성). 자취=두 점 사이 최대 거리 · 진행성=한 걸음 최대 점프/자취.
        진행성이 1 에 가까우면 여러 걸음이 아니라 한 번에 튄 것이다 — 추적 교체가 만드는 가짜 이동."""
        p = [h for h in hist if now - h[0] <= WALK_WINDOW]
        if len(p) < 8:
            return 0.0, 1.0
        p = p[::max(1, len(p) // 12)]          # 측정 때와 같은 표본 간격으로 맞춘다(비용도 준다)
        span = max(math.hypot(a[1] - b[1], a[2] - b[2]) for a in p for b in p)
        if span < 1e-6:
            return 0.0, 1.0
        step = max(math.hypot(p[i + 1][1] - p[i][1], p[i + 1][2] - p[i][2])
                   for i in range(len(p) - 1))
        return span, step / span

    @staticmethod
    def _drop_rate(hist, now):
        """시간 창 안에서 관측된 최대 하강율(정규화 높이/초). 아래로 갈 때만 양수."""
        if len(hist) < 2:
            return 0.0
        t1, _, y1 = hist[-1]
        best = 0.0
        for t0, _, y0 in hist:
            dt = t1 - t0
            if dt <= 1e-3 or now - t0 > DROP_WINDOW:
                continue
            best = max(best, (y1 - y0) / dt)   # y 는 아래로 증가
        return best

    @staticmethod
    def _speed_x(hist, now):
        """시간 창 안의 수평 이동 속도(프레임 너비/초). 걷는지 판단용."""
        if len(hist) < 2:
            return 0.0
        t1, x1, _ = hist[-1]
        best = 0.0
        for t0, x0, _ in hist:
            dt = t1 - t0
            if dt <= 1e-3 or now - t0 > DROP_WINDOW:
                continue
            best = max(best, abs(x1 - x0) / dt)
        return best

    def _expire(self, now):
        for tid in [k for k, v in self.tracks.items() if now - v["seen"] > TRACK_TTL]:
            self.tracks.pop(tid, None)
            self._last_state.pop(tid, None)

    @staticmethod
    def _classify(aspect, f, drop, t, now):
        """(상태, 판정 근거 단수). aspect 는 진단용이고 판정에 쓰지 않는다.
        ★ 순간 자세로 낙상을 선언하지 않는다 — 수평이 FALL_HOLD 이상 이어져야 한다.
          한 프레임짜리 수평은 고개 숙임·추적 흔들림·카메라 움직임으로도 나온다(09-08 실측 오탐 114회)."""
        falling = drop >= DROP_RATE
        if falling:
            t["dropped_at"] = now
        torso, legs = f["torso"], f["legs"]

        if torso is not None:                   # ── A단 · 몸통 기울기 = 엉덩이가 보일 때만 성립한다
            # ★ 09-08 12:10 수정 — 하체 수평을 근거로 쓰던 것을 걷어냈다.
            #   앉은 사람은 허벅지가 정의상 수평이라(로그 실측 다리각 중앙 82°·몸통 4°) 그 조건이
            #   앉음을 전부 누움으로 뒤집었다. 낙상/누움 12,538건 중 99%가 이 경우였다.
            #   같은 값(허벅지각)으로 "앉음" 이라 적으면서 "누움" 이라 판정하던 모순이다.
            #   진짜 누운 사람은 **몸통이 수평**이다. 다리는 판단에 넣지 않고 기록만 한다.
            horizontal = torso >= TORSO_DOWN
            tier = "A" if legs is None else "A+"
            if horizontal:
                t.setdefault("horiz_since", now)
                if now - t["horiz_since"] >= FALL_HOLD:      # 이어져야 인정한다
                    # ★ 09-14 래치. 종전엔 낙하 기억이 FALL_WINDOW(2.5초) 만에 만료돼
                    #   같은 자세(몸통 89도)인데 낙상 → 누움으로 강등됐다(실측 표시 지속 2.29초).
                    #   넘어져 바닥에 있는 사람을 「스스로 누운 사람」으로 다시 이름 붙이는 것이라 고친다.
                    #   수평이 풀리면(일어서면) 아래에서 래치를 푼다. 검출 건수는 안 바뀐다.
                    if now - t.get("dropped_at", -1e9) <= FALL_WINDOW:
                        t["fell"] = True
                    return ("fallen" if t.get("fell") else "lying"), tier
                return "unstable", tier         # 수평이지만 아직 짧다 — 단정하지 않는다
            t.pop("horiz_since", None)
            t.pop("fell", None)                 # 일어섰다 — 래치를 푼다
            if torso >= TORSO_UP or falling:
                return "unstable", tier
            return "standing", tier
        if not HOLD_ON_UNKNOWN:
            t.pop("horiz_since", None)

        # ── B단 · 엉덩이가 없다. 몸통 방향을 못 재므로 자세를 선언하지 않는다.
        #    낙하 속도만 본다. 떨어지지 않았다고 해서 "정상" 이라 적지 않는다(부재 ≠ 음성).
        #    여기서 실제 낙상은 지속되는 unstable 로 나타난다.
        if f["shoulder_tilt"] is None:
            return "unknown", "-"               # 어깨도 못 봤다
        if falling:
            return "unstable", "B"
        return "unknown", "B"                   # 낙하 없음 = 판정 못 함이지 정상 확인이 아니다

    def update(self, frame, now=None):
        """frame(BGR) → 사람별 판정 리스트. box 는 frame 좌표계 그대로다."""
        now = now or time.time()
        t0 = time.perf_counter()
        r = self.m.predict(frame, imgsz=self.imgsz, conf=self.conf, verbose=False)[0]
        self.ms = (time.perf_counter() - t0) * 1000
        H, W = frame.shape[:2]
        kps = r.keypoints.data.tolist() if r.keypoints is not None else []
        boxes = r.boxes.xyxy.tolist() if r.boxes is not None else []
        bconf = r.boxes.conf.tolist() if r.boxes is not None else []   # ★ 09-14 사람 검출 신뢰도 —
        #   놓친 프레임이 문턱 근처였는지는 이 값 없이는 사후에 못 가른다(09-14 재추론으로 겨우 알아냈다)
        out, claimed = [], set()
        for i, b in enumerate(boxes):
            x1, y1, x2, y2 = b
            w, h = x2 - x1, y2 - y1
            if h <= 1:
                continue
            f = _features(kps[i] if i < len(kps) else None)
            for j, ok in f["has"].items():
                self.joint_seen[j] += 1 if ok else 0
            self.joint_total += 1
            # ★ 추적 기준점 = 어깨 중점(관측률 99.7%). 박스 중심은 다리가 가려졌다 보였다 하면
            #   세로로 출렁여 정지한 사람에게도 낙하율 0.6 이 나온다(09-08 로그 실측).
            sh = _mid(kps[i] if i < len(kps) else None, L_SH, R_SH)
            ax = (sh[0] if sh else (x1 + x2) / 2) / W
            ay = (sh[1] if sh else (y1 + y2) / 2) / H
            tid, trk, drop, spd, trav = self._match(ax, ay, now, claimed)
            st, tier = self._classify(w / h, f, drop, trk, now)
            po = _posture(f, trav, trk, now)
            self.counts[st] += 1
            self.postures[po] = self.postures.get(po, 0) + 1
            self.tiers[tier] = self.tiers.get(tier, 0) + 1
            self.by_tier.setdefault(tier, {})[st] = self.by_tier.setdefault(tier, {}).get(st, 0) + 1
            if st == "fallen" and self._last_state.get(tid) != "fallen":
                self.events += 1                # 상태 전이만 센다(프레임마다 세면 부풀려진다)
            self._last_state[tid] = st
            # ★ 09-14 판정의 내부 상태를 밖으로 낸다 — 반증 조건(래치 전 무관측·공백 초과)을
            #   로그만으로 판정하려면 dropped_at·horiz_since·공백이 필요하다(codex 2차 지적).
            out.append({"id": tid, "box": (x1, y1, x2, y2), "state": st, "tier": tier,
                        "conf": round(bconf[i], 3) if i < len(bconf) else None,
                        "gap": trk.get("gap"),
                        "new": 1 if trk.get("new") else 0,
                        "since_drop": (None if "dropped_at" not in trk
                                       else round(now - trk["dropped_at"], 2)),
                        "since_horiz": (None if "horiz_since" not in trk
                                        else round(now - trk["horiz_since"], 2)),
                        "latched": 1 if trk.get("fell") else 0,
                        "posture": po, "aspect": round(w / h, 2),
                        "torso": None if f["torso"] is None else round(f["torso"], 1),
                        "thigh": None if f["thigh"] is None else round(f["thigh"], 1),
                        "thigh_len": None if f["thigh_len"] is None else round(f["thigh_len"], 2),
                        "legs": None if f["legs"] is None else round(f["legs"], 1),
                        "drop": round(drop, 3), "speed": round(spd, 3)})
            k = kps[i] if i < len(kps) else None
            out[-1]["kp"] = None if k is None else [
                [round(a), round(b), round(c, 2)] for a, b, c in k]
        self._expire(now)
        if self.log is not None:
            self.log.write(out, (W, H), now)
        return out

    def summary(self, people):
        """화면 표기용 — 낙상 계열이면 상태를, 아니면 자세 세부를 센다."""
        c = {}
        for p in people:
            k = p["state"] if p["state"] in ("lying", "fallen", "unstable") else p["posture"]
            c[k] = c.get(k, 0) + 1
        return c

    def health(self):
        n = max(self.joint_total, 1)
        return {"engine": self.engine.split("/")[-1], "ms": round(self.ms, 2),
                # ★ 09-14 추론 조건을 함께 낸다 — /health 의 최상위 conf 는 PPE 값이라 혼동됐다
                "pose_conf": self.conf, "pose_imgsz": self.imgsz, "engine_sha": self.engine_sha,
                "cumulative": dict(self.counts), "fallen_events": self.events,
                "tier": dict(self.tiers), "by_tier": {k: dict(v) for k, v in self.by_tier.items()},
                "posture": dict(self.postures),
                "joint_pct": {k: round(100 * v / n, 1) for k, v in self.joint_seen.items()},
                "samples": self.joint_total,
                "thresholds": {"torso_up": TORSO_UP, "torso_down": TORSO_DOWN,
                               "thigh_stand": THIGH_STAND, "thigh_sit": THIGH_SIT,
                               "thigh_len_min": THIGH_LEN_MIN,
                               "kp_conf_knee": KP_CONF_KNEE,
                               "walk_span": WALK_SPAN, "walk_prog": WALK_PROG,
                               "stand_hold_s": STAND_HOLD,
                               "drop_rate": DROP_RATE, "drop_window_s": DROP_WINDOW,
                               "fall_hold_s": FALL_HOLD, "fall_window_s": FALL_WINDOW,
                               "hold_on_unknown": HOLD_ON_UNKNOWN},   # ★ 09-15 · 위 _head 와 같은 이유
                "note": "경보 없음 · 계수 목적 · A단=몸통 기울기(엉덩이 필요) · B단=낙하속도만(누움 선언 안 함)"}
