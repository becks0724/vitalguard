// 폰 생체 표시 행 조립 테스트 — 생략 규칙·서식·활동에너지 금지를 고정한다
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_app/vital_display.dart';
import 'package:vitalguard_app/vital_stream.dart';

VitalStreamEvent _event({
  double? spo2,
  DateTime? spo2At,
  double? stillSec,
  int? steps,
  int? flights,
  Map<String, int> counts = const {},
  Map<String, double> values = const {},
}) {
  return VitalStreamEvent(
    type: 'hr',
    bpm: 97,
    spo2: spo2,
    spo2At: spo2At,
    stillSec: stillSec,
    steps: steps,
    flights: flights,
    discreteCounts: counts,
    discreteValues: values,
  );
}

void main() {
  test('안 온 값은 행이 없다 — 0 으로 적으면 "측정했는데 0" 이 된다', () {
    expect(buildVitalRows(_event()), isEmpty);
  });

  test('SpO₂ 는 값과 측정 시각을 함께 적는다 — 전송 시각이 아니다', () {
    final rows = buildVitalRows(_event(spo2: 97.4, spo2At: DateTime(2026, 8, 16, 9, 5)));
    expect(rows.single.label, '산소포화도');
    expect(rows.single.value, '97');
    expect(rows.single.unit, '%');
    expect(rows.single.display, '97%');
    expect(rows.single.detail, '측정 09:05');
    // 근거 있는 임계가 있는 종류라 막대가 붙는다(vital_range.dart).
    expect(rows.single.range, isNotNull);
    expect(rows.single.numeric, 97.4);
  });

  test('이산 6종은 워치 순서로·풀어 쓴 라벨로 나오고 0 건은 빠진다', () {
    final rows = buildVitalRows(_event(
      counts: {'hrv': 2, 'pe': 3, 'rr': 0, 'dl': 1},
      values: {'hrv': 32.46, 'pe': 4.2, 'dl': 92},
    ));
    expect(rows.map((r) => r.label).toList(), ['운동 강도', '일광 시간', '심박변이(HRV)']);
    expect(rows[0].value, '4.2');
    expect(rows[0].unit, 'MET');
    expect(rows[0].detail, '3건');
    expect(rows[1].display, '92분');
    expect(rows[2].display, '32.5ms');
    // 임계 근거가 없는 종류엔 막대를 붙이지 않는다 — 안전 앱이 의학 판정을 새로 만들지 않는다.
    for (final r in rows) {
      expect(r.range, isNull, reason: '\${r.label} 에 근거 없는 범위 막대가 붙었다');
    }
    // 워치는 폭 때문에 `강도26` 으로 줄인다 — 폰은 그 제약이 없으므로 줄임말을 옮기지 않는다.
    expect(rows.map((r) => r.label), isNot(contains('강도')));
  });

  test('건수만 있고 값이 없으면 -- 로 적는다(0 이 아니다)', () {
    final rows = buildVitalRows(_event(counts: {'rhr': 1}));
    expect(rows.single.value, '--');
    // 값이 없으면 단위도 비운다 — `--bpm` 은 값처럼 읽힌다.
    expect(rows.single.unit, '');
    expect(rows.single.display, '--');
    expect(rows.single.detail, '1건');
  });

  test('걸음·오른층은 누계 기준을 함께 적는다 — 하루 총량이 아니다', () {
    final rows = buildVitalRows(_event(steps: 1204, flights: 3));
    expect(rows[0].display, '1,204보');
    expect(rows[0].detail, '폰 수신 누계');
    expect(rows[1].display, '3층');
  });

  test('정지 지속은 0 초도 표시한다 — 못 잰 것(null)과 다르다', () {
    expect(buildVitalRows(_event(stillSec: 0)).single.display, '0.0초');
    expect(buildVitalRows(_event(stillSec: 42.34)).single.display, '42.3초');
  });

  test('자릿수 구분', () {
    expect(formatCount(0), '0');
    expect(formatCount(999), '999');
    expect(formatCount(1000), '1,000');
    expect(formatCount(1234567), '1,234,567');
  });

  group('활동에너지 금지 — 상시 워크아웃 탓에 약 4배 과대(2026-08-15 실측)', () {
    test('표시 행 어디에도 활동에너지가 없다', () {
      final rows = buildVitalRows(_event(
        spo2: 97,
        steps: 100,
        stillSec: 5,
        counts: {'pe': 1, 'dl': 1, 'rhr': 1, 'whr': 1, 'rr': 1, 'hrv': 1},
        values: {'pe': 4.2, 'dl': 92, 'rhr': 61, 'whr': 108, 'rr': 14, 'hrv': 32},
      ));
      // 여섯 이산 + SpO₂ + 걸음 + 정지 = 9 행. 늘었다면 무엇이 들어왔는지 확인할 것.
      expect(rows.length, 9);
      for (final r in rows) {
        expect(r.label, isNot(contains('활동')));
        expect(r.display, isNot(contains('kcal')));
      }
    });

    test('네이티브 표시 경로가 ae 를 싣지 않는다', () {
      final src = File('ios/Runner/PhoneReceiver.swift').readAsStringSync();
      // 앵커 — 대상이 사라지면 금지형 가드는 조용히 통과한다(L-79).
      final start = src.indexOf('private func updateSnapshot');
      final end = src.indexOf('// MARK: - WCSessionDelegate');
      expect(start, greaterThan(-1), reason: '표시 스냅숏 조립부가 사라졌다 — 가드를 갱신할 것');
      expect(end, greaterThan(start), reason: '조립부와 델리게이트 경계가 뒤집혔다');

      final region = src.substring(start, end);
      expect(region.contains('"ae"'), isFalse,
          reason: '활동에너지가 표시 경로에 들어왔다 — 정지 상태 288kcal/시간으로 약 4배 과대다');
      // 근거가 사라지면 다음 사람이 "빠뜨린 것" 으로 읽고 채워 넣는다.
      expect(src, contains('heat-activity-axis'));
    });

    test('심박 없는 배치도 화면으로 나간다 — 미착용 구간이 정지 지속의 핵심 용도', () {
      final src = File('ios/Runner/PhoneReceiver.swift').readAsStringSync();
      expect(src, contains('if !samples.isEmpty {'));
      // 종전 조건(심박이 있을 때만 emit)이 되살아나면 그 구간이 통째로 안 보인다.
      expect(src.contains('if let bpm = latest {'), isFalse);
    });
  });

  _sectionTests();
}

// ── 2026-08-18 UI 개편 ──────────────────────────────────────────────────
void _sectionTests() {
  test('활동 지표는 생체 격자와 분리된다 — 성격이 다른 값을 나란히 두지 않는다', () {
    final rows = buildVitalRows(VitalStreamEvent(
      type: 'hr',
      spo2: 97,
      steps: 1204,
      flights: 3,
      stillSec: 5,
      discreteCounts: const {'hrv': 1, 'rr': 1},
      discreteValues: const {'hrv': 32.4, 'rr': 14},
    ));
    final s = splitVitalSections(rows);
    expect(s.body.map((r) => r.label).toList(), ['산소포화도', '호흡수', '심박변이(HRV)']);
    expect(s.activity.map((r) => r.label).toList(), ['걸음', '오른 층', '정지 지속']);
    // 나뉘어도 하나도 사라지지 않는다.
    expect(s.body.length + s.activity.length, rows.length);
  });
}
