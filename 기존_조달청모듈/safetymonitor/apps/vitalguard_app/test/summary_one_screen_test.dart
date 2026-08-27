// 요약 화면 한 화면 가드 — 심박 카드 + 생체 격자가 스크롤 없이 다 보이는지 잰다
//
// ★ 사용자 요구(2026-08-27) — "한 화면에 구현할 수 있도록 비율 조정". 이 요구는 코드 어디에도
//   흔적이 안 남는다. 다음 사람이 폰트를 1pt 키우거나 여백을 4pt 늘리면 조용히 깨지고,
//   화면은 여전히 멀쩡해 보인 채 **스크롤만 생긴다** — 눈으로도 다른 시험으로도 안 잡힌다.
//   그래서 숫자로 잰다.
//
// ⚠ 이 가드가 지키는 것은 **여백 예산**이지 특정 높이가 아니다. 차트를 늘리고 칸을 줄이면
//   여전히 초록이고 그래도 된다. 남은 예산을 실패 문구에 함께 찍어 다음 사람이 어디서
//   가져올지 판단할 수 있게 한다.
//
// ⚠ 320pt 기기(iPhone SE 1세대)는 **제외한다.** 그 폭에서는 `심박변이(HRV)` 같은 이름이 두
//   줄로 접혀 격자가 72pt 높아진다. 이름을 자르는 것보다 스크롤이 낫다는 판단이고
//   (`summary_strip_test` 가 잘림을 금지한다), 여기에 넣으면 그 결정과 충돌한다.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/heart_rate_trend.dart';
import 'package:vitalguard_app/main.dart';
import 'package:vitalguard_app/theme.dart';
import 'package:vitalguard_app/vital_card.dart';

const _bridge = MethodChannel('vitalguard/bridge');
const _stream = EventChannel('vitalguard/stream');

/// 칸이 **가장 많은** 상황을 만든다 — 적게 오는 상황만 재면 예산이 남는 것처럼 보인다.
/// 이산 3종(운동 강도·일광 시간·보행 심박)까지 오면 고정 9칸 + 3 = 12칸으로 격자가 네 줄이다.
void _mockFull() {
  final m = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  m.setMockMethodCallHandler(_bridge, (call) async {
    switch (call.method) {
      case 'status':
        return <String, dynamic>{
          'loggedIn': true,
          'name': '장우진',
          'workerId': 'EMP-6861',
          'pending': 0,
          'baseURL': 'https://example.invalid',
        };
      case 'ownVitals':
        return <String, dynamic>{
          'ok': true,
          'applicable': true,
          'coreTemp': {'tempC': 37.6, 'basisMinutes': 170},
          'psi': {'value': 2.6, 'personalized': true},
          'stress': {'calibrating': false, 'index': 41},
          'totalPersisted': 1,
        };
      default:
        return null;
    }
  });
  m.setMockStreamHandler(
    _stream,
    MockStreamHandler.inline(
      onListen: (args, sink) {
        sink.success(<String, dynamic>{
          'type': 'hr',
          'bpm': 103.0,
          'seq': 145,
          'spo2': 95.0,
          'steps': 2872,
          'stillSec': 1.4,
          'discreteCounts': <String, dynamic>{'pe': 2, 'dl': 1, 'whr': 3},
          'discreteValues': <String, dynamic>{'pe': 4.8, 'dl': 1.0, 'whr': 96.0},
          'measuredAtMs': DateTime.now().millisecondsSinceEpoch,
        });
      },
    ),
  );
}

void main() {
  tearDown(() {
    final m = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    m.setMockMethodCallHandler(_bridge, null);
    m.setMockStreamHandler(_stream, null);
  });

  // 375 = iPhone SE2·8 · 393 = iPhone 15/16 · 430 = Pro Max.
  for (final width in <double>[375, 393, 430]) {
    testWidgets('★ ${width.toInt()}pt 에서 요약이 스크롤 없이 다 보인다', (tester) async {
      tester.view.physicalSize = Size(width * 3, 852 * 3);
      tester.view.devicePixelRatio = 3.0;
      // ★ 안전영역을 실제 값으로 넣는다. 안 넣으면 세로 59pt 가 공짜로 생겨
      //   기기에서 넘치는 화면이 시험에서는 통과한다(실측 — 넣기 전 0, 넣은 뒤 75pt 초과).
      tester.view.padding = const FakeViewPadding(top: 59 * 3, bottom: 34 * 3);
      tester.view.viewPadding = const FakeViewPadding(top: 59 * 3, bottom: 34 * 3);
      addTearDown(tester.view.reset);

      _mockFull();
      await tester.pumpWidget(MaterialApp(theme: vgLightTheme(), home: const HomeScreen()));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 80));
      }

      // 통제군 — 잴 것이 실제로 그려졌나. 이게 없으면 화면이 비어도 초록이다.
      expect(find.byType(HeartRateHeroCard), findsOneWidget);
      final cards = tester.widgetList<VitalCard>(find.byType(VitalCard)).length;
      expect(
        cards,
        greaterThanOrEqualTo(12),
        reason: '칸이 $cards 개뿐이다 — 칸이 줄어 통과한 것이라면 이 가드는 아무것도 안 잰다',
      );
      expect(find.text('오른 층'), findsOneWidget, reason: '마지막 보류 줄이 없다');

      final pos = tester
          .state<ScrollableState>(
            find.descendant(of: find.byType(ListView), matching: find.byType(Scrollable)),
          )
          .position;
      expect(
        pos.maxScrollExtent,
        0,
        reason:
            '요약이 한 화면에 안 들어간다 — ${pos.maxScrollExtent}pt 넘친다.'
            ' 차트 높이·칸 여백·격자 열수 중 어디서 가져올지 정해야 한다',
      );
    });
  }
}
