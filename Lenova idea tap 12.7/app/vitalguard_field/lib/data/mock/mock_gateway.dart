import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import '../contracts/field_contracts.dart';

// 1000×650 indexed PNG. 회색 구조선과 균열만 있는 명시적인 모의 도면이다.
const _mockSitePlanPng =
    'iVBORw0KGgoAAAANSUhEUgAAA+gAAAKKCAMAAACZNoEzAAAACVBMVEXn5eB3fII9RE3IOgcYAAAJv0lEQVR42u3dQY7iShREUfP2'
    'v2gkGDFDiEzbEeesoOOmn6p60P8fBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQJ7H'
    'BzXU6K0RvdenrYYaDt2nrYZDN85Tq2GvcWqoYa9xaqhhr3FqqGGvcWqoYa9xaqhhr09bDTUcuk9bDYdunKdWw17j1FDDXuPUUMNe'
    '49RQw17j1FDDXuPUUMNej6mGGg7dp62GQ3foPm017DVODTXsNU4NNew1Tg017DVODTXsNU4NNez1mGqo4dB92mqo4dB92mo4dOPU'
    'UMNe49RQw17j1FDDXuPUUMNe49RQw17j1FDDXp+2Gmo4dJ+2Gg7dOE+thr3GqaGGvcapoYa9xqmhhr3GqaGGvcapoYa9HlMNNRy6'
    'T1sNh+7Qfdpq2GucGmrYa5waathrnBpq2GucGmrYa5waatjrMdVQw6H7tNVQw6H7tNVw6MapoYa9xqmhhr3GqaGGvcapoYa9xqmh'
    'hr3GqaGGvT5tNdRw6D5tNRy6cZ5aDXuNU0MNe41T479GDXs9ZnyNmVHDXo8ZXmNm1aU7dOM8tUP3+sapEXDnDt04T+3Qvb5xaiTc'
    'uUM3zlM7dK9vnBoJd+7QjfPUDt3rG6eGQ/f6xqlxizt36MZ5aofu9Y1TI+HOHbpxntqhe33j1Ei4c4dunKd26F7fODUS7tyhG+ep'
    'HbrXN04Nh+71T/yzE+R15zLs4dBx6A7doePOHbpDx6E7dIeOO3foDt2h49AdukPHoePOceg4dBw67tyhO3QcukN36Lhzh+7Q+erQ'
    'XbpDd+gunapD908RM2u8L33UsNe46Bo7Lt2hG+epL3LqathrXHaN5T/UHbpxnrrg0h26cZ664Nd3h26cpy74oe7QjfPUBZfu0I3z'
    '1AW/vjt04zx1wQ91h26cpy64dIdunKcu+PXdoRvnqQt+qDt04zx1waU7dOM8dcGv7w7dOE9dcOkO3ThP7Se61zdODX9H9/rGqXGH'
    'O3foxnnq/DN36MZ56oY7d+jGeeqCO3foxnnq/DN36MZ56oY7d+jGeepL3bka9nrM4Brjvxlnr3HxNfxXYO01Lr7G+v9Xi0M3zlPn'
    '37lDN85TF9y5QzfOU+efuUM3zlM33LlDN85Tn3/nathrXHKNXXfu0I3z1Gdfuhr2Ghf/d3Q17DVODTXs9WmroYZD92mr4dAduqdW'
    'w17j1FDDXuPUUMNe49RQw17j1FDDXuPUUMNej6mGGg7dp62GGg7dp62GQzdODTXsNU4NNew1Tg017DVODTXsNU4NNez1mGqoYa9P'
    'Ww01HLpPWw2HbpynVsNe49RQw17j1FDDXuPUUMNe49RQw17j1FDDXp+2Gmo4dJ+2Gg7doXtqNew1Tg017DVODTXsNU4NNew1Tg01'
    '7DVODTXs9ZhqqOHQfdpqqOHQfdpqOHTj1FDDXuPUUMNe49RQw17j1FDDXuPUUMNej6mGGvb6tNVQw6H7tNVw6MZ5ajXsNU4NNew1'
    'Tg017DVODTXsNU4NNew1Tg017PVpq6GGQ/dpq+HQHbqnVsNe49RQw17j1FDDXuPUUMNe49RQw17j1FDDXo+phhoO3aethkN36D5t'
    'New1Tg017DVODTXsNU4NNew1Tg017DVODTXs9ZhqqGGvT1sNNRy6T1sNh26cp1bDXuPUUMNe49RQw17j1FDDXuPUUMNe49RQw16f'
    'thpqOHSfthoO3aF7ajXsNU4NNew1Tg017DVODTXsNU4NNew1Tg017PWYaqjh0H3aajh0h+7TVsNe49RQw17j1FDDXuPUUMNe49RQ'
    'w17j1FDDXo+phhr2+rTVUMOh+7TVcOjGeWo17DVODTXsNU4NNew1Tg017DVODTXsNU4NNez1aauhhkP3aavh0B26p1bDXuPUUMNe'
    '49RQw17j1FDDXuPUUMNe49RQw16PqYYaDt2nrYZDd+g+bTXsNU4NNew1Tg017DVODTXsNU4NNew1Tg017PWYaqhhr09bDTUcuk9b'
    'DYd+vz878AuHDg7doYNDd+jg0B06OHSHDg7doYNDBxw64NDBoTt0cOgOHRy6QweH7tDBofuniGqoYa/HVEMNh+7TVsOhO3RPrYa9'
    'xqmhhr3GqaGGvcapoYa9xqmhhr3GqaGGvR5TDTUcuk9bDTUcuk9bDYdunBpq2GucGmrYa5waathrnBpq2GucGmrYa5waatjr01ZD'
    'DYfu01bDoRvnqdWw1zg11LDXODXUsNc4NdSw1zg11LDXODXUsNenrYYaDt2nrYZDd+ieWg17jVNDDXuNU0MNe41TQw17jVNDDXuN'
    'U0MNez2mGmo4dJ+2Gmo4dJ+2Gg7dODXUsNc4NdSw1zg11LDXODXUsNc4NdSw1zg11LDXp62GGg7dp62GQzfOU6thr3FqqGGvcWqo'
    'Ya9xaqhhr3FqqGGvcWqoYa9PWw01HLpPWw2H7tA9tRr2GqeGGvYap4Ya9hqnhhr2GqeGGvYap4Ya9npMNdRw6D5tNdRw6D5tNRy6'
    'cWqoYa9xaqhhr3FqqGGvcWqoYa9xaqhhr8dUQw17fdpqqOHQfdpqOHTjPLUa9hqnhhr2GqeGGvYap4Ya9hqnhhr2GqeGGvb6tNVQ'
    'w6H7tNVw6A7dU6thr3FqqGGvcWqoYa9xaqhhr3FqqGGvcWqoYa/HVEMNh+7TVkMNh+7TVsOhG6eGGvYap4Ya9hqnhhr2GqeGGvYa'
    'p4Ya9npMNdSw16ethhoO3aethkM3zlOrYa9xaqhhr3FqqGGvcWqoYa9xaqhhr3FqqGGvT1sNNRy6T1sNh+7QPbUa9hqnhhr2GqeG'
    'GvYap4Ya9hqnhhr2GqeGGvZ6TDXUcOg+bTUcukP3aathr3FqqGGvcWqoYa9xaqhhr3FqqGGvcWqoYa/HVEMNe33aaqjh0H3aajh0'
    '4zy1GvYap4Ya9hqnhhr2GqeGGvYap4Ya9hqnhhr2+rTVUMOh+7TVcOgO3VOrYa9xaqhhr3FqqGGvcWqoYa9xaqhhr3FqqGGvx1RD'
    'DYfu01bDoTt0n7Ya9hqnhhr2GqeGGvYap4Ya9hqnhhr2GqeGGvZ6TDXUsBcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    '1nkC/ouyR/TTBygAAAAASUVORK5CYII=';

