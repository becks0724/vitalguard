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

/** 착용 자동 수집 — 시작 버튼 없는 운용의 계약(08-25 사용자 결정). */
class WearDetectTest {

    private val screen = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt",
    ).readText()
    private val activity = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/MainActivity.kt",
    ).readText()
    private val service = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/CollectorService.kt",
    ).readText()

    @Test
    fun `작업자 화면에 시작·중지 버튼이 없다`() {
        // 버튼을 되살리면 7번째 요소가 되어 다시 화면 밖으로 밀린다(08-25 실기 증상).
        assertFalse("시작 버튼이 되살아났다", screen.contains("\"시작\""))
        assertFalse("중지 버튼이 되살아났다", screen.contains("\"중지\""))
    }

    @Test
    fun `앱이 뜨면 수집 서비스가 스스로 붙는다`() {
        assertTrue(
            "자동 기동이 사라졌다 — 사람이 켤 수단이 없어 수집이 영영 안 된다",
            activity.contains("startForegroundService(Intent(this, CollectorService::class.java))"),
        )
    }

    @Test
    fun `착용 센서가 수집을 켜고 끈다`() {
        assertTrue("착용 소스 배선 없음", service.contains("OffBodySource"))
        assertTrue("착용 콜백 없음", service.contains("beginSensing"))
        assertTrue("벗음 콜백 없음", service.contains("endSensing"))
    }

    @Test
    fun `벗어도 큐는 지우지 않는다 - 다시 차면 함께 올라간다`() {
        val end = service.substringAfter("private fun endSensing()").substringBefore("\n    }")
        assertFalse("벗음에서 큐를 비우면 미전송분이 사라진다", end.contains("queue.removeFirst"))
        assertFalse("벗음에서 서비스를 죽이면 재개가 안 된다", end.contains("stopSelf"))
    }
}

/** 벗은 뒤 잔존값 차단 — 08-25 실기에서 체온 37.8℃ 가 화면에 남아 있었다. */
class StaleOnUnwearTest {

    private val engine = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt",
    ).readText()
    private val service = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/CollectorService.kt",
    ).readText()
    private val activity = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/MainActivity.kt",
    ).readText()

    @Test
    fun `엔진 stop 이 표시용 스냅숏을 비운다`() {
        val stop = engine.substringAfter("fun stop()").substringBefore("\n    }")
        listOf("lastBpm = null", "lastSpo2 = null", "lastSkinTempC = null", "lastHrvMs = null")
            .forEach { assertTrue("stop() 에 $it 없음 — 옛 값이 현재값처럼 남는다", stop.contains(it)) }
    }

    @Test
    fun `벗으면 무동작이 멈춘다 - 계속 늘면 쓰러진 것으로 오독된다`() {
        assertTrue(
            "motionStopped 게이트 없음",
            engine.contains("if (motionStopped) null else motion.stillSec"),
        )
    }

    @Test
    fun `화면은 서비스 생존이 아니라 실제 수집 여부를 본다`() {
        assertTrue("collecting 상태 노출 없음", service.contains("var collecting = false"))
        assertTrue(
            "화면이 running 을 수집으로 읽고 있다",
            activity.contains("CollectorService.collecting"),
        )
    }

    @Test
    fun `재착용 시 IBI 창을 비운다 - 끊긴 구간을 이어 붙이면 SDNN 이 왜곡된다`() {
        // 08-25 실기: 재착용 직후 HRV 402ms(정상 20~100). 구간이 벌어진 표본이 섞였다.
        val start = engine.substringAfter("fun start(nowMs: Long)").substringBefore("\n    }")
        assertTrue("start 에서 IBI 창을 안 비운다", start.contains("ibiWindow.clear"))
    }
}

/** 활동 3종 수집 — 스트레스 지수·작업게이트의 재료(08-25 선행 작업). */
class ActivityCollectionTest {

    private val service = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/CollectorService.kt",
    ).readText()
    private val engine = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt",
    ).readText()
    private val source = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/source/ActivitySource.kt",
    ).readText()

    @Test
    fun `활동 소스가 배선돼 있다 - API 만 있고 호출부가 없던 상태를 막는다`() {
        // 08-25 실측: SampleBuilder 에 addSteps/addFlights/addEnergyKcal 이 있는데 호출 0건이었다.
        assertTrue("ActivitySource 미배선", service.contains("ActivitySource(this)"))
        assertTrue("addSteps 호출 없음", engine.contains("builder.addSteps"))
        assertTrue("addFlights 호출 없음", engine.contains("builder.addFlights"))
        assertTrue("addEnergyKcal 호출 없음", engine.contains("builder.addEnergyKcal"))
    }

    @Test
    fun `구간 증분 타입을 쓴다 - 누적을 보내면 서버 상한에서 스트립된다`() {
        // STEPS(Delta) 이지 STEPS_TOTAL(누적) 이 아니다.
        // ⚠ 주석에도 상수 이름이 나오므로 **코드 줄만** 본다 — 안 그러면 설명문이 시험을 깨뜨린다.
        val code = source.lines()
            .filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") }
            .joinToString("\n")
        assertTrue("STEPS 미사용", code.contains("DataType.STEPS"))
        listOf("STEPS_TOTAL", "FLOORS_TOTAL", "CALORIES_TOTAL").forEach {
            assertFalse("누적 타입 $it 을 쓰고 있다", code.contains("DataType.$it"))
        }
    }

    @Test
    fun `권한 상실을 삼키지 않는다`() {
        assertTrue("onPermissionLost 미구현", source.contains("onPermissionLost"))
    }

    @Test
    fun `승인 불필요 경로다 - 삼성 SDK 에 의존하지 않는다`() {
        // Health Services 는 파트너 승인이 필요 없다(실측 ④). 삼성이 막혀도 활동은 온다.
        assertTrue("Health Services 미사용", source.contains("HealthServices.getClient"))
        assertFalse("삼성 SDK 에 의존한다", source.contains("com.samsung"))
    }
}
