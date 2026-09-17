import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/alerts_controller.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';

import 'support/alerts_fixture.dart';

void main() {
  for (final acked in [true, false]) {
    test('ack $acked는 JWT와 id 하나만 POST하고 bool을 보존한다', () async {
      final gateway = LiveGateway(
        transport: (method, path, token, body) async {
          expect(method, 'POST');
          expect(path, '/api/app/admin/alerts/ack');
          expect(token, 'synthetic-access');
          expect(body, {'id': 'a1'});
          return ApiReply(200, {'ok': true, 'acked': acked});
        },
      );
      addTearDown(() => gateway.client.close(force: true));
      expect(await gateway.ackAlert('synthetic-access', 'a1'), acked);
    });
  }

  for (final status in [400, 401, 403, 404, 429, 503]) {
    test('ack $status는 거부와 결과 불명을 나누고 서버 원문을 숨긴다', () async {
      final gateway = LiveGateway(
        transport: (_, _, _, _) async =>
            ApiReply(status, {'ok': false, 'error': 'synthetic-private-error'}),
      );
      addTearDown(() => gateway.client.close(force: true));
      await expectLater(
        gateway.ackAlert('access', 'a1'),
        throwsA(
          isA<ApiFailure>()
              .having((e) => e.status, 'status', status)
              .having((e) => e.uncertainWrite, 'uncertainWrite', status >= 500)
              .having(
                (e) => e.message,
                'safe message',
                isNot(contains('private')),
              ),
        ),
      );
    });
  }

  test('응답 누락·잘못된 bool·타임아웃은 성공이 아닌 결과 불명이다', () async {
    for (final reply in [
      {'ok': true},
      {'ok': true, 'acked': 'false'},
      {'ok': false},
    ]) {
      final gateway = LiveGateway(
        transport: (_, _, _, _) async => ApiReply(200, reply),
      );
      addTearDown(() => gateway.client.close(force: true));
      await expectLater(
        gateway.ackAlert('access', 'a1'),
        throwsA(
          isA<ApiFailure>().having(
            (e) => e.uncertainWrite,
            'uncertain',
            isTrue,
          ),
        ),
      );
    }
    final gateway = LiveGateway(
      transport: (_, _, _, _) async => throw TimeoutException('synthetic'),
    );
    addTearDown(() => gateway.client.close(force: true));
    await expectLater(
      gateway.ackAlert('access', 'a1'),
      throwsA(
        isA<ApiFailure>().having((e) => e.uncertainWrite, 'uncertain', isTrue),
      ),
    );
  });

  test('모델은 종류 5개만 읽고 미지 종류·없는 ack_at·중복 ID를 쓰기 대상으로 만들지 않는다', () {
    final gateway = AlertGatewayFixture()
      ..rows = [
        for (final type in AlertType.values)
          alertRow(id: type.name, type: type.name),
        alertRow(id: 'unsupported', type: 'danger_zone'),
        alertRow(id: 'broken')..remove('ack_at'),
        alertRow(id: 'duplicate'),
        alertRow(id: 'duplicate'),
      ];
    final result = gateway.snapshot().alerts;
    expect(result.items.map((a) => a.type).toSet(), AlertType.values.toSet());
    expect(result.items.length, 5);
    expect(result.items.map((a) => a.id), isNot(contains('unsupported')));
    expect(result.omittedItems, 4);
    expect(result.siteScoped, isFalse);
    expect(SiteStatusAlerts({'ok': true}).itemsAvailable, isFalse);
    expect(
      SiteStatusAlerts({'ok': false, 'items': gateway.rows}).items,
      isEmpty,
    );
  });

  test('경보 종류 5개의 라벨은 관제 정본 문구와 정확히 일치한다', () {
    expect(
      {for (final type in AlertType.values) type.name: type.label},
      {
        'sos': 'SOS',
        'fall': '낙상',
        'vital': '생체 이상',
        'geofence': '구획 이탈',
        'absence': '장기 미수신',
      },
    );
  });

  test('absence는 샘플 없이 서버 경보 컬럼만으로 파싱하고 대응 상태를 보존한다', () {
    for (final acknowledged in [false, true]) {
      final source = alertRow(
        id: 'absence',
        type: 'absence',
        ackAt: acknowledged ? '2026-09-14T15:12:00Z' : null,
        ackBy: acknowledged ? 'manager-b' : null,
      )..['ts'] = '2026-09-13T03:00:00Z';
      final result = SiteStatusAlerts({
        'ok': true,
        'unacked': acknowledged ? 0 : 1,
        'items': [source],
      });
      expect(result.items, hasLength(1));
      expect(result.omittedItems, 0);
      final row = result.items.single;
      expect(row.type, AlertType.absence);
      expect(row.id, source['id']);
      expect(row.workerId, source['worker_id']);
      expect(row.workerName, source['worker_name']);
      expect(row.ts, source['ts']);
      expect(row.createdAt, source['created_at']);
      expect(row.ackAt, source['ack_at']);
      expect(row.ackBy, source['ack_by']);
      expect(row.acknowledged, acknowledged);
    }
  });

  test('시각은 KST로 표시하고 모르는 형식은 서버 값으로 남긴다', () {
    expect(alertTime('2026-12-31T15:00:00Z'), '2027-01-01 00:00:00 KST');
    expect(alertTime(null), '시각 정보 없음');
    expect(alertTime('123456'), '123456 (서버 값)');
  });

  test('오프라인은 컨트롤러와 게이트웨이 경계에서 차단하며 로컬 작업을 남기지 않는다', () async {
    final f = await _Fixture.create();
    f.field.setOffline(true);
    expect(f.alerts.canAck(f.row), isFalse);
    await f.alerts.acknowledge(f.row);
    await expectLater(f.field.ackAlert('a1'), throwsA(isA<ApiFailure>()));
    expect(f.gateway.calls, ['GET']);
    expect(f.alerts.phase('a1'), AlertWritePhase.idle);
    expect(f.store.writes, 0);
    f.field.setOffline(false);
    await f.alerts.refresh();
    expect(f.gateway.calls, ['GET', 'GET']);
    expect(f.store.writes, 0);
  });

  test('처리 중 연타와 성공 후 반복 호출은 POST를 한 번만 실행한다', () async {
    final f = await _Fixture.create();
    final pending = Completer<bool>();
    f.gateway.ack = (_) => pending.future;
    final work = f.alerts.acknowledge(f.row);
    await f.alerts.acknowledge(f.row);
    expect(f.alerts.phase('a1'), AlertWritePhase.sending);
    expect(f.gateway.calls, ['GET', 'POST:a1']);
    f.gateway.markAcked('a1');
    pending.complete(true);
    await work;
    await f.alerts.acknowledge(f.row);
    expect(f.gateway.calls, ['GET', 'POST:a1', 'GET']);
    expect(f.alerts.phase('a1'), AlertWritePhase.confirmed);
  });

  test('acked false는 충돌로 보존하고 GET에서 실제 ack_by를 받는다', () async {
    final f = await _Fixture.create();
    f.gateway.ack = (id) async {
      f.gateway.markAcked(id, by: 'manager-b');
      return false;
    };
    await f.alerts.acknowledge(f.row);
    expect(f.alerts.phase('a1'), AlertWritePhase.conflict);
    expect(f.alerts.item('a1')!.ackBy, 'manager-b');
    expect(f.gateway.calls, ['GET', 'POST:a1', 'GET']);
  });

  test('결과 불명은 GET 오류·항목 오류·목록 누락에도 잠기고 재조회 후 명시적 실행만 허용한다', () async {
    final f = await _Fixture.create();
    f.gateway.ack = (_) async =>
        throw const ApiFailure('unknown', uncertainWrite: true);
    f.gateway.fetch = () async =>
        throw const ApiFailure('unavailable', status: 503);
    await f.alerts.acknowledge(f.row);
    expect(f.gateway.calls, ['GET', 'POST:a1', 'GET']);
    expect(f.alerts.phase('a1'), AlertWritePhase.uncertain);
    f.gateway.fetch = null;
    f.gateway.alertsOk = false;
    await f.alerts.refresh();
    expect(f.alerts.phase('a1'), AlertWritePhase.uncertain);
    f.gateway.alertsOk = true;
    f.gateway.rows = [];
    await f.alerts.refresh();
    expect(f.alerts.phase('a1'), AlertWritePhase.uncertain);
    f.gateway.rows = [alertRow()];
    await f.alerts.refresh();
    expect(f.alerts.phase('a1'), AlertWritePhase.retryReady);
    expect(f.gateway.calls.where((c) => c.startsWith('POST')), ['POST:a1']);
    expect(f.store.writes, 0);
    f.gateway.ack = null;
    await f.alerts.acknowledge(f.row);
    expect(f.gateway.calls.where((c) => c.startsWith('POST')).length, 2);
  });

  test('결과 불명 후 ack_at을 조회하면 확인됨으로 해소하고 POST를 반복하지 않는다', () async {
    final f = await _Fixture.create();
    f.gateway.ack = (id) async {
      f.gateway.markAcked(id);
      throw const ApiFailure('unknown', uncertainWrite: true);
    };
    await f.alerts.acknowledge(f.row);
    expect(f.alerts.phase('a1'), AlertWritePhase.confirmed);
    expect(f.alerts.canAck(f.row), isFalse);
    expect(f.gateway.calls, ['GET', 'POST:a1', 'GET']);
  });

  test('401 거부도 동일 POST를 자동 재전송하지 않는다', () async {
    final f = await _Fixture.create();
    f.gateway.ack = (_) async => throw const ApiFailure('expired', status: 401);
    await f.alerts.acknowledge(f.row);
    expect(f.alerts.phase('a1'), AlertWritePhase.failed);
    expect(f.gateway.calls, ['GET', 'POST:a1']);
  });

  test('같은 ID의 ack_at 전이만 종료·다시 열림이고 사라진 행은 종료가 아니다', () async {
    final f = await _Fixture.create();
    f.gateway.markAcked('a1');
    await f.alerts.refresh();
    expect(f.alerts.closed, contains('a1'));
    f.gateway.rows = [alertRow()];
    await f.alerts.refresh();
    expect(f.alerts.reopened, contains('a1'));
    expect(f.alerts.closed, isEmpty);
    expect(f.alerts.canAck(f.row), isTrue);
    f.gateway.rows = [];
    await f.alerts.refresh();
    expect(f.alerts.closed, isEmpty);
    expect(f.alerts.canAck(f.row), isFalse);
  });

  test('대상 ID 또는 발생 시각이 없으면 내용을 유지하되 대응 확인을 막는다', () async {
    final f = await _Fixture.create();
    for (final field in ['worker_id', 'ts']) {
      f.gateway.rows = [alertRow()..[field] = null];
      await f.alerts.refresh();
      expect(f.alerts.items, hasLength(1));
      final row = f.alerts.items.single;
      expect(f.alerts.canAck(row), isFalse);
      await f.alerts.acknowledge(row);
    }
    expect(f.gateway.calls.any((c) => c.startsWith('POST')), isFalse);
  });

  test('다른 화면의 늦은 조회 결과는 결과 불명 잠금을 풀지 않는다', () async {
    final f = await _Fixture.create();
    f.gateway.ack = (_) async =>
        throw const ApiFailure('unknown', status: 503, uncertainWrite: true);
    f.gateway.fetch = () async =>
        throw const ApiFailure('unavailable', status: 503);
    await f.alerts.acknowledge(f.row);
    f.gateway.markAcked('a1');
    f.field.deliverSnapshot(f.gateway.snapshot());
    f.gateway.rows = [alertRow()];
    f.field.deliverSnapshot(f.gateway.snapshot());
    expect(f.alerts.phase('a1'), AlertWritePhase.uncertain);
    expect(f.alerts.canAck(f.row), isFalse);
    expect(f.gateway.calls, ['GET', 'POST:a1', 'GET']);
  });

  test('처리 도중 계정이 바뀌면 이전 계정의 내용과 처리 결과를 숨긴다', () async {
    final f = await _Fixture.create();
    final pending = Completer<bool>();
    f.gateway.ack = (_) => pending.future;
    final work = f.alerts.acknowledge(f.row);
    await f.field.signIn('next-account', 'mock');
    pending.complete(true);
    await work;
    expect(f.alerts.items, isEmpty);
    expect(f.alerts.authorized, isFalse);
    expect(f.alerts.phase('a1'), AlertWritePhase.idle);
  });
}

class _Fixture {
  final gateway = AlertGatewayFixture();
  final store = AlertStoreFixture();
  late final field = AlertFieldFixture(gateway, store);
  late final AlertsController alerts;
  late final AlertItem row;

  static Future<_Fixture> create() async {
    final f = _Fixture();
    await f.field.signIn('demo', 'mock');
    // 로그인 현장 캐시는 준비 단계다. 이후 경보 동작의 저장만 검사한다.
    f.store.writes = 0;
    f.alerts = AlertsController(f.field);
    addTearDown(() {
      f.alerts.dispose();
      f.field.dispose();
    });
    await f.alerts.refresh();
    f.row = f.alerts.items.single;
    return f;
  }
}
