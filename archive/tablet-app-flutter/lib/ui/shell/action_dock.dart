import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../data/action_placement.dart';
import '../../vg_theme.dart';

class ActionPlacementScope extends InheritedNotifier<ActionPlacement> {
  const ActionPlacementScope({
    super.key,
    required ActionPlacement placement,
    required super.child,
  }) : super(notifier: placement);

  static ActionPlacement? of(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<ActionPlacementScope>()
      ?.notifier;
}

/// 실행 위젯 한 벌의 위치만 옮긴다. 내용·버튼 순서는 뒤집지 않는다.
class ActionDock extends StatelessWidget {
  const ActionDock({super.key, required this.child, this.maxWidth = 480});

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final placement = ActionPlacementScope.of(context);
    final gestures = MediaQuery.systemGestureInsetsOf(context);
    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          20 + gestures.left,
          vgGapTap,
          20 + gestures.right,
          vgGapTap + gestures.bottom,
        ),
        child: LayoutBuilder(
          builder: (context, constraints) => Align(
            alignment: placement?.side == ActionSide.left
                ? Alignment.bottomLeft
                : Alignment.bottomRight,
            heightFactor: 1,
            child: SizedBox(
              // 좁은 창에서도 실행 묶음의 좌우 이동 여백을 남긴다.
              width: math.min(maxWidth, constraints.maxWidth * 0.9),
              child: Visibility(
                visible: placement?.loaded ?? true,
                maintainState: true,
                maintainAnimation: true,
                maintainSize: true,
                // C-04: 큰 글자에서 실행 묶음이 본문 전체를 차지하지 않는다.
                // 기존 높이로 들어가면 그대로, 넘치는 경우에만 묶음 안을 스크롤한다.
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: constraints.maxHeight * 0.5,
                  ),
                  child: SingleChildScrollView(primary: false, child: child),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
