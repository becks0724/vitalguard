// 이건 회귀 테스트가 아니라 일회성 측정이다.
// 선 교차·안티앨리어싱을 포함한 실제 픽셀을 다시 잴 때만 다음처럼 명시적으로 실행한다.
// flutter test tool/vg_background_full_measurement_test.dart --timeout none

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/ui/shell/vg_background.dart';

const _devicePixelRatio = 2.125;
const _landscape = Size(1385.4, 865.9);
const _portrait = Size(865.9, 1385.4);

final _linearChannel = List<double>.generate(256, (value) {
  final channel = value / 255;
  return channel <= 0.04045
      ? channel / 12.92
      : math.pow((channel + 0.055) / 1.055, 2.4).toDouble();
});

double _luminance(int red, int green, int blue) =>
    0.2126 * _linearChannel[red] +
    0.7152 * _linearChannel[green] +
    0.0722 * _linearChannel[blue];

Future<({double minimum, double maximum})> _renderAndMeasure(
  VgBackdrop backdrop,
  Size logicalSize,
) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)..scale(_devicePixelRatio);
  VgBackgroundPainter(backdrop).paint(canvas, logicalSize);
  final picture = recorder.endRecording();
  final width = (logicalSize.width * _devicePixelRatio).round();
  final height = (logicalSize.height * _devicePixelRatio).round();
  final image = await picture.toImage(width, height);
  final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
  final pixels = data!.buffer.asUint8List(
    data.offsetInBytes,
    data.lengthInBytes,
  );

  var minimum = double.infinity;
  var maximum = double.negativeInfinity;
  for (var offset = 0; offset < pixels.length; offset += 4) {
    final value = _luminance(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
    );
    minimum = math.min(minimum, value);
    maximum = math.max(maximum, value);
  }

  picture.dispose();
  image.dispose();
  return (minimum: minimum, maximum: maximum);
}

void main() {
  testWidgets('배경 네 장의 전 픽셀 휘도를 일회성으로 측정한다', (_) async {
    for (final backdrop in VgBackdrop.values) {
      for (final orientation in const [
        (name: 'landscape', size: _landscape),
        (name: 'portrait', size: _portrait),
      ]) {
        final value = await _renderAndMeasure(backdrop, orientation.size);
        // ignore: avoid_print
        print(
          'VG_BG_FULL ${backdrop.name} ${orientation.name}='
          '${value.minimum.toStringAsFixed(6)}..'
          '${value.maximum.toStringAsFixed(6)}',
        );
        if (backdrop == VgBackdrop.dark) {
          expect(value.minimum, greaterThanOrEqualTo(0.01));
          expect(value.maximum, lessThanOrEqualTo(0.05));
        } else {
          expect(value.minimum, greaterThanOrEqualTo(0.75));
          expect(value.maximum, lessThanOrEqualTo(0.92));
        }
      }
    }
  }, timeout: Timeout.none);
}
