// 심박 스트림 사망 가드 — 죽은 걸 앱이 알아채고, 화면이 낡은 값을 현재값처럼 말하지 않는가
package com.vitalguard.wear

import com.vitalguard.wear.core.CoreTempKalman
import com.vitalguard.wear.core.HrSample
import com.vitalguard.wear.ui.VitalUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **심박이 끊기면 앱이 알아채고 화면이 그 사실을 말한다.**
 *
 * 08-26 실기 사고. 심박이 12:22:30 을 끝으로 **28분간** 한 건도 안 왔는데
 *  · 앱은 `collecting=true` 였고
 *  · 화면엔 마지막 값 `101` 이 그대로 남아 있었고(3분 관찰 표본 14개 전부 동일)
 *  · 서버만 옳게 "연결끊김" 을 냈다.
 * SpO₂ 에는 `lastSpo2AtMs` 로 있던 장치가 심박엔 아예 없었던 것이 원인이다.
 *
 * ⚠ 표시 문제가 아니라 안전 문제다 — 심박이 끊긴 것을 앱이 모르면
 * **쓰러진 작업자와 센서 고장을 구별할 수 없다.**
 */
class HrStallTest {
    private val engine = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText())
    private val service = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText())
    private val screen = uncommented(File("src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt").readText())
    private val pages = uncommented(File("src/main/kotlin/com/vitalguard/wear/ui/DetailPages.kt").readText())

    @Test
    fun `심박 도착 시각을 기록한다`() {
        // 이게 없으면 "언제 잰 값인가" 를 아무도 모른다 — 사고의 뿌리였다.
        assertTrue("lastBpmAtMs 필드가 없다", engine.contains("var lastBpmAtMs: Long?"))
        assertTrue("도착 시각을 안 적는다", engine.contains("lastBpmAtMs = atMs"))
    }

    @Test
    fun `한 건도 못 받아도 침묵을 잰다`() {
        // 시작 직후 트래커가 아예 안 붙는 경우 — lastBpmAtMs 가 null 이라 그것만 보면 영영 못 잡는다.
        assertTrue("start 시각을 안 든다", engine.contains("sensingSinceMs"))
        assertTrue(
            "한 건도 못 받은 경우로 폴백하지 않는다",
            engine.contains("lastBpmAtMs ?: sensingSinceMs"),
        )
    }

    @Test
    fun `벗은 상태의 침묵은 고장이 아니다`() {
        // stop() 이 두 시각을 다 비우므로 hrSilenceMs 가 null 을 낸다 → 재구독이 안 돈다.
        val body = engine.substringAfter("fun stop()").substringBefore("\n    }")
        assertTrue("stop 이 sensingSinceMs 를 안 비운다", body.contains("sensingSinceMs = null"))
        assertTrue("stop 이 lastBpmAtMs 를 안 비운다", body.contains("lastBpmAtMs = null"))
        assertTrue("수집 중이 아니면 재구독을 건너뛰지 않는다", service.contains("if (!sensing) return"))
    }

    @Test
    fun `침묵이 길면 트래커를 재구독한다`() {
        assertTrue("되살리기 호출이 tick 에 없다", service.contains("reviveHrIfStalled(now)"))
        val body = service.substringAfter("private fun reviveHrIfStalled").substringBefore("\n    }")
        assertTrue("문턱 비교가 없다", body.contains("silence < HR_STALL_MS"))
        assertTrue("재구독이 아니라 다른 것을 한다", body.contains("engine.stop()") && body.contains("engine.start(now)"))
        // 몇 번째 되살림인지 남겨야 "계속 죽는 중" 을 다음 사람이 본다.
        assertTrue("재구독을 로그로 안 남긴다", body.contains("Log.w"))
    }

    @Test
    fun `재구독 문턱이 정상 도착 간격 위에 있다`() {
        // 실측 p90 = 209.2초. 그 아래면 정상 동작에 재구독이 튀어 센서를 계속 흔든다.
        assertTrue(service.contains("HR_STALL_MS = 300_000L"))
        assertTrue("문턱이 p90(209초) 아래로 내려갔다", CollectorService.HR_STALL_MS > 209_200L)
    }

    @Test
    fun `낡음 판정을 서버와 같은 시점에 한다`() {
        // 어긋나면 "워치는 멀쩡한데 관제만 끊김" 이라는 오해가 다시 생긴다.
        assertEquals("서버 STALE_MS_WEAROS 와 달라졌다", 150_000L, CollectorService.HR_STALE_MS)
        assertTrue(CollectorService.HR_STALE_MS < CollectorService.HR_STALL_MS)
    }

    @Test
    fun `화면이 낡은 심박을 낡았다고 말한다`() {
        val fresh = VitalUiState(bpm = 96, bpmAgeSec = 30, bpmRange = 90 to 100)
        val stale = VitalUiState(bpm = 96, bpmAgeSec = 600, bpmRange = 90 to 100)
        assertFalse("30초 된 값을 낡았다고 한다", fresh.bpmStale)
        assertTrue("10분 된 값을 신선하다고 한다", stale.bpmStale)
        // 경계 — 150초는 낡음에 포함(서버가 그 시점에 연결끊김을 낸다).
        assertTrue(VitalUiState(bpmAgeSec = 150).bpmStale)
        assertFalse(VitalUiState(bpmAgeSec = 149).bpmStale)
        // 측정이 없으면 낡은 것이 아니다(0 과 구분).
        assertFalse("미측정을 낡음으로 만든다", VitalUiState(bpmAgeSec = null).bpmStale)
    }

    @Test
    fun `심박이 끊기면 심부체온 추정도 함께 멈춘다`() {
        // ⚠ 창(180분)에 옛 표본이 남아 estimate() 는 최대 3시간 더 값을 낸다.
        //   30분 전 심박에서 나온 체온으로 지금을 판정하면 안 된다.
        val t0 = 1_700_000_000_000L
        val pts = (0 until 40).map { HrSample(t0 + it * 60_000L, 95) }
        val lastMs = t0 + 39 * 60_000L
        val max = CollectorService.HR_STALL_MS

        // 방금 받은 상태 — 값이 나온다(양성 통제군: 게이트가 전부를 막는 게 아니다)
        assertTrue(CoreTempKalman.estimateFresh(pts, lastMs + 1_000L, max) != null)
        // 문턱을 넘게 늙으면 멈춘다
        assertNull(
            "심박이 끊겼는데 추정이 계속 나온다",
            CoreTempKalman.estimateFresh(pts, lastMs + max + 120_000L, max),
        )
        // 게이트 없는 원본은 여전히 값을 낸다 — 즉 막는 주체가 게이트임을 못 박는다
        assertTrue("게이트가 없으면 값이 나오는 상황이 맞는지", CoreTempKalman.estimate(pts) != null)
    }

    @Test
    fun `화면이 게이트 친 추정치를 쓴다`() {
        val activity = uncommented(File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText())
        assertTrue("게이트 없는 estimate 를 그대로 쓴다", activity.contains("CoreTempKalman.estimateFresh("))
        assertFalse(
            "화면이 게이트 없는 경로로 되돌아갔다",
            Regex("""coreTempC = [^\n]*CoreTempKalman\.estimate\(""").containsMatchIn(activity),
        )
        // ★ 게이트만 두고 문턱을 크게 주면 무력화된다 — 인자까지 못 박는다.
        //   (08-26 변이 시험에서 문턱을 99_999_999L 로 바꾼 변이가 그대로 통과했다.)
        assertTrue(
            "게이트 문턱이 재구독 문턱(HR_STALL_MS)과 다르다 — 두 수가 갈리면 게이트가 헐거워진다",
            activity.contains("it, now, CollectorService.HR_STALL_MS,"),
        )
    }

    @Test
    fun `낡으면 범위 대신 나이를 보여준다`() {
        // 범위("90-100")는 "지금 이 정도" 라는 뜻이라 낡은 값 옆에 두면 거짓말이 한 겹 더 붙는다.
        assertTrue("요약이 낡음을 안 가른다", screen.contains("if (state.bpmStale)"))
        assertTrue("낡았을 때 나이를 안 보여준다", screen.contains("ageLabel(it)"))
        assertTrue("상세에 마지막 측정 행이 없다", pages.contains("\"마지막 측정\", ageLabel(it)"))
    }
}
