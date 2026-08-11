// 네이티브 EventChannel(vitalguard/stream) 구독 래퍼 — 표시용 상태만 다룬다(원본 생체 경로는 네이티브 전담)
import 'package:flutter/services.dart';

/// 네이티브가 밀어주는 표시용 이벤트. type = "hr"(최신 심박) | "pipeline"(큐·업로드 상태).
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
  });

  final String type;
  final double? bpm;
  final DateTime? measuredAt;
  final int? seq;
  final String? channel;
  final int? pending;
  final bool? uploadOk;
  final bool? authRejected;

  static VitalStreamEvent fromMap(Map<dynamic, dynamic> map) {
    final measuredAtMs = map['measuredAtMs'] as int?;
    return VitalStreamEvent(
      type: map['type'] as String? ?? 'unknown',
      bpm: (map['bpm'] as num?)?.toDouble(),
      measuredAt: measuredAtMs == null ? null : DateTime.fromMillisecondsSinceEpoch(measuredAtMs),
      seq: map['seq'] as int?,
      channel: map['channel'] as String?,
      pending: map['pending'] as int?,
      uploadOk: map['uploadOk'] as bool?,
      authRejected: map['authRejected'] as bool?,
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
