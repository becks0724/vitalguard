import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/models/site_status.dart';

import 'support/gas_fixture.dart';

void main() {
  test('S-04 서버 3종의 수치·단위·판정·위치와 장비 메타데이터를 그대로 받는다', () {
    final gas = SiteStatus(gasStatusReply()).gas;
    expect(gas.ok, isTrue);
    expect(gas.deviceId, 'synthetic-gas-01');
    expect(gas.lastSeenAt, '2026-09-14T15:12:44.759Z');
    expect(gas.power, 'on');
    expect(gas.gasesAvailable, isTrue);
    expect(gas.gases.map((item) => item.key), ['o2', 'co', 'h2s']);
    expect(gas.gases.map((item) => item.gas), [
      'O₂ 산소',
      'CO 일산화탄소',
      'H₂S 황화수소',
    ]);
    expect(gas.gases.map((item) => item.value), [20.9, 151, 10]);
    expect(gas.gases.map((item) => item.unit), ['%', 'raw', 'raw']);
    expect(gas.gases.map((item) => item.level), ['normal', 'warn', 'normal']);
    expect(gas.gases.map((item) => item.loc), [
      '현장 가스 감지기',
      '탱크 야드',
      '현장 가스 감지기',
    ]);
  });

  test('0을 보존하며 누락·null·문자열·비유한 수치를 0으로 만들지 않는다', () {
    final reply = gasStatusReply();
    final row = ((reply['gas'] as Map)['gases'] as List).first as Map;
    row.remove('value');
    expect(SiteStatus(reply).gas.gases.first.value, isNull);
    for (final value in [0, 0.0, null, '151', double.nan, double.infinity]) {
      row['value'] = value;
      expect(
        SiteStatus(reply).gas.gases.first.value,
        value == 0 ? value : isNull,
      );
    }
  });

  test('서버 단위 문자열을 보존하고 누락·잘못된 단위에 종류별 기본값을 넣지 않는다', () {
    final reply = gasStatusReply();
    final row = ((reply['gas'] as Map)['gases'] as List).first as Map;
    for (final unit in ['mV', 'ppm', ' raw ', null, '', '   ', 123]) {
      row['unit'] = unit;
      final item = SiteStatus(reply).gas.gases.first;
      expect(item.value, 20.9, reason: '단위가 바뀌어도 수치는 환산하지 않는다');
      expect(
        item.unit,
        unit is String && unit.trim().isNotEmpty ? unit : isNull,
      );
    }
    row.remove('unit');
    expect(SiteStatus(reply).gas.gases.first.unit, isNull);
  });

  test('gas 부분 실패·깨진 섹션은 다른 세 행과 경보를 훼손하지 않는다', () {
    for (final section in [
      null,
      {'ok': false, 'error': 'synthetic-private-error'},
      {'ok': true, 'level': 'unknown'},
    ]) {
      final data = SiteStatus({...gasStatusReply(), 'gas': section});
      expect(data.gas.ok, isFalse);
      expect(data.gas.gases, isEmpty);
      expect(data.gas.deviceId, isNull);
      expect(data.weather.ok, isTrue);
      expect(data.workers.normal, 0);
      expect(data.aed.total, 0);
      expect(data.alerts.unacked, 0);
    }
  });

  test('가스 빈 목록과 누락·잘못된 목록을 구분하고 측정값을 합성하지 않는다', () {
    final reply = gasStatusReply();
    final gas = reply['gas'] as Map;
    for (final rows in [<Object>[], null, 'invalid']) {
      gas['gases'] = rows;
      final data = SiteStatus(reply).gas;
      expect(data.ok, isTrue);
      expect(data.gasesAvailable, rows is List);
      expect(data.gases, isEmpty);
    }
    gas.remove('gases');
    expect(SiteStatus(reply).gas.gasesAvailable, isFalse);
  });

  test('깨진·중복 종류를 제외하고 알 수 없는 판정은 정상으로 바꾸지 않는다', () {
    final reply = gasStatusReply();
    final gas = reply['gas'] as Map;
    final rows = gas['gases'] as List;
    final co = Map<String, dynamic>.from(rows[1] as Map);
    (rows[0] as Map)['level'] = 'unknown';
    rows.addAll([
      co,
      null,
      {'key': 'other', 'value': 5, 'unit': 'raw'},
    ]);
    final data = SiteStatus(reply).gas;
    expect(data.gases.map((item) => item.key), ['o2', 'h2s']);
    expect(data.gases.first.level, isNull);
    expect(data.omittedGases, 4);
  });

  test('전원 false·0을 보존하고 시각은 시간대가 있는 값만 받아 KST로 표시한다', () {
    final reply = gasStatusReply();
    final gas = reply['gas'] as Map;
    for (final power in [false, true, 0, 'off', null, <String, dynamic>{}]) {
      gas['power'] = power;
      expect(
        SiteStatus(reply).gas.power,
        power == null || power is Map ? isNull : power.toString(),
      );
    }
    gas['lastSeenAt'] = '2026-09-14T11:12:44-04:00';
    expect(
      alertTime(SiteStatus(reply).gas.lastSeenAt),
      '2026-09-15 00:12:44 KST',
    );
    for (final time in [null, 'bad', '2026-09-14T15:12:44']) {
      gas['lastSeenAt'] = time;
      expect(SiteStatus(reply).gas.lastSeenAt, isNull);
    }
  });
}
