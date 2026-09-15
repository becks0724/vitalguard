import 'package:flutter/material.dart';

import '../../data/models/site_status.dart';
import 'site_detail_widgets.dart';

/// S-06. 현장 고정 좌표·서버 판정·기상 원본 수신 시각을 함께 밝힌다.
class WeatherScreen extends StatelessWidget {
  const WeatherScreen({
    super.key,
    required this.weather,
    required this.forbidden,
    required this.receipt,
    required this.onBack,
  });

  final SiteStatusWeather? weather;
  final bool forbidden;
  final Widget receipt;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final data = forbidden ? null : weather;
    final current = data?.current;
    // WeatherStrip의 순간풍속 우선 표기. 0도 수신값이다.
    // km/h → m/s 환산·반올림은 표시에서만 하며 서버 원값·level·summary는 보존한다.
    final windKmh = current?.windGustKmh ?? current?.windKmh;
    final windBasis = current?.windGustKmh != null
        ? '순간풍속 기준 · 평균 ${_reading(current?.windKmh == null ? null : current!.windKmh! / 3.6, 'm/s', 1)}'
        : current?.windKmh != null
        ? '평균풍속 기준 · 순간풍속 -- m/s'
        : '순간·평균풍속 미수신';
    return SiteDetailBody(
      prefix: 'weather',
      title: '기상·특보 상세',
      receipt: receipt,
      onBack: onBack,
      children: [
        if (!forbidden)
          if (data == null)
            const Text('기상 데이터 없음 · 아직 받지 못했습니다')
          else if (!data.ok)
            const Text(
              '기상 수신 실패 · 현장 기상을 확인할 수 없습니다. 새로고침해 주세요.',
              key: Key('weather-section-error'),
            )
          else ...[
            // 캐시 표시는 원본 fetchedAt을 표시하는 receipt 바로 다음에 둔다.
            Text(switch (data.cached) {
              true => '캐시에서 받은 기상 값 · 위 마지막 수신 시각 기준',
              false => '캐시를 사용하지 않은 기상 응답 · 위 마지막 수신 시각 기준',
              null => '캐시 사용 여부 데이터 없음',
            }, key: const Key('weather-cache')),
            Text(
              switch (data.stale) {
                true => '오래된 기상 값 · 서버가 오래됨으로 표시했습니다. 이전 수신 값입니다.',
                false => '서버 오래됨 표시 없음 · 수신 시각을 함께 확인해 주세요.',
                null => '서버 오래됨 여부 데이터 없음',
              },
              key: const Key('weather-server-stale'),
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            if (data.persisted == true)
              const Text('저장된 기상 자료로 대체한 값입니다.', key: Key('weather-persisted')),
            const SizedBox(height: 16),
            SiteDetailPanel(
              children: [
                const SiteDetailRow(
                  child: Text(
                    '현장 고정 좌표 기준',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '위도 ${data.lat ?? '데이터 없음'} · 경도 ${data.lon ?? '데이터 없음'}',
                        key: const Key('weather-coordinates'),
                      ),
                      const Text('담당관의 현재 위치가 아닌 현장에 저장된 좌표의 기상입니다.'),
                      Text(
                        '좌표 출처 ${switch (data.coordSource) {
                          'address' => '현장 주소',
                          'cache' => '저장된 현장 좌표',
                          'weatherDaily' => '저장된 현장 기상 좌표',
                          _ => data.coordSource ?? '데이터 없음',
                        }}',
                      ),
                      Text('기상 출처 ${data.source ?? '데이터 없음'}'),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            SiteDetailPanel(
              key: const Key('weather-judgment'),
              children: [
                SiteDetailRow(
                  child: SiteDetailJudgment(level: data.level, title: '현장 기상'),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        data.summary ?? '요약 데이터 없음',
                        key: const Key('weather-summary'),
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        data.headlineBasis == null
                            ? '대표 판정 근거 · 서버 요약에 항목이 명시되지 않았습니다'
                            : '대표 판정 근거 · ${data.headlineBasis} (서버 요약 기준)',
                        key: const Key('weather-basis'),
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const Text('대표 근거 외에 함께 적용된 모든 판정은 확인할 수 없습니다.'),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Text(
              '현재 기상 · 마지막 수신 값',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            Text('관측 출처 ${current?.obsSource ?? '데이터 없음'}'),
            Text(
              '관측 시각 ${alertTime(current?.obsAt)}',
              key: const Key('weather-observed-at'),
            ),
            if (current == null) const Text('현재 기상 데이터 없음 · 값을 받지 못했습니다'),
            const SizedBox(height: 16),
            SiteDetailPanel(
              key: const Key('weather-current'),
              children: [
                for (final (index, reading) in [
                  ('temperature', '기온', current?.temperatureC, '℃', 1),
                  ('humidity', '습도', current?.humidityPct, '%', 0),
                  ('apparent', '체감온도', current?.apparentTempC, '℃', 1),
                  (
                    'wind',
                    '풍속',
                    windKmh == null ? null : windKmh / 3.6,
                    'm/s',
                    1,
                  ),
                  ('precipitation', '강수량', current?.precipitationMm, 'mm/h', 1),
                  ('uv', '자외선지수', current?.uvIndex, '', 1),
                  ('pm10', '미세먼지 PM10', current?.pm10, 'μg/㎥', 0),
                  ('pm25', '미세먼지 PM2.5', current?.pm25, 'μg/㎥', 0),
                  ('wbgt', 'WBGT', current?.wbgt, '℃', 1),
                ].indexed) ...[
                  if (index > 0) const Divider(height: 1),
                  SiteDetailRow(
                    key: Key('weather-reading-${reading.$1}'),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${reading.$2} ${_reading(reading.$3, reading.$4, reading.$5)}',
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (reading.$1 == 'wind')
                          Text(windBasis, key: const Key('weather-wind-basis')),
                        if (reading.$1 == 'wbgt') const Text('습구흑구 (참고)'),
                      ],
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 16),
            _Warnings(warning: data.warning),
          ],
      ],
    );
  }
}

// WeatherCurrent는 서버 수치를 그대로 보관하고 화면에서만 자릿수를 제한한다.
String _reading(num? value, String unit, int digits) =>
    '${value?.toStringAsFixed(digits) ?? '--'}${unit.isEmpty ? '' : ' $unit'}';

class _Warnings extends StatelessWidget {
  const _Warnings({required this.warning});
  final WeatherWarning? warning;

  @override
  Widget build(BuildContext context) => SiteDetailPanel(
    key: const Key('weather-warnings'),
    children: [
      Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('특보 지역 ${warning?.sido ?? '데이터 없음'}'),
            Text(switch (warning?.source) {
              'mock' => '특보 출처 · 모의 데이터 (샘플)',
              'live' => '특보 출처 · 기상청 실연동',
              _ => '특보 출처 데이터 없음',
            }, key: const Key('weather-warning-source')),
          ],
        ),
      ),
      for (final preliminary in [false, true]) ...[
        if (preliminary) const Divider(height: 1),
        SiteDetailRow(
          key: Key(
            preliminary
                ? 'weather-preliminary-header'
                : 'weather-active-header',
          ),
          child: SiteDetailJudgment(
            title: preliminary ? '예비특보' : '발효특보',
            level: preliminary
                ? warning?.preliminarySeverity
                : warning?.severity,
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: _warningContents(preliminary),
        ),
      ],
    ],
  );

  Widget _warningContents(bool preliminary) {
    final title = preliminary ? '예비특보' : '발효특보';
    final available = preliminary
        ? warning?.preliminaryAvailable
        : warning?.warningsAvailable;
    final summary = preliminary
        ? warning?.preliminarySummary
        : warning?.summary;
    final rows =
        (preliminary ? warning?.preliminary : warning?.warnings) ??
        const <WeatherWarningItem>[];
    final omitted =
        (preliminary
            ? warning?.omittedPreliminary
            : warning?.omittedWarnings) ??
        0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(summary ?? '$title 요약 데이터 없음'),
        if (available != true)
          Text('$title 데이터 없음 · 목록을 받지 못했습니다')
        else if (rows.isEmpty && omitted == 0)
          Text('$title 0건 · 수신한 목록이 비어 있습니다'),
        if (omitted > 0) Text('$title $omitted건의 내용을 확인할 수 없습니다'),
        for (final (index, item) in rows.indexed)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Column(
              key: Key(
                'weather-${preliminary ? 'preliminary' : 'active'}-$index',
              ),
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  preliminary
                      ? item.type
                      : '${item.type} · ${item.level ?? '단계 데이터 없음'}',
                ),
                if (preliminary)
                  Text(
                    '발효 예정 ${item.when == null ? '데이터 없음' : alertTime(item.when)}',
                  ),
                Text(
                  '대상 지역 ${item.regions.isEmpty ? '데이터 없음' : item.regions.join(' · ')}',
                ),
                if ((item.otherRegionCount ?? 0) > 0)
                  Text('그 밖의 지역 ${item.otherRegionCount}곳 (서버 집계)'),
              ],
            ),
          ),
      ],
    );
  }
}
