// 인디케이터 렌더 테스트 — "코드는 통과하는데 화면엔 아무것도 없는" 결함을 막는다
//
// ★ 실제로 겪은 결함(2026-08-18): 밴드를 `Expanded` 로 나눴는데 `ColoredBox` 는 자식이
//   없어 **교차축이 0 으로 접혔다**. 폭 비율·색·점 위치가 전부 옳았고 dart analyze 도
//   flutter test 도 통과했지만 **막대가 통째로 안 보였다**. 골든 렌더로만 드러났고,
//   여기 남기는 것은 그 렌더 없이도 같은 결함을 잡기 위한 최소 검사다.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/metric_tile.dart';
import 'package:vitalguard_app/theme.dart';
import 'package:vitalguard_app/vital_display.dart';
import 'package:vitalguard_app/vital_range.dart';

Future<void> _pump(WidgetTester tester, Widget child) => tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        home: Scaffold(body: Center(child: SizedBox(width: 300, child: child))),
      ),
    );

/// 밴드 조각들(배경 ColoredBox 는 크기가 화면 전체라 제외).
List<RenderBox> _bands(WidgetTester tester) => find
    .byType(ColoredBox)
    .evaluate()
    .map((e) => e.renderObject! as RenderBox)
    .where((b) => b.size.width < 290 && b.size.height < 290)
    .toList();

void main() {
  testWidgets('★ 밴드가 실제 면적을 갖는다(교차축 0 붕괴 방지)', (tester) async {
    for (final bar in [
      HorizontalRangeBar(range: heartRateRange, value: 118),
      VerticalRangeBar(range: spo2Range, value: 96),
    ]) {
      await _pump(tester, bar);
      final bands = _bands(tester);
      expect(bands.length, greaterThan(2), reason: '밴드 조각을 못 찾았다');
      for (final b in bands) {
        expect(b.size.width, greaterThan(0), reason: '밴드 폭이 0 이다 — 막대가 안 보인다');
        expect(b.size.height, greaterThan(0), reason: '밴드 두께가 0 이다 — 막대가 안 보인다');
      }
    }
  });

  testWidgets('밴드 길이 비율이 임계 폭과 같다', (tester) async {
    await _pump(tester, HorizontalRangeBar(range: heartRateRange, value: 70));
    final widths = _bands(tester).map((b) => b.size.width).toList();
    expect(widths.length, heartRateRange.bands.length);
    // 합이 막대 전체 폭 — 어긋나면 점 위치와 색 경계가 갈린다.
    expect(widths.reduce((a, b) => a + b), closeTo(300, 0.5));
    final span = heartRateRange.max - heartRateRange.min;
    for (var i = 0; i < widths.length; i++) {
      final b = heartRateRange.bands[i];
      expect(widths[i], closeTo((b.to - b.from) / span * 300, 0.6),
          reason: '${b.from}~${b.to} 밴드 길이가 임계 폭과 다르다');
    }
  });

  testWidgets('점이 값을 따라 움직이고 구간 밖에서는 끝에 붙는다', (tester) async {
    Future<double> xOf(double v) async {
      await _pump(tester, HorizontalRangeBar(range: heartRateRange, value: v));
      final align = tester.widget<Align>(find.byType(Align).last);
      return (align.alignment as Alignment).x;
    }

    expect(await xOf(30), closeTo(-1, 1e-9));
    expect(await xOf(170), closeTo(1, 1e-9));
    expect(await xOf(100), closeTo(2 * (70 / 140) - 1, 1e-9));
    expect(await xOf(500), closeTo(1, 1e-9), reason: '구간 밖 값이 막대 밖으로 나갔다');
  });

  testWidgets('임계 근거가 없는 타일에는 막대를 그리지 않는다', (tester) async {
    await _pump(tester,
        const MetricTile(row: VitalRow(label: '심박변이(HRV)', value: '64.5', unit: 'ms', detail: '2건')));
    expect(find.byType(VerticalRangeBar), findsNothing);
    expect(find.byType(StatusBadge), findsNothing);
    expect(find.text('2건'), findsOneWidget);
  });

  testWidgets('임계가 있는 타일은 막대와 상태 배지를 함께 그린다', (tester) async {
    await _pump(
        tester,
        MetricTile(
            row: VitalRow(
                label: '산소포화도', value: '96', unit: '%', range: spo2Range, numeric: 96)));
    expect(find.byType(VerticalRangeBar), findsOneWidget);
    expect(find.text('정상'), findsOneWidget);
  });

  test('값 색 — 위험만 빨강, 나머지는 브랜드', () {
    // 화면에서 가장 큰 글자라 위험을 파랑으로 두면 위험이 숨는다.
    expect(vgValueColor(VitalStatus.danger), VgColors.danger);
    expect(vgValueColor(VitalStatus.caution), VgColors.primary);
    expect(vgValueColor(VitalStatus.normal), VgColors.primary);
    expect(vgValueColor(null), VgColors.primary);
  });
}
