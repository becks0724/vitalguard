import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/contracts/field_contracts.dart';
import 'package:vitalguard_field/data/field_coordinator.dart';
import 'package:vitalguard_field/data/live/live_gateway.dart';
import 'package:vitalguard_field/data/mock/memory_store.dart';
import 'package:vitalguard_field/data/mock/mock_gateway.dart';
import 'package:vitalguard_field/ui/auth/auth_screen.dart';
import 'package:vitalguard_field/vg_theme.dart';

const _channel = MethodChannel('vitalguard/network');
const _offlineTitle = '인터넷에 연결되어 있지 않습니다';
const _serverTitle = '서버에 연결할 수 없습니다';
const _offlineBody =
    '기기의 Wi-Fi 가 꺼져 있거나 연결이 끊겼습니다. Wi-Fi 를 켜고 연결한 뒤 다시 로그인해 주세요.';
const _serverBody =
    '인터넷은 연결되어 있습니다. 서버가 응답하지 않으니 잠시 후 다시 시도해 주세요. 계속되면 관리자에게 문의해 주세요.';
const _unknownBody = '인터넷 연결을 확인한 뒤 다시 로그인해 주세요. 계속되면 관리자에게 문의해 주세요.';

FieldCoordinator _controller(JsonTransport transport) {
  final gateway = LiveGateway(transport: transport);
  final controller = FieldCoordinator(
    gateway,
    MemoryStore(),
    MockSpeechInput(),
  );
  addTearDown(() => gateway.client.close(force: true));
  addTearDown(controller.dispose);
  return controller;
}

