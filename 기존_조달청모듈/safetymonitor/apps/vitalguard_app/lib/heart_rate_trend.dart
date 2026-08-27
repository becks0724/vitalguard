// 심박 히어로 카드와 그 추이 그래프 — 참고 디자인(사용자 제공)의 배치를 옮긴 것
//
// ★ 값은 폰이 실제로 받은 심박만 쓴다. 네이티브는 최신 스냅숏만 밀어 주므로 이력은
//   여기서 모은다. 점이 모자라면 선 대신 "심박 수집 중" 을 적는다 — 빈 차트에 평평한
//   선을 그으면 "안정적" 이라는 없는 사실을 말하게 된다.
// ⚠ 임계·색을 여기서 새로 만들지 않는다. 판정은 `heartRateRange.statusOf`(=관제웹
//   severity.ts), 색은 `vgStatusColor`·`vgValueColor` 다. vital_range.dart 의 규칙과 같다.
import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'metric_tile.dart';
import 'theme.dart';
import 'vital_range.dart';

/// 한 점 = 한 번의 실측. 시각은 전송 시각이 아니라 **측정** 시각이다.
class HeartRateSample {
  const HeartRateSample(this.at, this.bpm);

  final DateTime at;
  final double bpm;
}

/// 심박 이력 링버퍼. 화면이 사는 동안만 유지한다(앱을 다시 켜면 비어 있다).
///
/// ⚠ 1분에 한 점만 남긴다 — 5초마다 오는 값을 그대로 쌓으면 3시간 창이 점 2,160개가
///   되고, 상한에 먼저 닿아 창이 조용히 짧아진다. 같은 버킷은 최신 값으로 덮는다.
class HeartRateHistory {
  static const Duration window = Duration(hours: 3);
  static const Duration _bucket = Duration(minutes: 1);
  static const double _plausibleMin = 25;
  static const double _plausibleMax = 250;

  final List<HeartRateSample> _samples = [];

  /// 지금 버킷이 열린 시각. ⚠ **직전 점의 시각이 아니다** — 직전 점을 기준으로 재면 기준이
  /// 매번 앞으로 밀려, 20초 간격으로 계속 들어오는 동안 새 점이 영영 안 생긴다(점 1개 고정).
  DateTime? _bucketAt;

  List<HeartRateSample> get samples => List.unmodifiable(_samples);

  /// 새 실측을 넣는다. 같은 측정이 두 번 오면(배치가 누적 스냅숏을 통째로 보낸다) 버린다.
  bool add(double bpm, DateTime at) {
    if (bpm < _plausibleMin || bpm > _plausibleMax) return false;
    if (_samples.isNotEmpty && !at.isAfter(_samples.last.at)) return false;

    if (_bucketAt != null &&
        _samples.isNotEmpty &&
        at.difference(_bucketAt!) < _bucket) {
      _samples[_samples.length - 1] = HeartRateSample(at, bpm);
    } else {
      _bucketAt = at;
      _samples.add(HeartRateSample(at, bpm));
    }

    final cutoff = at.subtract(window);
    _samples.removeWhere((s) => s.at.isBefore(cutoff));
    return true;
  }
}

/// 심박 히어로 카드 — 현재값·상태·추이·평균/최소/최대를 한 장에 담는다.
class HeartRateHeroCard extends StatelessWidget {
  const HeartRateHeroCard({
    super.key,
    required this.bpm,
    required this.history,
    this.footnote,
  });

  /// 지금 값. 미수신이면 null 이고 화면은 `--` 를 적는다.
  final double? bpm;
  final List<HeartRateSample> history;

  /// 카드 맨 아래 한 줄(측정 시각·배치 번호 등). 없으면 줄 자체가 없다.
  final String? footnote;

