// 관제 서버 HTTP 클라이언트 — 만료된 access 토큰을 한 번 갱신하고 재요청한다
//
// 네이티브 브리지를 안 쓴다. 관리자 앱은 생체를 수집하지 않고 서버가 모아 둔 것을 보기만 하므로
// 플랫폼 채널이 필요 없다(context-notes.md "왜 네이티브 브리지를 안 쓰는가").
// 그래서 의존성도 `dart:io` 하나다 — http 패키지를 안 붙인다.
import 'dart:convert';
import 'dart:io';

/// 배포된 관제 서버. 로컬로 붙일 일이 생기면 `--dart-define=VG_BASE_URL=...` 로 덮는다.
const String kBaseUrl = String.fromEnvironment(
  'VG_BASE_URL',
  defaultValue: 'https://vitalguard-dashboard-569797426568.asia-northeast3.run.app',
);

/// 서버 응답 한 건. `ok` 는 HTTP 상태가 아니라 **본문의 `ok` 필드**다 —
/// 서버가 200 안에 실패를 담는 경우는 없지만, 401 본문에도 `action` 같은 판단 재료가 실린다.
class ApiResult {
  const ApiResult({required this.status, required this.body});

  final int status;
  final Map<String, dynamic> body;

  bool get ok => status >= 200 && status < 300 && body['ok'] == true;

  /// 서버가 준 사람이 읽는 사유. 없으면 코드값이라도 보여준다 — 빈 화면보다 낫다.
  String get message {
    final e = body['error'];
    return e is String && e.isNotEmpty ? e : '요청을 처리하지 못했습니다.';
  }

  /// 401 에 실려 오는 후속 지시. `reauth` 면 refresh 로도 회복이 안 된다는 뜻이다.
  String? get action => body['action'] is String ? body['action'] as String : null;
}

/// 토큰을 모르는 저수준 호출부. 세션 관리는 `session.dart` 가 한다.
class ApiClient {
  ApiClient({HttpClient? client}) : _client = client ?? HttpClient();

  final HttpClient _client;

  Future<ApiResult> send(
    String method,
    String path, {
    Map<String, dynamic>? json,
    String? bearer,
  }) async {
    final uri = Uri.parse('$kBaseUrl$path');
    try {
      final req = await _client.openUrl(method, uri);
      req.headers.contentType = ContentType.json;
      if (bearer != null) req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
      if (json != null) req.write(jsonEncode(json));
      final res = await req.close();
      final text = await res.transform(utf8.decoder).join();
      return ApiResult(status: res.statusCode, body: _decode(text));
    } on SocketException {
      // 망 실패와 서버 거부를 섞지 않는다 — 사용자에게 할 말이 다르다.
      return const ApiResult(status: 0, body: {'error': '서버에 연결할 수 없습니다. 통신 상태를 확인해주세요.'});
    } on HttpException {
      return const ApiResult(status: 0, body: {'error': '서버 응답을 받지 못했습니다.'});
    }
  }

  /// 본문이 JSON 이 아닐 수도 있다(프록시 오류 페이지 등). 그때 파싱 예외로 화면이 죽지 않게 한다.
  static Map<String, dynamic> _decode(String text) {
    if (text.isEmpty) return const {};
    try {
      final v = jsonDecode(text);
      return v is Map<String, dynamic> ? v : {'error': '예상과 다른 응답을 받았습니다.'};
    } on FormatException {
      return const {'error': '예상과 다른 응답을 받았습니다.'};
    }
  }

  void close() => _client.close(force: true);
}
