import 'package:flutter/foundation.dart';

import 'contracts/field_contracts.dart';

enum ActionSide { left, right }

const vgActionSidePreferenceKey = 'settings:action-side';

/// 레일 선택과 같이 이 기기의 계정별 LocalStore에 보관한다.
class ActionPlacement extends ChangeNotifier {
  ActionPlacement(this.local, this.accountId);

  final LocalStore local;
  final String accountId;
  // 기존 가로 기록 화면의 오른쪽 실행 위치를 이어간다. 파지 우열의 뜻은 없다.
  ActionSide side = ActionSide.right;
  bool loaded = false;
  bool saving = false;
  String? error;
  bool _disposed = false;

  Future<void> load() async {
    try {
      final value = await local.read(accountId, vgActionSidePreferenceKey);
      if (_disposed) return;
      side = value == 'left' ? ActionSide.left : ActionSide.right;
    } catch (_) {
      if (_disposed) return;
      error = '실행 위치를 읽지 못했습니다. 사용할 쪽을 선택해 다시 저장해 주세요.';
    }
    if (_disposed) return;
    loaded = true;
    notifyListeners();
  }

  Future<void> select(ActionSide next) async {
    if (_disposed || !loaded || saving || (next == side && error == null)) {
      return;
    }
    final previous = side;
    side = next;
    saving = true;
    error = null;
    notifyListeners();
    try {
      await local.write(accountId, vgActionSidePreferenceKey, next.name);
    } catch (_) {
      if (_disposed) return;
      side = previous;
      error = '실행 위치를 저장하지 못했습니다. 다시 선택해 주세요.';
    }
    if (_disposed) return;
    saving = false;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
