// 워치/폰에서 수집한 단일 시점 생체 샘플 + 워커 메타데이터 (이름·사원번호·보호자·위치)
class VitalSample {
  const VitalSample({
    required this.workerId,
    required this.ts,
    this.workerName,
    this.employeeId,
    this.jobTitle,
    this.guardianName,
    this.guardianPhone,
    this.latitude,
    this.longitude,
    this.hr,
    this.spo2,
    this.skinTempC,
    this.ambientTempC,
    this.manualSos = false,
    this.fallDetected = false,
    this.hrvSdnnMs,
    this.restingHeartRate,
    this.activeEnergyKcal,
    this.steps,
    this.walkingHeartRate,
    this.flightsClimbed,
    this.respiratoryRate,
  });

  final String workerId;
  final DateTime ts;
  final String? workerName;
  final String? employeeId;
  final String? jobTitle; // 직급/직책 — 작업자 폰 ⚙️ 입력값
  final String? guardianName;
  final String? guardianPhone;
  final double? latitude;
  final double? longitude;
  final num? hr;
  final num? spo2;
  final num? skinTempC;
  final num? ambientTempC;
  final bool manualSos;
  final bool fallDetected;
  // 스트레스 알고리즘 입력 (P0) — 60초 sub-cadence 로만 채워지는 sparse 필드.
  // 활동에너지/걸음/계단은 직전 수집 이후 구간 합. 분석은 서버(analyzers) 가 수행.
  final num? hrvSdnnMs;
  final num? restingHeartRate;
  final num? activeEnergyKcal;
  final num? steps;
  final num? walkingHeartRate;
  final num? flightsClimbed;
  final num? respiratoryRate;

  Map<String, dynamic> toJson() {
    return {
      'workerId': workerId,
      'ts': ts.toUtc().toIso8601String(),
      if (workerName != null && workerName!.isNotEmpty) 'workerName': workerName,
      if (employeeId != null && employeeId!.isNotEmpty) 'employeeId': employeeId,
      if (jobTitle != null && jobTitle!.isNotEmpty) 'jobTitle': jobTitle,
      if (guardianName != null && guardianName!.isNotEmpty)
        'guardianName': guardianName,
      if (guardianPhone != null && guardianPhone!.isNotEmpty)
        'guardianPhone': guardianPhone,
      if (latitude != null) 'latitude': latitude,
      if (longitude != null) 'longitude': longitude,
      if (hr != null) 'heartRate': hr,
      if (spo2 != null) 'spo2': spo2,
      if (skinTempC != null) 'skinTempC': skinTempC,
      if (ambientTempC != null) 'ambientTempC': ambientTempC,
      if (manualSos) 'manualSos': true,
      if (fallDetected) 'fallDetected': true,
      if (hrvSdnnMs != null) 'hrvSdnnMs': hrvSdnnMs,
      if (restingHeartRate != null) 'restingHeartRate': restingHeartRate,
      if (activeEnergyKcal != null) 'activeEnergyKcal': activeEnergyKcal,
      if (steps != null) 'steps': steps,
      if (walkingHeartRate != null) 'walkingHeartRate': walkingHeartRate,
      if (flightsClimbed != null) 'flightsClimbed': flightsClimbed,
      if (respiratoryRate != null) 'respiratoryRate': respiratoryRate,
    };
  }
}
