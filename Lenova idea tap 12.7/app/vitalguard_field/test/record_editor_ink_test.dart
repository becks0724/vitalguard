import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/record_editor.dart';
import 'package:vitalguard_field/ui/record/record_session.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';
import 'package:vitalguard_field/vg_theme.dart';

final original = CalendarMedia({
  'id': 'mock-original-001',
  'date_key': '2026-09-13',
  'media_url': 'https://mock.invalid/original.png',
});

const _editorLabels = {
  'tool-pen': '펜',
  'tool-marker': '형광펜',
  'tool-rectangle': '사각형',
  'tool-eraser': '지우개',
  'width-thin': '가늘게',
  'width-normal': '보통',
  'width-thick': '굵게',
  'color-red': '빨간 펜',
  'color-black': '검정 펜',
  'color-blue': '파란 펜',
  'undo': '마지막 획 되돌리기',
  'clear-all': '전체 지우기',
  'original-only': '원본만 보기',
  'zoom-in': '확대',
  'zoom-out': '축소',
  'pan-left': '왼쪽으로 이동',
  'pan-right': '오른쪽으로 이동',
  'pan-up': '위로 이동',
  'pan-down': '아래로 이동',
  'fit-width': '폭 맞춤',
};

class _Gateway extends MockGateway {
  final uploads = <({Uint8List bytes, Map<String, String> fields})>[];
  final receipts = <CalendarMedia>[];
  ApiFailure? failure;
  int imageReads = 0;
  @override
  Future<Uint8List> image(String url) async {
    imageReads++;
    return super.image(url);
  }

  @override
  Future<CalendarMedia> upload(
    String token,
    Uint8List bytes,
    Map<String, String> fields,
  ) async {
    uploads.add((bytes: Uint8List.fromList(bytes), fields: Map.of(fields)));
    if (failure != null) throw failure!;
    final receipt = await super.upload(token, bytes, fields);
    receipts.add(receipt);
    return receipt;
  }
}

class _FailingStore extends MemoryStore {
  bool failWrites = false;
  @override
  Future<void> writeBytes(String accountId, String key, Uint8List bytes) async {
    if (failWrites) throw StateError('저장 공간 부족');
    await super.writeBytes(accountId, key, bytes);
  }
}

class _CountingStore extends MemoryStore {
  int annotationWrites = 0;

  @override
  Future<void> write(String accountId, String key, String value) {
    if (key.startsWith('annotation:')) annotationWrites++;
    return super.write(accountId, key, value);
  }
}

Future<FieldCoordinator> _controllerFor(
  _Gateway gateway,
  MemoryStore store,
) async {
  final controller = FieldCoordinator(gateway, store, MockSpeechInput());
  await controller.signIn('ink-user', 'mock');
  return controller;
}

Future<void> until(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 100 && finder.evaluate().isEmpty; i++) {
    // 이미지 코덱과 로컬 합성은 Flutter 엔진의 실제 비동기 작업이다.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 10)),
    );
    await tester.pump(const Duration(milliseconds: 50));
  }
  expect(finder, findsOneWidget);
  await tester.pumpAndSettle();
}

Future<void> open(
  WidgetTester tester,
  FieldCoordinator controller, {
  CalendarMedia? source,
  bool asRoute = false,
  bool inShell = false,
  Size size = const Size(1385, 1000),
  double devicePixelRatio = 1,
  double scale = 1,
}) async {
  tester.view.devicePixelRatio = devicePixelRatio;
  tester.view.physicalSize = size;
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  if (inShell) {
    // 실제 셸의 80dp 레일과 ActionDock 제약 안에서 편집기를 연다.
    await tester.runAsync(() => controller.photoBytes(source ?? original));
    await RecordSession(controller).remember(source ?? original, ink: true);
  }
  await tester.pumpWidget(
    MaterialApp(
      theme: vgLightTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: inShell
          ? FieldShell(controller: controller)
          : asRoute
          ? Builder(
              builder: (context) => TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => RecordEditor(
                      controller: controller,
                      original: source ?? original,
                    ),
                  ),
                ),
                child: const Text('편집기 열기'),
              ),
            )
          : RecordEditor(
              key: UniqueKey(),
              controller: controller,
              original: source ?? original,
            ),
    ),
  );
  if (asRoute) {
    await tester.tap(find.text('편집기 열기'));
    await tester.pump();
  }
  await until(tester, find.byKey(const Key('ink-canvas')));
}

Future<void> openOnTablet(
  WidgetTester tester,
  FieldCoordinator controller, {
  double scale = 1,
}) => open(
  tester,
  controller,
  inShell: true,
  size: const Size(1840, 2944),
  devicePixelRatio: 2.125,
  scale: scale,
);

