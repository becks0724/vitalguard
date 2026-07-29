import Flutter
import UIKit
import WatchConnectivity

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var watchBridge: FlutterWatchBridge?
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "VitAlGuardWatchBridge") {
      watchBridge = FlutterWatchBridge(messenger: registrar.messenger())
    }
  }
}

private final class FlutterWatchBridge: NSObject, WCSessionDelegate {
  private let session = WCSession.default
  private let channel: FlutterMethodChannel

  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: "com.yangjeehoo.vitalguard/watch_bridge", binaryMessenger: messenger)
    super.init()
    channel.setMethodCallHandler { [weak self] call, result in self?.handle(call, result: result) }
    if WCSession.isSupported() { session.delegate = self; session.activate() }
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "status": result(statusPayload())
    case "syncWatchContext":
      guard let payload = call.arguments as? [String: Any] else {
        result(FlutterError(code: "invalid_context", message: "시계 동기화 데이터 형식이 올바르지 않습니다.", details: nil)); return
      }
      guard WCSession.isSupported() else {
        result(["message": "이 iPhone에서는 Apple Watch 연동을 지원하지 않습니다."]); return
      }
      do {
        try session.updateApplicationContext(payload)
        if session.isReachable { session.sendMessage(payload, replyHandler: nil, errorHandler: nil) }
        result(["message": "Apple Watch 세션을 동기화했습니다."])
      } catch {
        session.transferUserInfo(payload)
        result(["message": "Apple Watch가 연결되면 세션을 동기화합니다."])
      }
    default: result(FlutterMethodNotImplemented)
    }
  }

  private func statusPayload() -> [String: Any] {
    guard WCSession.isSupported() else {
      return ["supported": false, "reachable": false, "platform": "Apple Watch", "detail": "이 iPhone에서는 WatchConnectivity를 사용할 수 없습니다."]
    }
    let active = session.activationState == .activated
    return ["supported": active, "reachable": session.isReachable, "platform": "Apple Watch", "detail": active ? (session.isReachable ? "페어링된 시계와 즉시 통신할 수 있습니다." : "페어링은 되었으며 다음 연결 시 동기화합니다.") : "시계 세션을 활성화하는 중입니다."]
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}
