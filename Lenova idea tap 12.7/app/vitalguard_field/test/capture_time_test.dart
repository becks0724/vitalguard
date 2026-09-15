import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';

class _CaptureTimeController extends FieldCoordinator {
  _CaptureTimeController(CalendarMedia photo)
    : super(MockGateway(), MemoryStore(), MockSpeechInput()) {
    media = [photo];
    fetchedAt = DateTime.utc(2026, 9, 14);
  }

  // RecordHome의 첫 프레임 갱신에서도 테스트 원본을 유지한다.
  @override
  Future<void> loadPeriod(String from, String to) async {}

  @override
  Future<Uint8List> photoBytes(CalendarMedia item) async =>
      throw const ApiFailure('테스트 사진 없음');
}

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
      final screen = showDetail ? '사진 상세' : '캘린더 기록 카드';
      final sourceName = entry.key == null ? 'null' : '"${entry.key}"';
      testWidgets('$screen 촬영 시각 $sourceName 표시와 원문 보존', (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(1400, 1000);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetPhysicalSize);

        final original = <String, dynamic>{
          'id': 'capture-time-photo',
          // 목록의 초기 선택일에 배치한다. 촬영 시각의 고정 입력과는 별개다.
          'date_key': calendarDate(kstNow()),
          'title': '촬영 시각 회귀 사진',
          'captured_at': entry.key,
          'uploader': '김태곤',
        };
        final originalSnapshot = Map<String, dynamic>.from(original);
        final photo = CalendarMedia(original);
        final controller = _CaptureTimeController(photo);
        addTearDown(controller.dispose);
        // 빈 값·깨진 값은 기존 annotationFields에서 파싱 예외가 발생한다.
        // 이 테스트는 UI 표시만 바꾸며 해당 전송 계약을 변경하지 않는다.
        final fieldsBefore =
            entry.key == null || (entry.value?.startsWith('202') ?? false)
            ? annotationFields(photo)
            : null;

        await tester.pumpWidget(
          MaterialApp(
            home: showDetail
                ? PhotoDetail(controller: controller, media: photo)
                : RecordHome(controller: controller),
          ),
        );
        await tester.pumpAndSettle();

        final pane = find.byKey(
          ValueKey(showDetail ? 'photo-detail-pane' : 'record-day-pane'),
        );
        expect(pane, findsOneWidget);
        final target = find.descendant(
          of: pane,
          matching: find.text(showDetail ? '촬영 시각' : '촬영 시각 회귀 사진'),
        );
        // SelectableText 내부 Scrollable을 제외하고 바깥 ListView만 선택한다.
        final scrollable = find
            .descendant(of: pane, matching: find.byType(Scrollable))
            .first;
        expect(scrollable, findsOneWidget);
        await tester.scrollUntilVisible(target, 200, scrollable: scrollable);
        expect(target, findsOneWidget);

        final expected = entry.value ?? (showDetail ? '미기록' : '촬영 시각 미기록');
        if (showDetail) {
          final row = find
              .ancestor(of: target, matching: find.byType(Row))
              .first;
          final value = find.descendant(
            of: row,
            matching: find.byType(SelectableText),
          );
          expect(value, findsOneWidget);
          expect(tester.widget<SelectableText>(value).data, expected);
        } else {
          final tile = find.ancestor(
            of: target,
            matching: find.byType(ListTile),
          );
          expect(tile, findsOneWidget);
          expect(
            find.descendant(of: tile, matching: find.text('$expected\n김태곤')),
            findsOneWidget,
          );
        }

        expect(photo.captured_at, entry.key);
        expect(photo.json, originalSnapshot);
        expect(original, originalSnapshot);
        expect(controller.media.single, same(photo));
        if (fieldsBefore != null) {
          expect(annotationFields(photo), fieldsBefore);
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      });
    }
  }
}
