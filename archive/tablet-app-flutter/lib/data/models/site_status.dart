import 'record_origin.dart';

/// 응답의 각 구성 요소를 독립적으로 읽는다. 오류 원문은 보관하지 않는다.
class SiteStatus {
  SiteStatus(Map<String, dynamic> json)
    : fetchedAt = _fetchedAt(json),
      weather = SiteStatusWeather(json['weather']),
      workers = SiteStatusWorkers(json['workers']),
      gas = SiteStatusGas(json['gas']),
      aed = SiteStatusAed(json['aed']),
      alerts = SiteStatusAlerts(json['alerts']);

  final String fetchedAt;
  final SiteStatusWeather weather;
  final SiteStatusAed aed;
  final SiteStatusGas gas;
  final SiteStatusWorkers workers;
  final SiteStatusAlerts alerts;

  static String _fetchedAt(Map<String, dynamic> json) {
    final value = json['fetchedAt'];
    if (json['ok'] != true ||
        value is! String ||
        !RegExp(r'(Z|\+00:00)$').hasMatch(value) ||
        DateTime.tryParse(value) == null) {
      throw const FormatException('현장 수신 시각을 확인할 수 없습니다');
    }
    return value;
  }
}

class SiteStatusSection {
  SiteStatusSection(Object? value) {
    if (value is! Map ||
        value['ok'] != true ||
        !const {'normal', 'warn', 'danger', 'idle'}.contains(value['level'])) {
      return;
    }
    ok = true;
    level = value['level'] as String;
    final text = value['summary'];
    summary = text is String && text.trim().isNotEmpty ? text.trim() : null;
    normal = _count(value['normal']);
    waiting = _count(value['waiting']);
    total = _count(value['total']);
  }

  bool ok = false;
  String? level, summary;
  int? normal, waiting, total;
}

/// S-05: readAedStatus의 일수를 보존한다. 교환주기·예정일을 계산하지 않는다.
class SiteStatusAed extends SiteStatusSection {
  SiteStatusAed(Object? value) : super(value) {
    if (!ok || value is! Map) return;
    final rows = value['devices'];
    if (rows is! List) return;
    devicesAvailable = true;
    final parsed = rows.map(AedDevice.tryParse).toList();
    final ids = <String>{};
    final duplicates = <String>{};
    for (final item in parsed) {
      if (item != null && !ids.add(item.deviceId)) {
        duplicates.add(item.deviceId);
      }
    }
    devices = List.unmodifiable(
      parsed.whereType<AedDevice>().where(
        (item) => !duplicates.contains(item.deviceId),
      ),
    );
    omittedDevices = rows.length - devices.length;
  }

  bool devicesAvailable = false;
  int omittedDevices = 0;
  List<AedDevice> devices = const [];
}

class AedDevice {
  AedDevice._(Map row, this.deviceId)
    : loc = _text(row['loc']),
      level = _sectionLevel(row['level']),
      summary = _text(row['summary']),
      batteryDueDays = _signedDays(row['batteryDueDays']),
      padsDueDays = _signedDays(row['padsDueDays']);

  final String deviceId;
  final String? loc, level, summary;
  final int? batteryDueDays, padsDueDays;

  static AedDevice? tryParse(Object? row) {
    if (row is! Map) return null;
    final id = _text(row['deviceId']);
    return id == null ? null : AedDevice._(row, id);
  }
}

int? _signedDays(Object? value) =>
    value is num && value.isFinite && value == value.roundToDouble()
    ? value.toInt()
    : null;

String aedDueText(int? days) => switch (days) {
  null => '데이터 없음',
  < 0 => '${-days}일 지남',
  0 => '0일 남음 · 오늘 교환 예정',
  _ => '$days일 남음',
};

