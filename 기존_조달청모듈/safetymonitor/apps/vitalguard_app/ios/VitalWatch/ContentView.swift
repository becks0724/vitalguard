// 워치 초기 화면 — Phase 0에서 HR 수집 상태 표시로 교체 예정
import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "heart.fill")
                .foregroundStyle(.red)
            Text("VitalWatch 준비됨")
                .font(.headline)
        }
    }
}
