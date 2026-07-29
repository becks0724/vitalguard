class VitalSnapshot {
  const VitalSnapshot({
    required this.heartRate,
    required this.spo2,
    required this.steps,
    required this.batteryPct,
  });
  factory VitalSnapshot.demo() =>
      const VitalSnapshot(heartRate: 74, spo2: 98, steps: 6240, batteryPct: 82);
  final int heartRate, spo2, steps, batteryPct;
}

class WatchContext {
  const WatchContext({
    required this.loginId,
    required this.employeeId,
    required this.intervalSeconds,
  });
  factory WatchContext.worker({
    required String loginId,
    required String employeeId,
    required int intervalSeconds,
  }) => WatchContext(
    loginId: loginId,
    employeeId: employeeId,
    intervalSeconds: intervalSeconds.clamp(5, 3599).toInt(),
  );
  final String loginId, employeeId;
  final int intervalSeconds;
  Map<String, Object> toMap() => {
    'source': 'VitAlGuard-Flutter',
    'contextSeq': DateTime.now().millisecondsSinceEpoch / 1000,
    'loggedIn': loginId.isNotEmpty,
    'loginId': loginId,
    'employeeId': employeeId,
    'mode': 'worker',
    'syncIntervalSeconds': intervalSeconds,
    'fallDetectionMode': 'rule_three_signal',
  };
}

class MotionSample {
  const MotionSample({
    required this.at,
    required this.totalG,
    required this.rotationRadS,
  });
  final DateTime at;
  final double totalG, rotationRadS;
}

class FallCandidate {
  const FallCandidate({
    required this.isFall,
    required this.peakG,
    required this.stillSeconds,
    required this.freefallPreceded,
    required this.peakRotationRadS,
  });
  final bool isFall, freefallPreceded;
  final double peakG, stillSeconds, peakRotationRadS;
}

class FallDetector {
  static const double _freefallG = .6,
      _impactG = 2.8,
      _stillBandG = .3,
      _tumbleRotation = 6.0;
  static const Duration _freefallLookback = Duration(milliseconds: 800),
      _postWindow = Duration(seconds: 4),
      _requiredStill = Duration(milliseconds: 1200),
      _refractory = Duration(seconds: 8);
  DateTime? _impactAt, _lastFreefallAt, _lastSampleAt, _lastFallAt;
  double _peakG = 0, _peakRotation = 0, _stillSeconds = 0;
  bool _freefallPreceded = false;

  FallCandidate? ingest(MotionSample sample) {
    if (_lastFallAt != null &&
        sample.at.difference(_lastFallAt!) < _refractory) {
      return null;
    }
    if (sample.totalG <= _freefallG) {
      _lastFreefallAt = sample.at;
    }
    if (sample.totalG >= _impactG) {
      _impactAt ??= sample.at;
      _peakG = _peakG > sample.totalG ? _peakG : sample.totalG;
      _peakRotation = _peakRotation > sample.rotationRadS
          ? _peakRotation
          : sample.rotationRadS;
      _freefallPreceded =
          _freefallPreceded ||
          (_lastFreefallAt != null &&
              sample.at.difference(_lastFreefallAt!) <= _freefallLookback);
      _lastSampleAt = sample.at;
      return null;
    }
    if (_impactAt == null) return null;
    if (sample.at.difference(_impactAt!) > _postWindow) return _resolve(false);
    _peakRotation = _peakRotation > sample.rotationRadS
        ? _peakRotation
        : sample.rotationRadS;
    final dt = _lastSampleAt == null
        ? Duration.zero
        : sample.at.difference(_lastSampleAt!);
    _lastSampleAt = sample.at;
    if ((sample.totalG - 1).abs() < _stillBandG) {
      _stillSeconds += dt.inMilliseconds / 1000;
    }
    if (_stillSeconds >= _requiredStill.inMilliseconds / 1000) {
      return _resolve(_freefallPreceded || _peakRotation >= _tumbleRotation);
    }
    return null;
  }

  FallCandidate _resolve(bool isFall) {
    final result = FallCandidate(
      isFall: isFall,
      peakG: _peakG,
      stillSeconds: _stillSeconds,
      freefallPreceded: _freefallPreceded,
      peakRotationRadS: _peakRotation,
    );
    if (isFall) _lastFallAt = _lastSampleAt;
    _impactAt = _lastFreefallAt = _lastSampleAt = null;
    _peakG = _peakRotation = _stillSeconds = 0;
    _freefallPreceded = false;
    return result;
  }
}
