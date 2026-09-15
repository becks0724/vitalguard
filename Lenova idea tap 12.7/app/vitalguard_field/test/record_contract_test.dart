import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';

MobileSession session(String token, {String role = 'site_manager'}) =>
    MobileSession({
      'ok': true,
      'accessToken': token,
      'refreshToken': 'refresh-$token',
      'accessExpiresInSec': 900,
      'refreshExpiresAt': '2099-01-01T00:00:00+09:00',
      'user': {'id': 'a', 'role': role, 'name': null, 'workerId': 'EMP-a'},
    });

class RoleGateway extends MockGateway {
  RoleGateway(this.role);
  final String role;

  @override
  Future<MobileSession> login(
    String id,
    String password, {
    String? totpCode,
  }) async => session('role-test', role: role);
}

class RefreshGateway extends MockGateway {
  int refreshCalls = 0, uploads = 0;
  final refreshed = Completer<MobileSession>();
  @override
  Future<MobileSession> login(
    String id,
    String password, {
    String? totpCode,
  }) async => session('old');
  @override
  Future<MobileSession> refresh(String refreshToken) {
    refreshCalls++;
    return refreshed.future;
  }

  void guard(String token) {
    if (token == 'old') {
      throw const ApiFailure('만료', status: 401, action: 'refresh');
    }
  }

  @override
  Future<List<CalendarMedia>> media(
    String token,
    String from,
    String to,
  ) async {
    guard(token);
    return [];
  }

  @override
  Future<List<CalendarEvent>> events(
    String token,
    String from,
    String to,
  ) async {
    guard(token);
    return [];
  }

  @override
  Future<List<CalendarLabel>> labels(String token) async {
    guard(token);
    return [];
  }

  @override
  Future<CalendarMedia> upload(
    String token,
    Uint8List png,
    Map<String, String> fields,
  ) async {
    uploads++;
    throw const ApiFailure('응답 유실', uncertainWrite: true);
  }
}

class LiveNoSiteGateway extends MockGateway {
  @override
  bool get isMock => false;

  @override
  Future<SiteInfo?> siteInfo(String accessToken) async => null;
}

