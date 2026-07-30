import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

const _mobileApiBase =
    'https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/api/mobile/v1/session';

class MobileSession {
  const MobileSession({
    required this.accessToken,
    required this.refreshToken,
    required this.loginId,
    required this.name,
    required this.role,
    required this.employeeId,
  });

  final String accessToken;
  final String refreshToken;
  final String loginId;
  final String name;
  final String role;
  final String employeeId;

  bool get canManage => role == 'owner' || role == 'admin';

  factory MobileSession.fromResponse(Map<String, dynamic> json) {
    final user = Map<String, dynamic>.from(json['user'] as Map? ?? const {});
    final loginId = '${user['id'] ?? user['username'] ?? ''}'.trim();
    return MobileSession(
      accessToken: '${json['accessToken'] ?? json['token'] ?? ''}',
      refreshToken: '${json['refreshToken'] ?? ''}',
      loginId: loginId,
      name: '${user['name'] ?? loginId}',
      role: '${user['role'] ?? 'worker'}',
      employeeId: '${user['employeeId'] ?? user['workerId'] ?? loginId}',
    );
  }
}

class MobileAuthException implements Exception {
  const MobileAuthException(this.statusCode, this.message, {this.retryAfter, this.action});
  final int statusCode;
  final String message;
  final int? retryAfter;
  final String? action;
}

class MobileSessionStore {
  MobileSessionStore({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static const _accessKey = 'mobile_access_token';
  static const _refreshKey = 'mobile_refresh_token';
  static const _identityKey = 'mobile_identity';

  Future<MobileSession?> restore() async {
    final access = await _storage.read(key: _accessKey);
    final refresh = await _storage.read(key: _refreshKey);
    final encodedIdentity = await _storage.read(key: _identityKey);
    if (access == null || refresh == null || encodedIdentity == null) return null;
    final identity = jsonDecode(encodedIdentity) as Map<String, dynamic>;
    final session = MobileSession(
      accessToken: access,
      refreshToken: refresh,
      loginId: '${identity['loginId'] ?? ''}',
      name: '${identity['name'] ?? ''}',
      role: '${identity['role'] ?? 'worker'}',
      employeeId: '${identity['employeeId'] ?? ''}',
    );
    try {
      return await refresh(session);
    } on MobileAuthException catch (error) {
      if (error.statusCode == 401 && error.action == 'reauth') {
        await _storage.deleteAll();
        return null;
      }
      return session;
    } catch (_) {
      return session;
    }
  }

  Future<MobileSession> signIn({
    required String id,
    required String password,
  }) async {
    final response = await _client.post(
      Uri.parse('$_mobileApiBase/login'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({
        'id': id.trim(),
        'password': password,
        'platform': 'android',
        'deviceName': 'VitAlGuard Android',
      }),
    );
    final decoded = _decode(response);
    final session = MobileSession.fromResponse(decoded);
    if (session.accessToken.isEmpty || session.refreshToken.isEmpty) {
      throw const MobileAuthException(500, '로그인 세션 응답이 완전하지 않습니다.');
    }
    await _save(session);
    return session;
  }

  Future<MobileSession> refresh(MobileSession current) async {
    final response = await _client.post(
      Uri.parse('$_mobileApiBase/refresh'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({'refreshToken': current.refreshToken}),
    );
    final decoded = _decode(response);
    final renewed = MobileSession.fromResponse(decoded);
    final session = MobileSession(
      accessToken: renewed.accessToken,
      refreshToken: renewed.refreshToken.isEmpty ? current.refreshToken : renewed.refreshToken,
      loginId: renewed.loginId.isEmpty ? current.loginId : renewed.loginId,
      name: renewed.name.isEmpty ? current.name : renewed.name,
      role: renewed.role.isEmpty ? current.role : renewed.role,
      employeeId: renewed.employeeId.isEmpty ? current.employeeId : renewed.employeeId,
    );
    await _save(session);
    return session;
  }

  Future<void> signOut(MobileSession? session) async {
    if (session != null) {
      await _client.post(
        Uri.parse('$_mobileApiBase/logout'),
        headers: {'authorization': 'Bearer ${session.accessToken}'},
      ).catchError((_) => http.Response('', 0));
    }
    await _storage.deleteAll();
  }

  Future<void> _save(MobileSession session) async {
    await _storage.write(key: _accessKey, value: session.accessToken);
    await _storage.write(key: _refreshKey, value: session.refreshToken);
    await _storage.write(
      key: _identityKey,
      value: jsonEncode({
        'loginId': session.loginId,
        'name': session.name,
        'role': session.role,
        'employeeId': session.employeeId,
      }),
    );
  }

  Map<String, dynamic> _decode(http.Response response) {
    final body = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode >= 200 && response.statusCode < 300) return body;
    throw MobileAuthException(
      response.statusCode,
      '${body['error'] ?? '로그인 요청을 처리하지 못했습니다.'}',
      retryAfter: body['retryAfterSec'] is num ? (body['retryAfterSec'] as num).toInt() : null,
      action: body['action'] is String ? body['action'] as String : null,
    );
  }
}