/// S-06: app-site-status/readWeatherStatus, app-site-weather, kma의 실제 필드만 읽는다.
class SiteStatusWeather extends SiteStatusSection {
  SiteStatusWeather(Object? value) : super(value) {
    if (!ok || value is! Map) return;
    lat = _coordinate(value['lat'], 90);
    lon = _coordinate(value['lon'], 180);
    coordSource = _text(value['coordSource']);
    source = _text(value['source']);
    cached = _boolean(value['cached']);
    stale = _boolean(value['stale']);
    persisted = _boolean(value['persisted']);
    fetchedAt = _zonedTime(value['fetchedAt']);
    final receivedCurrent = value['current'];
    if (receivedCurrent is Map) current = WeatherCurrent(receivedCurrent);
    final receivedWarning = value['warning'];
    if (receivedWarning is Map) warning = WeatherWarning(receivedWarning);
  }

  num? lat, lon;
  String? coordSource, source, fetchedAt;
  bool? cached, stale, persisted;
  WeatherCurrent? current;
  WeatherWarning? warning;

  /// 서버는 evaluations를 보내지 않는다. summary의 명시적 항목명만 식별한다.
  /// 수치 임계·우선순위·불쾌지수 식을 복제하거나 개별 판정을 합성하지 않는다.
  String? get headlineBasis {
    if (level != 'warn' && level != 'danger') return null;
    for (final (prefix, label) in const [
      ('기상특보', '발효특보'),
      ('예비특보', '예비특보'),
      ('체감온도', '체감온도'),
      ('불쾌지수', '불쾌지수'),
      ('미세먼지 PM2.5', '미세먼지 PM2.5'),
      ('풍속', '풍속'),
      ('자외선지수', '자외선지수'),
      ('강수량', '강수량'),
    ]) {
      if (summary?.startsWith('$prefix ') == true) return label;
    }
    return null;
  }
}

class WeatherCurrent {
  WeatherCurrent(Map row)
    : temperatureC = _finiteNumber(row['temperatureC']),
      humidityPct = _finiteNumber(row['humidityPct']),
      apparentTempC = _finiteNumber(row['apparentTempC']),
      windKmh = _finiteNumber(row['windKmh']),
      windGustKmh = _finiteNumber(row['windGustKmh']),
      precipitationMm = _finiteNumber(row['precipitationMm']),
      uvIndex = _finiteNumber(row['uvIndex']),
      pm10 = _finiteNumber(row['pm10']),
      pm25 = _finiteNumber(row['pm25']),
      wbgt = _finiteNumber(row['wbgt']),
      obsSource = _text(row['obsSource']),
      obsAt = _zonedTime(row['obsAt']);

  final num? temperatureC, humidityPct, apparentTempC, windKmh, windGustKmh;
  final num? precipitationMm, uvIndex, pm10, pm25, wbgt;
  final String? obsSource, obsAt;
}

class WeatherWarning {
  WeatherWarning(Map row)
    : source = _text(row['source']),
      sido = _text(row['sido']),
      severity = _warningSeverity(row['severity']),
      summary = _text(row['summary']),
      preliminarySeverity = _warningSeverity(row['preliminarySeverity']),
      preliminarySummary = _text(row['preliminarySummary']) {
    final activeRows = row['warnings'];
    final preliminaryRows = row['preliminary'];
    warningsAvailable = activeRows is List;
    preliminaryAvailable = preliminaryRows is List;
    if (activeRows is List) {
      warnings = List.unmodifiable(
        activeRows
            .map((r) => WeatherWarningItem.tryParse(r, false))
            .whereType<WeatherWarningItem>(),
      );
      omittedWarnings = activeRows.length - warnings.length;
    }
    if (preliminaryRows is List) {
      preliminary = List.unmodifiable(
        preliminaryRows
            .map((r) => WeatherWarningItem.tryParse(r, true))
            .whereType<WeatherWarningItem>(),
      );
      omittedPreliminary = preliminaryRows.length - preliminary.length;
    }
  }

  final String? source, sido, severity, summary;
  final String? preliminarySeverity, preliminarySummary;
  bool warningsAvailable = false, preliminaryAvailable = false;
  int omittedWarnings = 0, omittedPreliminary = 0;
  List<WeatherWarningItem> warnings = const [], preliminary = const [];
}

