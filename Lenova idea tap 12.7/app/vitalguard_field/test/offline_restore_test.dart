import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';

const _me = '/api/mobile/v1/session/me';
const _refresh = '/api/mobile/v1/session/refresh';
const _future = '2099-01-01T00:00:00Z';
const _past = '2000-01-01T00:00:00Z';
const _restoreFailure = '저장된 로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요. 기기 기록은 보존됩니다.';
const _expiredFailure = '저장된 로그인의 유효 기간이 지났습니다. 다시 로그인해 주세요. 기기 기록은 보존됩니다.';
const _savedUser = {
  'id': 'saved-account',
  'role': 'site_manager',
  'name': '저장된 담당관',
};
const _onlineUser = {
  'id': 'saved-account',
  'role': 'site_manager',
  'name': '서버에서 갱신한 담당관',
};
const _site = {
  'id': 123,
  'site_id': 'assigned-site',
  'site_name': '저장된 현장',
  'company_name': '시공사',
};

MobileSession _session({
  String refreshExpiresAt = _future,
  Map<String, dynamic> user = _savedUser,
}) => MobileSession({
  'ok': true,
  'accessToken': 'synthetic-access',
  'refreshToken': 'synthetic-refresh',
  'accessExpiresInSec': 900,
  'refreshExpiresAt': refreshExpiresAt,
  'user': user,
});

MemoryStore _store({
  String refreshExpiresAt = _future,
  bool expiredAccess = false,
  Map<String, dynamic> user = _savedUser,
}) => MemoryStore()
  ..tokens = jsonEncode({
    'session': _session(refreshExpiresAt: refreshExpiresAt, user: user).json,
    'localAccessExpiresAt': DateTime.parse(expiredAccess ? _past : _future)
        .toIso8601String(),
  });

FieldCoordinator _controller(MemoryStore store, JsonTransport transport) {
  final gateway = LiveGateway(transport: transport);
  final controller = FieldCoordinator(gateway, store, MockSpeechInput());
  addTearDown(() => gateway.client.close(force: true));
  addTearDown(controller.dispose);
  return controller;
}

