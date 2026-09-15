import 'dart:convert';

import '../../data/contracts/field_contracts.dart';

// 화면 메모리와 별개인 계정별 재진입 지점. 초안 본문/획은 기존 저장 키에 둔다.
class RecordSession {
  RecordSession(this.controller) : owner = controller.user!.id;

  static const key = 'record:active-draft';
  final FieldController controller;
  final String owner;

  Future<void> remember(
    CalendarMedia media, {
    bool ink = false,
    MediaComment? editing,
  }) => controller.local.write(
    owner,
    key,
    jsonEncode({
      'ink': ink,
      'media': {...media.json, 'media_url': null, 'thumbnail_url': null},
      'editing': editing?.json,
    }),
  );

  Future<Map<String, dynamic>?> read() async {
    final raw = await controller.local.read(owner, key);
    if (raw == null || raw.isEmpty) return null;
    return Map<String, dynamic>.from(jsonDecode(raw) as Map);
  }

  Future<void> close() => controller.local.write(owner, key, '');
}
