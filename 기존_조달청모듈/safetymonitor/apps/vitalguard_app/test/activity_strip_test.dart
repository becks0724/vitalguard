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

    // ⚠ 2026-08-20 — `오른 층` 은 격자에서 뺐다(사용자 결정). 기기가 층을 거의 안 세서
    //   화면에 올릴 값이 없다(건강 앱 08-19 하루 1층). **수집은 계속한다.**
    //   빠진 자리는 카드 하단 보류 줄이 사유를 적는다 — 아래 테스트가 그것을 고정한다.
    for (final label in ['걸음', '정지 지속']) {
      expect(find.text(label), findsOneWidget,
          reason: '$label 칸이 사라졌다 — 미수신이 "측정하지 않음" 으로 읽힌다');
    }
    // 값 자리는 비우지 않고 미수신을 표시한다.
    expect(find.text('--'), findsWidgets);
  });

  testWidgets('★ 화면에서 뺀 항목은 빈 자리가 아니라 사유를 남긴다', (tester) async {
    tester.view.physicalSize = const Size(1170, 3400);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    _mockBridge(null);
    await _pumpHome(tester);

    // 격자에서는 사라졌지만 카드에서 통째로 사라지지는 않는다 — 빈 자리는 "빠뜨림" 으로 읽힌다.
    expect(find.text('오른 층'), findsOneWidget, reason: '사유 줄까지 사라졌다');
    expect(find.textContaining('수집만'), findsOneWidget,
        reason: '수집은 계속한다는 사실이 화면에서 사라졌다 — 다음 사람이 수집 코드를 지운다');
  });

  testWidgets('수신된 값이 그대로 칸에 들어간다', (tester) async {
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
    expect(find.text('0.4'), findsOneWidget);
    // ★ 층수 값은 와도 화면에 안 그린다 — 수집과 표시를 분리한 것이 이 결정의 핵심이다.
    expect(find.text('3'), findsNothing,
        reason: '오른 층 값이 다시 화면에 나온다 — 뺀 결정이 되돌아갔다');
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
