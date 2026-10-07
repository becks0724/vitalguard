import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/record_input.dart';

import 'support/record_fixture.dart';

class CapturingGateway extends MockGateway {
  String? sent;
  @override
  Future<MediaComment> addComment(
    String token,
    String mediaId,
    String body, {
    String? clientOperationId,
  }) async {
    sent = body;
    return super.addComment(
      token,
      mediaId,
      body,
      clientOperationId: clientOperationId,
    );
  }
}

void main() {
  testWidgets('C-03 댓글 입력은 회전·좁은 분할창에서 내용과 커서를 유지한다', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1200, 1600);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final store = MemoryStore();
    final controller = FieldCoordinator(
      MockGateway(),
      store,
      MockSpeechInput(),
    );
    await controller.signIn('a', 'mock');
    final media = fromOutbox(await seedPhoto(controller));
    await tester.pumpWidget(
      MaterialApp(
        home: RecordInput(controller: controller, media: media),
      ),
    );
    await tester.pumpAndSettle();
    const text = '배관 연결부 확인 중 — 작성하던 댓글';
    await tester.enterText(find.byType(TextField).first, text);
    final field = tester
        .widget<TextField>(find.byType(TextField).first)
        .controller!;
    field.selection = const TextSelection.collapsed(offset: 4);
    for (final size in [
      const Size(1600, 1200),
      const Size(700, 1000),
      const Size(1200, 1600),
    ]) {
      tester.view.physicalSize = size;
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField).first).controller,
        same(field),
      );
      expect(field.text, text);
      expect(field.selection.baseOffset, 4);
      expect(
        jsonDecode(
          (await store.read('a', 'comment-draft:${media.id}:new'))!,
        )['text'],
        text,
      );
      expect(tester.takeException(), isNull);
    }
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('C-05 댓글은 백그라운드 왕복과 새 프로세스의 컨트롤러에서 복원된다', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1200, 1600);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final store = MemoryStore();
    final controller = FieldCoordinator(
      MockGateway(),
      store,
      MockSpeechInput(),
    );
    await controller.signIn('a', 'mock');
    final media = fromOutbox(await seedPhoto(controller));
    await tester.pumpWidget(
      MaterialApp(
        home: RecordInput(controller: controller, media: media),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '백그라운드 전 댓글');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byType(TextField).first).controller!.text,
      '백그라운드 전 댓글',
    );
    // 마지막 수정은 lifecycle 통지나 Back 없이도 저장되어야 한다.
    await tester.enterText(find.byType(TextField).first, '프로세스 종료 직전 추가 내용');
    await tester.pump();
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
    final resumed = FieldCoordinator(MockGateway(), store, MockSpeechInput());
    await resumed.signIn('a', 'mock');
    await resumed.outbox.load();
    await tester.pumpWidget(
      MaterialApp(
        home: RecordInput(controller: resumed, media: media),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byType(TextField).first).controller!.text,
      '프로세스 종료 직전 추가 내용',
    );
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('save-record')))
          .onPressed,
      isNull,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    resumed.dispose();
  });

  testWidgets('STT 후보 선택만으로 저장하지 않고 명시적 확인을 요구한다', (tester) async {
    tester.view.physicalSize = const Size(1200, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final gateway = CapturingGateway(), store = MemoryStore();
    final c = FieldCoordinator(gateway, store, MockSpeechInput());
    await c.signIn('a', 'mock');
    final media = fromOutbox(await seedPhoto(c));
    final draftKey = 'comment-draft:${media.id}:new';
    const typedText = '사진 오른쪽 배관을 직접 확인함';
    // 구버전 초안의 칩 값은 버리되, 직접 입력과 STT 확인 계약은 유지한다.
    await store.write(
      c.user!.id,
      draftKey,
      jsonEncode({
        'text': typedText,
        'assessment': '즉시 조치 요망',
        'status': 'draft',
        'mediaId': media.id,
      }),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => RecordInput(controller: c, media: media),
              ),
            ),
            child: const Text('기록 열기'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('기록 열기'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<SelectableText>(find.byType(SelectableText)).data,
      typedText,
    );
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('save-record')))
          .onPressed,
      isNull,
    );
    await tester.tap(find.text('말로 입력'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('speech-candidate-0')), findsOneWidget);
    expect(find.text('선택한 음성 문장 · 필요하면 수정'), findsNothing);
    expect(gateway.sent, isNull);
    await tester.tap(find.byKey(const Key('speech-candidate-1')));
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('save-record')))
          .onPressed,
      isNull,
    );
    await c.beforeLock!();
    final unconfirmedDraft = jsonDecode(
      (await store.read(c.user!.id, draftKey))!,
    );
    expect(unconfirmedDraft['revision'], isA<int>());
    expect(unconfirmedDraft, containsPair('text', typedText));
    expect(Map.of(unconfirmedDraft)..remove('revision'), {
      'text': typedText,
      'status': 'draft',
      'mediaId': media.id,
    });
    expect(gateway.sent, isNull);
    await tester.tap(find.byKey(const Key('confirm-record')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('save-record')));
    await tester.pumpAndSettle();
    expect(gateway.sent, isNull);
    final memo = c.outbox.dependents(media.id).single;
    expect(memo.kind, OutboxKind.text);
    expect(memo.phase, OutboxPhase.waiting);
    expect(memo.dependsOn, media.id);
    expect(
      memo.fields.keys,
      isNot(
        anyOf(
          contains('mediaId'),
          contains('commentOf'),
          contains('annotationOf'),
        ),
      ),
    );
    expect(memo.draftKeys, [draftKey]);
    expect(
      utf8.decode((await store.readBytes(c.user!.id, memo.bytesKey))!),
      '$typedText\n가스 농도 초과 경보 발생',
    );
    expect(await store.read(c.user!.id, draftKey), isNull);
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('record-note')))
          .controller!
          .text,
      isEmpty,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    c.dispose();
  });
  testWidgets('오프라인 메모 저장은 내용이 같아도 새 항목을 만들고 입력 초안을 비운다', (tester) async {
    tester.view.physicalSize = const Size(1200, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final gateway = CapturingGateway(), store = MemoryStore();
    final field = FieldCoordinator(gateway, store, MockSpeechInput());
    await field.signIn('a', 'mock');
    final photo = await seedPhoto(field);
    field.offline = true;
    await tester.pumpWidget(
      MaterialApp(
        home: RecordInput(controller: field, media: fromOutbox(photo)),
      ),
    );
    await tester.pumpAndSettle();
    for (var i = 0; i < 2; i++) {
      await tester.enterText(find.byKey(const Key('record-note')), '배관 확인');
      await tester.pump();
      await tester.tap(find.byKey(const Key('confirm-record')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('save-record')));
      await tester.pumpAndSettle();
      expect(await store.read('a', 'comment-draft:${photo.id}:new'), isNull);
    }
    final notes = field.outbox.dependents(photo.id);
    expect(notes, hasLength(2));
    expect(notes.first.id, isNot(notes.last.id));
    for (final note in notes) {
      expect(note.kind, OutboxKind.text);
      expect(note.phase, OutboxPhase.waiting);
      expect(note.dependsOn, photo.id);
      expect(
        note.fields.keys,
        isNot(
          anyOf(
            contains('annotationOf'),
            contains('commentOf'),
            contains('mediaId'),
          ),
        ),
      );
      expect(
        utf8.decode((await store.readBytes('a', note.bytesKey))!),
        '배관 확인',
      );
    }
    expect(gateway.sent, isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    field.dispose();
  });
}