  @override
  Widget build(BuildContext context) {
    final status = bpm == null
        ? VitalStatus.idle
        : heartRateRange.statusOf(bpm!);
    final tint = vgStatusColor(status);
    final values = history.map((s) => s.bpm).toList();

    return Card(
      color: VgColors.primarySubtle,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(vgCardRadius),
        side: const BorderSide(color: VgColors.primaryRing),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  bpm == null ? '--' : bpm!.toStringAsFixed(0),
                  style: TextStyle(
                    fontSize: 44,
                    height: 1.0,
                    fontWeight: FontWeight.w800,
                    color: vgValueColor(bpm == null ? null : status),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.only(left: 6, bottom: 4),
                  child: Text(
                    'BPM',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: VgColors.body,
                    ),
                  ),
                ),
                const Spacer(),
                Padding(
                  padding: const EdgeInsets.only(bottom: 2),
                  child: _StatusPill(status: status, tint: tint),
                ),
              ],
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 150,
              // ★ 안내 문구는 Canvas 가 아니라 위젯으로 올린다 — 캔버스에 그리면 시험도
              //   스크린리더도 못 읽고, "안내가 떴다" 를 아무도 확인할 수 없다.
              child: history.length < 2
                  // ⚠ 문구에 "누적" 을 쓰지 않는다 — 홈에 전송·누적 표기가 없어야 한다는
                  //   기존 가드(settings_screen_test)가 부분 문자열로 잡는다. 이 앱의
                  //   어휘는 "수집" 이다(설정 화면 섹션 제목과 같은 말).
                  ? const Center(
                      child: Text(
                        '심박 수집 중',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: VgColors.muted,
                        ),
                      ),
                    )
                  : CustomPaint(
                      painter: HeartRateTrendPainter(
                        samples: history,
                        highlight: tint,
                      ),
                      child: const SizedBox.expand(),
                    ),
            ),
            const SizedBox(height: 8),
            const Divider(height: 1, color: VgColors.hairlineStrong),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: _SummaryColumn(label: '평균', value: _mean(values)),
                ),
                const _SummaryDivider(),
                Expanded(
                  child: _SummaryColumn(
                    label: '최소',
                    value: _extreme(values, min: true),
                  ),
                ),
                const _SummaryDivider(),
                Expanded(
                  child: _SummaryColumn(
                    label: '최대',
                    value: _extreme(values, min: false),
                  ),
                ),
              ],
            ),
            if (footnote != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  // 폰엔 활동 게이트가 없다 — 이 표기가 빠지면 작업 중 상승이 "주의" 로 읽힌다.
                  Text(
                    heartRateRange.basis,
                    style: const TextStyle(fontSize: 10, color: VgColors.muted),
                  ),
                  const Spacer(),
                  Flexible(
                    child: Text(
                      footnote!,
                      textAlign: TextAlign.right,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 10,
                        color: VgColors.muted,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// ⚠ 점 하나로는 평균·최소·최대를 말하지 않는다 — 차트가 "수집 중" 인데 요약만 숫자를
  ///   적으면 화면 두 곳이 다른 말을 한다. 기준을 차트와 같은 2점으로 맞춘다.
  static bool _enough(List<double> values) => values.length >= 2;

  static double? _mean(List<double> values) {
    if (!_enough(values)) return null;
    return values.reduce((a, b) => a + b) / values.length;
  }

  static double? _extreme(List<double> values, {required bool min}) {
    if (!_enough(values)) return null;
    return values.reduce(min ? math.min : math.max);
  }
}

/// 상태 배지 — 색만으로 읽게 두지 않고 글자를 함께 적는다(현장 조명·색각 이상).
class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status, required this.tint});

  final VitalStatus status;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: tint.withValues(alpha: 0.42)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 24,
            height: 24,
            decoration: BoxDecoration(color: tint, shape: BoxShape.circle),
            child: const Icon(Icons.favorite, size: 13, color: Colors.white),
          ),
          const SizedBox(width: 7),
          Text(
            vitalStatusLabel[status] ?? '',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: tint,
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryColumn extends StatelessWidget {
  const _SummaryColumn({required this.label, required this.value});

  final String label;
  final double? value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: VgColors.body,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value == null ? '--' : value!.toStringAsFixed(0),
          style: const TextStyle(
            fontSize: 21,
            height: 1.0,
            fontWeight: FontWeight.w800,
            color: VgColors.ink,
          ),
        ),
        const SizedBox(height: 2),
        const Text(
          'BPM',
          style: TextStyle(fontSize: 10, color: VgColors.muted),
        ),
      ],
    );
  }
}

class _SummaryDivider extends StatelessWidget {
  const _SummaryDivider();

  @override
  Widget build(BuildContext context) {
    return Container(width: 1, height: 40, color: VgColors.hairlineStrong);
  }
}

/// 추이 그래프. 점이 2개 미만이면 선을 그리지 않고 안내를 적는다.
class HeartRateTrendPainter extends CustomPainter {
  HeartRateTrendPainter({required this.samples, required this.highlight});

  final List<HeartRateSample> samples;
  final Color highlight;

  static const double _gutter = 34;
  static const double _axisHeight = 20;
  static const double _bubbleHeight = 24;
  static const double _gridStep = 20;

  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTWH(
      _gutter,
      _bubbleHeight,
      size.width - _gutter - 8,
      size.height - _bubbleHeight - _axisHeight,
    );
    if (plot.width <= 8 || plot.height <= 8) return;

    // 점이 모자란 경우는 카드가 안내 위젯으로 대신한다 — 여기까지 오지 않는다.
    if (samples.length < 2) return;

    final values = samples.map((s) => s.bpm).toList();
    final lowest = values.reduce(math.min);
    final highest = values.reduce(math.max);
    final lower = (lowest / _gridStep).floorToDouble() * _gridStep;
    var upper = (highest / _gridStep).ceilToDouble() * _gridStep;
    // 값이 거의 일정하면 눈금이 한 칸도 안 생긴다 — 최소 두 칸은 벌려 둔다.
    if (upper - lower < _gridStep * 2) upper = lower + _gridStep * 2;
    final span = upper - lower;

