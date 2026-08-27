// C2 — features.py 의 88 핸드크래프트 피처를 수치 동일하게 Kotlin 포팅 (Swift FeatureExtractor 와 동일 알고리즘).
// 채널 7개(accel xyz + gyro xyz + |accel|) × 12 시간/주파수 피처 + 도메인 4개 = 88.
// numpy 와의 일치는 ml_selfcheck.json(파이썬 정답지) 대조로 검증한다(MLSelfCheck.kt).
//
// DFT는 O(n²) 나이브 구현 — n≤600·이벤트 시에만 실행이라 수백 ms 이내(Swift 판과 동일 선택).
package com.vitalguard.ml

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sqrt

object FeatureExtractor {
    const val COUNT = 88

    /** samples: 시간순 [ax,ay,az,gx,gy,gz], fs: 샘플레이트 → 88피처 (features.py extract 와 동일 순서) */
    fun extract(samples: Array<DoubleArray>, fs: Double): DoubleArray {
        val n = samples.size
        require(n > 1) { "빈 윈도" }
        // 채널 분해 + accel magnitude
        val chans = Array(7) { DoubleArray(n) }
        for (i in 0 until n) {
            val a = samples[i]
            for (c in 0 until 6) chans[c][i] = a[c]
            chans[6][i] = sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
        }
        val f = ArrayList<Double>(COUNT)
        for (c in chans) f.addAll(channelFeatures(c, fs))

        // 도메인 4개 (mag = chans[6])
        val mag = chans[6]
        f.add(mag.maxOrNull()!!)                                        // 최대 충격 G
        f.add(mag.count { it < 0.5 }.toDouble() / n)                    // 자유낙하 비율
        val win = maxOf(2, (0.4 * fs).toInt())
        val mv = ArrayList<Double>()
        var i = 0
        val stop = maxOf(1, n - win)                                    // python range(0, max(1, n-win), win)
        while (i < stop) { mv.add(std(mag, i, minOf(i + win, n))); i += win }
        f.add(if (mv.isEmpty()) 0.0 else mv.count { it < 0.1 }.toDouble() / mv.size)  // 무활동 비율
        var jerk = 0.0                                                  // 평균 jerk
        for (k in 1 until n) jerk += abs(mag[k] - mag[k - 1])
        f.add(jerk / (n - 1) * fs)

        // nan_to_num 방어 (features.py 와 동일)
        return DoubleArray(COUNT) { idx ->
            val v = f[idx]
            when {
                v.isNaN() -> 0.0
                v == Double.POSITIVE_INFINITY -> 1e6
                v == Double.NEGATIVE_INFINITY -> -1e6
                else -> v
            }
        }
    }

    /** features.py _chan 과 동일: [mean, std, min, max, rms, mad, iqr, zcr, skew, kurt, domfreq, entropy] */
    private fun channelFeatures(x: DoubleArray, fs: Double): List<Double> {
        val n = x.size
        var m = 0.0
        for (v in x) m += v
        m /= n
        val s = std(x, 0, n)
        val xc = DoubleArray(n) { x[it] - m }
        val sd = s + 1e-9
        var rms = 0.0; var mad = 0.0; var m3 = 0.0; var m4 = 0.0
        for (i in 0 until n) {
            rms += x[i] * x[i]
            mad += abs(xc[i])
            val c2 = xc[i] * xc[i]
            m3 += c2 * xc[i]
            m4 += c2 * c2
        }
        rms = sqrt(rms / n); mad /= n; m3 /= n; m4 /= n
        var zc = 0
        for (i in 0 until n - 1) if (xc[i] * xc[i + 1] < 0) zc++
        val skew = (m3 / (sd * sd * sd)).coerceIn(-50.0, 50.0)
        val kurt = (m4 / (sd * sd * sd * sd)).coerceIn(-50.0, 200.0)

        // rfft power spectrum (xc 기준, numpy 와 동일)
        val sp = rfftPower(xc)
        var dom = 0.0; var ent = 0.0
        var total = 0.0
        for (p in sp) total += p
        if (total > 0) {
            var kmax = 0
            for (k in 1 until sp.size) if (sp[k] > sp[kmax]) kmax = k   // 첫 최대(numpy argmax)
            dom = kmax * fs / n                                          // rfftfreq
            for (p in sp) {
                val pf = p / total
                ent -= pf * ln(pf + 1e-12)
            }
        }
        return listOf(m, s, x.minOrNull()!!, x.maxOrNull()!!, rms, mad,
            percentile(x, 75.0) - percentile(x, 25.0),
            zc.toDouble() / (n - 1), skew, kurt, dom, ent)
    }

    private fun std(x: DoubleArray, from: Int, to: Int): Double {        // 모집단 std (numpy ddof=0)
        val n = to - from
        var m = 0.0
        for (i in from until to) m += x[i]
        m /= n
        var v = 0.0
        for (i in from until to) v += (x[i] - m) * (x[i] - m)
        return sqrt(v / n)
    }

    private fun percentile(x: DoubleArray, q: Double): Double {          // numpy 선형보간
        val a = x.clone().also { it.sort() }
        val pos = q / 100 * (a.size - 1)
        val lo = pos.toInt()
        if (lo >= a.size - 1) return a[a.size - 1]
        return a[lo] + (pos - lo) * (a[lo + 1] - a[lo])
    }

    /** |rfft(x)|² — 나이브 DFT, k = 0...n/2 (numpy rfft 출력 길이 n/2+1) */
    private fun rfftPower(x: DoubleArray): DoubleArray {
        val n = x.size
        val half = n / 2
        val sp = DoubleArray(half + 1)
        val w = -2.0 * PI / n
        for (k in 0..half) {
            var re = 0.0; var im = 0.0
            for (j in 0 until n) {
                val a = w * j.toDouble() * k
                re += x[j] * cos(a)
                im += x[j] * sin(a)
            }
            sp[k] = re * re + im * im
        }
        return sp
    }
}
