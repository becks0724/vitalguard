import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';
import '../cctv/cctv_screen.dart';
import 'aed_screen.dart';
import 'gas_screen.dart';
import 'weather_screen.dart';
import 'workers_screen.dart';

// 서버 판정과 별개인 화면의 갱신·오래됨 기준이다.
const siteStatusRefreshInterval = Duration(minutes: 1);
const siteStatusStaleAfter = Duration(minutes: 5);
const _forbiddenMessage =
    '현재 계정의 역할 또는 현장 범위 밖입니다. 관리자에게 역할과 현장 배정을 확인해 달라고 요청해 주세요.';
const _noData = '데이터 없음 · 수신 또는 전원 대기';

class SiteScreen extends StatefulWidget {
  const SiteScreen({
    super.key,
    required this.controller,
    this.active = true,
    this.now,
  });

  final FieldController controller;
  final bool active;
  final DateTime Function()? now;

  @override
  State<SiteScreen> createState() => _SiteScreenState();
}

class _SiteScreenState extends State<SiteScreen> with WidgetsBindingObserver {
  SiteStatus? _data;
  Timer? _timer;
  bool _loading = false;
  bool _failed = false;
  bool _forbidden = false;
  bool _foreground = true;
  bool _video = false;
  bool _videoOpened = false;
  bool _workers = false;
  bool _gas = false;
  bool _aed = false;
  bool _weather = false;
  int _generation = 0;

  bool get _active => widget.active && _foreground && !_video;
  DateTime get _now => widget.now?.call() ?? DateTime.now();

  @override
  void initState() {
    super.initState();
    _data = widget.controller.siteStatusSnapshot;
    _forbidden = widget.controller.siteStatusForbidden;
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    _sync();
  }

  @override
  void didUpdateWidget(SiteScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      _generation++;
      _loading = false;
      _data = widget.controller.siteStatusSnapshot;
      _forbidden = widget.controller.siteStatusForbidden;
      _failed = false;
      _video = false;
      _videoOpened = false;
      _workers = false;
      _gas = false;
      _aed = false;
      _weather = false;
    }
    if (oldWidget.active != widget.active ||
        oldWidget.controller != widget.controller) {
      _sync();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _sync(manual: _foreground);
  }

  void _sync({bool manual = false}) {
    _timer?.cancel();
    _timer = null;
    if (!_active || (_forbidden && !manual)) return;
    unawaited(_refresh(manual: manual));
    if (_forbidden) return;
    _timer = Timer.periodic(siteStatusRefreshInterval, (_) {
      unawaited(_refresh());
    });
  }

  Future<void> _refresh({bool manual = false}) async {
    if (_loading || !_active || (_forbidden && !manual)) return;
    final generation = _generation;
    setState(() => _loading = true);
    try {
      if (manual) {
        try {
          await widget.controller.refreshSite();
        } catch (_) {
          // 현장 정보가 실패해도 상태 조회와 권한 복구 확인은 계속한다.
        }
        if (!mounted || generation != _generation || !_active) return;
      }
      final data = await widget.controller.siteStatus();
      if (!mounted || generation != _generation) return;
      final wasForbidden = _forbidden;
      setState(() {
        _data = data;
        _failed = false;
        _forbidden = false;
      });
      // _loading 중에 동기화하여 추가 요청 없이 타이머만 다시 건다.
      if (wasForbidden) _sync();
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _forbidden = _forbidden || (error is ApiFailure && error.status == 403);
        _failed = true;
        if (_forbidden || (error is ApiFailure && error.status == 401)) {
          _data = null;
        }
      });
      if (_forbidden) _timer?.cancel();
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  void _showVideo(bool show) {
    setState(() {
      _video = show;
      _videoOpened = _videoOpened || show;
    });
    _sync();
  }

