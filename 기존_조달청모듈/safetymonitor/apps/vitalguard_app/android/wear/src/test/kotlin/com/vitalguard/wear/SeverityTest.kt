// 워치 판정이 관제웹과 같은 답을 내는지 — 임계 경계마다 못을 박는다(화면과 관제가 다른 말을 하면 안 된다)
package com.vitalguard.wear

import com.vitalguard.wear.core.Severity
import com.vitalguard.wear.core.coreTempSeverity
import com.vitalguard.wear.core.estimateCoreTempC
import com.vitalguard.wear.core.heartRateSeverity
import com.vitalguard.wear.core.overallSeverity
import com.vitalguard.wear.core.spo2Severity
import com.vitalguard.wear.ui.VitalUiState
import org.junit.Assert.assertEquals
import org.junit.Test

class SeverityTest {

    @Test
    fun `심박 경계 - 서버 severity_ts 와 같은 값`() {
        // danger ≥130 · ≤40 / caution 110~129 · 41~50 (안정 임계)
        assertEquals(Severity.DANGER, heartRateSeverity(130))
        assertEquals(Severity.CAUTION, heartRateSeverity(129))
        assertEquals(Severity.CAUTION, heartRateSeverity(110))
        assertEquals(Severity.NORMAL, heartRateSeverity(109))
        assertEquals(Severity.NORMAL, heartRateSeverity(51))
        assertEquals(Severity.CAUTION, heartRateSeverity(50))
        assertEquals(Severity.CAUTION, heartRateSeverity(41))
        assertEquals(Severity.DANGER, heartRateSeverity(40))
        assertEquals(Severity.IDLE, heartRateSeverity(null))
    }

    @Test
    fun `SpO2 경계 - danger 88 미만 caution 92 미만`() {
        assertEquals(Severity.DANGER, spo2Severity(87))
        assertEquals(Severity.CAUTION, spo2Severity(88))
        assertEquals(Severity.CAUTION, spo2Severity(91))
        assertEquals(Severity.NORMAL, spo2Severity(92))
        assertEquals(Severity.IDLE, spo2Severity(null))
    }

    @Test
    fun `피부온 판정 - 실측을 변환 없이 그대로 본다(C안)`() {
        assertEquals(Severity.NORMAL, com.vitalguard.wear.core.skinTempSeverity(37.9))
        assertEquals(Severity.CAUTION, com.vitalguard.wear.core.skinTempSeverity(38.0))
        assertEquals(Severity.CAUTION, com.vitalguard.wear.core.skinTempSeverity(38.4))
        assertEquals(Severity.DANGER, com.vitalguard.wear.core.skinTempSeverity(38.5))
        assertEquals(Severity.IDLE, com.vitalguard.wear.core.skinTempSeverity(null))
    }

    @Test
    fun `심부 임계는 서버 대조용으로 남는다 - 화면은 안 쓴다`() {
        // 서버(심박+칼만)와 값이 갈리는지 볼 때 필요해 보존한다.
        assertEquals(37.5, com.vitalguard.wear.core.Thresholds.CORE_TEMP_CAUTION_C, 0.0001)
        assertEquals(38.0, com.vitalguard.wear.core.Thresholds.CORE_TEMP_DANGER_C, 0.0001)
    }

    @Test
    fun `화면 전체 상태는 가장 나쁜 지표를 따른다`() {
        val s = VitalUiState(bpm = 80, spo2 = 86, skinTempC = 37.0, collecting = true)
        assertEquals("SpO₂ 하나가 위험이면 화면은 위험", Severity.DANGER, s.severity)
    }

    @Test
    fun `수집 전에는 대기 - 측정 없음을 정상으로 읽지 않는다`() {
        assertEquals(Severity.IDLE, VitalUiState().severity)
        assertEquals(Severity.IDLE, overallSeverity(Severity.IDLE, Severity.IDLE))
    }

    @Test
    fun `미측정 값은 판정에 끼어들지 않는다 - null 은 0 이 아니다`() {
        // SpO₂·체온이 없어도 심박만으로 정상 판정이 나와야 한다(없는 값이 위험으로 읽히면 안 된다).
        val s = VitalUiState(bpm = 80, collecting = true)
        assertEquals(Severity.NORMAL, s.severity)
    }
}

class GaugeTest {

    @Test
    fun `호 비율 - 범위 안에서 선형, 밖은 잘린다`() {
        assertEquals(0.0f, com.vitalguard.wear.ui.gaugeFraction(85.0, 85.0, 100.0)!!, 0.001f)
        assertEquals(0.8f, com.vitalguard.wear.ui.gaugeFraction(97.0, 85.0, 100.0)!!, 0.001f)
        assertEquals(1.0f, com.vitalguard.wear.ui.gaugeFraction(100.0, 85.0, 100.0)!!, 0.001f)
        // 범위 밖 — 호가 넘치거나 음수가 되지 않는다
        assertEquals(1.0f, com.vitalguard.wear.ui.gaugeFraction(120.0, 85.0, 100.0)!!, 0.001f)
        assertEquals(0.0f, com.vitalguard.wear.ui.gaugeFraction(50.0, 85.0, 100.0)!!, 0.001f)
    }

    @Test
    fun `값이 없으면 호도 없다 - 0 으로 채우지 않는다`() {
        assertEquals(null, com.vitalguard.wear.ui.gaugeFraction(null, 85.0, 100.0))
    }

    @Test
    fun `무동작 - 붕괴 후보선 90초에서 주의로 넘어간다`() {
        assertEquals(Severity.NORMAL, com.vitalguard.wear.ui.stillSeverity(89.9))
        assertEquals(Severity.CAUTION, com.vitalguard.wear.ui.stillSeverity(90.0))
        assertEquals(Severity.IDLE, com.vitalguard.wear.ui.stillSeverity(null))
    }

    @Test
    fun `무동작 표기 - 60초 미만은 초, 이상은 분`() {
        assertEquals("42s", com.vitalguard.wear.ui.stillShort(42.0))
        assertEquals("1m", com.vitalguard.wear.ui.stillShort(60.0))
        assertEquals("5m", com.vitalguard.wear.ui.stillShort(320.0))
    }