void main() {
  test('admin 역할은 로그인 후 앱 진입을 허용한다', () async {
    final store = MemoryStore();
    final c = FieldCoordinator(RoleGateway('admin'), store, MockSpeechInput());
    addTearDown(c.dispose);

    await c.signIn('a', 'pw');

    expect(c.authStage, AuthStage.ready);
    expect(c.user?.role, 'admin');
    expect(c.site, isNotNull);
    expect(store.tokens, contains('role-test'));
  });

  test('worker 역할은 거부하고 계정·현장·저장 토큰을 남기지 않는다', () async {
    final store = MemoryStore()..tokens = 'previous-session';
    final c = FieldCoordinator(RoleGateway('worker'), store, MockSpeechInput());
    addTearDown(c.dispose);

    await c.signIn('a', 'pw');

    expect(c.authStage, AuthStage.denied);
    expect(c.user, isNull);
    expect(c.site, isNull);
    expect(store.tokens, isNull);
  });

  test('원본 날짜와 긴 ID를 보존하고 UTC 촬영시각은 KST로 보낸다', () {
    final id = List.filled(140, '원').join();
    final original = CalendarMedia({
      'id': id,
      'date_key': '2026-09-11',
      'captured_at': '2026-09-11T15:30:00Z',
      'uploader': '이전 담당관',
      'worker_id': 'OLD',
    });
    final fields = annotationFields(original);
    expect(fields['dateKey'], '2026-09-11');
    expect(fields['annotationOf'], id);
    expect(fields['title'], contains(id));
    expect(fields['capturedAt'], '2026-09-12T00:30:00.000+09:00');
    expect(fields.containsKey('uploader'), isFalse);
    expect(fields.containsKey('workerId'), isFalse);
  });

  test('실제 coord_gap_m 키를 보존하고 없는 coordGapM 필드를 만들지 않는다', () {
    final item = CalendarMedia({
      'id': 'one',
      'date_key': '2026-09-12',
      'coord_gap_m': 12,
      'coord_ref_accuracy_m': null,
      'comments': [],
    });
    expect(item.coord_gap_m, 12);
    expect(item.json.containsKey('coordGapM'), isFalse);
    expect(item.coord_ref_accuracy_m, isNull);
  });

  test('라이브 조회는 from/to만 보내며 미지원 현장·페이지 파라미터를 만들지 않는다', () async {
    String? path;
    final gateway = LiveGateway(
      transport: (method, route, token, body) async {
        path = route;
        return const ApiReply(200, {'ok': true, 'media': []});
      },
    );
    await gateway.media('token', '2026-09-01', '2026-09-30');
    expect(Uri.parse(path!).queryParameters, {
      'from': '2026-09-01',
      'to': '2026-09-30',
    });
    gateway.client.close();
  });

  test('동시에 만료된 조회 셋이 refresh 하나를 공유하고 비밀번호는 저장하지 않는다', () async {
    final gateway = RefreshGateway(), store = MemoryStore();
    final c = FieldCoordinator(gateway, store, MockSpeechInput());
    await c.signIn('a', 'not-stored-password');
    final work = c.loadPeriod('2026-09-01', '2026-09-30');
    await Future<void>.delayed(Duration.zero);
    expect(gateway.refreshCalls, 1);
    gateway.refreshed.complete(session('new'));
    await work;
    expect(c.authStage, AuthStage.ready);
    expect(c.fetchedAt, isNotNull);
    expect(store.tokens, isNot(contains('not-stored-password')));
    c.dispose();
  });

  test('업로드 결과 불명은 자동 재전송하지 않는다', () async {
    final gateway = RefreshGateway();
    final c = FieldCoordinator(gateway, MemoryStore(), MockSpeechInput());
    await c.signIn('a', 'pw');
    await expectLater(
      c.publish(Uint8List(0), {'dateKey': '2026-09-12'}),
      throwsA(isA<ApiFailure>().having((e) => e.uncertainWrite, '결과 불명', true)),
    );
    expect(gateway.uploads, 1);
    c.dispose();
  });

  test('계정별 기기 기록을 분리한다', () async {
    final store = MemoryStore();
    await store.write('a', 'same-photo', 'a의 초안');
    expect(await store.read('b', 'same-photo'), isNull);
    expect(await store.read('a', 'same-photo'), 'a의 초안');
  });

  testWidgets('라이브 로그인이 기록 화면까지 도달하고, 현장 정보가 없어도 이름을 지어내지 않는다', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(800, 600);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    final controller = FieldCoordinator(
      LiveNoSiteGateway(),
      MemoryStore(),
      MockSpeechInput(),
    );
    await controller.signIn('live-manager', 'mock');

    expect(controller.isMock, isFalse);
    expect(controller.authStage, AuthStage.ready);
    expect(controller.site, isNull);

    await tester.pumpWidget(
      MaterialApp(home: FieldShell(controller: controller)),
    );
    await tester.pumpAndSettle();

    // S-01 현장 요약이 첫 화면이다. 기록 탭으로 옮겨 도달을 확인한다.
    await tester.tap(find.byKey(const Key('rail-destination-2')));
    await tester.pumpAndSettle();

    expect(find.byType(RecordHome), findsOneWidget);
    expect(find.byKey(const Key('rail-collapsed')), findsOneWidget);
    // N-1: 접힌 레일의 Tooltip만으로 대신하지 않고 상단 바에 직접 표시한다.
    final siteName = find.text('현장 · 현장 정보 없음');
    expect(siteName, findsOneWidget);
    expect(siteName.hitTestable(), findsOneWidget);
    expect(
      tester.getRect(siteName).bottom,
      lessThanOrEqualTo(tester.getRect(find.byType(RecordHome)).top),
    );
    expect(find.text('모의 현장'), findsNothing);

    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });
}
