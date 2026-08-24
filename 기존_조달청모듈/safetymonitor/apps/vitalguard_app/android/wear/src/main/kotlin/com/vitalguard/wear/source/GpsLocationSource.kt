// LocationSource 실구현 — 순정 LocationManager GPS 를 60초 듀티로 받는다 (Play Services 의존 0)
package com.vitalguard.wear.source

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager

/**
 * 배터리 기준 프로파일(08-24 확정)의 GPS 60초 듀티 구현. 간격은 상수일 뿐 확정값이 아니다 —
 * 실측 ⑥(1시간 %/h)이 모델을 보정하면 함께 재확정한다.
 * ⚠ 실기 검증 전이다 — 컴파일만 보증된 상태. 실측 항목에 "GPS fix 획득·정확도" 가 들어간다.
 */
class GpsLocationSource(
    context: Context,
    private val intervalMs: Long = 60_000,
    private val maxAgeMs: Long = 120_000,
) : LocationSource, LocationListener {

    private val manager = context.getSystemService(LocationManager::class.java)
    @Volatile private var last: LocationFix? = null

    @SuppressLint("MissingPermission")   // 권한은 CollectorService 기동 전 화면(①)에서 받는다
    override fun start() {
        runCatching {
            manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, 0f, this)
        }
    }

    override fun stop() {
        runCatching { manager.removeUpdates(this) }
    }

    override fun currentFix(nowMs: Long): LocationFix? {
        val f = last ?: return null
        return if (nowMs - f.atMs <= maxAgeMs) f else null
    }

    override fun onLocationChanged(location: Location) {
        last = LocationFix(
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = location.accuracy.toDouble(),
            atMs = location.time,
        )
    }
}
