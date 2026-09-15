import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/stt_screen.dart';

void main() {
  late StreamController<dynamic> events;
  late SttMeasurements measurements;
  late List<String> methods;
  late bool rejectPermission;

  setUp(() async {
    events = StreamController<dynamic>.broadcast(sync: true);
    methods = [];
    rejectPermission = false;
    measurements = SttMeasurements(
      events: events.stream,
      invoke: (method, arguments) async {
        methods.add(method);
        if (method == 'readLog') return '';
        if (method == 'isOnDeviceAvailable') {
          return {
            'available': true,
            'environment': {
              'airplaneMode': true,
              'wifiEnabled': false,
              'activeNetwork': false,
            },
            'logPath': 'diagnostic-log',
          };
        }
        if (method == 'start' && rejectPermission) {
          throw PlatformException(code: 'microphone_denied');
        }
        return null;
      },
    );
    await measurements.initialize();
  });

  tearDown(() async {
    measurements.dispose();
    await events.close();
  });

  test('권한 거절은 인식 표본이나 숫자 오류코드를 만들어내지 않는다', () async {
    rejectPermission = true;
    await measurements.start(0);
    expect(measurements.sampleCount, 0);
    expect(measurements.trials.single.errorCode, isNull);
    expect(measurements.trials.single.finalResults, isNull);
    expect(measurements.running, isFalse);
    expect(measurements.trials.single.status, contains('microphone_denied'));
  });

  test('문장·오인식 원문·부분결과 지연을 수정하지 않고 보존한다', () async {
    await measurements.start(0);
    final id = measurements.activeId;
    events.add({'type': 'started', 'runId': id});
    events.add({
      'type': 'partial',
      'runId': id,
      'results': ['3번 구역  안저'],
      'firstPartialMs': 437,
    });
    events.add({
      'type': 'final',
      'runId': id,
      'results': ['3번 구역  안저 난간 파손 확인햇습니다'],
      'firstPartialMs': 437,
    });
    final trial = measurements.trials.single;
    expect(trial.sentence, '3번 구역 안전난간 파손 확인했습니다');
    expect(trial.finalResults, ['3번 구역  안저 난간 파손 확인햇습니다']);
    expect(trial.partialResults, [
      ['3번 구역  안저'],
    ]);
    expect(trial.firstPartialMs, 437);
    expect(measurements.sampleCount, 1);
    expect(measurements.running, isFalse);
  });

  test('오류13과 부분결과 미수신을 보존하고 이전 세션의 늦은 결과를 무시한다', () async {
    await measurements.start(1);
    final first = measurements.activeId;
    events.add({'type': 'started', 'runId': first});
    events.add({
      'type': 'error',
      'runId': first,
      'code': 13,
      'name': 'ERROR_LANGUAGE_UNAVAILABLE',
    });
    expect(measurements.trials.single.errorCode, 13);
    expect(measurements.trials.single.firstPartialMs, isNull);
    await measurements.start(2);
    final second = measurements.activeId;
    events.add({
      'type': 'final',
      'runId': first,
      'results': ['늦은 결과'],
    });
    expect(measurements.activeId, second);
    expect(measurements.trials.first.finalResults, isNull);
    expect(measurements.trials.last.errorCode, 13);
    await measurements.stop(cancel: true);
    expect(measurements.running, isFalse);
    expect(methods.last, 'stop');
  });
}
