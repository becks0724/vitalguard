import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';

final _photoBytes = Uint8List.fromList([0xff, 0xd8, 0xff, 7]);
final _inkBytes = Uint8List.fromList(utf8.encode('{"v":1,"strokes":[]}'));
final _voiceBytes = Uint8List.fromList([0, 0, 0, 24, 102, 116, 121, 112]);
const _body = '한글 메모\n안전난간 점검 🔎';
const _waitingMessage = '원본 사진 결과 확인 후 전송됩니다';
const _photoFields = {
  'dateKey': '2026-09-17',
  'capturedAt': '2026-09-17T01:30:00Z',
  'title': '현장 사진',
  'siteId': 'site-a',
  'ocrText': '점검 표지',
  'roadAddress': '서울시 현장',
  'latitude': '37.5',
  'longitude': '127.1',
};

typedef _Call = ({
  OutboxKind kind,
  Uint8List bytes,
  Map<String, String> fields,
});
typedef _Bundle = ({
  OutboxEntry photo,
  OutboxEntry ink,
  OutboxEntry text,
  OutboxEntry voice,
});

class _Gateway extends MockLookupGateway {
  final calls = <_Call>[];
  final failures = <OutboxKind, ApiFailure>{};
  final lostReplies = <OutboxKind>{};
  final checks = <String, OperationCheck>{};
  Completer<void>? photoGate;
  final photoStarted = Completer<void>();

  void record(OutboxKind kind, Uint8List bytes, Map<String, String> fields) {
    calls.add((
      kind: kind,
      bytes: Uint8List.fromList(bytes),
      fields: Map.of(fields),
    ));
    if (failures[kind] != null) throw failures[kind]!;
  }

  void loseReply(OutboxKind kind) {
    if (lostReplies.contains(kind)) {
      throw const ApiFailure('등록 후 응답 유실', status: 503, uncertainWrite: true);
    }
  }

  @override
  Future<CalendarMedia> upload(
    String token,
    Uint8List bytes,
    Map<String, String> fields,
  ) async {
    final kind = fields.containsKey('annotationOf')
        ? OutboxKind.ink
        : OutboxKind.photo;
    record(kind, bytes, fields);
    if (kind == OutboxKind.photo) {
      if (!photoStarted.isCompleted) photoStarted.complete();
      await photoGate?.future;
    }
    final result = await super.upload(token, bytes, fields);
    loseReply(kind);
    return result;
  }

  @override
  Future<MediaComment> addComment(
    String token,
    String mediaId,
    String body, {
    String? clientOperationId,
  }) async {
    record(OutboxKind.text, Uint8List.fromList(utf8.encode(body)), {
      'mediaId': mediaId,
      'clientOperationId': ?clientOperationId,
    });
    final result = await super.addComment(
      token,
      mediaId,
      body,
      clientOperationId: clientOperationId,
    );
    loseReply(OutboxKind.text);
    return result;
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
    record(OutboxKind.voice, audio, {
      'commentOf': mediaId,
      'clientOperationId': ?clientOperationId,
      'siteId': ?siteId,
      if (durationMs != null) 'audioMs': '$durationMs',
    });
    final result = await super.voiceComment(
      token,
      mediaId,
      audio,
      durationMs: durationMs,
      clientOperationId: clientOperationId,
      siteId: siteId,
    );
    loseReply(OutboxKind.voice);
    return result;
  }

  @override
  Future<Map<String, OperationCheck>> lookupOperations(
    String token,
    List<String> clientOperationIds,
  ) async => {
    ...await super.lookupOperations(token, clientOperationIds),
    for (final id in clientOperationIds)
      if (checks.containsKey(id)) id: checks[id]!,
  };
}

class _Store extends MemoryStore {
  final writes = <String>[];
  bool failCompletedWrites = false;
  @override
  Future<void> writeBytes(String accountId, String key, Uint8List bytes) async {
    if (failCompletedWrites && key == outboxStorageKey) {
      final data = jsonDecode(utf8.decode(bytes)) as Map;
      if ((data['items'] as List).any((e) => e['phase'] == 'completed')) {
        throw StateError('완료 원장 저장 실패');
      }
    }
    writes.add('$accountId:$key');
    await super.writeBytes(accountId, key, bytes);
  }
}

