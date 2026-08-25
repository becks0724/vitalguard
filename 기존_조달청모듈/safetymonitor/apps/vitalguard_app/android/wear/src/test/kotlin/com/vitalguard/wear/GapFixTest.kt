// 08-24 외부 리뷰 격차 3건의 재발 방지 — 매니페스트 권한 가드 + 좌표 4종 계약 + 신선도 규칙
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.SampleBuilder
import com.vitalguard.wear.source.FakeLocationSource
import com.vitalguard.wear.source.LocationFix
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ManifestGuardTest {

    private val manifest = File("src/main/AndroidManifest.xml").readText()

    @Test
    fun `INTERNET 권한 - 없으면 업로드가 조용한 30초 무한 재시도가 된다`() {
        listOf(
            "android.permission.INTERNET",
            "android.permission.ACCESS_NETWORK_STATE",   // 실측 ⑧ TRANSPORT_CELLULAR 바인딩
        ).forEach { assertTrue("$it 누락", manifest.contains(it)) }
    }

    @Test
    fun `BODY_SENSORS 에 maxSdkVersion 을 걸지 않는다 - 걸면 API36+ 에서 순정 심박이 죽는다`() {
        // 08-25 실기(API 37) — maxSdkVersion=35 탓에 선언이 사라져 TYPE_HEART_RATE 가 무음 사망.
        val body = manifest.substringAfter("android.permission.BODY_SENSORS\"").substringBefore("/>")
        assertFalse("BODY_SENSORS 에 maxSdkVersion 이 붙었다", body.contains("maxSdkVersion"))
    }

    @Test
    fun `SpO2·피부온 권한 선언 - 없으면 pm grant 가 조용히 무시된다`() {
        // 08-25 실기 — READ_HEART_RATE 만 선언돼 있어 나머지 부여가 전부 무음 실패했고,
        // 삼성 트래커가 PERMISSION_ERROR 로 죽었다. 선언 자체를 가드로 고정한다.
        listOf(
            "android.permission.health.READ_OXYGEN_SATURATION",
            "android.permission.health.READ_SKIN_TEMPERATURE",
        ).forEach { assertTrue("$it 누락", manifest.contains(it)) }
    }

    @Test
    fun `위치 권한과 FGS location 타입 - GPS 송출의 전제`() {
        listOf(
            "android.permission.ACCESS_FINE_LOCATION",
            "android.permission.FOREGROUND_SERVICE_LOCATION",
        ).forEach { assertTrue("$it 누락", manifest.contains(it)) }
        assertTrue("CollectorService 의 FGS 타입에 location 이 없다",
            manifest.contains("health|location"))
    }
}

class LocationContractTest {

    @Test
    fun `좌표 4종은 한 덩어리 - 일부만 실리지 않는다`() {
        val b = SampleBuilder()
        b.heartRate(72, 1_000)
        val v = b.buildAndReset(5_000, fix = LocationFix(35.1, 126.9, 8.0, 4_000))!!
        assertEquals(35.1, v["latitude"])
        assertEquals(126.9, v["longitude"])
        assertEquals(8.0, v["locationAccuracyMeters"])
        assertEquals(com.vitalguard.wear.pipeline.IsoMs.format(4_000), v["locationTimestamp"])
    }

    @Test
    fun `fix 가 없으면 좌표 키 자체가 없다 - 묵은 좌표 금지의 전반부`() {
        val b = SampleBuilder()
        b.heartRate(72, 1_000)
        val v = b.buildAndReset(5_000, fix = null)!!
        listOf("latitude", "longitude", "locationAccuracyMeters", "locationTimestamp").forEach {
            assertFalse("$it 가 실리면 안 된다", v.containsKey(it))
        }
    }

    @Test
    fun `신선도 - 유효기간 넘긴 fix 는 null (묵은 좌표 금지의 후반부)`() {
        val src = FakeLocationSource(maxAgeMs = 120_000)
        src.fix = LocationFix(35.1, 126.9, 8.0, atMs = 0)
        assertEquals(35.1, src.currentFix(nowMs = 120_000)!!.latitude, 0.0001)
        assertNull(src.currentFix(nowMs = 120_001))
    }
}
