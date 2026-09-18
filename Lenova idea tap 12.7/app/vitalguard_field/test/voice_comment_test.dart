import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/data/mock/mock_voice_recorder.dart';
import 'package:vitalguard_field/ui/record/record_input.dart';
import 'package:vitalguard_field/ui/record/voice_comment_draft.dart';

import 'support/record_fixture.dart';

const _mediaId = 'mock-original-001';
const _draftKey = 'voice-comment-draft:$_mediaId';
final _audio = Uint8List.fromList([0, 0, 0, 24, 102, 116, 121, 112, 0xff]);

class _Gateway extends MockGateway {
  ApiFailure? failure;
  final calls =
      <
        ({
          String token,
          String mediaId,
          Uint8List audio,
          int? duration,
          String? operationId,
          String? siteId,
        })
      >[];
  @override
  Future<MediaComment> voiceComment(
    String token,
    String mediaId,
    Uint8List audio, {
    int? durationMs,
    String? clientOperationId,
    String? siteId,
  }) async {
    calls.add((
      token: token,
      mediaId: mediaId,
      audio: Uint8List.fromList(audio),
      duration: durationMs,
      operationId: clientOperationId,
      siteId: siteId,
    ));
    if (failure != null) throw failure!;
    return super.voiceComment(
      token,
      mediaId,
      audio,
      durationMs: durationMs,
      clientOperationId: clientOperationId,
      siteId: siteId,
    );
  }
}

class _FailingStore extends MemoryStore {
  bool failWrites = false;
  @override
  Future<void> writeBytes(String accountId, String key, Uint8List bytes) async {
    if (failWrites) throw StateError('저장 공간 부족');
    await super.writeBytes(accountId, key, bytes);
  }
}

class _Speech implements SpeechInput {
  final stream = StreamController<Map<String, dynamic>>.broadcast();
  Completer<bool>? availability;
  String? runId;
  int starts = 0;
  @override
  Stream<Map<String, dynamic>> get events => stream.stream;
  @override
  Future<bool> available() => availability?.future ?? Future.value(true);
  @override
  Future<void> start(String runId) async {
    this.runId = runId;
    starts++;
  }

  @override
  Future<void> stop({bool cancel = false}) async {
    if (runId != null) {
      stream.add({
        'type': cancel ? 'cancelled' : 'final',
        'runId': runId,
        'results': ['확인한 내용'],
      });
    }
    runId = null;
  }
}

class _Recorder implements VoiceRecorder {
  final stream = StreamController<Map<String, dynamic>>.broadcast();
  final files = <String, Uint8List>{};
  final deleted = <String>[];
  Completer<void>? permission;
  PlatformException? failure;
  VoiceRecording? last;
  Uint8List? previewed;
  bool active = false;
  int starts = 0, stops = 0;
  @override
  Stream<Map<String, dynamic>> get events => stream.stream;
  @override
  Future<void> start() async {
    starts++;
    if (failure != null) throw failure!;
    await permission?.future;
    active = true;
    last = VoiceRecording(
      path: '/cache/voice-$starts.m4a',
      durationMs: 7000,
      byteLength: _audio.length,
    );
    files[last!.path] = Uint8List.fromList(_audio);
  }

  @override
  Future<VoiceRecording?> stop() async {
    stops++;
    active = false;
    return last;
  }

  void autoStop() {
    active = false;
    last = VoiceRecording(
      path: last!.path,
      durationMs: maxVoiceDurationMs,
      byteLength: _audio.length,
      reason: 'maxDuration',
    );
    stream.add({'type': 'stopped', ...last!.toJson()});
  }

  @override
  Future<Uint8List> read(String path) async => Uint8List.fromList(files[path]!);
  @override
  Future<void> cancel({String? path}) async {
    final target = path ?? last?.path;
    if (target != null) {
      files.remove(target);
      deleted.add(target);
    }
    active = false;
    last = null;
  }

  @override
  Future<void> play(Uint8List audio) async {
    previewed = Uint8List.fromList(audio);
  }

  @override
  Future<void> stopPlay() async {}
  @override
  Future<void> close() async => stream.close();
}

