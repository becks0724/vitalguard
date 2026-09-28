# 조끼 전용 경로가 PPE stats·모델과 분리되어 켜지고, 사람 없이는 돌지 않는지 재는 시험
import inspect
import os
import subprocess
import sys
import types

# ── 이 시험은 HTTP 를 쓰지 않으므로 flask 를 최소 스텁으로 바꾼다 ──
_f = types.ModuleType("flask")
_f.Flask = lambda *a, **k: types.SimpleNamespace(
    get=lambda *a, **k: (lambda fn: fn), post=lambda *a, **k: (lambda fn: fn), run=None)
_f.Response = lambda *a, **k: None
_f.jsonify = lambda value: value
_f.request = types.SimpleNamespace(args={})
sys.modules["flask"] = _f

os.environ.pop("VEST_ENGINE", None)
os.environ.pop("VEST_EVERY", None)
import gopro_ppe_edge as G  # noqa: E402

# ★ import 직후의 값을 먼저 찍어 둔다 — 아래 시험들은 _reset() 으로 값을 덮어쓰므로 기본값은 이 스냅샷으로만 잴 수 있다
#   ([WATCH.APP] 09-25 변이 시험: 기본값을 "x.engine" 으로 바꿔도 종전 8개가 전부 통과했다)
_IMPORT_STATE = {"engine": G.VEST_ENGINE, "every": G.VEST_EVERY, "imgsz": G.VEST_IMGSZ, "conf": G.VEST_CONF,
                 "step": G.vest_step(0, [("person", (0, 0, 100, 100), 0.9)], None), "stat": dict(G._vest_stat)}


class _Values(list):
    def tolist(self):
        return list(self)


class _Result:
    def __init__(self, dets):
        self.boxes = types.SimpleNamespace(
            xyxy=_Values([box for _name, box, _conf in dets]),
            cls=_Values([cls for cls, (_name, _box, _conf) in enumerate(dets)]),
            conf=_Values([conf for _name, _box, conf in dets]),
        )


class _VestModel:
    names = {0: "person", 1: "safety_vest", 2: "torso"}

    def __init__(self, dets=(), error=None):
        self.dets = dets
        self.error = error
        self.calls = 0

    def predict(self, frame, **kwargs):
        self.calls += 1
        if self.error:
            raise self.error
        cls = [self.names[key] for key in sorted(self.names)]
        result = _Result(self.dets)
        result.boxes.cls = _Values([cls.index(name) for name, _box, _conf in self.dets])
        return [result]


def d(name, box, conf=0.9):
    return name, box, conf


_ensure_vest = G._ensure_vest


def _reset():
    G.VEST_ENGINE = ""
    G.VEST_EVERY = 2
    G.VEST_IMGSZ = (544, 960)
    G.VEST_CONF = 0.30
    G._vest_model = None
    G._vest_dead = False
    G._ensure_vest = _ensure_vest
    G._state["vest"] = None
    G._vest_stat.clear()
    G._vest_stat.update(runs=0, skipped_every=0, skipped_no_person=0, ms_sum=0.0, ms_max=0.0)


def test_default_is_off_before_anything_is_overridden():
    # 환경변수 없이 import 한 그대로 — 값을 덮어쓰기 전
    assert _IMPORT_STATE["engine"] == ""
    assert (_IMPORT_STATE["every"], _IMPORT_STATE["imgsz"], _IMPORT_STATE["conf"]) == (2, (544, 960), 0.30)
    assert _IMPORT_STATE["step"] is None
    assert _IMPORT_STATE["stat"] == {"runs": 0, "skipped_every": 0, "skipped_no_person": 0, "ms_sum": 0.0, "ms_max": 0.0}


def test_disabled_is_identical_and_does_not_touch_stats():
    _reset()
    assert G.vest_step(7, [d("person", (0, 0, 100, 100))], None) is None
    assert G._vest_stat == {"runs": 0, "skipped_every": 0, "skipped_no_person": 0,
                            "ms_sum": 0.0, "ms_max": 0.0}
    source = inspect.getsource(G.infer)
    keys = {"person_count", "fall_count", "violation_count", "no_hardhat_count", "hardhat_count",
            "compliance_rate", "no_vest_count", "vest_count", "engine"}
    assert all(key in source for key in keys)
    assert "vest_detail" not in source


def test_disabled_health_omits_vest_key():
    _reset()
    health = G.health()
    assert "vest" not in health
    assert health["vest_detail"] is None


