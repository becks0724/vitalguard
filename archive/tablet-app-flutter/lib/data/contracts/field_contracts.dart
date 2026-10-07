import 'package:flutter/foundation.dart';

import '../models/server_models.dart';
import '../models/site_status.dart';
import '../outbox_controller.dart';
export '../outbox_controller.dart';
import 'voice_recorder.dart';
export 'voice_recorder.dart';
export '../models/server_models.dart';
export '../models/record_origin.dart';
export '../models/site_status.dart';

class ApiFailure implements Exception {
  const ApiFailure(
    this.message, {
    this.status,
    this.code,
    this.action,
    this.retryAfterSec,
    this.twoFactorRequired = false,
    this.uncertainWrite = false,
    this.networkUnreachable = false,
  });
  final String message;
  final int? status;
  // 본문에서 확인한 허용된 오류 코드만 전달한다. 원본 응답은 담지 않는다.
  final String? code;
  final String? action;
  final int? retryAfterSec;
  final bool twoFactorRequired;
  // 요청 전송 후 응답을 못 받았으면 자동 재전송할 수 없다.
  final bool uncertainWrite;
  // SocketException을 표시한다. 인터넷 연결 여부는 로그인 화면에서 확인한다.
  final bool networkUnreachable;
  @override
  String toString() => message;
}

abstract interface class FieldGateway {
  bool get isMock;
  Future<MobileSession> login(String id, String password, {String? totpCode});
  Future<MobileSession> refresh(String refreshToken);
  Future<AppUser> me(String accessToken);
  Future<CctvTicket> cctvTicket(String accessToken, String cameraId);
  Future<SiteStatus> siteStatus(String accessToken);
  Future<bool> ackAlert(String accessToken, String id);
  Future<void> logout(String accessToken);
  Future<SiteInfo?> siteInfo(String accessToken);
  Future<CalendarMedia> upload(
    String token,
    Uint8List bytes,
    Map<String, String> fields,
  );
  Future<MediaComment> addComment(
    String token,
    String mediaId,
    String body, {
    String? clientOperationId,
  });
  Future<MediaComment> voiceComment(
    String token,
    String mediaId,
    Uint8List audio, {
    int? durationMs,
    String? clientOperationId,
    String? siteId,
  });
}

/// 촬영 주소는 기존 게이트웨이 구현을 깨지 않도록 별도 능력으로 둔다.
abstract interface class CaptureAddressGateway {
  Future<String?> captureAddress(
    String token, {
    required double latitude,
    required double longitude,
  });
}

// 기기 로컬 데이터 계약. 서버 응답 모델과 분리한다.
abstract interface class LocalStore {
  Future<String?> readTokenBundle();
  Future<void> writeTokenBundle(String? json);
  Future<String?> read(String accountId, String key);
  Future<void> write(String accountId, String key, String value);
  Future<Uint8List?> readBytes(String accountId, String key);
  Future<void> writeBytes(String accountId, String key, Uint8List bytes);
  Future<void> remove(String accountId, String key);
  Future<List<String>> keys(String accountId);
}

abstract interface class SpeechInput {
  Stream<Map<String, dynamic>> get events;
  Future<bool> available();
  Future<void> start(String runId);
  Future<void> stop({bool cancel = false});
}

enum AuthStage { restoring, login, totp, ready, denied, reauthenticate }

// 아래는 화면/로컬 상태 계약이며 서버 JSON 필드가 아니다.
abstract class FieldController extends ChangeNotifier {
  OutboxController? _outbox;
  OutboxController get outbox => _outbox ??= OutboxController(this);
  bool get operationLookupAvailable => false;
  Future<OperationCheck> lookupOperation(String clientOperationId) async =>
      (await lookupOperations([clientOperationId]))[clientOperationId] ??
      const OperationCheck(OperationPresence.unknown);
  Future<Map<String, OperationCheck>> lookupOperations(
    List<String> ids,
  ) async => {
    for (final id in ids) id: const OperationCheck(OperationPresence.unknown),
  };

  @override
  void dispose() {
    _outbox?.dispose();
    super.dispose();
  }

  AuthStage get authStage;
  bool get isMock;
  bool get busy;
  bool get offline;
  String? get message;
  ApiFailure? get loginFailure => null;
  DateTime? get lockedUntil;
  AppUser? get user;
  SiteInfo? get site;
  SpeechInput get speech;
  VoiceRecorder get recorder => const UnavailableVoiceRecorder();
  LocalStore get local;
  Future<void> initialize();
  Future<void> signIn(String id, String password, {bool remember = true});
  Future<void> submitTotp(String code);
  Future<void> cancelSignIn();
  Future<void> signOut();
  Future<Uint8List> photoBytes(CalendarMedia media);
  Future<CalendarMedia> publish(Uint8List bytes, Map<String, String> fields);
  Future<MediaComment> comment(
    String mediaId,
    String text, {
    String? clientOperationId,
  });
  Future<MediaComment> voiceComment(
    String mediaId,
    Uint8List audio, {
    int? durationMs,
    String? clientOperationId,
    String? siteId,
  });
  Future<CctvTicket> cctvTicket(String cameraId);
  SiteStatus? get siteStatusSnapshot;
  bool get siteStatusForbidden;
  Future<SiteStatus> siteStatus();
  Future<void> refreshSite();
  Future<bool> ackAlert(String id);
  // 주소 API가 없는 테스트/대체 컨트롤러는 null을 반환해 기기 추정 폴백을 허용한다.
  Future<String?> captureAddress({
    required double latitude,
    required double longitude,
  }) async => null;
  Future<void> Function()? beforeLock;
}