class _Rig {
  _Rig(this.controller, this.gateway, this.store, this.speech);
  final FieldCoordinator controller;
  final _Gateway gateway;
  final MemoryStore store;
  final _Speech speech;
  Future<Map<String, dynamic>> saved() async => Map<String, dynamic>.from(
    jsonDecode((await store.read('a', _draftKey))!) as Map,
  );
}

class _RecoverableRecorder extends _Recorder
    implements RecoverableVoiceRecorder {
  final recovered = <String>[];
  String? startedKey;
  VoiceRecording? recovery;
  @override
  Future<void> startDraft(String draftKey) async {
    startedKey = draftKey;
    await start();
  }

  @override
  Future<VoiceRecording?> recoverDraft(String draftKey) async {
    recovered.add(draftKey);
    return recovery;
  }
}

Future<void> _open(WidgetTester tester, FieldCoordinator controller) =>
    tester.pumpWidget(
      MaterialApp(
        home: RecordInput(
          controller: controller,
          media: CalendarMedia({
            'id': _mediaId,
            'local': true,
            'site_id': 'site-a',
            'date_key': calendarDate(kstNow()),
          }),
        ),
      ),
    );

Future<_Rig> _mount(
  WidgetTester tester,
  VoiceRecorder recorder, {
  MemoryStore? store,
  _Gateway? gateway,
  _Speech? speech,
}) async {
  tester.view.physicalSize = const Size(1200, 2000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final local = store ?? MemoryStore(),
      api = gateway ?? _Gateway(),
      stt = speech ?? _Speech();
  final controller = FieldCoordinator(api, local, stt, recorder: recorder);
  await controller.signIn('a', 'mock');
  await restorePhoto(controller, _mediaId);
  await _open(tester, controller);
  await tester.pumpAndSettle();
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    controller.dispose();
    await stt.stream.close();
  });
  return _Rig(controller, api, local, stt);
}

Future<void> _record(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('voice-start')));
  await tester.pump();
  await tester.tap(find.byKey(const Key('voice-stop')));
  await tester.pumpAndSettle();
}

bool _enabled(WidgetTester tester, String key) =>
    tester.widget<ButtonStyleButton>(find.byKey(Key(key))).onPressed != null;