Offset at(WidgetTester tester, double x, double y) {
  final canvas = tester.getRect(find.byKey(const Key('ink-canvas')));
  final fitted = applyBoxFit(
    BoxFit.contain,
    const Size(1000, 650),
    canvas.size,
  ).destination;
  final rect = Rect.fromCenter(
    center: canvas.center,
    width: fitted.width,
    height: fitted.height,
  );
  return Offset(rect.left + x * rect.width, rect.top + y * rect.height);
}

Future<void> draw(
  WidgetTester tester,
  double y, {
  PointerDeviceKind kind = PointerDeviceKind.stylus,
}) async {
  final gesture = await tester.startGesture(at(tester, 0.2, y), kind: kind);
  await gesture.moveTo(at(tester, 0.8, y));
  await gesture.up();
  await tester.pump();
}

Future<void> erase(WidgetTester tester, {bool cancel = false}) async {
  await tester.tap(find.byKey(const Key('editor-tool-eraser')));
  await tester.pump();
  final gesture = await tester.startGesture(
    at(tester, 0.5, 0.3),
    kind: PointerDeviceKind.stylus,
  );
  await gesture.moveTo(at(tester, 0.5, 0.7));
  await tester.pump();
  if (cancel) {
    await gesture.cancel();
  } else {
    await gesture.up();
  }
  await tester.pump();
}

Future<Map<String, dynamic>> draft(MemoryStore store) async =>
    jsonDecode((await store.read('ink-user', 'annotation:${original.id}'))!)
        as Map<String, dynamic>;

List<Map<String, dynamic>> paintedStrokes(WidgetTester tester) {
  final canvas = find.byKey(const Key('ink-canvas'));
  final painter =
      tester
              .widget<CustomPaint>(
                find.descendant(of: canvas, matching: find.byType(CustomPaint)),
              )
              .painter
          as dynamic;
  return (painter.strokes as List<InkStroke>).map((s) => s.toJson()).toList();
}

Future<void> save(WidgetTester tester, {bool localOnly = false}) async {
  await tester.tap(find.text(localOnly ? '기기에 저장' : '주석 저장'));
  await until(tester, find.byType(SaveResult));
}

Future<void> reopen(WidgetTester tester) async {
  await tester.tap(find.text('주석 이어서 편집'));
  await until(tester, find.byKey(const Key('ink-canvas')));
}

Future<void> seed(
  MemoryStore store,
  List<InkStroke> strokes, {
  String status = 'draft',
}) => store.write(
  'ink-user',
  'annotation:${original.id}',
  jsonEncode({
    'origin': original.json,
    'strokes': strokes.map((s) => s.toJson()).toList(),
    'status': status,
    'schemaVersion': 1,
  }),
);

