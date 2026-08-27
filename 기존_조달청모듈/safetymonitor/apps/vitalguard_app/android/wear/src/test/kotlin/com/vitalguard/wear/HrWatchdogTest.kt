// 심박 감시 가드 — 되살리기가 tick 하나에만 매달려 있지 않은가(절전에서 함께 죽지 않는가)
package com.vitalguard.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **심박 되살리기가 `tick` 말고도 부를 길이 있고, 그 길의 시계가 절전에서 안 멈춘다.**
 *
 * ★ 왜 필요한가 — 08-27 실측. EMP-admin3470 워치에서 심박이 **6,132초(1.7시간)** 끊겼는데
 *   재구독이 한 번도 안 돌았다. 300초면 돌았어야 한다. 원인은 순환이었다 —
 *   `reviveHrIfStalled` 가 `tick` 안에서만 불리는데, `tick` 은 `handler.postDelayed`
 *   (=`uptimeMillis` 기준)로 도니 **CPU 가 절전에 들면 같이 멈춘다.** 심박이 죽는 상황과
 *   되살리는 장치가 죽는 상황이 같은 상황이었다.
 *
 * ★ 이 시험이 값 검사가 아니라 **구조 검사**인 이유 — 되돌아가는 방식이 "값이 틀리는" 게 아니라
 *   "호출 지점이 하나로 줄어드는" 것이다. 그건 어떤 단위시험도 안 잡는다(둘 다 컴파일되고
 *   둘 다 통과한다). 그래서 소스를 읽어 호출 지점 수와 시계 종류를 못 박는다.
 */
class HrWatchdogTest {

    private fun serviceSrc(): String {
        val candidates = listOf(
            "src/main/kotlin/com/vitalguard/wear/CollectorService.kt",
            "wear/src/main/kotlin/com/vitalguard/wear/CollectorService.kt",
        ).map(::File)
        val f = candidates.firstOrNull { it.exists() }
            ?: throw AssertionError(
                "CollectorService.kt 를 못 찾았다 (작업디렉터리=${File(".").absolutePath}) — " +
                    "못 읽으면 이 시험은 아무것도 보장하지 않는다")
        return f.readText()
    }

    /** 주석을 걷어낸 본문. 이름이 주석에만 남아도 통과하면 가드가 아니다. */
    private fun code(): String =
        serviceSrc().replace(Regex("^\\s*(//|\\*|/\\*).*$", RegexOption.MULTILINE), "")

    @Test
    fun `IMU 배선이 감시를 실제로 부른다 — 함수만 있고 안 부르면 죽은 코드다`() {
        // ⚠ 첫 판에서 나는 `reviveHrIfStalled(` 등장 횟수를 셌다. **그건 가드가 아니었다** —
        //   IMU 콜백에서 호출을 지워도 `watchdogFromImu` 함수 안의 호출이 남아 개수가 같았다.
        //   함수가 죽은 코드가 돼도 초록이었다(변이로 확인). 세야 하는 것은 **배선**이다.
        val c = code()
        val at = c.indexOf("imu.start {")
        assertTrue("imu.start 배선이 없다 — IMU 를 시계로 쓰는 경로가 사라졌다", at >= 0)
        val block = c.substring(at, minOf(c.length, c.indexOf("\n        }", at) + 10))
        assertTrue(
            "IMU 배선이 watchdogFromImu 를 안 부른다 — tick 에만 매달린 08-27 이전 구조다.\n배선=$block",
            block.contains("watchdogFromImu()"),
        )
        // tick 쪽 호출도 남아 있어야 한다(ML 이 꺼지면 그쪽이 유일한 경로다).
        val tick = c.substringAfter("private val tick = object : Runnable").substringBefore("\n    }")
        assertTrue(
            "tick 의 되살리기 호출이 사라졌다 — ML 을 끄면 감시가 통째로 없어진다",
            tick.contains("reviveHrIfStalled("),
        )
    }

    @Test
    fun `감시 경로의 시계가 elapsedRealtime 이다 — uptimeMillis 면 같은 병을 옮겨 온다`() {
        val c = code()
        assertTrue(
            "watchdogFromImu 가 없다 — IMU 를 시계로 쓰는 경로가 사라졌다",
            c.contains("fun watchdogFromImu"),
        )
        // ★ 이 시험의 요지. postDelayed 가 멎는 이유가 uptime 기준이라는 것이고,
        //   감시가 같은 시계를 쓰면 고친 것이 없다.
        val fn = c.substringAfter("fun watchdogFromImu").substringBefore("\n    }")
        assertTrue(
            "감시가 elapsedRealtime 을 안 쓴다 — 절전에서 멈추는 시계로는 이 수리가 성립 안 한다",
            fn.contains("elapsedRealtime"),
        )
        assertFalse(
            "감시가 uptimeMillis 를 쓴다 — 고치려던 그 병이다",
            fn.contains("uptimeMillis"),
        )
    }

    @Test
    fun `재구독은 IMU 스레드가 아니라 수집 스레드에서 한다`() {
        // engine.stop()/start() 를 IMU 콜백에서 직접 부르면 flush 와 순서가 엉킨다.
        val fn = code().substringAfter("fun watchdogFromImu").substringBefore("\n    }")
        assertTrue(
            "감시가 handler.post 로 넘기지 않는다 — IMU 스레드에서 직접 재구독하면 flush 와 겹친다",
            fn.contains("handler.post"),
        )
        assertFalse(
            "감시가 engine 을 직접 만진다 — 수집 스레드로 넘겨야 한다",
            fn.contains("engine."),
        )
    }

    @Test
    fun `검사 주기가 침묵 문턱보다 충분히 짧다`() {
        // 30초 검사 · 300초 문턱 — 감지가 늦어지는 몫은 최대 검사주기 하나다.
        assertTrue(
            "검사 주기가 문턱의 절반을 넘는다 — 감지 지연이 문턱만큼 커진다",
            CollectorService.STALL_CHECK_MS * 2 <= CollectorService.HR_STALL_MS,
        )
    }

    @Test
    fun `첫 검사는 즉시 통과한다 — 착용 직후를 건너뛰지 않는다`() {
        assertTrue("첫 호출(last=0)이 막히면 착용 직후 침묵을 영영 못 본다",
            CollectorService.shouldCheckStall(1_000L, 0L))
    }

    @Test
    fun `주기 안에서는 다시 검사하지 않는다 — 59Hz 를 그대로 흘리면 초당 60번 post 한다`() {
        val last = 1_000_000L
        assertFalse(CollectorService.shouldCheckStall(last + 1, last))
        assertFalse(CollectorService.shouldCheckStall(last + CollectorService.STALL_CHECK_MS - 1, last))
        assertTrue(CollectorService.shouldCheckStall(last + CollectorService.STALL_CHECK_MS, last))
        assertEquals(30_000L, CollectorService.STALL_CHECK_MS)
    }
}
