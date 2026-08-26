// LocationSource 실구현 — 순정 LocationManager 를 60초 듀티로 받는다 (Play Services 의존 0)
package com.vitalguard.wear.source

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.util.Log

/**
 * 배터리 기준 프로파일(08-24 확정)의 위치 60초 듀티 구현. 간격은 상수일 뿐 확정값이 아니다 —
 * 실측 ⑥(1시간 %/h)이 모델을 보정하면 함께 재확정한다.
 *
 * ★ **공급자를 FUSED 로 바꿨다(08-26).** 종전은 `GPS_PROVIDER` 단독이었고, 그것은 위성만 본다 —
 * **실내에서는 fix 가 영영 안 온다.** 실측이 그대로였다: 08-26 최근 10분 위경도 **0건**
 * (권한은 `ACCESS_FINE_LOCATION` 부여됨 · 즉 권한이 아니라 공급자 문제).
 * FUSED 는 위성에 더해 wifi·기지국을 함께 써서 실내에서도 좌표를 낸다.
 *
 * ⚠ 대신 **정확도가 크게 갈린다**(위성 ±5m ↔ 기지국 ±1,500m). 그래서 `accuracyMeters` 를
 * 반드시 함께 싣는다 — 이 값이 없으면 관제는 ±5m 와 ±1,500m 를 구별할 수 없고, 그러면
 * "건물 안 어디쯤" 이 "정확히 여기" 로 읽힌다. 이 프로젝트에는 그 필드가 빠져 **21만 GPS 행에
 * 품질 지표가 없는** 선례가 이미 있다(schemas/vital-stream.ts 주석).
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
        val provider = pickProvider(
            Build.VERSION.SDK_INT,
            runCatching { manager.allProviders }.getOrDefault(emptyList()),
        )
        runCatching { manager.requestLocationUpdates(provider, intervalMs, 0f, this) }
            .onSuccess { Log.i(TAG, "위치 구독 공급자=$provider 간격=${intervalMs / 1000}s") }
            // ★ 실패를 삼키지 않는다 — 종전엔 runCatching 이 조용히 먹어서 "좌표가 왜 없나" 를
            //   기기 로그로 못 갈랐다. 사유가 남아야 공급자 문제인지 권한 문제인지 구별된다.
            .onFailure { Log.w(TAG, "위치 구독 실패(공급자=$provider): ${it.javaClass.simpleName}: ${it.message}") }
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

    companion object {
        const val TAG = "VgGps"

        /**
         * 공급자 선택 — 순수 함수라 실기 없이 시험한다.
         *
         * `FUSED_PROVIDER` 는 **API 31+** 상수다(이 워치는 37). minSdk 가 30 이라 하한을 확인하고,
         * 기기가 실제로 그 공급자를 등록했는지도 본다 — 상수가 있어도 공급자가 없는 기기가 있다.
         * 둘 중 하나라도 아니면 위성 GPS 로 떨어진다(종전 동작 = 안전한 폴백).
         */
        internal fun pickProvider(sdkInt: Int, available: Collection<String>): String =
            if (sdkInt >= Build.VERSION_CODES.S && available.contains(LocationManager.FUSED_PROVIDER)) {
                LocationManager.FUSED_PROVIDER
            } else {
                LocationManager.GPS_PROVIDER
            }
    }
}
