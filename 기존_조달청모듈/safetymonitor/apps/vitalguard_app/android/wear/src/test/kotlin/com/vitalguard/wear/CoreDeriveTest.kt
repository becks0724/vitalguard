// B 검증 — SDNN·무동작·변동폭의 손계산 대조 벡터와 null 규칙(0 금지)
package com.vitalguard.wear

import com.vitalguard.wear.core.MotionTracker
import com.vitalguard.wear.core.Sdnn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SdnnTest {

    @Test
    fun `손계산 대조 - 표본 문턱을 넘는 IBI 열`() {
        // 800±10 을 30개. 연속성(20%)·범위 필터를 전부 통과한다.
        val ibi = (0 until 30).map { 800 + (it % 3 - 1) * 10 }   // 790·800·810 반복
        val got = Sdnn.sdnnMs(ibi)!!
        // 790·800·810 이 각 10개 → mean 800, var = (100+0+100)/3 = 66.667 → sd 8.1650
        assertEquals(8.1650, got, 0.0001)
    }

    @Test
    fun `status 필터 - 무효 표본은 계산에서 빠진다`() {
        val clean = (0 until 30).map { 800 + (it % 3 - 1) * 10 }
        val withBad = clean + listOf(9999)
        val status = List(clean.size) { 0 } + listOf(1)   // 마지막만 무효
        assertEquals(Sdnn.sdnnMs(clean)!!, Sdnn.sdnnMs(withBad, status)!!, 0.0001)
    }

    @Test
    fun `표본이 최소선 미만이면 0 이 아니라 null`() {
        assertNull(Sdnn.sdnnMs(emptyList()))
        assertNull(Sdnn.sdnnMs(listOf(800)))
        // 29개는 문턱(30) 미달 — 하나 모자라도 안 보여준다.
        assertNull("29개는 부족", Sdnn.sdnnMs((0 until 29).map { 800 + (it % 3 - 1) * 10 }))
    }

    @Test
    fun `status 길이가 안 맞으면 필터를 신뢰하지 않는다`() {
        val ibi = (0 until 30).map { 800 + (it % 3 - 1) * 10 }
        assertEquals(8.1650, Sdnn.sdnnMs(ibi, listOf(0))!!, 0.0001)
    }
}

class MotionTrackerTest {

    @Test
    fun `무동작 지속 - 시작 기준점부터 계수되고 0_1 단위로 반올림`() {
        val m = MotionTracker()
        m.start(nowMs = 0)
        m.onSample(0.01, atMs = 1_000)          // 임계 미만 — 기준점 안 바뀜
        assertEquals(12.3, m.stillSec(nowMs = 12_340)!!, 0.0001)
    }

    @Test
    fun `임계 경계 - 정확히 0_03g 는 움직임이다 (iOS 는 이상 비교)`() {
        val m = MotionTracker()
        m.start(0)
        m.onSample(0.03, atMs = 5_000)
        assertEquals(2.0, m.stillSec(nowMs = 7_000)!!, 0.0001)
    }

    @Test
    fun `콜백 0회면 stillSec 은 0 이 아니라 null`() {
        val m = MotionTracker()
        m.start(0)
        assertNull(m.stillSec(nowMs = 60_000))
    }

    @Test
    fun `변동폭 - 창 60개 전엔 null, 차면 손계산 대조`() {
        val m = MotionTracker(windowSize = 4)   // 손계산 가능한 작은 창으로 같은 공식 검증
        m.start(0)
        listOf(0.01, 0.02).forEachIndexed { i, g -> m.onSample(g, i * 1000L) }
        assertNull(m.variabilityMg())
        listOf(0.03, 0.04).forEachIndexed { i, g -> m.onSample(g, (i + 2) * 1000L) }
        // [0.01,0.02,0.03,0.04] mean=0.025, var=(2.25+0.25+0.25+2.25)e-4/4=1.25e-4… sd=0.011180
        assertEquals(11, m.variabilityMg()!!.toLong())
    }

    @Test
    fun `창은 오래된 것부터 밀려난다`() {
        val m = MotionTracker(windowSize = 2)
        m.start(0)
        m.onSample(0.5, 0)                       // 밀려날 값
        m.onSample(0.01, 1000)
        m.onSample(0.01, 2000)
        assertEquals(0, m.variabilityMg()!!.toLong())   // [0.01,0.01] — sd 0
    }
}
