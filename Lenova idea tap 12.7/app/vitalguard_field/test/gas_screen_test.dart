import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/site/gas_screen.dart';
import 'package:vitalguard_field/ui/site/site_screen.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/gas_fixture.dart';

Future<void> _scrollTo(WidgetTester tester, String key) async {
  await tester.scrollUntilVisible(
    find.byKey(Key(key)),
    240,
    scrollable: find
        .descendant(
          of: find.byKey(const Key('gas-detail-scroll')),
          matching: find.byType(Scrollable),
        )
        .first,
  );
  await tester.pump();
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

String _value(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key('gas-value-$key'))).data!;

void _expectNoPpm() {
  expect(
    find.textContaining(
      RegExp('ppm', caseSensitive: false),
      findRichText: true,
      skipOffstage: false,
    ),
    findsNothing,
  );
}

void main() {
  testWidgets('가스 행 탭은 추가 조회 없이 S-04로 들어가고 버튼·시스템 뒤로가기는 요약으로 돌아온다', (
    tester,
  ) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    expect(fixture.gateway.calls, 1);
    expect(find.byType(GasScreen), findsOneWidget);
    expect(find.text('가스 감지기 상세'), findsOneWidget);
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.text('가스 수신 정보'), findsNothing);
    await _tap(tester, 'gas-back');
    expect(find.text('현장 요약'), findsOneWidget);
    await _tap(tester, 'site-row-gas');
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('현장 요약'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('O₂ 20.9 %·CO 151 raw·H₂S 10 raw를 각각 판정·위치와 표시하고 ppm 환산값이 없다', (
    tester,
  ) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    for (final (key, name, value, location) in [
      ('o2', 'O₂ 산소 · 판정 정상', '20.9 %', '현장 가스 감지기'),
      ('co', 'CO 일산화탄소 · 판정 주의', '151 raw', '탱크 야드'),
      ('h2s', 'H₂S 황화수소 · 판정 정상', '10 raw', '현장 가스 감지기'),
    ]) {
      await _scrollTo(tester, 'gas-location-$key');
      final row = find.byKey(Key('gas-row-$key'));
      expect(
        find.descendant(of: row, matching: find.text(name)),
        findsOneWidget,
      );
      expect(_value(tester, key), value);
      expect(
        find.descendant(of: row, matching: find.text('위치 $location')),
        findsOneWidget,
      );
      _expectNoPpm();
    }
    expect(find.text('raw는 센서 원시값(ADC)으로, 절대 농도가 아닙니다.'), findsOneWidget);
    expect(find.text('감지기 ID synthetic-gas-01'), findsOneWidget);
    expect(find.text('전원 on (서버 값)'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('O₂는 관제처럼 소수 1자리로 표시해도 경계 양쪽 서버 판정을 유지한다', (tester) async {
    final fixture = _Fixture();
    fixture.row('o2').addAll(<String, dynamic>{
      'value': 18.49,
      'level': 'danger',
    });
    await fixture.mount(tester);
    expect(_value(tester, 'o2'), '18.5 %');
    expect(find.text('O₂ 산소 · 판정 위험'), findsOneWidget);
    expect(fixture.controller.siteStatusSnapshot!.gas.gases.first.value, 18.49);
    expect(fixture.row('o2')['value'], 18.49);
    fixture.row('o2').addAll(<String, dynamic>{
      'value': 18.51,
      'level': 'warn',
    });
    await _tap(tester, 'gas-refresh');
    expect(_value(tester, 'o2'), '18.5 %');
    expect(find.text('O₂ 산소 · 판정 주의'), findsOneWidget);
    fixture.row('o2')['value'] = 20;
    await _tap(tester, 'gas-refresh');
    expect(_value(tester, 'o2'), '20.0 %');
    await fixture.close(tester);
  });

  testWidgets('O₂의 다른 서버 단위와 CO·H₂S raw는 임의로 반올림하거나 환산하지 않는다', (tester) async {
    final fixture = _Fixture();
    fixture.row('o2').addAll(<String, dynamic>{'value': 20.9876, 'unit': 'mV'});
    fixture.row('co')['value'] = 151.2345;
    fixture.row('h2s')['value'] = 10.6789;
    await fixture.mount(tester);
    expect(_value(tester, 'o2'), '20.9876 mV');
    expect(_value(tester, 'co'), '151.2345 raw');
    expect(_value(tester, 'h2s'), '10.6789 raw');
    _expectNoPpm();
    await fixture.close(tester);
  });

  for (final mock in [true, false]) {
    testWidgets('isMock=$mock 모드를 명시하고 데모를 실연동으로 표시하지 않는다', (tester) async {
      final fixture = _Fixture(mock: mock);
      await fixture.mount(tester);
      expect(
        find.text(mock ? '모의 데이터 · 데모' : '실연동 모드 · 서버 데이터'),
        findsOneWidget,
      );
      expect(find.textContaining(mock ? '실연동' : '모의 데이터'), findsNothing);
      fixture.gateway.reply['gas'] = {'ok': false};
      await _tap(tester, 'gas-refresh');
      expect(find.byKey(const Key('gas-source')), findsOneWidget);
      expect(find.textContaining(mock ? '실연동' : '모의 데이터'), findsNothing);
      await fixture.close(tester);
    });
  }

  testWidgets('측정값 0 raw와 미수신은 다른 문구이며 누락값을 0으로 채우지 않는다', (tester) async {
    final fixture = _Fixture();
    fixture.row('co')['value'] = 0;
    fixture.row('h2s').remove('value');
    await fixture.mount(tester);
    expect(_value(tester, 'co'), '0 raw');
    expect(_value(tester, 'h2s'), '측정값 없음 · 값을 받지 못했습니다');
    expect(find.text('0 raw'), findsOneWidget);
    fixture.row('co')['value'] = null;
    await _tap(tester, 'gas-refresh');
    expect(_value(tester, 'co'), '측정값 없음 · 값을 받지 못했습니다');
    expect(find.text('0 raw'), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('단위 미수신이면 수치 표시를 보류하고 서버가 다른 단위를 보내면 그대로 쓴다', (tester) async {
    final fixture = _Fixture();
    fixture.row('o2').remove('unit');
    await fixture.mount(tester);
    expect(_value(tester, 'o2'), '측정값 표시 보류 · 단위를 받지 못했습니다');
    expect(find.textContaining('20.9'), findsNothing);
    expect(find.text('단위 없음 · 서버 단위를 받지 못했습니다'), findsOneWidget);
    fixture.row('o2')['unit'] = 'mV';
    await _tap(tester, 'gas-refresh');
    expect(_value(tester, 'o2'), '20.9 mV');
    expect(find.text('20.9 %'), findsNothing);
    _expectNoPpm();
    await fixture.close(tester);
  });

  testWidgets('개별·감지기 idle은 수신·전원 대기로 표시하고 남아 있는 수치도 숨긴다', (tester) async {
    final fixture = _Fixture();
    fixture.row('co')['level'] = 'idle';
    fixture.row('co')['value'] = 0;
    await fixture.mount(tester);
    expect(find.text('CO 일산화탄소 · 판정 수신·전원 대기'), findsOneWidget);
    expect(_value(tester, 'co'), '측정 대기 · 수신·전원 대기');
    expect(find.text('0 raw'), findsNothing);
    expect(_value(tester, 'o2'), '20.9 %');
    fixture.gas['level'] = 'idle';
    await _tap(tester, 'gas-refresh');
    for (final key in ['o2', 'co', 'h2s']) {
      expect(_value(tester, key), '측정 대기 · 수신·전원 대기');
    }
    expect(find.textContaining('20.9'), findsNothing);
    expect(find.text('10 raw'), findsNothing);
    _expectNoPpm();
    await fixture.close(tester);
  });

  testWidgets('빈 목록·누락 목록과 장비 정보 없음은 정상 0이 아니며 3종의 미수신을 알린다', (tester) async {
    final fixture = _Fixture();
    fixture.gas.remove('gases');
    fixture.gas.remove('deviceId');
    fixture.gas.remove('lastSeenAt');
    fixture.gas.remove('power');
    await fixture.mount(tester);
    expect(find.text('가스별 데이터 없음 · 목록을 받지 못했습니다'), findsOneWidget);
    expect(find.text('감지기 ID 데이터 없음'), findsOneWidget);
    expect(find.text('감지기 마지막 수신 시각 정보 없음'), findsOneWidget);
    expect(find.text('전원 데이터 없음'), findsOneWidget);
    for (final key in ['o2', 'co', 'h2s']) {
      expect(_value(tester, key), '측정값 없음 · 값을 받지 못했습니다');
    }
    fixture.gas['gases'] = <Object>[];
    await _tap(tester, 'gas-refresh');
    expect(find.textContaining('수신 목록에서 3종의 값을 확인할 수 없습니다'), findsOneWidget);
    expect(find.text('0 raw'), findsNothing);
    expect(find.text('0 %'), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('판정 danger·알 수 없는 상태는 수치와 별개로 표시하고 임계값을 추정하지 않는다', (
    tester,
  ) async {
    final fixture = _Fixture();
    fixture.row('co')['level'] = 'danger';
    fixture.row('co')['value'] = 0;
    fixture.row('h2s')['level'] = 'unknown';
    await fixture.mount(tester);
    expect(find.text('CO 일산화탄소 · 판정 위험'), findsOneWidget);
    expect(_value(tester, 'co'), '0 raw');
    expect(find.text('H₂S 황화수소 · 판정 확인 불가'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('gas만 실패하면 이전 가스값을 지우고 복귀한 기상·작업자·AED는 유지한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    fixture.gateway.reply['gas'] = {
      'ok': false,
      'error': 'synthetic-private-error',
    };
    await _tap(tester, 'gas-refresh');
    expect(find.byKey(const Key('gas-section-error')), findsOneWidget);
    expect(find.byKey(const Key('gas-refresh-error')), findsNothing);
    expect(find.byKey(const Key('gas-readings')), findsNothing);
    expect(find.textContaining('synthetic-private-error'), findsNothing);
    expect(find.text('151 raw'), findsNothing);
    await _tap(tester, 'gas-back');
    for (final text in ['기상 특보 0건', '정상 0명', '장비 0대']) {
      expect(find.textContaining(text, findRichText: true), findsOneWidget);
    }
    await fixture.close(tester);
  });

  testWidgets('최초 요청 중·최초 실패는 값 없음이며 0을 생성하지 않는다', (tester) async {
    final fixture = _Fixture();
    final pending = Completer<SiteStatus>();
    fixture.gateway.fetch = () => pending.future;
    await fixture.mount(tester);
    expect(find.text('가스 데이터 없음 · 아직 받지 못했습니다'), findsOneWidget);
    expect(find.textContaining('마지막 수신 없음'), findsOneWidget);
    expect(find.textContaining('갱신 중 · 첫 자료'), findsOneWidget);
    pending.completeError(const ApiFailure('private'));
    await tester.pump();
    expect(find.byKey(const Key('gas-refresh-error')), findsOneWidget);
    expect(find.byKey(const Key('gas-readings')), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('lastSeenAt은 날짜 경계를 넘겨 KST로 표시하고 요약 수신과 구별한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    expect(find.text('감지기 마지막 수신 2026-09-15 00:12:44 KST'), findsOneWidget);
    expect(find.text('마지막 수신 2026-09-15 00:13:04 KST'), findsOneWidget);
    fixture.gas['lastSeenAt'] = '2026-09-14T11:12:44-04:00';
    await _tap(tester, 'gas-refresh');
    expect(find.text('감지기 마지막 수신 2026-09-15 00:12:44 KST'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('감지기 수신은 5분 경계부터 오래됨을 표시하며 조회 시각이 최신이어도 숨기지 않는다', (tester) async {
    final fixture = _Fixture();
    fixture.gas['lastSeenAt'] = fixture.now
        .subtract(const Duration(minutes: 5))
        .toIso8601String();
    await fixture.mount(tester);
    expect(find.byKey(const Key('gas-device-stale')), findsOneWidget);
    expect(find.byKey(const Key('gas-stale')), findsNothing);
    expect(find.textContaining('아래는 이전 수신 값입니다'), findsOneWidget);
    expect(_value(tester, 'co'), '151 raw');
    fixture.gas['lastSeenAt'] = fixture.now
        .subtract(const Duration(minutes: 4, seconds: 59))
        .toIso8601String();
    await _tap(tester, 'gas-refresh');
    expect(find.byKey(const Key('gas-device-stale')), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('요약 오래됨·갱신 중·갱신 실패는 S-01과 같이 이전 자료·수신 시각을 유지한다', (tester) async {
    final fixture = _Fixture();
    fixture.gateway.reply['fetchedAt'] = '2026-09-14T15:08:04.759Z';
    await fixture.mount(tester);
    expect(find.byKey(const Key('gas-stale')), findsOneWidget);
    final pending = Completer<SiteStatus>();
    fixture.gateway.fetch = () => pending.future;
    await _tap(tester, 'gas-refresh');
    expect(find.textContaining('갱신 중 · 수신 완료 전까지 이전 자료'), findsOneWidget);
    expect(_value(tester, 'co'), '151 raw');
    pending.completeError(const ApiFailure('private'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('gas-refresh-error')), findsOneWidget);
    expect(_value(tester, 'co'), '151 raw');
    fixture.gateway.fetch = null;
    fixture.gateway.reply['fetchedAt'] = fixture.now.toIso8601String();
    await _tap(tester, 'gas-refresh');
    expect(find.byKey(const Key('gas-refresh-error')), findsNothing);
    expect(find.byKey(const Key('gas-stale')), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('403이면 장비·수치를 제거하고 역할·현장 안내 후 자동·수동 재시도를 멈춘다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    fixture.gateway.fetch = () async =>
        throw const ApiFailure('private', status: 403);
    await _tap(tester, 'gas-refresh');
    expect(find.byKey(const Key('gas-forbidden')), findsOneWidget);
    expect(find.textContaining('관리자에게 역할과 현장 배정을'), findsOneWidget);
    expect(find.byKey(const Key('gas-refresh')), findsNothing);
    expect(find.byKey(const Key('gas-readings')), findsNothing);
    expect(
      find.textContaining('synthetic-gas-01', skipOffstage: false),
      findsNothing,
    );
    expect(find.text('151 raw', skipOffstage: false), findsNothing);
    final calls = fixture.gateway.calls;
    await tester.pump(const Duration(minutes: 10));
    await fixture.pumpScreen(tester, active: false);
    await fixture.pumpScreen(tester);
    expect(fixture.gateway.calls, calls);
    await _tap(tester, 'gas-back');
    expect(
      tester.widget<InkWell>(find.byKey(const Key('site-row-gas'))).onTap,
      isNull,
    );
    await fixture.close(tester);
  });

  testWidgets('가스 상세도 비활성·백그라운드에서 조회를 멈추고 복귀하면 새 스냅샷을 받는다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    await tester.pump(const Duration(minutes: 1));
    expect(fixture.gateway.calls, 2);
    await fixture.pumpScreen(tester, active: false);
    await tester.pump(const Duration(minutes: 2));
    expect(fixture.gateway.calls, 2);
    fixture.row('co')['value'] = 152;
    await fixture.pumpScreen(tester);
    expect(fixture.gateway.calls, 3);
    expect(_value(tester, 'co'), '152 raw');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump(const Duration(minutes: 2));
    expect(fixture.gateway.calls, 3);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(fixture.gateway.calls, 4);
    expect(find.text('가스 감지기 상세'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('V-5 한 패널 3종 머리행 72dp·T-1 새로고침 64dp·뒤로가기 56dp', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    expect(find.byKey(const Key('gas-readings')), findsOneWidget);
    final refresh = tester.getSize(find.byKey(const Key('gas-refresh')));
    expect(refresh.height, greaterThanOrEqualTo(64));
    expect(refresh.width, greaterThanOrEqualTo(56));
    final back = tester.getSize(find.byKey(const Key('gas-back')));
    expect(back.height, greaterThanOrEqualTo(56));
    expect(back.width, greaterThanOrEqualTo(56));
    for (final key in ['o2', 'co', 'h2s']) {
      await _scrollTo(tester, 'gas-header-$key');
      expect(tester.getSize(find.byKey(Key('gas-header-$key'))).height, 72);
    }
    expect(tester.takeException(), isNull);
    await fixture.close(tester);
  });

  for (final (size, scale) in [
    (const Size(866, 1385), 1.0),
    (const Size(1385, 866), 1.0),
    (const Size(600, 900), 3.0),
    (const Size(480, 700), 3.0),
  ]) {
    testWidgets(
      '창 ${size.width}×${size.height}·글자 $scale배에서 단위·위치까지 줄바꿈·스크롤한다',
      (tester) async {
        final fixture = _Fixture();
        await fixture.mount(tester, size: size, scale: scale);
        for (final key in ['o2', 'co', 'h2s']) {
          await _scrollTo(tester, 'gas-header-$key');
          if (scale > 1) {
            expect(
              tester.getSize(find.byKey(Key('gas-header-$key'))).height,
              greaterThan(72),
            );
          }
          await _scrollTo(tester, 'gas-value-$key');
          expect(
            find.byKey(Key('gas-value-$key')).hitTestable(),
            findsOneWidget,
          );
          await _scrollTo(tester, 'gas-location-$key');
          expect(
            find.byKey(Key('gas-location-$key')).hitTestable(),
            findsOneWidget,
          );
          expect(tester.takeException(), isNull);
          _expectNoPpm();
        }
        await fixture.close(tester);
      },
    );
  }
}

class _Gateway extends MockGateway {
  _Gateway({required this.mock});
  final bool mock;
  @override
  bool get isMock => mock;

  Map<String, dynamic> reply = gasStatusReply();
  Future<SiteStatus> Function()? fetch;
  int calls = 0;

  @override
  Future<SiteStatus> siteStatus(String accessToken) async {
    calls++;
    return fetch == null ? SiteStatus(reply) : await fetch!();
  }
}

class _Fixture {
  _Fixture({bool mock = true}) : gateway = _Gateway(mock: mock);
  final _Gateway gateway;
  late final controller = FieldCoordinator(
    gateway,
    MemoryStore(),
    MockSpeechInput(),
  );
  final now = DateTime.parse('2026-09-14T15:13:04.759Z');
  double scale = 1;
  Map get gas => gateway.reply['gas'] as Map;
  Map row(String key) => (gas['gases'] as List).cast<Map>().singleWhere(
    (row) => row['key'] == key,
  );

  Future<void> mount(
    WidgetTester tester, {
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
    await pumpScreen(tester);
    await tester.ensureVisible(find.byKey(const Key('site-row-gas')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('site-row-gas')));
    await tester.pump();
  }

  Future<void> pumpScreen(WidgetTester tester, {bool active = true}) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: Scaffold(
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
