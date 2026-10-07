import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/device_services.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/record_editor.dart';
import 'package:vitalguard_field/ui/record/record_input.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';
import 'package:vitalguard_field/ui/record/record_session.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/record_fixture.dart';

void view(WidgetTester tester, Size size) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
}

Future<void> waitForCanvas(WidgetTester tester) async {
  for (
    var i = 0;
    i < 100 && find.byKey(const Key('ink-canvas')).evaluate().isEmpty;
    i++
  ) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 10)),
    );
    await tester.pump(const Duration(milliseconds: 50));
  }
  expect(find.byKey(const Key('ink-canvas')), findsOneWidget);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('C-03 로컬 사진 상세는 좁은 가로 1단, 넓은 세로 2단이다', (tester) async {
    view(tester, const Size(900, 800));
    final controller = FieldCoordinator(
      MockGateway(),
      MemoryStore(),
      MockSpeechInput(),
    );
    await controller.signIn('width-user', 'mock');
    final photo = await seedPhoto(controller);
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        home: PhotoDetail(controller: controller, photoId: photo.id),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-detail-pane')), findsNothing);
    tester.view.physicalSize = const Size(1200, 1800);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photo-detail-pane')), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('C-05 재시작하면 같은 계정의 작성 중 댓글 화면으로 복귀한다', (tester) async {
    view(tester, const Size(1385, 1000));
    final store = MemoryStore();
    final first = FieldCoordinator(MockGateway(), store, MockSpeechInput());
    await first.signIn('draft-user', 'mock');
    final media = fromOutbox(await seedPhoto(first));
    await tester.pumpWidget(
      MaterialApp(
        home: RecordInput(controller: first, media: media),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '복원할 현장 기록');
    await tester.pump();
    await tester.pumpWidget(const SizedBox.shrink());
    first.dispose();
    final resumed = FieldCoordinator(MockGateway(), store, MockSpeechInput());
    await resumed.signIn('draft-user', 'mock');
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        home: FieldShell(controller: resumed),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(RecordInput), findsOneWidget);
    expect(
      tester.widget<RecordInput>(find.byType(RecordInput)).media.id,
      media.id,
    );
    expect(
      tester.widget<TextField>(find.byType(TextField).first).controller!.text,
      '복원할 현장 기록',
    );
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(RecordInput), findsNothing);
    expect(await RecordSession(resumed).read(), isNull);
    expect(
      jsonDecode(
        (await store.read('draft-user', 'comment-draft:${media.id}:new'))!,
      )['text'],
      '복원할 현장 기록',
    );
    await tester.pumpWidget(const SizedBox.shrink());
    resumed.dispose();
  });

  testWidgets('C-05 계정이 다르면 작성하던 사진과 초안을 자동으로 열지 않는다', (tester) async {
    view(tester, const Size(1385, 1000));
    final store = MemoryStore();
    final controller = FieldCoordinator(
      MockGateway(),
      store,
      MockSpeechInput(),
    );
    await controller.signIn('owner', 'mock');
    await RecordSession(controller)
        .remember(fromOutbox(await seedPhoto(controller)));
    await controller.signIn('another-user', 'mock');
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        home: FieldShell(controller: controller),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(RecordInput), findsNothing);
    expect(find.byType(RecordEditor), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('C-05·06 재로그인한 로컬 펜 초안 복구 후 중첩 Navigator의 시스템 Back도 확인한다', (
    tester,
  ) async {
    view(tester, const Size(1385, 1000));
    final store = MemoryStore(), gateway = MockGateway();
    final controller = FieldCoordinator(gateway, store, MockSpeechInput());
    await controller.signIn('ink-owner', 'mock');
    final media = fromOutbox(await seedPhoto(controller));
    final bytes = recordPng;
    final stroke = InkStroke(InkTool.pen, 0xff000000, .004, [
      [.2, .4, 1],
      [.8, .4, 1],
    ]);
    await store.writeBytes('ink-owner', 'annotation-base:${media.id}', bytes);
    await store.write(
      'ink-owner',
      'annotation:${media.id}',
      jsonEncode({
        'origin': media.json,
        'strokes': [stroke.toJson()],
        'status': 'draft',
        'dirty': true,
      }),
    );
    await RecordSession(controller).remember(media, ink: true);
    await controller.signOut();
    controller.dispose();
    final resumed = FieldCoordinator(gateway, store, MockSpeechInput());
    await resumed.signIn('ink-owner', 'mock');
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        home: FieldShell(controller: resumed),
      ),
    );
    await waitForCanvas(tester);
    expect(
      tester
          .widget<RecordEditor>(find.byType(RecordEditor))
          .original
          .json['local'],
      isTrue,
    );
    expect(
      tester.widget<RecordEditor>(find.byType(RecordEditor)).original.id,
      media.id,
    );
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('작성 중인 주석을 보관하고 나갈까요?'), findsOneWidget);
    await tester.tap(find.text('계속 작성'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('ink-canvas')), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    resumed.dispose();
  });

  test('C-05 기기 저장소를 새로 생성해도 마지막 댓글·잉크와 계정 격리를 유지한다', () async {
    final folder = await Directory.systemTemp.createTemp('vg-drafts-');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      DeviceLocalStore.channel,
      (call) async => call.method == 'dataPath' ? folder.path : null,
    );
    addTearDown(() async {
      messenger.setMockMethodCallHandler(DeviceLocalStore.channel, null);
      await folder.delete(recursive: true);
    });
    final first = DeviceLocalStore();
    final writes = <Future<void>>[];
    for (var i = 0; i < 20; i++) {
      writes.add(first.write('a', 'comment-draft:photo:new', '댓글 $i'));
    }
    writes.add(
      first.write(
        'a',
        'annotation:photo',
        '{"strokes":[{"points":[[0.2,0.4,1.0]]}]}',
      ),
    );
    await Future.wait(writes);
    final resumed = DeviceLocalStore();
    expect(await resumed.read('a', 'comment-draft:photo:new'), '댓글 19');
    expect(
      jsonDecode((await resumed.read('a', 'annotation:photo'))!)['strokes'],
      hasLength(1),
    );
    expect(await resumed.read('b', 'comment-draft:photo:new'), isNull);
  });
}
