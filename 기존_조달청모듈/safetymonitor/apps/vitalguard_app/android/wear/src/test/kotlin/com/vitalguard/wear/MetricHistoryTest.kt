// 이력 버퍼 시험 — 창 길이가 실제로 지켜지는가, 튀는 값이 솎임에 지워지지 않는가
package com.vitalguard.wear

import com.vitalguard.wear.core.HistoryWindow
import com.vitalguard.wear.core.MetricHistory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MetricHistoryTest {

    /**
     * ★ 이 시험이 막는 것 — 창이 조용히 짧아지는 것.
     * 15분 창에 1초마다 값을 넣으면, 솎지 않을 경우 240점 상한이 4분 만에 차고
     * 차트가 "15분" 이라 적힌 채 최근 4분만 보여 준다.
     */
    @Test
    fun `촘촘히 넣어도 창 길이를 덮는다`() {
        val h = MetricHistory(HistoryWindow.HEART_MS)
        val t0 = 1_800_000_000_000L
        // 1초에 한 번 · 15분치.
        for (i in 0 until 900) h.add(t0 + i * 1_000L, 80.0 + (i % 7))
        val s = h.snapshot()
        val covered = s.last().atMs - s.first().atMs
        assertTrue("점 수가 상한 안", s.size <= 241)
        assertTrue("창의 90% 이상을 덮어야 한다(실제 $covered ms)", covered >= HistoryWindow.HEART_MS * 9 / 10)
    }

    /**
     * ★ 솎을 때 평균을 내면 임계를 넘긴 순간이 지워진다.
     * 안정 심박 80 사이에 딱 한 번 155 가 섞였을 때 그 점이 살아남아야 한다.
     */
    @Test
    fun `간격 안에서 가장 튀는 값이 살아남는다`() {
        val h = MetricHistory(windowMs = 60_000L, maxPoints = 10) // 간격 6초
        val t0 = 1_800_000_000_000L
        // 창을 꽉 채우지 않는다 — 꽉 채우면 맨 앞 점이 상한에 밀려 나가고,
        // 이 시험이 재려는 것("솎임이 봉우리를 지우나")과 무관한 이유로 빨간불이 된다.
        for (i in 0 until 40) {
            h.add(t0 + i * 1_000L, if (i == 3) 155.0 else 80.0)
        }
        assertTrue("155 가 솎임에 지워졌다", h.snapshot().any { it.value == 155.0 })
    }

    /** 값이 변하지 않아도 간격은 닫혀야 한다(대표값 시각으로 간격을 재면 영영 안 닫힌다). */
    @Test
    fun `값이 일정해도 점이 쌓인다`() {
        val h = MetricHistory(windowMs = 60_000L, maxPoints = 10)
        val t0 = 1_800_000_000_000L
        for (i in 0 until 60) h.add(t0 + i * 1_000L, 80.0)
        assertTrue("일정한 값에서 점이 안 쌓였다(size=${h.size()})", h.size() >= 9)
    }

    /** 창 밖은 버린다 — 오래된 점이 세로축을 잡아당기지 않게. */
    @Test
    fun `창 밖 표본은 버린다`() {
        val h = MetricHistory(windowMs = 60_000L, maxPoints = 100)
        val t0 = 1_800_000_000_000L
        h.add(t0, 200.0)
        for (i in 1..30) h.add(t0 + 120_000L + i * 1_000L, 80.0)
        assertTrue("창 밖 200 이 남아 있다", h.snapshot().none { it.value == 200.0 })
    }

    /** 마지막 값은 항상 최신이어야 한다 — 확정 전 대표값도 조회에 포함된다. */
    @Test
    fun `최신 값이 즉시 보인다`() {
        val h = MetricHistory(windowMs = 60_000L, maxPoints = 10)
        val t0 = 1_800_000_000_000L
        h.add(t0, 88.0)
        assertEquals(88.0, h.latest()!!, 1e-9)
        assertEquals(1, h.snapshot().size)
    }

    /** 시간순 — 차트가 시각 순서를 가정하고 선을 잇는다. */
    @Test
    fun `스냅숏은 시간순이다`() {
        val h = MetricHistory(windowMs = 600_000L, maxPoints = 20)
        val t0 = 1_800_000_000_000L
        for (i in 0 until 300) h.add(t0 + i * 1_000L, 80.0 + (i % 11))
        val s = h.snapshot()
        assertTrue("시각이 역행했다", s.zipWithNext().all { (a, b) -> a.atMs <= b.atMs })
    }
}