class MockGateway implements FieldGateway {
  final _operationMedia = <String, Map<String, dynamic>>{};
  final _operationComments = <String, Map<String, dynamic>>{};

  @override
  bool get isMock => true;
  final _media = <Map<String, dynamic>>[];
  final _comments = <Map<String, dynamic>>[];
  final _images = <String, Uint8List>{};
  String _user = 'demo';
  int _id = 0;

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
  Future<void> logout(String accessToken) async {}
  @override
  Future<SiteInfo?> siteInfo(String accessToken) async => SiteInfo({
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
  @override
  Future<List<CalendarMedia>> media(
    String token,
    String from,
    String to,
  ) async => _media
      .where(
        (m) =>
            m['annotation_of'] == null &&
            (m['date_key'] as String).compareTo(from) >= 0 &&
            (m['date_key'] as String).compareTo(to) <= 0,
      )
      .map(
        (m) => CalendarMedia({
          ...m,
          'annotationId': _media.reversed
              .where((ink) => ink['annotation_of'] == m['id'])
              .firstOrNull?['id'],
          'comments': _comments.where((c) => c['media_id'] == m['id']).toList(),
          'canDelete': true,
        }),
      )
      .toList();
  @override
  Future<List<CalendarEvent>> events(
    String token,
    String from,
    String to,
  ) async {
    final today = calendarDate(kstNow());
    if (today.compareTo(from) < 0 || today.compareTo(to) > 0) return [];
    return [
      CalendarEvent({
        'id': 'mock-event',
        'date_key': today,
        'title': '모의 안전 점검',
        'label_id': 'mock-label',
        'start_time': '09:30',
        'end_time': '10:00',
        'end_date_key': null,
        'note': '시연용 일정입니다',
        'hazard_type': null,
        'created_by': _user,
        'created_at': '${today}T08:00:00+09:00',
        'updated_at': null,
        'canEdit': false,
      }),
    ];
  }

  @override
  Future<List<CalendarLabel>> labels(String token) async => [
    CalendarLabel({
      'id': 'mock-label',
      'name': '점검',
      'color': 'blue',
      'sort_order': 0,
    }),
  ];

  @override
  Future<Uint8List> image(String url) async {
    if (_images.containsKey(url)) return _images[url]!;
    // 실제 사진으로 위장하지 않는 1000×650 시연 도면. 런타임 래스터화 없이 반환한다.
    // Picture.toImage/toByteData는 R-03의 로딩 표시를 계속 움직이게 해 프레임 정착을 막았다.
    return _images[url] = base64Decode(_mockSitePlanPng);
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
    _images[url] = Uint8List.fromList(bytes);
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
    String body,
  ) async {
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
    _comments.add(row);
    return MediaComment(row);
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
    _images[url] = Uint8List.fromList(audio);
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
    _comments.add(row);
    if (clientOperationId != null) {
      _operationComments['$_user:$clientOperationId'] = row;
    }
    return MediaComment(row, clientOperationId: clientOperationId);
  }

  @override
  Future<void> updateComment(String token, String id, String body) async {
    final row = _comments.firstWhere((c) => c['id'] == id);
    row['body'] = body;
  }

  @override
  Future<void> deleteComment(String token, String id) async {
    final row = _comments.where((c) => c['id'] == id).firstOrNull;
    if (row?['audio_url'] != null) _images.remove(row!['audio_url']);
    _comments.removeWhere((c) => c['id'] == id);
  }
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
