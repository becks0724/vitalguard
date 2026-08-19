// 상태 링·요약 행 가드 — 참고 디자인의 **모양만** 가져왔다는 계약을 고정한다
//
// ★ 이 화면의 위험은 "안 그려지는 것"이 아니라 **없는 기준이 생기는 것**이다.
//   참고 디자인의 링은 목표 대비 진행률(남은 칼로리)인데 이 앱엔 목표 개념이 없다
//   (`목표`·`goal`·`target`·근무 시간 전부 0건). 호를 진행률로 쓰는 순간 그 분모는
//   우리가 지어낸 값이 되고, HRV·호흡수에 의학 참고범위를 넣지 않기로 한 결정과 어긋난다.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/metric_tile.dart';
import 'package:vitalguard_app/own_vitals.dart';
import 'package:vitalguard_app/status_ring.dart';
import 'package:vitalguard_app/theme.dart';
import 'package:vitalguard_app/vital_range.dart';

Future<void> _pump(WidgetTester t, Widget child) => t.pumpWidget(
      MaterialApp(theme: vgLightTheme(), home: Scaffold(body: Center(child: child))),
    );

void main() {
  testWidgets('링이 값에 따라 표식 위치를 바꾼다', (tester) async {
    Future<Size> render(double bpm) async {
      await _pump(tester, StatusRing(range: heartRateRange, value: bpm, unit: 'bpm'));
      return tester.getSize(find.byType(StatusRing));
    }

    // 크기는 값과 무관하게 고정이어야 한다(값이 바뀌어도 레이아웃이 흔들리지 않는다).
    expect(await render(60), await render(150));
    // 상태 배지가 값에 따라 갈린다 — 링이 상태를 말한다는 계약.
    await _pump(tester, StatusRing(range: heartRateRange, value: 70, unit: 'bpm'));
    expect(find.text('정상'), findsOneWidget);
    await _pump(tester, StatusRing(range: heartRateRange, value: 122, unit: 'bpm'));
    expect(find.text('주의'), findsOneWidget);
    await _pump(tester, StatusRing(range: heartRateRange, value: 150, unit: 'bpm'));
    expect(find.text('위험'), findsOneWidget);
  });

  testWidgets('링 가운데는 값·단위·배지가 세로로 쌓이고 중심이 맞는다', (tester) async {
    // 2026-08-19 사용자 요청 배치. 셋이 한 줄로 붙거나 중심이 어긋나면 링 안이 치우쳐 보인다 —
    // 눈으로만 보던 것이라 되돌아가기 쉬워 좌표로 고정한다.
    await _pump(tester, StatusRing(range: heartRateRange, value: 87, unit: 'bpm'));
    final v = tester.getCenter(find.text('87'));
    final u = tester.getCenter(find.text('bpm'));
    final b = tester.getCenter(find.text('정상'));

    expect(v.dy, lessThan(u.dy), reason: '단위가 값보다 위에 있다');
    expect(u.dy, lessThan(b.dy), reason: '배지가 단위보다 위에 있다');
    for (final c in [u, b]) {
      expect((c.dx - v.dx).abs(), lessThan(0.5), reason: '가운데 정렬이 아니다');
    }
  });

  testWidgets('★ 판정에 안 올리는 값은 상태 배지를 못 받는다', (tester) async {
    // 추정 체온은 관제웹에서도 판정·경보 미주입이다. 여기서 배지를 주면 그 계약이 폰에서만 깨진다.
    await _pump(tester, const RingSideValue(
        label: '체온(추정)', value: '38.0', unit: '℃', note: '의료 판정 아님'));
    expect(find.byType(StatusBadge), findsNothing);
    expect(find.text('의료 판정 아님'), findsOneWidget);
    // 임계가 있는 값은 배지를 받는다.
    await _pump(tester, const RingSideValue(
        label: '산소포화도', value: '96', unit: '%', status: VitalStatus.normal));
    expect(find.byType(StatusBadge), findsOneWidget);
  });

  test('★ 요약 행과 격자가 같은 지표를 두 번 그리지 않는다', () {
    // 같은 값이 한 화면에 두 번 뜨면 어느 쪽이 최신인지 읽는 사람이 판단해야 한다.
    // 제외 목록이 두 벌이 되면 하나만 고쳤을 때 중복이 되살아나므로 한 곳에만 둔다.
    expect(summaryLabels, contains('산소포화도'));
    expect(summaryLabels, contains('체온(심박 추정)'));
    expect(summaryLabels, contains('심박변이(HRV)'));
    // 서버 파생행의 라벨과 정확히 맞물려야 실제로 걸러진다 — 오타 한 글자면 조용히 통과한다.
    final server = buildServerRows(OwnVitals.fromMap({
      'ok': true, 'applicable': true,
      'coreTemp': {'tempC': 37.9, 'basisMinutes': 170},
      'psi': {'value': 4.7, 'personalized': true},
      'stress': {'calibrating': false, 'index': 49},
      'totalPersisted': 1,
    })).map((r) => r.label).toSet();
    // 서버 파생 3종은 **전부** 카드·요약 행이 가져간다 — 격자에는 워치 이산만 남는다.
    expect(server.intersection(summaryLabels), server,
        reason: '서버 파생행 중 격자로 새는 것이 있다 — 같은 값이 두 번 뜬다');
  });
}
