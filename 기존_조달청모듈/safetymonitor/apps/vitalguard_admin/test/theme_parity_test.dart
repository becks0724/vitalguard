// 가드 — 관리자 앱과 작업자 앱의 색이 같다
//
// 두 파일이 갈리면 같은 작업자가 두 앱에서 다른 색으로 뜬다. 복사본이라 자동으로 어긋나므로
// 상수 값을 대조한다. 값을 바꿔야 하면 셋을 같이 바꾼다 — 관제웹 `globals.css` · 작업자 앱 · 여기.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// `static const 이름 = Color(0xAARRGGBB);` 를 이름→값으로 걷는다.
Map<String, String> _colors(String path) {
  final src = File(path).readAsStringSync();
  final re = RegExp(r'static const (\w+) = Color\((0x[0-9A-Fa-f]+)\)');
  return {
    for (final m in re.allMatches(src)) m.group(1)!: m.group(2)!.toLowerCase(),
  };
}

void main() {
  test('색 상수가 작업자 앱과 같다', () {
    final mine = _colors('lib/theme.dart');
    final theirs = _colors('../vitalguard_app/lib/theme.dart');

    expect(mine, isNotEmpty, reason: '관리자 앱 색 상수를 못 읽었다 — 가드를 다시 맞춰야 한다');
    expect(theirs, isNotEmpty, reason: '작업자 앱 색 상수를 못 읽었다 — 경로가 바뀌었나');

    // 관리자 앱이 가진 색은 전부 작업자 앱과 같은 값이어야 한다.
    // 반대 방향은 안 본다 — 작업자 앱에만 있는 색(심박 하트 등)을 여기 끌어올 이유가 없다.
    for (final entry in mine.entries) {
      expect(
        theirs[entry.key],
        entry.value,
        reason: '${entry.key} 이 두 앱에서 다르다 — 같은 작업자가 다른 색으로 뜬다',
      );
    }
  });

  test('판정 임계를 가져오지 않았다', () {
    // 작업자 앱 `vital_range.dart` 를 복사해 오면 판정이 둘이 된다(context-notes.md).
    expect(
      File('lib/vital_range.dart').existsSync(),
      isFalse,
      reason: '임계 파일을 가져왔다 — 앱이 판정을 하게 된다',
    );
  });
}
