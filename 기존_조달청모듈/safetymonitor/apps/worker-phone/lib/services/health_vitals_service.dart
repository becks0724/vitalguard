import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:health/health.dart';

import '../models/vital_sample.dart';

class HealthVitalsService {
  HealthVitalsService({Health? health}) : _health = health ?? Health();

  final Health _health;
  bool _configured = false;

  // SLEEP_WRIST_TEMPERATURE 는 iOS HealthKit 전용 (`appleSleepingWristTemperature`).
  // Android Health Connect 에는 매핑이 없어, health 13.3.1 의 preparePermissionsList 가
  // 미지원 타입 발견 시 null 반환 → requestAuthorization 즉시 false → 권한 다이얼로그 미표시.
  // 따라서 Android 는 wrist temp 를 제외하고, 손목 온도는 BODY_TEMPERATURE 폴백에 의존한다.
  static final List<HealthDataType> _types = [
    HealthDataType.HEART_RATE,
    HealthDataType.BLOOD_OXYGEN,
    if (Platform.isIOS) HealthDataType.SLEEP_WRIST_TEMPERATURE,
    HealthDataType.BODY_TEMPERATURE,
  ];

  // 스트레스 알고리즘 입력 (P0). iOS(Apple Watch) 한정 —
  // Android Health Connect 는 SDNN/보행심박 매핑이 불확실해, 미지원 타입이 섞이면
  // health 13.3.1 preparePermissionsList 가 null 반환 → requestAuthorization 전체가
  // false 가 되어 기존 vital 권한까지 막힌다(SLEEP_WRIST_TEMPERATURE 와 동일 함정).
  static final List<HealthDataType> _stressTypes = [
    if (Platform.isIOS) ...[
      HealthDataType.HEART_RATE_VARIABILITY_SDNN,
      HealthDataType.RESTING_HEART_RATE,
      HealthDataType.ACTIVE_ENERGY_BURNED,
      HealthDataType.STEPS,
      HealthDataType.WALKING_HEART_RATE,
      HealthDataType.FLIGHTS_CLIMBED,
      HealthDataType.RESPIRATORY_RATE,
    ],
  ];

  static final List<HealthDataType> _allTypes = [..._types, ..._stressTypes];

  Future<bool> requestReadAccess() async {
    if (!_configured) {
      await _health.configure();
      _configured = true;
    }

    return _health.requestAuthorization(
      _allTypes,
      permissions: _allTypes.map((_) => HealthDataAccess.READ).toList(),
    );
  }

  Future<VitalSample> readLatestVitals({
    required String workerId,
    String? workerName,
    String? employeeId,
  }) async {
    final now = DateTime.now();

    // [maxAge] 지정 시, lookback 안에서 가장 최근 값을 찾되 그 측정 시각이 maxAge 보다
    // 오래됐으면 null 을 반환한다. 워치를 벗거나 센서가 끊겨도 수 시간/일 전 측정값을
    // ts=now 로 실시간처럼 전송해 대시보드가 "정상"으로 오인(false-OK)하는 것을 막는다.
    // lookback 은 값을 "찾기 위한" 범위, maxAge 는 "실시간으로 인정하는" 범위로 역할이 다르다.
    Future<num?> latestValue(
      HealthDataType type, {
      required Duration lookback,
      Duration? maxAge,
    }) async {
      try {
        final points = await _health.getHealthDataFromTypes(
          types: [type],
          startTime: now.subtract(lookback),
          endTime: now,
        );
        final matching = points.where((point) => point.type == type).toList()
          ..sort((a, b) => b.dateTo.compareTo(a.dateTo));
        if (matching.isEmpty) {
          return null;
        }

        final latest = matching.first;
        if (maxAge != null && now.difference(latest.dateTo) > maxAge) {
          debugPrint(
            'Health $type stale: measured ${latest.dateTo} '
            '(> ${maxAge.inMinutes}분 전) → 미전송',
          );
          return null;
        }

        final value = latest.value;
        if (value is NumericHealthValue) {
          return value.numericValue;
        }

        final json = value.toJson();
        return json['numeric_value'] as num?;
      } catch (error, stack) {
        debugPrint('Health read failed for $type: $error\n$stack');
        return null;
      }
    }

    final spo2 = await latestValue(
      HealthDataType.BLOOD_OXYGEN,
      lookback: const Duration(days: 7),
      maxAge: const Duration(minutes: 30), // SpO₂ 는 간헐 스팟 — 30분 넘으면 stale
    );
    final sample = VitalSample(
      workerId: workerId,
      workerName: workerName,
      employeeId: employeeId,
      ts: now,
      hr: await latestValue(
        HealthDataType.HEART_RATE,
        lookback: const Duration(hours: 6),
        maxAge: const Duration(minutes: 5), // 착용 중이면 HR 은 연속 — 5분 넘으면 끊김으로 간주
      ),
      spo2: spo2 != null && spo2 <= 1 ? spo2 * 100 : spo2,
      skinTempC:
          await latestValue(
            HealthDataType.SLEEP_WRIST_TEMPERATURE,
            lookback: const Duration(days: 30),
          ) ??
          await latestValue(
            HealthDataType.BODY_TEMPERATURE,
            lookback: const Duration(days: 30),
          ),
    );

    debugPrint(
      'Health latest vital sample: '
      'hr=${sample.hr}, spo2=${sample.spo2}, skinTempC=${sample.skinTempC}',
    );

    return sample;
  }

