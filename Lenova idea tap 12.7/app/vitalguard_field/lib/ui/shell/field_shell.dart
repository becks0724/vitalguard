import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/action_placement.dart';
import '../../data/alerts_controller.dart';
import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';
import '../alerts/alerts_screen.dart';
import '../outbox/outbox_screen.dart';
import '../site/site_screen.dart';
import '../record/record_editor.dart';
import '../record/record_input.dart';
import '../record/record_screens.dart';
import '../record/record_session.dart';
import '../settings/settings_screen.dart';
import 'action_dock.dart';
import 'vg_background.dart';
import 'global_alert_strip.dart';

const String vgRailPreferenceKey = 'shell:rail-collapsed';

class FieldShell extends StatefulWidget {
  const FieldShell({super.key, required this.controller});

  final FieldController controller;

  @override
  State<FieldShell> createState() => _FieldShellState();
}

class _FieldShellState extends State<FieldShell> {
  int destination = 0;
  bool loggingOut = false;
  bool collapsed = false;
  int railRevision = 0;
  bool? lastWideWindow;
  late final NavigatorObserver recordObserver;
  late AlertsController alerts;
  late ActionPlacement actionPlacement;
  final alertsKey = GlobalKey<AlertsScreenState>();
  bool recordEditorOpen = false;
  final recordNavigator = GlobalKey<NavigatorState>();
  final receiptScroll = ScrollController(keepScrollOffset: false);

