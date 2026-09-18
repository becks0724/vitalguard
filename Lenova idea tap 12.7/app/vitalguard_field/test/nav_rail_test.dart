import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/record_editor.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/record_fixture.dart';

Future<FieldCoordinator> readyController({MemoryStore? store}) async {
  final controller = FieldCoordinator(
    MockGateway(),
    store ?? MemoryStore(),
    MockSpeechInput(),
  );
  await controller.signIn('rail-user', 'mock');
  return controller;
}

Future<void> pumpShell(
  WidgetTester tester,
  FieldCoordinator controller,
  Size size,
) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(
    MaterialApp(
      theme: vgLightTheme(),
      home: FieldShell(controller: controller),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('C-03 레일 기본값은 좁은 가로에서 접히고 넓은 세로에서 펼쳐진다', (tester) async {
    final controller = await readyController();
    await pumpShell(tester, controller, const Size(900, 800));
    expect(find.byKey(const Key('rail-collapsed')), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await pumpShell(tester, controller, const Size(1200, 1800));
    expect(find.byKey(const Key('rail-expanded')), findsOneWidget);
    tester.view.physicalSize = const Size(900, 800);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('rail-collapsed')), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('세로에서는 레일이 접힌 상태로 시작한다', (tester) async {
    final controller = await readyController();
    await pumpShell(tester, controller, const Size(866, 1385));

    expect(find.byKey(const Key('rail-collapsed')), findsOneWidget);
    expect(tester.getSize(find.byKey(const Key('rail-collapsed'))).width, 80);
    expect(find.byTooltip('모의 현장'), findsOneWidget);
    expect(find.byTooltip('모의 데이터'), findsOneWidget);
    expect(find.byTooltip('모의 안전관리자'), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);

    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('접힌 레일에서도 네 목적지 전부에 도달한다', (tester) async {
    final controller = await readyController();
    await pumpShell(tester, controller, const Size(866, 1385));

    for (final label in ['현장', '경보', '기록', '전송 상태']) {
      expect(find.byTooltip(label), findsOneWidget);
    }

    await tester.tap(find.byKey(const Key('rail-destination-0')));
    await tester.pump();
    expect(find.text('현장 요약'), findsOneWidget);
    expect(find.byKey(const Key('site-open-cctv')), findsOneWidget);
    expect(find.byKey(const Key('rail-selection-dot')), findsOneWidget);

    await tester.tap(find.byKey(const Key('rail-destination-1')));
    await tester.pump();
    expect(find.text('경보 목록'), findsOneWidget);
    expect(find.byKey(const Key('alerts-scope')), findsOneWidget);
    expect(find.text('경보 0'), findsNothing);
    expect(find.byKey(const Key('rail-selection-dot')), findsOneWidget);

    await tester.tap(find.byKey(const Key('rail-destination-2')));
    await tester.pump();
    expect(find.byType(RecordHome), findsOneWidget);
    expect(find.byKey(const Key('rail-selection-dot')), findsOneWidget);

    await tester.tap(find.byKey(const Key('rail-destination-3')));
    await tester.pump();
    expect(find.byKey(const Key('outbox-list')), findsOneWidget);
    expect(find.text('이 계정에 표시할 전송 항목이 없습니다.'), findsOneWidget);
    expect(find.byKey(const Key('rail-selection-dot')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('펜 캔버스에 들어가면 레일이 자동으로 접힌다', (tester) async {
    final controller = await readyController();
    await seedPhoto(controller);
    await pumpShell(tester, controller, const Size(1385, 866));
    expect(find.byKey(const Key('rail-expanded')), findsOneWidget);

    await tester.tap(find.byKey(const Key('rail-destination-2')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('모의 현장 사진'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('주석 그리기'));
    await tester.pump();

    expect(find.byType(RecordEditor), findsOneWidget);
    expect(find.byKey(const Key('rail-collapsed')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });

  testWidgets('레일 접힘 선택을 같은 계정·기기에 기억한다', (tester) async {
    final store = MemoryStore();
    final controller = await readyController(store: store);
    await pumpShell(tester, controller, const Size(1385, 866));

    await tester.tap(find.byKey(const Key('rail-collapse-toggle')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('rail-collapsed')), findsOneWidget);
    expect(await store.read(controller.user!.id, vgRailPreferenceKey), 'true');

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        home: FieldShell(key: UniqueKey(), controller: controller),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('rail-collapsed')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });
}
