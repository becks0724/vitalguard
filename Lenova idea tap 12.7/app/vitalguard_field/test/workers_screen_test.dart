import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/site/site_screen.dart';
import 'package:vitalguard_field/ui/site/workers_screen.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/workers_fixture.dart';

Future<void> _scrollTo(WidgetTester tester, String key) async {
  await tester.scrollUntilVisible(
    find.byKey(Key(key)),
    240,
    scrollable: find
        .descendant(
          of: find.byKey(const Key('workers-list-scroll')),
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

void main() {
  testWidgets('S-01 작업자 행은 기존 수신 자료로 S-02에 진입하고 버튼·시스템 뒤로가기가 돌아온다', (
    tester,
  ) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    expect(fixture.gateway.calls, 1, reason: '진입 시 별도 작업자 요청을 만들지 않는다');
    expect(find.byType(WorkersScreen), findsOneWidget);
    expect(find.text('작업자 목록'), findsOneWidget);
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.text('작업자 수신 정보'), findsNothing);
    await _tap(tester, 'workers-back');
    expect(find.text('현장 요약'), findsOneWidget);
    await tester.tap(find.byKey(const Key('site-row-workers')));
    await tester.pump();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('현장 요약'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('작업자 심박·SpO₂·위치 정확도는 정수, 체온은 소수 1자리이며 서버 상태를 유지한다', (
    tester,
  ) async {
    final fixture = _Fixture();
    final row = <String, dynamic>{
      ...workerReply('w-1', tone: 'danger'),
      'heartRate': 78.6,
      'spo2': 94.5,
      'skinTempC': 34,
      'coreTempC': 37.96,
      'locationAccuracyMeters': 8.6,
    };
    fixture.gateway.reply = workersStatusReply(items: [row]);
    await fixture.mount(tester);
    await _scrollTo(tester, 'worker-location-w-1');
    for (final text in [
      '심박 79 bpm',
      '산소포화도 95 %',
      '피부체온 34.0 °C',
      '심부체온 추정 38.0 °C',
    ]) {
      expect(find.text(text), findsOneWidget);
    }
    expect(find.textContaining('위치 정확도 9 m'), findsOneWidget);
    expect(find.textContaining('37.501234'), findsOneWidget);
    expect(find.textContaining('SOS 요청', findRichText: true), findsOneWidget);
    final item = fixture.controller.siteStatusSnapshot!.workers.items.single;
    expect(item.heartRate, 78.6);
    expect(item.spo2, 94.5);
    expect(item.skinTempC, 34);
    expect(item.coreTempC, 37.96);
    expect(item.locationAccuracyMeters, 8.6);
    expect(item.tone, 'danger');
    expect(item.label, 'SOS 요청');
    expect(row['coreTempC'], 37.96);
    await fixture.close(tester);
  });

  for (final redacted in [true, false]) {
    testWidgets('PII $redacted 문구를 명시하고 보호자 이름·전화·자리를 표시하지 않는다', (
      tester,
    ) async {
      final fixture = _Fixture();
      fixture.gateway.reply = workersStatusReply(
        piiRedacted: redacted,
        items: [
          {
            ...workerReply('w-1'),
            // 서버에는 없는 키가 실려도 화면 모델에 포함하지 않는 회귀 방어.
            'guardianName': '합성보호자', 'guardianPhone': '010-0000-9999',
            'lastAccurateLat': 38.999999, 'lastAccurateLon': 128.999999,
          },
        ],
      );
      await fixture.mount(tester);
      expect(
        find.text(
          redacted
              ? '위치 가림 · 개인정보 보호 설정에 따라 서버가 위치를 가렸습니다.'
              : '위치 표시 허용 · 수신된 좌표를 표시합니다.',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining(redacted ? '위치 표시 허용' : '서버가 위치를 가렸습니다'),
        findsNothing,
      );
      await _scrollTo(tester, 'worker-location-w-1');
      expect(
        find.textContaining('37.501234'),
        redacted ? findsNothing : findsOneWidget,
      );
      expect(
        find.textContaining('127.012345'),
        redacted ? findsNothing : findsOneWidget,
      );
      for (final text in [
        '보호자',
        '전화',
        '합성보호자',
        '010-0000-9999',
        '38.999999',
        '128.999999',
      ]) {
        expect(find.textContaining(text, findRichText: true), findsNothing);
      }
      expect(
        find.textContaining('위치 정확도 8 m'),
        redacted ? findsNothing : findsOneWidget,
      );
      await fixture.close(tester);
    });
  }

  testWidgets('위치 미수신과 가림 여부 누락은 가림·기능 미지원으로 단정하지 않는다', (tester) async {
    final fixture = _Fixture();
    fixture.gateway.reply = workersStatusReply(
      items: [
        {...workerReply('w-1'), 'latitude': null},
      ],
    );
    await fixture.mount(tester);
    await _scrollTo(tester, 'worker-location-w-1');
    expect(find.text('위치 데이터 없음 · 서버에서 좌표를 받지 못했습니다.'), findsOneWidget);
    expect(find.textContaining('위치 가림'), findsNothing);
    fixture.gateway.reply = workersStatusReply(piiRedacted: null);
    await _tap(tester, 'workers-refresh');
    expect(find.textContaining('개인정보 가림 여부를 받지 못했습니다'), findsOneWidget);
    await _scrollTo(tester, 'worker-location-w-1');
    expect(find.textContaining('37.501234'), findsNothing);
    expect(find.textContaining('위치 기능 없음'), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('PII 허용에서 가림으로 갱신되면 기존 좌표도 즉시 사라진다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    await _scrollTo(tester, 'worker-location-w-1');
    expect(find.textContaining('37.501234'), findsOneWidget);
    fixture.gateway.reply = workersStatusReply(piiRedacted: true);
    await _tap(tester, 'workers-refresh');
    await _scrollTo(tester, 'worker-location-w-1');
    expect(find.textContaining('37.501234', skipOffstage: false), findsNothing);
    expect(find.textContaining('위치 가림'), findsNWidgets(2));
    await fixture.close(tester);
  });

  testWidgets('작업자 0명·대기 0명은 목록·집계 데이터 없음과 다르다', (tester) async {
    final fixture = _Fixture();
    fixture.gateway.reply = workersStatusReply(items: []);
    await fixture.mount(tester);
    expect(find.text('작업자 0명 · 수신한 목록이 비어 있습니다'), findsOneWidget);
    expect(find.text('대기 0명'), findsOneWidget);
    fixture.workers.remove('items');
    fixture.workers.remove('waiting');
    await _tap(tester, 'workers-refresh');
    expect(find.text('작업자 데이터 없음 · 개별 목록을 받지 못했습니다'), findsOneWidget);
    expect(find.text('대기 데이터 없음'), findsOneWidget);
    expect(find.text('작업자 0명 · 수신한 목록이 비어 있습니다'), findsNothing);
    expect(find.text('대기 0명'), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('집계가 양수인데 빈 목록이거나 식별 실패만 있으면 0명이라 쓰지 않는다', (tester) async {
    final fixture = _Fixture();
    fixture.workers['items'] = <Object>[];
    await fixture.mount(tester);
    expect(find.textContaining('집계 인원에 해당하는 개별 목록이 비어 있습니다'), findsOneWidget);
    expect(find.textContaining('작업자 0명'), findsNothing);
    fixture.workers['items'] = [null];
    await _tap(tester, 'workers-refresh');
    expect(find.textContaining('식별 정보가 없거나 중복된 작업자 1건'), findsOneWidget);
    expect(find.textContaining('작업자 데이터 확인 불가'), findsOneWidget);
    expect(find.textContaining('작업자 0명'), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('정상·주의·위험·대기·끊김·전체 필터가 서버 상태를 따르고 끊긴 위험을 강등하지 않는다', (
    tester,
  ) async {
    final fixture = _Fixture();
    fixture.gateway.reply = workersStatusReply(
      items: [
        workerReply('normal'),
        workerReply('caution', tone: 'caution'),
        workerReply('danger', tone: 'danger'),
        workerReply('idle', tone: 'idle'),
        workerReply('stale', tone: 'danger', stale: true),
      ],
    );
    await fixture.mount(tester);
    expect(find.text('서버 집계 기준 · 끊김은 주의·위험과 겹칠 수 있습니다.'), findsOneWidget);
    for (final (filter, ids) in [
      ('normal', ['normal']),
      ('caution', ['caution']),
      ('danger', ['danger', 'stale']),
      ('idle', ['idle']),
      ('stale', ['stale']),
      ('all', ['normal', 'caution', 'danger', 'idle', 'stale']),
    ]) {
      await _tap(tester, 'workers-filter-$filter');
      expect(find.text('수신 목록 필터 결과 ${ids.length}명'), findsOneWidget);
      for (final id in ids) {
        await _scrollTo(tester, 'worker-header-$id');
        expect(find.byKey(Key('worker-header-$id')), findsOneWidget);
      }
    }
    await fixture.close(tester);
  });

  testWidgets('필터 결과 0명은 전체 0명과 다르고 갱신 중 선택을 보존한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    await _tap(tester, 'workers-filter-danger');
    expect(find.text('수신 목록 필터 결과 0명'), findsOneWidget);
    expect(find.text('수신한 목록에 선택한 상태의 작업자가 없습니다'), findsOneWidget);
    expect(find.textContaining('작업자 0명'), findsNothing);
    fixture.gateway.reply = workersStatusReply(
      items: [workerReply('danger', tone: 'danger')],
    );
    await _tap(tester, 'workers-refresh');
    expect(find.text('✓ 위험 1명'), findsOneWidget);
    expect(find.text('수신 목록 필터 결과 1명'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('끊김 사유·측정 시각을 표시하고 남아 있는 심부체온도 현재값으로 표시하지 않는다', (tester) async {
    final fixture = _Fixture();
    fixture.gateway.reply = workersStatusReply(
      items: [workerReply('stale', tone: 'danger', stale: true)],
    );
    await fixture.mount(tester);
    await _scrollTo(tester, 'worker-location-stale');
    expect(find.text('연결 끊김 · 생체값은 현재값으로 표시하지 않습니다'), findsOneWidget);
    expect(find.text('장기 미수신'), findsOneWidget);
    expect(find.text('마지막 측정 2026-09-15 00:12:44 KST'), findsOneWidget);
    expect(find.textContaining('36.8'), findsNothing);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is Semantics && widget.properties.label == '위험 · 끊김',
      ),
      findsOneWidget,
    );
    await fixture.close(tester);
  });

  testWidgets('수치·좌표 0과 미착용을 데이터 없음으로 바꾸지 않는다', (tester) async {
    final fixture = _Fixture();
    fixture.gateway.reply = workersStatusReply(
      items: [
        {
          ...workerReply('zero'),
          'heartRate': 0,
          'spo2': null,
          'worn': false,
          'latitude': 0,
          'longitude': 0,
          'locationAccuracyMeters': 0,
          'ageSec': 0,
        },
      ],
    );
    await fixture.mount(tester);
    await _scrollTo(tester, 'worker-location-zero');
    expect(find.text('심박 0 bpm'), findsOneWidget);
    expect(find.text('산소포화도 데이터 없음'), findsOneWidget);
    expect(find.text('미착용'), findsOneWidget);
    expect(find.textContaining('위도 0 · 경도 0'), findsOneWidget);
    expect(find.textContaining('위치 정확도 0 m'), findsOneWidget);
    expect(find.text('수신 당시 0초 경과'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('workers 부분 실패는 목록에서 알리고 복귀한 기상·가스·AED는 유지한다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    fixture.gateway.reply['workers'] = {
      'ok': false,
      'error': 'synthetic-private-error',
    };
    await _tap(tester, 'workers-refresh');
    expect(find.byKey(const Key('workers-section-error')), findsOneWidget);
    expect(find.byKey(const Key('workers-refresh-error')), findsNothing);
    expect(find.byKey(const Key('worker-card-w-1')), findsNothing);
    expect(find.textContaining('synthetic-private-error'), findsNothing);
    await _tap(tester, 'workers-back');
    for (final text in ['기상 특보 0건', '가스 경보 0건', '장비 0대']) {
      expect(find.textContaining(text, findRichText: true), findsOneWidget);
    }
    await fixture.close(tester);
  });

  testWidgets('최초 미수신·수신 실패는 0명을 만들지 않는다', (tester) async {
    final fixture = _Fixture();
    final pending = Completer<SiteStatus>();
    fixture.gateway.fetch = () => pending.future;
    await fixture.mount(tester);
    expect(find.text('작업자 데이터 없음 · 목록을 아직 받지 못했습니다'), findsOneWidget);
    expect(find.textContaining('마지막 수신 없음'), findsOneWidget);
    pending.completeError(const ApiFailure('private'));
    await tester.pump();
    expect(find.textContaining('수신 실패 · 연결 상태'), findsOneWidget);
    expect(find.textContaining('작업자 0명'), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('작업자 행 수신 시각으로 오래됨을 알리고 갱신 중·실패에도 이전 자료를 유지한다', (tester) async {
    final fixture = _Fixture();
    fixture.workers['fetchedAt'] = '2026-09-14T15:08:04.759Z';
    await fixture.mount(tester);
    expect(find.byKey(const Key('workers-stale')), findsOneWidget);
    expect(find.text('마지막 수신 2026-09-15 00:08:04 KST'), findsOneWidget);
    final pending = Completer<SiteStatus>();
    fixture.gateway.fetch = () => pending.future;
    await _tap(tester, 'workers-refresh');
    expect(find.textContaining('갱신 중 · 수신 완료 전까지'), findsOneWidget);
    pending.completeError(const ApiFailure('private'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('workers-refresh-error')), findsOneWidget);
    await _scrollTo(tester, 'worker-header-w-1');
    expect(find.byKey(const Key('worker-header-w-1')), findsOneWidget);
    fixture.gateway.fetch = null;
    fixture.workers['fetchedAt'] = fixture.now.toIso8601String();
    await _tap(tester, 'workers-refresh');
    expect(find.byKey(const Key('workers-stale')), findsNothing);
    expect(find.byKey(const Key('workers-refresh-error')), findsNothing);
    await fixture.close(tester);
  });

  testWidgets('403은 목록·좌표를 지우고 역할·배정 안내 후 자동·수동 재시도를 멈춘다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    fixture.gateway.fetch = () async =>
        throw const ApiFailure('private', status: 403);
    await _tap(tester, 'workers-refresh');
    expect(find.textContaining('관리자에게 역할과 현장 배정을'), findsOneWidget);
    expect(find.byKey(const Key('workers-forbidden')), findsOneWidget);
    expect(find.byKey(const Key('workers-refresh')), findsNothing);
    expect(find.byKey(const Key('worker-card-w-1')), findsNothing);
    expect(find.textContaining('37.501234', skipOffstage: false), findsNothing);
    final calls = fixture.gateway.calls;
    await tester.pump(const Duration(minutes: 10));
    await fixture.pumpScreen(tester, active: false);
    await fixture.pumpScreen(tester);
    expect(fixture.gateway.calls, calls);
    await _tap(tester, 'workers-back');
    expect(
      tester.widget<InkWell>(find.byKey(const Key('site-row-workers'))).onTap,
      isNull,
    );
    await fixture.close(tester);
  });

  testWidgets('목록 자동 갱신도 비활성 탭·백그라운드에서 멈추고 복귀하면 다시 받는다', (tester) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    await tester.pump(const Duration(minutes: 1));
    expect(fixture.gateway.calls, 2);
    await fixture.pumpScreen(tester, active: false);
    await tester.pump(const Duration(minutes: 2));
    expect(fixture.gateway.calls, 2);
    await fixture.pumpScreen(tester);
    expect(fixture.gateway.calls, 3);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump(const Duration(minutes: 2));
    expect(fixture.gateway.calls, 3);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(fixture.gateway.calls, 4);
    expect(find.text('작업자 목록'), findsOneWidget);
    await fixture.close(tester);
  });

  testWidgets('V-5 작업자 카드 머리행 72dp·T-1 새로고침 64dp·뒤로가기와 모든 필터 56dp', (
    tester,
  ) async {
    final fixture = _Fixture();
    await fixture.mount(tester);
    expect(
      tester.getSize(find.byKey(const Key('workers-refresh'))).height,
      greaterThanOrEqualTo(64),
    );
    expect(
      tester.getSize(find.byKey(const Key('workers-back'))).height,
      greaterThanOrEqualTo(56),
    );
    for (final filter in [
      'all',
      'normal',
      'caution',
      'danger',
      'idle',
      'stale',
    ]) {
      final size = tester.getSize(find.byKey(Key('workers-filter-$filter')));
      expect(size.height, greaterThanOrEqualTo(56));
      expect(size.width, greaterThanOrEqualTo(56));
    }
    await _scrollTo(tester, 'worker-header-w-1');
    expect(
      tester.getSize(find.byKey(const Key('worker-header-w-1'))).height,
      72,
    );
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
      '창 ${size.width}×${size.height}·글자 $scale배에서 줄바꿈·스크롤로 좌표까지 읽는다',
      (tester) async {
        final fixture = _Fixture();
        await fixture.mount(tester, size: size, scale: scale);
        await _scrollTo(tester, 'worker-header-w-1');
        if (scale > 1) {
          expect(
            tester.getSize(find.byKey(const Key('worker-header-w-1'))).height,
            greaterThan(72),
          );
        }
        await _scrollTo(tester, 'worker-location-w-1');
        expect(
          find.byKey(const Key('worker-location-w-1')).hitTestable(),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
        await fixture.close(tester);
      },
    );
  }
}

class _Gateway extends MockGateway {
  Map<String, dynamic> reply = workersStatusReply();
  Future<SiteStatus> Function()? fetch;
  int calls = 0;

  @override
  Future<SiteStatus> siteStatus(String accessToken) async {
    calls++;
    return fetch == null ? SiteStatus(reply) : await fetch!();
  }
}

class _Fixture {
  final gateway = _Gateway();
  late final controller = FieldCoordinator(
    gateway,
    MemoryStore(),
    MockSpeechInput(),
  );
  final now = DateTime.parse('2026-09-14T15:13:04.759Z');
  double scale = 1;
  Map get workers => gateway.reply['workers'] as Map;

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
    await tester.ensureVisible(find.byKey(const Key('site-row-workers')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('site-row-workers')));
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
