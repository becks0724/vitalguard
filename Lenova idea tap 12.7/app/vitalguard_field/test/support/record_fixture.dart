import 'dart:convert';
import 'dart:typed_data';

import 'package:vitalguard_field/data/contracts/field_contracts.dart';

// 로컬 사진 UI용 고정 도면. 네트워크/이미지 생성 없이 엔진 디코드만 사용한다.
const _recordPlanPng =
    'iVBORw0KGgoAAAANSUhEUgAAA+gAAAKKCAMAAACZNoEzAAAACVBMVEXn5eB3fII9RE3IOgcYAAAJv0lEQVR42u3dQY7iShREUfP2'
    'v2gkGDFDiEzbEeesoOOmn6p60P8fBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQJ7H'
    'BzXU6K0RvdenrYYaDt2nrYZDN85Tq2GvcWqoYa9xaqhhr3FqqGGvcWqoYa9xaqhhr09bDTUcuk9bDYdunKdWw17j1FDDXuPUUMNe'
    '49RQw17j1FDDXuPUUMNej6mGGg7dp62GQ3foPm017DVODTXsNU4NNew1Tg017DVODTXsNU4NNez1mGqo4dB92mqo4dB92mo4dOPU'
    'UMNe49RQw17j1FDDXuPUUMNe49RQw17j1FDDXp+2Gmo4dJ+2Gg7dOE+thr3GqaGGvcapoYa9xqmhhr3GqaGGvcapoYa9HlMNNRy6'
    'T1sNh+7Qfdpq2GucGmrYa5waathrnBpq2GucGmrYa5waatjrMdVQw6H7tNVQw6H7tNVw6MapoYa9xqmhhr3GqaGGvcapoYa9xqmh'
    'hr3GqaGGvT5tNdRw6D5tNRy6cZ5aDXuNU0MNe41T479GDXs9ZnyNmVHDXo8ZXmNm1aU7dOM8tUP3+sapEXDnDt04T+3Qvb5xaiTc'
    'uUM3zlM7dK9vnBoJd+7QjfPUDt3rG6eGQ/f6xqlxizt36MZ5aofu9Y1TI+HOHbpxntqhe33j1Ei4c4dunKd26F7fODUS7tyhG+ep'
    'HbrXN04Nh+71T/yzE+R15zLs4dBx6A7doePOHbpDx6E7dIeOO3foDt2h49AdukPHoePOceg4dBw67tyhO3QcukN36Lhzh+7Q+erQ'
    'XbpDd+gunapD908RM2u8L33UsNe46Bo7Lt2hG+epL3LqathrXHaN5T/UHbpxnrrg0h26cZ664Nd3h26cpy74oe7QjfPUBZfu0I3z'
    '1AW/vjt04zx1wQ91h26cpy64dIdunKcu+PXdoRvnqQt+qDt04zx1waU7dOM8dcGv7w7dOE9dcOkO3ThP7Se61zdODX9H9/rGqXGH'
    'O3foxnnq/DN36MZ56oY7d+jGeeqCO3foxnnq/DN36MZ56oY7d+jGeepL3bka9nrM4Brjvxlnr3HxNfxXYO01Lr7G+v9Xi0M3zlPn'
    '37lDN85TF9y5QzfOU+efuUM3zlM33LlDN85Tn3/nathrXHKNXXfu0I3z1Gdfuhr2Ghf/d3Q17DVODTXs9WmroYZD92mr4dAduqdW'
    'w17j1FDDXuPUUMNe49RQw17j1FDDXuPUUMNej6mGGg7dp62GGg7dp62GQzdODTXsNU4NNew1Tg017DVODTXsNU4NNez1mGqoYa9P'
    'Ww01HLpPWw2HbpynVsNe49RQw17j1FDDXuPUUMNe49RQw17j1FDDXp+2Gmo4dJ+2Gg7doXtqNew1Tg017DVODTXsNU4NNew1Tg01'
    '7DVODTXs9ZhqqOHQfdpqqOHQfdpqOHTj1FDDXuPUUMNe49RQw17j1FDDXuPUUMNej6mGGvb6tNVQw6H7tNVw6MZ5ajXsNU4NNew1'
    'Tg017DVODTXsNU4NNew1Tg017PVpq6GGQ/dpq+HQHbqnVsNe49RQw17j1FDDXuPUUMNe49RQw17j1FDDXo+phhoO3aethkN36D5t'
    'New1Tg017DVODTXsNU4NNew1Tg017DVODTXs9ZhqqGGvT1sNNRy6T1sNh26cp1bDXuPUUMNe49RQw17j1FDDXuPUUMNe49RQw16f'
    'thpqOHSfthoO3aF7ajXsNU4NNew1Tg017DVODTXsNU4NNew1Tg017PWYaqjh0H3aajh0h+7TVsNe49RQw17j1FDDXuPUUMNe49RQ'
    'w17j1FDDXo+phhr2+rTVUMOh+7TVcOjGeWo17DVODTXsNU4NNew1Tg017DVODTXsNU4NNez1aauhhkP3aavh0B26p1bDXuPUUMNe'
    '49RQw17j1FDDXuPUUMNe49RQw16PqYYaDt2nrYZDd+g+bTXsNU4NNew1Tg017DVODTXsNU4NNew1Tg017PWYaqhhr09bDTUcuk9b'
    'DYd+vz878AuHDg7doYNDd+jg0B06OHSHDg7doYNDBxw64NDBoTt0cOgOHRy6QweH7tDBofuniGqoYa/HVEMNh+7TVsOhO3RPrYa9'
    'xqmhhr3GqaGGvcapoYa9xqmhhr3GqaGGvR5TDTUcuk9bDTUcuk9bDYdunBpq2GucGmrYa5waathrnBpq2GucGmrYa5waatjr01ZD'
    'DYfu01bDoRvnqdWw1zg11LDXODXUsNc4NdSw1zg11LDXODXUsNenrYYaDt2nrYZDd+ieWg17jVNDDXuNU0MNe41TQw17jVNDDXuN'
    'U0MNez2mGmo4dJ+2Gmo4dJ+2Gg7dODXUsNc4NdSw1zg11LDXODXUsNc4NdSw1zg11LDXp62GGg7dp62GQzfOU6thr3FqqGGvcWqo'
    'Ya9xaqhhr3FqqGGvcWqoYa9PWw01HLpPWw2H7tA9tRr2GqeGGvYap4Ya9hqnhhr2GqeGGvYap4Ya9npMNdRw6D5tNdRw6D5tNRy6'
    'cWqoYa9xaqhhr3FqqGGvcWqoYa9xaqhhr8dUQw17fdpqqOHQfdpqOHTjPLUa9hqnhhr2GqeGGvYap4Ya9hqnhhr2GqeGGvb6tNVQ'
    'w6H7tNVw6A7dU6thr3FqqGGvcWqoYa9xaqhhr3FqqGGvcWqoYa/HVEMNh+7TVkMNh+7TVsOhG6eGGvYap4Ya9hqnhhr2GqeGGvYa'
    'p4Ya9npMNdSw16ethhoO3aethkM3zlOrYa9xaqhhr3FqqGGvcWqoYa9xaqhhr3FqqGGvT1sNNRy6T1sNh+7QPbUa9hqnhhr2GqeG'
    'GvYap4Ya9hqnhhr2GqeGGvZ6TDXUcOg+bTUcukP3aathr3FqqGGvcWqoYa9xaqhhr3FqqGGvcWqoYa/HVEMNe33aaqjh0H3aajh0'
    '4zy1GvYap4Ya9hqnhhr2GqeGGvYap4Ya9hqnhhr2+rTVUMOh+7TVcOgO3VOrYa9xaqhhr3FqqGGvcWqoYa9xaqhhr3FqqGGvx1RD'
    'DYfu01bDoTt0n7Ya9hqnhhr2GqeGGvYap4Ya9hqnhhr2GqeGGvZ6TDXUsBcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    '1nkC/ouyR/TTBygAAAAASUVORK5CYII=';

