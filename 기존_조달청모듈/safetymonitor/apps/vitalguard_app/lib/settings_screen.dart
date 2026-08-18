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
          _title('계정'),
          _row(
            icon: Icons.badge_outlined,
            iconColor: VgColors.primary,
            title: '$name ($workerId)',
            subtitle: '업로드 파이프라인 가동 중 — 워치 수집분을 서버로 전송합니다',
          ),
        ],
      ),
    );
  }
}
