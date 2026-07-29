import SwiftUI
import WatchConnectivity

/// Add this source file to the existing `VitAlGuard Watch` target.
/// Flutter owns the phone UI and sends the same non-secret session context
/// through the Runner's WatchConnectivity bridge.
@main
struct VitAlGuardFlutterWatchApp: App {
    @StateObject private var bridge = FlutterPhoneSessionBridge()

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color.black.ignoresSafeArea()
                VStack(spacing: 12) {
                    HStack(spacing: 8) {
                        Image(systemName: "heart.text.square.fill")
                            .font(.title3)
                            .foregroundStyle(.white)
                            .frame(width: 46, height: 46)
                            .background(Color(red: 0.09, green: 0.11, blue: 0.12), in: Circle())
                        VStack(alignment: .leading, spacing: 1) {
                            Text("VitAlGuard-관리자").font(.headline).fontWeight(.bold)
                            Text("admin").font(.caption).foregroundStyle(.white.opacity(0.7))
                            Text("현장정보 저장 · 캘린더 수정/삭제 가능").font(.system(size: 8)).foregroundStyle(.orange)
                        }
                        Spacer(minLength: 0)
                        Circle().fill(bridge.connected ? Color.green : Color.gray).frame(width: 10, height: 10)
                        Image(systemName: "gearshape.fill").font(.title3).padding(8).background(Color.gray.opacity(0.3), in: Circle())
                    }
                    .padding(.horizontal, 4)

                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            HStack(spacing: 5) {
                                Circle().fill(.green).frame(width: 10, height: 10)
                                Circle().fill(.orange.opacity(0.45)).frame(width: 10, height: 10)
                                Circle().fill(.red.opacity(0.35)).frame(width: 10, height: 10)
                            }
                            Text("관제웹 연결됨").foregroundStyle(.green).font(.caption).fontWeight(.bold)
                            Spacer()
                            Button(action: bridge.requestSession) { Image(systemName: "arrow.clockwise").font(.title3) }.buttonStyle(.plain)
                        }
                        Text(bridge.status).font(.caption2).foregroundStyle(.white.opacity(0.72)).lineLimit(2)
                    }
                    .padding(14)
                    .background(Color.black, in: RoundedRectangle(cornerRadius: 26))
                    .overlay(RoundedRectangle(cornerRadius: 26).stroke(Color.white.opacity(0.25)))

                    VStack(spacing: 8) {
                        Text("Watch 안전 상태").font(.headline)
                        HStack(spacing: 12) {
                            WatchMetric(label: "심박", value: "--", color: .red)
                            WatchMetric(label: "낙상", value: "대기", color: .green)
                            WatchMetric(label: "동기화", value: bridge.connected ? "ON" : "--", color: bridge.connected ? .green : .orange)
                        }
                    }
                    .padding(14)
                    .background(Color(red: 0.08, green: 0.08, blue: 0.08), in: RoundedRectangle(cornerRadius: 28))
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 9)
            }
        }
    }
}

private struct WatchMetric: View {
    let label: String
    let value: String
    let color: Color
    var body: some View {
        VStack(spacing: 3) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(value).font(.headline).fontWeight(.bold)
            Text(label).font(.caption2).foregroundStyle(.white.opacity(0.7))
        }.frame(maxWidth: .infinity)
    }
}

final class FlutterPhoneSessionBridge: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var connected = false
    @Published private(set) var status = "iPhone Flutter 앱 연결을 기다리는 중입니다."

    override init() {
        super.init()
        guard WCSession.isSupported() else {
            status = "이 Apple Watch에서는 WatchConnectivity를 사용할 수 없습니다."
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func requestSession() {
        let message: [String: Any] = ["request": "watchSessionSync", "source": "VitAlGuard-Watch"]
        guard WCSession.default.isReachable else {
            status = "iPhone이 연결되면 세션을 요청합니다."
            WCSession.default.transferUserInfo(message)
            return
        }
        WCSession.default.sendMessage(message, replyHandler: { [weak self] reply in
            self?.apply(reply)
        }, errorHandler: { [weak self] _ in
            DispatchQueue.main.async { self?.status = "휴대폰 응답을 기다리는 중입니다." }
        })
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.connected = activationState == .activated
            self?.status = activationState == .activated ? "세션 준비 완료" : "세션 활성화 실패"
        }
        if activationState == .activated, !session.receivedApplicationContext.isEmpty {
            apply(session.receivedApplicationContext)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) { apply(applicationContext) }
    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        apply(message)
        replyHandler(["status": "watchContextAccepted"])
    }

    private func apply(_ context: [String: Any]) {
        let employee = (context["employeeId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        DispatchQueue.main.async { [weak self] in
            self?.connected = true
            self?.status = employee.isEmpty ? "휴대폰 세션 동기화됨" : "\(employee) 세션 동기화됨"
        }
    }
}
