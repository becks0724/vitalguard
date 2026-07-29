import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_flutter/main.dart';

void main() {
  const bridgeChannel = MethodChannel('com.yangjeehoo.vitalguard/watch_bridge');

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(bridgeChannel, (call) async {
          if (call.method == 'status') {
            return {
              'supported': true,
              'reachable': false,
              'platform': 'Watch',
              'detail': '페어링은 되었으며 다음 연결 시 동기화합니다.',
            };
          }
          return {'message': 'Watch 동기화 요청을 보냈습니다.'};
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(bridgeChannel, null);
  });

  testWidgets('좁은 화면에서도 다섯 탭과 상세 화면은 오버플로 없이 렌더링된다', (tester) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const VitAlGuardApp());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await tester.drag(find.byType(ListView).first, const Offset(0, -560));
    await tester.pumpAndSettle();
    await tester.tap(find.text('상세 보기'));
    await tester.pumpAndSettle();
    expect(find.text('통합 안전 신호 상세'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(
      tester.takeException(),
      isNull,
      reason: 'home return must not overflow',
    );

    for (final tab in ['Watch', 'CCTV', 'Health', '설정']) {
      await tester.tap(find.text(tab).last);
      await tester.pumpAndSettle();
      final exception = tester.takeException();
      if (exception is FlutterError) {
        // RenderFlex diagnostics identify the exact narrow-screen layout.
        // ignore: avoid_print
        print(exception.toStringDeep());
      }
      expect(exception, isNull, reason: '$tab tab must not overflow');
    }

    await tester.tap(find.text('계정 및 작업자').last);
    await tester.pumpAndSettle();
    expect(find.text('계정 및 작업자'), findsWidgets);
    expect(tester.takeException(), isNull);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('CCTV').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('지하 기계실'));
    await tester.pumpAndSettle();
    expect(find.text('지하 기계실 CCTV'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
