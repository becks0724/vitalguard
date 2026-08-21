// 설정 화면 — 전송 상태·계정을 모은다(홈은 생체 지표만 남긴다)
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'theme.dart';
import 'vital_display.dart';
import 'vital_stream.dart';

/// 전송·계정 설정.
///
/// ★ **스스로 갱신한다.** 열 때 받은 값만 그리면 화면에 머무는 동안 큐가 밀려도
/// `전송 큐 비어 있음` 이 그대로 남는다 — 이 레포가 반복해서 당한 false-OK 형태다
/// (관제 신호등이 미수신 작업자를 "정상" 으로 세던 것과 같은 자리).
/// 홈과 같은 3초 폴링 + 같은 EventChannel 을 쓴다(브로드캐스트라 네이티브 구독은 하나다).
///
/// 누적 건수만 스냅숏이다 — 서버 왕복이라 여기서 다시 묻지 않는다(홈이 60초마다 받는다).
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.bridge,
    required this.status,
    required this.pending,
    this.totalPersisted,
  });

  final MethodChannel bridge;
  final Map<String, dynamic> status;
  final int pending;
  final int? totalPersisted;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late Map<String, dynamic> _status = widget.status;
  late int _pending = widget.pending;
  Timer? _timer;
  StreamSubscription<VitalStreamEvent>? _sub;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
    try {
      _sub = VitalStream.events().listen((e) {
        if (!mounted || e.pending == null) return;
        setState(() => _pending = e.pending!);
      });
    } catch (_) {
      // 브리지 부재(테스트 등)면 폴링 표시만 유지한다.
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final status = await widget.bridge.invokeMapMethod<String, dynamic>('status');
      if (!mounted || status == null) return;
      setState(() {
        _status = status;
        _pending = status['pending'] as int? ?? _pending;
      });
    } catch (_) {
      // 브리지 부재(테스트 등)면 표시만 유지한다.
    }
  }

  Widget _title(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
        child: Text(text,
            style: const TextStyle(
                fontSize: 13, fontWeight: FontWeight.w700, color: VgColors.body)),
      );

  Widget _row({
    required IconData icon,
    required Color iconColor,
    required String title,
    required String subtitle,
  }) =>
      Card(
        child: ListTile(
          leading: Icon(icon, color: iconColor),
          title: Text(title, style: const TextStyle(fontSize: 14, color: VgColors.ink)),
          subtitle: Text(subtitle,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: VgColors.muted)),
        ),
      );

  /// 초 → `3분 12초 전`. 값이 없으면 null 을 돌려 줄을 생략하지 않고 호출부가 사유를 적게 한다.
  static String _ago(int sec) {
    if (sec < 60) return '$sec초 전';
    final m = sec ~/ 60;
    if (m < 60) return '$m분 ${sec % 60}초 전';
    final h = m ~/ 60;
    return h < 24 ? '$h시간 ${m % 60}분 전' : '${h ~/ 24}일 전';
  }

  /// 워치→폰 전달 지연 표기 — 정상 0~5초, 단절 복귀 직후엔 분 단위가 나온다.
  /// 음수는 워치·폰 시계 오차이지 미래 배달이 아니므로 0 으로 접는다(네이티브 주석 참조).
  static String _lagText(num s) {
    final v = s < 0 ? 0.0 : s.toDouble();
    if (v < 60) return '${v.toStringAsFixed(1)}초';
    return '${v ~/ 60}분 ${(v % 60).round()}초';
  }

  /// 워치 수신 상태 — **끊긴 지 얼마나 됐는지**가 핵심이다.
  ///
  /// ★ 이 값은 EventChannel 이 아니라 3초 폴링(`status`)에서 온다. 스트림이 죽으면
  ///   홈 화면은 마지막 값에 얼어붙는데 여기는 계속 갱신되므로, 사용자가 "워치가 멈춘 건지
  ///   화면이 멈춘 건지" 를 스스로 가를 수 있다(2026-08-20 실측 결함).
  Widget _watchRow() {
    final age = _status['lastVitalAgeSec'] as int?;
    final bat = _status['watchBatteryPct'] as int?;
    // 전달 지연 — 워치 봉투 sentAt 직접 측정(2026-08-21 ⓐ · seam-contracts A-1). 폰 앱이
    // 구 바이너리면 키가 없어 null = 줄 생략(0 이 아니라 "못 잼" 이다).
    final lag = _status['lastBatchLagSec'] as num?;
    if (age == null) {
      return _row(
        icon: Icons.watch_off_outlined,
        iconColor: VgColors.muted,
        title: '워치 수신 없음',
        subtitle: '앱을 켠 뒤 아직 한 건도 못 받았습니다',
      );
    }
    // 배치 간격 5초 기준 — 30초를 넘으면 정상 수신이 아니다.
    final ok = age <= 30;
    return _row(
      icon: ok ? Icons.watch_outlined : Icons.watch_off_outlined,
      iconColor: ok ? VgColors.normal : VgColors.danger,
      title: ok ? '워치 수신 중' : '워치 수신 끊김 — ${_ago(age)}',
      subtitle: [
        '마지막 수신 ${_ago(age)}',
        if (lag != null) '전달 지연 ${_lagText(lag)}',
        if (bat != null) '워치 배터리 $bat%',
      ].join(' · '),
    );
  }

  /// 위치 상태 — 각인에 좌표가 왜 비는지를 화면이 스스로 설명하게 한다.
  Widget _locationRow() {
    final auth = _status['locationAuth'] as String? ?? '알 수 없음';
    final lat = _status['fixLat'] as num?;
    final lon = _status['fixLon'] as num?;
    final acc = _status['fixAccM'] as num?;
    final age = _status['fixAgeSec'] as int?;
    final granted = auth == '항상 허용' || auth == '앱 사용 중 허용';
    final detail = lat == null || lon == null
        // 좌표가 없는 것과 못 받는 것은 다르다 — 권한이 있는데 좌표가 없으면 실내일 뿐이다.
        ? (granted ? '아직 좌표 없음 — 실내·지하에서는 안 잡힙니다' : '권한이 없어 좌표를 못 받습니다')
        : [
            '${lat.toStringAsFixed(6)}, ${lon.toStringAsFixed(6)}',
            if (acc != null) '±${acc.toStringAsFixed(0)}m',
            if (age != null) _ago(age),
          ].join(' · ');
    return _row(
      icon: granted ? Icons.location_on_outlined : Icons.location_off_outlined,
      iconColor: granted ? VgColors.primary : VgColors.danger,
      title: '위치 권한 — $auth',
      subtitle: detail,
    );
  }

  /// 사진첩 추가 권한 — 거부돼 있으면 촬영본이 **조용히** 기기에 안 남는다.
  Widget _photoRow() {
    final auth = _status['photoAddAuth'] as String? ?? '알 수 없음';
    final ok = auth == '허용' || auth == '일부 허용';
    return _row(
      icon: ok ? Icons.photo_library_outlined : Icons.no_photography_outlined,
      iconColor: ok ? VgColors.normal : VgColors.caution,
      title: '사진첩 저장 — $auth',
      subtitle: ok
          ? '촬영본이 업로드와 함께 기기에도 남습니다'
          : '거부 상태입니다 — 촬영본이 기기에 안 남습니다(iOS 설정에서 변경)',
    );
  }

  /// 설치된 것이 최신인지 사람이 확인할 유일한 수단 — 빌드 시각까지 적는다.
  Widget _versionRow() {
    final v = _status['appVersion'] as String? ?? '-';
    final b = _status['appBuild'] as String? ?? '-';
    final builtMs = _status['builtAtMs'] as int?;
    final built = builtMs == null
        ? '빌드 시각 확인 불가'
        : () {
            final t = DateTime.fromMillisecondsSinceEpoch(builtMs).toLocal();
            return '빌드 ${t.month}/${t.day} ${formatClock(t)}';
          }();
    return _row(
      icon: Icons.info_outline,
      iconColor: VgColors.muted,
      title: '버전 $v ($b)',
      subtitle: built,
    );
  }

  @override
  Widget build(BuildContext context) {
    final name = _status['name'] as String? ?? '작업자';
    final workerId = _status['workerId'] as String? ?? '-';
    final baseURL = _status['baseURL'] as String? ?? '';
    final idle = _pending == 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('설정', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
        children: [
          _title('전송'),
          _row(
            icon: idle ? Icons.cloud_done_outlined : Icons.cloud_upload_outlined,
            iconColor: idle ? VgColors.normal : VgColors.caution,
            title: idle ? '전송 큐 비어 있음' : '전송 대기 $_pending건',
            subtitle: baseURL,
          ),
          // DB 누적 — 조회 실패는 값을 지어내지 않고 줄 자체를 생략한다.
          if (widget.totalPersisted != null) ...[
            const SizedBox(height: 10),
            _row(
              icon: Icons.storage_outlined,
              iconColor: VgColors.primary,
              title: '누적 ${formatCount(widget.totalPersisted!)}건',
              subtitle: '서버에 영속된 내 생체 샘플',
            ),
          ],
          _title('수집'),
          _watchRow(),
          const SizedBox(height: 10),
          _locationRow(),
          const SizedBox(height: 10),
          _photoRow(),
          _title('계정'),
          _row(
            icon: Icons.badge_outlined,
            iconColor: VgColors.primary,
            title: '$name ($workerId)',
            subtitle: '업로드 파이프라인 가동 중 — 워치 수집분을 서버로 전송합니다',
          ),
          _title('앱'),
          _versionRow(),
        ],
      ),
    );
  }
}
