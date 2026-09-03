// 응답 파싱 시험 — 서버가 안 보낸 값을 앱이 지어내지 않는다는 것을 못 박는다
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_admin/worker.dart';

void main() {
  test('없는 값은 null 이다 — 0 이 아니다', () {
    final w = Worker.from({
      'workerId': 'EMP-6861',
      'name': '장우진',
      'tone': 'normal',
      'label': '수신 중',
      'stale': false,
      'heartRate': 72,
      // spo2·skinTempC·coreTempC·worn 은 서버가 안 보냈다.
    })!;
    expect(w.heartRate, 72);
    expect(w.spo2, isNull, reason: '못 잰 값이 0 이 되면 측정된 0 과 구별이 안 된다');
    expect(w.coreTempC, isNull);
    expect(w.worn, isNull, reason: 'worn 의 null 은 모름이다 — false(벗음)와 다르다');
  });

  test('tone 은 서버 어휘를 그대로 받고 모르는 값은 normal 로 떨어진다', () {
    expect(toneOf('danger'), Tone.danger);
    expect(toneOf('caution'), Tone.caution);
    expect(toneOf('idle'), Tone.idle);
    expect(toneOf('normal'), Tone.normal);
    // 서버가 새 어휘를 내면 색이 없는 것보다 정상색이 낫다 — 라벨은 서버 문구가 그대로 뜬다.
    expect(toneOf('unknown-future-tone'), Tone.normal);
  });

  test('workerId 가 없는 행은 버린다 — 신원 없는 카드를 그리지 않는다', () {
    expect(Worker.from({'name': '누구'}), isNull);
    expect(Worker.from('문자열'), isNull);
    expect(Worker.from(null), isNull);
  });

  test('집계는 서버 값을 그대로 쓰고, 없으면 0 이다', () {
    final board = WorkerBoard.from({
      'counts': {'total': 5, 'danger': 1, 'caution': 2, 'stale': 1},
      'workers': [
        {'workerId': 'A', 'tone': 'danger', 'label': '위험', 'stale': false},
        {'name': '신원없음'}, // 버려진다
      ],
    });
    expect(board.counts.total, 5);
    expect(board.counts.abnormal, 3, reason: '이상 = 위험 + 주의');
    expect(board.workers.length, 1, reason: '신원 없는 행이 목록에 들어왔다');
    expect(board.workers.first.tone, Tone.danger);
  });

  test('counts 가 통째로 빠져도 화면이 죽지 않는다', () {
    final board = WorkerBoard.from({'workers': []});
    expect(board.counts.total, 0);
    expect(board.workers, isEmpty);
  });
}
