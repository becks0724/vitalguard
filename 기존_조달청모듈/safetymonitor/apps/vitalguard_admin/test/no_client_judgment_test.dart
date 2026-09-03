// 가드 — 앱이 생체 판정을 **하지 않는다**
//
// 지키는 성질 셋:
//   ① 화면이 임계를 직접 비교하지 않는다 — 서버 tone 만 색으로 옮긴다
//   ② 집계를 앱이 다시 세지 않는다 — 서버 counts 를 쓴다
//   ③ 모르는 값을 0 으로 채우지 않는다 — null 은 "모름" 이다
//
// 왜 소스를 읽어서 시험하나. 이 성질들은 "무엇을 안 한다" 라서 값으로는 못 잡는다.
// 임계를 하나 넣어도 화면은 멀쩡히 돌고, 관제웹과 색이 갈린 뒤에야 사람이 발견한다.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String _read(String p) => File(p).readAsStringSync();

void main() {
  final screen = _read('lib/workers_screen.dart');
  final model = _read('lib/worker.dart');

  // ⚠ 종전엔 `heartRate\s*[<>]\s*\d` 로 잡으려 했는데 **변이 시험에서 안 걸렸다.**
  //   이 필드들은 nullable 이라 실제로 비교하려면 `heartRate! > 120` 이나 `(spo2 ?? 100) < 90`
  //   처럼 쓰게 되고, 그 사이의 `!`·`??`·괄호가 정규식을 빗나가게 한다. 즉 **가장 있을 법한
  //   작성법을 전부 놓치는** 가드였다. 그래서 구문을 맞추려 들지 않고 줄 단위로 넓게 본다 —
  //   생체 필드 이름과 "숫자와의 비교" 가 같은 줄에 함께 있으면 잡는다.
  //   `<` 만으로는 제네릭(`List<Worker>`)에 걸리므로 연산자 뒤에 숫자를 요구한다.
  void assertNoThreshold(String src, String what) {
    final field = RegExp(r'heartRate|spo2|skinTempC|coreTempC');
    final compareToNumber = RegExp(r'[<>]=?\s*\.?\d');
    for (final line in const LineSplitter().convert(src)) {
      final code = line.trim();
      if (code.startsWith('//')) continue; // 주석의 설명문은 판정이 아니다
      if (field.hasMatch(code) && compareToNumber.hasMatch(code)) {
        fail('$what 이 생체 값을 임계와 비교한다 — 판정이 서버와 갈린다\n  $code');
      }
    }
  }

  test('① 화면이 임계를 직접 비교하지 않는다', () {
    assertNoThreshold(screen, '화면');
    assertNoThreshold(model, '모델');
  });

  test('① 색은 서버 tone 에서만 온다', () {
    expect(screen.contains('Color _toneColor(Tone tone)'), isTrue,
        reason: 'tone → 색 변환부가 사라졌다');
    // tone 을 안 보고 색을 고르는 분기가 생기면 여기서 티가 난다.
    expect(screen.contains("toneOf("), isFalse,
        reason: '화면이 tone 을 스스로 만든다 — 서버 값을 그대로 써야 한다');
  });

  test('② 집계를 앱이 다시 세지 않는다', () {
    expect(screen.contains('WorkerCounts'), isTrue, reason: '서버 집계를 안 쓴다');
    // 목록을 훑어 세면 서버 숫자와 갈린다.
    final recount = RegExp(r'workers\s*\.\s*where\s*\(');
    expect(
      recount.hasMatch(screen),
      isFalse,
      reason: '앱이 목록을 세어 집계를 만든다 — 같은 화면에서 두 숫자가 갈린다',
    );
  });

  test('③ 모르는 값을 0 으로 채우지 않는다', () {
    // `?? 0` 이 하나라도 있으면 "못 잰 것" 과 "0 으로 측정된 것" 이 같아진다.
    expect(model.contains('?? 0'), isFalse, reason: '모델이 결측을 0 으로 채운다');
    expect(screen.contains('?? 0'), isFalse, reason: '화면이 결측을 0 으로 채운다');
  });
}