  // 스트레스 알고리즘 입력 수집 (P0 — raw 만, 분석 없음). 60초 sub-cadence 로 호출.
  // 누적형(활동에너지/계단)은 [cumulativeWindow] 구간 합, 걸음은 getTotalStepsInInterval,
  // 나머지(HRV/안정심박/보행심박/호흡)는 lookback 내 최신값. iOS 한정.
  Future<StressInputs> readStressInputs({
    Duration cumulativeWindow = const Duration(seconds: 60),
  }) async {
    if (!Platform.isIOS) {
      return const StressInputs();
    }
    final now = DateTime.now();

    num? numericOf(HealthDataPoint point) {
      final value = point.value;
      if (value is NumericHealthValue) {
        return value.numericValue;
      }
      return value.toJson()['numeric_value'] as num?;
    }

    Future<num?> latest(HealthDataType type, Duration lookback) async {
      try {
        final points = await _health.getHealthDataFromTypes(
          types: [type],
          startTime: now.subtract(lookback),
          endTime: now,
        );
        final matching = points.where((p) => p.type == type).toList()
          ..sort((a, b) => b.dateTo.compareTo(a.dateTo));
        return matching.isEmpty ? null : numericOf(matching.first);
      } catch (error) {
        debugPrint('Stress latest read failed for $type: $error');
        return null;
      }
    }

    Future<num?> sumOver(HealthDataType type, Duration window) async {
      try {
        final points = await _health.getHealthDataFromTypes(
          types: [type],
          startTime: now.subtract(window),
          endTime: now,
        );
        num total = 0;
        var any = false;
        for (final p in points.where((p) => p.type == type)) {
          final n = numericOf(p);
          if (n != null) {
            total += n;
            any = true;
          }
        }
        return any ? total : null;
      } catch (error) {
        debugPrint('Stress sum read failed for $type: $error');
        return null;
      }
    }

    num? stepsTotal;
    try {
      stepsTotal = await _health.getTotalStepsInInterval(
        now.subtract(cumulativeWindow),
        now,
      );
    } catch (error) {
      debugPrint('getTotalStepsInInterval failed: $error');
    }

    final inputs = StressInputs(
      hrvSdnnMs: await latest(
        HealthDataType.HEART_RATE_VARIABILITY_SDNN,
        const Duration(hours: 2),
      ),
      restingHeartRate: await latest(
        HealthDataType.RESTING_HEART_RATE,
        const Duration(days: 1),
      ),
      walkingHeartRate: await latest(
        HealthDataType.WALKING_HEART_RATE,
        const Duration(days: 1),
      ),
      respiratoryRate: await latest(
        HealthDataType.RESPIRATORY_RATE,
        const Duration(days: 1),
      ),
      activeEnergyKcal: await sumOver(
        HealthDataType.ACTIVE_ENERGY_BURNED,
        cumulativeWindow,
      ),
      flightsClimbed: await sumOver(
        HealthDataType.FLIGHTS_CLIMBED,
        cumulativeWindow,
      ),
      steps: stepsTotal,
    );

    debugPrint(
      'Stress inputs: hrv=${inputs.hrvSdnnMs}, rhr=${inputs.restingHeartRate}, '
      'energy=${inputs.activeEnergyKcal}, steps=${inputs.steps}, '
      'walkHr=${inputs.walkingHeartRate}, flights=${inputs.flightsClimbed}, '
      'rr=${inputs.respiratoryRate}',
    );

    return inputs;
  }
}

// 스트레스 알고리즘 입력 묶음 — 모두 optional (센서/데이터 없으면 null).
class StressInputs {
  const StressInputs({
    this.hrvSdnnMs,
    this.restingHeartRate,
    this.activeEnergyKcal,
    this.steps,
    this.walkingHeartRate,
    this.flightsClimbed,
    this.respiratoryRate,
  });

  final num? hrvSdnnMs;
  final num? restingHeartRate;
  final num? activeEnergyKcal;
  final num? steps;
  final num? walkingHeartRate;
  final num? flightsClimbed;
  final num? respiratoryRate;
}
