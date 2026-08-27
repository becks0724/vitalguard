// 원시 IMU 6축 윈도 로거 (Wear OS 판) — Swift IMUWindowLogger 포팅. 시각만 Date → 나노초 Long(SensorEvent.timestamp).
//
// 6축(accel xyz + gyro xyz)을 링버퍼에 롤링 적재하고, 알림 임계보다 낮은 "로깅 게이트"(1.8G)가
// 열린 시점 ±N초 윈도를 잘라 onWindow 로 내보낸다. 충격 시점 기준 pre/post 윈도라
// work_veto(3s)/impact(±1s)/recovery(post)로 잘라 쓸 수 있다.
// 주의: 입력 accel 은 애플워치 규약(G 단위·중력 포함·정지 시 |a|≈1)으로 변환된 값이어야 한다 — FallMonitor 참조.
package com.vitalguard.ml

import kotlin.math.abs

class ImuWindow(
    val fs: Double,
    val samples: Array<FloatArray>,   // 각 행 = [ax, ay, az, gx, gy, gz], 시간순
    val impactIndex: Int              // 윈도 내 충격(로깅 게이트) 위치
)

class ImuWindowLogger(
    private val fs: Double = 50.0,
    private val preSec: Double = 2.0,
    private val postSec: Double = 10.0,
    private val logThresholdG: Double = 1.8,   // 알림 임계(2.8)보다 낮음 → 음성·약충격도 수집
    private val refractorySec: Double = 2.0
) {
    var onWindow: ((ImuWindow) -> Unit)? = null

    private class Entry(val tNs: Long, val s: FloatArray)

    private val capacity = ((preSec + postSec + 1.0) * fs).toInt()   // 여유 1s
    private val buf = ArrayDeque<Entry>()
    private var pendingImpactNs: Long? = null
    private var lastEmitNs: Long? = null

    // 센서 콜백에서 6축 raw 와 totalG 를 넘겨 호출. 단일 HandlerThread 에서 호출되므로 buf 접근은 직렬화되어 안전.
    fun ingest(ax: Double, ay: Double, az: Double,
               gx: Double, gy: Double, gz: Double,
               totalG: Double, nowNs: Long) {
        buf.addLast(Entry(nowNs, floatArrayOf(
            ax.toFloat(), ay.toFloat(), az.toFloat(),
            gx.toFloat(), gy.toFloat(), gz.toFloat())))
        while (buf.size > capacity) buf.removeFirst()

        // 로깅 게이트 — 알림 임계보다 낮은 충격에서도 윈도 후보 시작(refractory 로 과다 트리거 억제).
        if (pendingImpactNs == null && totalG >= logThresholdG) {
            val last = lastEmitNs
            if (last != null && nowNs - last < (refractorySec * 1e9).toLong()) return
            pendingImpactNs = nowNs
        }

        // post 구간이 다 채워지면 [impact-pre, impact+post] 윈도 추출 후 방출.
        val impact = pendingImpactNs
        if (impact != null && nowNs - impact >= (postSec * 1e9).toLong()) {
            emit(impact)
            pendingImpactNs = null
            lastEmitNs = nowNs
        }
    }

    private fun emit(impactNs: Long) {
        val startNs = impactNs - (preSec * 1e9).toLong()
        val endNs = impactNs + (postSec * 1e9).toLong()
        val win = buf.filter { it.tNs in startNs..endNs }
        if (win.size < fs.toInt()) return   // 1초 미만이면 버림(드롭/지터 방어)
        // 충격 위치 = impact 에 가장 가까운 샘플 인덱스
        var idx = 0
        var best = Long.MAX_VALUE
        for ((i, e) in win.withIndex()) {
            val d = abs(e.tNs - impactNs)
            if (d < best) { best = d; idx = i }
        }
        onWindow?.invoke(ImuWindow(fs, Array(win.size) { win[it].s }, idx))
    }
}
