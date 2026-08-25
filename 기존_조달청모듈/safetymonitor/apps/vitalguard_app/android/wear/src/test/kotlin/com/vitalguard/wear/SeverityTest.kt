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
    fun `심부 체온 - 손목온에 0_5 보정 후 판정`() {
        assertEquals(36.6, estimateCoreTempC(36.1)!!, 0.0001)
        assertEquals(Severity.NORMAL, coreTempSeverity(estimateCoreTempC(36.9)))   // 37.4
        assertEquals(Severity.CAUTION, coreTempSeverity(estimateCoreTempC(37.0)))  // 37.5
        assertEquals(Severity.DANGER, coreTempSeverity(estimateCoreTempC(37.5)))   // 38.0
        assertEquals(Severity.IDLE, coreTempSeverity(null))
    }

    @Test
    fun `화면 전체 상태는 가장 나쁜 지표를 따른다`() {
        val s = VitalUiState(bpm = 80, spo2 = 86, skinTempC = 36.0, collecting = true)
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
    private fun ticks(st: com.vitalguard.wear.ui.VitalUiState) = com.vitalguard.wear.ui.stillTicks(st)

    @Test
    fun `좌우 구획이 겹치지 않는다 - 포개지면 둘 다 못 읽는다`() {
        val l = com.vitalguard.wear.ui.Bezel.LEFT_START
        val rgt = com.vitalguard.wear.ui.Bezel.RIGHT_START
        val sw = com.vitalguard.wear.ui.Bezel.SWEEP
        // 우측은 음수각(-35~35), 좌측은 145~215 — 12시(270/-90)와 6시(90)를 비운다
        org.junit.Assert.assertTrue("우측이 6시를 침범", rgt + sw < 90f)
        org.junit.Assert.assertTrue("좌측이 6시를 침범", l > 90f)
        org.junit.Assert.assertTrue("좌측이 12시를 침범", l + sw < 270f)
    }

    @Test
    fun `심박 띠 - 위가 높은 값이다`() {
        val hi = band(com.vitalguard.wear.ui.VitalUiState(bpm = 130, collecting = true))
        val lo = band(com.vitalguard.wear.ui.VitalUiState(bpm = 40, collecting = true))
        assertEquals(1f, hi.fraction!!, 0.001f)
        assertEquals(0f, lo.fraction!!, 0.001f)
    }

    @Test
    fun `무동작 눈금 - 붕괴선에서 가득 찬다`() {
        val full = ticks(com.vitalguard.wear.ui.VitalUiState(stillSec = 90.0))
        val half = ticks(com.vitalguard.wear.ui.VitalUiState(stillSec = 45.0))
        assertEquals(1f, full.fraction!!, 0.001f)
        assertEquals(0.5f, half.fraction!!, 0.001f)
    }

    @Test
    fun `값이 없으면 채우지 않는다 - 0 으로 그리지 않는다`() {
        assertEquals(null, band(com.vitalguard.wear.ui.VitalUiState()).fraction)
        assertEquals(null, ticks(com.vitalguard.wear.ui.VitalUiState()).fraction)
    }

    @Test
    fun `심박 띠 색은 판정색을 따른다`() {
        val danger = band(com.vitalguard.wear.ui.VitalUiState(bpm = 140, collecting = true))
        assertEquals(com.vitalguard.wear.ui.VgColors.Danger, danger.color)
    }
}

class BezelLabelTest {

    @Test
    fun `위쪽 끝 - 좌우가 서로 다른 각을 고른다`() {
        val left = com.vitalguard.wear.ui.topEndDeg(
            com.vitalguard.wear.ui.Bezel.LEFT_START, com.vitalguard.wear.ui.Bezel.SWEEP,
        )
        val right = com.vitalguard.wear.ui.topEndDeg(
            com.vitalguard.wear.ui.Bezel.RIGHT_START, com.vitalguard.wear.ui.Bezel.SWEEP,
        )
        assertEquals("좌측은 끝각(215°)이 위", 215f, left, 0.01f)
        assertEquals("우측은 시작각(-35°)이 위", -35f, right, 0.01f)
    }

    @Test
    fun `고른 각은 실제로 화면 위쪽이다 - 두 라벨의 높이가 같아야 한다`() {
        fun y(deg: Float) = kotlin.math.sin(Math.toRadians(deg.toDouble()))
        val ly = y(com.vitalguard.wear.ui.topEndDeg(com.vitalguard.wear.ui.Bezel.LEFT_START, com.vitalguard.wear.ui.Bezel.SWEEP))
        val ry = y(com.vitalguard.wear.ui.topEndDeg(com.vitalguard.wear.ui.Bezel.RIGHT_START, com.vitalguard.wear.ui.Bezel.SWEEP))
        org.junit.Assert.assertTrue("좌측 라벨이 화면 위가 아니다", ly < 0)
        org.junit.Assert.assertTrue("우측 라벨이 화면 위가 아니다", ry < 0)
        assertEquals("좌우 라벨 높이가 다르다", ly, ry, 0.001)
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
}
