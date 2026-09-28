#!/usr/bin/env python3
# 라이브 /health 표본으로 PPE·자세·조끼의 한 추론 슬롯 점유를 재는 도구.
import argparse
import json
import sys
import time
from urllib.request import urlopen


DEFAULT_URL = "http://127.0.0.1:8445/health"


def number(value):
    """JSON 값에서 숫자만 받아, 없는 값은 None 으로 남긴다."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def integer(value):
    value = number(value)
    return int(value) if value is not None else None


def percentile(values, fraction):
    if not values:
        return None
    values = sorted(values)
    position = (len(values) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def distribution(values):
    values = [value for value in values if value is not None]
    if not values:
        return {"count": 0, "mean": None, "p50": None, "p95": None, "max": None}
    return {
        "count": len(values),
        "mean": sum(values) / len(values),
        "p50": percentile(values, 0.50),
        "p95": percentile(values, 0.95),
        "max": max(values),
    }


def delta(first, last):
    if first is None or last is None:
        return None
    return last - first


def health_sample(url):
    with urlopen(url, timeout=3) as response:
        health = json.loads(response.read().decode("utf-8"))
    vest = health.get("vest_detail") or {}
    vest_last = health.get("vest")
    pose = health.get("pose_detail") or {}
    stats = health.get("stats") or {}
    return {
        "t": time.time(),
        "infers": integer(health.get("infers")),
        "infer_ms": number(health.get("infer_ms")),
        "pose_ms": number(pose.get("ms")) if isinstance(pose, dict) else None,
        "vest": {
            "runs": integer(vest.get("runs")),
            "ms_sum": number(vest.get("ms_sum")),
            "ms_max": number(vest.get("ms_max")),
            "skipped_every": integer(vest.get("skipped_every")),
            "skipped_no_person": integer(vest.get("skipped_no_person")),
            "dead": vest.get("dead") if isinstance(vest.get("dead"), bool) else None,
            "every": integer(vest.get("every")),
        },
        "vest_last": {
            "ran": vest_last.get("ran") if isinstance(vest_last.get("ran"), bool) else None,
            "why": vest_last.get("why") if isinstance(vest_last.get("why"), str) else None,
            "vest": integer(vest_last.get("vest")),
            "torso": integer(vest_last.get("torso")),
            "person": integer(vest_last.get("person")),
            "vest_on_person": integer(vest_last.get("vest_on_person")),
            "torso_on_person": integer(vest_last.get("torso_on_person")),
        } if isinstance(vest_last, dict) else None,
        "stream_fps": number(health.get("stream_fps")),
        "age": number(health.get("age")),
        "person_count": number(stats.get("person_count")),
    }


def make_summary(samples):
    vest_last_values = [sample.get("vest_last") for sample in samples
                        if isinstance(sample.get("vest_last"), dict)]
    vest_last_ran = [value for value in vest_last_values if value.get("ran") is True]
    vest_last_with_person = [value for value in vest_last_ran
                             if value.get("person") is not None and value["person"] >= 1]
    vest_on_person_pos = sum(value.get("vest_on_person") is not None and
                             value["vest_on_person"] >= 1 for value in vest_last_with_person)
    torso_on_person_pos = sum(value.get("torso_on_person") is not None and
                              value["torso_on_person"] >= 1 for value in vest_last_with_person)
    neither = sum(value.get("vest_on_person") == 0 and value.get("torso_on_person") == 0
                  for value in vest_last_with_person)
    skipped_why = {why: sum(value.get("ran") is False and value.get("why") == why
                            for value in vest_last_values)
                   for why in ("every", "no_person", "dead")}
    ran_with_person_count = len(vest_last_with_person)
    def ratio(value):
        return round(value / ran_with_person_count, 4) if ran_with_person_count else None

    vest_last_summary = {
        "samples": len(vest_last_values),
        "ran": len(vest_last_ran),
        "ran_with_person": ran_with_person_count,
        "vest_on_person_pos": vest_on_person_pos,
        "torso_on_person_pos": torso_on_person_pos,
        "neither": neither,
        "vest_ratio": ratio(vest_on_person_pos),
        "torso_ratio": ratio(torso_on_person_pos),
        "neither_ratio": ratio(neither),
        "skipped_why": skipped_why,
    }
    vest_last_note = "1초 표본과 조끼 경로의 실행 주기가 달라 같은 결과를 두 번 읽거나 사이 결과를 놓칠 수 있음"
    if not samples:
        return {
            "n": 0, "elapsed_s": 0.0, "inference_rate_hz": None, "slot_ms": None,
            "ppe": distribution([]), "pose": distribution([]),
            "vest": {"runs_delta": None, "window_avg_ms": None, "ms_max_last": None,
                     "run_ratio": None, "per_slot_share_ms": 0.0,
                     "skipped_every_delta": None, "skipped_no_person_delta": None,
                     "dead_last": None, "every_last": None},
            "people": {"mean": None, "zero_sample_ratio": None},
            "occupancy": {"vest_run_slot_ms": None, "average_slot_ms": None,
                          "vest_run_slot_pct_100ms": None, "vest_run_slot_pct_83_3ms": None,
                          "average_slot_pct_100ms": None, "average_slot_pct_83_3ms": None},
            "display": {"stream_fps_mean": None, "stream_fps_min": None, "age_max": None},
            "vest_last": vest_last_summary,
            "vest_last_note": vest_last_note,
        }

    first, last = samples[0], samples[-1]
    elapsed = max(0.0, last["t"] - first["t"])
    infers_delta = delta(first["infers"], last["infers"])
    rate = infers_delta / elapsed if elapsed > 0 and infers_delta is not None else None
    slot_ms = 1000.0 / rate if rate and rate > 0 else None
    ppe = distribution([sample["infer_ms"] for sample in samples])
    pose = distribution([sample["pose_ms"] for sample in samples])
    runs_delta = delta(first["vest"]["runs"], last["vest"]["runs"])
    ms_sum_delta = delta(first["vest"]["ms_sum"], last["vest"]["ms_sum"])
    window_avg = ms_sum_delta / runs_delta if runs_delta and ms_sum_delta is not None else None
    run_ratio = runs_delta / infers_delta if infers_delta else None
    per_slot_share = window_avg * run_ratio if window_avg is not None and run_ratio is not None else 0.0
    vest_run_slot = None
    if ppe["p50"] is not None and pose["p50"] is not None and window_avg is not None:
        vest_run_slot = ppe["p50"] + pose["p50"] + window_avg
    average_slot = None
    if ppe["p50"] is not None and pose["p50"] is not None:
        average_slot = ppe["p50"] + pose["p50"] + per_slot_share

    persons = [sample["person_count"] for sample in samples if sample["person_count"] is not None]
    fps = [sample["stream_fps"] for sample in samples if sample["stream_fps"] is not None]
    ages = [sample["age"] for sample in samples if sample["age"] is not None]
    return {
        "n": len(samples),
        "elapsed_s": elapsed,
        "inference_rate_hz": rate,
        "slot_ms": slot_ms,
        "ppe": ppe,
        "pose": pose,
        "vest": {
            "runs_delta": runs_delta,
            "window_avg_ms": window_avg,
            "ms_max_last": last["vest"]["ms_max"],
            "run_ratio": run_ratio,
            "per_slot_share_ms": per_slot_share,
            "skipped_every_delta": delta(first["vest"]["skipped_every"], last["vest"]["skipped_every"]),
            "skipped_no_person_delta": delta(first["vest"]["skipped_no_person"], last["vest"]["skipped_no_person"]),
            "dead_last": last["vest"]["dead"],
            "every_last": last["vest"]["every"],
        },
        "people": {
            "mean": sum(persons) / len(persons) if persons else None,
            "zero_sample_ratio": sum(value == 0 for value in persons) / len(persons) if persons else None,
        },
        "occupancy": {
            "vest_run_slot_ms": vest_run_slot,
            "average_slot_ms": average_slot,
            "vest_run_slot_pct_100ms": vest_run_slot if vest_run_slot is None else vest_run_slot,
            "vest_run_slot_pct_83_3ms": None if vest_run_slot is None else vest_run_slot / 83.3 * 100.0,
            "average_slot_pct_100ms": None if average_slot is None else average_slot,
            "average_slot_pct_83_3ms": None if average_slot is None else average_slot / 83.3 * 100.0,
        },
        "display": {
            "stream_fps_mean": sum(fps) / len(fps) if fps else None,
            "stream_fps_min": min(fps) if fps else None,
            "age_max": max(ages) if ages else None,
        },
        "vest_last": vest_last_summary,
        "vest_last_note": vest_last_note,
    }


def parse_args(argv):
    parser = argparse.ArgumentParser(description="/health 추론 슬롯 표본기")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--seconds", type=float, default=180.0)
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--json", default="-", metavar="PATH")
    parser.add_argument("--label", default=None)
    parser.add_argument("--allow-fast", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.seconds <= 0:
        parser.error("--seconds 는 0보다 커야 합니다")
    if args.interval <= 0:
        parser.error("--interval 은 0보다 커야 합니다")
    if args.interval < 0.5 and not args.allow_fast:
        parser.error("--interval 은 0.5초 이상이어야 합니다")
    return args


def collect(args):
    samples = []
    failures = 0
    consecutive_failures = 0
    started_at = time.time()
    deadline = time.monotonic() + args.seconds
    next_sample = time.monotonic()
    exit_code = 0
    while True:
        now = time.monotonic()
        if now >= deadline or next_sample >= deadline:
            break
        if now < next_sample:
            time.sleep(next_sample - now)
        if time.monotonic() >= deadline:
            break
        try:
            samples.append(health_sample(args.url))
            consecutive_failures = 0
        except Exception:
            failures += 1
            consecutive_failures += 1
            if consecutive_failures >= 10:
                exit_code = 2
                break
        next_sample += args.interval
        if next_sample < time.monotonic():
            next_sample = time.monotonic() + args.interval
    result = {
        "meta": {
            "url": args.url,
            "label": args.label,
            "started_at": started_at,
            "ended_at": time.time(),
            "requested_seconds": args.seconds,
            "interval_s": args.interval,
            "failures": failures,
            "consecutive_failures": consecutive_failures,
        },
        "samples": samples,
        "summary": make_summary(samples),
    }
    return result, exit_code


def write_json(result, destination):
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if destination == "-":
        sys.stdout.write(text + "\n")
    else:
        with open(destination, "w", encoding="utf-8") as output:
            output.write(text + "\n")


def main(argv=None):
    args = parse_args(argv)
    result, exit_code = collect(args)
    write_json(result, args.json)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
