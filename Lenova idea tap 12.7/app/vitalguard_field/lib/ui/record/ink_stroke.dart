import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui';

enum InkTool { pen, marker, rectangle, eraser }

class InkStroke {
  InkStroke(this.tool, this.color, this.width, this.points);
  final InkTool tool;
  final int color;
  final double width; // 원본 너비 대비 비율. 회전·확대와 무관하다.
  final List<List<double>> points; // 정규화 x,y와 압력
  Map<String, dynamic> toJson() => {
    'tool': tool.name,
    'color': color,
    'width': width,
    'points': points,
  };
  factory InkStroke.fromJson(Map<String, dynamic> j) => InkStroke(
    InkTool.values.byName(j['tool'] as String),
    j['color'] as int,
    (j['width'] as num).toDouble(),
    (j['points'] as List)
        .map((p) => (p as List).map((v) => (v as num).toDouble()).toList())
        .toList(),
  );
}

Uint8List encodeInk(Iterable<InkStroke> strokes) {
  // 옛 지우개만 걸러 보내면 지워졌던 원래 낙서가 노출된다. 먼저 복원 시 정리해야 한다.
  if (strokes.any((s) => s.tool == InkTool.eraser)) {
    throw StateError('저장된 지우개를 획 삭제로 변환해야 합니다');
  }
  return Uint8List.fromList(
    utf8.encode(
      jsonEncode({'v': 1, 'strokes': strokes.map((s) => s.toJson()).toList()}),
    ),
  );
}

typedef _Segment = ({Offset start, Offset end, double radius});

Iterable<_Segment> _segments(
  InkStroke stroke,
  double yScale, {
  bool eraserPressure = false,
}) sync* {
  if (stroke.points.isEmpty) return;
  Offset point(List<double> p) => Offset(p[0], p[1] * yScale);
  double radius(List<double> p) =>
      stroke.width /
      2 *
      (stroke.tool == InkTool.eraser && !eraserPressure
          ? 1
          : 0.45 + 0.9 * p[2].clamp(0.0, 1.0));
  if (stroke.tool == InkTool.rectangle) {
    final rect = Rect.fromPoints(
      point(stroke.points.first),
      point(stroke.points.last),
    );
    final corners = [
      rect.topLeft,
      rect.topRight,
      rect.bottomRight,
      rect.bottomLeft,
      rect.topLeft,
    ];
    for (var i = 1; i < corners.length; i++) {
      yield (start: corners[i - 1], end: corners[i], radius: stroke.width / 2);
    }
    return;
  }
  // 첫 점도 실제 그려지는 원으로 판정해 점 하나뿐인 획도 지운다.
  yield (
    start: point(stroke.points.first),
    end: point(stroke.points.first),
    radius: radius(stroke.points.first),
  );
  for (var i = 1; i < stroke.points.length; i++) {
    yield (
      start: point(stroke.points[i - 1]),
      end: point(stroke.points[i]),
      radius: radius(stroke.points[i]),
    );
  }
}

double _pointSegmentDistanceSquared(Offset p, Offset start, Offset end) {
  final delta = end - start;
  if (delta.distanceSquared == 0) return (p - start).distanceSquared;
  final relative = p - start;
  final t =
      ((relative.dx * delta.dx + relative.dy * delta.dy) /
              delta.distanceSquared)
          .clamp(0.0, 1.0);
  return (p - (start + delta * t)).distanceSquared;
}

double _segmentDistanceSquared(_Segment a, _Segment b) {
  double cross(Offset p, Offset q) => p.dx * q.dy - p.dy * q.dx;
  final da = a.end - a.start, db = b.end - b.start;
  final denominator = cross(da, db);
  if (denominator != 0) {
    final between = b.start - a.start;
    final t = cross(between, db) / denominator,
        u = cross(between, da) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return math.min(
    math.min(
      _pointSegmentDistanceSquared(a.start, b.start, b.end),
      _pointSegmentDistanceSquared(a.end, b.start, b.end),
    ),
    math.min(
      _pointSegmentDistanceSquared(b.start, a.start, a.end),
      _pointSegmentDistanceSquared(b.end, a.start, a.end),
    ),
  );
}

/// 접촉한 획을 전부 제거한다. 지우개는 이 목록에 추가하지 않는다.
bool eraseInkStrokes(
  List<InkStroke> strokes,
  InkStroke eraser,
  Size imageSize, {
  bool legacyPressure = false,
}) {
  // x와 y 모두 원본 너비 단위로 맞춰 세로/가로 사진에서도 반경이 원형이게 한다.
  final yScale = imageSize.height / imageSize.width;
  final path = _segments(
    eraser,
    yScale,
    eraserPressure: legacyPressure,
  ).toList();
  final before = strokes.length;
  strokes.removeWhere((stroke) {
    for (final ink in _segments(stroke, yScale)) {
      for (final sweep in path) {
        // 입력 점 사이를 잇는 경로도 검사해 빠른 드래그가 획을 건너뛰지 않는다.
        final radius = ink.radius + sweep.radius;
        if (_segmentDistanceSquared(ink, sweep) <= radius * radius) return true;
      }
    }
    return false;
  });
  return strokes.length != before;
}

List<InkStroke> restoreInkStrokes(Iterable<InkStroke> saved, Size imageSize) {
  final result = <InkStroke>[];
  // 옛 초안의 지우개를 시간순으로 적용한다. 지운 낙서와 지우개를 둘 다 폐기한다.
  for (final stroke in saved) {
    if (stroke.tool == InkTool.eraser) {
      eraseInkStrokes(result, stroke, imageSize, legacyPressure: true);
    } else {
      result.add(stroke);
    }
  }
  return result;
}
