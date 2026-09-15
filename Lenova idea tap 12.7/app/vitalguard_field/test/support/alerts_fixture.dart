import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';

import 'site_status_fixture.dart';

Map<String, dynamic> alertRow({
  String id = 'a1',
  String type = 'sos',
  String? ackAt,
  String? ackBy,
}) => {
  'id': id,
  'worker_id': 'worker-$id',
  'worker_name': '작업자 $id',
  'type': type,
  'ts': '2026-09-14T15:00:00Z',
  'created_at': '2026-09-14T15:00:01Z',
  'ack_at': ackAt,
  'ack_by': ackBy,
};

class AlertGatewayFixture extends MockGateway {
  List<Map<String, dynamic>> rows = [alertRow()];
  final calls = <String>[];
  Future<bool> Function(String id)? ack;
  Future<SiteStatus> Function()? fetch;
  bool alertsOk = true;

  SiteStatus snapshot() => SiteStatus({
    ...siteStatusReply(),
    'alerts': alertsOk
        ? {
            'ok': true,
            'siteScoped': false,
            'unacked': rows.where((r) => r['ack_at'] == null).length,
            'items': rows,
          }
        : {'ok': false, 'error': 'synthetic-private-error'},
  });

  @override
  Future<SiteStatus> siteStatus(String accessToken) async {
    calls.add('GET');
    return fetch == null ? snapshot() : await fetch!();
  }

  @override
  Future<bool> ackAlert(String accessToken, String id) async {
    calls.add('POST:$id');
    if (ack != null) return ack!(id);
    markAcked(id);
    return true;
  }

  void markAcked(String id, {String by = 'manager-a'}) {
    final row = rows.singleWhere((r) => r['id'] == id);
    row['ack_at'] = '2026-09-14T15:13:04Z';
    row['ack_by'] = by;
  }
}

class AlertStoreFixture extends MemoryStore {
  int writes = 0;
  @override
  Future<void> write(String accountId, String key, String value) {
    writes++;
    return super.write(accountId, key, value);
  }
}

class AlertFieldFixture extends FieldCoordinator {
  AlertFieldFixture(AlertGatewayFixture gateway, AlertStoreFixture store)
    : super(gateway, store, MockSpeechInput());

  void setOffline(bool value) {
    offline = value;
    notifyListeners();
  }

  void deliverSnapshot(SiteStatus value) {
    siteStatusSnapshot = value;
    notifyListeners();
  }
}
