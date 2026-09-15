import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';
import 'dart:typed_data';

import '../contracts/field_contracts.dart';

class ApiReply {
  const ApiReply(this.status, this.body);
  final int status;
  final Map<String, dynamic> body;
}

typedef JsonTransport = Future<ApiReply> Function(
  String method,
  String path,
  String? token,
  Map<String, dynamic>? body,
);

class LiveGateway
    implements FieldGateway, CaptureAddressGateway, OperationLookupGateway {
  LiveGateway({Uri? base, HttpClient? client, this.transport})
    : base =
          base ??
          Uri.parse(
            'https://vitalguard-dashboard-569797426568.asia-northeast3.run.app',
          ),
      client = client ?? HttpClient();
  final Uri base;
  final HttpClient client;
  final JsonTransport? transport;
  @override
  bool get isMock => false;

  @override
  Future<Map<String, OperationCheck>> lookupOperations(
    String token,
    List<String> clientOperationIds,
  ) async {
    // 중복을 제거하기 전에 50개 상한을 검사한다. ID를 trim해서 바꾸지 않는다.
    if (clientOperationIds.isEmpty ||
        clientOperationIds.length > operationLookupBatchSize ||
        clientOperationIds.any(
          (id) => id.isEmpty || id.length > 128 || id.trim() != id,
        )) {
      throw const ApiFailure(
        '작업 ID는 앞뒤 공백 없는 1~128자, 요청당 1~50개여야 합니다',
        status: 400,
      );
    }
    final ids = clientOperationIds.toSet();
    final path = Uri(
      path: '/api/app/admin/operation-status',
      queryParameters: {'clientOperationId': clientOperationIds},
    ).toString();
    try {
      final data = await _json('GET', path, token: token);
      final rows = data['operations'];
      if (rows is! List || rows.length != ids.length) {
        throw const FormatException('작업 조회 응답 누락');
      }
      final results = <String, OperationCheck>{};
      for (final row in rows) {
        if (row is! Map || row['clientOperationId'] is! String) {
          throw const FormatException('작업 조회 응답 형식');
        }
        final id = row['clientOperationId'] as String;
        if (!ids.contains(id) || results.containsKey(id)) {
          throw const FormatException('작업 조회 ID 불일치');
        }
        results[id] = OperationCheck(switch (row['status']) {
          'registered' => OperationPresence.confirmed,
          'not_registered' => OperationPresence.absent,
          _ => throw const FormatException('알 수 없는 작업 상태'),
        });
      }
      return results;
    } on ApiFailure catch (error) {
      // HTTP 오류를 빈 목록/미등록으로 바꾸지 않는다. 401은 기존 재로그인 경로로 보낸다.
      throw ApiFailure(
        switch (error.status) {
          401 => '로그인이 만료되었습니다. 다시 로그인해 주세요',
          403 => '서버 상태를 조회할 권한이 없습니다',
          400 => '작업 ID 조회 요청이 올바르지 않습니다',
          503 => '서버 DB 장애로 작업 상태를 조회하지 못했습니다',
          _ => '연결 또는 서버 응답을 확인하지 못했습니다',
        },
        status: error.status,
        action: error.status == 401 ? 'reauth' : null,
      );
    } on FormatException {
      throw const ApiFailure('서버 작업 상태 응답을 확인하지 못했습니다');
    }
  }

  Future<Map<String, dynamic>> _json(
    String method,
    String path, {
    String? token,
    Map<String, dynamic>? body,
  }) async {
    try {
      final ApiReply reply;
      if (transport != null) {
        reply = await transport!(method, path, token, body);
      } else {
        final request = await client
            .openUrl(method, base.resolve(path))
            .timeout(const Duration(seconds: 20));
        request.followRedirects = false;
        request.headers.set(HttpHeaders.acceptHeader, 'application/json');
        if (token != null) {
          request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
        }
        if (body != null) {
          request.headers.contentType = ContentType.json;
          request.write(jsonEncode(body));
        }
        final response = await request.close().timeout(
          const Duration(seconds: 30),
        );
        final text = await utf8.decoder
            .bind(response)
            .join()
            .timeout(const Duration(seconds: 30));
        Map<String, dynamic> data;
        try {
          data = Map<String, dynamic>.from(jsonDecode(text) as Map);
        } catch (_) {
          throw ApiFailure(
            '서버 응답 형식을 확인할 수 없습니다',
            status: response.statusCode,
            uncertainWrite: method != 'GET',
          );
        }
        reply = ApiReply(response.statusCode, data);
      }
      if (reply.status < 200 ||
          reply.status >= 300 ||
          reply.body['ok'] != true) {
        throw ApiFailure(
          reply.body['error']?.toString() ?? '요청이 완료되지 않았습니다',
          status: reply.status,
          code:
              reply.body['ok'] == false &&
                  reply.body['error'] == 'unknown camera'
              ? 'unknown camera'
              : null,
          action: reply.body['action'] as String?,
          retryAfterSec: (reply.body['retryAfterSec'] as num?)?.toInt(),
          twoFactorRequired: reply.body['twoFactorRequired'] == true,
          uncertainWrite: method != 'GET' && reply.status >= 500,
        );
      }
      return reply.body;
    } on SocketException {
      throw ApiFailure(
        '서버에 연결할 수 없습니다',
        uncertainWrite: method != 'GET',
        networkUnreachable: true,
      );
    } on TimeoutException {
      throw ApiFailure(
        '서버 응답을 기다리는 시간이 지났습니다',
        uncertainWrite: method != 'GET',
      );
    } on HttpException {
      throw ApiFailure('응답 수신이 중단됐습니다', uncertainWrite: method != 'GET');
    }
  }

  @override
  Future<MobileSession> login(
    String id,
    String password, {
    String? totpCode,
  }) async {
    try {
      return MobileSession(
        await _json(
          'POST',
          '/api/mobile/v1/session/login',
          body: {
            'id': id,
            'password': password,
            'totpCode': ?totpCode,
            'platform': 'android',
            'deviceName': 'VitAlGuard 현장 태블릿',
          },
        ),
      );
    } on ApiFailure catch (error) {
      // 서버의 TOTP 안내와 기존 통신 오류 등 이미 한국어인 문구는 그대로 둔다.
      if (RegExp(r'[가-힣]').hasMatch(error.message)) rethrow;

      final message = switch (error.message) {
        // 아이디 부재와 비밀번호 오류를 나누면 계정 존재 여부가 노출되어
        // 계정 열거 공격이 가능하므로 서버의 통합 오류를 유지한다.
        'invalid_credentials' => '아이디 또는 비밀번호가 올바르지 않습니다',
        'not_approved' => '승인 대기 중인 계정입니다. 관리자에게 문의해 주세요',
        'too_many_attempts' =>
          error.retryAfterSec == null
              ? '로그인 시도가 많습니다. 다시 시도해 주세요'
              : '로그인 시도가 많습니다. ${error.retryAfterSec}초 후 다시 시도해 주세요',
        'invalid_request' => '아이디와 비밀번호를 입력해 주세요',
        'app_auth_not_configured' => '서버 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요',
        _ => null,
      };
      if (message == null) {
        // 알 수 없는 코드는 진단 로그에만 남기고 화면에는 노출하지 않는다.
        developer.log(
          'Unknown login error code: ${error.message}',
          name: 'vitalguard_field.login',
        );
      }
      throw ApiFailure(
        message ?? '로그인하지 못했습니다',
        status: error.status,
        action: error.action,
        retryAfterSec: error.retryAfterSec,
        twoFactorRequired: error.twoFactorRequired,
        uncertainWrite: error.uncertainWrite,
      );
    }
  }

  @override
  Future<MobileSession> refresh(String refreshToken) async => MobileSession(
    await _json(
      'POST',
      '/api/mobile/v1/session/refresh',
      body: {'refreshToken': refreshToken},
    ),
  );
  @override
  Future<AppUser> me(String accessToken) async => AppUser(
    Map<String, dynamic>.from(
      (await _json(
            'GET',
            '/api/mobile/v1/session/me',
            token: accessToken,
          ))['user']
          as Map,
    ),
  );
  @override
  Future<void> logout(String accessToken) async {
    await _json('POST', '/api/mobile/v1/session/logout', token: accessToken);
  }

  @override
  Future<CctvTicket> cctvTicket(String accessToken, String cameraId) async {
    try {
      return CctvTicket(
        await _json(
          'POST',
          '/api/app/admin/cctv-ticket',
          token: accessToken,
          body: {'cameraId': cameraId},
        ),
      );
    } on ApiFailure catch (error) {
      // 상태/인증 동작은 보존하되 티켓이 섞일 수 있는 서버 문구는 넘기지 않는다.
      throw ApiFailure(
        'CCTV 이용 정보를 받을 수 없습니다',
        status: error.status,
        code: error.code == 'unknown camera' ? error.code : null,
        action: const {'refresh', 'reauth', 'none'}.contains(error.action)
            ? error.action
            : null,
        retryAfterSec: error.retryAfterSec,
      );
    } catch (_) {
      throw const ApiFailure('CCTV 티켓 응답 형식이 올바르지 않습니다');
    }
  }

  @override
  Future<SiteStatus> siteStatus(String accessToken) async {
    try {
      return SiteStatus(
        await _json('GET', '/api/app/admin/site-status', token: accessToken),
      );
    } on ApiFailure catch (error) {
      throw ApiFailure(
        '현장 요약을 받을 수 없습니다',
        status: error.status,
        // 403은 세션 갱신이 아니라 역할·현장 범위 거부다.
        action: error.status == 403
            ? 'none'
            : const {'refresh', 'reauth', 'none'}.contains(error.action)
            ? error.action
            : null,
        retryAfterSec: error.retryAfterSec,
      );
    } catch (_) {
      throw const ApiFailure('현장 요약 응답 형식을 확인할 수 없습니다');
    }
  }

  @override
  Future<bool> ackAlert(String accessToken, String id) async {
    if (id.trim().isEmpty) {
      throw const ApiFailure('경보 ID를 확인해 주세요', status: 400);
    }
    try {
      final reply = await _json(
        'POST',
        '/api/app/admin/alerts/ack',
        token: accessToken,
        // 한 경보만 확인한다. workerId/type과 섞거나 폴백하지 않는다.
        body: {'id': id},
      );
      if (reply['acked'] is! bool) {
        throw const ApiFailure('대응 확인 결과 불명', uncertainWrite: true);
      }
      return reply['acked'] as bool;
    } on ApiFailure catch (error) {
      final rejected =
          error.status != null && error.status! >= 400 && error.status! < 500;
      throw ApiFailure(
        '대응 확인 요청을 완료하지 못했습니다',
        status: error.status,
        action: error.status == 403 ? 'none' : error.action,
        uncertainWrite: error.uncertainWrite || !rejected,
      );
    } catch (_) {
      throw const ApiFailure('대응 확인 결과 불명', uncertainWrite: true);
    }
  }

  @override
  Future<SiteInfo?> siteInfo(String accessToken) async {
    final value = (await _json(
      'GET',
      '/api/admin/site-info',
      token: accessToken,
    ))['siteInfo'];
    return value is Map ? SiteInfo(Map<String, dynamic>.from(value)) : null;
  }

  @override
  Future<String?> captureAddress(
    String token, {
    required double latitude,
    required double longitude,
  }) async {
    final path = Uri(
      path: '/api/app/address',
      queryParameters: {
        'lat': latitude.toStringAsFixed(6),
        'lon': longitude.toStringAsFixed(6),
      },
    ).toString();
    final value = (await _json('GET', path, token: token))['display'];
    return value is String && value.trim().isNotEmpty ? value.trim() : null;
  }

  String _range(String path, String from, String to) =>
      Uri(path: path, queryParameters: {'from': from, 'to': to}).toString();

  @override
  Future<List<CalendarMedia>> media(
    String token,
    String from,
    String to,
  ) async =>
      ((await _json(
                'GET',
                _range('/api/calendar/media', from, to),
                token: token,
              ))['media']
              as List)
          .map((e) => CalendarMedia(Map<String, dynamic>.from(e as Map)))
          .toList();
  @override
  Future<List<CalendarEvent>> events(
    String token,
    String from,
    String to,
  ) async =>
      ((await _json(
                'GET',
                _range('/api/calendar/events', from, to),
                token: token,
              ))['events']
              as List)
          .map((e) => CalendarEvent(Map<String, dynamic>.from(e as Map)))
          .toList();
  @override
  Future<List<CalendarLabel>> labels(String token) async =>
      ((await _json('GET', '/api/calendar/labels', token: token))['labels']
              as List)
          .map((e) => CalendarLabel(Map<String, dynamic>.from(e as Map)))
          .toList();

  @override
  Future<Uint8List> image(String url) async {
    final uri = Uri.parse(url);
    if (uri.scheme != 'https' || uri.userInfo.isNotEmpty) {
      throw const ApiFailure('허용되지 않는 사진 주소입니다');
    }
    try {
      // 프리사인 스토리지 요청에 앱 Bearer 토큰을 보내지 않는다.
      final request = await client
          .getUrl(uri)
          .timeout(const Duration(seconds: 20));
      final response = await request.close().timeout(
        const Duration(seconds: 30),
      );
      if (response.statusCode != 200) {
        await response.drain<void>();
        throw ApiFailure(
          '사진을 받을 수 없습니다. 목록을 갱신해 주세요',
          status: response.statusCode,
        );
      }
      final bytes = await response
          .fold<BytesBuilder>(BytesBuilder(), (b, chunk) => b..add(chunk))
          .timeout(const Duration(seconds: 30));
      return bytes.takeBytes();
    } on SocketException {
      throw const ApiFailure('사진 서버에 연결할 수 없습니다');
    } on TimeoutException {
      throw const ApiFailure('사진 수신이 지연되고 있습니다');
    }
  }

  @override
  Future<CalendarMedia> upload(
    String token,
    Uint8List bytes,
    Map<String, String> fields,
  ) async {
    // 원본 연결 필드가 있는 주석 업로드는 잉크 JSON이다. 촬영 JPEG 계약은 유지한다.
    final ink = fields.containsKey('annotationOf');
    final sizeError = ink ? inkUploadSizeError(bytes.lengthInBytes) : null;
    if (sizeError != null) throw ApiFailure(sizeError, status: 413);
    final jpeg =
        bytes.length >= 3 &&
        bytes[0] == 0xff &&
        bytes[1] == 0xd8 &&
        bytes[2] == 0xff;
    final fileName = ink
        ? 'annotation.json'
        : jpeg
        ? 'capture.jpg'
        : 'annotation.png';
    final contentType = ink
        ? 'application/json'
        : jpeg
        ? 'image/jpeg'
        : 'image/png';
    final json = await _multipart(token, bytes, fields, fileName, contentType);
    try {
      final row = Map<String, dynamic>.from(json['media'] as Map);
      if (row['id'] is! String ||
          (row['id'] as String).isEmpty ||
          row['date_key'] is! String) {
        throw const FormatException();
      }
      return CalendarMedia(
        row,
        clientOperationId: json['clientOperationId'] as String?,
        deduplicated: json['deduplicated'] == true,
      );
    } catch (_) {
      throw const ApiFailure('업로드 응답의 기록 ID를 확인할 수 없습니다', uncertainWrite: true);
    }
  }

  // 이미지·잉크·음성 모두 기존 app-media multipart 전송을 공유한다.
  Future<Map<String, dynamic>> _multipart(
    String token,
    Uint8List bytes,
    Map<String, String> fields,
    String fileName,
    String contentType, {
    bool voice = false,
  }) async {
    if (fields['clientOperationId']?.isNotEmpty != true) {
      throw const ApiFailure('영속 보관된 작업 ID가 필요합니다', status: 400);
    }
    final boundary = 'vg-${DateTime.now().microsecondsSinceEpoch}';
    var submitted = false;
    HttpClientRequest? pendingRequest;
    try {
      final request = await client
          .postUrl(base.resolve('/api/app-media'))
          .timeout(const Duration(seconds: 20));
      pendingRequest = request;
      request.followRedirects = false;
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.headers.set(
        HttpHeaders.contentTypeHeader,
        'multipart/form-data; boundary=$boundary',
      );
      final parts = BytesBuilder();
      for (final field in fields.entries) {
        if (!RegExp(r'^[A-Za-z][A-Za-z0-9_]*$').hasMatch(field.key)) {
          throw ArgumentError('잘못된 폼 키');
        }
        parts.add(
          utf8.encode(
            '--$boundary\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${field.value}\r\n',
          ),
        );
      }
      parts.add(
        utf8.encode(
          '--$boundary\r\nContent-Disposition: form-data; name="file"; filename="$fileName"\r\nContent-Type: $contentType\r\n\r\n',
        ),
      );
      parts.add(bytes);
      parts.add(utf8.encode('\r\n--$boundary--\r\n'));
      final body = parts.takeBytes();
      request.contentLength = body.length;
      submitted = true;
      request.add(body);
      final response = await request.close().timeout(
        const Duration(seconds: 60),
      );
      final text = await utf8.decoder
          .bind(response)
          .join()
          .timeout(const Duration(seconds: 30));
      Map<String, dynamic> json;
      try {
        json = Map<String, dynamic>.from(jsonDecode(text) as Map);
      } catch (_) {
        throw ApiFailure(
          '업로드 결과를 확인할 수 없습니다',
          status: response.statusCode,
          uncertainWrite: true,
        );
      }
      if (response.statusCode != 200 || json['ok'] != true) {
        throw ApiFailure(
          json['error']?.toString() ?? '업로드 실패',
          status: response.statusCode,
          action: json['action'] as String?,
          uncertainWrite: response.statusCode >= 500,
        );
      }
      if (json['clientOperationId'] != fields['clientOperationId'] ||
          json['deduplicated'] is! bool) {
        throw const ApiFailure(
          '서버 응답의 작업 ID를 확인할 수 없습니다',
          uncertainWrite: true,
        );
      }
      return json;
    } on SocketException catch (e) {
      throw ApiFailure(
        voice ? '서버에 연결할 수 없습니다: ${e.message}' : '업로드 결과 불명 · 자동 재전송하지 않습니다',
        uncertainWrite: voice ? submitted : true,
      );
    } on TimeoutException catch (e) {
      pendingRequest?.abort();
      throw ApiFailure(
        voice
            ? '서버 응답 대기 시간이 지났습니다: ${e.message ?? e}'
            : '업로드 결과 불명 · 자동 재전송하지 않습니다',
        uncertainWrite: voice ? submitted : true,
      );
    } on HttpException catch (e) {
      throw ApiFailure(
        voice ? '응답 수신이 중단됐습니다: ${e.message}' : '업로드 결과 불명 · 자동 재전송하지 않습니다',
        uncertainWrite: voice ? submitted : true,
      );
    }
  }

  @override
  Future<MediaComment> addComment(
    String token,
    String mediaId,
    String body,
  ) async => MediaComment(
    Map<String, dynamic>.from(
      (await _json(
            'POST',
            '/api/calendar/media/comment',
            token: token,
            body: {'mediaId': mediaId, 'body': body},
          ))['comment']
          as Map,
    ),
  );
  @override
  Future<MediaComment> voiceComment(
    String token,
    String mediaId,
    Uint8List audio, {
    int? durationMs,
    String? clientOperationId,
    String? siteId,
  }) async {
    if (mediaId.trim().isEmpty || audio.isEmpty || (durationMs ?? 0) < 0) {
      throw const ApiFailure('원본 사진과 유효한 녹음이 필요합니다', status: 400);
    }
    if (audio.lengthInBytes > maxVoiceBytes) {
      throw const ApiFailure('녹음 크기가 10 MiB를 넘었습니다', status: 413);
    }
    final json = await _multipart(
      token,
      audio,
      {
        'commentOf': mediaId,
        if (durationMs != null) 'audioMs': '$durationMs',
        'clientOperationId': ?clientOperationId,
        'siteId': ?siteId,
      },
      'voice-comment.m4a',
      'audio/mp4',
      voice: true,
    );
    try {
      final row = Map<String, dynamic>.from(json['comment'] as Map);
      if (row['id'] is! String ||
          (row['id'] as String).isEmpty ||
          row['media_id'] != mediaId ||
          row['body'] is! String) {
        throw const FormatException();
      }
      return MediaComment(
        row,
        clientOperationId: json['clientOperationId'] as String?,
        deduplicated: json['deduplicated'] == true,
      );
    } catch (_) {
      throw const ApiFailure('음성 댓글 등록 결과를 확인할 수 없습니다', uncertainWrite: true);
    }
  }

  @override
  Future<void> updateComment(String token, String id, String body) async {
    await _json(
      'PATCH',
      '/api/calendar/media/comment',
      token: token,
      body: {'id': id, 'body': body},
    );
  }

  @override
  Future<void> deleteComment(String token, String id) async {
    await _json(
      'DELETE',
      '/api/calendar/media/comment?id=${Uri.encodeQueryComponent(id)}',
      token: token,
    );
  }
}
