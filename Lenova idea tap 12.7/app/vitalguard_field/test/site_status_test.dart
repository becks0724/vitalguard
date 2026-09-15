import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';

import 'support/site_status_fixture.dart';

void main() {
  test('현장 요약은 앱 JWT로 전용 GET을 호출하고 UTC 원문을 보존한다', () async {
    final gateway = LiveGateway(
      transport: (method, path, token, body) async {
        expect(method, 'GET');
        expect(path, '/api/app/admin/site-status');
        expect(token, 'synthetic-app-access');
        expect(body, isNull);
        return ApiReply(200, siteStatusReply());
      },
    );
    addTearDown(() => gateway.client.close(force: true));
    final result = await gateway.siteStatus('synthetic-app-access');
    expect(result.fetchedAt, '2026-09-14T15:13:04.759Z');
    expect(result.weather.ok, isTrue);
    expect(result.workers.normal, 0);
    expect(result.gas.level, 'normal');
    expect(result.aed.total, 0);
    expect(result.alerts.siteScoped, isFalse);
  });

  for (final status in [401, 403, 404, 429, 503]) {
    test('현장 요약 $status 상태를 보존하고 오류 원문을 제거한다', () async {
      final gateway = LiveGateway(
        transport: (_, _, _, _) async => ApiReply(status, {
          'ok': false,
          'error': 'synthetic-private-error',
          'action': status == 403 ? 'reauth' : 'refresh',
          'retryAfterSec': 12,
        }),
      );
      addTearDown(() => gateway.client.close(force: true));
      await expectLater(
        gateway.siteStatus('access'),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.status, 'status', status)
              .having((e) => e.message, 'safe message', '현장 요약을 받을 수 없습니다')
              .having((e) => e.code, 'raw code omitted', isNull)
              .having(
                (e) => e.action,
                'action',
                status == 403 ? 'none' : 'refresh',
              )
              .having((e) => e.retryAfterSec, 'retryAfterSec', 12),
        ),
      );
    });
  }

  test('깨진 UTC 수신 시각은 안전하게 거부한다', () async {
    for (final time in [
      null,
      'synthetic-private-error',
      '2026-09-14T15:13:04',
    ]) {
      final gateway = LiveGateway(
        transport: (_, _, _, _) async =>
            ApiReply(200, {...siteStatusReply(), 'fetchedAt': time}),
      );
      addTearDown(() => gateway.client.close(force: true));
      await expectLater(
        gateway.siteStatus('access'),
        throwsA(
          isA<ApiFailure>().having(
            (e) => e.message,
            'safe message',
            '현장 요약 응답 형식을 확인할 수 없습니다',
          ),
        ),
      );
    }
  });

  test('깨진 한 구성 요소만 실패하고 없는 수치를 0으로 보정하지 않는다', () {
    final result = SiteStatus({
      ...siteStatusReply(),
      'gas': {'ok': true, 'level': 'unknown', 'error': 'private'},
      'workers': {'ok': true, 'level': 'idle'},
      'aed': {'ok': true, 'level': 'normal', 'total': -1},
      'alerts': {'ok': true, 'unacked': null},
    });
    expect(result.gas.ok, isFalse);
    expect(result.gas.summary, isNull);
    expect(result.weather.ok, isTrue);
    expect(result.workers.ok, isTrue);
    expect(result.workers.normal, isNull);
    expect(result.aed.ok, isTrue);
    expect(result.aed.total, isNull);
    expect(result.alerts.unacked, isNull);
    expect(result.alerts.siteScoped, isNull);
  });

  test('현장 요약도 401에서 세션 갱신 후 새 앱 토큰을 쓴다', () async {
    final gateway = _Gateway();
    final controller = FieldCoordinator(
      gateway,
      MemoryStore(),
      MockSpeechInput(),
    );
    addTearDown(controller.dispose);
    await controller.signIn('demo', 'mock');
    final result = await controller.siteStatus();
    expect(gateway.refreshCalls, 1);
    expect(gateway.tokens, ['old-access', 'new-access']);
    expect(controller.siteStatusSnapshot, same(result));
    expect(controller.authStage, AuthStage.ready);
  });

  test('403은 요약 캐시를 지우고 세션을 재시도하지 않으며 계정 전환도 캐시를 지운다', () async {
    final gateway = _Gateway()..expired = false;
    final controller = FieldCoordinator(
      gateway,
      MemoryStore(),
      MockSpeechInput(),
    );
    addTearDown(controller.dispose);
    await controller.signIn('demo', 'mock');
    await controller.siteStatus();
    gateway.forbidden = true;
    await expectLater(controller.siteStatus(), throwsA(isA<ApiFailure>()));
    expect(controller.siteStatusSnapshot, isNull);
    expect(controller.siteStatusForbidden, isTrue);
    expect(gateway.refreshCalls, 0);
    expect(gateway.tokens.length, 2);
    expect(controller.authStage, AuthStage.ready);
    gateway.forbidden = false;
    await controller.siteStatus();
    await controller.signIn('next-account', 'mock');
    expect(controller.siteStatusSnapshot, isNull);
    expect(controller.siteStatusForbidden, isFalse);
  });
}

class _Gateway extends MockGateway {
  int refreshCalls = 0;
  bool expired = true, forbidden = false;
  final tokens = <String>[];

  MobileSession session(String token, {String id = 'demo'}) => MobileSession({
    'ok': true,
    'accessToken': token,
    'refreshToken': 'synthetic-refresh',
    'accessExpiresInSec': 900,
    'refreshExpiresAt': '2099-01-01T00:00:00Z',
    'user': {'id': id, 'role': 'site_manager'},
  });

  @override
  Future<MobileSession> login(
    String id,
    String password, {
    String? totpCode,
  }) async => session('old-access', id: id);

  @override
  Future<MobileSession> refresh(String refreshToken) async {
    refreshCalls++;
    return session('new-access');
  }

  @override
  Future<SiteStatus> siteStatus(String accessToken) async {
    tokens.add(accessToken);
    if (forbidden) throw const ApiFailure('private', status: 403);
    if (expired && accessToken == 'old-access') {
      throw const ApiFailure('private', status: 401, action: 'refresh');
    }
    return SiteStatus(siteStatusReply());
  }
}
