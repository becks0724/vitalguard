import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/cctv_probe_screen.dart';
import 'package:vitalguard_field/diag_screen.dart';
import 'package:vitalguard_field/ui/auth/auth_screen.dart';
import 'package:vitalguard_field/ui/cctv/cctv_screen.dart';
import 'package:vitalguard_field/ui/record/capture_ocr.dart';
import 'package:vitalguard_field/ui/record/capture_screen.dart';
import 'package:vitalguard_field/ui/record/record_editor.dart';
import 'package:vitalguard_field/ui/record/record_input.dart';
import 'package:vitalguard_field/ui/record/record_screens.dart';
import 'package:vitalguard_field/ui/shell/field_shell.dart';
import 'package:vitalguard_field/ui/shell/action_dock.dart';
import 'package:vitalguard_field/vg_theme.dart';

import 'support/record_fixture.dart';

import 'support/alerts_fixture.dart';

// 기존 392개 기준선에 더하는 C-01/C-02/C-04 회귀 검증.
// 기기 안전 높이에서 26.5%가 추가로 사라지도록 시스템 하단 inset도 포함한다.
const _top = 24.0;
const _bottom = 24.0;
const _size = Size(1385, 866);

double _imeHeight(Size size) => _bottom + (size.height - _top - _bottom) * .265;

Future<void> _mount(
  WidgetTester tester,
  Widget home, {
  Size size = _size,
  double scale = 1,
  Finder? readyAfterDecode,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  tester.view.viewPadding = const FakeViewPadding(top: _top, bottom: _bottom);
  tester.view.padding = const FakeViewPadding(top: _top, bottom: _bottom);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetViewPadding);
  addTearDown(tester.view.resetPadding);
  addTearDown(tester.view.resetViewInsets);
  addTearDown(() => tester.pumpWidget(const SizedBox.shrink()));
  await tester.pumpWidget(
    MaterialApp(
      theme: vgLightTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: home,
    ),
  );
  if (readyAfterDecode != null) {
    // 엔진 이미지 디코딩은 실제 비동기 작업이다. 로딩 표시가 도는 동안
    // 가짜 시간만 진행하는 pumpAndSettle에 먼저 들어가면 끝나지 않는다.
    for (var i = 0; i < 100 && readyAfterDecode.evaluate().isEmpty; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 10)),
      );
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(readyAfterDecode, findsOneWidget);
  }
  // 디코딩 뒤에도 프레임이 계속 예약된다면 기존처럼 실패해야 한다.
  await tester.pumpAndSettle();
}

Future<void> _keyboard(WidgetTester tester, Size size, bool open) async {
  tester.view.viewInsets = FakeViewPadding(bottom: open ? _imeHeight(size) : 0);
  tester.view.padding = FakeViewPadding(top: _top, bottom: open ? 0 : _bottom);
  await tester.pumpAndSettle();
}

Future<void> _reveal(
  WidgetTester tester,
  Finder target,
  Finder container, {
  double delta = 160,
}) async {
  await tester.scrollUntilVisible(
    target,
    delta,
    maxScrolls: 100,
    scrollable: find
        .descendant(of: container, matching: find.byType(Scrollable))
        .first,
  );
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
}

void _aboveKeyboard(WidgetTester tester, Finder target, Size size) {
  final rect = tester.getRect(target);
  expect(rect.top, greaterThanOrEqualTo(_top));
  expect(rect.bottom, lessThanOrEqualTo(size.height - _imeHeight(size) + .01));
  expect(target.hitTestable(), findsOneWidget);
}

void _uncompressed(WidgetTester tester, Finder text) {
  final paragraph = tester.renderObject<RenderParagraph>(text);
  expect(paragraph.textScaler.scale(14), 42);
  expect(paragraph.didExceedMaxLines, isFalse);
  expect(paragraph.maxLines, isNull);
  expect(paragraph.softWrap, isTrue);
  expect(
    find.ancestor(of: text, matching: find.byType(FittedBox)),
    findsNothing,
  );
}

Future<AlertFieldFixture> _field() async {
  final field = AlertFieldFixture(AlertGatewayFixture(), AlertStoreFixture());
  await field.signIn('demo', 'mock');
  addTearDown(field.dispose);
  return field;
}

