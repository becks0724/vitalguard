import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/models/site_status.dart';

import 'support/workers_fixture.dart';

void main() {
  test('S-02 workers 실제 17필드와 행 집계·수신 시각을 보존한다', () {
    final workers = SiteStatus(workersStatusReply()).workers;
    final row = workers.items.single;
    expect(workers.ok, isTrue);
    expect(workers.total, 1);
    expect(workers.normal, 1);
    expect(workers.waiting, 0);
    expect(workers.caution, 0);
    expect(workers.danger, 0);
    expect(workers.stale, 0);
    expect(workers.piiRedacted, isFalse);
    expect(workers.fetchedAt, '2026-09-14T15:13:04.759Z');
    expect(row.workerId, 'w-1');
    expect(row.name, '작업자 w-1');
    expect(row.jobTitle, '현장 기사');
    expect(row.tone, 'normal');
    expect(row.label, '수신 중');
    expect(row.staleLabel, isNull);
    expect(row.heartRate, 78);
    expect(row.spo2, 98);
    expect(row.skinTempC, 34.5);
    expect(row.coreTempC, 36.8);
    expect(row.worn, isTrue);
    expect(row.lastSeenAt, '2026-09-14T15:12:44.759Z');
    expect(row.ageSec, 20);
    expect(row.stale, isFalse);
    expect(row.latitude, 37.501234);
    expect(row.longitude, 127.012345);
    expect(row.locationAccuracyMeters, 8);
  });

  for (final redacted in [true, null]) {
    test('PII $redacted이면 잘못 실린 좌표도 모델에서 보관하지 않는다', () {
      final row = SiteStatus(workersStatusReply(piiRedacted: redacted))
          .workers
          .items
          .single;
      expect(row.latitude, isNull);
      expect(row.longitude, isNull);
      expect(row.locationAccuracyMeters, isNull);
      expect(row.name, '작업자 w-1');
    });
  }

  test('workers 부분 실패는 다른 세 행·경보를 유지하고 이전 목록을 만들지 않는다', () {
    final data = SiteStatus({
      ...workersStatusReply(),
      'workers': {
        'ok': false,
        'error': 'private',
        'items': [workerReply('private')],
      },
    });
    expect(data.workers.ok, isFalse);
    expect(data.workers.itemsAvailable, isFalse);
    expect(data.workers.items, isEmpty);
    expect(data.weather.ok, isTrue);
    expect(data.gas.ok, isTrue);
    expect(data.aed.ok, isTrue);
    expect(data.alerts.ok, isTrue);
  });

  test('빈 배열과 목록 누락·깨진 목록을 구별하고 없는 집계를 0으로 만들지 않는다', () {
    final empty = SiteStatus(workersStatusReply(items: [])).workers;
    expect(empty.itemsAvailable, isTrue);
    expect(empty.total, 0);
    expect(empty.waiting, 0);
    for (final value in [null, 'broken']) {
      final reply = workersStatusReply();
      // as Map 으로 캐스팅해도 실제 객체는 Map<String, Object?> 라
      // 타입 없는 리터럴을 addAll 하면 런타임에 걸린다.
      (reply['workers'] as Map).addAll(<String, Object?>{
        'items': value,
        'total': null,
        'waiting': -1,
      });
      final workers = SiteStatus(reply).workers;
      expect(workers.itemsAvailable, isFalse);
      expect(workers.total, isNull);
      expect(workers.waiting, isNull);
    }
  });

  test('누락·중복 ID는 집계와 별도로 알리고 모르는 상태를 정상으로 만들지 않는다', () {
    final reply = workersStatusReply();
    (reply['workers'] as Map)['items'] = [
      workerReply('same'),
      workerReply('same'),
      null,
      {'name': '식별자 없음'},
      {...workerReply('unknown'), 'tone': 'new-tone', 'stale': 'false'},
    ];
    final workers = SiteStatus(reply).workers;
    expect(workers.omittedItems, 4);
    expect(workers.items.single.workerId, 'unknown');
    expect(workers.items.single.tone, isNull);
    expect(workers.items.single.stale, isNull);
    expect(workers.total, 1, reason: '서버 집계를 다시 계산하지 않는다');
  });

  test('수치·좌표 0은 보존하고 비정상 수치와 잘못된 좌표는 비운다', () {
    final row = SiteStatus(
      workersStatusReply(
        items: [
          {
            ...workerReply('zero'),
            'heartRate': 0,
            'spo2': double.nan,
            'skinTempC': double.infinity,
            'latitude': 0,
            'longitude': 0,
            'locationAccuracyMeters': 0,
            'worn': false,
            'ageSec': 0,
          },
        ],
      ),
    ).workers.items.single;
    expect(row.heartRate, 0);
    expect(row.spo2, isNull);
    expect(row.skinTempC, isNull);
    expect(row.latitude, 0);
    expect(row.longitude, 0);
    expect(row.locationAccuracyMeters, 0);
    expect(row.worn, isFalse);
    expect(row.ageSec, 0);
    final invalid = SiteStatus(
      workersStatusReply(
        items: [
          {
            ...workerReply('invalid'),
            'latitude': 91,
            'longitude': -181,
            'locationAccuracyMeters': -1,
          },
        ],
      ),
    ).workers.items.single;
    expect(invalid.latitude, isNull);
    expect(invalid.longitude, isNull);
    expect(invalid.locationAccuracyMeters, isNull);
  });
}
