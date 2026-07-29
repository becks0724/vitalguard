import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_flutter/vital_domain.dart';

void main() {
  test('낙상 후보는 자유낙하, 충격, 정지 신호를 모두 만족해야 확정된다', () {
    final detector = FallDetector();
    final base = DateTime(2026, 7, 29, 12);
    final samples = [
      MotionSample(at: base, totalG: .5, rotationRadS: 1),
      MotionSample(
        at: base.add(const Duration(milliseconds: 400)),
        totalG: 3.1,
        rotationRadS: 7,
      ),
      MotionSample(
        at: base.add(const Duration(milliseconds: 900)),
        totalG: 1,
        rotationRadS: .1,
      ),
      MotionSample(
        at: base.add(const Duration(milliseconds: 2200)),
        totalG: 1.02,
        rotationRadS: .1,
      ),
    ];
    final candidate = samples
        .map(detector.ingest)
        .whereType<FallCandidate>()
        .single;
    expect(candidate.isFall, isTrue);
    expect(candidate.peakG, greaterThanOrEqualTo(2.8));
  });
}