  @override
  void dispose() {
    _generation++;
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop:
        (!_video && !_workers && !_gas && !_aed && !_weather) || !widget.active,
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop && widget.active) {
        if (_weather) {
          setState(() => _weather = false);
        } else if (_aed) {
          setState(() => _aed = false);
        } else if (_gas) {
          setState(() => _gas = false);
        } else if (_workers) {
          setState(() => _workers = false);
        } else if (_video) {
          _showVideo(false);
        }
      }
    },
    child: IndexedStack(
      index: _weather
          ? 5
          : (_aed ? 4 : (_gas ? 3 : (_workers ? 2 : (_video ? 1 : 0)))),
      children: [
        _summary(context),
        if (_videoOpened)
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    key: const Key('site-back-from-cctv'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(vgTapMin, vgTapMin),
                    ),
                    onPressed: () => _showVideo(false),
                    icon: const Icon(Icons.arrow_back),
                    label: const Text('현장 요약으로'),
                  ),
                ),
              ),
              Expanded(
                child: CctvScreen(
                  controller: widget.controller,
                  active: widget.active && _video,
                ),
              ),
            ],
          )
        else
          const SizedBox.shrink(),
        if (_workers)
          WorkersScreen(
            workers: _forbidden ? null : _data?.workers,
            forbidden: _forbidden,
            receipt: _receipt(
              prefix: 'workers',
              fetchedAt: _data?.workers.fetchedAt ?? _data?.fetchedAt,
            ),
            onBack: () => setState(() => _workers = false),
          )
        else
          const SizedBox.shrink(),
        if (_gas)
          GasScreen(
            gas: _forbidden ? null : _data?.gas,
            forbidden: _forbidden,
            isMock: widget.controller.isMock,
            stale: _isStale(_data?.gas.lastSeenAt),
            receipt: _receipt(prefix: 'gas', fetchedAt: _data?.fetchedAt),
            onBack: () => setState(() => _gas = false),
          )
        else
          const SizedBox.shrink(),
        if (_aed)
          AedScreen(
            aed: _forbidden ? null : _data?.aed,
            forbidden: _forbidden,
            receipt: _receipt(prefix: 'aed', fetchedAt: _data?.fetchedAt),
            onBack: () => setState(() => _aed = false),
          )
        else
          const SizedBox.shrink(),
        if (_weather)
          WeatherScreen(
            weather: _forbidden ? null : _data?.weather,
            forbidden: _forbidden,
            // 기상 캐시의 원본 시각. 새 site-status 수신 시각으로 대체하지 않는다.
            receipt: _receipt(
              prefix: 'weather',
              fetchedAt: _data?.weather.fetchedAt,
            ),
            onBack: () => setState(() => _weather = false),
          ),
      ],
    ),
  );

  bool _isStale(String? time) =>
      time != null &&
      _now.toUtc().difference(DateTime.parse(time)) >= siteStatusStaleAfter;

  // 현장 요약과 네 상세는 같은 요청·실패 상태와 갱신 타이머를 공유한다.
  Widget _receipt({required String prefix, required String? fetchedAt}) {
    final stale = _isStale(fetchedAt);
    return _Panel(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _forbidden
                  ? '마지막 수신 정보 표시 불가 · 접근 권한 없음'
                  : siteStatusReceipt(fetchedAt),
              key: Key('$prefix-receipt'),
            ),
            if (_loading)
              Text(
                fetchedAt == null
                    ? '갱신 중 · 첫 자료를 기다리고 있습니다'
                    : '갱신 중 · 수신 완료 전까지 이전 자료를 표시합니다',
              ),
            if (stale)
              Text(
                '오래된 자료 · 마지막 수신 후 5분 이상 지났습니다',
                key: Key('$prefix-stale'),
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            if (_forbidden) ...[
              Text(_forbiddenMessage, key: Key('$prefix-forbidden')),
              const Text('권한이 바뀌었으면 새로고침을 눌러 다시 조회합니다.'),
            ] else ...[
              if (_failed)
                Text(
                  fetchedAt == null
                      ? '수신 실패 · 연결 상태를 확인하고 새로고침해 주세요'
                      : '갱신 실패 · 이전에 받은 자료입니다. 연결 상태를 확인해 주세요',
                  key: Key('$prefix-refresh-error'),
                ),
              if (prefix != 'site')
                const Text('활성 화면에서 1분마다 조회합니다. 아래 버튼으로도 다시 조회할 수 있습니다.'),
            ],
            const SizedBox(height: vgGapTap),
            FilledButton.icon(
              key: Key('$prefix-refresh'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(vgTapMin, vgTapPrimary),
              ),
              onPressed: _loading ? null : () => _refresh(manual: true),
              icon: const Icon(Icons.refresh),
              label: const Text('새로고침'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _summary(BuildContext context) {
    final data = _data;
    return SingleChildScrollView(
      key: const Key('site-summary-scroll'),
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('현장 요약', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 16),
          _receipt(prefix: 'site', fetchedAt: data?.fetchedAt),
          const SizedBox(height: 16),
          _Panel(
            key: const Key('site-signals'),
            child: Column(
              children: [
                for (final entry in [
                  ('weather', '기상', data?.weather),
                  ('workers', '작업자', data?.workers),
                  ('gas', '가스', data?.gas),
                  ('aed', 'AED', data?.aed),
                ]) ...[
                  if (entry.$1 != 'weather') const Divider(height: 1),
                  _signal(entry.$1, entry.$2, entry.$3),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),
          _Panel(
            key: const Key('site-alerts'),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '미대응 경보',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(_forbidden ? '접근 권한 없음' : _alertsText(data?.alerts)),
                  if (!_forbidden && data?.alerts.ok == true)
                    Text(switch (data!.alerts.siteScoped) {
                      false => '전체 현장 기준 · 이 현장만의 경보 수가 아닙니다',
                      true => '이 현장 기준',
                      null => '경보 집계 범위 확인 불가',
                    }),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          _Panel(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '현장 CCTV',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const Text('CAM-03 · 스냅샷 갱신 영상'),
                  const SizedBox(height: vgGapTap),
                  OutlinedButton.icon(
                    key: const Key('site-open-cctv'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(vgTapMin, vgTapMin),
                    ),
                    onPressed: () => _showVideo(true),
                    icon: const Icon(Icons.videocam_outlined),
                    label: const Text('영상 보기'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _signal(String id, String title, SiteStatusSection? section) {
    final text = _forbidden ? '접근 권한 없음' : _signalText(id, section);
    return InkWell(
      key: Key('site-row-$id'),
      onTap: _forbidden
          ? null
          : id == 'workers'
          ? () => setState(() => _workers = true)
          : id == 'gas'
          ? () => setState(() => _gas = true)
          : id == 'aed'
          ? () => setState(() => _aed = true)
          : () => setState(() => _weather = true),
      child: ConstrainedBox(
        // V-5: 기본 72dp. 큰 글자는 높이를 늘리고 바깥 화면을 스크롤한다.
        constraints: const BoxConstraints(minHeight: 72),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              _SignalMark(level: _forbidden ? null : section?.level),
              const SizedBox(width: 16),
              Expanded(
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: '$title  ',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                      TextSpan(text: text),
                    ],
                  ),
                ),
              ),
              if (!_forbidden) const Icon(Icons.chevron_right, size: 24),
            ],
          ),
        ),
      ),
    );
  }
}

String _signalText(String id, SiteStatusSection? section) {
  if (section == null) return '데이터 없음 · 한 번도 받지 못함';
  if (!section.ok) return '수신 실패 · 이 항목의 상태를 확인할 수 없습니다';
  if (section.level == 'idle' && id != 'aed') return _noData;
  if (id == 'workers') {
    final normal = section.normal == null
        ? '정상 인원 데이터 없음'
        : '정상 ${section.normal}명';
    final waiting = section.waiting == null
        ? '대기 인원 데이터 없음'
        : '대기 ${section.waiting}명';
    return '$normal · $waiting';
  }
  if (id == 'aed') {
    final total = section.total == null
        ? '장비 수 데이터 없음'
        : '장비 ${section.total}대';
    return '$total · ${section.summary ?? '요약 데이터 없음'}';
  }
  return section.summary ?? '데이터 없음 · 요약을 받지 못함';
}

String _alertsText(SiteStatusAlerts? alerts) {
  if (alerts == null) return '데이터 없음 · 한 번도 받지 못함';
  if (!alerts.ok) return '경보 수신 실패 · 미대응 건수를 확인할 수 없습니다';
  if (alerts.unacked == null) return '데이터 없음 · 미대응 건수를 받지 못함';
  return alerts.unacked == 0 ? '미대응 경보 0건' : '미대응 경보 ${alerts.unacked}건';
}

class _Panel extends StatelessWidget {
  const _Panel({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Material(
    color: VgColors.canvas,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(vgRadiusCard),
      side: const BorderSide(color: VgColors.hairlineStrong),
    ),
    clipBehavior: Clip.antiAlias,
    child: child,
  );
}

class _SignalMark extends StatelessWidget {
  const _SignalMark({required this.level});
  final String? level;

  @override
  Widget build(BuildContext context) {
    // warn은 관제 caution과 같은 의미색이다. 모양·기호·접근성 이름도 제공한다.
    final (symbol, label, color) = switch (level) {
      'normal' => ('✓', '정상', VgColors.ok),
      'warn' => ('!', '주의', VgColors.warn),
      'danger' => ('!!', '위험', VgColors.danger),
      'idle' => ('—', '데이터 없음 또는 전원 대기', VgColors.surfaceStrong),
      _ => ('?', '상태 확인 불가', VgColors.surfaceStrong),
    };
    return Semantics(
      label: label,
      child: ExcludeSemantics(
        child: Container(
          constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: color,
            shape: level == 'danger' ? BoxShape.circle : BoxShape.rectangle,
            borderRadius: level == 'danger' ? null : BorderRadius.circular(6),
            border: Border.all(color: VgColors.ink),
          ),
          child: Text(
            symbol,
            style: const TextStyle(
              color: VgColors.ink,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      ),
    );
  }
}