Uint8List get recordPng => base64Decode(_recordPlanPng);

Future<OutboxEntry> seedPhoto(
  FieldController controller, {
  Map<String, String> fields = const {},
  String? title,
}) => controller.outbox.enqueue(
  kind: OutboxKind.photo,
  bytes: recordPng,
  fields: {
    'title': title ?? '모의 현장 사진',
    'dateKey': '2026-09-14',
    'capturedAt': '2026-09-14T09:30:00+09:00',
    'siteId': 'site-a',
    ...fields,
  },
  siteName: '작성 현장',
);

// 고정 ID를 쓰는 복구 테스트용. 컨트롤러의 첫 outbox.load 전에 호출한다.
Future<OutboxEntry> restorePhoto(
  FieldController controller,
  String id, {
  Map<String, String> fields = const {},
}) async {
  final owner = controller.user!.id;
  final raw = await controller.local.read(owner, outboxStorageKey);
  final rows = raw == null
      ? <dynamic>[]
      : (jsonDecode(raw) as Map)['items'] as List<dynamic>;
  if (!rows.any((row) => row['id'] == id)) {
    final photo = OutboxEntry(
      id: id,
      owner: owner,
      kind: OutboxKind.photo,
      fields: {
        'title': '모의 현장 사진',
        'dateKey': '2026-09-14',
        'capturedAt': '2026-09-14T09:30:00+09:00',
        'siteId': 'site-a',
        'clientOperationId': id,
        ...fields,
      },
      siteName: '작성 현장',
      createdAt: DateTime(2026, 9, 14),
      mock: controller.isMock,
    );
    await controller.local.writeBytes(owner, photo.bytesKey, recordPng);
    rows.add(photo.toJson());
    await controller.local.write(
      owner,
      outboxStorageKey,
      jsonEncode({'schemaVersion': 1, 'items': rows}),
    );
  }
  await controller.outbox.load();
  return controller.outbox.entry(id)!;
}