    @Test
    fun `값의 나이 표기`() {
        assertEquals("35초 전", com.vitalguard.wear.ui.ageLabel(35))
        assertEquals("4분 전", com.vitalguard.wear.ui.ageLabel(240))
        assertEquals("2시간 전", com.vitalguard.wear.ui.ageLabel(7200))
    }
}

class BezelTest {

    private fun band(st: com.vitalguard.wear.ui.VitalUiState) = com.vitalguard.wear.ui.hrBand(st)

    @Test
    fun `좌우 구획이 겹치지 않는다 - 포개지면 둘 다 못 읽는다`() {
        val l = com.vitalguard.wear.ui.Bezel.LEFT_START
        val sw = com.vitalguard.wear.ui.Bezel.SWEEP
        val r0 = com.vitalguard.wear.ui.Bezel.RIGHT_START
        val r1 = r0 + com.vitalguard.wear.ui.Bezel.RIGHT_SWEEP
        // 좌측 145~215 · 우측 35~-35 — 12시(270/-90)와 6시(90)를 비운다.
        org.junit.Assert.assertTrue("우측이 6시를 침범", maxOf(r0, r1) < 90f)
        org.junit.Assert.assertTrue("우측이 12시를 침범", minOf(r0, r1) > -90f)
        org.junit.Assert.assertTrue("좌측이 6시를 침범", l > 90f)
        org.junit.Assert.assertTrue("좌측이 12시를 침범", l + sw < 270f)
    }

    @Test
    fun `심박 띠 - 위가 높은 값이다`() {
        val hi = band(com.vitalguard.wear.ui.VitalUiState(bpm = 130, collecting = true))
        val lo = band(com.vitalguard.wear.ui.VitalUiState(bpm = 40, collecting = true))
        org.junit.Assert.assertTrue("높은 심박이 더 많이 차야 한다", hi.fraction!! > lo.fraction!!)
        // 축 끝(30·150)은 임계 바깥이므로 임계값 자체는 0 도 1 도 아니다 — 그래야 위험 구간이 보인다.
        org.junit.Assert.assertTrue("위험선이 축 끝에 붙었다", hi.fraction!! < 1f)
        org.junit.Assert.assertTrue("저심박 위험선이 축 끝에 붙었다", lo.fraction!! > 0f)
    }

    /**
     * ★ 08-25 사용자 요청 — 구간을 신호등으로 나눠 표현.
     * 종전 축(40~130)은 **임계와 축 끝이 같아** 위험 구간의 폭이 0 이었다. 색으로 나누는
     * 순간 빨강이 사라지는 상태였고, 이 시험이 그것을 막는다.
     */
    @Test
    fun `심박 구간 - 다섯 칸이 모두 폭을 갖는다`() {
        val z = com.vitalguard.wear.ui.hrZones()
        assertEquals("구간 수", 5, z.size)
        z.forEachIndexed { i, s ->
            org.junit.Assert.assertTrue("구간 $i 의 폭이 0 이다", s.to - s.from > 0.02f)
        }
        // 구간은 빈틈없이 이어지고 축 전체를 덮는다.
        assertEquals(0f, z.first().from, 0.001f)
        assertEquals(1f, z.last().to, 0.001f)
        z.zipWithNext().forEach { (a, b2) -> assertEquals("구간이 끊겼다", a.to, b2.from, 0.001f) }
    }

    /** 색은 신호등 셋 — 판정색을 그대로 쓴다(화면 안에서 기준이 갈리면 안 된다). */
    @Test
    fun `심박 구간 색 - 신호등 셋뿐이다`() {
        val z = com.vitalguard.wear.ui.hrZones()
        assertEquals(
            setOf(
                com.vitalguard.wear.ui.VgColors.Normal,
                com.vitalguard.wear.ui.VgColors.Caution,
                com.vitalguard.wear.ui.VgColors.Danger,
            ),
            z.map { it.color }.toSet(),
        )
        assertEquals("맨 아래는 서맥 위험", com.vitalguard.wear.ui.VgColors.Danger, z.first().color)
        assertEquals("맨 위는 빈맥 위험", com.vitalguard.wear.ui.VgColors.Danger, z.last().color)
    }

    /** 구간 경계가 임계와 같은 자리인가 — 화면이 서버와 다른 말을 하면 안 된다. */
    @Test
    fun `심박 구간 경계 - 임계 상수와 일치한다`() {
        val z = com.vitalguard.wear.ui.hrZones()
        fun p(v: Int) = ((v - com.vitalguard.wear.core.Thresholds.HR_GAUGE_MIN_BPM) /
            (com.vitalguard.wear.core.Thresholds.HR_GAUGE_MAX_BPM -
                com.vitalguard.wear.core.Thresholds.HR_GAUGE_MIN_BPM)).toFloat()
        assertEquals(p(com.vitalguard.wear.core.Thresholds.HR_DANGER_LOW), z[0].to, 0.001f)
        assertEquals(p(com.vitalguard.wear.core.Thresholds.HR_CAUTION_LOW), z[1].to, 0.001f)
        assertEquals(p(com.vitalguard.wear.core.Thresholds.HR_CAUTION_HIGH), z[2].to, 0.001f)
        assertEquals(p(com.vitalguard.wear.core.Thresholds.HR_DANGER_HIGH), z[3].to, 0.001f)
    }

    @Test
    fun `값이 없으면 채우지 않는다 - 0 으로 그리지 않는다`() {
        assertEquals(null, band(com.vitalguard.wear.ui.VitalUiState()).fraction)
        assertEquals(null, com.vitalguard.wear.ui.stressBand(com.vitalguard.wear.ui.VitalUiState()).fraction)
    }

    @Test
    fun `심박 띠 색은 판정색을 따른다`() {
        val danger = band(com.vitalguard.wear.ui.VitalUiState(bpm = 140, collecting = true))
        assertEquals(com.vitalguard.wear.ui.VgColors.Danger, danger.color)
    }
}

class AreaChartTest {

