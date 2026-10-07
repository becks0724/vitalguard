import 'dart:async';
import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/action_placement.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/device_services.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/record_editor.dart';
import 'package:vitalguard_field/ui/record/record_input.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';
import 'package:vitalguard_field/ui/settings/settings_screen.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/record_fixture.dart';

class _ControlledStore extends MemoryStore {
  Completer<String?>? pendingRead;
  Completer<void>? pendingWrite;
  bool failRead = false;
  int writes = 0;

  @override
  Future<String?> read(String accountId, String key) async {
    if (key == vgActionSidePreferenceKey) {
      if (failRead) throw StateError('읽기 실패');
      if (pendingRead != null) return pendingRead!.future;
    }
    return super.read(accountId, key);
  }

  @override
  Future<void> write(String accountId, String key, String value) async {
    if (key == vgActionSidePreferenceKey) {
      writes++;
      if (pendingWrite != null) await pendingWrite!.future;
    }
    await super.write(accountId, key, value);
  }
}

Future<FieldCoordinator> _controller({
  LocalStore? store,
  String account = 'settings-user',
}) async {
  final controller = FieldCoordinator(
    MockGateway(),
    store ?? MemoryStore(),
    MockSpeechInput(),
  );
  await controller.signIn(account, 'mock');
  addTearDown(controller.dispose);
  return controller;
}

