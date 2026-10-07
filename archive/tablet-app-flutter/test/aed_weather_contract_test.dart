import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/models/site_status.dart';

import 'support/aed_weather_fixture.dart';

void main() {
  test('AED 교환 일수의 음수·0·양수·없음을 보존하고 서로 다른 문구를 쓴다', () {
    final aed = SiteStatus(aedWeatherReply()).aed;
    expect(aed.devicesAvailable, isTrue);
    expect(aed.total, 3);
    expect(aed.devices.map((d) => d.batteryDueDays), [-3, 120, null]);
    expect(aed.devices.map((d) => d.padsDueDays), [0, 35, null]);
    expect(aed.devices.first.loc, '현장 출입구');
    expect(aed.devices.first.level, 'danger');
    expect(aed.devices.first.summary, 'AED 배터리 교환 필요');
    expect(aedDueText(-3), '3일 지남');
    expect(aedDueText(0), '0일 남음 · 오늘 교환 예정');
    expect(aedDueText(null), '데이터 없음');
    expect(aedDueText(120), '120일 남음');
  });

  test('AED 일수 누락·잘못된 타입·소수·비유한 값은 0으로 바꾸지 않는다', () {
    final reply = aedWeatherReply();
    final row = ((reply['aed'] as Map)['devices'] as List).first as Map;
    for (final value in [null, '0', -0.5, double.nan, double.infinity, true]) {
      row['batteryDueDays'] = value;
      row['padsDueDays'] = value;
      final device = SiteStatus(reply).aed.devices.first;
      expect(device.batteryDueDays, isNull);
      expect(device.padsDueDays, isNull);
    }
    row.remove('batteryDueDays');
    row.remove('padsDueDays');
    expect(SiteStatus(reply).aed.devices.first.batteryDueDays, isNull);
    expect(SiteStatus(reply).aed.devices.first.padsDueDays, isNull);
  });

  test('AED idle·등록 0대와 수신하지 않은 목록을 구분한다', () {
    final reply = aedWeatherReply();
    reply['aed'] = {'ok': true, 'level': 'idle', 'total': 0, 'devices': []};
    expect(SiteStatus(reply).aed.total, 0);
    expect(SiteStatus(reply).aed.devicesAvailable, isTrue);
    reply['aed'] = {'ok': true, 'level': 'idle'};
    expect(SiteStatus(reply).aed.total, isNull);
    expect(SiteStatus(reply).aed.devicesAvailable, isFalse);
  });

  test('AED 깨진·중복 기기를 제외하고 알 수 없는 판정은 정상으로 바꾸지 않는다', () {
    final reply = aedWeatherReply();
    final rows = (reply['aed'] as Map)['devices'] as List;
    (rows[1] as Map)['level'] = 'unknown';
    rows.addAll([
      Map.from(rows.first as Map),
      null,
      {'loc': '식별 없음'},
    ]);
    final aed = SiteStatus(reply).aed;
    expect(aed.omittedDevices, 4);
    expect(aed.devices.map((d) => d.deviceId), ['aed-2', 'aed-3']);
    expect(aed.devices.first.level, isNull);
  });

  for (final section in ['aed', 'weather']) {
    test('$section 부분 실패·잘못된 구조는 다른 세 행과 경보를 훼손하지 않는다', () {
      for (final value in [
        null,
        'bad',
        {'ok': false, 'error': 'private'},
        {'ok': true, 'level': 'unknown'},
      ]) {
        final data = SiteStatus({...aedWeatherReply(), section: value});
        expect(section == 'aed' ? data.aed.ok : data.weather.ok, isFalse);
        expect(section == 'aed' ? data.weather.ok : data.aed.ok, isTrue);
        expect(data.workers.ok, isTrue);
        expect(data.gas.ok, isTrue);
        expect(data.alerts.unacked, 0);
      }
    });
  }

  test('기상 실제 현재값·고정 좌표·캐시 메타데이터·원본 시각을 읽는다', () {
    final weather = SiteStatus(aedWeatherReply()).weather;
    expect(weather.lat, 35.1595);
    expect(weather.lon, 126.8526);
    expect(weather.coordSource, 'cache');
    expect(weather.source, 'open-meteo');
    expect(weather.cached, isTrue);
    expect(weather.stale, isTrue);
    expect(weather.persisted, isFalse);
    expect(
      siteStatusReceipt(weather.fetchedAt),
      '마지막 수신 2026-09-14 23:00:00 KST',
    );
    final c = weather.current!;
    expect(
      [
        c.temperatureC,
        c.humidityPct,
        c.apparentTempC,
        c.windKmh,
        c.windGustKmh,
        c.precipitationMm,
        c.uvIndex,
        c.pm10,
        c.pm25,
        c.wbgt,
      ],
      [28, 65, 29.4, 0, 0, 0, 0, 12, 7, 25.3],
    );
    expect(c.obsSource, 'kma-ncst');
    expect(alertTime(c.obsAt), '2026-09-14 22:00:00 KST');
    final reply = aedWeatherReply();
    final row = reply['weather'] as Map;
    row['fetchedAt'] = '2026-09-14T10:00:00-04:00';
    (row['current'] as Map)['obsAt'] = '2026-09-14T09:00:00-04:00';
    final offset = SiteStatus(reply).weather;
    expect(
      siteStatusReceipt(offset.fetchedAt),
      '마지막 수신 2026-09-14 23:00:00 KST',
    );
    expect(alertTime(offset.current!.obsAt), '2026-09-14 22:00:00 KST');
  });

  test('기상 0·false는 보존하고 누락·잘못된 수치를 정상값으로 만들지 않는다', () {
    final reply = aedWeatherReply();
    final row = reply['weather'] as Map;
    row.addAll(<String, dynamic>{
      'lat': 0,
      'lon': 0,
      'cached': false,
      'stale': false,
    });
    row['current'] = {
      'temperatureC': 0,
      'humidityPct': null,
      'apparentTempC': '0',
      'windKmh': double.nan,
    };
    var weather = SiteStatus(reply).weather;
    expect(
      [weather.lat, weather.lon, weather.current!.temperatureC],
      [0, 0, 0],
    );
    expect([weather.cached, weather.stale], [false, false]);
    expect([
      weather.current!.humidityPct,
      weather.current!.apparentTempC,
      weather.current!.windKmh,
    ], everyElement(isNull));
    row.addAll(<String, dynamic>{
      'lat': 91,
      'lon': -181,
      'cached': 'false',
      'stale': 0,
      'fetchedAt': '2026-09-14T14:00:00',
    });
    row.remove('persisted');
    weather = SiteStatus(reply).weather;
    expect([
      weather.lat,
      weather.lon,
      weather.cached,
      weather.stale,
      weather.persisted,
      weather.fetchedAt,
    ], everyElement(isNull));
  });

  test('기상 내부 current·warning이 깨져도 요약과 다른 항목을 보존한다', () {
    final reply = aedWeatherReply();
    final row = reply['weather'] as Map;
    row['current'] = 'bad';
    row['warning'] = [];
    final data = SiteStatus(reply);
    expect(data.weather.ok, isTrue);
    expect(data.weather.level, 'warn');
    expect(data.weather.current, isNull);
    expect(data.weather.warning, isNull);
    expect(data.aed.devices.length, 3);
  });

  test('특보 목록 0건·미수신·깨진 항목을 구분하며 서버 단계·지역·예정 시점을 보존한다', () {
    final reply = aedWeatherReply();
    final warning = (reply['weather'] as Map)['warning'] as Map;
    expect(SiteStatus(reply).weather.warning!.warningsAvailable, isTrue);
    warning['warnings'] = [
      null,
      {
        'type': '강풍',
        'level': '주의보',
        'regions': ['광주', '전남'],
        'otherRegionCount': 2,
      },
    ];
    warning['preliminary'] = [
      {
        'type': '호우',
        'when': '15일 새벽',
        'regions': ['광주'],
      },
    ];
    warning['preliminarySeverity'] = 'caution';
    var parsed = SiteStatus(reply).weather.warning!;
    expect(parsed.omittedWarnings, 1);
    expect(parsed.warnings.single.level, '주의보');
    expect(parsed.warnings.single.regions, ['광주', '전남']);
    expect(parsed.warnings.single.otherRegionCount, 2);
    expect(parsed.preliminary.single.when, '15일 새벽');
    expect(parsed.preliminarySeverity, 'caution');
    warning.remove('warnings');
    warning['preliminary'] = 'bad';
    parsed = SiteStatus(reply).weather.warning!;
    expect(parsed.warningsAvailable, isFalse);
    expect(parsed.preliminaryAvailable, isFalse);
  });

  test('대표 근거는 서버 요약만 읽고 고온·습도·특보로 재판정하지 않는다', () {
    final reply = aedWeatherReply();
    final row = reply['weather'] as Map;
    for (final (summary, basis) in [
      ('기상특보 강풍 · 광주', '발효특보'),
      ('예비특보 호우 예정 · 광주', '예비특보'),
      ('체감온도 33.1℃ · 광주', '체감온도'),
      ('불쾌지수 75.6 (높음) · 광주', '불쾌지수'),
      ('풍속 순간 75 km/h · 광주', '풍속'),
      ('미세먼지 PM2.5 80 μg/㎥ · 광주', '미세먼지 PM2.5'),
      ('자외선지수 9.0 · 광주', '자외선지수'),
      ('강수량 20 mm/h · 광주', '강수량'),
    ]) {
      row['summary'] = summary;
      expect(SiteStatus(reply).weather.headlineBasis, basis);
      expect(SiteStatus(reply).weather.level, 'warn');
    }
    row['summary'] = '새로운 서버 요약 · 광주';
    (row['current'] as Map)['apparentTempC'] = 99;
    expect(SiteStatus(reply).weather.headlineBasis, isNull);
    row['level'] = 'normal';
    expect(SiteStatus(reply).weather.level, 'normal');
    expect(SiteStatus(reply).weather.headlineBasis, isNull);
  });
}