    private val chart = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/ui/TrendChart.kt",
    ).readText()

    /** ★ 08-25 사용자 결정 — 참고 워치앱 방식(면적 채움). 선 하나보다 크기가 빨리 읽힌다. */
    @Test
    fun `주 계열은 선 아래를 채운다`() {
        org.junit.Assert.assertTrue("면적 채움이 없다", chart.contains("Brush.verticalGradient"))
        org.junit.Assert.assertTrue(
            "주 계열이 안 채워진다",
            chart.contains("series(visible, tint, h * 0.055f, filled = true)"),
        )
    }

    /**
     * ⚠ 보조 계열은 **채우지 않는다.** 두 면이 겹치면 체온 판별(피부온 대 주변온)이 뭉개진다 —
     * 겹쳐 그리는 이유가 두 선의 기울기 비교이기 때문이다(R-25).
     */
    @Test
    fun `보조 계열은 채우지 않는다 - 겹치면 체온 판별이 뭉개진다`() {
        org.junit.Assert.assertTrue(
            "보조 계열이 채워진다 — 겹친 두 면이 서로를 가린다",
            chart.contains("series(visibleOverlay, overlayTint.copy(alpha = 0.75f), h * 0.035f, filled = false)"),
        )
    }

    /** 세로 격자 — 시간 폭을 눈으로 나눈다(참고 워치앱의 그 눈금). */
    @Test
    fun `세로 격자가 있다`() {
        org.junit.Assert.assertTrue("격자가 없다", chart.contains("GRID_DIVISIONS"))
    }

    /** 채움이 격자·임계선을 가리면 안 된다 — 아래로 갈수록 투명해야 한다. */
    @Test
    fun `채움은 아래로 갈수록 투명하다`() {
        org.junit.Assert.assertTrue(
            "그라데이션이 불투명하게 끝난다",
            chart.contains("c.copy(alpha = 0f)"),
        )
    }
}

class CurrentZoneTest {

    private val z = com.vitalguard.wear.ui.hrZones()

    /**
     * ★ 08-25 사용자 결정 — **현재 구간만 밝게.**
     * 누적 채움이면 정상 심박에서도 맨 아래 서맥 위험 칸이 늘 켜져 "위험" 으로 오독된다.
     */
    @Test
    fun `현재 구간 하나만 고른다 - 아래 구간을 함께 켜지 않는다`() {
        // 88bpm(정상) → 축 30~150 에서 0.483
        val cur = com.vitalguard.wear.ui.currentZone(z, 0.483f)!!
        assertEquals("정상인데 정상 칸이 아니다", com.vitalguard.wear.ui.VgColors.Normal, cur.color)
        // 고른 구간이 값을 실제로 담고 있어야 한다 = 아래 구간이 아니다.
        org.junit.Assert.assertTrue(0.483f >= cur.from && 0.483f < cur.to)
        // 맨 아래 위험 칸(서맥)은 선택되지 않는다.
        org.junit.Assert.assertNotEquals(z.first(), cur)
    }

    @Test
    fun `높은 값은 위험 칸을 고른다`() {
        // 140bpm → (140-30)/120 = 0.9167
        assertEquals(com.vitalguard.wear.ui.VgColors.Danger, com.vitalguard.wear.ui.currentZone(z, 0.9167f)!!.color)
        // 축 끝(1.0)도 마지막 구간이 받는다 — 어디에도 안 걸려 사라지면 안 된다.
        assertEquals(z.last(), com.vitalguard.wear.ui.currentZone(z, 1f))
    }

    @Test
    fun `낮은 값은 서맥 위험 칸을 고른다`() {
        // 35bpm → 0.0417
        assertEquals(z.first(), com.vitalguard.wear.ui.currentZone(z, 0.0417f))
    }

    @Test
    fun `미측정이면 아무 칸도 안 켠다`() {
        assertEquals(null, com.vitalguard.wear.ui.currentZone(z, null))
    }
}

class StressBandTest {

    /** ★ 08-25 사용자 결정 — 우측은 걸음이 아니라 **스트레스**이고, 좌측과 같은 구간 구조다. */
    @Test
    fun `우측 띠는 스트레스다 - 구간이 셋이고 신호등이다`() {
        val z = com.vitalguard.wear.ui.stressZones()
        assertEquals(3, z.size)
        assertEquals(com.vitalguard.wear.ui.VgColors.Normal, z[0].color)
        assertEquals(com.vitalguard.wear.ui.VgColors.Caution, z[1].color)
        assertEquals(com.vitalguard.wear.ui.VgColors.Danger, z[2].color)
        assertEquals(0f, z.first().from, 0.001f)
        assertEquals(1f, z.last().to, 0.001f)
    }

    /** 경계는 StressIndex 임계에서 온다 — 화면이 자기 숫자를 갖지 않는다. */
    @Test
    fun `스트레스 구간 경계 - 임계 상수와 일치한다`() {
        val z = com.vitalguard.wear.ui.stressZones()
        assertEquals(
            com.vitalguard.wear.core.Stress.LEVEL_CAUTION / 100f, z[0].to, 0.001f,
        )
        assertEquals(
            com.vitalguard.wear.core.Stress.LEVEL_DANGER / 100f, z[1].to, 0.001f,
        )
    }

    /**
     * ⚠ 좌우는 각의 부호가 반대다 — 둘 다 "비율 0 = 아래" 라야 한 화면에서 같은 말을 한다.
     * 우측 sweep 이 음수인 이유가 이것이고, 부호가 뒤집히면 스트레스가 거꾸로 찬다.
     */
    @Test
    fun `좌우 띠가 같은 방향으로 찬다 - 비율 0 은 둘 다 아래다`() {
        fun y(deg: Float) = kotlin.math.sin(Math.toRadians(deg.toDouble()))
        val leftLow = y(com.vitalguard.wear.ui.Bezel.LEFT_START)
        val rightLow = y(com.vitalguard.wear.ui.Bezel.RIGHT_START)
        org.junit.Assert.assertTrue("좌측 비율 0 이 아래가 아니다", leftLow > 0)
        org.junit.Assert.assertTrue("우측 비율 0 이 아래가 아니다", rightLow > 0)
        val leftHigh = y(com.vitalguard.wear.ui.Bezel.LEFT_START + com.vitalguard.wear.ui.Bezel.SWEEP)
        val rightHigh = y(com.vitalguard.wear.ui.Bezel.RIGHT_START + com.vitalguard.wear.ui.Bezel.RIGHT_SWEEP)
        org.junit.Assert.assertTrue("좌측 비율 1 이 위가 아니다", leftHigh < 0)
        org.junit.Assert.assertTrue("우측 비율 1 이 위가 아니다", rightHigh < 0)
    }
}

