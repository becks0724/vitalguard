// 칼만 이식 대조 — 원본 TS(analyzers/core-temp-estimator)를 실제로 돌려 얻은 값과 숫자로 맞춘다
package com.vitalguard.wear

import com.vitalguard.wear.core.CoreTempKalman
import com.vitalguard.wear.core.HrSample
import com.vitalguard.wear.core.Psi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 골든 마스터. 값은 **원본 TS 를 그대로 실행해서** 받아 적었다(추정·손계산 아님).
 *   `node -e "import('.../dist/core-temp-estimator.js')…"` · 2026-08-26.
 * 이식본이 원본과 갈라지면 여기서 즉시 빨간불이 된다 — 이식의 유일한 성공 기준이다.
 */
class CoreTempKalmanGoldenTest {
    private val t0 = 1_700_000_000_000L
    private fun min(m: Long) = t0 + m * 60_000L
    private val eps = 1e-9

    private fun rising() = (0 until 40).map { HrSample(min(it.toLong()), 80 + it) }
    private fun warmupShort() = (0 until 29).map { HrSample(min(it.toLong()), 95) }
    private fun galaxy2min() = (0 until 40).map { HrSample(min(it * 2L), 90 + (it % 7)) }
    private fun sessionGap() =
        (0 until 35).map { HrSample(min(it.toLong()), 110) } +
            (0 until 35).map { HrSample(min(35L + 61L + it), 85) }
    private fun dirty() = (0 until 35).flatMap {
        listOf(
            HrSample(min(it.toLong()), 100),
            HrSample(min(it.toLong()) + 20_000L, 110),   // 같은 분 → 평균 105
            HrSample(min(it.toLong()) + 40_000L, 250),   // 범위 밖 → 버림
        )
    }

    @Test
    fun `상승 심박 - 원본과 같은 궤적`() {
        val s = CoreTempKalman.estimateSeries(rising())
        assertEquals(11, s.size)
        assertEquals(37.330040862048854, s.first().tempC, eps)
        assertEquals(37.51678329252972, s.last().tempC, eps)
        assertEquals(37.51678329252972, CoreTempKalman.estimate(rising())!!, eps)
    }

    @Test
    fun `워밍업 미달이면 값을 내지 않는다`() {
        // 29버킷 = 임계 30 바로 아래. 안 보이는 것이 정직하다(초기값 편향 구간).
        assertEquals(0, CoreTempKalman.estimateSeries(warmupShort()).size)
        assertNull(CoreTempKalman.estimate(warmupShort()))
    }

    @Test
    fun `갤럭시 2분 간격 - 원본과 같은 궤적`() {
        // ⚠ 갤럭시 심박은 약 2분 간격(실측 중앙값 120.7초)이라 버킷 30개에 약 60분이 걸린다.
        val s = CoreTempKalman.estimateSeries(galaxy2min())
        assertEquals(11, s.size)
        assertEquals(37.27179909695995, s.first().tempC, eps)
        assertEquals(37.29790819786458, s.last().tempC, eps)
    }

    @Test
    fun `61분 공백에서 세션이 끊기고 필터가 리셋된다`() {
        val s = CoreTempKalman.estimateSeries(sessionGap())
        assertEquals("두 세션이 각각 워밍업을 다시 해야 12점이다", 12, s.size)
        assertEquals(37.46404579883017, s.first().tempC, eps)
        assertEquals(37.13925366086573, s.last().tempC, eps)
    }

    @Test
    fun `오측은 버리고 같은 분은 평균한다`() {
        val s = CoreTempKalman.estimateSeries(dirty())
        assertEquals(6, s.size)
        assertEquals(37.396729057660245, s.first().tempC, eps)
        assertEquals(37.439178074607675, s.last().tempC, eps)
    }

    @Test
    fun `입력이 비면 값이 없다`() {
        assertNull(CoreTempKalman.estimate(emptyList()))
        assertEquals(CoreTempKalman.MIN_BUCKETS, CoreTempKalman.bucketsRemaining(emptyList()))
    }

