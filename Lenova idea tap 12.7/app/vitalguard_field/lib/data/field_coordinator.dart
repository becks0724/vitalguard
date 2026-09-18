import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'contracts/field_contracts.dart';

class FieldCoordinator extends FieldController {
  FieldCoordinator(
    this.gateway,
    this.local,
    this.speech, {
    this.recorder = const UnavailableVoiceRecorder(),
  });
  final FieldGateway gateway;
  @override
  final LocalStore local;
  @override
  final SpeechInput speech;
  @override
  final VoiceRecorder recorder;
  @override
  AuthStage authStage = AuthStage.restoring;
  @override
  bool busy = false;
  @override
  bool offline = false;
  @override
  String? message;
  @override
  ApiFailure? loginFailure;
  @override
  DateTime? lockedUntil;
  @override
  AppUser? user;
  @override
  SiteInfo? site;
  @override
  @override
  SiteStatus? siteStatusSnapshot;
  @override
  bool siteStatusForbidden = false;
  @override
  bool get isMock => gateway.isMock;
  MobileSession? _session;
  DateTime? _accessExpiresAt;
  Future<void>? _refreshing;
  bool _revalidateOnReconnect = false;
  int _epoch = 0;
  bool _remember = true;
  String? _challengeId;
  String? _challengePassword;
  bool _disposed = false;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _clearView() {
    _revalidateOnReconnect = false;
    user = null;
    site = null;
    siteStatusSnapshot = null;
    siteStatusForbidden = false;
  }

  // 2026-09-14 태곤 님 결정: 실제 운영 계정인 admin도 허용한다.
  // 2026-09-12에는 실제 계정 구조를 모른 채 platform_admin·site_manager만 허용했다.
  // 라이브 DB users에는 role='admin' 계정 5개
  // (admin0740·admin3470·admin6861·test.jodal·test.mois, 모두 status=approved)뿐이고,
  // site_manager·platform_admin은 없어 기존 규칙으로는 현장 담당관이 아무도 앱을 못 쓴다.
  // 서버 lib/app-login.ts에는 역할 검사가 없으며 거부 조건은
  // invalid_credentials·not_approved뿐이다.
  // worker는 워치 앱 대상이므로 이 태블릿 앱에서는 계속 거부한다.
  bool _allowed(AppUser user) =>
      const {'platform_admin', 'site_manager', 'admin'}.contains(user.role);

  bool _authenticationRejected(Object error) =>
      error is ApiFailure &&
      (error.status == 401 || error.status == 403 || error.action == 'reauth');

  Future<void> _accept(
    MobileSession session,
    int epoch, {
    DateTime? expiresAt,
  }) async {
    if (epoch != _epoch) throw const ApiFailure('로그인 상태가 바뀌었습니다');
    if (!_allowed(session.user)) {
      _session = null;
      _clearView();
      await local.writeTokenBundle(null);
      authStage = AuthStage.denied;
      throw const ApiFailure(
        '이 앱을 사용할 수 없는 계정입니다. 현장 관리자 계정을 확인해 주세요',
        status: 403,
      );
    }
    _session = session;
    user = session.user;
    _accessExpiresAt =
        expiresAt ??
        DateTime.now().add(Duration(seconds: session.accessExpiresInSec));
    if (_remember) {
      await local.writeTokenBundle(
        jsonEncode({
          'session': session.json,
          'localAccessExpiresAt': _accessExpiresAt!.toIso8601String(),
        }),
      );
    } else {
      await local.writeTokenBundle(null);
    }
  }

