import 'dart:convert';

/// 기존 기기 저장 경로와 같은, 최대 80자의 base64url 디렉터리 조각이다.
List<String> localStorePathSegments(String key) {
  if (key.isEmpty) throw ArgumentError('저장 키가 필요합니다');
  final encoded = base64Url.encode(utf8.encode(key));
  return [
    for (var i = 0; i < encoded.length; i += 80)
      encoded.substring(i, i + 80 < encoded.length ? i + 80 : encoded.length),
  ];
}

/// `value` 파일을 제외한 상대 경로를 복원한다. 손상된 경로는 무시한다.
String? localStoreKeyFromSegments(List<String> segments) {
  if (segments.isEmpty ||
      segments.any(
        (part) => !RegExp(r'^[A-Za-z0-9_-]+={0,2}$').hasMatch(part),
      )) {
    return null;
  }
  try {
    final key = utf8.decode(base64Url.decode(segments.join()));
    if (key.isEmpty ||
        localStorePathSegments(key).join('/') != segments.join('/')) {
      return null;
    }
    return key;
  } on FormatException {
    return null;
  }
}
