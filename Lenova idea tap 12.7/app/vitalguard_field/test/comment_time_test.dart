import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/record/capture_ocr.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';

class _CommentController extends FieldCoordinator {
  _CommentController() : super(MockGateway(), MemoryStore(), MockSpeechInput());

  @override
  Future<Uint8List> photoBytes(CalendarMedia item) async =>
      throw const ApiFailure('테스트 사진 없음');
}

void main() {
  for (final entry in <String?, String>{
    '2026-09-14T02:16:07.759Z': '2026-09-14 11:16:07',
    '2026-09-14T15:16:07Z': '2026-09-15 00:16:07',
    '2026-12-31T15:00:00Z': '2027-01-01 00:00:00',
    '2026-09-14T11:16:07.759+09:00': '2026-09-14 11:16:07',
    '2026-09-14T11:16:07': '2026-09-14 11:16:07',
    null: '시각 미기록',
    '': '시각 미기록',
    'invalid-time': '시각 확인 불가',
  }.entries) {
    testWidgets('댓글 시각 ${entry.key}를 KST로 표시하고 서버 원문을 보존한다', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1400, 1000);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      final controller = _CommentController();
      addTearDown(controller.dispose);
      final comment = <String, dynamic>{
        'id': 'comment-1',
        'media_id': 'photo-1',
        'author_id': 'admin3470',
        'author_name': '김태곤',
        'body': '현장 확인 완료',
        'created_at': entry.key,
      };
      final originalComment = Map<String, dynamic>.from(comment);
      final media = CalendarMedia({
        'id': 'photo-1',
        'date_key': '2026-09-14',
        'comments': [comment],
      });

      await tester.pumpWidget(
        MaterialApp(
          home: PhotoDetail(controller: controller, media: media),
        ),
      );
      await tester.pumpAndSettle();
      final subtitle = find.text('김태곤 · ${entry.value}');
      await tester.scrollUntilVisible(
        subtitle,
        200,
        // 댓글 본문 SelectableText 가 내부에 Scrollable 을 하나 더 만든다.
        // pane 아래 Scrollable 이 둘이므로 바깥(ListView) 쪽만 집는다.
        scrollable: find
            .descendant(
              of: find.byKey(const ValueKey('photo-detail-pane')),
              matching: find.byType(Scrollable),
            )
            .first,
      );

      expect(subtitle, findsOneWidget);
      if (entry.key != null && entry.key!.isNotEmpty) {
        expect(find.text('김태곤 · ${entry.key}'), findsNothing);
      }
      if (entry.value.startsWith('202')) {
        expect(
          entry.value,
          captureKstStamp(DateTime.parse(asKstIso(entry.key!))),
          reason: '댓글과 사진 각인은 같은 KST 형식을 사용한다',
        );
      }
      expect(media.comments.single.json, originalComment);
      expect(comment, originalComment);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