Future<void> _tab(WidgetTester tester, int index) async {
  final target = find.byKey(Key('rail-destination-$index'));
  await tester.ensureVisible(target);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('C-01 대응 확인은 오프라인에서 차단하고 사진·주석·메모·음성은 기기에 보관한다', (tester) async {
    final field = await _field();
    await _mount(tester, FieldShell(controller: field));
    field.setOffline(true);
    await _tab(tester, 1);
    String receipt() =>
        tester.widget<Text>(find.byKey(const Key('shell-receipt'))).data!;
    expect(receipt(), contains('서버에 연결할 수 없습니다'));
    expect(receipt(), contains('대응 확인은 연결 후 가능하며 예약되지 않습니다'));
    expect(receipt(), contains('60초마다 조회를 재시도'));
    expect(receipt(), isNot(contains('전송 대기열')));
    await expectLater(field.ackAlert('a1'), throwsA(isA<ApiFailure>()));
    expect(
      (field.gateway as AlertGatewayFixture).calls.where(
        (c) => c.startsWith('POST'),
      ),
      isEmpty,
    );

    await _tab(tester, 2);
    expect(find.text('오프라인 · 촬영한 사진과 주석·메모·음성은 기기에 보관합니다.'), findsOneWidget);
    await _tab(tester, 3);
    expect(receipt(), contains('결과 불명 항목은 서버 반영 여부부터'));
    await _tab(tester, 4);
    expect(receipt(), contains('설정은 기기에 저장할 수 있습니다'));
    expect(tester.takeException(), isNull);
  });

  for (final scale in [1.0, 3.0]) {
    testWidgets('C-01 배너 전환·스크롤은 본문·L-07 좌표를 바꾸거나 가리지 않는다 ×$scale', (
      tester,
    ) async {
      final field = await _field();
      await _mount(
        tester,
        FieldShell(controller: field),
        size: const Size(600, 900),
        scale: scale,
      );
      for (final destination in [0, 1, 2, 3, 4]) {
        field.setOffline(false);
        await _tab(tester, destination);
        final content = tester.getRect(find.byKey(const Key('shell-content')));
        final strip = tester.getRect(
          find.byKey(const Key('global-alert-slot')),
        );
        final banner = tester.getRect(
          find.byKey(const Key('shell-receipt-slot')),
        );
        field.setOffline(true);
        await tester.pumpAndSettle();
        expect(tester.getRect(find.byKey(const Key('shell-content'))), content);
        expect(
          tester.getRect(find.byKey(const Key('global-alert-slot'))),
          strip,
        );
        expect(
          tester.getRect(find.byKey(const Key('shell-receipt-slot'))),
          banner,
        );
        expect(banner.overlaps(content), isFalse);
        expect(banner.overlaps(strip), isFalse);
        expect(content.overlaps(strip), isFalse);
        final scroll = find
            .descendant(
              of: find.byKey(const Key('shell-receipt-scroll')),
              matching: find.byType(Scrollable),
            )
            .first;
        final position = tester.state<ScrollableState>(scroll).position;
        expect(position.maxScrollExtent, greaterThan(0));
        position.jumpTo(position.maxScrollExtent);
        await tester.pump();
        expect(tester.getRect(find.byKey(const Key('shell-content'))), content);
        expect(
          tester.getRect(find.byKey(const Key('shell-receipt'))).bottom,
          lessThanOrEqualTo(banner.bottom),
        );
        if (scale == 3) {
          _uncompressed(tester, find.byKey(const Key('shell-receipt')));
        }
        expect(tester.takeException(), isNull);
      }
    });
  }

  for (final totp in [false, true]) {
    for (final scale in [1.0, 3.0]) {
      testWidgets(
        'C-02/C-04 ${totp ? '2단계 인증' : '로그인'} IME 26.5%·입력 보존 ×$scale',
        (tester) async {
          final field = FieldCoordinator(
            MockGateway(),
            MemoryStore(),
            MockSpeechInput(),
          );
          addTearDown(field.dispose);
          if (totp) {
            await field.signIn('totp', 'mock');
          } else {
            await field.cancelSignIn();
          }
          const size = Size(600, 900);
          await _mount(
            tester,
            AuthScreen(controller: field),
            size: size,
            scale: scale,
          );
          final form = find.byKey(const Key('auth-scroll'));
          final inputs = totp
              ? {'totp-code': '123456'}
              : {'login-id': 'demo', 'login-password': 'mock'};
          final controllers = <String, TextEditingController>{};
          for (final input in inputs.entries) {
            final target = find.byKey(Key(input.key));
            await _reveal(tester, target, form);
            await tester.enterText(target, input.value);
            controllers[input.key] = tester
                .widget<TextField>(target)
                .controller!;
            await _keyboard(tester, size, true);
            await _reveal(tester, target, form);
            _aboveKeyboard(tester, target, size);
          }
          final submit = find.byKey(const Key('auth-submit'));
          await _reveal(tester, submit, form);
          _aboveKeyboard(tester, submit, size);
          if (scale == 3) {
            _uncompressed(tester, find.text(totp ? '인증번호 확인' : '로그인'));
          }
          await _keyboard(tester, size, false);
          await _keyboard(tester, size, true);
          for (final input in inputs.entries) {
            final controller = tester
                .widget<TextField>(find.byKey(Key(input.key)))
                .controller!;
            expect(controller, same(controllers[input.key]));
            expect(controller.text, input.value);
          }
          await _reveal(tester, submit, form);
          await tester.tap(submit);
          await tester.pumpAndSettle();
          expect(field.authStage, AuthStage.ready);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  for (final scale in [1.0, 3.0]) {
    testWidgets('C-02/C-04 셸 내부 댓글·STT 수정·확인·저장 IME 26.5%와 초안 유지 ×$scale', (
      tester,
    ) async {
      final field = await _field();
      const size = Size(866, 1385);
      await _mount(
        tester,
        FieldShell(controller: field),
        size: size,
        scale: scale,
      );
      await _tab(tester, 2);
      final media = fromOutbox(await seedPhoto(field));
      Navigator.of(tester.element(find.byType(RecordHome))).push(
        MaterialPageRoute<void>(
          builder: (_) => RecordInput(controller: field, media: media),
        ),
      );
      await tester.pumpAndSettle();
      final form = find.byKey(const Key('record-input-scroll'));
      final note = find.byKey(const Key('record-note'));
      await _reveal(tester, note, form);
      await tester.enterText(note, '연결부 점검 중 작성하던 댓글');
      final noteController = tester.widget<TextField>(note).controller!;
      await _keyboard(tester, size, true);
      await _reveal(tester, note, form);
      _aboveKeyboard(tester, note, size);
      await _reveal(tester, find.byKey(const Key('speech-start')), form);
      await tester.tap(find.byKey(const Key('speech-start')));
      await tester.pumpAndSettle();
      await _reveal(tester, find.byKey(const Key('speech-candidate-0')), form);
      await tester.tap(find.byKey(const Key('speech-candidate-0')));
      await tester.pumpAndSettle();
      final speech = find.byKey(const Key('record-speech-text'));
      await _reveal(tester, speech, form);
      await tester.enterText(speech, '직접 수정한 음성 인식 문장');
      final speechController = tester.widget<TextField>(speech).controller!;
      await _reveal(tester, speech, form);
      _aboveKeyboard(tester, speech, size);
      await _keyboard(tester, size, false);
      await _keyboard(tester, size, true);
      expect(noteController.text, '연결부 점검 중 작성하던 댓글');
      expect(speechController.text, '직접 수정한 음성 인식 문장');
      // 키보드 변경은 화면 이탈/복구가 아니다. 동일 State와 컨트롤러를 유지한다.
      await _reveal(tester, note, form, delta: -160);
      expect(tester.widget<TextField>(note).controller, same(noteController));
      await _reveal(tester, speech, form);
      expect(
        tester.widget<TextField>(speech).controller,
        same(speechController),
      );
      field.setOffline(true);
      final confirm = find.byKey(const Key('confirm-record'));
      await _reveal(tester, confirm, form);
      _aboveKeyboard(tester, confirm, size);
      await tester.tap(confirm);
      await tester.pump();
      final save = find.byKey(const Key('save-record'));
      await _reveal(tester, save, form);
      _aboveKeyboard(tester, save, size);
      if (scale == 3) _uncompressed(tester, find.text('메모 저장'));
      await tester.tap(save);
      await tester.pumpAndSettle();
      final memo = field.outbox.dependents(media.id).single;
      expect(memo.kind, OutboxKind.text);
      expect(memo.phase, OutboxPhase.waiting);
      expect(
        utf8.decode((await field.local.readBytes('demo', memo.bytesKey))!),
        '연결부 점검 중 작성하던 댓글\n직접 수정한 음성 인식 문장',
      );
      expect(
        await field.local.read('demo', 'comment-draft:${media.id}:new'),
        isNull,
      );
      expect(noteController.text, isEmpty);
      expect(speechController.text, isEmpty);
      await _reveal(tester, note, form, delta: -160);
      await tester.enterText(note, '저장 후 새 초안');
      // C-06: 저장된 메모와 별개로, 저장하지 않은 새 초안은 Back 뒤 복원한다.
      await _keyboard(tester, size, false);
      await tester.tap(find.byTooltip('초안 보존 후 뒤로'));
      await tester.pumpAndSettle();
      Navigator.of(tester.element(find.byType(RecordHome))).push(
        MaterialPageRoute<void>(
          builder: (_) => RecordInput(controller: field, media: media),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(note).controller!.text, '저장 후 새 초안');
      expect(tester.takeException(), isNull);
    });
  }

  for (final size in [const Size(1385, 866), const Size(600, 900)]) {
    testWidgets('C-04 셸 전 목적지·보낼 기록·레일 글자 3배 $size', (tester) async {
      final field = await _field();
      await seedPhoto(field);
      await _mount(tester, FieldShell(controller: field), size: size, scale: 3);
      for (final destination in [0, 1, 2, 3, 4]) {
        await _tab(tester, destination);
        _uncompressed(tester, find.byKey(const Key('shell-receipt')));
        expect(tester.takeException(), isNull);
      }
      await _tab(tester, 2);
      final pane = find.byKey(const Key('record-pending-list'));
      final title = find.text('모의 현장 사진');
      await _reveal(tester, title, pane);
      _uncompressed(tester, title);
      expect(find.byType(GridView), findsNothing);
      final capture = find.byKey(const Key('photo-capture'));
      await tester.ensureVisible(capture);
      expect(capture.hitTestable(), findsOneWidget);
      _uncompressed(tester, find.text('사진 촬영'));
      if (size.width >= vgTwoPaneMinWidth) {
        final item = find.byKey(const Key('rail-destination-3'));
        await tester.ensureVisible(item);
        final label = find.descendant(of: item, matching: find.text('전송 상태'));
        _uncompressed(tester, label);
        expect(
          tester.getRect(label).height,
          lessThanOrEqualTo(tester.getRect(item).height),
        );
      }
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('C-04 L-07 긴 경보·작업자 이름은 3배 그대로 스크롤된다', (tester) async {
    final field = await _field();
    final gateway = field.gateway as AlertGatewayFixture;
    gateway.rows = [
      {...alertRow(type: 'absence'), 'worker_name': '매우 긴 현장 작업자 이름 ' * 8},
    ];
    await _mount(
      tester,
      FieldShell(controller: field),
      size: const Size(600, 900),
      scale: 3,
    );
    final content = tester.getRect(find.byKey(const Key('shell-content')));
    final scroll = find.byKey(const Key('global-alert-text-scroll'));
    final text = find.descendant(
      of: scroll,
      matching: find.textContaining('매우 긴 현장 작업자'),
    );
    _uncompressed(tester, text);
    final position = tester
        .state<ScrollableState>(
          find.descendant(of: scroll, matching: find.byType(Scrollable)).first,
        )
        .position;
    expect(position.maxScrollExtent, greaterThan(0));
    position.jumpTo(position.maxScrollExtent);
    await tester.pump();
    expect(
      tester.getRect(text).bottom,
      lessThanOrEqualTo(tester.getRect(scroll).bottom + .01),
    );
    expect(tester.getRect(find.byKey(const Key('shell-content'))), content);
    expect(tester.takeException(), isNull);
  });

  testWidgets('C-04 로컬 사진 상세 긴 제목·음성·하단 작업을 3배로 읽고 스크롤한다', (tester) async {
    final field = await _field();
    final photo = await seedPhoto(field, title: '매우 긴 현장 점검 사진 제목 ' * 6);
    await field.outbox.enqueue(
      kind: OutboxKind.voice,
      bytes: recordPng,
      fields: {'audioMs': '123456'},
      siteName: photo.siteName,
      dependsOn: photo.id,
    );
    await _mount(
      tester,
      PhotoDetail(controller: field, photoId: photo.id),
      size: const Size(480, 900),
      scale: 3,
    );
    final title = find.text(photo.fields['title']!);
    _uncompressed(tester, title);
    final titleScroll = find
        .ancestor(of: title, matching: find.byType(Scrollable))
        .first;
    expect(
      tester.state<ScrollableState>(titleScroll).position.maxScrollExtent,
      greaterThan(0),
    );
    final voice = find.text('음성 · 2:03');
    await _reveal(tester, voice, find.byType(ListView));
    _uncompressed(tester, voice);
    final comment = find.text('메모·음성 붙이기');
    await tester.ensureVisible(comment);
    expect(comment.hitTestable(), findsOneWidget);
    _uncompressed(tester, comment);
    expect(tester.takeException(), isNull);
  });

  testWidgets('C-04 주석 편집기 3배에서 도구·저장을 스크롤하고 캔버스를 남긴다', (tester) async {
    final field = await _field();
    final media = fromOutbox(await seedPhoto(field));
    final canvas = find.byKey(const Key('ink-canvas'));
    await _mount(
      tester,
      RecordEditor(controller: field, original: media),
      size: const Size(600, 900),
      scale: 3,
      readyAfterDecode: canvas,
    );
    expect(canvas, findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(tester.getSize(canvas).height, greaterThanOrEqualTo(vgTapMin));
    expect(canvas.hitTestable(), findsOneWidget);
    final before = tester.getRect(canvas);
    final dock = find.byType(ActionDock);
    final scroll = find.descendant(of: dock, matching: find.byType(Scrollable));
    // 텍스트 칩을 아이콘으로 바꾼 뒤로는 글자 3배에서도 도크가 다 들어가 스크롤이 필요 없다.
    // V-5 가 요구하는 것은 스크롤 자체가 아니라 압축 없이 전부 닿는 것이므로 아래에서 확인한다.
    expect(before.overlaps(tester.getRect(dock)), isFalse);
    for (final key in ['editor-tool-pen', 'editor-original-only']) {
      final button = find.byKey(Key(key));
      await _reveal(tester, button, dock);
      expect(tester.widget<IconButton>(button).onPressed, isNotNull);
      expect(button.hitTestable(), findsOneWidget);
      final viewport = tester.getRect(scroll).inflate(.01);
      final bounds = tester.getRect(button);
      expect(viewport.contains(bounds.topLeft), isTrue);
      expect(viewport.contains(bounds.bottomRight), isTrue);
      expect(bounds.width, greaterThanOrEqualTo(vgTapMin));
      expect(bounds.height, greaterThanOrEqualTo(vgTapMin));
      expect(tester.getRect(canvas), before);
    }
    for (final label in ['주석 저장']) {
      final target = find.text(label);
      final button = find.ancestor(
        of: target,
        matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
      );
      await _reveal(tester, button, dock);
      // 아무 작업도 하지 않은 편집기에서는 저장 사유를 안내하며 비활성이다.
      expect(tester.widget<ButtonStyleButton>(button).onPressed, isNull);
      expect(button.hitTestable(), findsOneWidget);
      final viewport = tester.getRect(scroll).inflate(.01);
      final bounds = tester.getRect(button);
      expect(viewport.contains(bounds.topLeft), isTrue);
      expect(viewport.contains(bounds.bottomRight), isTrue);
      expect(target.hitTestable(), findsOneWidget);
      _uncompressed(tester, target);
      expect(tester.getRect(canvas), before);
    }
    // 로딩 종료 후에는 글자 3배에서도 배치가 수렴하고 새 프레임이 남지 않는다.
    await tester.pump(const Duration(seconds: 1));
    expect(tester.binding.hasScheduledFrame, isFalse);
    expect(tester.getRect(canvas), before);
    expect(tester.takeException(), isNull);
  });

  for (final fail in [false, true]) {
    testWidgets('C-04 촬영 ${fail ? '실패 안내' : '촬영 버튼'} 3배에서 압축 없이 접근한다', (
      tester,
    ) async {
      await _mount(
        tester,
        CameraCaptureScreen(camera: _Camera(fail)),
        size: const Size(480, 700),
        scale: 3,
      );
      final title = find.text('사진 촬영');
      _uncompressed(tester, title);
      if (fail) {
        final retry = find.text('다시 시도');
        final scroll = find
            .ancestor(of: retry, matching: find.byType(SingleChildScrollView))
            .first;
        await _reveal(tester, retry, scroll);
        expect(retry.hitTestable(), findsOneWidget);
        _uncompressed(tester, find.byKey(const Key('camera-error')));
      } else {
        final shutter = find.byKey(const Key('take-picture'));
        expect(shutter.hitTestable(), findsOneWidget);
        _uncompressed(tester, find.text('촬영'));
        expect(
          tester.getRect(find.text('촬영')).height,
          lessThanOrEqualTo(tester.getRect(shutter).height),
        );
      }
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('C-04 CCTV 안내와 갱신 간격은 3배에서 스크롤로 접근한다', (tester) async {
    final field = await _field();
    // 읽기 전 상태의 실제 UI. 소켓/영상 요청은 이 레이아웃 테스트에서 열지 않는다.
    await _mount(
      tester,
      Scaffold(body: CctvScreen(controller: field, active: false)),
      size: const Size(600, 900),
      scale: 3,
    );
    for (final label in ['3초', '5초', '10초', '첫 영상을 불러오는 중입니다']) {
      final text = find.text(label);
      await _reveal(tester, text, find.byType(ListView));
      _uncompressed(tester, text);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('C-02 진단 입력은 IME 26.5% 왕복에 초안과 입력 포커스를 유지한다', (tester) async {
    await _mount(tester, const DiagScreen());
    final field = find.byType(TextField);
    final panel = find.byType(ListView);
    await _reveal(tester, field, panel);
    await tester.enterText(field, '키보드 측정 중 작성한 내용');
    final editable = tester.widget<EditableText>(find.byType(EditableText));
    await _keyboard(tester, _size, true);
    await _reveal(tester, field, panel);
    _aboveKeyboard(tester, field, _size);
    expect(editable.focusNode.hasFocus, isTrue);
    final close = find.text('키보드 내리기');
    await _reveal(tester, close, panel);
    _aboveKeyboard(tester, close, _size);
    await _keyboard(tester, _size, false);
    await _keyboard(tester, _size, true);
    expect(editable.controller.text, '키보드 측정 중 작성한 내용');
    expect(editable.focusNode.hasFocus, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('C-02 CCTV 측정 URL·티켓과 시작 버튼은 IME 26.5%에서 접근한다', (tester) async {
    await _mount(tester, const CctvProbeScreen());
    final form = find.byType(ListView);
    final controllers = <String, TextEditingController>{};
    final values = {
      'URL (전체 주소)': 'https://example.invalid/frame',
      '티켓 (선택)': 'synthetic-ticket',
    };
    Finder input(String label) => find.widgetWithText(TextField, label);
    // 입력칸은 두 개지만 기본 finder는 ListView의 화면 밖 칸을 제외한다.
    // 현재 찾아지는 TextField의 순번은 입력칸의 식별자가 아니다.
    for (final entry in values.entries) {
      final field = input(entry.key);
      await _reveal(tester, field, form);
      expect(field, findsOneWidget);
      await tester.enterText(field, entry.value);
      controllers[entry.key] = tester.widget<TextField>(field).controller!;
      await _keyboard(tester, _size, true);
      await _reveal(tester, field, form);
      _aboveKeyboard(tester, field, _size);
    }
    final start = find.widgetWithText(FilledButton, '시작');
    await _reveal(tester, start, form);
    _aboveKeyboard(tester, start, _size);
    await _keyboard(tester, _size, false);
    await _keyboard(tester, _size, true);
    expect(controllers.length, 2);
    expect(controllers.values.first, isNot(same(controllers.values.last)));
    for (final entry in values.entries.toList().reversed) {
      final field = input(entry.key);
      await _reveal(tester, field, form, delta: -160);
      _aboveKeyboard(tester, field, _size);
      expect(controllers[entry.key]!.text, entry.value);
      expect(
        tester.widget<TextField>(field).controller,
        same(controllers[entry.key]),
      );
    }
    // 시작 버튼도 실제로 누른다. 주소 형식 오류로 통신 없이 실행 여부를 확인한다.
    await tester.enterText(input('URL (전체 주소)'), 'example.invalid/frame');
    await _reveal(tester, start, form);
    _aboveKeyboard(tester, start, _size);
    await tester.tap(start);
    await tester.pumpAndSettle();
    final validation = find.text('마지막 오류: 전체 HTTP 또는 HTTPS 주소를 입력하세요.');
    await _reveal(tester, validation, form);
    _aboveKeyboard(tester, validation, _size);
    expect(tester.takeException(), isNull);
  });
}

class _Camera implements CaptureCamera {
  _Camera(this.fail);
  final bool fail;
  @override
  Future<void> initialize() async {
    if (fail) throw CaptureFailure('카메라를 열지 못했습니다. 장치 상태를 확인해 주세요. ' * 8);
  }

  @override
  Widget preview() => const ColoredBox(color: Colors.black);
  @override
  Future<String> takePicture() async => 'unused-test-photo';
  @override
  Future<void> dispose() async {}
}