Future<void> _mount(
  WidgetTester tester,
  FieldCoordinator controller, {
  double scale = 1,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(600, scale == 3 ? 600 : 900);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(() => tester.pumpWidget(const SizedBox.shrink()));
  await controller.initialize();
  await tester.pumpWidget(
    MaterialApp(
      theme: vgLightTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: AnimatedBuilder(
        animation: controller,
        builder: (_, _) => AuthScreen(controller: controller),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _submit(WidgetTester tester) async {
  for (final (key, value) in [
    ('login-id', 'field-operator'),
    ('login-password', 'synthetic-password'),
  ]) {
    final input = find.byKey(Key(key));
    await tester.ensureVisible(input);
    await tester.pumpAndSettle();
    await tester.enterText(input, value);
  }
  tester.testTextInput.hide();
  final submit = find.byKey(const Key('auth-submit'));
  await tester.ensureVisible(submit);
  await tester.pumpAndSettle();
  await tester.tap(submit);
  await tester.pumpAndSettle();
}

Finder _dialogText(String text) =>
    find.descendant(of: find.byType(AlertDialog), matching: find.text(text));

Future<void> _confirm(WidgetTester tester) async {
  await tester.tap(_dialogText('확인'));
  await tester.pumpAndSettle();
  expect(find.byType(AlertDialog), findsNothing);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(_channel, null));

  for (final readOnly in [false, true]) {
    test(
      '게이트웨이 ${readOnly ? '조회' : '로그인'}의 반복 연결 실패는 네이티브 채널을 호출하지 않는다',
      () async {
        var probes = 0;
        messenger.setMockMethodCallHandler(_channel, (_) async {
          probes++;
          return false;
        });
        final gateway = LiveGateway(
          transport: (_, _, _, _) async =>
              throw const SocketException('synthetic'),
        );
        addTearDown(() => gateway.client.close(force: true));

        for (var attempt = 0; attempt < 2; attempt++) {
          await expectLater(
            readOnly
                ? gateway.me('synthetic-access-token')
                : gateway.login('field-operator', 'synthetic-password'),
            throwsA(
              isA<ApiFailure>()
                  .having((e) => e.message, 'message', _serverTitle)
                  .having(
                    (e) => e.networkUnreachable,
                    'networkUnreachable',
                    isTrue,
                  )
                  .having((e) => e.uncertainWrite, 'uncertainWrite', !readOnly),
            ),
          );
        }
        expect(probes, 0);
      },
    );
  }

  for (final online in [false, true]) {
    for (final scale in [1.0, 3.0]) {
      testWidgets(
        '${online ? '인터넷 있음 연결 실패는 서버' : '인터넷 없음 로그인 실패는 Wi-Fi'} 안내·56dp 확인·입력 보존 ×$scale',
        (tester) async {
          final calls = <MethodCall>[];
          messenger.setMockMethodCallHandler(_channel, (call) async {
            calls.add(call);
            return online;
          });
          final controller = _controller(
            (_, _, _, _) async => throw const SocketException('synthetic'),
          );
          await _mount(tester, controller, scale: scale);
          final idController = tester
              .widget<TextField>(find.byKey(const Key('login-id')))
              .controller!;
          await _submit(tester);

          final title = online ? _serverTitle : _offlineTitle;
          final body = online ? _serverBody : _offlineBody;
          final dialog = find.byType(AlertDialog);
          expect(dialog, findsOneWidget);
          expect(_dialogText(title), findsOneWidget);
          expect(_dialogText(body), findsOneWidget);
          expect(
            _dialogText(online ? _offlineBody : _serverBody),
            findsNothing,
          );
          expect(calls.map((call) => call.method), ['hasInternet']);
          expect(calls.single.arguments, isNull);
          expect(controller.loginFailure?.networkUnreachable, isTrue);
          expect(controller.loginFailure?.message, _serverTitle);
          expect(controller.loginFailure?.uncertainWrite, isTrue);
          final buttons = find.descendant(
            of: dialog,
            matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
          );
          expect(buttons, findsOneWidget);
          expect(tester.getSize(buttons).height, greaterThanOrEqualTo(56));
          expect(buttons.hitTestable(), findsOneWidget);

          for (final text in [title, body, '확인']) {
            final finder = _dialogText(text);
            final paragraph = tester.renderObject<RenderParagraph>(finder);
            expect(paragraph.textScaler.scale(14), 14 * scale);
            expect(paragraph.maxLines, isNull);
            expect(paragraph.didExceedMaxLines, isFalse);
            expect(paragraph.softWrap, isTrue);
            expect(
              find.ancestor(of: finder, matching: find.byType(FittedBox)),
              findsNothing,
            );
          }
          if (scale == 3) {
            final scrollable = find
                .descendant(of: dialog, matching: find.byType(Scrollable))
                .first;
            final position = tester.state<ScrollableState>(scrollable).position;
            expect(position.maxScrollExtent, greaterThan(0));
            await tester.drag(scrollable, const Offset(0, -2000));
            await tester.pumpAndSettle();
            expect(position.pixels, closeTo(position.maxScrollExtent, .01));
          }
          expect(tester.takeException(), isNull);
          await _confirm(tester);
          expect(
            tester
                .widget<TextField>(find.byKey(const Key('login-id')))
                .controller,
            same(idController),
          );
          expect(idController.text, 'field-operator');
          expect(
            tester
                .widget<TextField>(find.byKey(const Key('login-password')))
                .controller!
                .text,
            isEmpty,
          );
          expect(
            tester.widget<Text>(find.byKey(const Key('auth-message'))).data,
            _serverTitle,
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  for (final result in [
    'MissingPluginException',
    'PlatformException',
    'null',
  ]) {
    testWidgets('$result 처리 시 연결 여부를 단정하지 않고 확인으로 닫힌다', (tester) async {
      var probes = 0;
      messenger.setMockMethodCallHandler(_channel, (_) async {
        probes++;
        if (result == 'MissingPluginException') {
          throw MissingPluginException();
        }
        if (result == 'PlatformException') {
          throw PlatformException(code: 'network_state_error');
        }
        return null;
      });
      final controller = _controller(
        (_, _, _, _) async => throw const SocketException('synthetic'),
      );
      await _mount(tester, controller);
      await _submit(tester);
      expect(probes, 1);
      expect(controller.loginFailure?.networkUnreachable, isTrue);
      expect(controller.message, _serverTitle);
      expect(_dialogText(_serverTitle), findsOneWidget);
      expect(_dialogText(_unknownBody), findsOneWidget);
      expect(_dialogText(_offlineBody), findsNothing);
      expect(_dialogText(_serverBody), findsNothing);
      await _confirm(tester);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('401은 이전 연결 실패 팝업을 다시 띄우지 않고 인증 오류만 남긴다', (tester) async {
    var probes = 0;
    messenger.setMockMethodCallHandler(_channel, (_) async {
      probes++;
      return false;
    });
    var attempts = 0;
    final controller = _controller((_, _, _, _) async {
      if (attempts++ == 0) throw const SocketException('synthetic');
      return const ApiReply(401, {'ok': false, 'error': 'invalid_credentials'});
    });
    await _mount(tester, controller);
    await _submit(tester);
    await _confirm(tester);
    await _submit(tester);
    expect(probes, 1);
    expect(controller.loginFailure?.status, 401);
    expect(controller.loginFailure?.networkUnreachable, isFalse);
    expect(controller.message, '아이디 또는 비밀번호가 올바르지 않습니다');
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.takeException(), isNull);
  });

  for (final (failure, message) in [
    (TimeoutException('synthetic'), '서버 응답을 기다리는 시간이 지났습니다'),
    (const HttpException('synthetic'), '응답 수신이 중단됐습니다'),
  ]) {
    testWidgets('${failure.runtimeType}은 기존 인라인 오류만 표시하고 연결 채널을 호출하지 않는다', (
      tester,
    ) async {
      var probes = 0;
      messenger.setMockMethodCallHandler(_channel, (_) async {
        probes++;
        return false;
      });
      final controller = _controller((_, _, _, _) async => throw failure);
      await _mount(tester, controller);
      await _submit(tester);
      expect(probes, 0);
      expect(controller.loginFailure?.networkUnreachable, isFalse);
      expect(controller.message, message);
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('연결 확인 중 재시도한 401에는 이전 연결 안내를 띄우지 않는다', (tester) async {
    final pending = Completer<bool>();
    var probes = 0;
    messenger.setMockMethodCallHandler(_channel, (_) {
      probes++;
      return pending.future;
    });
    var attempts = 0;
    final controller = _controller((_, _, _, _) async {
      if (attempts++ == 0) throw const SocketException('synthetic');
      return const ApiReply(401, {'ok': false, 'error': 'invalid_credentials'});
    });
    await _mount(tester, controller);
    await _submit(tester);
    expect(controller.busy, isFalse);
    expect(controller.loginFailure?.networkUnreachable, isTrue);
    await _submit(tester);
    expect(probes, 1);
    expect(controller.loginFailure?.status, 401);
    pending.complete(false);
    await tester.pumpAndSettle();
    expect(controller.message, '아이디 또는 비밀번호가 올바르지 않습니다');
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('연결 확인 중 로그인 화면을 닫아도 늦은 결과가 팝업을 띄우지 않는다', (tester) async {
    final pending = Completer<bool>();
    messenger.setMockMethodCallHandler(_channel, (_) => pending.future);
    final controller = _controller(
      (_, _, _, _) async => throw const SocketException('synthetic'),
    );
    await _mount(tester, controller);
    await _submit(tester);
    expect(controller.busy, isFalse);
    expect(controller.loginFailure?.networkUnreachable, isTrue);
    await tester.pumpWidget(const SizedBox.shrink());
    pending.complete(false);
    await tester.pumpAndSettle();
    expect(controller.busy, isFalse);
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