  @override
  Future<void> initialize() async {
    final epoch = ++_epoch;
    MobileSession? savedSession;
    _revalidateOnReconnect = false;
    message = null;
    try {
      final raw = await local.readTokenBundle();
      if (epoch != _epoch) return;
      if (raw == null) {
        authStage = AuthStage.login;
        return;
      }
      final stored = jsonDecode(raw) as Map;
      final session = MobileSession(
        Map<String, dynamic>.from(stored['session'] as Map),
      );
      await _accept(
        session,
        epoch,
        expiresAt: DateTime.parse(stored['localAccessExpiresAt'] as String),
      );
      if (epoch != _epoch) return;
      // _accept의 저장 사용자 역할 검사를 통과한 세션만 오프라인 복원한다.
      savedSession = session;
      final current = await _authorized(gateway.me);
      if (!_allowed(current)) {
        throw const ApiFailure(
          '이 앱을 사용할 수 없는 계정입니다',
          status: 403,
          action: 'reauth',
        );
      }
      user = current;
      site = await _loadSite();
      if (epoch != _epoch) return;
      authStage = AuthStage.ready;
    } catch (error) {
      // _authorized가 이 복원 중 _lock한 경우에는 기존 로그인 안내를 유지한다.
      if (epoch != _epoch && authStage != AuthStage.reauthenticate) return;
      DateTime? refreshExpiresAt;
      final session = savedSession;
      if (!_authenticationRejected(error) &&
          session != null &&
          epoch == _epoch) {
        try {
          refreshExpiresAt = DateTime.tryParse(session.refreshExpiresAt);
        } catch (_) {
          // 손상된 저장 만료 시각으로는 오프라인 진입을 허용하지 않는다.
        }
        if (refreshExpiresAt?.isAfter(DateTime.now()) ?? false) {
          final cachedSite = await _readCachedSite(session.user.id);
          if (epoch != _epoch) return;
          user = session.user;
          site = cachedSite;
          authStage = AuthStage.ready;
          offline = true;
          message = null;
          _revalidateOnReconnect = true;
          return;
        }
      }
      if (authStage != AuthStage.denied) authStage = AuthStage.login;
      _clearView();
      message = refreshExpiresAt != null
          ? '저장된 로그인의 유효 기간이 지났습니다. 다시 로그인해 주세요. 기기 기록은 보존됩니다.'
          : '저장된 로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요. 기기 기록은 보존됩니다.';
    } finally {
      _notify();
    }
  }

  Future<SiteInfo?> _loadSite() async {
    final epoch = _epoch;
    final account = user?.id;
    final result = await _authorized(gateway.siteInfo);
    if (epoch != _epoch) throw const ApiFailure('로그인 상태가 바뀌었습니다');
    if (account != null) {
      // null 응답도 기록하여 이전 현장이 다음 오프라인 실행에 남지 않게 한다.
      await local.write(account, 'site:info', jsonEncode(result?.json));
    }
    if (epoch != _epoch) throw const ApiFailure('로그인 상태가 바뀌었습니다');
    return result;
  }

  Future<SiteInfo?> _readCachedSite(String account) async {
    try {
      final raw = await local.read(account, 'site:info');
      final data = raw == null ? null : jsonDecode(raw);
      return data is Map ? SiteInfo(Map<String, dynamic>.from(data)) : null;
    } catch (_) {
      return null;
    }
  }

  void _markOnline() {
    final wasOffline = offline;
    offline = false;
    if (!wasOffline) return;
    if (_revalidateOnReconnect) {
      // 시작 전에 소비하여 병렬 요청과 me 자체의 성공이 중복 확인하지 않게 한다.
      _revalidateOnReconnect = false;
      unawaited(_revalidateSession(_epoch));
    }
    _notify();
  }

  Future<void> _revalidateSession(int epoch) async {
    try {
      final current = await _authorized(gateway.me, retryUnauthorized: false);
      if (epoch != _epoch) return;
      if (!_allowed(current)) {
        throw const ApiFailure(
          '이 앱을 사용할 수 없는 계정입니다',
          status: 403,
          action: 'reauth',
        );
      }
      user = current;
      try {
        site = await _loadSite();
      } catch (_) {
        // 현장 조회 실패는 me 재확인 성공과 기존 현장 정보를 되돌리지 않는다.
      }
      if (epoch != _epoch) return;
      _notify();
    } catch (error) {
      if (epoch == _epoch && _authenticationRejected(error)) await _lock();
    }
  }

  @override
  Future<void> signIn(
    String id,
    String password, {
    bool remember = true,
  }) async {
    if (busy || (lockedUntil?.isAfter(DateTime.now()) ?? false)) return;
    final epoch = ++_epoch;
    _clearView();
    _session = null;
    _refreshing = null;
    _remember = remember;
    _challengeId = id.trim();
    _challengePassword = password;
    await _login(epoch);
  }

