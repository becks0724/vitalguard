// 60Hz(갤럭시 실공급) → 50Hz(모듈 학습 계약) 선형보간 리샘플러 — v6.1.3
//
// ★ 왜 필요한가. 모델 3종은 50Hz 애플워치 창으로 학습됐고, 피처(고정 150표본 슬라이스·
//   주파수축·영점교차율)가 전부 그 표본율의 분포로 구워져 있다. 갤럭시는 센서 지원 주기가
//   119.99Hz 의 약수 계열이라 50 이 없어 ~60Hz 로 공급된다(DB 실측 실효 52~54Hz,
//   2026-08-27). 그대로 먹이면 모델은 예외 없이 그럴듯한 확률을 내지만 전부 학습 분포
//   밖의 입력이다. 그래서 모듈이 자기 입력 계약을 여기서 스스로 지킨다.
//
// 방식: 20ms 균일 격자에 선형보간. 낙상 신호는 저주파(캡처 게이트·피크G·무활동)라
//   60→50 선형보간의 왜곡은 무시 가능 — 검증은 ImuResamplerTest(60Hz 합성 입력 →
//   50Hz 직접 표본과 피처 대조)가 못박는다.
// 공백 처리: maxGapNs 초과 끊김은 보간하지 않는다(긴 다리를 놓으면 데이터를 지어내는
//   것이 된다) — 격자를 새 표본에서 재시작. 하류(ImuWindowLogger)는 시각 기반이라 안전.
// totalG 는 보간된 가속 3축에서 재계산한다(스칼라를 따로 보간하면 축과 어긋난다).
//
// 배선: 센서 콜백 → ingest() → onSample(50Hz) → fallShadow.feed + imuLogger.ingest.
// 애플워치는 요청 주기가 그대로 나와(실측 49.9) 이 파일이 필요 없다 — WearOS 전용.
package com.vitalguard.ml

import kotlin.math.sqrt

class ImuResampler(
    private val periodNs: Long = 20_000_000L,     // 50Hz 격자
    private val maxGapNs: Long = 200_000_000L,    // 이 이상 끊기면 보간 대신 재시작
    private val onSample: (ax: Double, ay: Double, az: Double,
                           gx: Double, gy: Double, gz: Double,
                           totalG: Double, tNs: Long) -> Unit,
) {
    private var prev: DoubleArray? = null
    private var prevNs = 0L
    private var nextGridNs = 0L

    /** 센서 표본 1건 투입(단위 변환은 이미 끝난 값 — ImuSource 규약 그대로). */
    fun ingest(ax: Double, ay: Double, az: Double,
               gx: Double, gy: Double, gz: Double, tNs: Long) {
        val cur = doubleArrayOf(ax, ay, az, gx, gy, gz)
        val p = prev
        // 첫 표본·긴 공백·시계 역행 → 보간 불가, 격자 재시작.
        if (p == null || tNs - prevNs > maxGapNs || tNs <= prevNs) {
            prev = cur
            prevNs = tNs
            nextGridNs = tNs + periodNs
            return
        }
        var g = nextGridNs
        while (g <= tNs) {
            val f = (g - prevNs).toDouble() / (tNs - prevNs).toDouble()
            val ax2 = p[0] + (cur[0] - p[0]) * f
            val ay2 = p[1] + (cur[1] - p[1]) * f
            val az2 = p[2] + (cur[2] - p[2]) * f
            val gx2 = p[3] + (cur[3] - p[3]) * f
            val gy2 = p[4] + (cur[4] - p[4]) * f
            val gz2 = p[5] + (cur[5] - p[5]) * f
            onSample(ax2, ay2, az2, gx2, gy2, gz2,
                sqrt(ax2 * ax2 + ay2 * ay2 + az2 * az2), g)
            g += periodNs
        }
        nextGridNs = g
        prev = cur
        prevNs = tNs
    }
}
