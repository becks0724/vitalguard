import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/models/record_origin.dart';
import 'package:vitalguard_field/ui/record/record_editor.dart';

InkStroke line(double y, {InkTool tool = InkTool.pen}) =>
    InkStroke(tool, 0xff000000, 0.004, [
      [0.1, y, 0.5],
      [0.9, y, 0.5],
    ]);

InkStroke eraser(List<List<double>> points, {double width = 0.028}) =>
    InkStroke(InkTool.eraser, 0, width, points);

void main() {
  test('지우개가 중간 선분에 닿은 획을 통째로 모두 제거한다', () {
    final first = line(0.3), second = line(0.6), untouched = line(0.9);
    final strokes = [first, second, untouched];
    expect(
      eraseInkStrokes(
        strokes,
        eraser([
          [0.5, 0.2, 1],
          [0.5, 0.7, 1],
        ]),
        const Size(1000, 650),
      ),
      isTrue,
    );
    expect(strokes, [untouched]);
    expect(first.points, [
      [0.1, 0.3, 0.5],
      [0.9, 0.3, 0.5],
    ]);
    expect(jsonDecode(utf8.decode(encodeInk(strokes)))['strokes'], [
      untouched.toJson(),
    ]);
  });

  test('사진 종횡비를 반영해 너비 기준 반경을 세로에도 똑같이 적용한다', () {
    for (final size in [const Size(1000, 250), const Size(250, 1000)]) {
      final hit = [line(0.5)], miss = [line(0.5)];
      final scale = size.width / size.height;
      expect(
        eraseInkStrokes(
          hit,
          eraser([
            [0.5, 0.5 + 0.009 * scale, 0.2],
          ], width: 0.02),
          size,
        ),
        isTrue,
      );
      expect(
        eraseInkStrokes(
          miss,
          eraser([
            [0.5, 0.5 + 0.02 * scale, 1],
          ], width: 0.02),
          size,
        ),
        isFalse,
      );
    }
  });

  test('사각형은 대각선이나 내부가 아닌 네 테두리로 판정한다', () {
    final rectangle = InkStroke(InkTool.rectangle, 0xff000000, 0.004, [
      [0.2, 0.2, 1],
      [0.8, 0.8, 1],
    ]);
    final strokes = [rectangle];
    expect(
      eraseInkStrokes(
        strokes,
        eraser([
          [0.5, 0.5, 1],
        ]),
        const Size(1000, 1000),
      ),
      isFalse,
    );
    expect(
      eraseInkStrokes(
        strokes,
        eraser([
          [0.2, 0.5, 1],
        ]),
        const Size(1000, 1000),
      ),
      isTrue,
    );
    expect(strokes, isEmpty);
  });

  test('점 하나, 중복점, 선분 끝과 형광펜 굵기도 판정한다', () {
    final dot = InkStroke(InkTool.pen, 0xff000000, 0.004, [
      [0.5, 0.5, 0.5],
    ]);
    final repeated = InkStroke(InkTool.pen, 0xff000000, 0.004, [
      [0.5, 0.5, 1],
      [0.5, 0.5, 1],
    ]);
    final marker = InkStroke(InkTool.marker, 0xff000000, 0.04, [
      [0.2, 0.5, 1],
      [0.8, 0.5, 1],
    ]);
    final strokes = [dot, repeated, marker];
    expect(
      eraseInkStrokes(
        strokes,
        eraser([
          [0.5, 0.535, 1],
        ], width: 0.02),
        const Size(1000, 1000),
      ),
      isTrue,
    );
    expect(strokes, [dot, repeated]);
    eraseInkStrokes(
      strokes,
      eraser([
        [0.5, 0.5, 1],
      ]),
      const Size(1000, 1000),
    );
    expect(strokes, isEmpty);
    final end = [line(0.5)];
    expect(
      eraseInkStrokes(
        end,
        eraser([
          [0.93, 0.5, 1],
        ]),
        const Size(1000, 1000),
      ),
      isFalse,
    );
    expect(
      eraseInkStrokes(
        end,
        eraser([
          [0.91, 0.5, 1],
        ]),
        const Size(1000, 1000),
      ),
      isTrue,
    );
  });

  test('옛 지우개는 압력과 저장 순서대로 적용하며 그 뒤에 그린 획은 남긴다', () {
    final deleted = line(0.5), after = line(0.5), untouched = line(0.8);
    final saved = [
      deleted,
      untouched,
      eraser([
        [0.5, 0.519, 1],
      ]),
      after,
    ];
    final restored = restoreInkStrokes(saved, const Size(1000, 1000));
    expect(restored, [untouched, after]);
    final json = jsonDecode(utf8.decode(encodeInk(restored))) as Map;
    expect(json['v'], isA<int>());
    expect(json['v'], 1);
    expect(json['strokes'], [untouched.toJson(), after.toJson()]);
    expect(utf8.decode(encodeInk(restored)), isNot(contains('eraser')));
    // 정리하지 않은 옛 초안을 단순 필터링해서 내보내는 우회는 차단한다.
    expect(() => encodeInk(saved), throwsStateError);
  });

  test('빈 잉크도 v:1 버전으로 직렬화하며 2MB 경계를 정확히 구분한다', () {
    expect(jsonDecode(utf8.decode(encodeInk([]))), {'v': 1, 'strokes': []});
    expect(inkUploadSizeError(maxInkUploadBytes), isNull);
    expect(inkUploadSizeError(maxInkUploadBytes + 1), contains('2,097,152'));
  });

  test('반올림하지 않은 실제 double 점으로 잉크 JSON 크기를 측정한다', () {
    for (final sample in [(10, 100), (100, 100), (100, 400)]) {
      final random = math.Random(127);
      final strokes = List.generate(
        sample.$1,
        (_) => InkStroke(
          InkTool.pen,
          0xffdc2626,
          0.004,
          List.generate(
            sample.$2,
            (_) => [
              random.nextDouble(),
              random.nextDouble(),
              random.nextDouble(),
            ],
          ),
        ),
      );
      final bytes = encodeInk(strokes);
      debugPrint(
        'INK_SIZE strokes=${sample.$1} pointsPerStroke=${sample.$2} bytes=${bytes.length} KB=${(bytes.length / 1024).toStringAsFixed(2)}',
      );
      expect(
        (jsonDecode(utf8.decode(bytes))['strokes'] as List).length,
        sample.$1,
      );
      expect(inkUploadSizeError(bytes.length) != null, sample.$2 == 400);
    }
  });

  test('반올림한 100획×400점의 잉크 JSON은 업로드 크기 한도 이내다', () {
    final random = math.Random(127);
    final strokes = List.generate(
      100,
      (_) => InkStroke(
        InkTool.pen,
        0xffdc2626,
        0.004,
        List.generate(
          400,
          (_) => [
            (random.nextDouble() * 10000).round() / 10000,
            (random.nextDouble() * 10000).round() / 10000,
            (random.nextDouble() * 100).round() / 100,
          ],
        ),
      ),
    );
    final bytes = encodeInk(strokes);
    debugPrint(
      'INK_SIZE_ROUNDED strokes=100 pointsPerStroke=400 bytes=${bytes.length} KB=${(bytes.length / 1024).toStringAsFixed(2)}',
    );
    expect(bytes.length, lessThanOrEqualTo(maxInkUploadBytes));
    expect(inkUploadSizeError(bytes.length), isNull);
  });

  test('획 삭제 후 렌더는 원본 픽셀을 보존하고 형광펜 투명도도 유지한다', () async {
    final baseRecorder = ui.PictureRecorder();
    Canvas(baseRecorder).drawColor(Colors.white, BlendMode.src);
    final basePicture = baseRecorder.endRecording();
    final base = await basePicture.toImage(100, 100);
    basePicture.dispose();
    Future<List<int>> pixel(
      List<InkStroke> strokes, {
      bool originalOnly = false,
    }) async {
      final recorder = ui.PictureRecorder();
      paintAnnotation(
        Canvas(recorder),
        const Size(100, 100),
        base,
        strokes,
        originalOnly: originalOnly,
      );
      final picture = recorder.endRecording();
      final result = await picture.toImage(100, 100);
      final bytes = (await result.toByteData())!;
      final value = bytes.buffer.asUint8List().sublist(
        4 * (50 * 100 + 50),
        4 * (50 * 100 + 50) + 4,
      );
      result.dispose();
      picture.dispose();
      return value;
    }

    final strokes = [
      InkStroke(InkTool.marker, 0xffff0000, 0.1, [
        [0.1, 0.5, 0.5],
        [0.9, 0.5, 0.5],
      ]),
    ];
    expect(await pixel(strokes), [255, closeTo(166, 1), closeTo(166, 1), 255]);
    expect(await pixel(strokes, originalOnly: true), [255, 255, 255, 255]);
    eraseInkStrokes(
      strokes,
      eraser([
        [0.5, 0.5, 1],
      ]),
      const Size(100, 100),
    );
    expect(await pixel(strokes), [255, 255, 255, 255]);
    base.dispose();
  });
}
