// 활동 3칸 가드 — 칸이 사라지지 않는 것과 kcal 이 안 들어오는 것을 함께 고정한다
//
// ★ 이 화면의 위험은 두 방향이다.
//   ① 값이 없을 때 항목까지 사라지면 "그런 걸 재고 있는지"조차 안 보인다(2026-08-18 실기기).
//   ② 빈 자리를 보고 다음 사람이 활동에너지를 채워 넣으면 정지 상태 288kcal/시간이 화면에 뜬다.
//   그래서 칸은 고정하고, 빠진 이유는 화면에 적는다.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/main.dart';
import 'package:vitalguard_app/theme.dart';

/// 브리지·스트림을 막아 홈 화면만 띄운다. `stream` 이 null 이면 생체 미수신 상태.
void _mockBridge(Map<String, dynamic>? stream) {
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
    MockStreamHandler.inline(
      onListen: (args, sink) {
        if (stream != null) sink.success(stream);
      },
    ),
  );
}

Future<void> _pumpHome(WidgetTester tester) async {
  await tester.pumpWidget(MaterialApp(theme: vgLightTheme(), home: const HomeScreen()));
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 80));
  }
}

void main() {
  testWidgets('★ 값이 없어도 활동 3칸이 자리를 지킨다', (tester) async {
    tester.view.physicalSize = const Size(1170, 3400);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    _mockBridge(null);
    await _pumpHome(tester);

    for (final label in ['걸음', '오른 층', '정지 지속']) {
      expect(find.text(label), findsOneWidget,
          reason: '$label 칸이 사라졌다 — 미수신이 "측정하지 않음" 으로 읽힌다');
    }
    // 값 자리는 비우지 않고 미수신을 표시한다.
    expect(find.text('--'), findsWidgets);
  });

  testWidgets('수신된 값이 그대로 3칸에 들어간다', (tester) async {
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
    });
    await _pumpHome(tester);

    expect(find.text('2,872'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(find.text('0.4'), findsOneWidget);
  });

  testWidgets('★ 활동에너지는 값이 아니라 사유가 뜬다', (tester) async {
    tester.view.physicalSize = const Size(1170, 3400);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    _mockBridge(<String, dynamic>{
      'type': 'hr',
      'bpm': 101.0,
      'seq': 2400,
      'steps': 2872,
      // 네이티브가 안 싣지만, 실려 오더라도 화면에 kcal 이 뜨면 안 된다.
      'activeEnergyKcal': 288.0,
    });
    await _pumpHome(tester);

    expect(find.text('활동 에너지'), findsOneWidget);
    expect(find.text('보류 — 측정축 정리 중'), findsOneWidget,
        reason: '사유가 사라지면 빈 자리가 "빠뜨린 것" 으로 읽혀 다음 사람이 채워 넣는다');

    final texts = tester
        .widgetList<Text>(find.byType(Text))
        .map((t) => t.data ?? '')
        .join('\n');
    expect(texts.contains('kcal'), isFalse,
        reason: '상시 워크아웃 때문에 정지 상태에서도 288kcal/시간이 찍힌다(약 4배 과대)');
  });
}
