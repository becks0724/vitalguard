// 로그인 세션 — refresh 토큰 보관과 access 토큰 자동 갱신
//
// access 는 15분이라 **메모리에만** 둔다. refresh 는 30일짜리 자격증명이고 이 앱은 전 작업자
// 생체를 보므로, 분실 폰을 전제로 Keystore 백업 저장소에 둔다(`shared_preferences` 는 평문 XML).
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';

/// 로그인한 사람. 서버 `user` 필드 그대로다.
class AdminUser {
  const AdminUser({required this.id, this.name, required this.role});

  final String id;
  final String? name;
  final String role;

  static AdminUser? from(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    if (id is! String) return null;
    return AdminUser(
      id: id,
      name: raw['name'] is String ? raw['name'] as String : null,
      role: raw['role'] is String ? raw['role'] as String : 'worker',
    );
  }
}

/// 로그인 시도 결과. `twoFactorRequired` 는 실패가 아니라 **다음 단계 요구**다 — 화면이 둘을 달리 다룬다.
class LoginResult {
  const LoginResult({required this.ok, this.twoFactorRequired = false, this.message});

  final bool ok;
  final bool twoFactorRequired;
  final String? message;
}

class Session {
  Session({ApiClient? api, FlutterSecureStorage? storage})
      : _api = api ?? ApiClient(),
        _store = storage ?? const FlutterSecureStorage();

  static const _refreshKey = 'vg_refresh_token';

  final ApiClient _api;
  final FlutterSecureStorage _store;

  String? _accessToken;
  String? _refreshToken;
  AdminUser? user;

  bool get signedIn => _refreshToken != null;

  /// 앱 시작 시 저장된 refresh 로 세션을 되살린다. 실패하면 조용히 로그인 화면으로 보낸다 —
  /// 만료는 정상 상황이라 오류로 보여줄 것이 아니다.
  Future<bool> restore() async {
    _refreshToken = await _read(_refreshKey);
    if (_refreshToken == null) return false;
    return _refresh();
  }

  /// 1단계는 `{id,password}`, 서버가 되물으면 2단계에 `totpCode` 를 얹는다(관제웹과 같은 계약).
  Future<LoginResult> login(String id, String password, {String? totpCode}) async {
    final res = await _api.send('POST', '/api/mobile/v1/session/login', json: {
      'id': id,
      'password': password,
      if (totpCode != null && totpCode.isNotEmpty) 'totpCode': totpCode,
      'platform': 'android',
      'deviceName': 'VitAlGuard 관리자 앱',
    });
    if (res.ok) {
      await _adopt(res);
      return const LoginResult(ok: true);
    }
    // 2단계 요구는 401 로 온다 — 자격 실패와 같은 상태코드라 본문 플래그로만 가른다.
    if (res.body['twoFactorRequired'] == true) {
      return LoginResult(ok: false, twoFactorRequired: true, message: res.message);
    }
    return LoginResult(ok: false, message: res.message);
  }

  /// 관리자 조회. 401 을 만나면 **한 번만** 갱신하고 재시도한다 — 무한 재시도는 잠금을 부른다.
  Future<ApiResult> get(String path) async {
    var res = await _api.send('GET', path, bearer: _accessToken);
    if (res.status == 401 && res.action != 'reauth') {
      if (await _refresh()) {
        res = await _api.send('GET', path, bearer: _accessToken);
      }
    }
    if (res.status == 401) await signOut();
    return res;
  }

  Future<void> signOut() async {
    if (_accessToken != null) {
      // 서버 세션도 닫는다. 실패해도 진행한다 — 로컬 토큰을 지우는 것이 우선이다.
      await _api.send('POST', '/api/mobile/v1/session/logout', bearer: _accessToken);
    }
    _accessToken = null;
    _refreshToken = null;
    user = null;
    await _delete(_refreshKey);
  }

  /// refresh 는 **회전한다** — 새 토큰을 못 저장하면 다음 실행에서 재로그인이 된다.
  /// 자격이 남아 도는 것보다 낫다고 보고 그대로 둔다.
  Future<bool> _refresh() async {
    final token = _refreshToken;
    if (token == null) return false;
    final res = await _api.send('POST', '/api/mobile/v1/session/refresh', json: {
      'refreshToken': token,
    });
    if (!res.ok) {
      await signOut();
      return false;
    }
    await _adopt(res);
    return true;
  }

  Future<void> _adopt(ApiResult res) async {
    _accessToken = res.body['accessToken'] as String?;
    final next = res.body['refreshToken'] as String?;
    if (next != null) {
      _refreshToken = next;
      await _write(_refreshKey, next);
    }
    user = AdminUser.from(res.body['user']);
  }

  // 저장소 접근은 기기 상태에 따라 던진다(Keystore 초기화 등). 그때 앱이 죽지 않게 감싼다.
  Future<String?> _read(String k) async {
    try {
      return await _store.read(key: k);
    } catch (_) {
      return null;
    }
  }

  Future<void> _write(String k, String v) async {
    try {
      await _store.write(key: k, value: v);
    } catch (_) {
      // 못 저장하면 이번 실행에서만 로그인이 유지된다. 화면을 막을 일은 아니다.
    }
  }

  Future<void> _delete(String k) async {
    try {
      await _store.delete(key: k);
    } catch (_) {
      // 지우기 실패는 알릴 방법이 마땅치 않다. 서버 세션은 위에서 이미 닫았다.
    }
  }
}
