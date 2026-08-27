// 주요 생체 5칸 라벨 가드 — 이름이 사라지거나 잘리지 않게 고정한다
//
// ★ 배경. 이 행은 아이콘만 있어 **무슨 값인지 알 수 없었다**(2026-08-19 실기기·사용자 지적).
//   이름을 적기로 했는데, 다섯 칸이라 칸당 폭이 좁아 **뒤가 `…` 로 잘리면 이름이 반쪽**이 된다.
//   잘림은 오류가 아니라 조용한 표시라 analyze·기존 테스트를 전부 통과한다 → 좌표로 고정한다.
//
// ★ 라벨 문자열은 여기에 다시 적지 않고 `discreteSpecs` 에서 가져온다 — 두 벌이 되면
//   한쪽만 고쳤을 때 가드가 옛 이름을 지키며 통과한다.
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/main.dart';
import 'package:vitalguard_app/own_vitals.dart';
import 'package:vitalguard_app/theme.dart';
import 'package:vitalguard_app/vital_card.dart';
import 'package:vitalguard_app/vital_display.dart';

void _mockBridge([Map<String, dynamic>? stream]) {
  final m = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  m.setMockMethodCallHandler(const MethodChannel('vitalguard/bridge'), (call) async {
    if (call.method == 'status') {
      return <String, dynamic>{
        'loggedIn': true,
        'name': '장우진',
        'workerId': 'EMP-6861',
        'pending': 0,
        'baseURL': 'https://example.invalid',
      };
    }
    return null;
  });
  m.setMockStreamHandler(
    const EventChannel('vitalguard/stream'),
    MockStreamHandler.inline(onListen: (args, sink) {
      if (stream != null) sink.success(stream);
    }),
  );
}

Future<void> _pumpHome(WidgetTester tester) async {
  await tester.pumpWidget(MaterialApp(theme: vgLightTheme(), home: const HomeScreen()));
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 80));
  }
}