  Future<void> _login(int epoch, {String? code}) async {
    busy = true;
    message = null;
    loginFailure = null;
    _notify();
    try {
      final session = await gateway.login(
        _challengeId!,
        _challengePassword!,
        totpCode: code,
      );
      if (epoch != _epoch) return;
      await _accept(session, epoch);
      _challengePassword = null;
      _challengeId = null;
      site = await _loadSite();
      if (epoch != _epoch) return;
      // 배정·첫 비밀번호 변경 상태는 서버가 주지 않는다(login/me 응답에 없음).
      // 2026-09-12 결정: 서버 확장 대신 A-06·A-12 를 앱에서 제외한다.
      //   A-06 — site_info_daily 최신 1행이 전역 단일 현장이라 "배정 1개면 건너뛴다" 규칙이 발동.
      //   A-12 — 관제웹 담당. ⚠ 첫 비밀번호 미변경 계정도 앱에 들어온다(잔여 리스크).
      authStage = AuthStage.ready;
      offline = false;
    } on ApiFailure catch (error) {
      if (epoch != _epoch) return;
      message = error.message;
      loginFailure = error;
      if (error.retryAfterSec != null) {
        lockedUntil = DateTime.now().add(
          Duration(seconds: error.retryAfterSec!),
        );
      }
      if (error.twoFactorRequired) {
        authStage = AuthStage.totp;
      } else if (authStage != AuthStage.denied &&
          authStage != AuthStage.reauthenticate) {
        authStage = AuthStage.login;
      }
      if (authStage != AuthStage.totp) {
        _challengePassword = null;
        _challengeId = null;
      }
    } catch (_) {
      message = '로그인 응답 또는 기기 저장 상태를 확인할 수 없습니다';
      _challengePassword = null;
      _challengeId = null;
      authStage = AuthStage.login;
    } finally {
      busy = false;
      _notify();
    }
  }

  @override
  Future<void> submitTotp(String code) async {
    if (busy || (lockedUntil?.isAfter(DateTime.now()) ?? false)) return;
    if (_challengePassword == null) {
      authStage = AuthStage.login;
      _notify();
      return;
    }
    await _login(_epoch, code: code);
  }

  @override
  Future<void> cancelSignIn() async {
    ++_epoch;
    _challengePassword = null;
    _challengeId = null;
    _session = null;
    _clearView();
    authStage = AuthStage.login;
    busy = false;
    message = null;
    loginFailure = null;
    _notify();
  }

  Future<void> _lock() async {
    try {
      await beforeLock?.call();
    } catch (_) {
      message = '초안 저장 상태를 확인해 주세요. 다시 로그인해야 합니다.';
    }
    ++_epoch;
    _session = null;
    _clearView();
    authStage = AuthStage.reauthenticate;
    try {
      await local.writeTokenBundle(null);
    } catch (_) {}
    _notify();
  }

  Future<void> _refresh() {
    if (_refreshing != null) return _refreshing!;
    final epoch = _epoch;
    final session = _session;
    if (session == null) {
      return Future.error(const ApiFailure('다시 로그인해 주세요', action: 'reauth'));
    }
    final work = () async {
      try {
        final refreshed = await gateway.refresh(session.refreshToken);
        await _accept(refreshed, epoch);
      } on ApiFailure catch (e) {
        if (epoch == _epoch &&
            (e.action == 'reauth' || e.status == 401 || e.status == 403)) {
          await _lock();
        }
        rethrow;
      }
    }();
    _refreshing = work;
    return work.whenComplete(() {
      if (identical(_refreshing, work)) _refreshing = null;
    });
  }

  Future<T> _authorized<T>(
    Future<T> Function(String token) action, {
    bool writing = false,
    bool retryUnauthorized = true,
  }) async {
    final epoch = _epoch;
    if (_session == null) {
      throw const ApiFailure('다시 로그인해 주세요', action: 'reauth');
    }
    if (_accessExpiresAt?.isBefore(DateTime.now()) ?? true) await _refresh();
    if (epoch != _epoch || _session == null) {
      throw const ApiFailure('로그인 상태가 바뀌었습니다');
    }
    final token = _session!.accessToken;
    try {
      final result = await action(token);
      if (epoch != _epoch) {
        throw ApiFailure(
          '다른 계정으로 전환됐습니다. 처리 결과를 확인해 주세요',
          uncertainWrite: writing,
        );
      }
      _markOnline();
      return result;
    } on ApiFailure catch (error) {
      if (epoch != _epoch) rethrow;
      if (retryUnauthorized &&
          error.status == 401 &&
          error.action != 'none' &&
          error.action != 'reauth') {
        if (_session?.accessToken == token) await _refresh();
        if (epoch != _epoch || _session == null) rethrow;
        try {
          final result = await action(
            _session!.accessToken,
          ); // 명시적 401에 한해 한 번. 결과 불명은 재전송하지 않는다.
          if (epoch != _epoch) {
            throw ApiFailure(
              '다른 계정으로 전환됐습니다. 처리 결과를 확인해 주세요',
              uncertainWrite: writing,
            );
          }
          _markOnline();
          return result;
        } on ApiFailure catch (retryError) {
          if (epoch == _epoch &&
              (retryError.status == 401 || retryError.action == 'reauth')) {
            await _lock();
          }
          if (epoch == _epoch && retryError.status == null) {
            offline = true;
            _notify();
          }
          rethrow;
        }
      }
      if (error.action == 'reauth') await _lock();
      if (error.status == null) offline = true;
      _notify();
      rethrow;
    }
  }

