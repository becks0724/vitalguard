import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';

LiveGateway gatewayWith(JsonTransport transport) {
  final gateway = LiveGateway(transport: transport);
  addTearDown(() => gateway.client.close(force: true));
  return gateway;
}

void main() {
  test('GET은 앱 JWT·반복 파라미터를 쓰며 중복 응답과 특수문자 ID를 보존한다', () async {
    final gateway = gatewayWith((method, path, token, body) async {
      expect(method, 'GET');
      final uri = Uri.parse(path);
      expect(uri.path, '/api/app/admin/operation-status');
      expect(uri.queryParametersAll, {
        'clientOperationId': ['op+1&x=2', 'op-2', 'op+1&x=2'],
      });
      expect(token, 'synthetic-app-jwt');
      expect(body, isNull);
      return const ApiReply(200, {
        'ok': true,
        'operations': [
          {'clientOperationId': 'op+1&x=2', 'status': 'registered'},
          {'clientOperationId': 'op-2', 'status': 'not_registered'},
        ],
      });
    });
    final result = await gateway.lookupOperations('synthetic-app-jwt', [
      'op+1&x=2',
      'op-2',
      'op+1&x=2',
    ]);
    expect(result.keys, ['op+1&x=2', 'op-2']);
    expect(result['op+1&x=2']!.presence, OperationPresence.confirmed);
    expect(result['op-2']!.presence, OperationPresence.absent);
  });

  test('1~50개·1~128자 경계를 검사하고 중복 51개도 전송 전에 거절한다', () async {
    var calls = 0;
    final gateway = gatewayWith((_, path, _, _) async {
      calls++;
      final ids = Uri.parse(path).queryParametersAll['clientOperationId']!;
      return ApiReply(200, {
        'ok': true,
        'operations': [
          for (final id in ids.toSet())
            {'clientOperationId': id, 'status': 'registered'},
        ],
      });
    });
    await gateway.lookupOperations('jwt', ['a']);
    await gateway.lookupOperations('jwt', List.filled(50, 'a' * 128));
    expect(calls, 2);
    for (final ids in <List<String>>[
      [],
      [''],
      [' a'],
      ['a '],
      ['a\n'],
      ['a' * 129],
      List.filled(51, 'same'),
    ]) {
      await expectLater(
        gateway.lookupOperations('jwt', ids),
        throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 400)),
      );
    }
    expect(calls, 2);
  });

  for (final status in [400, 401, 403, 503]) {
    test('조회 $status는 미등록을 반환하지 않고 오류와 재로그인 의미를 보존한다', () async {
      final gateway = gatewayWith(
        (_, _, _, _) async => ApiReply(status, {
          'ok': false, 'error': 'synthetic-private-db-detail',
          // 장애 응답에 행이 있어도 성공으로 읽으면 안 된다.
          'operations': [
            {'clientOperationId': 'op-1', 'status': 'not_registered'},
          ],
        }),
      );
      await expectLater(
        gateway.lookupOperations('jwt', ['op-1']),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.status, 'status', status)
              .having(
                (e) => e.action,
                'action',
                status == 401 ? 'reauth' : null,
              )
              .having(
                (e) => e.message,
                'safe message',
                isNot(contains('private')),
              ),
        ),
      );
    });
  }

  for (final failure in <Object>[
    const SocketException('synthetic'),
    TimeoutException('synthetic'),
    const HttpException('synthetic'),
  ]) {
    test('조회 ${failure.runtimeType}는 빈 결과나 미등록으로 대체하지 않는다', () async {
      final gateway = gatewayWith((_, _, _, _) async => throw failure);
      await expectLater(
        gateway.lookupOperations('jwt', ['op-1']),
        throwsA(isA<ApiFailure>()),
      );
    });
  }

  test('누락·중복·다른 ID·알 수 없는 상태·잘못된 응답은 전체 조회 실패다', () async {
    for (final rows in <dynamic>[
      null,
      'invalid',
      [],
      [
        {'clientOperationId': 'op-1', 'status': 'registered'},
      ],
      [
        {'clientOperationId': 'op-1', 'status': 'registered'},
        {'clientOperationId': 'op-1', 'status': 'not_registered'},
      ],
      [
        {'clientOperationId': 'op-1', 'status': 'not_registered'},
        {'clientOperationId': 'other', 'status': 'registered'},
      ],
      [
        {'clientOperationId': 'op-1', 'status': 'not_registered'},
        {'clientOperationId': 'op-2', 'status': 'pending'},
      ],
      [null, null],
    ]) {
      final gateway = gatewayWith(
        (_, _, _, _) async => ApiReply(200, {'ok': true, 'operations': rows}),
      );
      await expectLater(
        gateway.lookupOperations('jwt', ['op-1', 'op-2']),
        throwsA(isA<ApiFailure>()),
      );
    }
  });
}