  @override
  void initState() {
    super.initState();
    alerts = AlertsController(widget.controller);
    loadActionPlacement();
    recordObserver = _RecordRouteObserver(editorRouteChanged);
    unawaited(loadRailPreference());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(restoreRecord());
    });
  }

  Future<void> restoreRecord() async {
    try {
      final saved = await RecordSession(widget.controller).read();
      if (!mounted || saved == null || recordNavigator.currentState == null) {
        return;
      }
      final media = CalendarMedia(
        Map<String, dynamic>.from(saved['media'] as Map),
      );
      final ink = saved['ink'] == true;
      setState(() => destination = 2);
      recordNavigator.currentState!.push(
        MaterialPageRoute<void>(builder: (_) => PhotoDetail(
          controller: widget.controller, photoId: media.id,
        )),
      );
      // 재로그인한 같은 계정의 기기 초안으로 복귀한다. 복구 자체는 전송하지 않는다.
      recordNavigator.currentState!.push(
        MaterialPageRoute<void>(
          settings: RouteSettings(name: ink ? vgRecordEditorRouteName : 'R-06'),
          builder: (_) => ink
              ? RecordEditor(controller: widget.controller, original: media)
              : RecordInput(
                  controller: widget.controller,
                  media: media,
                ),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('작성하던 기록을 열지 못했습니다. 같은 사진에서 초안을 다시 열어 주세요.'),
        ),
      );
    }
  }

  void loadActionPlacement() {
    actionPlacement = ActionPlacement(
      widget.controller.local,
      widget.controller.user!.id,
    );
    unawaited(actionPlacement.load());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final wideWindow = MediaQuery.sizeOf(context).width >= vgTwoPaneMinWidth;
    if (lastWideWindow == null) {
      collapsed = !wideWindow;
    } else if (lastWideWindow != wideWindow && !wideWindow) {
      railRevision++;
      collapsed = true;
    }
    lastWideWindow = wideWindow;
  }

  Future<void> loadRailPreference() async {
    final revision = railRevision;
    try {
      final stored = await widget.controller.local.read(
        widget.controller.user!.id,
        vgRailPreferenceKey,
      );
      if (!mounted || revision != railRevision || stored == null) return;
      setState(() => collapsed = stored == 'true');
    } catch (_) {
      // 로컬 선택을 읽지 못하면 현재 창 너비의 기본값을 유지한다.
    }
  }

  Future<void> setCollapsed(bool next, {required bool persist}) async {
    final previous = collapsed;
    final revision = ++railRevision;
    if (previous != next && mounted) setState(() => collapsed = next);
    if (!persist) return;
    try {
      await widget.controller.local.write(
        widget.controller.user!.id,
        vgRailPreferenceKey,
        '$next',
      );
    } catch (_) {
      if (!mounted || revision != railRevision) return;
      setState(() => collapsed = previous);
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('레일 접힘 상태를 저장하지 못했습니다.')));
    }
  }

  void editorRouteChanged(bool open) {
    if (!mounted) return;
    setState(() => recordEditorOpen = open);
    if (open) unawaited(setCollapsed(true, persist: true));
  }

  @override
  void didUpdateWidget(FieldShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      alerts.dispose();
      alerts = AlertsController(widget.controller);
      actionPlacement.dispose();
      loadActionPlacement();
    }
  }

  @override
  void dispose() {
    alerts.dispose();
    actionPlacement.dispose();
    receiptScroll.dispose();
    super.dispose();
  }

  void openStripAlert(AlertItem alert) {
    if (recordEditorOpen || !alerts.authorized || alerts.forbidden) return;
    alertsKey.currentState?.openDetail(alert);
    selectDestination(1);
  }

  void selectDestination(int index) {
    if (index != 2) {
      widget.controller.speech.stop(cancel: true).catchError((_) {});
    }
    setState(() => destination = index);
  }

  Future<void> logout() async {
    setState(() => loggingOut = true);
    try {
      await widget.controller.signOut();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('초안 저장 상태를 확인한 뒤 다시 로그아웃해 주세요')),
      );
      setState(() => loggingOut = false);
    }
  }

  String receipt(FieldController c) {
    if (destination <= 1 && c.siteStatusForbidden) {
      return '마지막 수신 정보 표시 불가 · 접근 권한 없음';
    }
    if (c.offline) {
      const reason = '오프라인 · 서버에 연결할 수 없습니다.';
      return switch (destination) {
        0 =>
          '$reason 최신 현장 정보는 받을 수 없습니다. 이전 수신 자료입니다. '
              '현장 요약·작업자·가스 화면이 열려 있으면 ${siteStatusRefreshInterval.inSeconds}초마다 조회를 재시도합니다. 새로 고침으로도 재시도할 수 있습니다.',
        1 =>
          '$reason 경보 대응 확인은 연결 후 가능하며 예약되지 않습니다. '
              '이 화면이 열려 있으면 ${siteStatusRefreshInterval.inSeconds}초마다 조회를 재시도합니다. 연결 후 경보를 다시 확인하고 대응 확인을 눌러 주세요.',
        2 =>
          '$reason 최신 기록 조회·전송은 할 수 없습니다. 이전에 받은 자료입니다. '
              '사진·잉크본·음성 댓글은 전송 대기열에, 글 댓글은 기기 초안에 보관합니다. '
              '연결 후 기록 새로 고침, 사진·음성 댓글은 전송 상태에서 전송/재시도, 글 댓글은 입력 화면에서 확인 후 댓글 저장을 눌러 주세요.',
        3 =>
          '$reason 사진·잉크본·음성 댓글은 전송 대기열에 보관합니다. '
              '연결 후 각 항목의 전송/재시도를 눌러 주세요. 결과 불명 항목은 서버 반영 여부부터 확인해 주세요.',
        _ =>
          '$reason 설정은 기기에 저장할 수 있습니다. '
              '현장 요약·경보 화면을 열면 조회를 재시도합니다.',
      };
    }
    if (destination <= 1) {
      if (destination == 1 && c.siteStatusSnapshot?.alerts.ok == false) {
        return '경보 수신 실패 · 이전 수신 정보는 경보 화면에서 확인해 주세요';
      }
      return siteStatusReceipt(c.siteStatusSnapshot?.fetchedAt);
    }
    return c.fetchedAt == null
        ? '기록을 확인해 주세요'
        : '마지막 수신 ${c.fetchedAt!.toLocal().toString().substring(0, 19)}';
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final backdrop = vgBackdropOf(context);
    final siteName = c.site?.site_name ?? '현장 정보 없음';
    final userName = c.user?.name ?? c.user?.id ?? '사용자 정보 없음';
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: Row(
          children: [
            _FieldRail(
              collapsed: collapsed,
              siteName: siteName,
              userName: userName,
              isMock: c.isMock,
              destination: destination,
              loggingOut: loggingOut,
              onCollapseToggle: () => setCollapsed(!collapsed, persist: true),
              onDestinationSelected: selectDestination,
              onLogout: logout,
            ),
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Positioned.fill(child: VgBackground(backdrop: backdrop)),
                  Column(
                    children: [
                      // C-01/C-04: 상태가 바뀌어도 본문·L-07 좌표는 같다.
                      // 글자 배율에만 높이를 맞추고 긴 안내는 기존 바 안에서 스크롤한다.
                      SizedBox(
                        key: const Key('shell-receipt-slot'),
                        height:
                            52 *
                            MediaQuery.textScalerOf(context)
                                .scale(1)
                                .clamp(1, double.infinity),
                        width: double.infinity,
                        child: AnimatedBuilder(
                          animation: c,
                          builder: (_, _) => ColoredBox(
                            color: c.offline
                                ? const Color(0xFFFFF1CD)
                                : const Color(0xFFF3F4F6),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 20,
                                vertical: 8,
                              ),
                              child: Row(
                                children: [
                                  Flexible(
                                    flex: 2,
                                    child: SingleChildScrollView(
                                      primary: false,
                                      child: Tooltip(
                                        message: siteName,
                                        child: Text(
                                          '현장 · $siteName',
                                          style: const TextStyle(
                                            color: VgColors.ink,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 16),
                                  const SizedBox(
                                    height: 28,
                                    child: VerticalDivider(
                                      width: 1,
                                      thickness: 1,
                                      color: VgColors.hairlineStrong,
                                    ),
                                  ),
                                  const SizedBox(width: 16),
                                  Expanded(
                                    flex: 3,
                                    child: KeyedSubtree(
                                      // 새 상태/목적지 안내는 첫 문장부터 읽는다.
                                      key: ValueKey((destination, c.offline)),
                                      child: Scrollbar(
                                        controller: receiptScroll,
                                        thumbVisibility: true,
                                        child: SingleChildScrollView(
                                          key: const Key(
                                            'shell-receipt-scroll',
                                          ),
                                          controller: receiptScroll,
                                          primary: false,
                                          child: Text(
                                            receipt(c),
                                            key: const Key('shell-receipt'),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: ActionPlacementScope(
                          placement: actionPlacement,
                          child: IndexedStack(
                            key: const Key('shell-content'),
                            index: destination,
                            children: [
                              // S-01의 영상 카드에서 기존 CCTV로 진입한다.
                              SiteScreen(
                                controller: c,
                                active: destination == 0,
                              ),
                              AlertsScreen(
                                key: alertsKey,
                                controller: c,
                                alerts: alerts,
                                active: destination == 1,
                              ),
                              NavigatorPopHandler<void>(
                                enabled: destination == 2,
                                onPopWithResult: (_) {
                                  recordNavigator.currentState!.maybePop();
                                },
                                child: Navigator(
                                  key: recordNavigator,
                                  observers: [recordObserver],
                                  onGenerateRoute: (_) =>
                                      MaterialPageRoute<void>(
                                        builder: (_) =>
                                            RecordHome(controller: c),
                                      ),
                                ),
                              ),
                              OutboxScreen(
                                controller: c,
                                active: destination == 3,
                              ),
                              SettingsScreen(placement: actionPlacement),
                            ],
                          ),
                        ),
                      ),
                      GlobalAlertStrip(
                        controller: alerts,
                        deferred: recordEditorOpen,
                        onOpen: openStripAlert,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RecordRouteObserver extends NavigatorObserver {
  _RecordRouteObserver(this.onEditorChanged);

  final ValueChanged<bool> onEditorChanged;
  final _editors = <Route<dynamic>>{};

  void opened(Route<dynamic>? route) {
    if (route?.settings.name != vgRecordEditorRouteName) return;
    final wasEmpty = _editors.isEmpty;
    _editors.add(route!);
    if (wasEmpty) onEditorChanged(true);
  }

  void closed(Route<dynamic>? route) {
    if (!_editors.contains(route)) return;
    void finish() {
      if (_editors.remove(route) && _editors.isEmpty) onEditorChanged(false);
    }

    // 퇴장 애니메이션 중에도 편집기가 남아 있으므로 완전히 닫힌 뒤 해제한다.
    if (route is TransitionRoute<dynamic>) {
      unawaited(route.completed.then((_) => finish()));
    } else {
      finish();
    }
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    opened(route);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPop(route, previousRoute);
    closed(route);
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didRemove(route, previousRoute);
    closed(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    super.didReplace(newRoute: newRoute, oldRoute: oldRoute);
    opened(newRoute);
    closed(oldRoute);
  }
}

class _FieldRail extends StatelessWidget {
  const _FieldRail({
    required this.collapsed,
    required this.siteName,
    required this.userName,
    required this.isMock,
    required this.destination,
    required this.loggingOut,
    required this.onCollapseToggle,
    required this.onDestinationSelected,
    required this.onLogout,
  });

  final bool collapsed;
  final String siteName;
  final String userName;
  final bool isMock;
  final int destination;
  final bool loggingOut;
  final VoidCallback onCollapseToggle;
  final ValueChanged<int> onDestinationSelected;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) => Material(
    key: Key(collapsed ? 'rail-collapsed' : 'rail-expanded'),
    color: VgColors.canvas,
    child: Container(
      width: collapsed ? 80 : 256,
      // 테두리를 패딩에 합산하면 접힌 레일의 타깃 폭이 80 - 24 - 1 = 55가 된다.
      foregroundDecoration: const BoxDecoration(
        border: Border(right: BorderSide(color: VgColors.hairlineStrong)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: _RailViewport(
          children: [
            if (collapsed) ...[
              SizedBox(
                height: 56,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    if (isMock)
                      const Positioned(
                        left: -12,
                        top: 8,
                        child: Tooltip(
                          message: '모의 데이터',
                          child: SizedBox(
                            key: Key('mock-rail-marker'),
                            width: 6,
                            height: 40,
                            child: ColoredBox(color: VgColors.primary),
                          ),
                        ),
                      ),
                    Center(
                      child: IconButton(
                        key: const Key('rail-collapse-toggle'),
                        tooltip: '레일 펼치기',
                        style: IconButton.styleFrom(
                          minimumSize: const Size.square(vgTapMin),
                        ),
                        onPressed: onCollapseToggle,
                        icon: const Icon(Icons.chevron_right),
                      ),
                    ),
                  ],
                ),
              ),
            ] else ...[
              Row(
                children: [
                  Expanded(
                    child: Text(
                      siteName,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  IconButton(
                    key: const Key('rail-collapse-toggle'),
                    tooltip: '레일 접기',
                    style: IconButton.styleFrom(
                      minimumSize: const Size.square(vgTapMin),
                    ),
                    onPressed: onCollapseToggle,
                    icon: const Icon(Icons.chevron_left),
                  ),
                ],
              ),
              if (isMock)
                const Padding(
                  padding: EdgeInsets.only(bottom: 16),
                  child: Text('모의 데이터', key: Key('mock-label')),
                ),
            ],
            const SizedBox(height: 16),
            if (!collapsed) const _RailGroupTitle('상황'),
            _RailItem(
              index: 0,
              label: '현장',
              icon: Icons.location_city,
              expanded: !collapsed,
              selected: destination == 0,
              onSelected: onDestinationSelected,
            ),
            const SizedBox(height: vgGapTap),
            _RailItem(
              index: 1,
              label: '경보',
              icon: Icons.notifications_outlined,
              expanded: !collapsed,
              selected: destination == 1,
              onSelected: onDestinationSelected,
            ),
            const SizedBox(height: 24),
            if (!collapsed) const _RailGroupTitle('기록'),
            _RailItem(
              index: 2,
              label: '기록',
              icon: Icons.edit_calendar_outlined,
              expanded: !collapsed,
              selected: destination == 2,
              onSelected: onDestinationSelected,
            ),
            const SizedBox(height: vgGapTap),
            _RailItem(
              index: 3,
              label: '전송 상태',
              icon: Icons.outbox_outlined,
              expanded: !collapsed,
              selected: destination == 3,
              onSelected: onDestinationSelected,
            ),
            const Spacer(),
            const Divider(key: Key('rail-footer-divider')),
            _RailItem(
              index: 4,
              label: '설정',
              icon: Icons.settings_outlined,
              expanded: !collapsed,
              selected: destination == 4,
              onSelected: onDestinationSelected,
            ),
            const SizedBox(height: vgGapTap),
            if (collapsed) ...[
              Tooltip(
                message: userName,
                child: const SizedBox(
                  height: 56,
                  child: Icon(Icons.person_outline, size: 20),
                ),
              ),
              IconButton(
                tooltip: '로그아웃',
                style: IconButton.styleFrom(
                  minimumSize: const Size.square(vgTapMin),
                ),
                onPressed: loggingOut ? null : onLogout,
                icon: const Icon(Icons.logout),
              ),
            ] else ...[
              Row(
                children: [
                  const Icon(Icons.person_outline, size: 20),
                  const SizedBox(width: 12),
                  Expanded(child: Text(userName)),
                ],
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(vgTapMin),
                ),
                onPressed: loggingOut ? null : onLogout,
                icon: const Icon(Icons.logout),
                label: const Text('로그아웃'),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}

class _RailViewport extends StatelessWidget {
  const _RailViewport({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => CustomScrollView(
    primary: false,
    slivers: [
      // 공간이 남으면 Spacer로 하단을 고정하고, 부족하면 타깃 높이 대신 스크롤을 늘린다.
      SliverFillRemaining(
        hasScrollBody: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: children,
          ),
        ),
      ),
    ],
  );
}

class _RailGroupTitle extends StatelessWidget {
  const _RailGroupTitle(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(left: 16, bottom: 8),
    child: Text(
      label,
      style: const TextStyle(fontWeight: FontWeight.bold, color: VgColors.body),
    ),
  );
}

class _RailItem extends StatelessWidget {
  const _RailItem({
    required this.index,
    required this.label,
    required this.icon,
    required this.expanded,
    required this.selected,
    required this.onSelected,
  });

  final int index;
  final String label;
  final IconData icon;
  final bool expanded;
  final bool selected;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final foreground = selected ? Colors.white : VgColors.ink;
    return Tooltip(
      message: label,
      child: Material(
        color: selected ? VgColors.primary : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: Key('rail-destination-$index'),
          onTap: () => onSelected(index),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: vgTapMin),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: expanded ? 16 : 8),
              child: Row(
                children: [
                  if (expanded) ...[
                    Icon(icon, size: 20, color: foreground),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Text(
                        label,
                        style: TextStyle(
                          color: foreground,
                          fontWeight: selected
                              ? FontWeight.bold
                              : FontWeight.normal,
                        ),
                      ),
                    ),
                  ] else
                    Expanded(
                      child: Center(
                        child: Icon(icon, size: 20, color: foreground),
                      ),
                    ),
                  SizedBox(
                    width: 8,
                    height: 8,
                    child: selected
                        ? const DecoratedBox(
                            key: Key('rail-selection-dot'),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                            ),
                          )
                        : null,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
