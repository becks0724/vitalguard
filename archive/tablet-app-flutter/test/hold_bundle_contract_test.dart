import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';

class _CommentGateway extends MockGateway {
  _CommentGateway(this.live);
  final LiveGateway live;

  @override
  Future<MediaComment> addComment(
    String token,
    String mediaId,
    String body, {
    String? clientOperationId,
  }) => live.addComment(
    token,
    mediaId,
    body,
    clientOperationId: clientOperationId,
  );
}

void main() {
  test('컨트롤러의 텍스트 댓글 작업 ID는 POST 본문과 응답 봉투에 왕복한다', () async {
    final gateway = LiveGateway(
      transport: (method, path, token, body) async {
        expect(method, 'POST');
        expect(path, '/api/calendar/media/comment');
        expect(token, 'mock-access-a');
        expect(body, {
          'mediaId': 'server-photo',
          'body': '한글 메모\n안전 점검',
          'clientOperationId': 'text-operation',
        });
        return const ApiReply(200, {
          'ok': true,
          'comment': {
            'id': 'comment-row',
            'media_id': 'server-photo',
            'body': '한글 메모\n안전 점검',
          },
          'clientOperationId': 'text-operation',
          'deduplicated': true,
        });
      },
    );
    addTearDown(() => gateway.client.close(force: true));
    final field = FieldCoordinator(
      _CommentGateway(gateway),
      MemoryStore(),
      MockSpeechInput(),
    );
    addTearDown(field.dispose);
    await field.signIn('a', 'mock');
    final comment = await field.comment(
      'server-photo',
      '한글 메모\n안전 점검',
      clientOperationId: 'text-operation',
    );
    expect(comment.id, 'comment-row');
    expect(comment.clientOperationId, 'text-operation');
    expect(comment.deduplicated, isTrue);
    expect(comment.json.containsKey('clientOperationId'), isFalse);
  });

  test('작업 ID 없는 기존 댓글은 본문에 선택 키를 추가하지 않는다', () async {
    final gateway = LiveGateway(
      transport: (_, _, _, body) async {
        expect(body, {'mediaId': 'photo', 'body': '기존 메모'});
        return const ApiReply(200, {
          'ok': true,
          'comment': {'id': 'comment', 'media_id': 'photo', 'body': '기존 메모'},
        });
      },
    );
    addTearDown(() => gateway.client.close(force: true));
    final result = await gateway.addComment('jwt', 'photo', '기존 메모');
    expect(result.clientOperationId, isNull);
    expect(result.deduplicated, isFalse);
  });

  test('조회 registered의 선택 id만 영수증으로 읽고 기존 무 id 응답도 허용한다', () async {
    final gateway = LiveGateway(
      transport: (_, _, _, _) async => const ApiReply(200, {
        'ok': true,
        'operations': [
          {
            'clientOperationId': 'with-id',
            'status': 'registered',
            'id': 'server-row',
          },
          {'clientOperationId': 'legacy', 'status': 'registered'},
          {'clientOperationId': 'bad-id', 'status': 'registered', 'id': 123},
          {
            'clientOperationId': 'absent',
            'status': 'not_registered',
            'id': 'ignored',
          },
        ],
      }),
    );
    addTearDown(() => gateway.client.close(force: true));
    final results = await gateway.lookupOperations('jwt', [
      'with-id',
      'legacy',
      'bad-id',
      'absent',
    ]);
    expect(results['with-id']!.receipt, {'id': 'server-row'});
    expect(results['legacy']!.presence, OperationPresence.confirmed);
    expect(results['legacy']!.receipt, isNull);
    expect(results['bad-id']!.receipt, isNull);
    expect(results['absent']!.presence, OperationPresence.absent);
    expect(results['absent']!.receipt, isNull);
  });

  test('모의 텍스트 댓글은 같은 계정·작업 ID면 같은 행을 돌려준다', () async {
    final gateway = MockGateway();
    await gateway.login('a', 'mock');
    final first = await gateway.addComment(
      'jwt',
      'photo',
      '첫 메모',
      clientOperationId: 'same',
    );
    final again = await gateway.addComment(
      'jwt',
      'photo',
      '다른 본문',
      clientOperationId: 'same',
    );
    expect(first.clientOperationId, 'same');
    expect(first.deduplicated, isFalse);
    expect(again.json, first.json);
    expect(again.deduplicated, isTrue);
    await gateway.login('b', 'mock');
    final other = await gateway.addComment(
      'jwt',
      'photo',
      'b의 메모',
      clientOperationId: 'same',
    );
    expect(other.id, isNot(first.id));
    expect(other.deduplicated, isFalse);
  });

  test('조회 가능한 모의 게이트웨이는 사진·메모·음성의 행 id와 계정 소유를 보존한다', () async {
    final gateway = MockLookupGateway();
    await gateway.login('a', 'mock');
    final photo = await gateway.upload('jwt', Uint8List.fromList([1]), {
      'dateKey': '2026-09-17',
      'clientOperationId': 'photo-op',
    });
    final text = await gateway.addComment(
      'jwt',
      photo.id,
      '메모',
      clientOperationId: 'text-op',
    );
    final voice = await gateway.voiceComment(
      'jwt',
      photo.id,
      Uint8List.fromList([1]),
      clientOperationId: 'voice-op',
    );
    final results = await gateway.lookupOperations('jwt', [
      'photo-op',
      'text-op',
      'voice-op',
      'absent',
    ]);
    expect(results['photo-op']!.receipt, {'id': photo.id});
    expect(results['text-op']!.receipt, {'id': text.id});
    expect(results['voice-op']!.receipt, {'id': voice.id});
    expect(results['absent']!.presence, OperationPresence.absent);
    await gateway.login('b', 'mock');
    expect(
      (await gateway.lookupOperations('jwt', [
        'photo-op',
      ]))['photo-op']!.presence,
      OperationPresence.absent,
    );
    expect(MockGateway(), isNot(isA<OperationLookupGateway>()));
  });
}
