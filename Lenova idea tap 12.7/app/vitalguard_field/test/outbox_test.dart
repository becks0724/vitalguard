import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/device_services.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/ui/auth/auth_screen.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/outbox/outbox_screen.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';

class _Gateway extends MockGateway {
  final calls = <({Uint8List bytes, Map<String, String> fields})>[];
  ApiFailure? failure;
  Completer<CalendarMedia>? pending;
  bool duplicate = false;
  int refreshes = 0;
  bool expireOnce = false;
  @override
  bool get isMock => false;
  @override
  Future<MobileSession> refresh(String refreshToken) async {
    refreshes++;
    return super.refresh(refreshToken);
  }

  @override
  Future<CalendarMedia> upload(
    String token,
    Uint8List bytes,
    Map<String, String> fields,
  ) async {
    calls.add((bytes: Uint8List.fromList(bytes), fields: Map.of(fields)));
    if (expireOnce && calls.length == 1) {
      throw const ApiFailure('만료', status: 401, action: 'refresh');
    }
    if (failure != null) throw failure!;
    if (pending != null) return pending!.future;
    return CalendarMedia(
      {'id': 'receipt-${calls.length}', 'date_key': fields['dateKey']},
      clientOperationId: fields['clientOperationId'],
      deduplicated: duplicate,
    );
  }
}

class _LookupGateway extends _Gateway implements OperationLookupGateway {
  int reads = 0;
  final queries = <List<String>>[];
  Object? lookupFailure;
  Completer<Map<String, OperationCheck>>? lookupPending;
  OperationCheck result = const OperationCheck(OperationPresence.unknown);
  @override
  Future<Map<String, OperationCheck>> lookupOperations(
    String token,
    List<String> clientOperationIds,
  ) async {
    reads++;
    queries.add(List.of(clientOperationIds));
    if (lookupFailure != null) throw lookupFailure!;
    if (lookupPending != null) return lookupPending!.future;
    return {for (final id in clientOperationIds) id: result};
  }
}

// 로그인과 POST는 모의, 조회는 실제 LiveGateway 파서를 모의 transport로 검증한다.
class _LiveLookupGateway extends _Gateway implements OperationLookupGateway {
  _LiveLookupGateway(JsonTransport transport)
    : live = LiveGateway(transport: transport);
  final LiveGateway live;
  @override
  Future<Map<String, OperationCheck>> lookupOperations(
    String token,
    List<String> ids,
  ) => live.lookupOperations(token, ids);
}

class _NoSpace extends MemoryStore {
  bool fail = false;
  @override
  Future<void> writeBytes(String accountId, String key, Uint8List bytes) async {
    if (fail) throw StateError('저장 공간 부족');
    await super.writeBytes(accountId, key, bytes);
  }
}

Future<FieldCoordinator> _controller({
  FieldGateway? gateway,
  LocalStore? store,
  String account = 'a',
}) async {
  final controller = FieldCoordinator(
    gateway ?? _Gateway(),
    store ?? MemoryStore(),
    MockSpeechInput(),
  );
  await controller.signIn(account, 'mock');
  addTearDown(controller.dispose);
  return controller;
}

Future<OutboxEntry> _photo(
  FieldController controller, {
  String title = '작업 사진',
  String? sourceKey,
}) => controller.outbox.enqueue(
  kind: OutboxKind.photo,
  bytes: Uint8List.fromList([0xff, 0xd8, 0xff, 7]),
  fields: {
    'dateKey': '2026-09-14',
    'siteId': 'site-a',
    'title': title,
    'ocrText': '원래 문구',
  },
  siteName: '작성 현장 A',
  sourceKey: sourceKey,
);

Future<List<OutboxEntry>> _uncertainEntries(
  FieldController controller,
  int count,
) async {
  final result = <OutboxEntry>[];
  for (var i = 0; i < count; i++) {
    final item = await _photo(controller, title: '불명 $i');
    item.phase = OutboxPhase.uncertain;
    item.needsVerification = true;
    result.add(item);
  }
  return result;
}

