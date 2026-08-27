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
import 'package:vitalguard_app/vital_card.dart';
import 'package:vitalguard_app/vital_display.dart';
import 'package:vitalguard_app/vital_stream.dart';
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

  testWidgets('★ 판정에 안 올리는 값은 상태 글자·막대를 못 받는다', (tester) async {
    // 추정 체온은 관제웹에서도 판정·경보 미주입이다. 여기서 상태를 주면 그 계약이 폰에서만 깨진다.
    //
    // ⚠ 2026-08-27 에 이 계약의 자리가 옮겨졌다 — 요약 화면이 링 좌우 보조값(`RingSideValue`)
    //   에서 참고 디자인의 카드 격자(`VitalCard`)로 바뀌었다. 가드를 옛 위젯에 두고 오면
    //   초록불인 채 **실제 화면**에 체온 배지가 생길 수 있어 대상을 함께 옮긴다.
    await _pump(tester, const VitalCard(
        row: VitalRow(label: '체온(추정)', value: '38.0', unit: '℃', detail: '의료 판정 아님')));
    for (final label in vitalStatusLabel.values) {
      expect(find.text(label), findsNothing, reason: '판정에 안 올리는 값에 `$label` 이 붙었다');
    }
    expect(find.byType(VerticalRangeBar), findsNothing,
        reason: '막대를 그리면 없던 기준이 생긴 것처럼 읽힌다');
    expect(find.text('의료 판정 아님'), findsOneWidget);

    // 임계가 있는 값은 상태와 막대를 함께 받는다.
    await _pump(tester, VitalCard(
        row: VitalRow(
            label: '산소포화도', value: '96', unit: '%', range: spo2Range, numeric: 96)));
    expect(find.text('정상'), findsOneWidget);
    expect(find.byType(VerticalRangeBar), findsOneWidget);
  });

  test('★ 격자가 같은 지표를 두 번 그리지 않는다', () {
    // 같은 값이 한 화면에 두 번 뜨면 어느 쪽이 최신인지 읽는 사람이 판단해야 한다.
    //
    // ⚠ 종전에는 "위 카드가 이미 가져간 라벨"(`summaryLabels`)을 격자에서 빼는 구조였고 가드도
    //   그 목록을 봤다. 2026-08-27 에 카드와 격자가 **한 섹션으로 합쳐져** 목록이 없어졌다 —
    //   목록을 보는 가드는 이제 아무것도 안 지키므로 조립 결과를 직접 본다.
    final rows = buildHealthMonitorRows(
      vitals: const VitalStreamEvent(
        type: 'hr',
        bpm: 101,
        spo2: 95,
        steps: 2872,
        stillSec: 0.4,
        discreteCounts: {'pe': 14, 'dl': 2, 'hrv': 3},
        discreteValues: {'pe': 4.4, 'dl': 2.0, 'hrv': 74.4},
      ),
      own: OwnVitals.fromMap({
        'ok': true, 'applicable': true,
        'coreTemp': {'tempC': 37.9, 'basisMinutes': 170},
        'psi': {'value': 4.7, 'personalized': true},
        'stress': {'calibrating': false, 'index': 49},
        'totalPersisted': 1,
      }),
    );
    final labels = rows.map((r) => r.label).toList();
    expect(labels.toSet(), hasLength(labels.length),
        reason: '같은 값이 격자에 두 번 들어간다: $labels');

    // ★ 반대 방향도 함께 막는다 — 합치면서 서버 파생 3종이 **빠지면** 화면에서 사라진다.
    //   라벨은 칸 폭에 맞춰 짧은 표기로 들어오므로 그 표기까지 함께 고정한다.
    expect(labels, containsAll(<String>['체온(추정)', '생리적 부담', '스트레스']),
        reason: '서버 파생행이 격자에 안 들어왔다 — 조용히 사라진다: $labels');
    // 값도 함께 왔는지 — 라벨만 오고 값이 `--` 면 칸이 장식이 된다.
    expect(rows.firstWhere((r) => r.label == '생리적 부담').value, '4.7');

    // ★ 막대를 다는 칸은 산소포화도 하나뿐이다.
    //   ⚠ 이 단언이 **조립부에 따로** 있어야 하는 이유. 위 위젯 시험은 손으로 만든 행을
    //   그리므로, 조립부가 체온에 임계를 붙여도 위젯은 시키는 대로 그려 초록이다
    //   (2026-08-27 변이 실측 — 위젯 가드만 있을 때 그 변이가 그대로 통과했다).
    //   파이프라인은 양 끝을 함께 잡아야 한다.
    final banded = rows.where((r) => r.range != null).map((r) => r.label).toList();
    expect(banded, ['산소포화도'],
        reason: '근거 없는 임계가 생겼다 — 막대는 없던 기준을 만든다: $banded');
  });
}