void main() {
  testWidgets('굵기 기본값은 보통이고 펜의 다음 획은 2·4·8dp로 저장된다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    expect(
      tester
          .widget<IconButton>(find.byKey(const Key('editor-width-normal')))
          .isSelected,
      isTrue,
    );
    final imageWidth = at(tester, 1, 0.5).dx - at(tester, 0, 0.5).dx;
    await draw(tester, 0.2);
    for (final choice in const [
      (id: 'thin', y: 0.35),
      (id: 'normal', y: 0.5),
      (id: 'thick', y: 0.65),
    ]) {
      await tester.tap(find.byKey(Key('editor-width-${choice.id}')));
      await tester.pump();
      await draw(tester, choice.y);
    }
    await controller.beforeLock!();
    final saved = (await draft(store))['strokes'] as List;
    expect(saved, hasLength(4));
    const expectedWidths = [4.0, 2.0, 4.0, 8.0];
    for (var i = 0; i < saved.length; i++) {
      expect(saved[i]['tool'], 'pen');
      // 저장 width는 원본 너비 대비 비율이므로 그릴 당시 화면 폭으로 환산한다.
      expect(saved[i]['width'] * imageWidth, closeTo(expectedWidths[i], 1e-9));
    }
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('굵기 선택은 도구를 바꿔도 유지되고 도구별 기본 굵기에 적용된다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    final imageWidth = at(tester, 1, 0.5).dx - at(tester, 0, 0.5).dx;
    for (final choice in const [
      (id: 'thin', marker: 9.0, pen: 2.0),
      (id: 'normal', marker: 18.0, pen: 4.0),
      (id: 'thick', marker: 36.0, pen: 8.0),
    ]) {
      await tester.tap(find.byKey(Key('editor-width-${choice.id}')));
      await tester.pump();
      for (final tool in ['marker', 'eraser', 'rectangle', 'pen']) {
        await tester.tap(find.byKey(Key('editor-tool-$tool')));
        await tester.pump();
        for (final width in ['thin', 'normal', 'thick']) {
          expect(
            tester
                .widget<IconButton>(find.byKey(Key('editor-width-$width')))
                .isSelected,
            width == choice.id,
          );
        }
        if (tool == 'eraser') continue;
        await draw(tester, 0.5);
        final saved = ((await draft(store))['strokes'] as List).last;
        expect(saved['tool'], tool);
        expect(
          saved['width'] * imageWidth,
          closeTo(tool == 'marker' ? choice.marker : choice.pen, 1e-9),
        );
      }
    }
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('굵기를 바꿔도 이미 그린 획의 화면·저장 굵기는 변하지 않는다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    await draw(tester, 0.4);
    final before = ((await draft(store))['strokes'] as List).single;
    final paintedBefore = paintedStrokes(tester);
    for (final width in ['thick', 'thin']) {
      await tester.tap(find.byKey(Key('editor-width-$width')));
      await tester.pump();
      expect(paintedStrokes(tester), paintedBefore);
      await controller.beforeLock!();
      expect((await draft(store))['strokes'], [before]);
    }
    await draw(tester, 0.6);
    final saved = (await draft(store))['strokes'] as List;
    expect(saved, hasLength(2));
    expect(saved.first, before);
    expect(saved.last['width'], closeTo(before['width'] * 0.5, 1e-12));
    expect(paintedStrokes(tester).first, before);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  for (final scale in [1.0, 3.0]) {
    testWidgets('866dp 화면에서 도구·굵기 버튼은 글자 ${scale.toInt()}배에서도 56dp 이상이다', (
      tester,
    ) async {
      final controller = await _controllerFor(_Gateway(), MemoryStore());
      await openOnTablet(tester, controller, scale: scale);
      for (final id in _editorLabels.keys) {
        final button = find.byKey(Key('editor-$id'));
        await tester.ensureVisible(button);
        await tester.pumpAndSettle();
        final size = tester.getSize(button);
        expect(size.width, greaterThanOrEqualTo(vgTapMin), reason: id);
        expect(size.height, greaterThanOrEqualTo(vgTapMin), reason: id);
        expect(button.hitTestable(), findsOneWidget, reason: id);
        expect(
          MediaQuery.textScalerOf(tester.element(button)).scale(14),
          14 * scale,
        );
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
    });
  }

  testWidgets('866dp 화면(80dp 레일 포함)에서 도구·굵기 7개, 색·편집 6개, 보기 조작 7개가 세 줄에 놓인다', (
    tester,
  ) async {
    final controller = await _controllerFor(_Gateway(), MemoryStore());
    await openOnTablet(tester, controller);
    final screenWidth =
        tester.view.physicalSize.width / tester.view.devicePixelRatio;
    expect(screenWidth, closeTo(866, 0.2));
    final rail = tester.getRect(find.byKey(const Key('rail-collapsed')));
    final editor = tester.getRect(find.byType(RecordEditor));
    expect(rail.width, 80);
    expect(editor.left, rail.right);
    expect(editor.width, closeTo(screenWidth - 80, 0.01));
    const spacing = 8.0;
    final rowTops = <double>{};
    for (final row in [
      (key: 'editor-drawing-tools', ids: _editorLabels.keys.take(7)),
      (key: 'editor-edit-actions', ids: _editorLabels.keys.skip(7).take(6)),
      (key: 'editor-view-actions', ids: _editorLabels.keys.skip(13)),
    ]) {
      final wrap = find.byKey(Key(row.key));
      expect(tester.widget<Wrap>(wrap).children, hasLength(row.ids.length));
      final first = tester.getRect(find.byKey(Key('editor-${row.ids.first}')));
      var previousRight = first.left - spacing;
      for (final id in row.ids) {
        final button = find.byKey(Key('editor-$id'));
        expect(find.descendant(of: wrap, matching: button), findsOneWidget);
        final bounds = tester.getRect(button);
        rowTops.add(bounds.top);
        expect(bounds.top, first.top);
        expect(bounds.size, const Size.square(vgTapMin));
        expect(bounds.left - previousRight, closeTo(spacing, 0.01));
        previousRight = bounds.right;
      }
    }
    expect(rowTops, hasLength(3));
    final drawing = tester.getRect(
      find.byKey(const Key('editor-drawing-tools')),
    );
    final editing = tester.getRect(
      find.byKey(const Key('editor-edit-actions')),
    );
    final actions = tester.getRect(
      find.byKey(const Key('editor-view-actions')),
    );
    expect(drawing.height, vgTapMin);
    expect(editing.height, vgTapMin);
    expect(actions.height, vgTapMin);
    expect(editing.top - drawing.bottom, vgGapTap);
    expect(actions.top - editing.bottom, vgGapTap);
    final localSave = find.widgetWithText(TextButton, '기기에 저장');
    final save = find.widgetWithText(FilledButton, '주석 저장');
    expect(tester.getRect(localSave).top, tester.getRect(save).top);
    expect(tester.getRect(localSave).top, greaterThan(actions.bottom));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('866dp 화면(80dp 레일 포함)에서 색 원 3개가 같은 줄에 놓인다', (tester) async {
    final controller = await _controllerFor(_Gateway(), MemoryStore());
    await openOnTablet(tester, controller);
    final centers = [
      for (final color in ['red', 'black', 'blue'])
        tester.getCenter(find.byKey(Key('editor-color-$color'))),
    ];
    expect(centers[1].dy, centers[0].dy);
    expect(centers[2].dy, centers[0].dy);
    expect(centers[0].dx, lessThan(centers[1].dx));
    expect(centers[1].dx, lessThan(centers[2].dx));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('굵기 점은 선택과 무관하게 가늘게 < 보통 < 굵게이고 선택은 테두리로 표시한다', (tester) async {
    final controller = await _controllerFor(_Gateway(), MemoryStore());
    await openOnTablet(tester, controller);
    const widths = ['thin', 'normal', 'thick'];
    List<Size> dotSizes() => [
      for (final width in widths)
        tester.getSize(
          find.descendant(
            of: find.byKey(Key('editor-width-$width')),
            matching: find.byIcon(Icons.circle),
          ),
        ),
    ];
    final initialSizes = dotSizes();
    expect(initialSizes, const [
      Size.square(8),
      Size.square(14),
      Size.square(22),
    ]);
    for (final selected in ['normal', 'thin', 'thick', 'normal']) {
      await tester.tap(find.byKey(Key('editor-width-$selected')));
      await tester.pumpAndSettle();
      final sizes = dotSizes();
      expect(sizes, initialSizes, reason: '$selected 선택 후에도 점 크기를 유지한다');
      expect(sizes[0].width, lessThan(sizes[1].width));
      expect(sizes[1].width, lessThan(sizes[2].width));
      for (final width in widths) {
        final button = find.byKey(Key('editor-width-$width'));
        expect(tester.widget<IconButton>(button).isSelected, width == selected);
        final dot = find.descendant(
          of: button,
          matching: find.byIcon(Icons.circle),
        );
        expect(IconTheme.of(tester.element(dot)).color, VgColors.ink);
        final material = tester.widget<Material>(
          find.descendant(of: button, matching: find.byType(Material)),
        );
        // 큰 원형 선택 배경이 점의 굵기로 읽히는 회귀를 막는다.
        expect(material.color, Colors.transparent);
        expect(material.shape, isA<RoundedRectangleBorder>());
        final border = (material.shape! as RoundedRectangleBorder).side;
        expect(border.width, 2);
        expect(
          border.color,
          width == selected ? VgColors.primary : Colors.transparent,
        );
      }
    }
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('모든 툴바 아이콘에 한국어 tooltip·Semantics와 길게 누르기 안내가 남는다', (
    tester,
  ) async {
    // SemanticsHandle 은 addTearDown 으로 늦출 수 없다.
    // _endOfTestVerifications 가 tearDown 보다 먼저 돌아 미해제로 잡는다.
    final semantics = tester.ensureSemantics();
    final controller = await _controllerFor(_Gateway(), MemoryStore());
    await open(tester, controller);
    for (final entry in _editorLabels.entries) {
      final button = find.byKey(Key('editor-${entry.key}'));
      await tester.ensureVisible(button);
      await tester.pumpAndSettle();
      expect(tester.widget<IconButton>(button).tooltip, entry.value);
      expect(tester.getSemantics(button).label, entry.value);
    }
    final pen = find.byKey(const Key('editor-tool-pen'));
    await tester.ensureVisible(pen);
    await tester.longPress(pen);
    await tester.pumpAndSettle();
    expect(find.text('펜'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    semantics.dispose();
  });

  testWidgets('원본 보기 토글은 주석을 보존하고 전체 지우기는 확인을 거친다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    await draw(tester, 0.4);
    final before = (await draft(store))['strokes'];
    final toggle = find.byKey(const Key('editor-original-only'));
    await tester.tap(toggle);
    await tester.pumpAndSettle();
    final selected = tester.widget<IconButton>(toggle);
    expect(selected.isSelected, isTrue);
    expect(selected.style!.backgroundColor!.resolve({}), VgColors.primary);
    expect(selected.tooltip, '원본만 보기');
    await draw(tester, 0.6);
    expect((await draft(store))['strokes'], before);
    await tester.tap(toggle);
    await tester.pumpAndSettle();
    expect(tester.widget<IconButton>(toggle).isSelected, isFalse);
    expect(paintedStrokes(tester), before);
    final clear = find.byKey(const Key('editor-clear-all'));
    await tester.tap(clear);
    await tester.pumpAndSettle();
    expect(find.text('주석을 모두 지울까요?'), findsOneWidget);
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect((await draft(store))['strokes'], before);
    await tester.tap(clear);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '전체 지우기'));
    await tester.pumpAndSettle();
    expect((await draft(store))['strokes'], isEmpty);
    expect(paintedStrokes(tester), isEmpty);
    expect(
      tester.widget<IconButton>(find.byKey(const Key('editor-undo'))).onPressed,
      isNull,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('새 잉크 점의 좌표는 소수 4자리, 압력은 소수 2자리로 반올림한다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    await draw(tester, 0.4123456789012345);
    final start = at(tester, 0.2345678901, 0.3456789012);
    final end = at(tester, 0.7654321098, 0.6543210987);
    final pen = await tester.startGesture(
      start,
      pointer: 2,
      kind: PointerDeviceKind.stylus,
    );
    await pen.updateWithCustomEvent(
      PointerMoveEvent(
        viewId: tester.view.viewId,
        pointer: 2,
        kind: PointerDeviceKind.stylus,
        position: end,
        delta: end - start,
        buttons: kPrimaryButton,
        pressure: 0.67891,
      ),
    );
    await pen.up();
    await tester.pump();
    final saved = (await draft(store))['strokes'] as List;
    expect(saved, hasLength(2));
    // TestGesture 의 기본 압력은 1.0 이다. 0.68 만 커스텀 이벤트(0.67891)의 반올림이다.
    expect(saved.first['points'], [
      [0.2, 0.4123, 1.0],
      [0.8, 0.4123, 1.0],
    ]);
    expect(saved.last['points'], [
      [0.2346, 0.3457, 1.0],
      [0.7654, 0.6543, 0.68],
    ]);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('같은 자리와 1px 미만 이동은 점을 늘리지 않고 충분한 이동은 추가한다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    final start = at(tester, 0.2, 0.4);
    final pen = await tester.startGesture(
      start,
      kind: PointerDeviceKind.stylus,
    );
    for (var i = 0; i < 5; i++) {
      await pen.moveTo(start);
    }
    await tester.pump();
    expect((await draft(store))['strokes'].single['points'], hasLength(1));
    for (final offset in [
      const Offset(0.4, 0),
      const Offset(0, 0.4),
      const Offset(0.4, 0.4),
    ]) {
      await pen.moveTo(start + offset);
    }
    await tester.pump();
    expect((await draft(store))['strokes'].single['points'], hasLength(1));
    await pen.moveTo(start + const Offset(1.2, 0));
    await tester.pump();
    expect((await draft(store))['strokes'].single['points'], hasLength(2));
    // 버린 이벤트가 아니라 마지막으로 남긴 점에서 누적 이동을 비교한다.
    for (final dy in [0.4, 0.8, 1.2]) {
      await pen.moveTo(start + Offset(1.2, dy));
    }
    await pen.up();
    await tester.pump();
    final saved = (await draft(store))['strokes'] as List;
    expect(saved, hasLength(1));
    expect(saved.single['points'], hasLength(3));
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('스타일러스 down 뒤 move 없이 up 해도 첫 점을 보존한다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    final pen = await tester.startGesture(
      at(tester, 0.5, 0.5),
      kind: PointerDeviceKind.stylus,
    );
    await pen.up();
    await tester.pump();
    final saved = (await draft(store))['strokes'] as List;
    expect(saved, hasLength(1));
    expect(saved.single['points'], [
      [0.5, 0.5, 1.0],
    ]);
    expect(paintedStrokes(tester), saved);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('C-06 Back 보관에 실패하면 편집기와 획을 유지하고 재시도한다', (tester) async {
    final store = _FailingStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller, asRoute: true);
    await draw(tester, 0.4);
    final before = paintedStrokes(tester);
    store.failWrites = true;
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.tap(find.text('초안 보관 후 나가기'));
    await tester.pumpAndSettle();
    expect(paintedStrokes(tester), before);
    expect(find.text('초안을 저장하지 못했습니다. 저장 공간을 확인해 주세요.'), findsOneWidget);
    store.failWrites = false;
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.tap(find.text('초안 보관 후 나가기'));
    await tester.pumpAndSettle();
    expect(find.byType(RecordEditor), findsNothing);
    expect((await draft(store))['strokes'], before);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('C-03 완료한 획은 회전·분할창에서도 원본 좌표 그대로 보인다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    await draw(tester, 0.4);
    final before = (await draft(store))['strokes'];
    for (final size in [
      const Size(1000, 1385),
      const Size(700, 1000),
      const Size(1385, 1000),
    ]) {
      tester.view.physicalSize = size;
      await tester.pumpAndSettle();
      expect(paintedStrokes(tester), before);
      expect((await draft(store))['strokes'], before);
      expect(tester.takeException(), isNull);
    }
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('C-03 펜을 떼기 전 회전과 PointerCancel도 받은 점을 보존한다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    final pen = await tester.startGesture(
      at(tester, 0.2, 0.4),
      kind: PointerDeviceKind.stylus,
    );
    await pen.moveTo(at(tester, 0.8, 0.4));
    await tester.pump();
    final before = (await draft(store))['strokes'];
    expect(before, hasLength(1));
    expect(before.single['points'], hasLength(2));
    tester.view.physicalSize = const Size(1000, 1385);
    await tester.pump();
    await pen.cancel();
    await tester.pumpAndSettle();
    expect(paintedStrokes(tester), before);
    expect((await draft(store))['strokes'], before);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('C-05 lifecycle 통지 없이 새 컨트롤러로도 진행 중 획을 복원한다', (tester) async {
    for (final cancelled in [true, false]) {
      final store = _CountingStore(), gateway = _Gateway();
      final controller = await _controllerFor(gateway, store);
      await open(tester, controller);
      final end = at(tester, 0.8, 0.4);
      final pen = await tester.startGesture(
        at(tester, 0.2, 0.4),
        kind: PointerDeviceKind.stylus,
      );
      await pen.moveTo(end);
      await tester.pump();
      final before = await draft(store);
      expect(before['strokes'], hasLength(1));
      expect(before['strokes'].single['points'], hasLength(2));
      await tester.pumpWidget(const SizedBox.shrink());
      final writesAtDispose = store.annotationWrites;
      // 실제 포인터 경로를 유지한 채, 제거된 캔버스로 늦은 이벤트를 보낸다.
      await pen.moveTo(end + const Offset(10, 0));
      if (cancelled) {
        await pen.cancel();
      } else {
        await pen.up();
      }
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(store.annotationWrites, writesAtDispose);
      expect(await draft(store), before);
      controller.dispose();
      final resumed = await _controllerFor(gateway, store);
      await open(tester, resumed);
      expect(paintedStrokes(tester), before['strokes']);
      expect(gateway.uploads, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      resumed.dispose();
    }
  });

  testWidgets('C-05 그리던 획은 백그라운드 왕복 후에도 남는다', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller);
    final pen = await tester.startGesture(
      at(tester, 0.2, 0.4),
      kind: PointerDeviceKind.stylus,
    );
    await pen.moveTo(at(tester, 0.8, 0.4));
    await tester.pump();
    final before = (await draft(store))['strokes'];
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await pen.cancel();
    await tester.pumpAndSettle();
    expect(paintedStrokes(tester), before);
    expect((await draft(store))['strokes'], before);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('C-06 획이 있으면 시스템 Back 확인·계속 작성·초안 보관 후 나가기', (tester) async {
    final store = MemoryStore();
    final controller = await _controllerFor(_Gateway(), store);
    await open(tester, controller, asRoute: true);
    await draw(tester, 0.4);
    final before = (await draft(store))['strokes'];
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('작성 중인 주석을 보관하고 나갈까요?'), findsOneWidget);
    await tester.tap(find.text('계속 작성'));
    await tester.pumpAndSettle();
    expect(paintedStrokes(tester), before);
    await tester.tap(find.byTooltip('초안 저장 후 뒤로'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('초안 보관 후 나가기'));
    await tester.pumpAndSettle();
    expect(find.byType(RecordEditor), findsNothing);
    expect((await draft(store))['strokes'], before);
    await tester.tap(find.text('편집기 열기'));
    await until(tester, find.byKey(const Key('ink-canvas')));
    expect(paintedStrokes(tester), before);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('C-06 빈 편집기 Back은 확인 없이 나간다', (tester) async {
    final controller = await _controllerFor(_Gateway(), MemoryStore());
    await open(tester, controller, asRoute: true);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.byType(RecordEditor), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('지우개 한 번이 여러 획을 목록에서 지우며 빈 캔버스에서도 한 번에 되돌린다', (tester) async {
    final gateway = _Gateway(), store = MemoryStore();
    final controller = await _controllerFor(gateway, store);
    await open(tester, controller);
    await draw(tester, 0.4);
    await draw(tester, 0.6);
    final before = (await draft(store))['strokes'];
    expect(before, hasLength(2));
    await erase(tester);
    expect((await draft(store))['strokes'], isEmpty);
    await tester.tap(find.byTooltip('마지막 획 되돌리기'));
    await tester.pump();
    expect((await draft(store))['strokes'], before);
    await tester.tap(find.byTooltip('마지막 획 되돌리기'));
    await tester.pump();
    expect((await draft(store))['strokes'], [before.first]);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('손가락과 취소된 지우개는 완료한 획을 바꾸지 않는다', (tester) async {
    final gateway = _Gateway(), store = MemoryStore();
    final controller = await _controllerFor(gateway, store);
    await open(tester, controller);
    await draw(tester, 0.4);
    final before = (await draft(store))['strokes'];
    await draw(tester, 0.6, kind: PointerDeviceKind.touch);
    await erase(tester, cancel: true);
    await controller.beforeLock!();
    expect((await draft(store))['strokes'], before);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('게시·재편집은 JSON 새 버전만 추가하며 삭제한 획과 지우개는 전송되지 않는다', (tester) async {
    final gateway = _Gateway(), store = MemoryStore();
    final controller = await _controllerFor(gateway, store);
    await open(tester, controller);
    await draw(tester, 0.4);
    await draw(tester, 0.85);
    await erase(tester);
    final retained = (await draft(store))['strokes'];
    expect(retained, hasLength(1));
    await save(tester);
    expect(gateway.uploads, hasLength(1));
    final first = gateway.uploads.single;
    expect(first.fields['clientOperationId'], isNotEmpty);
    expect(jsonDecode(utf8.decode(first.bytes)), {'v': 1, 'strokes': retained});
    expect(first.fields['annotationOf'], original.id);
    expect(utf8.decode(first.bytes), isNot(contains('eraser')));
    final preview = tester.widget<SaveResult>(find.byType(SaveResult)).png;
    expect(preview.take(8), [137, 80, 78, 71, 13, 10, 26, 10]);
    final firstReceipt = gateway.receipts.single;
    expect(
      await store.read('ink-user', 'published:${firstReceipt.id}'),
      original.id,
    );
    expect(
      await store.readBytes('ink-user', 'photo:${firstReceipt.id}'),
      preview,
    );

    // 전송한 주석 ID의 기존 별칭으로도 원본에 연결된 초안을 연다.
    await tester.pumpWidget(const SizedBox.shrink());
    await open(tester, controller, source: firstReceipt);
    await save(tester);
    expect(gateway.uploads, hasLength(1)); // 수정하지 않은 저장은 중복 업로드하지 않는다.
    await reopen(tester);
    await draw(tester, 0.6);
    await save(tester);
    expect(gateway.uploads, hasLength(2));
    expect(
      gateway.uploads.last.fields['clientOperationId'],
      isNot(first.fields['clientOperationId']),
    );
    expect(gateway.receipts.last.id, isNot(firstReceipt.id));
    expect(gateway.uploads.last.fields['annotationOf'], original.id);
    expect(await gateway.image(firstReceipt.media_url!), first.bytes);
    expect(
      (jsonDecode(utf8.decode(gateway.uploads.last.bytes))['strokes'] as List),
      hasLength(2),
    );
    expect((await draft(store))['status'], 'sent');
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('오프라인 저장·재시작 후 같은 초안을 연결 복구 시 전송한다', (tester) async {
    final gateway = _Gateway(), store = MemoryStore();
    final controller = await _controllerFor(gateway, store);
    await open(tester, controller);
    controller.offline = true;
    await draw(tester, 0.4);
    await save(tester);
    expect(gateway.uploads, isEmpty);
    expect((await draft(store))['status'], 'draft');
    final operationId = (await draft(store))['clientOperationId'];
    expect(operationId, isNotEmpty);
    final originalFields = controller.outbox.items.single.fields;
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    final resumed = await _controllerFor(gateway, store);
    resumed.offline = true;
    final reads = gateway.imageReads;
    await open(tester, resumed);
    expect(gateway.imageReads, reads); // 원본도 캐시에서 연다.
    resumed.offline = false;
    resumed.site = SiteInfo({'site_name': '변경된 현장'});
    await save(tester);
    expect(gateway.uploads.single.fields['clientOperationId'], operationId);
    expect(gateway.uploads.single.fields, originalFields);
    expect(resumed.outbox.items.single.siteName, isNot('변경된 현장'));
    expect(gateway.uploads, hasLength(1));
    expect(
      jsonDecode(utf8.decode(gateway.uploads.single.bytes))['strokes'],
      hasLength(1),
    );
    expect((await draft(store))['status'], 'sent');
    await tester.pumpWidget(const SizedBox.shrink());
    resumed.dispose();
  });

  testWidgets('잉크 명시적 실패 재시도는 같은 ID·JSON·원본 연결로 전송한다', (tester) async {
    final gateway = _Gateway()..failure = const ApiFailure('거절', status: 429);
    final store = MemoryStore();
    final controller = await _controllerFor(gateway, store);
    await open(tester, controller);
    await draw(tester, 0.4);
    await save(tester);
    final first = gateway.uploads.single;
    await reopen(tester);
    gateway.failure = null;
    await save(tester);
    expect(gateway.uploads, hasLength(2));
    expect(gateway.uploads.last.fields, first.fields);
    expect(gateway.uploads.last.bytes, first.bytes);
    expect(
      (await draft(store))['clientOperationId'],
      first.fields['clientOperationId'],
    );
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('전송 상태에서 잉크를 보내도 기존 게시본 별칭·PNG·획 복원이 유지된다', (tester) async {
    final gateway = _Gateway(), store = MemoryStore();
    final controller = await _controllerFor(gateway, store);
    controller.offline = true;
    await open(tester, controller);
    await draw(tester, 0.4);
    await save(tester);
    final preview = tester.widget<SaveResult>(find.byType(SaveResult)).png;
    final item = controller.outbox.items.single;
    await controller.outbox.send(item, retry: true);
    final receipt = gateway.receipts.single;
    expect(
      await store.read('ink-user', 'published:${receipt.id}'),
      original.id,
    );
    expect(await store.readBytes('ink-user', 'photo:${receipt.id}'), preview);
    await tester.pumpWidget(const SizedBox.shrink());
    await open(tester, controller, source: receipt);
    expect((await draft(store))['strokes'], hasLength(1));
    await save(tester);
    expect(gateway.uploads, hasLength(1));
    expect(tester.widget<SaveResult>(find.byType(SaveResult)).sent, isTrue);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('결과 불명은 재편집·재저장해도 자동으로 다시 보내지 않는다', (tester) async {
    final gateway = _Gateway()
      ..failure = const ApiFailure('응답 유실', uncertainWrite: true);
    final store = MemoryStore();
    final controller = await _controllerFor(gateway, store);
    await open(tester, controller);
    await draw(tester, 0.4);
    await save(tester);
    expect((await draft(store))['status'], 'uncertain');
    await reopen(tester);
    await erase(tester);
    await save(tester);
    expect(gateway.uploads, hasLength(1));
    expect((await draft(store))['status'], 'uncertain');
    expect(
      tester.widget<SaveResult>(find.byType(SaveResult)).uncertain,
      isTrue,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('전송 도중 종료한 sending 초안은 uncertain으로 복구한다', (tester) async {
    final gateway = _Gateway(), store = MemoryStore();
    await seed(store, [], status: 'sending');
    final controller = await _controllerFor(gateway, store);
    await open(tester, controller);
    expect((await draft(store))['status'], 'uncertain');
    await save(tester);
    expect(gateway.uploads, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('옛 초안의 지운 낙서는 로컬 재저장과 JSON 업로드 모두에서 제거한다', (tester) async {
    final gateway = _Gateway(), store = MemoryStore();
    await seed(store, [
      InkStroke(InkTool.pen, 0xff000000, 0.004, [
        [0.2, 0.4, 0.5],
        [0.8, 0.4, 0.5],
      ]),
      InkStroke(InkTool.eraser, 0, 0.028, [
        [0.5, 0.4, 1],
      ]),
    ], status: 'sent');
    final controller = await _controllerFor(gateway, store);
    await open(tester, controller);
    expect((await draft(store))['strokes'], isEmpty);
    expect((await draft(store))['status'], 'draft');
    expect(
      tester
          .widget<IconButton>(find.widgetWithIcon(IconButton, Icons.undo))
          .onPressed,
      isNull,
    );
    await save(tester);
    expect(jsonDecode(utf8.decode(gateway.uploads.single.bytes)), {
      'v': 1,
      'strokes': [],
    });
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('2MB 초과를 알리고 초안은 보존하며 전송하지 않는다', (tester) async {
    final gateway = _Gateway(), store = MemoryStore();
    final oversized = InkStroke(
      InkTool.pen,
      0xff000000,
      0.001,
      List.generate(
        42000,
        (_) => [0.1234567890123456, 0.2345678901234567, 0.3456789012345678],
      ),
    );
    expect(encodeInk([oversized]).length, greaterThan(maxInkUploadBytes));
    await seed(store, [oversized]);
    final controller = await _controllerFor(gateway, store);
    await open(tester, controller);
    await save(tester);
    expect(gateway.uploads, isEmpty);
    final result = tester.widget<SaveResult>(find.byType(SaveResult));
    expect(result.error, contains('2,097,152바이트'));
    expect(result.sent, isFalse);
    final saved = await draft(store);
    expect(saved['status'], 'draft');
    expect(saved['strokes'][0]['points'], hasLength(42000));
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });
}
