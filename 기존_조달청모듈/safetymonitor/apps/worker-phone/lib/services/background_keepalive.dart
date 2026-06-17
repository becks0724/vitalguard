// 백그라운드/잠금 상태 유지용 — geolocator 의 location 백그라운드 모드를 이용해 iOS suspend 회피
import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

class BackgroundKeepalive {
  StreamSubscription<Position>? _subscription;
  Position? _lastPosition;
  // 위치 업데이트마다 호출되는 콜백 — 백그라운드 wake 이벤트에 전송을 태우는 이중화용
  void Function(Position position)? _onUpdate;

  bool get isRunning => _subscription != null;

  // 가장 최근 위치 — payload 에 lat/lon 동봉 시 사용 (SOS/낙상 SMS 위치 정보)
  Position? get lastPosition => _lastPosition;

  // 위치 권한 요청 + 백그라운드 location updates 시작.
  // 결과 메시지는 UI 표시용 (성공·차단·에러).
  Future<String> start({void Function(Position position)? onUpdate}) async {
    _onUpdate = onUpdate;
    if (_subscription != null) {
      return '백그라운드 유지 작동 중';
    }

    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return '위치 서비스 OFF — 설정에서 켜주세요.';
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      return '위치 권한 영구 거부 — 설정 → 개인정보 → 위치 에서 변경하세요.';
    }
    if (permission == LocationPermission.denied) {
      return '위치 권한 거부됨 — 백그라운드 유지 불가';
    }

    // iOS "항상 허용" 요청 — 처음엔 whileInUse 만 떨어지므로 한 번 더 묻기
    if (permission == LocationPermission.whileInUse) {
      try {
        final upgraded = await Geolocator.requestPermission();
        permission = upgraded;
      } catch (_) {
        // 사용자가 거부해도 whileInUse 만으로 폰이 잠기지 않는 동안에는 작동
      }
    }

    final settings = _locationSettings();

    _subscription = Geolocator.getPositionStream(locationSettings: settings).listen(
      (pos) {
        _lastPosition = pos;
        _onUpdate?.call(pos);
      },
      onError: (error) => debugPrint('[BackgroundKeepalive] $error'),
      cancelOnError: false,
    );

    // 초기 1회 즉시 캡처 — stream 첫 콜백 전이라도 payload 위치 확보
    try {
      _lastPosition = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium),
      );
    } catch (_) {
      // 실패해도 stream 콜백이 곧 채움
    }

    return permission == LocationPermission.always
        ? '백그라운드 유지 ON (항상 허용)'
        : '백그라운드 유지 ON (사용 중 허용 — 잠금 시 일부 제한)';
  }

  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  LocationSettings _locationSettings() {
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.medium,
        distanceFilter: 0,
        intervalDuration: const Duration(seconds: 5),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'SafetyMonitor 수신 유지',
          notificationText: '잠금 상태에서도 생체 신호를 관제 웹으로 전송합니다.',
          notificationChannelName: 'SafetyMonitor background monitor',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    }

    if (Platform.isIOS) {
      // 잠금/백그라운드 keepalive 핵심 — distanceFilter 0 으로 정지 상태에서도 위치
      // 업데이트가 끊김 없이 흘러야 iOS 가 앱을 suspend 하지 않아 5초 폴링 타이머가 유지됨.
      // (distanceFilter > 0 이면 폰이 가만히 있을 때 업데이트가 멈춰 suspend → 전송 중단)
      // 정확도 best 로 위치 subsystem 을 활성 유지 → 백그라운드 wake 빈도 확보(데모: 배터리보다 신뢰성).
      // 잠금 상태 전송은 위치 권한 "항상 허용" + 파란 위치 인디케이터(showBackgroundLocationIndicator) 필요.
      return AppleSettings(
        accuracy: LocationAccuracy.best,
        distanceFilter: 0,
        pauseLocationUpdatesAutomatically: false,
        allowBackgroundLocationUpdates: true,
        showBackgroundLocationIndicator: true,
      );
    }

    return const LocationSettings(
      accuracy: LocationAccuracy.medium,
      distanceFilter: 10,
    );
  }
}