class WeatherWarningItem {
  WeatherWarningItem._(Map row, this.type, bool preliminary)
    : level = preliminary ? null : _text(row['level']),
      when = preliminary ? _text(row['when']) : null,
      regions = row['regions'] is List
          ? List.unmodifiable(
              (row['regions'] as List).whereType<String>().where(
                (s) => s.trim().isNotEmpty,
              ),
            )
          : const [],
      otherRegionCount = _count(row['otherRegionCount']);

  final String type;
  final String? level, when;
  final List<String> regions;
  final int? otherRegionCount;

  static WeatherWarningItem? tryParse(Object? row, bool preliminary) {
    if (row is! Map) return null;
    final type = _text(row['type']);
    return type == null ? null : WeatherWarningItem._(row, type, preliminary);
  }
}

String? _sectionLevel(Object? value) =>
    const {'normal', 'warn', 'danger', 'idle'}.contains(value)
    ? value as String
    : null;
String? _warningSeverity(Object? value) =>
    const {'normal', 'caution', 'danger'}.contains(value)
    ? value as String
    : null;
bool? _boolean(Object? value) => value is bool ? value : null;
String? _zonedTime(Object? value) =>
    value is String &&
        RegExp(r'(Z|[+-]\d{2}:?\d{2})$').hasMatch(value) &&
        DateTime.tryParse(value) != null
    ? value
    : null;

/// S-04. 단위와 판정은 서버 값을 보존하며 농도 환산/임계 판정을 하지 않는다.
class SiteStatusGas extends SiteStatusSection {
  SiteStatusGas(Object? value) : super(value) {
    if (!ok || value is! Map) return;
    deviceId = _gasText(value['deviceId']);
    final time = _gasText(value['lastSeenAt']);
    if (time != null &&
        RegExp(r'(Z|[+-]\d{2}:?\d{2})$').hasMatch(time) &&
        DateTime.tryParse(time) != null) {
      lastSeenAt = time;
    }
    // power의 표현을 임의로 켜짐/꺼짐/배터리 비율로 해석하지 않는다.
    final receivedPower = value['power'];
    power = receivedPower is bool || _finiteNumber(receivedPower) != null
        ? receivedPower.toString()
        : _gasText(receivedPower);
    final rows = value['gases'];
    if (rows is! List) return;
    gasesAvailable = true;
    final parsed = rows.map(GasReading.tryParse).toList();
    final keys = <String>{};
    final duplicates = <String>{};
    for (final item in parsed) {
      if (item != null && !keys.add(item.key)) duplicates.add(item.key);
    }
    gases = List.unmodifiable(
      parsed.whereType<GasReading>().where(
        (item) => !duplicates.contains(item.key),
      ),
    );
    omittedGases = rows.length - gases.length;
  }

  String? deviceId, lastSeenAt, power;
  bool gasesAvailable = false;
  int omittedGases = 0;
  List<GasReading> gases = const [];
}

class GasReading {
  GasReading._(Map row, this.key)
    : gas = _gasText(row['gas']),
      loc = _gasText(row['loc']),
      level = const {'normal', 'warn', 'danger', 'idle'}.contains(row['level'])
          ? row['level'] as String
          : null,
      value = _finiteNumber(row['value']),
      unit = _gasText(row['unit']);

  final String key;
  final String? gas, loc, level, unit;
  final num? value;

  static GasReading? tryParse(Object? row) {
    if (row is! Map || !const {'o2', 'co', 'h2s'}.contains(row['key'])) {
      return null;
    }
    return GasReading._(row, row['key'] as String);
  }
}

// 단위는 문자열만 받는다. 누락/공백/다른 타입에 기본 단위를 만들지 않는다.
String? _gasText(Object? value) =>
    value is String && value.trim().isNotEmpty ? value : null;

