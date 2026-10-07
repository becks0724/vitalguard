// 서버 JSON 이름을 유지한다. 화면 표시용 이름이나 가상의 서버 필드를 추가하지 않는다.
// ignore_for_file: non_constant_identifier_names

class ServerRow {
  ServerRow(Map<String, dynamic> json) : json = Map.unmodifiable(json);
  final Map<String, dynamic> json;
  String? text(String key) => json[key] as String?;
  double? number(String key) => (json[key] as num?)?.toDouble();
  bool? flag(String key) => json[key] as bool?;
}

class AppUser extends ServerRow {
  AppUser(super.json);
  String get id => text('id')!;
  String get role => text('role')!;
  String? get name => text('name');
  String? get workerId => text('workerId');
}

class MobileSession extends ServerRow {
  MobileSession(super.json);
  String get accessToken => text('accessToken')!;
  String get refreshToken => text('refreshToken')!;
  int get accessExpiresInSec => (json['accessExpiresInSec'] as num).toInt();
  String get refreshExpiresAt => text('refreshExpiresAt')!;
  AppUser get user => AppUser(Map<String, dynamic>.from(json['user'] as Map));
  bool? get twoFactorPending => flag('twoFactorPending');
}

class CctvTicket extends ServerRow {
  CctvTicket(super.json) {
    if (json['ok'] != true ||
        json['ticket'] is! String ||
        (json['ticket'] as String).isEmpty ||
        RegExp(r'[\x00-\x20\x7f]').hasMatch(json['ticket'] as String) ||
        json['expiresAt'] is! int ||
        json['ttlSec'] is! int ||
        (json['ttlSec'] as int) <= 0 ||
        json['gateApi'] is! String) {
      // 원본 응답이나 티켓을 예외에 포함하지 않는다.
      throw const FormatException('CCTV 티켓 응답 형식이 올바르지 않습니다');
    }
  }

  bool get ok => flag('ok')!;
  String get ticket => text('ticket')!;
  // 서버 계약은 Unix epoch 밀리초다. 영상의 촬영 시각이 아니다.
  int get expiresAt => json['expiresAt'] as int;
  int get ttlSec => json['ttlSec'] as int;
  String get gateApi => text('gateApi')!;
}

class SiteInfo extends ServerRow {
  SiteInfo(super.json);
  // id는 일별 스냅숏 ID다. 현장 배정 ID로 사용하지 않는다.
  String? get site_id => text('site_id');
  String? get site_name => text('site_name');
  String? get company_name => text('company_name');
  String? get address => text('address');
}

class CalendarMedia extends ServerRow {
  CalendarMedia(
    super.json, {
    this.clientOperationId,
    this.deduplicated = false,
  });
  // app-media 응답 봉투의 값. 서버 행 JSON과 분리한다.
  final String? clientOperationId;
  final bool deduplicated;
  String get id => text('id')!;
  String get date_key => text('date_key')!;
  String? get captured_at => text('captured_at');
  String? get title => text('title');
  String? get media_type => text('media_type');
  String? get media_url => text('media_url');
  String? get thumbnail_url => text('thumbnail_url');
  String? get ocr_text => text('ocr_text');
  String? get road_address => text('road_address');
  double? get latitude => number('latitude');
  double? get longitude => number('longitude');
  String? get site_id => text('site_id');
  String? get worker_id => text('worker_id');
  String? get uploader => text('uploader');
  String? get description => text('description');
  double? get coord_gap_m => number('coord_gap_m');
  double? get coord_ref_accuracy_m => number('coord_ref_accuracy_m');
  bool? get canDelete => flag('canDelete');
  List<MediaComment> get comments => (json['comments'] as List? ?? [])
      .map((e) => MediaComment(Map<String, dynamic>.from(e as Map)))
      .toList();
}

class MediaComment extends ServerRow {
  MediaComment(super.json, {this.clientOperationId, this.deduplicated = false});
  // app-media 응답 봉투의 값. 서버 행 JSON과 분리한다.
  final String? clientOperationId;
  final bool deduplicated;
  String get id => text('id')!;
  String get media_id => text('media_id')!;
  String get body => text('body')!;
  String? get author_id => text('author_id');
  String? get author_name => text('author_name');
  String? get author_role => text('author_role');
  String? get author_title => text('author_title');
  String? get created_at => text('created_at');
  String? get updated_at => text('updated_at');
  String? get audio_storage_key => text('audio_storage_key');
  String? get audio_url => text('audio_url');
  int? get audio_ms => (json['audio_ms'] as num?)?.toInt();
}
