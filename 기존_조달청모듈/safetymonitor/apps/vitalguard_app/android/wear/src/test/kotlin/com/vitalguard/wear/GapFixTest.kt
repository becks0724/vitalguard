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
        // ★ 양 끝을 함께 단언한다([[L-115]]③). 게이트가 **만들어지는가**만 보면
        //   전송 경로가 그것을 우회해도 초록불이다 — 실제로 그랬다(08-25).
        org.junit.Assert.assertTrue(
            "전송 경로가 게이트를 우회한다 — 벗어 둔 워치가 무동작 행을 올린다",
            engine.contains("stillSec = stillSecNow(nowMs)"),
        )
        org.junit.Assert.assertFalse(
            "flush 가 게이트 없는 motion.stillSec 을 직접 쓴다",
            engine.contains("stillSec = motion.stillSec("),
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
    fun `활동 권한이 선언돼 있다 - 없으면 콜백이 조용히 안 온다`() {
        // 08-25 실기: 걸었는데 활동 로그 0건. 예외도 로그도 없이 콜백만 안 왔다.
        val manifest = java.io.File("src/main/AndroidManifest.xml").readText()
        listOf(
            "android.permission.ACTIVITY_RECOGNITION",
            "android.permission.health.READ_STEPS",
        ).forEach { assertTrue("$it 누락", manifest.contains(it)) }
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

/** 화면 유지 — 워치 기본값(수 초 뒤 시계 복귀)을 막는다(08-25 사용자 요청). */
class KeepScreenOnTest {

    private val activity = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/MainActivity.kt",
    ).readText()
    private val manifest = java.io.File("src/main/AndroidManifest.xml").readText()

    @Test
    fun `화면 유지 플래그가 걸려 있다`() {
        assertTrue(
            "FLAG_KEEP_SCREEN_ON 없음 — 몇 초 뒤 시계 화면으로 돌아간다",
            activity.contains("FLAG_KEEP_SCREEN_ON"),
        )
    }

    @Test
    fun `WAKE_LOCK 권한이 선언돼 있다`() {
        assertTrue("WAKE_LOCK 누락", manifest.contains("android.permission.WAKE_LOCK"))
    }

    @Test
    fun `수집은 화면 플래그와 무관하다 - FGS 가 유지한다`() {
        // 화면이 꺼져도 수집은 계속돼야 한다(실측 ⑤에서 12.2분 무손실 확인).
        val service = java.io.File(
            "src/main/kotlin/com/vitalguard/wear/CollectorService.kt",
        ).readText()
        assertTrue("FGS 승격이 사라지면 화면 꺼짐에서 수집이 죽는다", service.contains("startForeground("))
        assertFalse("서비스가 화면 플래그에 의존하면 안 된다", service.contains("FLAG_KEEP_SCREEN_ON"))
    }
}

/** 발열 완화 — 08-25 실측(10분에 피부온 +2.3℃ · 주변 +2.5℃ · 배터리 15%) 후 조치. */
class Spo2RetryTest {

    private val src = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/source/SamsungTrackerSource.kt",
    ).readText()

    /**
     * ★ 08-25 실기 결함 — 연속 착용 35분에 SpO₂ 0건(서버 16행 전부 null).
     * 원인 = 주기 조건이 `spo2Tracker == null` 이라, 측정이 완료되지 않으면 트래커가
     * 계속 남아 **다음 주기가 통째로 건너뛰어졌다**. 시도가 앱 수명에 한 번뿐이었다.
     */
    @Test
    fun `실패한 시도가 다음 시도를 막지 않는다`() {
        assertFalse(
            "주기가 트래커 null 여부로 갈린다 — 실패하면 영영 다시 안 시도한다",
            src.contains("svc != null && spo2Tracker == null"),
        )
        assertTrue(
            "지난 시도를 걷어내는 경로가 없다",
            src.contains("if (spo2Tracker != null)") && src.contains("stopSpo2()"),
        )
    }

    /** 아직 한 번도 성공 못 했으면 짧게 다시 — 5분으로는 '가만히 있는 순간' 을 놓친다. */
    @Test
    fun `성공 전에는 짧게 재시도한다`() {
        val interval = 5 * 60_000L
        val retry = 2 * 60_000L
        assertEquals(
            retry,
            com.vitalguard.wear.source.SamsungTrackerSource.spo2NextDelayMs(0, interval, retry),
        )
        assertEquals(
            interval,
            com.vitalguard.wear.source.SamsungTrackerSource.spo2NextDelayMs(1, interval, retry),
        )
    }

    /**
     * ⚠ 실패에 채널이 있어야 한다([[L-112]]). 종전엔 상태가 **어디에도 안 남아**
     * "왜 안 오는가" 를 코드를 읽어야만 알 수 있었다.
     */
    @Test
    fun `측정 상태가 로그에 남는다`() {
        assertTrue("상태 로그가 없다", src.contains("SpO₂ 상태="))
        assertTrue("시도·성공 계수가 없다", src.contains("spo2Attempts") && src.contains("spo2Success"))
    }
}

class ThermalMitigationTest {