class PsiTest {

    /**
     * ★ 08-25 사용자 요청 — 하단은 생리적 부담(PSI)이다.
     * 문헌식 그대로인지 못 박는다(Moran 1998). 우리가 정한 숫자가 하나도 없어야 한다.
     */
    @Test
    fun `PSI 문헌식 - 관제웹 psi_ts 와 같은 답을 낸다`() {
        // Tc0=37.1 · TcMax=39.5 · HR0=60 · HRMax=180
        // Tc=38.0, HR=120 → 5*(0.9/2.4) + 5*(60/120) = 1.875 + 2.5 = 4.375
        assertEquals(4.375, com.vitalguard.wear.core.Psi.compute(38.0, 120)!!, 0.001)
        // 기준점에서는 0
        assertEquals(0.0, com.vitalguard.wear.core.Psi.compute(37.1, 60)!!, 0.001)
        // 논문 상한에서 10
        assertEquals(10.0, com.vitalguard.wear.core.Psi.compute(39.5, 180)!!, 0.001)
    }

    @Test
    fun `입력이 없으면 판정 불가다 - 0 과 구분한다`() {
        assertEquals(null, com.vitalguard.wear.core.Psi.compute(null, 90))
        assertEquals(null, com.vitalguard.wear.core.Psi.compute(37.5, null))
    }

    @Test
    fun `구간은 문헌 임계다 - 6 이상 주의 · 7_5 이상 위험`() {
        assertEquals(Severity.NORMAL, com.vitalguard.wear.core.Psi.severity(5.9))
        assertEquals(Severity.CAUTION, com.vitalguard.wear.core.Psi.severity(6.0))
        assertEquals(Severity.CAUTION, com.vitalguard.wear.core.Psi.severity(7.4))
        assertEquals(Severity.DANGER, com.vitalguard.wear.core.Psi.severity(7.5))
        assertEquals(Severity.IDLE, com.vitalguard.wear.core.Psi.severity(null))
    }

    /**
     * ⚠ **표시 전용** — 추정 심부체온이 입력이라 오차가 지수로 전파된다.
     * 전체 판정에 끼어들면 검증 못 한 값으로 경보가 뜬다(관제웹 psi.ts 와 같은 규율).
     */
    @Test
    fun `PSI 는 전체 판정에 끼어들지 않는다`() {
        // ⚠ 행동만으로는 못 세운다 — 정상 입력의 PSI 상한이 4.75 라 "정상인데 PSI 위험" 표본을
        //   만들 수 없다. 그래서 판정식이 psi 를 읽지 않는다는 것을 소스로 못 박는다.
        val src = java.io.File("src/main/kotlin/com/vitalguard/wear/ui/VitalUiState.kt").readText()
        val sev = src.substringAfter("val severity: Severity").substringBefore("\n\n")
        org.junit.Assert.assertFalse("판정식이 PSI 를 읽는다 — 표시 전용 규율이 깨졌다", sev.contains("psi"))
        // 그리고 실제로도 정상 판정이 유지된다.
        // ⚠ 08-26(R-30) 이후 심부체온은 피부온 파생이 아니라 **칼만 추정 입력**이다.
        //   종전 표본은 skinTempC=37.9 → 오프셋 +0.5 = 38.4 를 암묵적으로 썼다.
        //   같은 PSI(4.75)를 유지하려고 그 값을 이제 명시로 넣는다.
        val s = VitalUiState(bpm = 109, skinTempC = 37.9, coreTempC = 38.4, collecting = true)
        org.junit.Assert.assertTrue("표본의 PSI 가 0 이면 시험이 헛돈다", s.psi!! > 3.0)
        assertEquals(Severity.NORMAL, s.severity)
    }
}

class BezelFillTest {

    private val src = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/ui/BezelIndicator.kt",
    ).readText()

    /** 08-25 사용자 요청 — 좌측 심박은 점이 아니라 **채워지는 게이지**다. */
    @Test
    fun `좌측 띠는 점이 아니라 채움이다`() {
        org.junit.Assert.assertTrue(
            "채움 아크가 없다",
            src.contains("sweepAngle = b.sweepDeg * f"),
        )
        org.junit.Assert.assertFalse(
            "점 표시가 되살아났다",
            src.contains("drawCircle"),
        )
    }

    /**
     * ⚠ 방향 — 채움은 **시작각에서** 자란다. 종전 점은 `1f - f` 로 뒤집혀 있어
     * 높은 심박이 화면 아래에 찍혔다. 뒤집기가 되살아나면 같은 오독이 돌아온다.
     */
    @Test
    fun `채움 방향이 뒤집히지 않았다`() {
        org.junit.Assert.assertFalse(
            "비율 뒤집기가 되살아났다",
            src.contains("(1f - f)"),
        )
    }
}

class BezelLabelTest {

    /**
     * ★ 08-25 사용자 제시 워치페이스 방식 — 이름은 **띠 바깥**에 아크를 따라 붙는다.
     * ⚠ 이 순서가 배치의 전부다. 이름 반지름이 띠보다 안쪽으로 들어오면 이름이 띠를 가린다
     *   (그것이 종전 상태였고, 사용자가 세 번 지적한 그림이다).
     */
    @Test
    fun `이름은 띠 바깥에 있다`() {
        org.junit.Assert.assertTrue(
            "이름이 띠 안쪽으로 들어왔다",
            com.vitalguard.wear.ui.LABEL_RADIUS_RATIO > com.vitalguard.wear.ui.BAND_RADIUS_RATIO,
        )
    }

    /** 이름이 화면 밖으로 나가면 잘린다 — 가장자리(1.0)보다는 안이어야 한다. */
    @Test
    fun `이름이 화면 안에 있다`() {
        org.junit.Assert.assertTrue(
            "이름이 화면 가장자리를 넘는다",
            com.vitalguard.wear.ui.LABEL_RADIUS_RATIO < 1.0f,
        )
    }