class _Rig {
  _Rig(this.field, this.gateway, this.store);
  final FieldCoordinator field;
  final _Gateway gateway;
  final _Store store;
  OutboxController get box => field.outbox;
}

Future<_Rig> _rig({
  _Gateway? gateway,
  _Store? store,
  String account = 'a',
}) async {
  final api = gateway ?? _Gateway();
  final local = store ?? _Store();
  final field = FieldCoordinator(api, local, MockSpeechInput());
  addTearDown(field.dispose);
  await field.signIn(account, 'mock');
  return _Rig(field, api, local);
}

Future<OutboxEntry> _photo(
  _Rig rig, {
  String? sourceKey,
  List<String> draftKeys = const [],
}) => rig.box.enqueue(
  kind: OutboxKind.photo,
  bytes: _photoBytes,
  fields: _photoFields,
  siteName: '현장 A',
  sourceKey: sourceKey,
  draftKeys: draftKeys,
  previewBytes: Uint8List.fromList([3, 4]),
);

Future<OutboxEntry> _child(
  _Rig rig,
  String photoId,
  OutboxKind kind, {
  Map<String, String> fields = const {},
  List<String> draftKeys = const [],
  String? sourceKey,
}) => rig.box.enqueue(
  kind: kind,
  bytes: switch (kind) {
    OutboxKind.ink => _inkBytes,
    OutboxKind.voice => _voiceBytes,
    OutboxKind.text => Uint8List.fromList(utf8.encode(_body)),
    OutboxKind.photo => _photoBytes,
  },
  fields: {if (kind == OutboxKind.voice) 'audioMs': '3400', ...fields},
  siteName: '현장 A',
  dependsOn: photoId,
  draftKeys: draftKeys,
  sourceKey: sourceKey,
  annotationDraftId: kind == OutboxKind.ink ? 'ink-revision' : null,
  previewBytes: Uint8List.fromList([5, 6]),
);

Future<_Bundle> _bundle(_Rig rig) async {
  final photo = await _photo(rig, draftKeys: ['capture-draft']);
  final ink = await _child(
    rig,
    photo.id,
    OutboxKind.ink,
    fields: {'title': '수정한 주석 제목', 'siteId': '다른 현장'},
    draftKeys: ['ink-draft'],
  );
  final text = await _child(
    rig,
    photo.id,
    OutboxKind.text,
    draftKeys: ['text-draft'],
  );
  final voice = await _child(
    rig,
    photo.id,
    OutboxKind.voice,
    draftKeys: ['voice-draft', 'voice-audio'],
  );
  return (photo: photo, ink: ink, text: text, voice: voice);
}