    private val activity = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/MainActivity.kt",
    ).readText()
    private val service = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/CollectorService.kt",
    ).readText()

    /**
     * ⚠ **08-25 저녁 사용자 재요청으로 뒤집힌 결정이다.**
     * 종전 계약은 "탭 후 30초만 유지" 였고, 근거는 실측이었다 —
     * 상시 유지 시 10분에 피부온 +2.33℃ · 주변온 +2.51℃ · 배터리 15%.
     * 사용자가 두 번 요청해 상시로 되돌렸다. 근거를 지우지 않고 **대가로 남긴다.**
     */
    @Test
    fun `화면은 앱이 앞에 있는 동안 켜져 있다 - 시계로 안 돌아간다`() {
        val onCreate = activity.substringAfter("override fun onCreate").substringBefore("setContent")
        assertTrue(
            "onCreate 에서 화면을 붙잡지 않는다 — 시계 화면으로 돌아간다",
            onCreate.contains("addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)"),
        )
    }

    /**
     * ★ 상시 유지를 **받아들일 수 있게 만든 조건** — 발열이 조용히 오염시키지 않는다.
     * 체온 상세가 피부온·주변온을 같은 축에 겹쳐 그리므로 두 선이 나란히 오르면
     * 기기 발열임을 눈으로 가른다(R-27). 이 판별 수단이 사라지면 상시 유지의 전제가 무너진다.
     */
    @Test
    fun `발열 판별 수단이 함께 있다 - 없으면 상시 유지의 전제가 무너진다`() {
        val detail = java.io.File(
            "src/main/kotlin/com/vitalguard/wear/ui/DetailPages.kt",
        ).readText()
        assertTrue(
            "주변온 겹치기가 없다 — 발열과 진짜 체온을 가를 수 없다",
            detail.contains("overlay = state.ambientTrend"),
        )
    }

    @Test
    fun `전송 주기가 늘어났다 - LTE 기상 횟수를 줄인다`() {
        assertEquals(
            "flush 가 60초로 되돌아가면 발열·배터리가 원상 복구된다",
            120_000L,
            com.vitalguard.wear.CollectorService.FLUSH_INTERVAL_MS,
        )
    }

    @Test
    fun `수집 자체는 안 줄인다 - 발열 완화가 데이터 결손이 되면 안 된다`() {
        // 센서를 끄는 게 아니라 처리·전송 빈도만 줄였다. FGS 와 착용 감지는 그대로다.
        assertTrue(service.contains("startForeground("))
        assertTrue(service.contains("OffBodySource"))
    }
}

/** 무동작 — 화면에서 내렸지만 수집·전송은 계속한다(08-25 사용자 결정). */
class StillSecStillCollectedTest {

    @Test
    fun `무동작이 여전히 전송된다 - 붕괴 판정은 서버가 한다`() {
        val builder = java.io.File(
            "src/main/kotlin/com/vitalguard/wear/pipeline/SampleBuilder.kt",
        ).readText()
        assertTrue(
            "motionStillSec 전송이 끊기면 서버가 붕괴(실신)를 못 본다",
            builder.contains("motionStillSec"),
        )
    }

    @Test
    fun `무동작 계산도 살아 있다`() {
        val engine = java.io.File(
            "src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt",
        ).readText()
        assertTrue("stillSec 계산이 사라졌다", engine.contains("stillSecNow"))
    }

    @Test
    fun `화면에서는 내려갔다`() {
        val screen = java.io.File(
            "src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt",
        ).readText()
        assertFalse("무동작 베젤이 되살아났다", screen.contains("stillTicks(state)"))
        // 우측은 08-25 에 걸음 → 스트레스로 바뀌었다. 무동작이 화면에 없다는 계약은 그대로다.
        assertTrue("우측 띠가 없다", screen.contains("stressBand(state)"))
    }
}

/** 세로 페이저 — 가로는 워치 뒤로가기와 충돌한다(08-25 사용자 결정 A안). */
class VerticalPagerTest {

    private val activity = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/MainActivity.kt",
    ).readText()
    private val summary = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt",
    ).readText()

    @Test
    fun `세로 페이저를 쓴다 - 가로는 앱이 닫힌다`() {
        assertTrue("VerticalPager 미사용", activity.contains("VerticalPager"))
        assertFalse(
            "가로 페이저는 워치 표준 뒤로가기 제스처와 충돌한다",
            activity.contains("HorizontalPager"),
        )
    }

    /**
     * ★ 08-25 사용자 보고 — 요약면에서 페이지 점이 **우측 걸음 눈금과 겹쳐** 둘 다 못 읽었다.
     * 요약에서는 감추고 상세면에서만 그린다.
     */
    @Test
    fun `요약면에서는 페이지 점을 감춘다 - 걸음 눈금과 자리가 겹친다`() {
        assertTrue(
            "페이지 인디케이터 조건이 없다",
            activity.contains("pagerState.currentPage != 0") &&
                activity.contains("VerticalPageIndicator"),
        )
    }

    @Test
    fun `요약이 0번이다 - 앱을 열면 한눈 화면이 먼저다`() {
        val body = activity.substringAfter("when (page)").substringBefore("}")
        assertTrue("0번이 요약이 아니다", body.contains("0 -> VitalScreen"))
    }

    @Test
    fun `스와이프 힌트가 있다 - 없으면 상세를 발견 못 한다`() {
        assertTrue("힌트 없음", summary.contains("SwipeHint"))
    }

    @Test
    fun `요약 화면에 앱 로고를 두지 않는다`() {
        // Wear 지침: 시스템이 앱 아이콘을 이미 보여주므로 화면 안 중복은 공간만 먹는다.
        assertFalse("로고가 되살아났다", summary.contains("R.drawable.ic_vitalguard"))
    }
}
