import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/outbox/outbox_screen.dart';
import 'package:vitalguard_field/ui/record/capture_ocr.dart';
import 'package:vitalguard_field/ui/record/capture_screen.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';
import 'package:vitalguard_field/ui/record/record_session.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/record_fixture.dart';

class _Gateway extends MockGateway {
  final calls = <String>[];
  final photoIds = <String>[];
  ApiFailure? photoFailure;

  @override
  Future<CalendarMedia> upload(
    String token,
    Uint8List bytes,
    Map<String, String> fields,
  ) async {
    calls.add(fields.containsKey('annotationOf') ? 'ink' : 'photo');
    if (!fields.containsKey('annotationOf')) {
      photoIds.add(fields['clientOperationId']!);
      if (photoFailure != null) throw photoFailure!;
    }
    return super.upload(token, bytes, fields);
  }

  @override
  Future<MediaComment> addComment(
    String token,
    String mediaId,
    String body, {
    String? clientOperationId,
  }) {
    calls.add('text');
    return super.addComment(
      token,
      mediaId,
      body,
      clientOperationId: clientOperationId,
    );
  }

  @override
  Future<MediaComment> voiceComment(
    String token,
    String mediaId,
    Uint8List audio, {
    int? durationMs,
    String? clientOperationId,
    String? siteId,
  }) {
    calls.add('voice');
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

class _Rig {
  final gateway = _Gateway();
  final store = MemoryStore();
  late final field = FieldCoordinator(gateway, store, MockSpeechInput());
  Future<void> ready() => field.signIn('a', 'mock');
}

Future<_Rig> _rig() async {
  final rig = _Rig();
  await rig.ready();
  addTearDown(rig.field.dispose);
  return rig;
}

Future<List<OutboxEntry>> _attachments(_Rig rig, OutboxEntry photo) async {
  final items = <OutboxEntry>[];
  for (final kind in [OutboxKind.ink, OutboxKind.text, OutboxKind.voice]) {
    items.add(
      await rig.field.outbox.enqueue(
        kind: kind,
        bytes: Uint8List.fromList(
          utf8.encode(
            kind == OutboxKind.ink ? '{"v":1,"strokes":[]}' : '현장 메모',
          ),
        ),
        fields: {if (kind == OutboxKind.voice) 'audioMs': '7000'},
        dependsOn: photo.id,
        siteName: photo.siteName,
        draftKeys: ['test-draft:${photo.id}:${kind.name}'],
        previewBytes: kind == OutboxKind.ink ? recordPng : null,
      ),
    );
  }
  return items;
}

Future<void> _mount(WidgetTester tester, Widget home) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(1400, 1600);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(() => tester.pumpWidget(const SizedBox.shrink()));
  await tester.pumpWidget(MaterialApp(theme: vgLightTheme(), home: home));
  await tester.pumpAndSettle();
}

Future<void> _open(
  WidgetTester tester,
  FieldController field,
  OutboxEntry photo,
) async {
  await _mount(tester, RecordHome(controller: field));
  await tester.tap(find.byKey(ValueKey('record-photo-${photo.id}')));
  await tester.pumpAndSettle();
  expect(find.byType(PhotoDetail), findsOneWidget);
}

bool _enabled(WidgetTester tester, String key) =>
    tester.widget<ButtonStyleButton>(find.byKey(Key(key))).onPressed != null;

class _Capture implements CaptureLauncher {
  _Capture(this.field, this.count);
  final FieldController field;
  final int count;
  @override
  Future<bool> prepareScanner() async => true;
  @override
  Future<CaptureRunResult> capturePhoto(BuildContext context) =>
      scanDocuments();
  @override
  Future<CaptureRunResult> scanDocuments() async {
    final ids = <String>[];
    for (var i = 0; i < count; i++) {
      ids.add((await seedPhoto(field, title: '보류 사진 $i')).id);
    }
    return CaptureRunResult(
      uploaded: 0,
      failed: 0,
      queued: count,
      queuedIds: ids,
    );
  }

