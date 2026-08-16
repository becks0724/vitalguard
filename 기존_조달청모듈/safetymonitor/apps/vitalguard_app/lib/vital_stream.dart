// 네이티브 EventChannel(vitalguard/stream) 구독 래퍼 — 표시용 상태만 다룬다(원본 생체 경로는 네이티브 전담)
import 'package:flutter/services.dart';

/// 네이티브가 밀어주는 표시용 이벤트. type = "hr"(생체 스냅숏) | "pipeline"(큐·업로드 상태).
///
/// "hr" 은 네이티브가 들고 있는 **누적 스냅숏 전체**다(배치마다 통째로 온다) — Dart 는 값을
/// 모으지 않고 마지막 이벤트만 그린다. 없는 값은 키가 빠져 오므로 `null` 이 "0" 이 아니라 "모름" 이다.
class VitalStreamEvent {
  const VitalStreamEvent({
    required this.type,
    this.bpm,
    this.measuredAt,
    this.seq,
    this.channel,
    this.pending,
    this.uploadOk,
    this.authRejected,
    this.spo2,
    this.spo2At,
    this.stillSec,
    this.steps,
    this.flights,
    this.discreteCounts = const {},
    this.discreteValues = const {},
  });

  final String type;
  final double? bpm;
  final DateTime? measuredAt;
  final int? seq;
  final String? channel;
  final int? pending;
  final bool? uploadOk;
  final bool? authRejected;

  /// SpO₂(%) 와 그 **측정** 시각 — 기회 측정이라 상시 값이 아니다(전송 시각과 다르다).
  final double? spo2;
  final DateTime? spo2At;

  /// 무동작 지속(초) — 워치 CMMotionManager 기준. 못 잰 것은 0 이 아니라 null 이다.
  final double? stillSec;

  /// 폰이 받기 시작한 뒤의 누계(구간 증분의 합) — 워치 세션 누계·하루 총량과 다르다.
  final int? steps;
  final int? flights;

  /// 이산 6종(pe·dl·rhr·whr·rr·hrv)의 종류별 누계 건수와 최신 값.
  final Map<String, int> discreteCounts;
  final Map<String, double> discreteValues;

  static DateTime? _at(Object? ms) =>
      ms is int ? DateTime.fromMillisecondsSinceEpoch(ms) : null;

  /// 플랫폼 채널은 `Map<Object?, Object?>` 로 넘겨주므로 키·값 형을 여기서 좁힌다.
  static Map<String, T> _numMap<T extends num>(Object? raw, T Function(num) cast) {
    if (raw is! Map) return const {};
    final out = <String, T>{};
    raw.forEach((k, v) {
      if (k is String && v is num) out[k] = cast(v);
    });
    return out;
  }

  static VitalStreamEvent fromMap(Map<dynamic, dynamic> map) {
    return VitalStreamEvent(
      type: map['type'] as String? ?? 'unknown',
      bpm: (map['bpm'] as num?)?.toDouble(),
      measuredAt: _at(map['measuredAtMs']),
      seq: map['seq'] as int?,
      channel: map['channel'] as String?,
      pending: map['pending'] as int?,
      uploadOk: map['uploadOk'] as bool?,
      authRejected: map['authRejected'] as bool?,
      spo2: (map['spo2'] as num?)?.toDouble(),
      spo2At: _at(map['spo2AtMs']),
      stillSec: (map['stillSec'] as num?)?.toDouble(),
      steps: (map['steps'] as num?)?.toInt(),
      flights: (map['flights'] as num?)?.toInt(),
      discreteCounts: _numMap(map['discreteCounts'], (n) => n.toInt()),
      discreteValues: _numMap(map['discreteValues'], (n) => n.toDouble()),
    );
  }
}

class VitalStream {
  static const EventChannel _channel = EventChannel('vitalguard/stream');

  static Stream<VitalStreamEvent> events() {
    return _channel
        .receiveBroadcastStream()
        .where((e) => e is Map)
        .map((e) => VitalStreamEvent.fromMap(e as Map));
  }
}