  @override
  Future<void> signOut() async {
    await beforeLock?.call();
    final token = _session?.accessToken;
    ++_epoch;
    _session = null;
    _refreshing = null;
    _clearView();
    _challengePassword = null;
    _challengeId = null;
    await local.writeTokenBundle(null);
    authStage = AuthStage.login;
    message = null;
    _notify();
    if (token != null) {
      try {
        await gateway.logout(token);
      } catch (_) {
        message = '기기에서는 로그아웃했습니다. 서버 세션 종료는 확인하지 못했습니다.';
        _notify();
      }
    }
  }

  @override
  Future<CctvTicket> cctvTicket(String cameraId) =>
      _authorized((token) => gateway.cctvTicket(token, cameraId));

  @override
  Future<SiteStatus> siteStatus() async {
    final epoch = _epoch;
    try {
      final result = await _authorized(gateway.siteStatus);
      if (epoch != _epoch) throw const ApiFailure('로그인 상태가 바뀌었습니다');
      siteStatusSnapshot = result;
      siteStatusForbidden = false;
      _notify();
      return result;
    } on ApiFailure catch (error) {
      if (epoch == _epoch && (error.status == 403 || error.status == 401)) {
        siteStatusSnapshot = null;
        siteStatusForbidden = error.status == 403;
        _notify();
      }
      rethrow;
    }
  }

  // N-2: 온라인 직접 실행만 허용한다. 로컬 저장·전송 큐가 없다.
  // N-4: 인증 오류에도 POST를 재실행하지 않는다. 다음 조회에서 인증을 갱신한다.
  @override
  Future<bool> ackAlert(String id) async {
    if (offline) throw const ApiFailure('연결 후 가능', action: 'none');
    if (id.trim().isEmpty) {
      throw const ApiFailure('경보 ID를 확인해 주세요', status: 400);
    }
    return _authorized(
      (token) {
        if (offline) throw const ApiFailure('연결 후 가능', action: 'none');
        return gateway.ackAlert(token, id);
      },
      writing: true,
      retryUnauthorized: false,
    );
  }

  @override
  Future<Uint8List> photoBytes(CalendarMedia item) async {
    final account = user?.id;
    if (account == null) throw const ApiFailure('다시 로그인해 주세요');
    final epoch = _epoch;
    if (item.json['local'] != true) throw const ApiFailure('원본이 기기에 없습니다');
    final bytes = await local.readBytes(account, 'outbox-file:${item.id}');
    if (epoch != _epoch) throw const ApiFailure('로그인 상태가 바뀌었습니다');
    if (bytes == null) throw const ApiFailure('원본이 기기에 없습니다');
    return bytes;
  }

  @override
  Future<CalendarMedia> publish(Uint8List bytes, Map<String, String> fields) =>
      _authorized((t) => gateway.upload(t, bytes, fields), writing: true);

  @override
  Future<String?> captureAddress({
    required double latitude,
    required double longitude,
  }) {
    if (gateway is! CaptureAddressGateway) return Future<String?>.value();
    final addressGateway = gateway as CaptureAddressGateway;
    return _authorized(
      (token) => addressGateway.captureAddress(
        token,
        latitude: latitude,
        longitude: longitude,
      ),
    );
  }

  @override
  Future<MediaComment> comment(
    String mediaId,
    String text, {
    String? clientOperationId,
  }) => _authorized(
    (t) => gateway.addComment(
      t,
      mediaId,
      text,
      clientOperationId: clientOperationId,
    ),
    writing: true,
  );
  @override
  Future<MediaComment> voiceComment(
    String mediaId,
    Uint8List audio, {
    int? durationMs,
    String? clientOperationId,
    String? siteId,
  }) => _authorized(
    (t) => gateway.voiceComment(
      t,
      mediaId,
      audio,
      durationMs: durationMs,
      clientOperationId: clientOperationId,
      siteId: siteId,
    ),
    writing: true,
  );
  @override
  bool get operationLookupAvailable => gateway is OperationLookupGateway;
  @override
  Future<Map<String, OperationCheck>> lookupOperations(List<String> ids) =>
      gateway is OperationLookupGateway
      ? _authorized(
          (token) =>
              (gateway as OperationLookupGateway).lookupOperations(token, ids),
        )
      : super.lookupOperations(ids);

  @override
  void dispose() {
    _disposed = true;
    unawaited(recorder.close().catchError((_) {}));
    ++_epoch;
    _challengePassword = null;
    super.dispose();
  }
}
