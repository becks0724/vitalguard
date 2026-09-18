import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';

import 'support/record_fixture.dart';

void main() {
  for (final entry in <String?, String?>{
    '2026-09-14T02:13:04.759Z': '2026-09-14 11:13:04',
    '2026-09-14T11:13:04+09:00': '2026-09-14 11:13:04',
    '2026-09-14T11:13:04': '2026-09-14 11:13:04',
    '2026-09-14T15:13:04Z': '2026-09-15 00:13:04',
    '2026-12-31T15:00:00Z': '2027-01-01 00:00:00',
    null: null,
    '': null,
    'invalid-time': '시각 확인 불가',
  }.entries) {
    for (final showDetail in [false, true]) {
      final screen = showDetail ? '로컬 사진 상세' : '보낼 기록 카드';
      testWidgets('$screen 촬영 시각 ${entry.key} 표시와 원문 보존', (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(1400, 1000);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetPhysicalSize);
        final controller = FieldCoordinator(
          MockGateway(),
          MemoryStore(),
          MockSpeechInput(),
        );
        addTearDown(controller.dispose);
        await controller.signIn('a', 'mock');
        final photo = await controller.outbox.enqueue(
          kind: OutboxKind.photo,
          bytes: recordPng,
          fields: {
            'dateKey': '2026-09-14',
            'title': '촬영 시각 회귀 사진',
            'capturedAt': ?entry.key,
          },
          siteName: '작성 현장',
        );
        final original = Map<String, String>.of(photo.fields);
        await tester.pumpWidget(
          MaterialApp(
            home: showDetail
                ? PhotoDetail(controller: controller, photoId: photo.id)
                : RecordHome(controller: controller),
          ),
        );
        await tester.pumpAndSettle();
        final expected = entry.value ?? '촬영 시각 미기록';
        final pane = find.byKey(
          Key(showDetail ? 'photo-detail-pane' : 'record-pending-list'),
        );
        expect(pane, findsOneWidget);
        expect(
          find.descendant(of: pane, matching: find.textContaining(expected)),
          findsOneWidget,
        );
        expect(photo.fields, original);
        expect(fromOutbox(photo).captured_at, entry.key);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      });
    }
  }
}