    /** 이름은 아크를 따라 흐른다 = 띠의 각 범위 한가운데에 앉는다. */
    @Test
    fun `이름이 띠의 각 범위 안에 있다`() {
        fun inside(start: Float, sweep: Float): Boolean {
            val m = com.vitalguard.wear.ui.bandLabelDeg(start, sweep)
            return m > minOf(start, start + sweep) && m < maxOf(start, start + sweep)
        }
        org.junit.Assert.assertTrue(
            "좌측 이름이 띠 밖이다",
            inside(com.vitalguard.wear.ui.Bezel.LEFT_START, com.vitalguard.wear.ui.Bezel.SWEEP),
        )
        org.junit.Assert.assertTrue(
            "우측 이름이 띠 밖이다",
            inside(com.vitalguard.wear.ui.Bezel.RIGHT_START, com.vitalguard.wear.ui.Bezel.RIGHT_SWEEP),
        )
    }

    /** 좌우 이름의 높이가 같아야 한 쌍으로 읽힌다. */
    @Test
    fun `좌우 이름의 높이가 같다`() {
        fun y(deg: Float) = kotlin.math.sin(Math.toRadians(deg.toDouble()))
        val ly = y(com.vitalguard.wear.ui.bandLabelDeg(com.vitalguard.wear.ui.Bezel.LEFT_START, com.vitalguard.wear.ui.Bezel.SWEEP))
        val ry = y(com.vitalguard.wear.ui.bandLabelDeg(com.vitalguard.wear.ui.Bezel.RIGHT_START, com.vitalguard.wear.ui.Bezel.RIGHT_SWEEP))
        assertEquals(ly, ry, 0.001)
    }
}

class HrvTest {

    @Test
    fun `HRV 는 낮을수록 나쁘다 - 심박과 반대 방향`() {
        assertEquals(Severity.CAUTION, com.vitalguard.wear.ui.hrvSeverity(19.9))
        assertEquals(Severity.NORMAL, com.vitalguard.wear.ui.hrvSeverity(20.0))
        assertEquals(Severity.NORMAL, com.vitalguard.wear.ui.hrvSeverity(60.0))
        assertEquals(Severity.IDLE, com.vitalguard.wear.ui.hrvSeverity(null))
    }

    @Test
    fun `HRV 게이지 - 0~100ms 를 편다`() {
        assertEquals(0.42f, com.vitalguard.wear.ui.gaugeFraction(42.0, 0.0, 100.0)!!, 0.001f)
        assertEquals(null, com.vitalguard.wear.ui.gaugeFraction(null, 0.0, 100.0))
    }
}

class ChartTest {

    @Test
    fun `차트 창은 5분이다 - 근무 중 변화를 보려면 시간이 아니라 분 단위`() {
        assertEquals(5 * 60_000L, com.vitalguard.wear.ui.CHART_WINDOW_MS)
    }

    @Test
    fun `차트는 요약이 아니라 상세에 있다 - 한눈 화면에 통계를 두지 않는다`() {
        // Wear 디자인 지침: 복잡한 차트·통계는 글랜서빌리티를 떨어뜨린다.
        val summary = java.io.File(
            "src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt",
        ).readText()
        val detail = java.io.File(
            "src/main/kotlin/com/vitalguard/wear/ui/DetailPages.kt",
        ).readText()
        org.junit.Assert.assertFalse("요약에 차트가 되살아났다", summary.contains("TrendChart("))
        org.junit.Assert.assertTrue("상세에 차트가 없다", detail.contains("TrendChart("))
        // 상세 5면(심박·SpO₂·체온·스트레스·걸음)이 전부 차트를 든다 — 하나라도 숫자만
        // 남으면 "추이를 본다" 는 이 페이지들의 목적이 조용히 깨진다.
        org.junit.Assert.assertEquals(
            "상세 차트 수가 지표 면 수와 다르다",
            5,
            Regex("TrendChart\\(").findAll(detail).count(),
        )
        // 페이지 수 = 로그인 1 + 요약 1 + 지표 상세 5 + 설정 1. 늘려 놓고 배선을 빠뜨리면 빈 화면이 생긴다.
        // 차트 수(5)에서 계산해 세운다 — 숫자를 손으로 적으면 지표를 늘렸을 때 여기만 낡는다.
        val chartPages = Regex("TrendChart\\(").findAll(detail).count()
        org.junit.Assert.assertEquals(
            "페이지 수가 (로그인 1 + 요약 1 + 차트 $chartPages + 설정 1) 과 안 맞는다",
            1 + 1 + chartPages + 1,
            com.vitalguard.wear.ui.DETAIL_PAGE_COUNT,
        )
        // 체온은 주변온을 **같은 축에 겹쳐야** 기기 발열과 진짜 체온이 갈린다(R-25).
        org.junit.Assert.assertTrue(
            "체온 차트에 주변온 겹치기가 없다",
            detail.contains("overlay = state.ambientTrend"),
        )
        // ★ 겹쳤으면 이름을 붙여야 한다 — 선이 둘인데 범례가 없으면 판별법을 쓸 수가 없다.
        org.junit.Assert.assertTrue(
            "겹친 두 선에 범례가 없다",
            detail.contains("label = \"피부온\"") && detail.contains("overlayLabel = \"주변온\""),
        )
    }
}

class SkinGaugeTest {

    private fun f(c: Double) = com.vitalguard.wear.ui.gaugeFraction(
        c,
        com.vitalguard.wear.core.Thresholds.SKIN_GAUGE_MIN_C,
        com.vitalguard.wear.core.Thresholds.SKIN_GAUGE_MAX_C,
    )!!

