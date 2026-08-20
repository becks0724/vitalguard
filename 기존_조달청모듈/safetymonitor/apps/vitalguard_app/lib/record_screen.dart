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

/// 최신 촬영이 위로. 서버는 `date_key ASC, captured_at ASC` 로 준다 — 관제 캘린더가
/// 하루를 시간순으로 읽는 화면이라 **그 계약은 그대로 두고 여기서만** 뒤집는다.
///
/// ⚠ `.reversed` 로 하지 않는다 — 서버 정렬 순서에 기대게 되고, 그 계약이 바뀌면
///   목록이 조용히 어긋난다(틀린 순서는 에러를 안 낸다).
List<Map<String, dynamic>> newestFirst(List<Map<String, dynamic>> rows) {
  final sorted = [...rows];
  sorted.sort((a, b) => _sortKey(b).compareTo(_sortKey(a)));
  return sorted;
}

/// 정렬 키 — 비교 가능한 정수(epoch µs)로 환산한다.
///
/// ⚠ ISO 문자열을 사전순으로 비교하지 않는다. 지금은 서버가 전부 `+09:00` 으로 주지만
///   `Z` 가 섞이는 순간 사전순은 시간순이 아니게 되고, **틀린 순서는 에러를 안 낸다**.
/// 촬영 시각이 없으면 날짜(`date_key`)로, 그것도 못 읽으면 맨 아래로 보낸다.
int _sortKey(Map<String, dynamic> m) {
  final raw = (m['captured_at'] as String?) ?? (m['date_key'] as String?);
  final at = raw == null ? null : DateTime.tryParse(raw);
  return at?.microsecondsSinceEpoch ?? -1 << 62;
}

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
            ? newestFirst(
                raw.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList())
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
    final saved = res?['saved'] as int? ?? 0;
    // 사진첩 저장은 업로드와 별개로 성패를 적는다 — "올라갔다" 로 뭉뚱그리면 권한을 거부해
    // 사진첩에 안 남는 것을 아무도 모른다.
    final photos = n > 0 && saved < n ? ' · 사진첩 저장 $saved/$n(권한 확인)' : '';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok
            ? '$n장 업로드 · 사진첩 $saved장 저장$photos'
            : '업로드 실패 — ${res?['error'] ?? '알 수 없는 오류'}'),
      ),
    );
    if (n > 0) await _load();
  }

  Future<void> _delete(Map<String, dynamic> m) async {
    final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('이 기록을 지울까요?'),
            // ⚠ 되돌릴 수 없다는 것을 먼저 말한다 — 관제 캘린더의 증빙이 함께 사라진다.
            content: const Text('관제 캘린더에서도 사라지고 되돌릴 수 없습니다.\n'
                '사진첩에 저장된 사본은 그대로 남습니다.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: FilledButton.styleFrom(backgroundColor: VgColors.danger),
                child: const Text('삭제'),
              ),
            ],
          ),
        ) ??
        false;
    if (!ok || !mounted) return;
    final res = await _call('deleteMedia', {'id': m['id']});
    if (!mounted) return;
    _say(res?['ok'] == true ? '삭제했습니다.' : '삭제 실패 — ${res?['error'] ?? '알 수 없는 오류'}');
    if (res?['ok'] == true) await _load();
  }

  Future<void> _editDescription(Map<String, dynamic> m) async {
    final controller = TextEditingController(text: (m['description'] as String?) ?? '');
    final text = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('설명 메모'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 3,
          decoration: const InputDecoration(
            hintText: '무엇을 찍었는지 적어 두면 관제에서 같이 보입니다.',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('저장'),
          ),
        ],
      ),
    );
    if (text == null || !mounted) return;
    final res = await _call('updateMediaDescription', {'id': m['id'], 'description': text});
    if (!mounted) return;
    _say(res?['ok'] == true ? '설명을 저장했습니다.' : '저장 실패 — ${res?['error'] ?? '알 수 없는 오류'}');
    if (res?['ok'] == true) await _load();
  }

  /// 브리지 호출 — 네이티브가 던지는 예외도 같은 모양의 실패로 접는다.
  Future<Map<String, dynamic>?> _call(String method, Map<String, dynamic> args) async {
    try {
      return await _bridge.invokeMapMethod<String, dynamic>(method, args);
    } on PlatformException catch (e) {
      return {'ok': false, 'error': e.message};
    }
  }

  void _say(String message) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

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
    final description = (m['description'] as String?)?.trim();
    // ★ 권한은 서버가 항목마다 계산해 내려준다(`canDelete`). 화면이 사번을 비교해 다시 재면
    //   두 곳의 규칙이 언젠가 갈리고, 그때 사용자는 "버튼은 있는데 눌러도 안 된다" 를 겪는다.
    final mine = m['canDelete'] == true;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (url != null)
            AspectRatio(
              aspectRatio: 4 / 3,
              // ★ `BoxFit.cover` 를 쓰면 안 된다 — 각인은 **이미지 맨 아래**에 있는데, 세로 사진
              //   (3:4)을 4:3 칸에 cover 로 채우면 위아래 21.9%씩이 잘려 각인이 통째로 사라진다
              //   (2026-08-19 실측 — 1800×2400 사진은 각인 없어 보이고 2400×1800 은 보였다).
              //   `contain` 은 방향과 무관하게 전체를 보여 준다. 남는 여백은 배경으로 채운다.
              child: ColoredBox(
                color: VgColors.surfaceStrong,
                child: Image.network(
                  url,
                  fit: BoxFit.contain,
                  // ⚠ 링크는 만료형이다 — 못 불러오면 빈 칸이 아니라 사유를 적는다.
                  errorBuilder: (_, _, _) => Container(
                    color: VgColors.surfaceStrong,
                    alignment: Alignment.center,
                    child: const Text('이미지를 불러오지 못했습니다',
                        style: TextStyle(fontSize: 12, color: VgColors.muted)),
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(_when(captured),
                          style: const TextStyle(
                              fontSize: 13, fontWeight: FontWeight.w700, color: VgColors.ink)),
                    ),
                    // 내 것이 아니면 메뉴 자체를 안 보여 준다 — 눌러야 거절당하는 버튼은 두지 않는다.
                    if (mine)
                      SizedBox(
                        height: 24,
                        width: 28,
                        child: PopupMenuButton<String>(
                          padding: EdgeInsets.zero,
                          iconSize: 18,
                          tooltip: '기록 관리',
                          onSelected: (v) =>
                              v == 'edit' ? _editDescription(m) : _delete(m),
                          itemBuilder: (_) => const [
                            PopupMenuItem(value: 'edit', child: Text('설명 수정')),
                            PopupMenuItem(value: 'delete', child: Text('삭제')),
                          ],
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                // 없는 값은 비워 두지 않고 없다고 적는다(빈칸은 '측정 안 함' 으로 읽힌다).
                Text(address ?? '위치 미확보',
                    style: TextStyle(
                        fontSize: 12, color: address == null ? VgColors.muted : VgColors.body)),
                if (uploader != null && uploader.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(uploader, style: const TextStyle(fontSize: 11, color: VgColors.muted)),
                ],
                if (description != null && description.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(description,
                      style: const TextStyle(fontSize: 12, color: VgColors.ink)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// `2026-08-19T14:07:17+09:00` → `08-19 14:07`. 파싱 실패면 원문을 그대로 둔다.
  ///
  /// ⚠ `.toLocal()` 을 빼면 **UTC 가 그대로 찍힌다**. Dart 의 `DateTime.parse` 는 오프셋이
  ///   붙어 있어도 UTC 로 정규화해 돌려주고(`isUtc == true`), `hour` 는 UTC 시를 낸다.
  ///   실측 — 각인은 `18:40:13` 인데 목록은 `09:40` 으로 9시간 어긋났다(2026-08-19).
  String _when(String iso) {
    final at = DateTime.tryParse(iso)?.toLocal();
    if (at == null) return iso;
    return '${at.month.toString().padLeft(2, '0')}-${at.day.toString().padLeft(2, '0')}'
        ' ${formatClock(at)}';
  }
}
