// 하단에 떠 있는 유리 탭 바 — iOS 26 Liquid Glass 의 **근사**다(재질 자체는 쓸 수 없다)
//
// ★ 설치 SDK(Flutter 3.44.3 stable)에 Liquid Glass API 가 **0건**이다
//   (`packages/flutter/lib/src` 전수 grep · 2026-08-19 확인). Flutter 는 화면을 자기가
//   그리므로 UIKit 이 시스템에서 합성하는 유리 재질을 가져올 방법이 없고, `BackdropFilter`
//   블러로 **같아 보이게 그리는 것**이 상한이다. 같은 경로를 `CupertinoTabBar` 가 이미 쓴다
//   (`cupertino/bottom_tab_bar.dart:201` · blur sigma 10).
//
// ⚠ 그래서 **못 얻는 것**을 적어 둔다 — 뒤 콘텐츠 굴절 · 기울기 따라 흐르는 스펙큘러 ·
//   탭 전환 시 유체 변형. `FragmentProgram` 으로 흉내낼 수는 있으나 매 프레임 셰이더라
//   이 앱에서는 값어치보다 비싸다. 정지 상태의 겉모습까지가 이 파일의 약속이다.
//
// ⚠ 블러는 **본문이 바 아래로 지나가야** 보인다(`Scaffold.extendBody: true`). 그러면 마지막
//   카드가 바에 가리므로 본문 하단 여백에 [glassTabBarInset] 을 더해야 한다 — 안 더하면
//   화면 밖으로 밀린 값은 없는 것과 같다.
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import 'theme.dart';

/// 바 자체 높이와 화면 아래 여백. 본문 여백 계산이 이 값을 그대로 쓴다.
const double glassTabBarHeight = 58;
const double glassTabBarGap = 10;

/// 본문이 바에 가리지 않도록 더해야 하는 하단 여백(홈 인디케이터 영역 포함).
double glassTabBarInset(BuildContext context) =>
    glassTabBarHeight + glassTabBarGap + MediaQuery.viewPaddingOf(context).bottom;

/// 탭 하나 — 아이콘과 이름을 함께 둔다(아이콘만으로는 무엇인지 알 수 없다는 실기기 확인).
typedef GlassTab = (IconData, String);

class GlassTabBar extends StatelessWidget {
  const GlassTabBar({
    super.key,
    required this.tabs,
    required this.currentIndex,
    required this.onTap,
  });

  final List<GlassTab> tabs;
  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, glassTabBarGap),
        child: DecoratedBox(
          // ⚠ 그림자는 **클립 바깥**에 둔다 — ClipRRect 안에 넣으면 같이 잘려 사라진다.
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.12),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
              child: Container(
                height: glassTabBarHeight,
                decoration: BoxDecoration(
                  // 반투명 흰 면 + 위쪽이 밝은 결 — 유리처럼 보이게 하는 것은 블러가 아니라
                  // 이 두 겹이다(블러만 주면 그냥 흐린 사각형이 된다).
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.white.withValues(alpha: 0.72),
                      Colors.white.withValues(alpha: 0.52),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.75)),
                ),
                child: Row(
                  children: [
                    for (var i = 0; i < tabs.length; i++)
                      Expanded(child: _GlassTabItem(
                        tab: tabs[i],
                        selected: i == currentIndex,
                        onTap: () => onTap(i),
                      )),
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

class _GlassTabItem extends StatelessWidget {
  const _GlassTabItem({required this.tab, required this.selected, required this.onTap});

  final GlassTab tab;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (icon, label) = tab;
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
              decoration: BoxDecoration(
                color: selected ? Colors.white.withValues(alpha: 0.95) : Colors.transparent,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Icon(icon, size: 19, color: selected ? VgColors.primary : VgColors.body),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              maxLines: 1,
              style: TextStyle(
                fontSize: 10,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? VgColors.primary : VgColors.body,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
