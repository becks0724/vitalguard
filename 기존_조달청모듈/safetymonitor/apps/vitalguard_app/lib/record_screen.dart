// 기록 탭 — 현장 사진·서류를 촬영해 관제 캘린더에 올리고, 올린 것을 되보는 화면
//
// ★ 서버는 새로 만들지 않았다. 업로드는 `POST /api/app-media`(오늘 실왕복 검증), 목록은
//   관제 캘린더 조회가 **앱 로그인 JWT 를 그대로 수용**한다. 표시용 URL 과 삭제 권한까지
//   서버가 계산해 내려주므로 화면은 그것을 그리기만 한다.
//
// ★ 촬영·OCR·각인·업로드는 전부 네이티브(MediaCapture.swift)다. Dart 는 버튼과 목록만 다룬다 —
//   이 앱의 기존 규칙(무거운 것은 네이티브 전담)과 같다.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'glass_tab_bar.dart';
import 'theme.dart';
import 'vital_display.dart';

const MethodChannel _bridge = MethodChannel('vitalguard/bridge');

class RecordScreen extends StatefulWidget {
  const RecordScreen({super.key});

  @override
  State<RecordScreen> createState() => _RecordScreenState();
}

class _RecordScreenState extends State<RecordScreen> {
  List<Map<String, dynamic>> _items = const [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await _bridge.invokeMapMethod<String, dynamic>('listMedia', {'days': 30});
      if (!mounted) return;
      final ok = res?['ok'] == true;
      final raw = res?['media'];
      setState(() {
        _loading = false;
        // ⚠ 실패를 빈 목록으로 바꾸지 않는다 — "아직 없음" 과 "못 불러옴" 은 다른 상태다.
        _error = ok ? null : (res?['error'] as String? ?? '목록을 불러오지 못했습니다.');
        _items = ok && raw is List
            ? raw.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList()
            : const [];
      });
    } on PlatformException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message ?? '목록을 불러오지 못했습니다.';
      });
    }
  }

  Future<void> _capture(String mode) async {
    if (_busy) return;
    setState(() => _busy = true);
    Map<String, dynamic>? res;
    try {
      res = await _bridge.invokeMapMethod<String, dynamic>('captureMedia', {'mode': mode});
    } on PlatformException catch (e) {
      res = {'ok': false, 'error': e.message};
    }
    if (!mounted) return;
    setState(() => _busy = false);

    // 취소는 실패가 아니다 — 아무 말도 하지 않는다.
    if (res?['cancelled'] == true) return;
    final ok = res?['ok'] == true;
    final n = res?['uploaded'] as int? ?? 0;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok
            ? '$n장 업로드했습니다.'
            : '업로드 실패 — ${res?['error'] ?? '알 수 없는 오류'}'),
      ),
    );
    if (n > 0) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : () => _capture('scan'),
                  icon: const Icon(Icons.document_scanner_outlined, size: 18),
                  label: const Text('서류 스캔'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : () => _capture('photo'),
                  icon: const Icon(Icons.photo_camera_outlined, size: 18),
                  label: const Text('사진 촬영'),
                ),
              ),
            ],
          ),
        ),
        // 진행 중임을 화면이 말한다 — 촬영 뒤 OCR·업로드에 몇 초가 걸린다.
        if (_busy)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                SizedBox(width: 8),
                Text('글자 인식·업로드 중…', style: TextStyle(fontSize: 12, color: VgColors.body)),
              ],
            ),
          ),
        Expanded(child: _body()),
      ],
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return _notice(Icons.cloud_off, _error!, '다시 시도해 주세요.');
    }
    if (_items.isEmpty) {
      return _notice(Icons.photo_library_outlined, '올린 기록이 없습니다', '위 버튼으로 촬영하면 여기에 쌓입니다.');
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: EdgeInsets.fromLTRB(16, 4, 16, 16 + glassTabBarInset(context)),
        itemCount: _items.length,
        itemBuilder: (_, i) => _card(_items[i]),
      ),
    );
  }

  Widget _notice(IconData icon, String title, String hint) => Center(
        child: Padding(
          padding: EdgeInsets.fromLTRB(32, 0, 32, glassTabBarInset(context)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 32, color: VgColors.muted),
              const SizedBox(height: 10),
              Text(title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w700, color: VgColors.ink)),
              const SizedBox(height: 6),
              Text(hint,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12, color: VgColors.body)),
            ],
          ),
        ),
      );

  Widget _card(Map<String, dynamic> m) {
    final url = m['media_url'] as String?;
    final captured = m['captured_at'] as String? ?? m['date_key'] as String? ?? '';
    final address = (m['road_address'] as String?)?.trim();
    final uploader = (m['uploader'] as String?)?.trim();

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (url != null)
            AspectRatio(
              aspectRatio: 4 / 3,
              child: Image.network(
                url,
                fit: BoxFit.cover,
                // ⚠ 링크는 만료형이다 — 못 불러오면 빈 칸이 아니라 사유를 적는다.
                errorBuilder: (_, _, _) => Container(
                  color: VgColors.surfaceStrong,
                  alignment: Alignment.center,
                  child: const Text('이미지를 불러오지 못했습니다',
                      style: TextStyle(fontSize: 12, color: VgColors.muted)),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_when(captured),
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700, color: VgColors.ink)),
                const SizedBox(height: 4),
                // 없는 값은 비워 두지 않고 없다고 적는다(빈칸은 '측정 안 함' 으로 읽힌다).
                Text(address ?? '위치 미확보',
                    style: TextStyle(
                        fontSize: 12, color: address == null ? VgColors.muted : VgColors.body)),
                if (uploader != null && uploader.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(uploader, style: const TextStyle(fontSize: 11, color: VgColors.muted)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// `2026-08-19T14:07:17+09:00` → `08-19 14:07`. 파싱 실패면 원문을 그대로 둔다.
  String _when(String iso) {
    final at = DateTime.tryParse(iso);
    if (at == null) return iso;
    return '${at.month.toString().padLeft(2, '0')}-${at.day.toString().padLeft(2, '0')}'
        ' ${formatClock(at)}';
  }
}