void main() {
  testWidgets('C-03 녹음 중 회전해도 같은 녹음·경과 시간·댓글을 유지한다', (tester) async {
    final recorder = _Recorder();
    final rig = await _mount(tester, recorder);
    await tester.enterText(find.byType(TextField).first, '녹음하며 작성 중');
    await tester.tap(find.byKey(const Key('voice-start')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 4));
    tester.view.physicalSize = const Size(1600, 1200);
    await tester.pump();
    expect(recorder.active, isTrue);
    expect(recorder.starts, 1);
    expect(recorder.stops, 0);
    expect(find.text('녹음 중 0:04'), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byType(TextField).first).controller!.text,
      '녹음하며 작성 중',
    );
    await tester.tap(find.byKey(const Key('voice-stop')));
    await tester.pumpAndSettle();
    expect(await rig.store.readBytes('a', '$_draftKey:audio'), _audio);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('C-05 Dart 종료 콜백 없이도 계정·사진별 네이티브 녹음을 새 화면에서 복구한다', (
    tester,
  ) async {
    final recorder = _RecoverableRecorder();
    final clip = VoiceRecording(
      path: '/files/voice-recovered.m4a',
      durationMs: 7000,
      byteLength: _audio.length,
      reason: 'interrupted',
    );
    recorder.recovery = clip;
    recorder.files[clip.path] = _audio;
    final rig = await _mount(tester, recorder);
    expect(recorder.recovered, [
      jsonEncode(['a', _mediaId]),
    ]);
    expect(find.textContaining('중단된 녹음을 복원했습니다'), findsOneWidget);
    expect(_enabled(tester, 'voice-preview'), isTrue);
    expect((await rig.saved())['clip']['path'], clip.path);
    expect(await rig.store.readBytes('a', '$_draftKey:audio'), _audio);
    expect(recorder.active, isFalse);
    expect(rig.gateway.calls, isEmpty);
  });

  test('C-05 녹음 시작과 복구 키는 계정·사진을 함께 구분한다', () async {
    final recorder = _RecoverableRecorder(), store = MemoryStore();
    final controller = FieldCoordinator(
      _Gateway(),
      store,
      _Speech(),
      recorder: recorder,
    );
    await controller.signIn('a', 'mock');
    final first = VoiceCommentDraft(controller, 'photo-1');
    await first.restore();
    await first.start();
    expect(recorder.startedKey, jsonEncode(['a', 'photo-1']));
    await first.pause();
    first.dispose();
    await controller.signIn('b', 'mock');
    final second = VoiceCommentDraft(controller, 'photo-1');
    await second.restore();
    expect(recorder.recovered.last, jsonEncode(['b', 'photo-1']));
    expect(second.clip, isNull);
    second.dispose();
    controller.dispose();
  });

  testWidgets('녹음→정지→미리듣기→음성 저장은 dependsOn 항목만 만들고 타이핑을 유지한다', (tester) async {
    final recorder = _Recorder();
    final rig = await _mount(tester, recorder);
    await tester.enterText(find.byType(TextField).first, '별도로 남길 글 댓글');
    await tester.tap(find.byKey(const Key('voice-start')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 7));
    expect(find.text('녹음 중 0:07'), findsOneWidget);
    expect(rig.gateway.calls, isEmpty);
    await tester.tap(find.byKey(const Key('voice-stop')));
    await tester.pumpAndSettle();
    expect(rig.gateway.calls, isEmpty);
    await tester.tap(find.byKey(const Key('voice-preview')));
    await tester.pump();
    expect(recorder.previewed, _audio);
    expect(_enabled(tester, 'speech-start'), isFalse);
    await tester.tap(find.byKey(const Key('voice-send')));
    await tester.pumpAndSettle();
    expect(rig.gateway.calls, isEmpty);
    final item = rig.controller.outbox.dependents(_mediaId).single;
    expect(item.kind, OutboxKind.voice);
    expect(item.phase, OutboxPhase.waiting);
    expect(item.dependsOn, _mediaId);
    expect(item.fields['audioMs'], '7000');
    expect(item.fields['siteId'], 'site-a');
    expect(
      item.fields.keys,
      isNot(
        anyOf(
          contains('commentOf'),
          contains('annotationOf'),
          contains('mediaId'),
        ),
      ),
    );
    expect(item.draftKeys, [_draftKey, '$_draftKey:audio']);
    expect(await rig.store.readBytes('a', item.bytesKey), _audio);
    expect(await rig.store.read('a', _draftKey), isNull);
    expect(recorder.files, isEmpty);
    expect(await rig.store.readBytes('a', '$_draftKey:audio'), isNull);
    expect(
      tester.widget<TextField>(find.byType(TextField).first).controller!.text,
      '별도로 남길 글 댓글',
    );
    expect(rig.speech.starts, 0);
  });

  testWidgets('새 음성 저장은 내용이 같아도 새 UUID로 같은 사진에 쌓인다', (tester) async {
    final rig = await _mount(tester, _Recorder());
    await _record(tester);
    expect(find.text('음성 저장'), findsOneWidget);
    await tester.tap(find.byKey(const Key('voice-send')));
    await tester.pumpAndSettle();
    final first = rig.controller.outbox.dependents(_mediaId).single;
    await _record(tester);
    await tester.tap(find.byKey(const Key('voice-send')));
    await tester.pumpAndSettle();
    final items = rig.controller.outbox.dependents(_mediaId);
    expect(items, hasLength(2));
    expect(items.last.id, isNot(first.id));
    expect(items.last.dependsOn, first.dependsOn);
    expect(await rig.store.readBytes('a', items.last.bytesKey), _audio);
    expect(items.every((e) => e.phase == OutboxPhase.waiting), isTrue);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('오프라인 초안은 재진입·녹음 캐시 유실 뒤에도 미리듣고 로컬 저장한다', (tester) async {
    final recorder = _Recorder();
    final rig = await _mount(tester, recorder);
    rig.controller.offline = true;
    await _record(tester);
    expect(await rig.store.readBytes('a', '$_draftKey:audio'), _audio);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
    recorder.files.clear();
    await _open(tester, rig.controller);
    await tester.pumpAndSettle();
    expect(find.textContaining('저장 전 녹음을 복원했습니다'), findsOneWidget);
    await tester.tap(find.byKey(const Key('voice-preview')));
    await tester.pump();
    expect(recorder.previewed, _audio);
    await tester.tap(find.byKey(const Key('voice-send')));
    await tester.pumpAndSettle();
    final item = rig.controller.outbox.dependents(_mediaId).single;
    expect(await rig.store.readBytes('a', item.bytesKey), _audio);
    expect(item.phase, OutboxPhase.waiting);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('STT 준비·인식 중 녹음과 녹음 권한 대기·녹음 중 STT를 모두 차단한다', (tester) async {
    final speech = _Speech()..availability = Completer<bool>();
    final recorder = _Recorder()..permission = Completer<void>();
    await _mount(tester, recorder, speech: speech);
    await tester.tap(find.byKey(const Key('speech-start')));
    await tester.pump();
    expect(_enabled(tester, 'voice-start'), isFalse);
    expect(recorder.starts, 0);
    speech.availability!.complete(true);
    await tester.pump();
    expect(speech.starts, 1);
    expect(_enabled(tester, 'voice-start'), isFalse);
    await speech.stop();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('voice-start')));
    await tester.pump();
    expect(_enabled(tester, 'speech-start'), isFalse);
    recorder.permission!.complete();
    await tester.pump();
    expect(_enabled(tester, 'speech-start'), isFalse);
    expect(speech.starts, 1);
    await tester.tap(find.byKey(const Key('voice-stop')));
    await tester.pumpAndSettle();
    expect(_enabled(tester, 'speech-start'), isTrue);
  });

  for (final whileRecording in [true, false]) {
    testWidgets(
      '${whileRecording ? '녹음 중' : '정지 후'} 취소하면 녹음기 파일 삭제와 로컬 사본 비우기를 요청한다',
      (tester) async {
        final recorder = _Recorder();
        final rig = await _mount(tester, recorder);
        if (whileRecording) {
          await tester.tap(find.byKey(const Key('voice-start')));
          await tester.pump();
        } else {
          await _record(tester);
        }
        final path = recorder.last!.path;
        await tester.tap(
          find.byKey(
            Key(whileRecording ? 'voice-cancel-recording' : 'voice-cancel'),
          ),
        );
        await tester.pumpAndSettle();
        expect(recorder.deleted, [path]);
        expect(recorder.files, isEmpty);
        expect(recorder.active, isFalse);
        expect(await rig.store.read('a', _draftKey), isNull);
        expect(await rig.store.readBytes('a', '$_draftKey:audio'), isNull);
        expect(rig.gateway.calls, isEmpty);
      },
    );
  }

  testWidgets('모의 녹음·로컬 저장은 네이티브 플러그인 없이 완료된다', (tester) async {
    final rig = await _mount(tester, MockVoiceRecorder());
    expect(find.text('모의 녹음 · 마이크를 사용하지 않습니다'), findsOneWidget);
    await _record(tester);
    await tester.tap(find.byKey(const Key('voice-send')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final item = rig.controller.outbox.dependents(_mediaId).single;
    expect(item.kind, OutboxKind.voice);
    expect(item.phase, OutboxPhase.waiting);
    expect(await rig.store.readBytes('a', item.bytesKey), isNotEmpty);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('다시 녹음은 이전 파일을 지우고 새 녹음을 시작하며 자동 전송하지 않는다', (tester) async {
    final recorder = _Recorder();
    final rig = await _mount(tester, recorder);
    await _record(tester);
    final oldPath = recorder.last!.path;
    await tester.tap(find.byKey(const Key('voice-rerecord')));
    await tester.pump();
    expect(recorder.deleted, [oldPath]);
    expect(recorder.files.containsKey(oldPath), isFalse);
    expect(recorder.active, isTrue);
    expect(recorder.starts, 2);
    expect(rig.gateway.calls, isEmpty);
    await tester.tap(find.byKey(const Key('voice-stop')));
    await tester.pumpAndSettle();
    expect((await rig.saved())['clip']['path'], recorder.last!.path);
  });

  testWidgets('음성 저장 전 초안 쓰기 실패는 항목 생성을 막고 녹음 파일과 기존 사본을 유지한다', (tester) async {
    final store = _FailingStore(), recorder = _Recorder();
    final rig = await _mount(tester, recorder, store: store);
    await _record(tester);
    store.failWrites = true;
    await tester.tap(find.byKey(const Key('voice-send')));
    await tester.pumpAndSettle();
    expect(rig.gateway.calls, isEmpty);
    expect(recorder.files, hasLength(1));
    expect(await store.readBytes('a', '$_draftKey:audio'), _audio);
    expect(find.textContaining('저장 공간 부족'), findsOneWidget);
    store.failWrites = false;
    await tester.tap(find.byKey(const Key('voice-send')));
    await tester.pumpAndSettle();
    expect(rig.gateway.calls, isEmpty);
    expect(rig.controller.outbox.dependents(_mediaId), hasLength(1));
  });

  testWidgets('재로그인 전 beforeLock도 녹음을 보존하며 같은 계정에서 복원한다', (tester) async {
    final recorder = _Recorder();
    final rig = await _mount(tester, recorder);
    await tester.tap(find.byKey(const Key('voice-start')));
    await tester.pump();
    await rig.controller.beforeLock!();
    await tester.pumpAndSettle();
    expect(recorder.active, isFalse);
    expect(recorder.files, hasLength(1));
    expect((await rig.saved())['status'], 'draft');
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
    await rig.controller.signOut();
    await rig.controller.signIn('a', 'mock');
    await _open(tester, rig.controller);
    await tester.pumpAndSettle();
    expect(find.textContaining('저장 전 녹음을 복원했습니다'), findsOneWidget);
    expect(_enabled(tester, 'voice-preview'), isTrue);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('3분 자동 정지는 알림·미리듣기 상태로 바뀌며 전송하지 않는다', (tester) async {
    final recorder = _Recorder();
    final rig = await _mount(tester, recorder);
    await tester.tap(find.byKey(const Key('voice-start')));
    await tester.pump();
    recorder.autoStop();
    await tester.pumpAndSettle();
    expect(find.text('최대 3분까지 녹음됩니다'), findsOneWidget);
    expect(find.text('녹음 3:00 · 전송 전 확인'), findsOneWidget);
    expect(_enabled(tester, 'voice-preview'), isTrue);
    expect((await rig.saved())['clip']['durationMs'], 180000);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('백그라운드 전환은 녹음을 정지·보존하고 자동 전송하지 않는다', (tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    final recorder = _Recorder();
    final rig = await _mount(tester, recorder);
    await tester.tap(find.byKey(const Key('voice-start')));
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pumpAndSettle();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(recorder.active, isFalse);
    expect(recorder.files, hasLength(1));
    expect(await rig.store.readBytes('a', '$_draftKey:audio'), _audio);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('권한 거절을 명확히 표시하고 다른 입력을 다시 사용할 수 있다', (tester) async {
    final recorder = _Recorder()
      ..failure = PlatformException(
        code: 'microphone_denied',
        message: 'denied',
      );
    await _mount(tester, recorder);
    await tester.tap(find.byKey(const Key('voice-start')));
    await tester.pumpAndSettle();
    expect(find.text('마이크 권한이 필요합니다'), findsOneWidget);
    expect(_enabled(tester, 'speech-start'), isTrue);
    expect(_enabled(tester, 'voice-start'), isTrue);
  });

  testWidgets('새 화면은 같은 계정의 저장 전 녹음만 복원하고 다른 계정 초안은 읽지 않는다', (tester) async {
    final store = MemoryStore();
    final clip = VoiceRecording(
      path: '/cache/voice-old.m4a',
      durationMs: 7000,
      byteLength: _audio.length,
    );
    await store.write(
      'other-account',
      _draftKey,
      jsonEncode({'status': 'draft', 'clip': clip.toJson()}),
    );
    final rig = await _mount(tester, _Recorder(), store: store);
    expect(find.byKey(const Key('voice-send')), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
    await store.write(
      'a',
      _draftKey,
      jsonEncode({'status': 'draft', 'clip': clip.toJson()}),
    );
    await store.writeBytes('a', '$_draftKey:audio', _audio);
    await _open(tester, rig.controller);
    await tester.pumpAndSettle();
    expect((await rig.saved())['status'], 'draft');
    expect(_enabled(tester, 'voice-send'), isTrue);
    expect(rig.gateway.calls, isEmpty);
  });
}
