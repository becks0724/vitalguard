import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';

const _operationId = '1b4f4dd2-c580-42c1-8eab-299e23ec9868';
final _audio = Uint8List.fromList([0, 0, 0, 24, 102, 116, 121, 112, 0xff]);

void main() {
  test(
    '음성 multipart는 기존 경로·JWT·audio/mp4·commentOf·audioMs와 comment 응답을 사용한다',
    () async {
      final client = _Client();
      final comment = await LiveGateway(client: client).voiceComment(
        'jwt',
        'photo-123',
        _audio,
        durationMs: 7000,
        clientOperationId: _operationId,
      );
      final request = client.requests.single;
      expect(client.urls.single.path, '/api/app-media');
      expect(request.followRedirects, isFalse);
      expect(
        request.headers.value(HttpHeaders.authorizationHeader),
        'Bearer jwt',
      );
      final type = ContentType.parse(
        request.headers.value(HttpHeaders.contentTypeHeader)!,
      );
      expect(type.mimeType, 'multipart/form-data');
      final parts = latin1
          .decode(request.body.toBytes())
          .split('--${type.parameters['boundary']}');
      expect(
        parts,
        hasLength(6),
      ); // commentOf / audioMs / clientOperationId / file.
      expect(parts[1], contains('name="commentOf"\r\n\r\nphoto-123\r\n'));
      expect(parts[2], contains('name="audioMs"\r\n\r\n7000\r\n'));
      expect(
        parts[3],
        contains('name="clientOperationId"\r\n\r\n$_operationId\r\n'),
      );
      expect(parts[4], contains('filename="voice-comment.m4a"'));
      expect(parts[4], contains('Content-Type: audio/mp4\r\n\r\n'));
      final split = parts[4].indexOf('\r\n\r\n');
      expect(
        latin1.encode(parts[4].substring(split + 4, parts[4].length - 2)),
        _audio,
      );
      expect(request.contentLength, request.body.length);
      expect(comment.id, 'voice-1');
      expect(comment.media_id, 'photo-123');
      expect(comment.body, '');
      expect(comment.audio_ms, 7000);
    },
  );

  test('deduplicated:true 음성 응답은 실패가 아닌 완료다', () async {
    final client = _Client()..deduplicated = true;
    final receipt = await LiveGateway(
      client: client,
    ).voiceComment('jwt', 'photo-123', _audio, clientOperationId: _operationId);
    expect(receipt.deduplicated, isTrue);
    expect(receipt.clientOperationId, _operationId);
    expect(receipt.id, 'voice-1');
  });

  test('길이를 생략할 수 있고 10 MiB 초과·빈 원본·빈 녹음은 전송 전에 거절한다', () async {
    final client = _Client(), gateway = LiveGateway(client: _Client());
    await gateway.voiceComment(
      'jwt',
      'photo-123',
      Uint8List(maxVoiceBytes),
      clientOperationId: _operationId,
    );
    final live = LiveGateway(client: client);
    for (final entry in [
      (maxVoiceBytes + 1, 'photo-123', 413),
      (1, '', 400),
      (0, 'photo-123', 400),
    ]) {
      await expectLater(
        live.voiceComment('jwt', entry.$2, Uint8List(entry.$1)),
        throwsA(isA<ApiFailure>().having((e) => e.status, 'status', entry.$3)),
      );
    }
    expect(client.requests, isEmpty);
    await live.voiceComment(
      'jwt',
      'photo-123',
      _audio,
      clientOperationId: _operationId,
    );
    expect(
      latin1.decode(client.requests.single.body.toBytes()),
      isNot(contains('name="audioMs"')),
    );
  });

  for (final status in [400, 401, 403, 404, 413, 500]) {
    test('서버 $status의 사유·인증 동작과 결과 불명 여부를 유지한다', () async {
      final client = _Client()..status = status;
      await expectLater(
        LiveGateway(client: client).voiceComment(
          'jwt',
          'photo-123',
          _audio,
          clientOperationId: _operationId,
        ),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.status, 'status', status)
              .having((e) => e.message, '사유', '서버 사유')
              .having((e) => e.action, 'action', 'none')
              .having((e) => e.uncertainWrite, '결과 불명', status >= 500),
        ),
      );
      expect(client.requests, hasLength(1));
    });
  }

  test('연결 전 실패는 수동 재시도 가능하고 전송 후 응답 유실은 uncertain이다', () async {
    final client = _Client()
      ..openFailure = const SocketException('Network is unreachable');
    final gateway = LiveGateway(client: client);
    await expectLater(
      gateway.voiceComment(
        'jwt',
        'photo-123',
        _audio,
        clientOperationId: _operationId,
      ),
      throwsA(
        isA<ApiFailure>()
            .having((e) => e.uncertainWrite, '전송 전', false)
            .having((e) => e.message, '원인', contains('Network is unreachable')),
      ),
    );
    expect(client.requests, isEmpty);
    client.openFailure = null;
    client.closeFailure = const HttpException('Connection closed');
    await expectLater(
      gateway.voiceComment(
        'jwt',
        'photo-123',
        _audio,
        clientOperationId: _operationId,
      ),
      throwsA(
        isA<ApiFailure>()
            .having((e) => e.uncertainWrite, '전송 후', true)
            .having((e) => e.message, '원인', contains('Connection closed')),
      ),
    );
    expect(client.requests, hasLength(1));
  });

  test('성공 HTTP라도 응답 형식·댓글 원본이 맞지 않으면 재전송하지 않는다', () async {
    for (final body in [
      'not json',
      '{"ok":true,"media":{"id":"wrong"}}',
      '{"ok":true,"comment":{"id":"c","media_id":"other","body":""}}',
    ]) {
      final client = _Client()..body = body;
      await expectLater(
        LiveGateway(client: client).voiceComment(
          'jwt',
          'photo-123',
          _audio,
          clientOperationId: _operationId,
        ),
        throwsA(
          isA<ApiFailure>().having((e) => e.uncertainWrite, '결과 불명', true),
        ),
      );
      expect(client.requests, hasLength(1));
    }
  });

  test('모의 서버도 남의 사진에 음성 댓글을 허용하고 사진·글 댓글을 그대로 유지한다', () async {
    final gateway = MockGateway();
    await gateway.login('다른 담당자', 'mock');
    final photo = await gateway.upload('jwt', Uint8List.fromList([1]), {
      'dateKey': '2026-09-14',
    });
    final text = await gateway.addComment('jwt', photo.id, '기존 글 댓글');
    final voice = await gateway.voiceComment(
      'jwt',
      photo.id,
      _audio,
      durationMs: 7000,
      clientOperationId: _operationId,
    );
    expect(voice.author_id, '다른 담당자');
    expect(voice.body, '');
    expect(voice.audio_storage_key, isNotEmpty);
    expect(voice.media_id, photo.id);
    expect(voice.audio_ms, 7000);
    expect(text.body, '기존 글 댓글');
    expect(text.audio_storage_key, isNull);
    final again = await gateway.voiceComment(
      'jwt',
      photo.id,
      _audio,
      durationMs: 7000,
      clientOperationId: _operationId,
    );
    expect(again.id, voice.id);
    expect(again.deduplicated, isTrue);
    final ink = await gateway.upload(
      'jwt',
      Uint8List.fromList(utf8.encode('{"v":1}')),
      {'annotationOf': photo.id},
    );
    for (final entry in [('missing', 404), (ink.id, 400)]) {
      await expectLater(
        gateway.voiceComment('jwt', entry.$1, _audio),
        throwsA(isA<ApiFailure>().having((e) => e.status, 'status', entry.$2)),
      );
    }
  });

  test('음성 댓글도 coordinator의 명시적 401 갱신을 한 번만 거친다', () async {
    final gateway = _RefreshGateway();
    final controller = FieldCoordinator(
      gateway,
      MemoryStore(),
      MockSpeechInput(),
    );
    addTearDown(controller.dispose);
    await controller.signIn('a', 'mock');
    final comment = await controller.voiceComment(
      'mock-original-001',
      _audio,
      durationMs: 7000,
      clientOperationId: _operationId,
    );
    expect(gateway.calls, 2);
    expect(gateway.refreshes, 1);
    expect(comment.audio_ms, 7000);
  });
}