void main() {
  final labels = <String>[
    discreteSpecs['hrv']!.label,
    discreteSpecs['rhr']!.label,
    discreteSpecs['rr']!.label,
    '생리적 부담',
    '스트레스',
    // 아랫줄 — 같은 5칸 격자라 폭 제약이 같다.
    // ⚠ `오른 층` 은 2026-08-20 에 격자에서 뺐다(사용자 결정 · 기기가 층을 거의 안 센다).
    '걸음',
    '정지 지속',
  ];

  // 실기기 폭 4종. 좁은 쪽이 먼저 잘린다.
  for (final width in <double>[320, 375, 390, 430]) {
    testWidgets('★ ${width.toInt()}px 에서 주요 생체 5칸 이름이 잘리지 않는다', (tester) async {
      tester.view.physicalSize = Size(width * 3, 3400);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);

      _mockBridge();
      await _pumpHome(tester);

      for (final label in labels) {
        final finder = find.text(label);
        expect(finder, findsOneWidget, reason: '$label 칸의 이름이 화면에서 사라졌다');
        final p = tester.renderObject<RenderParagraph>(finder);
        expect(
          p.didExceedMaxLines,
          isFalse,
          reason: '$label 이 잘려 `…` 로 끝난다 — 이름이 반쪽이면 아이콘만 있던 때와 같다',
        );
      }
    });
  }

  test('★ PSI·스트레스 이름이 서버 파생행과 갈리지 않는다', () {
    // 이산 3종은 `discreteSpecs` 를 직접 읽어 갈릴 수 없지만 이 둘은 문자열이다.
    // 서버 쪽 이름이 바뀌면 화면 두 곳이 같은 값을 다르게 부르므로 여기서 묶는다.
    final rows = buildServerRows(OwnVitals.fromMap({
      'ok': true,
      'applicable': true,
      'coreTemp': {'tempC': 37.9, 'basisMinutes': 170},
      'psi': {'value': 4.7, 'personalized': true},
      'stress': {'calibrating': false, 'index': 49},
      'totalPersisted': 1,
    })).map((r) => r.label).toList();

    expect(rows.any((l) => l.startsWith('생리적 부담')), isTrue,
        reason: '서버 파생행의 PSI 이름이 바뀌었다 — 요약 행 라벨도 함께 고쳐야 한다: $rows');
    expect(rows, contains('스트레스'),
        reason: '서버 파생행의 스트레스 이름이 바뀌었다 — 요약 행 라벨도 함께 고쳐야 한다');
  });

  testWidgets('★ 지표·활동이 주요 생체와 한 격자에 들어간다', (tester) async {
    // 2026-08-19 사용자 지시로 세 박스(주요 생체·그 밖의 지표·활동)를 합쳤다.
    // 섹션이 다시 갈리면 이 가드가 잡는다.
    //
    // ⚠ 2026-08-27 에 **무엇을 세는지**가 바뀌었다. 참고 디자인을 옮기며 칸마다 카드를 두고
    //   바깥 카드를 없앴으므로 `Card` 개수로는 합쳐졌는지 알 수 없다 — 대신 모든 칸이
    //   **같은 격자 하나**에 들어 있는지를 본다. 합쳐진 상태를 더 정확히 재는 축이다.
    tester.view.physicalSize = const Size(1170, 3400);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    _mockBridge(<String, dynamic>{
      'type': 'hr',
      'bpm': 101.0,
      'seq': 2400,
      'steps': 2872,
      'flights': 3,
      'stillSec': 0.4,
      'discreteCounts': <String, dynamic>{'pe': 14, 'dl': 2},
      'discreteValues': <String, dynamic>{'pe': 4.4, 'dl': 2.0},
    });
    await _pumpHome(tester);

    expect(find.text('주요 생체'), findsOneWidget);
    final grid = find.byType(VitalCardGrid);
    expect(grid, findsOneWidget, reason: '격자가 둘로 갈렸다 — 세 박스를 합친 결정이 되돌아갔다');

    // 옛 섹션 제목은 사라졌다 — 남아 있으면 박스가 다시 갈린 것이다.
    expect(find.text('그 밖의 지표'), findsNothing);

    for (final label in ['운동 강도', '일광 시간', '걸음', '정지 지속']) {
      expect(find.descendant(of: grid, matching: find.text(label)), findsOneWidget,
          reason: '$label 이 주요 생체 격자 밖으로 나갔다');
    }
    // 값도 함께 옮겨왔는지 — 이름만 옮기고 값이 빠지면 칸이 장식이 된다.
    expect(find.descendant(of: grid, matching: find.text('2,872')), findsOneWidget);
    expect(find.descendant(of: grid, matching: find.text('4.4')), findsOneWidget);
  });

  testWidgets('★ 아이콘이 이름을 대신하지 않는다', (tester) async {
    tester.view.physicalSize = const Size(1170, 3400);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    _mockBridge();
    await _pumpHome(tester);

    // ⚠ 2026-08-27 — 종전 가드는 칸에 `Icon` 이 **없을 것**을 단언했다. 참고 디자인을 옮기며
    //   아이콘이 이름 **옆에** 들어왔으므로(사용자 지시) 그 단언은 더 못 쓴다. 다만 2026-08-19
    //   실기기 확인에서 나온 사실 — *아이콘만으로는 무슨 값인지 알 수 없다* — 은 그대로다.
    //   그래서 금지형을 **동반형**으로 바꾼다: 아이콘이 있어도 이름 글자가 반드시 함께 있다.
    //   이름을 빼고 아이콘만 남기는 되돌림은 여전히 여기서 잡힌다(변이 실측 · 커밋 메시지).
    final cards = tester.widgetList<VitalCard>(find.byType(VitalCard)).toList();
    expect(cards, isNotEmpty, reason: '칸이 하나도 안 그려졌다 — 가드가 아무것도 안 본다');
    for (final card in cards) {
      expect(
        find.descendant(of: find.byWidget(card), matching: find.text(card.row.label)),
        findsOneWidget,
        reason: '${card.row.label} 칸이 아이콘만 남고 이름이 사라졌다',
      );
    }
  });
}