Future<void> _mount(
  WidgetTester tester,
  FieldController controller, {
  Size size = const Size(1385, 866),
  double scale = 1,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(() => tester.pumpWidget(const SizedBox.shrink()));
  await tester.pumpWidget(
    MaterialApp(
      theme: vgLightTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: FieldShell(key: ValueKey(controller), controller: controller),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tab(WidgetTester tester, int index) async {
  await tester.tap(find.byKey(Key('rail-destination-$index')));
  await tester.pumpAndSettle();
}

Future<void> _choose(WidgetTester tester, ActionSide side) async {
  await _tab(tester, 4);
  await tester.tap(find.byKey(Key('action-side-${side.name}')));
  await tester.pumpAndSettle();
}

Finder _buttons() =>
    find.byWidgetPredicate((widget) => widget is ButtonStyleButton);

Finder _button(String label) =>
    find.ancestor(of: find.text(label), matching: _buttons());

void _target(WidgetTester tester, Finder finder, double minHeight) {
  expect(finder, findsOneWidget);
  final size = tester.getSize(finder);
  expect(size.width, greaterThanOrEqualTo(vgTapMin));
  expect(size.height, greaterThanOrEqualTo(minHeight));
}

void _oneSet(WidgetTester tester, Finder group, List<Finder> buttons) {
  expect(group, findsOneWidget);
  for (final button in buttons) {
    expect(button, findsOneWidget);
    expect(find.descendant(of: group, matching: button), findsOneWidget);
  }
  expect(Directionality.of(tester.element(group)), TextDirection.ltr);
}

void _lowerSide(WidgetTester tester, Finder group, ActionSide side) {
  final bounds = tester.getRect(find.byKey(const Key('shell-content')));
  final rect = tester.getRect(group);
  expect(rect.top, greaterThan(bounds.center.dy));
  expect(rect.bottom, lessThanOrEqualTo(bounds.bottom));
  expect(rect.left, greaterThanOrEqualTo(bounds.left + 20));
  expect(rect.right, lessThanOrEqualTo(bounds.right - 20));
  expect(
    rect.center.dx,
    side == ActionSide.left
        ? lessThan(bounds.center.dx)
        : greaterThan(bounds.center.dx),
  );
}

Future<void> _photo(WidgetTester tester, Size size) async {
  await _tab(tester, 2);
  final pane = find.byKey(const Key('record-pending-list'));
  await tester.scrollUntilVisible(
    find.text('모의 현장 사진'),
    240,
    scrollable: find
        .descendant(of: pane, matching: find.byType(Scrollable))
        .first,
  );
  await tester.tap(find.text('모의 현장 사진'));
  await tester.pumpAndSettle();
}

Future<void> _canvas(WidgetTester tester) async {
  for (
    var i = 0;
    i < 100 && find.byKey(const Key('ink-canvas')).evaluate().isEmpty;
    i++
  ) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 10)),
    );
    await tester.pump(const Duration(milliseconds: 50));
  }
  expect(find.byKey(const Key('ink-canvas')), findsOneWidget);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('첫 선택은 오른손이며 자동 저장하지 않고 MemoryStore에서 계정별로 분리한다', () async {
    final store = MemoryStore();
    final first = ActionPlacement(store, 'a');
    await first.load();
    expect(first.side, ActionSide.right);
    expect(await store.read('a', vgActionSidePreferenceKey), isNull);
    await first.select(ActionSide.left);
    first.dispose();
    final resumed = ActionPlacement(store, 'a');
    final other = ActionPlacement(store, 'b');
    addTearDown(resumed.dispose);
    addTearDown(other.dispose);
    await resumed.load();
    await other.load();
    expect(resumed.side, ActionSide.left);
    expect(other.side, ActionSide.right);
    await other.select(ActionSide.left);
    await other.select(ActionSide.right);
    expect(await store.read('a', vgActionSidePreferenceKey), 'left');
    expect(await store.read('b', vgActionSidePreferenceKey), 'right');
  });

  test('DeviceLocalStore와 선택 상태를 모두 새로 만들어도 좌우 선택을 디스크에서 복원한다', () async {
    final directory = await Directory.systemTemp.createTemp(
      'vg-settings-test-',
    );
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      DeviceLocalStore.channel,
      (call) async => call.method == 'dataPath' ? directory.path : null,
    );
    addTearDown(() async {
      messenger.setMockMethodCallHandler(DeviceLocalStore.channel, null);
      await directory.delete(recursive: true);
    });
    final first = ActionPlacement(DeviceLocalStore(), 'a');
    await first.load();
    await first.select(ActionSide.left);
    first.dispose();
    final resumed = ActionPlacement(DeviceLocalStore(), 'a');
    await resumed.load();
    expect(resumed.side, ActionSide.left);
    await resumed.select(ActionSide.right);
    resumed.dispose();
    final third = ActionPlacement(DeviceLocalStore(), 'a');
    final other = ActionPlacement(DeviceLocalStore(), 'b');
    addTearDown(third.dispose);
    addTearDown(other.dispose);
    await third.load();
    await other.load();
    expect(third.side, ActionSide.right);
    expect(other.side, ActionSide.right);
    expect(await other.local.read('b', vgActionSidePreferenceKey), isNull);
  });

  test('폐기한 계정의 늦은 읽기·저장 완료는 알림을 보내지 않는다', () async {
    final store = _ControlledStore()..pendingRead = Completer<String?>();
    final first = ActionPlacement(store, 'a');
    final loading = first.load();
    first.dispose();
    store.pendingRead!.complete('left');
    await loading;
    store.pendingRead = null;
    final second = ActionPlacement(store, 'b');
    await second.load();
    store.pendingWrite = Completer<void>();
    final saving = second.select(ActionSide.left);
    second.dispose();
    store.pendingWrite!.complete();
    await saving;
    expect(await store.read('a', vgActionSidePreferenceKey), isNull);
    expect(await store.read('b', vgActionSidePreferenceKey), 'left');
  });

  for (final size in [const Size(1385, 866), const Size(866, 1385)]) {
    final orientation = size.width > size.height ? '가로' : '세로';

    testWidgets('$orientation 설정은 하단 구분선 아래·사용자 위에 있고 토글만 대등하게 표시한다', (
      tester,
    ) async {
      final controller = await _controller();
      await _mount(tester, controller, size: size);
      final divider = tester.getRect(
        find.byKey(const Key('rail-footer-divider')),
      );
      final settings = find.byKey(const Key('rail-destination-4'));
      for (var i = 0; i < 4; i++) {
        expect(
          tester.getRect(find.byKey(Key('rail-destination-$i'))).bottom,
          lessThan(divider.top),
        );
      }
      expect(
        tester.getRect(settings).top,
        greaterThanOrEqualTo(divider.bottom),
      );
      final user = orientation == '가로'
          ? find.text('모의 안전관리자')
          : find.byTooltip('모의 안전관리자');
      expect(
        tester.getRect(settings).bottom,
        lessThan(tester.getRect(user).top),
      );
      _target(tester, settings, vgTapMin);
      await _tab(tester, 4);
      expect(find.byType(SettingsScreen), findsOneWidget);
      expect(find.byKey(const Key('rail-selection-dot')), findsOneWidget);
      final selected = find.descendant(
        of: settings,
        matching: find.byKey(const Key('rail-selection-dot')),
      );
      expect(selected, findsOneWidget);
      for (final side in ActionSide.values) {
        _target(tester, find.byKey(Key('action-side-${side.name}')), vgTapMin);
      }
      expect(
        find.descendant(of: find.byType(SettingsScreen), matching: _buttons()),
        findsNWidgets(2),
      );
      expect(find.textContaining(RegExp('권장|기본|추천')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('$orientation 토글은 촬영·스캔 한 벌만 하단 좌우로 옮기고 기록 읽는 순서를 유지한다', (
      tester,
    ) async {
      final controller = await _controller();
      await _mount(tester, controller, size: size);
      await _tab(tester, 2);
      final home = tester.state(find.byType(RecordHome));
      final pane = find.byKey(const Key('record-pending-list'));
      final contentBefore = tester.getRect(pane);
      final group = find.byKey(const Key('record-capture-actions'));
      final scan = find.byKey(const Key('document-scan'));
      final capture = find.byKey(const Key('photo-capture'));
      final right = tester.getRect(group);
      _lowerSide(tester, group, ActionSide.right);
      for (final side in [ActionSide.left, ActionSide.right]) {
        await _choose(tester, side);
        await _tab(tester, 2);
        _lowerSide(tester, group, side);
        _oneSet(tester, group, [scan, capture]);
        _target(tester, scan, vgTapPrimary);
        _target(tester, capture, vgTapPrimary);
        expect(
          tester.getRect(scan).left,
          lessThan(tester.getRect(capture).left),
        );
        expect(tester.getRect(pane), contentBefore);
        expect(tester.state(find.byType(RecordHome)), same(home));
        expect(
          await controller.local.read(
            controller.user!.id,
            vgActionSidePreferenceKey,
          ),
          side.name,
        );
      }
      expect(tester.getRect(group), right);
      expect(tester.takeException(), isNull);
    });

    testWidgets('$orientation 사진의 펜·댓글과 편집 도구·저장 한 벌이 이동하고 기존 실행이 이어진다', (
      tester,
    ) async {
      final controller = await _controller();
      final photo = await seedPhoto(controller);
      await _mount(tester, controller, size: size);
      await _photo(tester, size);
      final detail = tester.state(find.byType(PhotoDetail));
      final title = tester.getRect(find.text('모의 현장 사진'));
      final photoGroup = find.byKey(const Key('photo-detail-actions'));
      final pen = _button('주석 그리기');
      final comment = _button('메모·음성 붙이기');
      final right = tester.getRect(photoGroup);
      for (final side in [ActionSide.left, ActionSide.right]) {
        await _choose(tester, side);
        await _tab(tester, 2);
        _oneSet(tester, photoGroup, [pen, comment]);
        _lowerSide(tester, photoGroup, side);
        _target(tester, pen, vgTapPrimary);
        _target(tester, comment, vgTapPrimary);
        expect(
          tester.getRect(pen).left,
          lessThan(tester.getRect(comment).left),
        );
        expect(tester.getRect(find.text('모의 현장 사진')), title);
        expect(tester.state(find.byType(PhotoDetail)), same(detail));
      }
      expect(tester.getRect(photoGroup), right);
      await tester.tap(comment);
      await tester.pumpAndSettle();
      expect(find.byType(RecordInput), findsOneWidget);
      Navigator.of(tester.element(find.byType(RecordInput))).pop();
      await tester.pumpAndSettle();
      await tester.tap(pen);
      await tester.pump();
      await _canvas(tester);
      expect(find.byKey(const Key('rail-collapsed')), findsOneWidget);
      final editor = tester.state(find.byType(RecordEditor));
      final canvasBefore = tester.getRect(find.byKey(const Key('ink-canvas')));
      final tools = find.byKey(const Key('editor-actions'));
      final editorButtons = [
        for (final id in [
          'tool-pen',
          'tool-marker',
          'tool-rectangle',
          'tool-eraser',
          'width-thin',
          'width-normal',
          'width-thick',
          'original-only',
          'clear-all',
        ])
          find.byKey(Key('editor-$id')),
        for (final label in ['주석 저장']) _button(label),
        // 확대·축소·방향 이동은 손가락 제스처로 옮겼다(2026-09-15) — 버튼이 없다.
        for (final tooltip in ['마지막 획 되돌리기', '빨간 펜', '검정 펜', '파란 펜'])
          find.byTooltip(tooltip),
      ];
      for (final side in [ActionSide.left, ActionSide.right]) {
        await _choose(tester, side);
        await _tab(tester, 2);
        _oneSet(tester, tools, editorButtons);
        _lowerSide(tester, tools, side);
        for (final button in tester.widgetList<ButtonStyleButton>(
          find.descendant(of: tools, matching: _buttons()),
        )) {
          _target(tester, find.byWidget(button), vgTapMin);
        }
        for (final button in tester.widgetList<IconButton>(
          find.descendant(of: tools, matching: find.byType(IconButton)),
        )) {
          _target(tester, find.byWidget(button), vgTapMin);
        }
        _target(tester, _button('주석 저장'), vgTapPrimary);
        expect(
          tester.getRect(find.byKey(const Key('ink-canvas'))),
          canvasBefore,
        );
        expect(tester.state(find.byType(RecordEditor)), same(editor));
      }
      await tester.tap(find.byKey(const Key('editor-tool-marker')));
      await tester.pump();
      final stroke = await tester.startGesture(
        canvasBefore.center,
        kind: PointerDeviceKind.stylus,
      );
      await stroke.moveBy(const Offset(40, 20));
      await stroke.up();
      await tester.pump();
      expect(
        await controller.local.read(
          controller.user!.id,
          'annotation:${photo.id}',
        ),
        contains('marker'),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('$orientation 설정 왕복 뒤에도 기존 네 목적지가 그대로 열린다', (tester) async {
      final controller = await _controller();
      await _mount(tester, controller, size: size);
      final pages = [
        find.text('현장 요약'),
        find.text('경보 목록'),
        find.byType(RecordHome),
        find.byKey(const Key('outbox-list')),
      ];
      for (var index = 0; index < 4; index++) {
        await _choose(tester, ActionSide.left);
        await _tab(tester, index);
        expect(pages[index], findsOneWidget);
        expect(find.byType(SettingsScreen), findsNothing);
        expect(find.byKey(const Key('rail-selection-dot')), findsOneWidget);
        expect(
          tester
              .widget<IndexedStack>(find.byKey(const Key('shell-content')))
              .index,
          index,
        );
      }
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('앱 셸·컨트롤러 재생성 뒤 선택 표시와 실행 위치가 함께 복원된다', (tester) async {
    final store = MemoryStore();
    final first = await _controller(store: store);
    await _mount(tester, first);
    await _choose(tester, ActionSide.left);
    await tester.pumpWidget(const SizedBox.shrink());
    final resumed = await _controller(store: store);
    await _mount(tester, resumed);
    await _tab(tester, 4);
    expect(
      tester.widget<SettingsScreen>(find.byType(SettingsScreen)).placement.side,
      ActionSide.left,
    );
    await _tab(tester, 2);
    _lowerSide(
      tester,
      find.byKey(const Key('record-capture-actions')),
      ActionSide.left,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    final other = await _controller(store: store, account: 'other-user');
    await _mount(tester, other);
    await _tab(tester, 2);
    _lowerSide(
      tester,
      find.byKey(const Key('record-capture-actions')),
      ActionSide.right,
    );
  });

  testWidgets('저장 실패는 선택·배치를 복구하며 처리 중 중복 저장을 막고 재시도한다', (tester) async {
    final store = _ControlledStore();
    final controller = await _controller(store: store);
    await _mount(tester, controller);
    await _tab(tester, 4);
    store.pendingWrite = Completer<void>();
    await tester.tap(find.byKey(const Key('action-side-left')));
    await tester.pump();
    expect(find.text('저장 중…'), findsOneWidget);
    await tester.tap(find.byKey(const Key('action-side-right')));
    expect(store.writes, 1);
    store.pendingWrite!.completeError(StateError('저장 실패'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('action-side-error')), findsOneWidget);
    expect(
      tester.widget<SettingsScreen>(find.byType(SettingsScreen)).placement.side,
      ActionSide.right,
    );
    await _tab(tester, 2);
    _lowerSide(
      tester,
      find.byKey(const Key('record-capture-actions')),
      ActionSide.right,
    );
    store.pendingWrite = null;
    await _choose(tester, ActionSide.left);
    expect(store.writes, 2);
    expect(find.byKey(const Key('action-side-error')), findsNothing);
    expect(
      await store.read(controller.user!.id, vgActionSidePreferenceKey),
      'left',
    );
  });

  testWidgets('늦은 초기 읽기 중 선택을 막고 저장된 왼손을 복원한다', (tester) async {
    final store = _ControlledStore()..pendingRead = Completer<String?>();
    final controller = await _controller(store: store);
    await _mount(tester, controller);
    await _tab(tester, 4);
    await tester.tap(find.byKey(const Key('action-side-left')));
    expect(store.writes, 0);
    expect(find.text('선택을 불러오는 중…'), findsOneWidget);
    store.pendingRead!.complete('left');
    await tester.pumpAndSettle();
    await _tab(tester, 2);
    _lowerSide(
      tester,
      find.byKey(const Key('record-capture-actions')),
      ActionSide.left,
    );
  });

  testWidgets('읽기 실패를 알리고 현재와 같은 쪽도 다시 선택해 저장할 수 있다', (tester) async {
    final store = _ControlledStore()..failRead = true;
    final controller = await _controller(store: store);
    await _mount(tester, controller);
    await _tab(tester, 4);
    expect(find.byKey(const Key('action-side-error')), findsOneWidget);
    store.failRead = false;
    await _choose(tester, ActionSide.right);
    expect(
      await store.read(controller.user!.id, vgActionSidePreferenceKey),
      'right',
    );
    expect(find.byKey(const Key('action-side-error')), findsNothing);
  });

  testWidgets('세로 글자 2배에서도 두 선택의 터치 크기와 접근을 유지한다', (tester) async {
    final controller = await _controller();
    await _mount(tester, controller, size: const Size(866, 1385), scale: 2);
    await _choose(tester, ActionSide.left);
    for (final side in ActionSide.values) {
      _target(tester, find.byKey(Key('action-side-${side.name}')), vgTapMin);
    }
    expect(find.textContaining(RegExp('권장|기본|추천')), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