    /**
     * ★ 08-25 사용자 보고 — "피부온은 측정되는데 인디케이터가 작동하지 않는다".
     * 원인 = 축 바닥(36.0)이 실제 손목 피부온(35.2)보다 높아 0 으로 잘렸다.
     * 실측 표본은 서버 적재분(착용 확정 행)에서 왔다.
     */
    @Test
    fun `실제 손목 피부온이 게이지에 보인다 - 0 으로 잘리지 않는다`() {
        // 발열이 빠진 뒤 실측된 값들. 셋 다 눈에 보여야 한다.
        org.junit.Assert.assertTrue("정상 구간 최저(34.12)가 잘렸다", f(34.12) > 0.02f)
        org.junit.Assert.assertTrue("현재 실측(35.2)이 20% 미만이면 안 보인다", f(35.2) >= 0.20f)
        org.junit.Assert.assertTrue("정상 평균(36.66)이 중간에 안 온다", f(36.66) in 0.35f..0.65f)
    }

    @Test
    fun `위험선을 넘어도 남은 여유가 보인다`() {
        val danger = f(com.vitalguard.wear.core.Thresholds.SKIN_TEMP_DANGER_C)
        org.junit.Assert.assertTrue("위험선이 이미 꽉 차면 그 위가 안 보인다", danger < 0.90f)
        org.junit.Assert.assertTrue("39.5 가 위험선보다 높게 그려져야 한다", f(39.5) > danger)
    }
}

class TempGaugeTest {

    private fun f(c: Double) = com.vitalguard.wear.ui.gaugeFraction(
        c,
        com.vitalguard.wear.core.Thresholds.TEMP_GAUGE_MIN_C,
        com.vitalguard.wear.core.Thresholds.TEMP_GAUGE_MAX_C,
    )!!

    @Test
    fun `정상 체온이 눈에 보이게 찬다 - 종전 8퍼센트 문제`() {
        // 36.2℃ 는 정상인데 종전 축(36.0~38.5)에서 8% 라 안 찬 것처럼 보였다.
        org.junit.Assert.assertTrue("정상 체온이 20% 미만이면 안 보인다", f(36.2) >= 0.20f)
    }

    @Test
    fun `고열이 최대에 눌리지 않는다 - 40도가 얼마나 심각한지 보여야 한다`() {
        // 종전엔 38.5 이상이 전부 100% 로 뭉개져 39·40·41 이 구분되지 않았다.
        org.junit.Assert.assertTrue("38.5 와 39.5 가 구분돼야 한다", f(39.5) > f(38.5))
        org.junit.Assert.assertEquals("40℃ 가 축의 끝", 1.0f, f(40.0), 0.001f)
    }

    @Test
    fun `임계가 축의 중간대에 온다 - 넘어도 남은 여유가 보인다`() {
        assertEquals("주의선 37.5 = 50%", 0.50f, f(37.5), 0.001f)
        assertEquals("위험선 38.0 = 60%", 0.60f, f(38.0), 0.001f)
    }

    @Test
    fun `축은 임계와 별개다 - 판정은 그대로`() {
        // 축을 넓혀도 위험 판정 경계는 안 움직인다(표시와 판정의 분리).
        assertEquals(Severity.DANGER, com.vitalguard.wear.core.coreTempSeverity(38.0))
        assertEquals(Severity.CAUTION, com.vitalguard.wear.core.coreTempSeverity(37.5))
        assertEquals(Severity.NORMAL, com.vitalguard.wear.core.coreTempSeverity(37.4))
    }
}

class IbiFilterTest {

    @Test
    fun `생리 범위 밖 IBI 는 버린다 - status 만으로는 안 걸러진다`() {
        // 08-25 실기: HRV 402ms 관측. 0 같은 무효값이 SDNN 을 통째로 망가뜨린다.
        // 문턱(30)과 무관하게 **필터 자체**를 검증한다 — 표본 수를 늘려 우회하면
        // 정작 무엇을 거르는지가 시험에서 사라진다.
        val base = (0 until 30).map { 600 + (it % 3 - 1) * 5 }
        val withZero = base + listOf(0, 0)
        assertEquals(
            "무효값이 결과를 바꾸면 안 된다",
            com.vitalguard.wear.core.Sdnn.sdnnMs(base)!!,
            com.vitalguard.wear.core.Sdnn.sdnnMs(withZero)!!,
            0.001,
        )
    }

    @Test
    fun `극단값도 버린다 - 30~220bpm 밖은 표본이 아니다`() {
        val base = (0 until 30).map { 600 + (it % 3 - 1) * 5 }
        assertEquals(
            com.vitalguard.wear.core.Sdnn.sdnnMs(base)!!,
            com.vitalguard.wear.core.Sdnn.sdnnMs(base + listOf(5000))!!,
            0.001,
        )
    }

    @Test
    fun `걸러낸 뒤 2개 미만이면 null - 0 으로 채우지 않는다`() {
        assertEquals(null, com.vitalguard.wear.core.Sdnn.sdnnMs(listOf(0, 0, 5000)))
    }
}

/** B안 — 연속성 필터. 08-25 실기 HRV 264ms 오염을 막는다. */
class ContinuityFilterTest {

    @Test
    fun `실기 관측 재현 - 놓친 박동이 합쳐진 값을 버린다`() {
        // 08-25 실측: 심박 95bpm(=632ms) 인데 IBI=[1442, 920, 869] · status 전부 정상.
        // 1442 는 두세 박동이 합쳐진 값 — 생리 범위(270~2000)는 통과하므로 값 범위로는 못 거른다.
        val raw = listOf(1442, 920, 869)
        val kept = com.vitalguard.wear.core.Sdnn.continuous(raw)
        org.junit.Assert.assertEquals("첫 값만 남아야 한다", listOf(1442), kept)
        // 결과적으로 표본 부족 → null. 오염된 264ms 를 내보내지 않는다.
        org.junit.Assert.assertNull(com.vitalguard.wear.core.Sdnn.sdnnMs(raw))
    }

    @Test
    fun `정상 변동은 통과한다 - 호흡성 부정맥을 죽이지 않는다`() {
        // 안정 시 RSA 는 대개 5~10% 변동 — 20% 허용 폭 안이다.
        val rsa = listOf(600, 630, 610, 645, 620, 655)
        assertEquals("RSA 는 연속성 필터를 통과해야 한다", rsa, com.vitalguard.wear.core.Sdnn.continuous(rsa))
        // 문턱을 넘는 길이면 실제로 값이 나온다.
        val long = (0 until 6).flatMap { rsa }
        org.junit.Assert.assertNotNull(com.vitalguard.wear.core.Sdnn.sdnnMs(long))
    }