void main() {
  test('모델은 의존성·완료 시각·초안 키를 왕복하고 이전 v1 원장은 기본값으로 읽는다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    bundle.text.completedAt = DateTime.utc(2026, 9, 17, 2);
    final restored = OutboxEntry.fromJson(
      jsonDecode(jsonEncode(bundle.text.toJson())) as Map<String, dynamic>,
    );
    expect(restored.toJson(), bundle.text.toJson());
    expect(restored.kindLabel, '메모');
    final legacy = bundle.photo.toJson()
      ..remove('dependsOn')
      ..remove('completedAt')
      ..remove('draftKeys');
    final old = OutboxEntry.fromJson(legacy);
    expect(old.dependsOn, isNull);
    expect(old.completedAt, isNull);
    expect(old.draftKeys, isEmpty);
    final raw =
        jsonDecode((await rig.store.read('a', outboxStorageKey))!) as Map;
    expect(raw['schemaVersion'], 1);
  });

  test('fromOutbox는 로컬 사진 메타와 숫자 좌표를 만들고 다른 종류는 거절한다', () async {
    final rig = await _rig();
    final photo = await _photo(rig);
    final media = fromOutbox(photo);
    expect(media.id, photo.id);
    expect(media.date_key, _photoFields['dateKey']);
    expect(media.captured_at, _photoFields['capturedAt']);
    expect(media.title, _photoFields['title']);
    expect(media.site_id, 'site-a');
    expect(media.ocr_text, '점검 표지');
    expect(media.road_address, '서울시 현장');
    expect(media.latitude, 37.5);
    expect(media.longitude, 127.1);
    expect(media.json['local'], isTrue);
    expect(media.media_url, isNull);
    expect(media.thumbnail_url, isNull);
    final text = await _child(rig, photo.id, OutboxKind.text);
    expect(() => fromOutbox(text), throwsArgumentError);
  });

  test('딸린 항목은 부모 현장을 복사하고 같은 생성 시각에도 원장 순서로 조회한다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    final other = await _photo(rig);
    await _child(rig, other.id, OutboxKind.text);
    final stored =
        jsonDecode((await rig.store.read('a', outboxStorageKey))!) as Map;
    for (final row in stored['items'] as List) {
      if (row['dependsOn'] == bundle.photo.id) {
        row['createdAt'] = '2026-09-17T10:00:00.000';
      }
    }
    await rig.store.write('a', outboxStorageKey, jsonEncode(stored));
    final resumed = await _rig(store: rig.store);
    await resumed.box.load();
    final children = resumed.box.dependents(bundle.photo.id);
    expect(children.map((e) => e.id), [
      bundle.ink.id,
      bundle.text.id,
      bundle.voice.id,
    ]);
    expect(children.every((e) => e.siteId == 'site-a'), isTrue);
    expect(resumed.box.parentOf(children.first)?.id, bundle.photo.id);
    expect(resumed.box.parentOf(resumed.box.entry(bundle.photo.id)!), isNull);
    expect(resumed.box.bundleCompleted(bundle.photo.id), isFalse);
    expect(resumed.box.bundleCompleted('missing'), isFalse);
  });

  test('묶음은 사진→잉크→메모→음성으로 보내며 서버 참조는 요청에만 합성한다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    final originals = {
      for (final item in rig.box.items) item.id: Map.of(item.fields),
    };
    expect(rig.gateway.calls, isEmpty);
    await rig.box.sendBundle(bundle.photo.id);
    final calls = rig.gateway.calls;
    expect(calls.map((c) => c.kind), [
      OutboxKind.photo,
      OutboxKind.ink,
      OutboxKind.text,
      OutboxKind.voice,
    ]);
    final serverId = bundle.photo.receipt!['id'];
    expect(calls[1].fields['annotationOf'], serverId);
    expect(calls[1].fields['title'], '수정한 주석 제목');
    expect(calls[1].fields['dateKey'], _photoFields['dateKey']);
    expect(calls[1].fields['roadAddress'], '서울시 현장');
    expect(calls[1].fields['capturedAt'], '2026-09-17T10:30:00.000+09:00');
    expect(calls[2].fields['mediaId'], serverId);
    expect(utf8.decode(calls[2].bytes), _body);
    expect(calls[3].fields['commentOf'], serverId);
    expect(calls[3].fields['audioMs'], '3400');
    expect(calls[3].fields['siteId'], 'site-a');
    expect(calls.map((c) => c.fields['clientOperationId']), [
      bundle.photo.id,
      bundle.ink.id,
      bundle.text.id,
      bundle.voice.id,
    ]);
    for (final item in rig.box.items) {
      expect(item.fields, originals[item.id]);
      expect(item.completedAt, isNotNull);
    }
    expect(rig.box.bundleCompleted(bundle.photo.id), isTrue);
  });

  test('딸린 항목에 서버 참조 필드를 미리 넣으면 원장·파일을 만들지 않는다', () async {
    final rig = await _rig();
    final photo = await _photo(rig);
    final before = await rig.store.keys('a');
    for (final key in ['annotationOf', 'commentOf', 'mediaId']) {
      expect(
        () => _child(rig, photo.id, OutboxKind.ink, fields: {key: 'server'}),
        throwsArgumentError,
      );
    }
    expect(rig.box.items, [photo]);
    expect(await rig.store.keys('a'), before);
  });

  test('딸린 항목 직접 전송도 부모부터 묶음 순서를 따른다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    await rig.box.send(bundle.voice, retry: true);
    expect(rig.gateway.calls.map((c) => c.kind), [
      OutboxKind.photo,
      OutboxKind.ink,
      OutboxKind.text,
      OutboxKind.voice,
    ]);
    expect(rig.box.bundleCompleted(bundle.photo.id), isTrue);
  });

  test('같은 sourceKey도 다른 묶음에는 재사용하지 않고 초안 키 목록은 복사한다', () async {
    final rig = await _rig();
    final first = await _photo(rig), second = await _photo(rig);
    final drafts = ['draft-a'];
    final a = await _child(
      rig,
      first.id,
      OutboxKind.text,
      sourceKey: 'revision',
      draftKeys: drafts,
    );
    drafts.add('changed');
    final same = await _child(
      rig,
      first.id,
      OutboxKind.text,
      sourceKey: 'revision',
      draftKeys: ['draft-a'],
    );
    final b = await _child(
      rig,
      second.id,
      OutboxKind.text,
      sourceKey: 'revision',
      draftKeys: ['draft-a'],
    );
    expect(a.draftKeys, ['draft-a']);
    expect(same.id, a.id);
    expect(b.id, isNot(a.id));
  });

  test('사진 결과 불명은 딸린 전송을 막고 registered+id 조회 뒤 명시적 전송으로 이어진다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    rig.gateway.lostReplies.add(OutboxKind.photo);
    await rig.box.sendBundle(bundle.photo.id);
    expect(bundle.photo.phase, OutboxPhase.uncertain);
    for (final item in rig.box.dependents(bundle.photo.id)) {
      expect(item.phase, OutboxPhase.waiting);
      expect(item.message, _waitingMessage);
    }
    await rig.box.sendBundle(bundle.photo.id, retry: true);
    expect(rig.gateway.calls, hasLength(1));
    await rig.box.verify(bundle.photo);
    expect(bundle.photo.phase, OutboxPhase.completed);
    expect(bundle.photo.receipt!.keys, ['id']);
    expect(bundle.photo.completedAt, isNotNull);
    expect(rig.gateway.calls, hasLength(1));
    expect(await rig.store.readBytes('a', bundle.photo.bytesKey), _photoBytes);
    await rig.box.sendBundle(bundle.photo.id);
    expect(rig.gateway.calls.map((c) => c.kind), [
      OutboxKind.photo,
      OutboxKind.ink,
      OutboxKind.text,
      OutboxKind.voice,
    ]);
    expect(rig.gateway.calls[1].fields['dateKey'], _photoFields['dateKey']);
    expect(rig.box.bundleCompleted(bundle.photo.id), isTrue);
  });

  test('완료된 사진도 영수증 id가 문자열이 아니면 딸린 항목을 대기시킨다', () async {
    for (final id in <Object?>[null, 123]) {
      final rig = await _rig();
      final bundle = await _bundle(rig);
      bundle.photo.phase = OutboxPhase.completed;
      bundle.photo.receipt = {'id': id};
      await rig.box.sendBundle(bundle.photo.id);
      expect(rig.gateway.calls, isEmpty);
      expect(
        rig.box
            .dependents(bundle.photo.id)
            .every(
              (e) =>
                  e.phase == OutboxPhase.waiting &&
                  e.message == _waitingMessage,
            ),
        isTrue,
      );
      expect(
        await rig.store.readBytes('a', bundle.photo.bytesKey),
        _photoBytes,
      );
    }
  });

  test('사진 4xx 실패 뒤 딸린 항목은 대기하고 재시도는 같은 작업 ID를 쓴다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    rig.gateway.failures[OutboxKind.photo] = const ApiFailure(
      '거절',
      status: 403,
    );
    await rig.box.sendBundle(bundle.photo.id);
    expect(bundle.photo.phase, OutboxPhase.failed);
    expect(rig.gateway.calls, hasLength(1));
    expect(
      rig.box
          .dependents(bundle.photo.id)
          .every(
            (e) =>
                e.phase == OutboxPhase.waiting && e.message == _waitingMessage,
          ),
      isTrue,
    );
    rig.gateway.failures.clear();
    await rig.box.send(bundle.text, retry: true);
    expect(
      rig.gateway.calls.take(2).map((c) => c.fields['clientOperationId']),
      [bundle.photo.id, bundle.photo.id],
    );
    expect(rig.gateway.calls[1].bytes, rig.gateway.calls[0].bytes);
    expect(rig.box.bundleCompleted(bundle.photo.id), isTrue);
  });

  test('사진 재로그인 필요도 딸린 대기 상태와 문구를 원래 계정 원장에 저장한다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    rig.gateway.failures[OutboxKind.photo] = const ApiFailure(
      '로그인 만료',
      status: 401,
      action: 'reauth',
    );
    await rig.box.sendBundle(bundle.photo.id);
    expect(bundle.photo.phase, OutboxPhase.reauthenticate);
    expect(rig.field.authStage, AuthStage.reauthenticate);
    expect(rig.gateway.calls, hasLength(1));
    final saved =
        jsonDecode((await rig.store.read('a', outboxStorageKey))!) as Map;
    final children = (saved['items'] as List).where(
      (e) => e['dependsOn'] == bundle.photo.id,
    );
    expect(
      children.every(
        (e) => e['phase'] == 'waiting' && e['message'] == _waitingMessage,
      ),
      isTrue,
    );
  });

  test('잉크 실패 뒤에도 다음 메모·음성은 전송하고 마지막 재시도에서만 파일을 정리한다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    rig.gateway.failures[OutboxKind.ink] = const ApiFailure(
      '잉크 거절',
      status: 400,
    );
    await rig.box.sendBundle(bundle.photo.id);
    expect(bundle.ink.phase, OutboxPhase.failed);
    expect(bundle.text.phase, OutboxPhase.completed);
    expect(bundle.voice.phase, OutboxPhase.completed);
    expect(await rig.store.readBytes('a', bundle.photo.bytesKey), _photoBytes);
    expect(await rig.store.readBytes('a', bundle.text.bytesKey), isNotNull);
    final completedAt = bundle.photo.completedAt;
    rig.gateway.failures.clear();
    await rig.box.send(bundle.ink, retry: true);
    expect(rig.gateway.calls.last.fields['clientOperationId'], bundle.ink.id);
    expect(rig.gateway.calls, hasLength(5));
    expect(bundle.photo.completedAt, completedAt);
    expect(rig.box.bundleCompleted(bundle.photo.id), isTrue);
    expect(await rig.store.readBytes('a', bundle.photo.bytesKey), isNull);
  });

  test('멱등 메모 응답은 같은 행 영수증과 deduplicated 완료를 보존한다', () async {
    final rig = await _rig();
    final photo = await _photo(rig);
    final text = await _child(rig, photo.id, OutboxKind.text);
    await rig.box.send(photo);
    final existing = await rig.gateway.addComment(
      'jwt',
      photo.receipt!['id'] as String,
      _body,
      clientOperationId: text.id,
    );
    await rig.box.sendBundle(photo.id);
    expect(text.phase, OutboxPhase.completed);
    expect(text.receipt, existing.json);
    expect(text.deduplicated, isTrue);
  });

  test('부모가 없는 딸린 항목은 실패 문구를 저장하고 서버를 호출하지 않는다', () async {
    final rig = await _rig();
    final text = await _child(rig, 'missing', OutboxKind.text);
    await rig.box.send(text);
    expect(text.phase, OutboxPhase.failed);
    expect(text.message, '원본 사진 항목이 없습니다');
    expect(rig.gateway.calls, isEmpty);
  });

  test('전체 완료 시 파일·미리보기·모든 초안·서버 사진 캐시를 지우고 메타만 남긴다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    for (final item in rig.box.items) {
      for (final key in item.draftKeys) {
        await rig.store.write('a', key, '초안');
        await rig.store.write('b', key, '다른 계정');
      }
    }
    await rig.box.send(bundle.photo);
    final serverId = bundle.photo.receipt!['id'];
    await rig.store.write('a', 'photo:$serverId', '기존 캐시');
    await rig.store.write('a', 'published:$serverId', '기존 링크');
    await rig.store.write('a', 'photo:unrelated', '다른 사진');
    await rig.store.write('a', 'calendar:existing', '기존 달력');
    rig.store.writes.clear();
    await rig.box.sendBundle(bundle.photo.id);
    for (final item in rig.box.items) {
      expect(await rig.store.readBytes('a', item.bytesKey), isNull);
      expect(
        await rig.store.readBytes('a', 'outbox-preview:${item.id}'),
        isNull,
      );
      for (final key in item.draftKeys) {
        expect(await rig.store.readBytes('a', key), isNull);
        expect(await rig.store.read('b', key), '다른 계정');
      }
    }
    expect(await rig.store.read('a', 'photo:$serverId'), isNull);
    expect(await rig.store.read('a', 'published:$serverId'), isNull);
    expect(await rig.store.read('a', 'photo:unrelated'), '다른 사진');
    expect(await rig.store.read('a', 'calendar:existing'), '기존 달력');
    expect(
      rig.store.writes.any((key) => key.startsWith('a:published:')),
      isFalse,
    );
    final saved =
        jsonDecode((await rig.store.read('a', outboxStorageKey))!) as Map;
    expect((saved['items'] as List).length, 4);
    expect(
      (saved['items'] as List).every(
        (e) => e['completedAt'] != null && e['receipt'] != null,
      ),
      isTrue,
    );
    await rig.box.sendBundle(bundle.photo.id);
    expect(rig.gateway.calls, hasLength(4));
  });

  test('사진만 있는 묶음도 완료 즉시 파일을 정리한다', () async {
    final rig = await _rig();
    final photo = await _photo(rig);
    await rig.box.sendBundle(photo.id);
    expect(rig.box.bundleCompleted(photo.id), isTrue);
    expect(await rig.store.readBytes('a', photo.bytesKey), isNull);
    expect(rig.box.items, [photo]);
  });

  test('완료 메타 저장 실패 시 파일을 보존하고 저장 복구 후 POST 없이 정리한다', () async {
    final rig = await _rig();
    final photo = await _photo(rig);
    rig.store.failCompletedWrites = true;
    await expectLater(rig.box.sendBundle(photo.id), throwsStateError);
    expect(photo.phase, OutboxPhase.completed);
    expect(await rig.store.readBytes('a', photo.bytesKey), _photoBytes);
    rig.store.failCompletedWrites = false;
    await rig.box.sendBundle(photo.id);
    expect(rig.gateway.calls, hasLength(1));
    expect(await rig.store.readBytes('a', photo.bytesKey), isNull);
    final saved =
        jsonDecode((await rig.store.read('a', outboxStorageKey))!) as Map;
    expect((saved['items'] as List).single['phase'], 'completed');
    expect((saved['items'] as List).single['receipt'], photo.receipt);
  });

  test('마지막 메모의 결과 불명을 조회로 확인해도 POST 없이 묶음 파일을 정리한다', () async {
    final rig = await _rig();
    final photo = await _photo(rig);
    final text = await _child(rig, photo.id, OutboxKind.text);
    rig.gateway.lostReplies.add(OutboxKind.text);
    await rig.box.sendBundle(photo.id);
    expect(text.phase, OutboxPhase.uncertain);
    expect(await rig.store.readBytes('a', photo.bytesKey), isNotNull);
    await rig.box.verify(text);
    expect(text.phase, OutboxPhase.completed);
    expect(text.completedAt, isNotNull);
    expect(text.receipt!['id'], isA<String>());
    expect(rig.gateway.calls, hasLength(2));
    expect(await rig.store.readBytes('a', photo.bytesKey), isNull);
    expect(await rig.store.readBytes('a', text.bytesKey), isNull);
  });

  test('registered 조회는 기존 영수증을 덮어쓰지 않는다', () async {
    final rig = await _rig();
    final photo = await _photo(rig);
    photo.phase = OutboxPhase.uncertain;
    photo.needsVerification = true;
    photo.receipt = {'id': 'preserved', 'date_key': '2026-09-17'};
    rig.gateway.checks[photo.id] = const OperationCheck(
      OperationPresence.confirmed,
      receipt: {'id': 'replacement'},
    );
    await rig.box.verify(photo);
    expect(photo.receipt, {'id': 'preserved', 'date_key': '2026-09-17'});
    expect(photo.completedAt, isNotNull);
  });

  test('7일 초과 완료 항목만 만료시키고 6일·정확히 7일·미완료는 보존한다', () async {
    final rig = await _rig();
    final now = DateTime.utc(2026, 9, 17, 12);
    final expired = await _photo(rig, draftKeys: ['old-draft']);
    final sixDays = await _photo(rig),
        boundary = await _photo(rig),
        waiting = await _photo(rig);
    for (final item in [expired, sixDays, boundary]) {
      item.phase = OutboxPhase.completed;
    }
    expired.completedAt = now.subtract(
      const Duration(days: 7, microseconds: 1),
    );
    expired.receipt = {'id': 'expired-server'};
    sixDays.completedAt = now.subtract(const Duration(days: 6));
    boundary.completedAt = now.subtract(const Duration(days: 7));
    waiting.completedAt = now.subtract(const Duration(days: 9));
    await rig.store.write('a', 'old-draft', '초안');
    await rig.store.write('a', 'photo:expired-server', '캐시');
    await rig.store.write('a', 'published:expired-server', '링크');
    expect(await rig.box.purgeExpired(now: now), 1);
    expect(rig.box.items.map((e) => e.id), [
      sixDays.id,
      boundary.id,
      waiting.id,
    ]);
    for (final key in [
      expired.bytesKey,
      'outbox-preview:${expired.id}',
      'old-draft',
      'photo:expired-server',
      'published:expired-server',
    ]) {
      expect(await rig.store.readBytes('a', key), isNull);
    }
    expect(await rig.store.readBytes('a', sixDays.bytesKey), _photoBytes);
    expect(await rig.box.purgeExpired(now: now), 0);
  });

  test('load는 옛 완료 항목의 createdAt을 기준으로 만료를 정리한다', () async {
    final rig = await _rig();
    final old = await _photo(rig),
        recent = await _photo(rig),
        pending = await _photo(rig);
    final now = DateTime.now();
    final rows = [old, recent, pending]
        .map(
          (item) => item.toJson()
            ..['createdAt'] = now
                .subtract(const Duration(days: 8))
                .toIso8601String(),
        )
        .toList();
    rows[0]['phase'] = 'completed';
    rows[0].remove('completedAt');
    rows[1]['phase'] = 'completed';
    rows[1]['completedAt'] = now
        .subtract(const Duration(days: 6))
        .toIso8601String();
    await rig.store.write(
      'a',
      outboxStorageKey,
      jsonEncode({'schemaVersion': 1, 'items': rows}),
    );
    final resumed = await _rig(store: rig.store);
    await resumed.box.load();
    expect(resumed.box.loadError, isNull);
    expect(resumed.box.items.map((e) => e.id), [recent.id, pending.id]);
    expect(await rig.store.readBytes('a', old.bytesKey), isNull);
    expect(await rig.store.readBytes('a', pending.bytesKey), _photoBytes);
  });

  test('purgeExpired의 사용자 보관 기간을 적용한다', () async {
    final rig = await _rig();
    final photo = await _photo(rig);
    final now = DateTime.utc(2026, 9, 17);
    photo.phase = OutboxPhase.completed;
    photo.completedAt = now.subtract(const Duration(days: 2));
    expect(
      await rig.box.purgeExpired(now: now, keep: const Duration(days: 3)),
      0,
    );
    expect(
      await rig.box.purgeExpired(now: now, keep: const Duration(days: 1)),
      1,
    );
  });

  test('사진 삭제는 대기·실패 딸린 항목의 파일·초안·원장까지 함께 지운다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    final unrelated = await _photo(rig);
    bundle.ink.phase = OutboxPhase.failed;
    for (final item in [bundle.photo, bundle.ink, bundle.text, bundle.voice]) {
      for (final key in item.draftKeys) {
        await rig.store.write('a', key, '초안');
      }
    }
    await rig.box.discard(bundle.photo.id);
    expect(rig.box.items, [unrelated]);
    for (final item in [bundle.photo, bundle.ink, bundle.text, bundle.voice]) {
      for (final key in [
        item.bytesKey,
        'outbox-preview:${item.id}',
        ...item.draftKeys,
      ]) {
        expect(await rig.store.readBytes('a', key), isNull);
      }
    }
    final resumed = await _rig(store: rig.store);
    await resumed.box.load();
    expect(resumed.box.items.single.id, unrelated.id);
    expect(rig.gateway.calls, isEmpty);
  });

  test('딸린 항목 하나의 삭제는 부모와 나머지 항목을 보존한다', () async {
    final rig = await _rig();
    final bundle = await _bundle(rig);
    await rig.box.discard(bundle.text.id);
    expect(rig.box.entry(bundle.photo.id), bundle.photo);
    expect(rig.box.dependents(bundle.photo.id), [bundle.ink, bundle.voice]);
    expect(await rig.store.readBytes('a', bundle.photo.bytesKey), _photoBytes);
    expect(await rig.store.readBytes('a', bundle.text.bytesKey), isNull);
  });

  test('대기·실패 외 사진은 삭제를 거부하고 파일·원장을 보존한다', () async {
    for (final phase in [
      OutboxPhase.uncertain,
      OutboxPhase.completed,
      OutboxPhase.sending,
      OutboxPhase.reauthenticate,
    ]) {
      final rig = await _rig();
      final photo = await _photo(rig);
      photo.phase = phase;
      await expectLater(rig.box.discard(photo.id), throwsStateError);
      expect(rig.box.items, [photo]);
      expect(await rig.store.readBytes('a', photo.bytesKey), _photoBytes);
    }
  });

  test('딸린 항목 중 삭제 불가 상태가 하나라도 있으면 사진 묶음 전체를 거부한다', () async {
    for (final phase in [
      OutboxPhase.uncertain,
      OutboxPhase.completed,
      OutboxPhase.sending,
      OutboxPhase.reauthenticate,
    ]) {
      final rig = await _rig();
      final bundle = await _bundle(rig);
      bundle.voice.phase = phase;
      final before = await rig.store.keys('a');
      await expectLater(rig.box.discard(bundle.photo.id), throwsStateError);
      expect(await rig.store.keys('a'), before);
      expect(rig.box.items, hasLength(4));
    }
  });

  test('오프라인 묶음 보관은 서버 호출이나 자동 재전송 없이 대기한다', () async {
    final rig = await _rig();
    rig.field.offline = true;
    final bundle = await _bundle(rig);
    await rig.box.sendBundle(bundle.photo.id);
    expect(rig.gateway.calls, isEmpty);
    expect(rig.box.items.every((e) => e.phase == OutboxPhase.waiting), isTrue);
    rig.field.offline = false;
    expect(rig.gateway.calls, isEmpty);
    expect(
      await rig.store.readBytes('a', bundle.text.bytesKey),
      Uint8List.fromList(utf8.encode(_body)),
    );
  });

  test('같은 묶음의 동시 전송은 한 번씩만 보내고 전송 중 삭제를 거부한다', () async {
    final gateway = _Gateway()..photoGate = Completer<void>();
    final rig = await _rig(gateway: gateway);
    final bundle = await _bundle(rig);
    final first = rig.box.sendBundle(bundle.photo.id);
    await gateway.photoStarted.future;
    final second = rig.box.send(bundle.voice, retry: true);
    await expectLater(rig.box.discard(bundle.photo.id), throwsStateError);
    gateway.photoGate!.complete();
    await Future.wait([first, second]);
    expect(gateway.calls.map((c) => c.kind), [
      OutboxKind.photo,
      OutboxKind.ink,
      OutboxKind.text,
      OutboxKind.voice,
    ]);
  });

  test('기존 단독 사진 전송과 잉크 재편집 캐시는 유지한다', () async {
    final rig = await _rig();
    final photo = await _photo(rig);
    await rig.box.send(photo);
    expect(await rig.store.readBytes('a', photo.bytesKey), _photoBytes);
    final ink = await rig.box.enqueue(
      kind: OutboxKind.ink,
      bytes: _inkBytes,
      fields: {
        'dateKey': '2026-09-17',
        'annotationOf': photo.receipt!['id'] as String,
      },
      siteName: '현장 A',
      annotationDraftId: 'legacy-draft',
      previewBytes: Uint8List.fromList([9]),
    );
    await rig.box.send(ink);
    expect(
      await rig.store.read('a', 'published:${ink.receipt!['id']}'),
      'legacy-draft',
    );
    expect(await rig.store.readBytes('a', 'photo:${ink.receipt!['id']}'), [9]);
  });
}
