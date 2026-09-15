import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/ui/alerts/alerts_screen.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/alerts_fixture.dart';

Future<void> _scrollTo(WidgetTester tester, Key key) async {
  final scrollable = find
      .descendant(
        of: find.byType(AlertsScreen),
        matching: find.byType(Scrollable),
      )
      .first;
  expect(scrollable, findsOneWidget);
  await tester.scrollUntilVisible(find.byKey(key), 200, scrollable: scrollable);
  await tester.pump();
}

Future<void> _tap(WidgetTester tester, String key) async {
  await _scrollTo(tester, Key(key));
  await tester.tap(find.byKey(Key(key)));
  await tester.pump();
}

void main() {
  testWidgets('L-02 목록 행은 상세만 열고 대상·시각 확인 후 명시적 1회만 POST한다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tap(tester, 'alert-row-a1');
    expect(find.text('경보 상세'), findsOneWidget);
    expect(find.byKey(const Key('alert-target')), findsOneWidget);
    expect(find.text('발생 시각 · 2026-09-15 00:00:00 KST'), findsOneWidget);
    expect(f.gateway.calls, ['GET']);
    final pending = Completer<bool>();
    f.gateway.ack = (_) => pending.future;
    await _tap(tester, 'alert-ack');
    expect(find.byKey(const Key('alert-write-sending')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNull,
    );
    await tester.tap(find.byKey(const Key('alert-ack')));
    expect(f.gateway.calls, ['GET', 'POST:a1']);
    f.gateway.markAcked('a1');
    pending.complete(true);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('alert-write-confirmed')), findsOneWidget);
    expect(find.textContaining('모의 대응 확인됨 · 실제 서버로 보내지 않았습니다'), findsOneWidget);
    expect(f.gateway.calls, ['GET', 'POST:a1', 'GET']);
    await f.close(tester);
  });

  testWidgets('L-03 오프라인 버튼은 비활성이고 내용·연락 방법만 보이며 예약하지 않는다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tap(tester, 'alert-row-a1');
    f.field.setOffline(true);
    await tester.pump();
    await _scrollTo(tester, const Key('alert-ack'));
    expect(find.text('연결 후 가능'), findsOneWidget);
    expect(find.byKey(const Key('alert-target')), findsOneWidget);
    expect(find.byKey(const Key('alert-contact')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNull,
    );
    await tester.tap(find.byKey(const Key('alert-ack')));
    expect(f.gateway.calls, ['GET']);
    expect(f.store.writes, 0);
    expect(find.textContaining('예약'), findsNothing);
    expect(find.byKey(const Key('alert-write-confirmed')), findsNothing);
    f.field.setOffline(false);
    await tester.pump();
    expect(f.gateway.calls, ['GET'], reason: '재연결은 예약 전송을 일으키지 않는다');
    await f.close(tester);
  });

  testWidgets('L-05 acked false는 실패 문구 없이 충돌과 재조회한 ack_by를 보인다', (
    tester,
  ) async {
    final f = _Fixture();
    f.gateway.ack = (id) async {
      f.gateway.markAcked(id, by: 'manager-b');
      return false;
    };
    await f.mount(tester);
    await _tap(tester, 'alert-row-a1');
    await _tap(tester, 'alert-ack');
    await tester.pumpAndSettle();
    expect(find.textContaining('다른 관리자가 이미 처리함'), findsOneWidget);
    expect(find.textContaining('실패'), findsNothing);
    expect(find.text('처리자 · manager-b'), findsOneWidget);
    expect(f.gateway.calls, ['GET', 'POST:a1', 'GET']);
    await _tap(tester, 'alerts-back');
    await _tap(tester, 'alerts-filter-acked');
    expect(
      find.textContaining('처리자 manager-b', findRichText: true),
      findsOneWidget,
    );
    await f.close(tester);
  });

  testWidgets('L-04 결과 불명은 상세 재진입·타이머·재연결에서 자동 재전송하지 않는다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    f.gateway.ack = (_) async =>
        throw const ApiFailure('private', status: 503, uncertainWrite: true);
    f.gateway.fetch = () async =>
        throw const ApiFailure('private', status: 503);
    await _tap(tester, 'alert-row-a1');
    await _tap(tester, 'alert-ack');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('alert-write-uncertain')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNull,
    );
    await _tap(tester, 'alerts-back');
    await _tap(tester, 'alert-row-a1');
    await tester.pump(const Duration(minutes: 2));
    f.field.setOffline(true);
    f.field.setOffline(false);
    await tester.pump();
    expect(f.gateway.calls.where((c) => c.startsWith('POST')), ['POST:a1']);
    expect(f.store.writes, 0);
    f.gateway.fetch = null;
    await _tap(tester, 'alerts-refresh');
    expect(find.byKey(const Key('alert-write-retryReady')), findsOneWidget);
    expect(f.gateway.calls.where((c) => c.startsWith('POST')), ['POST:a1']);
    await f.close(tester);
  });

  testWidgets('L-04 연결 표시 중 명확한 400 거부는 실패이고 자동 재전송하지 않는다', (tester) async {
    final f = _Fixture();
    f.gateway.ack = (_) async => throw const ApiFailure('private', status: 400);
    await f.mount(tester);
    expect(f.field.offline, isFalse);
    await _tap(tester, 'alert-row-a1');
    await _tap(tester, 'alert-ack');
    expect(find.byKey(const Key('alert-write-failed')), findsOneWidget);
    expect(find.byKey(const Key('alert-write-uncertain')), findsNothing);
    expect(f.gateway.calls, ['GET', 'POST:a1']);
    await f.close(tester);
  });

  testWidgets('L-01 전체 현장 기준으로 5종·상태 필터를 렌더하고 danger_zone은 제외한다', (
    tester,
  ) async {
    final f = _Fixture();
    f.gateway.rows = [
      for (final type in AlertType.values)
        alertRow(id: type.name, type: type.name),
      alertRow(id: 'unsupported', type: 'danger_zone'),
      alertRow(id: 'done', ackAt: '2026-09-14T15:12:00Z', ackBy: 'manager-b'),
    ];
    await f.mount(tester);
    expect(find.textContaining('전체 현장 기준'), findsOneWidget);
    expect(find.textContaining('이 현장', findRichText: true), findsNothing);
    expect(
      find.textContaining('danger_zone', findRichText: true),
      findsNothing,
    );
    expect(find.byKey(const Key('alert-row-unsupported')), findsNothing);
    expect(find.byKey(const Key('alerts-type-danger_zone')), findsNothing);
    expect(find.textContaining('종류 또는 필수 정보를 확인할 수 없는 경보'), findsOneWidget);
    final typeFilters = find.descendant(
      of: find.byKey(const Key('alerts-types')),
      matching: find.byType(OutlinedButton),
    );
    expect(typeFilters, findsNWidgets(6), reason: '전체 종류 + 서버 종류 5개');
    for (final type in AlertType.values) {
      expect(find.byKey(Key('alert-row-${type.name}')), findsOneWidget);
      await _tap(tester, 'alerts-type-${type.name}');
      expect(find.byKey(Key('alert-row-${type.name}')), findsOneWidget);
      expect(find.byKey(const Key('alert-row-unsupported')), findsNothing);
      for (final other in AlertType.values.where((t) => t != type)) {
        expect(find.byKey(Key('alert-row-${other.name}')), findsNothing);
      }
      await _tap(tester, 'alerts-type-all');
    }
    await _tap(tester, 'alerts-filter-acked');
    expect(find.byKey(const Key('alert-row-done')), findsOneWidget);
    expect(find.byKey(const Key('alert-row-sos')), findsNothing);
    await _tap(tester, 'alert-row-done');
    expect(find.textContaining('이 현장', findRichText: true), findsNothing);
    await f.close(tester);
  });

  testWidgets('다섯 경보의 필터·목록·상세 라벨은 관제 문구를 그대로 표시한다', (tester) async {
    const labels = {
      'sos': 'SOS',
      'fall': '낙상',
      'vital': '생체 이상',
      'geofence': '구획 이탈',
      'absence': '장기 미수신',
    };
    final f = _Fixture();
    f.gateway.rows = [
      for (final type in labels.keys) alertRow(id: type, type: type),
    ];
    await f.mount(tester);
    for (final entry in labels.entries) {
      final type = entry.key;
      final label = entry.value;
      expect(
        find.descendant(
          of: find.byKey(Key('alerts-type-$type')),
          matching: find.text(label),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(Key('alert-row-$type')),
          matching: find.textContaining(
            '$label · 작업자 $type\n',
            findRichText: true,
          ),
        ),
        findsOneWidget,
      );
      await _tap(tester, 'alerts-type-$type');
      expect(find.text('✓ $label'), findsOneWidget);
      await _tap(tester, 'alert-row-$type');
      expect(
        tester.widget<Text>(find.byKey(const Key('alert-target'))).data,
        '$label · 작업자 $type',
      );
      await _tap(tester, 'alerts-back');
      await _tap(tester, 'alerts-type-all');
    }
    expect(f.gateway.calls, ['GET']);
    await f.close(tester);
  });

  testWidgets('absence를 포함한 미대응 10건을 모두 표시하고 종류·상태 필터와 상세를 연다', (tester) async {
    final f = _Fixture();
    f.gateway.rows = [
      for (var i = 0; i < 9; i++) alertRow(id: 'fall-$i', type: 'fall'),
      alertRow(id: 'absence', type: 'absence')..['ts'] = '2026-09-13T03:00:00Z',
      alertRow(
        id: 'absence-done',
        type: 'absence',
        ackAt: '2026-09-14T15:12:00Z',
        ackBy: 'manager-b',
      ),
    ];
    await f.mount(tester);
    expect(
      find.text('마지막 수신 기준 · 전체 현장 미대응 10건 · 아래는 수신 목록의 필터 결과 10건'),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('alerts-rows')),
        matching: find.byType(InkWell),
      ),
      findsNWidgets(10),
    );
    expect(find.byKey(const Key('alert-row-absence')), findsOneWidget);
    expect(find.byKey(const Key('alert-row-absence-done')), findsNothing);
    expect(find.textContaining('종류 또는 필수 정보를 확인할 수 없는 경보'), findsNothing);
    await _tap(tester, 'alerts-type-absence');
    expect(find.textContaining('필터 결과 1건'), findsOneWidget);
    expect(find.byKey(const Key('alert-row-absence')), findsOneWidget);
    for (var i = 0; i < 9; i++) {
      expect(find.byKey(Key('alert-row-fall-$i')), findsNothing);
    }
    await _tap(tester, 'alert-row-absence');
    expect(find.text('장기 미수신 · 작업자 absence'), findsOneWidget);
    expect(find.text('작업자 ID · worker-absence'), findsOneWidget);
    expect(find.text('발생 시각 · 2026-09-13 12:00:00 KST'), findsOneWidget);
    expect(find.text('수신 상태 · 미대응'), findsOneWidget);
    expect(find.byKey(const Key('alert-missing')), findsNothing);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNotNull,
    );
    await _tap(tester, 'alerts-back');
    await _tap(tester, 'alerts-filter-acked');
    expect(find.text('✓ 장기 미수신'), findsOneWidget);
    expect(find.byKey(const Key('alert-row-absence')), findsNothing);
    expect(find.byKey(const Key('alert-row-absence-done')), findsOneWidget);
    await _tap(tester, 'alert-row-absence-done');
    expect(find.text('장기 미수신 · 작업자 absence-done'), findsOneWidget);
    expect(find.text('수신 상태 · 대응완료'), findsOneWidget);
    expect(find.text('처리자 · manager-b'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNull,
    );
    expect(f.gateway.calls, ['GET']);
    await f.close(tester);
  });

  testWidgets('L-06 종료·다시 열림을 ack_at 전이로 표시하고 목록 누락을 종료로 꾸미지 않는다', (
    tester,
  ) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tap(tester, 'alert-row-a1');
    f.gateway.markAcked('a1');
    await _tap(tester, 'alerts-refresh');
    expect(find.byKey(const Key('alert-closed')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNull,
    );
    f.gateway.rows = [alertRow()];
    await _tap(tester, 'alerts-refresh');
    expect(find.byKey(const Key('alert-reopened')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNotNull,
    );
    f.gateway.rows = [];
    await _tap(tester, 'alerts-refresh');
    expect(find.byKey(const Key('alert-missing')), findsOneWidget);
    expect(find.byKey(const Key('alert-closed')), findsNothing);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNull,
    );
    expect(f.gateway.calls.any((c) => c.startsWith('POST')), isFalse);
    await f.close(tester);
  });

  testWidgets('경보 부분 조회 오류는 캐시·수신 시각을 남기지만 확인을 막는다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tap(tester, 'alert-row-a1');
    f.gateway.alertsOk = false;
    await _tap(tester, 'alerts-refresh');
    expect(find.byKey(const Key('alerts-read-error')), findsOneWidget);
    expect(find.byKey(const Key('alert-target')), findsOneWidget);
    expect(find.text('마지막 수신 2026-09-15 00:13:04 KST'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const Key('alert-ack'))).onPressed,
      isNull,
    );
    expect(find.textContaining('synthetic-private-error'), findsNothing);
    await f.close(tester);
  });

  testWidgets('403은 이전 상세를 숨기고 타이머 재시도를 중지한다', (tester) async {
    final f = _Fixture();
    await f.mount(tester);
    await _tap(tester, 'alert-row-a1');
    f.gateway.fetch = () async =>
        throw const ApiFailure('private', status: 403);
    await _tap(tester, 'alerts-refresh');
    expect(find.byKey(const Key('alerts-forbidden')), findsOneWidget);
    expect(find.byKey(const Key('alert-target')), findsNothing);
    expect(find.byKey(const Key('alert-ack')), findsNothing);
    final count = f.gateway.calls.length;
    await tester.pump(const Duration(minutes: 3));
    expect(f.gateway.calls.length, count);
    await f.close(tester);
  });

  testWidgets('V-5/T-1 목록 한 패널의 행은 72dp·일반 56dp·대응 확인 64dp다', (tester) async {
    final f = _Fixture();
    f.gateway.rows = [
      for (final type in AlertType.values)
        alertRow(id: type.name, type: type.name),
    ];
    await f.mount(tester);
    final panel = find.byKey(const Key('alerts-rows'));
    expect(panel, findsOneWidget);
    for (final type in AlertType.values) {
      final row = find.descendant(
        of: panel,
        matching: find.byKey(Key('alert-row-${type.name}')),
      );
      expect(tester.getSize(row).height, 72);
      expect(
        tester.getSize(find.byKey(Key('alerts-type-${type.name}'))).height,
        greaterThanOrEqualTo(56),
      );
    }
    await _tap(tester, 'alert-row-sos');
    await _scrollTo(tester, const Key('alert-ack'));
    expect(
      tester.getSize(find.byKey(const Key('alert-ack'))).height,
      greaterThanOrEqualTo(64),
    );
    expect(find.byKey(const Key('alert-ack')), findsOneWidget);
    await f.close(tester);
  });

  testWidgets('글자 3배와 좁은 화면에서 장기 미수신 필터·상세 확인 버튼까지 도달한다', (tester) async {
    final f = _Fixture();
    f.gateway.rows = [alertRow(type: 'absence')];
    await f.mount(tester, size: const Size(600, 900), scale: 3);
    expect(
      tester.getSize(find.byKey(const Key('alert-row-a1'))).height,
      greaterThan(72),
    );
    await _tap(tester, 'alerts-type-absence');
    expect(find.text('✓ 장기 미수신'), findsOneWidget);
    await _tap(tester, 'alert-row-a1');
    await _scrollTo(tester, const Key('alert-ack'));
    expect(find.byKey(const Key('alert-ack')).hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
    await f.close(tester);
  });

  testWidgets('destination 1을 연결하고 비활성·백그라운드에서는 조회하지 않는다', (tester) async {
    final f = _Fixture();
    await f.mount(tester, shell: true, size: const Size(1385, 866));
    expect(f.gateway.calls, ['GET'], reason: '첫 진입은 현장 화면만 조회한다');
    await tester.tap(find.byKey(const Key('rail-destination-1')));
    await tester.pumpAndSettle();
    expect(find.text('경보 목록'), findsOneWidget);
    expect(f.gateway.calls, ['GET', 'GET']);
    expect(
      tester.widget<Text>(find.byKey(const Key('shell-receipt'))).data,
      '마지막 수신 2026-09-15 00:13:04 KST',
    );
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump(const Duration(minutes: 2));
    expect(f.gateway.calls.length, 2);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(f.gateway.calls.length, 3);
    await tester.tap(find.byKey(const Key('rail-destination-2')));
    await tester.pump();
    await tester.pump(const Duration(minutes: 2));
    expect(f.gateway.calls.length, 3);
    await f.close(tester);
  });
}

class _Fixture {
  final gateway = AlertGatewayFixture();
  final store = AlertStoreFixture();
  late final field = AlertFieldFixture(gateway, store);

  Future<void> mount(
    WidgetTester tester, {
    Size size = const Size(1000, 1000),
    double scale = 1,
    bool shell = false,
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await field.signIn('demo', 'mock');
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: shell
            ? FieldShell(controller: field)
            : Scaffold(
                body: AlertsScreen(
                  controller: field,
                  now: () => DateTime.parse('2026-09-14T15:13:04.759Z'),
                ),
              ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  Future<void> close(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    field.dispose();
  }
}
