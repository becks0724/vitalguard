import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';

LiveGateway _gatewayWithReply(ApiReply reply) {
  final gateway = LiveGateway(transport: (_, _, _, _) async => reply);
  addTearDown(() => gateway.client.close(force: true));
  return gateway;
}

void main() {
  for (final (code, status, message) in [
    ('invalid_credentials', 401, '아이디 또는 비밀번호가 올바르지 않습니다'),
    ('not_approved', 403, '승인 대기 중인 계정입니다. 관리자에게 문의해 주세요'),
    ('too_many_attempts', 429, '로그인 시도가 많습니다. 다시 시도해 주세요'),
    ('invalid_request', 400, '아이디와 비밀번호를 입력해 주세요'),
    ('app_auth_not_configured', 503, '서버 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요'),
  ]) {
    test('로그인 $code는 지정한 한국어 문구로 표시한다', () async {
      final gateway = _gatewayWithReply(
        ApiReply(status, {'ok': false, 'error': code}),
      );

      await expectLater(
        gateway.login('demo', 'synthetic-password'),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.message, 'message', message)
              .having((e) => e.toString(), '화면에 표시되는 예외', message)
              .having((e) => e.status, 'status', status)
              .having((e) => e.retryAfterSec, 'retryAfterSec', isNull)
              .having((e) => e.uncertainWrite, 'uncertainWrite', status >= 500),
        ),
      );
    });
  }

  for (final seconds in [0, 1, 37]) {
    test('로그인 잠금은 서버의 retryAfterSec=$seconds를 문구와 상태에 보존한다', () async {
      final gateway = _gatewayWithReply(
        ApiReply(429, {
          'ok': false,
          'error': 'too_many_attempts',
          'retryAfterSec': seconds,
        }),
      );

      await expectLater(
        gateway.login('demo', 'synthetic-password'),
        throwsA(
          isA<ApiFailure>()
              .having(
                (e) => e.message,
                'message',
                '로그인 시도가 많습니다. $seconds초 후 다시 시도해 주세요',
              )
              .having((e) => e.retryAfterSec, 'retryAfterSec', seconds)
              .having((e) => e.status, 'status', 429),
        ),
      );
    });
  }

  for (final code in ['unknown_login_error', 'Unexpected server error', '']) {
    test('모르는 로그인 오류 "$code"는 노출하지 않고 인증 상태 정보를 보존한다', () async {
      final gateway = _gatewayWithReply(
        ApiReply(503, {
          'ok': false,
          'error': code,
          'action': 'reauth',
          'retryAfterSec': 15,
          'twoFactorRequired': true,
        }),
      );

      await expectLater(
        gateway.login('demo', 'synthetic-password'),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.message, 'message', '로그인하지 못했습니다')
              .having((e) => e.toString(), '화면에 표시되는 예외', '로그인하지 못했습니다')
              .having((e) => e.status, 'status', 503)
              .having((e) => e.action, 'action', 'reauth')
              .having((e) => e.retryAfterSec, 'retryAfterSec', 15)
              .having((e) => e.twoFactorRequired, 'twoFactorRequired', isTrue)
              .having((e) => e.uncertainWrite, 'uncertainWrite', isTrue),
        ),
      );
    });
  }

  for (final message in [
    '인증 앱의 6자리 코드를 입력하세요.',
    '코드가 일치하지 않습니다. 다시 확인해주세요.',
    '이미 사용한 코드입니다. 다음 코드를 기다려주세요.',
  ]) {
    test('서버 TOTP 한국어 문구를 그대로 표시한다: $message', () async {
      final gateway = _gatewayWithReply(
        ApiReply(401, {
          'ok': false,
          'error': message,
          'twoFactorRequired': true,
        }),
      );

      await expectLater(
        gateway.login('demo', 'synthetic-password', totpCode: '123456'),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.message, 'message', message)
              .having((e) => e.status, 'status', 401)
              .having((e) => e.twoFactorRequired, 'twoFactorRequired', isTrue),
        ),
      );
    });
  }

  for (final (failure, message) in [
    (const SocketException('synthetic-network-error'), '서버에 연결할 수 없습니다'),
    (TimeoutException('synthetic-timeout'), '서버 응답을 기다리는 시간이 지났습니다'),
    (const HttpException('synthetic-http-error'), '응답 수신이 중단됐습니다'),
  ]) {
    test('로그인의 기존 한국어 통신 오류는 유지한다: $message', () async {
      final gateway = LiveGateway(
        transport: (_, _, _, _) async => throw failure,
      );
      addTearDown(() => gateway.client.close(force: true));

      await expectLater(
        gateway.login('demo', 'synthetic-password'),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.message, 'message', message)
              .having((e) => e.status, 'status', isNull)
              .having((e) => e.uncertainWrite, 'uncertainWrite', isTrue),
        ),
      );
    });
  }

  for (final message in [
    'invalid_credentials',
    'unknown_api_error',
    '잉크본에는 annotationOf(원본 ID)가 필요합니다',
  ]) {
    test('로그인 이외 경로에서는 기존 서버 오류를 그대로 전달한다: $message', () async {
      final gateway = _gatewayWithReply(
        ApiReply(400, {'ok': false, 'error': message}),
      );

      await expectLater(
        gateway.refresh('synthetic-refresh-token'),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.message, 'message', message)
              .having((e) => e.status, 'status', 400),
        ),
      );
    });
  }
}
