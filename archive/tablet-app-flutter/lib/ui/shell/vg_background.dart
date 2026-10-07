import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../vg_theme.dart';

enum VgBackdrop { dark, light }

// 다크는 2026-09-12 태곤 님 결정으로 앱에서 쓰지 않는다. 팔레트는 측정값과 함께 보존한다.
VgBackdrop vgBackdropOf(BuildContext _) => VgBackdrop.light;

Color vgBackdropCardSurface(VgBackdrop backdrop) =>
    backdrop == VgBackdrop.dark ? VgColors.ink : VgColors.canvas;

class VgBackground extends StatelessWidget {
  const VgBackground({super.key, required this.backdrop});

  final VgBackdrop backdrop;

  @override
  Widget build(BuildContext context) => RepaintBoundary(
    child: CustomPaint(
      painter: VgBackgroundPainter(backdrop),
      isComplex: true,
      willChange: false,
      child: const SizedBox.expand(),
    ),
  );
}

class VgBackgroundPainter extends CustomPainter {
  const VgBackgroundPainter(this.backdrop);

  final VgBackdrop backdrop;

  _BackdropPalette get _palette => backdrop == VgBackdrop.dark
      ? const _BackdropPalette(
          gradient: [Color(0xFF171D24), Color(0xFF202C35), Color(0xFF26323B)],
          line: Color(0xFF6F8794),
          gridOpacity: 0.05,
          contourOpacity: 0.06,
        )
      : const _BackdropPalette(
          gradient: [Color(0xFFE4E9E9), Color(0xFFE7EBEA), Color(0xFFEFF0ED)],
          line: Color(0xFF94A5AB),
          gridOpacity: 0.025,
          contourOpacity: 0.03,
        );

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final palette = _palette;
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: palette.gradient,
          stops: const [0, 0.54, 1],
        ).createShader(rect),
    );
    _drawIsometricGrid(canvas, size, palette);
    _drawContours(canvas, size, palette);
  }

  void _drawIsometricGrid(Canvas canvas, Size size, _BackdropPalette palette) {
    final spacing = (size.shortestSide / 9).clamp(64.0, 120.0);
    final rise = size.height * 0.58;

    for (double y = 0; y <= size.height; y += spacing * 0.5) {
      _drawFadedLine(
        canvas,
        size,
        Offset(0, y),
        Offset(size.width, y),
        palette,
      );
    }
    for (double x = -size.height; x <= size.width + size.height; x += spacing) {
      _drawFadedLine(
        canvas,
        size,
        Offset(x, 0),
        Offset(x + rise, size.height),
        palette,
      );
      _drawFadedLine(
        canvas,
        size,
        Offset(x, 0),
        Offset(x - rise, size.height),
        palette,
      );
    }
  }

  void _drawFadedLine(
    Canvas canvas,
    Size size,
    Offset start,
    Offset end,
    _BackdropPalette palette,
  ) {
    final delta = end - start;
    final segments = math.max(1, (delta.distance / 30).ceil());
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..isAntiAlias = true;

    for (var i = 0; i < segments; i++) {
      final a = Offset(
        start.dx + delta.dx * i / segments,
        start.dy + delta.dy * i / segments,
      );
      final b = Offset(
        start.dx + delta.dx * (i + 1) / segments,
        start.dy + delta.dy * (i + 1) / segments,
      );
      final midpoint = Offset((a.dx + b.dx) / 2, (a.dy + b.dy) / 2);
      final strength = _edgeStrength(midpoint, size);
      if (strength <= 0) continue;
      paint.color = palette.line.withValues(
        alpha: palette.gridOpacity * strength,
      );
      canvas.drawLine(a, b, paint);
    }
  }

  double _edgeStrength(Offset point, Size size) {
    final nx = point.dx / size.width;
    final ny = point.dy / size.height;
    final edgeDistance = math.max((nx - 0.5).abs(), (ny - 0.5).abs());
    if (edgeDistance <= 0.35) return 0;
    final t = ((edgeDistance - 0.35) / 0.15).clamp(0.0, 1.0);
    return t * t * (3 - 2 * t);
  }

  void _drawContours(Canvas canvas, Size size, _BackdropPalette palette) {
    final paint = Paint()
      ..color = palette.line.withValues(alpha: palette.contourOpacity)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4
      ..strokeCap = StrokeCap.round
      ..isAntiAlias = true;

    final top = Path()
      ..moveTo(-size.width * 0.04, size.height * 0.10)
      ..cubicTo(
        size.width * 0.22,
        size.height * 0.035,
        size.width * 0.68,
        size.height * 0.15,
        size.width * 1.04,
        size.height * 0.07,
      );
    final bottom = Path()
      ..moveTo(-size.width * 0.04, size.height * 0.91)
      ..cubicTo(
        size.width * 0.30,
        size.height * 0.84,
        size.width * 0.72,
        size.height * 0.98,
        size.width * 1.04,
        size.height * 0.87,
      );
    final left = Path()
      ..moveTo(size.width * 0.08, -size.height * 0.04)
      ..cubicTo(
        size.width * 0.02,
        size.height * 0.28,
        size.width * 0.15,
        size.height * 0.70,
        size.width * 0.06,
        size.height * 1.04,
      );
    final right = Path()
      ..moveTo(size.width * 0.93, -size.height * 0.04)
      ..cubicTo(
        size.width * 1.01,
        size.height * 0.30,
        size.width * 0.86,
        size.height * 0.72,
        size.width * 0.96,
        size.height * 1.04,
      );

    canvas
      ..drawPath(top, paint)
      ..drawPath(bottom, paint)
      ..drawPath(left, paint)
      ..drawPath(right, paint);
  }

  @override
  bool shouldRepaint(covariant VgBackgroundPainter oldDelegate) =>
      oldDelegate.backdrop != backdrop;
}

/// 회귀 검사에서 실제 Painter와 같은 팔레트 값을 직접 확인하기 위한 읽기 전용 뷰다.
/// 그라데이션은 stop 사이를 선형 보간하고, 선은 이 색과 불투명도만 사용한다.
@visibleForTesting
({List<Color> gradient, Color line, double gridOpacity, double contourOpacity})
vgBackdropPaletteForTesting(VgBackdrop backdrop) {
  final palette = VgBackgroundPainter(backdrop)._palette;
  return (
    gradient: List<Color>.unmodifiable(palette.gradient),
    line: palette.line,
    gridOpacity: palette.gridOpacity,
    contourOpacity: palette.contourOpacity,
  );
}

class _BackdropPalette {
  const _BackdropPalette({
    required this.gradient,
    required this.line,
    required this.gridOpacity,
    required this.contourOpacity,
  });

  final List<Color> gradient;
  final Color line;
  final double gridOpacity;
  final double contourOpacity;
}
