# 가짜 /health 서버로 라이브 슬롯 표본기의 창 차분과 JSON 출력을 확인한다.
import http.server
import json
import math
import os
import subprocess
import sys
import threading

import live_slot_sampler


HERE = os.path.dirname(__file__)
SCRIPT = os.path.join(HERE, "live_slot_sampler.py")


class FakeHealth(http.server.BaseHTTPRequestHandler):
    state = None
    fail = False

    def log_message(self, _format, *_args):
        pass

    def do_GET(self):
        if self.path != "/health" or self.fail:
            self.send_response(500)
            self.end_headers()
            return
        state = self.state
        state["infers"] += 1
        if state["run_every"] and state["infers"] % state["run_every"] == 0:
            state["runs"] += 1
            state["ms_sum"] += 40.0
        infers = state["infers"]
        body = {
            "infers": infers,
            "infer_ms": 10.0 + infers,
            "pose_detail": {"ms": 20.0 + infers},
            "vest_detail": {
                "runs": state["runs"], "ms_sum": state["ms_sum"], "ms_max": 40.0,
                "skipped_every": infers - state["runs"], "skipped_no_person": infers // 5,
                "dead": False, "every": 2,
            },
            "stream_fps": 30.0 - infers * 0.01,
            "age": infers * 0.01,
            "stats": {"person_count": 0 if infers % 5 == 0 else 2},
        }
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def server(fail=False, run_every=2):
    FakeHealth.state = {"infers": 0, "runs": 0, "ms_sum": 0.0, "run_every": run_every}
    FakeHealth.fail = fail
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeHealth)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, "http://127.0.0.1:%d/health" % httpd.server_port


def run_sampler(url, seconds="2", extra=(), stdin=False):
    command = [sys.executable, "-" if stdin else SCRIPT, "--url", url, "--seconds", seconds,
               "--interval", "0.1", "--allow-fast", *extra]
    source = open(SCRIPT, encoding="utf-8").read() if stdin else None
    return subprocess.run(command, input=source, text=True, capture_output=True, check=False)


def test_twenty_samples_and_window_deltas():
    httpd, url = server()
    try:
        result = run_sampler(url)
    finally:
        httpd.shutdown()
        httpd.server_close()
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    summary = report["summary"]
    assert summary["n"] == 20
    assert math.isclose(summary["inference_rate_hz"], 10.0, rel_tol=0.08)
    assert summary["vest"]["window_avg_ms"] == 40.0
    assert summary["vest"]["runs_delta"] == 10
    assert math.isclose(summary["vest"]["run_ratio"], 10.0 / 19.0)


def test_no_vest_runs_has_none_average_and_zero_share():
    httpd, url = server(run_every=None)
    try:
        result = run_sampler(url, seconds="0.3")
    finally:
        httpd.shutdown()
        httpd.server_close()
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    summary = report["summary"]
    assert summary["vest"]["window_avg_ms"] is None
    assert summary["vest"]["per_slot_share_ms"] == 0.0


def test_ten_consecutive_read_failures_exit_two():
    httpd, url = server(fail=True)
    try:
        result = run_sampler(url, seconds="5")
    finally:
        httpd.shutdown()
        httpd.server_close()
    assert result.returncode == 2


def test_json_stdout_is_one_document_and_stdin_execution_works():
    httpd, url = server()
    try:
        result = run_sampler(url, seconds="0.2", extra=("--json", "-"), stdin=True)
    finally:
        httpd.shutdown()
        httpd.server_close()
    assert result.returncode == 0, result.stderr
    assert result.stdout.count("\n") == 1
    assert json.loads(result.stdout)["summary"]["n"] == 2


def test_compile_and_help():
    compiled = subprocess.run([sys.executable, "-m", "py_compile", SCRIPT], capture_output=True, text=True)
    help_result = subprocess.run([sys.executable, SCRIPT, "--help"], capture_output=True, text=True)
    assert compiled.returncode == 0, compiled.stderr
    assert help_result.returncode == 0, help_result.stderr
    assert "--interval" in help_result.stdout


def manual_sample(vest_last):
    return {
        "t": 0.0, "infers": 0, "infer_ms": 10.0, "pose_ms": 20.0,
        "vest": {"runs": 0, "ms_sum": 0.0, "ms_max": 0.0,
                 "skipped_every": 0, "skipped_no_person": 0, "dead": False, "every": 2},
        "vest_last": vest_last, "stream_fps": 30.0, "age": 0.0, "person_count": 1.0,
    }


def test_vest_last_summary_counts_and_ratios():
    samples = [
        manual_sample({"ran": True, "person": 2, "vest_on_person": 1, "torso_on_person": 1}),
        manual_sample({"ran": True, "person": 1, "vest_on_person": 0, "torso_on_person": 1}),
        manual_sample({"ran": True, "person": 1, "vest_on_person": 0, "torso_on_person": 0}),
        manual_sample({"ran": True, "person": 0, "vest_on_person": 0, "torso_on_person": 0}),
        manual_sample({"ran": False, "why": "every"}),
        manual_sample(None),
    ]
    vest_last = live_slot_sampler.make_summary(samples)["vest_last"]
    assert vest_last == {
        "samples": 5, "ran": 4, "ran_with_person": 3,
        "vest_on_person_pos": 1, "torso_on_person_pos": 2, "neither": 1,
        "vest_ratio": 0.3333, "torso_ratio": 0.6667, "neither_ratio": 0.3333,
        "skipped_why": {"every": 1, "no_person": 0, "dead": 0},
    }


def test_vest_last_missing_is_zero_and_none():
    summary = live_slot_sampler.make_summary([manual_sample(None), manual_sample(None)])
    assert summary["vest_last"] == {
        "samples": 0, "ran": 0, "ran_with_person": 0,
        "vest_on_person_pos": 0, "torso_on_person_pos": 0, "neither": 0,
        "vest_ratio": None, "torso_ratio": None, "neither_ratio": None,
        "skipped_why": {"every": 0, "no_person": 0, "dead": 0},
    }


def test_vest_last_positive_control_changes_vest_count():
    samples = [
        manual_sample({"ran": True, "person": 1, "vest_on_person": 0, "torso_on_person": 0}),
        manual_sample({"ran": True, "person": 1, "vest_on_person": 0, "torso_on_person": 1}),
    ]
    before = live_slot_sampler.make_summary(samples)["vest_last"]
    samples[0]["vest_last"]["vest_on_person"] = 1
    after = live_slot_sampler.make_summary(samples)["vest_last"]
    assert before["vest_on_person_pos"] == 0
    assert after["vest_on_person_pos"] == 1


if __name__ == "__main__":
    tests = (
        test_twenty_samples_and_window_deltas,
        test_no_vest_runs_has_none_average_and_zero_share,
        test_ten_consecutive_read_failures_exit_two,
        test_json_stdout_is_one_document_and_stdin_execution_works,
        test_compile_and_help,
        test_vest_last_summary_counts_and_ratios,
        test_vest_last_missing_is_zero_and_none,
        test_vest_last_positive_control_changes_vest_count,
    )
    for test in tests:
        test()
        print("  ✓ %s" % test.__name__)
    print("✅ 전부 통과 (%d개 시험)" % len(tests))
