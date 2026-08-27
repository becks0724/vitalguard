// 리샘플러 가드 — 갤럭시 ~60Hz 공급이 모듈 학습 계약(50Hz)으로 정확히 접히는가
package com.vitalguard.wear

import com.vitalguard.ml.FeatureExtractor
import com.vitalguard.ml.ImuResampler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/**
 * 한 문장 보장 = **60Hz 로 들어온 신호를 50Hz 격자로 접어도, 50Hz 로 직접 잰 것과 같은 값·같은 피처다.**
 *
 * ★ 왜 여기가 위험한가. 표본율이 틀려도 아무것도 예외를 던지지 않는다 — 모델은 학습 분포 밖
 *   입력에도 그럴듯한 확률을 계속 낸다(DB 실측: 갤럭시 실효 52~54Hz, 2026-08-27). 자가검증도
 *   정답지가 fs=50 고정이라 이 축을 못 본다. 그래서 시험이 붙잡아야 한다.
 */
class ImuResamplerTest {

    private val outs = ArrayList<DoubleArray>()   // [ax..gz, totalG] + tNs 별도
    private val ts = ArrayList<Long>()
    private val resampler = ImuResampler(onSample = { ax, ay, az, gx, gy, gz, totalG, tNs ->
        outs.add(doubleArrayOf(ax, ay, az, gx, gy, gz, totalG))
        ts.add(tNs)
    })

    /** 저주파 합성 신호 — 낙상 신호 대역(수 Hz)을 흉내낸다. c = 채널 위상차. */
    private fun sig(tSec: Double, c: Int): Double = sin(2.0 * PI * 2.0 * tSec + c * 0.7)

    private fun feedAt(hz: Double, seconds: Double) {
        val n = (seconds * hz).toInt()
        for (i in 0 until n) {
            val t = i / hz
            val ns = (t * 1e9).toLong()
            resampler.ingest(sig(t, 0), sig(t, 1), sig(t, 2), sig(t, 3), sig(t, 4), sig(t, 5), ns)
        }
    }

    @Test
    fun `60Hz 입력이 20ms 균일 격자로 나온다`() {
        feedAt(59.99, 6.0)
        // 6초 × 50Hz ≈ 300 격자점 (양끝 오차 ±2 허용)
        assertTrue("출력 ${outs.size}건", outs.size in 296..300)
        for (i in 1 until ts.size) assertEquals(20_000_000L, ts[i] - ts[i - 1])
    }

    @Test
    fun `보간값이 원신호와 일치한다 — 저주파에서 오차 무시 가능`() {
        feedAt(59.99, 6.0)
        var worst = 0.0
        for (i in outs.indices) {
            val t = ts[i] / 1e9
            for (c in 0 until 6) worst = maxOf(worst, abs(outs[i][c] - sig(t, c)))
        }
        // 2Hz 신호를 60Hz 선형보간: 이론 오차 ≤ (2π·2/60)²/8 ≈ 0.006
        assertTrue("최대오차 $worst", worst < 0.01)
    }

    @Test
    fun `리샘플 피처가 50Hz 직접 표본 피처와 근사하다`() {
        feedAt(59.99, 4.0)
        val resampled = Array(outs.size) { i -> DoubleArray(6) { c -> outs[i][c] } }
        val direct = Array(resampled.size) { i ->
            val t = ts[i] / 1e9
            DoubleArray(6) { c -> sig(t, c) }
        }
        val fa = FeatureExtractor.extract(resampled, 50.0)
        val fb = FeatureExtractor.extract(direct, 50.0)
        var worst = 0.0
        for (i in fa.indices) worst = maxOf(worst, abs(fa[i] - fb[i]))
        // 88피처 전수 대조 — 보간 오차만큼의 차이만 허용(지배주파수·엔트로피 포함).
        assertTrue("피처 최대오차 $worst", worst < 0.05)
    }

    @Test
    fun `긴 공백은 보간하지 않는다 — 다리를 놓아 데이터를 지어내지 않는다`() {
        feedAt(59.99, 1.0)
        val before = outs.size
        // 1초 공백 후 재개 — 공백 구간(1e9~2e9ns)에 격자점이 생기면 안 된다.
        val gapStartNs = 2_000_000_000L
        for (i in 0 until 60) {
            val t = i / 59.99
            resampler.ingest(sig(t, 0), sig(t, 1), sig(t, 2), sig(t, 3), sig(t, 4), sig(t, 5),
                gapStartNs + (t * 1e9).toLong())
        }
        val bridged = ts.drop(before).count { it in 1_000_000_000L until gapStartNs }
        assertEquals("공백 구간에 지어낸 표본 ${bridged}건", 0, bridged)
    }
}
