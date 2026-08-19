// 하단 유리 탭 바 가드 — 블러가 사라지는 것과 본문이 바에 가리는 것을 함께 고정한다
//
// ★ 이 화면의 위험 두 가지.
//   ① `BackdropFilter` 가 빠져도 화면은 멀쩡히 그려진다 — 그냥 흰 바가 될 뿐이라
//      analyze·기존 테스트를 전부 통과한다. 유리로 보이게 하는 유일한 장치라 못 박는다.
//   ② `extendBody: true` 라 본문이 바 **아래로 지나간다**. 하단 여백을 안 주면 마지막 값이
//      바에 가리는데, 화면 밖으로 밀린 값은 없는 것과 같다(이 앱의 ListView 주석 그대로).
//
// ★ 그리고 만들지 않은 탭이 **빈 화면**으로 나오지 않는지 본다 — 빈 자리는 "고장" 으로 읽힌다.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/glass_tab_bar.dart';
import 'package:vitalguard_app/main.dart';
import 'package:vitalguard_app/theme.dart';

void _mockBridge() {
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
      sink.success(<String, dynamic>{
        'type': 'hr',
        'bpm': 87.0,
        'seq': 758,
        'steps': 243,
        'stillSec': 15.2,
        'discreteCounts': <String, dynamic>{'pe': 14, 'dl': 2},
        'discreteValues': <String, dynamic>{'pe': 4.4, 'dl': 2.0},
      });
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
  setUp(_mockBridge);

  testWidgets('세 탭이 뜨고 기본은 요약이다', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await _pumpHome(tester);

    for (final label in ['요약', '기록', '둘러보기']) {
      expect(find.text(label), findsOneWidget);
    }
    // 기본 탭 = 요약이므로 생체 카드가 그대로 보인다.
    expect(find.text('주요 생체'), findsOneWidget);
    expect(find.text('준비 중'), findsNothing);
  });

  testWidgets('★ 유리 바에 블러가 실제로 걸려 있다', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await _pumpHome(tester);

    final bar = find.byType(GlassTabBar);
    expect(bar, findsOneWidget);
    expect(
      find.descendant(of: bar, matching: find.byType(BackdropFilter)),
      findsOneWidget,
      reason: '블러가 빠지면 그냥 불투명한 바가 된다 — 화면은 멀쩡해 보여 아무도 모른다',
    );
  });

  testWidgets('★ 마지막 값이 바에 가리지 않는다', (tester) async {
    // ⚠ 세로를 충분히 좁힌다. 1800(=600pt)에서는 본문이 화면에 다 들어가 **스크롤이 안 생겼고**,
    //   그러면 마지막 줄이 바 근처에 오지도 않아 이 가드가 아무것도 검사하지 않는다
    //   (음성 대조에서 실제로 여백을 지워도 통과했다 — 통과가 정보를 담지 않은 경우).
    tester.view.physicalSize = const Size(1170, 1200);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await _pumpHome(tester);

    final pos = tester
        .state<ScrollableState>(
            find.descendant(of: find.byType(ListView), matching: find.byType(Scrollable)))
        .position;
    expect(pos.maxScrollExtent, greaterThan(0),
        reason: '스크롤이 안 생겼다 — 이 가드는 조건이 성립할 때만 의미가 있다');

    await tester.drag(find.byType(ListView), const Offset(0, -3000));
    await tester.pumpAndSettle();
    expect(pos.pixels, moreOrLessEquals(pos.maxScrollExtent, epsilon: 0.5),
        reason: '끝까지 내려가지 않았다 — 마지막 줄이 바에 닿는 상황을 만들지 못했다');

    final last = tester.getRect(find.text('활동 에너지'));
    final barTop = tester.getRect(find.byType(GlassTabBar)).top;
    expect(
      last.bottom <= barTop,
      isTrue,
      reason: '끝까지 내려도 마지막 줄이 바 아래에 깔린다 — 하단 여백에 glassTabBarInset 이 빠졌다'
          ' (마지막 줄 ${last.bottom} · 바 상단 $barTop)',
    );
  });

  testWidgets('★ 기록 탭은 촬영 버튼을 주고, 아직 안 만든 탭은 사유를 보여준다', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await _pumpHome(tester);

    // 기록 = 구현됨. 촬영 두 경로(서류 스캔·사진 촬영)가 화면에 있어야 한다.
    await tester.tap(find.text('기록'));
    await tester.pumpAndSettle();
    expect(find.text('서류 스캔'), findsOneWidget);
    expect(find.text('사진 촬영'), findsOneWidget);
    expect(find.text('주요 생체'), findsNothing, reason: '요약 카드가 따라오면 같은 값이 두 탭에 뜬다');

    // 둘러보기 = 아직 안 만듦. **빈 화면이 아니라 사유**를 보여준다.
    await tester.tap(find.text('둘러보기'));
    await tester.pumpAndSettle();
    expect(find.text('준비 중'), findsOneWidget, reason: '빈 화면은 고장으로 읽힌다');
    expect(find.text('주요 생체'), findsNothing);

    // 돌아오면 그대로 복구된다.
    await tester.tap(find.text('요약'));
    await tester.pumpAndSettle();
    expect(find.text('주요 생체'), findsOneWidget);
  });
}
