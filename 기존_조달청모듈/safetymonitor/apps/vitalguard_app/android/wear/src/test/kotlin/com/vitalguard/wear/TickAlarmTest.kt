// 전송 tick 가드 — 예약이 uptimeMillis 타이머가 아니라 CPU 를 깨우는 정확 알람이고, 같은 수집 스레드로 배달되는가
package com.vitalguard.wear

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **tick 은 `ELAPSED_REALTIME_WAKEUP` 알람으로 예약되고, `handler.postDelayed` 로 되돌아가지 않는다.**
 *
 * ★ 왜 필요한가 — 08-29 실측(R-32). 화면이 꺼지면 Wear OS 가 AP 를 suspend 하고 `uptimeMillis` 가 서서,
 *   `postDelayed(120s)` 가 3~14분이 됐다(간격 ≈ 120s ÷ CPU-awake 비율 · Doze 0건). 관제 150초 문턱을
 *   넘겨 하루 누적 `연결끊김` 32%. 주기를 줄여도 해결이 아니다(같은 시계면 15s 도 끊김 6%).
 * ★ 구조 검사인 이유 — 되돌아가는 방식은 값이 아니라 **API 선택**이다(둘 다 컴파일되고 둘 다 돈다).
 *   HrWatchdogTest 와 같은 수법으로 소스를 읽어 못 박는다.
 */
class TickAlarmTest {

    private fun src(rel: String): String {
        val f = listOf(rel, "wear/$rel").map(::File).firstOrNull { it.exists() }
            ?: throw AssertionError("$rel 를 못 찾았다 (작업디렉터리=${File(".").absolutePath})")
        return f.readText()
    }

    /** 주석을 걷어낸 본문 — 이름이 주석에만 남아도 통과하면 가드가 아니다. */
    private fun code(): String =
        src("src/main/kotlin/com/vitalguard/wear/CollectorService.kt")
            .replace(Regex("^\\s*(//|\\*|/\\*).*$", RegexOption.MULTILINE), "")

    @Test
    fun `tick 예약은 깨우는 정확 알람이다 - postDelayed 로 되돌아가면 소등 suspend 에서 다시 선다`() {
        val c = code()
        val sched = c.substringAfter("private fun scheduleTick()").substringBefore("\n    }")
        // ⚠ 호출마다 본다 — 변이 실측에서 setExact 의 WAKEUP 만 지우면 setWindow 의 문자열이 남아 통과했다.
        val calls = Regex("set(Exact|Window)\\(([^)]*)\\)").findAll(sched).toList()
        assertTrue("scheduleTick 에 setExact 가 없다", calls.any { it.groupValues[1] == "Exact" })
        assertTrue("정확 알람 권한이 없을 때의 후퇴(setWindow)가 없다 — SecurityException 으로 tick 이 통째로 죽는다",
            calls.any { it.groupValues[1] == "Window" })
        calls.forEach { m ->
            assertTrue("알람이 ELAPSED_REALTIME_WAKEUP 이 아니다 — RTC/비WAKEUP 은 CPU 를 안 깨운다: ${m.value}",
                m.groupValues[2].trimStart().startsWith("AlarmManager.ELAPSED_REALTIME_WAKEUP,"))
        }
        assertFalse("tick 이 아직 postDelayed 로 예약된다 — 08-29 이전 구조다",
            Regex("postDelayed\\((tick|this)\\b").containsMatchIn(c))
    }

    @Test
    fun `알람 리스너는 수집 스레드 handler 로 배달된다 - 큐·엔진 단일 스레드 계약`() {
        val c = code()
        val sched = c.substringAfter("private fun scheduleTick()").substringBefore("\n    }")
        // setExact(…, tickAlarm, handler) / setWindow(…, tickAlarm, handler) — 마지막 인자가 handler 여야 한다.
        Regex("set(Exact|Window)\\(([^)]*)\\)").findAll(sched).toList().also {
            assertTrue("알람 호출이 없다", it.isNotEmpty())
        }.forEach { m ->
            assertTrue("알람이 수집 스레드가 아닌 곳으로 배달된다: ${m.value}", m.groupValues[2].trim().endsWith("tickAlarm, handler"))
        }
        assertTrue("tick 말미가 scheduleTick 으로 다음을 예약하지 않는다",
            c.substringAfter("private val tick = object : Runnable").substringBefore("\n    }").contains("scheduleTick()"))
    }

    @Test
    fun `매니페스트에 정확 알람 권한 - 없으면 API31+ 에서 setExact 가 SecurityException`() {
        val m = src("src/main/AndroidManifest.xml")
        assertTrue("USE_EXACT_ALARM 누락", m.contains("android.permission.USE_EXACT_ALARM"))
        assertTrue("SCHEDULE_EXACT_ALARM(31~32) 누락", m.contains("android.permission.SCHEDULE_EXACT_ALARM"))
    }
}