ApiReply _success(String path, {Map<String, dynamic>? site = _site}) {
  return switch (Uri.parse(path).path) {
    _me => const ApiReply(200, {'ok': true, 'user': _onlineUser}),
    _refresh ||
    '/api/mobile/v1/session/login' => ApiReply(200, _session().json),
    '/api/mobile/v1/session/logout' => const ApiReply(200, {'ok': true}),
    '/api/admin/site-info' => ApiReply(200, {'ok': true, 'siteInfo': site}),
    '/api/app/address' => const ApiReply(200, {'ok': true, 'display': '현장 주소'}),
    _ => throw StateError('예상하지 않은 경로: $path'),
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('저장 토큰 + me SocketException은 사용자와 계정별 현장 캐시를 복원한다', () async {
    final store = _store();
    final tokens = store.tokens;
    await store.write(_savedUser['id']!, 'site:info', jsonEncode(_site));
    await store.write('other-account', 'site:info', '{"site_id":"other-site"}');
    final calls = <String>[];
    final controller = _controller(store, (_, path, _, _) async {
      calls.add(path);
      throw const SocketException('synthetic');
    });

    await controller.initialize();

    expect(calls, [_me]);
    expect(controller.authStage, AuthStage.ready);
    expect(controller.offline, isTrue);
    expect(controller.user?.json, _savedUser);
    expect(controller.site?.json, _site);
    expect(controller.site?.site_id, 'assigned-site');
    expect(controller.message, isNull);
    expect(store.tokens, tokens);
  });

  for (final (label, failure) in <(String, Object)>[
    ('status 없음', const ApiFailure('synthetic')),
    ('503', const ApiReply(503, {'ok': false, 'error': 'synthetic'})),
    ('형식 오류', const FormatException('synthetic')),
    ('잘못된 me 본문', const ApiReply(200, {'ok': true, 'user': null})),
    ('타임아웃', TimeoutException('synthetic')),
  ]) {
    test('me $label도 유효한 저장 세션으로 오프라인 진입한다', () async {
      final controller = _controller(_store(), (_, _, _, _) async {
        if (failure is ApiReply) return failure;
        throw failure;
      });

      await controller.initialize();

      expect(controller.authStage, AuthStage.ready);
      expect(controller.offline, isTrue);
      expect(controller.user?.json, _savedUser);
      expect(controller.message, isNull);
    });
  }

  for (final (status, action) in <(int, String?)>[
    (401, null),
    (403, null),
    (403, 'reauth'),
    (503, 'reauth'),
  ]) {
    test('me $status / $action은 캐시로 우회하지 않고 기존 문구로 로그인한다', () async {
      final store = _store();
      await store.write(_savedUser['id']!, 'site:info', jsonEncode(_site));
      final controller = _controller(store, (_, path, _, _) async {
        if (path == _me) {
          return ApiReply(status, {
            'ok': false,
            'error': 'synthetic',
            'action': action,
          });
        }
        return _success(path);
      });

      await controller.initialize();

      expect(controller.authStage, AuthStage.login);
      expect(controller.user, isNull);
      expect(controller.site, isNull);
      expect(controller.message, _restoreFailure);
    });
  }

  test('refresh 유효 기간이 지난 저장 세션은 연결 실패 시 만료 문구로 로그인한다', () async {
    final store = _store(refreshExpiresAt: _past);
    final controller = _controller(
      store,
      (_, _, _, _) async => throw const SocketException('synthetic'),
    );

    await controller.initialize();

    expect(controller.authStage, AuthStage.login);
    expect(controller.user, isNull);
    expect(controller.site, isNull);
    expect(controller.message, _expiredFailure);
    expect(store.tokens, isNotNull);
  });

  test('토큰 번들이 없으면 서버 호출 없이 로그인한다', () async {
    var calls = 0;
    final controller = _controller(MemoryStore(), (_, _, _, _) async {
      calls++;
      throw const SocketException('synthetic');
    });

    await controller.initialize();

    expect(controller.authStage, AuthStage.login);
    expect(controller.user, isNull);
    expect(controller.message, isNull);
    expect(calls, 0);
  });

  test('저장된 refresh 만료 시각을 읽을 수 없으면 오프라인 진입하지 않는다', () async {
    final controller = _controller(
      _store(refreshExpiresAt: 'synthetic-invalid-date'),
      (_, _, _, _) async => throw const SocketException('synthetic'),
    );

    await controller.initialize();

    expect(controller.authStage, AuthStage.login);
    expect(controller.user, isNull);
    expect(controller.message, _restoreFailure);
  });

  test('me 성공 후 현장 조회 연결 실패도 저장 사용자와 현장 캐시를 복원한다', () async {
    final store = _store();
    await store.write(_savedUser['id']!, 'site:info', jsonEncode(_site));
    final controller = _controller(store, (_, path, _, _) async {
      if (path == _me) return _success(path);
      throw const SocketException('synthetic');
    });

    await controller.initialize();

    expect(controller.authStage, AuthStage.ready);
    expect(controller.offline, isTrue);
    expect(controller.user?.json, _savedUser);
    expect(controller.site?.json, _site);
    expect(controller.message, isNull);
  });

  test('액세스 만료 후 refresh 연결 실패도 토큰을 보존하고 오프라인 진입한다', () async {
    final store = _store(expiredAccess: true);
    final tokens = store.tokens;
    await store.write(_savedUser['id']!, 'site:info', jsonEncode(_site));
    var online = false;
    final calls = <String>[];
    final controller = _controller(store, (_, path, _, _) async {
      calls.add(Uri.parse(path).path);
      if (!online) throw const SocketException('synthetic');
      return _success(path);
    });

    await controller.initialize();

    expect(calls, [_refresh]);
    expect(controller.authStage, AuthStage.ready);
    expect(controller.offline, isTrue);
    expect(controller.user?.json, _savedUser);
    expect(controller.site?.json, _site);
    expect(controller.message, isNull);
    expect(store.tokens, tokens);

    online = true;
    await controller.captureAddress(latitude: 37, longitude: 127);
    await Future<void>.delayed(Duration.zero);
    expect(calls, [
      _refresh,
      _refresh,
      '/api/app/address',
      _me,
      '/api/admin/site-info',
    ]);
    expect(controller.offline, isFalse);
    expect(controller.user?.json, _onlineUser);
  });

  test('허용되지 않은 저장 역할은 서버 연결 전에 denied로 거부한다', () async {
    final store = _store(user: {..._savedUser, 'role': 'worker'});
    var calls = 0;
    final controller = _controller(store, (_, _, _, _) async {
      calls++;
      throw const SocketException('synthetic');
    });

    await controller.initialize();

    expect(controller.authStage, AuthStage.denied);
    expect(controller.user, isNull);
    expect(controller.site, isNull);
    expect(store.tokens, isNull);
    expect(calls, 0);
  });

  for (final cached in [null, 'null', 'synthetic-invalid-json', '[]']) {
    test('현장 캐시 $cached는 null로 복원하며 다른 계정 캐시는 읽지 않는다', () async {
      final store = _store();
      await store.write('other-account', 'site:info', jsonEncode(_site));
      if (cached != null) {
        await store.write(_savedUser['id']!, 'site:info', cached);
      }
      final controller = _controller(
        store,
        (_, _, _, _) async => throw const SocketException('synthetic'),
      );

      await controller.initialize();

      expect(controller.authStage, AuthStage.ready);
      expect(controller.offline, isTrue);
      expect(controller.site, isNull);
      expect(controller.message, isNull);
    });
  }

  for (final signingIn in [false, true]) {
    for (final site in [_site, null]) {
      test('${signingIn ? '로그인' : '온라인 복원'} siteInfo $site 성공을 캐시한다', () async {
        final store = _store();
        await store.write(_savedUser['id']!, 'site:info', '{"site_id":"old"}');
        final controller = _controller(
          store,
          (_, path, _, _) async => _success(path, site: site),
        );
        if (signingIn) {
          await controller.signIn('synthetic-id', 'synthetic-password');
        } else {
          await controller.initialize();
        }

        expect(controller.authStage, AuthStage.ready);
        expect(controller.offline, isFalse);
        expect(controller.site?.json, site);
        expect(
          await store.read(_savedUser['id']!, 'site:info'),
          jsonEncode(site),
        );
        expect(await store.read('other-account', 'site:info'), isNull);

        final restored = _controller(
          store,
          (_, _, _, _) async => throw const SocketException('synthetic'),
        );
        await restored.initialize();
        expect(restored.authStage, AuthStage.ready);
        expect(restored.offline, isTrue);
        expect(restored.site?.json, site);
      });
    }
  }

  test('캐시 없이 오프라인 진입 후 첫 온라인 성공은 siteInfo와 캐시를 갱신한다', () async {
    final store = _store();
    var online = false;
    var siteCalls = 0;
    final controller = _controller(store, (_, path, _, _) async {
      if (Uri.parse(path).path == '/api/admin/site-info') siteCalls++;
      if (!online) throw const SocketException('synthetic');
      return _success(path);
    });
    await controller.initialize();

    expect(controller.authStage, AuthStage.ready);
    expect(controller.offline, isTrue);
    expect(controller.site, isNull);
    expect(siteCalls, 0);
    expect(await store.read(_savedUser['id']!, 'site:info'), isNull);

    online = true;
    await controller.captureAddress(latitude: 37, longitude: 127);
    await Future<void>.delayed(Duration.zero);

    expect(siteCalls, 1);
    expect(controller.authStage, AuthStage.ready);
    expect(controller.offline, isFalse);
    expect(controller.user?.json, _onlineUser);
    expect(controller.site?.json, _site);
    expect(await store.read(_savedUser['id']!, 'site:info'), jsonEncode(_site));
  });

  for (final retry in [false, true]) {
    test('온라인 ${retry ? '401 재시도' : '동시 요청'} 성공은 me를 1회 비차단 재확인한다', () async {
      var online = false;
      var meCalls = 0, addressCalls = 0;
      final pending = Completer<ApiReply>();
      final controller = _controller(_store(), (_, path, _, _) async {
        if (path == _me) {
          meCalls++;
          if (!online) throw const SocketException('synthetic');
          return pending.future;
        }
        if (Uri.parse(path).path == '/api/app/address') {
          addressCalls++;
          if (retry && addressCalls == 1) {
            return const ApiReply(401, {'ok': false, 'action': 'refresh'});
          }
        }
        return _success(path);
      });
      await controller.initialize();
      online = true;

      if (retry) {
        expect(
          await controller.captureAddress(latitude: 37, longitude: 127),
          '현장 주소',
        );
      } else {
        expect(
          await Future.wait(
            List.generate(
              3,
              (_) => controller.captureAddress(latitude: 37, longitude: 127),
            ),
          ),
          ['현장 주소', '현장 주소', '현장 주소'],
        );
      }
      await controller.captureAddress(latitude: 37, longitude: 127);

      expect(meCalls, 2);
      expect(pending.isCompleted, isFalse);
      expect(addressCalls, retry ? 3 : 4);
      expect(controller.offline, isFalse);
      expect(controller.user?.json, _savedUser);

      pending.complete(_success(_me));
      await Future<void>.delayed(Duration.zero);
      expect(controller.authStage, AuthStage.ready);
      expect(controller.offline, isFalse);
      expect(controller.user?.json, _onlineUser);
      expect(controller.message, isNull);

      await controller.captureAddress(latitude: 37, longitude: 127);
      expect(meCalls, 2);
    });
  }

  for (final reply in [
    ApiReply(200, {
      'ok': true,
      'user': {..._savedUser, 'role': 'worker'},
    }),
    const ApiReply(401, {'ok': false}),
    const ApiReply(403, {'ok': false}),
    const ApiReply(403, {'ok': false, 'action': 'reauth'}),
  ]) {
    test('온라인 재확인에서 ${reply.body} 거부 시 기존 재로그인 흐름으로 잠근다', () async {
      var meCalls = 0, locks = 0;
      final pending = Completer<ApiReply>();
      final store = _store();
      final controller = _controller(store, (_, path, _, _) async {
        if (path == _me) {
          if (++meCalls == 1) throw const SocketException('synthetic');
          return pending.future;
        }
        return _success(path);
      });
      controller.beforeLock = () async {
        locks++;
      };
      await controller.initialize();
      await controller.captureAddress(latitude: 37, longitude: 127);

      pending.complete(reply);
      await Future<void>.delayed(Duration.zero);

      expect(meCalls, 2);
      expect(locks, 1);
      expect(controller.authStage, AuthStage.reauthenticate);
      expect(controller.user, isNull);
      expect(controller.site, isNull);
      expect(store.tokens, isNull);
    });
  }

  test('백그라운드 재확인의 연결 실패는 진행 중인 요청이나 저장 세션을 막지 않는다', () async {
    var meCalls = 0;
    final store = _store();
    final controller = _controller(store, (_, path, _, _) async {
      if (path == _me) {
        meCalls++;
        throw const SocketException('synthetic');
      }
      return _success(path);
    });
    await controller.initialize();

    await controller.captureAddress(latitude: 37, longitude: 127);
    await Future<void>.delayed(Duration.zero);

    expect(meCalls, 2);
    expect(controller.authStage, AuthStage.ready);
    expect(controller.user?.json, _savedUser);
    expect(
      await controller.captureAddress(latitude: 37, longitude: 127),
      '현장 주소',
    );
    expect(controller.message, isNull);
    expect(store.tokens, isNotNull);
    await controller.captureAddress(latitude: 37, longitude: 127);
    expect(meCalls, 2);
  });

  test('로그아웃 뒤 도착한 백그라운드 me는 사용자나 토큰을 복원하지 않는다', () async {
    var meCalls = 0;
    final pending = Completer<ApiReply>();
    final store = _store();
    final controller = _controller(store, (_, path, _, _) async {
      if (path == _me) {
        if (++meCalls == 1) throw const SocketException('synthetic');
        return pending.future;
      }
      return _success(path);
    });
    await controller.initialize();
    await controller.captureAddress(latitude: 37, longitude: 127);
    await controller.signOut();

    pending.complete(_success(_me));
    await Future<void>.delayed(Duration.zero);

    expect(controller.authStage, AuthStage.login);
    expect(controller.user, isNull);
    expect(store.tokens, isNull);
  });
}