    @Test
    fun `기준은 직전 유효값이다 - 버린 값이 뒤를 오염시키지 않는다`() {
        // 1200 을 버린 뒤 기준은 여전히 600 이라 610 이 살아남는다.
        assertEquals(
            listOf(600, 610),
            com.vitalguard.wear.core.Sdnn.continuous(listOf(600, 1200, 610)),
        )
    }

    @Test
    fun `표본이 줄면 표시하지 않는다 - 노이즈를 HRV 로 내보내지 않는다`() {
        // 절반이 튀어 유효 4개만 남는 경우 → null
        org.junit.Assert.assertNull(com.vitalguard.wear.core.Sdnn.sdnnMs(listOf(600, 1400, 610, 1500, 605, 1600, 612)))
    }
}

/** 심박 정합 필터 — 연속성이 못 잡는 '배치 통째 어긋남' 을 막는다(08-25 실측). */
class HrConsistencyTest {

    @Test
    fun `실기 관측 재현 - 서로는 가깝지만 심박과 안 맞는 배치를 버린다`() {
        // 심박 94bpm(=638ms) 인데 IBI 는 787~920ms(65~76bpm). 서로는 20% 안이라
        // 연속성을 전부 통과하지만 심박과 정합하지 않는다.
        val raw = listOf(855, 915, 920, 889, 787)
        assertEquals("연속성만으로는 전부 통과한다", raw, com.vitalguard.wear.core.Sdnn.continuous(raw))
        val kept = com.vitalguard.wear.core.Sdnn.hrConsistent(raw, bpm = 94)
        org.junit.Assert.assertTrue("심박 정합이 걸러내야 한다", kept.size < raw.size)
        // 결과적으로 표본 부족 → null. 오염된 SDNN 을 안 내보낸다.
        org.junit.Assert.assertNull(com.vitalguard.wear.core.Sdnn.sdnnMs(raw, bpm = 94))
    }

    @Test
    fun `심박과 맞는 표본은 통과한다`() {
        // 94bpm = 638ms. ±30% = 447~830ms.
        val ok = listOf(620, 640, 655, 630, 645)
        assertEquals(ok, com.vitalguard.wear.core.Sdnn.hrConsistent(ok, bpm = 94))
        val long = (0 until 6).flatMap { ok }
        org.junit.Assert.assertNotNull(com.vitalguard.wear.core.Sdnn.sdnnMs(long, bpm = 94))
    }

    @Test
    fun `bpm 이 없으면 거르지 않는다 - 대조 기준이 없으면 근거도 없다`() {
        val any = listOf(855, 915, 920)
        assertEquals(any, com.vitalguard.wear.core.Sdnn.hrConsistent(any, bpm = null))
        assertEquals(any, com.vitalguard.wear.core.Sdnn.hrConsistent(any, bpm = 0))
    }
}

/** A안 표시 문턱 — 08-25 실측(표본 6~23개에서 21.9~63.5ms 요동)이 근거. */
class MinSamplesTest {

    private fun ibi(n: Int) = (0 until n).map { 600 + (it % 3 - 1) * 5 }

    @Test
    fun `문턱은 30이다 - 실측 요동 구간(6~23개)을 덮는다`() {
        assertEquals(30, com.vitalguard.wear.core.Sdnn.MIN_SAMPLES)
        // 실측에서 요동을 만든 표본 수들이 전부 문턱 아래여야 한다.
        listOf(6, 7, 9, 23).forEach {
            org.junit.Assert.assertNull("표본 ${it}개는 안 보여줘야 한다", com.vitalguard.wear.core.Sdnn.sdnnMs(ibi(it)))
        }
    }

    @Test
    fun `문턱 경계 - 29는 null, 30은 값`() {
        org.junit.Assert.assertNull(com.vitalguard.wear.core.Sdnn.sdnnMs(ibi(29)))
        org.junit.Assert.assertNotNull(com.vitalguard.wear.core.Sdnn.sdnnMs(ibi(30)))
    }

    @Test
    fun `문턱을 넘어도 값 자체는 정상 범위여야 한다`() {
        // 600±5 짜리 30개 → SDNN 은 한 자릿수. 264ms 같은 값이 다시 나오면 안 된다.
        val got = com.vitalguard.wear.core.Sdnn.sdnnMs(ibi(30))!!
        org.junit.Assert.assertTrue("SDNN 이 비정상적으로 크다: $got", got < 100.0)
    }
}

/** A안 — HRV 를 화면에서 내리고 주변 온도를 올린다(08-25 사용자 결정). */
class AmbientBubbleTest {

    private val screen = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt",
    ).readText()

    @Test
    fun `주변 온도 판정 - 31 주의 · 35 위험`() {
        assertEquals(Severity.NORMAL, com.vitalguard.wear.ui.ambientSeverity(30.9))
        assertEquals(Severity.CAUTION, com.vitalguard.wear.ui.ambientSeverity(31.0))
        assertEquals(Severity.CAUTION, com.vitalguard.wear.ui.ambientSeverity(34.9))
        assertEquals(Severity.DANGER, com.vitalguard.wear.ui.ambientSeverity(35.0))
        assertEquals(Severity.IDLE, com.vitalguard.wear.ui.ambientSeverity(null))
    }

    @Test
    fun `게이지 축 15~40 - 현장 실측대(30~32)가 중간에 온다`() {
        val f = com.vitalguard.wear.ui.gaugeFraction(31.0, 15.0, 40.0)!!
        org.junit.Assert.assertTrue("현장 온도가 눈에 보이게 차야 한다", f in 0.5f..0.8f)
    }

    @Test
    fun `버블 3종은 SpO2·피부온·생리적부담이다`() {
        // 변천: 무동작 → HRV(센서 한계로 폐기) → 주변온 → 스트레스 → **생리적부담**(08-25).
        // 스트레스는 우측 띠로, 주변온은 서버 전송으로 각각 살아 있다 — 화면 자리만 바뀌었다.
        org.junit.Assert.assertFalse("HRV 버블이 되살아났다", screen.contains("label = \"HRV\""))
        org.junit.Assert.assertTrue("생리적부담 버블이 없다", screen.contains("label = \"생리적부담\""))
        org.junit.Assert.assertFalse(
            "같은 값을 두 곳에 뒀다 — 스트레스는 우측 띠가 든다",
            screen.contains("label = \"스트레스\""),
        )
        org.junit.Assert.assertTrue("SpO₂ 버블이 없다", screen.contains("label = \"SpO₂\""))
        org.junit.Assert.assertTrue("피부온 버블이 없다", screen.contains("label = \"피부온\""))
    }

    @Test
    fun `주변온은 계속 전송된다 - 화면에서만 내렸다`() {
        val builder = java.io.File(
            "src/main/kotlin/com/vitalguard/wear/pipeline/SampleBuilder.kt",
        ).readText()
        org.junit.Assert.assertTrue(
            "ambientTempC 전송이 사라지면 WBGT 재료가 끊긴다",
            builder.contains("ambientTempC"),
        )
    }

    @Test
    fun `HRV 계산·전송은 유지한다 - 화면에서만 내렸다`() {
        // 서버가 표본을 모아 쓸 수 있으므로 파이프라인에서 빼지 않는다.
        val engine = java.io.File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText()
        org.junit.Assert.assertTrue("전송용 HRV 가 사라졌다", engine.contains("builder.hrvSdnn"))
    }
}