  @override
  Future<void> dispose() async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('사진 저장 포트는 photo/waiting과 로컬 스텁만 만들고 서버를 호출하지 않는다', () async {
    final rig = await _rig();
    final text = MlKitCaptureText();
    addTearDown(text.close);
    final port = DeviceCapturePipelinePort(
      controller: rig.field,
      native: DeviceCaptureNative(),
      text: text,
    );
    final local = await port.upload(recordPng, {
      'dateKey': '2026-09-18',
      'title': '새 사진',
    });
    final item = rig.field.outbox.entry(local.id)!;
    expect(item.kind, OutboxKind.photo);
    expect(item.phase, OutboxPhase.waiting);
    expect(local.json['local'], isTrue);
    expect(local.media_url, isNull);
    expect(await rig.field.photoBytes(local), recordPng);
    expect(rig.gateway.calls, isEmpty);
  });

  test('photoBytes는 로컬 바이트만 읽고 유실 원본이나 서버 원본은 거부한다', () async {
    final rig = await _rig();
    final photo = await seedPhoto(rig.field);
    expect(await rig.field.photoBytes(fromOutbox(photo)), recordPng);
    await rig.store.remove('a', photo.bytesKey);
    for (final media in [
      fromOutbox(photo),
      CalendarMedia({
        'id': 'server-photo',
        'media_url': 'https://mock.invalid/photo',
      }),
    ]) {
      await expectLater(
        rig.field.photoBytes(media),
        throwsA(
          isA<ApiFailure>().having((e) => e.message, 'message', '원본이 기기에 없습니다'),
        ),
      );
    }
    expect(rig.gateway.calls, isEmpty);
  });

  for (final count in [1, 2]) {
    testWidgets('촬영 $count장 저장 뒤 ${count == 1 ? '로컬 상세로 진입' : '목록에 유지'}한다', (
      tester,
    ) async {
      final rig = await _rig();
      var updates = 0;
      await _mount(
        tester,
        Scaffold(
          body: Column(
            children: [
              Expanded(child: RecordHome(controller: rig.field)),
              CaptureActionPanel(
                controller: rig.field,
                launcher: _Capture(rig.field, count),
                onUploaded: () async => updates++,
              ),
            ],
          ),
        ),
      );
      // 테스트용 촬영 패널과 RecordHome의 실제 촬영 진입을 구분한다.
      final panel = find.byWidgetPredicate(
        (w) => w is CaptureActionPanel && w.launcher is _Capture,
      );
      await tester.tap(
        find.descendant(
          of: panel,
          matching: find.byKey(const Key('photo-capture')),
        ),
      );
      await tester.pumpAndSettle();
      expect(updates, 1);
      expect(rig.field.outbox.items, hasLength(count));
      expect(
        rig.field.outbox.items.every((e) => e.phase == OutboxPhase.waiting),
        isTrue,
      );
      expect(
        find.byType(PhotoDetail),
        count == 1 ? findsOneWidget : findsNothing,
      );
      if (count == 1) {
        expect(
          tester.widget<PhotoDetail>(find.byType(PhotoDetail)).photoId,
          rig.field.outbox.items.single.id,
        );
      } else {
        expect(find.text('기기에 저장됨 · 2건 · 주석·메모를 붙인 뒤 전송'), findsOneWidget);
        expect(find.text('보류 사진 0'), findsOneWidget);
        expect(find.text('보류 사진 1'), findsOneWidget);
      }
      expect(rig.gateway.calls, isEmpty);
    });
  }

