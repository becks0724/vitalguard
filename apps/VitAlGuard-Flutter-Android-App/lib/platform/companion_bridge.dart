import 'package:flutter/services.dart';

import '../vital_domain.dart';

class CompanionStatus {
  const CompanionStatus({
    required this.supported,
    required this.reachable,
    required this.platform,
    required this.detail,
  });
  const CompanionStatus.unsupported()
    : supported = false,
      reachable = false,
      platform = '연결 확인 중',
      detail = '이 기기에서 시계 연결 상태를 확인합니다.';
  final bool supported, reachable;
  final String platform, detail;
  String get title => reachable ? '$platform 연결됨' : '$platform 연결 실패';
}

class BridgeResult {
  const BridgeResult(this.message);
  final String message;
}

class CompanionBridge {
  static const _channel = MethodChannel(
    'com.yangjeehoo.vitalguard/watch_bridge',
  );
  Future<CompanionStatus> status() async {
    final result = await _channel.invokeMapMethod<String, dynamic>('status');
    if (result == null) return const CompanionStatus.unsupported();
    return CompanionStatus(
      supported: result['supported'] == true,
      reachable: result['reachable'] == true,
      platform: '${result['platform'] ?? '시계'}',
      detail: '${result['detail'] ?? '상태 정보를 받지 못했습니다.'}',
    );
  }

  Future<BridgeResult> sync(WatchContext context) async {
    final result = await _channel.invokeMapMethod<String, dynamic>(
      'syncWatchContext',
      context.toMap(),
    );
    return BridgeResult('${result?['message'] ?? '동기화 요청을 보냈습니다.'}');
  }
}
