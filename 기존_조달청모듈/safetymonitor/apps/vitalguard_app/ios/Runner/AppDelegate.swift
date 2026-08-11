import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // 백그라운드 재기동 시에도 WCSession 수신이 살아 있도록 launch 직후 활성화한다.
    PhoneReceiver.shared.activate()
    // BGTask 등록은 didFinishLaunching 안에서 완료돼야 한다(이후 등록은 크래시).
    VitalPipeline.shared.registerBGTask()
    VitalPipeline.shared.start()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}