class _RefreshGateway extends MockGateway {
  int calls = 0, refreshes = 0;
  @override
  Future<MobileSession> refresh(String refreshToken) async {
    refreshes++;
    return super.refresh(refreshToken);
  }

  @override
  Future<MediaComment> voiceComment(
    String token,
    String mediaId,
    Uint8List audio, {
    int? durationMs,
    String? clientOperationId,
    String? siteId,
  }) async {
    if (++calls == 1) {
      throw const ApiFailure('만료', status: 401, action: 'refresh');
    }
    return super.voiceComment(
      token,
      mediaId,
      audio,
      durationMs: durationMs,
      clientOperationId: clientOperationId,
      siteId: siteId,
    );
  }
}

class _Client implements HttpClient {
  final urls = <Uri>[];
  final requests = <_Request>[];
  int status = 200;
  bool deduplicated = false;
  String? body;
  Exception? openFailure, closeFailure;
  @override
  Future<HttpClientRequest> postUrl(Uri url) async {
    if (openFailure != null) throw openFailure!;
    urls.add(url);
    final request = _Request(this);
    requests.add(request);
    return request;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Headers implements HttpHeaders {
  final _values = <String, String>{};
  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) =>
      _values[name.toLowerCase()] = value.toString();
  @override
  String? value(String name) => _values[name.toLowerCase()];
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Request implements HttpClientRequest {
  _Request(this.client);
  final _Client client;
  final body = BytesBuilder();
  @override
  final HttpHeaders headers = _Headers();
  @override
  bool followRedirects = true;
  @override
  int contentLength = -1;
  @override
  void add(List<int> data) => body.add(data);
  @override
  void abort([Object? exception, StackTrace? stackTrace]) {}
  @override
  Future<HttpClientResponse> close() async {
    if (client.closeFailure != null) throw client.closeFailure!;
    return _Response(
      client.status,
      client.body ??
          jsonEncode({
            'ok': client.status == 200,
            'clientOperationId': _operationId,
            'deduplicated': client.deduplicated,
            'error': '서버 사유',
            'action': 'none',
            'comment': {
              'id': 'voice-1',
              'media_id': 'photo-123',
              'body': '',
              'audio_storage_key': 'voice-1.m4a',
              'audio_url': 'https://example.invalid/voice-1.m4a',
              'audio_ms': 7000,
            },
          }),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Response extends Stream<List<int>> implements HttpClientResponse {
  _Response(this.statusCode, this.body);
  final String body;
  @override
  final int statusCode;
  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int>)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => Stream.value(utf8.encode(body)).listen(
    onData,
    onError: onError,
    onDone: onDone,
    cancelOnError: cancelOnError,
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
