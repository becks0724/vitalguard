// SafetyMonitor 작업자 폰 앱 — D1 수집 화면 위젯 테스트
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';

import 'package:worker_phone/main.dart';

void main() {
  testWidgets('D1 수집 화면 — vitals 카드와 액션 렌더', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const WorkerPhoneApp());

    expect(find.text('SafetyMonitor'), findsOneWidget);
    expect(find.text('심박'), findsOneWidget);
    expect(find.text('SpO₂'), findsOneWidget);
    expect(find.text('손목 온도'), findsOneWidget);
    expect(find.text('연결 상태'), findsOneWidget);
    expect(find.text('대기'), findsWidgets);
    expect(find.text('수집 시작'), findsOneWidget);
    expect(find.text('SOS'), findsOneWidget);
  });
}