Future<void> _open(
  WidgetTester tester,
  FieldController controller, {
  bool shell = false,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(1400, 1100);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(() => tester.pumpWidget(const SizedBox.shrink()));
  await tester.pumpWidget(
    MaterialApp(
      home: shell
          ? FieldShell(controller: controller)
          : Scaffold(body: OutboxScreen(controller: controller)),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('재시도는 같은 UUID·원본 바이트·메타데이터를 사용한다', () async {
    final gateway = _Gateway()
      ..failure = const ApiFailure('명시적 거절', status: 429);
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller);
    expect(
      item.id,
      matches(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ),
      ),
    );
    await controller.outbox.send(item);
    expect(item.phase, OutboxPhase.failed);
    gateway.failure = null;
    await controller.outbox.send(item, retry: true);
    expect(gateway.calls, hasLength(2));
    expect(gateway.calls.last.fields, gateway.calls.first.fields);
    expect(gateway.calls.last.bytes, gateway.calls.first.bytes);
    expect(gateway.calls.last.fields['clientOperationId'], item.id);
    expect(item.phase, OutboxPhase.completed);
  });

  test('401 자동 인증 갱신에도 같은 작업 ID와 파일을 쓴다', () async {
    final gateway = _Gateway()..expireOnce = true;
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller);
    await controller.outbox.send(item);
    expect(gateway.refreshes, 1);
    expect(gateway.calls, hasLength(2));
    expect(gateway.calls.last.fields, gateway.calls.first.fields);
    expect(gateway.calls.last.bytes, gateway.calls.first.bytes);
    expect(item.phase, OutboxPhase.completed);
  });

  test('새 컨트롤러 복원 뒤에도 UUID와 원래 파일·현장을 유지한다', () async {
    final store = MemoryStore(), gateway = _Gateway();
    final first = await _controller(gateway: gateway, store: store);
    first.offline = true;
    final item = await _photo(first);
    await first.outbox.send(item);
    expect(item.phase, OutboxPhase.waiting);
    expect(gateway.calls, isEmpty);
    final resumed = await _controller(gateway: gateway, store: store);
    await resumed.outbox.load();
    final restored = resumed.outbox.items.single;
    expect(restored.id, item.id);
    expect(restored.fields, item.fields);
    resumed.site = SiteInfo({'id': 'daily-snapshot-b', 'site_name': '현재 현장 B'});
    await resumed.outbox.send(restored, retry: true);
    expect(gateway.calls.single.fields['siteId'], 'site-a');
    expect(restored.siteName, '작성 현장 A');
    expect(gateway.calls.single.fields['clientOperationId'], item.id);
  });

  test('DeviceLocalStore 새 인스턴스도 디스크의 같은 ID·파일·현장을 복원한다', () async {
    final directory = await Directory.systemTemp.createTemp('vg-outbox-test-');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      DeviceLocalStore.channel,
      (call) async => call.method == 'dataPath' ? directory.path : null,
    );
    addTearDown(() async {
      messenger.setMockMethodCallHandler(DeviceLocalStore.channel, null);
      await directory.delete(recursive: true);
    });
    final first = await _controller(store: DeviceLocalStore());
    final item = await _photo(first);
    final resumed = await _controller(store: DeviceLocalStore());
    await resumed.outbox.load();
    final restored = resumed.outbox.items.single;
    expect(restored.id, item.id);
    expect(restored.fields, item.fields);
    expect(restored.siteName, item.siteName);
    expect(await resumed.local.readBytes('a', restored.bytesKey), [
      0xff,
      0xd8,
      0xff,
      7,
    ]);
    expect(await resumed.local.readBytes('b', restored.bytesKey), isNull);
  });

  test('보관 뒤 호출자의 배열·메타데이터 변경은 원본에 영향을 주지 않는다', () async {
    final controller = await _controller();
    final bytes = Uint8List.fromList([1, 2, 3]);
    final fields = {'dateKey': '2026-09-14', 'siteId': 'old'};
    final item = await controller.outbox.enqueue(
      kind: OutboxKind.photo,
      bytes: bytes,
      fields: fields,
      siteName: '이전 현장',
    );
    bytes[0] = 9;
    fields['siteId'] = 'new';
    expect(await controller.local.readBytes('a', item.bytesKey), [1, 2, 3]);
    expect(item.siteId, 'old');
  });

  test('새 사진·새 잉크본·새 음성은 서로 다른 UUID이고 원본 연결을 보존한다', () async {
    final controller = await _controller();
    final photo = await _photo(controller);
    final otherPhoto = await _photo(controller);
    final ink = await controller.outbox.enqueue(
      kind: OutboxKind.ink,
      bytes: Uint8List.fromList([1]),
      fields: {'dateKey': '2026-09-14', 'annotationOf': 'original'},
      siteName: 'A',
    );
    final voice = await controller.outbox.enqueue(
      kind: OutboxKind.voice,
      bytes: Uint8List.fromList([2]),
      fields: {'commentOf': 'original', 'audioMs': '7000'},
      siteName: 'A',
    );
    expect({photo.id, otherPhoto.id, ink.id, voice.id}, hasLength(4));
    expect(ink.fields['annotationOf'], 'original');
    expect(voice.fields['commentOf'], 'original');
    expect(voice.fields['audioMs'], '7000');
  });

  test('큐 링크를 저장하기 전 종료해도 동일한 편집 스냅숏은 기존 UUID를 찾는다', () async {
    final store = MemoryStore();
    final first = await _controller(store: store);
    final item = await _photo(first, sourceKey: 'stable-draft-revision');
    final resumed = await _controller(store: store);
    final recovered = await _photo(resumed, sourceKey: 'stable-draft-revision');
    expect(recovered.id, item.id);
    expect(resumed.outbox.items, hasLength(1));
  });

  test('deduplicated:true는 실패가 아니라 서버 확인된 완료다', () async {
    final gateway = _Gateway()..duplicate = true;
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller);
    await controller.outbox.send(item);
    expect(item.phase, OutboxPhase.completed);
    expect(item.statusLabel, serverCompletedLabel);
    expect(item.statusLabel, isNot(contains('실패')));
    expect(item.message, contains('이미 서버에 있습니다'));
    await controller.outbox.send(item, retry: true);
    expect(gateway.calls, hasLength(1));
  });

  test('결과 불명은 서버 재조회가 우선이며 미등록 확인 후에도 자동 POST하지 않는다', () async {
    final gateway = _LookupGateway()
      ..failure = const ApiFailure('타임아웃', uncertainWrite: true)
      ..result = const OperationCheck(OperationPresence.absent);
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller);
    await controller.outbox.send(item);
    expect(gateway.reads, 0);
    await controller.outbox.verify(item);
    expect(gateway.reads, 1);
    expect(gateway.calls, hasLength(1));
    expect(item.phase, OutboxPhase.uncertain);
    expect(item.needsVerification, isTrue);
    expect(item.message, contains('조회 시점에는 미등록'));
    await controller.outbox.send(item);
    expect(gateway.calls, hasLength(1));
    gateway.failure = null;
    await controller.outbox.send(item, retry: true);
    expect(gateway.calls.last.fields['clientOperationId'], item.id);
  });

  test('서버 재조회가 등록을 확인하면 POST 없이 완료로 바꾼다', () async {
    final gateway = _LookupGateway()
      ..failure = const ApiFailure('응답 유실', uncertainWrite: true)
      ..result = const OperationCheck(
        OperationPresence.confirmed,
        receipt: {'id': 'server-existing', 'date_key': '2026-09-14'},
      );
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller);
    await controller.outbox.send(item);
    await controller.outbox.verify(item);
    expect(item.phase, OutboxPhase.completed);
    expect(item.receipt!['id'], 'server-existing');
    expect(gateway.calls, hasLength(1));
  });

  test('재조회 결과가 불명인 작업은 재시도 호출과 재시작에서도 POST하지 않는다', () async {
    final store = MemoryStore(),
        gateway = _LookupGateway()
          ..failure = const ApiFailure('응답 유실', uncertainWrite: true);
    final first = await _controller(gateway: gateway, store: store);
    final item = await _photo(first);
    await first.outbox.send(item);
    await first.outbox.verify(item);
    await first.outbox.send(item, retry: true);
    expect(item.phase, OutboxPhase.uncertain);
    final resumed = await _controller(gateway: gateway, store: store);
    await resumed.outbox.load();
    await resumed.outbox.send(resumed.outbox.items.single, retry: true);
    expect(gateway.calls, hasLength(1));
    expect(resumed.outbox.items.single.id, item.id);
  });

  test('앱 종료 당시 sending은 같은 ID의 결과 불명으로 복원한다', () async {
    final store = MemoryStore(), gateway = _Gateway();
    final first = await _controller(gateway: gateway, store: store);
    final item = await _photo(first);
    final raw = jsonDecode((await store.read('a', outboxStorageKey))!) as Map;
    raw['items'][0]['phase'] = 'sending';
    await store.write('a', outboxStorageKey, jsonEncode(raw));
    final resumed = await _controller(gateway: gateway, store: store);
    await resumed.outbox.load();
    final recovered = resumed.outbox.items.single;
    expect(recovered.id, item.id);
    expect(recovered.phase, OutboxPhase.uncertain);
    await resumed.outbox.send(recovered, retry: true);
    expect(gateway.calls, isEmpty);
  });

  test('재로그인 필요 항목을 보관하고 다른 계정에는 표시·전송하지 않는다', () async {
    final store = MemoryStore(),
        gateway = _Gateway()
          ..failure = const ApiFailure(
            '재로그인 필요',
            status: 401,
            action: 'reauth',
          );
    final controller = await _controller(gateway: gateway, store: store);
    final item = await _photo(controller);
    await controller.outbox.send(item);
    expect(item.phase, OutboxPhase.reauthenticate);
    expect(controller.outbox.items, isEmpty);
    await controller.signIn('b', 'mock');
    await controller.outbox.load();
    expect(controller.outbox.items, isEmpty);
    await controller.outbox.send(item, retry: true);
    expect(gateway.calls, hasLength(1));
    await controller.signIn('a', 'mock');
    await controller.outbox.load();
    expect(controller.outbox.items.single.id, item.id);
    gateway.failure = null;
    await controller.outbox.send(item, retry: true);
    expect(item.phase, OutboxPhase.completed);
  });

  test('다른 계정으로 전환한 뒤 도착한 응답은 이전 계정에만 보관한다', () async {
    final gateway = _Gateway()..pending = Completer<CalendarMedia>();
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller);
    final send = controller.outbox.send(item);
    while (gateway.calls.isEmpty) {
      await Future<void>.delayed(Duration.zero);
    }
    await controller.signIn('b', 'mock');
    gateway.pending!.complete(
      CalendarMedia({'id': 'late', 'date_key': '2026-09-14'}),
    );
    await send;
    await controller.outbox.load();
    expect(controller.outbox.items, isEmpty);
    expect(item.needsVerification, isTrue);
  });

  test('로컬 영속 저장 실패는 큐 생성과 HTTP 전송을 막는다', () async {
    final store = _NoSpace(), gateway = _Gateway();
    final controller = await _controller(gateway: gateway, store: store);
    store.fail = true;
    await expectLater(_photo(controller), throwsStateError);
    expect(gateway.calls, isEmpty);
    expect(controller.outbox.items, isEmpty);
  });

  test('전송 중 연타는 하나의 POST만 허용한다', () async {
    final gateway = _Gateway()..pending = Completer<CalendarMedia>();
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller);
    final first = controller.outbox.send(item);
    await controller.outbox.send(item, retry: true);
    while (gateway.calls.isEmpty) {
      await Future<void>.delayed(Duration.zero);
    }
    gateway.pending!.complete(
      CalendarMedia({'id': 'one', 'date_key': '2026-09-14'}),
    );
    await first;
    expect(gateway.calls, hasLength(1));
  });

  test('경보 대응 확인은 오프라인에서도 전송 큐 항목을 만들지 않는다', () async {
    final controller = await _controller();
    controller.offline = true;
    await expectLater(
      controller.ackAlert('alert-1'),
      throwsA(isA<ApiFailure>()),
    );
    await controller.outbox.load();
    expect(controller.outbox.items, isEmpty);
  });

  testWidgets('로컬 저장됨과 서버 전송 완료를 분리하고 작성 현장으로 묶는다', (tester) async {
    final gateway = _Gateway()..duplicate = true;
    final controller = await _controller(gateway: gateway);
    await _photo(controller, title: '아직 보관 중');
    final done = await _photo(controller, title: '서버 확인된 사진');
    await controller.outbox.send(done);
    controller.site = SiteInfo({'site_name': '현재 현장 B'});
    await _open(tester, controller);
    expect(find.text('$localSavedLabel · 대기'), findsOneWidget);
    expect(find.text(serverCompletedLabel), findsOneWidget);
    expect(find.text('작성 당시 현장 · 작성 현장 A'), findsOneWidget);
    expect(find.textContaining('전송 실패'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('실패 응답 뒤 같은 작업 재시도 버튼으로 복구한다', (tester) async {
    final gateway = _Gateway()..pending = Completer<CalendarMedia>();
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller);
    await _open(tester, controller);
    await tester.tap(find.text('전송'));
    await tester.pump();
    expect(find.text('로컬 저장됨 · 처리 중'), findsOneWidget);
    gateway.pending!.completeError(const ApiFailure('서버 거절', status: 400));
    await tester.pumpAndSettle();
    expect(find.text('로컬 저장됨 · 전송 실패'), findsOneWidget);
    gateway.pending = null;
    await tester.tap(find.text('같은 작업 재시도'));
    await tester.pumpAndSettle();
    expect(find.text(serverCompletedLabel), findsOneWidget);
    expect(gateway.calls.last.fields['clientOperationId'], item.id);
  });

  testWidgets('모의 완료는 실제 서버로 보내지 않았다는 문구를 표시한다', (tester) async {
    final controller = await _controller(gateway: MockGateway());
    final item = await _photo(controller);
    await controller.outbox.send(item);
    await _open(tester, controller);
    expect(find.text(mockCompletedLabel), findsOneWidget);
    expect(find.text(serverCompletedLabel), findsNothing);
  });

  testWidgets('재로그인 필요 필터와 현장 필터는 현재 계정의 항목만 표시한다', (tester) async {
    final gateway = _Gateway()
      ..failure = const ApiFailure('세션 만료', status: 401, action: 'reauth');
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller, title: 'A 계정 비공개');
    await controller.outbox.send(item);
    await controller.signIn('a', 'mock');
    await _open(tester, controller);
    expect(find.text('로컬 저장됨 · 재로그인 필요'), findsOneWidget);
    await tester.tap(find.text('재로그인 필요 1'));
    await tester.pumpAndSettle();
    expect(find.text('사진 · A 계정 비공개'), findsOneWidget);
    await controller.signIn('b', 'mock');
    await tester.pumpAndSettle();
    expect(find.text('사진 · A 계정 비공개'), findsNothing);
    expect(find.textContaining('작업 ID ${item.id}'), findsNothing);
    expect(find.text('작성 당시 현장 · 작성 현장 A'), findsNothing);
  });

  testWidgets('결과 불명 항목은 재조회 뒤에도 사용자 실행 전 재전송하지 않는다', (tester) async {
    final gateway = _LookupGateway()
      ..failure = const ApiFailure('응답 유실', uncertainWrite: true);
    final controller = await _controller(gateway: gateway);
    final item = await _photo(controller);
    await controller.outbox.send(item);
    await _open(tester, controller);
    expect(find.text('로컬 저장됨 · 서버 결과 불명'), findsOneWidget);
    expect(find.text('같은 작업 재시도'), findsNothing);
    await tester.scrollUntilVisible(
      find.text('서버 상태 재조회'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    gateway.result = const OperationCheck(OperationPresence.absent);
    await tester.tap(find.text('서버 상태 재조회'));
    await tester.pumpAndSettle();
    expect(gateway.calls, hasLength(1));
    expect(find.text('로컬 저장됨 · 서버 결과 불명'), findsOneWidget);
    expect(find.text('같은 작업 재시도'), findsOneWidget);
    gateway.failure = null;
    await tester.scrollUntilVisible(
      find.text('같은 작업 재시도'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('같은 작업 재시도'));
    await tester.pumpAndSettle();
    expect(gateway.calls, hasLength(2));
    expect(gateway.calls.last.fields, gateway.calls.first.fields);
    expect(gateway.calls.last.bytes, gateway.calls.first.bytes);
    expect(gateway.calls.last.fields['clientOperationId'], item.id);
    expect(find.text(serverCompletedLabel), findsOneWidget);
  });

  testWidgets('전송 상태 탭 destination 3에서 실제 목록이 열린다', (tester) async {
    final controller = await _controller(gateway: MockGateway());
    await _photo(controller);
    await _open(tester, controller, shell: true);
    await tester.tap(find.byTooltip('전송 상태'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('outbox-list')), findsOneWidget);
    expect(find.text('$localSavedLabel · 대기'), findsOneWidget);
    expect(find.textContaining('다음 슬라이스'), findsNothing);
  });

  test('결과 불명만 조회하고 101개는 순서대로 50·50·1개 GET으로 분할한다', () async {
    final queries = <List<String>>[];
    final gateway = _LiveLookupGateway((method, path, token, body) async {
      expect(method, 'GET');
      expect(token, 'mock-access-a');
      expect(body, isNull);
      final ids = Uri.parse(path).queryParametersAll['clientOperationId']!;
      queries.add(ids);
      expect(ids.length, lessThanOrEqualTo(50));
      return ApiReply(200, {
        'ok': true,
        'operations': [
          for (final id in ids)
            {'clientOperationId': id, 'status': 'registered'},
        ],
      });
    });
    addTearDown(() => gateway.live.client.close(force: true));
    final controller = await _controller(gateway: gateway);
    final uncertain = await _uncertainEntries(controller, 101);
    for (final phase in OutboxPhase.values.where(
      (p) => p != OutboxPhase.uncertain,
    )) {
      final item = await _photo(controller, title: phase.name);
      item.phase = phase;
      // 손상된 플래그가 있어도 결과 불명 상태가 아니면 조회하지 않는다.
      item.needsVerification = true;
      await controller.outbox.verify(item);
    }
    await controller.outbox.verifyUncertain();
    expect(queries.map((q) => q.length), [50, 50, 1]);
    expect(queries.expand((q) => q), uncertain.map((e) => e.id));
    expect(uncertain.every((e) => e.phase == OutboxPhase.completed), isTrue);
    expect(
      uncertain.every((e) => e.statusLabel == serverCompletedLabel),
      isTrue,
    );
    for (final item in uncertain) {
      await controller.outbox.send(item, retry: true);
    }
    expect(gateway.calls, isEmpty);
  });

  for (final failure in <Object>[
    const ApiReply(503, {'ok': false}),
    const SocketException('synthetic'),
    TimeoutException('synthetic'),
  ]) {
    test(
      '실제 조회 파서의 ${failure.runtimeType} 이후 불명·파일·ID를 보존하고 재전송을 잠근다',
      () async {
        var absent = true;
        final gateway = _LiveLookupGateway((_, path, _, _) async {
          if (!absent) {
            if (failure is ApiReply) return failure;
            throw failure;
          }
          final ids = Uri.parse(path).queryParametersAll['clientOperationId']!;
          return ApiReply(200, {
            'ok': true,
            'operations': [
              for (final id in ids)
                {'clientOperationId': id, 'status': 'not_registered'},
            ],
          });
        })..failure = const ApiFailure('응답 유실', uncertainWrite: true);
        addTearDown(() => gateway.live.client.close(force: true));
        final store = MemoryStore();
        final controller = await _controller(gateway: gateway, store: store);
        final item = await _photo(controller);
        await controller.outbox.send(item);
        await controller.outbox.verify(item);
        expect(controller.outbox.canRetryUncertain(item), isTrue);
        absent = false;
        await controller.outbox.verify(item);
        expect(item.phase, OutboxPhase.uncertain);
        expect(item.needsVerification, isTrue);
        expect(controller.outbox.canRetryUncertain(item), isFalse);
        expect(item.message, contains('서버 조회 실패'));
        await controller.outbox.send(item, retry: true);
        expect(gateway.calls, hasLength(1));
        final resumed = await _controller(gateway: gateway, store: store);
        await resumed.outbox.load();
        final restored = resumed.outbox.items.single;
        expect(restored.id, item.id);
        expect(restored.phase, OutboxPhase.uncertain);
        expect(
          await store.readBytes('a', restored.bytesKey),
          gateway.calls.single.bytes,
        );
        await resumed.outbox.send(restored, retry: true);
        expect(gateway.calls, hasLength(1));
      },
    );
  }

  test('미등록 후 재시작은 조회 없이 재전송하지 않고 새 조회 뒤 같은 ID로 재시도한다', () async {
    final gateway = _LookupGateway()
      ..result = const OperationCheck(OperationPresence.absent)
      ..failure = const ApiFailure('응답 유실', uncertainWrite: true);
    final store = MemoryStore();
    final controller = await _controller(gateway: gateway, store: store);
    final item = await _photo(controller);
    await controller.outbox.send(item);
    await controller.outbox.verify(item);
    final resumed = await _controller(gateway: gateway, store: store);
    await resumed.outbox.load();
    final restored = resumed.outbox.items.single;
    expect(restored.phase, OutboxPhase.uncertain);
    await resumed.outbox.send(restored, retry: true);
    expect(gateway.calls, hasLength(1));
    await resumed.outbox.verify(restored);
    gateway.failure = null;
    await resumed.outbox.send(restored, retry: true);
    expect(gateway.calls, hasLength(2));
    expect(gateway.calls.last.fields, gateway.calls.first.fields);
    expect(gateway.calls.last.bytes, gateway.calls.first.bytes);
    expect(restored.id, item.id);
  });

  test('첫 묶음 조회 장애는 다음 묶음을 멈추고 모든 항목을 결과 불명으로 보존한다', () async {
    final gateway = _LookupGateway()
      ..lookupFailure = const ApiFailure('DB', status: 503);
    final controller = await _controller(gateway: gateway);
    final entries = await _uncertainEntries(controller, 51);
    await controller.outbox.verifyUncertain();
    expect(gateway.queries.map((q) => q.length), [50]);
    expect(entries.every((e) => e.phase == OutboxPhase.uncertain), isTrue);
    expect(entries.any(controller.outbox.canRetryUncertain), isFalse);
    expect(controller.outbox.lookupMessage, contains('DB 장애'));
    expect(gateway.calls, isEmpty);
  });

  test('계정 전환 뒤 늦은 GET은 이전 작업을 완료하거나 새 계정에 노출하지 않는다', () async {
    final gateway = _LookupGateway()
      ..lookupPending = Completer<Map<String, OperationCheck>>();
    final controller = await _controller(gateway: gateway);
    final item = (await _uncertainEntries(controller, 1)).single;
    final work = controller.outbox.verify(item);
    await controller.signIn('b', 'mock');
    gateway.lookupPending!.complete({
      item.id: const OperationCheck(OperationPresence.confirmed),
    });
    await work;
    await controller.outbox.load();
    expect(controller.outbox.items, isEmpty);
    expect(controller.outbox.lookupMessage, isNull);
    expect(item.phase, OutboxPhase.uncertain);
    expect(gateway.calls, isEmpty);
  });

  testWidgets('O 진입의 registered는 서버 확인됨을 표시하며 수동 조회 후에도 POST하지 않는다', (
    tester,
  ) async {
    final gateway = _LookupGateway()
      ..result = const OperationCheck(OperationPresence.confirmed);
    final controller = await _controller(gateway: gateway);
    await _uncertainEntries(controller, 1);
    await _open(tester, controller);
    expect(gateway.reads, 1);
    expect(find.text(serverCompletedLabel), findsOneWidget);
    expect(find.text('같은 작업 재시도'), findsNothing);
    expect(gateway.calls, isEmpty);
  });

  testWidgets('조회 중·503 실패를 표시하고 연타 조회와 자동 재전송을 막는다', (tester) async {
    final gateway = _LookupGateway()
      ..lookupPending = Completer<Map<String, OperationCheck>>();
    final controller = await _controller(gateway: gateway);
    final item = (await _uncertainEntries(controller, 1)).single;
    // 진행 표시가 도는 동안 pumpAndSettle로 기다리지 않는다.
    tester.view.physicalSize = const Size(1400, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: OutboxScreen(controller: controller)),
      ),
    );
    await tester.pump();
    expect(find.textContaining('서버 상태 조회 중'), findsWidgets);
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const Key('outbox-lookup-all')))
          .onPressed,
      isNull,
    );
    await controller.outbox.verify(item);
    expect(gateway.reads, 1);
    gateway.lookupPending!.completeError(const ApiFailure('DB', status: 503));
    await tester.pumpAndSettle();
    expect(find.textContaining('서버 조회 실패'), findsWidgets);
    expect(find.textContaining('DB 장애'), findsWidgets);
    expect(find.text('로컬 저장됨 · 서버 결과 불명'), findsOneWidget);
    expect(find.text('같은 작업 재시도'), findsNothing);
    expect(gateway.calls, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('조회 401은 재로그인 안내로 전환하고 같은 계정 복귀 후 다시 조회한다', (tester) async {
    var unauthorized = true;
    var gets = 0;
    final gateway = _LiveLookupGateway((_, path, _, _) async {
      gets++;
      if (unauthorized) return const ApiReply(401, {'ok': false});
      final ids = Uri.parse(path).queryParametersAll['clientOperationId']!;
      return ApiReply(200, {
        'ok': true,
        'operations': [
          for (final id in ids)
            {'clientOperationId': id, 'status': 'registered'},
        ],
      });
    });
    addTearDown(() => gateway.live.client.close(force: true));
    final controller = await _controller(gateway: gateway);
    final item = (await _uncertainEntries(controller, 1)).single;
    await tester.pumpWidget(
      MaterialApp(
        home: AnimatedBuilder(
          animation: controller,
          builder: (_, _) => controller.authStage == AuthStage.ready
              ? Scaffold(body: OutboxScreen(controller: controller))
              : AuthScreen(controller: controller),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(controller.authStage, AuthStage.reauthenticate);
    expect(find.byType(AuthScreen), findsOneWidget);
    expect(find.text('다시 로그인해 주세요'), findsWidgets);
    expect(item.phase, OutboxPhase.uncertain);
    expect(item.needsVerification, isTrue);
    expect(gateway.refreshes, 0);
    expect(gets, 1);
    unauthorized = false;
    await controller.signIn('a', 'mock');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('outbox-lookup-all')));
    await tester.pumpAndSettle();
    expect(item.phase, OutboxPhase.completed);
    expect(gateway.calls, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('비활성 O 탭은 조회하지 않고 진입·빠른 재진입은 1회, 수동은 즉시 조회한다', (tester) async {
    final gateway = _LookupGateway();
    final controller = await _controller(gateway: gateway);
    await _uncertainEntries(controller, 1);
    await _open(tester, controller, shell: true);
    expect(gateway.reads, 0);
    await tester.tap(find.byTooltip('전송 상태'));
    await tester.pumpAndSettle();
    expect(gateway.reads, 1);
    await tester.tap(find.byTooltip('현장'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('전송 상태'));
    await tester.pumpAndSettle();
    expect(gateway.reads, 1);
    await tester.tap(find.byKey(const Key('outbox-lookup-all')));
    await tester.pumpAndSettle();
    expect(gateway.reads, 2);
    expect(gateway.calls, isEmpty);
  });

  testWidgets('백그라운드 진입은 GET을 시작하지 않고 전경 복귀 때만 한 번 조회한다', (tester) async {
    final gateway = _LookupGateway();
    final controller = await _controller(gateway: gateway);
    await _uncertainEntries(controller, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await _open(tester, controller);
    expect(gateway.reads, 0);
    await tester.pump(const Duration(minutes: 2));
    expect(gateway.reads, 0);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(gateway.reads, 1);
    await tester.pump(const Duration(minutes: 2));
    expect(gateway.reads, 1);
    expect(gateway.calls, isEmpty);
  });

  testWidgets('조회 중 백그라운드로 가면 이미 보낸 GET만 반영하고 다음 50개 묶음은 중지한다', (tester) async {
    final gateway = _LookupGateway()
      ..lookupPending = Completer<Map<String, OperationCheck>>();
    final controller = await _controller(gateway: gateway);
    final entries = await _uncertainEntries(controller, 51);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: OutboxScreen(controller: controller)),
      ),
    );
    await tester.pump();
    expect(gateway.queries.map((q) => q.length), [50]);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    gateway.lookupPending!.complete({
      for (final item in entries.take(50))
        item.id: const OperationCheck(OperationPresence.confirmed),
    });
    await tester.pumpAndSettle();
    expect(gateway.reads, 1);
    expect(
      entries.take(50).every((e) => e.phase == OutboxPhase.completed),
      isTrue,
    );
    expect(entries.last.phase, OutboxPhase.uncertain);
    expect(controller.outbox.lookupMessage, contains('조회 중단'));
    await tester.pumpWidget(const SizedBox.shrink());
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  });
}