  testWidgets('기록 목록은 보류 사진만 최신순으로 표시하고 모든 서버 요청은 0회다', (tester) async {
    final requests = <String>[];
    final gateway = LiveGateway(
      transport: (_, path, _, _) async {
        requests.add(path);
        if (path == '/api/mobile/v1/session/login') {
          return const ApiReply(200, {
            'ok': true,
            'accessToken': 'test',
            'refreshToken': 'refresh',
            'accessExpiresInSec': 900,
            'refreshExpiresAt': '2099-01-01T00:00:00Z',
            'user': {'id': 'a', 'role': 'site_manager'},
          });
        }
        if (path == '/api/admin/site-info') {
          return const ApiReply(200, {'ok': true, 'siteInfo': null});
        }
        throw StateError('기록 탭에서 서버를 호출했습니다: $path');
      },
    );
    final store = MemoryStore();
    final field = FieldCoordinator(gateway, store, MockSpeechInput());
    addTearDown(field.dispose);
    addTearDown(() => gateway.client.close(force: true));
    await field.signIn('a', 'password');
    expect(field.authStage, AuthStage.ready);
    requests.clear();
    final rows = <OutboxEntry>[
      for (final (id, day, phase) in [
        ('old', 15, OutboxPhase.waiting),
        ('done', 16, OutboxPhase.completed),
        ('new', 17, OutboxPhase.failed),
      ])
        OutboxEntry(
          id: id,
          owner: 'a',
          kind: OutboxKind.photo,
          fields: {
            'clientOperationId': id,
            'title': id,
            'capturedAt': '2026-09-18T09:30:00+09:00',
          },
          siteName: '작성 현장',
          createdAt: DateTime(2026, 9, day),
          mock: false,
          phase: phase,
          completedAt: phase == OutboxPhase.completed ? DateTime.now() : null,
        ),
    ];
    await store.write(
      'a',
      outboxStorageKey,
      jsonEncode({
        'schemaVersion': 1,
        'items': rows.map((e) => e.toJson()).toList(),
      }),
    );
    for (final row in rows) {
      await store.writeBytes('a', row.bytesKey, recordPng);
    }
    await field.outbox.load();
    await field.outbox.enqueue(
      kind: OutboxKind.text,
      bytes: Uint8List.fromList(utf8.encode('보류 메모')),
      fields: {},
      siteName: '작성 현장',
      dependsOn: 'new',
    );
    field.offline = true;
    await _mount(tester, RecordHome(controller: field));
    final tiles = tester.widgetList<ListTile>(find.byType(ListTile)).toList();
    expect(tiles.map((w) => (w.title! as Text).data), ['new', 'old']);
    expect(find.byKey(const Key('record-photo-done')), findsNothing);
    expect(find.textContaining('주석 0 · 메모 1 · 음성 0'), findsOneWidget);
    expect(find.text('전송이 끝난 기록은 관제웹에서 봅니다.'), findsOneWidget);
    expect(requests, isEmpty);
  });

