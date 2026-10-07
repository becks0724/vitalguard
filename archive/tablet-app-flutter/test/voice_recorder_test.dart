import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vitalguard_field/data/live/device_voice_recorder.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = DeviceVoiceRecorder.channel;
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final metadata = {
    'path': '/cache/voice-one.m4a',
    'durationMs': 7000,
    'byteLength': 100,
    'reason': 'manual',
  };

  test('C-05 초안 식별자를 네이티브에 보내고 새 녹음기에서 원본을 복구한다', () async {
    final calls = <MethodCall>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return call.method == 'recover' ? metadata : null;
    });
    final first = DeviceVoiceRecorder();
    await first.startDraft('["account-a","photo-1"]');
    await first.close();
    final resumed = DeviceVoiceRecorder();
    final clip = await resumed.recoverDraft('["account-a","photo-1"]');
    expect(clip!.path, metadata['path']);
    expect(calls.first.arguments, {'draftKey': '["account-a","photo-1"]'});
    expect(calls.last.method, 'recover');
    expect(calls.last.arguments, calls.first.arguments);
    await resumed.close();
    messenger.setMockMethodCallHandler(channel, null);
  });

  test('네이티브 start/stop/play/stopPlay/cancel 계약과 파일 메타데이터를 전달한다', () async {
    final calls = <MethodCall>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return call.method == 'stop' ? metadata : null;
    });
    final recorder = DeviceVoiceRecorder();
    addTearDown(() async {
      await recorder.close();
      messenger.setMockMethodCallHandler(channel, null);
    });
    await recorder.start();
    final stopped = (await recorder.stop())!;
    expect(stopped.path, metadata['path']);
    expect(stopped.durationMs, 7000);
    expect(stopped.byteLength, 100);
    final audio = Uint8List.fromList([1, 2, 3]);
    await recorder.play(audio);
    await recorder.stopPlay();
    await recorder.cancel(path: stopped.path);
    expect(calls.map((c) => c.method), [
      'start',
      'stop',
      'play',
      'stopPlay',
      'cancel',
    ]);
    expect(calls[2].arguments['audio'], audio);
    expect(calls.last.arguments['path'], stopped.path);
  });

  test('3분·백그라운드 자동 정지 및 재생 종료 콜백을 Flutter로 전달한다', () async {
    messenger.setMockMethodCallHandler(channel, (_) async => null);
    final recorder = DeviceVoiceRecorder();
    final events = <Map<String, dynamic>>[];
    final subscription = recorder.events.listen(events.add);
    addTearDown(() async {
      await subscription.cancel();
      await recorder.close();
      messenger.setMockMethodCallHandler(channel, null);
    });
    for (final reason in ['maxDuration', 'background']) {
      await messenger.handlePlatformMessage(
        channel.name,
        channel.codec.encodeMethodCall(
          MethodCall('stopped', {...metadata, 'reason': reason}),
        ),
        (_) {},
      );
    }
    await messenger.handlePlatformMessage(
      channel.name,
      channel.codec.encodeMethodCall(const MethodCall('playbackStopped')),
      (_) {},
    );
    await Future<void>.delayed(Duration.zero);
    expect(events.map((e) => e['type']), [
      'stopped',
      'stopped',
      'playbackStopped',
    ]);
    expect(events.first['reason'], 'maxDuration');
    expect(events[1]['reason'], 'background');
  });
}