/// site-status의 workers 행만 확장한다. 다른 센서의 성공/실패와 독립적이다.
class SiteStatusWorkers extends SiteStatusSection {
  SiteStatusWorkers(Object? value) : super(value) {
    if (!ok || value is! Map) return;
    caution = _count(value['caution']);
    danger = _count(value['danger']);
    stale = _count(value['stale']);
    piiRedacted = value['piiRedacted'] is bool
        ? value['piiRedacted'] as bool
        : null;
    final time = value['fetchedAt'];
    if (time is String &&
        RegExp(r'(Z|[+-]\d{2}:?\d{2})$').hasMatch(time) &&
        DateTime.tryParse(time) != null) {
      fetchedAt = time;
    }
    final rows = value['items'];
    if (rows is! List) return;
    itemsAvailable = true;
    final parsed = rows
        .map(
          (row) =>
              WorkerItem.tryParse(row, exposeLocation: piiRedacted == false),
        )
        .toList();
    final ids = <String>{};
    final duplicates = <String>{};
    for (final item in parsed) {
      if (item != null && !ids.add(item.workerId)) {
        duplicates.add(item.workerId);
      }
    }
    items = List.unmodifiable(
      parsed.whereType<WorkerItem>().where(
        (item) => !duplicates.contains(item.workerId),
      ),
    );
    omittedItems = rows.length - items.length;
  }

  int? caution, danger, stale;
  bool? piiRedacted;
  String? fetchedAt;
  bool itemsAvailable = false;
  int omittedItems = 0;
  List<WorkerItem> items = const [];
}

/// app/admin/workers/route.ts가 실제 보내는 필드만 선별한다.
/// 상태/끊김 임계는 서버가 결정한다. 개인정보 원문 Map은 보관하지 않는다.
class WorkerItem {
  WorkerItem._(Map value, this.workerId, {required bool exposeLocation})
    : name = _text(value['name']),
      jobTitle = _text(value['jobTitle']),
      tone =
          const {'normal', 'caution', 'danger', 'idle'}.contains(value['tone'])
          ? value['tone'] as String
          : null,
      label = _text(value['label']),
      staleLabel = _text(value['staleLabel']),
      heartRate = _finiteNumber(value['heartRate']),
      spo2 = _finiteNumber(value['spo2']),
      skinTempC = _finiteNumber(value['skinTempC']),
      coreTempC = _finiteNumber(value['coreTempC']),
      worn = value['worn'] is bool ? value['worn'] as bool : null,
      lastSeenAt = _text(value['lastSeenAt']),
      ageSec = _count(value['ageSec']),
      stale = value['stale'] is bool ? value['stale'] as bool : null,
      latitude = exposeLocation ? _coordinate(value['latitude'], 90) : null,
      longitude = exposeLocation ? _coordinate(value['longitude'], 180) : null,
      locationAccuracyMeters = exposeLocation
          ? _nonnegativeNumber(value['locationAccuracyMeters'])
          : null;

  final String workerId;
  final String? name, jobTitle, tone, label, staleLabel, lastSeenAt;
  final num? heartRate, spo2, skinTempC, coreTempC;
  final num? latitude, longitude, locationAccuracyMeters;
  final bool? worn, stale;
  final int? ageSec;

  static WorkerItem? tryParse(Object? value, {required bool exposeLocation}) {
    if (value is! Map) return null;
    final id = _text(value['workerId']);
    return id == null
        ? null
        : WorkerItem._(value, id, exposeLocation: exposeLocation);
  }
}

num? _finiteNumber(Object? value) =>
    value is num && value.isFinite ? value : null;
num? _nonnegativeNumber(Object? value) =>
    value is num && value.isFinite && value >= 0 ? value : null;
num? _coordinate(Object? value, int limit) =>
    value is num && value.isFinite && value.abs() <= limit ? value : null;

