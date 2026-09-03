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
    fun `폴백만 구독하고 위성은 단발로 켠다`() {
        // ⚠ 09-01 실측이 이 계약을 바꿨다. 위성을 **구독**하면 GNSS 가 계속 켜져 있어
        //   실내 fix 0건 구간에서도 86% 가동, 소모 51 → 87.8 mAh/h(수명 9.3 → 5.4시간).
        //   그래서 폴백만 상시 구독하고 위성은 getCurrentLocation 단발로 켠다.
        val src = uncommented(
            File("src/main/kotlin/com/vitalguard/wear/source/GpsLocationSource.kt").readText(),
        )
        assertTrue(
            "실내 폴백 구독이 사라졌다 — 실내에서 좌표가 영영 안 온다(08-26 실측 0건)",
            src.contains("subscribe(fallback)"),
        )
        assertFalse(
            "위성을 구독으로 되돌렸다 — GNSS 가 계속 켜져 배터리가 71% 더 든다",
            src.contains("subscribe(LocationManager.GPS_PROVIDER)"),
        )
        assertTrue(
            "위성 단발 호출이 없다 — 되살린 정확도(82.6m → 13.4m)가 사라진다",
            src.contains("manager.getCurrentLocation(LocationManager.GPS_PROVIDER"),
        )
    }

    @Test
    fun `타임아웃 회수가 공유 핸들러를 통째로 지우지 않는다`() {
        // ⚠ handler 는 CollectorService 와 공유한다. removeCallbacksAndMessages(null) 로 싹 지우면
        //   tick 알람 콜백까지 날아가 수집이 조용히 멈춘다.
        val src = uncommented(
            File("src/main/kotlin/com/vitalguard/wear/source/GpsLocationSource.kt").readText(),
        )
        // ⚠ 낱말만 보면 KDoc 의 설명 문장까지 걸린다(uncommented 는 // 만 걷어낸다) — 호출 형태로 좁힌다.
        assertFalse("공유 핸들러를 통째로 비운다", src.contains("handler.removeCallbacksAndMessages"))
        assertTrue("내 타임아웃만 회수하지 않는다", src.contains("handler.removeCallbacks(it)"))
    }

    @Test
    fun `겹쳐 쏘지 않는다 - GNSS 가 꺼질 틈을 남긴다`() {
        // 요청이 떠 있는데 또 쏘면 상시 구독과 같아진다 — 이 게이트가 막으려던 바로 그 상태다.
        assertFalse(
            GpsLocationSource.shouldRequestSatellite(
                nowMs = 10_000L, nextAllowedAtMs = 0L, inFlight = true,
                movingNow = true, wasMoving = false,
            ),
        )
    }

    @Test
    fun `백오프 중에는 안 켜지만 이동을 시작하면 즉시 켠다`() {
        // 실내 = 실패 누적 → 간격을 벌린다. 실외로 나가는 순간이 곧 '이동 시작' 이다.
        assertFalse(
            "백오프 중에 켰다",
            GpsLocationSource.shouldRequestSatellite(1_000L, 600_000L, false, movingNow = false, wasMoving = false),
        )
        assertTrue(
            "정지→이동 전이인데도 백오프에 갇혔다 — 실외로 나가도 최대 15분 늦는다",
            GpsLocationSource.shouldRequestSatellite(1_000L, 600_000L, false, movingNow = true, wasMoving = false),
        )
        assertFalse(
            "이동이 **이어지는** 중인데 백오프를 뚫었다 — 09-03 결함 그 자체다",
            GpsLocationSource.shouldRequestSatellite(1_000L, 600_000L, false, movingNow = true, wasMoving = true),
        )
        assertTrue(
            "백오프가 끝났는데 안 켰다",
            GpsLocationSource.shouldRequestSatellite(600_000L, 600_000L, false, movingNow = false, wasMoving = false),
        )
    }

    @Test
    fun `이동이 이어져도 백오프는 상한까지 자란다`() {
        // ⚠⚠ 09-03 결함의 재발 방지. 고장은 함수 **안**이 아니라 두 조각의 **합성**에 있었다 —
        //   백오프 해제가 `movingNow` 였을 때 이동 중 매 tick 이 failures 를 지워
        //   backoffMs(1)=0 을 벗어나지 못했다. 그래서 여기서는 호출자의 순환을 그대로 돈다.
        //   순수 함수 단품 검사로는 원리적으로 안 걸리는 자리다.
        var failures = 0
        var nextAllowed = 0L
        var wasMoving = false
        var now = 0L
        var fired = 0
        repeat(20) {                                   // tick 20회 = 40분, 내내 이동 중 · 실내라 매번 실패
            val movingNow = true
            if (GpsLocationSource.shouldClearBackoff(movingNow, wasMoving, failures)) {
                failures = 0
                nextAllowed = 0L
            }
            val fire = GpsLocationSource.shouldRequestSatellite(
                now, nextAllowed, inFlight = false, movingNow = movingNow, wasMoving = wasMoving,
            )
            wasMoving = movingNow
            if (fire) {
                fired++
                failures++
                nextAllowed = now + GpsLocationSource.backoffMs(failures)
            }
            now += 120_000L
        }
        assertEquals(
            "백오프가 상한까지 자라지 않았다 — 이동 중 해제가 failures 를 계속 지우고 있다",
            15 * 60_000L,
            GpsLocationSource.backoffMs(failures),
        )
        assertTrue(
            "40분 동안 위성을 ${fired}번 켰다 — 백오프가 무력화됐다(정상은 6회 이하)",
            fired <= 6,
        )
    }

    @Test
    fun `벗은 뒤에는 위성을 켜지 않는다`() {
        // 09-03: tick 은 벗은 뒤에도 계속 도는데(큐 배출·자동 로그아웃) 위성 호출에만 착용 가드가
        // 없어 벗어 둔 워치가 120초마다 GNSS 를 켰다. 형제 호출 reviveHrIfStalled 는 갖고 있다.
        val service = uncommented(
            File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText(),
        )
        val tick = service.substringAfter("private val tick =").substringBefore("private fun uploadOnce")
        assertTrue(
            "tick 이 착용 여부와 무관하게 위성을 켠다 — 벗어 둔 워치가 계속 GNSS 를 태운다",
            Regex("""if\s*\(\s*sensing\s*\)\s*gps\.requestSatelliteFix\(""").containsMatchIn(tick),
        )
    }

    @Test
    fun `첫 실패는 다음 tick 에 바로 다시 본다`() {
        // 잠깐 처마 밑이었을 수 있다 — 한 번 실패했다고 5분을 쉬면 실외에서도 위치가 끊긴다.
        assertEquals(0L, GpsLocationSource.backoffMs(1))
        assertEquals(5 * 60_000L, GpsLocationSource.backoffMs(2))
        assertEquals(10 * 60_000L, GpsLocationSource.backoffMs(3))
        assertEquals(15 * 60_000L, GpsLocationSource.backoffMs(4))
        assertEquals("상한이 없다 — 영영 안 켜질 수 있다", 15 * 60_000L, GpsLocationSource.backoffMs(99))
    }

    @Test
    fun `움직임 문턱은 실측에서 왔고 tick 이 위성을 부른다`() {
        // 09-01 워치9 실측(DB motion_var_mg): 실내 착석·손동작 1~78 · 실외 보행 166~212.
        assertEquals(100, CollectorService.MOVING_VAR_MG)
        val service = uncommented(
            File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText(),
        )
        val tick = service.substringAfter("private val tick =").substringBefore("private fun uploadOnce")
        assertTrue("tick 이 위성 단발을 안 부른다", tick.contains("gps.requestSatelliteFix("))
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