/** C안 — 피부온 실측 표시. 변환식은 3단계로 미룬다(08-25 사용자 결정). */
class SkinTempTrackTest {

    private val screen = java.io.File(
        "src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt",
    ).readText()

    @Test
    fun `화면이 변환하지 않는다 - 실측을 그대로 보여준다`() {
        org.junit.Assert.assertTrue("피부온 라벨이 없다", screen.contains("label = \"피부온\""))
        org.junit.Assert.assertFalse(
            "coreTempC 를 다시 쓰면 서버와 값이 갈린다",
            screen.contains("state.coreTempC"),
        )
    }

    // ⚠ 종전의 `게이지 축 36~40` 시험은 **오염된 실측대(37.5)** 를 못 박고 있어서 폐기했다.
    //    그 37.5 는 기기 발열 구간의 값이었고, 발열이 빠진 실제 손목은 35.2 였다.
    //    새 축의 계약은 SkinGaugeTest 가 든다 — 실측 표본으로 다시 세운 것이다.

    @Test
    fun `전체 판정도 피부온을 본다 - 화면 안에서 기준이 갈리면 안 된다`() {
        val hot = VitalUiState(bpm = 80, skinTempC = 38.6, collecting = true)
        assertEquals(Severity.DANGER, hot.severity)
    }
}

/** 스트레스 지수 — 서버 stress-index.ts 와 같은 공식·같은 상수여야 한다. */
class StressIndexTest {

    @Test
    fun `보정 중 - HRV 도 없고 활동맥락도 없으면 계산하지 않는다`() {
        val r = com.vitalguard.wear.core.Stress.compute(
            heartRate = 90, hrvSdnnMs = null,
            activeEnergyKcal = null, steps = null, floors = null,
        )
        org.junit.Assert.assertTrue("심박만으로는 보정 중이어야 한다", r.calibrating)
        org.junit.Assert.assertNull(r.index)
    }

    @Test
    fun `심박 + 활동맥락이면 계산된다`() {
        val r = com.vitalguard.wear.core.Stress.compute(
            heartRate = 90, hrvSdnnMs = null,
            activeEnergyKcal = 1.0, steps = 50, floors = 0,
        )
        org.junit.Assert.assertFalse(r.calibrating)
        org.junit.Assert.assertNotNull(r.index)
        org.junit.Assert.assertTrue("지수는 0~100", r.index!! in 0..100)
    }

    @Test
    fun `HRV 만으로도 계산된다`() {
        val r = com.vitalguard.wear.core.Stress.compute(
            heartRate = null, hrvSdnnMs = 30.0,
            activeEnergyKcal = null, steps = null, floors = null,
        )
        org.junit.Assert.assertFalse(r.calibrating)
        org.junit.Assert.assertNotNull(r.index)
    }

    @Test
    fun `활동 분류 - 서버 임계(2_5 · 6_0)와 같다`() {
        // a = 1.0*kcal + 0.5*(steps/100) + 2.0*floors
        assertEquals(ActivityStateRef.REST, ref(com.vitalguard.wear.core.Stress.classifyActivity(2.0, 0, 0)))
        assertEquals(ActivityStateRef.LIGHT, ref(com.vitalguard.wear.core.Stress.classifyActivity(2.5, 0, 0)))
        assertEquals(ActivityStateRef.HEAVY, ref(com.vitalguard.wear.core.Stress.classifyActivity(6.0, 0, 0)))
        org.junit.Assert.assertNull("셋 다 없으면 null", com.vitalguard.wear.core.Stress.classifyActivity(null, null, null))
    }

    @Test
    fun `레벨 경계 - 40 주의 · 70 위험`() {
        // 낮은 HRV 는 스트레스를 올린다(baseline 50 대비).
        val calm = com.vitalguard.wear.core.Stress.compute(
            heartRate = 70, hrvSdnnMs = 60.0, activeEnergyKcal = 0.5, steps = 10, floors = 0,
        )
        val tense = com.vitalguard.wear.core.Stress.compute(
            heartRate = 120, hrvSdnnMs = 10.0, activeEnergyKcal = 0.5, steps = 10, floors = 0,
        )
        org.junit.Assert.assertTrue("긴장 상태가 더 높아야 한다", tense.index!! > calm.index!!)
        assertEquals(Severity.NORMAL, calm.level)
    }

    private enum class ActivityStateRef { REST, LIGHT, HEAVY }
    private fun ref(a: com.vitalguard.wear.core.ActivityState?) = when (a) {
        com.vitalguard.wear.core.ActivityState.REST -> ActivityStateRef.REST
        com.vitalguard.wear.core.ActivityState.LIGHT -> ActivityStateRef.LIGHT
        com.vitalguard.wear.core.ActivityState.HEAVY -> ActivityStateRef.HEAVY
        null -> null
    }
}
