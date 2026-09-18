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
  }) => controller.local.write(
    owner,
    key,
    jsonEncode({
      'ink': ink,
      'media': {...media.json, 'media_url': null, 'thumbnail_url': null},
    }),
  );

  Future<Map<String, dynamic>?> read() async {
    final raw = await controller.local.read(owner, key);
    if (raw == null || raw.isEmpty) return null;
    final saved = Map<String, dynamic>.from(jsonDecode(raw) as Map);
    await controller.outbox.load();
    if (controller.outbox.loadError != null) {
      throw StateError(controller.outbox.loadError!);
    }
    final media = saved['media'] as Map;
    final photo = controller.outbox.entry(media['id'] as String?);
    if (media['local'] != true || photo == null ||
        photo.kind != OutboxKind.photo || photo.phase == OutboxPhase.completed) {
      await close();
      return null;
    }
    saved['media'] = fromOutbox(photo).json;
    return saved;
  }

  Future<void> close() => controller.local.remove(owner, key);
}

OutboxEntry requireEditablePhoto(FieldController controller, String id, String owner) {
  final photo = controller.outbox.entry(id);
  if (photo == null || photo.owner != owner || photo.kind != OutboxKind.photo ||
      photo.needsVerification || controller.outbox.isBusy(photo) ||
      (photo.phase != OutboxPhase.waiting && photo.phase != OutboxPhase.failed)) {
    throw const ApiFailure('전송 전 사진만 편집할 수 있습니다. 전송 상태를 확인해 주세요.');
  }
  return photo;
}

// 저장을 누르지 않고 보관한 초안은 딸린 항목의 draftKeys에 없을 수 있다.
// UI에서 묶음을 끝낼 때 그 사진의 재진입 지점과 미저장 초안도 정리한다.
Future<void> clearLocalRecordDrafts(FieldController controller, String photoId, {String? owner}) async {
  final account = owner ?? controller.user?.id;
  if (account == null) return;
  for (final key in [
    'annotation:$photoId',
    'annotation-base:$photoId',
    'comment-draft:$photoId:new',
    'voice-comment-draft:$photoId',
    'voice-comment-draft:$photoId:audio',
  ]) {
    await controller.local.remove(account, key);
  }
  final raw = await controller.local.read(account, RecordSession.key);
  if (raw != null && raw.isNotEmpty &&
      (jsonDecode(raw) as Map)['media']?['id'] == photoId) {
    await controller.local.remove(account, RecordSession.key);
  }
}
