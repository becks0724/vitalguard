import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/ink_stroke.dart';

const _operationId = 'cc3fe253-0b2e-47d9-83a2-76d83bf0c650';
Map<String, String> _fields(CalendarMedia photo) => {
  ...annotationFields(photo),
  'clientOperationId': _operationId,
};

final original = CalendarMedia({
  'id': '원본-photo-123',
  'date_key': '2026-09-13',
});

void main() {
  test('실제 업로드 경로는 multipart 안에 JSON MIME, v, annotationOf를 보낸다', () async {
    final client = _Client();
    final live = LiveGateway(client: client);
    final bytes = encodeInk([
      InkStroke(InkTool.pen, 0xff000000, 0.004, [
        [0.1, 0.2, 0.5],
      ]),
    ]);
    await live.upload('access-token', bytes, _fields(original));
    final request = client.requests.single;
    expect(client.urls.single.path, '/api/app-media');
    expect(request.followRedirects, isFalse);
    expect(
      request.headers.value(HttpHeaders.authorizationHeader),
      'Bearer access-token',
    );
    final type = ContentType.parse(
      request.headers.value(HttpHeaders.contentTypeHeader)!,
    );
    expect(type.mimeType, 'multipart/form-data');
    final boundary = type.parameters['boundary'];
    expect(boundary, isNotEmpty);
    final parts = utf8.decode(request.body.toBytes()).split('--$boundary');
    final fields = <String, String>{};
    var fileParts = 0;
    for (final part in parts.skip(1).take(parts.length - 2)) {
      final split = part.indexOf('\r\n\r\n');
      expect(split, greaterThanOrEqualTo(0));
      final disposition = part.substring(0, split);
      final name = RegExp('name="([^"]+)"').firstMatch(disposition)!.group(1)!;
      final body = part.substring(split + 4, part.length - 2);
      if (name == 'file') {
        fileParts++;
        expect(disposition, contains('filename="annotation.json"'));
        expect(disposition, contains('Content-Type: application/json'));
        expect(utf8.encode(body), bytes);
        expect(jsonDecode(body)['v'], 1);
      } else {
        fields[name] = body;
      }
    }
    expect(fileParts, 1);
    expect(fields, _fields(original));
    expect(fields['annotationOf'], original.id);
    expect(request.contentLength, request.body.length);
  });

  test('deduplicated:true 잉크 응답도 같은 작업의 완료 영수증이다', () async {
    final client = _Client()..deduplicated = true;
    final receipt = await LiveGateway(client: client)
        .upload('jwt', encodeInk([]), _fields(original));
    expect(receipt.deduplicated, isTrue);
    expect(receipt.clientOperationId, _operationId);
    expect(receipt.id, isNotEmpty);
  });

  test('작업 ID 없는 multipart는 HTTP 전에 차단한다', () async {
    final client = _Client();
    await expectLater(
      LiveGateway(client: client)
          .upload('jwt', encodeInk([]), annotationFields(original)),
      throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 400)),
    );
    expect(client.requests, isEmpty);
  });

  test('촬영 JPEG와 기존 PNG의 이미지 업로드 계약은 유지된다', () async {
    final client = _Client();
    final gateway = LiveGateway(client: client);
    for (final (bytes, mime, name) in [
      (Uint8List.fromList([0xff, 0xd8, 0xff, 0]), 'image/jpeg', 'capture.jpg'),
      (Uint8List.fromList([137, 80, 78, 71]), 'image/png', 'annotation.png'),
    ]) {
      await gateway.upload('token', bytes, {
        'dateKey': '2026-09-13',
        'clientOperationId': _operationId,
      });
      final body = latin1.decode(client.requests.last.body.toBytes());
      expect(body, contains('Content-Type: $mime\r\n'));
      expect(body, contains('filename="$name"'));
      expect(body, isNot(contains('annotationOf')));
    }
    expect(client.requests.length, 2);
  });

  test('2MB 초과 잉크는 HTTP 요청을 열기 전에 차단한다', () async {
    final client = _Client();
    await expectLater(
      LiveGateway(client: client)
          .upload('token', Uint8List(maxInkUploadBytes + 1), _fields(original)),
      throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 413)),
    );
    expect(client.requests, isEmpty);
  });

  test('서버 413은 재시도 가능한 초안 실패이고 응답 유실은 결과 불명이다', () async {
    final client = _Client()..status = 413;
    final gateway = LiveGateway(client: client);
    await expectLater(
      gateway.upload('token', encodeInk([]), _fields(original)),
      throwsA(
        isA<ApiFailure>()
            .having((e) => e.status, 'status', 413)
            .having((e) => e.uncertainWrite, 'uncertain', false),
      ),
    );
    client.failure = const HttpException('응답 유실');
    await expectLater(
      gateway.upload('token', encodeInk([]), _fields(original)),
      throwsA(
        isA<ApiFailure>().having((e) => e.uncertainWrite, 'uncertain', true),
      ),
    );
    expect(client.requests.length, 2);
  });

  test('모의 잉크 업로드는 원본 참조와 작업 ID를 보존하고 중복을 재사용한다', () async {
    final gateway = MockGateway();
    final photo = await gateway.upload('token', Uint8List.fromList([1]), {
      'dateKey': '2026-09-14',
    });
    final fields = {...annotationFields(photo), 'clientOperationId': 'ink-op'};
    final one = await gateway.upload('token', encodeInk([]), fields);
    final again = await gateway.upload('token', encodeInk([]), fields);
    expect(one.media_type, 'ink');
    expect(one.json['annotation_of'], photo.id);
    expect(again.id, one.id);
    expect(again.deduplicated, isTrue);
  });
}

class _Client implements HttpClient {
  final requests = <_Request>[];
  final urls = <Uri>[];
  int status = 200;
  bool deduplicated = false;
  Exception? failure;
  @override
  Future<HttpClientRequest> postUrl(Uri url) async {
    urls.add(url);
    final request = _Request(this);
    requests.add(request);
    return request;
  }

  @override
  void close({bool force = false}) {}
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
  Future<HttpClientResponse> close() async {
    if (client.failure != null) throw client.failure!;
    return _Response(client.status, {
      'ok': client.status == 200,
      'clientOperationId': _operationId,
      'deduplicated': client.deduplicated,
      'error': '크기 초과',
      'media': {
        'id': 'ink-${client.requests.length}',
        'date_key': '2026-09-13',
      },
    });
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Response extends Stream<List<int>> implements HttpClientResponse {
  _Response(this.statusCode, Map<String, dynamic> json)
    : body = utf8.encode(jsonEncode(json));
  final List<int> body;
  @override
  final int statusCode;
  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int>)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => Stream.value(body).listen(
    onData,
    onError: onError,
    onDone: onDone,
    cancelOnError: cancelOnError,
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
