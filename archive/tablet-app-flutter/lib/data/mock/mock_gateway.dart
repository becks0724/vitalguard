import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import '../contracts/field_contracts.dart';

class MockGateway implements FieldGateway {
  final _operationMedia = <String, Map<String, dynamic>>{};
  final _operationComments = <String, Map<String, dynamic>>{};

  @override
  bool get isMock => true;
  final _media = <Map<String, dynamic>>[];
  String _user = 'demo';
  int _id = 0;
  final logoutTokens = <String>[];
  final siteInfoTokens = <String>[];

  MockGateway() {
    final date = calendarDate(kstNow());
    _media.add({
      'id': 'mock-original-001',
      'date_key': date,
      'captured_at': '${date}T09:30:00+09:00',
      'media_type': 'image',
      'title': '모의 현장 사진',
      'media_url': 'https://mock.invalid/original.png',
      'thumbnail_url': null,
      'ocr_text': '모의 OCR 원문\n안전난간 점검',
      'description': null,
      'site_id': 'mock-site',
      'uploader': '모의 안전관리자',
      'worker_id': 'MOCK-01',
      'latitude': null,
      'longitude': null,
      'road_address': null,
      'coord_gap_m': null,
      'coord_ref_accuracy_m': null,
      'created_at': '${date}T09:31:00+09:00',
      'storage_provider': null,
      'storage_key': null,
    });
  }

  MobileSession _session() => MobileSession({
    'ok': true,
    'accessToken': 'mock-access-$_user',
    'refreshToken': 'mock-refresh-$_user',
    'accessExpiresInSec': 900,
    'refreshExpiresAt': '2099-01-01T00:00:00+09:00',
    'user': {
      'id': _user,
      'role': _user == 'worker' ? 'worker' : 'site_manager',
      'name': '모의 안전관리자',
      'workerId': 'MOCK-01',
    },
    'twoFactorPending': false,
  });
  @override
  Future<MobileSession> login(
    String id,
    String password, {
    String? totpCode,
  }) async {
    if (password != 'mock') {
      throw const ApiFailure('모의 비밀번호는 mock입니다', status: 401);
    }
    if (id == 'totp' && totpCode != '123456') {
      throw const ApiFailure(
        '모의 인증번호 123456을 입력하세요',
        status: 401,
        twoFactorRequired: true,
      );
    }
    _user = id;
    return _session();
  }

  @override
  Future<MobileSession> refresh(String refreshToken) async => _session();
  @override
  Future<AppUser> me(String accessToken) async => _session().user;
  @override
  Future<CctvTicket> cctvTicket(String accessToken, String cameraId) async {
    // 모의 모드에 실제 영상이나 샘플 카메라를 만들지 않는다.
    throw const ApiFailure('모의 모드에는 CCTV 설정이 없습니다', status: 503);
  }

  @override
  Future<SiteStatus> siteStatus(String accessToken) async => SiteStatus({
    'ok': true,
    'fetchedAt': DateTime.now().toUtc().toIso8601String(),
    'weather': {'ok': true, 'level': 'normal', 'summary': '기상 특보 0건'},
    'workers': {'ok': true, 'level': 'normal', 'normal': 12, 'waiting': 0},
    'gas': {'ok': true, 'level': 'idle', 'summary': '모의 감지기 수신 대기'},
    'aed': {
      'ok': true,
      'level': 'normal',
      'summary': '점검 필요 0건',
      'total': 0,
      'devices': <Object>[],
    },
    'alerts': {
      'ok': true,
      'unacked': 0,
      'siteScoped': false,
      'items': <Object>[],
    },
  });

  @override
  Future<bool> ackAlert(String accessToken, String id) async {
    // 기본 모의 목록은 비어 있다. 없는 행을 완료했다고 꾸미지 않는다.
    throw const ApiFailure('모의 경보 목록에 대상이 없습니다', status: 404);
  }

  @override
  Future<void> logout(String accessToken) async {
    logoutTokens.add(accessToken);
  }

  @override
  Future<SiteInfo?> siteInfo(String accessToken) async {
    siteInfoTokens.add(accessToken);
    return SiteInfo({
      'id': 1,
      'snapshot_date': calendarDate(kstNow()),
      'site_name': '모의 현장',
      'company_name': '모의 시공사',
      'construction_type': null,
      'address': null,
      'start_date': null,
      'completion_date': null,
      'recorded_at': kstNow().toIso8601String(),
    });
  }

