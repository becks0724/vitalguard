// VitalStreamEvent 매핑 단위 테스트 — 네이티브 페이로드 형태가 바뀌면 여기서 잡는다
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/vital_stream.dart';

void main() {
  test('hr 이벤트 매핑', () {
    final e = VitalStreamEvent.fromMap({
      'type': 'hr',
      'bpm': 97,
      'seq': 12,
      'channel': 'sendMessage',
      'measuredAtMs': 1754900000000,
    });
    expect(e.type, 'hr');
    expect(e.bpm, 97.0);
    expect(e.seq, 12);
    expect(e.channel, 'sendMessage');
    expect(e.measuredAt, DateTime.fromMillisecondsSinceEpoch(1754900000000));
  });

  test('생체 스냅숏 매핑 — 플랫폼 채널의 Map<Object?,Object?> 를 좁힌다', () {
    final e = VitalStreamEvent.fromMap(<dynamic, dynamic>{
      'type': 'hr',
      'bpm': 97,
      'spo2': 96,
      'spo2AtMs': 1754900002145,
      'stillSec': 42.3,
      'steps': 1204,
      'flights': 3,
      'discreteCounts': <dynamic, dynamic>{'pe': 3, 'hrv': 1},
      'discreteValues': <dynamic, dynamic>{'pe': 4.2, 'hrv': 32.46},
    });
    expect(e.spo2, 96.0);
    expect(e.spo2At, DateTime.fromMillisecondsSinceEpoch(1754900002145));
    expect(e.stillSec, 42.3);
    expect(e.steps, 1204);
    expect(e.flights, 3);
    expect(e.discreteCounts, {'pe': 3, 'hrv': 1});
    expect(e.discreteValues, {'pe': 4.2, 'hrv': 32.46});
  });

  test('없는 키는 null·빈 맵 — "0" 과 "모름" 을 구분한다', () {
    final e = VitalStreamEvent.fromMap({'type': 'hr', 'seq': 1});
    expect(e.spo2, isNull);
    expect(e.stillSec, isNull);
    expect(e.steps, isNull);
    expect(e.discreteCounts, isEmpty);
  });

  test('pipeline 이벤트 매핑 — 인증 거부 플래그 포함', () {
    final e = VitalStreamEvent.fromMap({
      'type': 'pipeline',
      'pending': 3,
      'uploadOk': false,
      'authRejected': true,
    });
    expect(e.type, 'pipeline');
    expect(e.pending, 3);
    expect(e.uploadOk, false);
    expect(e.authRejected, true);
    expect(e.bpm, isNull);
  });
}
