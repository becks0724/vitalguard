// 현재 상태 링 — 참고 디자인(2026-08-18 사용자 제공)의 배치만 가져온 것
//
// ★★ 참고 디자인의 링은 **목표 대비 진행률**(남은 칼로리)이다. 이 앱에는 목표 개념이 없다 —
// `목표`·`goal`·`target`·근무 시간 전부 0건이고, 걸음에 하루 8,000보 같은 기준을 붙이면
// 그건 없는 기준을 우리가 만드는 것이다(HRV·호흡수에 의학 참고범위를 넣지 않기로 한 것과 같은 계열).
//
// 그래서 **호의 길이를 진행률로 쓰지 않는다.** 호는 이미 근거가 있는 임계 밴드
// (severity.ts · THRESHOLDS)를 그대로 두르고, 현재 값은 그 위의 **위치 표식**으로만 찍는다.
// 아래 막대와 정확히 같은 규칙이고, 원으로 감았을 뿐이다.
import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'metric_tile.dart';
import 'theme.dart';
import 'vital_range.dart';

/// 게이지 시작각·스윕 — 아래를 비운 270° 호. 빈 자리에 상태 배지가 들어간다.
const double _startAngle = math.pi * 0.75; // 7시 30분 방향
const double _sweep = math.pi * 1.5; // 270°

class _RingPainter extends CustomPainter {
  _RingPainter({
    required this.range,
    required this.value,
    required this.stroke,
  });

  final VitalRange range;
  final double value;
  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(
      stroke / 2,
      stroke / 2,
      size.width - stroke,
      size.height - stroke,
    );
    final span = range.max - range.min;

    // 밴드를 호로 두른다 — 색은 막대와 같은 규칙이라 두 표현이 갈리지 않는다.
    for (final b in range.bands) {
      final from = (b.from - range.min) / span;
      final to = (b.to - range.min) / span;
      canvas.drawArc(
        rect,
        _startAngle + _sweep * from,
        _sweep * (to - from),
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = stroke
          ..color = vgStatusColor(b.status).withValues(alpha: 0.28),
      );
    }

    // 현재 위치 표식. 구간 밖 값은 positionOf 가 끝에 붙인다(막대와 동일).
    final t = _startAngle + _sweep * range.positionOf(value);
    final r = (size.width - stroke) / 2;
    final c = Offset(
      size.width / 2 + r * math.cos(t),
      size.height / 2 + r * math.sin(t),
    );
    canvas
      ..drawCircle(c, stroke * 0.62, Paint()..color = VgColors.canvas)
      ..drawCircle(
        c,
        stroke * 0.62,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3
          ..color = vgStatusColor(range.statusOf(value)),
      );
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.value != value || old.range != range || old.stroke != stroke;
}

/// 링 + 가운데 값. 링은 **상태**를 말하고 호 길이는 진행률이 아니다.
class StatusRing extends StatelessWidget {
  const StatusRing({
    super.key,
    required this.range,
    required this.value,
    required this.unit,
    this.size = 124,
  });

  final VitalRange range;
  final double value;
  final String unit;
  final double size;

  @override
  Widget build(BuildContext context) {
    final status = range.statusOf(value);
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _RingPainter(range: range, value: value, stroke: 9),
        child: Center(
          // ★ 폰트에 기대지 않는다 — 기기 폰트(SF Pro)와 테스트 폰트가 다르고 세 자리 심박(150)이
          //   두 자리보다 넓다. 고정 크기로 두면 어느 조합에서 넘칠지 매번 재야 하므로
          //   원 안쪽 폭 안에서 **줄여 맞춘다**(넘치면 축소, 남으면 원래 크기).
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: size * 0.17),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        value.toStringAsFixed(0),
                        style: TextStyle(
                          fontSize: 34,
                          fontWeight: FontWeight.bold,
                          height: 1.0,
                          color: vgValueColor(status),
                        ),
                      ),
                      const SizedBox(width: 3),
                      Text(
                        unit,
                        style: const TextStyle(
                          fontSize: 12,
                          color: VgColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: StatusBadge(status: status),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 링 좌우에 놓이는 보조 값. **상태를 붙일지는 호출부가 정한다** —
/// 추정 체온처럼 판정에 올리지 않기로 한 값에는 status 를 주지 않는다.
///
/// ★ 미수신이어도 **칸을 비우지 않는다.** 한쪽이 사라지면 링이 치우쳐 보이고(실기기 확인),
/// 무엇이 안 오고 있는지도 화면에서 사라진다. 값 자리에 `--` 를 둔다(0 이 아니라 모름).
class RingSideValue extends StatelessWidget {
  const RingSideValue({
    super.key,
    required this.label,
    required this.value,
    required this.unit,
    this.status,
    this.note,
  });

  final String label;
  final String value;
  final String unit;
  final VitalStatus? status;
  final String? note;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
                height: 1.1,
                color: vgValueColor(status),
              ),
            ),
            const SizedBox(width: 2),
            Text(
              unit,
              style: const TextStyle(fontSize: 11, color: VgColors.muted),
            ),
          ],
        ),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(fontSize: 11, color: VgColors.body)),
        const SizedBox(height: 3),
        if (status != null)
          StatusBadge(status: status!)
        else
          Text(
            note ?? '',
            style: const TextStyle(fontSize: 10, color: VgColors.muted),
          ),
      ],
    );
  }
}
