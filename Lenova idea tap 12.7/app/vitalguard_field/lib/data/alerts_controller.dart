import 'package:flutter/foundation.dart';

import 'contracts/field_contracts.dart';

// 모두 화면의 전송 상태다. 서버 컬럼이나 지연 전송 작업이 아니다.
enum AlertWritePhase {
  idle,
  sending,
  confirmed,
  failed,
  uncertain,
  conflict,
  retryReady,
}

class AlertsController extends ChangeNotifier {
  AlertsController(this.field) : _account = field.user?.id {
    _observed = field.siteStatusSnapshot;
    _accept(_observed);
    field.addListener(_fieldChanged);
  }

  final FieldController field;
  final String? _account;
  SiteStatus? data, _observed;
  bool loading = false, readFailed = false;
  bool _disposed = false;
  final _writes = <String, AlertWritePhase>{};
  final _failures = <String, String>{};
  final reopened = <String>{};
  final closed = <String>{};

  bool get forbidden => field.siteStatusForbidden;
  bool get authorized =>
      field.user?.id == _account && field.authStage == AuthStage.ready;
  bool get sending => _writes.containsValue(AlertWritePhase.sending);
  List<AlertItem> get items => data?.alerts.items ?? const [];
  AlertItem? item(String id) =>
      items.where((item) => item.id == id).firstOrNull;
  AlertWritePhase phase(String id) => _writes[id] ?? AlertWritePhase.idle;
  String failure(String id) => _failures[id] ?? '요청이 거부되었습니다';

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _fieldChanged() {
    if (!authorized || forbidden) {
      data = null;
      _writes.clear();
      _failures.clear();
      reopened.clear();
      closed.clear();
    } else if (!loading &&
        !sending &&
        !identical(_observed, field.siteStatusSnapshot)) {
      _accept(field.siteStatusSnapshot);
    }
    _observed = field.siteStatusSnapshot;
    _notify();
  }

  void _accept(SiteStatus? next, {bool reconcileWrites = false}) {
    if (next == null) return;
    if (!next.alerts.ok || !next.alerts.itemsAvailable) {
      readFailed = true;
      return; // N-1: 이전 내용은 유지하되 최신 조회 성공으로 꾸미지 않는다.
    }
    for (final row in next.alerts.items) {
      final previous = item(row.id);
      if (previous != null) {
        if (previous.acknowledged && !row.acknowledged) {
          reopened.add(row.id);
          closed.remove(row.id);
          if (phase(row.id) != AlertWritePhase.uncertain) {
            _writes.remove(row.id);
          }
          _failures.remove(row.id);
        } else if (!previous.acknowledged && row.acknowledged) {
          closed.add(row.id);
          reopened.remove(row.id);
        }
      }
      // 결과 불명은 POST 이후에 시작한 GET으로만 해소한다.
      // 목록 누락/부분 오류는 완료나 재시도 가능으로 바꾸지 않는다.
      if (reconcileWrites && phase(row.id) == AlertWritePhase.uncertain) {
        _writes[row.id] = row.acknowledged
            ? AlertWritePhase.confirmed
            : AlertWritePhase.retryReady;
      }
    }
    data = next;
    readFailed = false;
  }

  Future<void> refresh() async {
    if (_disposed || loading || sending || forbidden || !authorized) return;
    loading = true;
    _notify();
    try {
      // SiteScreen과 같은 컨트롤러·게이트웨이·응답 캐시를 사용한다.
      final next = await field.siteStatus();
      if (_disposed || !authorized) return;
      _observed = next;
      _accept(next, reconcileWrites: true);
    } catch (_) {
      if (_disposed) return;
      readFailed = true;
      if (forbidden || !authorized) data = null;
    } finally {
      loading = false;
      _notify();
    }
  }

  bool canAck(AlertItem displayed) {
    final current = item(displayed.id);
    return !_disposed &&
        authorized &&
        !forbidden &&
        !field.offline &&
        !loading &&
        !sending &&
        !readFailed &&
        current != null &&
        current.workerId != null &&
        current.ts != null &&
        current.sameOccurrence(displayed) &&
        !current.acknowledged &&
        const {
          AlertWritePhase.idle,
          AlertWritePhase.failed,
          AlertWritePhase.retryReady,
        }.contains(phase(current.id));
  }

  Future<void> acknowledge(AlertItem displayed) async {
    // L-02/L-03: 상세의 명시적 실행만 들어온다. 오프라인·연타는 상태도 만들지 않는다.
    if (!canAck(displayed)) return;
    final id = displayed.id;
    _writes[id] = AlertWritePhase.sending;
    _failures.remove(id);
    _notify();
    try {
      final acked = await field.ackAlert(id);
      if (_disposed || !authorized) return;
      // L-05: 200 acked:false는 충돌이다. 실패 상태를 거치지 않는다.
      _writes[id] = acked
          ? AlertWritePhase.confirmed
          : AlertWritePhase.conflict;
    } catch (error) {
      if (_disposed || !authorized) return;
      final rejected =
          error is ApiFailure &&
          !error.uncertainWrite &&
          error.status != null &&
          error.status! >= 400 &&
          error.status! < 500;
      _writes[id] = rejected
          ? AlertWritePhase.failed
          : AlertWritePhase.uncertain;
      if (rejected) {
        _failures[id] = switch (error.status) {
          401 => '로그인을 확인한 뒤 서버 상태를 다시 조회해 주세요',
          403 => '대응 확인 권한이 없습니다. 관리자에게 문의해 주세요',
          404 => '대상을 찾을 수 없습니다. 서버 상태를 다시 조회해 주세요',
          429 => '요청이 많습니다. 잠시 후 서버 상태를 다시 조회해 주세요',
          _ => '요청이 거부되었습니다. 서버 상태를 다시 조회해 주세요',
        };
      }
    }
    _notify();
    // L-04/L-05: 성공·충돌·결과 불명 모두 GET으로 원장을 확인한다.
    // 어떤 결과에서도 acknowledge를 자동으로 다시 호출하지 않는다.
    if (phase(id) != AlertWritePhase.failed) await refresh();
  }

  @override
  void dispose() {
    _disposed = true;
    field.removeListener(_fieldChanged);
    super.dispose();
  }
}