def test_every_two_slots_runs_on_second_and_fourth():
    _reset()
    G.VEST_ENGINE = "/tmp/vest.engine"
    model = _VestModel([d("safety_vest", (10, 10, 30, 30))])
    G._vest_model = model
    got = [G.vest_step(n, [d("person", (0, 0, 100, 100))], None) for n in (1, 2, 3, 4)]
    assert [step["ran"] for step in got] == [False, True, False, True]
    assert G._vest_stat["skipped_every"] == 2
    assert model.calls == 2


def test_no_ppe_person_skips_without_calling_vest_model():
    _reset()
    G.VEST_ENGINE = "/tmp/vest.engine"
    model = _VestModel()
    G._vest_model = model
    assert G.vest_step(2, [d("helmet", (0, 0, 100, 100))], None) == {"ran": False, "why": "no_person"}
    assert G._vest_stat["skipped_no_person"] == 1
    assert model.calls == 0


def test_counts_and_person_attachment_are_aggregated():
    _reset()
    G.VEST_ENGINE = "/tmp/vest.engine"
    G._vest_model = _VestModel([
        d("safety_vest", (150, 200, 250, 300)), d("safety_vest", (500, 500, 560, 560)),
        d("torso", (120, 150, 280, 380)), d("person", (110, 110, 290, 390)),
    ])
    got = G.vest_step(2, [d("person", (100, 100, 300, 400))], None)
    assert {key: got[key] for key in ("vest", "vest_on_person", "torso", "torso_on_person", "person")} == {
        "vest": 2, "vest_on_person": 1, "torso": 1, "torso_on_person": 1, "person": 1}
    assert G._vest_stat["runs"] == 1
    assert G._vest_stat["ms_max"] >= 0


def test_vest_errors_reach_the_loop_isolation_boundary():
    _reset()
    G.VEST_ENGINE = "/tmp/vest.engine"
    G._vest_model = _VestModel(error=RuntimeError("stub failure"))
    try:
        G.vest_step(2, [d("person", (0, 0, 100, 100))], None)
    except RuntimeError as e:
        assert str(e) == "stub failure"
    else:
        raise AssertionError("조끼 모델 예외가 올라오지 않았다")
    assert not G._vest_dead


def test_load_failure_becomes_dead_after_first_error():
    _reset()
    G.VEST_ENGINE = "/tmp/missing.engine"
    calls = [0]

    def broken_ensure_vest():
        calls[0] += 1
        raise RuntimeError("load stub failure")

    G._ensure_vest = broken_ensure_vest
    try:
        G.vest_step(2, [d("person", (0, 0, 100, 100))], None)
    except RuntimeError as e:
        assert str(e) == "load stub failure"
    else:
        raise AssertionError("첫 적재 실패가 올라오지 않았다")
    assert G._vest_dead
    assert G.health()["vest_detail"]["dead"] is True
    assert G.vest_step(2, [d("person", (0, 0, 100, 100))], None) == {"ran": False, "why": "dead"}
    assert calls[0] == 1


def test_zero_every_fails_during_import():
    _reset()
    env = dict(os.environ, VEST_EVERY="0")
    code = """import sys, types
f = types.ModuleType('flask')
f.Flask = lambda *a, **k: types.SimpleNamespace(get=lambda *a, **k: lambda fn: fn, post=lambda *a, **k: lambda fn: fn, run=None)
f.Response = f.jsonify = lambda *a, **k: None
f.request = types.SimpleNamespace(args={})
sys.modules['flask'] = f
import gopro_ppe_edge
"""
    run = subprocess.run([sys.executable, "-c", code], cwd=os.path.dirname(__file__), env=env,
                         text=True, capture_output=True)
    assert run.returncode != 0
    assert "VEST_EVERY" in run.stderr


if __name__ == "__main__":
    tests = (
        test_default_is_off_before_anything_is_overridden,
        test_disabled_is_identical_and_does_not_touch_stats,
        test_disabled_health_omits_vest_key,
        test_every_two_slots_runs_on_second_and_fourth,
        test_no_ppe_person_skips_without_calling_vest_model,
        test_counts_and_person_attachment_are_aggregated,
        test_vest_errors_reach_the_loop_isolation_boundary,
        test_load_failure_becomes_dead_after_first_error,
        test_zero_every_fails_during_import,
    )
    for test in tests:
        test()
        print(f"  ✓ {test.__name__}")
    print(f"✅ 전부 통과 ({len(tests)}개 시험)")