    @Test
    fun `남은 버킷 수가 워밍업을 정확히 센다`() {
        assertEquals(1, CoreTempKalman.bucketsRemaining(warmupShort()))
        assertEquals(0, CoreTempKalman.bucketsRemaining(rising()))
        // 범위 밖 심박은 버킷으로 안 센다 — 안 그러면 오측으로 워밍업이 채워진다.
        val junk = (0 until 40).map { HrSample(min(it.toLong()), 250) }
        assertEquals(CoreTempKalman.MIN_BUCKETS, CoreTempKalman.bucketsRemaining(junk))
    }
}

/**
 * 배선 가드. 한 문장 보장 = **화면과 PSI 의 심부체온이 피부온이 아니라 심박에서 온다.**
 * 이게 깨지면 기기 발열([[R-25]])이 다시 체온·PSI 로 흘러든다.
 */
class CoreTempWiringTest {
    private val state = File("src/main/kotlin/com/vitalguard/wear/ui/VitalUiState.kt").readText()
    private val activity = File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText()
    private val pages = File("src/main/kotlin/com/vitalguard/wear/ui/DetailPages.kt").readText()
    private val engine = File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText()

    @Test
    fun `심부체온이 피부온에서 파생되지 않는다`() {
        assertFalse(
            "coreTempC 가 다시 피부온 오프셋으로 돌아갔다 — 기기 발열이 그대로 실린다",
            uncommented(state).contains("estimateCoreTempC"),
        )
        assertTrue(
            "coreTempC 가 상태 필드가 아니다",
            state.contains("val coreTempC: Double? = null,"),
        )
    }

    @Test
    fun `화면이 칼만으로 심부체온을 채운다`() {
        val a = uncommented(activity)
        assertTrue("칼만 추정 호출이 없다", a.contains("CoreTempKalman.estimate("))
        assertTrue("워밍업 표시용 잔여 버킷을 안 넘긴다", a.contains("CoreTempKalman.bucketsRemaining("))
    }

    @Test
    fun `칼만 입력은 솎지 않은 심박이다`() {
        // MetricHistory 는 봉우리 보존으로 솎아낸다 — 칼만은 1분 **평균**을 요구하므로 못 쓴다.
        val e = uncommented(engine)
        assertTrue("칼만용 심박 원본 버퍼가 없다", e.contains("hrLog"))
        assertTrue("화면에 넘길 스냅샷이 없다", e.contains("fun hrSamples()"))
        assertFalse(
            "칼만이 솎인 heartHistory 를 먹고 있다",
            Regex("""CoreTempKalman\.\w+\(\s*heartHistory""").containsMatchIn(e),
        )
    }

    @Test
    fun `체온 상세에 심부 추정이 보인다`() {
        assertTrue("심부(추정) 행이 없다", pages.contains("\"심부(추정)\""))
        assertTrue("워밍업 중 안내가 없다", pages.contains("coreWarmupBuckets"))
    }

    @Test
    fun `CT0 를 두 곳에 적지 않는다`() {
        // 숫자가 두 곳에 있으면 한쪽만 고쳐진 채 남는다([[L-106]] 상수 표류).
        assertEquals(CoreTempKalman.CT0, Psi.CT0, 0.0)
        val psi = File("src/main/kotlin/com/vitalguard/wear/core/Psi.kt").readText()
        assertTrue("Psi 가 CT0 를 직접 적고 있다", psi.contains("const val CT0 = CoreTempKalman.CT0"))
    }

    @Test
    fun `PSI 가 칼만 심부체온을 먹는다`() {
        // PSI 는 표시 항목(생리적부담)이라 오염된 체온이 들어가면 그대로 화면에 뜬다.
        assertTrue(
            "PSI 입력이 coreTempC 가 아니다",
            uncommented(state).contains("Psi.compute(coreTempC, bpm)"),
        )
    }
}
