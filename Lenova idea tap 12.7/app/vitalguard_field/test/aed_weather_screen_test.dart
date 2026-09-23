import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/site/site_screen.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/aed_weather_fixture.dart';

// SingleChildScrollView는 자식을 미리 만든다. 화면 밖 자식을 명시적으로 드러낸
// 다음 기본 finder로 검증한다. 숨은 IndexedStack의 내용은 검증에 섞지 않는다.
Future<void> _reveal(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key), skipOffstage: false));
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, String key) async {
  await _reveal(tester, key);
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Future<String> _text(WidgetTester tester, String key) async {
  await _reveal(tester, key);
  return tester.widget<Text>(find.byKey(Key(key))).data!;
}

Future<void> _expectVisibleText(WidgetTester tester, String text) async {
  await tester.ensureVisible(find.text(text, skipOffstage: false));
  await tester.pumpAndSettle();
  expect(find.text(text).hitTestable(), findsOneWidget);
}

void _expectInsideViewport(
  WidgetTester tester,
  Finder target,
  Finder scrollable,
) {
  final screen =
      Offset.zero & (tester.view.physicalSize / tester.view.devicePixelRatio);
  final viewport = tester.getRect(scrollable).intersect(screen);
  final rect = tester.getRect(target);
  expect(
    viewport.inflate(0.01).intersect(rect),
    rect,
    reason: '$target 전체가 스크롤 영역 안에 보여야 한다',
  );
}

void main() {
  testWidgets('AED 기기별 위치·서버 판정·배터리와 패드의 경과·오늘·미수신 문구', (tester) async {
    final f = _Fixture();
    await f.mount(tester, 'aed');
    await _reveal(tester, 'aed-header-aed-1');
    expect(find.text('현장 출입구 · 판정 위험'), findsOneWidget);
    expect(await _text(tester, 'aed-battery-aed-1'), '배터리 교환 3일 지남');
    expect(await _text(tester, 'aed-pads-aed-1'), '전극패드 교환 0일 남음 · 오늘 교환 예정');
    expect(await _text(tester, 'aed-battery-aed-2'), '배터리 교환 120일 남음');
    expect(await _text(tester, 'aed-pads-aed-2'), '전극패드 교환 35일 남음');
    expect(await _text(tester, 'aed-battery-aed-3'), '배터리 교환 데이터 없음');
    expect(await _text(tester, 'aed-pads-aed-3'), '전극패드 교환 데이터 없음');
    await f.close(tester);
  });

  testWidgets('AED idle에서 등록 0대와 집계·목록 미수신이 다르게 보인다', (tester) async {
    final f = _Fixture();
    f.gateway.reply['aed'] = {
      'ok': true,
      'level': 'idle',
      'summary': '등록된 AED 없음',
      'total': 0,
      'devices': [],
    };
    await f.mount(tester, 'aed');
    expect(await _text(tester, 'aed-total'), '등록 기기 0대');
    expect(await _text(tester, 'aed-empty'), contains('등록된 AED 0대'));
    await _tap(tester, 'aed-back');
    await _reveal(tester, 'site-row-aed');
    expect(find.textContaining('장비 0대', findRichText: true), findsOneWidget);
    await _tap(tester, 'site-row-aed');
    f.gateway.reply['aed'] = {'ok': true, 'level': 'idle'};
    await _tap(tester, 'aed-refresh');
    expect(await _text(tester, 'aed-total'), '등록 기기 수 데이터 없음');
    expect(await _text(tester, 'aed-list-missing'), contains('목록을 받지 못했습니다'));
    expect(
      find.textContaining('등록된 AED 0대', skipOffstage: false),
      findsNothing,
    );
    await f.close(tester);
  });

  testWidgets('AED 빈 목록이라도 total 누락·양수이면 등록 0대를 만들어내지 않는다', (tester) async {
    final f = _Fixture();
    f.gateway.reply['aed'] = {'ok': true, 'level': 'idle', 'devices': []};
    await f.mount(tester, 'aed');
    expect(await _text(tester, 'aed-empty'), contains('기기 데이터 없음'));
    f.aed['total'] = 2;
    await _tap(tester, 'aed-refresh');
    expect(await _text(tester, 'aed-empty'), contains('기기 데이터 없음'));
    expect(await _text(tester, 'aed-total'), '등록 기기 2대');
    await f.close(tester);
  });

  testWidgets('기상 현장 고정 좌표·출처·현재값·관측 시각을 밝히고 0을 보존한다', (tester) async {
    final f = _Fixture();
    await f.mount(tester, 'weather');
    expect(
      await _text(tester, 'weather-coordinates'),
      '위도 35.1595 · 경도 126.8526',
    );
    await _expectVisibleText(tester, '현장 고정 좌표 기준');
    await _expectVisibleText(tester, '담당관의 현재 위치가 아닌 현장에 저장된 좌표의 기상입니다.');
    expect(
      await _text(tester, 'weather-observed-at'),
      '관측 시각 2026-09-14 22:00:00 KST',
    );
    for (final (key, value) in [
      ('temperature', '기온 28.0 ℃'),
      ('humidity', '습도 65 %'),
      ('apparent', '체감온도 29.4 ℃'),
      ('wind', '풍속 0.0 m/s'),
      ('precipitation', '강수량 0.0 mm/h'),
    ]) {
      await _reveal(tester, 'weather-reading-$key');
      expect(find.text(value), findsOneWidget);
    }
    await f.close(tester);
  });

  testWidgets('실기기 기상 소수 자릿수·단위를 관제와 맞추고 순간풍속을 대표로 표시한다', (tester) async {
    final f = _Fixture();
    (f.weather['current'] as Map).addAll(<String, dynamic>{
      'temperatureC': 26,
      'humidityPct': 52.5,
      'apparentTempC': 25.794354403025757,
      'windKmh': 6.48,
      'windGustKmh': 32.4,
      'precipitationMm': 1.26,
      'uvIndex': 2.36,
      'pm10': 12.6,
      'pm25': 7.6,
      'wbgt': 25.36,
    });
    await f.mount(tester, 'weather');
    for (final (key, value) in [
      ('temperature', '기온 26.0 ℃'),
      ('humidity', '습도 53 %'),
      ('apparent', '체감온도 25.8 ℃'),
      ('wind', '풍속 9.0 m/s'),
      ('precipitation', '강수량 1.3 mm/h'),
      ('uv', '자외선지수 2.4'),
      ('pm10', '미세먼지 PM10 13 μg/㎥'),
      ('pm25', '미세먼지 PM2.5 8 μg/㎥'),
      ('wbgt', 'WBGT 25.4 ℃'),
    ]) {
      await _reveal(tester, 'weather-reading-$key');
      expect(find.text(value), findsOneWidget);
    }
    await _expectVisibleText(tester, '순간풍속 기준 · 평균 1.8 m/s');
    await _expectVisibleText(tester, '습구흑구 (참고)');
    final panel = find.byKey(const Key('weather-current'));
    for (final forbidden in [
      '25.794354403025757',
      'km/h',
      '불쾌지수',
      '일출',
      '일몰',
    ]) {
      expect(
        find.descendant(of: panel, matching: find.textContaining(forbidden)),
        findsNothing,
      );
    }
    await f.close(tester);
  });

  testWidgets('순간풍속 0도 수신값이며 평균이 더 커도 헤드라인을 대체하지 않는다', (tester) async {
    final f = _Fixture();
    (f.weather['current'] as Map).addAll(<String, dynamic>{
      'windKmh': 6.48,
      'windGustKmh': 0,
    });
    await f.mount(tester, 'weather');
    await _expectVisibleText(tester, '풍속 0.0 m/s');
    await _expectVisibleText(tester, '순간풍속 기준 · 평균 1.8 m/s');
    await f.close(tester);
  });

  for (final missing in [true, false]) {
    testWidgets('순간풍속 ${missing ? '키 누락' : 'null'}이면 평균을 m/s 헤드라인으로 쓴다', (
      tester,
    ) async {
      final f = _Fixture();
      final current = f.weather['current'] as Map;
      current['windKmh'] = 6.48;
      if (missing) {
        current.remove('windGustKmh');
      } else {
        current['windGustKmh'] = null;
      }
      await f.mount(tester, 'weather');
      await _expectVisibleText(tester, '풍속 1.8 m/s');
      await _expectVisibleText(tester, '평균풍속 기준 · 순간풍속 -- m/s');
      await f.close(tester);
    });
  }

  testWidgets('평균 미수신이어도 순간풍속을 보존하고 평균은 두 줄표로 표시한다', (tester) async {
    final f = _Fixture();
    (f.weather['current'] as Map).addAll(<String, dynamic>{
      'windKmh': null,
      'windGustKmh': 32.4,
    });
    await f.mount(tester, 'weather');
    await _expectVisibleText(tester, '풍속 9.0 m/s');
    await _expectVisibleText(tester, '순간풍속 기준 · 평균 -- m/s');
    await f.close(tester);
  });

  testWidgets('현재 수치가 모두 null이면 두 줄표와 단위를 표시하고 값을 합성하지 않는다', (tester) async {
    final f = _Fixture();
    final current = f.weather['current'] as Map;
    for (final key in current.keys.toList()) {
      current[key] = null;
    }
    await f.mount(tester, 'weather');
    for (final text in [
      '기온 -- ℃',
      '습도 -- %',
      '체감온도 -- ℃',
      '풍속 -- m/s',
      '강수량 -- mm/h',
      '자외선지수 --',
      '미세먼지 PM10 -- μg/㎥',
      '미세먼지 PM2.5 -- μg/㎥',
      'WBGT -- ℃',
    ]) {
      await _expectVisibleText(tester, text);
    }
    await f.close(tester);
  });

  testWidgets('잘못된 기상 수치는 두 줄표이고 비유한 순간풍속은 평균으로 대체한다', (tester) async {
    final f = _Fixture();
    (f.weather['current'] as Map).addAll(<String, dynamic>{
      'apparentTempC': '25.8',
      'wbgt': double.infinity,
      'pm25': double.nan,
      'windKmh': 6.48,
      'windGustKmh': double.nan,
    });
    await f.mount(tester, 'weather');
    for (final text in [
      '체감온도 -- ℃',
      'WBGT -- ℃',
      '미세먼지 PM2.5 -- μg/㎥',
      '풍속 1.8 m/s',
    ]) {
      await _expectVisibleText(tester, text);
    }
    await f.close(tester);
  });

  testWidgets('경계 양쪽이 같은 표시로 반올림되어도 서버 원값·판정·요약은 유지한다', (tester) async {
    final f = _Fixture();
    for (final (gust, apparent, level, label, summary) in [
      (35.99, 30.99, 'normal', '정상', '특보 없음 · 광주'),
      (36.01, 31.01, 'warn', '주의', '풍속 순간 36.0km/h (10.0m/s) · 광주'),
    ]) {
      f.weather.addAll(<String, dynamic>{'level': level, 'summary': summary});
      (f.weather['current'] as Map).addAll(<String, dynamic>{
        'windKmh': 6.48,
        'windGustKmh': gust,
        'apparentTempC': apparent,
      });
      if (level == 'normal') {
        await f.mount(tester, 'weather');
      } else {
        await _tap(tester, 'weather-refresh');
      }
      final snapshot = f.controller.siteStatusSnapshot!.weather;
      await _expectVisibleText(tester, '풍속 10.0 m/s');
      await _expectVisibleText(tester, '체감온도 31.0 ℃');
      await _expectVisibleText(tester, '현장 기상 · 판정 $label');
      expect(await _text(tester, 'weather-summary'), summary);
      expect(snapshot.level, level);
      expect(snapshot.summary, summary);
      expect(snapshot.current!.windGustKmh, gust);
      expect(snapshot.current!.windKmh, 6.48);
      expect(snapshot.current!.apparentTempC, apparent);
      expect((f.weather['current'] as Map)['windGustKmh'], gust);
      expect((f.weather['current'] as Map)['apparentTempC'], apparent);
    }
    await f.close(tester);
  });

  testWidgets('cached·stale·persisted와 기상 자체 수신 시각을 함께 표시한다', (tester) async {
    final f = _Fixture();
    f.weather['persisted'] = true;
    await f.mount(tester, 'weather');
    expect(
      await _text(tester, 'weather-receipt'),
      '마지막 수신 2026-09-14 23:00:00 KST',
    );
    expect(await _text(tester, 'weather-cache'), contains('캐시에서 받은'));
    expect(await _text(tester, 'weather-server-stale'), contains('오래된 기상 값'));
    expect(await _text(tester, 'weather-persisted'), contains('저장된 기상 자료'));
    // site-status만 새로 수신해도 기상 캐시 원본 시각은 바뀌지 않는다.
    f.gateway.reply['fetchedAt'] = '2026-09-14T15:14:00Z';
    await _tap(tester, 'weather-refresh');
    expect(
      await _text(tester, 'weather-receipt'),
      '마지막 수신 2026-09-14 23:00:00 KST',
    );
    expect(await _text(tester, 'weather-cache'), contains('캐시에서 받은'));
    await f.close(tester);
  });

  testWidgets('서버 stale=true는 5분 미만이어도 표시하고 캐시·오래됨 여부 누락도 숨기지 않는다', (
    tester,
  ) async {
    final f = _Fixture();
    f.weather['fetchedAt'] = f.gateway.reply['fetchedAt'];
    f.weather['cached'] = false;
    await f.mount(tester, 'weather');
    expect(find.byKey(const Key('weather-stale')), findsNothing);
    expect(await _text(tester, 'weather-server-stale'), contains('오래된 기상 값'));
    expect(await _text(tester, 'weather-cache'), contains('캐시를 사용하지 않은'));
    f.weather.remove('cached');
    f.weather.remove('stale');
    f.weather.remove('fetchedAt');
    await _tap(tester, 'weather-refresh');
    expect(await _text(tester, 'weather-receipt'), contains('마지막 수신 없음'));
    expect(await _text(tester, 'weather-cache'), '캐시 사용 여부 데이터 없음');
    expect(await _text(tester, 'weather-server-stale'), '서버 오래됨 여부 데이터 없음');
    await f.close(tester);
  });

  testWidgets('서버 stale=false여도 기상 수신 시각이 오래되면 S-08 경고를 유지한다', (tester) async {
    final f = _Fixture();
    f.weather['stale'] = false;
    await f.mount(tester, 'weather');
    expect(await _text(tester, 'weather-stale'), contains('오래된 자료'));
    expect(
      await _text(tester, 'weather-server-stale'),
      contains('서버 오래됨 표시 없음'),
    );
    await f.close(tester);
  });

  for (final (summary, basis) in [
    ('기상특보 강풍 · 광주', '발효특보'),
    ('예비특보 호우 예정 · 광주', '예비특보'),
    ('체감온도 33.1℃ · 광주', '체감온도'),
    ('불쾌지수 75.6 (높음) · 광주', '불쾌지수'),
  ]) {
    testWidgets('기상 $basis가 만든 대표 판정을 서버 요약과 표시한다', (tester) async {
      final f = _Fixture();
      f.weather['summary'] = summary;
      await f.mount(tester, 'weather');
      expect(await _text(tester, 'weather-summary'), summary);
      expect(
        await _text(tester, 'weather-basis'),
        '대표 판정 근거 · $basis (서버 요약 기준)',
      );
      await f.close(tester);
    });
  }

  testWidgets('발효·예비특보의 서버 단계·대상 지역·예정 시점과 모의 출처를 표시한다', (tester) async {
    final f = _Fixture();
    f.warning.addAll(<String, dynamic>{
      'source': 'mock',
      'severity': 'danger',
      'summary': '강풍',
      'warnings': [
        {
          'type': '강풍',
          'level': '경보',
          'regions': ['광주', '전남'],
          'otherRegionCount': 2,
        },
      ],
      'preliminarySeverity': 'caution',
      'preliminarySummary': '호우 예정',
      'preliminary': [
        {
          'type': '호우',
          'when': '15일 새벽',
          'regions': ['광주'],
        },
      ],
    });
    await f.mount(tester, 'weather');
    expect(
      await _text(tester, 'weather-warning-source'),
      contains('모의 데이터 (샘플)'),
    );
    await _reveal(tester, 'weather-active-header');
    expect(find.text('발효특보 · 판정 위험'), findsOneWidget);
    await _reveal(tester, 'weather-active-0');
    expect(find.text('강풍 · 경보'), findsOneWidget);
    expect(find.text('대상 지역 광주 · 전남'), findsOneWidget);
    await _reveal(tester, 'weather-preliminary-header');
    expect(find.text('예비특보 · 판정 주의'), findsOneWidget);
    await _reveal(tester, 'weather-preliminary-0');
    expect(find.text('발효 예정 15일 새벽 (서버 값)'), findsOneWidget);
    expect(find.text('대상 지역 광주'), findsOneWidget);
    await f.close(tester);
  });

  testWidgets('좌표·현재값·특보 미수신은 0이나 특보 없음으로 바꾸지 않는다', (tester) async {
    final f = _Fixture();
    f.weather.remove('lat');
    f.weather.remove('lon');
    f.weather.remove('current');
    f.weather.remove('warning');
    await f.mount(tester, 'weather');
    expect(await _text(tester, 'weather-coordinates'), '위도 데이터 없음 · 경도 데이터 없음');
    await _reveal(tester, 'weather-reading-temperature');
    expect(find.text('기온 -- ℃'), findsOneWidget);
    await _reveal(tester, 'weather-warnings');
    expect(find.textContaining('발효특보 데이터 없음'), findsOneWidget);
    expect(find.textContaining('예비특보 데이터 없음'), findsOneWidget);
    expect(find.textContaining('특보 0건', skipOffstage: false), findsNothing);
    await f.close(tester);
  });

  testWidgets('수신한 빈 특보 목록은 발효·예비 각각 0건이다', (tester) async {
    final f = _Fixture();
    await f.mount(tester, 'weather');
    await _reveal(tester, 'weather-warnings');
    expect(find.text('발효특보 0건 · 수신한 목록이 비어 있습니다'), findsOneWidget);
    expect(find.text('예비특보 0건 · 수신한 목록이 비어 있습니다'), findsOneWidget);
    await f.close(tester);
  });

  for (final id in ['aed', 'weather']) {
    testWidgets('$id 상세 시스템 뒤로가기는 요약으로 돌아간다', (tester) async {
      final f = _Fixture();
      await f.mount(tester, id);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('현장 요약'), findsOneWidget);
      expect(f.gateway.calls, 1);
      await f.close(tester);
    });

    testWidgets('$id 첫 요청 실패는 0을 만들지 않고 재조회로 회복한다', (tester) async {
      final f = _Fixture();
      final pending = Completer<SiteStatus>();
      f.gateway.fetch = () => pending.future;
      await f.mount(tester, id);
      expect(await _text(tester, '$id-receipt'), contains('마지막 수신 없음'));
      pending.completeError(const ApiFailure('private'));
      await tester.pumpAndSettle();
      expect(await _text(tester, '$id-refresh-error'), contains('수신 실패'));
      f.gateway.fetch = null;
      await _tap(tester, '$id-refresh');
      expect(find.byKey(Key('$id-refresh-error')), findsNothing);
      await f.close(tester);
    });

    testWidgets('$id 부분 실패는 이전 상세를 지우고 다른 행은 유지한다', (tester) async {
      final f = _Fixture();
      await f.mount(tester, id);
      f.gateway.reply[id] = {'ok': false, 'error': 'private'};
      await _tap(tester, '$id-refresh');
      expect(await _text(tester, '$id-section-error'), contains('수신 실패'));
      expect(
        find.byKey(Key(id == 'aed' ? 'aed-devices' : 'weather-current')),
        findsNothing,
      );
      await _tap(tester, '$id-back');
      for (final other in [
        'aed',
        'weather',
        'workers',
        'gas',
      ].where((x) => x != id)) {
        await _reveal(tester, 'site-row-$other');
        expect(
          find.descendant(
            of: find.byKey(Key('site-row-$other')),
            matching: find.textContaining('수신 실패', findRichText: true),
          ),
          findsNothing,
        );
      }
      expect(f.controller.siteStatusSnapshot!.alerts.unacked, 0);
      await f.close(tester);
    });

    testWidgets('$id 갱신 중·실패·5분 경과에서 이전 수신 시각과 값을 유지한다', (tester) async {
      final f = _Fixture();
      await f.mount(tester, id);
      final before = await _text(tester, '$id-receipt');
      final pending = Completer<SiteStatus>();
      f.gateway.fetch = () => pending.future;
      f.now = f.now.add(const Duration(minutes: 5));
      await _tap(tester, '$id-refresh');
      expect(await _text(tester, '$id-stale'), contains('오래된 자료'));
      pending.completeError(const ApiFailure('private'));
      await tester.pumpAndSettle();
      expect(await _text(tester, '$id-refresh-error'), contains('갱신 실패'));
      expect(await _text(tester, '$id-receipt'), before);
      expect(
        await _text(
          tester,
          id == 'aed' ? 'aed-battery-aed-1' : 'weather-summary',
        ),
        id == 'aed' ? '배터리 교환 3일 지남' : '불쾌지수 75.6 (높음) · 광주',
      );
      f.gateway.fetch = null;
      await _tap(tester, '$id-refresh');
      expect(find.byKey(Key('$id-refresh-error')), findsNothing);
      await f.close(tester);
    });

    testWidgets('$id 403은 자료·자동 재시도를 숨기고 수동 새로고침으로 복구한다', (tester) async {
      final f = _Fixture();
      await f.mount(tester, id);
      f.gateway.fetch = () async =>
          throw const ApiFailure('private', status: 403);
      await _tap(tester, '$id-refresh');
      expect(await _text(tester, '$id-forbidden'), contains('역할과 현장 배정'));
      expect(find.byKey(Key('$id-refresh')), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byKey(Key('$id-refresh'))).onPressed,
        isNotNull,
      );
      expect(
        find.byKey(
          Key(id == 'aed' ? 'aed-devices' : 'weather-coordinates'),
          skipOffstage: false,
        ),
        findsNothing,
      );
      final calls = f.gateway.calls;
      await tester.pump(const Duration(minutes: 10));
      await f.pumpScreen(tester, active: false);
      await f.pumpScreen(tester);
      expect(f.gateway.calls, calls);
      f.gateway.fetch = null;
      await _tap(tester, '$id-refresh');
      expect(f.gateway.calls, calls + 1);
      expect(find.byKey(Key('$id-forbidden')), findsNothing);
      expect(
        find.byKey(Key(id == 'aed' ? 'aed-devices' : 'weather-coordinates')),
        findsOneWidget,
      );
      await _tap(tester, '$id-back');
      await _reveal(tester, 'site-row-$id');
      expect(
        tester.widget<InkWell>(find.byKey(Key('site-row-$id'))).onTap,
        isNotNull,
      );
      await f.close(tester);
    });

    testWidgets('$id 상세는 비활성·inactive→hidden→paused에서 조회를 멈춘다', (tester) async {
      final f = _Fixture();
      await f.mount(tester, id);
      await tester.pump(const Duration(minutes: 1));
      expect(f.gateway.calls, 2);
      await f.pumpScreen(tester, active: false);
      await tester.pump(const Duration(minutes: 2));
      expect(f.gateway.calls, 2);
      await f.pumpScreen(tester);
      expect(f.gateway.calls, 3);
      for (final state in [
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await tester.pump(const Duration(minutes: 2));
      expect(f.gateway.calls, 3);
      for (final state in [
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.resumed,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await tester.pumpAndSettle();
      expect(f.gateway.calls, 4);
      await f.close(tester);
    });

    testWidgets('$id V-5 72dp·T-1 새로고침 64dp·뒤로가기 56dp', (tester) async {
      final f = _Fixture();
      await f.mount(tester, id);
      for (final (key, minimum) in [('$id-back', 56), ('$id-refresh', 64)]) {
        await _reveal(tester, key);
        expect(
          tester.getSize(find.byKey(Key(key))).height,
          greaterThanOrEqualTo(minimum),
        );
        expect(
          tester.getSize(find.byKey(Key(key))).width,
          greaterThanOrEqualTo(56),
        );
      }
      final keys = id == 'aed'
          ? ['aed-header-aed-1', 'aed-header-aed-2', 'aed-header-aed-3']
          : [
              'weather-reading-temperature',
              'weather-reading-humidity',
              'weather-active-header',
              'weather-preliminary-header',
            ];
      for (final key in keys) {
        await _reveal(tester, key);
        expect(tester.getSize(find.byKey(Key(key))).height, 72);
      }
      expect(tester.takeException(), isNull);
      await f.close(tester);
    });

    for (final (size, scale) in [
      (const Size(866, 1385), 1.0),
      (const Size(1385, 866), 1.0),
      (const Size(600, 900), 3.0),
      (const Size(412, 800), 3.0),
    ]) {
      testWidgets(
        '$id 창 ${size.width}×${size.height}·글자 $scale배에서도 끝까지 스크롤한다',
        (tester) async {
          final f = _Fixture();
          await f.mount(tester, id, size: size, scale: scale);
          final keys = id == 'aed'
              ? [
                  'aed-header-aed-1',
                  'aed-battery-aed-1',
                  'aed-pads-aed-1',
                  'aed-header-aed-2',
                  'aed-battery-aed-2',
                  'aed-pads-aed-2',
                  'aed-header-aed-3',
                  'aed-battery-aed-3',
                  'aed-pads-aed-3',
                ]
              : [
                  'weather-coordinates',
                  'weather-basis',
                  'weather-reading-temperature',
                  'weather-reading-humidity',
                  'weather-reading-apparent',
                  'weather-reading-wind',
                  'weather-reading-precipitation',
                  'weather-reading-uv',
                  'weather-reading-pm10',
                  'weather-reading-pm25',
                  'weather-reading-wbgt',
                  'weather-active-header',
                  'weather-preliminary-header',
                ];
          final scrollable = find
              .descendant(
                of: find.byKey(Key('$id-detail-scroll')),
                matching: find.byType(Scrollable),
              )
              .first;
          for (final key in keys) {
            final target = find.byKey(Key(key));
            // 기상 행 중앙은 왼쪽 정렬된 Text 바깥의 빈 공간일 수 있다.
            // 실제 글자까지 드래그한 뒤 행 전체의 화면 내 위치도 검증한다.
            final content = key.startsWith('weather-reading-')
                ? find.descendant(of: target, matching: find.byType(Text)).first
                : target;
            await tester.scrollUntilVisible(
              content.hitTestable(),
              240,
              scrollable: scrollable,
              maxScrolls: 200,
            );
            await _reveal(tester, key);
            _expectInsideViewport(tester, target, scrollable);
            expect(content.hitTestable(), findsOneWidget);
            expect(tester.takeException(), isNull);
          }
          final last = id == 'aed'
              ? find.byKey(const Key('aed-pads-aed-3'))
              : find.text('예비특보 0건 · 수신한 목록이 비어 있습니다');
          await tester.scrollUntilVisible(
            last.hitTestable(),
            240,
            scrollable: scrollable,
            maxScrolls: 200,
          );
          await tester.pumpAndSettle();
          _expectInsideViewport(tester, last, scrollable);
          expect(last.hitTestable(), findsOneWidget);
          expect(
            tester.state<ScrollableState>(scrollable).position.extentAfter,
            closeTo(0, 0.01),
          );
          expect(tester.takeException(), isNull);
          if (scale == 3) {
            final header = id == 'aed'
                ? 'aed-header-aed-1'
                : 'weather-preliminary-header';
            await _reveal(tester, header);
            expect(
              tester.getSize(find.byKey(Key(header))).height,
              greaterThan(72),
            );
          }
          await f.close(tester);
        },
      );
    }
  }
}

class _Gateway extends MockGateway {
  Map<String, dynamic> reply = aedWeatherReply();
  Future<SiteStatus> Function()? fetch;
  int calls = 0;

  @override
  Future<SiteStatus> siteStatus(String accessToken) async {
    calls++;
    return fetch == null ? SiteStatus(reply) : await fetch!();
  }
}

class _Fixture {
  final gateway = _Gateway();
  late final controller = FieldCoordinator(
    gateway,
    MemoryStore(),
    MockSpeechInput(),
  );
  DateTime now = DateTime.parse('2026-09-14T15:13:04.759Z');
  double scale = 1;
  Map get aed => gateway.reply['aed'] as Map;
  Map get weather => gateway.reply['weather'] as Map;
  Map get warning => weather['warning'] as Map;

  Future<void> mount(
    WidgetTester tester,
    String id, {
    Size size = const Size(1000, 1000),
    double scale = 1,
  }) async {
    this.scale = scale;
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await controller.signIn('demo', 'mock');
    await pumpScreen(tester);
    await _tap(tester, 'site-row-$id');
  }

  Future<void> pumpScreen(WidgetTester tester, {bool active = true}) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: vgLightTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: Scaffold(
          body: SiteScreen(
            controller: controller,
            active: active,
            now: () => now,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> close(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  }
}
