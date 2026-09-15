import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';

Map<String, dynamic> ticketReply() => {
  'ok': true,
  'ticket': 'synthetic-ticket',
  'expiresAt': 1790000000000,
  'ttlSec': 60,
  'gateApi': 'https://camera.invalid:8443',
};

void main() {
  test('티켓 발급은 기존 앱 Bearer와 cameraId로 앱 전용 POST를 쓴다', () async {
    final gateway = LiveGateway(
      transport: (method, path, token, body) async {
        expect(method, 'POST');
        expect(path, '/api/app/admin/cctv-ticket');
        expect(token, 'synthetic-app-access');
        expect(body, {'cameraId': 'CAM-03'});
        return ApiReply(200, ticketReply());
      },
    );
    addTearDown(() => gateway.client.close(force: true));
    final result = await gateway.cctvTicket('synthetic-app-access', 'CAM-03');
    expect(result.ok, isTrue);
    expect(result.ticket, 'synthetic-ticket');
    expect(result.expiresAt, 1790000000000);
    expect(result.ttlSec, 60);
    expect(result.gateApi, 'https://camera.invalid:8443');
  });

  for (final status in [401, 403, 404, 429, 503]) {
    test('티켓 $status를 구분하고 응답의 비밀 문자열을 예외에서 제거한다', () async {
      final gateway = LiveGateway(
        transport: (_, _, _, _) async => ApiReply(status, {
          'ok': false,
          'error': 'synthetic-ticket',
          'action': 'none',
          'retryAfterSec': 12,
        }),
      );
      addTearDown(() => gateway.client.close(force: true));
      await expectLater(
        gateway.cctvTicket('synthetic-app-access', 'CAM-03'),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.status, 'status', status)
              .having((e) => e.code, '허용되지 않은 오류 코드는 전달하지 않는다', isNull)
              .having((e) => e.action, 'action', 'none')
              .having((e) => e.retryAfterSec, 'retryAfterSec', 12)
              .having(
                (e) => e.toString().contains('synthetic-ticket'),
                '비밀 유출',
                false,
              ),
        ),
      );
    });
  }

  test('빈 gateApi는 성공 응답으로 유지하고 잘못된 응답은 안전하게 거부한다', () async {
    Map<String, dynamic> reply = {...ticketReply(), 'gateApi': ''};
    final gateway = LiveGateway(
      transport: (_, _, _, _) async => ApiReply(200, reply),
    );
    addTearDown(() => gateway.client.close(force: true));
    expect((await gateway.cctvTicket('access', 'CAM-03')).gateApi, '');
    for (final changes in [
      {'ticket': null},
      {'ticket': 'synthetic-ticket\r\n'},
      {'expiresAt': 'synthetic-ticket'},
      {'ttlSec': 0},
      {'gateApi': null},
    ]) {
      reply = {...ticketReply(), ...changes};
      await expectLater(
        gateway.cctvTicket('access', 'CAM-03'),
        throwsA(
          isA<ApiFailure>().having(
            (e) => e.toString().contains('synthetic-ticket'),
            '비밀 유출',
            false,
          ),
        ),
      );
    }
  });

  test('CCTV도 기존 세션 갱신을 거쳐 새 앱 토큰으로 티켓을 발급한다', () async {
    final gateway = _RefreshGateway();
    final store = MemoryStore();
    final controller = FieldCoordinator(gateway, store, MockSpeechInput());
    addTearDown(controller.dispose);
    await controller.signIn('demo', 'mock');
    final ticket = await controller.cctvTicket('CAM-03');
    expect(gateway.refreshCalls, 1);
    expect(gateway.tokens, ['old-access', 'new-access']);
    expect(ticket.ok, isTrue);
    expect(controller.authStage, AuthStage.ready);
    expect(store.tokens?.contains('synthetic-ticket'), isFalse);
  });
}

class _RefreshGateway extends MockGateway {
  int refreshCalls = 0;
  final tokens = <String>[];

  MobileSession session(String token) => MobileSession({
    'ok': true,
    'accessToken': token,
    'refreshToken': 'synthetic-refresh',
    'accessExpiresInSec': 900,
    'refreshExpiresAt': '2099-01-01T00:00:00Z',
    'user': {'id': 'demo', 'role': 'site_manager'},
  });

  @override
  Future<MobileSession> login(
    String id,
    String password, {
    String? totpCode,
  }) async => session('old-access');

  @override
  Future<MobileSession> refresh(String refreshToken) async {
    refreshCalls++;
    return session('new-access');
  }

  @override
  Future<CctvTicket> cctvTicket(String accessToken, String cameraId) async {
    tokens.add(accessToken);
    if (accessToken == 'old-access') {
      throw const ApiFailure('만료', status: 401, action: 'refresh');
    }
    return CctvTicket(ticketReply());
  }
}
