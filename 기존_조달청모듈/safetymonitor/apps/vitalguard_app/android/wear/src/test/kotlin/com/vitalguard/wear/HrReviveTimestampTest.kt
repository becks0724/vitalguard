// 심박 재구독 시각 가드 — 재구독이 일어난 사실이 서버까지 가는가(로그가 아니라 표본으로)
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.SampleBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **`reviveHrIfStalled` 가 돌면 그 시각이 표본에 실려 서버로 간다.**
 *
 * 왜 필요한가 — 08-28 실측. 갤럭시 워치는 하루 **17구간·2.4시간** 동안 착용 중인데 수집
 * tick 이 멈춘다(Doze · `CollectorService` 의 `:248` 주석이 예고한 그대로). 그 구간을 되살리는
 * 장치가 `reviveHrIfStalled` 인데, **DB 로는 그것이 돌았는지 알 길이 없다** — "돌고도 실패"와
 * "아예 안 돔"이 똑같이 *행이 없다* 로 보인다. 둘은 조치가 정반대다(전자는 재구독 방식을,
 * 후자는 워치독을 절전 밖으로).
 *
 * `hrRevives` 카운터는 로그로만 쓰여 os_log 를 떠야 읽히는데, 08-28 에 그 회수 경로가 막혔다
 * (무선 디버깅 미광고 · mDNS 통제군 29종 중 adb 계열 0). 그래서 시각을 표본에 싣는다.
 *
 * ⚠ **카운터가 아니라 시각인 이유** = 카운터는 프로세스가 죽으면 0 부터 다시 세어 재설치와
 *   구별이 안 된다(서버 스키마의 `sessionStartedAt` 주석이 같은 사유를 적어 뒀다).
 */
class HrReviveTimestampTest {
    private val service = uncommented(
        File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText(),
    )
    private val engine = uncommented(
        File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText(),
    )

    /** 서버 Zod 스키마의 필드명과 **글자 그대로** 같아야 한다 — 다르면 Zod 가 무음 strip 한다. */
    private val WIRE_KEY = "hrLastReviveAt"

    /** 멤버 하나의 본문만 잘라낸다 — 파일 어딘가에 있는 것과 **이 함수 안에 있는 것**은 다르다. */
    private fun memberBody(src: String, signature: String): String {
        val start = src.indexOf(signature)
        assertTrue("$signature 가 사라졌다", start >= 0)
        val rest = src.substring(start + signature.length)
        val end = listOf("private fun ", "override fun ", "private val ", "@Volatile")
            .mapNotNull { m -> rest.indexOf(m).takeIf { it >= 0 } }
            .minOrNull() ?: rest.length
        return rest.substring(0, end)
    }

    @Test
    fun `측정값이 있으면 재구독 시각을 함께 싣는다`() {
        val b = SampleBuilder()
        b.heartRate(96, 1_000L)
        val v = b.buildAndReset(sentAtMs = 2_000L, batteryPct = 84, hrLastReviveAtMs = 1_500L)!!
        assertEquals("1970-01-01T00:00:01.500Z", v[WIRE_KEY])
    }

    @Test
    fun `무동작 단독 전송에서도 함께 싣는다`() {
        // tick 이 멈추는 구간이 바로 이 경로다 — 여기서 빠지면 정작 필요한 창에서 값이 없다.
        val v = SampleBuilder().buildAndReset(
            sentAtMs = 2_000L, stillSec = 300.0, batteryPct = 84, hrLastReviveAtMs = 1_500L,
        )!!
        assertEquals("1970-01-01T00:00:01.500Z", v[WIRE_KEY])
    }

    @Test
    fun `한 번도 재구독이 없으면 키를 만들지 않는다`() {
        // 없음이 곧 "워치독이 안 돌았다" 는 지문이다. 0 으로 채우면 그 지문이 사라진다.
        val b = SampleBuilder()
        b.heartRate(96, 1_000L)
        val v = b.buildAndReset(sentAtMs = 2_000L, batteryPct = 84, hrLastReviveAtMs = null)!!
        assertFalse("없는 값을 키로 만들었다", v.containsKey(WIRE_KEY))
    }

    @Test
    fun `이것만으로는 행을 만들지 않는다`() {
        // 진단 필드가 빈 행을 늘리면 DB 가 진단 로그가 된다(배터리와 같은 규칙).
        assertNull(SampleBuilder().buildAndReset(sentAtMs = 2_000L, hrLastReviveAtMs = 1_500L))
    }

    // ── 배선 ────────────────────────────────────────────────────────────────
    // ⚠ 파일 어딘가에 이름이 있는 것으로는 부족하다 — 배선이 끊겨도 이름은 남는다([[L-123]]④).
    //   그래서 **그 함수 본문 안에** 있는지를 단언한다.

    @Test
    fun `재구독이 실제로 시각을 갱신한다`() {
        val body = memberBody(service, "private fun reviveHrIfStalled(")
        assertTrue(
            "reviveHrIfStalled 안에서 hrLastReviveAtMs 를 갱신하지 않는다 — " +
                "재구독은 도는데 서버는 영원히 모른다",
            Regex("""hrLastReviveAtMs\s*=\s*now""").containsMatchIn(body),
        )
    }

    @Test
    fun `엔진까지 배선돼 있다`() {
        assertTrue(
            "서비스가 엔진에 공급자를 안 넘긴다",
            Regex("""hrLastReviveAtMs\s*=\s*\{\s*hrLastReviveAtMs\s*\}""").containsMatchIn(service),
        )
        assertTrue(
            "엔진이 flush 에서 그 값을 안 읽는다",
            engine.contains("hrLastReviveAtMs = hrLastReviveAtMs()"),
        )
    }
}