class SiteStatusAlerts {
  SiteStatusAlerts(Object? value) {
    if (value is! Map || value['ok'] != true) return;
    ok = true;
    unacked = _count(value['unacked']);
    // 누락된 범위를 현장 한정으로 추정하지 않는다.
    siteScoped = value['siteScoped'] is bool
        ? value['siteScoped'] as bool
        : null;
    final rows = value['items'];
    if (rows is! List) return;
    itemsAvailable = true;
    final parsed = rows.map(AlertItem.tryParse).toList();
    final ids = <String>{};
    final duplicates = <String>{};
    for (final item in parsed) {
      if (item != null && !ids.add(item.id)) duplicates.add(item.id);
    }
    items = List.unmodifiable(
      parsed.whereType<AlertItem>().where(
        (item) => !duplicates.contains(item.id),
      ),
    );
    omittedItems = rows.length - items.length;
  }

  bool ok = false;
  int? unacked;
  bool? siteScoped;
  bool itemsAvailable = false;
  int omittedItems = 0;
  List<AlertItem> items = const [];
}

// 관제 정본: dashboard-web/lib/site-chat-context.ts의 ALERT_TYPE_LABEL.
enum AlertType {
  sos('SOS'),
  fall('낙상'),
  vital('생체 이상'),
  geofence('구획 이탈'),
  // 샘플 수신 없이 서버 크론이 생성하는 경보도 정상 종류로 읽는다.
  absence('장기 미수신');

  const AlertType(this.label);
  final String label;
}

/// 서버의 8개 컬럼만 읽는다. 종료/재개 여부는 별도 서버 필드가 아니다.
class AlertItem {
  const AlertItem._(
    this.id,
    this.workerId,
    this.workerName,
    this.type,
    this.ts,
    this.createdAt,
    this.ackAt,
    this.ackBy,
  );

  final String id;
  final String? workerId, workerName, ts, createdAt, ackAt, ackBy;
  final AlertType type;
  bool get acknowledged => ackAt != null;

  static AlertItem? tryParse(Object? value) {
    if (value is! Map) return null;
    final id = _text(value['id']);
    final type = AlertType.values
        .where((t) => t.name == value['type'])
        .firstOrNull;
    // 누락/깨진 ack_at을 미대응(null)으로 오인해서 쓰기를 허용하지 않는다.
    if (id == null ||
        type == null ||
        !value.containsKey('ack_at') ||
        (value['ack_at'] != null && _text(value['ack_at']) == null)) {
      return null;
    }
    return AlertItem._(
      id,
      _text(value['worker_id']),
      _text(value['worker_name']),
      type,
      _text(value['ts']),
      _text(value['created_at']),
      _text(value['ack_at']),
      _text(value['ack_by']),
    );
  }

  bool sameOccurrence(AlertItem other) =>
      id == other.id &&
      workerId == other.workerId &&
      type == other.type &&
      ts == other.ts &&
      createdAt == other.createdAt;
}

String? _text(Object? value) {
  if (value is! String && value is! num) return null;
  final text = value.toString().trim();
  return text.isEmpty ? null : text;
}

/// 시간대가 있는 ISO 시각만 KST로 변환한다. 나머지는 서버 값을 그대로 밝힌다.
String alertTime(String? value) {
  if (value == null) return '시각 정보 없음';
  if (!RegExp(r'(Z|[+-]\d{2}:?\d{2})$').hasMatch(value) ||
      DateTime.tryParse(value) == null) {
    return '$value (서버 값)';
  }
  return '${asKstIso(value).substring(0, 19).replaceFirst('T', ' ')} KST';
}

int? _count(Object? value) =>
    value is num &&
        value.isFinite &&
        value >= 0 &&
        value == value.roundToDouble()
    ? value.toInt()
    : null;

/// 기기 시간대와 무관하게 상단 바와 요약에서 같은 KST 형식을 쓴다.
String siteStatusReceipt(String? fetchedAt) => fetchedAt == null
    ? '마지막 수신 없음 · 데이터 없음 (한 번도 받지 못함)'
    : '마지막 수신 ${asKstIso(fetchedAt).substring(0, 19).replaceFirst('T', ' ')} KST';
