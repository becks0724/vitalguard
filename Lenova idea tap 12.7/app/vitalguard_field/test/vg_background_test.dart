import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/ui/shell/vg_background.dart';
import 'package:vitalguard_field/vg_theme.dart';

class _PaletteLuminanceRange {
  const _PaletteLuminanceRange({
    required this.minimum,
    required this.maximum,
    required this.minimumColor,
    required this.maximumColor,
  });

  final double minimum;
  final double maximum;
  final Color minimumColor;
  final Color maximumColor;
}

int _channel(Color color, int shift) => (color.toARGB32() >> shift) & 0xff;

_PaletteLuminanceRange _measurePalette(VgBackdrop backdrop) {
  final palette = vgBackdropPaletteForTesting(backdrop);

  // 현재 painter의 색 생성은 단조 RGB 그라데이션과 이 두 알파 선뿐이다.
  // stop과 각 stop 위의 선 합성색을 검사하면 팔레트나 알파 변경이 즉시 잡힌다.
  final colors = <Color>[
    ...palette.gradient,
    for (final background in palette.gradient) ...[
      Color.alphaBlend(
        palette.line.withValues(alpha: palette.gridOpacity),
        background,
      ),
      Color.alphaBlend(
        palette.line.withValues(alpha: palette.contourOpacity),
        background,
      ),
    ],
  ];

  for (final shift in [16, 8, 0]) {
    for (var i = 1; i < palette.gradient.length; i++) {
      expect(
        _channel(palette.gradient[i], shift),
        greaterThanOrEqualTo(_channel(palette.gradient[i - 1], shift)),
        reason: '${backdrop.name} 그라데이션 채널이 단조가 아니면 stop 사이에 새 극값이 생길 수 있다.',
      );
    }
  }

  var minimumColor = colors.first;
  var maximumColor = colors.first;
  for (final color in colors.skip(1)) {
    if (color.computeLuminance() < minimumColor.computeLuminance()) {
      minimumColor = color;
    }
    if (color.computeLuminance() > maximumColor.computeLuminance()) {
      maximumColor = color;
    }
  }
  return _PaletteLuminanceRange(
    minimum: minimumColor.computeLuminance(),
    maximum: maximumColor.computeLuminance(),
    minimumColor: minimumColor,
    maximumColor: maximumColor,
  );
}

double _contrast(Color foreground, Color background) {
  final bright = math.max(
    foreground.computeLuminance(),
    background.computeLuminance(),
  );
  final dark = math.min(
    foreground.computeLuminance(),
    background.computeLuminance(),
  );
  return (bright + 0.05) / (dark + 0.05);
}

void main() {
  test('팔레트 휘도와 반투명 카드 대비를 보장한다', () {
    final dark = _measurePalette(VgBackdrop.dark);
    final light = _measurePalette(VgBackdrop.light);

    expect(dark.minimum, greaterThanOrEqualTo(0.01));
    expect(dark.maximum, lessThanOrEqualTo(0.05));
    expect(light.minimum, greaterThanOrEqualTo(0.75));
    expect(light.maximum, lessThanOrEqualTo(0.92));

    final darkCard = Color.alphaBlend(
      vgBackdropCardSurface(VgBackdrop.dark)
          .withValues(alpha: vgCardSurfaceAlpha),
      dark.maximumColor,
    );
    final lightCard = Color.alphaBlend(
      vgBackdropCardSurface(VgBackdrop.light)
          .withValues(alpha: vgCardSurfaceAlpha),
      light.minimumColor,
    );
    final darkWhite = _contrast(Colors.white, darkCard);
    final lightInk = _contrast(VgColors.ink, lightCard);

    // ignore: avoid_print
    print(
      'VG_BG_PALETTE '
      'dark=${dark.minimum.toStringAsFixed(6)}..${dark.maximum.toStringAsFixed(6)} '
      'light=${light.minimum.toStringAsFixed(6)}..${light.maximum.toStringAsFixed(6)}',
    );
    // ignore: avoid_print
    print(
      'VG_CARD_CONTRAST alpha=${vgCardSurfaceAlpha.toStringAsFixed(2)} '
      'darkCardL=${darkCard.computeLuminance().toStringAsFixed(6)} '
      'white=${darkWhite.toStringAsFixed(3)} '
      'lightCardL=${lightCard.computeLuminance().toStringAsFixed(6)} '
      'ink=${lightInk.toStringAsFixed(3)}',
    );

    expect(darkWhite, greaterThanOrEqualTo(4.5));
    expect(lightInk, greaterThanOrEqualTo(4.5));
    expect(
      const VgBackgroundPainter(VgBackdrop.dark)
          .shouldRepaint(const VgBackgroundPainter(VgBackdrop.dark)),
      isFalse,
    );
    expect(
      const VgBackgroundPainter(VgBackdrop.light)
          .shouldRepaint(const VgBackgroundPainter(VgBackdrop.dark)),
      isTrue,
    );
  });
}
