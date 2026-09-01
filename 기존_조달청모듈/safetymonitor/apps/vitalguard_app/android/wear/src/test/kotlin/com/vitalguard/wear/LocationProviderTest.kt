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
    }

    @Test
    fun `두 공급자를 함께 구독한다 - 위성과 실내 폴백`() {
        // ⚠ 종전 가드는 "GPS_PROVIDER 리터럴이 없을 것" 이었다. 09-01 에 위성을 **되살리면서**
        //   그 문구는 불변식을 못 지킨다 — 리터럴이 없어도 폴백을 잃을 수 있고, 있어도 폴백이
        //   살아 있을 수 있다. 진짜 불변식 둘을 직접 단언한다.
        val src = uncommented(
            File("src/main/kotlin/com/vitalguard/wear/source/GpsLocationSource.kt").readText(),
        )
        assertTrue(
            "실내 폴백 구독이 사라졌다 — 실내에서 좌표가 영영 안 온다(08-26 실측 0건)",
            src.contains("subscribe(fallback)"),
        )
        assertTrue(
            "위성 구독이 없다 — FUSED 는 정확도 요구가 없으면 위성을 안 켠다(09-01 실측 gnss 198ms)",
            src.contains("subscribe(LocationManager.GPS_PROVIDER)"),
        )
        assertTrue(
            "폴백이 이미 위성일 때 중복 구독을 막는 가드가 없다",
            src.contains("fallback != LocationManager.GPS_PROVIDER"),
        )
    }

    @Test
    fun `실외에서는 위성이 이긴다`() {
        val sat = LocationFix(35.1, 126.9, accuracyMeters = 12.0, atMs = 1_000L)
        val net = LocationFix(35.2, 126.8, accuracyMeters = 90.0, atMs = 1_000L)
        assertEquals(sat, GpsLocationSource.pickFix(sat, net, nowMs = 2_000L, maxAgeMs = 120_000L))
    }

    @Test
    fun `실내에서는 폴백만 남는다`() {
        // 위성은 실내에서 영영 안 온다 — 폴백이 유일한 좌표다.
        val net = LocationFix(35.2, 126.8, accuracyMeters = 300.0, atMs = 1_000L)
        assertEquals(net, GpsLocationSource.pickFix(null, net, nowMs = 2_000L, maxAgeMs = 120_000L))
    }

    @Test
    fun `위성이 튀면 더 정확한 폴백을 쓴다`() {
        // ★ "위성이면 무조건 우선" 이 아닌 이유. 하늘이 가리면 위성도 수백 m 로 튄다.
        val sat = LocationFix(35.1, 126.9, accuracyMeters = 500.0, atMs = 1_000L)
        val net = LocationFix(35.2, 126.8, accuracyMeters = 60.0, atMs = 1_000L)
        assertEquals(net, GpsLocationSource.pickFix(sat, net, nowMs = 2_000L, maxAgeMs = 120_000L))
    }

    @Test
    fun `묵은 좌표는 정확해도 버린다`() {
        // 묵은 좌표 금지는 종전 규칙 그대로다 — 사람이 그 사이 움직였을 수 있다.
        val stale = LocationFix(35.1, 126.9, accuracyMeters = 5.0, atMs = 0L)
        val fresh = LocationFix(35.2, 126.8, accuracyMeters = 200.0, atMs = 100_000L)
        assertEquals(fresh, GpsLocationSource.pickFix(stale, fresh, nowMs = 130_000L, maxAgeMs = 120_000L))
        assertEquals(null, GpsLocationSource.pickFix(stale, null, nowMs = 130_000L, maxAgeMs = 120_000L))
    }

    @Test
    fun `정확도 미상은 최후순위다 - 단독일 때만 쓴다`() {
        // ⚠ Location.accuracy 는 값이 없으면 0 을 낸다. 그대로 비교하면 품질 미상이 항상 이긴다.
        val unknown = LocationFix(35.2, 126.8, accuracyMeters = 0.0, atMs = 1_000L)
        val sat = LocationFix(35.1, 126.9, accuracyMeters = 15.0, atMs = 1_000L)
        assertEquals(sat, GpsLocationSource.pickFix(sat, unknown, nowMs = 2_000L, maxAgeMs = 120_000L))
        // 단독 후보면 그래도 쓴다 — 없는 것보다는 낫다.
        assertEquals(unknown, GpsLocationSource.pickFix(null, unknown, nowMs = 2_000L, maxAgeMs = 120_000L))
    }
}
