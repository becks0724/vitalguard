import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/ui/alerts/alerts_screen.dart';
import 'package:vitalguard_field/ui/record/record_editor.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/alerts_fixture.dart';

final _strip = find.byKey(const Key('global-alert-strip'));
final _open = find.byKey(const Key('global-alert-open'));
final _dismiss = find.byKey(const Key('global-alert-dismiss'));
final _content = find.byKey(const Key('shell-content'));

Future<void> _tab(WidgetTester tester, int destination) async {
  await tester.tap(find.byKey(Key('rail-destination-$destination')));
  await tester.pumpAndSettle();
}

Future<void> _alertButton(WidgetTester tester, String key) async {
  final scrollable = find
      .descendant(
        of: find.byType(AlertsScreen),
        matching: find.byType(Scrollable),
      )
      .first;
  expect(scrollable, findsOneWidget);
  await tester.scrollUntilVisible(
    find.byKey(Key(key)),
    200,
    scrollable: scrollable,
  );
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('L-07 실제 기록 편집기에 들어가면 기존 스트립도 보류한다', (tester) async {
    final f = _Fixture();
    f.gateway.rows = [alertRow()];
    await f.mount(tester);
    expect(_strip, findsOneWidget);
    await _tab(tester, 2);
    await tester.tap(find.text('모의 현장 사진'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('펜으로 표시하기'));
    await tester.pump();
    expect(find.byType(RecordEditor), findsOneWidget);
    expect(_strip, findsNothing);
    expect(find.byKey(const Key('rail-collapsed')), findsOneWidget);
  });

  testWidgets('L-07 편집 중 수신은 획을 끊지 않고 닫힘 애니메이션 뒤에만 표시한다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tab(tester, 2);
    final navigator = f.recordNavigator(tester);
    final events = <String>[];
    final route = MaterialPageRoute<void>(
      settings: const RouteSettings(name: vgRecordEditorRouteName),
      builder: (_) => Scaffold(
        body: Listener(
          key: const Key('pen-probe'),
          behavior: HitTestBehavior.opaque,
          onPointerDown: (_) => events.add('down'),
          onPointerMove: (_) => events.add('move'),
          onPointerUp: (_) => events.add('up'),
          onPointerCancel: (_) => events.add('cancel'),
          child: const SizedBox.expand(),
        ),
      ),
    );
    unawaited(navigator.push(route));
    await tester.pumpAndSettle();
    final before = tester.getRect(find.byKey(const Key('pen-probe')));
    final gesture = await tester.startGesture(
      before.center,
      kind: PointerDeviceKind.stylus,
    );
    f.deliver([alertRow()]);
    await tester.pumpAndSettle();
    expect(_strip, findsNothing);
    expect(tester.getRect(find.byKey(const Key('pen-probe'))), before);
    await gesture.moveBy(const Offset(40, 10));
    await gesture.up();
    expect(events, ['down', 'move', 'up']);
    navigator.pop();
    await tester.pump();
    expect(_strip, findsNothing, reason: '퇴장 중에는 아직 편집기 경로가 남아 있다');
    await tester.pumpAndSettle();
    expect(_strip, findsOneWidget);
    expect(find.text('작업자 a1 · 상세 보기'), findsOneWidget);
    expect(f.gateway.calls.where((c) => c.startsWith('POST')), isEmpty);
  });

  testWidgets('L-07 편집기를 덮거나 다른 탭으로 가도 보류하고 교체·제거 뒤 해제한다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tab(tester, 2);
    final navigator = f.recordNavigator(tester);
    final editor = _probeRoute(editor: true);
    unawaited(navigator.push(editor));
    await tester.pumpAndSettle();
    f.deliver([alertRow()]);
    final cover = _probeRoute();
    unawaited(navigator.push(cover));
    await tester.pumpAndSettle();
    expect(_strip, findsNothing);
    await _tab(tester, 3);
    expect(_strip, findsNothing, reason: '편집기 탭이 숨겨져 있어도 편집 상태는 유지된다');
    await _tab(tester, 2);
    navigator.pop();
    await tester.pumpAndSettle();
    expect(_strip, findsNothing);
    final replacement = _probeRoute(editor: true);
    navigator.replace(oldRoute: editor, newRoute: replacement);
    await tester.pumpAndSettle();
    expect(_strip, findsNothing, reason: '편집기끼리 교체해도 보류가 풀리지 않는다');
    navigator.removeRoute(replacement);
    await tester.pumpAndSettle();
    expect(_strip, findsOneWidget);
  });

  testWidgets('L-07 중첩 편집기는 마지막 편집기까지 닫혀야 보류가 풀린다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tab(tester, 2);
    final navigator = f.recordNavigator(tester);
    unawaited(navigator.push(_probeRoute(editor: true)));
    await tester.pumpAndSettle();
    unawaited(navigator.push(_probeRoute(editor: true)));
    await tester.pumpAndSettle();
    f.deliver([alertRow()]);
    navigator.pop();
    await tester.pumpAndSettle();
    expect(_strip, findsNothing);
    navigator.pop();
    await tester.pumpAndSettle();
    expect(_strip, findsOneWidget);
  });

  testWidgets('L-07 보류 중 목록에서 빠진 경보도 보관하며 상세에서 누락 상태를 알린다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tab(tester, 2);
    final navigator = f.recordNavigator(tester);
    unawaited(navigator.push(_probeRoute(editor: true)));
    await tester.pumpAndSettle();
    f.deliver([alertRow()]);
    await tester.pumpAndSettle();
    f.deliver([]);
    await tester.pumpAndSettle();
    navigator.pop();
    await tester.pumpAndSettle();
    expect(_strip, findsOneWidget);
    await tester.tap(_open);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('alert-missing')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNull,
    );
  });

  testWidgets('L-07 새 수신은 모달·경로·목적지·입력 초점·커서·본문 위치를 바꾸지 않는다', (tester) async {
    final focus = FocusNode();
    final text = TextEditingController(text: '현장 기록 초안');
    addTearDown(focus.dispose);
    addTearDown(text.dispose);
    final f = _Fixture();
    await f.mount(tester);
    await _tab(tester, 2);
    unawaited(
      f
          .recordNavigator(tester)
          .push(
            _probeRoute(
              child: TextField(focusNode: focus, controller: text),
            ),
          ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(TextField));
    await tester.pumpAndSettle();
    text.selection = const TextSelection.collapsed(offset: 3);
    await tester.pumpAndSettle();
    final primary = FocusManager.instance.primaryFocus;
    final bounds = tester.getRect(find.byType(TextField));
    final pushes = List<Route<dynamic>>.of(f.routes.pushed);
    // 일반 MaterialPageRoute도 투명 barrier를 만든다. 경보 전후의 증가를 검사한다.
    final barriers = find
        .byType(ModalBarrier, skipOffstage: false)
        .evaluate()
        .length;
    final animatedBarriers = find
        .byType(AnimatedModalBarrier, skipOffstage: false)
        .evaluate()
        .length;
    expect(primary, focus);
    f.deliver([alertRow()]);
    await tester.pumpAndSettle();
    expect(_strip, findsOneWidget);
    expect(FocusManager.instance.primaryFocus, same(primary));
    expect(text.text, '현장 기록 초안');
    expect(text.selection, const TextSelection.collapsed(offset: 3));
    expect(tester.getRect(find.byType(TextField)), bounds);
    expect(tester.widget<IndexedStack>(_content).index, 2);
    expect(f.routes.pushed, pushes);
    expect(find.byType(Dialog, skipOffstage: false), findsNothing);
    expect(find.byType(BottomSheet, skipOffstage: false), findsNothing);
    expect(
      find.byType(ModalBarrier, skipOffstage: false),
      findsNWidgets(barriers),
    );
    expect(
      find.byType(AnimatedModalBarrier, skipOffstage: false),
      findsNWidgets(animatedBarriers),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('L-07 닫기는 미대응·공유 상태·저장소를 바꾸지 않고 재수신에도 유지된다', (tester) async {
    final f = _Fixture();
    f.gateway.rows = [alertRow()];
    await f.mount(tester);
    final screen = tester.widget<AlertsScreen>(
      find.byType(AlertsScreen, skipOffstage: false),
    );
    final calls = List<String>.of(f.gateway.calls);
    final writes = f.store.writes;
    await tester.tap(_dismiss);
    await tester.pumpAndSettle();
    expect(_strip, findsNothing);
    expect(screen.alerts!.item('a1')!.acknowledged, isFalse);
    expect(f.field.siteStatusSnapshot!.alerts.items.single.ackAt, isNull);
    expect(f.gateway.rows.single['ack_at'], isNull);
    expect(f.gateway.calls, calls);
    expect(f.store.writes, writes);
    f.deliver([alertRow()]);
    await tester.pumpAndSettle();
    await _tab(tester, 1);
    expect(_strip, findsNothing);
    expect(find.byKey(const Key('alert-row-a1')), findsOneWidget);
    expect(f.gateway.calls.where((c) => c.startsWith('POST')), isEmpty);
  });

  testWidgets('L-07 직접 누른 대상의 기존 상세로만 이동하고 반복 진입에도 ack하지 않는다', (tester) async {
    final f = _Fixture();
    f.gateway.rows = [
      alertRow(id: 'done', ackAt: '2026-09-14T15:12:00Z'),
      alertRow(id: 'target', type: 'fall'),
    ];
    await f.mount(tester);
    expect(tester.widget<IndexedStack>(_content).index, 0);
    expect(find.text('경보 상세'), findsNothing);
    await tester.tap(_open);
    await tester.pumpAndSettle();
    expect(tester.widget<IndexedStack>(_content).index, 1);
    expect(find.text('경보 상세'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('alert-target'))).data,
      '낙상 · 작업자 target',
    );
    expect(find.text('경보 ID · target'), findsOneWidget);
    expect(find.byType(Dialog), findsNothing);
    await _alertButton(tester, 'alerts-back');
    expect(find.text('경보 목록'), findsOneWidget);
    await tester.tap(_open);
    await tester.pumpAndSettle();
    expect(find.text('경보 ID · target'), findsOneWidget);
    expect(f.gateway.calls, ['GET', 'GET'], reason: '기존 탭 활성화 조회만 수행한다');
  });

  testWidgets('L-07 네 탭에서 동일 스트립을 유지하고 새 수신은 표시 대상을 가로채지 않는다', (tester) async {
    final f = _Fixture();
    f.gateway.rows = [alertRow()];
    await f.mount(tester);
    final element = tester.element(_strip);
    for (final destination in [1, 2, 3, 0]) {
      await _tab(tester, destination);
      expect(_strip, findsOneWidget);
      expect(tester.element(_strip), same(element));
      expect(find.text('작업자 a1 · 상세 보기'), findsOneWidget);
    }
    f.deliver([alertRow(id: 'new'), alertRow()]);
    await tester.pumpAndSettle();
    expect(find.text('작업자 a1 · 상세 보기'), findsOneWidget);
    await tester.tap(_dismiss);
    await tester.pumpAndSettle();
    expect(find.text('작업자 new · 상세 보기'), findsOneWidget);
  });

  testWidgets('L-07 서버 5종의 ack_at null만 수신 순서로 표시하고 미지원·깨진 값은 제외한다', (
    tester,
  ) async {
    final f = _Fixture();
    f.gateway.rows = [
      alertRow(id: 'done', ackAt: '2026-09-14T15:12:00Z'),
      alertRow(id: 'unsupported', type: 'danger'),
      {...alertRow(id: 'broken'), 'ack_at': ''},
      for (final type in AlertType.values)
        alertRow(id: type.name, type: type.name),
    ];
    await f.mount(tester);
    for (final type in AlertType.values) {
      expect(find.text('${type.label} · 미대응 (수신 기준)'), findsOneWidget);
      await tester.tap(_dismiss);
      await tester.pumpAndSettle();
    }
    expect(_strip, findsNothing);
    expect(f.gateway.calls, ['GET']);
  });

  testWidgets('L-07 보류 중 서버가 대응 확인한 건은 표시하지 않는다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tab(tester, 2);
    final navigator = f.recordNavigator(tester);
    unawaited(navigator.push(_probeRoute(editor: true)));
    await tester.pumpAndSettle();
    f.deliver([alertRow()]);
    await tester.pumpAndSettle();
    f.deliver([alertRow(ackAt: '2026-09-14T15:12:00Z')]);
    await tester.pumpAndSettle();
    navigator.pop();
    await tester.pumpAndSettle();
    expect(_strip, findsNothing);
    expect(f.gateway.calls.where((c) => c.startsWith('POST')), isEmpty);
  });

  testWidgets('L-07 자체 조회·타이머가 없고 오프라인에서도 수신 자료만 표시한다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tab(tester, 3);
    final calls = List<String>.of(f.gateway.calls);
    f.field.setOffline(true);
    f.deliver([alertRow()]);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(minutes: 3));
    expect(_strip, findsOneWidget);
    expect(f.gateway.calls, calls);
    await tester.tap(_open);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('alerts-offline')), findsOneWidget);
    expect(f.gateway.calls, calls);
  });

  testWidgets('L-07 조회 실패 안내는 경보 탭에 유지하고 스트립은 이전 수신만 표시한다', (tester) async {
    final f = _Fixture();
    f.gateway.rows = [alertRow()];
    await f.mount(tester);
    final pending = Completer<SiteStatus>();
    f.gateway.fetch = () => pending.future;
    await _tab(tester, 1);
    pending.completeError(const ApiFailure('private-error', status: 503));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('alerts-read-error')), findsOneWidget);
    expect(_strip, findsOneWidget);
    expect(
      find.descendant(of: _strip, matching: find.textContaining('실패')),
      findsNothing,
    );
    expect(find.textContaining('private-error'), findsNothing);
    expect(f.gateway.calls, ['GET', 'GET']);
  });

  testWidgets('L-07 권한 거부 후에는 대기 중이던 경보도 표시하지 않는다', (tester) async {
    final f = _Fixture();
    f.gateway.rows = [alertRow()];
    await f.mount(tester);
    f.gateway.fetch = () async =>
        throw const ApiFailure('private', status: 403);
    await _tab(tester, 1);
    expect(_strip, findsNothing);
    expect(find.byKey(const Key('alerts-forbidden')), findsOneWidget);
    await _tab(tester, 3);
    expect(_strip, findsNothing);
  });

  for (final layout in [
    (size: const Size(1385, 866), scale: 1.0),
    (size: const Size(866, 1385), scale: 1.0),
    (size: const Size(866, 1385), scale: 2.0),
    (size: const Size(600, 900), scale: 3.0),
  ]) {
    testWidgets('L-07 치수·본문 비겹침·터치 영역·글자 확대 ${layout.size} ×${layout.scale}', (
      tester,
    ) async {
      final f = _Fixture();
      await f.mount(tester, size: layout.size, scale: layout.scale);
      final before = tester.getRect(_content);
      final slot = tester.getRect(find.byKey(const Key('global-alert-slot')));
      f.deliver([
        {...alertRow(type: 'absence'), 'worker_name': '이름이 매우 긴 현장 작업자 ' * 8},
      ]);
      await tester.pumpAndSettle();
      expect(_strip, findsOneWidget);
      expect(tester.getRect(_content), before);
      expect(tester.getRect(_strip).overlaps(before), isFalse);
      expect(tester.getRect(_open).overlaps(tester.getRect(_dismiss)), isFalse);
      expect(
        tester.getRect(_dismiss).left - tester.getRect(_open).right,
        greaterThanOrEqualTo(vgGapTap),
      );
      expect(tester.getRect(_strip).bottom, lessThanOrEqualTo(slot.bottom));
      for (final target in [_open, _dismiss]) {
        expect(tester.getSize(target).width, greaterThanOrEqualTo(vgTapMin));
        expect(tester.getSize(target).height, greaterThanOrEqualTo(vgTapMin));
        expect(target.hitTestable(), findsOneWidget);
      }
      expect(tester.takeException(), isNull);
      await tester.tap(_dismiss);
      await tester.pumpAndSettle();
      expect(tester.getRect(_content), before);
      expect(_strip, findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}

MaterialPageRoute<void> _probeRoute({bool editor = false, Widget? child}) =>
    MaterialPageRoute<void>(
      settings: RouteSettings(name: editor ? vgRecordEditorRouteName : 'probe'),
      builder: (_) => Scaffold(body: child ?? const SizedBox.expand()),
    );

class _Routes extends NavigatorObserver {
  final pushed = <Route<dynamic>>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushed.add(route);
    super.didPush(route, previousRoute);
  }
}

class _Fixture {
  final gateway = AlertGatewayFixture()..rows = [];
  final store = AlertStoreFixture();
  final routes = _Routes();
  late final field = AlertFieldFixture(gateway, store);

  void deliver(List<Map<String, dynamic>> rows) {
    gateway.rows = rows;
    field.deliverSnapshot(gateway.snapshot());
  }

  NavigatorState recordNavigator(WidgetTester tester) =>
      Navigator.of(tester.element(find.byType(RecordHome)));

  Future<void> mount(
    WidgetTester tester, {
    Size size = const Size(1385, 866),
    double scale = 1,
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await field.signIn('demo', 'mock');
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      field.dispose();
    });
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        navigatorObservers: [routes],
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: FieldShell(controller: field),
      ),
    );
    await tester.pumpAndSettle();
  }
}
