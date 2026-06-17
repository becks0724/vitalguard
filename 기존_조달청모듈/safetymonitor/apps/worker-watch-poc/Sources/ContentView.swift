// PoC 메인 화면 — 파스텔 카드 섹션 레퍼런스. 생체데이터를 메트릭별 카드로 각각 배치 + 수집/전송 상태 + 설정
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var workout: WorkoutManager
    @State private var showSosConfirm = false

    var body: some View {
        Group {
            if let prompt = workout.activeFallPrompt {
                FallPromptView(prompt: prompt)
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        header

                        MetricCard(
                            bg: WatchTheme.heartCard,
                            icon: "heart.fill",
                            iconTint: WatchTheme.heart,
                            title: "심박",
                            subtitle: "HEART RATE",
                            value: workout.latestHeartRate.map { "\(Int($0.rounded()))" } ?? "--",
                            unit: "bpm"
                        )

                        MetricCard(
                            bg: WatchTheme.spo2Card,
                            icon: "lungs.fill",
                            iconTint: WatchTheme.spo2,
                            title: "산소포화도",
                            subtitle: "SpO₂",
                            value: workout.latestSpO2.map { "\(Int($0.rounded()))" } ?? "--",
                            unit: "%",
                            footnote: "주기적 측정"
                        )

                        MetricCard(
                            bg: WatchTheme.fallCard,
                            icon: "figure.fall",
                            iconTint: WatchTheme.warn,
                            title: "낙상 감지",
                            subtitle: "FALL",
                            value: workout.fallCount > 0 ? "\(workout.fallCount)" : "정상",
                            unit: workout.fallCount > 0 ? "건" : "",
                            footnote: workout.lastFallText
                        )

                        statusCard
                        actions
                    }
                    .padding(.horizontal, 3)
                    .padding(.bottom, 10)
                }
            }
        }
        .background(WatchTheme.bg)
    }

    // MARK: 헤더 — 브랜드 로고 + 워드마크 + 연결 점 + 설정 진입
    private var header: some View {
        HStack(spacing: 6) {
            Image("BrandLogo")
                .resizable()
                .interpolation(.high)
                .scaledToFill()
                .frame(width: 24, height: 24)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            Text("SafetyWatch")
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(WatchTheme.brand)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Circle()
                .fill(workout.isRunning ? WatchTheme.ok : WatchTheme.muted)
                .frame(width: 6, height: 6)
            Spacer(minLength: 2)
            NavigationLink {
                SettingsView()
            } label: {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(WatchTheme.muted)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 4)
        .padding(.top, 2)
    }

    // MARK: 수집/전송 상태 (다크 카드)
    private var statusCard: some View {
        WatchCard {
            HStack {
                Text("전송 \(workout.sentCount)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                if workout.bufferedCount > 0 {
                    Text("버퍼 \(workout.bufferedCount)")
                        .font(.system(size: 11))
                        .foregroundStyle(WatchTheme.warn)
                }
            }
            Text(workout.lastStatus)
                .font(.system(size: 11))
                .foregroundStyle(WatchTheme.muted)
            if workout.isRunning {
                Text("스트레스 입력 수집 중 (서버 분석)")
                    .font(.system(size: 10))
                    .foregroundStyle(WatchTheme.muted)
            }
            if let err = workout.lastError {
                Text(err)
                    .font(.system(size: 11))
                    .foregroundStyle(WatchTheme.warn)
            }
        }
    }

    // MARK: 액션 버튼
    @ViewBuilder
    private var actions: some View {
        if !workout.authorized {
            Button("건강·모션 권한 요청") {
                Task { await workout.requestAuthorization() }
            }
            .tint(WatchTheme.brand)
        } else if workout.isRunning {
            // 워치 단독 SOS — 오발신 방지 확인 다이얼로그 후 즉시 전송.
            Button("🆘 SOS 전송") { showSosConfirm = true }
                .tint(WatchTheme.danger)
                .confirmationDialog(
                    "SOS 를 전송할까요?",
                    isPresented: $showSosConfirm,
                    titleVisibility: .visible
                ) {
                    Button("SOS 전송", role: .destructive) { workout.sendSos() }
                    Button("취소", role: .cancel) {}
                }
            Button("수집 정지") { workout.stop() }
                .font(.caption)
                .tint(WatchTheme.warn)
            Button("낙상 테스트(수동)") { workout.simulateFall() }
                .font(.caption)
                .tint(WatchTheme.warn)
        } else {
            Button("수집 시작") { workout.start() }
                .tint(WatchTheme.ok)
        }
    }
}

private struct FallPromptView: View {
    @EnvironmentObject private var workout: WorkoutManager
    let prompt: WorkoutManager.ActiveFallPrompt

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                WatchCard {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("낙상 확인")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.white)
                            Text("응답 없으면 자동 경보")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(WatchTheme.warn)
                        }
                        Spacer()
                        Text("\(prompt.remainingSec)")
                            .font(.system(size: 28, weight: .heavy, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        PromptMetricRow(label: "충격", value: String(format: "%.1fG", prompt.peakG))
                        PromptMetricRow(label: "정지", value: String(format: "%.1fs", prompt.stillSec))
                        PromptMetricRow(label: "회전", value: String(format: "%.1f", prompt.peakRotationRadS))
                        PromptMetricRow(
                            label: "심박",
                            value: prompt.startedHeartRate.map { "\(Int($0.rounded())) bpm" } ?? "--"
                        )
                    }
                }

                Button("괜찮음 · 해제") {
                    workout.dismissActiveFallPrompt()
                }
                .tint(WatchTheme.ok)

                Button("도움 요청 · SOS") {
                    workout.escalateActiveFallPromptToSos()
                }
                .tint(WatchTheme.danger)
            }
            .padding(.horizontal, 3)
            .padding(.vertical, 10)
        }
        .background(WatchTheme.bg)
    }
}

private struct PromptMetricRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(WatchTheme.muted)
            Spacer()
            Text(value)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
    }
}

// 파스텔 카드 섹션 — 아이콘 칩 + 제목 + 큰 값 + 보조 라벨. 위험 판정색 없음(raw 표시).
private struct MetricCard: View {
    let bg: Color
    let icon: String
    let iconTint: Color
    let title: String
    let subtitle: String
    let value: String
    var unit: String = ""
    var footnote: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ZStack {
                    Circle().fill(WatchTheme.ink.opacity(0.88)).frame(width: 30, height: 30)
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(iconTint)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text(title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(WatchTheme.ink)
                    Text(subtitle)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(WatchTheme.ink.opacity(0.5))
                }
                Spacer()
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(WatchTheme.ink)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(WatchTheme.ink.opacity(0.6))
                }
                Spacer()
            }
            if let footnote {
                Text(footnote)
                    .font(.system(size: 10))
                    .foregroundStyle(WatchTheme.ink.opacity(0.6))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(bg, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