  @override
  Future<CalendarMedia> upload(
    String token,
    Uint8List bytes,
    Map<String, String> fields,
  ) async {
    final operation = fields['clientOperationId'];
    final stored = operation == null
        ? null
        : _operationMedia['$_user:$operation'];
    if (stored != null) {
      return CalendarMedia(
        stored,
        clientOperationId: operation,
        deduplicated: true,
      );
    }
    final ink = fields.containsKey('annotationOf');
    if (ink) {
      final sizeError = inkUploadSizeError(bytes.lengthInBytes);
      if (sizeError != null) throw ApiFailure(sizeError, status: 413);
      if (fields['annotationOf']!.trim().isEmpty) {
        throw const ApiFailure('원본 ID가 필요합니다', status: 400);
      }
      try {
        final body = jsonDecode(utf8.decode(bytes));
        if (body is! Map || body['v'] is! int) throw const FormatException();
      } on FormatException {
        throw const ApiFailure('잉크 JSON에 정수 v가 필요합니다', status: 400);
      }
    }
    final jpeg =
        bytes.length >= 3 &&
        bytes[0] == 0xff &&
        bytes[1] == 0xd8 &&
        bytes[2] == 0xff;
    final id = 'mock-upload-${++_id}',
        url =
            'https://mock.invalid/upload-$_id.${ink
                ? 'json'
                : jpeg
                ? 'jpg'
                : 'png'}';
    final row = {
      'id': id,
      'date_key': fields['dateKey'],
      'captured_at': fields['capturedAt'],
      'media_type': ink ? 'ink' : 'image',
      if (ink) 'annotation_of': fields['annotationOf'],
      'title': fields['title'],
      'media_url': url,
      'ocr_text': fields['ocrText'],
      'site_id': fields['siteId'],
      'uploader': '모의 안전관리자',
      'worker_id': 'MOCK-01',
      'description': null,
      'created_at': kstNow().toIso8601String(),
    };
    _media.add(row);
    if (operation != null) _operationMedia['$_user:$operation'] = row;
    return CalendarMedia(row, clientOperationId: operation);
  }

  @override
  Future<MediaComment> addComment(
    String token,
    String mediaId,
    String body, {
    String? clientOperationId,
  }) async {
    final stored = clientOperationId == null
        ? null
        : _operationComments['$_user:$clientOperationId'];
    if (stored != null) {
      return MediaComment(
        stored,
        clientOperationId: clientOperationId,
        deduplicated: true,
      );
    }
    final row = {
      'id': 'mock-comment-${++_id}',
      'media_id': mediaId,
      'body': body,
      'author_id': _user,
      'author_name': '모의 안전관리자',
      'author_role': 'site_manager',
      'author_title': null,
      'created_at': kstNow().toIso8601String(),
      'updated_at': null,
    };
    if (clientOperationId != null) {
      _operationComments['$_user:$clientOperationId'] = row;
    }
    return MediaComment(row, clientOperationId: clientOperationId);
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
    final stored = clientOperationId == null
        ? null
        : _operationComments['$_user:$clientOperationId'];
    if (stored != null) {
      return MediaComment(
        stored,
        clientOperationId: clientOperationId,
        deduplicated: true,
      );
    }
    if (token.isEmpty) throw const ApiFailure('로그인이 필요합니다', status: 401);
    if (mediaId.trim().isEmpty || audio.isEmpty || (durationMs ?? 0) < 0) {
      throw const ApiFailure('원본 사진과 유효한 녹음이 필요합니다', status: 400);
    }
    if (audio.lengthInBytes > maxVoiceBytes) {
      throw const ApiFailure('녹음 크기가 10 MiB를 넘었습니다', status: 413);
    }
    final photo = _media.where((m) => m['id'] == mediaId).firstOrNull;
    if (photo == null) throw const ApiFailure('원본 사진이 없습니다', status: 404);
    if (photo['annotation_of'] != null || photo['media_type'] == 'ink') {
      throw const ApiFailure('잉크본에는 음성 댓글을 달 수 없습니다', status: 400);
    }
    // 원본 사진 작성자를 검사하지 않는다. 댓글 작성자는 현재 모의 로그인 계정이다.
    final id = 'mock-voice-${++_id}';
    final url = 'https://mock.invalid/$id.m4a';
    final row = <String, dynamic>{
      'id': id,
      'media_id': mediaId,
      'body': '',
      'author_id': _user,
      'author_name': '모의 안전관리자',
      'author_role': 'site_manager',
      'created_at': kstNow().toIso8601String(),
      'audio_storage_key': id,
      'audio_url': url,
      'audio_ms': durationMs,
    };
    if (clientOperationId != null) {
      _operationComments['$_user:$clientOperationId'] = row;
    }
    return MediaComment(row, clientOperationId: clientOperationId);
  }
}

/// 기존 모의 화면의 수동 미등록 확인은 유지하고, 조회 기능은 명시적으로 선택한다.
class MockLookupGateway extends MockGateway implements OperationLookupGateway {
  @override
  Future<Map<String, OperationCheck>> lookupOperations(
    String token,
    List<String> clientOperationIds,
  ) async => {
    for (final id in clientOperationIds)
      id: switch (_operationMedia['$_user:$id'] ??
          _operationComments['$_user:$id']) {
        final row? => OperationCheck(
          OperationPresence.confirmed,
          receipt: {'id': row['id']},
        ),
        null => const OperationCheck(OperationPresence.absent),
      },
  };
}

class MockSpeechInput implements SpeechInput {
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  @override
  Stream<Map<String, dynamic>> get events => _events.stream;
  @override
  Future<bool> available() async => true;
  @override
  Future<void> start(String runId) async {
    _events.add({
      'type': 'final',
      'runId': runId,
      'results': ['가스 농도 추가 경보 발생', '가스 농도 초과 경보 발생', '가스 농도 추가 경부 발생'],
    });
  }

  @override
  Future<void> stop({bool cancel = false}) async {}
}
