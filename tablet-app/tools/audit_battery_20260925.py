#!/usr/bin/env python3
"""Recompute the recorded battery windows; never connect to or change a device."""
import datetime as dt
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KST = dt.timezone(dt.timedelta(hours=9))
DESIGN_MAH = 10200


def timestamp(clock):
    return int(dt.datetime.fromisoformat(f"2026-09-25T{clock}").replace(tzinfo=KST).timestamp())


def window(rows, start, end):
    samples = [r for r in rows if timestamp(start) <= r[0] < timestamp(end)]
    amps = [r[1] / 1_000_000 for r in samples]
    # Actual timestamps, not a presumed 2-second period. Positive = charging.
    signed_mah = sum(
        (a[1] + b[1]) / 2 / 1_000_000 * (b[0] - a[0]) / 3.6
        for a, b in zip(samples, samples[1:])
    )
    return {
        "window_kst": [start, end], "end_exclusive": True,
        "samples": len(samples), "sample_span_seconds": samples[-1][0] - samples[0][0],
        "statuses": sorted({r[2] for r in samples}),
        "mean_signed_a": statistics.mean(amps), "median_signed_a": statistics.median(amps),
        "population_sd_a": statistics.pstdev(amps), "integrated_signed_mah": signed_mah,
        "displayed_percent": [samples[0][3], samples[-1][3]],
        "one_hour_design_capacity_percent": abs(statistics.mean(amps)) * 1000 / DESIGN_MAH * 100,
    }


def main():
    source = ROOT / "artifacts/battery-20260925.log"
    rows = []
    for line in source.read_text().splitlines():
        epoch, ua, rest = line.split(" ", 2)
        status, level, _usb = rest.rsplit(" ", 2)
        rows.append((int(epoch), int(ua), status, int(level)))
    result = {
        "source": source.name, "source_rows": len(rows), "design_capacity_mah": DESIGN_MAH,
        "cctv_first_180s": window(rows, "14:25:04", "14:28:04"),
        "record_first_180s": window(rows, "14:49:07", "14:52:07"),
        "gauge_79_to_76": window(rows, "14:27:06", "14:41:11"),
        "usb_76_to_78": window(rows, "14:42:40", "14:46:49"),
        "usb_reconnected_full": window(rows, "14:42:40", "14:49:06"),
        "caveat": "Design capacity conversion and short-window extrapolation; not a measured runtime or independent coulomb-counter calibration.",
    }
    output = ROOT / "artifacts/battery-20260925-audit.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(output)
    for key, value in result.items():
        if isinstance(value, dict):
            print(key, json.dumps(value, ensure_ascii=False))


if __name__ == "__main__":
    main()
