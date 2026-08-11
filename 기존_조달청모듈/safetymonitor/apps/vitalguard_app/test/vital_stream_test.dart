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