  testWidgets('빈 기록 목록은 안내와 촬영 진입을 표시한다', (tester) async {
    final rig = await _rig();
    await _mount(tester, RecordHome(controller: rig.field));
    expect(find.text('보낼 기록이 없습니다. 촬영한 사진은 여기 모입니다.'), findsOneWidget);
    expect(find.byKey(const Key('photo-capture')), findsOneWidget);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('상세 삭제는 확인 후 사진·주석·메모·음성과 미저장 초안까지 함께 지운다', (tester) async {
    final rig = await _rig();
    final photo = await seedPhoto(rig.field);
    final children = await _attachments(rig, photo);
    for (final child in children) {
      await rig.store.write('a', child.draftKeys.single, '초안');
    }
    await rig.store.write('a', 'comment-draft:${photo.id}:new', '미저장 초안');
    await RecordSession(rig.field).remember(fromOutbox(photo));
    await _open(tester, rig.field, photo);
    expect(find.text('현장 메모'), findsOneWidget);
    expect(find.text('음성 · 0:07'), findsOneWidget);
    await tester.tap(find.byKey(const Key('delete-bundle')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect(rig.field.outbox.items, hasLength(4));
    await tester.tap(find.byKey(const Key('delete-bundle')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '삭제'));
    await tester.pumpAndSettle();
    expect(find.byType(PhotoDetail), findsNothing);
    expect(rig.field.outbox.items, isEmpty);
    for (final item in [photo, ...children]) {
      expect(await rig.store.readBytes('a', item.bytesKey), isNull);
      for (final key in item.draftKeys) {
        expect(await rig.store.read('a', key), isNull);
      }
    }
    expect(
      await rig.store.readBytes('a', 'outbox-preview:${children.first.id}'),
      isNull,
    );
    expect(await rig.store.read('a', 'comment-draft:${photo.id}:new'), isNull);
    expect(await rig.store.read('a', RecordSession.key), isNull);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('상세에서 딸린 메모만 지우면 사진과 다른 항목은 보존한다', (tester) async {
    final rig = await _rig();
    final photo = await seedPhoto(rig.field);
    final children = await _attachments(rig, photo);
    final memo = children.singleWhere((e) => e.kind == OutboxKind.text);
    await _open(tester, rig.field, photo);
    final button = find.byKey(ValueKey('discard-${memo.id}'));
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(rig.field.outbox.entry(memo.id), isNull);
    expect(await rig.store.readBytes('a', memo.bytesKey), isNull);
    expect(rig.field.outbox.dependents(photo.id), hasLength(2));
    expect(rig.field.outbox.entry(photo.id), same(photo));
    expect(find.byType(PhotoDetail), findsOneWidget);
  });

  testWidgets('상세 전송은 묶음 완료 뒤 목록에서 사라지고 파일·초안을 정리한다', (tester) async {
    final rig = await _rig();
    final photo = await seedPhoto(rig.field);
    final children = await _attachments(rig, photo);
    await _open(tester, rig.field, photo);
    await rig.store.write('a', 'annotation:${photo.id}', '미저장 초안');
    await RecordSession(rig.field).remember(fromOutbox(photo), ink: true);
    await tester.tap(find.byKey(const Key('send-bundle')));
    await tester.pumpAndSettle();
    expect(rig.gateway.calls, ['photo', 'ink', 'text', 'voice']);
    expect(rig.field.outbox.bundleCompleted(photo.id), isTrue);
    expect(find.byType(PhotoDetail), findsNothing);
    expect(find.byKey(ValueKey('record-photo-${photo.id}')), findsNothing);
    expect(rig.field.outbox.items, hasLength(4));
    for (final item in [photo, ...children]) {
      expect(await rig.store.readBytes('a', item.bytesKey), isNull);
      expect(item.completedAt, isNotNull);
    }
    expect(await rig.store.read('a', 'annotation:${photo.id}'), isNull);
    expect(await rig.store.read('a', RecordSession.key), isNull);
  });

  for (final uncertain in [false, true]) {
    testWidgets(
      '상세 전송 ${uncertain ? '결과 불명' : '4xx 실패'}이면 머물며 딸린 항목을 보내지 않는다',
      (tester) async {
        final rig = await _rig();
        rig.gateway.photoFailure = ApiFailure(
          '사진 등록 실패',
          status: uncertain ? null : 400,
          uncertainWrite: uncertain,
        );
        final photo = await seedPhoto(rig.field);
        final children = await _attachments(rig, photo);
        await _open(tester, rig.field, photo);
        await tester.tap(find.byKey(const Key('send-bundle')));
        await tester.pumpAndSettle();
        expect(find.byType(PhotoDetail), findsOneWidget);
        expect(
          photo.phase,
          uncertain ? OutboxPhase.uncertain : OutboxPhase.failed,
        );
        expect(children.every((e) => e.phase == OutboxPhase.waiting), isTrue);
        expect(rig.gateway.calls, ['photo']);
        expect(_enabled(tester, 'send-bundle'), !uncertain);
        expect(_enabled(tester, 'delete-bundle'), !uncertain);
        if (uncertain) {
          expect(find.textContaining('전송 상태 탭에서 서버 반영 여부'), findsOneWidget);
        } else {
          rig.gateway.photoFailure = null;
          await tester.tap(find.byKey(const Key('send-bundle')));
          await tester.pumpAndSettle();
          expect(rig.gateway.photoIds, [photo.id, photo.id]);
          expect(find.byType(PhotoDetail), findsNothing);
        }
      },
    );
  }

  testWidgets('오프라인 상세의 전송은 비활성이며 주석·메모 진입은 유지한다', (tester) async {
    final rig = await _rig();
    final photo = await seedPhoto(rig.field);
    rig.field.offline = true;
    await _open(tester, rig.field, photo);
    expect(_enabled(tester, 'send-bundle'), isFalse);
    for (final label in ['주석 그리기', '메모·음성 붙이기']) {
      expect(
        tester
            .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, label))
            .onPressed,
        isNotNull,
      );
    }
    expect(find.text('오프라인입니다. 연결 후 전송할 수 있습니다.'), findsOneWidget);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('완료한 사진 ID로 직접 상세를 열면 즉시 이전 화면으로 돌아간다', (tester) async {
    final rig = await _rig();
    final photo = await seedPhoto(rig.field);
    await rig.field.outbox.sendBundle(photo.id);
    await _mount(
      tester,
      Builder(
        builder: (context) => TextButton(
          onPressed: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) =>
                    PhotoDetail(controller: rig.field, photoId: photo.id),
              ),
            );
          },
          child: const Text('완료 ID 열기'),
        ),
      ),
    );
    await tester.tap(find.text('완료 ID 열기'));
    await tester.pumpAndSettle();
    expect(find.byType(PhotoDetail), findsNothing);
    expect(find.byKey(const Key('send-bundle')), findsNothing);
  });

  for (final completed in [false, true]) {
    test('복구할 사진이 ${completed ? '완료' : '삭제'}됐으면 세션을 닫는다', () async {
      final rig = await _rig();
      final photo = await seedPhoto(rig.field);
      final session = RecordSession(rig.field);
      await session.remember(fromOutbox(photo), ink: true);
      if (completed) {
        await rig.field.outbox.sendBundle(photo.id);
      } else {
        await rig.field.outbox.discard(photo.id);
      }
      expect(await session.read(), isNull);
      expect(await rig.store.read('a', RecordSession.key), isNull);
    });
  }

  testWidgets('전송 상태는 묶음 표기·7일 안내와 오프라인 전송 비활성을 표시한다', (tester) async {
    final rig = await _rig();
    final photo = await seedPhoto(rig.field);
    await rig.field.outbox.enqueue(
      kind: OutboxKind.text,
      bytes: Uint8List.fromList(utf8.encode('메모')),
      fields: {},
      siteName: photo.siteName,
      dependsOn: photo.id,
    );
    rig.field.offline = true;
    await _mount(tester, Scaffold(body: OutboxScreen(controller: rig.field)));
    expect(find.text('원본 사진 모의 현장 사진 에 딸림'), findsOneWidget);
    expect(
      find.text('전송 완료 항목은 7일 뒤 자동으로 지워집니다. 원본은 관제웹에서 봅니다.'),
      findsOneWidget,
    );
    final buttons = tester
        .widgetList<FilledButton>(find.widgetWithText(FilledButton, '전송'))
        .toList();
    expect(buttons, hasLength(2));
    expect(buttons.every((button) => button.onPressed == null), isTrue);
    expect(rig.gateway.calls, isEmpty);
  });

  testWidgets('전송 상태는 전경 복귀 때 7일 지난 완료 항목만 정리한다', (tester) async {
    final rig = await _rig();
    final old = await seedPhoto(rig.field);
    final recent = await seedPhoto(rig.field);
    await _mount(tester, Scaffold(body: OutboxScreen(controller: rig.field)));
    old.phase = recent.phase = OutboxPhase.completed;
    old.completedAt = DateTime.now().subtract(const Duration(days: 8));
    recent.completedAt = DateTime.now().subtract(const Duration(days: 6));
    for (final state in [
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused,
      AppLifecycleState.hidden,
      AppLifecycleState.inactive,
      AppLifecycleState.resumed,
    ]) {
      tester.binding.handleAppLifecycleStateChanged(state);
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(rig.field.outbox.entry(old.id), isNull);
    expect(rig.field.outbox.entry(recent.id), same(recent));
    expect(rig.gateway.calls, isEmpty);
  });
}
