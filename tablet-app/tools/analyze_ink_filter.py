#!/usr/bin/env python3
"""Audit real editor traces against the unchanged 1-logical-pixel filter."""
import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path


def distance_to_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy
    t = 0 if not length else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def examine(row):
    if row['kind'] != 'stylus' or row['rect_changed'] or row['cancelled']:
        return {'stroke': row['stroke'], 'excluded': True, 'reason': 'non-stylus, changing viewport, or cancellation'}
    raw = row['unfiltered_points']
    actual = row['filtered_stroke']['points']
    width, height = row['rect'][2:]
    replay = [raw[0]]
    pressure_delta = 0
    for p in raw[1:]:
        dx, dy = (p[0] - replay[-1][0]) * width, (p[1] - replay[-1][1]) * height
        if dx * dx + dy * dy >= 1:
            replay.append(p)
        else:
            pressure_delta = max(pressure_delta, abs(p[2] - replay[-1][2]))
    if replay != actual:
        raise ValueError(f"Stroke {row['stroke']}: replay differs from editor output")
    points = [(p[0] * width, p[1] * height) for p in raw]
    kept = [(p[0] * width, p[1] * height) for p in actual]
    segments = list(zip(kept, kept[1:])) or [(kept[0], kept[0])]
    deviation = max(min(distance_to_segment(p, a, b) for a, b in segments) for p in points)
    before, after = row.get('unfiltered_json_bytes'), row.get('filtered_json_bytes')
    return {
        'stroke': row['stroke'], 'label': row['label'], 'tool': row['tool'],
        'input_points': len(raw), 'kept_points': len(actual),
        'points_reduction_percent': (1 - len(actual) / len(raw)) * 100,
        'unfiltered_json_bytes': before, 'filtered_json_bytes': after,
        'bytes_reduction_percent': (1 - after / before) * 100 if before else None,
        'duration_seconds': row['duration_us'] / 1e6,
        'max_centerline_deviation_logical_px': deviation,
        'max_centerline_deviation_device_px': deviation * row['device_pixel_ratio'],
        'max_dropped_pressure_delta': pressure_delta,
        'filter_replay_matches': True,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('trace', type=Path)
    parser.add_argument('--provenance', choices=['synthetic-smoke', 'human-stylus'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    rows = [json.loads(s) for s in args.trace.read_text().splitlines() if s.strip()]
    strokes = [examine(r) for r in rows]
    grouped = defaultdict(list)
    for stroke in strokes:
        if not stroke.get('excluded'):
            grouped[stroke['label']].append(stroke)
    summary = {}
    for label, samples in grouped.items():
        inputs = sum(s['input_points'] for s in samples)
        kept = sum(s['kept_points'] for s in samples)
        before = sum(s['unfiltered_json_bytes'] or 0 for s in samples)
        after = sum(s['filtered_json_bytes'] or 0 for s in samples)
        summary[label] = {
            'strokes': len(samples), 'input_points': inputs, 'kept_points': kept,
            'points_reduction_percent': (1 - kept / inputs) * 100,
            'unfiltered_json_bytes': before, 'filtered_json_bytes': after,
            'bytes_reduction_percent': (1 - after / before) * 100 if before else None,
            'max_centerline_deviation_logical_px': max(s['max_centerline_deviation_logical_px'] for s in samples),
        }
    totals = {key: sum(s[key] for s in summary.values()) for key in [
        'strokes', 'input_points', 'kept_points', 'unfiltered_json_bytes', 'filtered_json_bytes',
    ]}
    totals['points_reduction_percent'] = (
        (1 - totals['kept_points'] / totals['input_points']) * 100
        if totals['input_points'] else None
    )
    totals['bytes_reduction_percent'] = (
        (1 - totals['filtered_json_bytes'] / totals['unfiltered_json_bytes']) * 100
        if totals['unfiltered_json_bytes'] else None
    )
    report = {
        'source': str(args.trace), 'provenance': args.provenance,
        'summary': summary, 'strokes': strokes, 'total': totals,
        'validation': {
            'all_stylus': all(r['kind'] == 'stylus' for r in rows),
            'cancelled': sum(r['cancelled'] for r in rows),
            'viewport_changes': sum(r['rect_changed'] for r in rows),
            'filter_replay_matches': all(s.get('filter_replay_matches', False) for s in strokes),
            'device_pixel_ratio': sorted({r['device_pixel_ratio'] for r in rows}),
            'raw_sha256': hashlib.sha256(args.trace.read_bytes()).hexdigest(),
        },
        'scope': 'Point/JSON size reduction with existing rounding held fixed. No latency or power claim. Centerline deviation excludes pressure-dependent width and is not a visual-equivalence test.',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'provenance': args.provenance, 'summary': summary}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
