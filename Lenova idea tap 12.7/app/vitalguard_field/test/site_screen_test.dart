import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/cctv/cctv_screen.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';
import 'package:vitalguard_field/ui/site/site_screen.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/site_status_fixture.dart';

const _contents = {
  'weather': '기상 특보 0건',
  'workers': '정상 0명 · 대기 0명',
  'gas': '가스 경보 0건',
  'aed': '장비 0대 · 점검 필요 0건',
};

Finder _rowText(String id, String value) => find.descendant(
  of: find.byKey(Key('site-row-$id')),
  matching: find.textContaining(value, findRichText: true),
);

Future<void> _scrollTo(WidgetTester tester, Key key) async {
  final scrollable = find
      .descendant(
        of: find.byKey(const Key('site-summary-scroll')),
        matching: find.byType(Scrollable),
      )
      .first;
  expect(scrollable, findsOneWidget);
  await tester.scrollUntilVisible(find.byKey(key), 200, scrollable: scrollable);
  await tester.pump();
}

void main() {
  for (final failed in _contents.keys) {
    testWidgets('S-09 $failed 한 행만 실패하고 나머지 세 행은 보인다', (tester) async {
      final fixture = _Fixture();
      fixture.gateway.reply[failed] = {
        'ok': false,
        'error': 'synthetic-private-error',
      };
      await fixture.mount(tester);
      expect(_rowText(failed, '수신 실패'), findsOneWidget);
      for (final entry in _contents.entries.where((e) => e.key != failed)) {
        expect(_rowText(entry.key, entry.value), findsOneWidget);
      }
      expect(find.text('미대응 경보 0건'), findsOneWidget);
      expect(find.byKey(const Key('site-refresh-error')), findsNothing);
      expect(
        find.textContaining('synthetic-private-error', findRichText: true),
        findsNothing,
      );
      await fixture.close(tester);
    });
  }

  testWidgets('경보 실패도 네 신호등을 유지하고 전체 현장 집계를 명시한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    expect(find.text('전체 현장 기준 · 이 현장만의 경보 수가 아닙니다'), findsOneWidget);
    fixture.gateway.reply['alerts'] = {'ok': false, 'error': 'private'};
    await tester.tap(find.byKey(const Key('site-refresh')));
    await tester.pump();
    expect(find.textContaining('경보 수신 실패'), findsOneWidget);
    expect(find.text('미대응 경보 0건'), findsNothing);
    for (final entry in _contents.entries) {
      expect(_rowText(entry.key, entry.value), findsOneWidget);
    }
    await fixture.close(tester);
  });

  testWidgets('S-07 idle은 모든 행에서 데이터 없음이고 정상 0과 다른 글자다', (tester) async {
    final fixture = _Fixture();
    for (final id in _contents.keys) {
      fixture.gateway.reply[id] = {'ok': true, 'level': 'idle'};
    }
    await fixture.mount(tester);
    for (final id in _contents.keys) {
      expect(
        _rowText(id, id == 'aed' ? '장비 수 데이터 없음' : '데이터 없음 · 수신 또는 전원 대기'),
        findsOneWidget,
      );
      expect(_rowText(id, _contents[id]!), findsNothing);
    }
    fixture.gateway.reply = siteStatusReply();
    await tester.tap(find.byKey(const Key('site-refresh')));
    await tester.pump();
    for (final entry in _contents.entries) {
      expect(_rowText(entry.key, entry.value), findsOneWidget);
      expect(_rowText(entry.key, '데이터 없음'), findsNothing);
    }
    await fixture.close(tester);
  });

  testWidgets('S-07 첫 요청 중·첫 수신 실패는 0건을 만들지 않는다', (tester) async {
    final fixture = _Fixture();
    final pending = Completer<SiteStatus>();
    fixture.gateway.fetch = () => pending.future;
    await fixture.mount(tester);
    expect(find.text('갱신 중 · 첫 자료를 기다리고 있습니다'), findsOneWidget);
    expect(find.textContaining('마지막 수신 없음'), findsOneWidget);
    for (final id in _contents.keys) {
      expect(_rowText(id, '데이터 없음 · 한 번도 받지 못함'), findsOneWidget);
    }
    pending.completeError(const ApiFailure('synthetic-private-error'));
    await tester.pumpAndSettle();
    expect(find.textContaining('수신 실패 · 연결 상태'), findsOneWidget);
    expect(find.text('미대응 경보 0건'), findsNothing);
    expect(find.textContaining('synthetic-private-error'), findsNothing);
    expect(find.textContaining('마지막 수신 없음'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('S-08 오래된 자료는 갱신 중·실패에도 KST 수신 시각과 함께 남는다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    expect(find.byKey(const Key('site-stale')), findsNothing);
    final pending = Completer<SiteStatus>();
    fixture.gateway.fetch = () => pending.future;
    fixture.now = fixture.now.add(const Duration(minutes: 5));
    await tester.pump(const Duration(minutes: 5));
    expect(fixture.gateway.calls, 2, reason: '갱신 중에는 요청을 겹치지 않는다');
    expect(find.byKey(const Key('site-stale')), findsOneWidget);
    expect(find.textContaining('갱신 중 · 수신 완료 전까지'), findsOneWidget);
    expect(find.text('마지막 수신 2026-09-15 00:13:04 KST'), findsOneWidget);
    pending.completeError(const ApiFailure('synthetic-private-error'));
    await tester.pumpAndSettle();
    expect(find.textContaining('갱신 실패 · 이전에 받은 자료'), findsOneWidget);
    expect(find.text('마지막 수신 2026-09-15 00:13:04 KST'), findsOneWidget);
    for (final entry in _contents.entries) {
      expect(_rowText(entry.key, entry.value), findsOneWidget);
    }
    fixture.gateway.fetch = null;
    fixture.gateway.reply['fetchedAt'] = fixture.now.toIso8601String();
    await tester.tap(find.byKey(const Key('site-refresh')));
    await tester.pump();
    expect(find.byKey(const Key('site-stale')), findsNothing);
    expect(find.byKey(const Key('site-refresh-error')), findsNothing);
    expect(find.text('마지막 수신 2026-09-15 00:18:04 KST'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('S-10 403은 역할·현장 배정 안내이며 버튼·자동·탭 재진입 재시도가 없다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    fixture.gateway.fetch = () async =>
        throw const ApiFailure('private', status: 403);
    await tester.tap(find.byKey(const Key('site-refresh')));
    await tester.pump();
    expect(find.textContaining('역할 또는 현장 범위 밖'), findsOneWidget);
    expect(find.textContaining('관리자에게 역할과 현장 배정'), findsOneWidget);
    expect(find.byKey(const Key('site-refresh')), findsNothing);
    expect(find.textContaining('재시도'), findsNothing);
    expect(find.textContaining('새로고침'), findsNothing);
    for (final id in _contents.keys) {
      expect(_rowText(id, '접근 권한 없음'), findsOneWidget);
      expect(_rowText(id, _contents[id]!), findsNothing);
    }
    expect(find.text('미대응 경보 0건'), findsNothing);
    final calls = fixture.gateway.calls;
    await tester.pump(const Duration(minutes: 10));
    await fixture.pumpScreen(tester, active: false);
    await fixture.pumpScreen(tester);
    expect(fixture.gateway.calls, calls);
    await fixture.close(tester);
  });

  for (final entry in {
    '2026-09-14T15:13:04.759Z': '2026-09-15 00:13:04',
    '2026-12-31T15:00:00Z': '2027-01-01 00:00:00',
  }.entries) {
    testWidgets('fetchedAt ${entry.key}를 기기 시간대와 무관하게 KST로 표시한다', (
      tester,
    ) async {
      final fixture = _Fixture();
      fixture.gateway.reply['fetchedAt'] = entry.key;
      await fixture.mount(tester);
      expect(find.text('마지막 수신 ${entry.value} KST'), findsOneWidget);
      expect(fixture.controller.siteStatusSnapshot!.fetchedAt, entry.key);
      await fixture.close(tester);
    });
  }

  testWidgets('V-5 네 행은 한 패널의 72dp이며 주 실행 64·일반 56dp다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    final panel = find.byKey(const Key('site-signals'));
    expect(panel, findsOneWidget);
    for (final id in _contents.keys) {
      final row = find.descendant(
        of: panel,
        matching: find.byKey(Key('site-row-$id')),
      );
      expect(row, findsOneWidget);
      expect(tester.getSize(row).height, 72);
    }
    expect(
      tester.getSize(find.byKey(const Key('site-refresh'))).height,
      greaterThanOrEqualTo(64),
    );
    await _scrollTo(tester, const Key('site-open-cctv'));
    expect(
      tester.getSize(find.byKey(const Key('site-open-cctv'))).height,
      greaterThanOrEqualTo(56),
    );
    await fixture.close(tester);
  });

  testWidgets('글자 3배·좁은 화면에서 행이 늘어나고 CCTV까지 스크롤한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester, size: const Size(600, 900), scale: 3);
    await _scrollTo(tester, const Key('site-row-workers'));
    expect(
      tester.getSize(find.byKey(const Key('site-row-workers'))).height,
      greaterThan(72),
    );
    await _scrollTo(tester, const Key('site-open-cctv'));
    expect(
      find.byKey(const Key('site-open-cctv')).hitTestable(),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await fixture.close(tester);
  });

  testWidgets('네 행은 각각 상세로 가며 작업자·가스의 기존 경로를 유지한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    for (final (id, title) in [
      ('weather', '기상·특보 상세'),
      ('aed', 'AED 상세'),
      ('workers', '작업자 목록'),
      ('gas', '가스 감지기 상세'),
    ]) {
      await tester.ensureVisible(
        find.byKey(Key('site-row-$id'), skipOffstage: false),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key('site-row-$id')));
      await tester.pumpAndSettle();
      expect(find.text(title), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);
      expect(fixture.gateway.calls, 1, reason: '진입만으로 추가 조회하지 않는다');
      await tester.ensureVisible(
        find.byKey(Key('$id-back'), skipOffstage: false),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key('$id-back')));
      await tester.pumpAndSettle();
      expect(find.text('현장 요약'), findsOneWidget);
    }
    await fixture.close(tester);
  });

  testWidgets('CCTV는 요약 카드에서만 시작하고 탭 이탈·복귀·뒤로가기에서 active를 지킨다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester, shell: true, size: const Size(1385, 866));
    expect(fixture.gateway.cctvCalls, 0);
    expect(find.byType(CctvScreen), findsNothing);
    await _scrollTo(tester, const Key('site-open-cctv'));
    await tester.tap(find.byKey(const Key('site-open-cctv')));
    await tester.pump();
    expect(fixture.gateway.cctvCalls, 1);
    expect(tester.widget<CctvScreen>(find.byType(CctvScreen)).active, isTrue);
    await tester.tap(find.byKey(const Key('rail-destination-1')));
    await tester.pump();
    final hidden = find.byType(CctvScreen, skipOffstage: false);
    expect(tester.widget<CctvScreen>(hidden).active, isFalse);
    await tester.pump(const Duration(seconds: 30));
    expect(fixture.gateway.cctvCalls, 1);
    await tester.tap(find.byKey(const Key('rail-destination-0')));
    await tester.pump();
    expect(fixture.gateway.cctvCalls, 2);
    await tester.tap(find.byKey(const Key('site-back-from-cctv')));
    await tester.pump();
    expect(tester.widget<CctvScreen>(hidden).active, isFalse);
    await tester.pump(const Duration(seconds: 30));
    expect(fixture.gateway.cctvCalls, 2);
    expect(find.text('현장 요약'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('요약 자동 갱신은 비활성 탭과 백그라운드에서 멈춘다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester, active: false);
    await tester.pump(const Duration(minutes: 2));
    expect(fixture.gateway.calls, 0);
    await fixture.pumpScreen(tester);
    expect(fixture.gateway.calls, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump(const Duration(minutes: 2));
    expect(fixture.gateway.calls, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(fixture.gateway.calls, 2);
    await fixture.close(tester);
  });

  testWidgets('현장이 첫 목적지이며 상단 마지막 수신은 기록 시각과 섞이지 않는다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester, shell: true, size: const Size(1385, 866));
    expect(find.text('현장 요약'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('shell-receipt'))).data,
      '마지막 수신 2026-09-15 00:13:04 KST',
    );
    expect(
      fixture.controller.fetchedAt,
      isNotNull,
      reason: '숨은 기록 탭의 갱신은 별도 시각을 쓴다',
    );
    await fixture.close(tester);
  });
}

class _Gateway extends MockGateway {
  Map<String, dynamic> reply = siteStatusReply();
  Future<SiteStatus> Function()? fetch;
  int calls = 0, cctvCalls = 0;

  @override
  Future<SiteStatus> siteStatus(String accessToken) async {
    calls++;
    return fetch == null ? SiteStatus(reply) : await fetch!();
  }

  @override
  Future<CctvTicket> cctvTicket(String accessToken, String cameraId) async {
    cctvCalls++;
    throw const ApiFailure('모의 영상 없음', status: 503);
  }
}

class _Fixture {
  final gateway = _Gateway();
  late final controller = FieldCoordinator(
    gateway,
    MemoryStore(),
    MockSpeechInput(),
  );
  DateTime now = DateTime.parse('2026-09-14T15:13:04.759Z');
  double scale = 1;

  Future<void> mount(
    WidgetTester tester, {
    bool active = true,
    bool shell = false,
    Size size = const Size(1000, 1000),
    double scale = 1,
  }) async {
    this.scale = scale;
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await controller.signIn('demo', 'mock');
    await pumpScreen(tester, active: active, shell: shell);
  }

  Future<void> pumpScreen(
    WidgetTester tester, {
    bool active = true,
    bool shell = false,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: shell
            ? FieldShell(controller: controller)
            : Scaffold(
                body: SiteScreen(
                  controller: controller,
                  active: active,
                  now: () => now,
                ),
              ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  Future<void> close(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  }
}
