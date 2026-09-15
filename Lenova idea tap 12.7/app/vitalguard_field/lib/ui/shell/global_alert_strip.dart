import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../data/alerts_controller.dart';
import '../../data/contracts/field_contracts.dart';
import '../../vg_theme.dart';

/// L-07: 기존 경보 수신만 관찰한다. 조회·타이머·대응 확인은 소유하지 않는다.
class GlobalAlertStrip extends StatefulWidget {
  const GlobalAlertStrip({
    super.key,
    required this.controller,
    required this.deferred,
    required this.onOpen,
  });

  final AlertsController controller;
  final bool deferred;
  final ValueChanged<AlertItem> onOpen;

  @override
  State<GlobalAlertStrip> createState() => _GlobalAlertStripState();
}

class _GlobalAlertStripState extends State<GlobalAlertStrip> {
  // 서버가 파싱한 5종 중 ack_at == null인 건만, 최초 수신 순서대로 유지한다.
  // 새 경보가 지금 보이는 건을 교체하지 않는다. 목록 누락은 종료로 추정하지 않는다.
  final _pending = <String, AlertItem>{};
  final _dismissed = <String, AlertItem>{};
  SiteStatus? _observed;

  @override
  void initState() {
    super.initState();
    _accept();
    widget.controller.addListener(_changed);
  }

  @override
  void didUpdateWidget(GlobalAlertStrip oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_changed);
      _pending.clear();
      _dismissed.clear();
      _observed = null;
      _accept();
      widget.controller.addListener(_changed);
    }
  }

  void _accept() {
    final alerts = widget.controller;
    if (!alerts.authorized || alerts.forbidden) {
      _pending.clear();
      _dismissed.clear();
      _observed = null;
      return;
    }
    if (identical(_observed, alerts.data)) return;
    _observed = alerts.data;
    for (final row in alerts.items) {
      if (row.acknowledged) {
        _pending.remove(row.id);
      } else if (_dismissed[row.id]?.sameOccurrence(row) != true) {
        final previous = _pending[row.id];
        if (previous != null && !previous.sameOccurrence(row)) {
          _pending.remove(row.id);
        }
        _pending[row.id] = row;
      }
    }
  }

  void _changed() {
    _accept();
    // 경보 탭 활성화 중의 동기 알림도 형제 위젯의 build를 방해하지 않는다.
    if (SchedulerBinding.instance.schedulerPhase ==
        SchedulerPhase.persistentCallbacks) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() {});
      });
    } else {
      setState(() {});
    }
  }

  void _dismiss(AlertItem row) {
    setState(() {
      // 화면 수명 내 표시 억제일 뿐이다. 서버·컨트롤러·저장소에 쓰지 않는다.
      _dismissed[row.id] = row;
      _pending.remove(row.id);
    });
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final alerts = widget.controller;
    final row = alerts.authorized && !alerts.forbidden
        ? _pending.values.firstOrNull
        : null;
    final lineHeight = MediaQuery.textScalerOf(context).scale(16) * 1.3;
    final height = math.max(vgTapMin, lineHeight * 2 + 24);
    // 빈 상태/보류/표시/닫기 모두 같은 공간. 새 수신은 본문 좌표를 바꾸지 않는다.
    return SizedBox(
      key: const Key('global-alert-slot'),
      height: height + 16,
      width: double.infinity,
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Align(
          alignment: Alignment.bottomRight,
          child: row == null || widget.deferred
              ? null
              : SizedBox(
                  width: 640,
                  height: height,
                  child: Semantics(
                    container: true,
                    liveRegion: false,
                    child: Material(
                      key: const Key('global-alert-strip'),
                      color: VgColors.canvas,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                        side: const BorderSide(color: VgColors.hairlineStrong),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Row(
                        children: [
                          Expanded(
                            child: Semantics(
                              label:
                                  '마지막 수신 기준 · 전체 현장 미대응 '
                                  '${row.type.label} · '
                                  '${row.workerName ?? row.workerId ?? '작업자 정보 없음'} · 경보 상세 보기',
                              child: InkWell(
                                key: const Key('global-alert-open'),
                                onTap: () => widget.onOpen(row),
                                enableFeedback: false,
                                child: Padding(
                                  padding: const EdgeInsets.all(8),
                                  child: Row(
                                    children: [
                                      const Icon(
                                        Icons.notifications_outlined,
                                        color: VgColors.ink,
                                        size: 24,
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: SingleChildScrollView(
                                          key: const Key(
                                            'global-alert-text-scroll',
                                          ),
                                          primary: false,
                                          child: DefaultTextStyle(
                                            style: const TextStyle(
                                              color: VgColors.ink,
                                              fontSize: 16,
                                              height: 1.3,
                                            ),
                                            child: Column(
                                              mainAxisSize: MainAxisSize.min,
                                              mainAxisAlignment:
                                                  MainAxisAlignment.center,
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  '${row.type.label} · 미대응 (수신 기준)',
                                                  style: const TextStyle(
                                                    fontWeight: FontWeight.bold,
                                                  ),
                                                ),
                                                Text(
                                                  '${row.workerName ?? row.workerId ?? '작업자 정보 없음'} · 상세 보기',
                                                ),
                                              ],
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
                          const SizedBox(width: vgGapTap),
                          IconButton(
                            key: const Key('global-alert-dismiss'),
                            tooltip: '스트립만 닫기 · 경보는 미대응으로 유지',
                            constraints: const BoxConstraints.tightFor(
                              width: vgTapMin,
                              height: vgTapMin,
                            ),
                            onPressed: () => _dismiss(row),
                            enableFeedback: false,
                            icon: const Icon(Icons.close, color: VgColors.ink),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}
