// 심박 히어로 카드와 이력 버퍼 — "없는 것을 그리지 않는다" 를 지키는지 본다
//
// 이 카드가 초록이면 보장되는 것 = ① 점이 모자라면 선 대신 안내가 뜨고 요약이 `--` 다
// ② 같은 측정을 두 번 세지 않는다 ③ 판정·색을 여기서 새로 만들지 않고 관제웹 것을 쓴다.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/heart_rate_trend.dart';
import 'package:vitalguard_app/metric_tile.dart';
import 'package:vitalguard_app/theme.dart';
import 'package:vitalguard_app/vital_range.dart';

Widget _frame(Widget child) => MaterialApp(
      theme: vgLightTheme(),
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

List<HeartRateSample> _samples(List<int> bpms, {DateTime? from}) {
  final start = from ?? DateTime(2026, 8, 27, 9);
  return List.generate(
    bpms.length,
    (i) => HeartRateSample(start.add(Duration(minutes: i)), bpms[i].toDouble()),
  );
}

/// 큰 현재값(44pt)만 고른다 — 평균/최소/최대가 같은 숫자를 적을 수 있어 텍스트로는 못 가른다.
Text _hero(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .firstWhere((t) => t.style?.fontSize == 44);

void main() {
  group('이력 버퍼', () {
    test('같은 측정 시각은 두 번 세지 않는다 — 스트림과 폴링이 같은 값을 준다', () {
      final at = DateTime(2026, 8, 27, 9);
      final history = HeartRateHistory();
      expect(history.add(80, at), isTrue);
      expect(history.add(80, at), isFalse);
      expect(history.samples, hasLength(1));
    });

    test('1분 버킷은 최신 값으로 덮는다 — 5초마다 쌓으면 창이 조용히 짧아진다', () {
      final at = DateTime(2026, 8, 27, 9);
      final history = HeartRateHistory();
      history.add(80, at);
      history.add(88, at.add(const Duration(seconds: 20)));
      history.add(93, at.add(const Duration(seconds: 40)));
      expect(history.samples, hasLength(1));
      expect(history.samples.single.bpm, 93);

      history.add(70, at.add(const Duration(seconds: 70)));
      expect(history.samples, hasLength(2));
    });

    test('창 밖으로 나간 점은 빠진다', () {
      final at = DateTime(2026, 8, 27, 9);
      final history = HeartRateHistory();
      history.add(80, at);
      history.add(90, at.add(HeartRateHistory.window + const Duration(minutes: 1)));
      expect(history.samples, hasLength(1));
      expect(history.samples.single.bpm, 90);
    });

    test('말이 안 되는 값은 안 받는다', () {
      final at = DateTime(2026, 8, 27, 9);
      final history = HeartRateHistory();
      expect(history.add(0, at), isFalse);
      expect(history.add(400, at.add(const Duration(minutes: 1))), isFalse);
      expect(history.samples, isEmpty);
    });
  });

  group('카드', () {
    testWidgets('★ 점이 모자라면 선 대신 사유를 적고 요약은 비운다', (tester) async {
      await tester.pumpWidget(_frame(
        HeartRateHeroCard(bpm: 84, history: _samples([84])),
      ));
      expect(find.text('심박 수집 중'), findsOneWidget);
      // 평균·최소·최대 세 칸이 전부 `--` — 점 하나로 추이를 말하지 않는다.
      expect(find.text('--'), findsNWidgets(3));
    });

    testWidgets('점이 둘이면 안내가 사라지고 요약이 찬다', (tester) async {
      await tester.pumpWidget(_frame(
        HeartRateHeroCard(bpm: 84, history: _samples([80, 100])),
      ));
      expect(find.text('심박 수집 중'), findsNothing);
      expect(find.text('90'), findsOneWidget); // 평균
      expect(find.text('80'), findsOneWidget); // 최소
      expect(find.text('100'), findsOneWidget); // 최대
    });

    testWidgets('★ 미수신이면 지어내지 않는다 — 값은 `--`, 배지는 대기', (tester) async {
      await tester.pumpWidget(_frame(
        const HeartRateHeroCard(bpm: null, history: []),
      ));
      expect(_hero(tester).data, '--');
      expect(find.text(vitalStatusLabel[VitalStatus.idle]!), findsOneWidget);
    });

    testWidgets('★ 판정은 관제웹 것을 쓴다 — 130bpm 은 위험이고 큰 값이 빨강이다', (tester) async {
      await tester.pumpWidget(_frame(
        HeartRateHeroCard(bpm: 130, history: _samples([120, 130])),
      ));
      expect(find.text(vitalStatusLabel[VitalStatus.danger]!), findsOneWidget);
      // 위험을 파랑으로 두면 화면에서 가장 큰 글자가 위험을 숨긴다(metric_tile.dart 규칙).
      expect(_hero(tester).style?.color, vgValueColor(VitalStatus.danger));
    });

    testWidgets('정상 심박은 큰 값이 브랜드 파랑이다 — 상태는 배지가 전담한다', (tester) async {
      await tester.pumpWidget(_frame(
        HeartRateHeroCard(bpm: 84, history: _samples([80, 88])),
      ));
      expect(find.text(vitalStatusLabel[VitalStatus.normal]!), findsOneWidget);
      expect(_hero(tester).style?.color, VgColors.primary);
    });
  });
}
