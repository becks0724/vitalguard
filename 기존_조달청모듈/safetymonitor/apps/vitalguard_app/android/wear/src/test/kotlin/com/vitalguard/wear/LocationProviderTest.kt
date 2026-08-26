// 위치 공급자 가드 — 실내에서 좌표가 잡히는 공급자를 고르고, 정확도를 반드시 함께 싣는가
package com.vitalguard.wear

import android.location.LocationManager
import com.vitalguard.wear.pipeline.SampleBuilder
import com.vitalguard.wear.source.GpsLocationSource
import com.vitalguard.wear.source.LocationFix
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **실내에서도 좌표가 잡히고, 그 좌표가 얼마나 믿을 만한지 함께 간다.**
 *
 * 08-26 실측 — 최근 10분 위경도 **0건**. 권한(`ACCESS_FINE_LOCATION`)은 부여돼 있었으니
 * 권한 문제가 아니라 **공급자 문제**였다. `GPS_PROVIDER` 는 위성만 봐서 실내에서 fix 가 안 온다.
 */
class LocationProviderTest {
    private val FUSED = LocationManager.FUSED_PROVIDER
    private val GPS = LocationManager.GPS_PROVIDER

    @Test
    fun `기기가 지원하면 FUSED 를 쓴다`() {
        // 이 워치 = API 37. 위성+wifi+기지국을 함께 써야 실내에서 좌표가 나온다.
        assertEquals(FUSED, GpsLocationSource.pickProvider(37, listOf(GPS, FUSED, "network")))
    }

    @Test
    fun `구버전에서는 위성으로 떨어진다`() {
        // FUSED_PROVIDER 는 API 31+ 상수다. minSdk 30 이라 하한을 넘는 기기가 있을 수 있다.
        assertEquals(GPS, GpsLocationSource.pickProvider(30, listOf(GPS, FUSED)))
    }

    @Test
    fun `상수만 있고 공급자가 없으면 위성으로 떨어진다`() {
        // API 는 높은데 기기가 FUSED 를 등록 안 한 경우 — 구독이 예외로 죽지 않게 폴백한다.
        assertEquals(GPS, GpsLocationSource.pickProvider(37, listOf(GPS)))
        assertEquals(GPS, GpsLocationSource.pickProvider(37, emptyList()))
    }

    @Test
    fun `좌표에 정확도가 반드시 붙는다`() {
        // ⚠ FUSED 는 정확도가 크게 갈린다(위성 ±5m ↔ 기지국 ±1,500m). 정확도가 없으면
        //   관제가 둘을 구별 못 하고 "건물 안 어디쯤" 이 "정확히 여기" 로 읽힌다.
        //   이 프로젝트엔 그 필드가 빠져 21만 GPS 행에 품질 지표가 없는 선례가 있다.
        val b = SampleBuilder()
        b.heartRate(90, 1_000L)
        val v = b.buildAndReset(
            sentAtMs = 2_000L,
            fix = LocationFix(latitude = 35.1, longitude = 126.9, accuracyMeters = 1450.0, atMs = 1_500L),
        )!!
        assertEquals(35.1, v["latitude"])
        assertEquals(126.9, v["longitude"])
        assertEquals("정확도가 빠졌다 — 좌표만 가면 품질을 구별할 수 없다", 1450.0, v["locationAccuracyMeters"])
        assertTrue("측정 시각이 빠졌다", v.containsKey("locationTimestamp"))
    }

    @Test
    fun `좌표 4종은 한 덩어리다`() {
        // 일부만 실으면 관제가 반쪽 좌표를 받는다. fix 가 없으면 넷 다 없어야 한다.
        val b = SampleBuilder()
        b.heartRate(90, 1_000L)
        val v = b.buildAndReset(sentAtMs = 2_000L, fix = null)!!
        listOf("latitude", "longitude", "locationAccuracyMeters", "locationTimestamp").forEach {
            assertFalse("fix 가 없는데 $it 가 실렸다", v.containsKey(it))
        }
    }

    @Test
    fun `구독 실패를 삼키지 않는다`() {
        // 종전엔 runCatching 이 조용히 먹어서 "좌표가 왜 없나" 를 로그로 못 갈랐다.
        val src = uncommented(
            File("src/main/kotlin/com/vitalguard/wear/source/GpsLocationSource.kt").readText(),
        )
        assertTrue("실패 사유를 안 남긴다", src.contains("onFailure"))
        assertTrue("어느 공급자로 붙었는지 안 남긴다", src.contains("onSuccess"))
        assertFalse(
            "위성 단독 구독으로 되돌아갔다 — 실내에서 좌표가 영영 안 온다",
            src.contains("requestLocationUpdates(LocationManager.GPS_PROVIDER"),
        )
    }
}