    final start = samples.first.at.millisecondsSinceEpoch.toDouble();
    final end = samples.last.at.millisecondsSinceEpoch.toDouble();
    final timeSpan = math.max(end - start, 1.0);

    final grid = Paint()
      ..color = VgColors.hairlineStrong
      ..strokeWidth = 0.6;
    for (var level = lower; level <= upper; level += _gridStep) {
      final y = plot.bottom - plot.height * ((level - lower) / span);
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), grid);
      final label = _text(
        level.toStringAsFixed(0),
        10,
        FontWeight.w600,
        VgColors.muted,
      )..layout(minWidth: _gutter - 8, maxWidth: _gutter - 8);
      label.paint(canvas, Offset(0, y - 7));
    }

    final points = samples
        .map(
          (s) => Offset(
            plot.left +
                plot.width *
                    ((s.at.millisecondsSinceEpoch.toDouble() - start) /
                        timeSpan),
            plot.bottom - plot.height * ((s.bpm - lower) / span),
          ),
        )
        .toList();

    final curve = _smoothPath(points);

    // 곡선 아래 옅은 면 — 값이 아니라 흐름을 읽게 한다.
    final area = Path.from(curve)
      ..lineTo(plot.right, plot.bottom)
      ..lineTo(plot.left, plot.bottom)
      ..close();
    canvas.drawPath(
      area,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            VgColors.ink.withValues(alpha: 0.14),
            VgColors.ink.withValues(alpha: 0.0),
          ],
        ).createShader(plot),
    );

    final marker = Offset(
      points.last.dx.clamp(plot.left + 4, plot.right - 4),
      points.last.dy,
    );

    // 최신 값 강조 막대는 선 아래에 깔아 곡선을 가리지 않게 한다.
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTRB(marker.dx - 4, marker.dy, marker.dx + 4, plot.bottom),
        const Radius.circular(4),
      ),
      Paint()..color = highlight,
    );

    canvas.drawPath(
      curve,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = VgColors.ink,
    );

    canvas.drawCircle(marker, 5, Paint()..color = VgColors.canvas);
    canvas.drawCircle(
      marker,
      5,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..color = VgColors.ink,
    );

    // 현재값 말풍선
    final bubble = _text(
      samples.last.bpm.toStringAsFixed(0),
      12,
      FontWeight.w800,
      VgColors.canvas,
    )..layout();
    final bubbleWidth = bubble.width + 18;
    final bubbleLeft = (marker.dx - bubbleWidth / 2).clamp(
      0.0,
      size.width - bubbleWidth,
    );
    final bubbleTop = math.max(marker.dy - _bubbleHeight - 6, 0.0);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(bubbleLeft, bubbleTop, bubbleWidth, _bubbleHeight - 4),
        const Radius.circular(10),
      ),
      Paint()..color = VgColors.ink,
    );
    bubble.paint(canvas, Offset(bubbleLeft + 9, bubbleTop + 2));

    // 가로축 시각 — 마지막 눈금이 현재라 그것만 진하게 둔다.
    const tickCount = 4;
    for (var i = 0; i < tickCount; i++) {
      final ratio = i / (tickCount - 1);
      final at = DateTime.fromMillisecondsSinceEpoch(
        (start + timeSpan * ratio).round(),
      );
      final isLatest = i == tickCount - 1;
      final tick = _text(
        '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}',
        10,
        isLatest ? FontWeight.w800 : FontWeight.w600,
        isLatest ? VgColors.ink : VgColors.muted,
      )..layout(minWidth: 52, maxWidth: 52);
      final left = (plot.left + plot.width * ratio - 26).clamp(
        0.0,
        size.width - 52,
      );
      tick.paint(canvas, Offset(left, plot.bottom + 5));
    }
  }

  /// Catmull-Rom 을 3차 베지어로 옮겨 각진 꺾임 없이 잇는다.
  static Path _smoothPath(List<Offset> points) {
    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (var i = 0; i < points.length - 1; i++) {
      final previous = points[math.max(i - 1, 0)];
      final current = points[i];
      final next = points[i + 1];
      final following = points[math.min(i + 2, points.length - 1)];
      path.cubicTo(
        current.dx + (next.dx - previous.dx) / 6,
        current.dy + (next.dy - previous.dy) / 6,
        next.dx - (following.dx - current.dx) / 6,
        next.dy - (following.dy - current.dy) / 6,
        next.dx,
        next.dy,
      );
    }
    return path;
  }

  static TextPainter _text(
    String value,
    double size,
    FontWeight weight,
    Color color,
  ) {
    return TextPainter(
      text: TextSpan(
        text: value,
        style: TextStyle(fontSize: size, fontWeight: weight, color: color),
      ),
      textAlign: TextAlign.center,
      textDirection: TextDirection.ltr,
    );
  }

  @override
  bool shouldRepaint(covariant HeartRateTrendPainter old) =>
      old.samples.length != samples.length ||
      old.highlight != highlight ||
      (samples.isNotEmpty &&
          old.samples.isNotEmpty &&
          old.samples.last.bpm != samples.last.bpm);
}
