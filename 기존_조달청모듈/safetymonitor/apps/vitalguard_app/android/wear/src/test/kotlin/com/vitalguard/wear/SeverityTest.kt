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
